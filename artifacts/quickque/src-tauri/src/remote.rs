//! Account-free, LAN-only phone remote.  This module deliberately uses the
//! standard library: the remote remains available in an offline installation.
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

const CODE_TTL: Duration = Duration::from_secs(300);
const MAX_REQUESTS: usize = 60;
const WINDOW: Duration = Duration::from_secs(10);
const MAX_CONNECTIONS: usize = 16;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSnapshot {
    #[serde(default)]
    pub connected: bool,
    #[serde(default)]
    pub approved: bool,
    pub mode: String,
    pub section: u32,
    pub elapsed_ms: u64,
    pub font_size: u16,
    pub scroll_speed: i16,
    pub position: i32,
    pub playing: bool,
    pub section_count: u32,
}

impl Default for RemoteSnapshot {
    fn default() -> Self {
        Self { connected: false, approved: false, mode: "manual".into(), section: 0, elapsed_ms: 0, font_size: 100, scroll_speed: 0, position: 0, playing: false, section_count: 0 }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub url: String,
    pub code: String,
    pub expires_in_seconds: u64,
    pub session_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlRequest {
    pub action: String,
    #[serde(default)]
    pub value: Option<i32>,
    #[serde(default)]
    pub request_id: String,
}

#[derive(Clone)]
pub struct RemoteService {
    inner: Arc<Mutex<Inner>>,
    stopping: Arc<AtomicBool>,
    active_connections: Arc<AtomicUsize>,
}

struct Inner {
    session: Option<Session>,
    snapshot: RemoteSnapshot,
    events: VecDeque<(u64, serde_json::Value)>,
    commands: VecDeque<ControlRequest>,
    next_event: u64,
    limits: HashMap<String, Vec<Instant>>,
    listener: Option<Arc<TcpListener>>,
}
struct Session {
    id: String,
    code: String,
    expires: Instant,
    controller: Option<String>,
    used_requests: HashMap<String, Instant>,
}

impl Default for RemoteService {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                session: None,
                snapshot: Default::default(),
                events: VecDeque::new(),
                commands: VecDeque::new(),
                next_event: 0,
                limits: HashMap::new(),
                listener: None,
            })),
            stopping: Arc::new(AtomicBool::new(false)),
            active_connections: Arc::new(AtomicUsize::new(0)),
        }
    }
}

struct ConnectionPermit(Arc<AtomicUsize>);

