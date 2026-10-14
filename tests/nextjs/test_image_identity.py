import hashlib
import importlib.util
import io
import json
import pathlib
import subprocess
import tarfile
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('image_identity', ROOT / 'deploy/bin/image_identity.py')
identity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(identity)


def fixture(path, oci=True, architecture='amd64'):
    values = {}
    def blob(value):
        data = json.dumps(value).encode()
        digest = 'sha256:' + hashlib.sha256(data).hexdigest()
        values['blobs/sha256/' + digest[7:]] = data
        return digest
    config = blob({'architecture': architecture, 'os': 'linux', 'config': {}, 'rootfs': {'type': 'layers', 'diff_ids': []}})
    runtime = blob({'schemaVersion': 2, 'config': {'digest': config}, 'layers': []})
    index = blob({'schemaVersion': 2, 'manifests': [{'digest': runtime}]})
    values['manifest.json'] = json.dumps([{'Config': 'blobs/sha256/' + config[7:], 'RepoTags': ['fixture:only'], 'Layers': []}]).encode()
    if oci:
        values['index.json'] = json.dumps({'schemaVersion': 2, 'manifests': [{'digest': index}]}).encode()
    with tarfile.open(path, 'w') as tar:
        for name, data in values.items():
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            tar.addfile(entry, io.BytesIO(data))
    return index if oci else config, runtime, config


class ImageIdentity(unittest.TestCase):
    def test_containerd_package_resolves_classic_config_id(self):
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp) / 'image.tar'
            expected, runtime, config = fixture(path)
            calls = []
            def inspect(value):
                calls.append(value)
                if value != config:
                    raise subprocess.CalledProcessError(1, ['docker', 'inspect', value])
                return config
            self.assertEqual(identity.resolve(path, expected, 'amd64', inspect), config)
            self.assertEqual(calls, [expected, runtime, config])

    def test_containerd_keeps_exact_expected_id(self):
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp) / 'image.tar'
            expected, _, _ = fixture(path)
            self.assertEqual(identity.resolve(path, expected, 'amd64', lambda value: value), expected)

    def test_classic_package_and_foreign_identity(self):
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp) / 'image.tar'
            expected, _, _ = fixture(path, False)
            self.assertEqual(identity.resolve(path, expected, 'amd64', lambda value: value), expected)
            with self.assertRaisesRegex(ValueError, 'identity'):
                identity.resolve(path, 'sha256:' + 'a' * 64, 'amd64', lambda value: self.fail('must not inspect foreign images'))
            with self.assertRaisesRegex(ValueError, 'identity'):
                identity.resolve(path, expected, 'amd64', lambda value: 'sha256:' + 'b' * 64)

    def test_architecture_and_missing_image_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp) / 'image.tar'
            expected, _, _ = fixture(path)
            with self.assertRaisesRegex(ValueError, 'architecture'):
                identity.resolve(path, expected, 'arm64', lambda value: self.fail('must not inspect wrong platform'))
            def missing(value):
                raise subprocess.CalledProcessError(1, ['docker', 'inspect', value])
            with self.assertRaisesRegex(ValueError, 'loaded'):
                identity.resolve(path, expected, 'amd64', missing)

    def test_tampered_descriptor_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp) / 'image.tar'
            expected, _, _ = fixture(path)
            with tarfile.open(path, 'a') as tar:
                data = b'{"schemaVersion":2}'
                entry = tarfile.TarInfo('blobs/sha256/' + expected[7:])
                entry.size = len(data)
                tar.addfile(entry, io.BytesIO(data))
            with self.assertRaisesRegex(ValueError, 'digest'):
                identity.resolve(path, expected, 'amd64', lambda value: self.fail('must not inspect corrupt metadata'))
