"""Extra overlay modes: Live schedule, Recently Added, Top 10."""

from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable

from PIL import Image, ImageDraw

ProgressFn = Callable[[str], None]


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


def _find_font(size: int):
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


def render_live_split(day_label: str) -> Image.Image:
    """Netflix-style Live | {Day} split pill."""
    left, right = "Live", str(day_label or "Today").strip() or "Today"
    h = 140
    pad = 18
    font = _find_font(int(h * 0.42))
    dummy = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    lb = dummy.textbbox((0, 0), left, font=font)
    rb = dummy.textbbox((0, 0), right, font=font)
    lw = max(lb[2] - lb[0] + pad * 2, int(h * 1.6))
    rw = max(rb[2] - rb[0] + pad * 2, int(h * 1.6))
    w = lw + rw
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    red = (229, 9, 20, 255)
    white = (255, 255, 255, 255)
    black = (20, 20, 20, 255)
    r = h // 2
    draw.rounded_rectangle([0, 0, w, h], radius=r, fill=white)
    draw.rounded_rectangle([0, 0, lw + r, h], radius=r, fill=red)
    draw.rectangle([lw, 0, lw + r, h], fill=red)
    draw.rectangle([lw, 0, w, h], fill=white)
    draw.pieslice([w - h, 0, w, h], 270, 90, fill=white)
    draw.rectangle([lw, 0, w - r, h], fill=white)
    ltb = draw.textbbox((0, 0), left, font=font)
    rtb = draw.textbbox((0, 0), right, font=font)
    draw.text(
        ((lw - (ltb[2] - ltb[0])) / 2 - ltb[0], (h - (ltb[3] - ltb[1])) / 2 - ltb[1]),
        left,
        font=font,
        fill=white,
    )
    draw.text(
        (lw + (rw - (rtb[2] - rtb[0])) / 2 - rtb[0], (h - (rtb[3] - rtb[1])) / 2 - rtb[1]),
        right,
        font=font,
        fill=black,
    )
    return img


def _weekday_label(dt: datetime) -> str:
    return dt.strftime("%A")


def _backup_mode_dir(paths: dict, mode: str, rating_key: str) -> Path:
    root = paths["backups"] / mode / str(rating_key)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _clear_mode_backup(paths: dict, mode: str, rating_key: str) -> None:
    folder = paths["backups"] / mode / str(rating_key)
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


def _stamp_show_badge(
    *,
    plex,
    show,
    badge: Image.Image,
    paths: dict,
    preview_mode: bool,
    progress: ProgressFn | None,
    mode: str,
    placement: dict,
    apply_fn=None,
    library: str = "",
    extra_meta: dict | None = None,
    config: dict | None = None,
) -> dict:
    """Stamp via clean-base layer stack (apply_fn kept for call-site compatibility)."""
    from core import _item_poster_image
    from layer_stack import apply_banner_layer, drop_conflicting_mode_logs

    poster = _item_poster_image(plex, show)
    if poster is None:
        raise RuntimeError(f"Failed to download poster for {getattr(show, 'title', '')}")

    entry = apply_banner_layer(
        plex=plex,
        show=show,
        paths=paths,
        mode=mode,
        badge=badge,
        placement=placement,
        preview_mode=preview_mode,
        progress=progress,
        library=library,
        extra_meta=extra_meta,
        current_poster=poster,
        config=config,
    )
    dropped = entry.get("droppedLayers") or []
    if dropped and not preview_mode:
        drop_conflicting_mode_logs(paths, str(show.ratingKey), list(dropped))
    return entry


