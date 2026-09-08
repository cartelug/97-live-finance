// Run with: node --test tests/retainers.test.cjs
// Exercise the production functions without loading a browser or customer data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function runtime() {
  const storage = new Map();
  const context = {
    window: { addEventListener() {} },
    document: { addEventListener() {}, querySelector() { return null; } },
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    console, setTimeout, clearTimeout, Date, Intl,
  };
  const filename = path.join(__dirname, '../experience-v2.js');
  const source = fs.readFileSync(filename, 'utf8').replace(
    'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();',
    'window.testApi = { state, isRetainer, dealPartsFor, projectSchedule, rebuildDealParts, applyPayment, reversePayment, followupMatches, icOutstandingForMonth, icMonthChipsHTML, loadPrefs };'
  );
  vm.runInNewContext(source, context, { filename });
  return { ...context.window.testApi, storage };
}

function monthly(api, overrides = {}) {
  const item = { id: 'contract', client: 'Fixture client', dealType: 'monthly', category: 'Design', partCount: 6, currency: 'UGX', status: 'Pending', paid: 0, ...overrides };
  item.parts = api.dealPartsFor({}, { dealType: 'monthly', partCount: 6, amount: 300000, startDate: '2026-09-30', ...overrides });
  const doc = { followups: [item], payments: [], balances: [{ id: 'cash', account: 'Cash', balance: 0 }] };
  api.rebuildDealParts(doc, item);
  return { item, doc };
}

test('monthly type and legacy category identify retainers without name or note guesses', () => {
  const a = runtime();
  for (const item of [{ dealType: 'monthly', category: 'Design' }, { category: ' Retainer ' }, { category: 'retainers' }, { category: 'Monthly Retainer' }]) assert.equal(a.isRetainer(item), true);
  for (const item of [{ dealType: 'custom', category: 'Design' }, { client: 'Retainer design', note: 'monthly' }, { category: 'One Time' }]) assert.equal(a.isRetainer(item), false);
});

test('six monthly instalments have the exact total and stop at the contracted term', () => {
  const a = runtime(), { item } = monthly(a);
  assert.equal(item.parts.length, 6);
  assert.equal(item.gross, 1800000);
  assert.equal(item.amount, 1800000);
  assert.deepEqual(Array.from(item.parts, p => p.dueDate), ['2026-09-30', '2026-10-30', '2026-11-30', '2026-12-30', '2027-01-30', '2027-02-28']);
  assert.equal(new Set(item.parts.map(p => p.id)).size, 6);
});

test('month-end clamping retains the original day across short months and leap years', () => {
  const a = runtime();
  for (const [start, expected] of [
    ['2028-01-31', ['2028-01-31', '2028-02-29', '2028-03-31']],
    ['2027-01-31', ['2027-01-31', '2027-02-28', '2027-03-31']],
  ]) assert.deepEqual(Array.from(a.dealPartsFor({}, { dealType: 'monthly', partCount: 3, amount: 250000, startDate: start }), p => p.dueDate), expected);
});

test('each month includes the contract and only that month’s outstanding amount', () => {
  const a = runtime(), { item, doc } = monthly(a);
  for (const month of ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02']) {
    a.state.upcoming.month = month;
    assert.equal(a.followupMatches(item, doc), true);
    assert.equal(a.icOutstandingForMonth(doc, month).ugx, 300000);
  }
  a.state.upcoming.month = '2027-03';
  assert.equal(a.followupMatches(item, doc), false);
  assert.equal(a.icOutstandingForMonth(doc, '2027-03').ugx, 0);
});

test('retainers can be selected or excluded and their currency totals stay separate', () => {
  const a = runtime(), { item, doc } = monthly(a);
  doc.followups.push({ id: 'one', category: 'Design', amount: 90000, status: 'Pending', expectedBy: '2026-10-30' });
  doc.followups.push({ id: 'dollar', category: ' retainer ', currency: 'USD', amount: 400, status: 'Pending', expectedBy: '2026-10-30' });
  const f = a.state.upcoming; f.month = '2026-10'; f.retainers = 'only';
  assert.equal(a.followupMatches(item, doc), true);
  assert.equal(a.followupMatches(doc.followups[1], doc), false);
  assert.equal(a.icOutstandingForMonth(doc, f.month).ugx, 300000);
  assert.equal(a.icOutstandingForMonth(doc, f.month).usd, 400);
  f.retainers = 'exclude';
  assert.equal(a.followupMatches(item, doc), false);
  assert.equal(a.icOutstandingForMonth(doc, f.month).ugx, 90000);
  assert.equal(a.icOutstandingForMonth(doc, f.month).usd, 0);
  f.retainers = 'all'; f.categories = ['Retainer'];
  assert.equal(a.followupMatches(item, doc), true, 'legacy category filter also recognises monthly deal type');
});

