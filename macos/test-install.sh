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
make_app "$previous/Career Ops.app.previous" older
"$installer" "$case_dir/new/Career Ops.app" "$destination" "$previous" > "$case_dir/out" 2>&1
check "sucesso: nova versão instalada" "$(marker "$destination")" new
check "sucesso: versão anterior guardada" "$(marker "$previous/Career Ops.app.previous")" old
check "sucesso: só uma versão anterior" "$(find "$previous" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" 1
check "sucesso: sem restos junto ao destino" "$(leftovers "$apps")" 0
check "sucesso: destino assinado" "$(codesign --verify --deep --strict "$destination" 2>&1 && echo valid)" valid
check "sucesso: anterior guardada sem extensão .app" "$(find "$previous" -name '*.app' | wc -l | tr -d ' ')" 0
restore="$(sed -n 's/^Para repor a versão anterior: //p' "$case_dir/out")"
eval "$restore"
check "sucesso: comando de reposição repõe a anterior" "$(marker "$destination")" old

scenario first-install
"$installer" "$case_dir/new/Career Ops.app" "$destination" "$previous" > "$case_dir/out" 2>&1
check "primeira instalação: nova versão" "$(marker "$destination")" new
check "primeira instalação: sem anterior" "$(find "$previous" -mindepth 1 | wc -l | tr -d ' ')" 0

scenario corrupt
make_app "$destination" old
make_app "$previous/Career Ops.app.previous" older
printf 'tampered\n' >> "$case_dir/new/Career Ops.app/Contents/Resources/marker.txt"
status=0; "$installer" "$case_dir/new/Career Ops.app" "$destination" "$previous" > "$case_dir/out" 2>&1 || status=$?
check "cópia corrompida: falha" "$status" 1
check "cópia corrompida: destino intacto" "$(marker "$destination")" old
check "cópia corrompida: anterior intacta" "$(marker "$previous/Career Ops.app.previous")" older
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
make_app "$previous/Career Ops.app.previous" older
status=0; CAREER_OPS_INSTALL_FAIL_PROMOTE=1 "$installer" "$case_dir/new/Career Ops.app" "$destination" "$previous" > "$case_dir/out" 2>&1 || status=$?
check "promoção falhada: falha" "$status" 1
check "promoção falhada: anterior reposta no destino" "$(marker "$destination")" old
check "promoção falhada: anterior guardada intacta" "$(marker "$previous/Career Ops.app.previous")" older
check "promoção falhada: sem restos" "$(leftovers "$apps")" 0
check "promoção falhada: erro em português" "$(grep -c 'versão anterior foi reposta' "$case_dir/out")" 1

scenario final-check-failure
make_app "$destination" old
make_app "$previous/Career Ops.app.previous" older
status=0; CAREER_OPS_INSTALL_FAIL_FINAL_CHECK=1 "$installer" "$case_dir/new/Career Ops.app" "$destination" "$previous" > "$case_dir/out" 2>&1 || status=$?
check "verificação final falhada: falha" "$status" 1
check "verificação final falhada: anterior reposta" "$(marker "$destination")" old
check "verificação final falhada: anterior guardada intacta" "$(marker "$previous/Career Ops.app.previous")" older
check "verificação final falhada: sem restos" "$(leftovers "$apps")" 0
check "verificação final falhada: mensagem exata" "$(grep -c 'A versão anterior foi reposta' "$case_dir/out")" 1

scenario final-check-first-install
status=0; CAREER_OPS_INSTALL_FAIL_FINAL_CHECK=1 "$installer" "$case_dir/new/Career Ops.app" "$destination" "$previous" > "$case_dir/out" 2>&1 || status=$?
check "verificação final na primeira instalação: falha" "$status" 1
check "verificação final na primeira instalação: nada instalado" "$([[ -e "$destination" ]] && echo present || echo absent)" absent
check "verificação final na primeira instalação: sem restos" "$(leftovers "$apps")" 0
check "verificação final na primeira instalação: não promete reposição" "$(grep -c 'Não havia versão anterior' "$case_dir/out")" 1

scenario previous-not-saved
make_app "$destination" old
printf 'file\n' > "$case_dir/blocker"
status=0; "$installer" "$case_dir/new/Career Ops.app" "$destination" "$case_dir/blocker/prev" > "$case_dir/out" 2>&1 || status=$?
kept="$(sed -n 's/.*Continua disponível em: //p' "$case_dir/out")"
check "anterior por guardar: instalação conclui" "$status" 0
check "anterior por guardar: nova versão instalada" "$(marker "$destination")" new
check "anterior por guardar: anterior continua disponível" "$(marker "$kept")" old
check "anterior por guardar: caminho indicado não é .app" "$([[ "$kept" == *.app ]] && echo app || echo plain)" plain

scenario concurrent
make_app "$destination" old
mkdir "$apps/.Career Ops.app.install.lock"
status=0; "$installer" "$case_dir/new/Career Ops.app" "$destination" "$previous" > "$case_dir/out" 2>&1 || status=$?
check "instalação concorrente: recusada" "$status" 1
check "instalação concorrente: destino intacto" "$(marker "$destination")" old
check "instalação concorrente: trinco alheio preservado" "$([[ -d "$apps/.Career Ops.app.install.lock" ]] && echo kept || echo removed)" kept
check "instalação concorrente: mensagem em português" "$(grep -c 'outra instalação' "$case_dir/out")" 1

