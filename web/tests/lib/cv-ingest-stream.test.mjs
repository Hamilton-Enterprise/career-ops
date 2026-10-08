// The CV ingest stream may only be reviewed and saved when the agent sent the
// whole envelope: an interrupted, duplicated or failed run must never look
// like a finished CV. Synthetic CV text only.
//
// Run (from web/):  node --experimental-strip-types --test tests/lib/cv-ingest-stream.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import "../helpers/web-ts-alias-loader.mjs";

const { parseCvStream, finishCvStream, cvTextLengthError, cvUploadError, CV_TEXT_MAX_CHARS, CV_UPLOAD_MAX_BYTES } = await import("../../src/lib/cv/quality.ts");

const BODY = "# CV -- Pessoa Exemplo\n\n## Experiência profissional\n\n### Empresa Alfa -- Lisboa";
const SEED = '<<cv:seed>>{"title":"Analista","roles":["Analista"],"location":"Lisboa"}';
const FULL = `A ler o CV…\n<<cv:start>>\n${BODY}\n<<cv:end>>\n${SEED}\n`;

test("parseCvStream: a whole envelope is complete", () => {
  const r = parseCvStream(FULL);
  assert.equal(r.complete, true);
  assert.equal(r.markdown, BODY);
  assert.equal(r.seed.title, "Analista");
  assert.equal(r.error, null);
});

test("parseCvStream: markers split across chunks complete only when the closer has fully arrived", () => {
  const chunks = ["A ler o CV…\n<<cv:st", `art>>\n${BODY}\n<<cv:e`, "nd", `>>\n${SEED}\n`];
  let buf = "";
  const seen = [];
  for (const c of chunks) {
    buf += c;
    seen.push(parseCvStream(buf).complete);
  }
  assert.deepEqual(seen, [false, false, false, true]);
  assert.equal(parseCvStream(buf).markdown, BODY);
});

test("parseCvStream: duplicated markers are never complete", () => {
  assert.equal(parseCvStream(`<<cv:start>>\n${BODY}\n<<cv:start>>\nOutro\n<<cv:end>>\n`).complete, false);
  assert.equal(parseCvStream(`<<cv:start>>\n${BODY}\n<<cv:end>>\nResto\n<<cv:end>>\n`).complete, false);
});

test("parseCvStream: an error after partial text is an error, not a CV", () => {
  const r = parseCvStream(`<<cv:start>>\n${BODY}\n<<cv:error>>{"reason":"unreadable"}`);
  assert.equal(r.complete, false);
  assert.equal(r.error, "unreadable");
  assert.equal(r.markdown, "");
});

test("parseCvStream: a stream that ends without the closer (cancelled/killed) is incomplete", () => {
  const r = parseCvStream(`A ler o CV…\n<<cv:start>>\n${BODY}\n- metade de uma li`);
  assert.equal(r.complete, false);
  assert.ok(r.markdown.startsWith("# CV"), "partial text is still available as a live preview");
});

test("parseCvStream: an empty envelope is not complete", () => {
  assert.equal(parseCvStream("<<cv:start>>\n  \n<<cv:end>>\n").complete, false);
});

test("finishCvStream: only a complete envelope can be reviewed", () => {
  const ok = finishCvStream(FULL);
  assert.equal(ok.ok, true);
  assert.equal(ok.markdown, BODY);
  for (const buf of [
    `<<cv:start>>\n${BODY}\n- metade`,
    "A ler o CV…\n",
    `<<cv:start>>\n${BODY}\n<<cv:end>>\n<<cv:end>>`,
    `<<cv:start>>\n${BODY}\n\n[Claude Code] fatal: killed\n`,
  ]) {
    const r = finishCvStream(buf);
    assert.equal(r.ok, false, buf);
    assert.equal(r.retry, true);
    assert.match(r.message, /Nada foi guardado/);
    assert.equal("markdown" in r, false, "a failed run never hands back partial text to save");
  }
  assert.match(finishCvStream(`<<cv:start>>\n${BODY}\n- metade`).message, /interrompida/);
  assert.match(finishCvStream(`<<cv:start>>\n${BODY}\n<<cv:end>>\n<<cv:end>>`).message, /repetidos/);
  assert.match(finishCvStream('<<cv:error>>{"reason":"unreadable"}').message, /extrair texto/);
});

test("cvTextLengthError: states the real length and the limit, in pt-PT", () => {
  assert.equal(CV_TEXT_MAX_CHARS, 24000);
  assert.equal(cvTextLengthError(24000), null);
  const msg = cvTextLengthError(31234);
  assert.match(msg, /31\s234 caracteres/);
  assert.match(msg, /24\s000/);
  assert.match(msg, /carregue o ficheiro|carrega o ficheiro/);
});

test("cvUploadError: rejects oversized and unsupported files by metadata alone", () => {
  assert.equal(cvUploadError({ name: "cv.pdf", size: 1000 }), null);
  assert.equal(cvUploadError({ name: "CV.DOCX", size: 1000 }), null);
  assert.equal(cvUploadError({ name: "cv.md", size: 1000 }), null);
  assert.match(cvUploadError({ name: "cv.pdf", size: CV_UPLOAD_MAX_BYTES + 1 }).message, /MB/);
  assert.equal(cvUploadError({ name: "cv.pdf", size: CV_UPLOAD_MAX_BYTES + 1 }).status, 413);
  assert.equal(cvUploadError({ name: "foto.png", size: 1000 }).status, 415);
  assert.match(cvUploadError({ name: "foto.png", size: 1000 }).message, /\.png/);
  assert.equal(cvUploadError({ name: "cv.doc", size: 1000 }).status, 415);
});

// An echoed prompt (`codex exec` repeats it) mentions every marker mid-line.
const ECHO = 'Emit ONLY the markdown between <<cv:start>> and <<cv:end>> (own lines), then one <<cv:seed>>{"title":"x"} line; or <<cv:error>>{"reason":"unreadable"} if you can\'t read it.\n- If the source is unreadable, emit ONLY: `<<cv:error>>{"reason":"unreadable"}` and stop.\n';

test("parseCvStream: markers only count on a line of their own, so an echoed prompt is ignored", () => {
  const r = parseCvStream(`${ECHO}${FULL}`);
  assert.equal(r.error, null);
  assert.equal(r.complete, true);
  assert.equal(r.markdown, BODY);
  assert.equal(r.seed.title, "Analista");
  assert.equal(finishCvStream(`${ECHO}${FULL}`).ok, true);
});

test("parseCvStream: an echoed prompt alone is not an error and not a CV", () => {
  const r = parseCvStream(ECHO);
  assert.equal(r.error, null);
  assert.equal(r.complete, false);
  assert.equal(r.markdown, "");
});

test("parseCvStream: partial preview still works after an echo", () => {
  const r = parseCvStream(`${ECHO}A ler o CV…\n<<cv:start>>\n${BODY}\n- metade`);
  assert.equal(r.complete, false);
  assert.ok(r.markdown.startsWith("# CV"));
  assert.ok(r.markdown.endsWith("- metade"));
});

test("finishCvStream: an unreadable pasted text is not called a file", () => {
  const err = '<<cv:error>>{"reason":"unreadable"}\n';
  assert.match(finishCvStream(err, "file").message, /ficheiro/);
  const pasted = finishCvStream(err, "text").message;
  assert.doesNotMatch(pasted, /ficheiro/);
  assert.match(pasted, /texto/);
});
