#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  echo "Quickque local Flow helper builds only on Apple Silicon macOS." >&2
  exit 1
fi

cd "$ROOT/native"
swift test
swift build -c release --arch arm64

mkdir -p "$ROOT/src-tauri/binaries"
cp ".build/arm64-apple-macosx/release/quickque-flow" \
  "$ROOT/src-tauri/binaries/quickque-flow-aarch64-apple-darwin"