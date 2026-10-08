import { NextResponse } from "next/server";
import { KNOWN, detectClis } from "@/lib/clis";
import { agentActionsFor } from "@/lib/agent-availability.mjs";

export const dynamic = "force-dynamic";

// Detects which agnostic CLIs are installed on THIS machine (local-first). The
// web delegates career-ops to one of these in headless mode, on the user's own
// auth/tokens — no API key needed. `actions` says, per action, whether the
// routes would accept that CLI, so the UI can say so before a run starts.
export async function GET() {
  const clis = detectClis().map((c) => {
    const spec = KNOWN.find((k) => k.id === c.id);
    return spec ? { ...c, actions: agentActionsFor(spec) } : c;
  });
  return NextResponse.json({ clis });
}