def _restore_show_mode(
    show,
    paths: dict,
    mode: str,
    progress: ProgressFn | None,
    config: dict | None = None,
) -> bool:
    """Remove one banner layer and recompose, or legacy full-poster restore for other modes."""
    from layer_stack import LAYER_DEFS, normalize_mode, remove_banner_layer

    key = str(getattr(show, "ratingKey", "") or "")
    mode_n = normalize_mode(mode)
    if mode_n in LAYER_DEFS:
        return remove_banner_layer(
            show=show,
            paths=paths,
            mode=mode_n,
            preview_mode=False,
            progress=progress,
            config=config,
        )

    # Legacy Kometa-style / unused mode folders: upload mode-specific snapshot if present.
    backup = paths["backups"] / mode / key / "show.png"
    if not backup.exists():
        return False
    try:
        from core import _upload_poster_resilient

        _upload_poster_resilient(
            show,
            backup,
            progress=progress,
            title=getattr(show, "title", key),
        )
        _progress(progress, f"Restored {mode} backup: {getattr(show, 'title', key)}")
        _clear_mode_backup(paths, mode, key)
        return True
    except Exception as exc:
        _progress(progress, f"Restore {mode} failed for {key}: {exc}")
        return False


def _apply_with_explicit_placement(base_img: Image.Image, overlay_img: Image.Image, placement: dict) -> Image.Image:
    from core import _apply_with_placement
    return _apply_with_placement(base_img, overlay_img, placement)


BOTTOM_PLACEMENT = {
    "x": 0.5,
    "y": 1.0,
    "width": 0.72,
    "anchorX": "center",
    "anchorY": "bottom",
    "bottomClip": 0.10,
}


def _recently_placement(config: dict | None) -> dict:
    try:
        from core import _placement_for
        return _placement_for(config, "recently")
    except Exception:
        return dict(BOTTOM_PLACEMENT)


def _recently_badge_path(paths: dict, config: dict | None = None) -> Path:
    configured = paths.get("recentlyAddedOverlay")
    if configured and Path(configured).exists():
        return Path(configured)
    preset_id = str(
        (config or {}).get("recentlyAddedPresetId")
        or (config or {}).get("recently_added_preset_id")
        or "recently-added"
    ).strip() or "recently-added"
    custom = Path(paths.get("customPresets") or ".") / f"{preset_id}.png"
    if custom.exists():
        return custom
    assets = Path(paths.get("assets") or ".")
    for name in (f"{preset_id}.png", "recently-added.png", "new-season.png"):
        hit = assets / name
        if hit.exists():
            return hit
    return assets / "recently-added.png"

TOP10_PLACEMENT = {
    "x": 0.0,
    "y": 0.0,
    "width": 0.22,
    "maxHeight": 0.22,
    "anchorX": "left",
    "anchorY": "top",
    "bottomClip": 0.0,
}


