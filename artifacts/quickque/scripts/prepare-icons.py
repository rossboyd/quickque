#!/usr/bin/env python3
"""Reproduce Quickque's supplied artwork crop with Python 3 + ImageMagick 7.

No drawing or AI replacement: only the connected exterior, its shadow and
white-matted edge pixels are removed. The enclosed artwork is left intact.
"""
from collections import deque
from pathlib import Path
import hashlib
import json
import struct
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT.parent.parent / "attached_assets/0_quickque_1789167367786.png"
ICONS = ROOT / "src-tauri/icons"
PUBLIC = ROOT / "public"


def magick(*args):
    return subprocess.check_output(["magick", *map(str, args)])


def main():
    width, height = map(int, magick(SOURCE, "-format", "%w %h", "info:").split())
    assert (width, height) == (1254, 1254), "Crop is calibrated for the supplied original"
    rgb = magick(SOURCE, "-depth", "8", "rgb:-")
    count = width * height
    exterior = bytearray(count)
    queue = deque([0])
    exterior[0] = 1
    while queue:
        i = queue.popleft()
        x, y = i % width, i // width
        for nx, ny in ((x-1, y), (x+1, y), (x, y-1), (x, y+1)):
            if not (0 <= nx < width and 0 <= ny < height):
                continue
            n = ny * width + nx
            if not exterior[n] and max(rgb[n*3:n*3+3]) > 120:
                exterior[n] = 1
                queue.append(n)

    def neighbours(i, radius):
        x, y = i % width, i // width
        return [(ny*width+nx) for ny in range(max(0,y-radius), min(height,y+radius+1))
                for nx in range(max(0,x-radius), min(width,x+radius+1))]

    inside = [i for i in range(count) if not exterior[i]]
    edge = {i for i in inside if any(exterior[n] for n in neighbours(i, 1))}
    rgba = bytearray(count * 4)
    for i in inside:
        rgba[i*4:i*4+4] = rgb[i*3:i*3+3] + b"\xff"
    # Dematte only the outermost pixels using the nearest fully interior colour.
    # This avoids retaining the white photograph background in transparent edges.
    for i in edge:
        candidates = [n for n in neighbours(i, 3) if not exterior[n] and n not in edge]
        if not candidates:
            continue
        n = min(candidates, key=lambda n: (n % width-i % width)**2+(n//width-i//width)**2)
        foreground = rgb[n*3:n*3+3]
        pixel = rgb[i*3:i*3+3]
        alpha = min(1, max(0, sum((255-p)/(255-f) for p,f in zip(pixel,foreground))/3))
        rgba[i*4:i*4+4] = foreground + bytes([round(alpha*255)])

    left = min(i % width for i in inside)
    right = max(i % width for i in inside) + 1
    top = min(i // width for i in inside)
    bottom = max(i // width for i in inside) + 1
    # A square canvas, not a square stretch; retain a few transparent edge pixels.
    side = max(right-left, bottom-top) + 8
    ICONS.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as folder:
        raw = Path(folder) / "crop.rgba"
        raw.write_bytes(rgba)
        master = ICONS / "icon.png"
        magick("-size", f"{width}x{height}", "-depth", "8", f"rgba:{raw}",
               "-crop", f"{right-left}x{bottom-top}+{left}+{top}", "+repage",
               "-background", "none", "-gravity", "center", "-extent", f"{side}x{side}",
               "-resize", "1024x1024", "-strip", f"PNG32:{master}")
        chunks = []
        representations = {}
        for size, kind in [(16,b"icp4"),(32,b"icp5"),(64,b"icp6"),(128,b"ic07"),
                           (256,b"ic08"),(512,b"ic09"),(1024,b"ic10")]:
            png = magick(master, "-resize", f"{size}x{size}", "-strip", "PNG32:-")
            representations[size] = png
            chunks.append(kind + struct.pack(">I", len(png)+8) + png)
            (ICONS / f"{size}x{size}.png").write_bytes(png)
            if size == 256:
                (ICONS / "128x128@2x.png").write_bytes(png)
        # Explicit Retina representations for small Finder/Dock icons.
        for size, kind in [(32,b"ic11"), (64,b"ic12"), (256,b"ic13"), (512,b"ic14")]:
            png = representations[size]
            chunks.append(kind + struct.pack(">I", len(png)+8) + png)
        payload = b"".join(chunks)
        (ICONS / "icon.icns").write_bytes(b"icns" + struct.pack(">I", len(payload)+8) + payload)
        magick(master, "-define", "icon:auto-resize=256,128,64,48,32,16", "-strip", ICONS / "icon.ico")
        magick(master, "-resize", "48x48", "-strip", f"PNG32:{PUBLIC / 'favicon.png'}")
        magick(master, "-resize", "180x180", "-strip", f"PNG32:{PUBLIC / 'apple-touch-icon.png'}")
    files = [ICONS / f"{size}x{size}.png" for size in [16,32,64,128,256,512,1024]]
    files += [ICONS/"128x128@2x.png", ICONS/"icon.png", ICONS/"icon.icns", ICONS/"icon.ico",
              PUBLIC/"favicon.png", PUBLIC/"apple-touch-icon.png"]
    manifest = {
        "source": str(SOURCE.relative_to(ROOT.parent.parent)),
        "sourceSha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        "cropBounds": [left, top, right, bottom],
        "files": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
    }
    (ICONS / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Prepared original artwork: bounds {left},{top}–{right},{bottom}; square canvas {side}px")


if __name__ == "__main__":
    main()