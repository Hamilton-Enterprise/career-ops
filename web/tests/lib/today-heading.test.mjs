import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../../src/components/home/today-dashboard.tsx", import.meta.url), "utf8");
const headline = source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "";

test("Hoje mostra decisões pendentes quando não há ofertas novas nem acompanhamentos", () => {
  const branch = headline.match(/\{newThisWeek === 0 && overdue === 0 && awaiting\.length > 0 && \(([\s\S]*?)\n\s*\)\}/)?.[1];
  assert.ok(branch, "o título deve cobrir o estado com apenas decisões pendentes");
  assert.match(branch, /<span className="text-brand tabular-nums">\{awaiting\.length\}<\/span>/);
  assert.match(branch, /awaiting\.length === 1 \? "decisão pendente" : "decisões pendentes"/);
  assert.doesNotMatch(branch, /·/);
});
