//! Local, app-private cloned voice recordings.
//!
//! The voice id is metadata only.  Audio is deliberately kept outside script
//! JSON and is never accepted as a path supplied by the webview.  Every read
//! re-checks the recording's digest and duration before it is handed to the
//! Turbo worker.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

pub const ROOT_NAME: &str = "cloned-voices-v1";
pub const LOCAL_VOICE_PREFIX: &str = "chatterbox-local:";
const MAX_NAME_BYTES: usize = 80;
const MAX_RECORDING_BYTES: u64 = 64 * 1024 * 1024;
const MIN_SECONDS: f64 = 5.0;
const MAX_SECONDS: f64 = 10.0;
static NEXT_RECORDING_TOKEN: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceMetadata {
    pub id: String,
    pub name: String,
    pub revision: u64,
    pub duration_seconds: f64,
    pub sample_rate: u32,
    pub recording_sha256: String,
    pub consent_confirmed: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Default)]
pub struct VoiceLibraryState(pub Arc<Mutex<RecordingState>>);

#[derive(Default)]
pub struct RecordingState {
    active: Option<ActiveRecording>,
}

struct ActiveRecording {
    token: String,
    name: String,
    consent_confirmed: bool,
    buffer: Vec<u8>,
}

fn name(value: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.len() > MAX_NAME_BYTES
        || trimmed.chars().any(|c| c.is_control())
    {
        return Err("VOICE_NAME_INVALID: Choose a voice name up to 80 characters.".into());
    }
    Ok(())
}

pub fn id(value: &str) -> Result<(), String> {
    if value.len() != 32
        || !value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        || value == "."
    {
        return Err("VOICE_REFERENCE_INVALID: The local voice reference is invalid.".into());
    }
    Ok(())
}

pub fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| {
            "VOICE_STORAGE_UNAVAILABLE: Could not locate app-private voice storage.".to_string()
        })?
        .join(ROOT_NAME);
    if root.is_symlink() {
        return Err("VOICE_STORAGE_INVALID: Local voice storage is not trusted.".into());
    }
    Ok(root)
}

fn folder(app: &AppHandle, voice_id: &str) -> Result<PathBuf, String> {
    id(voice_id)?;
    let root = root(app)?;
    let folder = root.join(voice_id);
    if folder.is_symlink() {
        return Err("VOICE_STORAGE_INVALID: Local voice storage is not trusted.".into());
    }
    Ok(folder)
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension("partial");
    {
        let mut file = fs::File::create(&temporary).map_err(|_| {
            "VOICE_STORAGE_UNAVAILABLE: Could not prepare local voice metadata.".to_string()
        })?;
        use std::io::Write;
        file.write_all(bytes).map_err(|_| {
            "VOICE_STORAGE_UNAVAILABLE: Could not save local voice metadata.".to_string()
        })?;
        file.sync_all().map_err(|_| {
            "VOICE_STORAGE_UNAVAILABLE: Could not commit local voice metadata.".to_string()
        })?;
    }
    fs::rename(&temporary, path).map_err(|_| {
        "VOICE_STORAGE_UNAVAILABLE: Could not commit local voice metadata.".to_string()
    })
}

