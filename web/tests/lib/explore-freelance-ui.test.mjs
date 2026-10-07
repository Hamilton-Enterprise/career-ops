import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadBindings, transform } from "next/dist/build/swc/index.js";

await loadBindings();
const require = createRequire(import.meta.url);
const icon = ({ children }) => createElement("span", null, children);
const lucide = new Proxy({}, { get: () => icon });
const cn = (...values) => values.flat().filter(Boolean).join(" ");

async function loadComponent(relative, filename, dependencies) {
  const source = fs.readFileSync(new URL(relative, import.meta.url), "utf8");
  const { code } = await transform(source, {
    filename,
    jsc: { parser: { syntax: "typescript", tsx: true }, transform: { react: { runtime: "automatic" } } },
    module: { type: "commonjs" },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(
    (id) => dependencies[id] ?? (id === "lucide-react" ? lucide : require(id)),
    module,
    module.exports,
  );
  return module.exports;
}

test("freelance filters expose the explicit mode selector and editable shortcuts", async () => {
  const { FilterBuilder } = await loadComponent("../../src/components/explore/filter-builder.tsx", "filter-builder.tsx", {
    "@/lib/cn": { cn },
    "@/lib/explore": {
      ATS_LABEL: { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workday: "Workday" },
      ATS_SOURCES: ["greenhouse", "lever", "ashby", "workday"],
      MARKET_IDS: ["portugal", "remote"],
      cleanChips: (values) => [...new Set(values)],
    },
    "@/lib/explore-state.mjs": { MARKET_LABEL: { portugal: "Portugal", remote: "Remoto" } },
    "@/lib/market-presets.mjs": { inferMarketsFromLocations: () => [] },
    "@/lib/freelance-presets.mjs": {
      FREELANCE_SHORTCUTS: { Websites: ["website"], Aplicações: ["application"], Chatbots: ["chatbot"], Automação: ["automation"], IA: ["AI"] },
      applyFreelanceShortcut: (values, label) => [...values, label],
    },
  });
  const filters = {
    opportunityType: "freelance", positive: [], negative: [], allow: [], block: [], blockHard: [], alwaysAllow: [],
    sinceDays: 7, ats: ["greenhouse"], markets: [], limitPerAts: 150,
  };
  const html = renderToStaticMarkup(createElement(FilterBuilder, { filters, onChange() {} }));
  for (const label of ["Emprego", "Freelance", "Websites", "Aplicações", "Chatbots", "Automação", "IA"]) {
    assert.match(html, new RegExp(`>${label}<`));
  }
  assert.match(html, /min-h-\[44px\][^>]*>Websites</);
  assert.match(html, /As plataformas ATS de emprego não são consultadas/);
});

test("freelance cards can be saved but never offer employment evaluation", async () => {
  const { DiscoveryCard } = await loadComponent("../../src/components/explore/discovery-card.tsx", "discovery-card.tsx", {
    "@/lib/cn": { cn },
    "@/lib/fonts": { instrumentSerif: { className: "serif" } },
    "@/lib/explore-state.mjs": { offerProvenance: () => ({ origins: ["Welcome to the Jungle"], eligibilityUnknown: false }) },
    "@/components/jobs/job-store": { useJobs: () => ({ jobs: [], startJob() { throw new Error("evaluation must not start while rendering"); } }) },
    "./explore-provider": { useExplore: () => ({ added: new Set(), adding: new Set(), addToPipeline() {} }) },
  });
  const base = { url: "https://example.test/1", company: "Acme", title: "Designer", location: "Lisboa", postedAt: "", ats: "wttj-api", source: "wttj-api" };
  const freelance = renderToStaticMarkup(createElement(DiscoveryCard, { offer: {
    ...base, opportunityType: "freelance", verification: "unconfirmed", matchedKeyword: "designer", fit: { band: "strong", score: 1 },
  }, inPipeline: false }));
  assert.match(freelance, />Freelance</);
  assert.match(freelance, /Guardar oportunidade/);
  assert.doesNotMatch(freelance, />Avaliar</);
  assert.doesNotMatch(freelance, /avaliação|A a F/i);

  const employment = renderToStaticMarkup(createElement(DiscoveryCard, { offer: { ...base, opportunityType: "employment" }, inPipeline: false }));
  assert.match(employment, />Adicionar</);
  assert.match(employment, />Avaliar/);
});
