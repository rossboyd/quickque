#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  echo "Quickque Apple Speech builds only on Apple Silicon macOS Tahoe 26 or newer." >&2
  exit 1
fi

OS_MAJOR=$(sw_vers -productVersion | cut -d. -f1)
if [ "$OS_MAJOR" -lt 26 ]; then
  echo "Quickque Apple Speech requires macOS Tahoe 26 or newer to build and run." >&2
  exit 1
fi

SDK_VERSION=$(xcrun --sdk macosx --show-sdk-version 2>/dev/null || true)
SDK_MAJOR=${SDK_VERSION%%.*}
case "$SDK_MAJOR" in
  ''|*[!0-9]*)
    echo "Select a full Xcode 26+ installation before building Quickque." >&2
    echo "Check xcode-select -p and xcodebuild -version." >&2
    exit 1
    ;;
esac
if [ "$SDK_MAJOR" -lt 26 ]; then
  echo "Quickque requires the macOS 26+ SDK in Xcode 26+. Selected SDK: $SDK_VERSION" >&2
  echo "Check xcode-select -p and select your Xcode 26+ installation." >&2
  exit 1
fi

export MACOSX_DEPLOYMENT_TARGET=26.0
cd "$ROOT/native"
xcrun --sdk macosx swift test
xcrun --sdk macosx swift test -c release
xcrun --sdk macosx swift build -c release --arch arm64 --product quickque-flow
xcrun --sdk macosx swift build -c release --arch arm64 --product quickque-speech
xcrun --sdk macosx swift build -c release --arch arm64 --product quickque-audio-export

mkdir -p "$ROOT/src-tauri/binaries"
cp ".build/arm64-apple-macosx/release/quickque-flow" \
  "$ROOT/src-tauri/binaries/quickque-flow-aarch64-apple-darwin"
cp ".build/arm64-apple-macosx/release/quickque-speech" \
  "$ROOT/src-tauri/binaries/quickque-speech-aarch64-apple-darwin"
cp ".build/arm64-apple-macosx/release/quickque-audio-export" \
  "$ROOT/src-tauri/binaries/quickque-audio-export-aarch64-apple-darwin"
