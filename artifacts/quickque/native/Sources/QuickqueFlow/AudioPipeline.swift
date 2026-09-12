@preconcurrency import AVFoundation
import CoreMedia
import Foundation
import Speech
@preconcurrency import SoundAnalysis

struct PipelineEvent: Sendable {
    enum Kind: Sendable {
        case dropped(Int)
        case diagnostic(DiagnosticStage)
        case speech(Double)
        case audioLevel(Double)
        case audioProgress(Double)
        case inputProgress(Double)
        case transcript(String, isFinal: Bool)
        case analysisGap
        case analyzerStall
        case invalidInput(AudioInputError)
        case conversionFailure(AudioInputError)
        case analyzerFailure(String)
    }

    let session: UUID
    let kind: Kind
    let occurredAt: ContinuousClock.Instant

    init(
        session: UUID,
        kind: Kind,
        occurredAt: ContinuousClock.Instant = ContinuousClock.now
    ) {
        self.session = session
        self.kind = kind
        self.occurredAt = occurredAt
    }
}

/// Converts the RMS of normalized mono PCM into a stable display meter.
///
/// The input is the same 16 kHz normalized stream used by the speech
/// analyzers. A -60 dBFS floor gives quiet microphone input useful display
/// resolution while preserving exact zero for digital silence.
struct AudioLevelMeter {
    static let silenceDecibels = -60.0

    static func normalizedLevel(for samples: [Float]) -> Double? {
        guard !samples.isEmpty else { return nil }

        var sumOfSquares = 0.0
        for sample in samples {
            guard sample.isFinite else { return nil }
            let value = Double(sample)
            sumOfSquares += value * value
        }
        guard sumOfSquares.isFinite, sumOfSquares > 0 else { return 0 }

        let rms = sqrt(sumOfSquares / Double(samples.count))
        guard rms.isFinite, rms > 0 else { return 0 }
        let decibels = 20.0 * log10(rms)
        guard decibels.isFinite else { return nil }

        let normalized = (decibels - silenceDecibels) / -silenceDecibels
        return min(1.0, max(0.0, normalized))
    }
}

/// A single bounded event dispatcher. Audio callbacks and workers only append
/// to this finite queue; they never create one Task per result or warning.
final class PipelineEventBridge: @unchecked Sendable {
    private let lock = NSLock()
    private let deliver: @Sendable ([PipelineEvent]) async -> Void
    private var pending: [PipelineEvent] = []
    private var waiter: CheckedContinuation<Void, Never>?
    private var worker: Task<Void, Never>?
    private var closed = false
    private let maxPendingEvents = 256
    private enum DrainState {
        case batch([PipelineEvent])
        case wait
        case closed
    }

    init(deliver: @escaping @Sendable ([PipelineEvent]) async -> Void) {
        self.deliver = deliver
    }

    func start() {
        lock.lock()
        guard worker == nil else {
            lock.unlock()
            return
        }
        worker = Task { [self] in await drain() }
        lock.unlock()
    }

    func submit(_ event: PipelineEvent) {
        lock.lock()
        guard !closed else {
            lock.unlock()
            return
        }
        let isAudioLevel: Bool
        if case .audioLevel = event.kind {
            isAudioLevel = true
        } else {
            isAudioLevel = false
        }

        if isAudioLevel,
           let pendingLevelIndex = pending.firstIndex(where: {
               if case .audioLevel = $0.kind {
                   return true
               }
               return false
           })
        {
            // Audio level is optional telemetry. Keep its position in the
            // event order, but replace stale telemetry rather than allowing
            // it to accumulate behind critical pipeline events.
            pending[pendingLevelIndex] = event
            lock.unlock()
            return
        }
        if isAudioLevel, pending.count >= maxPendingEvents {
            // A full queue must never turn optional telemetry pressure into
            // an analysis gap or displace a critical event.
            lock.unlock()
            return
        }
        if !isAudioLevel, pending.count >= maxPendingEvents {
            if let pendingLevelIndex = pending.firstIndex(where: {
                if case .audioLevel = $0.kind {
                    return true
                }
                return false
            }) {
                // Preserve the critical event capacity when optional
                // telemetry is the only item occupying the final slot.
                pending.remove(at: pendingLevelIndex)
            } else {
                // Losing a transcript event would violate the bridge's strict
                // sequence contract. Convert event-queue pressure into the same
                // discontinuity path as an audio drop instead of silently
                // delivering an out-of-order transcript.
                pending.removeAll(keepingCapacity: true)
                pending.append(PipelineEvent(
                    session: event.session,
                    kind: .analysisGap
                ))
            }
        }
        pending.append(event)
        let continuation = waiter
        waiter = nil
        lock.unlock()
        continuation?.resume()
    }

