use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::sync_channel,
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

const CONFIG_FORMAT: &str = "com.quickque.local-library.config";
const DOCUMENT_FORMAT: &str = "com.quickque.local-library";
const FORMAT_VERSION: u32 = 1;
const MAX_LIBRARY_BYTES: usize = 8 * 1024 * 1024;
const MAX_CONFIG_BYTES: usize = 16 * 1024;
const MAX_SECTION_NOTES_CHARS: usize = 500_000;
const LIBRARY_FILE_PREFIX: &str = "quickque-library-";
const LIBRARY_FILE_SUFFIX: &str = ".json";
const MAX_TEMP_ATTEMPTS: u32 = 32;
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
pub struct LocalLibraryState {
    operation_lock: Mutex<()>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLibrary {
    pub directory: Option<String>,
    pub scripts_json: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalLibraryConfig {
    format: String,
    version: u32,
    directory: String,
    file_name: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct LocalLibraryDocument {
    format: String,
    version: u32,
    // The browser owns the script schema. Keeping this opaque lets actor,
    // notes, and future metadata cross the native folder boundary unchanged;
    // the browser performs the stricter structural validation on load.
    scripts: serde_json::Value,
}

#[derive(Debug)]
enum ExistingDocument {
    Missing,
    Owned(LocalLibraryDocument),
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|path| path.join("local-library.json"))
        .map_err(|error| format!("Could not locate Quickque's native config directory: {error}"))
}

fn folder_fingerprint(path: &Path) -> String {
    // FNV-1a is intentionally used instead of a random name: the same folder
    // gets the same app-owned filename after a restart, without adding a
    // hashing dependency to the native bundle.
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in path.to_string_lossy().as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn library_file_name(directory: &Path) -> String {
    format!(
        "{LIBRARY_FILE_PREFIX}{}{LIBRARY_FILE_SUFFIX}",
        folder_fingerprint(directory)
    )
}

fn library_path(directory: &Path) -> PathBuf {
    directory.join(library_file_name(directory))
}

fn backup_path(path: &Path) -> PathBuf {
    let mut backup = path.as_os_str().to_os_string();
    backup.push(".bak");
    PathBuf::from(backup)
}

fn read_bounded(path: &Path, maximum_bytes: usize) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Could not inspect native library file {}: {error}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!(
            "Quickque's native library path is not a regular file: {}",
            path.display()
        ));
    }
    if metadata.len() > maximum_bytes as u64 {
        return Err(format!(
            "Quickque's native library file is too large (maximum {maximum_bytes} bytes): {}",
            path.display()
        ));
    }

    let mut file = File::open(path)
        .map_err(|error| format!("Could not read native library file {}: {error}", path.display()))?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read native library file {}: {error}", path.display()))?;
    if bytes.len() > maximum_bytes {
        return Err(format!(
            "Quickque's native library file is too large (maximum {maximum_bytes} bytes): {}",
            path.display()
        ));
    }
    Ok(bytes)
}

fn parse_config(path: &Path) -> Result<Option<LocalLibraryConfig>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = read_bounded(path, MAX_CONFIG_BYTES)?;
    let config: LocalLibraryConfig = serde_json::from_slice(&bytes).map_err(|error| {
        format!(
            "Quickque's native library configuration is invalid at {}: {error}",
            path.display()
        )
    })?;
    if config.format != CONFIG_FORMAT || config.version != FORMAT_VERSION {
        return Err(format!(
            "Quickque's native library configuration has an unsupported format at {}.",
            path.display()
        ));
    }

    let directory = PathBuf::from(&config.directory);
    if !directory.is_absolute() {
        return Err("Quickque's native library configuration contains a non-absolute folder.".to_string());
    }
    if config.file_name != library_file_name(&directory) {
        return Err(
            "Quickque's native library configuration points to an unexpected file name.".to_string(),
        );
    }
    Ok(Some(config))
}

fn owned_document(bytes: &[u8], path: &Path) -> Result<LocalLibraryDocument, String> {
    let document: LocalLibraryDocument = serde_json::from_slice(bytes).map_err(|error| {
        format!(
            "Quickque will not overwrite the existing file {} because it is not an owned Quickque library: {error}",
            path.display()
        )
    })?;
    if document.format != DOCUMENT_FORMAT || document.version != FORMAT_VERSION {
        return Err(format!(
            "Quickque will not overwrite the existing file {} because it is not an owned Quickque library.",
            path.display()
        ));
    }
    if !document.scripts.is_array() {
        return Err(format!(
            "Quickque's native library file {} does not contain a JSON array.",
            path.display()
        ));
    }
    Ok(document)
}

