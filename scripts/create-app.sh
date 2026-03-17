#!/bin/bash
# ─────────────────────────────────────────
#  Creates "Odylic Studio.app" on macOS or a desktop shortcut on Windows/Linux
#  Called by install.sh after setup completes
# ─────────────────────────────────────────

INSTALL_DIR="${1:-$HOME/odylic-studio}"

create_macos_app() {
  APP_PATH="$HOME/Desktop/Odylic Studio.app"

  # Remove old version if exists
  rm -rf "$APP_PATH"

  # Create .app bundle structure
  mkdir -p "$APP_PATH/Contents/MacOS"
  mkdir -p "$APP_PATH/Contents/Resources"

  # Copy icon if available
  if [ -f "$INSTALL_DIR/assets/OdylicStudio.icns" ]; then
    cp "$INSTALL_DIR/assets/OdylicStudio.icns" "$APP_PATH/Contents/Resources/AppIcon.icns"
  fi

  # Info.plist — LSUIElement hides the dock icon for the helper process
  cat > "$APP_PATH/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>launch</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>com.odylic.studio</string>
  <key>CFBundleName</key>
  <string>Odylic Studio</string>
  <key>CFBundleVersion</key>
  <string>1.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>10.13</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

  # Launcher script — starts server silently, opens chromeless browser window
  cat > "$APP_PATH/Contents/MacOS/launch" << LAUNCHER
#!/bin/bash

# macOS .app bundles run in a bare shell — load user's PATH so node/npm are found
export PATH="/usr/local/bin:/opt/homebrew/bin:\$HOME/.nvm/versions/node/\$(ls \$HOME/.nvm/versions/node/ 2>/dev/null | tail -1)/bin:/usr/bin:/bin:/usr/sbin:/sbin:\$PATH"
# Source shell profile if it exists (picks up nvm, volta, fnm, etc.)
[ -f "\$HOME/.zshrc" ] && source "\$HOME/.zshrc" 2>/dev/null
[ -f "\$HOME/.bashrc" ] && source "\$HOME/.bashrc" 2>/dev/null
[ -f "\$HOME/.bash_profile" ] && source "\$HOME/.bash_profile" 2>/dev/null

INSTALL_DIR="$INSTALL_DIR"
PORT=3000
URL="http://localhost:\$PORT"
LOG_FILE="\$INSTALL_DIR/.server.log"
PID_FILE="\$INSTALL_DIR/.server.pid"

# Kill old server if pid file exists
if [ -f "\$PID_FILE" ]; then
  OLD_PID=\$(cat "\$PID_FILE")
  kill "\$OLD_PID" 2>/dev/null
  rm -f "\$PID_FILE"
fi

# Check if already running
if curl -s "\$URL" > /dev/null 2>&1; then
  # Server already running — just open the window
  open_browser
  exit 0
fi

# Start server silently in background (no terminal window)
cd "\$INSTALL_DIR"
nohup npm run dev > "\$LOG_FILE" 2>&1 &
SERVER_PID=\$!
echo "\$SERVER_PID" > "\$PID_FILE"

# Wait for server to be ready (up to 30s)
for i in {1..30}; do
  if curl -s "\$URL" > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Open as a chromeless app window (no URL bar, no tabs)
# Try Chrome first, then Edge, then fallback to default browser
if [ -d "/Applications/Google Chrome.app" ]; then
  open -a "Google Chrome" --args --app="\$URL" --new-window
elif [ -d "/Applications/Microsoft Edge.app" ]; then
  open -a "Microsoft Edge" --args --app="\$URL" --new-window
elif [ -d "/Applications/Brave Browser.app" ]; then
  open -a "Brave Browser" --args --app="\$URL" --new-window
elif [ -d "/Applications/Chromium.app" ]; then
  open -a "Chromium" --args --app="\$URL" --new-window
else
  # Safari doesn't support --app mode, fall back to regular browser
  open "\$URL"
fi
LAUNCHER

  chmod +x "$APP_PATH/Contents/MacOS/launch"

  echo "  ✓ App created at: ~/Desktop/Odylic Studio.app"
  echo "    Double-click it anytime to launch — no terminal needed"
}

create_windows_shortcut() {
  # Create a start.bat that runs silently
  cat > "$INSTALL_DIR/start.bat" << 'BAT'
@echo off
cd /d "%~dp0"
start /b npm run dev > .server.log 2>&1
timeout /t 3 /nobreak > nul
start "" "http://localhost:3000"
BAT

  # Create VBS to make a desktop shortcut
  SHORTCUT_VBS="$INSTALL_DIR/create-shortcut.vbs"
  cat > "$SHORTCUT_VBS" << VBS
Set WshShell = CreateObject("WScript.Shell")
Set lnk = WshShell.CreateShortcut(WshShell.SpecialFolders("Desktop") & "\Odylic Studio.lnk")
lnk.TargetPath = "$INSTALL_DIR\start.bat"
lnk.WorkingDirectory = "$INSTALL_DIR"
lnk.Description = "Odylic Studio - AI Ad Creative Tool"
lnk.WindowStyle = 7
lnk.Save
VBS

  cscript //nologo "$SHORTCUT_VBS" 2>/dev/null
  rm -f "$SHORTCUT_VBS"

  echo "  ✓ Desktop shortcut created: Odylic Studio"
}

create_linux_desktop() {
  DESKTOP_FILE="$HOME/Desktop/odylic-studio.desktop"

  cat > "$DESKTOP_FILE" << DESKTOP
[Desktop Entry]
Type=Application
Name=Odylic Studio
Comment=AI Ad Creative Tool
Exec=bash -c 'cd $INSTALL_DIR && npm run dev & sleep 3 && xdg-open http://localhost:3000'
Icon=$INSTALL_DIR/assets/odylic-icon.png
Terminal=false
Categories=Graphics;Development;
DESKTOP

  chmod +x "$DESKTOP_FILE"
  echo "  ✓ Desktop shortcut created: ~/Desktop/odylic-studio.desktop"
}

# Detect OS and create appropriate launcher
if [[ "$OSTYPE" == "darwin"* ]]; then
  create_macos_app
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ -n "$WINDIR" ]]; then
  create_windows_shortcut
elif [[ "$OSTYPE" == "linux"* ]]; then
  create_linux_desktop
else
  echo "  ⚠ Unknown OS — skipping desktop shortcut"
fi
