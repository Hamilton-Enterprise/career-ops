import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../helpers/web-ts-alias-loader.mjs";

const { POST } = await import("../../src/app/api/run/route.ts");
const { readLanguageConfig } = await import("../../src/lib/career-ops.ts");
const { isTrackerWriting } = await import("../../src/lib/core/run-registry.ts");

async function waitFor(predicate, message) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

function isDead(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    if (e.code !== "ESRCH") throw e;
    return true;
  }
}

function writeMockCli(dir, name, source) {
  const entry = path.join(dir, `${name}.cjs`);
  fs.writeFileSync(entry, source);
  fs.writeFileSync(path.join(dir, name), `#!${process.execPath}\nrequire(${JSON.stringify(entry)});\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, `${name}.ps1`), `& "node$exe" "$basedir/${name}.cjs" $args\n`);
}

function fixture(t, { market = false, pdf = false, hang = false } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-run-split-")));
  const code = path.join(root, "engine", "checkout");
  const data = path.join(root, "user-data");
  const bins = path.join(root, "bin");
  const recordFile = path.join(root, "invocation.json");
  for (const dir of [bins, path.join(code, "modes", "de"), path.join(code, "modes", "zh"), path.join(data, "config"), path.join(data, "reports")]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path.join(code, "modes", "oferta.md"), "# Evaluation A-G\n");
  fs.writeFileSync(path.join(code, "modes", "de", "angebot.md"), "# Angebot A-G\n");
  fs.writeFileSync(path.join(code, "modes", "zh", "oferta.md"), "# Evaluation A-G\n");
  fs.writeFileSync(path.join(code, "modes", "pdf.md"), "# Tailoring rules\n");
  fs.writeFileSync(path.join(code, "verify-portals.mjs"), "// System verifier\n");
  fs.writeFileSync(path.join(data, "cv.md"), "# Synthetic CV\n");
  fs.writeFileSync(path.join(data, "config", "profile.yml"), `candidate:\n  full_name: Synthetic Candidate\ncv:\n  template: custom\nlanguage:\n  output: pt-PT\n${market ? "  modes_dir: [modes/de, modes/zh]\n" : ""}`);
  fs.writeFileSync(path.join(data, "reports", "001-synthetic-2026-10-08.md"), "# Synthetic report\n");
  // Use the real core resolver, including its module-load data-root lookup.
  const engine = fileURLToPath(new URL("../../../", import.meta.url));
  for (const file of ["cv-templates.mjs", "path-resolver.mjs", "lib/is-main-module.mjs", "providers/_html-entities.mjs"]) {
    fs.mkdirSync(path.dirname(path.join(code, file)), { recursive: true });
    fs.copyFileSync(path.join(engine, file), path.join(code, file));
  }
  fs.symlinkSync(path.join(engine, "node_modules"), path.join(code, "node_modules"), "dir");
  fs.mkdirSync(path.join(code, "templates"));
  for (const name of ["cv-template.html", "cv-template.custom.html"]) {
    fs.writeFileSync(path.join(code, "templates", name), "{{NAME}}{{EXPERIENCE}}{{EDUCATION}}");
  }
  // Replace only the external model and PDF renderer. Resolution, preflight,
  // permissions, real processes, stream parsing and user-file paths stay real.
  const record = `const fs = require("node:fs"); const path = require("node:path");`;
  const text = pdf ? '\n<<cv-html format="a4">>\n<!DOCTYPE html><html><body>Synthetic CV</body></html>\n<</cv-html>>\n' : "Synthetic completion\n";
  // `hang` starts a descendant detached into its own session (out of reach of a
  // POSIX process-group kill) that keeps the inherited stdout open, then waits.
  const hangSource = `const descendantPid = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit", detached: true }).pid;\nfs.writeFileSync(${JSON.stringify(recordFile)}, JSON.stringify({cwd: process.cwd(), args, pid: process.pid, descendantPid}));\nsetInterval(() => {}, 1000);\n`;
  writeMockCli(bins, "claude", `${record}\nconst args = process.argv.slice(2);\nfs.writeFileSync(${JSON.stringify(recordFile)}, JSON.stringify({cwd: process.cwd(), args, dataRoot: process.env.CAREER_OPS_ROOT}));\nprocess.stdout.write(JSON.stringify({type:"stream_event",event:{type:"content_block_delta",delta:{text:${JSON.stringify(text)}}}}) + "\\n");\n${hang ? hangSource : ""}`);
  writeMockCli(bins, "codex", `${record}\nconst args = process.argv.slice(2);\nfs.writeFileSync(${JSON.stringify(recordFile)}, JSON.stringify({cwd: process.cwd(), args, dataRoot: process.env.CAREER_OPS_ROOT}));\nconst roots = args.find(arg => arg.startsWith("sandbox_workspace_write.writable_roots="));\nif (roots && JSON.parse(roots.slice(roots.indexOf("=") + 1)).includes(process.env.CAREER_OPS_ROOT)) fs.writeFileSync(path.join(process.env.CAREER_OPS_ROOT, "reports", "002-synthetic-2026-10-08.md"), "Synthetic persisted report");\nprocess.stdout.write(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"Synthetic completion"}}) + "\\n");\n`);
  writeMockCli(bins, "agent", `${record}\nfs.writeFileSync(${JSON.stringify(recordFile)}, JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)}));\nprocess.stdout.write("Synthetic read-only completion");\n`);
  fs.writeFileSync(path.join(code, "generate-pdf.mjs"), `import fs from "node:fs";\nimport path from "node:path";\nconst target = process.argv[3];\nif (!fs.readFileSync(path.join(process.env.CAREER_OPS_ROOT, "cv.md"), "utf8").includes("Synthetic")) process.exit(1);\nfs.mkdirSync(path.dirname(target), {recursive:true});\nfs.writeFileSync(target, "SYNTHETIC PDF");\n`);
  fs.writeFileSync(path.join(code, "mark-pdf-ready.mjs"), `import fs from "node:fs";\nimport path from "node:path";\nfs.writeFileSync(path.join(process.env.CAREER_OPS_ROOT, "marked.json"), JSON.stringify({cwd:process.cwd(), report:process.argv[2]}));\nprocess.stdout.write('{"ok":true}');\n`);
  const values = { PATH: bins, CAREER_OPS_ROOT: data, CAREER_OPS_DATA_DIR: data, CAREER_OPS_CODE_ROOT: code, CAREER_OPS_PROFILE: undefined };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    if (hang && fs.existsSync(recordFile)) {
      const { pid, descendantPid } = JSON.parse(fs.readFileSync(recordFile, "utf8"));
      for (const id of [pid, descendantPid].filter(Boolean)) {
        try { process.kill(id, "SIGKILL"); } catch { /* already reaped */ }
      }
    }
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { code, data, recordFile, record: () => JSON.parse(fs.readFileSync(recordFile, "utf8")) };
}

function invoke(kind, cliId = "claude") {
  return POST(new Request("http://localhost/api/run", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, input: kind === "pdf" ? "001" : "Synthetic", cliId }),
  }));
}

