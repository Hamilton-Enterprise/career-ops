// CvIngest must reach the review/save step only for a complete conversion. An
// interrupted stream shows why, offers a retry, and keeps no partial text.
// The component runs for real under a minimal hook shim; only fetch, storage
// and the presentational imports are stubbed. Synthetic CV text only.
//
// Run (from web/):  node --experimental-strip-types --test tests/lib/cv-ingest-ui.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import * as React from "react";
import { loadBindings, transform } from "next/dist/build/swc/index.js";
import "../helpers/web-ts-alias-loader.mjs";

const quality = await import("../../src/lib/cv/quality.ts");
await loadBindings();
const require = createRequire(import.meta.url);
const { code } = await transform(fs.readFileSync(new URL("../../src/components/cv/cv-ingest.tsx", import.meta.url), "utf8"), {
  filename: "cv-ingest.tsx",
  jsc: { parser: { syntax: "typescript", tsx: true }, transform: { react: { runtime: "automatic" } } },
  module: { type: "commonjs" },
});

const Stub = () => null;
const FULL = "A ler o CV…\n<<cv:start>>\n# CV -- Pessoa Exemplo\n\n## Experiência profissional\n<<cv:end>>\n";
const PARTIAL = "A ler o CV…\n<<cv:start>>\n# CV -- Pessoa Exemplo\n\n## Experiência prof";

function mount(t, replies) {
  const calls = [];
  const slots = [];
  let cursor = 0;
  const hooks = {
    ...React,
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }];
    },
    useRef(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useCallback: (fn) => fn,
  };
  for (const [name, value] of Object.entries({
    localStorage: { getItem: () => '{"cliId":"claude"}' },
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(replies[Math.min(calls.length, replies.length) - 1]);
    },
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => (descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]));
  }
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((id) => ({
    react: hooks,
    "next/link": Stub,
    "next/navigation": { useRouter: () => ({ push() {} }) },
    "react-markdown": Stub,
    "remark-gfm": {},
    "lucide-react": new Proxy({}, { get: () => Stub }),
    "@/lib/cn": { cn: (...c) => c.filter(Boolean).join(" ") },
    "@/lib/fonts": { instrumentSerif: { className: "" } },
    "@/lib/cv/quality": quality,
    "@/lib/explore": { DEFAULT_FILTERS: { ats: [] }, filtersToParams: () => "" },
  }[id] ?? require(id)), module, module.exports);
  const render = () => {
    cursor = 0;
    return module.exports.CvIngest({});
  };
  return { render, calls };
}

function find(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = find(n, predicate);
      if (hit) return hit;
    }
    return null;
  }
  if (predicate(node)) return node;
  return find(node.props?.children, predicate);
}
const text = (node) => (node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children));
const button = (tree, label) => find(tree, (n) => n.type === "button" && text(n).includes(label));

async function submitPaste(ui) {
  find(ui.render(), (n) => n.type === "textarea").props.onChange({ target: { value: "Pessoa Exemplo, analista na Empresa Alfa desde 2021." } });
  button(ui.render(), "Ler o CV").props.onClick();
}

async function settle(ui, label) {
  for (let i = 0; i < 200; i++) {
    const tree = ui.render();
    if (text(tree).includes(label)) return tree;
    await delay(5);
  }
  assert.fail(`never rendered: ${label}\n${text(ui.render())}`);
}

test("an interrupted conversion is not reviewable, says so, and can be retried", async (t) => {
  const ui = mount(t, [PARTIAL, FULL]);
  await submitPaste(ui);
  const tree = await settle(ui, "interrompida");
  assert.match(text(tree), /Nada foi guardado/);
  assert.equal(text(tree).includes("Revê o CV"), false);
  assert.equal(button(tree, "Guardar"), null, "no save button for a partial CV");

  button(tree, "Tentar novamente").props.onClick();
  const reviewed = await settle(ui, "Revê o CV antes de o guardar");
  assert.equal(ui.calls.length, 2);
  assert.equal(ui.calls[1].init, ui.calls[0].init, "the retry repeats the same request");
  assert.ok(button(reviewed, "Guardar"));
});

test("a refused request shows the route's own message without a retry loop", async (t) => {
  const ui = mount(t, []);
  globalThis.fetch = async () => Response.json({ error: "O texto tem 30 000 caracteres; o limite é 24 000." }, { status: 413 });
  await submitPaste(ui);
  const tree = await settle(ui, "o limite é 24 000");
  assert.equal(button(tree, "Tentar novamente"), null);
});

test("the upload note does not claim the content never leaves the computer", (t) => {
  const tree = mount(t, [FULL]).render();
  assert.match(text(tree), /pode enviar o conteúdo ao respetivo fornecedor/);
  assert.doesNotMatch(text(tree), /processado neste computador/);
});

test("an agent error mid-stream cancels the response, so the agent is stopped", async (t) => {
  let cancelled = false;
  const ui = mount(t, []);
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('A ler o CV…\n<<cv:error>>{"reason":"unreadable"}\n'));
    },
    cancel() {
      cancelled = true;
    },
  }));
  await submitPaste(ui);
  const tree = await settle(ui, "texto colado");
  assert.doesNotMatch(text(tree), /ficheiro\./, "pasted text is not called a file");
  for (let i = 0; i < 100 && !cancelled; i++) await delay(5);
  assert.equal(cancelled, true, "the stream reader was left open after the error");
});

test("the provider note and the save note are at least 12px", (t) => {
  const src = fs.readFileSync(new URL("../../src/components/cv/cv-ingest.tsx", import.meta.url), "utf8");
  for (const phrase of ["pode enviar o conteúdo ao respetivo fornecedor", "Guardado localmente em cv.md"]) {
    const line = src.split("\n").findIndex((l) => l.includes(phrase));
    const tag = src.split("\n").slice(Math.max(0, line - 2), line + 1).join("\n");
    assert.doesNotMatch(tag, /text-\[(?:[0-9]|1[01])px\]/, phrase);
  }
});
