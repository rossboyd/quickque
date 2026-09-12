// Compile and exercise the production module without the Tauri dependency
// graph. The path intentionally points at the real source, so this harness
// cannot drift from the desktop implementation.
#[path = "../../../artifacts/quickque/src-tauri/src/remote.rs"]
mod remote;
