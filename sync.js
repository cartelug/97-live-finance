/* 97 LIVE — Cloud Sync (optional, end-to-end encrypted) via a private GitHub Gist.
   Self-contained: talks only to the app's localStorage + the GitHub API. Your data is
   AES-GCM encrypted in the browser with a key derived from your Sync Code, so GitHub only
   ever stores ciphertext. No React internals are touched. GitHub never pauses like a free DB. */
(function () {
  "use strict";
  if (!window.crypto || !crypto.subtle) return; // needs a secure context (https/localhost)

  var DATA_KEY = "ns97-finance-v1";
  var K = { token:"ns97.sync.token", gist:"ns97.sync.gist", code:"ns97.sync.code", on:"ns97.sync.on", rev:"ns97.sync.rev" };
  var POLL_MS = 6000, DEBOUNCE_MS = 1200;

  var enc = new TextEncoder(), dec = new TextDecoder();
  var _set = localStorage.setItem.bind(localStorage);
  function get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
  function put(k,v){ try { _set(k,v); } catch(e){} }
  function apiBase(){ return get("ns97.sync.api") || "https://api.github.com"; } // override is test-only

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
  function deriveKey(code){
    return crypto.subtle.importKey("raw", enc.encode(code), "PBKDF2", false, ["deriveKey"]).then(function(base){
      return crypto.subtle.deriveKey({name:"PBKDF2", salt:enc.encode("ns97-sync-v1"), iterations:120000, hash:"SHA-256"},
        base, {name:"AES-GCM", length:256}, false, ["encrypt","decrypt"]); }); }
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
  function findGist(fn){
    return fetch(apiBase()+"/gists?per_page=100", {headers:ghHeaders()}).then(ok("LIST")).then(function(r){ return r.json(); })
      .then(function(list){ for(var i=0;i<list.length;i++){ if(list[i].files && list[i].files[fn]){ put(K.gist, list[i].id); return list[i]; } } return null; });
  }
  // returns {rev, blob} or null
  function remoteGet(){
    var code = cfg().code;
    return fname(code).then(function(fn){
      var gid = get(K.gist);
      var got = gid
        ? fetch(apiBase()+"/gists/"+gid, {headers:ghHeaders()}).then(function(r){ if(r.status===404){ put(K.gist,""); return findGist(fn); } return ok("GET")(r).then(function(x){ return x.json(); }); })
        : findGist(fn);
      return got.then(function(g){
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
        return { rev: rev, blob: rest, by: by };
      });
    });
  }
  function remotePut(blob, rev){
    return fname(cfg().code).then(function(fn){
      var files={}; files[fn]={ content: rev + "\n" + encName(devName()) + "\n" + blob };
      function create(){ return fetch(apiBase()+"/gists", {method:"POST", headers:ghHeaders(),
          body:JSON.stringify({description:"97 LIVE — encrypted finance sync (safe to keep private)", public:false, files:files})})
          .then(ok("CREATE")).then(function(r){ return r.json(); }).then(function(g){ put(K.gist, g.id); }); }
      function patch(gid){ return fetch(apiBase()+"/gists/"+gid, {method:"PATCH", headers:ghHeaders(), body:JSON.stringify({files:files})})
          .then(function(r){ if(r.status===404){ put(K.gist,""); return create(); } return ok("PATCH")(r); }); }
      var gid = get(K.gist);
      if(gid) return patch(gid);
      return findGist(fn).then(function(g){ return g ? patch(g.id) : create(); });
    });
  }

  // ---------- engine ----------
  var lastUploadedRev = 0, applying = false, uploadTimer = null, pendingReload = false, status = "off", corrupted = false;
  function setStatus(s){ status = s; renderLauncher(); renderPanel(); }

  function pushLocal(){
    if (!enabled() || applying) return Promise.resolve();
    var c = cfg(), plain = get(DATA_KEY);
    if (!looksValidData(plain)) return Promise.resolve(); // never upload an empty/partial snapshot
    setStatus("syncing");
    return encryptData(c.code, plain).then(function(blob){
      var rev = Date.now();
      return remotePut(blob, rev).then(function(){ lastUploadedRev = rev; put(K.rev, String(rev));
        put("ns97.sync.lastat", String(rev)); put("ns97.sync.lastby", devName()); setStatus("ok"); });
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
    setStatus("pulled");
    if (idle()) location.reload(); else pendingReload = true;
  }
  function pull(){
    if (!enabled() || applying) return Promise.resolve();
    return remoteGet().then(function(row){
      if (!row) return;
      var rev = Number(row.rev)||0, appliedRev = Number(get(K.rev))||0;
      if (rev <= appliedRev) return;
      if (rev === lastUploadedRev) { put(K.rev, String(rev)); return; }
      return decryptData(cfg().code, row.blob).then(function(plain){
        if (!looksValidData(plain)) { put(K.rev, String(rev)); return; } // ignore an incomplete cloud copy
        if (plain === get(DATA_KEY)) { put(K.rev, String(rev)); return; }
        applyRemote(plain, rev);
      });
    }).catch(function(){ setStatus("err"); });
  }

  localStorage.setItem = function(k, v){ _set(k, v); if (k===DATA_KEY && !applying) schedulePush(); };

  setInterval(function(){ if (enabled() && navigator.onLine) pull(); }, POLL_MS);
  window.addEventListener("online", function(){ if (enabled()) { pull(); pushLocal(); } });
  window.addEventListener("focus", function(){
    if (pendingReload && idle()) { pendingReload = false; location.reload(); return; }
    if (enabled() && navigator.onLine) pull();
  });

  // ---------- connect / disconnect ----------
  function connect(token, code, gistId, direction){
    put(K.token, cleanTok(token)); put(K.code, code); if(gistId) put(K.gist, gistId); put(K.on, "1");
    setStatus("syncing");
    return remoteGet().then(function(row){
      if (row && direction !== "push") {
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
        var rev = Date.now();
        return remotePut(blob, rev).then(function(){ lastUploadedRev = rev; put(K.rev, String(rev));
          put("ns97.sync.lastat", String(rev)); put("ns97.sync.lastby", devName()); setStatus("ok"); });
      });
    }).catch(function(e){ setStatus("err"); throw e; });
  }
  function disconnect(){ put(K.on, "0"); setStatus("off"); }

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
      ".s97-last .s97-pill{width:7px;height:7px}"
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
      frag = '<div class="s97-dev"><div><div class="s97-dev-lbl">You’re on</div>'
        + '<div class="s97-dev-name">' + esc(here) + '<span class="s97-here">This device</span></div></div>'
        + '<button class="s97-ren" data-a="rename">Rename</button></div>'
        + '<div class="s97-last"><span class="s97-pill '+(mine?"ok":"")+'"></span>' + lastLine + '</div>'
        + '<p>Any change here shows on your other devices within a few seconds — and back again. Your numbers are encrypted before they leave the device.</p>'
        + '<div class="s97-row"><button class="s97-btn p" data-a="now">Sync now</button>'
        + '<button class="s97-btn g" data-a="copylink">Copy link for other device</button></div>'
        + '<div class="s97-row"><button class="s97-btn d" data-a="disconnect">Disconnect this device</button></div>'
        + '<div class="s97-help">Name your master device something clear (e.g. “Main PC”) so you can always tell which is which. Add another device: open 97 LIVE there → cloud button → paste this link.</div>';
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
    // pull the latest cloud revision's author/time so "Last change" is current, not just the last poll
    if (enabled() && navigator.onLine && !corrupted){ remoteGet().then(function(){ renderPanel(); }).catch(function(){}); }
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
    else if (a === "rc"){ toast("Loading from cloud…"); put(K.rev,"0");
      remoteGet().then(function(row){ if(!row) throw new Error("nothing saved in the cloud yet");
        return decryptData(cfg().code,row.blob).then(function(plain){ if(!looksValidData(plain)) throw new Error("the cloud copy is also incomplete"); put(DATA_KEY,plain); put(K.rev,String(Number(row.rev)||0)); location.reload(); }); })
        .catch(function(e){ toast("Couldn’t load: "+String((e&&e.message)||e).slice(0,90)); }); }
    else if (a === "reset"){ if(confirm("Start fresh on THIS device with the default sheet?\n\nOnly do this if your real data is safe on another device or a backup.")){ try{localStorage.removeItem(DATA_KEY);}catch(e){} location.reload(); } }
  }
  function doConnect(token, code, gistId, isLink){
    toast("Connecting…");
    put(K.token, cleanTok(token)); put(K.code, code); if(gistId) put(K.gist, gistId);
    remoteGet().then(function(row){
      var dir = "push";
      if (row){
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
    if (enabled()){ setStatus("ok"); if (navigator.onLine) pull(); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