scenario trash-through-symlink
make_app "$destination" old
mkdir -p "$case_dir/vol/.Trashes/501" "$case_dir/home/.Trash"
ln -s "$case_dir/home/.Trash" "$case_dir/looks-safe"
mkdir -p "$case_dir/caps/.TRASH"
ln -s "$case_dir/caps/.TRASH" "$case_dir/caps-link"
for target in "$case_dir/looks-safe/prev" "$case_dir/vol/.Trashes/501/prev" "$case_dir/caps/.TRASH/prev" \
    "$case_dir/caps-link/prev" "$case_dir/vol2/.trashes/prev"; do
    status=0; "$installer" "$case_dir/new/Career Ops.app" "$destination" "$target" > "$case_dir/out" 2>&1 || status=$?
    check "lixo ($(basename "$(dirname "$target")")): recusado" "$status" 2
done
check "lixo: destino intacto" "$(marker "$destination")" old
check "lixo: nada criado no lixo" "$(find "$case_dir/home/.Trash" "$case_dir/vol/.Trashes" -mindepth 1 | wc -l | tr -d ' ')" 1
check "lixo em maiúsculas: nada criado" "$(find "$case_dir/caps/.TRASH" -mindepth 1 | wc -l | tr -d ' ')" 0
check "lixo em minúsculas: nada criado" "$([[ -e "$case_dir/vol2" ]] && echo created || echo absent)" absent

dead_pid() { sleep 0 & local pid=$!; wait "$pid"; printf '%s' "$pid"; }
lock_with_pid() { mkdir "$apps/.Career Ops.app.install.lock"; [[ -z "$1" ]] || printf '%s\n' "$1" > "$apps/.Career Ops.app.install.lock/pid"; }

scenario stale-lock
make_app "$destination" old
dead="$(dead_pid)"
lock_with_pid "$dead"
mkdir -p "$apps/.Career Ops.app.staging.$dead/Contents"
status=0; "$installer" "$case_dir/new/Career Ops.app" "$destination" "$previous" > "$case_dir/out" 2>&1 || status=$?
check "trinco órfão: recuperado e instalado" "$status" 0
check "trinco órfão: nova versão instalada" "$(marker "$destination")" new
check "trinco órfão: anterior guardada" "$(marker "$previous/Career Ops.app.previous")" old
check "trinco órfão: sem restos" "$(leftovers "$apps")" 0
check "trinco órfão: recuperação anunciada" "$(grep -c 'interrompida' "$case_dir/out")" 1

scenario stale-lock-hidden-previous
dead="$(dead_pid)"
lock_with_pid "$dead"
make_app "$apps/.Career Ops.app.previous.$dead" old
status=0; "$installer" "$case_dir/new/Career Ops.app" "$destination" "$previous" > "$case_dir/out" 2>&1 || status=$?
check "trinco órfão sem destino: instalação conclui" "$status" 0
check "trinco órfão sem destino: nova versão instalada" "$(marker "$destination")" new
check "trinco órfão sem destino: versão escondida reposta e guardada" "$(marker "$previous/Career Ops.app.previous")" old
check "trinco órfão sem destino: sem restos" "$(leftovers "$apps")" 0
check "trinco órfão sem destino: reposição anunciada" "$(grep -c 'foi reposta' "$case_dir/out")" 1

scenario live-lock
make_app "$destination" old
lock_with_pid "$$"
status=0; "$installer" "$case_dir/new/Career Ops.app" "$destination" "$previous" > "$case_dir/out" 2>&1 || status=$?
check "trinco ativo: recusado" "$status" 1
check "trinco ativo: destino intacto" "$(marker "$destination")" old
check "trinco ativo: trinco preservado" "$(cat "$apps/.Career Ops.app.install.lock/pid")" "$$"

scenario lock-without-pid
make_app "$destination" old
lock_with_pid ""
status=0; "$installer" "$case_dir/new/Career Ops.app" "$destination" "$previous" > "$case_dir/out" 2>&1 || status=$?
check "trinco sem pid: recusado" "$status" 1
check "trinco sem pid: destino intacto" "$(marker "$destination")" old
check "trinco sem pid: trinco preservado" "$([[ -d "$apps/.Career Ops.app.install.lock" ]] && echo kept || echo removed)" kept

scenario sigterm-during-copy
make_app "$destination" old
mkdir -p "$case_dir/bin"
cat > "$case_dir/bin/cp" <<FAKE
#!/bin/bash
printf '%s\n' "\$\$" > "$case_dir/cp.pid"
mkdir -p "\${@: -1}/Contents"
exec sleep 30
FAKE
chmod +x "$case_dir/bin/cp"
PATH="$case_dir/bin:$PATH" "$installer" "$case_dir/new/Career Ops.app" "$destination" "$previous" > "$case_dir/out" 2>&1 &
installer_pid=$!
for _ in $(seq 1 50); do [[ -s "$case_dir/cp.pid" ]] && break; sleep 0.1; done
kill -TERM "$installer_pid"
status=0; wait "$installer_pid" || status=$?
check "SIGTERM durante a cópia: termina com erro" "$([[ "$status" != 0 ]] && echo failed || echo ok)" failed
check "SIGTERM durante a cópia: cópia terminada" "$(kill -0 "$(cat "$case_dir/cp.pid")" 2>/dev/null && echo alive || echo dead)" dead
check "SIGTERM durante a cópia: destino intacto" "$(marker "$destination")" old
check "SIGTERM durante a cópia: sem restos" "$(leftovers "$apps")" 0

scenario foreign-destination
mkdir -p "$destination/Contents"
printf 'foreign\n' > "$destination/keep.txt"
status=0; "$installer" "$case_dir/new/Career Ops.app" "$destination" "$previous" > "$case_dir/out" 2>&1 || status=$?
check "destino alheio: recusado" "$status" 2
check "destino alheio: intacto" "$(cat "$destination/keep.txt")" foreign

if ((failures)); then printf '%s falha(s) na instalação recuperável.\n' "$failures" >&2; exit 1; fi
printf '%s\n' 'Instalação recuperável: todos os cenários passaram.'
