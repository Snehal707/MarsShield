import path from "node:path";
import type { NextConfig } from "next";

// STATIC_EXPORT=1 builds the public, backend-free demo (GitHub Pages): plain files in `out/`,
// served under NEXT_PUBLIC_BASE_PATH (e.g. "/MarsShield"). Without it, `next start` serves the app
// locally and the live FastAPI science service can be used.
const isStatic = process.env.STATIC_EXPORT === "1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  ...(isStatic ? { output: "export" as const, trailingSlash: true, images: { unoptimized: true } } : {}),
  basePath,
  turbopack: { root: path.join(__dirname) },
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
