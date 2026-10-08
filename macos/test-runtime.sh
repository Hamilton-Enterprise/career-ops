#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd -P)"
assembler="$script_dir/assemble-runtime.sh"
root="$(mktemp -d)"
trap 'chmod -R u+w "$root" 2>/dev/null; rm -rf -- "$root"' EXIT
failures=0

check() {
    if [[ "$2" == "$3" ]]; then printf 'ok - %s\n' "$1"; else printf 'not ok - %s (esperado %s, obtido %s)\n' "$1" "$3" "$2"; failures=$((failures + 1)); fi
}
count() { find "$@" 2>/dev/null | wc -l | tr -d ' '; }
git_in() { git -C "$checkout" -c user.name=test -c user.email=test@example.invalid -c commit.gpgsign=false "$@"; }
write_identity() {
    printf '{"CAREER_OPS_BUILD_SHA":"%s","CAREER_OPS_BUILD_SHORT_SHA":"%s","CAREER_OPS_BUILD_VERSION":"1.35.0","CAREER_OPS_BUILD_WEB_VERSION":"0.13.0"}\n' \
        "$1" "${1:0:7}" > "$checkout/web/.next/career-ops-identity.json"
}

# A checkout shaped like a worktree: root node_modules is a symlink to a shared install,
# web/node_modules is a real directory, and user data sits untracked next to the code.
fixture() {
    case_dir="$root/$1"
    checkout="$case_dir/checkout"
    runtime_dir="$case_dir/artifacts/runtime"
    mkdir -p "$checkout/web/src" "$checkout/data" "$checkout/reports" "$checkout/config" "$checkout/modes"
    printf 'console.log("server")\n' > "$checkout/web/server.mjs"
    printf 'export const x = 1;\n' > "$checkout/web/src/page.mjs"
    printf 'console.log("doctor")\n' > "$checkout/doctor.mjs"
    printf '# shared\n' > "$checkout/modes/_shared.md"
    printf 'example: true\n' > "$checkout/config/profile.example.yml"
    touch "$checkout/data/.gitkeep" "$checkout/reports/.gitkeep"
    printf 'node_modules\nweb/node_modules\nweb/.next\n/data/*\n!/data/.gitkeep\n/reports/*\n!/reports/.gitkeep\ncv.md\nconfig/profile.yml\n.career-ops-data\n' > "$checkout/.gitignore"
    git -C "$checkout" init -q
    git_in add -A
    git_in commit -q -m init
    head="$(git -C "$checkout" rev-parse HEAD)"
    printf 'private cv\n' > "$checkout/cv.md"
    printf 'name: private\n' > "$checkout/config/profile.yml"
    printf 'pipeline\n' > "$checkout/data/pipeline.md"
    printf 'report\n' > "$checkout/reports/001-private.md"
    printf '/elsewhere\n' > "$checkout/.career-ops-data"
    shared="$case_dir/shared/node_modules"
    mkdir -p "$shared/js-yaml/.git" "$shared/.bin"
    printf 'module.exports = 1;\n' > "$shared/js-yaml/index.js"
    ln -s ../js-yaml/index.js "$shared/.bin/js-yaml"
    ln -s "$shared" "$checkout/node_modules"
    mkdir -p "$checkout/web/node_modules/next" "$checkout/web/.next/cache/images" "$checkout/web/.next/server"
    printf 'module.exports = 2;\n' > "$checkout/web/node_modules/next/index.js"
    printf 'build-one\n' > "$checkout/web/.next/BUILD_ID"
    printf 'cached\n' > "$checkout/web/.next/cache/images/a"
    printf 'chunk\n' > "$checkout/web/.next/server/chunk.js"
    write_identity "$head"
}
run() { status=0; "$assembler" "$checkout" "$runtime_dir" > "$case_dir/out" 2> "$case_dir/err" || status=$?; }
staging_left() { count "$runtime_dir" -mindepth 1 -maxdepth 1 -name '.*'; }

fixture success
run
artifact="$runtime_dir/$head"
check "sucesso: termina sem erro" "$status" 0
check "sucesso: indica o caminho do artefacto" "$(cat "$case_dir/out")" "$artifact"
check "sucesso: código versionado presente" "$(cat "$artifact/doctor.mjs" 2>/dev/null)" 'console.log("doctor")'
check "sucesso: launcher web presente" "$(test -f "$artifact/web/server.mjs" && echo yes)" yes
check "sucesso: compilação web presente" "$(cat "$artifact/web/.next/BUILD_ID" 2>/dev/null)" build-one
check "sucesso: identidade presente" "$(plutil -extract CAREER_OPS_BUILD_SHA raw -o - "$artifact/web/.next/career-ops-identity.json" 2>/dev/null)" "$head"
check "sucesso: cache web excluída" "$(count "$artifact/web/.next/cache" -type f)" 0
check "sucesso: dependências da raiz copiadas, não ligadas" "$(test -d "$artifact/node_modules" && ! test -L "$artifact/node_modules" && cat "$artifact/node_modules/js-yaml/index.js")" 'module.exports = 1;'
check "sucesso: dependências web copiadas" "$(cat "$artifact/web/node_modules/next/index.js" 2>/dev/null)" 'module.exports = 2;'
check "sucesso: ligação relativa .bin conservada" "$(readlink "$artifact/node_modules/.bin/js-yaml")" ../js-yaml/index.js
check "sucesso: nenhum .git dentro do artefacto" "$(count "$artifact" -name .git)" 0
for private in data reports cv.md config/profile.yml .career-ops-data; do
    check "sucesso: sem $private" "$(test -e "$artifact/$private" && echo present || echo absent)" absent
