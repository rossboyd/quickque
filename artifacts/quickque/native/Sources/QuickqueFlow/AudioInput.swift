@preconcurrency import AVFoundation
import Darwin
import Foundation

enum AudioInputError: LocalizedError, Equatable, Sendable {
    case invalidFormat
    case invalidBuffer
    case routeChanged
    case converterUnavailable
    case conversionFailed
    case nonFiniteSamples

    var errorDescription: String? {
        switch self {
        case .invalidFormat:
            return "The microphone format is invalid. Check the selected input device and restart Flow."
        case .invalidBuffer:
            return "Microphone audio was invalid. Stop and restart Flow to try again."
        case .routeChanged:
            return "The microphone format changed while Flow was running. Stop and restart Flow."
        case .converterUnavailable:
            return "The local audio converter could not be created. Check the selected input device and restart Flow."
        case .conversionFailed:
            return "Microphone audio could not be converted for speech recognition. Stop and restart Flow to try again."
        case .nonFiniteSamples:
            return "Microphone audio contained invalid values. Stop and restart Flow to try again."
        }
    }
}

private struct AudioBufferLayout {
    let frameCount: Int
    let expectedBufferCount: Int
    let bytesPerBuffer: Int
}

/// The audio callback boundary for Flow.
///
/// This is an actor only so callers can explicitly use nonisolated entry points
/// when constructing the Core Audio callback. It has no state or synchronous
/// calls into FlowService. The callback does only bounded validation, copying,
/// and enqueueing.
actor AudioInput {
    nonisolated static let maxInputFrameCount: AVAudioFrameCount = 384_000
    nonisolated static let maxInputByteCount = 16 * 1024 * 1024
    nonisolated static let maxNormalizedFrameCount: AVAudioFrameCount = 32_000

    nonisolated static func makeTap(
        queue: BoundedAudioQueue,
        session: UUID,
        consume: @escaping @Sendable (SendableAudioBuffer) async -> Void,
        overflow: @escaping @Sendable () async -> Void,
        invalid: @escaping @Sendable () async -> Void
    ) -> @Sendable (AVAudioPCMBuffer, AVAudioTime) -> Void {
        { buffer, _ in
            guard let copy = AudioInput.copyBuffer(buffer) else {
                queue.fail(invalid)
                return
            }
            queue.enqueue(
                SendableAudioBuffer(
                    copy,
                    capturedAt: ContinuousClock.now,
                    session: session
                ),
                consume: consume,
                overflow: overflow
            )
        }
    }

    /// Production tap boundary. No asynchronous work is created by the
    /// CoreAudio callback: validation, one deep copy, and a bounded enqueue
    /// are the complete callback operation.
    nonisolated static func makeTap(
        queue: BoundedAudioQueue,
        session: UUID,
        invalid: @escaping @Sendable () -> Void
    ) -> @Sendable (AVAudioPCMBuffer, AVAudioTime) -> Void {
        { buffer, _ in
            guard let copy = AudioInput.copyBuffer(buffer) else {
                queue.failSync {
                    invalid()
                }
                return
            }
            queue.enqueue(
                SendableAudioBuffer(
                    copy,
                    capturedAt: ContinuousClock.now,
                    session: session
                )
            )
        }
    }

    nonisolated static func copyBuffer(_ source: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let layout = validatedLayout(source),
              let copy = AVAudioPCMBuffer(
                  pcmFormat: source.format,
                  frameCapacity: source.frameLength
              )
        else {
            return nil
        }

        copy.frameLength = source.frameLength
        let sourceList = UnsafeMutableAudioBufferListPointer(source.mutableAudioBufferList)
        let targetList = UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList)
        guard targetList.count == layout.expectedBufferCount else {
            return nil
        }

        // Complete all checks before the first write. This keeps a failed copy
        // from returning an object containing only a prefix of the input.
        for index in 0..<layout.expectedBufferCount {
            let sourceBuffer = sourceList[index]
            let targetBuffer = targetList[index]
            let channels = source.format.isInterleaved ? source.format.channelCount : 1
            guard hasValidStorage(
                    sourceBuffer, byteCount: layout.bytesPerBuffer, channelCount: channels),
                  hasValidStorage(
                    targetBuffer, byteCount: layout.bytesPerBuffer, channelCount: channels)
            else {
                return nil
            }
        }

        for index in 0..<layout.expectedBufferCount {
            let sourceBuffer = sourceList[index]
            let targetBuffer = targetList[index]
            // mDataByteSize may include packet/frame padding. Only the bytes
            // belonging to frameLength are copied.
            memcpy(
                targetBuffer.mData!,
                sourceBuffer.mData!,
                layout.bytesPerBuffer
            )
            targetList[index].mDataByteSize = UInt32(layout.bytesPerBuffer)
        }
        return copy
    }

    /// Used by AudioNormalizer before handing a buffer to AVAudioConverter.
    /// Keeping this validation separate avoids a second deep copy per chunk.
    nonisolated static func isValidBuffer(_ source: AVAudioPCMBuffer) -> Bool {
        validatedLayout(source) != nil
    }

    /// Make the single normalized format used by both Apple analyzers and
    /// finite-stream tests. Conversion workers own the resulting buffer until
    /// the analyzer call completes.
    nonisolated static func normalizedBuffer(from samples: [Float]) throws -> AVAudioPCMBuffer {
        guard !samples.isEmpty, samples.count <= Int(maxNormalizedFrameCount),
              let target = AVAudioFormat(
                  commonFormat: .pcmFormatFloat32,
                  sampleRate: 16_000,
                  channels: 1,
                  interleaved: false
              ),
              let output = AVAudioPCMBuffer(
                  pcmFormat: target,
                  frameCapacity: AVAudioFrameCount(samples.count)
              ),
              let channel = output.floatChannelData?[0]
        else {
            throw AudioInputError.conversionFailed
        }
        output.frameLength = AVAudioFrameCount(samples.count)
        for (index, sample) in samples.enumerated() {
            channel[index] = sample
        }
        return output
    }

    /// Validate a descriptor value, without asking AVAudioPCMBuffer to rebuild
    /// its managed buffer-list view. Used for both source and destination.
    nonisolated static func hasValidStorage(
        _ buffer: AudioBuffer, byteCount: Int, channelCount: UInt32
    ) -> Bool {
        guard byteCount > 0, byteCount <= maxInputByteCount, channelCount > 0 else {
            return false
        }
        return buffer.mNumberChannels == channelCount
            && buffer.mDataByteSize >= UInt32(byteCount)
            && buffer.mData != nil
    }

    nonisolated static func isValidFormat(_ format: AVAudioFormat) -> Bool {
        guard format.sampleRate.isFinite, format.sampleRate >= 8_000,
              format.sampleRate <= 384_000,
              format.channelCount > 0, format.channelCount <= 32,
              format.commonFormat != .otherFormat
        else {
            return false
        }

        let description = format.streamDescription.pointee
        return description.mFormatID == kAudioFormatLinearPCM
            && description.mChannelsPerFrame > 0
            && description.mBytesPerFrame > 0
            && description.mBytesPerPacket > 0
            && description.mFramesPerPacket > 0
            && description.mBitsPerChannel > 0
    }

    nonisolated static func formatsMatch(
        _ lhs: AVAudioFormat,
        _ rhs: AVAudioFormat
    ) -> Bool {
        guard isValidFormat(lhs), isValidFormat(rhs) else {
            return false
        }
        let left = lhs.streamDescription.pointee
        let right = rhs.streamDescription.pointee
        return lhs.sampleRate == rhs.sampleRate
            && lhs.channelCount == rhs.channelCount
            && lhs.commonFormat.rawValue == rhs.commonFormat.rawValue
            && lhs.isInterleaved == rhs.isInterleaved
            && left.mFormatID == right.mFormatID
            && left.mFormatFlags == right.mFormatFlags
            && left.mBytesPerPacket == right.mBytesPerPacket
            && left.mFramesPerPacket == right.mFramesPerPacket
            && left.mBytesPerFrame == right.mBytesPerFrame
            && left.mChannelsPerFrame == right.mChannelsPerFrame
            && left.mBitsPerChannel == right.mBitsPerChannel
    }

    nonisolated static func samplesAreFinite(_ source: AVAudioPCMBuffer) -> Bool {
        guard let layout = validatedLayout(source) else {
            return false
        }
        switch source.format.commonFormat {
        case .pcmFormatFloat32:
            return floatSamplesAreFinite(
                source,
                layout: layout,
                sampleSize: MemoryLayout<Float>.size
            )
        case .pcmFormatFloat64:
            return doubleSamplesAreFinite(
                source,
                layout: layout,
                sampleSize: MemoryLayout<Double>.size
            )
        default:
            // Integer PCM has no non-finite representation.
            return true
        }
    }

    nonisolated private static func validatedLayout(
        _ source: AVAudioPCMBuffer
    ) -> AudioBufferLayout? {
        let format = source.format
        guard isValidFormat(format),
              source.frameCapacity > 0,
              source.frameLength > 0,
              source.frameLength <= source.frameCapacity,
              Double(source.frameLength) <= format.sampleRate,
              source.frameLength <= maxInputFrameCount
        else {
            return nil
        }

        let channelCount = Int(format.channelCount)
        let expectedBufferCount = format.isInterleaved ? 1 : channelCount
        guard expectedBufferCount > 0 else {
            return nil
        }

        let description = format.streamDescription.pointee
        let bytesPerFrame = Int(description.mBytesPerFrame)
        let frameCount = Int(source.frameLength)
        let bytesPerBufferResult = frameCount.multipliedReportingOverflow(
            by: bytesPerFrame
        )
        let totalBytesResult = bytesPerBufferResult.partialValue.multipliedReportingOverflow(
            by: expectedBufferCount
        )
        guard bytesPerFrame > 0,
              !bytesPerBufferResult.overflow,
              !totalBytesResult.overflow,
              bytesPerBufferResult.partialValue > 0,
              totalBytesResult.partialValue <= maxInputByteCount
        else {
            return nil
        }
        let bytesPerBuffer = bytesPerBufferResult.partialValue

        let sourceList = UnsafeMutableAudioBufferListPointer(source.mutableAudioBufferList)
        guard sourceList.count == expectedBufferCount else {
            return nil
        }

        for index in 0..<expectedBufferCount {
            let buffer = sourceList[index]
            let expectedChannels = format.isInterleaved ? format.channelCount : 1
            guard hasValidStorage(
                buffer, byteCount: bytesPerBuffer, channelCount: expectedChannels)
            else {
                return nil
            }
        }

        return AudioBufferLayout(
            frameCount: frameCount,
            expectedBufferCount: expectedBufferCount,
            bytesPerBuffer: bytesPerBuffer
        )
    }

    nonisolated private static func floatSamplesAreFinite(
        _ source: AVAudioPCMBuffer,
        layout: AudioBufferLayout,
        sampleSize: Int
    ) -> Bool {
        let description = source.format.streamDescription.pointee
        let bytesPerFrame = Int(description.mBytesPerFrame)
        let sourceList = UnsafeMutableAudioBufferListPointer(source.mutableAudioBufferList)

        for index in 0..<layout.expectedBufferCount {
            let buffer = sourceList[index]
            guard let data = buffer.mData else {
                return false
            }
            let channels = Int(buffer.mNumberChannels)
            for frame in 0..<layout.frameCount {
                for channel in 0..<channels {
                    let offset = frame * bytesPerFrame + channel * sampleSize
                    guard offset >= 0,
                          offset + sampleSize <= layout.bytesPerBuffer
                    else {
                        return false
                    }
                    var value = Float.zero
                    memcpy(
                        &value,
                        data.advanced(by: offset),
                        MemoryLayout<Float>.size
                    )
                    if !value.isFinite {
                        return false
                    }
                }
            }
        }
        return true
    }

    nonisolated private static func doubleSamplesAreFinite(
        _ source: AVAudioPCMBuffer,
        layout: AudioBufferLayout,
        sampleSize: Int
    ) -> Bool {
        let description = source.format.streamDescription.pointee
        let bytesPerFrame = Int(description.mBytesPerFrame)
        let sourceList = UnsafeMutableAudioBufferListPointer(source.mutableAudioBufferList)

        for index in 0..<layout.expectedBufferCount {
            let buffer = sourceList[index]
            guard let data = buffer.mData else {
                return false
            }
            let channels = Int(buffer.mNumberChannels)
            for frame in 0..<layout.frameCount {
                for channel in 0..<channels {
                    let offset = frame * bytesPerFrame + channel * sampleSize
                    guard offset >= 0,
                          offset + sampleSize <= layout.bytesPerBuffer
                    else {
                        return false
                    }
                    var value = Double.zero
                    memcpy(
                        &value,
                        data.advanced(by: offset),
                        MemoryLayout<Double>.size
                    )
                    if !value.isFinite {
                        return false
                    }
                }
            }
        }
        return true
    }
}

