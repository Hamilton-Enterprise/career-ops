#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd -P)"
installer="$script_dir/install-bundle.sh"
root="$(mktemp -d)"
trap 'rm -rf -- "$root"' EXIT
failures=0

make_app() {
    local app="$1" marker="$2"
    mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
    cp "$script_dir/Info.plist" "$app/Contents/Info.plist"
    cp /usr/bin/true "$app/Contents/MacOS/CareerOps"
    printf '%s\n' "$marker" > "$app/Contents/Resources/marker.txt"
    codesign --force --sign - "$app" 2>/dev/null
}
marker() { cat "$1/Contents/Resources/marker.txt" 2>/dev/null || printf 'missing'; }
check() {
    if [[ "$2" == "$3" ]]; then printf 'ok - %s\n' "$1"; else printf 'not ok - %s (esperado %s, obtido %s)\n' "$1" "$3" "$2"; failures=$((failures + 1)); fi
}
leftovers() { find "$1" -maxdepth 1 -name '.*' ! -name . | wc -l | tr -d ' '; }

scenario() {
    case_dir="$root/$1"
    apps="$case_dir/Applications"
    previous="$case_dir/app-previous"
    destination="$apps/Career Ops.app"
    mkdir -p "$apps" "$previous"
    make_app "$case_dir/new/Career Ops.app" new
}

scenario success
make_app "$destination" old
make_app "$previous/Career Ops.app" older
"$installer" "$case_dir/new/Career Ops.app" "$destination" "$previous" > "$case_dir/out" 2>&1
check "sucesso: nova versão instalada" "$(marker "$destination")" new
check "sucesso: versão anterior guardada" "$(marker "$previous/Career Ops.app")" old
check "sucesso: só uma versão anterior" "$(find "$previous" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" 1
check "sucesso: sem restos junto ao destino" "$(leftovers "$apps")" 0
check "sucesso: destino assinado" "$(codesign --verify --deep --strict "$destination" 2>&1 && echo valid)" valid

scenario first-install
"$installer" "$case_dir/new/Career Ops.app" "$destination" "$previous" > "$case_dir/out" 2>&1
check "primeira instalação: nova versão" "$(marker "$destination")" new
check "primeira instalação: sem anterior" "$(find "$previous" -mindepth 1 | wc -l | tr -d ' ')" 0

scenario corrupt
make_app "$destination" old
make_app "$previous/Career Ops.app" older
printf 'tampered\n' >> "$case_dir/new/Career Ops.app/Contents/Resources/marker.txt"
status=0; "$installer" "$case_dir/new/Career Ops.app" "$destination" "$previous" > "$case_dir/out" 2>&1 || status=$?
check "cópia corrompida: falha" "$status" 1
check "cópia corrompida: destino intacto" "$(marker "$destination")" old
check "cópia corrompida: anterior intacta" "$(marker "$previous/Career Ops.app")" older
check "cópia corrompida: staging removido" "$(leftovers "$apps")" 0
check "cópia corrompida: erro em português" "$(grep -c 'ficou como estava' "$case_dir/out")" 1

scenario wrong-identifier
make_app "$destination" old
/usr/libexec/PlistBuddy -c 'Set CFBundleIdentifier io.example.other' "$case_dir/new/Career Ops.app/Contents/Info.plist"
codesign --force --sign - "$case_dir/new/Career Ops.app" 2>/dev/null
status=0; "$installer" "$case_dir/new/Career Ops.app" "$destination" "$previous" > "$case_dir/out" 2>&1 || status=$?
check "identificador errado: falha" "$status" 1
check "identificador errado: destino intacto" "$(marker "$destination")" old
check "identificador errado: staging removido" "$(leftovers "$apps")" 0

scenario promotion-failure
make_app "$destination" old
make_app "$previous/Career Ops.app" older
status=0; CAREER_OPS_INSTALL_FAIL_PROMOTE=1 "$installer" "$case_dir/new/Career Ops.app" "$destination" "$previous" > "$case_dir/out" 2>&1 || status=$?
check "promoção falhada: falha" "$status" 1
check "promoção falhada: anterior reposta no destino" "$(marker "$destination")" old
check "promoção falhada: anterior guardada intacta" "$(marker "$previous/Career Ops.app")" older
check "promoção falhada: sem restos" "$(leftovers "$apps")" 0
check "promoção falhada: erro em português" "$(grep -c 'versão anterior foi reposta' "$case_dir/out")" 1

scenario foreign-destination
mkdir -p "$destination/Contents"
printf 'foreign\n' > "$destination/keep.txt"
status=0; "$installer" "$case_dir/new/Career Ops.app" "$destination" "$previous" > "$case_dir/out" 2>&1 || status=$?
check "destino alheio: recusado" "$status" 2
check "destino alheio: intacto" "$(cat "$destination/keep.txt")" foreign

if ((failures)); then printf '%s falha(s) na instalação recuperável.\n' "$failures" >&2; exit 1; fi
printf '%s\n' 'Instalação recuperável: todos os cenários passaram.'