    func close() {
        lock.lock()
        closed = true
        let continuation = waiter
        waiter = nil
        lock.unlock()
        continuation?.resume()
    }

    private func drain() async {
        while true {
            switch dequeueState() {
            case .batch(let batch):
                await deliver(batch)
            case .closed:
                return
            case .wait:
                await waitForEvent()
            }
        }
    }

    private func dequeueState() -> DrainState {
        lock.lock()
        defer { lock.unlock() }
        if !pending.isEmpty {
            let batch = pending
            pending.removeAll(keepingCapacity: true)
            return .batch(batch)
        }
        return closed ? .closed : .wait
    }

    private func waitForEvent() async {
        await withCheckedContinuation {
            (continuation: CheckedContinuation<Void, Never>) in
            installWaiter(continuation)
        }
    }

    private func installWaiter(
        _ continuation: CheckedContinuation<Void, Never>
    ) {
        lock.lock()
        if closed || !pending.isEmpty {
            lock.unlock()
            continuation.resume()
        } else {
            waiter = continuation
            lock.unlock()
        }
    }
}

/// A circular FIFO of normalized mono frames. Its storage is always exactly
/// 80,000 Float frames (about 320 KB), independent of input callback sizes.
final class NormalizedPCMRing: @unchecked Sendable {
    enum Work {
        case window([Float], epoch: UInt64)
        case discontinuity(UInt64)
        case stopped
    }

    static let capacity = 80_000
    static let windowSize = 3_200

    private let lock = NSLock()
    private var storage = [Float](repeating: 0, count: capacity)
    private var head = 0
    private var count = 0
    private var epoch: UInt64 = 0
    private var pendingDiscontinuityEpoch: UInt64?
    private var stopped = false
    private var waiter: CheckedContinuation<Void, Never>?
    private enum WorkState {
        case work(Work)
        case wait
    }

