use super::*;
use std::{
    io::{Read, Write},
    net::TcpStream,
};

fn client_id(ch: char) -> String {
    std::iter::repeat(ch).take(32).collect()
}

fn command(action: &str, value: Option<i32>, request_id: &str) -> ControlRequest {
    ControlRequest {
        action: action.into(),
        value,
        request_id: request_id.into(),
    }
}

fn approved() -> (RemoteService, RemoteInfo, String) {
    let remote = RemoteService::default();
    let info = remote
        .start()
        .expect("test host needs a private LAN address");
    let pair = remote
        .pair(
            remote.generation(),
            PairRequest {
                session_id: info.session_id.clone(),
                code: info.code.clone(),
                client_id: client_id('a'),
            },
        )
        .unwrap();
    remote.approve(&info.session_id).unwrap();
    (remote, info, pair.token)
}

fn http(info: &RemoteInfo, request: &str) -> (u16, String) {
    let address = info
        .url
        .strip_prefix("http://")
        .unwrap()
        .trim_end_matches('/');
    // The listener is intentionally advertised on the private LAN address.
    // The isolated Linux harness can have a private address without a route
    // back to itself, so use the same ephemeral port through loopback.
    let port = address.rsplit_once(':').unwrap().1;
    let mut stream = TcpStream::connect(format!("127.0.0.1:{port}")).unwrap();
    stream.write_all(request.as_bytes()).unwrap();
    stream.shutdown(std::net::Shutdown::Write).unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    let status = response.split_whitespace().nth(1).unwrap().parse().unwrap();
    let body = response.split("\r\n\r\n").nth(1).unwrap_or("").to_owned();
    (status, body)
}

#[test]
fn start_is_serialized_and_idempotent() {
    let remote = RemoteService::default();
    let first = remote.start().expect("private LAN address");
    let second = remote.start().expect("second start");
    assert_eq!(first.session_id, second.session_id);
    assert_eq!(first.pairing_url, second.pairing_url);
    remote.stop();
}

#[test]
fn real_http_serves_embedded_page_and_pair_is_idempotent() {
    let remote = RemoteService::default();
    let info = remote.start().expect("private LAN address");
    let (status, page) = http(
        &info,
        "GET / HTTP/1.1\r\nHost: quickque\r\nConnection: close\r\n\r\n",
    );
    assert_eq!(status, 200);
    assert!(!page.is_empty());

    let payload = serde_json::json!({
        "sessionId": info.session_id,
        "code": info.code,
        "clientId": client_id('a')
    });
    let request = format!(
        "POST /api/pair HTTP/1.1\r\nHost: quickque\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        payload.to_string().len(),
        payload
    );
    let (status, first) = http(&info, &request);
    assert_eq!(status, 200);
    let first: serde_json::Value = serde_json::from_str(&first).unwrap();
    assert_eq!(first["status"], "pending");
    let (status, second) = http(
        &info,
        &format!(
            "POST /api/pair HTTP/1.1\r\nHost: quickque\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            payload.to_string().len(),
            payload
        ),
    );
    assert_eq!(status, 200);
    let second: serde_json::Value = serde_json::from_str(&second).unwrap();
    assert_eq!(first["token"], second["token"]);
    remote.stop();
}

#[test]
fn binding_is_checked_before_idempotency_and_competing_client_is_busy() {
    let remote = RemoteService::default();
    let info = remote.start().expect("private LAN address");
    let generation = remote.generation();
    let request = PairRequest {
        session_id: info.session_id.clone(),
        code: info.code.clone(),
        client_id: client_id('a'),
    };
    let first = remote.pair(generation, request).unwrap();
    assert_eq!(
        remote
            .pair(
                generation,
                PairRequest {
                    session_id: "wrong".into(),
                    code: info.code.clone(),
                    client_id: client_id('a'),
                }
            )
            .unwrap_err()
            .status,
        "expired"
    );
    assert_eq!(
        remote
            .pair(
                generation,
                PairRequest {
                    session_id: info.session_id.clone(),
                    code: info.code,
                    client_id: client_id('b'),
                }
            )
            .unwrap_err()
            .http_status,
        409
    );
    assert!(!first.token.is_empty());
    remote.stop();
}

