import { beforeEach, describe, expect, it } from 'vitest';

import { loadAliasRecord, saveAliasRecord } from './aliasStore.js';

/**
 * The store's refusal rules, and in particular the `recovered` provenance a
 * device-join or recovery landing depends on: a name that IS registered on
 * chain but that THIS device never registered, so it holds no transaction
 * ids. Without this exemption `adoptJoin`'s landing threw on the tx-id rule
 * and never completed (two live rehearsal runs, 2026/09/07).
 */

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  };
}

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { localStorage: fakeStorage() };
});

describe('saveAliasRecord — the registered tx-id rule', () => {
  it('refuses a registered record with no transaction ids', () => {
    expect(() =>
      saveAliasRecord({ alias: 'alice', domain: 'alice.night', network: 'stagenet', status: 'registered' }),
    ).toThrow(/resolver deployment and registration transaction ids/);
  });

  it('accepts a registered record that carries both ids', () => {
    saveAliasRecord({
      alias: 'alice',
      domain: 'alice.night',
      network: 'stagenet',
      status: 'registered',
      resolverDeployTxId: 'aa'.repeat(32),
      registerTxId: 'bb'.repeat(32),
    });
    expect(loadAliasRecord('stagenet')?.alias).toBe('alice');
  });
});

describe('saveAliasRecord — the recovered exemption', () => {
  it('accepts a recovered record with a confirmed read-back and NO tx ids', () => {
    /* The joining device's landing: it confirmed the name resolves to the
       account, and never registered it, so it has no ids to carry. */
    saveAliasRecord({
      alias: 'alice',
      domain: 'alice.night',
      network: 'stagenet',
      status: 'registered',
      recovered: true,
      registryConfirmed: true,
      resolverTarget: 'contract',
      resolverTargetHex: 'cc'.repeat(32),
    });
    const stored = loadAliasRecord('stagenet');
    expect(stored?.recovered).toBe(true);
    expect(stored?.resolverDeployTxId).toBeUndefined();
  });

  it('refuses a recovered record whose registry read-back is not confirmed', () => {
    /* The higher bar the exemption trades for: "registered" is never written
       on the strength of another device's claim alone. */
    expect(() =>
      saveAliasRecord({
        alias: 'alice',
        domain: 'alice.night',
        network: 'stagenet',
        status: 'registered',
        recovered: true,
        registryConfirmed: false,
      }),
    ).toThrow(/confirmed registry read-back/);
  });
});
