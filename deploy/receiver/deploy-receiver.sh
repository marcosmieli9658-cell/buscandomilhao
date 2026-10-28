#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# This script deploys only the inbound receiver. Default mode is read-only planning.
# No Meta callback, CRM flag, sales worker, DNS or Resend setting is changed.
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT=/opt/buscandomilhao-receiver
BACKUPS=/var/backups/blessia-instagram-receiver
CURRENT="${APP_ROOT}/current"
VHOST=/etc/nginx/sites-available/blessialabs.com.br.conf
SNIPPET=/etc/nginx/snippets/blessia-buscando-milhao.conf
UNIT=/etc/systemd/system/blessia-instagram-receiver.service
SERVICE=blessia-instagram-receiver.service
ENV_FILE=/etc/blessia-instagram-receiver.env
MODE="${1:---plan}"
PLAN_DIR=""
BACKUP_DIR=""
ACTIVATION_STARTED=0

fail() { printf 'Erro: %s\n' "$*" >&2; exit 1; }
note() { printf '%s\n' "$*"; }
[[ "$EUID" -eq 0 ]] || fail "Use sudo bash deploy-receiver.sh --plan (ou --apply após revisão)."
[[ "$MODE" == --plan || "$MODE" == --apply || "$MODE" == --rollback ]] || fail "Modo: --plan, --apply ou --rollback DIRETORIO_BACKUP."
if [[ "$MODE" == --rollback ]]; then [[ $# -eq 2 ]] || fail "Informe o diretório do backup."; else [[ $# -le 1 ]] || fail "Argumentos inesperados."; fi

for name in nginx systemctl systemd-analyze curl flock install stat readlink realpath cmp diff getent useradd sha256sum sed cut grep mktemp id cat ln mv rm date; do
  command -v "$name" >/dev/null || fail "Comando ausente: $name. Nenhuma dependência será instalada."
done

detect_node() {
  local candidate
  for candidate in /opt/bravio-node/bin/node /usr/bin/node /usr/local/bin/node; do
    if [[ -x "$candidate" ]] && [[ "$("$candidate" -p 'process.versions.node.split(".")[0]' 2>/dev/null)" == 24 ]]; then
      printf '%s\n' "$candidate"; return 0
    fi
  done
  return 1
}
NODE_BIN="$(detect_node)" || fail "Node 24 não encontrado; não será instalado automaticamente."
[[ -f "$VHOST" && ! -L "$VHOST" ]] || fail "Vhost esperado ausente ou symlink; revisar manualmente: $VHOST"
[[ ! -L "$SNIPPET" && ! -L "$UNIT" ]] || fail "Snippet/unidade são symlinks; revisar manualmente."
for dedicated_path in "$APP_ROOT" "$BACKUPS"; do
  if [[ -e "$dedicated_path" ]]; then [[ -d "$dedicated_path" && ! -L "$dedicated_path" && "$(realpath "$dedicated_path")" == "$dedicated_path" ]] || fail "Diretório dedicado redirecionado; revisar manualmente."; fi
done

atomic_link() {
  local target="$1" next="${CURRENT}.next.$$"
  [[ "$target" == "${APP_ROOT}/releases/"* && -d "$target" ]] || return 1
  [[ ! -e "$next" && ! -L "$next" ]] || return 1
  ln -s "$target" "$next" || return 1
  mv -Tf "$next" "$CURRENT" || return 1
}

wait_health() {
  local attempt
  for attempt in {1..20}; do
    if curl --fail --silent --max-time 2 http://127.0.0.1:8790/healthz | grep -q '"ok":true'; then return 0; fi
    sleep 1
  done
  return 1
}

rollback() {
  local backup="$1" previous current_target
  [[ "$backup" == "${BACKUPS}/"* && -d "$backup" && ! -L "$backup" ]] || return 1
  [[ "$(realpath -- "$backup")" == "$backup" ]] || return 1
  [[ "$(stat -c '%u:%a' "$backup")" == '0:700' ]] || return 1
  [[ -f "$backup/vhost.before" && -f "$backup/vhost.after" && -f "$backup/unit.after" && -f "$backup/snippet.after" ]] || return 1
  # A later independent change must never be overwritten by rollback.
  cmp -s "$VHOST" "$backup/vhost.after" || cmp -s "$VHOST" "$backup/vhost.before" || return 1
  if [[ -f "$UNIT" ]]; then cmp -s "$UNIT" "$backup/unit.after" || { [[ -f "$backup/unit.before" ]] && cmp -s "$UNIT" "$backup/unit.before"; } || return 1; fi
  if [[ -f "$SNIPPET" ]]; then cmp -s "$SNIPPET" "$backup/snippet.after" || { [[ -f "$backup/snippet.before" ]] && cmp -s "$SNIPPET" "$backup/snippet.before"; } || return 1; fi
  previous="$(cat "$backup/previous-current.txt")"
  current_target=""
  if [[ -L "$CURRENT" ]]; then current_target="$(readlink -f "$CURRENT")" || return 1; elif [[ -e "$CURRENT" ]]; then return 1; fi
  [[ -z "$current_target" || "$current_target" == "$(cat "$backup/new-release.txt")" || "$current_target" == "$previous" ]] || return 1
  install -o root -g root -m 0644 "$backup/vhost.before" "$VHOST" || return 1
  if [[ -f "$backup/snippet.before" ]]; then install -o root -g root -m 0644 "$backup/snippet.before" "$SNIPPET" || return 1; else rm -f -- "$SNIPPET" || return 1; fi
  if [[ -f "$backup/unit.before" ]]; then install -o root -g root -m 0644 "$backup/unit.before" "$UNIT" || return 1; else systemctl stop "$SERVICE" || true; systemctl disable "$SERVICE" >/dev/null 2>&1 || true; rm -f -- "$UNIT" || return 1; fi
  if [[ -n "$previous" ]]; then atomic_link "$previous" || return 1; elif [[ -L "$CURRENT" ]]; then rm -- "$CURRENT" || return 1; fi
  systemctl daemon-reload || return 1
  if [[ -f "$backup/unit.before" ]]; then
    if [[ "$(cat "$backup/service-enabled.txt")" == enabled ]]; then systemctl enable "$SERVICE" >/dev/null || return 1; else systemctl disable "$SERVICE" >/dev/null || return 1; fi
    if [[ "$(cat "$backup/service-active.txt")" == active ]]; then systemctl restart "$SERVICE" || return 1; wait_health || return 1; else systemctl stop "$SERVICE" || return 1; fi
  fi
  nginx -t || return 1
  systemctl reload nginx || return 1
  note "Rollback concluído; fila SQLite, segredos e releases preservados."
}

cleanup() {
  local exit_status=$?
  trap - EXIT INT TERM
  if (( exit_status != 0 && ACTIVATION_STARTED == 1 )); then
    note "Ativação falhou; tentando rollback do backup $BACKUP_DIR."
    if ! rollback "$BACKUP_DIR"; then note "Rollback interrompido. Não sobrescrever mudanças posteriores; revisar manualmente o backup informado."; fi
  fi
  if [[ -n "$PLAN_DIR" && "$PLAN_DIR" == /tmp/blessia-receiver-plan.* && -d "$PLAN_DIR" && ! -L "$PLAN_DIR" && "$(realpath "$PLAN_DIR")" == "$PLAN_DIR" ]]; then rm -rf -- "$PLAN_DIR"; fi
  exit "$exit_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

exec 9>/run/lock/blessia-instagram-receiver-deploy.lock
flock -n 9 || fail "Outro deploy do receptor está em andamento."
if [[ "$MODE" == --rollback ]]; then rollback "$2" || fail "Rollback recusado ou incompleto; revisão manual necessária."; exit 0; fi

nginx -t
systemctl is-active --quiet nginx || fail "Nginx não está ativo."
enabled_count=0
for enabled_file in /etc/nginx/sites-enabled/*; do
  [[ -e "$enabled_file" ]] || continue
  if [[ "$(readlink -f "$enabled_file")" == "$VHOST" ]]; then enabled_count=$((enabled_count + 1)); fi
done
[[ "$enabled_count" -eq 1 ]] || fail "Vhost não está habilitado exatamente uma vez; revisar manualmente."
[[ ! -e "$CURRENT" || -L "$CURRENT" ]] || fail "current existe e não é symlink; revisar manualmente."
for file in receiver.mjs receiver.test.mjs prepare-nginx.mjs prepare-nginx.test.mjs blessia-instagram-receiver.service nginx-locations.example.conf; do
  [[ -f "$SCRIPT_DIR/$file" ]] || fail "Artefato ausente: $file"
done

PLAN_DIR="$(mktemp -d /tmp/blessia-receiver-plan.XXXXXXXX)"
"$NODE_BIN" "$SCRIPT_DIR/prepare-nginx.mjs" "$VHOST" "$PLAN_DIR/vhost.after"
sed "s|/usr/bin/node|$NODE_BIN|g" "$SCRIPT_DIR/blessia-instagram-receiver.service" > "$PLAN_DIR/unit.after"
install -m 0600 "$SCRIPT_DIR/nginx-locations.example.conf" "$PLAN_DIR/snippet.after"
"$NODE_BIN" --check "$SCRIPT_DIR/receiver.mjs"
note "Node selecionado: $NODE_BIN"
note "Vhost alvo exclusivo: $VHOST"
note "Callback: https://blessialabs.com.br/api/buscando-milhao/webhook"
note "Diff proposto do vhost:"
diff -u "$VHOST" "$PLAN_DIR/vhost.after" || [[ $? -eq 1 ]]
if [[ "$MODE" == --plan ]]; then
  note "Plano concluído sem alterar serviço, vhost, fila ou Meta. Revisar a unidade e o snippet nesta pasta e provisionar o env antes de --apply."
  exit 0
fi

[[ -s "$ENV_FILE" && ! -L "$ENV_FILE" ]] || fail "Provisionar primeiro o arquivo de segredos dedicado, fora do repositório."
[[ "$(stat -c '%u:%a' "$ENV_FILE")" == '0:600' ]] || fail "O arquivo de segredos deve pertencer a root e ter modo0600."
"$NODE_BIN" --input-type=module - "$ENV_FILE" <<'NODE'
import fs from "node:fs";
import { parseEnv } from "node:util";
const env = parseEnv(fs.readFileSync(process.argv[2], "utf8"));
const names = ["INSTAGRAM_WEBHOOK_VERIFY_TOKEN", "INSTAGRAM_APP_SECRET", "INSTAGRAM_PRODUCT_APP_SECRET", "RECEIVER_SYNC_TOKEN"];
if (names.some(name => !env[name] || /[\r\n]/.test(env[name]) || env[name].startsWith("REPLACE_"))) process.exit(1);
const token = env.RECEIVER_SYNC_TOKEN;
if (Buffer.byteLength(token) < 32 || /\s/.test(token) || names.slice(0, 3).some(name => env[name] === token)) process.exit(1);
// Refuse unrelated credentials and overrides of the fixed state path or Node runtime.
if (Object.keys(env).some(name => !names.includes(name))) process.exit(1);
NODE

if getent passwd blessia-receiver >/dev/null; then
  [[ "$(id -u blessia-receiver)" != 0 ]] || fail "Usuário dedicado inválido."
  user_shell="$(getent passwd blessia-receiver | cut -d: -f7)"
  [[ "$user_shell" == /usr/sbin/nologin || "$user_shell" == /bin/false ]] || fail "Usuário dedicado possui shell de login; revisar manualmente."
else
  useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin blessia-receiver
fi
[[ "$(id -gn blessia-receiver)" == blessia-receiver ]] || fail "Grupo primário inesperado."

install -d -o root -g root -m 0755 "$APP_ROOT" "$APP_ROOT/releases"
install -d -o root -g root -m 0700 "$BACKUPS"
release_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
release_dir="$APP_ROOT/releases/$release_id"
BACKUP_DIR="$BACKUPS/$release_id"
[[ ! -e "$release_dir" && ! -e "$BACKUP_DIR" ]] || fail "Identificador de release já existe."
install -d -o root -g root -m 0755 "$release_dir"
install -d -o root -g root -m 0700 "$BACKUP_DIR"
install -o root -g root -m 0644 "$SCRIPT_DIR/receiver.mjs" "$SCRIPT_DIR/receiver.test.mjs" "$SCRIPT_DIR/prepare-nginx.mjs" "$SCRIPT_DIR/prepare-nginx.test.mjs" "$release_dir/"
"$NODE_BIN" --test "$release_dir/receiver.test.mjs" "$release_dir/prepare-nginx.test.mjs"
install -o root -g root -m 0600 "$VHOST" "$BACKUP_DIR/vhost.before"
install -o root -g root -m 0600 "$PLAN_DIR/vhost.after" "$BACKUP_DIR/vhost.after"
install -o root -g root -m 0600 "$PLAN_DIR/unit.after" "$BACKUP_DIR/unit.after"
install -o root -g root -m 0600 "$PLAN_DIR/snippet.after" "$BACKUP_DIR/snippet.after"
if [[ -f "$SNIPPET" ]]; then install -o root -g root -m 0600 "$SNIPPET" "$BACKUP_DIR/snippet.before"; fi
if [[ -f "$UNIT" ]]; then install -o root -g root -m 0600 "$UNIT" "$BACKUP_DIR/unit.before"; fi
if [[ -L "$CURRENT" ]]; then
  previous_release="$(readlink -f "$CURRENT")"
  [[ "$previous_release" == "$APP_ROOT/releases/"* && -d "$previous_release" ]] || fail "Release anterior fora do diretório dedicado."
  printf '%s\n' "$previous_release" > "$BACKUP_DIR/previous-current.txt"
else
  : > "$BACKUP_DIR/previous-current.txt"
fi
printf '%s\n' "$release_dir" > "$BACKUP_DIR/new-release.txt"
systemctl is-active "$SERVICE" > "$BACKUP_DIR/service-active.txt" 2>/dev/null || true
systemctl is-enabled "$SERVICE" > "$BACKUP_DIR/service-enabled.txt" 2>/dev/null || true
sha256sum "$release_dir/receiver.mjs" > "$BACKUP_DIR/release.sha256"

# Ensure there was no independent vhost edit while the candidate was being tested.
"$NODE_BIN" "$SCRIPT_DIR/prepare-nginx.mjs" "$VHOST" "$PLAN_DIR/vhost.recheck"
cmp -s "$PLAN_DIR/vhost.after" "$PLAN_DIR/vhost.recheck" || fail "Vhost mudou durante a preparação; abortando."
ACTIVATION_STARTED=1
atomic_link "$release_dir"
install -o root -g root -m 0644 "$PLAN_DIR/unit.after" "$UNIT"
systemd-analyze verify "$UNIT"
install -o root -g root -m 0644 "$PLAN_DIR/snippet.after" "$SNIPPET"
install -o root -g root -m 0644 "$PLAN_DIR/vhost.after" "$VHOST"
nginx -t
systemctl daemon-reload
systemctl restart "$SERVICE"
wait_health || fail "Receptor não ficou saudável."
systemctl reload nginx
systemctl enable "$SERVICE" >/dev/null
ACTIVATION_STARTED=0
note "Receptor instalado; callbacks Meta NÃO foram alterados."
note "Backup de configuração e rollback: $BACKUP_DIR"
note "Rollback manual: sudo bash $SCRIPT_DIR/deploy-receiver.sh --rollback $BACKUP_DIR"
note "Validar HTTPS externo, HMAC, sincronização e recebimento real antes do corte na Meta."
