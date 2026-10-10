#!/usr/bin/env bash
# OmniRoute: one local gateway (http://127.0.0.1:20128) that routes a model name to many providers with fallback.
# jev-router picks the tier (fast/balanced/frontier); OmniRoute turns each tier into a real provider+model.
# Idempotent. Provider keys are added by the owner in the dashboard, never here.
set -euo pipefail
source "$HOME/.nvm/nvm.sh"

command -v omniroute >/dev/null || npm install -g omniroute
mkdir -p "$HOME/.omniroute" "$HOME/.config/systemd/user"
touch "$HOME/.omniroute/.env"; chmod 600 "$HOME/.omniroute/.env"

cat > "$HOME/.config/systemd/user/omniroute.service" <<EOF
[Unit]
Description=OmniRoute AI gateway
After=network-online.target

[Service]
ExecStart=$(command -v node) $(command -v omniroute) serve --no-open
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now omniroute.service
echo "OmniRoute dashboard: http://localhost:20128"
