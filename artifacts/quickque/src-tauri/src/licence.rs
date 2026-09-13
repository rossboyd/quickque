//! Device-bound offline leases. Private signing keys never ship in the app.
use std::{sync::{Mutex, OnceLock}, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use quickque_licence_core::{access, verify, Access, Envelope, Lease};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stored { licence_key: String, envelope: Option<Envelope>, last_seen: u64 }
#[derive(Default)]
struct Cache { stored: Stored, lease: Option<Lease>, device: String, error: Option<String>, loaded_at: Option<(Instant,u64)> }
static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
static NETWORK: Mutex<()> = Mutex::new(());
fn cache() -> &'static Mutex<Cache> { CACHE.get_or_init(|| Mutex::new(Cache::default())) }
fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() }
fn keys() -> Vec<(String,String)> { serde_json::from_str(option_env!("QUICKQUE_LICENCE_PUBLIC_KEYS").unwrap_or("[]")).unwrap_or_default() }
fn release_date() -> u64 { option_env!("QUICKQUE_RELEASE_TIMESTAMP").unwrap_or("0").parse().unwrap_or(0) }
fn endpoint() -> &'static str { option_env!("QUICKQUE_LICENCE_SERVER").unwrap_or("") }
fn configured() -> bool { endpoint().starts_with("https://") && !keys().is_empty() && release_date() > 0 }

#[cfg(target_os = "macos")]
fn device_id() -> Result<String,String> {
    let result = std::process::Command::new("/usr/sbin/ioreg").args(["-rd1", "-c", "IOPlatformExpertDevice"]).output().map_err(|_| "Could not identify this Mac.")?;
    if !result.status.success() { return Err("Could not identify this Mac.".into()); }
    let output = String::from_utf8_lossy(&result.stdout);
    let identity = output.lines().find(|line| line.contains("\"IOPlatformUUID\""))
        .and_then(|line| line.split('=').nth(1)).map(|value| value.trim().trim_matches('"'))
        .filter(|value| value.len() == 36).ok_or("Could not identify this Mac.")?;
    Ok(format!("{:x}", Sha256::digest(format!("quickque-device-v1:{identity}"))))
}
#[cfg(not(target_os = "macos"))]
fn device_id() -> Result<String,String> { Err("Licence activation requires the Quickque Mac app.".into()) }
#[cfg(target_os = "macos")]
fn read_stored() -> Result<Stored,String> {
    match security_framework::passwords::get_generic_password("com.quickque.licence", "lease-v1") {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "Saved licence data is invalid. Activate your licence again.".into()),
        Err(error) if error.code() == -25300 => Ok(Stored::default()),
        Err(_) => Err("Unlock your Mac keychain to read the saved licence.".into()),
    }
}
#[cfg(not(target_os = "macos"))]
fn read_stored() -> Result<Stored,String> { Ok(Stored::default()) }
#[cfg(target_os = "macos")]
fn write_stored(stored: &Stored) -> Result<(),String> {
    let bytes = serde_json::to_vec(stored).map_err(|_| "Could not encode licence data.")?;
    security_framework::passwords::set_generic_password("com.quickque.licence", "lease-v1", &bytes).map_err(|_| "Could not save the licence to your Mac keychain.".into())
}
#[cfg(not(target_os = "macos"))]
fn write_stored(_: &Stored) -> Result<(),String> { Err("Licence activation requires the Quickque Mac app.".into()) }

