use serde::{Deserialize, Serialize};
use std::{
    io::{self, BufRead, BufReader, Read, Write},
    process::{Child, ChildStderr, ChildStdin, Command, ExitStatus, Stdio},
    sync::{
        mpsc::{self, Receiver, Sender},
        Arc, Mutex,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
mod remote;
use remote::{RemoteInfo, RemoteService, RemoteSnapshot, RemoteStatus};

mod local_library;
mod flow_protocol;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct FlowCommand {
    action: String,
    generation: u64,
}

const MAXIMUM_STDERR_BYTES: usize = 8192;
#[derive(Default)]
struct ProcessState {
    generation: u64,
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    stderr: Option<StderrCapture>,
}

#[derive(Default)]
struct FlowState {
    process: Arc<Mutex<ProcessState>>,
    command_lock: Mutex<()>,
}

#[derive(Default)]
struct AppState {
    flow: FlowState,
    remote: RemoteService,
}

impl FlowState {
    fn accept_generation(
        &self,
        generation: u64,
    ) -> Result<(bool, Option<(Child, Option<ChildStdin>, Option<StderrCapture>)>), String> {
        let mut process = self
            .process
            .lock()
            .map_err(|_| "Flow process state is unavailable.".to_string())?;
        if generation <= process.generation {
            return Ok((false, None));
        }
        let previous = process
            .child
            .take()
            .map(|child| (child, process.stdin.take(), process.stderr.take()));
        process.generation = generation;
        Ok((true, previous))
    }

    fn reap(mut process: Option<(Child, Option<ChildStdin>, Option<StderrCapture>)>) {
        if let Some((mut child, stdin, stderr)) = process.take() {
            drop(stdin);
            let _ = child.kill();
            let _ = child.wait();
            if let Some(stderr) = stderr {
                let _ = stderr.finish();
            }
        }
    }

    fn shutdown(&self) {
        let process = self.process.lock().ok().and_then(|mut state| {
            let child = state.child.take()?;
            Some((child, state.stdin.take(), state.stderr.take()))
        });
        // Closing the command pipe lets a healthy helper tear down its
        // microphone and inference before the unconditional kill below.
        Self::reap(process);
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

fn diagnostic_event(generation: u64, stage: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "diagnostic",
        "generation": generation,
        "stage": stage,
    })
}

fn diagnostic_numeric_event(generation: u64, stage: &str, value: u32) -> serde_json::Value {
    serde_json::json!({
        "type": "diagnostic",
        "generation": generation,
        "stage": stage,
        "value": value,
    })
}
fn helper_error(generation: u64, code: &str, message: &str) -> serde_json::Value {
    // Diagnostic codes contain no audio or transcript data and are available
    // through Console.app without creating a Quickque log file.
    eprintln!("[quickque-flow] code={code} generation={generation}");
    serde_json::json!({
        "type": "error",
        "generation": generation,
        "code": code,
        "message": message,
    })
}

fn helper_error_with_details(
    generation: u64,
    code: &str,
    message: &str,
    details: serde_json::Value,
) -> serde_json::Value {
    let mut event = helper_error(generation, code, message);
    event["details"] = details;
    event
}
fn exit_status_diagnostic(status: &ExitStatus) -> Option<(&'static str, u32)> {
    if let Some(code) = status.code() {
        return u32::try_from(code)
            .ok()
            .map(|value| ("helper_exit_code", value));
    }

    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;

        status
            .signal()
            .and_then(|signal| u32::try_from(signal).ok())
            .map(|value| ("helper_exit_signal", value))
    }

    #[cfg(not(unix))]
    {
        None
    }
}
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

fn discard_spawned_helper(
    mut child: Child,
    stdin: Option<ChildStdin>,
    stderr: Option<StderrCapture>,
) {
    drop(stdin);
    let _ = child.kill();
    let _ = child.wait();
    if let Some(stderr) = stderr {
        let _ = stderr.finish();
    }
}
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn spawn_helper(
    app: AppHandle,
    process: Arc<Mutex<ProcessState>>,
    command: &FlowCommand,
) -> Result<(), String> {
    let command_generation = command.generation;
    let _ = app.emit(
        "quickque:flow",
        diagnostic_event(command_generation, "helper_spawn_begin"),
    );
    let mut child = Command::new(helper_path()?)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("FLOW_HELPER_START: Could not start the local Flow helper: {error}"))?;
    let _ = app.emit(
        "quickque:flow",
        diagnostic_event(command_generation, "helper_spawned"),
    );

    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            discard_spawned_helper(child, None, None);
            return Err("FLOW_HELPER_PROTOCOL: Flow helper stdout was unavailable.".to_string());
        }
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => Some(StderrCapture::spawn(stderr)),
        None => {
            discard_spawned_helper(child, None, None);
            return Err("FLOW_HELPER_PROTOCOL: Flow helper stderr was unavailable.".to_string());
        }
    };
    let mut stdin = match child.stdin.take() {
        Some(stdin) => stdin,
        None => {
            discard_spawned_helper(child, None, stderr);
            return Err("FLOW_HELPER_PROTOCOL: Flow helper stdin was unavailable.".to_string());
        }
    };
    let child_id = child.id();

    let send_result = serde_json::to_writer(&mut stdin, command)
        .map_err(|error| format!("FLOW_HELPER_PROTOCOL: Could not encode Flow command: {error}"))
        .and_then(|_| {
            stdin
                .write_all(b"\n")
                .and_then(|_| stdin.flush())
                .map_err(|error| format!("FLOW_HELPER_PROTOCOL: Could not send Flow command: {error}"))
        });
    if let Err(error) = send_result {
        discard_spawned_helper(child, Some(stdin), stderr);
        return Err(error);
    }
    let _ = app.emit(
        "quickque:flow",
        diagnostic_event(command_generation, "helper_command_sent"),
    );

    {
        let Ok(mut state) = process.lock() else {
            discard_spawned_helper(child, Some(stdin), stderr);
            return Err("Flow process state is unavailable.".to_string());
        };
        if state.generation != command_generation || state.child.is_some() {
            drop(state);
            discard_spawned_helper(child, Some(stdin), stderr);
            return Err("The Flow command was superseded before the helper started.".to_string());
        }
        state.child = Some(child);
        state.stdin = Some(stdin);
        state.stderr = stderr;
    }

    std::thread::spawn(move || {
        const MAXIMUM_EVENT_BYTES: usize = 1024 * 1024;
        let mut reader = BufReader::new(stdout);
        let mut invalid_lines = 0_u8;
        loop {
            let line = match read_bounded_line(&mut reader, MAXIMUM_EVENT_BYTES) {
                Ok(Some(BoundedLine::Line(line))) => line,
                Ok(Some(BoundedLine::Oversized)) => {
                    if process.lock().ok().map(|state| {
                        state.generation == command_generation
                            && state.child.as_ref().map(Child::id) == Some(child_id)
                    }).unwrap_or(false) {
                        let details = helper_details(
                            &current_stderr_snapshot(&process, command_generation, child_id),
                            None,
                            false,
                        );
                        let _ = app.emit(
                            "quickque:flow",
                            helper_error_with_details(
                                command_generation,
                                "helper_output_too_large",
                                "The local Flow helper returned an oversized event.",
                                details,
                            ),
                        );
                    }
                    break;
                }
                Ok(None) | Err(_) => break,
            };
            let Ok(event) = serde_json::from_slice::<serde_json::Value>(&line) else {
                invalid_lines = invalid_lines.saturating_add(1);
                if invalid_lines >= 8 {
                    let current = process.lock().ok().map(|state| {
                        state.generation == command_generation
                            && state.child.as_ref().map(Child::id) == Some(child_id)
                    }).unwrap_or(false);
                    if current {
                        let details = helper_details(
                            &current_stderr_snapshot(&process, command_generation, child_id),
                            None,
                            false,
                        );
                        let _ = app.emit(
                            "quickque:flow",
                            helper_error_with_details(
                                command_generation,
                                "helper_invalid_output",
                                "The local Flow helper returned invalid events.",
                                details,
                            ),
                        );
                    }
                    break;
                }
                continue;
            };
            invalid_lines = 0;
            let current = process
                .lock()
                .ok()
                .map(|state| {
                    state.generation == command_generation
                        && state.child.as_ref().map(Child::id) == Some(child_id)
                })
                .unwrap_or(false);
            if !current {
                continue;
            }

            let event_type = event.get("type").and_then(|value| value.as_str());
            let event_generation = event.get("generation").and_then(|value| value.as_u64());
            if event_type == Some("diagnostic") {
                let stage = event.get("stage").and_then(|value| value.as_str());
                let boot_checkpoint = event_generation == Some(0)
                    && matches!(stage, Some("helper_boot" | "helper_read_wait"));
                if !is_diagnostic_stage(stage)
                    || (!boot_checkpoint && event_generation != Some(command_generation))
                {
                    continue;
                }
                // Rebuild diagnostics instead of forwarding helper data. This
                // keeps the protocol to the fixed, privacy-safe shape and
                // stamps the helper's pre-command checkpoints with the
                // generation of this still-current child.
                let stage = stage.unwrap_or_default();
                let event = if matches!(stage, "helper_exit_code" | "helper_exit_signal") {
                    event
                        .get("value")
                        .and_then(|value| value.as_u64())
                        .and_then(|value| u32::try_from(value).ok())
                        .map(|value| diagnostic_numeric_event(command_generation, stage, value))
                        .unwrap_or_else(|| diagnostic_event(command_generation, stage))
                } else {
                    diagnostic_event(command_generation, stage)
                };
                let _ = app.emit("quickque:flow", event);
            } else if event_type == Some("error") {
                if event_generation != Some(command_generation) {
                    continue;
                }
                let code = event
                    .get("code")
                    .and_then(|value| value.as_str())
                    .filter(|value| !value.is_empty())
                    .unwrap_or("helper_protocol");
                let message = event
                    .get("message")
                    .and_then(|value| value.as_str())
                    .unwrap_or("The local Flow helper reported an error.");
                let details = helper_details(
                    &current_stderr_snapshot(&process, command_generation, child_id),
                    None,
                    false,
                );
                let event = helper_error_with_details(
                    command_generation,
                    code,
                    message,
                    details,
                );
                let _ = app.emit("quickque:flow", event);
            } else if event_type == Some("warning") {
                if event_generation != Some(command_generation)
                    || event.get("code").and_then(|value| value.as_str())
                        != Some("audio_dropped")
                {
                    continue;
                }
                if let Some(event) = validated_audio_dropped_warning(command_generation, &event) {
                    let _ = app.emit("quickque:flow", event);
                }
            } else if event_type == Some("audio_level") {
                if let Some(event) = validated_audio_level(command_generation, &event) {
                    let _ = app.emit("quickque:flow", event);
                }
            } else if event_generation == Some(command_generation) {
                let _ = app.emit("quickque:flow", event);
            }
        }

        let exited = process.lock().ok().and_then(|mut state| {
            if state.child.as_ref().map(Child::id) == Some(child_id) {
                Some((
                    state.generation,
                    state.child.take(),
                    state.stdin.take(),
                    state.stderr.take(),
                ))
            } else {
                None
            }
        });
        if let Some((generation, child, stdin, stderr)) = exited {
            let termination = child.map(|child| finish_helper_after_stdout_eof(child, stdin));
            let stderr = stderr.map(StderrCapture::finish).unwrap_or_default();
            let still_current = process
                .lock()
                .ok()
                .map(|state| state.generation == generation)
                .unwrap_or(false);
            if still_current {
                if let Some(termination) = termination {
                    if !termination.cleanup_forced {
                        if let Some(status) = termination.status.as_ref() {
                            if let Some((stage, value)) = exit_status_diagnostic(status) {
                                let _ = app.emit(
                                    "quickque:flow",
                                    diagnostic_numeric_event(generation, stage, value),
                                );
                            }
                        }
                    }
                    if termination.cleanup_forced {
                        let _ = app.emit(
                            "quickque:flow",
                            diagnostic_event(generation, "helper_cleanup_forced"),
                        );
                    }
                    let details = helper_details(
                        &stderr,
                        termination.status.as_ref(),
                        termination.cleanup_forced,
                    );
                    let _ = app.emit(
                        "quickque:flow",
                        helper_error_with_details(
                            generation,
                            "helper_exited",
                            "The local Flow helper exited unexpectedly.",
                            details,
                        ),
                    );
                } else {
                    let _ = app.emit(
                        "quickque:flow",
                        helper_error_with_details(
                            generation,
                            "helper_exited",
                            "The local Flow helper exited unexpectedly.",
                            helper_details(&stderr, None, false),
                        ),
                    );
                }
            }
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
    let _command_lock = state
        .flow
        .command_lock
        .lock()
        .map_err(|_| "Flow command state is unavailable.".to_string())?;
    let (accepted, previous) = state.flow.accept_generation(command.generation)?;
    if !accepted {
        return Err("An older Flow command was ignored.".to_string());
    }
    let _ = app.emit(
        "quickque:flow",
        diagnostic_event(command.generation, "rust_command_received"),
    );
    FlowState::reap(previous);

    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    {
        let _ = app.emit(
            "quickque:flow",
            status_event(
                command.generation,
                "unsupported",
                Some("Local Flow requires macOS 26 or later on Apple Silicon."),
            ),
        );
        return Ok(());
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    match flow_protocol::route(command.action.as_str()) {
        Some(flow_protocol::FlowRoute::Status(status)) => {
            let _ = app.emit(
                "quickque:flow",
                status_event(command.generation, status, None),
            );
            Ok(())
        }
        Some(flow_protocol::FlowRoute::Helper { loading }) => {
            if loading {
                let _ = app.emit(
                    "quickque:flow",
                    status_event(
                        command.generation,
                        "loading",
                        Some("Checking the installed Apple speech assets…"),
                    ),
                );
            }
            spawn_helper(app, Arc::clone(&state.flow.process), &command)
        }
        None => Err("Unknown Flow action.".to_string()),
    }
}

#[tauri::command]
fn open_microphone_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("Could not open Microphone settings: {error}"))
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Microphone settings are available only on macOS.".to_string())
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
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .manage(local_library::LocalLibraryState::default())
        .invoke_handler(tauri::generate_handler![
            flow_command,
            open_microphone_settings,
            remote_start,
            remote_stop,
            remote_approve,
            remote_reject,
            remote_snapshot,
            remote_publish_state,
            remote_take_commands,
            remote_pairing_pending,
            remote_status,
            local_library::get_local_library,
            local_library::choose_local_directory,
            local_library::save_local_library
        ])
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_allowlist_includes_native_audio_stages_and_exit_metadata() {
        for stage in [
            "audio_buffer_received",
            "audio_conversion_begin",
            "audio_conversion_complete",
            "vad_inference_begin",
            "vad_inference_complete",
            "asr_append_begin",
            "asr_append_complete",
            "asr_process_begin",
            "asr_process_complete",
            "asr_warmup_begin",
            "asr_warmup_complete",
            "vad_warmup_begin",
            "vad_warmup_complete",
            "helper_exit_code",
            "helper_exit_signal",
            "helper_cleanup_forced",
            "apple_support_check_begin",
            "apple_support_check_complete",
            "apple_assets_check_begin",
            "apple_assets_check_complete",
            "apple_assets_download_begin",
            "apple_assets_download_complete",
            "apple_analyzer_prepare_begin",
            "apple_analyzer_prepare_complete",
            "apple_analyzer_ready",
        ] {
            assert!(is_diagnostic_stage(Some(stage)), "stage was not allowlisted: {stage}");
        }
        assert!(!is_diagnostic_stage(Some("private_payload")));
    }

    #[test]
    fn stderr_tail_bounds_utf8_text_and_marks_truncation() {
        let mut tail = StderrTail::default();
        tail.push("prefix ".as_bytes());
        tail.push("é".repeat(MAXIMUM_STDERR_BYTES).as_bytes());

        let snapshot = tail.snapshot();
        assert!(snapshot.truncated);
        assert!(snapshot.text.len() <= MAXIMUM_STDERR_BYTES);
        assert!(std::str::from_utf8(snapshot.text.as_bytes()).is_ok());
        assert!(snapshot.text.ends_with('é'));
    }

    #[test]
    fn stderr_reader_uses_fixed_chunks_for_huge_no_newline_input() {
        let input = vec![b'x'; MAXIMUM_STDERR_BYTES * 4 + 17];
        let mut tail = StderrTail::default();
        read_stderr_to_tail(std::io::Cursor::new(input), |chunk| tail.push(chunk))
            .expect("in-memory stderr reader should complete");

        let snapshot = tail.snapshot();
        assert!(snapshot.truncated);
        assert_eq!(snapshot.text.len(), MAXIMUM_STDERR_BYTES);
        assert!(snapshot.text.chars().all(|character| character == 'x'));
    }

    #[cfg(unix)]
    #[test]
    fn stderr_snapshot_returns_partial_tail_before_writer_eof() {
        use std::os::unix::net::UnixStream;

        let (mut writer, reader) = UnixStream::pair().expect("unix stream pair");
        let (observed_sender, observed_receiver) = std::sync::mpsc::channel();
        let capture = StderrCapture::spawn_reader_with_progress(reader, Some(observed_sender));
        writer
            .write_all(b"partial stderr")
            .expect("write partial stderr");
        observed_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("reader observed the partial stderr without EOF");

        let (snapshot_sender, snapshot_receiver) = std::sync::mpsc::channel();
        let snapshot_thread = std::thread::spawn(move || {
            let _ = snapshot_sender.send(capture.snapshot());
        });
        let snapshot_result = snapshot_receiver.recv_timeout(Duration::from_secs(1));

        // Closing the writer also releases a buggy reader that still holds
        // the tail lock; join before asserting so a failed implementation
        // cannot leave a blocked test thread behind.
        drop(writer);
        let snapshot = snapshot_result
            .expect("snapshot returned while the writer remained open");
        snapshot_thread.join().expect("snapshot worker joined");
        assert_eq!(snapshot.text, "partial stderr");
    }

    #[cfg(unix)]
    #[test]
    fn stderr_finish_is_bounded_with_writer_held_open() {
        use std::os::unix::net::UnixStream;

        let (mut writer, reader) = UnixStream::pair().expect("unix stream pair");
        let (observed_sender, observed_receiver) = std::sync::mpsc::channel();
        let capture = StderrCapture::spawn_reader_with_progress(reader, Some(observed_sender));
        writer.write_all(b"held open").expect("write stderr");
        observed_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("reader observed stderr");

        let (finished_sender, finished_receiver) = std::sync::mpsc::channel();
        let finish_thread = std::thread::spawn(move || {
            let _ = finished_sender.send(capture.finish());
        });
        let finished_result =
            finished_receiver.recv_timeout(STDERR_DRAIN_WAIT + Duration::from_secs(1));

        // The writer is closed after the bounded finish so the detached
        // reader can reach EOF; then join the finish worker deterministically.
        drop(writer);
        finish_thread.join().expect("finish worker joined");
        let finished = finished_result.expect("finish returned within the bounded drain interval");
        assert_eq!(finished.text, "held open");
    }

    #[test]
    fn stderr_tail_buffers_are_independent_between_children() {
        let mut first = StderrTail::default();
        let mut second = StderrTail::default();
        first.push(b"first child");
        second.push(b"second child");

        assert_eq!(first.snapshot().text, "first child");
        assert_eq!(second.snapshot().text, "second child");
    }

    #[test]
    fn audio_dropped_warning_is_rebuilt_with_fixed_shape() {
        let input = serde_json::json!({
            "type": "warning",
            "generation": 9,
            "code": "audio_dropped",
            "droppedFrames": 12,
            "queuedFrames": 80_000,
            "message": "untrusted",
            "private": "discarded",
        });
        let warning = validated_audio_dropped_warning(9, &input).expect("warning is valid");
        assert_eq!(
            warning,
            serde_json::json!({
                "type": "warning",
                "generation": 9,
                "code": "audio_dropped",
                "message": "Audio input frames were dropped while processing.",
                "droppedFrames": 12,
                "queuedFrames": 80_000,
            })
        );
        assert!(validated_audio_dropped_warning(
            9,
            &serde_json::json!({
                "type": "warning",
                "generation": 9,
                "code": "audio_dropped",
                "droppedFrames": 1,
                "queuedFrames": 80_001,
            })
        )
        .is_none());
        assert!(validated_audio_dropped_warning(
            9,
            &serde_json::json!({
                "type": "warning",
                "generation": 9,
                "code": "audio_dropped",
                "droppedFrames": -1,
                "queuedFrames": 1,
            })
        )
        .is_none());
    }

    #[test]
    fn audio_level_is_rebuilt_with_fixed_shape_and_bounds() {
        let input = serde_json::json!({
            "type": "audio_level",
            "generation": 9,
            "level": 0.625,
            "message": "untrusted",
            "private": "discarded",
        });
        let level = validated_audio_level(9, &input).expect("audio level is valid");
        assert_eq!(
            level,
            serde_json::json!({
                "type": "audio_level",
                "generation": 9,
                "level": 0.625,
            })
        );

        for value in [
            serde_json::json!(-0.001),
            serde_json::json!(1.001),
            serde_json::json!("0.5"),
            serde_json::json!(true),
            serde_json::Value::Null,
        ] {
            assert!(
                validated_audio_level(
                    9,
                    &serde_json::json!({
                        "type": "audio_level",
                        "generation": 9,
                        "level": value,
                    })
                )
                .is_none(),
                "invalid level should not cross the bridge: {value}"
            );
        }
        assert!(validated_audio_level(
            10,
            &serde_json::json!({
                "type": "audio_level",
                "generation": 9,
                "level": 0.5,
            })
        )
        .is_none());
    }

    #[test]
    fn helper_exit_details_keep_stderr_separate_from_exit_metadata() {
        let stderr = StderrSnapshot {
            text: "native failure".to_string(),
            truncated: true,
        };
        let details = helper_details(&stderr, None, true);
        assert_eq!(details["stderr"], "native failure");
        assert!(details["exitCode"].is_null());
        assert!(details["signal"].is_null());
        assert_eq!(details["cleanupForced"], true);
        assert_eq!(details["stderrTruncated"], true);
    }

    #[cfg(unix)]
    #[test]
    fn helper_exit_details_preserve_natural_exit_status() {
        use std::os::unix::process::ExitStatusExt;

        let status = ExitStatus::from_raw(23 << 8);
        let details = helper_details(
            &StderrSnapshot::default(),
            Some(&status),
            false,
        );
        assert_eq!(details["exitCode"], 23);
        assert!(details["signal"].is_null());
        assert_eq!(details["cleanupForced"], false);
    }

    #[cfg(unix)]
    #[test]
    fn maps_exit_status_to_fixed_numeric_diagnostic() {
        use std::os::unix::process::ExitStatusExt;

        let code = ExitStatus::from_raw(23 << 8);
        assert_eq!(
            exit_status_diagnostic(&code),
            Some(("helper_exit_code", 23))
        );

        let signal = ExitStatus::from_raw(9);
        assert_eq!(
            exit_status_diagnostic(&signal),
            Some(("helper_exit_signal", 9))
        );
    }
}

fn is_diagnostic_stage(stage: Option<&str>) -> bool {
    matches!(
        stage,
        Some(
            "rust_command_received"
                | "helper_spawn_begin"
                | "helper_spawned"
                | "helper_command_sent"
                | "helper_boot"
                | "helper_read_wait"
                | "helper_command_received"
                | "model_check_begin"
                | "model_check_complete"
                | "microphone_request_begin"
                | "microphone_authorized"
                | "asr_load_begin"
                | "asr_load_complete"
                | "vad_load_begin"
                | "vad_load_complete"
                | "asr_warmup_begin"
                | "asr_warmup_complete"
                | "vad_warmup_begin"
                | "vad_warmup_complete"
                | "audio_engine_start"
                | "audio_engine_listening"
                | "audio_buffer_received"
                | "audio_conversion_begin"
                | "audio_conversion_complete"
                | "vad_inference_begin"
                | "vad_inference_complete"
                | "asr_append_begin"
                | "asr_append_complete"
                | "asr_process_begin"
                | "asr_process_complete"
                | "helper_exit_code"
                | "helper_exit_signal"
                | "helper_cleanup_forced"
                | "apple_support_check_begin"
                | "apple_support_check_complete"
                | "apple_assets_check_begin"
                | "apple_assets_check_complete"
                | "apple_assets_download_begin"
                | "apple_assets_download_complete"
                | "apple_analyzer_prepare_begin"
                | "apple_analyzer_prepare_complete"
                | "apple_analyzer_ready"
                | "download_manifest_begin"
                | "download_manifest_complete"
                | "download_files_begin"
                | "download_files_complete"
        )
    )
}

const COOPERATIVE_CLEANUP_POLL: Duration = Duration::from_millis(10);

fn finish_helper_after_stdout_eof(
    mut child: Child,
    stdin: Option<ChildStdin>,
) -> HelperTermination {
    // Check first so a naturally crashed/exited helper is never killed and
    // reported as though Rust performed the cleanup.
    if let Ok(Some(status)) = child.try_wait() {
        return HelperTermination {
            status: Some(status),
            cleanup_forced: false,
        };
    }

    // EOF means the helper has stopped producing protocol events. Closing
    // stdin gives a healthy helper a bounded opportunity to tear down
    // cooperatively; never wait indefinitely on a wedged child.
    drop(stdin);
    let deadline = Instant::now() + COOPERATIVE_CLEANUP_WAIT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return HelperTermination {
                    status: Some(status),
                    cleanup_forced: false,
                };
            }
            Ok(None) => {}
            Err(_) => break,
        }
        if Instant::now() >= deadline {
            break;
        }
        std::thread::sleep(COOPERATIVE_CLEANUP_POLL);
    }

    // Perform one last non-blocking observation before forcing cleanup. The
    // status from this path is deliberately not reported as a crash: it is
    // the result of our own kill rather than the helper's natural exit.
    if let Ok(Some(status)) = child.try_wait() {
        return HelperTermination {
            status: Some(status),
            cleanup_forced: false,
        };
    }
    let cleanup_forced = child.kill().is_ok();
    if cleanup_forced {
        // Do not expose the signal produced by our kill as though it were
        // the helper's exit status. The only trustworthy status in this
        // path would have been observed before kill().
        let _ = child.wait();
        return HelperTermination {
            status: None,
            cleanup_forced: true,
        };
    }
    let status = child.wait().ok();
    HelperTermination {
        status,
        cleanup_forced,
    }
}

