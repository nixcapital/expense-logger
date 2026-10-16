/* ============================================================
   Expense Logger — service worker
   ============================================================ */
var CACHE_VERSION = 'expense-logger-v1.0.1';
var ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.addAll(ASSETS).catch(function () {
        // If an optional asset is missing, don't fail install
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE_VERSION) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Cache-first for app shell, network-first for everything else
  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) {
        // Refresh cache in background
        fetch(req).then(function (res) {
          if (res && res.ok) {
            caches.open(CACHE_VERSION).then(function (cache) { cache.put(req, res.clone()); });
          }
        }).catch(function () {});
        return cached;
      }
      return fetch(req).then(function (res) {
        if (res && res.ok && (res.type === 'basic' || res.type === 'default')) {
          var clone = res.clone();
          caches.open(CACHE_VERSION).then(function (cache) { cache.put(req, clone); });
        }
        return res;
      }).catch(function () {
        return caches.match('./index.html');
      });
    })
  );
});