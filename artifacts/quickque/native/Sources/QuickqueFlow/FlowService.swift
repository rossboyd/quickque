@preconcurrency import AVFoundation
import CoreML
import Darwin
import FluidAudio
import Foundation

let modelRevision = "40a23f4c0b333aa17ad8c0f2ea47ec2347f2f355"
let vadRevision = "b419383c55c110e2c9271fa6ee0ea83d03c70d96"

actor FlowService {
    let output = Output()
    private var operation: Task<Void, Never>?
    private var engine: AVAudioEngine?
    private var asr: StreamingEouAsrManager?
    private var vad: VadManager?
    private var vadState = VadStreamState.initial()
    private var vadSamples: [Float] = []
    private var vadThreshold: Float = 0.5
    var generation: UInt64 = 0
    private var sequence = 0
    private var utteranceId = UUID().uuidString
    private var lastTranscript = ""
    private var utteranceSeconds = 0.0
    private var silenceTimer: Task<Void, Never>?
    private var audioQueue = BoundedAudioQueue(capacity: 4)
    private var session: UUID?

    var root: URL {
        let support = FileManager.default.urls(
            for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return support.appendingPathComponent("Quickque/Flow", isDirectory: true)
    }

    var modelsRoot: URL { root.appendingPathComponent("Models", isDirectory: true) }
    var marker: URL { root.appendingPathComponent("installed-\(modelRevision)") }
    var eouDirectory: URL {
        modelsRoot.appendingPathComponent("parakeet-eou-streaming/160ms", isDirectory: true)
    }
    var vadDirectory: URL {
        root.appendingPathComponent("Models/silero-vad-coreml", isDirectory: true)
    }

    func handle(_ command: InputCommand) async {
        await cancelCurrent()
        generation = command.generation
        switch command.action {
        case "status":
            let complete = modelsAreComplete()
            await emitStatus(complete ? "ready" : "needs-model",
                message: complete ? nil : "Download the on-device model to use Flow.")
        case "download": operation = Task { await self.download() }
        case "start": operation = Task { await self.start() }
        case "pause": await emitStatus("paused")
        case "stop": await emitStatus("stopped")
        case "cancelDownload":
            await emitStatus(modelsAreComplete() ? "ready" : "needs-model",
                message: "Model download cancelled.")
        default: await emitError("Unknown Flow action.")
        }
    }

    func supported() -> Bool {
#if arch(arm64)
        if #available(macOS 14, *) { return true }
#endif
        return false
    }

    private func start() async {
        guard supported() else {
            await emitStatus("unsupported", message: FlowFailure.unsupported.localizedDescription)
            return
        }
        guard modelsAreComplete() else {
            await emitStatus("needs-model", message: FlowFailure.missingModel.localizedDescription)
            return
        }
        do {
            let authorized = await microphoneAuthorized()
            guard operationIsCurrent() else { return }
            guard authorized else { throw FlowFailure.microphoneDenied }
            await emitStatus("loading")
            let manager = StreamingEouAsrManager(chunkSize: .ms160, debugFeatures: false)
            ModelHub.offlineMode = true
            try await manager.loadModels(to: modelsRoot)
            guard operationIsCurrent() else { await manager.cleanup(); return }
            let voiceDetector = try await VadManager(modelDirectory: root)
            guard operationIsCurrent() else { await manager.cleanup(); return }
            try Task.checkCancellation()

            let newSession = UUID()
            sequence = 0
            utteranceId = UUID().uuidString
            lastTranscript = ""
            utteranceSeconds = 0
            vadState = await voiceDetector.makeStreamState()
            guard operationIsCurrent() else { await manager.cleanup(); return }
            vadThreshold = await voiceDetector.config.defaultThreshold
            guard operationIsCurrent() else { await manager.cleanup(); return }
            vadSamples.removeAll(keepingCapacity: true)
            session = newSession
            audioQueue = BoundedAudioQueue(capacity: 4)
            asr = manager
            vad = voiceDetector

            let audioEngine = AVAudioEngine()
            let input = audioEngine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.channelCount > 0, format.sampleRate > 0 else {
                throw FlowFailure.noMicrophone
            }
            let vadFrames = AVAudioFrameCount(max(1, format.sampleRate * 0.256))
            let queue = audioQueue
            input.installTap(onBus: 0, bufferSize: vadFrames, format: format) { buffer, _ in
                guard let copy = Self.copyBuffer(buffer) else { return }
                let sendable = SendableAudioBuffer(
                    copy, capturedAt: ContinuousClock.now, session: newSession)
                queue.enqueue(
                    sendable,
                    consume: { await self.consume($0) },
                    overflow: { await self.audioOverrun(newSession) })
            }
            engine = audioEngine
            audioEngine.prepare()
            try audioEngine.start()
            armSilenceTimer(
                deadline: ContinuousClock.now.advanced(by: .seconds(30)), session: newSession)
            await emitStatus("listening")
        } catch is CancellationError {
        } catch {
            await teardownAudio()
            await emitError(error.localizedDescription)
        }
    }

    nonisolated private static func copyBuffer(_ source: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let copy = AVAudioPCMBuffer(
            pcmFormat: source.format, frameCapacity: source.frameLength)
        else { return nil }
        copy.frameLength = source.frameLength
        let sourceList = UnsafeMutableAudioBufferListPointer(source.mutableAudioBufferList)
        let targetList = UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList)
        for index in 0..<min(sourceList.count, targetList.count) {
            guard let sourceData = sourceList[index].mData,
                  let targetData = targetList[index].mData
            else { continue }
            memcpy(targetData, sourceData, Int(sourceList[index].mDataByteSize))
            targetList[index].mDataByteSize = sourceList[index].mDataByteSize
        }
        return copy
    }

    private func consume(_ sendable: SendableAudioBuffer) async {
        guard isCurrent(sendable.session), let asr, let vad else { return }
        let buffer = sendable.value
        utteranceSeconds += Double(buffer.frameLength) / buffer.format.sampleRate
        do {
            vadSamples.append(contentsOf: try Self.samples16k(from: buffer))
            var detectedSpeech = false
            while vadSamples.count >= VadManager.chunkSize {
                let chunk = Array(vadSamples.prefix(VadManager.chunkSize))
                vadSamples.removeFirst(VadManager.chunkSize)
                let result = try await vad.processStreamingChunk(chunk, state: vadState)
                guard isCurrent(sendable.session) else { return }
                vadState = result.state
                detectedSpeech = detectedSpeech || result.probability >= vadThreshold
            }
            guard isCurrent(sendable.session) else { return }
            if detectedSpeech {
                output.send(["type": "speech", "generation": generation])
                armSilenceTimer(
                    deadline: sendable.capturedAt.advanced(by: .seconds(30)),
                    session: sendable.session)
            }
            try await asr.appendAudio(buffer)
            guard isCurrent(sendable.session) else { return }
            try await asr.processBufferedAudio()
            guard isCurrent(sendable.session) else { return }
            let current = await asr.getPartialTranscript()
            guard isCurrent(sendable.session) else { return }
            let eou = await asr.getEouTimestampsMs()
            guard isCurrent(sendable.session) else { return }
            if !eou.isEmpty || utteranceSeconds >= 120 {
                if !current.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    await transcript(current, final: true)
                }
                await asr.reset()
                guard isCurrent(sendable.session) else { return }
                utteranceId = UUID().uuidString
                lastTranscript = ""
                utteranceSeconds = 0
            } else {
                await partial(current)
            }
        } catch {
            guard isCurrent(sendable.session) else { return }
            await emitError("Local transcription failed: \(error.localizedDescription)")
            await teardownAudio()
        }
    }

    private func audioOverrun(_ expectedSession: UUID) async {
        guard isCurrent(expectedSession) else { return }
        await teardownAudio()
        await emitError(
            "Local Flow could not process microphone audio in real time and stopped to avoid buffering a recording in memory.")
        exit(70)
    }

    private func partial(_ text: String) async {
        guard text != lastTranscript,
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return }
        lastTranscript = text
        await transcript(text, final: false)
    }

    private func transcript(_ text: String, final: Bool) async {
        output.send([
            "type": "transcript", "generation": generation, "sequence": sequence,
            "utteranceId": utteranceId, "text": text, "isFinal": final,
        ])
        sequence += 1
    }

    private func armSilenceTimer(deadline: ContinuousClock.Instant, session: UUID) {
        silenceTimer?.cancel()
        silenceTimer = Task {
            do {
                try await ContinuousClock().sleep(until: deadline)
                guard !Task.isCancelled, await self.isCurrent(session) else { return }
                await self.silenceExpired(session)
            } catch {}
        }
    }

    private func silenceExpired(_ expectedSession: UUID) async {
        guard isCurrent(expectedSession), engine != nil else { return }
        await teardownAudio()
        await emitStatus(
            "silence-stopped", message: "Flow stopped after 30 seconds without detected speech.")
    }

    private func microphoneAuthorized() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return true
        case .notDetermined: return await AVCaptureDevice.requestAccess(for: .audio)
        default: return false
        }
    }

    private func cancelCurrent() async {
        operation?.cancel()
        operation = nil
        await teardownAudio()
    }

    func shutdown() async {
        await cancelCurrent()
    }

    private func teardownAudio() async {
        session = nil
        audioQueue.stop()
        silenceTimer?.cancel()
        silenceTimer = nil
        if let engine {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
        }
        engine = nil
        if let asr { await asr.cleanup() }
        asr = nil
        vad = nil
        vadSamples.removeAll(keepingCapacity: false)
        lastTranscript = ""
        utteranceSeconds = 0
        vadState = VadStreamState.initial()
    }

    private func isCurrent(_ expected: UUID) -> Bool {
        session == expected && engine != nil
    }

    private func operationIsCurrent() -> Bool {
        !Task.isCancelled
    }

    nonisolated private static func samples16k(from input: AVAudioPCMBuffer) throws -> [Float] {
        guard let target = AVAudioFormat(
            commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 1,
            interleaved: false),
              let converter = AVAudioConverter(from: input.format, to: target)
        else { throw FlowFailure.noMicrophone }
        let capacity = AVAudioFrameCount(
            ceil(Double(input.frameLength) * target.sampleRate / input.format.sampleRate)) + 16
        guard let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else {
            throw FlowFailure.noMicrophone
        }
        var supplied = false
        var conversionError: NSError?
        converter.convert(to: output, error: &conversionError) { _, status in
            if supplied {
                status.pointee = .noDataNow
                return nil
            }
            supplied = true
            status.pointee = .haveData
            return input
        }
        if let conversionError { throw conversionError }
        guard let channel = output.floatChannelData?[0] else { return [] }
        return Array(UnsafeBufferPointer(start: channel, count: Int(output.frameLength)))
    }

    func emitStatus(
        _ status: String, message: String? = nil, progress: Double? = nil,
        totalBytes: Int? = nil
    ) async {
        var event: [String: Any] = [
            "type": "status", "generation": generation, "status": status,
        ]
        if let message { event["message"] = message }
        if let progress { event["progress"] = progress }
        if let totalBytes { event["totalBytes"] = totalBytes }
        output.send(event)
    }

    func emitError(_ message: String) async {
        output.send(["type": "error", "generation": generation, "message": message])
    }
}