import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadBindings, transform } from "next/dist/build/swc/index.js";

await loadBindings();
const require = createRequire(import.meta.url);
const icon = () => createElement("span");
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

test("freelance inbox rows show tracking actions without shortlist or A–F evaluation", async () => {
  const { TriageRow } = await loadComponent("../../src/components/inbox/triage-row.tsx", "triage-row.tsx", {
    "next/link": ({ children, ...props }) => createElement("a", props, children),
    "@/lib/explore": { ATS_LABEL: { workday: "Workday" } },
    "@/components/ui/badge": { Badge: ({ children }) => createElement("span", null, children) },
    "@/components/company-logo": { CompanyLogo: () => createElement("span") },
    "@/lib/cn": { cn },
  });
  const html = renderToStaticMarkup(createElement(TriageRow, {
    job: { url: "https://example.test/freelance", company: "Acme", role: "Designer", opportunityType: "freelance", done: false },
    source: "workday",
    age: 0,
    scored: { score: 5, tone: "good", jobId: "job-1", running: false },
    selected: false,
    shortlisted: false,
    onToggleSelect() { throw new Error("freelance cannot be selected"); },
    onSave() { throw new Error("freelance cannot be shortlisted"); },
    onSkip() {},
  }));

  assert.match(html, />Freelance</);
  assert.match(html, />Abrir</);
  assert.match(html, />Retirar</);
  assert.doesNotMatch(html, /type="checkbox"|Guardar|por avaliar|\/5|A avaliar/);
});

async function triageHarness(t, stored = {}) {
  const slots = [], effects = [], started = [];
  let cursor = 0;
  const hooks = { ...React, useMemo: fn => fn(), useRef: initial => ({ current: initial }),
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], next => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((dep, i) => !Object.is(dep, slots[index][i]))) effects.push(fn);
      slots[index] = deps;
    },
  };
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: key => stored[key] ?? null, setItem: (key, value) => { stored[key] = value; },
  } });
  t.after(() => {
    if (priorStorage) Object.defineProperty(globalThis, "localStorage", priorStorage);
    else delete globalThis.localStorage;
  });
  const { InboxTriage } = await loadComponent("../../src/components/inbox/inbox-triage.tsx", "inbox-triage.tsx", {
    react: hooks, "next/navigation": { useRouter: () => ({ refresh() {} }) },
    "@/components/jobs/job-store": { useJobs: () => ({ jobs: [], startJob: job => started.push(job) }) },
    "@/lib/explore": { ATS_SOURCES: [] }, "@/lib/inbox": { daysSince: () => 0, seniorityFromTitle: () => null, sourceFromUrl: () => null, SENIORITY_ORDER: [] },
    "./facet-chips": { FacetChips: "facet-chips" }, "./triage-row": { TriageRow: "triage-row" },
    "./shortlist-tray": { ShortlistTray: "shortlist-tray" }, "@/lib/cn": { cn },
    "@/lib/run-cost-estimate.mjs": { estimateRunCost: () => ({}) },
  });
  const find = (node, type) => {
    if (!node || typeof node !== "object") return;
    if (node?.type === type) return node.props;
    for (const child of [node?.props?.children].flat(Infinity)) {
      const result = find(child, type);
      if (result) return result;
    }
  };
  return {
    started, stored,
    render(inbox) { cursor = 0; return InboxTriage({ inbox }); },
    flush() { for (const fn of effects.splice(0)) { const cleanup = fn(); if (cleanup) t.after(cleanup); } },
    tray: tree => find(tree, "shortlist-tray"), row: tree => find(tree, "triage-row"),
  };
}

const employment = { url: "https://example.test/employment", company: "Acme", role: "Engineer", opportunityType: "employment", done: false };
const retained = { ...employment, url: "https://example.test/retained", company: "Beta" };

test("shortlist restoration excludes hidden employment and freelance URLs", async t => {
  const freelance = { ...employment, url: "https://example.test/freelance", opportunityType: "freelance" };
  const h = await triageHarness(t, {
    "career-ops:shortlist": JSON.stringify([employment, retained, freelance]),
    "career-ops:hidden": JSON.stringify([employment.url]),
  });
  const inbox = [employment, retained, freelance];
  h.render(inbox); h.flush(); h.render(inbox); h.flush();
  const tray = h.tray(h.render(inbox));
  assert.deepEqual(tray.items.map(item => item.url), [retained.url]);
  tray.onScore();
  assert.deepEqual(h.started.map(job => job.input), [retained.url]);
});

test("refresh reconciles a shortlisted URL reclassified as freelance before evaluation", async t => {
  const h = await triageHarness(t, { "career-ops:shortlist": JSON.stringify([employment, retained]) });
  h.render([employment, retained]); h.flush(); h.render([employment, retained]); h.flush();
  const changed = [{ ...employment, opportunityType: "freelance" }, retained];
  const refreshing = h.render(changed);
  // A click can occur on the refreshed render before the reconciliation effect.
  h.tray(refreshing).onScore();
  assert.deepEqual(h.started.map(job => job.input), [retained.url]);
  h.flush();
  assert.deepEqual(h.tray(h.render(changed)).items, []);
});

test("refresh prunes removed shortlist URLs and retains employment", async t => {
  const h = await triageHarness(t, { "career-ops:shortlist": JSON.stringify([employment, retained]) });
  h.render([employment, retained]); h.flush(); h.render([employment, retained]); h.flush();
  h.render([retained]); h.flush();
  assert.deepEqual(h.tray(h.render([retained])).items.map(item => item.url), [retained.url]);
});

test("refresh removes freelance shortlist state and its persisted cache", async t => {
  const h = await triageHarness(t, { "career-ops:shortlist": JSON.stringify([employment, retained]) });
  const inbox = [employment, retained];
  h.render(inbox); h.flush(); h.render(inbox); h.flush();
  const changed = [{ ...employment, opportunityType: "freelance" }, retained];
  h.render(changed); h.flush(); h.render(changed); h.flush();
  assert.deepEqual(h.tray(h.render(changed)).items.map(item => item.url), [retained.url]);
  assert.deepEqual(JSON.parse(h.stored["career-ops:shortlist"]).map(item => item.url), [retained.url]);
});

test("an employment URL hidden after selection cannot be inserted by save selected", async t => {
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 200 });
  t.after(() => { globalThis.fetch = priorFetch; });
  const h = await triageHarness(t);
  const inbox = [employment, retained];
  h.render(inbox); h.flush(); h.render(inbox); h.flush();
  const row = h.row(h.render(inbox));
  row.onToggleSelect(); row.onSkip();
  const tree = h.render(inbox);
  function saveButton(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "button" && node.props.children === "Guardar na seleção") return node.props;
    for (const child of [node.props?.children].flat(Infinity)) { const found = saveButton(child); if (found) return found; }
  }
  saveButton(tree).onClick();
  assert.deepEqual(h.tray(h.render(inbox)).items, []);
});
