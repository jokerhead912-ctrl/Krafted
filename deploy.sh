#!/bin/bash
# Krafted Deploy Script
# Copies kraftpub-v6.1.html → root kraftpub.html AND docs/kraftpub.html
# Then commits + pushes to GitHub Pages
set -e

SOURCE="/workspace/kraftpub-v6.2.html"
ROOT_DEST="/workspace/Krafted/kraftpub.html"
DOCS_DEST="/workspace/Krafted/docs/kraftpub.html"

if [ ! -f "$SOURCE" ]; then
  echo "❌ Source not found: $SOURCE"
  exit 1
fi

VER=$(grep -oP "KRAFTED_VERSION = '\K[^']*" "$SOURCE")
echo "🚀 Deploying Krafted v$VER..."

cp "$SOURCE" "$ROOT_DEST"
cp "$SOURCE" "$DOCS_DEST"

cd /workspace/Krafted
git add kraftpub.html docs/kraftpub.html
git commit -m "v$VER: deploy" || echo "⚠ Nothing to commit"
git push

echo "✅ v$VER deployed to GitHub Pages"
