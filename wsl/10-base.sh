#!/usr/bin/env bash
# Run as root: wsl -d <distro> -u root -- bash wsl/10-base.sh
# System packages, systemd, linger for the agent user. Idempotent.
source "$(dirname "$0")/lib.sh"
load_config
[ "$(uname)" = Darwin ] && die "Linux/WSL only. On macOS, mac/install.sh installs the Homebrew equivalents."
[ "$(id -u)" = 0 ] || die "run as root (wsl -u root)"

if ! grep -q '^systemd=true' /etc/wsl.conf 2>/dev/null; then
  printf '[boot]\nsystemd=true\n' >> /etc/wsl.conf
  warn "systemd enabled in /etc/wsl.conf. Run 'wsl --shutdown' from Windows, then re-run the installer."
fi

log "apt packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl build-essential unzip jq ca-certificates gh python3 python3-pip python3-openpyxl bubblewrap >/dev/null

log "linger for $WSL_USER (user services run without a terminal)"
loginctl enable-linger "$WSL_USER"

# Linger keeps the user's services running without a terminal, but after a host sleep/resume or a memory
# allocation failure WSL can still stop the user manager, and Paperclip, the router and the watchdog go with it.
# A system timer starts it again within 2 minutes.
uid=$(id -u "$WSL_USER")
cat > /etc/systemd/system/agent-user-keepalive.service <<UNIT
[Unit]
Description=Keep the agent user's systemd manager (Paperclip, router, watchdog) running
[Service]
Type=oneshot
ExecStart=/bin/systemctl start user@$uid.service
UNIT
cat > /etc/systemd/system/agent-user-keepalive.timer <<UNIT
[Unit]
Description=Check every 2 minutes that the agent user's services are running
[Timer]
OnBootSec=1min
OnUnitActiveSec=2min
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now agent-user-keepalive.timer >/dev/null
log "user manager keepalive timer enabled"

log "base done"
