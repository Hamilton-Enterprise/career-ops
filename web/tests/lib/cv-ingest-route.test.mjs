// /api/cv/ingest: refuse oversized or unsupported input BEFORE the agent is
// launched (never truncate), and remove the uploaded CV's temp directory on
// every terminal path. Real route, real spawn; only the agent binaries are
// synthetic, and every CV here is synthetic.
//
// Run (from web/):  node --experimental-strip-types --test tests/lib/cv-ingest-route.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import "../helpers/web-ts-alias-loader.mjs";

const { POST } = await import("../../src/app/api/cv/ingest/route.ts");
const { CV_UPLOAD_MAX_BYTES } = await import("../../src/lib/cv/quality.ts");

const ENVELOPE = "A ler o CV…\n<<cv:start>>\n# CV -- Pessoa Exemplo\n\n## Experiência profissional\n<<cv:end>>\n<<cv:seed>>{\"title\":\"Analista\"}\n";

function writeMockCli(dir, name, source) {
  const entry = path.join(dir, `${name}.cjs`);
  fs.writeFileSync(entry, source);
  fs.writeFileSync(path.join(dir, name), `#!${process.execPath}\nrequire(${JSON.stringify(entry)});\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, `${name}.ps1`), `& "node$exe" "$basedir/${name}.cjs" $args\n`);
}

function fixture(t, behavior = "success") {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-cv-route-test-")));
  const bins = path.join(root, "bin");
  const data = path.join(root, "data");
  const tmp = path.join(root, "tmp");
  for (const dir of [bins, data, tmp]) fs.mkdirSync(dir, { recursive: true });
  const recordFile = path.join(root, "invocations.jsonl");
  for (const [id, bin] of [["claude", "claude"], ["codex", "codex"]]) {
    writeMockCli(bins, bin, `
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("--version")) {
  process.stdout.write("--ask-for-approval <POLICY>\\n--sandbox <MODE> [possible values: read-only, workspace-write]\\n--output-last-message <FILE>\\n");
  process.exit(0);
}
const prompt = args.find((a) => a.includes("SOURCE")) || "";
const sourceLine = prompt.trim().split("\\n").pop();
fs.appendFileSync(${JSON.stringify(recordFile)}, JSON.stringify({ id: ${JSON.stringify(id)}, prompt, sourceLine, sourceExists: fs.existsSync(sourceLine), pid: process.pid }) + "\\n");
const say = (text) => process.stdout.write(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { text } } }) + "\\n");
const behavior = ${JSON.stringify(behavior)};
if (behavior === "success") say(${JSON.stringify(ENVELOPE)});
else if (behavior === "silent-fail") process.exitCode = 7;
else if (behavior === "hang") { say("A ler o CV…\\n<<cv:start>>\\n# CV"); setInterval(() => {}, 1000); }
`);
  }
  const values = { PATH: bins, CAREER_OPS_ROOT: data, CAREER_OPS_DATA_DIR: data, TMPDIR: tmp };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  const records = () => (fs.existsSync(recordFile) ? fs.readFileSync(recordFile, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : []);
  t.after(() => {
    for (const r of records()) {
      try {
        process.kill(r.pid, "SIGKILL");
      } catch {
        /* already reaped */
      }
    }
    for (const key of Object.keys(values)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const tempDirs = () => fs.readdirSync(tmp).filter((n) => n.startsWith("career-ops-cv-"));
  return { records, tempDirs };
}

const postText = (text, cliId = "claude") =>
  POST(new Request("http://localhost/api/cv/ingest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, cliId }) }));

function postFile(name, bytes, { cliId = "claude", headers = {} } = {}) {
  const form = new FormData();
  form.append("file", new File([bytes], name));
  form.append("cliId", cliId);
  return POST(new Request("http://localhost/api/cv/ingest", { method: "POST", body: form, headers }));
}

async function waitFor(predicate, message) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail(message);
}

test("text over 24 000 characters is refused with 413 before any agent runs", async (t) => {
  const f = fixture(t);
  const res = await postText("a".repeat(24001));
  assert.equal(res.status, 413);
  const body = await res.json();
  assert.match(body.error, /24\s001 caracteres/);
  assert.match(body.error, /24\s000/);
  assert.equal(f.records().length, 0, "the agent must not be launched");
});

test("text at the limit reaches the agent whole, never truncated", async (t) => {
  const f = fixture(t);
  const text = `${"b".repeat(23999)}Z`;
  const res = await postText(text);
  assert.equal(res.status, 200);
  await res.text();
  assert.ok(f.records()[0].prompt.includes(text), "the full text, including its last character, is in the prompt");
});

test("an upload whose Content-Length exceeds the limit is refused before it is read", async (t) => {
  const f = fixture(t);
  const res = await postFile("cv.pdf", "x", { headers: { "content-length": String(CV_UPLOAD_MAX_BYTES + 1024 * 1024) } });
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /MB/);
  assert.equal(f.records().length, 0);
  assert.deepEqual(f.tempDirs(), []);
});

test("an oversized file is refused by its size and leaves no temp directory", async (t) => {
  const f = fixture(t);
  const res = await postFile("cv.pdf", new Uint8Array(CV_UPLOAD_MAX_BYTES + 1));
  assert.equal(res.status, 413);
  assert.equal(f.records().length, 0);
  assert.deepEqual(f.tempDirs(), []);
});

test("an unsupported file type is refused with 415", async (t) => {
  const f = fixture(t);
  const res = await postFile("foto.png", "x");
  assert.equal(res.status, 415);
  assert.match((await res.json()).error, /\.png/);
  assert.equal(f.records().length, 0);
  assert.deepEqual(f.tempDirs(), []);
});

test("PDF and Word with an agent that cannot read files get their own specific reason", async (t) => {
  const f = fixture(t);
  const pdf = await (await postFile("cv.pdf", "x", { cliId: "codex" })).json();
  assert.match(pdf.error, /PDF/);
  assert.match(pdf.error, /Codex/);
  assert.match(pdf.error, /cola o texto/i);
  const word = await (await postFile("cv.docx", "x", { cliId: "codex" })).json();
  assert.match(word.error, /Word/);
  assert.equal(f.records().length, 0);
  assert.deepEqual(f.tempDirs(), []);
});

test("success: the agent read the temp file, and the temp directory is gone afterwards", async (t) => {
  const f = fixture(t, "success");
  const res = await postFile("cv.pdf", "%PDF-1.4 synthetic");
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<<cv:end>>/);
  assert.equal(f.records()[0].sourceExists, true);
  await waitFor(() => f.tempDirs().length === 0, "temp directory survived a successful run");
});

test("agent failure without output: temp directory is removed", async (t) => {
  const f = fixture(t, "silent-fail");
  const res = await postFile("cv.pdf", "%PDF-1.4 synthetic");
  assert.match(await res.text(), /<<cv:error>>/);
  assert.equal(f.records().length, 1);
  await waitFor(() => f.tempDirs().length === 0, "temp directory survived a failed run");
});

test("client cancel: the agent is stopped and the temp directory is removed", async (t) => {
  const f = fixture(t, "hang");
  const res = await postFile("cv.pdf", "%PDF-1.4 synthetic");
  const reader = res.body.getReader();
  await waitFor(() => f.records().length === 1, "agent never started");
  assert.equal(f.tempDirs().length, 1, "the temp file exists while the agent runs");
  await reader.read();
  await reader.cancel();
  await waitFor(() => f.tempDirs().length === 0, "temp directory survived a cancelled run");
  const { pid } = f.records()[0];
  await waitFor(() => {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  }, "agent still running after cancel");
});
