// Offline cache aplikace. Při změně souborů zvýšit verzi.
const CACHE = 'prohlidky-v0.6.2';
const LIB = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/';
const FILES = ['./', 'index.html', 'app.js', 'slovnik.js', 'diktat.js', 'nastroje.js', 'style.css', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
// síť první (aktualizace), při výpadku cache
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.startsWith(LIB)) { // knihovna mapy: cache první
    e.respondWith(caches.match(e.request).then(m => m || fetch(e.request).then(r => {
      const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
    })));
    return;
  }
  if (new URL(e.request.url).origin !== location.origin) return;
  // no-cache: vždy ověřit u serveru (GitHub Pages jinak drží soubory 10 min v mezipaměti prohlížeče)
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
