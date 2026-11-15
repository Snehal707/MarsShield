import path from "node:path";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import type { NextConfig } from "next";

// STATIC_EXPORT=1 builds the public, backend-free demo (GitHub Pages): plain files in `out/`,
// served under NEXT_PUBLIC_BASE_PATH (e.g. "/MarsShield"). Without it, `next start` serves the app
// locally and the live FastAPI science service can be used.
const isStatic = process.env.STATIC_EXPORT === "1";
// version stamped into research packages: package.json version + git commit (env override for remote builds)
const pkgVersion = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8")).version as string;
let commit = process.env.NEXT_PUBLIC_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "";
if (!commit) { try { commit = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { commit = "unknown"; } }
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  ...(isStatic ? { output: "export" as const, trailingSlash: true, images: { unoptimized: true } } : {}),
  basePath,
  env: { NEXT_PUBLIC_VERSION: pkgVersion, NEXT_PUBLIC_COMMIT: commit },
  turbopack: { root: path.join(__dirname) },
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
