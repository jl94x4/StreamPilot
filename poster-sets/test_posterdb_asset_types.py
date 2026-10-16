#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from core import asset_file_type, parse_posterdb_caption


def test_show_poster_and_season() -> None:
    cover = parse_posterdb_caption("Severance (2022)")
    assert cover["title"] == "Severance"
    assert cover["year"] == 2022
    assert cover["file_type"] is None
    assert cover["season"] is None

    season = parse_posterdb_caption("Severance (2022) - Season 2")
    assert season["title"] == "Severance"
    assert season["season"] == 2
    assert season["file_type"] == "season_cover"
    assert season["episode"] is None

    specials = parse_posterdb_caption("Severance (2022) - Specials")
    assert specials["season"] == 0
    assert specials["file_type"] == "season_cover"


def test_tpdb_has_no_backdrops_or_title_cards() -> None:
    backdrop = parse_posterdb_caption("Severance (2022) - Backdrop")
    assert backdrop["title"] == "Severance"
    assert backdrop["file_type"] is None
    assert backdrop["season"] is None
    assert backdrop["episode"] is None

    card = parse_posterdb_caption("Severance (2022) - S02E04")
    assert card["file_type"] is None
    assert card["episode"] is None


def test_movie_poster_strips_suffix_but_stays_a_poster() -> None:
    poster = parse_posterdb_caption("One Night Only (2026)")
    assert poster["title"] == "One Night Only"
    assert poster["year"] == 2026
    assert poster["file_type"] is None

    suffix = parse_posterdb_caption("One Night Only (2026) - Backdrop")
    assert suffix["title"] == "One Night Only"
    assert suffix["year"] == 2026
    assert suffix["file_type"] is None
    assert suffix["season"] is None


def test_asset_file_type_mediux_movie_backdrop_still_works() -> None:
    assert asset_file_type("movie", {"season": "Backdrop", "source": "mediux"}) == "background"
    assert asset_file_type("movie", {"title": "One Night Only"}) is None
    assert asset_file_type("show", {"season": "Cover"}) == "show_cover"
    assert asset_file_type("show", {"season": 1, "episode": 4}) == "title_card"


if __name__ == "__main__":
    test_show_poster_and_season()
    test_tpdb_has_no_backdrops_or_title_cards()
    test_movie_poster_strips_suffix_but_stays_a_poster()
    test_asset_file_type_mediux_movie_backdrop_still_works()
    print("ok")
