"""Kometa-style overlay modes: media info, show status, ratings, network."""

from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable

from PIL import Image, ImageDraw

ProgressFn = Callable[[str], None]

# Kometa defaults assume 1000×1500 posters (offsets in px).
# Resolution: left/top 15,15 · Status: left/top 15,330 · Network: left/bottom 15,510
# Audio sits under resolution (~150 from top) — we stack into one media badge.
# Ratings: right/center (common TV config; wiki default is left/center).
DEFAULT_KOMETA_PLACEMENT = {
    "media": {
        "x": 0.015,
        "y": 0.01,
        "width": 0.305,
        "maxHeight": 0.18,
        "anchorX": "left",
        "anchorY": "top",
        "bottomClip": 0.0,
    },
    "status": {
        "x": 0.015,
        "y": 0.22,
        "width": 0.305,
        "maxHeight": 0.09,
        "anchorX": "left",
        "anchorY": "top",
        "bottomClip": 0.0,
    },
    "ratings": {
        "x": 0.985,
        "y": 0.50,
        "width": 0.16,
        "maxHeight": 0.14,
        "anchorX": "right",
        "anchorY": "center",
        "bottomClip": 0.0,
    },
    "network": {
        "x": 0.015,
        "y": 0.66,
        "width": 0.305,
        "maxHeight": 0.09,
        "anchorX": "left",
        "anchorY": "bottom",
        "bottomClip": 0.0,
    },
}


def _progress(progress: ProgressFn | None, message: str) -> None:
    if progress:
        progress(message)


