"""List-backed data for Kometa ribbon overlays.

Sources (all cached under config/overlays/cache/):
- IMDb award winners from Kometa-Team/IMDb-Awards (the same data Kometa uses)
- IMDb Top 250 charts (movies + shows)
- MDBList k0meta public lists (RT Certified Fresh / Verified Hot, Metacritic
  Must See, Common Sense Selections)
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable

import requests

ProgressFn = Callable[[str], None]

AWARDS_BASE = "https://raw.githubusercontent.com/Kometa-Team/IMDb-Awards/master/events"
MDBLIST_BASE = "https://mdblist.com/lists/k0meta"
IMDB_CHART_URLS = {
    "top_movies": "https://www.imdb.com/chart/top/",
    "top_shows": "https://www.imdb.com/chart/toptv/",
}

AWARDS_TTL_DAYS = 30
CHART_TTL_DAYS = 7
MDBLIST_TTL_DAYS = 7

_TT_RE = re.compile(r"/title/(tt\d+)")
_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ServerManagerPortal-Overlays/1.0"


def _progress(progress: ProgressFn | None, message: str) -> None:
    if progress:
        progress(message)


class KometaLists:
    def __init__(self, cache_dir: Path, progress: ProgressFn | None = None):
        self.cache_dir = Path(cache_dir)
        self.progress = progress
        self._mem: dict[str, object] = {}

    # -- cache --------------------------------------------------------------

    def _cache_file(self, name: str) -> Path:
        return self.cache_dir / f"{name}.json"

    def _cache_load(self, name: str, ttl_days: int):
        path = self._cache_file(name)
        if not path.exists():
            return None
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            fetched = datetime.fromisoformat(str(raw.get("at") or ""))
            if datetime.now() - fetched > timedelta(days=ttl_days):
                return None
            return raw.get("v")
        except Exception:
            return None

    def _cache_store(self, name: str, value) -> None:
        try:
            path = self._cache_file(name)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(
                json.dumps({"v": value, "at": datetime.now().isoformat(timespec="seconds")}) + "\n",
                encoding="utf-8",
            )
        except Exception:
            pass

    # -- IMDb awards (Kometa-Team/IMDb-Awards event YAMLs) -------------------

    def _event_data(self, event_id: str) -> dict:
        mem_key = f"event:{event_id}"
        if mem_key in self._mem:
            return self._mem[mem_key]  # type: ignore[return-value]
        cached = self._cache_load(f"imdb_award_{event_id}", AWARDS_TTL_DAYS)
        if isinstance(cached, dict):
            self._mem[mem_key] = cached
            return cached
        data: dict = {}
        try:
            resp = requests.get(f"{AWARDS_BASE}/{event_id}.yml", timeout=30, headers={"User-Agent": _USER_AGENT})
            resp.raise_for_status()
            import yaml

            parsed = yaml.safe_load(resp.text)
            if isinstance(parsed, dict):
                data = parsed
        except Exception as exc:
            _progress(self.progress, f"IMDb awards fetch failed ({event_id}): {exc}")
        if data:
            self._cache_store(f"imdb_award_{event_id}", data)
        self._mem[mem_key] = data
        return data

    def imdb_award_winners(
        self,
        event_id: str,
        *,
        award_filter: list[str] | None = None,
        category_filter: list[str] | None = None,
    ) -> set[str]:
        """IMDb ids that WON matching award/category across all years (Kometa event_year: all)."""
        data = self._event_data(event_id)
        awards_wanted = {a.strip().lower() for a in (award_filter or [])}
        categories_wanted = {c.strip().lower() for c in (category_filter or [])}
        winners: set[str] = set()
        for _year, awards in (data or {}).items():
            if not isinstance(awards, dict):
                continue
            for award_name, categories in awards.items():
                if awards_wanted and str(award_name).strip().lower() not in awards_wanted:
                    continue
                if not isinstance(categories, dict):
                    continue
                for category_name, results in categories.items():
                    if categories_wanted and str(category_name).strip().lower() not in categories_wanted:
                        continue
                    if not isinstance(results, dict):
                        continue
                    for tt in results.get("winner") or []:
                        if str(tt).startswith("tt"):
                            winners.add(str(tt))
        return winners

    # -- IMDb charts ---------------------------------------------------------

    def imdb_chart(self, chart: str) -> set[str]:
        cached = self._cache_load(f"imdb_chart_{chart}", CHART_TTL_DAYS)
        if isinstance(cached, list):
            return set(cached)
        url = IMDB_CHART_URLS.get(chart)
        if not url:
            return set()
        ids: set[str] = set()
        try:
            resp = requests.get(url, timeout=30, headers={"User-Agent": _USER_AGENT, "Accept-Language": "en-US,en"})
            resp.raise_for_status()
            ids = set(_TT_RE.findall(resp.text))
        except Exception as exc:
            _progress(self.progress, f"IMDb chart fetch failed ({chart}): {exc}")
        if ids:
            self._cache_store(f"imdb_chart_{chart}", sorted(ids))
        return ids

    # -- MDBList k0meta lists --------------------------------------------------

    def mdblist_ids(self, list_key: str) -> tuple[set[str], set[int]]:
        """(imdb ids, tmdb ids) from a public k0meta MDBList list JSON export."""
        cached = self._cache_load(f"mdblist_{list_key}", MDBLIST_TTL_DAYS)
        if isinstance(cached, dict):
            return set(cached.get("imdb") or []), {int(x) for x in (cached.get("tmdb") or [])}
        imdb_ids: set[str] = set()
        tmdb_ids: set[int] = set()
        try:
            resp = requests.get(f"{MDBLIST_BASE}/{list_key}/json", timeout=30, headers={"User-Agent": _USER_AGENT})
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, list):
                for row in data:
                    if not isinstance(row, dict):
                        continue
                    imdb = str(row.get("imdb_id") or "").strip()
                    if imdb.startswith("tt"):
                        imdb_ids.add(imdb)
                    tmdb = row.get("id") or row.get("tmdb_id") or row.get("tvdb_id" if False else "id")
                    try:
                        if row.get("mediatype") in {"movie", "show"} and row.get("id"):
                            tmdb_ids.add(int(row["id"]))
                    except (TypeError, ValueError):
                        pass
                    _ = tmdb
        except Exception as exc:
            _progress(self.progress, f"MDBList fetch failed ({list_key}): {exc}")
        if imdb_ids or tmdb_ids:
            self._cache_store(f"mdblist_{list_key}", {"imdb": sorted(imdb_ids), "tmdb": sorted(tmdb_ids)})
        return imdb_ids, tmdb_ids


def extract_imdb_id(item) -> str | None:
    from kometa_external import _IMDB_ID_RE
    from tmdb_dates import _iter_guid_strings

    for raw in _iter_guid_strings(item):
        match = _IMDB_ID_RE.search(raw)
        if match:
            return match.group(1)
    return None
