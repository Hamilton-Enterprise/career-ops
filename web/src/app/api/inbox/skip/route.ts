import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { setInboxSkip } from "@/lib/inbox-skip.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Inbox Skip/undo: flip `- [ ]` ↔ `- [x]` on the matching data/pipeline.md row.
// This is NOT /api/status — Home DecisionCard Skip writes a tracker Discarded
// status; the inbox is the pipeline checklist.

const ERROR_HTTP: Record<string, number> = {
  "invalid-url": 400,
  "unmatched": 404,
  "not-found": 404,
  "busy": 409,
};

const ERROR_MSG: Record<string, string> = {
  "invalid-url": "O endereço da oferta tem de começar por http:// ou https://.",
  "unmatched": "Não foi encontrada uma oportunidade com esse endereço.",
  "not-found": "O ficheiro pipeline.md não foi encontrado.",
  "busy": "As oportunidades estão a ser atualizadas por outro processo. Volta a tentar.",
};

export async function POST(req: Request) {
  let body: { url?: unknown; done?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url : "";
  if (body.done !== undefined && typeof body.done !== "boolean") {
    return Response.json({ error: "O estado concluído tem de ser verdadeiro ou falso." }, { status: 400 });
  }
  const done = body.done !== false;

  const file = path.join(careerOpsRoot(), "data", "pipeline.md");
  const lockModule = rootScript("pipeline-lock");
  if (!fs.existsSync(lockModule)) {
    return Response.json(
      { error: "Esta ação exige os scripts do career-ops, que não foram encontrados na pasta do código.", code: "core-script-missing" },
      { status: 503 },
    );
  }

  try {
    const result = await setInboxSkip(file, url, done, { lockModule });
    if (!result.ok) {
      const code = result.error;
      return Response.json(
        { error: ERROR_MSG[code] ?? "Não foi possível alterar a oportunidade.", code },
        {
          status: ERROR_HTTP[code] ?? 400,
          ...(code === "busy" ? { headers: { "Retry-After": "5" } } : {}),
        },
      );
    }
    return Response.json({ ok: true, done, matched: result.matched, changed: result.changed });
  } catch {
    return Response.json({ error: "Não foi possível guardar a alteração." }, { status: 500 });
  }
}
