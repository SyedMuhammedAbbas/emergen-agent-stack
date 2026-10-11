@echo off
rem Agent Stack control app: opens a page with the status of your services, spend and agents (read-only for now).
rem Leave this window open while you use it. Needs Node 20 or newer on Windows.
node "%~dp0apps\control-app\server.mjs" %*
