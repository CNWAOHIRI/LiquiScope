import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The engine lives one level above this app (../src/engine — frozen, imported
  // by the lib/engine adapter). Let Next compile TS from outside the app root,
  // and widen Turbopack's filesystem root to the repo root — `vercel build`
  // otherwise scopes it to web/ and the ../src imports become unresolvable.
  experimental: { externalDir: true },
  turbopack: { root: path.join(process.cwd(), "..") },
};

export default nextConfig;