    var queuedFrames: Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }

    var currentEpoch: UInt64 {
        lock.lock()
        defer { lock.unlock() }
        return epoch
    }

    @discardableResult
    func append(_ samples: [Float]) -> Int {
        guard !samples.isEmpty else { return 0 }
        lock.lock()
        guard !stopped else {
            lock.unlock()
            return 0
        }
        var dropped = 0
        if samples.count >= Self.capacity {
            dropped = count + samples.count - Self.capacity
            head = 0
            count = 0
        } else {
            while count + samples.count > Self.capacity {
                head = (head + 1) % Self.capacity
                count -= 1
                dropped += 1
            }
        }
        if dropped > 0 {
            markDiscontinuityLocked()
        }
        let retainedSamples = samples.count > Self.capacity
            ? samples.suffix(Self.capacity)
            : ArraySlice(samples)
        for sample in retainedSamples {
            storage[(head + count) % Self.capacity] = sample
            count += 1
        }
        let continuation = waiter
        waiter = nil
        lock.unlock()
        continuation?.resume()
        return dropped
    }

    func requestDiscontinuity() {
        lock.lock()
        guard !stopped else {
            lock.unlock()
            return
        }
        markDiscontinuityLocked()
        let continuation = waiter
        waiter = nil
        lock.unlock()
        continuation?.resume()
    }

    func acknowledgeDiscontinuity(_ acknowledgedEpoch: UInt64) {
        lock.lock()
        if pendingDiscontinuityEpoch == acknowledgedEpoch {
            pendingDiscontinuityEpoch = nil
        }
        lock.unlock()
    }

    /// Serialize the last epoch check with transcript publication. A drop
    /// that acquires the ring lock first therefore cannot leak stale text.
    @discardableResult
    func publishIfCurrent(_ expectedEpoch: UInt64, _ publish: () -> Void) -> Bool {
        lock.lock()
        guard !stopped, epoch == expectedEpoch else {
            lock.unlock()
            return false
        }
        publish()
        lock.unlock()
        return true
    }

    func stop() {
        lock.lock()
        guard !stopped else {
            lock.unlock()
            return
        }
        stopped = true
        count = 0
        pendingDiscontinuityEpoch = nil
        let continuation = waiter
        waiter = nil
        lock.unlock()
        continuation?.resume()
    }

    func nextWork() async -> Work {
        while true {
            switch nextWorkState() {
            case .work(let work):
                return work
            case .wait:
                await withCheckedContinuation {
                    (continuation: CheckedContinuation<Void, Never>) in
                    installWaiter(continuation)
                }
            }
        }
    }

    private func nextWorkState() -> WorkState {
        lock.lock()
        defer { lock.unlock() }
        if stopped {
            return .work(.stopped)
        }
        if let discontinuity = pendingDiscontinuityEpoch {
            return .work(.discontinuity(discontinuity))
        }
        if count >= Self.windowSize {
            let window = (0..<Self.windowSize).map {
                storage[(head + $0) % Self.capacity]
            }
            head = (head + Self.windowSize) % Self.capacity
            count -= Self.windowSize
            return .work(.window(window, epoch: epoch))
        }
        return .wait
    }

    private func installWaiter(
        _ continuation: CheckedContinuation<Void, Never>
    ) {
        lock.lock()
        if stopped || pendingDiscontinuityEpoch != nil
            || count >= Self.windowSize
        {
            lock.unlock()
            continuation.resume()
        } else {
            waiter = continuation
            lock.unlock()
        }
    }

    private func markDiscontinuityLocked() {
        epoch &+= 1
        pendingDiscontinuityEpoch = epoch
    }
}

/// Converts canonical 16 kHz mono windows to the actual format selected by
/// SpeechAnalyzer.bestAvailableAudioFormat. The analyzer does not transparently
/// resample, so this boundary is explicit and stateful.
private final class AnalyzerConverterInputSupplier: @unchecked Sendable {
    let input: AVAudioPCMBuffer
    private var supplied = false

    init(input: AVAudioPCMBuffer) {
        self.input = input
    }

    func provide(
        _ status: UnsafeMutablePointer<AVAudioConverterInputStatus>
    ) -> AVAudioBuffer? {
        guard !supplied else {
            status.pointee = .noDataNow
            return nil
        }
        supplied = true
        status.pointee = .haveData
        return input
    }
}

final class AnalyzerAudioConverter: @unchecked Sendable {
    private let analyzerFormat: AVAudioFormat
    private let converter: AVAudioConverter?

    init(analyzerFormat: AVAudioFormat) throws {
        self.analyzerFormat = analyzerFormat
        let canonical = try Self.canonicalFormat()
        if AudioInput.formatsMatch(canonical, analyzerFormat) {
            converter = nil
        } else {
            guard let converter = AVAudioConverter(
                from: canonical,
                to: analyzerFormat
            ) else {
                throw AudioInputError.converterUnavailable
            }
            self.converter = converter
        }
    }

    func convert(_ samples: [Float]) throws -> [AnalyzerInput] {
        let input = try AudioInput.normalizedBuffer(from: samples)
        if converter == nil {
            // The buffer-only initializer lets SpeechAnalyzer assign its
            // zero-origin, contiguous input timeline.
            return [AnalyzerInput(buffer: input)]
        }
        return try convertBuffer(input)
    }

