import type { NextConfig } from "next";

const distDir =
  process.env.FIELDCLOSE_NEXT_DIST_DIR?.trim() || ".next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  distDir,
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
