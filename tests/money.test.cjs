// Run with: node --test tests/money.test.cjs
// Budgets, the cash forecast and runway: the numbers Home and Expenses show.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function runtime(doc) {
  const storage = new Map();
  if (doc) storage.set('ns97-finance-v1', JSON.stringify(doc));
  const context = {
    window: { addEventListener() {} },
    document: { addEventListener() {}, querySelector() { return null; } },
    localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    console, setTimeout, clearTimeout, Date, Intl,
  };
  const filename = path.join(__dirname, '../app.js');
  const source = fs.readFileSync(filename, 'utf8').replace(
    'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();',
    'window.testApi = { readDoc, budgetUse, expenseStats, plannedOutflows, cashForecast, runwayDays, attentionItems, analytics, todayISO, dateISO, addDays, todayDate, monthKey };'
  );
  vm.runInNewContext(source, context, { filename });
  return context.window.testApi;
}

// Dates relative to today, so the tests mean the same thing on any day.
const api0 = runtime();
const day = (n) => api0.dateISO(api0.addDays(api0.todayDate(), n));
const month = api0.monthKey(api0.todayDate());
const plain = (v) => JSON.parse(JSON.stringify(v));

function workspace(extra = {}) {
  return {
    meta: { appName: '97 LIVE', usdRate: 3800 },
    balances: [{ id: 'b1', account: 'Equity Bank', balance: 1000000 }, { id: 'b2', account: 'MTN MoMo', balance: 500000 }],
    followups: [], credit: [], creditLoans: [], payments: [],
    expenses: { personalBudget: 1000000, businessBudget: 2000000, entries: [] },
    settings: {},
    ...extra,
  };
}

test('a planned bill paid under the same name is counted once, not twice', () => {
  const doc = workspace({ expenses: { personalBudget: 0, businessBudget: 2000000, entries: [
    { id: 'p', date: day(0), type: 'Business', kind: 'Planned', item: 'Studio rent', amount: 900000 },
    { id: 'a', date: day(0), type: 'Business', kind: 'Actual', item: ' studio RENT ', amount: 600000 },
  ] } });
  const a = runtime(doc);
  const u = a.budgetUse(a.readDoc(), 'Business', month);
  assert.equal(u.actual, 600000);
  assert.equal(u.stillPlanned, 300000, 'only what is left of the plan still counts');
  assert.equal(u.safe, 2000000 - 600000 - 300000);
  assert.equal(u.tone, 'good');
});

test('overspending turns the budget red, and an unset budget never raises an alarm', () => {
  const doc = workspace({ expenses: { personalBudget: 100000, businessBudget: 0, entries: [
    { id: 'x', date: day(0), type: 'Personal', kind: 'Actual', item: 'Transport', amount: 150000 },
    { id: 'y', date: day(0), type: 'Business', kind: 'Actual', item: 'Ads', amount: 50000 },
  ] } });
  const a = runtime(doc), d = a.readDoc();
  assert.equal(a.budgetUse(d, 'Personal', month).tone, 'bad');
  assert.equal(a.budgetUse(d, 'Business', month).tone, '');
  const titles = a.attentionItems(d, a.analytics(d), a.cashForecast(d, 30)).map((x) => x.title);
  assert.ok(titles.includes('Personal budget is over'));
  assert.ok(!titles.some((t) => /Business budget/.test(t)), 'no budget set, so nothing is over it');
});

test('expense entries keep their old shape: type and kind are read case-insensitively', () => {
  const doc = workspace({ expenses: { personalBudget: 500000, businessBudget: 0, entries: [
    { id: 'x', date: day(0), type: 'personal', kind: 'actual', item: 'Lunch', amount: 20000 },
  ] } });
  const a = runtime(doc);
  assert.equal(a.expenseStats(a.readDoc()).personalActual, 20000);
});

