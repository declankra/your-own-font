"""UJI Pen Characters v2 (CC BY 4.0): download and parse.

Prat, F., Castro, M., Llorens, D., Marzal, A., & Vilar, J. (2008). UJI Pen Characters
(Version 2) [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C5FG8S
"""
from __future__ import annotations

import re
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np

URL = "https://archive.ics.uci.edu/static/public/177/uji+pen+characters+version+2.zip"
# Box geometry from uji2.names: guides at ~7.5 mm and ~12.7 mm from the box top.
GUIDE_TOP_MM = 7.5
GUIDE_BASE_MM = 12.7


@dataclass
class UjiSample:
    char: str
    writer: str  # e.g. "UJI_W01"
    session: str  # e.g. "UJI_W01-01"
    official_split: str  # "trn" | "tst" (the dataset's own split; we make our own)
    strokes: list[np.ndarray]  # each (n, 2) float64, millimetres, y down, box origin


def download(raw_dir: Path) -> Path:
    raw_dir.mkdir(parents=True, exist_ok=True)
    txt = raw_dir / "uji2" / "ujipenchars2.txt"
    if txt.exists():
        return txt
    zpath = raw_dir / "uji2.zip"
    if not zpath.exists():
        urllib.request.urlretrieve(URL, zpath)
    with zipfile.ZipFile(zpath) as z:
        z.extractall(raw_dir / "uji2")
    return txt


def parse(txt: Path) -> list[UjiSample]:
    out: list[UjiSample] = []
    scale = 100.0
    lines = txt.read_text(encoding="utf-8").splitlines()
    i = 0
    while i < len(lines):
        ln = lines[i].strip()
        if ln.startswith("// UJI:"):
            scale = 100.0
        elif ln.startswith("// UPV:"):
            scale = 152.0
        if ln.startswith("WORD"):
            m = re.match(r"WORD (\S+) (trn|tst)_(\w+)_(W\d+)-(\d+)", ln)
            assert m, ln
            ch, split, site, w, rep = m.groups()
            n = int(lines[i + 1].split()[1])
            strokes = []
            for k in range(n):
                parts = lines[i + 2 + k].split("#")[1].split()
                xy = np.array(parts, dtype=np.float64).reshape(-1, 2) / scale
                # drop consecutive duplicate points (the dataset keeps runs of them)
                keep = np.ones(len(xy), bool)
                keep[1:] = np.any(np.diff(xy, axis=0) != 0, axis=1)
                strokes.append(xy[keep])
            out.append(UjiSample(ch, f"{site}_{w}", f"{site}_{w}-{rep}", split, strokes))
            i += 2 + n
            continue
        i += 1
    return out
