import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMarketPlan } from "../../src/lib/market-presets.mjs";
import { mergeDiscoveredOffers, parseMarketReceipt } from "../../src/lib/core/market-merge.mjs";

const offer = { url: "https://jobs.acme.com/42", company: "Acme", title: "Engineer", location: "Lisboa", postedAt: "", ats: "landingjobs", source: "Landing.jobs" };
const receipt = (offers, errors = []) => JSON.stringify({ version: "careerops.scan.receipt@1", scanned: 2, skipped: 0, found: offers.length, filtered: 0, duplicates: 0, added: offers.length, added_urls: offers.map(o => o.url), offers, errors, unverified_zero: [], dry_run: true });

test("canonical URL merges origins in order and ATS fills empty fields", () => {
  const [merged] = mergeDiscoveredOffers([{ ...offer, url: offer.url + "?utm_source=ats", source: "greenhouse-full", ats: "greenhouse", location: "" }], [{ ...offer, postedAt: "2026-10-05", sources: ["Landing.jobs", "Remotive"] }]);
  assert.equal(merged.url, offer.url + "?utm_source=ats");
  assert.equal(merged.location, "Lisboa");
  assert.equal(merged.postedAt, "2026-10-05");
  assert.deepEqual(merged.sources, ["greenhouse-full", "Landing.jobs", "Remotive"]);
  assert.equal(mergeDiscoveredOffers([offer], [{ ...offer, url: "https://jobs.acme.com/43" }]).length, 2);
});

test("receipt normalizes date and salary, counts and rejects missing location", () => {
  const run = parseMarketReceipt(receipt([{ ...offer, postedAt: Date.UTC(2026, 9, 5), salary: { min: 42000, currency: "eur" } }, { ...offer, url: offer.url + "x", location: "" }]), 0, buildMarketPlan(["portugal"], []));
  assert.equal(run.valid, true);
  assert.equal(run.missingLocation, 1);
  assert.equal(run.offers.length, 1);
  assert.equal(run.offers[0].postedAt, "2026-10-05");
  assert.deepEqual(run.offers[0].salary, { min: 42000, currency: "EUR" });
});

test("exit 2 preserves valid offers and source errors", () => {
  const run = parseMarketReceipt(receipt([offer], [{ company: "getManfred (EN)", error: "timeout" }]), 2, buildMarketPlan(["portugal", "spain"], []));
  assert.equal(run.valid, true);
  assert.equal(run.status, "partial");
  assert.equal(run.offers.length, 1);
  assert.equal(run.sources.find(s => s.source === "getManfred (EN)").state, "error");
});

test("all selected sources failing is a failed run even with a valid envelope", () => {
  const run = parseMarketReceipt(receipt([], [{ company: "Landing.jobs", error: "offline" }]), 2, buildMarketPlan(["portugal"], []));
  assert.equal(run.valid, false);
  assert.equal(run.status, "failed");
});

test("malformed receipts and fatal exits cannot masquerade as valid empty searches", () => {
  for (const [text, code] of [["oops", 0], ["{}", 0], [receipt([]), 1], [JSON.stringify({ offers: [], errors: [] }), 0]]) {
    assert.equal(parseMarketReceipt(text, code, buildMarketPlan(["portugal"], [])).valid, false);
  }
  assert.equal(parseMarketReceipt(receipt([]), 0, buildMarketPlan(["portugal"], [])).valid, true);
});

test("remote provider receipt ids prove remote work without inventing worldwide eligibility", () => {
  const run = parseMarketReceipt(receipt([{ ...offer, source: "remoteok-api", location: "United States" }]), 0, buildMarketPlan(["remote"], []));
  assert.equal(run.offers.length, 1);
  assert.deepEqual(run.offers[0].sources, ["remoteok-api"]);
  assert.equal(run.offers[0].verification, "unconfirmed");
});

test("timeout and unexplained nonzero exits retain valid offers and mark sources incomplete", () => {
  const plan = buildMarketPlan(["portugal"], []);
  for (const [code, timedOut] of [[2, true], [2, false], [1, false], [null, true]]) {
    const run = parseMarketReceipt(receipt([offer]), code, plan, timedOut);
    assert.equal(run.offers.length, 1);
    assert.equal(run.valid, true);
    assert.equal(run.status, "partial");
    assert.deepEqual(run.sources.map(s => s.state), ["error", "skipped"]);
    assert.ok(run.sources[0].message);
  }
});

test("an empty receipt with only skipped providers is not a healthy empty search", () => {
  const skipped = JSON.stringify({ ...JSON.parse(receipt([])), scanned: 0, skipped: 1 });
  const run = parseMarketReceipt(skipped, 0, buildMarketPlan(["portugal"], []));
  assert.equal(run.offers.length, 0);
  assert.equal(run.valid, false);
  assert.equal(run.status, "failed");
  assert.deepEqual(run.sources.map(s => s.state), ["skipped", "skipped"]);
});

test("new country markets retain only matching offers in the scanner receipt", () => {
  const offers = [
    { ...offer, location: "Geneva, Switzerland" },
    { ...offer, url: `${offer.url}/wrong`, location: "Geneva, Belgium" },
  ];
  const run = parseMarketReceipt(receipt(offers), 0, buildMarketPlan(["switzerland"], []));
  assert.equal(run.offers.length, 1);
  assert.equal(run.offers[0].location, "Geneva, Switzerland");
});

test("mixed skipped providers never certify unidentified sources as complete", () => {
  const plan = buildMarketPlan(["europe"], ["Engineer"]);
  for (const offers of [[], [offer]]) {
    const mixed = JSON.stringify({ ...JSON.parse(receipt(offers)), scanned: 3, skipped: 1 });
    const run = parseMarketReceipt(mixed, 0, plan);
    assert.equal(run.valid, true);
    assert.equal(run.status, "partial");
    assert.deepEqual(run.sources.map(s => s.state), ["partial", "partial", "partial", "partial"]);
    assert.ok(run.sources.every(s => s.message));
    assert.equal(run.offers.length, offers.length);
  }
});
