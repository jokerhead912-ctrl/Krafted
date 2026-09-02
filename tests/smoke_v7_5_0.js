#!/usr/bin/env node
/**
 * smoke_v7_5_0.js — a LIVE browser check of the three v7.5.0 fixes.
 *
 * WHY THIS EXISTS (and it is not redundant with test_v7_5_0.js)
 * ------------------------------------------------------------
 * v7.4.0 shipped with 148 assertions green, 29/29 mutations caught, and a
 * deploy verifier that found every anchor byte-identical on Pages — and the
 * feature had NEVER RUN. Two dead points, neither visible to any of that:
 * the recursive reader hung off a listener a capture-phase handler had
 * already swallowed, and its completion counter was off by one.
 *
 * The unit suite now EXECUTES the extracted _handleEntryDrop, which closes
 * the counter half. What it still cannot see is the WIRING: that a real
 * DragEvent dispatched at a real DOM node reaches the window capture
 * listener, that _dropEntries can read entries off a real DataTransferItem,
 * and that the whole chain ends with items actually on the board.
 *
 *   > An anchor proves the code EXISTS. A unit test proves it RUNS.
 *   > Only a browser proves it is CONNECTED.
 *
 * So this dispatches synthetic drops into real Chrome and asserts on real
 * consequences: state.items grew, a toast appeared, an <img> lost its src.
 *
 * WHAT IT CANNOT DO
 *   - Prove the OOM is gone. That needs a renderer under real memory
 *     pressure; headless Chrome will not reproduce it. What it does prove
 *     is the mechanism: culling detaches a real src from a real element,
 *     and a deleted image's blob URL is really revoked.
 *   - Fully fake a directory drop. `webkitGetAsEntry()` is native and
 *     cannot mint a directory, so the prototype is overridden to return a
 *     mock FileSystemEntry tree. That is a real integration seam: the
 *     event, the listener, the routing, the counter, and the import are
 *     all the app's own code. Only the OS directory walk is stubbed.
 *
 * USAGE
 *   node Krafted/tests/smoke_v7_5_0.js
 *   node Krafted/tests/smoke_v7_5_0.js --headful
 *
 * EXIT CODE
 *   0 every check passed · 1 one or more failed · 2 could not run at all
 */

'use strict';

const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const http = require('http');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.resolve(__dirname, '..', '..');
const PAGE = 'kraftpub-dev.html';
const PORT = 8731;

let pass = 0, fail = 0;
const failures = [];

// Historical version references are BUILT, never written as literals.
//
// version_scan.py rewrites every bare X.Y.Z it finds inside code — it skips
// `//` comments but not strings. Left as a literal, "the v7.4.0 bug" in an
// assertion label becomes "the v7.5.0 bug" on the next `run_all.sh --bump`,
// and every explanation in this file starts lying about which release did
// what. Comments that lie are worse than no comments (MEMORY pitfalls), and
// this particular lie is invisible: nothing fails, the prose just rots.
//
// Only the CURRENT version may be a literal — see section 1, where '7.5.0'
// is a genuine assertion input and is meant to move with every bump.
const V740 = ['7', '4', '0'].join('.');

function ok(cond, label) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; failures.push(label); console.log('  FAIL ' + label); }
}
function eq(actual, expected, label) {
  ok(actual === expected, label + ' (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')');
}

// ── a throwaway static server, bound to loopback only ──────────────────────
// file:// would do for most of it, but the app writes an emergency backup to
// IndexedDB and Chrome refuses that on a file origin, which would put a
// scary-but-unrelated error in every log and train us to ignore the log.
function serve() {
  const PY = '/Users/kincheung/.workbuddy/binaries/python/versions/3.13.12/bin/python3';
  return spawn(PY, ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', ROOT],
               { stdio: 'ignore' });
}

