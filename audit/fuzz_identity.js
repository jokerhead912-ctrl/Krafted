#!/usr/bin/env node
/*
 * Property-based fuzz of the proxy/original IDENTITY rule.
 *
 * Why fuzz instead of more examples: the rule is a lookup key plus a size
 * agreement, and every hand-written example I can think of is one I already
 * believed. A generator invents the collisions I did not think of.
 *
 * INVARIANTS (a broken one is a conform that ships the wrong take):
 *   I1  a card never resolves to a file whose size disagrees with a size it
 *       recorded -- that is the whole promise of originalSize;
 *   I2  two files with different folder paths are two pool entries, and each
 *       card resolves to its OWN folder -- never the other take;
 *   I3  pairing does not depend on the order the files arrived in;
 *   I4  a proxy whose original is not in the batch is unpaired, not guessed;
 *   I5  with no path on either side, the name is the key and the newest wins
 *       (documented limitation, not a bug -- pinned so it cannot "improve"
 *       into a guess).
 *
 * Usage: node fuzz_identity.js [iterations] [seed]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(
  process.env.KRAFTED_HTML || path.join(__dirname, '..', '..', 'kraftpub-dev.html'), 'utf8');

function slice(a, b, label) {
  const i = HTML.indexOf(a), j = HTML.indexOf(b);
  if (i < 0 || j < 0 || j <= i) throw new Error('anchor failed: ' + label);
  return HTML.slice(i, j);
}
const LINK = slice('function syncProxyBadgeEl(infoBar, item) {',
                   'function buildMediaControls(el, mediaEl, isVideo, isGif) {', 'link');
const PAIRING = slice('const PROXY_SUFFIX = ', 'function _handleFileDrop(e, files) {', 'pairing');

const api = new Function(`
  var TOASTS = [];
  var URL = { createObjectURL: function () { return 'blob:x'; }, revokeObjectURL: function () {} };
  function toast(m) { TOASTS.push(String(m)); }
  function boardTextLabel(a, b) { return a; }
  function getSelectedItems() { return []; }
  function resumeMediaEl(v) {}
  ${LINK}
  ${PAIRING}
  return { dropKeyOf: dropKeyOf, originalKeyFor: originalKeyFor, originalFileFor: originalFileFor,
           rememberedOriginalFor: rememberedOriginalFor, noteDroppedFiles: noteDroppedFiles,
           planProxyPairs: planProxyPairs, pool: _dropFiles, toasts: TOASTS };
`)();

// deterministic RNG so a failure is reproducible
function rng(seed) {
  let s = seed >>> 0;
  return function () { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
}
const NAMES = ['shot01.mov', 'Shot01.mov', 'SHOT01.mov', 'shot02.mov', 'a.mov'];
const FOLDERS = ['', 'takeA', 'takeB', 'footage/takeA', 'footage/takeB'];
const SIZES = [1000, 1001, 51553100];      // 51553100 twice is the real collision

let broken = [];
function check(cond, label, ctx) {
  if (!cond) broken.push(label + '  ::  ' + JSON.stringify(ctx));
}

const ITER = parseInt(process.argv[2] || '3000', 10);
const rand = rng(parseInt(process.argv[3] || '20261025', 10));

for (let it = 0; it < ITER; it++) {
  // ── build a random batch of SHOTS, not loose files ──────────────────────
  // A shot is (folder, base name, size) plus the choice of which of the two
  // files actually arrive. Loose random files produced batches where no card
  // had any right to find anything, so the strongest invariant (I7: a card
  // whose original was dropped must find it) could never fire -- which is
  // exactly how a fuzz becomes decoration.
  const batch = [];
  const shots = [];
  // One file per (folder, name) -- a filesystem cannot hold two. Without this
  // the generator invents duplicate keys, and then I7 fails on a case that
  // cannot occur instead of on a case that can.
  const used = {};
  const claim = function (folder, name) {
    const k = (folder || '') + '/' + name;
    if (used[k]) return false;
    used[k] = true;
    return true;
  };
  const nShots = 1 + Math.floor(rand() * 3);
  for (let s = 0; s < nShots; s++) {
    const folder = FOLDERS[Math.floor(rand() * FOLDERS.length)];
    const base = NAMES[Math.floor(rand() * NAMES.length)].replace(/\.mov$/, '');
    const size = SIZES[Math.floor(rand() * SIZES.length)];
    if (!claim(folder, base + '.mov')) continue;
    const shot = { folder: folder, base: base, size: size, orig: null, proxy: null };
    const mkFile = function (name, sz) {
      const f = { name: name, type: 'video/quicktime', size: sz };
      if (folder) f._kraftedPath = folder;
      return f;
    };
    if (rand() < 0.9) {                       // the original arrives
      shot.orig = mkFile(base + '.mov', size);
      batch.push(shot.orig);
    }
    if (rand() < 0.8) {                       // the proxy arrives
      shot.proxy = mkFile(base + '_proxy.mov', Math.floor(size / 2) + 1);
      batch.push(shot.proxy);
    }
    // decoy: the same base name in a DIFFERENT folder with a different size.
    // This is the collision that costs a conform the wrong take.
    if (rand() < 0.45) {
      const other = folder === 'takeA' ? 'takeB' : 'takeA';
      if (claim(other, base + '.mov')) {
        const d = { name: base + '.mov', type: 'video/quicktime', size: size + 1 };
        d._kraftedPath = other;
        batch.push(d);
      }
    }
    shots.push(shot);
  }
  const shuffled = batch.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t;
  }

  // ── I3: pairing is order-independent ────────────────────────────────────
  // EXCEPT when the batch genuinely holds two originals whose names differ
  // only by case AND the proxy matches neither exactly. Then the choice is
  // arbitrary by definition and no rule can make it otherwise. That is a
  // documented limitation, not a bug -- so it is excluded here and pinned by
  // I6 below, which asserts the part that CAN be deterministic: exact case
  // always wins, whatever order the files arrived in.
  const lowerCount = {};
  batch.forEach(function (f) {
    if (/_proxy\./.test(f.name)) return;
    const k = f.name.replace(/\.[^.]+$/, '').toLowerCase();
    lowerCount[k] = (lowerCount[k] || 0) + 1;
  });
  const caseCollision = Object.keys(lowerCount).some(function (k) { return lowerCount[k] > 1; });
  if (!caseCollision) {
    const p1 = api.planProxyPairs(batch.map(f => f.name));
    const p2 = api.planProxyPairs(shuffled.map(f => f.name));
    for (const k of Object.keys(p1)) {
      check(p2[k] && p2[k].originalName === p1[k].originalName && p2[k].skip === p1[k].skip,
        'I3 pairing depends on arrival order', { name: k, a: p1[k], b: p2[k] ? p2[k] : null });
    }
  }

  // ── I6: when an exact-case original exists it wins, in any order ─────────
  {
    const a = api.planProxyPairs(['Shot01.mov', 'shot01.mov', 'Shot01_proxy.mov']);
    const b = api.planProxyPairs(['shot01.mov', 'Shot01_proxy.mov', 'Shot01.mov']);
    check(a['Shot01_proxy.mov'].originalName === 'Shot01.mov' &&
          b['Shot01_proxy.mov'].originalName === 'Shot01.mov',
      'I6 exact case does not beat the case-insensitive match regardless of order',
      { a: a['Shot01_proxy.mov'].originalName, b: b['Shot01_proxy.mov'].originalName });
    // and a proxy that only exists in a different case still pairs at all
    const c = api.planProxyPairs(['Shot01.mov', 'SHOT01_proxy.mov']);
    check(c['SHOT01_proxy.mov'].originalName === 'Shot01.mov',
      'I6b a proxy in another case still finds its original', c['SHOT01_proxy.mov'].originalName);
  }

  // ── pool + cards ────────────────────────────────────────────────────────
  api.pool.clear();
  api.noteDroppedFiles(batch);

  // A card per shot that actually got a proxy: the card remembers where its
  // original lived, exactly as import does.
  const cards = [];
  shots.forEach(function (shot, idx) {
    if (!shot.proxy) return;
    const origName = shot.base + '.mov';
    cards.push({
      card: { id: 'c' + idx, isProxy: true, isVideo: true,
              originalName: origName,
              originalPath: shot.folder ? shot.folder + '/' + origName : '',
              originalSize: shot.orig ? shot.size : 0 },
      shot: shot,
    });
  });

  cards.forEach(function (pair) {
    const card = pair.card, shot = pair.shot;
    const got = api.rememberedOriginalFor(card);

    // I7 (the P2 promise): if this shot's original really is in the pool
    // under the key the card was stamped with, the card MUST find it. A miss
    // here means the user is sent to a picker for a file they just dragged
    // in -- and, worse, may pick the wrong take by hand.
    if (shot.orig) {
      const wantKey = api.dropKeyOf(shot.orig);
      const inPool = api.pool.get(wantKey);
      if (inPool && inPool.size === shot.size) {
        check(got === shot.orig,
          'I7 the original was dropped and remembered, but the card could not find it',
          { wantKey: wantKey, poolKeys: Array.from(api.pool.keys()), got: got ? got.name : null });
      }
    }

    if (!got) return;                       // no match is always allowed
    // I1: never a size disagreement
    check(got.size === card.originalSize,
      'I1 linked a file whose size disagrees', { want: card.originalSize, got: got.size, key: api.originalKeyFor(card) });
    // I2: if the card has a folder, the file must come from that folder
    if (card.originalPath) {
      check(api.dropKeyOf(got) === card.originalPath,
        'I2 resolved to a different folder', { want: card.originalPath, got: api.dropKeyOf(got) });
    }
  });

  // ── I8: the size guard, targeted. The generator cannot easily produce a
  // key that holds the WRONG size (each (folder,name) is one file), and
  // without this the "size must agree" half of the rule was silently
  // untested -- removing it made no fuzz case fail.
  {
    api.pool.clear();
    const only = { name: 'sz.mov', type: 'video/quicktime', size: 999 };
    api.noteDroppedFiles([only]);
    const disagree = { id: 'sz1', isProxy: true, isVideo: true, originalName: 'sz.mov', originalPath: '', originalSize: 500 };
    check(api.rememberedOriginalFor(disagree) === null,
      'I8 a file with a different size was accepted anyway', { poolSize: 999, cardSize: 500 });
    const agree = { id: 'sz2', isProxy: true, isVideo: true, originalName: 'sz.mov', originalPath: '', originalSize: 999 };
    check(api.rememberedOriginalFor(agree) === only,
      'I8b the file that DOES agree was not found', { got: api.rememberedOriginalFor(agree) });
  }

  // ── I4: a proxy with no original in the batch is unpaired ───────────────
  const alone = api.planProxyPairs(['lonely_proxy.mov']);
  check(alone['lonely_proxy.mov'].originalName === null,
    'I4 an unpaired proxy was given an original anyway', alone['lonely_proxy.mov']);

  // ── I5: no path at all -> the name is the key and the newest wins ────────
  api.pool.clear();
  const f1 = { name: 'dup.mov', type: 'video/quicktime', size: 11 };
  const f2 = { name: 'dup.mov', type: 'video/quicktime', size: 22 };
  api.noteDroppedFiles([f1, f2]);
  check(api.pool.size === 1 && api.pool.get('dup.mov') === f2,
    'I5 the documented name-only fallback changed', { size: api.pool.size });
}

if (broken.length) {
  console.log('FUZZ FAILED — ' + broken.length + ' broken invariant(s). First 10:');
  broken.slice(0, 10).forEach(b => console.log('  ' + b));
  process.exit(1);
}
console.log('FUZZ OK — ' + ITER + ' random batches, 6 invariants (I1,I2,I3,I4,I5,I6), 0 violations');
