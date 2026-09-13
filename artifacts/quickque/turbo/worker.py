"""Bundled offline Chatterbox worker. JSON protocol; explicitly generated audio is persisted in the script cache."""
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
import wave

LOCK = json.loads(Path(__file__).with_name('model-lock.json').read_text())
TOTAL_BYTES = sum(item['bytes'] for item in LOCK['files'])
VOICE_ID = LOCK['voice']['id']
LOCAL_VOICE_PREFIX = 'chatterbox-local:'
VOICE_ID_RE = re.compile(r'^[0-9a-f]{32}$')


class SpeechFailure(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


def emit(value):
    print(json.dumps(value), flush=True)


@contextlib.contextmanager
def runtime_stage(stage, report=False):
    """Report fixed stages and exception categories, never text, paths or stderr."""
    if report:
        emit({'status': 'diagnostic', 'stage': stage})
    try:
        yield
    except SpeechFailure:
        raise
    except Exception as error:
        category = next((kind.__name__ for kind in (
            MemoryError, ImportError, OSError, ValueError, TypeError, RuntimeError,
        ) if isinstance(error, kind)), 'Exception')
        raise SpeechFailure(
            'SCENE_SPEECH_TURBO_' + stage.upper(),
            f'Chatterbox failed during {stage.replace("_", " ")} ({category}). '
            'Copy the Debug trace and report this error.',
        ) from error


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
            raise SpeechFailure('SCENE_SPEECH_TEXT_TOO_LONG', 'A word or cue is too long for Chatterbox. Add spacing or split the passage.')
        if chunk and (size + len(word) + 1 > 240 or len(chunk) >= 35):
            yield ' '.join(chunk)
            chunk, size = [], 0
        chunk.append(word)
        size += len(word) + 1
    if chunk:
        yield ' '.join(chunk)


def local_voice_reference(request, voices_dir):
    voice_id = request.get('voiceId')
    if not isinstance(voice_id, str) or not voice_id.startswith(LOCAL_VOICE_PREFIX):
        return None
    identity = voice_id[len(LOCAL_VOICE_PREFIX):]
    if voices_dir is None or not VOICE_ID_RE.fullmatch(identity):
        raise SpeechFailure('SCENE_SPEECH_VOICE_UNAVAILABLE', 'The selected cloned voice is unavailable. Re-record it in Quickque.')
    root = Path(voices_dir)
    if root.is_symlink() or not root.is_dir():
        raise SpeechFailure('SCENE_SPEECH_VOICE_UNAVAILABLE', 'The selected cloned voice is unavailable. Re-record it in Quickque.')
    folder = root / identity
    reference = folder / 'reference.wav'
    metadata = folder / 'metadata.json'
    if folder.is_symlink() or reference.is_symlink() or metadata.is_symlink() or not reference.is_file() or not metadata.is_file():
        raise SpeechFailure('SCENE_SPEECH_VOICE_UNAVAILABLE', 'The selected cloned voice is unavailable. Re-record it in Quickque.')
    try:
        details = json.loads(metadata.read_text())
        if details.get('id') != identity or details.get('consentConfirmed') is not True:
            raise ValueError()
        if request.get('voiceRevision') != details.get('revision'):
            raise ValueError()
        if sha256(reference) != details.get('recordingSha256'):
            raise ValueError()
        duration = wav_duration(reference)
        if duration is None or not 5 <= duration <= 10:
            raise ValueError()
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        raise SpeechFailure('SCENE_SPEECH_VOICE_INTEGRITY', 'The selected cloned voice is damaged or incomplete. Re-record it.')
    return reference


def validate_request(request, voices_dir=None):
    if not isinstance(request, dict) or not isinstance(request.get('text'), str) or not request['text'].strip():
        raise SpeechFailure('SCENE_SPEECH_TEXT_EMPTY', 'Add dialogue before starting Chatterbox.')
    if len(request['text'].encode('utf-8')) > 100_000:
        raise SpeechFailure('SCENE_SPEECH_TEXT_TOO_LONG', 'This turn is too long for Chatterbox.')
    reference = None
    if request.get('voiceId') != VOICE_ID:
        reference = local_voice_reference(request, voices_dir)
        if reference is None:
            raise SpeechFailure('SCENE_SPEECH_VOICE_UNAVAILABLE', 'Choose Chatterbox Turbo or an approved local cloned voice.')
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


def speak(directory, request, voices_dir=None):
    lines = validate_request(request, voices_dir)
    reference = local_voice_reference(request, voices_dir)
    if not verify(directory, full=True):
        raise SpeechFailure('SCENE_SPEECH_TURBO_UNAVAILABLE', 'Download Chatterbox in Scene Partner setup before previewing or rehearsing.')
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1', PYTORCH_ENABLE_MPS_FALLBACK='0')
    socket.create_connection = no_network
    socket.socket.connect = no_network
    socket.socket.connect_ex = no_network
    with runtime_stage('model_load'), quiet_runtime():
        import torch
        import sounddevice
        from chatterbox.tts_turbo import ChatterboxTurboTTS, punc_norm
        if not torch.backends.mps.is_available():
            raise SpeechFailure('SCENE_SPEECH_TURBO_UNSUPPORTED', 'Chatterbox needs an Apple Silicon Mac with MPS available.')
        model = ChatterboxTurboTTS.from_local(directory, device='mps')
    with runtime_stage('generation'), quiet_runtime():
        # Reject oversized token sequences before upstream's truncation=True.
        for line in lines:
            tokens = model.tokenizer(punc_norm(line), truncation=False)['input_ids']
            if len(tokens) > 128:
                raise SpeechFailure('SCENE_SPEECH_TEXT_TOO_LONG', 'A passage is too complex for Chatterbox. Shorten this turn.')
        try:
            with torch.inference_mode():
                for line in lines:
                    kwargs = {'audio_prompt_path': str(reference)} if reference is not None else {}
                    audio = model.generate(line, **kwargs)  # Official Perth watermark stays enabled.
                    if not 0 < audio.numel() <= model.sr * 30 or audio.numel() * audio.element_size() > 8 * 1024 * 1024:
                        raise SpeechFailure('SCENE_SPEECH_TURBO_AUDIO', 'Chatterbox generated an oversized passage. Shorten this turn and retry.')
                    if not bool(torch.isfinite(audio).all()):
                        raise SpeechFailure('SCENE_SPEECH_TURBO_AUDIO', 'Chatterbox could not generate clean audio. Retry the turn.')
                    sounddevice.play(audio.detach().cpu().squeeze().numpy(), model.sr, blocking=True)
                    del audio
        finally:
            sounddevice.stop()
    emit({'status': 'finished'})



CACHE_VERSION = 'chatterbox-cache-v1:' + LOCK['revision']


def validate_batch(request, voices_dir=None):
    if not isinstance(request, dict) or not isinstance(request.get('entries'), list) or not 1 <= len(request['entries']) <= 2000:
        raise SpeechFailure('SCRIPT_AUDIO_INVALID', 'Choose between 1 and 2000 spoken passages.')
    if not isinstance(request.get('scriptId'), str) or not 1 <= len(request['scriptId']) <= 200:
        raise SpeechFailure('SCRIPT_AUDIO_INVALID', 'Invalid script identity.')
    for field in ('revision',):
        if not isinstance(request.get(field), str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', request[field]):
            raise SpeechFailure('SCRIPT_AUDIO_INVALID', 'Invalid script audio identity.')
    ids = set()
    total = 0
    for entry in request['entries']:
        validate_request(entry, voices_dir)
        if not isinstance(entry.get('id'), str) or not 1 <= len(entry['id']) <= 200 or entry['id'] in ids:
            raise SpeechFailure('SCRIPT_AUDIO_INVALID', 'Every passage needs a unique identifier.')
        ids.add(entry['id'])
        total += len(entry['text'].encode())
    if total > 2_000_000:
        raise SpeechFailure('SCRIPT_AUDIO_INVALID', 'This script is too large to generate in one batch.')
    return request


def entry_key(entry):
    content = [CACHE_VERSION, entry['text'], entry['voiceId'], entry.get('voiceRevision'), entry['rate']]
    return hashlib.sha256(json.dumps(content, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def wav_duration(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 128 * 1024 * 1024:
        return None
    try:
        with wave.open(str(path), 'rb') as audio:
            if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or not 8000 <= audio.getframerate() <= 96000 or audio.getnframes() <= 0:
                return None
            audio.setpos(audio.getnframes() - 1)
            if len(audio.readframes(1)) != 2:
                return None
            return audio.getnframes() / audio.getframerate()
    except (OSError, EOFError, wave.Error):
        return None


def cache_status(root, request, voices_dir=None):
    validate_batch(request, voices_dir)
    folder = root / hashlib.sha256(request['scriptId'].encode()).hexdigest()
    entries = []
    for entry in request['entries']:
        key = entry_key(entry)
        duration = wav_duration(folder / (key + '.wav'))
        entries.append({'id': entry['id'], 'key': key, 'durationSeconds': duration})
    missing = sum(entry['durationSeconds'] is None for entry in entries)
    return {'scriptId': request['scriptId'], 'revision': request['revision'], 'status': 'missing' if missing else 'ready', 'missing': missing, 'entries': entries}


def atomic_json(path, value):
    temporary = path.with_suffix('.json.partial')
    with temporary.open('w') as output:
        json.dump(value, output)
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(path)


def render_batch(directory, entries, folder, voices_dir=None):
    # Load the model once for every missing passage in this save, never during playback.
    if not verify(directory, full=True):
        raise SpeechFailure('SCENE_SPEECH_TURBO_UNAVAILABLE', 'Download Chatterbox before generating audio.')
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1', PYTORCH_ENABLE_MPS_FALLBACK='0')
    socket.create_connection = no_network
    socket.socket.connect = no_network
    socket.socket.connect_ex = no_network
    with runtime_stage('model_load', report=True), quiet_runtime():
        import torch
        from chatterbox.tts_turbo import ChatterboxTurboTTS, punc_norm
        if not torch.backends.mps.is_available():
            raise SpeechFailure('SCENE_SPEECH_TURBO_UNSUPPORTED', 'Chatterbox needs an Apple Silicon Mac with MPS available.')
        model = ChatterboxTurboTTS.from_local(directory, device='mps')
    for entry in entries:
        target = folder / (entry_key(entry) + '.wav')
        if wav_duration(target) is not None:
            yield entry  # Repeated identical dialogue shares the first generated WAV.
            continue
        temporary = target.with_suffix('.wav.partial')
        try:
            with runtime_stage('generation', report=True), quiet_runtime(), torch.inference_mode(), wave.open(str(temporary), 'wb') as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(model.sr)
                total = 0
                lines = validate_request(entry, voices_dir)
                reference = local_voice_reference(entry, voices_dir)
                for line in lines:
                    if len(model.tokenizer(punc_norm(line), truncation=False)['input_ids']) > 128:
                        raise SpeechFailure('SCENE_SPEECH_TEXT_TOO_LONG', 'Shorten this passage before generating audio.')
                    kwargs = {'audio_prompt_path': str(reference)} if reference is not None else {}
                    audio = model.generate(line, **kwargs)  # Keep the official Perth watermark.
                    if not 0 < audio.numel() <= model.sr * 30 or not bool(torch.isfinite(audio).all()):
                        raise SpeechFailure('SCENE_SPEECH_TURBO_AUDIO', 'Could not generate clean audio. Retry this passage.')
                    pcm = (audio.detach().cpu().flatten().clamp(-1, 1).numpy() * 32767).astype('<i2').tobytes()
                    total += len(pcm)
                    if total > 128 * 1024 * 1024:
                        raise SpeechFailure('SCENE_SPEECH_TURBO_AUDIO', 'This passage is too long. Split it into shorter passages.')
                    output.writeframes(pcm)
            if wav_duration(temporary) is None:
                raise SpeechFailure('SCENE_SPEECH_TURBO_AUDIO', 'Generated audio did not pass verification.')
            with temporary.open('rb') as completed_audio:
                os.fsync(completed_audio.fileno())
            temporary.replace(target)
            yield entry
        finally:
            temporary.unlink(missing_ok=True)


def generate_batch(directory, root, request, renderer=render_batch, voices_dir=None):
    status = cache_status(root, request, voices_dir)
    folder = root / hashlib.sha256(request['scriptId'].encode()).hexdigest()
    if root.is_symlink() or folder.is_symlink():
        raise SpeechFailure('SCRIPT_AUDIO_INVALID', 'Invalid script audio folder.')
    folder.mkdir(parents=True, exist_ok=True)
    missing = [entry for entry in request['entries'] if wav_duration(folder / (entry_key(entry) + '.wav')) is None]
    completed = len(request['entries']) - len(missing)
    if renderer is render_batch:
        rendered = renderer(directory, missing, folder, voices_dir=voices_dir) if missing else []
    else:
        rendered = renderer(directory, missing, folder) if missing else []
    emit({'status': 'generating', 'scriptId': request['scriptId'], 'revision': request['revision'], 'completed': completed, 'total': len(request['entries'])})
    for _ in rendered:
        completed += 1
        emit({'status': 'generating', 'scriptId': request['scriptId'], 'revision': request['revision'], 'completed': completed, 'total': len(request['entries'])})
    status = cache_status(root, request, voices_dir)
    if status['missing']:
        raise SpeechFailure('SCRIPT_AUDIO_INCOMPLETE', 'Some passages are missing. Generate audio again.')
    # Only a complete revision becomes playable; interruption retains previous revision.
    atomic_json(folder / 'manifest.json', status)
    emit(status)
    return status

def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    for name in ('status', 'install', 'speak', 'check-runtime', 'check-package', 'generate-batch', 'cache-status'):
        mode.add_argument('--' + name, action='store_true')
    parser.add_argument('--model-dir', type=Path, required=True)
    parser.add_argument('--cache-dir', type=Path)
    parser.add_argument('--voices-dir', type=Path)
    args = parser.parse_args()
    if args.status:
        emit({'status': 'ready' if verify(args.model_dir) else 'not-installed', 'totalBytes': TOTAL_BYTES, 'voice': LOCK['voice']})
    elif args.install:
        install(args.model_dir)
    elif args.check_runtime or args.check_package:
        with quiet_runtime():
            import torch
            import sounddevice
            from chatterbox.tts_turbo import ChatterboxTurboTTS
            import perth
            watermarker = perth.PerthImplicitWatermarker()
            if not args.check_package and not torch.backends.mps.is_available():
                raise SpeechFailure('SCENE_SPEECH_TURBO_UNSUPPORTED', 'MPS is unavailable in the bundled runtime.')
        emit({'status': 'package-ready' if args.check_package else 'runtime-ready', 'mpsAvailable': torch.backends.mps.is_available()})
    else:
        raw = sys.stdin.buffer.read(4 * 1024 * 1024 + 1)
        if len(raw) > 4 * 1024 * 1024:
            raise SpeechFailure('SCENE_SPEECH_TEXT_TOO_LONG', 'This speech request is too large.')
        request = json.loads(raw)
        if args.generate_batch:
            generate_batch(args.model_dir, args.cache_dir, request, voices_dir=args.voices_dir)
        elif args.cache_status:
            emit(cache_status(args.cache_dir, request, args.voices_dir))
        else:
            speak(args.model_dir, request, args.voices_dir)


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
        emit({'error': 'SCENE_SPEECH_TURBO_FAILED', 'message': 'Chatterbox encountered an unexpected worker error. Copy the Debug trace and report this error.'})
        sys.exit(1)