fn inspect_document(path: &Path) -> Result<ExistingDocument, String> {
    if !path.exists() {
        return Ok(ExistingDocument::Missing);
    }
    let bytes = read_bounded(path, MAX_LIBRARY_BYTES)?;
    if bytes.is_empty() {
        return Err(format!(
            "Quickque will not overwrite the existing empty file {} because it is not an owned Quickque library.",
            path.display()
        ));
    }
    owned_document(&bytes, path).map(ExistingDocument::Owned)
}

fn configured_path(config: &LocalLibraryConfig) -> PathBuf {
    PathBuf::from(&config.directory).join(&config.file_name)
}

fn temp_path_with_nonce(
    path: &Path,
    timestamp_nanos: u128,
    process_id: u32,
    counter: u64,
    attempt: u32,
) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("quickque-local-library");
    path.with_file_name(format!(
        ".{file_name}.tmp-{timestamp_nanos:x}-{process_id:x}-{counter:x}-{attempt:x}",
    ))
}

fn sync_parent(path: &Path) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        #[cfg(unix)]
        {
            File::open(parent)?.sync_all()?;
        }
    }
    Ok(())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let timestamp_nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    write_atomic_with_nonce(
        path,
        bytes,
        timestamp_nanos,
        std::process::id(),
        counter,
    )
}

fn write_atomic_with_nonce(
    path: &Path,
    bytes: &[u8],
    timestamp_nanos: u128,
    process_id: u32,
    counter: u64,
) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| {
        format!(
            "Could not determine the parent directory for native library path {}.",
            path.display()
        )
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "Could not create Quickque's native config directory {}: {error}",
            parent.display()
        )
    })?;

    let mut temporary = None;
    let mut file = None;
    let mut last_collision = None;
    for attempt in 0..MAX_TEMP_ATTEMPTS {
        let candidate = temp_path_with_nonce(
            path,
            timestamp_nanos,
            process_id,
            counter,
            attempt,
        );
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(created) => {
                temporary = Some(candidate);
                file = Some(created);
                break;
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                last_collision = Some(error);
            }
            Err(error) => {
                return Err(format!(
                    "Could not create the temporary native library file {}: {error}",
                    candidate.display()
                ));
            }
        }
    }
    let Some(temporary) = temporary else {
        let detail = last_collision
            .map(|error| error.to_string())
            .unwrap_or_else(|| "all temporary names were unavailable".to_string());
        return Err(format!(
            "Could not create a unique temporary native library file after {MAX_TEMP_ATTEMPTS} attempts: {detail}"
        ));
    };
    let mut file = file.expect("temporary path is only set with its open file");
    if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "Could not durably write the temporary native library file {}: {error}",
            temporary.display()
        ));
    }
    drop(file);

    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "Could not atomically replace native library file {}: {error}",
            path.display()
        ));
    }
    sync_parent(path).map_err(|error| {
        format!(
            "Native library file {} was written, but its parent could not be synchronized: {error}",
            path.display()
        )
    })
}

fn write_owned_backup(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if path.exists() {
        let existing = read_bounded(path, MAX_LIBRARY_BYTES)?;
        owned_document(&existing, path)?;
    }
    write_atomic(path, bytes)
}

fn config_for_directory(directory: &Path) -> LocalLibraryConfig {
    LocalLibraryConfig {
        format: CONFIG_FORMAT.to_string(),
        version: FORMAT_VERSION,
        directory: directory.to_string_lossy().into_owned(),
        file_name: library_file_name(directory),
    }
}

fn persist_config(path: &Path, config: &LocalLibraryConfig) -> Result<(), String> {
    if path.exists() {
        let _ = parse_config(path)?;
    }
    let bytes = serde_json::to_vec_pretty(config)
        .map_err(|error| format!("Could not encode Quickque's native library configuration: {error}"))?;
    write_atomic(path, &bytes)
}