test('the forecast starts from cash and applies incoming, planned spending and loans on their dates', () => {
  const doc = workspace({
    followups: [
      { id: 'in1', client: 'Apollo', currency: 'UGX', amount: 400000, status: 'Pending', expectedBy: day(5) },
      { id: 'usd', client: 'Kaleidoscope', currency: 'USD', amount: 100, status: 'Pending', expectedBy: day(10) },
      { id: 'late', client: 'Late payer', currency: 'UGX', amount: 250000, status: 'Pending', expectedBy: day(-3) },
      { id: 'far', client: 'Next quarter', currency: 'UGX', amount: 999000, status: 'Pending', expectedBy: day(45) },
    ],
    credit: [{ id: 'c1', network: 'MTN', service: 'XtraCash', limitOffer: 1000000, status: 'Live', feeModel: 'Fixed fee', baseFee: 0.1, termDays: 30 }],
    creditLoans: [{ id: 'l1', facilityId: 'c1', principal: 200000, borrowDate: day(-20), dueDate: day(10), feeModelSnapshot: 'Fixed fee', baseFeeSnapshot: 0.1, dailyRateSnapshot: 0, termDaysSnapshot: 30, status: 'Active' }],
    expenses: { personalBudget: 0, businessBudget: 0, entries: [
      { id: 'rent', date: day(2), type: 'Business', kind: 'Planned', item: 'Rent', amount: 300000 },
      { id: 'old', date: day(-40), type: 'Business', kind: 'Planned', item: 'Last month plan', amount: 777000 },
    ] },
  });
  const a = runtime(doc);
  const fc = a.cashForecast(a.readDoc(), 30);
  assert.equal(fc.cash, 1500000);
  assert.equal(fc.inflow, 400000 + 100 * 3800, 'dollars at the saved rate when there is no live one');
  assert.equal(fc.outflow, 300000 + 220000, 'rent, and the loan with its fee on the due date');
  assert.equal(fc.end, 1500000 + 780000 - 520000);
  assert.equal(fc.overdueIn, 250000, 'overdue money is reported, not assumed');
  assert.deepEqual(plain(fc.moves.map((m) => m.dir + ':' + m.title)), ['out:Rent', 'in:Apollo', 'out:XtraCash repayment', 'in:Kaleidoscope']);
  assert.equal(fc.low, 1200000);
  assert.equal(fc.lowDate, day(2));
  assert.equal(a.cashForecast(a.readDoc(), 60).inflow, 400000 + 380000 + 999000, 'a longer window reaches further');
});

test('a plan that is already late counts as due today, and a shortfall is flagged', () => {
  const doc = workspace({
    balances: [{ id: 'b1', account: 'Cash', balance: 100000 }],
    expenses: { personalBudget: 0, businessBudget: 0, entries: [{ id: 'r', date: api0.dateISO(new Date(api0.todayDate().getFullYear(), api0.todayDate().getMonth(), 1)), type: 'Business', kind: 'Planned', item: 'Rent', amount: 300000 }] },
  });
  const a = runtime(doc), d = a.readDoc();
  const fc = a.cashForecast(d, 30);
  assert.equal(fc.moves[0].date, a.todayISO());
  assert.equal(fc.low, -200000);
  assert.ok(a.attentionItems(d, a.analytics(d), fc).some((x) => /run short/.test(x.title)));
});

test('runway divides cash by the recent daily spend, and needs some history', () => {
  const a = runtime(workspace());
  assert.equal(a.runwayDays(a.readDoc(), 1500000), null, 'no spending logged yet');
  const doc = workspace({ expenses: { personalBudget: 0, businessBudget: 0, entries: [
    { id: 'x', date: day(-59), type: 'Personal', kind: 'Actual', item: 'Rent', amount: 600000 },
    { id: 'y', date: day(0), type: 'Personal', kind: 'Actual', item: 'Food', amount: 600000 },
  ] } });
  const b = runtime(doc);
  assert.equal(b.runwayDays(b.readDoc(), 1500000), 75, '1.2M over 60 days is 20K a day');
});

test('overdue payments lead the attention list and link to the overdue filter', () => {
  const doc = workspace({ followups: [
    { id: 'a', client: 'A', currency: 'UGX', amount: 100000, status: 'Pending', expectedBy: day(-9) },
    { id: 'b', client: 'B', currency: 'USD', amount: 50, status: 'Pending', expectedBy: day(-2) },
    { id: 'c', client: 'C', currency: 'UGX', amount: 70000, status: 'Pending', expectedBy: day(3) },
    { id: 'd', client: 'D', currency: 'UGX', amount: 10000, status: 'Pending', expectedBy: '' },
  ] });
  const a = runtime(doc), d = a.readDoc();
  const items = plain(a.attentionItems(d, a.analytics(d), a.cashForecast(d, 30)));
  assert.equal(items[0].title, 'Overdue payments');
  assert.equal(items[0].count, 2);
  assert.equal(items[0].quick, 'overdue');
  assert.match(items[0].meta, /UGX 100K \+ USD 50 · from 2 clients · oldest 9 days/);
  assert.ok(items.some((x) => x.quick === 'next7' && x.count === 1));
  assert.ok(items.some((x) => x.quick === 'unscheduled' && x.count === 1));
});
