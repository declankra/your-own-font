"use client";
// The page's side of the pipeline worker. One worker per page, started when an ink is picked.
import type { BuildEvent, BuildInput, BuildResult } from "@your-own-font/pipeline/font";
import type { Guides, SegmentResult } from "@your-own-font/pipeline/letter-model";
import type { PipelineRequest, PipelineResponse } from "@your-own-font/pipeline/worker";

type Pending =
  | { kind: "segment"; resolve: (r: SegmentResult) => void; reject: (e: Error) => void }
  | { kind: "build"; resolve: (r: BuildResult) => void; reject: (e: Error) => void; onEvent: (e: BuildEvent) => void };

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
/** Per-pen-up re-solve times, for the performance budget (SPEC.md §6.2). */
export const segmentTimes: number[] = [];

function send(msg: PipelineRequest) {
  worker!.postMessage(msg);
}

/** Start the worker and load the letter model. Safe to call more than once. */
export function startPipeline(): Promise<void> {
  if (ready) return ready;
  worker = new Worker(new URL("../worker/pipeline.worker.ts", import.meta.url), { type: "module", name: "pipeline" });
  ready = new Promise<void>((resolve, reject) => {
    worker!.onmessage = (e: MessageEvent<PipelineResponse>) => {
      const m = e.data;
      if (m.type === "ready") return resolve();
      if (m.type === "init-error") return reject(new Error(m.message));
      const p = pending.get(m.id);
      if (!p) return;
      if (m.type === "segment" && p.kind === "segment") {
        pending.delete(m.id);
        segmentTimes.push(m.ms);
        p.resolve(m.result);
      } else if (m.type === "event" && p.kind === "build") {
        p.onEvent(m.event);
        if (m.event.type === "built") {
          pending.delete(m.id);
          p.resolve(m.event.result);
        }
      } else if (m.type === "error") {
        pending.delete(m.id);
        p.reject(new Error(m.message));
      }
    };
    worker!.onerror = (e) => {
      const err = new Error(e.message || "pipeline worker failed");
      reject(err);
      for (const [id, p] of pending) {
        pending.delete(id);
        p.reject(err);
      }
    };
  });
  // The model ships with the page's own files; this fetch never leaves the site.
  send({ type: "init", modelUrl: new URL("/letter-model.bin", window.location.href).href });
  ready.catch(() => {});
  return ready;
}

export function segmentWord(key: string, strokes: number[][][], word: string, guides: Guides, partial: boolean): Promise<SegmentResult> {
  return startPipeline().then(
    () =>
      new Promise<SegmentResult>((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { kind: "segment", resolve, reject });
        send({ type: "segment", id, key, strokes, word, guides, partial });
      }),
  );
}

export function forgetWord(key: string) {
  if (worker) send({ type: "forget", key });
}

export function buildInWorker(input: BuildInput, onEvent: (e: BuildEvent) => void, opts: { fail?: boolean } = {}): Promise<BuildResult> {
  startPipeline();
  return new Promise<BuildResult>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { kind: "build", resolve, reject, onEvent });
    // the build doesn't need the model to have loaded; it scores variants if it has
    send({ type: "build", id, input, fail: opts.fail });
  });
}