const COOPERATIVE_CLEANUP_WAIT: Duration = Duration::from_millis(250);

struct HelperTermination {
    status: Option<ExitStatus>,
    cleanup_forced: bool,
}

const STDERR_READ_CHUNK_BYTES: usize = 4096;

#[derive(Debug, Default)]
struct StderrTail {
    bytes: Vec<u8>,
    truncated: bool,
}

impl StderrCapture {
    fn spawn(reader: ChildStderr) -> Self {
        Self::spawn_reader_with_progress(reader, None)
    }

    fn spawn_reader<R>(reader: R) -> Self
    where
        R: Read + Send + 'static,
    {
        Self::spawn_reader_with_progress(reader, None)
    }

    fn spawn_reader_with_progress<R>(reader: R, progress: Option<Sender<()>>) -> Self
    where
        R: Read + Send + 'static,
    {
        let tail = Arc::new(Mutex::new(StderrTail::default()));
        let (completed_sender, completed) = mpsc::channel();
        let reader_tail = Arc::clone(&tail);
        let reader = std::thread::spawn(move || {
            let read_result = read_stderr_to_tail(reader, |chunk| {
                // Never hold the tail lock while waiting for another pipe
                // read. A live helper is allowed to keep stderr open while
                // stdout reports an error, so snapshots must remain
                // immediately observable.
                let appended = if let Ok(mut tail) = reader_tail.lock() {
                    tail.push(chunk);
                    true
                } else {
                    false
                };
                if appended {
                    if let Some(progress) = progress.as_ref() {
                        let _ = progress.send(());
                    }
                }
            });
            if read_result.is_err() {
                if let Ok(mut tail) = reader_tail.lock() {
                    tail.mark_incomplete();
                }
            }
            let _ = completed_sender.send(());
        });
        Self {
            tail,
            completed,
            reader: Some(reader),
        }
    }

