@echo off
rem Opens the setup wizard in your browser. Needs Node.js (https://nodejs.org). Add --preview to see everything without changing anything.
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org and run setup.cmd again. & exit /b 1)
if /i "%~1"=="--preview" (set WIZARD_DRY=1 & shift)
node "%~dp0tools\setup-wizard\server.mjs" %1 %2 %3