done
check "sucesso: modelos do sistema presentes" "$(test -f "$artifact/config/profile.example.yml" && echo yes)" yes
check "sucesso: ficheiros só de leitura" "$(test -w "$artifact/doctor.mjs" && echo writable || echo read-only)" read-only
check "sucesso: pasta do código só de leitura" "$(test -w "$artifact" && echo writable || echo read-only)" read-only
check "sucesso: cache web gravável" "$(test -w "$artifact/web/.next/cache" && echo writable)" writable
check "sucesso: sem staging" "$(staging_left)" 0
check "sucesso: dados do checkout intactos" "$(cat "$checkout/cv.md")" 'private cv'
check "sucesso: instalação partilhada intacta" "$(test -d "$shared/js-yaml/.git" && test -L "$checkout/node_modules" && echo intact)" intact

inode="$(stat -f %i "$artifact")"
printf 'build-two\n' > "$checkout/web/.next/BUILD_ID"
run
check "repetição: reutiliza o artefacto do mesmo commit" "$status" 0
check "repetição: mesmo caminho" "$(cat "$case_dir/out")" "$artifact"
check "repetição: não substitui" "$(stat -f %i "$artifact"):$(cat "$artifact/web/.next/BUILD_ID")" "$inode:build-one"
check "repetição: sem staging" "$(staging_left)" 0

fixture foreign
mkdir -p "$runtime_dir/$head/web/.next"
printf '{"CAREER_OPS_BUILD_SHA":"%s"}\n' "$(printf 'b%.0s' {1..40})" > "$runtime_dir/$head/web/.next/career-ops-identity.json"
printf 'foreign\n' > "$runtime_dir/$head/keep.txt"
run
check "artefacto alheio: recusado" "$status" 2
check "artefacto alheio: intacto" "$(cat "$runtime_dir/$head/keep.txt")" foreign
check "artefacto alheio: mensagem em português" "$(grep -c 'não corresponde' "$case_dir/err")" 1
check "artefacto alheio: sem staging" "$(staging_left)" 0

fixture mismatch
write_identity "$(printf 'c%.0s' {1..40})"
run
check "compilação de outro commit: recusada" "$status" 2
check "compilação de outro commit: nada criado" "$(count "$runtime_dir" -mindepth 1)" 0

fixture dirty
printf 'console.log("edited")\n' > "$checkout/doctor.mjs"
run
check "alterações por guardar: recusado" "$status" 2
check "alterações por guardar: mensagem em português" "$(grep -c 'alterações por guardar' "$case_dir/err")" 1
check "alterações por guardar: nada criado" "$(count "$runtime_dir" -mindepth 1)" 0

fixture tracked-private
git_in add -f cv.md
git_in commit -q -m "track cv"
head="$(git -C "$checkout" rev-parse HEAD)"
write_identity "$head"
run
check "dados pessoais versionados: recusado" "$status" 2
check "dados pessoais versionados: mensagem indica o ficheiro" "$(grep -c 'cv.md' "$case_dir/err")" 1
check "dados pessoais versionados: nada criado" "$(count "$runtime_dir" -mindepth 1)" 0

fixture absolute-link
ln -s /usr/bin/true "$shared/.bin/outside"
run
check "ligação absoluta nas dependências: recusada" "$status" 2
check "ligação absoluta nas dependências: sem staging" "$(staging_left)" 0
check "ligação absoluta nas dependências: sem artefacto" "$(test -e "$runtime_dir/$head" && echo present || echo absent)" absent

fixture no-web-deps
rm -rf "$checkout/web/node_modules"
run
check "sem dependências web: recusado" "$status" 2
check "sem dependências web: sem artefacto" "$(test -e "$runtime_dir/$head" && echo present || echo absent)" absent

fixture relative-dir
status=0; "$assembler" "$checkout" relative/runtime > "$case_dir/out" 2> "$case_dir/err" || status=$?
check "pasta relativa: recusada" "$status" 2

if ((failures)); then printf '%s falha(s) no runtime\n' "$failures" >&2; exit 1; fi
