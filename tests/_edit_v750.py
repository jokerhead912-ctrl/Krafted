#!/usr/bin/env python3
# v7.5.0 surgical edits. Anchors must match EXACTLY once or the run aborts.
import sys, io, os

HTML = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'kraftpub-dev.html')
HTML = os.path.abspath(HTML)
src = io.open(HTML, encoding='utf-8').read()
fails = []

def swap(old, new, label):
    global src
    n = src.count(old)
    if n != 1:
        fails.append('%s: anchor matched %d times (need 1)' % (label, n))
        return
    src = src.replace(old, new, 1)
    print('  ok   %s' % label)

# ── 1. folder drop: route directories away from the flat-file path ────────
swap(
"""window.addEventListener('drop', function(e){
  try { console.log('[FileDrop] window capture-phase drop, files:', e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files.length : 0, 'types:', e.dataTransfer && e.dataTransfer.types ? Array.from(e.dataTransfer.types).join(',') : ''); } catch (err) {}
  e.preventDefault();
  e.stopPropagation();
  const dropped = _collectDroppedFiles(e.dataTransfer);""",
"""// v7.5.0: a dropped FOLDER has to be resolved from the DataTransferItem
// entries, never from dataTransfer.files. Chrome lists a directory in
// .files as a zero-byte placeholder with type '', so _collectDroppedFiles
// happily hands it to _handleFileDrop, whose media filter matches nothing
// and returns without saying a word. The recursive reader
// (_handleEntryDrop) is wired to the viewport's own drop listener -- which
// this capture-phase handler stops before it can ever run. So the entries
// have to be asked for HERE, synchronously, because they die with the event.
function _dropEntries(dt) {
  try {
    const items = dt && dt.items;
    if (!items || !items.length || typeof items[0].webkitGetAsEntry !== 'function') return null;
    const out = [];
    for (let i = 0; i < items.length; i++) {
      let en = null;
      try { en = items[i].webkitGetAsEntry(); } catch (e2) {}
      if (en) out.push(en);
    }
    return out.length ? out : null;
  } catch (e2) { return null; }
}
function _dropHasDirectory(entries) {
  for (let i = 0; i < entries.length; i++) if (entries[i] && entries[i].isDirectory) return true;
  return false;
}
window.addEventListener('drop', function(e){
  try { console.log('[FileDrop] window capture-phase drop, files:', e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files.length : 0, 'types:', e.dataTransfer && e.dataTransfer.types ? Array.from(e.dataTransfer.types).join(',') : ''); } catch (err) {}
  e.preventDefault();
  e.stopPropagation();
  // v7.5.0: folders first. Mixed drops (a folder plus loose files) go the
  // same way -- _handleEntryDrop reads plain file entries too, so nothing
  // is lost by routing the whole drop through it.
  const _dirEntries = _dropEntries(e.dataTransfer);
  if (_dirEntries && _dropHasDirectory(_dirEntries)) {
    try { hideWelcome(); } catch (err) {}
    try { _handleEntryDrop(e, _dirEntries); } catch (err) { console.warn('[FileDrop] folder drop error:', err); }
    return;
  }
  const dropped = _collectDroppedFiles(e.dataTransfer);""",
'1 window drop routes folders')

