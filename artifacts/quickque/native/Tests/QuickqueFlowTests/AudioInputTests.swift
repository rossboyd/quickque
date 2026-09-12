@preconcurrency import AVFoundation
import Dispatch
import Foundation
import XCTest
@testable import QuickqueFlow

private final class TestBufferBox: @unchecked Sendable {
    let value: AVAudioPCMBuffer

    init(_ value: AVAudioPCMBuffer) {
        self.value = value
    }
}

private actor TapRecorder {
    private var session: UUID?
    private var captured: SendableAudioBuffer?

    func receive(_ value: SendableAudioBuffer) {
        session = value.session
        captured = value
    }

    func snapshot() -> (UUID?, [Float]) {
        guard let buffer = captured?.value,
              let channel = buffer.floatChannelData?[0]
        else {
            return (session, [])
        }
        // Inspect the retained buffer after the source has been overwritten;
        // eagerly copying to an array in receive() would hide aliasing bugs.
        let samples = Array(
            UnsafeBufferPointer(start: channel, count: Int(buffer.frameLength))
        )
        return (session, samples)
    }
}

private actor TapBuilder {
    func makeTap(
        queue: BoundedAudioQueue,
        session: UUID,
        consume: @escaping @Sendable (SendableAudioBuffer) async -> Void,
        overflow: @escaping @Sendable () async -> Void,
        invalid: @escaping @Sendable () async -> Void
    ) -> @Sendable (AVAudioPCMBuffer, AVAudioTime) -> Void {
        AudioInput.makeTap(
            queue: queue,
            session: session,
            consume: consume,
            overflow: overflow,
            invalid: invalid
        )
    }
}

private actor CallbackLatch {
    private var complete = false

    func markComplete() {
        complete = true
    }

    func isComplete() -> Bool {
        complete
    }
}

