#!/bin/bash
# ─────────────────────────────────────────
#  Odylic Studio — Double-click to launch
# ─────────────────────────────────────────

cd "$(dirname "$0")"

echo ""
echo "  ╔═══════════════════════════════╗"
echo "  ║       Odylic Studio           ║"
echo "  ╚═══════════════════════════════╝"
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
  echo "  Node.js is required but not installed."
  echo ""
  echo "  Download it from: https://nodejs.org"
  echo ""
  echo "  Press any key to open the download page..."
  read -n 1 -s
  open "https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node -v)
echo "  Node.js $NODE_VERSION found"

# Install dependencies on first run
if [ ! -d "node_modules" ]; then
  echo ""
  echo "  First launch — installing dependencies..."
  echo "  (This may take a minute)"
  echo ""
  npm install
  echo ""
fi

echo ""
echo "  Starting Odylic Studio..."
echo "  Opening http://localhost:3000 in your browser..."
echo ""
echo "  Press Ctrl+C to stop the server."
echo ""

# Open browser after a short delay, then start server (blocks)
(sleep 2 && open "http://localhost:3000") &
npm run dev
