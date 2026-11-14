@echo off
rem Run the service with the Node.js installation provided by the operator.
where node.exe >nul 2>&1
if errorlevel 1 (
  echo Node.js 18 or newer is required. Install it from https://nodejs.org/ and retry.
  exit /b 1
)
node.exe "%~dp0deployment-launcher.mjs" %*
