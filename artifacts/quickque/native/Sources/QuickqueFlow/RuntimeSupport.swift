@preconcurrency import AVFoundation
import Darwin
import Foundation

struct InputCommand: Decodable {
    let action: String
    let generation: UInt64
}

enum DiagnosticStage: String, Sendable, Hashable {
    case rustCommandReceived = "rust_command_received"
    case helperSpawnBegin = "helper_spawn_begin"
    case helperSpawned = "helper_spawned"
    case helperCommandSent = "helper_command_sent"
    case helperBoot = "helper_boot"
    case helperReadWait = "helper_read_wait"
    case helperCommandReceived = "helper_command_received"
    case appleSupportCheckBegin = "apple_support_check_begin"
    case appleSupportCheckComplete = "apple_support_check_complete"
    case appleAssetsCheckBegin = "apple_assets_check_begin"
    case appleAssetsCheckComplete = "apple_assets_check_complete"
    case microphoneRequestBegin = "microphone_request_begin"
    case microphoneAuthorized = "microphone_authorized"
    case appleAssetsDownloadBegin = "apple_assets_download_begin"
    case appleAssetsDownloadComplete = "apple_assets_download_complete"
    case appleAnalyzerPrepareBegin = "apple_analyzer_prepare_begin"
    case appleAnalyzerPrepareComplete = "apple_analyzer_prepare_complete"
    case appleAnalyzerReady = "apple_analyzer_ready"
    case audioEngineStart = "audio_engine_start"
    case audioEngineListening = "audio_engine_listening"
    case audioBufferReceived = "audio_buffer_received"
    case audioConversionBegin = "audio_conversion_begin"
    case audioConversionComplete = "audio_conversion_complete"
}

final class Output: @unchecked Sendable {
    private let lock = NSLock()

    func send(_ value: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value),
              let line = String(data: data, encoding: .utf8)
        else { return }
        lock.lock()
        defer { lock.unlock() }
        FileHandle.standardOutput.write(Data((line + "\n").utf8))
    }

    func sendDiagnostic(_ stage: DiagnosticStage, generation: UInt64) {
        send([
            "type": "diagnostic",
            "generation": generation,
            "stage": stage.rawValue,
        ])
    }
}

final class SendableAudioBuffer: @unchecked Sendable {
    let value: AVAudioPCMBuffer
    let capturedAt: ContinuousClock.Instant
    let session: UUID

    init(_ value: AVAudioPCMBuffer, capturedAt: ContinuousClock.Instant, session: UUID) {
        self.value = value
        self.capturedAt = capturedAt
        self.session = session
    }
}

/// A bounded raw-capture FIFO. The Core Audio callback only calls `enqueue`;
/// this type never starts work per callback. A single consumer is created by
/// `start` (or lazily by the compatibility enqueue overload used by tests).
///
/// The queue deliberately drops the oldest pending buffers when a bound is
/// reached. The in-flight buffer is never copied again, so a producer can
/// still drop a new buffer while the consumer is converting the old one.
final class BoundedAudioQueue: @unchecked Sendable {
    struct Drop: Sendable {
        let droppedFrames: Int
    }

    private let lock = NSLock()
    private let capacity: Int
    private let maxBytes: Int
    private let maxRawFrames: Int
    private let maxAge: Duration
    private var buffers: [SendableAudioBuffer] = []
    private var queuedBytes = 0
    private var inFlightBytes = 0
    private var inFlightFrames = 0
    private var inFlight = false
    private var stopped = false
    private var waiter: CheckedContinuation<Void, Never>?
    private var worker: Task<Void, Never>?
    private var consumer: (@Sendable (SendableAudioBuffer) async -> Void)?
    private var onDrop: (@Sendable (Drop) -> Void)?
    private enum NextState {
        case buffer(SendableAudioBuffer)
        case wait
        case stopped
    }

    init(
        capacity: Int = 8,
        maxBytes: Int = 512 * 1024,
        maxRawFrames: Int = 96_000,
        maxAge: Duration = .seconds(2)
    ) {
        precondition(capacity > 0 && maxBytes > 0 && maxRawFrames > 0)
        self.capacity = capacity
        self.maxBytes = maxBytes
        self.maxRawFrames = maxRawFrames
        self.maxAge = maxAge
    }

    /// Starts the one conversion consumer for this queue.
    func start(
        consume: @escaping @Sendable (SendableAudioBuffer) async -> Void,
        onDrop: @escaping @Sendable (Drop) -> Void
    ) {
        lock.lock()
        guard !stopped, worker == nil else {
            lock.unlock()
            return
        }
        consumer = consume
        self.onDrop = onDrop
        let task = Task { [self] in await drain() }
        worker = task
        lock.unlock()
    }

