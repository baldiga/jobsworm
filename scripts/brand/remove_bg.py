"""Jobsworm brand build, step 1: cut Wormy out of the flat JPEG logo.

Strategy
--------
The source art (docs/brand/Logo.jpeg) sits on a flat near-white background, but
white also appears *inside* the artwork: the eye whites and, most importantly,
the magnifying-glass lens. A naive "delete every near-white pixel" pass would
punch holes straight through Wormy's lens and eye.

So we do a border-seeded BFS flood fill instead: build the near-white mask,
seed a breadth-first search from every near-white pixel touching the image
edge, and only clear alpha on the region the search can actually reach. Whites
enclosed by darker outlines (lens, eye) are unreachable and survive.

Outputs (apps/web/public/brand/):
    mascot-1024.png  mascot-512.png  mascot-256.png
    mascot-128.png   mascot-64.png   mascot-32.png
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "docs" / "brand" / "Logo.jpeg"
OUT_DIR = ROOT / "apps" / "web" / "public" / "brand"

WHITE_THRESHOLD = 225      # min(R,G,B) must exceed this to count as background
FEATHER_RADIUS = 0.8       # px of Gaussian blur applied to the alpha edge
PAD_FRACTION = 0.02        # 2% breathing room around the alpha bounding box
SIZES = [1024, 512, 256, 128, 64, 32]


def log(msg: str) -> None:
    print(f"  [remove_bg] {msg}", flush=True)


def border_flood_fill(mask: np.ndarray) -> np.ndarray:
    """Breadth-first flood fill of `mask` seeded from all four image edges.

    Returns a boolean array of the mask pixels reachable from the border via
    4-connectivity. Implemented as a vectorised wavefront (level-order BFS):
    each iteration expands the frontier by exactly one pixel in all four
    directions, which is the same traversal order as a queue-based BFS but
    runs one whole level per numpy pass.
    """
    h, w = mask.shape
    filled = np.zeros_like(mask)

    # Seed: every near-white pixel sitting on the outer border.
    seed = np.zeros_like(mask)
    seed[0, :] = mask[0, :]
    seed[h - 1, :] = mask[h - 1, :]
    seed[:, 0] = mask[:, 0]
    seed[:, w - 1] = mask[:, w - 1]

    frontier = seed
    filled |= frontier
    levels = 0
    while frontier.any():
        nxt = np.zeros_like(mask)
        nxt[1:, :] |= frontier[:-1, :]   # down
        nxt[:-1, :] |= frontier[1:, :]   # up
        nxt[:, 1:] |= frontier[:, :-1]   # right
        nxt[:, :-1] |= frontier[:, 1:]   # left
        nxt &= mask
        nxt &= ~filled
        filled |= nxt
        frontier = nxt
        levels += 1
        if levels > h + w + 16:  # cannot happen; guards against a logic slip
            raise RuntimeError("flood fill did not terminate")
    log(f"flood fill converged after {levels} BFS levels")
    return filled


def alpha_bbox(alpha: np.ndarray) -> tuple[int, int, int, int]:
    rows = np.where(alpha.any(axis=1))[0]
    cols = np.where(alpha.any(axis=0))[0]
    if rows.size == 0 or cols.size == 0:
        raise RuntimeError("alpha channel is empty - nothing survived the cut")
    return int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1


def main() -> int:
    if not SRC.exists():
        raise SystemExit(f"source logo not found: {SRC}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    src = Image.open(SRC).convert("RGB")
    log(f"loaded {SRC.name} {src.size[0]}x{src.size[1]}")
    rgb = np.array(src)

    mask = rgb.min(axis=2) > WHITE_THRESHOLD
    log(f"near-white pixels: {mask.mean() * 100:.1f}% of the frame")

    background = border_flood_fill(mask)
    enclosed = int(mask.sum() - background.sum())
    log(f"background removed: {background.mean() * 100:.1f}%; "
        f"{enclosed} enclosed white pixels preserved (lens + eye whites)")

    alpha = np.where(background, 0, 255).astype(np.uint8)
    alpha_img = Image.fromarray(alpha, mode="L").filter(
        ImageFilter.GaussianBlur(radius=FEATHER_RADIUS)
    )
    log(f"feathered alpha with a {FEATHER_RADIUS}px Gaussian blur")

    cut = Image.merge("RGBA", (*src.split(), alpha_img))

    x0, y0, x1, y1 = alpha_bbox(np.array(alpha_img) > 0)
    pad = int(round(max(x1 - x0, y1 - y0) * PAD_FRACTION))
    box = (x0 - pad, y0 - pad, x1 + pad, y1 + pad)
    cut = cut.crop(box)  # PIL pads out-of-bounds crops with transparency
    log(f"cropped to alpha bbox +{PAD_FRACTION:.0%} padding -> "
        f"{cut.size[0]}x{cut.size[1]}")

    scale = SIZES[0] / max(cut.size)
    master = cut.resize(
        (max(1, round(cut.size[0] * scale)), max(1, round(cut.size[1] * scale))),
        Image.LANCZOS,
    )

    for size in SIZES:
        if size == SIZES[0]:
            img = master
        else:
            s = size / max(master.size)
            img = master.resize(
                (max(1, round(master.size[0] * s)), max(1, round(master.size[1] * s))),
                Image.LANCZOS,
            )
        path = OUT_DIR / f"mascot-{size}.png"
        img.save(path, "PNG", optimize=True)
        log(f"wrote {path.name} {img.size[0]}x{img.size[1]}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
