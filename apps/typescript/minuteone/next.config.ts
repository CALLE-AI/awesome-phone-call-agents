import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev-only: Next only trusts the "localhost" origin for HMR websocket connections by default,
  // so browsing via 127.0.0.1 (same machine, different origin) fails to connect and falls back
  // to full page reloads instead of hot-reloading. Harmless either way, this just restores HMR.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
