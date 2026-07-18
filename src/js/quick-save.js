// ============================================================
//  QUICK SAVE — Ctrl+S native folder save + auto-restore
//  Like Photoshop: first save picks a folder, then Ctrl+S
//  overwrites. On app start, auto-restores from last save path.
// ============================================================

import { restoreBoard, saveBoard, serializeBoard } from './save-load.js';
import { toast } from './ui-utils.js';

var _qs = {
  // IndexedDB key for persisting the directory handle
  DB_NAME: 'krafted-quick-save',
  STORE_NAME: 'handles',
  HANDLE_KEY: 'last-save-dir',
  FILE_NAME: 'autosave.kraft',
  db: null
};

// ── IndexedDB wrapper ─────────────────────────────────────────
function _qsOpenDB() {
  return new Promise(function(resolve, reject) {
    if (_qs.db) return resolve(_qs.db);
    var req = indexedDB.open(_qs.DB_NAME, 1);
    req.onupgradeneeded = function() {
      req.result.createObjectStore(_qs.STORE_NAME);
    };
    req.onsuccess = function() {
      _qs.db = req.result;
      resolve(_qs.db);
    };
    req.onerror = function() { reject(req.error); };
  });
}

function _qsStoreHandle(dirHandle) {
  return _qsOpenDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(_qs.STORE_NAME, 'readwrite');
      var store = tx.objectStore(_qs.STORE_NAME);
      store.put(dirHandle, _qs.HANDLE_KEY);
      tx.oncomplete = resolve;
      tx.onerror = function() { reject(tx.error); };
    });
  });
}

function _qsGetHandle() {
  return _qsOpenDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(_qs.STORE_NAME, 'readonly');
      var store = tx.objectStore(_qs.STORE_NAME);
      var req = store.get(_qs.HANDLE_KEY);
      req.onsuccess = function() { resolve(req.result || null); };
      req.onerror = function() { reject(req.error); };
    });
  });
}

function _qsClearHandle() {
  return _qsOpenDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(_qs.STORE_NAME, 'readwrite');
      var store = tx.objectStore(_qs.STORE_NAME);
      store.delete(_qs.HANDLE_KEY);
      tx.oncomplete = resolve;
      tx.onerror = function() { reject(tx.error); };
    });
  });
}

// ── Build .kraft blob ──────────────────────────────────────────
// .kraft = JSON manifest (same format as .kpak but flat — no zip wrapper).
// Smaller and faster for quick save. No password support (that's for .kpak).
function _qsBuildBlob() {
  try {
    var data = serializeBoard();  // defined in save-load.js
    var json = JSON.stringify(data);
    return new Blob([json], { type: 'application/x-krafted' });
  } catch(e) {
    console.error('[QuickSave] Build failed:', e);
    return null;
  }
}

// ── Quick Save (Ctrl+S) ───────────────────────────────────────
// If we have a saved directory handle → overwrite autosave.kraft.
// If not → prompt user to pick a folder (Save As).
export async function quickSave() {
  if (!window.showDirectoryPicker) {
    // Fallback: use regular .kpak save
    saveBoard();
    return;
  }

  var dirHandle = await _qsGetHandle();
  if (!dirHandle) {
    return quickSaveAs();
  }

  // Verify permission — may have expired after browser restart
  try {
    await dirHandle.requestPermission({ mode: 'readwrite' });
  } catch(e) {
    // Permission denied → ask user to re-pick
    console.log('[QuickSave] Permission expired, re-prompting');
    await _qsClearHandle();
    return quickSaveAs();
  }

  try {
    var blob = _qsBuildBlob();
    if (!blob) { toast('Quick save failed: could not build file'); return; }

    var fileHandle = await dirHandle.getFileHandle(_qs.FILE_NAME, { create: true });
    var writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    toast('Quick saved');
    console.log('[QuickSave] Saved to', dirHandle.name + '/' + _qs.FILE_NAME);
  } catch(e) {
    console.error('[QuickSave] Write failed:', e);
    toast('Quick save failed: ' + (e.message || 'unknown error'));
  }
}

// ── Save As — pick a folder ───────────────────────────────────
export async function quickSaveAs() {
  if (!window.showDirectoryPicker) {
    saveBoard();
    return;
  }

  try {
    var dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await _qsStoreHandle(dirHandle);

    var blob = _qsBuildBlob();
    if (!blob) { toast('Save failed: could not build file'); return; }

    var fileHandle = await dirHandle.getFileHandle(_qs.FILE_NAME, { create: true });
    var writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    toast('Saved to ' + dirHandle.name + '/' + _qs.FILE_NAME);
    console.log('[QuickSave] Save As to', dirHandle.name + '/' + _qs.FILE_NAME);
  } catch(e) {
    if (e && (e.name === 'AbortError' || e.code === 20)) return; // user cancelled
    console.error('[QuickSave] Save As failed:', e);
    toast('Save failed: ' + (e.message || 'unknown error'));
  }
}

// ── Auto-restore on app start ─────────────────────────────────
// Runs after the main init. Checks IndexedDB for last save path,
// reads autosave.kraft, and restores the board.
(function _qsAutoRestore(){
  // Wait a tick for the rest of the app to initialize
  setTimeout(function(){
    if (!window.showDirectoryPicker) return;

    _qsGetHandle().then(function(dirHandle){
      if (!dirHandle) return; // never quick-saved before

      // Check permission silently
      dirHandle.requestPermission({ mode: 'readwrite' }).then(function(){
        return dirHandle.getFileHandle(_qs.FILE_NAME, { create: false });
      }).then(function(fileHandle){
        return fileHandle.getFile();
      }).then(function(file){
        return file.text();
      }).then(function(json){
        var data = JSON.parse(json);
        if (data && data.items && typeof restoreBoard === 'function') {
          restoreBoard(data);
          try { hideWelcome(); } catch(e) {}
          console.log('[QuickSave] Auto-restored from ' + dirHandle.name + '/' + _qs.FILE_NAME);
        }
      }).catch(function(e){
        // File doesn't exist yet, or permission denied — silent
        if (e && e.name !== 'NotFoundError') {
          console.log('[QuickSave] Auto-restore skipped:', e.message);
        }
      });
    }).catch(function(){});
  }, 500);
})();

// ── Hook Ctrl+S ───────────────────────────────────────────────
// Override the existing Ctrl+S handler to use quick save.
// Original saveBoard() is still accessible via File → Save menu.
(function _qsHookKeyboard(){
  var _origKeydown = document.onkeydown;
  document.addEventListener('keydown', function(e){
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      // Don't intercept if user is typing in a text editor
      var ae = document.activeElement;
      if (ae && (ae.contentEditable === 'true' || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      quickSave();
    }
  });
})();

// Expose to window so toolbar/menu can call it
window.quickSave = quickSave;
window.quickSaveAs = quickSaveAs;
