# launchd helpers for the macOS install (the macOS counterpart of the systemd parts of wsl/30-services.sh and
# wsl/40-org.sh). Sourced by those scripts on Darwin, after wsl/lib.sh. Not yet tested on a Mac.
#
# User agents (~/Library/LaunchAgents, domain gui/<uid>):
#   io.agent-stack.paperclip      Paperclip on :3100 (only when `paperclipai onboard --install-service` did not
#                                 install its own launchd agent; see mac_paperclip_service)
#   io.agent-stack.watchdog       wsl/watchdog/watchdog.sh every WATCHDOG_INTERVAL_MIN minutes
#   io.github.dirien.jev-router   written by `jev-router setup` itself
# Logs: ~/Library/Logs/agent-stack/

LA_DIR="$HOME/Library/LaunchAgents"
MAC_LOG_DIR="$HOME/Library/Logs/agent-stack"
PAPERCLIP_LABEL=io.agent-stack.paperclip
WATCHDOG_LABEL=io.agent-stack.watchdog
JEV_LABEL=io.github.dirien.jev-router
GUI_DOMAIN="gui/$(id -u)"

xml_esc() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

# PATH for the services: native claude, the nvm node, Homebrew (git, gh, jq, python3), then the system.
# Same idea as the Linux PATH drop-in in 30-services.sh: launchd starts jobs with only /usr/bin:/bin:/usr/sbin:/sbin.
mac_service_path() {
  local bp; bp=$(brew --prefix 2>/dev/null || echo /opt/homebrew)
  printf '%s' "$HOME/.local/bin:$(dirname "$(command -v node)"):$bp/bin:$bp/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
}

mac_agent_loaded()  { launchctl print "$GUI_DOMAIN/$1" >/dev/null 2>&1; }
# grep without -q: an early grep exit would SIGPIPE launchctl and fail the pipeline under pipefail
mac_agent_running() { launchctl print "$GUI_DOMAIN/$1" 2>/dev/null | grep 'state = running' >/dev/null; }
mac_agent_state() {
  local s; s=$(launchctl print "$GUI_DOMAIN/$1" 2>/dev/null | awk -F' = ' '/^[[:space:]]*state = /{print $2; exit}' || true)
  printf '%s' "${s:-not loaded}"
}

# (Re)load an agent from its plist into the GUI domain
mac_load_agent() { # label plist
  launchctl bootout "$GUI_DOMAIN/$1" 2>/dev/null || true
  launchctl bootstrap "$GUI_DOMAIN" "$2" || die "launchctl bootstrap $2 failed"
}

# Write ~/Library/LaunchAgents/<label>.plist from stdin and load it.
# Returns 1 (nothing done) when the file is unchanged and the agent is already loaded; 0 otherwise.
mac_install_agent() { # label
  local label="$1" f="$LA_DIR/$1.plist" tmp
  mkdir -p "$LA_DIR" "$MAC_LOG_DIR"
  tmp=$(mktemp); cat > "$tmp"
  plutil -lint -s "$tmp" >/dev/null || { rm -f "$tmp"; die "generated plist for $label is invalid"; }
  if cmp -s "$tmp" "$f" && mac_agent_loaded "$label"; then rm -f "$tmp"; return 1; fi
  mv "$tmp" "$f"; chmod 644 "$f"
  mac_load_agent "$label" "$f"
}

# ---------------- Paperclip ----------------

