(function(){
  if (!('serviceWorker' in navigator)) return;
  // Build the SW blob inline so it works from file:// or any origin
  const SW_CODE = `
const CACHE_NAME = 'krafted-v5.4-${Date.now()}';
const APP_VERSION = '5.4';

// Files to pre-cache on install
const PRE_CACHE = [
  './',
  // CDN libs cached on first use via fetch handler
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

  // For CDN scripts (libgif, gif.js, gif.worker): cache-first after first load
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

  // For same-origin requests (the HTML, local JS): network-first
  event.respondWith(
    fetch(event.request).then(function(response) {
      if (response && response.status === 200) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, clone);
        });
      }
      return response;
    }).catch(function() {
      return caches.match(event.request);
    })
  );
});

// ===== MESSAGE: handle version check requests =====
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: APP_VERSION });
  }
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
`;

  const blob = new Blob([SW_CODE], { type: 'application/javascript' });
  const swUrl = URL.createObjectURL(blob);

  navigator.serviceWorker.register(swUrl, { scope: '/' })
    .then(function(reg) {
      console.log('[Krafted SW] Registered, scope:', reg.scope);

      // Listen for updates
      reg.addEventListener('updatefound', function() {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', function() {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('[Krafted SW] Update available — will activate on next load');
            // Show update toast
            var toast = document.getElementById('toast');
            if (toast) {
              toast.textContent = 'Update ready! Reload to apply.';
              toast.classList.add('show');
              clearTimeout(toast._t);
              toast._t = setTimeout(function(){ toast.classList.remove('show'); }, 4000);
            }
          }
        });
      });
    })
    .catch(function(err) {
      console.warn('[Krafted SW] Registration failed:', err);
    });
})();