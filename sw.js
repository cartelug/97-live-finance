/* 97 LIVE service worker.
   Network-first for the app shell so new versions actually reach every device;
   stale-while-revalidate for static assets; cache is the offline fallback only.
   Cross-origin requests (Supabase, fonts, AI APIs) are never intercepted. */
const CACHE = "ns97-live-v19-type";
const ASSETS = ["./", "./index.html", "./sync.js?v=11", "./experience-v2.js", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/favicon.svg"];

const FAB_PATCH = `
;(function(){
  if(window.__X97_FAB_FIX__)return;
  window.__X97_FAB_FIX__=true;
  var scheduled=false;
  var style=document.createElement("style");
  style.id="x97-fab-viewport-style";
  style.textContent='body>.x97-fab.x97-fab-viewport{position:fixed!important;right:16px!important;bottom:calc(78px + env(safe-area-inset-bottom))!important;width:52px!important;height:52px!important;min-width:52px!important;min-height:52px!important;margin:0!important;z-index:58!important;display:grid!important;place-items:center!important;border-radius:50%!important;background:linear-gradient(180deg,#118653 0%,#0B6740 100%)!important;border:1px solid rgba(255,255,255,.24)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.22),0 10px 24px -9px rgba(11,103,64,.58),0 2px 6px rgba(23,27,18,.15)!important;transform:translateZ(0)!important;-webkit-transform:translateZ(0)!important;pointer-events:auto!important;visibility:visible!important;opacity:1!important;transition:transform .14s ease,box-shadow .18s ease,opacity .16s ease!important}body>.x97-fab.x97-fab-viewport:active{transform:translateZ(0) scale(.93)!important}body.x97-fab-sheet-open>.x97-fab.x97-fab-viewport{opacity:0!important;visibility:hidden!important;pointer-events:none!important}@media(min-width:1040px){body>.x97-fab.x97-fab-viewport{right:calc((100vw - 1000px)/2 + 18px)!important}}@media(max-width:420px){body>.x97-fab.x97-fab-viewport{right:14px!important;bottom:calc(76px + env(safe-area-inset-bottom))!important;width:50px!important;height:50px!important;min-width:50px!important;min-height:50px!important}}';
  document.head.appendChild(style);
  function managed(root){
    if(!root||!root.classList.contains("on"))return false;
    var title=root.querySelector(".x97-title");
    var text=title?String(title.textContent||"").trim().toLowerCase():"";
    return text==="upcoming"||text==="credit";
  }
  function sync(){
    scheduled=false;
    var root=document.getElementById("x97-v2-root");
    var fresh=root?root.querySelector(".x97-fab:not(.x97-fab-viewport)"):null;
    var mounted=document.querySelector("body>.x97-fab.x97-fab-viewport");
    var active=managed(root);
    if(fresh&&active){
      if(mounted&&mounted!==fresh)mounted.remove();
      fresh.classList.add("x97-fab-viewport");
      document.body.appendChild(fresh);
      mounted=fresh;
    }else if(mounted&&!active){
      mounted.remove();
    }
    document.body.classList.toggle("x97-fab-sheet-open",!!document.getElementById("x97-sheet"));
  }
  function schedule(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(sync);
  }
  new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:["class"]});
  window.addEventListener("pageshow",schedule);
  window.addEventListener("resize",schedule);
  window.addEventListener("orientationchange",schedule);
  document.addEventListener("visibilitychange",function(){if(!document.hidden)schedule()});
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",schedule,{once:true});else schedule();
})();
`;


const TYPE_PATCH = `
;(function(){
  if(window.__X97_TYPE_V3__)return;
  window.__X97_TYPE_V3__=true;

  if(!document.getElementById("x97-sora-font")){
    var pre=document.createElement("link");
    pre.rel="preconnect";
    pre.href="https://fonts.gstatic.com";
    pre.crossOrigin="anonymous";
    document.head.appendChild(pre);

    var font=document.createElement("link");
    font.id="x97-sora-font";
    font.rel="stylesheet";
    font.href="https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700;800&display=swap";
    document.head.appendChild(font);
  }

  if(document.getElementById("x97-type-v3"))return;
  var style=document.createElement("style");
  style.id="x97-type-v3";
  style.textContent=':root{--fu:\'Inter\',ui-sans-serif,system-ui,-apple-system,\'Segoe UI\',Roboto,Arial,sans-serif!important;--fd:\'Sora\',\'Inter\',ui-sans-serif,system-ui,-apple-system,\'Segoe UI\',Roboto,Arial,sans-serif!important}html{font-synthesis:none;text-rendering:optimizeLegibility}body,.app,input,select,button,textarea{font-family:var(--fu)!important}h1,h2,h3,h4,.x97-title,.x97-section-title,.x97-month-title,.x97-item-title,.x97-facility-title,.x97-loan h3,.x97-sheet-head h2{font-family:var(--fd)!important;font-synthesis:none}.x97-title{font-weight:700!important;letter-spacing:-.045em!important}.x97-section-title{font-weight:700!important;letter-spacing:.075em!important}.x97-month-title,.x97-item-title,.x97-facility-title,.x97-loan h3{font-weight:700!important;letter-spacing:-.025em!important}.x97-sheet-head h2{font-weight:700!important;letter-spacing:-.035em!important}.disp,.tabnum,.x97-money,.x97-hero-value,.x97-row-value,.x97-item-amount,.x97-loan-amount,.x97-facility-limit b,.x97-summary .v,.x97-stat b{font-family:var(--fu)!important;font-variant-numeric:tabular-nums lining-nums!important;font-feature-settings:\'tnum\' 1,\'lnum\' 1!important;font-synthesis:none}.disp,.x97-hero-value,.x97-money{letter-spacing:-.04em!important}.x97-row-value,.x97-item-amount,.x97-facility-limit b,.x97-stat b{letter-spacing:-.025em!important}.navitem,.x97-btn,.x97-icon-btn,.x97-chip,.x97-pill,.x97-mini,.x97-input,.x97-select,.x97-textarea,.x97-sub,.x97-row-sub,.x97-eyebrow,.x97-hero-label,.x97-summary .k,.x97-summary .s{font-family:var(--fu)!important}';
  document.head.appendChild(style);
})();
`;

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

  if (url.pathname.endsWith("/experience-v2.js")) {
    e.respondWith(
      fetch(req, { cache: "no-store" })
        .then(async (res) => {
          const text = await res.text();
          const headers = new Headers(res.headers);
          headers.delete("content-length");
          headers.set("content-type", "application/javascript; charset=utf-8");
          return new Response(text + FAB_PATCH + TYPE_PATCH, {
            status: res.status,
            statusText: res.statusText,
            headers
          });
        })
        .catch(() => caches.match(req))
    );
    return;
  }

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
