"""Crop StreamPilot mark and emit TV splash + Fire TV launcher assets."""
from __future__ import annotations

import os
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "plex-client" / "android" / "app" / "src" / "main" / "res"
LOGO = ROOT / "static" / "logo.png"
BG = (7, 8, 12, 255)  # #07080C


def crop_badge(src: Image.Image) -> Image.Image:
    """Keep the full circular mark. A tight opaque-pixel crop clipped the badge."""
    rgba = src.convert("RGBA")
    w, h = rgba.size
    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.alpha_composite(rgba, ((side - w) // 2, (side - h) // 2))
    return canvas


def fit_on(canvas_size: int, badge: Image.Image, fill: float, bg=BG) -> Image.Image:
    canvas = Image.new("RGBA", (canvas_size, canvas_size), bg)
    inner = max(1, int(round(canvas_size * fill)))
    mark = badge.resize((inner, inner), Image.Resampling.LANCZOS)
    off = (canvas_size - inner) // 2
    canvas.alpha_composite(mark, (off, off))
    return canvas


def save(im: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Fire OS drops alpha banners and density-scaled tiles. Leanback wants an
    # opaque 8-bit PNG at the exact pixel size we wrote.
    out = im.convert("RGB") if path.name == "tv_banner.png" else im
    out.save(path, "PNG", optimize=True)
    print(f"wrote {path.relative_to(ROOT)} {out.size} {out.mode}")


def make_banner(badge: Image.Image, width: int, height: int) -> Image.Image:
    """Fire TV home row: exactly 320x180, opaque, mark filling the tile."""
    from PIL import ImageDraw, ImageFilter

    canvas = Image.new("RGB", (width, height), (14, 10, 8))
    glow = Image.new("L", (width, height), 0)
    ImageDraw.Draw(glow).ellipse(
        (int(width * 0.12), int(height * -0.18), int(width * 0.88), int(height * 1.18)),
        fill=255,
    )
    glow = glow.filter(ImageFilter.GaussianBlur(max(8, height // 10)))
    amber = Image.new("RGB", (width, height), (196, 98, 12))
    canvas = Image.composite(amber, canvas, glow)
    inner = int(round(height * 0.92))
    mark = badge.resize((inner, inner), Image.Resampling.LANCZOS).convert("RGBA")
    canvas = canvas.convert("RGBA")
    canvas.alpha_composite(mark, ((width - inner) // 2, (height - inner) // 2))
    return canvas.convert("RGB")


def make_splash(badge: Image.Image, width: int, height: int, logo_ratio: float = 0.22) -> Image.Image:
    canvas = Image.new("RGBA", (width, height), BG)
    inner = max(64, int(round(min(width, height) * logo_ratio)))
    mark = badge.resize((inner, inner), Image.Resampling.LANCZOS)
    canvas.alpha_composite(mark, ((width - inner) // 2, (height - inner) // 2))
    return canvas


def main() -> None:
    badge = crop_badge(Image.open(LOGO))
    print("badge", badge.size)

    save(fit_on(420, badge, 0.9), RES / "drawable-nodpi" / "splash_icon.png")

    launcher = {
        "mdpi": 48,
        "hdpi": 72,
        "xhdpi": 96,
        "xxhdpi": 144,
        "xxxhdpi": 192,
    }
    foreground = {
        "mdpi": 108,
        "hdpi": 162,
        "xhdpi": 216,
        "xxhdpi": 324,
        "xxxhdpi": 432,
    }
    for dens, size in launcher.items():
        icon = fit_on(size, badge, 1.0)
        save(icon, RES / f"mipmap-{dens}" / "ic_launcher.png")
        save(icon, RES / f"mipmap-{dens}" / "ic_launcher_round.png")
    for dens, size in foreground.items():
        # Fill the adaptive mask so Fire OS does not show a blank black tile.
        save(fit_on(size, badge, 0.84, bg=(0, 0, 0, 0)), RES / f"mipmap-{dens}" / "ic_launcher_foreground.png")

    # Fire TV: 320x180 px, no density buckets (those get scaled and the tile goes blank).
    banner = make_banner(badge, 320, 180)
    save(banner, RES / "drawable" / "tv_banner.png")
    save(banner, RES / "drawable-nodpi" / "tv_banner.png")
    for dens in ("mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"):
        stale = RES / f"drawable-{dens}" / "tv_banner.png"
        if stale.exists():
            stale.unlink()
            print(f"removed {stale.relative_to(ROOT)}")

    splashes = {
        "drawable": (480, 320, 0.42),
        "drawable-land-mdpi": (480, 320, 0.4),
        "drawable-land-hdpi": (800, 480, 0.4),
        "drawable-land-xhdpi": (1280, 720, 0.38),
        "drawable-land-xxhdpi": (1600, 960, 0.38),
        "drawable-land-xxxhdpi": (1920, 1080, 0.36),
        "drawable-port-mdpi": (320, 480, 0.42),
        "drawable-port-hdpi": (480, 800, 0.4),
        "drawable-port-xhdpi": (720, 1280, 0.38),
        "drawable-port-xxhdpi": (960, 1600, 0.38),
        "drawable-port-xxxhdpi": (1280, 1920, 0.36),
    }
    for folder, (w, h, ratio) in splashes.items():
        save(make_splash(badge, w, h, ratio), RES / folder / "splash.png")


if __name__ == "__main__":
    os.chdir(ROOT)
    main()
