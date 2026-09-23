import { ImageResponse } from "next/og";
import { TileArt } from "@/og/art";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

// The logo tile as the favicon.
export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#fff", borderRadius: "23%", overflow: "hidden" }}>
        <TileArt size={64} />
      </div>
    ),
    size,
  );
}
