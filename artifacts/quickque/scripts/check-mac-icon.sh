#!/bin/sh
# Run after the normal Tauri build, or pass the installed .app as the first argument.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ "$(uname -s)" != "Darwin" ]; then
  echo "Mac bundle icon inspection requires macOS; not verified here." >&2
  exit 1
fi
APP=${1:-"$ROOT/src-tauri/target/release/bundle/macos/Quickque.app"}
ICON=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIconFile' "$APP/Contents/Info.plist")
case "$ICON" in
  *.icns) ;;
  *) ICON="$ICON.icns" ;;
esac
cmp "$ROOT/src-tauri/icons/icon.icns" "$APP/Contents/Resources/$ICON"
echo "PASS: $APP references and packages the current Quickque ICNS."
echo "Finder, Dock, DMG display and offline fonts still require the visual checklist."