final class AudioInputTests: XCTestCase {
    func testTapCopiesOnAConcurrentCallbackAndPreservesSession() async throws {
        let recorder = TapRecorder()
        let builder = TapBuilder()
        let queue = BoundedAudioQueue(capacity: 4)
        let session = UUID()
        let consume: @Sendable (SendableAudioBuffer) async -> Void = { value in
            await recorder.receive(value)
        }
        let overflow: @Sendable () async -> Void = {}
        let invalid: @Sendable () async -> Void = {}
        let tap = await builder.makeTap(
            queue: queue,
            session: session,
            consume: consume,
            overflow: overflow,
            invalid: invalid
        )

        let sourceValues = [Float](repeating: 0.25, count: 12_288)
        let source = try makeFloatBuffer(
            sampleRate: 48_000,
            channels: 1,
            frameLength: AVAudioFrameCount(sourceValues.count),
            interleaved: false,
            values: [sourceValues]
        )
        let sourceBox = TestBufferBox(source)
        let callbackLatch = CallbackLatch()
        DispatchQueue.global(qos: .userInitiated).async {
            tap(
                sourceBox.value,
                AVAudioTime(sampleTime: 0, atRate: 48_000)
            )
            Task {
                await callbackLatch.markComplete()
            }
        }

        let callbackFinished = await waitForCallback(callbackLatch)
        XCTAssertTrue(callbackFinished)

        // The callback has already returned, so this mutation can only affect
        // the original buffer if the tap failed to make a deep copy.
        overwrite(source, with: -0.75)
        var received: (UUID?, [Float]) = (nil, [])
        for _ in 0..<200 {
            received = await recorder.snapshot()
            if received.0 != nil {
                break
            }
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        XCTAssertEqual(received.0, session)
        XCTAssertEqual(received.1.count, sourceValues.count)
        XCTAssertTrue(received.1.allSatisfy { $0 == 0.25 })
    }

    func testCopySupportsMonoStereoPlanarAndInterleavedAndRejectsShortBytes() throws {
        let mono = try makeFloatBuffer(
            sampleRate: 48_000,
            channels: 1,
            frameLength: 4,
            interleaved: false,
            values: [[0.1, 0.2, 0.3, 0.4]],
            extraCapacity: 4
        )
        let stereoPlanar = try makeFloatBuffer(
            sampleRate: 48_000,
            channels: 2,
            frameLength: 4,
            interleaved: false,
            values: [
                [0.1, 0.2, 0.3, 0.4],
                [0.5, 0.6, 0.7, 0.8],
            ]
        )
        let stereoInterleaved = try makeFloatBuffer(
            sampleRate: 48_000,
            channels: 2,
            frameLength: 4,
            interleaved: true,
            values: [
                [0.1, 0.2, 0.3, 0.4],
                [0.5, 0.6, 0.7, 0.8],
            ]
        )

        let cases: [(AVAudioPCMBuffer, [[Float]])] = [
            (mono, [[0.1, 0.2, 0.3, 0.4]]),
            (
                stereoPlanar,
                [
                    [0.1, 0.2, 0.3, 0.4],
                    [0.5, 0.6, 0.7, 0.8],
                ]
            ),
            (
                stereoInterleaved,
                [
                    [0.1, 0.2, 0.3, 0.4],
                    [0.5, 0.6, 0.7, 0.8],
                ]
            ),
        ]
        for (source, expected) in cases {
            guard let copy = AudioInput.copyBuffer(source) else {
                XCTFail("valid \(source.format) buffer was rejected")
                continue
            }
            XCTAssertEqual(copy.frameLength, source.frameLength)
            XCTAssertEqual(copy.frameCapacity, source.frameLength)
            XCTAssertEqual(readFloatSamples(copy), expected)
            let list = UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList)
            let expectedBytes = UInt32(source.frameLength)
                * source.format.streamDescription.pointee.mBytesPerFrame
            XCTAssertTrue(list.allSatisfy { $0.mDataByteSize == expectedBytes })
        }

        let malformed = try makeFloatBuffer(
            sampleRate: 48_000,
            channels: 1,
            frameLength: 4,
            interleaved: false,
            values: [[0.1, 0.2, 0.3, 0.4]]
        )
        // mutableAudioBufferList describes frameCapacity. Re-reading that
        // managed view can restore its byte sizes, so mutating it is not a
        // reliable malformed-input fixture. Test the production storage guard
        // with a descriptor VALUE that AVFoundation cannot rebuild.
        var descriptor = UnsafeMutableAudioBufferListPointer(
            malformed.mutableAudioBufferList)[0]
        XCTAssertTrue(AudioInput.hasValidStorage(descriptor, byteCount: 16, channelCount: 1))
        descriptor.mDataByteSize = 15
        XCTAssertFalse(AudioInput.hasValidStorage(descriptor, byteCount: 16, channelCount: 1),
            "The production copy guard must reject a descriptor one byte too short.")
        descriptor.mDataByteSize = 16
        descriptor.mNumberChannels = 2
        XCTAssertFalse(AudioInput.hasValidStorage(descriptor, byteCount: 16, channelCount: 1))
        descriptor.mNumberChannels = 1
        descriptor.mData = nil
        XCTAssertFalse(AudioInput.hasValidStorage(descriptor, byteCount: 16, channelCount: 1))

        malformed.frameLength = 0
        XCTAssertNil(AudioInput.copyBuffer(malformed), "An empty input must not be enqueued.")
    }

    func testNormalizerAccumulates48KOutputAcrossChunksAndFinish() throws {
        let inputFormat = try makeFormat(
            sampleRate: 48_000,
            channels: 1,
            interleaved: false
        )
        let normalizer = try AudioNormalizer(inputFormat: inputFormat)
        let first = try makeFloatBuffer(
            sampleRate: 48_000,
            channels: 1,
            frameLength: 48_000,
            interleaved: false,
            values: [[Float](repeating: 0.2, count: 48_000)]
        )
        let second = try makeFloatBuffer(
            sampleRate: 48_000,
            channels: 1,
            frameLength: 44_100,
            interleaved: false,
            values: [[Float](repeating: -0.2, count: 44_100)]
        )

        let firstOutput = try normalizer.convert(first)
        let secondOutput = try normalizer.convert(second)
        let endOutput = try normalizer.finish()
        let output = firstOutput + secondOutput + endOutput
        let expectedCount = Int(
            (Double(first.frameLength + second.frameLength) * 16_000 / 48_000).rounded()
        )
        // The finite-stream endpoint can round by a few output frames. This
        // deliberately applies only to the accumulated stream, not each call.
        let edgeAllowance = 4
        XCTAssertLessThan(
            0,
            firstOutput.count,
            "The first 48 kHz chunk produced no output before EOS."
        )
        XCTAssertLessThanOrEqual(
            abs(output.count - expectedCount),
            edgeAllowance,
            "48 kHz stream emitted \(output.count) frames; expected \(expectedCount) "
                + "± \(edgeAllowance)."
        )
        XCTAssertTrue(output.allSatisfy(\.isFinite))
    }

