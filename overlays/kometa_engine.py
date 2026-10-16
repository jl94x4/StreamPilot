"""Kometa-parity overlay engine.

One pass per item: detect every enabled family's winning variant (exact Kometa
ladders in kometa_detect), composite ALL winners onto the original poster in a
single pass (kometa_render), stamp with Kometa's EXIF marker, and track
everything in one unified log (kometa_overlaid_log.json) with one true-original
backup per item — movies included — enabling per-item and bulk revert.
"""

from __future__ import annotations

import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from PIL import Image

from kometa_detect import KometaDetector, Winner
from kometa_render import compose_poster, has_overlay_marker, save_with_marker

ProgressFn = Callable[[str], None]

LEGACY_MODES = ("media", "status", "ratings", "network")

# family -> config-scope mode (sections / allow / deny keys)
FAMILY_SCOPE = {
    "resolution": "media",
    "edition": "media",
    "audio_codec": "media",
    "video_format": "media",
    "aspect": "media",
    "versions": "media",
    "language_count": "media",
    "languages": "media",
    "runtimes": "media",
    "direct_play": "media",
    "episode_info": "media",
    "content_rating": "media",
    "status": "status",
    "ratings": "ratings",
    "network": "network",
    "streaming": "streaming",
    "ribbon": "ribbon",
    "mediastinger": "media",
    "custom_collection": "custom_collection",
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


def _cfg(config: dict, camel: str, snake: str, default=None):
    if config.get(camel) is not None:
        return config.get(camel)
    if config.get(snake) is not None:
        return config.get(snake)
    return default


def _load_log(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_log(path: Path, log: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(log, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _discover_kometa_backup_keys(paths: dict) -> list[str]:
    """ratingKeys that have a Layer poster backup on disk (even if the log never flushed)."""
    root = Path(paths["backups"]) / "kometa"
    if not root.is_dir():
        return []
    keys: list[str] = []
    try:
        for child in root.iterdir():
            if not child.is_dir():
                continue
            if (child / "poster.png").is_file():
                key = str(child.name or "").strip()
                if key:
                    keys.append(key)
    except Exception:
        return keys
    return keys


def kometa_log_path(paths: dict) -> Path:
    explicit = paths.get("kometaLog")
    if explicit:
        return Path(explicit)
    return Path(paths["root"]) / "kometa_overlaid_log.json"


def _backup_dir(paths: dict, rating_key: str) -> Path:
    return Path(paths["backups"]) / "kometa" / str(rating_key)


def _backup_file(paths: dict, rating_key: str) -> Path:
    return _backup_dir(paths, rating_key) / "poster.png"


def _clear_backup(paths: dict, rating_key: str) -> bool:
    """Remove backups/kometa/{ratingKey}/. Returns True when the folder is gone."""
    import shutil
    import time

    folder = _backup_dir(paths, rating_key)
    if not folder.exists():
        return True
    for _ in range(4):
        try:
            shutil.rmtree(folder)
        except Exception:
            # Fallback: unlink children (older Windows locks / partial trees).
            try:
                for child in list(folder.iterdir()):
                    try:
                        if child.is_dir():
                            shutil.rmtree(child, ignore_errors=True)
                        else:
                            child.unlink(missing_ok=True)
                    except Exception:
                        pass
                folder.rmdir()
            except Exception:
                pass
        if not folder.exists():
            return True
        time.sleep(0.15)
    return not folder.exists()


def enabled_families(config: dict, scope: str | None = None) -> list[str]:
    """Return enabled Layer families, optionally scoped to media or collections."""
    families: list[str] = []
    want = str(scope or config.get("kometaScope") or config.get("kometa_scope") or "all").strip().lower()
    if want in {"media", "layer", "kometa-media"}:
        want = "media"
    elif want in {"collections", "collection", "custom_collection", "custom-collections"}:
        want = "collections"
    else:
        want = "all"

    if want in {"all", "media"}:
        if _as_bool(_cfg(config, "mediaInfoEnabled", "media_info_enabled"), False):
            families.append("resolution")
        if _as_bool(_cfg(config, "editionOverlayEnabled", "edition_overlay_enabled"), False):
            families.append("edition")
        if _as_bool(_cfg(config, "audioCodecEnabled", "audio_codec_enabled"), False):
            families.append("audio_codec")
        if _as_bool(_cfg(config, "videoFormatEnabled", "video_format_enabled"), False):
            families.append("video_format")
        if _as_bool(_cfg(config, "aspectOverlayEnabled", "aspect_overlay_enabled"), False):
            families.append("aspect")
        if _as_bool(_cfg(config, "versionsOverlayEnabled", "versions_overlay_enabled"), False):
            families.append("versions")
        if _as_bool(_cfg(config, "languageCountEnabled", "language_count_enabled"), False):
            families.append("language_count")
        if _as_bool(_cfg(config, "languagesOverlayEnabled", "languages_overlay_enabled"), False):
            families.append("languages")
        if _as_bool(_cfg(config, "runtimesOverlayEnabled", "runtimes_overlay_enabled"), False):
            families.append("runtimes")
        if _as_bool(_cfg(config, "directPlayOverlayEnabled", "direct_play_overlay_enabled"), False):
            families.append("direct_play")
        if _as_bool(_cfg(config, "episodeInfoOverlayEnabled", "episode_info_overlay_enabled"), False):
            families.append("episode_info")
        if _as_bool(_cfg(config, "contentRatingEnabled", "content_rating_enabled"), False):
            families.append("content_rating")
        if _as_bool(_cfg(config, "statusOverlayEnabled", "status_overlay_enabled"), False):
            families.append("status")
        if _as_bool(_cfg(config, "ratingsOverlayEnabled", "ratings_overlay_enabled"), False):
            families.append("ratings")
        if _as_bool(_cfg(config, "networkOverlayEnabled", "network_overlay_enabled"), False):
            families.append("network")
        if _as_bool(_cfg(config, "streamingOverlayEnabled", "streaming_overlay_enabled"), False):
            families.append("streaming")
        if _as_bool(_cfg(config, "ribbonOverlayEnabled", "ribbon_overlay_enabled"), False):
            families.append("ribbon")
        if _as_bool(_cfg(config, "mediastingerOverlayEnabled", "mediastinger_overlay_enabled"), False):
            families.append("mediastinger")

    if want in {"all", "collections"}:
        if _as_bool(_cfg(config, "customCollectionOverlaysEnabled", "custom_collection_overlays_enabled"), False):
            rules = _cfg(config, "customCollectionOverlays", "custom_collection_overlays", []) or []
            if isinstance(rules, list) and any(
                (
                    (
                        isinstance((r or {}).get("collectionRatingKeys") or (r or {}).get("collection_rating_keys"), list)
                        and any(str(k or "").strip() for k in ((r or {}).get("collectionRatingKeys") or (r or {}).get("collection_rating_keys") or []))
                    )
                    or str((r or {}).get("collectionRatingKey") or (r or {}).get("collection_rating_key") or "").strip()
                )
                and str((r or {}).get("image") or "").strip()
                and (
                    str((r or {}).get("library") or (r or {}).get("libraryTitle") or "").strip()
                    or (
                        isinstance((r or {}).get("libraries") or (r or {}).get("libraryTitles"), list)
                        and any(
                            str(lib or "").strip()
                            for lib in ((r or {}).get("libraries") or (r or {}).get("libraryTitles") or [])
                        )
                    )
                )
                for r in rules
                if isinstance(r, dict)
            ):
                families.append("custom_collection")
    return families


def winner_from_log(family: str, meta: dict | None) -> Winner | None:
    """Rehydrate a Winner from a tracked log entry so scoped runs keep other badges."""
    if not isinstance(meta, dict):
        return None
    name = str(meta.get("name") or "").strip()
    if not name and family != "custom_collection":
        return None
    return Winner(
        family=str(family),
        name=name or str(family),
        key=str(meta.get("key") or meta.get("extra", {}).get("ruleId") or name or family),
        alt=str(meta.get("alt") or ""),
        weight=int(meta.get("weight") or 0),
        text=(str(meta["text"]) if meta.get("text") is not None else None),
        image_rel=(str(meta["image"]) if meta.get("image") else None),
        extra=meta.get("extra") if isinstance(meta.get("extra"), dict) else None,
    )


def _rule_collection_keys(row: dict) -> list[str]:
    keys: list[str] = []
    seen: set[str] = set()
    raw_list = row.get("collectionRatingKeys") or row.get("collection_rating_keys")
    if isinstance(raw_list, list):
        for item in raw_list:
            key = str(item or "").strip()
            if not key or key in seen:
                continue
            seen.add(key)
            keys.append(key)
    singular = str(row.get("collectionRatingKey") or row.get("collection_rating_key") or "").strip()
    if singular and singular not in seen:
        keys.insert(0, singular)
    return keys


def _rule_libraries(row: dict) -> list[str]:
    libs: list[str] = []
    seen: set[str] = set()
    raw_list = row.get("libraries") or row.get("libraryTitles") or row.get("library_titles")
    if isinstance(raw_list, list):
        for item in raw_list:
            lib = str(item or "").strip()
            if not lib:
                continue
            key = lib.casefold()
            if key in seen:
                continue
            seen.add(key)
            libs.append(lib)
    singular = str(
        row.get("library") or row.get("libraryTitle") or row.get("library_title") or ""
    ).strip()
    if singular and singular.casefold() not in seen:
        libs.insert(0, singular)
    return libs


def _rule_library_section_ids(row: dict) -> list[str]:
    ids: list[str] = []
    seen: set[str] = set()
    raw_list = row.get("librarySectionIds") or row.get("library_section_ids")
    if isinstance(raw_list, list):
        for item in raw_list:
            sid = str(item or "").strip()
            if not sid or sid in seen:
                continue
            seen.add(sid)
            ids.append(sid)
    singular = str(
        row.get("librarySectionId")
        or row.get("library_section_id")
        or row.get("sectionId")
        or row.get("section_id")
        or ""
    ).strip()
    if singular and singular not in seen:
        ids.insert(0, singular)
    return ids


def _only_collection_rating_keys(config: dict) -> set[str]:
    raw = config.get("onlyCollectionRatingKeys") or config.get("only_collection_rating_keys") or []
    if isinstance(raw, str):
        raw = [x.strip() for x in raw.split(",") if x.strip()]
    if not isinstance(raw, list):
        return set()
    return {str(k or "").strip() for k in raw if str(k or "").strip()}


def _only_rating_keys(config: dict) -> set[str]:
    raw = config.get("onlyRatingKeys") or config.get("only_rating_keys") or []
    if isinstance(raw, str):
        raw = [x.strip() for x in raw.split(",") if x.strip()]
    if not isinstance(raw, list):
        return set()
    return {str(k or "").strip() for k in raw if str(k or "").strip()}


def _stamp_source_collection_key(cc_meta: dict) -> str:
    """Which Plex collection ratingKey this stamp belongs to (targeted prune/skip)."""
    if not isinstance(cc_meta, dict):
        return ""
    extra = cc_meta.get("extra") if isinstance(cc_meta.get("extra"), dict) else {}
    source = str(extra.get("sourceCollectionRatingKey") or "").strip()
    if source:
        return source
    keys = []
    singular = str(extra.get("collectionRatingKey") or "").strip()
    if singular:
        keys.append(singular)
    raw_list = extra.get("collectionRatingKeys")
    if isinstance(raw_list, list):
        for item in raw_list:
            key = str(item or "").strip()
            if key and key not in keys:
                keys.append(key)
    # Legacy stamps stored every collection on a multi-collection rule. Those are
    # ambiguous for targeted prune — return empty so we leave them alone.
    if len(keys) == 1:
        return keys[0]
    return ""


def _custom_collection_rules(config: dict, *, respect_only_keys: bool = True) -> list[dict]:
    raw = _cfg(config, "customCollectionOverlays", "custom_collection_overlays", []) or []
    if not isinstance(raw, list):
        return []
    only_keys = _only_collection_rating_keys(config) if respect_only_keys else set()
    out: list[dict] = []
    seen: set[str] = set()
    for row in raw:
        if not isinstance(row, dict):
            continue
        collection_keys = _rule_collection_keys(row)
        if only_keys:
            collection_keys = [k for k in collection_keys if k in only_keys]
            if not collection_keys:
                continue
        image = str(row.get("image") or row.get("presetId") or row.get("preset_id") or "").strip()
        libraries = _rule_libraries(row)
        # At least one library is required — never stamp without an explicit Plex library scope.
        if not collection_keys or not image or not libraries:
            continue
        collection_key = collection_keys[0]
        rule_id = str(row.get("id") or "").strip() or f"rule-{collection_key}"
        if rule_id in seen:
            continue
        seen.add(rule_id)
        titles_raw = row.get("collectionTitles") or row.get("collection_titles") or {}
        collection_titles: dict[str, str] = {}
        if isinstance(titles_raw, dict):
            for k, v in titles_raw.items():
                key = str(k or "").strip()
                title = str(v or "").strip()
                if key and title:
                    collection_titles[key] = title
        singular_title = str(row.get("collectionTitle") or row.get("collection_title") or "").strip()
        if collection_key and singular_title and collection_key not in collection_titles:
            collection_titles[collection_key] = singular_title
        section_ids = _rule_library_section_ids(row)
        out.append({
            "id": rule_id,
            "name": str(row.get("name") or row.get("title") or "").strip() or rule_id,
            "collectionRatingKey": collection_key,
            "collectionRatingKeys": collection_keys,
            "collectionTitle": collection_titles.get(collection_key) or singular_title,
            "collectionTitles": collection_titles,
            "library": libraries[0],
            "libraries": libraries,
            "librarySectionId": section_ids[0] if section_ids else "",
            "librarySectionIds": section_ids,
            "image": image,
        })
    return out


def _item_library_title(item) -> str:
    for attr in ("librarySectionTitle", "sectionTitle"):
        try:
            value = getattr(item, attr, None)
            if value:
                return str(value).strip()
        except Exception:
            continue
    try:
        section = item.section() if callable(getattr(item, "section", None)) else None
        if section is not None and getattr(section, "title", None):
            return str(section.title).strip()
    except Exception:
        pass
    return ""


def _item_library_section_id(item) -> str:
    for attr in ("librarySectionID", "librarySectionId", "sectionId"):
        try:
            value = getattr(item, attr, None)
            if value is not None and str(value).strip() != "":
                return str(value).strip()
        except Exception:
            continue
    try:
        section = item.section() if callable(getattr(item, "section", None)) else None
        if section is not None:
            key = getattr(section, "key", None) or getattr(section, "ratingKey", None)
            if key is not None:
                return str(key).rstrip("/").split("/")[-1]
    except Exception:
        pass
    return ""


def _normalize_library_label(value: str) -> str:
    """Compare library titles ignoring emoji/punctuation (🎬 Movies 🍿 == Movies)."""
    text = str(value or "").casefold()
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    return " ".join(text.split())


def _library_labels_match(actual: str, expected: str) -> bool:
    a = _normalize_library_label(actual)
    b = _normalize_library_label(expected)
    return bool(a and b and a == b)


def _library_matches(item_or_coll, expected_library: str, *, expected_section_id: str = "") -> bool:
    expected_id = str(expected_section_id or "").strip()
    if expected_id:
        actual_id = _item_library_section_id(item_or_coll)
        if actual_id and actual_id == expected_id:
            return True
    expected = str(expected_library or "").strip()
    if not expected:
        return False
    actual = _item_library_title(item_or_coll)
    return _library_labels_match(actual, expected)


def _library_in_allowed(
    item_or_coll,
    libraries: list[str],
    *,
    library_section_ids: list[str] | None = None,
) -> bool:
    """True when item/collection belongs to any allowed library title or section id."""
    section_ids = [str(s or "").strip() for s in (library_section_ids or []) if str(s or "").strip()]
    if section_ids:
        actual_id = _item_library_section_id(item_or_coll)
        if actual_id and actual_id in section_ids:
            return True
    for expected in libraries or []:
        if _library_matches(item_or_coll, expected):
            return True
    return False


def _libraries_compatible(actual: str, expected: str, *, actual_id: str = "", expected_id: str = "") -> bool:
    """True when child belongs to the rule library (empty actual = unknown → allow)."""
    if expected_id and actual_id and expected_id == actual_id:
        return True
    if not actual or not str(actual).strip():
        return True  # partial Plex children often omit librarySectionTitle
    if not expected or not str(expected).strip():
        return False
    return _library_labels_match(actual, expected)


def _libraries_compatible_multi(
    actual: str,
    libraries: list[str],
    *,
    actual_id: str = "",
    expected_ids: list[str] | None = None,
) -> bool:
    """True when child belongs to any allowed library (empty actual = unknown → allow)."""
    ids = [str(s or "").strip() for s in (expected_ids or []) if str(s or "").strip()]
    if actual_id and ids and actual_id in ids:
        return True
    if not actual or not str(actual).strip():
        return True
    for expected in libraries or []:
        if _libraries_compatible(actual, expected, actual_id=actual_id):
            return True
    return False


def _iter_collection_children(coll, *, page_size: int = 100):
    """Yield every child of a Plex collection.

    Prefer coll.items() — plexapi already paginates fetchItems to completion.
    Manual container_start loops double-fetch and can confuse smart collections.
    """
    try:
        items = coll.items()
        if items is not None:
            yield from items
            return
    except Exception:
        pass
    key = getattr(coll, "key", None)
    if not key:
        return
    children_key = f"{key}/children" if not str(key).rstrip("/").endswith("/children") else str(key)
    start = 0
    size = max(20, int(page_size or 100))
    while True:
        try:
            batch = coll.fetchItems(children_key, container_start=start, container_size=size, maxresults=size)
        except TypeError:
            try:
                batch = coll.fetchItems(children_key)
            except Exception:
                return
            for item in batch or []:
                yield item
            return
        except Exception:
            return
        if not batch:
            break
        for item in batch:
            yield item
        if len(batch) < size:
            break
        start += size


def _collection_member_target_key(item) -> str | None:
    """Map a collection child to the show/movie ratingKey we stamp."""
    itype = str(getattr(item, "type", "") or "").lower()
    rk = str(getattr(item, "ratingKey", "") or "").strip()
    if not rk:
        return None
    if itype == "episode":
        show_rk = str(
            getattr(item, "grandparentRatingKey", None)
            or getattr(item, "showRatingKey", None)
            or "",
        ).strip()
        return show_rk or None
    if itype == "season":
        parent = str(getattr(item, "parentRatingKey", "") or "").strip()
        return parent or rk
    return rk


def _resolve_collection_member_keys(
    plex,
    collection_rating_key: str,
    *,
    libraries: list[str] | None = None,
    library_section_ids: list[str] | None = None,
    library: str = "",
    library_section_id: str = "",
    progress: ProgressFn | None = None,
) -> set[str]:
    key = str(collection_rating_key or "").strip()
    allowed_libs = [str(lib or "").strip() for lib in (libraries or []) if str(lib or "").strip()]
    if not allowed_libs and str(library or "").strip():
        allowed_libs = [str(library).strip()]
    allowed_sids = [
        str(sid or "").strip()
        for sid in (library_section_ids or [])
        if str(sid or "").strip()
    ]
    if not allowed_sids and str(library_section_id or "").strip():
        allowed_sids = [str(library_section_id).strip()]
    if not key or not allowed_libs:
        return set()
    try:
        coll = plex.fetchItem(int(key))
    except Exception as exc:
        _progress(progress, f"Collection {key}: fetch failed ({exc})")
        return set()
    if not _library_in_allowed(coll, allowed_libs, library_section_ids=allowed_sids):
        actual = _item_library_title(coll) or "?"
        expected_label = ", ".join(allowed_libs)
        _progress(
            progress,
            f"Collection {key}: skipped — library mismatch "
            f"(expected one of [{expected_label}], got '{actual}')",
        )
        return set()
    # Scope child filtering to the collection's own library (already validated).
    expected_library = _item_library_title(coll) or allowed_libs[0]
    expected_section_id = _item_library_section_id(coll) or (allowed_sids[0] if allowed_sids else "")
    members: set[str] = set()
    skipped_mismatch = 0
    skipped_empty = 0
    child_count_hint = None
    for attr in ("childCount", "collectionSize", "size"):
        try:
            raw = getattr(coll, attr, None)
            if raw is not None and str(raw).strip() != "":
                child_count_hint = int(raw)
                break
        except Exception:
            continue
    try:
        for item in _iter_collection_children(coll):
            rk = _collection_member_target_key(item)
            if not rk:
                skipped_empty += 1
                continue
            # coll.items()/children often omit librarySectionTitle on partial objects.
            # The collection itself is already library-scoped — only exclude when the
            # child reports a clearly different library (emoji/punctuation-normalized).
            actual = _item_library_title(item)
            actual_id = _item_library_section_id(item)
            if not _libraries_compatible(
                actual,
                expected_library,
                actual_id=actual_id,
                expected_id=expected_section_id,
            ):
                skipped_mismatch += 1
                continue
            members.add(rk)
    except Exception as exc:
        _progress(progress, f"Collection {key}: items() failed ({exc})")
        return set()
    if child_count_hint is not None and child_count_hint > len(members):
        _progress(
            progress,
            f"Collection {key}: Plex childCount={child_count_hint} but resolved {len(members)} "
            f"stampable member(s) — some children may be seasons/episodes or filtered",
        )
    if skipped_mismatch or skipped_empty:
        _progress(
            progress,
            f"Collection {key}: resolved {len(members)} member(s) "
            f"(skipped empty={skipped_empty}, other-library={skipped_mismatch})",
        )
    return members


def _fetch_plex_item(plex, rating_key: str):
    key = str(rating_key or "").strip()
    if not key:
        return None
    try:
        return plex.fetchItem(int(key))
    except Exception:
        try:
            return plex.fetchItem(key)
        except Exception:
            try:
                return plex.fetchItem(f"/library/metadata/{key}")
            except Exception:
                return None


def _item_collection_candidates(item) -> list:
    """Raw collection tag objects attached to a Plex title."""
    if item is None:
        return []
    try:
        if hasattr(item, "reload") and callable(item.reload):
            item.reload()
    except Exception:
        pass
    candidates = []
    for attr in ("collections", "Collection"):
        try:
            raw = getattr(item, attr, None)
            if callable(raw):
                raw = raw()
            if raw:
                candidates.extend(list(raw))
        except Exception:
            continue
    # plexapi XML fallback — Collection nodes sometimes carry ratingKey.
    try:
        data = getattr(item, "_data", None)
        if data is not None and hasattr(data, "findall"):
            for elem in list(data.findall("Collection") or []):
                candidates.append(elem)
    except Exception:
        pass
    return candidates


def _item_collection_rating_keys(item) -> set[str]:
    """Collection ratingKeys attached to a title (when Plex exposes them)."""
    keys: set[str] = set()
    for coll in _item_collection_candidates(item):
        rk = ""
        if hasattr(coll, "attrib") and isinstance(getattr(coll, "attrib", None), dict):
            rk = str(coll.attrib.get("ratingKey") or coll.attrib.get("id") or "").strip()
        else:
            rk = str(
                getattr(coll, "ratingKey", None)
                or getattr(coll, "key", None)
                or (coll.get("ratingKey") if isinstance(coll, dict) else None)
                or "",
            ).strip()
            if rk.startswith("/library/metadata/"):
                rk = rk.rsplit("/", 1)[-1]
        if rk and rk.isdigit():
            keys.add(rk)
    return keys


def _item_collection_titles(item) -> set[str]:
    """Lowercased collection titles/tags on a title (reliable reverse membership)."""
    titles: set[str] = set()
    for coll in _item_collection_candidates(item):
        tag = ""
        if hasattr(coll, "attrib") and isinstance(getattr(coll, "attrib", None), dict):
            tag = str(coll.attrib.get("tag") or coll.attrib.get("title") or "").strip()
        else:
            tag = str(
                getattr(coll, "tag", None)
                or getattr(coll, "title", None)
                or (coll.get("tag") if isinstance(coll, dict) else None)
                or (coll.get("title") if isinstance(coll, dict) else None)
                or "",
            ).strip()
        if tag:
            titles.add(tag.casefold())
    return titles


def _expand_membership_keys(plex, rating_keys: set[str]) -> set[str]:
    """Include related show/season keys so collection child filters match the picked title."""
    expanded = {str(k or "").strip() for k in (rating_keys or set()) if str(k or "").strip()}
    for key in list(expanded):
        item = _fetch_plex_item(plex, key)
        if item is None:
            continue
        rk = str(getattr(item, "ratingKey", "") or "").strip()
        if rk:
            expanded.add(rk)
        stamp = _collection_member_target_key(item)
        if stamp:
            expanded.add(stamp)
        itype = str(getattr(item, "type", "") or "").lower()
        if itype == "episode":
            show_rk = str(
                getattr(item, "grandparentRatingKey", None)
                or getattr(item, "showRatingKey", None)
                or "",
            ).strip()
            if show_rk:
                expanded.add(show_rk)
        elif itype == "season":
            parent = str(getattr(item, "parentRatingKey", "") or "").strip()
            if parent:
                expanded.add(parent)
        elif itype == "show":
            try:
                for season in list(item.seasons() or [])[:40]:
                    sk = str(getattr(season, "ratingKey", "") or "").strip()
                    if sk:
                        expanded.add(sk)
            except Exception:
                pass
    return expanded


def _scoped_collection_member_keys(
    plex,
    collection_rating_key: str,
    title_keys: set[str],
    *,
    libraries: list[str] | None = None,
    library_section_ids: list[str] | None = None,
    collection_title_hint: str = "",
    progress: ProgressFn | None = None,
) -> set[str]:
    """Membership for a single-title stamp: reverse tags first, then intersect full resolve."""
    title_keys = {str(k or "").strip() for k in (title_keys or set()) if str(k or "").strip()}
    if not title_keys:
        return set()
    expanded = _expand_membership_keys(plex, title_keys)
    coll = _fetch_plex_item(plex, collection_rating_key)
    coll_rk = str(getattr(coll, "ratingKey", "") or collection_rating_key or "").strip()
    coll_title = str(
        collection_title_hint
        or (getattr(coll, "title", None) if coll is not None else None)
        or "",
    ).strip()
    coll_title_cf = coll_title.casefold() if coll_title else ""

    allowed_libs = [str(lib or "").strip() for lib in (libraries or []) if str(lib or "").strip()]
    allowed_sids = [
        str(sid or "").strip()
        for sid in (library_section_ids or [])
        if str(sid or "").strip()
    ]
    if coll is not None and allowed_libs:
        if not _library_in_allowed(coll, allowed_libs, library_section_ids=allowed_sids):
            return set()

    matched: set[str] = set()
    for tk in sorted(title_keys):
        item = _fetch_plex_item(plex, tk)
        if item is None:
            continue
        stamp = _collection_member_target_key(item) or str(getattr(item, "ratingKey", "") or "").strip()
        if not stamp:
            continue
        check_items = [item]
        if stamp != str(getattr(item, "ratingKey", "") or "").strip():
            show_item = _fetch_plex_item(plex, stamp)
            if show_item is not None:
                check_items.append(show_item)
        for check in check_items:
            tag_keys = _item_collection_rating_keys(check)
            tag_titles = _item_collection_titles(check)
            if (coll_rk and coll_rk in tag_keys) or (coll_title_cf and coll_title_cf in tag_titles):
                matched.add(stamp)
                break

    if matched:
        return matched

    # Scan children until the scoped title is found (avoids empty intersect from
    # season/episode key mismatch and short-circuits huge smart collections).
    if coll is not None:
        try:
            for child in _iter_collection_children(coll):
                child_rk = str(getattr(child, "ratingKey", "") or "").strip()
                stamp = _collection_member_target_key(child)
                if (child_rk and child_rk in expanded) or (stamp and stamp in expanded):
                    hit = stamp or child_rk
                    if hit:
                        return {hit}
        except Exception as exc:
            _progress(progress, f"Collection {collection_rating_key}: scoped scan failed ({exc})")

    # Fallback: full resolve + intersect expanded keys (show↔season↔episode).
    part = _resolve_collection_member_keys(
        plex,
        collection_rating_key,
        libraries=libraries,
        library_section_ids=library_section_ids,
        progress=progress,
    )
    return {k for k in part if k in expanded}


def _resolve_custom_preset_path(paths: dict, image_id: str) -> Path | None:
    name = str(image_id or "").strip()
    if not name:
        return None
    if name.lower().endswith(".png"):
        candidate = Path(name)
        if candidate.is_file():
            return candidate
        name = name[:-4]
    custom_dir = Path(paths.get("customPresets") or "")
    hit = custom_dir / f"{name}.png"
    if hit.is_file():
        return hit
    assets = Path(paths.get("assets") or "")
    bundled = assets / f"{name}.png"
    if bundled.is_file():
        return bundled
    return None


def _apply_custom_collection_winners(
    plex,
    config: dict,
    paths: dict,
    should: dict[str, dict],
    *,
    progress: ProgressFn | None = None,
    errors: list[str] | None = None,
    only_rating_keys: set[str] | None = None,
) -> dict[str, set[str]]:
    """Inject custom_collection winners from live Plex membership.

    First matching rule wins — a title gets at most one collection badge even if it
    belongs to several configured collections.

    Returns rule_id -> set of member ratingKeys discovered in Plex.
    """
    rules = _custom_collection_rules(config)
    rule_members: dict[str, set[str]] = {}
    if not rules:
        return rule_members
    title_filter = {str(k or "").strip() for k in (only_rating_keys or set()) if str(k or "").strip()}
    # ratingKey -> first matching (rule, image_path, source_collection_key)
    member_rule: dict[str, tuple[dict, Path, str]] = {}
    claimed_elsewhere: dict[str, int] = {rule["id"]: 0 for rule in rules}
    for rule in rules:
        libraries = [str(lib or "").strip() for lib in (rule.get("libraries") or []) if str(lib or "").strip()]
        if not libraries and rule.get("library"):
            libraries = [str(rule.get("library") or "").strip()]
        if not libraries:
            msg = f"custom_collection {rule['id']}: library is required — skipped"
            if errors is not None:
                errors.append(msg)
            _progress(progress, msg)
            continue
        section_ids = [
            str(sid or "").strip()
            for sid in (rule.get("librarySectionIds") or [])
            if str(sid or "").strip()
        ]
        if not section_ids and rule.get("librarySectionId"):
            section_ids = [str(rule.get("librarySectionId") or "").strip()]
        collection_keys = [
            str(k or "").strip()
            for k in (rule.get("collectionRatingKeys") or [rule.get("collectionRatingKey")])
            if str(k or "").strip()
        ]
        if not collection_keys:
            continue
        members: set[str] = set()
        member_source: dict[str, str] = {}
        lib_label = ", ".join(libraries)
        titles_map = rule.get("collectionTitles") if isinstance(rule.get("collectionTitles"), dict) else {}
        for collection_key in collection_keys:
            title_hint = ""
            if titles_map:
                title_hint = str(titles_map.get(collection_key) or "").strip()
            if not title_hint and collection_key == rule.get("collectionRatingKey"):
                title_hint = str(rule.get("collectionTitle") or "").strip()
            if title_filter:
                part = _scoped_collection_member_keys(
                    plex,
                    collection_key,
                    title_filter,
                    libraries=libraries,
                    library_section_ids=section_ids,
                    collection_title_hint=title_hint,
                    progress=progress,
                )
            else:
                part = _resolve_collection_member_keys(
                    plex,
                    collection_key,
                    libraries=libraries,
                    library_section_ids=section_ids,
                    progress=progress,
                )
            members.update(part)
            for rk in part:
                if rk not in member_source:
                    member_source[rk] = collection_key
            label = title_hint or collection_key
            _progress(
                progress,
                f"Collection '{label}' [{lib_label}]: {len(part)} member(s)"
                + (" (scoped)" if title_filter else ""),
            )
        rule_members[rule["id"]] = set(members)
        _progress(
            progress,
            f"Collection badge '{rule.get('name') or rule['id']}' [{lib_label}]: "
            f"{len(members)} unique member(s) across {len(collection_keys)} collection(s)",
        )
        image_path = _resolve_custom_preset_path(paths, rule["image"])
        if image_path is None:
            msg = f"custom_collection {rule['id']}: image not found ({rule['image']})"
            if errors is not None:
                errors.append(msg)
            _progress(progress, msg)
            continue
        for rk in members:
            if rk in member_rule:
                claimed_elsewhere[rule["id"]] = claimed_elsewhere.get(rule["id"], 0) + 1
                continue
            member_rule[rk] = (rule, image_path, member_source.get(rk) or collection_keys[0])

    if title_filter:
        stamped_keys = set(member_rule.keys())
        for key in sorted(title_filter):
            # Match picked season/episode against show-level stamp keys.
            related = _expand_membership_keys(plex, {key})
            if stamped_keys & related:
                continue
            item = _fetch_plex_item(plex, key)
            label = getattr(item, "title", None) if item is not None else key
            on_title = sorted(_item_collection_titles(item)) if item is not None else []
            on_hint = f" (on title: {', '.join(on_title[:8])})" if on_title else " (no Plex collections on title)"
            _progress(
                progress,
                f"{label}: not a member of any enabled collection overlay rule — nothing stamped{on_hint}",
            )
    queued_by_rule: dict[str, int] = {rule["id"]: 0 for rule in rules}
    dropped = 0
    for rk, (rule, image_path, source_collection_key) in member_rule.items():
        row = should.get(rk)
        item = row.get("item") if row else None
        if item is None:
            item = _fetch_plex_item(plex, rk)
            if item is None:
                msg = f"custom_collection fetch failed for ratingKey={rk}"
                if errors is not None:
                    errors.append(msg)
                _progress(progress, msg)
                dropped += 1
                continue
        item_type = str(getattr(item, "type", "") or "").lower()
        if item_type == "episode":
            _progress(progress, f"Collection badge skip {rk}: episode art is not stamped")
            dropped += 1
            continue
        if item_type == "season":
            show_rk = _collection_member_target_key(item)
            if show_rk and show_rk != rk:
                show_item = _fetch_plex_item(plex, show_rk)
                if show_item is not None:
                    # Show may already be claimed under its ratingKey.
                    if show_rk in member_rule and member_rule[show_rk][0]["id"] != rule["id"]:
                        claimed_elsewhere[rule["id"]] = claimed_elsewhere.get(rule["id"], 0) + 1
                        continue
                    # Keep the source collection key when remapping season → show.
                    if show_rk not in member_rule:
                        member_rule[show_rk] = (rule, image_path, source_collection_key)
                    rk = show_rk
                    item = show_item
                    item_type = str(getattr(item, "type", "") or "").lower()
                    row = should.get(rk)
        actual_lib = _item_library_title(item)
        actual_id = _item_library_section_id(item)
        libraries = [str(lib or "").strip() for lib in (rule.get("libraries") or []) if str(lib or "").strip()]
        if not libraries and rule.get("library"):
            libraries = [str(rule.get("library") or "").strip()]
        section_ids = [
            str(sid or "").strip()
            for sid in (rule.get("librarySectionIds") or [])
            if str(sid or "").strip()
        ]
        if not section_ids and rule.get("librarySectionId"):
            section_ids = [str(rule.get("librarySectionId") or "").strip()]
        if not _libraries_compatible_multi(
            actual_lib,
            libraries,
            actual_id=actual_id,
            expected_ids=section_ids,
        ):
            title = getattr(item, "title", None) or rk
            msg = (
                f"Collection badge skip '{title}': library "
                f"'{actual_lib or '?'}' not in [{', '.join(libraries)}]"
            )
            if errors is not None:
                errors.append(msg)
            _progress(progress, msg)
            dropped += 1
            continue

        source_key = str(source_collection_key or rule.get("collectionRatingKey") or "").strip()
        titles_map = rule.get("collectionTitles") if isinstance(rule.get("collectionTitles"), dict) else {}
        source_title = ""
        if titles_map and source_key:
            source_title = str(titles_map.get(source_key) or "").strip()
        if not source_title and source_key == rule.get("collectionRatingKey"):
            source_title = str(rule.get("collectionTitle") or "").strip()

        winner = Winner(
            family="custom_collection",
            name=str(rule["id"]),
            key=str(rule["image"]),
            text=str(rule.get("name") or rule["id"]),
            image_rel=str(image_path),
            weight=int(rule.get("weight") or 50),
            extra={
                "ruleId": rule["id"],
                "collectionRatingKey": source_key or rule["collectionRatingKey"],
                "collectionRatingKeys": [source_key] if source_key else list(rule.get("collectionRatingKeys") or []),
                "sourceCollectionRatingKey": source_key,
                "collectionTitle": source_title or rule.get("collectionTitle") or "",
                "collectionTitles": rule.get("collectionTitles") or {},
                "library": rule.get("library") or "",
                "libraries": list(libraries),
            },
        )
        if row is None:
            library = actual_lib or (libraries[0] if libraries else "")
            row = {
                "item": item,
                "library": library,
                "itemType": item_type,
                "winners": {},
            }
            should[rk] = row
        else:
            row["item"] = item
        # Never stack a second collection badge on top of an existing winner.
        if "custom_collection" not in row["winners"]:
            row["winners"]["custom_collection"] = winner
            queued_by_rule[rule["id"]] = queued_by_rule.get(rule["id"], 0) + 1

    for rule in rules:
        rid = rule["id"]
        total = len(rule_members.get(rid) or [])
        queued = int(queued_by_rule.get(rid) or 0)
        stolen = int(claimed_elsewhere.get(rid) or 0)
        if total and (queued != total or stolen):
            bits = [f"queued {queued}/{total} for stamping"]
            if stolen:
                bits.append(f"{stolen} already claimed by an earlier collection rule")
            _progress(
                progress,
                f"Collection badge '{rule.get('name') or rid}': " + "; ".join(bits),
            )
        elif total:
            _progress(
                progress,
                f"Collection badge '{rule.get('name') or rid}': queued {queued}/{total} for stamping",
            )
    if dropped:
        _progress(progress, f"Custom collection: {dropped} member(s) could not be queued")
    return rule_members


# ---------------------------------------------------------------------------
# Legacy per-mode log migration (media/status/ratings/network → unified)
# ---------------------------------------------------------------------------


def migrate_legacy_logs(paths: dict, progress: ProgressFn | None = None) -> int:
    """Merge the four per-mode logs + backups into the unified kometa log.

    The media pass ran first historically, so its backup is the true original;
    later mode backups contain already-badged art and are discarded.
    """
    log_path = kometa_log_path(paths)
    unified = _load_log(log_path)
    migrated = 0
    for mode in LEGACY_MODES:
        legacy_path = Path(paths["root"]) / f"{mode}_log.json"
        legacy = _load_log(legacy_path)
        if not legacy:
            continue
        for key, entry in legacy.items():
            if not isinstance(entry, dict):
                continue
            row = unified.get(key) or {
                "title": entry.get("title") or key,
                "library": entry.get("library") or "",
                "itemType": entry.get("itemType") or "",
                "families": {},
                "signature": "",
            }
            modes = set(row.get("legacyModes") or [])
            modes.add(mode)
            row["legacyModes"] = sorted(modes)
            row["needsRestamp"] = True
            row["preview_only"] = bool(entry.get("preview_only")) and bool(row.get("preview_only", True))
            unified[key] = row
            migrated += 1

            legacy_backup = Path(paths["backups"]) / mode / str(key) / "show.png"
            new_backup = _backup_file(paths, key)
            if legacy_backup.exists():
                if not new_backup.exists():
                    new_backup.parent.mkdir(parents=True, exist_ok=True)
                    try:
                        shutil.move(str(legacy_backup), str(new_backup))
                    except Exception:
                        pass
                else:
                    try:
                        legacy_backup.unlink()
                    except Exception:
                        pass
                try:
                    legacy_backup.parent.rmdir()
                except Exception:
                    pass
        try:
            legacy_path.rename(legacy_path.with_suffix(".json.migrated"))
        except Exception:
            try:
                legacy_path.unlink()
            except Exception:
                pass
    if migrated:
        _save_log(log_path, unified)
        _progress(progress, f"Migrated {migrated} legacy Layer-mode log entries into the unified log")
    return migrated


# ---------------------------------------------------------------------------
# Detection helpers for the Plex-data families (status/ratings/network)
# ---------------------------------------------------------------------------


def _rating_slot(score: float | None, source: str, *, minimum: float) -> dict | None:
    from kometa_detect import RATING_SOURCE_IMAGES

    if score is None or score < minimum:
        return None
    images = RATING_SOURCE_IMAGES.get(source) or ("TMDb", "TMDb")
    fresh, rotten = images
    image = fresh if score >= 6.0 else rotten
    return {"source": source, "image": image, "label": f"{score:.1f}", "score": score}


def _detect_ratings(item, config: dict, *, tmdb=None) -> Winner | None:
    """Build up to three rating badges (audience / critic / configured source)."""
    minimum = float(_cfg(config, "ratingsMinimum", "ratings_minimum", 0) or 0)
    source = str(_cfg(config, "ratingsSource", "ratings_source", "tmdb") or "tmdb").strip().lower()
    slots: list[dict] = []

    audience = None
    critic = None
    try:
        audience = float(getattr(item, "audienceRating", None)) if getattr(item, "audienceRating", None) is not None else None
    except (TypeError, ValueError):
        audience = None
    try:
        critic = float(getattr(item, "rating", None)) if getattr(item, "rating", None) is not None else None
    except (TypeError, ValueError):
        critic = None

    for score, key in ((audience, "audience"), (critic, "critic")):
        slot = _rating_slot(score, key, minimum=minimum)
        if slot:
            slots.append(slot)

    if source == "tmdb" and tmdb is not None and getattr(tmdb, "enabled", False):
        is_movie = str(getattr(item, "type", "") or "").lower() == "movie"
        tmdb_score = tmdb.vote_average(item, is_movie=is_movie)
        slot = _rating_slot(tmdb_score, "tmdb", minimum=minimum)
        if slot:
            slots.append(slot)
    elif source not in {"audience", "critic", "tmdb"}:
        # Prefer the explicitly configured source when it maps to a Plex field we already have.
        if source in {"user"}:
            try:
                user = float(getattr(item, "userRating", None)) if getattr(item, "userRating", None) is not None else None
            except (TypeError, ValueError):
                user = None
            slot = _rating_slot(user, "user", minimum=minimum)
            if slot:
                slots.append(slot)

    if not slots:
        # Fallback: single best Plex score (legacy behavior)
        from modes_kometa import _rating_value

        score = _rating_value(item)
        slot = _rating_slot(score, source if source in {"audience", "critic", "user", "tmdb", "imdb", "rt"} else "tmdb", minimum=minimum)
        if slot:
            slots.append(slot)
    if not slots:
        return None
    primary = slots[0]
    return Winner(
        family="ratings",
        name=primary["label"],
        key=primary["source"],
        text=primary["label"],
        weight=int(primary["score"] * 10),
        extra={"slots": slots[:3]},
    )


def _detect_network(item, config: dict) -> Winner | None:
    from modes_kometa import _network_label

    if str(getattr(item, "type", "") or "").lower() != "show":
        return None
    label = _network_label(item)
    if not label:
        return None
    return Winner(family="network", name=label, key=label.lower(), text=label)


def _resolution_variant_allowed(config: dict) -> Callable[[str, str], bool]:
    """Map the existing mediaInfoParts toggles onto Kometa's use_<key> switches."""
    from modes_kometa import _media_parts_config

    parts = _media_parts_config(config)

    def allowed(res_key: str, alt: str) -> bool:
        if res_key == "4k" and not parts.get("res4k", True):
            return False
        if res_key == "1080p" and not parts.get("res1080p", True):
            return False
        if res_key == "720p" and not parts.get("res720p", True):
            return False
        if res_key in {"576p", "480p", ""} and not parts.get("resOther", False):
            return False
        if alt in {"dv", "dvhdr", "dvhdrplus"} and not parts.get("dolbyVision", True):
            return False
        if alt in {"hdr", "hlg", "plus"} and not parts.get("hdr", True):
            return False
        return True

    return allowed


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------


def _signature(winners: dict[str, Winner], config: dict) -> str:
    parts = []
    for family, winner in sorted(winners.items()):
        part = f"{family}:{winner.name}"
        if family == "custom_collection" and winner.key:
            part = f"{part}:{winner.key}"
        parts.append(part)
    style = [
        f"audiostyle={_cfg(config, 'audioCodecStyle', 'audio_codec_style', 'compact')}",
        f"ratingsrc={_cfg(config, 'ratingsSource', 'ratings_source', 'tmdb')}",
        f"region={str(_cfg(config, 'streamingRegion', 'streaming_region', 'US') or 'US').upper()}",
        f"ribbon={_cfg(config, 'ribbonStyle', 'ribbon_style', 'yellow')}",
        f"cr={_cfg(config, 'contentRatingScheme', 'content_rating_scheme', 'us')}",
        f"flags={_cfg(config, 'kometaFlagStyle', 'kometa_flag_style', 'round')}",
    ]
    return "|".join(parts + style)


def _sanitize(name: str) -> str:
    from core import _sanitize_filename

    return _sanitize_filename(name)


def _download_original(plex, item) -> Image.Image | None:
    from core import _item_poster_image

    return _item_poster_image(plex, item)


def _should_ignore_overlay_backup(item, extra_labels=None) -> bool:
    """True when Overlay / Layer stamp tags were removed — current Plex art wins."""
    from core import _item_has_overlay_tracking_labels, _item_plex_label_tags

    # Library listings sometimes omit Label children — reload before treating as removed.
    if not _item_plex_label_tags(item) and extra_labels:
        try:
            if hasattr(item, "reload") and callable(item.reload):
                item.reload()
        except Exception:
            pass
    return not _item_has_overlay_tracking_labels(item, extra_labels)


def _write_clean_original(paths: dict, key: str, original: Image.Image) -> Path:
    """Replace the Layer backup (and leftover banner base) with current clean art."""
    backup = _backup_file(paths, key)
    backup.parent.mkdir(parents=True, exist_ok=True)
    original.save(backup)
    try:
        from layer_stack import base_poster_path

        dest = base_poster_path(paths, key)
        if dest.exists():
            original.save(dest)
    except Exception:
        pass
    return backup


def _load_stamp_original(
    plex,
    item,
    paths: dict,
    key: str,
    *,
    existing: dict | None = None,
    progress: ProgressFn | None = None,
    preview_mode: bool = False,
) -> tuple[Image.Image, Path]:
    """Clean original for composing. Ignore backups when overlay tags were removed."""
    backup = _backup_file(paths, key)
    extra = existing.get("overlayLabels") if isinstance(existing, dict) else None
    ignore_backup = _should_ignore_overlay_backup(item, extra)
    title = getattr(item, "title", key)

    if backup.exists() and not ignore_backup:
        return Image.open(backup).convert("RGBA"), backup

    poster = _download_original(plex, item)
    if poster is None:
        thumb = str(getattr(item, "thumb", None) or "").strip() or "(empty)"
        raise RuntimeError(f"failed to download poster (thumb={thumb})")
    original = poster.convert("RGBA")

    if ignore_backup and backup.exists():
        _progress(
            progress,
            f"Overlay labels gone — using current Plex poster (ignoring backup): {title}",
        )

    if not backup.exists() and has_overlay_marker(poster) and existing is None and not ignore_backup:
        ns_backup = Path(paths["backups"]) / str(key) / "show.png"
        if ns_backup.is_file():
            original = Image.open(ns_backup).convert("RGBA")
            _progress(progress, f"Using New Season backup as kometa base: {title}")
        else:
            _progress(
                progress,
                f"No clean backup for {title} (overlay marker present) — composing onto current poster",
            )

    if not preview_mode and (not backup.exists() or ignore_backup):
        _write_clean_original(paths, key, original)
        if ignore_backup:
            _progress(progress, f"Replaced overlay backup with current Plex poster: {title}")
        else:
            _progress(progress, f"Backed up original: {title}")

    return original, backup


def _item_poster_thumb(item) -> str:
    """Plex thumb URL token — changes whenever poster art is replaced."""
    return str(getattr(item, "thumb", None) or "").strip()


def _reload_item_thumb(item) -> str:
    try:
        if hasattr(item, "reload") and callable(item.reload):
            item.reload()
    except Exception:
        pass
    return _item_poster_thumb(item)


def _overlay_label_explained_locally(paths: dict | None, rating_key: str) -> bool:
    """True when this app's own banner stack (New Season / New Episode / Live /
    Recently Added / Top 10) currently owns an active layer for this item — meaning
    the Plex "Overlay" label is explained by our own stamp, not a separate/external
    Kometa install. Without this check, "skip if Overlay label present and not in my
    own Kometa log" would treat any title with just a New Season banner (which sets
    the same label) as "managed by a real Kometa install" and refuse to touch it."""
    if not paths or not rating_key:
        return False
    try:
        from layer_stack import load_registry, active_layers

        registry = load_registry(paths, str(rating_key))
        return bool(active_layers(registry))
    except Exception:
        return False


def _add_overlay_label(item) -> None:
    try:
        item.addLabel("Overlay")
    except Exception:
        pass


def _remove_overlay_label(item) -> None:
    _clear_plex_labels(item, ["Overlay"])


def _normalize_label_name(value: object) -> str:
    return str(value or "").strip()


def _winner_label_names(winners: dict) -> list[str]:
    """Plex Labels for stamped overlays — e.g. 4K-HDR, TrueHD-Atmos, Trending."""
    names: list[str] = []
    seen: set[str] = set()

    def _add(value: object) -> None:
        label = _normalize_label_name(value)
        if not label:
            return
        key = label.casefold()
        if key in seen:
            return
        seen.add(key)
        names.append(label)

    for winner in winners.values():
        _add(getattr(winner, "name", None))
        _add(getattr(winner, "text", None))
        extra = getattr(winner, "extra", None)
        if isinstance(extra, dict):
            _add(extra.get("ruleId"))
    return names


def _labels_from_families(families: object) -> list[str]:
    """Rebuild stamp labels from a kometa log families map (legacy rows)."""
    if not isinstance(families, dict) or not families:
        return []
    winners: dict[str, Winner] = {}
    for family, meta in families.items():
        winner = winner_from_log(str(family), meta if isinstance(meta, dict) else None)
        if winner is not None:
            winners[str(family)] = winner
    return _winner_label_names(winners)


def _known_layer_stamp_label_names() -> set[str]:
    """Display names we stamp as Plex Labels (resolution / audio / format + Overlay)."""
    from kometa_detect import known_overlay_stamp_label_names

    return known_overlay_stamp_label_names()


def _entry_labels_to_clear(entry: dict | None) -> list[str]:
    """Labels that should disappear when a Layer stamp is fully reverted."""
    entry = entry if isinstance(entry, dict) else {}
    names: list[str] = []
    seen: set[str] = set()

    def _add(value: object) -> None:
        label = _normalize_label_name(value)
        if not label:
            return
        key = label.casefold()
        if key in seen:
            return
        seen.add(key)
        names.append(label)

    stored = entry.get("overlayLabels")
    if isinstance(stored, list):
        for value in stored:
            _add(value)
    for value in _labels_from_families(entry.get("families")):
        _add(value)
    # Always drop the Kometa-compatible Overlay marker on a full Layer revert.
    _add("Overlay")
    return names


def _clear_plex_labels(
    item,
    labels: list[str],
    *,
    progress: ProgressFn | None = None,
    also_match_known_layer: bool = False,
) -> list[str]:
    """Remove Plex Labels by matching live MediaTag objects (reload-safe)."""
    want = [_normalize_label_name(name) for name in labels]
    want = [name for name in want if name]
    want_keys = {name.casefold() for name in want}

    try:
        item.reload()
    except Exception:
        pass

    present = list(getattr(item, "labels", None) or [])
    to_remove: list = []
    removed_names: list[str] = []
    known = _known_layer_stamp_label_names() if also_match_known_layer else set()
    known_keys = {name.casefold() for name in known}

    for lab in present:
        tag = _normalize_label_name(getattr(lab, "tag", None) or lab)
        if not tag:
            continue
        key = tag.casefold()
        if key in want_keys or (also_match_known_layer and key in known_keys):
            to_remove.append(lab)
            if tag not in removed_names:
                removed_names.append(tag)

    if not to_remove and want:
        # Local labels cache empty / missing — still ask Plex to drop by name.
        to_remove = list(want)
        removed_names = list(want)

    if not to_remove:
        return []

    try:
        item.removeLabel(to_remove)
    except Exception:
        for lab in to_remove:
            try:
                item.removeLabel(getattr(lab, "tag", None) or lab)
            except Exception:
                pass
    try:
        item.reload()
    except Exception:
        pass
    if removed_names:
        _progress(progress, f"Cleared Plex label(s): {', '.join(removed_names)}")
    return removed_names


def _sync_plex_labels(item, wanted: list[str], previous: list[str] | None = None) -> list[str]:
    """Add/remove Plex Labels so the item matches the current overlay set."""
    want = [_normalize_label_name(name) for name in wanted]
    want = [name for name in want if name]
    prev = [_normalize_label_name(name) for name in (previous or [])]
    prev = [name for name in prev if name]

    want_keys = {name.casefold() for name in want}
    to_remove = [name for name in prev if name.casefold() not in want_keys]
    if to_remove:
        _clear_plex_labels(item, to_remove)

    try:
        item.reload()
    except Exception:
        pass

    present_keys = {
        _normalize_label_name(getattr(lab, "tag", None) or lab).casefold()
        for lab in (getattr(item, "labels", None) or [])
        if _normalize_label_name(getattr(lab, "tag", None) or lab)
    }
    for name in want:
        if name.casefold() in present_keys:
            continue
        try:
            item.addLabel(name)
        except Exception:
            pass

    return want


def _winners_from_entry(entry: dict | None) -> dict[str, Winner]:
    """Rehydrate every tracked family from a kometa log row."""
    entry = entry if isinstance(entry, dict) else {}
    prev = entry.get("families") if isinstance(entry.get("families"), dict) else {}
    winners: dict[str, Winner] = {}
    for family, meta in prev.items():
        restored = winner_from_log(str(family), meta if isinstance(meta, dict) else None)
        if restored is not None:
            winners[str(family)] = restored
    return winners


def _previous_overlay_labels(entry: dict | None) -> list[str]:
    """Union of stored labels + family names so a partial drop can untag leftovers."""
    entry = entry if isinstance(entry, dict) else {}
    names: list[str] = []
    seen: set[str] = set()

    def _add(value: object) -> None:
        label = _normalize_label_name(value)
        if not label:
            return
        key = label.casefold()
        if key in seen:
            return
        seen.add(key)
        names.append(label)

    stored = entry.get("overlayLabels")
    if isinstance(stored, list):
        for value in stored:
            _add(value)
    for value in _labels_from_families(entry.get("families")):
        _add(value)
    return names


def _collection_rule_aliases(winner: Winner | None) -> set[str]:
    if winner is None:
        return set()
    extra = winner.extra if isinstance(winner.extra, dict) else {}
    aliases = {
        _normalize_label_name(winner.name),
        _normalize_label_name(winner.text),
        _normalize_label_name(winner.key),
        _normalize_label_name(extra.get("ruleId")),
    }
    return {name for name in aliases if name}


def _should_drop_winner(
    family: str,
    winner: Winner,
    target_family: str,
    rule_id: str | None,
) -> bool:
    if str(family) != str(target_family):
        return False
    rid = _normalize_label_name(rule_id)
    if not rid or str(target_family) != "custom_collection":
        return True
    aliases = {name.casefold() for name in _collection_rule_aliases(winner)}
    return rid.casefold() in aliases


def _restamp_item_winners(
    plex,
    paths: dict,
    config: dict,
    key: str,
    entry: dict,
    winners: dict[str, Winner],
    progress: ProgressFn | None,
) -> dict | None:
    """Compose remaining families from the clean backup. None means full restore."""
    if not winners:
        return None
    try:
        item = plex.fetchItem(f"/library/metadata/{key}")
    except Exception:
        return None
    original, backup = _load_stamp_original(
        plex, item, paths, key, existing=entry, progress=progress,
    )
    result = compose_poster(original, winners, config=config, paths=paths)
    safe = _sanitize(f"{(entry or {}).get('title') or key}_kometa")
    temp = Path(paths["preview"]) / f"temp_{safe}.png"
    save_with_marker(result, temp)
    try:
        from core import _upload_poster_resilient

        _upload_poster_resilient(
            item,
            temp,
            progress=progress,
            title=str((entry or {}).get("title") or key),
        )
    finally:
        if temp.exists():
            temp.unlink()
    wanted = _winner_label_names(winners)
    synced = _sync_plex_labels(item, wanted, previous=_previous_overlay_labels(entry))
    if wanted:
        _add_overlay_label(item)
    else:
        _remove_overlay_label(item)
    updated = {
        **(entry if isinstance(entry, dict) else {}),
        "families": {family: winner.as_log() for family, winner in winners.items()},
        "signature": _signature(winners, config),
        "timestamp": datetime.now().isoformat(),
        "posterThumb": _reload_item_thumb(item) or (entry or {}).get("posterThumb"),
        "overlayLabels": synced,
        "labeled": bool(wanted),
        "hasBackup": backup.exists(),
    }
    updated.pop("needsRestamp", None)
    _progress(
        progress,
        f"Kept {', '.join(w.name for w in winners.values())} on {(entry or {}).get('title') or key}",
    )
    return updated


def _restore_item(plex, paths: dict, key: str, entry: dict, progress: ProgressFn | None) -> bool:
    """Kometa restore priority: disk backup, else fresh provider poster."""
    import shutil

    from core import _item_has_overlay_tracking_labels, _reset_poster, _upload_poster_resilient

    try:
        item = plex.fetchItem(f"/library/metadata/{key}")
    except Exception:
        # Item gone from Plex — still drop the orphan backup so the UI can clear.
        _clear_backup(paths, key)
        return False

    extra = entry.get("overlayLabels") if isinstance(entry, dict) else None
    if not _item_has_overlay_tracking_labels(item, extra):
        title = (entry or {}).get("title") or key
        _progress(
            progress,
            f"Overlay labels gone — leaving current Plex poster (not restoring backup): {title}",
        )
        labels = _entry_labels_to_clear(entry)
        orphan = not bool((entry or {}).get("overlayLabels")) and not bool((entry or {}).get("families"))
        _clear_plex_labels(
            item,
            labels,
            progress=progress,
            also_match_known_layer=orphan,
        )
        _clear_backup(paths, key)
        return True
    backup = _backup_file(paths, key)
    ok = False
    if backup.exists():
        # Copy first so upload can't keep the backup file locked (Windows).
        temp = Path(paths["preview"]) / f"restore_kometa_{key}.png"
        try:
            temp.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(backup, temp)
            _upload_poster_resilient(
                item,
                temp,
                progress=progress,
                title=str(entry.get("title") or key),
            )
            ok = True
            _progress(progress, f"Restored original poster: {entry.get('title') or key}")
            _clear_backup(paths, key)
        except Exception as exc:
            _progress(progress, f"Backup restore failed for {key}: {exc}")
        finally:
            try:
                if temp.exists():
                    temp.unlink()
            except Exception:
                pass
    if not ok:
        ok = _reset_poster(item)
        if ok:
            _progress(progress, f"Reset poster to provider art: {entry.get('title') or key}")
    # Always scrub Overlay + stamp labels. Prefer log metadata; for orphan backups
    # also drop known Layer stamp names still present on the item (e.g. 4K).
    labels = _entry_labels_to_clear(entry)
    orphan = not bool(entry.get("overlayLabels")) and not bool(entry.get("families"))
    _clear_plex_labels(
        item,
        labels,
        progress=progress,
        also_match_known_layer=orphan,
    )
    # Always scrub leftover backup so orphan rows cannot stick in the UI.
    if not _clear_backup(paths, key) and _backup_file(paths, key).exists():
        _progress(progress, f"Warning: Layer backup still on disk for {key} after revert")
    return ok


def _collect_section_plans(plex, config: dict, scope: str | None = None) -> dict[str, dict]:
    """section_id -> {section, families: set} for enabled families in the given scope."""
    from modes_kometa import _sections_for_kometa_mode

    families = enabled_families(config, scope=scope)
    plans: dict[str, dict] = {}
    seen_modes: dict[str, list] = {}
    for family in families:
        if family == "custom_collection":
            # Membership is resolved via collection.items() — not a library section scan.
            continue
        mode = FAMILY_SCOPE[family]
        if mode not in seen_modes:
            seen_modes[mode] = list(_sections_for_kometa_mode(plex, config, mode))
        for section in seen_modes[mode]:
            sid = str(getattr(section, "key", "") or "").rstrip("/").split("/")[-1]
            plan = plans.setdefault(sid, {"section": section, "families": set()})
            stype = str(getattr(section, "type", "") or "").lower()
            if family == "edition" and stype != "movie":
                continue
            if family in {"status", "network"} and stype != "show":
                continue
            if family == "episode_info" and stype != "show":
                continue
            if family == "mediastinger" and stype != "movie":
                continue
            if family in {"aspect", "language_count", "languages"} and stype != "movie":
                continue
            plan["families"].add(family)
    return plans


def _iter_section_items(section, families: set[str]):
    """Yield items to stamp. Episode_info pulls episodes; everything else uses section.all()."""
    stype = str(getattr(section, "type", "") or "").lower()
    if "episode_info" in families and stype == "show" and families <= {"episode_info"}:
        try:
            yield from section.search(libtype="episode")
        except Exception:
            try:
                for show in section.all():
                    yield from (show.episodes() or [])
            except Exception:
                return
        return
    try:
        items = list(section.all())
    except Exception:
        items = []
    for item in items:
        yield item
    if "episode_info" in families and stype == "show":
        # Also stamp episode art when episode_info is enabled alongside show families.
        try:
            for ep in section.search(libtype="episode"):
                yield ep
        except Exception:
            pass


def _detect_family_winner(
    family: str,
    item,
    section,
    *,
    detector: KometaDetector,
    config: dict,
    res_allowed,
    tmdb,
    lists,
    airing_days: int,
    streaming_region: str,
) -> Winner | None:
    if family == "resolution":
        return detector.detect_resolution(item, section, variant_allowed=res_allowed)
    if family == "edition":
        return detector.detect_edition(item, section)
    if family == "audio_codec":
        return detector.detect_audio_codec(item, section)
    if family == "video_format":
        return detector.detect_video_format(item, section)
    if family == "aspect":
        return detector.detect_aspect(item, section)
    if family == "versions":
        return detector.detect_versions(item, section)
    if family == "language_count":
        return detector.detect_language_count(item, section)
    if family == "languages":
        wanted = _cfg(config, "languagesAllowCodes", "languages_allow_codes", []) or []
        if isinstance(wanted, str):
            wanted = [x.strip() for x in wanted.split(",") if x.strip()]
        return detector.detect_languages(item, section, wanted=list(wanted))
    if family == "runtimes":
        return detector.detect_runtimes(item, section)
    if family == "direct_play":
        return detector.detect_direct_play(item, section)
    if family == "episode_info":
        return detector.detect_episode_info(item, section)
    if family == "content_rating":
        scheme = str(_cfg(config, "contentRatingScheme", "content_rating_scheme", "us") or "us")
        return detector.detect_content_rating(item, section, scheme=scheme)
    if family == "status":
        return detector.detect_status(item, section, tmdb=tmdb, airing_days=airing_days)
    if family == "ratings":
        return _detect_ratings(item, config, tmdb=tmdb)
    if family == "network":
        return _detect_network(item, config)
    if family == "streaming":
        return detector.detect_streaming(item, section, tmdb=tmdb, region=streaming_region)
    if family == "ribbon":
        style = str(_cfg(config, "ribbonStyle", "ribbon_style", "yellow") or "yellow")
        return detector.detect_ribbon(item, section, lists=lists, tmdb=tmdb, style=style)
    if family == "mediastinger":
        return detector.detect_mediastinger(item, section, tmdb=tmdb)
    return None


def run_kometa_parity(plex, config: dict, paths: dict, preview_mode: bool, progress: ProgressFn | None = None) -> dict:
    from core import _has_kometa_overlay_label, _title_allowed
    from modes_kometa import _mode_allow_deny

    log_path = kometa_log_path(paths)
    migrate_legacy_logs(paths, progress)
    log = _load_log(log_path)

    scope_raw = str(config.get("kometaScope") or config.get("kometa_scope") or "all").strip().lower()
    if scope_raw in {"media", "layer", "kometa-media"}:
        scope_name = "media"
    elif scope_raw in {"collections", "collection", "custom_collection", "custom-collections"}:
        scope_name = "collections"
    else:
        scope_name = "all"

    all_families = enabled_families(config, scope="all")
    families = enabled_families(config, scope=scope_name)
    scope_set = set(families)
    skip_kometa = _as_bool(_cfg(config, "skipIfKometaOverlayLabel", "skip_if_kometa_overlay_label"), True)
    add_label = _as_bool(_cfg(config, "kometaAddOverlayLabel", "kometa_add_overlay_label"), False)

    added = removed = skipped = 0
    errors: list[str] = []
    family_counts: dict[str, int] = {}

    if not all_families:
        # Everything off — prune all tracked stamps (never on a scoped single-title test).
        only_title_keys_early = _only_rating_keys(config)
        if only_title_keys_early:
            _progress(progress, "Layer overlays disabled — scoped pass leaves tracked stamps alone")
            return {
                "kometaEnabled": False,
                "kometaAdded": 0,
                "kometaRemoved": 0,
                "kometaTotal": len(log),
                "kometaErrors": [],
                "kometaScope": scope_name,
            }
        if log:
            _progress(progress, "Layer overlays disabled — restoring tracked posters…")
        for key in list(log.keys()):
            entry = log.get(key) or {}
            try:
                if preview_mode:
                    if bool(entry.get("preview_only")):
                        del log[key]
                        removed += 1
                    continue
                _restore_item(plex, paths, key, entry, progress)
                del log[key]
                removed += 1
            except Exception as exc:
                errors.append(f"kometa remove {key}: {exc}")
        _save_log(log_path, log)
        return {
            "kometaEnabled": False,
            "kometaAdded": 0,
            "kometaRemoved": removed,
            "kometaTotal": len(log),
            "kometaErrors": errors,
            "kometaScope": scope_name,
        }

    if not families:
        _progress(progress, f"Layer scope '{scope_name}' has no enabled families — nothing to do")
        return {
            "kometaEnabled": True,
            "kometaAdded": 0,
            "kometaRemoved": 0,
            "kometaTotal": len(log),
            "kometaErrors": [],
            "kometaScope": scope_name,
            "kometaSkipped": 0,
        }

    media_families = [f for f in families if f != "custom_collection"]
    media_family_set = set(media_families)

    _progress(progress, f"Layer pass ({scope_name}) — families: {', '.join(families)}")
    detector: KometaDetector | None = None
    res_allowed = _resolution_variant_allowed(config)
    allow_deny = {
        mode: _mode_allow_deny(config, mode)
        for mode in ("media", "status", "ratings", "network", "streaming", "ribbon")
    }
    airing_days = int(_cfg(config, "statusAiringDays", "status_airing_days", 14) or 14)
    streaming_region = str(_cfg(config, "streamingRegion", "streaming_region", "US") or "US").strip().upper() or "US"

    tmdb = None
    need_tmdb = {"status", "streaming", "ratings", "ribbon", "mediastinger"} & media_family_set
    if need_tmdb:
        from kometa_external import create_kometa_tmdb

        tmdb = create_kometa_tmdb(config, paths, progress)
        if not tmdb.enabled:
            if "streaming" in media_family_set:
                _progress(progress, "Streaming overlays need a TMDB API key — skipping that family")
                media_families = [f for f in media_families if f != "streaming"]
                media_family_set.discard("streaming")
                families = [f for f in families if f != "streaming"]
            if "mediastinger" in media_family_set:
                _progress(progress, "MediaStinger overlays need a TMDB API key — skipping that family")
                media_families = [f for f in media_families if f != "mediastinger"]
                media_family_set.discard("mediastinger")
                families = [f for f in families if f != "mediastinger"]
            if "status" in media_family_set:
                _progress(progress, "No TMDB API key — status falls back to Plex series status")

    lists = None
    if "ribbon" in media_family_set:
        from kometa_lists import KometaLists

        lists = KometaLists(Path(paths["root"]) / "cache", progress=progress)

    plans: dict[str, dict] = {}
    should: dict[str, dict] = {}
    scanned = 0
    only_title_keys = _only_rating_keys(config)
    scoped_titles = bool(only_title_keys)

    if scoped_titles and media_family_set:
        if detector is None:
            detector = KometaDetector(plex, progress=progress)
        _progress(
            progress,
            f"Scoped Layer pass — {len(only_title_keys)} rating key(s); full-library scan and prune skipped",
        )
        # Detect media/status/etc on the requested titles only (collections inject later).
        for key in sorted(only_title_keys):
            item = _fetch_plex_item(plex, key)
            if item is None:
                _progress(progress, f"Title {key}: not found in Plex — skipped")
                continue
            scanned += 1
            if (
                skip_kometa
                and key not in log
                and _has_kometa_overlay_label(item)
                and not _overlay_label_explained_locally(paths, key)
            ):
                _progress(
                    progress,
                    f"{getattr(item, 'title', key)}: skipped (Overlay label / external Kometa)",
                )
                skipped += 1
                continue
            item_type = str(getattr(item, "type", "") or "").lower()
            library = _item_library_title(item)
            row = {
                "item": item,
                "library": library,
                "itemType": item_type,
                "winners": {},
            }
            attempted: set[str] = set()
            for family in media_family_set:
                if item_type == "episode" and family != "episode_info":
                    continue
                if item_type != "episode" and family == "episode_info":
                    continue
                # Family/library type gates (mirror _collect_section_plans).
                if family == "edition" and item_type != "movie":
                    continue
                if family in {"status", "network"} and item_type != "show":
                    continue
                if family == "episode_info" and item_type != "episode":
                    continue
                if family == "mediastinger" and item_type != "movie":
                    continue
                if family in {"aspect", "language_count", "languages"} and item_type != "movie":
                    continue
                allow, deny = allow_deny.get(FAMILY_SCOPE.get(family, ""), ([], []))
                if not _title_allowed(key, allow, deny):
                    continue
                attempted.add(family)
                try:
                    section = None
                    try:
                        section = item.section()
                    except Exception:
                        section = None
                    winner = _detect_family_winner(
                        family,
                        item,
                        section,
                        detector=detector,
                        config=config,
                        res_allowed=res_allowed,
                        tmdb=tmdb,
                        lists=lists,
                        airing_days=airing_days,
                        streaming_region=streaming_region,
                    )
                    if winner is not None:
                        row["winners"][family] = winner
                except Exception as exc:
                    errors.append(f"{family} {getattr(item, 'title', key)}: {exc}")
            if row["winners"]:
                should[key] = row
            elif media_family_set:
                title = getattr(item, "title", key)
                not_applicable = sorted(media_family_set - attempted)
                if attempted:
                    detail = f"tried {', '.join(sorted(attempted))} — no matching data found on this title"
                    if not_applicable:
                        detail += f"; {', '.join(not_applicable)} don't apply to a {item_type or 'this'} item"
                else:
                    detail = (
                        f"none of your enabled families ({', '.join(not_applicable)}) apply to a "
                        f"{item_type or 'this'} item"
                    )
                _progress(progress, f"{title}: no Layer badge matched — {detail}")
    elif media_family_set:
        if detector is None:
            detector = KometaDetector(plex, progress=progress)
        plans = _collect_section_plans(plex, config, scope=scope_name)
        movie_libs = []
        show_libs = []
        for plan in plans.values():
            section = plan["section"]
            families_here = plan["families"] & media_family_set
            if not families_here:
                continue
            stype = str(getattr(section, "type", "") or "").lower()
            title = str(getattr(section, "title", "") or "")
            (show_libs if stype == "show" else movie_libs).append(title or str(getattr(section, "key", "")))
        _progress(
            progress,
            f"Layer libraries: {len(movie_libs)} movie ({', '.join(movie_libs) or 'none'}), "
            f"{len(show_libs)} TV ({', '.join(show_libs) or 'none'})",
        )
        if "resolution" in media_family_set and not show_libs:
            _progress(
                progress,
                "No TV libraries in this Layer pass — 4K will not stamp show posters. "
                "Enable Include TV shows and tick TV libraries on Media / Layer.",
            )
        for sid, plan in plans.items():
            section = plan["section"]
            section_families = plan["families"] & media_family_set
            if not section_families:
                continue
            stype = str(getattr(section, "type", "") or "").lower() or "unknown"
            _progress(
                progress,
                f"Layer scan: {getattr(section, 'title', sid)} [{stype}] ({', '.join(sorted(section_families))})…",
            )
            if stype == "show" and "resolution" in section_families:
                detector.index_for(section, need_resolution=True, need_hdr=True, need_dovi=True)
            for item in _iter_section_items(section, section_families):
                scanned += 1
                if scanned % 50 == 0:
                    _progress(progress, f"Layer scan: checked {scanned} titles, eligible {len(should)}…")
                key = str(getattr(item, "ratingKey", "") or "")
                if not key:
                    continue
                if (
                    skip_kometa
                    and key not in log
                    and _has_kometa_overlay_label(item)
                    and not _overlay_label_explained_locally(paths, key)
                ):
                    skipped += 1
                    continue  # managed by a real Kometa install — leave alone
                item_type = str(getattr(item, "type", "") or "").lower()
                row = should.get(key) or {
                    "item": item,
                    "library": getattr(section, "title", ""),
                    "itemType": item_type,
                    "winners": {},
                }
                for family in section_families:
                    # Episode items only get episode_info (+ optional media families that work on episodes).
                    if item_type == "episode" and family != "episode_info":
                        continue
                    if item_type != "episode" and family == "episode_info":
                        continue
                    allow, deny = allow_deny.get(FAMILY_SCOPE[family], ([], []))
                    if not _title_allowed(key, allow, deny):
                        continue
                    if family in row["winners"]:
                        continue
                    try:
                        winner = _detect_family_winner(
                            family,
                            item,
                            section,
                            detector=detector,
                            config=config,
                            res_allowed=res_allowed,
                            tmdb=tmdb,
                            lists=lists,
                            airing_days=airing_days,
                            streaming_region=streaming_region,
                        )
                        if winner is not None:
                            row["winners"][family] = winner
                    except Exception as exc:
                        errors.append(f"{family} {getattr(item, 'title', key)}: {exc}")
                if row["winners"]:
                    should[key] = row
    elif scope_name == "collections":
        _progress(progress, "Collection-only pass — resolving membership (no library-wide Layer scan)")

    cc_rule_members: dict[str, set[str]] = {}
    active_cc_rule_ids: set[str] = set()
    only_collection_keys = _only_collection_rating_keys(config)
    if "custom_collection" in families:
        _progress(progress, "Resolving custom collection badge membership…")
        if only_collection_keys:
            _progress(
                progress,
                f"Targeted collection sync — {len(only_collection_keys)} collection key(s) "
                f"(add missing badges, remove leavers only)",
            )
        if scoped_titles:
            _progress(
                progress,
                f"Scoped collection stamp — only {len(only_title_keys)} title(s) will be considered",
            )
        cc_rule_members = _apply_custom_collection_winners(
            plex,
            config,
            paths,
            should,
            progress=progress,
            errors=errors,
            only_rating_keys=only_title_keys if scoped_titles else None,
        )
        active_cc_rule_ids = {r["id"] for r in _custom_collection_rules(config)}
        # Don't steal badges from higher-priority rules outside this targeted set.
        if only_collection_keys and active_cc_rule_ids:
            all_rules = _custom_collection_rules(config, respect_only_keys=False)
            priority = {r["id"]: idx for idx, r in enumerate(all_rules)}
            for key, row in list(should.items()):
                winners = row.get("winners") if isinstance(row, dict) else None
                if not isinstance(winners, dict) or "custom_collection" not in winners:
                    continue
                new_winner = winners.get("custom_collection")
                new_rule = ""
                if new_winner is not None and isinstance(getattr(new_winner, "extra", None), dict):
                    new_rule = str(new_winner.extra.get("ruleId") or "").strip()
                existing = log.get(key) if isinstance(log.get(key), dict) else {}
                prev_meta = (existing.get("families") or {}).get("custom_collection")
                prev_rule = ""
                if isinstance(prev_meta, dict):
                    prev_rule = str((prev_meta.get("extra") or {}).get("ruleId") or "").strip()
                if (
                    prev_rule
                    and prev_rule not in active_cc_rule_ids
                    and prev_rule in priority
                    and new_rule in priority
                    and priority[prev_rule] < priority[new_rule]
                ):
                    winners.pop("custom_collection", None)
                    if not winners:
                        should.pop(key, None)
                    else:
                        # Keep other Layer families; restore previous collection badge for compose.
                        restored = winner_from_log("custom_collection", prev_meta)
                        if restored is not None:
                            winners["custom_collection"] = restored
        cc_queued = sum(
            1 for row in should.values()
            if isinstance(row, dict) and "custom_collection" in (row.get("winners") or {})
        )
        _progress(progress, f"Custom collection badges queued for {cc_queued} title(s)")

        # Targeted ColleXions restamp: if membership already matches tracked stamps, skip work.
        if only_collection_keys and active_cc_rule_ids and not preview_mode:
            expected_keys = {
                str(k)
                for k, row in should.items()
                if isinstance(row, dict) and "custom_collection" in (row.get("winners") or {})
            }
            tracked_keys: set[str] = set()
            for key, entry in log.items():
                if not isinstance(entry, dict) or bool(entry.get("preview_only")):
                    continue
                fams = entry.get("families") if isinstance(entry.get("families"), dict) else {}
                cc_meta = fams.get("custom_collection") if isinstance(fams.get("custom_collection"), dict) else None
                if not cc_meta:
                    continue
                source = _stamp_source_collection_key(cc_meta)
                # Only compare stamps that belong to the collection(s) being updated.
                if source and source in only_collection_keys:
                    tracked_keys.add(str(key))
            if expected_keys == tracked_keys:
                _progress(
                    progress,
                    f"Collection membership unchanged ({len(expected_keys)} title(s)) — skipping stamp/prune",
                )
                return {
                    "kometaEnabled": True,
                    "kometaFamilies": families,
                    "kometaAdded": 0,
                    "kometaSkipped": len(expected_keys),
                    "kometaRemoved": 0,
                    "kometaTotal": len(log),
                    "kometaEligible": len(should),
                    "kometaFamilyCounts": {},
                    "kometaErrors": errors,
                    "kometaScope": scope_name,
                    "onlyCollectionRatingKeys": sorted(only_collection_keys),
                }

    _progress(progress, f"Layer eligible: {len(should)} of {scanned} scanned")

    # Preserve out-of-scope badges so Media-only / Collections-only runs don't wipe each other.
    if scope_name != "all":
        for key, row in should.items():
            existing = log.get(key)
            if not isinstance(existing, dict):
                continue
            prev = existing.get("families") if isinstance(existing.get("families"), dict) else {}
            winners = row.setdefault("winners", {})
            for fam, meta in prev.items():
                if fam in scope_set or fam in winners:
                    continue
                restored = winner_from_log(str(fam), meta if isinstance(meta, dict) else None)
                if restored is not None:
                    winners[fam] = restored

    # Stamp
    cc_stamped_ok: set[str] = set()
    for key, row in sorted(should.items(), key=lambda kv: kv[0]):
        item = row["item"]
        winners: dict[str, Winner] = row["winners"]
        existing = log.get(key)
        sig = _signature(winners, config)
        has_collection_badge = "custom_collection" in winners
        try:
            wanted_labels = _winner_label_names(winners)
            current_thumb = _item_poster_thumb(item)
            tracked_thumb = str(existing.get("posterThumb") or "").strip() if isinstance(existing, dict) else ""
            # Skip when winners are unchanged. If we already recorded a poster thumb and
            # Plex art changed (New Season / TPDB / manual), restamp. Legacy rows with no
            # posterThumb just get the token backfilled — do not force a full re-upload.
            # ColleXions targeted sync: only add missing badges / remove leavers — never
            # rip-and-replace posters that are already correct for this collection.
            poster_replaced = bool(tracked_thumb) and tracked_thumb != current_thumb
            if only_collection_keys:
                poster_replaced = False
            extra_labels = (
                existing.get("overlayLabels") if isinstance(existing, dict) else None
            )
            labels_removed = _should_ignore_overlay_backup(item, extra_labels)
            if (
                existing
                and not preview_mode
                and not bool(existing.get("preview_only"))
                and not bool(existing.get("needsRestamp"))
                and existing.get("signature") == sig
                and not poster_replaced
                and not labels_removed
            ):
                prev_labels = existing.get("overlayLabels") if isinstance(existing.get("overlayLabels"), list) else None
                updated = dict(existing)
                dirty = False
                if not tracked_thumb and current_thumb:
                    updated["posterThumb"] = current_thumb
                    dirty = True
                if prev_labels is None or sorted(prev_labels) != sorted(wanted_labels):
                    try:
                        synced = _sync_plex_labels(item, wanted_labels, previous=prev_labels or [])
                        updated["overlayLabels"] = synced
                        dirty = True
                    except Exception as exc:
                        errors.append(f"kometa labels {getattr(item, 'title', key)}: {exc}")
                if dirty:
                    log[key] = updated
                skipped += 1
                if has_collection_badge:
                    cc_stamped_ok.add(key)
                continue
            if (
                existing
                and not preview_mode
                and not bool(existing.get("preview_only"))
                and existing.get("signature") == sig
                and poster_replaced
            ):
                _progress(
                    progress,
                    f"Restamping {getattr(item, 'title', key)} (poster changed since last stamp)",
                )
            elif (
                existing
                and not preview_mode
                and not bool(existing.get("preview_only"))
                and labels_removed
            ):
                _progress(
                    progress,
                    f"Restamping {getattr(item, 'title', key)} (overlay labels removed — using current Plex poster)",
                )

            # Preview rows must always be restamped on a live Run (never left as Preview).
            if existing and bool(existing.get("preview_only")) and not preview_mode:
                _progress(progress, f"Promoting preview → live: {getattr(item, 'title', key)}")

            original, backup = _load_stamp_original(
                plex,
                item,
                paths,
                key,
                existing=existing if isinstance(existing, dict) else None,
                progress=progress,
                preview_mode=preview_mode,
            )

            result = compose_poster(original, winners, config=config, paths=paths)
            safe = _sanitize(f"{getattr(item, 'title', key)}_kometa")
            entry = {
                "title": getattr(item, "title", key),
                "library": row.get("library") or "",
                "itemType": row.get("itemType") or "",
                "timestamp": datetime.now().isoformat(),
                "preview_only": bool(preview_mode),
                "signature": sig,
                "families": {family: winner.as_log() for family, winner in winners.items()},
                "hasBackup": backup.exists(),
                "labeled": bool(existing.get("labeled")) if isinstance(existing, dict) else False,
                "overlayLabels": (
                    list(existing.get("overlayLabels") or [])
                    if isinstance(existing, dict) and isinstance(existing.get("overlayLabels"), list)
                    else []
                ),
            }
            if preview_mode:
                out = Path(paths["preview"]) / f"{safe}.png"
                result.save(out)
                entry["previewShow"] = str(out)
                _progress(progress, f"[Preview] kometa: {entry['title']} ({', '.join(w.name for w in winners.values())})")
            else:
                temp = Path(paths["preview"]) / f"temp_{safe}.png"
                save_with_marker(result, temp)
                try:
                    from core import _upload_poster_resilient

                    _upload_poster_resilient(
                        item,
                        temp,
                        progress=progress,
                        title=str(getattr(item, "title", key) or key),
                    )
                finally:
                    if temp.exists():
                        temp.unlink()
                entry["posterThumb"] = _reload_item_thumb(item) or current_thumb
                prev_labels = (
                    list(existing.get("overlayLabels") or [])
                    if isinstance(existing, dict) and isinstance(existing.get("overlayLabels"), list)
                    else []
                )
                entry["overlayLabels"] = _sync_plex_labels(item, wanted_labels, previous=prev_labels)
                if add_label:
                    _add_overlay_label(item)
                    entry["labeled"] = True
                entry["preview_only"] = False
                _progress(progress, f"Stamped kometa: {entry['title']} ({', '.join(w.name for w in winners.values())})")
            merged = {**(existing or {}), **entry}
            merged.pop("needsRestamp", None)
            merged.pop("legacyModes", None)
            log[key] = merged
            # Flush after every stamp so a mid-run timeout/kill still leaves revertible rows.
            if not preview_mode:
                _save_log(log_path, log)
            added += 1
            if has_collection_badge and not preview_mode:
                cc_stamped_ok.add(key)
            for family in winners:
                family_counts[family] = family_counts.get(family, 0) + 1
        except Exception as exc:
            errors.append(f"kometa {getattr(item, 'title', key)}: {exc}")
            _progress(progress, f"Layer stamp failed for {getattr(item, 'title', key)}: {exc}")
            # Keep the title visible in the tracked list so missing badges are obvious.
            fail_entry = {
                **(existing if isinstance(existing, dict) else {}),
                "title": getattr(item, "title", key),
                "library": row.get("library") or (existing or {}).get("library") or "",
                "itemType": row.get("itemType") or (existing or {}).get("itemType") or "",
                "timestamp": datetime.now().isoformat(),
                "needsRestamp": True,
                "signature": sig,
                "families": {family: winner.as_log() for family, winner in winners.items()},
            }
            if not preview_mode:
                # Stay Live-looking in UI but flagged for another attempt.
                fail_entry["preview_only"] = False
            elif existing and isinstance(existing, dict) and bool(existing.get("preview_only")):
                fail_entry["preview_only"] = True
            log[key] = fail_entry
            if not preview_mode:
                _save_log(log_path, log)

    # Prune entries no longer eligible for this scope.
    if scoped_titles:
        _progress(progress, "Scoped Layer pass — prune of other tracked titles skipped")
    else:
      for key in list(log.keys()):
        if key in should:
            continue
        entry = log.get(key) or {}
        prev = entry.get("families") if isinstance(entry.get("families"), dict) else {}
        try:
            if preview_mode:
                if bool(entry.get("preview_only")):
                    del log[key]
                    removed += 1
                continue
            # Targeted ColleXions restamp: only prune titles that came from the
            # updated collection key(s). Never strip sibling collections that share
            # the same overlay rule (e.g. Reality TV when only Kids was updated).
            if only_collection_keys:
                cc_meta = prev.get("custom_collection") if isinstance(prev.get("custom_collection"), dict) else None
                if not cc_meta:
                    continue
                source = _stamp_source_collection_key(cc_meta)
                if not source or source not in only_collection_keys:
                    continue
            if scope_name != "all" and prev:
                # Keep titles that still have badges outside this scope.
                if any(str(fam) not in scope_set for fam in prev.keys()):
                    in_scope = [str(fam) for fam in prev.keys() if str(fam) in scope_set]
                    if not in_scope:
                        continue
                    # Drop only this scope's families and restamp the rest.
                    preserved: dict[str, Winner] = {}
                    for fam, meta in prev.items():
                        if str(fam) in scope_set:
                            continue
                        restored = winner_from_log(str(fam), meta if isinstance(meta, dict) else None)
                        if restored is not None:
                            preserved[str(fam)] = restored
                    if not preserved:
                        _restore_item(plex, paths, key, entry, progress)
                        del log[key]
                        removed += 1
                        continue
                    restamped = _restamp_item_winners(
                        plex, paths, config, key, entry, preserved, progress,
                    )
                    if restamped is None:
                        _restore_item(plex, paths, key, entry, progress)
                        del log[key]
                        removed += 1
                        continue
                    log[key] = restamped
                    if not preview_mode:
                        _save_log(log_path, log)
                    removed += 1
                    continue
            _restore_item(plex, paths, key, entry, progress)
            del log[key]
            removed += 1
        except Exception as exc:
            errors.append(f"kometa remove {key}: {exc}")

    if cc_rule_members and not preview_mode:
        rules_by_id = {r["id"]: r for r in _custom_collection_rules(config)}
        for rid, members in cc_rule_members.items():
            missing = sorted(members - cc_stamped_ok)
            if not missing:
                _progress(
                    progress,
                    f"Collection badge '{(rules_by_id.get(rid) or {}).get('name') or rid}': "
                    f"all {len(members)} member(s) up to date",
                )
                continue
            names = []
            for mk in missing[:12]:
                row = should.get(mk) or {}
                title = getattr(row.get("item"), "title", None) or (log.get(mk) or {}).get("title") or mk
                names.append(str(title))
            extra = f" (+{len(missing) - len(names)} more)" if len(missing) > len(names) else ""
            msg = (
                f"Collection badge '{(rules_by_id.get(rid) or {}).get('name') or rid}': "
                f"{len(missing)}/{len(members)} member(s) still need a stamp — {', '.join(names)}{extra}"
            )
            errors.append(msg)
            _progress(progress, msg)

    if tmdb is not None:
        tmdb.save()

    _save_log(log_path, log)
    summary = {
        "kometaEnabled": True,
        "kometaFamilies": families,
        "kometaAdded": added,
        "kometaSkipped": skipped,
        "kometaRemoved": removed,
        "kometaTotal": len(log),
        "kometaEligible": len(should),
        "kometaFamilyCounts": family_counts,
        "kometaErrors": errors,
    }
    _progress(
        progress,
        f"Layer pass done — +{added}/-{removed} (skipped {skipped}, tracked {len(log)})",
    )
    return summary


# ---------------------------------------------------------------------------
# Revert
# ---------------------------------------------------------------------------


def revert_kometa(config: dict, rating_key: str | None = None, progress: ProgressFn | None = None) -> dict:
    """Per-item or bulk revert of every Layer overlay.

    Also restores from on-disk backups under backups/kometa/ even when the JSON log
    never flushed (timeout / kill mid-run).
    """
    from core import _connect, _resolve_paths

    paths = _resolve_paths(config)
    migrate_legacy_logs(paths, progress)
    plex = _connect(config)
    log_path = kometa_log_path(paths)
    log = _load_log(log_path)
    backup_keys = _discover_kometa_backup_keys(paths)

    if rating_key:
        keys = [str(rating_key).strip()]
    else:
        keys = sorted(set(list(log.keys()) + backup_keys))

    orphan_backups = [k for k in keys if k not in log and k in backup_keys]
    if orphan_backups:
        _progress(
            progress,
            f"Recovering {len(orphan_backups)} stamped title(s) from Layer backups (log was incomplete)",
        )

    _progress(progress, f"Reverting {len(keys)} Layer overlay(s)…")
    reverted = 0
    failed: list[str] = []
    cleared_keys: list[str] = []
    logged_keys = set(log.keys())
    for key in keys:
        entry = log.get(key) or {"title": key, "hasBackup": True}
        try:
            ok = _restore_item(plex, paths, key, entry, progress)
            if key in log:
                del log[key]
            # Orphan rows are driven by backup files — force-clear even when Plex
            # restore already happened (or failed) so the UI can drop the row.
            _clear_backup(paths, key)
            cleared_keys.append(key)
            if ok:
                reverted += 1
            elif key not in logged_keys:
                # Stuck incomplete-run row: scrubbing the backup is enough.
                reverted += 1
                _progress(progress, f"Cleared stuck Layer backup for {entry.get('title') or key}")
            else:
                failed.append(f"{entry.get('title') or key}: restore failed")
        except Exception as exc:
            _clear_backup(paths, key)
            cleared_keys.append(key)
            failed.append(f"{entry.get('title') or key}: {exc}")
    _save_log(log_path, log)
    _progress(progress, f"Layer revert complete — {reverted}/{len(keys)} restored")
    return {
        "ok": True,
        "requested": len(keys),
        "reverted": reverted,
        "failed": failed,
        "remaining": len(log),
        "recoveredFromBackup": len(orphan_backups),
        "clearedKeys": cleared_keys,
        "finishedAt": datetime.now().isoformat(),
    }


def drop_kometa_family(
    config: dict,
    family: str,
    *,
    rule_id: str | None = None,
    rating_keys: list[str] | None = None,
    progress: ProgressFn | None = None,
) -> dict:
    """Remove one overlay family and restamp whatever is left from the backup.

    Collection overlay delete/revert uses this so 4K/HDR/etc. stay when Trending
    (or another custom collection badge) is taken off.
    """
    from core import _connect, _resolve_paths

    target = str(family or "").strip()
    if not target:
        return {
            "ok": False,
            "requested": 0,
            "dropped": 0,
            "restamped": 0,
            "reverted": 0,
            "failed": ["family is required"],
            "clearedKeys": [],
            "finishedAt": datetime.now().isoformat(),
        }

    rid = _normalize_label_name(rule_id)
    wanted_keys = [
        str(key or "").strip()
        for key in (rating_keys or [])
        if str(key or "").strip()
    ]

    paths = _resolve_paths(config)
    migrate_legacy_logs(paths, progress)
    plex = _connect(config)
    log_path = kometa_log_path(paths)
    log = _load_log(log_path)

    if wanted_keys:
        keys = [key for key in wanted_keys if key in log]
    else:
        keys = []
        for key, entry in log.items():
            winners = _winners_from_entry(entry if isinstance(entry, dict) else {})
            if any(_should_drop_winner(fam, winner, target, rid) for fam, winner in winners.items()):
                keys.append(key)

    label = rid or target
    _progress(progress, f"Dropping '{label}' from {len(keys)} title(s) — keeping other Layer overlays")

    dropped = 0
    restamped = 0
    reverted = 0
    failed: list[str] = []
    cleared_keys: list[str] = []

    for key in keys:
        entry = log.get(key) if isinstance(log.get(key), dict) else {"title": key}
        winners = _winners_from_entry(entry)
        remaining: dict[str, Winner] = {}
        matched = False
        for fam, winner in winners.items():
            if _should_drop_winner(fam, winner, target, rid):
                matched = True
                continue
            remaining[str(fam)] = winner
        if not matched:
            continue
        dropped += 1
        try:
            if remaining:
                updated = _restamp_item_winners(
                    plex, paths, config, key, entry, remaining, progress,
                )
                if updated is None:
                    _restore_item(plex, paths, key, entry, progress)
                    del log[key]
                    cleared_keys.append(key)
                    reverted += 1
                else:
                    log[key] = updated
                    restamped += 1
            else:
                _restore_item(plex, paths, key, entry, progress)
                del log[key]
                cleared_keys.append(key)
                reverted += 1
            _save_log(log_path, log)
        except Exception as exc:
            failed.append(f"{(entry or {}).get('title') or key}: {exc}")
            _progress(progress, f"Drop '{label}' failed for {key}: {exc}")

    _save_log(log_path, log)
    _progress(
        progress,
        f"Dropped '{label}' from {dropped} title(s) — restamped {restamped}, fully restored {reverted}",
    )
    return {
        "ok": True,
        "family": target,
        "ruleId": rid or None,
        "requested": len(keys),
        "dropped": dropped,
        "restamped": restamped,
        "reverted": reverted,
        "failed": failed,
        "remaining": len(log),
        "clearedKeys": cleared_keys,
        "finishedAt": datetime.now().isoformat(),
    }


def list_kometa_tracked(paths: dict) -> list[dict]:
    log = _load_log(kometa_log_path(paths))
    rows = []
    seen: set[str] = set()
    for key, entry in log.items():
        if not isinstance(entry, dict):
            continue
        seen.add(str(key))
        rows.append({
            "ratingKey": key,
            "title": entry.get("title") or key,
            "library": entry.get("library") or "",
            "itemType": entry.get("itemType") or "",
            "timestamp": entry.get("timestamp"),
            "previewOnly": bool(entry.get("preview_only")),
            "families": entry.get("families") or {},
            "hasBackup": bool(entry.get("hasBackup")) or _backup_file(paths, key).exists(),
            "orphanBackup": False,
        })
    # Surface mid-run timeout orphans so the UI can revert them.
    for key in _discover_kometa_backup_keys(paths):
        if key in seen:
            continue
        rows.append({
            "ratingKey": key,
            "title": key,
            "library": "",
            "itemType": "",
            "timestamp": None,
            "previewOnly": False,
            "families": {},
            "hasBackup": True,
            "orphanBackup": True,
        })
    rows.sort(key=lambda r: str(r.get("timestamp") or ""), reverse=True)
    return rows
