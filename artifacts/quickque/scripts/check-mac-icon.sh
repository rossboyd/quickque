#!/bin/sh
# Inspect the app's actual icon, including the copy shipped inside the DMG.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ "$(uname -s)" != "Darwin" ]; then
  echo "Mac bundle icon inspection requires macOS; not verified here." >&2
  exit 1
fi
if [ "$#" -gt 0 ]; then
  case "$1" in
    *.dmg)
      MOUNT=$(mktemp -d "${TMPDIR:-/tmp}/quickque-dmg-check.XXXXXX")
      cleanup() { hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true; rmdir "$MOUNT" 2>/dev/null || true; }
      trap cleanup EXIT HUP INT TERM
      hdiutil attach "$1" -readonly -nobrowse -mountpoint "$MOUNT" -quiet
      FOUND=0
      for APP in "$MOUNT"/*.app; do
        [ -d "$APP" ] || continue
        sh "$ROOT/scripts/check-mac-icon.sh" "$APP"
        FOUND=$((FOUND + 1))
      done
      [ "$FOUND" -eq 1 ] || { echo 'Expected one app in the DMG.' >&2; exit 1; }
      echo "PASS: packaged DMG contains the current app icon: $1"
      exit 0
      ;;
  esac
fi
APP=${1:-"$ROOT/src-tauri/target/release/bundle/macos/Quickque.app"}
ICON=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIconFile' "$APP/Contents/Info.plist")
case "$ICON" in
  *.icns) ;;
  *) ICON="$ICON.icns" ;;
esac
cmp "$ROOT/src-tauri/icons/icon.icns" "$APP/Contents/Resources/$ICON"
for HELPER in quickque-flow quickque-speech quickque-audio-export; do
  [ -x "$APP/Contents/MacOS/$HELPER" ] || { echo "Missing bundled helper: $HELPER" >&2; exit 1; }
done
[ -x "$APP/Contents/Resources/turbo-runtime/quickque-turbo" ] || { echo 'Missing bundled Chatterbox runtime.' >&2; exit 1; }
echo "PASS: $APP references the current ICNS and includes executable speech helpers."
if [ "$#" -eq 0 ]; then
  FOUND=0
  for DMG in "$ROOT/src-tauri/target/release/bundle/dmg/"*.dmg; do
    [ -f "$DMG" ] || continue
    sh "$ROOT/scripts/check-mac-icon.sh" "$DMG"
    FOUND=$((FOUND + 1))
  done
  [ "$FOUND" -gt 0 ] || { echo 'No DMG found to verify.' >&2; exit 1; }
fi
echo 'Finder/Dock visual appearance and audible playback still need physical Mac verification.'
