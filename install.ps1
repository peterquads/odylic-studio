# ─────────────────────────────────────────
#  Odylic Studio — One-command Windows installer
#  Run in PowerShell:
#    irm https://raw.githubusercontent.com/peterquads/odylic-studio/main/install.ps1 | iex
# ─────────────────────────────────────────

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # Invoke-WebRequest is 10-100x slower with progress bar

# Ensure scripts (like npm.ps1) can run — Windows blocks them by default
$currentPolicy = Get-ExecutionPolicy -Scope CurrentUser
if ($currentPolicy -eq "Restricted" -or $currentPolicy -eq "Undefined") {
    Write-Host "  Enabling script execution for current user..."
    Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
}

$REPO = "peterquads/odylic-studio"
$INSTALL_DIR = Join-Path $HOME "odylic-studio"

Write-Host ""
Write-Host "  ╔═══════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║     Installing Odylic Studio  ║" -ForegroundColor Cyan
Write-Host "  ╚═══════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── 1. Check for Git ──────────────────────────────────────────

$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCmd) {
    Write-Host "  Git is not installed." -ForegroundColor Yellow
    Write-Host "  Downloading Git for Windows..."

    $gitInstaller = Join-Path $env:TEMP "git-installer.exe"
    # Get latest Git for Windows release URL
    $gitRelease = Invoke-RestMethod "https://api.github.com/repos/git-for-windows/git/releases/latest"
    $gitUrl = ($gitRelease.assets | Where-Object { $_.name -match "64-bit\.exe$" -and $_.name -match "^Git-" } | Select-Object -First 1).browser_download_url

    if (-not $gitUrl) {
        Write-Host "  Could not find Git installer. Please install manually from https://git-scm.com" -ForegroundColor Red
        exit 1
    }

    Invoke-WebRequest -Uri $gitUrl -OutFile $gitInstaller -UseBasicParsing
    Write-Host "  Running Git installer (follow the prompts)..."
    Start-Process -FilePath $gitInstaller -ArgumentList "/VERYSILENT", "/NORESTART" -Wait
    Remove-Item $gitInstaller -ErrorAction SilentlyContinue

    # Refresh PATH so git is available
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    $gitCmd = Get-Command git -ErrorAction SilentlyContinue
    if (-not $gitCmd) {
        Write-Host "  Git installed but not found in PATH. Please restart PowerShell and run this script again." -ForegroundColor Red
        exit 1
    }
    Write-Host "  * Git installed" -ForegroundColor Green
} else {
    Write-Host "  * Git found" -ForegroundColor Green
}

# ── 2. Check for Node.js ─────────────────────────────────────

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "  Node.js is not installed." -ForegroundColor Yellow
    Write-Host "  Downloading Node.js LTS..."

    $nodeVersion = "22.14.0"
    $nodeInstaller = Join-Path $env:TEMP "node-installer.msi"
    $nodeUrl = "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-x64.msi"

    Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeInstaller -UseBasicParsing
    Write-Host "  Running Node.js installer (follow the prompts)..."
    Start-Process msiexec.exe -ArgumentList "/i", $nodeInstaller, "/passive", "/norestart" -Wait
    Remove-Item $nodeInstaller -ErrorAction SilentlyContinue

    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCmd) {
        Write-Host "  Node.js installed but not found in PATH. Please restart PowerShell and run this script again." -ForegroundColor Red
        exit 1
    }
    $nodeVer = & node -v
    Write-Host "  * Node.js $nodeVer installed" -ForegroundColor Green
} else {
    $nodeVer = & node -v
    Write-Host "  * Node.js $nodeVer found" -ForegroundColor Green
}

# ── 3. Clone repo ────────────────────────────────────────────

