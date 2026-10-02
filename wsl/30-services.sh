#!/usr/bin/env bash
# Run as the agent user. Checks logins, installs Paperclip + jev-router as systemd user services. Idempotent.
# On macOS (mac/install.sh) Paperclip runs as a launchd user agent instead; see mac/launchd.sh.
# Exits 3 when a manual step is needed; the installer prints what to do.
source "$(dirname "$0")/lib.sh"
load_config
load_node

manual=()
gh auth status >/dev/null 2>&1 || manual+=("GitHub:  gh auth login")
claude auth status 2>/dev/null | grep -q '"loggedIn": true' || manual+=("Claude:  claude   (log in, then /exit)")
JEV_SERVICE="--service systemd "
# macOS: jev-router setup installs its launchd agent (io.github.dirien.jev-router) by default
[ "$(uname)" = Darwin ] && JEV_SERVICE=""
[ -s "$HOME/.config/jev-router/env" ] && grep -qE '^(TYPESAFE|OPENROUTER)_API_KEY=.+' "$HOME/.config/jev-router/env" \
  || manual+=("Jev key: jev-router setup --models claude ${JEV_SERVICE}--no-claude-settings   (TypeSafe or OpenRouter key)")

if [ "$(uname)" = Darwin ]; then
  # ---- macOS: Paperclip as a launchd user agent (mac/launchd.sh); the Linux block below is skipped ----
  source "$REPO_DIR/mac/launchd.sh"
  mac_paperclip_service
else
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
# Repos on /mnt/<drive> are read over the WSL file bridge; git status there takes 5-20s,
# past Paperclip's 8s workspace scan limit ("could not prepare the workspace").
scan="$HOME/.config/systemd/user/paperclipai.service.d/git-scan.conf"
if [ ! -f "$scan" ]; then
  log "Paperclip git scan timeout drop-in (60s)"
  printf '[Service]\nEnvironment=PAPERCLIP_WORKSPACE_GIT_SCAN_TIMEOUT_MS=60000\nEnvironment=PAPERCLIP_WORKSPACE_GIT_SCAN_CACHE_TTL_MS=60000\n' > "$scan"
  systemctl --user daemon-reload
  systemctl --user restart paperclipai.service
  sleep 10
fi
fi  # end Linux/WSL (systemd)
curl -sf http://127.0.0.1:3100/api/health >/dev/null || curl -sf -o /dev/null http://127.0.0.1:3100/ || die "Paperclip is not answering on :3100 (paperclipai service logs)"

# ---- jev-router ----
[ -f "$HOME/.config/jev-router/config.json" ] || jev-router init --models claude >/dev/null
if [ "$(uname)" = Darwin ]; then
  if mac_agent_running "$JEV_LABEL"; then log "jev-router running"; else warn "jev-router service not running yet"; fi
elif systemctl --user is-active jev-router.service >/dev/null 2>&1; then
  log "jev-router running"
else
  warn "jev-router service not running yet"
fi

if [ ${#manual[@]} -gt 0 ]; then
  if [ "$(uname)" = Darwin ]; then
    printf '\nManual steps needed in a Terminal, then re-run ./mac/install.sh:\n'
  else
  printf '\nManual steps needed in an Ubuntu terminal (wsl -d %s), then re-run the installer:\n' "$WSL_DISTRO"
  fi
  printf '  - %s\n' "${manual[@]}"
  exit 3
fi
if [ "$(uname)" = Darwin ]; then
  log "services ok: paperclip $(mac_agent_state "$(mac_paperclip_label)"), jev-router $(mac_agent_state "$JEV_LABEL")"
else
log "services ok: paperclip $(systemctl --user is-active paperclipai.service), jev-router $(systemctl --user is-active jev-router.service)"
fi
