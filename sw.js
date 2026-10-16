/* Expense Logger — service worker
   Shell assets: network-first (no-store) so releases never mix HTML/JS/CSS.
   Offline: fall back to the current release cache only.
   Install precache uses network no-store (not HTTP cache / addAll).
*/
const CACHE_VERSION = 'expense-logger-v1.6.0';
const ASSET_V = '1.6.0';
const SHELL_URLS = [
  './',
  './index.html',
  './styles.css?v=' + ASSET_V,
  './icon-animations.css?v=' + ASSET_V,
  './icon-system.js?v=' + ASSET_V,
  './forecast.js?v=' + ASSET_V,
  './app.js?v=' + ASSET_V,
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './icons/icons.json'
];

function isShellRequest(url) {
  if (url.origin !== self.location.origin) return false;
  const p = url.pathname;
  if (p === '/' || p.endsWith('/index.html')) return true;
  if (p.endsWith('/app.js') || p.endsWith('/forecast.js') || p.endsWith('/styles.css') || p.endsWith('/icon-animations.css')) return true;
  if (p.endsWith('/icon-system.js')) return true;
  if (p.includes('/icons/') && (p.endsWith('.svg') || p.endsWith('icons.json'))) return true;
  return p.endsWith('/manifest.json') || p.endsWith('/icon-192.png') || p.endsWith('/icon-512.png')
    || p.endsWith('/apple-touch-icon.png');
}

function cacheBustUrl(url) {
  const u = new URL(url, self.location.href);
  u.searchParams.set('__el_sw', CACHE_VERSION);
  return u.href;
}

function fetchNoStore(url) {
  return fetch(cacheBustUrl(url), { cache: 'no-store', credentials: 'same-origin' });
}

function putInCache(request, response) {
  if (!response || response.status !== 200 || response.type !== 'basic') return;
  return caches.open(CACHE_VERSION).then((cache) => cache.put(request, response));
}

function precacheUrl(cache, url) {
  return fetchNoStore(url).then((res) => {
    if (!res.ok) throw new Error('precache failed: ' + url);
    return cache.put(url, res);
  });
}

function precacheShell() {
  return fetchNoStore('./icons/icons.json')
    .then((res) => (res.ok ? res.json() : []))
    .catch(() => [])
    .then((iconIds) => {
      const iconUrls = Array.isArray(iconIds)
        ? iconIds.map((id) => './icons/' + id + '.svg')
        : [];
      const urls = SHELL_URLS.concat(iconUrls);
      return caches.open(CACHE_VERSION).then((cache) =>
        Promise.all(urls.map((url) => precacheUrl(cache, url)))
      );
    });
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
    )).then(() => self.clients.claim()).then(() =>
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        clients.forEach((client) => {
          try { client.postMessage({ type: 'SW_ACTIVATED', version: CACHE_VERSION }); } catch (e) {}
        });
      })
    )
  );
});

function networkFirstShell(request) {
  return fetchNoStore(request.url).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      putInCache(request, copy);
    }
    return res;
  }).catch(() =>
    caches.open(CACHE_VERSION).then((cache) =>
      cache.match(request).then((cached) => {
        if (cached) return cached;
        return cache.match('./index.html');
      })
    )
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate' || isShellRequest(url)) {
    event.respondWith(networkFirstShell(req));
    return;
  }

  event.respondWith(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            cache.put(req, copy);
          }
          return res;
        });
      })
    )
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
