@echo off
:: ─────────────────────────────────────────
::  Odylic Studio — Double-click to launch
:: ─────────────────────────────────────────

cd /d "%~dp0"

echo.
echo   ╔═══════════════════════════════╗
echo   ║       Odylic Studio           ║
echo   ╚═══════════════════════════════╝
echo.

:: Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo   Node.js is required but not installed.
  echo.
  echo   Download it from: https://nodejs.org
  echo.
  echo   Press any key to open the download page...
  pause >nul
  start https://nodejs.org
  exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo   Node.js %NODE_VERSION% found

:: Install dependencies on first run
if not exist "node_modules" (
  echo.
  echo   First launch — installing dependencies...
  echo   ^(This may take a minute^)
  echo.
  call npm install
  echo.
)

echo.
echo   Starting Odylic Studio...
echo   Opening http://localhost:3000 in your browser...
echo.
echo   Close this window to stop the server.
echo.

:: Open browser after a short delay
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"

:: Start the dev server (blocks)
call npm run dev
