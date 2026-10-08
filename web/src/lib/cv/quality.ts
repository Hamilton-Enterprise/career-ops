// Client-safe (no node). Deterministic "is this CV good enough to score?" signal —
// ZERO tokens. Advisory only: it drives a green-check vs amber hint, NEVER blocks
// saving (the minimal-CV principle: even a rough parse is enough for a first score).
import { asciiFold } from "@/lib/core/ascii-fold.mjs";

export type CvReadiness = { scoreable: boolean; words: number; hasExperience: boolean; hasSkills: boolean; hint?: string };

const EXPERIENCE_HEADING = /^(experience|work|employment|empleo|experiencia)/;
const SKILLS_HEADING = /^(skills|technologies|competenc|habilidad)/;
// Sections whose dates are study or side work, never employment.
const NON_EMPLOYMENT_HEADING = /^(education|educacao|formacao|projects?|projetos?|projectos?|certifications?|certificacoes|languages|idiomas|linguas|cursos|voluntariado)\b/;
const DATE_RANGE = /\b(20\d\d)\s*[-–—]\s*(20\d\d|present|now|actualidad|presente|atual|actual|atualmente)/i;

/** Date ranges outside education/projects-style sections (and their subsections). */
function employmentDateRange(text: string): boolean {
  let excludedLevel: number | null = null;
  for (const line of text.split("\n")) {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      if (excludedLevel === null || level <= excludedLevel) excludedLevel = NON_EMPLOYMENT_HEADING.test(asciiFold(h[2])) ? level : null;
      continue;
    }
    if (excludedLevel === null && DATE_RANGE.test(line)) return true;
  }
  return false;
}

