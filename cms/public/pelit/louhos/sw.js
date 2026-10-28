// Louhos offline: the page is fetched from the network first (so updates arrive) and falls back
// to the cached copy; the icons and the manifest come from the cache.
const CACHE = "louhos-v1";
const BASE = "/pelit/louhos/";
const ASSETS = [BASE, BASE + "manifest.webmanifest", BASE + "icon-192.png", BASE + "icon-512.png", BASE + "icon-maskable-512.png", BASE + "apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("louhos-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === "navigate" && url.pathname.startsWith(BASE)) {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok && url.pathname === BASE) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(BASE, copy));
      }
      return res;
    }).catch(() => caches.match(BASE)));
    return;
  }
  if (ASSETS.includes(url.pathname)) {
    e.respondWith(caches.match(url.pathname).then((hit) => hit || fetch(req)));
  }
});
