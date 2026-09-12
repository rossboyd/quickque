"""Bundled offline Chatterbox worker. JSON protocol; never writes dialogue/audio."""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import sys
import tempfile
import urllib.request

LOCK = json.loads(Path(__file__).with_name('model-lock.json').read_text())
TOTAL_BYTES = sum(item['bytes'] for item in LOCK['files'])
VOICE_ID = LOCK['voice']['id']


class SpeechFailure(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


def emit(value):
    print(json.dumps(value), flush=True)


def sha256(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def verify(directory, full=False):
    if directory.is_symlink() or not directory.is_dir():
        return False
    if {path.name for path in directory.iterdir()} != {item['name'] for item in LOCK['files']}:
        return False
    for item in LOCK['files']:
        path = directory / item['name']
        if path.is_symlink() or not path.is_file() or path.stat().st_size != item['bytes']:
            return False
        if full and sha256(path) != item['sha256']:
            return False
    return True


def install(directory):
    if verify(directory, full=True):
        emit({'status': 'ready', 'downloadedBytes': TOTAL_BYTES, 'totalBytes': TOTAL_BYTES})
        return
    if directory.exists():
        raise SpeechFailure('SCENE_SPEECH_TURBO_FILES', 'Chatterbox files are damaged. Remove the model folder before downloading again.')
    directory.parent.mkdir(parents=True, exist_ok=True)
    # One installer owns staging; an interrupted hard kill is recovered next time.
    stage = directory.with_name(directory.name + '.download')
    if stage.is_symlink():
        raise SpeechFailure('SCENE_SPEECH_TURBO_FILES', 'Invalid Chatterbox download folder.')
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir()
    completed = 0
    try:
        for item in LOCK['files']:
            url = f"https://huggingface.co/{LOCK['repository']}/resolve/{LOCK['revision']}/{item['name']}"
            with urllib.request.urlopen(url, timeout=30) as source, (stage / item['name']).open('xb') as target:
                remaining = item['bytes']
                last_report = completed
                while remaining:
                    chunk = source.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise OSError('Incomplete download')
                    target.write(chunk)
                    remaining -= len(chunk)
                    completed += len(chunk)
                    if completed - last_report >= 8 * 1024 * 1024:
                        emit({'status': 'downloading', 'downloadedBytes': completed, 'totalBytes': TOTAL_BYTES})
                        last_report = completed
                if source.read(1):
                    raise OSError('Oversized download')
            if sha256(stage / item['name']) != item['sha256']:
                raise SpeechFailure('SCENE_SPEECH_TURBO_FILES', 'Chatterbox download failed verification. Retry the download.')
        if not verify(stage, full=True):
            raise SpeechFailure('SCENE_SPEECH_TURBO_FILES', 'Chatterbox download failed verification. Retry the download.')
        if directory.exists():
            raise SpeechFailure('SCENE_SPEECH_TURBO_FILES', 'A Chatterbox installation already exists.')
        stage.rename(directory)
        emit({'status': 'ready', 'downloadedBytes': TOTAL_BYTES, 'totalBytes': TOTAL_BYTES})
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def chunks(text):
    # Bound generation without silently truncating a turn. Preserve all words
    # and bracket cues; splitting is only at whitespace. No director notes.
    words = text.split()
    chunk = []
    size = 0
    for word in words:
        if len(word) > 160:
            raise SpeechFailure('SCENE_SPEECH_TEXT_TOO_LONG', 'A word or cue is too long for Chatterbox. Add spacing or use a system voice.')
        if chunk and (size + len(word) + 1 > 240 or len(chunk) >= 35):
            yield ' '.join(chunk)
            chunk, size = [], 0
        chunk.append(word)
        size += len(word) + 1
    if chunk:
        yield ' '.join(chunk)


def validate_request(request):
    if not isinstance(request, dict) or not isinstance(request.get('text'), str) or not request['text'].strip():
        raise SpeechFailure('SCENE_SPEECH_TEXT_EMPTY', 'Add dialogue before starting Chatterbox.')
    if len(request['text'].encode('utf-8')) > 100_000:
        raise SpeechFailure('SCENE_SPEECH_TEXT_TOO_LONG', 'This turn is too long for Chatterbox.')
    if request.get('voiceId') != VOICE_ID:
        raise SpeechFailure('SCENE_SPEECH_VOICE_UNAVAILABLE', 'Choose Chatterbox Default for this character.')
    if type(request.get('rate')) not in (int, float) or request['rate'] != 1:
        raise SpeechFailure('SCENE_SPEECH_RATE_INVALID', 'Chatterbox Default currently uses its natural speaking rate (1×).')
    # Validate the entire turn before producing partial speech.
    return list(chunks(request['text']))


def no_network(*args, **kwargs):
    raise SpeechFailure('SCENE_SPEECH_TURBO_OFFLINE', 'Chatterbox tried to fetch a missing runtime asset. Reinstall Quickque.')


@contextlib.contextmanager
def quiet_runtime():
    # Includes native-library output, not just Python print/logging.
    sys.stdout.flush()
    sys.stderr.flush()
    saved = [os.dup(fd) for fd in (1, 2)]
    with open(os.devnull, 'w') as sink:
        try:
            os.dup2(sink.fileno(), 1)
            os.dup2(sink.fileno(), 2)
            yield
        finally:
            sys.stdout.flush()
            sys.stderr.flush()
            for fd, original in zip((1, 2), saved):
                os.dup2(original, fd)
                os.close(original)


def speak(directory, request):
    lines = validate_request(request)
    if not verify(directory, full=True):
        raise SpeechFailure('SCENE_SPEECH_TURBO_UNAVAILABLE', 'Download Chatterbox in Scene Partner setup before previewing or rehearsing.')
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1', PYTORCH_ENABLE_MPS_FALLBACK='0')
    socket.create_connection = no_network
    socket.socket.connect = no_network
    socket.socket.connect_ex = no_network
    with quiet_runtime():
        import torch
        import sounddevice
        from chatterbox.tts_turbo import ChatterboxTurboTTS, punc_norm
        if not torch.backends.mps.is_available():
            raise SpeechFailure('SCENE_SPEECH_TURBO_UNSUPPORTED', 'Chatterbox needs an Apple Silicon Mac with MPS available.')
        model = ChatterboxTurboTTS.from_local(directory, device='mps')
        # Reject oversized token sequences before upstream's truncation=True.
        for line in lines:
            tokens = model.tokenizer(punc_norm(line), truncation=False)['input_ids']
            if len(tokens) > 128:
                raise SpeechFailure('SCENE_SPEECH_TEXT_TOO_LONG', 'A passage is too complex for Chatterbox. Shorten this turn or choose a system voice.')
        try:
            with torch.inference_mode():
                for line in lines:
                    audio = model.generate(line)  # Official Perth watermark stays enabled.
                    if not 0 < audio.numel() <= model.sr * 30 or audio.numel() * audio.element_size() > 8 * 1024 * 1024:
                        raise SpeechFailure('SCENE_SPEECH_TURBO_AUDIO', 'Chatterbox generated an oversized passage. Shorten this turn and retry.')
                    if not bool(torch.isfinite(audio).all()):
                        raise SpeechFailure('SCENE_SPEECH_TURBO_AUDIO', 'Chatterbox could not generate clean audio. Retry the turn.')
                    sounddevice.play(audio.squeeze().numpy(), model.sr, blocking=True)
                    del audio
        finally:
            sounddevice.stop()
    emit({'status': 'finished'})


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    for name in ('status', 'install', 'speak', 'check-runtime'):
        mode.add_argument('--' + name, action='store_true')
    parser.add_argument('--model-dir', type=Path, required=True)
    args = parser.parse_args()
    if args.status:
        emit({'status': 'ready' if verify(args.model_dir) else 'not-installed', 'totalBytes': TOTAL_BYTES, 'voice': LOCK['voice']})
    elif args.install:
        install(args.model_dir)
    elif args.check_runtime:
        with quiet_runtime():
            import torch
            import sounddevice
            from chatterbox.tts_turbo import ChatterboxTurboTTS
            import perth
            watermarker = perth.PerthImplicitWatermarker()
            if not torch.backends.mps.is_available():
                raise SpeechFailure('SCENE_SPEECH_TURBO_UNSUPPORTED', 'MPS is unavailable in the bundled runtime.')
        emit({'status': 'runtime-ready'})
    else:
        raw = sys.stdin.buffer.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise SpeechFailure('SCENE_SPEECH_TEXT_TOO_LONG', 'This speech request is too large.')
        speak(args.model_dir, json.loads(raw))


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(130))
    try:
        main()
    except (KeyboardInterrupt, SystemExit) as error:
        if isinstance(error, SystemExit) and error.code == 0:
            raise
        sys.exit(130)
    except SpeechFailure as error:
        emit({'error': error.code, 'message': error.message})
        sys.exit(1)
    except Exception:
        emit({'error': 'SCENE_SPEECH_TURBO_FAILED', 'message': 'Chatterbox could not finish. Check the download and audio output, then retry. If this repeats, reinstall Quickque.'})
        sys.exit(1)
