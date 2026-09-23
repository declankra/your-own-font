// The letter model runtime: loads letter-model.bin and runs it in plain TypeScript (no WASM,
// no WebGL). File layout: "LMDL", u32 little-endian header length, UTF-8 JSON header, padding
// to 4 bytes, then fp16 little-endian tensors in the order the header lists them.
//
// Activations are kept channel-last (HWC). Convolutions are written in scatter form so that
// zero inputs (most of the raster, and about half of every map after ReLU) cost nothing.

import { CLASSES, N_CLASSES } from "./classes.ts";
import { COLS, N_SCALARS, ROWS, rasterize, type Guides, type Polyline } from "./raster.ts";

export type LayerSpec =
  | { op: "conv"; name: string; cin: number; cout: number; k: 1 | 3; stride: 1 | 2; groups: number; relu: boolean }
  | { op: "poolx" }
  | { op: "gap" }
  | { op: "flatten" }
  | { op: "scalars"; mean: number[]; std: number[] }
  | { op: "dense"; name: string; in: number; out: number; relu: boolean };

export interface ClassPrior {
  /** mean and sd of log(ink width / (writer scale * x-height)) */
  logW: [number, number];
  /** mean and sd of ink top above the baseline, in writer x-heights */
  top: [number, number];
  /** mean and sd of ink bottom above the baseline (negative below), in writer x-heights */
  bottom: [number, number];
}

export interface ModelHeader {
  format: "letter-model";
  version: number;
  classes: string[];
  input: { rows: number; cols: number; topXh: number; spanXh: number; radiusXh: number; scalars: string[] };
  arch: LayerSpec[];
  tensors: { name: string; shape: number[]; offset: number; length: number }[];
  priors: Record<string, ClassPrior>;
  segmenter?: Record<string, number>;
  trainingDataHash?: string;
  createdAt?: string;
  [k: string]: unknown;
}

