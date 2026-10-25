#!/usr/bin/env node
/*
 * Krafted stability audit -- real Chrome, real files.
 *
 * WHY THIS EXISTS: the release gate (62 suites / 52 mutations) proves the code
 * does what I believe it does, inside node, with stubs I wrote. It cannot
 * prove: real Chrome MIME mapping, real decode, real memory behaviour, real
 * timing. This script is the other half of the evidence.
 *
 * WHAT IT NEVER DOES: it never invents a file. Every file it touches is read
 * from disk and hashed (sha256) so the bytes can be checked against the
 * manifest afterwards.
 *
 * Usage:
 *   node run_audit.js --platform mac --board <.kpak> --footage <dir> --soak 120
 * On Windows the same script runs unchanged; point audit_config.json at the
 * Windows paths.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let puppeteer;
try {
  puppeteer = require(process.env.PUPPETEER_CORE_PATH || 'puppeteer-core');
} catch (e) {
  puppeteer = require('/Users/kincheung/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core');
}

const HERE = __dirname;

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return (i >= 0 && process.argv[i + 1]) ? process.argv[i + 1] : def;
}

const CFG_FILE = arg('config', path.join(HERE, 'audit_config.json'));
let cfgFromFile = {};
try { cfgFromFile = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch (e) { /* no config is fine */ }

const CFG = {
  url:      arg('url', cfgFromFile.url) || 'https://jokerhead912-ctrl.github.io/Krafted/kraftpub.html',
  board:    arg('board', cfgFromFile.board) || '',
  footage:  arg('footage', cfgFromFile.footage) || '',
  platform: arg('platform', cfgFromFile.platform) || os.platform(),
  soak:     parseInt(arg('soak', cfgFromFile.soak != null ? String(cfgFromFile.soak) : '0'), 10) || 0,
  out:      arg('out', cfgFromFile.out) || '',
  headless: (arg('headful', '') !== '1'),
};

const CHROME = process.env.CHROME_PATH ||
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');

const RESULT = {
  schema: 'krafted-stability-audit/1',
  startedAt: new Date().toISOString(),
  config: Object.assign({}, CFG, { chrome: CHROME }),
  environment: {},
  cases: [],
  errors: [],
  consoleErrors: [],
  verdict: {},
};

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function rec(name, data) {
  const r = Object.assign({ case: name, at: new Date().toISOString() }, data);
  RESULT.cases.push(r);
  const line = '  [' + name + '] ' + JSON.stringify(data).slice(0, 220);
  console.log(line);
  return r;
}

function pct(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[i];
}

function stats(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  return { n: s.length, p50: pct(s, 0.50), p95: pct(s, 0.95), max: s[s.length - 1], min: s[0] };
}

