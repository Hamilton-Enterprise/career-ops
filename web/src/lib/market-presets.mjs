import { cleanChips } from "./clean-chips.mjs";

/** @typedef {"portugal" | "spain" | "europe" | "remote"} MarketId */
/** @type {MarketId[]} */
export const MARKET_IDS = ["portugal", "spain", "europe", "remote"];

/** @param {unknown} value @returns {MarketId[]} */
export function cleanMarkets(value) {
  return cleanChips(value).map((v) => v.toLowerCase()).filter(
    /** @returns {value is MarketId} */ (value) => MARKET_IDS.includes(/** @type {MarketId} */ (value)),
  );
}

/** @param {unknown} markets */
export function encodeMarkets(markets) {
  return cleanMarkets(markets).join(",");
}

/** @param {unknown} value */
export function decodeMarkets(value) {
  return cleanMarkets(typeof value === "string" ? value.split(",") : []);
}

const EUROPE_CODES = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "GB", "CH"];
const REMOTE_BOARDS = [
  ["RemoteOK", "remoteok"], ["Remotive", "remotive"], ["Himalayas", "himalayas"],
  ["Jobicy", "jobicy"], ["Jobspresso", "jobspresso"], ["Working Nomads", "workingnomads"],
  ["We Work Remotely", "weworkremotely"],
];

/** @typedef {{ name: string, provider: string, enabled: boolean, lang?: string, wttj?: { queries: string[], filters: string } }} MarketBoard */

/** The caller supplies positive terms, or profile terms when positives are empty.
 *  This pure planner never invents a search query or reads the user's files.
 *  @param {unknown} selected @param {unknown} terms */
export function buildMarketPlan(selected, terms) {
  const markets = cleanMarkets(selected);
  const queries = cleanChips(terms);
  /** @type {Map<string, MarketBoard>} */
  const boards = new Map();
  /** @type {{ source: string, reason: string }[]} */
  const skippedSources = [];
  /** @param {MarketBoard} board */
  const add = (board) => boards.set(`${board.provider}:${board.lang ?? ""}`, board);
  for (const market of markets) {
    if (market === "portugal" || market === "europe") {
      add({ name: "Landing.jobs", provider: "landingjobs", enabled: true });
    }
    if (market === "spain" || market === "europe") {
      for (const lang of ["ES", "EN"]) add({ name: `getManfred (${lang})`, provider: "manfred", lang, enabled: true });
    }
    if (market === "europe") {
      if (queries.length) {
        add({ name: "Welcome to the Jungle", provider: "wttj", enabled: true, wttj: {
          queries, filters: EUROPE_CODES.map((code) => `offices.country_code:${code}`).join(" OR "),
        } });
      } else skippedSources.push({ source: "wttj", reason: "missing-search-terms" });
    }
    if (market === "remote") {
      for (const [name, provider] of REMOTE_BOARDS) add({ name, provider, enabled: true });
    }
  }
  return { markets, jobBoards: [...boards.values()], locationPolicy: { markets, strict: markets.length > 0 }, skippedSources };
}

function normalized(value) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

// Country abbreviations are tokens, never substrings (PT must not match Egypt).
function containsWord(location, words) {
  return new RegExp(`(^|[^\\p{L}\\p{N}_])(${words.join("|")})(?=$|[^\\p{L}\\p{N}_])`, "u").test(location);
}

const PORTUGAL = ["portugal", "pt"];
const SPAIN = ["spain", "espana", "espanha", "es"];
const EUROPE = [
  "austria", "belgium", "bulgaria", "croatia", "cyprus", "czechia", "czech republic",
  "denmark", "estonia", "finland", "france", "germany", "greece", "hungary", "ireland",
  "italy", "latvia", "lithuania", "luxembourg", "malta", "netherlands", "poland", "portugal",
  "romania", "slovakia", "slovenia", "spain", "sweden", "iceland", "liechtenstein", "norway",
  "united kingdom", "uk", "switzerland", "europe", "europa", "eu", "eea", "eee",
  "england", "scotland", "wales", "northern ireland", ...SPAIN,
];
const PORTUGUESE_CITIES = ["lisbon", "lisboa", "porto", "oporto", "braga", "coimbra", "faro", "aveiro", "setubal", "funchal"];
const SPANISH_CITIES = ["madrid", "barcelona", "valencia", "sevilla", "seville", "malaga", "bilbao", "zaragoza"];

/** Geographic policies are alternatives. A remote source proves remote work,
 *  never worldwide eligibility. Missing location fails closed on every market.
 *  @param {{ location?: unknown, source?: string, sources?: string[], ats?: string, provider?: string }} offer
 *  @param {ReturnType<typeof buildMarketPlan>} plan
 *  @returns {{ accepted: boolean, reason?: "missing-location" | "outside-market", remote?: true, eligibility?: "unknown" }} */
export function classifyMarketLocation(offer, plan) {
  if (!plan.locationPolicy.strict) return { accepted: true };
  const rawLocation = typeof offer.location === "string" ? offer.location.trim() : "";
  const location = normalized(rawLocation);
  if (!location || /^(n\/?a|unknown|not specified|not indicated|unspecified|[-—])$/.test(location)) {
    return { accepted: false, reason: "missing-location" };
  }
  // A bare normalized city is usable; a city in an unrelated country is not.
  const city = location.replace(/,?\s+(remote|hybrid|on-site|onsite)$/, "").trim();
  const portugal = containsWord(location, PORTUGAL) || PORTUGUESE_CITIES.includes(city);
  const spain = containsWord(location, SPAIN) || SPANISH_CITIES.includes(city);
  // ISO codes retain case: English "at" is not the country code AT.
  const europe = portugal || spain || containsWord(location, EUROPE) || containsWord(rawLocation, EUROPE_CODES);
  for (const market of plan.markets) {
    if ((market === "portugal" && portugal) || (market === "spain" && spain) ||
        (market === "europe" && europe)) {
      return { accepted: true };
    }
    if (market === "remote") {
      const origins = [offer.source, offer.ats, offer.provider, ...(offer.sources ?? [])].filter((v) => typeof v === "string").map(v => normalized(v).replace(/-(api|full)$/, ""));
      const remoteSource = REMOTE_BOARDS.some(([name, id]) => origins.includes(normalized(name)) || origins.includes(id));
      if (remoteSource || containsWord(location, ["remote", "remoto", "remota"])) {
        return { accepted: true, remote: true, eligibility: "unknown" };
      }
    }
  }
  return { accepted: false, reason: "outside-market" };
}
