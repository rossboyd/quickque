use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Manager};

pub const VOICE_ID: &str = "chatterbox-turbo:default-en";
#[derive(Default)]
pub struct InstallState(pub Arc<Mutex<Install>>);
#[derive(Default)]
pub struct Install {
    child: Option<Child>,
    running: bool,
    cancelled: bool,
    progress: Option<Value>,
}

pub fn command(app: &AppHandle) -> Result<Command, String> {
    if !cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        return Err(
            "SCENE_SPEECH_TURBO_UNSUPPORTED: Chatterbox requires an Apple Silicon Mac.".into(),
        );
    }
    let helper = if let Some(path) = std::env::var_os("QUICKQUE_TURBO_HELPER") {
        std::path::PathBuf::from(path)
    } else {
        app.path()
            .resource_dir()
            .map_err(|_| "Could not locate Quickque resources.")?
            .join("turbo-runtime/quickque-turbo")
    };
    if !helper.is_file() {
        return Err("SCENE_SPEECH_TURBO_RUNTIME: This build does not include Chatterbox. Install a Quickque Mac build with the bundled runtime.".into());
    }
    let mut command = Command::new(helper);
    command.arg("--model-dir").arg(
        app.path()
            .app_data_dir()
            .map_err(|_| "Could not locate Quickque data.")?
            .join("chatterbox-turbo-v1"),
    );
    command
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .stdout(Stdio::piped());
    Ok(command)
}

pub fn status(app: &AppHandle) -> Result<Value, String> {
    let output = command(app)?
        .arg("--status")
        .output()
        .map_err(|_| "Could not start the Chatterbox runtime.")?;
    if !output.status.success() {
        return Err("Could not check the Chatterbox installation.".into());
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|_| "Chatterbox returned an invalid installation status.".into())
}

#[tauri::command]
pub async fn turbo_status(
    app: AppHandle,
    state: tauri::State<'_, InstallState>,
) -> Result<Value, String> {
    {
        let install = state.0.lock().map_err(|_| "Download state unavailable.")?;
        if install.running {
            return Ok(install
                .progress
                .clone()
                .unwrap_or(json!({"status":"downloading"})));
        }
    }
    tauri::async_runtime::spawn_blocking(move || status(&app))
        .await
        .map_err(|_| "Chatterbox status check failed.".to_string())?
}

#[tauri::command]
pub async fn turbo_install(
    app: AppHandle,
    state: tauri::State<'_, InstallState>,
) -> Result<(), String> {
    let mut command = command(&app)?;
    let shared = Arc::clone(&state.0);
    {
        let mut install = shared.lock().map_err(|_| "Download state unavailable.")?;
        if install.running {
            return Err("Chatterbox is already downloading.".into());
        }
        install.running = true;
        install.cancelled = false;
        install.progress = Some(json!({"status":"downloading"}));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let result = (|| {
            let stdout = {
                let mut install = shared.lock().map_err(|_| "Download state unavailable.")?;
                if install.cancelled { return Err("Chatterbox download cancelled.".to_string()); }
                let mut child = command.arg("--install").spawn().map_err(|_| "Could not start Chatterbox download.")?;
                let stdout = child.stdout.take().ok_or("Chatterbox download output unavailable.")?;
                install.child = Some(child);
                stdout
            };
            let mut failure = None;
            // Worker emits only bounded progress/error JSON, never model bytes.
            let mut reader = BufReader::new(stdout);
            loop {
                let mut line = String::new();
                use std::io::Read;
                let count = reader.by_ref().take(8193).read_line(&mut line).map_err(|_| "Could not read download progress.")?;
                if count == 0 { break; }
                if count > 8192 { return Err("Invalid Chatterbox download response.".into()); }
                let value: Value = serde_json::from_str(&line).map_err(|_| "Invalid Chatterbox download response.")?;
                if let Some(message) = value.get("message").and_then(Value::as_str) { failure = Some(message.to_string()); }
                shared.lock().map_err(|_| "Download state unavailable.")?.progress = Some(value);
            }
            let mut install = shared.lock().map_err(|_| "Download state unavailable.")?;
            let exit = install.child.as_mut().ok_or("Download process missing.")?.wait().map_err(|_| "Download process did not finish.")?;
            if install.cancelled { return Err("Chatterbox download cancelled.".into()); }
            if !exit.success() { return Err(failure.unwrap_or("Chatterbox download failed. Check your connection and free disk space, then retry.".into())); }
            Ok(())
        })();
        if let Ok(mut install) = shared.lock() {
            if let Some(mut child) = install.child.take() { let _ = child.kill(); let _ = child.wait(); }
            install.running = false;
        }
        result
    }).await.map_err(|_| "Chatterbox download task failed.".to_string())?
}

pub fn cancel(state: &InstallState) -> Result<(), String> {
    let mut install = state.0.lock().map_err(|_| "Download state unavailable.")?;
    install.cancelled = true;
    if let Some(child) = install.child.as_mut() {
        child
            .kill()
            .map_err(|_| "Could not cancel Chatterbox download.")?;
        child
            .wait()
            .map_err(|_| "Could not confirm Chatterbox download stopped.")?;
    }
    Ok(())
}

#[tauri::command]
pub fn turbo_cancel_install(state: tauri::State<'_, InstallState>) -> Result<(), String> {
    cancel(&state)
}
