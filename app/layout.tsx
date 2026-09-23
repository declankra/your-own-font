import type { Metadata, Viewport } from "next";
import { DM_Mono, Figtree } from "next/font/google";
import type { CSSProperties, ReactNode } from "react";
import { springVars } from "@/lib/springs";
import "./globals.css";

// next/font downloads these at build time and serves them from this origin, so the page makes
// no request to anyone else.
const figtree = Figtree({ subsets: ["latin"], weight: "variable", variable: "--font-figtree", display: "swap" });
const dmMono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-dm-mono", display: "swap" });

export const metadata: Metadata = {
  title: "your own font",
  description: "Draw two sentences. Get a font for your own handwriting. Free, open source, and nothing leaves your device.",
  referrer: "no-referrer",
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
