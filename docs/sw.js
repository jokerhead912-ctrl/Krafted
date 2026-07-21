// Krafted v6.1.18 Service Worker
// Standalone file (replaces the previous inline blob-URL approach which
// failed on GitHub Pages with "The URL protocol of the script ('blob:...')
// is not supported"). Browsers require SW scripts to be real same-origin
// file URLs, not blob: URLs, on secure origins.
//
// v6.1.18: Inject COOP/COEP headers on HTML responses to enable
// SharedArrayBuffer (needed by FFmpeg.wasm transcoder for .mov/ProRes files).
// GitHub Pages doesn't support custom headers, so the SW does it instead.

const CACHE_NAME = 'krafted-v6.1.18-' + Date.now();
const APP_VERSION = '6.1.18';

// Files to pre-cache on install
const PRE_CACHE = [
  './',
];

// ===== INSTALL: pre-cache core assets =====
self.addEventListener('install', function(event) {
  console.log('[Krafted SW] Install v' + APP_VERSION);
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(PRE_CACHE).catch(function(e) {
        console.warn('[Krafted SW] Pre-cache partial:', e);
      });
    })
  );
});

// ===== ACTIVATE: clean old caches =====
self.addEventListener('activate', function(event) {
  console.log('[Krafted SW] Activate v' + APP_VERSION);
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ===== FETCH: network-first with cache fallback =====
self.addEventListener('fetch', function(event) {
  // Skip non-GET requests and chrome-extension URLs
  if (event.request.method !== 'GET') return;
  const url = event.request.url;
  if (url.startsWith('chrome-extension://') || url.startsWith('blob:') || url.startsWith('data:')) return;

  // v6.1.18: Helper to inject COOP/COEP headers into HTML responses.
  // Required for SharedArrayBuffer (used by FFmpeg.wasm transcoder for
  // unsupported codecs like ProRes/DNxHR .mov files). GitHub Pages
  // doesn't support custom headers, so the SW does it instead.
  function addCrossOriginHeaders(response) {
    if (!response || response.status !== 200) return response;
    var ct = response.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return response;
    var newHeaders = new Headers(response.headers);
    newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
    newHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    });
  }

  // For CDN scripts (libgif, gif.js, gif.worker, ffmpeg.wasm): cache-first after first load
  if (url.includes('cdn.jsdelivr.net') || url.includes('unpkg.com')) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        return fetch(event.request).then(function(response) {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, clone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // For same-origin requests (the HTML, local JS): network-first + COOP/COEP inject
  event.respondWith(
    fetch(event.request).then(function(response) {
      if (response && response.status === 200) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, clone);
        });
      }
      return addCrossOriginHeaders(response);
    }).catch(function() {
      return caches.match(event.request).then(function(cached) {
        return addCrossOriginHeaders(cached);
      });
    })
  );
});

// ===== MESSAGE: handle version check requests =====
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'GET_VERSION') {
    // Only respond if the client sent a MessageChannel port
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ version: APP_VERSION });
    } else if (event.source) {
      // Fallback: reply directly to the source client
      try { event.source.postMessage({ type: 'GET_VERSION_REPLY', version: APP_VERSION }); } catch (_) {}
    }
  }
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