def _as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _load_log(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        import json
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_log(path: Path, log: dict) -> None:
    import json
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(log, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _find_font(size: int, *, weight: str = "medium", paths: dict | None = None):
    try:
        from kometa_images import ensure_font
        return ensure_font(paths=paths, size=size, weight=weight)
    except Exception:
        pass
    candidates = [
        Path(r"C:\Windows\Fonts\arialbd.ttf"),
        Path(r"C:\Windows\Fonts\segoeuib.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        Path("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"),
    ]
    from PIL import ImageFont
    for path in candidates:
        if path.exists():
            try:
                return ImageFont.truetype(str(path), size)
            except Exception:
                continue
    return ImageFont.load_default()


def placement_for(config: dict | None, kind: str) -> dict:
    """Resolve placement from config.placement.<kind>, falling back to Kometa defaults."""
    defaults = DEFAULT_KOMETA_PLACEMENT.get(kind) or DEFAULT_KOMETA_PLACEMENT["media"]
    raw_root = (config or {}).get("placement") if isinstance(config, dict) else None
    raw = {}
    if isinstance(raw_root, dict):
        raw = raw_root.get(kind) if isinstance(raw_root.get(kind), dict) else {}
    out = dict(defaults)
    for key in ("x", "y", "width", "maxHeight", "bottomClip"):
        if key in raw and raw[key] is not None:
            try:
                out[key] = float(raw[key])
            except (TypeError, ValueError):
                pass
    for key, alt in (("anchorX", "anchor_x"), ("anchorY", "anchor_y")):
        val = raw.get(key) or raw.get(alt)
        if val:
            out[key] = str(val).strip().lower()
    return out


def render_pill(
    lines: list[str],
    *,
    accent: tuple[int, int, int, int] | None = None,
    width: int = 305,
    height: int = 105,
    font_size: int = 50,
    paths: dict | None = None,
) -> Image.Image:
    """Kometa-style translucent rounded pill (305×105 defaults for status/network text)."""
    lines = [str(x).strip() for x in lines if str(x).strip()]
    if not lines:
        lines = ["—"]
    # Multi-line: grow height; single-line: fixed Kometa box.
    if len(lines) == 1:
        w, h = width, height
    else:
        h_line = max(48, font_size + 16)
        pad_y = 18
        gap = 6
        w = width
        h = pad_y * 2 + h_line * len(lines) + gap * max(0, len(lines) - 1)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    bg = accent or (0, 0, 0, 153)  # #00000099
    draw.rounded_rectangle([0, 0, w - 1, h - 1], radius=30, fill=bg)
    font = _find_font(font_size, weight="medium", paths=paths)
    if len(lines) == 1:
        line = lines[0]
        bb = draw.textbbox((0, 0), line, font=font)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        draw.text(((w - tw) / 2 - bb[0], (h - th) / 2 - bb[1]), line, font=font, fill=(255, 255, 255, 255))
        return img
    h_line = max(48, font_size + 16)
    pad_y = 18
    gap = 6
    y = pad_y
    for line in lines:
        bb = draw.textbbox((0, 0), line, font=font)
        tw = bb[2] - bb[0]
        th = bb[3] - bb[1]
        draw.text(((w - tw) / 2 - bb[0], y + (h_line - th) / 2 - bb[1]), line, font=font, fill=(255, 255, 255, 255))
        y += h_line + gap
    return img


def render_media_badge(meta: dict, *, paths: dict | None = None) -> Image.Image | None:
    """Composite official Kometa resolution (+ optional Atmos) PNGs."""
    from kometa_images import atmos_rel, load_image, resolution_rel, stack_images

    res = meta.get("resolution")
    hdr = bool(meta.get("hdr"))
    dv = bool(meta.get("dolbyVision") or meta.get("dolby_vision"))
    hlg = bool(meta.get("hlg"))
    atmos = bool(meta.get("atmos"))
    truehd = bool(meta.get("truehdAtmos") or meta.get("truehd_atmos"))

    rel = resolution_rel(res, hdr=hdr, dolby_vision=dv, hlg=hlg)
    parts: list[Image.Image] = []
    if rel:
        img = load_image(rel, paths=paths)
        if img is not None:
            parts.append(img)
    if atmos:
        aimg = load_image(atmos_rel(truehd=truehd), paths=paths)
        if aimg is not None:
            parts.append(aimg)
    stacked = stack_images(parts, gap=12, align="left")
    if stacked is not None:
        return stacked
    # Offline / download failure → text fallback matching prior behavior
    lines = meta.get("lines") or []
    if not lines:
        return None
    return render_pill(lines, paths=paths)


def render_status_badge(label: str, *, paths: dict | None = None) -> Image.Image:
    """Kometa status is text-only (AIRING / RETURNING / …) on a 305×105 backdrop."""
    return render_pill([str(label or "STATUS").upper()], font_size=50, paths=paths)


def render_rating_badge(score: float, *, paths: dict | None = None, source: str = "tmdb") -> Image.Image:
    """Score text + official Kometa rating logo (TMDb / Audience / …)."""
    from kometa_images import load_image, rating_logo_rel

    text = f"{score:.1f}".rstrip("0").rstrip(".") if score < 10 else f"{score:.0f}"
    logo = load_image(rating_logo_rel(source), paths=paths)
    font = _find_font(63, weight="bold", paths=paths)
    pad = 15
    radius = 30
    gap = 12

    dummy = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    bb = dummy.textbbox((0, 0), text, font=font)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]

    logo_w = logo.width if logo is not None else 0
    logo_h = logo.height if logo is not None else 0
    content_w = logo_w + (gap if logo is not None else 0) + tw
    content_h = max(logo_h, th)
    w = content_w + pad * 2
    h = max(105, content_h + pad * 2)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=(0, 0, 0, 153))
    x = pad
    if logo is not None:
        ly = (h - logo_h) // 2
        img.alpha_composite(logo, (x, ly))
        x += logo_w + gap
    draw.text((x - bb[0], (h - th) / 2 - bb[1]), text, font=font, fill=(255, 255, 255, 255))
    return img


def render_network_badge(label: str, *, paths: dict | None = None) -> Image.Image:
    """Official Kometa network/color/{Name}.png, with text fallback."""
    from kometa_images import load_image, resolve_network_key

    key = resolve_network_key(label, paths=paths)
    if key:
        img = load_image(f"network/color/{key}.png", paths=paths)
        if img is not None:
            # Wrap in Kometa-sized translucent plate when logo is smaller than back_width
            plate_w, plate_h = 305, 105
            if img.width <= plate_w and img.height <= plate_h:
                plate = Image.new("RGBA", (plate_w, plate_h), (0, 0, 0, 0))
                draw = ImageDraw.Draw(plate)
                draw.rounded_rectangle([0, 0, plate_w - 1, plate_h - 1], radius=30, fill=(0, 0, 0, 153))
                ox = (plate_w - img.width) // 2
                oy = (plate_h - img.height) // 2
                plate.alpha_composite(img, (ox, oy))
                return plate
            return img
    return render_pill([str(label or "NETWORK")[:24]], paths=paths)


def _empty_media_info() -> dict[str, Any]:
    return {
        "resolution": None,
        "hdr": False,
        "dolbyVision": False,
        "hlg": False,
        "atmos": False,
        "truehdAtmos": False,
        "label": None,
        "lines": [],
    }


def _finalize_media_lines(info: dict[str, Any]) -> dict[str, Any]:
    lines = []
    if info["resolution"]:
        line = info["resolution"]
        if info["dolbyVision"]:
            line = f"{line} DV"
        elif info["hlg"]:
            line = f"{line} HLG"
        elif info["hdr"]:
            line = f"{line} HDR"
        lines.append(line)
    elif info["dolbyVision"]:
        lines.append("DV")
    elif info["hdr"]:
        lines.append("HDR")
    if info["atmos"]:
        lines.append("ATMOS")
    info["label"] = " · ".join(lines) if lines else None
    info["lines"] = lines
    return info


def _scan_media_objects(medias, info: dict[str, Any]) -> dict[str, Any]:
    for media in medias:
        width = getattr(media, "width", None) or 0
        try:
            width = int(width)
        except (TypeError, ValueError):
            width = 0
        vres = str(getattr(media, "videoResolution", None) or "").lower()
        res = None
        if width >= 3800 or "4k" in vres or vres in {"2160", "2160p", "uhd"} or "uhd" in vres:
            res = "4K"
        elif width >= 1800 or "1080" in vres:
            res = "1080P"
        elif width >= 1200 or "720" in vres:
            res = "720P"
        elif width > 0 or vres:
            res = (vres or "SD").upper()
        hdr = False
        dv = False
        hlg = False
        atmos = False
        truehd_atmos = False
        try:
            parts = list(getattr(media, "parts", None) or [])
        except Exception:
            parts = []
        for part in parts:
            try:
                streams = list(getattr(part, "streams", None) or [])
            except Exception:
                streams = []
            for stream in streams:
                stype = getattr(stream, "streamType", None) or getattr(stream, "type", None)
                title = str(getattr(stream, "title", "") or "")
                display = str(getattr(stream, "displayTitle", "") or "")
                codec = str(getattr(stream, "codec", "") or "")
                blob = f"{title} {display} {codec}".lower()
                if stype in (1, "1", "video") or "video" in str(stype).lower():
                    if any(x in blob for x in ("dolby vision", "dovi", "dvhe", "dvh1")):
                        dv = True
                    if str(getattr(stream, "DOVIPresent", "") or "").lower() in {"1", "true"}:
                        dv = True
                    if "hlg" in blob or str(getattr(stream, "colorTrc", "") or "").lower() in {"arib-std-b67"}:
                        hlg = True
                    if any(x in blob for x in ("hdr", "pq")) or str(getattr(stream, "colorTrc", "") or "").lower() in {"smpte2084"}:
                        hdr = True
                if stype in (2, "2", "audio") or "audio" in str(stype).lower():
                    if "atmos" in blob:
                        atmos = True
                        if "truehd" in blob:
                            truehd_atmos = True
        if res and (
            info["resolution"] is None
            or (res == "4K")
            or (res == "1080P" and info["resolution"] not in {"4K"})
        ):
            info["resolution"] = res
        info["hdr"] = info["hdr"] or hdr
        info["dolbyVision"] = info["dolbyVision"] or dv
        info["hlg"] = info["hlg"] or hlg
        info["atmos"] = info["atmos"] or atmos
        info["truehdAtmos"] = info["truehdAtmos"] or truehd_atmos
        if info["resolution"] == "4K" and (info["hdr"] or info["dolbyVision"]) and info["atmos"]:
            break
    return info


def _inspect_media(item) -> dict[str, Any]:
    """Best-effort resolution / HDR / DV / Atmos from a show (recent eps) or movie."""
    info = _empty_media_info()
    stype = str(getattr(item, "type", "") or "").lower()
    medias: list = []
    if stype == "movie" or (hasattr(item, "media") and not hasattr(item, "episodes")):
        try:
            medias = list(getattr(item, "media", None) or [])
        except Exception:
            medias = []
        _scan_media_objects(medias, info)
        return _finalize_media_lines(info)

    from kometa_detect import _show_episode_sample

    for ep in _show_episode_sample(item):
        try:
            ep_medias = list(getattr(ep, "media", None) or [])
        except Exception:
            continue
        _scan_media_objects(ep_medias, info)
        if info["resolution"] == "4K" and (info["hdr"] or info["dolbyVision"]) and info["atmos"]:
            break
    return _finalize_media_lines(info)


def _media_parts_config(config: dict | None) -> dict[str, bool]:
    defaults = {
        "res4k": True,
        "res1080p": True,
        "res720p": True,
        "resOther": False,
        "hdr": True,
        "dolbyVision": True,
        "atmos": True,
    }
    raw = {}
    if isinstance(config, dict):
        raw = config.get("mediaInfoParts") or config.get("media_info_parts") or {}
    if not isinstance(raw, dict):
        raw = {}
    out = dict(defaults)
    for key in defaults:
        snake = "".join(f"_{c.lower()}" if c.isupper() else c for c in key).lstrip("_")
        if raw.get(key) is not None:
            out[key] = _as_bool(raw.get(key), defaults[key])
        elif raw.get(snake) is not None:
            out[key] = _as_bool(raw.get(snake), defaults[key])
    return out


def _filter_media_by_parts(info: dict[str, Any], parts: dict[str, bool]) -> dict[str, Any] | None:
    """Strip disabled badge parts; return None if nothing remains to stamp."""
    filtered = dict(info)
    res = str(filtered.get("resolution") or "").upper()
    if res in {"4K", "2160", "2160P"}:
        if not parts.get("res4k", True):
            filtered["resolution"] = None
    elif res in {"1080P", "1080"}:
        if not parts.get("res1080p", True):
            filtered["resolution"] = None
    elif res in {"720P", "720"}:
        if not parts.get("res720p", True):
            filtered["resolution"] = None
    elif res:
        if not parts.get("resOther", False):
            filtered["resolution"] = None

    if not parts.get("dolbyVision", True):
        filtered["dolbyVision"] = False
    if not parts.get("hdr", True):
        filtered["hdr"] = False
        filtered["hlg"] = False
    if not parts.get("atmos", True):
        filtered["atmos"] = False
        filtered["truehdAtmos"] = False

    # If resolution was stripped but HDR/DV alone remain, keep HDR-only badges
    filtered = _finalize_media_lines(filtered)
    if not (filtered.get("lines") or []):
        return None
    return filtered


def _media_signature(info: dict[str, Any], parts: dict[str, bool] | None = None) -> str:
    parts = parts or {}
    return "|".join(
        [
            str(info.get("resolution") or ""),
            "dv" if info.get("dolbyVision") else (
                "hlg" if info.get("hlg") else ("hdr" if info.get("hdr") else "")
            ),
            "atmos" if info.get("atmos") else "",
            "truehd" if info.get("truehdAtmos") else "",
            f"p4k={1 if parts.get('res4k', True) else 0}",
            f"p1080={1 if parts.get('res1080p', True) else 0}",
            f"p720={1 if parts.get('res720p', True) else 0}",
            f"poth={1 if parts.get('resOther', False) else 0}",
            f"phdr={1 if parts.get('hdr', True) else 0}",
            f"pdv={1 if parts.get('dolbyVision', True) else 0}",
            f"patm={1 if parts.get('atmos', True) else 0}",
        ]
    )


def _mode_allow_deny(config: dict, mode: str) -> tuple[list, list]:
    maps = {
        "media": ("mediaInfoAllowKeys", "media_info_allow_keys", "mediaInfoDenyKeys", "media_info_deny_keys"),
        "status": ("statusAllowKeys", "status_allow_keys", "statusDenyKeys", "status_deny_keys"),
        "ratings": ("ratingsAllowKeys", "ratings_allow_keys", "ratingsDenyKeys", "ratings_deny_keys"),
        "network": ("networkAllowKeys", "network_allow_keys", "networkDenyKeys", "network_deny_keys"),
        "streaming": ("streamingAllowKeys", "streaming_allow_keys", "streamingDenyKeys", "streaming_deny_keys"),
        "ribbon": ("ribbonAllowKeys", "ribbon_allow_keys", "ribbonDenyKeys", "ribbon_deny_keys"),
    }
    ac, as_, dc, ds = maps.get(mode, (None, None, None, None))
    if not ac:
        return [], []
    allow = config.get(ac) if config.get(ac) is not None else config.get(as_)
    deny = config.get(dc) if config.get(dc) is not None else config.get(ds)
    return (
        [str(x).strip() for x in (allow or []) if str(x).strip()],
        [str(x).strip() for x in (deny or []) if str(x).strip()],
    )


def _sections_for_kometa_mode(plex, config: dict, mode: str):
    from core import _iter_sections, _mode_section_ids

    override = _mode_section_ids(config, mode)
    cfg = dict(config or {})
    # Explicit scope: family → kometa run list → all ([]). Do not inherit Advanced.
    cfg["librarySectionIds"] = list(override) if override is not None else []

    if mode == "media":
        include_movies = _as_bool(cfg.get("mediaInfoIncludeMovies", cfg.get("media_info_include_movies")), True)
        include_shows = _as_bool(cfg.get("mediaInfoIncludeShows", cfg.get("media_info_include_shows")), True)
        types: list[str] = []
        if include_shows:
            types.append("show")
        if include_movies:
            types.append("movie")
        if not types:
            return []
        return list(_iter_sections(plex, cfg, types=tuple(types)))
    if mode == "ratings":
        include_movies = _as_bool(cfg.get("ratingsIncludeMovies", cfg.get("ratings_include_movies")), True)
        include_shows = _as_bool(cfg.get("ratingsIncludeShows", cfg.get("ratings_include_shows")), True)
        types = []
        if include_shows:
            types.append("show")
        if include_movies:
            types.append("movie")
        if not types:
            return []
        return list(_iter_sections(plex, cfg, types=tuple(types)))
    if mode == "streaming":
        include_movies = _as_bool(cfg.get("streamingIncludeMovies", cfg.get("streaming_include_movies")), True)
        include_shows = _as_bool(cfg.get("streamingIncludeShows", cfg.get("streaming_include_shows")), True)
        types = []
        if include_shows:
            types.append("show")
        if include_movies:
            types.append("movie")
        if not types:
            return []
        return list(_iter_sections(plex, cfg, types=tuple(types)))
    if mode == "ribbon":
        include_movies = _as_bool(cfg.get("ribbonIncludeMovies", cfg.get("ribbon_include_movies")), True)
        include_shows = _as_bool(cfg.get("ribbonIncludeShows", cfg.get("ribbon_include_shows")), True)
        types = []
        if include_shows:
            types.append("show")
        if include_movies:
            types.append("movie")
        if not types:
            return []
        return list(_iter_sections(plex, cfg, types=tuple(types)))
    # status + network: shows only
    return list(_iter_sections(plex, cfg, types=("show",)))


def _show_status_label(show, *, airing_days: int = 14) -> str | None:
    status = str(getattr(show, "status", "") or "").strip().lower()
    # Detect currently airing via recent episode
    try:
        eps = list(show.episodes() or [])
    except Exception:
        eps = []
    latest = None
    for ep in reversed(eps[-15:]):
        aired = getattr(ep, "originallyAvailableAt", None)
        if aired is None:
            continue
        if isinstance(aired, datetime):
            latest = aired
        else:
            try:
                latest = datetime.combine(aired, datetime.min.time())
            except Exception:
                continue
        break
    if latest and latest >= datetime.now() - timedelta(days=max(1, airing_days)):
        return "AIRING"
    if "cancel" in status:
        return "CANCELED"
    if status in {"ended", "canceled", "cancelled"}:
        return "ENDED" if "end" in status or status == "ended" else "CANCELED"
    if status in {"continuing", "returning series", "returning"}:
        return "RETURNING"
    if latest is None and not status:
        return None
    if status:
        return "RETURNING" if "continu" in status or "return" in status else status.upper()[:12]
    return "RETURNING"


def _network_label(show) -> str | None:
    for attr in ("network", "studio"):
        val = getattr(show, attr, None)
        if val:
            text = str(val).strip()
            if text:
                return text[:24]
    return None


def _rating_value(show) -> float | None:
    for attr in ("audienceRating", "rating", "userRating"):
        val = getattr(show, attr, None)
        try:
            if val is not None:
                n = float(val)
                if n > 0:
                    return n
        except (TypeError, ValueError):
            continue
    return None


def _stamp(
    *,
    plex,
    show,
    badge: Image.Image,
    paths: dict,
    preview_mode: bool,
    progress: ProgressFn | None,
    mode: str,
    placement: dict,
    library: str = "",
    extra_meta: dict | None = None,
) -> dict:
    from modes_extra import _stamp_show_badge, _apply_with_explicit_placement
    return _stamp_show_badge(
        plex=plex,
        show=show,
        badge=badge,
        paths=paths,
        preview_mode=preview_mode,
        progress=progress,
        mode=mode,
        placement=placement,
        apply_fn=_apply_with_explicit_placement,
        library=library,
        extra_meta=extra_meta,
    )


def _run_generic_mode(
    *,
    plex,
    config: dict,
    paths: dict,
    preview_mode: bool,
    progress: ProgressFn | None,
    mode: str,
    enabled_key: str,
    enabled_snake: str,
    log_key: str,
    discover_fn,
    render_fn,
    default_enabled: bool = False,
) -> dict:
    from modes_extra import _prune_mode_when_disabled, _restore_show_mode, _clear_mode_backup

    log_path = paths[log_key]
    enabled = _as_bool(config.get(enabled_key, config.get(enabled_snake)), default_enabled)
    prefix = mode
    if not enabled:
        removed, errors, total = _prune_mode_when_disabled(
            plex, paths, mode, log_path, preview_mode, progress
        )
        return {
            f"{prefix}Enabled": False,
            f"{prefix}Added": 0,
            f"{prefix}Removed": removed,
            f"{prefix}Total": total,
            f"{prefix}Errors": errors,
            f"{prefix}Keys": [],
        }

    log = _load_log(log_path)
    skip_kometa = _as_bool(config.get("skipIfKometaOverlayLabel", config.get("skip_if_kometa_overlay_label")), True)
    place_key = {"media": "media", "status": "status", "ratings": "ratings", "network": "network"}.get(mode, mode)
    placement = placement_for(config, place_key)

    sections = _sections_for_kometa_mode(plex, config, mode)
    should = discover_fn(plex, config, sections, progress, skip_kometa=skip_kometa)

    added = removed = 0
    errors: list[str] = []
    for key, meta in sorted(should.items(), key=lambda kv: kv[0]):
        existing = log.get(key)
        try:
            badge = render_fn(meta)
            if badge is None:
                continue
            sig = str(meta.get("signature") or "")
            if existing and not preview_mode and not bool(existing.get("preview_only")):
                if sig and existing.get("signature") == sig:
                    continue
                # Signature changed — restore prior art then restamp
                try:
                    _restore_show_mode(meta["show"], paths, mode, progress)
                except Exception:
                    pass
            elif existing is None or bool((existing or {}).get("preview_only")) or preview_mode:
                pass
            else:
                continue
            entry = _stamp(
                plex=plex,
                show=meta["show"],
                badge=badge,
                paths=paths,
                preview_mode=preview_mode,
                progress=progress,
                mode=mode,
                placement=placement,
                library=meta.get("library") or "",
                extra_meta={
                    **{k: v for k, v in meta.items() if k not in {"show"}},
                    "signature": sig,
                },
            )
            if existing is None:
                log[key] = entry
                added += 1
            else:
                log[key] = {**existing, **entry, "preview_only": bool(preview_mode)}
                added += 1
        except Exception as exc:
            errors.append(f"{mode} {meta['show'].title}: {exc}")

    for key in list(log.keys()):
        if key in should:
            continue
        entry = log.get(key) or {}
        try:
            if preview_mode:
                if bool(entry.get("preview_only")):
                    del log[key]
                    removed += 1
                continue
            try:
                show = plex.fetchItem(f"/library/metadata/{key}")
            except Exception:
                del log[key]
                _clear_mode_backup(paths, mode, key)
                removed += 1
                continue
            _restore_show_mode(show, paths, mode, progress)
            del log[key]
            removed += 1
        except Exception as exc:
            errors.append(f"{mode} remove {key}: {exc}")

    _save_log(log_path, log)
    return {
        f"{prefix}Enabled": True,
        f"{prefix}Added": added,
        f"{prefix}Removed": removed,
        f"{prefix}Total": len(log),
        f"{prefix}Eligible": len(should),
        f"{prefix}Errors": errors,
        f"{prefix}Keys": list(should.keys()),
    }


def discover_media(plex, config, sections, progress=None, skip_kometa=True):
    from core import _has_kometa_overlay_label, _title_allowed

    parts = _media_parts_config(config)
    allow, deny = _mode_allow_deny(config, "media")
    should = {}
    scanned = 0
    for section in sections:
        _progress(progress, f"Media scan: {getattr(section, 'title', '?')}…")
        try:
            for item in section.all():
                scanned += 1
                if scanned % 50 == 0:
                    _progress(progress, f"Media scan: checked {scanned} titles, eligible {len(should)}…")
                key = str(getattr(item, "ratingKey", "") or "")
                if not key:
                    continue
                if not _title_allowed(key, allow, deny):
                    continue
                if skip_kometa and _has_kometa_overlay_label(item):
                    continue
                info = _inspect_media(item)
                filtered = _filter_media_by_parts(info, parts)
                if not filtered:
                    continue
                lines = filtered.get("lines") or []
                if not lines:
                    continue
                should[key] = {
                    "show": item,
                    "library": section.title,
                    "itemType": str(getattr(section, "type", "") or getattr(item, "type", "") or ""),
                    "lines": lines,
                    "resolution": filtered.get("resolution"),
                    "hdr": bool(filtered.get("hdr")),
                    "dolbyVision": bool(filtered.get("dolbyVision")),
                    "hlg": bool(filtered.get("hlg")),
                    "atmos": bool(filtered.get("atmos")),
                    "truehdAtmos": bool(filtered.get("truehdAtmos")),
                    "signature": _media_signature(filtered, parts),
                }
        except Exception as exc:
            _progress(progress, f"Media scan failed for {getattr(section, 'title', '?')}: {exc}")
    _progress(progress, f"Media info eligible: {len(should)} (scanned {scanned})")
    return should


def discover_status(plex, config, sections, progress=None, skip_kometa=True):
    from core import _has_kometa_overlay_label, _title_allowed

    airing_days = int(config.get("statusAiringDays") or config.get("status_airing_days") or 14)
    allow, deny = _mode_allow_deny(config, "status")
    should = {}
    scanned = 0
    for section in sections:
        if str(getattr(section, "type", "") or "").lower() != "show":
            continue
        _progress(progress, f"Status scan: {getattr(section, 'title', '?')}…")
        try:
            for show in section.all():
                scanned += 1
                if scanned % 75 == 0:
                    _progress(progress, f"Status scan: checked {scanned} shows…")
                key = str(getattr(show, "ratingKey", "") or "")
                if not key:
                    continue
                if not _title_allowed(key, allow, deny):
                    continue
                if skip_kometa and _has_kometa_overlay_label(show):
                    continue
                label = _show_status_label(show, airing_days=airing_days)
                if not label:
                    continue
                should[key] = {
                    "show": show,
                    "library": section.title,
                    "statusLabel": label,
                    "signature": label,
                }
        except Exception as exc:
            _progress(progress, f"Status scan failed for {getattr(section, 'title', '?')}: {exc}")
    _progress(progress, f"Status eligible: {len(should)}")
    return should


def discover_ratings(plex, config, sections, progress=None, skip_kometa=True):
    from core import _has_kometa_overlay_label, _title_allowed

    minimum = float(config.get("ratingsMinimum") or config.get("ratings_minimum") or 0)
    allow, deny = _mode_allow_deny(config, "ratings")
    should = {}
    scanned = 0
    for section in sections:
        _progress(progress, f"Ratings scan: {getattr(section, 'title', '?')}…")
        try:
            for item in section.all():
                scanned += 1
                if scanned % 100 == 0:
                    _progress(progress, f"Ratings scan: checked {scanned} titles…")
                key = str(getattr(item, "ratingKey", "") or "")
                if not key:
                    continue
                if not _title_allowed(key, allow, deny):
                    continue
                if skip_kometa and _has_kometa_overlay_label(item):
                    continue
                score = _rating_value(item)
                if score is None or score < minimum:
                    continue
                should[key] = {
                    "show": item,
                    "library": section.title,
                    "itemType": str(getattr(section, "type", "") or ""),
                    "score": score,
                    "signature": f"{score:.2f}",
                }
        except Exception as exc:
            _progress(progress, f"Ratings scan failed for {getattr(section, 'title', '?')}: {exc}")
    _progress(progress, f"Ratings eligible: {len(should)}")
    return should


def discover_network(plex, config, sections, progress=None, skip_kometa=True):
    from core import _has_kometa_overlay_label, _title_allowed

    allow, deny = _mode_allow_deny(config, "network")
    should = {}
    scanned = 0
    for section in sections:
        if str(getattr(section, "type", "") or "").lower() != "show":
            continue
        _progress(progress, f"Network scan: {getattr(section, 'title', '?')}…")
        try:
            for show in section.all():
                scanned += 1
                if scanned % 75 == 0:
                    _progress(progress, f"Network scan: checked {scanned} shows…")
                key = str(getattr(show, "ratingKey", "") or "")
                if not key:
                    continue
                if not _title_allowed(key, allow, deny):
                    continue
                if skip_kometa and _has_kometa_overlay_label(show):
                    continue
                label = _network_label(show)
                if not label:
                    continue
                should[key] = {
                    "show": show,
                    "library": section.title,
                    "network": label,
                    "signature": label.lower(),
                }
        except Exception as exc:
            _progress(progress, f"Network scan failed for {getattr(section, 'title', '?')}: {exc}")
    _progress(progress, f"Network eligible: {len(should)}")
    return should


def run_media_overlays(plex, config, paths, preview_mode, progress=None):
    paths.setdefault("mediaLog", paths["root"] / "media_log.json")
    return _run_generic_mode(
        plex=plex,
        config=config,
        paths=paths,
        preview_mode=preview_mode,
        progress=progress,
        mode="media",
        enabled_key="mediaInfoEnabled",
        enabled_snake="media_info_enabled",
        log_key="mediaLog",
        discover_fn=discover_media,
        render_fn=lambda meta: render_media_badge(meta, paths=paths),
    )


def run_status_overlays(plex, config, paths, preview_mode, progress=None):
    paths.setdefault("statusLog", paths["root"] / "status_log.json")
    return _run_generic_mode(
        plex=plex,
        config=config,
        paths=paths,
        preview_mode=preview_mode,
        progress=progress,
        mode="status",
        enabled_key="statusOverlayEnabled",
        enabled_snake="status_overlay_enabled",
        log_key="statusLog",
        discover_fn=discover_status,
        render_fn=lambda meta: render_status_badge(meta.get("statusLabel") or "STATUS", paths=paths),
    )


def run_ratings_overlays(plex, config, paths, preview_mode, progress=None):
    paths.setdefault("ratingsLog", paths["root"] / "ratings_log.json")
    source = str(config.get("ratingsSource") or config.get("ratings_source") or "tmdb").strip() or "tmdb"
    return _run_generic_mode(
        plex=plex,
        config=config,
        paths=paths,
        preview_mode=preview_mode,
        progress=progress,
        mode="ratings",
        enabled_key="ratingsOverlayEnabled",
        enabled_snake="ratings_overlay_enabled",
        log_key="ratingsLog",
        discover_fn=discover_ratings,
        render_fn=lambda meta: render_rating_badge(float(meta.get("score") or 0), paths=paths, source=source),
    )


def run_network_overlays(plex, config, paths, preview_mode, progress=None):
    paths.setdefault("networkLog", paths["root"] / "network_log.json")
    return _run_generic_mode(
        plex=plex,
        config=config,
        paths=paths,
        preview_mode=preview_mode,
        progress=progress,
        mode="network",
        enabled_key="networkOverlayEnabled",
        enabled_snake="network_overlay_enabled",
        log_key="networkLog",
        discover_fn=discover_network,
        render_fn=lambda meta: render_network_badge(meta.get("network") or "NETWORK", paths=paths),
    )


# Sample Winners for the 14 Phase-3 families that render via the real per-family
# pipeline (kometa_render.render_winner) instead of the legacy render_*_badge
# helpers above. Values are representative, not user data — same idea as the
# "4K HDR / ATMOS" / "RETURNING" / "8.4" / "HBO" samples used for the legacy 4.
def _placement_preview_winners() -> dict[str, Any]:
    from kometa_detect import Winner

    return {
        "edition": Winner(family="edition", name="Extended-Edition", key="extended",
                           weight=190, image_rel="edition/extended.png"),
        "audio_codec": Winner(family="audio_codec", name="Dolby-Atmos", key="atmos",
                               weight=130, image_rel=None),
        "video_format": Winner(family="video_format", name="REMUX", key="remux",
                                weight=60, text="REMUX"),
        "streaming": Winner(family="streaming", name="Netflix", key="netflix",
                             weight=160, image_rel="streaming/color/Netflix.png"),
        "ribbon": Winner(family="ribbon", name="Academy Awards Best Picture Winner",
                          key="oscars", weight=190, image_rel="ribbon/yellow/oscars.png"),
        "aspect": Winner(family="aspect", name="2.35", key="2.35", weight=70, text="2.35"),
        "versions": Winner(family="versions", name="2 Versions", key="versions",
                            weight=2, image_rel="versions.png"),
        "language_count": Winner(family="language_count", name="Multi-Audio", key="multi",
                                  weight=20, image_rel="multi_audio.png"),
        "languages": Winner(family="languages", name="EN+FR", key="languages", weight=2,
                             extra={"flags": [{"lang": "en", "country": "us"},
                                              {"lang": "fr", "country": "fr"}]}),
        "runtimes": Winner(family="runtimes", name="Runtime: 2h 15m", key="runtimes",
                            weight=135, text="Runtime: 2h 15m"),
        "direct_play": Winner(family="direct_play", name="Direct Play Only",
                               key="direct_play", weight=10, image_rel="Direct-Play.png"),
        "content_rating": Winner(family="content_rating", name="PG-13", key="uspg-13",
                                  weight=10, image_rel="cr/uspg-13.png"),
        "mediastinger": Winner(family="mediastinger", name="MediaStinger",
                                key="mediastinger", weight=10, image_rel="Mediastinger.png"),
        "episode_info": Winner(family="episode_info", name="S01E05", key="episode_info",
                                weight=10, text="S01E05"),
    }


def ensure_placement_preview_badges(assets_dir: Path, paths: dict | None = None) -> None:
    """Write sample badges for the Placement editor (create missing only; no network spam)."""
    assets_dir = Path(assets_dir)
    assets_dir.mkdir(parents=True, exist_ok=True)
    legacy_names = (
        "placement-media.png",
        "placement-status.png",
        "placement-ratings.png",
        "placement-network.png",
    )
    family_names = tuple(f"placement-{family}.png" for family in _placement_preview_winners())
    names = legacy_names + family_names
    if all((assets_dir / name).exists() for name in names):
        return

    cache_paths = paths or {"root": assets_dir.parent.parent if assets_dir.name == "presets" else assets_dir.parent}
    samples = {
        "placement-media.png": render_media_badge(
            {"resolution": "4K", "hdr": True, "atmos": True, "lines": ["4K HDR", "ATMOS"]},
            paths=cache_paths,
        ),
        "placement-status.png": render_status_badge("RETURNING", paths=cache_paths),
        "placement-ratings.png": render_rating_badge(8.4, paths=cache_paths),
        "placement-network.png": render_network_badge("HBO", paths=cache_paths),
    }
    for name, img in samples.items():
        if img is None:
            continue
        path = assets_dir / name
        if path.exists():
            continue
        try:
            img.save(path)
        except Exception:
            pass

    # Phase-3 families — rendered via the real per-family pipeline so the
    # Placement preview matches exactly what Preview/Run will stamp.
    from kometa_render import render_winner

    missing_families = {
        family: winner
        for family, winner in _placement_preview_winners().items()
        if not (assets_dir / f"placement-{family}.png").exists()
    }
    if missing_families:
        for family, winner in missing_families.items():
            path = assets_dir / f"placement-{family}.png"
            try:
                img = render_winner(winner, config={}, paths=cache_paths)
            except Exception:
                continue
            if img is None:
                continue
            try:
                img.save(path)
            except Exception:
                pass


def run_all_kometa_style(plex, config, paths, preview_mode, progress=None) -> dict:
    """Run media → status → ratings → network (Kometa-ish stacking order)."""
    for key, filename in (
        ("mediaLog", "media_log.json"),
        ("statusLog", "status_log.json"),
        ("ratingsLog", "ratings_log.json"),
        ("networkLog", "network_log.json"),
    ):
        paths.setdefault(key, paths["root"] / filename)

    any_enabled = any(
        [
            _as_bool(config.get("mediaInfoEnabled", config.get("media_info_enabled")), False),
            _as_bool(config.get("statusOverlayEnabled", config.get("status_overlay_enabled")), False),
            _as_bool(config.get("ratingsOverlayEnabled", config.get("ratings_overlay_enabled")), False),
            _as_bool(config.get("networkOverlayEnabled", config.get("network_overlay_enabled")), False),
        ]
    )
    # Images download lazily on first use — avoid blocking the run on GitHub prefetch.
    if any_enabled:
        _progress(progress, "Layer modes: scanning (images load on demand)…")

    summary = {}
    summary.update(run_media_overlays(plex, config, paths, preview_mode, progress))
    summary.update(run_status_overlays(plex, config, paths, preview_mode, progress))
    summary.update(run_ratings_overlays(plex, config, paths, preview_mode, progress))
    summary.update(run_network_overlays(plex, config, paths, preview_mode, progress))
    errors = []
    for k in ("mediaErrors", "statusErrors", "ratingsErrors", "networkErrors"):
        errors.extend(summary.get(k) or [])
    if errors:
        summary["kometaStyleErrors"] = errors
    return summary
