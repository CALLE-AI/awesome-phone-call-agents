import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle for the Fly.io container image.
  output: "standalone",
  // These packages are server-only and must never be compiled by webpack:
  // better-sqlite3 is a native addon, and @call-e/calle is a Node SDK that
  // imports node:crypto. Bundling either breaks `next dev` and the build.
  serverExternalPackages: ["better-sqlite3", "@call-e/calle"],
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
