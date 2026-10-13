"""Emit splash, Fire TV banner, launcher, and PWA icons from brand logos.

- static/logo.png      → wide wordmark (banners / splash)
- static/logo-app.png  → stacked square mark (launcher / PWA)
"""
from __future__ import annotations

import os
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "plex-client" / "android" / "app" / "src" / "main" / "res"
STATIC = ROOT / "static"
LOGO = STATIC / "logo.png"
LOGO_APP = STATIC / "logo-app.png"
BG = (0, 0, 0, 255)  # match stacked app mark plate


def load_logo(path: Path = LOGO) -> Image.Image:
    rgba = Image.open(path).convert("RGBA")
    bbox = rgba.getbbox()
    if bbox:
        rgba = rgba.crop(bbox)
    return rgba


def contained(logo: Image.Image, max_w: int, max_h: int) -> Image.Image:
    scale = min(max_w / max(1, logo.width), max_h / max(1, logo.height))
    size = (
        max(1, int(round(logo.width * scale))),
        max(1, int(round(logo.height * scale))),
    )
    return logo.resize(size, Image.Resampling.LANCZOS)


def paste_center(canvas: Image.Image, mark: Image.Image) -> Image.Image:
    x = (canvas.width - mark.width) // 2
    y = (canvas.height - mark.height) // 2
    if canvas.mode != "RGBA":
        canvas = canvas.convert("RGBA")
    canvas.alpha_composite(mark, (x, y))
    return canvas


def save(im: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    out = im.convert("RGB") if path.name == "tv_banner.png" else im
    out.save(path, "PNG", optimize=True)
    print(f"wrote {path.relative_to(ROOT)} {out.size} {out.mode}")


def make_banner(logo: Image.Image, width: int, height: int) -> Image.Image:
    canvas = Image.new("RGBA", (width, height), (14, 10, 8, 255))
    mark = contained(logo, int(width * 0.94), int(height * 0.62))
    return paste_center(canvas, mark).convert("RGB")


def make_splash(logo: Image.Image, width: int, height: int, width_frac: float, height_frac: float) -> Image.Image:
    canvas = Image.new("RGBA", (width, height), BG)
    mark = contained(logo, int(width * width_frac), int(height * height_frac))
    return paste_center(canvas, mark)


def make_square(logo: Image.Image, size: int, fill: float, bg=BG) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), bg)
    inner = max(1, int(round(size * fill)))
    mark = contained(logo, inner, inner)
    return paste_center(canvas, mark)


def main() -> None:
    logo = load_logo(LOGO)
    # Prefer stacked square mark for launchers / PWA; fall back to wide wordmark.
    app_path = LOGO_APP if LOGO_APP.exists() else LOGO
    app = load_logo(app_path)
    print("logo", logo.size, "app", app.size, app_path.name)

    save(make_square(app, 420, 0.92), RES / "drawable-nodpi" / "splash_icon.png")

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
        icon = make_square(app, size, 0.92)
        save(icon, RES / f"mipmap-{dens}" / "ic_launcher.png")
        save(icon, RES / f"mipmap-{dens}" / "ic_launcher_round.png")
    for dens, size in foreground.items():
        save(make_square(app, size, 0.78, bg=(0, 0, 0, 0)), RES / f"mipmap-{dens}" / "ic_launcher_foreground.png")

    banner = make_banner(logo, 320, 180)
    save(banner, RES / "drawable" / "tv_banner.png")
    save(banner, RES / "drawable-nodpi" / "tv_banner.png")
    for dens in ("mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"):
        stale = RES / f"drawable-{dens}" / "tv_banner.png"
        if stale.exists():
            stale.unlink()
            print(f"removed {stale.relative_to(ROOT)}")

    splashes = {
        "drawable": (480, 320, 0.78, 0.34),
        "drawable-land-mdpi": (480, 320, 0.78, 0.34),
        "drawable-land-hdpi": (800, 480, 0.72, 0.32),
        "drawable-land-xhdpi": (1280, 720, 0.68, 0.30),
        "drawable-land-xxhdpi": (1600, 960, 0.66, 0.28),
        "drawable-land-xxxhdpi": (1920, 1080, 0.62, 0.26),
        "drawable-port-mdpi": (320, 480, 0.86, 0.22),
        "drawable-port-hdpi": (480, 800, 0.84, 0.20),
        "drawable-port-xhdpi": (720, 1280, 0.82, 0.18),
        "drawable-port-xxhdpi": (960, 1600, 0.80, 0.16),
        "drawable-port-xxxhdpi": (1280, 1920, 0.78, 0.14),
    }
    for folder, (w, h, wf, hf) in splashes.items():
        save(make_splash(logo, w, h, wf, hf), RES / folder / "splash.png")

    # Full stacked mark on black — used when PWA icon source is Application
    # (or as fallback when server branding is unavailable).
    for size, fill, name in (
        (192, 1.0, "pwa-icon-192.png"),
        (512, 1.0, "pwa-icon-512.png"),
        (512, 0.88, "pwa-icon-maskable-512.png"),
    ):
        save(make_square(app, size, fill, bg=BG), STATIC / name)


if __name__ == "__main__":
    os.chdir(ROOT)
    main()
