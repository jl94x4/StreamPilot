"""
Headless core for Poster Sets (MediUX / ThePosterDB → Plex).
Adapted from plex-poster-set-helper; no GUI dependencies.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Callable, Iterable, List, Optional, Sequence, Set, Tuple

from urllib.parse import quote, unquote, urlparse

import plexapi.exceptions
import requests
from bs4 import BeautifulSoup
from plexapi.server import PlexServer

try:
    from PIL import Image
except ImportError:  # pragma: no cover - Docker installs overlays/Pillow into this venv
    Image = None

try:
    from plex_identity import configure_plex_identity
except ImportError:  # pragma: no cover - Dockerfile must COPY plex_identity.py
    def configure_plex_identity(force: bool = False) -> str:
        return ""

ProgressFn = Optional[Callable[[str], None]]
BatchFn = Optional[Callable[[dict], None]]


def _url_hostname(url: str) -> str:
    raw = str(url or "").strip()
    if not raw:
        return ""
    try:
        parsed = urlparse(raw if "://" in raw else f"https://{raw}")
        return (parsed.hostname or "").lower()
    except Exception:
        return ""


def _url_host_matches(url: str, *domains: str) -> bool:
    host = _url_hostname(url)
    if not host:
        return False
    for domain in domains:
        needle = str(domain or "").strip().lower().lstrip(".")
        if not needle:
            continue
        if host == needle or host.endswith("." + needle):
            return True
    return False


IMAGE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    # Prefer formats we can magic-check and Plex can ingest. AVIF-first caused
    # silent apply failures when TPDB returned AVIF and we rejected the bytes.
    "Accept": "image/jpeg,image/png,image/webp;q=0.9,image/*;q=0.8,*/*;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://mediux.pro/",
}

# Kometa / portal Overlays mark items with Overlay plus stamp labels (4K-HDR, Atmos, …).
KOMETA_OVERLAY_LABELS = ("Overlay", "overlay")


def emit(progress: ProgressFn, message: str) -> None:
    if progress:
        progress(message)


def should_reset_overlay(config: Optional[dict] = None) -> bool:
    if not config:
        return True
    value = config.get("reset_overlay")
    return True if value is None else bool(value)


def clear_kometa_overlay(upload_target, config: Optional[dict] = None, progress: ProgressFn = None) -> None:
    """
    Strip every Overlays-section stamp after Poster Sets replaces the poster.

    Clears Overlay + Layer labels (4K, HDR, Atmos, editions, …), overlay logs,
    and overlay backups so a later revert cannot restore old art over the new set.
    Enabled by default; disable via config.reset_overlay = false.
    """
    if not should_reset_overlay(config):
        return
    try:
        from clear_overlays import clear_overlays_after_poster_apply
        clear_overlays_after_poster_apply(upload_target, config=config, progress=progress)
        return
    except Exception:
        pass
    for label in KOMETA_OVERLAY_LABELS:
        try:
            upload_target.removeLabel(label)
            return
        except Exception:
            continue


def asset_id(kind: str, poster: dict) -> str:
    raw = "|".join(
        [
            kind,
            str(poster.get("title") or ""),
            str(poster.get("year") or ""),
            str(poster.get("season") if poster.get("season") is not None else ""),
            str(poster.get("episode") if poster.get("episode") is not None else ""),
            str(poster.get("url") or ""),
        ]
    )
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def asset_label(kind: str, poster: dict) -> str:
    if kind == "collection":
        return "Collection"
    if kind == "movie":
        if poster.get("season") == "Backdrop" or asset_file_type("movie", poster) == "background":
            return "Background"
        return "Movie poster"
    season = poster.get("season")
    episode = poster.get("episode")
    if season == "Cover":
        return "Show cover"
    if season == "Backdrop":
        return "Background"
    if season == 0:
        return "Specials"
    if episode == "Cover" or episode is None:
        return f"Season {season}"
    return f"S{season}E{episode}"


def asset_file_type(kind: str, poster: dict) -> str | None:
    """Map a poster row to a mediux_filters / art-type picker id."""
    explicit = str(poster.get("file_type") or poster.get("fileType") or "").strip().lower()
    if explicit in {"backdrop", "background"}:
        return "background"
    if explicit in {"title_card", "season_cover", "show_cover"}:
        return explicit
    season = poster.get("season")
    if season == "Backdrop":
        return "background"
    if kind != "show":
        return None
    episode = poster.get("episode")
    if season == "Cover":
        return "show_cover"
    if episode == "Cover" or episode is None or episode == "":
        return "season_cover"
    return "title_card"


_POSTERDB_SEASON_SUFFIX = re.compile(r"^Season\s+(\d+)$", re.I)


def parse_posterdb_caption(caption: str) -> dict:
    """Split a ThePosterDB overlay caption into title / year / poster target.

    ThePosterDB is posters only (show, season, movie, collection). It has no
    backdrops or episode title cards — those are MediUX. Captions look like:
      Show (2020)
      Show (2020) - Season 1
      Show (2020) - Specials
      Movie (2026)
    """
    text = " ".join(str(caption or "").split()).strip()
    year = None
    year_match = re.search(r"\((\d{4}|N/A)\)", text)
    if year_match:
        if year_match.group(1).isdigit():
            year = int(year_match.group(1))
        title = text[: year_match.start()].strip() or text
        rest = text[year_match.end() :].strip()
    else:
        title = text
        rest = ""
    suffix = rest.lstrip("-–— ").strip() if rest else ""

    season: Any = None
    file_type: str | None = None
    if suffix:
        low = suffix.lower()
        if low in {"specials", "special"}:
            season = 0
            file_type = "season_cover"
        elif low in {"cover", "poster"}:
            season = "Cover"
            file_type = "show_cover"
        else:
            sea = _POSTERDB_SEASON_SUFFIX.match(suffix)
            if sea:
                season = int(sea.group(1))
                file_type = "season_cover"

    return {
        "title": title or text,
        "year": year,
        "suffix": suffix,
        "season": season,
        "episode": None,
        "file_type": file_type,
    }


def _image_suffix(content_type: str, url: str) -> str:
    ct = (content_type or "").lower()
    if "png" in ct or url.lower().endswith(".png"):
        return ".png"
    if "webp" in ct or url.lower().endswith(".webp"):
        return ".webp"
    return ".jpg"


def _looks_like_image(data: bytes) -> bool:
    if len(data) < 12:
        return False
    if data[:3] == b"\xff\xd8\xff":
        return True  # JPEG
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return True  # PNG
    if data[:4] == b"RIFF" and len(data) >= 12 and data[8:12] == b"WEBP":
        return True  # WEBP
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return True  # GIF
    # AVIF / HEIF: ....ftyp.... with brand containing avif/heic/mif1
    if len(data) >= 12 and data[4:8] == b"ftyp":
        brand = data[8:12].lower()
        if brand in (b"avif", b"avis", b"heic", b"heif", b"mif1", b"msf1"):
            return True
        if b"avif" in data[8:24].lower() or b"heic" in data[8:24].lower():
            return True
    return False


def _image_payload_hint(data: bytes) -> str:
    if not data:
        return "empty"
    head = data[:200].lstrip().lower()
    if head.startswith(b"<!doctype html") or head.startswith(b"<html") or b"cloudflare" in head:
        return "html/challenge page"
    if head.startswith(b"{") or head.startswith(b"["):
        return "json"
    return f"{len(data)} bytes, unknown format"


def download_image(url: str, progress: ProgressFn = None, *, config: dict | None = None) -> Optional[str]:
    """Download an image to a temp file. Returns path or None.

    Checks local ThePosterDB image cache dirs first so apply works when TPDB is down.
    """
    target = str(url or "").strip()
    if not target:
        return None

    # Offline / fast path: hashed bins from Node tpdb-image-cache or image-cache.
    cfg = config if isinstance(config, dict) else {}
    for dir_key in ("tpdb_image_cache_dir", "image_cache_dir"):
        cache_dir = str(cfg.get(dir_key) or "").strip()
        if not cache_dir:
            continue
        try:
            digest = hashlib.sha1(target.encode("utf-8")).hexdigest()
            bin_path = os.path.join(cache_dir, f"{digest}.bin")
            if os.path.isfile(bin_path) and os.path.getsize(bin_path) > 0:
                with open(bin_path, "rb") as src:
                    cached = src.read()
                if not _looks_like_image(cached):
                    emit(progress, f"Skipping corrupt local cache entry for {target[:80]}…")
                    continue
                suffix = _image_suffix("", target)
                handle = tempfile.NamedTemporaryFile(suffix=suffix or ".jpg", delete=False)
                handle.write(cached)
                handle.close()
                emit(progress, f"Using local cached image for {target[:80]}…")
                return handle.name
        except Exception as exc:
            emit(progress, f"Local image cache miss/error: {exc}")

    headers = dict(IMAGE_HEADERS)
    is_tpdb = _url_host_matches(target, "theposterdb.com")
    if is_tpdb:
        headers["Referer"] = "https://theposterdb.com/"
    elif _url_host_matches(target, "mediux.pro"):
        headers["Referer"] = "https://mediux.pro/"

    session = None
    if is_tpdb and config:
        try:
            session = _posterdb_http_client(config)
        except Exception:
            session = None

    last_error = None
    for attempt in range(4):
        try:
            if is_tpdb:
                _posterdb_throttle(authenticated=isinstance(session, requests.Session))
            if isinstance(session, requests.Session):
                response = session.get(target, headers=headers, timeout=60)
            else:
                response = requests.get(target, headers=headers, timeout=60)
            if response.status_code == 429:
                retry_after = None
                try:
                    retry_after = float(response.headers.get("Retry-After") or 0) or None
                except Exception:
                    retry_after = None
                if is_tpdb:
                    _posterdb_note_rate_limit(retry_after)
                wait_s = max(2.0, float(retry_after or 0) or (2.0 + attempt * 2.0))
                emit(progress, f"Image download rate-limited (429); retrying in {int(wait_s)}s…")
                time.sleep(wait_s)
                last_error = f"HTTP 429 for {target}"
                continue
            if response.status_code >= 500:
                wait_s = 0.8 + attempt * 0.8
                emit(progress, f"Image download HTTP {response.status_code}; retrying…")
                time.sleep(wait_s)
                last_error = f"HTTP {response.status_code} for {target}"
                continue
            response.raise_for_status()
            if not _looks_like_image(response.content):
                hint = _image_payload_hint(response.content)
                emit(progress, f"Downloaded non-image payload from {target[:80]}… ({hint})")
                # Authed session sometimes still gets a challenge HTML — try anonymous once.
                if is_tpdb and isinstance(session, requests.Session) and attempt < 3:
                    session = None
                    last_error = f"non-image payload ({hint})"
                    time.sleep(0.5 + attempt * 0.4)
                    continue
                return None
            suffix = _image_suffix(response.headers.get("content-type", ""), target)
            handle = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
            handle.write(response.content)
            handle.close()
            return handle.name
        except Exception as exc:
            last_error = str(exc)
            emit(progress, f"Failed to download image (attempt {attempt + 1}/4): {exc}")
            time.sleep(0.6 + attempt * 0.6)
    if last_error:
        emit(progress, f"Failed to download image: {last_error}")
    return None


def cleanup_temp_file(path: Optional[str]) -> None:
    if not path:
        return
    try:
        if os.path.exists(path):
            time.sleep(0.5)
            os.remove(path)
    except Exception:
        pass


# Plex hard-rejects POST /posters and /arts above 10MB with a generic HTTP 500
# ("Content-Length exceeds the maximum allowed limit of 10MB" in the PMS log).
PLEX_ARTWORK_MAX_BYTES = int(9.5 * 1024 * 1024)


def _unlock_plex_artwork(item, *, art: bool = False) -> None:
    """Plex often 500s on /posters when the thumb/art field is locked."""
    field = "art.locked" if art else "thumb.locked"
    try:
        item.edit(**{field: 0})
    except Exception:
        pass


def _is_retryable_plex_artwork_error(exc: BaseException) -> bool:
    text = str(exc or "").lower()
    return any(
        token in text
        for token in (
            "500",
            "502",
            "503",
            "504",
            "internal_server_error",
            "internal server error",
            "timeout",
            "timed out",
            "connection reset",
            "connection aborted",
            "10mb",
            "content-length",
            "exceeds the maximum",
        )
    )


def _flatten_artwork_rgb(img: "Image.Image") -> "Image.Image":
    rgba = img.convert("RGBA")
    flat = Image.new("RGB", rgba.size, (0, 0, 0))
    flat.paste(rgba, mask=rgba.split()[3])
    return flat


def compress_artwork_for_plex(
    src: str | Path,
    dest: str | Path,
    *,
    max_bytes: int = PLEX_ARTWORK_MAX_BYTES,
) -> Path:
    """Re-encode/resize until the file is under Plex's ~10MB upload cap."""
    if Image is None:
        raise RuntimeError(
            "Pillow is required to compress artwork over Plex's 10MB upload limit"
        )
    src_path = Path(src)
    dest_path = Path(dest)
    img = _flatten_artwork_rgb(Image.open(src_path))
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    plans: list[tuple[int, int, int]] = [
        (2000, 3000, 92),
        (1600, 2400, 88),
        (1400, 2100, 85),
        (1200, 1800, 82),
        (1000, 1500, 80),
        (1000, 1500, 72),
        (800, 1200, 70),
    ]
    last_size = 0
    resample = getattr(Image, "Resampling", Image).LANCZOS
    for max_w, max_h, quality in plans:
        frame = img.copy()
        if frame.width > max_w or frame.height > max_h:
            frame.thumbnail((max_w, max_h), resample)
        frame.save(dest_path, format="JPEG", quality=quality, optimize=True)
        last_size = dest_path.stat().st_size
        if last_size <= max_bytes:
            return dest_path
    raise RuntimeError(
        f"Could not compress artwork under Plex 10MB limit "
        f"(still {last_size} bytes after re-encode)"
    )


def upload_artwork_to_plex(
    item,
    filepath: str | Path,
    *,
    art: bool = False,
    progress: ProgressFn = None,
    title: str | None = None,
    retries: int = 3,
) -> None:
    """Upload a poster or background, compressing when over Plex's 10MB cap."""
    path = Path(filepath)
    label = title or getattr(item, "title", None) or str(getattr(item, "ratingKey", "") or path.name)
    upload_path = path
    compressed: Path | None = None
    size = 0

    def _upload(target: Path) -> None:
        if art:
            item.uploadArt(filepath=str(target))
        else:
            item.uploadPoster(filepath=str(target))

    try:
        try:
            size = path.stat().st_size
        except Exception:
            size = 0

        if size > PLEX_ARTWORK_MAX_BYTES:
            compressed = path.with_name(f"{path.stem}_plex.jpg")
            compress_artwork_for_plex(path, compressed)
            upload_path = compressed
            emit(
                progress,
                f"Compressed artwork for {label}: {size} → {compressed.stat().st_size} bytes "
                f"(Plex 10MB upload limit)",
            )

        _unlock_plex_artwork(item, art=art)
        last_exc: BaseException | None = None
        for attempt in range(max(1, int(retries))):
            try:
                _upload(upload_path)
                return
            except Exception as exc:
                last_exc = exc
                if not _is_retryable_plex_artwork_error(exc):
                    raise
                emit(
                    progress,
                    f"Plex artwork upload failed for {label} "
                    f"(attempt {attempt + 1}/{retries}): {exc}",
                )
                if compressed is None:
                    try:
                        compressed = path.with_name(f"{path.stem}_plex.jpg")
                        compress_artwork_for_plex(path, compressed)
                        upload_path = compressed
                        emit(
                            progress,
                            f"Retrying {label} with compressed JPEG "
                            f"({compressed.stat().st_size} bytes)",
                        )
                    except Exception as compress_exc:
                        emit(progress, f"Artwork compress failed for {label}: {compress_exc}")
                _unlock_plex_artwork(item, art=art)
                try:
                    if hasattr(item, "reload") and callable(item.reload):
                        item.reload()
                except Exception:
                    pass
                time.sleep(min(3.0, 0.5 * (attempt + 1)))

        if last_exc is not None:
            raise last_exc
        raise RuntimeError(f"Plex artwork upload failed for {label}")
    finally:
        if compressed is not None:
            try:
                if compressed.exists():
                    compressed.unlink()
            except Exception:
                pass


def apply_poster_or_art(upload_target, poster: dict, *, art: bool = False, progress: ProgressFn = None) -> None:
    """
    Upload artwork to Plex and/or write beside media on disk when local mode is enabled.
    Always download MediUX/TPDB bytes first so "ok" means we had a real image.
    """
    config = poster.get("_config") if isinstance(poster.get("_config"), dict) else {}
    url = poster.get("url") or ""
    source = str(poster.get("source") or "").strip().lower()
    path = None
    api_host = _url_hostname(url)
    needs_download = (
        source in {"mediux", "posterdb"}
        or (api_host == "api.mediux.pro" and "/assets/" in str(url or ""))
        or _url_host_matches(url, "theposterdb.com")
    )
    if needs_download:
        path = download_image(url, progress=progress, config=config)
        if not path:
            raise RuntimeError(f"Could not download image: {url}")
    try:
        if should_write_local(config):
            try:
                write_local_art(upload_target, poster, path=path, art=art, progress=progress)
            except Exception as exc:
                if not should_upload_plex(config):
                    raise
                emit(progress, f"Local art failed (continuing with Plex): {exc}")
        if should_upload_plex(config):
            if path:
                upload_artwork_to_plex(
                    upload_target,
                    path,
                    art=art,
                    progress=progress,
                    title=poster.get("title"),
                )
            elif art:
                upload_target.uploadArt(url=url)
            else:
                upload_target.uploadPoster(url=url)
        elif not should_write_local(config):
            raise RuntimeError("No apply destination configured (set applyDestination in Poster Sets settings)")
    finally:
        cleanup_temp_file(path)


def apply_destination_mode(config: dict | None) -> str:
    cfg = config if isinstance(config, dict) else {}
    raw = str(cfg.get("apply_destination") or cfg.get("applyDestination") or "plex").strip().lower()
    if raw in ("both", "plex+local", "plex_and_local"):
        return "plex_local"
    return raw or "plex"


def should_upload_plex(config: dict | None) -> bool:
    mode = apply_destination_mode(config)
    return mode in ("plex", "plex_local", "")


def should_write_local(config: dict | None) -> bool:
    return apply_destination_mode(config) in ("local", "plex_local")


def _item_media_dir(item) -> Optional[str]:
    try:
        media = getattr(item, "media", None) or []
        if media:
            parts = getattr(media[0], "parts", None) or []
            if parts:
                media_file = getattr(parts[0], "file", None) or getattr(parts[0], "file", "")
                if media_file:
                    return os.path.dirname(str(media_file))
    except Exception:
        pass
    try:
        locations = getattr(item, "locations", None) or []
        if locations:
            return str(locations[0]).rstrip("\\/")
    except Exception:
        pass
    return None


def local_art_path(upload_target, poster: dict, *, art: bool = False) -> Optional[str]:
    """Resolve on-disk path for local artwork beside Plex media."""
    base_dir = _item_media_dir(upload_target)
    if not base_dir:
        return None
    season = poster.get("season")
    episode = poster.get("episode")
    file_type = asset_file_type("show", poster) if poster.get("season") is not None else asset_file_type("movie", poster)
    if art or season == "Backdrop" or file_type == "background":
        return os.path.join(base_dir, "fanart.jpg")
    if episode not in (None, "", "Cover") and isinstance(episode, (int, float)) or (
        isinstance(episode, str) and str(episode).isdigit()
    ):
        ep_dir = base_dir if os.path.basename(base_dir).lower().startswith("s") else base_dir
        return os.path.join(ep_dir, "thumb.jpg")
    if season not in (None, "", "Cover", "Backdrop") and isinstance(season, (int, float)):
        season_dir = base_dir
        try:
            locs = getattr(upload_target, "locations", None) or []
            if locs:
                season_dir = str(locs[0]).rstrip("\\/")
        except Exception:
            pass
        if season_dir and season_dir != base_dir:
            return os.path.join(season_dir, f"season{int(season):02d}-poster.jpg")
        return os.path.join(base_dir, f"season{int(season):02d}-poster.jpg")
    return os.path.join(base_dir, "poster.jpg")


def write_local_art(upload_target, poster: dict, *, path: Optional[str] = None, art: bool = False, progress: ProgressFn = None) -> None:
    dest_path = local_art_path(upload_target, poster, art=art)
    if not dest_path:
        raise RuntimeError("Local art failed: could not resolve media folder")
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    temp_path = path
    owned_temp = False
    if not temp_path:
        url = poster.get("url") or ""
        config = poster.get("_config") if isinstance(poster.get("_config"), dict) else {}
        temp_path = download_image(url, progress=progress, config=config)
        owned_temp = True
        if not temp_path:
            raise RuntimeError(f"Could not download image for local art: {url}")
    try:
        with open(temp_path, "rb") as src, open(dest_path, "wb") as dst:
            dst.write(src.read())
        emit(progress, f"Wrote local art: {dest_path}")
    finally:
        if owned_temp:
            cleanup_temp_file(temp_path)


def normalize_library_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def connect_plex(config: dict, progress: ProgressFn = None) -> Tuple[list, list, PlexServer]:
    configure_plex_identity()
    base_url = str(config.get("base_url") or "").strip()
    token = str(config.get("token") or "").strip()
    if not base_url or not token:
        raise ValueError("Plex base_url and token are required")

    plex = PlexServer(base_url, token)
    tv_names = normalize_library_list(config.get("tv_library"))
    movie_names = normalize_library_list(config.get("movie_library"))

    tv = []
    for name in tv_names:
        try:
            tv.append(plex.library.section(name))
            emit(progress, f"TV library ready: {name}")
        except plexapi.exceptions.NotFound as exc:
            raise ValueError(f'TV library named "{name}" not found') from exc

    movies = []
    for name in movie_names:
        try:
            movies.append(plex.library.section(name))
            emit(progress, f"Movie library ready: {name}")
        except plexapi.exceptions.NotFound as exc:
            raise ValueError(f'Movie library named "{name}" not found') from exc

    return tv, movies, plex


def test_connection(config: dict) -> dict:
    tv, movies, plex = connect_plex(config)
    sections = []
    try:
        for section in plex.library.sections():
            sections.append({"title": section.title, "type": getattr(section, "type", None)})
    except Exception:
        sections = []
    return {
        "ok": True,
        "server": getattr(plex, "friendlyName", None) or base_url_safe(config),
        "tvLibraries": [lib.title for lib in tv],
        "movieLibraries": [lib.title for lib in movies],
        "sections": sections,
    }


def base_url_safe(config: dict) -> str:
    return str(config.get("base_url") or "").strip()


_POSTERDB_SESSIONS: dict[str, requests.Session] = {}
# Negative login cache — avoid re-posting credentials every title (TPDB rate-limits login).
_POSTERDB_LOGIN_FAILED_UNTIL: dict[str, float] = {}
_POSTERDB_LOGIN_FAIL_COOLDOWN_S = 90.0
_POSTERDB_LOGIN_LAST_ERROR: Optional[str] = None
_POSTERDB_HTTP_LOCK = threading.RLock()
# Adaptive HTML pacing — authenticated traffic can go faster; 429s raise the floor.
_POSTERDB_HTML_GAP_AUTH_S = 1.5
_POSTERDB_HTML_GAP_PUBLIC_S = 2.5
_POSTERDB_HTML_GAP_S = 0.0  # raised to >=7 on HTTP 429
_posterdb_last_http_at = 0.0
# Warm metadata pass: enough sets for browsing; full crawl happens when a title is opened.
_POSTERDB_WARM_SET_LIMIT = 48
_POSTERDB_WARM_MAX_SET_PAGES = 1
# Browser-imported sessions (cf_clearance) often outlive password re-login, which
# Cloudflare blocks on many VPS/Docker IPs — keep cookies longer when possible.
_POSTERDB_SESSION_MAX_AGE_S = 7 * 24 * 60 * 60


def _posterdb_throttle(*, authenticated: bool = False) -> None:
    """Pace TPDB HTML so login + search + probes don't stampede the rate limiter."""
    global _posterdb_last_http_at
    base = _POSTERDB_HTML_GAP_AUTH_S if authenticated else _POSTERDB_HTML_GAP_PUBLIC_S
    gap = max(base, _POSTERDB_HTML_GAP_S)
    with _POSTERDB_HTTP_LOCK:
        now = time.time()
        wait = (gap - (now - _posterdb_last_http_at)) if _posterdb_last_http_at else 0.0
        if wait > 0.05:
            time.sleep(wait)
        _posterdb_last_http_at = time.time()


def _posterdb_note_rate_limit(retry_after: float | None = None) -> None:
    """Back off HTML pacing after HTTP 429."""
    global _POSTERDB_HTML_GAP_S, _posterdb_last_http_at
    cool = max(15.0, float(retry_after or 0) or 20.0)
    _POSTERDB_HTML_GAP_S = max(_POSTERDB_HTML_GAP_S, 7.0)
    _posterdb_last_http_at = time.time() + cool - _POSTERDB_HTML_GAP_S
    emit(None, f"ThePosterDB rate limited — cooling {int(cool)}s and slowing HTML gap to {_POSTERDB_HTML_GAP_S:.1f}s")


_POSTERDB_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
_POSTERDB_ADVANCED_SEARCH_URLS = (
    "https://theposterdb.com/search/advanced/results",
    "https://theposterdb.com/search",
)
_POSTERDB_LOGIN_COOKIE_NAMES = {
    "the_poster_database_session",
    "laravel_session",
}


def _posterdb_normalize_cookie_domain(domain: str) -> str:
    host = str(domain or "").strip().lstrip(".").lower()
    if host.startswith("www."):
        host = host[4:]
    return host


def _posterdb_cookie_domain_allowed(domain: str) -> bool:
    host = _posterdb_normalize_cookie_domain(domain)
    return host in {"", "theposterdb.com"} or host.endswith(".theposterdb.com")


def _posterdb_has_login_cookie(names: set[str] | Sequence[str]) -> bool:
    for name in names:
        key = str(name or "").strip().lower()
        if key in _POSTERDB_LOGIN_COOKIE_NAMES:
            return True
        if key.startswith("remember_web"):
            return True
    return False


def _posterdb_session_has_login_cookies(session: requests.Session) -> bool:
    try:
        names = {str(cookie.name or "") for cookie in session.cookies}
    except Exception:
        return False
    return _posterdb_has_login_cookie(names)


