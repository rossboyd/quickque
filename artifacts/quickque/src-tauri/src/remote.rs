//! Account-free, LAN-only phone remote.
//!
//! The remote intentionally uses the standard library for its HTTP server.  A
//! Quickque installation must also work when it has no Internet connection,
//! and keeping the listener here avoids pulling a second web server into the
//! desktop application.

use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    io::{Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    process::Command,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

const CODE_TTL: Duration = Duration::from_secs(300);
const HEARTBEAT_TTL: Duration = Duration::from_secs(5);
const REQUEST_ID_TTL: Duration = Duration::from_secs(600);
const MAX_REQUESTS: usize = 60;
const WINDOW: Duration = Duration::from_secs(10);
const MAX_CONNECTIONS: usize = 16;
const MAX_EVENTS: usize = 128;
const MAX_COMMANDS: usize = 128;
const MAX_REQUEST_IDS: usize = 4096;
const MAX_HTTP_BYTES: usize = 16 * 1024;

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
        Self {
            connected: false,
            approved: false,
            mode: "manual".into(),
            section: 0,
            elapsed_ms: 0,
            font_size: 100,
            scroll_speed: 0,
            position: 0,
            playing: false,
            section_count: 0,
        }
    }
}

/// Information displayed by the desktop QR dialog.
///
/// `pairing_url` is deliberately returned by the backend rather than rebuilt
/// by the UI.  This keeps manually copied links and QR links on the same
/// session-bound contract.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub url: String,
    pub pairing_url: String,
    pub code: String,
    pub expires_in_seconds: u64,
    pub session_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    pub status: String,
    pub session_info: Option<RemoteInfo>,
    pub approved: bool,
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
    active_connections: Arc<AtomicUsize>,
}

struct Inner {
    session: Option<Session>,
    snapshot: RemoteSnapshot,
    // These are bounded diagnostic/state events.  The HTTP protocol returns
    // the authoritative status and snapshot, not this internal queue.
    events: VecDeque<(u64, serde_json::Value)>,
    commands: VecDeque<ControlRequest>,
    next_event: u64,
    limits: HashMap<String, Vec<Instant>>,
    listener: Option<Arc<TcpListener>>,
    generation: u64,
}

struct Session {
    info: RemoteInfo,
    expires: Instant,
    generation: u64,
    controller: Option<Controller>,
    rejected: bool,
}

struct Controller {
    client_id: String,
    token: String,
    approved: bool,
    last_activity: Instant,
    used_requests: HashMap<String, Instant>,
}

