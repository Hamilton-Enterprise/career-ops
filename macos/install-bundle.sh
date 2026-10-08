#!/bin/bash
set -euo pipefail

usage() { printf '%s\n' 'Uso: install-bundle.sh BUNDLE DESTINO PASTA_DA_VERSÃO_ANTERIOR'; }
(($# == 3)) || { usage >&2; exit 2; }
bundle="$1"
destination="$2"
previous_dir="$3"
identifier=io.career-ops.local

[[ -d "$bundle" ]] || { printf '%s\n' 'A aplicação compilada não existe.' >&2; exit 2; }
[[ "$destination" == /* && "$destination" == *.app && ! -L "$destination" ]] || {
    printf '%s\n' 'O destino deve ser um caminho absoluto terminado em .app, sem ligação simbólica.' >&2; exit 2;
}
[[ "$previous_dir" == /* && "$previous_dir" != */.Trash && "$previous_dir" != */.Trash/* ]] || {
    printf '%s\n' 'A pasta da versão anterior deve ser um caminho absoluto fora do Lixo.' >&2; exit 2;
}

bundle_identifier() { /usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$1/Contents/Info.plist" 2>/dev/null; }
verify_bundle() {
    local app="$1" executable
    codesign --verify --deep --strict "$app" 2>/dev/null || return 1
    plutil -lint -s "$app/Contents/Info.plist" >/dev/null || return 1
    executable="$(/usr/libexec/PlistBuddy -c 'Print CFBundleExecutable' "$app/Contents/Info.plist" 2>/dev/null)" || return 1
    [[ -n "$executable" && -f "$app/Contents/MacOS/$executable" && -x "$app/Contents/MacOS/$executable" ]] || return 1
    [[ "$(bundle_identifier "$app")" == "$identifier" ]]
}
# mv into an existing directory would nest the bundle instead of replacing it.
rename() { [[ ! -e "$2" && ! -L "$2" ]] && /bin/mv -- "$1" "$2"; }

if [[ -e "$destination" ]]; then
    [[ -d "$destination" && "$(bundle_identifier "$destination")" == "$identifier" ]] || {
        printf '%s\n' 'O destino já existe e não é a aplicação Career Ops.' >&2; exit 2;
    }
fi

parent="$(dirname "$destination")"
name="$(basename "$destination")"
mkdir -p "$parent"
staging="$parent/.$name.staging.$$"
held="$parent/.$name.previous.$$"
promoted=false
cleanup() {
    if ! "$promoted"; then
        if [[ -e "$held" && ! -e "$destination" ]]; then /bin/mv -- "$held" "$destination"; fi
        rm -rf -- "$staging"
    fi
}
trap cleanup EXIT

[[ ! -e "$staging" && ! -e "$held" ]] || { printf '%s\n' 'Já existe uma instalação a decorrer para este destino.' >&2; exit 1; }
cp -R "$bundle" "$staging"
verify_bundle "$staging" || {
    printf '%s\n' 'A nova versão não passou na verificação (assinatura, Info.plist, executável ou identificador). A aplicação instalada ficou como estava.' >&2
    exit 1
}

if [[ -e "$destination" ]]; then rename "$destination" "$held"; fi
if [[ "${CAREER_OPS_INSTALL_FAIL_PROMOTE:-}" == 1 ]] || ! rename "$staging" "$destination"; then
    if [[ -e "$held" ]]; then
        rename "$held" "$destination" && printf 'Não foi possível pôr a nova versão no lugar. A versão anterior foi reposta em %s.\n' "$destination" >&2
    else
        printf '%s\n' 'Não foi possível pôr a nova versão no lugar. Nada foi alterado.' >&2
    fi
    exit 1
fi
if ! verify_bundle "$destination"; then
    rename "$destination" "$staging" || true
    printf 'A versão instalada não passou na verificação final. A versão anterior foi reposta em %s.\n' "$destination" >&2
    exit 1
fi
promoted=true
printf 'Aplicação instalada: %s\n' "$destination"

[[ -e "$held" ]] || exit 0
previous="$previous_dir/$name"
incoming="$previous_dir/.$name.incoming.$$"
outgoing="$previous_dir/.$name.outgoing.$$"
if mkdir -p "$previous_dir" && rename "$held" "$incoming" \
    && { [[ ! -e "$previous" ]] || rename "$previous" "$outgoing"; } \
    && rename "$incoming" "$previous"; then
    rm -rf -- "$outgoing"
    printf 'Versão anterior guardada em: %s\n' "$previous"
else
    [[ -e "$previous" || ! -e "$outgoing" ]] || /bin/mv -- "$outgoing" "$previous"
    kept="$held"
    [[ -e "$held" ]] || kept="$incoming"
    printf 'A nova versão ficou instalada, mas não foi possível guardar a anterior em %s. Continua disponível em: %s\n' "$previous" "$kept" >&2
fi
