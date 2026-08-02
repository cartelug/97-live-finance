/* 97 LIVE service worker.
   Network-first for the app shell so new versions actually reach every device;
   stale-while-revalidate for static assets; cache is the offline fallback only.
   Cross-origin requests (Supabase and live rates) are never intercepted. */
const CACHE = "ns97-live-v2-premium-2";
const ASSETS = [
  "./",
  "./index.html",
  "./experience-v2.js?v=10",
  "./v2-premium.css?v=2",
  "./v2-premium.js?v=2",
  "./fonts/geist-sans.woff2",
  "./fonts/geist-mono.woff2",
  "./sync.js?v=19",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/favicon.svg",
  "./icons/mark-97.png",
  "./icons/brand/mtn.jpg",
  "./icons/brand/airtel.png",
  "./icons/brand/equity.png"
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .then((clients) => Promise.all(clients.map((client) => {
        if (!client.url || client.url.includes("reset.html")) return null;
        return client.navigate(client.url).catch(() => null);
      })))
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "skipWaiting") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  const isDoc =
    req.mode === "navigate" ||
    url.pathname.endsWith("/") ||
    url.pathname.endsWith("index.html");

  if (isDoc) {
    if (url.pathname.endsWith("reset.html")) return;
    const isShell = url.pathname.endsWith("/") || url.pathname.endsWith("index.html");
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (isShell) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("./index.html", copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match("./index.html")))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
