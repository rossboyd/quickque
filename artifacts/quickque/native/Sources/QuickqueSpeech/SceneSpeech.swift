import AVFoundation
import Darwin
import Foundation

private struct SpeechRequest: Decodable {
    let text: String
    let voiceId: String
    let rate: Float
}

private struct LocalVoice: Encodable {
    let id: String
    let name: String
    let language: String
    let engine = "system"
}

private enum SpeechHelperError: LocalizedError {
    case usage
    case requestInvalid
    case textEmpty
    case textTooLong
    case voiceUnavailable
    case voiceIdentityConflict
    case rateInvalid
    case cancelled
    case timeout

    var code: String {
        switch self {
        case .usage: "SCENE_SPEECH_USAGE"
        case .requestInvalid: "SCENE_SPEECH_REQUEST_INVALID"
        case .textEmpty: "SCENE_SPEECH_TEXT_EMPTY"
        case .textTooLong: "SCENE_SPEECH_TEXT_TOO_LONG"
        case .voiceUnavailable: "SCENE_SPEECH_VOICE_UNAVAILABLE"
        case .voiceIdentityConflict: "SCENE_SPEECH_VOICE_ID_CONFLICT"
        case .rateInvalid: "SCENE_SPEECH_RATE_INVALID"
        case .cancelled: "SCENE_SPEECH_CANCELLED"
        case .timeout: "SCENE_SPEECH_TIMEOUT"
        }
    }

    var errorDescription: String? {
        switch self {
        case .usage:
            "The local speech helper received an unsupported command."
        case .requestInvalid:
            "The local speech helper received an invalid request."
        case .textEmpty:
            "Scene speech needs dialogue text to speak."
        case .textTooLong:
            "This dialogue turn is too long for one speech request."
        case .voiceUnavailable:
            "The selected system voice is not installed or is unavailable."
        case .voiceIdentityConflict:
            "macOS reported duplicate or incomplete system voice identifiers."
        case .rateInvalid:
            "The requested system speech rate is unavailable."
        case .cancelled:
            "Scene speech was cancelled."
        case .timeout:
            "System speech did not finish before its safety timeout."
        }
    }
}

private final class SpeechDelegate: NSObject, AVSpeechSynthesizerDelegate, @unchecked Sendable {
    private enum Result: Equatable {
        case pending
        case finished
        case cancelled
    }

    private let lock = NSLock()
    private var result: Result = .pending

    func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didFinish utterance: AVSpeechUtterance
    ) {
        lock.lock()
        result = .finished
        lock.unlock()
    }

    func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didCancel utterance: AVSpeechUtterance
    ) {
        lock.lock()
        result = .cancelled
        lock.unlock()
    }

    func waitForResult(until deadline: Date) throws {
        while resultSnapshot() == .pending {
            if Date() >= deadline {
                throw SpeechHelperError.timeout
            }
            RunLoop.current.run(
                mode: .default,
                before: min(deadline, Date().addingTimeInterval(0.1))
            )
        }
        if resultSnapshot() == .cancelled {
            throw SpeechHelperError.cancelled
        }
    }

    private func resultSnapshot() -> Result {
        lock.lock()
        defer { lock.unlock() }
        return result
    }
}

private func emit(_ value: Any) {
    guard JSONSerialization.isValidJSONObject(value),
          let data = try? JSONSerialization.data(withJSONObject: value),
          let text = String(data: data, encoding: .utf8)
    else { return }
    FileHandle.standardOutput.write(Data((text + "\n").utf8))
}

private func fail(_ error: SpeechHelperError) -> Never {
    emit(["error": error.code, "message": error.localizedDescription])
    exit(1)
}

private func listVoices() {
    let voices = AVSpeechSynthesisVoice.speechVoices()
    var seen = Set<String>()
    let result = voices.compactMap { voice -> LocalVoice? in
        // identifier is Apple's stable voice identifier. It is intentionally
        // preserved exactly and never reconstructed from a display name.
        guard !voice.identifier.isEmpty,
              !voice.name.isEmpty,
              !voice.language.isEmpty,
              seen.insert(voice.identifier).inserted
        else { return nil }
        return LocalVoice(
            id: voice.identifier,
            name: voice.name,
            language: voice.language
        )
    }
    guard seen.count == voices.filter({ !$0.identifier.isEmpty }).count else {
        fail(.voiceIdentityConflict)
    }
    emit(["voices": result.map {
        ["id": $0.id, "name": $0.name, "language": $0.language, "engine": $0.engine]
    }])
}

private func readRequest() throws -> SpeechRequest {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard !input.isEmpty else { throw SpeechHelperError.requestInvalid }
    return try JSONDecoder().decode(SpeechRequest.self, from: input)
}

private func speak() throws {
    let request = try readRequest()
    guard !request.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        throw SpeechHelperError.textEmpty
    }
    guard request.text.utf8.count <= 100_000 else {
        throw SpeechHelperError.textTooLong
    }
    guard request.rate.isFinite, (0.5...2.0).contains(request.rate)
    else {
        throw SpeechHelperError.rateInvalid
    }
    let installed = AVSpeechSynthesisVoice.speechVoices()
    guard let voice = installed.first(where: { $0.identifier == request.voiceId }) else {
        throw SpeechHelperError.voiceUnavailable
    }

    let synthesizer = AVSpeechSynthesizer()
    let delegate = SpeechDelegate()
    synthesizer.delegate = delegate
    let utterance = AVSpeechUtterance(string: request.text)
    // The voice object came from the installed list above. AVFoundation gets
    // the exact object, so it cannot choose a display-name or locale fallback.
    utterance.voice = voice
    // The scene UI stores a 0.5×...2× multiplier. AVFoundation expects an
    // absolute rate, so retain the platform's default as the 1× reference
    // rather than treating the user-facing multiplier as raw words/second.
    let systemRate = AVSpeechUtteranceDefaultSpeechRate * request.rate
    guard systemRate >= AVSpeechUtteranceMinimumSpeechRate,
          systemRate <= AVSpeechUtteranceMaximumSpeechRate
    else {
        throw SpeechHelperError.rateInvalid
    }
    utterance.rate = systemRate
    // `speak(_:)` is a Void API. Voice identity was checked against
    // `speechVoices()` above; completion/cancellation is reported by delegate.
    synthesizer.speak(utterance)

    let seconds = min(900.0, max(30.0, Double(request.text.count) * 1.5 + 10.0))
    try delegate.waitForResult(until: Date().addingTimeInterval(seconds))
    emit(["status": "finished"])
}

@main
private struct QuickqueSpeech {
    static func main() {
        do {
            switch CommandLine.arguments.dropFirst().first {
            case "--list":
                listVoices()
            case "--speak":
                try speak()
            default:
                fail(.usage)
            }
        } catch let error as SpeechHelperError {
            fail(error)
        } catch {
            fail(.requestInvalid)
        }
    }
}