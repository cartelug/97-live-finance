// Run with: node --test tests/data.test.cjs
// Protecting the one document everything lives in: old documents load and save
// without losing anything, restores are checked first, a new workspace never
// races the cloud copy, and deletes can be undone.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function runtime(doc, cloud) {
  const storage = new Map();
  if (doc) storage.set('ns97-finance-v1', JSON.stringify(doc));
  const toasts = [];
  let undo = null;
  const holder = {
    set innerHTML(html) { if (html) toasts.push(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()); },
    get innerHTML() { return ''; },
    setAttribute() {},
    querySelector() { return { addEventListener: (type, fn) => { undo = fn; } }; },
  };
  const context = {
    window: { addEventListener() {}, __s97cloud: cloud ? () => cloud : undefined },
    document: {
      addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
      getElementById: (id) => (id === 'toasts' ? holder : null),
      body: { classList: { contains: () => false, add() {}, remove() {} }, style: { setProperty() {}, removeProperty() {} } },
    },
    localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    console, setTimeout: () => 0, clearTimeout() {}, Date, Intl,
  };
  const filename = path.join(__dirname, '../app.js');
  const source = fs.readFileSync(filename, 'utf8').replace(
    'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();',
    'window.testApi = { readDoc, updateDoc, viewDoc, emptyDoc, inspectBackup, countsText, deleteRecord, markExpensePaid, deleteExpense, saveRestorePoint, restorePoint, todayISO };'
  );
  vm.runInNewContext(source, context, { filename });
  return {
    ...context.window.testApi, storage, toasts,
    stored: () => JSON.parse(storage.get('ns97-finance-v1')),
    undo: () => { assert.ok(undo, 'an Undo was offered'); undo(); },
  };
}

// A document as older versions wrote it: legacy fields, fields this version
// has never heard of, and no arrays that later versions added.
const OLD = {
  meta: { appName: '97 LIVE', usdRate: 3750, somethingFromTheFuture: { keep: true } },
  balances: [{ id: 'b1', account: 'Equity Bank', line: 'Main', balance: 700000, notes: '1010103718541' }],
  followups: [{ id: 'f1', category: 'Design', client: 'NATHAN FINAL DEPO', amount: 820000, currency: 'UGX', status: 'Pending', expectedBy: '2026-07-03', note: '' }],
  credit: [{ id: 'c1', network: 'Airtel', line: '0708', service: 'WeWole', limitOffer: 40500, borrowed: 0, borrowDate: null, termDays: 30, baseFee: 0.1, dailyRate: 0, feeModel: 'Fixed fee', manualDue: 0, status: 'Live', notes: '' }],
  expenses: { monthStart: '2026-07-01', personalBudget: 200000, businessBudget: 120000, personalCeiling: 500000, businessCeiling: 300000, entries: [{ id: 'e1', date: '2026-06-26', type: 'Business', kind: 'Planned', item: 'ADS FOR NS CREATIVE', amount: 120000, note: 'ADS' }] },
  settings: { categories: ['Retainer', 'Design'], fuStatuses: ['Pending', 'Paid'], creditStatuses: ['Live'], networks: ['Airtel', 'MTN'], currencies: ['UGX', 'USD'], customThing: 42 },
  waContacts: [{ id: 'w1', name: 'Isaac', phone: '0772000000' }],
};
const clone = (v) => JSON.parse(JSON.stringify(v));

test('an old document survives an edit with every field it had, known or not', () => {
  const a = runtime(clone(OLD));
  assert.ok(a.updateDoc((d) => { d.balances[0].balance = 900000; }, 'test', true));
  const saved = a.stored();
  assert.equal(saved.balances[0].balance, 900000);
  assert.deepEqual(saved.meta.somethingFromTheFuture, { keep: true });
  assert.equal(saved.settings.customThing, 42);
  assert.equal(saved.expenses.monthStart, '2026-07-01', 'browsing months never rewrites this any more');
  assert.equal(saved.expenses.personalCeiling, 500000);
  assert.deepEqual(saved.waContacts, OLD.waContacts);
  assert.equal(saved.followups[0].client, 'NATHAN FINAL DEPO');
  assert.deepEqual(saved.creditLoans, [], 'arrays later versions added are filled in, empty');
  assert.deepEqual(saved.payments, []);
});

