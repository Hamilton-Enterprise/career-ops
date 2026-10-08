import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchPlan } from "../../src/lib/search-plan.mjs";
import { readFileSync } from "node:fs";
import * as yaml from "js-yaml";
import { buildMarketPlan, classifyMarketLocation } from "../../src/lib/market-presets.mjs";
import { FREELANCE_SHORTCUTS } from "../../src/lib/freelance-presets.mjs";
import { OCCUPATION_CONCEPTS } from "../../src/lib/occupation-concepts.mjs";

const filters = { opportunityType: "employment", positive: ["Operador de Loja"], negative: ["manager"], allow: ["Lisboa"], block: ["Porto"], blockHard: ["USA"], alwaysAllow: [], sinceDays: 7, ats: ["workday"], markets: ["portugal"], limitPerAts: 150 };

test("precise preserves intent while adding only spelling/gender and same-city forms", () => {
  const original = structuredClone(filters);
  const plan = buildSearchPlan(filters, "precise");
  assert.equal(plan.effectiveFilters.sinceDays, 7);
  assert.equal(plan.effectiveFilters.positive[0], "Operador de Loja");
  for (const term of ["Operadora de Loja", "Operador/a de Loja", "Operador(a) de Loja"]) assert.ok(plan.effectiveFilters.positive.includes(term), term);
  assert.ok(!plan.effectiveFilters.positive.includes("Retail Assistant"));
  assert.deepEqual(plan.effectiveFilters.allow, ["Lisboa", "Lisbon", "Lisbonne", "Lissabon"]);
  assert.deepEqual(filters, original);
  for (const field of ["negative", "block", "blockHard", "alwaysAllow", "markets", "ats"]) assert.deepEqual(plan.effectiveFilters[field], original[field]);
  assert.deepEqual(plan.expansion.changes, []);
});

test("accented and slash-gender input can reach literal scanner spellings", () => {
  const plan = buildSearchPlan({ ...filters, positive: ["Técnico Auxiliar de Farmácia", "Operador/a de Loja"] }, "precise");
  assert.deepEqual(plan.effectiveFilters.positive.slice(0, 2), ["Técnico Auxiliar de Farmácia", "Operador/a de Loja"]);
  assert.ok(plan.effectiveFilters.positive.includes("Tecnico Auxiliar de Farmacia"));
  assert.ok(plan.effectiveFilters.positive.includes("Operador de Loja"));
  assert.ok(plan.effectiveFilters.positive.includes("Operadora de Loja"));
  assert.ok(!plan.effectiveFilters.positive.includes("Ajudante de Farmácia"));
});

test("broad adds occupation translations, explicit metro and 30 days with an exact receipt", () => {
  const precise = buildSearchPlan(filters, "precise");
  const broad = buildSearchPlan(filters, "broad");
  assert.equal(broad.effectiveFilters.sinceDays, 30);
  assert.ok(broad.effectiveFilters.positive.includes("Retail Assistant"));
  assert.ok(broad.effectiveFilters.positive.includes("Assistente de Loja"));
  assert.deepEqual(broad.occupationIds, ["retail-assistant"]);
  assert.deepEqual(broad.expansion.termsAdded, ["Assistente de Loja", "Retail Assistant", "Store Assistant", "Shop Assistant"]);
  assert.deepEqual(broad.expansion.locationsAdded, ["Alcochete", "Almada", "Amadora", "Barreiro", "Cascais", "Loures", "Mafra", "Moita", "Montijo", "Odivelas", "Oeiras", "Palmela", "Seixal", "Sesimbra", "Setúbal", "Sintra", "Vila Franca de Xira"]);
  assert.equal(broad.expansion.originalSinceDays, 7);
  assert.equal(broad.expansion.effectiveSinceDays, 30);
  assert.equal(broad.expansion.changes.length, 3);
  assert.deepEqual(broad.effectiveFilters.positive.filter(term => !precise.effectiveFilters.positive.includes(term)), broad.expansion.termsAdded);
  assert.equal(buildSearchPlan({ ...filters, sinceDays: 60 }, "broad").effectiveFilters.sinceDays, 60);
});

test("unknown terms remain literal; unchanged broad plans have an empty receipt", () => {
  const input = { ...filters, positive: ["Quantum gardener"], allow: ["Atlantis"], markets: [], sinceDays: 60 };
  const plan = buildSearchPlan(input, "broad");
  assert.deepEqual(plan.effectiveFilters, input);
  assert.deepEqual(plan.expansion.changes, []);
  assert.deepEqual(plan.expansion.termsAdded, []);
  assert.deepEqual(plan.expansion.locationsAdded, []);
  assert.deepEqual(plan.occupationIds, []);
});

