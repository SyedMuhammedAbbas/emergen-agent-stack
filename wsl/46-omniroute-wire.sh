#!/usr/bin/env bash
# Point jev-router's fast / balanced / frontier tiers at OmniRoute, so OmniRoute can fall back to the next provider when one
# is out of quota. Safe by construction: it refuses to change anything until the owner's part is done, backs up the config,
# tests the result with `jev-router doctor --live`, and puts the old config back if the test fails.
#
#   46-omniroute-wire.sh --check      read-only: what is ready and what is missing
#   46-omniroute-wire.sh              wire it up (only if every required check passes)
#   46-omniroute-wire.sh --rollback   restore the most recent backup
#
# The owner's part (docs/omniroute.md): OmniRoute dashboard -> admin password, providers, three combos named fast, balanced and
# frontier, one API key. The key goes in ~/.agent-stack/secrets/OMNIROUTE_API_KEY (this script copies it into jev-router's env
# file; it never prints it). `trusted` and `side` stay direct, on purpose.
set -uo pipefail
export PATH="$HOME/.local/bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:$PATH"

CFG="$HOME/.config/jev-router/config.json"; ENVF="$HOME/.config/jev-router/env"; KEYF="$HOME/.agent-stack/secrets/OMNIROUTE_API_KEY"
OMNI="${OMNIROUTE_URL:-http://127.0.0.1:20128}"; TIERS=(fast balanced frontier); mode="${1:-apply}"
ok=1; say() { printf '%s\n' "$*"; }; need() { say "  MISSING  $*"; ok=0; }; good() { say "  ok       $*"; }; warn() { say "  unknown  $*"; }

backup_latest() { ls -1t "$CFG".bak-omniroute-* 2>/dev/null | head -1; }

if [ "$mode" = "--rollback" ]; then
  b=$(backup_latest); [ -n "$b" ] || { say "no backup to restore"; exit 1; }
  cp "$b" "$CFG" && systemctl --user restart jev-router && say "restored $b and restarted jev-router"; exit $?
fi

say "Checks"
command -v jq >/dev/null && good "jq" || need "jq is not installed"
command -v jev-router >/dev/null && good "jev-router is installed" || need "jev-router is not installed"
[ -f "$CFG" ] && good "jev-router config found" || need "jev-router config not found ($CFG)"
curl -fsS -m 4 "$OMNI/api/health" >/dev/null 2>&1 && good "OmniRoute answers on $OMNI" || need "OmniRoute is not answering on $OMNI (start it from the Services screen)"
if [ -s "$KEYF" ]; then good "API key file exists (contents not read)"; else need "no OmniRoute API key: create ~/.agent-stack/secrets/OMNIROUTE_API_KEY and paste the key into it yourself"; fi
if [ -s "$KEYF" ] && command -v jq >/dev/null; then
  ids=$(curl -fsS -m 6 -H "Authorization: Bearer $(cat "$KEYF")" "$OMNI/v1/models" 2>/dev/null | jq -r '.data[]?.id' 2>/dev/null)
  if [ -z "$ids" ]; then warn "could not list OmniRoute's models with that key, so the combos are unchecked (the live test below is the real check)"
  else for t in "${TIERS[@]}"; do grep -qx "$t" <<<"$ids" && good "combo \"$t\" exists" || need "no combo named \"$t\" in OmniRoute (create it in the dashboard, with your fallback order)"; done; fi
fi
[ "$mode" = "--check" ] && { [ $ok = 1 ] && say "READY: run without --check to wire it up." || say "NOT READY: finish the missing items above."; exit $((1 - ok)); }
[ $ok = 1 ] || { say "Nothing was changed."; exit 1; }

# ---- apply ----
b="$CFG.bak-omniroute-$(date +%Y%m%d-%H%M%S)"; cp "$CFG" "$b" && say "backup: $b"
touch "$ENVF"; chmod 600 "$ENVF"; grep -v '^OMNIROUTE_API_KEY=' "$ENVF" > "$ENVF.tmp" || true; printf 'OMNIROUTE_API_KEY=%s\n' "$(cat "$KEYF")" >> "$ENVF.tmp"; mv "$ENVF.tmp" "$ENVF"; chmod 600 "$ENVF"
tmp=$(mktemp); jq --arg url "$OMNI" '
  reduce ("fast","balanced","frontier") as $t (.; if .surfaces.anthropic[$t] then .surfaces.anthropic[$t] |= (.url = $url | .model = $t | .keyEnv = "OMNIROUTE_API_KEY") else . end)
' "$CFG" > "$tmp" && mv "$tmp" "$CFG" || { cp "$b" "$CFG"; say "could not edit the config; restored"; exit 1; }
say "tiers fast, balanced, frontier now point at OmniRoute"
systemctl --user restart jev-router; sleep 3
if jev-router doctor --live >/tmp/jev-doctor.out 2>&1; then say "live test passed"; rm -f /tmp/jev-doctor.out; say "DONE. Roll back any time with: $0 --rollback"
else say "live test FAILED, restoring the old config"; sed 's/^/    /' /tmp/jev-doctor.out | tail -12; cp "$b" "$CFG"; systemctl --user restart jev-router; say "restored; nothing changed for your agents"; exit 1; fi