test('month and date range must match the same instalment', () => {
  const a = runtime(), { item, doc } = monthly(a), f = a.state.upcoming;
  f.month = '2026-10'; f.from = '2026-11-01';
  assert.equal(a.followupMatches(item, doc), false);
  f.from = '2026-10-01'; f.to = '2026-10-31';
  assert.equal(a.followupMatches(item, doc), true);
});

test('month chips count each deal once, not its number of payments', () => {
  const a = runtime(), { item, doc } = monthly(a);
  item.parts[1].dueDate = '2026-09-30';
  const html = a.icMonthChipsHTML(doc);
  assert.match(html, /data-month="2026-09">[^<]+<b>1<\/b>/);
  assert.match(html, /data-month="all">All months<b>1<\/b>/);
  assert.equal(a.icOutstandingForMonth(doc, '2026-09').ugx, 600000);
});

test('partial receipts reduce only the allocated month; full receipt advances next due date', () => {
  const a = runtime(), { item, doc } = monthly(a);
  a.applyPayment(doc, item.id, { amount: 100000, date: '2026-09-30', accountId: 'cash' });
  assert.equal(item.paid, 100000); assert.equal(item.status, 'Part Paid');
  assert.equal(a.icOutstandingForMonth(doc, '2026-09').ugx, 200000);
  assert.equal(a.icOutstandingForMonth(doc, '2026-10').ugx, 300000);
  a.applyPayment(doc, item.id, { amount: 200000, date: '2026-09-30', accountId: 'cash' });
  assert.equal(item.expectedBy, '2026-10-30'); assert.equal(item.parts[0].status, 'Paid');
  assert.equal(doc.balances[0].balance, 300000);
  assert.equal(a.icOutstandingForMonth(doc, '2026-09').ugx, 0);
});

test('reversing the last payment restores the receivable and cash exactly once', () => {
  const a = runtime(), { item, doc } = monthly(a);
  const payment = a.applyPayment(doc, item.id, { amount: 1800000, date: '2026-09-30', accountId: 'cash' });
  assert.equal(item.status, 'Paid');
  assert.equal(a.reversePayment(doc, payment.id), true);
  assert.equal(item.paid, 0); assert.equal(item.status, 'Pending');
  assert.equal(item.amount, 1800000); assert.equal(item.expectedBy, '2026-09-30');
  assert.equal(doc.balances[0].balance, 0);
  assert.equal(a.reversePayment(doc, payment.id), false);
  a.rebuildDealParts(doc, item);
  assert.equal(item.paid, 0, 'reloading does not resurrect the reversed receipt');
});

test('legacy receipts survive the first new payment and its reversal', () => {
  const a = runtime(), { item, doc } = monthly(a);
  item.paid = 300000; item.parts[0].paid = 300000; item.parts[0].paidOn = '2026-09-30';
  a.rebuildDealParts(doc, item);
  const payment = a.applyPayment(doc, item.id, { amount: 250000, date: '2026-10-30', accountId: 'cash' });
  assert.equal(item.paid, 550000);
  assert.equal(item.parts[0].paid, 300000); assert.equal(item.parts[1].paid, 250000);
  a.reversePayment(doc, payment.id);
  assert.equal(item.paid, 300000); assert.equal(item.parts[0].paid, 300000);
  assert.equal(item.parts[1].paid, 0); assert.equal(doc.balances[0].balance, 0);
});

test('overpayments are rejected without changing any finance records', () => {
  const a = runtime(), { item, doc } = monthly(a), before = JSON.stringify(doc);
  assert.equal(a.applyPayment(doc, item.id, { amount: 2000000 }), null);
  assert.equal(JSON.stringify(doc), before);
});

test('saved legacy Retainer filter upgrades to the dedicated retainer filter', () => {
  const a = runtime();
  a.storage.set('ns97.v3.incoming.filters', JSON.stringify({ categories: ['Retainer'], month: '2026-10' }));
  a.loadPrefs();
  assert.equal(a.state.upcoming.retainers, 'only');
  assert.equal(a.state.upcoming.categories.length, 0);
  assert.equal(a.state.upcoming.month, '2026-10');
});
