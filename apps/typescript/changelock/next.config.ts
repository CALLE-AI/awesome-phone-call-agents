import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @libsql/client loads platform-native bindings; it must not be bundled.
  serverExternalPackages: ["@libsql/client"],
};

export default nextConfig;
