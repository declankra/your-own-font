// Load the freshly built font into this page, so the printed alphabet is real text in it.
import type { BuildResult } from "@your-own-font/pipeline/font";

const loaded = new Map<string, FontFace>();

/** Returns the CSS family name, or null if the browser refused the font. */
export async function loadBuiltFont(result: BuildResult): Promise<string | null> {
  const family = `yof-${result.postScriptName}`;
  if (loaded.has(family)) return family;
  try {
    const face = new FontFace(family, result.otf.slice(0), { display: "block" });
    await face.load();
    document.fonts.add(face);
    loaded.set(family, face);
    return family;
  } catch (e) {
    console.error("the built font did not load", e);
    return null;
  }
}

export function fontFile(result: BuildResult): Blob {
  return new Blob([result.otf], { type: "font/otf" });
}

export const FONT_FILE_NAME = "My Hand.otf";
