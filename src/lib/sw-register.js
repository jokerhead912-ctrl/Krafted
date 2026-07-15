(function(){
  if (!('serviceWorker' in navigator)) return;
  // Service Worker registration strategy:
  // - GitHub Pages (HTTPS): use a real file URL (./sw.js) — browsers reject
  //   blob: URLs for SW registration on secure origins. We pre-build sw.js
  //   as a separate file and ship it alongside kraftpub.html.
  // - file:// (local open): the registry rejects same-origin file:// SW
  //   on most browsers, so we fall through and let the SW fail silently.
  // The previous blob-URL approach failed with "The URL protocol of the
  // script ('blob:...') is not supported" on GitHub Pages — this fixes it.
  const swUrl = './sw.js';

  navigator.serviceWorker.register(swUrl, { scope: './' })
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