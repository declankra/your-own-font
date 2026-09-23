"""Render fixture words and stroke groups to PNG for inspection and the model card."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

PALETTE = [
    (36, 70, 245), (255, 91, 58), (20, 150, 90), (160, 60, 200), (230, 150, 0),
    (0, 150, 190), (200, 40, 120), (90, 90, 90), (120, 170, 0), (140, 80, 20),
]
GUIDE = (201, 214, 247)


def _font(size: int):
    for p in ["/System/Library/Fonts/SFNSMono.ttf", "/System/Library/Fonts/Menlo.ttc",
              "/Library/Fonts/Arial.ttf"]:
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()


def piece_letters(word: dict) -> list[list[tuple[int, int, int]]]:
    """Per stroke: [(letter, first point, last point)] from letterOfStroke + splits."""
    out = []
    by_stroke: dict[int, list[dict]] = {}
    for s in word.get("splits", []):
        by_stroke.setdefault(s["stroke"], []).append(s)
    for i, st in enumerate(word["strokes"]):
        n = len(st["points"])
        sp = sorted(by_stroke.get(i, []), key=lambda s: s["atPoint"])
        if not sp:
            out.append([(word["letterOfStroke"][i], 0, n - 1)])
            continue
        runs = []
        a = 0
        for s in sp:
            runs.append((s["left"], a, s["atPoint"]))
            a = s["atPoint"]
        runs.append((sp[-1]["right"], a, n - 1))
        out.append(runs)
    return out


def render_word(word: dict, assign: dict | None = None, title: str = "", scale: float = 1.0,
                show_order: bool = False) -> Image.Image:
    """Draw the word's ink coloured by letter. With `assign` (another letterOfStroke/splits),
    draw the truth on top and the prediction below."""
    panels = [("truth", word)] + ([("pred", {**word, **assign})] if assign else [])
    pts = np.concatenate([np.array(s["points"])[:, :2] for s in word["strokes"]])
    base, xh = word["guides"]["baseline"], word["guides"]["xHeight"]
    x0, x1 = pts[:, 0].min() - 0.6 * xh, pts[:, 0].max() + 0.6 * xh
    y0, y1 = base - 2.3 * xh, base + 1.3 * xh
    W = int((x1 - x0) * scale)
    Hp = int((y1 - y0) * scale)
    head = 22
    img = Image.new("RGB", (max(W, 260), head + Hp * len(panels)), (255, 254, 251))
    d = ImageDraw.Draw(img)
    f = _font(13)
    d.text((6, 4), title or word["text"], fill=(31, 30, 28), font=f)
    for k, (name, w) in enumerate(panels):
        oy = head + k * Hp

        def tf(p):
            return ((p[0] - x0) * scale, (p[1] - y0) * scale + oy)

        for yy, dash in [(base, False), (base - xh, True), (base - 1.75 * xh, False), (base + 0.75 * xh, False)]:
            y = tf((0, yy))[1]
            d.line([(0, y), (img.width, y)], fill=GUIDE, width=1)
        runs = piece_letters(w)
        for i, st in enumerate(w["strokes"]):
            p = np.array(st["points"])[:, :2]
            for (L, a, b) in runs[i]:
                seg = [tf(q) for q in p[a : b + 1]]
                col = PALETTE[L % len(PALETTE)]
                if len(seg) == 1:
                    x, y = seg[0]
                    d.ellipse([x - 2.5, y - 2.5, x + 2.5, y + 2.5], fill=col)
                else:
                    d.line(seg, fill=col, width=max(2, int(0.1 * xh * scale)), joint="curve")
            if show_order:
                x, y = tf(p[0])
                d.text((x + 2, y - 12), str(i), fill=(111, 106, 99), font=_font(10))
        # letter labels under the baseline at each letter's ink centre
        cent: dict[int, list[float]] = {}
        for i, st in enumerate(w["strokes"]):
            p = np.array(st["points"])[:, :2]
            for (L, a, b) in runs[i]:
                cent.setdefault(L, []).extend(p[a : b + 1, 0].tolist())
        for L, xs in cent.items():
            x = (np.mean(xs) - x0) * scale
            ch = w["text"][L] if L < len(w["text"]) else "?"
            d.text((x - 4, tf((0, base + 0.95 * xh))[1]), ch, fill=PALETTE[L % len(PALETTE)], font=f)
        d.text((4, oy + 2), name, fill=(111, 106, 99), font=_font(10))
    return img


def render_raster(r: np.ndarray, label: str = "", zoom: int = 4) -> Image.Image:
    a = (255 - np.clip(r, 0, 1) * 255).astype(np.uint8)
    img = Image.fromarray(a).resize((a.shape[1] * zoom, a.shape[0] * zoom), Image.NEAREST).convert("RGB")
    d = ImageDraw.Draw(img)
    for frac in (2.0 / 3.0, 1.0 / 3.0):  # baseline and x-height line
        y = int(round(frac * a.shape[0] * zoom))
        d.line([(0, y), (img.width, y)], fill=GUIDE)
    if label:
        d.text((2, 2), label, fill=(255, 91, 58), font=_font(11))
    return img


def grid(images: list[Image.Image], cols: int, pad: int = 6) -> Image.Image:
    if not images:
        return Image.new("RGB", (10, 10), (255, 255, 255))
    w = max(i.width for i in images)
    h = max(i.height for i in images)
    rows = (len(images) + cols - 1) // cols
    out = Image.new("RGB", (cols * (w + pad) + pad, rows * (h + pad) + pad), (240, 238, 234))
    for k, im in enumerate(images):
        out.paste(im, (pad + (k % cols) * (w + pad), pad + (k // cols) * (h + pad)))
    return out


def save(img: Image.Image, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)