    private func convertBuffer(_ input: AVAudioPCMBuffer) throws -> [AnalyzerInput] {
        guard let converter else {
            throw AudioInputError.conversionFailed
        }
        let supplier = AnalyzerConverterInputSupplier(input: input)
        var result: [AnalyzerInput] = []
        result.reserveCapacity(2)

        // A converter can emit priming/output data over several calls. Keep a
        // fresh output buffer for each call and drain only a bounded number of
        // times; the input supplier is intentionally used exactly once.
        for _ in 0..<16 {
            guard let output = AVAudioPCMBuffer(
                pcmFormat: analyzerFormat,
                frameCapacity: AVAudioFrameCount(
                    max(
                        1.0,
                        ceil(
                            Double(input.frameLength)
                                * analyzerFormat.sampleRate / input.format.sampleRate
                        ) + 64.0
                    )
                )
            ) else {
                throw AudioInputError.conversionFailed
            }
            var conversionError: NSError?
            let status = converter.convert(
                to: output,
                error: &conversionError
            ) { _, status in
                supplier.provide(status)
            }
            guard conversionError == nil, status != .error else {
                throw AudioInputError.conversionFailed
            }
            if output.frameLength > 0 {
                // Do not supply a hand-built AVAudioTime here. The analyzer
                // input sequence owns continuity after any reset.
                result.append(AnalyzerInput(buffer: output))
            }
            switch status {
            case .haveData:
                continue
            case .inputRanDry:
                return result
            case .endOfStream, .error:
                throw AudioInputError.conversionFailed
            @unknown default:
                throw AudioInputError.conversionFailed
            }
        }
        throw AudioInputError.conversionFailed
    }

    private static func canonicalFormat() throws -> AVAudioFormat {
        guard let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: 16_000,
            channels: 1,
            interleaved: false
        ) else {
            throw AudioInputError.converterUnavailable
        }
        return format
    }
}

/// Independent activity detection for the 30-second inactivity policy. The
/// Speech framework's macOS 26 detector does not publish speech results, so
/// this uses Apple's built-in Sound Analysis classifier instead of transcript
/// matching or a volume threshold.
final class SpeechActivityAnalyzer: @unchecked Sendable {
    // Sound Analysis exposes a confidence score rather than a calibrated
    // probability. Keep this policy fixed and local to the classifier.
    private static let speechConfidenceThreshold = 0.55
    private let analyzer: SNAudioStreamAnalyzer
    private let observer: SpeechActivityObserver

    init(
        onClassification: @escaping @Sendable (Double, Bool) -> Void,
        onFailure: @escaping @Sendable (String) -> Void
    ) throws {
        guard let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: 16_000,
            channels: 1,
            interleaved: false
        ) else {
            throw FlowFailure.speechActivityUnavailable
        }
        analyzer = SNAudioStreamAnalyzer(format: format)
        let request: SNClassifySoundRequest
        do {
            request = try SNClassifySoundRequest(
                classifierIdentifier: .version1
            )
        } catch {
            throw FlowFailure.speechActivityUnavailable
        }
        guard let speechIdentifier = request.knownClassifications.first(where: {
            $0.caseInsensitiveCompare("speech") == .orderedSame
        }) else {
            throw FlowFailure.speechActivityUnavailable
        }
        observer = SpeechActivityObserver(
            confidenceThreshold: Self.speechConfidenceThreshold,
            speechIdentifier: speechIdentifier,
            onClassification: onClassification,
            onFailure: onFailure
        )
        do {
            try analyzer.add(request, withObserver: observer)
        } catch {
            throw FlowFailure.speechActivityUnavailable
        }
    }

    func analyze(_ samples: [Float], framePosition: AVAudioFramePosition) throws {
        let buffer = try AudioInput.normalizedBuffer(from: samples)
        analyzer.analyze(buffer, atAudioFramePosition: framePosition)
    }

    func stop() {
        analyzer.removeAllRequests()
        analyzer.completeAnalysis()
    }
}

private final class SpeechActivityObserver: NSObject, SNResultsObserving,
    @unchecked Sendable
{
    private let confidenceThreshold: Double
    private let speechIdentifier: String
    private let onClassification: @Sendable (Double, Bool) -> Void
    private let onFailure: @Sendable (String) -> Void

    init(
        confidenceThreshold: Double,
        speechIdentifier: String,
        onClassification: @escaping @Sendable (Double, Bool) -> Void,
        onFailure: @escaping @Sendable (String) -> Void
    ) {
        self.confidenceThreshold = confidenceThreshold
        self.speechIdentifier = speechIdentifier
        self.onClassification = onClassification
        self.onFailure = onFailure
    }

    func request(_ request: any SNRequest, didProduce result: any SNResult) {
        guard let result = result as? SNClassificationResult,
              let end = validEnd(result.timeRange.end)
        else {
            return
        }
        let confidence = result.classification(
            forIdentifier: speechIdentifier
        )?.confidence ?? 0
        onClassification(end, confidence >= confidenceThreshold)
    }

    func request(_ request: any SNRequest, didFailWithError error: any Error) {
        onFailure(error.localizedDescription)
    }

    func requestDidComplete(_ request: any SNRequest) {
    }

    private func validEnd(_ time: CMTime) -> Double? {
        let end = CMTimeGetSeconds(time)
        return end.isFinite && end >= 0 ? end : nil
    }
}

