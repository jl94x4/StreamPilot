"""Unit tests for banner overlay layer stack (no Plex)."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

_APP = Path(__file__).resolve().parent
if str(_APP) not in sys.path:
    sys.path.insert(0, str(_APP))

import layer_stack as ls


def _solid(color, size=(100, 150)) -> Image.Image:
    return Image.new("RGBA", size, color)


class _FakeLabel:
    def __init__(self, tag):
        self.tag = tag


class _FakeShow:
    def __init__(self, labels=None, title="Show"):
        self.labels = [_FakeLabel(tag) for tag in (labels or [])]
        self.title = title
        self.ratingKey = "42"
        self.thumb = "/library/metadata/42/thumb/1"


class LayerStackTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        (root / "preview").mkdir()
        (root / "backups").mkdir()
        self.paths = {
            "root": root,
            "preview": root / "preview",
            "backups": root / "backups",
            "log": root / "overlaid_log.json",
            "liveLog": root / "live_log.json",
            "recentlyAddedLog": root / "recently_added_log.json",
            "top10Log": root / "top10_log.json",
            "assets": root / "assets",
        }
        self.key = "42"

    def tearDown(self):
        self.tmp.cleanup()

    def test_bottom_exclusivity_keeps_highest(self):
        ls.ensure_base_poster(self.paths, self.key, current_poster=_solid((10, 10, 10, 255)))
        ls.set_layer(
            self.paths, self.key, "recently",
            badge=_solid((0, 255, 0, 255), (40, 20)),
            placement={"x": 0.5, "y": 1.0, "width": 0.5, "anchorX": "center", "anchorY": "bottom"},
        )
        dropped = ls.set_layer(
            self.paths, self.key, "newseason",
            badge=_solid((255, 0, 0, 255), (40, 20)),
            placement={"x": 0.5, "y": 1.0, "width": 0.5, "anchorX": "center", "anchorY": "bottom"},
        )
        self.assertIn("recently", dropped)
        layers = ls.active_layers(ls.load_registry(self.paths, self.key))
        self.assertIn("newseason", layers)
        self.assertNotIn("recently", layers)

    def test_top10_stacks_with_newseason(self):
        ls.ensure_base_poster(self.paths, self.key, current_poster=_solid((10, 10, 10, 255)))
        ls.set_layer(
            self.paths, self.key, "newseason",
            badge=_solid((255, 0, 0, 200), (50, 20)),
            placement={"x": 0.5, "y": 1.0, "width": 0.5, "anchorX": "center", "anchorY": "bottom", "bottomClip": 0},
        )
        ls.set_layer(
            self.paths, self.key, "top10",
            badge=_solid((0, 0, 255, 200), (20, 20)),
            placement={"x": 0.0, "y": 0.0, "width": 0.2, "anchorX": "left", "anchorY": "top"},
        )
        layers = ls.active_layers(ls.load_registry(self.paths, self.key))
        self.assertEqual(set(layers), {"newseason", "top10"})
        composed = ls.compose_from_registry(self.paths, self.key)
        self.assertEqual(composed.size, (100, 150))

    def test_remove_newseason_keeps_top10(self):
        ls.ensure_base_poster(self.paths, self.key, current_poster=_solid((10, 10, 10, 255)))
        ls.set_layer(
            self.paths, self.key, "newseason",
            badge=_solid((255, 0, 0, 255), (50, 20)),
            placement={"x": 0.5, "y": 1.0, "width": 0.5, "anchorX": "center", "anchorY": "bottom"},
        )
        ls.set_layer(
            self.paths, self.key, "top10",
            badge=_solid((0, 0, 255, 255), (20, 20)),
            placement={"x": 0.0, "y": 0.0, "width": 0.2, "anchorX": "left", "anchorY": "top"},
        )
        ls.clear_layer(self.paths, self.key, "newseason")
        layers = ls.active_layers(ls.load_registry(self.paths, self.key))
        self.assertEqual(set(layers), {"top10"})
        composed = ls.compose_from_registry(self.paths, self.key)
        # Corner pixel should still show top10 blue influence (not pure base gray)
        px = composed.getpixel((5, 5))
        self.assertNotEqual(px[:3], (10, 10, 10))

    def test_promote_legacy_newseason_backup(self):
        legacy = self.paths["backups"] / self.key
        legacy.mkdir(parents=True)
        _solid((1, 2, 3, 255)).save(legacy / "show.png")
        path = ls.ensure_base_poster(self.paths, self.key)
        self.assertTrue(path.exists())
        img = Image.open(path)
        self.assertEqual(img.getpixel((0, 0))[:3], (1, 2, 3))

    def test_unlabeled_show_replaces_base_with_current_poster(self):
        ls.ensure_base_poster(self.paths, self.key, current_poster=_solid((1, 2, 3, 255)))
        show = _FakeShow(labels=[])
        path = ls.ensure_base_poster(
            self.paths,
            self.key,
            show=show,
            current_poster=_solid((9, 9, 9, 255)),
        )
        img = Image.open(path)
        self.assertEqual(img.getpixel((0, 0))[:3], (9, 9, 9))

    def test_overlay_label_keeps_existing_base(self):
        ls.ensure_base_poster(self.paths, self.key, current_poster=_solid((1, 2, 3, 255)))
        show = _FakeShow(labels=["Overlay"])
        path = ls.ensure_base_poster(
            self.paths,
            self.key,
            show=show,
            current_poster=_solid((9, 9, 9, 255)),
        )
        img = Image.open(path)
        self.assertEqual(img.getpixel((0, 0))[:3], (1, 2, 3))

    def test_unlabeled_show_ignores_legacy_backup(self):
        legacy = self.paths["backups"] / self.key
        legacy.mkdir(parents=True)
        _solid((1, 2, 3, 255)).save(legacy / "show.png")
        show = _FakeShow(labels=[])
        path = ls.ensure_base_poster(
            self.paths,
            self.key,
            show=show,
            current_poster=_solid((9, 9, 9, 255)),
        )
        img = Image.open(path)
        self.assertEqual(img.getpixel((0, 0))[:3], (9, 9, 9))

    def test_drop_conflicting_logs(self):
        log_path = self.paths["recentlyAddedLog"]
        log_path.write_text(json.dumps({self.key: {"title": "X"}}), encoding="utf-8")
        ls.drop_conflicting_mode_logs(self.paths, self.key, ["recently"])
        data = json.loads(log_path.read_text(encoding="utf-8"))
        self.assertNotIn(self.key, data)

    def test_compress_oversized_poster_for_plex(self):
        from core import PLEX_POSTER_MAX_BYTES, _compress_poster_for_plex

        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "large.png"
            img = Image.effect_noise((4000, 3000), 64).convert("RGB")
            img.save(src, format="PNG", compress_level=0)
            self.assertGreater(src.stat().st_size, PLEX_POSTER_MAX_BYTES)
            dest = Path(td) / "large_plex.jpg"
            _compress_poster_for_plex(src, dest)
            self.assertLessEqual(dest.stat().st_size, PLEX_POSTER_MAX_BYTES)

    def test_new_season_requires_two_regular_seasons(self):
        from core import _is_returning_season, _latest_season

        class FakeSeason:
            def __init__(self, index, rating_key):
                self.index = index
                self.ratingKey = rating_key

        class FakeShow:
            def __init__(self, seasons):
                self._seasons = seasons

            def seasons(self):
                return self._seasons

        only_s1 = FakeShow([FakeSeason(0, "sp"), FakeSeason(1, "s1")])
        latest = _latest_season(only_s1)
        self.assertEqual(latest.index, 1)
        self.assertFalse(_is_returning_season(latest, only_s1))

        mislabeled = FakeShow([FakeSeason(2, "s2")])
        latest_bad = _latest_season(mislabeled)
        self.assertFalse(_is_returning_season(latest_bad, mislabeled))

        returning = FakeShow([FakeSeason(1, "s1"), FakeSeason(2, "s2")])
        latest_ok = _latest_season(returning)
        self.assertTrue(_is_returning_season(latest_ok, returning))


if __name__ == "__main__":
    unittest.main()
