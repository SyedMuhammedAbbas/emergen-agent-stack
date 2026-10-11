@echo off
rem Run the reconciler from Windows: stack plan | stack apply --yes | stack adopt --yes | stack rollback | stack doctor
rem It runs inside WSL (where Paperclip, jq and the renderer are). Change the distro name if yours differs.
wsl.exe -d Ubuntu-24.04 --cd "%~dp0" -- bash -lc "source ~/.nvm/nvm.sh; node apps/cli/stack.mjs %*"