function waitForServer(retries) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const req = http.get({ host: '127.0.0.1', port: PORT, path: '/' + PAGE }, (res) => {
        res.resume();
        res.statusCode === 200 ? resolve() : retry(n, 'status ' + res.statusCode);
      });
      req.on('error', () => retry(n, 'not up'));
      req.setTimeout(1000, () => { req.destroy(); retry(n, 'timeout'); });
    };
    const retry = (n, why) => {
      if (n <= 0) return reject(new Error('server did not come up: ' + why));
      setTimeout(() => attempt(n - 1), 250);
    };
    attempt(retries || 40);
  });
}

// ── the in-page harness ───────────────────────────────────────────────────
// Installed once per page load. It records what the app actually did, and
// mints the one thing a synthetic event cannot: a directory entry.
const HARNESS = `
window.__k = {
  toasts: [], finish: 0, entryDrop: 0, fileDrop: 0, collect: 0, seq: [],
  origGetAsEntry: DataTransferItem.prototype.webkitGetAsEntry,
  slot: 0, tree: null
};

// Record, do not replace. Every wrapper delegates to the real function, so
// a wrapper that forgets to forward would turn the app's behaviour off and
// produce a failure that says nothing about the app.
(function () {
  const t = window.toast;
  window.toast = function (m) { window.__k.toasts.push(String(m)); return t.apply(this, arguments); };
  const f = window._finishFolderImport;
  window._finishFolderImport = function () {
    window.__k.finish++; window.__k.seq.push('finish');
    return f.apply(this, arguments);
  };
  const d = window._handleEntryDrop;
  window._handleEntryDrop = function () { window.__k.entryDrop++; return d.apply(this, arguments); };
  const h = window._handleFileDrop;
  window._handleFileDrop = function () {
    window.__k.fileDrop++; window.__k.seq.push('fileDrop');
    return h.apply(this, arguments);
  };
  // The flat collector is the v7.4.0 dead end: it reads dataTransfer.files,
  // where Chrome has put the dropped directory as a zero-byte placeholder
  // with type=''. If it runs on a folder drop, the import is about to
  // produce nothing. Counting it is the assertion that actually pins the
  // routing, because _handleFileDrop firing once proves nothing on its own.
  const c = window._collectDroppedFiles;
  if (typeof c === 'function') {
    window._collectDroppedFiles = function () {
      window.__k.collect++; window.__k.seq.push('collect');
      return c.apply(this, arguments);
    };
  }
})();

// A real PNG, made by the browser so it is guaranteed decodable. A base64
// constant risks being a subtly invalid image, which would fail the import
// for a reason that has nothing to do with what we are testing.
window.__k.png = function (name, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size || 64;
  const g = c.getContext('2d');
  g.fillStyle = 'hsl(' + (name.length * 37 % 360) + ',70%,55%)';
  g.fillRect(0, 0, c.width, c.height);
  return new Promise(function (r) {
    c.toBlob(function (b) { r(new File([b], name, { type: 'image/png' })); }, 'image/png');
  });
};

// Mock FileSystemEntry. createReader() is called once per directory and
// readEntries() is then polled until it returns an empty batch — mirroring
// the real contract, because _handleEntryDrop's counter depends on exactly
// that shape (see the BATCH note in the unit suite).
window.__k.mockEntry = function mock(node) {
  if (node.dir) {
    let served = false;
    return {
      isDirectory: true, isFile: false, name: node.name,
      createReader: function () {
        return {
          readEntries: function (cb) {
            if (served) { cb([]); return; }
            served = true;
            cb(node.children.map(function (c) { return mock(c); }));
          }
        };
      }
    };
  }
  return {
    isDirectory: false, isFile: true, name: node.name,
    file: function (cb) { window.__k.png(node.name).then(cb); }
  };
};

window.__k.installTree = function (tree) {
  const k = window.__k;
  k.slot = 0; k.tree = tree;
  DataTransferItem.prototype.webkitGetAsEntry = function () {
    const n = tree[k.slot++];
    return n ? k.mockEntry(n) : null;
  };
};

window.__k.restoreEntries = function () {
  DataTransferItem.prototype.webkitGetAsEntry = window.__k.origGetAsEntry;
};

// Dispatch a drop the way the browser would: capture phase reaches the
// window listener before anything on the viewport can see it, which is the
// whole reason v7.4.0's reader never ran.
window.__k.drop = function (setup) {
  const dt = new DataTransfer();
  setup(dt);
  const ev = new DragEvent('drop', {
    bubbles: true, cancelable: true, dataTransfer: dt,
    clientX: 400, clientY: 300
  });
  document.body.dispatchEvent(ev);
};
`;

