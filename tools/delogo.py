"""Remove the lab's wall logo from pick-and-place camera streams (the project page stays anonymous during review).

The logo is blue text plus a chevron printed on a plain grey wall. Two modes:
  box   : static camera (the head camera does not move in the chosen recording) -> inpaint a fixed rectangle.
  detect: moving wrist camera -> per frame, mark pixels that are dark strokes on a smooth background (black-hat of
          a large closing), bluish, moderately saturated, not dark, on a wall-grey background; keep blobs >= 60 px;
          fill the convex hull of dense text clusters (catches a missed letter between found ones); union the mask
          over +-3 frames so the logo cannot flash in for a frame; dilate and inpaint.
Thresholds come from labelled components of the chosen recording (2026-11-26): logo strokes have black-hat 35-76,
pixel V 107-172; the wall/table edge and bottle outlines have black-hat 12-33 or are dark (V < 45); rims of the blue
fabric roll give blobs under 50 px. Close-up letters are wider than the closing kernel, so their background keeps
some colour (saturation up to ~50): the background-saturation gate is 60.
    python tools/delogo.py in.mp4 out.mp4 detect [t0,t1,x0,y0,x1,y1 ...]   # optional timed blur boxes
    python tools/delogo.py in.mp4 out.mp4 box x0 y0 x1 y1
Needs opencv (cv2) and numpy; writes H.264 CRF 12 (re-encoded later by build_humanoid.py).
"""
import subprocess
import sys

import cv2
import numpy as np

K = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (61, 61))
DIL = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
NEAR = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13))
GROUP = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25))
HALF = 3  # frames of mask memory on each side


def logo_mask(bgr):
    close = cv2.morphologyEx(bgr, cv2.MORPH_CLOSE, K)
    bh = (close.astype(np.int16) - bgr.astype(np.int16)).max(2)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    bg = cv2.cvtColor(close, cv2.COLOR_BGR2HSV)
    b, g, r = (bgr[..., i].astype(np.int16) for i in range(3))
    m = ((bh > 18) & (b > r + 12) & (b >= g) & (hsv[..., 1] < 140) & (hsv[..., 2] > 90)
         & (bg[..., 1] < 60) & (bg[..., 2] > 100) & (bg[..., 2] < 215) & (bg[..., 0] > 85) & (bg[..., 0] < 135))
    vivid = ((hsv[..., 1] > 150) & (hsv[..., 0] > 95) & (hsv[..., 0] < 130)).astype(np.uint8)  # blue bin, caps
    m &= cv2.dilate(vivid, NEAR) == 0
    m = m.astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    keep = np.zeros(n, np.uint8)
    keep[1:] = st[1:, cv2.CC_STAT_AREA] >= 60
    m = keep[lab]
    # text clusters: merge nearby blobs, fill the hull when the cluster is dense (letters), not a thin curve
    n, lab, st, _ = cv2.connectedComponentsWithStats(cv2.dilate(m, GROUP))
    out = m * 255
    for i in range(1, n):
        raw = int(m[lab == i].sum())
        if raw < 400:
            continue
        ys, xs = np.nonzero(lab == i)
        hull = cv2.convexHull(np.stack([xs, ys], 1).astype(np.int32))
        if raw / max(cv2.contourArea(hull), 1.0) >= 0.12:
            cv2.fillConvexPoly(out, hull, 255)
    return out


def main():
    src, dst, mode = sys.argv[1:4]
    # detect mode: extra args "t0,t1,x0,y0,x1,y1" = blur that rectangle between t0 and t1 seconds
    blurs = [tuple(float(v) for v in a.split(",")) for a in sys.argv[4:]] if mode == "detect" else []
    blurs = [(t0, t1, int(x0), int(y0), int(x1), int(y1)) for t0, t1, x0, y0, x1, y1 in blurs]
    cap = cv2.VideoCapture(src)
    fps = cap.get(cv2.CAP_PROP_FPS)
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    ff = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}",
                           "-r", f"{fps}", "-i", "-", "-c:v", "libx264", "-crf", "12", "-preset", "fast",
                           "-pix_fmt", "yuv420p", dst], stdin=subprocess.PIPE)
    n = 0
    if mode == "box":
        x0, y0, x1, y1 = map(int, sys.argv[4:8])
        box = np.zeros((h, w), np.uint8)
        box[y0:y1, x0:x1] = 255
        while True:
            ok, f = cap.read()
            if not ok:
                break
            ff.stdin.write(cv2.inpaint(f, box, 7, cv2.INPAINT_TELEA).tobytes())
            n += 1
    else:  # pass 1: masks (bit-packed); pass 2: union over +-HALF frames, inpaint
        packed = []
        while True:
            ok, f = cap.read()
            if not ok:
                break
            packed.append(np.packbits(logo_mask(f) > 0))
        cap.release()
        cap = cv2.VideoCapture(src)
        for t in range(len(packed)):
            ok, f = cap.read()
            if not ok:
                break
            u = np.zeros(h * w, bool)
            for k in range(max(0, t - HALF), min(len(packed), t + HALF + 1)):
                u |= np.unpackbits(packed[k], count=h * w).astype(bool)
            mask = cv2.dilate(u.reshape(h, w).astype(np.uint8) * 255, DIL)
            f = cv2.inpaint(f, mask, 7, cv2.INPAINT_TELEA)
            for t0, t1, x0, y0, x1, y1 in blurs:  # timed privacy blur (bystander, oblique second logo)
                if t0 <= t / fps <= t1:
                    f[y0:y1, x0:x1] = cv2.GaussianBlur(f[y0:y1, x0:x1], (0, 0), 30)
            ff.stdin.write(f.tobytes())
            n += 1
    ff.stdin.close()
    ff.wait()
    print(f"{src} -> {dst}: {n} frames, mode {mode}")


if __name__ == "__main__":
    main()
