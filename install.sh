#!/bin/bash
# ─────────────────────────────────────────
#  Odylic Studio — One-command installer
#  macOS / Linux: curl -fsSL https://raw.githubusercontent.com/peterquads/odylic-studio/main/install.sh | bash
#  Windows (PowerShell): irm https://raw.githubusercontent.com/peterquads/odylic-studio/main/install.ps1 | iex
# ─────────────────────────────────────────

set -e

REPO="peterquads/odylic-studio"
INSTALL_DIR="$HOME/odylic-studio"

echo ""
echo "  ╔═══════════════════════════════╗"
echo "  ║     Installing Odylic Studio  ║"
echo "  ╚═══════════════════════════════╝"
echo ""

# 1. Auto-install Git if missing
if ! command -v git &> /dev/null; then
  if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "  Installing Git via Xcode Command Line Tools..."
    echo "  (A popup may appear — click 'Install' and wait)"
    xcode-select --install 2>/dev/null || true
    # Wait for xcode-select to finish (user clicks Install in popup)
    until command -v git &> /dev/null; do
      sleep 5
    done
    echo "  ✓ Git installed"
  else
    echo "  Git is required but not installed."
    echo "  Install it from: https://git-scm.com"
    exit 1
  fi
else
  echo "  ✓ Git found"
fi

# 2. Auto-install Node.js if missing
if ! command -v node &> /dev/null; then
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # Try Homebrew first (fastest), then fall back to official installer
    if command -v brew &> /dev/null; then
      echo "  Installing Node.js via Homebrew..."
      brew install node
    else
      echo "  Installing Node.js..."
      NODE_VERSION="22.14.0"
      ARCH=$(uname -m)
      if [ "$ARCH" = "arm64" ]; then
        NODE_PKG="node-v${NODE_VERSION}-darwin-arm64.tar.gz"
      else
        NODE_PKG="node-v${NODE_VERSION}-darwin-x64.tar.gz"
      fi
      NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_PKG}"
      TMP_NODE="${TMPDIR:-/tmp}/$NODE_PKG"
      curl -fSL -o "$TMP_NODE" "$NODE_URL"
      sudo mkdir -p /usr/local/lib/nodejs
      sudo tar -xzf "$TMP_NODE" -C /usr/local/lib/nodejs
      NODE_DIR="/usr/local/lib/nodejs/node-v${NODE_VERSION}-darwin-${ARCH}"
      export PATH="$NODE_DIR/bin:$PATH"
      # Add to shell profile so it persists
      PROFILE="$HOME/.zprofile"
      if ! grep -q "nodejs" "$PROFILE" 2>/dev/null; then
        echo "export PATH=\"$NODE_DIR/bin:\$PATH\"" >> "$PROFILE"
      fi
      rm -f "$TMP_NODE"
    fi
    if command -v node &> /dev/null; then
      echo "  ✓ Node.js $(node -v) installed"
    else
      echo "  ✗ Node.js installation failed. Install manually from https://nodejs.org"
      exit 1
    fi
  else
    echo "  Node.js is required but not installed."
    echo "  Install it from: https://nodejs.org"
    exit 1
  fi
else
  echo "  ✓ Node.js $(node -v) found"
fi

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

# 6. Build production bundle (so we can serve with preview — much lighter on CPU)
echo "  Building app..."
npm run build --loglevel=error 2>&1 | tail -1
echo "  ✓ Build complete"

echo ""
echo "  ✓ Odylic Studio installed at $INSTALL_DIR"
echo ""

# 7. Create desktop app / shortcut
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

# 8. Start server and open default browser
cd "$INSTALL_DIR"

# Kill anything already on port 3000
lsof -ti:3000 2>/dev/null | xargs kill 2>/dev/null || true

# Start preview server in background (lightweight — no file watching or HMR)
nohup npm start > "$INSTALL_DIR/.server.log" 2>&1 &
echo $! > "$INSTALL_DIR/.server.pid"

# Wait for server to be ready, then open default browser
(
  for i in $(seq 1 30); do
    if curl -s "http://localhost:3000" > /dev/null 2>&1; then
      if [[ "$OSTYPE" == "darwin"* ]]; then
        open "http://localhost:3000"
      elif command -v start &> /dev/null; then
        start "http://localhost:3000"
      elif command -v xdg-open &> /dev/null; then
        xdg-open "http://localhost:3000"
      fi
      exit 0
    fi
    sleep 1
  done
  echo "  ⚠ Server didn't start in time. Run: cd ~/odylic-studio && npm start"
) &

echo "  Server starting on http://localhost:3000"
echo "  Your browser will open automatically in a few seconds."
echo ""
echo "  To stop the server: kill \$(cat ~/odylic-studio/.server.pid)"
echo ""
