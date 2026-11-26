"""Build the explorer's example recordings: static/data/episodes.js + static/img/ex/<id>/*.jpg.

Candidates (TVF confidence h, FOCUS probability P, proposal flag, correctness y) come from FOCUS draw-0 dumps
(fscu_uni.py run SET, UNI_TIME=1 UNI_BASE=1 UNI_TAG=_ed UNI_DUMP=..., the Table 2 settings, L = 5); the recordings were
picked with tools/select_examples.py among unlabelled recordings of unseen tasks. Truth = manifest boundaries;
segment text = the dataset's own sub-task annotations; telemetry = the 6 robot-state channels with the largest std, 5 Hz;
frames = head camera at every displayed candidate time, every true boundary and every 4 s.
    python3 tools/build_examples.py
"""
import json
import os
import pickle
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq

from select_examples import DUMPS, MANIFEST

OUT = Path(__file__).resolve().parent.parent
IMG = OUT / "static" / "img" / "ex"

# (set, episode, display name, short label per sub-task, benchmark tag)
EXAMPLES = [
    ("agibot_rl", 27113, "Pack a desk lamp", ["Pick lamp", "Place lamp", "Pick cable", "Place cable", "Press lids 1–2",
                                             "Adjust box", "Press lid 3", "Press lid 4", "Align lid 5", "Insert lid 5"]),
    ("agibot_rl", 20397, "Open a tea canister", ["Pick canister", "Unscrew lid", "Place lid", "Take out tea bag",
                                                "Tea bag into mug", "Pick lid", "Screw lid", "Place canister"]),
    ("agibot_rl", 23863, "Load a dish rack", ["Pick plate", "Plate to rack", "Pick plate", "Plate to rack", "Pick bowl",
                                             "Bowl to rack", "Pick bowl", "Bowl to rack"]),
    ("agibot_il", 6888, "Hand out flyers", ["Hold flyers", "Hand out", "Hold flyers", "Hand out", "Hold flyers", "Hand out",
                                            "Hold flyers", "Hand out", "Hold flyers", "Hand out"]),
    ("agibot_il", 4439, "Scoop popcorn", ["Pick bucket", "Scoop", "Scoop", "Scoop", "Scoop", "Place bucket", "Pick bucket",
                                          "Scoop", "Scoop", "Scoop", "Scoop", "Place bucket"]),
    ("agibot_il", 8459, "Throw away rubbish", ["Pick bottle", "Pick bag", "Bottle to bin", "Bag to bin", "Pick white bag",
                                               "White bag to bin", "Reset pose"]),
    ("galaxea349_ood", 230, "Line up water bottles", ["Move bottle 4", "Push to wall", "Move bottle 3", "Push to wall",
                                                      "Move bottle 2", "Push to wall", "Move bottle 1", "Push to wall"]),
    ("galaxea349_ood", 10819, "Organize toiletries", ["Open box", "Comb box in", "Toothbrush bag in", "Bath cap in",
                                                      "Close box"]),
    ("galaxea349_ood", 16157, "Rearrange flowers", ["White flower in", "Orange flower in", "Centre the vase",
                                                    "Orange flower out", "White flower out"]),
]
BENCH = {"agibot_rl": "AgiBot World 2026 · RL", "agibot_il": "AgiBot World 2026 · IL",
         "galaxea349_ood": "Galaxea Open-World"}


def segments_agibot(r):
    info = json.load(open(Path(r["source_root"]) / "meta" / "info.json"))
    segs = [s for s in info["instruction_segments"][str(r["source_episode_id"])]
            if s["track"] == "default" and s["end_frame_index"] > s["start_frame_index"]]
    segs.sort(key=lambda s: s["start_frame_index"])
    return [(s["start_frame_index"] / 30, s["end_frame_index"] / 30, s["skill"] or "", s["instruction"]) for s in segs]


def segments_galaxea(r):
    root = Path(r["source_root"])
    tasks = {}
    for line in open(root / "meta" / "tasks.jsonl"):
        d = json.loads(line)
        tasks[d["task_index"]] = d["task"].split("@", 1)[-1].strip()
    ti = pq.read_table(r["telemetry_path"], columns=["task_index"]).column(0).to_numpy()
    fps = r["source_fps"]
    cut = np.flatnonzero(np.r_[True, ti[1:] != ti[:-1]])
    ends = list(cut[1:]) + [len(ti)]
    return [(a / fps, b / fps, "", tasks.get(int(ti[a]), "")) for a, b in zip(cut, ends)]


