// diag_proxy_batch_v7_29_0.js — 「拖一堆 proxy 入板、右鍵選檔」到底會唔會亂？
//
// 三條懷疑，全部用執行（唔係讀 code）去證實或推翻：
//   1. 混合選取（有啲已經切咗原檔、有啲仲係 proxy）撳一次 swap，結果係咪一致？
//   2. 一次拖入超過 200 條片，早拖嗰啲原檔會唔會被 FIFO 踢走（→ 要人手揀）？
//   3. 一批卡都要開 picker，係咪一個一個開、有冇得中途停？
//
// 呢個係診斷檔，唔係 gate（唔計入 run_all 嘅 suite）。

const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(
  process.env.KRAFTED_HTML || path.join(__dirname, '..', '..', 'kraftpub-dev.html'),
  'utf8');

function slice(a, b, label) {
  const i = HTML.indexOf(a), j = HTML.indexOf(b);
  if (i < 0 || j < 0 || j <= i) throw new Error('anchor failed: ' + label);
  return HTML.slice(i, j);
}

const LINK = slice('function syncProxyBadgeEl(infoBar, item) {',
                   'function buildMediaControls(el, mediaEl, isVideo, isGif) {',
                   'chip + link machinery');
const MENU = slice('    const _proxyCards = proxyCardsInSelection();',
                   '    // v7.0.40: A/B compare',
                   'proxy menu block');

const api = new Function(`
  var TOASTS = [], RESUMED = [], SEL = [], LOG = [];
  var URL = {
    createObjectURL: function (f) { return 'blob:' + (f && f.name ? f.name : '?'); },
    revokeObjectURL: function () {},
  };
  function toast(m) { TOASTS.push(String(m)); }
  function boardTextLabel(a, b) { return a; }
  function getSelectedItems() { return SEL; }
  function resumeMediaEl(v) { RESUMED.push(v); }
  ${LINK}
  pickSingleFile = function () {
    var n = LOG.filter(function (x) { return x.indexOf('call') === 0; }).length;
    LOG.push('call' + n);
    return Promise.resolve().then(function () { LOG.push('resolve' + n); return null; });
  };
  return {
    proxyCardsInSelection: proxyCardsInSelection,
    linkOriginalSelected: linkOriginalSelected,
    swapProxySelected: swapProxySelected,
    swapProxyMedia: swapProxyMedia,
    applyOriginalLink: applyOriginalLink,
    noteDroppedFiles: noteDroppedFiles,
    proxyOriginals: proxyOriginals,
    dropFiles: _dropFiles,
    setSel: function (a) { SEL = a; },
    toasts: TOASTS,
    log: LOG,
  };
`)();

const flush = () => new Promise(function (r) { setTimeout(r, 0); });
function vid(name, size) { return { name: name, type: 'video/mp4', size: size || 1024 }; }

function makeItem(id) {
  const cls = new Set();
  const chip = { textContent: '', title: '' };
  const bar = {
    classList: { toggle: (n, on) => { if (on) cls.add(n); else cls.delete(n); }, contains: (n) => cls.has(n) },
    querySelector: (sel) => (sel === '.ib-proxy') ? chip : null,
  };
  const v = {
    src: 'blob:PROXY', paused: true, currentTime: 0, duration: 0, _h: {},
    load: function () {},
    addEventListener: function (ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); },
    removeEventListener: function (ev, fn) {
      const a = this._h[ev] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
    },
    _fire: function (ev) { (this._h[ev] || []).slice().forEach(function (f) { f(); }); },
  };
  return { id: id, isProxy: true, isVideo: true, originalName: '', src: 'blob:PROXY',
           el: { querySelector: () => bar }, video: v, _bar: bar, _cls: cls, _chip: chip };
}
function menuFor(cards, linkedIds) {
  const reg = new Set(linkedIds || []);
  return new Function('proxyCardsInSelection', 'proxyOriginals',
    'var html = "";\n' + MENU + '\n return html;')(
    function () { return cards; }, { has: function (id) { return reg.has(id); } });
}
function labelOf(html) {
  const m = html.match(/>([^<>]*Link original[^<>]*|[^<>]*Swap to original[^<>]*|[^<>]*Back to proxy[^<>]*)</);
  return m ? m[1].trim() : '(no entry)';
}

(async function main() {

  console.log('\n=== 1. 混合選取：一張已切原檔 + 兩張仲係 proxy，撳一次 swap ===');
  const a = makeItem('a'), b = makeItem('b'), c = makeItem('c');
  [a, b, c].forEach(function (it) { api.applyOriginalLink(it, vid('x.mov')); });
  api.swapProxyMedia(a);                    // a 已經喺原檔
  api.setSel([a, b, c]);
  const html = menuFor([a, b, c], ['a', 'b', 'c']);
  console.log('  菜單寫：' + labelOf(html));
  api.toasts.length = 0;
  api.swapProxySelected();
  await flush();
  console.log('  撳完之後：a=' + (a._showingOriginal ? 'ORIG' : 'PROXY') +
              '  b=' + (b._showingOriginal ? 'ORIG' : 'PROXY') +
              '  c=' + (c._showingOriginal ? 'ORIG' : 'PROXY'));
  console.log('  toast：' + JSON.stringify(api.toasts));
  const states = [a, b, c].map(function (i) { return !!i._showingOriginal; });
  const uniform = states.every(function (s) { return s === states[0]; });
  console.log('  → 三張卡狀態一致？' + (uniform ? '係' : '**唔係 —— 菜單講嘅同實際做嘅唔同**'));

  console.log('\n=== 2. 一次拖入 260 條片（130 proxy + 130 原檔）===');
  api.dropFiles.clear();
  const many = [];
  for (let i = 0; i < 130; i++) { many.push(vid('shot' + i + '.mov', 1000 + i), vid('shot' + i + '_proxy.mp4', 10 + i)); }
  api.noteDroppedFiles(many);
  console.log('  記低咗：' + api.dropFiles.size + ' 條（FIFO 上限 200）');
  console.log('  最早嗰個原檔 shot0.mov 仲喺度？' + (api.dropFiles.has('shot0.mov') ? '喺' : '**冇咗 —— 要人手揀**'));
  console.log('  最後嗰個 shot129.mov 喺度？' + (api.dropFiles.has('shot129.mov') ? '喺' : '冇'));

  console.log('\n=== 3. 一批卡都要開 picker ===');
  api.dropFiles.clear();
  const p1 = makeItem('p1'), p2 = makeItem('p2'), p3 = makeItem('p3');
  [p1, p2, p3].forEach(function (it, i) { it.originalName = 'missing' + i + '.mov'; });
  api.setSel([p1, p2, p3]);
  api.log.length = 0; api.toasts.length = 0;
  api.linkOriginalSelected();
  await flush();
  console.log('  開咗幾次 picker：' + api.log.filter(function (x) { return x.indexOf('call') === 0; }).length);
  console.log('  順序：' + api.log.join(' , '));
  console.log('  toast：' + JSON.stringify(api.toasts) + '  (全部 cancel → 應該乜都冇講)');
  console.log('  → 要停手要撳幾次 Esc？' + api.log.filter(function (x) { return x.indexOf('call') === 0; }).length + ' 次');
})();
