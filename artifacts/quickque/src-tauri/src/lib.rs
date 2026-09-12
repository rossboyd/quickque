use serde::{Deserialize, Serialize};
use std::{
    io::{self, BufRead, BufReader, Read, Write},
    process::{Child, ChildStderr, ChildStdin, Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver, Sender},
        Arc, Mutex,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
mod remote;
mod turbo;
mod script_audio;
mod debug_licence;
use remote::{RemoteInfo, RemoteService, RemoteSnapshot, RemoteStatus};

mod local_library;
mod flow_protocol;
mod voice_allowance;
mod scene_speech_state;
use scene_speech_state::{
    terminate_scene_speech_child, SceneSpeechProcess, SceneSpeechState,
};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct FlowCommand {
    action: String,
    generation: u64,
    #[serde(default)]
    session_id: Option<String>,
}

const MAXIMUM_STDERR_BYTES: usize = 8192;
static NEXT_SCENE_SPEECH_REQUEST_ID: AtomicU64 = AtomicU64::new(1);
#[derive(Default)]
struct ProcessState {
    allowance: voice_allowance::VoiceAllowance,
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
    scene_speech: SceneSpeechState,
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
        process.allowance.pause(std::time::Instant::now());
        let previous = process
            .child
            .take()
            .map(|child| (child, process.stdin.take(), process.stderr.take()));
        process.generation = generation;
        Ok((true, previous))
    }

    fn reap(&self, mut process: Option<(Child, Option<ChildStdin>, Option<StderrCapture>)>) -> Result<(), String> {
        if let Some((mut child, stdin, stderr)) = process.take() {
            drop(stdin);
            let stopped = (|| -> Result<(), String> {
                match child.try_wait() {
                    Ok(Some(_)) => return Ok(()),
                    Ok(None) => {}
                    Err(_) => return Err("FLOW_STOP_FAILED: Could not inspect the microphone helper. Restart Quickque.".to_string()),
                }
                if child.kill().is_err() {
                    // A natural exit can race kill. Only a reaped exit is an
                    // acknowledgement, never the kill request alone.
                    return match child.try_wait() {
                        Ok(Some(_)) => Ok(()),
                        _ => Err("FLOW_STOP_FAILED: Could not stop the microphone helper. Restart Quickque.".to_string()),
                    };
                }
                child.wait()
                    .map(|_| ())
                    .map_err(|_| "FLOW_STOP_FAILED: Microphone helper shutdown was not confirmed. Restart Quickque.".to_string())
            })();
            if let Err(error) = stopped {
                // Keep ownership for the next stop/app-exit attempt. Every
                // command reaps this child before starting another helper.
                let mut state = self.process.lock()
                    .map_err(|_| "FLOW_STOP_FAILED: Microphone process state is unavailable. Restart Quickque.".to_string())?;
                state.child = Some(child);
                state.stderr = stderr;
                return Err(error);
            }
            if let Some(stderr) = stderr {
                let _ = stderr.finish();
            }
        }
        Ok(())
    }

    fn shutdown(&self) {
        let process = self.process.lock().ok().and_then(|mut state| {
            let child = state.child.take()?;
            Some((child, state.stdin.take(), state.stderr.take()))
        });
        // Closing the command pipe lets a healthy helper tear down its
        // microphone and inference before the unconditional kill below.
        let _ = self.reap(process);
    }
}

impl Drop for FlowState {
    fn drop(&mut self) {
        self.shutdown();
    }
}

impl SceneSpeechState {
    fn stop(&self) -> Result<(), String> {
        let _spawn_guard = self
            .spawn_lock
            .lock()
            .map_err(|_| "SCENE_SPEECH_STATE_UNAVAILABLE: Scene speech start state is unavailable.".to_string())?;
        let child = {
            let mut process = self
                .process
                .lock()
                .map_err(|_| "SCENE_SPEECH_STATE_UNAVAILABLE: Scene speech state is unavailable.".to_string())?;
            process.invalidate_all();
            let child = process.child.take();
            if child.is_some() {
                process.stopping = true;
            }
            child
        };
        if let Some(child) = child {
            if let Err((child, error)) =
                terminate_scene_speech_child(child, stop_scene_speech_child)
            {
                self.record_stop_failure(child);
                return Err(error);
            }
            self.finish_stop();
        }
        Ok(())
    }

