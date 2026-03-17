#!/bin/bash
# ─────────────────────────────────────────
#  Odylic Studio — One-command installer
#  macOS / Linux: curl -fsSL https://raw.githubusercontent.com/peterquads/odylic-studio/main/install.sh | bash
#  Windows (Git Bash): same command, or run install.bat
# ─────────────────────────────────────────

set -e

REPO="peterquads/odylic-studio"
INSTALL_DIR="$HOME/odylic-studio"

echo ""
echo "  ╔═══════════════════════════════╗"
echo "  ║     Installing Odylic Studio  ║"
echo "  ╚═══════════════════════════════╝"
echo ""

# 1. Check for Node.js
if ! command -v node &> /dev/null; then
  echo "  Node.js is required but not installed."
  echo "  Install it from: https://nodejs.org"
  echo ""
  if [[ "$OSTYPE" == "darwin"* ]]; then
    open "https://nodejs.org"
  elif command -v start &> /dev/null; then
    start "https://nodejs.org"
  elif command -v xdg-open &> /dev/null; then
    xdg-open "https://nodejs.org"
  fi
  exit 1
fi
echo "  ✓ Node.js $(node -v) found"

# 2. Check for git
if ! command -v git &> /dev/null; then
  echo "  Git is required but not installed."
  echo "  Install it from: https://git-scm.com"
  exit 1
fi
echo "  ✓ Git found"

# 3. Clone repo (source code only, ~50 MB)
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "  ✓ $INSTALL_DIR already exists — updating..."
  cd "$INSTALL_DIR"
  git pull --ff-only 2>/dev/null || true
elif [ -d "$INSTALL_DIR" ]; then
  # Directory exists but isn't a git repo (partial install) — save templates, re-clone
  echo "  Partial install detected — re-downloading source code..."
  if [ -d "$INSTALL_DIR/templates" ]; then
    mv "$INSTALL_DIR/templates" "${TMPDIR:-/tmp}/odylic-templates-backup"
  fi
  rm -rf "$INSTALL_DIR"
  git clone --depth 1 "https://github.com/$REPO.git" "$INSTALL_DIR"
  if [ -d "${TMPDIR:-/tmp}/odylic-templates-backup" ]; then
    mv "${TMPDIR:-/tmp}/odylic-templates-backup" "$INSTALL_DIR/templates"
  fi
  cd "$INSTALL_DIR"
else
  echo "  Downloading source code..."
  git clone --depth 1 "https://github.com/$REPO.git" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# 4. Download templates if not already present
TEMPLATE_COUNT=$(ls -1 "$INSTALL_DIR/templates" 2>/dev/null | wc -l | tr -d ' ')
if [ "$TEMPLATE_COUNT" -lt 100 ]; then
  echo "  Downloading ad templates (~650 MB)... this may take a few minutes."
  RELEASE_URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"browser_download_url".*templates.*zip' | head -1 | cut -d '"' -f 4)
  if [ -z "$RELEASE_URL" ]; then
    echo "  ⚠ Could not find template download. The app will still work with custom templates only."
  else
    TMP_ZIP="${TMPDIR:-/tmp}/odylic-templates.zip"
    if curl -fSL -o "$TMP_ZIP" "$RELEASE_URL"; then
      echo "  Extracting templates..."
      mkdir -p "$INSTALL_DIR/templates"
      unzip -qo "$TMP_ZIP" -d "$INSTALL_DIR/templates"
      rm -f "$TMP_ZIP"
      echo "  ✓ $(ls -1 "$INSTALL_DIR/templates" | wc -l | tr -d ' ') templates installed"
    else
      echo "  ⚠ Template download failed. The app will still work with custom templates only."
    fi
  fi
else
  echo "  ✓ Templates already installed ($TEMPLATE_COUNT files)"
fi

# 5. Install npm dependencies
echo "  Installing dependencies..."
cd "$INSTALL_DIR"
npm install --loglevel=error 2>&1 | tail -1

echo ""
echo "  ✓ Odylic Studio installed at $INSTALL_DIR"
echo ""

# 6. Create desktop app / shortcut
if [ -f "$INSTALL_DIR/scripts/create-app.sh" ]; then
  bash "$INSTALL_DIR/scripts/create-app.sh" "$INSTALL_DIR"
fi

echo ""
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║  ✓ Installation complete!                 ║"
echo "  ║                                           ║"
echo "  ║  Double-click 'Odylic Studio' on your     ║"
echo "  ║  Desktop to launch the app anytime.       ║"
echo "  ╚═══════════════════════════════════════════╝"
echo ""
echo "  Launching now..."
echo ""

# 7. Launch the app (starts server + opens chromeless window)
if [ -d "$HOME/Desktop/Odylic Studio.app" ]; then
  open "$HOME/Desktop/Odylic Studio.app"
else
  # Fallback: start server + open browser directly
  cd "$INSTALL_DIR"
  if [[ "$OSTYPE" == "darwin"* ]]; then
    (sleep 3 && open "http://localhost:3000") &
  elif command -v start &> /dev/null; then
    (sleep 3 && start "http://localhost:3000") &
  elif command -v xdg-open &> /dev/null; then
    (sleep 3 && xdg-open "http://localhost:3000") &
  fi
  npm run dev
fi
