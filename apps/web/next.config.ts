import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // O viewer é consumido como fonte TypeScript dentro do monorepo.
  transpilePackages: ['@vidomo/viewer'],
};

export default nextConfig;
