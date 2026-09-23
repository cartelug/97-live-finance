// Run with: node --test tests/credit.test.cjs
// The credit model: loans live only in creditLoans. Loans that older versions
// kept on the facility itself (borrowed / borrowDate / manualDue) are moved
// there once, without duplicating or losing anything.
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
    localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)) },
    console, setTimeout, clearTimeout, Date, Intl,
  };
  const filename = path.join(__dirname, '../experience-v2.js');
  const source = fs.readFileSync(filename, 'utf8').replace(
    'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();',
    'window.testApi = { readDoc, migrateFacilityLoans, recordBorrow, recordRepay, analytics, persistCreditMigration };'
  );
  vm.runInNewContext(source, context, { filename });
  return { ...context.window.testApi, storage, stored: () => JSON.parse(storage.get('ns97-finance-v1')) };
}

// A facility that still carries its loan the way versions before creditLoans did.
function legacyDoc(extra = {}) {
  return {
    meta: { appName: '97 LIVE' },
    followups: [],
    balances: [{ id: 'cash', account: 'Cash', balance: 1000000 }],
    credit: [{ id: 'c1', network: 'MTN', service: 'XtraCash', limitOffer: 1340000, status: 'Live', feeModel: 'Fixed fee', baseFee: 0.09, dailyRate: 0, termDays: 30, borrowed: 480000, borrowDate: '2026-09-01', manualDue: 523200, notes: 'first loan' }],
    creditLoans: [],
    ...extra,
  };
}
const LEGACY_ID = 'legacy-c1-2026-09-01-480000';
const active = (doc) => doc.creditLoans.filter((l) => !/repaid|cancel/i.test(String(l.status)));
const plain = (v) => JSON.parse(JSON.stringify(v));

test('a loan kept on the facility becomes a stored loan and the facility fields are cleared', () => {
  const a = runtime(legacyDoc());
  const doc = a.readDoc();
  assert.equal(doc.creditLoans.length, 1);
  assert.deepEqual(plain(doc.creditLoans[0]), {
    id: LEGACY_ID, facilityId: 'c1', principal: 480000, borrowDate: '2026-09-01', dueDate: '2026-10-01',
    feeModelSnapshot: 'Fixed fee', baseFeeSnapshot: 0.09, dailyRateSnapshot: 0, termDaysSnapshot: 30,
    manualDue: 523200, status: 'Active', notes: 'first loan', migratedFrom: 'facility',
  });
  assert.deepEqual(plain([doc.credit[0].borrowed, doc.credit[0].borrowDate, doc.credit[0].manualDue]), [0, '', 0]);
  assert.equal(a.analytics(doc).debt, 523200, 'same debt the old read-time view showed');
  assert.equal(a.analytics(doc).creditAvailable, 1340000 - 480000);
});

test('borrowing again on that facility keeps the older loan (it used to be overwritten)', () => {
  const a = runtime(legacyDoc());
  const doc = a.readDoc();
  assert.equal(a.recordBorrow(doc, 'c1', 300000, { borrowDate: '2026-09-10', destinationAccount: 'cash' }), true);
  assert.equal(active(doc).length, 2);
  assert.deepEqual(plain(active(doc).map((l) => l.principal).sort()), [300000, 480000]);
  assert.deepEqual(plain([doc.credit[0].borrowed, doc.credit[0].borrowDate]), [0, ''], 'borrowing no longer writes the facility fields');
  assert.equal(a.analytics(doc).debt, 523200 + 327000);
  assert.equal(doc.balances[0].balance, 1300000);
  // And the result survives a save and a fresh read.
  a.storage.set('ns97-finance-v1', JSON.stringify(doc));
  assert.equal(active(a.readDoc()).length, 2);
});

test('the migration is idempotent and gives every device the identical record', () => {
  const one = runtime(legacyDoc()), two = runtime(legacyDoc());
  const d1 = one.readDoc(), d2 = two.readDoc();
  assert.deepEqual(plain(d1.creditLoans), plain(d2.creditLoans), 'two devices migrate to the same id and fields, so sync merges them into one');
  assert.equal(one.migrateFacilityLoans(d1), false, 'nothing left to migrate');
  assert.deepEqual(plain(one.readDoc().creditLoans), plain(d1.creditLoans));
});

