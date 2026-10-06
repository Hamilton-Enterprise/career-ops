import { normalizeUrl } from "./url-key.mjs";
import { classifyMarketLocation } from "../market-presets.mjs";

/** @typedef {import('../explore').DiscoveredOffer} DiscoveredOffer */
/** @typedef {{source:string, state:'ok'|'error'|'skipped', message?:string}} SourceState */
/** @typedef {{offers:DiscoveredOffer[], sources:SourceState[], missingLocation:number, valid:boolean, status:'ok'|'partial'|'failed', scanned:number}} MarketRun */

/** @param {DiscoveredOffer} offer */
function origins(offer) {
  return [...new Set([offer.source, ...(offer.sources ?? [])].filter(Boolean))];
}

/** @param {DiscoveredOffer[]} atsOffers @param {DiscoveredOffer[]} marketOffers */
export function mergeDiscoveredOffers(atsOffers, marketOffers) {
  /** @type {Map<string, DiscoveredOffer>} */
  const merged = new Map();
  for (const offer of [...atsOffers, ...marketOffers]) {
    const key = normalizeUrl(offer.url);
    if (!key) continue;
    const previous = merged.get(key);
    if (!previous) { merged.set(key, { ...offer, sources: origins(offer) }); continue; }
    const isAts = (o) => /^(greenhouse|lever|ashby|workday)(-full)?$/i.test(o.ats || o.source);
    const preferred = isAts(offer) && !isAts(previous) ? offer : previous;
    const fallback = preferred === offer ? previous : offer;
    const filled = { ...fallback, ...preferred };
    for (const field of Object.keys(fallback)) {
      if (filled[field] === "" || filled[field] == null) filled[field] = fallback[field];
    }
    filled.sources = [...new Set([...origins(previous), ...origins(offer)])];
    merged.set(key, filled);
  }
  return [...merged.values()];
}

/** Parse the core's versioned receipt, independently of child exit success.
 * @param {string} output @param {number|null} exitCode
 * @param {ReturnType<import('../market-presets.mjs').buildMarketPlan>} plan
 * @param {boolean} timedOut @returns {MarketRun} */
export function parseMarketReceipt(output, exitCode, plan, timedOut = false) {
  const sources = plan.jobBoards.map(({ name }) => ({ source: name, state: /** @type {'ok'|'error'|'skipped'} */ ('ok') }));
  sources.push(...plan.skippedSources.map(({ source, reason }) => ({ source, state: /** @type {'skipped'} */ ('skipped'), message: reason })));
  /** @type {MarketRun} */
  const run = { offers: [], sources, missingLocation: 0, valid: false, status: "failed", scanned: 0 };
  let receipt;
  try { receipt = JSON.parse(output); } catch { receipt = null; }
  if (!receipt || receipt.version !== "careerops.scan.receipt@1" || receipt.dry_run !== true ||
      !Array.isArray(receipt.offers) || !Array.isArray(receipt.errors) ||
      !Number.isFinite(receipt.scanned) || (exitCode !== 0 && exitCode !== 2 && !timedOut)) {
    for (const source of sources) if (source.state !== "skipped") {
      source.state = "error";
      source.message = timedOut ? "A fonte não terminou dentro do prazo." : "O scanner não devolveu um recibo válido.";
    }
    return run;
  }
  run.scanned = receipt.scanned;
  for (const error of receipt.errors) {
    const state = sources.find(s => s.source === error?.company);
    if (state) { state.state = "error"; state.message = typeof error.error === "string" ? error.error : "Falha na fonte."; }
  }
  for (const raw of receipt.offers) {
    if (!raw || typeof raw !== "object") continue;
    const scalar = (v) => typeof v === "string" ? v.trim() : "";
    const url = scalar(raw.url);
    if (!normalizeUrl(url) || !scalar(raw.title) || !scalar(raw.company)) continue;
    // scan.mjs stamps provider ids as `<id>-api`; presets use the bare id.
    const classification = classifyMarketLocation({ ...raw, provider: typeof raw.source === "string" ? raw.source.replace(/-api$/, "") : "" }, plan);
    if (classification.reason === "missing-location") run.missingLocation++;
    if (!classification.accepted) continue;
    let postedAt = "";
    const date = typeof raw.postedAt === "number" && raw.postedAt > 0 ? new Date(raw.postedAt) :
      typeof raw.postedAt === "string" && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(raw.postedAt) ? new Date(raw.postedAt) : null;
    if (date && Number.isFinite(date.getTime())) postedAt = date.toISOString().slice(0, 10);
    const source = scalar(raw.source);
    const offer = { url, company: scalar(raw.company), title: scalar(raw.title), location: scalar(raw.location), postedAt,
      ats: source, source, sources: source ? [source] : [], verification: /** @type {'unconfirmed'} */ ('unconfirmed') };
    const salary = raw.salary;
    if (salary && typeof salary === "object") {
      const clean = {};
      for (const field of ["min", "max"]) if (typeof salary[field] === "number" && Number.isFinite(salary[field]) && salary[field] >= 0) clean[field] = salary[field];
      if (typeof salary.currency === "string" && salary.currency.trim()) clean.currency = salary.currency.trim().toUpperCase();
      if (typeof salary.period === "string" && salary.period.trim()) clean.period = salary.period.trim();
      if (Object.keys(clean).length) offer.salary = clean;
    }
    run.offers.push(offer);
  }
  run.offers = mergeDiscoveredOffers([], run.offers);
  run.valid = sources.some(s => s.state === "ok") || run.offers.length > 0;
  run.status = !run.valid ? "failed" : timedOut || exitCode === 2 || receipt.errors.length || sources.some(s => s.state !== "ok") ? "partial" : "ok";
  return run;
}
