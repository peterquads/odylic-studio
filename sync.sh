#!/bin/bash
# ─────────────────────────────────────────
#  Sync changes from main app → deploy repo & push to GitHub
#  Usage: ./sync.sh [commit message]
# ─────────────────────────────────────────

set -e

MAIN="$HOME/ad-creative-studio"
DEPLOY="$HOME/ad-creative-studio-deploy"

echo ""
echo "  Syncing main app → deploy repo..."
echo ""

# Sync src/, public/, index.html, and config files
rsync -av --delete \
  --exclude node_modules \
  --exclude .env \
  --exclude '.env.*' \
  --exclude dist \
  --exclude templates \
  --exclude .git \
  --exclude scripts \
  "$MAIN/src/" "$DEPLOY/src/"

# Sync other important files (only if they exist)
for f in index.html tailwind.config.js postcss.config.js tsconfig.json tsconfig.node.json; do
  [ -f "$MAIN/$f" ] && cp "$MAIN/$f" "$DEPLOY/$f"
done

# Sync public/ (but not templates)
rsync -av --delete \
  --exclude templates \
  "$MAIN/public/" "$DEPLOY/public/"

# Sync package.json dependencies (keep deploy's scripts intact)
# Just copy it — deploy-specific scripts were already set up
cp "$MAIN/package.json" "$DEPLOY/package.json"

cd "$DEPLOY"

# Check if there are changes
if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  echo "  No changes to sync."
  exit 0
fi

# Show what changed
echo "  Changes:"
git status --short
echo ""

# Commit and push
MSG="${1:-Sync latest changes from main app}"
git add -A
git commit -m "$MSG"
git push

echo ""
echo "  ✓ Pushed to GitHub. Install command is up to date."
echo ""
