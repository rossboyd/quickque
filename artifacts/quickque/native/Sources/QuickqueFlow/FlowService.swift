@preconcurrency import AVFoundation
import Foundation
import Speech

actor FlowService {
    let output: Output
    private var operation: Task<Void, Never>?
    private var teardownTask: Task<Void, Never>?
    var assetStatusTask: Task<Void, Never>?
    private var engine: AVAudioEngine?
    private var audioCheckpoints: Set<DiagnosticStage> = []
    private var pipeline: AudioPipeline?
    private var session: UUID?
    private var silenceTimer: Task<Void, Never>?
    private var overrunTask: Task<Void, Never>?

    var generation: UInt64 = 0
    private var sequence = 0
    private var utteranceId = UUID().uuidString
    private var lastTranscript: String?
    private var activityTimeline = AudioTimelinePolicy()
    private var sessionWallStart: ContinuousClock.Instant?
    private var droppedFramesCumulative = 0
    private var dropHistory: [(ContinuousClock.Instant, Int)] = []
    private var lastWarningAt: ContinuousClock.Instant?
    private var warningFlushTask: Task<Void, Never>?
    private var overrunTriggered = false
    private var classifierStallTriggered = false

    init(output: Output = Output()) {
        self.output = output
    }

    func handle(_ command: InputCommand) async {
        // Invalidate old operation gates before any suspension in teardown.
        generation = command.generation
        await cancelCurrent()
        switch command.action {
        case "status":
            await emitSpeechAssetStatus(expectedGeneration: command.generation)
        case "download":
            operation = Task {
                await self.downloadSpeechAssets(expectedGeneration: command.generation)
            }
        case "start":
            operation = Task {
                await self.start(expectedGeneration: command.generation)
            }
        case "pause":
            await emitStatus("paused")
        case "stop":
            await emitStatus("stopped")
        case "reanchor":
            // Reanchor changes are generation-scoped on the bridge. There is
            // no analyzer-side seek; stop the old analysis session so audio
            // ranges can never be joined across the jump.
            await emitStatus("stopped", message: "Speech analysis reset.")
        default:
            await emitError("helper_protocol", "Unknown Flow action.")
        }
    }

    func supported() -> Bool {
        if #available(macOS 26, *) { return true }
        return false
    }

    private func start(expectedGeneration: UInt64) async {
        guard generation == expectedGeneration else { return }
        guard supported() else {
            await emitStatus("unsupported", message: FlowFailure.unsupported.localizedDescription)
            return
        }

        do {
            emitDiagnostic(.appleSupportCheckBegin)
            let modules = try await makeSpeechModules()
            emitDiagnostic(.appleSupportCheckComplete)
            let status = await AssetInventory.status(forModules: modules.modules)
            emitDiagnostic(.appleAssetsCheckBegin)
            emitDiagnostic(.appleAssetsCheckComplete)
            guard case .installed = status else {
                throw FlowFailure.missingModel
            }
            let installedLocales = await SpeechTranscriber.installedLocales
            guard installedLocales.contains(where: {
                flowLocaleMatches($0, modules.locale)
            }) else {
                throw FlowFailure.missingModel
            }

            let authorized = await microphoneAuthorized()
            guard operationIsCurrent(expectedGeneration) else { return }
            guard authorized else { throw FlowFailure.microphoneDenied }

            let audioEngine = AVAudioEngine()
            let input = audioEngine.inputNode
            let inputFormat = input.outputFormat(forBus: 0)
            guard inputFormat.channelCount > 0,
                  inputFormat.sampleRate.isFinite,
                  inputFormat.sampleRate > 0
            else {
                throw FlowFailure.noMicrophone
            }
            guard let canonicalFormat = AVAudioFormat(
                commonFormat: .pcmFormatFloat32,
                sampleRate: 16_000,
                channels: 1,
                interleaved: false
            ) else {
                throw FlowFailure.assetUnavailable
            }

            // This asks Apple for the format its modules actually support.
            // The canonical capture ring remains 16 kHz mono, and the
            // pipeline performs any explicit conversion required here.
            guard let analyzerFormat = await SpeechAnalyzer
                .bestAvailableAudioFormat(
                    compatibleWith: modules.modules,
                    considering: canonicalFormat
                )
            else {
                throw FlowFailure.assetUnavailable
            }

            await emitStatus("loading", message: "Preparing Apple SpeechAnalyzer.")
            emitDiagnostic(.appleAnalyzerPrepareBegin)
            let speechAnalyzer = SpeechAnalyzer(modules: modules.modules)
            try await speechAnalyzer.prepareToAnalyze(in: analyzerFormat)
            emitDiagnostic(.appleAnalyzerPrepareComplete)
            guard operationIsCurrent(expectedGeneration) else { return }

            let newSession = UUID()
            let bridge = PipelineEventBridge { [weak self] events in
                await self?.handlePipelineEvents(events)
            }
            let activity = try SpeechActivityAnalyzer(
                onClassification: { [weak bridge] end, isSpeech in
                    if isSpeech {
                        bridge?.submit(PipelineEvent(
                            session: newSession,
                            kind: .speech(end)
                        ))
                    }
                    bridge?.submit(PipelineEvent(
                        session: newSession,
                        kind: .audioProgress(end)
                    ))
                },
                onFailure: { [weak bridge] message in
                    bridge?.submit(PipelineEvent(
                        session: newSession,
                        kind: .analyzerFailure(message)
                    ))
                }
            )
            let newPipeline = try AudioPipeline(
                session: newSession,
                inputFormat: inputFormat,
                analyzerFormat: analyzerFormat,
                analyzer: speechAnalyzer,
                transcriber: modules.transcriber,
                activityAnalyzer: activity,
                events: bridge
            )

            sequence = 0
            utteranceId = UUID().uuidString
            lastTranscript = nil
            activityTimeline = AudioTimelinePolicy()
            sessionWallStart = ContinuousClock.now
            droppedFramesCumulative = 0
            dropHistory.removeAll(keepingCapacity: true)
            lastWarningAt = nil
            warningFlushTask?.cancel()
            warningFlushTask = nil
            overrunTriggered = false
            classifierStallTriggered = false
            audioCheckpoints.removeAll(keepingCapacity: true)
            session = newSession
            pipeline = newPipeline

            let tap = AudioInput.makeTap(
                queue: newPipeline.rawQueue,
                session: newSession,
                invalid: { [weak bridge] in
                    bridge?.submit(PipelineEvent(
                        session: newSession,
                        kind: .invalidInput(.invalidBuffer)
                    ))
                }
            )
            let tapFrames = AVAudioFrameCount(
                max(1.0, inputFormat.sampleRate * 0.256)
            )
            input.installTap(
                onBus: 0,
                bufferSize: tapFrames,
                format: inputFormat,
                block: tap
            )
            engine = audioEngine
            newPipeline.start()
            audioEngine.prepare()
            emitDiagnostic(.audioEngineStart)
            try audioEngine.start()
            emitDiagnostic(.audioEngineListening)
            emitDiagnostic(.appleAnalyzerReady)
            armSilenceTimer(
                deadline: ContinuousClock.now.advanced(by: .seconds(30)),
                session: newSession
            )
            await emitStatus(
                "listening",
                message: "Apple SpeechAnalyzer \(modules.locale.identifier) is listening."
            )
        } catch is CancellationError {
        } catch let failure as FlowFailure {
            guard generation == expectedGeneration, !Task.isCancelled else { return }
            await teardownAudio()
            if case .noMicrophone = failure {
                output.send(["type": "noaudio", "generation": generation])
            }
            await emitError(failureCode(failure), failure.localizedDescription)
        } catch {
            guard generation == expectedGeneration, !Task.isCancelled else { return }
            await teardownAudio()
            await emitError(
                "engine_start",
                "Apple SpeechAnalyzer could not start. Stop and restart Flow to try again."
            )
        }
    }

    private func handlePipelineEvents(_ events: [PipelineEvent]) async {
        for event in events {
            guard isCurrent(event.session) else { continue }
            switch event.kind {
            case .dropped(let frames):
                await recordDrop(
                    frames,
                    session: event.session,
                    occurredAt: event.occurredAt
                )
            case .diagnostic(let stage):
                emitFirstAudioDiagnostic(stage)
            case .speech(let end):
                activityTimeline.recordClassification(end: end, speech: true)
                armSilenceTimer(
                    deadline: ContinuousClock.now.advanced(by: .seconds(30)),
                    session: event.session
                )
            case .audioLevel(let level):
                guard level.isFinite, (0.0...1.0).contains(level) else {
                    continue
                }
                output.send([
                    "type": "audio_level",
                    "generation": generation,
                    "level": level,
                ])
            case .audioProgress(let end):
                activityTimeline.recordClassification(end: end, speech: false)
                if silenceDeadlineIsSafe(event.session) {
                    await silenceExpired(event.session)
                }
            case .inputProgress(let end):
                activityTimeline.recordCaptured(end: end)
                guard !classifierStallTriggered,
                      activityTimeline.classifierIsStalled()
                else { continue }
                classifierStallTriggered = true
                await emitError(
                    "overrun",
                    "Apple Sound Analysis stopped reporting classifications. Restart listening to try again."
                )
                await teardownAudio()
                await emitStatus(
                    "stopped",
                    message: "Speech activity analysis stalled before the silence timeout."
                )
            case .transcript(let text, let isFinal):
                if isFinal {
                    await transcript(text, final: true)
                    utteranceId = UUID().uuidString
                    lastTranscript = nil
                } else {
                    await partial(text)
                }
            case .analysisGap:
                await emitError(
                    "audio_input",
                    "Flow stopped after a microphone discontinuity. Restart listening to try again."
                )
                await teardownAudio()
                await emitStatus(
                    "stopped",
                    message: "Speech analysis reset after an audio gap."
                )
            case .analyzerStall:
                await emitError(
                    "overrun",
                    "Apple SpeechAnalyzer could not keep up with audio. Restart listening to try again."
                )
                await teardownAudio()
                await emitStatus(
                    "stopped",
                    message: "Speech analysis stopped after falling behind audio."
                )
            case .invalidInput(let error), .conversionFailure(let error):
                await emitError("audio_input", error.localizedDescription)
                await teardownAudio()
            case .analyzerFailure:
                await emitError(
                    "transcription",
                    "Apple SpeechAnalyzer failed. Stop and restart Flow to try again."
                )
                await teardownAudio()
            }
        }
    }

    private func recordDrop(
        _ frames: Int,
        session expectedSession: UUID,
        occurredAt: ContinuousClock.Instant
    ) async {
        guard isCurrent(expectedSession), frames > 0 else { return }
        utteranceId = UUID().uuidString
        lastTranscript = nil
        droppedFramesCumulative = droppedFramesCumulative.saturatingAdding(frames)
        let now = ContinuousClock.now
        dropHistory.append((occurredAt, frames))
        dropHistory.removeAll { $0.0.duration(to: now) > .seconds(5) }
        let totalRecent = dropHistory.reduce(0) {
            $0.saturatingAdding($1.1)
        }

        if let lastWarningAt,
           lastWarningAt.duration(to: now) < .seconds(1) {
            scheduleWarningFlush(
                session: expectedSession,
                deadline: lastWarningAt.advanced(by: .seconds(1))
            )
        } else {
            emitDropWarning(queuedFrames: pipeline?.queuedFrames ?? 0)
            lastWarningAt = now
        }

        guard totalRecent >= 32_000, !overrunTriggered else { return }
        overrunTriggered = true
        await emitError("overrun", FlowFailure.overrun.localizedDescription)
        overrunTask = Task { [weak self] in
            await self?.recoverFromOverrun(expectedSession)
        }
    }

    private func emitDropWarning(queuedFrames: Int) {
        output.send([
            "type": "warning",
            "generation": generation,
            "code": "audio_dropped",
            "droppedFrames": droppedFramesCumulative,
            "queuedFrames": max(0, queuedFrames),
        ])
    }

    private func scheduleWarningFlush(
        session expectedSession: UUID,
        deadline: ContinuousClock.Instant
    ) {
        guard warningFlushTask == nil else { return }
        warningFlushTask = Task { [weak self] in
            do {
                try await ContinuousClock().sleep(until: deadline)
                guard !Task.isCancelled else { return }
                await self?.flushWarning(expectedSession)
            } catch {
            }
        }
    }

    private func flushWarning(_ expectedSession: UUID) {
        warningFlushTask = nil
        guard isCurrent(expectedSession) else { return }
        emitDropWarning(queuedFrames: pipeline?.queuedFrames ?? 0)
        lastWarningAt = ContinuousClock.now
    }

    private func recoverFromOverrun(_ expectedSession: UUID) async {
        guard isCurrent(expectedSession) else { return }
        await teardownAudio()
        await emitStatus(
            "stopped",
            message: "Flow stopped after sustained audio overload. Restart listening to try again."
        )
    }

    private func partial(_ text: String) async {
        guard lastTranscript != text else { return }
        lastTranscript = text
        await transcript(text, final: false)
    }

    private func transcript(_ text: String, final: Bool) async {
        output.send([
            "type": "transcript",
            "generation": generation,
            "sequence": sequence,
            "utteranceId": utteranceId,
            "text": text,
            "isFinal": final,
        ])
        sequence += 1
    }

    private func armSilenceTimer(
        deadline: ContinuousClock.Instant,
        session expectedSession: UUID
    ) {
        silenceTimer?.cancel()
        silenceTimer = Task {
            do {
                try await ContinuousClock().sleep(until: deadline)
                guard !Task.isCancelled,
                      self.isCurrent(expectedSession)
                else {
                    return
                }
                guard self.silenceDeadlineIsSafe(expectedSession) else {
                    self.rearmSilenceAfterLag(expectedSession)
                    return
                }
                await self.silenceExpired(expectedSession)
            } catch {
            }
        }
    }

    private func silenceExpired(_ expectedSession: UUID) async {
        guard isCurrent(expectedSession), engine != nil else { return }
        await teardownAudio()
        await emitStatus(
            "silence-stopped",
            message: "Flow stopped after 30 seconds without detected speech."
        )
    }

    private func silenceDeadlineIsSafe(_ expectedSession: UUID) -> Bool {
        guard isCurrent(expectedSession), let sessionWallStart else {
            return false
        }
        let elapsed = sessionWallStart.duration(to: ContinuousClock.now)
        let elapsedSeconds = max(0, Double(elapsed.components.seconds))
            + Double(elapsed.components.attoseconds) / 1e18
        // Sound Analysis may deliver a classification after its input window.
        // Never stop while the analyzed timeline is materially behind the
        // wall-clock timeline; wait for the bounded classifier lag to catch up.
        return activityTimeline.shouldStopSilence(afterWallSeconds: elapsedSeconds)
    }

    private func rearmSilenceAfterLag(_ expectedSession: UUID) {
        guard isCurrent(expectedSession) else { return }
        armSilenceTimer(
            deadline: ContinuousClock.now.advanced(by: .seconds(1)),
            session: expectedSession
        )
    }

    private func microphoneAuthorized() async -> Bool {
        emitDiagnostic(.microphoneRequestBegin)
        let authorized: Bool
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            authorized = true
        case .notDetermined:
            authorized = await AVCaptureDevice.requestAccess(for: .audio)
        default:
            authorized = false
        }
        if authorized {
            emitDiagnostic(.microphoneAuthorized)
        }
        return authorized
    }

    private func cancelCurrent() async {
        operation?.cancel()
        operation = nil
        assetStatusTask?.cancel()
        assetStatusTask = nil
        overrunTask?.cancel()
        overrunTask = nil
        warningFlushTask?.cancel()
        warningFlushTask = nil
        await teardownAudio()
    }

    func shutdown() async {
        await cancelCurrent()
    }

    private func teardownAudio() async {
        if let pendingTeardown = teardownTask {
            await pendingTeardown.value
            teardownTask = nil
            return
        }

        // Invalidate every callback/result gate before the first suspension.
        session = nil
        silenceTimer?.cancel()
        silenceTimer = nil
        warningFlushTask?.cancel()
        warningFlushTask = nil
        if let engine {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
        }
        engine = nil

        let oldPipeline = pipeline
        pipeline = nil
        lastTranscript = nil
        activityTimeline = AudioTimelinePolicy()
        sessionWallStart = nil
        dropHistory.removeAll(keepingCapacity: false)
        droppedFramesCumulative = 0
        overrunTriggered = false
        classifierStallTriggered = false

        guard let oldPipeline else { return }
        let stopTask = Task { await oldPipeline.stop() }
        teardownTask = stopTask
        await stopTask.value
        teardownTask = nil
    }

    private func isCurrent(_ expected: UUID) -> Bool {
        session == expected && engine != nil && pipeline != nil
    }

    private func operationIsCurrent(_ expectedGeneration: UInt64) -> Bool {
        !Task.isCancelled && generation == expectedGeneration
    }

    func emitDiagnostic(_ stage: DiagnosticStage) {
        output.sendDiagnostic(stage, generation: generation)
    }

    private func emitFirstAudioDiagnostic(_ stage: DiagnosticStage) {
        if audioCheckpoints.insert(stage).inserted {
            emitDiagnostic(stage)
        }
    }

    func failureCode(_ failure: FlowFailure) -> String {
        switch failure {
        case .microphoneDenied:
            return "microphone_denied"
        case .noMicrophone:
            return "microphone_unavailable"
        case .missingModel:
            return "unsupported_platform"
        case .unsupported, .unsupportedLocale, .assetUnavailable,
                .speechActivityUnavailable:
            return "unsupported_platform"
        case .overrun:
            return "overrun"
        }
    }

    func emitStatus(
        _ status: String,
        message: String? = nil,
        progress: Double? = nil,
        totalBytes: Int? = nil
    ) async {
        var event: [String: Any] = [
            "type": "status",
            "generation": generation,
            "status": status,
        ]
        if let message { event["message"] = message }
        if let progress { event["progress"] = progress }
        if let totalBytes { event["totalBytes"] = totalBytes }
        output.send(event)
    }

    func emitError(_ code: String, _ message: String) async {
        output.send([
            "type": "error",
            "generation": generation,
            "code": code,
            "message": message,
        ])
    }
}

private extension Int {
    func saturatingAdding(_ other: Int) -> Int {
        let (result, overflow) = addingReportingOverflow(other)
        return overflow ? Int.max : result
    }
}