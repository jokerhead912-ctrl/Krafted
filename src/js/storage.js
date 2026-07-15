// ============================================================
//  KraftedStorage — IndexedDB 主存 + localStorage fallback
//  Krafted v5.5.1
// ============================================================
//  解決 localStorage 5MB quota 限制，async 讀寫唔 freeze UI。
//  向下兼容：首次啟動自動 migrate 舊 localStorage data。
//  每次 save 自動 mirror 一份 JSON backup（keep 最近 5 個）。
// ============================================================

(function() {
  'use strict';

  var DB_NAME = 'KraftedDB';
  var DB_VERSION = 1;
  var STORE_NAME = 'KraftedStore';
  var SCHEMA_KEY = 'krafted_schema_version';
  var SCHEMA_VERSION = 1;
  var MAX_BACKUPS = 5;
  var BACKUP_PREFIX = 'Krafted_backup_';

  var db = null;
  var dbReady = false;
  var dbError = false;
  var initPromise = null;

  // ── IndexedDB: open / upgrade ─────────────────────────────
  function openDB() {
    if (initPromise) return initPromise;
    initPromise = new Promise(function(resolve, reject) {
      if (!window.indexedDB) {
        console.error('[KraftedStorage] IndexedDB not available — falling back to localStorage');
        dbError = true;
        reject(new Error('IndexedDB not available'));
        return;
      }
      var req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function(e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains(STORE_NAME)) {
          d.createObjectStore(STORE_NAME, { keyPath: 'key' });
          console.log('[KraftedStorage] Object store created');
        }
      };
      req.onsuccess = function(e) {
        db = e.target.result;
        dbReady = true;
        console.log('[KraftedStorage] IndexedDB opened, v' + DB_VERSION);
        resolve(db);
      };
      req.onerror = function(e) {
        console.error('[KraftedStorage] IndexedDB open failed:', e.target.error);
        dbError = true;
        reject(e.target.error);
      };
      req.onblocked = function() {
        console.warn('[KraftedStorage] IndexedDB blocked — close other tabs');
        dbError = true;
        reject(new Error('IndexedDB blocked'));
      };
    });
    return initPromise;
  }

  // ── Generic DB operation helper ────────────────────────────
  function dbOp(mode, callback) {
    return new Promise(function(resolve, reject) {
      if (dbError || !dbReady || !db) {
        reject(new Error('DB not ready'));
        return;
      }
      try {
        var tx = db.transaction(STORE_NAME, mode);
        var store = tx.objectStore(STORE_NAME);
        callback(store, resolve, reject, tx);
      } catch(e) {
        reject(e);
      }
    });
  }

  // ── setItem(key, value) ────────────────────────────────────
  function setItem(key, value) {
    return new Promise(function(resolve, reject) {
      if (dbError || !dbReady || !db) {
        // Fallback to localStorage
        try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch(e) {}
        resolve(false);
        return;
      }
      try {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        var req = store.put({ key: key, value: value, updated: Date.now() });
        req.onsuccess = function() {
          // Mirror to localStorage
          try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch(e) {}
          resolve(true);
        };
        req.onerror = function(e) {
          console.error('[KraftedStorage] setItem error:', key, e.target.error);
          // Fallback
          try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch(e2) {}
          reject(e.target.error);
        };
      } catch(e) {
        console.error('[KraftedStorage] setItem exception:', key, e);
        try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch(e2) {}
        reject(e);
      }
    });
  }

  // ── getItem(key) ───────────────────────────────────────────
  function getItem(key) {
    return new Promise(function(resolve, reject) {
      if (dbError || !dbReady || !db) {
        // Fallback to localStorage
        try { resolve(localStorage.getItem(key)); } catch(e) { resolve(null); }
        return;
      }
      try {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var store = tx.objectStore(STORE_NAME);
        var req = store.get(key);
        req.onsuccess = function() {
          if (req.result) {
            resolve(req.result.value);
          } else {
            // Fallback to localStorage
            try { resolve(localStorage.getItem(key)); } catch(e) { resolve(null); }
          }
        };
        req.onerror = function(e) {
          console.error('[KraftedStorage] getItem error:', key, e.target.error);
          try { resolve(localStorage.getItem(key)); } catch(e2) { resolve(null); }
        };
      } catch(e) {
        console.error('[KraftedStorage] getItem exception:', key, e);
        try { resolve(localStorage.getItem(key)); } catch(e2) { resolve(null); }
      }
    });
  }

  // ── getItemSync(key) — synchronous fallback ────────────────
  //  For code that cannot be made async easily (init, settings load).
  //  Tries localStorage first (mirror), falls back to sync XHR… no,
  //  just uses localStorage as the source of truth for sync reads.
  function getItemSync(key) {
    try { return localStorage.getItem(key); } catch(e) { return null; }
  }

  // ── removeItem(key) ────────────────────────────────────────
  function removeItem(key) {
    return new Promise(function(resolve, reject) {
      try { localStorage.removeItem(key); } catch(e) {}
      if (dbError || !dbReady || !db) { resolve(false); return; }
      try {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        var req = store.delete(key);
        req.onsuccess = function() { resolve(true); };
        req.onerror = function(e) {
          console.error('[KraftedStorage] removeItem error:', key, e.target.error);
          resolve(false);
        };
      } catch(e) {
        console.error('[KraftedStorage] removeItem exception:', key, e);
        resolve(false);
      }
    });
  }

  // ── getAllKeys() — returns [{key, value, updated}] ─────────
  function getAllKeys() {
    return new Promise(function(resolve, reject) {
      if (dbError || !dbReady || !db) { resolve([]); return; }
      try {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var store = tx.objectStore(STORE_NAME);
        var req = store.getAll();
        req.onsuccess = function() { resolve(req.result || []); };
        req.onerror = function(e) {
          console.error('[KraftedStorage] getAllKeys error:', e.target.error);
          resolve([]);
        };
      } catch(e) {
        console.error('[KraftedStorage] getAllKeys exception:', e);
        resolve([]);
      }
    });
  }

  // ── getAllKeysSync() — from localStorage mirror ────────────
  function getAllKeysSync() {
    var result = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('krafted_') === 0) {
          result.push({ key: k, value: localStorage.getItem(k) });
        }
      }
    } catch(e) {}
    return result;
  }

  // ── Migration: localStorage → IndexedDB ────────────────────
  function migrateFromLocalStorage() {
    return new Promise(function(resolve, reject) {
      if (dbError || !dbReady || !db) { resolve(0); return; }
      var count = 0;
      var keys = [];
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf('krafted_') === 0) keys.push(k);
        }
      } catch(e) {}

      if (keys.length === 0) { resolve(0); return; }

      // Check if we already migrated
      getItem(SCHEMA_KEY).then(function(v) {
        if (v === String(SCHEMA_VERSION)) { resolve(0); return; }

        console.log('[KraftedStorage] Migrating ' + keys.length + ' keys from localStorage...');
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        var done = 0;

        keys.forEach(function(key) {
          try {
            var val = localStorage.getItem(key);
            if (val !== null) {
              store.put({ key: key, value: val, updated: Date.now() });
              count++;
            }
          } catch(e) {
            console.warn('[KraftedStorage] Migrate failed for:', key, e);
          }
        });

        tx.oncomplete = function() {
          // Mark migration done
          store.put({ key: SCHEMA_KEY, value: String(SCHEMA_VERSION), updated: Date.now() });
          console.log('[KraftedStorage] Migration complete: ' + count + ' keys');
          resolve(count);
        };
        tx.onerror = function(e) {
          console.error('[KraftedStorage] Migration tx error:', e.target.error);
          resolve(count);
        };
      }).catch(function() {
        resolve(0);
      });
    });
  }

  // ── Auto-backup on save ────────────────────────────────────
  var backupQueue = null;
  var backupTimer = null;

  function triggerAutoBackup() {
    // Debounce: only backup once every 30 seconds max
    if (backupTimer) return;
    backupTimer = setTimeout(function() {
      backupTimer = null;
      doAutoBackup();
    }, 30000);
  }

  function doAutoBackup() {
    getAllKeys().then(function(all) {
      if (!all || all.length === 0) return;
      var dump = {};
      all.forEach(function(entry) {
        if (entry.key === SCHEMA_KEY) return; // skip schema marker
        dump[entry.key] = entry.value;
      });

      var now = new Date();
      var ts = now.getFullYear() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') + '_' +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0');
      var filename = BACKUP_PREFIX + ts + '.json';
      var blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });

      // Store backup metadata in IndexedDB
      var backupKey = 'krafted_backups_list';
      getItem(backupKey).then(function(raw) {
        var list = [];
        try { list = JSON.parse(raw || '[]'); } catch(e) { list = []; }
        list.push({ file: filename, time: Date.now(), keys: Object.keys(dump).length });
        // Keep only last MAX_BACKUPS
        if (list.length > MAX_BACKUPS) list = list.slice(-MAX_BACKUPS);
        setItem(backupKey, JSON.stringify(list));

        // Download the backup file
        try {
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = filename;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          setTimeout(function() {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }, 100);
          console.log('[KraftedStorage] Auto-backup: ' + filename + ' (' + Object.keys(dump).length + ' keys)');
        } catch(e) {
          console.warn('[KraftedStorage] Auto-backup download failed:', e);
        }
      }).catch(function() {});
    }).catch(function(e) {
      console.warn('[KraftedStorage] Auto-backup failed:', e);
    });
  }

  // ── Manual export backup (JSON download) ───────────────────
  function exportBackup() {
    return getAllKeys().then(function(all) {
      var dump = {};
      all.forEach(function(entry) {
        if (entry.key === SCHEMA_KEY) return;
        dump[entry.key] = entry.value;
      });

      var now = new Date();
      var ts = now.getFullYear() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') + '_' +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0');
      var filename = 'Krafted_full_backup_' + ts + '.json';
      var blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function() {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
      return { filename: filename, keys: Object.keys(dump).length };
    });
  }

  // ── Quota check ────────────────────────────────────────────
  function checkQuota() {
    if (!navigator.storage || !navigator.storage.estimate) return;
    navigator.storage.estimate().then(function(est) {
      if (est.usage && est.quota) {
        var pct = (est.usage / est.quota) * 100;
        if (pct > 80) {
          console.warn('[KraftedStorage] Storage usage: ' + pct.toFixed(1) + '% (' +
            (est.usage / 1024 / 1024).toFixed(1) + 'MB / ' +
            (est.quota / 1024 / 1024).toFixed(1) + 'MB)');
          if (typeof window.toast === 'function') {
            window.toast('⚠️ 儲存空間使用 ' + pct.toFixed(0) + '% — 建議清理舊備份');
          }
        }
      }
    }).catch(function() {});
  }

  // ── Init: open DB, migrate, check quota ────────────────────
  function init() {
    return openDB().then(function() {
      return migrateFromLocalStorage();
    }).then(function(count) {
      if (count > 0) {
        console.log('[KraftedStorage] Init complete — migrated ' + count + ' keys');
      }
      // Schedule periodic quota checks
      checkQuota();
      setInterval(checkQuota, 600000); // every 10 min
    }).catch(function(err) {
      console.warn('[KraftedStorage] Init failed — using localStorage fallback:', err.message);
      dbError = true;
      if (typeof window.toast === 'function') {
        window.toast('⚠️ IndexedDB 不可用 — 使用 localStorage (5MB 限制)');
      }
    });
  }

  // ── Sync helper: call after every save ─────────────────────
  function onSaveComplete() {
    triggerAutoBackup();
    checkQuota();
  }

  // ── Expose global API ──────────────────────────────────────
  window.KraftedStorage = {
    getItem: getItem,
    getItemSync: getItemSync,
    setItem: setItem,
    removeItem: removeItem,
    getAllKeys: getAllKeys,
    getAllKeysSync: getAllKeysSync,
    exportBackup: exportBackup,
    onSaveComplete: onSaveComplete,
    init: init,
    isReady: function() { return dbReady && !dbError; },
    getDBError: function() { return dbError; }
  };

  // Auto-init on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { init(); });
  } else {
    init();
  }

  console.log('[KraftedStorage] Module loaded');
})();