test("market rules resolve in the code checkout while language preferences come from external data", t => {
  fixture(t, { market: true });
  assert.deepEqual(readLanguageConfig(), {
    output: "pt-PT", modesDir: "modes/de", modesDirs: ["modes/de", "modes/zh"], evalModeFile: "modes/de/angebot.md",
  });
});

for (const kind of ["evaluate", "pdf", "fix-portal"]) {
  test(`${kind}: data-only root passes system preflight and starts the worker in the code checkout`, async t => {
    const f = fixture(t, { market: true });
    const response = await invoke(kind);
    assert.equal(response.status, 200, await response.clone().text());
    await response.text();
    const record = f.record();
    assert.equal(record.cwd, f.code);
    assert.equal(record.dataRoot, f.data);
    const prompt = record.args[record.args.indexOf("-p") + 1];
    const promptDataRoot = prompt.match(/The user data root is (.+?): resolve cv\.md/)?.[1];
    assert.equal(JSON.parse(promptDataRoot ?? "null"), f.data, "worker must resolve all user-layer reads and writes under data root");
    if (kind === "evaluate") {
      assert.ok(prompt.includes("modes/de/angebot.md"));
      assert.ok(prompt.includes("modes/zh/_shared.md"));
      assert.equal(fs.existsSync(path.join(f.code, "reports")), false);
    }
  });
}

