/* 97 LIVE — Cloud Sync (optional, end-to-end encrypted).
   Fully self-contained: talks only to the app's localStorage + a Supabase REST table.
   Your data is AES-GCM encrypted in the browser with a key derived from your Sync Code,
   so Supabase only ever stores ciphertext. No React internals are touched. */
(function () {
  "use strict";
  if (!window.crypto || !crypto.subtle) return; // needs a secure context (https/localhost)

  var DATA_KEY = "ns97-finance-v1";                 // the app's own data blob
  var K = { url:"ns97.sync.url", key:"ns97.sync.key", code:"ns97.sync.code", on:"ns97.sync.on", rev:"ns97.sync.rev" };
  var POLL_MS = 4000, DEBOUNCE_MS = 1200;

  var enc = new TextEncoder(), dec = new TextDecoder();
  var _set = localStorage.setItem.bind(localStorage);
  function get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
  function put(k,v){ try { _set(k,v); } catch(e){} }

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
  function cfg(){ return { url:get(K.url), key:get(K.key), code:get(K.code) }; }
  function enabled(){ var c=cfg(); return get(K.on)==="1" && c.url && c.key && c.code; }
  function bucketId(code){ return sha256hex("ns97|"+code).then(function(h){ return "b_"+h.slice(0,40); }); }
  function base(url){ return cleanUrl(url).replace(/\/+$/,""); }
  // Strip anything a copy-paste might have slipped in. A JWT is only [A-Za-z0-9._-];
  // stray smart-quotes / spaces / zero-width chars break fetch() headers (non ISO-8859-1).
  function cleanKey(k){ return String(k==null?"":k).replace(/[^A-Za-z0-9._-]/g,""); }
  function cleanUrl(u){ return String(u==null?"":u).replace(/\s+/g,"").replace(/[^\x21-\x7E]/g,""); }

  // ---------- Supabase REST ----------
  function remoteGet(){
    var c = cfg();
    return bucketId(c.code).then(function(id){
      return fetch(base(c.url)+"/rest/v1/sync?id=eq."+id+"&select=data,rev",
        { headers:{ apikey:cleanKey(c.key), Authorization:"Bearer "+cleanKey(c.key) } }); })
      .then(function(r){ if(!r.ok) return r.text().then(function(t){ throw new Error("GET "+r.status+(t?": "+t.slice(0,160):"")); }); return r.json(); })
      .then(function(rows){ return (rows && rows[0]) ? rows[0] : null; });
  }
  function remotePut(dataBlob, rev){
    var c = cfg();
    return bucketId(c.code).then(function(id){
      return fetch(base(c.url)+"/rest/v1/sync",
        { method:"POST",
          headers:{ apikey:cleanKey(c.key), Authorization:"Bearer "+cleanKey(c.key), "Content-Type":"application/json",
                    Prefer:"resolution=merge-duplicates,return=minimal" },
          body:JSON.stringify({ id:id, data:dataBlob, rev:rev }) }); })
      .then(function(r){ if(!r.ok) return r.text().then(function(t){ throw new Error("PUT "+r.status+(t?": "+t.slice(0,160):"")); }); });
  }

  // ---------- engine ----------
  var lastUploadedRev = 0, applying = false, uploadTimer = null, pendingReload = false, status = "off";
  function setStatus(s){ status = s; renderLauncher(); renderPanel(); }

  function pushLocal(){
    if (!enabled() || applying) return Promise.resolve();
    var c = cfg(), plain = get(DATA_KEY);
    if (plain == null) return Promise.resolve();
    setStatus("syncing");
    return encryptData(c.code, plain).then(function(blob){
      var rev = Date.now();
      return remotePut(blob, rev).then(function(){ lastUploadedRev = rev; put(K.rev, String(rev)); setStatus("ok"); });
    }).catch(function(){ setStatus("err"); });
  }
  function schedulePush(){ if(!enabled()) return; clearTimeout(uploadTimer); uploadTimer = setTimeout(pushLocal, DEBOUNCE_MS); }

  function idle(){
    if (document.querySelector(".backdrop")) return false;                 // a sheet/modal is open
    if (document.getElementById("s97-modal")) return false;                // our panel is open
    var a = document.activeElement;
    if (a && (a.tagName==="INPUT" || a.tagName==="TEXTAREA" || a.isContentEditable)) return false;
    return true;
  }
  function applyRemote(plain, rev){
    applying = true;
    put(DATA_KEY, plain); put(K.rev, String(rev));
    applying = false;
    setStatus("pulled");
    if (idle()) location.reload(); else pendingReload = true;
  }
  function pull(){
    if (!enabled() || applying) return Promise.resolve();
    return remoteGet().then(function(row){
      if (!row) return;
      var rev = Number(row.rev)||0, appliedRev = Number(get(K.rev))||0;
      if (rev <= appliedRev) return;
      if (rev === lastUploadedRev) { put(K.rev, String(rev)); return; }     // our own echo
      return decryptData(cfg().code, row.data).then(function(plain){
        JSON.parse(plain);                                                  // sanity: must be valid JSON
        if (plain === get(DATA_KEY)) { put(K.rev, String(rev)); return; }
        applyRemote(plain, rev);
      });
    }).catch(function(){ setStatus("err"); });
  }

  // intercept the app's saves → schedule an upload
  localStorage.setItem = function(k, v){ _set(k, v); if (k===DATA_KEY && !applying) schedulePush(); };

  setInterval(function(){ if (enabled() && navigator.onLine) pull(); }, POLL_MS);
  window.addEventListener("online", function(){ if (enabled()) { pull(); pushLocal(); } });
  window.addEventListener("focus", function(){
    if (pendingReload && idle()) { pendingReload = false; location.reload(); return; }
    if (enabled() && navigator.onLine) pull();
  });

  // ---------- connect / disconnect ----------
  function connect(url, key, code, direction){
    put(K.url, cleanUrl(url)); put(K.key, cleanKey(key)); put(K.code, code); put(K.on, "1");
    setStatus("syncing");
    return remoteGet().then(function(row){
      if (row && direction !== "push") {
        return decryptData(code, row.data).then(function(plain){
          JSON.parse(plain);
          applying = true; put(DATA_KEY, plain); put(K.rev, String(Number(row.rev)||0)); applying = false;
          setStatus("ok"); location.reload();
        });
      }
      var plain = get(DATA_KEY) || "{}";
      return encryptData(code, plain).then(function(blob){
        var rev = Date.now();
        return remotePut(blob, rev).then(function(){ lastUploadedRev = rev; put(K.rev, String(rev)); setStatus("ok"); });
      });
    }).catch(function(e){ setStatus("err"); throw e; });
  }
  function disconnect(){ put(K.on, "0"); setStatus("off"); }

  // device link: one string carrying url+key+code so the 2nd device is a single paste
  function makeLink(){ var c=cfg(); return "ns97sync:" + b64(enc.encode(JSON.stringify({u:c.url,k:c.key,c:c.code}))); }
  function parseLink(s){ s=String(s).trim(); if(s.indexOf("ns97sync:")!==0) throw new Error("not a link");
    var o=JSON.parse(dec.decode(unb64(s.slice(9)))); if(!o.u||!o.k||!o.c) throw new Error("bad link"); return o; }
  function randomCode(){ var a=new Uint8Array(9); crypto.getRandomValues(a);
    return "97-" + b64(a).replace(/[^a-zA-Z0-9]/g,"").slice(0,12).toLowerCase(); }

  // ---------- UI (appended to <body>, outside #root, so React never disturbs it) ----------
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
      ".s97-modal label{display:block;font-size:12px;font-weight:700;color:var(--tx2);margin:12px 0 5px;text-transform:none}",
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
      ".s97-help{font-size:12px;color:var(--tx3,#8B917B);line-height:1.5;margin-top:10px;border-top:1px solid var(--line);padding-top:10px}",
      ".s97-help a,.s97-link{color:var(--usd,#35C6D4);cursor:pointer;text-decoration:underline}",
      ".s97-x{float:right;width:32px;height:32px;border-radius:50%;background:var(--card2);border:1px solid var(--line);color:var(--tx2);cursor:pointer;font-size:16px}"
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
    var dot = launcher.querySelector(".s97-dot");
    dot.className = "s97-dot" + (enabled() ? (" " + (status==="off"?"ok":status)) : "");
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
    var on = enabled();
    var head = '<button class="s97-x" aria-label="Close">✕</button><h3>Cloud Sync</h3>'
      + '<div class="s97-status"><span class="s97-pill '+(on?(status==="off"?"ok":status):"")+'"></span>'+statusText()+'</div>';
    var frag;
    if (on){
      frag = '<p>This device is linked. Any change here appears on your other devices within a few seconds — and vice-versa. Your numbers are encrypted before they leave the device.</p>'
        + '<div class="s97-row"><button class="s97-btn p" data-a="now">Sync now</button>'
        + '<button class="s97-btn g" data-a="copylink">Copy link for other device</button></div>'
        + '<div class="s97-row"><button class="s97-btn d" data-a="disconnect">Disconnect this device</button></div>'
        + '<div class="s97-help">To add another device: open 97 LIVE there, tap the cloud button, choose <b>Paste link from another device</b>, and paste. That’s it.</div>';
    } else {
      frag = '<p>Link your phone and PC so they always show the same numbers. Free, private (end-to-end encrypted), and it keeps working offline.</p>'
        + '<label>Already set up another device? Paste its link:</label>'
        + '<input class="s97-inp" id="s97-linkin" placeholder="ns97sync:…" autocomplete="off" spellcheck="false">'
        + '<div class="s97-row"><button class="s97-btn p" data-a="paste">Link this device</button></div>'
        + '<div class="s97-help">First device / manual setup:<br>'
        + '<label>Supabase URL</label><input class="s97-inp" id="s97-url" placeholder="https://xxxx.supabase.co" autocomplete="off" spellcheck="false">'
        + '<label>Supabase anon key</label><input class="s97-inp" id="s97-key" placeholder="eyJhbGciOi…" autocomplete="off" spellcheck="false">'
        + '<label>Sync Code (secret — same on every device)</label><input class="s97-inp" id="s97-code" placeholder="pick a strong secret" autocomplete="off" spellcheck="false">'
        + '<div class="s97-row"><button class="s97-btn g" data-a="gen">Generate a Sync Code</button>'
        + '<button class="s97-btn p" data-a="connect">Connect</button></div>'
        + '<span class="s97-link" data-a="help">How do I get the Supabase URL &amp; key? (2-min setup)</span></div>';
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
    back.addEventListener("mousedown", function(e){ if (e.target === back) closePanel(); });
    modal.addEventListener("click", onPanelClick);
  }
  function closePanel(){ var m = document.getElementById("s97-modal"); if (m) m.remove(); }

  function toast(msg){ setStatus(status); var s = document.querySelector("#s97-modal .s97-status"); if (s) s.lastChild.textContent = msg; }

  function onPanelClick(e){
    var t = e.target.closest("[data-a]") || (e.target.classList && e.target.classList.contains("s97-x") ? e.target : null);
    if (e.target.classList && e.target.classList.contains("s97-x")) return closePanel();
    if (!t) return;
    var a = t.getAttribute("data-a");
    if (a === "gen"){ var el=document.getElementById("s97-code"); if(el) el.value = randomCode(); }
    else if (a === "help"){ showHelp(); }
    else if (a === "now"){ pushLocal().then(pull); }
    else if (a === "disconnect"){ if (confirm("Stop syncing on this device? Your data stays here; it just won’t update to/from other devices.")) { disconnect(); renderPanel(); } }
    else if (a === "copylink"){ var link = makeLink(); copy(link).then(function(){ toast("Link copied — paste it on your other device"); }); }
    else if (a === "paste"){
      var v = (document.getElementById("s97-linkin")||{}).value || "";
      try { var o = parseLink(v); doConnect(o.u, o.k, o.c); } catch(err){ toast("That link doesn’t look right"); }
    }
    else if (a === "connect"){
      var url=(document.getElementById("s97-url")||{}).value||"", key=(document.getElementById("s97-key")||{}).value||"", code=(document.getElementById("s97-code")||{}).value||"";
      if (!url||!key||!code){ toast("Fill in all three fields"); return; }
      doConnect(url, key, code);
    }
  }
  function doConnect(url, key, code){
    var hasLocal = false; try { var d=get(DATA_KEY); hasLocal = !!d && d.length>40; } catch(e){}
    toast("Connecting…");
    // peek remote to decide direction
    put(K.url,cleanUrl(url)); put(K.key,cleanKey(key)); put(K.code,code);
    remoteGet().then(function(row){
      var dir = "push";
      if (row){
        dir = confirm("Cloud already has saved data.\n\nOK = load the cloud data onto THIS device.\nCancel = upload THIS device’s data to the cloud (overwrites cloud).") ? "pull" : "push";
      }
      return connect(url, key, code, dir);
    }).then(function(){ if (enabled() && status!=="err"){ renderPanel(); } })
      .catch(function(e){
        var m=String((e&&e.message)||e||""), hint;
        if(/Failed to fetch|NetworkError|Load failed|ERR_|TypeError/i.test(m)) hint="can’t reach that URL — check the Supabase URL and your internet";
        else if(/does not exist|relation|PGRST205|\b404\b/i.test(m)) hint="table not found — run the SQL step";
        else if(/\b401\b|JWT|JWS|apikey|No API key|Invalid API/i.test(m)) hint="key rejected — re-copy the anon public key";
        else if(/\b403\b|row-level|policy|permission/i.test(m)) hint="blocked by permissions — re-run the SQL policies";
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
    var b = document.querySelector("#s97-modal .s97-body");
    if (!b) return;
    b.innerHTML = '<button class="s97-x" aria-label="Close">✕</button><h3>Get your Supabase keys</h3>'
      + '<p>One-time, ~2 minutes, free. You only do this on the <b>first</b> device.</p>'
      + '<div class="s97-help" style="border-top:none;color:var(--tx2);font-size:13px">'
      + '1. Go to <span class="s97-link" data-a="open-supabase">supabase.com</span> → <b>Start your project</b> (sign in with GitHub).<br><br>'
      + '2. <b>New project</b> → give it any name → set a database password → Create. Wait ~1 min.<br><br>'
      + '3. Left sidebar → <b>SQL Editor</b> → <b>New query</b> → paste the block below → <b>Run</b>.<br><br>'
      + '4. Left sidebar → <b>Project Settings</b> → <b>API</b>. Copy the <b>Project URL</b> and the <b>anon public</b> key into this app.<br><br>'
      + 'SQL to paste in step 3:</div>'
      + '<textarea class="s97-inp" readonly rows="7" style="font-family:ui-monospace,monospace;font-size:11.5px;margin-top:8px" id="s97-sql">'
      + 'create table if not exists sync (\n  id text primary key,\n  data text,\n  rev bigint default 0,\n  updated_at timestamptz default now()\n);\nalter table sync enable row level security;\ncreate policy "sync read"   on sync for select to anon using (true);\ncreate policy "sync insert" on sync for insert to anon with check (true);\ncreate policy "sync update" on sync for update to anon using (true) with check (true);</textarea>'
      + '<div class="s97-row"><button class="s97-btn g" data-a="copysql">Copy SQL</button><button class="s97-btn p" data-a="back">Back</button></div>';
  }

  document.addEventListener("click", function(e){
    var t = e.target.closest("[data-a]"); if (!t) return;
    var a = t.getAttribute("data-a");
    if (a==="open-supabase"){ window.open("https://supabase.com","_blank","noopener"); }
    else if (a==="copysql"){ var ta=document.getElementById("s97-sql"); if(ta) copy(ta.value); t.textContent="Copied ✓"; }
    else if (a==="back"){ renderPanel(); }
  });

  // ---------- boot ----------
  function boot(){
    renderLauncher();
    if (enabled()){ setStatus("ok"); if (navigator.onLine) pull(); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