#[test]
fn pending_events_are_200_and_expiration_is_terminal() {
    let remote = RemoteService::default();
    let info = remote.start().expect("private LAN address");
    let generation = remote.generation();
    let pair = remote
        .pair(
            generation,
            PairRequest {
                session_id: info.session_id.clone(),
                code: info.code,
                client_id: client_id('a'),
            },
        )
        .unwrap();
    assert_eq!(
        remote.events(generation, &pair.token).unwrap().status,
        "pending"
    );
    remote
        .inner
        .lock()
        .unwrap()
        .session
        .as_mut()
        .unwrap()
        .expires = Instant::now();
    assert_eq!(
        remote
            .events(generation, &pair.token)
            .unwrap_err()
            .http_status,
        410
    );
    remote.stop();
}

#[test]
fn rejection_is_a_tombstone_and_requires_replacement() {
    let remote = RemoteService::default();
    let info = remote.start().expect("private LAN address");
    let generation = remote.generation();
    let pair = remote
        .pair(
            generation,
            PairRequest {
                session_id: info.session_id.clone(),
                code: info.code.clone(),
                client_id: client_id('a'),
            },
        )
        .unwrap();
    remote.reject();
    assert_eq!(
        remote.events(generation, &pair.token).unwrap_err().status,
        "rejected"
    );
    assert_eq!(
        remote
            .pair(
                generation,
                PairRequest {
                    session_id: info.session_id.clone(),
                    code: info.code.clone(),
                    client_id: client_id('a'),
                },
            )
            .unwrap_err()
            .status,
        "rejected"
    );
    remote.stop();
    let replacement = remote.start().expect("replacement start");
    assert_ne!(replacement.session_id, info.session_id);
    remote.stop();
}

#[test]
fn old_generation_cannot_apply_after_replacement() {
    let remote = RemoteService::default();
    let old = remote.start().expect("private LAN address");
    let old_generation = remote.generation();
    remote.stop();
    let new = remote.start().expect("replacement start");
    let result = remote.pair(
        old_generation,
        PairRequest {
            session_id: new.session_id,
            code: new.code,
            client_id: client_id('a'),
        },
    );
    assert_eq!(result.unwrap_err().http_status, 410);
    assert_ne!(
        old.session_id,
        remote.status().session_info.unwrap().session_id
    );
    remote.stop();
}

#[test]
fn controls_are_replay_protected_and_reconnect_returns_authoritative_snapshot() {
    let (remote, _, token) = approved();
    let mut snapshot = RemoteSnapshot::default();
    snapshot.section = 2;
    snapshot.section_count = 4;
    snapshot.elapsed_ms = 42_000;
    remote.set_snapshot(snapshot).unwrap();
    assert!(remote
        .control(remote.generation(), &token, command("next", None, "once"))
        .is_ok());
    assert_eq!(
        remote
            .control(remote.generation(), &token, command("next", None, "once"))
            .unwrap_err()
            .http_status,
        409
    );
    let events = remote.events(remote.generation(), &token).unwrap();
    assert_eq!(events.status, "connected");
    assert_eq!(events.snapshot.unwrap().elapsed_ms, 42_000);
    remote.stop();
}

#[test]
fn approved_credentials_survive_code_expiry_but_pairing_does_not() {
    let (remote, info, token) = approved();
    remote
        .inner
        .lock()
        .unwrap()
        .session
        .as_mut()
        .unwrap()
        .expires = Instant::now();
    assert_eq!(
        remote.events(remote.generation(), &token).unwrap().status,
        "connected"
    );
    assert_eq!(
        remote
            .pair(
                remote.generation(),
                PairRequest {
                    session_id: info.session_id,
                    code: info.code,
                    client_id: client_id('a'),
                },
            )
            .unwrap_err()
            .status,
        "expired"
    );
    remote.stop();
}

