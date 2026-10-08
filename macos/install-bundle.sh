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
# The previous-version folder may not exist yet: resolve its deepest existing
# ancestor so a symlink cannot smuggle it into a Trash folder.
resolve_path() {
    local path="$1" rest=""
    while [[ ! -d "$path" ]]; do rest="/$(basename "$path")$rest"; path="$(dirname "$path")"; done
    printf '%s%s' "$(cd "$path" && pwd -P)" "$rest"
}
trash_or_relative() {
    # APFS is usually case-insensitive, so .TRASH is the same folder as .Trash.
    case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
        */../*|*/..|*/.trash|*/.trash/*|*/.trashes|*/.trashes/*) return 0 ;;
        /*) return 1 ;;
        *) return 0 ;;
    esac
}
if trash_or_relative "$previous_dir" || trash_or_relative "$(resolve_path "$previous_dir")"; then
    printf '%s\n' 'A pasta da versão anterior deve ser um caminho absoluto fora do Lixo.' >&2; exit 2
fi

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

check_destination() {
    [[ ! -e "$destination" ]] || [[ -d "$destination" && "$(bundle_identifier "$destination")" == "$identifier" ]] || {
        printf '%s\n' 'O destino já existe e não é a aplicação Career Ops.' >&2; exit 2;
    }
}
check_destination

parent="$(dirname "$destination")"
name="$(basename "$destination")"
mkdir -p "$parent"
staging="$parent/.$name.staging.$$"
held="$parent/.$name.previous.$$"
lock="$parent/.$name.install.lock"
locked=false
promoted=false
copy_pid=""
cleanup() {
    if [[ -n "$copy_pid" ]] && kill -0 "$copy_pid" 2>/dev/null; then
        kill "$copy_pid" 2>/dev/null || true
        wait "$copy_pid" 2>/dev/null || true
    fi
    if ! "$promoted"; then
        if [[ -e "$held" && ! -e "$destination" ]]; then /bin/mv -- "$held" "$destination"; fi
        rm -rf -- "$staging"
    fi
    if "$locked"; then rm -f -- "$lock/pid"; rmdir -- "$lock"; fi
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

acquire_lock() {
    mkdir -- "$lock" 2>/dev/null || return 1
    locked=true
    printf '%s\n' "$$" > "$lock/pid"
}
# Only a lock whose recorded owner is gone is recovered; a missing pid file may
# belong to a run that has not written it yet.
recover_stale_lock() {
    local owner
    owner="$(cat "$lock/pid" 2>/dev/null || true)"
    [[ "$owner" =~ ^[0-9]+$ ]] && ! kill -0 "$owner" 2>/dev/null || return 1
    printf 'Encontrada uma instalação interrompida (processo %s). A recuperar antes de continuar.\n' "$owner"
    rm -rf -- "$parent/.$name.staging.$owner"
    if [[ -e "$parent/.$name.previous.$owner" ]]; then
        if [[ ! -e "$destination" ]] && rename "$parent/.$name.previous.$owner" "$destination"; then
            printf 'A versão anterior foi reposta em %s.\n' "$destination"
        else
            printf 'Ficou uma cópia da versão anterior em %s.\n' "$parent/.$name.previous.$owner"
        fi
    fi
    rm -f -- "$lock/pid"
    rmdir -- "$lock" 2>/dev/null
}
acquire_lock || { recover_stale_lock && acquire_lock; } || {
    printf 'Já está a decorrer outra instalação para este destino. Se não estiver, apague a pasta %s e tente de novo.\n' "$lock" >&2
    exit 1
}
check_destination
# A background copy lets the TERM trap run at once and stop it before cleanup.
cp -R "$bundle" "$staging" &
copy_pid=$!
wait "$copy_pid"
copy_pid=""
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
if [[ "${CAREER_OPS_INSTALL_FAIL_FINAL_CHECK:-}" == 1 ]] || ! verify_bundle "$destination"; then
    if ! rename "$destination" "$staging"; then
        printf 'A versão instalada não passou na verificação final e não foi possível retirá-la de %s.\n' "$destination" >&2
    elif [[ ! -e "$held" ]]; then
        printf 'A versão instalada não passou na verificação final e foi retirada. Não havia versão anterior, por isso não ficou nenhuma aplicação em %s.\n' "$destination" >&2
    elif rename "$held" "$destination"; then
        printf 'A versão instalada não passou na verificação final e foi retirada. A versão anterior foi reposta em %s.\n' "$destination" >&2
    else
        printf 'A versão instalada não passou na verificação final e foi retirada. A versão anterior continua em %s.\n' "$held" >&2
    fi
    exit 1
fi
promoted=true
printf 'Aplicação instalada: %s\n' "$destination"

[[ -e "$held" ]] || exit 0
# Without the .app extension the kept copy is not a bundle LaunchServices can open.
previous="$previous_dir/$name.previous"
incoming="$previous_dir/.$name.incoming.$$"
outgoing="$previous_dir/.$name.outgoing.$$"
if mkdir -p "$previous_dir" && rename "$held" "$incoming" \
    && { [[ ! -e "$previous" ]] || rename "$previous" "$outgoing"; } \
    && rename "$incoming" "$previous"; then
    rm -rf -- "$outgoing"
    printf 'Versão anterior guardada em: %s\n' "$previous"
    printf 'Para repor a versão anterior: mv %q %q && mv %q %q\n' \
        "$destination" "$previous_dir/$name.rejected.$(date +%Y%m%d%H%M%S)" "$previous" "$destination"
else
    [[ -e "$previous" || ! -e "$outgoing" ]] || /bin/mv -- "$outgoing" "$previous"
    kept="$held"
    [[ -e "$held" ]] || kept="$incoming"
    printf 'A nova versão ficou instalada, mas não foi possível guardar a anterior em %s. Continua disponível em: %s\n' "$previous" "$kept" >&2
fi
