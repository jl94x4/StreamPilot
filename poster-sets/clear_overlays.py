"""Clear Overlays stamps after Poster Sets replaces poster pixels.

Does not restore overlay backups — that would overwrite the newly applied art.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any, Callable, Iterable, Optional

ProgressFn = Optional[Callable[[str], None]]

OVERLAY_LOG_FILES = (
    "overlaid_log.json",
    "episode_overlaid_log.json",
    "recently_added_log.json",
    "live_log.json",
    "top10_log.json",
    "kometa_overlaid_log.json",
    "media_log.json",
    "status_log.json",
    "ratings_log.json",
    "network_log.json",
)

BACKUP_MODE_DIRS = ("live", "recently", "top10", "newseason", "kometa", "base")


def emit(progress: ProgressFn, message: str) -> None:
    if progress:
        progress(message)


def _overlays_app_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "overlays"


def _ensure_overlays_on_path() -> None:
    overlays = str(_overlays_app_dir())
    if overlays not in sys.path:
        sys.path.append(overlays)


def overlays_data_dir(config: Optional[dict] = None) -> Path:
    cfg = config if isinstance(config, dict) else {}
    raw = cfg.get("overlays_data_dir") or cfg.get("overlaysDataDir")
    if raw:
        return Path(str(raw)).expanduser().resolve()
    env = (
        os.environ.get("OVERLAYS_CONFIG_DIR")
        or os.environ.get("OVERLAYS_DIR")
        or ""
    ).strip()
    if env:
        return Path(env).expanduser().resolve()
    config_dir = (os.environ.get("CONFIG_DIR") or "").strip()
    if config_dir:
        return (Path(config_dir) / "overlays").resolve()
    return (Path.cwd() / "config" / "overlays").resolve()


def known_overlay_stamp_label_names() -> set[str]:
    _ensure_overlays_on_path()
    try:
        from kometa_detect import known_overlay_stamp_label_names as _names
        return {str(name).strip() for name in _names() if str(name).strip()}
    except Exception:
        return {"Overlay", "overlay", "4K", "4K-HDR", "HDR"}


def rating_key_for_item(item) -> str:
    return str(getattr(item, "ratingKey", None) or getattr(item, "rating_key", None) or "").strip()


def tracking_keys_for_item(item) -> list[str]:
    key = rating_key_for_item(item)
    if not key:
        return []
    keys = [key]
    item_type = str(getattr(item, "type", "") or "").lower()
    parent = str(
        getattr(item, "parentRatingKey", None)
        or getattr(item, "parent_rating_key", None)
        or ""
    ).strip()
    if item_type == "season" and parent:
        season_key = f"season:{parent}"
        if season_key not in keys:
            keys.append(season_key)
    return keys


def labels_from_kometa_entry(entry: Optional[dict]) -> list[str]:
    entry = entry if isinstance(entry, dict) else {}
    names: list[str] = []
    seen: set[str] = set()

    def _add(value: object) -> None:
        label = str(value or "").strip()
        if not label:
            return
        folded = label.casefold()
        if folded in seen:
            return
        seen.add(folded)
        names.append(label)

    stored = entry.get("overlayLabels")
    if isinstance(stored, list):
        for value in stored:
            _add(value)
    families = entry.get("families")
    if isinstance(families, dict):
        for meta in families.values():
            if not isinstance(meta, dict):
                continue
            _add(meta.get("name"))
            _add(meta.get("text"))
            extra = meta.get("extra")
            if isinstance(extra, dict):
                _add(extra.get("ruleId"))
    _add("Overlay")
    return names


def _load_json_object(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _save_json_object(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _rmtree(path: Path) -> None:
    if not path.exists():
        return
    try:
        if path.is_file():
            path.unlink()
            return
        shutil.rmtree(path, ignore_errors=True)
    except Exception:
        pass


def forget_overlay_tracking(data_dir: Path, rating_keys: Iterable[str]) -> dict[str, int]:
    """Drop overlay logs and backups for rating keys. Never restores posters."""
    root = Path(data_dir)
    keys = [str(key).strip() for key in rating_keys if str(key).strip()]
    if not keys:
        return {"logs": 0, "backups": 0}
    key_set = set(keys)
    logs_cleared = 0
    for name in OVERLAY_LOG_FILES:
        path = root / name
        data = _load_json_object(path)
        if not data:
            continue
        changed = False
        for key in keys:
            if key in data:
                del data[key]
                changed = True
                logs_cleared += 1
        if changed:
            _save_json_object(path, data)

    backups_cleared = 0
    backups = root / "backups"
    for key in keys:
        targets = [
            backups / "kometa" / key,
            backups / "base" / key,
            backups / "episodes" / key,
            backups / "seasons-episode" / key.replace("season:", "", 1),
            backups / key,
        ]
        for mode in BACKUP_MODE_DIRS:
            targets.append(backups / mode / key)
        for folder in targets:
            if folder.exists():
                _rmtree(folder)
                backups_cleared += 1
        # season:123 backups live under seasons-episode/123
        if key.startswith("season:"):
            show_key = key.split(":", 1)[-1]
            season_dir = backups / "seasons-episode" / show_key
            if season_dir.exists():
                _rmtree(season_dir)
                backups_cleared += 1
    return {"logs": logs_cleared, "backups": backups_cleared, "keys": list(key_set)}


def _label_tag(lab: Any) -> str:
    return str(getattr(lab, "tag", None) or lab or "").strip()


def clear_overlay_labels(item, extra_labels: Optional[Iterable[str]] = None, progress: ProgressFn = None) -> list[str]:
    known = known_overlay_stamp_label_names()
    extra = [str(name).strip() for name in (extra_labels or []) if str(name).strip()]
    want_keys = {name.casefold() for name in list(known) + extra if name}
    try:
        item.reload()
    except Exception:
        pass
    present = list(getattr(item, "labels", None) or [])
    to_remove: list = []
    removed: list[str] = []
    for lab in present:
        tag = _label_tag(lab)
        if tag and tag.casefold() in want_keys:
            to_remove.append(lab)
            if tag not in removed:
                removed.append(tag)
    if not to_remove:
        to_remove = ["Overlay", *extra]
        removed = [str(name) for name in to_remove if name]
    try:
        item.removeLabel(to_remove)
    except Exception:
        for lab in to_remove:
            try:
                item.removeLabel(_label_tag(lab) or lab)
            except Exception:
                pass
    if removed:
        emit(progress, f"Cleared overlay label(s): {', '.join(removed)}")
    return removed


def clear_overlays_after_poster_apply(item, config: Optional[dict] = None, progress: ProgressFn = None) -> None:
    """Forget every Overlays stamp after Poster Sets uploaded a clean poster."""
    if item is None:
        return
    keys = tracking_keys_for_item(item)
    data_dir = overlays_data_dir(config)
    extra: list[str] = []
    kometa_log = _load_json_object(data_dir / "kometa_overlaid_log.json")
    for key in keys:
        extra.extend(labels_from_kometa_entry(kometa_log.get(key)))
    try:
        clear_overlay_labels(item, extra_labels=extra, progress=progress)
    except Exception as exc:
        emit(progress, f"Overlay label clear skipped: {exc}")
    try:
        stats = forget_overlay_tracking(data_dir, keys)
        if stats.get("logs") or stats.get("backups"):
            emit(progress, "Forgot Overlays tracking for the new artwork.")
    except Exception as exc:
        emit(progress, f"Overlay tracking clear skipped: {exc}")
