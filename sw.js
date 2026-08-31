const CACHE_NAME = "ncc-app-shell-20260831-1";
const APP_SHELL = [
  "/app.html",
  "/css/ncc-app.css?v=20260831-1",
  "/css/ncc-fonts.css?v=20260830-1",
  "/js/ncc-app.js?v=20260831-1",
  "/js/platform-config.js",
  "/js/benefit-catalog.js",
  "/images/NCC_OFFICIAL.png",
  "/images/NCC_HEADER.webp"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("ncc-app-shell-") && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate" && ["/app", "/app.html"].includes(url.pathname)) {
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put("/app.html", copy));
      return response;
    }).catch(() => caches.match("/app.html")));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (!response || response.status !== 200 || response.type !== "basic") return response;
    const copy = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
    return response;
  })));
});