/// Owns capture conversion, the bounded analyzer input stream, and one Apple
/// SpeechAnalyzer session. Apple serializes analysis on its actor; this type
/// never invokes start, finish, or cancellation concurrently.
final class AudioPipeline: @unchecked Sendable {
    let session: UUID
    let rawQueue: BoundedAudioQueue
    let normalizedRing: NormalizedPCMRing

    private let normalizer: AudioNormalizer
    private let analyzer: SpeechAnalyzer
    private let transcriber: SpeechTranscriber
    private let activityAnalyzer: SpeechActivityAnalyzer
    private let analyzerConverter: AnalyzerAudioConverter
    private let inputStream: AsyncStream<AnalyzerInput>
    private let inputContinuation: AsyncStream<AnalyzerInput>.Continuation
    private let events: PipelineEventBridge
    private let inputSampleRate: Double
    private let lifecycleLock = NSLock()
    private var started = false
    private var stopping = false
    // Conversion is serialized by BoundedAudioQueue's one worker. Keeping the
    // throttle here makes it pipeline-scoped and avoids creating work per
    // microphone input or accumulating asynchronous level updates.
    private var lastAudioLevelEmissionAt: ContinuousClock.Instant?
    private var pumpTask: Task<Void, Never>?
    private var analyzerTask: Task<Void, Never>?
    private var transcriptTask: Task<Void, Never>?

    init(
        session: UUID,
        inputFormat: AVAudioFormat,
        analyzerFormat: AVAudioFormat,
        analyzer: SpeechAnalyzer,
        transcriber: SpeechTranscriber,
        activityAnalyzer: SpeechActivityAnalyzer,
        events: PipelineEventBridge
    ) throws {
        self.session = session
        rawQueue = BoundedAudioQueue()
        normalizedRing = NormalizedPCMRing()
        normalizer = try AudioNormalizer(inputFormat: inputFormat)
        self.analyzer = analyzer
        self.transcriber = transcriber
        self.activityAnalyzer = activityAnalyzer
        analyzerConverter = try AnalyzerAudioConverter(analyzerFormat: analyzerFormat)
        let streamPair = AsyncStream<AnalyzerInput>.makeStream(
            of: AnalyzerInput.self,
            bufferingPolicy: .bufferingNewest(16)
        )
        inputStream = streamPair.stream
        inputContinuation = streamPair.continuation
        self.events = events
        inputSampleRate = inputFormat.sampleRate
    }

    func start() {
        lifecycleLock.lock()
        guard !started, !stopping else {
            lifecycleLock.unlock()
            return
        }
        started = true
        lifecycleLock.unlock()
        events.start()

        rawQueue.start(
            consume: { [weak self] buffer in
                await self?.convert(buffer)
            },
            onDrop: { [weak self] drop in
                self?.rawDrop(drop.droppedFrames)
            }
        )
        analyzerTask = Task { [self] in
            do {
                try await analyzer.start(inputSequence: inputStream)
            } catch {
                submit(.analyzerFailure(error.localizedDescription))
            }
        }
        transcriptTask = Task { [self] in await collectTranscripts() }
        pumpTask = Task { [self] in await pumpAnalyzerInputs() }
    }

    func submit(_ kind: PipelineEvent.Kind) {
        events.submit(PipelineEvent(session: session, kind: kind))
    }

    var queuedFrames: Int {
        normalizedRing.queuedFrames
    }

    private func beginStopping() -> Bool {
        lifecycleLock.withLock {
            guard !stopping else { return false }
            stopping = true
            return true
        }
    }

