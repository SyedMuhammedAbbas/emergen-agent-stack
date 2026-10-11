#!/usr/bin/env bash
# Throwaway Paperclip for tests, isolated from the live one (own data dir, own ports, own systemd unit).
# Usage: scratch.sh start|stop|reset|status|url      (run inside WSL / Linux)
#   SCRATCH_DIR (default ~/.agent-stack/scratch)  SCRATCH_PORT (3199)  SCRATCH_DB_PORT (54399)
# Built from the M0 spike: `onboard --yes` writes the config and secrets, we move the ports, then run the server
# module directly (the CLI wrapper's doctor refuses because of the live service definition).
set -euo pipefail
D="${SCRATCH_DIR:-$HOME/.agent-stack/scratch}"; PORT="${SCRATCH_PORT:-3199}"; DBPORT="${SCRATCH_DB_PORT:-54399}"
UNIT=agent-stack-scratch
[ "$PORT" != 3100 ] && [ "$DBPORT" != 54329 ] || { echo "refusing the live ports" >&2; exit 1; }
# shellcheck disable=SC1091
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
health() { curl -sf --max-time 2 "http://127.0.0.1:$PORT/api/health" >/dev/null; }

start() {
  health && { echo "already running on :$PORT"; return; }
  if [ ! -f "$D/instances/default/config.json" ]; then
    mkdir -p "$D"
    # onboard --yes refuses to start while the live service is up, but writes the config first. If the live service
    # were down it would start a server on the default :3100, so refuse that case up front.
    systemctl --user is-active --quiet paperclipai || { echo "start the live paperclipai service first (onboarding would otherwise bind :3100)" >&2; exit 1; }
    timeout 120 paperclipai onboard --yes --no-install-service -d "$D" >/dev/null 2>&1 || true
    [ -f "$D/instances/default/config.json" ] || { echo "onboarding did not create a config" >&2; exit 1; }
    c="$D/instances/default/config.json"
    jq --argjson p "$PORT" --argjson d "$DBPORT" '.server.port=$p | .database.embeddedPostgresPort=$d' "$c" > "$c.tmp" && mv "$c.tmp" "$c"
  fi
  cat > "$D/run.sh" <<EOF
#!/usr/bin/env bash
source "\$HOME/.nvm/nvm.sh"
R=\$(npm root -g)/paperclipai/node_modules/@paperclipai/server
I="$D/instances/default"
set -a; . "\$I/.env"; set +a
export PAPERCLIP_HOME="$D" PAPERCLIP_CONFIG="\$I/config.json" PAPERCLIP_INSTANCE_ID=default PAPERCLIP_DISABLE_CWD_ENV_FILE=1
cd "$D"
exec node "\$R/dist/index.js"
EOF
  chmod +x "$D/run.sh"
  systemctl --user reset-failed "$UNIT" 2>/dev/null || true
  systemd-run --user --unit="$UNIT" -p "StandardOutput=file:$D/server.log" -p StandardError=inherit bash "$D/run.sh" >/dev/null
  for _ in $(seq 1 60); do health && { echo "scratch Paperclip up on http://127.0.0.1:$PORT"; return; }; sleep 2; done
  echo "did not become healthy; see $D/server.log" >&2; exit 1
}
stop() { systemctl --user stop "$UNIT" 2>/dev/null || true; echo stopped; }
reset() {
  stop; sleep 2
  case "$D" in *scratch*) rm -rf "$D" ;; *) echo "refusing to delete $D (path must contain 'scratch')" >&2; exit 1 ;; esac
  start
}
case "${1:-}" in
  start) start ;; stop) stop ;; reset) reset ;;
  status) health && echo "up on :$PORT" || echo "down" ;;
  url) echo "http://127.0.0.1:$PORT/api" ;;
  *) echo "usage: $0 start|stop|reset|status|url" >&2; exit 2 ;;
esac
