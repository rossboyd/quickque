@preconcurrency import AVFoundation
import Foundation

struct InputCommand: Decodable {
    let action: String
    let generation: UInt64
}

struct RemoteFile: Decodable, Sendable {
    let type: String
    let path: String
    let size: Int
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

/// A bounded FIFO with exactly one serial consumer Task. Four 256 ms tap
/// buffers allow normal CoreAudio bursts without allowing recording-like RAM
/// growth. Capacity overflow clears pending audio and fails the whole session.
final class BoundedAudioQueue: @unchecked Sendable {
    private let lock = NSLock()
    private let capacity: Int
    private var buffers: [SendableAudioBuffer] = []
    private var draining = false
    private var inFlight = false
    private var failed = false

    init(capacity: Int = 4) {
        precondition(capacity > 0)
        self.capacity = capacity
    }

    func enqueue(
        _ buffer: SendableAudioBuffer,
        consume: @escaping @Sendable (SendableAudioBuffer) async -> Void,
        overflow: @escaping @Sendable () async -> Void
    ) {
        lock.lock()
        if failed {
            lock.unlock()
            return
        }
        let occupied = buffers.count + (inFlight ? 1 : 0)
        if occupied >= capacity {
            failed = true
            buffers.removeAll(keepingCapacity: false)
            lock.unlock()
            Task { await overflow() }
            return
        }
        buffers.append(buffer)
        let startConsumer = !draining
        draining = true
        lock.unlock()

        if startConsumer {
            Task {
                while let next = self.takeNext() {
                    await consume(next)
                    self.completeCurrent()
                }
            }
        }
    }

    func stop() {
        lock.lock()
        failed = true
        buffers.removeAll(keepingCapacity: false)
        lock.unlock()
    }

    private func takeNext() -> SendableAudioBuffer? {
        lock.lock()
        defer { lock.unlock() }
        guard !failed, !buffers.isEmpty else {
            draining = false
            return nil
        }
        inFlight = true
        return buffers.removeFirst()
    }

    private func completeCurrent() {
        lock.lock()
        inFlight = false
        lock.unlock()
    }
}

enum FlowFailure: LocalizedError {
    case unsupported
    case missingModel
    case microphoneDenied
    case noMicrophone

    var errorDescription: String? {
        switch self {
        case .unsupported:
            return "Local Flow requires macOS 14 or later on Apple Silicon."
        case .missingModel:
            return "The local Flow model is not installed or failed its integrity check."
        case .microphoneDenied:
            return "Microphone access was denied. Enable Quickque in System Settings → Privacy & Security → Microphone."
        case .noMicrophone:
            return "No microphone input is available."
        }
    }
}

@main
struct QuickqueFlow {
    static func main() async {
        let service = FlowService()
        var pending = Data()
        while true {
            let data: Data
            do {
                guard let next = try FileHandle.standardInput.read(upToCount: 64 * 1024),
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
                await service.handle(command)
            }
        }
        // Parent stdin EOF is the ownership signal. Explicitly stop the tap and
        // release CoreML state so a parent crash cannot leave capture running.
        await service.shutdown()
    }
}