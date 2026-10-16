#!/usr/bin/env python3
"""New Season overlay worker — Plex scan, compose, upload, cleanup."""

from __future__ import annotations

import io
import json
import os
import random
import re
import sys
import time
import traceback
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable

import requests
from PIL import Image
from plexapi.server import PlexServer

ProgressFn = Callable[[str], None]

# Sibling imports (tmdb_dates, modes_extra) must resolve even if cwd ≠ this file's dir.
_APP_DIR = str(Path(__file__).resolve().parent)
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)


def _progress(progress: ProgressFn | None, message: str) -> None:
    if progress:
        progress(message)


def _sanitize_filename(filename: str) -> str:
    filename = re.sub(r'[<>:"/\\|?*]', "", filename)
    filename = re.sub(r"[^\w\s-]", "", filename)
    return filename.strip() or "show"


def _as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _resolve_paths(config: dict) -> dict[str, Path]:
    root = Path(str(config.get("dataDir") or config.get("data_dir") or ".")).resolve()
    preview = root / "preview"
    preview_episodes = preview / "episodes"
    backups = root / "backups"
    backups_episodes = backups / "episodes"
    backups_season_episode = backups / "seasons-episode"
    preview.mkdir(parents=True, exist_ok=True)
    preview_episodes.mkdir(parents=True, exist_ok=True)
    backups.mkdir(parents=True, exist_ok=True)
    backups_episodes.mkdir(parents=True, exist_ok=True)
    backups_season_episode.mkdir(parents=True, exist_ok=True)
    log_path = Path(str(config.get("logPath") or config.get("log_path") or (root / "overlaid_log.json")))
    episode_log_path = Path(
        str(
            config.get("episodeLogPath")
            or config.get("episode_log_path")
            or (root / "episode_overlaid_log.json")
        )
    )
    assets_dir = Path(
        str(
            config.get("assetsDir")
            or config.get("assets_dir")
            or Path(__file__).resolve().parent / "assets" / "presets"
        )
    )
    custom_dir = Path(
        str(
            config.get("customPresetsDir")
            or config.get("custom_presets_dir")
            or (root / "presets" / "custom")
        )
    )
    custom_dir.mkdir(parents=True, exist_ok=True)
    preset_id = str(config.get("overlayPresetId") or config.get("overlay_preset_id") or "new-season").strip() or "new-season"
    episode_preset_id = str(
        config.get("episodeOverlayPresetId") or config.get("episode_overlay_preset_id") or "new-episode"
    ).strip() or "new-episode"
    if _as_bool(config.get("newSeasonWatchNowStyle", config.get("new_season_watch_now_style")), False):
        preset_id = "new-season-watch-now"
    if _as_bool(config.get("newEpisodeWatchNowStyle", config.get("new_episode_watch_now_style")), False):
        episode_preset_id = "new-episode-watch-now"
    overlay_path = Path(str(config.get("overlayPath") or config.get("overlay_path") or (assets_dir / f"{preset_id}.png")))
    episode_overlay_path = Path(
        str(
            config.get("episodeOverlayPath")
            or config.get("episode_overlay_path")
            or (assets_dir / f"{episode_preset_id}.png")
        )
    )
    # Prefer custom file when path points at missing bundled id but custom exists.
    if not overlay_path.exists():
        custom_hit = custom_dir / f"{preset_id}.png"
        if custom_hit.exists():
            overlay_path = custom_hit
        elif not overlay_path.exists() and (assets_dir / "new-season.png").exists():
            overlay_path = assets_dir / "new-season.png"
    if not episode_overlay_path.exists():
        custom_hit = custom_dir / f"{episode_preset_id}.png"
        if custom_hit.exists():
            episode_overlay_path = custom_hit
        elif (assets_dir / "new-episode.png").exists():
            episode_overlay_path = assets_dir / "new-episode.png"

    recently_preset_id = str(
        config.get("recentlyAddedPresetId")
        or config.get("recently_added_preset_id")
        or "recently-added"
    ).strip() or "recently-added"
    recently_overlay_path = Path(
        str(
            config.get("recentlyAddedOverlayPath")
            or config.get("recently_added_overlay_path")
            or (assets_dir / f"{recently_preset_id}.png")
        )
    )
    if not recently_overlay_path.exists():
        custom_hit = custom_dir / f"{recently_preset_id}.png"
        if custom_hit.exists():
            recently_overlay_path = custom_hit
        elif (assets_dir / "recently-added.png").exists():
            recently_overlay_path = assets_dir / "recently-added.png"
        elif (assets_dir / "new-season.png").exists():
            recently_overlay_path = assets_dir / "new-season.png"

    return {
        "root": root,
        "preview": preview,
        "previewEpisodes": preview_episodes,
        "backups": backups,
        "backupsEpisodes": backups_episodes,
        "backupsSeasonEpisode": backups_season_episode,
        "log": log_path,
        "episodeLog": episode_log_path,
        "recentlyAddedLog": root / "recently_added_log.json",
        "liveLog": root / "live_log.json",
        "top10Log": root / "top10_log.json",
        "mediaLog": root / "media_log.json",
        "statusLog": root / "status_log.json",
        "ratingsLog": root / "ratings_log.json",
        "networkLog": root / "network_log.json",
        "kometaLog": root / "kometa_overlaid_log.json",
        "overlay": overlay_path,
        "episodeOverlay": episode_overlay_path,
        "recentlyAddedOverlay": recently_overlay_path,
        "assets": assets_dir,
        "customPresets": custom_dir,
        "kometaImages": root / "kometa-images",
    }


def _backup_dir(paths: dict, rating_key: str) -> Path:
    return paths["backups"] / str(rating_key)


def _save_original_backups(
    paths: dict,
    rating_key: str,
    show_img: Image.Image,
    season_img: Image.Image | None,
    meta: dict | None = None,
) -> dict:
    """
    Persist pre-overlay posters once. Never overwrite an existing backup —
    that would replace originals with already-overlaid art on a later run.
    """
    folder = _backup_dir(paths, rating_key)
    show_path = folder / "show.png"
    season_path = folder / "season.png"
    meta_path = folder / "meta.json"
    saved = {"show": False, "season": False, "dir": str(folder)}

    folder.mkdir(parents=True, exist_ok=True)
    if not show_path.exists():
        show_img.convert("RGBA").save(show_path)
        saved["show"] = True
    if season_img is not None and not season_path.exists():
        season_img.convert("RGBA").save(season_path)
        saved["season"] = True
    if meta and not meta_path.exists():
        meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return saved


def _clear_backup_dir(paths: dict, rating_key: str) -> None:
    folder = _backup_dir(paths, rating_key)
    if not folder.exists():
        return
    for child in folder.iterdir():
        try:
            child.unlink()
        except Exception:
            pass
    try:
        folder.rmdir()
    except Exception:
        pass


def _restore_from_backup(show, paths: dict, rating_key: str, progress: ProgressFn | None = None) -> bool:
    """Upload saved originals back to Plex. Returns True if any backup file was applied."""
    folder = _backup_dir(paths, rating_key)
    show_path = folder / "show.png"
    season_path = folder / "season.png"
    restored_any = False

    if show_path.exists():
        try:
            _upload_poster_resilient(show, show_path, progress=progress, title=getattr(show, "title", rating_key))
            restored_any = True
            _progress(progress, f"Restored show poster from backup: {show.title}")
        except Exception as exc:
            _progress(progress, f"Backup show restore failed for {show.title}: {exc}")

    latest = _latest_season(show)
    # Prefer the season index recorded when we backed up (latest may have changed).
    season_index = None
    meta_path = folder / "meta.json"
    if meta_path.exists():
        try:
            season_index = json.loads(meta_path.read_text(encoding="utf-8")).get("seasonIndex")
        except Exception:
            season_index = None
    season_item = latest
    if season_index is not None:
        try:
            for season in show.seasons():
                if season.index == season_index:
                    season_item = season
                    break
        except Exception:
            pass

    if season_path.exists() and season_item is not None:
        try:
            _upload_poster_resilient(
                season_item,
                season_path,
                progress=progress,
                title=f"{getattr(show, 'title', rating_key)} S{getattr(season_item, 'index', '')}",
            )
            restored_any = True
            _progress(progress, f"Restored season poster from backup: {show.title}")
        except Exception as exc:
            _progress(progress, f"Backup season restore failed for {show.title}: {exc}")

    if restored_any:
        _clear_backup_dir(paths, rating_key)
    return restored_any


