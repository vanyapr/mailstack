#!/usr/bin/env python3
"""Fetch the one pinned Mox source archive required for local and CI builds."""

from __future__ import annotations

import hashlib
from pathlib import Path
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
VERSION = "v0.0.17"
SHA256 = "22f0d7deeaef6e8bae21f98e37ebcff7d18499591638b89eff484eb7fd06ea37"
URL = f"https://codeload.github.com/mjl-/mox/tar.gz/refs/tags/{VERSION}"


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def ensure_mox_source(root: Path = ROOT) -> Path:
    destination = root / "artifacts" / "vendor" / f"mox-{VERSION}-source.tar.gz"
    if destination.exists():
        if destination.is_symlink() or digest(destination) != SHA256:
            raise ValueError(f"Existing Mox source differs: {destination.name}")
        return destination

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".download")
    if temporary.exists() or temporary.is_symlink():
        raise ValueError(f"Review incomplete Mox download: {temporary.name}")
    try:
        request = urllib.request.Request(URL, headers={"User-Agent": "MailStack-source-verifier"})
        with urllib.request.urlopen(request, timeout=60) as response, temporary.open("xb") as output:
            while block := response.read(1024 * 1024):
                output.write(block)
        if digest(temporary) != SHA256:
            raise ValueError("Pinned Mox source checksum mismatch")
        temporary.replace(destination)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    return destination


if __name__ == "__main__":
    print(ensure_mox_source())