    func testNormalizerAccepts44100HzStereoAndFinishesExpectedDuration() throws {
        let frameCount: AVAudioFrameCount = 11_290
        let input = try makeFloatBuffer(
            sampleRate: 44_100, channels: 2, frameLength: frameCount,
            interleaved: false,
            values: [
                [Float](repeating: 0.1, count: Int(frameCount)),
                [Float](repeating: 0.3, count: Int(frameCount)),
            ])
        let normalizer = try AudioNormalizer(inputFormat: input.format)
        let converted = try normalizer.convert(input)
        let endOutput = try normalizer.finish()
        let output = converted + endOutput
        let expectedCount = Int(
            (Double(frameCount) * 16_000 / 44_100).rounded()
        )
        // 44.1 kHz -> 16 kHz is fractional at this endpoint; allow only a
        // few rounded frames after accumulating the converter's finite stream.
        let edgeAllowance = 4
        XCTAssertLessThanOrEqual(
            abs(output.count - expectedCount),
            edgeAllowance,
            "44.1 kHz stereo stream emitted \(output.count) frames; expected "
                + "\(expectedCount) ± \(edgeAllowance)."
        )
        XCTAssertTrue(output.allSatisfy(\.isFinite))
    }

    func testNormalizer44100StereoSineIsChunkingStableAndStreamsBeforeEOS() throws {
        let sampleRate = 44_100.0
        let totalFrames = 44_100
        let samples = makeStereoSineSamples(
            frameCount: totalFrames,
            sampleRate: sampleRate
        )
        let contiguousInput = try makeFloatBuffer(
            sampleRate: sampleRate,
            channels: 2,
            frameLength: AVAudioFrameCount(totalFrames),
            interleaved: false,
            values: samples
        )
        let contiguousNormalizer = try AudioNormalizer(
            inputFormat: contiguousInput.format
        )
        var contiguousOutput = try contiguousNormalizer.convert(contiguousInput)
        contiguousOutput.append(contentsOf: try contiguousNormalizer.finish())

        let chunkedNormalizer = try AudioNormalizer(inputFormat: contiguousInput.format)
        // Exercise tiny callback fragments as well as realistic 512 ms and
        // 256 ms buffers. The values are input frames at 44.1 kHz.
        let chunkSizes = [
            17,
            333,
            Int(sampleRate * 0.512),
            Int(sampleRate * 0.256),
        ]
        var chunkedOutput = [Float]()
        var offset = 0
        var chunkIndex = 0
        var outputAt512Milliseconds: Int?
        let warmupInputFrames = Int(sampleRate * 0.512)
        while offset < totalFrames {
            let requestedSize = chunkSizes[chunkIndex % chunkSizes.count]
            let frameLength = min(requestedSize, totalFrames - offset)
            let end = offset + frameLength
            let chunk = try makeFloatBuffer(
                sampleRate: sampleRate,
                channels: 2,
                frameLength: AVAudioFrameCount(frameLength),
                interleaved: false,
                values: [
                    Array(samples[0][offset..<end]),
                    Array(samples[1][offset..<end]),
                ]
            )
            chunkedOutput.append(contentsOf: try chunkedNormalizer.convert(chunk))
            offset = end
            chunkIndex += 1
            if outputAt512Milliseconds == nil, offset >= warmupInputFrames {
                outputAt512Milliseconds = chunkedOutput.count
            }
        }
        XCTAssertEqual(
            offset,
            totalFrames,
            "Irregular chunks covered \(offset) input frames; expected \(totalFrames)."
        )
        chunkedOutput.append(contentsOf: try chunkedNormalizer.finish())

        let warmupOutputCount = outputAt512Milliseconds ?? 0
        XCTAssertGreaterThan(
            warmupOutputCount,
            0,
            "No normalized output was produced within the first 512 ms of input."
        )
        let warmupPeak = chunkedOutput.prefix(warmupOutputCount).reduce(Float.zero) {
            max($0, abs($1))
        }
        XCTAssertGreaterThan(
            warmupPeak,
            0.001,
            "Output before EOS was present but numerically silent."
        )

        let expectedCount = Int(
            (Double(totalFrames) * 16_000 / sampleRate).rounded()
        )
        // Keep this endpoint allowance small: a 44.1 kHz second is exactly
        // 16,000 output frames, so a first-call-sized tolerance would hide
        // dropped or indefinitely deferred converter output.
        let edgeAllowance = 4
        for (label, output) in [
            ("contiguous", contiguousOutput),
            ("chunked", chunkedOutput),
        ] {
            XCTAssertLessThanOrEqual(
                abs(output.count - expectedCount),
                edgeAllowance,
                "\(label) stream emitted \(output.count) frames; expected "
                    + "\(expectedCount) ± \(edgeAllowance)."
            )
            XCTAssertTrue(
                output.allSatisfy(\.isFinite),
                "\(label) stream produced a non-finite sample."
            )
        }
        XCTAssertLessThanOrEqual(
            abs(contiguousOutput.count - chunkedOutput.count),
            edgeAllowance,
            "Contiguous emitted \(contiguousOutput.count) frames but irregular "
                + "chunks emitted \(chunkedOutput.count)."
        )

        let comparedCount = min(contiguousOutput.count, chunkedOutput.count)
        guard comparedCount > 0 else {
            return XCTFail("The two finite streams had no samples to compare.")
        }
        var totalAbsoluteError = 0.0
        var maximumAbsoluteError = 0.0
        for index in 0..<comparedCount {
            let error = abs(
                Double(contiguousOutput[index]) - Double(chunkedOutput[index])
            )
            totalAbsoluteError += error
            maximumAbsoluteError = max(maximumAbsoluteError, error)
        }
        let meanAbsoluteError = totalAbsoluteError / Double(comparedCount)
        XCTAssertLessThan(
            meanAbsoluteError,
            0.01,
            "Chunking mean absolute sample error was \(meanAbsoluteError)."
        )
        XCTAssertLessThan(
            maximumAbsoluteError,
            0.1,
            "Chunking maximum absolute sample error was \(maximumAbsoluteError)."
        )
    }