    func stop() async {
        guard beginStopping() else { return }

        rawQueue.stop()
        normalizedRing.stop()
        inputContinuation.finish()
        await rawQueue.waitForWorker()
        if let pumpTask {
            await pumpTask.value
        }
        activityAnalyzer.stop()
        await analyzer.cancelAndFinishNow()
        transcriptTask?.cancel()
        analyzerTask?.cancel()
        events.close()
    }

    private func rawDrop(_ rawFrames: Int) {
        normalizedRing.requestDiscontinuity()
        let normalized = max(
            1,
            Int((Double(rawFrames) * 16_000 / inputSampleRate).rounded())
        )
        submit(.dropped(normalized))
    }

    private func convert(_ sendable: SendableAudioBuffer) async {
        guard sendable.session == session else { return }
        submit(.diagnostic(.audioBufferReceived))
        do {
            submit(.diagnostic(.audioConversionBegin))
            let samples = try normalizer.convert(sendable.value)
            submit(.diagnostic(.audioConversionComplete))
            guard !samples.isEmpty else { return }
            submitAudioLevel(samples)
            let dropped = normalizedRing.append(samples)
            if dropped > 0 {
                submit(.dropped(dropped))
            }
        } catch let error as AudioInputError {
            submit(.conversionFailure(error))
        } catch {
            submit(.conversionFailure(.conversionFailed))
        }
    }

    private func submitAudioLevel(_ samples: [Float]) {
        guard let level = AudioLevelMeter.normalizedLevel(for: samples) else {
            return
        }
        let now = ContinuousClock.now
        if let lastAudioLevelEmissionAt,
           lastAudioLevelEmissionAt.duration(to: now) < .milliseconds(100)
        {
            return
        }
        lastAudioLevelEmissionAt = now
        submit(.audioLevel(level))
    }

    /// AnalyzerInput's PCM buffer is available in macOS 26. Count time using
    /// valid frames at its actual rate, not capacity or interleaved samples.
    static func normalizedDroppedFrames(for buffer: AVAudioPCMBuffer) -> Int {
        max(
            1,
            Int(
                (Double(buffer.frameLength) * 16_000 / buffer.format.sampleRate)
                    .rounded()
            )
        )
    }

    private func pumpAnalyzerInputs() async {
        var sampleTime: Int64 = 0
        while !Task.isCancelled {
            switch await normalizedRing.nextWork() {
            case .stopped:
                return
            case .discontinuity:
                inputContinuation.finish()
                submit(.analysisGap)
                return
            case .window(let samples, let epoch):
                do {
                    try activityAnalyzer.analyze(
                        samples,
                        framePosition: AVAudioFramePosition(sampleTime)
                    )
                    sampleTime += Int64(samples.count)
                    submit(.inputProgress(Double(sampleTime) / 16_000.0))
                    let inputs = try analyzerConverter.convert(
                        samples
                    )
                    for input in inputs {
                        switch inputContinuation.yield(input) {
                        case .enqueued:
                            break
                        case .dropped(let droppedInput):
                            let droppedFrames = Self.normalizedDroppedFrames(
                                for: droppedInput.buffer
                            )
                            normalizedRing.requestDiscontinuity()
                            submit(.dropped(droppedFrames))
                            inputContinuation.finish()
                            submit(.analyzerStall)
                            return
                        case .terminated:
                            return
                        @unknown default:
                            inputContinuation.finish()
                            submit(.analysisGap)
                            return
                        }
                    }
                    normalizedRing.acknowledgeDiscontinuity(epoch)
                } catch let error as AudioInputError {
                    submit(.conversionFailure(error))
                    return
                } catch {
                    submit(.analyzerFailure(error.localizedDescription))
                    return
                }
            }
        }
    }

    private func collectTranscripts() async {
        do {
            for try await result in transcriber.results {
                guard !Task.isCancelled else { return }
                let text = String(result.text.characters)
                submit(.transcript(text, isFinal: result.isFinal))
            }
        } catch is CancellationError {
        } catch {
            submit(.analyzerFailure(error.localizedDescription))
        }
    }

}