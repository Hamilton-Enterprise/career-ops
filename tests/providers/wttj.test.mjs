// tests/providers/wttj.test.mjs — Welcome to the Jungle provider (public
// Algolia search index behind welcometothejungle.com; credentials fetched
// fresh from /api/env). Follows the discovered-test layout from #1440.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — wttj (Welcome to the Jungle Algolia index)');
try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/wttj.mjs')).href);
  const wttj = mod.default;
  const { parseEnvPayload, normalizeWttjHit } = mod;

  if (wttj.id === 'wttj') pass('wttj.id is "wttj"');
  else fail(`wttj.id is ${JSON.stringify(wttj.id)}`);

  const hit = wttj.detect({ name: 'Welcome to the Jungle', provider: 'wttj' });
  if (hit && hit.url === 'https://www.welcometothejungle.com') {
    pass('wttj.detect() claims entries with provider: wttj');
  } else {
    fail(`wttj.detect() returned ${JSON.stringify(hit)}`);
  }

  if (wttj.detect({ name: 'X', provider: 'greenhouse' }) === null) {
    pass('wttj.detect() returns null for other providers');
  } else {
    fail('wttj.detect() should return null for other providers');
  }

  if (wttj.detect({ name: 'X', careers_url: 'https://www.welcometothejungle.com/en/jobs' }) === null) {
    pass('wttj.detect() does not URL-autodetect (explicit provider: wttj only — the board is global)');
  } else {
    fail('wttj.detect() should not claim entries by careers_url');
  }

  // parseEnvPayload — the /api/env `window.env = {...}` payload
  const HEX_KEY = '0123456789abcdef0123456789abcdef';
  const envText = (appId, apiKey) =>
    `window.env = ${JSON.stringify({ PUBLIC_ALGOLIA_APPLICATION_ID: appId, PUBLIC_ALGOLIA_API_KEY_CLIENT: apiKey, OTHER: 'noise' })};`;

  const creds = parseEnvPayload(envText(' AB12CD34 ', HEX_KEY));
  if (creds.appId === 'AB12CD34' && creds.apiKey === HEX_KEY) {
    pass('parseEnvPayload() extracts and trims the Algolia app id + client key');
  } else {
    fail(`parseEnvPayload() returned ${JSON.stringify(creds)}`);
  }

  // The client key is only ever sent as a header, so its format is not
  // over-constrained — a rotated long/base64 (secured) key must still parse.
  const securedKey = 'QWxnb2xpYSBzZWN1cmVkIGtleQ==' + 'x'.repeat(100);
  const secured = parseEnvPayload(envText('AB12CD34', securedKey));
  if (secured.apiKey === securedKey) {
    pass('parseEnvPayload() accepts a long non-hex (secured/base64) client key — length bounds only');
  } else {
    fail(`parseEnvPayload() secured key → ${JSON.stringify(secured.apiKey)}`);
  }

  const throws = (fn) => { try { fn(); return false; } catch { return true; } };

  if (throws(() => parseEnvPayload(envText('AB12CD34', 'short')))) {
    pass('parseEnvPayload() rejects an implausibly short api key');
  } else {
    fail('parseEnvPayload() should reject an implausibly short api key');
  }

  if (throws(() => parseEnvPayload(envText('bad app id!', HEX_KEY)))) {
    pass('parseEnvPayload() rejects a non-alphanumeric app id (it becomes a hostname)');
  } else {
    fail('parseEnvPayload() should reject a non-alphanumeric app id');
  }

  if (throws(() => parseEnvPayload('window.env = undefined;'))) {
    pass('parseEnvPayload() rejects a payload with no JSON object');
  } else {
    fail('parseEnvPayload() should reject a payload with no JSON object');
  }

  if (throws(() => parseEnvPayload('window.env = {not json};'))) {
    pass('parseEnvPayload() rejects invalid JSON');
  } else {
    fail('parseEnvPayload() should reject invalid JSON');
  }

  // normalizeWttjHit — Algolia hit → normalized Job
  const fullHit = {
    name: '  Senior Data Engineer  ',
    slug: 'senior-data-engineer_abc123',
    organization: { name: 'Example SAS', slug: 'example-sas' },
    offices: [{ city: 'Paris', country: 'France' }, { city: 'Lyon', country: 'France' }],
    remote: 'fulltime',
    published_at_timestamp: 1751500800,
    salary_yearly_minimum: 60000,
    salary_maximum: 80000,
    salary_period: 'yearly',
    salary_currency: 'eur',
  };
  const j1 = normalizeWttjHit(fullHit);
  if (
    j1 &&
    j1.title === 'Senior Data Engineer' &&
    j1.url === 'https://www.welcometothejungle.com/en/companies/example-sas/jobs/senior-data-engineer_abc123' &&
    j1.company === 'Example SAS'
  ) {
    pass('normalizeWttjHit() maps name/slug/organization to title/url/company');
  } else {
    fail(`normalizeWttjHit() job = ${JSON.stringify(j1)}`);
  }

  if (j1 && j1.location === 'Paris, France; Lyon, France, Remote') {
    pass('normalizeWttjHit() joins every office as "City, Country" with "; " and appends Remote once for fulltime-remote posts');
  } else {
    fail(`normalizeWttjHit() location = ${JSON.stringify(j1 && j1.location)}`);
  }

  const officesOnly = normalizeWttjHit({
    ...fullHit,
    remote: 'partial',
    offices: [{ city: 'Lisboa', country: 'Portugal' }, { city: ' ', country: 'Portugal' }, { city: 'Lisboa', country: 'Portugal' }, null],
  });
  if (officesOnly && officesOnly.location === 'Lisboa, Portugal; Portugal') {
    pass('normalizeWttjHit() keeps a country-only office, drops repeated/invalid offices, and adds no Remote suffix for partial remote');
  } else {
    fail(`normalizeWttjHit() offices-only location = ${JSON.stringify(officesOnly && officesOnly.location)}`);
  }

  const remoteOnly = normalizeWttjHit({ ...fullHit, offices: [] });
  if (remoteOnly && remoteOnly.location === 'Remote') {
    pass('normalizeWttjHit() falls back to "Remote" for a fulltime-remote post without offices');
  } else {
    fail(`normalizeWttjHit() remote-only location = ${JSON.stringify(remoteOnly && remoteOnly.location)}`);
  }

  if (j1 && j1.postedAt === 1751500800000) {
    pass('normalizeWttjHit() converts published_at_timestamp epoch-seconds to ms');
  } else {
    fail(`normalizeWttjHit() postedAt = ${j1 && j1.postedAt}`);
  }

  if (j1 && j1.salary && j1.salary.min === 60000 && j1.salary.max === 80000 && j1.salary.currency === 'EUR') {
    pass('normalizeWttjHit() attaches a yearly salary range with uppercased currency');
  } else {
    fail(`normalizeWttjHit() salary = ${JSON.stringify(j1 && j1.salary)}`);
  }

  const monthly = normalizeWttjHit({
    ...fullHit,
    salary_yearly_minimum: 50000,
    salary_maximum: 5000,
    salary_period: 'monthly',
  });
  if (monthly && monthly.salary && monthly.salary.min === 50000 && monthly.salary.max === 50000) {
    pass('normalizeWttjHit() ignores a non-yearly salary_maximum (keeps only the annualized minimum)');
  } else {
    fail(`normalizeWttjHit() monthly-period salary = ${JSON.stringify(monthly && monthly.salary)}`);
  }

  const bare = normalizeWttjHit({ name: 'Job', slug: 'job-1', organization: { slug: 'acme' } });
  if (bare && bare.company === 'Welcome to the Jungle' && bare.location === '' && bare.salary === undefined && bare.postedAt === undefined) {
    pass('normalizeWttjHit() falls back to the board name and omits absent salary/postedAt');
  } else {
    fail(`normalizeWttjHit() bare hit = ${JSON.stringify(bare)}`);
  }

  if (normalizeWttjHit({ name: 'Job', slug: 'job-1', organization: {} }) === null) {
    pass('normalizeWttjHit() returns null when the organization slug is missing');
  } else {
    fail('normalizeWttjHit() should return null without an organization slug');
  }

  if (normalizeWttjHit({ name: 'Job', slug: '../evil', organization: { slug: 'acme' } }) === null) {
    pass('normalizeWttjHit() rejects path-unsafe slugs (they feed straight into a URL path)');
  } else {
    fail('normalizeWttjHit() should reject path-unsafe slugs');
  }

  if (normalizeWttjHit(null) === null && normalizeWttjHit('nope') === null) {
    pass('normalizeWttjHit() returns null for non-object hits');
  } else {
    fail('normalizeWttjHit() should return null for non-object hits');
  }

  // fetch() — env bootstrap, per-query Algolia calls, headers, dedup (mocked ctx)
  const ENV_OK = envText('AB12CD34', HEX_KEY);
  const mkHit = (slug, title) => ({
    name: title,
    slug,
    organization: { name: 'Acme', slug: 'acme' },
    offices: [{ city: 'Paris', country: 'France' }],
  });
  const mkCtx = (env, hitsFor) => {
    const textCalls = [];
    const jsonCalls = [];
    return {
      textCalls,
      jsonCalls,
      ctx: {
        fetchText: async (url, opts) => { textCalls.push({ url, opts }); return env; },
        fetchJson: async (url, opts) => {
          const params = new URLSearchParams(JSON.parse(opts.body).params);
          const call = {
            url,
            opts,
            query: params.get('query'),
            hitsPerPage: params.get('hitsPerPage'),
            page: Number(params.get('page') ?? 0),
            filters: params.get('filters'),
          };
          jsonCalls.push(call);
          return hitsFor(call);
        },
      },
    };
  };

  const happy = mkCtx(ENV_OK, ({ query }) => ({
    hits: query === 'finops'
      ? [mkHit('job-a', 'FinOps Lead'), mkHit('job-b', 'FinOps Analyst')]
      : [mkHit('job-b', 'FinOps Analyst'), mkHit('job-c', 'Snowflake Engineer')],
  }));
  const happyJobs = await wttj.fetch(
    { name: 'WTTJ', provider: 'wttj', wttj: { queries: ['finops', 'snowflake'] } },
    happy.ctx,
  );
  if (happyJobs.length === 3 && happy.jsonCalls.length === 2) {
    pass('wttj.fetch() runs one Algolia query per configured search and dedupes across queries');
  } else {
    fail(`wttj.fetch(): ${happyJobs.length} jobs from ${happy.jsonCalls.length} queries`);
  }

  if (
    happy.textCalls.length === 1 &&
    happy.textCalls[0].url === 'https://www.welcometothejungle.com/api/env' &&
    happy.textCalls[0].opts.redirect === 'error'
  ) {
    pass('wttj.fetch() bootstraps credentials from /api/env with redirect: error');
  } else {
    fail(`wttj.fetch() env calls = ${JSON.stringify(happy.textCalls.map((c) => c.url))}`);
  }

  const q1 = happy.jsonCalls[0];
  if (q1.url === 'https://AB12CD34-dsn.algolia.net/1/indexes/wttj_jobs_production_en/query') {
    pass('wttj.fetch() derives the Algolia host from the fetched app id');
  } else {
    fail(`wttj.fetch() Algolia URL = ${q1.url}`);
  }

  if (
    q1.opts.headers['x-algolia-application-id'] === 'AB12CD34' &&
    q1.opts.headers['x-algolia-api-key'] === HEX_KEY &&
    q1.opts.headers.referer === 'https://www.welcometothejungle.com/' &&
    q1.opts.redirect === 'error'
  ) {
    pass('wttj.fetch() sends the app id, api key, and the referer the key is locked to');
  } else {
    fail(`wttj.fetch() Algolia headers = ${JSON.stringify(q1.opts.headers)}`);
  }

  if (happy.jsonCalls.every((c) => c.opts.timeoutMs === 5000)) {
    pass('wttj.fetch() bounds each Algolia request at 5 s so 12 queries x 3 pages fit the scan deadline');
  } else {
    fail(`wttj.fetch() Algolia timeoutMs = ${JSON.stringify(happy.jsonCalls.map((c) => c.opts.timeoutMs))}`);
  }

  if (q1.hitsPerPage === '100' && happy.jsonCalls.map((c) => c.query).join(',') === 'finops,snowflake') {
    pass('wttj.fetch() defaults to 100 hits per query and passes each search term through');
  } else {
    fail(`wttj.fetch() hitsPerPage=${q1.hitsPerPage}, queries=${happy.jsonCalls.map((c) => c.query).join(',')}`);
  }

  // A board of `total` distinct hits, served page by page as Algolia does.
  const boardOf = (total) => ({ page, hitsPerPage }) => {
    const size = Number(hitsPerPage);
    const hits = [];
    for (let i = page * size; i < Math.min(total, (page + 1) * size); i++) hits.push(mkHit(`job-${i}`, `Role ${i}`));
    return { hits, nbHits: total, nbPages: Math.ceil(total / size), page, hitsPerPage: size };
  };

  const capped = mkCtx(ENV_OK, boardOf(5000));
  const cappedJobs = await wttj.fetch({ name: 'WTTJ', provider: 'wttj', wttj: { queries: ['x'], max_hits: 500 } }, capped.ctx);
  if (cappedJobs.length === 200 && capped.jsonCalls.length === 2 && capped.jsonCalls.every((c) => c.hitsPerPage === '100')) {
    pass('wttj.fetch() caps the max_hits budget at 200 per query, read as two pages of 100');
  } else {
    fail(`wttj.fetch() max_hits=500 → ${cappedJobs.length} jobs from ${capped.jsonCalls.length} pages (hitsPerPage=${capped.jsonCalls.map((c) => c.hitsPerPage)})`);
  }

  // --- Pagination (max_hits is the total budget per query) ---------------
  const paged = mkCtx(ENV_OK, boardOf(250));
  const pagedJobs = await wttj.fetch(
    { name: 'WTTJ', provider: 'wttj', wttj: { filters: 'offices.country_code:PT', max_hits: 1000 } },
    paged.ctx,
  );
  if (
    pagedJobs.length === 250 &&
    paged.jsonCalls.map((c) => c.page).join(',') === '0,1,2' &&
    pagedJobs.wttjTruncated === undefined
  ) {
    pass('wttj.fetch() follows nbPages across three pages and does not flag a fully read result');
  } else {
    fail(`wttj.fetch() 3-page board → ${pagedJobs.length} jobs, pages=${paged.jsonCalls.map((c) => c.page)}, truncated=${pagedJobs.wttjTruncated}`);
  }

  const budget = mkCtx(ENV_OK, boardOf(500));
  const budgetJobs = await wttj.fetch({ name: 'WTTJ', provider: 'wttj', wttj: { queries: ['x'], max_hits: 150 } }, budget.ctx);
  if (
    budgetJobs.length === 150 && budget.jsonCalls.length === 2 && budgetJobs.wttjTruncated === undefined &&
    JSON.stringify(budgetJobs.wttjHitBudget) === JSON.stringify([{ query: 'x', read: 150, total: 500 }])
  ) {
    pass('wttj.fetch() stops at the max_hits budget and reports it as a known hit-budget limit, not truncation');
  } else {
    fail(`wttj.fetch() budget 150 of 500 → ${budgetJobs.length} jobs, ${budget.jsonCalls.length} pages, truncated=${budgetJobs.wttjTruncated}, hitBudget=${JSON.stringify(budgetJobs.wttjHitBudget)}`);
  }

  const incoherent = mkCtx(ENV_OK, (call) => ({ ...boardOf(300)(call), nbPages: 1 }));
  const incoherentJobs = await wttj.fetch({ name: 'WTTJ', provider: 'wttj', wttj: { queries: ['x'], max_hits: 200 } }, incoherent.ctx);
  if (incoherentJobs.length === 100 && incoherentJobs.wttjTruncated === 'structural' && incoherentJobs.wttjHitBudget === undefined) {
    pass('wttj.fetch() flags structural truncation when nbPages ends before nbHits is read');
  } else {
    fail(`wttj.fetch() incoherent nbPages → ${incoherentJobs.length} jobs, truncated=${incoherentJobs.wttjTruncated}, hitBudget=${JSON.stringify(incoherentJobs.wttjHitBudget)}`);
  }

  const mixed = mkCtx(ENV_OK, (call) => {
    if (call.query === 'b' && call.page === 1) throw new Error('fixture query b page 2 down');
    return boardOf(450)(call);
  });
  const mixedWarn = console.error;
  console.error = () => {};
  let mixedJobs;
  try {
    mixedJobs = await wttj.fetch({ name: 'WTTJ', provider: 'wttj', wttj: { queries: ['a', 'b'], max_hits: 200 } }, mixed.ctx);
  } finally {
    console.error = mixedWarn;
  }
  if (
    mixedJobs.wttjTruncated === 'transient' &&
    JSON.stringify(mixedJobs.wttjHitBudget) === JSON.stringify([{ query: 'a', read: 200, total: 450 }])
  ) {
    pass('wttj.fetch() keeps a hit-budget term and a transient term apart');
  } else {
    fail(`wttj.fetch() mixed → truncated=${mixedJobs.wttjTruncated}, hitBudget=${JSON.stringify(mixedJobs.wttjHitBudget)}`);
  }

  const exact = mkCtx(ENV_OK, boardOf(150));
  const exactJobs = await wttj.fetch({ name: 'WTTJ', provider: 'wttj', wttj: { queries: ['x'], max_hits: 150 } }, exact.ctx);
  if (exactJobs.length === 150 && exactJobs.wttjTruncated === undefined) {
    pass('wttj.fetch() does not flag a budget that exactly covers nbHits');
  } else {
    fail(`wttj.fetch() budget 150 of 150 → ${exactJobs.length} jobs, truncated=${exactJobs.wttjTruncated}`);
  }

  const emptyPage = mkCtx(ENV_OK, (call) => (call.page === 1 ? { hits: [], nbHits: 300, nbPages: 3 } : boardOf(300)(call)));
  const emptyPageJobs = await wttj.fetch({ name: 'WTTJ', provider: 'wttj', wttj: { queries: ['x'], max_hits: 200 } }, emptyPage.ctx);
  if (emptyPageJobs.length === 100 && emptyPage.jsonCalls.length === 2 && emptyPageJobs.wttjTruncated === 'structural') {
    pass('wttj.fetch() stops on an empty page and flags the hits nbHits still promised');
  } else {
    fail(`wttj.fetch() empty page 1 → ${emptyPageJobs.length} jobs, ${emptyPage.jsonCalls.length} pages, truncated=${emptyPageJobs.wttjTruncated}`);
  }

  const repeated = mkCtx(ENV_OK, (call) => boardOf(300)({ ...call, page: 0 }));
  const repeatedJobs = await wttj.fetch({ name: 'WTTJ', provider: 'wttj', wttj: { queries: ['x'], max_hits: 200 } }, repeated.ctx);
  if (repeatedJobs.length === 100 && repeated.jsonCalls.length === 2 && repeatedJobs.wttjTruncated === 'structural') {
    pass('wttj.fetch() stops on a page whose hits were all seen already and flags the result');
  } else {
    fail(`wttj.fetch() repeated page → ${repeatedJobs.length} jobs, ${repeated.jsonCalls.length} pages, truncated=${repeatedJobs.wttjTruncated}`);
  }

  const laterError = mkCtx(ENV_OK, (call) => {
    if (call.page === 1) throw new Error('fixture page 2 unavailable');
    return boardOf(300)(call);
  });
  const origError = console.error;
  const laterWarnings = [];
  console.error = (...args) => { laterWarnings.push(args.join(' ')); };
  let laterErrorJobs;
  try {
    laterErrorJobs = await wttj.fetch({ name: 'WTTJ', provider: 'wttj', wttj: { queries: ['x'], max_hits: 200 } }, laterError.ctx);
  } finally {
    console.error = origError;
  }
  if (
    laterErrorJobs.length === 100 &&
    laterErrorJobs.wttjTruncated === 'transient' &&
    laterWarnings.some((w) => w.includes('fixture page 2 unavailable'))
  ) {
    pass('wttj.fetch() keeps page 1 when page 2 fails and flags transient truncation');
  } else {
    fail(`wttj.fetch() page-2 error → ${laterErrorJobs && laterErrorJobs.length} jobs, truncated=${laterErrorJobs && laterErrorJobs.wttjTruncated}`);
  }

  let firstPageErr = '';
  try {
    await wttj.fetch(
      { name: 'WTTJ', provider: 'wttj', wttj: { queries: ['x'] } },
      mkCtx(ENV_OK, () => { throw new Error('fixture first page down'); }).ctx,
    );
  } catch (err) { firstPageErr = err.message; }
  if (firstPageErr === 'fixture first page down') {
    pass('wttj.fetch() still throws when the first page fails');
  } else {
    fail(`wttj.fetch() first-page error = ${JSON.stringify(firstPageErr) || 'did not throw'}`);
  }

  const secondQueryDown = mkCtx(ENV_OK, (call) => {
    if (call.query === 'b') throw new Error('fixture query b down');
    return boardOf(50)(call);
  });
  const secondWarnings = [];
  console.error = (...args) => { secondWarnings.push(args.join(' ')); };
  let secondQueryJobs;
  try {
    secondQueryJobs = await wttj.fetch({ name: 'WTTJ', provider: 'wttj', wttj: { queries: ['a', 'b'] } }, secondQueryDown.ctx);
  } catch (err) {
    secondQueryJobs = err;
  } finally {
    console.error = origError;
  }
  if (
    Array.isArray(secondQueryJobs) &&
    secondQueryJobs.length === 50 &&
    secondQueryJobs.wttjTruncated === 'transient' &&
    secondWarnings.some((w) => w.includes('fixture query b down'))
  ) {
    pass('wttj.fetch() keeps the first query when a later query fails on its first page and flags transient truncation');
  } else {
    fail(`wttj.fetch() second-query error → ${Array.isArray(secondQueryJobs) ? `${secondQueryJobs.length} jobs, truncated=${secondQueryJobs.wttjTruncated}` : `threw ${secondQueryJobs && secondQueryJobs.message}`}`);
  }

  const probe = mkCtx(ENV_OK, boardOf(500));
  const probeJobs = await wttj.fetch(
    { name: 'WTTJ', provider: 'wttj', wttj: { queries: ['x'], max_hits: 200 } },
    { ...probe.ctx, maxPages: 1 },
  );
  if (probeJobs.length === 100 && probe.jsonCalls.length === 1 && probeJobs.wttjTruncated === undefined) {
    pass('wttj.fetch() honours ctx.maxPages as a probe limit without flagging truncation');
  } else {
    fail(`wttj.fetch() ctx.maxPages=1 → ${probeJobs.length} jobs, ${probe.jsonCalls.length} pages, truncated=${probeJobs.wttjTruncated}`);
  }

  let noQueriesErr = '';
  try {
    await wttj.fetch({ name: 'WTTJ', provider: 'wttj' }, mkCtx(ENV_OK, () => ({ hits: [] })).ctx);
  } catch (err) { noQueriesErr = err.message; }
  // Assert the message, not just that something threw — an unrelated crash must not pass.
  if (noQueriesErr.includes('wttj: the WTTJ board is global')) {
    pass('wttj.fetch() throws with neither wttj.queries nor wttj.filters (never scans the whole board)');
  } else {
    fail(`wttj.fetch() missing-queries error = ${JSON.stringify(noQueriesErr) || 'did not throw'}`);
  }

  // --- Server-side filters (#wttj-filters) -------------------------------
  // A keyword query cannot narrow a global board: Algolia's relevance ranking
  // picks which max_hits results come back, and the scanner's own title/location
  // filters only run on what already arrived. `filters` shrinks the result set
  // server-side instead, which is what makes a scan exhaustive.
  const FILTER = 'offices.country_code:FR AND contract_type:full_time';

  const filtered = mkCtx(ENV_OK, () => ({ hits: [mkHit('job-f', 'Product Manager')] }));
  const filteredJobs = await wttj.fetch(
    { name: 'WTTJ', provider: 'wttj', wttj: { filters: FILTER } },
    filtered.ctx,
  );
  if (filtered.jsonCalls.length === 1 && filtered.jsonCalls[0].filters === FILTER && filteredJobs.length === 1) {
    pass('wttj.fetch() passes wttj.filters through to Algolia');
  } else {
    fail(`wttj.fetch() filters = ${JSON.stringify(filtered.jsonCalls.map((c) => c.filters))}`);
  }

  // filters alone → the empty query means "everything that passes the filter".
  if (filtered.jsonCalls[0].query === '') {
    pass('wttj.fetch() uses the empty query when only filters are configured');
  } else {
    fail(`wttj.fetch() filters-only query = ${JSON.stringify(filtered.jsonCalls[0].query)}`);
  }

  // filters + queries → the filter applies to every query, not just the first.
  const both = mkCtx(ENV_OK, () => ({ hits: [] }));
  await wttj.fetch(
    { name: 'WTTJ', provider: 'wttj', wttj: { filters: FILTER, queries: ['a', 'b'] } },
    both.ctx,
  );
  if (both.jsonCalls.length === 2 && both.jsonCalls.every((c) => c.filters === FILTER)
      && both.jsonCalls.map((c) => c.query).join(',') === 'a,b') {
    pass('wttj.fetch() applies wttj.filters to every configured query');
  } else {
    fail(`wttj.fetch() filters+queries = ${JSON.stringify(both.jsonCalls.map((c) => [c.query, c.filters]))}`);
  }

  // No filters → the 200 cap stands (an unfiltered query can match the whole board).
  const unfilteredCap = mkCtx(ENV_OK, boardOf(5000));
  const unfilteredJobs = await wttj.fetch({ name: 'WTTJ', provider: 'wttj', wttj: { queries: ['x'], max_hits: 5000 } }, unfilteredCap.ctx);
  if (unfilteredJobs.length === 200) {
    pass('wttj.fetch() still caps the max_hits budget at 200 when no filters are configured');
  } else {
    fail(`wttj.fetch() unfiltered max_hits=5000 → ${unfilteredJobs.length} jobs`);
  }

  // With filters → the budget rises to 1000 hits, read across pages.
  const filteredCap = mkCtx(ENV_OK, boardOf(5000));
  const filteredCapJobs = await wttj.fetch(
    { name: 'WTTJ', provider: 'wttj', wttj: { filters: FILTER, max_hits: 5000 } },
    filteredCap.ctx,
  );
  if (filteredCapJobs.length === 1000 && filteredCap.jsonCalls.length === 10) {
    pass('wttj.fetch() raises the max_hits budget to 1000 when filters narrow the board');
  } else {
    fail(`wttj.fetch() filtered max_hits=5000 → ${filteredCapJobs.length} jobs from ${filteredCap.jsonCalls.length} pages`);
  }

  // A blank/whitespace filters value must not silently unlock the higher cap.
  const blankFilter = mkCtx(ENV_OK, boardOf(5000));
  const blankFilterJobs = await wttj.fetch(
    { name: 'WTTJ', provider: 'wttj', wttj: { filters: '   ', queries: ['x'], max_hits: 5000 } },
    blankFilter.ctx,
  );
  if (blankFilterJobs.length === 200 && blankFilter.jsonCalls[0].filters === null) {
    pass('wttj.fetch() treats a blank wttj.filters as absent (budget stays 200, no filters param sent)');
  } else {
    fail(`wttj.fetch() blank filters → ${blankFilterJobs.length} jobs, filters=${JSON.stringify(blankFilter.jsonCalls[0].filters)}`);
  }

  let longFilterErr = '';
  try {
    await wttj.fetch(
      { name: 'WTTJ', provider: 'wttj', wttj: { filters: 'a'.repeat(1001) } },
      mkCtx(ENV_OK, () => ({ hits: [] })).ctx,
    );
  } catch (err) { longFilterErr = err.message; }
  if (longFilterErr.includes('wttj: `filters` is too long')) {
    pass('wttj.fetch() rejects an over-long filters expression');
  } else {
    fail(`wttj.fetch() long-filters error = ${JSON.stringify(longFilterErr) || 'did not throw'}`);
  }

  let badShapeErr = '';
  try {
    await wttj.fetch(
      { name: 'WTTJ', provider: 'wttj', wttj: { queries: ['x'] } },
      mkCtx(ENV_OK, () => ({ error: 'nope' })).ctx,
    );
  } catch (err) { badShapeErr = err.message; }
  if (badShapeErr.includes('wttj: unexpected Algolia response') && badShapeErr.includes('expected { hits: [...] }')) {
    pass('wttj.fetch() throws on an Algolia response without a hits array');
  } else {
    fail(`wttj.fetch() malformed-response error = ${JSON.stringify(badShapeErr) || 'did not throw'}`);
  }
} catch (e) {
  fail(`wttj provider tests crashed: ${e.message}`);
}