    func testNormalizerFinishIsIdempotentAndRejectsInputAfterEOS() throws {
        let input = try makeFloatBuffer(
            sampleRate: 48_000,
            channels: 1,
            frameLength: 12_288,
            interleaved: false,
            values: [[Float](repeating: 0.2, count: 12_288)]
        )
        let normalizer = try AudioNormalizer(inputFormat: input.format)
        let converted = try normalizer.convert(input)
        let firstFinish = try normalizer.finish()
        let secondFinish = try normalizer.finish()

        XCTAssertTrue(
            (converted + firstFinish).allSatisfy(\.isFinite),
            "Finite input produced a non-finite normalized sample."
        )
        XCTAssertTrue(
            secondFinish.isEmpty,
            "A second finish() must be an empty, idempotent EOS drain."
        )

        let inputAfterEOS = try makeFloatBuffer(
            sampleRate: 48_000,
            channels: 1,
            frameLength: 256,
            interleaved: false,
            values: [[Float](repeating: -0.2, count: 256)]
        )
        XCTAssertThrowsError(try normalizer.convert(inputAfterEOS)) { error in
            XCTAssertEqual(error as? AudioInputError, .conversionFailed)
        }
    }

    func testRejectsMoreThanOneSecondOfAudioInATap() throws {
        let input = try makeFloatBuffer(
            sampleRate: 16_000, channels: 1, frameLength: 16_001,
            interleaved: false,
            values: [[Float](repeating: 0.1, count: 16_001)])
        XCTAssertNil(AudioInput.copyBuffer(input))
    }

    func testNormalizerRejectsRouteChangesAndNonFiniteSamples() throws {
        let inputFormat = try makeFormat(
            sampleRate: 48_000,
            channels: 1,
            interleaved: false
        )
        let normalizer = try AudioNormalizer(inputFormat: inputFormat)
        let changedRoute = try makeFloatBuffer(
            sampleRate: 44_100,
            channels: 1,
            frameLength: 4_410,
            interleaved: false,
            values: [[Float](repeating: 0.1, count: 4_410)]
        )
        XCTAssertThrowsError(try normalizer.convert(changedRoute)) { error in
            guard let audioError = error as? AudioInputError else {
                return XCTFail("unexpected error type: \(error)")
            }
            XCTAssertEqual(audioError, .routeChanged)
            XCTAssertEqual(
                audioError.errorDescription,
                "The microphone format changed while Flow was running. Stop and restart Flow."
            )
        }

        var nonFiniteValues = [Float](repeating: 0.1, count: 128)
        nonFiniteValues[31] = .nan
        let nonFinite = try makeFloatBuffer(
            sampleRate: 48_000,
            channels: 1,
            frameLength: AVAudioFrameCount(nonFiniteValues.count),
            interleaved: false,
            values: [nonFiniteValues]
        )
        XCTAssertThrowsError(try normalizer.convert(nonFinite)) { error in
            XCTAssertEqual(error as? AudioInputError, .nonFiniteSamples)
        }
    }
}