async function main() {
  if (!fs.existsSync(CHROME)) {
    console.error('CHROME NOT FOUND: ' + CHROME + '  (set CHROME_PATH)');
    process.exit(2);
  }
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: CFG.headless,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required',
           '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
  });
  const page = await browser.newPage();
  const client = await page.createCDPSession();

  page.on('pageerror', e => RESULT.errors.push({ kind: 'pageerror', msg: String(e && e.message || e).slice(0, 400) }));
  page.on('console', m => {
    if (m.type() === 'error') RESULT.consoleErrors.push(String(m.text()).slice(0, 300));
  });
  await page.evaluateOnNewDocument(() => {
    window.__auditErrors = [];
    window.addEventListener('error', e => window.__auditErrors.push('error: ' + (e.message || '')));
    window.addEventListener('unhandledrejection', e => window.__auditErrors.push('rejection: ' + String(e.reason)));
    window.__auditLongTasks = [];
    try {
      new PerformanceObserver(list => {
        for (const en of list.getEntries()) window.__auditLongTasks.push(Math.round(en.duration));
      }).observe({ entryTypes: ['longtask'] });
    } catch (e) { /* longtask unsupported */ }
  });

  // ── C0 environment ────────────────────────────────────────────────────────
  RESULT.environment = {
    platform: CFG.platform,
    osRelease: os.release(),
    arch: os.arch(),
    cpus: os.cpus().length,
    cpuModel: (os.cpus()[0] || {}).model || '',
    totalMemGB: +(os.totalmem() / 1e9).toFixed(1),
    node: process.version,
    chromeVersion: await browser.version(),
    headless: CFG.headless,
  };
  console.log('environment: ' + JSON.stringify(RESULT.environment));

  // ── C1 cold + warm load ───────────────────────────────────────────────────
  const tCold = Date.now();
  await page.goto(CFG.url, { waitUntil: 'load', timeout: 120000 });
  const coldMs = Date.now() - tCold;
  await page.waitForFunction('typeof window !== "undefined" && !!document.body', { timeout: 60000 });
  await new Promise(r => setTimeout(r, 2500));           // let the SW register
  const tWarm = Date.now();
  await page.reload({ waitUntil: 'load', timeout: 120000 });
  const warmMs = Date.now() - tWarm;
  const swState = await page.evaluate(async () => {
    try {
      const r = await navigator.serviceWorker.getRegistration();
      return { registered: !!r, scriptURL: r ? (r.active || r.installing || r.waiting || {}).scriptURL : null };
    } catch (e) { return { registered: false, err: String(e) }; }
  }).catch(() => ({ registered: false, err: 'evaluate failed' }));
  // Which build did we actually measure? Without this the whole run is
  // unattributable -- and a report that cannot say what it measured is noise.
  const appVersion = await page.evaluate(() => {
    try { if (typeof KRAFTED_VERSION !== 'undefined') return String(KRAFTED_VERSION); } catch (e) {}
    const m = /Krafted v([0-9]+\.[0-9]+\.[0-9]+)/.exec(document.title || '');
    return m ? m[1] : null;
  }).catch(() => null);
  RESULT.environment.appVersionUnderTest = appVersion;

  // Can this Chrome decode H.264 at all? If it cannot, every video result
  // below means nothing and has to be reported as unmeasured, not as a bug.
  const codecs = await page.evaluate(() => {
    const v = document.createElement('video');
    return {
      h264: v.canPlayType('video/mp4; codecs="avc1.42E01E"'),
      mp4: v.canPlayType('video/mp4'),
      webm: v.canPlayType('video/webm; codecs="vp9"'),
      mov: v.canPlayType('video/quicktime'),
    };
  }).catch(() => null);
  RESULT.environment.codecSupport = codecs;
  rec('C1_load', { coldMs, warmMs, serviceWorker: swState, appVersion, codecs });

  // ── C2 board load (real .kpak) ────────────────────────────────────────────
  if (CFG.board && fs.existsSync(CFG.board)) {
    const boardBytes = fs.statSync(CFG.board).size;
    const boardSha = sha256(fs.readFileSync(CFG.board));
    const inp = await page.$('#file-load');
    if (!inp) {
      rec('C2_board_load', { ok: false, why: '#file-load input not found', boardBytes, boardSha: boardSha.slice(0, 16) });
    } else {
      await page.evaluate(() => {
        window.__t0 = performance.now();
        window.__mut = 0;
        window.__settleAt = null;
        const mo = new MutationObserver(() => { window.__mut++; window.__settleAt = performance.now(); });
        mo.observe(document.body, { childList: true, subtree: true, attributes: true });
        window.__mo = mo;
      });
      const t0 = Date.now();
      await inp.uploadFile(CFG.board);
      let items = -1;
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline) {
        items = await page.evaluate(() => {
          try { if (typeof state !== 'undefined' && state && state.items) return state.items.length; } catch (e) {}
          return -1;
        }).catch(() => -1);
        if (items > 0) break;
        await new Promise(r => setTimeout(r, 200));
      }
      const msToItems = Date.now() - t0;
      // settled = no DOM mutation for 700ms
      let msToSettled = null;
      const settleDeadline = Date.now() + 180000;
      while (Date.now() < settleDeadline) {
        const s = await page.evaluate(() => {
          const last = window.__settleAt || window.__t0;
          return { quiet: (performance.now() - last) > 700, since: Math.round(performance.now() - window.__t0) };
        }).catch(() => null);
        if (s && s.quiet) { msToSettled = Date.now() - t0; break; }
        await new Promise(r => setTimeout(r, 300));
      }
      await page.evaluate(() => { try { window.__mo.disconnect(); } catch (e) {} });
      const mem = await page.metrics();
      // "state.items.length === 79" alone would also be true if the board
      // parsed but never painted. Count real card elements too.
      const domCards = await page.evaluate(() => {
        const sel = ['.item', '.card', '.node-el', '[data-item-id]', '.board-item'];
        for (const s of sel) { const n = document.querySelectorAll(s).length; if (n > 0) return { selector: s, n }; }
        return { selector: null, n: 0 };
      }).catch(() => ({ selector: 'evaluate failed', n: -1 }));
      const longTasks = await page.evaluate(() => (window.__auditLongTasks || []).slice());
      rec('C2_board_load', {
        ok: true, boardBytes, boardSha: boardSha.slice(0, 16),
        itemsLoaded: items, msToItems, msToSettled, domCards,
        longTasksDuringLoad: longTasks.length,
        longTaskMaxMs: longTasks.length ? Math.max.apply(null, longTasks) : 0,
        jsHeapUsedMB: +(mem.JSHeapUsedSize / 1e6).toFixed(1),
      });
    }
  } else {
    rec('C2_board_load', { ok: false, why: 'no board configured/found', board: CFG.board });
  }

  // ── C3 pan / zoom frame timing ────────────────────────────────────────────
  {
    await page.evaluate(() => { window.__auditLongTasks = []; });
    const frames = await page.evaluate(async () => {
      const deltas = [];
      let last = performance.now();
      let running = true;
      const tick = () => {
        const now = performance.now();
        deltas.push(now - last);
        last = now;
        if (running) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      const el = document.querySelector('#viewport') || document.body;
      const fire = (type, opts) => el.dispatchEvent(new WheelEvent(type, Object.assign({ bubbles: true, cancelable: true }, opts)));
      for (let i = 0; i < 60; i++) {
        fire('wheel', { deltaY: i < 30 ? -120 : 120, deltaX: 0, clientX: 800, clientY: 500 });
        await new Promise(r => requestAnimationFrame(r));
      }
      for (let i = 0; i < 40; i++) {                       // a drag
        const down = new MouseEvent('mousedown', { bubbles: true, clientX: 700 + i, clientY: 500, button: 1 });
        el.dispatchEvent(down);
        el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 700 + i * 4, clientY: 500 + i }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 700 + i * 4, clientY: 500 + i, button: 1 }));
        await new Promise(r => requestAnimationFrame(r));
      }
      running = false;
      await new Promise(r => setTimeout(r, 100));
      return deltas.slice(2);
    }).catch(e => ({ err: String(e) }));
    if (Array.isArray(frames)) {
      const lt = await page.evaluate(() => (window.__auditLongTasks || []).slice());
      rec('C3_pan_zoom', { frames: stats(frames), longTasks: lt.length, longTaskMaxMs: lt.length ? Math.max.apply(null, lt) : 0 });
    } else {
      rec('C3_pan_zoom', { ok: false, err: frames.err });
    }
  }

  // ── C4 MIME probe: what does REAL Chrome say file.type is? ────────────────
  if (CFG.footage && fs.existsSync(CFG.footage)) {
    const mimeDir = path.join(CFG.footage, 'mimes');
    const targets = [];
    if (fs.existsSync(mimeDir)) {
      for (const f of fs.readdirSync(mimeDir)) targets.push(path.join(mimeDir, f));
    }
    // also probe one truly-real file with its original extension
    for (const extra of ['takeA/shot01.mp4', 'takeA/shot01_proxy.mp4']) {
      const p = path.join(CFG.footage, extra);
      if (fs.existsSync(p)) targets.push(p);
    }
    const probes = [];
    for (const p of targets) {
      const r = await page.evaluate(async () => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.style.display = 'none';
        document.body.appendChild(inp);
        return true;
      });
      const handle = await page.$('input[type=file]:last-of-type').catch(() => null);
      let type = null, name = null, size = null, rel = null;
      try {
        const el = await page.evaluateHandle(() => {
          const list = document.querySelectorAll('input[type=file]');
          return list[list.length - 1];
        });
        const eh = el.asElement();
        if (eh) {
          await eh.uploadFile(p);
          const got = await page.evaluate(() => {
            const list = document.querySelectorAll('input[type=file]');
            const i = list[list.length - 1];
            const f = i && i.files && i.files[0];
            if (!f) return null;
            return { name: f.name, type: f.type, size: f.size, rel: f.webkitRelativePath || '' };
          });
          if (got) { name = got.name; type = got.type; size = got.size; rel = got.rel; }
          await page.evaluate(() => {
            const list = document.querySelectorAll('input[type=file]');
            const i = list[list.length - 1];
            if (i && i.parentNode) i.parentNode.removeChild(i);
          });
        }
      } catch (e) { type = 'PROBE_ERROR: ' + String(e).slice(0, 120); }
      probes.push({ file: path.basename(p), type, size, webkitRelativePath: rel,
                    diskSha: sha256(fs.readFileSync(p)).slice(0, 16) });
    }
    rec('C4_mime_probe', { probes });
  } else {
    rec('C4_mime_probe', { ok: false, why: 'no footage dir' });
  }

  // ── C5 black-box drop of the real fixture tree ────────────────────────────
  if (CFG.footage && fs.existsSync(CFG.footage)) {
    const files = [];
    for (const sub of ['takeA', 'takeB', 'CaseTest', 'mimes']) {
      const d = path.join(CFG.footage, sub);
      if (!fs.existsSync(d)) continue;
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        if (fs.statSync(p).isFile()) files.push(p);
      }
    }
    // Hand the REAL files to the page through a real file input. Do NOT
    // base64 them through page.evaluate: 130 MB of video as JS strings
    // OOM-kills the renderer (measured, this run's first attempt), and a
    // harness that kills the page proves nothing about the app.
    await page.evaluate(() => {
      const old = document.getElementById('__audit_files');
      if (old) old.remove();
      const inp = document.createElement('input');
      inp.type = 'file'; inp.id = '__audit_files'; inp.multiple = true;
      inp.style.display = 'none';
      document.body.appendChild(inp);
    });
    const eh = await page.$('#__audit_files');
    await eh.uploadFile.apply(eh, files);
    const dropResult = await page.evaluate(async () => {
      const inp = document.getElementById('__audit_files');
      const dt = new DataTransfer();
      Array.prototype.forEach.call(inp.files, f => dt.items.add(f));
      const names = Array.prototype.map.call(inp.files, f => f.name);
      const before = (typeof state !== 'undefined' && state && state.items) ? state.items.length : -1;
      const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 600, clientY: 400, dataTransfer: dt });
      window.dispatchEvent(ev);
      await new Promise(r => setTimeout(r, 8000));
      const items = (typeof state !== 'undefined' && state && state.items) ? state.items : null;
      return {
        droppedNames: names,
        droppedTypes: Array.prototype.map.call(inp.files, f => f.type),
        before,
        after: items ? items.length : -1,
        cards: items ? items.slice(-16).map(i => ({
          id: i.id, name: i.name || i.filename || '', isVideo: !!i.isVideo,
          originalName: i.originalName || null, originalSize: i.originalSize || null,
          originalPath: i.originalPath || null, w: i.w, h: i.h,
        })) : [],
      };
    }).catch(e => ({ err: String(e).slice(0, 300) }));
    rec('C5_drop_blackbox', Object.assign({ dropped: files.map(p => path.basename(p)) }, dropResult));
  } else {
    rec('C5_drop_blackbox', { ok: false, why: 'no footage dir' });
  }

  // ── C5b real decode: can Chrome actually play one of these files? ─────────
  if (CFG.footage && fs.existsSync(CFG.footage)) {
    const cand = ['mimes/shot05.mp4', 'takeA/shot01_proxy.mp4', 'takeA/shot01.mp4']
      .map(r => path.join(CFG.footage, r)).find(p => fs.existsSync(p));
    if (cand) {
      // Same rule as C5: never move the bytes through JS as a string.
      await page.evaluate(() => {
        const old = document.getElementById('__audit_one');
        if (old) old.remove();
        const inp = document.createElement('input');
        inp.type = 'file'; inp.id = '__audit_one';
        inp.style.display = 'none';
        document.body.appendChild(inp);
      });
      const eh1 = await page.$('#__audit_one');
      await eh1.uploadFile(cand);
      const r = await page.evaluate(async (name) => {
        const inp = document.getElementById('__audit_one');
        const f = inp.files[0];
        if (!f) return { err: 'no file in input' };
        const url = URL.createObjectURL(f);
        const v = document.createElement('video');
        v.muted = true; v.src = url;
        const ok = await new Promise(res => {
          const to = setTimeout(() => res(false), 20000);
          v.onloadedmetadata = () => { clearTimeout(to); res(true); };
          v.onerror = () => { clearTimeout(to); res(false); };
        });
        if (!ok) return { name, loaded: false, error: v.error ? v.error.code : null };
        // seek to 1.0s, draw, hash the pixels -- this is the frame-level
        // oracle we use in place of ffmpeg
        await new Promise(res => { v.onseeked = res; v.currentTime = Math.min(1.0, (v.duration || 2) / 2); });
        const c = document.createElement('canvas');
        c.width = v.videoWidth; c.height = v.videoHeight;
        c.getContext('2d').drawImage(v, 0, 0);
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let h = 0;
        for (let i = 0; i < d.length; i += 997) h = (h * 31 + d[i]) >>> 0;
        URL.revokeObjectURL(url);
        return { name, loaded: true, duration: +(v.duration || 0).toFixed(3),
                 w: v.videoWidth, h: v.videoHeight, frameHash: h.toString(16) };
      }, path.basename(cand)).catch(e => ({ err: String(e).slice(0, 200) }));
      rec('C5b_real_decode', Object.assign({ diskSha: sha256(fs.readFileSync(cand)).slice(0, 16) }, r));
    }
  }

  // ── C6 heap: three snapshots around a repeated action ─────────────────────
  {
    await client.send('HeapProfiler.enable').catch(() => {});
    const snaps = [];
    for (let round = 0; round < 3; round++) {
      // the repeated action: select-all + delete + undo, 5x
      await page.evaluate(async () => {
        for (let k = 0; k < 5; k++) {
          try {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
          } catch (e) {}
          await new Promise(r => setTimeout(r, 60));
        }
      }).catch(() => {});
      await client.send('HeapProfiler.collectGarbage').catch(() => {});
      await new Promise(r => setTimeout(r, 400));
      const m = await page.metrics();
      let snapBytes = 0, nodeCount = null;
      try {
        const chunks = [];
        const onChunk = ({ chunk }) => chunks.push(chunk);
        client.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
        await client.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
        client.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
        const json = chunks.join('');
        snapBytes = json.length;
        const mm = /"node_count":\s*(\d+)/.exec(json.slice(0, 4000));
        if (mm) nodeCount = parseInt(mm[1], 10);
        const outFile = path.join(HERE, 'results', 'heap_' + CFG.platform + '_' + round + '.heapsnapshot');
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        fs.writeFileSync(outFile, json);
      } catch (e) { snapBytes = -1; }
      snaps.push({ round, jsHeapUsedMB: +(m.JSHeapUsedSize / 1e6).toFixed(1), heapBytes: snapBytes, nodeCount });
    }
    const growth = snaps[2].jsHeapUsedMB - snaps[0].jsHeapUsedMB;
    const monotonic = snaps[0].jsHeapUsedMB <= snaps[1].jsHeapUsedMB && snaps[1].jsHeapUsedMB <= snaps[2].jsHeapUsedMB;
    rec('C6_heap_3snapshots', { snaps, growthMB: +growth.toFixed(1), monotonicRise: monotonic });
  }

  // ── C7 soak ───────────────────────────────────────────────────────────────
  if (CFG.soak > 0) {
    const started = Date.now();
    await page.evaluate(() => { window.__auditLongTasks = []; window.__auditErrors = []; });
    const samples = [];
    const endAt = Date.now() + CFG.soak * 60000;
    let i = 0;
    while (Date.now() < endAt) {
      await page.evaluate(async () => {
        const el = document.querySelector('#viewport') || document.body;
        for (let k = 0; k < 40; k++) {
          el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: (k % 2 ? 90 : -90), clientX: 800, clientY: 500 }));
          await new Promise(r => requestAnimationFrame(r));
        }
      }).catch(() => {});
      await new Promise(r => setTimeout(r, 15000));
      const m = await page.metrics();
      samples.push({ min: +((Date.now() - started) / 60000).toFixed(2), jsHeapUsedMB: +(m.JSHeapUsedSize / 1e6).toFixed(1) });
      if (++i % 8 === 0) { await client.send('HeapProfiler.collectGarbage').catch(() => {}); }
    }
    const lt = await page.evaluate(() => (window.__auditLongTasks || []).slice());
    const errs = await page.evaluate(() => (window.__auditErrors || []).slice());
    const first = samples[0] ? samples[0].jsHeapUsedMB : null;
    const last = samples[samples.length - 1] ? samples[samples.length - 1].jsHeapUsedMB : null;
    rec('C7_soak', {
      minutes: CFG.soak, samples: samples.length, sampleSeries: samples,
      heapStartMB: first, heapEndMB: last, heapDeltaMB: (first != null && last != null) ? +(last - first).toFixed(1) : null,
      longTasks: lt.length, longTasksOver200ms: lt.filter(x => x > 200).length, longTaskMaxMs: lt.length ? Math.max.apply(null, lt) : 0,
      inPageErrors: errs.slice(0, 20),
    });
  } else {
    rec('C7_soak', { skipped: true, why: 'soak=0' });
  }

  const errs = await page.evaluate(() => (window.__auditErrors || []).slice()).catch(() => []);
  RESULT.errors = RESULT.errors.concat(errs.map(e => ({ kind: 'inpage', msg: String(e).slice(0, 300) })));

  await browser.close();
}

// A crash must still leave evidence behind. The worst outcome is an audit
// that dies and leaves nothing, because then "it crashed" and "it passed"
// look identical in the report.
function writeOut(err) {
  RESULT.finishedAt = new Date().toISOString();
  RESULT.auditError = err ? String(err && err.message || err).slice(0, 600) : null;
  RESULT.verdict = {
    uncaughtErrors: RESULT.errors.length,
    consoleErrors: RESULT.consoleErrors.length,
    completed: !err,
  };
  const outFile = CFG.out || path.join(HERE, 'results', 'result_' + CFG.platform + '.json');
  try {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(RESULT, null, 1));
    console.log('\nWROTE ' + outFile + (err ? '  (PARTIAL — the run crashed)' : ''));
  } catch (e) {
    console.error('COULD NOT WRITE RESULT: ' + e);
  }
  console.log('uncaught errors: ' + RESULT.errors.length + '   console errors: ' + RESULT.consoleErrors.length);
}

main().then(
  () => writeOut(null),
  (e) => { console.error('AUDIT FAILED: ' + (e && e.stack || e)); writeOut(e); process.exitCode = 1; }
);
