"""Derive each comic's plate colour from its badge.

Usage: python3 scripts/plates.py [data/badges] [web/plates.json]

Writes {endpoint: [hue, chroma]} in OKLCH for every badge with a clear
dominant colour. Comics left out fall back to a neutral plate in the UI.
Re-run whenever badges are added or replaced.
"""

import json
import math
import os
import sys

from PIL import Image

HUE_BINS = 24
MIN_WEIGHT = 0.6


def srgb_to_linear(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def to_oklch(r, g, b):
    r, g, b = srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b)
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l, m, s = l ** (1 / 3), m ** (1 / 3), s ** (1 / 3)
    lightness = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
    a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    b = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    return lightness, math.hypot(a, b), (math.degrees(math.atan2(b, a)) + 360) % 360


def is_skin(lightness, chroma, hue):
    return 35 <= hue <= 75 and 0.03 <= chroma <= 0.11 and lightness >= 0.72


def plate(path):
    im = Image.open(path).convert("RGBA")
    im.thumbnail((120, 150))
    width = 360 / HUE_BINS
    bins = [[0.0, 0.0, 0.0, 0.0] for _ in range(HUE_BINS)]
    pixels = getattr(im, "get_flattened_data", im.getdata)()
    for r, g, b, alpha in pixels:
        if alpha < 200:
            continue
        lightness, chroma, hue = to_oklch(r, g, b)
        if chroma < 0.06 or lightness < 0.25 or lightness > 0.97:
            continue
        # Skin tones appear in most badges and would turn every plate peach.
        w = chroma * (0.25 if is_skin(lightness, chroma, hue) else 1.0)
        i = int(hue // width) % HUE_BINS
        bins[i][0] += w
        bins[i][1] += w * math.cos(math.radians(hue))
        bins[i][2] += w * math.sin(math.radians(hue))
        bins[i][3] += w * chroma
    best = max(
        range(HUE_BINS),
        key=lambda i: bins[i][0] + 0.5 * (bins[i - 1][0] + bins[(i + 1) % HUE_BINS][0]),
    )
    total = bins[best][0]
    if total < MIN_WEIGHT:
        return None
    hue = (math.degrees(math.atan2(bins[best][2], bins[best][1])) + 360) % 360
    return [round(hue), round(bins[best][3] / total, 3)]


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "data/badges"
    dest = sys.argv[2] if len(sys.argv) > 2 else "web/plates.json"
    plates = {}
    neutral = []
    for name in sorted(os.listdir(src)):
        endpoint, ext = os.path.splitext(name)
        if ext.lower() != ".png":
            continue
        try:
            value = plate(os.path.join(src, name))
        except OSError as err:
            print(f"skipped {name}: {err}", file=sys.stderr)
            continue
        if value is None:
            neutral.append(endpoint)
        else:
            plates[endpoint] = value
    with open(dest, "w") as f:
        json.dump(plates, f, separators=(",", ":"))
        f.write("\n")
    print(f"{len(plates)} coloured, {len(neutral)} neutral -> {dest}")


if __name__ == "__main__":
    main()