# ── 2. _handleEntryDrop: the pending counter ──────────────────────────────
swap(
"""function _handleEntryDrop(e, entries) {
  var allFiles = [];
  var pending = entries.length;

  function readEntry(entry, path) {
    if (entry.isFile) {
      pending++;
      entry.file(function(file) {
        file._kraftedPath = path;
        allFiles.push(file);
        pending--;
        if (pending === 0) _finishFolderImport(e, allFiles);
      }, function(err) {
        console.warn('[FileDrop] Failed to read file:', entry.name, err);
        pending--;
        if (pending === 0) _finishFolderImport(e, allFiles);
      });
    } else if (entry.isDirectory) {
      var reader = entry.createReader();
      var subPath = path ? path + '/' + entry.name : entry.name;
      function readBatch() {
        reader.readEntries(function(batch) {
          if (batch.length === 0) {
            pending--;
            if (pending === 0) _finishFolderImport(e, allFiles);
            return;
          }
          pending += batch.length;
          batch.forEach(function(subEntry) { readEntry(subEntry, subPath); });
          pending--; // this batch done
          readBatch(); // continue reading (directory readers return max 100 entries)
        }, function(err) {
          console.warn('[FileDrop] Failed to read directory:', entry.name, err);
          pending--;
          if (pending === 0) _finishFolderImport(e, allFiles);
        });
      }
      readBatch();
    } else {
      pending--;
      if (pending === 0) _finishFolderImport(e, allFiles);
    }
  }

  entries.forEach(function(entry) { readEntry(entry, ''); });
}""",
"""function _handleEntryDrop(e, entries) {
  var allFiles = [];
  // v7.5.0: one unit of outstanding work per entry, plus one per child at
  // the moment it is discovered. The old counter seeded
  // `pending = entries.length` AND then added `pending += batch.length`
  // for a directory's children, while the file branch also did `pending++`
  // on top of the seed -- so every child was counted twice and decremented
  // once, and `pending` settled at (children - 1) instead of 0.
  // _finishFolderImport never fired, which makes the whole v7.4.0 "one
  // named block per folder" feature dead code: of six folder shapes
  // exactly one (a folder holding a single file) imported anything.
  var pending = 0;
  var settled = false;

  function settle() {
    pending--;
    if (pending <= 0 && !settled) { settled = true; _finishFolderImport(e, allFiles); }
  }

  function readEntry(entry, path) {
    pending++;
    if (entry.isFile) {
      entry.file(function(file) {
        file._kraftedPath = path;
        allFiles.push(file);
        settle();
      }, function(err) {
        console.warn('[FileDrop] Failed to read file:', entry.name, err);
        settle();
      });
    } else if (entry.isDirectory) {
      var reader = entry.createReader();
      var subPath = path ? path + '/' + entry.name : entry.name;
      function readBatch() {
        reader.readEntries(function(batch) {
          if (batch.length === 0) { settle(); return; }
          // Children are registered BEFORE this directory settles, so the
          // counter can never dip to zero while a subtree is still open.
          batch.forEach(function(subEntry) { readEntry(subEntry, subPath); });
          readBatch(); // directory readers return at most 100 entries per call
        }, function(err) {
          console.warn('[FileDrop] Failed to read directory:', entry.name, err);
          settle();
        });
      }
      readBatch();
    } else {
      settle();
    }
  }

  entries.forEach(function(entry) { readEntry(entry, ''); });
  // Nothing to read (every entry unreadable): settle now or the drop is lost.
  if (pending === 0 && !settled) { settled = true; _finishFolderImport(e, allFiles); }
}""",
'2 entry drop counter')

# ── 3. Pinterest / no-URL drag: say it on screen ──────────────────────────
swap(
"""    try { console.warn('[FileDrop] drop received but no URL candidates found. html:', _rawHtml.length, 'uri:', _rawUri.length, 'plain:', _rawPlain.length); } catch (e) {}
    return;
  }""",
"""    try { console.warn('[FileDrop] drop received but no URL candidates found. html:', _rawHtml.length, 'uri:', _rawUri.length, 'plain:', _rawPlain.length); } catch (e) {}
    // v7.5.0: a console line still reads as "nothing happened" from where
    // the user is sitting -- the reported symptom was literally "拖過去冇
    // 反應". Say it on screen too, with the three payload lengths, so a
    // screenshot of the toast alone says which branch the drag died in.
    try {
      toast((_isZhUI()
        ? '呢个拖放冇带图片网址（html ' + _rawHtml.length + ' / uri ' + _rawUri.length + ' / plain ' + _rawPlain.length + '）—— 截图再 Cmd+V 最稳'
        : 'That drag carried no image URL (html ' + _rawHtml.length + ' / uri ' + _rawUri.length + ' / plain ' + _rawPlain.length + ') - screenshot and paste instead'));
    } catch (e) {}
    return;
  }""",
'3 no-URL toast')

