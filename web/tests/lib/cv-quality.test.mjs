// cvReadiness must understand a Portuguese CV as well as an English one, and
// must never count education or projects as employment. Synthetic CVs only.
//
// Run (from web/):  node --experimental-strip-types --test tests/lib/cv-quality.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import "../helpers/web-ts-alias-loader.mjs";

const { cvReadiness } = await import("../../src/lib/cv/quality.ts");

const filler = (n) => Array.from({ length: n }, (_, i) => `palavra${i}`).join(" ");

test("cvReadiness: accented Portuguese experience heading counts as experience", () => {
  const md = `# CV -- Pessoa Exemplo\n\n## Experiência profissional\n\n### Empresa Alfa -- Lisboa\n\n**Analista**\n\n- ${filler(90)}\n`;
  const r = cvReadiness(md);
  assert.equal(r.hasExperience, true);
  assert.equal(r.scoreable, true);
});

test("cvReadiness: unaccented and bare 'Experiência' headings count as experience", () => {
  for (const heading of ["## Experiencia profissional", "## Experiência", "## EXPERIÊNCIA PROFISSIONAL"]) {
    assert.equal(cvReadiness(`${heading}\n\n- ${filler(90)}`).hasExperience, true, heading);
  }
});

test("cvReadiness: 'Competências' and 'Competencias' count as skills", () => {
  assert.equal(cvReadiness(`## Competências\n\n- ${filler(90)}`).hasSkills, true);
  assert.equal(cvReadiness(`## Competencias\n\n- ${filler(90)}`).hasSkills, true);
});

test("cvReadiness: a Portuguese open date range counts as experience", () => {
  assert.equal(cvReadiness(`Analista na Empresa Alfa, 2021 - presente. ${filler(90)}`).hasExperience, true);
  assert.equal(cvReadiness(`Analista na Empresa Alfa, 2021 – atual. ${filler(90)}`).hasExperience, true);
});

test("cvReadiness: date ranges under Formação or Projetos are not employment", () => {
  const md = `# CV -- Pessoa Exemplo\n\n## Formação académica\n\n### Universidade Exemplo -- Porto\n\nLicenciatura, 2015 - 2019\n\n## Projetos\n\n- Projeto Beta, 2019 - 2020\n\n${filler(90)}\n`;
  assert.equal(cvReadiness(md).hasExperience, false);
  const en = `## Education\n\nBSc, 2015 - 2019\n\n## Projects\n\n- Side project, 2019 - 2020\n\n${filler(90)}\n`;
  assert.equal(cvReadiness(en).hasExperience, false);
});

test("cvReadiness: English headings, plain date ranges and thresholds are unchanged", () => {
  assert.equal(cvReadiness(`## Work Experience\n\n- ${filler(90)}`).hasExperience, true);
  assert.equal(cvReadiness(`## Skills\n\n- ${filler(90)}`).hasSkills, true);
  assert.equal(cvReadiness(`Engineer at Acme, 2019 - present. ${filler(90)}`).hasExperience, true);
  assert.equal(cvReadiness(`## Experience\n\n${filler(70)}`).scoreable, false, "below 80 words stays not scoreable");
  assert.equal(cvReadiness(filler(199)).scoreable, false);
  assert.equal(cvReadiness(filler(200)).scoreable, true);
});

test("cvReadiness: dates under Línguas, Cursos or Voluntariado are not employment", () => {
  for (const heading of ["## Línguas", "## Cursos", "## Voluntariado"]) {
    assert.equal(cvReadiness(`${heading}\n\n- Atividade, 2016 - 2018\n\n${filler(90)}`).hasExperience, false, heading);
  }
});
