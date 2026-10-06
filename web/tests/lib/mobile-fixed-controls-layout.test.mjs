import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../src/components");
const shell = readFileSync(join(root, "app-shell.tsx"), "utf8");
const beta = readFileSync(join(root, "beta/beta-banner.tsx"), "utf8");
const assistant = readFileSync(join(root, "assistant-console.tsx"), "utf8");

test("mobile fixed controls remain separate 44px icon targets without covering content", () => {
  assert.match(shell, /<main className="[^"]*max-sm:pb-20[^"]*"/);
  assert.match(beta, /aria-label="Comunicar erro"/);
  assert.match(beta, /max-sm:size-11/);
  assert.match(beta, /<span className="[^"]*hidden[^"]*sm:inline[^"]*">Comunicar erro<\/span>/);
  assert.match(assistant, /aria-label="Abrir assistente"/);
  assert.match(assistant, /max-sm:size-11/);
  assert.match(assistant, /<span className="[^"]*hidden[^"]*sm:inline[^"]*">Assistente<\/span>/);
});
