// Run with: node --test tests/sync.test.cjs
// Drive the production cloud-sync engine (sync.js) against a scripted Supabase
// double, a controllable clock and a minimal DOM. No network, no browser, no
// customer data. Each test builds its own world, so they can't leak into each other.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const SYNC = process.env.SYNC_FILE || path.join(__dirname, '../sync.js');
const DATA_KEY = 'ns97-finance-v1';
const AUTH_KEY = 'sb-rytbeijznlqofstfrmwf-auth-token';
const SDK_URL = './vendor/supabase-js-2.117.0.js';
const SEC = 1000, MIN = 60 * SEC;

function doc(items, extra) {
  return Object.assign({
    meta: { appName: '97 LIVE' },
    followups: items.map(([id, amount]) => ({ id, client: 'Client ' + id, amount })),
    balances: [{ id: 'cash', account: 'Cash', balance: 100 }],
    credit: [],
  }, extra || {});
}
const clone = (v) => JSON.parse(JSON.stringify(v));
const flush = () => new Promise((r) => setImmediate(r));

// ---------------------------------------------------------------- clock
function makeClock() {
  let now = Date.parse('2026-09-01T09:00:00Z'), seq = 0;
  const timers = new Map();
  const clock = {
    get now() { return now; },
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { fn, at: now + Math.max(0, ms || 0), every: 0 }); return id; },
    setInterval(fn, ms) { const id = ++seq; timers.set(id, { fn, at: now + ms, every: ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(ms) {
      const end = now + ms;
      await flush();
      for (;;) {
        let id = null, t = null;
        for (const [k, v] of timers) if (v.at <= end && (!t || v.at < t.at || (v.at === t.at && k < id))) { id = k; t = v; }
        if (!t) break;
        now = t.at;
        if (t.every) t.at += t.every; else timers.delete(id);
        t.fn();
        await flush();
      }
      now = end;
      await flush();
    },
  };
  clock.clearInterval = clock.clearTimeout;
  class FakeDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(now); }
    static now() { return now; }
  }
  clock.Date = FakeDate;
  return clock;
}

// ---------------------------------------------------------------- DOM
function makeDom(onAppend) {
  const all = () => { const out = []; const walk = (e) => { out.push(e); e.children.forEach(walk); }; walk(document.head); walk(document.body); return out; };
  function matches(el, simple) {
    if (simple[0] === '#') return el.id === simple.slice(1);
    if (simple[0] === '.') return el.className.split(/\s+/).includes(simple.slice(1));
    const m = /^(\w+)\[data-([\w-]+)\]$/.exec(simple);
    if (m) {
      const key = m[2].replace(/-(\w)/g, (_, c) => c.toUpperCase());
      return el.tagName === m[1].toUpperCase() && el.dataset[key] !== undefined;
    }
    return el.tagName === simple.toUpperCase();
  }
  function query(roots, sel) {
    for (const part of sel.split(',').map((s) => s.trim())) {
      const [outer, inner] = part.split(/\s+/);
      for (const el of roots()) {
        if (!matches(el, outer)) continue;
        if (!inner) return el;
        const walk = (e) => { for (const c of e.children) { if (matches(c, inner)) return c; const f = walk(c); if (f) return f; } return null; };
        const hit = walk(el);
        if (hit) return hit;
      }
    }
    return null;
  }
  function el(tag) {
    const e = {
      tagName: tag.toUpperCase(), children: [], parent: null, id: '', className: '', dataset: {}, attrs: {}, listeners: {},
      value: '', disabled: false, _html: '', _text: '',
      get innerHTML() { return this._html; },
      set innerHTML(html) {
        this._html = html;
        // Flat stubs for every element with an id, class or data attribute: enough to query by them.
        this.children = [];
        for (const m of html.matchAll(/<(\w+)([^>]*)>/g)) {
          const attrs = m[2];
          if (!/\b(id|class|data-[\w-]+)=/.test(attrs)) continue;
          const c = el(m[1]);
          const id = /\bid="([^"]*)"/.exec(attrs); if (id) c.id = id[1];
          const cls = /\bclass="([^"]*)"/.exec(attrs); if (cls) c.className = cls[1];
          for (const d of attrs.matchAll(/\bdata-([\w-]+)="([^"]*)"/g)) c.dataset[d[1].replace(/-(\w)/g, (_, x) => x.toUpperCase())] = d[2];
          c.parent = this;
          this.children.push(c);
        }
      },
      get textContent() { return this._text; },
      set textContent(v) { this._text = String(v); },
      setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); },
      getAttribute(k) { return this.attrs[k]; },
      addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
      appendChild(c) { c.parent = this; this.children.push(c); onAppend(c); return c; },
      remove() { if (this.parent) { this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; } },
      querySelector(sel) { return query(() => { const out = []; const walk = (x) => { x.children.forEach((c) => { out.push(c); walk(c); }); }; walk(this); return out; }, sel); },
      closest() { return null; },
      get classList() { const self = this; return { contains: (c) => self.className.split(/\s+/).includes(c), add() {}, remove() {} }; },
      style: { setProperty() {} },
    };
    return e;
  }
  const listeners = {};
  const document = {
    readyState: 'complete', visibilityState: 'visible', activeElement: null,
    head: el('head'), body: el('body'),
    createElement: el,
    getElementById: (id) => all().find((e) => e.id === id) || null,
    querySelector: (sel) => query(all, sel),
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    dispatch(type) { (listeners[type] || []).forEach((fn) => fn({ type })); },
  };
  return document;
}

