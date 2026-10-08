# Career Ops — recuperação e entrega da app macOS (2026-10-08)

Spec: o handoff de 2026-10-08 («Handoff — Career Ops: implementar, corrigir e entregar a app macOS»), aprovado para execução. Este plano é o argumento; o handoff é a autoridade.

## Contexto verificado no arranque (2026-10-08 17:55 Europe/Lisbon)

- Worktree `~/Developer/worktrees/career-ops/managed-fork`, branch `work/20261008/career-ops-managed-fork`, base `7f7ea1051c23c56f5f902f2af7dba4ea20b5395d`, limpa.
- Canónico `~/Developer/career-ops` em `main` `655b1b508c5ddf8347c9f3dca3551cddfeeafff7`, limpo.
- App instalada: executável SHA-256 `d538507eb1630f3cccec9724891e4af00dc3666e6ae4c338bf71b6ff75404e8d`, codesign estrito válido, não estava em execução. Canonical `web/.next/BUILD_ID` `aTBqFkgAwRB8nXkGscg_p`.
- Baseline de dados/app/preferências: `~/Developer/evidence/career-ops/recovery-2026-10-08/baseline/`.
- PR interno #1: `test (windows-latest)` falha em dois testes de `explore/ai` (cancelamento codex e limpeza); restantes checks verdes. PR upstream #4864: aberto, BLOCKED/REVIEW_REQUIRED.
- Bugs reproduzidos antes de qualquer alteração: 6 dos 18 termos freelance perdidos nas duas fases; London/Ontario, Birmingham/Alabama, Lisboa/México e Porto/Brasil aceites; `Schweiz` e `Nederland` isolados rejeitados; WTTJ usa `offices[0]` e ignora `nbPages`; runner agendado não usa `buildSearchPlan`/`matchesOccupationTerms`; quatro adapters web importam código da raiz de dados; `TEXT_SRC` corta a 24 000; `build-app.sh` faz `mv` antes de `cp`; `/api/version` lê Git em runtime.

## Global Constraints

1. Nunca escrever em `~/Developer/career-ops-data`, na app instalada ou nas preferências `io.career-ops.local` durante testes; usar raízes sintéticas (`mktemp -d`) e `CAREER_OPS_ROOT`.
2. Reutilizar o que existe (`cleanChips`, `rootScript`/`resolveCodeRoot`/`resolveRootScript`, `opportunity-rank`, `careerops.scan.receipt@1`, padrão de truncagem Workday, `UserDefaults`). Sem frameworks novos.
3. TDD: teste que falha pelo motivo certo → correção mínima → verde. Não apagar testes, não alargar timeouts, não enfraquecer proteções.
4. Contratos internos em inglês; texto visível em PT-PT (AO90).
5. Não enviar candidaturas/mensagens, não usar dados pessoais em fixtures, não guardar segredos em Git/localStorage/bridge.
6. Um implementador por worktree; o implementador não aprova o próprio trabalho.
7. Cada tarefa termina com commit(s) no seu branch `work/20261008/recovery-<id>`; o controlador integra em `work/20261008/career-ops-managed-fork`.

## Tarefas

### T1 — Termos originais e traduções (Pesquisa)
Ficheiros: `web/src/lib/search-plan.mjs`, `web/src/lib/occupation-match.mjs`, testes em `web/tests/lib/`.
- `buildSearchPlan`: preservar **todos** os positivos aceites por `cleanChips` (e as variantes de grafia já geradas) nas duas fases; limitar só os acrescentos automáticos (traduções/aliases) a um orçamento fixo (12).
- `expandOccupationTerms`: originais nunca cortados; acrescentos distribuídos em round-robin por profissão e idioma, deduplicados; `omitted` lista só acrescentos cortados.
- Expor omissões no plano (`expansion.termsOmitted`) e na mensagem `changes` em PT-PT.
- Negativos, mercados, bloqueios e filtros originais intactos (deep-equal fora de `positive`/`allow`/`sinceDays`).
- Regressões: 18 termos freelance (`FREELANCE_SHORTCUTS`) e 37 positivos de `templates/portals.example.yml` presentes nas duas fases; com farmácia + vendas + loja, aliases das três profissões aparecem em broad.

