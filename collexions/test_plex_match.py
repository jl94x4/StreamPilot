#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from plex_match import pick_match_reason, titles_match, years_close


def test_tmdb_guid_wins() -> None:
    reason = pick_match_reason(
        {"acceptable": True, "title": "Paris, Texas", "year": 1984, "tmdb_ids": {"134"}},
        {"title": "Star Trek", "tmdb_id": "134", "year": 2009},
    )
    assert reason == "tmdb"


def test_first_search_result_is_not_enough() -> None:
    reason = pick_match_reason(
        {"acceptable": True, "title": "Paris, Texas", "year": 1984, "tmdb_ids": {"10681"}},
        {"title": "Star Trek: Section 31", "tmdb_id": "1061610", "year": 2025},
    )
    assert reason is None


def test_normalized_title_and_year() -> None:
    reason = pick_match_reason(
        {"acceptable": True, "title": "The Star Trek", "year": 2009, "tmdb_ids": set()},
        {"title": "Star Trek", "tmdb_id": "134", "year": "2009"},
    )
    assert reason == "title"


def test_same_title_wrong_year_rejected() -> None:
    reason = pick_match_reason(
        {"acceptable": True, "title": "Star Trek", "year": 1979, "tmdb_ids": set()},
        {"title": "Star Trek", "tmdb_id": "134", "year": 2009},
    )
    assert reason is None


def test_colon_punctuation() -> None:
    assert titles_match(["Star Trek Generations"], "Star Trek: Generations")
    assert years_close(2013, "2012")
    assert not years_close(1979, 2009)


if __name__ == "__main__":
    test_tmdb_guid_wins()
    test_first_search_result_is_not_enough()
    test_normalized_title_and_year()
    test_same_title_wrong_year_rejected()
    test_colon_punctuation()
    print("ok")
