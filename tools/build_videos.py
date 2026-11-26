"""Encode head-camera videos for the page: static/video/<ep>.mp4 for every explorer example (video cards) and
static/video/hero.mp4 + hero.jpg (poster) for the title section's background.

Cards: 4x speed, 15 fps, 640 px wide. Hero: 2x speed, 15 fps, 854 px wide (sits under a dark overlay). H.264 yuv420p, faststart, no audio.
The page reads the speeds from SPEED / HERO_SPEED in main.js.
    python3 tools/build_videos.py [EP ...]      (default: all examples + hero)
"""
import json
import subprocess
import sys
from pathlib import Path

from build_examples import EXAMPLES
from select_examples import MANIFEST

OUT = Path(__file__).resolve().parent.parent / "static" / "video"
SPEED, HERO_SPEED = 4, 2
HERO = ("agibot_il", 626)        # unseen supermarket task 3401, TVF F1 .98 -> STRATA 1.00, 26 boundaries


def encode(src, dst, speed, width, crf):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", src, "-an",
                    "-vf", f"setpts=PTS/{speed},fps=15,scale={width}:-2",
                    "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart", "-threads", "4", str(dst)], check=True)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    only = {int(a) for a in sys.argv[1:]}
    mans = {}

    def rec(name, ep):
        if name not in mans:
            mans[name] = {e["id"]: e for e in json.load(open(MANIFEST[name]))["episodes"]}
        r = mans[name][ep]
        return r, r["videos"]["head_rgb" if name.startswith("galaxea") else "top_head"]

    for name, ep, title, _ in EXAMPLES:
        if only and ep not in only:
            continue
        r, src = rec(name, ep)
        dst = OUT / f"{ep}.mp4"
        encode(src, dst, SPEED, 640, 27)
        print(f"{ep:>6} {title:<22} {r['duration']:6.1f}s -> {r['duration'] / SPEED:5.1f}s  {dst.stat().st_size // 1024} KB")
    if not only or HERO[1] in only:
        r, src = rec(*HERO)
        encode(src, OUT / "hero.mp4", HERO_SPEED, 854, 33)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(OUT / "hero.mp4"), "-frames:v", "1",
                        "-q:v", "4", str(OUT / "hero.jpg")], check=True)
        print(f"  hero {HERO[1]} {r['duration']:6.1f}s -> {r['duration'] / HERO_SPEED:5.1f}s  "
              f"{(OUT / 'hero.mp4').stat().st_size // 1024} KB")
