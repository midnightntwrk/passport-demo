import test from 'node:test';
import assert from 'node:assert/strict';
import { PendingTransaction, unresolved } from '../runtime/pending-transaction.js';
const id = '01' + 'ab'.repeat(32);
function storage() { const map = new Map<string,string>(); return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string,v: string) => { map.set(k,v); }, removeItem: (k: string) => { map.delete(k); } }; }
test('lost popup response and reload retain the exact prepared ID and block another write', () => {
  const saved = storage(); const first = new PendingTransaction(saved, 'app:deployment');
  assert.equal(unresolved(first.begin(id)), true);
  const restored = new PendingTransaction(saved, 'app:deployment').restore();
  assert.deepEqual(restored, { status: 'unknown', txId: id });
  assert.equal(unresolved(restored), true);
  assert.equal(new PendingTransaction(saved, 'different-app:deployment').restore(), undefined);
  first.clear(); assert.equal(first.restore(), undefined);
  assert.equal(unresolved({ status: 'confirmed', txId: id }), false);
});
test('invalid IDs and failed persistence prevent opening an untracked request', () => {
  const store = new PendingTransaction(storage(), 'app');
  assert.throws(() => store.begin('untrusted'), /invalid/);
  assert.equal(store.restore(), undefined);
  assert.throws(() => new PendingTransaction({ ...storage(), setItem() { throw new Error('unavailable'); } }, 'app').begin(id), /unavailable/);
});
