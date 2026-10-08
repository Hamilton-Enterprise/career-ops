// The agent picker in Configuração says, per installed agent, which actions it
// cannot run and why — before any run — from the /api/clis `actions` field that
// agent-availability.mjs produces.
//
// Run:  node --experimental-strip-types --test tests/lib/config-form-availability-ui.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadBindings, transform } from "next/dist/build/swc/index.js";
import * as cliPick from "../../src/lib/cli-pick.mjs";
import { agentActionsFor } from "../../src/lib/agent-availability.mjs";

const { KNOWN } = await import("../../src/lib/clis.ts");

await loadBindings();
const require = createRequire(import.meta.url);

const detected = ["claude", "cursor", "gemini"].map((id) => {
  const spec = KNOWN.find((c) => c.id === id);
  return { id, name: spec.name, run: spec.run, url: spec.url, installed: true, path: `/bin/${id}`, actions: agentActionsFor(spec) };
});
// The CLI list starts as null and is filled by the /api/clis effect; render the
// filled state directly.
const hooks = { ...React, useEffect() {}, useState: (initial) => [initial === null ? detected : initial, () => {}] };

const { code } = await transform(fs.readFileSync(new URL("../../src/components/config-form.tsx", import.meta.url), "utf8"), {
  filename: "config-form.tsx",
  jsc: { parser: { syntax: "typescript", tsx: true }, transform: { react: { runtime: "automatic" } } },
  module: { type: "commonjs" },
});
const module = { exports: {} };
new Function("require", "module", "exports", code)(
  (id) =>
    ({
      react: hooks,
      "lucide-react": new Proxy({}, { get: () => () => null }),
      "@/lib/cn": { cn: (...v) => v.filter(Boolean).join(" ") },
      "@/components/followups/cadence-settings": { CadenceSettings: () => null },
      "@/lib/saved-cli": { persistCliId() {}, readSavedCliId: () => null },
      "@/lib/cli-pick.mjs": cliPick,
    })[id] ?? require(id),
  module,
  module.exports,
);
const html = renderToStaticMarkup(React.createElement(module.exports.ConfigForm));

test("each installed agent lists the actions it cannot run, with the backend's reason", () => {
  // Cursor: the writing actions, grouped under one reason.
  assert.match(html, /Indisponível: Avaliar oferta, Corrigir portal\.<\/span> O Cursor Agent corre só em modo de pergunta; esta ação escreve ficheiros\./);
  assert.match(html, /Indisponível: Pesquisa assistida\.<\/span> Esta ação exige um agente com isolamento só de leitura verificado \(Claude Code ou Codex\); o Cursor Agent não o tem\./);
  // Gemini: refused everywhere, so every action is named.
  assert.match(html, /id="cli-limits-gemini"/);
  assert.match(html, /Indisponível: Avaliar oferta, Gerar CV, Pesquisar empresa, Corrigir portal, Assistente, Importar CV, Preencher candidatura\./);
  // Claude: nothing to report, and no dangling description reference.
  assert.doesNotMatch(html, /cli-limits-claude/);
  // The row button points at its own limits for assistive technology.
  assert.match(html, /aria-describedby="cli-limits-cursor"/);
});
