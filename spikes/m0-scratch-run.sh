#!/usr/bin/env bash
source ~/.nvm/nvm.sh
R=$(npm root -g)/paperclipai/node_modules/@paperclipai/server
H=/home/syedabbas/m0-scratch; I=$H/instances/default
set -a; . $I/.env; set +a
export PAPERCLIP_HOME=$H PAPERCLIP_CONFIG=$I/config.json PAPERCLIP_INSTANCE_ID=default PAPERCLIP_DISABLE_CWD_ENV_FILE=1
cd $H
exec node $R/dist/index.js
