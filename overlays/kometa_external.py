"""External data for Kometa-parity overlays: TMDB status + watch providers.

Cached under config/overlays/cache/kometa_tmdb_cache.json so repeat runs are
cheap. Uses the same TMDB API key already configured for air-date fallback.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable

import requests

ProgressFn = Callable[[str], None]

TMDB_API_BASE = "https://api.themoviedb.org/3"
STATUS_TTL_DAYS = 3
PROVIDERS_TTL_DAYS = 7

_IMDB_ID_RE = re.compile(r"imdb(?:://)?(tt\d+)", re.I)

# TMDB status string → Kometa tmdb_status filter key
TMDB_STATUS_MAP = {
    "returning series": "returning",
    "ended": "ended",
    "canceled": "canceled",
    "cancelled": "canceled",
    "in production": "production",
    "planned": "planned",
    "pilot": "pilot",
}


def _progress(progress: ProgressFn | None, message: str) -> None:
    if progress:
        progress(message)


class KometaTmdb:
    """Small cached TMDB client for show status + watch providers."""

    def __init__(
        self,
        *,
        api_key: str = "",
        cache_path: Path | None = None,
        progress: ProgressFn | None = None,
        max_calls: int = 2000,
    ):
        self.api_key = str(api_key or "").strip()
        self.enabled = bool(self.api_key)
        self.cache_path = Path(cache_path) if cache_path else None
        self.progress = progress
        self.max_calls = max(0, int(max_calls))
        self.calls = 0
        self._cache: dict[str, Any] = {}
        self._dirty = False
        if self.cache_path and self.cache_path.exists():
            try:
                raw = json.loads(self.cache_path.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    self._cache = raw
            except Exception:
                self._cache = {}

    def save(self) -> None:
        if not self.cache_path or not self._dirty:
            return
        try:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            self.cache_path.write_text(
                json.dumps(self._cache, ensure_ascii=False) + "\n", encoding="utf-8"
            )
            self._dirty = False
        except Exception as exc:
            _progress(self.progress, f"Layer TMDB cache save failed: {exc}")

    # -- cache helpers ------------------------------------------------------

    def _cache_get(self, key: str, ttl_days: int):
        entry = self._cache.get(key)
        if not isinstance(entry, dict):
            return Ellipsis
        try:
            fetched = datetime.fromisoformat(str(entry.get("at") or ""))
        except Exception:
            return Ellipsis
        if datetime.now() - fetched > timedelta(days=ttl_days):
            return Ellipsis
        return entry.get("v")

    def _cache_set(self, key: str, value) -> None:
        self._cache[key] = {"v": value, "at": datetime.now().isoformat(timespec="seconds")}
        self._dirty = True

    def _get(self, path: str, params: dict | None = None) -> dict | None:
        if not self.enabled or self.calls >= self.max_calls:
            return None
        self.calls += 1
        try:
            resp = requests.get(
                f"{TMDB_API_BASE}{path}",
                params={"api_key": self.api_key, **(params or {})},
                timeout=12,
            )
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            data = resp.json()
            return data if isinstance(data, dict) else None
        except Exception as exc:
            _progress(self.progress, f"TMDB request failed ({path}): {exc}")
            return None

    # -- id resolution ------------------------------------------------------

    def tmdb_id_for(self, item, *, is_movie: bool) -> int | None:
        from tmdb_dates import extract_tmdb_show_id, _iter_guid_strings

        tmdb_id = extract_tmdb_show_id(item)
        if tmdb_id:
            return tmdb_id
        # IMDb / TVDB find fallback
        imdb_id = None
        for raw in _iter_guid_strings(item):
            match = _IMDB_ID_RE.search(raw)
            if match:
                imdb_id = match.group(1)
                break
        if imdb_id:
            key = f"find:imdb:{imdb_id}"
            cached = self._cache_get(key, 45)
            if cached is not Ellipsis:
                return int(cached) if cached else None
            data = self._get(f"/find/{imdb_id}", {"external_source": "imdb_id"})
            value = None
            if data:
                results = data.get("movie_results" if is_movie else "tv_results") or []
                if results:
                    try:
                        value = int(results[0].get("id"))
                    except (TypeError, ValueError):
                        value = None
            self._cache_set(key, value)
            return value
        if not is_movie:
            from tmdb_dates import extract_tvdb_show_id

            tvdb_id = extract_tvdb_show_id(item)
            if tvdb_id:
                key = f"find:tvdb:{tvdb_id}"
                cached = self._cache_get(key, 45)
                if cached is not Ellipsis:
                    return int(cached) if cached else None
                data = self._get(f"/find/{tvdb_id}", {"external_source": "tvdb_id"})
                value = None
                if data:
                    results = data.get("tv_results") or []
                    if results:
                        try:
                            value = int(results[0].get("id"))
                        except (TypeError, ValueError):
                            value = None
                self._cache_set(key, value)
                return value
        return None

    # -- data ---------------------------------------------------------------

    def show_status(self, show) -> str | None:
        """Kometa tmdb_status key: returning/ended/canceled/production/planned/pilot."""
        if not self.enabled:
            return None
        tmdb_id = self.tmdb_id_for(show, is_movie=False)
        if not tmdb_id:
            return None
        key = f"status:{tmdb_id}"
        cached = self._cache_get(key, STATUS_TTL_DAYS)
        if cached is not Ellipsis:
            return cached or None
        data = self._get(f"/tv/{tmdb_id}")
        status = None
        if data:
            status = TMDB_STATUS_MAP.get(str(data.get("status") or "").strip().lower())
        self._cache_set(key, status)
        return status

    def watch_provider_ids(self, item, *, is_movie: bool, region: str = "US") -> set[int]:
        """Provider ids streaming the item in the region (flatrate/free/ads)."""
        if not self.enabled:
            return set()
        tmdb_id = self.tmdb_id_for(item, is_movie=is_movie)
        if not tmdb_id:
            return set()
        region = str(region or "US").strip().upper() or "US"
        kind = "movie" if is_movie else "tv"
        key = f"providers:{kind}:{tmdb_id}:{region}"
        cached = self._cache_get(key, PROVIDERS_TTL_DAYS)
        if cached is not Ellipsis:
            return {int(x) for x in (cached or [])}
        data = self._get(f"/{kind}/{tmdb_id}/watch/providers")
        ids: set[int] = set()
        if data:
            results = data.get("results") or {}
            entry = results.get(region) or {}
            for bucket in ("flatrate", "free", "ads"):
                for provider in entry.get(bucket) or []:
                    pid = provider.get("provider_id")
                    if pid is not None:
                        try:
                            ids.add(int(pid))
                        except (TypeError, ValueError):
                            pass
        self._cache_set(key, sorted(ids))
        return ids

    def vote_average(self, item, *, is_movie: bool) -> float | None:
        """TMDB vote average (0-10) for the ratings overlay tmdb source."""
        if not self.enabled:
            return None
        tmdb_id = self.tmdb_id_for(item, is_movie=is_movie)
        if not tmdb_id:
            return None
        kind = "movie" if is_movie else "tv"
        key = f"vote:{kind}:{tmdb_id}"
        cached = self._cache_get(key, PROVIDERS_TTL_DAYS)
        if cached is not Ellipsis:
            return float(cached) if cached is not None else None
        data = self._get(f"/{kind}/{tmdb_id}")
        value = None
        if data:
            try:
                raw = data.get("vote_average")
                value = round(float(raw), 1) if raw is not None else None
            except (TypeError, ValueError):
                value = None
        self._cache_set(key, value)
        return value

    def has_stinger(self, movie) -> bool:
        """MediaStinger parity: TMDB keywords contain during/after-credits stinger."""
        if not self.enabled:
            return False
        tmdb_id = self.tmdb_id_for(movie, is_movie=True)
        if not tmdb_id:
            return False
        key = f"stinger:{tmdb_id}"
        cached = self._cache_get(key, 30)
        if cached is not Ellipsis:
            return bool(cached)
        data = self._get(f"/movie/{tmdb_id}/keywords")
        value = False
        if data:
            for kw in data.get("keywords") or []:
                name = str(kw.get("name") or "").strip().lower()
                if name in {"duringcreditsstinger", "aftercreditsstinger"}:
                    value = True
                    break
        self._cache_set(key, value)
        return value


def create_kometa_tmdb(config: dict, paths: dict, progress: ProgressFn | None = None) -> KometaTmdb:
    api_key = str(config.get("tmdbApiKey") or config.get("tmdb_api_key") or "").strip()
    cache_dir = Path(paths["root"]) / "cache"
    return KometaTmdb(
        api_key=api_key,
        cache_path=cache_dir / "kometa_tmdb_cache.json",
        progress=progress,
    )
