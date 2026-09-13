//! Explicitly generated paid script audio, using the temporary owner-requested Debug licence toggle.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Child, Stdio},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct AudioState(pub Arc<Mutex<Job>>);
#[derive(Default)]
pub struct Job {
    child: Option<Child>,
    running: bool,
    cancelled: bool,
}

pub(crate) fn paid() -> bool {
    crate::debug_licence::licensed()
}
fn require_paid() -> Result<(), String> {
    if paid() {
        Ok(())
    } else {
        Err("SCRIPT_AUDIO_PAID_REQUIRED: Saved AI audio requires a paid licence. Enable Licensed mode in Settings → Debug to try these features.".into())
    }
}
#[tauri::command]
pub fn script_audio_entitlement() -> Value {
    json!({"paid":paid(), "reason": if paid() { "Debug Licensed mode" } else { "Saved AI audio requires a paid licence. Enable Licensed mode in Settings → Debug to try these features." }})
}
fn identifier(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        Err("Invalid script audio identity.".into())
    } else {
        Ok(())
    }
}
fn script_identity(id: &str) -> Result<(), String> {
    if id.is_empty() || id.chars().count() > 200 {
        Err("Invalid script identity.".into())
    } else {
        Ok(())
    }
}
fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "Could not locate script audio storage.")?
        .join("script-audio-v1"))
}
fn folder(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    script_identity(id)?;
    let root = root(app)?;
    let path = root.join(format!("{:x}", Sha256::digest(id.as_bytes())));
    if root.is_symlink() || path.is_symlink() {
        return Err("Invalid script audio storage.".into());
    }
    Ok(path)
}
fn validate(request: &Value) -> Result<(), String> {
    script_identity(
        request["scriptId"]
            .as_str()
            .ok_or("Script identity missing.")?,
    )?;
    identifier(
        request["revision"]
            .as_str()
            .ok_or("Audio revision missing.")?,
    )?;
    let entries = request["entries"]
        .as_array()
        .ok_or("Spoken passages missing.")?;
    if entries.is_empty()
        || entries.len() > 2000
        || serde_json::to_vec(request)
            .map_err(|_| "Invalid audio request.")?
            .len()
            > 4 * 1024 * 1024
    {
        return Err("Script audio request is too large or empty.".into());
    }
    Ok(())
}
fn worker(app: &AppHandle, mode: &str, request: &Value) -> Result<Value, String> {
    validate(request)?;
    let mut child = crate::turbo::command(app)?
        .arg(mode)
        .arg("--cache-dir")
        .arg(root(app)?)
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|_| "Could not start script audio worker.")?;
    let sent = serde_json::to_writer(
        child
            .stdin
            .take()
            .ok_or("Script audio input unavailable.")?,
        request,
    );
    if sent.is_err() {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Could not send script audio request.".into());
    }
    let output = child
        .wait_with_output()
        .map_err(|_| "Could not read script audio status.")?;
    let value: Value =
        serde_json::from_slice(&output.stdout).map_err(|_| "Invalid script audio status.")?;
    if !output.status.success() {
        return Err(value["message"]
            .as_str()
            .unwrap_or("Could not check script audio.")
            .into());
    }
    Ok(value)
}
#[tauri::command]
pub async fn script_audio_status(app: AppHandle, request: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut status = worker(&app, "--cache-status", &request)?;
        status["hasSavedAudio"] =
            json!(folder(&app, request["scriptId"].as_str().unwrap())?.is_dir());
        // Content-addressed files alone are insufficient: playback needs a committed revision.
        let manifest =
            fs::read(folder(&app, request["scriptId"].as_str().unwrap())?.join("manifest.json"))
                .ok()
                .and_then(|b| serde_json::from_slice::<Value>(&b).ok());
        if manifest.as_ref().map(|m| &m["revision"]) != Some(&request["revision"]) {
            status["status"] = json!("missing");
        }
        Ok(status)
    })
    .await
    .map_err(|_| "Script audio status task failed.".to_string())?
}
#[tauri::command]
pub async fn script_audio_generate(
    app: AppHandle,
    state: tauri::State<'_, AudioState>,
    request: Value,
) -> Result<Value, String> {
    require_paid()?;
    validate(&request)?;
    let shared = Arc::clone(&state.0);
    {
        let mut job = shared
            .lock()
            .map_err(|_| "Audio generation state unavailable.")?;
        if job.running {
            return Err("SCRIPT_AUDIO_BUSY: Audio generation is already running.".into());
        }
        job.running = true;
        job.cancelled = false;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let result = (|| {
            let (mut stdin, stdout) = {
                let mut job = shared
                    .lock()
                    .map_err(|_| "Audio generation state unavailable.")?;
                if job.cancelled {
                    return Err("SCRIPT_AUDIO_CANCELLED: Audio generation cancelled.".into());
                }
                let mut child = crate::turbo::command(&app)?
                    .arg("--generate-batch")
                    .arg("--cache-dir")
                    .arg(root(&app)?)
                    .stdin(Stdio::piped())
                    .spawn()
                    .map_err(|_| "Could not start audio generation.")?;
                let stdin = child
                    .stdin
                    .take()
                    .ok_or("Audio generation input unavailable.")?;
                let stdout = child
                    .stdout
                    .take()
                    .ok_or("Audio generation output unavailable.")?;
                job.child = Some(child);
                (stdin, stdout)
            };
            serde_json::to_writer(&mut stdin, &request)
                .map_err(|_| "Could not send script to audio generator.")?;
            stdin
                .flush()
                .map_err(|_| "Could not send script to audio generator.")?;
            drop(stdin);
            let mut reader = BufReader::new(stdout);
            let mut final_value = None;
            let mut failure = None;
            loop {
                let mut line = String::new();
                let size = reader
                    .by_ref()
                    .take(1024 * 1024 + 1)
                    .read_line(&mut line)
                    .map_err(|_| "Could not read audio progress.")?;
                if size == 0 {
                    break;
                }
                if size > 1024 * 1024 {
                    return Err("Audio response is too large.".into());
                }
                let value: Value =
                    serde_json::from_str(&line).map_err(|_| "Invalid audio progress.")?;
                if value["status"] == "diagnostic" {
                    let _ = app.emit("script-audio-diagnostic", json!({
                        "scriptId": request["scriptId"], "revision": request["revision"],
                        "stage": value["stage"],
                    }));
                }
                if value["status"] == "generating" {
                    let _ = app.emit("script-audio-progress", &value);
                }
                if value["status"] == "ready" {
                    final_value = Some(value.clone());
                }
                if let Some(message) = value["message"].as_str() {
                    failure = Some(format!("{}: {}", value["error"].as_str().unwrap_or("SCRIPT_AUDIO_FAILED"), message));
                }
            }
            let mut job = shared
                .lock()
                .map_err(|_| "Audio generation state unavailable.")?;
            let exit = job
                .child
                .as_mut()
                .ok_or("Audio worker missing.")?
                .wait()
                .map_err(|_| "Audio generation did not finish.")?;
            if job.cancelled {
                return Err("SCRIPT_AUDIO_CANCELLED: Audio generation cancelled.".into());
            }
            if !exit.success() {
                return Err(failure.unwrap_or(
                    "Audio generation failed. Check Chatterbox setup and disk space.".into(),
                ));
            }
            final_value.ok_or("Audio generation did not produce a complete revision.".into())
        })();
        if let Ok(mut job) = shared.lock() {
            if let Some(mut child) = job.child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
            job.running = false;
        }
        result
    })
    .await
    .map_err(|_| "Audio generation task failed.".to_string())?
}
pub fn cancel(state: &AudioState) -> Result<(), String> {
    let mut job = state
        .0
        .lock()
        .map_err(|_| "Audio generation state unavailable.")?;
    job.cancelled = true;
    if let Some(child) = job.child.as_mut() {
        if child
            .try_wait()
            .map_err(|_| "Could not inspect audio generator.")?
            .is_none()
        {
            child
                .kill()
                .map_err(|_| "Could not cancel audio generation.")?;
        }
        child
            .wait()
            .map_err(|_| "Could not confirm audio generation stopped.")?;
    }
    Ok(())
}
#[tauri::command]
pub fn script_audio_cancel(state: tauri::State<'_, AudioState>) -> Result<(), String> {
    cancel(&state)
}
fn manifest(app: &AppHandle, script_id: &str, revision: &str) -> Result<Value, String> {
    identifier(revision)?;
    let path = folder(app, script_id)?.join("manifest.json");
    if path.is_symlink()
        || fs::metadata(&path)
            .map_err(|_| "Generate audio for this script first.")?
            .len()
            > 1024 * 1024
    {
        return Err("Invalid audio manifest.".into());
    }
    let value: Value = serde_json::from_slice(
        &fs::read(path).map_err(|_| "Generate audio for this script first.")?,
    )
    .map_err(|_| "Invalid audio manifest.")?;
    if value["revision"] != revision || value["status"] != "ready" {
        return Err(
            "SCRIPT_AUDIO_STALE: Generate audio for the current script before playback.".into(),
        );
    }
    Ok(value)
}
fn audio_path(app: &AppHandle, script_id: &str, entry: &Value) -> Result<PathBuf, String> {
    let key = entry["key"].as_str().ok_or("Invalid audio entry.")?;
    identifier(key)?;
    let path = folder(app, script_id)?.join(format!("{key}.wav"));
    if path.is_symlink()
        || !path.is_file()
        || fs::metadata(&path)
            .map_err(|_| "Saved audio is unavailable.")?
            .len()
            > 128 * 1024 * 1024
    {
        return Err("Saved audio is unavailable or too large. Generate it again.".into());
    }
    Ok(path)
}
#[tauri::command]
pub async fn script_audio_read(
    app: AppHandle,
    script_id: String,
    revision: String,
    entry_id: String,
) -> Result<Vec<u8>, String> {
    require_paid()?;
    tauri::async_runtime::spawn_blocking(move || {
        let value = manifest(&app, &script_id, &revision)?;
        let entry = value["entries"]
            .as_array()
            .and_then(|entries| entries.iter().find(|e| e["id"] == entry_id))
            .ok_or("This passage has no saved audio.")?;
        fs::read(audio_path(&app, &script_id, entry)?)
            .map_err(|_| "Could not read saved audio.".into())
    })
    .await
    .map_err(|_| "Audio read failed.".to_string())?
}
#[tauri::command]
pub fn script_audio_delete(
    app: AppHandle,
    state: tauri::State<'_, AudioState>,
    script_id: String,
) -> Result<(), String> {
    let job = state.0.lock().map_err(|_| "Audio state unavailable.")?;
    if job.running {
        return Err("Cancel generation before removing saved audio.".into());
    }
    let path = folder(&app, &script_id)?;
    if path.exists() {
        fs::remove_dir_all(path).map_err(|_| "Could not remove saved audio.")?;
    }
    Ok(())
}
// Worker output is PCM16 mono; parse chunks rather than assuming a fixed WAV header.
fn pcm_data(bytes: &[u8]) -> Result<(u32, &[u8]), String> {
    if bytes.len() < 12 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("Saved audio is not a WAV file.".into());
    }
    let mut offset = 12;
    let mut rate = None;
    let mut data = None;
    while offset + 8 <= bytes.len() {
        let size = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
        let start = offset + 8;
        let end = start
            .checked_add(size)
            .filter(|end| *end <= bytes.len())
            .ok_or("Saved WAV is incomplete.")?;
        if &bytes[offset..offset + 4] == b"fmt " {
            if size < 16
                || bytes[start..start + 2] != [1, 0]
                || bytes[start + 2..start + 4] != [1, 0]
                || bytes[start + 14..start + 16] != [16, 0]
            {
                return Err("Saved WAV format is unsupported.".into());
            }
            rate = Some(u32::from_le_bytes(
                bytes[start + 4..start + 8].try_into().unwrap(),
            ));
        }
        if &bytes[offset..offset + 4] == b"data" {
            data = Some(&bytes[start..end]);
        }
        offset = end + (size % 2);
    }
    let rate = rate
        .filter(|r| (8000..=96000).contains(r))
        .ok_or("Saved WAV sample rate is invalid.")?;
    let data = data
        .filter(|d| !d.is_empty() && d.len() % 2 == 0)
        .ok_or("Saved WAV audio is missing.")?;
    Ok((rate, data))
}
fn concatenate(
    app: &AppHandle,
    script_id: &str,
    value: &Value,
    target: &PathBuf,
) -> Result<(), String> {
    let mut output = fs::File::create(target).map_err(|_| "Could not prepare audio export.")?;
    output
        .write_all(&[0; 44])
        .map_err(|_| "Could not prepare audio export.")?;
    let mut sample_rate = None;
    let mut size = 0u32;
    for entry in value["entries"]
        .as_array()
        .ok_or("Audio manifest has no passages.")?
    {
        let bytes = fs::read(audio_path(app, script_id, entry)?)
            .map_err(|_| "Could not read saved audio.")?;
        let (rate, data) = pcm_data(&bytes)?;
        if sample_rate.is_some_and(|r| r != rate) {
            return Err("Audio sample rates differ. Generate the script again.".into());
        }
        sample_rate = Some(rate);
        size = size
            .checked_add(data.len() as u32)
            .filter(|s| *s < 1024 * 1024 * 1024)
            .ok_or("Script audio is too large to export.")?;
        output
            .write_all(data)
            .map_err(|_| "Could not write audio export. Check free disk space.")?;
    }
    let rate = sample_rate.ok_or("No audio to export.")?;
    let mut header = Vec::new();
    header.extend_from_slice(b"RIFF");
    header.extend_from_slice(&(size + 36).to_le_bytes());
    header.extend_from_slice(b"WAVEfmt ");
    header.extend_from_slice(&16u32.to_le_bytes());
    header.extend_from_slice(&1u16.to_le_bytes());
    header.extend_from_slice(&1u16.to_le_bytes());
    header.extend_from_slice(&rate.to_le_bytes());
    header.extend_from_slice(&(rate * 2).to_le_bytes());
    header.extend_from_slice(&2u16.to_le_bytes());
    header.extend_from_slice(&16u16.to_le_bytes());
    header.extend_from_slice(b"data");
    header.extend_from_slice(&size.to_le_bytes());
    use std::io::{Seek, SeekFrom};
    output
        .seek(SeekFrom::Start(0))
        .map_err(|_| "Could not finish WAV export.")?;
    output
        .write_all(&header)
        .map_err(|_| "Could not finish WAV export.")?;
    Ok(())
}
#[tauri::command]
pub async fn script_audio_export(
    app: AppHandle,
    state: tauri::State<'_, AudioState>,
    script_id: String,
    revision: String,
) -> Result<Option<String>, String> {
    require_paid()?;
    let shared = Arc::clone(&state.0);
    {
        let mut job = shared.lock().map_err(|_| "Audio state unavailable.")?;
        if job.running {
            return Err("Wait for audio generation or export to finish.".into());
        }
        job.running = true;
        job.cancelled = false;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut cleanup = Vec::new();
        let result = (|| {
            let value = manifest(&app, &script_id, &revision)?;
            let destination = app
                .dialog()
                .file()
                .set_file_name("Quickque rehearsal.mp4")
                .add_filter("MP4 audio", &["mp4"])
                .blocking_save_file();
            let Some(destination) = destination else {
                return Ok(None);
            };
            let destination = destination
                .into_path()
                .map_err(|_| "Choose a local file for the export.")?;
            if !destination
                .extension()
                .and_then(|s| s.to_str())
                .is_some_and(|s| s.eq_ignore_ascii_case("mp4"))
            {
                return Err("Choose a filename ending in .mp4 for the export.".into());
            }
            // Place temporary output alongside destination so final rename is atomic on that volume.
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| "Could not prepare export.")?
                .as_nanos();
            let temporary = destination.with_file_name(format!(".quickque-{nonce}.mp4"));
            let wav = destination.with_file_name(format!(".quickque-{nonce}.wav"));
            cleanup.push(wav.clone());
            cleanup.push(temporary.clone());
            concatenate(&app, &script_id, &value, &wav)?;
            let helper = std::env::current_exe()
                .map_err(|_| "Could not locate audio exporter.")?
                .parent()
                .ok_or("Could not locate audio exporter.")?
                .join("quickque-audio-export");
            {
                let mut job = shared.lock().map_err(|_| "Audio state unavailable.")?;
                if job.cancelled {
                    return Err("Audio export cancelled.".into());
                }
                job.child = Some(
                    std::process::Command::new(helper)
                        .arg("--input")
                        .arg(&wav)
                        .arg("--output")
                        .arg(&temporary)
                        .stdin(Stdio::null())
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .spawn()
                        .map_err(|_| "This Mac build does not include the MP4 exporter.")?,
                );
            }
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(660);
            loop {
                if std::time::Instant::now() >= deadline {
                    return Err("MP4 export timed out. Try a shorter script.".into());
                }
                {
                    let mut job = shared.lock().map_err(|_| "Audio state unavailable.")?;
                    if job.cancelled {
                        return Err("Audio export cancelled.".into());
                    }
                    if let Some(exit) = job
                        .child
                        .as_mut()
                        .ok_or("Audio exporter missing.")?
                        .try_wait()
                        .map_err(|_| "Could not check audio export.")?
                    {
                        if !exit.success() {
                            return Err(
                                "MP4 export failed. Check free disk space and retry.".into()
                            );
                        }
                        break;
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(30));
            }
            fs::rename(&temporary, &destination).map_err(|_| "Could not save the MP4 export.")?;
            Ok(Some(destination.to_string_lossy().into_owned()))
        })();
        if let Ok(mut job) = shared.lock() {
            if let Some(mut child) = job.child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
            job.running = false;
        }
        for path in cleanup {
            let _ = fs::remove_file(path);
        }
        result
    })
    .await
    .map_err(|_| "Audio export task failed.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identities_cannot_escape_cache() {
        for id in ["", "../other", "a/b", "a\\b", "."] {
            assert!(identifier(id).is_err());
        }
        assert!(identifier("script_123-abc").is_ok());
    }
    #[test]
    fn pcm_parser_handles_padding_and_rejects_unsupported_channels() {
        let mut wav = b"RIFF\0\0\0\0WAVEJUNK\x01\0\0\0x\0fmt \x10\0\0\0\x01\0\x01\0".to_vec();
        wav.extend_from_slice(&24000u32.to_le_bytes());
        wav.extend_from_slice(&48000u32.to_le_bytes());
        wav.extend_from_slice(&[2, 0, 16, 0]);
        wav.extend_from_slice(b"data\x04\0\0\0\x01\x02\x03\x04");
        let (rate, pcm) = pcm_data(&wav).unwrap();
        assert_eq!(rate, 24000);
        assert_eq!(pcm, &[1, 2, 3, 4]);
        wav[32] = 2; // fmt channel count: stereo is not a worker cache format.
        assert!(pcm_data(&wav).is_err());
    }
    #[test]
    fn truncated_wav_is_rejected() {
        assert!(pcm_data(b"RIFF\0\0\0\0WAVEdata\xff\xff\xff\xff").is_err());
        assert!(pcm_data(b"invalid").is_err());
    }
}
