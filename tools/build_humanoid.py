"""Dataset examples for the humanoid section: one recording per task (cloth folding, pick and place).

Picked 2026-11-26 for clean labels among the 1,319 human-reviewed recordings of the release: the reviewer confirmed
every (or all but one) segment, segments are contiguous, no slivers, no idle filler, successful episode; cloth folding
follows the canonical 10-step sequence; pick and place has every attempt successful and no review flags. Then checked
by eye on all four cameras (no people handling the scene, no bystanders in the views shown).
Pick and place was recorded in front of a wall with the lab's logo: the head and right-wrist streams are cleaned first
by tools/delogo.py (head: fixed box; wrist: per-frame detection, plus two timed blurs: a passer-by and an oblique
second logo at 110.4-112.1 s, letter fragments in a fast pan at 64.2-65.2 s). The torso camera never sees the logo.
    python tools/delogo.py <cam_head.mp4>        $C/pnp_head.mp4 box 232 0 452 76
    python tools/delogo.py <cam_right_wrist.mp4> $C/pnp_right_wrist.mp4 detect 110.4,112.1,430,0,640,480 64.2,65.2,360,0,640,90
    (C = /mnt/ceph-cold-storage/temporary/trinhpn/strata_web_humanoid; python = a venv with opencv)

Writes static/video/humanoid_<key>.mp4 (+ .jpg poster) and static/data/humanoid.js (window.STRATA_HUMANOID).
Video = one camera large + two small, 2x speed, 15 fps. Annotation = the recording's own language segments
(meta/lerobot_annotations.json); telemetry = the 6 of 31 joint-state channels with the largest std, 5 Hz.
    python3 tools/build_humanoid.py
"""
import json
import re
import subprocess
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq

D = "/mnt/ceph-cold-storage/temporary/hiephn/m2v2_50h"
C = "/mnt/ceph-cold-storage/temporary/trinhpn/strata_web_humanoid"
OUT = Path(__file__).resolve().parent.parent / "static"
SPEED = 2

FOLD_SHORT = {  # sub-task sentence (start) -> short label
    "The garment is being laid out": "Lay out", "Grasp the near side": "Grasp near side",
    "Fold the near side": "Fold near side", "Smooth the fold": "Smooth fold", "Align and smooth": "Align & smooth",
    "Grasp the far side": "Grasp far side", "Fold the far side": "Fold far side",
    "Grasp the right hand side": "Grasp right side", "Fold the right hand side": "Fold right side",
    "Grasp the left hand side": "Grasp left side", "Fold the left hand side": "Fold left side",
    "The robot is not perform": "Idle", "No action": "Idle",
}


def fold_label(text):
    for k, v in FOLD_SHORT.items():
        if text.startswith(k):
            return v, v
    return text.rstrip(".")[:18], text.rstrip(".")[:18]


PNP = re.compile(r"The robot's (left|right) arm picks up (?:the |a |an )?(.+?) and places it (?:in|on|into) (?:the |a )?(.+?)\.?$")
OBJ_SHORT = {  # object phrase -> bar label (the side panel shows the full sentence)
    "clear plastic water bottle": "water bottle", "rolled-up blue fabric item": "fabric roll",
    "clear plastic bottle": "clear bottle", "red Hiso Xtreme energy drink bottle": "energy drink",
    "yellow C2 lemon-lime soda bottle": "lemon soda", "plastic bottle": "plastic bottle", "knitted toy": "knitted toy",
    "roll of orange adhesive tape": "tape roll", "white ice cream": "ice cream", "red plastic soda bottle": "red soda",
    "red plastic bottle": "red bottle",
}


def pnp_label(text):
    """Bar label = the object; colour kind = which arm and where it goes."""
    m = PNP.match(text.strip())
    if not m:
        return text.rstrip(".")[:18], "Other"
    arm, obj, dst = m.groups()
    return OBJ_SHORT.get(obj, " ".join(obj.split()[-2:])), f"{arm.capitalize()} arm → {dst}"


TASKS = {
    "fold": dict(
        name="cloth folding", label=fold_label, task="Fold clothes",
        rel="m2v2.2#2/task_01/lerobot_dataset_1019_1025/recording_M2v2.2#2_20261019_0107_0",
        cams=[dict(cam="torso", name="torso camera"), dict(cam="head", name="head camera"),
              dict(cam="left_wrist", name="left wrist")],
        note="Cloth folding: the canonical ten-step fold. The shirt is laid out; the near, far and right sides are "
             "each grasped, folded in and smoothed; a final pass aligns the shirt. A human reviewer confirmed all ten "
             "annotated segments unchanged."),
    "pnp": dict(
        name="pick and place", label=pnp_label, task="Pick and place",
        rel="m2v2.1#1/task_00/lerobot_dataset_0803_0809/recording_20260806_040841_0",
        cams=[dict(cam="torso", name="torso camera"),
              dict(cam="head", name="head camera", src=f"{C}/pnp_head.mp4", crop="512:320:64:80"),
              dict(cam="right_wrist", name="right wrist", src=f"{C}/pnp_right_wrist.mp4")],
        note="Pick and place: eleven objects cleared from the table, the right arm into the blue bin and the left arm "
             "into the wire basket, every attempt successful. A human reviewer confirmed ten of the eleven segments "
             "and corrected one object name. Wall signage and a passer-by are masked out for anonymous review."),
}
CAM_SIZE = {"torso": (640, 400), "head": (640, 400), "left_wrist": (640, 480), "right_wrist": (640, 480)}


