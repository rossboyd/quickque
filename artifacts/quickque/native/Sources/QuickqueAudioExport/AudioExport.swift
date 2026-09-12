@preconcurrency import AVFoundation
import Foundation

enum AudioExportError: LocalizedError {
    case invalid(String)
    var errorDescription: String? {
        switch self { case .invalid(let message): return message }
    }
}

/// Converts the assembled rehearsal WAV into a genuine audio-only MP4 with AAC audio.
/// The caller owns concatenation, entitlement checks and the final destination move.
func exportAudio(input: URL, output: URL) async throws {
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
    guard let track = try await asset.loadTracks(withMediaType: .audio).first else {
        throw AudioExportError.invalid("Input has no audio track.")
    }
    let reader = try AVAssetReader(asset: asset)
    let readerOutput = AVAssetReaderTrackOutput(track: track, outputSettings: [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVLinearPCMBitDepthKey: 16,
        AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false,
        AVLinearPCMIsNonInterleaved: false,
    ])
    readerOutput.alwaysCopiesSampleData = false
    guard reader.canAdd(readerOutput) else {
        throw AudioExportError.invalid("Cannot decode the cached audio.")
    }
    reader.add(readerOutput)
    let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
    var completed = false
    defer {
        if !completed {
            reader.cancelReading()
            writer.cancelWriting()
            try? FileManager.default.removeItem(at: output)
        }
    }
    let writerInput = AVAssetWriterInput(mediaType: .audio, outputSettings: [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: format.sampleRate,
        AVNumberOfChannelsKey: Int(format.channelCount),
        AVEncoderBitRateKey: format.channelCount == 1 ? 96_000 : 128_000,
    ])
    writerInput.expectsMediaDataInRealTime = false
    guard writer.canAdd(writerInput) else {
        throw AudioExportError.invalid("Cannot encode this audio format as AAC.")
    }
    writer.add(writerInput)
    guard writer.startWriting() else {
        throw writer.error ?? AudioExportError.invalid("Cannot start MP4 export.")
    }
    writer.startSession(atSourceTime: .zero)
    guard reader.startReading() else {
        throw reader.error ?? AudioExportError.invalid("Cannot read cached audio.")
    }
    let deadline = ContinuousClock.now.advanced(by: .seconds(600))
    while reader.status == .reading {
        try Task.checkCancellation()
        guard ContinuousClock.now < deadline else {
            throw AudioExportError.invalid("Audio export timed out.")
        }
        guard writer.status == .writing else {
            throw writer.error ?? AudioExportError.invalid("MP4 export stopped unexpectedly.")
        }
        if !writerInput.isReadyForMoreMediaData {
            try await Task.sleep(for: .milliseconds(2))
            continue
        }
        guard let sample = readerOutput.copyNextSampleBuffer() else { break }
        guard writerInput.append(sample) else {
            throw writer.error ?? AudioExportError.invalid("Could not write AAC audio.")
        }
    }
    guard reader.status == .completed else {
        throw reader.error ?? AudioExportError.invalid("Cached audio could not be read completely.")
    }
    writerInput.markAsFinished()
    await writer.finishWriting()
    guard writer.status == .completed else {
        throw writer.error ?? AudioExportError.invalid("Could not finish MP4 export.")
    }
    completed = true
}

@main
struct AudioExportCommand {
    static func main() async {
        do {
            let args = Array(CommandLine.arguments.dropFirst())
            guard args.count == 4, args[0] == "--input", args[2] == "--output" else {
                throw AudioExportError.invalid("Usage: quickque-audio-export --input <audio.wav> --output <new.mp4>")
            }
            try await exportAudio(input: URL(fileURLWithPath: args[1]), output: URL(fileURLWithPath: args[3]))
        } catch {
            FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
            exit(1)
        }
    }
}