/// Return sample rate and PCM bytes.  The worker accepts only this simple
/// format, which also makes duration and integrity checks deterministic.
pub fn pcm_data(bytes: &[u8]) -> Result<(u32, &[u8]), String> {
    if bytes.len() < 12 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("VOICE_RECORDING_INVALID: Record a PCM WAV sample.".into());
    }
    let mut offset = 12usize;
    let mut rate = None;
    let mut channels = None;
    let mut width = None;
    let mut data = None;
    while offset.checked_add(8).is_some_and(|end| end <= bytes.len()) {
        let size = u32::from_le_bytes(
            bytes[offset + 4..offset + 8]
                .try_into()
                .map_err(|_| "VOICE_RECORDING_INVALID: The recording is incomplete.")?,
        ) as usize;
        let start = offset + 8;
        let end = start
            .checked_add(size)
            .filter(|end| *end <= bytes.len())
            .ok_or("VOICE_RECORDING_INVALID: The recording is incomplete.")?;
        match &bytes[offset..offset + 4] {
            b"fmt " if size >= 16 => {
                if bytes[start..start + 2] != [1, 0] {
                    return Err(
                        "VOICE_RECORDING_INVALID: Use an uncompressed PCM recording.".into(),
                    );
                }
                channels = Some(u16::from_le_bytes([bytes[start + 2], bytes[start + 3]]));
                rate = Some(u32::from_le_bytes(
                    bytes[start + 4..start + 8].try_into().unwrap(),
                ));
                width = Some(u16::from_le_bytes([bytes[start + 14], bytes[start + 15]]));
            }
            b"data" => data = Some(&bytes[start..end]),
            _ => {}
        }
        offset = end
            .checked_add(size % 2)
            .ok_or("VOICE_RECORDING_INVALID: The recording is incomplete.")?;
    }
    let rate = rate
        .filter(|rate| (16_000..=48_000).contains(rate))
        .ok_or("VOICE_RECORDING_INVALID: The recording sample rate must be 16–48 kHz.")?;
    if channels != Some(1) || width != Some(16) {
        return Err("VOICE_RECORDING_INVALID: Record a mono 16-bit sample.".into());
    }
    let data = data
        .filter(|data| !data.is_empty() && data.len() % 2 == 0)
        .ok_or("VOICE_RECORDING_INVALID: The recording has no audio data.")?;
    let duration = data.len() as f64 / (rate as f64 * 2.0);
    if !(MIN_SECONDS..=MAX_SECONDS).contains(&duration) {
        return Err(
            "VOICE_RECORDING_DURATION: Record a clean sample between 5 and 10 seconds.".into(),
        );
    }
    Ok((rate, data))
}

fn metadata(path: &Path) -> Result<VoiceMetadata, String> {
    if path.is_symlink()
        || fs::metadata(path)
            .map_err(|_| "VOICE_NOT_FOUND: Local voice was not found.")?
            .len()
            > 64 * 1024
    {
        return Err("VOICE_METADATA_INVALID: Local voice metadata is unavailable.".into());
    }
    serde_json::from_slice(
        &fs::read(path)
            .map_err(|_| "VOICE_METADATA_INVALID: Could not read local voice metadata.")?,
    )
    .map_err(|_| "VOICE_METADATA_INVALID: Local voice metadata is invalid.".into())
}

pub fn resolve_reference(
    app: &AppHandle,
    voice_id: &str,
) -> Result<(VoiceMetadata, PathBuf), String> {
    let id = voice_id
        .strip_prefix(LOCAL_VOICE_PREFIX)
        .ok_or("VOICE_REFERENCE_INVALID: This is not a local cloned voice.")?;
    let folder = folder(app, id)?;
    let metadata = metadata(&folder.join("metadata.json"))?;
    if metadata.id != id || !metadata.consent_confirmed || metadata.revision == 0 {
        return Err("VOICE_CONSENT_REQUIRED: Confirm permission to use this recording.".into());
    }
    let recording = folder.join("reference.wav");
    if recording.is_symlink() || !recording.is_file() {
        return Err("VOICE_RECORDING_MISSING: Re-record this local voice before using it.".into());
    }
    let bytes = fs::read(&recording).map_err(|_| {
        "VOICE_RECORDING_MISSING: The local voice recording is unavailable.".to_string()
    })?;
    let (rate, pcm) = pcm_data(&bytes)?;
    let duration = pcm.len() as f64 / (rate as f64 * 2.0);
    if rate != metadata.sample_rate
        || (duration - metadata.duration_seconds).abs() > 0.01
        || sha256(&bytes) != metadata.recording_sha256
    {
        return Err("VOICE_RECORDING_INTEGRITY: The local voice recording changed or is corrupt. Re-record it.".into());
    }
    Ok((metadata, recording))
}

