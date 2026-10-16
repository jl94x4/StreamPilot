"""Banner overlay layer stack: one clean base + weighted layers + recompose.

Live / New Season / Recently / Top 10 no longer restore mode-specific full-poster
snapshots (which could resurrect or wipe sibling badges). Each show keeps a clean
base under backups/base/{ratingKey}/ and an active layer registry; any add/remove
recomposes from that base.
"""

from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from PIL import Image

ProgressFn = Callable[[str], None]

# Paint order = ascending weight. Bottom group is mutually exclusive (highest wins).
LAYER_DEFS: dict[str, dict[str, Any]] = {
    "live": {"weight": 300, "group": "bottom"},
    "newseason": {"weight": 200, "group": "bottom"},
    "recently": {"weight": 100, "group": "bottom"},
    "top10": {"weight": 50, "group": "corner"},
}

BOTTOM_GROUP = "bottom"
MODE_ALIASES = {
    "new-season": "newseason",
    "new_season": "newseason",
    "season": "newseason",
    "recently-added": "recently",
    "recently_added": "recently",
    "top-10": "top10",
    "top_10": "top10",
}


def _progress(progress: ProgressFn | None, message: str) -> None:
    if progress:
        progress(message)


def normalize_mode(mode: str) -> str:
    raw = str(mode or "").strip().lower()
    return MODE_ALIASES.get(raw, raw)


def layer_weight(mode: str) -> int:
    key = normalize_mode(mode)
    return int((LAYER_DEFS.get(key) or {}).get("weight") or 0)


def layer_group(mode: str) -> str:
    key = normalize_mode(mode)
    return str((LAYER_DEFS.get(key) or {}).get("group") or "other")


def base_dir(paths: dict, rating_key: str) -> Path:
    root = Path(paths["backups"]) / "base" / str(rating_key)
    root.mkdir(parents=True, exist_ok=True)
    return root


def base_poster_path(paths: dict, rating_key: str) -> Path:
    return base_dir(paths, rating_key) / "show.png"


def layers_meta_path(paths: dict, rating_key: str) -> Path:
    return base_dir(paths, rating_key) / "layers.json"


def layer_badge_path(paths: dict, rating_key: str, mode: str) -> Path:
    return base_dir(paths, rating_key) / "layers" / f"{normalize_mode(mode)}.png"


def load_registry(paths: dict, rating_key: str) -> dict:
    path = layers_meta_path(paths, rating_key)
    if not path.exists():
        return {"layers": {}, "updatedAt": None}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {"layers": {}, "updatedAt": None}
        layers = data.get("layers")
        if not isinstance(layers, dict):
            layers = {}
        return {"layers": layers, "updatedAt": data.get("updatedAt")}
    except Exception:
        return {"layers": {}, "updatedAt": None}


def save_registry(paths: dict, rating_key: str, registry: dict) -> None:
    path = layers_meta_path(paths, rating_key)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "layers": registry.get("layers") if isinstance(registry.get("layers"), dict) else {},
        "updatedAt": datetime.now().isoformat(),
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def active_layers(registry: dict) -> dict[str, dict]:
    layers = registry.get("layers") if isinstance(registry, dict) else {}
    return layers if isinstance(layers, dict) else {}


def _copy_if_exists(src: Path, dest: Path) -> bool:
    if not src.exists() or not src.is_file():
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    return True


def _legacy_candidate_bases(paths: dict, rating_key: str) -> list[Path]:
    """Prefer cleanest known backups. New Season / Live / Recently before Top 10."""
    key = str(rating_key)
    backups = Path(paths["backups"])
    return [
        backups / key / "show.png",  # New Season legacy
        backups / "live" / key / "show.png",
        backups / "recently" / key / "show.png",
        backups / "kometa" / key / "poster.png",
        backups / "top10" / key / "show.png",  # often already stacked — last resort
    ]


def _item_overlay_tags_present(show) -> bool:
    """Unknown item → treat tags as present so we never overwrite a trusted base."""
    if show is None:
        return True
    try:
        from core import _item_has_overlay_tracking_labels

        return _item_has_overlay_tracking_labels(show)
    except Exception:
        return True


def _save_base_poster(dest: Path, image: Image.Image, progress: ProgressFn | None, message: str) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGBA").save(dest)
    _progress(progress, message)
    return dest