impl Drop for ConnectionPermit {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

impl RemoteService {
    pub fn start(&self) -> Result<RemoteInfo, String> {
        self.stop();
        self.stopping.store(false, Ordering::SeqCst);
        let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0)).map_err(|e| format!("Could not open LAN remote: {e}"))?;
        listener.set_nonblocking(true).ok();
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let id = entropy()?;
        let code = format!("{:06}", (u64::from_str_radix(&id[..8], 16).unwrap_or(1) % 1_000_000));
        let expires = Instant::now() + CODE_TTL;
        let listener = Arc::new(listener);
        {
            let mut g = self.inner.lock().map_err(|_| "Remote state unavailable".to_string())?;
            g.session = Some(Session { id: id.clone(), code: code.clone(), expires, controller: None, used_requests: HashMap::new() });
            g.snapshot = RemoteSnapshot::default();
            g.events.clear();
            g.commands.clear();
            g.limits.clear();
            g.listener = Some(listener.clone());
        }
        let this = self.clone();
        thread::spawn(move || this.accept_loop(listener));
        let ip = usable_lan_ip().unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST));
        Ok(RemoteInfo { url: format!("http://{ip}:{port}/"), code, expires_in_seconds: CODE_TTL.as_secs(), session_id: id })
    }

    pub fn stop(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        if let Ok(mut g) = self.inner.lock() {
            g.session = None;
            g.listener = None;
            g.events.clear();
            g.commands.clear();
            g.limits.clear();
            g.snapshot.connected = false;
            g.snapshot.approved = false;
        }
    }

    pub fn snapshot(&self) -> RemoteSnapshot { self.inner.lock().map(|g| g.snapshot.clone()).unwrap_or_default() }
    pub fn take_commands(&self) -> Vec<ControlRequest> {
        self.inner.lock().map(|mut g| g.commands.drain(..).collect()).unwrap_or_default()
    }
    pub fn set_snapshot(&self, mut snapshot: RemoteSnapshot) -> Result<(), String> {
        let mut g = self.inner.lock().map_err(|_| "Remote state unavailable".to_string())?;
        if g.session.is_none() { return Err("Remote session is stopped".into()); }
        snapshot.connected = g.snapshot.connected;
        snapshot.approved = g.snapshot.approved;
        g.snapshot = snapshot;
        let event_id = g.next_event;
        g.next_event += 1;
        let event = serde_json::json!({"type":"snapshot","snapshot":g.snapshot.clone()});
        g.events.push_back((event_id, event));
        if g.events.len() > 128 { g.events.pop_front(); }
        Ok(())
    }
    pub fn pairing_pending(&self) -> bool {
        self.inner.lock().ok().and_then(|g| g.session.as_ref().map(|s| s.expires > Instant::now() && s.controller.is_some() && !g.snapshot.approved)).unwrap_or(false)
    }
    pub fn approve(&self, session_id: &str) -> Result<(), String> {
        let mut g = self.inner.lock().map_err(|_| "Remote state unavailable".to_string())?;
        // Approval only permits the already requested controller; it never creates
        // a credential from an arbitrary caller.
        let token = {
            let s = g.session.as_mut().ok_or("No remote session is active")?;
            if s.id != session_id || s.expires < Instant::now() { return Err("Pairing session expired".into()); }
            s.controller.clone().ok_or("No phone is awaiting approval")?
        };
        g.snapshot.approved = true;
        g.snapshot.connected = true;
        let event_id = g.next_event;
        g.next_event += 1;
        g.events.push_back((event_id, serde_json::json!({"type":"approved","token":token})));
        Ok(())
    }
    pub fn reject(&self) { if let Ok(mut g) = self.inner.lock() { if let Some(s) = g.session.as_mut() { s.controller = None; } g.snapshot.connected = false; g.snapshot.approved = false; } }

    fn accept_loop(&self, listener: Arc<TcpListener>) {
        while !self.stopping.load(Ordering::SeqCst) && self.is_current_listener(&listener) {
            match listener.accept() {
                Ok((mut stream, addr)) => {
                    let Some(permit) = self.try_acquire_connection() else {
                        respond(&mut stream, 503, "Service Unavailable", "too many connections");
                        continue;
                    };
                    let this = self.clone();
                    thread::spawn(move || {
                        let _permit = permit;
                        this.handle(stream, addr);
                    });
                }
                Err(_) => thread::sleep(Duration::from_millis(30)),
            }
        }
    }

    fn try_acquire_connection(&self) -> Option<ConnectionPermit> {
        self.active_connections
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |active| {
                (active < MAX_CONNECTIONS).then_some(active + 1)
            })
            .ok()
            .map(|_| ConnectionPermit(Arc::clone(&self.active_connections)))
    }

    fn is_current_listener(&self, listener: &Arc<TcpListener>) -> bool {
        self.inner
            .lock()
            .ok()
            .and_then(|state| state.listener.as_ref().map(|current| Arc::ptr_eq(current, listener)))
            .unwrap_or(false)
    }
    fn handle(&self, mut stream: TcpStream, addr: SocketAddr) {
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut raw = Vec::with_capacity(4096);
        let mut one = [0u8; 1024];
        let header_end;
        loop {
            let Ok(n) = stream.read(&mut one) else { return };
            if n == 0 { return }
            raw.extend_from_slice(&one[..n]);
            if raw.windows(4).any(|w| w == b"\r\n\r\n") { break }
            if raw.len() > 16 * 1024 { respond(&mut stream, 413, "Request too large", ""); return }
        }
        let Some(end) = raw.windows(4).position(|w| w == b"\r\n\r\n") else { return };
        header_end = end + 4;
        let head = String::from_utf8_lossy(&raw[..end]).into_owned();
        let content_length = head.lines().find_map(|l| {
            let (k, v) = l.split_once(':')?;
            (k.eq_ignore_ascii_case("content-length")).then(|| v.trim().parse::<usize>().ok()).flatten()
        }).unwrap_or(0);
        if content_length > 16 * 1024 { respond(&mut stream, 413, "Request too large", ""); return }
        while raw.len() < header_end + content_length {
            let Ok(n) = stream.read(&mut one) else { return };
            if n == 0 { return }
            raw.extend_from_slice(&one[..n]);
        }
        let body = String::from_utf8_lossy(&raw[header_end..header_end + content_length]);
        let authorization = head.lines().find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("authorization").then_some(value.trim())
        });
        let mut line = head.lines();
        let Some(first) = line.next() else { return };
        let mut words = first.split_whitespace();
        let method = words.next().unwrap_or("");
        let target = words.next().unwrap_or("/");
        let key = addr.ip().to_string();
        if !self.allow(&key) { respond(&mut stream, 429, "Too Many Requests", "rate limit exceeded"); return }
        let (path, _query) = target.split_once('?').unwrap_or((target, ""));
        if method == "GET" && path == "/" { respond_html(&mut stream, MOBILE_PAGE); return }
        let content_type = head.lines().find_map(|l| l.strip_prefix("Content-Type:").or_else(|| l.strip_prefix("content-type:"))).unwrap_or("").trim();
        if method == "POST" && path == "/api/pair" {
            if !content_type.is_empty() && content_type != "text/plain" { respond(&mut stream, 415, "Unsupported Media Type", "expected text/plain"); return }
            let code = body.trim();
            match self.pair(code) { Ok(token) => respond_json(&mut stream, 202, &serde_json::json!({"status":"pending","token":token,"message":"Waiting for presenter approval"})), Err(e) => respond(&mut stream, 403, "Forbidden", &e) }
            return
        }
        if method == "GET" && path == "/api/events" {
            let token = bearer_token(authorization).unwrap_or_default();
            match self.events(&token) { Ok(v) => respond_json(&mut stream, 200, &v), Err(e) => respond(&mut stream, 401, "Unauthorized", &e) }
            return
        }
        if method == "POST" && path == "/api/control" {
            if content_type != "application/json" { respond(&mut stream, 415, "Unsupported Media Type", "expected application/json"); return }
            let token = bearer_token(authorization).unwrap_or_default();
            match serde_json::from_str::<ControlRequest>(&body).map_err(|_| "Malformed command".to_string()).and_then(|c| self.control(&token, c)) {
                Ok(v) => respond_json(&mut stream, 200, &v), Err(e) => {
                    let status = if e.contains("approved") || e.contains("expired") || e.contains("stopped") { 401 } else { 400 };
                    respond(&mut stream, status, if status == 401 { "Unauthorized" } else { "Bad Request" }, &e)
                }
            }; return
        }
        respond(&mut stream, 404, "Not Found", "not found");
    }
    fn allow(&self, key: &str) -> bool {
        let mut g = match self.inner.lock() { Ok(g) => g, Err(_) => return false };
        let now = Instant::now();
        let allowed = {
            let list = g.limits.entry(key.into()).or_default();
            list.retain(|t| now.duration_since(*t) < WINDOW);
            if list.len() >= MAX_REQUESTS { false } else { list.push(now); true }
        };
        if g.limits.len() > 1024 { g.limits.retain(|_, v| v.iter().any(|t| now.duration_since(*t) < WINDOW)); }
        allowed
    }
    fn pair(&self, code: &str) -> Result<String, String> {
        let mut g = self.inner.lock().map_err(|_| "Remote state unavailable".to_string())?;
        let s = g.session.as_mut().ok_or("Remote session is stopped")?;
        if s.expires <= Instant::now() || s.code != code { return Err("Pairing code is invalid or expired".into()) }
        if s.controller.is_some() { return Err("Another phone is already paired".into()) }
        let token = entropy()?;
        s.controller = Some(token.clone());
        g.snapshot.connected = true;
        let event_id = g.next_event;
        g.next_event += 1;
        g.events.push_back((event_id, serde_json::json!({"type":"pairingRequest"})));
        Ok(token)
    }
    fn events(&self, token: &str) -> Result<Vec<serde_json::Value>, String> {
        let g = self.inner.lock().map_err(|_| "Remote state unavailable".to_string())?;
        let s = g.session.as_ref().ok_or("Remote session is stopped")?;
        if s.controller.as_deref() != Some(token) || !g.snapshot.approved { return Err("Controller is not approved".into()) }
        Ok(g.events.iter().map(|(_,v)| v.clone()).chain(std::iter::once(serde_json::json!({"type":"snapshot","snapshot":g.snapshot}))).collect())
    }
    fn control(&self, token: &str, c: ControlRequest) -> Result<RemoteSnapshot, String> {
        let mut g = self.inner.lock().map_err(|_| "Remote state unavailable".to_string())?;
        if !g.snapshot.approved { return Err("Controller is not approved".into()) }
        {
            let s = g.session.as_mut().ok_or("Remote session is stopped")?;
            if s.controller.as_deref() != Some(token) { return Err("Controller is not approved".into()) }
            let now = Instant::now();
            s.used_requests.retain(|_, t| now.duration_since(*t) < Duration::from_secs(600));
            if s.used_requests.len() >= 4096 { return Err("Too many outstanding request ids".into()) }
            if c.request_id.is_empty() || c.request_id.len() > 80 || s.used_requests.insert(c.request_id.clone(), now).is_some() { return Err("Duplicate or missing request id".into()) }
        }
        let valid = matches!(c.action.as_str(), "playPause"|"previous"|"next"|"scrollSpeed"|"fontSize"|"position");
        if !valid { return Err("Unknown control action".into()) }
        if matches!(c.action.as_str(), "scrollSpeed"|"fontSize"|"position") && c.value.is_none() { return Err("This action requires a numeric value".into()) }
        if let Some(v) = c.value { if !(-100..=300).contains(&v) { return Err("Control value is out of range".into()) } }
        let event_id = g.next_event;
        g.next_event += 1;
        g.events.push_back((event_id, serde_json::json!({"type":"control","action":c.action,"value":c.value})));
        if g.commands.len() >= 128 {
            return Err("Reader command queue is busy".into());
        }
        g.commands.push_back(c);
        Ok(g.snapshot.clone())
    }
}

