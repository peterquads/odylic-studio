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

  # Launcher script — starts server silently, opens default browser
  cat > "$APP_PATH/Contents/MacOS/launch" << 'LAUNCHER'
#!/bin/bash

# macOS .app bundles run in a bare shell — need to find node/npm
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
[ -f "$HOME/.zprofile" ] && source "$HOME/.zprofile" 2>/dev/null
[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" 2>/dev/null

INSTALL_DIR="$HOME/odylic-studio"
PORT=3000
URL="http://localhost:$PORT"
LOG_FILE="$INSTALL_DIR/.server.log"
PID_FILE="$INSTALL_DIR/.server.pid"

# If server already running, just open browser and exit
if curl -s "$URL" > /dev/null 2>&1; then
  open "$URL"
  exit 0
fi

# Kill stale server if pid file exists
if [ -f "$PID_FILE" ]; then
  kill "$(cat "$PID_FILE")" 2>/dev/null
  rm -f "$PID_FILE"
fi

# Start server in background
cd "$INSTALL_DIR"
nohup npm start > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

# Wait for server then open browser — in background so .app exits immediately
(
  for i in $(seq 1 30); do
    if curl -s "$URL" > /dev/null 2>&1; then
      open "$URL"
      exit 0
    fi
    sleep 1
  done
) &

exit 0
LAUNCHER

  chmod +x "$APP_PATH/Contents/MacOS/launch"

  echo "  ✓ App created at: ~/Desktop/Odylic Studio.app"
  echo "    Double-click it anytime to launch — no terminal needed"
}

create_windows_shortcut() {
  # Create a start.bat launcher — runs server hidden, opens default browser
  cat > "$INSTALL_DIR/start.bat" << 'BAT'
@echo off
cd /d "%~dp0"
start /b /min cmd /c "npm run dev > .server.log 2>&1"
timeout /t 4 /nobreak > nul
start http://localhost:3000
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
