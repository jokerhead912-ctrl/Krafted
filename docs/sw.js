// Krafted v6.1.20 Service Worker
// Standalone file for PWA caching on GitHub Pages.

const CACHE_NAME = 'krafted-v6.6.2-' + Date.now();
const APP_VERSION = '6.6.2';

const PRE_CACHE = ['./'];

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

self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;
  const url = event.request.url;
  if (url.startsWith('chrome-extension://') || url.startsWith('blob:') || url.startsWith('data:')) return;

  if (url.includes('cdn.jsdelivr.net') || url.includes('unpkg.com')) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        return fetch(event.request).then(function(response) {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, clone); });
          }
          return response;
        });
      })
    );
    return;
  }

  event.respondWith(
    fetch(event.request).then(function(response) {
      if (response && response.status === 200) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, clone); });
      }
      return response;
    }).catch(function() {
      return caches.match(event.request);
    })
  );
});

self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'GET_VERSION') {
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ version: APP_VERSION });
    } else if (event.source) {
      try { event.source.postMessage({ type: 'GET_VERSION_REPLY', version: APP_VERSION }); } catch (_) {}
    }
  }
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