# ── 4. import edge cap: 4096 -> 2048 ──────────────────────────────────────
swap(
"""const IMAGE_MAX_EDGE_LOCAL = 4096;""",
"""// v7.5.0: was 4096. This constant is the biggest single lever on what a
// board costs, because it sets the DECODED size, not the file size: a
// 4096x4096 <img> is 4096*4096*4 = 67 MB of RGBA once Chrome decodes it,
// and a 300-image board was asking for ~20 GB of decoded pixels. 2048
// costs 16 MB per image (4x less), is still crisp at 200% zoom on a 4K
// display, and is 2.8x the 720px rows the board export writes -- so
// nothing the app produces loses visible detail. Retune here, once.
const IMAGE_MAX_EDGE_LOCAL = 2048;""",
'4 import edge cap')

# ── 5. undo budget ────────────────────────────────────────────────────────
swap(
"""const _UNDO_MAX_BYTES = 300 * 1024 * 1024;""",
"""// v7.5.0: was 300 MB. Every snapshot is a JSON string of the whole board,
// so 300 MB of history sat in the same renderer heap as 300 MB of image
// bytes -- two budgets that were each sized as if the other did not
// exist. Undo history is the half the user never asked to pay for: 100
// steps is already more than anyone scrolls back through, and at a
// typical 200-800 KB snapshot that is well under 80 MB.
const _UNDO_MAX_BYTES = 80 * 1024 * 1024;""",
'5 undo budget')

# ── 6. media blob cache: smaller, and a true LRU ──────────────────────────
swap(
"""var _MEDIA_BLOB_CACHE_MAX_BYTES = 1024 * 1024 * 1024;  // 1 GB
var _MEDIA_BLOB_CACHE_MAX_ENTRIES = 64;""",
"""// v7.5.0: was 1 GB / 64 entries. This cache exists so delete -> Ctrl+Z
// can re-mint a revoked blob URL, i.e. it only ever needs to hold what
// the user might still undo. It is also the one place a Blob is
// deliberately kept alive after every item referencing it is gone, so a
// 1 GB ceiling was a leak with a polite name. Halved, and made a real
// LRU below (it was FIFO: the oldest deletion survived while something
// the user kept undoing back into existence could be evicted).
var _MEDIA_BLOB_CACHE_MAX_BYTES = 512 * 1024 * 1024;   // 512 MB
var _MEDIA_BLOB_CACHE_MAX_ENTRIES = 96;""",
'6 blob cache size')

swap(
"""    var b = _mediaBlobByUrl.get(victim);
    _mediaBlobByUrl.delete(victim);
    _mediaBlobBytes -= (b && b.size) || 0;""",
"""    var b = _mediaBlobByUrl.get(victim);
    _mediaBlobByUrl.delete(victim);
    // v7.5.0: a re-minted URL is an ALIAS for bytes already accounted for
    // under the original key. Charge the eviction only when no other key
    // still holds the same Blob, or repeated re-minting drives the running
    // total negative and the ceiling quietly stops working.
    var stillHeld = false;
    _mediaBlobByUrl.forEach(function (v) { if (v === b) stillHeld = true; });
    if (!stillHeld) _mediaBlobBytes -= (b && b.size) || 0;""",
'6b alias-aware eviction')

swap(
"""  if (!_revokedBlobUrls.has(src)) return { src: src, blob: _mediaBlobByUrl.get(src) || null };
  var blob = _mediaBlobByUrl.get(src);
  if (!blob) return null;                       // evicted from the cache
  var fresh = URL.createObjectURL(blob);
  // Alias without charging the budget twice: it is the same bytes the
  // cache already accounts for under the original URL.
  _mediaBlobByUrl.set(fresh, blob);
  return { src: fresh, blob: blob };""",
"""  // v7.5.0: a read is a use. Re-insert to move the entry to the back of
  // the Map, which is what makes the trim loop evict the LEAST recently
  // used entry instead of the oldest one.
  if (!_revokedBlobUrls.has(src)) {
    if (_mediaBlobByUrl.has(src)) {
      var kept = _mediaBlobByUrl.get(src);
      _mediaBlobByUrl.delete(src);
      _mediaBlobByUrl.set(src, kept);
    }
    return { src: src, blob: _mediaBlobByUrl.get(src) || null };
  }
  var blob = _mediaBlobByUrl.get(src);
  if (!blob) return null;                       // evicted from the cache
  var fresh = URL.createObjectURL(blob);
  // Alias without charging the budget twice: it is the same bytes the
  // cache already accounts for under the original URL. The ORIGINAL key
  // stays put -- a second item sharing this src (duplicate / paste) must
  // still resolve after this re-mint.
  _mediaBlobByUrl.set(fresh, blob);
  _mediaBlobByUrl.delete(src);
  _mediaBlobByUrl.set(src, blob);
  return { src: fresh, blob: blob };""",
'6c LRU recency bump')