async function newPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', (e) => { fail++; failures.push('page error: ' + e.message); console.log('  FAIL page error: ' + e.message); });
  await page.goto('http://127.0.0.1:' + PORT + '/' + PAGE, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('typeof window.state === "object" && !!window.toast', { timeout: 30000 });
  await page.evaluate(HARNESS);
  return page;
}

// Run a folder drop and wait for the item count to settle.
async function dropFolder(page, tree) {
  return page.evaluate(async (t) => {
    const k = window.__k;
    k.installTree(t);
    const before = (window.state.items || []).length;
    k.drop(function (dt) {
      // One placeholder per top-level entry. The mock hands them back in
      // the same order, so _dropEntries sees the tree we described.
      t.forEach(function (n) { dt.items.add(new File([new Uint8Array([0])], n.name)); });
    });
    // processNextImage releases one file every ~50ms, so wait on the count
    // rather than on a fixed sleep — a fixed sleep is either too short on a
    // slow machine or wasted time on a fast one.
    //
    // NB: the count is RECURSIVE. Counting a directory's direct children
    // was wrong and cost a real failure: shape E is Outer/[Inner(2),
    // Inner2(3)], whose direct children are the two subdirectories, so the
    // wait loop settled at 2 and the remaining 3 images were still in
    // flight when the board was measured. A wait loop that stops early
    // reads as "the app dropped 3 images", which is a lie in the other
    // direction from the bug we are hunting.
    const countFiles = function (nodes) {
      return nodes.reduce(function (n, x) {
        return n + (x.dir ? countFiles(x.children) : 1);
      }, 0);
    };
    const want = countFiles(t);
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      await new Promise(function (r) { setTimeout(r, 100); });
      if ((window.state.items || []).length >= before + want) break;
    }
    const items = window.state.items || [];
    return {
      before: before, want: want, after: items.length,
      entryDrop: k.entryDrop, finish: k.finish, fileDrop: k.fileDrop,
      collect: k.collect, seq: k.seq.slice(),
      toasts: k.toasts.slice(),
      culled: items.filter(function (i) { return i && i._imgCulled; }).length
    };
  }, tree);
}

function dir(name, n) {
  const children = [];
  for (let i = 1; i <= n; i++) children.push({ name: name.toLowerCase() + '-' + i + '.png' });
  return { name: name, dir: true, children: children };
}
function subdir(name, childDirs) { return { name: name, dir: true, children: childDirs }; }

// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  // Resolve puppeteer on more than one path. It is NOT installed next to
  // this file and it is NOT in the default NODE_PATH, so a bare require()
  // fails under run_all.sh even on the machine that has it — which makes
  // this whole file print SKIP forever and the gate a decoration. The
  // managed workspace is tried by name, then by absolute path built from
  // $HOME, so the file still travels to a second machine.
  const candidates = [
    'puppeteer-core',
    path.join(process.env.HOME || os.homedir(),
              '.workbuddy/binaries/node/workspace/node_modules/puppeteer-core')
  ];
  let puppeteer = null;
  for (const c of candidates) {
    try { puppeteer = require(c); break; } catch (e) { /* try the next one */ }
  }
  if (!puppeteer) {
    // Exit 0, not 2. A missing dev dependency is a fact about the machine,
    // not a defect in the app, and a red bar here trains everyone to delete
    // this file — which is how v7.4.0 ended up with zero coverage of the
    // wiring. run_all.sh prints the SKIP line in its summary, so the gap
    // stays visible without failing machines that simply have no Chrome.
    console.log('SKIP smoke_v7_5_0: puppeteer-core is not installed');
    console.log('  cd /Users/kincheung/.workbuddy/binaries/node/workspace && npm install puppeteer-core');
    return 0;
  }

  const server = serve();
  let browser = null;
  try {
    await waitForServer();
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: process.argv.indexOf('--headful') < 0 ? 'new' : false,
      // The telemetry flags are not cosmetic. Chrome touches a machine-level
      // ~/Library/Application Support/Google/RLZ/RlzStore.plist on startup
      // even under a throwaway profile, and a sandboxed runner denies it.
      //
      // KNOWN REMNANT: these flags do NOT fully suppress it. Under a sandbox
      // you may still see one line of
      //   [sandbox] ... RlzStore.plist (file-write-unlink)
      // on stderr. It is Chrome's own bookkeeping, not this suite, and the
      // process exit code is unaffected (verified: EXIT=0 with all 48
      // assertions passing). Do not spend another hour hunting a flag for
      // it — record it here instead, which is the point of the note.
      args: [
        '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
        '--window-size=1280,800',
        '--no-first-run', '--no-default-browser-check', '--no-pings',
        '--disable-background-networking', '--disable-component-update',
        '--disable-sync', '--disable-breakpad',
        '--disable-domain-reliability', '--metrics-recording-only',
        '--disable-features=RLZ,Translate,OptimizationHints,MediaRouter,CalculateNativeWinOcclusion'
      ]
    });

    // ── 1. the version actually loaded is the one we shipped ──────────────
    console.log('— identity —');
    {
      const page = await newPage(browser);
      const v = await page.evaluate(() => ({
        ver: (typeof KRAFTED_VERSION === 'string') ? KRAFTED_VERSION : null,
        title: document.title
      }));
      eq(v.ver, '7.5.0', 'the served page reports KRAFTED_VERSION 7.5.0');
      ok(/v7\.5\.0/.test(v.title), 'the document title says v7.5.0 (' + v.title + ')');
      await page.close();
    }

    // ── 2. folder drop: the four shapes v7.4.0 silently dropped ───────────
    // Each of these returned NOTHING in v7.4.0. Shape B (a folder holding
    // exactly one file) was the only one that worked, and it is included
    // here as the control.
    console.log('— folder drop: the shapes v' + V740 + ' lost —');
    const shapes = [
      ['B · folder holding 1 image  (the only shape v' + V740 + ' imported)', [dir('One', 1)], 1],
      ['C · folder holding 3 images', [dir('Three', 3)], 3],
      ['D · folder holding 10 images', [dir('Ten', 10)], 10],
      ['E · folder with a subfolder', [subdir('Outer', [dir('Inner', 2), dir('Inner2', 3)])], 5],
      ['F · two folders side by side', [dir('Alpha', 2), dir('Beta', 3)], 5]
    ];
    for (const [label, tree, want] of shapes) {
      const page = await newPage(browser);
      const r = await dropFolder(page, tree);
      console.log('   ' + label);
      eq(r.after - r.before, want, '   ' + want + ' image(s) landed on the board');
      eq(r.entryDrop, 1, '   the drop was routed to the recursive reader exactly once');
      eq(r.finish, 1, '   the import finished (the counter reached 0)');
      // NB on what "fall through" means, because the obvious assertion is
      // WRONG and this suite failed on it five times before the source was
      // read: _finishFolderImport ends with `_handleFileDrop(e, sorted)`,
      // so a folder drop is SUPPOSED to reach the shared import path. Zero
      // calls would mean the files went nowhere. The thing that must not
      // run is _collectDroppedFiles, which reads dataTransfer.files where
      // Chrome has put the directory as a zero-byte placeholder.
      eq(r.fileDrop, 1, '   the collected set went on to the shared import path exactly once');
      eq(r.collect, 0, '   the flat collector did NOT run — that is the path that swallowed the zero-byte folder placeholder in v' + V740);
      const iF = r.seq.indexOf('finish'), iD = r.seq.indexOf('fileDrop');
      ok(iF >= 0 && iD > iF,
         '   the files reached the import path THROUGH the folder reader, not around it (seq: ' + r.seq.join(' > ') + ')');
      await page.close();
    }

    // ── 3. a loose file must still take the flat-file path ────────────────
    // The routing fix must not have stolen the ordinary case. A drop with no
    // directory in it has to behave exactly as it did before v7.5.0.
    console.log('— a loose file still takes the flat-file path —');
    {
      const page = await newPage(browser);
      const r = await dropFolder(page, [{ name: 'loose.png' }]);
      eq(r.entryDrop, 0, 'a file-only drop does NOT go through the recursive reader');
      eq(r.collect, 1, 'a file-only drop DOES go through the flat collector — the routing must not have stolen the ordinary case');
      ok(r.fileDrop >= 1 || r.after > r.before,
         'a file-only drop still imports (fileDrop=' + r.fileDrop + ', items+' + (r.after - r.before) + ')');
      await page.close();
    }

    // ── 4. a drag with no image URL says so on screen ─────────────────────
    console.log('— a URL-less drag is surfaced —');
    {
      const page = await newPage(browser);
      const r = await page.evaluate(async () => {
        const k = window.__k;
        k.restoreEntries();                    // no mocks: use the real one
        k.toasts.length = 0;
        k.drop(function (dt) {
          dt.setData('text/html', '<div><p>a pin page, no image in sight</p></div>');
        });
        // The handler defers its work by setTimeout(0) on purpose, so give
        // the macrotask queue a couple of turns.
        await new Promise(function (r2) { setTimeout(r2, 600); });
        return k.toasts.slice();
      });
      ok(r.length > 0, 'a toast was shown (was silent in v' + V740 + ')');
      const joined = r.join(' | ');
      ok(/no image URL|冇带图片网址/.test(joined), 'the toast says the drag carried no image URL');
      ok(/html 0|html\s*\d+/.test(joined), 'the toast carries the payload lengths (' + joined.slice(0, 90) + ')');
      await page.close();
    }

    // ── 5. off-screen culling detaches a real src from a real element ─────
    console.log('— off-screen culling —');
    {
      const page = await newPage(browser);
      const r = await page.evaluate(async (n) => {
        const k = window.__k;
        const tree = [{ name: 'Bulk', dir: true, children: [] }];
        for (let i = 1; i <= n; i++) tree[0].children.push({ name: 'bulk-' + i + '.png' });
        k.installTree(tree);
        const before = (window.state.items || []).length;
        k.drop(function (dt) { dt.items.add(new File([new Uint8Array([0])], 'Bulk')); });
        const deadline = Date.now() + 60000;
        while (Date.now() < deadline) {
          await new Promise(function (r2) { setTimeout(r2, 150); });
          if ((window.state.items || []).length >= before + n) break;
        }
        const items = window.state.items || [];
        // The camera is `state.pan`, a {x, y} OBJECT — not state.panX.
        // state.panX is only ever a serialisation field in the manifest;
        // updateCanvas() reads state.pan.x. Writing state.panX therefore
        // paints the board in exactly the same place and every cull
        // assertion below passes vacuously. That was three silent green
        // lines until the rects were dumped and compared. Probe first,
        // then assert: an assertion over a camera that never moved is
        // worse than no assertion at all.
        const leftOf = function (it) {
          try { return (it.el || it.img).getBoundingClientRect().left; } catch (e) { return NaN; }
        };
        const leftBefore = leftOf(items[0]);
        window.state.pan.x = -90000;
        window.state.pan.y = -90000;
        if (typeof window.updateCanvas === 'function') window.updateCanvas();
        // updateCanvas() schedules the cull on a 220ms debounce. Waiting
        // proves the debounce is wired; calling _cullOffscreenImages() by
        // hand would still pass if the wiring were dead, which is exactly
        // the class of bug v7.4.0 shipped.
        await new Promise(function (r2) { setTimeout(r2, 700); });
        const leftAfter = leftOf(items[0]);
        const culled = items.filter(function (i) { return i && i._imgCulled; });
        const detached = culled.filter(function (i) {
          return i.img && i.img.getAttribute('src') === null;
        });
        // And putting them back must be a pure string assignment: item.src
        // was never touched, so export and undo see the same board.
        // Counted over the CULLED SET only — counting every item would
        // include the ones that were never culled and could never fail.
        let restored = -1;
        if (typeof window._ensureAllImagesLive === 'function') {
          window._ensureAllImagesLive();
          restored = culled.filter(function (i) {
            return i && i.img && i.img.getAttribute('src') !== null;
          }).length;
        }
        return {
          total: items.length,
          leftBefore: leftBefore, leftAfter: leftAfter,
          moved: leftAfter !== leftBefore && Math.abs(leftAfter - leftBefore) > 100,
          culled: culled.length,
          detached: detached.length,
          srcIntact: items.filter(function (i) {
            return i && typeof i.src === 'string' && i.src.indexOf('blob:') === 0;
          }).length,
          restored: restored
        };
      }, 45);
      console.log('   ' + JSON.stringify(r));
      ok(r.total >= 40, 'enough items to pass the cull floor (' + r.total + ' >= 40)');
      // Gate first. Without this, a camera knob that stops working turns
      // "culling works" into "nothing was off screen", which is green.
      ok(r.moved, 'the pan really moved the board — every cull assertion below is vacuous if it did not (left ' + r.leftBefore + ' -> ' + r.leftAfter + ')');
      ok(r.culled > 0, 'panning away culled off-screen images (' + r.culled + ' culled)');
      eq(r.detached, r.culled, 'every culled image really had its src attribute detached (' + r.detached + '/' + r.culled + ')');
      eq(r.srcIntact, r.total, 'item.src is untouched for every item — export/save/undo see the same board');
      ok(r.culled > 0 && r.restored === r.culled,
         '_ensureAllImagesLive put exactly the culled ones back (' + r.restored + '/' + r.culled + ')');
      await page.close();
    }

    // ── 6. deleting an image really revokes its blob URL ──────────────────
    console.log('— a deleted image releases its bytes —');
    {
      const page = await newPage(browser);
      const r = await page.evaluate(async () => {
        const k = window.__k;
        k.installTree([{ name: 'Del', dir: true, children: [{ name: 'del-1.png' }] }]);
        const before = (window.state.items || []).length;
        k.drop(function (dt) { dt.items.add(new File([new Uint8Array([0])], 'Del')); });
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
          await new Promise(function (r2) { setTimeout(r2, 100); });
          if ((window.state.items || []).length > before) break;
        }
        const items = window.state.items || [];
        const victim = items[items.length - 1];
        if (!victim) return { error: 'no item was imported' };
        const url = victim.src;
        // Is the URL still alive? Fetching it is the only honest test:
        // revoking severs the mapping, and the fetch then fails.
        let liveBefore = false;
        try { const a = await fetch(url); liveBefore = a.ok; } catch (e) {}
        victim.selected = true;
        if (typeof window.selectItem === 'function') window.selectItem(victim, true);
        const revokedSizeBefore = (typeof window._revokedBlobUrls !== 'undefined')
          ? window._revokedBlobUrls.size : -1;
        if (typeof window.deleteSelected === 'function') window.deleteSelected();
        await new Promise(function (r2) { setTimeout(r2, 200); });
        const revokedSizeAfter = (typeof window._revokedBlobUrls !== 'undefined')
          ? window._revokedBlobUrls.size : -1;
        let liveAfter = false;
        try { const b = await fetch(url); liveAfter = b.ok; } catch (e) {}
        return {
          urlIsBlob: typeof url === 'string' && url.indexOf('blob:') === 0,
          liveBefore: liveBefore, liveAfter: liveAfter,
          revokedSizeBefore: revokedSizeBefore, revokedSizeAfter: revokedSizeAfter,
          itemsAfter: (window.state.items || []).length
        };
      });
      console.log('   ' + JSON.stringify(r));
      if (r.error) { ok(false, 'setup failed: ' + r.error); }
      else {
        ok(r.urlIsBlob, 'the imported item holds a blob: URL');
        ok(r.liveBefore, 'that URL resolved before the delete');
        eq(r.liveAfter, false, 'after deleteSelected the URL no longer resolves — the bytes were released');
        ok(r.revokedSizeAfter > r.revokedSizeBefore, 'the URL was recorded as revoked (' + r.revokedSizeBefore + ' -> ' + r.revokedSizeAfter + ')');
      }
      await page.close();
    }

    // ── 7. negative control: prove those assertions can fail ─────────────
    // Thirty-odd assertions above have only ever been green. A gate that has
    // never fired is not a gate, it is decoration — the run_all.sh banner
    // says ALL GREEN either way, and v7.4.0 proved how that reads.
    //
    // So blind the router the way v7.4.0 was blind: make _dropHasDirectory
    // report false for every drop, and the folder path becomes unreachable.
    // If this section comes back green, the folder assertions are dead.
    // It is also a live reproduction of the user's own bug report —
    // "拖一個文件夾...拖去個app上面冇反應" — asserted from the inside.
    console.log('— negative control: blind the router, expect the v' + V740 + ' symptom —');
    {
      const page = await newPage(browser);
      const r = await page.evaluate(async () => {
        const k = window.__k;
        const orig = window._dropHasDirectory;
        if (typeof orig !== 'function') return { error: '_dropHasDirectory is not on window — cannot blind it' };
        window._dropHasDirectory = function () { return false; };
        k.installTree([{ name: 'NC', dir: true, children: [{ name: 'nc-1.png' }, { name: 'nc-2.png' }] }]);
        const before = (window.state.items || []).length;
        k.drop(function (dt) { dt.items.add(new File([new Uint8Array([0])], 'NC')); });
        await new Promise(function (r2) { setTimeout(r2, 2500); });
        const out = {
          entryDrop: k.entryDrop, collect: k.collect, finish: k.finish,
          added: (window.state.items || []).length - before
        };
        window._dropHasDirectory = orig;
        return out;
      });
      console.log('   ' + JSON.stringify(r));
      if (r.error) { ok(false, 'setup failed: ' + r.error); }
      else {
        eq(r.entryDrop, 0, 'with the router blinded the recursive reader is never entered');
        ok(r.collect >= 1, 'with the router blinded the drop falls into the flat collector — the v' + V740 + ' dead end');
        eq(r.finish, 0, 'and the folder import never completes');
        eq(r.added, 0, 'and ZERO images land — the exact symptom reported: drop a folder, nothing happens');
        ok(r.added !== 2, 'if this ever stops failing, the folder assertions above are vacuous');
      }
      await page.close();
    }

  } finally {
    if (browser) await browser.close();
    server.kill();
  }

  console.log('');
  console.log('smoke_v7_5_0: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) {
    console.log('');
    failures.forEach(function (f) { console.log('  - ' + f); });
    return 1;
  }
  console.log('ALL PASS (' + pass + ' assertions)');
  return 0;
}

main().then((rc) => process.exit(rc)).catch((e) => {
  console.log('smoke_v7_5_0 crashed: ' + (e && e.stack || e));
  process.exit(2);
});
