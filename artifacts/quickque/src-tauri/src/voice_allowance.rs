//! Active microphone allowance is independent of helper restarts and UI timers.
use std::time::{Duration, Instant};
const FREE_ALLOWANCE: Duration = Duration::from_secs(30);
#[derive(Default)]
pub struct VoiceAllowance {
    session: String,
    used: Duration,
    started: Option<Instant>,
    unlimited: bool,
}
impl VoiceAllowance {
    pub fn session(&mut self, id: &str, unlimited: bool, now: Instant) {
        self.pause(now);
        if self.session != id {
            self.session = id.to_owned();
            self.used = Duration::ZERO;
        }
        self.unlimited = unlimited;
    }
    pub fn set_unlimited(&mut self, unlimited: bool) { self.unlimited = unlimited; }
    pub fn start(&mut self, now: Instant) {
        if self.started.is_none() { self.started = Some(now); }
    }
    pub fn pause(&mut self, now: Instant) {
        if let Some(started) = self.started.take() {
            self.used = self.used.saturating_add(now.saturating_duration_since(started));
        }
    }
    pub fn remaining(&self, now: Instant) -> Option<Duration> {
        if self.unlimited { return None; }
        let active = self.started.map(|start| now.saturating_duration_since(start)).unwrap_or_default();
        Some(FREE_ALLOWANCE.saturating_sub(self.used.saturating_add(active)))
    }
    pub fn expired(&self, now: Instant) -> bool { self.remaining(now) == Some(Duration::ZERO) }
    pub fn running(&self) -> bool { self.started.is_some() }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pause_and_helper_restart_do_not_reset_allowance() {
        let now = Instant::now(); let mut a = VoiceAllowance::default();
        a.session("one", false, now); a.start(now);
        a.pause(now + Duration::from_secs(12));
        a.session("one", false, now + Duration::from_secs(100));
        assert_eq!(a.remaining(now + Duration::from_secs(100)), Some(Duration::from_secs(18)));
        a.start(now + Duration::from_secs(100));
        assert!(a.expired(now + Duration::from_secs(118)));
        a.pause(now + Duration::from_secs(118));
        a.start(now + Duration::from_secs(200));
        assert!(a.expired(now + Duration::from_secs(200)));
    }
    #[test]
    fn loading_silence_stop_and_partner_turns_do_not_consume_paused_time() {
        let now = Instant::now(); let mut a = VoiceAllowance::default();
        a.session("one", false, now);
        assert_eq!(a.remaining(now + Duration::from_secs(500)), Some(Duration::from_secs(30)));
        a.start(now); a.start(now + Duration::from_secs(10));
        a.pause(now + Duration::from_secs(15));
        assert_eq!(a.remaining(now + Duration::from_secs(500)), Some(Duration::from_secs(15)));
    }
    #[test]
    fn debug_toggle_changes_access_without_resetting_used_time() {
        let now = Instant::now(); let mut a = VoiceAllowance::default();
        a.session("one", false, now); a.start(now);
        a.set_unlimited(true);
        assert!(!a.expired(now + Duration::from_secs(40)));
        a.set_unlimited(false);
        assert!(a.expired(now + Duration::from_secs(40)));
    }
    #[test]
    fn new_reader_session_gets_fresh_allowance_and_paid_is_unlimited() {
        let now = Instant::now(); let mut a = VoiceAllowance::default();
        a.session("one", false, now); a.start(now);
        a.session("two", false, now + Duration::from_secs(40));
        assert_eq!(a.remaining(now + Duration::from_secs(40)), Some(Duration::from_secs(30)));
        a.session("two", true, now + Duration::from_secs(40)); a.start(now);
        assert_eq!(a.remaining(now + Duration::from_secs(500)), None);
        a.session("two", false, now + Duration::from_secs(500));
        assert!(a.expired(now + Duration::from_secs(500)));
    }
}