### T2 — Geografia e ranking (Pesquisa)
Ficheiros: `web/src/lib/market-presets.mjs`, `web/src/lib/location-concepts.mjs`, `web/src/lib/opportunity-rank.mjs`, testes.
- Rejeitar cidades homónimas com qualificador estrangeiro: London/Ontario, Birmingham/Alabama, Lisboa/México, Porto/Brasil (estados/províncias/países fora do mercado). Fail-closed para qualificador desconhecido ao lado de uma cidade-alvo **só** quando o qualificador é um país/estado/região conhecido estrangeiro; uma cidade sem qualificador continua aceite.
- Seleção só de país reconhece os aliases do catálogo `location-concepts` (Schweiz, Suisse, Nederland, Holanda, Espanha, España, Reino Unido…), reutilizando o catálogo em vez de duplicar listas.
- Várias localizações (`;`, `|`, `/`): aceitar se algum grupo é inequivocamente do mercado; nunca promover ambiguidade a certeza.
- Remote: continua `eligibility: "unknown"`; restrição nacional publicada («Remote - US only», «Remote (UK)») não é aceite para outro mercado.
- Ranking: testes de ordem e explicação para os seis países; razões não usam km nem probabilidades.

### T3 — WTTJ: escritórios e paginação (Pesquisa)
Ficheiros: `providers/wttj.mjs`, testes de provider (raiz `tests/` ou web), `scan.mjs` só se necessário para a metadata.
- `normalizeWttjHit` junta todos os escritórios numa só oferta, separados por `; ` (já entendido por `locationGroups`), mantendo o sufixo Remote.
- Paginação limitada: `max_hits` passa a orçamento total por query; pedir páginas até `nbPages`, `ctx.maxPages`, orçamento atingido, página vazia ou página repetida; deduplicar por id/URL; erro numa página posterior conserva resultados anteriores e marca cobertura parcial.
- Assinatura `Provider.fetch(entry, ctx) → Job[]` intacta. Truncagem comunicada com o mesmo padrão de metadata do Workday e chega ao recibo `careerops.scan.receipt@1` existente.
- Zero com cobertura parcial não aciona broad nem mensagem saudável (verificar o caminho em `web/src/lib/core/scan.ts`/`market-merge.mjs`).

### T4 — Pesquisa guardada = pesquisa direta (depende de T1, T3)
Ficheiros: `web/scripts/scheduled-jobs-runner.mjs`, testes do runner.
- Antes de persistir, aplicar `buildSearchPlan(filters, "precise")` e `matchesOccupationTerms` às ofertas, mantendo o snapshot original do job.
- Preservar `capHit`, `datasetStatus`, `postingsDroppedNoDate`, `stoppedEarly`, erros; acumular incompletude entre fontes no `message`/estado já existente.
- Sem fase broad automática. Freelance não herda `title_filter.positive`; emprego mantém o fallback de `portals.yml`.
- Testes: YAML transitório, recibo, writer, dedup, histórico.

### T5 — Código separado dos dados (Dados)
Ficheiros: `web/src/app/api/inbox/skip/route.ts`, `web/src/lib/core/pdf-index.ts`, `web/src/lib/core/followups-lock.ts`, `web/src/lib/core/states.ts`, testes.
- Trocar `path.join(careerOpsRoot(), "<script>.mjs")` e `templates/states.yml` pela raiz de código (`rootScript()`/`resolveCodeRoot()`); dados continuam em `careerOpsRoot()`.
- Testes com raiz de dados externa sem scripts: skip não devolve 503, pdf-index não devolve null, followups usa lock real (duas escritas concorrentes serializadas, sem aninhar), states carrega aliases canónicos.
- Não tocar em `tracker-lock.ts`. Não classificar legados sem `opportunityType`.

### T6 — CV português (Dados/CV)
Ficheiros: `web/src/lib/cv/quality.ts`, `verify-cv-structure.mjs`, `cv-title-check.mjs`, testes.
- Reconhecer `Experiência profissional`, `Experiência`, `Competências`, `Formação`, `Projetos` com e sem acentos; manter inglês e limiares.
- Formação/projetos não contam como emprego; zero experiências não é sucesso (`UNVERIFIED`/aviso, não pass).
- Fixtures sintéticas.

### T7 — Importação de CV completa e transparente (depende de T6)
Ficheiros: `web/src/lib/cv/quality.ts` (`parseCvStream`), `web/src/components/cv/cv-ingest.tsx`, `web/src/app/api/cv/ingest/route.ts`, testes.
- `parseCvStream` devolve `complete: boolean`; só envelope completo e não vazio permite revisão/gravação. Testes: marcadores divididos, duplicados, erro após texto parcial, cancelamento.
- Acima de 24 000 caracteres: 413/400 com mensagem PT-PT antes de lançar o agente; nunca truncar.
- Uploads validados (tamanho/tipo) antes de ler integralmente; temporários removidos em todos os caminhos terminais.
- Copy: o agente escolhido pode enviar o conteúdo ao fornecedor; PDF/Word vs texto colado com mensagens próprias.

