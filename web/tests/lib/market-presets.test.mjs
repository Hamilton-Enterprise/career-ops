import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanMarkets, encodeMarkets, decodeMarkets, buildMarketPlan, classifyMarketLocation,
} from "../../src/lib/market-presets.mjs";
import { mergeDiscoveredOffers } from "../../src/lib/core/market-merge.mjs";

test("market codec defaults empty and drops unknown and duplicate selections", () => {
  assert.deepEqual(cleanMarkets(undefined), []);
  assert.deepEqual(decodeMarkets(null), []);
  assert.equal(encodeMarkets([]), "");
  assert.deepEqual(cleanMarkets([" PORTUGAL ", "spain", "Portugal", "greenhouse", 3]), ["portugal", "spain"]);
  assert.deepEqual(decodeMarkets("europe,remote,europe,invalid"), ["europe", "remote"]);
  assert.equal(encodeMarkets(["spain", "spain", "remote"]), "spain,remote");
});

test("empty markets select no boards or strict geography", () => {
  const plan = buildMarketPlan([], ["designer"]);
  assert.deepEqual(plan.jobBoards, []);
  assert.equal(plan.locationPolicy.strict, false);
  assert.deepEqual(classifyMarketLocation({ location: "" }, plan), { accepted: true });
});

test("Portugal uses Landing.jobs and Spain scans both Manfred languages", () => {
  assert.deepEqual(buildMarketPlan(["portugal"], []).jobBoards, [
    { name: "Landing.jobs", provider: "landingjobs", enabled: true },
  ]);
  assert.deepEqual(buildMarketPlan(["spain"], []).jobBoards, [
    { name: "getManfred (ES)", provider: "manfred", lang: "ES", enabled: true },
    { name: "getManfred (EN)", provider: "manfred", lang: "EN", enabled: true },
  ]);
});

test("Europe selects its four entries and narrows WTTJ to the supported countries", () => {
  const boards = buildMarketPlan(["europe"], ["designer"]).jobBoards;
  assert.deepEqual(boards.map((b) => [b.provider, b.lang ?? ""]), [
    ["landingjobs", ""], ["manfred", "ES"], ["manfred", "EN"], ["wttj", ""],
  ]);
  const filters = boards[3].wttj.filters;
  for (const country of ["FR", "NO", "IS", "LI", "GB", "CH"]) assert.ok(filters.split(" OR ").includes(`offices.country_code:${country}`));
  assert.equal(filters.includes("offices.country_code:US"), false);
  assert.ok(filters.length <= 1000, "provider rejects expressions longer than 1000 characters");
});

test("combined markets share boards without scanning the same board twice", () => {
  const plan = buildMarketPlan(["portugal", "spain", "europe"], [" Product Designer ", "product designer"]);
  assert.deepEqual(plan.jobBoards.map((b) => [b.provider, b.lang ?? ""]), [
    ["landingjobs", ""], ["manfred", "ES"], ["manfred", "EN"], ["wttj", ""],
  ]);
  assert.deepEqual(plan.jobBoards[3].wttj.queries, ["Product Designer"]);
  assert.equal(plan.locationPolicy.strict, true);
});

test("WTTJ uses supplied profile terms and skips when no real terms exist", () => {
  const suppliedProfileTerms = ["creative director"];
  assert.deepEqual(buildMarketPlan(["europe"], suppliedProfileTerms).jobBoards.find((b) => b.provider === "wttj").wttj.queries, ["creative director"]);
  const plan = buildMarketPlan(["europe"], []);
  assert.equal(plan.jobBoards.some((b) => b.provider === "wttj"), false);
  assert.deepEqual(plan.skippedSources, [{ source: "wttj", reason: "missing-search-terms" }]);
});

test("remote selects the seven existing remote feeds", () => {
  assert.deepEqual(buildMarketPlan(["remote"], []).jobBoards.map((b) => b.provider), [
    "remoteok", "remotive", "himalayas", "jobicy", "jobspresso", "workingnomads", "weworkremotely",
  ]);
});