def discover_live_shows(plex, config: dict, sections, progress: ProgressFn | None = None, resolver=None, paths: dict | None = None):
    """Shows whose latest episode aired within liveScheduleDays."""
    from core import _as_datetime, _kometa_overlay_label_blocks, _only_rating_keys, _fetch_plex_item, _library_title

    days = int(config.get("liveScheduleDays") or config.get("live_schedule_days") or 1)
    cutoff = datetime.now() - timedelta(days=max(0, days))
    skip_kometa = _as_bool(config.get("skipIfKometaOverlayLabel", config.get("skip_if_kometa_overlay_label")), True)
    only_keys = _only_rating_keys(config)
    should: dict[str, dict] = {}

    def _evaluate_show(show, library: str) -> None:
        key = str(getattr(show, "ratingKey", "") or "")
        if not key:
            return
        if skip_kometa and _kometa_overlay_label_blocks(show, paths=paths, rating_key=key):
            if only_keys:
                _progress(progress, f"{getattr(show, 'title', key)}: skipped (Overlay label)")
            return
        try:
            eps = list(show.episodes() or [])
        except Exception:
            return
        latest = None
        latest_dt = None
        undated_tail: list = []
        for ep in eps:
            aired = _as_datetime(getattr(ep, "originallyAvailableAt", None))
            if aired is None:
                undated_tail.append(ep)
                continue
            if latest_dt is None or aired > latest_dt:
                latest_dt = aired
                latest = ep
        if resolver is not None and getattr(resolver, "active", False) and undated_tail:
            undated_tail.sort(
                key=lambda ep: (
                    int(getattr(ep, "parentIndex", None) or getattr(ep, "seasonNumber", None) or 0),
                    int(getattr(ep, "index", None) or 0),
                ),
                reverse=True,
            )
            for ep in undated_tail[:8]:
                aired = resolver.resolve_episode_aired(ep, show)
                if aired is None:
                    continue
                if latest_dt is None or aired > latest_dt:
                    latest_dt = aired
                    latest = ep
        if latest_dt is None or latest_dt < cutoff:
            if only_keys:
                _progress(
                    progress,
                    f"{getattr(show, 'title', key)}: not eligible for Live — nothing stamped",
                )
            return
        should[key] = {
            "show": show,
            "library": library,
            "airedAt": latest_dt.isoformat(),
            "dayLabel": _weekday_label(latest_dt),
        }

    if only_keys:
        _progress(progress, f"Scoped Live check — {len(only_keys)} title(s)…")
        for key in sorted(only_keys):
            item = _fetch_plex_item(plex, key)
            if item is None:
                _progress(progress, f"Title {key}: not found — Live skipped")
                continue
            itype = str(getattr(item, "type", "") or "").lower()
            if itype != "show":
                _progress(progress, f"{getattr(item, 'title', key)}: not a TV show — Live skipped")
                continue
            _evaluate_show(item, _library_title(item))
        _progress(progress, f"Live schedule eligible (scoped): {len(should)}")
        return should

    for section in sections:
        try:
            for show in section.all():
                _evaluate_show(show, section.title)
        except Exception as exc:
            _progress(progress, f"Live scan failed for {getattr(section, 'title', '?')}: {exc}")
    _progress(progress, f"Live schedule eligible: {len(should)}")
    return should


def _prune_mode_when_disabled(
    plex,
    paths: dict,
    mode: str,
    log_path: Path,
    preview_mode: bool,
    progress: ProgressFn | None,
    config: dict | None = None,
) -> tuple[int, list[str], int]:
    """Restore/remove all tracked stamps for a mode when its toggle is off."""
    log = _load_log(log_path)
    if not log:
        return 0, [], 0
    _progress(progress, f"{mode} overlays disabled — pruning tracked stamps…")
    removed = 0
    errors: list[str] = []
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
                _clear_mode_backup(paths, mode, key)
                removed += 1
                continue
            _restore_show_mode(show, paths, mode, progress, config=config)
            del log[key]
            removed += 1
            _progress(progress, f"Removed {mode} overlay (disabled): {title}")
        except Exception as exc:
            errors.append(f"{mode} disable-remove {key}: {exc}")
    _save_log(log_path, log)
    return removed, errors, len(log)


