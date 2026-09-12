import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import evaluate


class EvaluationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.payload = b'locked model bytes'
        self.lock = {'repository': 'test/model', 'revision': 'a' * 40, 'files': [
            {'name': 'weights.bin', 'bytes': len(self.payload), 'sha256': hashlib.sha256(self.payload).hexdigest()}
        ]}

    def model(self):
        directory = self.root / 'model'
        directory.mkdir()
        (directory / 'weights.bin').write_bytes(self.payload)
        return directory

    def test_corruption_and_unchecked_demo_voice_are_rejected(self):
        directory = self.model()
        evaluate.verify(directory, self.lock)
        (directory / 'weights.bin').write_bytes(b'x' * len(self.payload))
        with self.assertRaises(ValueError):
            evaluate.verify(directory, self.lock)
        (directory / 'weights.bin').write_bytes(self.payload)
        (directory / 'conds.pt').write_bytes(b'not cleared')
        with self.assertRaises(ValueError):
            evaluate.verify(directory, self.lock)

    def test_symlink_model_rejected(self):
        directory = self.model()
        (directory / 'weights.bin').unlink()
        target = self.root / 'outside'
        target.write_bytes(self.payload)
        (directory / 'weights.bin').symlink_to(target)
        with self.assertRaises(ValueError):
            evaluate.verify(directory, self.lock)

    def test_failed_download_never_installs_partial_model(self):
        directory = self.root / 'model'
        with patch.object(evaluate, 'LOCK', self.lock), patch.object(evaluate.urllib.request, 'urlopen', return_value=io.BytesIO(b'short')):
            with self.assertRaises(ValueError):
                evaluate.prepare(directory)
        self.assertFalse(directory.exists())
        self.assertEqual(list(self.root.iterdir()), [])

    def test_cancelled_download_removes_staging(self):
        with patch.object(evaluate, 'LOCK', self.lock), patch.object(evaluate.urllib.request, 'urlopen', side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                evaluate.prepare(self.root / 'model')
        self.assertEqual(list(self.root.iterdir()), [])

    def test_verified_install_and_existing_install_never_downloads(self):
        real_verify = evaluate.verify
        with patch.object(evaluate, 'LOCK', self.lock), patch.object(evaluate, 'verify', side_effect=lambda path: real_verify(path, self.lock)), patch.object(evaluate.urllib.request, 'urlopen', return_value=io.BytesIO(self.payload)) as download:
            evaluate.prepare(self.root / 'model')
            evaluate.prepare(self.root / 'model')
            self.assertEqual(download.call_count, 1)
        self.assertEqual([p.name for p in self.root.iterdir()], ['model'])

    def test_voice_requires_consent_hash_and_local_file(self):
        voice = self.root / 'voice.pt'
        voice.write_bytes(b'voice')
        manifest = self.root / 'voice.json'
        data = {'file': 'voice.pt', 'sha256': evaluate.digest(voice), 'provenance': 'Commissioned test fixture'}
        manifest.write_text(json.dumps(data))
        with self.assertRaises(ValueError):
            evaluate.voice_path(manifest)
        data['consent'] = 'approved-for-quickque-evaluation'
        manifest.write_text(json.dumps(data))
        self.assertEqual(evaluate.voice_path(manifest), voice)
        voice.write_bytes(b'changed')
        with self.assertRaises(ValueError):
            evaluate.voice_path(manifest)


if __name__ == '__main__':
    unittest.main()
