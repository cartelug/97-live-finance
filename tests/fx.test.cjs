// Run with: node --test tests/fx.test.cjs
// Exchange rates refresh in the background. When that fails, the app now keeps a
// record and says so, instead of quietly showing an old rate as if it were today's.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function runtime({ online = true, fetchImpl } = {}) {
  const storage = new Map();
  const context = {
    window: { addEventListener() {} },
    document: { addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return null; } },
    navigator: { onLine: online },
    localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) },
    fetch: fetchImpl || (() => Promise.reject(new TypeError('Failed to fetch'))),
    console, setTimeout, clearTimeout, Date, Intl,
  };
  const filename = path.join(__dirname, '../experience-v2.js');
  const source = fs.readFileSync(filename, 'utf8').replace(
    'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();',
    'window.testApi = { fxRefresh, fxLoad, fxStaleReason, fxStaleText, fxBadgeState, todayISO };'
  );
  vm.runInNewContext(source, context, { filename });
  return { ...context.window.testApi, storage, context };
}

const DAY = 24 * 3600 * 1000;
function saveRates(a, daysOld) {
  const at = Date.now() - daysOld * DAY;
  const day = new Date(at);
  const iso = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
  a.storage.set('ns97.v2.fx', JSON.stringify({ base: 'USD', rates: { USD: 1, UGX: 3700, EUR: 0.9 }, fetchedAt: at, updatedAt: at, nextAt: 0, day: daysOld ? iso : a.todayISO(), source: 'test' }));
}
const refresh = (a) => new Promise((resolve) => a.fxRefresh(false, (store, err) => resolve({ store, err })));

test('current rates carry no warning', () => {
  const a = runtime();
  saveRates(a, 0);
  assert.equal(a.fxStaleReason(a.fxLoad()), null);
  assert.equal(a.fxBadgeState(a.fxLoad()), ' live');
});

test('old rates are not flagged until a refresh has actually failed', () => {
  const a = runtime();
  saveRates(a, 3);
  assert.equal(a.fxStaleReason(a.fxLoad()), null, 'a new day starts stale; that alone is not a problem yet');
  assert.equal(a.fxBadgeState(a.fxLoad()), '');
});

test('a failed background refresh is recorded and explained', async () => {
  const a = runtime();
  saveRates(a, 3);
  const { err } = await refresh(a);
  assert.ok(err, 'every provider failed');
  assert.ok(a.storage.has('ns97.v2.fx-fail'));
  assert.equal(a.fxStaleReason(a.fxLoad()), 'unreachable');
  assert.equal(a.fxBadgeState(a.fxLoad()), ' stale');
  assert.match(a.fxStaleText(a.fxLoad()), /^Couldn't reach the rate service\. Using rates saved 3d ago — retrying automatically\.$/);
  assert.equal(a.fxLoad().rates.UGX, 3700, 'the last good rates are kept');
});

test('a later successful refresh clears the warning', async () => {
  let ok = false;
  const payload = { result: 'success', rates: { USD: 1, UGX: 3650, EUR: 0.91 }, time_last_update_unix: Math.floor(Date.now() / 1000), time_next_update_unix: 0 };
  const a = runtime({ fetchImpl: () => ok ? Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }) : Promise.reject(new TypeError('Failed to fetch')) });
  saveRates(a, 2);
  await refresh(a);
  assert.equal(a.fxStaleReason(a.fxLoad()), 'unreachable');
  ok = true;
  const { err } = await refresh(a);
  assert.equal(err, null);
  assert.equal(a.storage.has('ns97.v2.fx-fail'), false);
  assert.equal(a.fxLoad().rates.UGX, 3650);
  assert.equal(a.fxStaleReason(a.fxLoad()), null);
  assert.equal(a.fxBadgeState(a.fxLoad()), ' live');
});

test('offline, old rates say so without waiting for a failed request', () => {
  const a = runtime({ online: false });
  saveRates(a, 1);
  assert.equal(a.fxStaleReason(a.fxLoad()), 'offline');
  assert.equal(a.fxStaleText(a.fxLoad()), 'Offline. Using rates saved yesterday.');
});
