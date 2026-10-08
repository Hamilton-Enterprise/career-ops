import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../helpers/web-ts-alias-loader.mjs';

const { runDiscovery } = await import('@/lib/core/scan');
const base = { opportunityType: 'employment', positive: [], negative: [], allow: [], block: [], blockHard: [], alwaysAllow: [], sinceDays: 7, ats: ['greenhouse'], markets: [], limitPerAts: 150 };

function scannerFixture(t, jobs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'search-eligibility-'));
  const previous = { CAREER_OPS_ROOT: process.env.CAREER_OPS_ROOT, CAREER_OPS_CODE_ROOT: process.env.CAREER_OPS_CODE_ROOT };
  Object.assign(process.env, { CAREER_OPS_ROOT: root, CAREER_OPS_CODE_ROOT: root });
  fs.mkdirSync(path.join(root, 'data/cache/ats-companies'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data/cache/ats-companies/greenhouse.json'), '["acme"]');
  const scanner = new URL('../../../scan-ats-full.mjs', import.meta.url);
  fs.writeFileSync(path.join(root, 'scan-ats-full.mjs'), `// --json capHit
    import greenhouse from ${JSON.stringify(new URL('../../../providers/greenhouse.mjs', import.meta.url).href)};
    greenhouse.fetch = async () => ${JSON.stringify(jobs)}.map(job => ({ company:'Acme', location:'London, UK', postedAt:Date.now(), ...job }));
    globalThis.fetch = () => { throw new Error('Network forbidden in fixture'); };
    process.argv[1] = ${JSON.stringify(scanner.pathname)};
    await import(${JSON.stringify(scanner.href)});`);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
    fs.rmSync(root, { recursive: true, force: true });
  });
}

test('actual ATS scanner/core rejects Presales Assistant and retains boundary-matched requested roles', async t => {
  scannerFixture(t, ['Presales Assistant', 'Sales Assistant'].map((title, index) => ({ title, url: `https://acme.test/jobs/${index}` })));
  const events = [];
  const offers = await runDiscovery({ ...base, positive: ['Sales Assistant'] }, event => events.push(event));
  assert.deepEqual(offers.map(offer => offer.title), ['Sales Assistant']);
  assert.ok(offers.every(offer => offer.match.components.role > 0));
  assert.deepEqual(events.filter(event => event.kind === 'offer').map(event => event.offer.title), ['Sales Assistant']);
});

test('unknown and ambiguous literal occupations remain eligible without catalog aliases', async t => {
  scannerFixture(t, ['Senior Quantum Mechanic', 'Quantum Mechanics', 'Developer'].map((title, index) => ({ title, url: `https://acme.test/jobs/${index}` })));
  assert.deepEqual((await runDiscovery({ ...base, positive: ['Quantum Mechanic'] }, () => {})).map(offer => offer.title), ['Senior Quantum Mechanic']);
  assert.deepEqual((await runDiscovery({ ...base, positive: ['Developer'] }, () => {})).map(offer => offer.title), ['Developer']);
});

test('occupation aliases enter only after the healthy precise zero broadens', async t => {
  scannerFixture(t, [{ title: 'Sales Assistant', url: 'https://acme.test/jobs/1' }]);
  const events = [];
  const offers = await runDiscovery({ ...base, positive: ['Assistente de Vendas'] }, event => events.push(event));
  assert.deepEqual(events.filter(event => event.kind === 'phaseStart').map(event => event.phase), ['precise', 'broad']);
  assert.deepEqual(offers.map(offer => offer.title), ['Sales Assistant']);
});

test('ATS-only resolved London rejects Ontario without selecting a market', async t => {
  scannerFixture(t, ['London, UK', 'London, Ontario, Canada', 'Moonbase Seven'].map((location, index) => ({ location, title:'Sales Assistant', url:`https://acme.test/jobs/${index}` })));
  const events = [];
  const offers = await runDiscovery({ ...base, positive:['Sales Assistant'], allow:['London'] }, event => events.push(event));
  assert.deepEqual(offers.map(offer => offer.location), ['London, UK']);
  assert.deepEqual(events.filter(event => event.kind === 'offer').map(event => event.offer.location), ['London, UK']);
  assert.deepEqual((await runDiscovery({ ...base, positive:['Sales Assistant'], allow:['Moonbase Seven'] }, () => {})).map(offer => offer.location), ['Moonbase Seven']);
  assert.equal((await runDiscovery({ ...base, positive:['Sales Assistant'] }, () => {})).length, 3, 'no location selection remains permissive');
  assert.deepEqual(base.markets, []);
});