impl Default for RemoteService {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                session: None,
                snapshot: RemoteSnapshot::default(),
                events: VecDeque::new(),
                commands: VecDeque::new(),
                next_event: 0,
                limits: HashMap::new(),
                listener: None,
                generation: 0,
            })),
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
    /// Start the listener once and return its current session.
    ///
    /// Holding the state lock through discovery, bind, and session creation
    /// makes concurrent calls serialized.  In particular, a second call does
    /// not replace a QR that the first call just displayed.
    pub fn start(&self) -> Result<RemoteInfo, String> {
        let mut g = self
            .inner
            .lock()
            .map_err(|_| "Remote state unavailable".to_string())?;

        if let Some(session) = g.session.as_ref() {
            if g.listener.is_some() {
                return Ok(session_info(session, Instant::now()));
            }
        }

        let ip = usable_lan_ip()?;
        let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0))
            .map_err(|error| format!("Could not open LAN remote: {error}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("Could not configure LAN remote: {error}"))?;
        let port = listener
            .local_addr()
            .map_err(|error| format!("Could not inspect LAN remote: {error}"))?
            .port();

        let session_id = entropy()?;
        // The QR code and the session identifier are independently random.
        // The session identifier is returned by /api/session, so deriving the
        // six-digit secret from it would make the secret publicly predictable.
        let code = pairing_code(&entropy()?);
        let url = format!("http://{ip}:{port}/");
        let pairing_url = format!("{url}?session={}&code={}", session_id, code);
        let now = Instant::now();
        let listener = Arc::new(listener);
        let generation = g.generation.wrapping_add(1);

        let info = RemoteInfo {
            url,
            pairing_url,
            code,
            expires_in_seconds: CODE_TTL.as_secs(),
            session_id,
        };
        g.generation = generation;
        g.session = Some(Session {
            info: info.clone(),
            expires: now + CODE_TTL,
            generation,
            controller: None,
            rejected: false,
        });
        g.snapshot = RemoteSnapshot::default();
        g.events.clear();
        g.commands.clear();
        g.limits.clear();
        g.listener = Some(listener.clone());
        drop(g);

        let this = self.clone();
        thread::spawn(move || this.accept_loop(listener, generation));
        Ok(info)
    }

    /// Stop invalidates the session before dropping the listener reference.
    /// Requests accepted by an old thread therefore cannot mutate a later
    /// session.
    pub fn stop(&self) {
        if let Ok(mut g) = self.inner.lock() {
            g.generation = g.generation.wrapping_add(1);
            g.session = None;
            g.listener = None;
            g.events.clear();
            g.commands.clear();
            g.limits.clear();
            g.snapshot.connected = false;
            g.snapshot.approved = false;
        }
    }

    pub fn snapshot(&self) -> RemoteSnapshot {
        self.inner
            .lock()
            .map(|g| snapshot_for(&g, Instant::now()))
            .unwrap_or_default()
    }

    pub fn take_commands(&self) -> Vec<ControlRequest> {
        self.inner
            .lock()
            .map(|mut g| g.commands.drain(..).collect())
            .unwrap_or_default()
    }

    pub fn set_snapshot(&self, mut snapshot: RemoteSnapshot) -> Result<(), String> {
        let mut g = self
            .inner
            .lock()
            .map_err(|_| "Remote state unavailable".to_string())?;
        if g.session.is_none() {
            return Err("Remote session is stopped".into());
        }
        let now = Instant::now();
        snapshot.connected = connected_for(&g, now);
        snapshot.approved = approved_for(&g);
        g.snapshot = snapshot;
        let snapshot_event = g.snapshot.clone();
        push_event(
            &mut g,
            serde_json::json!({"type":"snapshot","snapshot":snapshot_event}),
        );
        Ok(())
    }

    /// Kept for the existing desktop approval poller.
    pub fn pairing_pending(&self) -> bool {
        self.inner
            .lock()
            .ok()
            .and_then(|g| {
                let session = g.session.as_ref()?;
                Some(
                    !session.rejected
                        && session.expires > Instant::now()
                        && session
                            .controller
                            .as_ref()
                            .map(|controller| !controller.approved)
                            .unwrap_or(false),
                )
            })
            .unwrap_or(false)
    }

    pub fn approve(&self, session_id: &str) -> Result<(), String> {
        let mut g = self
            .inner
            .lock()
            .map_err(|_| "Remote state unavailable".to_string())?;
        let now = Instant::now();
        {
            let session = g.session.as_mut().ok_or("No remote session is active")?;
            if session.id() != session_id {
                return Err("Pairing session does not match the active session".into());
            }
            if session.rejected {
                return Err("The controller request was rejected".into());
            }
            if session.expires <= now {
                return Err("Pairing session expired".into());
            }
            let controller = session
                .controller
                .as_mut()
                .ok_or("No phone is awaiting approval")?;
            controller.approved = true;
            controller.last_activity = now;
        }
        g.snapshot.approved = true;
        g.snapshot.connected = true;
        push_event(&mut g, serde_json::json!({"type":"approved"}));
        Ok(())
    }

    /// Rejecting leaves a tombstone in the current generation.  The token is
    /// retained only so its bearer receives a clear `rejected` response; it
    /// cannot be used for events or controls, and no client can pair again
    /// until the presenter replaces the session.
    pub fn reject(&self) {
        if let Ok(mut g) = self.inner.lock() {
            let had_session = if let Some(session) = g.session.as_mut() {
                session.rejected = true;
                if let Some(controller) = session.controller.as_mut() {
                    controller.approved = false;
                }
                true
            } else {
                false
            };
            if had_session {
                g.snapshot.connected = false;
                g.snapshot.approved = false;
                push_event(&mut g, serde_json::json!({"type":"rejected"}));
            }
            // A rejected controller must not leave queued commands to be
            // applied after a later reader state transition.
            g.commands.clear();
        }
    }

    pub fn status(&self) -> RemoteStatus {
        let Ok(g) = self.inner.lock() else {
            return RemoteStatus {
                status: "stopped".into(),
                session_info: None,
                approved: false,
            };
        };
        let Some(session) = g.session.as_ref() else {
            return RemoteStatus {
                status: "stopped".into(),
                session_info: None,
                approved: false,
            };
        };

        let now = Instant::now();
        let approved = session
            .controller
            .as_ref()
            .map(|controller| controller.approved)
            .unwrap_or(false);
        let status = if session.rejected {
            "rejected"
        } else if !approved && session.expires <= now {
            "expired"
        } else if !approved {
            if session.controller.is_some() {
                "awaitingApproval"
            } else {
                "awaitingScan"
            }
        } else if connected_for(&g, now) {
            "connected"
        } else {
            "disconnected"
        };

        RemoteStatus {
            status: status.into(),
            session_info: Some(session_info(session, now)),
            approved,
        }
    }

    fn accept_loop(&self, listener: Arc<TcpListener>, generation: u64) {
        while self.is_current_listener(&listener, generation) {
            match listener.accept() {
                Ok((stream, addr)) => {
                    let Some(permit) = self.try_acquire_connection() else {
                        let mut stream = stream;
                        respond(
                            &mut stream,
                            503,
                            "Service Unavailable",
                            "too many connections",
                        );
                        continue;
                    };
                    let this = self.clone();
                    thread::spawn(move || {
                        let _permit = permit;
                        this.handle(stream, addr, generation);
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

    fn is_current_listener(&self, listener: &Arc<TcpListener>, generation: u64) -> bool {
        self.inner
            .lock()
            .ok()
            .map(|state| {
                state.generation == generation
                    && state
                        .listener
                        .as_ref()
                        .map(|current| Arc::ptr_eq(current, listener))
                        .unwrap_or(false)
            })
            .unwrap_or(false)
    }

    fn is_current_generation(&self, generation: u64) -> bool {
        self.inner
            .lock()
            .ok()
            .map(|state| {
                state.generation == generation
                    && state.listener.is_some()
                    && state.session.is_some()
            })
            .unwrap_or(false)
    }

    fn handle(&self, mut stream: TcpStream, addr: SocketAddr, generation: u64) {
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut raw = Vec::with_capacity(4096);
        let mut chunk = [0_u8; 1024];
        loop {
            let Ok(read) = stream.read(&mut chunk) else {
                return;
            };
            if read == 0 {
                return;
            }
            raw.extend_from_slice(&chunk[..read]);
            if raw.windows(4).any(|window| window == b"\r\n\r\n") {
                break;
            }
            if raw.len() > MAX_HTTP_BYTES {
                respond(&mut stream, 413, "Payload Too Large", "request too large");
                return;
            }
        }
        let Some(end) = raw.windows(4).position(|window| window == b"\r\n\r\n") else {
            return;
        };
        let header_end = end + 4;
        let head = String::from_utf8_lossy(&raw[..end]).into_owned();
        let content_length = header_value(&head, "content-length")
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0);
        if content_length > MAX_HTTP_BYTES {
            respond(&mut stream, 413, "Payload Too Large", "request too large");
            return;
        }
        while raw.len() < header_end + content_length {
            let Ok(read) = stream.read(&mut chunk) else {
                return;
            };
            if read == 0 {
                return;
            }
            raw.extend_from_slice(&chunk[..read]);
        }
        let body = String::from_utf8_lossy(&raw[header_end..header_end + content_length]);
        let Some(first) = head.lines().next() else {
            return;
        };
        let mut words = first.split_whitespace();
        let method = words.next().unwrap_or("");
        let target = words.next().unwrap_or("/");
        let (path, _) = target.split_once('?').unwrap_or((target, ""));

        // A request accepted by an old listener may arrive after stop/start.
        // Reject it before even touching rate-limit or session state.
        if !self.is_current_generation(generation) {
            respond_api_error(
                &mut stream,
                ApiError::expired("This remote session is no longer active"),
            );
            return;
        }
        let key = addr.ip().to_string();
        match self.allow(generation, &key) {
            None => {
                respond_api_error(
                    &mut stream,
                    ApiError::expired("This remote session is no longer active"),
                );
                return;
            }
            Some(false) => {
                respond_api_error(
                    &mut stream,
                    ApiError::new(429, "busy", "rate limit exceeded"),
                );
                return;
            }
            Some(true) => {}
        }

        if method == "GET" && path == "/" {
            respond_html(&mut stream, MOBILE_PAGE);
            return;
        }
        if method == "GET" && path == "/api/session" {
            match self.session_id(generation) {
                Ok(session_id) => respond_json(
                    &mut stream,
                    200,
                    &serde_json::json!({"sessionId":session_id}),
                ),
                Err(error) => respond_api_error(&mut stream, error),
            }
            return;
        }
        if method == "POST" && path == "/api/pair" {
            let content_type = header_value(&head, "content-type").unwrap_or_default();
            if !is_json_content_type(&content_type) {
                respond_api_error(
                    &mut stream,
                    ApiError::new(415, "rejected", "expected application/json"),
                );
                return;
            }
            match serde_json::from_str::<PairRequest>(&body) {
                Ok(request) => match self.pair(generation, request) {
                    Ok(response) => respond_json(&mut stream, 200, &response),
                    Err(error) => respond_api_error(&mut stream, error),
                },
                Err(_) => respond_api_error(
                    &mut stream,
                    ApiError::new(400, "rejected", "malformed pairing request"),
                ),
            }
            return;
        }
        if method == "GET" && path == "/api/events" {
            let token = bearer_token(header_value(&head, "authorization").as_deref());
            match self.events(generation, token.as_deref().unwrap_or("")) {
                Ok(response) => respond_json(&mut stream, 200, &response),
                Err(error) => respond_api_error(&mut stream, error),
            }
            return;
        }
        if method == "POST" && path == "/api/control" {
            let content_type = header_value(&head, "content-type").unwrap_or_default();
            if !is_json_content_type(&content_type) {
                respond_api_error(
                    &mut stream,
                    ApiError::new(415, "rejected", "expected application/json"),
                );
                return;
            }
            let token = bearer_token(header_value(&head, "authorization").as_deref());
            match serde_json::from_str::<ControlRequest>(&body) {
                Ok(request) => {
                    match self.control(generation, token.as_deref().unwrap_or(""), request) {
                        Ok(snapshot) => respond_json(
                            &mut stream,
                            200,
                            &serde_json::json!({"status":"connected","snapshot":snapshot}),
                        ),
                        Err(error) => respond_api_error(&mut stream, error),
                    }
                }
                Err(_) => respond_api_error(
                    &mut stream,
                    ApiError::new(400, "rejected", "malformed command"),
                ),
            }
            return;
        }
        respond_api_error(&mut stream, ApiError::new(404, "rejected", "not found"));
    }

    fn allow(&self, generation: u64, key: &str) -> Option<bool> {
        let mut g = self.inner.lock().ok()?;
        if g.generation != generation || g.listener.is_none() || g.session.is_none() {
            return None;
        }
        let now = Instant::now();
        let allowed = {
            let list = g.limits.entry(key.to_owned()).or_default();
            list.retain(|time| now.duration_since(*time) < WINDOW);
            if list.len() >= MAX_REQUESTS {
                false
            } else {
                list.push(now);
                true
            }
        };
        if g.limits.len() > 1024 {
            g.limits
                .retain(|_, values| values.iter().any(|time| now.duration_since(*time) < WINDOW));
        }
        Some(allowed)
    }

    fn session_id(&self, generation: u64) -> Result<String, ApiError> {
        let g = self.inner.lock().map_err(|_| ApiError::server())?;
        let session = g
            .session
            .as_ref()
            .ok_or_else(|| ApiError::expired("Remote session is no longer active"))?;
        if session.generation != generation {
            return Err(ApiError::expired("This remote session is no longer active"));
        }
        Ok(session.id().to_owned())
    }

    fn pair(&self, generation: u64, request: PairRequest) -> Result<PairResponse, ApiError> {
        if request.session_id.is_empty() || request.code.is_empty() {
            return Err(ApiError::new(
                400,
                "rejected",
                "sessionId and code are required",
            ));
        }
        let client_id = normalize_client_id(&request.client_id).ok_or_else(|| {
            ApiError::new(
                400,
                "rejected",
                "clientId must be 32 hexadecimal characters",
            )
        })?;
        let mut g = self.inner.lock().map_err(|_| ApiError::server())?;
        let now = Instant::now();
        let session = g
            .session
            .as_mut()
            .ok_or_else(|| ApiError::expired("Remote session is no longer active"))?;
        if session.generation != generation {
            return Err(ApiError::expired("This remote session is no longer active"));
        }

        // Binding is checked before looking at controller/client state.  This
        // prevents a stale QR from becoming an idempotency oracle.
        if session.id() != request.session_id || session.info.code != request.code {
            return Err(ApiError::expired(
                "Pairing session or code is invalid or expired",
            ));
        }
        if session.rejected {
            return Err(ApiError::rejected("This pairing request was rejected"));
        }
        if session.expires <= now {
            return Err(ApiError::expired("Pairing code is expired"));
        }

        if let Some(controller) = session.controller.as_mut() {
            if controller.client_id == client_id {
                controller.last_activity = now;
                return Ok(PairResponse {
                    status: if controller.approved {
                        "connected"
                    } else {
                        "pending"
                    },
                    token: controller.token.clone(),
                });
            }
            return Err(ApiError::new(
                409,
                "busy",
                "Another phone is already paired",
            ));
        }

        let token = entropy().map_err(|_| ApiError::server())?;
        session.controller = Some(Controller {
            client_id,
            token: token.clone(),
            approved: false,
            last_activity: now,
            used_requests: HashMap::new(),
        });
        g.snapshot.connected = false;
        push_event(&mut g, serde_json::json!({"type":"pairingRequest"}));
        Ok(PairResponse {
            status: "pending",
            token,
        })
    }

    fn events(&self, generation: u64, token: &str) -> Result<EventsResponse, ApiError> {
        let mut g = self.inner.lock().map_err(|_| ApiError::server())?;
        let now = Instant::now();
        {
            let session = g
                .session
                .as_mut()
                .ok_or_else(|| ApiError::expired("Remote session is no longer active"))?;
            if session.generation != generation {
                return Err(ApiError::expired("This remote session is no longer active"));
            }
            if session.rejected {
                return Err(ApiError::rejected("This pairing request was rejected"));
            }
            let controller = session
                .controller
                .as_mut()
                .ok_or_else(|| ApiError::unauthorized("Controller credentials are not valid"))?;
            if controller.token != token {
                return Err(ApiError::unauthorized(
                    "Controller credentials are not valid",
                ));
            }
            if !controller.approved {
                if session.expires <= now {
                    return Err(ApiError::expired("Pairing approval expired"));
                }
                controller.last_activity = now;
                return Ok(EventsResponse {
                    status: "pending",
                    snapshot: None,
                });
            }
            controller.last_activity = now;
        }
        Ok(EventsResponse {
            status: "connected",
            snapshot: Some(snapshot_for(&g, now)),
        })
    }

    fn control(
        &self,
        generation: u64,
        token: &str,
        command: ControlRequest,
    ) -> Result<RemoteSnapshot, ApiError> {
        validate_control(&command)?;
        let mut g = self.inner.lock().map_err(|_| ApiError::server())?;
        let now = Instant::now();
        // Snapshot capacity while holding the state lock, then check it only
        // after authenticating below. A busy queue must not leak occupancy to
        // an unauthenticated caller, and the request id must remain retryable.
        let queue_full = g.commands.len() >= MAX_COMMANDS;
        {
            let session = g
                .session
                .as_mut()
                .ok_or_else(|| ApiError::expired("Remote session is no longer active"))?;
            if session.generation != generation {
                return Err(ApiError::expired("This remote session is no longer active"));
            }
            if session.rejected {
                return Err(ApiError::rejected("This pairing request was rejected"));
            }
            let controller = session
                .controller
                .as_mut()
                .ok_or_else(|| ApiError::unauthorized("Controller credentials are not valid"))?;
            if controller.token != token {
                return Err(ApiError::unauthorized(
                    "Controller credentials are not valid",
                ));
            }
            if !controller.approved {
                return Err(ApiError::new(
                    403,
                    "pending",
                    "Controller approval is still pending",
                ));
            }
            if queue_full {
                return Err(ApiError::new(503, "busy", "Reader command queue is busy"));
            }
            controller
                .used_requests
                .retain(|_, time| now.duration_since(*time) < REQUEST_ID_TTL);
            if controller.used_requests.len() >= MAX_REQUEST_IDS {
                return Err(ApiError::new(
                    429,
                    "busy",
                    "Too many outstanding request ids",
                ));
            }
            if controller
                .used_requests
                .insert(command.request_id.clone(), now)
                .is_some()
            {
                return Err(ApiError::new(409, "rejected", "Duplicate request id"));
            }
            controller.last_activity = now;
        }
        push_event(
            &mut g,
            serde_json::json!({
                "type":"control",
                "action":command.action,
                "value":command.value
            }),
        );
        g.commands.push_back(command);
        Ok(snapshot_for(&g, now))
    }
}

impl Session {
    fn id(&self) -> &str {
        &self.info.session_id
    }
}

fn validate_control(command: &ControlRequest) -> Result<(), ApiError> {
    if command.request_id.is_empty()
        || command.request_id.len() > 80
        || !command.request_id.is_ascii()
    {
        return Err(ApiError::new(400, "rejected", "requestId is required"));
    }
    let valid = matches!(
        command.action.as_str(),
        "playPause" | "previous" | "next" | "scrollSpeed" | "fontSize" | "position"
    );
    if !valid {
        return Err(ApiError::new(400, "rejected", "Unknown control action"));
    }
    if matches!(
        command.action.as_str(),
        "scrollSpeed" | "fontSize" | "position"
    ) && command.value.is_none()
    {
        return Err(ApiError::new(
            400,
            "rejected",
            "This action requires a numeric value",
        ));
    }
    if let Some(value) = command.value {
        if !(-100..=300).contains(&value) {
            return Err(ApiError::new(
                400,
                "rejected",
                "Control value is out of range",
            ));
        }
    }
    Ok(())
}

fn approved_for(g: &Inner) -> bool {
    g.session
        .as_ref()
        .map(|session| {
            !session.rejected
                && session
                    .controller
                    .as_ref()
                    .map(|controller| controller.approved)
                    .unwrap_or(false)
        })
        .unwrap_or(false)
}

fn connected_for(g: &Inner, now: Instant) -> bool {
    g.session
        .as_ref()
        .map(|session| {
            session
                .controller
                .as_ref()
                .map(|controller| {
                    controller.approved
                        && !session.rejected
                        && now.duration_since(controller.last_activity) <= HEARTBEAT_TTL
                })
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

fn snapshot_for(g: &Inner, now: Instant) -> RemoteSnapshot {
    let mut snapshot = g.snapshot.clone();
    snapshot.approved = approved_for(g);
    snapshot.connected = connected_for(g, now);
    snapshot
}

fn session_info(session: &Session, now: Instant) -> RemoteInfo {
    let mut info = session.info.clone();
    info.expires_in_seconds = session
        .expires
        .checked_duration_since(now)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    info
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairRequest {
    session_id: String,
    code: String,
    client_id: String,
}

#[derive(Debug, Serialize)]
struct PairResponse {
    status: &'static str,
    token: String,
}

#[derive(Debug, Serialize)]
struct EventsResponse {
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    snapshot: Option<RemoteSnapshot>,
}

#[derive(Debug)]
struct ApiError {
    http_status: u16,
    status: &'static str,
    message: String,
}

impl ApiError {
    fn new(http_status: u16, status: &'static str, message: impl Into<String>) -> Self {
        Self {
            http_status,
            status,
            message: message.into(),
        }
    }

    fn expired(message: impl Into<String>) -> Self {
        Self::new(410, "expired", message)
    }

    fn rejected(message: impl Into<String>) -> Self {
        Self::new(403, "rejected", message)
    }

    fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(401, "expired", message)
    }

    fn server() -> Self {
        Self::new(500, "rejected", "Remote state is unavailable")
    }
}

fn push_event(g: &mut Inner, event: serde_json::Value) {
    let event_id = g.next_event;
    g.next_event = g.next_event.wrapping_add(1);
    g.events.push_back((event_id, event));
    while g.events.len() > MAX_EVENTS {
        g.events.pop_front();
    }
}

fn entropy() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    let mut file = std::fs::File::open("/dev/urandom")
        .map_err(|_| "Secure system randomness is unavailable".to_string())?;
    file.read_exact(&mut bytes)
        .map_err(|_| "Secure system randomness is unavailable".to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn pairing_code(entropy_material: &str) -> String {
    let value = u64::from_str_radix(&entropy_material[..16], 16).unwrap_or(1);
    format!("{:06}", value % 1_000_000)
}

fn normalize_client_id(client_id: &str) -> Option<String> {
    if client_id.len() != 32 || !client_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    Some(client_id.to_ascii_lowercase())
}

/// Find an active, private IPv4 without opening a socket to an outside host.
/// `ifconfig` is present on macOS; `ip` makes the isolated Linux harness
/// useful as well.  Loopback, link-local, public, and unspecified addresses
/// are deliberately not usable QR targets.
fn usable_lan_ip() -> Result<Ipv4Addr, String> {
    let ifconfig = Command::new("/sbin/ifconfig")
        .output()
        .or_else(|_| Command::new("ifconfig").output());
    if let Ok(output) = ifconfig {
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout);
            if let Some(ip) = parse_ifconfig_ipv4(&text) {
                return Ok(ip);
            }
        }
    }
    if let Ok(output) = Command::new("ip")
        .args(["-4", "-o", "addr", "show", "up"])
        .output()
    {
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout);
            if let Some(ip) = parse_ip_ipv4(&text) {
                return Ok(ip);
            }
        }
    }
    // Minimal Linux images used for validation may not ship either
    // `ifconfig` or `ip`.  The kernel's route trie is local state, not a
    // network probe, and still lets us identify an assigned private address.
    #[cfg(target_os = "linux")]
    if let Ok(text) = std::fs::read_to_string("/proc/net/fib_trie") {
        if let Some(ip) = parse_proc_fib_ipv4(&text) {
            return Ok(ip);
        }
    }
    Err(
        "No usable private LAN IPv4 address was found. Connect this Mac to Wi-Fi or Ethernet and try again."
            .into(),
    )
}

#[derive(Default)]
struct IfconfigBlock {
    name: String,
    flags: String,
    status_active: bool,
    has_status: bool,
    addresses: Vec<Ipv4Addr>,
}

fn parse_ifconfig_ipv4(text: &str) -> Option<Ipv4Addr> {
    let mut blocks = Vec::new();
    let mut current: Option<IfconfigBlock> = None;
    for line in text.lines() {
        if !line.starts_with(char::is_whitespace) && line.contains(':') {
            if let Some(block) = current.take() {
                blocks.push(block);
            }
            let Some((name, remainder)) = line.split_once(':') else {
                continue;
            };
            let flags = remainder
                .split_once("flags=")
                .and_then(|(_, value)| value.split_whitespace().next())
                .unwrap_or("")
                .to_owned();
            current = Some(IfconfigBlock {
                name: name.trim().to_owned(),
                flags,
                ..IfconfigBlock::default()
            });
        }
        let Some(block) = current.as_mut() else {
            continue;
        };
        let trimmed = line.trim();
        if let Some(value) = trimmed
            .strip_prefix("inet ")
            .and_then(|value| value.split_whitespace().next())
        {
            if let Ok(ip) = value.parse::<Ipv4Addr>() {
                block.addresses.push(ip);
            }
        }
        if let Some(status) = trimmed.strip_prefix("status:") {
            block.has_status = true;
            block.status_active = status.trim().eq_ignore_ascii_case("active");
        }
    }
    if let Some(block) = current {
        blocks.push(block);
    }

    blocks
        .into_iter()
        .filter(|block| {
            !excluded_interface(&block.name)
                && interface_is_active(block)
                && !block.addresses.is_empty()
        })
        .flat_map(|block| {
            let rank = interface_rank(&block.name);
            block
                .addresses
                .into_iter()
                .filter(move |ip| is_private_ipv4(*ip))
                .map(move |ip| (rank, ip))
        })
        .min_by_key(|(rank, _)| *rank)
        .map(|(_, ip)| ip)
}

fn interface_is_active(block: &IfconfigBlock) -> bool {
    let up = has_ifconfig_flag(&block.flags, "UP");
    // macOS reports `UP` for some disconnected adapters. Physical Ethernet
    // and Wi-Fi blocks must also explicitly report `status: active`.
    if block.name.starts_with("en") {
        up && block.has_status && block.status_active
    } else {
        up && (!block.has_status || block.status_active)
    }
}

fn has_ifconfig_flag(flags: &str, wanted: &str) -> bool {
    flags
        .split_once('<')
        .map(|(_, flags)| flags)
        .unwrap_or(flags)
        .trim_end_matches('>')
        .split(',')
        .any(|flag| flag.eq_ignore_ascii_case(wanted))
}

fn excluded_interface(name: &str) -> bool {
    name == "lo"
        || name.starts_with("lo")
        || name.starts_with("utun")
        || name.starts_with("tun")
        || name.starts_with("tap")
        || name.starts_with("ppp")
}

fn interface_rank(name: &str) -> u8 {
    if name.starts_with("en") {
        0
    } else if name.starts_with("bridge") || name.starts_with("awdl") || name.starts_with("llw") {
        2
    } else {
        1
    }
}

fn parse_ip_ipv4(text: &str) -> Option<Ipv4Addr> {
    for line in text.lines() {
        let mut words = line.split_whitespace();
        let _index = words.next();
        let _interface = words.next();
        let _family = words.next();
        if let Some(address) = words.next() {
            if let Some(address) = address.split('/').next() {
                if let Ok(ip) = address.parse::<Ipv4Addr>() {
                    if is_private_ipv4(ip) {
                        return Some(ip);
                    }
                }
            }
        }
    }
    None
}

fn parse_proc_fib_ipv4(text: &str) -> Option<Ipv4Addr> {
    let mut candidate = None;
    for line in text.lines() {
        if let Some(value) = line.trim().strip_prefix("|-- ") {
            candidate = value
                .parse::<Ipv4Addr>()
                .ok()
                .filter(|ip| is_private_ipv4(*ip));
            continue;
        }
        if candidate.is_some() {
            let annotation = line.trim();
            if annotation.contains("/32") && annotation.contains("host LOCAL") {
                return candidate;
            }
        }
    }
    None
}

fn is_private_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    (octets[0] == 10)
        || (octets[0] == 172 && (16..=31).contains(&octets[1]))
        || (octets[0] == 192 && octets[1] == 168)
}

fn bearer_token(header: Option<&str>) -> Option<String> {
    header?
        .strip_prefix("Bearer ")
        .filter(|token| !token.is_empty())
        .map(str::to_owned)
}

fn header_value<'a>(headers: &'a str, wanted: &str) -> Option<String> {
    headers.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.trim()
            .eq_ignore_ascii_case(wanted)
            .then(|| value.trim().to_owned())
    })
}

fn is_json_content_type(value: &str) -> bool {
    value
        .split(';')
        .next()
        .map(|part| part.trim().eq_ignore_ascii_case("application/json"))
        .unwrap_or(false)
}

fn status_text(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        410 => "Gone",
        415 => "Unsupported Media Type",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        _ => "Error",
    }
}

fn respond(stream: &mut TcpStream, status: u16, text: &str, body: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status} {text}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}

fn respond_json<T: Serialize>(stream: &mut TcpStream, status: u16, value: &T) {
    let body = serde_json::to_string(value).unwrap_or_else(|_| "{}".into());
    let text = status_text(status);
    let _ = write!(
        stream,
        "HTTP/1.1 {status} {text}\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}

fn respond_api_error(stream: &mut TcpStream, error: ApiError) {
    respond_json(
        stream,
        error.http_status,
        &serde_json::json!({"status":error.status,"message":error.message}),
    );
}

fn respond_html(stream: &mut TcpStream, body: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}

const MOBILE_PAGE: &str = include_str!("remote-mobile.html");

#[cfg(test)]
#[path = "remote_tests.rs"]
mod remote_tests;
