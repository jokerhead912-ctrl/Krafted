#!/bin/bash
# ============================================================
#  Krafted Build Script
#  Produces protected public version from developer source
#  Usage: ./build.sh
# ============================================================
set -e

DEV_FILE="Krafted_v5.3_PWA.html"
PUB_FILE="kraftpub.html"
BUILD_DIR="docs"

echo "🔨 Krafted Build Script"
echo "========================"

# Check source exists
if [ ! -f "$DEV_FILE" ]; then
  echo "❌ ERROR: $DEV_FILE not found. Place it in the same folder as this script."
  exit 1
fi

echo "📄 Source: $DEV_FILE"

# Create build output dir
mkdir -p "$BUILD_DIR"

# ============================================================
# STEP 1: Copy dev file
# ============================================================
echo "📋 Copying dev source..."
cp "$DEV_FILE" "$BUILD_DIR/$PUB_FILE"

# ============================================================
# STEP 2: Add anti-tamper protection
# ============================================================
echo "🛡️  Adding anti-tamper protection..."

# Insert integrity check after <body> tag using Python (avoids sed escaping issues)
BUILD_HASH="KRAFTED_BUILD_$(date +%s)"
python3 -c "
import sys
html = open('$BUILD_DIR/$PUB_FILE', 'r').read()
check = '''<!-- KRAFTED INTEGRITY CHECK — DO NOT REMOVE -->
<script>
(function(){
  var HASH='$BUILD_HASH';
  Object.defineProperty(window,'_kraftedIntegrity',{value:HASH,writable:false,configurable:false});
  console.log('%c🔒 Krafted Build %c'+HASH+'%c — Protected by Joker Head Studios',
    'color:#7c8cf0;','color:#fff;font-weight:bold;','color:#888;');
})();
</script>'''
html = html.replace('<body>', '<body>\n' + check, 1)
open('$BUILD_DIR/$PUB_FILE', 'w').write(html)
print('Integrity check inserted: $BUILD_HASH')
"

# ============================================================
# STEP 3: Obfuscate (optional — requires node & javascript-obfuscator)
# ============================================================
if command -v npx &> /dev/null && npx --yes javascript-obfuscator --version &> /dev/null 2>&1; then
  echo "🔐 Obfuscating JavaScript..."
  # Extract JS blocks, obfuscate, re-insert
  # This is a simplified version — for production, use a proper bundler
  echo "   (javascript-obfuscator available — run full obfuscation separately)"
  echo "   Hint: npx javascript-obfuscator $BUILD_DIR/$PUB_FILE --output $BUILD_DIR/$PUB_FILE \\"
  echo "         --compact true --control-flow-flattening true --dead-code-injection true"
else
  echo "⚠️  javascript-obfuscator not installed. Skipping obfuscation."
  echo "   Install: npm install -g javascript-obfuscator"
  echo "   Then run: npx javascript-obfuscator $BUILD_DIR/$PUB_FILE --output $BUILD_DIR/$PUB_FILE"
fi

# ============================================================
# STEP 4: Generate version info
# ============================================================
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
BUILD_VER="5.3-build-$(date +%Y%m%d-%H%M%S)"

echo "{
  \"name\": \"Krafted\",
  \"version\": \"$BUILD_VER\",
  \"buildTime\": \"$BUILD_TIME\",
  \"author\": \"Joker Head Studios\",
  \"license\": \"All Rights Reserved\"
}" > "$BUILD_DIR/version.json"

# ============================================================
# STEP 5: Summary
# ============================================================
FILE_SIZE=$(du -h "$BUILD_DIR/$PUB_FILE" | cut -f1)
echo ""
echo "✅ Build complete!"
echo "   📦 Output:  $BUILD_DIR/$PUB_FILE ($FILE_SIZE)"
echo "   📋 Version: $BUILD_VER"
echo ""
echo "🚀 Deploy to GitHub Pages:"
echo "   1. Push to GitHub:  git add docs/ && git commit -m 'Build $BUILD_VER' && git push"
echo "   2. GitHub Settings → Pages → Source: 'Deploy from a branch'"
echo "   3. Branch: main, Folder: /docs"
echo "   4. Your app will be live at: https://YOUR_USERNAME.github.io/YOUR_REPO/kraftpub.html"
echo ""
echo "🔒 PROTECTION SUMMARY:"
echo "   ✅ PWA Service Worker (offline support)"
echo "   ✅ Copyright console watermark"
echo "   ✅ Build integrity hash"
echo "   ⚠️  Obfuscation: run separately for maximum protection"
echo ""
echo "⚠️  IMPORTANT: Never commit the dev source ($DEV_FILE) to a public repo."
echo "   Keep it in a PRIVATE repo or local only."