    /// Compatibility entry point for older native tests. New production code
    /// calls `start` once before installing the tap.
    func enqueue(
        _ buffer: SendableAudioBuffer,
        consume: @escaping @Sendable (SendableAudioBuffer) async -> Void,
        overflow: @escaping @Sendable () async -> Void
    ) {
        start(consume: consume) { _ in
            // Overflow is no longer fatal. Preserve the old callback shape
            // without creating a task for every callback.
            _ = overflow
        }
        enqueue(buffer)
    }

    /// The only producer operation used by the Core Audio callback.
    func enqueue(_ buffer: SendableAudioBuffer) {
        let bytes = Self.byteCount(of: buffer.value)
        let rawFrames = Self.rawFrameCount(of: buffer.value)
        var dropped = 0
        var shouldWake = false
        var dropHandler: (@Sendable (Drop) -> Void)?

        lock.lock()
        guard !stopped else {
            lock.unlock()
            return
        }

        // Age is a bound as well as a freshness policy. It also prevents a
        // stalled consumer from retaining an old microphone recording.
        while let first = buffers.first,
              first.capturedAt.duration(to: buffer.capturedAt) > maxAge {
            buffers.removeFirst()
            queuedBytes -= Self.byteCount(of: first.value)
            dropped += Self.rawFrameCount(of: first.value)
        }

        while !buffers.isEmpty {
            let occupiedBytes = queuedBytes + inFlightBytes
            let occupiedFrames = buffers.reduce(0) {
                $0 + Self.rawFrameCount(of: $1.value)
            } + inFlightFrames
            guard buffers.count + (inFlight ? 1 : 0) >= capacity
                    || occupiedBytes + bytes > maxBytes
                    || occupiedFrames + rawFrames > maxRawFrames
            else {
                break
            }
            let first = buffers.removeFirst()
            queuedBytes -= Self.byteCount(of: first.value)
            dropped += Self.rawFrameCount(of: first.value)
        }

        let currentBytes = queuedBytes + inFlightBytes
        let currentFrames = buffers.reduce(0) { $0 + Self.rawFrameCount(of: $1.value) }
            + inFlightFrames
        if bytes <= maxBytes && rawFrames <= maxRawFrames &&
            buffers.count + (inFlight ? 1 : 0) < capacity &&
            currentBytes + bytes <= maxBytes &&
            currentFrames + rawFrames <= maxRawFrames {
            buffers.append(buffer)
            queuedBytes += bytes
            shouldWake = waiter != nil
        } else {
            // If the in-flight item alone fills the queue, dropping the new
            // item is the only bounded option. It is still a discontinuity.
            dropped += rawFrames
            shouldWake = waiter != nil
        }
        dropHandler = onDrop
        let continuation = waiter
        waiter = nil
        lock.unlock()

        if dropped > 0 {
            dropHandler?(Drop(droppedFrames: dropped))
        }
        if shouldWake {
            continuation?.resume()
        }
    }

    func stop() {
        lock.lock()
        guard !stopped else {
            lock.unlock()
            return
        }
        stopped = true
        buffers.removeAll(keepingCapacity: false)
        queuedBytes = 0
        let continuation = waiter
        waiter = nil
        lock.unlock()
        continuation?.resume()
    }

    /// Invalid input is exceptional and is scheduled only by the single
    /// caller that detects it. It is not part of normal callback backpressure.
    func fail(_ onFailure: @escaping @Sendable () async -> Void) {
        lock.lock()
        guard !stopped else {
            lock.unlock()
            return
        }
        stopped = true
        buffers.removeAll(keepingCapacity: false)
        queuedBytes = 0
        let continuation = waiter
        waiter = nil
        lock.unlock()
        continuation?.resume()
        Task { await onFailure() }
    }

    /// Synchronous failure handoff for the Core Audio callback. The callback
    /// still performs no actor call or I/O; the supplied handler is expected
    /// to only enqueue a bounded pipeline event.
    func failSync(_ onFailure: @escaping @Sendable () -> Void) {
        lock.lock()
        guard !stopped else {
            lock.unlock()
            return
        }
        stopped = true
        buffers.removeAll(keepingCapacity: false)
        queuedBytes = 0
        let continuation = waiter
        waiter = nil
        lock.unlock()
        continuation?.resume()
        onFailure()
    }

    private func drain() async {
        while let next = await takeNext() {
            let consume = consumerSnapshot()
            if let consume {
                await consume(next)
            }
            completeInFlight()
        }
    }

    func waitForWorker() async {
        let task = workerSnapshot()
        await task?.value
    }

    private func consumerSnapshot()
        -> (@Sendable (SendableAudioBuffer) async -> Void)?
    {
        lock.lock()
        defer { lock.unlock() }
        return consumer
    }

