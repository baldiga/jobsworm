"""Jobsworm brand build, step 3: the "Jobsworm" wordmark and lockups.

The wordmark is set in Karantina Bold. We do NOT ship the font inside the SVG:
fontTools walks the glyph outlines and emits one <path> per letter, so
wordmark.svg is pure geometry, colourable with `fill="currentColor"`, and free
of any font-loading dependency.

Outputs (apps/web/public/brand/):
    wordmark.svg          outlined, currentColor, no embedded font
    wordmark-light.png    slate-700 #36484E on transparent
    wordmark-dark.png     off-white #F6F8F9 on transparent
    lockup-light.png      mascot (left) + 40px gap + light wordmark
    lockup-dark.png       mascot (left) + 40px gap + dark wordmark
"""

from __future__ import annotations

import re
import sys
import urllib.request
from pathlib import Path
from xml.etree import ElementTree

from fontTools.misc.transform import Transform
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "apps" / "web" / "public" / "brand"
CACHE = Path(__file__).resolve().parent / ".cache"
FONT_PATH = CACHE / "karantina-bold.ttf"

FONT_URL = "https://fonts.gstatic.com/s/karantina/v13/buExpo24ccnh31GVMABxTC8f-A.ttf"
CSS_URL = "https://fonts.googleapis.com/css2?family=Karantina:wght@700&display=swap"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

WORD = "Jobsworm"
LIGHT_INK = "#36484E"   # slate-700, for light backgrounds
DARK_INK = "#F6F8F9"    # bg-light, for dark backgrounds

PNG_FONT_SIZE = 300     # standalone wordmark render size
MASCOT_HEIGHT = 300     # lockup mascot height in px
LOCKUP_GAP = 40         # px between mascot and wordmark
LOCKUP_WORDMARK_H = 132 # ink height of the wordmark inside the lockup


def log(msg: str) -> None:
    print(f"  [make_wordmark] {msg}", flush=True)


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def resolve_font_url() -> str:
    """Re-derive the TTF url from the Google Fonts CSS if the pinned one dies."""
    css = fetch(CSS_URL).decode("utf-8", "replace")
    match = re.search(r"src:\s*url\((https://[^)]+)\)", css)
    if not match:
        raise SystemExit("could not parse a font url out of the Karantina CSS")
    return match.group(1)


def ensure_font() -> Path:
    if FONT_PATH.exists() and FONT_PATH.stat().st_size > 1000:
        log(f"using cached font {FONT_PATH.name} ({FONT_PATH.stat().st_size} bytes)")
        return FONT_PATH
    CACHE.mkdir(parents=True, exist_ok=True)
    try:
        data = fetch(FONT_URL)
        log(f"downloaded Karantina Bold from the pinned url ({len(data)} bytes)")
    except Exception as exc:  # noqa: BLE001 - any failure means: re-resolve
        log(f"pinned url failed ({exc}); re-resolving via the CSS API")
        data = fetch(resolve_font_url())
        log(f"downloaded Karantina Bold from the resolved url ({len(data)} bytes)")
    if not data.startswith((b"\x00\x01\x00\x00", b"OTTO", b"true", b"ttcf")):
        raise SystemExit("downloaded file is not a TrueType/OpenType font")
    FONT_PATH.write_bytes(data)
    return FONT_PATH


def build_svg(font_path: Path) -> str:
    font = TTFont(font_path)
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    upem = font["head"].unitsPerEm

    paths: list[str] = []
    bounds: list[tuple[float, float, float, float]] = []
    pen_x = 0.0

    for char in WORD:
        name = cmap.get(ord(char))
        if name is None:
            raise SystemExit(f"Karantina has no glyph for {char!r}")
        # Flip Y (font space is Y-up, SVG is Y-down) and slide to the pen position.
        transform = Transform(1, 0, 0, -1, pen_x, 0)

        svg_pen = SVGPathPen(glyph_set)
        glyph_set[name].draw(TransformPen(svg_pen, transform))
        commands = svg_pen.getCommands()
        if commands.strip():
            paths.append(commands)

        bounds_pen = BoundsPen(glyph_set)
        glyph_set[name].draw(TransformPen(bounds_pen, transform))
        if bounds_pen.bounds:
            bounds.append(bounds_pen.bounds)

        pen_x += hmtx[name][0]

    if not bounds:
        raise SystemExit("no glyph outlines were produced")

    x0 = min(b[0] for b in bounds)
    y0 = min(b[1] for b in bounds)
    x1 = max(b[2] for b in bounds)
    y1 = max(b[3] for b in bounds)
    width, height = x1 - x0, y1 - y0
    log(f"outlined {len(paths)} glyphs at {upem} upem; "
        f"union bbox {width:.0f}x{height:.0f}")

    body = "\n".join(f'  <path d="{d}"/>' for d in paths)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{x0:.2f} {y0:.2f} {width:.2f} {height:.2f}" '
        f'width="{width:.0f}" height="{height:.0f}" '
        'role="img" aria-label="Jobsworm" fill="currentColor">\n'
        "  <title>Jobsworm</title>\n"
        f"{body}\n"
        "</svg>\n"
    )