    fn snapshot(&self) -> StderrSnapshot {
        self.tail
            .lock()
            .map(|tail| tail.snapshot())
            .unwrap_or_else(|_| StderrSnapshot {
                text: String::new(),
                truncated: true,
            })
    }

    fn finish(mut self) -> StderrSnapshot {
        let completed = self.completed.recv_timeout(STDERR_DRAIN_WAIT).is_ok();
        if completed {
            if let Some(reader) = self.reader.take() {
                let _ = reader.join();
            }
        } else if let Ok(mut tail) = self.tail.lock() {
            tail.mark_incomplete();
        }
        self.snapshot()
    }
}

struct StderrCapture {
    tail: Arc<Mutex<StderrTail>>,
    completed: Receiver<()>,
    reader: Option<JoinHandle<()>>,
}

fn exit_status_details(status: Option<&ExitStatus>) -> (Option<i32>, Option<i32>) {
    let Some(status) = status else {
        return (None, None);
    };
    let exit_code = status.code();

    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;

        (exit_code, status.signal())
    }

    #[cfg(not(unix))]
    {
        (exit_code, None)
    }
}

fn current_stderr_snapshot(
    process: &Arc<Mutex<ProcessState>>,
    generation: u64,
    child_id: u32,
) -> StderrSnapshot {
    process
        .lock()
        .ok()
        .filter(|state| {
            state.generation == generation
                && state.child.as_ref().map(Child::id) == Some(child_id)
        })
        .and_then(|state| state.stderr.as_ref().map(StderrCapture::snapshot))
        .unwrap_or_default()
}

