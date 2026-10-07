import { spawn } from "node:child_process";
import fs from "node:fs";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { writeTempPortals, cleanupTempPortals, loadProfileTargets, readScanTimeoutMs } from "@/lib/core/portals";
import { buildMarketPlan } from "@/lib/market-presets.mjs";
import { parseMarketReceipt, type MarketRun } from "./market-merge.mjs";
import type { ExploreFilters, ScanEvent } from "@/lib/explore";

export type { MarketRun } from "./market-merge.mjs";

export async function runMarketDiscovery(filters: ExploreFilters, onEvent: (e: ScanEvent) => void): Promise<MarketRun> {
  const plan = buildMarketPlan(filters.markets, filters.positive.length ? filters.positive : loadProfileTargets(), filters.opportunityType);
  const complete = (run: MarketRun) => {
    for (const source of run.sources) {
      if (source.state === "ok") {
        const provider = plan.jobBoards.find(b => b.name === source.source)?.provider;
        onEvent({ kind: "sourceDone", source: source.source, count: run.offers.filter(o =>
          o.sources?.includes(source.source) || (provider && o.sources?.includes(`${provider}-api`))).length });
      }
      else onEvent({ kind: "sourceError", source: source.source, message: source.message ?? "Fonte indisponível." });
    }
    for (const offer of run.offers) onEvent({ kind: "offer", offer });
    return run;
  };
  for (const board of plan.jobBoards) onEvent({ kind: "sourceStart", source: board.name });
  if (!plan.jobBoards.length || !fs.existsSync(rootScript("scan"))) return complete(parseMarketReceipt("", null, plan));
  // Count missing locations from the receipt before enforcing market geography.
  // Core strict mode would remove those offers before we could count them.
  const tempPortals = writeTempPortals(filters, plan.jobBoards);
  try {
    const run = await new Promise<MarketRun>((resolve) => {
      const child = spawn(process.execPath, [rootScript("scan"), "--dry-run", "--json", "--since", String(filters.sinceDays)], {
        cwd: careerOpsRoot(), env: { ...process.env, CAREER_OPS_PORTALS: tempPortals },
      });
      let output = "";
      let timedOut = false;
      let hardKiller: ReturnType<typeof setTimeout> | undefined;
      const killer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        hardKiller = setTimeout(() => child.kill("SIGKILL"), 5000);
      }, readScanTimeoutMs());
      const finish = (code: number | null) => {
        clearTimeout(killer);
        if (hardKiller) clearTimeout(hardKiller);
        resolve(parseMarketReceipt(output, code, plan, timedOut));
      };
      child.stdout.on("data", (data: Buffer) => { output += data.toString(); });
      child.stderr.on("data", () => {}); // Drain progress; authoritative states come from the receipt.
      child.on("error", () => finish(null));
      child.on("close", finish);
    });
    return complete(run);
  } finally {
    cleanupTempPortals(tempPortals);
  }
}
