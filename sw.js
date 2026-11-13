// App-shell cache, stale-while-revalidate.
// Bump VERSION on every deploy so clients pick up new files.
const VERSION = 'v8';
const CACHE = 'slem-drive-' + VERSION;

const SHELL = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './js/main.js',
  './js/geo.js',
  './js/limits.js',
  './js/spotify.js',
  './js/lyrics.js',
  './js/color.js',
  './js/settings.js',
  './js/demo.js',
  './js/weather.js',
  './js/wx-fx.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
    // Tell open windows a new version took over so they can reload once.
    // Without this the page keeps running the old scripts it already parsed,
    // which is how a half-updated app ends up broken.
    for (const c of await self.clients.matchAll({ type: 'window' })) {
      c.postMessage({ type: 'sw-activated', version: VERSION });
    }
  })());
});

// Network-first for the app's own files, cache only as an offline fallback.
//
// Cache-first was serving a stale index.html/app.css next to a fresh main.js
// after a deploy. A mixed set like that breaks the app outright — new script
// looking for markup that isn't there — so correctness beats the small
// startup cost. The files are a few KB and the phone is online while driving.
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request, { cache: 'no-store' });
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw new Error('offline and not cached: ' + request.url);
  }
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // only handle same-origin GETs (never touch API calls)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(networkFirst(e.request));
});