fn validated_audio_dropped_warning(
    generation: u64,
    event: &serde_json::Value,
) -> Option<serde_json::Value> {
    if event.get("type").and_then(|value| value.as_str()) != Some("warning")
        || event.get("generation").and_then(|value| value.as_u64()) != Some(generation)
        || event.get("code").and_then(|value| value.as_str()) != Some("audio_dropped")
    {
        return None;
    }
    let dropped_frames = event.get("droppedFrames").and_then(|value| value.as_u64())?;
    let queued_frames = event
        .get("queuedFrames")
        .and_then(|value| value.as_u64())
        .filter(|value| *value <= 80_000)?;
    Some(serde_json::json!({
        "type": "warning",
        "generation": generation,
        "code": "audio_dropped",
        "message": "Audio input frames were dropped while processing.",
        "droppedFrames": dropped_frames,
        "queuedFrames": queued_frames,
    }))
}

fn validated_audio_level(
    generation: u64,
    event: &serde_json::Value,
) -> Option<serde_json::Value> {
    if event.get("type").and_then(|value| value.as_str()) != Some("audio_level")
        || event.get("generation").and_then(|value| value.as_u64()) != Some(generation)
    {
        return None;
    }
    let level = event
        .get("level")
        .and_then(|value| value.as_f64())
        .filter(|value| value.is_finite() && (0.0..=1.0).contains(value))?;
    Some(serde_json::json!({
        "type": "audio_level",
        "generation": generation,
        "level": level,
    }))
}

