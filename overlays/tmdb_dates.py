"""TMDB air-date fallback for overlays when Plex originallyAvailableAt is missing."""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable

import requests

ProgressFn = Callable[[str], None]

TMDB_API_BASE = "https://api.themoviedb.org/3"
HIT_TTL_DAYS = 45
MISS_TTL_DAYS = 2
DEFAULT_MAX_CALLS = 150

_TMDB_ID_RE = re.compile(r"(?:tmdb|themoviedb)(?:://|/)?(\d+)|agents\.themoviedb://(\d+)|tmdb[-_](\d+)", re.I)
_TVDB_ID_RE = re.compile(r"(?:tvdb|thetvdb)(?:://|/)?(\d+)|agents\.thetvdb://(\d+)|tvdb[-_](\d+)", re.I)


def _as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _progress(progress: ProgressFn | None, message: str) -> None:
    if progress:
        progress(message)


def _as_datetime(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.combine(value, datetime.min.time())
    except Exception:
        pass
    text = str(value).strip()
    if not text:
        return None
    try:
        if "T" in text:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).replace(tzinfo=None)
        return datetime.strptime(text[:10], "%Y-%m-%d")
    except Exception:
        return None


def _iter_guid_strings(item) -> list[str]:
    out: list[str] = []
    guids = getattr(item, "guids", None) or []
    for guid in guids:
        value = getattr(guid, "id", None) or str(guid or "")
        if value:
            out.append(str(value))
    single = getattr(item, "guid", None)
    if single:
        out.append(str(single))
    return out


def extract_tmdb_show_id(item) -> int | None:
    for raw in _iter_guid_strings(item):
        match = _TMDB_ID_RE.search(raw)
        if not match:
            continue
        for group in match.groups():
            if group:
                try:
                    return int(group)
                except ValueError:
                    continue
    return None


def extract_tvdb_show_id(item) -> int | None:
    for raw in _iter_guid_strings(item):
        match = _TVDB_ID_RE.search(raw)
        if not match:
            continue
        for group in match.groups():
            if group:
                try:
                    return int(group)
                except ValueError:
                    continue
    return None


