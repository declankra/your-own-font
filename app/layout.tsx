import type { Metadata, Viewport } from "next";
import { DM_Mono, Figtree } from "next/font/google";
import type { CSSProperties, ReactNode } from "react";
import { PRODUCT_NAME } from "@/lib/config";
import { springVars } from "@/lib/springs";
import "./globals.css";

// next/font downloads these at build time and serves them from this origin, so the page makes
// no request to anyone else.
const figtree = Figtree({ subsets: ["latin"], weight: "variable", variable: "--font-figtree", display: "swap" });
const dmMono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-dm-mono", display: "swap" });

const description = "Draw two sentences. Get a font for your own handwriting. Free, open source, and nothing leaves your device.";

// Link previews need absolute image URLs. Previews point at production too: preview
// deployments sit behind Vercel's login, which link unfurlers can't get past.
const origin = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3137";

export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: PRODUCT_NAME,
  description,
  referrer: "no-referrer",
  // og:image, the icon and the apple-touch-icon come from app/opengraph-image.tsx, icon.tsx, apple-icon.tsx
  openGraph: { type: "website", url: "/", siteName: PRODUCT_NAME, title: PRODUCT_NAME, description },
  twitter: { card: "summary_large_image", title: PRODUCT_NAME, description },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FFFEFB",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${figtree.variable} ${dmMono.variable}`} style={springVars() as CSSProperties}>
      <body>{children}</body>
    </html>
  );
}