def run_live_overlays(
    plex,
    config: dict,
    paths: dict,
    preview_mode: bool,
    progress: ProgressFn | None,
    reserved_keys: set[str] | None = None,
    resolver=None,
) -> dict:
    from core import _only_rating_keys

    log_path = paths["liveLog"]
    only_keys = _only_rating_keys(config)
    scoped_run = bool(only_keys)
    if not _as_bool(config.get("liveScheduleEnabled", config.get("live_schedule_enabled")), False):
        if scoped_run:
            _progress(progress, "Live overlays disabled — scoped pass leaves tracked stamps alone")
            return {
                "liveEnabled": False,
                "liveAdded": 0,
                "liveRemoved": 0,
                "liveTotal": 0,
                "liveErrors": [],
                "liveKeys": [],
            }
        removed, errors, total = _prune_mode_when_disabled(
            plex, paths, "live", log_path, preview_mode, progress, config=config
        )
        return {
            "liveEnabled": False,
            "liveAdded": 0,
            "liveRemoved": removed,
            "liveTotal": total,
            "liveErrors": errors,
            "liveKeys": [],
        }

    from core import _iter_tv_sections

    reserved = reserved_keys or set()
    log = _load_log(log_path)
    sections = list(_iter_tv_sections(plex, config, bundle="core"))
    candidates = discover_live_shows(plex, config, sections, progress, resolver=resolver, paths=paths)
    should = {k: v for k, v in candidates.items() if k not in reserved}

    added = removed = 0
    errors: list[str] = []
    for key, meta in sorted(should.items(), key=lambda kv: kv[0]):
        existing = log.get(key)
        try:
            if preview_mode:
                badge = render_live_split(meta["dayLabel"])
                entry = _stamp_show_badge(
                    plex=plex,
                    show=meta["show"],
                    badge=badge,
                    paths=paths,
                    preview_mode=True,
                    progress=progress,
                    mode="live",
                    placement=BOTTOM_PLACEMENT,
                    apply_fn=_apply_with_explicit_placement,
                    library=meta.get("library") or "",
                    extra_meta={"dayLabel": meta["dayLabel"], "airedAt": meta.get("airedAt")},
                    config=config,
                )
                if existing is None:
                    log[key] = entry
                    added += 1
                else:
                    log[key] = {**existing, **entry} if isinstance(existing, dict) else entry
                continue
            needs = existing is None or bool(existing.get("preview_only"))
            if not needs:
                continue
            badge = render_live_split(meta["dayLabel"])
            entry = _stamp_show_badge(
                plex=plex,
                show=meta["show"],
                badge=badge,
                paths=paths,
                preview_mode=False,
                progress=progress,
                mode="live",
                placement=BOTTOM_PLACEMENT,
                apply_fn=_apply_with_explicit_placement,
                library=meta.get("library") or "",
                extra_meta={"dayLabel": meta["dayLabel"], "airedAt": meta.get("airedAt")},
                    config=config,
                )
            log[key] = {**(existing or {}), **entry, "preview_only": False}
            added += 1
        except Exception as exc:
            errors.append(f"live {meta['show'].title}: {exc}")

    if not scoped_run:
        for key in list(log.keys()):
            if key in should:
                continue
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
                    _clear_mode_backup(paths, "live", key)
                    removed += 1
                    continue
                _restore_show_mode(show, paths, "live", progress, config=config)
                del log[key]
                removed += 1
                _progress(progress, f"Removed live overlay: {title}")
            except Exception as exc:
                errors.append(f"live remove {key}: {exc}")
    else:
        _progress(progress, "Scoped Live pass — prune of other titles skipped")

    _save_log(log_path, log)
    return {
        "liveEnabled": True,
        "liveAdded": added,
        "liveRemoved": removed,
        "liveTotal": len(log),
        "liveEligible": len(should),
        "liveErrors": errors,
        "liveKeys": list(should.keys()),
    }


