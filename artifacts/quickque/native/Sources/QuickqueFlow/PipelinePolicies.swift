import Foundation

/// Small, framework-independent state used by the activity watchdog. Sound
/// Analysis callbacks are allowed to arrive later than captured input, so
/// only classified timeline time can advance the silence clock.
struct AudioTimelinePolicy: Sendable, Equatable {
    private(set) var classifiedEnd = 0.0
    private(set) var capturedEnd = 0.0
    private(set) var lastSpeechEnd: Double?

    mutating func recordClassification(end: Double, speech: Bool) {
        guard end.isFinite, end >= 0 else { return }
        classifiedEnd = max(classifiedEnd, end)
        if speech {
            lastSpeechEnd = max(lastSpeechEnd ?? 0, end)
        }
    }

    mutating func recordCaptured(end: Double) {
        guard end.isFinite, end >= 0 else { return }
        capturedEnd = max(capturedEnd, end)
    }

    func classifierIsStalled(threshold: Double = 5) -> Bool {
        capturedEnd - classifiedEnd > threshold
    }

    /// A missing or delayed classifier result never advances this clock. The
    /// captured-vs-classified watchdog reports a stall separately.
    func shouldStopSilence(afterWallSeconds elapsed: Double) -> Bool {
        guard elapsed.isFinite, elapsed >= 30 else { return false }
        guard let lastSpeechEnd else {
            return classifiedEnd >= 30
        }
        return classifiedEnd - lastSpeechEnd >= 30
    }
}

