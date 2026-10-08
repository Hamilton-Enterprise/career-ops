# Career Ops Managed Fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Hamilton's fork the safe, tested source of truth, move the installed app to its canonical checkout, and preserve a controlled relationship with upstream.

**Architecture:** A tracked marker makes the existing updater fail closed on the customised distribution; upstream changes instead enter through reviewed sync branches. The fork is promoted once from the already verified product branch, then protected for future PR-based work, while the installed app is rebuilt against the canonical checkout and the user data root stays external.

**Tech Stack:** Node.js 24, Next.js 16, Go, Swift/macOS app wrapper, Git worktrees, GitHub CLI/API.

**Spec:** `docs/superpowers/specs/2026-10-08-career-ops-managed-fork-design.md`

## Global Constraints

- Do not modify `work/20261005/career-ops-pt-pt`; it remains the upstream pull-request branch.
- Do not stop the currently running app until the canonical replacement passes build and pre-launch checks.
- Code, dependencies, builds and evidence stay under `~/Developer`; user data stays at `~/Developer/career-ops-data`.
- Do not run the official updater on the managed distribution; upstream enters through a dated sync branch and internal pull request.
- Do not publish a public/commercial release under the Career Ops name.
- Do not force-push, delete an unrecoverable ref, copy personal data into evidence, or change user pipeline/CV/profile content.
- Prefer existing dependencies and helpers; add no package and no new update service.
- Preserve the current PT-PT product, search/ranking/freelance behaviour, accessibility and data contracts.

## Review Focus

- A managed `check` must return before the release endpoint is called; Task 1 tests a network seam that throws if touched.
- A managed `apply --confirm` must refuse before Git status, fetch, lock or file writes; Task 1 tests the command in an isolated fixture and asserts the checkout remains unchanged.
- An ordinary upstream checkout without the marker must retain the existing updater behaviour; Task 1 runs the existing updater migration suite and a no-marker control.
- A restart must use canonical code and external data, not the feature worktree or bundled user data; Task 5 verifies preferences, `/api/version`, process arguments and persistent-data hashes.
- GitHub cleanup must not remove the active upstream PR branch or an unarchived commit; Task 4 verifies the bundle and the final remote head set.

---

### Task 1: Managed distribution guard

**Files:**
- Create: `.career-ops-managed`
- Modify: `update-system.mjs`
- Modify: `updater-migration-tests.mjs`
- Modify: `DATA_CONTRACT.md`
- Modify: `docs/contexto/architecture.md`
- Modify: `docs/contexto/rules.md`
- Modify: `docs/contexto/memory.md`

**Interfaces:**
- Consumes: the existing `check()` and `apply()` command entrypoints; `checkStatus(argv, env, ctx)` remains the ordinary-upstream status engine.
- Produces: `isManagedDistribution(root = ROOT) -> boolean`; managed CLI check result `{ status: 'managed-distribution', local, local_sha?, update_method: 'sync-branch' }`; an apply refusal naming the sync-branch flow.

- [ ] **Step 1: Add failing managed-distribution tests**

Add tests proving marker detection, no-network managed check, pre-mutation apply refusal, no-marker compatibility and source-level/data-contract coverage.

- [ ] **Step 2: Run the focused suite and confirm it fails for the missing guard**

Run: `node updater-migration-tests.mjs`

Expected: non-zero with the new managed-distribution assertions failing.

- [ ] **Step 3: Implement the minimum marker guard**

Read only the marker's existence. Return the managed result from `check()`
before `checkStatus` can reach the network; refuse at the start of `apply`
after validating the checkout but before Git status, target resolution, locks
or writes. Keep `checkStatus` and rollback unchanged for ordinary upstream
installs.

- [ ] **Step 4: Document the operational contract in the existing context files**

Record the canonical checkout/data/app paths, remote naming, controlled sync
flow, personal/internal trademark ruling and the reason the official updater is
disabled. Add the marker to the system data contract.

- [ ] **Step 5: Verify focused and regression behaviour**

Run: `node updater-migration-tests.mjs`

Run: `node test-all.mjs --quick`

Expected: both exit 0; managed tests pass and existing updater coverage remains green.

- [ ] **Step 6: Commit**

Commit message: `feat: guard managed fork updates`

### Task 2: Ecosystem registration and operating record

**Files:**
- Modify: `~/Documents/Codex/OPERATIONS/PROJECT-REGISTRY.md`
- Create: `~/Documents/Codex/BRAIN/inbox/career-ops-managed-fork.md`

**Interfaces:**
- Consumes: the paths and repository roles fixed by the spec.
- Produces: one registry entry and one concise Brain project card pointing to the repository context files rather than duplicating them.

- [ ] **Step 1: Inspect the registry schema and existing Brain card conventions**

Run the repository's normal read-only format checks and choose the smallest matching entry shape.

- [ ] **Step 2: Register the project and create the inbox card**

Name the canonical checkout, data root, app path, fork/upstream repositories,
current operational branch and the personal/internal distribution boundary.

- [ ] **Step 3: Verify paths and uniqueness**

Run: `rg -n "Career Ops|career-ops" ~/Documents/Codex/OPERATIONS/PROJECT-REGISTRY.md ~/Documents/Codex/BRAIN/inbox/career-ops-managed-fork.md`

Expected: one canonical registry record and one card with existing absolute paths.

### Task 3: Promote the operational repository

**Files:**
- No product files; Git refs, remote configuration and an evidence record only.

**Interfaces:**
- Consumes: the reviewed Task 1 commit and fork `main` at the recorded official baseline SHA.
- Produces: fork `main` at the tested managed-fork head; `origin` = Hamilton fork, `upstream` = official; local canonical `main` tracking `origin/main`.

