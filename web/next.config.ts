import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The engine lives one level above this app (../src/engine — frozen, imported
  // by the lib/engine adapter). Let Next compile TS from outside the app root.
  experimental: { externalDir: true },
};

export default nextConfig;
