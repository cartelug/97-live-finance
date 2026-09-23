// Run with: node --test tests/wa-safety.test.cjs
// "Only known contacts" (Messaging → Safety): in Auto mode, reminders go only to
// numbers that are in the imported contacts; everyone else is skipped visibly.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function runtime() {
  const context = {
    window: { addEventListener() {} },
    document: { addEventListener() {}, querySelector() { return null; } },
    localStorage: { getItem: () => null, setItem() {} },
    console, setTimeout, clearTimeout, Date, Intl,
  };
  const filename = path.join(__dirname, '../experience-v2.js');
  const source = fs.readFileSync(filename, 'utf8').replace(
    'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();',
    'window.testApi = { knownContactFilter, waNumber };'
  );
  vm.runInNewContext(source, context, { filename });
  return context.window.testApi;
}

const plain = (v) => JSON.parse(JSON.stringify(v));
const jobs = (a, doc) => ['0700 123456', '+256 772 000111', '0755-999888'].map((phone, i) => ({ id: 'f' + i, phone: a.waNumber(phone, doc), name: 'Client ' + i, message: 'Hi' }));
const doc = (knownOnly, contacts) => ({ settings: { waSafety: { knownOnly } }, waContacts: contacts });

test('with the setting off, every selected number is sent', () => {
  const a = runtime(), d = doc(false, []);
  const gate = a.knownContactFilter(d, jobs(a, d));
  assert.deepEqual(plain(gate.send.map((j) => j.id)), ['f0', 'f1', 'f2']);
  assert.equal(gate.skipped.length, 0);
});

test('with the setting on, only imported contacts are sent, however the number was written', () => {
  const a = runtime();
  // Same people, typed differently in the contacts than on the invoices.
  const d = doc(true, [{ id: 'c1', name: 'A', phone: '+256700123456' }, { id: 'c2', name: 'B', phone: '0772 000 111' }]);
  const gate = a.knownContactFilter(d, jobs(a, d));
  assert.deepEqual(plain(gate.send.map((j) => j.id)), ['f0', 'f1']);
  assert.deepEqual(plain(gate.skipped.map((j) => j.id)), ['f2']);
  assert.equal(gate.noContacts, false);
});

test('with the setting on and no contacts imported, nothing is sent and the reason is known', () => {
  const a = runtime(), d = doc(true, []);
  const gate = a.knownContactFilter(d, jobs(a, d));
  assert.equal(gate.noContacts, true);
  assert.equal(gate.send.length, 0);
});
