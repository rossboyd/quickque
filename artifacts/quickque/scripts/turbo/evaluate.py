#!/usr/bin/env python3
"""Developer-only Chatterbox evaluation. Not included in the Quickque app.

prepare downloads pinned model files; check verifies them without network;
benchmark uses an existing developer runtime and cleared voice conditioning.
No default/demo voice, text input, generated audio file or runtime installer.
"""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import platform
import resource
import shutil
import socket
import sys
import tempfile
import time
import urllib.request

LOCK = json.loads(Path(__file__).with_name('model-lock.json').read_text())
LINES = (
    'Are you ready? We will start when everyone is here.',
    'Take a moment, look towards the door, and wait for the next person to speak. There is no need to rush. We have time to try the scene again.',
    'I thought you were coming on Tuesday, but the note says Thursday at half past seven. Please check the date before we leave.',
)


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def verify(directory, lock=LOCK):
    expected = {item['name'] for item in lock['files']}
    # from_local automatically loads conds.pt. Do not allow an unchecked voice.
    if {p.name for p in directory.iterdir()} != expected:
        raise ValueError('Model folder must contain exactly the locked files, without demo conditioning.')
    for item in lock['files']:
        path = directory / item['name']
        if path.is_symlink() or not path.is_file() or path.stat().st_size != item['bytes'] or digest(path) != item['sha256']:
            raise ValueError('Model file verification failed: ' + item['name'])


def prepare(directory):
    if directory.exists():
        verify(directory)
        return
    directory.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.quickque-turbo-', dir=directory.parent))
    try:
        for item in LOCK['files']:
            url = f"https://huggingface.co/{LOCK['repository']}/resolve/{LOCK['revision']}/{item['name']}"
            with urllib.request.urlopen(url, timeout=60) as response, (stage / item['name']).open('xb') as target:
                remaining = item['bytes']
                while remaining:
                    chunk = response.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError('Incomplete model download.')
                    target.write(chunk)
                    remaining -= len(chunk)
                if response.read(1):
                    raise ValueError('Model download exceeded the locked size.')
        verify(stage)
        # Never merge into or replace an existing model installation.
        if directory.exists():
            raise ValueError('Destination appeared during download; refusing to replace it.')
        stage.rename(directory)
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def voice_path(manifest):
    data = json.loads(manifest.read_text())
    if data.get('consent') != 'approved-for-quickque-evaluation' or not data.get('provenance', '').strip():
        raise ValueError('Voice manifest needs recorded evaluation consent and provenance.')
    path = manifest.parent / data['file']
    if path.is_symlink() or path.resolve().parent != manifest.parent.resolve() or not path.is_file():
        raise ValueError('Conditioning must be a regular file beside its manifest.')
    if path.stat().st_size > 32 * 1024 * 1024 or digest(path) != data['sha256']:
        raise ValueError('Voice conditioning verification failed.')
    return path


def deny_network(*args, **kwargs):
    raise RuntimeError('Network access is disabled during model evaluation.')


def benchmark(directory, manifest, runs, listen):
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise ValueError('Benchmark requires a native arm64 developer runtime on an Apple Silicon Mac.')
    verify(directory)
    conditioning = voice_path(manifest)
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1', PYTORCH_ENABLE_MPS_FALLBACK='0')
    # Block Python network calls as well as Hugging Face downloads. The Mac
    # release test must additionally block network at the OS boundary.
    socket.create_connection = deny_network
    socket.socket.connect = deny_network
    socket.socket.connect_ex = deny_network
    # Upstream prints/logs are suppressed, including exception text. Only our
    # content-free metrics reach stdout. Generated audio stays in RAM.
    with open(os.devnull, 'w') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        import torch
        from chatterbox.tts_turbo import ChatterboxTurboTTS, Conditionals
        import chatterbox.tts_turbo as turbo_source
        if hashlib.sha256(Path(turbo_source.__file__).read_bytes()).hexdigest() != SOURCE_SHA256:
            raise ValueError('Developer runtime does not match the inspected Turbo source revision.')
        if not torch.backends.mps.is_available():
            raise ValueError('MPS is unavailable; CPU fallback is disabled.')
        playback = None
        if listen:
            import sounddevice
            playback = sounddevice
        started = time.perf_counter()
        model = ChatterboxTurboTTS.from_local(directory, device='mps')
        model.conds = Conditionals.load(conditioning, map_location='cpu').to('mps')
        torch.mps.synchronize()
        load_seconds = time.perf_counter() - started
        measurements = []
        with torch.inference_mode():
            for index in range(runs):
                started = time.perf_counter()
                # Official generate() applies Perth watermarking. Do not replace
                # it with a direct decoder call or strip the watermark.
                audio = model.generate(LINES[index % len(LINES)])
                torch.mps.synchronize()
                elapsed = time.perf_counter() - started
                seconds = audio.numel() / model.sr
                if seconds <= 0 or seconds > 30 or audio.numel() * audio.element_size() > 8 * 1024 * 1024:
                    raise ValueError('Generated line exceeds the preparation buffer limit.')
                if not bool(torch.isfinite(audio).all()):
                    raise ValueError('Model produced non-finite audio.')
                measurements.append({'run': index + 1, 'generationSeconds': elapsed, 'audioSeconds': seconds, 'realTimeFactor': elapsed / seconds})
                if playback:
                    try:
                        playback.play(audio.squeeze().numpy(), model.sr, blocking=True)
                    finally:
                        playback.stop()
                del audio
    return {'status': 'measured', 'platform': platform.platform(), 'machine': platform.machine(), 'memoryBytes': os.sysconf('SC_PHYS_PAGES') * os.sysconf('SC_PAGE_SIZE'), 'sourceRevision': LOCK['sourceRevision'], 'modelRevision': LOCK['revision'], 'device': 'mps', 'loadSeconds': load_seconds, 'peakProcessRssBytes': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss, 'measurements': measurements}


SOURCE_SHA256 = '2f27e8ff2fa35181fdd2849367fb96ecc2cb87a1088ca7520c8bd51946599f08'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare', 'check', 'benchmark'])
    parser.add_argument('--model-dir', type=Path, required=True)
    parser.add_argument('--voice-manifest', type=Path)
    parser.add_argument('--runs', type=int, default=30)
    parser.add_argument('--listen', action='store_true', help='Play evaluation lines live; never save audio.')
    args = parser.parse_args()
    if not 1 <= args.runs <= 100:
        parser.error('--runs must be between 1 and 100')
    if args.command == 'benchmark' and args.voice_manifest is None:
        parser.error('benchmark requires --voice-manifest for a cleared evaluation voice')
    if args.command == 'prepare':
        print(json.dumps({'status': 'downloading', 'bytes': sum(item['bytes'] for item in LOCK['files']), 'revision': LOCK['revision']}), flush=True)
        prepare(args.model_dir)
    elif args.command == 'check':
        verify(args.model_dir)
    else:
        print(json.dumps(benchmark(args.model_dir, args.voice_manifest, args.runs, args.listen)))
        return
    print(json.dumps({'status': 'verified', 'revision': LOCK['revision']}))


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print(json.dumps({'status': 'cancelled'}))
        sys.exit(130)
    except (ValueError, FileNotFoundError) as error:
        print(json.dumps({'status': 'failed', 'message': str(error)}))
        sys.exit(1)
    except Exception:
        print(json.dumps({'status': 'failed', 'message': 'Local evaluation failed. Check runtime dependencies, model files and MPS compatibility. No model output was logged.'}))
        sys.exit(1)