class TmdbAirDateResolver:
    """Resolve episode air dates via Plex first, then TMDB (cached)."""

    def __init__(
        self,
        *,
        api_key: str = "",
        cache_path: Path | None = None,
        enabled: bool = True,
        max_calls: int = DEFAULT_MAX_CALLS,
        progress: ProgressFn | None = None,
    ):
        self.api_key = str(api_key or "").strip()
        self.enabled = bool(enabled) and bool(self.api_key)
        self.cache_path = Path(cache_path) if cache_path else None
        self.max_calls = max(0, int(max_calls or 0))
        self.progress = progress
        self.calls = 0
        self.hits = 0
        self.misses = 0
        self.lookups = 0
        self._cache: dict[str, Any] = {}
        self._tvdb_to_tmdb: dict[str, int | None] = {}
        self._warned_disabled = False
        if self.cache_path and self.cache_path.exists():
            try:
                raw = json.loads(self.cache_path.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    self._cache = raw
            except Exception:
                self._cache = {}

    @property
    def active(self) -> bool:
        return self.enabled

    def save(self) -> None:
        if not self.cache_path:
            return
        try:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            self.cache_path.write_text(
                json.dumps(self._cache, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
        except Exception as exc:
            _progress(self.progress, f"TMDB cache save failed: {exc}")

    def summary(self) -> dict[str, Any]:
        return {
            "tmdbFallbackEnabled": self.enabled,
            "tmdbLookups": self.lookups,
            "tmdbApiCalls": self.calls,
            "tmdbCacheHits": self.hits,
            "tmdbCacheMisses": self.misses,
        }

    def _warn_if_inactive(self) -> None:
        if self._warned_disabled or self.enabled:
            return
        self._warned_disabled = True
        if not str(self.api_key or "").strip():
            _progress(self.progress, "TMDB air-date fallback on but no TMDB API key — skipping")
        else:
            _progress(self.progress, "TMDB air-date fallback disabled")

    def _cache_get(self, key: str) -> datetime | None | object:
        """Return datetime, None (known miss), or Ellipsis (absent/expired)."""
        entry = self._cache.get(key)
        if not isinstance(entry, dict):
            return Ellipsis
        fetched = _as_datetime(entry.get("fetchedAt"))
        air = entry.get("airDate")
        ttl = HIT_TTL_DAYS if air else MISS_TTL_DAYS
        if fetched and datetime.now() - fetched > timedelta(days=ttl):
            return Ellipsis
        if air is None or air == "":
            return None
        return _as_datetime(air)

    def _cache_set(self, key: str, air: datetime | None) -> None:
        self._cache[key] = {
            "airDate": air.strftime("%Y-%m-%d") if air else None,
            "fetchedAt": datetime.now().isoformat(timespec="seconds"),
        }

    def _get(self, path: str, params: dict | None = None) -> dict | None:
        if not self.enabled:
            return None
        if self.calls >= self.max_calls:
            _progress(self.progress, f"TMDB air-date fallback hit call cap ({self.max_calls})")
            self.enabled = False
            return None
        query = {"api_key": self.api_key, **(params or {})}
        url = f"{TMDB_API_BASE}{path}"
        self.calls += 1
        try:
            resp = requests.get(url, params=query, timeout=12)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            data = resp.json()
            return data if isinstance(data, dict) else None
        except Exception as exc:
            _progress(self.progress, f"TMDB request failed ({path}): {exc}")
            return None

    def resolve_show_tmdb_id(self, show) -> int | None:
        tmdb_id = extract_tmdb_show_id(show)
        if tmdb_id:
            return tmdb_id
        tvdb_id = extract_tvdb_show_id(show)
        if not tvdb_id:
            return None
        cache_key = f"tvdb:{tvdb_id}"
        if cache_key in self._tvdb_to_tmdb:
            return self._tvdb_to_tmdb[cache_key]
        cached = self._cache_get(cache_key)
        if cached is not Ellipsis:
            # Reuse airDate field as mapped id string for tvdb map entries
            entry = self._cache.get(cache_key) or {}
            mapped = entry.get("tmdbId")
            try:
                value = int(mapped) if mapped else None
            except (TypeError, ValueError):
                value = None
            self._tvdb_to_tmdb[cache_key] = value
            return value
        data = self._get(f"/find/{tvdb_id}", {"external_source": "tvdb_id"})
        value = None
        if data:
            results = data.get("tv_results") or []
            if results:
                try:
                    value = int(results[0].get("id"))
                except (TypeError, ValueError):
                    value = None
        self._tvdb_to_tmdb[cache_key] = value
        self._cache[cache_key] = {
            "tmdbId": value,
            "airDate": None,
            "fetchedAt": datetime.now().isoformat(timespec="seconds"),
        }
        return value

    def fetch_episode_air_date(self, show, season_index: int, episode_index: int) -> datetime | None:
        self._warn_if_inactive()
        if not self.enabled:
            return None
        try:
            season_n = int(season_index)
            episode_n = int(episode_index)
        except (TypeError, ValueError):
            return None
        if season_n < 0 or episode_n < 1:
            return None

        tmdb_id = self.resolve_show_tmdb_id(show)
        if not tmdb_id:
            return None

        cache_key = f"tv:{tmdb_id}:s{season_n}:e{episode_n}"
        cached = self._cache_get(cache_key)
        if cached is not Ellipsis:
            self.hits += 1
            return cached if isinstance(cached, datetime) else None

        self.misses += 1
        self.lookups += 1
        data = self._get(f"/tv/{tmdb_id}/season/{season_n}/episode/{episode_n}")
        air = _as_datetime((data or {}).get("air_date")) if data else None
        self._cache_set(cache_key, air)
        if air:
            _progress(
                self.progress,
                f"TMDB air date: {getattr(show, 'title', tmdb_id)} S{season_n:02d}E{episode_n:02d} → {air.date()}",
            )
        return air

    def resolve_episode_aired(self, episode, show=None) -> datetime | None:
        """Plex originallyAvailableAt first; TMDB fallback when missing."""
        plex_aired = _as_datetime(getattr(episode, "originallyAvailableAt", None))
        if plex_aired is not None:
            return plex_aired
        self._warn_if_inactive()
        if not self.enabled:
            return None
        show_obj = show
        if show_obj is None:
            try:
                show_obj = episode.show()
            except Exception:
                show_obj = None
        if show_obj is None:
            return None
        season_index = getattr(episode, "parentIndex", None)
        if season_index is None:
            season_index = getattr(episode, "seasonNumber", None)
        episode_index = getattr(episode, "index", None)
        if season_index is None or episode_index is None:
            return None
        return self.fetch_episode_air_date(show_obj, season_index, episode_index)


def create_resolver_from_config(
    config: dict,
    *,
    paths: dict | None = None,
    progress: ProgressFn | None = None,
) -> TmdbAirDateResolver:
    enabled = _as_bool(config.get("tmdbAirDateFallback", config.get("tmdb_air_date_fallback")), True)
    api_key = str(config.get("tmdbApiKey") or config.get("tmdb_api_key") or "").strip()
    root = None
    if paths and paths.get("root"):
        root = Path(paths["root"])
    else:
        root = Path(str(config.get("dataDir") or config.get("data_dir") or ".")).resolve()
    cache_path = root / "tmdb_airdate_cache.json"
    max_calls = int(config.get("tmdbAirDateMaxCalls") or config.get("tmdb_air_date_max_calls") or DEFAULT_MAX_CALLS)
    return TmdbAirDateResolver(
        api_key=api_key,
        cache_path=cache_path,
        enabled=enabled,
        max_calls=max_calls,
        progress=progress,
    )
