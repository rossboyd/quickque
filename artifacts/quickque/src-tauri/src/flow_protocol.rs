/// Commands resolved by the desktop bridge must never reach a new helper.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum FlowRoute {
    Status(&'static str),
    Helper { loading: bool },
}

pub(crate) fn route(action: &str) -> Option<FlowRoute> {
    match action {
        "pause" => Some(FlowRoute::Status("paused")),
        "stop" => Some(FlowRoute::Status("stopped")),
        // Reaping the previous process ends Quickque's wait. Apple may continue
        // an explicitly requested system-managed asset download independently.
        "cancelDownload" => Some(FlowRoute::Status("needs-model")),
        "status" => Some(FlowRoute::Helper { loading: true }),
        "download" | "start" => Some(FlowRoute::Helper { loading: false }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancellation_returns_needs_model_without_starting_a_helper() {
        assert_eq!(route("cancelDownload"), Some(FlowRoute::Status("needs-model")));
        assert_eq!(route("pause"), Some(FlowRoute::Status("paused")));
        assert_eq!(route("stop"), Some(FlowRoute::Status("stopped")));
    }

    #[test]
    fn every_forwarded_action_is_recognized_by_the_swift_helper() {
        let swift = include_str!("../../native/Sources/QuickqueFlow/FlowService.swift");
        for action in ["status", "download", "start"] {
            assert!(matches!(route(action), Some(FlowRoute::Helper { .. })));
            assert!(swift.contains(&format!("case \"{action}\":")));
        }
        assert_eq!(route("status"), Some(FlowRoute::Helper { loading: true }));
        assert_eq!(route("download"), Some(FlowRoute::Helper { loading: false }));
        assert_eq!(route("start"), Some(FlowRoute::Helper { loading: false }));
    }

    #[test]
    fn unknown_actions_are_not_forwarded() {
        assert_eq!(route(""), None);
        assert_eq!(route("unknown"), None);
    }
}