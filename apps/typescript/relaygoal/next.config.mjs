/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ESLint isn't a dependency here; keep it from blocking the build. Types are still checked.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