def _posterdb_html_looks_logged_in(html: str, url: str = "") -> bool:
    if "theposterdb.com/login" in str(url or "").lower():
        return False
    lower = str(html or "").lower()
    return "/logout" in lower or "sign out" in lower or ">log out<" in lower


def _posterdb_cookie_expired(row: dict) -> bool:
    exp = row.get("expires")
    if exp in (None, "", 0, "0"):
        return False
    try:
        ts = float(exp)
    except Exception:
        return False
    if ts > 1e12:
        ts /= 1000.0
    if ts <= 0:
        return False
    return ts < (time.time() - 60)


def _posterdb_session_cache_key(user: str, password: str) -> str:
    # Fingerprint for in-memory session cache only — not password verification/storage.
    material = f"{user}\0{password}".encode("utf-8")
    # codeql[py/weak-sensitive-data-hashing]: cache-key fingerprint, not password hashing
    digest = hashlib.sha256(material).hexdigest()[:20]
    return f"{user.lower()}:{digest}"


def _posterdb_session_path(config: dict | None = None) -> str:
    config = config if isinstance(config, dict) else {}
    explicit = str(config.get("tpdb_session_path") or "").strip()
    if explicit:
        return explicit
    cache_dir = str(config.get("tpdb_image_cache_dir") or "").strip()
    if cache_dir:
        return os.path.join(os.path.dirname(cache_dir), "tpdb-session.json")
    return ""


def _posterdb_session_file_exists(config: dict | None = None) -> bool:
    path = _posterdb_session_path(config)
    return bool(path and os.path.isfile(path))


def _posterdb_invalidate_sessions(user: str = "") -> None:
    if not user:
        _POSTERDB_SESSIONS.clear()
        _POSTERDB_LOGIN_FAILED_UNTIL.clear()
        return
    prefix = f"{user.lower()}:"
    for key in list(_POSTERDB_SESSIONS.keys()):
        if key.startswith(prefix):
            del _POSTERDB_SESSIONS[key]
    for key in list(_POSTERDB_LOGIN_FAILED_UNTIL.keys()):
        if key.startswith(prefix):
            del _POSTERDB_LOGIN_FAILED_UNTIL[key]


def _posterdb_mark_login_failed(cache_key: str, message: str = "") -> None:
    global _POSTERDB_LOGIN_LAST_ERROR
    _POSTERDB_LOGIN_FAILED_UNTIL[cache_key] = time.time() + _POSTERDB_LOGIN_FAIL_COOLDOWN_S
    text = str(message or "").strip()
    if text:
        _POSTERDB_LOGIN_LAST_ERROR = text


def _posterdb_take_login_error() -> Optional[str]:
    global _POSTERDB_LOGIN_LAST_ERROR
    text = _POSTERDB_LOGIN_LAST_ERROR
    _POSTERDB_LOGIN_LAST_ERROR = None
    return text


def _posterdb_session_ready(config: dict | None = None) -> bool:
    """True when credentials exist and we already hold a live authenticated session."""
    config = config if isinstance(config, dict) else {}
    user = str(config.get("tpdb_username") or config.get("tpdb_login") or "").strip()
    password = str(config.get("tpdb_password") or "").strip()
    if not user or not password or password == "********":
        return False
    return _POSTERDB_SESSIONS.get(_posterdb_session_cache_key(user, password)) is not None


def _posterdb_cookie_rows(session: requests.Session) -> list[dict]:
    rows: list[dict] = []
    for cookie in session.cookies:
        rows.append({
            "name": cookie.name,
            "value": cookie.value,
            "domain": cookie.domain,
            "path": cookie.path or "/",
            "secure": bool(cookie.secure),
            "expires": cookie.expires,
        })
    return rows


def _posterdb_apply_cookie_rows(session: requests.Session, rows: Sequence[dict] | None) -> None:
    """Attach TPDB cookies so requests will send them to https://theposterdb.com.

    Browser exports often use a leading-dot or www host. requests/cookielib will
    not send www cookies to the apex host, so we normalize onto theposterdb.com
    and skip unrelated domains (full-browser cookies.txt dumps).
    """
    for row in rows or []:
        name = str(row.get("name") or "").strip()
        value = str(row.get("value") or "")
        if not name:
            continue
        raw_domain = str(row.get("domain") or "theposterdb.com")
        if not _posterdb_cookie_domain_allowed(raw_domain):
            continue
        if _posterdb_cookie_expired(row):
            continue
        path = str(row.get("path") or "/") or "/"
        try:
            session.cookies.set(name, value, domain="theposterdb.com", path=path)
        except Exception:
            session.cookies.set(name, value, path=path)


def _posterdb_save_session_file(
    config: dict | None,
    cache_key: str,
    session: requests.Session,
    *,
    user_agent: str | None = None,
) -> None:
    path = _posterdb_session_path(config)
    if not path:
        return
    try:
        parent = os.path.dirname(path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        ua = str(user_agent or session.headers.get("User-Agent") or _POSTERDB_UA).strip() or _POSTERDB_UA
        payload = {
            "cacheKey": cache_key,
            "savedAt": time.time(),
            "userAgent": ua,
            "cookies": _posterdb_cookie_rows(session),
        }
        tmp = f"{path}.tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)
        os.replace(tmp, path)
    except Exception as exc:
        emit(None, f"ThePosterDB session persist skipped: {exc}")


def _posterdb_load_session_file(config: dict | None, cache_key: str) -> Optional[requests.Session]:
    path = _posterdb_session_path(config)
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    if str(payload.get("cacheKey") or "") != cache_key:
        return None
    saved_at = float(payload.get("savedAt") or 0)
    if saved_at <= 0 or (time.time() - saved_at) > _POSTERDB_SESSION_MAX_AGE_S:
        return None
    session = requests.Session()
    ua = str(payload.get("userAgent") or _POSTERDB_UA).strip() or _POSTERDB_UA
    session.headers.update({"User-Agent": ua})
    _posterdb_apply_cookie_rows(session, payload.get("cookies") if isinstance(payload.get("cookies"), list) else [])
    # Login cookies are enough for HTML pages like /feed. Skip the advanced-search
    # probe here — that endpoint is what Cloudflare usually blocks on Docker/VPS.
    if _posterdb_session_has_login_cookies(session):
        return session
    inspect = _posterdb_inspect_session(session, config=config, quiet=True)
    if inspect.get("ok"):
        return session
    return None


def _posterdb_page_looks_like_challenge(html: str, url: str = "") -> bool:
    text = str(html or "")
    lower = text.lower()
    if "just a moment" in lower or "cf-browser-verification" in lower:
        return True
    if "checking your browser" in lower:
        return True
    # challenge-platform alone appears on normal TPDB pages — only treat as block
    # when the login form CSRF token is missing.
    if "challenge-platform" in lower and 'name="_token"' not in text and "name='_token'" not in text:
        return True
    if "/cdn-cgi/challenge" in lower:
        return True
    if "attention required" in lower and "cloudflare" in lower:
        return True
    if "cf-error-code" in lower or "error code: 1" in lower:
        return True
    return False


def _posterdb_cloudflare_help() -> str:
    return (
        "Cloudflare is blocking login from this server IP (common on Docker/VPS). "
        "Workaround: open theposterdb.com in your browser, log in, then paste cookies "
        "under Poster Sets → Settings → Import TPDB browser cookies. "
        "Or turn off “Use TPDB login” and use public search (weaker for TV)."
    )


def _parse_netscape_cookie_file(text: str) -> list[dict]:
    """Parse Netscape / curl cookie files (Get cookies.txt LOCALLY, etc.)."""
    out: list[dict] = []
    for line in str(text or "").splitlines():
        raw = line.strip()
        if not raw:
            continue
        http_only = False
        http_only_match = re.match(r"^#\s*HttpOnly_(.*)$", raw, flags=re.I)
        if http_only_match:
            http_only = True
            raw = http_only_match.group(1).strip()
        elif raw.startswith("#"):
            continue
        parts = raw.split("\t")
        if len(parts) < 7:
            # Some exporters use spaces; require at least domain + name + value shape.
            parts = re.split(r"\s+", raw)
        if len(parts) < 7:
            continue
        domain, _flag, path, secure_flag, expires_raw, name, value = parts[:7]
        # Value may contain tabs in rare cases — rejoin remainder.
        if len(parts) > 7:
            value = "\t".join(parts[6:])
        name = str(name or "").strip()
        if not name:
            continue
        try:
            expires = int(float(expires_raw)) if str(expires_raw).strip() not in {"", "0"} else None
        except Exception:
            expires = None
        out.append({
            "name": name,
            "value": str(value),
            "domain": str(domain or ".theposterdb.com").strip() or ".theposterdb.com",
            "path": str(path or "/").strip() or "/",
            "secure": str(secure_flag).upper() == "TRUE",
            "expires": expires,
            "httpOnly": http_only,
        })
    return out


def _parse_posterdb_browser_cookies(raw: str | list | dict | None) -> list[dict]:
    """Parse Cookie-Editor JSON, Netscape cookies.txt, DevTools cookie header, or {cookies:[...]}."""
    if raw is None:
        return []
    if isinstance(raw, list):
        rows_in = raw
    elif isinstance(raw, dict):
        if isinstance(raw.get("cookies"), list):
            rows_in = raw["cookies"]
        else:
            rows_in = [raw]
    else:
        text = str(raw or "").replace("\ufeff", "").strip()
        if not text:
            return []
        # Get cookies.txt LOCALLY / curl Netscape format
        if (
            "Netscape HTTP Cookie File" in text
            or text.lstrip().startswith("# Netscape")
            or ("\t" in text and any(
                name in text for name in (
                    "cf_clearance",
                    "the_poster_database_session",
                    "laravel_session",
                    "remember_web",
                )
            ))
        ):
            netscape_rows = _parse_netscape_cookie_file(text)
            if netscape_rows:
                return netscape_rows
        if text.startswith("[") or text.startswith("{"):
            try:
                parsed = json.loads(text)
            except Exception as exc:
                raise ValueError(f"Cookie JSON is invalid: {exc}") from exc
            return _parse_posterdb_browser_cookies(parsed)
        # Cookie header: name=value; name2=value2
        rows_in = []
        for part in text.split(";"):
            chunk = part.strip()
            if not chunk or "=" not in chunk:
                continue
            name, value = chunk.split("=", 1)
            rows_in.append({"name": name.strip(), "value": value.strip(), "domain": ".theposterdb.com"})
    out: list[dict] = []
    for row in rows_in:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or row.get("Name") or "").strip()
        value = row.get("value") if row.get("value") is not None else row.get("Value")
        if not name or value is None:
            continue
        domain = str(
            row.get("domain")
            or row.get("Domain")
            or row.get("host")
            or row.get("Host")
            or ".theposterdb.com"
        ).strip() or ".theposterdb.com"
        path = str(row.get("path") or row.get("Path") or "/").strip() or "/"
        secure = row.get("secure")
        if secure is None:
            secure = row.get("Secure")
        if secure is None:
            secure = row.get("isSecure", True)
        out.append({
            "name": name,
            "value": str(value),
            "domain": domain,
            "path": path,
            "secure": bool(secure),
            "expires": (
                row.get("expires")
                or row.get("expirationDate")
                or row.get("Expires")
                or row.get("expiry")
            ),
        })
    return out


def import_posterdb_browser_cookies(config: dict | None = None, cookies: str | list | dict | None = None) -> dict:
    """Import browser cookies so advanced search works when Cloudflare blocks password login.

    User logs into TPDB in a normal browser (passes Cloudflare), exports cookies
    (Cookie-Editor / DevTools), and pastes them here. Prefer including cf_clearance.
    """
    config = config if isinstance(config, dict) else {}
    user = str(config.get("tpdb_username") or config.get("tpdb_login") or "").strip()
    password = str(config.get("tpdb_password") or "").strip()
    if not user or not password or password == "********":
        return {
            "ok": False,
            "error": "Save TPDB username and password in Settings first (used to key the session file), then import cookies.",
        }
    try:
        rows = _parse_posterdb_browser_cookies(cookies)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}
    if not rows:
        return {
            "ok": False,
            "error": "No cookies found. Paste Cookie-Editor JSON, a Netscape cookies.txt export, or a Cookie header string.",
        }
    tpdb_rows = [
        row for row in rows
        if _posterdb_cookie_domain_allowed(str(row.get("domain") or "theposterdb.com"))
    ]
    if not tpdb_rows:
        return {
            "ok": False,
            "error": (
                "Export has no theposterdb.com cookies. Export cookies for theposterdb.com "
                "while logged in (Get cookies.txt LOCALLY or Cookie-Editor), not a dump of every site."
            ),
        }
    names = {str(row.get("name") or "") for row in tpdb_rows}
    if not _posterdb_has_login_cookie(names):
        return {
            "ok": False,
            "error": (
                "Export is missing the TPDB login cookie (the_poster_database_session or remember_web_*). "
                "DevTools document.cookie skips HttpOnly cookies — use Get cookies.txt LOCALLY or Cookie-Editor "
                "on theposterdb.com while logged in."
            ),
            "cookieCount": len(tpdb_rows),
        }
    live_login = [
        row for row in tpdb_rows
        if _posterdb_has_login_cookie([str(row.get("name") or "")]) and not _posterdb_cookie_expired(row)
    ]
    if not live_login:
        return {
            "ok": False,
            "error": "The TPDB session cookie in this export is expired. Log in again in your browser and re-export.",
            "cookieCount": len(tpdb_rows),
        }
    if "cf_clearance" not in names:
        emit(None, "ThePosterDB cookie import: no cf_clearance cookie — Cloudflare may still block this host.")

    cache_key = _posterdb_session_cache_key(user, password)
    user_agent = str(config.get("tpdb_browser_user_agent") or config.get("tpdbBrowserUserAgent") or "").strip() or _POSTERDB_UA
    session = requests.Session()
    session.headers.update({"User-Agent": user_agent})
    _posterdb_apply_cookie_rows(session, tpdb_rows)

    inspect = _posterdb_inspect_session(session, config=config)
    advanced_ok = bool(inspect.get("ok"))
    # Advanced-search probes often hit Cloudflare on Docker/VPS even when the
    # imported cookies are still good for HTML pages like /feed and /recent.
    if not advanced_ok and not inspect.get("cloudflare") and not inspect.get("loggedIn"):
        ua_hint = (
            " Paste the exact browser User-Agent (chrome://version) — cf_clearance is tied to it."
            if "cf_clearance" in names and user_agent == _POSTERDB_UA
            else ""
        )
        found = ", ".join(sorted(n for n in names if n)[:12])
        return {
            "ok": False,
            "cloudflare": False,
            "error": (
                "Imported cookies did not look like a TPDB login session. "
                "Log in again in your browser, export fresh cookies (include cf_clearance "
                "and the_poster_database_session / remember_web), and paste the same browser User-Agent."
                + ua_hint
                + (f" Found cookies: {found}." if found else "")
            ),
            "cookieCount": len(tpdb_rows),
        }

    _POSTERDB_SESSIONS[cache_key] = session
    _POSTERDB_LOGIN_FAILED_UNTIL.pop(cache_key, None)
    _posterdb_save_session_file(config, cache_key, session, user_agent=user_agent)
    if advanced_ok:
        emit(None, f"ThePosterDB: imported {len(rows)} browser cookie(s) — session verified")
        return {
            "ok": True,
            "username": user,
            "cookieCount": len(rows),
            "hasCfClearance": "cf_clearance" in names,
            "via": "browser-cookies",
        }
    warning = (
        "Cookies saved for Following / recently added. Advanced TMDB search is still blocked from this host"
        " — Cloudflare may also block /feed if cf_clearance is tied to your home IP."
    )
    if inspect.get("loggedIn") and inspect.get("loginRedirect"):
        warning = (
            "Cookies signed you in and were saved for Following / recently added. "
            "Advanced TMDB search still redirected to login (TPDB Pro is required for that)."
        )
    emit(None, f"ThePosterDB: imported {len(rows)} browser cookie(s) — HTML session saved")
    return {
        "ok": True,
        "htmlOnly": True,
        "username": user,
        "cookieCount": len(rows),
        "hasCfClearance": "cf_clearance" in names,
        "via": "browser-cookies",
        "warning": warning,
        "cloudflare": bool(inspect.get("cloudflare")),
    }


def _posterdb_extract_login_error(html: str) -> str:
    soup = BeautifulSoup(html or "", "html.parser")
    for selector in (".invalid-feedback", ".alert-danger", ".text-danger", "[role='alert']"):
        for node in soup.select(selector):
            text = node.get_text(" ", strip=True)
            if text and len(text) < 240:
                return text
    match = re.search(
        r"(these credentials do not match|invalid credentials|too many login attempts|throttle|recaptcha|captcha)[^.<]{0,120}",
        html or "",
        flags=re.I,
    )
    if match:
        return match.group(0).strip()
    return ""


