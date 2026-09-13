import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client", "xlsx", "pdf-parse", "@call-e/calle"],
};

export default nextConfig;
