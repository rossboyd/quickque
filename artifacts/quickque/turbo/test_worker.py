import contextlib
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import worker


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.payload = b'model and default voice'
        self.lock = {'repository': 'test/model', 'revision': 'a' * 40, 'files': [
            {'name': 'conds.pt', 'bytes': len(self.payload), 'sha256': hashlib.sha256(self.payload).hexdigest()}
        ]}

    def test_bounded_chunks_preserve_every_word(self):
        text = ('We can begin [laugh] when everyone is ready. ' * 100).strip()
        lines = worker.validate_request({'text': text, 'voiceId': worker.VOICE_ID, 'rate': 1})
        self.assertEqual(' '.join(lines).split(), text.split())
        self.assertTrue(all(len(line) <= 240 and len(line.split()) <= 35 for line in lines))

    def test_invalid_requests_fail_before_generation(self):
        for request in [None, {'text': ''}, {'text': 'Hello', 'voiceId': 'actor-recording', 'rate': 1}, {'text': 'Hello', 'voiceId': worker.VOICE_ID, 'rate': 1.5}, {'text': 'x' * 200, 'voiceId': worker.VOICE_ID, 'rate': 1}]:
            with self.subTest(request=request), self.assertRaises(worker.SpeechFailure):
                worker.validate_request(request)

    def test_download_installs_and_verifies_default_conditioning(self):
        destination = self.root / 'model'
        with patch.object(worker, 'LOCK', self.lock), patch.object(worker.urllib.request, 'urlopen', return_value=io.BytesIO(self.payload)) as download, contextlib.redirect_stdout(io.StringIO()):
            worker.install(destination)
            self.assertTrue(worker.verify(destination, full=True))
            worker.install(destination)
            self.assertEqual(download.call_count, 1)
            (destination / 'conds.pt').write_bytes(b'x' * len(self.payload))
            self.assertFalse(worker.verify(destination, full=True))

    def test_cancel_and_integrity_failure_never_install_partial_model(self):
        for response in [KeyboardInterrupt(), io.BytesIO(b'x' * len(self.payload))]:
            with self.subTest(response=response), patch.object(worker, 'LOCK', self.lock), contextlib.redirect_stdout(io.StringIO()):
                options = {'side_effect': response} if isinstance(response, BaseException) else {'return_value': response}
                with patch.object(worker.urllib.request, 'urlopen', **options), self.assertRaises((KeyboardInterrupt, worker.SpeechFailure)):
                    worker.install(self.root / 'model')
                self.assertEqual(list(self.root.iterdir()), [])

    def test_model_lock_includes_pinned_default_voice(self):
        voice = next(item for item in worker.LOCK['files'] if item['name'] == 'conds.pt')
        self.assertEqual(voice['sha256'], 'b1852099306fd6a7814eb9d0bd10186caba7249596cc23868f78a0eefbfa5033')
        self.assertEqual(worker.LOCK['voice']['engine'], 'turbo')
        self.assertNotIn('s3gen.safetensors', [item['name'] for item in worker.LOCK['files']])

    def test_unlisted_files_and_symlinks_are_rejected(self):
        directory = self.root / 'model'
        directory.mkdir()
        with patch.object(worker, 'LOCK', self.lock):
            target = directory / 'conds.pt'
            target.write_bytes(self.payload)
            self.assertTrue(worker.verify(directory, full=True))
            (directory / 'extra.pt').write_bytes(b'extra')
            self.assertFalse(worker.verify(directory))
            (directory / 'extra.pt').unlink()
            target.unlink()
            outside = self.root / 'outside'
            outside.write_bytes(self.payload)
            target.symlink_to(outside)
            self.assertFalse(worker.verify(directory))


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.request = {'scriptId': 'script-1', 'revision': 'revision-1', 'entries': [
            {'id': 'turn-1', 'text': 'Hello world.', 'voiceId': worker.VOICE_ID, 'rate': 1},
            {'id': 'turn-2', 'text': 'Goodbye world.', 'voiceId': worker.VOICE_ID, 'rate': 1}]}
        self.calls = []

    def render(self, directory, entries, folder):
        import wave
        self.calls.append([entry['id'] for entry in entries])
        for entry in entries:
            with wave.open(str(folder / (worker.entry_key(entry) + '.wav')), 'wb') as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(24000)
                output.writeframes(b'\0\0' * 2400)
            yield entry

    def generate(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return worker.generate_batch(self.root / 'model', self.root, self.request, renderer=self.render)

    def test_cache_reuses_audio_and_only_regenerates_changed_dialogue(self):
        self.assertEqual(self.generate()['status'], 'ready')
        self.generate()
        self.assertEqual(len(self.calls), 1)
        self.request['revision'] = 'revision-2'
        self.request['entries'][1]['text'] = 'A revised goodbye.'
        self.generate()
        self.assertEqual(self.calls[-1], ['turn-2'])
        manifest = json.loads((self.root / hashlib.sha256(b'script-1').hexdigest() / 'manifest.json').read_text())
        self.assertEqual(manifest['revision'], 'revision-2')
        self.assertAlmostEqual(manifest['entries'][0]['durationSeconds'], .1)

    def test_interrupted_generation_does_not_commit_partial_revision(self):
        self.generate()
        self.request['revision'] = 'revision-2'
        self.request['entries'][1]['text'] = 'Revised.'
        def fail(*args):
            raise KeyboardInterrupt()
            yield
        with self.assertRaises(KeyboardInterrupt):
            worker.generate_batch(self.root / 'model', self.root, self.request, renderer=fail)
        manifest = json.loads((self.root / hashlib.sha256(b'script-1').hexdigest() / 'manifest.json').read_text())
        self.assertEqual(manifest['revision'], 'revision-1')

    def test_corrupt_wav_is_regenerated(self):
        self.generate()
        path = self.root / hashlib.sha256(b'script-1').hexdigest() / (worker.entry_key(self.request['entries'][0]) + '.wav')
        path.write_bytes(b'not audio')
        self.assertEqual(worker.cache_status(self.root, self.request)['missing'], 1)
        self.generate()
        self.assertEqual(self.calls[-1], ['turn-1'])

    def test_path_traversal_and_duplicate_ids_rejected(self):
        for identity in ['../secret', '/tmp', 'a/b', '']:
            self.request['revision'] = identity
            with self.assertRaises(worker.SpeechFailure):
                worker.cache_status(self.root, self.request)
        self.request['revision'] = 'revision-1'
        self.request['entries'][1]['id'] = 'turn-1'
        with self.assertRaises(worker.SpeechFailure):
            worker.cache_status(self.root, self.request)


if __name__ == '__main__':
    unittest.main()
