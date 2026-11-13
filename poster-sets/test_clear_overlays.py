import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from clear_overlays import (
    clear_overlays_after_poster_apply,
    custom_collection_label_names,
    clear_overlay_labels,
    forget_overlay_tracking,
    known_overlay_stamp_label_names,
    labels_from_kometa_entry,
    tracking_keys_for_item,
)


class FakeLabel:
    def __init__(self, tag):
        self.tag = tag


class FakeItem:
    def __init__(self, rating_key, labels=None, item_type="movie", parent=None):
        self.ratingKey = rating_key
        self.type = item_type
        self.parentRatingKey = parent
        self.labels = [FakeLabel(name) for name in (labels or [])]
        self.removed = []

    def reload(self):
        return self

    def removeLabel(self, labels):
        names = []
        for lab in labels if isinstance(labels, list) else [labels]:
            names.append(getattr(lab, "tag", None) or lab)
        self.removed.extend(names)
        keep = {str(name).casefold() for name in names}
        self.labels = [lab for lab in self.labels if lab.tag.casefold() not in keep]


class ClearOverlaysTests(unittest.TestCase):
    def test_known_stamps_include_4k_and_atmos(self):
        names = {name.casefold() for name in known_overlay_stamp_label_names()}
        self.assertIn("4k-hdr", names)
        self.assertIn("4k", names)
        self.assertIn("overlay", names)
        self.assertIn("dolby-atmos", names)
        self.assertIn("extended-edition", names)

    def test_labels_from_kometa_entry(self):
        labels = labels_from_kometa_entry({
            "overlayLabels": ["4K-HDR", "TrueHD-Atmos"],
            "families": {"resolution": {"name": "4K-HDR"}},
        })
        folded = {name.casefold() for name in labels}
        self.assertIn("4k-hdr", folded)
        self.assertIn("truehd-atmos", folded)
        self.assertIn("overlay", folded)

    def test_forget_tracking_drops_logs_and_backups_without_restore(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            kometa = {"111": {"title": "Old", "overlayLabels": ["4K-HDR"]}, "222": {"title": "Keep"}}
            (root / "kometa_overlaid_log.json").write_text(json.dumps(kometa), encoding="utf-8")
            (root / "overlaid_log.json").write_text(json.dumps({"111": {"mode": "newseason"}}), encoding="utf-8")
            backup = root / "backups" / "kometa" / "111"
            backup.mkdir(parents=True)
            (backup / "poster.png").write_bytes(b"old-art")
            banner = root / "backups" / "base" / "111"
            banner.mkdir(parents=True)
            (banner / "show.png").write_bytes(b"old-banner")

            stats = forget_overlay_tracking(root, ["111"])
            remaining = json.loads((root / "kometa_overlaid_log.json").read_text(encoding="utf-8"))
            self.assertNotIn("111", remaining)
            self.assertIn("222", remaining)
            self.assertFalse(backup.exists())
            self.assertFalse(banner.exists())
            self.assertGreater(stats["logs"], 0)
            self.assertGreater(stats["backups"], 0)

    def test_clear_overlay_labels_drops_4k_and_overlay(self):
        item = FakeItem("111", labels=["4K-HDR", "Overlay", "Keep-Me"])
        removed = clear_overlay_labels(item, extra_labels=["TrueHD-Atmos"])
        remaining = {lab.tag for lab in item.labels}
        self.assertIn("4K-HDR", removed)
        self.assertIn("Overlay", removed)
        self.assertIn("Keep-Me", remaining)
        self.assertNotIn("4K-HDR", remaining)

    def test_custom_collection_labels_read_from_config(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            cfg = {"customCollectionOverlays": [{"id": "weekly-trending", "name": "Trending"}, {"id": "x"}, "bad"]}
            (root / "config.json").write_text(json.dumps(cfg), encoding="utf-8")
            self.assertEqual(custom_collection_label_names(root), ["weekly-trending", "Trending", "x"])
            self.assertEqual(custom_collection_label_names(root / "missing"), [])

    def test_clear_overlay_labels_drops_custom_collection_labels(self):
        item = FakeItem("111", labels=["Trending", "weekly-trending", "Keep-Me"])
        clear_overlay_labels(item, extra_labels=["Trending", "weekly-trending"])
        self.assertEqual([lab.tag for lab in item.labels], ["Keep-Me"])

    def test_season_tracking_keys_include_season_ne(self):
        item = FakeItem("55", item_type="season", parent="10")
        self.assertEqual(tracking_keys_for_item(item), ["55", "season:10"])

    def test_apply_removes_only_labels_recorded_for_the_title(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            kometa = {
                "111": {"overlayLabels": ["4K-HDR", "PG-13"]},
                # Other titles' rows must not leak into this title.
                "999": {"overlayLabels": ["HBO", "8.4"]},
            }
            (root / "kometa_overlaid_log.json").write_text(json.dumps(kometa), encoding="utf-8")
            (root / "overlaid_log.json").write_text(json.dumps({"111": {"labels": ["Banner-Label"]}}), encoding="utf-8")
            # "Trending" and "Netflix" stand in for collection / membership labels.
            item = FakeItem("111", labels=["Overlay", "4K-HDR", "PG-13", "Banner-Label", "HBO", "Trending", "Netflix", "Keep-Me"])
            messages = []
            clear_overlays_after_poster_apply(item, config={"overlays_data_dir": str(root)}, progress=messages.append)
            self.assertEqual({lab.tag for lab in item.labels}, {"HBO", "Trending", "Netflix", "Keep-Me"})
            self.assertFalse(any("still on the item" in message for message in messages))

    def test_apply_does_not_strip_collection_labels_from_untouched_titles(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            (root / "config.json").write_text(json.dumps({"customCollectionOverlays": [{"id": "trending", "name": "Trending"}]}), encoding="utf-8")
            (root / "kometa_overlaid_log.json").write_text(json.dumps({"999": {"overlayLabels": ["HBO"]}}), encoding="utf-8")
            item = FakeItem("111", labels=["Trending", "HBO", "Favourites"])
            clear_overlays_after_poster_apply(item, config={"overlays_data_dir": str(root)})
            self.assertEqual({lab.tag for lab in item.labels}, {"Trending", "HBO", "Favourites"})

    def test_apply_without_a_row_falls_back_to_built_in_stamps_only(self):
        with tempfile.TemporaryDirectory() as raw:
            item = FakeItem("111", labels=["Overlay", "4K-HDR", "Trending", "Keep-Me"])
            clear_overlays_after_poster_apply(item, config={"overlays_data_dir": raw})
            self.assertEqual({lab.tag for lab in item.labels}, {"Trending", "Keep-Me"})

    def test_apply_retries_a_label_plex_did_not_drop(self):
        class StubbornItem(FakeItem):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, **kwargs)
                self.calls = 0

            def removeLabel(self, labels):
                self.calls += 1
                if self.calls == 1:
                    return  # first attempt silently does nothing
                super().removeLabel(labels)

        with tempfile.TemporaryDirectory() as raw:
            item = StubbornItem("111", labels=["Overlay", "4K-HDR"])
            clear_overlays_after_poster_apply(item, config={"overlays_data_dir": raw})
            self.assertEqual(item.labels, [])


if __name__ == "__main__":
    unittest.main()
