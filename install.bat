@echo off
REM ─────────────────────────────────────────
REM  Odylic Studio — Windows Installer
REM  Just double-click this file or run: install.bat
REM ─────────────────────────────────────────

echo.
echo   ╔═══════════════════════════════╗
echo   ║     Installing Odylic Studio  ║
echo   ╚═══════════════════════════════╝
echo.

REM Check for Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo   Node.js is required but not installed.
    echo   Opening download page...
    start https://nodejs.org
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do echo   ✓ Node.js %%i found

REM Check for git
where git >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo   Git is required but not installed.
    echo   Opening download page...
    start https://git-scm.com
    pause
    exit /b 1
)
echo   ✓ Git found

SET INSTALL_DIR=%USERPROFILE%\odylic-studio

REM Clone or update repo
if exist "%INSTALL_DIR%\.git" (
    echo   ✓ %INSTALL_DIR% already exists — updating...
    cd /d "%INSTALL_DIR%"
    git pull --ff-only 2>nul
) else (
    echo   Downloading source code...
    git clone --depth 1 https://github.com/peterquads/odylic-studio.git "%INSTALL_DIR%"
    cd /d "%INSTALL_DIR%"
)

REM Download templates if needed
dir /b "%INSTALL_DIR%\templates\*.webp" >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo   Downloading ad templates (~650 MB)... this may take a few minutes.
    powershell -Command "$releases = Invoke-RestMethod 'https://api.github.com/repos/peterquads/odylic-studio/releases/latest'; $url = ($releases.assets | Where-Object { $_.name -like '*templates*zip*' } | Select-Object -First 1).browser_download_url; if ($url) { Invoke-WebRequest -Uri $url -OutFile '%TEMP%\odylic-templates.zip'; Expand-Archive -Path '%TEMP%\odylic-templates.zip' -DestinationPath '%INSTALL_DIR%\templates' -Force; Remove-Item '%TEMP%\odylic-templates.zip' -Force; Write-Host '  ✓ Templates installed' } else { Write-Host '  ⚠ Could not find template download' }"
) else (
    echo   ✓ Templates already installed
)

REM Install npm dependencies
echo   Installing dependencies...
cd /d "%INSTALL_DIR%"
call npm install --loglevel=error

echo.
echo   ✓ Odylic Studio installed at %INSTALL_DIR%
echo.

REM Create desktop shortcut
if exist "%INSTALL_DIR%\start.bat" (
    powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Odylic Studio.lnk'); $s.TargetPath = '%INSTALL_DIR%\start.bat'; $s.WorkingDirectory = '%INSTALL_DIR%'; $s.Description = 'Odylic Studio - AI Ad Creative Tool'; $s.Save()"
    echo   ✓ Desktop shortcut created
)

echo.
echo   Starting the app...
echo.

REM Open browser and start server
start "" http://localhost:3000
call npm run dev
