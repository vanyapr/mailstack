#!/usr/bin/env python3
"""Resolve a SHA-verified Docker archive across classic/containerd image stores."""
import hashlib
import json
import pathlib
import platform
import re
import subprocess
import sys
import tarfile

DIGEST = re.compile(r'sha256:[a-f0-9]{64}\Z')


def archive_ids(path, expected, architecture):
    if not DIGEST.fullmatch(expected):
        raise ValueError('Invalid expected image identity')
    with tarfile.open(path) as tar:
        def read(name):
            try:
                member = tar.getmember(name)
            except KeyError:
                raise ValueError('Missing image identity metadata') from None
            if not member.isfile() or member.size > 1024 * 1024:
                raise ValueError('Invalid image metadata')
            return tar.extractfile(member).read()
        def blob(digest):
            if not isinstance(digest, str) or not DIGEST.fullmatch(digest):
                raise ValueError('Invalid metadata digest')
            data = read('blobs/sha256/' + digest[7:])
            if 'sha256:' + hashlib.sha256(data).hexdigest() != digest:
                raise ValueError('Image metadata digest mismatch')
            return json.loads(data)
        entries = json.loads(read('manifest.json'))
        if not isinstance(entries, list) or len(entries) != 1:
            raise ValueError('One image per archive is required')
        raw = read(entries[0]['Config'])
        config_id = 'sha256:' + hashlib.sha256(raw).hexdigest()
        config = json.loads(raw)
        if config.get('os') != 'linux' or config.get('architecture') != architecture:
            raise ValueError('Image architecture differs from the target')
        if expected == config_id:
            return [config_id]
        index = json.loads(read('index.json'))
        if not any(item.get('digest') == expected for item in index.get('manifests', [])):
            raise ValueError('Expected image identity is absent from the archive')
        runtime_ids = []
        def visit(digest, depth=0):
            if depth > 3:
                raise ValueError('Image index is too deeply nested')
            value = blob(digest)
            if value.get('config', {}).get('digest') == config_id:
                runtime_ids.append(digest)
            children = value.get('manifests', [])
            if not isinstance(children, list) or len(children) > 8:
                raise ValueError('Invalid image index')
            for item in children:
                visit(item['digest'], depth + 1)
        visit(expected)
        if not runtime_ids:
            raise ValueError('OCI identity does not reference the exported image config')
        return list(dict.fromkeys([expected, *runtime_ids, config_id]))


def inspect_image(value):
    return subprocess.check_output(['docker', 'image', 'inspect', '--format', '{{.Id}}', value], text=True, stderr=subprocess.DEVNULL).strip()


def resolve(path, expected, architecture, inspect=inspect_image):
    identities = archive_ids(path, expected, architecture)
    for value in identities:
        try:
            actual = inspect(value)
        except subprocess.CalledProcessError:
            continue
        if actual not in identities:
            raise ValueError('Loaded image identity differs from the verified archive')
        return actual
    raise ValueError('Verified image has not been loaded')


if __name__ == '__main__':
    try:
        architecture = {'x86_64': 'amd64', 'aarch64': 'arm64', 'arm64': 'arm64'}[platform.machine()]
        print(resolve(pathlib.Path(sys.argv[1]), sys.argv[2], architecture))
    except (ValueError, OSError, KeyError, IndexError, tarfile.TarError) as error:
        raise SystemExit('Image verification failed: ' + str(error))
