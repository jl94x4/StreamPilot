"""Kometa-parity overlay rendering + single-pass compositing.

Renders each winning family at Kometa's default coordinates on a 1000x1500
poster (normalized so any poster size works), with Kometa's backdrop specs
(back_color #00000099, 305x105 boxes, back_radius 30).
The Placement tab can still override any slot via config.placement.<slot>.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

from kometa_detect import Winner

# Kometa default back box (resolution/audio/status/streaming/network/video_format)
BACK_W, BACK_H = 305, 105
BACK_COLOR = (0, 0, 0, 153)  # #00000099
BACK_RADIUS = 30  # Kometa default back_radius

# Normalized slots on the 1000x1500 Kometa canvas.
# resolution 15/15 top-left · audio_codec top-center 15 · status 15/330 top-left
# streaming 15/390 bottom-left · network 15/510 bottom-left · video_format 15/30
# bottom-left · ribbon bottom-right full-bleed.
KOMETA_SLOTS: dict[str, dict[str, Any]] = {
    "resolution": {
        "x": 0.015, "y": 0.01, "width": 0.305, "maxHeight": 0.07,
        "anchorX": "left", "anchorY": "top", "bottomClip": 0.0,
    },
    "edition": {
        "x": 0.015, "y": 0.09, "width": 0.305, "maxHeight": 0.07,
        "anchorX": "left", "anchorY": "top", "bottomClip": 0.0,
    },
    "audio_codec": {
        "x": 0.5, "y": 0.01, "width": 0.305, "maxHeight": 0.07,
        "anchorX": "center", "anchorY": "top", "bottomClip": 0.0,
    },
    "status": {
        "x": 0.015, "y": 0.22, "width": 0.305, "maxHeight": 0.07,
        "anchorX": "left", "anchorY": "top", "bottomClip": 0.0,
    },
    "ratings": {
        "x": 0.985, "y": 0.5, "width": 0.16, "maxHeight": 0.14,
        "anchorX": "right", "anchorY": "center", "bottomClip": 0.0,
    },
    "streaming": {
        "x": 0.015, "y": 0.74, "width": 0.305, "maxHeight": 0.07,
        "anchorX": "left", "anchorY": "bottom", "bottomClip": 0.0,
    },
    "network": {
        "x": 0.015, "y": 0.66, "width": 0.305, "maxHeight": 0.07,
        "anchorX": "left", "anchorY": "bottom", "bottomClip": 0.0,
    },
    "video_format": {
        "x": 0.015, "y": 0.98, "width": 0.305, "maxHeight": 0.07,
        "anchorX": "left", "anchorY": "bottom", "bottomClip": 0.0,
    },
    "ribbon": {
        "x": 1.0, "y": 1.0, "width": 0.25, "maxHeight": 0.25,
        "anchorX": "right", "anchorY": "bottom", "bottomClip": 0.0,
    },
    # Stage 4/5 families
    "aspect": {
        "x": 0.5, "y": 0.90, "width": 0.305, "maxHeight": 0.07,
        "anchorX": "center", "anchorY": "bottom", "bottomClip": 0.0,
    },
    "versions": {
        "x": 0.985, "y": 0.223, "width": 0.105, "maxHeight": 0.07,
        "anchorX": "right", "anchorY": "top", "bottomClip": 0.0,
    },
    "language_count": {
        "x": 0.5, "y": 0.98, "width": 0.188, "maxHeight": 0.07,
        "anchorX": "center", "anchorY": "bottom", "bottomClip": 0.0,
    },
    "languages": {
        "x": 0.015, "y": 0.30, "width": 0.09, "maxHeight": 0.28,
        "anchorX": "left", "anchorY": "top", "bottomClip": 0.0,
    },
    "runtimes": {
        "x": 0.985, "y": 0.98, "width": 0.45, "maxHeight": 0.07,
        "anchorX": "right", "anchorY": "bottom", "bottomClip": 0.0,
    },
    "direct_play": {
        "x": 0.5, "y": 0.90, "width": 0.305, "maxHeight": 0.113,
        "anchorX": "center", "anchorY": "bottom", "bottomClip": 0.0,
    },
    "content_rating": {
        "x": 0.015, "y": 0.82, "width": 0.305, "maxHeight": 0.07,
        "anchorX": "left", "anchorY": "bottom", "bottomClip": 0.0,
    },
    "mediastinger": {
        "x": 0.80, "y": 0.01, "width": 0.105, "maxHeight": 0.07,
        "anchorX": "right", "anchorY": "top", "bottomClip": 0.0,
    },
    "episode_info": {
        "x": 0.015, "y": 0.02, "width": 0.305, "maxHeight": 0.12,
        "anchorX": "left", "anchorY": "top", "bottomClip": 0.0,
    },
    "custom_collection": {
        # Inset from the corner — Plex UI rounds poster tiles and clips flush badges.
        "x": 0.94, "y": 0.035, "width": 0.12, "maxHeight": 0.09,
        "anchorX": "right", "anchorY": "top", "bottomClip": 0.0,
    },
}

# Family slot → legacy Placement-tab key so existing user offsets keep working.
LEGACY_PLACEMENT_KEYS = {
    "resolution": "media",
    "status": "status",
    "ratings": "ratings",
    "network": "network",
}

# Compositing order: bottom-most families first so stacked slots layer sanely.
FAMILY_RENDER_ORDER = [
    "ribbon",
    "network",
    "streaming",
    "content_rating",
    "video_format",
    "runtimes",
    "language_count",
    "aspect",
    "direct_play",
    "ratings",
    "languages",
    "status",
    "versions",
    "mediastinger",
    "audio_codec",
    "resolution",
    "edition",
    "episode_info",
    "custom_collection",
]

# EXIF marker Kometa writes on stamped art (tag 0x04BC = "overlay").
EXIF_OVERLAY_TAG = 0x04BC
EXIF_OVERLAY_VALUE = "overlay"


def _as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def slot_placement(config: dict | None, slot: str) -> dict:
    """Kometa default slot, overridable via config.placement (new key or legacy)."""
    defaults = dict(KOMETA_SLOTS.get(slot) or KOMETA_SLOTS["resolution"])
    raw_root = (config or {}).get("placement") if isinstance(config, dict) else None
    raw = {}
    if isinstance(raw_root, dict):
        candidate = raw_root.get(slot)
        if not isinstance(candidate, dict) or not candidate:
            legacy = LEGACY_PLACEMENT_KEYS.get(slot)
            candidate = raw_root.get(legacy) if legacy else None
        raw = candidate if isinstance(candidate, dict) else {}
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


def _backdrop(width: int = BACK_W, height: int = BACK_H, radius: int = BACK_RADIUS) -> Image.Image:
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # Cap radius so small plates (e.g. 105x105) still look rounded, not circular.
    radius = max(0, min(int(radius), width // 2, height // 2))
    if radius > 0:
        draw.rounded_rectangle([0, 0, width - 1, height - 1], radius=radius, fill=BACK_COLOR)
    else:
        draw.rectangle([0, 0, width - 1, height - 1], fill=BACK_COLOR)
    return img


def _image_on_backdrop(
    rel: str,
    *,
    paths: dict | None,
    radius: int = BACK_RADIUS,
    pad: int = 12,
    width: int = BACK_W,
    height: int = BACK_H,
) -> Image.Image | None:
    from kometa_images import load_image

    logo = load_image(rel, paths=paths)
    if logo is None:
        return None
    plate = _backdrop(width, height, radius=radius)
    max_w, max_h = width - pad * 2, height - pad * 2
    if logo.width > max_w or logo.height > max_h:
        scale = min(max_w / logo.width, max_h / logo.height)
        logo = logo.resize((max(1, int(logo.width * scale)), max(1, int(logo.height * scale))), Image.LANCZOS)
    plate.alpha_composite(logo, ((width - logo.width) // 2, (height - logo.height) // 2))
    return plate


def _text_on_backdrop(
    text: str,
    *,
    paths: dict | None,
    font_size: int = 50,
    radius: int = BACK_RADIUS,
    width: int = BACK_W,
    height: int = BACK_H,
    addon_rel: str | None = None,
) -> Image.Image:
    """Text (optionally with a logo addon on the left) centered on a backdrop."""
    from kometa_images import ensure_font, load_image

    plate = _backdrop(width, height, radius=radius)
    draw = ImageDraw.Draw(plate)
    font = ensure_font(paths=paths, size=font_size, weight="medium")
    label = str(text or "").strip() or "—"

    addon = None
    addon_w = 0
    if addon_rel:
        addon = load_image(addon_rel, paths=paths)
        if addon is not None:
            max_logo_h = height - 24
            if addon.height > max_logo_h:
                scale = max_logo_h / addon.height
                addon = addon.resize((max(1, int(addon.width * scale)), max(1, int(addon.height * scale))), Image.LANCZOS)
            addon_w = addon.width + 15

    avail = width - 20 - addon_w
    bb = draw.textbbox((0, 0), label, font=font)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    if tw > avail:
        scale = avail / tw
        font = ensure_font(paths=paths, size=max(20, int(font_size * scale)), weight="medium")
        bb = draw.textbbox((0, 0), label, font=font)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
    total_w = tw + addon_w
    left = (width - total_w) / 2
    if addon is not None:
        plate.alpha_composite(addon, (int(left), (height - addon.height) // 2))
        left += addon_w
    draw.text((left - bb[0], (height - th) / 2 - bb[1]), label, font=font, fill=(255, 255, 255, 255))
    return plate


def render_winner(winner: Winner, *, config: dict | None, paths: dict | None) -> Image.Image | None:
    """One badge image for a winning variant, per Kometa's default styles."""
    family = winner.family

    if family in {"resolution", "edition"}:
        rel = winner.image_rel or ""
        badge = _image_on_backdrop(rel, paths=paths)
        if badge is not None:
            return badge
        # Offline fallback — text with the Kometa variant name
        return _text_on_backdrop(winner.name.replace("-", " "), paths=paths)

    if family == "audio_codec":
        style = str((config or {}).get("audioCodecStyle") or (config or {}).get("audio_codec_style") or "compact").strip().lower()
        if style not in {"compact", "standard"}:
            style = "compact"
        badge = _image_on_backdrop(f"audio_codec/{style}/{winner.key}.png", paths=paths)
        if badge is not None:
            return badge
        return _text_on_backdrop(winner.name.replace("-", " "), paths=paths)

    if family == "video_format":
        return _text_on_backdrop(winner.text or winner.name, paths=paths)

    if family == "status":
        return _text_on_backdrop(str(winner.text or winner.name).upper(), paths=paths)

    if family == "ratings":
        slots = (winner.extra or {}).get("slots") if winner.extra else None
        if slots:
            return _render_rating_column(slots, paths=paths)
        from modes_kometa import render_rating_badge

        try:
            score = float(winner.text or 0)
        except (TypeError, ValueError):
            score = 0.0
        source = str((config or {}).get("ratingsSource") or (config or {}).get("ratings_source") or "tmdb")
        return render_rating_badge(score, paths=paths, source=source)

    if family == "network":
        from modes_kometa import render_network_badge

        return render_network_badge(winner.text or winner.name, paths=paths)

    if family == "streaming":
        badge = _image_on_backdrop(winner.image_rel or f"streaming/color/{winner.name}.png", paths=paths)
        if badge is not None:
            return badge
        return _text_on_backdrop(winner.name.replace("-", " "), paths=paths)

    if family in {"aspect", "runtimes", "episode_info"}:
        width = 600 if family == "runtimes" else BACK_W
        size = 63 if family == "aspect" else 50
        return _text_on_backdrop(winner.text or winner.name, paths=paths, font_size=size, width=width)

    if family in {"versions", "mediastinger"}:
        badge = _image_on_backdrop(winner.image_rel or "", paths=paths, width=105, height=105, pad=8)
        if badge is not None:
            return badge
        return _text_on_backdrop(winner.name, paths=paths, width=105, height=105)

    if family == "language_count":
        badge = _image_on_backdrop(winner.image_rel or "", paths=paths, width=188, height=105)
        if badge is not None:
            return badge
        return _text_on_backdrop(winner.name.replace("-", " "), paths=paths, width=188, height=105)

    if family == "languages":
        flags = (winner.extra or {}).get("flags") if winner.extra else None
        if flags:
            style = str((config or {}).get("kometaFlagStyle") or (config or {}).get("kometa_flag_style") or "round").strip().lower()
            if style not in {"round", "square"}:
                style = "round"
            stack = _render_flag_stack(flags, style=style, paths=paths)
            if stack is not None:
                return stack
        return None

    if family == "direct_play":
        badge = _image_on_backdrop(winner.image_rel or "Direct-Play.png", paths=paths, width=BACK_W, height=170)
        if badge is not None:
            return badge
        return _text_on_backdrop("DIRECT PLAY", paths=paths)

    if family == "content_rating":
        addon = (winner.extra or {}).get("addon") if winner.extra else None
        if addon:  # commonsense — age text + Commonsense logo
            return _text_on_backdrop(winner.text or winner.name, paths=paths, font_size=63, addon_rel=addon)
        badge = _image_on_backdrop(winner.image_rel or "", paths=paths)
        if badge is not None:
            return badge
        return _text_on_backdrop(winner.name, paths=paths)

    if family == "ribbon":
        from kometa_images import load_image

        return load_image(winner.image_rel or "", paths=paths)

    if family == "custom_collection":
        # Single uploaded PNG badge (no stacking — first collection rule wins).
        rel = str(winner.image_rel or "").strip()
        if rel:
            path = Path(rel)
            if path.is_file():
                try:
                    return Image.open(path).convert("RGBA")
                except Exception:
                    pass
            from kometa_images import load_image

            badge = load_image(rel, paths=paths)
            if badge is not None:
                return badge
        custom_dir = Path((paths or {}).get("customPresets") or "")
        key = str(winner.key or "").strip()
        if key and custom_dir:
            hit = custom_dir / (key if key.lower().endswith(".png") else f"{key}.png")
            if hit.is_file():
                try:
                    return Image.open(hit).convert("RGBA")
                except Exception:
                    pass
        # Legacy stacked logs: use the first badge only.
        badges = (winner.extra or {}).get("badges") if isinstance(winner.extra, dict) else None
        if isinstance(badges, list) and badges:
            first = badges[0] if isinstance(badges[0], dict) else None
            if first:
                for cand in (first.get("imagePath"), first.get("image")):
                    text = str(cand or "").strip()
                    if not text:
                        continue
                    path = Path(text)
                    if path.is_file():
                        try:
                            return Image.open(path).convert("RGBA")
                        except Exception:
                            pass
        return _text_on_backdrop(str(winner.text or winner.name).upper(), paths=paths)

    return None