#[test]
fn rate_limit_and_status_track_heartbeat_separately_from_approval() {
    let remote = RemoteService::default();
    let info = remote.start().expect("private LAN address");
    let generation = remote.generation();
    for _ in 0..MAX_REQUESTS {
        assert_eq!(remote.allow(generation, "phone"), Some(true));
    }
    assert_eq!(remote.allow(generation, "phone"), Some(false));
    assert_eq!(remote.status().status, "awaitingScan");
    let pair = remote
        .pair(
            generation,
            PairRequest {
                session_id: info.session_id.clone(),
                code: info.code,
                client_id: client_id('a'),
            },
        )
        .unwrap();
    assert_eq!(remote.status().status, "awaitingApproval");
    remote.approve(&info.session_id).unwrap();
    assert_eq!(remote.status().status, "connected");
    remote
        .inner
        .lock()
        .unwrap()
        .session
        .as_mut()
        .unwrap()
        .controller
        .as_mut()
        .unwrap()
        .last_activity = Instant::now() - HEARTBEAT_TTL - Duration::from_millis(1);
    assert_eq!(remote.status().status, "disconnected");
    assert!(remote.events(generation, &pair.token).is_ok());
    assert_eq!(remote.status().status, "connected");
    remote.stop();
}

#[test]
fn rejected_session_clears_queued_commands() {
    let (remote, info, token) = approved();
    remote
        .control(
            remote.generation(),
            &token,
            command("next", None, "before-reject"),
        )
        .unwrap();
    assert_eq!(remote.take_commands().len(), 1);
    remote
        .control(
            remote.generation(),
            &token,
            command("previous", None, "queued"),
        )
        .unwrap();
    remote.reject();
    assert!(remote.take_commands().is_empty());
    assert_eq!(remote.status().status, "rejected");
    remote.stop();
    let _ = info;
}

#[test]
fn command_queue_bound_is_checked_before_replay_consumption() {
    let (remote, _, token) = approved();
    for index in 0..MAX_COMMANDS {
        remote
            .control(
                remote.generation(),
                &token,
                command("next", None, &format!("fill-{index}")),
            )
            .unwrap();
    }
    let blocked = command("next", None, "retry-after-reader-drain");
    assert_eq!(
        remote
            .control(remote.generation(), &token, blocked.clone())
            .unwrap_err()
            .http_status,
        503
    );
    remote.take_commands();
    assert!(remote.control(remote.generation(), &token, blocked).is_ok());
    remote.stop();
}

#[test]
fn ifconfig_selection_requires_active_blocks_and_prefers_physical_lan() {
    let fixture = r#"
lo0: flags=8049<UP,LOOPBACK,RUNNING> mtu 16384
	inet 192.168.99.1 netmask 0xffffff00
	status: active
utun7: flags=8051<UP,POINTOPOINT,RUNNING> mtu 1380
	inet 10.99.0.2 --> 10.99.0.1 netmask 0xffffff00
	status: active
en0: flags=8863<UP,BROADCAST,SMART,RUNNING> mtu 1500
	inet 192.168.10.3 netmask 0xffffff00 broadcast 192.168.10.255
	status: inactive
bridge100: flags=8863<UP,BROADCAST,SMART,RUNNING> mtu 1500
	inet 192.168.20.4 netmask 0xffffff00 broadcast 192.168.20.255
	status: active
en1: flags=8863<UP,BROADCAST,SMART,RUNNING> mtu 1500
	inet 8.8.8.8 netmask 0xffffff00
	status: active
"#;
    assert_eq!(
        parse_ifconfig_ipv4(fixture),
        Some("192.168.20.4".parse().unwrap())
    );

    let preferred = fixture
        .replace(
            "en0: flags=8863<UP,BROADCAST,SMART,RUNNING>",
            "en0: flags=8863<UP,BROADCAST,SMART,RUNNING>",
        )
        .replace("status: inactive", "status: active");
    assert_eq!(
        parse_ifconfig_ipv4(&preferred),
        Some("192.168.10.3".parse().unwrap())
    );
}

#[test]
fn proc_fib_selection_requires_host_local_annotation() {
    let fixture = r#"
Main:
 +-- 192.168.42.0/30
    |-- 192.168.42.0
       /30 link UNICAST
    |-- 192.168.42.1
       /32 host LOCAL
    |-- 192.168.42.3
       /32 link BROADCAST
"#;
    assert_eq!(
        parse_proc_fib_ipv4(fixture),
        Some("192.168.42.1".parse().unwrap())
    );
}

impl RemoteService {
    fn generation(&self) -> u64 {
        self.inner.lock().unwrap().generation
    }
}
