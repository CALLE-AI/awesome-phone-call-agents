import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Preview and some local clients hit 127.0.0.1, not localhost.
  // Without this, Next blocks HMR/webpack and the desk never hydrates.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
