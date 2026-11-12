import { networkInterfaces } from 'node:os';
import type { NextConfig } from 'next';

/** IPs IPv4 desta máquina: o dev server aceita acesso do celular pela rede local. */
function localIPv4(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a!.address);
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // O viewer é consumido como fonte TypeScript dentro do monorepo.
  transpilePackages: ['@vidomo/viewer'],
  // Só afeta `next dev`.
  allowedDevOrigins: localIPv4(),
};

export default nextConfig;
