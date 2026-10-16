"""Eligibility rules for New Season vs Recently Added (premiere)."""
from __future__ import annotations

import unittest
from datetime import datetime, timedelta


class FakeEpisode:
    def __init__(self, *, index=1, aired=None, added=None):
        self.index = index
        self.originallyAvailableAt = aired
        self.addedAt = added


class FakeSeason:
    def __init__(self, index, rating_key, episodes=None):
        self.index = index
        self.ratingKey = rating_key
        self._episodes = episodes or []

    def episodes(self):
        return self._episodes


class FakeShow:
    def __init__(self, seasons, *, added=None, title="Show"):
        self._seasons = seasons
        self.addedAt = added
        self.title = title
        self.ratingKey = "show1"

    def seasons(self):
        return self._seasons


class OverlayEligibilityTests(unittest.TestCase):
    def setUp(self):
        from core import premiere_show_eligible, should_have_overlay

        self.premiere_show_eligible = premiere_show_eligible
        self.should_have_overlay = should_have_overlay
        self.now = datetime.now()
        self.cutoff = self.now - timedelta(days=7)

    def test_new_season_ignores_recent_plex_added_when_air_date_old(self):
        old_air = self.now - timedelta(days=120)
        recent_add = self.now - timedelta(days=2)
        show = FakeShow(
            [
                FakeSeason(1, "s1", [FakeEpisode(aired=old_air, added=old_air)]),
                FakeSeason(
                    3,
                    "s3",
                    [FakeEpisode(aired=old_air, added=recent_add)],
                ),
            ],
        )
        ok, meta = self.should_have_overlay(show, self.cutoff, False)
        self.assertFalse(ok)
        self.assertEqual(meta.get("reason"), "aged_out")
        self.assertEqual(meta.get("seasonIndex"), 3)

    def test_new_season_via_recent_air_date(self):
        old_air = self.now - timedelta(days=400)
        recent_air = self.now - timedelta(days=2)
        show = FakeShow(
            [
                FakeSeason(1, "s1", [FakeEpisode(aired=old_air)]),
                FakeSeason(2, "s2", [FakeEpisode(aired=recent_air, added=old_air)]),
            ],
        )
        ok, meta = self.should_have_overlay(show, self.cutoff, False)
        self.assertTrue(ok, meta)
        self.assertEqual(meta.get("seasonIndex"), 2)

    def test_new_season_rejects_missing_air_date_even_if_just_added(self):
        recent_add = self.now - timedelta(days=1)
        show = FakeShow(
            [
                FakeSeason(1, "s1", [FakeEpisode(aired=self.now - timedelta(days=400))]),
                FakeSeason(2, "s2", [FakeEpisode(aired=None, added=recent_add)]),
            ],
        )
        ok, meta = self.should_have_overlay(show, self.cutoff, False)
        self.assertFalse(ok)
        self.assertEqual(meta.get("reason"), "no_date")

    def test_new_season_rejects_single_season_show(self):
        ep = FakeEpisode(aired=self.now - timedelta(days=1))
        show = FakeShow([FakeSeason(1, "s1", [ep])])
        ok, meta = self.should_have_overlay(show, self.cutoff, False)
        self.assertFalse(ok)
        self.assertEqual(meta.get("reason"), "first_season")

    def test_premiere_recently_added_s1_only(self):
        recent = self.now - timedelta(days=1)
        show = FakeShow(
            [FakeSeason(1, "s1", [FakeEpisode(aired=recent, added=recent)])],
            added=recent,
        )
        ok, meta = self.premiere_show_eligible(show, self.cutoff)
        self.assertTrue(ok, meta)

    def test_premiere_rejects_multi_season_show(self):
        recent = self.now - timedelta(days=1)
        show = FakeShow(
            [
                FakeSeason(1, "s1", [FakeEpisode(aired=recent)]),
                FakeSeason(2, "s2", [FakeEpisode(aired=recent)]),
            ],
        )
        ok, meta = self.premiere_show_eligible(show, self.cutoff)
        self.assertFalse(ok)
        self.assertEqual(meta.get("reason"), "not_premiere")

    def test_premiere_aged_out(self):
        old = self.now - timedelta(days=30)
        show = FakeShow(
            [FakeSeason(1, "s1", [FakeEpisode(aired=old, added=old)])],
            added=old,
        )
        ok, meta = self.premiere_show_eligible(show, self.cutoff)
        self.assertFalse(ok)
        self.assertEqual(meta.get("reason"), "aged_out")

    def test_new_season_stamps_season_poster_by_default(self):
        from core import _new_season_stamp_season_poster, _season_stamp_kept_for_new_season

        self.assertTrue(_new_season_stamp_season_poster({}))
        self.assertTrue(_new_season_stamp_season_poster({"newSeasonStampSeasonPoster": True}))
        self.assertFalse(_new_season_stamp_season_poster({"newSeasonStampSeasonPoster": False}))
        self.assertTrue(
            _season_stamp_kept_for_new_season(show_key="10", keep_show_keys={"10"}),
        )
        self.assertTrue(
            _season_stamp_kept_for_new_season(
                show_key="11",
                entry={"source": "new-season"},
                keep_show_keys=set(),
            ),
        )
        self.assertFalse(
            _season_stamp_kept_for_new_season(
                show_key="12",
                entry={"source": "new-episode"},
                keep_show_keys=set(),
            ),
        )


if __name__ == "__main__":
    unittest.main()
