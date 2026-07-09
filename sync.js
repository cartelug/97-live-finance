/* 97 LIVE — Cloud Sync (optional, end-to-end encrypted) via a private GitHub Gist.
   Self-contained: talks only to the app's localStorage + the GitHub API. Your data is
   AES-GCM encrypted in the browser with a key derived from your Sync Code, so GitHub only
   ever stores ciphertext. No React internals are touched. GitHub never pauses like a free DB. */
(function () {
  "use strict";
  if (!window.crypto || !crypto.subtle) return; // needs a secure context (https/localhost)

  var ENGINE = "v10"; // shown in the panel so a stale device is instantly visible
  var DATA_KEY = "ns97-finance-v1";
  var K = { token:"ns97.sync.token", gist:"ns97.sync.gist", code:"ns97.sync.code", on:"ns97.sync.on", rev:"ns97.sync.rev" };
  var POLL_MS = 2000, DEBOUNCE_MS = 700; // safety-net polling; the live push channel is what makes it instant

  var enc = new TextEncoder(), dec = new TextDecoder();
  var _set = localStorage.setItem.bind(localStorage);
  function get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
  function put(k,v){ try { _set(k,v); } catch(e){} }
  function apiBase(){ return get("ns97.sync.api") || "https://api.github.com"; } // override is test-only
  function pushBase(){ return get("ns97.sync.push") || "https://ntfy.sh"; }     // live-push relay (override is test-only)

  // ---------- device identity ----------
  // Each device carries a friendly name so you can always tell which one is "the main",
  // and see which device made the most recent change (and when). Name is local to the device;
  // it rides along (URL-encoded) inside the encrypted-blob wrapper so other devices can show it.
  function defaultDevName(){
    var ua = navigator.userAgent || "";
    if (/iPhone/i.test(ua)) return "iPhone";
    if (/iPad/i.test(ua)) return "iPad";
    if (/Android/i.test(ua)) return "Android phone";
    if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
    if (/Windows/i.test(ua)) return "Windows PC";
    if (/CrOS/i.test(ua)) return "Chromebook";
    if (/Linux/i.test(ua)) return "Linux PC";
    return "This device";
  }
  function devName(){ var n = get("ns97.sync.dev"); n = n && n.trim(); return n ? n : defaultDevName(); }
  function encName(n){ try { return encodeURIComponent(n); } catch(e){ return ""; } }
  function decName(s){ try { return decodeURIComponent(s); } catch(e){ return String(s||""); } }
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function ago(ts){
    ts = Number(ts)||0; if(!ts) return "";
    var s = Math.max(0, Math.floor((Date.now()-ts)/1000));
    if(s<45) return "just now";
    if(s<90) return "a minute ago";
    var m = Math.round(s/60); if(m<60) return m+" min ago";
    var h = Math.round(m/60); if(h<24) return h+(h===1?" hour ago":" hours ago");
    var d = Math.round(h/24); if(d<7) return d+(d===1?" day ago":" days ago");
    try { return new Date(ts).toLocaleDateString(); } catch(e){ return ""; }
  }

  // ---------- crypto ----------
  function b64(buf){ var b=new Uint8Array(buf),s="",i; for(i=0;i<b.length;i++) s+=String.fromCharCode(b[i]); return btoa(s); }
  function unb64(str){ var s=atob(str),b=new Uint8Array(s.length),i; for(i=0;i<s.length;i++) b[i]=s.charCodeAt(i); return b; }
  function sha256hex(str){ return crypto.subtle.digest("SHA-256", enc.encode(str)).then(function(h){
    var b=new Uint8Array(h),s="",i; for(i=0;i<b.length;i++) s+=b[i].toString(16).padStart(2,"0"); return s; }); }
  var _keyCache = {};
  function deriveKey(code){
    if (_keyCache[code]) return _keyCache[code]; // PBKDF2@120k is ~100ms — derive once, reuse for every poll
    _keyCache[code] = crypto.subtle.importKey("raw", enc.encode(code), "PBKDF2", false, ["deriveKey"]).then(function(base){
      return crypto.subtle.deriveKey({name:"PBKDF2", salt:enc.encode("ns97-sync-v1"), iterations:120000, hash:"SHA-256"},
        base, {name:"AES-GCM", length:256}, false, ["encrypt","decrypt"]); });
    return _keyCache[code]; }
  function encryptData(code, plaintext){
    return deriveKey(code).then(function(key){
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return crypto.subtle.encrypt({name:"AES-GCM", iv:iv}, key, enc.encode(plaintext)).then(function(ct){
        var out = new Uint8Array(iv.length + ct.byteLength); out.set(iv,0); out.set(new Uint8Array(ct), iv.length);
        return "v1:" + b64(out); }); }); }
  function decryptData(code, blob){
    if (String(blob).slice(0,3) !== "v1:") return Promise.reject(new Error("bad-format"));
    var raw = unb64(blob.slice(3)), iv = raw.slice(0,12), ct = raw.slice(12);
    return deriveKey(code).then(function(key){
      return crypto.subtle.decrypt({name:"AES-GCM", iv:iv}, key, ct); }).then(function(pt){ return dec.decode(pt); }); }

  // ---------- config ----------
  function cfg(){ return { token:get(K.token), gist:get(K.gist), code:get(K.code) }; }
  function enabled(){ var c=cfg(); return get(K.on)==="1" && c.token && c.code; }
  // strip anything a copy-paste might slip in — GitHub tokens are [A-Za-z0-9_], never smart chars
  function cleanTok(t){ return String(t==null?"":t).replace(/[^A-Za-z0-9._-]/g,""); }
  function fname(code){ return sha256hex("ns97|"+code).then(function(h){ return "ns97-"+h.slice(0,32)+".json"; }); }
  function ghHeaders(){ return { Authorization:"Bearer "+cleanTok(cfg().token), Accept:"application/vnd.github+json",
    "Content-Type":"application/json", "X-GitHub-Api-Version":"2022-11-28" }; }
  function ok(op){ return function(r){ if(!r.ok) return r.text().then(function(t){ throw new Error(op+" "+r.status+(t?": "+t.slice(0,140):"")); }); return Promise.resolve(r); }; }
  // A real snapshot the app can render must be an object with meta.appName + the core arrays.
  // Guarding on this prevents pushing/applying an empty or partial blob (which crashes the app to a blank page).
  function looksValidData(str){
    if(str==null) return false;
    var o; try{ o=JSON.parse(str); }catch(e){ return false; }
    if(!o || typeof o!=="object" || Array.isArray(o)) return false;
    if(!o.meta || typeof o.meta!=="object" || typeof o.meta.appName==="undefined") return false;
    return Array.isArray(o.followups) && Array.isArray(o.balances) && Array.isArray(o.credit);
  }

  // ---------- GitHub Gist REST ----------
  // no-store: NEVER let the browser answer an API call from its own HTTP cache. GitHub sends
  // "Cache-Control: max-age=60" on gist reads, and some browsers (Safari especially) will happily
  // serve a poll from that stale cache for a minute — which looks exactly like "sync stopped".
  function ghFetch(url, opts){ opts = opts || {}; opts.cache = "no-store"; return fetch(url, opts); }
  function findGist(fn){
    return ghFetch(apiBase()+"/gists?per_page=100", {headers:ghHeaders()}).then(ok("LIST")).then(function(r){ return r.json(); })
      .then(function(list){ for(var i=0;i<list.length;i++){ if(list[i].files && list[i].files[fn]){ put(K.gist, list[i].id); return list[i]; } } return null; });
  }
  // Pull the wrapper apart into {rev, blob, by} (or null if it isn't a usable snapshot).
  function parseGist(g, fn){
    if(!g || !g.files || !g.files[fn]) return null;
    var content = g.files[fn].content || "";
    var i = content.indexOf("\n");
    if(i<0) return null;
    var rev = Number(content.slice(0,i))||0;
    var rest = content.slice(i+1), by = "";
    // New wrapper: "rev\n<url-encoded device name>\n<ciphertext>". Old wrapper had no name line.
    // The ciphertext always starts "v1:", so if the next line isn't ciphertext it's the device name.
    if (rest.slice(0,3) !== "v1:"){
      var j = rest.indexOf("\n");
      if(j<0) return null;
      by = decName(rest.slice(0,j)); rest = rest.slice(j+1);
    }
    put("ns97.sync.lastat", String(rev));
    put("ns97.sync.lastby", by);
    if (rev > (Number(get("ns97.sync.maxrev"))||0)) put("ns97.sync.maxrev", String(rev)); // high-water mark for monotonic revs
    return { rev: rev, blob: rest, by: by };
  }
  // returns {rev, blob, by} on a change, {__nm:true} when the cloud is unchanged, or null.
  // Uses a conditional request (If-None-Match): a 304 "not modified" costs nothing against the
  // GitHub rate limit, so many devices can poll every couple seconds on one shared link.
  function remoteGet(depth){
    var code = cfg().code;
    return fname(code).then(function(fn){
      var gid = get(K.gist);
      // No gist id yet → find it in the list. The LIST endpoint returns file metadata WITHOUT
      // content, so after finding it we must re-read the single gist to actually get the data —
      // otherwise a fresh device thinks the cloud is empty and overwrites it.
      if (!gid) return findGist(fn).then(function(g){ return (g && !depth) ? remoteGet(1) : null; });
      var h = ghHeaders(), et = get("ns97.sync.etag");
      if (et) h["If-None-Match"] = et;
      return ghFetch(apiBase()+"/gists/"+gid, {headers:h}).then(function(r){
        if (r.status===304) return {__nm:true};                       // unchanged — free (no rate-limit cost)
        if (r.status===404){ put(K.gist,""); put("ns97.sync.etag",""); return findGist(fn).then(function(g){ return parseGist(g, fn); }); }
        return ok("GET")(r).then(function(x){
          var tag = x.headers.get("ETag"); if (tag) put("ns97.sync.etag", tag);
          return x.json().then(function(g){ return parseGist(g, fn); });
        });
      });
    });
  }
  function remotePut(blob, rev){
    return fname(cfg().code).then(function(fn){
      var files={}; files[fn]={ content: rev + "\n" + encName(devName()) + "\n" + blob };
      function keepTag(r){ var t=r.headers.get("ETag"); if(t) put("ns97.sync.etag", t); return r; }
      function create(){ return ghFetch(apiBase()+"/gists", {method:"POST", headers:ghHeaders(),
          body:JSON.stringify({description:"97 LIVE — encrypted finance sync (safe to keep private)", public:false, files:files})})
          .then(ok("CREATE")).then(keepTag).then(function(r){ return r.json(); }).then(function(g){ put(K.gist, g.id); }); }
      function patch(gid){ return ghFetch(apiBase()+"/gists/"+gid, {method:"PATCH", headers:ghHeaders(), body:JSON.stringify({files:files})})
          .then(function(r){ if(r.status===404){ put(K.gist,""); put("ns97.sync.etag",""); return create(); } return ok("PATCH")(r).then(keepTag); }); }
      var gid = get(K.gist);
      if(gid) return patch(gid);
      return findGist(fn).then(function(g){ return g ? patch(g.id) : create(); });
    });
  }

  // ---------- engine ----------
  var lastUploadedRev = 0, applying = false, uploadTimer = null, pendingReload = false, status = "off", corrupted = false, dirty = false;
  function setStatus(s){ status = s; renderLauncher(); renderPanel(); }

  // Short fingerprint of (gist id + code): if two devices show different sheet numbers they are
  // NOT on the same sheet — the single most common silent reason "my edit never showed up there".
  var _sheetTag = "";
  function sheetTag(){ var gid=get(K.gist)||"", c=cfg().code||"";
    if (!gid && !c) { _sheetTag=""; return Promise.resolve(""); }
    return sha256hex("tag|"+gid+"|"+c).then(function(h){ _sheetTag = h.slice(0,4).toUpperCase(); return _sheetTag; }); }

  // Ordering must NOT depend on device clocks — a phone whose clock trails the PC's would
  // otherwise stamp "older" revisions the PC rejects (one-way sync). So each new revision is
  // max(now, every rev we've seen) + 1: normally a real timestamp (good for "X min ago"),
  // but always strictly greater than the latest cloud revision, so last-write-wins is symmetric.
  function nextRev(cloudRev){
    var floor = Math.max(Number(cloudRev)||0, Number(get("ns97.sync.maxrev"))||0, Number(get(K.rev))||0, lastUploadedRev||0);
    var r = Date.now();
    if (r <= floor) r = floor + 1;
    put("ns97.sync.maxrev", String(r));
    return r;
  }

  function pushLocal(){
    if (!enabled() || applying) return Promise.resolve();
    var c = cfg(), plain = get(DATA_KEY);
    if (!looksValidData(plain)) return Promise.resolve(); // never upload an empty/partial snapshot
    setStatus("syncing");
    // Read the cloud's current revision first, then write strictly above it — clock-proof ordering.
    return remoteGet().then(function(row){
      // {__nm} = cloud unchanged since our last read → the current cloud rev is our high-water mark.
      var cloudRev = (row && !row.__nm && row.rev != null) ? (Number(row.rev)||0) : (Number(get("ns97.sync.maxrev"))||0);
      var rev = nextRev(cloudRev);
      return encryptData(c.code, plain).then(function(blob){
        return remotePut(blob, rev).then(function(){ lastUploadedRev = rev; put(K.rev, String(rev));
          put("ns97.sync.lastat", String(rev)); put("ns97.sync.lastby", devName()); dirty = false; setStatus("ok");
          liveSend("upd"); }); // tell every open device to fetch right now
      });
    }).catch(function(){ setStatus("err"); });
  }
  function schedulePush(){ if(!enabled()) return; clearTimeout(uploadTimer); uploadTimer = setTimeout(pushLocal, DEBOUNCE_MS); }

  function idle(){
    if (document.querySelector(".backdrop")) return false;
    if (document.getElementById("s97-modal")) return false;
    var a = document.activeElement;
    if (a && (a.tagName==="INPUT" || a.tagName==="TEXTAREA" || a.isContentEditable)) return false;
    return true;
  }
  function applyRemote(plain, rev){
    var cur = get(DATA_KEY); if (looksValidData(cur)) put("ns97.sync.backup", cur); // keep a rollback copy
    applying = true; put(DATA_KEY, plain); put(K.rev, String(rev)); applying = false;
    put("ns97.sync.justpulled", get("ns97.sync.lastby") || "another device"); // toast after the reload
    setStatus("pulled");
    if (idle()) location.reload(); else pendingReload = true;
  }
  function pull(){
    if (!enabled() || applying) return Promise.resolve();
    return remoteGet().then(function(row){
      if (!row || row.__nm) return; // nothing new (a free 304)
      var rev = Number(row.rev)||0, appliedRev = Number(get(K.rev))||0;
      if (rev === lastUploadedRev) { put(K.rev, String(Math.max(rev, appliedRev))); return; } // our own write
      // CONTENT decides, not the counter. Reaching here means the cloud file actually changed
      // (the ETag moved). If a device running an old app version — or writing through a stale
      // browser cache — stamped it with a LOWER rev than ours, skipping it by rev comparison is
      // exactly how "phone updated but the PC never saw it" happens. So: decrypt, compare, apply.
      return decryptData(cfg().code, row.blob).then(function(plain){
        if (!looksValidData(plain)) return; // incomplete cloud copy — don't touch this device
        if (plain === get(DATA_KEY)) { put(K.rev, String(Math.max(rev, appliedRev))); return; }
        applyRemote(plain, Math.max(rev, appliedRev + 1));
      });
    }).catch(function(){ setStatus("err"); });
  }

  localStorage.setItem = function(k, v){ _set(k, v); if (k===DATA_KEY && !applying){ dirty = true; schedulePush(); } };

  // Phones freeze background apps, so a debounced push can be killed before it fires. On every
  // way the app can come back to life, flush a pending edit FIRST (so it wins), then pull.
  function wake(){
    if (pendingReload && idle()) { pendingReload = false; location.reload(); return; }
    if (!enabled() || !navigator.onLine) return;
    put("ns97.sync.etag", ""); // the moment you look at the app, do one FULL fresh read — never a cached answer
    liveConnect(); liveSend("hi");
    if (dirty) pushLocal().then(pull); else pull();
  }
  setInterval(function(){ if (enabled() && navigator.onLine){ if (dirty) pushLocal(); else pull(); } }, POLL_MS);
  window.addEventListener("online", wake);
  window.addEventListener("focus", wake);
  window.addEventListener("pageshow", wake);
  document.addEventListener("visibilitychange", function(){ if (document.visibilityState === "visible") wake(); });

  // ---------- LIVE layer: instant push + presence (like watching a Google Sheet) ----------
  // A tiny pub/sub relay (ntfy.sh) carries only signals — {kind, device, time}. Never any data.
  // When a device saves, it broadcasts "upd"; everyone else pulls the gist immediately (~1s
  // end-to-end) instead of waiting for the next poll. While you type, "edit" heartbeats let other
  // devices show "✍️ iPhone is editing…". If the relay is unreachable, nothing breaks — the 2s
  // polling above is the guaranteed floor; the relay is pure acceleration.
  var liveES = null, liveRetry = 1500, liveUp = false, peers = {}; // name -> {at, editing}
  var _dbg = {msgs:0, open:0, err:0, sent:0};
  try { window.__s97 = function(){ return {up:liveUp, dbg:_dbg, peers:JSON.parse(JSON.stringify(peers))}; }; } catch(e){}
  function topicFor(code){ return sha256hex("ns97live|"+code).then(function(h){ return "ns97-"+h.slice(0,30); }); }
  function liveSend(kind){
    if (!enabled()) return;
    topicFor(cfg().code).then(function(t){
      try { _dbg.sent++; fetch(pushBase()+"/"+t, {method:"POST", cache:"no-store",
        body: JSON.stringify({k:kind, by:devName(), at:Date.now()})}).catch(function(){}); } catch(e){}
    });
  }
  function liveConnect(){
    if (!enabled() || liveES || typeof EventSource === "undefined") return;
    topicFor(cfg().code).then(function(t){
      if (liveES || !enabled()) return;
      try {
        var es = new EventSource(pushBase()+"/"+t+"/sse");
        liveES = es;
        es.onopen = function(){ liveUp = true; liveRetry = 1500; _dbg.open++; renderPanel(); };
        es.onerror = function(){ liveUp = false; _dbg.err++; try{es.close();}catch(e){} if (liveES===es) liveES=null;
          setTimeout(liveConnect, liveRetry); liveRetry = Math.min(liveRetry*2, 30000); renderPanel(); };
        es.onmessage = function(ev){
          _dbg.msgs++;
          try {
            var o = JSON.parse(ev.data); if (!o || !o.message) return;
            var m = JSON.parse(o.message); if (!m || !m.by || m.by === devName()) return;
            peers[m.by] = { at: Date.now(), editing: m.k === "edit" };
            renderLive();
            if (m.k === "upd") { put("ns97.sync.etag",""); pull(); } // someone saved → fetch NOW
          } catch(e){}
        };
      } catch(e){ liveES = null; }
    });
  }
  function liveNames(fresh){ var out=[], now=Date.now(), n;
    for (n in peers){ if (now - peers[n].at < (fresh||45000)) out.push(n); } return out; }
  // "X is editing…" heartbeats while an app input has focus
  var editBeat = null;
  document.addEventListener("focusin", function(e){
    var t = e.target; if (!t || !enabled()) return;
    if (t.tagName!=="INPUT" && t.tagName!=="TEXTAREA" && !t.isContentEditable) return;
    if (t.className && String(t.className).indexOf("s97-")===0) return; // not our own panel fields
    liveSend("edit"); clearInterval(editBeat); editBeat = setInterval(function(){ liveSend("edit"); }, 2500);
  });
  document.addEventListener("focusout", function(){ clearInterval(editBeat); editBeat=null; if (enabled()) liveSend("hi"); });
  // floating presence pill (shows even when the panel is closed)
  var liveEl = null;
  function renderLive(){
    css();
    var now = Date.now(), msg = "", n;
    for (n in peers){ if (peers[n].editing && now - peers[n].at < 9000){ msg = "✍️ " + esc(n) + " is editing…"; break; } }
    if (!msg){ for (n in peers){ if (now - peers[n].at < 6000 && n){ msg = "⚡ " + esc(n) + " is online"; break; } } }
    if (!liveEl){ liveEl = document.createElement("div"); liveEl.className = "s97-livepill"; document.body.appendChild(liveEl); }
    liveEl.innerHTML = msg; liveEl.style.display = msg ? "block" : "none";
  }
  setInterval(renderLive, 3000);
  // after a pulled update reloads the page, confirm visibly where it came from
  function pulledToast(){
    var by = get("ns97.sync.justpulled"); if (!by) return;
    put("ns97.sync.justpulled", "");
    css(); var d = document.createElement("div"); d.className = "s97-toastpill";
    d.textContent = "✓ Updated from " + by; document.body.appendChild(d);
    setTimeout(function(){ d.style.opacity = "0"; }, 2600); setTimeout(function(){ d.remove(); }, 3400);
  }

  // ---------- connect / disconnect ----------
  function connect(token, code, gistId, direction){
    put(K.token, cleanTok(token)); put(K.code, code); if(gistId) put(K.gist, gistId); put(K.on, "1");
    put("ns97.sync.etag", ""); // force a full (non-conditional) read on connect
    setStatus("syncing");
    return remoteGet().then(function(row){
      if (row && !row.__nm && direction !== "push") {
        return decryptData(code, row.blob).then(function(plain){
          if (!looksValidData(plain)) throw new Error("the cloud copy looks incomplete — not loading it onto this device");
          var cur = get(DATA_KEY); if (looksValidData(cur)) put("ns97.sync.backup", cur);
          applying = true; put(DATA_KEY, plain); put(K.rev, String(Number(row.rev)||0)); applying = false;
          setStatus("ok"); location.reload();
        });
      }
      var plain = get(DATA_KEY);
      if (!looksValidData(plain)) throw new Error("this device has no complete data to upload yet — open the app first");
      return encryptData(code, plain).then(function(blob){
        var rev = nextRev(row && !row.__nm && row.rev != null ? (Number(row.rev)||0) : 0);
        return remotePut(blob, rev).then(function(){ lastUploadedRev = rev; put(K.rev, String(rev));
          put("ns97.sync.lastat", String(rev)); put("ns97.sync.lastby", devName()); dirty = false; setStatus("ok");
          liveConnect(); liveSend("upd"); });
      });
    }).catch(function(e){ setStatus("err"); throw e; });
  }
  function disconnect(){ put(K.on, "0"); setStatus("off"); if (liveES){ try{liveES.close();}catch(e){} liveES=null; liveUp=false; } }

  function makeLink(){ var c=cfg(); return "ns97sync:" + b64(enc.encode(JSON.stringify({t:c.token, g:get(K.gist)||"", c:c.code}))); }
  function parseLink(s){ s=String(s).trim(); if(s.indexOf("ns97sync:")!==0) throw new Error("not a link");
    var o=JSON.parse(dec.decode(unb64(s.slice(9)))); if(!o.t||!o.c) throw new Error("bad link"); return o; }
  function randomCode(){ var a=new Uint8Array(9); crypto.getRandomValues(a);
    return "97-" + b64(a).replace(/[^a-zA-Z0-9]/g,"").slice(0,12).toLowerCase(); }

  // ---------- UI (appended to <body>, outside #root) ----------
  function css(){
    if (document.getElementById("s97-css")) return;
    var s = document.createElement("style"); s.id = "s97-css";
    s.textContent = [
      ".s97-fab{position:fixed;z-index:56;left:max(16px,calc(50% - 244px));bottom:calc(80px + env(safe-area-inset-bottom));width:46px;height:46px;border-radius:50%;background:var(--card2,#212717);border:1px solid var(--line2,rgba(228,238,205,.18));color:var(--tx2,#B7BCA6);display:grid;place-items:center;box-shadow:0 8px 20px -10px rgba(0,0,0,.7);cursor:pointer;transition:transform .12s}",
      ".s97-fab:active{transform:scale(.92)}",
      ".s97-dot{position:absolute;top:-2px;right:-2px;width:12px;height:12px;border-radius:50%;border:2px solid var(--bg,#0A0D07);background:var(--tx3,#8B917B)}",
      ".s97-dot.ok{background:var(--pos,#62DBA2)}.s97-dot.syncing{background:var(--warn,#EFBE58)}.s97-dot.err{background:var(--neg,#F4726B)}",
      ".s97-back{position:fixed;inset:0;z-index:70;background:rgba(5,7,4,.7);backdrop-filter:blur(4px);display:flex;align-items:flex-end;justify-content:center}",
      "@media(min-width:560px){.s97-back{align-items:center;padding:16px}}",
      ".s97-modal{width:100%;max-width:520px;max-height:92vh;overflow:auto;background:var(--bg2,#0F1309);border:1px solid var(--line,rgba(228,238,205,.11));border-top-color:var(--line2);border-radius:26px 26px 0 0;box-shadow:0 -24px 60px rgba(0,0,0,.6);padding:18px 18px calc(20px + env(safe-area-inset-bottom));font-family:var(--fu,system-ui);color:var(--tx,#F3F3E9)}",
      "@media(min-width:560px){.s97-modal{border-radius:26px}}",
      ".s97-modal h3{font-family:var(--fd,serif);font-weight:600;font-size:19px;margin:2px 0 2px}",
      ".s97-modal p{color:var(--tx2,#B7BCA6);font-size:13px;line-height:1.5;margin:6px 0}",
      ".s97-modal label{display:block;font-size:12px;font-weight:700;color:var(--tx2);margin:12px 0 5px}",
      ".s97-inp{width:100%;background:var(--bg,#0A0D07);border:1px solid var(--line2);border-radius:11px;padding:11px 12px;color:var(--tx);font-size:13.5px;outline:none;box-shadow:inset 0 1px 2px rgba(0,0,0,.35)}",
      ".s97-inp:focus{border-color:var(--pos)}",
      ".s97-row{display:flex;gap:9px;margin-top:14px;flex-wrap:wrap}",
      ".s97-btn{flex:1;min-width:120px;min-height:44px;border-radius:12px;border:1px solid transparent;font-weight:700;font-size:13.5px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:7px}",
      ".s97-btn.p{background:linear-gradient(180deg,var(--pos,#62DBA2),var(--pos2,#2FA774));color:#0B1710;box-shadow:inset 0 1px 0 rgba(255,255,255,.28)}",
      ".s97-btn.g{background:transparent;color:var(--tx);border-color:var(--line2)}",
      ".s97-btn.d{background:rgba(244,114,107,.08);color:var(--neg,#F4726B);border-color:rgba(244,114,107,.42)}",
      ".s97-status{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--tx2);margin-top:4px}",
      ".s97-pill{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--tx3)}",
      ".s97-pill.ok{background:var(--pos)}.s97-pill.syncing{background:var(--warn)}.s97-pill.err{background:var(--neg)}",
      ".s97-help{font-size:12.5px;color:var(--tx3,#8B917B);line-height:1.55;margin-top:10px;border-top:1px solid var(--line);padding-top:10px}",
      ".s97-help a,.s97-link{color:var(--usd,#35C6D4);cursor:pointer;text-decoration:underline}",
      ".s97-x{float:right;width:32px;height:32px;border-radius:50%;background:var(--card2);border:1px solid var(--line);color:var(--tx2);cursor:pointer;font-size:16px}",
      ".s97-dev{display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--card2,#212717);border:1px solid var(--line,rgba(228,238,205,.11));border-radius:14px;padding:11px 13px;margin-top:12px}",
      ".s97-dev-lbl{font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--tx3,#8B917B)}",
      ".s97-dev-name{font-family:var(--fd,serif);font-size:17px;font-weight:600;color:var(--tx,#F3F3E9);margin-top:2px;display:flex;align-items:center;gap:7px}",
      ".s97-here{font-family:var(--fu,system-ui);font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--pos2,#2FA774);background:rgba(98,219,162,.13);border:1px solid rgba(98,219,162,.34);border-radius:999px;padding:2px 8px}",
      ".s97-ren{flex:none;background:transparent;border:1px solid var(--line2,rgba(228,238,205,.18));color:var(--tx2,#B7BCA6);border-radius:10px;padding:8px 12px;font-size:12.5px;font-weight:700;cursor:pointer}",
      ".s97-ren:active{transform:scale(.96)}",
      ".s97-last{font-size:12.5px;color:var(--tx2,#B7BCA6);margin:9px 2px 2px;display:flex;align-items:center;gap:7px}",
      ".s97-last b{color:var(--tx,#F3F3E9);font-weight:700}",
      ".s97-last .s97-pill{width:7px;height:7px}",
      ".s97-meta{margin-top:14px;padding:9px 12px;border-radius:11px;background:var(--bg,#0A0D07);border:1px dashed var(--line2,rgba(228,238,205,.18));font-size:11.5px;color:var(--tx3,#8B917B);letter-spacing:.01em}",
      ".s97-meta b{color:var(--usd,#35C6D4);font-weight:800;letter-spacing:.08em}",
      ".s97-livepill{position:fixed;z-index:57;left:50%;transform:translateX(-50%);bottom:calc(136px + env(safe-area-inset-bottom));background:rgba(15,19,9,.92);backdrop-filter:blur(8px);border:1px solid var(--line2,rgba(228,238,205,.18));color:var(--tx,#F3F3E9);font-family:var(--fu,system-ui);font-size:12.5px;font-weight:700;padding:8px 14px;border-radius:999px;box-shadow:0 10px 30px -10px rgba(0,0,0,.8);display:none;pointer-events:none;animation:s97fade .25s ease}",
      ".s97-toastpill{position:fixed;z-index:58;left:50%;transform:translateX(-50%);top:calc(14px + env(safe-area-inset-top));background:linear-gradient(180deg,var(--pos,#62DBA2),var(--pos2,#2FA774));color:#0B1710;font-family:var(--fu,system-ui);font-size:13px;font-weight:800;padding:9px 16px;border-radius:999px;box-shadow:0 12px 32px -8px rgba(47,167,116,.55);transition:opacity .7s;animation:s97fade .3s ease}",
      "@keyframes s97fade{from{opacity:0;transform:translateX(-50%) translateY(6px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}"
    ].join("\n");
    document.head.appendChild(s);
  }

  var launcher = null;
  function renderLauncher(){
    css();
    if (!launcher){
      launcher = document.createElement("button");
      launcher.className = "s97-fab"; launcher.title = "Cloud Sync"; launcher.setAttribute("aria-label","Cloud Sync");
      launcher.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg><span class="s97-dot"></span>';
      launcher.addEventListener("click", openPanel);
      document.body.appendChild(launcher);
    }
    launcher.querySelector(".s97-dot").className = "s97-dot" + (enabled() ? (" " + (status==="off"?"ok":status)) : "");
  }

  function statusText(){
    if (!enabled()) return "Not connected";
    if (status==="syncing") return "Syncing…";
    if (status==="err") return "Sync error — will retry";
    if (status==="pulled") return "Updated from another device";
    return "Connected · auto-syncing";
  }

  function renderPanel(){
    var m = document.getElementById("s97-modal"); if (!m) return;
    var body = m.querySelector(".s97-body"); if (!body) return;
    if (corrupted){
      var hasBackup = looksValidData(get("ns97.sync.backup"));
      body.innerHTML = '<button class="s97-x" aria-label="Close">✕</button><h3>Recover this device</h3>'
        + '<div class="s97-status"><span class="s97-pill err"></span>This device’s saved data is incomplete, so the app can’t open.</div>'
        + '<p>Pick the option that has your real numbers:</p>'
        + (hasBackup ? '<div class="s97-row"><button class="s97-btn p" data-a="rb">Restore last good data on this device</button></div>' : '')
        + (enabled() ? '<div class="s97-row"><button class="s97-btn g" data-a="rc">Load the copy from the cloud</button></div>' : '')
        + '<div class="s97-row"><button class="s97-btn d" data-a="reset">Reset to the starting sheet</button></div>'
        + '<div class="s97-help">If your numbers are safe on another device, use the cloud/backup option. Only choose “Reset” if nothing else has your data.</div>';
      return;
    }
    var on = enabled();
    var head = '<button class="s97-x" aria-label="Close">✕</button><h3>Cloud Sync</h3>'
      + '<div class="s97-status"><span class="s97-pill '+(on?(status==="off"?"ok":status):"")+'"></span>'+statusText()+'</div>';
    var frag;
    if (on){
      var here = devName();
      var by = get("ns97.sync.lastby"), at = get("ns97.sync.lastat");
      var mine = by && by === here;
      var lastLine = at
        ? ('Last change: <b>' + (by ? (mine ? "this device" : esc(by)) : "another device") + '</b>'
            + (ago(at) ? ' · ' + esc(ago(at)) : ''))
        : 'No cloud changes recorded yet — make an edit to start the history.';
      var online = liveNames(45000);
      frag = '<div class="s97-dev"><div><div class="s97-dev-lbl">You’re on</div>'
        + '<div class="s97-dev-name">' + esc(here) + '<span class="s97-here">This device</span></div></div>'
        + '<button class="s97-ren" data-a="rename">Rename</button></div>'
        + '<div class="s97-last"><span class="s97-pill '+(mine?"ok":"")+'"></span>' + lastLine + '</div>'
        + '<div class="s97-last"><span class="s97-pill '+(liveUp?"ok":"syncing")+'"></span>'
        +   (liveUp ? 'Live channel <b>connected</b> — edits land instantly' : 'Live channel connecting… (safety check every 2s meanwhile)')
        + '</div>'
        + (online.length ? '<div class="s97-last"><span class="s97-pill ok"></span>Online now: <b>'+online.map(esc).join(', ')+'</b></div>' : '')
        + '<p>Every change here appears on all linked devices in about a second — and back. Your numbers are encrypted before they leave the device.</p>'
        + '<div class="s97-row"><button class="s97-btn p" data-a="copylink">Copy share link</button>'
        + '<button class="s97-btn g" data-a="selftest">Test connection</button></div>'
        + '<div class="s97-row"><button class="s97-btn g" data-a="now">Sync now</button>'
        + '<button class="s97-btn d" data-a="disconnect">Disconnect</button></div>'
        + '<div class="s97-meta">Sheet <b>#'+esc(_sheetTag||'····')+'</b> · engine '+ENGINE
        +   ' — every linked device must show the SAME sheet number. Different number = it’s on a different sheet: re-join it with the share link.</div>'
        + '<div class="s97-help">Add a device (yours or a teammate’s): send it the share link → open 97 LIVE there → cloud button → paste → done.</div>';
    } else {
      frag = '<p>Link your phone and PC so they always show the same numbers. Free, private (end-to-end encrypted), works offline.</p>'
        + '<label>Already set up another device? Paste its link:</label>'
        + '<input class="s97-inp" id="s97-linkin" placeholder="ns97sync:…" autocomplete="off" spellcheck="false">'
        + '<div class="s97-row"><button class="s97-btn p" data-a="paste">Link this device</button></div>'
        + '<div class="s97-help">First device / manual setup:<br>'
        + '<label>GitHub token</label><input class="s97-inp" id="s97-token" placeholder="ghp_…" autocomplete="off" spellcheck="false">'
        + '<label>Sync Code (secret — same on every device)</label><input class="s97-inp" id="s97-code" placeholder="pick a strong secret" autocomplete="off" spellcheck="false">'
        + '<div class="s97-row"><button class="s97-btn g" data-a="gen">Generate a Sync Code</button>'
        + '<button class="s97-btn p" data-a="connect">Connect</button></div>'
        + '<span class="s97-link" data-a="help">How do I get a GitHub token? (30 seconds)</span></div>';
    }
    body.innerHTML = head + frag;
  }

  function openPanel(){
    if (document.getElementById("s97-modal")) return;
    css();
    var back = document.createElement("div"); back.className = "s97-back"; back.id = "s97-modal";
    var modal = document.createElement("div"); modal.className = "s97-modal";
    modal.innerHTML = '<div class="s97-body"></div>';
    back.appendChild(modal); document.body.appendChild(back);
    renderPanel();
    sheetTag().then(function(){ renderPanel(); });
    // pull the latest cloud revision's author/time so "Last change" is current, not just the last poll
    if (enabled() && navigator.onLine && !corrupted){ put("ns97.sync.etag",""); remoteGet().then(function(){ renderPanel(); }).catch(function(){}); }
    back.addEventListener("mousedown", function(e){ if (e.target === back) closePanel(); });
    modal.addEventListener("click", onPanelClick);
  }
  function closePanel(){ var m = document.getElementById("s97-modal"); if (m) m.remove(); }
  function toast(msg){ var s = document.querySelector("#s97-modal .s97-status"); if (s && s.lastChild) s.lastChild.textContent = msg; }

  function onPanelClick(e){
    if (e.target.classList && e.target.classList.contains("s97-x")) return closePanel();
    var t = e.target.closest("[data-a]"); if (!t) return;
    var a = t.getAttribute("data-a");
    if (a === "gen"){ var el=document.getElementById("s97-code"); if(el) el.value = randomCode(); }
    else if (a === "help"){ showHelp(); }
    else if (a === "now"){ pushLocal().then(pull); }
    else if (a === "selftest"){
      // Full proof in one tap: read the sheet, write a probe, read it back. No guessing.
      toast("Testing — reading the shared sheet…");
      var t0 = Date.now(); put("ns97.sync.etag","");
      remoteGet().then(function(row){
        if (!row || row.__nm) throw new Error("could not read the shared sheet");
        toast("Read OK — now writing a test marker…");
        var nonce = "probe-"+t0+"-"+Math.floor(Math.random()*1e6);
        var files = {}; files["ns97-probe.txt"] = { content: nonce };
        return ghFetch(apiBase()+"/gists/"+get(K.gist), {method:"PATCH", headers:ghHeaders(), body:JSON.stringify({files:files})})
          .then(ok("TEST-WRITE"))
          .then(function(){ return ghFetch(apiBase()+"/gists/"+get(K.gist), {headers:ghHeaders()}).then(ok("TEST-READ")); })
          .then(function(r){ return r.json(); })
          .then(function(g){
            var got = g && g.files && g.files["ns97-probe.txt"] && g.files["ns97-probe.txt"].content;
            if (got !== nonce) throw new Error("wrote a marker but read a different one back");
            put("ns97.sync.etag","");
            toast("✅ This device fully reaches the shared sheet — round-trip "+(((Date.now()-t0)/1000).toFixed(1))+"s");
          });
      }).catch(function(e){ toast("❌ "+String((e&&e.message)||e).slice(0,120)); });
    }
    else if (a === "rename"){
      var v = prompt("Name this device — it shows on your other devices when this one makes a change:", devName());
      if (v !== null){ v = String(v).trim().slice(0,40); put("ns97.sync.dev", v);
        renderPanel();
        if (enabled()) pushLocal(); // re-stamp the cloud so other devices see the new name as last editor
      }
    }
    else if (a === "disconnect"){ if (confirm("Stop syncing on this device? Your data stays here; it just won’t update to/from other devices.")) { disconnect(); renderPanel(); } }
    else if (a === "copylink"){ copy(makeLink()).then(function(){ toast("Link copied — paste it on your other device"); }); }
    else if (a === "paste"){
      var v = (document.getElementById("s97-linkin")||{}).value || "";
      try { var o = parseLink(v); doConnect(o.t, o.c, o.g, true); } catch(err){ toast("That link doesn’t look right"); }
    }
    else if (a === "connect"){
      var token=(document.getElementById("s97-token")||{}).value||"", code=(document.getElementById("s97-code")||{}).value||"";
      if (!token||!code){ toast("Add your GitHub token and a Sync Code"); return; }
      doConnect(token, code, "");
    }
    else if (a === "rb"){ var bk=get("ns97.sync.backup"); if(looksValidData(bk)){ put(DATA_KEY, bk); location.reload(); } else toast("No good backup on this device"); }
    else if (a === "rc"){ toast("Loading from cloud…"); put(K.rev,"0"); put("ns97.sync.etag","");
      remoteGet().then(function(row){ if(!row || row.__nm) throw new Error("nothing saved in the cloud yet");
        return decryptData(cfg().code,row.blob).then(function(plain){ if(!looksValidData(plain)) throw new Error("the cloud copy is also incomplete"); put(DATA_KEY,plain); put(K.rev,String(Number(row.rev)||0)); location.reload(); }); })
        .catch(function(e){ toast("Couldn’t load: "+String((e&&e.message)||e).slice(0,90)); }); }
    else if (a === "reset"){ if(confirm("Start fresh on THIS device with the default sheet?\n\nOnly do this if your real data is safe on another device or a backup.")){ try{localStorage.removeItem(DATA_KEY);}catch(e){} location.reload(); } }
  }
  function doConnect(token, code, gistId, isLink){
    toast("Connecting…");
    put(K.token, cleanTok(token)); put(K.code, code); if(gistId) put(K.gist, gistId); put("ns97.sync.etag","");
    remoteGet().then(function(row){
      var dir = "push";
      if (row && !row.__nm){
        // Pasting a link means "join the existing sync" → always load the cloud data.
        // Manual first-device setup with data already in the cloud → ask which way.
        dir = isLink ? "pull"
          : (confirm("Cloud already has saved data.\n\nOK = load the cloud data onto THIS device.\nCancel = upload THIS device’s data to the cloud (overwrites cloud).") ? "pull" : "push");
      }
      return connect(token, code, gistId, dir);
    }).then(function(){ if (enabled() && status!=="err"){ renderPanel(); } })
      .catch(function(e){
        var m=String((e&&e.message)||e||""), hint;
        if(/Failed to fetch|NetworkError|Load failed|ERR_|TypeError/i.test(m)) hint="can’t reach GitHub — check your internet";
        else if(/\b401\b|Bad credentials|Requires authentication/i.test(m)) hint="token rejected — re-copy it (it may have expired)";
        else if(/\b403\b|rate limit|forbidden|gist/i.test(m)) hint="token needs the ‘gist’ permission — make a new one with gist ticked";
        else if(/\b404\b/i.test(m)) hint="couldn’t find the sync — try again";
        else hint=(m.slice(0,180)||"unknown error");
        toast("Couldn’t connect: "+hint);
        try{console.error("[97 sync] connect failed:",e);}catch(_){}
      });
  }

  function copy(text){
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(fallback);
    return fallback();
    function fallback(){ try{ var ta=document.createElement("textarea"); ta.value=text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }catch(e){} return Promise.resolve(); }
  }

  function showHelp(){
    var b = document.querySelector("#s97-modal .s97-body"); if (!b) return;
    b.innerHTML = '<button class="s97-x" aria-label="Close">✕</button><h3>Get a GitHub token</h3>'
      + '<p>About 30 seconds, free. You already have GitHub. This token can only touch “gists” (private text snippets) — it can’t see your repos or anything else.</p>'
      + '<div class="s97-help" style="border-top:none;color:var(--tx2);font-size:13px">'
      + '1. Tap this link (it opens GitHub with the right box already ticked):<br><span class="s97-link" data-a="open-token">github.com → new token (gist)</span><br><br>'
      + '2. Under <b>Expiration</b> choose <b>No expiration</b>.<br><br>'
      + '3. Scroll to the bottom → tap the green <b>Generate token</b> button.<br><br>'
      + '4. Copy the token it shows (starts <b>ghp_</b>) and paste it into the box on the previous screen.</div>'
      + '<div class="s97-row"><button class="s97-btn p" data-a="back">Back</button></div>';
  }

  document.addEventListener("click", function(e){
    var t = e.target.closest("[data-a]"); if (!t) return;
    var a = t.getAttribute("data-a");
    if (a==="open-token"){ window.open("https://github.com/settings/tokens/new?scopes=gist&description=97%20LIVE%20Sync","_blank","noopener"); }
    else if (a==="back"){ renderPanel(); }
  });

  // ---------- boot ----------
  function boot(){
    renderLauncher();
    var d = get(DATA_KEY);
    if (d != null && !looksValidData(d)) { corrupted = true; openPanel(); return; } // app can't render this — offer recovery
    pulledToast(); // "✓ Updated from iPhone" after an applied change reloaded the page
    if (enabled()){ setStatus("ok"); put("ns97.sync.etag", ""); if (navigator.onLine){ pull(); liveConnect(); liveSend("hi"); } } // boot = full fresh read + open the live channel
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
