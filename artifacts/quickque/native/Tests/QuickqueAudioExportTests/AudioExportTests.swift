@preconcurrency import AVFoundation
import XCTest
@testable import QuickqueAudioExport

final class AudioExportTests: XCTestCase {
    func testExportsPlayableAACInMP4AndProtectsExistingDestination() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let input = directory.appendingPathComponent("script.wav")
        let output = directory.appendingPathComponent("script.mp4")
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 24_000, channels: 1))
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 24_000))
        buffer.frameLength = 24_000
        let samples = try XCTUnwrap(buffer.floatChannelData?[0])
        for index in 0..<24_000 {
            samples[index] = Float(sin(Double(index) * 2 * .pi * 440 / 24_000)) * 0.1
        }
        // Close the WAV before passing it to the exporter.
        do {
            let file = try AVAudioFile(forWriting: input, settings: format.settings)
            try file.write(from: buffer)
        }
        try await exportAudio(input: input, output: output)
        let asset = AVURLAsset(url: output)
        let duration = try await asset.load(.duration)
        XCTAssertEqual(duration.seconds, 1, accuracy: 0.1)
        let tracks = try await asset.loadTracks(withMediaType: .audio)
        XCTAssertEqual(tracks.count, 1)
        let descriptions = try await XCTUnwrap(tracks.first).load(.formatDescriptions)
        XCTAssertEqual(CMFormatDescriptionGetMediaSubType(try XCTUnwrap(descriptions.first)), kAudioFormatMPEG4AAC)
        let original = try Data(contentsOf: output)
        XCTAssertEqual(String(decoding: original[4..<8], as: UTF8.self), "ftyp")
        do {
            try await exportAudio(input: input, output: output)
            XCTFail("An existing export must not be overwritten")
        } catch {
            XCTAssertEqual(try Data(contentsOf: output), original)
        }
    }
}
