import { ImageResponse } from "next/og";
import { TileArt } from "@/og/art";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// The logo tile, full bleed: iOS rounds home-screen and share-sheet icons itself.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#fff" }}>
        <TileArt size={180} />
      </div>
    ),
    size,
  );
}
