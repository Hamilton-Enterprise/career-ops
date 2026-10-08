import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants.js";
import { IDENTITY_FILE, captureBuildIdentity } from "./src/lib/build-identity.mjs";

/** @type {(phase: string) => import('next').NextConfig} */
const nextConfig = (phase) => {
  // `next start` already serves the values inlined by `next build`.
  const identity =
    phase === PHASE_PRODUCTION_SERVER
      ? {}
      : captureBuildIdentity({
          webDir: import.meta.dirname,
          runGit: (args) =>
            execFileSync("git", args, { cwd: import.meta.dirname, stdio: ["ignore", "pipe", "ignore"] }).toString(),
          readText: (p) => readFileSync(p, "utf8"),
        });
  return {
    // Two lockfiles exist on purpose (repo root + web/), so Next would infer the
    // repo root as the workspace root. On Windows that misinference can send
    // Turbopack's postcss workers into an unbounded respawn loop that exhausts
    // all RAM (vercel/next.js#92978) — pin the root to this app.
    turbopack: { root: import.meta.dirname },
    // Allow a throwaway build dir (e.g. BUILD_DIST=.next-prod) so a production
    // `next build` can run without clobbering a live `next dev` .next.
    ...(process.env.BUILD_DIST ? { distDir: process.env.BUILD_DIST } : {}),
    env: identity,
    // `next build` empties distDir after loading this config, so the file is
    // written from the post-compile hook rather than here.
    ...(phase === PHASE_PRODUCTION_BUILD
      ? {
          compiler: {
            runAfterProductionCompile: async ({ distDir }) => {
              writeFileSync(join(distDir, IDENTITY_FILE), `${JSON.stringify(identity, null, 2)}\n`);
            },
          },
        }
      : {}),
  };
};

export default nextConfig;
