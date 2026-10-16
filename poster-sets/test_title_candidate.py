#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from core import _pick_posterdb_title_candidate


def test_show_picks_unique_title_when_plex_year_is_latest_season() -> None:
    picked = _pick_posterdb_title_candidate(
        [{"title": "The Simpsons (1989)", "year": 1989, "url": "https://theposterdb.com/posters/simpsons"}],
        title_hint="The Simpsons",
        year_hint=2026,
        media_type="show",
    )
    assert picked is not None
    assert picked["url"].endswith("/simpsons")


def test_show_picks_closest_year_when_two_same_name_hits() -> None:
    picked = _pick_posterdb_title_candidate(
        [
            {"title": "Doctor Who (1963)", "year": 1963, "url": "https://theposterdb.com/posters/old"},
            {"title": "Doctor Who (2005)", "year": 2005, "url": "https://theposterdb.com/posters/new"},
        ],
        title_hint="Doctor Who",
        year_hint=2026,
        media_type="show",
    )
    assert picked is not None
    assert picked["url"].endswith("/new")


def test_movie_still_refuses_unrelated_year_miss() -> None:
    picked = _pick_posterdb_title_candidate(
        [{"title": "Dune (2021)", "year": 2021, "url": "https://theposterdb.com/posters/dune"}],
        title_hint="Dune",
        year_hint=1984,
        media_type="movie",
    )
    assert picked is None


if __name__ == "__main__":
    test_show_picks_unique_title_when_plex_year_is_latest_season()
    test_show_picks_closest_year_when_two_same_name_hits()
    test_movie_still_refuses_unrelated_year_miss()
    print("ok")
