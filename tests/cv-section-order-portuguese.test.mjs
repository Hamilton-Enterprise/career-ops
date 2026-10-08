// tests/cv-section-order-portuguese.test.mjs — the section-order guard must read
// Portuguese section titles, as it already reads English, Spanish, Polish and
// Chinese. Without aliases every pt-PT title falls through sectionKey() as its
// own string, and the guard silently stops comparing a CV rendered in pt-PT.
//
// Run:  node --test tests/cv-section-order-portuguese.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCvSectionOrder, sectionKey } from '../generate-pdf.mjs';

const html = titles => titles.map(t => `<div class="section-title">${t}</div>`).join('\n');
const cvMd = '# CV\n\n## Resumo profissional\n\n## Formação\n\n## Competências\n\n## Experiência profissional\n';

test('a Portuguese CV in the documented modes/pdf.md order is accepted', () => {
  assert.doesNotThrow(() => validateCvSectionOrder(
    html(['Resumo profissional', 'Competências-chave', 'Experiência profissional', 'Formação académica', 'Certificações', 'Competências técnicas']),
    cvMd,
  ));
});

test('a genuinely scrambled Portuguese CV is still rejected', () => {
  const expFirstMd = '# CV\n\n## Resumo profissional\n\n## Competências\n\n## Experiência profissional\n\n## Formação\n';
  assert.throws(
    () => validateCvSectionOrder(html(['Formação', 'Experiência profissional', 'Competências', 'Resumo profissional']), expFirstMd),
    /diverges from cv\.md/,
  );
});

test('sectionKey resolves the Portuguese spellings, with and without accents', () => {
  const cases = [
    ['Resumo', 'summary'], ['Resumo profissional', 'summary'], ['Perfil profissional', 'summary'],
    ['Competências', 'competencies'], ['Competências-chave', 'competencies'], ['Competencias principais', 'competencies'],
    ['Experiência profissional', 'experience'], ['Experiencia profissional', 'experience'], ['Percurso profissional', 'experience'],
    ['Projetos', 'projects'], ['Projetos destacados', 'projects'], ['Projectos', 'projects'],
    ['Formação', 'education'], ['Formacao academica', 'education'], ['Educação', 'education'],
    ['Certificações', 'certifications'],
    ['Prémios', 'awards'], ['Prémios e distinções', 'awards'],
    ['Competências técnicas', 'skills'], ['Aptidões', 'skills'],
    ['Interesses', 'interests'],
  ];
  const missed = cases.filter(([title, key]) => sectionKey(title) !== key)
    .map(([title, key]) => `${title} => ${sectionKey(title)} (expected ${key})`);
  assert.deepEqual(missed, []);
});