def discover_recently_added(
    plex,
    config: dict,
    sections,
    progress: ProgressFn | None = None,
    resolver=None,
    paths: dict | None = None,
):
    from core import (
        _only_rating_keys,
        _fetch_plex_item,
        _library_title,
        premiere_show_eligible,
    )

    days = int(config.get("recentlyAddedDays") or config.get("recently_added_days") or 7)
    cutoff = datetime.now() - timedelta(days=max(1, days))
    skip_kometa = _as_bool(config.get("skipIfKometaOverlayLabel", config.get("skip_if_kometa_overlay_label")), True)
    only_keys = _only_rating_keys(config)
    should: dict[str, dict] = {}

    def _consider(show, library: str) -> None:
        key = str(getattr(show, "ratingKey", "") or "")
        if not key or key in should:
            return
        ok, meta = premiere_show_eligible(
            show,
            cutoff,
            skip_kometa=skip_kometa,
            resolver=resolver,
            paths=paths,
        )
        if not ok:
            if only_keys:
                reason = meta.get("reason") or "ineligible"
                _progress(
                    progress,
                    f"{getattr(show, 'title', key)}: not premiere Recently Added ({reason})",
                )
            return
        should[key] = {
            "show": show,
            "library": library,
            "addedAt": meta.get("addedAt"),
            "airedAt": meta.get("airedAt"),
        }

    if only_keys:
        _progress(progress, f"Scoped Recently Added check — {len(only_keys)} title(s)…")
        for key in sorted(only_keys):
            item = _fetch_plex_item(plex, key)
            if item is None:
                _progress(progress, f"Title {key}: not found — Recently Added skipped")
                continue
            show = item
            itype = str(getattr(item, "type", "") or getattr(item, "TYPE", "") or "").lower()
            try:
                if itype in {"episode", "season"} or hasattr(item, "show"):
                    show = item.show()
            except Exception:
                show = item
            if str(getattr(show, "type", "") or "").lower() != "show":
                _progress(progress, f"{getattr(show, 'title', key)}: not a TV show — Recently Added skipped")
                continue
            _consider(show, _library_title(show))
        _progress(progress, f"Recently Added eligible (scoped): {len(should)}")
        return should

    for section in sections:
        try:
            items = []
            try:
                items = list(section.recentlyAdded(maxresults=200) or [])
            except Exception:
                items = list(section.all() or [])
            for item in items:
                show = item
                itype = str(getattr(item, "type", "") or getattr(item, "TYPE", "") or "").lower()
                try:
                    if itype in {"episode", "season"} or hasattr(item, "show"):
                        show = item.show()
                except Exception:
                    show = item
                if str(getattr(show, "type", "") or "").lower() != "show":
                    continue
                _consider(show, section.title)
        except Exception as exc:
            _progress(progress, f"Recently Added scan failed for {getattr(section, 'title', '?')}: {exc}")
    _progress(progress, f"Recently Added eligible (premiere S1): {len(should)}")
    return should


