"""Resolve Kometa overlay images from the bundled asset tree (preferred) or runtime cache.

Bundled source (vendored from Kometa):
  overlays/assets/kometa-images/  ← defaults/overlays/images from Kometa-Team/Kometa
  overlays/assets/kometa-images/fonts/  ← Inter fonts from Kometa-Team/Default-Images

Runtime cache (optional extras / fallback downloads):
  config/overlays/kometa-images/
"""

from __future__ import annotations

import json
import re
import urllib.request
from pathlib import Path
from typing import Iterable

from PIL import Image

BUNDLED_DIR = Path(__file__).resolve().parent / "assets" / "kometa-images"

KOMETA_RAW_BASE = (
    "https://raw.githubusercontent.com/Kometa-Team/Kometa/master/defaults/overlays/images"
)
KOMETA_API_BASE = (
    "https://api.github.com/repos/Kometa-Team/Kometa/contents/defaults/overlays/images"
)
KOMETA_FONT_URLS = {
    "medium": "https://raw.githubusercontent.com/Kometa-Team/Default-Images/master/Inter-Medium.ttf",
    "bold": "https://raw.githubusercontent.com/Kometa-Team/Default-Images/master/Inter-Bold.ttf",
}

_USER_AGENT = "ServerManagerPortal-Overlays/1.0"


def bundled_dir() -> Path:
    return BUNDLED_DIR


def default_cache_dir(paths: dict | None = None) -> Path:
    """Writable runtime cache (not the read-only bundled tree)."""
    if isinstance(paths, dict):
        explicit = paths.get("kometaImages") or paths.get("kometa_images")
        if explicit:
            p = Path(explicit)
            # Never treat the bundled tree as a writable cache root.
            try:
                if p.resolve() != BUNDLED_DIR.resolve():
                    return p
            except Exception:
                return p
        root = paths.get("root")
        if root:
            return Path(root) / "kometa-images"
        assets = paths.get("assets")
        if assets:
            candidate = Path(assets).parent / "kometa-images"
            try:
                if candidate.resolve() != BUNDLED_DIR.resolve():
                    return candidate
            except Exception:
                return candidate
    return Path(__file__).resolve().parent.parent / "config" / "overlays" / "kometa-images"


def _http_get(url: str, timeout: float = 10.0) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def ensure_cache_dir(cache_dir: Path | None = None, paths: dict | None = None) -> Path:
    out = Path(cache_dir) if cache_dir else default_cache_dir(paths)
    out.mkdir(parents=True, exist_ok=True)
    return out


def _clean_rel(rel: str) -> str:
    return str(rel or "").replace("\\", "/").lstrip("/")


def bundled_path(rel: str) -> Path:
    return BUNDLED_DIR / _clean_rel(rel)


def cache_path(rel: str, cache_dir: Path | None = None, paths: dict | None = None) -> Path:
    return ensure_cache_dir(cache_dir, paths) / _clean_rel(rel)


def local_path(rel: str, cache_dir: Path | None = None, paths: dict | None = None) -> Path:
    """Prefer bundled asset; otherwise the writable cache path."""
    bundled = bundled_path(rel)
    if bundled.exists() and bundled.stat().st_size > 0:
        return bundled
    return cache_path(rel, cache_dir, paths)


def fetch_image(
    rel: str,
    *,
    cache_dir: Path | None = None,
    paths: dict | None = None,
    force: bool = False,
    timeout: float = 10.0,
    allow_download: bool = True,
) -> Path | None:
    """Resolve a relative overlay image, preferring the bundled tree."""
    from urllib.parse import quote

    rel = _clean_rel(rel)
    if not rel:
        return None

    bundled = bundled_path(rel)
    if bundled.exists() and bundled.stat().st_size > 0 and not force:
        return bundled

    dest = cache_path(rel, cache_dir, paths)
    if dest.exists() and dest.stat().st_size > 0 and not force:
        return dest

    if not allow_download:
        return bundled if bundled.exists() and bundled.stat().st_size > 0 else None

    dest.parent.mkdir(parents=True, exist_ok=True)
    encoded = "/".join(quote(seg, safe="._-") for seg in rel.split("/"))
    url = f"{KOMETA_RAW_BASE}/{encoded}"
    try:
        data = _http_get(url, timeout=timeout)
    except Exception:
        return dest if dest.exists() and dest.stat().st_size > 0 else (
            bundled if bundled.exists() and bundled.stat().st_size > 0 else None
        )
    if not data:
        return None
    dest.write_bytes(data)
    return dest