private final class AudioConverterInputSupplier: @unchecked Sendable {
    private let lock = NSLock()
    private let input: AVAudioPCMBuffer
    private var hasSuppliedInput = false

    init(input: AVAudioPCMBuffer) {
        self.input = input
    }

    var didSupplyInput: Bool {
        lock.lock()
        defer { lock.unlock() }
        return hasSuppliedInput
    }

    func provide(
        _ status: UnsafeMutablePointer<AVAudioConverterInputStatus>
    ) -> AVAudioPCMBuffer? {
        lock.lock()
        defer { lock.unlock() }
        guard !hasSuppliedInput else {
            status.pointee = .noDataNow
            return nil
        }
        hasSuppliedInput = true
        status.pointee = .haveData
        return input
    }
}

/// A per-session, stateful converter from the device route to 16 kHz mono.
///
/// FlowService owns one instance for the lifetime of a capture session. The
/// converter is deliberately not recreated for every tap callback: it can keep
/// resampling state between buffers and can legitimately return an empty chunk
/// while that state is being filled.
final class AudioNormalizer {
    private let inputFormat: AVAudioFormat
    private let outputFormat: AVAudioFormat
    private let converter: AVAudioConverter
    private var finished = false

    init(inputFormat: AVAudioFormat) throws {
        guard AudioInput.isValidFormat(inputFormat) else {
            throw AudioInputError.invalidFormat
        }
        guard let outputFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: 16_000,
            channels: 1,
            interleaved: false
        ) else {
            throw AudioInputError.converterUnavailable
        }
        guard let converter = AVAudioConverter(
            from: inputFormat,
            to: outputFormat
        ) else {
            throw AudioInputError.converterUnavailable
        }
        self.inputFormat = inputFormat
        self.outputFormat = outputFormat
        self.converter = converter
    }

    func convert(_ input: AVAudioPCMBuffer) throws -> [Float] {
        guard !finished else { throw AudioInputError.conversionFailed }
        guard AudioInput.formatsMatch(input.format, inputFormat) else {
            throw AudioInputError.routeChanged
        }
        guard AudioInput.isValidBuffer(input) else {
            throw AudioInputError.invalidBuffer
        }
        guard AudioInput.samplesAreFinite(input) else {
            throw AudioInputError.nonFiniteSamples
        }

        let ratio = outputFormat.sampleRate / input.format.sampleRate
        let estimatedFrames = ceil(Double(input.frameLength) * ratio)
        let headroom = 64.0
        guard estimatedFrames.isFinite,
              estimatedFrames > 0,
              estimatedFrames + headroom
                  <= Double(AudioInput.maxNormalizedFrameCount)
        else {
            throw AudioInputError.invalidBuffer
        }

        // A minimum output size lets short, irregular input chunks also drain
        // output retained from previous calls without an excessive loop count.
        let frameCapacity = max(1_024, AVAudioFrameCount(estimatedFrames + headroom))
        let supplier = AudioConverterInputSupplier(input: input)
        let result = try drain(frameCapacity: frameCapacity, ending: false) { _, status in
            supplier.provide(status)
        }
        // Never silently discard this input just because an earlier chunk
        // filled the output buffer before the converter requested new input.
        guard supplier.didSupplyInput else { throw AudioInputError.conversionFailed }
        return result
    }

    /// Complete a finite stream for native tests. Live microphone callbacks use
    /// convert() and .noDataNow only; stop discards pending audio rather than
    /// flushing it into the Apple analyzer after the user stops listening.
    func finish() throws -> [Float] {
        guard !finished else { return [] }
        let result = try drain(frameCapacity: 4_096, ending: true) { _, status in
            status.pointee = .endOfStream
            return nil
        }
        finished = true
        return result
    }

    private func drain(
        frameCapacity: AVAudioFrameCount, ending: Bool,
        inputBlock: @escaping @Sendable (
            AVAudioPacketCount, UnsafeMutablePointer<AVAudioConverterInputStatus>
        ) -> AVAudioBuffer?
    ) throws -> [Float] {
        guard let output = AVAudioPCMBuffer(
            pcmFormat: outputFormat,
            frameCapacity: frameCapacity
        ) else {
            throw AudioInputError.conversionFailed
        }

        var result: [Float] = []
        // Bound both iterations and aggregate samples, not merely one output
        // buffer. A faulty converter must not spin or accumulate audio forever.
        for _ in 0..<64 {
            output.frameLength = 0
            var conversionError: NSError?
            let status = converter.convert(
                to: output, error: &conversionError, withInputFrom: inputBlock)
            guard conversionError == nil, status != .error,
                  output.frameLength <= output.frameCapacity,
                  result.count + Int(output.frameLength)
                    <= Int(AudioInput.maxNormalizedFrameCount)
            else {
                throw AudioInputError.conversionFailed
            }
            if output.frameLength > 0 {
                guard let channel = output.floatChannelData?[0] else {
                    throw AudioInputError.conversionFailed
                }
                let values = UnsafeBufferPointer(start: channel, count: Int(output.frameLength))
                guard values.allSatisfy(\.isFinite) else {
                    throw AudioInputError.nonFiniteSamples
                }
                result.append(contentsOf: values)
            }
            switch status {
            case .haveData:
                guard output.frameLength > 0 else { throw AudioInputError.conversionFailed }
                // Use the SAME supplier: returning the input again would
                // duplicate audio. It now reports .noDataNow after first use.
                continue
            case .inputRanDry:
                guard !ending else { throw AudioInputError.conversionFailed }
                return result
            case .endOfStream:
                guard ending else { throw AudioInputError.conversionFailed }
                return result
            case .error:
                throw AudioInputError.conversionFailed
            @unknown default:
                throw AudioInputError.conversionFailed
            }
        }
        throw AudioInputError.conversionFailed
    }
}