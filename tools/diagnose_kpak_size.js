// Krafted - save-size diagnosis. Paste into DevTools console on the board.
// Answers one question: why is the .kpak bigger than the files I imported?
// Read-only. Does not touch state.
(async function () {
  var MB = 1048576, KB = 1024;
  function fmt(b) {
    if (b >= MB) return (b / MB).toFixed(1) + ' MB';
    if (b >= KB) return (b / KB).toFixed(0) + ' KB';
    return b + ' B';
  }

  // ---- 1. what does each item's src look like -------------------------
  var byKind = { 'blob:': 0, 'data:': 0, 'http': 0, empty: 0, other: 0 };
  var dataUrlBytes = 0, dataUrlCount = 0;
  var conflict = [];          // _sourceBlob still set AND src is a data URL
  var brushBytes = 0, brushCount = 0;
  var sourceBlobBytes = 0;

  (state.items || []).forEach(function (it) {
    var s = it.src || '';
    if (!s) { byKind.empty++; return; }
    if (s.indexOf('data:') === 0) {
      byKind['data:']++;
      dataUrlBytes += s.length;
      dataUrlCount++;
      // This is the double-store: buildKpakV6 prefers _sourceBlob, so the
      // zip entry is the OLD file while manifest.json also carries the NEW
      // cropped image as base64. Two copies of one image, and the visible
      // one is not the one that round-trips.
      if (it._sourceBlob instanceof Blob && it._sourceBlob.size > 0) {
        conflict.push({
          id: it.id,
          file: it.filename || '(no name)',
          staleBlob: it._sourceBlob.size,
          dataUrl: Math.round(s.length * 0.75)
        });
      }
    } else if (s.indexOf('blob:') === 0) {
      byKind['blob:']++;
      if (it._sourceBlob instanceof Blob) sourceBlobBytes += it._sourceBlob.size;
    } else if (s.indexOf('http') === 0) {
      byKind.http++;
    } else {
      byKind.other++;
    }
    (it.masks || []).forEach(function (mk) {
      if (mk.brushData) { brushBytes += mk.brushData.length; brushCount++; }
    });
  });

  // ---- 2. how big is the manifest we are about to write ---------------
  var manifestBytes = 0, manifestJson = '';
  try {
    if (typeof buildManifest === 'function') {
      manifestJson = JSON.stringify(buildManifest());
      manifestBytes = manifestJson.length;
    }
  } catch (e) {
    manifestBytes = -1;
  }

  // ---- 3. report ------------------------------------------------------
  console.log('%c=== Krafted save-size diagnosis ===', 'font-weight:bold;font-size:13px');
  console.log('items on board        :', (state.items || []).length);
  console.log('  src is blob: URL    :', byKind['blob:']);
  console.log('  src is data: URL    :', byKind['data:'], byKind['data:'] ? ('  <-- ' + fmt(dataUrlBytes) + ' of base64') : '');
  console.log('  src is http(s)      :', byKind.http);
  console.log('  src empty / other   :', byKind.empty, '/', byKind.other);
  console.log('');
  console.log('manifest.json size    :', manifestBytes < 0 ? 'buildManifest() unavailable' : fmt(manifestBytes),
              manifestBytes > 5 * MB ? '  <-- TOO BIG' : '');
  console.log('masks[].brushData     :', fmt(brushBytes), '(' + brushCount + ' masks)');
  console.log('');

  if (conflict.length) {
    console.log('%c!!! ' + conflict.length + ' item(s) are stored TWICE and round-trip the WRONG BYTES', 'color:#ff5252;font-weight:bold');
    console.log('These have a stale _sourceBlob AND a data: URL src.');
    console.log('  - zip entry gets the OLD uncropped file   (from _sourceBlob)');
    console.log('  - manifest.json also carries the NEW crop (as base64 PNG)');
    console.log('Cost: old file + 1.33x the new PNG, per item.');
    console.table(conflict.slice(0, 30).map(function (c) {
      return {
        id: c.id,
        file: c.file,
        'stale blob (zip entry)': fmt(c.staleBlob),
        'new image (in manifest)': fmt(c.dataUrl)
      };
    }));
    if (conflict.length > 30) console.log('... and ' + (conflict.length - 30) + ' more');
  } else if (dataUrlCount) {
    console.log('%c' + dataUrlCount + ' item(s) have a data: URL src.', 'color:#ff9800');
    console.log('Each is written twice: base64 inside manifest.json, plus a');
    console.log('decoded media entry. Expected overhead ~2.33x for those items.');
  } else {
    console.log('%cNo data: URL sources. Save path is 1:1.', 'color:#4caf50');
    console.log('If the .kpak is still larger than what you imported, the growth');
    console.log('is in the media bytes themselves, not in the save logic.');
  }

  if (brushBytes > 20 * MB) {
    console.log('');
    console.log('%cBrush masks are carrying ' + fmt(brushBytes) + ' of base64 PNG.', 'color:#ff9800');
    console.log('The brush canvas is sized from the on-screen rect, so masks');
    console.log('painted while zoomed in store a very large PNG.');
  }

  console.log('');
  console.log('Paste the numbers above back to me.');
})();