fn validate_scripts_json(scripts_json: &str) -> Result<serde_json::Value, String> {
    if scripts_json.len() > MAX_LIBRARY_BYTES {
        return Err(format!(
            "Quickque's local script library is too large (maximum {MAX_LIBRARY_BYTES} bytes)."
        ));
    }
    let scripts: serde_json::Value = serde_json::from_str(scripts_json)
        .map_err(|error| format!("Quickque local library must be valid JSON: {error}"))?;
    if !scripts.is_array() {
        return Err("Quickque local library JSON must contain an array of scripts.".to_string());
    }
    validate_section_notes(&scripts)?;
    Ok(scripts)
}

fn validate_section_notes(scripts: &serde_json::Value) -> Result<(), String> {
    for script in scripts.as_array().into_iter().flatten() {
        let Some(sections) = script.get("sections").and_then(serde_json::Value::as_array) else {
            continue;
        };
        for section in sections {
            let Some(notes) = section.get("notes") else {
                continue;
            };
            let Some(notes) = notes.as_str() else {
                return Err("Quickque section notes must be text when present.".to_string());
            };
            if notes.chars().count() > MAX_SECTION_NOTES_CHARS {
                return Err(format!(
                    "Quickque section notes are too long (maximum {MAX_SECTION_NOTES_CHARS} characters)."
                ));
            }
        }
    }
    Ok(())
}

fn verify_expected_directory(
    expected_directory: &str,
    config: &LocalLibraryConfig,
) -> Result<(), String> {
    if expected_directory == config.directory {
        return Ok(());
    }
    Err(format!(
        "Quickque's local library folder changed while saving. Expected {expected_directory}, but the configured folder is {}. Choose the configured folder again before saving.",
        config.directory
    ))
}

