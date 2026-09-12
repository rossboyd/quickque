#!/usr/bin/env python3
"""Generate Quickque's platform icons from the canonical SVG brand mark."""
from pathlib import Path
import hashlib
import json
import struct
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "public/logo.svg"
ICONS = ROOT / "src-tauri/icons"
PUBLIC = ROOT / "public"


def magick(*args):
    return subprocess.check_output(["magick", *map(str, args)])


def main():
    ICONS.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as folder:
        master = ICONS / "icon.png"
        magick("-background", "none", SOURCE, "-resize", "800x800",
               "-gravity", "center", "-extent", "1024x1024", "-strip", f"PNG32:{master}")
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
        for png_file in ICONS.rglob("*.png"):
            if png_file == master or png_file.name in {f"{size}x{size}.png" for size in representations}:
                continue
            dimensions = magick(png_file, "-format", "%wx%h", "info:").decode().strip()
            magick(master, "-resize", dimensions, "-strip", f"PNG32:{png_file}")
    files = [ICONS / f"{size}x{size}.png" for size in [16,32,64,128,256,512,1024]]
    files += [ICONS/"128x128@2x.png", ICONS/"icon.png", ICONS/"icon.icns", ICONS/"icon.ico",
              PUBLIC/"favicon.png", PUBLIC/"apple-touch-icon.png"]
    manifest = {
        "source": str(SOURCE.relative_to(ROOT.parent.parent)),
        "sourceSha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        "files": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
    }
    (ICONS / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("Prepared platform icons from public/logo.svg")


if __name__ == "__main__":
    main()