# ── 7. images: revoke on delete (the leak) ────────────────────────────────
swap(
"""    // No Blob in hand: leave the URL alive. Leaking a handle is the
    // right trade against silently breaking Ctrl+Z.
  }
}
// Detach the comments popover (lives on <body>) for an item.""",
"""    // No Blob in hand: leave the URL alive. Leaking a handle is the
    // right trade against silently breaking Ctrl+Z.
  }
}
// v7.5.0 -- the image half of the rule above, which only ever covered
// video. An unrevoked object URL pins its Blob in the renderer heap for
// the life of the document: dropping every JS reference to it does NOT
// free the bytes, only revokeObjectURL does. So every image the user ever
// deleted kept its full payload resident forever, which is why a session
// of "add a few, delete a few, add a few more" walked steadily into OOM
// while a session of only adding did not. The asymmetry between the two
// media types is what made this read as a random crash, not a leak.
//
// Same contract: revoke only when the bytes are banked, so Delete ->
// Ctrl+Z still brings the picture back, and leave the URL alone when
// they are not.
function cleanupImageItem(item, revokeBlob) {
  if (!item || item.isVideo || item.video) return;   // video owns its own path
  if (revokeBlob === undefined) revokeBlob = true;
  if (!revokeBlob) return;
  const isrc = item.src;
  if (typeof isrc !== 'string' || isrc.indexOf('blob:') !== 0) return;
  if (_cacheMediaBlob(isrc, item._sourceBlob || _mediaBlobByUrl.get(isrc))) {
    _revokedBlobUrls.add(isrc);
    URL.revokeObjectURL(isrc);
  }
}
// Detach the comments popover (lives on <body>) for an item.""",
'7 cleanupImageItem')

swap(
"""  sel.forEach(i => {
    cleanupVideoItem(i);
    removeAnnoPopoversFor(i);""",
"""  sel.forEach(i => {
    cleanupVideoItem(i);
    cleanupImageItem(i);
    removeAnnoPopoversFor(i);""",
'7b call site')

