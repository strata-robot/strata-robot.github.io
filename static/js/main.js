/* STRATA project page. Vanilla JS, no dependencies.
   Data: window.STRATA_EPISODES (static/data/episodes.js), tables below are copied from the paper. */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const NS = "http://www.w3.org/2000/svg";
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const EPS = window.STRATA_EPISODES || [];
  const fmt = (v, d = 2) => (v < 1 && d === 2 ? v.toFixed(2).replace(/^0/, "") : v.toFixed(d));

  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function h(tag, attrs, html) {
    const n = document.createElement(tag);
    for (const k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (html != null) n.innerHTML = html;
    return n;
  }
  function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

  /* One-to-one greedy matching of predicted times to ground truth within tol (seconds). */
  function match(preds, gts, tol) {
    const pairs = [];
    preds.forEach((p, i) => gts.forEach((g, j) => { const d = Math.abs(p - g); if (d <= tol) pairs.push([d, i, j]); }));
    pairs.sort((a, b) => a[0] - b[0]);
    const mp = new Set(), mg = new Set();
    for (const [, i, j] of pairs) if (!mp.has(i) && !mg.has(j)) { mp.add(i); mg.add(j); }
    const f1 = preds.length + gts.length ? (2 * mp.size) / (preds.length + gts.length) : 1;
    return { mp, mg, f1 };
  }
  function decision(c) {
    if (c.prop) return c.p >= 0.5 ? "recover" : null;
    return c.p >= 0.9 ? "accept" : c.p >= 0.5 ? "review" : "reject";
  }
  function episodeSets(ep) {
    const tvf = ep.cand.filter((c) => !c.prop && c.h >= 0.5);
    const kept = ep.cand.filter((c) => c.p >= 0.5);
    const mt = match(tvf.map((c) => c.t), ep.truth, 1.0);
    const ms = match(kept.map((c) => c.t), ep.truth, 1.0);
    return { tvf, kept, mt, ms };
  }

  /* ---------------- figures: optional images, stand-in badges, lightbox ---------------- */
  const extracted = new Set(window.STRATA_PAPER_FIGS || []);
  $$(".standin").forEach((b) => { if (extracted.has(b.dataset.standin)) b.remove(); });
  $$("img[data-optional]").forEach((img) => {
    const hide = () => { const blk = img.closest("[data-optional-block]"); if (blk) blk.hidden = true; };
    const probe = new Image();
    probe.onerror = hide;
    probe.src = img.getAttribute("src");
  });
  const lb = $("#lb");
  function closeLb() { lb.hidden = true; }
  document.addEventListener("click", (e) => {
    const img = e.target.closest("img[data-zoom]");
    if (img) { $("img", lb).src = img.currentSrc || img.src; $("img", lb).alt = img.alt; lb.hidden = false; $("button", lb).focus(); }
  });
  lb.addEventListener("click", closeLb);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !lb.hidden) closeLb(); });

  /* ---------------- nav ---------------- */
  const nav = $("#nav"), prog = $("#progress"), hero = $("#top");
  function onScroll() {
    const y = window.scrollY;
    nav.classList.toggle("show", y > hero.offsetHeight - 80);
    const max = document.documentElement.scrollHeight - window.innerHeight;
    prog.style.width = (max > 0 ? (100 * y) / max : 0) + "%";
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  if ("IntersectionObserver" in window) {
    const links = $$(".nav ul a");
    const io = new IntersectionObserver((ents) => {
      ents.forEach((en) => {
        if (!en.isIntersecting) return;
        let id = en.target.id;
        if (id === "tvf" || id === "focus") id = "method";
        links.forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + id));
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    ["videos", "explore", "method", "tvf", "focus", "results", "humanoid", "cite"].forEach((id) => { const s = document.getElementById(id); if (s) io.observe(s); });
  }

  /* ---------------- light / dark switch (light is the default) ---------------- */
  const root = document.documentElement;
  function setTheme(t, save) {
    root.setAttribute("data-theme", t);
    $$(".theme button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.theme === t)));
    if (save) { try { localStorage.setItem("strata-theme", t); } catch (e) { /* storage blocked: still switches */ } }
  }
  let saved = null;
  try { saved = localStorage.getItem("strata-theme"); } catch (e) { saved = null; }
  setTheme(saved === "dark" ? "dark" : "light", false); // light unless the visitor picked dark
  $$(".theme button").forEach((b) => b.addEventListener("click", () => setTheme(b.dataset.theme, true)));

  /* ---------------- hero: the recording as strata ---------------- */
  // pastel layers fixed for the navy hero (same look in both themes)
  const HERO_SEG = ["#f2b38f", "#f6d36b", "#a9d18e", "#9cc3e6", "#c9a6e0", "#f5c6a5", "#8fd3c4", "#b5c6e8", "#f0a8b8", "#d8d29a"];
  const coreSvg = $("#core");
  const HERO_ID = "626", HERO_SPEED = 2;     // tools/build_videos.py: hero.mp4 = recording 626 at 2x
  const heroVid = $("#hero-video");
  const heroRef = { ep: null, W: 0, line: null, segs: [], cur: -2 };
  if (heroVid && reduced) { heroVid.removeAttribute("autoplay"); heroVid.pause(); }
  function drawHero() {
    const ep = EPS.find((e) => e.id === HERO_ID) || EPS[0];
    if (!ep || !coreSvg) return;
    const W = Math.max(280, coreSvg.parentElement.clientWidth), H = 172;
    const narrow = W < 640;
    coreSvg.innerHTML = "";
    coreSvg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    coreSvg.setAttribute("height", H);
    const x = (t) => (t / ep.duration) * W;
    // telemetry
    const telH = 58;
    ep.tel.forEach((ch, i) => {
      let d = "";
      ch.forEach((v, k) => { d += (k ? "L" : "M") + x(k * ep.tel_dt).toFixed(1) + "," + (4 + (1 - v) * (telH - 8)).toFixed(1); });
      el("path", { d, fill: "none", stroke: "var(--snow)", "stroke-opacity": (0.22 + 0.07 * i).toFixed(2), "stroke-width": 1.2 }, coreSvg);
    });
    // sub-task layers
    const gy = 70, gh = 30;
    heroRef.segs = ep.segments.map((s, i) => {
      const r = el("rect", { x: x(s.s) + 0.5, y: gy, width: Math.max(1, x(s.e) - x(s.s) - 1), height: gh, rx: 3, fill: HERO_SEG[i % HERO_SEG.length], "fill-opacity": 0.92 }, coreSvg);
      const wpx = x(s.e) - x(s.s);
      if (wpx > s.label.length * 6.4 + 8) {
        const tx = el("text", { x: (x(s.s) + x(s.e)) / 2, y: gy + gh / 2 + 4, "text-anchor": "middle", "font-size": 11.5, "font-family": "IBM Plex Sans, sans-serif", fill: "#14203d", "pointer-events": "none" }, coreSvg);
        tx.textContent = s.label;
      }
      return r;
    });
    // boundaries STRATA keeps, with P labels when there is room
    const kept = episodeSets(ep).kept.slice().sort((p, q) => p.t - q.t);
    const gap = W / Math.max(1, kept.length);
    const showLab = gap >= 24, alt = gap < 50, short = narrow || gap < 40;
    kept.forEach((c, i) => {
      el("line", { x1: x(c.t), x2: x(c.t), y1: 0, y2: gy + gh + 8, stroke: "var(--glow)", "stroke-width": 1.8, "stroke-dasharray": c.prop ? "4 3" : "none" }, coreSvg);
      el("circle", { cx: x(c.t), cy: gy + gh + 8, r: 2.8, fill: "var(--glow)" }, coreSvg);
      if (!showLab) return;
      const lab = el("text", { x: x(c.t), y: gy + gh + 23 + (alt ? (i % 2) * 13 : 0), "text-anchor": "middle", "font-size": short ? 10 : 11, "font-family": "IBM Plex Mono, monospace", fill: "var(--glow-soft)" }, coreSvg);
      lab.textContent = (short ? "" : "P ") + fmt(c.p);
    });
    ep.cand.filter((c) => !c.prop && c.h >= 0.5 && c.p < 0.5).forEach((c) => {
      const cx = x(c.t), cy = gy - 6;
      el("path", { d: `M${cx - 4},${cy - 4}L${cx + 4},${cy + 4}M${cx + 4},${cy - 4}L${cx - 4},${cy + 4}`, stroke: "var(--bad-glow)", "stroke-width": 1.8 }, coreSvg);
    });
    // time axis
    const ay = H - 6, step = narrow ? 20 : 10;
    for (let t = 0; t <= ep.duration; t += step) {
      const tx = el("text", { x: Math.min(W - 12, x(t)), y: ay, "text-anchor": t === 0 ? "start" : "middle", "font-size": 10, "font-family": "IBM Plex Mono, monospace", fill: "var(--snow-dim)" }, coreSvg);
      tx.textContent = t === 0 ? "0 s" : t;
    }
    // playhead, driven by the background video
    heroRef.line = el("line", { x1: -10, x2: -10, y1: -4, y2: gy + gh + 10, stroke: "#ffffff", "stroke-width": 2, style: "filter: drop-shadow(0 0 5px #7fa8ff)", visibility: reduced ? "hidden" : "visible" }, coreSvg);
    heroRef.ep = ep; heroRef.W = W; heroRef.cur = -2;
    const { mt, ms } = episodeSets(ep);
    $("#core-f1").innerHTML = `TVF alone <b>F1 ${Math.round(mt.f1 * 100)}</b> &nbsp;→&nbsp; STRATA <b>F1 ${Math.round(ms.f1 * 100)}</b>`;
    $("#core-cap").innerHTML = `<b>${ep.bench.split(" · ")[0]} · unseen supermarket task</b> &nbsp;·&nbsp; ${ep.name}, ${Math.round(ep.duration)} s, ${ep.truth.length} sub-task boundaries &nbsp;·&nbsp; background video at ${HERO_SPEED}×`;
  }
  function heroTick() {
    const R = heroRef;
    if (!R.ep || !heroVid || !R.line || heroVid.paused) return;
    const t = Math.min(R.ep.duration, heroVid.currentTime * HERO_SPEED);
    const xx = (t / R.ep.duration) * R.W;
    R.line.setAttribute("x1", xx); R.line.setAttribute("x2", xx);
    const i = R.ep.segments.findIndex((s) => t >= s.s && t < s.e);
    if (i !== R.cur) { R.segs.forEach((r, j) => r.setAttribute("fill-opacity", j === i ? 1 : 0.5)); R.cur = i; }
  }

  /* ---------------- video cards ---------------- */
  const SPEED = 4;                            // tools/build_videos.py: <ep>.mp4 at 4x
  const CARD_ORDER = ["626", "27113", "230", "4439", "20397", "10819", "6888", "23863", "16157"];
  const vcards = [];
  function predSegs(ep, times) {
    // only the span the reference annotates (some recordings have unlabelled heads / tails)
    const lo = ep.segments[0].s, hi = ep.segments[ep.segments.length - 1].e;
    const cuts = [lo, ...times.filter((t) => t > lo && t < hi).sort((p, q) => p - q), hi];
    const out = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i], b = cuts[i + 1];
      let best = -1, bo = 0;
      ep.segments.forEach((sg, j) => { const o = Math.min(b, sg.e) - Math.max(a, sg.s); if (o > bo) { bo = o; best = j; } });
      out.push({ s: a, e: b, j: best });
    }
    return out;
  }
  function initVideos() {
    const grid = $("#vgrid");
    if (!grid || !EPS.length) return;
    const order = CARD_ORDER.map((id) => EPS.findIndex((e) => e.id === id)).filter((i) => i >= 0);
    EPS.forEach((_, i) => { if (!order.includes(i)) order.push(i); });
    order.forEach((i) => {
      const ep = EPS[i], sets = episodeSets(ep), D = ep.duration;
      const bar = (segs) => segs.filter((g) => g.j >= 0).map((g) =>
        `<b style="left:${(100 * g.s / D).toFixed(2)}%;width:${(100 * (g.e - g.s) / D).toFixed(2)}%;background:var(--s${g.j % 10})"></b>`).join("");
      const ref = ep.segments.map((g, j) => ({ s: g.s, e: g.e, j }));
      const keys = ep.frames.filter((f) => f.key);
      const poster = (keys.length ? keys : ep.frames)[Math.floor((keys.length ? keys : ep.frames).length / 2)];
      const f1t = Math.round(sets.mt.f1 * 100), f1s = Math.round(sets.ms.f1 * 100);
      const card = h("article", { class: "vcard" });
      card.innerHTML = `
        <div class="vmedia" role="button" tabindex="0" aria-label="Pause or play: ${ep.name}">
          <video muted loop playsinline preload="none" poster="${poster.src}" src="static/video/${ep.id}.mp4"></video>
          <span class="vt">0.0 / ${D.toFixed(1)} s</span><span class="vx">${SPEED}× speed</span><span class="vpause">Paused</span>
        </div>
        <div class="vtl">
          <span class="lab" style="grid-column:1;grid-row:1">Reference</span>
          <span class="lab" style="grid-column:1;grid-row:2">TVF</span>
          <span class="lab s" style="grid-column:1;grid-row:3">STRATA</span>
          <div class="vbars"><div class="vbar">${bar(ref)}</div><div class="vbar">${bar(predSegs(ep, sets.tvf.map((c) => c.t)))}</div><div class="vbar">${bar(predSegs(ep, sets.kept.map((c) => c.t)))}</div><i class="vhead"></i></div>
          <span class="f1" style="grid-column:3;grid-row:1;color:var(--ink-faint)">F1</span>
          <span class="f1" style="grid-column:3;grid-row:2">${f1t}</span>
          <span class="f1 s" style="grid-column:3;grid-row:3">${f1s}</span>
        </div>
        <div class="vbody"><b>${ep.name}</b><span>${ep.bench} · ${ep.truth.length} true boundaries</span>
          <span class="vgain">F1 at ±1 s: TVF ${f1t} → STRATA <em>${f1s}</em></span>
          <button type="button">Step through it →</button></div>`;
      const v = $("video", card), media = $(".vmedia", card);
      const c = { ep, v, card, media, head: $(".vhead", card), vt: $(".vt", card), user: false, seen: false };
      const toggle = () => {
        if (v.paused) { c.user = false; media.classList.remove("paused"); v.play().catch(() => {}); }
        else { c.user = true; media.classList.add("paused"); v.pause(); }
      };
      media.addEventListener("click", toggle);
      media.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
      $("button", card).addEventListener("click", () => {
        setEpisode(i);
        $("#explore").scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
      });
      vcards.push(c);
      grid.appendChild(card);
    });
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((ents) => ents.forEach((en) => {
        const c = vcards.find((k) => k.card === en.target);
        if (!c) return;
        c.seen = en.isIntersecting;
        if (c.seen && !c.user && !reduced) c.v.play().catch(() => {});
        else if (!c.seen) c.v.pause();
      }), { threshold: 0.35 });
      vcards.forEach((c) => io.observe(c.card));
      const hio = new IntersectionObserver((ents) => ents.forEach((en) => {
        if (!heroVid) return;
        if (en.isIntersecting && !reduced) heroVid.play().catch(() => {}); else heroVid.pause();
      }), { threshold: 0.05 });
      hio.observe($("#top"));
    }
  }
  function cardsTick() {
    vcards.forEach((c) => {
      if (c.v.paused) return;
      const t = Math.min(c.ep.duration, c.v.currentTime * SPEED);
      c.head.style.left = (100 * t / c.ep.duration).toFixed(2) + "%";
      c.vt.textContent = `${t.toFixed(1)} / ${c.ep.duration.toFixed(1)} s`;
    });
  }

  /* ---------------- explorer ---------------- */
  const ex = {
    svg: $("#ex-svg"), ep: 0, stage: 4, pinned: null, hover: null, geo: null,
  };
  /* Opening selection: the most confident TVF false alarm that FOCUS rejected (away from the recording's ends),
     else the strongest boundary FOCUS recovered. */
  function defaultPin(ep) {
    let best = -1, bs = -1;
    ep.cand.forEach((c, k) => {
      if (!c.prop && c.h >= 0.5 && c.y === 0 && c.p < 0.5 && c.t > 2 && c.t < ep.duration - 2 && c.h - c.p > bs) { bs = c.h - c.p; best = k; }
    });
    if (best < 0) ep.cand.forEach((c, k) => {
      if (c.y === 1 && c.p >= 0.5 && (c.prop || c.h < 0.5) && c.p > bs) { bs = c.p; best = k; }
    });
    return best >= 0 ? { k: best } : { t: 0 };
  }
  function exGeo() {
    const W = Math.max(300, ex.svg.parentElement.clientWidth - 22);
    const LW = W < 520 ? 50 : 72;
    const x0 = LW, x1 = W - 8, pw = x1 - x0;
    const n = Math.max(3, Math.min(8, Math.floor(pw / 86)));
    const fw = Math.min(pw / n - 4, 96), fh = Math.round(fw * 0.625);
    const rows = {};
    let y = 0;
    rows.frames = [y, fh]; y += fh + 8;
    rows.tel = [y, 38]; y += 38 + 6;
    rows.gt = [y, 26]; y += 26 + 12;
    rows.tvf = [y, 60]; y += 60 + 10;
    rows.focus = [y, 60]; y += 60 + 10;
    rows.strata = [y, 24]; y += 24 + 6;
    rows.axis = [y, 18]; y += 18;
    return { W, LW, x0, x1, pw, n, fw, fh, rows, H: y + 4 };
  }
  function drawExplorer() {
    const ep = EPS[ex.ep];
    if (!ep) return;
    const G = (ex.geo = exGeo());
    const svg = ex.svg;
    svg.innerHTML = "";
    svg.setAttribute("viewBox", `0 0 ${G.W} ${G.H}`);
    svg.setAttribute("height", G.H);
    const x = (t) => G.x0 + (t / ep.duration) * G.pw;
    const R = G.rows;
    const narrow = G.W < 520;

    // row labels
    const labels = [["frames", "frames", R.frames], ["robot state", "state", R.tel], ["sub-tasks", "sub-tasks", R.gt], ["TVF", "TVF", R.tvf], ["FOCUS", "FOCUS", R.focus], ["STRATA", "STRATA", R.strata]];
    labels.forEach(([full, short, [yy, hh]], i) => {
      const bold = i >= 3;
      const t = el("text", { x: 0, y: yy + hh / 2 + 4, "font-size": bold ? 13 : 11.5, "font-weight": bold ? 700 : 400, fill: i === 5 ? "var(--accent)" : bold ? "var(--ink)" : "var(--ink-dim)", class: i >= 3 ? `st${i - 1}l` : "" }, svg);
      t.textContent = narrow ? short : full;
    });

    // frames
    const frames = ep.frames;
    const used = new Set();
    for (let i = 0; i < G.n; i++) {
      const c = ep.duration * (i + 0.5) / G.n;
      let best = null, bd = 1e9;
      frames.forEach((f, k) => { if (used.has(k)) return; const d = Math.abs(f.t - c) - (f.key ? 0.4 : 0); if (d < bd) { bd = d; best = k; } });
      if (best == null) continue;
      used.add(best);
      const f = frames[best];
      const cx = x(f.t), left = Math.max(G.x0, Math.min(G.x1 - G.fw, cx - G.fw / 2));
      const cid = `fc${ex.ep}_${i}`;
      const cp = el("clipPath", { id: cid }, svg);
      el("rect", { x: left, y: R.frames[0], width: G.fw, height: G.fh, rx: 4 }, cp);
      el("image", { href: f.src, x: left, y: R.frames[0], width: G.fw, height: G.fh, preserveAspectRatio: "xMidYMid slice", "clip-path": `url(#${cid})` }, svg);
      el("line", { x1: cx, x2: cx, y1: R.frames[0] + G.fh, y2: R.frames[0] + G.fh + 5, stroke: "var(--ink-faint)" }, svg);
      const tt = el("text", { x: left + 4, y: R.frames[0] + G.fh - 5, "font-size": 10, "font-family": "IBM Plex Mono, monospace", fill: "#fff", stroke: "rgba(0,0,0,.55)", "stroke-width": 2.5, "paint-order": "stroke" }, svg);
      tt.textContent = (Math.round(f.t * 10) / 10) + " s";
    }

    // telemetry
    const [ty, th] = R.tel;
    const tcol = ["var(--s0)", "var(--s3)", "var(--s4)", "var(--s2)", "var(--s8)", "var(--s6)"];
    ep.tel.forEach((ch, i) => {
      let d = "";
      ch.forEach((v, k) => { d += (k ? "L" : "M") + x(k * ep.tel_dt).toFixed(1) + "," + (ty + 3 + (1 - v) * (th - 6)).toFixed(1); });
      el("path", { d, fill: "none", stroke: tcol[i % tcol.length], "stroke-width": 1.3, "stroke-opacity": 0.95 }, svg);
    });

    // ground truth layers
    const [gy, gh] = R.gt;
    ep.segments.forEach((s, i) => {
      el("rect", { x: x(s.s) + 0.5, y: gy, width: Math.max(1, x(s.e) - x(s.s) - 1), height: gh, rx: 3, fill: `var(--s${i % 10})` }, svg);
      const wpx = x(s.e) - x(s.s);
      if (wpx > s.label.length * 6.2 + 6) {
        const t = el("text", { x: (x(s.s) + x(s.e)) / 2, y: gy + gh / 2 + 4, "text-anchor": "middle", "font-size": 11, fill: "var(--ink)" }, svg);
        t.textContent = s.label;
      }
    });

    // true-boundary guides across the decision rows
    const gTop = R.tvf[0] - 4, gBot = R.strata[0] + R.strata[1];
    const guides = el("g", { class: "guides" }, svg);
    ep.truth.forEach((t) => {
      el("line", { x1: x(t), x2: x(t), y1: gTop, y2: gBot, stroke: "var(--ink-faint)", "stroke-dasharray": "2 3", "stroke-opacity": 0.6 }, guides);
    });

    const sets = episodeSets(ep);
    // TVF row
    const g2 = el("g", { class: "st2" }, svg);
    const [vy, vh] = R.tvf, vb = vy + vh;
    el("line", { x1: G.x0, x2: G.x1, y1: vb, y2: vb, stroke: "var(--rule)" }, g2);
    el("line", { x1: G.x0, x2: G.x1, y1: vb - 0.5 * (vh - 8), y2: vb - 0.5 * (vh - 8), stroke: "var(--ink-faint)", "stroke-dasharray": "4 4", "stroke-opacity": 0.7 }, g2);
    const thr = el("text", { x: G.x1, y: vb - 0.5 * (vh - 8) - 4, "text-anchor": "end", "font-size": 10, fill: "var(--ink-faint)", "font-family": "IBM Plex Mono, monospace" }, g2);
    thr.textContent = "c = .5";
    ep.cand.forEach((c, k) => {
      if (c.prop) return;
      const top = vb - c.h * (vh - 8), op = c.h >= 0.5 ? 1 : 0.35;
      el("line", { x1: x(c.t), x2: x(c.t), y1: vb, y2: top, stroke: "var(--accent)", "stroke-width": 2.2, "stroke-opacity": op }, g2);
      el("circle", { cx: x(c.t), cy: top, r: 3.4, fill: "var(--accent)", "fill-opacity": op, "data-k": k }, g2);
    });

    // FOCUS row
    const g3 = el("g", { class: "st3" }, svg);
    const [fy, fh] = R.focus, fb = fy + fh;
    el("line", { x1: G.x0, x2: G.x1, y1: fb, y2: fb, stroke: "var(--rule)" }, g3);
    [[0.9, "4 4", "P = .9"], [0.5, "1 3", "P = .5"]].forEach(([v, da, lab]) => {
      const yy = fb - v * (fh - 8);
      el("line", { x1: G.x0, x2: G.x1, y1: yy, y2: yy, stroke: "var(--ink-faint)", "stroke-dasharray": da, "stroke-opacity": 0.7 }, g3);
      const t = el("text", { x: G.x1, y: yy - 4, "text-anchor": "end", "font-size": 10, fill: "var(--ink-faint)", "font-family": "IBM Plex Mono, monospace" }, g3);
      t.textContent = lab;
    });
    ep.cand.forEach((c) => {
      const d = decision(c);
      if (!d) return;
      const cx = x(c.t), top = fb - c.p * (fh - 8);
      if (d === "reject") {
        el("line", { x1: cx, x2: cx, y1: fb, y2: top, stroke: "var(--bad)", "stroke-width": 1.6 }, g3);
        el("path", { d: `M${cx - 4},${top - 4}L${cx + 4},${top + 4}M${cx + 4},${top - 4}L${cx - 4},${top + 4}`, stroke: "var(--bad)", "stroke-width": 2 }, g3);
      } else if (d === "recover") {
        el("line", { x1: cx, x2: cx, y1: fb, y2: top + 5, stroke: "var(--recover)", "stroke-width": 2, "stroke-dasharray": "3 2.5" }, g3);
        el("path", { d: `M${cx},${top - 5}L${cx + 5},${top}L${cx},${top + 5}L${cx - 5},${top}Z`, fill: "var(--card)", stroke: "var(--recover)", "stroke-width": 2 }, g3);
      } else {
        const col = d === "accept" ? "var(--ok)" : "var(--warn)";
        el("line", { x1: cx, x2: cx, y1: fb, y2: top, stroke: col, "stroke-width": 2.2 }, g3);
        el("circle", { cx, cy: top, r: 3.6, fill: col }, g3);
      }
    });

    // STRATA row
    const g4 = el("g", { class: "st4" }, svg);
    const [sy, sh] = R.strata, sc = sy + sh / 2;
    el("rect", { x: G.x0, y: sy, width: G.pw, height: sh, rx: 4, fill: "var(--accent-wash)" }, g4);
    ep.truth.forEach((t) => el("rect", { x: x(t - 1), y: sy - 2, width: x(t + 1) - x(t - 1), height: sh + 4, fill: "var(--ink-faint)", "fill-opacity": 0.16 }, g4));
    sets.kept.forEach((c, i) => {
      if (sets.ms.mp.has(i)) el("circle", { cx: x(c.t), cy: sc, r: 5, fill: "var(--accent)" }, g4);
      else el("path", { d: `M${x(c.t) - 4.5},${sc - 4.5}L${x(c.t) + 4.5},${sc + 4.5}M${x(c.t) + 4.5},${sc - 4.5}L${x(c.t) - 4.5},${sc + 4.5}`, stroke: "var(--bad)", "stroke-width": 2.2 }, g4);
    });
    ep.truth.forEach((t, j) => { if (!sets.ms.mg.has(j)) el("circle", { cx: x(t), cy: sc, r: 4.6, fill: "var(--card)", stroke: "var(--ink-faint)", "stroke-width": 1.8 }, g4); });

    // axis
    const ay = R.axis[0];
    el("line", { x1: G.x0, x2: G.x1, y1: ay, y2: ay, stroke: "var(--rule)" }, svg);
    const step = G.pw < 360 ? 20 : 10;
    for (let t = 0; t <= ep.duration; t += step) {
      el("line", { x1: x(t), x2: x(t), y1: ay, y2: ay + 4, stroke: "var(--ink-faint)" }, svg);
      const tx = el("text", { x: x(t), y: ay + 15, "text-anchor": "middle", "font-size": 10.5, fill: "var(--ink-dim)", "font-family": "IBM Plex Mono, monospace" }, svg);
      tx.textContent = t === 0 ? "0 s" : t;
    }

    // cursor + selection marker
    el("line", { id: "ex-cursor", x1: -10, x2: -10, y1: 0, y2: gBot, stroke: "var(--ink)", "stroke-width": 1, "stroke-opacity": 0.55, "pointer-events": "none" }, svg);
    el("rect", { id: "ex-sel", x: -100, y: gTop - 2, width: 14, height: gBot - gTop + 4, rx: 7, fill: "var(--accent)", "fill-opacity": 0.1, stroke: "var(--accent)", "stroke-opacity": 0.5, "pointer-events": "none" }, svg);
    applyStage();
    updateSide();
  }
  function applyStage() {
    [2, 3, 4].forEach((s) => {
      const on = ex.stage >= s;
      $$(`.st${s}, .st${s}l`, ex.svg).forEach((g) => { g.style.transition = "opacity .35s"; g.style.opacity = on ? 1 : s === 2 || s === 3 || s === 4 ? (g.tagName === "text" ? 0.3 : 0) : 1; });
    });
    $$("#ex-steps button").forEach((b) => {
      const s = +b.dataset.stage;
      b.setAttribute("aria-pressed", String(s === ex.stage));
      b.classList.toggle("done", s < ex.stage);
    });
    const ep = EPS[ex.ep], sets = episodeSets(ep);
    const parts = [];
    if (ex.stage >= 2) parts.push(`<span>TVF F1 <b>${Math.round(sets.mt.f1 * 100)}</b></span>`);
    if (ex.stage >= 4) parts.push(`<span class="s">STRATA F1 <b>${Math.round(sets.ms.f1 * 100)}</b></span>`);
    $("#ex-f1").innerHTML = parts.length ? parts.join("") + `<span style="font-weight:500">at ±1 s</span>` : `<span style="font-weight:500">${ep.truth.length} true boundaries, ${ep.duration.toFixed(0)} s</span>`;
  }
  function visibleCands() {
    const ep = EPS[ex.ep];
    return ep.cand
      .map((c, k) => ({ c, k }))
      .filter(({ c }) => (ex.stage >= 3 ? !!decision(c) : ex.stage >= 2 ? !c.prop : false))
      .sort((a, b) => a.c.t - b.c.t);
  }
  function tAt(clientX) {
    const r = ex.svg.getBoundingClientRect(), G = ex.geo, ep = EPS[ex.ep];
    const px = ((clientX - r.left) / r.width) * G.W;
    return Math.max(0, Math.min(ep.duration, ((px - G.x0) / G.pw) * ep.duration));
  }
  function nearestCand(t) {
    const G = ex.geo, ep = EPS[ex.ep], perPx = ep.duration / G.pw;
    let best = null, bd = Math.max(0.6, 12 * perPx);
    visibleCands().forEach(({ c, k }) => { const d = Math.abs(c.t - t); if (d < bd) { bd = d; best = k; } });
    return best;
  }
  function updateSide() {
    const ep = EPS[ex.ep];
    const sel = ex.hover != null ? ex.hover : ex.pinned;
    let t = sel && sel.k != null ? ep.cand[sel.k].t : sel ? sel.t : 0;
    const G = ex.geo, x = (tt) => G.x0 + (tt / ep.duration) * G.pw;
    const cur = $("#ex-cursor", ex.svg), selR = $("#ex-sel", ex.svg);
    if (cur) { cur.setAttribute("x1", x(t)); cur.setAttribute("x2", x(t)); }
    if (selR) selR.setAttribute("x", sel && sel.k != null ? x(t) - 7 : -100);
    // frame
    let f = ep.frames[0], fd = 1e9;
    ep.frames.forEach((ff) => { const d = Math.abs(ff.t - t); if (d < fd) { fd = d; f = ff; } });
    const img = $("#ex-img");
    if (img.getAttribute("src") !== f.src) img.src = f.src;
    $("#ex-t").textContent = t.toFixed(1) + " s";
    $("#ex-note").textContent = fd > 0.35 ? `nearest frame ${f.t} s` : "";
    // sub-task
    let si = ep.segments.findIndex((s) => t >= s.s && t < s.e);
    if (si < 0) si = t < ep.segments[0].s ? 0 : ep.segments.length - 1;
    const s = ep.segments[si];
    $("#ex-sub").innerHTML = `<b>${si + 1}. ${s.label}</b>${s.text}`;
    // candidate
    const box = $("#ex-cand");
    if (!sel || sel.k == null || ex.stage < 2) {
      box.innerHTML = `<div class="ex-empty">${ex.stage < 2 ? "Step 2 adds TVF's candidate boundaries." : "No candidate boundary here. Move along the timeline or use the arrow keys."}</div>`;
      return;
    }
    const c = ep.cand[sel.k], d = decision(c);
    const rows = [];
    rows.push(`<div class="row"><span>${c.prop ? "Proposed by FOCUS (structure model)" : "TVF candidate"}</span><b>${c.t.toFixed(1)} s</b></div>`);
    if (!c.prop) rows.push(`<div class="row"><span>TVF confidence c</span><b>${fmt(c.h)}</b></div>`);
    if (ex.stage >= 3) {
      rows.push(`<div class="row"><span>FOCUS probability P</span><b>${fmt(c.p)}</b></div>`);
      const name = { accept: "accept", review: "send to review", reject: "reject", recover: "recovered miss" }[d];
      rows.push(`<div class="row"><span>Decision</span><span class="pill ${d}">${name}</span></div>`);
    }
    const gt = ep.truth.reduce((b, g) => (Math.abs(g - c.t) < Math.abs(b - c.t) ? g : b), ep.truth[0]);
    rows.push(`<div class="row"><span>Ground truth</span>${c.y ? `<span class="pill true">✓ true boundary (${gt.toFixed(1)} s)</span>` : `<span class="pill false">✗ false alarm</span>`}</div>`);
    box.innerHTML = rows.join("");
  }
  function pinNearest(t) { const k = nearestCand(t); ex.pinned = k != null ? { k } : { t }; ex.hover = null; updateSide(); }
  function setEpisode(i) {
    ex.ep = i;
    const ep = EPS[i];
    $$("#ex-eps .pick").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.i === i)));
    $("#ex-title").innerHTML = `<b>${ep.name}</b><span>${ep.bench} · ${Math.round(ep.duration)} s · ${ep.truth.length} true boundaries</span>`;
    drawExplorer();
    ex.pinned = defaultPin(ep);
    updateSide();
  }
  function initExplorer() {
    if (!EPS.length) return;
    const box = $("#ex-eps");
    const groups = [];
    EPS.forEach((ep, i) => {
      let g = groups.find((x) => x.bench === ep.bench);
      if (!g) { g = { bench: ep.bench, items: [] }; groups.push(g); }
      g.items.push(i);
    });
    groups.forEach((g) => {
      const row = h("div", { class: "prow" }, `<span class="plabel">${g.bench}</span>`);
      const cards = h("div", { class: "pcards" });
      g.items.forEach((i) => {
        const ep = EPS[i], sets = episodeSets(ep);
        const keys = ep.frames.filter((f) => f.key);
        const th = (keys.length ? keys : ep.frames)[Math.floor((keys.length ? keys : ep.frames).length / 2)];
        const b = h("button", { type: "button", class: "pick", "data-i": i, "aria-pressed": "false" },
          `<img src="${th.src}" alt="" loading="lazy"><span><b>${ep.name}</b><span class="gain">F1 ${Math.round(sets.mt.f1 * 100)} → <em>${Math.round(sets.ms.f1 * 100)}</em></span></span>`);
        b.addEventListener("click", () => setEpisode(i));
        cards.appendChild(b);
      });
      row.appendChild(cards);
      box.appendChild(row);
    });
    $$("#ex-steps button").forEach((b) => b.addEventListener("click", () => {
      ex.stage = +b.dataset.stage;
      applyStage();
      const vis = visibleCands().map((v) => v.k);
      if (ex.pinned && ex.pinned.k != null && !vis.includes(ex.pinned.k)) ex.pinned = { t: EPS[ex.ep].cand[ex.pinned.k].t };
      updateSide();
    }));
    const svg = ex.svg;
    svg.addEventListener("pointermove", (e) => {
      const t = tAt(e.clientX), k = nearestCand(t);
      ex.hover = k != null ? { k } : { t };
      updateSide();
    });
    svg.addEventListener("pointerleave", () => { ex.hover = null; updateSide(); });
    svg.addEventListener("click", (e) => pinNearest(tAt(e.clientX)));
    svg.addEventListener("keydown", (e) => {
      const vis = visibleCands();
      if (!vis.length || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const cur = ex.pinned && ex.pinned.k != null ? vis.findIndex((v) => v.k === ex.pinned.k) : -1;
      let n = cur;
      if (e.key === "ArrowRight") n = Math.min(vis.length - 1, cur + 1);
      if (e.key === "ArrowLeft") n = Math.max(0, cur < 0 ? 0 : cur - 1);
      if (e.key === "Home") n = 0;
      if (e.key === "End") n = vis.length - 1;
      ex.pinned = { k: vis[n].k };
      ex.hover = null;
      updateSide();
    });
    setEpisode(0);
  }

  /* ---------------- TVF: modality ablation (Table 5, Galaxea OOD F1@1 s) ---------------- */
  function bars(container, rows, max) {
    container.innerHTML = "";
    rows.forEach((r) => {
      const row = h("div", { class: "brow" + (r.cls ? " " + r.cls : "") });
      row.innerHTML = `<span class="name" title="${r.name}">${r.name}${r.tag ? `<small>${r.tag}</small>` : ""}</span><span class="track"><span class="fill" style="width:${(100 * r.v) / max}%"></span></span><span class="val">${r.v == null ? "–" : r.v.toFixed(1)}</span>`;
      container.appendChild(row);
    });
  }
  const abl = $("#abl");
  if (abl) bars(abl, [
    { name: "3 cameras + telemetry", v: 43.7, cls: "ours" },
    { name: "telemetry only", v: 41.2 },
    { name: "without wrist cameras", v: 41.0 },
    { name: "without telemetry", v: 32.5 },
    { name: "head camera only", v: 30.0 },
  ], 50);

  /* ---------------- FOCUS: dumbbells (Table 2) ---------------- */
  const DUMB = [
    { title: "Error-detection AUROC ↑", lo: 50, hi: 90, rows: [
      ["AgiBot World Alpha", 59.8, 69.6, 78.5], ["AgiBot World 2026", 66.9, 71.4, 83.9], ["Galaxea Open-World", 61.9, 70.0, 75.1]] },
    { title: "Calibration error, ECE ↓", lo: 0, hi: 25, rows: [
      ["AgiBot World Alpha", 23.0, null, 2.7], ["AgiBot World 2026", 15.4, null, 1.3], ["Galaxea Open-World", 21.0, null, 1.1]] },
    { title: "Boundary F1@1 s after filtering ↑", lo: 40, hi: 75, rows: [
      ["AgiBot World Alpha", 61.6, null, 66.0], ["AgiBot World 2026", 65.7, null, 71.5], ["Galaxea Open-World", 45.9, null, 52.7]] },
  ];
  function drawDumb() {
    const box = $("#dumb");
    if (!box) return;
    box.innerHTML = "";
    DUMB.forEach((set, si) => {
      const wrap = h("div", { class: "dumb-set" }, `<h4>${set.title}</h4>`);
      set.rows.forEach(([name, raw, probe, ours]) => {
        const W = 100, pos = (v) => ((v - set.lo) / (set.hi - set.lo)) * W;
        const a = pos(raw), b = pos(ours), lo = Math.min(a, b), hi = Math.max(a, b);
        const row = h("div", { class: "drow" });
        row.innerHTML = `<span>${name}</span><div style="position:relative;height:30px">
          <div style="position:absolute;left:0;right:0;top:14px;height:2px;background:var(--paper-2);border-radius:2px"></div>
          <div style="position:absolute;left:${lo}%;width:${hi - lo}%;top:14px;height:2px;background:color-mix(in srgb,var(--accent) 55%,transparent)"></div>
          ${probe != null ? `<div title="best few-shot probe ${probe}" style="position:absolute;left:${pos(probe)}%;top:9px;width:12px;height:12px;margin-left:-6px;border-radius:50%;border:2px solid var(--ink-faint);background:var(--card)"></div>` : ""}
          <div style="position:absolute;left:${a}%;top:9px;width:12px;height:12px;margin-left:-6px;border-radius:50%;background:var(--bar)"></div>
          <div style="position:absolute;left:${b}%;top:8px;width:14px;height:14px;margin-left:-7px;border-radius:50%;background:var(--accent)"></div>
          <span class="mono" style="position:absolute;left:${a}%;top:-6px;transform:translateX(-50%);font-size:11px;color:var(--ink-dim)">${raw.toFixed(1)}</span>
          <span class="mono" style="position:absolute;left:${b}%;top:-6px;transform:translateX(-50%);font-size:11.5px;font-weight:600;color:var(--accent-ink)">${ours.toFixed(1)}</span>
        </div>`;
        wrap.appendChild(row);
      });
      if (si === 0) wrap.appendChild(h("div", { class: "legend", style: "font-size:12.5px;color:var(--ink-dim);margin-top:2px" },
        `<span><i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--bar)"></i>raw confidence</span>
         <span><i style="display:inline-block;width:10px;height:10px;border-radius:50%;border:2px solid var(--ink-faint)"></i>best few-shot probe</span>
         <span><i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--accent)"></i>FOCUS</span>`));
      box.appendChild(wrap);
    });
  }
  drawDumb();

  /* ---------------- Results: Table 1 (+ STRATA from Tables 2, 13, 15) ---------------- */
  const METHODS = [
    ["MS-TCN++", "TAS"], ["ASFormer", "TAS"], ["ASRF", "TAS"], ["C2F-TCN", "TAS"], ["DiffAct", "TAS"], ["LTContext", "TAS"],
    ["TriDet", "TAD"], ["ActionFormer", "TAD"], ["DiGIT", "TAD"], ["EfficientGEBD", "GEBD"], ["DiffGEBD", "GEBD"],
    ["RoboSegNet", "Robot"], ["Flora", "Robot"], ["TVF (ours)", "ours"],
  ];
  // rows follow METHODS; columns: ID .5/1/1.5, OOD .5/1/1.5 (Flora has no ID score)
  const T1 = {
    alpha: [[61.2, 83.2, 89.4, 23.3, 38.4, 46.9], [59.6, 80.7, 85.8, 24.5, 40.4, 50.3], [63.2, 85.8, 91.1, 28.1, 45.2, 53.2],
      [63.3, 85.6, 91.1, 21.8, 37.7, 48.7], [41.8, 71.5, 85.2, 17.9, 33.2, 43.9], [55.7, 79.6, 86.8, 20.2, 35.4, 46.5],
      [76.6, 94.3, 97.6, 35.7, 55.9, 65.6], [78.3, 93.8, 97.4, 38.9, 60.6, 70.3], [77.5, 94.0, 97.3, 38.8, 60.7, 70.7],
      [71.6, 88.0, 91.5, 33.5, 51.1, 62.4], [55.0, 71.9, 75.9, 23.3, 31.4, 39.7], [60.1, 78.3, 83.9, 37.1, 53.6, 60.5],
      [null, null, null, 24.1, 42.9, 61.3], [74.7, 93.8, 97.5, 41.4, 62.4, 71.5]],
    ag26: [[36.7, 52.2, 60.4, 21.3, 33.6, 41.1], [27.1, 47.1, 58.4, 16.9, 29.0, 36.8], [54.9, 65.9, 70.9, 27.6, 36.4, 39.9],
      [39.8, 57.5, 66.8, 23.7, 38.8, 47.6], [14.6, 27.2, 37.5, 13.9, 25.9, 34.8], [34.2, 51.9, 60.4, 16.6, 27.7, 35.2],
      [75.2, 86.8, 89.2, 25.6, 33.3, 36.1], [78.5, 88.4, 90.5, 22.3, 27.8, 30.6], [78.9, 87.6, 90.3, 30.0, 39.3, 44.6],
      [78.8, 81.4, 82.8, 45.3, 48.3, 49.4], [75.6, 81.1, 82.1, 22.9, 26.1, 27.6], [60.8, 69.5, 71.4, 32.0, 43.7, 48.1],
      [null, null, null, 36.1, 54.7, 63.2], [85.3, 89.8, 91.2, 55.9, 64.6, 68.1]],
    gx: [[13.8, 25.6, 34.5, 5.4, 9.7, 13.5], [14.7, 27.0, 35.4, 8.1, 15.3, 21.0], [25.3, 42.6, 50.8, 9.1, 18.3, 24.3],
      [29.3, 50.1, 61.2, 12.8, 22.7, 30.0], [6.3, 12.0, 17.9, 5.1, 9.6, 15.1], [17.2, 29.3, 37.4, 4.9, 9.3, 13.0],
      [47.1, 67.3, 76.7, 15.0, 26.3, 33.0], [49.1, 70.2, 78.6, 15.5, 27.9, 35.2], [48.4, 69.5, 77.3, 16.8, 28.3, 36.0],
      [21.3, 29.5, 32.6, 14.6, 19.9, 21.9], [14.9, 25.1, 31.7, 12.0, 21.1, 26.0], [31.1, 51.1, 61.9, 14.0, 26.2, 33.0],
      [null, null, null, 8.8, 17.3, 23.9], [53.4, 70.5, 76.0, 30.5, 43.7, 50.4]],
  };
  // STRATA = TVF candidates filtered by FOCUS with L = 5 labelled recordings per unseen task.
  // F1@.5 from Table 13 (select by q_k), F1@1 from Table 2, F1@1.5 from Table 15 (matching tolerance 1.5 s).
  const STRATA = { alpha: [44.1, 66.0, 75.5], ag26: [60.4, 71.5, 76.3], gx: [37.0, 52.7, 61.2] };
  const BENCH = { alpha: "AgiBot World Alpha", ag26: "AgiBot World 2026", gx: "Galaxea Open-World" };
  const TOL = ["0.5", "1", "1.5"];
  const res = { bench: "ag26", split: "ood", tol: 1 };
  let resFirst = true;
  function drawResults() {
    const col = (res.split === "ood" ? 3 : 0) + res.tol;
    let rows = METHODS.map(([name, fam], i) => ({ name, fam, v: T1[res.bench][i][col] })).filter((r) => r.v != null);
    const base = rows.filter((r) => r.fam !== "ours").sort((a, b) => b.v - a.v);
    const best = base[0], tvf = rows.find((r) => r.fam === "ours");
    if (res.split === "ood") rows.push({ name: "STRATA (TVF + FOCUS)", fam: "strata", v: STRATA[res.bench][res.tol] });
    rows.sort((a, b) => b.v - a.v);
    const box = $("#res-bars");
    const old = {};
    $$(".brow", box).forEach((r) => { old[r.dataset.name] = r.querySelector(".fill").style.width; });
    box.innerHTML = "";
    rows.forEach((r) => {
      const cls = r.fam === "ours" ? "ours" : r.fam === "strata" ? "strata" : r === best ? "best-base" : "";
      const tag = r.fam === "ours" ? "" : r.fam === "strata" ? "5 labels / task" : r.fam;
      const row = h("div", { class: "brow " + cls, "data-name": r.name });
      const w = r.v + "%";
      row.innerHTML = `<span class="name" title="${r.name}">${r.name}${tag ? `<small>${tag}</small>` : ""}</span><span class="track"><span class="fill" style="width:${resFirst || reduced ? w : old[r.name] || "0%"}"></span></span><span class="val">${r.v.toFixed(1)}</span>`;
      box.appendChild(row);
      if (!resFirst && !reduced) requestAnimationFrame(() => requestAnimationFrame(() => { row.querySelector(".fill").style.width = w; }));
    });
    resFirst = false;
    $("#res-title").textContent = `${BENCH[res.bench]} · ${res.split === "ood" ? "unseen" : "seen"} tasks · F1 at ±${TOL[res.tol]} s`;
    const diff = tvf.v - best.v;
    $("#res-sub").innerHTML = diff >= 0
      ? `TVF <b style="color:var(--accent-ink)">+${diff.toFixed(1)}</b> over the best baseline (${best.name})`
      : `TVF ${diff.toFixed(1)} behind the best baseline (${best.name})`;
    const notes = [];
    if (res.split === "ood") notes.push("STRATA filters TVF's candidates with FOCUS and uses 5 labelled recordings of each unseen task; every other row uses no labels of the unseen task. Sources: Table 1; STRATA from Tables 2, 13 and 15.");
    else notes.push("Flora is applied zero-shot with its released model, so it has no seen-task score. Source: Table 1.");
    $("#res-note").textContent = notes.join(" ");
  }
  $$("#res-controls .seg").forEach((seg) => {
    const key = seg.dataset.key;
    $$("button", seg).forEach((b) => b.addEventListener("click", () => {
      $$("button", seg).forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
      res[key] = key === "tol" ? +b.dataset.v : b.dataset.v;
      drawResults();
    }));
  });
  drawResults();

  /* ---------------- gallery (Figs. 5–8) ---------------- */
  const GAL = {
    fig5_alpha: "<b>Figure 5.</b> Zero-shot qualitative results on AgiBot World Alpha unseen tasks.",
    fig6_agibot2026: "<b>Figure 6.</b> Zero-shot qualitative results on AgiBot World 2026 unseen tasks.",
    fig7_galaxea: "<b>Figure 7.</b> Zero-shot qualitative results on Galaxea Open-World unseen tasks.",
    fig8_humanoid: "<b>Figure 8.</b> Qualitative results on our humanoid dataset.",
  };
  $$("#gal-tabs button").forEach((b) => b.addEventListener("click", () => {
    $$("#gal-tabs button").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
    $("#gal-img").src = `static/img/paper/${b.dataset.fig}.webp`;
    $("#gal-cap").innerHTML = GAL[b.dataset.fig];
  }));

  /* ---------------- BibTeX ---------------- */
  const cp = $("#copy-bib");
  if (cp) cp.addEventListener("click", () => {
    const text = $("#bib").textContent;
    const done = () => { cp.textContent = "Copied"; setTimeout(() => (cp.textContent = "Copy"), 1600); };
    const fallback = () => { const r = document.createRange(); r.selectNodeContents($("#bib")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); cp.textContent = "Selected, press Ctrl+C"; };
    try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
  });

  /* ---------------- boot ---------------- */
  drawHero();
  initExplorer();
  initVideos();
  (function loop() { heroTick(); cardsTick(); requestAnimationFrame(loop); })();
  let lastW = window.innerWidth;
  window.addEventListener("resize", debounce(() => {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    drawHero();
    if (EPS.length) drawExplorer();
  }, 150));
})();
