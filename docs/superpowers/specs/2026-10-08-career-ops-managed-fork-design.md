# Career Ops Managed Fork Design

## Outcome

Career Ops has one operational source of truth owned by Hamilton, while the
official project remains an upstream dependency and a place for selective
contributions. The installed macOS application uses the canonical local
checkout and the existing external data directory; it never depends on a
temporary feature worktree.

## Repository model

- `Hamilton-Enterprise/career-ops` is the operational repository.
- `career-ops-hq/career-ops` is the upstream repository.
- The local remote named `origin` points to the operational repository.
- The local remote named `upstream` points to the official repository.
- `main` is the tested operational product branch and tracks `origin/main`.
- Upstream changes enter through a dated `sync/upstream-YYYY-MM-DD` branch,
  tests, and an internal pull request before they reach `main`.
- Generic fixes may be contributed upstream from a separate branch. Fork-only
  policy, branding and operational changes never enter such a branch.

The current upstream pull request remains on
`work/20261005/career-ops-pt-pt`. The managed-fork work starts from its tested
head on a separate branch, so fork policy does not widen that pull request.

## Distribution and update safety

The official updater is unsafe for this customised distribution because it
fetches `career-ops-hq/career-ops` directly and can replace customised system
files. A tracked root marker, `.career-ops-managed`, identifies the managed
distribution.

When the marker exists:

- `node update-system.mjs check` reports a stable managed-distribution status
  without querying the official release service;
- `node update-system.mjs apply --confirm` refuses before any update network or
  Git mutation and directs the operator to the controlled upstream-sync flow;
- rollback remains available for an update made before the distribution became
  managed.

The marker is a system-owned file and is covered by the repository data
contract. Tests must fail if an upstream sync removes the guard while retaining
the marker.

No custom release channel, update server or automatic upstream merger is built
now. The controlled branch-and-PR flow is the smallest mechanism that prevents
silent replacement while preserving review and rollback.

## Local runtime model

- Canonical code checkout: `~/Developer/career-ops`.
- Persistent user data: `~/Developer/career-ops-data`.
- Installed application: `~/Applications/Career Ops.app`.
- Feature and contribution worktrees are temporary development surfaces only.
- The application may run an internal loopback web server; the user launches a
  native local app and does not manage that server manually.

The currently running application must not be stopped until a canonical build
passes its build, signature, launch and smoke gates. If replacement fails, the
existing application and preferences remain the rollback path.

## GitHub governance

The operational fork keeps the workflows that protect product integrity:
Tests, Web CI, CodeQL, Dependency Review and No user data. Community-management
and official-release workflows inherited from upstream are disabled in the
fork when GitHub exposes them.

After the bootstrap promotion, `main` rejects force pushes and deletion and
requires pull requests for later changes. Human approval count may be zero for
a single-owner repository, but required automated checks must pass. Merged
branches are deleted automatically.

Before remote branch cleanup, every fork head is inventoried and archived in a
local Git bundle under the Career Ops evidence directory. Keep `main`, the
active upstream-contribution branch and any active sync branch; delete copied
or merged remote branches only after their commit is recoverable from the
bundle or another kept ref.

## Upstream contribution posture

Pull request 4864 stays available for maintainer review and is not force-pushed
or polluted with fork-only governance. The automation may respond to real CI or
review feedback and merge only when GitHub permits it. If maintainers request a
smaller contribution, generic fixes can be split later; no duplicate pull
requests are opened speculatively.

## Product and trademark boundary

This delivery is for Hamilton's personal/internal use. The MIT licence permits
the code fork, but the upstream trademark policy reserves public product and
service naming. No public/commercial release is published under the Career Ops
name. A public or commercial distribution requires a rebrand and a separate
release review first.

## Verification and evidence

Completion requires:

- focused red/green tests for the managed updater guard;
- the full root quick suite, web tests, typecheck, production build and Go
  tests on the final tree;
- clean Git state and exact remote/tracking verification;
- GitHub API verification of default branch, settings, protection, workflows
  and retained branches;
- a rebuilt installed app whose preferences point to the canonical checkout
  and external data root;
- HTTP/API and visible UI smoke tests after relaunch;
- a final independent whole-branch review;
- an evidence report that records commands, revisions, settings and rollback
  artefacts without copying personal data.
