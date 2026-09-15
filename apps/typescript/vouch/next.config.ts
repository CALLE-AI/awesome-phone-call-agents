import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const root = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  transpilePackages: ["remotion", "@remotion/player", "@remotion/google-fonts"],
  serverExternalPackages: ["better-sqlite3"],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@caller-ai/core": path.join(root, "vendor/core/src"),
      "@caller-ai/reel": path.join(root, "vendor/reel/src/index.ts"),
    };
    return config;
  },
};

export default nextConfig;
