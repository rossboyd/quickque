use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnonymousAnalyticsEvent {
    event: String,
    app_surface: Option<String>,
    script_purpose: Option<String>,
    creation_source: Option<String>,
    voice_mode: Option<String>,
    script_word_count: Option<u32>,
    active_seconds: Option<u32>,
}

fn endpoint() -> Option<String> {
    if let Some(value) =
        option_env!("QUICKQUE_ANALYTICS_SERVER").filter(|value| value.starts_with("https://"))
    {
        return Some(value.to_string());
    }
    let licences = option_env!("QUICKQUE_LICENCE_SERVER")?;
    let base = licences.strip_suffix("/licences")?;
    Some(format!("{base}/analytics/events"))
}

fn valid(event: &AnonymousAnalyticsEvent) -> bool {
    matches!(
        event.event.as_str(),
        "app_open" | "script_created" | "voice_used" | "reading_session"
    ) && event
        .app_surface
        .as_deref()
        .is_none_or(|value| matches!(value, "mac" | "browser"))
        && event
            .script_purpose
            .as_deref()
            .is_none_or(|value| matches!(value, "presentation" | "performance"))
        && event
            .creation_source
            .as_deref()
            .is_none_or(|value| matches!(value, "blank" | "sample" | "duplicate" | "import"))
        && event
            .voice_mode
            .as_deref()
            .is_none_or(|value| matches!(value, "voice_follow" | "scene_partner" | "chatterbox"))
        && event
            .script_word_count
            .is_none_or(|value| value <= 1_000_000)
        && event.active_seconds.is_none_or(|value| value <= 86_400)
}

#[tauri::command]
pub async fn record_anonymous_analytics_event(
    event: AnonymousAnalyticsEvent,
) -> Result<(), String> {
    if !valid(&event) {
        return Err("Invalid anonymous analytics metadata.".into());
    }
    let Some(url) = endpoint() else {
        return Ok(());
    };
    tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(|_| "Analytics connection unavailable.")?;
        client
            .post(url)
            .json(&event)
            .send()
            .map_err(|_| "Analytics connection unavailable.")?;
        Ok(())
    })
    .await
    .map_err(|_| "Analytics task failed.".to_string())?
}