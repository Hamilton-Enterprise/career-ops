/**
 * agent-availability.mjs — which agent can run which action, answered BEFORE a
 * run starts, from the same gates the routes apply when it does.
 *
 * Nothing here is a second permission table. Each action names the capability
 * record its route declares; availability is the verdict of cli-fencing.mjs on
 * the argv that CLI would actually be launched with, plus the two route gates
 * that sit outside the fencer (/api/run's write refusal and AI search's
 * full-fencing requirement). Server-only: cli-fencing.mjs imports node:path, so
 * the client reads the result from /api/clis.
 */

import { ACTION_CAPABILITIES, capabilitiesFor } from "./worker-capabilities.mjs";
import { fenceArgs, fencingReport, isCliAllowedForCapabilities } from "./cli-fencing.mjs";
import { claudeCliArgs } from "./claude-invocation.mjs";

/**
 * @typedef {Object} AgentAction
 * @property {string} id - /api/run kind, or the route's own action id.
 * @property {string} label - PT-PT, as the picker shows it.
 * @property {import("./worker-capabilities.mjs").Capabilities} capabilities - The record the route declares.
 * @property {boolean} [run] - Launched through /api/run (streamArgs, write refusal).
 * @property {boolean} [requiresFullFencing] - The route refuses anything below a full fencing report.
 */

/** @type {readonly AgentAction[]} */
export const AGENT_ACTIONS = Object.freeze([
  { id: "evaluate", label: "Avaliar oferta", capabilities: capabilitiesFor("evaluate"), run: true },
  { id: "pdf", label: "Gerar CV", capabilities: capabilitiesFor("pdf"), run: true },
  { id: "research", label: "Pesquisar empresa", capabilities: capabilitiesFor("research"), run: true },
  { id: "fix-portal", label: "Corrigir portal", capabilities: capabilitiesFor("fix-portal"), run: true },
  { id: "ai-search", label: "Pesquisa assistida", capabilities: ACTION_CAPABILITIES["ai-search"], requiresFullFencing: true },
  { id: "assistant", label: "Assistente", capabilities: ACTION_CAPABILITIES.assistant },
  { id: "cv-ingest", label: "Importar CV", capabilities: ACTION_CAPABILITIES["cv-ingest"] },
  { id: "apply", label: "Preencher candidatura", capabilities: ACTION_CAPABILITIES.apply },
].map((a) => Object.freeze(a)));

/**
 * @typedef {Object} ActionAvailability
 * @property {string} id
 * @property {string} label
 * @property {boolean} available
 * @property {string|null} reason - PT-PT sentence when unavailable, else null.
 */

/**
 * Why this CLI cannot run this action, or null when it can.
 *
 * @param {{id: string, name: string, args: (p: string) => string[], streamArgs?: (p: string) => string[]}} spec
 * @param {AgentAction} action
 * @returns {string|null}
 */
function blockReason(spec, action) {
  const { capabilities } = action;
  if (
    action.requiresFullFencing &&
    fencingReport({ cliId: spec.id, cliName: spec.name, capabilities }).level !== "full"
  ) {
    return `Esta ação exige um agente com isolamento só de leitura verificado (Claude Code ou Codex); o ${spec.name} não o tem.`;
  }
  if (!isCliAllowedForCapabilities(spec.id, capabilities)) {
    return spec.id === "cursor"
      ? `O ${spec.name} corre só em modo de pergunta; esta ação escreve ficheiros.`
      : `O ${spec.name} não tem controlo de permissões verificado; esta ação escreve ficheiros.`;
  }
  // Claude's argv is built by claude-invocation.mjs, never by spec.args.
  const args =
    spec.id === "claude"
      ? claudeCliArgs({ kind: action.id, prompt: "P", capabilities })
      : ((action.run && spec.streamArgs) || spec.args)("P");
  try {
    fenceArgs({ cliId: spec.id, args, capabilities });
  } catch {
    return `O ${spec.name} não tem um modo de permissões verificado para esta ação.`;
  }
  return null;
}

/**
 * Every action's availability for one CLI, in AGENT_ACTIONS order.
 *
 * @param {{id: string, name: string, args: (p: string) => string[], streamArgs?: (p: string) => string[]}} spec
 * @returns {ActionAvailability[]}
 */
export function agentActionsFor(spec) {
  return AGENT_ACTIONS.map((action) => {
    const reason = blockReason(spec, action);
    return { id: action.id, label: action.label, available: reason === null, reason };
  });
}