def ensure_base_poster(
    paths: dict,
    rating_key: str,
    *,
    plex=None,
    show=None,
    current_poster: Image.Image | None = None,
    progress: ProgressFn | None = None,
) -> Path:
    """Ensure backups/base/{ratingKey}/show.png exists.

    Keep an existing base while Overlay / Layer stamp tags are still on the item.
    If those tags were removed, ignore leftover backups and adopt current Plex art.
    """
    dest = base_poster_path(paths, rating_key)
    tags_present = _item_overlay_tags_present(show)

    def _from_current() -> Path | None:
        if current_poster is not None:
            return _save_base_poster(
                dest,
                current_poster,
                progress,
                f"Saved clean base poster: {rating_key}",
            )
        if plex is not None and show is not None:
            from core import _item_poster_image

            poster = _item_poster_image(plex, show)
            if poster is None:
                return None
            return _save_base_poster(
                dest,
                poster,
                progress,
                f"Saved clean base poster: {getattr(show, 'title', rating_key)}",
            )
        return None

    if dest.exists() and tags_present:
        return dest

    if not tags_present:
        had_backup = dest.exists()
        saved = _from_current()
        if saved is not None:
            if had_backup:
                _progress(
                    progress,
                    f"Overlay labels gone — using current Plex poster (ignoring backup): {rating_key}",
                )
            return saved
        if dest.exists():
            return dest
        raise RuntimeError(
            f"Missing current Plex poster for {rating_key} after overlay labels were removed."
        )

    for candidate in _legacy_candidate_bases(paths, rating_key):
        if candidate.name == "poster.png":
            # Skip Kometa backup when it still carries the overlay EXIF marker.
            try:
                from kometa_render import has_overlay_marker
                if has_overlay_marker(candidate):
                    continue
            except Exception:
                pass
        if _copy_if_exists(candidate, dest):
            _progress(progress, f"Promoted clean base from {candidate.parent.name}: {rating_key}")
            return dest

    registry = load_registry(paths, rating_key)
    has_layers = bool(active_layers(registry))

    # Prefer a download only when no banner layers claim the poster is already stamped.
    if not has_layers:
        saved = _from_current()
        if saved is not None:
            return saved
        if plex is not None and show is not None:
            raise RuntimeError(f"Failed to download poster for base backup ({rating_key})")

    raise RuntimeError(
        f"Missing clean base poster for {rating_key}"
        + (" while banner layers are active" if has_layers else "")
        + ". Reset the show overlay or restore from Plex posters()."
    )

def _enforce_bottom_exclusivity(layers: dict[str, dict], incoming: str) -> list[str]:
    """Keep only the highest-weight bottom layer. Returns dropped mode ids."""
    incoming = normalize_mode(incoming)
    if layer_group(incoming) != BOTTOM_GROUP:
        return []
    incoming_w = layer_weight(incoming)
    dropped: list[str] = []
    for mode in list(layers.keys()):
        if mode == incoming:
            continue
        if layer_group(mode) != BOTTOM_GROUP:
            continue
        if layer_weight(mode) <= incoming_w:
            dropped.append(mode)
            layers.pop(mode, None)
        else:
            # Existing bottom layer outranks incoming — drop incoming instead.
            dropped.append(incoming)
            layers.pop(incoming, None)
    return dropped


def set_layer(
    paths: dict,
    rating_key: str,
    mode: str,
    *,
    badge: Image.Image,
    placement: dict,
    meta: dict | None = None,
    progress: ProgressFn | None = None,
) -> list[str]:
    """Register/replace a layer and save its badge PNG. Returns dropped bottom modes."""
    mode = normalize_mode(mode)
    if mode not in LAYER_DEFS:
        raise ValueError(f"Unknown banner layer mode: {mode}")

    registry = load_registry(paths, rating_key)
    layers = dict(active_layers(registry))

    badge_dir = base_dir(paths, rating_key) / "layers"
    badge_dir.mkdir(parents=True, exist_ok=True)
    badge_path = layer_badge_path(paths, rating_key, mode)
    badge.convert("RGBA").save(badge_path)

    layers[mode] = {
        "weight": layer_weight(mode),
        "group": layer_group(mode),
        "placement": dict(placement or {}),
        "meta": dict(meta or {}),
        "badgeFile": f"layers/{mode}.png",
        "updatedAt": datetime.now().isoformat(),
    }
    dropped = _enforce_bottom_exclusivity(layers, mode)
    for dropped_mode in dropped:
        if dropped_mode == mode:
            continue
        try:
            layer_badge_path(paths, rating_key, dropped_mode).unlink(missing_ok=True)
        except Exception:
            pass
        _progress(progress, f"Dropped lower bottom layer {dropped_mode} for {rating_key}")

    registry["layers"] = layers
    save_registry(paths, rating_key, registry)
    return [m for m in dropped if m != mode]


