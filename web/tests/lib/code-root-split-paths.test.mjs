// Under the split layout (CAREER_OPS_ROOT = a data-only directory) the engine
// scripts and templates live in the code root, never in the data root. Each case
// points CAREER_OPS_ROOT at a synthetic directory holding no .mjs scripts and
// asserts the module still reaches the core — and still writes to the data root.
//
// Run (from web/):  node --experimental-strip-types --test tests/lib/code-root-split-paths.test.mjs

import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import "../helpers/web-ts-alias-loader.mjs";

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// Same guard as followups-lock.test.mjs: a web-only install has the core files
// but not their dependencies, so the core cases skip instead of failing.
let skipCore = false;
try {
  await import(pathToFileURL(path.join(CODE_ROOT, "followup-seed.mjs")).href);
  await import(pathToFileURL(path.join(CODE_ROOT, "tracker-utils.mjs")).href);
} catch (err) {
  if (err.code !== "ERR_MODULE_NOT_FOUND") throw err;
  if (fs.existsSync(path.join(CODE_ROOT, "node_modules"))) throw err;
  skipCore = `core dependencies are not installed at ${CODE_ROOT} (web-only checkout)`;
}

const fixtures = [];
after(() => {
  for (const dir of fixtures) fs.rmSync(dir, { recursive: true, force: true });
});

function makeDataRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-split-data-"));
  fixtures.push(root);
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  return root;
}

const ENV_KEYS = ["CAREER_OPS_ROOT", "CAREER_OPS_DATA_DIR", "CAREER_OPS_CODE_ROOT", "CAREER_OPS_TRACKER", "CAREER_OPS_PDF_INDEX"];

async function withSplitEnv(dataRoot, fn) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.CAREER_OPS_ROOT = dataRoot;
  process.env.CAREER_OPS_CODE_ROOT = CODE_ROOT;
  try {
    return await fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const assertNoScripts = (dataRoot) =>
  assert.deepEqual(fs.readdirSync(dataRoot).filter((f) => f.endsWith(".mjs")), [], "the data root must stay script-free");

test("inbox skip writes the data-root pipeline using the code-root lock", { skip: skipCore }, async () => {
  const dataRoot = makeDataRoot();
  const url = "https://boards.greenhouse.io/acme/jobs/1";
  const legacy = "- [ ] https://jobs.lever.co/beta/2 | Beta | Platform Engineer | NYC";
  const pipeline = path.join(dataRoot, "data", "pipeline.md");
  fs.writeFileSync(pipeline, ["# Pipeline", "", "## Pending", "", `- [ ] ${url} | Acme | Staff Engineer | Remote`, legacy, ""].join("\n"));

  const { POST } = await import("../../src/app/api/inbox/skip/route.ts");
  const response = await withSplitEnv(dataRoot, () =>
    POST(new Request("http://localhost/api/inbox/skip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, done: true }),
    })),
  );

  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const saved = fs.readFileSync(pipeline, "utf8");
  assert.match(saved, /^- \[x\] https:\/\/boards\.greenhouse\.io\/acme\/jobs\/1 \| Acme/m);
  // A legacy row without a type marker is left byte-identical, not reclassified.
  assert.ok(saved.split("\n").includes(legacy));
  assertNoScripts(dataRoot);
});

test("pdf-index resolves through the code-root tracker-utils", { skip: skipCore }, async () => {
  const dataRoot = makeDataRoot();
  const { resolvePdfIndexPath } = await import("../../src/lib/core/pdf-index.ts");
  const resolved = await withSplitEnv(dataRoot, () => resolvePdfIndexPath());
  assert.equal(resolved, path.join(dataRoot, "data", "pdf-index.tsv"));
  assertNoScripts(dataRoot);
});

test("states load canonical aliases from the code-root templates", async () => {
  const dataRoot = makeDataRoot();
  const { readCanonicalStates, canonicalizeStatus } = await import("../../src/lib/core/states.ts");
  await withSplitEnv(dataRoot, () => {
    const applied = readCanonicalStates().find((s) => s.label === "Applied");
    assert.ok(applied, "Applied must be a canonical state");
    assert.ok(applied.aliases.includes("aplicado"), `aliases came back as ${JSON.stringify(applied.aliases)}`);
    assert.equal(canonicalizeStatus("aplicado"), "Applied");
  });
});

test("follow-ups writers through withFollowupsLock are serialized by the core lock", { skip: skipCore }, async () => {
  const dataRoot = makeDataRoot();
  const file = path.join(dataRoot, "data", "follow-ups.md");
  fs.writeFileSync(file, "# Follow-ups\n\n");
  const events = [];

  // The routes' read-modify-write shape: read all, pause, write all back. The
  // pause only widens the window so the two writers overlap when unlocked.
  const addPin = (n, pauseMs) => () => {
    events.push(`enter ${n}`);
    const existing = fs.readFileSync(file, "utf8");
    return new Promise((resolve) => setTimeout(() => {
      fs.writeFileSync(`${file}.tmp`, `${existing}- next #${n} 2026-07-1${n}\n`);
      fs.renameSync(`${file}.tmp`, file);
      events.push(`exit ${n}`);
      resolve();
    }, pauseMs));
  };

  const { withFollowupsLock } = await import("../../src/lib/core/followups-lock.ts");
  await withSplitEnv(dataRoot, () =>
    Promise.all([withFollowupsLock(file, addPin(1, 60)), withFollowupsLock(file, addPin(2, 10))]),
  );

  const pins = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.startsWith("- next #"));
  assert.equal(pins.length, 2, `a pin was lost: ${JSON.stringify(pins)}`);
  assert.deepEqual(
    [events[0].split(" ")[0], events[1].split(" ")[0], events[2].split(" ")[0], events[3].split(" ")[0]],
    ["enter", "exit", "enter", "exit"],
    `writers overlapped: ${events.join(", ")}`,
  );
  assertNoScripts(dataRoot);
});
