import Foundation
import XCTest
@preconcurrency import AVFoundation
@testable import QuickqueFlow

private actor PipelineEventRecorder {
    private var events: [PipelineEvent] = []

    func append(_ batch: [PipelineEvent]) {
        events.append(contentsOf: batch)
    }

    func count() -> Int {
        events.count
    }

    func snapshot() -> [PipelineEvent] {
        events
    }
}

final class AudioPipelineTests: XCTestCase {
    func testAudioLevelUsesRMSDecibelsAndExactZeroForSilence() throws {
        XCTAssertEqual(
            try XCTUnwrap(AudioLevelMeter.normalizedLevel(for: [0, 0, 0])),
            0
        )
        XCTAssertEqual(
            try XCTUnwrap(
                AudioLevelMeter.normalizedLevel(for: [0.5, 0.5, 0.5, 0.5])
            ),
            (20 * log10(0.5) - AudioLevelMeter.silenceDecibels)
                / -AudioLevelMeter.silenceDecibels,
            accuracy: 0.000_001
        )
        XCTAssertEqual(
            try XCTUnwrap(AudioLevelMeter.normalizedLevel(for: [1, -1])),
            1
        )
    }

    func testAudioLevelRejectsEmptyAndNonFiniteSamples() {
        XCTAssertNil(AudioLevelMeter.normalizedLevel(for: []))
        XCTAssertNil(AudioLevelMeter.normalizedLevel(for: [.nan]))
        XCTAssertNil(AudioLevelMeter.normalizedLevel(for: [.infinity]))
    }