    private func completeInFlight() {
        lock.lock()
        inFlight = false
        inFlightBytes = 0
        inFlightFrames = 0
        lock.unlock()
    }

    private func workerSnapshot() -> Task<Void, Never>? {
        lock.lock()
        defer { lock.unlock() }
        return worker
    }

    private func takeNext() async -> SendableAudioBuffer? {
        while true {
            switch nextState() {
            case .buffer(let buffer):
                return buffer
            case .stopped:
                return nil
            case .wait:
                await withCheckedContinuation {
                    (continuation: CheckedContinuation<Void, Never>) in
                    installWaiter(continuation)
                }
            }
        }
    }

    private func nextState() -> NextState {
        lock.lock()
        defer { lock.unlock() }
        if stopped { return .stopped }
        guard !buffers.isEmpty else { return .wait }
        let next = buffers.removeFirst()
        queuedBytes -= Self.byteCount(of: next.value)
        inFlight = true
        inFlightBytes = Self.byteCount(of: next.value)
        inFlightFrames = Self.rawFrameCount(of: next.value)
        return .buffer(next)
    }

    private func installWaiter(
        _ continuation: CheckedContinuation<Void, Never>
    ) {
        lock.lock()
        if stopped || !buffers.isEmpty {
            lock.unlock()
            continuation.resume()
        } else {
            waiter = continuation
            lock.unlock()
        }
    }

    private static func byteCount(of buffer: AVAudioPCMBuffer) -> Int {
        let bytesPerFrame = Int(buffer.format.streamDescription.pointee.mBytesPerFrame)
        let planes = buffer.format.isInterleaved ? 1 : Int(buffer.format.channelCount)
        return max(1, Int(buffer.frameLength) * max(1, bytesPerFrame) * max(1, planes))
    }

    private static func rawFrameCount(of buffer: AVAudioPCMBuffer) -> Int {
        Int(buffer.frameLength)
    }
}

enum FlowFailure: LocalizedError {
    case unsupported
    case missingModel
    case microphoneDenied
    case noMicrophone
    case overrun
    case unsupportedLocale
    case assetUnavailable
    case speechActivityUnavailable

    var errorDescription: String? {
        switch self {
        case .unsupported:
            return "Local Flow requires macOS 26 or later with Apple Speech support."
        case .missingModel:
            return "The required Apple Speech assets are not installed for the selected English locale."
        case .microphoneDenied:
            return "Microphone access was denied. Enable Quickque in System Settings → Privacy & Security → Microphone."
        case .noMicrophone:
            return "No microphone input is available."
        case .overrun:
            return "Flow could not keep up with microphone audio. Listening stopped to protect memory; restart listening to try again."
        case .unsupportedLocale:
            return "Apple SpeechAnalyzer has no supported English locale for this Mac."
        case .assetUnavailable:
            return "Apple speech assets are unavailable on this Mac. Install a supported English asset and retry."
        case .speechActivityUnavailable:
            return "Apple’s built-in speech activity classifier is unavailable. Flow cannot enforce its no-speech timeout."
        }
    }
}

func readPipeChunk(fileDescriptor: Int32, maximumBytes: Int = 64 * 1024) throws -> Data? {
    precondition(maximumBytes > 0)
    var buffer = [UInt8](repeating: 0, count: maximumBytes)
    while true {
        let count = buffer.withUnsafeMutableBytes { bytes in
            Darwin.read(fileDescriptor, bytes.baseAddress, bytes.count)
        }
        if count > 0 {
            return Data(buffer.prefix(count))
        }
        if count == 0 {
            return nil
        }
        if errno == EINTR {
            continue
        }
        throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
    }
}

@main
struct QuickqueFlow {
    static func main() async {
        let output = Output()
        let service = FlowService(output: output)
        output.sendDiagnostic(.helperBoot, generation: 0)
        var pending = Data()
        while true {
            output.sendDiagnostic(.helperReadWait, generation: 0)
            let data: Data
            do {
                guard let next = try readPipeChunk(
                    fileDescriptor: FileHandle.standardInput.fileDescriptor),
                      !next.isEmpty
                else { break }
                data = next
            } catch {
                break
            }
            pending.append(data)
            guard pending.count <= 64 * 1024 else { break }
            while let newline = pending.firstIndex(of: 0x0a) {
                let line = pending[..<newline]
                pending.removeSubrange(...newline)
                guard !line.isEmpty,
                      let command = try? JSONDecoder().decode(
                        InputCommand.self, from: Data(line))
                else { continue }
                output.sendDiagnostic(
                    .helperCommandReceived, generation: command.generation)
                await service.handle(command)
            }
        }
        // Parent stdin EOF is the ownership signal. Explicitly stop the tap and
        // release Speech/SoundAnalysis state so a parent crash cannot leave
        // capture running.
        await service.shutdown()
    }
}