fn validate_selected_directory(
    current_directory: Option<&str>,
    selected_directory: &Path,
) -> Result<(), String> {
    let selected_directory_string = selected_directory.to_string_lossy();
    let target = library_path(selected_directory);
    let backup = backup_path(&target);
    let target_document = inspect_document(&target)?;
    let backup_document = inspect_document(&backup)?;
    let is_same_directory = current_directory == Some(selected_directory_string.as_ref());

    if !is_same_directory
        && (matches!(target_document, ExistingDocument::Owned(_))
            || matches!(backup_document, ExistingDocument::Owned(_)))
    {
        return Err(format!(
            "The selected folder already contains a Quickque library ({}). Choose a new folder or import the existing backup before switching folders.",
            selected_directory.display()
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn get_local_library(
    app: AppHandle,
    state: State<'_, LocalLibraryState>,
) -> Result<LocalLibrary, String> {
    let _lock = state
        .operation_lock
        .lock()
        .map_err(|_| "Quickque native library state is unavailable.".to_string())?;
    let path = config_path(&app)?;
    let Some(config) = parse_config(&path)? else {
        return Ok(LocalLibrary {
            directory: None,
            scripts_json: None,
        });
    };

    let directory = PathBuf::from(&config.directory);
    let metadata = fs::metadata(&directory).map_err(|error| {
        format!(
            "The configured Quickque script folder is unavailable at {}: {error}",
            directory.display()
        )
    })?;
    if !metadata.is_dir() {
        return Err(format!(
            "The configured Quickque script folder is not a directory: {}",
            directory.display()
        ));
    }

    let library = match inspect_document(&configured_path(&config))? {
        ExistingDocument::Missing => None,
        ExistingDocument::Owned(document) => Some(
            serde_json::to_string(&document.scripts)
                .map_err(|error| format!("Could not encode Quickque's native library: {error}"))?,
        ),
    };
    Ok(LocalLibrary {
        directory: Some(config.directory),
        scripts_json: library,
    })
}

#[tauri::command]
pub async fn choose_local_directory(
    app: AppHandle,
    state: State<'_, LocalLibraryState>,
) -> Result<Option<String>, String> {
    // Register the native picker asynchronously, then wait on a worker thread
    // for its callback. The command never blocks Tauri's UI/event-loop thread.
    let (sender, receiver) = sync_channel(1);
    app
        .dialog()
        .file()
        .set_title("Choose a folder for Quickque scripts")
        .pick_folder(move |selected| {
            let _ = sender.send(selected);
        });
    let selected = tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|error| format!("Quickque's native folder picker stopped unexpectedly: {error}"))?
        .map_err(|error| format!("Quickque's native folder picker did not return a result: {error}"))?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let directory = selected
        .into_path()
        .map_err(|error| format!("Quickque could not read the selected folder path: {error}"))?;
    let directory = fs::canonicalize(&directory).map_err(|error| {
        format!(
            "Quickque could not access the selected script folder {}: {error}",
            directory.display()
        )
    })?;
    let metadata = fs::metadata(&directory).map_err(|error| {
        format!(
            "Quickque could not inspect the selected script folder {}: {error}",
            directory.display()
        )
    })?;
    if !metadata.is_dir() {
        return Err(format!(
            "The selected Quickque script location is not a directory: {}",
            directory.display()
        ));
    }

    let _lock = state
        .operation_lock
        .lock()
        .map_err(|_| "Quickque native library state is unavailable.".to_string())?;
    let config_path = config_path(&app)?;
    let current_config = parse_config(&config_path)?;
    validate_selected_directory(
        current_config
            .as_ref()
            .map(|config| config.directory.as_str()),
        &directory,
    )?;
    persist_config(&config_path, &config_for_directory(&directory))?;
    Ok(Some(directory.to_string_lossy().into_owned()))
}

#[tauri::command(rename_all = "camelCase")]
pub fn save_local_library(
    app: AppHandle,
    state: State<'_, LocalLibraryState>,
    scripts_json: String,
    expected_directory: String,
) -> Result<(), String> {
    let scripts = validate_scripts_json(&scripts_json)?;
    let document = LocalLibraryDocument {
        format: DOCUMENT_FORMAT.to_string(),
        version: FORMAT_VERSION,
        scripts,
    };
    let bytes = serde_json::to_vec_pretty(&document)
        .map_err(|error| format!("Could not encode Quickque's native library: {error}"))?;
    if bytes.len() > MAX_LIBRARY_BYTES {
        return Err(format!(
            "Quickque's local script library is too large after encoding (maximum {MAX_LIBRARY_BYTES} bytes)."
        ));
    }

    let _lock = state
        .operation_lock
        .lock()
        .map_err(|_| "Quickque native library state is unavailable.".to_string())?;
    let config_file = config_path(&app)?;
    let Some(config) = parse_config(&config_file)? else {
        return Err("Choose a Quickque script folder before saving the local library.".to_string());
    };
    verify_expected_directory(&expected_directory, &config)?;
    let directory = PathBuf::from(&config.directory);
    let metadata = fs::metadata(&directory).map_err(|error| {
        format!(
            "The configured Quickque script folder is unavailable at {}: {error}",
            directory.display()
        )
    })?;
    if !metadata.is_dir() {
        return Err(format!(
            "The configured Quickque script folder is not a directory: {}",
            directory.display()
        ));
    }
    let target = configured_path(&config);
    if let ExistingDocument::Owned(_) = inspect_document(&target)? {
        let current = read_bounded(&target, MAX_LIBRARY_BYTES)?;
        write_owned_backup(&backup_path(&target), &current)?;
    }
    write_atomic(&target, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_file_name_is_stable_and_app_owned() {
        let path = Path::new("/Users/example/Scripts");
        assert_eq!(library_file_name(path), library_file_name(path));
        assert!(library_file_name(path).starts_with(LIBRARY_FILE_PREFIX));
        assert!(library_file_name(path).ends_with(LIBRARY_FILE_SUFFIX));
        assert_ne!(
            library_file_name(path),
            library_file_name(Path::new("/Users/example/Other"))
        );
    }

    #[test]
    fn scripts_must_be_an_array() {
        assert!(validate_scripts_json("[]").is_ok());
        assert!(validate_scripts_json(r#"{"scripts":[]}"#).is_err());
        assert!(validate_scripts_json("not json").is_err());
    }

    #[test]
    fn malformed_section_notes_are_rejected_before_native_save() {
        let oversized = serde_json::json!([{
            "sections": [{"notes": "x".repeat(MAX_SECTION_NOTES_CHARS + 1)}]
        }]);
        assert!(validate_scripts_json(
            &serde_json::to_string(&oversized).expect("encode oversized notes")
        )
        .is_err());
        let wrong_type = serde_json::json!([{
            "sections": [{"notes": {"model": "blob"}}]
        }]);
        assert!(validate_scripts_json(
            &serde_json::to_string(&wrong_type).expect("encode malformed notes")
        )
        .is_err());
    }

    #[test]
    fn actor_metadata_and_notes_survive_native_document_validation() {
        let input = serde_json::json!([{
            "id": "actor-script",
            "purpose": "performance",
            "title": "Scene",
            "sections": [{
                "id": "turn-1",
                "title": "Partner",
                "content": "Hello.",
                "notes": "Hold for the actor.",
                "characterId": "partner"
            }],
            "actor": {
                "enabled": true,
                "characters": [{
                    "id": "partner",
                    "name": "Partner",
                    "age": "30s",
                    "gender": "non-binary",
                    "style": "restrained",
                    "voice": {
                        "engine": "turbo",
                        "voiceId": "rights-cleared-1",
                        "rate": 1.0
                    }
                }],
                "myRoleIds": []
            }
        }]);
        let scripts = validate_scripts_json(
            &serde_json::to_string(&input).expect("encode actor metadata"),
        )
        .expect("actor script array should be accepted");
        let document = LocalLibraryDocument {
            format: DOCUMENT_FORMAT.to_string(),
            version: FORMAT_VERSION,
            scripts,
        };
        let encoded = serde_json::to_vec(&document).expect("encode native document");
        let decoded: LocalLibraryDocument =
            serde_json::from_slice(&encoded).expect("decode native document");
        assert_eq!(decoded.scripts[0]["purpose"], "performance");
        assert_eq!(
            decoded.scripts[0]["sections"][0]["notes"],
            "Hold for the actor."
        );
        assert_eq!(
            decoded.scripts[0]["sections"][0]["characterId"],
            "partner"
        );
        assert_eq!(
            decoded.scripts[0]["actor"]["characters"][0]["voice"]["engine"],
            "turbo"
        );
        assert_eq!(
            decoded.scripts[0]["actor"]["characters"][0]["voice"]["voiceId"],
            "rights-cleared-1"
        );
    }

    #[test]
    fn nonempty_unowned_file_is_rejected() {
        let error = owned_document(
            br#"{"unrelated":"data"}"#,
            Path::new("/tmp/quickque-library.json"),
        )
        .expect_err("unowned files must not be accepted");
        assert!(error.contains("not an owned Quickque library"));
    }

    #[test]
    fn switching_to_nonempty_owned_library_is_rejected() {
        let directory = test_directory("owned-switch");
        let target = library_path(&directory);
        let document = LocalLibraryDocument {
            format: DOCUMENT_FORMAT.to_string(),
            version: FORMAT_VERSION,
            scripts: serde_json::json!([]),
        };
        fs::write(&target, serde_json::to_vec(&document).expect("test document")).expect("test file");

        let error = validate_selected_directory(Some("/another/folder"), &directory)
            .expect_err("a different folder with a Quickque library must be rejected");
        assert!(error.contains("Choose a new folder or import the existing backup"));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn expected_directory_mismatch_is_rejected_inside_save_guard() {
        let config = config_for_directory(Path::new("/Users/example/Scripts"));
        let error = verify_expected_directory("/Users/example/Other", &config)
            .expect_err("a stale save must be rejected");
        assert!(error.contains("configured folder"));
    }

    #[test]
    fn stale_temp_name_does_not_block_a_retry() {
        let directory = test_directory("stale-temp");
        let target = directory.join("library.json");
        let process_id = std::process::id();
        let stale = temp_path_with_nonce(&target, 123, process_id, 789, 0);
        fs::write(&stale, b"stale").expect("create stale temporary file");
        let retry = temp_path_with_nonce(&target, 123, process_id, 789, 1);
        write_atomic_with_nonce(&target, b"fresh", 123, process_id, 789)
            .expect("retry should use a new collision-safe name");
        assert_eq!(fs::read(&target).expect("read target"), b"fresh");
        assert_eq!(fs::read(&stale).expect("read stale file"), b"stale");
        assert_ne!(stale, retry);
        let _ = fs::remove_dir_all(directory);
    }

    fn test_directory(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "quickque-local-library-{name}-{}-{}",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&directory).expect("create test directory");
        directory
    }
}