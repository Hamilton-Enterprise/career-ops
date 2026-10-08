#!/bin/bash
set -euo pipefail

# Runs the core commands the app reaches from an assembled runtime, against a synthetic
# data root, with outbound network denied, and checks the runtime was not written to.
usage() { printf '%s\n' 'Uso: smoke-runtime.sh PASTA_DO_RUNTIME [NODE]'; }
(($# == 1 || $# == 2)) || { usage >&2; exit 2; }
runtime="$(cd "$1" && pwd -P)"
node="${2:-$(command -v node)}"
data="$(mktemp -d)"
trap 'rm -rf -- "$data"' EXIT
failures=0
check() {
    if [[ "$2" == "$3" ]]; then printf 'ok - %s\n' "$1"; else printf 'not ok - %s (esperado %s, obtido %s)\n' "$1" "$3" "$2"; failures=$((failures + 1)); fi
}
offline() {
    (cd "$runtime" && CAREER_OPS_ROOT="$data" CAREER_OPS_CODE_ROOT="$runtime" \
        sandbox-exec -p '(version 1)(allow default)(deny network-outbound (remote ip))' "$node" "$@")
}

for required in web/server.mjs web/.next/BUILD_ID web/.next/career-ops-identity.json web/scripts/scheduled-jobs-runner.mjs \
    templates/states.yml templates/portals.example.yml modes/web-search.md modes/_shared.md \
    doctor.mjs set-status.mjs scan.mjs scan-ats-full.mjs tracker.mjs tracker-utils.mjs pipeline-lock.mjs \
    followup-seed.mjs followup-cadence.mjs verify-portals.mjs path-resolver.mjs \
    node_modules/js-yaml/package.json web/node_modules/next/package.json; do
    check "presente: $required" "$(test -f "$runtime/$required" && echo yes)" yes
done
check "sem .git" "$(find "$runtime" -name .git -print -quit)" ""
for private in data reports output jds cv.md config/profile.yml portals.yml modes/_profile.md .career-ops-data; do
    check "sem $private" "$(test -e "$runtime/$private" && echo present || echo absent)" absent
done

touch "$data/.before"
sleep 1
mkdir -p "$data/data"
printf '%s\n' '# Applications Tracker' '' \
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |' \
    '|---|------|---------|------|-------|--------|-----|--------|-------|' \
    '| 1 | 2026-01-01 | Exemplo Lda | Engenheira de Teste | 4.0/5 | Evaluated | ❌ | — | sintético |' > "$data/data/applications.md"
printf '%s\n' 'tracked_companies: []' 'title_filter:' '  positive: ["Engineer"]' > "$data/portals.yml"

status=0; offline doctor.mjs --json > "$data/doctor.json" 2> "$data/doctor.err" || status=$?
check "doctor --json responde em JSON" "$("$node" -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log("json")' "$data/doctor.json" 2>/dev/null)" json
status=0; offline set-status.mjs 1 Applied --note "smoke" > "$data/set-status.out" 2>&1 || status=$?
check "set-status termina sem erro" "$status" 0
check "set-status muda o tracker sintético" "$(grep -c '| Applied |' "$data/data/applications.md")" 1
status=0; offline scan.mjs --dry-run --json > "$data/scan.json" 2> "$data/scan.err" || status=$?
check "scan sem rede termina sem erro" "$status" 0
check "scan devolve um recibo" "$("$node" -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(typeof r === "object" ? "receipt" : "")' "$data/scan.json" 2>/dev/null)" receipt
status=0; offline --input-type=module -e "for (const m of ['tracker-utils.mjs', 'pipeline-lock.mjs', 'path-resolver.mjs', 'web/src/lib/market-presets.mjs', 'web/src/lib/core/market-merge.mjs']) await import(new URL(m, 'file://$runtime/'))" \
    > "$data/imports.out" 2>&1 || status=$?
check "importações dinâmicas resolvem" "$status" 0

written="$(find "$runtime" -newer "$data/.before" ! -path "$runtime/web/.next/cache*" -print | head -5)"
check "runtime não foi alterado" "$written" ""
if ((failures)); then
    printf '%s falha(s); registos em %s\n' "$failures" "$data" >&2
    trap - EXIT
    exit 1
fi
