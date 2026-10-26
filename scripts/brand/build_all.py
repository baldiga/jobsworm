"""Jobsworm brand build: run every asset step, then verify the output.

    python scripts/brand/build_all.py

Steps
  1. remove_bg.py      cut Wormy out of docs/brand/Logo.jpeg
  2. make_icons.py     favicon + PWA + apple-touch icons
  3. make_wordmark.py  outlined wordmark.svg, wordmark PNGs, lockups

Then a verification pass asserts the things that are easy to break silently -
notably that the flood fill did not eat the magnifying-glass lens - and prints
a summary table of every generated file.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from xml.etree import ElementTree

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
BRAND = ROOT / "apps" / "web" / "public" / "brand"
NEXT_FAVICON = ROOT / "apps" / "web" / "app" / "favicon.ico"

STEPS = ["remove_bg.py", "make_icons.py", "make_wordmark.py"]

EXPECTED = [
    BRAND / "mascot-1024.png",
    BRAND / "mascot-512.png",
    BRAND / "mascot-256.png",
    BRAND / "mascot-128.png",
    BRAND / "mascot-64.png",
    BRAND / "mascot-32.png",
    BRAND / "favicon.ico",
    BRAND / "icon-192.png",
    BRAND / "icon-512.png",
    BRAND / "apple-touch-icon.png",
    BRAND / "icon-maskable-512.png",
    BRAND / "wordmark.svg",
    BRAND / "wordmark-light.png",
    BRAND / "wordmark-dark.png",
    BRAND / "lockup-light.png",
    BRAND / "lockup-dark.png",
    NEXT_FAVICON,
]

checks_passed = 0


def check(label: str, condition: bool, detail: str = "") -> None:
    global checks_passed
    if not condition:
        raise AssertionError(f"{label} FAILED {detail}".rstrip())
    checks_passed += 1
    print(f"    PASS  {label}" + (f"  ({detail})" if detail else ""), flush=True)


def run_steps() -> None:
    for i, step in enumerate(STEPS, start=1):
        print(f"\n[{i}/{len(STEPS)}] {step}", flush=True)
        result = subprocess.run(
            [sys.executable, str(HERE / step)], cwd=str(ROOT), check=False
        )
        if result.returncode != 0:
            raise SystemExit(f"{step} exited with code {result.returncode}")


def verify_mascot() -> None:
    img = Image.open(BRAND / "mascot-1024.png")
    check("mascot-1024.png is RGBA", img.mode == "RGBA", img.mode)
    check("mascot-1024.png longest side is 1024", max(img.size) == 1024,
          f"{img.size[0]}x{img.size[1]}")

    a = np.array(img)
    h, w = a.shape[:2]
    corners = [a[0, 0, 3], a[0, w - 1, 3], a[h - 1, 0, 3], a[h - 1, w - 1, 3]]
    check("all four corners are fully transparent",
          all(int(c) == 0 for c in corners), f"alpha={[int(c) for c in corners]}")

    centre = a[h // 2, w // 2]
    check("centre pixel is fully opaque", int(centre[3]) == 255,
          f"alpha={int(centre[3])}")

    # The lens is an enclosed white region. If the flood fill had leaked past
    # the gold rim it would be transparent here instead of pale blue-white.
    lens = a[int(0.38 * h), int(0.40 * w)]
    r, g, b, alpha = (int(v) for v in lens)
    check("lens at (40%, 38%) survived the flood fill",
          alpha == 255 and min(r, g, b) > 200 and b >= r,
          f"rgba=({r}, {g}, {b}, {alpha})")


def verify_wordmark() -> None:
    path = BRAND / "wordmark.svg"
    root = ElementTree.fromstring(path.read_text(encoding="utf-8"))
    check("wordmark.svg parses as XML", root.tag.endswith("svg"), root.tag)
    _, _, w, h = (float(v) for v in root.attrib["viewBox"].split())
    check("wordmark.svg viewBox has positive area", w > 0 and h > 0,
          f"{w:.0f}x{h:.0f}")
    ns = "{http://www.w3.org/2000/svg}"
    paths = [p for p in root.iter(f"{ns}path") if p.get("d")]
    check("wordmark.svg has >= 8 glyph paths", len(paths) >= 8, f"{len(paths)} paths")
    check("wordmark.svg uses currentColor",
          'currentColor' in path.read_text(encoding="utf-8"))


def verify_files() -> None:
    missing = [p for p in EXPECTED if not p.exists()]
    check("every expected file exists", not missing,
          f"{len(EXPECTED)} files" if not missing
          else f"missing {[p.name for p in missing]}")
    empty = [p for p in EXPECTED if p.exists() and p.stat().st_size == 0]
    check("every expected file is non-zero", not empty,
          f"missing {[p.name for p in empty]}" if empty else "")


def describe(path: Path) -> str:
    if path.suffix == ".svg":
        root = ElementTree.fromstring(path.read_text(encoding="utf-8"))
        _, _, w, h = (float(v) for v in root.attrib["viewBox"].split())
        return f"{w:.0f}x{h:.0f} (viewBox)"
    if path.suffix == ".ico":
        with Image.open(path) as img:
            sizes = sorted(img.info.get("sizes", {img.size}))
        return " ".join(f"{w}x{h}" for w, h in sizes)
    with Image.open(path) as img:
        return f"{img.size[0]}x{img.size[1]}"


def summary() -> None:
    rows = [(str(p.relative_to(ROOT)).replace("\\", "/"), describe(p),
             f"{p.stat().st_size:,}") for p in EXPECTED]
    head = ("file", "dimensions", "bytes")
    wf = max(len(head[0]), *(len(r[0]) for r in rows))
    wd = max(len(head[1]), *(len(r[1]) for r in rows))
    wb = max(len(head[2]), *(len(r[2]) for r in rows))
    line = f"+-{'-' * wf}-+-{'-' * wd}-+-{'-' * wb}-+"
    print("\n" + line)
    print(f"| {head[0]:<{wf}} | {head[1]:<{wd}} | {head[2]:>{wb}} |")
    print(line)
    for f, d, b in rows:
        print(f"| {f:<{wf}} | {d:<{wd}} | {b:>{wb}} |")
    print(line)
    total = sum(p.stat().st_size for p in EXPECTED)
    print(f"{len(rows)} files, {total:,} bytes total")


def main() -> int:
    print("Jobsworm brand asset build")
    print(f"repo: {ROOT}")
    run_steps()

    print("\n[verify] assertions", flush=True)
    verify_mascot()
    verify_wordmark()
    verify_files()
    print(f"\n  {checks_passed}/{checks_passed} assertions passed.")

    summary()
    print("\nBuild complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
