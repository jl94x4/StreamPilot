#!/usr/bin/env python3
"""Re-sync overlays/assets/kometa-images from upstream Kometa + Default-Images fonts.

Usage:
  python scripts/sync-kometa-overlay-images.py
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "overlays" / "assets" / "kometa-images"
FONT_URLS = {
    "Inter-Medium.ttf": "https://raw.githubusercontent.com/Kometa-Team/Default-Images/master/Inter-Medium.ttf",
    "Inter-Bold.ttf": "https://raw.githubusercontent.com/Kometa-Team/Default-Images/master/Inter-Bold.ttf",
}


def main() -> int:
    DEST.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="kometa-images-") as tmp:
        tmp_path = Path(tmp)
        repo = tmp_path / "Kometa"
        print("Cloning Kometa (sparse: defaults/overlays/images)…")
        subprocess.check_call(
            [
                "git",
                "clone",
                "--depth",
                "1",
                "--filter=blob:none",
                "--sparse",
                "https://github.com/Kometa-Team/Kometa.git",
                str(repo),
            ]
        )
        subprocess.check_call(
            ["git", "-C", str(repo), "sparse-checkout", "set", "defaults/overlays/images"]
        )
        src = repo / "defaults" / "overlays" / "images"
        if not src.is_dir():
            print("ERROR: sparse checkout missing defaults/overlays/images", file=sys.stderr)
            return 1
        if DEST.exists():
            # Keep fonts if present until we refresh them.
            shutil.rmtree(DEST)
        print(f"Copying → {DEST}")
        shutil.copytree(src, DEST)

    fonts = DEST / "fonts"
    fonts.mkdir(parents=True, exist_ok=True)
    for name, url in FONT_URLS.items():
        out = fonts / name
        print(f"Fetching {name}…")
        req = urllib.request.Request(url, headers={"User-Agent": "smp-sync-kometa-images"})
        out.write_bytes(urllib.request.urlopen(req, timeout=60).read())

    count = sum(1 for _ in DEST.rglob("*") if _.is_file())
    print(f"Done — {count} files in {DEST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