def _render_flag_stack(flags: list[dict], *, style: str, paths: dict | None) -> Image.Image | None:
    """Vertical stack of language flag badges (languages.yml)."""
    from kometa_images import load_image

    size, gap = 90, 15
    images: list[Image.Image] = []
    for flag in flags:
        img = load_image(f"flag/{style}/{flag.get('country')}.png", paths=paths)
        if img is None:
            continue
        if img.width != size or img.height != size:
            img = img.resize((size, size), Image.LANCZOS)
        images.append(img)
    if not images:
        return None
    stack = Image.new("RGBA", (size, size * len(images) + gap * (len(images) - 1)), (0, 0, 0, 0))
    y = 0
    for img in images:
        stack.alpha_composite(img, (0, y))
        y += size + gap
    return stack


def _render_rating_column(slots: list[dict], *, paths: dict | None) -> Image.Image | None:
    """Kometa ratings.yml style: up to three 160x160 badges (logo over score)."""
    from kometa_images import ensure_font, load_image

    box, gap, radius = 160, 45, BACK_RADIUS
    badges: list[Image.Image] = []
    for slot in slots[:3]:
        image_name = str(slot.get("image") or "").strip()
        label = str(slot.get("label") or "").strip()
        plate = _backdrop(box, box, radius=radius)
        logo = load_image(f"rating/{image_name}.png", paths=paths) if image_name else None
        top_h = box // 2
        if logo is not None:
            max_h = top_h - 16
            if logo.height > max_h or logo.width > box - 24:
                scale = min(max_h / logo.height, (box - 24) / logo.width)
                logo = logo.resize((max(1, int(logo.width * scale)), max(1, int(logo.height * scale))), Image.LANCZOS)
            plate.alpha_composite(logo, ((box - logo.width) // 2, (top_h - logo.height) // 2 + 6))
        draw = ImageDraw.Draw(plate)
        font = ensure_font(paths=paths, size=56, weight="bold")
        bb = draw.textbbox((0, 0), label, font=font)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        if tw > box - 16:
            font = ensure_font(paths=paths, size=max(24, int(56 * (box - 16) / tw)), weight="bold")
            bb = draw.textbbox((0, 0), label, font=font)
            tw, th = bb[2] - bb[0], bb[3] - bb[1]
        draw.text(((box - tw) / 2 - bb[0], top_h + (top_h - th) / 2 - bb[1]), label, font=font, fill=(255, 255, 255, 255))
        badges.append(plate)
    if not badges:
        return None
    column = Image.new("RGBA", (box, box * len(badges) + gap * (len(badges) - 1)), (0, 0, 0, 0))
    y = 0
    for badge in badges:
        column.alpha_composite(badge, (0, y))
        y += box + gap
    return column


def _placement_for_family(family: str, winners: dict[str, Winner], config: dict | None) -> dict:
    placement = slot_placement(config, family)
    if family == "edition" and "resolution" not in winners:
        # Without a resolution badge the edition takes the top-left slot.
        placement = {**placement, "y": slot_placement(config, "resolution")["y"]}
    return placement


def _slot_collision_key(placement: dict) -> tuple:
    return (
        round(float(placement.get("x") or 0), 3),
        round(float(placement.get("y") or 0), 3),
        str(placement.get("anchorX") or "").strip().lower(),
        str(placement.get("anchorY") or "").strip().lower(),
    )


def select_compose_winners(
    winners: dict[str, Winner],
    config: dict | None = None,
) -> dict[str, Winner]:
    """Keep independent families; if two share a slot, the higher weight wins."""
    best: dict[tuple, tuple[str, Winner]] = {}
    for family in FAMILY_RENDER_ORDER:
        winner = winners.get(family)
        if winner is None:
            continue
        key = _slot_collision_key(_placement_for_family(family, winners, config))
        existing = best.get(key)
        if existing is None or int(winner.weight or 0) > int(existing[1].weight or 0):
            best[key] = (family, winner)
    return {family: winner for family, winner in best.values()}


def compose_poster(
    poster: Image.Image,
    winners: dict[str, Winner],
    *,
    config: dict | None,
    paths: dict | None,
) -> Image.Image:
    """Composite ALL winning overlays onto the original poster in one pass."""
    from core import _apply_with_placement

    result = poster.convert("RGBA")
    selected = select_compose_winners(winners, config)
    for family in FAMILY_RENDER_ORDER:
        winner = selected.get(family)
        if winner is None:
            continue
        badge = render_winner(winner, config=config, paths=paths)
        if badge is None:
            continue
        placement = _placement_for_family(family, winners, config)
        result = _apply_with_placement(result, badge, placement)
    return result


def exif_with_overlay_marker(img: Image.Image):
    """EXIF payload carrying Kometa's 0x04BC='overlay' marker."""
    exif = img.getexif()
    exif[EXIF_OVERLAY_TAG] = EXIF_OVERLAY_VALUE
    return exif


def has_overlay_marker(img: Image.Image) -> bool:
    try:
        exif = img.getexif()
        return str(exif.get(EXIF_OVERLAY_TAG, "") or "").strip().lower() == EXIF_OVERLAY_VALUE
    except Exception:
        return False


def save_with_marker(img: Image.Image, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGBA").save(dest, format="PNG", exif=exif_with_overlay_marker(img))