test("PT and ES location matching uses whole words and recognized local cities", () => {
  for (const [market, accepted, rejected] of [
    ["portugal", ["Lisbon, PT", "Portugal", "Lisboa", "Porto"], ["Egypt", "Egyptian", "Portugality", "Porto Alegre, Brazil", "Remote"]],
    ["spain", ["Madrid, ES", "España", "Espanha", "Spain", "Barcelona"], ["United States", "Estonia", "Spanishville", "Remote"]],
  ]) {
    const plan = buildMarketPlan([market], []);
    for (const location of accepted) assert.equal(classifyMarketLocation({ location }, plan).accepted, true, location);
    for (const location of rejected) assert.deepEqual(classifyMarketLocation({ location }, plan), { accepted: false, reason: "outside-market" }, location);
  }
});

test("Europe accepts EU, EEA, UK and Switzerland, not unrestricted EMEA", () => {
  const plan = buildMarketPlan(["europe"], ["designer"]);
  for (const location of ["Berlin, DE", "France", "Malta", "Cyprus", "Norway", "Iceland", "Liechtenstein", "United Kingdom", "UK", "Switzerland", "CH", "EU", "EEA", "Europe", "Remote - Europe"]) {
    assert.equal(classifyMarketLocation({ location }, plan).accepted, true, location);
  }
  for (const location of ["USA", "Russia", "Turkey", "Morocco", "EMEA", "Remote", "United States", "Europeanized", "Working at home in USA"]) {
    assert.equal(classifyMarketLocation({ location }, plan).accepted, false, location);
  }
});

test("remote feed provenance proves remote work but leaves country eligibility unknown", () => {
  const plan = buildMarketPlan(["remote"], []);
  for (const offer of [
    { location: "United States", source: "Remotive" },
    { location: "Worldwide", ats: "remoteok" },
    { location: "Remote - US only", source: "greenhouse" },
  ]) {
    assert.deepEqual(classifyMarketLocation(offer, plan), { accepted: true, remote: true, eligibility: "unknown" });
  }
  assert.equal(classifyMarketLocation({ location: "Office in London", source: "greenhouse" }, plan).accepted, false);
  assert.equal(classifyMarketLocation({ location: "Remoteville", source: "wttj" }, plan).accepted, false);
});

test("missing or sentinel location fails closed even for remote sources", () => {
  for (const location of [undefined, "", "  ", "n/a", "Unknown", "—", "Not specified"]) {
    assert.deepEqual(classifyMarketLocation({ location, source: "Remotive" }, buildMarketPlan(["remote"], [])), { accepted: false, reason: "missing-location" });
  }
});

test("combined markets accept a match to any selected geographic policy", () => {
  const plan = buildMarketPlan(["portugal", "spain"], []);
  assert.equal(classifyMarketLocation({ location: "Madrid, Spain" }, plan).accepted, true);
  assert.equal(classifyMarketLocation({ location: "Lisbon, Portugal" }, plan).accepted, true);
  assert.equal(classifyMarketLocation({ location: "Paris, France" }, plan).accepted, false);
});

test("remote provider suffixes remain evidence of remote work in every origin field", () => {
  const plan = buildMarketPlan(["remote"], []);
  for (const field of ["source", "ats", "provider"]) {
    for (const origin of ["remotive-api", "remotive-full"]) {
      assert.deepEqual(classifyMarketLocation({ location: "Worldwide", [field]: origin }, plan),
        { accepted: true, remote: true, eligibility: "unknown" });
    }
  }
});

test("merged origins preserve remote evidence when the preferred URL belongs to ATS", () => {
  const ats = { url: "https://acme.com/42", company: "Acme", title: "Engineer", location: "Worldwide", postedAt: "", ats: "greenhouse", source: "greenhouse-full" };
  const [offer] = mergeDiscoveredOffers([ats], [{ ...ats, ats: "remotive-api", source: "remotive-api" }]);
  assert.equal(offer.source, "greenhouse-full");
  assert.deepEqual(offer.sources, ["greenhouse-full", "remotive-api"]);
  assert.deepEqual(classifyMarketLocation(offer, buildMarketPlan(["remote"], [])),
    { accepted: true, remote: true, eligibility: "unknown" });
});

test("non-remote origins with suffixes cannot admit a worldwide posting", () => {
  assert.deepEqual(classifyMarketLocation({ location: "Worldwide", source: "greenhouse-full", ats: "greenhouse-full", provider: "landingjobs-api", sources: ["wttj-api", "notremotive-api"] }, buildMarketPlan(["remote"], [])),
    { accepted: false, reason: "outside-market" });
});
