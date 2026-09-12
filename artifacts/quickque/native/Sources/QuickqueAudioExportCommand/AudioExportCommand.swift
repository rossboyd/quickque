import Foundation
import QuickqueAudioExportCore

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