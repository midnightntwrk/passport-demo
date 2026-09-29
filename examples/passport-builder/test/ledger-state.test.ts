import assert from 'node:assert/strict';
import test from 'node:test';
import { LEDGER_STATE_LIMITS, serialiseLedgerState } from '../service/ledger-state.ts';

function compactMap(entries: Array<[unknown, unknown]>) {
  return {
    isEmpty: () => entries.length === 0,
    size: () => BigInt(entries.length),
    member: () => { throw new Error('member must not be called'); },
    lookup: () => { throw new Error('lookup must not be called'); },
    [Symbol.iterator]: () => entries[Symbol.iterator](),
  };
}

function compactSet(values: unknown[]) {
  return {
    isEmpty: () => values.length === 0,
    size: () => BigInt(values.length),
    member: () => { throw new Error('member must not be called'); },
    [Symbol.iterator]: () => values[Symbol.iterator](),
  };
}

test('preserves legacy scalars, enum indices, record getters, vectors, and lowercase bytes', () => {
  const ledger = {
    get count() { return 9007199254740993n; },
    enabled: true, phase: 2, label: 'café', empty: null,
    owner: new Uint8Array([0, 15, 255]),
    position: [4n, 9n], option: { is_some: false, value: 0n },
  };
  assert.deepEqual(serialiseLedgerState(ledger), {
    count: '9007199254740993', enabled: true, phase: 2, label: 'café', empty: null,
    owner: '000fff', position: ['4', '9'], option: { is_some: false, value: '0' },
  });
});

test('projects populated generated map/struct and set wrappers without invoking lookup', () => {
  assert.deepEqual(serialiseLedgerState({
    tasks: compactMap([[7n, { title: new Uint8Array([65]), priority: 3n, phase: 1 }]]),
    active: compactSet([new Uint8Array([1]), new Uint8Array([2])]),
    empty: compactMap([]),
  }), {
    tasks: { entries: [['7', { title: '41', priority: '3', phase: 1 }]], size: '1', truncated: false },
    active: { values: ['01', '02'], size: '2', truncated: false },
    empty: { entries: [], size: '0', truncated: false },
  });
});

test('native collections use the same explicit entries envelope and retain composite keys', () => {
  assert.deepEqual(serialiseLedgerState({
    map: new Map<unknown, unknown>([[new Uint8Array([1]), new Set([2n, 3n])], [{ id: 4n }, false]]),
  }), {
    map: { entries: [['01', { values: ['2', '3'], size: '2', truncated: false }], [{ id: '4' }, false]], size: '2', truncated: false },
  });
});

test('generated lists preserve iteration order and do not call head', () => {
  const values = [7n, 2n, 7n];
  assert.deepEqual(serialiseLedgerState({ items: {
    isEmpty: () => false,
    length: () => 3n,
    head: () => { throw new Error('head must not be called'); },
    [Symbol.iterator]: () => values[Symbol.iterator](),
  } }), { items: { values: ['7', '2', '7'], size: '3', truncated: false } });
});

test('caps collection iteration at 200 and reports its actual size and truncation', () => {
  let reads = 0;
  const enormous = {
    ...compactSet([]), size: () => 10n ** 30n,
    [Symbol.iterator]: () => ({ next: () => ({ value: BigInt(reads++), done: false }) }),
  };
  const state = serialiseLedgerState(enormous) as { values: string[]; size: string; truncated: boolean };
  assert.equal(reads, LEDGER_STATE_LIMITS.entries);
  assert.equal(state.values.length, 200);
  assert.equal(state.values.at(-1), '199');
  assert.equal(state.size, '1000000000000000000000000000000');
  assert.equal(state.truncated, true);
  const exact = serialiseLedgerState(new Map(Array.from({ length: 200 }, (_, index) => [index, index]))) as { truncated: boolean };
  assert.equal(exact.truncated, false);
});

test('fails explicitly for non-enumerable nested ledger collections and malformed wrappers', () => {
  const nested = compactMap([]);
  Reflect.deleteProperty(nested, Symbol.iterator);
  assert.throws(() => serialiseLedgerState({ nested }), /cannot be enumerated/);
  assert.throws(() => serialiseLedgerState({ ...compactSet([]), size: () => -1n }), /invalid size/);
  assert.throws(() => serialiseLedgerState({ ...compactSet([]), size: () => 2n }), /does not match/);
  assert.throws(() => serialiseLedgerState({ ...compactMap([]), size: () => 1n, [Symbol.iterator]: () => [1n][Symbol.iterator]() }), /invalid entry/);
});

test('bounds nesting, cycles, vector length, total values, and JSON response bytes', () => {
  const cycle: unknown[] = [];
  cycle.push(cycle);
  assert.throws(() => serialiseLedgerState(cycle), /cycle/);
  const map = new Map();
  map.set('self', map);
  assert.throws(() => serialiseLedgerState(map), /cycle/);
  let deep: unknown = 0;
  for (let index = 0; index < 18; index += 1) deep = { next: deep };
  assert.throws(() => serialiseLedgerState(deep), /nesting limit/);
  assert.throws(() => serialiseLedgerState(Array.from({ length: 201 }, () => 0)), /vector exceeds/);
  assert.throws(() => serialiseLedgerState(Array.from({ length: 100 }, () => Array.from({ length: 100 }, () => 0))), /value count/);
  assert.throws(() => serialiseLedgerState({ text: '\u0000'.repeat(200_000) }), /1 MiB/);
  assert.throws(() => serialiseLedgerState(new Uint8Array(600_000)), /1 MiB/);
});

test('never calls toJSON and rejects unsupported objects instead of silently omitting state', () => {
  let invoked = false;
  assert.throws(() => serialiseLedgerState({ toJSON() { invoked = true; return 'hidden'; } }), /unsupported value/);
  assert.equal(invoked, false);
  assert.throws(() => serialiseLedgerState(new Date()), /unsupported object/);
  for (const value of [undefined, NaN, Infinity, () => 1, Symbol('value')]) {
    assert.throws(() => serialiseLedgerState(value), /unsupported value/);
  }
});

test('preserves unusual ledger field names as data without prototype mutation', () => {
  const decoded = JSON.parse('{"__proto__":{"count":3},"constructor":"record"}');
  const result = serialiseLedgerState(decoded) as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.deepEqual(Object.getOwnPropertyDescriptor(result, '__proto__')?.value, { count: 3 });
  assert.equal(result.constructor, 'record');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), decoded);
});
