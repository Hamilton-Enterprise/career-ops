import { test } from "node:test";
import assert from "node:assert/strict";
import * as marketPresets from "../../src/lib/market-presets.mjs";
import { mergeDiscoveredOffers } from "../../src/lib/core/market-merge.mjs";
import { resolveLocationInputs } from "../../src/lib/location-concepts.mjs";
import { readFileSync } from "node:fs";
import * as yaml from "js-yaml";
import { buildSearchPlan } from "../../src/lib/search-plan.mjs";
import { matchesOccupationTerms } from "../../src/lib/occupation-match.mjs";
import { FREELANCE_SHORTCUTS } from "../../src/lib/freelance-presets.mjs";

const { cleanMarkets, encodeMarkets, decodeMarkets, buildMarketPlan, classifyMarketLocation } = marketPresets;

test("Portuguese retail and pharmacy concepts place Auchan before existing market boards", () => {
  for (const occupationId of ["retail-assistant", "sales-assistant", "pharmacy-assistant"]) {
    const plan = buildMarketPlan(["portugal"], ["Operador de Loja"], "employment", { occupationIds: [occupationId] });
    assert.deepEqual(plan.jobBoards, [
      { name: "Auchan Portugal", provider: "workday", enabled: true, careers_url: "https://auchanportugal.wd3.myworkdayjobs.com/auchan-retail" },
      { name: "Landing.jobs", provider: "landingjobs", enabled: true },
      { name: "Welcome to the Jungle", provider: "wttj", enabled: true, wttj: { queries: ["Operador de Loja"], filters: "offices.country_code:PT", max_hits: 300, timeout_ms: 5000 } },
    ]);
  }
});

test("directed sources collapse repeated markets and concepts while retaining all generic feeds", () => {
  const plan = buildMarketPlan(["portugal", "portugal", "spain", "europe", "remote"], ["Sales Assistant"], "employment", {
    occupationIds: ["retail-assistant", "retail-assistant", "sales-assistant", "pharmacy-assistant"],
  });
  assert.deepEqual(plan.jobBoards.map(board => [board.provider, board.lang ?? ""]), [
    ["workday", ""], ["landingjobs", ""], ["manfred", "ES"], ["manfred", "EN"],
    ["remoteok", ""], ["remotive", ""], ["himalayas", ""], ["jobicy", ""], ["jobspresso", ""], ["workingnomads", ""], ["weworkremotely", ""], ["wttj", ""],
  ]);
  assert.equal(plan.jobBoards.filter(board => board.careers_url?.includes("auchanportugal")).length, 1);
  assert.equal(plan.jobBoards.some(board => /primark/i.test(JSON.stringify(board))), false);
});

test("unrelated concepts, countries and freelance cannot select directed employers", () => {
  for (const markets of [[], ["spain"], ["united-kingdom"], ["switzerland"], ["luxembourg"], ["netherlands"], ["remote"], ["europe"]]) {
    assert.equal(buildMarketPlan(markets, ["Sales Assistant"], "employment", { occupationIds: ["retail-assistant"] }).jobBoards.some(board => board.provider === "workday"), false);
  }
  for (const occupationIds of [[], ["web-developer"], ["app-developer"], ["chatbot-developer"], ["ai-automation"], ["unknown"]]) {
    assert.equal(buildMarketPlan(["portugal"], ["Operador de Loja"], "employment", { occupationIds }).jobBoards.some(board => board.provider === "workday"), false);
  }
  assert.equal(buildMarketPlan(["portugal"], ["Sales Assistant"], "freelance", { occupationIds: ["retail-assistant"] }).jobBoards.some(board => board.provider === "workday"), false);
});

