import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants.js";
import { IDENTITY_FILE, captureBuildIdentity, versionPayload } from "../../src/lib/build-identity.mjs";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function fakeCheckout(commit) {
  const files = {
    [join("/repo", "VERSION")]: "1.35.0 # x-release-please-version\n",
    [join("/repo/web", "package.json")]: JSON.stringify({ version: "0.13.0" }),
  };
  return {
    webDir: "/repo/web",
    runGit: (args) => (args.includes("--short") ? commit.value.slice(0, 7) : commit.value),
    readText: (p) => {
      if (!(p in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files[p];
    },
  };
}

test("captureBuildIdentity records git SHA, VERSION and web version once", () => {
  const commit = { value: "a".repeat(40) };
  assert.deepEqual(captureBuildIdentity(fakeCheckout(commit)), {
    CAREER_OPS_BUILD_SHA: "a".repeat(40),
    CAREER_OPS_BUILD_SHORT_SHA: "aaaaaaa",
    CAREER_OPS_BUILD_VERSION: "1.35.0",
    CAREER_OPS_BUILD_WEB_VERSION: "0.13.0",
  });
});

test("a build of A keeps reporting A after the checkout moves to B", () => {
  const commit = { value: "a".repeat(40) };
  const deps = fakeCheckout(commit);
  const env = captureBuildIdentity(deps);
  commit.value = "b".repeat(40);
  assert.equal(deps.runGit(["rev-parse", "--short", "HEAD"]), "bbbbbbb");
  const payload = versionPayload({
    sha: env.CAREER_OPS_BUILD_SHORT_SHA,
    fullSha: env.CAREER_OPS_BUILD_SHA,
    coreVersion: env.CAREER_OPS_BUILD_VERSION,
    webVersion: env.CAREER_OPS_BUILD_WEB_VERSION,
  });
  assert.equal(payload.sha, "aaaaaaa");
  assert.equal(payload.fullSha, "a".repeat(40));
});

test("captureBuildIdentity without git yields empty strings, not an error", () => {
  const identity = captureBuildIdentity({
    webDir: "/nowhere/web",
    runGit: () => {
      throw new Error("not a git repository");
    },
    readText: () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
  });
  assert.deepEqual(identity, {
    CAREER_OPS_BUILD_SHA: "",
    CAREER_OPS_BUILD_SHORT_SHA: "",
    CAREER_OPS_BUILD_VERSION: "",
    CAREER_OPS_BUILD_WEB_VERSION: "",
  });
});

test("versionPayload keeps the /api/version shape and channel rules", () => {
  assert.deepEqual(versionPayload({ sha: "abc1234", fullSha: "abc", coreVersion: "1.35.0", webVersion: "0.13.0" }), {
    version: "web 0.13.0",
    coreVersion: "1.35.0",
    channel: "alpha",
    sha: "abc1234",
    fullSha: "abc",
  });
  assert.equal(versionPayload({ coreVersion: "1.36.0-rc.1", webVersion: "1.0.0" }).channel, "rc");
  assert.equal(versionPayload({ coreVersion: "1.36.0", webVersion: "1.0.0" }).channel, "stable");
  assert.deepEqual(versionPayload({}), { version: "", coreVersion: "", channel: "stable", sha: "", fullSha: "" });
});

test("/api/version reads the captured identity, never git at runtime", () => {
  const route = readFileSync(join(WEB_ROOT, "src/app/api/version/route.ts"), "utf8");
  assert.doesNotMatch(route, /child_process/);
  assert.doesNotMatch(route, /\bgit\b/);
  assert.match(route, /process\.env\.CAREER_OPS_BUILD_SHORT_SHA/);
});

test("next.config.mjs captures the identity into Next's build-time env", () => {
  const config = readFileSync(join(WEB_ROOT, "next.config.mjs"), "utf8");
  assert.match(config, /captureBuildIdentity/);
  assert.match(config, /\benv:/);
});

test("next build writes the same identity next to BUILD_ID for the app bundle", async () => {
  const { default: nextConfig } = await import("../../next.config.mjs");
  const config = nextConfig(PHASE_PRODUCTION_BUILD);
  const distDir = mkdtempSync(join(tmpdir(), "identity-"));
  try {
    await config.compiler.runAfterProductionCompile({ projectDir: WEB_ROOT, distDir });
    const written = JSON.parse(readFileSync(join(distDir, IDENTITY_FILE), "utf8"));
    assert.deepEqual(written, config.env);
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: WEB_ROOT }).toString().trim();
    assert.equal(written.CAREER_OPS_BUILD_SHA, head);
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
});

test("next start neither recaptures the identity nor rewrites the file", async () => {
  const { default: nextConfig } = await import("../../next.config.mjs");
  const config = nextConfig(PHASE_PRODUCTION_SERVER);
  assert.deepEqual(config.env, {});
  assert.equal(config.compiler?.runAfterProductionCompile, undefined);
});