// ---------------------------------------------------------------- Supabase double
// Requests commit at the moment they are sent; `delay` only slows the answer
// (a slow network), `hang` means the request never reached the server.
function makeSupabase(clock, world) {
  const F = {
    row: null, session: { user: { id: 'u1', email: 'owner@example.com' }, access_token: 't' },
    calls: [], hang: {}, delay: {}, fail: {}, channels: [], authListeners: [], clients: 0,
    getSessionHang: false, echo: true,
  };
  const stamp = () => new clock.Date().toISOString();
  function commit() {
    if (!F.echo) return;
    const version = F.row.version;
    for (const ch of F.channels) if (!ch.removed && ch.handler) Promise.resolve().then(() => ch.handler({ new: { version } }));
  }
  function answer(b, kind) {
    if (F.fail[kind]) return { data: null, error: F.fail[kind] };
    if (kind === 'version') return { data: F.row ? { version: F.row.version } : null, error: null };
    if (kind === 'select') return { data: F.row ? clone(F.row) : null, error: null };
    if (kind === 'insert') {
      if (F.row) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      F.row = { owner_id: b.payload.owner_id, data: clone(b.payload.data), version: b.payload.version, updated_at: stamp() };
      commit();
      return { data: clone(F.row), error: null };
    }
    if (!F.row || F.row.version !== b.filters.version) return { data: null, error: null };
    F.row = { owner_id: F.row.owner_id, data: clone(b.payload.data), version: b.payload.version, updated_at: b.payload.updated_at };
    commit();
    return { data: clone(F.row), error: null };
  }
  class Query {
    constructor() { this.op = 'select'; this.filters = {}; this.signal = null; }
    select(cols) { this.cols = cols; return this; }
    insert(p) { this.op = 'insert'; this.payload = p; return this; }
    update(p) { this.op = 'update'; this.payload = p; return this; }
    eq(k, v) { this.filters[k] = v; return this; }
    maybeSingle() { return this; }
    single() { return this; }
    abortSignal(s) { this.signal = s; return this; }
    then(ok, bad) {
      const kind = this.op === 'select' ? (this.cols === 'version' ? 'version' : 'select') : this.op;
      const call = { kind, at: clock.now, filters: clone(this.filters), payload: this.payload ? clone(this.payload) : null, withSignal: !!this.signal, aborted: false };
      F.calls.push(call);
      const p = new Promise((resolve) => {
        if (this.signal) this.signal.addEventListener('abort', () => {
          call.aborted = true;
          resolve({ data: null, error: { message: 'AbortError: signal is aborted without reason', code: '' } });
        });
        if (F.hang[kind]) return;
        const res = answer(this, kind);
        if (F.delay[kind]) clock.setTimeout(() => resolve(res), F.delay[kind]);
        else resolve(res);
      });
      return p.then(ok, bad);
    }
  }
  class Channel {
    on(type, filter, handler) { this.filter = filter; this.handler = handler; return this; }
    subscribe(cb) { this.cb = cb; F.channels.push(this); Promise.resolve().then(() => { if (!this.removed && F.realtime !== false) cb('SUBSCRIBED'); }); return this; }
  }
  F.live = () => F.channels.filter((c) => !c.removed);
  F.realtimeState = (state) => F.live().forEach((c) => c.cb(state));
  // Another device commits a change.
  F.remote = (mutate) => { const data = clone(F.row.data); mutate(data); F.row = { ...F.row, data, version: F.row.version + 1, updated_at: stamp() }; commit(); };
  F.count = (kind) => F.calls.filter((c) => c.kind === kind).length;
  F.module = {
    createClient() {
      F.clients++;
      return {
        from: () => new Query(),
        channel: () => new Channel(),
        removeChannel(ch) { ch.removed = true; if (ch.cb) ch.cb('CLOSED'); return Promise.resolve('ok'); },
        auth: {
          getSession() {
            F.calls.push({ kind: 'getSession', at: clock.now });
            if (F.getSessionHang) return new Promise(() => {});
            return Promise.resolve({ data: { session: F.session }, error: null });
          },
          onAuthStateChange(cb) {
            F.authListeners.push(cb);
            Promise.resolve().then(() => cb('INITIAL_SESSION', F.session));
            return { data: { subscription: { unsubscribe() {} } } };
          },
          signInWithPassword() { F.calls.push({ kind: 'signIn' }); return new Promise(() => {}); },
          signUp() { return new Promise(() => {}); },
          signOut() { F.session = null; F.authListeners.forEach((cb) => cb('SIGNED_OUT', null)); return Promise.resolve({ error: null }); },
        },
      };
    },
  };
  return F;
}

