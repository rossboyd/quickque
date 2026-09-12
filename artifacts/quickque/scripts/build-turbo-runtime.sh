#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  echo 'Build the bundled Chatterbox runtime on an Apple Silicon Mac.' >&2
  exit 1
fi
command -v uv >/dev/null 2>&1 || { echo 'The Mac build machine needs uv (end users do not).' >&2; exit 1; }
cd "$ROOT/turbo"
uv venv --python 3.11 --allow-existing .venv
# --no-deps uses the complete resolved lock, including the pinned Perth override.
uv pip sync --python .venv/bin/python requirements-macos.lock
.venv/bin/python -m unittest discover -s . -p 'test_*.py'
.venv/bin/python -m PyInstaller --noconfirm --clean --onedir --name quickque-turbo \
  --target-architecture arm64 \
  --collect-all chatterbox --collect-all perth --collect-all transformers \
  --collect-all librosa --collect-all spacy_pkuseg --collect-all pykakasi \
  --collect-all s3tokenizer --collect-all torchaudio \
  --recursive-copy-metadata chatterbox-tts --copy-metadata sounddevice \
  --add-data 'model-lock.json:.' --add-data 'CHATTERBOX-LICENSE.txt:.' \
  --add-data 'PERTH-LICENSE.txt:.' worker.py
# Fail the app build if frozen imports, watermark assets or MPS are broken.
# This does not download models, synthesize or record any audio.
if [ "${QUICKQUE_BUILD_PACKAGE_ONLY:-0}" = 1 ]; then
  # Hosted Mac VMs do not expose Metal. This validates frozen imports only;
  # a physical Apple Silicon Mac must still pass --check-runtime and playback.
  ./dist/quickque-turbo/quickque-turbo --check-package --model-dir /nonexistent/quickque-build-check
else
  ./dist/quickque-turbo/quickque-turbo --check-runtime --model-dir /nonexistent/quickque-build-check
fi
