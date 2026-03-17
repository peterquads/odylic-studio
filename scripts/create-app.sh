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

  # Info.plist
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

  # Launcher script
  cat > "$APP_PATH/Contents/MacOS/launch" << LAUNCHER
#!/bin/bash
INSTALL_DIR="$INSTALL_DIR"

# Function to kill server on exit
cleanup() {
  [ -n "\$SERVER_PID" ] && kill "\$SERVER_PID" 2>/dev/null
}
trap cleanup EXIT

cd "\$INSTALL_DIR"

# Check if already running
if curl -s http://localhost:3000 > /dev/null 2>&1; then
  open "http://localhost:3000"
  exit 0
fi

# Start server in background
npm run dev -- --host 2>/dev/null &
SERVER_PID=\$!

# Wait for server to be ready
for i in {1..30}; do
  if curl -s http://localhost:3000 > /dev/null 2>&1; then
    open "http://localhost:3000"
    break
  fi
  sleep 1
done

# Keep running until server dies
wait \$SERVER_PID
LAUNCHER

  chmod +x "$APP_PATH/Contents/MacOS/launch"

  echo "  ✓ App created at: ~/Desktop/Odylic Studio.app"
}

create_windows_shortcut() {
  # Create a .bat launcher and VBS to create desktop shortcut
  SHORTCUT_VBS="$INSTALL_DIR/create-shortcut.vbs"

  cat > "$SHORTCUT_VBS" << VBS
Set WshShell = CreateObject("WScript.Shell")
Set lnk = WshShell.CreateShortcut(WshShell.SpecialFolders("Desktop") & "\Odylic Studio.lnk")
lnk.TargetPath = "$INSTALL_DIR\start.bat"
lnk.WorkingDirectory = "$INSTALL_DIR"
lnk.Description = "Odylic Studio - AI Ad Creative Tool"
lnk.IconLocation = "$INSTALL_DIR\assets\odylic-icon.ico,0"
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
Exec=bash -c 'cd $INSTALL_DIR && npm run dev'
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
