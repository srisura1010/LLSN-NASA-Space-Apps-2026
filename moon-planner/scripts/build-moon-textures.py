"""Build the Moon level's globe textures from the NASA SVS CGI Moon Kit.

Inputs (download from https://svs.gsfc.nasa.gov/4720 into one folder):
  lroc_color_poles_4k.tif   LROC WAC colour mosaic, 4096 x 2048
  ldem_16.tif               LOLA elevation, 16 px per degree, float km
Outputs, into public/textures/:
  moon_color_4k.jpg    the colour map as JPEG
  moon_height_1k.jpg   elevation at 1024 x 512; 0..255 covers BASE_MIN..BASE_MAX km
  moon_relief_4k.jpg   elevation at 4096 x 2048 minus the 1k map (bilinear),
                       0..255 covers -DETAIL_KM..+DETAIL_KM

The globe shader adds the slopes of the two elevation maps. Splitting the
elevation this way keeps fine relief that one 8-bit map would quantise away,
and the small 1k map alone is enough for a first paint.

Usage: python3 scripts/build-moon-textures.py <folder with the two TIFFs>
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFile

Image.MAX_IMAGE_PIXELS = None
ImageFile.MAXBLOCK = 1 << 26
SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parent.parent / "public" / "textures"
# Keep these three in step with the constants in src/components/moon/MoonView.tsx.
BASE_MIN, BASE_MAX = -9.5, 11.0
DETAIL_KM = 1.5

Image.open(SRC / "lroc_color_poles_4k.tif").convert("RGB").save(OUT / "moon_color_4k.jpg", quality=84, optimize=True, progressive=True)


def as_f(a):
    return Image.fromarray(np.ascontiguousarray(a, dtype=np.float32), mode="F")


h = np.asarray(Image.open(SRC / "ldem_16.tif"), dtype=np.float32)
fine = np.asarray(as_f(h).resize((4096, 2048), Image.Resampling.BOX))
base = np.asarray(as_f(h).resize((1024, 512), Image.Resampling.BOX))
base8 = np.round(255 * np.clip((base - BASE_MIN) / (BASE_MAX - BASE_MIN), 0, 1)).astype(np.uint8)
Image.fromarray(base8, mode="L").save(OUT / "moon_height_1k.jpg", quality=90, optimize=True)

# The detail is what the 1k map, as the GPU will read it back, leaves out. Pad across the 180-degree seam before upsampling.
decoded = base8.astype(np.float32) / 255 * (BASE_MAX - BASE_MIN) + BASE_MIN
pad = 32
wrapped = np.concatenate([decoded[:, -pad:], decoded, decoded[:, :pad]], axis=1)
up = np.asarray(as_f(wrapped).resize((wrapped.shape[1] * 4, 2048), Image.Resampling.BILINEAR))[:, pad * 4 : -pad * 4]
detail8 = np.round(255 * (0.5 + 0.5 * np.clip((fine - up) / DETAIL_KM, -1, 1))).astype(np.uint8)
Image.fromarray(detail8, mode="L").save(OUT / "moon_relief_4k.jpg", quality=80, optimize=True)

for name in ("moon_color_4k.jpg", "moon_height_1k.jpg", "moon_relief_4k.jpg"):
    print(name, (OUT / name).stat().st_size)
