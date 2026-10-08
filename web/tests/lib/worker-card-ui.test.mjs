// Tray refusal/error copy must stay readable: ≥12px and full wrap (the tray is
// the only response to the click). Run:
//   node --experimental-strip-types --test tests/lib/worker-card-ui.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadBindings, transform } from "next/dist/build/swc/index.js";
import { jobErrorHint } from "../../src/lib/job-error-hint.mjs";
import { isFencingNotice } from "../../src/lib/fencing-notice.mjs";

await loadBindings();
const require = createRequire(import.meta.url);

const { code } = await transform(
  fs.readFileSync(new URL("../../src/components/jobs/worker-card.tsx", import.meta.url), "utf8"),
  {
    filename: "worker-card.tsx",
    jsc: { parser: { syntax: "typescript", tsx: true }, transform: { react: { runtime: "automatic" } } },
    module: { type: "commonjs" },
  },
);
const module = { exports: {} };
new Function("require", "module", "exports", code)(
  (id) =>
    ({
      react: React,
      "lucide-react": new Proxy({}, { get: () => () => null }),
      "@/lib/cn": { cn: (...v) => v.filter(Boolean).join(" ") },
      "@/lib/job-error-hint.mjs": { jobErrorHint },
      "@/lib/fencing-notice.mjs": { isFencingNotice },
    })[id] ?? require(id),
  module,
  module.exports,
);
const { WorkerCard } = module.exports;

const fencing =
  "Codex cannot be permission-restricted on this host — a execução correu com o acesso predefinido do agente.";

test("tray refusal reason is at least text-xs and wraps the full sentence", () => {
  const job = {
    id: "j1",
    title: "Avaliar oferta",
    status: "error",
    startedAt: Date.now() - 5000,
    steps: [
      { kind: "status", label: fencing, ts: Date.now() },
      { kind: "status", label: "Nenhum agente configurado. Abre Configuração e guarda a escolha.", ts: Date.now() },
    ],
    text: "",
  };
  const html = renderToStaticMarkup(React.createElement(WorkerCard, { job, variant: "tray" }));
  assert.match(html, /text-xs/);
  assert.doesNotMatch(html, /text-\[10px\]/);
  // Refusal and error hint must not use truncate — the tray is the only surface.
  const amber = [...html.matchAll(/<div class="([^"]*text-amber[^"]*)">([\s\S]*?)<\/div>/g)];
  assert.ok(amber.length >= 2, "amber fencing + error-hint lines are rendered");
  for (const [, className, body] of amber) {
    assert.doesNotMatch(className, /\btruncate\b/, `refusal/hint must wrap: ${className}`);
    assert.match(className, /\btext-xs\b/);
    assert.ok(body.trim().length > 0);
  }
  assert.match(html, /Inicia sessão no agente em Configuração/);
  assert.ok(html.includes(fencing), "full fencing notice is visible without truncation");
});
