#!/bin/bash
# ─────────────────────────────────────────
#  Odylic Studio — One-command installer
#  Usage: curl -fsSL https://raw.githubusercontent.com/peterquads/odylic-studio/main/install.sh | bash
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
    echo "  Opening download page..."
    open "https://nodejs.org"
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
if [ -d "$INSTALL_DIR" ]; then
  echo "  ✓ $INSTALL_DIR already exists — updating..."
  cd "$INSTALL_DIR"
  git pull --ff-only 2>/dev/null || true
else
  echo "  Downloading source code..."
  git clone --depth 1 "https://github.com/$REPO.git" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# 4. Download templates if not already present
if [ ! -d "$INSTALL_DIR/templates" ] || [ "$(ls -1 "$INSTALL_DIR/templates" 2>/dev/null | wc -l)" -lt 100 ]; then
  echo "  Downloading ad templates (~650 MB)... this may take a few minutes."
  RELEASE_URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"browser_download_url".*templates.*zip' | head -1 | cut -d '"' -f 4)
  if [ -z "$RELEASE_URL" ]; then
    echo "  ⚠ Could not find template download. The app will still work with custom templates only."
  else
    curl -fSL -o /tmp/odylic-templates.zip "$RELEASE_URL"
    echo "  Extracting templates..."
    mkdir -p "$INSTALL_DIR/templates"
    unzip -qo /tmp/odylic-templates.zip -d "$INSTALL_DIR/templates"
    rm -f /tmp/odylic-templates.zip
    echo "  ✓ $(ls -1 "$INSTALL_DIR/templates" | wc -l | tr -d ' ') templates installed"
  fi
else
  echo "  ✓ Templates already installed ($(ls -1 "$INSTALL_DIR/templates" | wc -l | tr -d ' ') files)"
fi

# 5. Install npm dependencies
echo "  Installing dependencies..."
cd "$INSTALL_DIR"
npm install --loglevel=error 2>&1 | tail -1

echo ""
echo "  ✓ Odylic Studio installed at $INSTALL_DIR"
echo ""
echo "  Starting the app..."
echo ""

# 6. Open browser + start server
if [[ "$OSTYPE" == "darwin"* ]]; then
  (sleep 2 && open "http://localhost:3000") &
elif command -v xdg-open &> /dev/null; then
  (sleep 2 && xdg-open "http://localhost:3000") &
fi

npm run dev