def clear_layer(
    paths: dict,
    rating_key: str,
    mode: str,
    *,
    progress: ProgressFn | None = None,
) -> bool:
    """Remove a layer from the registry. Returns True if it was present."""
    mode = normalize_mode(mode)
    registry = load_registry(paths, rating_key)
    layers = dict(active_layers(registry))
    if mode not in layers:
        try:
            layer_badge_path(paths, rating_key, mode).unlink(missing_ok=True)
        except Exception:
            pass
        return False
    layers.pop(mode, None)
    try:
        layer_badge_path(paths, rating_key, mode).unlink(missing_ok=True)
    except Exception:
        pass
    registry["layers"] = layers
    save_registry(paths, rating_key, registry)
    _progress(progress, f"Cleared layer {mode} for {rating_key}")
    return True


def clear_all_layers(paths: dict, rating_key: str) -> None:
    registry = load_registry(paths, rating_key)
    for mode in list(active_layers(registry).keys()):
        try:
            layer_badge_path(paths, rating_key, mode).unlink(missing_ok=True)
        except Exception:
            pass
    save_registry(paths, rating_key, {"layers": {}})
    layers_dir = base_dir(paths, rating_key) / "layers"
    if layers_dir.exists():
        try:
            next(layers_dir.iterdir())
        except StopIteration:
            try:
                layers_dir.rmdir()
            except Exception:
                pass


def compose_from_registry(paths: dict, rating_key: str) -> Image.Image:
    """Paint active layers onto the clean base (ascending weight)."""
    from core import _apply_with_placement

    base_path = base_poster_path(paths, rating_key)
    if not base_path.exists():
        raise RuntimeError(f"No base poster for {rating_key}")
    result = Image.open(base_path).convert("RGBA")
    registry = load_registry(paths, rating_key)
    layers = active_layers(registry)
    ordered = sorted(
        layers.items(),
        key=lambda kv: (int(kv[1].get("weight") or layer_weight(kv[0])), kv[0]),
    )
    for mode, info in ordered:
        badge_path = layer_badge_path(paths, rating_key, mode)
        if not badge_path.exists():
            continue
        badge = Image.open(badge_path).convert("RGBA")
        placement = info.get("placement") if isinstance(info.get("placement"), dict) else {}
        result = _apply_with_placement(result, badge, placement)
    return result


def upload_composed(
    show,
    paths: dict,
    rating_key: str,
    *,
    preview_mode: bool,
    progress: ProgressFn | None,
    title: str = "",
    config: dict | None = None,
) -> dict:
    """Compose current registry and upload (or write preview)."""
    from core import _sanitize_filename, _sync_banner_overlay_label

    composed = compose_from_registry(paths, rating_key)
    label = title or getattr(show, "title", None) or rating_key
    safe = _sanitize_filename(f"{label}_stack")
    layers = active_layers(load_registry(paths, rating_key))
    entry = {
        "hasBase": base_poster_path(paths, rating_key).exists(),
        "activeLayers": sorted(layers.keys(), key=lambda m: -layer_weight(m)),
        "layerCount": len(layers),
    }
    if preview_mode:
        out = Path(paths["preview"]) / f"{safe}.png"
        composed.save(out)
        entry["previewShow"] = str(out)
        _progress(progress, f"[Preview] stack ({','.join(entry['activeLayers']) or 'base'}): {label}")
        return entry

    temp = Path(paths["preview"]) / f"temp_{safe}.png"
    composed.save(temp)
    try:
        from core import _upload_poster_resilient

        _upload_poster_resilient(show, temp, progress=progress, title=label)
        _progress(
            progress,
            f"Uploaded stack ({','.join(entry['activeLayers']) or 'clean'}): {label}",
        )
        _sync_banner_overlay_label(
            show,
            paths=paths,
            rating_key=str(rating_key),
            has_overlays=bool(layers),
            config=config,
            progress=progress,
        )
        entry["labeled"] = bool(layers)
    finally:
        if temp.exists():
            temp.unlink()
    return entry