def verify_svg(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    n_paths = len(re.findall(r'<path\s+d="', text))
    if n_paths < 8:
        raise SystemExit(f"wordmark.svg has only {n_paths} path(s), expected >= 8")
    root = ElementTree.fromstring(text)
    _, _, w, h = (float(v) for v in root.attrib["viewBox"].split())
    if w <= 0 or h <= 0:
        raise SystemExit(f"wordmark.svg viewBox has non-positive area: {w}x{h}")
    if 'fill="currentColor"' not in text:
        raise SystemExit("wordmark.svg is missing fill=currentColor")
    if "@font-face" in text or "<font" in text:
        raise SystemExit("wordmark.svg must not embed a font")
    log(f"verified wordmark.svg: {n_paths} paths, viewBox {w:.0f}x{h:.0f}, "
        "currentColor, no embedded font")


def render_wordmark(font_path: Path, color: str, size: int = PNG_FONT_SIZE) -> Image.Image:
    """Tightly cropped wordmark on a transparent background."""
    font = ImageFont.truetype(str(font_path), size)
    probe = Image.new("RGBA", (size * len(WORD), size * 3), (0, 0, 0, 0))
    draw = ImageDraw.Draw(probe)
    draw.text((size, size), WORD, font=font, fill=color)
    box = probe.getbbox()
    if box is None:
        raise SystemExit("PIL rendered an empty wordmark")
    return probe.crop(box)


def scale_to_height(img: Image.Image, height: int) -> Image.Image:
    ratio = height / img.size[1]
    return img.resize(
        (max(1, round(img.size[0] * ratio)), height), Image.LANCZOS
    )


def build_lockup(mascot: Image.Image, wordmark: Image.Image) -> Image.Image:
    art = scale_to_height(mascot, MASCOT_HEIGHT)
    text = scale_to_height(wordmark, LOCKUP_WORDMARK_H)
    width = art.size[0] + LOCKUP_GAP + text.size[0]
    height = max(art.size[1], text.size[1])
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    canvas.alpha_composite(art, (0, (height - art.size[1]) // 2))
    canvas.alpha_composite(
        text, (art.size[0] + LOCKUP_GAP, (height - text.size[1]) // 2)
    )
    return canvas


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    font_path = ensure_font()

    svg_path = OUT_DIR / "wordmark.svg"
    svg_path.write_text(build_svg(font_path), encoding="utf-8")
    log(f"wrote {svg_path.name}")
    verify_svg(svg_path)

    mascot_path = OUT_DIR / "mascot-1024.png"
    if not mascot_path.exists():
        raise SystemExit(f"missing {mascot_path} - run remove_bg.py first")
    mascot = Image.open(mascot_path).convert("RGBA")

    for suffix, color in (("light", LIGHT_INK), ("dark", DARK_INK)):
        wordmark = render_wordmark(font_path, color)
        name = f"wordmark-{suffix}.png"
        wordmark.save(OUT_DIR / name, "PNG", optimize=True)
        log(f"wrote {name} {wordmark.size[0]}x{wordmark.size[1]} ({color})")

        lockup = build_lockup(mascot, wordmark)
        name = f"lockup-{suffix}.png"
        lockup.save(OUT_DIR / name, "PNG", optimize=True)
        log(f"wrote {name} {lockup.size[0]}x{lockup.size[1]} (mascot left, "
            f"{LOCKUP_GAP}px gap)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