fn read_stderr_to_tail<R, F>(mut reader: R, mut append: F) -> io::Result<()>
where
    R: Read,
    F: FnMut(&[u8]),
{
    let mut chunk = [0_u8; STDERR_READ_CHUNK_BYTES];
    loop {
        match reader.read(&mut chunk) {
            Ok(0) => return Ok(()),
            Ok(size) => append(&chunk[..size]),
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
}

impl StderrTail {
    fn push(&mut self, chunk: &[u8]) {
        if chunk.is_empty() {
            return;
        }
        let overflow = self
            .bytes
            .len()
            .saturating_add(chunk.len())
            .saturating_sub(MAXIMUM_STDERR_BYTES);
        if overflow > 0 {
            self.truncated = true;
            if overflow >= self.bytes.len() {
                self.bytes.clear();
            } else {
                self.bytes.drain(..overflow);
            }
        }
        let remaining = MAXIMUM_STDERR_BYTES.saturating_sub(self.bytes.len());
        if chunk.len() > remaining {
            self.truncated = true;
            self.bytes.extend_from_slice(&chunk[chunk.len() - remaining..]);
        } else {
            self.bytes.extend_from_slice(chunk);
        }
    }

    fn mark_incomplete(&mut self) {
        // A reader that outlives the bounded drain may still have bytes in
        // the native pipe. Surface that fact rather than presenting a
        // partial snapshot as complete.
        self.truncated = true;
    }

    fn snapshot(&self) -> StderrSnapshot {
        let mut text = String::from_utf8_lossy(&self.bytes).into_owned();
        // A tail can begin in the middle of a UTF-8 sequence, and lossy
        // conversion expands malformed bytes to U+FFFD. Keep the externally
        // visible text bounded as well as the captured bytes.
        if text.len() > MAXIMUM_STDERR_BYTES {
            let start = text
                .char_indices()
                .find_map(|(index, _)| {
                    (text.len().saturating_sub(index) <= MAXIMUM_STDERR_BYTES).then_some(index)
                })
                .unwrap_or(text.len());
            text.drain(..start);
        }
        StderrSnapshot {
            text,
            truncated: self.truncated,
        }
    }
}

const STDERR_DRAIN_WAIT: Duration = Duration::from_millis(250);

fn helper_details(
    stderr: &StderrSnapshot,
    status: Option<&ExitStatus>,
    cleanup_forced: bool,
) -> serde_json::Value {
    let (exit_code, signal) = exit_status_details(status);
    serde_json::json!({
        "stderr": stderr.text.clone(),
        "exitCode": exit_code,
        "signal": signal,
        "cleanupForced": cleanup_forced,
        "stderrTruncated": stderr.truncated,
    })
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct StderrSnapshot {
    text: String,
    truncated: bool,
}
