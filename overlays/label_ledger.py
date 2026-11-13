"""Write-ahead ledger of the Plex labels the Overlays engine adds to each title.

The overlay logs are rewritten wholesale and can be lost or overwritten, and a label is added to Plex
before its log row is saved. This ledger records each label *before* it is added, one small file per
title, written atomically. Poster Sets reads it so it only ever strips labels Overlays itself applied.
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Iterable

LEDGER_DIRNAME = "label-ledger"
_root: Path | None = None


def set_root(data_dir) -> None:
    """Point the ledger at the Overlays data directory (called when paths are resolved)."""
    global _root
    try:
        _root = Path(data_dir)
    except Exception:
        _root = None


def _file(data_dir, rating_key) -> Path | None:
    base = Path(data_dir) if data_dir else _root
    key = str(rating_key or "").strip().replace("/", "_").replace("\\", "_")
    if base is None or not key:
        return None
    return base / LEDGER_DIRNAME / f"{key}.json"


def _read(data_dir, rating_key) -> dict:
    path = _file(data_dir, rating_key)
    if path is None or not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def read_labels(data_dir, rating_key) -> list[str]:
    labels = _read(data_dir, rating_key).get("labels")
    return [str(x).strip() for x in (labels or []) if str(x).strip()]


def read_thumb(data_dir, rating_key) -> str:
    return str(_read(data_dir, rating_key).get("thumb") or "").strip()


def record_thumb(rating_key, thumb: str, data_dir=None) -> bool:
    """Remember the poster URL Plex held right after Overlays uploaded its art."""
    try:
        path = _file(data_dir, rating_key)
        thumb = str(thumb or "").strip()
        if path is None or not thumb:
            return False
        data = _read(data_dir, rating_key)
        if data.get("thumb") == thumb:
            return True
        data["thumb"] = thumb
        data.setdefault("labels", [])
        _write(path, data)
        return True
    except Exception:
        return False


def poster_changed_since_stamp(item, data_dir=None) -> bool:
    """True when the title's poster is not the one Overlays last uploaded (someone replaced it)."""
    recorded = read_thumb(data_dir, item_key(item))
    current = str(getattr(item, "thumb", "") or "").strip()
    return bool(recorded and current and recorded != current)


def record_labels(rating_key, labels: Iterable[str], data_dir=None) -> bool:
    """Atomically add labels to the title's ledger. Never raises; returns False if it could not write."""
    try:
        path = _file(data_dir, rating_key)
        if path is None:
            return False
        data = _read(data_dir, rating_key)
        existing = [str(x).strip() for x in (data.get("labels") or []) if str(x).strip()]
        seen = {x.casefold() for x in existing}
        changed = False
        for label in labels:
            label = str(label or "").strip()
            if label and label.casefold() not in seen:
                seen.add(label.casefold())
                existing.append(label)
                changed = True
        if not changed and path.exists():
            return True
        data["labels"] = existing
        _write(path, data)
        return True
    except Exception:
        return False


def forget(rating_keys: Iterable[str], data_dir=None) -> int:
    n = 0
    for key in rating_keys:
        path = _file(data_dir, key)
        try:
            if path is not None and path.exists():
                path.unlink()
                n += 1
        except Exception:
            pass
    return n


def item_key(item) -> str:
    return str(getattr(item, "ratingKey", "") or "")