test("cancelling an evaluation releases the tracker guard even while an escaped descendant holds stdout", async t => {
  const f = fixture(t, { hang: true });
  const response = await invoke("evaluate");
  assert.equal(response.status, 200);
  assert.equal(isTrackerWriting(), true, "evaluate holds the tracker write guard");
  await waitFor(() => fs.existsSync(f.recordFile) && f.record().descendantPid, "fixture never started its descendant");
  const { pid } = f.record();
  const reader = response.body.getReader();
  await reader.cancel();
  assert.equal((await reader.read()).done, true, "the response stream is closed");
  await waitFor(() => isDead(pid), "cancelled worker remains alive");
  await waitFor(() => !isTrackerWriting(), "the tracker guard must not wait forever on a descendant's stdout");
});

test("PDF rendering and marking execute code scripts but persist artifacts in external data", async t => {
  const f = fixture(t, { pdf: true });
  const response = await invoke("pdf");
  assert.equal(response.status, 200, await response.clone().text());
  const events = (await response.text()).trim().split("\n").map(JSON.parse);
  assert.equal(events.some(event => event.type === "error"), false, JSON.stringify(events));
  assert.equal(events.at(-1).type, "done");
  const prompt = f.record().args[f.record().args.indexOf("-p") + 1];
  assert.ok(prompt.includes("templates/cv-template.custom.html"), "system template resolver must load from code checkout");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.data, "marked.json"), "utf8")), { cwd: f.code, report: "001" });
  const [pdf] = fs.readdirSync(path.join(f.data, "output"));
  assert.match(pdf, /^cv-synthetic-candidate-synthetic-\d{4}-\d{2}-\d{2}\.pdf$/);
  assert.equal(fs.readFileSync(path.join(f.data, "output", pdf), "utf8"), "SYNTHETIC PDF");
  assert.equal(fs.existsSync(path.join(f.code, "output")), false);
  assert.deepEqual(fs.readdirSync(path.join(f.data, ".career-ops-web", "pdf-tmp")), []);
});

test("relative data-root overrides retain their original base in the worker and PDF scripts", async t => {
  const f = fixture(t, { pdf: true });
  process.env.CAREER_OPS_ROOT = path.relative(path.resolve(process.cwd(), ".."), f.data);
  const response = await invoke("pdf");
  assert.equal(response.status, 200);
  const events = (await response.text()).trim().split("\n").map(JSON.parse);
  assert.equal(events.at(-1).type, "done", JSON.stringify(events));
  assert.equal(f.record().dataRoot, f.data);
  assert.equal(fs.existsSync(path.join(f.data, "marked.json")), true);
});

test("a relative data root and a separate runtime select the user's template through the real resolver", async t => {
  const f = fixture(t, { pdf: true });
  const runtime = path.join(path.dirname(f.data), "runtime");
  fs.mkdirSync(path.join(runtime, "web"), { recursive: true });
  // Resolving ../user-data against the engine checkout selects this decoy.
  const wrongData = path.join(path.dirname(f.code), "user-data", "config");
  fs.mkdirSync(wrongData, { recursive: true });
  fs.writeFileSync(path.join(wrongData, "profile.yml"), "cv:\n  template: standard\n");
  process.env.CAREER_OPS_ROOT = "../user-data";
  const priorCwd = process.cwd();
  process.chdir(path.join(runtime, "web"));
  try {
    const response = await invoke("pdf");
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split("\n").map(JSON.parse);
    assert.equal(events.at(-1).type, "done", JSON.stringify(events));
    assert.equal(f.record().dataRoot, f.data);
    const prompt = f.record().args[f.record().args.indexOf("-p") + 1];
    assert.ok(prompt.includes("templates/cv-template.custom.html"), "template must follow the route's user profile, not the code-root decoy");
  } finally {
    process.chdir(priorCwd);
  }
});