def apply_banner_layer(
    *,
    plex,
    show,
    paths: dict,
    mode: str,
    badge: Image.Image,
    placement: dict,
    preview_mode: bool,
    progress: ProgressFn | None = None,
    library: str = "",
    extra_meta: dict | None = None,
    current_poster: Image.Image | None = None,
    config: dict | None = None,
) -> dict:
    """Ensure base, set layer, recompose. Primary stamp entry for banner modes."""
    from core import _library_title

    mode = normalize_mode(mode)
    key = str(getattr(show, "ratingKey", "") or "")
    if not key:
        raise RuntimeError("Show ratingKey is required")

    if not preview_mode:
        try:
            hydrate_layers_from_logs(paths, key, config=config, progress=progress, show=show)
        except Exception as exc:
            _progress(progress, f"Hydrate before apply skipped: {exc}")

    ensure_base_poster(
        paths,
        key,
        plex=plex,
        show=show,
        current_poster=current_poster,
        progress=progress,
    )
    dropped = set_layer(
        paths,
        key,
        mode,
        badge=badge,
        placement=placement,
        meta=extra_meta,
        progress=progress,
    )
    stack = upload_composed(
        show,
        paths,
        key,
        preview_mode=preview_mode,
        progress=progress,
        title=getattr(show, "title", key),
        config=config,
    )
    now = datetime.now()
    return {
        "title": getattr(show, "title", key),
        "timestamp": now.isoformat(),
        "preview_only": bool(preview_mode),
        "mode": mode,
        "library": (library or _library_title(show) or "").strip(),
        "hasBackup": base_poster_path(paths, key).exists(),
        "hasBase": True,
        "droppedLayers": dropped,
        **stack,
        **(extra_meta or {}),
    }


