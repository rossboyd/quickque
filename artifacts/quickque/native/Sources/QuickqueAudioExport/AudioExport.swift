@preconcurrency import AVFoundation
import Foundation

public enum AudioExportError: LocalizedError {
    case invalid(String)
    public var errorDescription: String? {
        switch self { case .invalid(let message): return message }
    }
}

/// Converts the assembled rehearsal WAV into a genuine audio-only MP4 with AAC audio.
/// The caller owns concatenation, entitlement checks and the final destination move.
public func exportAudio(input: URL, output: URL) async throws {
    guard input.standardizedFileURL != output.standardizedFileURL,
          !FileManager.default.fileExists(atPath: output.path) else {
        throw AudioExportError.invalid("Export destination already exists.")
    }
    let source = try AVAudioFile(forReading: input)
    let format = source.processingFormat
    guard source.length > 0, (1...2).contains(Int(format.channelCount)) else {
        throw AudioExportError.invalid("Expected a non-empty mono or stereo audio file.")
    }
    let asset = AVURLAsset(url: input)
    guard try await asset.loadTracks(withMediaType: .audio).first != nil else {
        throw AudioExportError.invalid("Input has no audio track.")
    }
    guard let exporter = AVAssetExportSession(
        asset: asset,
        presetName: AVAssetExportPresetAppleM4A
    ) else {
        throw AudioExportError.invalid("Cannot create the AAC audio exporter.")
    }
    let temporaryOutput = output
        .deletingLastPathComponent()
        .appendingPathComponent(".\(UUID().uuidString).m4a")
    var completed = false
    defer {
        if !completed {
            try? FileManager.default.removeItem(at: temporaryOutput)
        }
    }
    try await exporter.export(to: temporaryOutput, as: .m4a)
    try Task.checkCancellation()
    try FileManager.default.moveItem(at: temporaryOutput, to: output)
    completed = true
}