test("priority catalog accepts selectors only and returns independent reviewed boards", async () => {
  const catalog = await import("../../src/lib/priority-companies.mjs").catch(() => ({}));
  assert.equal(typeof catalog.priorityCompaniesFor, "function");
  const injectedUrl = "http://127.0.0.1/private";
  assert.deepEqual(catalog.priorityCompaniesFor([injectedUrl], ["retail-assistant"]), []);
  assert.deepEqual(catalog.priorityCompaniesFor(["portugal"], [injectedUrl, { careers_url: injectedUrl }]), []);
  const boards = catalog.priorityCompaniesFor(["portugal", "portugal"], ["retail-assistant", "pharmacy-assistant"]);
  assert.equal(boards.length, 1);
  boards[0].careers_url = injectedUrl;
  assert.equal(catalog.priorityCompaniesFor(["portugal"], ["retail-assistant"])[0].careers_url, "https://auchanportugal.wd3.myworkdayjobs.com/auchan-retail");
  const plan = buildMarketPlan(["portugal"], [injectedUrl], "employment", { occupationIds: ["retail-assistant"], priorityCompanies: [{ provider: "workday", careers_url: injectedUrl }] });
  assert.equal(plan.jobBoards[0].careers_url, "https://auchanportugal.wd3.myworkdayjobs.com/auchan-retail");
});

test("resolved city aliases and explicit metro terms reject even unknown foreign qualifiers", () => {
  for (const phase of ["precise", "broad"]) {
    const plan = buildMarketPlan(["portugal"], [], "employment", { locationResolution: resolveLocationInputs("Lisboa", phase), occupationIds: ["retail-assistant"] });
    for (const city of ["Lisbonne", "Lissabon"]) assert.equal(classifyMarketLocation({ location: city }, plan).accepted, true);
    for (const city of ["Amadora", "Oeiras", "Sintra", "Cascais"]) assert.equal(classifyMarketLocation({ location: city }, plan).accepted, phase === "broad");
    for (const location of ["Lisbonne, Angola", "Lissabon, ZA", "Amadora, Argentina", "Sintra, XX"]) assert.equal(classifyMarketLocation({ location }, plan).accepted, false, location);
  }
});

test("alternative markets cannot override a resolved city or metro country conflict", () => {
  for (const markets of [["europe"], ["portugal", "spain"], ["united-kingdom", "remote"]]) {
    for (const phase of ["precise", "broad"]) {
      const plan = buildMarketPlan(markets, [], "employment", { locationResolution: resolveLocationInputs("Lisboa", phase) });
      for (const location of ["Lisbonne, France", "Lisbon, UK", "Lisboa, Spain", "Lisbon, UK; Madrid, Spain"]) {
        assert.deepEqual(classifyMarketLocation({ location, source: "remotive-api" }, plan), { accepted: false, reason: "outside-market" }, `${markets} ${phase} ${location}`);
      }
      if (phase === "broad") {
        for (const location of ["Amadora, Spain", "Sintra, France", "Oeiras, UK", "Cascais, ES"]) {
          assert.equal(classifyMarketLocation({ location }, plan).accepted, false, `${markets} ${location}`);
        }
      }
    }
  }
  for (const markets of [["europe"], ["portugal", "spain"]]) {
    const plan = buildMarketPlan(markets, [], "employment", { locationResolution: resolveLocationInputs("Lisboa", "broad") });
    for (const location of ["Lisbonne, Portugal", "Lisbon, PT", "Amadora, Portugal", "Sintra, PT", "Lisbon Hybrid, Portugal", "Lisboa, Portugal; Madrid, Spain"]) {
      assert.equal(classifyMarketLocation({ location }, plan).accepted, true, location);
    }
    // A city-resolution guard must not change literal market-only selection.
    const literal = buildMarketPlan(markets, []);
    assert.equal(classifyMarketLocation({ location: "Amadora, Spain" }, literal).accepted, true);
    assert.equal(classifyMarketLocation({ location: "Madrid, Spain" }, plan).accepted, true);
  }
  assert.equal(classifyMarketLocation({ location: "Lisbonne, France" }, buildMarketPlan(["europe"], [])).accepted, true);
});

test("market codec defaults empty and drops unknown and duplicate selections", () => {
  assert.deepEqual(cleanMarkets(undefined), []);
  assert.deepEqual(decodeMarkets(null), []);
  assert.equal(encodeMarkets([]), "");
  assert.deepEqual(cleanMarkets([" PORTUGAL ", "spain", "Portugal", "greenhouse", 3]), ["portugal", "spain"]);
  assert.deepEqual(decodeMarkets("europe,remote,europe,invalid"), ["europe", "remote"]);
  assert.equal(encodeMarkets(["spain", "spain", "remote"]), "spain,remote");
  assert.deepEqual(cleanMarkets(["united-kingdom", "switzerland", "luxembourg", "netherlands"]), [
    "united-kingdom", "switzerland", "luxembourg", "netherlands",
  ]);
});