// ---------------------------------------------------------------- world
// opts.local / opts.base / opts.version seed this device; opts.sdk = 'ready' | 'hang' | 'error'.
function world(opts = {}) {
  const clock = makeClock();
  const store = new Map();
  if (opts.local) store.set(DATA_KEY, JSON.stringify(opts.local));
  if (opts.base) store.set('ns97.cloud.base', JSON.stringify(opts.base));
  if (opts.version) store.set('ns97.cloud.version', String(opts.version));
  if (opts.signedIn !== false) store.set(AUTH_KEY, '{"access_token":"t"}');
  class Storage {}
  Storage.prototype.getItem = function (k) { return this._m.has(k) ? this._m.get(k) : null; };
  Storage.prototype.setItem = function (k, v) { this._m.set(k, String(v)); };
  Storage.prototype.removeItem = function (k) { this._m.delete(k); };
  const localStorage = Object.create(Storage.prototype);
  localStorage._m = store;

  const w = { clock, store, reloads: 0, redraws: [], sdk: opts.sdk || 'ready' };
  const F = w.supabase = makeSupabase(clock, w);
  if (opts.cloud) F.row = { owner_id: 'u1', data: clone(opts.cloud), version: opts.cloudVersion || 1, updated_at: '2026-09-01T08:00:00Z' };
  const winListeners = {};
  const window = {
    addEventListener(type, fn) { (winListeners[type] = winListeners[type] || []).push(fn); },
    // The app redraws on "s97:data"; record each one so tests can see what was announced.
    dispatchEvent(event) { if (event.type === 's97:data') w.redraws.push(event.detail.reason); (winListeners[event.type] || []).forEach((fn) => fn(event)); return true; },
  };
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }
  const document = makeDom((node) => {
    if (node.tagName !== 'SCRIPT' || node.src !== SDK_URL) return;
    if (w.sdk === 'ready') Promise.resolve().then(() => { window.supabase = F.module; node.onload && node.onload(); });
    else if (w.sdk === 'error') Promise.resolve().then(() => node.onerror && node.onerror());
  });
  if (w.sdk === 'ready' && !opts.sdkLoadsLater) window.supabase = F.module;
  const navigator = { onLine: opts.online !== false, userAgent: 'test' };
  const context = {
    window, document, navigator, localStorage, Storage,
    location: { reload: () => { w.reloads++; }, origin: 'https://app.test', pathname: '/' },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, setInterval: clock.setInterval, clearInterval: clock.clearInterval,
    Date: clock.Date, AbortController, CustomEvent, console, prompt: () => null,
  };
  vm.runInNewContext(fs.readFileSync(SYNC, 'utf8'), context, { filename: SYNC });

  w.window = window; w.document = document; w.navigator = navigator; w.context = context;
  w.fire = (type) => (winListeners[type] || []).forEach((fn) => fn({ type }));
  w.state = () => window.__s97cloud();
  w.local = () => JSON.parse(store.get(DATA_KEY));
  w.edit = (mutate) => { const d = w.local(); mutate(d); localStorage.setItem(DATA_KEY, JSON.stringify(d)); };
  w.advance = (ms) => clock.advance(ms);
  w.hide = () => { document.visibilityState = 'hidden'; document.dispatch('visibilitychange'); };
  w.show = () => { document.visibilityState = 'visible'; document.dispatch('visibilitychange'); };
  w.offline = () => { navigator.onLine = false; w.fire('offline'); };
  w.online = () => { navigator.onLine = true; w.fire('online'); };
  w.gate = () => document.getElementById('s97-cloud-gate');
  w.gateText = () => (document.getElementById('s97-cloud-gate-msg') || {}).textContent;
  w.label = () => document.querySelector('.s97-cloud-fab').attrs['aria-label'];
  return w;
}
// A signed-in device whose last sync left it in step with cloud version 3.
function synced(extra = {}) {
  const d = doc([['a', 10], ['b', 20]]);
  return world({ local: d, base: d, version: 3, cloud: d, cloudVersion: 3, ...extra });
}
const amounts = (d) => Object.fromEntries(d.followups.map((f) => [f.id, f.amount]));