fn entropy() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    let mut file = std::fs::File::open("/dev/urandom")
        .map_err(|_| "Secure system randomness is unavailable".to_string())?;
    file.read_exact(&mut bytes)
        .map_err(|_| "Secure system randomness is unavailable".to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn usable_lan_ip() -> Option<IpAddr> { std::net::UdpSocket::bind("0.0.0.0:0").ok().and_then(|s| { s.connect("192.0.2.1:9").ok()?; Some(s.local_addr().ok()?.ip()) }) }
fn bearer_token(header: Option<&str>) -> Option<String> {
    header?.strip_prefix("Bearer ").filter(|token| !token.is_empty()).map(str::to_owned)
}
fn respond(stream: &mut TcpStream, status: u16, text: &str, body: &str) { let _ = write!(stream, "HTTP/1.1 {status} {text}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()); }
fn respond_json<T: Serialize>(stream: &mut TcpStream, status: u16, value: &T) { let body = serde_json::to_string(value).unwrap_or_else(|_| "{}".into()); let _ = write!(stream, "HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()); }
fn respond_html(stream: &mut TcpStream, body: &str) { let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()); }

const MOBILE_PAGE: &str = r#"<!doctype html><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Quickque Remote</title><style>*{box-sizing:border-box}body{font:18px system-ui;max-width:520px;margin:auto;padding:calc(18px + env(safe-area-inset-top)) 18px calc(18px + env(safe-area-inset-bottom));background:#10131b;color:#fff}button,input{font:inherit;padding:16px;margin:5px;border-radius:14px;border:1px solid #394052}button{min-width:44%;min-height:58px;background:#202636;color:#fff}button:active{transform:scale(.98)}button:disabled{opacity:.35;transform:none}input{width:58%;background:#fff;color:#111;font-size:24px;letter-spacing:.2em}#info{line-height:1.6;margin:18px 5px;padding:12px;background:#171c28;border-radius:12px}.primary{width:96%;min-height:92px;background:#fff;color:#111;font-size:24px}.row{display:flex}.row button{flex:1}.hint{color:#adb5c7;font-size:15px;line-height:1.5}</style><h1>Quickque Remote</h1><p id=s>Enter the code shown on your Mac.</p><div id=pairing><input id=c aria-label="Pairing code" inputmode=numeric pattern="[0-9]*" maxlength=6><button onclick=pair()>Pair</button><p class=hint>Keep Quickque awake and both devices on the same trusted network. A firewall, guest Wi-Fi isolation, or an unsupported browser can block the connection.</p></div><div id=controls hidden><div id=info aria-live=polite></div><button class=primary onclick=go('playPause')>Play / Pause</button><div class=row><button onclick=go('previous')>Previous section</button><button onclick=go('next')>Next section</button></div><div class=row><button data-manual onclick=go('scrollSpeed',-5)>Speed −</button><button data-manual onclick=go('scrollSpeed',5)>Speed +</button></div><div class=row><button onclick=go('fontSize',-4)>Font −</button><button onclick=go('fontSize',4)>Font +</button></div><div class=row><button data-manual onclick=go('position',-40)>Position −</button><button data-manual onclick=go('position',40)>Position +</button></div></div><script>let t=sessionStorage.qqToken||'';const q=new URLSearchParams(location.search);c.value=q.get('code')||'';function pair(){if(!/^\d{6}$/.test(c.value)){s.textContent='Enter the six-digit code.';return}fetch('/api/pair',{method:'POST',headers:{'Content-Type':'text/plain'},body:c.value}).then(async r=>{let x=await r.json().catch(()=>({}));if(r.ok){t=x.token;sessionStorage.qqToken=t;s.textContent='Waiting for presenter approval…'}else{s.textContent=x.message||'The code is invalid, expired, or another controller is paired.'}}).catch(()=>s.textContent='Cannot reach Quickque. Check the network and firewall.') }function id(){if(!globalThis.crypto||!crypto.getRandomValues){s.textContent='This browser is unsupported. Update it and try again.';return null}let b=new Uint8Array(16);crypto.getRandomValues(b);return Array.from(b,x=>x.toString(16).padStart(2,'0')).join('')}function auth(){return{'Authorization':'Bearer '+t}}function go(a,v){let requestId=id();if(!requestId)return;fetch('/api/control',{method:'POST',headers:{...auth(),'Content-Type':'application/json'},body:JSON.stringify({action:a,value:v,requestId})}).then(r=>{if(!r.ok)s.textContent=r.status===401?'Controller approval expired. Pair again.':'Command rejected.'}).catch(()=>s.textContent='Connection lost — retrying…')}async function poll(){if(!t)return;try{let r=await fetch('/api/events',{headers:auth()});if(r.status===401){controls.hidden=true;pairing.hidden=false;s.textContent='Waiting for presenter approval…';return}if(!r.ok)throw 0;let es=await r.json();controls.hidden=false;pairing.hidden=true;s.textContent='Connected';es.forEach(e=>{let x=e.snapshot;if(x){let m=x.mode==='flow'?'Voice Follow':'Manual';let sec=x.sectionCount?x.section+1:0;let time=new Date(x.elapsedMs).toISOString().slice(14,19);info.textContent=(x.playing?'Playing':'Paused')+' · '+m+' · Section '+sec+'/'+x.sectionCount+' · '+time;document.querySelectorAll('[data-manual]').forEach(b=>b.disabled=x.mode!=='manual')}})}catch(_){s.textContent='Connection lost — retrying…'}}setInterval(poll,1000);poll()</script>"#;

#[cfg(test)]
mod tests {
    use super::*;

    fn approved() -> (RemoteService, RemoteInfo, String) {
        let remote = RemoteService::default();
        let info = remote.start().unwrap();
        let token = remote.pair(&info.code).unwrap();
        remote.approve(&info.session_id).unwrap();
        (remote, info, token)
    }

    fn command(action: &str, value: Option<i32>, request_id: &str) -> ControlRequest {
        ControlRequest { action: action.into(), value, request_id: request_id.into() }
    }

    #[test]
    fn pairing_requires_presenter_approval_and_allows_only_one_controller() {
        let remote = RemoteService::default();
        let info = remote.start().unwrap();
        let token = remote.pair(&info.code).unwrap();
        assert!(remote.pair(&info.code).is_err());
        assert!(remote.events(&token).is_err());
        assert!(remote.control(&token, command("next", None, "before-approval")).is_err());
        remote.approve(&info.session_id).unwrap();
        assert!(remote.events(&token).is_ok());
    }

    #[test]
    fn expired_pairing_cannot_be_approved() {
        let remote = RemoteService::default();
        let info = remote.start().unwrap();
        remote.pair(&info.code).unwrap();
        remote.inner.lock().unwrap().session.as_mut().unwrap().expires = Instant::now();
        assert!(!remote.pairing_pending());
        assert!(remote.approve(&info.session_id).is_err());
    }

    #[test]
    fn commands_are_validated_replay_protected_and_consumed_once() {
        let (remote, _, token) = approved();
        assert!(remote.control(&token, command("unknown", None, "unknown")).is_err());
        assert!(remote.control(&token, command("fontSize", None, "missing")).is_err());
        assert!(remote.control(&token, command("position", Some(301), "range")).is_err());
        assert!(remote.control(&token, command("next", None, "")).is_err());
        assert!(remote.control(&token, command("next", None, "once")).is_ok());
        assert!(remote.control(&token, command("next", None, "once")).is_err());
        let commands = remote.take_commands();
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].action, "next");
        assert!(remote.take_commands().is_empty());
    }

    #[test]
    fn snapshot_sync_preserves_backend_authorization_flags() {
        let (remote, _, _) = approved();
        let mut snapshot = RemoteSnapshot::default();
        snapshot.mode = "flow".into();
        snapshot.section = 2;
        snapshot.section_count = 4;
        snapshot.playing = true;
        remote.set_snapshot(snapshot).unwrap();
        let actual = remote.snapshot();
        assert!(actual.connected && actual.approved && actual.playing);
        assert_eq!(actual.mode, "flow");
        assert_eq!(actual.section, 2);
    }

    #[test]
    fn reconnect_rehydrates_the_latest_authoritative_snapshot() {
        let (remote, _, token) = approved();
        let mut snapshot = RemoteSnapshot::default();
        snapshot.section = 1;
        snapshot.section_count = 3;
        snapshot.elapsed_ms = 42_000;
        remote.set_snapshot(snapshot).unwrap();

        let first = remote.events(&token).unwrap();
        let reconnected = remote.events(&token).unwrap();
        assert_eq!(first.last(), reconnected.last());
        assert_eq!(
            reconnected.last().unwrap()["snapshot"]["elapsedMs"],
            serde_json::json!(42_000)
        );
    }

    #[test]
    fn malformed_command_payloads_are_rejected_before_dispatch() {
        assert!(serde_json::from_str::<ControlRequest>("{not-json").is_err());
        assert!(serde_json::from_str::<ControlRequest>(
            r#"{"action":"fontSize","value":"large","requestId":"bad"}"#
        )
        .is_err());
    }

    #[test]
    fn rate_limit_and_teardown_fail_closed() {
        let remote = RemoteService::default();
        for _ in 0..MAX_REQUESTS {
            assert!(remote.allow("phone"));
        }
        assert!(!remote.allow("phone"));
        let info = remote.start().unwrap();
        remote.pair(&info.code).unwrap();
        remote.stop();
        assert!(!remote.snapshot().connected);
        assert!(!remote.snapshot().approved);
        assert!(remote.take_commands().is_empty());
        assert!(remote.pair(&info.code).is_err());
    }

    #[test]
    fn concurrent_connections_are_bounded() {
        let remote = RemoteService::default();
        let permits: Vec<_> = (0..MAX_CONNECTIONS)
            .map(|_| remote.try_acquire_connection().unwrap())
            .collect();
        assert!(remote.try_acquire_connection().is_none());
        drop(permits);
        assert!(remote.try_acquire_connection().is_some());
    }
}