    fn stop_request(&self, request_id: u64) -> Result<(), String> {
        let _spawn_guard = self
            .spawn_lock
            .lock()
            .map_err(|_| "SCENE_SPEECH_STATE_UNAVAILABLE: Scene speech start state is unavailable.".to_string())?;
        let child = {
            let mut process = self
                .process
                .lock()
                .map_err(|_| "SCENE_SPEECH_STATE_UNAVAILABLE: Scene speech state is unavailable.".to_string())?;
            // IPC requests can cross on different threads. A late stop from a
            // previous frontend turn must never terminate a newer helper.
            if !process.accepts_stop(request_id) {
                return Ok(());
            }
            let child = process.child.take();
            if child.is_some() {
                process.stopping = true;
            }
            child
        };
        if let Some(child) = child {
            if let Err((child, error)) =
                terminate_scene_speech_child(child, stop_scene_speech_child)
            {
                self.record_stop_failure(child);
                return Err(error);
            }
            self.finish_stop();
        }
        Ok(())
    }

    fn finish_stop(&self) {
        if let Ok(mut process) = self.process.lock() {
            process.stopping = false;
        }
    }

    fn record_stop_failure(&self, child: Arc<Mutex<Child>>) {
        if let Ok(mut process) = self.process.lock() {
            // Keep the child reachable for process-drop cleanup. More
            // importantly, fail closed: no later scene start may overlap a
            // helper whose termination was not acknowledged.
            process.stopping = false;
            process.stop_failed = true;
            if process.child.is_none() {
                process.child = Some(child);
            }
        }
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

fn stop_scene_speech_child(child: &Arc<Mutex<Child>>) -> Result<(), String> {
    // The helper owns AVSpeechSynthesizer. Killing the isolated helper is the
    // reliable cancellation boundary; no Flow/ASR process or microphone is
    // involved, and the OS tears down the helper's synthesizer with it.
    let mut child = child
        .lock()
        .map_err(|_| "SCENE_SPEECH_STOP_FAILED: Scene speech process state is unavailable.".to_string())?;
    match child.try_wait() {
        Ok(Some(_)) => return Ok(()),
        Ok(None) => {}
        Err(_) => {
            return Err(
                "SCENE_SPEECH_STOP_FAILED: Could not inspect the local speech process."
                    .to_string(),
            )
        }
    }
    child
        .kill()
        .map_err(|_| "SCENE_SPEECH_STOP_FAILED: Could not stop local system speech.".to_string())?;
    child
        .wait()
        .map(|_| ())
        .map_err(|_| "SCENE_SPEECH_STOP_FAILED: Local system speech did not exit.".to_string())
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const MAXIMUM_SCENE_SPEECH_RESPONSE_BYTES: usize = 1024 * 1024;

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const MAXIMUM_SCENE_SPEECH_TEXT_BYTES: usize = 100_000;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SceneSpeechHelperVoice {
    id: String,
    name: String,
    language: String,
    engine: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct SceneSpeechVoiceList {
    voices: Vec<SceneSpeechHelperVoice>,
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
#[derive(Debug, Deserialize)]
struct SceneSpeechHelperFailure {
    error: String,
    message: String,
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
#[derive(Debug, Deserialize)]
struct SceneSpeechHelperCompletion {
    status: String,
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SceneSpeechRequest<'a> {
    text: &'a str,
    voice_id: &'a str,
    rate: f32,
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn scene_speech_helper_path() -> Result<std::path::PathBuf, String> {
    if let Some(path) = std::env::var_os("QUICKQUE_SPEECH_HELPER") {
        return Ok(path.into());
    }
    let executable = std::env::current_exe()
        .map_err(|error| format!("SCENE_SPEECH_HELPER_UNAVAILABLE: Could not locate Quickque: {error}"))?;
    Ok(executable
        .parent()
        .ok_or_else(|| "SCENE_SPEECH_HELPER_UNAVAILABLE: Quickque executable has no parent directory.".to_string())?
        .join("quickque-speech"))
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn read_scene_speech_output<R: Read>(mut reader: R) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    reader
        .by_ref()
        .take((MAXIMUM_SCENE_SPEECH_RESPONSE_BYTES + 1) as u64)
        .read_to_end(&mut output)
        .map_err(|_| "SCENE_SPEECH_HELPER_PROTOCOL: Could not read the local speech response.".to_string())?;
    if output.len() > MAXIMUM_SCENE_SPEECH_RESPONSE_BYTES {
        return Err("SCENE_SPEECH_HELPER_PROTOCOL: The local speech response was too large.".to_string());
    }
    Ok(output)
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn scene_speech_failure_message(output: &[u8]) -> String {
    serde_json::from_slice::<SceneSpeechHelperFailure>(output)
        .ok()
        .filter(|failure| {
            failure.error.starts_with("SCENE_SPEECH_")
                && !failure.error.is_empty()
                && !failure.message.is_empty()
        })
        .map(|failure| format!("{}: {}", failure.error, failure.message))
        .unwrap_or_else(|| {
            "SCENE_SPEECH_HELPER_FAILED: The local system speech service failed.".to_string()
        })
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn scene_speech_list_local_voices_native() -> Result<SceneSpeechVoiceList, String> {
    let output = Command::new(scene_speech_helper_path()?)
        .arg("--list")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .stdout(Stdio::piped())
        .output()
        .map_err(|error| format!("SCENE_SPEECH_HELPER_UNAVAILABLE: Could not start local system speech: {error}"))?;
    if !output.status.success() {
        return Err(scene_speech_failure_message(&output.stdout));
    }
    let voices = serde_json::from_slice::<SceneSpeechVoiceList>(&output.stdout)
        .map_err(|_| "SCENE_SPEECH_HELPER_PROTOCOL: The local speech service returned an invalid voice list.".to_string())?;
    if voices.voices.iter().any(|voice| {
        voice.engine != "system"
            || voice.id.is_empty()
            || voice.name.is_empty()
            || voice.language.is_empty()
    }) {
        return Err("SCENE_SPEECH_HELPER_PROTOCOL: The local speech service returned an invalid voice.".to_string());
    }
    Ok(voices)
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn scene_speech_speak_native(
    state: &SceneSpeechState,
    mut command: Command,
    text: String,
    voice_id: String,
    rate: f32,
    request_id: u64,
) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("SCENE_SPEECH_TEXT_EMPTY: Scene speech needs dialogue text to speak.".to_string());
    }
    if text.len() > MAXIMUM_SCENE_SPEECH_TEXT_BYTES {
        return Err("SCENE_SPEECH_TEXT_TOO_LONG: This dialogue turn is too long for one speech request.".to_string());
    }
    if voice_id.trim().is_empty() {
        return Err("SCENE_SPEECH_VOICE_REQUIRED: Choose an installed system voice before starting playback.".to_string());
    }
    if !rate.is_finite() || !(0.5..=2.0).contains(&rate) {
        return Err("SCENE_SPEECH_RATE_INVALID: The requested system speech rate is unavailable.".to_string());
    }

    // A stop may arrive while this worker is spawning, sending stdin, or
    // registering the child. Keep that entire interval serialized with stop,
    // so stop cannot acknowledge cancellation before this helper is either
    // registered for reaping or rejected without receiving dialogue.
    let spawn_guard = state
        .spawn_lock
        .lock()
        .map_err(|_| "SCENE_SPEECH_STATE_UNAVAILABLE: Scene speech start state is unavailable.".to_string())?;

    // Stop and reap the previous helper before creating another one. This is
    // intentionally a process boundary rather than a shared synthesizer queue:
    // an old delegate callback has no path to complete a newer scene turn.
    let previous = {
        let mut process = state
            .process
            .lock()
            .map_err(|_| "SCENE_SPEECH_STATE_UNAVAILABLE: Scene speech state is unavailable.".to_string())?;
        if !process.accepts_start(request_id) {
            return Err("SCENE_SPEECH_CANCELLED: Scene speech request was superseded before playback started.".to_string());
        }
        let previous = process.child.take();
        if previous.is_some() {
            process.stopping = true;
        }
        previous
    };
    if let Some(previous) = previous {
        if let Err(error) = stop_scene_speech_child(&previous) {
            state.record_stop_failure(previous);
            return Err(error);
        }
        state.finish_stop();
    }
    let can_start = state
        .process
        .lock()
        .map_err(|_| "SCENE_SPEECH_STATE_UNAVAILABLE: Scene speech state is unavailable.".to_string())?
        .can_start_helper(request_id);
    if !can_start {
        return Err("SCENE_SPEECH_CANCELLED: Scene speech was cancelled before playback started.".to_string());
    }

    let mut process = command
        .arg("--speak")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("SCENE_SPEECH_HELPER_UNAVAILABLE: Could not start local system speech: {error}"))?;
    let request = SceneSpeechRequest {
        text: &text,
        voice_id: &voice_id,
        rate,
    };
    let write_result = process
        .stdin
        .as_mut()
        .ok_or_else(|| "SCENE_SPEECH_HELPER_PROTOCOL: Local system speech stdin was unavailable.".to_string())
        .and_then(|stdin| {
            serde_json::to_writer(&mut *stdin, &request)
                .map_err(|_| "SCENE_SPEECH_HELPER_PROTOCOL: Could not encode local system speech.".to_string())?;
            stdin.flush().map_err(|_| {
                "SCENE_SPEECH_HELPER_PROTOCOL: Could not send local system speech.".to_string()
            })
        });
    // Close stdin after the one request. The helper never receives dialogue as
    // a command-line argument or writes it to a file/log.
    drop(process.stdin.take());
    if let Err(error) = write_result {
        let _ = process.kill();
        let _ = process.wait();
        return Err(error);
    }
    let stdout = process
        .stdout
        .take()
        .ok_or_else(|| "SCENE_SPEECH_HELPER_PROTOCOL: Local system speech stdout was unavailable.".to_string())?;
    let child = Arc::new(Mutex::new(process));
    let active = {
        let mut state_process = state
            .process
            .lock()
            .map_err(|_| "SCENE_SPEECH_STATE_UNAVAILABLE: Scene speech state is unavailable.".to_string())?;
        if !state_process.can_start_helper(request_id) {
            false
        } else {
            state_process.child = Some(Arc::clone(&child));
            true
        }
    };
    if !active {
        if let Err(error) = stop_scene_speech_child(&child) {
            state.record_stop_failure(child);
            return Err(error);
        }
        return Err("SCENE_SPEECH_CANCELLED: Scene speech was cancelled before playback started.".to_string());
    }
    // Do not hold the spawn barrier while waiting for AVSpeechSynthesizer.
    // `scene_speech_stop` can now take the barrier, kill this registered
    // child, and wait for process teardown.
    drop(spawn_guard);
    let generation = request_id;

    let output = match read_scene_speech_output(stdout) {
        Ok(output) => output,
        Err(error) => {
            if let Err(stop_error) = stop_scene_speech_child(&child) {
                state.record_stop_failure(child);
                return Err(stop_error);
            }
            let mut state_process = state.process.lock().map_err(|_| {
                "SCENE_SPEECH_STATE_UNAVAILABLE: Scene speech state is unavailable.".to_string()
            })?;
            if state_process
                .child
                .as_ref()
                .is_some_and(|active| Arc::ptr_eq(active, &child))
            {
                state_process.child = None;
            }
            return Err(error);
        }
    };
    let status = child
        .lock()
        .map_err(|_| "SCENE_SPEECH_STATE_UNAVAILABLE: Scene speech process is unavailable.".to_string())?
        .wait()
        .map_err(|_| "SCENE_SPEECH_HELPER_FAILED: The local system speech process could not finish.".to_string())?;
    let current = {
        let mut state_process = state
            .process
            .lock()
            .map_err(|_| "SCENE_SPEECH_STATE_UNAVAILABLE: Scene speech state is unavailable.".to_string())?;
        let current = state_process.generation == generation
            && !state_process.cancelled
            && state_process
                .child
                .as_ref()
                .is_some_and(|active| Arc::ptr_eq(active, &child));
        if current {
            state_process.child = None;
        }
        current
    };
    if !current {
        return Err("SCENE_SPEECH_CANCELLED: Scene speech was cancelled.".to_string());
    }
    if !status.success() {
        return Err(scene_speech_failure_message(&output));
    }
    let completion = serde_json::from_slice::<SceneSpeechHelperCompletion>(&output)
        .map_err(|_| "SCENE_SPEECH_HELPER_PROTOCOL: The local speech service returned an invalid completion.".to_string())?;
    if completion.status != "finished" {
        return Err("SCENE_SPEECH_HELPER_PROTOCOL: The local speech service returned an unknown completion.".to_string());
    }
    Ok(())
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

    if command.action == "start" {
        monitor_voice_allowance(app.clone(), Arc::clone(&process), command_generation, child_id);
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
                if event_type == Some("status") {
                    if let Ok(mut state) = process.lock() {
                        if state.generation == command_generation && state.child.as_ref().map(Child::id) == Some(child_id) {
                            if event["status"] == "listening" { state.allowance.start(std::time::Instant::now()); }
                            else { state.allowance.pause(std::time::Instant::now()); }
                        }
                    }
                }
                let _ = app.emit("quickque:flow", event);
            }
        }

        let exited = process.lock().ok().and_then(|mut state| {
            if state.child.as_ref().map(Child::id) == Some(child_id) {
                state.allowance.pause(std::time::Instant::now());
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

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn monitor_voice_allowance(app: AppHandle, process: Arc<Mutex<ProcessState>>, generation: u64, child_id: u32) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(25));
        let expired = match process.lock() {
            Ok(state) if state.generation == generation && state.child.as_ref().map(Child::id) == Some(child_id) =>
                state.allowance.running() && state.allowance.expired(std::time::Instant::now()),
            _ => return,
        };
        if !expired { continue; }
        let state = app.state::<AppState>();
        let Ok(_guard) = state.flow.command_lock.lock() else { return; };
        let previous = {
            let Ok(mut current) = process.lock() else { return; };
            if current.generation != generation || current.child.as_ref().map(Child::id) != Some(child_id) { return; }
            if !current.allowance.expired(std::time::Instant::now()) { continue; }
            current.allowance.pause(std::time::Instant::now());
            current.child.take().map(|child| (child, current.stdin.take(), current.stderr.take()))
        };
        match state.flow.reap(previous) {
            Ok(()) => { let _ = app.emit("quickque:flow", status_event(generation, "limit-reached", Some("Your 30 seconds of free Voice Follow for this session are used. Continue in manual mode."))); }
            Err(error) => { let _ = app.emit("quickque:flow", status_event(generation, "error", Some(&error))); }
        }
        return;
    });
}

#[tauri::command]
fn debug_licence_get() -> bool { debug_licence::licensed() }

#[tauri::command]
fn debug_licence_set(app: AppHandle, state: tauri::State<'_, AppState>, licensed: bool) -> Result<bool, String> {
    let _guard = state.flow.command_lock.lock().map_err(|_| "Voice Follow state unavailable.")?;
    let mut process = state.flow.process.lock().map_err(|_| "Voice allowance unavailable.")?;
    debug_licence::save(&app, licensed)?;
    process.allowance.set_unlimited(licensed);
    drop(process);
    if !licensed { let _ = script_audio::cancel(&app.state::<script_audio::AudioState>()); }
    Ok(licensed)
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
    state.flow.reap(previous)?;
    if command.action == "start" {
        let mut process = state.flow.process.lock().map_err(|_| "Voice allowance unavailable.")?;
        let session = command.session_id.as_deref().unwrap_or("legacy-reader");
        if session.is_empty() || session.len() > 200 { return Err("Invalid reader session.".into()); }
        process.allowance.session(session, script_audio::paid(), std::time::Instant::now());
        if process.allowance.expired(std::time::Instant::now()) {
            let _ = app.emit("quickque:flow", status_event(command.generation, "limit-reached", Some("Your 30 seconds of free Voice Follow for this session are used. Continue in manual mode.")));
            return Ok(());
        }
    }

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
fn scene_speech_next_request_id() -> Result<u64, String> {
    // Tokens are allocated in the native process, not a webview module. They
    // remain strictly increasing when React rebuilds adapters or a webview
    // reloads, so a delayed stop can always be recognized as stale.
    loop {
        let current = NEXT_SCENE_SPEECH_REQUEST_ID.load(Ordering::Relaxed);
        if current == u64::MAX {
            return Err(
                "SCENE_SPEECH_STATE_UNAVAILABLE: Scene speech request tokens are exhausted. Restart Quickque."
                    .to_string(),
            );
        }
        if NEXT_SCENE_SPEECH_REQUEST_ID
            .compare_exchange_weak(current, current + 1, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
        {
            return Ok(current);
        }
    }
}

#[tauri::command]
async fn scene_speech_list_local_voices(app: AppHandle) -> Result<SceneSpeechVoiceList, String> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let system = scene_speech_list_local_voices_native();
            if turbo::status(&app).ok().and_then(|s| s.get("status").and_then(serde_json::Value::as_str).map(str::to_owned)).as_deref() == Some("ready") {
                let mut voices = system.unwrap_or(SceneSpeechVoiceList { voices: vec![] });
                voices.voices.push(SceneSpeechHelperVoice { id: turbo::VOICE_ID.into(), name: "Chatterbox Default".into(), language: "en".into(), engine: "turbo".into() });
                Ok(voices)
            } else { system }
        })
            .await
            .map_err(|_| "SCENE_SPEECH_HELPER_FAILED: The local speech service did not complete.".to_string())?
    }

    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    {
        Err("SCENE_SPEECH_UNSUPPORTED: Local system speech requires macOS on Apple Silicon.".to_string())
    }
}

#[tauri::command]
async fn scene_speech_speak(
    app: AppHandle,
    engine: Option<String>,
    state: tauri::State<'_, AppState>,
    text: String,
    voice_id: String,
    rate: f32,
    request_id: u64,
) -> Result<(), String> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        let command = match engine.as_deref().unwrap_or("system") {
            "system" => Command::new(scene_speech_helper_path()?),
            "turbo" => {
                if voice_id != turbo::VOICE_ID || rate != 1.0 {
                    return Err("SCENE_SPEECH_VOICE_UNAVAILABLE: Choose Chatterbox Default at its natural speaking rate.".into());
                }
                turbo::command(&app)?
            },
            _ => return Err("SCENE_SPEECH_VOICE_UNAVAILABLE: Unknown speech engine.".into()),
        };
        let process = Arc::clone(&state.scene_speech.process);
        let spawn_lock = Arc::clone(&state.scene_speech.spawn_lock);
        tauri::async_runtime::spawn_blocking(move || {
            scene_speech_speak_native(
                &SceneSpeechState {
                    process,
                    spawn_lock,
                },
                command,
                text,
                voice_id,
                rate,
                request_id,
            )
        })
        .await
        .map_err(|_| "SCENE_SPEECH_HELPER_FAILED: The local speech service did not complete.".to_string())?
    }

    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    {
        let _ = (app, engine, state, text, voice_id, rate, request_id);
        Err("SCENE_SPEECH_UNSUPPORTED: Local system speech requires macOS on Apple Silicon.".to_string())
    }
}

#[tauri::command]
async fn scene_speech_stop(
    state: tauri::State<'_, AppState>,
    request_id: u64,
) -> Result<(), String> {
    let process = Arc::clone(&state.scene_speech.process);
    let spawn_lock = Arc::clone(&state.scene_speech.spawn_lock);
    tauri::async_runtime::spawn_blocking(move || {
        SceneSpeechState {
            process,
            spawn_lock,
        }
        .stop_request(request_id)
    })
    .await
    .map_err(|_| "SCENE_SPEECH_STATE_UNAVAILABLE: Scene speech stop did not complete.".to_string())?
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
fn open_system_voice_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // macOS pane URLs change between releases. Open the app reliably and
        // show the Read & Speak navigation steps in Quickque.
        let status = Command::new("open")
            .args(["-b", "com.apple.systempreferences"])
            .status()
            .map_err(|error| format!("Could not open System Settings: {error}"))?;
        if status.success() {
            Ok(())
        } else {
            Err("macOS could not open System Settings.".to_string())
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("System voice settings are available only on macOS.".to_string())
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
        .manage(turbo::InstallState::default())
        .manage(script_audio::AudioState::default())
        .manage(local_library::LocalLibraryState::default())
        .setup(|app| { debug_licence::load(app.handle()); Ok(()) })
        .invoke_handler(tauri::generate_handler![
            debug_licence_get,
            debug_licence_set,
            flow_command,
            script_audio::script_audio_entitlement,
            script_audio::script_audio_status,
            script_audio::script_audio_generate,
            script_audio::script_audio_cancel,
            script_audio::script_audio_read,
            script_audio::script_audio_export,
            script_audio::script_audio_delete,
            turbo::turbo_status,
            turbo::turbo_install,
            turbo::turbo_cancel_install,
            scene_speech_next_request_id,
            scene_speech_list_local_voices,
            scene_speech_speak,
            scene_speech_stop,
            open_microphone_settings,
            open_system_voice_settings,
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
            let _ = state.scene_speech.stop();
            let _ = script_audio::cancel(&handle.state::<script_audio::AudioState>());
            let _ = turbo::cancel(&handle.state::<turbo::InstallState>());
            state.remote.stop();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scene_speech_stop_before_start_rejects_that_request() {
        let mut state = SceneSpeechProcess::default();
        assert!(state.accepts_stop(7));
        assert!(state.cancelled);
        assert!(!state.accepts_start(7));
        assert!(state.accepts_start(8));
        assert_eq!(state.generation, 8);
        assert!(!state.cancelled);
    }

    #[test]
    fn stale_scene_speech_stop_cannot_cancel_newer_turn() {
        let mut state = SceneSpeechProcess::default();
        assert!(state.accepts_start(4));
        assert!(state.accepts_start(5));
        assert!(!state.accepts_stop(4));
        assert_eq!(state.generation, 5);
        assert!(!state.cancelled);
        assert!(state.accepts_stop(5));
        assert!(state.cancelled);
    }

    #[test]
    fn scene_speech_shutdown_invalidates_pending_start() {
        let mut state = SceneSpeechProcess::default();
        assert!(state.accepts_start(11));
        state.invalidate_all();
        assert!(state.cancelled);
        assert!(!state.accepts_start(11));
        assert!(state.accepts_start(13));
    }

    #[test]
    fn injected_scene_speech_termination_returns_child_on_failure() {
        let mut calls = 0;
        let failure = terminate_scene_speech_child("active-helper", |_| {
            calls += 1;
            Err("SCENE_SPEECH_STOP_FAILED: forced test failure".to_string())
        });
        assert_eq!(calls, 1);
        assert_eq!(
            failure,
            Err((
                "active-helper",
                "SCENE_SPEECH_STOP_FAILED: forced test failure".to_string(),
            ))
        );
    }

    #[test]
    fn scene_speech_stop_failure_blocks_future_starts() {
        let mut state = SceneSpeechProcess::default();
        assert!(state.accepts_start(3));
        state.stop_failed = true;
        assert!(!state.accepts_start(4));
    }

    #[test]
    fn scene_speech_stop_waits_for_pending_spawn_reservation() {
        let state = SceneSpeechState::default();
        let reservation = state
            .spawn_lock
            .lock()
            .expect("test spawn reservation should be available");
        let stopper = SceneSpeechState {
            process: Arc::clone(&state.process),
            spawn_lock: Arc::clone(&state.spawn_lock),
        };
        let (done_sender, done_receiver) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            let result = stopper.stop_request(1);
            done_sender.send(result).expect("test receiver should remain available");
        });

        assert!(
            done_receiver
                .recv_timeout(std::time::Duration::from_millis(25))
                .is_err(),
            "stop must not acknowledge while spawn/write/register owns the barrier",
        );
        drop(reservation);
        assert_eq!(
            done_receiver
                .recv_timeout(std::time::Duration::from_secs(1))
                .expect("stop should complete once reservation releases"),
            Ok(())
        );
        worker.join().expect("stop worker should not panic");
    }

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
