import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT, NODE } from './helpers.mjs';
import { isScratchDir, SCRATCH_PREFIX, markScratchOwner } from '../lib/scratch-dirs.mjs';
import { isNestedCheckout } from '../lib/mjs-files.mjs';

const source = fs.readFileSync(path.join(ROOT, 'test-all.mjs'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
function snapshot(dir, root = dir) {
  const files = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(files, snapshot(file, root));
    else files[path.relative(root, file)] = fs.readFileSync(file).toString('base64');
  }
  return files;
}

test('marked checkout copy, assessment CLI and live archive keep external data byte-identical', async t => {
  fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true });
  const tmp = fs.mkdtempSync(path.join(ROOT, 'work', 'suite-safety-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const codeRoot = path.join(tmp, 'checkout'), external = path.join(tmp, 'external');
  const scriptTmp = path.join(codeRoot, '.tmp-script-test-fixture');
  fs.mkdirSync(path.join(external, 'data'), { recursive: true });
  fs.writeFileSync(path.join(external, 'data', 'assessments.tsv'), '# existing user data\n');
  fs.writeFileSync(path.join(external, 'sentinel'), 'unchanged');
  const before = snapshot(external);
  fs.mkdirSync(scriptTmp, { recursive: true });
  // Only code needed by the real child CLIs; no user data or installed builds.
  for (const entry of fs.readdirSync(ROOT)) {
    if (/\.(mjs|json)$/.test(entry)) fs.copyFileSync(path.join(ROOT, entry), path.join(codeRoot, entry));
  }
  fs.cpSync(path.join(ROOT, 'lib'), path.join(codeRoot, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(codeRoot, '.career-ops-data'), external);
  fs.writeFileSync(path.join(codeRoot, '.env'), `CAREER_OPS_ROOT=${external}\n`);
  const markerBefore = fs.readFileSync(path.join(codeRoot, '.career-ops-data'));
  const markerStat = fs.statSync(path.join(codeRoot, '.career-ops-data'));
  const failures = [], passes = [];
  const bindings = {
    ...fs, ...path, ROOT: codeRoot, scriptTmp, NODE, isScratchDir, isNestedCheckout, SCRATCH_PREFIX, markScratchOwner,
    pass: message => passes.push(message), fail: message => failures.push(message), warn() {},
    spawnSync, process: { env: { ...process.env, CAREER_OPS_ROOT: external, CAREER_OPS_DATA_DIR: external } },
  };
  delete bindings.default;
  bindings.fixtureEnv = new Function('process', source.match(/function fixtureEnv\(root\) \{[\s\S]*?\n\}/)[0] + '\nreturn fixtureEnv;')(bindings.process);
  const execute = async body => new AsyncFunction(...Object.keys(bindings), body)(...Object.values(bindings));
  await execute(section('  const EXCLUDE_AT_ANY_DEPTH', "\n  mkdirSync(join(scriptTmp, 'data')"));
  fs.mkdirSync(path.join(scriptTmp, 'data'), { recursive: true });
  await execute(section('  // assessment-log.mjs CLI contract', '  // reply-watch.mjs CLI flag validation'));

  const fakeBrowser = `export const chromium = { launch: async () => ({
    newContext: async () => ({ route: async () => {}, close: async () => {}, newPage: async () => ({
      goto: async () => ({ status: () => 200 }), url: () => 'https://boards.greenhouse.io/acme/jobs/1',
      waitForTimeout: async () => {}, title: async () => 'Engineer | Acme', $eval: async () => 'Engineer',
      evaluate: async () => 'Acme is hiring an Engineer. Build and maintain applications.',
      pdf: async () => Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(60 * 1024)]),
    }) }), close: async () => {},
  }) };`;
  const packageDir = path.join(codeRoot, 'node_modules', 'playwright');
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ type: 'module', exports: './index.mjs' }));
  fs.writeFileSync(path.join(packageDir, 'index.mjs'), fakeBrowser);
  const writes = [];
  bindings.importPlaywright = async () => ({ chromium: { executablePath: () => path.join(packageDir, 'index.mjs') } });
  bindings.fetch = async () => ({ json: async () => ({ jobs: [{ absolute_url: 'https://boards.greenhouse.io/acme/jobs/1' }] }) });
  bindings.run = (_cmd, argv, opts = {}) => {
    const result = spawnSync(NODE, [path.join(codeRoot, argv[0]), ...argv.slice(1)], {
      cwd: codeRoot, encoding: 'utf8', env: bindings.process.env, ...opts,
    });
    if (result.status !== 0) throw new Error(result.stderr);
    const root = opts.env?.CAREER_OPS_ROOT ?? external;
    writes.push(root);
    return result.stdout;
  };
  await execute(section('// live render: gated', '// ── 13. LOCATION FILTER').replace("await import('playwright')", 'await importPlaywright()'));
  assert.deepEqual(failures, [], 'the existing CLI and PDF assertions must still run and pass');
  assert.equal(passes.some(message => message.startsWith('live archive: PDF has real content')), true);
  assert.equal(passes.some(message => message.includes('preserves add/summary flags')), true);
  assert.equal(writes.length, 1, 'the live archive must execute');
  assert.notEqual(writes[0], external, 'archive child uses a disposable data root');
  assert.equal(fs.existsSync(path.join(scriptTmp, '.career-ops-data')), false);
  assert.equal(fs.existsSync(path.join(scriptTmp, '.env')), false);
  assert.deepEqual(fs.readFileSync(path.join(codeRoot, '.career-ops-data')), markerBefore);
  assert.equal(fs.statSync(path.join(codeRoot, '.career-ops-data')).mtimeMs, markerStat.mtimeMs);
  assert.deepEqual(snapshot(external), before, 'no changed bytes or new files in the marker target');
  assert.match(fs.readFileSync(path.join(scriptTmp, 'data', 'assessments.tsv'), 'utf8'), /Acme-Co/);
});

test('human-mode doctor billing assertions cannot create files in an ambient data root', t => {
  fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true });
  const external = fs.mkdtempSync(path.join(ROOT, 'work', 'suite-safety-'));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  fs.mkdirSync(path.join(external, 'data'));
  fs.writeFileSync(path.join(external, 'sentinel'), 'unchanged');
  const before = snapshot(external);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CAREER_OPS_') && key !== 'NODE_OPTIONS'));
  const result = spawnSync(NODE, [path.join(ROOT, 'tests', 'doctor-billing-source.test.mjs')], {
    cwd: ROOT, encoding: 'utf8', env: { ...env, CAREER_OPS_ROOT: external }, timeout: 60_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /❌/);
  assert.match(result.stdout, /CLAUDE_CODE_USE_BEDROCK=1 warns/);
  assert.match(result.stdout, /API key.*billing source/);
  assert.deepEqual(snapshot(external), before, 'doctor must not create pipeline or directories in ambient data');
});