test("empty markets select no boards or strict geography", () => {
  const plan = buildMarketPlan([], ["designer"]);
  assert.deepEqual(plan.jobBoards, []);
  assert.equal(plan.locationPolicy.strict, false);
  assert.deepEqual(classifyMarketLocation({ location: "" }, plan), { accepted: true });
});

test("freelance uses one WTTJ plan with contract filters and no invented geography", () => {
  const plan = buildMarketPlan([], ["web designer"], "freelance");
  assert.equal(plan.opportunityType, "freelance");
  assert.equal(plan.locationPolicy.strict, false);
  assert.deepEqual(plan.jobBoards, [{
    name: "Welcome to the Jungle",
    provider: "wttj",
    enabled: true,
    wttj: { queries: ["web designer"], filters: "contract_type:freelance" },
  }]);
});

test("freelance combines countries and full remote in one deduplicated WTTJ filter", () => {
  const plan = buildMarketPlan(["portugal", "spain", "europe", "remote"], ["automation"], "freelance");
  assert.equal(plan.jobBoards.length, 1);
  assert.equal(plan.jobBoards[0].provider, "wttj");
  assert.equal(plan.jobBoards[0].wttj.queries[0], "automation");
  assert.match(plan.jobBoards[0].wttj.filters, /^contract_type:freelance AND \(.+\)$/);
  for (const facet of ["offices.country_code:PT", "offices.country_code:ES", "offices.country_code:FR", "offices.country_code:GB", "remote:fulltime"]) {
    assert.equal(plan.jobBoards[0].wttj.filters.split(/\(|\)| OR /).includes(facet), true, facet);
  }
  assert.equal((plan.jobBoards[0].wttj.filters.match(/offices\.country_code:PT/g) ?? []).length, 1);
});

