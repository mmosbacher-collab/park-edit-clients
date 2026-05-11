// The Park Edit — Service Worker
// Caches the app on first load for full offline use in the parks.

const CACHE = 'park-edit-v4';

const PRECACHE = [
  '/salamack/',
  '/salamack/index.html',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,700;1,9..144,400&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(PRECACHE);
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
  // Network-first for navigation, cache-first for assets
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(function() {
        return caches.match('/salamack/index.html');
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
