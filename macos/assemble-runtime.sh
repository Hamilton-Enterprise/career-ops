#!/bin/bash
set -euo pipefail

usage() { printf '%s\n' 'Uso: assemble-runtime.sh PASTA_DO_PROJETO PASTA_DOS_RUNTIMES'; }
(($# == 2)) || { usage >&2; exit 2; }
script_dir="$(cd "$(dirname "$0")" && pwd -P)"
runtime_dir="$2"
refuse() { printf '%s\n' "$1" >&2; exit 2; }

[[ "$runtime_dir" == /* ]] || refuse 'A pasta dos runtimes deve ser um caminho absoluto.'
[[ -d "$1" ]] || refuse 'A pasta do projeto não existe.'
checkout="$(cd "$1" && pwd -P)"
sha="$("$script_dir/build-identity.sh" "$checkout")"
git -C "$checkout" diff --quiet HEAD -- || refuse "O projeto tem alterações por guardar em ficheiros versionados; o runtime tem de corresponder ao commit ${sha:0:12}. Faça commit ou descarte-as e compile de novo."
for deps in node_modules web/node_modules; do
    [[ -d "$checkout/$deps" ]] || refuse "Faltam as dependências em $checkout/$deps. Execute npm install antes de instalar."
done

target="$runtime_dir/$sha"
identity_sha() { plutil -extract CAREER_OPS_BUILD_SHA raw -o - "$1/web/.next/career-ops-identity.json" 2>/dev/null || true; }
usable() {
    [[ -d "$1" && ! -L "$1" && ! -e "$1/.git" && -f "$1/web/server.mjs" && -f "$1/web/.next/BUILD_ID" ]] \
        && [[ "$(identity_sha "$1")" == "$sha" ]]
}
if [[ -e "$target" || -L "$target" ]]; then
    usable "$target" || refuse "Já existe $target e não corresponde ao commit ${sha:0:12}. Não foi alterado; retire-o à mão se for seguro."
    printf '%s\n' "$target"
    exit 0
fi

mkdir -p "$runtime_dir"
staging="$runtime_dir/.staging.$sha.$$"
trap '[[ -e "$staging" ]] && { chmod -R u+w "$staging"; rm -rf -- "$staging"; }' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir "$staging"

# User-layer directories (DATA_CONTRACT.md) only hold placeholders in git; leaving them out
# makes a stray write against the code root fail instead of landing inside the artifact.
git -C "$checkout" archive --format=tar HEAD -- . \
    ':(exclude)data' ':(exclude)reports' ':(exclude)output' ':(exclude)jds' \
    ':(exclude)interview-prep' ':(exclude)documents' ':(exclude)writing-samples' \
    | tar -x -C "$staging"
for private in cv.md article-digest.md portals.yml config/profile.yml modes/_profile.md modes/_custom.md \
    voice-dna.md .career-ops-data .env; do
    [[ ! -e "$staging/$private" ]] || refuse "O commit ${sha:0:12} tem $private versionado; o runtime não pode levar dados pessoais."
done

clone() { cp -cR "$1" "$2" 2>/dev/null || { rm -rf -- "$2"; cp -R "$1" "$2"; }; }
clone "$(cd "$checkout/web/.next" && pwd -P)" "$staging/web/.next"
rm -rf -- "$staging/web/.next/cache"
for deps in node_modules web/node_modules; do clone "$(cd "$checkout/$deps" && pwd -P)" "$staging/$deps"; done
find "$staging" -name .git -prune -exec rm -rf -- {} +

[[ -z "$(find "$staging" -name .git -print -quit)" ]] || refuse 'Ficou um .git dentro do runtime.'
outside="$(find "$staging" -type l -lname '/*' -print -quit)"
[[ -z "$outside" ]] || refuse "As dependências têm uma ligação absoluta (${outside#"$staging"/}); o runtime não pode depender de pastas de fora."
usable "$staging" || refuse 'O runtime preparado não tem o launcher, a compilação web ou a identidade esperada.'

mkdir "$staging/web/.next/cache"
chmod -R a-w "$staging"
chmod u+w "$staging/web/.next" "$staging/web/.next/cache"
if [[ ! -e "$target" ]] && /bin/mv -- "$staging" "$target"; then
    printf '%s\n' "$target"
    exit 0
fi
usable "$target" || refuse "Não foi possível pôr o runtime em $target."
printf '%s\n' "$target"
