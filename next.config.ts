import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The pipeline package is TypeScript source (the Web Worker's code).
  transpilePackages: ["@your-own-font/pipeline"],
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Nothing leaves the device: the page may only talk to its own origin.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"),
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data: blob:",
              "connect-src 'self'" + (process.env.NODE_ENV === "production" ? "" : " ws: wss:"),
              "worker-src 'self' blob:",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
            ].join("; "),
          },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
