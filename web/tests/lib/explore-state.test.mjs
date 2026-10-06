import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDiscoveryState, applyDiscoveryOfferEvent, updateDiscoverySources, canDiscover, offerProvenance } from '../../src/lib/explore-state.mjs';

test('completed sources distinguish results from a healthy empty search', () => {
  const sources = { greenhouse: { state: 'ok' }, 'Landing.jobs': { state: 'ok' } };
  assert.equal(summarizeDiscoveryState(sources, 2), 'complete');
  assert.equal(summarizeDiscoveryState(sources, 0), 'zero-healthy-results');
});

test('failed, skipped and unfinished sources prevent a complete result', () => {
  for (const state of ['error', 'skipped', 'active', 'queued', 'partial']) {
    assert.equal(summarizeDiscoveryState({ greenhouse: { state: 'ok' }, Remotive: { state } }, 1), 'partial');
    assert.equal(summarizeDiscoveryState({ greenhouse: { state: 'ok' }, Remotive: { state } }, 0), 'partial');
  }
});

test('all failed sources are not success even when provisional offers survive', () => {
  const sources = { RemoteOK: { state: 'error' }, Remotive: { state: 'skipped' } };
  assert.equal(summarizeDiscoveryState(sources, 0), 'all-failed');
  assert.equal(summarizeDiscoveryState(sources, 2), 'all-failed');
  assert.equal(summarizeDiscoveryState({}, 0), 'all-failed');
});

test('terminal offers replace provisional duplicates with merged fields and origins', () => {
  const first = { url: 'https://example.test/job', company: 'Acme', title: 'Designer', location: '', postedAt: '', ats: 'greenhouse', source: 'greenhouse-full' };
  let offers = applyDiscoveryOfferEvent([], { kind: 'offer', offer: first });
  offers = applyDiscoveryOfferEvent(offers, { kind: 'offer', offer: { ...first, source: 'landingjobs-api' } });
  const final = { ...first, location: 'Lisboa', sources: ['greenhouse-full', 'landingjobs-api'] };
  assert.deepEqual(applyDiscoveryOfferEvent(offers, { kind: 'done', offers: [final], count: 1 }), [final]);
  assert.deepEqual(applyDiscoveryOfferEvent(offers, { kind: 'done', offers: [], count: 0 }), []);
});

test('generic source events and authoritative summary retain failures and partial ATS coverage', () => {
  let sources = updateDiscoverySources({}, { kind: 'sourceStart', source: 'Remotive' });
  assert.equal(sources.Remotive.state, 'active');
  sources = updateDiscoverySources(sources, { kind: 'sourceError', source: 'Remotive', message: 'Prazo excedido' });
  assert.equal(sources.Remotive.state, 'error');
  sources = updateDiscoverySources(sources, { kind: 'atsDone', ats: 'greenhouse', unreachable: 3 });
  sources = updateDiscoverySources(sources, { kind: 'sourceDone', source: 'greenhouse', count: 2 });
  assert.equal(sources.greenhouse.state, 'partial');
  sources = updateDiscoverySources(sources, { kind: 'summary', companiesScanned: 2, unreachable: 3, matches: 2, status: 'partial', sources: [{ source: 'greenhouse', state: 'ok' }, { source: 'Remotive', state: 'error', message: 'Prazo excedido' }] });
  assert.equal(summarizeDiscoveryState(sources, 2), 'partial');
  assert.equal(sources.Remotive.message, 'Prazo excedido');
});

test('market-only and ATS-only selection can start a search', () => {
  assert.equal(canDiscover({ ats: [], markets: ['portugal'] }), true);
  assert.equal(canDiscover({ ats: ['greenhouse'], markets: [] }), true);
  assert.equal(canDiscover({ ats: [], markets: [] }), false);
});

test('the terminal event never certifies unfinished sources', () => {
  const sources = updateDiscoverySources({ RemoteOK: { state: 'active' }, Remotive: { state: 'queued' }, greenhouse: { state: 'ok' } }, { kind: 'done', offers: [], count: 0 });
  assert.equal(sources.RemoteOK.state, 'error');
  assert.equal(sources.Remotive.state, 'error');
  assert.equal(sources.greenhouse.state, 'ok');
  assert.equal(summarizeDiscoveryState(sources, 0), 'partial');
});

test('origins are readable and unique and remote eligibility remains unknown', () => {
  assert.deepEqual(offerProvenance({ source: 'greenhouse-full', sources: ['Greenhouse', 'landingjobs-api'], ats: 'greenhouse', location: 'Lisboa' }), { origins: ['Greenhouse', 'Landing.jobs'], eligibilityUnknown: false });
  assert.deepEqual(offerProvenance({ source: 'remotive-api', sources: ['remotive-api', 'Remotive'], location: 'Remote' }), { origins: ['Remotive'], eligibilityUnknown: true });
});
