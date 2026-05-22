// The Park Edit — Service Worker
// Generic across all client subfolders.
const CACHE = 'park-edit-v6';

self.addEventListener('install', function(e) {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(e) {
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(function() {
        // Fall back to the same subfolder's index.html
        const url = new URL(e.request.url);
        const parts = url.pathname.split('/').filter(Boolean);
        const folder = parts.length > 0 ? '/' + parts[0] + '/' : '/';
        return caches.match(folder + 'index.html')
          .then(function(cached) {
            return cached || fetch(folder + 'index.html');
          });
      })
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        return cached || fetch(e.request).then(function(response) {
          return caches.open(CACHE).then(function(cache) {
            cache.put(e.request, response.clone());
            return response;
          });
        });
      }).catch(function() { return new Response('', { status: 408 }); })
    );
  }
});
