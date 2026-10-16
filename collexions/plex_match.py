"""Strict Plex ↔ source matching for Collexions collections.

Never accept “first search result”. Require a TMDB guid or a normalized
title match (with year when both sides have one).
"""

from __future__ import annotations

import re

_ARTICLE_RE = re.compile(r"^(the|a|an)\s+", re.I)
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


def normalize_match_title(title: str) -> str:
    text = str(title or "").casefold().replace("&", " and ")
    text = _ARTICLE_RE.sub("", text.strip())
    return _NON_ALNUM_RE.sub("", text)


def parse_match_year(value) -> int | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    match = re.search(r"(?:^|\D)(\d{4})(?:\D|$)", raw)
    if not match:
        try:
            year = int(float(raw))
        except Exception:
            return None
        return year if 1870 <= year <= 2100 else None
    year = int(match.group(1))
    return year if 1870 <= year <= 2100 else None


def years_close(item_year, want_year, slack: int = 1) -> bool:
    got = parse_match_year(item_year)
    want = parse_match_year(want_year)
    if not got or not want:
        return True
    return abs(got - want) <= max(0, int(slack))


def titles_match(plex_titles, source_title: str, original_title: str = "") -> bool:
    want = {normalize_match_title(source_title), normalize_match_title(original_title)}
    want.discard("")
    if not want:
        return False
    for title in plex_titles or []:
        if normalize_match_title(title) in want:
            return True
    return False


def pick_match_reason(candidate: dict, source: dict) -> str | None:
    """Return 'tmdb', 'title', or None.

    candidate keys: acceptable, title, originalTitle, year, tmdb_ids
    source keys: title, original_title, year, tmdb_id / id
    """
    if not candidate or not candidate.get("acceptable"):
        return None
    src_id = str(source.get("tmdb_id") or source.get("id") or "").strip()
    ids = {str(x).strip() for x in (candidate.get("tmdb_ids") or []) if str(x).strip()}
    if src_id and src_id in ids:
        return "tmdb"
    plex_titles = [candidate.get("title"), candidate.get("originalTitle"), candidate.get("titleSort")]
    if titles_match(plex_titles, str(source.get("title") or ""), str(source.get("original_title") or "")):
        if years_close(candidate.get("year"), source.get("year")):
            return "title"
    return None