test('fields an older version mirrored from its own new loan are not counted twice', () => {
  const doc = legacyDoc({ creditLoans: [{ id: 'loan_x', facilityId: 'c1', principal: 480000, borrowDate: '2026-09-01', status: 'Active', feeModelSnapshot: 'Fixed fee', baseFeeSnapshot: 0.09, termDaysSnapshot: 30 }] });
  const a = runtime(doc);
  const read = a.readDoc();
  assert.deepEqual(plain(read.creditLoans.map((l) => l.id)), ['loan_x']);
  assert.equal(read.credit[0].borrowed, 0);
  assert.equal(a.analytics(read).debt, 523200);
});

test('fields that match no loan while another loan is open stay untouched, as before', () => {
  const doc = legacyDoc({ creditLoans: [{ id: 'loan_y', facilityId: 'c1', principal: 300000, borrowDate: '2026-09-10', status: 'Active', feeModelSnapshot: 'Fixed fee', baseFeeSnapshot: 0.09, termDaysSnapshot: 30 }] });
  const a = runtime(doc);
  const read = a.readDoc();
  assert.deepEqual(plain(read.creditLoans.map((l) => l.id)), ['loan_y']);
  assert.deepEqual(plain([read.credit[0].borrowed, read.credit[0].borrowDate]), [480000, '2026-09-01']);
  assert.equal(a.analytics(read).debt, 327000, 'the previous version showed only the open loan too');
});

test('a facility with no principal or no borrow date holds no loan', () => {
  const doc = legacyDoc();
  doc.credit.push({ id: 'c2', limitOffer: 500000, status: 'Live', feeModel: 'Manual', borrowed: 0, borrowDate: '', manualDue: 45000 });
  doc.credit.push({ id: 'c3', limitOffer: 500000, status: 'Live', feeModel: 'Fixed fee', borrowed: 20000, borrowDate: '' });
  const read = runtime(doc).readDoc();
  assert.deepEqual(plain(read.creditLoans.map((l) => l.facilityId)), ['c1']);
  assert.equal(read.credit[1].manualDue, 45000);
  assert.equal(read.credit[2].borrowed, 20000);
});

test('if an older version repaid the same loan on another device, its repaid copy wins', () => {
  const doc = legacyDoc();
  const a = runtime(doc);
  const migrated = a.readDoc();
  // What sync produces when a device on the previous version repaid the loan meanwhile.
  migrated.creditLoans.push({ id: 'loan_old', facilityId: 'c1', principal: 480000, borrowDate: '2026-09-01', status: 'Repaid', actualPaid: 523200, repaidDate: '2026-09-20' });
  a.storage.set('ns97-finance-v1', JSON.stringify(migrated));
  const read = a.readDoc();
  assert.deepEqual(plain(read.creditLoans.map((l) => l.id)), ['loan_old']);
  assert.equal(a.analytics(read).debt, 0);
});

test('repaying a migrated loan settles it and moves the money', () => {
  const a = runtime(legacyDoc());
  const doc = a.readDoc();
  assert.equal(a.recordRepay(doc, LEGACY_ID, 523200, { repaidDate: '2026-09-25', repaymentAccount: 'cash' }), true);
  assert.equal(doc.creditLoans[0].status, 'Repaid');
  assert.equal(doc.creditLoans[0].actualPaid, 523200);
  assert.equal(doc.balances[0].balance, 1000000 - 523200);
  assert.equal(a.analytics(doc).debt, 0);
  assert.equal(a.recordRepay(doc, 'no-such-loan', 1, {}), false);
});

test('the migration is stored once, and only when there is something to migrate', () => {
  const a = runtime(legacyDoc());
  a.persistCreditMigration();
  const stored = a.stored();
  assert.equal(stored.creditLoans[0].id, LEGACY_ID);
  assert.equal(stored.credit[0].borrowed, 0);
  const raw = a.storage.get('ns97-finance-v1');
  a.persistCreditMigration();
  assert.equal(a.storage.get('ns97-finance-v1'), raw, 'a second run writes nothing');

  const fresh = legacyDoc(); fresh.credit[0].borrowed = 0; fresh.credit[0].borrowDate = ''; delete fresh.creditLoans;
  const b = runtime(fresh);
  const before = b.storage.get('ns97-finance-v1');
  b.persistCreditMigration();
  assert.equal(b.storage.get('ns97-finance-v1'), before, 'a document with nothing to migrate is left byte-for-byte alone');
});