paperclip_up() { curl -sf -o /dev/null http://127.0.0.1:3100/api/health || curl -sf -o /dev/null http://127.0.0.1:3100/; }

# A launchd agent for Paperclip written by Paperclip itself (onboard --install-service), if it supports launchd
foreign_paperclip_plist() {
  grep -l -i 'paperclip' "$LA_DIR"/*.plist 2>/dev/null | grep -v "/io\.agent-stack\." | head -1 || true
}

# Label of whichever agent runs Paperclip (for status messages and docs)
mac_paperclip_label() { cat "$STATE_DIR/paperclip.launchd-label" 2>/dev/null || echo "$PAPERCLIP_LABEL"; }

# Run `paperclipai onboard --yes [extra args]` without letting it hold the terminal.
# UNVERIFIED on macOS: whether --install-service supports launchd, and whether onboard keeps the server running in
# the foreground when no service is installed. Both cases are handled: if the server answers on :3100 while onboard
# is still running and no launchd agent appeared, onboard is stopped (SIGTERM) and launchd runs Paperclip from then on.
mac_paperclip_onboard() {
  local logf="$MAC_LOG_DIR/paperclip-onboard.log" pid i rc=0 stopped=0
  mkdir -p "$MAC_LOG_DIR"
  (cd ~ && exec paperclipai onboard --yes "$@" </dev/null >"$logf" 2>&1) &
  pid=$!
  for i in $(seq 1 90); do   # up to 3 minutes
    kill -0 "$pid" 2>/dev/null || break
    if paperclip_up && [ -z "$(foreign_paperclip_plist)" ]; then
      sleep 5   # let first-run setup (embedded Postgres, migrations) settle
      log "onboard is serving Paperclip in the foreground; stopping it so launchd can run it"
      kill -TERM "$pid" 2>/dev/null || true; stopped=1
      break
    fi
    sleep 2
  done
  wait "$pid" 2>/dev/null || rc=$?
  # give a stopped foreground server time to release :3100
  if [ -z "$(foreign_paperclip_plist)" ]; then
    for i in $(seq 1 15); do paperclip_up || break; sleep 2; done
  fi
  tail -3 "$logf" || true
  [ "$stopped" = 1 ] && return 0   # we stopped it; its exit code is the SIGTERM
  return "$rc"
}

mac_paperclip_service() {
  local plist label want cur ours="$LA_DIR/$PAPERCLIP_LABEL.plist"
  plist=$(foreign_paperclip_plist)
  if [ ! -f "$ours" ] && [ -z "$plist" ]; then
    log "Paperclip onboarding (local loopback, trusted) + service"
    if ! mac_paperclip_onboard --install-service; then
      # --install-service may be systemd-only: onboard again without it (onboard is idempotent on Linux too)
      warn "paperclipai onboard --install-service failed (see $MAC_LOG_DIR/paperclip-onboard.log); retrying without --install-service"
      mac_paperclip_onboard || warn "paperclipai onboard failed; see $MAC_LOG_DIR/paperclip-onboard.log"
    fi
    plist=$(foreign_paperclip_plist)
  fi

  want=$(mac_service_path)
  if [ -n "$plist" ]; then
    # Paperclip installed its own launchd agent: give it the PATH (the macOS form of the Linux path.conf drop-in)
    label=$(plutil -extract Label raw "$plist")
    cur=$(plutil -extract EnvironmentVariables.PATH raw "$plist" 2>/dev/null || true)
    if [ "$cur" != "$want" ] || ! mac_agent_loaded "$label"; then
      log "Paperclip launchd agent $label: PATH"
      plutil -extract EnvironmentVariables xml1 -o /dev/null "$plist" 2>/dev/null || plutil -insert EnvironmentVariables -dictionary "$plist"
      plutil -replace EnvironmentVariables.PATH -string "$want" "$plist"
      mac_load_agent "$label" "$plist"
      sleep 10
    fi
  else
    # Our own agent. UNVERIFIED: `paperclipai run` as the foreground server command; override with
    # PAPERCLIP_RUN_ARGS in config.env (space-separated arguments after `paperclipai`).
    label=$PAPERCLIP_LABEL
    local bin args="" a
    bin=$(command -v paperclipai) || die "paperclipai not found (run wsl/20-tools.sh)"
    for a in ${PAPERCLIP_RUN_ARGS:-run}; do args+="    <string>$(xml_esc "$a")</string>"$'\n'; done
    if mac_install_agent "$label" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_esc "$bin")</string>
$args  </array>
  <key>WorkingDirectory</key>
  <string>$(xml_esc "$HOME")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(xml_esc "$want")</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$(xml_esc "$MAC_LOG_DIR/paperclip.log")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_esc "$MAC_LOG_DIR/paperclip.log")</string>
</dict>
</plist>
PLIST
    then
      log "Paperclip launchd agent $label loaded"
      sleep 10
    fi
  fi
  mkdir -p "$STATE_DIR"; echo "$label" > "$STATE_DIR/paperclip.launchd-label"
  local i; for i in $(seq 1 30); do paperclip_up && break; sleep 2; done
}

# ---------------- staleness watchdog ----------------

mac_watchdog_agent() {
  local min="${WATCHDOG_INTERVAL_MIN:-10}"
  # $BASH is Homebrew bash here (wsl/lib.sh re-executes under it on macOS)
  mac_install_agent "$WATCHDOG_LABEL" <<PLIST || true
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$WATCHDOG_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_esc "$BASH")</string>
    <string>-c</string>
    <string>$(xml_esc "'$STATE_DIR/watchdog.sh' >> '$STATE_DIR/watchdog.log' 2>&1")</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(xml_esc "$(mac_service_path)")</string>
  </dict>
  <key>StartInterval</key>
  <integer>$((min * 60))</integer>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardErrorPath</key>
  <string>$(xml_esc "$MAC_LOG_DIR/watchdog.err.log")</string>
</dict>
</plist>
PLIST
}
