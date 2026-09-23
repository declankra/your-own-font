// Validate a recorded session against the fixture format (docs/letter-model.md §5 and
// packages/letter-model/fixture.schema.json), plus the structural checks in checkWord.
// Dependency-free so tools/collect can run it before saving.
import { checkWord, type FixtureSession } from "./fixture.ts";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function validateSession(s: unknown): string[] {
  const e: string[] = [];
  const o = s as Record<string, unknown>;
  if (!o || typeof o !== "object") return ["not an object"];
  if (o.version !== 1) e.push("version must be 1");
  for (const k of ["writerId", "device", "recordedAt"]) if (typeof o[k] !== "string" || !(o[k] as string).length) e.push(`${k} must be a non-empty string`);
  if (!["touch", "pen", "mouse", "synthetic"].includes(o.pointerType as string)) e.push("pointerType must be touch, pen, mouse or synthetic");
  if (typeof o.recordedAt === "string" && !/^\d{4}-\d{2}-\d{2}/.test(o.recordedAt)) e.push("recordedAt must start with YYYY-MM-DD");
  if (!Array.isArray(o.words) || !o.words.length) return [...e, "words must be a non-empty array"];
  (o.words as unknown[]).forEach((w0, wi) => {
    const w = w0 as Record<string, unknown>;
    const at = `words[${wi}]`;
    if (typeof w.text !== "string" || !/^[a-z,.'!?]+$/.test(w.text)) e.push(`${at}.text must be lowercase letters and , . ' ! ?`);
    const g = w.guides as Record<string, unknown>;
    if (!g || !isNum(g.baseline) || !isNum(g.xHeight) || (g.xHeight as number) <= 0) e.push(`${at}.guides needs numeric baseline and positive xHeight`);
    if (!Array.isArray(w.strokes) || !w.strokes.length) {
      e.push(`${at}.strokes must be a non-empty array`);
      return;
    }
    (w.strokes as unknown[]).forEach((st, si) => {
      const pts = (st as Record<string, unknown>)?.points;
      if (!Array.isArray(pts) || !pts.length) e.push(`${at}.strokes[${si}].points must be a non-empty array`);
      else if (!pts.every((p) => Array.isArray(p) && p.length === 4 && p.every(isNum)))
        e.push(`${at}.strokes[${si}].points must be [x, y, pressure, tMs] numbers`);
    });
    if (!Array.isArray(w.letterOfStroke) || !w.letterOfStroke.every((v) => Number.isInteger(v))) e.push(`${at}.letterOfStroke must be integers`);
    if (!Array.isArray(w.splits)) e.push(`${at}.splits must be an array`);
    else
      w.splits.forEach((sp: Record<string, unknown>, k: number) => {
        if (!["stroke", "atPoint", "left", "right"].every((f) => Number.isInteger(sp?.[f]))) e.push(`${at}.splits[${k}] needs integer stroke, atPoint, left, right`);
      });
    if (!e.some((x) => x.startsWith(at))) for (const m of checkWord(w as never)) e.push(`${at}: ${m}`);
  });
  return e;
}

export type { FixtureSession };
