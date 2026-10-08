// Which agent can run which action, told to the UI before anything is spawned.
//
// The answer is derived from the backend's own gates (worker-capabilities.mjs,
// cli-fencing.mjs, claude-invocation.mjs) and checked here against them, so the
// picker cannot offer an agent the route would then refuse.
//
// Run:  node --experimental-strip-types --test tests/lib/agent-availability.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_ACTIONS, agentActionsFor } from "../../src/lib/agent-availability.mjs";
import { CAPS, KNOWN_KINDS, capabilitiesFor } from "../../src/lib/worker-capabilities.mjs";
import { fenceArgs, fencingReport, isCliAllowedForCapabilities } from "../../src/lib/cli-fencing.mjs";
import { claudeCliArgs } from "../../src/lib/claude-invocation.mjs";
import { actionBlockReason } from "../../src/lib/cli-pick.mjs";

const { KNOWN } = await import("../../src/lib/clis.ts");

const byId = (cliId) => {
  const spec = KNOWN.find((c) => c.id === cliId);
  assert.ok(spec, `${cliId} is a known CLI`);
  return Object.fromEntries(agentActionsFor(spec).map((a) => [a.id, a]));
};

test("every /api/run kind is an action, with the record the route uses", () => {
  for (const kind of KNOWN_KINDS) {
    const action = AGENT_ACTIONS.find((a) => a.id === kind);
    assert.ok(action, `${kind} must be offered to the picker`);
    assert.equal(action.capabilities, capabilitiesFor(kind), `${kind} uses capabilitiesFor(kind)`);
  }
  // And the routes that declare their record inline are listed with the same one.
  const inline = { "ai-search": CAPS.webSearchOnly, assistant: CAPS.networkReadOnly, "cv-ingest": CAPS.localReadOnly, apply: CAPS.localReadOnly };
  for (const [id, caps] of Object.entries(inline)) {
    assert.equal(AGENT_ACTIONS.find((a) => a.id === id)?.capabilities, caps, `${id} capabilities`);
  }
});

test("Cursor: offered for read-only actions, refused for writing ones with a reason", () => {
  const cursor = byId("cursor");
  for (const id of ["evaluate", "fix-portal"]) {
    assert.equal(cursor[id].available, false, `${id} writes files`);
    assert.equal(cursor[id].reason, "O Cursor Agent corre só em modo de pergunta; esta ação escreve ficheiros.");
  }
  assert.equal(cursor["ai-search"].available, false);
  assert.match(cursor["ai-search"].reason, /Claude Code ou Codex/);
  for (const id of ["pdf", "research", "assistant", "cv-ingest", "apply"]) {
    assert.deepEqual([cursor[id].available, cursor[id].reason], [true, null], id);
  }
});

test("Gemini: refused everywhere the backend refuses it, never silently offered", () => {
  const gemini = byId("gemini");
  for (const action of AGENT_ACTIONS) {
    assert.equal(gemini[action.id].available, false, action.id);
    assert.ok(gemini[action.id].reason, `${action.id} names a reason`);
  }
});

test("Claude and Codex are available for every action", () => {
  for (const cliId of ["claude", "codex"]) {
    for (const a of agentActionsFor(KNOWN.find((c) => c.id === cliId))) {
      assert.deepEqual([a.available, a.reason], [true, null], `${cliId} × ${a.id}`);
    }
  }
});

test("every action × CLI agrees with the backend's own gates", () => {
  // Given each gate a route applies before spawning: the run route's write
  // refusal, AI search's full-fencing requirement, and the fencer itself on the
  // argv that CLI is launched with.
  for (const spec of KNOWN) {
    for (const action of AGENT_ACTIONS) {
      const caps = action.capabilities;
      const isRun = KNOWN_KINDS.includes(action.id);
      const argv =
        spec.id === "claude"
          ? claudeCliArgs({ kind: action.id, prompt: "P", capabilities: caps })
          : ((isRun && spec.streamArgs) || spec.args)("P");
      let fenced = true;
      try {
        fenceArgs({ cliId: spec.id, args: argv, capabilities: caps });
      } catch {
        fenced = false;
      }
      const accepted =
        fenced &&
        isCliAllowedForCapabilities(spec.id, caps) &&
        (action.id !== "ai-search" || fencingReport({ cliId: spec.id, cliName: spec.name, capabilities: caps }).level === "full");

      const got = agentActionsFor(spec).find((a) => a.id === action.id);
      // Then the picker says exactly what the backend would do, and every refusal has a reason.
      assert.equal(got.available, accepted, `${spec.id} × ${action.id}`);
      assert.equal(got.reason === null, accepted, `${spec.id} × ${action.id} reason`);
    }
  }
});

test("actionBlockReason reads the /api/clis payload the client already fetched", () => {
  const clis = [
    { id: "cursor", installed: true, actions: agentActionsFor(KNOWN.find((c) => c.id === "cursor")) },
    { id: "claude", installed: true },
  ];
  assert.match(actionBlockReason(clis, "cursor", "evaluate"), /modo de pergunta/);
  assert.equal(actionBlockReason(clis, "cursor", "pdf"), null);
  // An entry without the field (older server) or an unknown action is not blocked
  // here: the server still refuses, so the client never invents a refusal.
  assert.equal(actionBlockReason(clis, "claude", "evaluate"), null);
  assert.equal(actionBlockReason(clis, "cursor", "unknown"), null);
  assert.equal(actionBlockReason(undefined, "cursor", "evaluate"), null);
});
