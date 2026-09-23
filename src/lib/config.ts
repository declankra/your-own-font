// Things the owner still has to decide (SPEC.md §10). Placeholders until then.

/** Working name (SPEC.md §10.2). */
export const PRODUCT_NAME = "your own font";
/** PLACEHOLDER (SPEC.md §10.1): the GitHub repo for the "open source" link. */
export const REPO_URL = "https://github.com/declankra/your-own-font";

export const INKS = [
  { id: "ballpoint", name: "Ballpoint", hex: "#2446F5" },
  { id: "graphite", name: "Graphite", hex: "#1F1E1C" },
  { id: "tomato", name: "Tomato", hex: "#FF5B3A" },
] as const;
export type Ink = (typeof INKS)[number];

export const SHARE_TEXT = "Draw two sentences, get a font of your handwriting.";
