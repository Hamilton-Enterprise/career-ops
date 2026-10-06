import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "../helpers/web-ts-alias-loader.mjs";

const { runMarketDiscovery } = await import("@/lib/core/market-scan");
const { runDiscovery } = await import("@/lib/core/scan");
const filters = { positive: [], negative: [], allow: [], block: [], alwaysAllow: [], blockHard: [], ats: [], markets: ["portugal"], sinceDays: 7, limitPerAts: 50 };
const receipt = { version: "careerops.scan.receipt@1", scanned: 1, skipped: 0, offers: [{ company: "Acme", title: "Engineer", location: "Portugal", source: "landingjobs-api", url: "https://acme.com/42", postedAt: "2026-10-05" }], errors: [], dry_run: true };

async function sandbox(t, script, profile = "") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "market-test-"));
  const old = { CAREER_OPS_ROOT: process.env.CAREER_OPS_ROOT, CAREER_OPS_CODE_ROOT: process.env.CAREER_OPS_CODE_ROOT };
  process.env.CAREER_OPS_ROOT = root;
  process.env.CAREER_OPS_CODE_ROOT = root;
  fs.mkdirSync(path.join(root, "config"));
  fs.writeFileSync(path.join(root, "config/profile.yml"), profile);
  if (script !== null) fs.writeFileSync(path.join(root, "scan.mjs"), script);
  t.after(() => {
    for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

test("market child uses dry-run JSON, ephemeral config, and cleans it after success", async t => {
  const root = await sandbox(t, `import fs from 'node:fs'; fs.writeFileSync('arguments.json', JSON.stringify({ args: process.argv.slice(2), portals: process.env.CAREER_OPS_PORTALS, config: fs.readFileSync(process.env.CAREER_OPS_PORTALS, 'utf8') })); console.log(${JSON.stringify(JSON.stringify(receipt))});`);
  const events = [];
  const run = await runMarketDiscovery(filters, e => events.push(e));
  assert.equal(run.offers.length, 1);
  const recorded = JSON.parse(fs.readFileSync(path.join(root, "arguments.json"), "utf8"));
  assert.deepEqual(recorded.args, ["--dry-run", "--json", "--since", "7"]);
  assert.match(recorded.config, /landingjobs/);
  assert.doesNotMatch(recorded.config, /strict: true/);
  assert.equal(fs.existsSync(recorded.portals), false);
  assert.equal(fs.existsSync(path.join(root, "data")), false);
  assert.equal(events[0].kind, "sourceStart");
  assert.ok(events.some(e => e.kind === "sourceDone"));
  assert.equal(events.find(e => e.kind === "sourceDone").count, 1);
});

test("missing scanner and malformed output produce failed source states", async t => {
  const root = await sandbox(t, null);
  assert.equal((await runMarketDiscovery(filters, () => {})).valid, false);
  fs.writeFileSync(path.join(root, "scan.mjs"), "console.log('bad JSON')");
  assert.equal((await runMarketDiscovery(filters, () => {})).status, "failed");
});

test("timeout preserves a flushed receipt as partial and cleans ephemeral config", async t => {
  const root = await sandbox(t, `import fs from 'node:fs'; fs.writeFileSync('temp-path', process.env.CAREER_OPS_PORTALS); process.on('SIGTERM', () => { console.log(${JSON.stringify(JSON.stringify(receipt))}); process.exit(2); }); setInterval(() => {}, 1000);`, "scan:\n  timeout_seconds: 1\n");
  const events = [];
  const run = await runMarketDiscovery(filters, e => events.push(e));
  assert.equal(run.status, "partial");
  assert.equal(run.offers.length, 1);
  assert.equal(run.sources[0].state, "error");
  assert.ok(events.some(e => e.kind === "sourceError"));
  assert.equal(events.filter(e => e.kind === "sourceDone").length, 0);
  assert.equal(fs.existsSync(fs.readFileSync(path.join(root, "temp-path"), "utf8")), false);
});

test("ATS success survives a missing market scanner without a fatal error", async t => {
  const root = await sandbox(t, null);
  fs.writeFileSync(path.join(root, "scan-ats-full.mjs"), `// --json capHit\nconsole.log(JSON.stringify({ companiesScanned:1, offers:[{company:'Acme',title:'Engineer',url:'https://acme.com/42',location:'Portugal',source:'greenhouse-full'}] }));`);
  const events = [];
  const offers = await runDiscovery({ ...filters, ats: ["greenhouse"] }, e => events.push(e));
  assert.equal(offers.length, 1);
  assert.equal(events.filter(e => e.kind === "error").length, 0);
  assert.equal(events.find(e => e.kind === "summary").status, "partial");
});

test("market-only route retains its selection and terminal NDJSON receipt", async t => {
  await sandbox(t, `console.log(${JSON.stringify(JSON.stringify(receipt))});`);
  const { POST } = await import("@/app/api/explore/route");
  const response = await POST(new Request("http://localhost/api/explore", { method: "POST", body: JSON.stringify(filters) }));
  assert.equal(response.status, 200);
  const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(events[0].ats, []);
  assert.equal(events.at(-1).kind, "done");
  assert.equal(events.at(-1).count, 1);
  assert.deepEqual(events.at(-1).cost, { tokens: 0, usd: 0 });
  assert.equal(events.find(e => e.kind === "summary").status, "ok");
});

test("runner counts missing locations and rejects present locations outside its market", async t => {
  const payload = { ...receipt, offers: [{ ...receipt.offers[0], location: "" }, { ...receipt.offers[0], url: "https://acme.com/43", location: "Madrid, Spain" }] };
  await sandbox(t, `console.log(${JSON.stringify(JSON.stringify(payload))});`);
  const run = await runMarketDiscovery(filters, () => {});
  assert.equal(run.missingLocation, 1);
  assert.equal(run.offers.length, 0);
  assert.equal(run.valid, true);
});

test("both scanners begin before either completes and duplicate sources survive", async t => {
  const root = await sandbox(t, `import fs from 'node:fs'; fs.writeFileSync('market-started', 'yes'); const timer = setInterval(() => { if(fs.existsSync('ats-started')) { clearInterval(timer); console.log(${JSON.stringify(JSON.stringify(receipt))}); } }, 10);`, "scan:\n  timeout_seconds: 1\n");
  fs.writeFileSync(path.join(root, "scan-ats-full.mjs"), `// --json capHit\nimport fs from 'node:fs'; fs.writeFileSync('ats-started', 'yes'); const timer = setInterval(() => { if(fs.existsSync('market-started')) { clearInterval(timer); console.log(JSON.stringify({companiesScanned:1,offers:[{company:'Acme',title:'Engineer',url:'https://acme.com/42?utm_source=ats',location:'',source:'greenhouse-full'}]})); } }, 10);`);
  const events = [];
  const offers = await runDiscovery({ ...filters, ats: ["greenhouse"] }, e => events.push(e));
  assert.equal(offers.length, 1);
  assert.equal(offers[0].location, "Portugal");
  assert.deepEqual(offers[0].sources, ["greenhouse-full", "landingjobs-api"]);
  assert.equal(events.find(e => e.kind === "summary").status, "ok");
});

test("a fatal market child cannot suppress a valid empty ATS receipt", async t => {
  const root = await sandbox(t, "process.exit(1)");
  fs.writeFileSync(path.join(root, "scan-ats-full.mjs"), "// --json capHit\nconsole.log(JSON.stringify({companiesScanned:1,offers:[]}));");
  const events = [];
  assert.deepEqual(await runDiscovery({ ...filters, ats: ["greenhouse"] }, e => events.push(e)), []);
  assert.equal(events.find(e => e.kind === "summary").status, "partial");
  assert.equal(events.filter(e => e.kind === "error").length, 0);
});

test("exit 2 preserves market offers and marks failed sources", async t => {
  const payload = { ...receipt, errors: [{ company: "getManfred (EN)", error: "offline" }] };
  await sandbox(t, `console.log(${JSON.stringify(JSON.stringify(payload))}); process.exit(2);`);
  const run = await runMarketDiscovery({ ...filters, markets: ["portugal", "spain"] }, () => {});
  assert.equal(run.offers.length, 1);
  assert.equal(run.status, "partial");
  assert.equal(run.sources.find(s => s.source === "getManfred (EN)").state, "error");
});

test("a timeout with no receipt is failed and leaves no ephemeral file", async t => {
  const root = await sandbox(t, "import fs from 'node:fs'; fs.writeFileSync('temp-path', process.env.CAREER_OPS_PORTALS); setInterval(() => {},1000);", "scan:\n  timeout_seconds: 1\n");
  const run = await runMarketDiscovery(filters, () => {});
  assert.equal(run.valid, false);
  assert.equal(run.status, "failed");
  assert.equal(fs.existsSync(fs.readFileSync(path.join(root, "temp-path"), "utf8")), false);
});

test("profile targeting seeds query providers without changing explicit title filters", async t => {
  const root = await sandbox(t, `import fs from 'node:fs'; fs.writeFileSync('portals-copy', fs.readFileSync(process.env.CAREER_OPS_PORTALS)); console.log(${JSON.stringify(JSON.stringify(receipt))});`, "target_roles:\n  primary:\n    - Data Engineer\n");
  const run = await runMarketDiscovery({ ...filters, markets: ["europe"] }, () => {});
  assert.equal(run.status, "ok");
  const config = fs.readFileSync(path.join(root, "portals-copy"), "utf8");
  assert.match(config, /Data Engineer/);
  assert.doesNotMatch(config, /title_filter:/);
});

test("all selected paths failing reports one fatal outcome", async t => {
  const payload = { ...receipt, offers: [], errors: [{ company: "Landing.jobs", error: "offline" }] };
  await sandbox(t, `console.log(${JSON.stringify(JSON.stringify(payload))}); process.exit(2);`);
  const events = [];
  assert.deepEqual(await runDiscovery({ ...filters, ats: ["greenhouse"] }, e => events.push(e)), []);
  assert.equal(events.filter(e => e.kind === "error").length, 1);
  assert.equal(events.find(e => e.kind === "summary").status, "failed");
});

test("an ATS child failure keeps its readable receipt but marks the joint search partial", async t => {
  const root = await sandbox(t, `console.log(${JSON.stringify(JSON.stringify(receipt))});`);
  fs.writeFileSync(path.join(root, "scan-ats-full.mjs"), "// --json capHit\nconsole.log(JSON.stringify({companiesScanned:1,offers:[]})); process.exit(1);");
  const events = [];
  assert.equal((await runDiscovery({ ...filters, ats: ["greenhouse"] }, e => events.push(e))).length, 1);
  assert.equal(events.find(e => e.kind === "summary").status, "partial");
  assert.ok(events.some(e => e.kind === "sourceError" && e.source === "greenhouse"));
  assert.equal(events.filter(e => e.kind === "error").length, 0);
});

test("nonzero market receipt reconciles source errors, incomplete summary and terminal offers", async t => {
  await sandbox(t, `console.log(${JSON.stringify(JSON.stringify(receipt))}); process.exit(2);`);
  const { POST } = await import("@/app/api/explore/route");
  const response = await POST(new Request("http://localhost/api/explore", { method: "POST", body: JSON.stringify(filters) }));
  const events = (await response.text()).trim().split("\n").map(JSON.parse);
  const summary = events.find(e => e.kind === "summary");
  assert.equal(summary.status, "partial");
  assert.deepEqual(summary.incomplete, ["Landing.jobs"]);
  assert.equal(summary.sources[0].state, "error");
  assert.ok(events.some(e => e.kind === "sourceError" && e.source === "Landing.jobs"));
  assert.equal(events.filter(e => e.kind === "sourceDone").length, 0);
  assert.equal(events.at(-1).kind, "done");
  assert.equal(events.at(-1).offers.length, 1);
  assert.equal(events.filter(e => e.kind === "error").length, 0);
});

test("skipped market receipt is failed alone and partial beside a valid ATS result", async t => {
  const payload = { ...receipt, scanned: 0, skipped: 1, offers: [] };
  const root = await sandbox(t, `console.log(${JSON.stringify(JSON.stringify(payload))});`);
  const events = [];
  assert.deepEqual(await runDiscovery(filters, e => events.push(e)), []);
  assert.equal(events.find(e => e.kind === "summary").status, "failed");
  assert.deepEqual(events.find(e => e.kind === "summary").incomplete, ["Landing.jobs"]);
  assert.equal(events.find(e => e.kind === "summary").sources[0].state, "skipped");
  assert.equal(events.filter(e => e.kind === "sourceDone").length, 0);
  fs.writeFileSync(path.join(root, "scan-ats-full.mjs"), "// --json capHit\nconsole.log(JSON.stringify({companiesScanned:1,offers:[]}));");
  const joined = [];
  assert.deepEqual(await runDiscovery({ ...filters, ats: ["greenhouse"] }, e => joined.push(e)), []);
  assert.equal(joined.find(e => e.kind === "summary").status, "partial");
  assert.deepEqual(joined.find(e => e.kind === "summary").incomplete, ["Landing.jobs"]);
  assert.equal(joined.filter(e => e.kind === "error").length, 0);
});

test("market scope filters provisional and terminal ATS offers and counts missing locations", async t => {
  const root = await sandbox(t, `console.log(${JSON.stringify(JSON.stringify({ ...receipt, offers: [] }))});`);
  const raw = ["Lisboa", "Madrid, Spain", "New York, United States", ""].map((location, i) => ({ company: "Acme", title: "Engineer", url: `https://acme.com/${i}`, location, source: "greenhouse-full" }));
  for (const json of [true, false]) {
    const script = json
      ? `// --json capHit\nconst offers = ${JSON.stringify(raw)}; for (const offer of offers) console.error(JSON.stringify({kind:'offer',...offer})); console.log(JSON.stringify({companiesScanned:1,offers}));`
      : raw.map(o => `console.log(${JSON.stringify(`  + [greenhouse-full] n/a | ${o.company} | ${o.title} | ${o.location}\n${o.url}`)});`).join("\n");
    fs.writeFileSync(path.join(root, "scan-ats-full.mjs"), script);
    const events = [];
    const offers = await runDiscovery({ ...filters, ats: ["greenhouse"] }, e => events.push(e));
    assert.deepEqual(offers.map(o => o.location), ["Lisboa"]);
    assert.deepEqual(events.filter(e => e.kind === "offer").map(e => e.offer.location), ["Lisboa"]);
    assert.equal(events.find(e => e.kind === "summary").missingLocation, 1);
    const unrestricted = await runDiscovery({ ...filters, ats: ["greenhouse"], markets: [] }, () => {});
    assert.equal(unrestricted.length, 4);
  }
});
