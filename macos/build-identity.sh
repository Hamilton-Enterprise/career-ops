#!/bin/bash
set -euo pipefail

usage() { printf '%s\n' 'Uso: build-identity.sh PASTA_DO_PROJETO [INFO_PLIST]'; }
(($# == 1 || $# == 2)) || { usage >&2; exit 2; }
checkout="$1"
plist="${2:-}"
identity="$checkout/web/.next/career-ops-identity.json"

[[ -f "$identity" ]] || {
    printf '%s\n' 'Falta a identidade da compilação web. Execute npm run build em web/.' >&2; exit 2;
}
field() { plutil -extract "$1" raw -o - "$identity" 2>/dev/null || true; }
build_sha="$(field CAREER_OPS_BUILD_SHA)"
build_version="$(field CAREER_OPS_BUILD_VERSION)"
head="$(git -C "$checkout" rev-parse HEAD 2>/dev/null || true)"
[[ -n "$build_sha" ]] || {
    printf '%s\n' 'A compilação web não registou o commit. Execute npm run build em web/ dentro do repositório git.' >&2; exit 2;
}
[[ "$build_sha" == "$head" ]] || {
    printf 'A compilação web foi feita noutro commit (%s); o projeto está em %s. Execute npm run build em web/ antes de instalar.\n' \
        "${build_sha:0:12}" "${head:0:12}" >&2
    exit 2
}
if [[ -n "$plist" ]]; then
    plutil -insert CareerOpsBuildSHA -string "$build_sha" "$plist"
    plutil -insert CareerOpsBuildVersion -string "$build_version" "$plist"
fi
printf '%s\n' "$build_sha"
