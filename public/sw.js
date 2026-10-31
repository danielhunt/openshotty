/* ============================================================
   Monster Hunt AR — offline support.
   HTML is always fresh when the network is there (so an update
   actually reaches the phone); icons and the built bundle are
   served from cache first and refreshed in the background.
   ============================================================ */

const VERSION = 'monsterhunt-v2';
const SHELL = ['./', './index.html', './assets/app.js', './assets/index.css', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-180.png', './favicon.svg', './favicon-32.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const revalidate = (fallback) =>
    fetch(req)
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy).catch(() => undefined));
        }
        return res;
      })
      .catch(() => fallback());

  // Pages: network first so an update is never trapped behind a cache.
  if (req.mode === 'navigate') {
    event.respondWith(revalidate(() => caches.match('./index.html').then((hit) => hit || caches.match('./'))));
    return;
  }

  // Icons never change, so serve them from the cache and refresh quietly.
  if (/\.(png|svg|webp|ico)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || revalidate(() => Promise.reject(new Error('offline')))),
    );
    return;
  }

  // Code and styles: network first, cache as the safety net. Their names are
  // unhashed on purpose (the precache list below refers to them by name), so a
  // stale copy is worse than one extra round trip — and when the network really
  // is missing, the cache still answers and the game opens from the garden.
  event.respondWith(revalidate(() => caches.match(req)));
});
