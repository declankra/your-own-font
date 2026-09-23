// Link previews and app icons (iMessage, Slack, home screen): the hero and the logo tile as
// images, drawn with the house hand and the product's pen like the page. next/og renders them
// at build time, so they are static files on this origin.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { HOUSE, houseStrokes, housePressure } from "@your-own-font/pipeline/house-hand";
import { INKS } from "@/lib/config";
import { strokePath } from "@/lib/ink";

export const PAPER = "#FFFEFB";
export const GRAPHITE = "#1F1E1C";
export const MUTED = "#6F6A63";
export const RULE = "#C9D6F7";
export const BALLPOINT = INKS[0].hex;

/** Figtree Bold (OFL, see Figtree-OFL.txt). next/og can't read the variable woff2 next/font serves. */
export async function figtree() {
  const data = await readFile(join(process.cwd(), "src/og/Figtree-Bold.ttf"));
  return [{ name: "Figtree", data, weight: 700 as const, style: "normal" as const }];
}

/** A word in the house hand: one path per stroke, in house units (baseline 100, x-height 50). */
function houseWord(text: string, xh: number) {
  let x = 0;
  const paths: string[] = [];
  for (const ch of text) {
    for (const pts of houseStrokes(ch)) {
      const n = pts.length;
      paths.push(strokePath(pts.map(([a, b], i) => [a + x, b, housePressure(i / Math.max(1, n - 1))]), xh, true));
    }
    x += HOUSE[ch].w + 6;
  }
  return { paths, w: x - 6 };
}

/** The hero's "handwriting" on its guides, `em` px per 100 house units. */
export function HandWord({ text, em, color = BALLPOINT }: { text: string; em: number; color?: string }) {
  const { paths, w } = houseWord(text, 50 * 1.05);
  const u = em * 0.0105;
  return (
    <svg width={(w + 12) * u} height={140 * u} viewBox={`-6 0 ${w + 12} 140`}>
      <line x1={-6} x2={w + 6} y1={100} y2={100} stroke={RULE} strokeWidth={1.25 / u} />
      <line x1={-6} x2={w + 6} y1={50} y2={50} stroke={RULE} strokeWidth={1.25 / u} strokeDasharray={`${5 / u} ${6 / u}`} />
      <g fill={color}>
        {paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
    </svg>
  );
}

/** The logo tile's art (Logo.tsx): ruled guides and the house "a", filling `size` px. */
export function TileArt({ size, color = BALLPOINT }: { size: number; color?: string }) {
  const { paths, w } = houseWord("a", 50 * 1.5);
  const cx = w / 2;
  return (
    <svg width={size} height={size} viewBox={`${cx - 62} 16 124 124`}>
      <line x1={cx - 62} x2={cx + 62} y1={100} y2={100} stroke={RULE} strokeWidth={3} />
      <line x1={cx - 62} x2={cx + 62} y1={50} y2={50} stroke={RULE} strokeWidth={3} strokeDasharray="7 8" />
      <g fill={color}>
        {paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
    </svg>
  );
}