fn write_voice(
    app: &AppHandle,
    display_name: &str,
    consent: bool,
    bytes: &[u8],
) -> Result<VoiceMetadata, String> {
    name(display_name)?;
    if !consent {
        return Err(
            "VOICE_CONSENT_REQUIRED: Confirm you have permission to use this voice.".into(),
        );
    }
    if bytes.len() as u64 > MAX_RECORDING_BYTES {
        return Err("VOICE_RECORDING_TOO_LARGE: The voice recording is too large.".into());
    }
    let (sample_rate, pcm) = pcm_data(bytes)?;
    let duration_seconds = pcm.len() as f64 / (sample_rate as f64 * 2.0);
    let stamp = now();
    let mut seed = Vec::with_capacity(bytes.len() + display_name.len() + 16);
    seed.extend_from_slice(bytes);
    seed.extend_from_slice(display_name.as_bytes());
    seed.extend_from_slice(&stamp.to_le_bytes());
    let voice_id = format!("{:x}", Sha256::digest(seed))[..32].to_string();
    let root = root(app)?;
    fs::create_dir_all(&root)
        .map_err(|_| "VOICE_STORAGE_UNAVAILABLE: Could not create voice storage.".to_string())?;
    let directory = root.join(&voice_id);
    if directory.exists() {
        return Err("VOICE_STORAGE_CONFLICT: Try saving the recording again.".into());
    }
    let metadata_value = VoiceMetadata {
        id: voice_id.clone(),
        name: display_name.trim().to_owned(),
        revision: 1,
        duration_seconds,
        sample_rate,
        recording_sha256: sha256(bytes),
        consent_confirmed: true,
        created_at: stamp,
        updated_at: stamp,
    };
    let staging = root.join(format!(".{voice_id}.partial"));
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|_| {
            "VOICE_STORAGE_UNAVAILABLE: Could not clear an incomplete recording.".to_string()
        })?;
    }
    fs::create_dir(&staging).map_err(|_| {
        "VOICE_STORAGE_UNAVAILABLE: Could not prepare local voice storage.".to_string()
    })?;
    let result = (|| {
        let recording = staging.join("reference.wav");
        atomic_write(&recording, bytes).map_err(|_| {
            "VOICE_STORAGE_UNAVAILABLE: Could not save the voice recording.".to_string()
        })?;
        let metadata_bytes = serde_json::to_vec_pretty(&metadata_value).map_err(|_| {
            "VOICE_METADATA_INVALID: Could not encode local voice metadata.".to_string()
        })?;
        atomic_write(&staging.join("metadata.json"), &metadata_bytes)?;
        fs::File::open(&recording)
            .and_then(|file| file.sync_all())
            .map_err(|_| {
                "VOICE_STORAGE_UNAVAILABLE: Could not commit the complete voice recording."
                    .to_string()
            })?;
        fs::rename(&staging, &directory).map_err(|_| {
            "VOICE_STORAGE_UNAVAILABLE: Could not commit the complete voice recording.".to_string()
        })?;
        let _ = fs::File::open(&root).and_then(|directory| directory.sync_all());
        Ok(metadata_value)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

pub fn list(app: &AppHandle) -> Result<Vec<VoiceMetadata>, String> {
    let root = root(app)?;
    if !root.exists() {
        return Ok(vec![]);
    }
    if !root.is_dir() {
        return Err("VOICE_STORAGE_INVALID: Local voice storage is not a directory.".into());
    }
    let mut voices = Vec::new();
    for entry in fs::read_dir(root)
        .map_err(|_| "VOICE_STORAGE_UNAVAILABLE: Could not list local voices.".to_string())?
    {
        let entry = entry
            .map_err(|_| "VOICE_STORAGE_UNAVAILABLE: Could not list local voices.".to_string())?;
        if !entry
            .file_type()
            .map_err(|_| "VOICE_STORAGE_INVALID: Invalid local voice entry.".to_string())?
            .is_dir()
            || entry.file_name().to_string_lossy().starts_with('.')
        {
            continue;
        }
        voices.push(metadata(&entry.path().join("metadata.json"))?);
    }
    voices.sort_by_key(|voice| voice.name.to_lowercase());
    Ok(voices)
}

#[tauri::command]
pub fn voice_library_list(app: AppHandle) -> Result<Vec<VoiceMetadata>, String> {
    list(&app)
}

#[tauri::command]
pub fn voice_library_create(
    app: AppHandle,
    name: String,
    consent_confirmed: bool,
    recording: Vec<u8>,
) -> Result<VoiceMetadata, String> {
    write_voice(&app, &name, consent_confirmed, &recording)
}

#[tauri::command]
pub fn voice_library_rename(
    app: AppHandle,
    voice_id: String,
    name: String,
) -> Result<VoiceMetadata, String> {
    name(&name)?;
    let folder = folder(&app, &voice_id)?;
    let mut voice = metadata(&folder.join("metadata.json"))?;
    voice.name = name.trim().to_owned();
    voice.revision = voice
        .revision
        .checked_add(1)
        .ok_or("VOICE_METADATA_INVALID: Voice revision exhausted.")?;
    voice.updated_at = now();
    atomic_write(
        &folder.join("metadata.json"),
        &serde_json::to_vec_pretty(&voice).map_err(|_| {
            "VOICE_METADATA_INVALID: Could not encode local voice metadata.".to_string()
        })?,
    )
    .map_err(|_| "VOICE_STORAGE_UNAVAILABLE: Could not rename local voice.".to_string())?;
    Ok(voice)
}

#[tauri::command]
pub fn voice_library_rerecord(
    app: AppHandle,
    voice_id: String,
    consent_confirmed: bool,
    recording: Vec<u8>,
) -> Result<VoiceMetadata, String> {
    if !consent_confirmed {
        return Err(
            "VOICE_CONSENT_REQUIRED: Confirm you have permission to use this voice.".into(),
        );
    }
    if recording.len() as u64 > MAX_RECORDING_BYTES {
        return Err("VOICE_RECORDING_TOO_LARGE: The voice recording is too large.".into());
    }
    let folder = folder(&app, &voice_id)?;
    let mut voice = metadata(&folder.join("metadata.json"))?;
    let (sample_rate, pcm) = pcm_data(&recording)?;
    let duration_seconds = pcm.len() as f64 / (sample_rate as f64 * 2.0);
    let recording_path = folder.join("reference.wav");
    atomic_write(&recording_path, &recording)?;
    voice.sample_rate = sample_rate;
    voice.duration_seconds = duration_seconds;
    voice.recording_sha256 = sha256(&recording);
    voice.consent_confirmed = true;
    voice.revision = voice
        .revision
        .checked_add(1)
        .ok_or("VOICE_METADATA_INVALID: Voice revision exhausted.")?;
    voice.updated_at = now();
    atomic_write(
        &folder.join("metadata.json"),
        &serde_json::to_vec_pretty(&voice).map_err(|_| {
            "VOICE_METADATA_INVALID: Could not encode local voice metadata.".to_string()
        })?,
    )?;
    Ok(voice)
}

#[tauri::command]
pub fn voice_library_delete(app: AppHandle, voice_id: String) -> Result<(), String> {
    let folder = folder(&app, &voice_id)?;
    if folder.exists() {
        fs::remove_dir_all(folder)
            .map_err(|_| "VOICE_STORAGE_UNAVAILABLE: Could not delete local voice.".to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn voice_library_read_recording(app: AppHandle, voice_id: String) -> Result<Vec<u8>, String> {
    let (_, path) = resolve_reference(&app, &format!("{LOCAL_VOICE_PREFIX}{voice_id}"))?;
    fs::read(path)
        .map_err(|_| "VOICE_RECORDING_MISSING: The local voice recording is unavailable.".into())
}

#[tauri::command]
pub fn voice_recording_begin(
    state: tauri::State<'_, VoiceLibraryState>,
    name: String,
    consent_confirmed: bool,
) -> Result<Value, String> {
    name(&name)?;
    if !consent_confirmed {
        return Err(
            "VOICE_CONSENT_REQUIRED: Confirm you have permission to use this voice.".into(),
        );
    }
    let sequence = NEXT_RECORDING_TOKEN.fetch_add(1, Ordering::Relaxed);
    let token = format!(
        "{:x}",
        Sha256::digest(format!("{}-{}-{}", name, now(), sequence).as_bytes())
    )[..32]
        .to_string();
    let mut recording = state.0.lock().map_err(|_| {
        "VOICE_RECORDING_STATE_UNAVAILABLE: Recording state is unavailable.".to_string()
    })?;
    if recording.active.is_some() {
        return Err("VOICE_RECORDING_BUSY: Finish or cancel the current recording first.".into());
    }
    recording.active = Some(ActiveRecording {
        token: token.clone(),
        name,
        consent_confirmed,
        buffer: Vec::new(),
    });
    Ok(json!({"token": token, "minimumSeconds": MIN_SECONDS, "maximumSeconds": MAX_SECONDS}))
}

#[tauri::command]
pub fn voice_recording_append(
    state: tauri::State<'_, VoiceLibraryState>,
    token: String,
    chunk: Vec<u8>,
) -> Result<Value, String> {
    let mut recording = state.0.lock().map_err(|_| {
        "VOICE_RECORDING_STATE_UNAVAILABLE: Recording state is unavailable.".to_string()
    })?;
    let active = recording
        .active
        .as_mut()
        .ok_or("VOICE_RECORDING_NOT_ACTIVE: Start a voice recording first.")?;
    if active.token != token {
        return Err("VOICE_RECORDING_TOKEN: This recording is no longer active.".into());
    }
    if active.buffer.len().saturating_add(chunk.len()) as u64 > MAX_RECORDING_BYTES {
        return Err("VOICE_RECORDING_TOO_LARGE: The voice recording is too large.".into());
    }
    active.buffer.extend_from_slice(&chunk);
    Ok(json!({"receivedBytes": active.buffer.len()}))
}

#[tauri::command]
pub fn voice_recording_commit(
    app: AppHandle,
    state: tauri::State<'_, VoiceLibraryState>,
    token: String,
    recording: Option<Vec<u8>>,
) -> Result<VoiceMetadata, String> {
    let mut guard = state.0.lock().map_err(|_| {
        "VOICE_RECORDING_STATE_UNAVAILABLE: Recording state is unavailable.".to_string()
    })?;
    let active = guard
        .active
        .take()
        .ok_or("VOICE_RECORDING_NOT_ACTIVE: Start a voice recording first.")?;
    if active.token != token {
        guard.active = Some(active);
        return Err("VOICE_RECORDING_TOKEN: This recording is no longer active.".into());
    }
    let bytes = recording.unwrap_or(active.buffer);
    let result = write_voice(&app, &active.name, active.consent_confirmed, &bytes);
    if result.is_err() {
        guard.active = Some(ActiveRecording {
            token: active.token,
            name: active.name,
            consent_confirmed: active.consent_confirmed,
            buffer: bytes,
        });
    }
    result
}

#[tauri::command]
pub fn voice_recording_cancel(
    state: tauri::State<'_, VoiceLibraryState>,
    token: Option<String>,
) -> Result<(), String> {
    let mut recording = state.0.lock().map_err(|_| {
        "VOICE_RECORDING_STATE_UNAVAILABLE: Recording state is unavailable.".to_string()
    })?;
    if let Some(active) = recording.active.as_ref() {
        if token.as_deref().is_some_and(|token| token != active.token) {
            return Err("VOICE_RECORDING_TOKEN: This recording is no longer active.".into());
        }
    }
    recording.active = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav(seconds: f64, rate: u32) -> Vec<u8> {
        let samples = (seconds * rate as f64) as usize;
        let data_len = samples * 2;
        let mut out = Vec::with_capacity(data_len + 44);
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&((36 + data_len) as u32).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * 2).to_le_bytes());
        out.extend_from_slice(&2u16.to_le_bytes());
        out.extend_from_slice(&16u16.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&(data_len as u32).to_le_bytes());
        out.resize(44 + data_len, 0);
        out
    }

    #[test]
    fn recording_bounds_and_format_are_enforced() {
        assert!(pcm_data(&wav(4.99, 16_000)).is_err());
        assert!(pcm_data(&wav(5.0, 16_000)).is_ok());
        assert!(pcm_data(&wav(10.01, 16_000)).is_err());
    }

    #[test]
    fn references_are_confined_to_hex_ids() {
        for value in ["", "../secret", "abc", "a/b", "chatterbox-local:abc"] {
            assert!(id(value).is_err());
        }
        assert!(id(&"a".repeat(32)).is_ok());
    }
}