def run_recently_added_overlays(
    plex,
    config: dict,
    paths: dict,
    preview_mode: bool,
    progress: ProgressFn | None,
    reserved_keys: set[str] | None = None,
) -> dict:
    from core import _only_rating_keys

    log_path = paths["recentlyAddedLog"]
    only_keys = _only_rating_keys(config)
    scoped_run = bool(only_keys)
    if not _as_bool(config.get("recentlyAddedEnabled", config.get("recently_added_enabled")), False):
        if scoped_run:
            _progress(progress, "Recently Added overlays disabled — scoped pass leaves tracked stamps alone")
            return {
                "recentlyAddedEnabled": False,
                "recentlyAdded": 0,
                "recentlyRemoved": 0,
                "recentlyTotal": 0,
                "recentlyErrors": [],
                "recentlyKeys": [],
            }
        removed, errors, total = _prune_mode_when_disabled(
            plex, paths, "recently", log_path, preview_mode, progress, config=config
        )
        return {
            "recentlyAddedEnabled": False,
            "recentlyAdded": 0,
            "recentlyRemoved": removed,
            "recentlyTotal": total,
            "recentlyErrors": errors,
            "recentlyKeys": [],
        }

    from core import _iter_tv_sections

    from tmdb_dates import create_resolver_from_config

    resolver = create_resolver_from_config(config, paths=paths, progress=progress)
    reserved = reserved_keys or set()
    log = _load_log(log_path)
    asset = _recently_badge_path(paths, config)
    if not asset.exists():
        resolver.save()
        return {"recentlyAddedEnabled": True, "recentlyAdded": 0, "recentlyRemoved": 0, "recentlyTotal": 0, "recentlyErrors": [f"missing overlay asset ({asset.name})"]}

    badge = Image.open(asset)
    placement = _recently_placement(config)
    sections = list(_iter_tv_sections(plex, config, bundle="recently"))
    if not sections and not scoped_run:
        _progress(progress, "No TV libraries in Recently Added scope (check the library selector on this card).")
    candidates = discover_recently_added(plex, config, sections, progress, resolver=resolver, paths=paths)
    should = {k: v for k, v in candidates.items() if k not in reserved}

    added = removed = 0
    errors: list[str] = []
    for key, meta in sorted(should.items(), key=lambda kv: kv[0]):
        existing = log.get(key)
        try:
            if preview_mode:
                entry = _stamp_show_badge(
                    plex=plex,
                    show=meta["show"],
                    badge=badge,
                    paths=paths,
                    preview_mode=True,
                    progress=progress,
                    mode="recently",
                    placement=placement,
                    apply_fn=_apply_with_explicit_placement,
                    library=meta.get("library") or "",
                    extra_meta={"addedAt": meta.get("addedAt"), "presetId": asset.stem},
                    config=config,
                )
                if existing is None:
                    log[key] = entry
                    added += 1
                else:
                    log[key] = {**existing, **entry} if isinstance(existing, dict) else entry
                continue
            needs = existing is None or bool(existing.get("preview_only"))
            if not needs:
                continue
            entry = _stamp_show_badge(
                plex=plex,
                show=meta["show"],
                badge=badge,
                paths=paths,
                preview_mode=False,
                progress=progress,
                mode="recently",
                placement=placement,
                apply_fn=_apply_with_explicit_placement,
                library=meta.get("library") or "",
                extra_meta={"addedAt": meta.get("addedAt"), "presetId": asset.stem},
                    config=config,
                )
            log[key] = {**(existing or {}), **entry, "preview_only": False}
            added += 1
        except Exception as exc:
            errors.append(f"recently {meta['show'].title}: {exc}")

    if not scoped_run:
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
                    _clear_mode_backup(paths, "recently", key)
                    removed += 1
                    continue
                _restore_show_mode(show, paths, "recently", progress, config=config)
                del log[key]
                removed += 1
            except Exception as exc:
                errors.append(f"recently remove {key}: {exc}")
    else:
        _progress(progress, "Scoped Recently Added pass — prune of other titles skipped")

    _save_log(log_path, log)
    resolver.save()
    return {
        "recentlyAddedEnabled": True,
        "recentlyAdded": added,
        "recentlyRemoved": removed,
        "recentlyTotal": len(log),
        "recentlyEligible": len(should),
        "recentlyErrors": errors,
        "recentlyKeys": list(should.keys()),
    }


def discover_top10(plex, config: dict, sections, progress: ProgressFn | None = None, paths: dict | None = None):
    from core import _kometa_overlay_label_blocks

    limit = int(config.get("top10Count") or config.get("top10_count") or 10)
    limit = max(1, min(50, limit))
    skip_kometa = _as_bool(config.get("skipIfKometaOverlayLabel", config.get("skip_if_kometa_overlay_label")), True)
    scored: list[tuple[float, str, Any, str]] = []
    for section in sections:
        try:
            for show in section.all():
                key = str(getattr(show, "ratingKey", "") or "")
                if not key:
                    continue
                if skip_kometa and _kometa_overlay_label_blocks(show, paths=paths, rating_key=key):
                    continue
                score = 0.0
                for attr in ("audienceRating", "rating", "userRating"):
                    val = getattr(show, attr, None)
                    try:
                        if val is not None:
                            score = max(score, float(val))
                    except (TypeError, ValueError):
                        pass
                # Prefer items with any rating; fall back to 0
                scored.append((score, key, show, section.title))
        except Exception as exc:
            _progress(progress, f"Top 10 scan failed for {getattr(section, 'title', '?')}: {exc}")
    scored.sort(key=lambda row: (-row[0], str(getattr(row[2], "title", "")).lower()))
    top = scored[:limit]
    should = {
        key: {"show": show, "library": library, "score": score, "rank": idx + 1}
        for idx, (score, key, show, library) in enumerate(top)
    }
    _progress(progress, f"Top {limit} eligible: {len(should)}")
    return should


