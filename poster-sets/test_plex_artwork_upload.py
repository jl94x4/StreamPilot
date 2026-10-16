#!/usr/bin/env python3
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image

from core import (
    PLEX_ARTWORK_MAX_BYTES,
    compress_artwork_for_plex,
    upload_artwork_to_plex,
)


PLEX_HARD_LIMIT = 10 * 1024 * 1024


class FakeItem:
    def __init__(self, title="Electric Bloom"):
        self.title = title
        self.ratingKey = "837480"
        self.uploads = []
        self.art_uploads = []
        self.edits = []

    def edit(self, **kwargs):
        self.edits.append(kwargs)

    def uploadPoster(self, filepath=None, url=None):
        path = Path(filepath)
        size = path.stat().st_size
        if size > PLEX_HARD_LIMIT:
            raise RuntimeError(
                "(500) internal_server_error: http://192.168.1.6:32400/library/metadata/837480/posters "
                "<html><head><title>Internal Server Error</title></head>"
                "<body><h1>500 Internal Server Error</h1></body></html>"
            )
        self.uploads.append({"path": str(path), "size": size, "suffix": path.suffix})

    def uploadArt(self, filepath=None, url=None):
        path = Path(filepath)
        size = path.stat().st_size
        if size > PLEX_HARD_LIMIT:
            raise RuntimeError(
                "(500) internal_server_error: http://192.168.1.6:32400/library/metadata/837480/arts "
                "<html><head><title>Internal Server Error</title></head>"
                "<body><h1>500 Internal Server Error</h1></body></html>"
            )
        self.art_uploads.append({"path": str(path), "size": size, "suffix": path.suffix})


def _oversized_png(path: Path) -> Path:
    img = Image.effect_noise((4000, 3000), 64).convert("RGB")
    img.save(path, format="PNG", compress_level=0)
    return path


class PlexArtworkUploadTests(unittest.TestCase):
    def test_compress_oversized_png_under_plex_cap(self):
        with tempfile.TemporaryDirectory() as td:
            src = _oversized_png(Path(td) / "cover.png")
            self.assertGreater(src.stat().st_size, PLEX_ARTWORK_MAX_BYTES)
            dest = Path(td) / "cover_plex.jpg"
            compress_artwork_for_plex(src, dest)
            self.assertLessEqual(dest.stat().st_size, PLEX_ARTWORK_MAX_BYTES)
            self.assertGreater(dest.stat().st_size, 0)

    def test_upload_compresses_before_plex_10mb_cap(self):
        with tempfile.TemporaryDirectory() as td:
            src = _oversized_png(Path(td) / "season.png")
            self.assertGreater(src.stat().st_size, PLEX_HARD_LIMIT)
            item = FakeItem()
            notes = []
            upload_artwork_to_plex(item, src, progress=notes.append, title="Electric Bloom")
            self.assertEqual(len(item.uploads), 1)
            self.assertLessEqual(item.uploads[0]["size"], PLEX_HARD_LIMIT)
            self.assertEqual(item.uploads[0]["suffix"], ".jpg")
            self.assertTrue(any("Plex 10MB upload limit" in line for line in notes))
            self.assertEqual(item.edits[0], {"thumb.locked": 0})
            self.assertTrue(src.exists())
            self.assertFalse((Path(td) / "season_plex.jpg").exists())

    def test_small_jpeg_is_uploaded_as_is(self):
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "small.jpg"
            Image.new("RGB", (200, 300), (12, 24, 36)).save(src, format="JPEG", quality=80)
            item = FakeItem()
            upload_artwork_to_plex(item, src, title="Small")
            self.assertEqual(item.uploads[0]["path"], str(src))
            self.assertEqual(item.uploads[0]["suffix"], ".jpg")

    def test_background_upload_unlocks_art_and_compresses(self):
        with tempfile.TemporaryDirectory() as td:
            src = _oversized_png(Path(td) / "backdrop.png")
            item = FakeItem()
            upload_artwork_to_plex(item, src, art=True, title="Electric Bloom")
            self.assertEqual(len(item.art_uploads), 1)
            self.assertLessEqual(item.art_uploads[0]["size"], PLEX_HARD_LIMIT)
            self.assertEqual(item.edits[0], {"art.locked": 0})


if __name__ == "__main__":
    unittest.main()