- [ ] **Step 1: Capture preflight state and a recoverable fork-head bundle**

Record local/remote refs, worktrees, statuses and fork settings. Create and
verify a Git bundle under the dated Career Ops evidence directory before any
remote deletion or main promotion.

- [ ] **Step 2: Re-run the merge gate on the exact promotion commit**

Run the root quick suite, web test/typecheck/build and Go tests. All must exit 0.

- [ ] **Step 3: Create a remote backup ref and promote with an explicit lease**

Push the old fork `main` to a dated backup ref, then push the reviewed managed
head to fork `main` using `--force-with-lease=<recorded-old-sha>` only if a
fast-forward is impossible. Expected here: fast-forward; any remote movement
stops promotion for diagnosis.

- [ ] **Step 4: Normalize remotes and tracking**

Rename the official remote to `upstream`, the Hamilton fork to `origin`, fetch
both, and make canonical local `main` track `origin/main`. The contribution
branch continues to track its fork ref and remains eligible for PR feedback.

- [ ] **Step 5: Verify exact ancestry and clean state**

Assert fork `main` equals the reviewed commit, official `upstream/main` remains
unchanged, the contribution branch still resolves, and every worktree is clean.

### Task 4: Bootstrap fork governance and clean remote refs

**Files:**
- No product files; GitHub repository settings, workflow state and evidence only.

**Interfaces:**
- Consumes: promoted fork `main`, the preflight bundle and the active contribution branch.
- Produces: protected operational `main`, automatic merged-branch deletion, useful workflows enabled, irrelevant inherited workflows disabled, and a minimal remote branch set.

- [ ] **Step 1: Wait for and diagnose the first fork CI runs**

Use GitHub's API/CLI to confirm workflow registration and inspect every failed
job before changing protection. Fix product defects through a reviewed branch;
do not weaken a legitimate check.

- [ ] **Step 2: Configure repository and branch rules**

Enable automatic deletion of merged branches. Protect `main` against force push
and deletion, require pull requests with zero human approvals, dismiss stale
reviews, and require the stable checks observed on the bootstrap run.

- [ ] **Step 3: Disable fork-irrelevant inherited workflows**

Keep Tests, Web CI, CodeQL, Dependency Review and No user data. Disable
community-management, upstream release and funding/community automation without
deleting their files, so future upstream sync diffs stay small.

- [ ] **Step 4: Prune only recoverable remote branches**

Compare each fork branch with kept refs and the verified bundle. Keep `main`,
`work/20261005/career-ops-pt-pt` and active sync/work branches; delete copied or
merged branches and then verify every deleted tip exists in the bundle.

- [ ] **Step 5: Record and verify final GitHub state**

Capture default branch, settings, rules, enabled workflows, required checks and
remote heads in the evidence report.

### Task 5: Move the installed application to the canonical checkout

**Files:**
- Modify/build: `~/Applications/Career Ops.app`
- Modify: macOS application preferences for `io.career-ops.local`
- Evidence only under `~/Developer/evidence/career-ops/`

**Interfaces:**
- Consumes: canonical local `main` equal to protected fork `main` and existing external data root.
- Produces: a signed local app configured for the canonical checkout and data root, with the previous app/preferences recoverable until post-launch verification passes.

- [ ] **Step 1: Snapshot the current runtime and persistent-data hashes**

Record app/executable/build hashes, listener/process data, preferences and the
existing persistent-file hash inventory without copying user content.

- [ ] **Step 2: Build and verify a candidate from canonical `main`**

Use the existing macOS build script and stable project build paths. Verify web
production output, native tests, plist values and strict code signature before
touching the running app.

- [ ] **Step 3: Replace and relaunch recoverably**

Keep an exact backup, install the candidate, set checkout and data preferences,
then terminate only the identified old app/process tree and launch the new app.

- [ ] **Step 4: Verify runtime identity and core user flow**

Confirm `/api/version`, process paths, canonical checkout, data root, HTTP 200,
PT-PT navigation, employment search form, freelance switch, results/ranking UI
and assistant CLI selection without running paid agents or changing personal
pipeline/CV/profile data.

- [ ] **Step 5: Verify persistence boundaries and rollback assets**

Compare the persistent-data hash inventory, excluding documented caches; keep
the prior app/preferences until the final whole-project review is clean.

### Task 6: Final inspection, evidence and branch finish

**Files:**
- Create/update: `~/Developer/evidence/career-ops/managed-fork-2026-10-08/report.md`
- Modify: `docs/contexto/memory.md` only if final evidence changes a recorded decision.

**Interfaces:**
- Consumes: Tasks 1-5, their reviews, GitHub state and runtime evidence.
- Produces: a single final report, clean canonical/fork state and a reviewed closeout decision.

- [ ] **Step 1: Run final fresh verification on canonical `main`**

Run `node test-all.mjs --quick`, web test/typecheck/build, Go tests, updater
managed-mode checks, Git cleanliness, remote ancestry and installed-app smoke.

- [ ] **Step 2: Dispatch an independent whole-branch review**

Review the managed-fork diff from the product baseline, all deferred ledger
items, the GitHub configuration and the app evidence. Fix and re-review any
Critical or Important finding once as required by the execution method.

- [ ] **Step 3: Finalize the evidence report**

Record exact commits, test counts/exits, workflow/rule state, installed hashes,
runtime identity, retained rollback artefacts, upstream PR status and known
limits. Do not claim upstream merge or public distribution.

- [ ] **Step 4: Finish without breaking upstream stewardship**

Delete the temporary managed-fork worktree only after its commits are on fork
`main` and all files are committed. Keep the contribution worktree while PR
4864 is open. Keep the hourly PR monitor active.