export function cvReadiness(md: string): CvReadiness {
  const text = (md || "").trim();
  const words = text ? text.split(/\s+/).length : 0;
  const headings = [...text.matchAll(/(?:^|\n)#{1,3}\s*([^\n]*)/g)].map((m) => asciiFold(m[1]));
  const hasExperience = headings.some((h) => EXPERIENCE_HEADING.test(h)) || employmentDateRange(text);
  const hasSkills = headings.some((h) => SKILLS_HEADING.test(h));
  const scoreable = words >= 80 && (hasExperience || hasSkills || words >= 200);
  let hint: string | undefined;
  if (!scoreable) hint = words < 40 ? "O CV tem pouco conteúdo. Acrescenta a tua experiência para melhorar a avaliação; ainda assim, podes guardá-lo." : "Acrescenta uma ou duas experiências profissionais para melhorar a avaliação; ainda assim, podes guardá-lo.";
  return { scoreable, words, hasExperience, hasSkills, hint };
}

// ── CV ingest limits (shared by the route and the client) ──
export const CV_TEXT_MAX_CHARS = 24000;
export const CV_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const CV_UPLOAD_EXT = /\.(pdf|docx|md|markdown|txt)$/i;

const ptCount = (n: number) => n.toLocaleString("pt-PT");

/** Pasted text over the limit is refused, never truncated. */
export function cvTextLengthError(chars: number): string | null {
  if (chars <= CV_TEXT_MAX_CHARS) return null;
  return `O texto tem ${ptCount(chars)} caracteres; o limite é ${ptCount(CV_TEXT_MAX_CHARS)}. Encurta-o ou carrega o ficheiro.`;
}

export function cvUploadSizeMessage(bytes: number): string {
  return `O ficheiro tem ${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB; o limite é ${CV_UPLOAD_MAX_BYTES / 1024 / 1024} MB.`;
}

/** Judged on name and size only, so it can run before the file is read. */
export function cvUploadError(file: { name: string; size: number }): { status: number; message: string } | null {
  if (!CV_UPLOAD_EXT.test(file.name)) {
    const ext = file.name.match(/\.[^./]+$/)?.[0] || "sem extensão";
    return { status: 415, message: `Formato não suportado (${ext}). Usa PDF, Word (.docx), Markdown ou texto (.txt).` };
  }
  if (file.size > CV_UPLOAD_MAX_BYTES) {
    return { status: 413, message: cvUploadSizeMessage(file.size) };
  }
  return null;
}

// ── CV ingest stream markers (parallel to the <<act:>>/<<offer:>> envelopes) ──
export type CvSeed = { title?: string; roles?: string[]; location?: string };
export type CvIngestResult = { markdown: string; seed: CvSeed | null; error: string | null; trace: string; complete: boolean };

// Markers only count on a line of their own (the cv-envelope.mjs rule): CLIs
// such as `codex exec` echo the prompt, which mentions every marker mid-line.
const START_RE = /^[ \t]*<<cv:start>>[ \t]*\r?$/gm;
const END_RE = /^[ \t]*<<cv:end>>[ \t]*\r?$/gm;
const ERROR_RE = /^[ \t]*<<cv:error>>[ \t]*(\{[^}\n]*\})/m;
const SEED_RE = /^[ \t]*<<cv:seed>>[ \t]*(\{[^\n]*\})/m;
const markerLines = (s: string, re: RegExp) => [...s.matchAll(re)];

/** Parse the full accumulated ingest stream text into its parts. Tolerant: a
 *  still-streaming buffer just yields partial markdown + the pre-start trace.
 *  `complete` is true only for exactly one start/end pair around a non-empty body. */
export function parseCvStream(buf: string): CvIngestResult {
  const errM = ERROR_RE.exec(buf);
  if (errM) {
    let reason = "unreadable";
    try {
      reason = JSON.parse(errM[1]).reason || reason;
    } catch {
      /* keep default */
    }
    return { markdown: "", seed: null, error: reason, trace: buf.slice(0, errM.index).trim(), complete: false };
  }

  const starts = markerLines(buf, START_RE);
  const start = starts[0];
  const trace = (start ? buf.slice(0, start.index) : buf).replace(/(^|\n)[ \t]*<<cv:[a-z]*>?>?[^\n]*$/, "").trim();
  if (!start) return { markdown: "", seed: null, error: null, trace, complete: false };

  const bodyFrom = start.index + start[0].length;
  const ends = markerLines(buf, END_RE);
  const end = ends.find((m) => m.index >= bodyFrom);
  const markdown = buf.slice(bodyFrom, end ? end.index : undefined).replace(/^\s*\n/, "").trimEnd();
  const complete = !!end && starts.length === 1 && ends.length === 1 && markdown.trim() !== "";

  let seed: CvSeed | null = null;
  const seedM = SEED_RE.exec(buf);
  if (seedM) {
    try {
      const j = JSON.parse(seedM[1]);
      seed = {
        title: typeof j.title === "string" ? j.title : undefined,
        roles: Array.isArray(j.roles) ? j.roles.filter((r: unknown): r is string => typeof r === "string").slice(0, 6) : undefined,
        location: typeof j.location === "string" ? j.location : undefined,
      };
    } catch {
      /* malformed seed → ignore */
    }
  }
  return { markdown, seed, error: null, trace, complete };
}

export type CvIngestOutcome = { ok: true; markdown: string; seed: CvSeed | null } | { ok: false; message: string; retry: boolean };

/** What the finished stream allows: review only a complete envelope, otherwise
 *  an explanation and no text to save. */
export function finishCvStream(buf: string, source: "text" | "file" = "file"): CvIngestOutcome {
  const r = parseCvStream(buf);
  if (r.complete) return { ok: true, markdown: r.markdown, seed: r.seed };
  if (r.error === "unreadable") {
    return source === "text"
      ? { ok: false, retry: false, message: "O agente não encontrou um CV no texto colado. Confirma que colaste o conteúdo do CV e tenta de novo." }
      : { ok: false, retry: false, message: "Não foi possível extrair texto do ficheiro. Se for uma imagem digitalizada, cola o texto." };
  }
  if (r.error) return { ok: false, retry: true, message: "O agente não conseguiu interpretar o CV. Nada foi guardado. Tenta novamente ou cola o texto." };
  if (markerLines(buf, START_RE).length > 1 || markerLines(buf, END_RE).length > 1) {
    return { ok: false, retry: true, message: "A resposta do agente veio com marcadores repetidos e não se sabe onde acaba o CV. Nada foi guardado. Tenta novamente." };
  }
  if (r.markdown.trim()) return { ok: false, retry: true, message: "A conversão foi interrompida antes do fim e o CV ficou incompleto. Nada foi guardado. Tenta novamente." };
  return { ok: false, retry: true, message: "O agente terminou sem devolver um CV. Nada foi guardado. Tenta novamente ou cola o texto." };
}