if (Test-Path (Join-Path $INSTALL_DIR ".git")) {
    Write-Host "  * $INSTALL_DIR already exists - updating..." -ForegroundColor Green
    Push-Location $INSTALL_DIR
    & git pull --ff-only 2>$null
    Pop-Location
} elseif (Test-Path $INSTALL_DIR) {
    Write-Host "  Partial install detected - re-downloading source code..."
    $templatesBackup = $null
    $templatesDir = Join-Path $INSTALL_DIR "templates"
    if (Test-Path $templatesDir) {
        $templatesBackup = Join-Path $env:TEMP "odylic-templates-backup"
        if (Test-Path $templatesBackup) { Remove-Item $templatesBackup -Recurse -Force }
        Move-Item $templatesDir $templatesBackup
    }
    Remove-Item $INSTALL_DIR -Recurse -Force
    & git clone --depth 1 "https://github.com/$REPO.git" $INSTALL_DIR
    if ($templatesBackup -and (Test-Path $templatesBackup)) {
        Move-Item $templatesBackup (Join-Path $INSTALL_DIR "templates")
    }
} else {
    Write-Host "  Downloading source code..."
    & git clone --depth 1 "https://github.com/$REPO.git" $INSTALL_DIR
}

# ── 4. Download templates if needed ──────────────────────────

$templatesDir = Join-Path $INSTALL_DIR "templates"
$templateCount = 0
if (Test-Path $templatesDir) {
    $templateCount = (Get-ChildItem $templatesDir -ErrorAction SilentlyContinue | Measure-Object).Count
}

if ($templateCount -lt 100) {
    Write-Host "  Downloading ad templates (~650 MB)... this may take a few minutes."
    try {
        $release = Invoke-RestMethod "https://api.github.com/repos/$REPO/releases/latest"
        $zipAsset = $release.assets | Where-Object { $_.name -match "templates.*\.zip" } | Select-Object -First 1
        if ($zipAsset) {
            $zipPath = Join-Path $env:TEMP "odylic-templates.zip"
            Invoke-WebRequest -Uri $zipAsset.browser_download_url -OutFile $zipPath -UseBasicParsing
            Write-Host "  Extracting templates..."
            if (-not (Test-Path $templatesDir)) { New-Item -ItemType Directory -Path $templatesDir | Out-Null }
            Expand-Archive -Path $zipPath -DestinationPath $templatesDir -Force
            Remove-Item $zipPath -ErrorAction SilentlyContinue
            $finalCount = (Get-ChildItem $templatesDir -ErrorAction SilentlyContinue | Measure-Object).Count
            Write-Host "  * $finalCount templates installed" -ForegroundColor Green
        } else {
            Write-Host "  Warning: Could not find template download. The app will still work with custom templates only." -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  Warning: Template download failed. The app will still work with custom templates only." -ForegroundColor Yellow
    }
} else {
    Write-Host "  * Templates already installed ($templateCount files)" -ForegroundColor Green
}

# ── 5. Install npm dependencies ──────────────────────────────

Write-Host "  Installing dependencies..."
Push-Location $INSTALL_DIR
& npm install --loglevel=error 2>&1 | Select-Object -Last 1
Pop-Location

Write-Host ""
Write-Host "  * Odylic Studio installed at $INSTALL_DIR" -ForegroundColor Green
Write-Host ""

# ── 6. Create start.bat launcher ─────────────────────────────

# Find npm.cmd path (more reliable than bare "npm" on Windows)
$npmCmd = (Get-Command npm -ErrorAction SilentlyContinue).Source
if ($npmCmd -and $npmCmd.EndsWith(".ps1")) {
    # npm.ps1 wrapper — use npm.cmd instead for bat/cmd contexts
    $npmCmd = $npmCmd -replace "\.ps1$", ".cmd"
}
if (-not $npmCmd) { $npmCmd = "npm" }

$startBat = Join-Path $INSTALL_DIR "start.bat"
@"
@echo off
cd /d "%~dp0"

REM Check if server is already running
powershell -Command "try { Invoke-WebRequest -Uri http://localhost:3000 -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 (
    start http://localhost:3000
    exit /b
)

