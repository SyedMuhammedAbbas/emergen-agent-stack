#!/usr/bin/env bash
# Run as the agent user. Checks logins, installs Paperclip + jev-router as systemd user services. Idempotent.
# Exits 3 when a manual step is needed; the installer prints what to do.
source "$(dirname "$0")/lib.sh"
load_config
load_node

manual=()
gh auth status >/dev/null 2>&1 || manual+=("GitHub:  gh auth login")
claude auth status 2>/dev/null | grep -q '"loggedIn": true' || manual+=("Claude:  claude   (log in, then /exit)")
[ -s "$HOME/.config/jev-router/env" ] && grep -qE '^(TYPESAFE|OPENROUTER)_API_KEY=.+' "$HOME/.config/jev-router/env" \
  || manual+=("Jev key: jev-router setup --models claude --service systemd --no-claude-settings   (TypeSafe or OpenRouter key)")

# ---- Paperclip ----
if ! systemctl --user is-enabled paperclipai.service >/dev/null 2>&1; then
  log "Paperclip onboarding (local loopback, trusted) + service"
  (cd ~ && paperclipai onboard --yes --install-service < /dev/null) | tail -3
fi
# The service's PATH must include ~/.local/bin (native claude) and the nvm node
dropin="$HOME/.config/systemd/user/paperclipai.service.d/path.conf"
want="Environment=\"PATH=$HOME/.local/bin:$(dirname "$(command -v node)"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\""
if ! grep -qF "$want" "$dropin" 2>/dev/null; then
  log "Paperclip service PATH drop-in"
  mkdir -p "$(dirname "$dropin")"
  printf '[Service]\n%s\n' "$want" > "$dropin"
  systemctl --user daemon-reload
  systemctl --user restart paperclipai.service
  sleep 10
fi
curl -sf http://127.0.0.1:3100/api/health >/dev/null || curl -sf -o /dev/null http://127.0.0.1:3100/ || die "Paperclip is not answering on :3100 (paperclipai service logs)"

# ---- jev-router ----
[ -f "$HOME/.config/jev-router/config.json" ] || jev-router init --models claude >/dev/null
if systemctl --user is-active jev-router.service >/dev/null 2>&1; then
  log "jev-router running"
else
  warn "jev-router service not running yet"
fi

if [ ${#manual[@]} -gt 0 ]; then
  printf '\nManual steps needed in an Ubuntu terminal (wsl -d %s), then re-run the installer:\n' "$WSL_DISTRO"
  printf '  - %s\n' "${manual[@]}"
  exit 3
fi
log "services ok: paperclip $(systemctl --user is-active paperclipai.service), jev-router $(systemctl --user is-active jev-router.service)"
