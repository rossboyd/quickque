//! Temporary owner-requested licence simulation, including packaged test builds.
//! This is deliberately not payment or licence verification.
use std::{fs, sync::{atomic::{AtomicBool, Ordering}, Mutex}};
use tauri::{AppHandle, Manager};
static LICENSED: AtomicBool = AtomicBool::new(false);
static WRITE_LOCK: Mutex<()> = Mutex::new(());
pub fn licensed() -> bool { LICENSED.load(Ordering::SeqCst) }
pub fn load(app: &AppHandle) {
    let value = app.path().app_data_dir().ok()
        .and_then(|dir| fs::read(dir.join("debug-licence.json")).ok())
        .and_then(|bytes| serde_json::from_slice::<bool>(&bytes).ok()).unwrap_or(false);
    LICENSED.store(value, Ordering::SeqCst);
}
pub fn save(app: &AppHandle, licensed: bool) -> Result<(), String> {
    let _guard = WRITE_LOCK.lock().map_err(|_| "Debug licence preference unavailable.")?;
    let dir = app.path().app_data_dir().map_err(|_| "Could not locate app settings.")?;
    fs::create_dir_all(&dir).map_err(|_| "Could not save debug licence preference.")?;
    let pending = dir.join("debug-licence.pending");
    fs::write(&pending, if licensed { "true" } else { "false" }).map_err(|_| "Could not save debug licence preference.")?;
    fs::rename(&pending, dir.join("debug-licence.json")).map_err(|_| "Could not save debug licence preference.")?;
    LICENSED.store(licensed, Ordering::SeqCst);
    Ok(())
}