def _posterdb_xsrf_headers(session: requests.Session) -> dict[str, str]:
    headers = {
        "Referer": "https://theposterdb.com/login",
        "Origin": "https://theposterdb.com",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    token = ""
    for cookie in session.cookies:
        if cookie.name == "XSRF-TOKEN":
            try:
                token = unquote(cookie.value or "")
            except Exception:
                token = cookie.value or ""
            break
    if token:
        headers["X-XSRF-TOKEN"] = token
        headers["X-CSRF-TOKEN"] = token
    return headers


def _posterdb_session_user_agent(session: requests.Session | None) -> str:
    if session is None:
        return _POSTERDB_UA
    try:
        ua = str(session.headers.get("User-Agent") or "").strip()
    except Exception:
        ua = ""
    return ua or _POSTERDB_UA


def _posterdb_advanced_search_get(
    session: requests.Session,
    params: dict,
    *,
    timeout: float = 45,
) -> requests.Response:
    """GET TPDB id-search. The /search/advanced form 404s; results still exist, /search is the fallback."""
    headers = {
        "User-Agent": _posterdb_session_user_agent(session),
        "Referer": "https://theposterdb.com/search",
        "Accept": "text/html,application/xhtml+xml",
    }
    last: requests.Response | None = None
    for url in _POSTERDB_ADVANCED_SEARCH_URLS:
        _posterdb_throttle(authenticated=True)
        with _POSTERDB_HTTP_LOCK:
            last = session.get(
                url,
                params=params,
                timeout=timeout,
                allow_redirects=True,
                headers=headers,
            )
        if last is None:
            continue
        if last.status_code == 404:
            continue
        # Old /search/advanced/results still exists but may only bounce guests
        # to /login even with a valid session; try /search before giving up.
        if "theposterdb.com/login" in str(last.url or "").lower():
            continue
        if last.status_code >= 400 and last.status_code not in {403, 429, 503}:
            continue
        return last
    assert last is not None
    return last


def _posterdb_inspect_session(
    session: requests.Session,
    *,
    config: dict | None = None,
    quiet: bool = False,
) -> dict:
    """Probe whether cookies unlock TPDB advanced search (and whether we are signed in at all)."""
    try:
        response = _posterdb_advanced_search_get(
            session,
            {"category": "Shows", "tmdb_id": "97546"},
            timeout=45,
        )
    except Exception as exc:
        if not quiet:
            emit(None, f"ThePosterDB session check error: {exc}")
        return {"ok": False, "error": str(exc)}
    url = str(response.url or "")
    status = int(response.status_code or 0)
    if _posterdb_page_looks_like_challenge(response.text, url) or status in {403, 429, 503}:
        if not quiet:
            emit(None, "ThePosterDB session check hit a Cloudflare challenge page.")
        return {"ok": False, "cloudflare": True, "status": status, "url": url}
    if "theposterdb.com/login" in url.lower():
        homepage_ok = False
        try:
            _posterdb_throttle(authenticated=True)
            with _POSTERDB_HTTP_LOCK:
                home = session.get(
                    "https://theposterdb.com/",
                    timeout=30,
                    allow_redirects=True,
                    headers={
                        "User-Agent": _posterdb_session_user_agent(session),
                        "Accept": "text/html,application/xhtml+xml",
                    },
                )
            homepage_ok = _posterdb_html_looks_logged_in(home.text, str(home.url or ""))
        except Exception:
            homepage_ok = False
        return {
            "ok": False,
            "loggedIn": homepage_ok,
            "loginRedirect": True,
            "status": status,
            "url": url,
        }
    if status >= 400:
        return {"ok": False, "status": status, "url": url}
    return {"ok": True, "status": status, "url": url}


def _posterdb_session_looks_logged_in(
    session: requests.Session,
    *,
    config: dict | None = None,
    quiet: bool = False,
) -> bool:
    """Confirm cookies actually unlock advanced search (not just a soft login redirect)."""
    return bool(_posterdb_inspect_session(session, config=config, quiet=quiet).get("ok"))


def _posterdb_http_client(config: dict | None = None) -> requests.Session | type(requests):
    """Return an authenticated TPDB session when a saved cookie session or password login is available."""
    config = config if isinstance(config, dict) else {}
    user = str(config.get("tpdb_username") or config.get("tpdb_login") or "").strip()
    password = str(config.get("tpdb_password") or "").strip()
    has_creds = bool(user and password and password != "********")
    cache_key = _posterdb_session_cache_key(user, password) if has_creds else ""

    # Prefer a saved browser-cookie session even after password login is in
    # Cloudflare cooldown, and even if “Use TPDB login” is off — that is the
    # documented Docker/VPS workaround for HTML pages like /feed.
    if cache_key:
        cached = _POSTERDB_SESSIONS.get(cache_key)
        if cached is not None:
            return cached
        restored = _posterdb_load_session_file(config, cache_key)
        if restored is not None:
            _POSTERDB_SESSIONS[cache_key] = restored
            emit(None, "ThePosterDB: restored saved login session")
            return restored

    if not _posterdb_should_use_login(config) or not has_creds:
        return requests

    failed_until = float(_POSTERDB_LOGIN_FAILED_UNTIL.get(cache_key) or 0)
    if failed_until > time.time():
        return requests

    session = requests.Session()
    session.headers.update({"User-Agent": _POSTERDB_UA})
    try:
        _posterdb_throttle(authenticated=True)
        with _POSTERDB_HTTP_LOCK:
            login_page = session.get(
                "https://theposterdb.com/login",
                timeout=60,
                headers={
                    "User-Agent": _POSTERDB_UA,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                },
            )
        if _posterdb_page_looks_like_challenge(login_page.text, str(login_page.url or "")):
            msg = _posterdb_cloudflare_help()
            emit(None, msg)
            _posterdb_mark_login_failed(cache_key, msg)
            return requests
        login_soup = BeautifulSoup(login_page.text, "html.parser")
        token_node = login_soup.find("input", {"name": "_token"})
        token = str(token_node.get("value") or "") if token_node else ""
        if not token:
            msg = (
                "ThePosterDB login page had no CSRF token (Cloudflare interstitial). "
                + _posterdb_cloudflare_help()
            )
            emit(None, msg)
            _posterdb_mark_login_failed(cache_key, msg)
            return requests

        _posterdb_throttle(authenticated=True)
        post_headers = _posterdb_xsrf_headers(session)
        with _POSTERDB_HTTP_LOCK:
            response = session.post(
                "https://theposterdb.com/login",
                data={
                    "_token": token,
                    "login": user,
                    "password": password,
                    "remember": "on",
                },
                timeout=60,
                allow_redirects=True,
                headers=post_headers,
            )
        final_url = str(response.url or "").lower()
        still_on_login = "theposterdb.com/login" in final_url
        if still_on_login or response.status_code >= 400:
            detail = _posterdb_extract_login_error(response.text) or f"HTTP {response.status_code}"
            if _posterdb_page_looks_like_challenge(response.text, final_url):
                detail = _posterdb_cloudflare_help()
                msg = detail
            else:
                msg = f"ThePosterDB login failed — {detail}"
            emit(None, msg)
            _posterdb_mark_login_failed(cache_key, msg)
            return requests

        if not _posterdb_session_looks_logged_in(session, config=config):
            msg = (
                "ThePosterDB login appeared to succeed but advanced search still redirects to login. "
                "Check username/password and TPDB Pro / advanced search access."
            )
            emit(None, msg)
            _posterdb_mark_login_failed(cache_key, msg)
            return requests

        _POSTERDB_SESSIONS[cache_key] = session
        _POSTERDB_LOGIN_FAILED_UNTIL.pop(cache_key, None)
        _posterdb_save_session_file(config, cache_key, session)
        emit(None, "ThePosterDB login OK (session verified + saved)")
        return session
    except Exception as exc:
        msg = f"ThePosterDB login error: {exc}"
        emit(None, msg)
        _posterdb_mark_login_failed(cache_key, msg)
        return requests


def _posterdb_probe_advanced_search(session: requests.Session, *, config: dict | None = None) -> dict:
    """Run the Ted Lasso TMDB probe against an authenticated session."""
    response = _posterdb_advanced_search_get(
        session,
        {"category": "Shows", "tmdb_id": "97546"},
        timeout=60,
    )
    if _posterdb_page_looks_like_challenge(response.text, str(response.url or "")):
        return {"ok": False, "cloudflare": True, "error": _posterdb_cloudflare_help()}
    if "theposterdb.com/login" in str(response.url or "").lower():
        return {"ok": False, "error": "ThePosterDB session expired or login was rejected."}
    soup = BeautifulSoup(response.text, "html.parser")
    titles = _parse_posterdb_title_links(soup, limit=8)
    matched = None
    for item in titles:
        url = str(item.get("url") or "")
        if not url:
            continue
        try:
            probe = _posterdb_probe_title_page(url, config=config)
        except Exception:
            continue
        if str(probe.get("mediaId") or "") == "97546":
            matched = item
            break
    if matched:
        return {"ok": True, "sampleTitle": matched.get("title"), "resultCount": len(titles)}
    if titles:
        return {
            "ok": True,
            "warning": (
                "ThePosterDB login OK. Advanced search responded, but the Ted Lasso TMDB probe "
                "did not match — canonical TMDB resolve may still need TPDB Pro."
            ),
            "resultCount": len(titles),
        }
    return {
        "ok": False,
        "error": (
            "ThePosterDB login may have succeeded, but advanced TMDB search returned no title pages. "
            "Check credentials and whether your TPDB account includes advanced search (Pro)."
        ),
        "resultCount": 0,
    }


def test_posterdb_login(config: dict | None = None, *, force_fresh: bool = False) -> dict:
    """Verify TPDB credentials / saved browser session (advanced search).

    Prefer validating an existing cookie session first — forcing a password re-login
    from Docker often hits Cloudflare and destroys a working imported session.
    """
    config = config if isinstance(config, dict) else {}
    user = str(config.get("tpdb_username") or config.get("tpdb_login") or "").strip()
    password = str(config.get("tpdb_password") or "").strip()
    if not user or not password or password == "********":
        return {"ok": False, "configured": False, "error": "TPDB username and password are not configured."}
    cache_key = _posterdb_session_cache_key(user, password)
    force_fresh = force_fresh or bool(config.get("forceFreshLogin") or config.get("force_fresh_login"))

    if not force_fresh:
        restored = _posterdb_load_session_file(config, cache_key)
        if restored is not None:
            _POSTERDB_SESSIONS[cache_key] = restored
            probe = _posterdb_probe_advanced_search(restored, config=config)
            if probe.get("ok"):
                return {
                    "ok": True,
                    "configured": True,
                    "username": user,
                    "via": "saved-session",
                    **{k: v for k, v in probe.items() if k != "ok"},
                }

    if force_fresh:
        _posterdb_invalidate_sessions(user)
        path = _posterdb_session_path(config)
        if path and os.path.isfile(path):
            try:
                os.remove(path)
            except Exception:
                pass

    session = _posterdb_http_client(config)
    if not isinstance(session, requests.Session):
        detail = _posterdb_take_login_error() or "ThePosterDB login failed — check TPDB username/password."
        cloudflare = "cloudflare" in detail.lower()
        return {"ok": False, "configured": True, "cloudflare": cloudflare, "error": detail}

    probe = _posterdb_probe_advanced_search(session, config=config)
    if not probe.get("ok"):
        if probe.get("cloudflare"):
            return {"ok": False, "configured": True, "cloudflare": True, "error": probe.get("error")}
        _posterdb_invalidate_sessions(user)
        return {"ok": False, "configured": True, "error": probe.get("error") or "TPDB login failed"}
    return {
        "ok": True,
        "configured": True,
        "username": user,
        "via": "password-login",
        **{k: v for k, v in probe.items() if k != "ok"},
    }


_CLOUDFLARE_ORIGIN_HINTS = {
    520: "origin returned an unknown error",
    521: "the origin web server is down",
    522: "connection to origin timed out",
    523: "origin is unreachable",
    524: "origin timed out",
    525: "SSL handshake with origin failed",
    526: "origin SSL certificate is invalid",
    527: "Railgun error",
    530: "origin DNS failed or origin is unreachable",
}


def _page_host_label(url: str) -> str:
    if _url_host_matches(url, "mediux.pro"):
        return "MediUX"
    if _url_host_matches(url, "theposterdb.com"):
        return "ThePosterDB"
    return "The poster site"


def _page_retrieve_error(
    url: str,
    *,
    status_code: int | None = None,
    cause: str | None = None,
) -> str:
    host = _page_host_label(url)
    code = int(status_code) if status_code is not None else None
    if code in _CLOUDFLARE_ORIGIN_HINTS:
        hint = _CLOUDFLARE_ORIGIN_HINTS[code]
        return (
            f"{host} is temporarily unreachable (Cloudflare {code}: {hint}). "
            f"This is {host}'s site, not the portal. Try again in a few minutes. "
            f"Status code: {code}"
        )
    if code is not None:
        return f"Failed to retrieve the page from {host}. Status code: {code}"
    if cause:
        return f"Failed to retrieve the page from {host}: {cause}"
    return f"Failed to retrieve the page from {host}."


def cook_soup(
    url: str,
    *,
    config: dict | None = None,
    timeout: float | None = None,
    retries: int = 3,
) -> BeautifulSoup:
    path = (urlparse(str(url or "")).path or "").lower()
    wait = 20 if timeout is None and _url_host_matches(url, "theposterdb.com") and "/search" in path else timeout
    if wait is None:
        wait = 60
    is_tpdb = _url_host_matches(url, "theposterdb.com")
    client = _posterdb_http_client(config) if is_tpdb else requests
    authenticated = isinstance(client, requests.Session)
    ua = _posterdb_session_user_agent(client if authenticated else None)
    headers = {
        "User-Agent": ua,
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": "Windows",
    }
    attempts = max(1, int(retries or 1))
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            if is_tpdb:
                _posterdb_throttle(authenticated=authenticated)
            if isinstance(client, requests.Session):
                with _POSTERDB_HTTP_LOCK:
                    response = client.get(url, headers=headers, timeout=wait)
            else:
                response = requests.get(url, headers=headers, timeout=wait)
            if response.status_code == 200 or (response.status_code == 500 and "mediux.pro" in url):
                return BeautifulSoup(response.text, "html.parser")
            # 520–530 are Cloudflare origin/edge failures — often transient on MediUX/TPDB.
            if response.status_code in {429, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530} and attempt + 1 < attempts:
                # TPDB rate-limit: honor a longer cooldown than generic retries.
                if is_tpdb and response.status_code == 429:
                    retry_after = None
                    try:
                        retry_after = float(response.headers.get("Retry-After") or 0) or None
                    except Exception:
                        retry_after = None
                    _posterdb_note_rate_limit(retry_after)
                    cool = 8.0
                else:
                    cool = 1.25 * (attempt + 1)
                time.sleep(cool)
                continue
            raise RuntimeError(_page_retrieve_error(url, status_code=response.status_code))
        except (requests.Timeout, requests.ConnectionError) as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(1.0 * (attempt + 1))
                continue
            break
    if last_error:
        raise RuntimeError(_page_retrieve_error(url, cause=str(last_error))) from last_error
    raise RuntimeError(_page_retrieve_error(url))


_POSTERDB_RESOLVE_CACHE: dict[str, tuple[float, Optional[dict]]] = {}
_POSTERDB_RESOLVE_CACHE_TTL_S = 10 * 60
_POSTERDB_RESOLVE_NEGATIVE_TTL_S = 90
_POSTERDB_RESOLVE_LAST_ERROR: Optional[str] = None


def _posterdb_note_resolve_error(message: str) -> None:
    """Remember the most useful why-resolve-failed note for the next raised error."""
    global _POSTERDB_RESOLVE_LAST_ERROR
    text = str(message or "").strip()
    if text:
        _POSTERDB_RESOLVE_LAST_ERROR = text


def _posterdb_take_resolve_error() -> Optional[str]:
    global _POSTERDB_RESOLVE_LAST_ERROR
    text = _POSTERDB_RESOLVE_LAST_ERROR
    _POSTERDB_RESOLVE_LAST_ERROR = None
    return text


def _posterdb_resolve_cache_key(
    *,
    title: str,
    year: int | None,
    tmdb_id: str | None,
    imdb_id: str | None,
    tvdb_id: str | None,
    media_type: str,
    authenticated: bool = False,
) -> str:
    return "|".join([
        str(title or "").strip().lower(),
        str(year or ""),
        str(tmdb_id or ""),
        str(imdb_id or ""),
        str(tvdb_id or ""),
        str(media_type or "").strip().lower(),
        "auth" if authenticated else "public",
    ])


def _posterdb_resolve_cache_get(key: str) -> tuple[bool, Optional[dict]]:
    hit = _POSTERDB_RESOLVE_CACHE.get(key)
    if not hit:
        return False, None
    at, value = hit
    ttl = _POSTERDB_RESOLVE_NEGATIVE_TTL_S if value is None else _POSTERDB_RESOLVE_CACHE_TTL_S
    if (time.time() - at) > ttl:
        _POSTERDB_RESOLVE_CACHE.pop(key, None)
        return False, None
    return True, value


def _posterdb_resolve_cache_set(key: str, value: Optional[dict]) -> None:
    # Never negative-cache — auth flakes / empty advanced search must not poison retries.
    if value is None:
        _POSTERDB_RESOLVE_CACHE.pop(key, None)
        return
    _POSTERDB_RESOLVE_CACHE[key] = (time.time(), value)
    # Bound memory — drop oldest entries when oversized.
    if len(_POSTERDB_RESOLVE_CACHE) > 128:
        oldest = sorted(_POSTERDB_RESOLVE_CACHE.items(), key=lambda item: item[1][0])[:32]
        for stale_key, _ in oldest:
            _POSTERDB_RESOLVE_CACHE.pop(stale_key, None)


def _posterdb_has_credentials(config: dict | None) -> bool:
    config = config if isinstance(config, dict) else {}
    user = str(config.get("tpdb_username") or config.get("tpdb_login") or "").strip()
    password = str(config.get("tpdb_password") or "").strip()
    return bool(user and password and password != "********")


def _posterdb_should_use_login(config: dict | None = None) -> bool:
    """Whether to attempt authenticated advanced search (optional — public search works without it)."""
    config = config if isinstance(config, dict) else {}
    if not _posterdb_has_credentials(config):
        return False
    raw = config.get("tpdbUseLogin", config.get("tpdb_use_login", True))
    if raw is False or raw == 0:
        return False
    if isinstance(raw, str) and raw.strip().lower() in {"", "0", "false", "off", "no"}:
        return False
    return True


def _posterdb_public_only_config(config: dict | None = None) -> dict:
    """Copy config with login disabled so workers stop retrying Cloudflare-blocked auth."""
    next_config = dict(config or {})
    next_config["tpdbUseLogin"] = False
    next_config["tpdb_use_login"] = False
    return next_config


def _posterdb_search_terms_from_hint(title: str) -> list[str]:
    """Build several TPDB text-search terms — franchise spin-offs rarely match one string."""
    bare = re.sub(r"\s*\(\s*(?:\d{4}|n/a)\s*\)\s*$", "", str(title or "").strip(), flags=re.I).strip()
    terms: list[str] = []

    def add(value: str) -> None:
        text = str(value or "").strip()
        if not text or len(text) < 3:
            return
        key = text.lower()
        if any(key == existing.lower() for existing in terms):
            return
        terms.append(text)

    add(bare)
    if ":" in bare:
        add(bare.rsplit(":", 1)[-1].strip())
    spinoff = re.match(r"^power book\s+(?:ii|iii|iv|v|\d+)\s*:\s*(.+)$", bare, re.I)
    if spinoff:
        add(spinoff.group(1).strip())
    generic = re.match(r"^power book[^:]*:\s*(.+)$", bare, re.I)
    if generic:
        add(generic.group(1).strip())
    return terms[:5]


def parse_string_to_dict(input_string: str) -> dict:
    input_string = input_string.replace("\\\\\\\"", "")
    input_string = input_string.replace("\\", "")
    input_string = input_string.replace("u0026", "&")
    json_start_index = input_string.find("{")
    json_end_index = input_string.rfind("}")
    json_data = input_string[json_start_index : json_end_index + 1]
    return json.loads(json_data)


_REGION_TITLE_SUFFIXES = {
    "us", "uk", "au", "ca", "nz", "fr", "de", "jp", "kr", "cn", "br", "mx", "es", "it",
}


def _strip_collection_title(title: str) -> str:
    text = str(title or "").strip()
    text = re.sub(r"\s*\((?:\d{4}|n/a)\)\s*$", "", text, flags=re.I).strip()
    text = re.sub(r"\s+(?:the\s+)?(?:complete\s+)?(?:movie\s+|film\s+)?collection\s*$", "", text, flags=re.I).strip()
    text = re.sub(r"\s+box\s*sets?\s*$", "", text, flags=re.I).strip()
    return text or str(title or "").strip()


def _library_titles(libraries) -> str:
    names = []
    for lib in libraries or []:
        title = getattr(lib, "title", None) or str(lib)
        if title:
            names.append(str(title))
    return ", ".join(names) if names else "configured libraries"


def _normalize_plex_title_key(title: str) -> str:
    text = str(title or "").strip().lower()
    text = re.sub(r"\(\s*(?:\d{4}|n/a)\s*\)\s*$", "", text, flags=re.I).strip()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _plex_title_tokens(title: str) -> list[str]:
    key = _normalize_plex_title_key(_strip_collection_title(title))
    tokens = [part for part in key.split() if part and part not in {"collection", "collections", "boxset"}]
    articles = {"the", "a", "an"}
    if tokens and tokens[0] in articles:
        tokens = tokens[1:]
    if tokens and tokens[-1] in _REGION_TITLE_SUFFIXES:
        tokens = tokens[:-1]
    return tokens


def _plex_titles_exactly_match(left: str, right: str) -> bool:
    """Require the same work — 'Sisters' must not match 'Barbie & Her Sisters…'."""
    left_key = _normalize_plex_title_key(left)
    right_key = _normalize_plex_title_key(right)
    if not left_key or not right_key:
        return False
    if left_key == right_key:
        return True
    articles = {"the", "a", "an"}
    left_tokens = left_key.split()
    right_tokens = right_key.split()
    if left_tokens and left_tokens[0] in articles:
        left_tokens = left_tokens[1:]
    if right_tokens and right_tokens[0] in articles:
        right_tokens = right_tokens[1:]
    return bool(left_tokens) and left_tokens == right_tokens


def _plex_titles_loosely_match(left: str, right: str) -> bool:
    """Exact match, plus region suffixes and trailing 'Collection'."""
    if _plex_titles_exactly_match(left, right):
        return True
    left_tokens = _plex_title_tokens(left)
    right_tokens = _plex_title_tokens(right)
    if not left_tokens or not right_tokens:
        return False
    if left_tokens == right_tokens:
        return True
    shorter, longer = (left_tokens, right_tokens) if len(left_tokens) <= len(right_tokens) else (right_tokens, left_tokens)
    extra = longer[len(shorter):]
    if longer[:len(shorter)] != shorter or not extra:
        return False
    return all(part in _REGION_TITLE_SUFFIXES or (part.isdigit() and len(part) == 4) for part in extra)


def _is_collection_cover_title(title: str) -> bool:
    """True for boxset/collection covers, not per-title posters inside a set."""
    text = str(title or "").strip()
    if not text:
        return False
    without_year = re.sub(r"\s*\((?:\d{4}|n/a)\)\s*$", "", text, flags=re.I).strip()
    stripped = _strip_collection_title(text)
    return bool(stripped) and stripped.casefold() != without_year.casefold()


def _fetch_plex_item_by_rating_key(plex, rating_key: str):
    key = str(rating_key or "").strip()
    if not plex or not key:
        return None
    try:
        return plex.fetchItem(int(key))
    except Exception:
        pass
    try:
        return plex.fetchItem(f"/library/metadata/{key}")
    except Exception:
        return None


def find_in_library(library, poster, *, plex=None, rating_key: str | None = None):
    """Locate Plex library items for a poster.

    Plex Section.get()/search() are fuzzy — ``Sisters (2015)`` can return
    ``Barbie & Her Sisters in the Great Puppy Adventure``. Require a normalized
    title match (region suffixes like ``(US)`` and trailing ``Collection`` are
    allowed), and prefer an explicit ratingKey when given.
    """
    hint_key = str(rating_key or poster.get("_ratingKey") or "").strip() or None
    plex_server = plex or poster.get("_plex")
    want_title = str(poster.get("title") or "").strip()
    # Library applies stamp the Plex item title — prefer that over scraped set titles.
    hint_title = str(poster.get("_plexHintTitle") or "").strip()
    pin_title = hint_title or want_title
    if hint_key and plex_server is not None:
        hit = _fetch_plex_item_by_rating_key(plex_server, hint_key)
        if hit is not None:
            hit_title = str(getattr(hit, "title", None) or "").strip()
            # Trust the pinned library item when it matches the library title (or poster title).
            if not pin_title or _plex_titles_exactly_match(pin_title, hit_title):
                return [hit]
            # Still trust an explicit library pin when the hint title matches the Plex item,
            # even if the scraped poster title differs (common for TPDB set naming).
            if hint_title and _plex_titles_exactly_match(hint_title, hit_title):
                return [hit]

    if not want_title and not hint_title:
        return None
    search_title = want_title or hint_title
    stripped_title = _strip_collection_title(search_title)
    want_year = poster.get("year")
    try:
        want_year_int = int(want_year) if want_year is not None else None
    except Exception:
        want_year_int = None

    year_hits = []
    title_hits = []
    seen_keys: set[str] = set()
    search_titles = [search_title]
    if stripped_title and stripped_title.casefold() != search_title.casefold():
        search_titles.append(stripped_title)
    for lib in library or []:
        try:
            candidates = []
            for query in search_titles:
                try:
                    candidates.extend(list(lib.search(title=query) or []))
                except Exception:
                    pass
                if want_year_int is not None:
                    try:
                        candidates.extend(list(lib.search(title=query, year=want_year_int) or []))
                    except Exception:
                        pass
                try:
                    got = lib.get(query)
                    if got is not None:
                        candidates.insert(0, got)
                except Exception:
                    pass
                if want_year_int is not None:
                    try:
                        got_year = lib.get(query, year=want_year_int)
                        if got_year is not None:
                            candidates.insert(0, got_year)
                    except Exception:
                        pass

            for item in candidates:
                item_key = str(getattr(item, "ratingKey", None) or id(item))
                if item_key in seen_keys:
                    continue
                item_title = str(getattr(item, "title", None) or "").strip()
                if not _plex_titles_loosely_match(search_title, item_title) and not (
                    stripped_title and _plex_titles_loosely_match(stripped_title, item_title)
                ):
                    continue
                item_year = getattr(item, "year", None)
                year_ok = True
                if want_year_int is not None and item_year is not None:
                    try:
                        year_ok = int(item_year) == want_year_int
                    except Exception:
                        year_ok = True
                seen_keys.add(item_key)
                if year_ok:
                    year_hits.append(item)
                else:
                    title_hits.append(item)
        except Exception:
            pass
    return year_hits or title_hits or None


def upload_tv_poster(poster, tv, progress: ProgressFn = None) -> dict:
    result = {
        "title": poster.get("title"),
        "kind": "show",
        "ok": False,
        "message": "",
        "id": poster.get("_assetId") or asset_id("show", poster),
        "season": poster.get("season"),
        "episode": poster.get("episode"),
    }
    tv_show_items = find_in_library(tv, poster)
    if not tv_show_items:
        result["message"] = f"{poster['title']} not found in any library."
        emit(progress, result["message"])
        return result

    for tv_show in tv_show_items:
        try:
            if poster["season"] == "Cover":
                upload_target = tv_show
                msg = f"Uploaded cover art for {poster['title']} in {tv_show.librarySectionTitle}."
            elif poster["season"] == 0:
                if poster["episode"] == "Cover" or poster["episode"] is None:
                    upload_target = tv_show.season("Specials")
                    msg = f"Uploaded art for {poster['title']} - Specials in {tv_show.librarySectionTitle}."
                else:
                    try:
                        upload_target = tv_show.season("Specials").episode(poster["episode"])
                        msg = (
                            f"Uploaded art for {poster['title']} - Specials "
                            f"Episode {poster['episode']} in {tv_show.librarySectionTitle}."
                        )
                    except Exception:
                        result["message"] = (
                            f"{poster['title']} - Specials Episode {poster['episode']} not found, skipping."
                        )
                        emit(progress, result["message"])
                        continue
            elif poster["season"] == "Backdrop":
                upload_target = tv_show
                msg = f"Uploaded background art for {poster['title']} in {tv_show.librarySectionTitle}."
            elif poster["season"] >= 1:
                if poster["episode"] == "Cover" or poster["episode"] is None:
                    upload_target = tv_show.season(poster["season"])
                    msg = (
                        f"Uploaded art for {poster['title']} - Season {poster['season']} "
                        f"in {tv_show.librarySectionTitle}."
                    )
                else:
                    try:
                        upload_target = tv_show.season(poster["season"]).episode(poster["episode"])
                        msg = (
                            f"Uploaded art for {poster['title']} - Season {poster['season']} "
                            f"Episode {poster['episode']} in {tv_show.librarySectionTitle}."
                        )
                    except Exception:
                        result["message"] = (
                            f"{poster['title']} - Season {poster['season']} Episode "
                            f"{poster['episode']} not found, skipping."
                        )
                        emit(progress, result["message"])
                        continue
            else:
                result["message"] = f"Unhandled season value for {poster['title']}"
                emit(progress, result["message"])
                continue

            apply_poster_or_art(upload_target, poster, art=(poster["season"] == "Backdrop"), progress=progress)
            if poster["season"] != "Backdrop":
                clear_kometa_overlay(upload_target, config=poster.get("_config"), progress=progress)
            result["ok"] = True
            result["message"] = msg
            emit(progress, msg)
        except Exception as exc:
            result["message"] = (
                f"{poster['title']} - Season {poster.get('season')} upload failed "
                f"in {tv_show.librarySectionTitle}: {exc}"
            )
            emit(progress, result["message"])
    return result


def upload_movie_poster(poster, movies, progress: ProgressFn = None) -> dict:
    result = {
        "title": poster.get("title"),
        "kind": "movie",
        "ok": False,
        "message": "",
        "id": poster.get("_assetId") or asset_id("movie", poster),
    }
    movie_items = find_in_library(movies, poster)
    if not movie_items:
        result["message"] = f"{poster['title']} not found in any library."
        emit(progress, result["message"])
        return result
    for movie_item in movie_items:
        try:
            as_background = (
                poster.get("season") == "Backdrop"
                or asset_file_type("movie", poster) == "background"
            )
            apply_poster_or_art(movie_item, poster, art=as_background, progress=progress)
            clear_kometa_overlay(movie_item, config=poster.get("_config"), progress=progress)
            msg = (
                f'Uploaded background for {poster["title"]} in {movie_item.librarySectionTitle}.'
                if as_background
                else f'Uploaded art for {poster["title"]} in {movie_item.librarySectionTitle}.'
            )
            result["ok"] = True
            result["message"] = msg
            emit(progress, msg)
        except Exception as exc:
            result["message"] = f'Unable to upload art for {poster["title"]}: {exc}'
            emit(progress, result["message"])
    return result


def upload_collection_poster(poster, movies, progress: ProgressFn = None, tv=None) -> dict:
    """Apply a collection-set asset to its matching movie/show — never the Plex collection.

    Boxset/collection *covers* are skipped. Per-title posters tagged Collection on
    TPDB/MediUX are matched by that poster's own title.
    """
    result = {
        "title": poster.get("title"),
        "kind": "collection",
        "ok": False,
        "message": "",
        "id": poster.get("_assetId") or asset_id("collection", poster),
    }
    title = poster.get("title") or "Untitled"
    if _is_collection_cover_title(title):
        result["ok"] = True
        result["skipped"] = True
        result["message"] = (
            f'Skipped collection cover “{title}” — not applied to Plex. '
            "Each title poster in the set is applied to its matching movie/show."
        )
        emit(progress, result["message"])
        return result
    items = list(find_in_library(movies, poster) or [])
    if not items:
        items = list(find_in_library(tv, poster) or [])
    if not items:
        result["message"] = f"{title} not found in any library."
        emit(progress, result["message"])
        return result
    for item in items:
        try:
            as_background = (
                poster.get("season") == "Backdrop"
                or asset_file_type("collection", poster) == "background"
            )
            apply_poster_or_art(item, poster, art=as_background, progress=progress)
            clear_kometa_overlay(item, config=poster.get("_config"), progress=progress)
            msg = (
                f'Uploaded art for {title} on {getattr(item, "title", title)} '
                f'in {getattr(item, "librarySectionTitle", "")}.'
            )
            result["ok"] = True
            result["message"] = msg
            emit(progress, msg)
        except Exception as exc:
            result["message"] = f"Unable to upload art for {title}: {exc}"
            emit(progress, result["message"])
    return result


def scrape_posterdb_set_link(soup) -> Optional[str]:
    """Resolve a TPDb /poster/{id} page to its parent /set/{id} URL.

    Live TPDb markup uses a “View Set” button (often btn-outline-info).
    Older pages used a.rounded.view_all — keep that as a fallback.
    """
    if not soup:
        return None

    def _set_href(href: str) -> Optional[str]:
        value = str(href or "").strip()
        if not re.search(r"/set/\d+", value, re.I):
            return None
        return _absolute_url("https://theposterdb.com", value.split("?")[0])

    for anchor in soup.find_all("a", href=True):
        text = anchor.get_text(" ", strip=True).lower()
        if "view set" not in text:
            continue
        resolved = _set_href(anchor.get("href"))
        if resolved:
            return resolved

    legacy = soup.find("a", class_=re.compile(r"\bview_all\b"), href=True)
    if legacy:
        resolved = _set_href(legacy.get("href"))
        if resolved:
            return resolved

    for anchor in soup.find_all("a", href=True):
        classes = " ".join(anchor.get("class") or []).lower()
        text = anchor.get_text(" ", strip=True).lower()
        if "btn-outline-info" not in classes and "view" not in text:
            continue
        resolved = _set_href(anchor.get("href"))
        if resolved:
            return resolved

    return None


def scrape_posterdb_single_poster(soup, poster_url: str = "") -> Tuple[list, list, list, dict]:
    """Fallback when a /poster/ page has no parent set link — treat as a 1-asset set."""
    movieposters: list = []
    showposters: list = []
    collectionposters: list = []
    page_meta: dict = {"user": extract_creator_from_soup(soup) if soup else None}

    poster_id = None
    match = re.search(r"/poster/(\d+)", str(poster_url or ""), re.I)
    if match:
        poster_id = match.group(1)
    if not poster_id and soup:
        node = soup.find(attrs={"data-poster-id": True})
        if node:
            poster_id = str(node.get("data-poster-id") or "").strip() or None
    if not poster_id:
        return movieposters, showposters, collectionposters, page_meta

    asset_url = f"https://theposterdb.com/api/assets/{poster_id}"
    title = None
    year = None
    media_type = "Movie"
    if soup:
        heading = soup.find(["h1", "h2", "h3"])
        if heading:
            title_text = heading.get_text(" ", strip=True)
            title_text = re.sub(r"\s+Poster\s*$", "", title_text, flags=re.I).strip()
            year_match = re.search(r"\((\d{4}|N/A)\)\s*$", title_text)
            if year_match and year_match.group(1).isdigit():
                year = int(year_match.group(1))
                title = re.sub(r"\s*\((?:\d{4}|N/A)\)\s*$", "", title_text).strip() or title_text
            else:
                title = title_text or None
        tip = soup.find("a", attrs={"data-toggle": "tooltip", "title": True})
        if tip:
            tip_title = str(tip.get("title") or "").strip()
            if tip_title in {"Movie", "Show", "Collection"}:
                media_type = tip_title
        og = soup.find("meta", attrs={"property": "og:title"})
        if not title and og and og.get("content"):
            title = re.sub(r"\s*\|\s*TPDb.*$", "", str(og.get("content")), flags=re.I).strip() or None

    parsed = parse_posterdb_caption(title or "")
    entry = {
        "title": parsed["title"] or title or f"Poster {poster_id}",
        "url": asset_url,
        "year": year if year is not None else parsed["year"],
        "source": "posterdb",
        "file_type": parsed["file_type"],
        "season": parsed["season"],
        "episode": None,
    }
    if media_type == "Show":
        if entry["season"] is None:
            entry["season"] = "Cover"
            entry["file_type"] = "show_cover"
        showposters.append(entry)
    elif media_type == "Collection":
        entry["season"] = None
        entry["file_type"] = None
        collectionposters.append(entry)
    else:
        entry["season"] = None
        entry["file_type"] = None
        movieposters.append(entry)

    page_meta.update({
        "title": title,
        "mediaType": "show" if showposters else ("movie" if movieposters else None),
        "resolvedUrl": str(poster_url or "").strip() or None,
    })
    return movieposters, showposters, collectionposters, page_meta


def scrape_posterd_user_info(soup) -> Optional[int]:
    try:
        span_tag = soup.find("span", class_="numCount")
        upload_count = int(span_tag["data-count"])
        return math.ceil(upload_count / 24)
    except Exception:
        return None


def scrape_posterdb(soup) -> Tuple[list, list, list]:
    movieposters = []
    showposters = []
    collectionposters = []
    poster_div = soup.find("div", class_="row d-flex flex-wrap m-0 w-100 mx-n1 mt-n1")
    if not poster_div:
        return movieposters, showposters, collectionposters
    posters = poster_div.find_all("div", class_="col-6 col-lg-2 p-1")
    for poster in posters:
        tip = poster.find(
            "a", class_="text-white", attrs={"data-toggle": "tooltip", "data-placement": "top"}
        )
        if not tip:
            continue
        media_type = tip.get("title")
        overlay_div = poster.find("div", class_="overlay")
        if not overlay_div or not overlay_div.get("data-poster-id"):
            continue
        poster_id = overlay_div.get("data-poster-id")
        poster_url = "https://theposterdb.com/api/assets/" + poster_id
        title_node = poster.find("p", class_="p-0 mb-1 text-break")
        title_p = title_node.get_text(" ", strip=True) if title_node else ""
        parsed = parse_posterdb_caption(title_p)

        if media_type == "Show":
            season = parsed["season"]
            file_type = parsed["file_type"]
            if season is None:
                season = "Cover"
                file_type = "show_cover"
            showposters.append(
                {
                    "title": parsed["title"] or title_p or f"Poster {poster_id}",
                    "url": poster_url,
                    "season": season,
                    "episode": None,
                    "year": parsed["year"],
                    "source": "posterdb",
                    "file_type": file_type,
                }
            )
        elif media_type == "Movie":
            movieposters.append(
                {
                    "title": parsed["title"] or title_p or f"Poster {poster_id}",
                    "url": poster_url,
                    "year": parsed["year"],
                    "source": "posterdb",
                }
            )
        elif media_type == "Collection":
            collectionposters.append(
                {
                    "title": parsed["title"] or title_p,
                    "url": poster_url,
                    "source": "posterdb",
                    "year": parsed["year"],
                }
            )
    return movieposters, showposters, collectionposters


def check_mediux_filter(mediux_filters: Optional[Sequence[str]], filter_name: str) -> bool:
    return filter_name in mediux_filters if mediux_filters else True


def _pick_creator_username(value) -> Optional[str]:
    if isinstance(value, str):
        text = value.strip().lstrip("@")
        return text or None
    if isinstance(value, dict):
        for key in ("username", "user_name", "name", "handle", "slug", "display_name"):
            picked = _pick_creator_username(value.get(key))
            if picked:
                return picked
    return None


_CREATOR_PATH_SKIP = {"login", "signup", "register", "settings", "logout", "home"}


def _creator_from_user_href(href: str) -> Optional[str]:
    match = re.search(r"/user/([^/?#]+)", str(href or ""), re.I)
    if not match:
        return None
    user = unquote(match.group(1)).strip().lstrip("@")
    if not user or user.lower() in _CREATOR_PATH_SKIP:
        return None
    return user


def extract_creator_from_soup(soup) -> Optional[str]:
    if not soup:
        return None
    for anchor in soup.select("a[href*='/user/']"):
        user = _creator_from_user_href(anchor.get("href") or "")
        if user:
            return user
        text = (anchor.get_text(" ", strip=True) or "").strip().lstrip("@")
        if text and 1 < len(text) < 64 and text.lower() not in _CREATOR_PATH_SKIP:
            return text
    return None


def _extract_user_near_node(node, *, max_depth: int = 10) -> Optional[str]:
    """Find the creator for a MediUX set card without picking up siblings from the list parent."""
    best: Optional[str] = None
    current = node
    for _ in range(max(0, int(max_depth)) + 1):
        if current is None:
            break
        users: list[str] = []
        seen: set[str] = set()
        if hasattr(current, "find_all"):
            for anchor in current.find_all("a", href=True):
                user = _creator_from_user_href(anchor.get("href") or "")
                if not user:
                    continue
                key = user.lower()
                if key in seen:
                    continue
                seen.add(key)
                users.append(user)
        if len(users) == 1:
            best = users[0]
            classes = " ".join(current.get("class") or []) if hasattr(current, "get") else ""
            # MediUX title/set rows use a bordered card container.
            if "border-b" in classes or "text-card-foreground" in classes:
                return best
        elif len(users) > 1:
            return best
        current = getattr(current, "parent", None)
    return best


def _pick_id(value) -> Optional[str]:
    if value is None or value is False:
        return None
    text = str(value).strip()
    if not text or text.lower() in {"none", "null", "0"}:
        return None
    if text.isdigit() or text.replace("-", "").isalnum():
        return text
    return text or None


def extract_mediux_creator(data_dict, soup=None) -> Optional[str]:
    aset = (data_dict or {}).get("set") if isinstance(data_dict, dict) else None
    if isinstance(aset, dict):
        for key in ("user", "author", "owner", "created_by", "uploader", "profile", "creator"):
            picked = _pick_creator_username(aset.get(key))
            if picked:
                return picked
    return extract_creator_from_soup(soup)


def scrape_mediux(soup, mediux_filters: Optional[Sequence[str]] = None, progress: ProgressFn = None) -> Tuple[list, list, list, dict]:
    # Direct API assets — MediUX's /_next/image proxy now 403s scrapers/Plex (blank posters).
    base_url = "https://api.mediux.pro/assets/"
    scripts = soup.find_all("script")
    showposters = []
    movieposters = []
    collectionposters = []
    year = 0
    title = "Untitled"
    poster_data = None
    data_dict = None
    page_meta: dict = {"user": None, "title": None}

    for script in scripts:
        if "files" in script.text and "set" in script.text and "Set Link\\" not in script.text:
            try:
                data_dict = parse_string_to_dict(script.text)
                if "set" in data_dict and "files" in data_dict["set"]:
                    poster_data = data_dict["set"]["files"]
                    break
            except Exception:
                continue

    if not poster_data or not data_dict:
        raise RuntimeError("Could not parse MediUX set data from page")

    page_meta["user"] = extract_mediux_creator(data_dict, soup)
    try:
        aset = data_dict.get("set") or {}
        show = aset.get("show") or {}
        movie = aset.get("movie") or {}
        if isinstance(show, dict) and show.get("name"):
            page_meta["title"] = str(show.get("name") or "").strip() or None
            page_meta["tmdbId"] = _pick_id(show.get("id") or show.get("tmdb_id") or show.get("tmdbId"))
            page_meta["tvdbId"] = _pick_id(show.get("tvdb_id") or show.get("tvdbId") or show.get("tvdb"))
            page_meta["mediaType"] = "show"
        elif isinstance(movie, dict) and movie.get("title"):
            page_meta["title"] = str(movie.get("title") or "").strip() or None
            page_meta["tmdbId"] = _pick_id(movie.get("id") or movie.get("tmdb_id") or movie.get("tmdbId"))
            page_meta["tvdbId"] = _pick_id(movie.get("tvdb_id") or movie.get("tvdbId"))
            page_meta["mediaType"] = "movie"
        elif (aset.get("collection") or {}).get("collection_name"):
            page_meta["title"] = str(
                (aset.get("collection") or {}).get("collection_name") or ""
            ).strip() or None
    except Exception:
        pass

    media_type = None
    for data in poster_data:
        if (
            data.get("show_id") is not None
            or data.get("show_id_backdrop") is not None
            or data.get("episode_id") is not None
            or data.get("season_id") is not None
        ):
            media_type = "Show"
        else:
            media_type = "Movie"
    if media_type == "Show":
        page_meta["mediaType"] = "show"
    elif media_type == "Movie" and not page_meta.get("mediaType"):
        page_meta["mediaType"] = "movie"

    for data in poster_data:
        file_type = None
        season = None
        episode = None
        show_name = title

        if media_type == "Show":
            episodes = data_dict["set"]["show"]["seasons"]
            show_name = data_dict["set"]["show"]["name"]
            try:
                year = int(data_dict["set"]["show"]["first_air_date"][:4])
            except Exception:
                year = None

            if data.get("fileType") == "title_card":
                season = data["episode_id"]["season_id"]["season_number"]
                title = data["title"]
                try:
                    episode = int(title.rsplit(" E", 1)[1])
                except Exception:
                    emit(progress, f"Error getting episode number for {title}.")
                    episode = None
                file_type = "title_card"
            elif data.get("fileType") == "backdrop":
                season = "Backdrop"
                episode = None
                file_type = "background"
            elif data.get("season_id") is not None:
                season_id = data["season_id"]["id"]
                season_data = [episode for episode in episodes if episode["id"] == season_id][0]
                episode = "Cover"
                season = season_data["season_number"]
                file_type = "season_cover"
            elif data.get("show_id") is not None:
                season = "Cover"
                episode = None
                file_type = "show_cover"
            else:
                continue

        elif media_type == "Movie":
            file_type = None
            season = None
            movie_file = str(data.get("fileType") or data.get("file_type") or "").strip().lower()
            if movie_file in {"backdrop", "background"} or data.get("movie_id_backdrop") is not None:
                file_type = "background"
                season = "Backdrop"
            if data.get("movie_id"):
                if data_dict["set"].get("movie"):
                    title = data_dict["set"]["movie"]["title"]
                    year = int(data_dict["set"]["movie"]["release_date"][:4])
                elif data_dict["set"].get("collection"):
                    movie_id = data["movie_id"]["id"]
                    movies = data_dict["set"]["collection"]["movies"]
                    movie_data = [movie for movie in movies if movie["id"] == movie_id][0]
                    title = movie_data["title"]
                    year = int(movie_data["release_date"][:4])
            elif data.get("collection_id"):
                title = data_dict["set"]["collection"]["collection_name"]
            elif file_type == "background" and data_dict["set"].get("movie"):
                title = data_dict["set"]["movie"]["title"]
                try:
                    year = int(data_dict["set"]["movie"]["release_date"][:4])
                except Exception:
                    year = None

        image_stub = data["id"]
        poster_url = f"{base_url}{image_stub}"

        if media_type == "Show":
            showposter = {
                "title": show_name,
                "season": season,
                "episode": episode,
                "url": poster_url,
                "source": "mediux",
                "year": year,
                "file_type": file_type,
            }
            if check_mediux_filter(mediux_filters, file_type or ""):
                showposters.append(showposter)
            else:
                emit(progress, f"{show_name} - skipping. '{file_type}' is not in mediux_filters")
        elif media_type == "Movie":
            if "Collection" in str(title):
                collectionposters.append(
                    {
                        "title": title,
                        "url": poster_url,
                        "source": "mediux",
                        "season": season,
                        "file_type": file_type,
                    }
                )
            else:
                movie_row = {
                    "title": title,
                    "year": int(year) if year else None,
                    "url": poster_url,
                    "source": "mediux",
                    "season": season,
                    "file_type": file_type,
                }
                keep_type = file_type or "show_cover"
                if check_mediux_filter(mediux_filters, keep_type):
                    movieposters.append(movie_row)
                else:
                    emit(progress, f"{title} - skipping. '{keep_type}' is not in mediux_filters")

    if not page_meta.get("title"):
        for group in (showposters, movieposters, collectionposters):
            for poster in group:
                if poster.get("title"):
                    page_meta["title"] = str(poster.get("title") or "").strip() or None
                    break
            if page_meta.get("title"):
                break

    return movieposters, showposters, collectionposters, page_meta


def scrape(url: str, mediux_filters: Optional[Sequence[str]] = None, progress: ProgressFn = None) -> Tuple[list, list, list, dict]:
    if _url_host_matches(url, "theposterdb.com"):
        if "/set/" in url or "/user/" in url:
            soup = cook_soup(url)
            movieposters, showposters, collectionposters = scrape_posterdb(soup)
            title = None
            for group in (showposters, movieposters, collectionposters):
                for poster in group:
                    if poster.get("title"):
                        title = str(poster.get("title") or "").strip() or None
                        break
                if title:
                    break
            media_type = "show" if showposters else ("movie" if movieposters else None)
            return movieposters, showposters, collectionposters, {
                "user": extract_creator_from_soup(soup),
                "title": title,
                "mediaType": media_type,
            }
        if "/poster/" in url:
            soup = cook_soup(url)
            set_url = scrape_posterdb_set_link(soup)
            if set_url is None:
                # Some uploads are standalone — still allow preview/apply of the single asset.
                return scrape_posterdb_single_poster(soup, poster_url=url)
            set_soup = cook_soup(set_url)
            movieposters, showposters, collectionposters = scrape_posterdb(set_soup)
            title = None
            for group in (showposters, movieposters, collectionposters):
                for poster in group:
                    if poster.get("title"):
                        title = str(poster.get("title") or "").strip() or None
                        break
                if title:
                    break
            media_type = "show" if showposters else ("movie" if movieposters else None)
            return movieposters, showposters, collectionposters, {
                "user": extract_creator_from_soup(set_soup),
                "title": title,
                "mediaType": media_type,
                # Store the parent set so Recents reopen /set/… not the poster page.
                "resolvedUrl": set_url,
            }
        raise RuntimeError("Poster set not found. Check the link you are inputting.")
    if _url_host_matches(url, "mediux.pro") and "/sets" in str(url or ""):
        return scrape_mediux(cook_soup(url), mediux_filters=mediux_filters, progress=progress)
    raise RuntimeError("Poster set not found. Check the link you are inputting.")


def summarize_posters(movieposters, showposters, collectionposters) -> dict:
    return {
        "movies": len(movieposters),
        "shows": len(showposters),
        "collections": len(collectionposters),
        "total": len(movieposters) + len(showposters) + len(collectionposters),
        "samples": {
            "movies": [p.get("title") for p in movieposters[:8]],
            "shows": [p.get("title") for p in showposters[:8]],
            "collections": [p.get("title") for p in collectionposters[:8]],
        },
        "movieposters": movieposters,
        "showposters": showposters,
        "collectionposters": collectionposters,
    }


def parse_set_ref(url: str) -> dict:
    """Extract provider + set/poster id from a MediUX or ThePosterDB URL."""
    value = str(url or "").strip()
    provider = None
    set_id = None
    kind = None
    if _url_host_matches(value, "mediux.pro"):
        provider = "mediux"
        match = re.search(r"/sets?/(\d+)", value, re.I)
        if match:
            set_id = match.group(1)
            kind = "set"
    elif _url_host_matches(value, "theposterdb.com"):
        provider = "posterdb"
        match = re.search(r"/poster/(\d+)", value, re.I)
        if match:
            set_id = match.group(1)
            kind = "poster"
        else:
            match = re.search(r"/set/(\d+)", value, re.I)
            if match:
                set_id = match.group(1)
                kind = "set"
            elif "/user/" in lower:
                match = re.search(r"/user/([^/?#]+)", value, re.I)
                if match:
                    set_id = match.group(1)
                    kind = "user"
    return {"provider": provider, "setId": set_id, "kind": kind, "url": value}


def build_set_meta(
    url: str,
    movieposters=None,
    showposters=None,
    collectionposters=None,
    page_meta: Optional[dict] = None,
) -> dict:
    """Compact set summary: show/movie name + creator (not season pack labels)."""
    meta = page_meta if isinstance(page_meta, dict) else {}
    resolved = str(meta.get("resolvedUrl") or meta.get("resolved_url") or "").strip()
    canonical_url = resolved or str(url or "").strip()
    ref = parse_set_ref(canonical_url)
    title = str(meta.get("title") or "").strip() or None
    user = _pick_creator_username(meta.get("user"))
    thumb = ""
    for group in (showposters, movieposters, collectionposters):
        for poster in group or []:
            if not title and poster.get("title"):
                title = str(poster.get("title") or "").strip() or None
            if not thumb and poster.get("url"):
                thumb = str(poster.get("url") or "").strip()
            if title and thumb:
                break
        if title and thumb:
            break
    total = len(movieposters or []) + len(showposters or []) + len(collectionposters or [])
    if not title:
        if ref.get("setId"):
            title = f"Set {ref['setId']}"
        else:
            title = "Poster set"
    media_type = str(meta.get("mediaType") or meta.get("media_type") or "").strip().lower()
    if media_type in {"tv", "series", "shows", "show"}:
        media_type = "show"
    elif media_type in {"movies", "movie"}:
        media_type = "movie"
    elif showposters and not movieposters:
        media_type = "show"
    elif movieposters and not showposters:
        media_type = "movie"
    else:
        media_type = media_type or None
    return {
        "provider": ref.get("provider"),
        "setId": ref.get("setId"),
        "url": canonical_url or ref.get("url") or str(url or "").strip(),
        "title": title,
        "user": user,
        "tmdbId": _pick_id(meta.get("tmdbId") or meta.get("tmdb_id")),
        "tvdbId": _pick_id(meta.get("tvdbId") or meta.get("tvdb_id")),
        "mediaType": media_type,
        "thumbUrl": thumb,
        "assetCount": total or None,
    }


def match_show_target(tv_show, poster: dict) -> Tuple[bool, str]:
    season = poster.get("season")
    episode = poster.get("episode")
    section = getattr(tv_show, "librarySectionTitle", None) or "library"
    try:
        if season == "Cover" or season == "Backdrop":
            return True, section
        if season == 0:
            try:
                season_obj = tv_show.season("Specials")
            except Exception:
                return False, f"Specials season not in library ({section})"
            if episode == "Cover" or episode is None:
                return True, f"{section} · Specials"
            try:
                season_obj.episode(episode)
                return True, f"{section} · Specials E{episode}"
            except Exception:
                return False, f"Specials E{episode} not in library ({section})"
        if isinstance(season, int) and season >= 1:
            try:
                season_obj = tv_show.season(season)
            except Exception:
                return False, f"Season {season} not in library ({section})"
            if episode == "Cover" or episode is None:
                return True, f"{section} · Season {season}"
            try:
                season_obj.episode(episode)
                return True, f"{section} · S{season}E{episode}"
            except Exception:
                return False, f"S{season}E{episode} not in library ({section})"
        return False, f"Unhandled season target ({season!r})"
    except Exception:
        if isinstance(episode, int) and isinstance(season, int):
            return False, f"S{season}E{episode} not in library ({section})"
        if isinstance(season, int):
            return False, f"Season {season} not in library ({section})"
        return False, f"Target not in library ({section})"


def match_poster(kind: str, poster: dict, tv, movies) -> Tuple[bool, str]:
    title = str(poster.get("title") or "Untitled").strip() or "Untitled"
    year = poster.get("year")
    title_year = f"{title} ({year})" if year is not None else title
    if kind == "movie":
        items = find_in_library(movies, poster)
        if not items:
            libs = _library_titles(movies)
            year_note = f"; tried year {year}" if year is not None else ""
            return False, f"{title_year} not found in movie libraries ({libs}){year_note}"
        return True, items[0].librarySectionTitle
    if kind == "collection":
        if _is_collection_cover_title(title):
            return True, "Collection cover (not applied)"
        items = find_in_library(movies, poster) or find_in_library(tv, poster)
        if not items:
            libs = _library_titles(list(movies or []) + list(tv or []))
            year_note = f"; tried year {year}" if year is not None else ""
            return False, f"{title_year} not found in libraries ({libs}){year_note}"
        return True, items[0].librarySectionTitle
    items = find_in_library(tv, poster)
    if not items:
        libs = _library_titles(tv)
        return False, f"{title_year} not found in TV libraries ({libs})"
    matched_any = False
    detail = ""
    for show in items:
        ok, detail = match_show_target(show, poster)
        if ok:
            matched_any = True
            break
    return matched_any, detail or f"{title_year} found, season/episode target missing"


def build_preview_assets(movieposters, showposters, collectionposters, tv=None, movies=None) -> List[dict]:
    assets = []
    for poster in movieposters:
        kind = "movie"
        matched, detail = (True, "") if tv is None else match_poster(kind, poster, tv, movies)
        assets.append(
            {
                "id": asset_id(kind, poster),
                "kind": kind,
                "title": poster.get("title") or "Untitled",
                "year": poster.get("year"),
                "season": poster.get("season"),
                "episode": poster.get("episode"),
                "label": asset_label(kind, poster),
                "thumbUrl": poster.get("url") or "",
                "matched": matched if tv is not None else None,
                "matchDetail": detail,
                "source": poster.get("source"),
                "fileType": asset_file_type(kind, poster),
            }
        )
    for poster in showposters:
        kind = "show"
        matched, detail = (True, "") if tv is None else match_poster(kind, poster, tv, movies)
        assets.append(
            {
                "id": asset_id(kind, poster),
                "kind": kind,
                "title": poster.get("title") or "Untitled",
                "year": poster.get("year"),
                "season": poster.get("season"),
                "episode": poster.get("episode"),
                "label": asset_label(kind, poster),
                "thumbUrl": poster.get("url") or "",
                "matched": matched if tv is not None else None,
                "matchDetail": detail,
                "source": poster.get("source"),
                "fileType": asset_file_type(kind, poster),
            }
        )
    for poster in collectionposters:
        kind = "collection"
        matched, detail = (True, "") if tv is None else match_poster(kind, poster, tv, movies)
        assets.append(
            {
                "id": asset_id(kind, poster),
                "kind": kind,
                "title": poster.get("title") or "Untitled",
                "year": None,
                "season": poster.get("season"),
                "episode": None,
                "label": asset_label(kind, poster),
                "thumbUrl": poster.get("url") or "",
                "matched": matched if tv is not None else None,
                "matchDetail": detail,
                "source": poster.get("source"),
                "fileType": asset_file_type(kind, poster),
            }
        )
    return assets


def filter_posters_by_ids(
    movieposters,
    showposters,
    collectionposters,
    selected_ids: Optional[Sequence[str]],
) -> Tuple[list, list, list]:
    if not selected_ids:
        return movieposters, showposters, collectionposters
    wanted: Set[str] = {str(item) for item in selected_ids if str(item).strip()}
    if not wanted:
        return movieposters, showposters, collectionposters
    movies = [p for p in movieposters if asset_id("movie", p) in wanted or str(p.get("_assetId") or "") in wanted]
    shows = [p for p in showposters if asset_id("show", p) in wanted or str(p.get("_assetId") or "") in wanted]
    collections = [p for p in collectionposters if asset_id("collection", p) in wanted or str(p.get("_assetId") or "") in wanted]
    return movies, shows, collections


def _infer_source_from_url(url: str) -> str:
    if _url_host_matches(url, "theposterdb.com"):
        return "posterdb"
    if _url_host_matches(url, "mediux.pro"):
        return "mediux"
    return "mediux"


def _normalize_season_value(value: Any) -> Any:
    if value is None or value == "":
        return None
    if value in ("Cover", "Backdrop"):
        return value
    try:
        return int(value)
    except Exception:
        return value


def poster_row_from_selected_asset(asset: dict) -> Tuple[str, dict]:
    kind = str(asset.get("kind") or "show").strip().lower()
    if kind not in {"movie", "show", "collection"}:
        kind = "show"
    url = str(asset.get("url") or asset.get("thumbUrl") or "").strip()
    poster = {
        "title": asset.get("title") or "Untitled",
        "year": asset.get("year"),
        "season": _normalize_season_value(asset.get("season")),
        "episode": asset.get("episode") if asset.get("episode") not in ("", None) else None,
        "url": url,
        "source": str(asset.get("source") or _infer_source_from_url(url)).strip().lower() or "mediux",
        "file_type": asset.get("fileType") or asset.get("file_type"),
    }
    asset_id_value = str(asset.get("id") or "").strip()
    poster["_assetId"] = asset_id_value or asset_id(kind, poster)
    return kind, poster


def posters_from_selected_assets(selected_assets: Optional[Sequence[dict]]) -> Tuple[list, list, list]:
    """Build poster rows from preview/inspect metadata — avoids a full set scrape on apply."""
    movies: list = []
    shows: list = []
    collections: list = []
    for raw in selected_assets or []:
        if not isinstance(raw, dict):
            continue
        kind, poster = poster_row_from_selected_asset(raw)
        if not poster.get("url"):
            continue
        if kind == "movie":
            movies.append(poster)
        elif kind == "collection":
            collections.append(poster)
        else:
            shows.append(poster)
    return movies, shows, collections


def list_assets(url: str, config: dict | None = None, progress: ProgressFn = None) -> dict:
    """Scrape a set URL and return asset fingerprints.

    When Plex credentials exist, also mark each asset matched against the library
    so watchers can apply season covers that become available later.
    """
    cfg = config if isinstance(config, dict) else {}
    filters = normalize_library_list(cfg.get("mediux_filters")) or [
        "title_card",
        "background",
        "season_cover",
        "show_cover",
    ]
    emit(progress, f"Listing assets from {url}")
    movieposters, showposters, collectionposters, page_meta = scrape(url, mediux_filters=filters, progress=progress)

    tv = movies = None
    if cfg.get("base_url") and cfg.get("token"):
        try:
            emit(progress, "Checking library matches for watched assets…")
            tv, movies, _plex = connect_plex(cfg, progress=progress)
        except Exception as exc:
            emit(progress, f"Match check skipped: {exc}")
            tv = movies = None

    assets = build_preview_assets(movieposters, showposters, collectionposters, tv=tv, movies=movies)
    set_meta = build_set_meta(url, movieposters, showposters, collectionposters, page_meta=page_meta)
    canonical = str(set_meta.get("url") or url or "").strip() or url
    return {
        "ok": True,
        "url": canonical,
        "setMeta": set_meta,
        "assets": [
            {
                "id": asset.get("id"),
                "kind": asset.get("kind"),
                "title": asset.get("title"),
                "year": asset.get("year"),
                "season": asset.get("season"),
                "episode": asset.get("episode"),
                "label": asset.get("label"),
                "source": asset.get("source"),
                "fileType": asset.get("fileType") or asset.get("file_type"),
                "matched": asset.get("matched"),
                "matchDetail": asset.get("matchDetail"),
            }
            for asset in assets
            if asset.get("id")
        ],
        "total": len(assets),
        "matched": sum(1 for asset in assets if asset.get("matched") is True),
        "unmatched": sum(1 for asset in assets if asset.get("matched") is False),
    }


def preview_url(url: str, config: dict, progress: ProgressFn = None) -> dict:
    filters = normalize_library_list(config.get("mediux_filters")) or [
        "title_card",
        "background",
        "season_cover",
        "show_cover",
    ]
    emit(progress, f"Scraping {url}")
    movieposters, showposters, collectionposters, page_meta = scrape(url, mediux_filters=filters, progress=progress)
    summary = summarize_posters(movieposters, showposters, collectionposters)

    tv = movies = None
    match_error = None
    try:
        if config.get("base_url") and config.get("token"):
            emit(progress, "Checking library matches…")
            tv, movies, _plex = connect_plex(config, progress=progress)
    except Exception as exc:
        match_error = str(exc)
        emit(progress, f"Match check skipped: {exc}")

    assets = build_preview_assets(movieposters, showposters, collectionposters, tv=tv, movies=movies)
    matched = sum(1 for asset in assets if asset.get("matched") is True)
    unmatched = sum(1 for asset in assets if asset.get("matched") is False)
    set_meta = build_set_meta(url, movieposters, showposters, collectionposters, page_meta=page_meta)
    canonical = str(set_meta.get("url") or url or "").strip() or url
    return {
        "ok": True,
        "url": canonical,
        **summary,
        "assets": assets,
        "matched": matched,
        "unmatched": unmatched,
        "matchError": match_error,
        "setMeta": set_meta,
    }


def apply_url(
    url: str,
    config: dict,
    progress: ProgressFn = None,
    selected_ids: Optional[Sequence[str]] = None,
    plex_hint: Optional[dict] = None,
    selected_assets: Optional[Sequence[dict]] = None,
) -> dict:
    filters = normalize_library_list(config.get("mediux_filters")) or [
        "title_card",
        "background",
        "season_cover",
        "show_cover",
    ]
    tv, movies, plex = connect_plex(config, progress=progress)
    page_meta = None
    if selected_ids and selected_assets:
        emit(progress, f"Applying {len(selected_ids)} selected asset(s) from preview (skipping re-scrape)")
        movieposters, showposters, collectionposters = posters_from_selected_assets(selected_assets)
        movieposters, showposters, collectionposters = filter_posters_by_ids(
            movieposters, showposters, collectionposters, selected_ids
        )
    else:
        emit(progress, f"Scraping {url}")
        movieposters, showposters, collectionposters, page_meta = scrape(url, mediux_filters=filters, progress=progress)
        movieposters, showposters, collectionposters = filter_posters_by_ids(
            movieposters, showposters, collectionposters, selected_ids
        )
    selected_count = len(selected_ids) if selected_ids else None
    asset_count = len(movieposters) + len(showposters) + len(collectionposters)
    if selected_ids and asset_count == 0:
        set_meta = build_set_meta(url, [], [], [], page_meta=page_meta)
        return {
            "ok": False,
            "url": url,
            "uploaded": 0,
            "attempted": 0,
            "selected": selected_count,
            "error": "None of the selected assets were found when re-scraping the set — nothing was applied.",
            "resetOverlay": should_reset_overlay(config),
            "counts": {"movies": 0, "shows": 0, "collections": 0},
            "results": [],
            "setMeta": set_meta,
        }
    if selected_ids:
        emit(progress, f"Applying {asset_count} selected asset(s)")

    hint = plex_hint if isinstance(plex_hint, dict) else {}
    rating_key = str(hint.get("ratingKey") or hint.get("rating_key") or "").strip() or None
    hint_title = str(hint.get("title") or "").strip() or None
    if rating_key:
        emit(
            progress,
            f"Pinning apply to Plex ratingKey {rating_key}"
            + (f' (“{hint_title}” only)' if hint_title else ""),
        )

    def _stamp(poster: dict) -> dict:
        """Attach Plex connection; only pin ratingKey to posters for the hinted title.

        Library applies pass the open title's ratingKey. Multi-title franchise sets must
        still resolve other movies/shows by their own poster titles — otherwise every
        asset lands on the focused item and the rest of the set never updates.
        """
        stamped = {**poster, "_config": config}
        poster_title = str(poster.get("title") or "").strip()
        pin_ok = False
        if rating_key:
            if hint_title:
                pin_ok = (not poster_title) or _plex_titles_exactly_match(hint_title, poster_title)
            elif (selected_count or 0) == 1 or asset_count == 1:
                pin_ok = True
        if pin_ok:
            stamped["_ratingKey"] = rating_key
            if hint_title:
                stamped["_plexHintTitle"] = hint_title
        if plex is not None:
            stamped["_plex"] = plex
        return stamped

    results = []
    for poster in collectionposters:
        results.append(upload_collection_poster(_stamp(poster), movies, progress=progress, tv=tv))
    for poster in movieposters:
        results.append(upload_movie_poster(_stamp(poster), movies, progress=progress))
    for poster in showposters:
        results.append(upload_tv_poster(_stamp(poster), tv, progress=progress))
    skipped = sum(1 for item in results if item.get("skipped"))
    uploaded = sum(1 for item in results if item.get("ok") and not item.get("skipped"))
    attempted = sum(1 for item in results if not item.get("skipped"))
    set_meta = build_set_meta(url, movieposters, showposters, collectionposters, page_meta=page_meta)
    ok = uploaded > 0
    error = None
    if not ok:
        if attempted == 0:
            error = (
                "Only collection covers were selected — those are not applied to Plex titles."
                if skipped
                else "No posters were found to apply from this set."
            )
        else:
            failed_msgs = [
                str(item.get("message") or "").strip()
                for item in results
                if not item.get("ok") and not item.get("skipped") and str(item.get("message") or "").strip()
            ]
            error = failed_msgs[0] if failed_msgs else f"Applied 0 of {attempted} poster(s) — nothing changed on Plex."
        emit(progress, error)
    return {
        "ok": ok,
        "url": url,
        "uploaded": uploaded,
        "attempted": attempted,
        "selected": selected_count,
        "error": error,
        "resetOverlay": should_reset_overlay(config),
        "counts": {
            "movies": len(movieposters),
            "shows": len(showposters),
            "collections": len(collectionposters),
        },
        "results": results,
        "setMeta": set_meta,
    }


def is_not_comment(url: str) -> bool:
    return bool(re.match(r"^(?!\/\/|#|^$)", url.strip()))


def parse_bulk_urls(lines: Iterable[str]) -> List[str]:
    urls = []
    for line in lines:
        url = str(line or "").strip()
        if url and is_not_comment(url):
            urls.append(url)
    return urls


def _absolute_url(base: str, href: str) -> str:
    value = str(href or "").strip()
    if not value:
        return ""
    if value.startswith("http://") or value.startswith("https://"):
        return value
    if value.startswith("//"):
        return "https:" + value
    if value.startswith("/"):
        return base.rstrip("/") + value
    return base.rstrip("/") + "/" + value


def _decode_next_image_url(src: str) -> str:
    value = str(src or "").strip()
    if not value:
        return ""
    match = re.search(r"[?&]url=([^&]+)", value)
    if match:
        return unquote(match.group(1))
    if value.startswith("http://") or value.startswith("https://"):
        return value
    return ""


def _posterdb_page_media(soup) -> Tuple[Optional[str], Optional[str]]:
    node = soup.find(attrs={"data-media-id": True}) if soup else None
    if not node:
        return None, None
    media_id = str(node.get("data-media-id") or "").strip() or None
    media_source = str(node.get("data-media-source") or "").strip().lower() or None
    return media_id, media_source


def _posterdb_count_set_links(soup) -> int:
    return len(set(re.findall(r"/set/(\d+)", str(soup or ""))))


def _posterdb_title_match_key(title: str, year: int | None) -> str:
    text = str(title or "").strip().lower()
    text = re.sub(r"\(\s*(?:\d{4}|n/a)\s*\)\s*$", "", text, flags=re.I).strip()
    text = re.sub(r"[^a-z0-9]+", " ", text).strip()
    year_part = str(int(year)) if year is not None and str(year).isdigit() else ""
    return f"{text}|{year_part}"


def _posterdb_title_only_key(title: str) -> str:
    return _posterdb_title_match_key(title, None).split("|", 1)[0]


def _posterdb_year_tolerance(media_type: str = "show") -> int:
    raw = str(media_type or "show").strip().lower()
    if raw in {"movie", "movies", "film"}:
        # Theatrical vs digital / "2025 film, 2026 release" mismatches are common on TPDB.
        return 2
    # Plex TV rows often carry latest-season year vs TPDB premiere year.
    return 20


def _posterdb_years_compatible(
    left: int | None,
    right: int | None,
    *,
    media_type: str = "show",
) -> bool:
    if left is None or right is None:
        return True
    try:
        left_val = int(left)
        right_val = int(right)
    except Exception:
        return True
    return abs(left_val - right_val) <= _posterdb_year_tolerance(media_type)


def _posterdb_title_matches_hint(
    item_title: str,
    item_year: int | None,
    *,
    title_hint: str,
    year_hint: int | None,
    media_type: str = "show",
) -> bool:
    if _posterdb_title_only_key(item_title) != _posterdb_title_only_key(title_hint):
        return False
    if year_hint is None:
        return True
    if item_year is None:
        return True
    if _posterdb_title_match_key(item_title, item_year) == _posterdb_title_match_key(title_hint, year_hint):
        return True
    return _posterdb_years_compatible(year_hint, item_year, media_type=media_type)


def _pick_posterdb_title_candidate(
    titles: list[dict],
    *,
    title_hint: str = "",
    year_hint: int | None = None,
    media_type: str = "show",
) -> Optional[dict]:
    """Pick the best TPDB /posters/ title page from text-search hits.

    Title (+ year when known) must match — never fall through to titles[0]
    from a fuzzy TPDB search (e.g. "The Python Hunt" → "Monty Python").
    """
    if not titles:
        return None
    want_key = _posterdb_title_match_key(title_hint, year_hint)
    title_only = _posterdb_title_only_key(title_hint)
    year_part = want_key.split("|", 1)[1] if "|" in want_key else ""
    if year_part:
        for item in titles:
            if _posterdb_title_match_key(item.get("title") or "", item.get("year")) == want_key:
                return item
        for item in titles:
            if _posterdb_title_matches_hint(
                item.get("title") or "",
                item.get("year"),
                title_hint=title_hint,
                year_hint=year_hint,
                media_type=media_type,
            ):
                return item
        # Year was requested but page-1 search missed it (common for "Sisters").
        # Shows: Plex often has latest-season year while TPDB keeps premiere year
        # (e.g. 2026 vs 2011). If the title uniquely matches, still pick it.
        if _posterdb_is_show(media_type) and title_only:
            same_name = [
                item for item in titles
                if _posterdb_title_only_key(item.get("title") or "") == title_only
            ]
            if len(same_name) == 1:
                return same_name[0]
            if same_name and year_hint is not None:
                def _year_distance(item: dict) -> int:
                    try:
                        return abs(int(item.get("year")) - int(year_hint))
                    except Exception:
                        return 10_000
                return min(same_name, key=_year_distance)
        return None
    if title_only:
        for item in titles:
            if _posterdb_title_only_key(item.get("title") or "") == title_only:
                return item
        # Have a real title hint but no exact title match — refuse fuzzy first hit.
        return None
    # No usable title hint: caller must not rely on an arbitrary first result.
    return None


def _parse_posterdb_title_links(soup, *, limit: int = 24, html: str = "") -> list[dict]:
    titles: list[dict] = []
    seen: set[str] = set()
    for anchor in soup.find_all("a", href=True):
        href = str(anchor.get("href") or "")
        match = re.search(r"/posters/(\d+)", href)
        if not match:
            continue
        posters_id = match.group(1)
        if posters_id in seen or posters_id == "requests":
            continue
        title = anchor.get_text(" ", strip=True)
        if not title or len(title) < 2:
            continue
        seen.add(posters_id)
        year = None
        year_match = re.search(r"\((\d{4}|N/A)\)\s*$", title)
        if year_match and year_match.group(1).isdigit():
            year = int(year_match.group(1))
        thumb = ""
        for candidate in (anchor, anchor.parent):
            if not candidate:
                continue
            img = candidate.find("img") if hasattr(candidate, "find") else None
            if not img:
                continue
            thumb = str(img.get("data-src") or img.get("src") or "").strip()
            if thumb.startswith("/"):
                thumb = _absolute_url("https://theposterdb.com", thumb)
            if thumb and "missing_poster" not in thumb:
                break
            thumb = ""
        titles.append(
            {
                "id": posters_id,
                "title": title,
                "year": year,
                "url": _absolute_url("https://theposterdb.com", href.split("?")[0]),
                "thumbUrl": thumb,
                "mediaType": None,
                "provider": "posterdb",
            }
        )
        if len(titles) >= max(1, int(limit or 24)):
            break

    if titles:
        return titles

    blob = html or str(soup or "")
    for match in re.finditer(r'href=["\']([^"\']*/posters/(\d+)[^"\']*)["\']', blob, re.I):
        posters_id = match.group(2)
        if posters_id in seen or posters_id == "requests":
            continue
        seen.add(posters_id)
        href = match.group(1)
        titles.append(
            {
                "id": posters_id,
                "title": f"Title page {posters_id}",
                "year": None,
                "url": _absolute_url("https://theposterdb.com", href.split("?")[0]),
                "mediaType": None,
                "provider": "posterdb",
            }
        )
        if len(titles) >= max(1, int(limit or 24)):
            break
    return titles


def _posterdb_pick_thumb_from_soup(soup) -> str:
    if not soup:
        return ""
    og = soup.find("meta", property="og:image")
    if og and og.get("content"):
        thumb = str(og.get("content") or "").strip()
        if thumb:
            if thumb.startswith("/"):
                thumb = _absolute_url("https://theposterdb.com", thumb)
            if "missing_poster" not in thumb:
                return thumb
    for img in soup.select("img[src], img[data-src]"):
        src = str(img.get("data-src") or img.get("src") or "").strip()
        if not src or "missing_poster" in src:
            continue
        if "logo" in src.lower() and "poster" not in src.lower():
            continue
        if src.startswith("/"):
            src = _absolute_url("https://theposterdb.com", src)
        return src
    return ""


def _posterdb_enrich_title_thumbs(
    titles: list[dict],
    *,
    config: dict | None = None,
    progress: ProgressFn = None,
    limit: int = 12,
) -> None:
    """Fill missing search-result thumbs by probing each /posters/ page."""
    take = max(1, int(limit or 12))
    for item in titles[:take]:
        if str(item.get("thumbUrl") or "").strip():
            continue
        url = str(item.get("url") or "").strip()
        if not url:
            continue
        try:
            soup = cook_soup(url, config=config, timeout=18)
            thumb = _posterdb_pick_thumb_from_soup(soup)
            if thumb:
                item["thumbUrl"] = thumb
        except Exception as exc:
            emit(progress, f"ThePosterDB thumb probe failed for {url}: {exc}")


def _posterdb_probe_title_page(url: str, *, config: dict | None = None) -> dict:
    soup = cook_soup(url, config=config)
    media_id, media_source = _posterdb_page_media(soup)
    return {
        "mediaId": media_id,
        "mediaSource": media_source,
        "setCount": _posterdb_count_set_links(soup),
        "soup": soup,
    }


def _posterdb_advanced_category(media_type: str = "show") -> str:
    """TPDB advanced search expects title-case category values (Shows, Movies, All)."""
    raw = str(media_type or "show").strip().lower()
    if raw in {"movie", "movies", "film"}:
        return "Movies"
    if raw in {"show", "shows", "tv", "series"}:
        return "Shows"
    return "All"


def _posterdb_is_show(media_type: str = "show") -> bool:
    raw = str(media_type or "show").strip().lower()
    return raw in {"show", "shows", "tv", "series"}


def _posterdb_resolve_probe_limit(
    media_type: str = "show",
    *,
    target_tmdb: str | None = None,
    default: int = 10,
) -> int:
    """Shows need more probes — same-name hits bury the correct /posters/ page."""
    limit = max(1, int(default or 10))
    if not target_tmdb:
        return min(limit, 8)
    if _posterdb_is_show(media_type):
        return min(limit, 12)
    return min(limit, 8)


def _posterdb_advanced_resolve_by_ids(
    config: dict | None,
    *,
    tmdb_id: str | int | None = None,
    imdb_id: str | None = None,
    tvdb_id: str | int | None = None,
    category: str = "Shows",
    media_type: str = "show",
    progress: ProgressFn = None,
    limit: int = 24,
    merge_candidates: dict[str, dict] | None = None,
) -> Optional[dict]:
    """Resolve a canonical /posters/ page via separate id-only advanced queries.

    TPDB advanced search is more reliable with one id per request than combined
    tmdb+tvdb+imdb params (especially for TV shows).
    """
    if not _posterdb_should_use_login(config):
        return None
    target_tmdb = str(tmdb_id or "").strip() or None
    target_tvdb = str(tvdb_id or "").strip() or None
    clean_imdb = str(imdb_id or "").strip() or None

    id_specs: list[tuple[str, dict[str, str]]] = []
    if _posterdb_is_show(media_type):
        # Prefer TVDB first for shows — Plex TV libraries are TVDB-native; a guessed
        # TMDB id can singleton-match the wrong /posters/ page and poison warm.
        if target_tvdb:
            id_specs.append(("tvdb", {"tvdb_id": target_tvdb}))
        if target_tmdb:
            id_specs.append(("tmdb", {"tmdb_id": target_tmdb}))
        if clean_imdb:
            id_specs.append(("imdb", {"imdb_id": clean_imdb}))
    else:
        if target_tmdb:
            id_specs.append(("tmdb", {"tmdb_id": target_tmdb}))
        if clean_imdb:
            id_specs.append(("imdb", {"imdb_id": clean_imdb}))
        if target_tvdb:
            id_specs.append(("tvdb", {"tvdb_id": target_tvdb}))

    categories = [category]
    # Only fall back to "All" when the typed category returns nothing.

    def _merge_batch(batch: list[dict]) -> None:
        if merge_candidates is None:
            return
        for item in batch:
            pid = str(item.get("id") or "")
            if pid and pid not in merge_candidates:
                merge_candidates[pid] = item

    def _accept_item(item: dict, *, trust_singleton: bool, trust_tmdb_query: bool = False) -> Optional[dict]:
        url = str(item.get("url") or "").strip()
        if not url:
            return None
        # Advanced search was already filtered by tmdb_id — skip an extra title-page probe.
        if trust_tmdb_query and target_tmdb and (trust_singleton or len(str(item.get("id") or "")) > 0):
            if trust_singleton:
                return {
                    **item,
                    "url": url,
                    "tmdbId": target_tmdb,
                    "setCount": int(item.get("setCount") or 0),
                }
        try:
            probe = _posterdb_probe_title_page(url, config=config)
        except Exception:
            probe = {}
        page_tmdb = str(probe.get("mediaId") or "").strip() or None
        set_count = int(probe.get("setCount") or 0)
        if target_tmdb and page_tmdb and page_tmdb != target_tmdb:
            return None
        if target_tmdb and not page_tmdb and not trust_singleton:
            return None
        return {
            **item,
            "url": url,
            "tmdbId": page_tmdb or target_tmdb,
            "setCount": set_count,
        }

    for _kind, id_params in id_specs:
        category_attempts = list(categories)
        if category != "All":
            category_attempts = [category, "All"]
        for category_value in category_attempts:
            batch = search_posterdb_advanced_titles(
                config,
                term="",
                category=category_value,
                progress=progress,
                limit=limit,
                **id_params,
            )
            if not batch:
                continue
            _merge_batch(batch)
            trust_tmdb_query = "tmdb_id" in id_params and bool(target_tmdb)
            # Never singleton-trust a TMDB hit when a TVDB id is also in play — mapped/wrong
            # TMDB can match a single wrong /posters/ page and poison the warm cache.
            singleton_ok = True
            if trust_tmdb_query and target_tvdb:
                singleton_ok = False
            if len(batch) == 1 and singleton_ok:
                accepted = _accept_item(
                    batch[0],
                    trust_singleton=True,
                    trust_tmdb_query=trust_tmdb_query,
                )
                if accepted:
                    return accepted
            if target_tmdb:
                for item in batch:
                    accepted = _accept_item(
                        item,
                        trust_singleton=False,
                        trust_tmdb_query=trust_tmdb_query,
                    )
                    if accepted and str(accepted.get("tmdbId") or "") == target_tmdb:
                        return accepted
            elif target_tvdb and "tvdb_id" in id_params:
                # TVDB advanced search often returns several poster pages for one id.
                # Probe until one has a usable /posters/ page (do not require TMDB).
                for item in batch:
                    accepted = _accept_item(
                        item,
                        trust_singleton=False,
                        trust_tmdb_query=False,
                    )
                    if accepted:
                        return accepted
            # Typed category already returned hits — don't burn another request on "All".
            break
    return None


def search_posterdb_advanced_titles(
    config: dict | None,
    *,
    tmdb_id: str | int | None = None,
    imdb_id: str | None = None,
    tvdb_id: str | int | None = None,
    term: str = "",
    category: str = "Shows",
    progress: ProgressFn = None,
    limit: int = 24,
) -> list[dict]:
    """Authenticated advanced search — required for canonical /posters/ pages on many titles."""
    session = _posterdb_http_client(config)
    if not isinstance(session, requests.Session):
        detail = _posterdb_take_login_error()
        msg = detail or "ThePosterDB login failed — check username/password (advanced search needs a working session)."
        emit(progress, msg)
        _posterdb_note_resolve_error(msg)
        return []
    params: dict[str, str] = {}
    category_value = str(category or "").strip()
    if category_value:
        params["category"] = category_value
    if tmdb_id not in (None, ""):
        params["tmdb_id"] = str(tmdb_id).strip()
    if imdb_id:
        params["imdb_id"] = str(imdb_id).strip()
    if tvdb_id not in (None, ""):
        params["tvdb_id"] = str(tvdb_id).strip()
    if term:
        params["term"] = str(term).strip()
    if not params.get("tmdb_id") and not params.get("imdb_id") and not params.get("tvdb_id") and not params.get("term"):
        return []
    emit(progress, "Searching ThePosterDB advanced catalog…")

    def _fetch(active_session: requests.Session) -> requests.Response:
        return _posterdb_advanced_search_get(active_session, params, timeout=60)

    response = _fetch(session)
    if "theposterdb.com/login" in str(response.url or "").lower():
        user = str((config or {}).get("tpdb_username") or (config or {}).get("tpdb_login") or "").strip()
        _posterdb_invalidate_sessions(user)
        path = _posterdb_session_path(config)
        if path and os.path.isfile(path):
            try:
                os.remove(path)
            except Exception:
                pass
        retry_session = _posterdb_http_client(config)
        if isinstance(retry_session, requests.Session):
            response = _fetch(retry_session)
        if "theposterdb.com/login" in str(response.url or "").lower():
            msg = (
                "ThePosterDB advanced search redirected to login — credentials rejected or session expired. "
                "Re-save TPDB username/password and use Test connection."
            )
            emit(progress, msg)
            _posterdb_note_resolve_error(msg)
            user = str((config or {}).get("tpdb_username") or (config or {}).get("tpdb_login") or "").strip()
            password = str((config or {}).get("tpdb_password") or "").strip()
            if user and password and password != "********":
                _posterdb_mark_login_failed(_posterdb_session_cache_key(user, password), msg)
            return []
    soup = BeautifulSoup(response.text, "html.parser")
    titles = _parse_posterdb_title_links(soup, limit=limit, html=response.text)
    if not titles and (params.get("tmdb_id") or params.get("imdb_id") or params.get("tvdb_id")):
        _posterdb_note_resolve_error(
            "Advanced search returned no /posters/<id> hits for this id "
            "(account may lack Pro advanced search, or TPDB has no page for this title)."
        )
    return titles


def resolve_posterdb_title_page(
    *,
    query: str = "",
    title: str = "",
    year: int | None = None,
    tmdb_id: str | int | None = None,
    imdb_id: str | None = None,
    tvdb_id: str | int | None = None,
    media_type: str = "show",
    config: dict | None = None,
    progress: ProgressFn = None,
    limit: int = 24,
    probe_limit: int = 10,
) -> Optional[dict]:
    """Pick the best TPDB /posters/ page — prefer TMDB match and the most sets."""
    global _POSTERDB_RESOLVE_LAST_ERROR
    _POSTERDB_RESOLVE_LAST_ERROR = None
    target_tmdb = str(tmdb_id or "").strip() or None
    clean_title = str(title or "").strip()
    clean_query = str(query or "").strip()
    # Prefer bare title for search pagination (year is matched from result labels).
    bare_title = re.sub(r"\s*\(\s*(?:\d{4}|n/a)\s*\)\s*$", "", clean_title or clean_query, flags=re.I).strip()
    cache_key = _posterdb_resolve_cache_key(
        title=bare_title or clean_title or clean_query,
        year=year,
        tmdb_id=target_tmdb,
        imdb_id=str(imdb_id or "").strip() or None,
        tvdb_id=str(tvdb_id or "").strip() or None,
        media_type=media_type,
        authenticated=_posterdb_should_use_login(config),
    )
    cached_hit, cached_value = _posterdb_resolve_cache_get(cache_key)
    if cached_hit:
        return cached_value

    def _finish(value: Optional[dict]) -> Optional[dict]:
        _posterdb_resolve_cache_set(cache_key, value)
        return value

    candidates: dict[str, dict] = {}
    category = _posterdb_advanced_category(media_type)
    want_key = _posterdb_title_match_key(bare_title or clean_title or clean_query, year)
    has_creds = _posterdb_should_use_login(config)
    if target_tmdb and not has_creds:
        msg = (
            "ThePosterDB login not used — matching uses public text search. "
            "Enable TPDB login in Settings when Cloudflare allows it for TMDB-id resolve."
        )
        emit(progress, msg)
        _posterdb_note_resolve_error(msg)

    def _accept_year_hit(item: dict) -> Optional[dict]:
        url = str(item.get("url") or "").strip()
        if not url:
            return None
        if not target_tmdb:
            return {**item, "url": url, "setCount": int(item.get("setCount") or 0)}
        try:
            probe = _posterdb_probe_title_page(url, config=config)
        except Exception:
            return None
        page_tmdb = str(probe.get("mediaId") or "").strip()
        # Never invent a TMDB match — that made Warm accept the wrong "Obsession (2026)"
        # page, then list_posterdb_sets rejected it and soft-skipped every title.
        if not page_tmdb or page_tmdb != target_tmdb:
            return None
        return {
            **item,
            "url": url,
            "tmdbId": page_tmdb,
            "setCount": int(probe.get("setCount") or 0),
        }

    # When logged in, resolve by external ids before multi-page text search.
    if has_creds and (target_tmdb or imdb_id or tvdb_id):
        advanced_hit = _posterdb_advanced_resolve_by_ids(
            config,
            tmdb_id=target_tmdb,
            imdb_id=imdb_id,
            tvdb_id=tvdb_id,
            category=category,
            media_type=media_type,
            progress=progress,
            limit=limit,
            merge_candidates=candidates,
        )
        if advanced_hit:
            return _finish(advanced_hit)
        if target_tmdb:
            msg = (
                f"ThePosterDB advanced search found no title page for TMDB {target_tmdb} — "
                "trying public text search."
            )
            emit(progress, msg)
            _posterdb_note_resolve_error(msg)

    public_pages = 3 if not has_creds else (5 if target_tmdb else 3)
    # Warm public mode: fewer search pages — most year matches land on page 1–2.
    if (config or {}).get("_posterdb_warm") and not has_creds:
        public_pages = 2

    # Fast path: paginated text search for exact title+year (no login required).
    if year is not None and bare_title:
        text = search_posterdb_titles(
            bare_title,
            progress=progress,
            limit=max(limit, 36),
            config=config,
            media_type=media_type,
            _skip_resolve=True,
            year_hint=year,
            max_pages=public_pages,
        )
        for item in text.get("titles") or []:
            pid = str(item.get("id") or "")
            if pid and pid not in candidates:
                candidates[pid] = item
            if want_key and _posterdb_title_match_key(item.get("title") or "", item.get("year")) == want_key:
                accepted = _accept_year_hit(item)
                if accepted:
                    return _finish(accepted)
            if _posterdb_title_matches_hint(
                item.get("title") or "",
                item.get("year"),
                title_hint=bare_title or clean_title or clean_query,
                year_hint=year,
                media_type=media_type,
            ):
                accepted = _accept_year_hit(item)
                if accepted:
                    return _finish(accepted)

    # Bare title search — always merge when resolving by TMDB so a wrong Plex season-year
    # (Sugar library 2026 vs catalog 2024) cannot strand us on year-mismatched candidates only.
    search_terms = _posterdb_search_terms_from_hint(bare_title or clean_title or clean_query)
    if bare_title and (not candidates or target_tmdb):
        for term in search_terms:
            text = search_posterdb_titles(
                term,
                progress=progress,
                limit=limit,
                config=config,
                media_type=media_type,
                _skip_resolve=True,
                max_pages=public_pages,
                year_hint=year if term == (bare_title or search_terms[0]) else None,
            )
            for item in text.get("titles") or []:
                pid = str(item.get("id") or "")
                if pid and pid not in candidates:
                    candidates[pid] = item

    if not candidates:
        if target_tmdb:
            _posterdb_note_resolve_error(
                f"No ThePosterDB /posters/<id> candidates for TMDB {target_tmdb} "
                f"(advanced + public search). This title may not exist on TPDB yet."
            )
        return _finish(None)

    best_item: Optional[dict] = None
    best_score: tuple[int, int, int, int] = (-1, -1, -1, -1)
    max_probes = _posterdb_resolve_probe_limit(
        media_type,
        target_tmdb=target_tmdb,
        default=int(probe_limit or 10),
    )
    if not has_creds:
        max_probes = min(max_probes, 4)

    ordered = list(candidates.values())
    if want_key and not want_key.startswith("|"):
        exact = [item for item in ordered if _posterdb_title_match_key(item.get("title") or "", item.get("year")) == want_key]
        if exact:
            ordered = exact + [item for item in ordered if item not in exact]
        elif year is not None:
            tolerant = [
                item for item in ordered
                if _posterdb_title_matches_hint(
                    item.get("title") or "",
                    item.get("year"),
                    title_hint=bare_title or clean_title or clean_query,
                    year_hint=year,
                    media_type=media_type,
                )
            ]
            if tolerant:
                ordered = tolerant + [item for item in ordered if item not in tolerant]

    for idx, item in enumerate(ordered[:max_probes]):
        url = str(item.get("url") or "").strip()
        if not url:
            continue
        try:
            probe = _posterdb_probe_title_page(url, config=config)
        except Exception:
            continue
        media_id = probe.get("mediaId")
        set_count = int(probe.get("setCount") or 0)
        tmdb_match = 1 if target_tmdb and str(media_id or "") == target_tmdb else 0
        title_key = _posterdb_title_match_key(item.get("title") or "", item.get("year"))
        title_match = 1 if want_key and title_key == want_key else 0
        title_compatible = _posterdb_title_matches_hint(
            item.get("title") or "",
            item.get("year"),
            title_hint=bare_title or clean_title or clean_query,
            year_hint=year,
            media_type=media_type,
        )
        if target_tmdb and not tmdb_match:
            if media_id and str(media_id) != target_tmdb:
                continue
            # Without a confirmed TMDB id on the page, do not pick same-name year hits.
            if not media_id:
                continue
            if not title_compatible:
                continue
        elif want_key and not want_key.startswith("|") and not title_match and not title_compatible:
            continue
        relaxed_title_match = 1 if title_compatible else 0
        score = (tmdb_match, title_match or relaxed_title_match, set_count, -idx)
        if score > best_score:
            best_score = score
            best_item = {
                **item,
                "url": url,
                "tmdbId": media_id,
                "setCount": set_count,
            }
            if tmdb_match and set_count > 0:
                break
            if (tmdb_match or title_match) and set_count > 0 and not target_tmdb:
                break

    if best_item is None and target_tmdb:
        _posterdb_note_resolve_error(
            f"Probed ThePosterDB candidates but none matched TMDB {target_tmdb} "
            "(wrong same-name titles, or TPDB has no page for this id yet)."
        )

    # Do NOT relax into a different TMDB id — that caused Sisters (2026) for Sisters (2015).
    if best_item is None and not target_tmdb and year is not None and want_key:
        for item in ordered:
            if _posterdb_title_match_key(item.get("title") or "", item.get("year")) == want_key:
                url = str(item.get("url") or "").strip()
                if url:
                    return _finish({**item, "url": url, "setCount": int(item.get("setCount") or 0)})
        for item in ordered:
            if _posterdb_title_matches_hint(
                item.get("title") or "",
                item.get("year"),
                title_hint=bare_title or clean_title or clean_query,
                year_hint=year,
                media_type=media_type,
            ):
                url = str(item.get("url") or "").strip()
                if url:
                    return _finish({**item, "url": url, "setCount": int(item.get("setCount") or 0)})

    # TMDB pin + strict year can miss the right page when catalog year differs (e.g. 2026 vs 2024).
    if best_item is None and target_tmdb and year is not None:
        title_hint_str = bare_title or clean_title or clean_query
        for item in ordered[:max_probes]:
            if not _posterdb_title_matches_hint(
                item.get("title") or "",
                item.get("year"),
                title_hint=title_hint_str,
                year_hint=None,
                media_type=media_type,
            ):
                continue
            url = str(item.get("url") or "").strip()
            if not url:
                continue
            try:
                probe = _posterdb_probe_title_page(url, config=config)
            except Exception:
                continue
            media_id = probe.get("mediaId")
            if media_id and str(media_id) != target_tmdb:
                continue
            best_item = {
                **item,
                "url": url,
                "tmdbId": media_id or target_tmdb,
                "setCount": int(probe.get("setCount") or 0),
            }
            break

    return _finish(best_item)


def _collect_posterdb_show_posters(soup, *, limit: int = 40, page_title: str = "") -> list[dict]:
    """Fallback: title pages that list individual posters instead of /set/ links."""
    results: dict[str, dict] = {}
    for node in soup.select("[data-poster-id]"):
        poster_id = str(node.get("data-poster-id") or "").strip()
        if not poster_id or not poster_id.isdigit() or poster_id in results:
            continue
        thumb = ""
        img = node.find("img")
        if img:
            thumb = str(img.get("data-src") or img.get("src") or "").strip()
            if thumb.startswith("/"):
                thumb = _absolute_url("https://theposterdb.com", thumb)
        user = None
        user_node = node.find("a", href=re.compile(r"/user/"))
        if user_node:
            user = user_node.get_text(" ", strip=True) or None
        label = page_title or "Poster"
        results[poster_id] = {
            "setId": poster_id,
            "url": _absolute_url("https://theposterdb.com", f"/poster/{poster_id}"),
            "title": label,
            "thumbUrl": thumb,
            "user": user,
            "posterCount": 1,
            "provider": "posterdb",
            "setKind": "posters",
        }
        if len(results) >= max(1, int(limit or 40)):
            break
    return list(results.values())


def search_posterdb_titles(
    query: str,
    progress: ProgressFn = None,
    limit: int = 24,
    *,
    config: dict | None = None,
    tmdb_id: str | int | None = None,
    imdb_id: str | None = None,
    tvdb_id: str | int | None = None,
    media_type: str = "show",
    _skip_resolve: bool = False,
    year_hint: int | None = None,
    max_pages: int = 1,
    thumb_probes: int | None = None,
) -> dict:
    term = str(query or "").strip()
    if not term:
        raise ValueError("query is required")
    year_val = year_hint
    if year_val is None:
        year_match = re.search(r"(?:\(|^|\s)(19\d{2}|20\d{2})(?:\)|$|\s)", term)
        if year_match:
            year_val = int(year_match.group(1))
    # Ambiguous titles bury the matching year on later pages. When TMDB is pinned,
    # walk further — franchise spin-offs often sit past page 3 in public search.
    # Respect explicit lower caps (Warm passes max_pages=2) so Warm stays faster.
    requested = max(1, int(max_pages or 1))
    if year_val is not None or tmdb_id:
        pages = requested if requested < 3 else max(requested, 3)
    else:
        pages = requested
    pages = min(pages, 8 if tmdb_id else 5)

    titles: list[dict] = []
    seen: set[str] = set()
    title_only = _posterdb_title_only_key(term)
    want_key = _posterdb_title_match_key(term, year_val) if year_val is not None else ""

    def _page_url(page: int) -> str:
        base = f"https://theposterdb.com/search?term={quote(term)}"
        return f"{base}&page={page}" if page > 1 else base

    def _fetch_page(page: int):
        emit(
            progress,
            f"Searching ThePosterDB for “{term}” (page {page})…" if page > 1 else f"Searching ThePosterDB for “{term}”…",
        )
        soup = cook_soup(_page_url(page), config=config, timeout=20)
        return page, _parse_posterdb_title_links(soup, limit=max(limit, 36))

    def _batch_has_year_match(batch: list[dict]) -> bool:
        if want_key and any(
            _posterdb_title_match_key(item.get("title") or "", item.get("year")) == want_key
            for item in batch
        ):
            return True
        if year_val is not None and title_only and any(
            _posterdb_title_matches_hint(
                item.get("title") or "",
                item.get("year"),
                title_hint=term,
                year_hint=year_val,
                media_type=media_type,
            )
            for item in batch
        ):
            return True
        return False

    page_batches: dict[int, list[dict]] = {}
    # Serial page walks only — parallel fetches shared a requests.Session (racey) and
    # hammered ThePosterDB's ~7s limiter, so Warm "logged in" then found zero title pages.
    for page in range(1, pages + 1):
        try:
            page_num, batch = _fetch_page(page)
        except Exception as exc:
            emit(progress, f"ThePosterDB search page failed: {exc}")
            continue
        page_batches[page_num] = batch
        if _batch_has_year_match(batch):
            break

    for page in sorted(page_batches):
        batch = page_batches.get(page) or []
        if not batch:
            continue
        for item in batch:
            pid = str(item.get("id") or "")
            if not pid or pid in seen:
                continue
            seen.add(pid)
            titles.append(item)
        if _batch_has_year_match(batch):
            break

    if not _skip_resolve and (tmdb_id or imdb_id or tvdb_id or len(titles) > 1):
        resolved = resolve_posterdb_title_page(
            query=term,
            title=term,
            year=year_val,
            tmdb_id=tmdb_id,
            imdb_id=imdb_id,
            tvdb_id=tvdb_id,
            media_type=media_type,
            config=config,
            progress=progress,
            limit=limit,
        )
        if resolved:
            rid = str(resolved.get("id") or "")
            if rid:
                titles = [t for t in titles if str(t.get("id") or "") != rid]
                titles.insert(0, resolved)

    # Keep year / exact matches even when they were found on later pages.
    if want_key:
        exact = [
            item for item in titles
            if _posterdb_title_match_key(item.get("title") or "", item.get("year")) == want_key
        ]
        rest = [item for item in titles if item not in exact]
        titles = exact + rest
    elif year_val is not None and title_only:
        exact = [
            item for item in titles
            if _posterdb_title_only_key(item.get("title") or "") == title_only
            and item.get("year") == year_val
        ]
        rest = [item for item in titles if item not in exact]
        titles = exact + rest

    take = max(1, int(limit or 24))
    trimmed = titles[:take]
    probe_budget = min(take, 12) if thumb_probes is None else max(0, int(thumb_probes))
    if probe_budget:
        _posterdb_enrich_title_thumbs(trimmed, config=config, progress=progress, limit=probe_budget)
    return {
        "ok": True,
        "provider": "posterdb",
        "phase": "titles",
        "query": term,
        "titles": trimmed,
        "sets": [],
    }


def _posterdb_max_page(soup) -> int:
    max_page = 1
    if not soup:
        return max_page
    for anchor in soup.find_all("a", href=True):
        href = str(anchor.get("href") or "")
        match = re.search(r"[?&]page=(\d+)", href)
        if match:
            max_page = max(max_page, int(match.group(1)))
        text = anchor.get_text(" ", strip=True)
        if text.isdigit():
            max_page = max(max_page, int(text))
    return min(max_page, 50)


def list_posterdb_sets(
    title_url: str,
    progress: ProgressFn = None,
    limit: int = 500,
    *,
    config: dict | None = None,
    tmdb_id: str | int | None = None,
    imdb_id: str | None = None,
    tvdb_id: str | int | None = None,
    title_hint: str = "",
    year_hint: int | None = None,
    media_type: str = "show",
    _depth: int = 0,
    explicit_title_url: bool = False,
    max_pages: int | None = None,
) -> dict:
    url = str(title_url or "").strip()
    # Only user-pasted URLs are explicit — resolved pages must still validate TMDB.
    explicit_url = bool(explicit_title_url)
    year_val = year_hint
    if year_val is not None and not isinstance(year_val, int):
        try:
            year_val = int(year_val)
        except Exception:
            year_val = None
    target_tmdb = str(tmdb_id or "").strip() or None
    fallback_url = url
    depth = max(0, int(_depth or 0))
    take = max(1, min(500, int(limit or 500)))

    if url and target_tmdb and not explicit_url:
        try:
            probe = _posterdb_probe_title_page(url, config=config)
            page_tmdb = str(probe.get("mediaId") or "").strip()
            if page_tmdb and page_tmdb != target_tmdb:
                emit(
                    progress,
                    f"ThePosterDB title page uses TMDB {page_tmdb}, not {target_tmdb} — trying title search…",
                )
                fallback_url = url
                url = ""
        except Exception:
            pass

    if not url and (target_tmdb or imdb_id or tvdb_id or title_hint):
        resolved = resolve_posterdb_title_page(
            query=title_hint,
            title=title_hint,
            year=year_val,
            tmdb_id=target_tmdb,
            imdb_id=imdb_id,
            tvdb_id=tvdb_id,
            media_type=media_type,
            config=config,
            progress=progress,
            limit=take,
            probe_limit=_posterdb_resolve_probe_limit(media_type, target_tmdb=target_tmdb),
        )
        resolved_url = str(resolved.get("url") or "").strip() if resolved else ""
        if resolved_url:
            url = resolved_url

    # Never fall back to a known-wrong TMDB title page when we have a target id.
    if not url and fallback_url and not target_tmdb:
        url = fallback_url

    if not url or "theposterdb.com" not in url.lower() or "/posters/" not in url.lower():
        bits = []
        if target_tmdb:
            bits.append(f"TMDB {target_tmdb}")
        if title_hint:
            bits.append(f'title "{title_hint}"')
        if year_val is not None:
            bits.append(f"year {year_val}")
        detail = f" ({', '.join(bits)})" if bits else ""
        reason = _posterdb_take_resolve_error()
        hint = (
            ""
            if _posterdb_has_credentials(config)
            else " Add ThePosterDB username/password in Poster Sets settings for TMDB advanced resolve."
        )
        # Avoid unicode ellipsis (…) — Discord/mobile often renders it as "_" and people chase a fake "/posters/_" bug.
        raise ValueError(
            f"Could not find a ThePosterDB title page (needs a /posters/<id> URL){detail}."
            + (f" Reason: {reason}." if reason else "")
            + hint
        )
    emit(progress, f"Loading sets from {url}")
    soup = cook_soup(url, config=config)
    page_title = ""
    for node in soup.find_all(["h1", "h2"]):
        text = str(node.get_text(" ", strip=True) or "").strip()
        if not text:
            continue
        lower = text.lower()
        if "theposterdb" in lower and len(text) < 24:
            continue
        page_title = text
        break
    if not page_title:
        heading = soup.find("title")
        if heading:
            page_title = heading.get_text(" ", strip=True)
    page_media_id, _ = _posterdb_page_media(soup)

    # Reject wrong title pages even after resolve (stale alsoOn URLs, fuzzy search).
    # When TVDB is present, trust the resolved page even if a mapped TMDB id disagrees.
    if (
        target_tmdb
        and not tvdb_id
        and page_media_id
        and str(page_media_id) != target_tmdb
        and not explicit_url
        and depth < 1
    ):
        emit(
            progress,
            f"ThePosterDB page TMDB {page_media_id} ≠ {target_tmdb} — re-resolving…",
        )
        resolved = resolve_posterdb_title_page(
            query=title_hint or page_title,
            title=title_hint or page_title,
            year=year_val,
            tmdb_id=target_tmdb,
            imdb_id=imdb_id,
            tvdb_id=tvdb_id,
            media_type=media_type,
            config=config,
            progress=progress,
            limit=take,
        )
        alt_url = str(resolved.get("url") or "").strip() if resolved else ""
        if alt_url and alt_url.rstrip("/") != url.rstrip("/"):
            return list_posterdb_sets(
                alt_url,
                progress=progress,
                limit=take,
                config=config,
                tmdb_id=target_tmdb,
                imdb_id=imdb_id,
                tvdb_id=tvdb_id,
                title_hint=title_hint or page_title,
                year_hint=year_val,
                media_type=media_type,
                _depth=depth + 1,
                explicit_title_url=False,
                max_pages=max_pages,
            )

    sets: dict = {}
    _collect_posterdb_set_cards(soup, sets=sets, limit=take)

    # Walk title-page pagination when TPDB splits set cards across pages.
    base_url = url.split("?", 1)[0].rstrip("/")
    max_page = _posterdb_max_page(soup)
    if max_pages is not None:
        try:
            max_page = min(max_page, max(1, int(max_pages)))
        except Exception:
            max_page = min(max_page, 1)
    for page in range(2, max_page + 1):
        if len(sets) >= take:
            break
        emit(progress, f"Loading ThePosterDB sets page {page}/{max_page}…")
        try:
            page_soup = cook_soup(f"{base_url}?page={page}", config=config)
        except Exception as exc:
            emit(progress, f"ThePosterDB sets page {page} failed: {exc}")
            break
        before = len(sets)
        _collect_posterdb_set_cards(page_soup, sets=sets, limit=take)
        if len(sets) == before:
            break

    results = list(sets.values())
    page_set_links = _posterdb_count_set_links(soup)
    if page_set_links and len(results) < page_set_links and len(results) < take:
        emit(
            progress,
            f"ThePosterDB page lists ~{page_set_links} set link(s); scraped {len(results)} card(s).",
        )

    if not results:
        if depth < 1:
            resolved = resolve_posterdb_title_page(
                query=title_hint or page_title,
                title=title_hint or page_title,
                year=year_val,
                tmdb_id=target_tmdb or page_media_id,
                imdb_id=imdb_id,
                tvdb_id=tvdb_id,
                media_type=media_type,
                config=config,
                progress=progress,
            )
            alt_url = str(resolved.get("url") or "").strip() if resolved else ""
            if alt_url and alt_url.rstrip("/") != url.rstrip("/"):
                emit(progress, f"Retrying ThePosterDB title page {alt_url}")
                return list_posterdb_sets(
                    alt_url,
                    progress=progress,
                    limit=take,
                    config=config,
                    tmdb_id=target_tmdb or page_media_id,
                    imdb_id=imdb_id,
                    tvdb_id=tvdb_id,
                    title_hint=title_hint or page_title,
                    year_hint=year_val,
                    media_type=media_type,
                    _depth=depth + 1,
                    explicit_title_url=False,
                    max_pages=max_pages,
                )

        poster_fallback = _collect_posterdb_show_posters(soup, limit=take, page_title=page_title)
        if poster_fallback:
            emit(progress, f"Using {len(poster_fallback)} individual poster(s) from ThePosterDB title page.")
            results = poster_fallback

    for item in results:
        if not item.get("title"):
            item["title"] = page_title or f"Set {item['setId']}"

    # Last-line guard: if we somehow opened a fuzzy TPDB page, drop unrelated set cards.
    # Skip when the title page itself matches the work — set cards often label creator handles.
    hint = str(title_hint or "").strip()
    page_matches_hint = bool(
        hint
        and page_title
        and _posterdb_title_matches_hint(
            page_title,
            year_val,
            title_hint=hint,
            year_hint=year_val,
            media_type=media_type,
        )
    )
    tmdb_confirmed = bool(
        target_tmdb
        and page_media_id
        and str(page_media_id) == target_tmdb
    )
    if hint and results and not page_matches_hint and not explicit_url and not tmdb_confirmed:
        hint_tokens = [
            tok
            for tok in re.sub(r"[^a-z0-9]+", " ", hint.lower()).split()
            if tok and tok not in {"the", "a", "an"}
        ]
        if hint_tokens:
            filtered = []
            for item in results:
                blob = re.sub(
                    r"[^a-z0-9]+",
                    " ",
                    str(item.get("title") or page_title or "").lower(),
                )
                blob_tokens = [tok for tok in blob.split() if tok]
                if len(hint_tokens) == 1:
                    ok = blob_tokens == hint_tokens
                else:
                    ok = any(
                        blob_tokens[i : i + len(hint_tokens)] == hint_tokens
                        for i in range(0, max(0, len(blob_tokens) - len(hint_tokens) + 1))
                    )
                if ok:
                    filtered.append(item)
            if filtered and len(filtered) != len(results):
                emit(
                    progress,
                    f"Dropped {len(results) - len(filtered)} ThePosterDB set(s) that did not match “{hint}”.",
                )
                results = filtered

    return {
        "ok": True,
        "provider": "posterdb",
        "phase": "sets",
        "titleUrl": url,
        "title": page_title or None,
        "titles": [],
        "sets": results,
    }


def _infer_set_kind(*, title: str = "", card_text: str = "") -> Optional[str]:
    blob = f"{title} {card_text}".strip().lower()
    if not blob:
        return None
    if "boxset" in blob or "box set" in blob:
        return "boxset"
    if re.search(r"\b(collection posters?|film collection|movie collection)\b", blob, re.I):
        return "collection"
    if re.search(r"\bcollections?\b", blob, re.I) and not re.search(
        r"(title\s*cards?|episode\s*cards?)", blob, re.I
    ):
        return "collection"
    if re.search(r"\b(backdrops?|backgrounds?)\b", blob, re.I):
        return "backgrounds"
    if re.search(r"(title\s*cards?|episode\s*cards?|cover\s*style|episode\s*titles?)", blob, re.I):
        return "title_cards"
    return None


def _kind_is_collections(kind: str | None) -> bool:
    raw = str(kind or "").strip().lower().replace("-", "_")
    return raw in {"collections", "collection", "boxset", "boxsets"}


def _is_collection_set(item: dict | None) -> bool:
    """True for MediUX boxsets, TPDB collection posters, and multi-title packs."""
    if not isinstance(item, dict):
        return False
    kind = str(item.get("setKind") or "").strip().lower().replace("-", "_")
    if kind in {"title_cards", "title_card", "backgrounds", "background", "backdrop", "backdrops"}:
        return False
    if kind in {"collection", "collections", "boxset", "boxsets"}:
        return True
    media = str(item.get("mediaType") or "").strip().lower()
    if media in {"collection", "collections"}:
        return True
    title = str(item.get("title") or "")
    inferred = _infer_set_kind(title=title)
    if inferred in {"collection", "boxset"}:
        return True
    try:
        count = int(item.get("posterCount") or 0)
    except Exception:
        count = 0
    # Franchise / multi-title packs are typically much larger than single-title variant sets.
    return count >= 10


def _posterdb_card_media_hint(card) -> tuple[Optional[str], Optional[str]]:
    """Return (mediaType, setKind) from TPDB Movie/Show/Collection tooltips."""
    if card is None or not hasattr(card, "find_all"):
        return None, None
    media_type = None
    try:
        tips = card.find_all("a", attrs={"data-toggle": "tooltip", "title": True})
    except Exception:
        tips = []
    for tip in tips:
        title = str(tip.get("title") or "").strip()
        if title in {"Movie", "Show", "Collection"}:
            media_type = title.lower()
            break
    if media_type == "collection":
        return media_type, "collection"
    return media_type, None


def _apply_posterdb_set_card_meta(card, entry: dict, *, title: str = "") -> None:
    media_type, collection_kind = _posterdb_card_media_hint(card)
    if media_type:
        entry["mediaType"] = media_type
    inferred = collection_kind or _infer_set_kind(title=title or str(entry.get("title") or ""))
    if inferred:
        entry["setKind"] = inferred


def _infer_mediux_set_kind_from_card(card, *, media_type: str | None = None) -> Optional[str]:
    """Infer kind from MediUX card chrome.

    Show pages use aspect-video shells for episode title-card carousels, but the same
    shell is also used for boxset backdrop rails — prefer explicit card text, and never
    treat movie landscape rails as title cards (movies have no episode title cards).
    """
    if card is None or not hasattr(card, "find_all"):
        return None
    try:
        card_text = str(card.get_text(" ", strip=True) or "").lower()
    except Exception:
        card_text = ""
    if "boxset" in card_text or "box set" in card_text:
        return "boxset"
    if re.search(r"\b(backdrops?|backgrounds?)\b", card_text):
        return "backgrounds"
    video = 0
    poster = 0
    for node in card.find_all(True):
        classes = " ".join(node.get("class") or [])
        if "aspect-video" in classes:
            video += 1
        elif "aspect-2/3" in classes:
            poster += 1
    if video > 0 and poster > 0:
        # Mixed packs (posters + episode cards). Don't hide posters behind title_cards.
        return None
    if video > poster:
        kind = str(media_type or "").strip().lower()
        if kind in {"movie", "movies"}:
            return "backgrounds"
        return "title_cards"
    return None


def _resolve_mediux_set_kind(
    *,
    title: str = "",
    card_text: str = "",
    card=None,
    media_type: str | None = None,
) -> Optional[str]:
    """Prefer explicit text labels over aspect-ratio heuristics."""
    text_kind = _infer_set_kind(title=title, card_text=card_text)
    if text_kind in {"boxset", "backgrounds", "title_cards"}:
        return text_kind
    section_kind = _infer_mediux_set_kind_from_card(card, media_type=media_type)
    return section_kind or text_kind


def _mediux_card_row(node):
    current = node
    for _ in range(12):
        if current is None:
            break
        classes = " ".join(current.get("class") or []) if hasattr(current, "get") else ""
        # Show-page rows use border-b; posters/title_cards grids use card shells.
        if "border-b" in classes or "text-card-foreground" in classes:
            return current
        current = getattr(current, "parent", None)
    return None


def _clean_mediux_set_title(value: str) -> str:
    title = str(value or "").strip()
    if not title:
        return ""
    if title.lower() in {
        "peek",
        "yaml",
        "download",
        "sets",
        "posters",
        "previous slide",
        "next slide",
        "boxset",
        "collection",
    }:
        return ""
    return title[:160]


def _title_from_mediux_card_text(card_text: str, user: str | None = None) -> str:
    text = " ".join(str(card_text or "").split()).strip()
    if not text:
        return ""
    # "2 The Shards (2026) by willtong93" / "Peek YAML Download …"
    text = re.sub(r"\b(Peek|YAML|Download|Previous slide|Next slide)\b", " ", text, flags=re.I)
    text = re.sub(r"^\d+\s+", "", text).strip()
    if user:
        text = re.sub(rf"\s+by\s+{re.escape(user)}\s*$", "", text, flags=re.I).strip()
        text = re.sub(rf"\s+{re.escape(user)}\s*$", "", text, flags=re.I).strip()
    text = re.sub(r"\s+by\s+[A-Za-z0-9._-]{1,64}\s*$", "", text, flags=re.I).strip()
    return _clean_mediux_set_title(text)


def _enrich_mediux_set_entry(anchor, entry: dict, *, media_type: str | None = None) -> None:
    """Fill creator / title / setKind from the surrounding MediUX card row."""
    card = _mediux_card_row(anchor)
    card_text = card.get_text(" ", strip=True) if card is not None else ""
    user = _extract_user_near_node(anchor)
    if user and not entry.get("user"):
        entry["user"] = user
    if (not entry.get("title") or str(entry.get("title") or "").startswith("Set ")) and card is not None:
        title = ""
        if hasattr(card, "find"):
            for tag in ("h2", "h3", "h4", "p"):
                node = card.find(tag)
                if not node:
                    continue
                title = _clean_mediux_set_title(node.get_text(" ", strip=True))
                if title:
                    break
        if not title:
            title = _title_from_mediux_card_text(card_text, entry.get("user") or user)
        if title:
            entry["title"] = title
    kind = _resolve_mediux_set_kind(
        title=str(entry.get("title") or ""),
        card_text=card_text,
        card=card,
        media_type=media_type or entry.get("mediaType"),
    )
    existing_kind = str(entry.get("setKind") or "").strip().lower()
    # Prefer definitive labels (boxset/backgrounds) over a prior aspect-video title_cards guess.
    if kind and (
        not existing_kind
        or kind == existing_kind
        or kind in {"boxset", "backgrounds"}
        or (kind == "title_cards" and existing_kind not in {"boxset", "backgrounds"})
    ):
        entry["setKind"] = kind
    elif not existing_kind:
        inferred = _infer_set_kind(title=str(entry.get("title") or ""))
        if inferred:
            entry["setKind"] = inferred
    if card is not None:
        _apply_mediux_thumb_variants(entry, card)


def _mediux_thumb_asset_key(url: str) -> str:
    raw = str(url or "").strip()
    if not raw:
        return ""
    try:
        decoded = unquote(raw)
        match = re.search(r"/assets/([^/?#]+)", decoded, re.I)
        if match:
            return match.group(1).lower()
    except Exception:
        pass
    return raw.lower()


def _collapse_mediux_near_duplicate_sets(results: list[dict]) -> list[dict]:
    """MediUX title pages repeat carousel slides as multiple /sets/ ids with the same thumb."""
    seen: set[str] = set()
    out: list[dict] = []
    for item in results:
        user = str(item.get("user") or "").strip().lower().lstrip("@")
        thumb = _mediux_thumb_asset_key(str(item.get("thumbUrl") or ""))
        if thumb and len(thumb) > 6:
            key = f"thumb:{user}:{thumb}"
        else:
            title = _posterdb_title_only_key(str(item.get("title") or ""))
            key = f"title:{user}:{title}" if title and user else f"id:{item.get('setId')}"
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def list_mediux_sets(media_type: str, tmdb_id: int | str, progress: ProgressFn = None, limit: int = 40) -> dict:
    kind = str(media_type or "movie").strip().lower()
    if kind in {"tv", "series", "show", "shows"}:
        kind = "show"
        path = "shows"
    else:
        kind = "movie"
        path = "movies"
    tmdb = str(tmdb_id or "").strip()
    if not tmdb.isdigit():
        raise ValueError("tmdbId is required for MediUX browse")
    page_url = f"https://mediux.pro/{path}/{tmdb}"
    emit(progress, f"Loading MediUX {kind} page {tmdb}…")
    try:
        soup = cook_soup(page_url)
    except RuntimeError as exc:
        msg = str(exc)
        emit(progress, f"MediUX page load failed: {msg}")
        return {
            "ok": True,
            "provider": "mediux",
            "phase": "sets",
            "titleUrl": page_url,
            "title": None,
            "titles": [],
            "sets": [],
            "partial_errors": [msg],
        }
    page_title = ""
    if soup.title:
        page_title = soup.title.get_text(" ", strip=True)
    sets: dict = {}
    for anchor in soup.find_all("a", href=True):
        href = str(anchor.get("href") or "")
        match = re.search(r"/sets/(\d+)", href)
        if not match:
            continue
        set_id = match.group(1)
        title = _clean_mediux_set_title(anchor.get_text(" ", strip=True))
        card = _mediux_card_row(anchor)
        thumb = _pick_mediux_set_thumb(card or anchor, fallback="")
        if not thumb:
            img = anchor.find("img")
            if img:
                thumb = _decode_next_image_url(img.get("src") or "")
                if not thumb:
                    thumb = img.get("src") or ""
                    if thumb.startswith("/"):
                        # Keep api.mediux asset URLs only when decoded; skip next/image paths.
                        thumb = ""
        entry = sets.get(set_id) or {
            "setId": set_id,
            "url": f"https://mediux.pro/sets/{set_id}",
            "title": "",
            "thumbUrl": "",
            "user": None,
            "posterCount": None,
            "provider": "mediux",
            "setKind": None,
        }
        if title and (not entry["title"] or entry["title"].startswith("Set ")):
            entry["title"] = title
        _enrich_mediux_set_entry(anchor, entry, media_type=kind)
        preferred = _pick_mediux_set_thumb(
            card or anchor,
            set_kind=entry.get("setKind"),
            fallback=entry.get("thumbUrl") or thumb,
        )
        if preferred:
            entry["thumbUrl"] = preferred
        elif thumb and not entry["thumbUrl"]:
            entry["thumbUrl"] = thumb
        sets[set_id] = entry
        if len(sets) >= max(1, int(limit or 40)):
            break
    results = _collapse_mediux_near_duplicate_sets(list(sets.values()))
    for item in results:
        if not item.get("title"):
            item["title"] = page_title or f"Set {item['setId']}"
        if not item.get("setKind"):
            item["setKind"] = _infer_set_kind(title=str(item.get("title") or ""))
        # Movies never ship episode title-card packs; demote aspect-video false positives.
        if kind == "movie" and str(item.get("setKind") or "").strip().lower() in {
            "title_cards",
            "title-cards",
            "titlecard",
        }:
            title_blob = str(item.get("title") or "")
            if not re.search(r"(title\s*cards?|episode\s*cards?)", title_blob, re.I):
                item["setKind"] = "backgrounds"
    return {
        "ok": True,
        "provider": "mediux",
        "phase": "sets",
        "mediaType": kind,
        "tmdbId": tmdb,
        "titleUrl": page_url,
        "title": page_title or None,
        "titles": [],
        "sets": results,
    }


def _normalize_creator_username(value: str) -> str:
    raw = str(value or "").strip()
    if raw.startswith("@"):
        raw = raw[1:].strip()
    # Accept pasted profile URLs.
    match = re.search(r"/(?:user)/([^/?#]+)", raw, re.I)
    if match:
        raw = unquote(match.group(1))
    raw = raw.strip().strip("/")
    if not raw or not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", raw):
        raise ValueError("Enter a creator username (letters, numbers, . _ -).")
    return raw


def _collect_posterdb_set_cards(soup, *, sets: dict, limit: int, default_user: str | None = None) -> None:
    for badge in soup.select("a.set_poster_count[href*='/set/']"):
        href = str(badge.get("href") or "")
        match = re.search(r"/set/(\d+)", href)
        if not match:
            continue
        set_id = match.group(1)
        if set_id in sets:
            continue
        poster_count = None
        count_text = badge.get_text(" ", strip=True)
        if count_text.isdigit():
            poster_count = int(count_text)
        card = badge
        for _ in range(8):
            if card.parent is None:
                break
            card = card.parent
            classes = card.get("class") or []
            if "hovereffect" in classes:
                break
        title = ""
        user = default_user
        thumb = ""
        title_node = card.select_one(".poster-title-correction p") if hasattr(card, "select_one") else None
        if title_node:
            title = title_node.get_text(" ", strip=True)
        user_node = card.select_one("a[href*='/user/']") if hasattr(card, "select_one") else None
        if user_node:
            user = user_node.get_text(" ", strip=True) or user
        picture = card.find("picture") if hasattr(card, "find") else None
        if picture:
            for source in picture.find_all("source", srcset=True):
                candidate = str(source.get("srcset") or "").split()[0].strip()
                if candidate and "missing_poster" not in candidate:
                    thumb = candidate
                    break
        if not thumb:
            img = card.find("img") if hasattr(card, "find") else None
            if img:
                thumb = img.get("data-src") or img.get("src") or ""
        if thumb and thumb.startswith("/"):
            thumb = _absolute_url("https://theposterdb.com", thumb)
        if thumb and "missing_poster" in thumb:
            thumb = ""
        entry = {
            "setId": set_id,
            "url": _absolute_url("https://theposterdb.com", f"/set/{set_id}"),
            "title": title or f"Set {set_id}",
            "thumbUrl": thumb,
            "user": user,
            "posterCount": poster_count,
            "provider": "posterdb",
        }
        _apply_posterdb_set_card_meta(card, entry, title=title)
        sets[set_id] = entry
        if len(sets) >= max(1, int(limit or 40)):
            return

    if len(sets) >= max(1, int(limit or 40)):
        return

    # User upload pages sometimes only expose per-poster cards with set links.
    for anchor in soup.find_all("a", href=True):
        href = str(anchor.get("href") or "")
        match = re.search(r"/set/(\d+)", href)
        if not match:
            continue
        set_id = match.group(1)
        if set_id in sets:
            continue
        title = anchor.get_text(" ", strip=True)
        thumb = ""
        img = anchor.find("img")
        if img:
            thumb = img.get("data-src") or img.get("src") or ""
            if thumb.startswith("/"):
                thumb = _absolute_url("https://theposterdb.com", thumb)
            if "missing_poster" in thumb:
                thumb = ""
        parent = getattr(anchor, "parent", None)
        entry = {
            "setId": set_id,
            "url": _absolute_url("https://theposterdb.com", f"/set/{set_id}"),
            "title": title[:160] if title else f"Set {set_id}",
            "thumbUrl": thumb,
            "user": default_user,
            "posterCount": None,
            "provider": "posterdb",
        }
        _apply_posterdb_set_card_meta(parent or anchor, entry, title=title)
        sets[set_id] = entry
        if len(sets) >= max(1, int(limit or 40)):
            return


def _mediux_thumb_from_img(img) -> str:
    if not img:
        return ""
    for attr in ("src", "data-src"):
        candidate = _decode_next_image_url(img.get(attr) or "")
        if candidate:
            return candidate
        raw = str(img.get(attr) or "")
        if "api.mediux.pro" in raw:
            return raw if raw.startswith("http") else _absolute_url("https://mediux.pro", raw)
    srcset = str(img.get("srcset") or "")
    if srcset:
        first = srcset.split(",")[0].strip().split(" ")[0]
        candidate = _decode_next_image_url(first)
        if candidate:
            return candidate
    return ""


def _mediux_img_aspect_kind(img) -> str:
    """Return 'video' (16:9 title cards/backdrops) or 'poster' (2:3) from nearest shell."""
    node = img
    for _ in range(8):
        if node is None:
            break
        classes = " ".join(node.get("class") or [])
        if "aspect-video" in classes:
            return "video"
        if "aspect-2/3" in classes or "aspect-[2/3]" in classes:
            return "poster"
        node = getattr(node, "parent", None)
    return ""


def _mediux_thumbs_from_node(node) -> list[tuple[str, str]]:
    """Collect (aspect, url) pairs for images under a MediUX card/anchor."""
    if node is None or not hasattr(node, "find_all"):
        return []
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for img in node.find_all("img"):
        url = _mediux_thumb_from_img(img)
        if not url or url in seen:
            continue
        seen.add(url)
        out.append((_mediux_img_aspect_kind(img), url))
    return out


def _mediux_thumbs_by_kind(node) -> dict[str, str]:
    """First poster (2/3) and landscape (16/9) thumbs under a MediUX card."""
    poster = ""
    landscape = ""
    for aspect, url in _mediux_thumbs_from_node(node):
        if not url:
            continue
        if aspect == "poster" and not poster:
            poster = url
        elif aspect == "video" and not landscape:
            landscape = url
    return {"poster": poster, "landscape": landscape}


def _apply_mediux_thumb_variants(entry: dict, node) -> None:
    by_kind = _mediux_thumbs_by_kind(node)
    if by_kind["poster"]:
        entry["posterThumbUrl"] = by_kind["poster"]
    if by_kind["landscape"]:
        entry["landscapeThumbUrl"] = by_kind["landscape"]


def _pick_mediux_set_thumb(
    node,
    *,
    set_kind: str | None = None,
    fallback: str = "",
) -> str:
    """Prefer landscape thumbs for title-card / backdrop packs (posters often come first in HTML)."""
    thumbs = _mediux_thumbs_from_node(node)
    kind = str(set_kind or "").strip().lower().replace("-", "_")
    prefer_video = kind in {"title_cards", "titlecard", "backgrounds", "background", "backdrop", "backdrops"}
    if prefer_video:
        for aspect, url in thumbs:
            if aspect == "video" and url:
                return url
    for _aspect, url in thumbs:
        if url:
            return url
    return str(fallback or "").strip()


def _collect_mediux_set_cards(soup, *, sets: dict, default_user: str | None = None) -> int:
    """Collect MediUX set cards from one page. Returns newly discovered count."""
    added = 0
    for anchor in soup.find_all("a", href=True):
        href = str(anchor.get("href") or "")
        match = re.search(r"/sets/(\d+)", href)
        if not match:
            continue
        set_id = match.group(1)
        title = _clean_mediux_set_title(anchor.get_text(" ", strip=True))
        card = _mediux_card_row(anchor)
        thumb = _pick_mediux_set_thumb(card or anchor, fallback=_mediux_thumb_from_img(anchor.find("img")))
        if not thumb:
            parent = anchor.parent
            for _ in range(6):
                if parent is None:
                    break
                thumb = _pick_mediux_set_thumb(parent)
                if thumb:
                    break
                if not title:
                    heading_node = parent.find(["h2", "h3", "h4"]) if hasattr(parent, "find") else None
                    if heading_node:
                        title = _clean_mediux_set_title(heading_node.get_text(" ", strip=True)) or title
                parent = parent.parent

        existing = sets.get(set_id)
        if existing:
            if title and (not existing.get("title") or existing["title"].startswith("Set ")):
                existing["title"] = title
            _enrich_mediux_set_entry(anchor, existing)
            preferred = _pick_mediux_set_thumb(
                card or anchor,
                set_kind=existing.get("setKind"),
                fallback=existing.get("thumbUrl") or thumb,
            )
            if preferred:
                existing["thumbUrl"] = preferred
            _apply_mediux_thumb_variants(existing, card or anchor)
            if default_user and not existing.get("user"):
                existing["user"] = default_user
            continue

        entry = {
            "setId": set_id,
            "url": f"https://mediux.pro/sets/{set_id}",
            "title": title or f"Set {set_id}",
            "thumbUrl": thumb,
            "user": default_user,
            "posterCount": None,
            "provider": "mediux",
            "setKind": None,
        }
        _enrich_mediux_set_entry(anchor, entry)
        if not entry.get("setKind"):
            entry["setKind"] = _infer_set_kind(title=str(entry.get("title") or ""))
        preferred = _pick_mediux_set_thumb(
            card or anchor,
            set_kind=entry.get("setKind"),
            fallback=entry.get("thumbUrl") or thumb,
        )
        if preferred:
            entry["thumbUrl"] = preferred
        _apply_mediux_thumb_variants(entry, card or anchor)
        sets[set_id] = entry
        added += 1
    return added


def _mediux_max_page(soup) -> int:
    max_page = 1
    for anchor in soup.find_all("a", href=True):
        href = str(anchor.get("href") or "")
        match = re.search(r"[?&]page=(\d+)", href)
        if match:
            max_page = max(max_page, int(match.group(1)))
        text = anchor.get_text(" ", strip=True)
        if text.isdigit():
            max_page = max(max_page, int(text))
    return max_page


def _filter_creator_sets(items: list, *, kind: str = "posters", take: int = 0) -> list:
    results = list(items or [])
    if _kind_is_collections(kind):
        results = [item for item in results if _is_collection_set(item)]
    if take:
        return results[:take]
    return results


def list_posterdb_user_sets(
    username: str,
    progress: ProgressFn = None,
    limit: int = 0,
    max_pages: int = 0,
    *,
    kind: str = "posters",
    on_batch: BatchFn = None,
    batch_pages: int = 3,
) -> dict:
    user = _normalize_creator_username(username)
    base = f"https://theposterdb.com/user/{quote(user)}"
    emit(progress, f"Loading ThePosterDB creator @{user}…")
    first_url = f"{base}?section=uploads&page=1"
    soup = cook_soup(first_url)
    page_count = scrape_posterd_user_info(soup) or 1
    # Cap runaway creators; UI paginates the returned set list.
    hard_cap = max(1, int(max_pages or 80))
    pages = min(max(1, int(page_count)), hard_cap)
    take = max(0, int(limit or 0)) or 10_000
    want_collections = _kind_is_collections(kind)
    collect_limit = take if not want_collections else max(take, 10_000)
    step = max(1, int(batch_pages or 3))
    sets: dict = {}
    last_emitted = 0
    pages_in_batch = 0
    last_page = 1
    empty_collection_pages = 0

    def visible_sets() -> list:
        return _filter_creator_sets(list(sets.values()), kind=kind, take=take)

    def flush_batch(*, done: bool = False, force: bool = False) -> None:
        nonlocal last_emitted, pages_in_batch
        if not on_batch:
            return
        if not force and not done and pages_in_batch < step:
            return
        visible = visible_sets()
        chunk = visible[last_emitted:]
        if not chunk and not done:
            pages_in_batch = 0
            return
        last_emitted = len(visible)
        pages_in_batch = 0
        on_batch({
            "provider": "posterdb",
            "phase": "sets",
            "mode": "creator",
            "query": user,
            "title": f"@{user}",
            "titleUrl": base,
            "sets": chunk,
            "allSets": visible,
            "pagesFetched": last_page,
            "pagesAvailable": page_count,
            "done": done,
            "loading": not done,
        })

    _collect_posterdb_set_cards(soup, sets=sets, limit=collect_limit, default_user=user)
    pages_in_batch = 1
    flush_batch()
    stagnant = 0
    for page in range(2, pages + 1):
        before = len(sets)
        before_visible = len(visible_sets())
        if not want_collections and before >= take:
            break
        if want_collections and before_visible >= take:
            break
        emit(progress, f"Creator page {page}/{pages}…")
        soup = cook_soup(f"{base}?section=uploads&page={page}")
        _collect_posterdb_set_cards(soup, sets=sets, limit=collect_limit, default_user=user)
        last_page = page
        pages_in_batch += 1
        flush_batch()
        if want_collections:
            if len(visible_sets()) == before_visible:
                empty_collection_pages += 1
                if last_page >= 3 and empty_collection_pages >= 3:
                    emit(progress, f"Stopping @{user} after {page} pages — no more collection sets.")
                    break
            else:
                empty_collection_pages = 0
        if len(sets) == before:
            stagnant += 1
            if stagnant >= 3:
                emit(progress, f"Stopping early after {page} pages — no new sets.")
                break
        else:
            stagnant = 0
    flush_batch(done=True, force=True)
    results = visible_sets()
    if not results and not want_collections:
        raise ValueError(f"No sets found for ThePosterDB creator @{user}. Check the username.")
    return {
        "ok": True,
        "provider": "posterdb",
        "phase": "sets",
        "mode": "creator",
        "query": user,
        "title": f"@{user}",
        "titleUrl": base,
        "titles": [],
        "sets": results,
        "pagesFetched": last_page,
        "pagesAvailable": page_count,
        "kind": "collections" if want_collections else "posters",
    }


def list_mediux_user_sets(
    username: str,
    progress: ProgressFn = None,
    limit: int = 0,
    max_pages: int = 0,
    *,
    kind: str = "posters",
    on_batch: BatchFn = None,
    batch_pages: int = 3,
) -> dict:
    user = _normalize_creator_username(username)
    page_url = f"https://mediux.pro/user/{quote(user)}/sets"
    emit(progress, f"Loading MediUX creator @{user}…")
    soup = cook_soup(page_url)
    page_title = ""
    heading = soup.find(["h1", "h2"])
    if heading:
        page_title = heading.get_text(" ", strip=True)
    elif soup.title:
        page_title = soup.title.get_text(" ", strip=True)
    hard_cap = max(1, int(max_pages or 60))
    pages = min(_mediux_max_page(soup), hard_cap)
    take = max(0, int(limit or 0)) or 10_000
    want_collections = _kind_is_collections(kind)
    step = max(1, int(batch_pages or 3))
    sets: dict = {}
    last_emitted = 0
    pages_in_batch = 0
    last_page = 1
    empty_collection_pages = 0

    def visible_sets() -> list:
        return _filter_creator_sets(list(sets.values()), kind=kind, take=take)

    def flush_batch(*, done: bool = False, force: bool = False) -> None:
        nonlocal last_emitted, pages_in_batch
        if not on_batch:
            return
        if not force and not done and pages_in_batch < step:
            return
        visible = visible_sets()
        chunk = visible[last_emitted:]
        if not chunk and not done:
            pages_in_batch = 0
            return
        last_emitted = len(visible)
        pages_in_batch = 0
        on_batch({
            "provider": "mediux",
            "phase": "sets",
            "mode": "creator",
            "query": user,
            "title": page_title or f"@{user}",
            "titleUrl": page_url,
            "sets": chunk,
            "allSets": visible,
            "pagesFetched": last_page,
            "pagesAvailable": pages,
            "done": done,
            "loading": not done,
        })

    _collect_mediux_set_cards(soup, sets=sets, default_user=user)
    pages_in_batch = 1
    flush_batch()
    for page in range(2, pages + 1):
        before_visible = len(visible_sets())
        if not want_collections and len(sets) >= take:
            break
        if want_collections and before_visible >= take:
            break
        emit(progress, f"MediUX creator page {page}/{pages}…")
        soup = cook_soup(f"{page_url}?page={page}")
        added = _collect_mediux_set_cards(soup, sets=sets, default_user=user)
        last_page = page
        pages_in_batch += 1
        # Pagination links may under-report; keep going while pages add sets.
        pages = max(pages, min(_mediux_max_page(soup), hard_cap))
        flush_batch()
        if want_collections:
            if len(visible_sets()) == before_visible:
                empty_collection_pages += 1
                if last_page >= 3 and empty_collection_pages >= 3:
                    emit(progress, f"Stopping @{user} after {page} pages — no more collection sets.")
                    break
            else:
                empty_collection_pages = 0
        if added <= 0:
            break
    flush_batch(done=True, force=True)
    results = visible_sets()
    if not results and not want_collections:
        raise ValueError(f"No sets found for MediUX creator @{user}. Check the username.")
    return {
        "ok": True,
        "provider": "mediux",
        "phase": "sets",
        "mode": "creator",
        "query": user,
        "title": page_title or f"@{user}",
        "titleUrl": page_url,
        "titles": [],
        "sets": results,
        "pagesFetched": last_page,
        "kind": "collections" if want_collections else "posters",
    }


def _posterdb_list_max_page(soup, path: str = "recent") -> int:
    needle = str(path or "recent").strip("/").lower() or "recent"
    max_page = 1
    if soup is None:
        return max_page
    for anchor in soup.find_all("a", href=True):
        href = str(anchor.get("href") or "")
        href_l = href.lower()
        if f"/{needle}" not in href_l and needle not in href_l:
            if "page=" not in href_l:
                continue
        match = re.search(r"[?&]page=(\d+)", href)
        if match:
            max_page = max(max_page, int(match.group(1)))
        text = anchor.get_text(" ", strip=True)
        if text.isdigit():
            max_page = max(max_page, int(text))
    return max_page


def _posterdb_has_next_page(soup, path: str = "recent", current: int = 1) -> bool:
    """TPDB /recent and /feed only render Previous/Next — no last-page number."""
    if soup is None:
        return False
    if soup.select_one("a[rel='next'][href]"):
        return True
    return _posterdb_list_max_page(soup, path) > max(1, int(current or 1))


def _posterdb_catalog_page_target(
    soup,
    path: str,
    *,
    current: int,
    added: int,
    hard_cap: int,
) -> int:
    page = max(1, int(current or 1))
    target = max(page, _posterdb_list_max_page(soup, path))
    # A full grid (TPDB shows 24) means another page even if the pager was stripped.
    if _posterdb_has_next_page(soup, path, page) or int(added or 0) >= 20:
        target = max(target, page + 1)
    return min(max(1, target), max(1, int(hard_cap or 1)))


def _posterdb_soup_looks_like_login(soup) -> bool:
    if soup.select_one("input[type='password'], input[name='password']") and soup.select_one("form"):
        return True
    if soup.select("a.set_poster_count[href*='/set/']"):
        return False
    text = soup.get_text(" ", strip=True).lower()
    return "sign in" in text and "password" in text


def _posterdb_can_attempt_following(config: dict | None = None) -> bool:
    if _posterdb_should_use_login(config):
        return True
    if _posterdb_session_file_exists(config):
        return True
    config = config if isinstance(config, dict) else {}
    user = str(config.get("tpdb_username") or config.get("tpdb_login") or "").strip()
    password = str(config.get("tpdb_password") or "").strip()
    if not user or not password or password == "********":
        return False
    return _POSTERDB_SESSIONS.get(_posterdb_session_cache_key(user, password)) is not None


def _posterdb_following_blocked_error(config: dict | None, soup, url: str = "") -> Optional[str]:
    html = ""
    try:
        html = str(soup) if soup is not None else ""
    except Exception:
        html = ""
    last = str(_POSTERDB_LOGIN_LAST_ERROR or "").strip()
    if _posterdb_page_looks_like_challenge(html, url):
        return last or _posterdb_cloudflare_help()
    if soup is None:
        return last or None
    if _posterdb_soup_looks_like_login(soup):
        if last:
            return last
        if _posterdb_should_use_login(config) or _posterdb_session_file_exists(config):
            return _posterdb_cloudflare_help()
        return (
            "ThePosterDB following feed needs a logged-in session. "
            "Add TPDB credentials in Poster Sets → Settings, or paste browser cookies "
            "under Settings → Import TPDB browser cookies."
        )
    if soup.select("a.set_poster_count[href*='/set/']"):
        return None
    if _posterdb_html_looks_logged_in(html, url):
        return None
    if last:
        return last
    if _posterdb_should_use_login(config) or _posterdb_session_file_exists(config):
        return _posterdb_cloudflare_help()
    return None


def _posterdb_catalog_meta(kind: str) -> dict:
    key = str(kind or "recent").strip().lower()
    if key in {"feed", "following", "following_feed", "follows"}:
        return {
            "kind": "feed",
            "path": "feed",
            "mode": "feed",
            "query": "feed",
            "title": "ThePosterDB · Following",
            "titleUrl": "https://theposterdb.com/feed",
            "progress": "Loading ThePosterDB following feed…",
            "page_progress": "Following feed page",
            "empty": (
                "No sets in your ThePosterDB following feed. Log in under Poster Sets → Settings, "
                "and follow creators on ThePosterDB."
            ),
            "login": (
                "ThePosterDB following feed needs a logged-in session. "
                "Add TPDB credentials in Poster Sets → Settings, or paste browser cookies "
                "under Settings → Import TPDB browser cookies. Portal login is not enough."
            ),
            "require_login": True,
        }
    return {
        "kind": "recent",
        "path": "recent",
        "mode": "recent",
        "query": "recent",
        "title": "ThePosterDB · Recently added",
        "titleUrl": "https://theposterdb.com/recent",
        "progress": "Loading ThePosterDB recently added…",
        "page_progress": "Recently added page",
        "empty": "No recently added sets found on ThePosterDB.",
        "login": "",
        "require_login": False,
    }


def _posterdb_recent_max_page(soup) -> int:
    return _posterdb_list_max_page(soup, "recent")


def list_posterdb_recent_sets(
    progress: ProgressFn = None,
    limit: int = 0,
    max_pages: int = 0,
    *,
    kind: str = "recent",
    on_batch: BatchFn = None,
    batch_pages: int = 3,
    config: dict | None = None,
) -> dict:
    """Stream ThePosterDB /recent or /feed pages in one scrape (same pattern as creator catalogs)."""
    meta = _posterdb_catalog_meta(kind)
    config = config if isinstance(config, dict) else {}
    if meta["require_login"] and not _posterdb_can_attempt_following(config):
        raise ValueError(meta["login"])
    hard_cap = max(1, int(max_pages or 80))
    take = max(0, int(limit or 0)) or 10_000
    step = max(1, int(batch_pages or 3))
    sets: dict = {}
    last_emitted = 0
    pages_in_batch = 0
    last_page = 1
    page_count = 1
    path = meta["path"]
    first_url = f"https://theposterdb.com/{path}?page=1"

    def visible_sets() -> list:
        return list(sets.values())[:take]

    def flush_batch(*, done: bool = False, force: bool = False) -> None:
        nonlocal last_emitted, pages_in_batch
        if not on_batch:
            return
        if not force and not done and pages_in_batch < step:
            return
        visible = visible_sets()
        chunk = visible[last_emitted:]
        if not chunk and not done:
            pages_in_batch = 0
            return
        last_emitted = len(visible)
        pages_in_batch = 0
        on_batch({
            "provider": "posterdb",
            "phase": "sets",
            "mode": meta["mode"],
            "query": meta["query"],
            "title": meta["title"],
            "titleUrl": meta["titleUrl"],
            "sets": chunk,
            "allSets": visible,
            "pagesFetched": last_page,
            "pagesAvailable": page_count,
            "done": done,
            "loading": not done,
        })

    emit(progress, meta["progress"])
    soup = cook_soup(first_url, config=config)
    if meta["require_login"]:
        blocked = _posterdb_following_blocked_error(config, soup, first_url)
        if blocked:
            raise ValueError(blocked)
    before = 0
    _collect_posterdb_set_cards(soup, sets=sets, limit=take)
    added = len(sets) - before
    last_page = 1
    page = 1
    page_count = _posterdb_catalog_page_target(
        soup, path, current=1, added=added, hard_cap=hard_cap,
    )
    pages_in_batch = 1
    flush_batch()
    stagnant = 0
    while page < page_count and len(sets) < take:
        page += 1
        emit(progress, f"{meta['page_progress']} {page}/{page_count}…")
        soup = cook_soup(f"https://theposterdb.com/{path}?page={page}", config=config)
        if meta["require_login"] and _posterdb_following_blocked_error(config, soup, f"https://theposterdb.com/{path}?page={page}"):
            break
        before = len(sets)
        _collect_posterdb_set_cards(soup, sets=sets, limit=take)
        added = len(sets) - before
        last_page = page
        pages_in_batch += 1
        page_count = min(
            hard_cap,
            max(
                page_count,
                _posterdb_catalog_page_target(
                    soup, path, current=page, added=added, hard_cap=hard_cap,
                ),
            ),
        )
        flush_batch()
        if added <= 0:
            stagnant += 1
            if stagnant >= 3:
                emit(progress, f"Stopping {path} scrape after {page} pages — no new sets.")
                break
        else:
            stagnant = 0
    flush_batch(done=True, force=True)
    results = visible_sets()
    if not results:
        if meta["require_login"]:
            blocked = _posterdb_following_blocked_error(config, soup, first_url)
            if blocked:
                raise ValueError(blocked)
        raise ValueError(meta["empty"])
    return {
        "ok": True,
        "provider": "posterdb",
        "phase": "sets",
        "mode": meta["mode"],
        "query": meta["query"],
        "title": meta["title"],
        "titleUrl": meta["titleUrl"],
        "titles": [],
        "sets": results,
        "pagesFetched": last_page,
        "pagesAvailable": page_count,
        "kind": "posters",
    }


def list_recent_sets(
    provider: str,
    *,
    kind: str = "posters",
    page: int = 1,
    limit: int = 24,
    progress: ProgressFn = None,
) -> dict:
    """One page of recently-added sets for Browse rails (creators included)."""
    source = str(provider or "").strip().lower()
    if source in {"tpdb", "posterdb", "theposterdb"}:
        source = "posterdb"
    elif source in {"mediux", "mediaux"}:
        source = "mediux"
    else:
        raise ValueError("provider must be mediux or posterdb")

    rail_kind = str(kind or "posters").strip().lower()
    if rail_kind in {"title_card", "title-cards", "titlecards", "title_cards"}:
        rail_kind = "title_cards"
    else:
        rail_kind = "posters"

    page_num = max(1, int(page or 1))
    take = max(1, min(int(limit or 24), 200))
    sets: dict = {}

    if source == "posterdb":
        if rail_kind == "title_cards":
            raise ValueError("ThePosterDB browse does not have a title-cards rail")
        url = f"https://theposterdb.com/recent?page={page_num}"
        emit(progress, f"Loading ThePosterDB recently added (page {page_num})…")
        soup = cook_soup(url)
        # Collect a full recent page (typically ~24), then trim only if caller asked for fewer.
        _collect_posterdb_set_cards(soup, sets=sets, limit=max(take, 48))
        max_page = _posterdb_recent_max_page(soup)
        results = list(sets.values())[:take]
        has_more = len(results) > 0 and (page_num < max_page or len(results) >= max(8, take // 2))
        return {
            "ok": True,
            "provider": "posterdb",
            "phase": "sets",
            "mode": "recent",
            "kind": "posters",
            "page": page_num,
            "maxPage": max_page,
            "hasMore": has_more,
            "nextPage": page_num + 1 if has_more else None,
            "titles": [],
            "sets": results,
        }

    path = "title_cards" if rail_kind == "title_cards" else "posters"
    url = f"https://mediux.pro/{path}?page={page_num}"
    emit(progress, f"Loading MediUX {path.replace('_', ' ')} (page {page_num})…")
    soup = cook_soup(url)
    _collect_mediux_set_cards(soup, sets=sets)
    max_page = _mediux_max_page(soup)
    results = list(sets.values())
    if rail_kind == "title_cards":
        for item in results:
            item["setKind"] = "title_cards"
    # Keep the full provider page so background fill does not skip cards.
    has_more = len(results) > 0 and (page_num < max_page or len(results) >= 8)
    return {
        "ok": True,
        "provider": "mediux",
        "phase": "sets",
        "mode": "recent",
        "kind": rail_kind,
        "page": page_num,
        "maxPage": max_page,
        "hasMore": has_more,
        "nextPage": page_num + 1 if has_more else None,
        "titles": [],
        "sets": results,
    }


def search_catalog(
    provider: str,
    *,
    query: str = "",
    title_url: str = "",
    media_type: str = "movie",
    tmdb_id: str | int | None = None,
    imdb_id: str | None = None,
    tvdb_id: str | int | None = None,
    title_hint: str = "",
    year_hint: int | None = None,
    mode: str = "title",
    kind: str = "posters",
    page: int = 1,
    limit: int = 24,
    progress: ProgressFn = None,
    on_batch: BatchFn = None,
    batch_pages: int = 3,
    config: dict | None = None,
    max_set_pages: int | None = None,
    titles_only: bool = False,
) -> dict:
    """Scrape MediUX / ThePosterDB discovery pages (user-initiated only).

    titles_only: fast title-picker pass — one public search page, no page resolve,
    no thumb probes, no set loading. Sets are fetched later when the user opens a title.
    """
    config = config if isinstance(config, dict) else {}
    source = str(provider or "").strip().lower()
    if source in {"tpdb", "posterdb", "theposterdb"}:
        source = "posterdb"
    elif source in {"mediux", "mediaux"}:
        source = "mediux"
    else:
        raise ValueError("provider must be mediux or posterdb")

    search_mode = str(mode or "title").strip().lower()
    if search_mode in {"recent", "browse", "recently_added", "recently-added", "feed", "following", "following_feed", "follows"}:
        catalog_kind = "feed" if search_mode in {"feed", "following", "following_feed", "follows"} else "recent"
        streaming_catalog = on_batch is not None and source == "posterdb"
        if streaming_catalog:
            extra = {}
            if max_set_pages is not None:
                extra["max_pages"] = int(max_set_pages)
            return list_posterdb_recent_sets(
                progress=progress,
                limit=max(0, int(limit or 0)),
                kind=catalog_kind,
                on_batch=on_batch,
                batch_pages=batch_pages,
                config=config,
                **extra,
            )
        if catalog_kind == "feed":
            return list_posterdb_recent_sets(
                progress=progress,
                limit=max(0, int(limit or 0)) or 24,
                kind="feed",
                config=config,
            )
        return list_recent_sets(
            source,
            kind=kind or query or "posters",
            page=page,
            limit=limit if limit else 24,
            progress=progress,
        )
    if search_mode in {"creator", "user", "author", "uploader"}:
        if not str(query or "").strip():
            raise ValueError("creator username is required")
        # Creator mode: pull paginated set catalogs (limit 0 = practically unbounded).
        creator_limit = max(0, int(limit or 0))
        kind_value = str(kind or "posters").strip().lower()
        extra = {}
        if max_set_pages is not None:
            extra["max_pages"] = int(max_set_pages)
        if source == "posterdb":
            return list_posterdb_user_sets(
                query,
                progress=progress,
                limit=creator_limit,
                kind=kind_value,
                on_batch=on_batch,
                batch_pages=batch_pages,
                **extra,
            )
        return list_mediux_user_sets(
            query,
            progress=progress,
            limit=creator_limit,
            kind=kind_value,
            on_batch=on_batch,
            batch_pages=batch_pages,
            **extra,
        )

    if source == "posterdb":
        year_val = year_hint
        if year_val is not None and not isinstance(year_val, int):
            try:
                year_val = int(year_val)
            except Exception:
                year_val = None
        title_url_value = str(title_url or "").strip()
        user_title_url = title_url_value
        take = max(1, min(500, int(limit or 500)))

        if titles_only and not title_url_value:
            # Fast title picker: one public search page, no /posters resolve,
            # no thumb probes, no set-page loads. Full resolve runs on open.
            search_term = str(query or title_hint or "").strip()
            if not search_term:
                raise ValueError("query or title hint is required for ThePosterDB title search")
            titles: list[dict] = []
            seen_ids: set[str] = set()
            for term in (_posterdb_search_terms_from_hint(search_term) or [search_term])[:1]:
                part = search_posterdb_titles(
                    term,
                    progress=progress,
                    limit=take,
                    config=config,
                    media_type=media_type,
                    _skip_resolve=True,
                    max_pages=1,
                    year_hint=year_val if term == search_term else None,
                    thumb_probes=0,
                )
                for item in part.get("titles") or []:
                    pid = str(item.get("id") or "")
                    if not pid or pid in seen_ids:
                        continue
                    seen_ids.add(pid)
                    titles.append(item)
            return {
                "ok": True,
                "provider": "posterdb",
                "phase": "titles",
                "query": search_term,
                "titles": titles[:max(1, min(40, take))],
                "sets": [],
            }

        resolved_page: Optional[dict] = None
        if not title_url_value and (tmdb_id or tvdb_id or imdb_id):
            resolved_page = resolve_posterdb_title_page(
                query=title_hint or query,
                title=title_hint or query,
                year=year_val,
                tmdb_id=tmdb_id,
                imdb_id=imdb_id,
                tvdb_id=tvdb_id,
                media_type=media_type,
                config=config,
                progress=progress,
                limit=take,
            )
            title_url_value = str(resolved_page.get("url") or "").strip() if resolved_page else ""
            if not title_url_value and _posterdb_should_use_login(config):
                id_label = (
                    f"TMDB {tmdb_id}" if tmdb_id
                    else (f"TVDB {tvdb_id}" if tvdb_id else f"IMDb {imdb_id}")
                )
                emit(
                    progress,
                    f"ThePosterDB could not resolve a /posters/ page for {id_label} "
                    "(advanced search empty — trying public text search).",
                )
        if title_url_value:
            try:
                loaded = list_posterdb_sets(
                    title_url_value,
                    progress=progress,
                    limit=take,
                    config=config,
                    tmdb_id=tmdb_id,
                    imdb_id=imdb_id,
                    tvdb_id=tvdb_id,
                    title_hint=title_hint,
                    year_hint=year_val,
                    media_type=media_type,
                    # User-pasted URLs only — resolved pages still validate TMDB.
                    explicit_title_url=bool(user_title_url),
                    max_pages=max_set_pages,
                )
            except Exception as exc:
                emit(progress, f"ThePosterDB set load failed: {exc}")
                loaded = {"ok": False, "sets": [], "titles": []}
            if loaded.get("sets"):
                return loaded
            if user_title_url:
                return loaded
            emit(progress, "ThePosterDB title page returned no sets — trying title search…")
        search_term = str(query or title_hint or "").strip()
        if not search_term:
            raise ValueError("query or title hint is required for ThePosterDB title search")
        titles: list[dict] = []
        seen_ids: set[str] = set()
        fallback_pages = 8 if tmdb_id else 5
        if (config or {}).get("_posterdb_warm") and not _posterdb_should_use_login(config):
            fallback_pages = 2
        for term in _posterdb_search_terms_from_hint(search_term) or [search_term]:
            part = search_posterdb_titles(
                term,
                progress=progress,
                limit=take,
                config=config,
                tmdb_id=None,
                imdb_id=imdb_id,
                tvdb_id=tvdb_id,
                media_type=media_type,
                _skip_resolve=True,
                max_pages=fallback_pages,
                year_hint=year_val if term == search_term else None,
            )
            for item in part.get("titles") or []:
                pid = str(item.get("id") or "")
                if not pid or pid in seen_ids:
                    continue
                seen_ids.add(pid)
                titles.append(item)
        result = {
            "ok": True,
            "provider": "posterdb",
            "phase": "titles",
            "query": search_term,
            "titles": titles[:max(1, min(40, take))],
            "sets": [],
        }
        picked = _pick_posterdb_title_candidate(
            titles,
            title_hint=title_hint or search_term,
            year_hint=year_val,
            media_type=media_type,
        )
        picked_url = str(picked.get("url") or "").strip() if picked else ""
        if picked_url:
            try:
                return list_posterdb_sets(
                    picked_url,
                    progress=progress,
                    limit=take,
                    config=config,
                    tmdb_id=tmdb_id,
                    imdb_id=imdb_id,
                    tvdb_id=tvdb_id,
                    title_hint=title_hint or search_term,
                    year_hint=year_val,
                    media_type=media_type,
                    explicit_title_url=False,
                    max_pages=max_set_pages,
                )
            except Exception as exc:
                emit(progress, f"ThePosterDB set load failed: {exc}")
        for item in titles:
            alt_url = str(item.get("url") or "").strip()
            if not alt_url or alt_url == picked_url:
                continue
            if not _posterdb_title_matches_hint(
                item.get("title") or "",
                item.get("year"),
                title_hint=title_hint or search_term,
                year_hint=year_val,
                media_type=media_type,
            ):
                continue
            try:
                return list_posterdb_sets(
                    alt_url,
                    progress=progress,
                    limit=take,
                    config=config,
                    tmdb_id=tmdb_id,
                    imdb_id=imdb_id,
                    tvdb_id=tvdb_id,
                    title_hint=title_hint or search_term,
                    year_hint=year_val,
                    media_type=media_type,
                    explicit_title_url=False,
                    max_pages=max_set_pages,
                )
            except Exception as exc:
                emit(progress, f"ThePosterDB set load failed for {alt_url}: {exc}")
        partial_msg: list[str] = []
        if not _posterdb_has_credentials(config):
            emit(
                progress,
                "ThePosterDB login not configured — public search cannot match many TV titles. "
                "Add TPDB username/password in Poster Sets → Settings (advanced TMDB/TVDB search requires login).",
            )
            partial_msg.append(
                "ThePosterDB login not configured — add TPDB credentials in Poster Sets → Settings.",
            )
        elif tmdb_id:
            msg = (
                f"ThePosterDB advanced search found no sets for TMDB {tmdb_id} — "
                "check TPDB Pro/session in Settings → Test, or paste a set URL in Discover."
            )
            emit(progress, msg)
            partial_msg.append(msg)
        else:
            msg = "ThePosterDB returned no sets for this title; showing MediUX sets instead."
            emit(progress, msg)
            partial_msg.append(msg)
        result["partial_errors"] = partial_msg
        return result

    if tmdb_id:
        return list_mediux_sets(media_type, tmdb_id, progress=progress, limit=limit)
    raise ValueError("MediUX browse needs a TMDB title id (search titles in the portal first)")


def warm_library_titles(
    items: Sequence[dict] | None,
    *,
    config: dict | None = None,
    progress: ProgressFn = None,
    on_title: BatchFn = None,
) -> dict:
    """Resolve many library titles in one process (optional login, then public search).

    Login improves TMDB-id matching but is not required — title pages/sets/images are public.
    Parallel HTML workers race ThePosterDB's rate limit; keep title resolves serial here.
    """
    config = config if isinstance(config, dict) else {}
    rows = [item for item in (items or []) if isinstance(item, dict)]
    if not rows:
        return {"ok": False, "error": "No library titles provided", "results": []}

    working = dict(config)
    working["_posterdb_warm"] = True
    if _posterdb_should_use_login(working):
        session = _posterdb_http_client(working)
        if isinstance(session, requests.Session):
            emit(progress, f"Cache: TPDB login OK — resolving {len(rows)} library title(s)…")
        else:
            emit(
                progress,
                "Cache: TPDB login unavailable (Cloudflare/credentials) — "
                "continuing with public text search (no login required for posters).",
            )
            working = _posterdb_public_only_config(working)
            working["_posterdb_warm"] = True
    else:
        emit(
            progress,
            f"Cache: public text search for {len(rows)} library title(s) (TPDB login off or not set).",
        )

    results: list[dict] = []
    for index, raw in enumerate(rows):
        tmdb_id = str(raw.get("tmdbId") or raw.get("tmdb_id") or "").strip()
        title = str(raw.get("title") or "").strip()
        media_type = str(raw.get("mediaType") or raw.get("media_type") or "movie").strip().lower()
        if media_type in {"tv", "series", "show", "shows"}:
            media_type = "show"
        else:
            media_type = "movie"
        year_hint = raw.get("year") if raw.get("year") is not None else raw.get("yearHint")
        if year_hint is not None and not isinstance(year_hint, int):
            try:
                year_hint = int(year_hint)
            except Exception:
                year_hint = None
        imdb_id = str(raw.get("imdbId") or raw.get("imdb_id") or "").strip() or None
        tvdb_raw = raw.get("tvdbId") if raw.get("tvdbId") is not None else raw.get("tvdb_id")
        tvdb_id = str(tvdb_raw or "").strip() or None
        if not tmdb_id:
            tmdb_id = None
        label = (
            f"{title} ({year_hint})" if title and year_hint is not None
            else (title or (f"tmdb {tmdb_id}" if tmdb_id else f"tvdb {tvdb_id}"))
        )
        emit(progress, f"Cache [{index + 1}/{len(rows)}]: resolving {label}")

        entry: dict = {
            "ok": False,
            "tmdbId": tmdb_id,
            "tvdbId": tvdb_id,
            "title": title,
            "year": year_hint,
            "mediaType": media_type,
            "sets": [],
            "titleUrl": None,
            "softSkip": False,
            "softError": None,
        }
        if not tmdb_id and not tvdb_id:
            entry["softSkip"] = True
            entry["softError"] = "Missing TMDB and TVDB id"
            results.append(entry)
            if on_title:
                on_title({"phase": "warm-title", **entry})
            continue

        try:
            loaded = search_catalog(
                "posterdb",
                query=title,
                media_type=media_type,
                tmdb_id=tmdb_id,
                imdb_id=imdb_id or None,
                # Prefer library TheTVDB ids when present (Plex TV agents often lack TMDB).
                tvdb_id=tvdb_id or None,
                title_hint=title,
                year_hint=year_hint,
                mode="title",
                limit=_POSTERDB_WARM_SET_LIMIT,
                max_set_pages=_POSTERDB_WARM_MAX_SET_PAGES,
                progress=progress,
                config=working,
            )
            sets = list(loaded.get("sets") or [])
            entry["sets"] = sets
            entry["titleUrl"] = (
                loaded.get("titleUrl")
                or loaded.get("title_url")
                or loaded.get("url")
                or None
            )
            entry["title"] = str(loaded.get("title") or title or "").strip() or title
            if sets:
                entry["ok"] = True
                emit(progress, f"Cache [{index + 1}/{len(rows)}]: {label} → {len(sets)} set(s)")
            else:
                entry["softSkip"] = True
                entry["softError"] = (
                    _posterdb_take_resolve_error()
                    or "No ThePosterDB sets found for this title"
                )
                emit(progress, f"Cache [{index + 1}/{len(rows)}]: skipped {label} — {entry['softError']}")
        except Exception as exc:
            entry["softSkip"] = True
            entry["softError"] = str(exc)
            emit(progress, f"Cache [{index + 1}/{len(rows)}]: skipped {label} — {exc}")

        results.append(entry)
        if on_title:
            on_title({"phase": "warm-title", **entry})

    ok_count = sum(1 for item in results if item.get("ok"))
    return {
        "ok": True,
        "results": results,
        "count": len(results),
        "resolved": ok_count,
        "skipped": len(results) - ok_count,
    }


def apply_bulk(urls: Sequence[str], config: dict, progress: ProgressFn = None) -> dict:
    outcomes = []
    total = len(urls)
    emit(progress, f"Starting bulk apply ({total} URL{'s' if total != 1 else ''})")
    for index, url in enumerate(urls, start=1):
        emit(progress, f"Set {index}/{total} · {url}")
        if "/user/" in url and _url_host_matches(url, "theposterdb.com"):
            emit(progress, f"Scraping user uploads from {url}")
            soup = cook_soup(url)
            pages = scrape_posterd_user_info(soup) or 1
            cleaned = url.split("?")[0]
            for page in range(pages):
                page_url = f"{cleaned}?section=uploads&page={page + 1}"
                emit(progress, f"User page {page + 1}/{pages}")
                outcomes.append(apply_url(page_url, config, progress=progress))
        else:
            outcomes.append(apply_url(url, config, progress=progress))
    uploaded = sum(int(item.get("uploaded") or 0) for item in outcomes)
    emit(progress, f"Bulk finished — uploaded {uploaded} poster{'s' if uploaded != 1 else ''} across {len(outcomes)} set{'s' if len(outcomes) != 1 else ''}")
    return {
        "ok": uploaded > 0,
        "urls": len(urls),
        "jobs": len(outcomes),
        "uploaded": uploaded,
        "outcomes": outcomes,
        "error": None if uploaded > 0 else "Bulk apply uploaded 0 posters.",
    }