def _load_log(log_path: Path) -> dict:
    if not log_path.exists():
        return {}
    try:
        data = json.loads(log_path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_log(log_path: Path, data: dict) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _connect(config: dict) -> PlexServer:
    base = str(config.get("plexUrl") or config.get("plex_url") or config.get("base_url") or "").rstrip("/")
    token = str(config.get("plexToken") or config.get("plex_token") or config.get("token") or "").strip()
    if not base or not token:
        raise ValueError("Plex URL and token are required (configure Media Player Plex settings).")
    return PlexServer(base, token)


def _has_kometa_overlay_label(item) -> bool:
    try:
        labels = getattr(item, "labels", None) or []
        for label in labels:
            tag = getattr(label, "tag", None) or str(label)
            if str(tag).strip().lower() == "overlay":
                return True
    except Exception:
        return False
    return False


def _item_plex_label_tags(item) -> set[str]:
    """Lowercased Plex Label tags currently on the item."""
    tags: set[str] = set()
    if item is None:
        return tags
    try:
        for label in getattr(item, "labels", None) or []:
            tag = str(getattr(label, "tag", None) or label).strip()
            if tag:
                tags.add(tag.casefold())
    except Exception:
        pass
    return tags


def _item_has_overlay_tracking_labels(item, extra_names=None) -> bool:
    """True when Plex still has Overlay or a Layer stamp tag (4K-HDR, Atmos, …).

    Overlay-run backups are only trusted while these tags remain. If Poster Sets
    or a user stripped them, current Plex art is the original — do not restore
    an old backup over it.
    """
    tags = _item_plex_label_tags(item)
    if "overlay" in tags:
        return True
    for name in extra_names or []:
        folded = str(name or "").strip().casefold()
        if folded and folded in tags:
            return True
    try:
        from kometa_detect import known_overlay_stamp_label_names

        known = {
            str(name).strip().casefold()
            for name in known_overlay_stamp_label_names()
            if str(name).strip()
        }
        if tags & known:
            return True
    except Exception:
        pass
    return False


def _add_plex_overlay_label(item) -> bool:
    """Add Kometa-compatible Plex Label \"Overlay\" (idempotent)."""
    try:
        if _has_kometa_overlay_label(item):
            return True
        item.addLabel("Overlay")
        return True
    except Exception:
        return False


def _remove_plex_overlay_label(item) -> bool:
    """Remove Plex Label \"Overlay\" when present."""
    try:
        if not _has_kometa_overlay_label(item):
            return False
        item.removeLabel("Overlay")
        return True
    except Exception:
        return False


def _banners_add_overlay_label(config: dict | None) -> bool:
    """Whether banner / New Episode stamps should set the Kometa-style Overlay label."""
    if not isinstance(config, dict):
        return True
    if config.get("bannersAddOverlayLabel") is not None:
        return _as_bool(config.get("bannersAddOverlayLabel"), True)
    if config.get("banners_add_overlay_label") is not None:
        return _as_bool(config.get("banners_add_overlay_label"), True)
    return True


def _kometa_log_owns_overlay_label(paths: dict | None, rating_key: str) -> bool:
    """True when Kometa log still tracks this item as Overlay-labeled."""
    if not paths or not rating_key:
        return False
    log_path = paths.get("kometaLog")
    if not log_path:
        return False
    try:
        data = _load_log(Path(log_path))
        entry = data.get(str(rating_key)) if isinstance(data, dict) else None
        if not isinstance(entry, dict):
            return False
        return entry.get("labeled") is True
    except Exception:
        return False


def _kometa_overlay_label_blocks(item, *, paths: dict | None, rating_key: str) -> bool:
    """True only when the Plex "Overlay" label reflects a genuine Kometa-parity (Media/Layer)
    stamp on this item — not merely our own banner modes (New Season, New Episode, Live,
    Recently Added, Top 10), which also set this same label so Plex won't refresh the poster
    from metadata. Gating "skip if Kometa already overlaid this" on the raw label alone makes a
    banner mode see its own just-applied stamp as an external Kometa overlay and remove it
    again on the very next scan — this checks the Kometa engine's own log for real ownership."""
    if not _has_kometa_overlay_label(item):
        return False
    return _kometa_log_owns_overlay_label(paths, rating_key)


def _sync_banner_overlay_label(
    item,
    *,
    paths: dict | None,
    rating_key: str,
    has_overlays: bool,
    config: dict | None,
    progress: ProgressFn | None = None,
) -> None:
    """Add/remove Overlay label for banner stamps without clobbering Kometa ownership."""
    if not _banners_add_overlay_label(config):
        return
    if has_overlays:
        if _add_plex_overlay_label(item):
            _progress(progress, f"Plex Overlay label set: {getattr(item, 'title', rating_key)}")
        return
    if _kometa_log_owns_overlay_label(paths, rating_key):
        return
    if _remove_plex_overlay_label(item):
        _progress(progress, f"Plex Overlay label cleared: {getattr(item, 'title', rating_key)}")


def _apply_overlay(
    base_img: Image.Image,
    overlay_img: Image.Image,
    *,
    width_ratio: float = 0.92,
    max_height_ratio: float | None = None,
    # Only enough to shave the corner radius (~8–10% of banner height). Higher
    # values (e.g. 0.30) cut into the white text.
    bottom_clip_ratio: float = 0.10,
    x: float = 0.5,
    y: float = 1.0,
    anchor_x: str = "center",
    anchor_y: str = "bottom",
) -> Image.Image:
    """
    Composite banner onto art. Default is Netflix-style bottom-center flush
    (rounded bottom corners clipped). Position uses normalized x/y (0–1) with
    anchors matching the Placement editor.
    """
    base_img = base_img.convert("RGBA")
    overlay_img = overlay_img.convert("RGBA")
    width, height = base_img.size
    new_width = max(1, int(width * max(0.05, min(1.0, width_ratio))))
    new_height = max(1, int(overlay_img.height * (new_width / overlay_img.width)))
    if max_height_ratio is not None:
        max_h = max(1, int(height * max(0.05, min(1.0, max_height_ratio))))
        if new_height > max_h:
            scale = max_h / new_height
            new_width = max(1, int(new_width * scale))
            new_height = max_h
    resized = overlay_img.resize((new_width, new_height), Image.LANCZOS)

    # Crop only the corner radius — keep full glyph descenders visible.
    clip = max(0, min(new_height - 1, int(new_height * max(0.0, min(0.2, bottom_clip_ratio)))))
    keep_h = max(1, new_height - clip)
    cropped = resized.crop((0, 0, new_width, keep_h))

    ax = str(anchor_x or "center").strip().lower()
    ay = str(anchor_y or "bottom").strip().lower()
    nx = max(0.0, min(1.0, float(x)))
    ny = max(0.0, min(1.0, float(y)))
    anchor_px = width * nx
    anchor_py = height * ny

    if ax == "left":
        px = int(anchor_px)
    elif ax == "right":
        px = int(anchor_px - new_width)
    else:
        px = int(anchor_px - new_width / 2)

    if ay == "top":
        py = int(anchor_py)
    elif ay == "center":
        py = int(anchor_py - keep_h / 2)
    else:
        py = int(anchor_py - keep_h)

    base_img.paste(cropped, (px, py), cropped)
    return base_img


DEFAULT_PLACEMENT: dict[str, dict[str, Any]] = {
    "show": {
        "x": 0.5,
        "y": 1.0,
        "width": 0.92,
        "anchorX": "center",
        "anchorY": "bottom",
        "bottomClip": 0.10,
    },
    "season": {
        "x": 0.5,
        "y": 1.0,
        "width": 0.70,
        "maxHeight": 0.14,
        "anchorX": "center",
        "anchorY": "bottom",
        "bottomClip": 0.10,
    },
    "episode": {
        "x": 0.5,
        "y": 1.0,
        "width": 0.50,
        "maxHeight": 0.18,
        "anchorX": "center",
        "anchorY": "bottom",
        "bottomClip": 0.10,
    },
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
    "recently": {
        "x": 0.5,
        "y": 1.0,
        "width": 0.72,
        "anchorX": "center",
        "anchorY": "bottom",
        "bottomClip": 0.10,
    },
}


def _placement_for(config: dict | None, kind: str) -> dict[str, Any]:
    defaults = DEFAULT_PLACEMENT.get(kind) or DEFAULT_PLACEMENT["show"]
    raw_root = (config or {}).get("placement") if isinstance(config, dict) else None
    raw = (raw_root or {}).get(kind) if isinstance(raw_root, dict) else None
    if kind == "recently" and not isinstance(raw, dict) and isinstance(raw_root, dict):
        raw = raw_root.get("recentlyAdded")
    if not isinstance(raw, dict):
        return dict(defaults)
    out = dict(defaults)
    for key in ("x", "y", "width", "bottomClip", "maxHeight"):
        if key in raw and raw[key] is not None:
            try:
                out[key] = float(raw[key])
            except (TypeError, ValueError):
                pass
    for src, dst in (("bottom_clip", "bottomClip"), ("max_height", "maxHeight"), ("anchor_x", "anchorX"), ("anchor_y", "anchorY")):
        if src in raw and raw[src] is not None and dst not in raw:
            if dst in ("anchorX", "anchorY"):
                out[dst] = str(raw[src])
            else:
                try:
                    out[dst] = float(raw[src])
                except (TypeError, ValueError):
                    pass
    if raw.get("anchorX") is not None:
        out["anchorX"] = str(raw["anchorX"])
    if raw.get("anchorY") is not None:
        out["anchorY"] = str(raw["anchorY"])
    return out


# Corner ribbons are authored for the top-right; ignore bottom-banner placement.
CORNER_RIBBON_PLACEMENT: dict[str, dict[str, Any]] = {
    "show": {
        "x": 1.0,
        "y": 0.0,
        "width": 0.55,
        "anchorX": "right",
        "anchorY": "top",
        "bottomClip": 0.0,
    },
    "season": {
        "x": 1.0,
        "y": 0.0,
        "width": 0.55,
        "anchorX": "right",
        "anchorY": "top",
        "bottomClip": 0.0,
    },
    "episode": {
        "x": 1.0,
        "y": 0.0,
        "width": 0.42,
        "maxHeight": 0.42,
        "anchorX": "right",
        "anchorY": "top",
        "bottomClip": 0.0,
    },
}


def _is_corner_ribbon_preset(preset_id: str | None) -> bool:
    return "corner-ribbon" in str(preset_id or "").lower()


def _is_season_chip_preset(preset_id: str | None) -> bool:
    pid = str(preset_id or "").lower().replace("_", "-")
    return pid in {"season-chip", "seasonchip", "s-chip"} or pid.endswith("season-chip")


def _effective_placement(config: dict | None, kind: str, preset_id: str | None = None) -> dict[str, Any]:
    if _is_corner_ribbon_preset(preset_id):
        return dict(CORNER_RIBBON_PLACEMENT.get(kind) or CORNER_RIBBON_PLACEMENT["show"])
    if _is_season_chip_preset(preset_id) and kind == "show":
        return {
            "x": 0.5,
            "y": 1.0,
            "width": 0.34,
            "anchorX": "center",
            "anchorY": "bottom",
            "bottomClip": 0.0,
        }
    return _placement_for(config, kind)


def _find_font(size: int):
    candidates = [
        Path(r"C:\Windows\Fonts\arialbd.ttf"),
        Path(r"C:\Windows\Fonts\segoeuib.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        Path("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"),
    ]
    try:
        from PIL import ImageFont
    except Exception:
        return None
    for path in candidates:
        if path.exists():
            try:
                return ImageFont.truetype(str(path), size)
            except Exception:
                continue
    try:
        from PIL import ImageFont
        return ImageFont.load_default()
    except Exception:
        return None


def _render_season_chip(season_index: int | None) -> Image.Image:
    """Dynamic S{n} chip for the season-chip preset."""
    from PIL import ImageDraw

    label = f"S{int(season_index)}" if season_index is not None else "S#"
    w, h = 420, 140
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    pad_x, pad_y = 24, 18
    box = [pad_x, pad_y, w - pad_x, h - pad_y]
    radius = (box[3] - box[1]) // 2
    draw.rounded_rectangle(box, radius=radius, fill=(229, 9, 20, 255))
    font = _find_font(max(36, int((box[3] - box[1]) * 0.62)))
    if font is None:
        return img
    tb = draw.textbbox((0, 0), label, font=font)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    cx = (box[0] + box[2]) / 2
    cy = (box[1] + box[3]) / 2
    draw.text((cx - tw / 2 - tb[0], cy - th / 2 - tb[1]), label, font=font, fill=(255, 255, 255, 255))
    return img


def _load_show_overlay_image(config: dict | None, paths: dict, season_index: int | None = None) -> Image.Image:
    preset_id = str((config or {}).get("overlayPresetId") or (config or {}).get("overlay_preset_id") or "new-season")
    if _is_season_chip_preset(preset_id):
        return _render_season_chip(season_index)
    path = paths["overlay"]
    if not path.exists():
        raise FileNotFoundError(f"Overlay asset not found: {path}")
    return Image.open(path)


def _load_episode_overlay_image(config: dict | None, paths: dict) -> Image.Image:
    path = paths["episodeOverlay"]
    if not path.exists():
        raise FileNotFoundError(f"Episode overlay asset not found: {path}")
    return Image.open(path)


def _apply_with_placement(
    base_img: Image.Image,
    overlay_img: Image.Image,
    placement: dict[str, Any],
) -> Image.Image:
    max_h = placement.get("maxHeight")
    if max_h is None:
        max_h = placement.get("max_height")
    max_height_ratio = float(max_h) if max_h is not None else None
    # bottomClip may be 0 (Kometa corner badges) — do not use `or 0.10` (0 is falsy).
    raw_clip = placement.get("bottomClip")
    if raw_clip is None:
        raw_clip = placement.get("bottom_clip")
    if raw_clip is None:
        bottom_clip_ratio = 0.10
    else:
        try:
            bottom_clip_ratio = float(raw_clip)
        except (TypeError, ValueError):
            bottom_clip_ratio = 0.10
    return _apply_overlay(
        base_img,
        overlay_img,
        width_ratio=float(placement.get("width") or 0.92),
        max_height_ratio=max_height_ratio,
        bottom_clip_ratio=bottom_clip_ratio,
        x=float(placement.get("x") if placement.get("x") is not None else 0.5),
        y=float(placement.get("y") if placement.get("y") is not None else 1.0),
        anchor_x=str(placement.get("anchorX") or "center"),
        anchor_y=str(placement.get("anchorY") or "bottom"),
    )


def _apply_episode_overlay(
    base_img: Image.Image,
    overlay_img: Image.Image,
    config: dict | None = None,
) -> Image.Image:
    """Readable New Episode badge on landscape thumbs (sized for small Plex grids)."""
    preset = str((config or {}).get("episodeOverlayPresetId") or (config or {}).get("episode_overlay_preset_id") or "new-episode")
    return _apply_with_placement(
        base_img,
        overlay_img,
        _effective_placement(config, "episode", preset),
    )


def _apply_season_episode_overlay(
    base_img: Image.Image,
    overlay_img: Image.Image,
    config: dict | None = None,
) -> Image.Image:
    """New Season banner on portrait season posters (same preset as show)."""
    preset = str((config or {}).get("overlayPresetId") or (config or {}).get("overlay_preset_id") or "new-season")
    return _apply_with_placement(
        base_img,
        overlay_img,
        _effective_placement(config, "season", preset),
    )


def _apply_show_overlay(
    base_img: Image.Image,
    overlay_img: Image.Image,
    config: dict | None = None,
) -> Image.Image:
    """New Season banner on show posters."""
    preset = str((config or {}).get("overlayPresetId") or (config or {}).get("overlay_preset_id") or "new-season")
    return _apply_with_placement(
        base_img,
        overlay_img,
        _effective_placement(config, "show", preset),
    )


def _plex_image_session(plex: PlexServer | None):
    """Prefer plexapi's session (SSL verify / headers for plex.direct)."""
    session = getattr(plex, "_session", None) if plex is not None else None
    return session if session is not None else requests


def _plex_image_url(plex: PlexServer | None, thumb_path: str) -> str:
    """Build an absolute poster URL, reusing plex.url when available."""
    raw = str(thumb_path or "").strip()
    if not raw:
        return ""
    token = str(getattr(plex, "_token", None) or "") if plex is not None else ""
    base = str(getattr(plex, "_baseurl", "") or "").rstrip("/") if plex is not None else ""

    if raw.startswith("http://") or raw.startswith("https://"):
        url = raw
        if token and "X-Plex-Token=" not in url:
            url = f"{url}{'&' if '?' in url else '?'}X-Plex-Token={token}"
        return url

    path = raw if raw.startswith("/") else f"/{raw}"
    # plex.url() matches how plexapi itself fetches thumbs (token + baseurl).
    url_fn = getattr(plex, "url", None) if plex is not None else None
    if callable(url_fn):
        try:
            return str(url_fn(path, includeToken=True) or "")
        except TypeError:
            try:
                built = str(url_fn(path) or "")
                if token and built and "X-Plex-Token=" not in built:
                    built = f"{built}{'&' if '?' in built else '?'}X-Plex-Token={token}"
                return built
            except Exception:
                pass
        except Exception:
            pass
    if not base:
        return ""
    url = f"{base}{path}"
    if token:
        url = f"{url}{'&' if '?' in url else '?'}X-Plex-Token={token}"
    return url


def _thumb_path_fallbacks(thumb_path: str, rating_key: str | None = None) -> list[str]:
    """Candidate Plex image paths — strip stale /thumb/<ts> then try ratingKey."""
    seen: set[str] = set()
    out: list[str] = []

    def add(path: str) -> None:
        value = str(path or "").strip()
        if not value or value in seen:
            return
        seen.add(value)
        out.append(value)

    raw = str(thumb_path or "").strip()
    add(raw)
    # Stale timestamped thumbs 404 after Poster Sets / unlock; unversioned still works.
    if "/thumb/" in raw:
        add(raw.rsplit("/thumb/", 1)[0] + "/thumb")
    key = str(rating_key or "").strip()
    if key:
        add(f"/library/metadata/{key}/thumb")
    return out


def _download_poster(plex: PlexServer, thumb_path: str) -> Image.Image | None:
    if not thumb_path:
        return None
    url = _plex_image_url(plex, thumb_path)
    if not url:
        return None
    try:
        session = _plex_image_session(plex)
        headers = {
            "Accept": "image/*,*/*",
            "X-Plex-Token": str(getattr(plex, "_token", None) or ""),
        }
        response = session.get(url, timeout=60, headers=headers)
        if response.status_code != 200 or not response.content:
            return None
        content_type = str(response.headers.get("Content-Type") or "").lower()
        if content_type and "image" not in content_type and "octet-stream" not in content_type:
            # Plex sometimes returns HTML/XML error bodies with a 200.
            if response.content[:16].lstrip().startswith((b"<", b"{")):
                return None
        img = Image.open(io.BytesIO(response.content))
        img.load()
        return img.convert("RGBA")
    except Exception:
        return None


def _item_poster_image(plex: PlexServer, item) -> Image.Image | None:
    """Download show/movie art: thumb (+ unversioned), then provider posters()."""
    if item is None or plex is None:
        return None
    thumb = getattr(item, "thumb", None) or ""
    rating_key = str(getattr(item, "ratingKey", None) or "").strip() or None
    for path in _thumb_path_fallbacks(thumb, rating_key):
        img = _download_poster(plex, path)
        if img is not None:
            return img
    try:
        if hasattr(item, "reload") and callable(item.reload):
            item.reload()
            thumb = getattr(item, "thumb", None) or thumb
            for path in _thumb_path_fallbacks(thumb, rating_key):
                img = _download_poster(plex, path)
                if img is not None:
                    return img
    except Exception:
        pass
    try:
        posters = list(item.posters() or [])
    except Exception:
        posters = []
    for poster in posters[:8]:
        key = getattr(poster, "key", None) or getattr(poster, "thumb", None) or ""
        img = _download_poster(plex, str(key))
        if img is not None:
            return img
    return None


def _reset_poster(item) -> bool:
    try:
        posters = item.posters()
        if posters:
            original = None
            for poster in posters:
                key = str(getattr(poster, "key", "") or "")
                if "metadata" in key and "thumb" in key:
                    original = poster
                    break
            if not original:
                original = posters[0]
            item.setPoster(original)
            return True
    except Exception:
        pass
    try:
        item.edit(**{"thumb.locked": 0})
        item.edit(**{"thumb": None})
        item.refresh()
        return True
    except Exception:
        return False


def _unlock_poster(item) -> None:
    """Plex often 500s on /posters when the thumb is locked."""
    try:
        item.edit(**{"thumb.locked": 0})
    except Exception:
        pass


# Plex hard-rejects POST /posters above 10MB ("Content-Length exceeds the maximum allowed limit of 10MB").
PLEX_POSTER_MAX_BYTES = int(9.5 * 1024 * 1024)


def _is_retryable_poster_upload_error(exc: BaseException) -> bool:
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


def _is_oversized_poster_error(exc: BaseException) -> bool:
    text = str(exc or "").lower()
    return any(
        token in text
        for token in ("10mb", "content-length", "exceeds the maximum")
    )


def _flatten_poster_rgb(img: Image.Image) -> Image.Image:
    rgba = img.convert("RGBA")
    flat = Image.new("RGB", rgba.size, (0, 0, 0))
    flat.paste(rgba, mask=rgba.split()[3])
    return flat


def _compress_poster_for_plex(src: Path, dest: Path, *, max_bytes: int = PLEX_POSTER_MAX_BYTES) -> Path:
    """Re-encode/resize until the file is under Plex's ~10MB upload cap."""
    img = _flatten_poster_rgb(Image.open(src))
    dest.parent.mkdir(parents=True, exist_ok=True)

    # Start large and walk down until under the cap.
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
    for max_w, max_h, quality in plans:
        frame = img.copy()
        if frame.width > max_w or frame.height > max_h:
            frame.thumbnail((max_w, max_h), Image.LANCZOS)
        frame.save(dest, format="JPEG", quality=quality, optimize=True)
        last_size = dest.stat().st_size
        if last_size <= max_bytes:
            return dest
    raise RuntimeError(
        f"Could not compress poster under Plex 10MB limit "
        f"(still {last_size} bytes after re-encode)"
    )


def _upload_poster_resilient(
    item,
    filepath: str | Path,
    *,
    progress: ProgressFn | None = None,
    title: str | None = None,
    retries: int = 3,
) -> None:
    """Upload a poster with unlock + size cap + retries.

    Plex returns HTTP 500 when POST /posters exceeds 10MB
    (see PMS log: "Content-Length exceeds the maximum allowed limit of 10MB").
    """
    path = Path(filepath)
    label = title or getattr(item, "title", None) or str(getattr(item, "ratingKey", "") or path.name)
    upload_path = path
    compressed: Path | None = None

    try:
        try:
            size = path.stat().st_size
        except Exception:
            size = 0

        if size > PLEX_POSTER_MAX_BYTES:
            compressed = path.with_name(f"{path.stem}_plex.jpg")
            _compress_poster_for_plex(path, compressed)
            upload_path = compressed
            _progress(
                progress,
                f"Compressed poster for {label}: {size} → {compressed.stat().st_size} bytes "
                f"(Plex 10MB upload limit)",
            )

        _unlock_poster(item)
        last_exc: BaseException | None = None
        for attempt in range(max(1, int(retries))):
            try:
                item.uploadPoster(filepath=str(upload_path))
                return
            except Exception as exc:
                last_exc = exc
                if not _is_retryable_poster_upload_error(exc):
                    raise
                _progress(
                    progress,
                    f"Plex poster upload failed for {label} "
                    f"(attempt {attempt + 1}/{retries}): {exc}",
                )
                # Only compress when Plex rejected an oversized payload — not on every 500.
                if compressed is None and (size > PLEX_POSTER_MAX_BYTES or _is_oversized_poster_error(exc)):
                    try:
                        compressed = path.with_name(f"{path.stem}_plex.jpg")
                        _compress_poster_for_plex(path, compressed)
                        upload_path = compressed
                        _progress(
                            progress,
                            f"Retrying {label} with compressed JPEG "
                            f"({compressed.stat().st_size} bytes)",
                        )
                    except Exception as compress_exc:
                        _progress(progress, f"Poster compress failed for {label}: {compress_exc}")
                _unlock_poster(item)
                try:
                    if hasattr(item, "reload") and callable(item.reload):
                        item.reload()
                except Exception:
                    pass
                time.sleep(min(3.0, 0.5 * (attempt + 1)))

        if last_exc is not None:
            raise last_exc
        raise RuntimeError(f"Plex poster upload failed for {label}")
    finally:
        if compressed is not None:
            try:
                if compressed.exists():
                    compressed.unlink()
            except Exception:
                pass


def _regular_seasons(show) -> list:
    """Seasons 1+ — excludes Specials (index 0)."""
    out = []
    try:
        seasons = show.seasons()
    except Exception:
        return out
    for season in seasons or []:
        idx = _season_index(season)
        if idx is not None and idx >= 1:
            out.append(season)
    return out


def _latest_season(show):
    regular = _regular_seasons(show)
    if not regular:
        return None
    return max(regular, key=lambda s: s.index)


def _season_index(season) -> int | None:
    try:
        idx = getattr(season, "index", None)
        if idx is None:
            return None
        return int(idx)
    except (TypeError, ValueError):
        return None


def _within_overlay_window(
    cutoff: datetime,
    *,
    aired: datetime | None = None,
    added: datetime | None = None,
) -> bool:
    """Recently Added: true when air date or Plex addedAt falls inside the window."""
    for dt in (aired, added):
        if dt is not None and dt >= cutoff:
            return True
    return False


def _within_air_window(cutoff: datetime, aired: datetime | None) -> bool:
    """New Season: air date only — adding an old show to Plex does not qualify."""
    return aired is not None and aired >= cutoff


def _first_episode(season):
    try:
        episodes = season.episodes()
    except Exception:
        return None
    return next(
        (ep for ep in episodes or [] if getattr(ep, "index", None) in (1, "1")),
        None,
    )


def premiere_show_eligible(
    show,
    cutoff: datetime,
    *,
    skip_kometa: bool = False,
    resolver=None,
    paths: dict | None = None,
) -> tuple[bool, dict]:
    """Recently Added — first-season premiere only (S1 E01 aired or added within window)."""
    meta = {
        "seasonIndex": 1,
        "airedAt": None,
        "addedAt": None,
        "reason": None,
        "airDateSource": None,
    }
    try:
        if skip_kometa and _kometa_overlay_label_blocks(
            show, paths=paths, rating_key=str(getattr(show, "ratingKey", "") or "")
        ):
            meta["reason"] = "kometa_overlay_label"
            return False, meta
        regular = _regular_seasons(show)
        if len(regular) != 1:
            meta["reason"] = "not_premiere"
            return False, meta
        season = regular[0]
        if _season_index(season) != 1:
            meta["reason"] = "not_premiere"
            return False, meta
        episode1 = _first_episode(season)
        if not episode1:
            meta["reason"] = "no_episodes"
            return False, meta
        aired = _as_datetime(getattr(episode1, "originallyAvailableAt", None))
        added = _as_datetime(getattr(episode1, "addedAt", None)) or _as_datetime(
            getattr(show, "addedAt", None)
        )
        source = "plex" if aired is not None else None
        if aired is None and resolver is not None:
            aired = resolver.resolve_episode_aired(episode1, show)
            if aired is not None:
                source = "tmdb"
        if aired is not None:
            meta["airedAt"] = aired.isoformat()
        if added is not None:
            meta["addedAt"] = added.isoformat()
        meta["airDateSource"] = source
        if not _within_overlay_window(cutoff, aired=aired, added=added):
            meta["reason"] = "aged_out" if (aired or added) else "no_date"
            return False, meta
        return True, meta
    except Exception as exc:
        meta["reason"] = f"error:{exc}"
        return False, meta


def _is_returning_season(season, show=None) -> bool:
    """New Season badges are only for season 2+ — never the show's first season."""
    idx = _season_index(season)
    if idx is None or idx < 1:
        return False
    if show is not None:
        regular = _regular_seasons(show)
        # One regular season = series premiere — never "New Season".
        if len(regular) < 2:
            return False
        latest = max(regular, key=lambda s: s.index)
        if _season_index(latest) != idx:
            return False
        return True
    return idx >= 2


def _library_title(item) -> str:
    """Best-effort library/section title for log/UI columns."""
    for attr in ("librarySectionTitle", "sectionTitle"):
        value = getattr(item, attr, None)
        if value:
            return str(value)
    try:
        section = getattr(item, "section", None)
        if callable(section):
            sec = section()
            title = getattr(sec, "title", None)
            if title:
                return str(title)
    except Exception:
        pass
    return ""


def _only_rating_keys(config: dict) -> set[str]:
    """Optional single-title / scoped live test — empty means full library pass."""
    raw = config.get("onlyRatingKeys") or config.get("only_rating_keys") or []
    if isinstance(raw, str):
        raw = [x.strip() for x in raw.split(",") if x.strip()]
    if not isinstance(raw, list):
        return set()
    return {str(k or "").strip() for k in raw if str(k or "").strip()}


def _fetch_plex_item(plex: PlexServer, rating_key: str):
    key = str(rating_key or "").strip()
    if not key:
        return None
    try:
        return plex.fetchItem(int(key))
    except Exception:
        try:
            return plex.fetchItem(f"/library/metadata/{key}")
        except Exception:
            return None


def should_have_overlay(
    show,
    cutoff: datetime,
    skip_kometa: bool,
    resolver=None,
    paths: dict | None = None,
) -> tuple[bool, dict]:
    meta = {
        "seasonIndex": None,
        "airedAt": None,
        "addedAt": None,
        "reason": None,
        "airDateSource": None,
    }
    try:
        if skip_kometa and _kometa_overlay_label_blocks(
            show, paths=paths, rating_key=str(getattr(show, "ratingKey", "") or "")
        ):
            meta["reason"] = "kometa_overlay_label"
            return False, meta
        latest = _latest_season(show)
        if not latest:
            meta["reason"] = "no_season"
            return False, meta
        meta["seasonIndex"] = latest.index
        if not _is_returning_season(latest, show):
            meta["reason"] = "first_season"
            return False, meta
        episode1 = _first_episode(latest)
        if not episode1:
            meta["reason"] = "no_episodes"
            return False, meta
        aired = _as_datetime(getattr(episode1, "originallyAvailableAt", None))
        added = _as_datetime(getattr(episode1, "addedAt", None))
        source = "plex" if aired is not None else None
        if aired is None and resolver is not None:
            aired = resolver.resolve_episode_aired(episode1, show)
            if aired is not None:
                source = "tmdb"
        if aired is not None:
            meta["airedAt"] = aired.isoformat()
        if added is not None:
            meta["addedAt"] = added.isoformat()
        meta["airDateSource"] = source
        if not _within_air_window(cutoff, aired):
            meta["reason"] = "aged_out" if aired else "no_date"
            return False, meta
        return True, meta
    except Exception as exc:
        meta["reason"] = f"error:{exc}"
        return False, meta


def _section_filter(config: dict, override_ids: list | None = None) -> set[str] | None:
    raw = override_ids if override_ids is not None else (
        config.get("librarySectionIds") or config.get("library_section_ids") or []
    )
    if not isinstance(raw, list) or not raw:
        return None
    return {str(x).strip() for x in raw if str(x).strip()}


def _read_section_id_list(config: dict, *keys: str) -> list[str] | None:
    """Return the first non-empty id list among keys, or None (= unset / all)."""
    if not isinstance(config, dict):
        return None
    for key in keys:
        raw = config.get(key)
        if isinstance(raw, list) and raw:
            out = [str(x).strip() for x in raw if str(x).strip()]
            if out:
                return out
    return None


def _bundle_section_ids(config: dict, bundle: str | None) -> list[str] | None:
    """
    Resolve library scope for a run bundle.
    None means all libraries of the requested type(s).
    Order: per-run list → Advanced librarySectionIds → all.
    """
    name = str(bundle or "").strip().lower()
    if name in {"core", "banners"}:
        return _read_section_id_list(
            config,
            "coreLibrarySectionIds",
            "core_library_section_ids",
            "librarySectionIds",
            "library_section_ids",
        )
    if name in {"recently", "recently_added", "recently-added"}:
        return _read_section_id_list(
            config,
            "recentlyAddedLibrarySectionIds",
            "recently_added_library_section_ids",
            "librarySectionIds",
            "library_section_ids",
        )
    if name in {"kometa", "media"}:
        return _read_section_id_list(
            config,
            "kometaLibrarySectionIds",
            "kometa_library_section_ids",
            "librarySectionIds",
            "library_section_ids",
        )
    return _read_section_id_list(config, "librarySectionIds", "library_section_ids")


def _section_ids(section) -> set[str]:
    section_id = str(getattr(section, "key", "") or "").rstrip("/").split("/")[-1]
    section_key = str(getattr(section, "key", "") or "")
    titles = {str(section.title)}
    return {section_id, section_key, *titles}


def _iter_sections(
    plex: PlexServer,
    config: dict,
    *,
    types: tuple[str, ...] = ("show",),
    section_ids: list | None = None,
):
    """Yield library sections matching type(s) and optional section id filter."""
    wanted = _section_filter(config, override_ids=section_ids)
    allowed = {str(t).lower() for t in types}
    for section in plex.library.sections():
        stype = str(getattr(section, "type", "") or "").lower()
        if stype not in allowed:
            continue
        ids = _section_ids(section)
        if wanted is not None and not (wanted & ids):
            continue
        yield section


def _iter_tv_sections(plex: PlexServer, config: dict, *, bundle: str = "core"):
    """TV libraries for a run bundle. Empty per-run scope falls back to Advanced, then all."""
    ids = _bundle_section_ids(config, bundle)
    yield from _iter_sections(plex, config, types=("show",), section_ids=ids if ids is not None else [])


def _iter_movie_sections(plex: PlexServer, config: dict, *, bundle: str = "kometa"):
    ids = _bundle_section_ids(config, bundle)
    yield from _iter_sections(plex, config, types=("movie",), section_ids=ids if ids is not None else [])


def _title_allowed(rating_key: str, allow: list | None, deny: list | None) -> bool:
    key = str(rating_key or "").strip()
    if not key:
        return False
    deny_set = {str(x).strip() for x in (deny or []) if str(x).strip()}
    if key in deny_set:
        return False
    allow_list = [str(x).strip() for x in (allow or []) if str(x).strip()]
    if not allow_list:
        return True
    return key in set(allow_list)


def _mode_section_ids(config: dict, mode: str) -> list | None:
    """Per-family library override; falls back to kometa run scope (empty = all)."""
    key_map = {
        "media": ("mediaInfoLibrarySectionIds", "media_info_library_section_ids"),
        "status": ("statusLibrarySectionIds", "status_library_section_ids"),
        "ratings": ("ratingsLibrarySectionIds", "ratings_library_section_ids"),
        "network": ("networkLibrarySectionIds", "network_library_section_ids"),
        "streaming": ("streamingLibrarySectionIds", "streaming_library_section_ids"),
        "ribbon": ("ribbonLibrarySectionIds", "ribbon_library_section_ids"),
    }
    camel, snake = key_map.get(mode, (None, None))
    if camel:
        family = _read_section_id_list(config, camel, snake)
        if family is not None:
            return family
    return _bundle_section_ids(config, "kometa")


def _iter_shows(plex: PlexServer, config: dict):
    for section in _iter_tv_sections(plex, config, bundle="core"):
        for show in section.all():
            yield section, show


def _as_datetime(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    try:
        # plexapi sometimes returns datetime.date
        return datetime.combine(value, datetime.min.time())
    except Exception:
        return None


def _search_recent_premiere_episodes(section, cutoff: datetime):
    """
    Fast path: only E01 episodes aired on/after cutoff.
    Avoids walking every show with seasons()/episodes() (that hangs large libraries / 502s).
    """
    cutoff_str = cutoff.strftime("%Y-%m-%d")
    plex = getattr(section, "_server", None)
    section_id = str(getattr(section, "key", "") or "").rstrip("/").split("/")[-1]

    def _client_filter(items: list) -> list:
        out = []
        for ep in items or []:
            idx = getattr(ep, "index", None)
            if idx is not None and idx not in (1, "1"):
                continue
            aired = _as_datetime(getattr(ep, "originallyAvailableAt", None))
            if aired is None or aired < cutoff:
                continue
            out.append(ep)
        return out

    candidates: list = []

    # 1) plexapi filter syntax uses >>= for >=
    try:
        candidates = list(section.search(
            libtype="episode",
            filters={
                "episode.index": 1,
                "originallyAvailableAt>>=": cutoff_str,
            },
        ))
    except Exception:
        candidates = []

    # Server ignored the date filter if we still got thousands of historic E01s.
    if len(candidates) > 1000:
        filtered = _client_filter(candidates)
        if len(filtered) <= 500:
            return filtered
        candidates = []

    # 2) Raw query string — keeps `>=` intact (params dict keys can get mangled).
    if not candidates and plex is not None and section_id:
        try:
            key = (
                f"/library/sections/{section_id}/all"
                f"?type=4&index=1&originallyAvailableAt>={cutoff_str}"
            )
            candidates = list(plex.fetchItems(key) or [])
        except Exception:
            candidates = []
        if len(candidates) > 1000:
            filtered = _client_filter(candidates)
            if len(filtered) <= 500:
                return filtered
            # Filter clearly broken — force slow path instead of 8k show() lookups.
            raise RuntimeError(
                f"Plex returned {len(candidates)} E01 rows without honouring the air-date filter"
            )

    return _client_filter(candidates)


def _search_recently_added_episodes(section, cutoff: datetime, *, max_results: int = 250):
    """Episodes recently added to Plex — used to catch titles with missing air dates."""
    plex = getattr(section, "_server", None)
    section_id = str(getattr(section, "key", "") or "").rstrip("/").split("/")[-1]
    candidates: list = []

    try:
        candidates = list(section.recentlyAdded(maxresults=max_results, libtype="episode") or [])
    except TypeError:
        try:
            candidates = list(section.recentlyAdded(maxresults=max_results) or [])
            candidates = [
                item for item in candidates
                if str(getattr(item, "type", "") or getattr(item, "TYPE", "") or "").lower() == "episode"
            ]
        except Exception:
            candidates = []
    except Exception:
        candidates = []

    if not candidates and plex is not None and section_id:
        try:
            # Unix seconds — Plex addedAt filter
            ts = int(cutoff.timestamp())
            key = f"/library/sections/{section_id}/all?type=4&addedAt>={ts}&sort=addedAt:desc"
            candidates = list(plex.fetchItems(key) or [])
        except Exception:
            candidates = []

    out = []
    for ep in candidates or []:
        added = _as_datetime(getattr(ep, "addedAt", None))
        if added is not None and added < cutoff:
            continue
        out.append(ep)
    return out[:max_results]


def discover_eligible_shows(
    plex: PlexServer,
    config: dict,
    cutoff: datetime,
    skip_kometa: bool,
    progress: ProgressFn | None = None,
    resolver=None,
    paths: dict | None = None,
) -> tuple[set[str], dict[str, dict], dict[str, Any]]:
    """
    Return (should_have_keys, meta_by_key, show_by_key) for shows whose *latest*
    season premiere (E01) falls inside the new-season window.

    Season 1 (and specials) never qualify — "New Season" means a returning season.
    """
    should_have: set[str] = set()
    meta_by_key: dict[str, dict] = {}
    show_by_key: dict[str, Any] = {}
    window_days = max(1, (datetime.now() - cutoff).days)

    tv_sections = list(_iter_tv_sections(plex, config, bundle="core"))
    if not tv_sections:
        _progress(progress, "No TV libraries in Banners (core) scope (check the library selector on this card).")

    for section in tv_sections:
        _progress(progress, f"Scanning {section.title} for recent season premieres…")
        episodes = []
        used_fast = False
        try:
            episodes = _search_recent_premiere_episodes(section, cutoff)
            used_fast = True
            _progress(
                progress,
                f"{section.title}: {len(episodes)} E01 premiere(s) in the last {window_days} day(s)",
            )
        except Exception as exc:
            _progress(progress, f"{section.title}: fast search failed ({exc}); falling back to full scan")

        if used_fast:
            for idx, ep in enumerate(episodes, start=1):
                if idx == 1 or idx % 10 == 0 or idx == len(episodes):
                    _progress(progress, f"{section.title}: checking premiere {idx}/{len(episodes)}…")
                try:
                    show = ep.show()
                    season = ep.season()
                except Exception:
                    continue
                key = str(getattr(show, "ratingKey", "") or "")
                if not key or key in should_have:
                    continue
                aired = _as_datetime(getattr(ep, "originallyAvailableAt", None))
                source = "plex" if aired is not None else None
                if skip_kometa and _kometa_overlay_label_blocks(show, paths=paths, rating_key=key):
                    meta_by_key[key] = {
                        "seasonIndex": getattr(season, "index", None),
                        "airedAt": aired.isoformat() if aired else None,
                        "reason": "kometa_overlay_label",
                    }
                    show_by_key[key] = show
                    continue
                try:
                    latest = _latest_season(show)
                except Exception:
                    continue
                if latest is None:
                    continue
                # Only the show's current latest season qualifies as "new season".
                if str(latest.ratingKey) != str(season.ratingKey):
                    continue
                # Never badge season 1 (or specials) — "New Season" means a return.
                if not _is_returning_season(latest, show):
                    continue
                added = _as_datetime(getattr(ep, "addedAt", None))
                if not _within_air_window(cutoff, aired):
                    continue
                should_have.add(key)
                show_by_key[key] = show
                meta_by_key[key] = {
                    "seasonIndex": latest.index,
                    "airedAt": aired.isoformat() if aired else None,
                    "addedAt": added.isoformat() if added else None,
                    "airDateSource": source,
                    "reason": None,
                    "library": section.title,
                }

            # Recently-added E01s with missing Plex air dates — TMDB only, never addedAt.
            try:
                recent = _search_recently_added_episodes(section, cutoff, max_results=250)
            except Exception as exc:
                _progress(progress, f"{section.title}: TMDB air-date fallback for recently added E01s failed ({exc})")
                recent = []
            e01s = [
                ep for ep in recent
                if getattr(ep, "index", None) in (1, "1")
            ]
            if e01s:
                _progress(
                    progress,
                    f"{section.title}: checking {len(e01s)} recently-added E01(s)…",
                )
            for ep in e01s:
                try:
                    show = ep.show()
                    season = ep.season()
                except Exception:
                    continue
                key = str(getattr(show, "ratingKey", "") or "")
                if not key or key in should_have:
                    continue
                if skip_kometa and _kometa_overlay_label_blocks(show, paths=paths, rating_key=key):
                    continue
                try:
                    latest = _latest_season(show)
                except Exception:
                    continue
                if latest is None or str(latest.ratingKey) != str(season.ratingKey):
                    continue
                if not _is_returning_season(latest, show):
                    continue
                aired = _as_datetime(getattr(ep, "originallyAvailableAt", None))
                added = _as_datetime(getattr(ep, "addedAt", None))
                source = "plex" if aired is not None else None
                if aired is None and resolver is not None and getattr(resolver, "active", False):
                    aired = resolver.resolve_episode_aired(ep, show)
                    if aired is not None:
                        source = "tmdb"
                if not _within_air_window(cutoff, aired):
                    continue
                should_have.add(key)
                show_by_key[key] = show
                meta_by_key[key] = {
                    "seasonIndex": latest.index,
                    "airedAt": aired.isoformat() if aired else None,
                    "addedAt": added.isoformat() if added else None,
                    "airDateSource": source,
                    "reason": None,
                    "library": section.title,
                }
            continue

        # Slow fallback (broken date filters / older plexapi).
        count = 0
        for show in section.all():
            count += 1
            if count % 25 == 0:
                _progress(progress, f"{section.title}: checked {count} shows…")
            ok, meta = should_have_overlay(show, cutoff, skip_kometa, resolver=resolver, paths=paths)
            key = str(show.ratingKey)
            show_by_key[key] = show
            meta_by_key[key] = {**meta, "library": section.title}
            if ok:
                should_have.add(key)

    _progress(progress, f"Eligible shows: {len(should_have)}")
    return should_have, meta_by_key, show_by_key


def discover_eligible_shows_for_keys(
    plex: PlexServer,
    config: dict,
    cutoff: datetime,
    skip_kometa: bool,
    rating_keys: set[str],
    progress: ProgressFn | None = None,
    resolver=None,
    paths: dict | None = None,
) -> tuple[set[str], dict[str, dict], dict[str, Any]]:
    """Eligibility check for an explicit ratingKey set — no section-wide scan."""
    should_have: set[str] = set()
    meta_by_key: dict[str, dict] = {}
    show_by_key: dict[str, Any] = {}
    keys = {str(k or "").strip() for k in (rating_keys or set()) if str(k or "").strip()}
    if not keys:
        return should_have, meta_by_key, show_by_key
    _progress(progress, f"Scoped New Season check — {len(keys)} title(s)…")
    for key in sorted(keys):
        show = _fetch_plex_item(plex, key)
        if show is None:
            _progress(progress, f"Title {key}: not found in Plex — skipped")
            continue
        itype = str(getattr(show, "type", "") or "").lower()
        title = getattr(show, "title", None) or key
        if itype != "show":
            _progress(progress, f"{title}: not a TV show — New Season skipped")
            meta_by_key[key] = {"reason": "not_show", "library": _library_title(show)}
            continue
        ok, meta = should_have_overlay(show, cutoff, skip_kometa, resolver=resolver, paths=paths)
        library = _library_title(show)
        meta_by_key[key] = {**meta, "library": library}
        show_by_key[key] = show
        if ok:
            should_have.add(key)
            _progress(progress, f"{title}: eligible for New Season")
        else:
            reason = meta.get("reason") or "ineligible"
            _progress(progress, f"{title}: not eligible ({reason}) — nothing stamped")
    _progress(progress, f"Eligible shows (scoped): {len(should_have)}")
    return should_have, meta_by_key, show_by_key


def scan_library(config: dict, progress: ProgressFn | None = None) -> dict:
    plex = _connect(config)
    days = int(config.get("newSeasonDays") or config.get("new_season_days") or 7)
    cutoff = datetime.now() - timedelta(days=max(1, days))
    skip_kometa = _as_bool(config.get("skipIfKometaOverlayLabel", config.get("skip_if_kometa_overlay_label")), True)
    paths = _resolve_paths(config)
    log = _load_log(paths["log"])
    from tmdb_dates import create_resolver_from_config
    resolver = create_resolver_from_config(config, paths=paths, progress=progress)

    should_have, meta_by_key, show_by_key = discover_eligible_shows(
        plex, config, cutoff, skip_kometa, progress, resolver=resolver, paths=paths
    )
    resolver.save()

    eligible = []
    for key in sorted(should_have):
        show = show_by_key.get(key)
        meta = meta_by_key.get(key) or {}
        eligible.append({
            "ratingKey": key,
            "title": getattr(show, "title", None) or key,
            "library": meta.get("library") or "",
            "libraryKey": "",
            "seasonIndex": meta.get("seasonIndex"),
            "airedAt": meta.get("airedAt"),
            "reason": meta.get("reason"),
            "inLog": key in log,
            "previewOnly": bool((log.get(key) or {}).get("preview_only")),
        })

    return {
        "ok": True,
        "cutoff": cutoff.isoformat(),
        "newSeasonDays": days,
        "eligibleCount": len(eligible),
        "eligible": eligible,
        "logCount": len(log),
        "logKeys": list(log.keys()),
        "toRemove": [k for k in log.keys() if k not in should_have],
    }


def _season_episode_log_key(show_key: str) -> str:
    return f"season:{show_key}"


def _is_season_episode_log_key(key: str) -> bool:
    return str(key or "").startswith("season:")


def _new_season_stamp_season_poster(config: dict | None = None) -> bool:
    """When on (default), New Season stamps the show poster and the latest season poster."""
    cfg = config or {}
    return _as_bool(
        cfg.get("newSeasonStampSeasonPoster", cfg.get("new_season_stamp_season_poster")),
        True,
    )


def _new_season_overlay_preset_id(config: dict | None = None) -> str:
    cfg = config or {}
    preset = str(cfg.get("overlayPresetId") or cfg.get("overlay_preset_id") or "new-season").strip() or "new-season"
    if _as_bool(cfg.get("newSeasonWatchNowStyle", cfg.get("new_season_watch_now_style")), False):
        return "new-season-watch-now"
    return preset


def _season_stamp_kept_for_new_season(
    *,
    show_key: str,
    entry: dict | None = None,
    keep_show_keys: set[str] | None = None,
) -> bool:
    key = str(show_key or "").strip()
    if key and key in (keep_show_keys or set()):
        return True
    source = str((entry or {}).get("source") or "").strip().lower()
    return source == "new-season"


def process_show_overlay(
    plex: PlexServer,
    show,
    config: dict,
    paths: dict,
    preview_mode: bool,
    progress: ProgressFn | None = None,
    library: str | None = None,
) -> dict:
    """New Season — show poster. Latest season poster is stamped separately when enabled."""
    from layer_stack import apply_banner_layer, drop_conflicting_mode_logs

    latest = _latest_season(show)
    if not latest:
        raise ValueError(f"No seasons for {show.title}")
    if not _is_returning_season(latest, show):
        raise ValueError(f"New Season skipped for first season: {show.title}")

    overlay_img = _load_show_overlay_image(config, paths, season_index=getattr(latest, "index", None))
    preset_id = str(config.get("overlayPresetId") or "new-season")
    placement = _effective_placement(config, "show", preset_id)

    show_poster = _item_poster_image(plex, show)
    if show_poster is None:
        raise RuntimeError(f"Failed to download show poster for {show.title}")

    entry = apply_banner_layer(
        plex=plex,
        show=show,
        paths=paths,
        mode="newseason",
        badge=overlay_img,
        placement=placement,
        preview_mode=preview_mode,
        progress=progress,
        library=(library or _library_title(show) or "").strip(),
        extra_meta={
            "seasonIndex": latest.index,
            "presetId": preset_id,
            "targets": ["show", "season"] if _new_season_stamp_season_poster(config) else ["show"],
        },
        current_poster=show_poster,
        config=config,
    )
    # Mirror clean base into legacy New Season backup folder (promotion source / reset).
    if not preview_mode:
        from layer_stack import base_poster_path
        import shutil
        key = str(show.ratingKey)
        base = base_poster_path(paths, key)
        legacy = _backup_dir(paths, key) / "show.png"
        if base.exists() and not legacy.exists():
            legacy.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(base, legacy)
            _progress(progress, f"Backed up original show poster: {show.title}")
            meta_path = _backup_dir(paths, key) / "meta.json"
            if not meta_path.exists():
                meta_path.write_text(
                    json.dumps(
                        {
                            "title": show.title,
                            "seasonIndex": latest.index,
                            "ratingKey": key,
                            "savedAt": datetime.now().isoformat(),
                            "mode": "new-season-show-only",
                        },
                        indent=2,
                        ensure_ascii=False,
                    )
                    + "\n",
                    encoding="utf-8",
                )
    dropped = entry.get("droppedLayers") or []
    if dropped and not preview_mode:
        drop_conflicting_mode_logs(paths, str(show.ratingKey), list(dropped))
    return entry


def remove_show_overlay(
    show,
    preview_mode: bool,
    progress: ProgressFn | None = None,
    paths: dict | None = None,
    config: dict | None = None,
) -> bool:
    rating_key = str(getattr(show, "ratingKey", "") or "")
    if preview_mode:
        _progress(progress, f"[Preview] Would remove overlay: {show.title}")
        return True
    _progress(progress, f"Removing overlay: {show.title}")

    if paths is not None and rating_key:
        from layer_stack import remove_banner_layer

        restored = remove_banner_layer(
            show=show,
            paths=paths,
            mode="newseason",
            preview_mode=False,
            progress=progress,
            config=config,
        )
        if restored:
            return True
        # Fall back to legacy full-poster restore if stack had nothing.
        restored = _restore_from_backup(show, paths, rating_key, progress)
        if restored:
            _sync_banner_overlay_label(
                show,
                paths=paths,
                rating_key=rating_key,
                has_overlays=False,
                config=config,
                progress=progress,
            )
            return True

    # Fallback when no on-disk backup (e.g. migrated logs from the standalone tool).
    _progress(progress, f"No backup for {show.title} — falling back to Plex poster list")
    ok = _reset_poster(show)
    if ok and paths is not None and rating_key:
        _sync_banner_overlay_label(
            show,
            paths=paths,
            rating_key=rating_key,
            has_overlays=False,
            config=config,
            progress=progress,
        )
    return ok


def _season_episode_backup_dir(paths: dict, show_key: str) -> Path:
    return paths["backupsSeasonEpisode"] / str(show_key)


def _save_season_episode_backup(paths: dict, show_key: str, season_img: Image.Image, meta: dict | None = None) -> bool:
    folder = _season_episode_backup_dir(paths, show_key)
    season_path = folder / "season.png"
    meta_path = folder / "meta.json"
    folder.mkdir(parents=True, exist_ok=True)
    saved = False
    if not season_path.exists():
        season_img.convert("RGBA").save(season_path)
        saved = True
    if meta and not meta_path.exists():
        meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return saved


def _clear_season_episode_backup(paths: dict, show_key: str) -> None:
    folder = _season_episode_backup_dir(paths, show_key)
    if not folder.exists():
        return
    for child in folder.iterdir():
        try:
            child.unlink()
        except Exception:
            pass
    try:
        folder.rmdir()
    except Exception:
        pass


def _restore_season_episode_from_backup(show, paths: dict, show_key: str, progress: ProgressFn | None = None) -> bool:
    folder = _season_episode_backup_dir(paths, show_key)
    season_path = folder / "season.png"
    if not season_path.exists():
        return False
    season_index = None
    meta_path = folder / "meta.json"
    if meta_path.exists():
        try:
            season_index = json.loads(meta_path.read_text(encoding="utf-8")).get("seasonIndex")
        except Exception:
            season_index = None
    season_item = _latest_season(show)
    if season_index is not None:
        try:
            for season in show.seasons():
                if season.index == season_index:
                    season_item = season
                    break
        except Exception:
            pass
    if season_item is None:
        return False
    try:
        _upload_poster_resilient(
            season_item,
            season_path,
            progress=progress,
            title=f"{getattr(show, 'title', show_key)} S{getattr(season_item, 'index', '')}",
        )
        _progress(progress, f"Restored season poster from New Episode backup: {getattr(show, 'title', show_key)}")
        _clear_season_episode_backup(paths, show_key)
        return True
    except Exception as exc:
        _progress(progress, f"Season New Episode restore failed for {show_key}: {exc}")
        return False


def process_season_new_episode_overlay(
    plex: PlexServer,
    show,
    paths: dict,
    preview_mode: bool,
    progress: ProgressFn | None = None,
    config: dict | None = None,
) -> dict:
    """Stamp the latest season poster with the New Season banner."""
    latest = _latest_season(show)
    if not latest:
        raise ValueError(f"No seasons for {getattr(show, 'title', '')}")
    overlay_img = _load_show_overlay_image(
        config, paths, season_index=getattr(latest, "index", None)
    )
    season_poster = _item_poster_image(plex, latest)
    if season_poster is None:
        raise RuntimeError(f"Failed to download season poster for {show.title}")

    show_key = str(show.ratingKey)
    if not preview_mode:
        saved = _save_season_episode_backup(
            paths,
            show_key,
            season_poster,
            meta={
                "title": show.title,
                "seasonIndex": latest.index,
                "ratingKey": show_key,
                "savedAt": datetime.now().isoformat(),
                "mode": "new-season-on-season",
            },
        )
        if saved:
            _progress(progress, f"Backed up season poster (New Season): {show.title} S{latest.index}")

    result = _apply_season_episode_overlay(season_poster.copy(), overlay_img, config)
    safe = _sanitize_filename(f"{show.title}_S{latest.index}_ns")
    now = datetime.now()
    preset = "new-season"
    if config:
        preset = str(config.get("overlayPresetId") or config.get("overlay_preset_id") or preset)
    entry = {
        "kind": "seasonEpisode",
        "title": f"{show.title} — S{latest.index}",
        "showTitle": show.title,
        "showKey": show_key,
        "seasonIndex": latest.index,
        "timestamp": now.isoformat(),
        "preview_only": bool(preview_mode),
        "presetId": preset,
        "hasBackup": (_season_episode_backup_dir(paths, show_key) / "season.png").exists(),
        "library": _library_title(show),
    }

    if preview_mode:
        out = paths["preview"] / f"{safe}_season_ns.png"
        result.save(out)
        entry["previewSeason"] = str(out)
        _progress(progress, f"Preview season New Season: {show.title} S{latest.index}")
    else:
        temp = paths["preview"] / f"temp_{safe}_season_ns.png"
        result.save(temp)
        try:
            _upload_poster_resilient(
                latest,
                temp,
                progress=progress,
                title=f"{show.title} S{latest.index}",
            )
            _progress(progress, f"Uploaded season New Season: {show.title} S{latest.index}")
            _sync_banner_overlay_label(
                latest,
                paths=paths,
                rating_key=str(getattr(latest, "ratingKey", "") or show_key),
                has_overlays=True,
                config=config,
                progress=progress,
            )
            entry["labeled"] = True
        finally:
            if temp.exists():
                temp.unlink()
    return entry


def remove_season_new_episode_overlay(
    show,
    preview_mode: bool,
    progress: ProgressFn | None = None,
    paths: dict | None = None,
    config: dict | None = None,
) -> bool:
    show_key = str(getattr(show, "ratingKey", "") or "")
    title = getattr(show, "title", show_key)
    if preview_mode:
        _progress(progress, f"[Preview] Would remove season New Episode overlay: {title}")
        return True
    _progress(progress, f"Removing season New Episode overlay: {title}")
    latest = _latest_season(show)
    restored = False
    if paths is not None and show_key:
        if _restore_season_episode_from_backup(show, paths, show_key, progress):
            restored = True
    if not restored and latest:
        _progress(progress, f"No season-NE backup for {title} — falling back to Plex poster list")
        restored = _reset_poster(latest)
    if restored and latest is not None:
        _sync_banner_overlay_label(
            latest,
            paths=paths,
            rating_key=str(getattr(latest, "ratingKey", "") or show_key),
            has_overlays=False,
            config=config,
            progress=progress,
        )
    return restored


def _drop_new_season_season_stamp(
    show,
    *,
    paths: dict,
    config: dict | None,
    preview_mode: bool,
    progress: ProgressFn | None,
    episode_log: dict,
) -> None:
    """Restore the latest season poster when New Season no longer owns it."""
    if not _new_season_stamp_season_poster(config):
        return
    show_key = str(getattr(show, "ratingKey", "") or "")
    if not show_key:
        return
    log_key = _season_episode_log_key(show_key)
    if preview_mode:
        if log_key in episode_log:
            del episode_log[log_key]
        return
    try:
        remove_season_new_episode_overlay(show, False, progress, paths=paths, config=config)
    except Exception as exc:
        _progress(progress, f"Season New Season restore failed for {show_key}: {exc}")
    if log_key in episode_log:
        del episode_log[log_key]


def _ensure_new_season_season_stamps(
    plex: PlexServer,
    config: dict,
    paths: dict,
    preview_mode: bool,
    progress: ProgressFn | None,
    show_by_key: dict,
    should_have: set[str],
    errors: list[str],
) -> int:
    """Stamp the latest season poster for every New Season-eligible show."""
    if not _new_season_stamp_season_poster(config) or not should_have:
        return 0
    episode_log = _load_log(paths["episodeLog"])
    added = 0
    want_preset = _new_season_overlay_preset_id(config)
    for key in sorted(should_have):
        show = show_by_key.get(key)
        if show is None:
            continue
        log_key = _season_episode_log_key(key)
        existing = episode_log.get(log_key)
        existing = existing if isinstance(existing, dict) else None
        existing_preset = str((existing or {}).get("presetId") or "").strip()
        needs = (
            preview_mode
            or existing is None
            or bool((existing or {}).get("preview_only"))
            or existing_preset != want_preset
            or existing_preset in {"new-episode", "new-episode-watch-now", ""}
        )
        if not needs:
            if existing and existing.get("source") != "new-season":
                episode_log[log_key] = {**existing, "source": "new-season"}
            continue
        try:
            entry = process_season_new_episode_overlay(
                plex, show, paths, preview_mode, progress, config=config
            )
            entry["source"] = "new-season"
            episode_log[log_key] = {**(existing or {}), **entry}
            added += 1
        except Exception as exc:
            title = getattr(show, "title", key)
            errors.append(f"season {title}: {exc}")
            _progress(progress, f"Error on season New Season stamp {key}: {exc}")
    _save_log(paths["episodeLog"], episode_log)
    return added


def _episode_backup_dir(paths: dict, rating_key: str) -> Path:
    return paths["backupsEpisodes"] / str(rating_key)


def _save_episode_backup(paths: dict, rating_key: str, thumb_img: Image.Image, meta: dict | None = None) -> bool:
    folder = _episode_backup_dir(paths, rating_key)
    thumb_path = folder / "episode.png"
    meta_path = folder / "meta.json"
    folder.mkdir(parents=True, exist_ok=True)
    saved = False
    if not thumb_path.exists():
        thumb_img.convert("RGBA").save(thumb_path)
        saved = True
    if meta and not meta_path.exists():
        meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return saved


def _clear_episode_backup(paths: dict, rating_key: str) -> None:
    folder = _episode_backup_dir(paths, rating_key)
    if not folder.exists():
        return
    for child in folder.iterdir():
        try:
            child.unlink()
        except Exception:
            pass
    try:
        folder.rmdir()
    except Exception:
        pass


def _restore_episode_from_backup(episode, paths: dict, rating_key: str, progress: ProgressFn | None = None) -> bool:
    thumb_path = _episode_backup_dir(paths, rating_key) / "episode.png"
    if not thumb_path.exists():
        return False
    try:
        _upload_poster_resilient(
            episode,
            thumb_path,
            progress=progress,
            title=getattr(episode, "title", rating_key),
        )
        _progress(progress, f"Restored episode thumb from backup: {getattr(episode, 'title', rating_key)}")
        _clear_episode_backup(paths, rating_key)
        return True
    except Exception as exc:
        _progress(progress, f"Episode backup restore failed for {rating_key}: {exc}")
        return False


def _search_recent_episodes(section, cutoff: datetime):
    """Any episode (not just E01) aired on/after cutoff — with client-side date enforcement."""
    cutoff_str = cutoff.strftime("%Y-%m-%d")
    plex = getattr(section, "_server", None)
    section_id = str(getattr(section, "key", "") or "").rstrip("/").split("/")[-1]

    def _client_filter(items: list) -> list:
        out = []
        for ep in items or []:
            aired = _as_datetime(getattr(ep, "originallyAvailableAt", None))
            if aired is None or aired < cutoff:
                continue
            out.append(ep)
        return out

    candidates: list = []
    try:
        candidates = list(section.search(
            libtype="episode",
            filters={"originallyAvailableAt>>=": cutoff_str},
        ))
    except Exception:
        candidates = []

    if len(candidates) > 2000:
        filtered = _client_filter(candidates)
        if len(filtered) <= 800:
            return filtered
        candidates = []

    if not candidates and plex is not None and section_id:
        try:
            key = (
                f"/library/sections/{section_id}/all"
                f"?type=4&originallyAvailableAt>={cutoff_str}"
            )
            candidates = list(plex.fetchItems(key) or [])
        except Exception:
            candidates = []
        if len(candidates) > 2000:
            filtered = _client_filter(candidates)
            if len(filtered) <= 800:
                return filtered
            raise RuntimeError(
                f"Plex returned {len(candidates)} episode rows without honouring the air-date filter"
            )

    return _client_filter(candidates)


def _filter_binge_drop_keys(
    meta_by_key: dict[str, dict],
    *,
    min_count: int = 3,
) -> set[str]:
    """
    Episodes that belong to a same-day season dump (binge release).
    Group by show + season + calendar air date; ≥ min_count → binge.
    """
    from collections import defaultdict

    groups: dict[tuple, list[str]] = defaultdict(list)
    for key, meta in meta_by_key.items():
        show_key = str(meta.get("showKey") or "").strip()
        season_raw = meta.get("seasonIndex")
        aired_raw = str(meta.get("airedAt") or "")
        day = aired_raw[:10]
        if not show_key or season_raw is None or len(day) < 10:
            continue
        try:
            season = int(season_raw)
        except (TypeError, ValueError):
            continue
        groups[(show_key, season, day)].append(key)

    binge: set[str] = set()
    for keys in groups.values():
        if len(keys) >= min_count:
            binge.update(keys)
    return binge


def discover_new_episodes(
    plex: PlexServer,
    config: dict,
    cutoff: datetime,
    skip_kometa: bool,
    progress: ProgressFn | None = None,
    resolver=None,
    paths: dict | None = None,
) -> tuple[set[str], dict[str, Any], dict[str, dict]]:
    """Return (keys, episode_by_key, meta_by_key) for episodes aired within the window."""
    should_have: set[str] = set()
    episode_by_key: dict[str, Any] = {}
    meta_by_key: dict[str, dict] = {}
    window_days = max(1, (datetime.now() - cutoff).days)
    skip_binge = _as_bool(
        config.get("skipNewEpisodeOnBinge", config.get("skip_new_episode_on_binge")),
        True,
    )

    def _add_episode(ep, section_title: str, aired: datetime, source: str) -> None:
        key = str(getattr(ep, "ratingKey", "") or "")
        if not key or key in should_have:
            return
        try:
            show = ep.show()
        except Exception:
            show = None
        show_key = str(
            getattr(show, "ratingKey", None)
            or getattr(ep, "grandparentRatingKey", None)
            or ""
        )
        if skip_kometa and show is not None and _kometa_overlay_label_blocks(show, paths=paths, rating_key=show_key):
            return
        if skip_kometa and _kometa_overlay_label_blocks(ep, paths=paths, rating_key=key):
            return
        show_title = getattr(show, "title", None) if show is not None else None
        should_have.add(key)
        episode_by_key[key] = ep
        meta_by_key[key] = {
            "title": getattr(ep, "title", None) or key,
            "showTitle": show_title or "",
            "showKey": show_key,
            "seasonIndex": getattr(ep, "parentIndex", None) or getattr(ep, "seasonNumber", None),
            "episodeIndex": getattr(ep, "index", None),
            "airedAt": aired.isoformat(),
            "airDateSource": source,
            "library": section_title,
        }

    tv_sections = list(_iter_tv_sections(plex, config, bundle="core"))
    if not tv_sections:
        _progress(progress, "No TV libraries in Banners (core) scope (check the library selector on this card).")

    for section in tv_sections:
        _progress(progress, f"Scanning {section.title} for new episodes…")
        try:
            episodes = _search_recent_episodes(section, cutoff)
        except Exception as exc:
            _progress(progress, f"{section.title}: episode search failed ({exc})")
            episodes = []
        _progress(
            progress,
            f"{section.title}: {len(episodes)} episode(s) in the last {window_days} day(s)",
        )
        for idx, ep in enumerate(episodes, start=1):
            if idx == 1 or idx % 25 == 0 or idx == len(episodes):
                _progress(progress, f"{section.title}: checking episode {idx}/{len(episodes)}…")
            aired = _as_datetime(getattr(ep, "originallyAvailableAt", None))
            if aired is None or aired < cutoff:
                continue
            _add_episode(ep, section.title, aired, "plex")

        if resolver is not None and getattr(resolver, "active", False):
            try:
                recent = _search_recently_added_episodes(section, cutoff, max_results=250)
            except Exception as exc:
                _progress(progress, f"{section.title}: TMDB episode fallback scan failed ({exc})")
                recent = []
            undated = [
                ep for ep in recent
                if _as_datetime(getattr(ep, "originallyAvailableAt", None)) is None
                and str(getattr(ep, "ratingKey", "") or "") not in should_have
            ]
            if undated:
                _progress(
                    progress,
                    f"{section.title}: TMDB fallback checking {len(undated)} undated episode(s)…",
                )
            for ep in undated:
                try:
                    show = ep.show()
                except Exception:
                    show = None
                aired = resolver.resolve_episode_aired(ep, show)
                if aired is None or aired < cutoff:
                    continue
                _add_episode(ep, section.title, aired, "tmdb")

    if skip_binge and should_have:
        binge_keys = _filter_binge_drop_keys(meta_by_key, min_count=3)
        if binge_keys:
            _progress(
                progress,
                f"Binge skip: dropping {len(binge_keys)} episode badge(s) "
                f"(same-day season dump — New Season covers these)",
            )
            should_have -= binge_keys
            for key in binge_keys:
                episode_by_key.pop(key, None)
                meta_by_key.pop(key, None)

    _progress(progress, f"Eligible new episodes: {len(should_have)}")
    return should_have, episode_by_key, meta_by_key


def discover_new_episodes_for_keys(
    plex: PlexServer,
    config: dict,
    cutoff: datetime,
    skip_kometa: bool,
    rating_keys: set[str],
    progress: ProgressFn | None = None,
    resolver=None,
    paths: dict | None = None,
) -> tuple[set[str], dict[str, Any], dict[str, dict]]:
    """Check New Episode eligibility for explicit show/episode ratingKeys — no library scan."""
    should_have: set[str] = set()
    episode_by_key: dict[str, Any] = {}
    meta_by_key: dict[str, dict] = {}
    keys = {str(k or "").strip() for k in (rating_keys or set()) if str(k or "").strip()}
    if not keys:
        return should_have, episode_by_key, meta_by_key
    skip_binge = _as_bool(
        config.get("skipNewEpisodeOnBinge", config.get("skip_new_episode_on_binge")),
        True,
    )
    _progress(progress, f"Scoped New Episode check — {len(keys)} title(s)…")

    def _try_add(ep, show, library: str) -> None:
        key = str(getattr(ep, "ratingKey", "") or "")
        if not key or key in should_have:
            return
        show_key = str(
            getattr(show, "ratingKey", None)
            or getattr(ep, "grandparentRatingKey", None)
            or ""
        )
        if skip_kometa and show is not None and _kometa_overlay_label_blocks(show, paths=paths, rating_key=show_key):
            return
        if skip_kometa and _kometa_overlay_label_blocks(ep, paths=paths, rating_key=key):
            return
        aired = _as_datetime(getattr(ep, "originallyAvailableAt", None))
        source = "plex" if aired is not None else None
        if aired is None and resolver is not None and getattr(resolver, "active", False) and show is not None:
            aired = resolver.resolve_episode_aired(ep, show)
            if aired is not None:
                source = "tmdb"
        if aired is None or aired < cutoff:
            return
        show_title = getattr(show, "title", None) if show is not None else None
        should_have.add(key)
        episode_by_key[key] = ep
        meta_by_key[key] = {
            "title": getattr(ep, "title", None) or key,
            "showTitle": show_title or "",
            "showKey": show_key,
            "seasonIndex": getattr(ep, "parentIndex", None) or getattr(ep, "seasonNumber", None),
            "episodeIndex": getattr(ep, "index", None),
            "airedAt": aired.isoformat(),
            "airDateSource": source,
            "library": library,
        }

    for key in sorted(keys):
        item = _fetch_plex_item(plex, key)
        if item is None:
            _progress(progress, f"Title {key}: not found in Plex — New Episode skipped")
            continue
        itype = str(getattr(item, "type", "") or "").lower()
        title = getattr(item, "title", None) or key
        library = _library_title(item)
        if itype == "episode":
            show = None
            try:
                show = item.show()
            except Exception:
                show = None
            before = len(should_have)
            _try_add(item, show, library)
            if len(should_have) == before:
                _progress(progress, f"{title}: not eligible for New Episode — nothing stamped")
            continue
        if itype != "show":
            _progress(progress, f"{title}: not a show/episode — New Episode skipped")
            continue
        try:
            eps = list(item.episodes() or [])
        except Exception as exc:
            _progress(progress, f"{title}: episode list failed ({exc})")
            continue
        before = len(should_have)
        for ep in eps:
            _try_add(ep, item, library)
        if len(should_have) == before:
            _progress(progress, f"{title}: no eligible new episodes in window — nothing stamped")

    if skip_binge and should_have:
        binge_keys = _filter_binge_drop_keys(meta_by_key, min_count=3)
        if binge_keys:
            _progress(
                progress,
                f"Binge skip: dropping {len(binge_keys)} episode badge(s) "
                f"(same-day season dump — New Season covers these)",
            )
            should_have -= binge_keys
            for key in binge_keys:
                episode_by_key.pop(key, None)
                meta_by_key.pop(key, None)

    _progress(progress, f"Eligible new episodes (scoped): {len(should_have)}")
    return should_have, episode_by_key, meta_by_key


def process_episode_overlay(
    plex: PlexServer,
    episode,
    meta: dict,
    paths: dict,
    preview_mode: bool,
    progress: ProgressFn | None = None,
    config: dict | None = None,
) -> dict:
    overlay_img = _load_episode_overlay_image(config, paths)
    thumb = _item_poster_image(plex, episode)
    if thumb is None:
        raise RuntimeError(f"Failed to download episode thumb for {meta.get('title') or episode}")

    rating_key = str(episode.ratingKey)
    if not preview_mode:
        saved = _save_episode_backup(
            paths,
            rating_key,
            thumb,
            meta={
                **meta,
                "ratingKey": rating_key,
                "savedAt": datetime.now().isoformat(),
            },
        )
        if saved:
            _progress(progress, f"Backed up episode thumb: {meta.get('showTitle') or ''} — {meta.get('title')}")

    result = _apply_episode_overlay(thumb.copy(), overlay_img, config)
    safe = _sanitize_filename(f"{meta.get('showTitle') or 'show'}_{meta.get('title') or rating_key}")
    now = datetime.now()
    entry = {
        "title": meta.get("title") or getattr(episode, "title", rating_key),
        "showTitle": meta.get("showTitle") or "",
        "timestamp": now.isoformat(),
        "airedAt": meta.get("airedAt"),
        "seasonIndex": meta.get("seasonIndex"),
        "episodeIndex": meta.get("episodeIndex"),
        "preview_only": bool(preview_mode),
        "presetId": str(
            (meta.get("presetId") if meta else None)
            or "new-episode"
        ),
        "showKey": meta.get("showKey") or "",
        "library": (meta.get("library") or _library_title(episode) or "").strip(),
        "hasBackup": (_episode_backup_dir(paths, rating_key) / "episode.png").exists(),
    }

    label = f"{entry['showTitle']} — {entry['title']}".strip(" —")
    if preview_mode:
        out = paths["previewEpisodes"] / f"{safe}.png"
        result.save(out)
        entry["previewEpisode"] = str(out)
        _progress(progress, f"Preview episode saved: {label}")
    else:
        temp = paths["previewEpisodes"] / f"temp_{safe}.png"
        result.save(temp)
        try:
            _upload_poster_resilient(episode, temp, progress=progress, title=label)
            _progress(progress, f"Uploaded episode thumb: {label}")
            _sync_banner_overlay_label(
                episode,
                paths=paths,
                rating_key=rating_key,
                has_overlays=True,
                config=config,
                progress=progress,
            )
            entry["labeled"] = True
        finally:
            if temp.exists():
                temp.unlink()

    return entry


def remove_episode_overlay(
    episode,
    preview_mode: bool,
    progress: ProgressFn | None = None,
    paths: dict | None = None,
    config: dict | None = None,
) -> bool:
    rating_key = str(getattr(episode, "ratingKey", "") or "")
    title = getattr(episode, "title", rating_key)
    if preview_mode:
        _progress(progress, f"[Preview] Would remove episode overlay: {title}")
        return True
    _progress(progress, f"Removing episode overlay: {title}")
    restored = False
    if paths is not None and rating_key:
        if _restore_episode_from_backup(episode, paths, rating_key, progress):
            restored = True
    if not restored:
        _progress(progress, f"No episode backup for {title} — falling back to Plex poster list")
        restored = _reset_poster(episode)
    if restored:
        _sync_banner_overlay_label(
            episode,
            paths=paths,
            rating_key=rating_key,
            has_overlays=False,
            config=config,
            progress=progress,
        )
    return restored


def run_new_episode_overlays(
    plex: PlexServer,
    config: dict,
    paths: dict,
    preview_mode: bool,
    progress: ProgressFn | None = None,
    resolver=None,
    keep_season_show_keys: set[str] | None = None,
) -> dict:
    keep_season_show_keys = {
        str(k).strip() for k in (keep_season_show_keys or set()) if str(k or "").strip()
    }
    stamp_ns_season = _new_season_stamp_season_poster(config)
    new_season_on = _as_bool(config.get("newSeasonEnabled", config.get("new_season_enabled")), True)
    if not _as_bool(config.get("newEpisodeEnabled", config.get("new_episode_enabled")), True):
        only_keys = _only_rating_keys(config)
        if only_keys:
            _progress(progress, "New Episode overlays disabled — scoped pass leaves tracked stamps alone")
            return {
                "episodesAdded": 0,
                "episodesRefreshed": 0,
                "episodesSkipped": 0,
                "episodesRemoved": 0,
                "episodesEligible": 0,
                "episodesTotal": 0,
                "seasonStampsAdded": 0,
                "seasonStampsRemoved": 0,
                "episodeErrors": [],
                "newEpisodeEnabled": False,
            }
        _progress(progress, "New Episode overlays disabled — pruning tracked stamps…")
        log = _load_log(paths["episodeLog"])
        removed = 0
        season_removed = 0
        errors: list[str] = []
        for key in list(log.keys()):
            entry = log.get(key) or {}
            try:
                if preview_mode:
                    if bool(entry.get("preview_only")):
                        del log[key]
                        removed += 1
                    continue
                if _is_season_episode_log_key(key):
                    show_key = str(key).split(":", 1)[-1]
                    if stamp_ns_season and new_season_on and _season_stamp_kept_for_new_season(
                        show_key=show_key,
                        entry=entry if isinstance(entry, dict) else None,
                        keep_show_keys=keep_season_show_keys,
                    ):
                        continue
                    try:
                        show = plex.fetchItem(f"/library/metadata/{show_key}")
                    except Exception:
                        del log[key]
                        season_removed += 1
                        continue
                    remove_season_new_episode_overlay(show, False, progress, paths=paths, config=config)
                    del log[key]
                    season_removed += 1
                    continue
                try:
                    episode = plex.fetchItem(f"/library/metadata/{key}")
                except Exception:
                    del log[key]
                    removed += 1
                    continue
                remove_episode_overlay(episode, False, progress, paths=paths, config=config)
                del log[key]
                removed += 1
            except Exception as exc:
                errors.append(f"episode disable-remove {key}: {exc}")
        _save_log(paths["episodeLog"], log)
        return {
            "episodesAdded": 0,
            "episodesRefreshed": 0,
            "episodesSkipped": 0,
            "episodesRemoved": removed,
            "episodesEligible": 0,
            "episodesTotal": len(log),
            "seasonStampsAdded": 0,
            "seasonStampsRemoved": season_removed,
            "episodeErrors": errors,
            "newEpisodeEnabled": False,
        }

    days = int(config.get("newEpisodeDays") or config.get("new_episode_days") or 6)
    cutoff = datetime.now() - timedelta(days=max(1, min(30, days)))
    skip_kometa = _as_bool(config.get("skipIfKometaOverlayLabel", config.get("skip_if_kometa_overlay_label")), True)
    log = _load_log(paths["episodeLog"])
    episode_preset = str(
        config.get("episodeOverlayPresetId") or config.get("episode_overlay_preset_id") or "new-episode"
    )

    _progress(progress, f"Scanning for new episodes (window {max(1, min(30, days))} days)…")
    if resolver is None:
        from tmdb_dates import create_resolver_from_config
        resolver = create_resolver_from_config(config, paths=paths, progress=progress)
        owns_resolver = True
    else:
        owns_resolver = False
    only_keys = _only_rating_keys(config)
    scoped_run = bool(only_keys)
    if scoped_run:
        should_have, episode_by_key, meta_by_key = discover_new_episodes_for_keys(
            plex, config, cutoff, skip_kometa, only_keys, progress, resolver=resolver, paths=paths
        )
    else:
        should_have, episode_by_key, meta_by_key = discover_new_episodes(
            plex, config, cutoff, skip_kometa, progress, resolver=resolver, paths=paths
        )

    added = 0
    refreshed = 0
    skipped = 0
    removed = 0
    season_added = 0
    season_removed = 0
    errors: list[str] = []

    for key in sorted(should_have):
        episode = episode_by_key[key]
        meta = {**(meta_by_key.get(key) or {}), "presetId": episode_preset}
        existing = log.get(key)
        try:
            if preview_mode:
                entry = process_episode_overlay(plex, episode, meta, paths, True, progress, config=config)
                if existing is None:
                    log[key] = entry
                    added += 1
                else:
                    log[key] = {**existing, **entry} if isinstance(existing, dict) else entry
                    refreshed += 1
                continue

            needs = existing is None or bool(existing.get("preview_only"))
            if not needs:
                lib = str(meta.get("library") or "").strip()
                if lib and isinstance(existing, dict) and not existing.get("library"):
                    log[key] = {**existing, "library": lib}
                skipped += 1
                continue

            entry = process_episode_overlay(plex, episode, meta, paths, False, progress, config=config)
            added += 1
            if isinstance(existing, dict):
                log[key] = {**existing, **entry}
            else:
                log[key] = entry
        except Exception as exc:
            label = f"{meta.get('showTitle') or ''} {meta.get('title') or key}".strip()
            errors.append(f"{label}: {exc}")
            _progress(progress, f"Error on episode {label}: {exc}")

    # Season posters: one New Episode stamp per show that still has eligible episodes.
    shows_needing_season: dict[str, Any] = {}
    for key in should_have:
        meta = meta_by_key.get(key) or {}
        show_key = str(meta.get("showKey") or "")
        if not show_key or show_key in shows_needing_season:
            continue
        ep = episode_by_key.get(key)
        show = None
        if ep is not None:
            try:
                show = ep.show()
            except Exception:
                show = None
        if show is None:
            try:
                show = plex.fetchItem(f"/library/metadata/{show_key}")
            except Exception:
                continue
        shows_needing_season[show_key] = show

    for show_key, show in shows_needing_season.items():
        log_key = _season_episode_log_key(show_key)
        existing = log.get(log_key)
        try:
            if preview_mode:
                entry = process_season_new_episode_overlay(
                    plex, show, paths, True, progress, config=config
                )
                if existing is None:
                    log[log_key] = entry
                    season_added += 1
                else:
                    log[log_key] = {**existing, **entry} if isinstance(existing, dict) else entry
                    season_added += 1
                continue
            want_preset = str(
                (config or {}).get("overlayPresetId")
                or (config or {}).get("overlay_preset_id")
                or "new-season"
            ).strip() or "new-season"
            existing_preset = ""
            if isinstance(existing, dict):
                existing_preset = str(existing.get("presetId") or "").strip()
            # Re-stamp when missing, preview-only, or still on the old New Episode season asset.
            needs = (
                existing is None
                or bool(existing.get("preview_only"))
                or existing_preset != want_preset
                or existing_preset in {"new-episode", "new-episode-watch-now", ""}
            )
            if not needs:
                continue
            entry = process_season_new_episode_overlay(
                plex, show, paths, False, progress, config=config
            )
            if not (isinstance(existing, dict) and existing.get("source") == "new-season"):
                entry["source"] = "new-episode"
            season_added += 1
            log[log_key] = {**(existing or {}), **entry} if isinstance(existing, dict) else entry
        except Exception as exc:
            errors.append(f"season {getattr(show, 'title', show_key)}: {exc}")
            _progress(progress, f"Error on season New Season stamp {show_key}: {exc}")

    needed_season_keys = {_season_episode_log_key(k) for k in shows_needing_season}

    if not scoped_run:
        for key in list(log.keys()):
            if key in should_have or key in needed_season_keys:
                continue
            entry = log.get(key) or {}
            try:
                if _is_season_episode_log_key(key):
                    show_key = key.split(":", 1)[-1]
                    if stamp_ns_season and new_season_on and _season_stamp_kept_for_new_season(
                        show_key=show_key,
                        entry=entry if isinstance(entry, dict) else None,
                        keep_show_keys=keep_season_show_keys,
                    ):
                        continue
                    title = entry.get("title") or show_key
                    if preview_mode:
                        if bool(entry.get("preview_only")):
                            del log[key]
                            season_removed += 1
                            _progress(progress, f"[Preview] Dropped tracked season New Episode: {title}")
                        else:
                            _progress(progress, f"[Preview] Would remove season New Episode: {title}")
                            season_removed += 1
                        continue
                    try:
                        show = plex.fetchItem(f"/library/metadata/{show_key}")
                    except Exception:
                        _progress(progress, f"Dropping inaccessible season-NE log entry {key}")
                        del log[key]
                        _clear_season_episode_backup(paths, show_key)
                        season_removed += 1
                        continue
                    if remove_season_new_episode_overlay(show, False, progress, paths=paths, config=config):
                        del log[key]
                        season_removed += 1
                    else:
                        _progress(progress, f"Season-NE remove may have failed for {title}; dropping log entry anyway")
                        del log[key]
                        _clear_season_episode_backup(paths, show_key)
                        season_removed += 1
                    continue

                title = entry.get("title") or key
                if preview_mode:
                    if bool(entry.get("preview_only")):
                        del log[key]
                        removed += 1
                        _progress(progress, f"[Preview] Dropped tracked episode (no longer eligible): {title}")
                    else:
                        _progress(progress, f"[Preview] Would remove live episode overlay: {title}")
                        removed += 1
                    continue
                episode = episode_by_key.get(key)
                if episode is None:
                    try:
                        episode = plex.fetchItem(f"/library/metadata/{key}")
                    except Exception:
                        _progress(progress, f"Dropping inaccessible episode log entry {key}")
                        del log[key]
                        removed += 1
                        continue
                if remove_episode_overlay(episode, False, progress, paths=paths, config=config):
                    del log[key]
                    removed += 1
                else:
                    _progress(progress, f"Episode remove may have failed for {title}; dropping log entry anyway")
                    del log[key]
                    _clear_episode_backup(paths, key)
                    removed += 1
            except Exception as exc:
                errors.append(f"remove {key}: {exc}")
    elif scoped_run:
        _progress(progress, "Scoped New Episode pass — prune of other titles skipped")

    _save_log(paths["episodeLog"], log)
    if owns_resolver and resolver is not None:
        resolver.save()
    real_eps = sum(1 for k in log if not _is_season_episode_log_key(k))
    _progress(
        progress,
        f"New Episode done — eligible {len(should_have)}, added {added}, "
        f"refreshed {refreshed}, removed {removed}, season stamps +{season_added}/−{season_removed}, "
        f"total eps {real_eps}",
    )
    out = {
        "episodesAdded": added,
        "episodesRefreshed": refreshed,
        "episodesSkipped": skipped,
        "episodesRemoved": removed,
        "episodesEligible": len(should_have),
        "episodesTotal": real_eps,
        "seasonStampsAdded": season_added,
        "seasonStampsRemoved": season_removed,
        "episodeErrors": errors,
        "episodeLogPath": str(paths["episodeLog"]),
        "episodeOverlayPath": str(paths["episodeOverlay"]),
        "episodePreviewDir": str(paths["previewEpisodes"]),
    }
    if resolver is not None and owns_resolver:
        out.update(resolver.summary())
    return out


def _normalize_run_bundle(value) -> str:
    raw = str(value or "core").strip().lower().replace("_", "-")
    if raw in {"all", "full"}:
        return "all"
    if raw in {"recently", "recent", "recently-added", "recentlyadded"}:
        return "recently"
    if raw in {"collections", "collection", "custom-collection", "custom-collections"}:
        return "collections"
    if raw in {"kometa", "kometa-style", "media", "media-info", "layer"}:
        return "kometa"
    return "core"


def _run_kometa_bundle(plex, config: dict, paths: dict, preview_mode: bool, progress: ProgressFn | None) -> dict:
    from modes_kometa import ensure_placement_preview_badges
    from kometa_engine import run_kometa_parity
    try:
        ensure_placement_preview_badges(paths["assets"], paths=paths)
    except Exception:
        pass
    # UI can pass kometaScope=media|collections; scheduler omits it → media-only pass.
    scope = str(config.get("kometaScope") or config.get("kometa_scope") or "").strip().lower()
    if not scope:
        bundle = _normalize_run_bundle(config.get("runBundle") or config.get("run_bundle") or "kometa")
        scope = "collections" if bundle == "collections" else "media"
    cfg = {**config, "kometaScope": scope}
    summary = run_kometa_parity(plex, cfg, paths, preview_mode, progress)
    out = {
        "ok": True,
        "runBundle": "collections" if scope == "collections" else "kometa",
        "kometaScope": scope,
        "previewMode": preview_mode,
        "finishedAt": datetime.now().isoformat(),
        "errors": list(summary.get("kometaErrors") or []),
    }
    out.update(summary)
    _progress(progress, f"Done (kometa/{scope}) — parity pass finished")
    return out


def _run_recently_bundle(plex, config: dict, paths: dict, preview_mode: bool, progress: ProgressFn | None) -> dict:
    from modes_extra import run_recently_added_overlays
    from tmdb_dates import create_resolver_from_config

    # Respect Live / New Season reservations without re-running those modes.
    live_log = _load_log(paths.get("liveLog") or (paths["root"] / "live_log.json"))
    season_log = _load_log(paths["log"])
    reserved = {str(k) for k in live_log.keys()} | {str(k) for k in season_log.keys()}
    resolver = create_resolver_from_config(config, paths=paths, progress=progress)
    recent_summary = run_recently_added_overlays(
        plex, config, paths, preview_mode, progress, reserved_keys=reserved
    )
    resolver.save()
    out = {
        "ok": True,
        "runBundle": "recently",
        "previewMode": preview_mode,
        "finishedAt": datetime.now().isoformat(),
        "errors": list(recent_summary.get("recentlyAddedErrors") or recent_summary.get("errors") or []),
    }
    out.update(recent_summary)
    out.update(resolver.summary())
    _progress(
        progress,
        f"Done (recently) — +{recent_summary.get('recentlyAddedAdded', recent_summary.get('recentlyAdded', 0))}/"
        f"-{recent_summary.get('recentlyAddedRemoved', recent_summary.get('recentlyRemoved', 0))}",
    )
    return out


def run_overlays(
    config: dict,
    progress: ProgressFn | None = None,
    preview_override: bool | None = None,
    bundle: str | None = None,
) -> dict:
    """Run overlay bundles separately so heavy passes do not block New Season.

    bundle:
      - core     — Live, New Season, New Episode, Top 10 (default Preview/Run + scheduler)
      - recently — Recently Added only
      - kometa   — Media / status / ratings / network only
      - all      — everything (legacy combined pass)
    """
    paths = _resolve_paths(config)
    preview_mode = _as_bool(
        preview_override if preview_override is not None else config.get("previewMode", config.get("preview_mode")),
        False,
    )
    run_bundle = _normalize_run_bundle(
        bundle if bundle is not None else config.get("runBundle", config.get("run_bundle", "core"))
    )
    plex = _connect(config)
    _progress(progress, f"Overlays bundle: {run_bundle}")

    if run_bundle == "kometa":
        return _run_kometa_bundle(plex, config, paths, preview_mode, progress)
    if run_bundle == "collections":
        return _run_kometa_bundle(
            plex,
            {**config, "kometaScope": "collections", "runBundle": "collections"},
            paths,
            preview_mode,
            progress,
        )
    if run_bundle == "recently":
        return _run_recently_bundle(plex, config, paths, preview_mode, progress)

    days = int(config.get("newSeasonDays") or config.get("new_season_days") or 7)
    cutoff = datetime.now() - timedelta(days=max(1, days))
    skip_kometa = _as_bool(config.get("skipIfKometaOverlayLabel", config.get("skip_if_kometa_overlay_label")), True)
    new_season_on = _as_bool(config.get("newSeasonEnabled", config.get("new_season_enabled")), True)

    log = _load_log(paths["log"])

    from tmdb_dates import create_resolver_from_config
    from modes_extra import run_live_overlays, run_recently_added_overlays, run_top10_overlays
    from modes_kometa import ensure_placement_preview_badges
    from kometa_engine import run_kometa_parity

    try:
        ensure_placement_preview_badges(paths["assets"], paths=paths)
    except Exception:
        pass

    resolver = create_resolver_from_config(config, paths=paths, progress=progress)

    kometa_summary: dict = {}
    if run_bundle == "all":
        # Kometa-parity corner/side badges first when doing a full combined pass.
        kometa_summary = run_kometa_parity(plex, config, paths, preview_mode, progress)

    live_summary = run_live_overlays(plex, config, paths, preview_mode, progress, resolver=resolver)
    reserved: set[str] = set(live_summary.get("liveKeys") or [])

    added = 0
    converted = 0
    refreshed = 0
    skipped = 0
    removed = 0
    errors: list[str] = []
    preview_files: list[dict] = []
    should_have: set[str] = set()
    _meta_by_key: dict = {}
    show_by_key: dict = {}
    only_keys = _only_rating_keys(config)
    scoped_run = bool(only_keys)
    if scoped_run:
        _progress(progress, f"Scoped title pass — {len(only_keys)} rating key(s); prune skipped")

    if new_season_on:
        if scoped_run:
            should_have, _meta_by_key, show_by_key = discover_eligible_shows_for_keys(
                plex, config, cutoff, skip_kometa, only_keys, progress, resolver=resolver, paths=paths
            )
        else:
            _progress(progress, "Scanning for eligible new seasons…")
            should_have, _meta_by_key, show_by_key = discover_eligible_shows(
                plex, config, cutoff, skip_kometa, progress, resolver=resolver, paths=paths
            )
        should_have = {k for k in should_have if k not in reserved}
        episode_log = _load_log(paths["episodeLog"])

        for key in sorted(should_have):
            show = show_by_key[key]
            existing = log.get(key)
            library = str((_meta_by_key.get(key) or {}).get("library") or "").strip() or None
            try:
                if preview_mode:
                    entry = process_show_overlay(
                        plex, show, config, paths, True, progress, library=library
                    )
                    preview_files.append({
                        "ratingKey": key,
                        "title": show.title,
                        "previewShow": entry.get("previewShow"),
                        "previewSeason": entry.get("previewSeason"),
                    })
                    if existing is None:
                        log[key] = entry
                        added += 1
                    else:
                        log[key] = {**existing, **entry} if isinstance(existing, dict) else entry
                        refreshed += 1
                    continue

                needs = existing is None or bool(existing.get("preview_only"))
                if not needs:
                    ok, _meta = should_have_overlay(show, cutoff, skip_kometa, resolver=resolver, paths=paths)
                    if not ok:
                        if remove_show_overlay(show, False, progress, paths=paths, config=config):
                            del log[key]
                            removed += 1
                            _progress(progress, f"Removed New Season (no longer eligible): {show.title}")
                        else:
                            del log[key]
                            removed += 1
                        _drop_new_season_season_stamp(
                            show,
                            paths=paths,
                            config=config,
                            preview_mode=False,
                            progress=progress,
                            episode_log=episode_log,
                        )
                        should_have.discard(key)
                        continue
                    if library and isinstance(existing, dict) and not existing.get("library"):
                        log[key] = {**existing, "library": library}
                    skipped += 1
                    _progress(progress, f"Already overlaid, skipping: {show.title}")
                    continue

                entry = process_show_overlay(
                    plex, show, config, paths, False, progress, library=library
                )
                if existing and existing.get("preview_only"):
                    converted += 1
                else:
                    added += 1
                if isinstance(existing, dict):
                    log[key] = {**existing, **entry}
                else:
                    log[key] = entry
            except Exception as exc:
                errors.append(f"{show.title}: {exc}")
                _progress(progress, f"Error on {show.title}: {exc}")

        if not scoped_run:
            for key in list(log.keys()):
                if key in should_have:
                    continue
                try:
                    entry = log.get(key) or {}
                    title = entry.get("title") or key
                    if preview_mode:
                        if bool(entry.get("preview_only")):
                            del log[key]
                            removed += 1
                            _progress(progress, f"[Preview] Dropped tracked show (no longer eligible): {title}")
                        else:
                            _progress(progress, f"[Preview] Would remove live overlay: {title}")
                            removed += 1
                        show = show_by_key.get(key)
                        if show is None:
                            try:
                                show = plex.fetchItem(f"/library/metadata/{key}")
                            except Exception:
                                show = None
                        if show is not None:
                            _drop_new_season_season_stamp(
                                show,
                                paths=paths,
                                config=config,
                                preview_mode=True,
                                progress=progress,
                                episode_log=episode_log,
                            )
                        continue
                    show = show_by_key.get(key)
                    if show is None:
                        try:
                            show = plex.fetchItem(f"/library/metadata/{key}")
                        except Exception:
                            _progress(progress, f"Dropping inaccessible log entry {key}")
                            del log[key]
                            removed += 1
                            continue
                    if remove_show_overlay(show, False, progress, paths=paths, config=config):
                        del log[key]
                        removed += 1
                    else:
                        _progress(progress, f"Remove may have failed for {title}; dropping log entry anyway")
                        del log[key]
                        if paths is not None:
                            _clear_backup_dir(paths, key)
                        removed += 1
                    _drop_new_season_season_stamp(
                        show,
                        paths=paths,
                        config=config,
                        preview_mode=False,
                        progress=progress,
                        episode_log=episode_log,
                    )
                except Exception as exc:
                    errors.append(f"remove {key}: {exc}")
        _save_log(paths["episodeLog"], episode_log)
        season_stamps = _ensure_new_season_season_stamps(
            plex, config, paths, preview_mode, progress, show_by_key, should_have, errors
        )
        if season_stamps:
            _progress(progress, f"Stamped New Season on {season_stamps} latest season poster(s)")
    elif not scoped_run:
        _progress(progress, "New Season overlays disabled — pruning tracked show stamps…")
        episode_log = _load_log(paths["episodeLog"])
        for key in list(log.keys()):
            entry = log.get(key) or {}
            title = entry.get("title") or key
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
                    removed += 1
                    continue
                remove_show_overlay(show, False, progress, paths=paths, config=config)
                _drop_new_season_season_stamp(
                    show,
                    paths=paths,
                    config=config,
                    preview_mode=False,
                    progress=progress,
                    episode_log=episode_log,
                )
                del log[key]
                removed += 1
            except Exception as exc:
                errors.append(f"disable-remove {key}: {exc}")
        _save_log(paths["episodeLog"], episode_log)
    elif scoped_run and not new_season_on:
        _progress(progress, "New Season overlays disabled — scoped pass leaves tracked stamps alone")

    _save_log(paths["log"], log)

    recent_summary: dict = {}
    if run_bundle == "all":
        reserved_for_recent = set(reserved) | set(should_have) | set(log.keys())
        recent_summary = run_recently_added_overlays(
            plex, config, paths, preview_mode, progress, reserved_keys=reserved_for_recent
        )

    summary = {
        "ok": True,
        "runBundle": run_bundle,
        "previewMode": preview_mode,
        "newSeasonEnabled": new_season_on,
        "added": added,
        "converted": converted,
        "refreshed": refreshed,
        "skipped": skipped,
        "removed": removed,
        "totalWithOverlays": len(log),
        "eligible": len(should_have),
        "errors": errors,
        "previewFiles": preview_files,
        "previewDir": str(paths["preview"]),
        "logPath": str(paths["log"]),
        "overlayPath": str(paths["overlay"]),
        "finishedAt": datetime.now().isoformat(),
    }
    summary.update(live_summary)
    if recent_summary:
        summary.update(recent_summary)
    if kometa_summary:
        summary.update(kometa_summary)
        if kometa_summary.get("kometaErrors"):
            summary["errors"] = [*(summary.get("errors") or []), *kometa_summary["kometaErrors"]]

    episode_summary = run_new_episode_overlays(
        plex,
        config,
        paths,
        preview_mode,
        progress,
        resolver=resolver,
        keep_season_show_keys=(
            should_have if (new_season_on and _new_season_stamp_season_poster(config)) else set()
        ),
    )
    summary.update(episode_summary)
    if episode_summary.get("episodeErrors"):
        summary["errors"] = [*(summary.get("errors") or []), *episode_summary["episodeErrors"]]

    top10_summary = run_top10_overlays(plex, config, paths, preview_mode, progress)
    summary.update(top10_summary)
    if top10_summary.get("top10Errors"):
        summary["errors"] = [*(summary.get("errors") or []), *top10_summary["top10Errors"]]

    resolver.save()
    summary.update(resolver.summary())

    if preview_mode:
        _progress(
            progress,
            f"Done (preview) — seasons eligible {len(should_have)}, new {added}, refreshed {refreshed}; "
            f"episodes eligible {episode_summary.get('episodesEligible', 0)}, "
            f"new {episode_summary.get('episodesAdded', 0)}, refreshed {episode_summary.get('episodesRefreshed', 0)}",
        )
    else:
        _progress(
            progress,
            f"Done — seasons +{added}/-{removed}; episodes +{episode_summary.get('episodesAdded', 0)}/"
            f"-{episode_summary.get('episodesRemoved', 0)}",
        )
    return summary



def reconcile(config: dict, progress: ProgressFn | None = None) -> dict:
    """Dry-run: what would add / remove without writing posters."""
    scan = scan_library(config, progress)
    log_keys = set(scan.get("logKeys") or [])
    eligible_keys = {row["ratingKey"] for row in scan.get("eligible") or []}
    to_add = [row for row in (scan.get("eligible") or []) if row["ratingKey"] not in log_keys]
    to_convert = [
        row for row in (scan.get("eligible") or [])
        if row["ratingKey"] in log_keys and row.get("previewOnly")
    ]
    to_remove = list(scan.get("toRemove") or [])
    return {
        "ok": True,
        "eligibleCount": scan.get("eligibleCount") or 0,
        "logCount": scan.get("logCount") or 0,
        "wouldAdd": to_add,
        "wouldConvert": to_convert,
        "wouldRemove": to_remove,
        "wouldAddCount": len(to_add),
        "wouldConvertCount": len(to_convert),
        "wouldRemoveCount": len(to_remove),
    }


def list_status(config: dict) -> dict:
    paths = _resolve_paths(config)
    log = _load_log(paths["log"])
    episode_log = _load_log(paths["episodeLog"])
    shows = []
    for key, entry in log.items():
        if not isinstance(entry, dict):
            continue
        shows.append({
            "ratingKey": key,
            "title": entry.get("title") or key,
            "library": entry.get("library") or "",
            "timestamp": entry.get("timestamp"),
            "previewOnly": bool(entry.get("preview_only")),
            "seasonIndex": entry.get("seasonIndex"),
            "presetId": entry.get("presetId"),
        })
    shows.sort(key=lambda r: str(r.get("timestamp") or ""), reverse=True)
    episodes = []
    for key, entry in episode_log.items():
        if not isinstance(entry, dict):
            continue
        episodes.append({
            "ratingKey": key,
            "title": entry.get("title") or key,
            "showTitle": entry.get("showTitle") or "",
            "library": entry.get("library") or "",
            "timestamp": entry.get("timestamp"),
            "airedAt": entry.get("airedAt"),
            "seasonIndex": entry.get("seasonIndex"),
            "episodeIndex": entry.get("episodeIndex"),
            "previewOnly": bool(entry.get("preview_only")),
            "presetId": entry.get("presetId") or "new-episode",
        })
    episodes.sort(key=lambda r: str(r.get("timestamp") or ""), reverse=True)
    return {
        "ok": True,
        "overlayExists": paths["overlay"].exists(),
        "overlayPath": str(paths["overlay"]),
        "episodeOverlayExists": paths["episodeOverlay"].exists(),
        "episodeOverlayPath": str(paths["episodeOverlay"]),
        "logPath": str(paths["log"]),
        "episodeLogPath": str(paths["episodeLog"]),
        "previewDir": str(paths["preview"]),
        "backupsDir": str(paths["backups"]),
        "logCount": len(log),
        "episodeLogCount": len(episode_log),
        "shows": shows,
        "episodes": episodes,
    }


def promote_preview_to_live(config: dict, progress: ProgressFn | None = None) -> dict:
    """
    Stamp every preview_only tracked show/episode/season-NE to live Plex art.
    Does not rescans libraries or prune ineligible items — tracked preview rows only.
    """
    paths = _resolve_paths(config)
    plex = _connect(config)
    show_log = _load_log(paths["log"])
    episode_log = _load_log(paths["episodeLog"])

    show_keys = [
        key for key, entry in show_log.items()
        if isinstance(entry, dict) and bool(entry.get("preview_only"))
    ]
    episode_keys = [
        key for key, entry in episode_log.items()
        if isinstance(entry, dict)
        and bool(entry.get("preview_only"))
        and not _is_season_episode_log_key(key)
    ]
    season_keys = [
        key for key, entry in episode_log.items()
        if isinstance(entry, dict)
        and bool(entry.get("preview_only"))
        and _is_season_episode_log_key(key)
    ]

    _progress(
        progress,
        f"Promoting preview → live — {len(show_keys)} show(s), "
        f"{len(episode_keys)} episode(s), {len(season_keys)} season stamp(s)…",
    )

    shows_promoted = 0
    episodes_promoted = 0
    seasons_promoted = 0
    errors: list[str] = []

    for key in sorted(show_keys):
        existing = show_log.get(key) or {}
        try:
            show = plex.fetchItem(f"/library/metadata/{key}")
            library = str(existing.get("library") or "").strip() or None
            entry = process_show_overlay(
                plex, show, config, paths, False, progress, library=library
            )
            show_log[key] = {**existing, **entry, "preview_only": False}
            shows_promoted += 1
            if _new_season_stamp_season_poster(config):
                try:
                    season_entry = process_season_new_episode_overlay(
                        plex, show, paths, False, progress, config=config
                    )
                    season_entry["source"] = "new-season"
                    season_key = _season_episode_log_key(key)
                    prev_season = episode_log.get(season_key)
                    prev_season = prev_season if isinstance(prev_season, dict) else {}
                    episode_log[season_key] = {**prev_season, **season_entry, "preview_only": False}
                    seasons_promoted += 1
                    season_keys = [k for k in season_keys if k != season_key]
                except Exception as season_exc:
                    errors.append(f"season {existing.get('title') or key}: {season_exc}")
                    _progress(progress, f"Promote failed for season stamp {existing.get('title') or key}: {season_exc}")
        except Exception as exc:
            title = existing.get("title") or key
            errors.append(f"show {title}: {exc}")
            _progress(progress, f"Promote failed for show {title}: {exc}")

    for key in sorted(episode_keys):
        existing = episode_log.get(key) or {}
        try:
            episode = plex.fetchItem(f"/library/metadata/{key}")
            meta = {
                "title": existing.get("title"),
                "showTitle": existing.get("showTitle") or "",
                "showKey": existing.get("showKey") or "",
                "seasonIndex": existing.get("seasonIndex"),
                "episodeIndex": existing.get("episodeIndex"),
                "airedAt": existing.get("airedAt"),
                "library": existing.get("library") or "",
                "presetId": existing.get("presetId")
                or config.get("episodeOverlayPresetId")
                or "new-episode",
            }
            entry = process_episode_overlay(
                plex, episode, meta, paths, False, progress, config=config
            )
            episode_log[key] = {**existing, **entry, "preview_only": False}
            episodes_promoted += 1
        except Exception as exc:
            label = f"{existing.get('showTitle') or ''} {existing.get('title') or key}".strip()
            errors.append(f"episode {label}: {exc}")
            _progress(progress, f"Promote failed for episode {label}: {exc}")

    for key in sorted(season_keys):
        existing = episode_log.get(key) or {}
        show_key = key.split(":", 1)[-1]
        try:
            show = plex.fetchItem(f"/library/metadata/{show_key}")
            entry = process_season_new_episode_overlay(
                plex, show, paths, False, progress, config=config
            )
            episode_log[key] = {**existing, **entry, "preview_only": False}
            seasons_promoted += 1
        except Exception as exc:
            title = existing.get("title") or show_key
            errors.append(f"season {title}: {exc}")
            _progress(progress, f"Promote failed for season stamp {title}: {exc}")

    _save_log(paths["log"], show_log)
    _save_log(paths["episodeLog"], episode_log)
    _progress(
        progress,
        f"Promote complete — shows {shows_promoted}, episodes {episodes_promoted}, "
        f"season stamps {seasons_promoted}, errors {len(errors)}",
    )
    return {
        "ok": True,
        "showsPromoted": shows_promoted,
        "episodesPromoted": episodes_promoted,
        "seasonsPromoted": seasons_promoted,
        "showsCandidate": len(show_keys),
        "episodesCandidate": len(episode_keys),
        "seasonsCandidate": len(season_keys),
        "errors": errors,
        "finishedAt": datetime.now().isoformat(),
    }


def reset_one(config: dict, rating_key: str, progress: ProgressFn | None = None, kind: str | None = None) -> dict:
    paths = _resolve_paths(config)
    plex = _connect(config)
    key = str(rating_key).strip()
    if not key:
        raise ValueError("ratingKey is required")

    episode_log = _load_log(paths["episodeLog"])
    show_log = _load_log(paths["log"])
    prefer_episode = (kind or "").lower() in {"episode", "episodes", "ep"}
    prefer_season_ne = (kind or "").lower() in {"seasonepisode", "season-episode", "season_ne"}
    prefer_show = (kind or "").lower() in {"show", "shows", "season"}
    prefer_kometa = (kind or "").lower() in {"kometa", "kometa-style", "media"}

    from kometa_engine import kometa_log_path, revert_kometa
    kometa_log = _load_log(kometa_log_path(paths))
    if prefer_kometa or (not prefer_episode and not prefer_season_ne and not prefer_show and key in kometa_log):
        result = revert_kometa(config, rating_key=key, progress=progress)
        title = (kometa_log.get(key) or {}).get("title") or key
        return {
            "ok": True,
            "kind": "kometa",
            "ratingKey": key,
            "title": title,
            "restoredFromBackup": result.get("reverted", 0) > 0,
        }

    if prefer_season_ne or _is_season_episode_log_key(key):
        show_key = key.split(":", 1)[-1] if _is_season_episode_log_key(key) else key
        log_key = _season_episode_log_key(show_key)
        show = plex.fetchItem(f"/library/metadata/{show_key}")
        had_backup = (_season_episode_backup_dir(paths, show_key) / "season.png").exists()
        remove_season_new_episode_overlay(show, False, progress, paths=paths, config=config)
        _clear_season_episode_backup(paths, show_key)
        if log_key in episode_log:
            del episode_log[log_key]
            _save_log(paths["episodeLog"], episode_log)
        return {
            "ok": True,
            "kind": "seasonEpisode",
            "ratingKey": show_key,
            "title": getattr(show, "title", show_key),
            "restoredFromBackup": had_backup,
        }

    if prefer_episode or (not prefer_show and key in episode_log and not _is_season_episode_log_key(key)):
        item = plex.fetchItem(f"/library/metadata/{key}")
        had_backup = (_episode_backup_dir(paths, key) / "episode.png").exists()
        remove_episode_overlay(item, False, progress, paths=paths, config=config)
        _clear_episode_backup(paths, key)
        if key in episode_log:
            del episode_log[key]
            _save_log(paths["episodeLog"], episode_log)
        return {
            "ok": True,
            "kind": "episode",
            "ratingKey": key,
            "title": getattr(item, "title", key),
            "restoredFromBackup": had_backup,
        }

    show = plex.fetchItem(f"/library/metadata/{key}")

    # Extra show modes (Recently Added / Live / Top 10) keep their own backups + logs.
    from modes_extra import (
        _clear_mode_backup,
        _restore_show_mode,
        _load_log as _load_extra_log,
        _save_log as _save_extra_log,
    )
    for mode, log_key, prefer_names in (
        ("recently", "recentlyAddedLog", {"recently", "recently-added", "recentlyadded"}),
        ("live", "liveLog", {"live"}),
        ("top10", "top10Log", {"top10", "top-10"}),
    ):
        prefer = (kind or "").lower().replace("_", "-") in prefer_names
        extra_log = _load_extra_log(paths[log_key])
        if prefer or (not prefer_show and not prefer_episode and not prefer_season_ne and key in extra_log):
            if key not in extra_log and not prefer:
                continue
            had_backup = (paths["backups"] / mode / key / "show.png").exists()
            from layer_stack import base_poster_path
            had_base = base_poster_path(paths, key).exists()
            restored = _restore_show_mode(show, paths, mode, progress, config=config)
            if not restored and not had_backup and not had_base:
                # Fall back to New Season restore helpers when no mode backup exists.
                remove_show_overlay(show, False, progress, paths=paths, config=config)
            _clear_mode_backup(paths, mode, key)
            if key in extra_log:
                del extra_log[key]
                _save_extra_log(paths[log_key], extra_log)
            return {
                "ok": True,
                "kind": mode,
                "ratingKey": key,
                "title": getattr(show, "title", key),
                "restoredFromBackup": bool(restored or had_backup or had_base),
            }

    from layer_stack import base_poster_path
    had_backup = (_backup_dir(paths, key) / "show.png").exists() or base_poster_path(paths, key).exists()
    remove_show_overlay(show, False, progress, paths=paths, config=config)
    _clear_backup_dir(paths, key)
    if key in show_log:
        del show_log[key]
        _save_log(paths["log"], show_log)
    return {
        "ok": True,
        "kind": "show",
        "ratingKey": key,
        "title": getattr(show, "title", key),
        "restoredFromBackup": had_backup,
    }


def reset_all(config: dict, progress: ProgressFn | None = None, scope: str | None = None) -> dict:
    """Reset logged overlays.

    scope:
      - all (default) — shows + episodes + Kometa + extra mode logs
      - shows — New Season show log only
      - episodes — New Episode (+ season NE) log only
    """
    paths = _resolve_paths(config)
    plex = _connect(config)
    want = str(scope or "all").strip().lower()
    if want in {"show", "shows", "new-season", "new_season"}:
        want = "shows"
    elif want in {"episode", "episodes", "new-episode", "new_episode"}:
        want = "episodes"
    else:
        want = "all"

    log = _load_log(paths["log"])
    episode_log = _load_log(paths["episodeLog"])
    keys = list(log.keys()) if want in {"all", "shows"} else []
    episode_keys = list(episode_log.keys()) if want in {"all", "episodes"} else []
    removed = 0
    episodes_removed = 0
    restored_from_backup = 0
    failed: list[str] = []
    if want == "shows":
        _progress(progress, f"Resetting {len(keys)} New Season show overlay(s)…")
    elif want == "episodes":
        _progress(progress, f"Resetting {len(episode_keys)} New Episode overlay(s)…")
    else:
        _progress(progress, f"Resetting {len(keys)} show overlay(s) and {len(episode_keys)} episode overlay(s)…")

    for key in keys:
        entry = log.get(key) or {}
        title = entry.get("title") or key
        had_backup = (_backup_dir(paths, key) / "show.png").exists()
        try:
            show = plex.fetchItem(f"/library/metadata/{key}")
            remove_show_overlay(show, False, progress, paths=paths, config=config)
            if had_backup:
                restored_from_backup += 1
            removed += 1
        except Exception as exc:
            failed.append(f"{title}: {exc}")
            _progress(progress, f"Failed to reset {title}: {exc}")
        _clear_backup_dir(paths, key)
        if key in log:
            del log[key]

    for key in episode_keys:
        entry = episode_log.get(key) or {}
        title = entry.get("title") or key
        if _is_season_episode_log_key(key):
            show_key = key.split(":", 1)[-1]
            had_backup = (_season_episode_backup_dir(paths, show_key) / "season.png").exists()
            try:
                show = plex.fetchItem(f"/library/metadata/{show_key}")
                remove_season_new_episode_overlay(show, False, progress, paths=paths, config=config)
                if had_backup:
                    restored_from_backup += 1
                episodes_removed += 1
            except Exception as exc:
                failed.append(f"season-NE {title}: {exc}")
                _progress(progress, f"Failed to reset season New Episode {title}: {exc}")
            _clear_season_episode_backup(paths, show_key)
            if key in episode_log:
                del episode_log[key]
            continue
        had_backup = (_episode_backup_dir(paths, key) / "episode.png").exists()
        try:
            episode = plex.fetchItem(f"/library/metadata/{key}")
            remove_episode_overlay(episode, False, progress, paths=paths, config=config)
            if had_backup:
                restored_from_backup += 1
            episodes_removed += 1
        except Exception as exc:
            failed.append(f"episode {title}: {exc}")
            _progress(progress, f"Failed to reset episode {title}: {exc}")
        _clear_episode_backup(paths, key)
        if key in episode_log:
            del episode_log[key]

    kometa_removed = 0
    extras_removed = 0
    if want == "all":
        try:
            from kometa_engine import revert_kometa
            kometa_result = revert_kometa(config, rating_key=None, progress=progress)
            kometa_removed = int(kometa_result.get("reverted") or 0)
            failed.extend(kometa_result.get("failed") or [])
        except Exception as exc:
            failed.append(f"kometa revert: {exc}")

        from modes_extra import _clear_mode_backup, _restore_show_mode, _load_log as _load_extra_log, _save_log as _save_extra_log

        for mode, log_key in (
            ("live", "liveLog"),
            ("recently", "recentlyAddedLog"),
            ("top10", "top10Log"),
            ("media", "mediaLog"),
            ("status", "statusLog"),
            ("ratings", "ratingsLog"),
            ("network", "networkLog"),
        ):
            extra_log = _load_extra_log(paths[log_key])
            for key in list(extra_log.keys()):
                entry = extra_log.get(key) or {}
                title = entry.get("title") or key
                try:
                    show = plex.fetchItem(f"/library/metadata/{key}")
                    _restore_show_mode(show, paths, mode, progress, config=config)
                    extras_removed += 1
                except Exception as exc:
                    failed.append(f"{mode} {title}: {exc}")
                _clear_mode_backup(paths, mode, key)
                del extra_log[key]
            _save_extra_log(paths[log_key], extra_log)

    if want in {"all", "shows"}:
        _save_log(paths["log"], log)
    if want in {"all", "episodes"}:
        _save_log(paths["episodeLog"], episode_log)

    remaining_shows = len(_load_log(paths["log"])) if want == "shows" else len(log)
    remaining_eps = len(_load_log(paths["episodeLog"])) if want == "episodes" else len(episode_log)
    if want == "all":
        remaining_shows = len(log)
        remaining_eps = len(episode_log)

    summary = {
        "ok": True,
        "scope": want,
        "requested": len(keys) + len(episode_keys),
        "removed": removed,
        "episodesRemoved": episodes_removed,
        "extrasRemoved": extras_removed,
        "kometaRemoved": kometa_removed,
        "restoredFromBackup": restored_from_backup,
        "failed": failed,
        "remaining": remaining_shows,
        "episodesRemaining": remaining_eps,
        "backupsDir": str(paths["backups"]),
        "finishedAt": datetime.now().isoformat(),
    }
    _progress(
        progress,
        f"Reset ({want}) complete — shows −{removed}, episodes −{episodes_removed}"
        + (f", kometa −{kometa_removed}, extras −{extras_removed}" if want == "all" else ""),
    )
    return summary


def list_tv_sections(config: dict) -> dict:
    """List show + movie libraries for Overlays Settings (TV modes ignore movies)."""
    plex = _connect(config)
    sections = []
    for section in plex.library.sections():
        stype = str(getattr(section, "type", "") or "").lower()
        if stype not in {"show", "movie"}:
            continue
        sections.append({
            "key": str(section.key),
            "id": str(section.key).rstrip("/").split("/")[-1],
            "title": section.title,
            "type": stype,
        })
    return {"ok": True, "sections": sections}


def _samples_dir(paths: dict) -> Path:
    folder = paths["preview"] / "samples"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _placeholder_poster(kind: str) -> Image.Image:
    if kind == "episode":
        return Image.new("RGB", (1280, 720), (28, 32, 48))
    return Image.new("RGB", (1000, 1500), (28, 32, 48))


def _pick_sample_items(plex: PlexServer, config: dict, progress: ProgressFn | None = None):
    """Return (show, episode) candidates with thumbs — small random pulls only."""
    show_candidates: list = []
    episode_candidates: list = []

    sections = list(_iter_tv_sections(plex, config, bundle="core"))
    if not sections:
        # Last resort for visual samples: any TV library, ignoring filters.
        sections = list(_iter_sections(plex, config, types=("show",), section_ids=[]))
        if sections:
            _progress(progress, "Sample pick: no libraries in scope — using all TV libraries")

    for section in sections:
        if len(show_candidates) < 40:
            batch: list = []
            for pull in (
                lambda: list(section.recentlyAdded(maxresults=40) or []),
                lambda: list(section.search(libtype="show", maxresults=40) or []),
                lambda: list(section.all(container_start=0, container_size=40) or []),
            ):
                if batch:
                    break
                try:
                    batch = [
                        item for item in (pull() or [])
                        if str(getattr(item, "type", "") or getattr(item, "TYPE", "") or "").lower()
                        in {"", "show"}
                        or hasattr(item, "seasons")
                    ]
                except TypeError:
                    try:
                        batch = list(section.all()[:40])
                    except Exception as exc:
                        _progress(progress, f"{section.title}: show sample pull failed ({exc})")
                        batch = []
                except Exception as exc:
                    _progress(progress, f"{section.title}: show sample pull failed ({exc})")
                    batch = []
            for item in batch:
                show_candidates.append(item)
                if len(show_candidates) >= 40:
                    break

        if len(episode_candidates) < 40:
            batch = []
            for pull in (
                lambda: list(section.recentlyAdded(maxresults=40, libtype="episode") or []),
                lambda: list(section.search(libtype="episode", maxresults=40) or []),
            ):
                if batch:
                    break
                try:
                    batch = list(pull() or [])
                except TypeError:
                    try:
                        batch = list(section.recentlyAdded(maxresults=40) or [])
                        batch = [
                            item for item in batch
                            if str(getattr(item, "type", "") or "").lower() == "episode"
                        ]
                    except Exception:
                        batch = []
                except Exception:
                    batch = []
            if not batch:
                try:
                    key = str(getattr(section, "key", "") or "").rstrip("/").split("/")[-1]
                    batch = list(
                        plex.fetchItems(
                            f"/library/sections/{key}/all?type=4"
                            f"&X-Plex-Container-Start=0&X-Plex-Container-Size=40"
                        )
                        or []
                    )
                except Exception as exc:
                    _progress(progress, f"{section.title}: episode sample pull failed ({exc})")
                    batch = []
            for item in batch:
                episode_candidates.append(item)
                if len(episode_candidates) >= 40:
                    break

        if len(show_candidates) >= 40 and len(episode_candidates) >= 40:
            break

    if not show_candidates:
        _progress(progress, "Sample pick: no shows found in scoped TV libraries")
    if not episode_candidates:
        _progress(progress, "Sample pick: no episodes found in scoped TV libraries")

    random.shuffle(show_candidates)
    random.shuffle(episode_candidates)
    show = show_candidates[0] if show_candidates else None
    episode = episode_candidates[0] if episode_candidates else None
    return show, episode


def search_sample_candidates(config: dict, query: str = "", progress: ProgressFn | None = None) -> dict:
    """Title search for pickers — shows + movies (max 25) with ratingKey, title, type, library."""
    plex = _connect(config)
    q = str(query or "").strip()
    results = []
    seen = set()

    def _add(item, section, libtype: str) -> bool:
        key = str(getattr(item, "ratingKey", "") or "")
        if not key or key in seen:
            return False
        seen.add(key)
        results.append({
            "ratingKey": key,
            "title": getattr(item, "title", None) or key,
            "library": section.title,
            "type": libtype,
        })
        return True

    # Prefer shows first (banner jobs), then movies (Layer / Collections).
    for section in _iter_tv_sections(plex, config):
        try:
            if q:
                batch = list(section.search(q, libtype="show", maxresults=25) or [])
            else:
                try:
                    batch = list(section.all(container_start=0, container_size=15) or [])
                except TypeError:
                    batch = list(section.all()[:15])
        except Exception as exc:
            _progress(progress, f"{section.title}: sample search failed ({exc})")
            continue
        for show in batch:
            _add(show, section, "show")
            if len(results) >= 25:
                break
        if len(results) >= 25:
            break

    if len(results) < 25:
        for section in _iter_movie_sections(plex, config, bundle="kometa"):
            try:
                if q:
                    batch = list(section.search(q, libtype="movie", maxresults=25) or [])
                else:
                    try:
                        batch = list(section.all(container_start=0, container_size=15) or [])
                    except TypeError:
                        batch = list(section.all()[:15])
            except Exception as exc:
                _progress(progress, f"{section.title}: movie sample search failed ({exc})")
                continue
            for movie in batch:
                _add(movie, section, "movie")
                if len(results) >= 25:
                    break
            if len(results) >= 25:
                break

    results.sort(key=lambda r: str(r.get("title") or "").lower())
    shows = [r for r in results if r.get("type") == "show"]
    return {"ok": True, "shows": shows, "items": results, "query": q}


def generate_overlay_samples(
    config: dict,
    progress: ProgressFn | None = None,
    show_rating_key: str | None = None,
    episode_rating_key: str | None = None,
) -> dict:
    """
    Composite New Season / New Episode banners onto Plex art (chosen or random)
    or solid placeholders. Writes preview/samples/{show,episode}.png + meta.json.
    """
    paths = _resolve_paths(config)
    samples = _samples_dir(paths)
    preset_id = str(config.get("overlayPresetId") or config.get("overlay_preset_id") or "new-season").strip() or "new-season"
    episode_preset = str(
        config.get("episodeOverlayPresetId") or config.get("episode_overlay_preset_id") or "new-episode"
    ).strip() or "new-episode"

    show_overlay = paths["overlay"]
    episode_overlay = paths["episodeOverlay"]
    if not _is_season_chip_preset(preset_id) and not show_overlay.exists():
        raise FileNotFoundError(f"New Season overlay asset not found: {show_overlay}")
    if not episode_overlay.exists():
        raise FileNotFoundError(f"New Episode overlay asset not found: {episode_overlay}")

    episode_banner = _load_episode_overlay_image(config, paths)

    show = None
    episode = None
    show_title = "Sample show"
    episode_title = "Sample episode"
    episode_show_title = ""
    show_source = "placeholder"
    episode_source = "placeholder"
    plex = None
    sample_season_index = 2

    try:
        plex = _connect(config)
        show_key = str(show_rating_key or "").strip()
        ep_key = str(episode_rating_key or "").strip()
        if show_key:
            _progress(progress, f"Loading chosen show {show_key}…")
            try:
                show = plex.fetchItem(f"/library/metadata/{show_key}")
            except Exception as exc:
                _progress(progress, f"Chosen show unavailable ({exc})")
                show = None
        if ep_key:
            try:
                episode = plex.fetchItem(f"/library/metadata/{ep_key}")
            except Exception as exc:
                _progress(progress, f"Chosen episode unavailable ({exc})")
                episode = None
        if show is None or episode is None:
            _progress(progress, "Picking random show poster and episode thumb…")
            rand_show, rand_ep = _pick_sample_items(plex, config, progress)
            if show is None:
                show = rand_show
            if episode is None:
                # Prefer an episode from the chosen show when possible.
                if show is not None and ep_key == "":
                    try:
                        eps = list(show.episodes()[:20] or [])
                        random.shuffle(eps)
                        for cand in eps:
                            if getattr(cand, "thumb", None):
                                episode = cand
                                break
                    except Exception:
                        pass
                if episode is None:
                    episode = rand_ep
    except Exception as exc:
        plex = None
        _progress(progress, f"Plex unavailable for samples ({exc}) — using placeholders")

    show_img = None
    if show is not None and plex is not None:
        show_title = getattr(show, "title", None) or show_title
        show_img = _item_poster_image(plex, show)
        if show_img is not None:
            show_source = "plex"

    if show_img is None:
        show_img = _placeholder_poster("show")
        _progress(progress, "Using placeholder show poster")

    if show is not None:
        try:
            latest = _latest_season(show)
            if latest is not None and getattr(latest, "index", None) is not None:
                sample_season_index = int(latest.index)
        except Exception:
            pass

    episode_img = None
    if episode is not None and plex is not None:
        episode_title = getattr(episode, "title", None) or episode_title
        try:
            parent = episode.show()
            episode_show_title = getattr(parent, "title", None) or ""
        except Exception:
            episode_show_title = getattr(episode, "grandparentTitle", None) or ""
        episode_img = _item_poster_image(plex, episode)
        if episode_img is not None:
            episode_source = "plex"

    if episode_img is None:
        episode_img = _placeholder_poster("episode")
        _progress(progress, "Using placeholder episode thumb")

    show_banner = _load_show_overlay_image(config, paths, season_index=sample_season_index)
    show_out = _apply_show_overlay(show_img.copy(), show_banner, config)
    episode_out = _apply_episode_overlay(episode_img.copy(), episode_banner, config)
    season_out = _apply_season_episode_overlay(show_img.copy(), show_banner, config)

    show_path = samples / "show.png"
    episode_path = samples / "episode.png"
    season_path = samples / "season.png"
    show_base_path = samples / "show-base.png"
    episode_base_path = samples / "episode-base.png"
    meta_path = samples / "meta.json"
    show_img.save(show_base_path)
    episode_img.save(episode_base_path)
    show_out.save(show_path)
    episode_out.save(episode_path)
    season_out.save(season_path)

    meta = {
        "showTitle": show_title,
        "episodeTitle": episode_title,
        "showTitleForEp": episode_show_title,
        "generatedAt": datetime.now().isoformat(),
        "presetId": preset_id,
        "episodePresetId": episode_preset,
        "showSource": show_source,
        "episodeSource": episode_source,
        "showRatingKey": str(getattr(show, "ratingKey", "") or "") or None,
        "episodeRatingKey": str(getattr(episode, "ratingKey", "") or "") or None,
        "placement": {
            "show": _placement_for(config, "show"),
            "season": _placement_for(config, "season"),
            "episode": _placement_for(config, "episode"),
        },
    }
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    _progress(progress, f"Samples ready — show: {show_title}; episode: {episode_show_title or ''} {episode_title}".strip())

    return {
        "ok": True,
        "show": {
            "title": show_title,
            "source": show_source,
            "ratingKey": meta["showRatingKey"],
            "path": str(show_path),
        },
        "episode": {
            "title": episode_title,
            "showTitle": episode_show_title,
            "source": episode_source,
            "ratingKey": meta["episodeRatingKey"],
            "path": str(episode_path),
        },
        "presetId": preset_id,
        "episodePresetId": episode_preset,
        "generatedAt": meta["generatedAt"],
        "paths": {
            "show": str(show_path),
            "episode": str(episode_path),
            "meta": str(meta_path),
            "dir": str(samples),
        },
        "meta": meta,
    }
