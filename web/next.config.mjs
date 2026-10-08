import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { PHASE_PRODUCTION_SERVER } from "next/constants.js";
import { captureBuildIdentity } from "./src/lib/build-identity.mjs";

/** @type {(phase: string) => import('next').NextConfig} */
const nextConfig = (phase) => ({
  // Two lockfiles exist on purpose (repo root + web/), so Next would infer the
  // repo root as the workspace root. On Windows that misinference can send
  // Turbopack's postcss workers into an unbounded respawn loop that exhausts
  // all RAM (vercel/next.js#92978) — pin the root to this app.
  turbopack: { root: import.meta.dirname },
  // Allow a throwaway build dir (e.g. BUILD_DIST=.next-prod) so a production
  // `next build` can run without clobbering a live `next dev` .next.
  ...(process.env.BUILD_DIST ? { distDir: process.env.BUILD_DIST } : {}),
  // `next start` already serves the values inlined by `next build`.
  env:
    phase === PHASE_PRODUCTION_SERVER
      ? {}
      : captureBuildIdentity({
          webDir: import.meta.dirname,
          runGit: (args) =>
            execFileSync("git", args, { cwd: import.meta.dirname, stdio: ["ignore", "pipe", "ignore"] }).toString(),
          readText: (p) => readFileSync(p, "utf8"),
        }),
});

export default nextConfig;
