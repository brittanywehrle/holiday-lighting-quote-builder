/* Offline support. Network first (so a deploy shows up on the next launch), falling back to the
   cached copy when the signal is weak or gone. Bump CACHE only if you need to force-clear old files. */
const CACHE = 'wehrle-quotes-v1';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest',
  'vendor/jspdf.umd.min.js', 'assets/sample-house.jpg',
  'fonts/noto-sans-latin-400-normal.woff2', 'fonts/noto-sans-latin-400-italic.woff2',
  'fonts/noto-sans-latin-600-normal.woff2', 'fonts/noto-sans-latin-700-normal.woff2',
  'fonts/noto-serif-latin-800-normal.woff2',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-48.png'
];
const TIMEOUT_MS = 4000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const network = fetch(req).then(res => {
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    });
    try {
      return await Promise.race([network, new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), TIMEOUT_MS))]);
    } catch (err) {
      network.catch(() => {});
      const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' && await cache.match('index.html'));
      if (hit) return hit;
      return network;
    }
  })());
});