// ---------------------------------------------------------------- tests

test('boots, loads the cloud copy, subscribes, and catches up once realtime joins', async () => {
  const w = synced();
  await w.advance(0);
  assert.equal(w.state().status, 'online');
  assert.equal(w.state().ready, true);
  assert.equal(w.state().realtime, true);
  assert.deepEqual(w.supabase.calls.map((c) => c.kind), ['getSession', 'select', 'version']);
  assert.ok(w.supabase.calls.filter((c) => c.kind !== 'getSession').every((c) => c.withSignal), 'every query carries an abort signal');
  assert.equal(w.label(), 'Cloud sync: Online · all changes saved');
});

test('a healthy page checks only the version, every 5 minutes, and never re-downloads the document', async () => {
  const w = synced();
  await w.advance(0);
  const before = w.supabase.calls.length;
  await w.advance(4 * MIN + 30 * SEC);
  assert.equal(w.supabase.calls.length, before, 'nothing within the heartbeat window');
  await w.advance(1 * MIN);
  assert.equal(w.supabase.count('version'), 2);
  await w.advance(30 * MIN);
  assert.equal(w.supabase.count('select'), 1, 'only the initial load downloaded the document');
  assert.ok(w.supabase.count('version') >= 7 && w.supabase.count('version') <= 9);
});

test('a hidden page makes no requests; returning to it checks exactly once', async () => {
  const w = synced();
  await w.advance(0);
  w.hide();
  const before = w.supabase.calls.length;
  await w.advance(45 * MIN);
  assert.equal(w.supabase.calls.length, before);
  w.show(); w.fire('focus'); w.fire('pageshow');
  await w.advance(0);
  assert.equal(w.supabase.calls.length, before + 1, 'three resume events share one version check');
  assert.equal(w.supabase.calls.at(-1).kind, 'version');
});

test('while realtime is down the page polls the version every 30 s, and catches up when it rejoins', async () => {
  const w = synced();
  await w.advance(0);
  w.supabase.realtimeState('CHANNEL_ERROR');
  assert.equal(w.state().status, 'reconnecting');
  const before = w.supabase.count('version');
  await w.advance(95 * SEC);
  assert.equal(w.supabase.count('version'), before + 3);
  // Another device saved while we were disconnected: no event reaches us.
  w.supabase.echo = false;
  w.supabase.remote((d) => { d.followups[0].amount = 11; });
  w.supabase.echo = true;
  w.supabase.realtimeState('SUBSCRIBED');
  await w.advance(0);
  assert.equal(w.local().followups[0].amount, 11, 'rejoin pulls the missed change');
  assert.equal(w.state().status, 'online');
  const settled = w.supabase.calls.length;
  await w.advance(2 * MIN);
  assert.equal(w.supabase.calls.length, settled, 'polling stops once realtime is back');
});

