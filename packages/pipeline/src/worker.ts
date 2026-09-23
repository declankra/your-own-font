// The pipeline Web Worker's message protocol. The app's worker entry calls `attachPipeline`.
// Everything runs here, on the device: the letter model (plain TypeScript), the segmenter, and
// the font build. Nothing is sent anywhere.

import { buildFont } from "./font/build.ts";
import type { BuildEvent, BuildInput } from "./font/types.ts";
import { LetterModel } from "./letter-model/model.ts";
import type { Guides, Polyline } from "./letter-model/raster.ts";
import { segment, type SegmentResult } from "./letter-model/segment.ts";

export type PipelineRequest =
  | { type: "init"; modelUrl: string }
  | { type: "segment"; id: number; key: string; strokes: number[][][]; word: string; guides: Guides; partial: boolean }
  | { type: "forget"; key: string }
  | { type: "build"; id: number; input: BuildInput; fail?: boolean };

export type PipelineResponse =
  | { type: "ready" }
  | { type: "init-error"; message: string }
  | { type: "segment"; id: number; result: SegmentResult; ms: number }
  | { type: "event"; id: number; event: BuildEvent }
  | { type: "error"; id: number; message: string };

interface Scope {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", fn: (e: MessageEvent) => void): void;
}

export function attachPipeline(scope: Scope, load: (url: string) => Promise<ArrayBuffer> = (u) => fetch(u).then((r) => r.arrayBuffer())) {
  let model: Promise<LetterModel> | null = null;
  const caches = new Map<string, Map<string, Float32Array>>();
  const post = (m: PipelineResponse, transfer?: Transferable[]) => scope.postMessage(m, transfer);

  scope.addEventListener("message", async (e: MessageEvent) => {
    const msg = e.data as PipelineRequest;
    if (msg.type === "init") {
      if (!model) {
        model = load(msg.modelUrl).then((buf) => new LetterModel(buf));
        model.then(
          () => post({ type: "ready" }),
          (err) => post({ type: "init-error", message: String(err?.message ?? err) }),
        );
      }
      return;
    }
    if (msg.type === "forget") {
      caches.delete(msg.key);
      return;
    }
    if (msg.type === "segment") {
      try {
        if (!model) throw new Error("pipeline not initialised");
        const m = await model;
        let cache = caches.get(msg.key);
        if (!cache) caches.set(msg.key, (cache = new Map()));
        const t0 = performance.now();
        const result = segment(msg.strokes as unknown as Polyline[], msg.word, msg.guides, { mode: "model", model: m, partial: msg.partial, cache });
        post({ type: "segment", id: msg.id, result, ms: performance.now() - t0 });
      } catch (err) {
        post({ type: "error", id: msg.id, message: String((err as Error)?.message ?? err) });
      }
      return;
    }
    if (msg.type === "build") {
      try {
        const m = model ? await model.catch(() => null) : null;
        await buildFont(msg.input, {
          model: m,
          yieldEvery: () => new Promise((r) => setTimeout(r, 0)),
          onEvent: (event) => {
            if (msg.fail && event.type === "stage" && event.stage === "press") throw new Error("forced failure (test)");
            if (event.type === "built") {
              // the font's bytes move to the page; this copy is gone from the worker
              post({ type: "event", id: msg.id, event }, [event.result.otf]);
            } else post({ type: "event", id: msg.id, event });
          },
        });
      } catch (err) {
        post({ type: "error", id: msg.id, message: String((err as Error)?.message ?? err) });
      }
    }
  });
}
