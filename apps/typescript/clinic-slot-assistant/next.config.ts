import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ['@call-e/calle'],
  outputFileTracingRoot: process.cwd(),
  turbopack: {root: process.cwd()},
};
export default config;