test('a realtime change is applied in place and the app redraws, with no page reload', async () => {
  const w = synced();
  await w.advance(0);
  const sheet = w.document.createElement('div');
  sheet.id = 'x97-sheet';
  w.document.body.appendChild(sheet);
  w.supabase.remote((d) => { d.followups[1].amount = 25; });
  await w.advance(0);
  assert.equal(w.local().followups[1].amount, 25);
  assert.equal(w.state().version, 4);
  assert.deepEqual(w.redraws, ['cloud'], 'the app is told once, and redraws around the open sheet');
  sheet.remove();
  w.fire('focus');
  await w.advance(0);
  assert.equal(w.reloads, 0, 'nothing on screen is ever reloaded away');
});

test('a stalled save times out, is aborted, shows why, and retries on its own', async () => {
  const w = synced();
  await w.advance(0);
  w.supabase.hang.update = true;
  w.edit((d) => { d.followups[0].amount = 12; });
  await w.advance(650);
  assert.equal(w.state().status, 'saving');
  await w.advance(15 * SEC);
  const s = w.state();
  assert.equal(s.status, 'error');
  assert.match(s.error, /Saving to the cloud timed out/);
  assert.equal(s.saving, false, 'a stalled request can no longer block every later save');
  assert.equal(s.dirty, true);
  assert.equal(w.supabase.calls.find((c) => c.kind === 'update').aborted, true);
  assert.match(w.label(), /Sync needs attention — retrying/);
  w.supabase.hang.update = false;
  await w.advance(3500);
  assert.equal(w.state().status, 'online');
  assert.equal(w.supabase.row.data.followups[0].amount, 12);
});

test('an edit made while a save is in flight is saved right after it', async () => {
  const w = synced();
  await w.advance(0);
  w.supabase.delay.update = 2000;
  w.edit((d) => { d.followups[0].amount = 12; });
  await w.advance(650);           // first save leaves
  await w.advance(500);
  w.edit((d) => { d.followups[1].amount = 22; });
  await w.advance(3000);          // first save lands; the second edit follows it up
  await w.advance(2500);
  assert.deepEqual(amounts(w.supabase.row.data), { a: 12, b: 22 });
  assert.equal(w.state().dirty, false);
  assert.equal(w.state().status, 'online');
});

test('a slow download that lands after this device saved newer data cannot undo either change', async () => {
  const w = synced();
  await w.advance(0);
  // Another device changes b; realtime misses it.
  w.supabase.echo = false;
  w.supabase.remote((d) => { d.followups[1].amount = 29; });
  w.supabase.echo = true;
  w.supabase.delay.select = 3000;
  w.fire('focus');                // version moved, so a full download starts (slow)
  await w.advance(100);
  w.edit((d) => { d.followups[0].amount = 12; });
  await w.advance(10 * SEC);
  assert.deepEqual(amounts(w.supabase.row.data), { a: 12, b: 29 }, 'cloud keeps both changes');
  assert.deepEqual(amounts(w.local()), { a: 12, b: 29 }, 'device keeps both changes');
  assert.equal(w.state().dirty, false);
});

test('a slow download of an older version never overwrites a newer local save', async () => {
  const w = synced();
  await w.advance(0);
  w.supabase.delay.select = 3000;
  w.document.querySelector('.s97-cloud-fab').listeners.click[0]();          // open the sync panel
  const panel = w.document.getElementById('s97-cloud-modal');
  const tap = (action) => panel.listeners.click[0]({ target: { classList: { contains: () => false }, closest: () => ({ dataset: { cloudPanel: action } }) } });
  tap('sync');                    // "Sync now" downloads the whole document (slow): version 3
  await w.advance(100);
  w.edit((d) => { d.followups[0].amount = 12; });
  await w.advance(1000);          // this device saves version 4 while that download is still on its way
  assert.equal(w.supabase.row.version, 4);
  await w.advance(5 * SEC);       // the version-3 download lands
  assert.equal(w.local().followups[0].amount, 12, 'the edit is still on the device');
  assert.equal(w.state().version, 4, 'the device did not step back to version 3');
  assert.equal(w.state().status, 'online');
});

