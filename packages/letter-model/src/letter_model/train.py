"""Training loop. The whole training set sits on the device as uint8 rasters."""
from __future__ import annotations

import math
import time

import numpy as np
import torch
import torch.nn.functional as F

from .classes import N_CLASSES, NULL_ID
from .model import ARCHS, LetterNet


def device() -> torch.device:
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def seed_all(seed: int):
    np.random.seed(seed)
    torch.manual_seed(seed)


@torch.no_grad()
def predict(net, X: np.ndarray, S: np.ndarray, dev, batch=8192) -> np.ndarray:
    """Log-softmax outputs, (N, 32)."""
    net.eval()
    out = []
    for i in range(0, len(X), batch):
        x = torch.from_numpy(np.ascontiguousarray(X[i : i + batch])).to(dev)
        x = (x.float() / 255.0 if x.dtype == torch.uint8 else x.float()).unsqueeze(1)
        s = torch.from_numpy(np.ascontiguousarray(S[i : i + batch])).to(dev).float()
        out.append(F.log_softmax(net(x, s), dim=1).cpu().numpy())
    return np.concatenate(out) if out else np.zeros((0, N_CLASSES), np.float32)


def quick_metrics(lp: np.ndarray, y: np.ndarray) -> dict:
    pred = lp.argmax(1)
    pos = y != NULL_ID
    tp = np.sum((pred == NULL_ID) & (y == NULL_ID))
    return {
        "top1": float(np.mean(pred[pos] == y[pos])) if pos.any() else float("nan"),
        "null_p": float(tp / max(1, np.sum(pred == NULL_ID))),
        "null_r": float(tp / max(1, np.sum(y == NULL_ID))),
    }


def train(train_sets, val_sets, arch: str, epochs: int, seed: int, batch: int = 512,
          lr: float = 3e-3, log=print, teacher=None, T: float = 2.0, alpha: float = 0.6) -> LetterNet:
    seed_all(seed)
    dev = device()
    X = np.concatenate([t[0] for t in train_sets])
    S = np.concatenate([t[1] for t in train_sets]).astype(np.float32)
    Y = np.concatenate([t[2] for t in train_sets]).astype(np.int64)
    mean = S.mean(0)
    std = S.std(0) + 1e-3
    net = LetterNet(ARCHS[arch](), mean, std).to(dev)
    log(f"train: {len(X)} samples ({np.mean(Y == NULL_ID):.0%} ∅), arch {arch}, "
        f"{sum(p.numel() for p in net.parameters())} params, device {dev}")
    Xd = torch.from_numpy(X).to(dev)
    Sd = torch.from_numpy(S).to(dev)
    Yd = torch.from_numpy(Y).to(dev)
    Td = None
    if teacher is not None:  # soft targets, computed once
        Td = torch.from_numpy(predict(teacher, X, S, dev) / T).to(dev)
    Xv = np.concatenate([t[0] for t in val_sets])
    Sv = np.concatenate([t[1] for t in val_sets]).astype(np.float32)
    Yv = np.concatenate([t[2] for t in val_sets]).astype(np.int64)
    opt = torch.optim.AdamW(net.parameters(), lr=lr, weight_decay=1e-4)
    steps = epochs * math.ceil(len(X) / batch)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=lr, total_steps=steps, pct_start=0.15)
    g = torch.Generator(device="cpu").manual_seed(seed)
    for ep in range(epochs):
        net.train()
        t0 = time.time()
        perm = torch.randperm(len(X), generator=g).to(dev)
        tot = torch.zeros((), device=dev)
        nb = 0
        for i in range(0, len(X), batch):
            idx = perm[i : i + batch]
            x = Xd[idx].float().div_(255.0).unsqueeze(1)
            out = net(x, Sd[idx])
            loss = F.cross_entropy(out, Yd[idx], label_smoothing=0.05)
            if Td is not None:
                kd = F.kl_div(F.log_softmax(out / T, 1), F.log_softmax(Td[idx], 1), log_target=True,
                              reduction="batchmean") * T * T
                loss = (1 - alpha) * loss + alpha * kd
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            sched.step()
            tot += loss.detach()
            nb += 1
        m = quick_metrics(predict(net, Xv, Sv, dev), Yv)
        log(f"epoch {ep + 1}/{epochs} loss {float(tot) / nb:.4f} val top1 {m['top1']:.4f} "
            f"∅ P {m['null_p']:.4f} R {m['null_r']:.4f} ({time.time() - t0:.1f}s)")
    return net.eval()


def calibrate_null(net, val_sets, dev) -> tuple[float, dict]:
    """Pick the margin subtracted from the ∅ logit on validation: the operating point with
    the most room above all three targets (letters top-1 95%, ∅ precision and recall 90%)."""
    X = np.concatenate([t[0] for t in val_sets])
    S = np.concatenate([t[1] for t in val_sets])
    Y = np.concatenate([t[2] for t in val_sets])
    lp = predict(net, X, S, dev)
    best = (-1e9, 0.0, {})
    for d in np.arange(-1.0, 4.01, 0.1):
        z = lp.copy()
        z[:, NULL_ID] -= d
        m = quick_metrics(z, Y)
        slack = min((m["top1"] - 0.95) / 0.05, (m["null_p"] - 0.90) / 0.10, (m["null_r"] - 0.90) / 0.10)
        if slack > best[0]:
            best = (slack, float(round(d, 2)), {k: round(v, 4) for k, v in m.items()})
    return best[1], best[2]
