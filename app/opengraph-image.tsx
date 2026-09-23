import { ImageResponse } from "next/og";
import { PRODUCT_NAME } from "@/lib/config";
import { GRAPHITE, HandWord, MUTED, PAPER, TileArt, figtree } from "@/og/art";

export const alt = "your own font: Draw two sentences. Get a font for your own handwriting.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The hero (SPEC.md §4) as a link preview: the logo, then the headline with "handwriting" drawn.
export default async function OpenGraphImage() {
  const h = 88;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: PAPER, color: GRAPHITE, fontFamily: "Figtree", padding: "64px 84px 56px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", width: 60, height: 60, borderRadius: 14, background: "#fff", overflow: "hidden", boxShadow: "0 0 0 1.5px rgba(31,30,28,0.07), 0 4px 12px -4px rgba(31,30,28,0.2)" }}>
              <TileArt size={60} />
            </div>
            <span style={{ fontSize: 40, letterSpacing: -1.4 }}>{PRODUCT_NAME}</span>
          </div>
          <span style={{ fontSize: 26, color: MUTED, letterSpacing: -0.3 }}>free · open source</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: h, lineHeight: 1.04, letterSpacing: -0.042 * h }}>
          <span>Draw two sentences.</span>
          <span>Get a font for your own</span>
          <div style={{ display: "flex", marginLeft: -0.05 * h, marginTop: -0.12 * h }}>
            <HandWord text="handwriting" em={h} />
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: await figtree() },
  );
}
