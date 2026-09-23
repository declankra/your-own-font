"""The network. Layers are described by the same specs the TypeScript runtime reads
(packages/pipeline/src/letter-model/model.ts), so export is a straight copy: BatchNorm is
folded into the preceding conv, weights are written as fp16."""
from __future__ import annotations

import copy

import torch
import torch.nn as nn
import torch.nn.functional as F

from .classes import N_CLASSES
from .raster import COLS, N_SCALARS, ROWS


def conv(name, cin, cout, k=3, stride=1, groups=1, relu=True):
    return {"op": "conv", "name": name, "cin": cin, "cout": cout, "k": k, "stride": stride,
            "groups": groups, "relu": relu}


def dense(name, i, o, relu=True):
    return {"op": "dense", "name": name, "in": i, "out": o, "relu": relu}


def _arch_ds(c1=16, c2=32, c3=64, hidden=64):
    """Depthwise-separable trunk: 40x32 -> 20x16 -> 10x8 -> 5x4, pooled over x."""
    return [
        conv("c1", 1, c1, 3, 2),
        conv("d2", c1, c1, 3, 2, groups=c1),
        conv("p2", c1, c2, 1, 1),
        conv("d3", c2, c2, 3, 2, groups=c2),
        conv("p3", c2, c3, 1, 1),
        {"op": "poolx"},
        {"op": "scalars"},
        dense("f1", c3 * 5 + N_SCALARS, hidden),
        dense("f2", hidden, N_CLASSES, relu=False),
    ]


def _arch_ds_flat(c1=16, c2=32, c3=48, hidden=64):
    return [
        conv("c1", 1, c1, 3, 2),
        conv("d2", c1, c1, 3, 2, groups=c1),
        conv("p2", c1, c2, 1, 1),
        conv("d3", c2, c2, 3, 2, groups=c2),
        conv("p3", c2, c3, 1, 1),
        {"op": "flatten"},
        {"op": "scalars"},
        dense("f1", c3 * 20 + N_SCALARS, hidden),
        dense("f2", hidden, N_CLASSES, relu=False),
    ]


def _arch_s1(c0=8, c1=24, c2=32, c3=48, hidden=64, head="flatten"):
    """Full-resolution first layer (cheap: the raster is ~88% zeros), then separable
    blocks 40x32 -> 20x16 -> 10x8 -> 5x4."""
    n = c3 * 20 if head == "flatten" else c3 * 5
    return [
        conv("c0", 1, c0, 3, 1),
        conv("d1", c0, c0, 3, 2, groups=c0),
        conv("p1", c0, c1, 1, 1),
        conv("d2", c1, c1, 3, 2, groups=c1),
        conv("p2", c1, c2, 1, 1),
        conv("d3", c2, c2, 3, 2, groups=c2),
        conv("p3", c2, c3, 1, 1),
        {"op": head},
        {"op": "scalars"},
        dense("f1", n + N_SCALARS, hidden),
        dense("f2", hidden, N_CLASSES, relu=False),
    ]


def _arch_spec():
    """The starting architecture of docs/letter-model.md §6 (~9M MACs; too slow in JS)."""
    return [
        conv("c1", 1, 16), conv("c2", 16, 16), conv("c3", 16, 32, stride=2),
        conv("c4", 32, 32), conv("c5", 32, 64, stride=2),
        {"op": "gap"}, {"op": "scalars"},
        dense("f1", 64 + N_SCALARS, 64), dense("f2", 64, N_CLASSES, relu=False),
    ]


ARCHS = {
    "ds12": lambda: _arch_ds(12, 24, 48, 48),
    "ds16": lambda: _arch_ds(16, 32, 64, 64),
    "ds24": lambda: _arch_ds(24, 48, 64, 96),
    "dsflat": lambda: _arch_ds_flat(16, 32, 48, 64),
    "s1flat": lambda: _arch_s1(8, 24, 32, 48, 64, "flatten"),
    "s1pool": lambda: _arch_s1(8, 24, 32, 64, 64, "poolx"),
    "s1small": lambda: _arch_s1(8, 16, 24, 32, 48, "flatten"),
    "spec": _arch_spec,
}


