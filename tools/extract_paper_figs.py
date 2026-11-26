"""Cut the paper's figures out of the final PDF for the project page.

Usage (from strata_web/):  python3 tools/extract_paper_figs.py paper/strata.pdf
Writes static/img/paper/fig{1,2,4,5,6,7,8,9}_*.webp. Fig. 2 comes from paper/cvpr_pipeline.pdf when present. The page hides any figure whose file is missing.

Boxes are page fractions (x0, y0, x1, y1); y1 sits just above each caption (pdftotext -bbox) on the 24-page CVPR 2027 submission PDF
(11 main pages + 13 supplementary). Each crop is generous and then trimmed to the non-white
content, so small layout shifts do not matter. If a figure moves to another page, edit PAGES.
"""
import os, subprocess, sys, tempfile
from PIL import Image, ImageOps

PAGES = {
    # name: (pdf page, box)
    "fig1_overview": (1, (0.08, 0.262, 0.92, 0.449)),
    "fig2_pipeline": (4, (0.08, 0.070, 0.92, 0.397)),
    "fig4_pareto": (16, (0.08, 0.075, 0.92, 0.328)),
    "fig5_alpha": (20, (0.08, 0.190, 0.92, 0.762)),
    "fig6_agibot2026": (21, (0.08, 0.170, 0.92, 0.787)),
    "fig7_galaxea": (22, (0.08, 0.160, 0.92, 0.800)),
    "fig8_humanoid": (23, (0.08, 0.270, 0.92, 0.683)),
    "fig9_example": (24, (0.08, 0.260, 0.92, 0.698)),
}
DPI = 300
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "img", "paper")


def trim(im, pad=14, thresh=245):
    g = ImageOps.grayscale(im)
    mask = g.point(lambda v: 255 if v < thresh else 0)
    bbox = mask.getbbox()
    if not bbox:
        return im
    x0, y0, x1, y1 = bbox
    return im.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)))


def main(pdf):
    os.makedirs(OUT, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for name, (page, (x0, y0, x1, y1)) in PAGES.items():
            stem = os.path.join(tmp, f"p{page}")
            if not os.path.exists(stem + ".png"):
                subprocess.run(["pdftoppm", "-f", str(page), "-l", str(page), "-r", str(DPI), "-png",
                                "-singlefile", pdf, stem], check=True)
            pg = Image.open(stem + ".png").convert("RGB")
            W, H = pg.size
            fig = trim(pg.crop((int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H))))
            if fig.width > 2400:
                fig = fig.resize((2400, round(fig.height * 2400 / fig.width)), Image.LANCZOS)
            path = os.path.join(OUT, name + ".webp")
            fig.save(path, "WEBP", quality=90, method=6)
            print(f"{name:18s} page {page:2d} -> {fig.size[0]}x{fig.size[1]}  {os.path.getsize(path) // 1024} KB")
    # Fig. 2: prefer the standalone pipeline PDF (vector source, sharper than the page crop).
    standalone = os.path.join(os.path.dirname(os.path.abspath(pdf)), "cvpr_pipeline.pdf")
    if os.path.exists(standalone):
        with tempfile.TemporaryDirectory() as tmp:
            stem = os.path.join(tmp, "pipe")
            subprocess.run(["pdftoppm", "-r", "150", "-png", "-singlefile", standalone, stem], check=True)
            fig = trim(Image.open(stem + ".png").convert("RGB"), pad=6)
            fig = fig.resize((2400, round(fig.height * 2400 / fig.width)), Image.LANCZOS)
            path = os.path.join(OUT, "fig2_pipeline.webp")
            fig.save(path, "WEBP", quality=92, method=6)
            print(f"fig2_pipeline      standalone {os.path.basename(standalone)} -> {fig.size[0]}x{fig.size[1]}  {os.path.getsize(path) // 1024} KB")
    with open(os.path.join(OUT, "extracted.js"), "w") as f:
        f.write("// Written by tools/extract_paper_figs.py: figures cut from the final PDF.\n")
        f.write("window.STRATA_PAPER_FIGS = " + repr(list(PAGES)).replace("'", '"') + ";\n")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
