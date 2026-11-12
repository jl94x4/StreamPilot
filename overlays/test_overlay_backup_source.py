"""Overlay tags decide whether a run trusts backups or current Plex art."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

_APP = Path(__file__).resolve().parent
if str(_APP) not in sys.path:
    sys.path.insert(0, str(_APP))

from core import _item_has_overlay_tracking_labels
from kometa_engine import _load_stamp_original, _should_ignore_overlay_backup


class _FakeLabel:
    def __init__(self, tag):
        self.tag = tag


class _FakeItem:
    def __init__(self, labels=(), title="Show"):
        self.labels = [_FakeLabel(tag) for tag in labels]
        self.title = title
        self.thumb = "/library/metadata/99/thumb/1"
        self.ratingKey = "99"


def _solid(color, size=(40, 60)) -> Image.Image:
    return Image.new("RGBA", size, color)


class OverlayBackupSourceTests(unittest.TestCase):
    def test_tracking_labels_include_overlay_and_stamp_tags(self):
        self.assertFalse(_item_has_overlay_tracking_labels(_FakeItem(labels=())))
        self.assertTrue(_item_has_overlay_tracking_labels(_FakeItem(labels=["Overlay"])))
        self.assertTrue(_item_has_overlay_tracking_labels(_FakeItem(labels=["4K-HDR"])))
        self.assertTrue(
            _item_has_overlay_tracking_labels(
                _FakeItem(labels=["Trending"]),
                extra_names=["Trending"],
            )
        )
        self.assertFalse(
            _item_has_overlay_tracking_labels(
                _FakeItem(labels=()),
                extra_names=["4K-HDR"],
            )
        )

    def test_ignore_backup_when_labels_removed(self):
        self.assertTrue(_should_ignore_overlay_backup(_FakeItem(labels=()), ["4K-HDR"]))
        self.assertFalse(_should_ignore_overlay_backup(_FakeItem(labels=["4K-HDR"]), ["4K-HDR"]))
        self.assertFalse(_should_ignore_overlay_backup(_FakeItem(labels=["Overlay"])))

    def test_load_stamp_original_uses_backup_while_labeled(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            paths = {
                "root": root,
                "preview": root / "preview",
                "backups": root / "backups",
            }
            paths["preview"].mkdir()
            backup = paths["backups"] / "kometa" / "99" / "poster.png"
            backup.parent.mkdir(parents=True)
            _solid((1, 2, 3, 255)).save(backup)
            item = _FakeItem(labels=["4K-HDR"])
            with patch("kometa_engine._download_original", return_value=_solid((9, 9, 9, 255))):
                original, path = _load_stamp_original(
                    None, item, paths, "99", existing={"overlayLabels": ["4K-HDR"]},
                )
            self.assertEqual(original.getpixel((0, 0))[:3], (1, 2, 3))
            self.assertEqual(Image.open(path).getpixel((0, 0))[:3], (1, 2, 3))

    def test_load_stamp_original_adopts_current_when_unlabeled(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            paths = {
                "root": root,
                "preview": root / "preview",
                "backups": root / "backups",
            }
            paths["preview"].mkdir()
            backup = paths["backups"] / "kometa" / "99" / "poster.png"
            backup.parent.mkdir(parents=True)
            _solid((1, 2, 3, 255)).save(backup)
            item = _FakeItem(labels=())
            with patch("kometa_engine._download_original", return_value=_solid((9, 9, 9, 255))):
                original, path = _load_stamp_original(
                    None, item, paths, "99", existing={"overlayLabels": ["4K-HDR"]},
                )
            self.assertEqual(original.getpixel((0, 0))[:3], (9, 9, 9))
            self.assertEqual(Image.open(path).getpixel((0, 0))[:3], (9, 9, 9))


if __name__ == "__main__":
    unittest.main()
