"""Cache-busting: give every local CSS / JS link in index.html a ?v=<content hash> suffix.

GitHub Pages lets browsers keep files for 10 minutes, so after a push a browser can combine the new index.html with an
old main.js or site.css. With the hash in the URL, a new page always asks for the matching new files.
Run before every commit that changes CSS / JS / data:   python3 tools/stamp.py
"""
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "index.html"


def stamp(match):
    attr, path = match.group(1), match.group(2)
    f = ROOT / path
    if not f.exists():
        return match.group(0)
    h = hashlib.sha1(f.read_bytes()).hexdigest()[:8]
    return f'{attr}="{path}?v={h}"'


if __name__ == "__main__":
    s = INDEX.read_text()
    new = re.sub(r'(src|href)="(static/[^"?]+\.(?:js|css))(?:\?v=[0-9a-f]+)?"', stamp, s)
    INDEX.write_text(new)
    for m in re.finditer(r'(?:src|href)="(static/[^"]+\.(?:js|css)\?v=[0-9a-f]+)"', new):
        print(m.group(1))