def hydrate_layers_from_logs(
    paths: dict,
    rating_key: str,
    *,
    config: dict | None = None,
    progress: ProgressFn | None = None,
    show=None,
) -> None:
    """Seed registry layers from mode logs when upgrading from full-poster backups.

    Rebuilds badge PNGs from assets / log meta so a remove of one mode can
    recompose siblings that were stamped before the layer stack existed.
    """
    key = str(rating_key)
    registry = load_registry(paths, rating_key)
    layers = active_layers(registry)
    config = config if isinstance(config, dict) else {}

    def _log(path_key: str) -> dict:
        path = paths.get(path_key)
        if not path:
            return {}
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    # Ensure base exists before seeding so later recompose works.
    try:
        if not base_poster_path(paths, key).exists():
            for candidate in _legacy_candidate_bases(paths, key):
                if candidate.name == "poster.png":
                    try:
                        from kometa_render import has_overlay_marker
                        if has_overlay_marker(candidate):
                            continue
                    except Exception:
                        pass
                if _copy_if_exists(candidate, base_poster_path(paths, key)):
                    _progress(progress, f"Hydrate: promoted base for {key}")
                    break
    except Exception:
        pass

    # Live
    live_entry = _log("liveLog").get(key)
    if isinstance(live_entry, dict) and not live_entry.get("preview_only") and "live" not in layers:
        try:
            from modes_extra import render_live_split, BOTTOM_PLACEMENT
            day = str(live_entry.get("dayLabel") or "Today")
            badge = render_live_split(day)
            set_layer(
                paths, key, "live",
                badge=badge,
                placement=dict(BOTTOM_PLACEMENT),
                meta={"dayLabel": day, "airedAt": live_entry.get("airedAt")},
            )
            _progress(progress, f"Hydrate: seeded live layer for {key}")
        except Exception as exc:
            _progress(progress, f"Hydrate live failed for {key}: {exc}")

    # New Season
    season_entry = _log("log").get(key)
    if isinstance(season_entry, dict) and not season_entry.get("preview_only") and "newseason" not in layers:
        seed_newseason = True
        if show is not None:
            try:
                from core import _is_returning_season, _latest_season

                latest = _latest_season(show)
                if latest is None or not _is_returning_season(latest, show):
                    seed_newseason = False
            except Exception:
                seed_newseason = False
        else:
            logged_idx = season_entry.get("seasonIndex")
            try:
                if logged_idx is not None and int(logged_idx) < 2:
                    seed_newseason = False
            except (TypeError, ValueError):
                pass
        if seed_newseason:
            try:
                from core import _load_show_overlay_image, _effective_placement
                overlay = _load_show_overlay_image(
                    config, paths, season_index=season_entry.get("seasonIndex")
                )
                preset = str(season_entry.get("presetId") or config.get("overlayPresetId") or "new-season")
                placement = _effective_placement(config, "show", preset)
                set_layer(
                    paths, key, "newseason",
                    badge=overlay,
                    placement=placement,
                    meta={"seasonIndex": season_entry.get("seasonIndex"), "presetId": preset},
                )
                _progress(progress, f"Hydrate: seeded newseason layer for {key}")
            except Exception as exc:
                _progress(progress, f"Hydrate newseason failed for {key}: {exc}")

    # Recently
    recently_entry = _log("recentlyAddedLog").get(key)
    if isinstance(recently_entry, dict) and not recently_entry.get("preview_only") and "recently" not in layers:
        try:
            from modes_extra import _recently_badge_path, _recently_placement
            asset = _recently_badge_path(paths, config)
            if asset.exists():
                badge = Image.open(asset)
                set_layer(
                    paths, key, "recently",
                    badge=badge,
                    placement=_recently_placement(config),
                    meta={"addedAt": recently_entry.get("addedAt")},
                )
                _progress(progress, f"Hydrate: seeded recently layer for {key}")
        except Exception as exc:
            _progress(progress, f"Hydrate recently failed for {key}: {exc}")

    # Top 10
    top_entry = _log("top10Log").get(key)
    if isinstance(top_entry, dict) and not top_entry.get("preview_only") and "top10" not in layers:
        try:
            from modes_extra import TOP10_PLACEMENT
            asset = Path(paths.get("assets") or ".") / "top-10.png"
            if asset.exists():
                badge = Image.open(asset)
                set_layer(
                    paths, key, "top10",
                    badge=badge,
                    placement=dict(TOP10_PLACEMENT),
                    meta={"rank": top_entry.get("rank"), "score": top_entry.get("score")},
                )
                _progress(progress, f"Hydrate: seeded top10 layer for {key}")
        except Exception as exc:
            _progress(progress, f"Hydrate top10 failed for {key}: {exc}")


def remove_banner_layer(
    *,
    show,
    paths: dict,
    mode: str,
    preview_mode: bool,
    progress: ProgressFn | None = None,
    config: dict | None = None,
) -> bool:
    """Clear one layer and recompose remaining (or restore clean base)."""
    mode = normalize_mode(mode)
    key = str(getattr(show, "ratingKey", "") or "")
    if not key:
        return False
    if preview_mode:
        _progress(progress, f"[Preview] Would remove layer {mode}: {getattr(show, 'title', key)}")
        return True

    # Upgrade path: reconstruct sibling layers from logs before clearing this one.
    try:
        hydrate_layers_from_logs(paths, key, config=config, progress=progress)
    except Exception as exc:
        _progress(progress, f"Hydrate before remove skipped: {exc}")

    had = clear_layer(paths, key, mode, progress=progress)
    _clear_legacy_mode_backup(paths, mode, key)

    layers = active_layers(load_registry(paths, key))
    base = base_poster_path(paths, key)

    from core import _item_has_overlay_tracking_labels, _sync_banner_overlay_label, _upload_poster_resilient

    if not _item_has_overlay_tracking_labels(show):
        _progress(
            progress,
            f"Overlay labels gone — leaving current Plex poster (not restoring backup): {getattr(show, 'title', key)}",
        )
        return True

    if layers:
        if not base.exists():
            ensure_base_poster(paths, key, show=show, progress=progress)
        upload_composed(
            show,
            paths,
            key,
            preview_mode=False,
            progress=progress,
            title=getattr(show, "title", key),
            config=config,
        )
        return True

    if base.exists():
        try:
            _upload_poster_resilient(
                show,
                base,
                progress=progress,
                title=getattr(show, "title", key),
            )
            _progress(progress, f"Restored clean base: {getattr(show, 'title', key)}")
            _sync_banner_overlay_label(
                show,
                paths=paths,
                rating_key=key,
                has_overlays=False,
                config=config,
                progress=progress,
            )
            return True
        except Exception as exc:
            _progress(progress, f"Base restore failed for {key}: {exc}")
            return False

    if mode == "newseason":
        legacy_file = Path(paths["backups"]) / key / "show.png"
    else:
        legacy_file = Path(paths["backups"]) / mode / key / "show.png"
    if legacy_file.exists():
        try:
            _upload_poster_resilient(
                show,
                legacy_file,
                progress=progress,
                title=getattr(show, "title", key),
            )
            _progress(progress, f"Restored legacy {mode} backup: {getattr(show, 'title', key)}")
            _sync_banner_overlay_label(
                show,
                paths=paths,
                rating_key=key,
                has_overlays=False,
                config=config,
                progress=progress,
            )
            return True
        except Exception as exc:
            _progress(progress, f"Legacy restore failed for {key}: {exc}")
    return had