def run_top10_overlays(plex, config: dict, paths: dict, preview_mode: bool, progress: ProgressFn | None) -> dict:
    from core import _only_rating_keys

    log_path = paths["top10Log"]
    only_keys = _only_rating_keys(config)
    scoped_run = bool(only_keys)
    if not _as_bool(config.get("top10Enabled", config.get("top10_enabled")), False):
        if scoped_run:
            _progress(progress, "Top 10 overlays disabled — scoped pass leaves tracked stamps alone")
            return {
                "top10Enabled": False,
                "top10Added": 0,
                "top10Removed": 0,
                "top10Total": 0,
                "top10Errors": [],
            }
        removed, errors, total = _prune_mode_when_disabled(
            plex, paths, "top10", log_path, preview_mode, progress, config=config
        )
        return {
            "top10Enabled": False,
            "top10Added": 0,
            "top10Removed": removed,
            "top10Total": total,
            "top10Errors": errors,
        }

    if scoped_run:
        # Ranking needs a full library scan — skip on single-title tests.
        _progress(progress, "Top 10 skipped on scoped title pass (needs full library ranking)")
        return {
            "top10Enabled": True,
            "top10Added": 0,
            "top10Removed": 0,
            "top10Total": 0,
            "top10Eligible": 0,
            "top10Errors": [],
        }

    from core import _iter_tv_sections

    log = _load_log(log_path)
    asset = paths["assets"] / "top-10.png"
    if not asset.exists():
        return {"top10Enabled": True, "top10Added": 0, "top10Removed": 0, "top10Total": 0, "top10Errors": ["missing top-10.png"]}

    badge = Image.open(asset)
    sections = list(_iter_tv_sections(plex, config, bundle="core"))
    should = discover_top10(plex, config, sections, progress, paths=paths)

    added = removed = 0
    errors: list[str] = []
    for key, meta in sorted(should.items(), key=lambda kv: kv[1].get("rank", 99)):
        existing = log.get(key)
        try:
            if preview_mode:
                entry = _stamp_show_badge(
                    plex=plex,
                    show=meta["show"],
                    badge=badge,
                    paths=paths,
                    preview_mode=True,
                    progress=progress,
                    mode="top10",
                    placement=TOP10_PLACEMENT,
                    apply_fn=_apply_with_explicit_placement,
                    library=meta.get("library") or "",
                    extra_meta={"rank": meta.get("rank"), "score": meta.get("score")},
                    config=config,
                )
                if existing is None:
                    log[key] = entry
                    added += 1
                else:
                    log[key] = {**existing, **entry} if isinstance(existing, dict) else entry
                continue
            needs = existing is None or bool(existing.get("preview_only"))
            if not needs:
                continue
            entry = _stamp_show_badge(
                plex=plex,
                show=meta["show"],
                badge=badge,
                paths=paths,
                preview_mode=False,
                progress=progress,
                mode="top10",
                placement=TOP10_PLACEMENT,
                apply_fn=_apply_with_explicit_placement,
                library=meta.get("library") or "",
                extra_meta={"rank": meta.get("rank"), "score": meta.get("score")},
                    config=config,
                )
            log[key] = {**(existing or {}), **entry, "preview_only": False}
            added += 1
        except Exception as exc:
            errors.append(f"top10 {meta['show'].title}: {exc}")

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
                _clear_mode_backup(paths, "top10", key)
                removed += 1
                continue
            _restore_show_mode(show, paths, "top10", progress, config=config)
            del log[key]
            removed += 1
        except Exception as exc:
            errors.append(f"top10 remove {key}: {exc}")

    _save_log(log_path, log)
    return {
        "top10Enabled": True,
        "top10Added": added,
        "top10Removed": removed,
        "top10Total": len(log),
        "top10Eligible": len(should),
        "top10Errors": errors,
    }
