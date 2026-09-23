"""Write letter-model.bin: "LMDL", u32 LE header length, UTF-8 JSON header, zero padding to
4 bytes, then fp16 LE tensors in header order. Read it back into a FoldedNet for evaluation,
so the reported metrics are the shipped weights'."""
from __future__ import annotations

import json
import struct
from datetime import date
from pathlib import Path

import numpy as np
import torch

from .classes import CLASSES
from .model import FoldedNet, LetterNet, export_arch, fold
from .raster import COLS, RADIUS_XH, ROWS, SCALAR_NAMES, SPAN_XH, TOP_XH


def write_bin(path: Path, net: LetterNet, priors: dict, segmenter: dict | None,
              data_hash: str, extra: dict | None = None) -> dict:
    arch = export_arch(net)
    tensors = fold(net)
    entries = []
    blobs = []
    off = 0
    for L in arch:
        if L["op"] in ("conv", "dense"):
            for suf in (".w", ".b"):
                name = L["name"] + suf
                t = tensors[name].numpy().astype("<f2")
                entries.append({"name": name, "shape": list(t.shape), "offset": off, "length": int(t.size)})
                blobs.append(t.tobytes())
                off += int(t.size)
    header = {
        "format": "letter-model",
        "version": 1,
        "classes": CLASSES,
        "input": {"rows": ROWS, "cols": COLS, "topXh": TOP_XH, "spanXh": SPAN_XH,
                  "radiusXh": RADIUS_XH, "scalars": SCALAR_NAMES},
        "arch": arch,
        "tensors": entries,
        "priors": priors,
        "segmenter": segmenter or {},
        "trainingDataHash": data_hash,
        "createdAt": date.today().isoformat(),
        **(extra or {}),
    }
    hb = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    pad = (4 - (8 + len(hb)) % 4) % 4
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        f.write(b"LMDL")
        f.write(struct.pack("<I", len(hb)))
        f.write(hb)
        f.write(b"\0" * pad)
        for b in blobs:
            f.write(b)
    return header


def read_bin(path: Path) -> tuple[dict, FoldedNet]:
    raw = path.read_bytes()
    assert raw[:4] == b"LMDL"
    hlen = struct.unpack("<I", raw[4:8])[0]
    header = json.loads(raw[8 : 8 + hlen].decode("utf-8"))
    off = 8 + hlen
    off += (4 - off % 4) % 4
    tensors = {}
    for t in header["tensors"]:
        a = np.frombuffer(raw, dtype="<f2", count=t["length"], offset=off + 2 * t["offset"])
        tensors[t["name"]] = torch.from_numpy(a.astype(np.float32).reshape(t["shape"]))
    sc = next(L for L in header["arch"] if L["op"] == "scalars")
    return header, FoldedNet(tensors, header["arch"], sc["mean"], sc["std"])
