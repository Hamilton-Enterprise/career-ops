import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FILTERS, filtersToParams, paramsToFilters, parseExplorePatch } from "../../src/lib/explore.ts";

const freelancePresets = await import("../../src/lib/freelance-presets.mjs").catch(() => ({}));

test("employment remains the default and freelance survives the shared URL codec", () => {
  assert.equal(DEFAULT_FILTERS.opportunityType, "employment");
  assert.equal(paramsToFilters(new URLSearchParams()).opportunityType, "employment");
  assert.equal(filtersToParams(DEFAULT_FILTERS).includes("opportunity="), false);

  const freelance = parseExplorePatch({ opportunityType: "freelance" }, DEFAULT_FILTERS);
  assert.equal(freelance.opportunityType, "freelance");
  const params = filtersToParams(freelance);
  assert.match(params, /(?:^|&)opportunity=freelance(?:&|$)/);
  assert.equal(paramsToFilters(new URLSearchParams(params)).opportunityType, "freelance");
  assert.equal(parseExplorePatch({ opportunityType: "contractor" }, freelance).opportunityType, "employment");
});

test("freelance shortcuts add useful editable title terms without replacing existing terms", () => {
  assert.equal(typeof freelancePresets.applyFreelanceShortcut, "function");
  assert.deepEqual(Object.keys(freelancePresets.FREELANCE_SHORTCUTS ?? {}), [
    "Websites", "Aplicações", "Chatbots", "Automação", "IA",
  ]);
  assert.deepEqual(
    freelancePresets.applyFreelanceShortcut(["Product Designer"], "Websites"),
    ["Product Designer", "website", "web design", "landing page"],
  );
  assert.deepEqual(
    freelancePresets.applyFreelanceShortcut(["AI", "chatbot"], "Chatbots"),
    ["AI", "chatbot", "conversational AI"],
  );
});
