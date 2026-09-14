import type { NextConfig } from 'next';
const config: NextConfig = {
  env: {NEXT_PUBLIC_DEMO_ONLY: process.env.VERCEL === '1' || process.env.CLINIC_PUBLIC_DEMO === 'true' ? 'true' : 'false'},
  poweredByHeader: false,
  serverExternalPackages: ['@call-e/calle'],
  outputFileTracingRoot: process.cwd(),
  turbopack: {root: process.cwd()},
};
export default config;
