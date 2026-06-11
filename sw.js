// The Park Edit — Service Worker
// Generic across all client subfolders.
const CACHE = 'park-edit-v6';

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      // Pre-cache index.html using the SW's own scope so this works
      // generically for any client subfolder without hardcoding paths
      return cache.add(self.registration.scope + 'index.html');
    }).then(function() {
      return self.skipWaiting();
    })
  );
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
      // Cache-first for navigation: serves offline immediately
      caches.match(e.request).then(function(cached) {
        return cached || fetch(e.request).then(function(response) {
          return caches.open(CACHE).then(function(cache) {
            cache.put(e.request, response.clone());
            return response;
          });
        });
      }).catch(function() {
        // Last resort: try scope index.html from cache
        return caches.match(self.registration.scope + 'index.html');
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