    func testAudioLevelTelemetryCannotCreateQueueGapOrDisplaceCriticalEvents() async {
        let recorder = PipelineEventRecorder()
        let bridge = PipelineEventBridge { batch in
            await recorder.append(batch)
        }
        let session = UUID()
        for _ in 0..<256 {
            bridge.submit(PipelineEvent(
                session: session,
                kind: .diagnostic(.audioBufferReceived)
            ))
        }
        bridge.submit(PipelineEvent(session: session, kind: .audioLevel(0.75)))
        bridge.start()

        for _ in 0..<100 {
            if await recorder.count() == 256 {
                break
            }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        bridge.close()

        let events = await recorder.snapshot()
        XCTAssertEqual(events.count, 256)
        XCTAssertTrue(events.allSatisfy {
            if case .diagnostic(.audioBufferReceived) = $0.kind {
                return true
            }
            return false
        })
    }

    func testCriticalEventEvictsPendingLevelAtQueueCapacity() async {
        let recorder = PipelineEventRecorder()
        let bridge = PipelineEventBridge { batch in
            await recorder.append(batch)
        }
        let session = UUID()
        for _ in 0..<255 {
            bridge.submit(PipelineEvent(
                session: session,
                kind: .diagnostic(.audioBufferReceived)
            ))
        }
        bridge.submit(PipelineEvent(session: session, kind: .audioLevel(0.75)))
        bridge.submit(PipelineEvent(
            session: session,
            kind: .diagnostic(.audioConversionBegin)
        ))
        bridge.start()

        for _ in 0..<100 {
            if await recorder.count() == 256 {
                break
            }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        bridge.close()

        let events = await recorder.snapshot()
        XCTAssertEqual(events.count, 256)
        for (index, event) in events.enumerated() {
            guard case .diagnostic(let stage) = event.kind else {
                return XCTFail("Telemetry or a gap displaced a critical event.")
            }
            if index < 255 {
                XCTAssertEqual(stage, .audioBufferReceived)
            } else {
                XCTAssertEqual(stage, .audioConversionBegin)
            }
        }
    }

    func testPendingAudioLevelsCoalesceToNewestTelemetry() async {
        let recorder = PipelineEventRecorder()
        let bridge = PipelineEventBridge { batch in
            await recorder.append(batch)
        }
        let session = UUID()
        bridge.submit(PipelineEvent(session: session, kind: .audioLevel(0.1)))
        bridge.submit(PipelineEvent(session: session, kind: .audioLevel(0.9)))
        bridge.start()

        for _ in 0..<100 {
            if await recorder.count() == 1 {
                break
            }
            try? await Task.sleep(nanoseconds: 1_000_000)
        }
        bridge.close()

        let events = await recorder.snapshot()
        guard events.count == 1 else {
            return XCTFail("Expected one coalesced audio level event.")
        }
        guard case .audioLevel(let level) = events[0].kind else {
            return XCTFail("Expected the coalesced event to be audio level telemetry.")
        }
        XCTAssertEqual(level, 0.9)
    }

    func testNormalizedRingKeepsNewestFramesAndReportsDiscontinuity() async {
        let ring = NormalizedPCMRing()
        let initial = (0..<NormalizedPCMRing.capacity).map { Float($0) }
        XCTAssertEqual(ring.append(initial), 0)

        let newestRange = NormalizedPCMRing.capacity..<(NormalizedPCMRing.capacity + 100)
        let newest = newestRange.map { Float($0) }
        XCTAssertEqual(ring.append(newest), 100)

        guard case .discontinuity(let epoch) = await ring.nextWork() else {
            return XCTFail("A normalized drop must precede the next recognition window.")
        }
        ring.acknowledgeDiscontinuity(epoch)

        guard case .window(let firstWindow, let windowEpoch) = await ring.nextWork() else {
            return XCTFail("The ring did not produce a complete 200 ms window.")
        }
        XCTAssertEqual(windowEpoch, epoch)
        XCTAssertEqual(firstWindow.first, 100)
        XCTAssertEqual(firstWindow.last, 3_299)
    }

    func testRawAndNormalizedBatchConstantsAreBounded() {
        XCTAssertEqual(NormalizedPCMRing.windowSize, 3_200)
        XCTAssertEqual(NormalizedPCMRing.capacity, 80_000)
        XCTAssertLessThanOrEqual(
            NormalizedPCMRing.capacity * MemoryLayout<Float>.size,
            320 * 1024
        )
    }

    func testDiscontinuityWakesAnEmptyRingBeforeNewAudio() async {
        let ring = NormalizedPCMRing()
        ring.requestDiscontinuity()
        guard case .discontinuity(let epoch) = await ring.nextWork() else {
            return XCTFail("Raw capture loss must wake the serial worker.")
        }
        XCTAssertEqual(epoch, ring.currentEpoch)
        ring.acknowledgeDiscontinuity(epoch)
        ring.stop()
        guard case .stopped = await ring.nextWork() else {
            return XCTFail("Stopped sessions must not drain stale normalized audio.")
        }
    }

    func testClassifierProgressIsOrderedAndOnlyClassifiedTimeAdvancesSilence() {
        var timeline = AudioTimelinePolicy()
        timeline.recordCaptured(end: 8)
        XCTAssertTrue(timeline.classifierIsStalled())
        XCTAssertFalse(timeline.shouldStopSilence(afterWallSeconds: 32))

        timeline.recordClassification(end: 1, speech: true)
        XCTAssertEqual(timeline.lastSpeechEnd, 1)
        XCTAssertFalse(timeline.shouldStopSilence(afterWallSeconds: 30))

        timeline.recordClassification(end: 33, speech: false)
        XCTAssertTrue(timeline.shouldStopSilence(afterWallSeconds: 33))
    }

    func testDelayedClassifierCannotCreateFalseQuietStop() {
        var timeline = AudioTimelinePolicy()
        timeline.recordCaptured(end: 35)
        XCTAssertTrue(timeline.classifierIsStalled())
        XCTAssertFalse(timeline.shouldStopSilence(afterWallSeconds: 35))

        timeline.recordClassification(end: 2, speech: true)
        XCTAssertFalse(timeline.shouldStopSilence(afterWallSeconds: 35))
    }

    func testHealthyClassifierLagStillStopsAfterClassifiedSilence() {
        var timeline = AudioTimelinePolicy()
        timeline.recordCaptured(end: 33)
        timeline.recordClassification(end: 32, speech: false)
        XCTAssertFalse(timeline.classifierIsStalled())
        XCTAssertTrue(timeline.shouldStopSilence(afterWallSeconds: 33))

        timeline.recordClassification(end: 33, speech: true)
        timeline.recordCaptured(end: 64)
        timeline.recordClassification(end: 63, speech: false)
        XCTAssertTrue(timeline.shouldStopSilence(afterWallSeconds: 64))
    }

    func testAnalyzerConverterUsesCanonicalBuffersWithoutModels() throws {
        let format = try XCTUnwrap(AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: 16_000,
            channels: 1,
            interleaved: false
        ))
        let converter = try AnalyzerAudioConverter(analyzerFormat: format)
        let inputs = try converter.convert((0..<3_200).map { Float($0) / 3_200 })
        XCTAssertEqual(inputs.count, 1)
        XCTAssertEqual(inputs[0].buffer.frameLength, 3_200)
        XCTAssertNil(inputs[0].bufferStartTime)
    }

    func testDroppedFramesUseActualPCMRateAndLengthNotChannelsOrCapacity() throws {
        for sampleRate in [8_000.0, 16_000.0, 24_000.0, 44_100.0, 48_000.0] {
            for channels in [AVAudioChannelCount(1), AVAudioChannelCount(2)] {
                let format = try XCTUnwrap(AVAudioFormat(
                    commonFormat: .pcmFormatFloat32,
                    sampleRate: sampleRate,
                    channels: channels,
                    interleaved: false
                ))
                let frames = AVAudioFrameCount(sampleRate / 5)
                let buffer = try XCTUnwrap(AVAudioPCMBuffer(
                    pcmFormat: format,
                    frameCapacity: frames * 2
                ))
                buffer.frameLength = frames
                XCTAssertEqual(
                    AudioPipeline.normalizedDroppedFrames(for: buffer),
                    3_200,
                    "200 ms must count as 3,200 normalized frames at \(sampleRate) Hz / \(channels) channels"
                )
            }
        }
    }

    func testAnalyzerConverterDrainsPersistentResamplingContinuously() throws {
        let analyzerFormat = try XCTUnwrap(AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: 8_000,
            channels: 1,
            interleaved: false
        ))
        let converter = try AnalyzerAudioConverter(analyzerFormat: analyzerFormat)
        let first = try converter.convert((0..<3_200).map { _ in Float(0.1) })
        let second = try converter.convert((0..<3_200).map { _ in Float(0.2) })
        let totalFrames = (first + second).reduce(0) {
            $0 + Int($1.buffer.frameLength)
        }
        // 6,400 / 16,000 = 0.4 seconds. Live conversion can retain its
        // filter tail: interruption intentionally does not flush it into ASR.
        XCTAssertEqual(Double(totalFrames) / 8_000, 0.4, accuracy: 0.05)
    }

    func testLocaleMatchingNormalizesBCP47Separators() {
        XCTAssertTrue(flowLocaleMatches(
            Locale(identifier: "en_US"),
            Locale(identifier: "EN-us")
        ))
        XCTAssertFalse(flowLocaleMatches(
            Locale(identifier: "en-GB"),
            Locale(identifier: "en-US")
        ))
    }

}