def telemetry(name, r):
    if name.startswith("galaxea"):
        cols = ["observation.state.left_arm", "observation.state.right_arm", "observation.state.left_gripper",
                "observation.state.right_gripper", "observation.state.torso"]
        t = pq.read_table(r["telemetry_path"], columns=cols)
        st = np.concatenate([np.stack(t.column(c).to_numpy(zero_copy_only=False)).reshape(t.num_rows, -1) for c in cols], 1)
        step = int(round(r["source_fps"] / 5))
    else:
        st = np.stack(pq.read_table(r["telemetry_path"], columns=["observation.state"]).column(0)
                      .to_numpy(zero_copy_only=False))
        step = 6
    st = st[::step].astype(float)
    keep = np.argsort(-st.std(0))[:6]
    out = []
    for ch in st[:, keep].T:
        lo, hi = ch.min(), ch.max()
        out.append([round(float((v - lo) / (hi - lo + 1e-9)), 3) for v in ch])
    return out


def grab(job):
    video, t, path = job
    if not path.exists():
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", f"{t:.2f}", "-i", video, "-frames:v", "1",
                        "-vf", "scale=400:-2", "-q:v", "5", str(path)], check=True)
    return path


def main():
    dumps, mans = {}, {}
    eps = []
    for name, ep, title, labels in EXAMPLES:
        if name not in dumps:
            dumps[name] = pickle.load(open(DUMPS[name], "rb"))  # nosec B301  # nosemgrep  # our own dump
            mans[name] = {e["id"]: e for e in json.load(open(MANIFEST[name]))["episodes"]}
        d, r = dumps[name], mans[name][ep]
        m = (d["episode"] == ep) & np.isfinite(d["P_A3"])
        task = int(d["task"][m][0])
        assert ep not in set(map(int, d["labs"].get(task, []))), f"{ep} is a labelled support recording"
        cand = [dict(t=round(float(t), 2), h=round(float(h), 3), p=round(float(p), 3), prop=bool(pr), y=int(y))
                for t, h, p, pr, y in zip(*(d[k][m] for k in ("time", "h", "P_A3", "prop", "y")))]
        dur = float(r["duration"])
        truth = sorted(round(float(x), 2) for x in r["boundaries"] if 0 < x < dur)
        segs = segments_galaxea(r) if name.startswith("galaxea") else segments_agibot(r)
        assert len(segs) == len(labels), (ep, len(segs), len(labels))
        video = r["videos"]["head_rgb" if name.startswith("galaxea") else "top_head"]
        shown = [c["t"] for c in cand if not c["prop"] or c["p"] >= 0.5]
        times = sorted(set([round(x, 1) for x in shown + truth] + [float(g) for g in np.arange(2, dur - 0.5, 4.0)]))
        grid = set(float(g) for g in np.arange(2, dur - 0.5, 4.0))
        fdir = IMG / str(ep)
        fdir.mkdir(parents=True, exist_ok=True)
        jobs = [(video, t, fdir / f"{t:.1f}.jpg") for t in times]
        with ThreadPoolExecutor(4) as ex:
            list(ex.map(grab, jobs))
        frames = [dict(t=t, src=f"static/img/ex/{ep}/{t:.1f}.jpg", key=t in grid) for t in times]
        eps.append(dict(id=str(ep), set=name, bench=BENCH[name], task=str(r.get("family", task)), name=title,
                        trajectory=r.get("trajectory", ""), duration=round(dur, 2), truth=truth,
                        segments=[dict(s=round(a, 2), e=round(b, 2), skill=sk, label=lab, text=tx)
                                  for (a, b, sk, tx), lab in zip(segs, labels)],
                        cand=cand, tel_dt=0.2, tel=telemetry(name, r), frames=frames))
        print(f"{ep:>6} {BENCH[name]:<24} {title:<22} {dur:5.1f}s K={len(truth):2d} cand={len(cand):2d} frames={len(frames)}")
    js = ("// Generated by tools/build_examples.py (FOCUS draw-0 dumps, Table 2 settings, L = 5). Do not edit by hand.\n"
          "window.STRATA_EPISODES = " + json.dumps(eps, separators=(",", ":"), ensure_ascii=False) + ";\n")
    (OUT / "static" / "data" / "episodes.js").write_text(js)
    print("episodes.js", len(js) // 1024, "KB")


if __name__ == "__main__":
    os.chdir(OUT)
    main()