# ── 8. off-screen image culling (the real LRU over DECODED pixels) ────────
swap(
"""// ==== canvas-view.js ====


// ============================================================
//  CANVAS / VIEW
// ============================================================
function updateCanvas() {""",
"""// ==== canvas-view.js ====


// ============================================================
//  CANVAS / VIEW
// ============================================================
// v7.5.0 -- OFF-SCREEN IMAGE CULLING.
//
// Every image on the board is a live <img>, and Chrome holds a DECODED
// bitmap per element: w*h*4 bytes, which at the import cap is 16 MB a
// picture. Chrome decides for itself when to drop those, so a big board
// was a bet on its eviction policy rather than a budget -- and panning
// across the board or selecting a dozen images at once is exactly when
// that bet loses and the tab dies.
//
// So take the decision away from it: a card well outside the viewport has
// its src detached, which releases the decoded bitmap immediately.
// NOTHING ABOUT THE ITEM CHANGES -- item.src still holds the live blob
// URL, so export, save, undo and the data model are untouched, and
// restoring is a string assignment. That is the whole point of culling
// the attribute rather than revoking the URL: a revoked URL is a one-way
// door that every consumer would then have to know about.
//
// Deliberately NOT content-visibility / contain: those apply layout
// containment, which breaks the getBoundingClientRect hit testing the
// canvas pointer handlers depend on.
const IMG_CULL_MARGIN = 1.5;      // keep one and a half screens around the view
const IMG_CULL_MIN_ITEMS = 40;    // below this there is nothing worth culling
let _imgCullHandle = null;

function _cullOffscreenImages() {
  try {
    const items = (state && state.items) ? state.items : [];
    if (items.length < IMG_CULL_MIN_ITEMS) { _ensureAllImagesLive(); return; }
    const vw = window.innerWidth || 0, vh = window.innerHeight || 0;
    if (!vw || !vh) return;
    const mx = vw * IMG_CULL_MARGIN, my = vh * IMG_CULL_MARGIN;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it || it.isVideo || it.video) continue;
      const img = it.img;
      if (!img || !img.parentNode) continue;
      const s = it.src;
      // Only local bytes can be put back for free. A remote src is left
      // alone: re-assigning it means a second fetch and a flicker on
      // every pan, for a card that is off screen anyway.
      if (typeof s !== 'string' || s === '' ||
          (s.indexOf('blob:') !== 0 && s.indexOf('data:') !== 0)) continue;
      let r = null;
      try { r = (it.el || img).getBoundingClientRect(); } catch (e) { continue; }
      const off = r.bottom < -my || r.top > vh + my || r.right < -mx || r.left > vw + mx;
      if (off) {
        if (img.getAttribute('src') !== null) {
          img.removeAttribute('src');
          it._imgCulled = true;
        }
      } else if (it._imgCulled) {
        img.src = s;
        it._imgCulled = false;
      }
    }
  } catch (e) { console.warn('[ImgCull] skipped:', e && e.message); }
}

// Coalesced: updateCanvas runs on every pan/zoom tick (60-120/sec during
// a trackpad swipe) and a cull walk is far too much to do there.
function scheduleImageCull() {
  if (_imgCullHandle) clearTimeout(_imgCullHandle);
  _imgCullHandle = setTimeout(function () { _imgCullHandle = null; _cullOffscreenImages(); }, 220);
}

// Call from anything that reads the pixels of many images at once. Cheap
// and safe: it only re-assigns strings and never revokes anything, so a
// missed call site costs a decode, never data.
function _ensureAllImagesLive() {
  try {
    const items = (state && state.items) ? state.items : [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it || !it._imgCulled || !it.img) continue;
      it.img.src = it.src;
      it._imgCulled = false;
    }
  } catch (e) {}
}

function updateCanvas() {""",
'8 culling machinery')

swap(
"""  const OFF = 50000;
  canvas.style.transform = `translate(${state.pan.x + OFF - OFF * state.zoom}px, ${state.pan.y + OFF - OFF * state.zoom}px) scale(${state.zoom})`;""",
"""  const OFF = 50000;
  canvas.style.transform = `translate(${state.pan.x + OFF - OFF * state.zoom}px, ${state.pan.y + OFF - OFF * state.zoom}px) scale(${state.zoom})`;
  // v7.5.0: the visible set changed, so the culling decision is stale.
  scheduleImageCull();""",
'8b cull on pan/zoom')

swap(
"""  async function processNextImage() {
    if (imgIdx >= imageFiles.length) return;""",
"""  async function processNextImage() {
    // v7.5.0: the batch is in, so re-run the cull with the new items.
    if (imgIdx >= imageFiles.length) { scheduleImageCull(); return; }""",
'8c cull after import')

swap(
"""async function exportAllImagesToFolder() {
  // Determine which images to export
  let images = [];""",
"""async function exportAllImagesToFolder() {
  // v7.5.0: off-screen images have their src detached; put every one back
  // before reading pixels out of them.
  _ensureAllImagesLive();
  // Determine which images to export
  let images = [];""",
'8d export ensures live')

swap(
"""function startPresent() {""",
"""function startPresent() {
  // v7.5.0: the tape flies the camera to each shot in turn, so nothing
  // may be culled while it plays.
  _ensureAllImagesLive();""",
'8e present ensures live')

if fails:
    print('\nABORTED -- nothing written:')
    for f in fails: print('  ' + f)
    sys.exit(1)

io.open(HTML, 'w', encoding='utf-8').write(src)
print('\nwrote %s (%d bytes)' % (HTML, len(src.encode('utf-8'))))