test("an explicit profile override still takes precedence over the route's resolved default profile", async t => {
  const f = fixture(t, { pdf: true });
  fs.mkdirSync(path.join(f.code, "config"));
  fs.writeFileSync(path.join(f.code, "config", "profile.yml"), "cv:\n  template: standard\n");
  process.env.CAREER_OPS_PROFILE = "config/profile.yml";
  const response = await invoke("pdf");
  assert.equal(response.status, 200);
  await response.text();
  const prompt = f.record().args[f.record().args.indexOf("-p") + 1];
  assert.ok(prompt.includes("templates/cv-template.html"));
  assert.equal(prompt.includes("templates/cv-template.custom.html"), false);
});

test("marker-selected user data is passed explicitly to a worker running in the code checkout", async t => {
  const f = fixture(t);
  const priorCwd = process.cwd();
  fs.mkdirSync(path.join(f.code, "web"));
  fs.writeFileSync(path.join(f.code, ".career-ops-data"), path.relative(f.code, f.data) + "\n");
  delete process.env.CAREER_OPS_ROOT;
  delete process.env.CAREER_OPS_DATA_DIR;
  process.chdir(path.join(f.code, "web"));
  try {
    const response = await invoke("fix-portal");
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(f.record().cwd, f.code);
    assert.equal(f.record().dataRoot, f.data);
  } finally {
    process.chdir(priorCwd);
  }
});

for (const kind of ["evaluate", "fix-portal", "pdf", "research"]) {
  test(`Codex ${kind}: only write-capable actions authorize the external data root in real argv`, async t => {
    const f = fixture(t);
    const response = await invoke(kind, "codex");
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split("\n").map(JSON.parse);
    const { args, cwd } = f.record();
    assert.equal(cwd, f.code);
    assert.equal(args[args.indexOf("--ask-for-approval") + 1], "never");
    const roots = args.filter(arg => arg.startsWith("sandbox_workspace_write.writable_roots="));
    if (kind === "evaluate" || kind === "fix-portal") {
      assert.equal(roots.length, 1, "the sandbox must admit the external data root");
      assert.deepEqual(JSON.parse(roots[0].slice(roots[0].indexOf("=") + 1)), [f.data]);
      assert.equal(events.at(-1).type, "done", JSON.stringify(events));
      assert.equal(fs.existsSync(path.join(f.data, "reports", "002-synthetic-2026-10-08.md")), true);
      assert.equal(fs.existsSync(path.join(f.code, "reports")), false);
    } else {
      assert.deepEqual(roots, [], "read-only actions must not gain write access to user data");
      if (kind === "pdf") assert.ok(args.includes("sandbox_mode=read-only"));
    }
  });
}

test("Cursor retains Ask mode and cannot start actions that write", async t => {
  const f = fixture(t);
  for (const kind of ["evaluate", "fix-portal"]) {
    const response = await invoke(kind, "cursor");
    assert.equal(response.status, 400);
    assert.equal(fs.existsSync(f.recordFile), false);
  }
  const response = await invoke("pdf", "cursor");
  assert.equal(response.status, 200);
  await response.text();
  const { args } = f.record();
  assert.equal(args[args.indexOf("--mode") + 1], "ask");
  assert.equal(args.some(arg => arg.startsWith("sandbox_workspace_write.writable_roots=")), false);
});

test("a system mode copied into data cannot satisfy a missing code prerequisite", async t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.code, "modes", "oferta.md"));
  fs.mkdirSync(path.join(f.data, "modes"));
  fs.writeFileSync(path.join(f.data, "modes", "oferta.md"), "# Wrong system layer\n");
  const response = await invoke("evaluate");
  const body = await response.text();
  assert.equal(response.status, 400);
  assert.match(JSON.parse(body).error, /CAREER_OPS_CODE_ROOT/);
});

test("CV preflight continues to require the user's data file even when code contains a CV", async t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.data, "cv.md"));
  fs.writeFileSync(path.join(f.code, "cv.md"), "# Not the user's CV\n");
  const response = await invoke("evaluate");
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Adiciona primeiro o teu CV/);
});