REM Start server in a hidden window
start /min "" cmd /c "$npmCmd run dev > .server.log 2>&1"

REM Wait for server then open browser
echo Starting Odylic Studio...
for /L %%i in (1,1,60) do (
    powershell -Command "try { Invoke-WebRequest -Uri http://localhost:3000 -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
    if !errorlevel!==0 (
        start http://localhost:3000
        exit /b
    )
    timeout /t 1 /nobreak >nul
)
echo Could not start server. Run: cd %~dp0 ^&^& npm run dev
pause
"@ | Set-Content -Path $startBat -Encoding ASCII

# ── 7. Create desktop shortcut ────────────────────────────────

try {
    $desktopPath = [System.Environment]::GetFolderPath("Desktop")
    $shortcutPath = Join-Path $desktopPath "Odylic Studio.lnk"

    $WshShell = New-Object -ComObject WScript.Shell
    $shortcut = $WshShell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $startBat
    $shortcut.WorkingDirectory = $INSTALL_DIR
    $shortcut.Description = "Odylic Studio - AI Ad Creative Tool"
    $shortcut.WindowStyle = 7  # Minimized
    # Use app icon if available
    $iconPath = Join-Path $INSTALL_DIR "assets\OdylicStudio.ico"
    if (Test-Path $iconPath) {
        $shortcut.IconLocation = $iconPath
    }
    $shortcut.Save()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($WshShell) | Out-Null

    Write-Host "  * Desktop shortcut created: Odylic Studio" -ForegroundColor Green
} catch {
    Write-Host "  Warning: Could not create desktop shortcut: $_" -ForegroundColor Yellow
    Write-Host "  You can launch manually: cd ~/odylic-studio && npm run dev" -ForegroundColor Yellow
}

# Also copy start.bat to Desktop as a fallback if shortcut failed
$desktopBat = Join-Path ([System.Environment]::GetFolderPath("Desktop")) "Odylic Studio.bat"
if (-not (Test-Path (Join-Path ([System.Environment]::GetFolderPath("Desktop")) "Odylic Studio.lnk"))) {
    Copy-Item $startBat $desktopBat -Force
    Write-Host "  * Copied start.bat to Desktop as fallback" -ForegroundColor Green
}

Write-Host ""
Write-Host "  ╔═══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║  * Installation complete!                 ║" -ForegroundColor Cyan
Write-Host "  ║                                           ║" -ForegroundColor Cyan
Write-Host "  ║  Double-click 'Odylic Studio' on your     ║" -ForegroundColor Cyan
Write-Host "  ║  Desktop to launch the app anytime.       ║" -ForegroundColor Cyan
Write-Host "  ╚═══════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── 8. Launch now ─────────────────────────────────────────────

Write-Host "  Launching now..."
Write-Host ""

Push-Location $INSTALL_DIR

# Kill anything on port 3000
$portProcess = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
if ($portProcess) {
    $portProcess | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}

# Start dev server in background using cmd (avoids ps1 execution issues)
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"$npmCmd`" run dev > .server.log 2>&1" -WindowStyle Hidden

# Wait for server then open browser — 60s timeout (first Vite run is slow)
Write-Host "  Waiting for server to start (first run may take a minute)..."
$attempts = 0
while ($attempts -lt 60) {
    try {
        Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop | Out-Null
        Start-Process "http://localhost:3000"
        Write-Host "  * Browser opened" -ForegroundColor Green
        break
    } catch {
        Start-Sleep -Seconds 1
        $attempts++
    }
}

if ($attempts -ge 60) {
    Write-Host "  Server is still starting. Opening browser anyway..." -ForegroundColor Yellow
    Start-Process "http://localhost:3000"
}

Pop-Location

Write-Host ""
Write-Host "  Server running on http://localhost:3000"
Write-Host ""