def tile(c, w, h):
    """Optional crop, then scale to width w and centre-crop to height h (wrists are 4:3, head/torso 16:10)."""
    sw, sh = CAM_SIZE[c["cam"]]
    pre = ""
    if "crop" in c:
        cw, ch, _, _ = map(int, c["crop"].split(":"))
        pre, sw, sh = f"crop={c['crop']},", cw, ch
    return f"{pre}scale={w}:{round(sh * w / sw)},crop={w}:{h},setsar=1"


def build(key, cfg, manifest):
    rel = cfg["rel"]
    rec = next(r for r in manifest if r["relative"] == rel)
    ep = json.load(open(f"{D}/{rel}/meta/lerobot_annotations.json"))["episodes"][0]
    rv = json.load(open(f"{D}/{rel}/meta/review_done.json"))["episodes"]["0"]
    spans = sorted((s for s in ep["spans"] if s["kind"] == "language_segment"), key=lambda s: s["start_time"])
    segs, kinds = [], []
    for s in spans:
        text = s["data"]["subtask"]
        label, kind = cfg["label"](text)
        if kind not in kinds:
            kinds.append(kind)
        segs.append(dict(s=round(s["start_time"], 2), e=round(s["end_time"], 2), text=text, label=label,
                         k=kinds.index(kind)))
    st = np.stack(pq.read_table(f"{D}/{rel}/data/chunk-000/file-000.parquet", columns=["observation.state"])
                  .column(0).to_numpy(zero_copy_only=False)).astype(float)
    fps = rec["fps"]
    step = max(1, int(round(fps / 5)))
    st = st[::step]
    keep = np.argsort(-st.std(0))[:6]
    tel = []
    for ch in st[:, keep].T:
        lo, hi = ch.min(), ch.max()
        tel.append([round(float((v - lo) / (hi - lo + 1e-9)), 3) for v in ch])
    agreed = sum(1 for x in rv["subtasks"] if x.get("review_opinion") is True)
    data = dict(name=cfg["name"], robot=rec["robot"], duration=round(rec["duration"], 2), task=cfg["task"],
                status=ep["episode_status"], review=f"{agreed} of {len(rv['subtasks'])} confirmed",
                segments=segs, kinds=kinds, tel=tel, tel_dt=round(step / fps, 4), dof=int(st.shape[1]),
                cams=[c["name"] for c in cfg["cams"]], note=cfg["note"],
                video=f"static/video/humanoid_{key}.mp4", poster=f"static/video/humanoid_{key}.jpg", speed=SPEED)
    big, top, bot = cfg["cams"]
    src = [c.get("src", f"{D}/{rel}/videos/observation.images.cam_{c['cam']}/chunk-000/file-000.mp4")
           for c in cfg["cams"]]
    vid = OUT / "video" / f"humanoid_{key}.mp4"
    flt = (f"[0:v]{tile(big, 640, 400)}[t];[1:v]{tile(top, 320, 200)}[h];[2:v]{tile(bot, 320, 200)}[l];"
           f"[h][l]vstack[r];[t][r]hstack,setpts=PTS/{SPEED},fps=15[v]")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", src[0], "-i", src[1], "-i", src[2],
                    "-filter_complex", flt, "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "28",
                    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-threads", "4", str(vid)], check=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", "3", "-i", str(vid), "-frames:v", "1", "-q:v", "4",
                    str(OUT / "video" / f"humanoid_{key}.jpg")], check=True)
    print(f"[{key}] {rec['robot']} {rec['duration']:.1f}s, {len(segs)} segments, {len(kinds)} kinds, "
          f"{data['review']}; video {vid.stat().st_size // 1024} KB")
    for g in segs:
        print(f"  {g['s']:6.1f}-{g['e']:6.1f} {g['label']:<16} {g['text'][:90]}")
    return data


if __name__ == "__main__":
    manifest = json.load(open(f"{D}/manifest.json"))["recordings"]
    tasks = {k: build(k, cfg, manifest) for k, cfg in TASKS.items()}
    (OUT / "data" / "humanoid.js").write_text(
        "// Generated by tools/build_humanoid.py from the humanoid dataset release (m2v2_50h). Do not edit by hand.\n"
        "window.STRATA_HUMANOID = " + json.dumps(dict(order=list(TASKS), tasks=tasks), separators=(",", ":"),
                                                 ensure_ascii=False) + ";\n")