pub fn load() {
    if !configured() { return; }
    let result = (|| -> Result<Cache,String> {
        let device = device_id()?;
        let mut stored = read_stored()?;
        let lease = stored.envelope.as_ref().map(|env| verify(env, &keys(), &device)).transpose()?;
        // Save a high-water clock reading across launches. Never decrease it on reload.
        stored.last_seen = stored.last_seen.max(now());
        write_stored(&stored)?;
        Ok(Cache { stored, lease, device, error:None, loaded_at:Some((Instant::now(),now())) })
    })();
    if let Ok(mut current) = cache().lock() { match result { Ok(value) => *current=value, Err(error) => current.error=Some(error) } }
}
fn access_for(current: &Cache) -> Option<Access> {
    let monotonic_floor = current.loaded_at.map(|(instant, time)| time.saturating_add(instant.elapsed().as_secs())).unwrap_or(0);
    current.lease.as_ref().map(|lease| access(lease, now(), current.stored.last_seen.max(monotonic_floor), release_date()))
}
pub fn has_feature(feature: &str) -> bool {
    if crate::debug_licence::licensed() { return true; }
    cache().lock().ok().is_some_and(|current| current.error.is_none() && access_for(&current)==Some(Access::Active) && current.lease.as_ref().is_some_and(|lease| lease.features.iter().any(|item| item==feature)))
}
#[tauri::command]
pub fn licence_status() -> Value {
    let Ok(current) = cache().lock() else { return json!({"status":"error", "message":"Licence state is unavailable."}); };
    let (status,message) = match access_for(&current) {
        Some(Access::Active) => ("active", "Your licence is verified on this Mac."),
        Some(Access::Expired) => ("expired", "Connect to renew your offline licence lease."),
        Some(Access::Revoked) => ("revoked", "This licence is no longer active. Check your purchase or contact support."),
        Some(Access::UpdateRequired) => ("version-not-covered", "This version was released after your update entitlement ended. Use an eligible older version or renew updates."),
        Some(Access::ClockIncorrect) => ("clock-error", "Your Mac clock moved backwards. Correct the date and time, then check your licence online."),
        None => (if configured() { "unlicensed" } else { "not-configured" }, if configured() { "Activate a purchase to enable paid features." } else { "Purchase activation is not connected in this build yet." }),
    };
    json!({"status": if current.error.is_some() {"error"} else {status}, "message":current.error.as_deref().unwrap_or(message),
        "configured":configured(), "testingBypass":crate::debug_licence::licensed(),
        "plan":current.lease.as_ref().map(|l| &l.plan), "offlineUntil":current.lease.as_ref().and_then(|l| l.expires_at),
        "updatesUntil":current.lease.as_ref().and_then(|l| l.updates_until), "lastChecked":current.lease.as_ref().map(|l| l.issued_at),
        "canRefresh":!current.stored.licence_key.is_empty()})
}
fn request(action: &str, key: &str, device: &str) -> Result<(Envelope,Lease),String> {
    if !configured() { return Err("Purchase activation is not connected in this build yet.".into()); }
    let client = reqwest::blocking::Client::builder().https_only(true).redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(15)).build().map_err(|_| "Could not start licence connection.")?;
    let response = client.post(format!("{}/{}",endpoint().trim_end_matches('/'),action)).json(&json!({"licenceKey":key,"deviceId":device})).send()
        .map_err(|_| "Could not reach the licence server. Your saved offline lease is unchanged.")?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() { 401 => "Licence key not recognised.", 409 => "This licence has reached its Mac limit. Deactivate another Mac first.", 429 => "Too many attempts. Wait a minute and retry.", _ => "Licence service unavailable. Your saved offline lease is unchanged." }.into());
    }
    use std::io::Read;
    let mut bytes=Vec::new(); response.take(32769).read_to_end(&mut bytes).map_err(|_| "Could not read licence response.")?;
    if bytes.len()>32768 { return Err("Licence response was too large.".into()); }
    let env: Envelope=serde_json::from_slice(&bytes).map_err(|_| "Invalid licence response.")?;
    let lease=verify(&env,&keys(),device)?;
    if lease.issued_at > now().saturating_add(300) { return Err("Check your Mac date and time before activating.".into()); }
    Ok((env,lease))
}
fn exchange(app: &AppHandle, action: &str, supplied_key: Option<String>) -> Result<Value,String> {
    let _network=NETWORK.lock().map_err(|_| "Licence operation unavailable.")?;
    let (key,device,last_seen,previous)= {
        let current=cache().lock().map_err(|_| "Licence state unavailable.")?;
        (supplied_key.unwrap_or_else(|| current.stored.licence_key.clone()), if current.device.is_empty() {device_id()?} else {current.device.clone()}, current.stored.last_seen, current.lease.clone())
    };
    if key.len()!=46 || !key.starts_with("QQ-") || !key[3..].bytes().all(|b| b.is_ascii_alphanumeric() || b==b'-' || b==b'_') { return Err("Enter a valid Quickque licence key.".into()); }
    let (envelope,lease)=request(action,&key,&device)?;
    if previous.as_ref().is_some_and(|old| old.licence_id==lease.licence_id && old.issued_at>lease.issued_at) { return Err("The server returned an older licence lease.".into()); }
    let stored=Stored {licence_key:if action=="deactivate" {String::new()} else {key},envelope:Some(envelope),last_seen:now().max(lease.issued_at)};
    write_stored(&stored)?;
    { let mut current=cache().lock().map_err(|_| "Licence state unavailable.")?; *current=Cache{stored,lease:Some(lease),device,error:None,loaded_at:Some((Instant::now(),now()))}; }
    let status=licence_status(); let _=app.emit("licence-changed",&status); Ok(status)
}
#[tauri::command]
pub async fn licence_activate(app: AppHandle, licence_key: String) -> Result<Value,String> { tauri::async_runtime::spawn_blocking(move || exchange(&app,"activate",Some(licence_key.trim().to_string()))).await.map_err(|_| "Licence activation task failed.".to_string())? }
#[tauri::command]
pub async fn licence_refresh(app: AppHandle) -> Result<Value,String> { tauri::async_runtime::spawn_blocking(move || exchange(&app,"renew",None)).await.map_err(|_| "Licence refresh task failed.".to_string())? }
#[tauri::command]
pub async fn licence_deactivate(app: AppHandle) -> Result<Value,String> { tauri::async_runtime::spawn_blocking(move || exchange(&app,"deactivate",None)).await.map_err(|_| "Licence deactivation task failed.".to_string())? }

pub fn start_background(app: AppHandle) {
    // Startup is local. Refresh never blocks launch or a paid operation.
    std::thread::spawn(move || loop {
        let due=cache().lock().ok().is_some_and(|current| !current.stored.licence_key.is_empty() && current.lease.as_ref().is_some_and(|lease| now()>=lease.refresh_after));
        if due { let _=exchange(&app,"renew",None); }
        // Checkpoint time without writing credentials on every feature check.
        if let Ok(mut current)=cache().lock() {
            if current.lease.is_some() { current.stored.last_seen=current.stored.last_seen.max(now()); let _=write_stored(&current.stored); }
        }
        std::thread::sleep(Duration::from_secs(3600));
    });
}