test("only automatic additions are capped at 12, with originals first and exclusions intact", () => {
  const input = { ...filters, positive: ["Ajudante de Farmácia", "Sales Assistant", "Operador de Loja"], markets: ["europe"] };
  const precise = buildSearchPlan(input, "precise");
  const plan = buildSearchPlan(input, "broad");
  assert.deepEqual(plan.effectiveFilters.positive.slice(0, 3), ["Ajudante de Farmácia", "Sales Assistant", "Operador de Loja"]);
  assert.deepEqual(plan.effectiveFilters.positive.slice(0, precise.effectiveFilters.positive.length), precise.effectiveFilters.positive);
  assert.equal(plan.expansion.termsAdded.length, 12);
  assert.equal(plan.effectiveFilters.positive.length, precise.effectiveFilters.positive.length + 12);
  assert.ok(plan.expansion.termsOmitted.length > 0);
  assert.ok(plan.expansion.changes.includes(`Traduções não incluídas por limite: ${plan.expansion.termsOmitted.join(", ")}.`));
  assert.deepEqual(plan.effectiveFilters.negative, ["manager"]);
});

const PRESERVED_FIELDS = ["opportunityType", "negative", "block", "blockHard", "alwaysAllow", "markets"];

test("all 18 freelance shortcut terms survive both phases", () => {
  const positive = [...new Set(Object.values(FREELANCE_SHORTCUTS).flat())];
  assert.equal(positive.length, 18);
  const input = { ...filters, opportunityType: "freelance", positive, allow: [], markets: ["remote"] };
  const original = structuredClone(input);
  for (const phase of ["precise", "broad"]) {
    const plan = buildSearchPlan(input, phase);
    const missing = positive.filter(term => !plan.effectiveFilters.positive.includes(term));
    assert.deepEqual(missing, [], phase);
    for (const field of PRESERVED_FIELDS) assert.deepEqual(plan.effectiveFilters[field], original[field], `${phase} ${field}`);
  }
  assert.deepEqual(input, original);
});

test("all 37 template title_filter positives survive both phases", () => {
  const template = yaml.load(readFileSync(new URL("../../../templates/portals.example.yml", import.meta.url), "utf8"));
  const positive = template.title_filter.positive;
  assert.equal(positive.length, 37);
  const input = { ...filters, positive, markets: ["europe"] };
  for (const phase of ["precise", "broad"]) {
    const plan = buildSearchPlan(input, phase);
    assert.deepEqual(positive.filter(term => !plan.effectiveFilters.positive.includes(term)), [], phase);
    for (const field of PRESERVED_FIELDS) assert.deepEqual(plan.effectiveFilters[field], input[field], `${phase} ${field}`);
  }
});

test("broad additions cover every resolved occupation and report what the limit left out", () => {
  const input = { ...filters, positive: ["Técnico de Farmácia", "Assistente de Vendas", "Operador de Loja"], markets: ["spain", "netherlands"] };
  const plan = buildSearchPlan(input, "broad");
  for (const id of ["pharmacy-assistant", "sales-assistant", "retail-assistant"]) {
    const aliases = Object.values(OCCUPATION_CONCEPTS.find(concept => concept.id === id).aliases).flat();
    assert.ok(plan.expansion.termsAdded.some(term => aliases.includes(term)), id);
  }
  assert.ok(plan.expansion.termsAdded.length <= 12);
  assert.ok(plan.expansion.termsOmitted.length > 0);
  assert.ok(!plan.expansion.termsOmitted.some(term => plan.effectiveFilters.positive.includes(term)));
  assert.ok(plan.expansion.changes.some(change => change.startsWith("Traduções não incluídas por limite: ")));
  for (const field of PRESERVED_FIELDS) assert.deepEqual(plan.effectiveFilters[field], input[field], field);
  assert.deepEqual(buildSearchPlan(input, "precise").expansion.termsOmitted, []);
});

test("market classifier uses the same phase-aware geography as the temporary allow list", () => {
  for (const phase of ["precise", "broad"]) {
    const search = buildSearchPlan(filters, phase);
    const market = buildMarketPlan(filters.markets, search.effectiveFilters.positive, "employment", search);
    for (const city of ["Lisboa", "Lisbon", "Lisbonne"]) assert.equal(classifyMarketLocation({ location: city }, market).accepted, true, city);
    for (const city of ["Amadora", "Sintra", "Oeiras", "Cascais"]) assert.equal(classifyMarketLocation({ location: city }, market).accepted, phase === "broad", `${phase} ${city}`);
    for (const location of ["Lisbon, USA", "Lisbonne, France", "Amadora, Spain", "Sintra, ES", "Oeiras, Brazil", "Cascais, Canada"]) assert.equal(classifyMarketLocation({ location }, market).accepted, false, location);
  }
});