test('a backup is checked before it can replace anything', () => {
  const a = runtime(clone(OLD));
  assert.match(a.inspectBackup('not json').error, /readable JSON/);
  assert.match(a.inspectBackup('[1,2]').error, /isn't a 97 LIVE backup/);
  assert.match(a.inspectBackup('{"meta":{},"followups":[]}').error, /missing deals, accounts or credit/);
  const ok = a.inspectBackup(JSON.stringify(OLD));
  assert.equal(ok.error, undefined);
  assert.equal(a.countsText(ok.counts), '1 deal, 1 account, 1 expense, 1 credit offer, 1 contact');
});

test('a restore point keeps the current document before it is replaced', () => {
  const a = runtime(clone(OLD));
  assert.equal(a.restorePoint(), null);
  assert.ok(a.saveRestorePoint('the restore'));
  const rp = a.restorePoint();
  assert.equal(rp.reason, 'the restore');
  assert.deepEqual(JSON.parse(rp.raw), OLD);
});

test('a new device does not start an empty workspace while the cloud copy is still loading', () => {
  const loading = runtime(null, { status: 'loading', ready: false });
  assert.equal(loading.viewDoc(), null, 'shows a loading state instead');
  assert.equal(loading.updateDoc((d) => { d.balances.push({ id: 'x', balance: 1 }); }, 'test', true), false);
  assert.equal(loading.storage.has('ns97-finance-v1'), false, 'nothing was written');
  assert.match(loading.toasts.join(' '), /Still loading your data/);

  const fresh = runtime(null, { status: 'online', ready: true });
  assert.equal(fresh.viewDoc().followups.length, 0, 'a new account gets an empty workspace');
  assert.equal(fresh.storage.has('ns97-finance-v1'), false, 'which is not stored until something is entered');
  assert.ok(fresh.updateDoc((d) => { d.balances.push({ id: 'x', account: 'Cash', balance: 5 }); }, 'test', true));
  const saved = fresh.stored();
  assert.equal(saved.balances.length, 1);
  assert.ok(Array.isArray(saved.followups) && Array.isArray(saved.credit) && saved.meta, 'a complete document the sync engine accepts');
});

test('deleting a deal offers Undo, and Undo puts it back where it was', () => {
  const doc = clone(OLD);
  doc.followups.push({ id: 'f2', client: 'Second', amount: 1, currency: 'UGX', status: 'Pending' });
  const a = runtime(doc);
  a.deleteRecord('followups', 'f1', 'test');
  assert.deepEqual(a.stored().followups.map((x) => x.id), ['f2']);
  assert.match(a.toasts.join(' '), /Deleted NATHAN FINAL DEPO Undo/);
  a.undo();
  assert.deepEqual(a.stored().followups.map((x) => x.id), ['f1', 'f2']);
});

test('a planned expense can be marked paid in one step, and undone', () => {
  const doc = clone(OLD);
  const future = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  doc.expenses.entries.push({ id: 'e2', date: future, type: 'Personal', kind: 'Planned', item: 'Rent', amount: 300000 });
  const a = runtime(doc);
  a.markExpensePaid('e2');
  let e2 = a.stored().expenses.entries.find((x) => x.id === 'e2');
  assert.equal(e2.kind, 'Actual');
  assert.equal(e2.date, a.todayISO(), 'paid today, not on the date it was planned for');
  a.undo();
  e2 = a.stored().expenses.entries.find((x) => x.id === 'e2');
  assert.deepEqual([e2.kind, e2.date], ['Planned', future]);
});