test('a conflicting save merges both devices and the app redraws the merged copy', async () => {
  const w = synced();
  await w.advance(0);
  w.supabase.echo = false;
  w.supabase.remote((d) => { d.followups.push({ id: 'c', client: 'Client c', amount: 30 }); });
  w.edit((d) => { d.followups[0].amount = 12; });
  await w.advance(2 * SEC);
  assert.deepEqual(amounts(w.supabase.row.data), { a: 12, b: 20, c: 30 });
  assert.deepEqual(amounts(w.local()), { a: 12, b: 20, c: 30 });
  assert.equal(w.supabase.row.version, 5);
  assert.deepEqual(w.redraws, ['merge'], 'the running app is told about the merged copy');
  assert.equal(w.reloads, 0);
});

test('a lasting failure backs off to one attempt a minute instead of one every 3.5 s', async () => {
  const w = synced();
  await w.advance(0);
  w.hide();                       // no visibility-driven checks: only the retry schedule
  w.supabase.fail.update = { code: '42501', message: 'permission denied for table finance_documents' };
  w.edit((d) => { d.followups[0].amount = 12; });
  await w.advance(10 * MIN);
  const attempts = w.supabase.count('update');
  assert.ok(attempts >= 10 && attempts <= 15, 'expected ~13 attempts in 10 minutes, got ' + attempts);
  assert.match(w.state().error, /permission denied/);
  w.supabase.fail.update = null;
  await w.advance(61 * SEC);
  assert.equal(w.state().status, 'online');
  assert.equal(w.supabase.row.data.followups[0].amount, 12);
});

