use std::{
    process::Child,
    sync::{Arc, Mutex},
};

#[derive(Default)]
pub(crate) struct SceneSpeechProcess {
    pub(crate) generation: u64,
    pub(crate) cancelled: bool,
    pub(crate) stopping: bool,
    pub(crate) stop_failed: bool,
    pub(crate) child: Option<Arc<Mutex<Child>>>,
}

#[derive(Default)]
pub(crate) struct SceneSpeechState {
    pub(crate) process: Arc<Mutex<SceneSpeechProcess>>,
    /// Serializes start's spawn/write/register critical section with stop. It
    /// is deliberately released before waiting for playback completion.
    pub(crate) spawn_lock: Arc<Mutex<()>>,
}

impl SceneSpeechProcess {
    /// Accept a start only when it is newer than every observed start/stop.
    /// This also makes a stop that reaches Rust before its corresponding start
    /// an irrevocable cancellation rather than an orphaned helper process.
    pub(crate) fn accepts_start(&mut self, request_id: u64) -> bool {
        if self.stop_failed || self.stopping || request_id == 0 || request_id <= self.generation {
            return false;
        }
        self.generation = request_id;
        self.cancelled = false;
        true
    }

    /// Returns false for a stale stop so an old abort cannot stop a newer turn.
    pub(crate) fn accepts_stop(&mut self, request_id: u64) -> bool {
        if request_id < self.generation {
            return false;
        }
        self.generation = request_id;
        self.cancelled = true;
        true
    }

    pub(crate) fn invalidate_all(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.cancelled = true;
    }

    pub(crate) fn can_start_helper(&self, request_id: u64) -> bool {
        self.generation == request_id && !self.cancelled && !self.stopping && !self.stop_failed
    }
}

/// Runs an injected terminator while retaining the child on failure. Callers
/// can reattach it to state and fail closed instead of losing process
/// ownership when an OS kill/wait operation fails.
pub(crate) fn terminate_scene_speech_child<T, F>(
    child: T,
    terminate: F,
) -> Result<(), (T, String)>
where
    F: FnOnce(&T) -> Result<(), String>,
{
    terminate(&child).map_err(|error| (child, error))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stop_before_start_rejects_that_request() {
        let mut state = SceneSpeechProcess::default();
        assert!(state.accepts_stop(7));
        assert!(!state.accepts_start(7));
        assert!(state.accepts_start(8));
    }

    #[test]
    fn stale_stop_cannot_cancel_newer_turn() {
        let mut state = SceneSpeechProcess::default();
        assert!(state.accepts_start(4));
        assert!(state.accepts_start(5));
        assert!(!state.accepts_stop(4));
        assert_eq!(state.generation, 5);
        assert!(!state.cancelled);
    }

    #[test]
    fn shutdown_invalidates_pending_start_and_preserves_child_slot() {
        let mut state = SceneSpeechProcess::default();
        assert!(state.accepts_start(11));
        state.invalidate_all();
        assert!(state.cancelled);
        assert!(!state.accepts_start(11));
        assert!(state.accepts_start(13));
        assert!(state.child.is_none());
    }

    #[test]
    fn injected_termination_returns_child_on_failure() {
        let failure = terminate_scene_speech_child("active-helper", |_| {
            Err("SCENE_SPEECH_STOP_FAILED: forced test failure".to_string())
        });
        assert_eq!(
            failure,
            Err((
                "active-helper",
                "SCENE_SPEECH_STOP_FAILED: forced test failure".to_string(),
            ))
        );
    }

    #[test]
    fn spawn_barrier_blocks_stop_reservation() {
        let state = SceneSpeechState::default();
        let process = state.process.lock().expect("state should lock");
        assert!(process.child.is_none());
        assert!(!process.can_start_helper(1));
        drop(process);
        let reservation = state.spawn_lock.lock().expect("reservation should lock");
        let lock = Arc::clone(&state.spawn_lock);
        let (sender, receiver) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            let _stop_reservation = lock.lock().expect("stop should eventually lock");
            sender.send(()).expect("receiver should remain available");
        });

        assert!(receiver
            .recv_timeout(std::time::Duration::from_millis(25))
            .is_err());
        drop(reservation);
        receiver
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("stop reservation should run after spawn releases");
        worker.join().expect("stop worker should not panic");
    }
}