function f16ToF32(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

interface Shape {
  h: number;
  w: number;
  c: number;
}

type Kernel = (x: Float32Array, sc: Float32Array) => Float32Array;

export class LetterModel {
  readonly header: ModelHeader;
  private readonly kernels: Kernel[] = [];
  private readonly rasterBuf = new Float32Array(ROWS * COLS);
  private readonly scalarBuf = new Float32Array(N_SCALARS);
  private readonly dminBuf = new Float64Array(ROWS * COLS);

  constructor(buf: ArrayBuffer | Uint8Array) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (magic !== "LMDL") throw new Error("not a letter-model.bin");
    const hlen = dv.getUint32(4, true);
    this.header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hlen)));
    let off = 8 + hlen;
    off += (4 - (off % 4)) % 4;
    if (this.header.classes.join("") !== CLASSES.join("")) throw new Error("class list mismatch");
    const tensors = new Map<string, { shape: number[]; data: Float32Array }>();
    for (const t of this.header.tensors) {
      const data = new Float32Array(t.length);
      const base = off + t.offset * 2;
      for (let i = 0; i < t.length; i++) data[i] = f16ToF32(dv.getUint16(base + i * 2, true));
      tensors.set(t.name, { shape: t.shape, data });
    }
    const get = (n: string) => {
      const t = tensors.get(n);
      if (!t) throw new Error(`missing tensor ${n}`);
      return t;
    };
    this.build(get);
  }

  private build(get: (n: string) => { shape: number[]; data: Float32Array }) {
    let shape: Shape = { h: ROWS, w: COLS, c: 1 };
    let flat = false;
    let len = 0; // length of the flat vector
    for (const L of this.header.arch) {
      if (L.op === "conv") {
        const w = get(`${L.name}.w`).data;
        const b = get(`${L.name}.b`).data;
        const s = shape;
        const ho = Math.floor((s.h - 1) / L.stride) + 1;
        const wo = Math.floor((s.w - 1) / L.stride) + 1;
        const out = new Float32Array(ho * wo * L.cout);
        const depthwise = L.groups === L.cin && L.groups > 1;
        if (L.k === 1) this.kernels.push(pointwise(w, b, s, L.cout, L.relu, out));
        else if (depthwise) this.kernels.push(depthwise3(w, b, s, L.stride, L.relu, out));
        else this.kernels.push(conv3(w, b, s, L.cout, L.stride, L.relu, out));
        shape = { h: ho, w: wo, c: L.cout };
      } else if (L.op === "poolx") {
        // PyTorch: mean over width of (C, H, W) -> (C, H), flattened c*H + h
        const s = shape;
        const out = new Float32Array(s.c * s.h);
        this.kernels.push((x) => {
          out.fill(0);
          const inv = 1 / s.w;
          for (let h = 0; h < s.h; h++)
            for (let w = 0; w < s.w; w++) {
              const base = (h * s.w + w) * s.c;
              for (let c = 0; c < s.c; c++) out[c * s.h + h] += x[base + c] * inv;
            }
          return out;
        });
        flat = true;
        len = s.c * s.h;
      } else if (L.op === "gap") {
        const s = shape;
        const out = new Float32Array(s.c);
        this.kernels.push((x) => {
          out.fill(0);
          const inv = 1 / (s.h * s.w);
          for (let p = 0; p < s.h * s.w; p++) for (let c = 0; c < s.c; c++) out[c] += x[p * s.c + c] * inv;
          return out;
        });
        flat = true;
        len = s.c;
      } else if (L.op === "flatten") {
        // PyTorch flattens (C, H, W) as c*H*W + h*W + w
        const s = shape;
        const out = new Float32Array(s.c * s.h * s.w);
        this.kernels.push((x) => {
          for (let h = 0; h < s.h; h++)
            for (let w = 0; w < s.w; w++) {
              const base = (h * s.w + w) * s.c;
              for (let c = 0; c < s.c; c++) out[(c * s.h + h) * s.w + w] = x[base + c];
            }
          return out;
        });
        flat = true;
        len = s.c * s.h * s.w;
      } else if (L.op === "scalars") {
        const { mean, std } = L;
        const n = len;
        const out = new Float32Array(n + N_SCALARS);
        this.kernels.push((x, sc) => {
          out.set(x.subarray(0, n));
          for (let j = 0; j < N_SCALARS; j++) out[n + j] = (sc[j] - mean[j]) / std[j];
          return out;
        });
        len = n + N_SCALARS;
      } else if (L.op === "dense") {
        if (!flat) throw new Error("dense before flatten");
        if (L.in !== len) throw new Error(`${L.name}: expects ${L.in} inputs, gets ${len}`);
        const out = new Float32Array(L.out);
        this.kernels.push(dense(get(`${L.name}.w`).data, get(`${L.name}.b`).data, L.in, L.out, L.relu, out));
        len = L.out;
      }
    }
    if (len !== N_CLASSES) throw new Error(`model ends with ${len} outputs, want ${N_CLASSES}`);
  }

  /** Logits for an already-rasterized group. */
  forward(raster: Float32Array, scalars: Float32Array): Float32Array {
    let x = raster;
    for (const k of this.kernels) x = k(x, scalars);
    return x;
  }

  /** Raw logits for a stroke group (parity tests use these). */
  logits(group: ArrayLike<Polyline>, guides: Guides): Float32Array {
    rasterize(group, guides, this.rasterBuf, this.scalarBuf, this.dminBuf);
    return this.forward(this.rasterBuf, this.scalarBuf);
  }

  /** log-softmax over the 32 classes: log P(letter) for a–z , . ' ! ? and ∅ (last). */
  score(group: ArrayLike<Polyline>, guides: Guides, out = new Float32Array(N_CLASSES)): Float32Array {
    const z = this.logits(group, guides);
    let m = -Infinity;
    for (let i = 0; i < N_CLASSES; i++) if (z[i] > m) m = z[i];
    let s = 0;
    for (let i = 0; i < N_CLASSES; i++) s += Math.exp(z[i] - m);
    const lse = m + Math.log(s);
    for (let i = 0; i < N_CLASSES; i++) out[i] = z[i] - lse;
    return out;
  }
}

/** 3x3 conv, padding 1, stride 1 or 2, groups 1. PyTorch weights [O, C, 3, 3]. */
function conv3(wPt: Float32Array, b: Float32Array, s: Shape, O: number, stride: number, relu: boolean, out: Float32Array): Kernel {
  const C = s.c;
  const H = s.h;
  const W = s.w;
  const Ho = Math.floor((H - 1) / stride) + 1;
  const Wo = Math.floor((W - 1) / stride) + 1;
  // -> [ky][kx][c][o]
  const w = new Float32Array(9 * C * O);
  for (let o = 0; o < O; o++)
    for (let c = 0; c < C; c++)
      for (let k = 0; k < 9; k++) w[(k * C + c) * O + o] = wPt[(o * C + c) * 9 + k];
  return (x) => {
    for (let p = 0; p < Ho * Wo; p++) out.set(b, p * O);
    for (let y = 0; y < H; y++) {
      for (let xx = 0; xx < W; xx++) {
        const ib = (y * W + xx) * C;
        // skip empty pixels before touching the kernel (most of the raster is blank)
        let any = false;
        for (let c = 0; c < C; c++)
          if (x[ib + c] !== 0) {
            any = true;
            break;
          }
        if (!any) continue;
        for (let ky = 0; ky < 3; ky++) {
          const ny = y + 1 - ky;
          if (ny < 0 || ny % stride !== 0) continue;
          const oy = ny / stride;
          if (oy >= Ho) continue;
          for (let kx = 0; kx < 3; kx++) {
            const nx = xx + 1 - kx;
            if (nx < 0 || nx % stride !== 0) continue;
            const ox = nx / stride;
            if (ox >= Wo) continue;
            const ob = (oy * Wo + ox) * O;
            const wk = (ky * 3 + kx) * C * O;
            for (let c = 0; c < C; c++) {
              const v = x[ib + c];
              if (v === 0) continue;
              const wb = wk + c * O;
              for (let o = 0; o < O; o++) out[ob + o] += v * w[wb + o];
            }
          }
        }
      }
    }
    if (relu) for (let i = 0; i < out.length; i++) if (out[i] < 0) out[i] = 0;
    return out;
  };
}