test('edits made while the first load is failing are held, then merged once the cloud answers', async () => {
  const base = doc([['a', 10], ['b', 20]]);
  const w = world({ local: base, base, version: 3, cloud: doc([['a', 10], ['b', 21]]), cloudVersion: 4 });
  w.supabase.hang.select = true;
  await w.advance(15 * SEC);
  assert.equal(w.state().status, 'error');
  assert.equal(w.state().ready, false);
  assert.match(w.label(), /Can't load the cloud copy — retrying/);
  w.edit((d) => { d.followups[0].amount = 12; });
  await w.advance(2 * SEC);
  assert.equal(w.supabase.count('update') + w.supabase.count('insert'), 0, 'nothing is written against an unknown cloud copy');
  w.supabase.hang.select = false;
  await w.advance(30 * SEC);
  assert.equal(w.state().status, 'online');
  assert.deepEqual(amounts(w.supabase.row.data), { a: 12, b: 21 });
  assert.deepEqual(amounts(w.local()), { a: 12, b: 21 });
});

test('if the sync library never loads, a signed-in device keeps working and retries', async () => {
  const d = doc([['a', 10]]);
  const w = world({ local: d, base: d, version: 1, cloud: d, cloudVersion: 1, sdk: 'hang', sdkLoadsLater: true });
  await w.advance(20 * SEC);
  assert.equal(w.gate(), null, 'no sign-in wall over a signed-in device');
  assert.equal(w.state().status, 'error');
  assert.match(w.state().error, /Loading the sync service timed out/);
  assert.match(w.label(), /Can't reach the cloud — retrying/);
  w.sdk = 'ready';
  await w.advance(30 * SEC);
  assert.equal(w.state().status, 'online');
  assert.equal(w.supabase.clients, 1);
});

test('if the sync library never loads on a new device, the sign-in screen says why and does not lock up', async () => {
  const w = world({ local: doc([['a', 10]]), sdk: 'error', sdkLoadsLater: true, signedIn: false });
  await w.advance(0);
  assert.ok(w.gate(), 'a device that never signed in still needs the sign-in screen');
  assert.match(w.gateText(), /Could not load the sync service/);
  // Tapping "Sign in" before the library exists must not disable the button forever.
  w.document.getElementById('s97-cloud-email').value = 'owner@example.com';
  w.document.getElementById('s97-cloud-password').value = 'secret1';
  const button = { dataset: { cloudAction: 'signin' }, disabled: false };
  w.gate().listeners.click[0]({ target: { closest: () => button } });
  assert.equal(button.disabled, false);
  assert.match(w.gateText(), /Connecting to the sync service/);
  // Once the library arrives, the retry boots normally and the stale error clears.
  w.sdk = 'ready';
  w.supabase.session = null;
  await w.advance(10 * SEC);
  assert.equal(w.state().status, 'signin');
  assert.equal(w.gateText(), '');
});

test('a stalled sign-in check retries without creating a second client or listener', async () => {
  const w = synced();
  w.supabase.getSessionHang = true;
  await w.advance(15 * SEC);
  assert.equal(w.state().status, 'error');
  assert.match(w.state().error, /Checking your sign-in timed out/);
  w.supabase.getSessionHang = false;
  await w.advance(30 * SEC);
  assert.equal(w.state().status, 'online');
  assert.equal(w.supabase.clients, 1);
  assert.equal(w.supabase.authListeners.length, 1);
});

test('starting offline says so at once, then loads when the connection returns', async () => {
  const w = synced({ online: false });
  await w.advance(0);
  assert.equal(w.state().status, 'offline');
  assert.equal(w.supabase.count('select'), 0, 'no request is made just to wait out its retries');
  w.edit((d) => { d.followups[0].amount = 12; });
  await w.advance(1 * SEC);
  w.online();
  await w.advance(1 * SEC);
  assert.equal(w.state().status, 'online');
  assert.equal(w.supabase.row.data.followups[0].amount, 12, 'the offline edit went up');
});

test('edits made offline go up as soon as the device is back online', async () => {
  const w = synced();
  await w.advance(0);
  w.offline();
  assert.equal(w.state().status, 'offline');
  w.edit((d) => { d.followups[0].amount = 12; });
  await w.advance(5 * MIN);
  assert.equal(w.supabase.count('update'), 0);
  w.online();
  await w.advance(1 * SEC);
  assert.equal(w.state().status, 'online');
  assert.equal(w.supabase.row.data.followups[0].amount, 12);
});

test('an unreadable local copy is reported instead of sitting on "Saving…" forever', async () => {
  const w = synced();
  await w.advance(0);
  w.context.localStorage.setItem(DATA_KEY, '{"meta":{}}');   // missing the finance arrays
  await w.advance(1000);
  assert.equal(w.state().status, 'error');
  assert.match(w.state().error, /can't be read/);
  assert.equal(w.supabase.count('update'), 0);
  // The app writes a readable copy again: it saves normally.
  w.context.localStorage.setItem(DATA_KEY, JSON.stringify(doc([['a', 12], ['b', 20]])));
  await w.advance(1000);
  assert.equal(w.state().status, 'online');
  assert.equal(w.supabase.row.data.followups[0].amount, 12);
});

test('answers that arrive after signing out are ignored', async () => {
  const w = synced();
  await w.advance(0);
  w.supabase.delay.update = 5000;
  w.edit((d) => { d.followups[0].amount = 12; });
  await w.advance(1000);          // save in flight
  w.supabase.session = null;
  w.supabase.authListeners.forEach((cb) => cb('SIGNED_OUT', null));
  await w.advance(10 * SEC);
  const s = w.state();
  assert.equal(s.status, 'signin');
  assert.equal(s.saving, false);
  assert.equal(s.version, 0, 'the late save answer did not resurrect the old session');
  assert.ok(w.gate());
  assert.equal(w.supabase.live().length, 0, 'realtime is torn down');
});

test('a new account on an empty device is ready at once, and its first edit creates the cloud copy', async () => {
  const w = world({});
  await w.advance(0);
  assert.equal(w.state().status, 'online', 'no endless "nothing to upload" error');
  assert.equal(w.state().ready, true);
  assert.equal(w.supabase.count('insert'), 0, 'nothing is uploaded before anything is entered');
  localStorageSet(w, doc([['first', 50]]));
  await w.advance(2 * SEC);
  assert.equal(w.supabase.count('insert'), 1);
  assert.deepEqual(amounts(w.supabase.row.data), { first: 50 });
  assert.equal(w.state().version, 1);
  assert.equal(w.state().dirty, false);
});
function localStorageSet(w, d) { w.context.localStorage.setItem(DATA_KEY, JSON.stringify(d)); }