private func makeFormat(
    sampleRate: Double,
    channels: AVAudioChannelCount,
    interleaved: Bool
) throws -> AVAudioFormat {
    guard let format = AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate: sampleRate,
        channels: channels,
        interleaved: interleaved
    ) else {
        throw AudioInputError.invalidFormat
    }
    return format
}

private func makeFloatBuffer(
    sampleRate: Double,
    channels: AVAudioChannelCount,
    frameLength: AVAudioFrameCount,
    interleaved: Bool,
    values: [[Float]],
    extraCapacity: AVAudioFrameCount = 0
) throws -> AVAudioPCMBuffer {
    let format = try makeFormat(
        sampleRate: sampleRate,
        channels: channels,
        interleaved: interleaved
    )
    guard values.count == Int(channels),
          values.allSatisfy({ $0.count == Int(frameLength) }),
          let buffer = AVAudioPCMBuffer(
              pcmFormat: format,
              frameCapacity: frameLength + extraCapacity
          )
    else {
        throw AudioInputError.invalidBuffer
    }
    buffer.frameLength = frameLength

    let list = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
    let bytesPerFrame = Int(format.streamDescription.pointee.mBytesPerFrame)
    for bufferIndex in 0..<list.count {
        let audioBuffer = list[bufferIndex]
        guard let data = audioBuffer.mData else {
            throw AudioInputError.invalidBuffer
        }
        let channelCount = Int(audioBuffer.mNumberChannels)
        for frame in 0..<Int(frameLength) {
            for channel in 0..<channelCount {
                let sourceChannel = interleaved
                    ? channel
                    : bufferIndex
                let offset = frame * bytesPerFrame + channel * MemoryLayout<Float>.size
                var sample = values[sourceChannel][frame]
                memcpy(
                    data.advanced(by: offset),
                    &sample,
                    MemoryLayout<Float>.size
                )
            }
        }
    }
    return buffer
}

private func makeStereoSineSamples(
    frameCount: Int,
    sampleRate: Double
) -> [[Float]] {
    let left = (0..<frameCount).map { frame in
        Float(
            0.35 * sin(
                2.0 * Double.pi * 440.0 * Double(frame) / sampleRate
            )
        )
    }
    let right = (0..<frameCount).map { frame in
        Float(
            0.23 * sin(
                2.0 * Double.pi * 997.0 * Double(frame) / sampleRate + 0.31
            )
        )
    }
    return [left, right]
}

private func readFloatSamples(_ buffer: AVAudioPCMBuffer) -> [[Float]] {
    let format = buffer.format
    let list = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
    let bytesPerFrame = Int(format.streamDescription.pointee.mBytesPerFrame)
    var values = Array(
        repeating: [Float](),
        count: Int(format.channelCount)
    )
    for bufferIndex in 0..<list.count {
        let audioBuffer = list[bufferIndex]
        guard let data = audioBuffer.mData else {
            continue
        }
        let channelCount = Int(audioBuffer.mNumberChannels)
        for frame in 0..<Int(buffer.frameLength) {
            for channel in 0..<channelCount {
                var sample = Float.zero
                let offset = frame * bytesPerFrame + channel * MemoryLayout<Float>.size
                memcpy(
                    &sample,
                    data.advanced(by: offset),
                    MemoryLayout<Float>.size
                )
                let outputChannel = format.isInterleaved ? channel : bufferIndex
                values[outputChannel].append(sample)
            }
        }
    }
    return values
}

private func overwrite(_ buffer: AVAudioPCMBuffer, with value: Float) {
    let list = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
    let bytesPerFrame = Int(buffer.format.streamDescription.pointee.mBytesPerFrame)
    for index in 0..<list.count {
        guard let data = list[index].mData else {
            continue
        }
        let channels = Int(list[index].mNumberChannels)
        for frame in 0..<Int(buffer.frameLength) {
            for channel in 0..<channels {
                var sample = value
                let offset = frame * bytesPerFrame + channel * MemoryLayout<Float>.size
                memcpy(
                    data.advanced(by: offset),
                    &sample,
                    MemoryLayout<Float>.size
                )
            }
        }
    }
}

private func waitForCallback(_ latch: CallbackLatch) async -> Bool {
    for _ in 0..<200 {
        if await latch.isComplete() {
            return true
        }
        try? await Task.sleep(nanoseconds: 1_000_000)
    }
    return false
}