"""Jobsworm brand build, step 2: app icons from the cut-out mascot.

Every icon is Wormy centred on a slate-700 (#36484E) tile:

    favicon.ico          16/32/48 multi-size, rounded tile
    icon-192.png         rounded tile, mascot at 78%
    icon-512.png         rounded tile, mascot at 78%
    apple-touch-icon.png 180x180, SQUARE corners (iOS masks its own)
    icon-maskable-512    full-bleed square, mascot at 60% for the safe zone

The favicon is also copied over apps/web/app/favicon.ico, replacing the
Next.js default.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "apps" / "web" / "public" / "brand"
NEXT_APP_DIR = ROOT / "apps" / "web" / "app"
MASCOT = OUT_DIR / "mascot-1024.png"

SLATE_700 = (0x36, 0x48, 0x4E, 0xFF)
CORNER_RATIO = 0.22        # rounded-square radius as a fraction of the side
MASCOT_SCALE = 0.78        # standard icons
MASKABLE_SCALE = 0.60      # maskable icons must survive an aggressive crop
SUPERSAMPLE = 4            # render big, downsample - keeps the corners smooth


def log(msg: str) -> None:
    print(f"  [make_icons] {msg}", flush=True)


def tile(size: int, mascot: Image.Image, *, rounded: bool, scale: float) -> Image.Image:
    """Mascot centred on a slate-700 tile, rendered supersampled then reduced."""
    big = size * SUPERSAMPLE
    canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    if rounded:
        draw.rounded_rectangle(
            (0, 0, big - 1, big - 1),
            radius=int(round(big * CORNER_RATIO)),
            fill=SLATE_700,
        )
    else:
        draw.rectangle((0, 0, big - 1, big - 1), fill=SLATE_700)

    target = big * scale
    ratio = target / max(mascot.size)
    art = mascot.resize(
        (max(1, round(mascot.size[0] * ratio)), max(1, round(mascot.size[1] * ratio))),
        Image.LANCZOS,
    )
    canvas.alpha_composite(art, ((big - art.size[0]) // 2, (big - art.size[1]) // 2))
    return canvas.resize((size, size), Image.LANCZOS)


def main() -> int:
    if not MASCOT.exists():
        raise SystemExit(f"missing {MASCOT} - run remove_bg.py first")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    mascot = Image.open(MASCOT).convert("RGBA")
    log(f"source mascot {mascot.size[0]}x{mascot.size[1]}")

    # --- favicon.ico (16/32/48) --------------------------------------------
    ico_base = tile(256, mascot, rounded=True, scale=MASCOT_SCALE)
    ico_path = OUT_DIR / "favicon.ico"
    ico_base.save(ico_path, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    log(f"wrote {ico_path.name} (16/32/48)")

    shutil.copyfile(ico_path, NEXT_APP_DIR / "favicon.ico")
    log("copied favicon.ico over apps/web/app/favicon.ico (Next.js default)")

    # --- PNG icons ----------------------------------------------------------
    for name, size, rounded, scale in [
        ("icon-192.png", 192, True, MASCOT_SCALE),
        ("icon-512.png", 512, True, MASCOT_SCALE),
        ("apple-touch-icon.png", 180, False, MASCOT_SCALE),
        ("icon-maskable-512.png", 512, False, MASKABLE_SCALE),
    ]:
        img = tile(size, mascot, rounded=rounded, scale=scale)
        if name == "apple-touch-icon.png":
            # iOS composites onto its own background; ship it fully opaque.
            img = Image.alpha_composite(
                Image.new("RGBA", img.size, SLATE_700), img
            ).convert("RGB")
        img.save(OUT_DIR / name, "PNG", optimize=True)
        shape = "rounded" if rounded else "square"
        log(f"wrote {name} {size}x{size} ({shape}, mascot {scale:.0%})")

    return 0


if __name__ == "__main__":
    sys.exit(main())
