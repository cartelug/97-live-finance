/* 97 LIVE — Supabase Cloud Sync
   Supabase/Postgres is the source of truth. Browser storage is an offline cache.
   Saves use optimistic version checks; conflicts are merged and retried.
*/
(function () {
  "use strict";

  var ENGINE = "supabase-v2";
  var DATA_KEY = "ns97-finance-v1";
  var BASE_KEY = "ns97.cloud.base";
  var VERSION_KEY = "ns97.cloud.version";
  var DIRTY_KEY = "ns97.cloud.dirty";
  var RELOAD_VERSION_KEY = "ns97.cloud.reload_version";
  var URL = "https://rytbeijznlqofstfrmwf.supabase.co";
  var PUBLISHABLE_KEY = "sb_publishable_M5P58fOgzRv5_28qZXmwYg_wiYVhMQ-";
  var SDK_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
  var SAVE_DELAY = 650;
  var REPAIR_INTERVAL = 30000;
  var MAX_RETRIES = 4;

  var nativeSet = Storage.prototype.setItem;
  var nativeRemove = Storage.prototype.removeItem;
  var client = null;
  var session = null;
  var channel = null;
  var ready = false;
  var applying = false;
  var dirty = false;
  var saving = false;
  var saveTimer = null;
  var retryTimer = null;
  var pendingReload = false;
  var cloudData = null;
  var cloudVersion = 0;
  var cloudUpdatedAt = null;
  var status = "loading";
  var lastError = "";
  var launcher = null;

  function get(k) {
    try { return localStorage.getItem(k); } catch (_) { return null; }
  }
  function put(k, v) {
    try { nativeSet.call(localStorage, k, v); } catch (_) {}
  }
  function remove(k) {
    try { nativeRemove.call(localStorage, k); } catch (_) {}
  }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function clone(v) {
    return v == null ? v : JSON.parse(JSON.stringify(v));
  }
  // JSONB may return object keys in a different order. Compare canonical values, not raw JSON text.
  function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
    return "{" + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ":" + stableStringify(value[key]);
    }).join(",") + "}";
  }
  function equal(a, b) {
    if (a === b) return true;
    try { return stableStringify(a) === stableStringify(b); } catch (_) { return false; }
  }
  function parseData(raw) {
    if (!raw) return null;
    var value;
    try { value = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (_) { return null; }
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (!value.meta || typeof value.meta !== "object") return null;
    if (!Array.isArray(value.followups) || !Array.isArray(value.balances) || !Array.isArray(value.credit)) return null;
    return value;
  }
  function localData() {
    return parseData(get(DATA_KEY));
  }
  function setLocal(data, reload) {
    if (!parseData(data)) throw new Error("Cloud data is incomplete");
    var current = get(DATA_KEY);
    var currentData = parseData(current);
    if (currentData && equal(currentData, data)) return false;
    if (current) put("ns97.cloud.device_backup", current);
    applying = true;
    put(DATA_KEY, JSON.stringify(data));
    applying = false;
    if (reload) requestReload(cloudVersion);
    return true;
  }
  function idle() {
    if (document.querySelector(".backdrop") || document.getElementById("s97-cloud-modal")) return false;
    var a = document.activeElement;
    return !(a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable));
  }
  function requestReload(version) {
    // Reload at most once for a committed cloud version. This breaks reload feedback loops.
    var v = Number(version || cloudVersion) || 0;
    if (v && Number(get(RELOAD_VERSION_KEY)) === v) return;
    if (v) put(RELOAD_VERSION_KEY, String(v));
    if (idle()) location.reload();
    else pendingReload = true;
  }
  function setStatus(next, err) {
    status = next;
    lastError = err ? String(err.message || err) : "";
    renderLauncher();
    renderPanel();
    renderGateMessage();
  }
  function deviceName() {
    var saved = get("ns97.cloud.device");
    if (saved && saved.trim()) return saved.trim();
    var ua = navigator.userAgent || "";
    if (/iPhone/i.test(ua)) return "iPhone";
    if (/iPad/i.test(ua)) return "iPad";
    if (/Android/i.test(ua)) return "Android phone";
    if (/Windows/i.test(ua)) return "Windows PC";
    if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
    return "This device";
  }
  function relativeTime(iso) {
    if (!iso) return "not saved yet";
    var ms = Date.parse(iso);
    if (!ms) return "recently";
    var sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (sec < 45) return "just now";
    if (sec < 90) return "a minute ago";
    var min = Math.round(sec / 60);
    if (min < 60) return min + " min ago";
    var hr = Math.round(min / 60);
    if (hr < 24) return hr + (hr === 1 ? " hour ago" : " hours ago");
    var day = Math.round(hr / 24);
    return day + (day === 1 ? " day ago" : " days ago");
  }

  function itemKey(item, index) {
    if (item && typeof item === "object") {
      var keys = ["id", "uuid", "key", "accountId", "transactionId", "name"];
      for (var i = 0; i < keys.length; i++) {
        if (item[keys[i]] !== undefined && item[keys[i]] !== null && item[keys[i]] !== "") {
          return keys[i] + ":" + String(item[keys[i]]);
        }
      }
    }
    return "index:" + index;
  }
  function canMergeArray(arr) {
    if (!arr.length) return true;
    var seen = {};
    for (var i = 0; i < arr.length; i++) {
      if (!arr[i] || typeof arr[i] !== "object" || Array.isArray(arr[i])) return false;
      var k = itemKey(arr[i], i);
      if (k.indexOf("index:") === 0 || seen[k]) return false;
      seen[k] = true;
    }
    return true;
  }
  function mergeArray(base, local, remote) {
    if (!canMergeArray(base) || !canMergeArray(local) || !canMergeArray(remote)) return clone(local);
    var bm = {}, lm = {}, rm = {}, order = [], seen = {};
    base.forEach(function (x, i) { bm[itemKey(x, i)] = x; });
    local.forEach(function (x, i) { var k = itemKey(x, i); lm[k] = x; if (!seen[k]) { seen[k] = true; order.push(k); } });
    remote.forEach(function (x, i) { var k = itemKey(x, i); rm[k] = x; if (!seen[k]) { seen[k] = true; order.push(k); } });
    Object.keys(bm).forEach(function (k) { if (!seen[k]) { seen[k] = true; order.push(k); } });
    var out = [];
    order.forEach(function (k) {
      var hasB = Object.prototype.hasOwnProperty.call(bm, k);
      var hasL = Object.prototype.hasOwnProperty.call(lm, k);
      var hasR = Object.prototype.hasOwnProperty.call(rm, k);
      var b = bm[k], l = lm[k], r = rm[k];
      if (!hasL && !hasR) return;
      if (!hasB) {
        if (hasL && hasR) out.push(merge3(undefined, l, r));
        else out.push(clone(hasL ? l : r));
        return;
      }
      if (!hasL) {
        if (equal(r, b)) return;
        out.push(clone(r));
        return;
      }
      if (!hasR) {
        if (equal(l, b)) return;
        out.push(clone(l));
        return;
      }
      out.push(merge3(b, l, r));
    });
    return out;
  }
  function merge3(base, local, remote) {
    if (equal(local, remote)) return clone(local);
    if (equal(local, base)) return clone(remote);
    if (equal(remote, base)) return clone(local);
    if (Array.isArray(local) && Array.isArray(remote) && Array.isArray(base || [])) {
      return mergeArray(Array.isArray(base) ? base : [], local, remote);
    }
    if (local && remote && typeof local === "object" && typeof remote === "object" && !Array.isArray(local) && !Array.isArray(remote)) {
      var out = {};
      var keys = {};
      Object.keys(base && typeof base === "object" ? base : {}).forEach(function (k) { keys[k] = true; });
      Object.keys(local).forEach(function (k) { keys[k] = true; });
      Object.keys(remote).forEach(function (k) { keys[k] = true; });
      Object.keys(keys).forEach(function (k) {
        var bHas = base && Object.prototype.hasOwnProperty.call(base, k);
        var lHas = Object.prototype.hasOwnProperty.call(local, k);
        var rHas = Object.prototype.hasOwnProperty.call(remote, k);
        if (!lHas && !rHas) return;
        if (!lHas) {
          if (bHas && equal(remote[k], base[k])) return;
          out[k] = clone(remote[k]);
          return;
        }
        if (!rHas) {
          if (bHas && equal(local[k], base[k])) return;
          out[k] = clone(local[k]);
          return;
        }
        out[k] = merge3(bHas ? base[k] : undefined, local[k], remote[k]);
      });
      return out;
    }
    return clone(local);
  }

  function loadSDK() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-s97-supabase]');
      if (existing) {
        existing.addEventListener("load", resolve, {once:true});
        existing.addEventListener("error", function () { reject(new Error("Could not load Supabase")); }, {once:true});
        return;
      }
      var s = document.createElement("script");
      s.src = SDK_URL;
      s.async = true;
      s.dataset.s97Supabase = "1";
      s.onload = resolve;
      s.onerror = function () { reject(new Error("Could not load Supabase")); };
      document.head.appendChild(s);
    });
  }
  function createClient() {
    client = window.supabase.createClient(URL, PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 10 } }
    });
  }
  function fetchDocument() {
    if (!session) return Promise.resolve(null);
    return client.from("finance_documents")
      .select("owner_id,data,version,updated_at")
      .eq("owner_id", session.user.id)
      .maybeSingle()
      .then(function (res) {
        if (res.error) throw res.error;
        if (!res.data) return null;
        var parsed = parseData(res.data.data);
        if (!parsed) throw new Error("The cloud copy is incomplete");
        return {
          data: parsed,
          version: Number(res.data.version) || 0,
          updated_at: res.data.updated_at || null
        };
      });
  }
  function rememberCloud(row) {
    cloudData = clone(row.data);
    cloudVersion = Number(row.version) || 0;
    cloudUpdatedAt = row.updated_at || new Date().toISOString();
    put(BASE_KEY, JSON.stringify(cloudData));
    put(VERSION_KEY, String(cloudVersion));
  }
  function insertFirst(data) {
    return client.from("finance_documents")
      .insert({ owner_id: session.user.id, data: data, version: 1 })
      .select("data,version,updated_at")
      .single()
      .then(function (res) {
        if (res.error) throw res.error;
        return { data: parseData(res.data.data), version: Number(res.data.version) || 1, updated_at: res.data.updated_at };
      });
  }
  function conditionalUpdate(data, expected) {
    return client.from("finance_documents")
      .update({ data: data, version: expected + 1, updated_at: new Date().toISOString() })
      .eq("owner_id", session.user.id)
      .eq("version", expected)
      .select("data,version,updated_at")
      .maybeSingle()
      .then(function (res) {
        if (res.error) throw res.error;
        if (!res.data) return null;
        return { data: parseData(res.data.data), version: Number(res.data.version) || expected + 1, updated_at: res.data.updated_at };
      });
  }

  function markDirty(value) {
    dirty = !!value;
    if (dirty) put(DIRTY_KEY, "1");
    else remove(DIRTY_KEY);
  }
  function scheduleSave(delay) {
    if (applying) return;
    if (session) markDirty(true);
    if (!ready || !session) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveNow(0); }, delay == null ? SAVE_DELAY : delay);
    setStatus(navigator.onLine ? "saving" : "offline");
  }
  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(function () {
      if (dirty && session && navigator.onLine) saveNow(0);
    }, 3500);
  }
  function saveNow(attempt) {
    if (!ready || !session || applying || saving) return Promise.resolve(false);
    var mine = localData();
    if (!mine) return Promise.resolve(false);
    if (!navigator.onLine) {
      markDirty(true);
      setStatus("offline");
      return Promise.resolve(false);
    }
    if (cloudData && equal(mine, cloudData)) {
      markDirty(false);
      setStatus("online");
      return Promise.resolve(true);
    }
    saving = true;
    setStatus("saving");

    function resolveConflict() {
      if (attempt >= MAX_RETRIES) throw new Error("Another device is changing the sheet continuously. Please try again.");
      return fetchDocument().then(function (latest) {
        if (!latest) {
          cloudData = null;
          cloudVersion = 0;
          saving = false;
          return saveNow(attempt + 1);
        }
        var merged = merge3(cloudData || parseData(get(BASE_KEY)) || {}, mine, latest.data);
        rememberCloud(latest);
        if (!equal(merged, mine)) {
          applying = true;
          put(DATA_KEY, JSON.stringify(merged));
          applying = false;
        }
        markDirty(!equal(merged, latest.data));
        saving = false;
        return saveNow(attempt + 1);
      });
    }

    return (cloudVersion === 0 ? insertFirst(mine) : conditionalUpdate(mine, cloudVersion))
      .then(function (saved) {
        if (!saved) return resolveConflict();
        if (!saved.data) throw new Error("The server returned incomplete data");
        rememberCloud(saved);
        markDirty(false);
        saving = false;
        setStatus("online");
        return true;
      })
      .catch(function (err) {
        var conflict = String(err && err.code || "") === "23505" || /duplicate key|version_conflict/i.test(String(err && err.message || err));
        if (conflict) {
          saving = false;
          return resolveConflict().catch(function (conflictErr) {
            saving = false;
            markDirty(true);
            setStatus(navigator.onLine ? "error" : "offline", conflictErr);
            scheduleRetry();
            return false;
          });
        }
        saving = false;
        markDirty(true);
        setStatus(navigator.onLine ? "error" : "offline", err);
        scheduleRetry();
        return false;
      });
  }

  function pull(force) {
    if (!ready || !session || saving || !navigator.onLine) return Promise.resolve(false);
    return fetchDocument().then(function (row) {
      if (!row) return false;
      if (!force && row.version === cloudVersion) return true;
      var mine = localData();
      if (!mine) {
        rememberCloud(row);
        markDirty(false);
        setLocal(row.data, true);
        return true;
      }
      if (dirty || (cloudData && !equal(mine, cloudData))) {
        var merged = merge3(cloudData || parseData(get(BASE_KEY)) || {}, mine, row.data);
        var changedLocal = !equal(merged, mine);
        rememberCloud(row);
        if (changedLocal) {
          applying = true;
          put(DATA_KEY, JSON.stringify(merged));
          applying = false;
        }
        markDirty(!equal(merged, row.data));
        if (dirty) {
          return saveNow(0).then(function (ok) {
            if (ok && changedLocal) requestReload(cloudVersion);
            return ok;
          });
        }
        if (changedLocal) requestReload(row.version);
        else setStatus("online");
        return true;
      }
      rememberCloud(row);
      markDirty(false);
      if (!equal(mine, row.data)) setLocal(row.data, true);
      else setStatus("online");
      return true;
    }).catch(function (err) {
      setStatus(navigator.onLine ? "error" : "offline", err);
      return false;
    });
  }

  function subscribe() {
    if (channel) client.removeChannel(channel);
    channel = null;
    if (!session) return;
    channel = client.channel("97-live-" + session.user.id)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "finance_documents",
        filter: "owner_id=eq." + session.user.id
      }, function (payload) {
        var nextVersion = payload && payload.new ? Number(payload.new.version) || 0 : 0;
        if (!nextVersion || nextVersion > cloudVersion) pull(true);
      })
      .subscribe(function (state) {
        if (state === "SUBSCRIBED") setStatus(dirty ? "saving" : "online");
        else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") setStatus("reconnecting");
      });
  }

  function initializeSession(nextSession) {
    session = nextSession || null;
    ready = false;
    if (!session) {
      cloudData = null;
      cloudVersion = 0;
      if (channel && client) client.removeChannel(channel);
      channel = null;
      showGate();
      setStatus("signin");
      return Promise.resolve();
    }
    hideGate();
    setStatus("loading");

    var cachedBase = parseData(get(BASE_KEY));
    var cachedVersion = Number(get(VERSION_KEY)) || 0;
    var hadQueuedChanges = get(DIRTY_KEY) === "1";
    var reloadAfterInit = false;
    if (cachedBase) {
      cloudData = clone(cachedBase);
      cloudVersion = cachedVersion;
    }

    return fetchDocument().then(function (row) {
      var mine = localData();
      if (!row) {
        if (!mine) throw new Error("This device has no valid finance data to upload");
        return insertFirst(mine).then(function (created) {
          rememberCloud(created);
          markDirty(false);
        }).catch(function (err) {
          if (String(err.code || "") === "23505") return fetchDocument().then(function (existing) {
            if (!existing) throw err;
            var merged = cachedBase ? merge3(cachedBase, mine, existing.data) : existing.data;
            rememberCloud(existing);
            if (!equal(mine, merged)) {
              applying = true;
              put(DATA_KEY, JSON.stringify(merged));
              applying = false;
              reloadAfterInit = true;
            }
            markDirty(cachedBase ? !equal(merged, existing.data) : false);
          });
          throw err;
        });
      }

      if (!mine) {
        rememberCloud(row);
        markDirty(false);
        reloadAfterInit = setLocal(row.data, false) || reloadAfterInit;
        return;
      }

      var localChanged = hadQueuedChanges || (cachedBase && !equal(mine, cachedBase));
      if (localChanged) {
        var merged = merge3(cachedBase || {}, mine, row.data);
        rememberCloud(row);
        if (!equal(mine, merged)) {
          applying = true;
          put(DATA_KEY, JSON.stringify(merged));
          applying = false;
          reloadAfterInit = true;
        }
        markDirty(!equal(merged, row.data));
        return;
      }

      rememberCloud(row);
      markDirty(false);
      if (!equal(mine, row.data)) reloadAfterInit = setLocal(row.data, false) || reloadAfterInit;
    }).then(function () {
      ready = true;
      subscribe();
      if (dirty) {
        setStatus(navigator.onLine ? "saving" : "offline");
        return saveNow(0).then(function (ok) {
          if (ok && reloadAfterInit) requestReload(cloudVersion);
          return ok;
        });
      }
      setStatus("online");
      if (reloadAfterInit) requestReload(cloudVersion);
    }).catch(function (err) {
      ready = true;
      var mine = localData();
      if (cachedBase && mine && !equal(mine, cachedBase)) markDirty(true);
      setStatus(navigator.onLine ? "error" : "offline", err);
    });
  }

  Storage.prototype.setItem = function (key, value) {
    var previous = (this === localStorage && key === DATA_KEY) ? get(DATA_KEY) : null;
    nativeSet.call(this, key, value);
    if (this === localStorage && key === DATA_KEY && !applying) {
      var before = parseData(previous);
      var after = parseData(value);
      // The app writes its state during startup. Do not save when the value is semantically unchanged.
      if (!before || !after || !equal(before, after)) scheduleSave();
    }
  };

  function css() {
    if (document.getElementById("s97-cloud-css")) return;
    var s = document.createElement("style");
    s.id = "s97-cloud-css";
    s.textContent = [
      ".s97-cloud-gate{position:fixed;inset:0;z-index:1000;background:#0A0D07;color:#F3F3E9;font-family:Manrope,system-ui,sans-serif;display:grid;place-items:center;padding:22px}",
      ".s97-cloud-card{width:min(430px,100%);background:#181C13;border:1px solid rgba(228,238,205,.18);border-radius:24px;padding:24px;box-shadow:0 24px 80px rgba(0,0,0,.55)}",
      ".s97-cloud-brand{font-family:Fraunces,serif;font-size:29px;font-weight:650;margin:0}.s97-cloud-sub{color:#B7BCA6;font-size:13px;line-height:1.55;margin:7px 0 18px}",
      ".s97-cloud-label{display:block;color:#B7BCA6;font-size:12px;font-weight:750;margin:12px 0 5px}.s97-cloud-input{width:100%;min-height:45px;background:#0F1309;border:1px solid rgba(228,238,205,.18);border-radius:11px;padding:11px 12px;color:#F3F3E9;font-size:14px;outline:none}.s97-cloud-input:focus{border-color:#62DBA2;box-shadow:0 0 0 3px rgba(98,219,162,.18)}",
      ".s97-cloud-actions{display:flex;gap:9px;margin-top:16px;flex-wrap:wrap}.s97-cloud-btn{flex:1;min-width:135px;min-height:44px;border-radius:12px;border:1px solid rgba(228,238,205,.18);font-weight:800;font-size:13px;cursor:pointer;background:transparent;color:#F3F3E9}.s97-cloud-btn.primary{background:linear-gradient(180deg,#62DBA2,#2FA774);color:#0B1710;border:0}",
      ".s97-cloud-msg{min-height:20px;margin-top:12px;color:#EFBE58;font-size:12.5px;line-height:1.45}.s97-cloud-fine{margin-top:13px;padding-top:13px;border-top:1px solid rgba(228,238,205,.11);color:#8B917B;font-size:11.5px;line-height:1.5}",
      ".s97-cloud-fab{position:fixed;z-index:58;left:max(16px,calc(50% - 244px));bottom:calc(80px + env(safe-area-inset-bottom));width:46px;height:46px;border-radius:50%;background:#212717;border:1px solid rgba(228,238,205,.18);color:#B7BCA6;display:grid;place-items:center;box-shadow:0 8px 20px -10px rgba(0,0,0,.8);cursor:pointer}.s97-cloud-dot{position:absolute;top:-2px;right:-2px;width:12px;height:12px;border-radius:50%;border:2px solid #0A0D07;background:#8B917B}.s97-cloud-dot.online{background:#62DBA2}.s97-cloud-dot.saving,.s97-cloud-dot.loading,.s97-cloud-dot.reconnecting{background:#EFBE58}.s97-cloud-dot.error,.s97-cloud-dot.offline{background:#F4726B}",
      ".s97-cloud-back{position:fixed;inset:0;z-index:900;background:rgba(5,7,4,.72);backdrop-filter:blur(4px);display:flex;align-items:flex-end;justify-content:center}.s97-cloud-modal{width:100%;max-width:520px;background:#0F1309;border:1px solid rgba(228,238,205,.18);border-radius:25px 25px 0 0;padding:18px 18px calc(20px + env(safe-area-inset-bottom));color:#F3F3E9;font-family:Manrope,system-ui,sans-serif}.s97-cloud-modal h3{font-family:Fraunces,serif;margin:2px 0 4px;font-size:20px}.s97-cloud-modal p{color:#B7BCA6;font-size:13px;line-height:1.5}.s97-cloud-x{float:right;width:32px;height:32px;border-radius:50%;border:1px solid rgba(228,238,205,.12);background:#212717;color:#B7BCA6}.s97-cloud-row{display:flex;gap:9px;flex-wrap:wrap;margin-top:12px}.s97-cloud-meta{padding:11px 12px;background:#181C13;border:1px solid rgba(228,238,205,.11);border-radius:13px;font-size:12px;color:#B7BCA6;line-height:1.6}.s97-cloud-meta b{color:#F3F3E9}.s97-cloud-error{color:#F4726B;word-break:break-word}",
      "@media(min-width:560px){.s97-cloud-back{align-items:center;padding:16px}.s97-cloud-modal{border-radius:25px}}"
    ].join("");
    document.head.appendChild(s);
  }
  function showGate() {
    css();
    if (document.getElementById("s97-cloud-gate")) return;
    var gate = document.createElement("div");
    gate.id = "s97-cloud-gate";
    gate.className = "s97-cloud-gate";
    gate.innerHTML = '<div class="s97-cloud-card"><h1 class="s97-cloud-brand">97 LIVE</h1><div class="s97-cloud-sub">Your live finance sheet is private. Sign in with the same account on your phone and computer; both devices will use one cloud copy.</div><label class="s97-cloud-label">Email</label><input id="s97-cloud-email" class="s97-cloud-input" type="email" autocomplete="email" placeholder="you@example.com"><label class="s97-cloud-label">Password</label><input id="s97-cloud-password" class="s97-cloud-input" type="password" autocomplete="current-password" placeholder="At least 6 characters"><div class="s97-cloud-actions"><button class="s97-cloud-btn primary" data-cloud-action="signin">Sign in</button><button class="s97-cloud-btn" data-cloud-action="signup">Create account</button></div><div id="s97-cloud-gate-msg" class="s97-cloud-msg"></div><div class="s97-cloud-fine">The public Supabase key in this website cannot read your data by itself. Database Row Level Security requires your signed-in user ID for every read and write.</div></div>';
    document.body.appendChild(gate);
    gate.addEventListener("click", function (e) {
      var b = e.target.closest("[data-cloud-action]");
      if (!b) return;
      var email = (document.getElementById("s97-cloud-email") || {}).value || "";
      var password = (document.getElementById("s97-cloud-password") || {}).value || "";
      email = email.trim();
      if (!email || !password) { gateMessage("Enter your email and password."); return; }
      b.disabled = true;
      gateMessage(b.dataset.cloudAction === "signup" ? "Creating your account…" : "Signing in…");
      var promise = b.dataset.cloudAction === "signup"
        ? client.auth.signUp({ email: email, password: password, options: { emailRedirectTo: location.origin + location.pathname } })
        : client.auth.signInWithPassword({ email: email, password: password });
      promise.then(function (res) {
        if (res.error) throw res.error;
        if (b.dataset.cloudAction === "signup" && !res.data.session) gateMessage("Account created. Check your email to confirm it, then return here and sign in.");
        else gateMessage("Signed in. Loading your cloud sheet…");
      }).catch(function (err) {
        gateMessage(String(err.message || err));
      }).finally(function () { b.disabled = false; });
    });
  }
  function hideGate() {
    var gate = document.getElementById("s97-cloud-gate");
    if (gate) gate.remove();
  }
  function gateMessage(msg) {
    var el = document.getElementById("s97-cloud-gate-msg");
    if (el) el.textContent = msg || "";
  }
  function renderGateMessage() {
    if (status === "error" && lastError) gateMessage(lastError);
  }
  function renderLauncher() {
    css();
    if (!launcher) {
      launcher = document.createElement("button");
      launcher.className = "s97-cloud-fab";
      launcher.title = "Cloud sync";
      launcher.setAttribute("aria-label", "Cloud sync");
      launcher.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg><span class="s97-cloud-dot"></span>';
      launcher.addEventListener("click", openPanel);
      document.body.appendChild(launcher);
    }
    var dot = launcher.querySelector(".s97-cloud-dot");
    dot.className = "s97-cloud-dot " + status;
  }
  function statusText() {
    if (!session) return "Sign in required";
    if (status === "saving") return "Saving to cloud…";
    if (status === "offline") return "Offline — changes are queued";
    if (status === "reconnecting") return "Realtime reconnecting…";
    if (status === "loading") return "Loading cloud copy…";
    if (status === "error") return "Sync needs attention";
    return "Online · all changes saved";
  }
  function openPanel() {
    css();
    if (document.getElementById("s97-cloud-modal")) return;
    var back = document.createElement("div");
    back.className = "s97-cloud-back";
    back.id = "s97-cloud-modal";
    back.innerHTML = '<div class="s97-cloud-modal"><button class="s97-cloud-x">✕</button><div class="s97-cloud-body"></div></div>';
    document.body.appendChild(back);
    renderPanel();
    back.addEventListener("mousedown", function (e) { if (e.target === back) back.remove(); });
    back.addEventListener("click", function (e) {
      if (e.target.classList.contains("s97-cloud-x")) { back.remove(); return; }
      var b = e.target.closest("[data-cloud-panel]");
      if (!b) return;
      var action = b.dataset.cloudPanel;
      if (action === "sync") { dirty = dirty || !equal(localData(), cloudData); saveNow(0).then(function () { return pull(true); }); }
      if (action === "rename") {
        var n = prompt("Name this device:", deviceName());
        if (n !== null && n.trim()) { put("ns97.cloud.device", n.trim().slice(0, 40)); renderPanel(); }
      }
      if (action === "signout") client.auth.signOut();
    });
  }
  function renderPanel() {
    var body = document.querySelector("#s97-cloud-modal .s97-cloud-body");
    if (!body) return;
    var email = session && session.user ? session.user.email : "Not signed in";
    body.innerHTML = '<h3>Cloud Sync</h3><p>' + esc(statusText()) + '</p><div class="s97-cloud-meta"><b>Account:</b> ' + esc(email) + '<br><b>Device:</b> ' + esc(deviceName()) + '<br><b>Cloud version:</b> ' + esc(cloudVersion || "—") + '<br><b>Last committed:</b> ' + esc(relativeTime(cloudUpdatedAt)) + '<br><b>Engine:</b> ' + ENGINE + (lastError ? '<br><span class="s97-cloud-error">' + esc(lastError) + '</span>' : '') + '</div><div class="s97-cloud-row"><button class="s97-cloud-btn primary" data-cloud-panel="sync">Sync now</button><button class="s97-cloud-btn" data-cloud-panel="rename">Rename device</button></div>' + (session ? '<div class="s97-cloud-row"><button class="s97-cloud-btn" data-cloud-panel="signout">Sign out</button></div>' : '');
  }

  function wake() {
    if (pendingReload && idle()) { pendingReload = false; location.reload(); return; }
    if (!session || !navigator.onLine) return;
    if (dirty) saveNow(0).then(function () { return pull(true); });
    else pull(true);
  }
  function cleanupOldSyncSecrets() {
    ["ns97.sync.token", "ns97.sync.gist", "ns97.sync.code", "ns97.sync.on", "ns97.sync.etag"].forEach(remove);
  }
  function boot() {
    css();
    cleanupOldSyncSecrets();
    renderLauncher();
    loadSDK().then(function () {
      createClient();
      return client.auth.getSession();
    }).then(function (res) {
      if (res.error) throw res.error;
      return initializeSession(res.data.session).then(function () {
        client.auth.onAuthStateChange(function (event, nextSession) {
          if (event === "TOKEN_REFRESHED") { session = nextSession; return; }
          var oldId = session && session.user ? session.user.id : null;
          var newId = nextSession && nextSession.user ? nextSession.user.id : null;
          if (oldId === newId && event !== "SIGNED_OUT") return;
          initializeSession(nextSession);
        });
      });
    }).catch(function (err) {
      showGate();
      setStatus("error", err);
    });

    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("pageshow", wake);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") wake(); });
    setInterval(function () { if (session && navigator.onLine) wake(); }, REPAIR_INTERVAL);
    try {
      window.__s97cloud = function () {
        return { engine: ENGINE, status: status, ready: ready, dirty: dirty, saving: saving, version: cloudVersion, user: session && session.user ? session.user.email : null, error: lastError };
      };
    } catch (_) {}
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
