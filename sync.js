/* 97 LIVE — Supabase Cloud Sync
   Supabase/Postgres is the source of truth. Browser storage is an offline cache.
   Saves use optimistic version checks; conflicts are merged and retried.

   Every network step has a deadline, so a stalled connection surfaces as an error
   that retries itself instead of a spinner that never ends. Realtime pushes changes
   from other devices; a version check (a few bytes) catches anything realtime missed,
   on every (re)subscribe, on resume, and on a slow heartbeat. The whole document is
   only downloaded when that version has actually moved.
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
  // Where supabase-js keeps the signed-in session (its default storage key for this project).
  var AUTH_KEY = "sb-" + URL.split("//")[1].split(".")[0] + "-auth-token";
  var SAVE_DELAY = 650;
  var REQUEST_TIMEOUT = 15000;   // one Supabase request, including the SDK's own retries
  var SDK_TIMEOUT = 20000;       // downloading the Supabase library
  var CHECK_INTERVAL = 30000;    // how often a visible page looks for something to repair
  var HEARTBEAT = 300000;        // confirm the cloud version this often even when all looks healthy
  var RETRY_BASE = 3500;         // first retry after a failure; doubles up to RETRY_CAP
  var RETRY_CAP = 60000;
  var MAX_RETRIES = 4;

  var nativeSet = Storage.prototype.setItem;
  var nativeRemove = Storage.prototype.removeItem;
  var client = null;
  var booted = false;        // the library is loaded and we know whether anyone is signed in
  var booting = null;
  var authWatched = false;
  var session = null;
  var generation = 0;        // bumps on every sign-in change; late answers for an older session are ignored
  var channel = null;
  var realtimeUp = false;
  var ready = false;         // this session's cloud copy has been loaded
  var loading = null;
  var applying = false;
  var dirty = false;
  var saving = false;
  var savePromise = null;
  var pulling = null;
  var recheck = false;       // a pull was asked for while another sync step was running
  var saveTimer = null;
  var retryTimer = null;
  var retryDelay = 0;
  var lastSync = 0;          // last time the server confirmed our view of the cloud copy
  var pendingReload = false;
  var reloadWanted = false;  // a conflict merge changed this device's copy underneath the running app
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
    // Open sheets and panels hold unsaved input or send progress; a reload would throw it away.
    if (document.querySelector(".backdrop, #s97-cloud-modal, #x97-sheet, #x97-remind, #x97-msg, #x97-camp")) return false;
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
    // "online" means everything is saved and current, so any pending retry is moot.
    if (next === "online") resetRetry();
    renderLauncher();
    renderPanel();
    renderGateMessage();
  }
  function resetRetry() {
    retryDelay = 0;
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  // Back off exponentially while a failure persists, so a lasting problem (bad
  // credentials, a rejected write) doesn't turn into a request every few seconds.
  function scheduleRetry() {
    retryDelay = retryDelay ? Math.min(retryDelay * 2, RETRY_CAP) : RETRY_BASE;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(function () { retryTimer = null; wake(); }, retryDelay);
  }
  function synced() {
    lastSync = Date.now();
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

  function timeoutError(what) {
    var err = new Error(what + " timed out. Check your connection — sync will retry automatically.");
    err.name = "TimeoutError";
    return err;
  }
  // Settle within ms or reject; onExpire cancels whatever was still running.
  function deadline(promise, ms, what, onExpire) {
    var timer;
    var expired = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        reject(timeoutError(what));
        if (onExpire) onExpire();
      }, ms);
    });
    return Promise.race([promise, expired]).finally(function () { clearTimeout(timer); });
  }
  // Run one Supabase query under a deadline, aborting the fetch if it passes. The
  // client reports failures in res.error instead of rejecting; this turns them into
  // rejections so every caller has a single failure path.
  function request(query, what) {
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    if (controller && typeof query.abortSignal === "function") query.abortSignal(controller.signal);
    return deadline(Promise.resolve(query), REQUEST_TIMEOUT, what, function () {
      if (controller) controller.abort();
    }).then(function (res) {
      if (res && res.error) throw res.error;
      return res;
    });
  }

  function loadSDK() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve();
    // A tag left by an earlier attempt that failed or stalled can't be trusted to fire; start clean.
    var stale = document.querySelector("script[data-s97-supabase]");
    if (stale) stale.remove();
    var s = document.createElement("script");
    var loaded = new Promise(function (resolve, reject) {
      s.src = SDK_URL;
      s.async = true;
      s.dataset.s97Supabase = "1";
      s.onload = function () {
        if (window.supabase && window.supabase.createClient) resolve();
        else reject(new Error("The sync service loaded incompletely"));
      };
      s.onerror = function () { reject(new Error("Could not load the sync service")); };
      document.head.appendChild(s);
    });
    return deadline(loaded, SDK_TIMEOUT, "Loading the sync service", function () { s.remove(); });
  }
  function createClient() {
    client = window.supabase.createClient(URL, PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 10 } }
    });
  }
  function fetchDocument() {
    if (!session) return Promise.resolve(null);
    return request(client.from("finance_documents")
      .select("owner_id,data,version,updated_at")
      .eq("owner_id", session.user.id)
      .maybeSingle(), "Loading the cloud copy")
      .then(function (res) {
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
  // The cloud version alone: a few bytes, against a document that can be large.
  // Resolves to the version number, or null when there is no cloud row.
  function fetchVersion() {
    return request(client.from("finance_documents")
      .select("version")
      .eq("owner_id", session.user.id)
      .maybeSingle(), "Checking for changes")
      .then(function (res) {
        return res.data ? Number(res.data.version) || 0 : null;
      });
  }
  function insertFirst(data) {
    return request(client.from("finance_documents")
      .insert({ owner_id: session.user.id, data: data, version: 1 })
      .select("data,version,updated_at")
      .single(), "Creating the cloud copy")
      .then(function (res) {
        return { data: parseData(res.data.data), version: Number(res.data.version) || 1, updated_at: res.data.updated_at };
      });
  }
  function conditionalUpdate(data, expected) {
    return request(client.from("finance_documents")
      .update({ data: data, version: expected + 1, updated_at: new Date().toISOString() })
      .eq("owner_id", session.user.id)
      .eq("version", expected)
      .select("data,version,updated_at")
      .maybeSingle(), "Saving to the cloud")
      .then(function (res) {
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
    saveTimer = setTimeout(function () { saveNow(); }, delay == null ? SAVE_DELAY : delay);
    setStatus(navigator.onLine ? "saving" : "offline");
  }
  // One save at a time. A save asked for while another is running shares its
  // result; whatever changed on this device meanwhile goes up in a follow-up
  // save, so an edit made mid-save is never dropped.
  function saveNow() {
    if (!ready || !session || applying) return Promise.resolve(false);
    if (savePromise) return savePromise;
    if (!navigator.onLine) {
      markDirty(true);
      setStatus("offline");
      return Promise.resolve(false);
    }
    var gen = generation;
    saving = true;
    var run = savePromise = attemptSave(0, gen).catch(function (err) {
      if (gen !== generation) return false;
      markDirty(true);
      setStatus(navigator.onLine ? "error" : "offline", err);
      scheduleRetry();
      return false;
    }).then(function (ok) {
      if (savePromise !== run) return ok;   // the account changed while this was running
      saving = false;
      savePromise = null;
      if (ok && reloadWanted) {
        reloadWanted = false;
        requestReload(cloudVersion);
      }
      if (ok && dirty) return saveNow();
      settle();
      return ok;
    });
    return run;
  }
  function unreadable() {
    return new Error("This device's copy of the sheet can't be read, so it wasn't saved.");
  }
  function attemptSave(attempt, gen) {
    var mine = localData();
    if (!mine) return Promise.reject(unreadable());
    if (cloudData && equal(mine, cloudData)) {
      markDirty(false);
      setStatus("online");
      return Promise.resolve(true);
    }
    setStatus("saving");
    return (cloudVersion === 0 ? insertFirst(mine) : conditionalUpdate(mine, cloudVersion))
      .then(function (saved) {
        if (gen !== generation) return false;
        if (!saved) return resolveConflict(attempt, gen);
        if (!saved.data) throw new Error("The server returned incomplete data");
        rememberCloud(saved);
        synced();
        // Still dirty only if this device changed again while the save was in flight.
        markDirty(!equal(localData(), mine));
        if (!dirty) setStatus("online");
        return true;
      }, function (err) {
        if (gen !== generation) return false;
        var conflict = String(err && err.code || "") === "23505" || /duplicate key|version_conflict/i.test(String(err && err.message || err));
        if (!conflict) throw err;
        return resolveConflict(attempt, gen);
      });
  }
  function resolveConflict(attempt, gen) {
    if (attempt >= MAX_RETRIES) return Promise.reject(new Error("Another device is changing the sheet continuously. Please try again."));
    return fetchDocument().then(function (latest) {
      if (gen !== generation) return false;
      if (!latest) {
        cloudData = null;
        cloudVersion = 0;
        return attemptSave(attempt + 1, gen);
      }
      // Merge what is on this device now, not what the failed attempt sent:
      // anything edited while that request was in flight must survive the merge.
      var mine = localData();
      if (!mine) throw unreadable();
      var merged = merge3(cloudData || parseData(get(BASE_KEY)) || {}, mine, latest.data);
      rememberCloud(latest);
      synced();
      if (!equal(merged, mine)) {
        applying = true;
        put(DATA_KEY, JSON.stringify(merged));
        applying = false;
        reloadWanted = true;
      }
      markDirty(!equal(merged, latest.data));
      return attemptSave(attempt + 1, gen);
    });
  }

  var UNCHANGED = {};
  // Bring this device up to date with the cloud. Unless forced, ask for the version
  // first and download the document only if it moved. Overlapping requests share
  // one round trip; one that arrives while a save is running is deferred until the
  // save settles, never dropped.
  function pull(force) {
    if (!ready || !session || !navigator.onLine) return Promise.resolve(false);
    if (saving) { recheck = true; return Promise.resolve(false); }
    if (pulling) {
      // A forced pull (a realtime change) may be newer than what is in flight: look again after.
      if (force) recheck = true;
      return pulling;
    }
    var gen = generation;
    var startVersion = cloudVersion;
    var fetched = force ? fetchDocument() : fetchVersion().then(function (version) {
      if (version === null) return null;
      return version === cloudVersion ? UNCHANGED : fetchDocument();
    });
    var run = pulling = fetched.then(function (row) {
      if (gen !== generation) return false;
      if (row === UNCHANGED) return confirmCurrent();
      if (!row) return false;
      // A save started while this was downloading; its outcome supersedes this copy.
      if (saving) { recheck = true; return false; }
      // A save already committed past this copy; applying it would step backwards.
      if (cloudVersion !== startVersion && row.version <= cloudVersion) return true;
      synced();
      return applyPulled(row, force);
    }).catch(function (err) {
      if (gen !== generation) return false;
      setStatus(navigator.onLine ? "error" : "offline", err);
      scheduleRetry();
      return false;
    }).then(function (result) {
      if (pulling === run) pulling = null;
      settle();
      return result;
    });
    return run;
  }
  // Run a pull that was asked for while a save or another pull was busy.
  function settle() {
    if (!recheck || saving || pulling) return;
    recheck = false;
    pull(false);
  }
  // The cloud has nothing newer. Send anything this device changed without
  // it being flagged, then report healthy.
  function confirmCurrent() {
    synced();
    var mine = localData();
    if (dirty || (mine && cloudData && !equal(mine, cloudData))) {
      markDirty(true);
      return saveNow();
    }
    setStatus("online");
    return true;
  }
  function applyPulled(row, force) {
    if (!force && row.version === cloudVersion) return confirmCurrent();
    var mine = localData();
    if (!mine) {
      rememberCloud(row);
      markDirty(false);
      setStatus("online");
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
        return saveNow().then(function (ok) {
          if (ok && changedLocal) requestReload(cloudVersion);
          return ok;
        });
      }
      setStatus("online");
      if (changedLocal) requestReload(row.version);
      return true;
    }
    rememberCloud(row);
    markDirty(false);
    setStatus("online");
    if (!equal(mine, row.data)) setLocal(row.data, true);
    return true;
  }

  function subscribe() {
    var old = channel;
    channel = null;
    realtimeUp = false;
    if (old && client) client.removeChannel(old);
    if (!session) return;
    var gen = generation;
    var ch = channel = client.channel("97-live-" + session.user.id);
    ch.on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "finance_documents",
        filter: "owner_id=eq." + session.user.id
      }, function (payload) {
        if (gen !== generation) return;
        var nextVersion = payload && payload.new ? Number(payload.new.version) || 0 : 0;
        if (!nextVersion || nextVersion > cloudVersion) pull(true);
      })
      .subscribe(function (state) {
        if (ch !== channel) return;   // a replaced channel reporting late
        if (state === "SUBSCRIBED") {
          realtimeUp = true;
          if (status === "reconnecting") setStatus("online");
          // Changes committed while the channel was down, or before it first
          // joined, never arrive as events. Catch up on every (re)subscribe.
          pull(false);
        } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
          realtimeUp = false;
          if (status === "online") setStatus("reconnecting");
        }
      });
  }

  function initializeSession(nextSession) {
    generation++;
    session = nextSession || null;
    ready = false;
    loading = null;
    saving = false;
    savePromise = null;
    pulling = null;
    recheck = false;
    clearTimeout(saveTimer);
    resetRetry();
    if (!session) {
      cloudData = null;
      cloudVersion = 0;
      subscribe();
      showGate();
      setStatus("signin");
      return Promise.resolve();
    }
    hideGate();
    return loadCloud();
  }

  var STALE = {};
  // Load this session's cloud copy and reconcile it with what is on the device.
  // Until this succeeds nothing is saved: a save needs a known cloud base to be
  // merged safely. A failed load retries itself (see scheduleRetry and wake).
  function loadCloud() {
    if (loading) return loading;
    var gen = generation;
    function current() { if (gen !== generation) throw STALE; }
    setStatus("loading");

    var cachedBase = parseData(get(BASE_KEY));
    var cachedVersion = Number(get(VERSION_KEY)) || 0;
    var hadQueuedChanges = get(DIRTY_KEY) === "1";
    var reloadAfterInit = false;
    if (cachedBase) {
      cloudData = clone(cachedBase);
      cloudVersion = cachedVersion;
    }

    var run = loading = fetchDocument().then(function (row) {
      current();
      var mine = localData();
      if (!row) {
        if (!mine) throw new Error("This device has no valid finance data to upload");
        return insertFirst(mine).then(function (created) {
          current();
          rememberCloud(created);
          markDirty(false);
        }).catch(function (err) {
          current();
          if (String(err.code || "") === "23505") return fetchDocument().then(function (existing) {
            current();
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
      current();
      ready = true;
      synced();
      subscribe();
      if (dirty) {
        setStatus(navigator.onLine ? "saving" : "offline");
        return saveNow().then(function (ok) {
          if (ok && reloadAfterInit) requestReload(cloudVersion);
          return ok;
        });
      }
      setStatus("online");
      if (reloadAfterInit) requestReload(cloudVersion);
    }).catch(function (err) {
      if (err === STALE || gen !== generation) return;
      var mine = localData();
      if (cachedBase && mine && !equal(mine, cachedBase)) markDirty(true);
      setStatus(navigator.onLine ? "error" : "offline", err);
      scheduleRetry();
    }).then(function () {
      if (loading === run) loading = null;
    });
    return run;
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

  function showGate() {
    if (document.getElementById("s97-cloud-gate")) return;
    var gate = document.createElement("div");
    gate.id = "s97-cloud-gate";
    gate.className = "s97-cloud-gate";
    gate.innerHTML = '<div class="s97-cloud-card"><h1 class="s97-cloud-brand"><img src="./icons/mark-97.png" alt="97" class="s97-brand-mark">LIVE</h1><div class="s97-cloud-sub">Your live finance sheet is private. Sign in with the same account on your phone and computer; both devices will use one cloud copy.</div><label class="s97-cloud-label" for="s97-cloud-email">Email</label><input id="s97-cloud-email" class="s97-cloud-input" type="email" autocomplete="email" placeholder="you@example.com"><label class="s97-cloud-label" for="s97-cloud-password">Password</label><input id="s97-cloud-password" class="s97-cloud-input" type="password" autocomplete="current-password" placeholder="At least 6 characters"><div class="s97-cloud-actions"><button class="s97-cloud-btn primary" data-cloud-action="signin">Sign in</button><button class="s97-cloud-btn" data-cloud-action="signup">Create account</button></div><div id="s97-cloud-gate-msg" class="s97-cloud-msg"></div><div class="s97-cloud-fine">Use the same account on every device to keep your workspace in sync.</div></div>';
    document.body.appendChild(gate);
    gate.addEventListener("click", function (e) {
      var b = e.target.closest("[data-cloud-action]");
      if (!b) return;
      var email = (document.getElementById("s97-cloud-email") || {}).value || "";
      var password = (document.getElementById("s97-cloud-password") || {}).value || "";
      email = email.trim();
      if (!email || !password) { gateMessage("Enter your email and password."); return; }
      if (!client) {
        // The sync service never finished loading (see bootFailed). Try again now.
        gateMessage("Connecting to the sync service… try again in a moment.");
        start();
        return;
      }
      b.disabled = true;
      var signup = b.dataset.cloudAction === "signup";
      gateMessage(signup ? "Creating your account…" : "Signing in…");
      var promise = signup
        ? client.auth.signUp({ email: email, password: password, options: { emailRedirectTo: location.origin + location.pathname } })
        : client.auth.signInWithPassword({ email: email, password: password });
      deadline(promise, REQUEST_TIMEOUT, signup ? "Creating your account" : "Signing in").then(function (res) {
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
  function gateMessage(msg, fromStatus) {
    var el = document.getElementById("s97-cloud-gate-msg");
    if (!el) return;
    el.textContent = msg || "";
    if (fromStatus) el.dataset.fromStatus = "1";
    else delete el.dataset.fromStatus;
  }
  // Mirror sync problems into the sign-in screen, and clear them once they pass,
  // without overwriting what the person just did ("Signing in…").
  function renderGateMessage() {
    var el = document.getElementById("s97-cloud-gate-msg");
    if (!el) return;
    if ((status === "error" || status === "offline") && lastError) gateMessage(lastError, true);
    else if (el.dataset.fromStatus) gateMessage("");
  }
  function renderLauncher() {
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
    var label = "Cloud sync: " + statusText();
    launcher.title = label;
    launcher.setAttribute("aria-label", label);
  }
  function statusText() {
    if (!booted) {
      if (status === "offline") return "Offline — changes stay on this device";
      if (status === "error") return "Can't reach the cloud — retrying";
      return "Connecting…";
    }
    if (!session) return "Sign in required";
    if (status === "saving") return "Saving to cloud…";
    if (status === "offline") return "Offline — changes are queued";
    if (status === "reconnecting") return "Realtime reconnecting…";
    if (status === "loading") return "Loading cloud copy…";
    if (status === "error") return ready ? "Sync needs attention — retrying" : "Can't load the cloud copy — retrying";
    return "Online · all changes saved";
  }
  function openPanel() {
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
      if (action === "sync") syncNow();
      if (action === "rename") {
        var n = prompt("Name this device:", deviceName());
        if (n !== null && n.trim()) { put("ns97.cloud.device", n.trim().slice(0, 40)); renderPanel(); }
      }
      if (action === "signout" && client) client.auth.signOut();
    });
  }
  function renderPanel() {
    var body = document.querySelector("#s97-cloud-modal .s97-cloud-body");
    if (!body) return;
    var email = session && session.user ? session.user.email : "Not signed in";
    body.innerHTML = '<h3>Cloud Sync</h3><p>' + esc(statusText()) + '</p><div class="s97-cloud-meta"><b>Account:</b> ' + esc(email) + '<br><b>Device:</b> ' + esc(deviceName()) + '<br><b>Cloud version:</b> ' + esc(cloudVersion || "—") + '<br><b>Last committed:</b> ' + esc(relativeTime(cloudUpdatedAt)) + '<br><b>Last checked:</b> ' + esc(lastSync ? relativeTime(new Date(lastSync).toISOString()) : "not yet") + '<br><b>Engine:</b> ' + ENGINE + (lastError ? '<br><span class="s97-cloud-error">' + esc(lastError) + '</span>' : '') + '</div><div class="s97-cloud-row"><button class="s97-cloud-btn primary" data-cloud-panel="sync">Sync now</button><button class="s97-cloud-btn" data-cloud-panel="rename">Rename device</button></div>' + (session ? '<div class="s97-cloud-row"><button class="s97-cloud-btn" data-cloud-panel="signout">Sign out</button></div>' : '');
  }

  // Do whatever sync needs right now: finish booting, load the cloud copy,
  // send local changes, or check for remote ones. Safe to call at any time;
  // every step below dedupes itself.
  function wake() {
    if (pendingReload && idle()) { pendingReload = false; location.reload(); return; }
    if (!navigator.onLine) return;
    if (!booted) { start(); return; }
    if (!session) return;
    if (!ready) { loadCloud(); return; }
    // After a failed save the retry schedule owns the next attempt; pulling now
    // would only find the same unsaved change and try it again immediately.
    if (dirty) saveNow().then(function (ok) { if (ok) return pull(false); });
    else pull(false);
  }
  // "Sync now": retry immediately, and download the whole document rather than trusting the version.
  function syncNow() {
    resetRetry();
    if (!navigator.onLine) { setStatus("offline"); return; }
    if (!booted || !session || !ready) { wake(); return; }
    var mine = localData();
    if (mine && !equal(mine, cloudData)) markDirty(true);
    (dirty ? saveNow() : Promise.resolve(true)).then(function (ok) { if (ok) return pull(true); });
  }
  // Runs every CHECK_INTERVAL. A healthy, realtime-connected page does nothing
  // but a version check every HEARTBEAT; a hidden page does nothing at all
  // (resuming it calls wake() directly).
  function check() {
    if (document.visibilityState === "hidden" || !navigator.onLine) return;
    if (booted && !session) return;
    if (!booted || !ready || dirty || pendingReload || status === "error" || !realtimeUp || Date.now() - lastSync >= HEARTBEAT) wake();
  }
  function cleanupOldSyncSecrets() {
    ["ns97.sync.token", "ns97.sync.gist", "ns97.sync.code", "ns97.sync.on", "ns97.sync.etag"].forEach(remove);
  }
  // Load the library and find out who is signed in. Retried until it succeeds.
  function start() {
    if (booted) return Promise.resolve();
    if (booting) return booting;
    setStatus("loading");
    var run = booting = loadSDK().then(function () {
      if (!client) createClient();
      return deadline(client.auth.getSession(), REQUEST_TIMEOUT, "Checking your sign-in");
    }).then(function (res) {
      if (res.error) throw res.error;
      booted = true;
      var loaded = initializeSession(res.data.session);
      watchAuth();
      return loaded;
    }).catch(function (err) {
      bootFailed(err);
    }).then(function () {
      if (booting === run) booting = null;
    });
    return run;
  }
  function watchAuth() {
    if (authWatched) return;
    authWatched = true;
    client.auth.onAuthStateChange(function (event, nextSession) {
      if (event === "TOKEN_REFRESHED") { session = nextSession; return; }
      var oldId = session && session.user ? session.user.id : null;
      var newId = nextSession && nextSession.user ? nextSession.user.id : null;
      if (oldId === newId && event !== "SIGNED_OUT") return;
      initializeSession(nextSession);
    });
  }
  // Without the library we can't tell who is signed in. A device that was signed
  // in keeps working from its local copy while we retry; only a device with no
  // saved sign-in needs the sign-in screen.
  function bootFailed(err) {
    if (!get(AUTH_KEY)) showGate();
    setStatus(navigator.onLine ? "error" : "offline", err);
    scheduleRetry();
  }
  function boot() {
    cleanupOldSyncSecrets();
    renderLauncher();
    start();

    window.addEventListener("online", wake);
    window.addEventListener("offline", function () { if (session || !booted) setStatus("offline"); });
    window.addEventListener("focus", wake);
    window.addEventListener("pageshow", wake);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") wake(); });
    setInterval(check, CHECK_INTERVAL);
    try {
      window.__s97cloud = function () {
        return { engine: ENGINE, status: status, ready: ready, dirty: dirty, saving: saving, version: cloudVersion, user: session && session.user ? session.user.email : null, error: lastError, realtime: realtimeUp, lastSync: lastSync };
      };
    } catch (_) {}
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

/* Load the additive 97 LIVE V2 Premium experience after the existing app and cloud engine. */
(function () {
  function loadExperienceV2() {
    if (document.querySelector('script[data-s97-experience-v2]')) return;
    var script = document.createElement('script');
    script.src = './experience-v2.js?v=27';
    script.defer = true;
    script.dataset.s97ExperienceV2 = '1';
    script.onerror = function () { console.error('97 LIVE V2 Premium experience could not load'); };
    document.head.appendChild(script);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadExperienceV2, { once: true });
  else loadExperienceV2();
})();