def load_image(
    rel: str,
    *,
    cache_dir: Path | None = None,
    paths: dict | None = None,
) -> Image.Image | None:
    path = fetch_image(rel, cache_dir=cache_dir, paths=paths, allow_download=False)
    if path is None:
        # Bundled miss (or incomplete vendor) — one short download attempt.
        path = fetch_image(rel, cache_dir=cache_dir, paths=paths, allow_download=True, timeout=8.0)
    if not path or not path.exists():
        return None
    try:
        return Image.open(path).convert("RGBA")
    except Exception:
        return None


def ensure_font(
    *,
    cache_dir: Path | None = None,
    paths: dict | None = None,
    size: int = 42,
    weight: str = "medium",
):
    """Return a Pillow font, preferring bundled Inter, then cache, then system fonts."""
    from PIL import ImageFont

    weight_key = "bold" if str(weight).lower() in {"bold", "b", "700"} else "medium"
    filename = "Inter-Bold.ttf" if weight_key == "bold" else "Inter-Medium.ttf"
    candidates = [
        BUNDLED_DIR / "fonts" / filename,
        ensure_cache_dir(cache_dir, paths) / "fonts" / filename,
        Path(r"C:\Windows\Fonts\arialbd.ttf"),
        Path(r"C:\Windows\Fonts\segoeuib.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        Path("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"),
    ]
    for font_path in candidates[:2]:
        if font_path.exists() and font_path.stat().st_size > 1000:
            try:
                return ImageFont.truetype(str(font_path), size)
            except Exception:
                continue
    # Optional one-shot download into writable cache only.
    cache_font = ensure_cache_dir(cache_dir, paths) / "fonts" / filename
    if not cache_font.exists() or cache_font.stat().st_size < 1000:
        cache_font.parent.mkdir(parents=True, exist_ok=True)
        try:
            cache_font.write_bytes(_http_get(KOMETA_FONT_URLS[weight_key], timeout=15.0))
        except Exception:
            pass
    if cache_font.exists():
        try:
            return ImageFont.truetype(str(cache_font), size)
        except Exception:
            pass
    for candidate in candidates[2:]:
        if candidate.exists():
            try:
                return ImageFont.truetype(str(candidate), size)
            except Exception:
                continue
    return ImageFont.load_default()


def _list_github_dir(api_rel: str) -> list[dict]:
    url = f"{KOMETA_API_BASE}/{api_rel.lstrip('/')}?ref=master"
    try:
        raw = _http_get(url, timeout=12.0)
        data = json.loads(raw.decode("utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def list_network_names(
    *,
    cache_dir: Path | None = None,
    paths: dict | None = None,
    style: str = "color",
) -> list[str]:
    """List network logo basenames from the bundled tree (fallback: GitHub + cache index)."""
    bundled = BUNDLED_DIR / "network" / style
    if bundled.is_dir():
        names = sorted(p.stem for p in bundled.glob("*.png") if p.is_file())
        if names:
            return names

    root = ensure_cache_dir(cache_dir, paths)
    index = root / "indexes" / f"network-{style}.json"
    if index.exists():
        try:
            data = json.loads(index.read_text(encoding="utf-8"))
            if isinstance(data, list) and data:
                return [str(x) for x in data]
        except Exception:
            pass
    items = _list_github_dir(f"network/{style}")
    names = []
    for item in items:
        name = str(item.get("name") or "")
        if name.lower().endswith(".png"):
            names.append(name[:-4])
    if names:
        index.parent.mkdir(parents=True, exist_ok=True)
        index.write_text(json.dumps(names, indent=2) + "\n", encoding="utf-8")
    return names


def _norm(text: str) -> str:
    s = str(text or "").strip().lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", "", s)
    return s


_NETWORK_ALIASES: dict[str, str] = {
    "hbo": "HBO",
    "homeboxoffice": "HBO",
    "max": "Max",
    "hbomax": "Max",
    "netflix": "Netflix",
    "disneyplus": "Disney+",
    "disney": "Disney+",
    "amazon": "Amazon",
    "amazonprime": "Amazon",
    "primevideo": "Amazon",
    "appletv": "Apple TV+",
    "appletvplus": "Apple TV+",
    "hulu": "Hulu",
    "peacock": "Peacock",
    "paramountplus": "Paramount+",
    "paramount": "Paramount+",
    "showtime": "Showtime",
    "starz": "Starz",
    "amc": "AMC",
    "amcplus": "AMC+",
    "fx": "FX",
    "fxnetworks": "FX",
    "fox": "FOX",
    "nbc": "NBC",
    "abc": "ABC",
    "cbs": "CBS",
    "cw": "The CW",
    "thecw": "The CW",
    "bbc": "BBC",
    "bbcone": "BBC One",
    "bbctwo": "BBC Two",
    "bbcthree": "BBC Three",
    "bbcamerica": "BBC America",
    "itv": "ITV",
    "channel4": "Channel 4",
    "sky": "Sky",
    "skytv": "Sky",
    "nickelodeon": "Nickelodeon",
    "nick": "Nickelodeon",
    "cartoonnetwork": "Cartoon Network",
    "adultswim": "Adult Swim",
    "comedycentral": "Comedy Central",
    "mtv": "MTV",
    "syfy": "Syfy",
    "usa": "USA Network",
    "usanetwork": "USA Network",
    "tnt": "TNT",
    "tbs": "TBS",
    "discovery": "Discovery",
    "discoveryplus": "discovery+",
    "nationalgeographic": "National Geographic",
    "natgeo": "National Geographic",
    "history": "History",
    "historychannel": "History",
    "crunchyroll": "Crunchyroll",
    "funimation": "Funimation",
    "anime": "Crunchyroll",
    "warnerbros": "Warner Bros. Television",
    "wbd": "Max",
}


def resolve_network_key(
    label: str,
    *,
    cache_dir: Path | None = None,
    paths: dict | None = None,
    style: str = "color",
) -> str | None:
    raw = str(label or "").strip()
    if not raw:
        return None
    names = list_network_names(cache_dir=cache_dir, paths=paths, style=style)
    by_norm = {_norm(n): n for n in names}
    n = _norm(raw)
    if n in by_norm:
        return by_norm[n]
    if n in _NETWORK_ALIASES:
        alias = _NETWORK_ALIASES[n]
        an = _norm(alias)
        if an in by_norm:
            return by_norm[an]
        if alias in names:
            return alias
    for key_norm, key in by_norm.items():
        if key_norm and (key_norm in n or n in key_norm):
            if len(key_norm) >= 3 and len(n) >= 3:
                return key
    return None


def resolution_rel(
    resolution: str | None,
    *,
    hdr: bool = False,
    dolby_vision: bool = False,
    hlg: bool = False,
) -> str | None:
    """Map media flags → Kometa resolution/*.png relative path."""
    res = str(resolution or "").strip().lower().replace(" ", "")
    base = None
    if res in {"4k", "2160", "2160p", "uhd"}:
        base = "4k"
    elif res in {"1080", "1080p", "fhd"}:
        base = "1080p"
    elif res in {"720", "720p", "hd"}:
        base = "720p"
    elif res in {"576", "576p"}:
        base = "576p"
    elif res in {"480", "480p", "sd"}:
        base = "480p"
    elif res:
        base = None

    if base:
        if dolby_vision and hdr:
            name = f"{base}dvhdr.png"
        elif dolby_vision:
            name = f"{base}dv.png"
        elif hlg:
            name = f"{base}hlg.png"
        elif hdr:
            name = f"{base}hdr.png"
        else:
            name = f"{base}.png"
        return f"resolution/{name}"

    if dolby_vision and hdr:
        return "resolution/dvhdr.png"
    if dolby_vision:
        return "resolution/dv.png"
    if hlg:
        return "resolution/hlg.png"
    if hdr:
        return "resolution/hdr.png"
    return None


def atmos_rel(*, truehd: bool = False, plus: bool = False) -> str:
    if truehd:
        return "audio_codec/compact/truehd_atmos.png"
    if plus:
        return "audio_codec/compact/plus_atmos.png"
    return "audio_codec/compact/dolby_atmos.png"


def rating_logo_rel(source: str = "tmdb") -> str:
    src = str(source or "tmdb").strip().lower()
    mapping = {
        "tmdb": "rating/TMDb.png",
        "tmdb.com": "rating/TMDb.png",
        "imdb": "rating/IMDb.png",
        "audience": "rating/Audience.png",
        "critic": "rating/Critic.png",
        "rottentomatoes": "rating/Audience.png",
        "rt": "rating/Audience.png",
        "metacritic": "rating/Metacritic.png",
        "trakt": "rating/Trakt.png",
        "letterboxd": "rating/Letterboxd.png",
    }
    return mapping.get(src, "rating/TMDb.png")


def prefetch_common(
    *,
    cache_dir: Path | None = None,
    paths: dict | None = None,
    include_networks: Iterable[str] | None = None,
    progress=None,
) -> list[str]:
    """Verify common assets resolve from the bundled tree (no network when vendored)."""
    rels = [
        "resolution/4k.png",
        "resolution/4khdr.png",
        "resolution/4kdv.png",
        "resolution/4kdvhdr.png",
        "resolution/1080p.png",
        "resolution/1080phdr.png",
        "resolution/720p.png",
        "resolution/hdr.png",
        "audio_codec/compact/dolby_atmos.png",
        "audio_codec/compact/truehd_atmos.png",
        "audio_codec/compact/plus_atmos.png",
        "rating/TMDb.png",
        "rating/Audience.png",
        "rating/IMDb.png",
        "network/color/HBO.png",
        "network/color/Netflix.png",
        "network/color/Disney+.png",
        "network/color/AMC.png",
        "network/color/Max.png",
    ]
    for name in include_networks or ():
        key = resolve_network_key(name, cache_dir=cache_dir, paths=paths) or name
        rels.append(f"network/color/{key}.png")
    ok = []
    for rel in rels:
        if fetch_image(rel, cache_dir=cache_dir, paths=paths, allow_download=False):
            ok.append(rel)
    try:
        ensure_font(cache_dir=cache_dir, paths=paths, size=42)
    except Exception:
        pass
    if progress:
        progress(f"Layer bundled images: {len(ok)}/{len(rels)} common assets available")
    return ok


def stack_images(images: list[Image.Image], *, gap: int = 12, align: str = "left") -> Image.Image | None:
    imgs = [im for im in images if im is not None]
    if not imgs:
        return None
    if len(imgs) == 1:
        return imgs[0]
    width = max(im.width for im in imgs)
    height = sum(im.height for im in imgs) + gap * (len(imgs) - 1)
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    y = 0
    for im in imgs:
        if align == "center":
            x = (width - im.width) // 2
        elif align == "right":
            x = width - im.width
        else:
            x = 0
        canvas.alpha_composite(im, (x, y))
        y += im.height + gap
    return canvas
