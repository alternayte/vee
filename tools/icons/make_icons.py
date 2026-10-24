# SPDX-License-Identifier: AGPL-3.0-or-later
"""Draws the Vee V-chevron app icons in the token colours.

Usage: python3 tools/icons/make_icons.py apps/mobile/assets
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw

STEEL = (14, 17, 20, 255)
BRASS = (201, 162, 83, 255)
CLEAR = (0, 0, 0, 0)
WHITE = (255, 255, 255, 255)


def chevron(size: int, colour, background, scale: float) -> Image.Image:
    """A V made of two thick strokes that meet at the bottom, centred."""
    img = Image.new("RGBA", (size, size), background)
    d = ImageDraw.Draw(img)
    s = size * scale
    cx, cy = size / 2, size / 2
    w = s * 0.18  # stroke width
    top = cy - s * 0.32
    bottom = cy + s * 0.36
    half = s * 0.42
    left = [(cx - half, top), (cx - half + w, top), (cx + w / 2, bottom), (cx - w / 2, bottom)]
    right = [(cx + half - w, top), (cx + half, top), (cx + w / 2, bottom), (cx - w / 2, bottom)]
    d.polygon(left, fill=colour)
    d.polygon(right, fill=colour)
    return img


def main(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    chevron(1024, BRASS, STEEL, 0.7).save(out / "icon.png")
    chevron(1024, BRASS, CLEAR, 0.45).save(out / "android-icon-foreground.png")
    Image.new("RGBA", (1024, 1024), STEEL).save(out / "android-icon-background.png")
    chevron(1024, WHITE, CLEAR, 0.45).save(out / "android-icon-monochrome.png")
    chevron(512, BRASS, CLEAR, 0.8).save(out / "splash-icon.png")
    chevron(48, BRASS, STEEL, 0.8).save(out / "favicon.png")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
