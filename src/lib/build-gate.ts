// Honest progress (SPEC.md §7): the Making animation awaits the pipeline's own events. A step
// can hold for its work; it can never finish before it.
import type { BuildEvent, BuildResult, BuildStage, BuiltGlyph } from "@your-own-font/pipeline/font";

type Waiter = { test: () => boolean; resolve: () => void; reject: (e: Error) => void };

export class BuildGate {
  glyphs: (BuiltGlyph | null)[] = Array(26).fill(null);
  /** glyph events received so far (a letter with no ink still counts, as missing) */
  castCount = 0;
  stages = new Set<BuildStage>();
  metrics: { sidebearing: number; space: number } | null = null;
  variants: { alternates: string[]; dropped: string[] } | null = null;
  result: BuildResult | null = null;
  error: Error | null = null;
  private waiters: Waiter[] = [];

  push(e: BuildEvent) {
    if (e.type === "glyph") {
      this.glyphs[e.index] = e.glyph;
      this.castCount = Math.max(this.castCount, e.index + 1);
    } else if (e.type === "stage") {
      this.stages.add(e.stage);
      // every glyph event arrives before the set stage starts
      if (e.stage !== "cast") this.castCount = 26;
    } else if (e.type === "metrics") this.metrics = { sidebearing: e.sidebearing, space: e.space };
    else if (e.type === "variants") this.variants = { alternates: e.alternates, dropped: e.dropped };
    else if (e.type === "built") this.result = e.result;
    this.flush();
  }

  fail(err: Error) {
    this.error = err;
    this.flush();
  }

  private flush() {
    this.waiters = this.waiters.filter((w) => {
      if (this.error) {
        w.reject(this.error);
        return false;
      }
      if (w.test()) {
        w.resolve();
        return false;
      }
      return true;
    });
  }

  private wait(test: () => boolean): Promise<void> {
    if (this.error) return Promise.reject(this.error);
    if (test()) return Promise.resolve();
    return new Promise((resolve, reject) => this.waiters.push({ test, resolve, reject }));
  }

  /** the worker has reported letter i (a–z order) */
  glyph(i: number) {
    return this.wait(() => this.castCount > i);
  }
  /** metrics are done */
  set() {
    return this.wait(() => this.metrics !== null);
  }
  /** variants are done */
  inked() {
    return this.wait(() => this.variants !== null);
  }
  /** the .otf exists */
  built() {
    return this.wait(() => this.result !== null);
  }
}
