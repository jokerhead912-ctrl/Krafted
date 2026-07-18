/**
 * Krafted v5.4 — Build Script
 *
 * Takes the modular source in src/ and bundles everything into a single
 * self-contained kraftpub.html, ready for GitHub Pages deployment.
 *
 * How it works:
 * 1. esbuild bundles all JS modules into one IIFE script
 * 2. Prepend lib files (jszip, krafted-format, bridge, sw-register)
 * 3. Read index.html and inline CSS + JS into it
 * 4. Write the final HTML to the output path
 *
 * Usage: node build.js [output_path]
 *   Default output: ../krafted-build/docs/kraftpub.html
 */

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');
const JS_DIR = path.join(SRC_DIR, 'js');
const LIB_DIR = path.join(SRC_DIR, 'lib');
const OUTPUT = process.argv[2] || path.join(__dirname, '..', 'krafted-build', 'docs', 'kraftpub.html');

async function build() {
  console.log('🔨 Krafted v5.4 — Building...\n');

  // ── Step 1: Bundle JS modules with esbuild ──
  console.log('  📦 Bundling JS modules...');
  const entry = path.join(JS_DIR, 'init.js');
  const bundleResult = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    globalName: '__kraft',
    platform: 'browser',
    target: 'es2020',
    write: false,
    outfile: 'app.bundle.js',
    minify: false,
    keepNames: true,
    // Allow top-level await (needed for some dynamic imports)
    supported: { 'top-level-await': true },
    // Wrap top-level code in try/catch so a single null-ref doesn't kill the app
    banner: {
      js: 'try {'
    },
    footer: {
      js: '} catch (_kraftTopLevelErr) { console.error("[Krafted] Top-level init error:", _kraftTopLevelErr); }'
    }
  });

  let bundledJS = bundleResult.outputFiles[0].text;

  // esbuild IIFE wraps everything in a closure. The original code relied on
  // top-level `function xxx()` declarations being implicitly global (window.xxx).
  // We inject a bridge block INSIDE the IIFE (before the closing `})();`) that
  // exposes every function/state to window, so all inline onclick handlers work.
  const exposureBlock = `
  // ── Global exposure: bridge IIFE closure back to window ──
  if (typeof window !== "undefined") {
    window.state = state;
    window.IS_TOUCH_DEVICE = IS_TOUCH_DEVICE;
    window._frozenGifs = _frozenGifs;
    window.KRAFTED_VERSION = KRAFTED_VERSION;
    var _expFuncs = [
      hideWelcome,showWelcome,addImage,addText,addLinkCard,addMindMap,addTodo,
      addAudioItem,selectOnly,clearSelection,toggleSelect,deleteSelected,
      updatePropsPanel,updateCanvas,frameSelection,zoomBy,zoomTo,setTool,
      saveBoard,loadBoardFile,openLinkModal,closeLinkModal,showCtx,hideCtx,
      toast,triggerPaste,toggleGrid,toggleAppFullscreen,toggleAltPan,
      showHelp,hideHelp,togglePaper,setPaperSize,setPaperColor,toggleAutoFit,
      openGifEditor,captureArea,captureScreen,startExportDrag,setCaptureMode,
      toggleTextStyle,setTextProp,setTextAlign,enterReframe,exitReframe,
      enterCrop,exitCrop,enterCutMode,enterLassoMode,copySelected,
      pasteClipboard,duplicateSelected,undo,redo,pushUndo,playAllMedia,
      pauseAllMedia,restartVideo,toggleVideoPlay,setVideoVolume,
      groupSelected,ungroupSelected,alignItems,layerOrder,setDrawMode,
      clearDraw,undoDraw,discardCaptureResult,saveCaptureResult,
      pasteCaptureToBoard,saveCapturePanelToFolder,translateSelectedText,
      newBoard,updatePaper,tidySelection,tidyAll,exportMediaSelected,
      formatBytes,buildKpakBlob,downloadBlob,showSaveLockPrompt,
      closeSaveLockPrompt,showPasswordDisplayModal,closePasswordDisplay,
      copyGeneratedPassword,showUnlockModal,closeUnlockModal,tryUnlockFile,
      addMaskLayer,deleteMaskLayer,toggleMask,setCanvasBg,showTextQuickBar,
      updateTextQuickBarActive,applyTextColorToSelected,applyTextStyleToSelected,
      applyInlineColor,applyInlineSize,getEditingText,flipH,flipV,toggleLock,
      setOpacity,setRotation,setPhotoFilter,resetPhotoFilters,setCgiFilter,
      resetVideoTrim,seekVideo,setVideoPlaybackRate,setVideoTimeMode,
      handleAudioUpload,_handleFileDrop,sanitizeTextHtml,updateAltPanBadge,
      buildMediaControls,updateMediaBar,restoreBoard,serializeBoard,
      buildManifest,updateItemStyle,autoGrowTextItem,applyTextProps,
      refreshSelection,getSelectedItems,getSelectedImages,redrawDrawLayer,
      updateAllGroupBorders,initTextToolbar,scheduleAutoSave,loadAutoSave
    ];
    for (var _ei = 0; _ei < _expFuncs.length; _ei++) {
      if (typeof _expFuncs[_ei] === "function") {
        window[_expFuncs[_ei].name] = _expFuncs[_ei];
      }
    }
  }
`;
  // Inject INSIDE the IIFE, right before the return statement
  bundledJS = bundledJS.replace(
    /(\s*return __toCommonJS\(init_exports\);)/,
    exposureBlock + '\n$1'
  );

  // ── Step 2: Prepend lib files ──
  console.log('  📚 Prepending lib files...');
  const libs = ['jszip.js', 'krafted-format.js', 'krafted-bridge.js', 'sw-register.js'];
  let allJS = '';
  for (const lib of libs) {
    const libPath = path.join(LIB_DIR, lib);
    if (fs.existsSync(libPath)) {
      const content = fs.readFileSync(libPath, 'utf8');
      allJS += content + '\n';
      console.log(`     + ${lib} (${content.length.toLocaleString()} bytes)`);
    }
  }
  allJS += '\n' + bundledJS;
  console.log(`     ✓ Total JS: ${allJS.length.toLocaleString()} bytes`);

  // ── Step 3: Read CSS ──
  console.log('  🎨 Reading CSS...');
  const cssPath = path.join(SRC_DIR, 'styles.css');
  const css = fs.readFileSync(cssPath, 'utf8');
  console.log(`     ✓ ${css.length.toLocaleString()} bytes`);

  // ── Step 4: Read index.html and inject ──
  console.log('  📄 Injecting into HTML...');
  let html = fs.readFileSync(path.join(SRC_DIR, 'index.html'), 'utf8');

  // Replace CSS link with inline style
  html = html.replace(
    '<link rel="stylesheet" href="styles.css">',
    `<style>\n${css}\n</style>`
  );

  // Replace the module script tag with inline script
  // (remove the lib script tags too since they're now in the bundle)
  html = html.replace(
    /<!-- Krafted Format Engine -->[\s\S]*?<\/script>\s*<!-- PWA Service Worker -->[\s\S]*?<\/script>/,
    ''
  );
  html = html.replace(
    '<!-- Main application — bundled by esbuild at build time -->\n<script type="module" src="js/init.js"></script>',
    `<script>\n${allJS}\n</script>`
  );

  // ── Step 4b: Inject global exposure block ──
  // esbuild IIFE wraps everything in a closure, so functions that were
  // implicitly global (via `function xxx()` at top-level in the original
  // single-file HTML) are no longer on `window`. Many inline onclick
  // handlers in the HTML body (and external callers) rely on these being
  // globally accessible. This block bridges the gap.
  const globalExposure = `
// Global exposure — bridge IIFE closure to window for inline onclick handlers
(function(){
  var _g = (typeof __kraft !== 'undefined') ? __kraft : {};
  var _expose = [
    'state','hideWelcome','showWelcome','addImage','addText','addLinkCard',
    'addMindMap','addTodo','selectOnly','clearSelection','toggleSelect',
    'deleteSelected','updatePropsPanel','updateCanvas','frameSelection',
    'zoomBy','zoomTo','setTool','saveBoard','loadBoardFile','openLinkModal',
    'closeLinkModal','showCtx','hideCtx','toast','triggerPaste',
    'toggleGrid','toggleAppFullscreen','toggleAltPan','showHelp','hideHelp',
    'togglePaper','setPaperSize','setPaperColor','toggleAutoFit',
    'openGifEditor','captureArea','captureScreen','startExportDrag',
    'setCaptureMode','toggleTextStyle','setTextProp','setTextAlign',
    'enterReframe','exitReframe','enterCrop','exitCrop','enterCutMode',
    'enterLassoMode','copySelected','pasteClipboard','duplicateSelected',
    'undo','redo','pushUndo','playAllMedia','pauseAllMedia',
    'restartVideo','toggleVideoPlay','setVideoVolume',
    'groupSelected','ungroupSelected','alignItems','layerOrder',
    'setDrawMode','clearDraw','undoDraw','discardCaptureResult',
    'saveCaptureResult','pasteCaptureToBoard','saveCapturePanelToFolder',
    'translateSelectedText','newBoard','updatePaper','tidySelection',
    'tidyAll','exportMediaSelected','formatBytes','buildKpakBlob',
    'downloadBlob','showSaveLockPrompt','closeSaveLockPrompt',
    'showPasswordDisplayModal','closePasswordDisplay','copyGeneratedPassword',
    'showUnlockModal','closeUnlockModal','tryUnlockFile',
    'addMaskLayer','deleteMaskLayer','toggleMask','setCanvasBg',
    'showTextQuickBar','updateTextQuickBarActive',
    'applyTextColorToSelected','applyTextStyleToSelected',
    'applyInlineColor','applyInlineSize','getEditingText',
    'flipH','flipV','toggleLock','setOpacity','setRotation',
    'setPhotoFilter','resetPhotoFilters','setCgiFilter',
    'resetVideoTrim','seekVideo','setVideoPlaybackRate','setVideoTimeMode',
    'addAudioItem','handleAudioUpload',
    '_handleFileDrop','sanitizeTextHtml','updateAltPanBadge'
  ];
  _expose.forEach(function(k){
    if (typeof _g[k] !== 'undefined') window[k] = _g[k];
  });
  // Also expose top-level functions from the IIFE scope
  var _topLevel = [
    'hideWelcome','showWelcome','addImage','addVideoItem','addText','addLinkCard',
    'addMindMap','addTodo','addAudioItem','selectOnly','clearSelection',
    'toggleSelect','deleteSelected','updatePropsPanel','updateCanvas',
    'frameSelection','zoomBy','zoomTo','setTool','saveBoard','loadBoardFile',
    'openLinkModal','closeLinkModal','showCtx','hideCtx','toast','triggerPaste',
    'toggleGrid','toggleAppFullscreen','toggleAltPan','showHelp','hideHelp',
    'togglePaper','setPaperSize','setPaperColor','toggleAutoFit',
    'openGifEditor','captureArea','captureScreen','startExportDrag',
    'setCaptureMode','toggleTextStyle','setTextProp','setTextAlign',
    'enterReframe','exitReframe','enterCrop','exitCrop','enterCutMode',
    'enterLassoMode','copySelected','pasteClipboard','duplicateSelected',
    'undo','redo','pushUndo','playAllMedia','pauseAllMedia',
    'restartVideo','toggleVideoPlay','setVideoVolume',
    'groupSelected','ungroupSelected','alignItems','layerOrder',
    'setDrawMode','clearDraw','undoDraw','discardCaptureResult',
    'saveCaptureResult','pasteCaptureToBoard','saveCapturePanelToFolder',
    'translateSelectedText','newBoard','updatePaper','tidySelection',
    'tidyAll','exportMediaSelected','formatBytes','buildKpakBlob',
    'downloadBlob','showSaveLockPrompt','closeSaveLockPrompt',
    'showPasswordDisplayModal','closePasswordDisplay','copyGeneratedPassword',
    'showUnlockModal','closeUnlockModal','tryUnlockFile',
    'addMaskLayer','deleteMaskLayer','toggleMask','setCanvasBg',
    'showTextQuickBar','updateTextQuickBarActive',
    'applyTextColorToSelected','applyTextStyleToSelected',
    'applyInlineColor','applyInlineSize','getEditingText',
    'flipH','flipV','toggleLock','setOpacity','setRotation',
    'setPhotoFilter','resetPhotoFilters','setCgiFilter',
    'resetVideoTrim','seekVideo','setVideoPlaybackRate','setVideoTimeMode',
    'addAudioItem','handleAudioUpload',
    '_handleFileDrop','sanitizeTextHtml','updateAltPanBadge',
    'state','_frozenGifs'
  ];
  _topLevel.forEach(function(k){
    if (typeof window[k] === 'undefined' && typeof eval(k) !== 'undefined') {
      try { window[k] = eval(k); } catch(e) {}
    }
  });
})();
`;
  allJS += globalExposure;

  // ── Step 5: Write output ──
  const outDir = path.dirname(OUTPUT);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(OUTPUT, html, 'utf8');
  console.log(`\n✅ Built: ${OUTPUT} (${html.length.toLocaleString()} bytes)`);

  // ── Also write to the other deploy targets ──
  const deployDir = path.join(__dirname, '..', 'krafted-build');
  if (fs.existsSync(deployDir)) {
    const targets = [
      path.join(deployDir, 'Krafpub.html'),
      path.join(deployDir, 'Krafted_v5.4_PWA.html'),
      path.join(deployDir, 'docs', 'Krafted_v5.4_PWA.html'),
    ];
    for (const t of targets) {
      const td = path.dirname(t);
      if (!fs.existsSync(td)) fs.mkdirSync(td, { recursive: true });
      fs.writeFileSync(t, html, 'utf8');
    }
    console.log(`✅ Also synced to krafted-build/ (4 files)`);
  }
}

build().catch(err => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