def macs(arch: list[dict]) -> int:
    h, w, c = ROWS, COLS, 1
    total = 0
    n = 0
    for L in arch:
        if L["op"] == "conv":
            ho, wo = (h - 1) // L["stride"] + 1, (w - 1) // L["stride"] + 1
            per = L["k"] * L["k"] * (L["cin"] // L["groups"])
            total += ho * wo * L["cout"] * per
            h, w, c = ho, wo, L["cout"]
        elif L["op"] == "poolx":
            n = c * h
        elif L["op"] == "gap":
            n = c
        elif L["op"] == "flatten":
            n = c * h * w
        elif L["op"] == "dense":
            total += L["in"] * L["out"]
    return total


class LetterNet(nn.Module):
    def __init__(self, arch: list[dict], scalar_mean=None, scalar_std=None):
        super().__init__()
        self.arch = copy.deepcopy(arch)
        self.convs = nn.ModuleDict()
        self.bns = nn.ModuleDict()
        self.denses = nn.ModuleDict()
        for L in self.arch:
            if L["op"] == "conv":
                self.convs[L["name"]] = nn.Conv2d(L["cin"], L["cout"], L["k"], L["stride"],
                                                  padding=L["k"] // 2, groups=L["groups"], bias=False)
                self.bns[L["name"]] = nn.BatchNorm2d(L["cout"])
            elif L["op"] == "dense":
                self.denses[L["name"]] = nn.Linear(L["in"], L["out"])
        self.register_buffer("smean", torch.zeros(N_SCALARS) if scalar_mean is None else torch.as_tensor(scalar_mean, dtype=torch.float32))
        self.register_buffer("sstd", torch.ones(N_SCALARS) if scalar_std is None else torch.as_tensor(scalar_std, dtype=torch.float32))
        self.dropout = nn.Dropout(0.1)

    def forward(self, x, s):
        # x: (B, 1, 40, 32) in [0, 1]; s: (B, 7)
        for L in self.arch:
            op = L["op"]
            if op == "conv":
                x = self.bns[L["name"]](self.convs[L["name"]](x))
                if L["relu"]:
                    x = F.relu(x)
            elif op == "poolx":
                x = x.mean(dim=3).flatten(1)
            elif op == "gap":
                x = x.mean(dim=(2, 3))
            elif op == "flatten":
                x = x.flatten(1)
            elif op == "scalars":
                x = torch.cat([x, (s - self.smean) / self.sstd], dim=1)
            elif op == "dense":
                x = self.denses[L["name"]](x)
                if L["relu"]:
                    x = self.dropout(F.relu(x))
        return x


class FoldedNet(nn.Module):
    """Inference-only twin with BatchNorm folded and weights rounded to fp16 (what ships)."""

    def __init__(self, tensors: dict[str, torch.Tensor], arch: list[dict], smean, sstd):
        super().__init__()
        self.arch = arch
        self.t = {k: v.float() for k, v in tensors.items()}
        self.smean = torch.as_tensor(smean, dtype=torch.float32)
        self.sstd = torch.as_tensor(sstd, dtype=torch.float32)

    def to(self, dev):  # noqa: D401 - small helper
        self.t = {k: v.to(dev) for k, v in self.t.items()}
        self.smean = self.smean.to(dev)
        self.sstd = self.sstd.to(dev)
        return self

    @torch.no_grad()
    def forward(self, x, s):
        for L in self.arch:
            op = L["op"]
            if op == "conv":
                x = F.conv2d(x, self.t[L["name"] + ".w"], self.t[L["name"] + ".b"], L["stride"],
                             L["k"] // 2, 1, L["groups"])
                if L["relu"]:
                    x = F.relu(x)
            elif op == "poolx":
                x = x.mean(dim=3).flatten(1)
            elif op == "gap":
                x = x.mean(dim=(2, 3))
            elif op == "flatten":
                x = x.flatten(1)
            elif op == "scalars":
                x = torch.cat([x, (s - self.smean) / self.sstd], dim=1)
            elif op == "dense":
                x = F.linear(x, self.t[L["name"] + ".w"], self.t[L["name"] + ".b"])
                if L["relu"]:
                    x = F.relu(x)
        return x


def fold(net: LetterNet) -> dict[str, torch.Tensor]:
    """BatchNorm folded into conv weights, then rounded to fp16."""
    net = net.eval().cpu()
    out: dict[str, torch.Tensor] = {}
    for L in net.arch:
        if L["op"] == "conv":
            c = net.convs[L["name"]]
            bn = net.bns[L["name"]]
            g = bn.weight / torch.sqrt(bn.running_var + bn.eps)
            out[L["name"] + ".w"] = (c.weight * g[:, None, None, None]).detach()
            out[L["name"] + ".b"] = (bn.bias - bn.running_mean * g).detach()
        elif L["op"] == "dense":
            d = net.denses[L["name"]]
            out[L["name"] + ".w"] = d.weight.detach().clone()
            out[L["name"] + ".b"] = d.bias.detach().clone()
    return {k: v.to(torch.float16) for k, v in out.items()}


def export_arch(net: LetterNet) -> list[dict]:
    arch = copy.deepcopy(net.arch)
    for L in arch:
        if L["op"] == "scalars":
            L["mean"] = [round(float(v), 6) for v in net.smean]
            L["std"] = [round(float(v), 6) for v in net.sstd]
    return arch