test("freelance remote-only plans do not add country geography", () => {
  const plan = buildMarketPlan(["remote"], [], "freelance");
  assert.equal(plan.jobBoards[0].wttj.filters, "contract_type:freelance AND remote:fulltime");
  assert.deepEqual(plan.jobBoards[0].wttj.queries, []);
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
  assert.deepEqual(filters.split(" OR "), [
    "offices.country_code:AT", "offices.country_code:BE", "offices.country_code:BG", "offices.country_code:HR",
    "offices.country_code:CY", "offices.country_code:CZ", "offices.country_code:DK", "offices.country_code:EE",
    "offices.country_code:FI", "offices.country_code:FR", "offices.country_code:DE", "offices.country_code:GR",
    "offices.country_code:HU", "offices.country_code:IE", "offices.country_code:IT", "offices.country_code:LV",
    "offices.country_code:LT", "offices.country_code:LU", "offices.country_code:MT", "offices.country_code:NL",
    "offices.country_code:PL", "offices.country_code:PT", "offices.country_code:RO", "offices.country_code:SK",
    "offices.country_code:SI", "offices.country_code:ES", "offices.country_code:SE", "offices.country_code:IS",
    "offices.country_code:LI", "offices.country_code:NO", "offices.country_code:GB", "offices.country_code:CH",
  ]);
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

const templatePositives = yaml.load(readFileSync(new URL("../../../templates/portals.example.yml", import.meta.url), "utf8")).title_filter.positive;
const searchFilters = { opportunityType: "employment", negative: [], allow: [], block: [], blockHard: [], alwaysAllow: [], sinceDays: 7, ats: [], limitPerAts: 150 };
const wttjOf = plan => plan.jobBoards.find(board => board.provider === "wttj").wttj;

test("WTTJ sends at most 12 queries, originals first, and reports the rest while titles keep every term", () => {
  assert.equal(templatePositives.length, 37);
  for (const phase of ["precise", "broad"]) {
    const search = buildSearchPlan({ ...searchFilters, positive: templatePositives, markets: ["europe"] }, phase);
    const plan = buildMarketPlan(["europe"], search.effectiveFilters.positive, "employment", search);
    assert.deepEqual(wttjOf(plan).queries, templatePositives.slice(0, 12), phase);
    const [skipped, ...rest] = plan.skippedSources;
    assert.deepEqual(rest, []);
    assert.equal(skipped.source, "wttj");
    assert.equal(skipped.reason, "query-limit");
    assert.deepEqual(skipped.omitted.slice(0, 25), templatePositives.slice(12), phase);
    assert.ok(!skipped.omitted.includes("Kunstliche Intelligenz"), "accent-folded twin of an original is not a separate query");
    assert.deepEqual(templatePositives.filter(term => !search.effectiveFilters.positive.includes(term)), []);
    assert.equal(matchesOccupationTerms("Hyperautomation Lead", search.effectiveFilters.positive), true);
  }
});

test("freelance WTTJ queries keep 12 of the 18 shortcut terms and report the other 6", () => {
  const positive = [...new Set(Object.values(FREELANCE_SHORTCUTS).flat())];
  const search = buildSearchPlan({ ...searchFilters, opportunityType: "freelance", positive, markets: ["remote"] }, "precise");
  const plan = buildMarketPlan(["remote"], search.effectiveFilters.positive, "freelance", search);
  assert.deepEqual(wttjOf(plan).queries, positive.slice(0, 12));
  assert.deepEqual(plan.skippedSources, [{ source: "wttj", reason: "query-limit", omitted: positive.slice(12) }]);
  assert.equal(matchesOccupationTerms("Senior n8n builder", search.effectiveFilters.positive), true);
});

test("12 or fewer distinct queries need no query-limit entry and drop folded spelling twins", () => {
  const search = buildSearchPlan({ ...searchFilters, positive: ["Técnico Auxiliar de Farmácia", "Operador/a de Loja"], markets: ["portugal"] }, "broad");
  const plan = buildMarketPlan(["portugal"], search.effectiveFilters.positive, "employment", search);
  const { queries } = wttjOf(plan);
  assert.deepEqual(queries.slice(0, 2), ["Técnico Auxiliar de Farmácia", "Operador/a de Loja"]);
  for (const twin of ["Tecnico Auxiliar de Farmacia", "Operador de Loja", "Operador(a) de Loja"]) assert.ok(!queries.includes(twin), twin);
  assert.ok(queries.includes("Pharmacy Assistant"));
  assert.ok(queries.length <= 12);
  assert.deepEqual(plan.skippedSources, []);
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

test("WTTJ is added once for every selected country and combines country filters", () => {
  const countries = ["portugal", "spain", "united-kingdom", "switzerland", "luxembourg", "netherlands"];
  const plan = buildMarketPlan(countries, ["designer"]);
  const wttj = plan.jobBoards.filter((board) => board.provider === "wttj");
  assert.equal(wttj.length, 1);
  assert.deepEqual(wttj[0].wttj.queries, ["designer"]);
  for (const code of ["PT", "ES", "GB", "CH", "LU", "NL"]) {
    assert.ok(wttj[0].wttj.filters.split(" OR ").includes(`offices.country_code:${code}`));
  }
  assert.deepEqual(plan.jobBoards.map((board) => board.provider), ["landingjobs", "manfred", "manfred", "wttj"]);
});

test("each added market accepts country names, codes and local cities but rejects collisions", () => {
  const cases = [
    ["united-kingdom", ["United Kingdom", "UK", "GB", "London", "Edinburgh", "Belfast, Northern Ireland"], ["London, Canada", "Manchester, United States", "London, Italy", "London, FR", "London, DE", "United Kingdom, Wisconsin"]],
    ["switzerland", ["Switzerland", "CH", "Zürich", "Geneva"], ["Geneva, Belgium", "Basel, Germany", "Zurich, Austria", "Switzerland, South Carolina"]],
    ["luxembourg", ["Luxembourg", "LU", "Luxembourg City", "Esch-sur-Alzette"], ["Luxembourg, Wisconsin", "Esch-sur-Alzette, Belgium", "LUXembourgish"]],
    ["netherlands", ["Netherlands", "NL", "Amsterdam", "Rotterdam", "The Hague"], ["Amsterdam, New York", "Rotterdam, Texas", "Netherlandish"]],
  ];
  for (const [market, accepted, rejected] of cases) {
    const plan = buildMarketPlan([market], []);
    for (const location of accepted) assert.equal(classifyMarketLocation({ location }, plan).accepted, true, `${market}: ${location}`);
    for (const location of rejected) assert.deepEqual(classifyMarketLocation({ location }, plan), { accepted: false, reason: "outside-market" }, `${market}: ${location}`);
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
    { location: "Worldwide", source: "Remotive" },
    { location: "Worldwide", ats: "remoteok" },
    { location: "Remote - Europe", source: "greenhouse" },
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
  assert.equal(classifyMarketLocation({ location: "Lisbon, Portugal; Madrid, Spain" }, plan).accepted, true);
  assert.equal(classifyMarketLocation({ location: "Paris, France" }, plan).accepted, false);
});

test("Portuguese cities keep trailing work-mode qualifiers", () => {
  const plan = buildMarketPlan(["portugal"], []);
  for (const location of ["Lisbon Remote", "Lisbon Hybrid"]) {
    assert.equal(classifyMarketLocation({ location }, plan).accepted, true, location);
  }
});

test("market inference chooses Portugal only when every requested location is unambiguously Portuguese", () => {
  assert.equal(typeof marketPresets.inferMarketsFromLocations, "function");
  for (const locations of [["Portugal"], ["Lisboa"], ["Porto"], ["Lisbon Remote"], ["Lisboa", "Porto"]]) {
    assert.deepEqual(marketPresets.inferMarketsFromLocations([], locations), ["portugal"], locations.join(" | "));
  }
  assert.deepEqual(marketPresets.inferMarketsFromLocations([], ["Lisboa", "Madrid"]), []);
  assert.deepEqual(marketPresets.inferMarketsFromLocations([], ["Lisbon, Portugal; Madrid, Spain"]), []);
  assert.deepEqual(marketPresets.inferMarketsFromLocations(["spain"], ["Lisboa"]), ["spain"]);
});

test("market inference rejects Portuguese cities followed by foreign or unknown country qualifiers", () => {
  for (const location of ["Lisboa, ZA", "Lisboa, Angola", "Lisboa, XX"]) {
    assert.deepEqual(marketPresets.inferMarketsFromLocations([], [location]), [], location);
  }
  for (const location of ["Lisboa", "Lisbon Remote", "Lisboa Portugal", "Lisbon PT"]) {
    assert.deepEqual(marketPresets.inferMarketsFromLocations([], [location]), ["portugal"], location);
  }
  assert.deepEqual(marketPresets.inferMarketsFromLocations([], ["Lisboa", "Porto"]), ["portugal"]);
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

const SIX_MARKETS = ["portugal", "spain", "united-kingdom", "switzerland", "luxembourg", "netherlands"];

test("country-only selection accepts every catalog alias, including native-language names", async () => {
  const { countryAliases } = await import("../../src/lib/location-concepts.mjs");
  assert.equal(typeof countryAliases, "function");
  for (const market of SIX_MARKETS) {
    const plan = buildMarketPlan([market], ["x"]);
    const aliases = countryAliases(market);
    assert.ok(aliases.length >= 2, market);
    for (const location of aliases) assert.equal(classifyMarketLocation({ location }, plan).accepted, true, `${market}: ${location}`);
  }
  for (const [market, location] of [
    ["portugal", "Portugal"], ["spain", "España"], ["spain", "Espanha"], ["united-kingdom", "Reino Unido"],
    ["switzerland", "Schweiz"], ["switzerland", "Suisse"], ["switzerland", "Svizzera"], ["luxembourg", "Luxemburg"],
    ["netherlands", "Nederland"], ["netherlands", "Holanda"],
  ]) assert.deepEqual(classifyMarketLocation({ location }, buildMarketPlan([market], ["x"])), { accepted: true }, `${market}: ${location}`);
});

test("target cities and countries stay accepted with their own qualifiers", () => {
  for (const [market, locations] of [
    ["portugal", ["Lisboa", "Lisbon, Portugal", "Lisboa, PT", "Porto"]],
    ["spain", ["Madrid, Spain", "Madrid, ES", "Valencia, España"]],
    ["united-kingdom", ["London, UK", "London, GB", "Birmingham", "Manchester, England"]],
    ["switzerland", ["Zürich, Schweiz", "Genève, Suisse", "Lugano, Svizzera", "Zurich, CH"]],
    ["luxembourg", ["Luxembourg City, Luxembourg", "Esch-sur-Alzette, LU"]],
    ["netherlands", ["Utrecht, Nederland", "Amsterdam, NL", "Rotterdam, Holanda"]],
  ]) {
    const plan = buildMarketPlan([market], ["x"]);
    for (const location of locations) assert.deepEqual(classifyMarketLocation({ location }, plan), { accepted: true }, `${market}: ${location}`);
  }
});

test("homonym cities with a foreign state, province or country qualifier are rejected", () => {
  for (const [market, locations] of [
    ["portugal", ["Lisboa, México", "Porto, Brasil", "Lisbon, Maine", "Lisbon, OH", "Lisboa, Estados Unidos", "Braga, Brazil"]],
    ["spain", ["Valencia, Venezuela", "Barcelona, Venezuela", "Madrid, Iowa", "Valencia, FL", "Sevilla, Colombia", "Madrid, Nuevo México"]],
    ["united-kingdom", ["London, Ontario", "Birmingham, Alabama", "Birmingham, AL", "Manchester, New Hampshire", "London, KY", "London, ON", "London, États-Unis"]],
    ["switzerland", ["Geneva, Illinois", "Geneva, NY", "Lucerne, California", "Zürich, Kanada"]],
    ["luxembourg", ["Luxemburg, Wisconsin", "Luxembourg, WI", "Luxemburg, Iowa"]],
    ["netherlands", ["Amsterdam, NY", "Rotterdam, New York", "Groningen, Suriname", "Amsterdam, Verenigde Staten"]],
  ]) {
    const plan = buildMarketPlan([market], ["x"]);
    for (const location of locations) assert.deepEqual(classifyMarketLocation({ location }, plan), { accepted: false, reason: "outside-market" }, `${market}: ${location}`);
  }
});

test("two-letter state codes count only as an uppercase comma part after a city", () => {
  const plan = buildMarketPlan(["united-kingdom"], ["x"]);
  assert.equal(classifyMarketLocation({ location: "Birmingham, AL" }, plan).accepted, false);
  assert.equal(classifyMarketLocation({ location: "Birmingham, al" }, plan).accepted, true);
  assert.equal(classifyMarketLocation({ location: "Egypt" }, buildMarketPlan(["portugal"], ["x"])).accepted, false);
});

test("unknown non-place qualifiers keep the literal and resolved-city behaviour", () => {
  // Literal market selection: an unknown neighbourhood next to a target city is accepted.
  assert.equal(classifyMarketLocation({ location: "London, Shoreditch" }, buildMarketPlan(["united-kingdom"], ["x"])).accepted, true);
  assert.equal(classifyMarketLocation({ location: "Lisboa, Alfama" }, buildMarketPlan(["portugal"], ["x"])).accepted, true);
  // A resolved city still fails closed on any unknown qualifier.
  const resolved = buildMarketPlan(["portugal"], ["x"], "employment", { locationResolution: resolveLocationInputs("Lisboa", "precise") });
  assert.equal(classifyMarketLocation({ location: "Lisboa, Alfama" }, resolved).accepted, false);
});

test("multi-location strings accept any unambiguous selected group and reject all-foreign groups", () => {
  const uk = buildMarketPlan(["united-kingdom"], ["x"]);
  assert.equal(classifyMarketLocation({ location: "London, UK; New York, NY" }, uk).accepted, true);
  assert.equal(classifyMarketLocation({ location: "New York, NY | London" }, uk).accepted, true);
  assert.equal(classifyMarketLocation({ location: "London, Ontario; Birmingham, AL" }, uk).accepted, false);
  assert.equal(classifyMarketLocation({ location: "Toronto, ON | London, Ontario" }, uk).accepted, false);
  const pt = buildMarketPlan(["portugal"], ["x"]);
  assert.equal(classifyMarketLocation({ location: "Lisboa / Madrid" }, pt).accepted, true);
  assert.equal(classifyMarketLocation({ location: "São Paulo, Brasil / Lisboa" }, pt).accepted, true);
  assert.equal(classifyMarketLocation({ location: "Porto, Brasil / Lisboa, México" }, pt).accepted, false);
});

test("remote selection rejects a published national restriction outside the selected markets", () => {
  const remote = buildMarketPlan(["remote"], ["x"]);
  for (const offer of [
    { location: "Remote - US only" }, { location: "Remote (USA)" }, { location: "Remote, Canada" },
    { location: "Remote (UK)" }, { location: "Remote - United States" },
    { location: "United States", source: "Remotive" }, { location: "Remote - US only", source: "greenhouse" },
  ]) assert.deepEqual(classifyMarketLocation(offer, remote), { accepted: false, reason: "outside-market" }, offer.location);
  for (const location of ["Remote", "Remote - Europe", "Remoto"]) {
    assert.deepEqual(classifyMarketLocation({ location }, remote), { accepted: true, remote: true, eligibility: "unknown" }, location);
  }
  for (const markets of [["remote", "portugal"], ["portugal", "remote"]]) {
    const plan = buildMarketPlan(markets, ["x"]);
    assert.equal(classifyMarketLocation({ location: "Remote, Portugal" }, plan).accepted, true, `${markets}`);
    assert.equal(classifyMarketLocation({ location: "Remote - US only" }, plan).accepted, false, `${markets}`);
  }
  assert.equal(classifyMarketLocation({ location: "Remote (UK)" }, buildMarketPlan(["remote", "united-kingdom"], ["x"])).accepted, true);
  assert.equal(classifyMarketLocation({ location: "Remote, Germany" }, buildMarketPlan(["remote", "europe"], ["x"])).accepted, true);
});

test("a market's own ISO 3166-2 subdivision codes are not foreign qualifiers", () => {
  for (const [market, accepted, rejected] of [
    ["netherlands", ["Amsterdam, NH", "Utrecht, UT", "Groningen, GR", "Maastricht, LI", "Eindhoven, NB", "Utrecht, NL"], ["Amsterdam, NY", "Amsterdam, MA", "Rotterdam, TX"]],
    ["spain", ["Málaga, MA", "Valencia, VA", "Sevilla, SE", "Valencia, V", "Madrid, MD"], ["Valencia, FL", "Madrid, IA", "Barcelona, NH"]],
    ["switzerland", ["Bern, BE", "Neuchâtel, NE", "Appenzell, AR", "Lucerne, LU", "Geneva, GE", "Zurich, ZH"], ["Geneva, IL", "Bern, NC", "Zurich, AT", "Bern, NH"]],
    ["united-kingdom", ["London, UK", "London, GB"], ["Birmingham, AL", "London, ON", "Manchester, NH", "London, BE"]],
  ]) {
    const plan = buildMarketPlan([market], ["x"]);
    for (const location of accepted) assert.deepEqual(classifyMarketLocation({ location }, plan), { accepted: true }, `${market}: ${location}`);
    for (const location of rejected) assert.deepEqual(classifyMarketLocation({ location }, plan), { accepted: false, reason: "outside-market" }, `${market}: ${location}`);
  }
});

test("the country-filtered WTTJ board reads up to 300 hits per query within the scan deadline", () => {
  for (const markets of [["portugal"], ["europe"], ["spain", "france"]]) {
    const wttj = buildMarketPlan(markets, ["Engineer"]).jobBoards.find(board => board.provider === "wttj").wttj;
    assert.equal(wttj.max_hits, 300, markets.join(","));
    assert.equal(wttj.timeout_ms, 5000, markets.join(","));
    assert.match(wttj.filters, /offices\.country_code:/);
  }
});
