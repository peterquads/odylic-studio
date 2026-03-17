@echo off
REM ─────────────────────────────────────────
REM  Odylic Studio — Windows Installer
REM  Just double-click this file or run: install.bat
REM ─────────────────────────────────────────

title Installing Odylic Studio
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
SET REPO=peterquads/odylic-studio

REM Clone or update repo
if exist "%INSTALL_DIR%\.git" (
    echo   ✓ %INSTALL_DIR% already exists — updating...
    cd /d "%INSTALL_DIR%"
    git pull --ff-only 2>nul
) else (
    if exist "%INSTALL_DIR%" (
        echo   Partial install detected — re-downloading...
        if exist "%INSTALL_DIR%\templates" (
            move "%INSTALL_DIR%\templates" "%TEMP%\odylic-templates-backup" >nul 2>nul
        )
        rmdir /s /q "%INSTALL_DIR%"
    )
    echo   Downloading source code...
    git clone --depth 1 "https://github.com/%REPO%.git" "%INSTALL_DIR%"
    if exist "%TEMP%\odylic-templates-backup" (
        move "%TEMP%\odylic-templates-backup" "%INSTALL_DIR%\templates" >nul 2>nul
    )
)

cd /d "%INSTALL_DIR%"

REM Download templates if needed
set TEMPLATE_COUNT=0
if exist "%INSTALL_DIR%\templates" (
    for /f %%a in ('dir /b "%INSTALL_DIR%\templates" 2^>nul ^| find /c /v ""') do set TEMPLATE_COUNT=%%a
)
if %TEMPLATE_COUNT% lss 100 (
    echo   Downloading ad templates (~650 MB^)... this may take a few minutes.
    powershell -Command "try { $r = Invoke-RestMethod 'https://api.github.com/repos/%REPO%/releases/latest'; $url = ($r.assets | Where-Object { $_.name -like '*templates*zip*' } | Select-Object -First 1).browser_download_url; if ($url) { Invoke-WebRequest -Uri $url -OutFile '%TEMP%\odylic-templates.zip'; Expand-Archive -Path '%TEMP%\odylic-templates.zip' -DestinationPath '%INSTALL_DIR%\templates' -Force; Remove-Item '%TEMP%\odylic-templates.zip' -Force; Write-Host '  ✓ Templates installed' } else { Write-Host '  ⚠ Could not find template download' } } catch { Write-Host '  ⚠ Template download failed — app will work with custom templates only' }"
) else (
    echo   ✓ Templates already installed (%TEMPLATE_COUNT% files^)
)

REM Install npm dependencies
echo   Installing dependencies...
cd /d "%INSTALL_DIR%"
call npm install --loglevel=error

REM Create start.bat launcher (chromeless window)
(
echo @echo off
echo cd /d "%INSTALL_DIR%"
echo start /b /min cmd /c "npm run dev ^> .server.log 2^>^&1"
echo timeout /t 4 /nobreak ^> nul
echo REM Try Chrome --app mode for clean window ^(no URL bar, no tabs^)
echo set CHROME_PATH=
echo for %%%%p in ^(
echo     "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
echo     "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
echo     "%LocalAppData%\Google\Chrome\Application\chrome.exe"
echo ^) do if exist %%%%p set CHROME_PATH=%%%%p
echo if defined CHROME_PATH ^(
echo     start "" "%%CHROME_PATH%%" --app=http://localhost:3000 --new-window
echo     goto :eof
echo ^)
echo REM Try Edge --app mode
echo if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" ^(
echo     start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app=http://localhost:3000 --new-window
echo     goto :eof
echo ^)
echo REM Fallback to default browser
echo start http://localhost:3000
) > "%INSTALL_DIR%\start.bat"

REM Create desktop shortcut
echo   Creating desktop shortcut...
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Odylic Studio.lnk'); $s.TargetPath = '%INSTALL_DIR%\start.bat'; $s.WorkingDirectory = '%INSTALL_DIR%'; $s.Description = 'Odylic Studio - AI Ad Creative Tool'; $s.WindowStyle = 7; $s.Save()"
echo   ✓ Desktop shortcut created

echo.
echo   ╔═══════════════════════════════════════════╗
echo   ║  ✓ Installation complete!                 ║
echo   ║                                           ║
echo   ║  Double-click 'Odylic Studio' on your     ║
echo   ║  Desktop to launch the app anytime.       ║
echo   ╚═══════════════════════════════════════════╝
echo.
echo   Launching now...
echo.

REM Launch the app
start "" "%INSTALL_DIR%\start.bat"