/** Depthwise 3x3 conv, padding 1. PyTorch weights [C, 1, 3, 3]. */
function depthwise3(wPt: Float32Array, b: Float32Array, s: Shape, stride: number, relu: boolean, out: Float32Array): Kernel {
  const C = s.c;
  const H = s.h;
  const W = s.w;
  const Ho = Math.floor((H - 1) / stride) + 1;
  const Wo = Math.floor((W - 1) / stride) + 1;
  const w = new Float32Array(9 * C); // [k][c]
  for (let c = 0; c < C; c++) for (let k = 0; k < 9; k++) w[k * C + c] = wPt[c * 9 + k];
  return (x) => {
    for (let oy = 0; oy < Ho; oy++)
      for (let ox = 0; ox < Wo; ox++) {
        const ob = (oy * Wo + ox) * C;
        for (let c = 0; c < C; c++) out[ob + c] = b[c];
        for (let ky = 0; ky < 3; ky++) {
          const y = oy * stride + ky - 1;
          if (y < 0 || y >= H) continue;
          for (let kx = 0; kx < 3; kx++) {
            const xx = ox * stride + kx - 1;
            if (xx < 0 || xx >= W) continue;
            const ib = (y * W + xx) * C;
            const wk = (ky * 3 + kx) * C;
            for (let c = 0; c < C; c++) out[ob + c] += x[ib + c] * w[wk + c];
          }
        }
        if (relu) for (let c = 0; c < C; c++) if (out[ob + c] < 0) out[ob + c] = 0;
      }
    return out;
  };
}


/** 1x1 conv. PyTorch weights [O, C, 1, 1]. */
function pointwise(wPt: Float32Array, b: Float32Array, s: Shape, O: number, relu: boolean, out: Float32Array): Kernel {
  const C = s.c;
  const P = s.h * s.w;
  const w = new Float32Array(C * O); // [c][o]
  for (let o = 0; o < O; o++) for (let c = 0; c < C; c++) w[c * O + o] = wPt[o * C + c];
  return (x) => {
    for (let p = 0; p < P; p++) {
      const ob = p * O;
      out.set(b, ob);
      const ib = p * C;
      let c = 0;
      // four input channels per pass: a quarter of the read-modify-writes on `out`
      for (; c + 3 < C; c += 4) {
        const v0 = x[ib + c];
        const v1 = x[ib + c + 1];
        const v2 = x[ib + c + 2];
        const v3 = x[ib + c + 3];
        if (v0 === 0 && v1 === 0 && v2 === 0 && v3 === 0) continue;
        const w0 = c * O;
        const w1 = w0 + O;
        const w2 = w1 + O;
        const w3 = w2 + O;
        for (let o = 0; o < O; o++) out[ob + o] += v0 * w[w0 + o] + v1 * w[w1 + o] + v2 * w[w2 + o] + v3 * w[w3 + o];
      }
      for (; c < C; c++) {
        const v = x[ib + c];
        if (v === 0) continue;
        const wb = c * O;
        for (let o = 0; o < O; o++) out[ob + o] += v * w[wb + o];
      }
      if (relu) for (let o = 0; o < O; o++) if (out[ob + o] < 0) out[ob + o] = 0;
    }
    return out;
  };
}

/** Dense layer. PyTorch weights [out, in]. */
function dense(wPt: Float32Array, b: Float32Array, I: number, O: number, relu: boolean, out: Float32Array): Kernel {
  const w = new Float32Array(I * O); // [i][o]
  for (let o = 0; o < O; o++) for (let i = 0; i < I; i++) w[i * O + o] = wPt[o * I + i];
  return (x) => {
    out.set(b);
    let i = 0;
    // two inputs per pass, skipping zeros (about half the inputs after ReLU)
    for (; i + 1 < I; i += 2) {
      const v0 = x[i];
      const v1 = x[i + 1];
      if (v0 === 0 && v1 === 0) continue;
      const w0 = i * O;
      const w1 = w0 + O;
      if (v1 === 0) for (let o = 0; o < O; o++) out[o] += v0 * w[w0 + o];
      else if (v0 === 0) for (let o = 0; o < O; o++) out[o] += v1 * w[w1 + o];
      else for (let o = 0; o < O; o++) out[o] += v0 * w[w0 + o] + v1 * w[w1 + o];
    }
    for (; i < I; i++) {
      const v = x[i];
      if (v === 0) continue;
      const wb = i * O;
      for (let o = 0; o < O; o++) out[o] += v * w[wb + o];
    }
    if (relu) for (let o = 0; o < O; o++) if (out[o] < 0) out[o] = 0;
    return out;
  };
}