def restore_clean_base(
    show,
    paths: dict,
    rating_key: str,
    *,
    progress: ProgressFn | None = None,
    clear_layers: bool = True,
    config: dict | None = None,
) -> bool:
    """Upload clean base and optionally wipe the layer registry (reset paths)."""
    from core import _sync_banner_overlay_label, _upload_poster_resilient

    key = str(rating_key)
    if clear_layers:
        clear_all_layers(paths, key)
    base = base_poster_path(paths, key)
    if not base.exists():
        # Promote legacy New Season backup if present.
        legacy = Path(paths["backups"]) / key / "show.png"
        if legacy.exists():
            _copy_if_exists(legacy, base)
    if base.exists():
        try:
            _upload_poster_resilient(
                show,
                base,
                progress=progress,
                title=getattr(show, "title", key),
            )
            _progress(progress, f"Restored clean base: {getattr(show, 'title', key)}")
            _sync_banner_overlay_label(
                show,
                paths=paths,
                rating_key=key,
                has_overlays=False,
                config=config,
                progress=progress,
            )
            return True
        except Exception as exc:
            _progress(progress, f"Clean base restore failed for {key}: {exc}")
            return False
    return False


def _clear_legacy_mode_backup(paths: dict, mode: str, rating_key: str) -> None:
    mode = normalize_mode(mode)
    key = str(rating_key)
    if mode == "newseason":
        folder = Path(paths["backups"]) / key
        # Only clear show.png if no season.png leftover needed? Keep folder; remove show.png
        # used as dirty risk. Actually New Season folder is the clean original — promote already
        # copied to base; clearing show.png would lose fallback. Leave legacy New Season alone.
        return
    folder = Path(paths["backups"]) / mode / key
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


def seed_layer_badge_if_needed(
    paths: dict,
    rating_key: str,
    mode: str,
    *,
    badge: Image.Image,
    placement: dict,
    meta: dict | None = None,
) -> None:
    """If a mode is logged as active but missing from registry, register its badge without upload."""
    mode = normalize_mode(mode)
    registry = load_registry(paths, rating_key)
    if mode in active_layers(registry):
        badge_path = layer_badge_path(paths, rating_key, mode)
        if badge_path.exists():
            return
    set_layer(paths, rating_key, mode, badge=badge, placement=placement, meta=meta)


def drop_conflicting_mode_logs(paths: dict, rating_key: str, dropped_modes: list[str]) -> None:
    """When bottom exclusivity drops a layer, remove it from that mode's overlay log."""
    if not dropped_modes:
        return
    key = str(rating_key)
    mapping = {
        "live": "liveLog",
        "recently": "recentlyAddedLog",
        "top10": "top10Log",
        "newseason": "log",
    }
    for mode in dropped_modes:
        mode = normalize_mode(mode)
        path_key = mapping.get(mode)
        if not path_key or path_key not in paths:
            continue
        log_path = Path(paths[path_key])
        try:
            data = json.loads(log_path.read_text(encoding="utf-8")) if log_path.exists() else {}
        except Exception:
            data = {}
        if not isinstance(data, dict) or key not in data:
            continue
        del data[key]
        try:
            log_path.parent.mkdir(parents=True, exist_ok=True)
            log_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        except Exception:
            pass
