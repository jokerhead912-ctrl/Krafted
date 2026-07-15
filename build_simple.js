/**
 * Krafted v5.5 — Simple Build Script
 * Concatenates all source files in dependency order (no esbuild module system).
 * Removes all import/export statements since everything shares one global scope.
 */
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');
const JS_DIR = path.join(SRC_DIR, 'js');
const LIB_DIR = path.join(SRC_DIR, 'lib');
const OUTPUT = process.argv[2] || path.join(__dirname, 'docs', 'kraftpub.html');

// Dependency order — files that define functions used by others come first
const JS_ORDER = [
  'storage.js',
  'core-state.js',
  'i18n.js',
  'shortcut-editor.js',
  'canvas-view.js',
  'undo-redo.js',
  'selection.js',
  'layout-tidy.js',
  'add-items.js',
  'media-player.js',
  'video-trim.js',
  'video-playback.js',
  'frame-comments.js',
  'media-bar.js',
  'gif-editor.js',
  'audio.js',
  'props-panel.js',
  'text-style.js',
  'tools.js',
  'grid-fs.js',
  'ui-utils.js',
  'help.js',
  'text-sanitizer.js',
  'auto-save.js',
  'pointer-events.js',
  'touch-events.js',
  'wheel-zoom.js',
  'file-drop.js',
  'paste-handler.js',
  'keyboard.js',
  'mouse-events.js',
  'masking.js',
  'paper.js',
  'groups.js',
  'alignment.js',
  'clipboard.js',
  'delete.js',
  'draw-layer.js',
  'draw-items.js',
  'cut-lasso.js',
  'todo.js',
  'mindmap.js',
  'relations.js',
  'reframe-crop.js',
  'export.js',
  'capture.js',
  'translation.js',
  'media-export.js',
  'save-load.js',
  'init.js',
];

console.log('🔨 Krafted v5.5 — Building (simple concat)...\n');

// Step 1: Concatenate all JS files, stripping import/export
console.log('  📦 Concatenating JS modules...');
let allJS = '';
let totalStripped = 0;

for (const fname of JS_ORDER) {
  const fpath = path.join(JS_DIR, fname);
  if (!fs.existsSync(fpath)) {
    console.log(`     ⚠ Skipping missing: ${fname}`);
    continue;
  }
  let content = fs.readFileSync(fpath, 'utf8');
  const origLen = content.length;
  
  // Remove ALL import lines (single-line: "import { ... } from '...';")
  // Use line-by-line filter first, then regex for any remaining multi-line
  let lines = content.split('\n');
  lines = lines.filter(line => {
    const trimmed = line.trimStart();
    return !trimmed.startsWith('import ') && !trimmed.startsWith('export {') && !trimmed.startsWith('export default');
  });
  content = lines.join('\n');
  
  // Remove multi-line import blocks
  content = content.replace(/import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"]\s*;?\s*/g, '');
  
  // Remove ALL export keywords from function/let/const/var declarations
  content = content.replace(/^(\s*)export\s+(async\s+)?function\b/gm, '$1$2function');
  content = content.replace(/^(\s*)export\s+(let|const|var)\b/gm, '$1$2');
  
  // Clean up multiple blank lines
  content = content.replace(/\n{3,}/g, '\n\n');
  
  const stripped = origLen - content.length;
  totalStripped += stripped;
  
  allJS += `\n// ==== ${fname} ====\n` + content + '\n';
  
  if (stripped > 0) {
    console.log(`     ✓ ${fname} (${origLen.toLocaleString()} → ${content.length.toLocaleString()} bytes, -${stripped})`);
  } else {
    console.log(`     ✓ ${fname} (${content.length.toLocaleString()} bytes)`);
  }
}

console.log(`     ✓ Total JS: ${allJS.length.toLocaleString()} bytes (stripped ${totalStripped.toLocaleString()} bytes of imports/exports)`);

// Step 2: Prepend lib files (collect in order, then prepend all at once)
console.log('  📚 Prepending lib files...');
const libs = ['jszip.js', 'krafted-format.js', 'krafted-bridge.js', 'sw-register.js'];
let libJS = '';
for (const lib of libs) {
  const libPath = path.join(LIB_DIR, lib);
  if (fs.existsSync(libPath)) {
    const content = fs.readFileSync(libPath, 'utf8');
    libJS += content + '\n';
    console.log(`     + ${lib} (${content.length.toLocaleString()} bytes)`);
  }
}
// Prepend libs to main JS (libs execute first)
allJS = libJS + '\n' + allJS;

// Step 2b: Copy standalone sw.js to output directory (it must be a real
// file — browsers reject blob: URL SW registration on secure origins).
console.log('  🛡  Copying service worker...');
const _swOutDir = path.dirname(OUTPUT);
if (!fs.existsSync(_swOutDir)) fs.mkdirSync(_swOutDir, { recursive: true });
const swSource = path.join(LIB_DIR, 'sw.js');
if (fs.existsSync(swSource)) {
  const swContent = fs.readFileSync(swSource, 'utf8');
  const swDest = path.join(_swOutDir, 'sw.js');
  fs.writeFileSync(swDest, swContent, 'utf8');
  console.log(`     + sw.js (${swContent.length.toLocaleString()} bytes)`);
}

// Step 3: Read CSS
console.log('  🎨 Reading CSS...');
const cssPath = path.join(SRC_DIR, 'styles.css');
const css = fs.readFileSync(cssPath, 'utf8');
console.log(`     ✓ ${css.length.toLocaleString()} bytes`);

// Step 4: Read index.html and inject
console.log('  📄 Injecting into HTML...');
let html = fs.readFileSync(path.join(SRC_DIR, 'index.html'), 'utf8');

// Replace CSS link with inline style
html = html.replace(
  '<link rel="stylesheet" href="styles.css">',
  `<style>\n${css}\n</style>`
);

// Remove lib script tags (now in bundle) and replace module script
html = html.replace(
  /<!-- Krafted Format Engine -->[\s\S]*?<\/script>\s*<!-- PWA Service Worker -->[\s\S]*?<\/script>/,
  ''
);
html = html.replace(
  '<!-- Main application — bundled by esbuild at build time -->\n<script type="module" src="js/init.js"></script>',
  `<script>\n${allJS}\n</script>`
);

// Step 5: Write output
const outDir = path.dirname(OUTPUT);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(OUTPUT, html, 'utf8');
console.log(`\n✅ Built: ${OUTPUT} (${html.length.toLocaleString()} bytes)`);

// Also sync to docs/ with versioned name
const versionedOutput = path.join(__dirname, 'docs', 'Krafted_v5.5_PWA.html');
fs.writeFileSync(versionedOutput, html, 'utf8');
console.log(`✅ Also synced: ${versionedOutput}`);
