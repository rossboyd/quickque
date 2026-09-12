use serde::{Deserialize, Serialize};
use std::{
    io::{self, BufRead, BufReader, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager};
mod remote;
use remote::{RemoteInfo, RemoteService, RemoteSnapshot, RemoteStatus};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct FlowCommand {
    action: String,
    generation: u64,
}

#[derive(Default)]
struct ProcessState {
    generation: u64,
    child: Option<Child>,
    stdin: Option<ChildStdin>,
}

#[derive(Default)]
struct FlowState {
    process: Arc<Mutex<ProcessState>>,
}

#[derive(Default)]
struct AppState {
    flow: FlowState,
    remote: RemoteService,
}

impl FlowState {
    fn shutdown(&self) {
        let process = self.process.lock().ok().and_then(|mut state| {
            let child = state.child.take()?;
            Some((child, state.stdin.take()))
        });
        if let Some((mut child, stdin)) = process {
            // Closing the command pipe lets a healthy helper tear down its
            // microphone and inference before the unconditional kill below.
            drop(stdin);
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for FlowState {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn status_event(generation: u64, status: &str, message: Option<&str>) -> serde_json::Value {
    let mut event = serde_json::json!({
        "type": "status",
        "generation": generation,
        "status": status,
    });
    if let Some(message) = message {
        event["message"] = serde_json::Value::String(message.to_owned());
    }
    event
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn helper_path() -> Result<std::path::PathBuf, String> {
    if let Some(path) = std::env::var_os("QUICKQUE_FLOW_HELPER") {
        return Ok(path.into());
    }
    let executable = std::env::current_exe()
        .map_err(|error| format!("Could not locate Quickque: {error}"))?;
    Ok(executable
        .parent()
        .ok_or_else(|| "Quickque executable has no parent directory.".to_string())?
        .join("quickque-flow"))
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
enum BoundedLine {
    Line(Vec<u8>),
    Oversized,
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn read_bounded_line<R: BufRead>(
    reader: &mut R,
    maximum_bytes: usize,
) -> io::Result<Option<BoundedLine>> {
    let mut line = Vec::with_capacity(4096);
    let mut oversized = false;
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            if line.is_empty() && !oversized {
                return Ok(None);
            }
            return Ok(Some(if oversized {
                BoundedLine::Oversized
            } else {
                BoundedLine::Line(line)
            }));
        }

        let newline = available.iter().position(|byte| *byte == b'\n');
        let content_bytes = newline.unwrap_or(available.len());
        if !oversized {
            if line.len().saturating_add(content_bytes) > maximum_bytes {
                oversized = true;
                line.clear();
            } else {
                line.extend_from_slice(&available[..content_bytes]);
            }
        }
        let consumed = content_bytes + if newline.is_some() { 1 } else { 0 };
        reader.consume(consumed);

        if newline.is_some() {
            return Ok(Some(if oversized {
                BoundedLine::Oversized
            } else {
                BoundedLine::Line(line)
            }));
        }
    }
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn spawn_helper(
    app: AppHandle,
    process: Arc<Mutex<ProcessState>>,
    command: &FlowCommand,
) -> Result<(), String> {
    let mut child = Command::new(helper_path()?)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Could not start the local Flow helper: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Flow helper stdout was unavailable.".to_string())?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Flow helper stdin was unavailable.".to_string())?;
    let child_id = child.id();

    let send_result = serde_json::to_writer(&mut stdin, command)
        .map_err(|error| format!("Could not encode Flow command: {error}"))
        .and_then(|_| {
            stdin
                .write_all(b"\n")
                .and_then(|_| stdin.flush())
                .map_err(|error| format!("Could not send Flow command: {error}"))
        });
    if let Err(error) = send_result {
        drop(stdin);
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }

    {
        let Ok(mut state) = process.lock() else {
            drop(stdin);
            let _ = child.kill();
            let _ = child.wait();
            return Err("Flow process state is unavailable.".to_string());
        };
        state.child = Some(child);
        state.stdin = Some(stdin);
    }

    std::thread::spawn(move || {
        const MAXIMUM_EVENT_BYTES: usize = 1024 * 1024;
        let mut reader = BufReader::new(stdout);
        let mut invalid_lines = 0_u8;
        loop {
            let line = match read_bounded_line(&mut reader, MAXIMUM_EVENT_BYTES) {
                Ok(Some(BoundedLine::Line(line))) => line,
                Ok(Some(BoundedLine::Oversized)) => break,
                Ok(None) | Err(_) => break,
            };
            let Ok(event) = serde_json::from_slice::<serde_json::Value>(&line) else {
                invalid_lines = invalid_lines.saturating_add(1);
                if invalid_lines >= 8 {
                    break;
                }
                continue;
            };
            invalid_lines = 0;
            let event_generation = event.get("generation").and_then(|value| value.as_u64());
            let current = process
                .lock()
                .ok()
                .map(|state| {
                    state.generation == event_generation.unwrap_or(u64::MAX)
                        && state.child.as_ref().map(Child::id) == Some(child_id)
                })
                .unwrap_or(false);
            if current {
                let _ = app.emit("quickque:flow", event);
            }
        }

        let exited = process.lock().ok().and_then(|mut state| {
            if state.child.as_ref().map(Child::id) == Some(child_id) {
                Some((state.generation, state.child.take(), state.stdin.take()))
            } else {
                None
            }
        });
        if let Some((generation, child, stdin)) = exited {
            drop(stdin);
            if let Some(mut child) = child {
                // stdout EOF is not sufficient to reap a process. Closing stdin
                // requests cooperative cleanup; kill bounds cleanup if it is wedged.
                let _ = child.kill();
                let _ = child.wait();
            }
            let _ = app.emit(
                "quickque:flow",
                serde_json::json!({
                    "type": "error",
                    "generation": generation,
                    "message": "The local Flow helper exited unexpectedly."
                }),
            );
        }
    });
    Ok(())
}

#[tauri::command]
fn flow_command(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    command: FlowCommand,
) -> Result<(), String> {
    state.flow.shutdown();
    {
        let mut process = state
            .flow.process
            .lock()
            .map_err(|_| "Flow process state is unavailable.".to_string())?;
        process.generation = command.generation;
    }

    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    {
        let _ = app.emit(
            "quickque:flow",
            status_event(
                command.generation,
                "unsupported",
                Some("Local Flow requires macOS 14 or later on Apple Silicon."),
            ),
        );
        return Ok(());
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    match command.action.as_str() {
        "pause" => {
            let _ = app.emit(
                "quickque:flow",
                status_event(command.generation, "paused", None),
            );
            Ok(())
        }
        "stop" => {
            let _ = app.emit(
                "quickque:flow",
                status_event(command.generation, "stopped", None),
            );
            Ok(())
        }
        "cancelDownload" => {
            spawn_helper(app, Arc::clone(&state.flow.process), &command)
        }
        "status" | "download" | "start" => {
            spawn_helper(app, Arc::clone(&state.flow.process), &command)
        }
        _ => Err("Unknown Flow action.".to_string()),
    }
}

#[tauri::command]
fn remote_start(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<RemoteInfo, String> {
    let info = state.remote.start()?;
    let _ = app.emit("quickque:remote", serde_json::json!({"type":"started","info":info}));
    Ok(info)
}

#[tauri::command]
fn remote_stop(app: AppHandle, state: tauri::State<'_, AppState>) {
    state.remote.stop();
    let _ = app.emit("quickque:remote", serde_json::json!({"type":"stopped"}));
}

#[tauri::command]
fn remote_approve(app: AppHandle, state: tauri::State<'_, AppState>, session_id: String) -> Result<(), String> {
    state.remote.approve(&session_id)?;
    let _ = app.emit("quickque:remote", serde_json::json!({"type":"controllerApproved"}));
    Ok(())
}

#[tauri::command]
fn remote_reject(app: AppHandle, state: tauri::State<'_, AppState>) {
    state.remote.reject();
    let _ = app.emit("quickque:remote", serde_json::json!({"type":"controllerRejected"}));
}

#[tauri::command]
fn remote_snapshot(state: tauri::State<'_, AppState>) -> RemoteSnapshot {
    state.remote.snapshot()
}

#[tauri::command]
fn remote_publish_state(state: tauri::State<'_, AppState>, snapshot: RemoteSnapshot) -> Result<(), String> {
    state.remote.set_snapshot(snapshot)
}

#[tauri::command]
fn remote_take_commands(state: tauri::State<'_, AppState>) -> Vec<remote::ControlRequest> {
    state.remote.take_commands()
}

#[tauri::command]
fn remote_pairing_pending(state: tauri::State<'_, AppState>) -> bool {
    state.remote.pairing_pending()
}

#[tauri::command]
fn remote_status(state: tauri::State<'_, AppState>) -> RemoteStatus {
    state.remote.status()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![flow_command, remote_start, remote_stop, remote_approve, remote_reject, remote_snapshot, remote_publish_state, remote_take_commands, remote_pairing_pending, remote_status])
        .build(tauri::generate_context!())
        .expect("error while building Quickque");

    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }) {
            let state = handle.state::<AppState>();
            state.flow.shutdown();
            state.remote.stop();
        }
    });
}
