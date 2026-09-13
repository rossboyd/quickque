fn main() {
    for name in ["QUICKQUE_LICENCE_PUBLIC_KEYS", "QUICKQUE_LICENCE_SERVER", "QUICKQUE_RELEASE_TIMESTAMP"] {
        println!("cargo:rerun-if-env-changed={name}");
    }
    if std::env::var("QUICKQUE_LICENCE_PUBLIC_KEYS").is_ok() {
        assert!(std::env::var("QUICKQUE_RELEASE_TIMESTAMP").ok().and_then(|v| v.parse::<u64>().ok()).is_some_and(|v| v > 0), "A licensed release needs its immutable release timestamp");
        assert!(std::env::var("QUICKQUE_LICENCE_SERVER").is_ok_and(|v| v.starts_with("https://")), "Licence service must use HTTPS");
    }
    tauri_build::build()
}