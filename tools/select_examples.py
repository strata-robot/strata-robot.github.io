"""Rank candidate example recordings for the explorer, per benchmark, from FOCUS draw-0 dumps.

Dumps: fscu_uni.py run SET with UNI_TIME=1 UNI_BASE=1 UNI_TAG=_ed UNI_DUMP=<pkl> (the Table 2 settings, draw 0, L = 5).
Labelled (support) recordings are excluded. TVF = peaks with confidence >= .5; STRATA = candidates with P >= .5
(proposals included); F1 at +-1 s, one-to-one matching.
    python3 tools/select_examples.py [SET ...]     SET in agibot_il, agibot_rl, galaxea349_ood
"""
import json
import pickle
import sys

import numpy as np

C = "/mnt/ceph-cold-storage/temporary/trinhpn"
DUMPS = {
    "agibot_il": f"{C}/strata_web_examples/focus_dump_agibot_il_draw0.pkl",
    "agibot_rl": f"{C}/alpha_p1/con3/il_rl_fig/focus_dump_agibot_rl_draw0.pkl",
    "galaxea349_ood": f"{C}/strata_web_examples/focus_dump_galaxea349_ood_draw0.pkl",
}
MANIFEST = {
    "agibot_il": f"{C}/agibot2026_idood/cache/manifest.json",
    "agibot_rl": f"{C}/agibot2026_idood/cache_rl/manifest.json",
    "galaxea349_ood": f"{C}/galaxea_tpf/cache/manifest.json",
}


def match(b, t, tol=1.0):
    b, t = np.asarray(b, float), np.asarray(t, float)
    ok, used = np.zeros(len(b), bool), np.zeros(len(t), bool)
    for _, i, j in sorted((abs(x - y), i, j) for i, x in enumerate(b) for j, y in enumerate(t)):
        if abs(b[i] - t[j]) <= tol and not ok[i] and not used[j]:
            ok[i], used[j] = True, True
    return ok, 2 * ok.sum() / max(len(b) + len(t), 1)


def load(name):
    dump = pickle.load(open(DUMPS[name], "rb"))  # nosec B301  # nosemgrep  # our own dump
    man = {e["id"]: e for e in json.load(open(MANIFEST[name]))["episodes"]}
    return dump, man


def truth_of(rec):
    return np.array(sorted(x for x in rec["boundaries"] if 0 < x < rec["duration"]), float)


def rank(name):
    dump, man = load(name)
    labs = {int(k): set(map(int, v)) for k, v in dump["labs"].items()}
    rows = []
    for e in np.unique(dump["episode"]):
        e = int(e)
        m = (dump["episode"] == e) & np.isfinite(dump["P_A3"])
        if not m.any():
            continue
        task = int(dump["task"][m][0])
        if e in labs.get(task, set()):
            continue
        rec = man[e]
        t, h, p, pr, y = (dump[k][m] for k in ("time", "h", "P_A3", "prop", "y"))
        pr = pr.astype(bool)
        truth = truth_of(rec)
        det = (h >= 0.5) & ~pr
        _, f_tvf = match(t[det], truth)
        _, f_str = match(t[p >= 0.5], truth)
        fp_rej = int((det & (y == 0) & (p < 0.5)).sum())
        fp_rej_hi = int((det & (y == 0) & (p < 0.3) & (h >= 0.8)).sum())
        rec_ok = int((pr & (y == 1) & (p >= 0.5)).sum()) + int((~pr & ~det & (y == 1) & (p >= 0.5)).sum())
        bad_keep = int(((p >= 0.5) & (y == 0)).sum())
        lost = int((det & (y == 1) & (p < 0.5)).sum())
        score = (f_str - f_tvf) + 0.5 * f_str + 0.05 * min(fp_rej_hi, 3) + 0.05 * min(rec_ok, 3)
        rows.append(dict(ep=e, task=task, fam=rec.get("family", rec.get("task_id")), traj=rec.get("trajectory", ""),
                         dur=rec["duration"], K=len(truth), tvf=f_tvf, strata=f_str, fp_rej=fp_rej, fp_rej_hi=fp_rej_hi,
                         recovered=rec_ok, bad_keep=bad_keep, lost=lost, score=score))
    return rows


if __name__ == "__main__":
    for name in sys.argv[1:] or DUMPS:
        rows = [r for r in rank(name) if 35 <= r["dur"] <= 120 and 4 <= r["K"] <= 14]
        rows.sort(key=lambda r: -r["score"])
        seen, out = {}, []
        for r in rows:                         # at most 2 per task, for variety
            if seen.get(r["task"], 0) >= 2:
                continue
            seen[r["task"]] = seen.get(r["task"], 0) + 1
            out.append(r)
        print(f"\n== {name}: {len(rows)} eligible recordings; top by gain + final F1")
        print("ep       task/family                         traj    dur  K | F1 tvf strata | fp_rej(hi) recovered kept_wrong lost")
        for r in out[:14]:
            print(f"{r['ep']:<8} {str(r['fam'])[:34]:<35} {r['traj'][:7]:<7} {r['dur']:4.0f} {r['K']:2d} | "
                  f"{r['tvf']:.2f} {r['strata']:.2f} | {r['fp_rej']}({r['fp_rej_hi']}) {r['recovered']} {r['bad_keep']} {r['lost']}")