### T8 — Hooks e disponibilidade por ação (Agentes)
Ficheiros: `web/src/lib/claude-invocation.mjs`, `web/src/lib/cli-fencing.mjs`, `web/src/lib/spawn-cli.mjs`, componentes de seleção de agente/ações, testes. Não editar `web/src/app/api/explore/ai/route.ts` (T9).
- Workers Claude de leitura recebem `--settings {"disableAllHooks":true}` no ponto comum; o fencing recusa argv de leitura sem isso. Workers de escrita e autenticação inalterados.
- A UI mostra por ação se Claude/Codex/Gemini/Cursor está disponível e porquê, a partir da mesma tabela de capacidades do backend, antes de executar. Sem fallback para API paga.

### T9 — Cancelamento Windows (Agentes)
Ficheiros: `web/src/lib/cli-launch.mjs`, `web/src/lib/run-finalizer.mjs`, `web/src/app/api/explore/ai/route.ts`, `web/tests/lib/explore-ai-route.test.mjs`.
- Terminar a árvore da execução no Windows (`taskkill /T /F /PID`) e aguardar `close` antes de remover a pasta; POSIX (grupo de processo) inalterado.
- Fixture de erro Claude altera o alvo realmente lançado no Windows (`claude.cjs`).
- Teste de cancelamento sincroniza com o encerramento efetivo; descendente sintético; ambos os PIDs mortos, stream fechado, pasta removida. Certificar na CI Windows.

### T10 — Preferências macOS (App)
Ficheiros: `macos/CareerOpsApp.swift`, `macos/CareerOpsCore.swift`, `macos/CareerOpsCoreTests.swift`, um módulo web pequeno de storage partilhado e os consumidores das quatro chaves.
- Bridge `WKScriptMessageHandler` + `WKUserScript` em `.atDocumentStart`, só main frame, origem `http://127.0.0.1:<porta atual>`, token de geração por arranque.
- Allowlist e schema exatamente como no handoff; 128 KiB por payload; inválido rejeitado, nunca truncado; sem caminhos nativos.
- Chave `UserDefaults` por raiz efetiva de dados.
- Testes Swift: duas portas, clear/remove, outra raiz, subframe/origem estrangeira, campos secretos (`apiKey`) rejeitados.

### T11 — Instalação recuperável e identidade de build (App, depende de T10)
Ficheiros: `macos/build-app.sh`, `web/next.config.mjs`, `web/src/app/api/version/route.ts`, testes.
- Staging no mesmo filesystem, validação (codesign, plist, executável) e promoção por rename; falha repõe a anterior; versão anterior em `~/Developer/artifacts/career-ops/app-previous/` (nunca Lixo).
- SHA/versões capturados no build (`env` em `next.config.mjs`) e lidos pela API e pelo bundle; regressão build A → checkout B → API diz A.

### T12 — Runtime durável (App, depende de T11)
Ficheiros: `macos/build-app.sh`, `macos/CareerOpsCore.swift`/`CareerOpsApp.swift`.
- Artefacto `~/Developer/artifacts/career-ops/runtime/<sha>/` com o mínimo necessário para `next start` e scripts do core, sem dados pessoais; a app arranca desse artefacto.
- Validar imports dinâmicos/comandos (scan, set-status, doctor) a partir do artefacto; dry-run da retenção mostra que o artefacto não é apagado. Node continua dependência externa declarada.

### T13 — Copy e qualidade visual
Rever textos de pesquisa parcial/zero/custos/ranking/métricas nas superfícies tocadas. PT-PT natural, sem promessas. Sem redesenho.

### T14 — QA completo
Inventário de rotas/ações; percurso sintético completo; viewports browser 1440×1000, 768×1024, 767×1024, 390×844 claro/escuro; app nativa 1180×800 e 640×480; cada captura aberta e descrita no relatório.

### T15 — Git, CI e entrega
Revisão final independente; gates completos (raiz `npm run lint`, `node test-all.mjs`; web `npm test`, `npm run typecheck`, `npm run build`; `macos/build-app.sh --test-only`); push do branch, PR #1 atualizado, integração sem bypass quando os checks permitirem; rebuild do SHA integrado, instalação recuperável e relatório final.

## Ondas de execução

- Onda A (worktrees isoladas, ficheiros disjuntos): T1, T2, T3, T5, T6→T7, T8, T9, T10.
- Onda B: T4 (após T1, T3), T11 → T12 (após T10).
- Onda C: T13, T14, T15.
