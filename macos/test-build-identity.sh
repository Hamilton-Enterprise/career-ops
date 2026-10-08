#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd -P)"
reader="$script_dir/build-identity.sh"
root="$(mktemp -d)"
trap 'rm -rf -- "$root"' EXIT
failures=0

check() {
    if [[ "$2" == "$3" ]]; then printf 'ok - %s\n' "$1"; else printf 'not ok - %s (esperado %s, obtido %s)\n' "$1" "$3" "$2"; failures=$((failures + 1)); fi
}
fake_checkout() {
    checkout="$root/$1"
    mkdir -p "$checkout/web/.next"
    git -C "$checkout" init -q
    git -C "$checkout" -c user.name=test -c user.email=test@example.invalid -c commit.gpgsign=false commit -q --allow-empty -m init
    head="$(git -C "$checkout" rev-parse HEAD)"
    plist="$root/$1.plist"
    plutil -create xml1 "$plist"
}
write_identity() {
    printf '{"CAREER_OPS_BUILD_SHA":"%s","CAREER_OPS_BUILD_SHORT_SHA":"%s","CAREER_OPS_BUILD_VERSION":"1.35.0","CAREER_OPS_BUILD_WEB_VERSION":"0.13.0"}\n' \
        "$1" "${1:0:7}" > "$checkout/web/.next/career-ops-identity.json"
}
key() { /usr/libexec/PlistBuddy -c "Print $1" "$plist" 2>/dev/null || printf 'missing'; }

fake_checkout match
write_identity "$head"
status=0; "$reader" "$checkout" "$plist" > "$root/out" 2>&1 || status=$?
check "mesmo commit: aceite" "$status" 0
check "mesmo commit: SHA no bundle" "$(key CareerOpsBuildSHA)" "$head"
check "mesmo commit: versão no bundle" "$(key CareerOpsBuildVersion)" 1.35.0

fake_checkout mismatch
write_identity "$(printf 'a%.0s' {1..40})"
status=0; "$reader" "$checkout" "$plist" > "$root/out" 2>&1 || status=$?
check "commit diferente: recusado" "$status" 2
check "commit diferente: bundle sem SHA" "$(key CareerOpsBuildSHA)" missing
check "commit diferente: mensagem em português" "$(grep -c 'noutro commit' "$root/out")" 1

fake_checkout missing
status=0; "$reader" "$checkout" "$plist" > "$root/out" 2>&1 || status=$?
check "sem ficheiro de identidade: recusado" "$status" 2
check "sem ficheiro de identidade: mensagem em português" "$(grep -c 'npm run build' "$root/out")" 1

fake_checkout no-git-at-build
write_identity ""
status=0; "$reader" "$checkout" "$plist" > "$root/out" 2>&1 || status=$?
check "compilação sem SHA: recusada" "$status" 2

if ((failures)); then printf '%s falha(s) na identidade da compilação.\n' "$failures" >&2; exit 1; fi
printf '%s\n' 'Identidade da compilação: todos os cenários passaram.'
