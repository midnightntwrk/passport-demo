/**
 * Drills for the earlier viewing keys a Passport holds (2026/09/26).
 *
 * The storage is a map with the three behaviours a browser's has — it answers,
 * it refuses, and (for one drill) it accepts a write and keeps nothing — so
 * every rule in `./viewingKeys.ts` is held without a browser.
 */

import { describe, expect, it } from 'vitest';

import {
  EARLIER_VIEWING_KEYS_KEY,
  EARLIER_VIEWING_KEYS_PER_ACCOUNT,
  loadEarlierViewingKeys,
  normalisedViewingSecret,
  rememberEarlierViewingKey,
  viewingKeyAccountKey,
  viewingSecretsFor,
  type ViewingKeyStorage,
} from './viewingKeys.js';

const ACCOUNT = { network: 'stagenet', address: 'ab'.repeat(32) };
const OTHER = { network: 'stagenet', address: 'cd'.repeat(32) };
const OLD_KEY = '11'.repeat(32);
const NEW_KEY = '22'.repeat(32);

function fakeStorage(behaviour: { denyReads?: boolean; denyWrites?: boolean; forget?: boolean } = {}): {
  storage: ViewingKeyStorage;
  map: Map<string, string>;
} {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      getItem: (key) => {
        if (behaviour.denyReads) throw new Error('storage denied');
        return map.get(key) ?? null;
      },
      setItem: (key, value) => {
        if (behaviour.denyWrites) throw new Error('quota');
        if (!behaviour.forget) map.set(key, value);
      },
    },
  };
}

describe('the account a key belongs to', () => {
  it('is network and address, lower-cased, and nothing that is not one', () => {
    expect(viewingKeyAccountKey({ network: 'stagenet', address: `0x${'AB'.repeat(32)}` })).toBe(
      `stagenet::${'ab'.repeat(32)}`,
    );
    expect(viewingKeyAccountKey({ network: ' ', address: 'ab'.repeat(32) })).toBeNull();
    expect(viewingKeyAccountKey({ network: 7 as unknown as string, address: 'ab'.repeat(32) })).toBeNull();
    expect(viewingKeyAccountKey({ network: 'stagenet', address: 'ab' })).toBeNull();
  });

  it('reads a viewing secret as 32 bytes of hex, or not at all', () => {
    expect(normalisedViewingSecret(`0x${'AA'.repeat(32)}`)).toBe('aa'.repeat(32));
    expect(normalisedViewingSecret('aa'.repeat(31))).toBeNull();
    expect(normalisedViewingSecret(42)).toBeNull();
    expect(normalisedViewingSecret(null)).toBeNull();
  });
});

describe('keeping an earlier key', () => {
  it('keeps a restored key beside the current one, for its own account only', () => {
    const { storage } = fakeStorage();
    expect(rememberEarlierViewingKey(storage, ACCOUNT, OLD_KEY, NEW_KEY)).toEqual({ kind: 'added' });
    expect(loadEarlierViewingKeys(storage, ACCOUNT)).toEqual([OLD_KEY]);
    expect(loadEarlierViewingKeys(storage, OTHER)).toEqual([]);
  });

  it('says a key it already reads with is held, rather than writing it twice', () => {
    const { storage, map } = fakeStorage();
    /* The sign-in handing back the key of the device that put it there: the
       key IS the current one. */
    expect(rememberEarlierViewingKey(storage, ACCOUNT, NEW_KEY, NEW_KEY)).toEqual({
      kind: 'held',
      reason: 'this device already reads this account with that key',
    });
    expect(map.has(EARLIER_VIEWING_KEYS_KEY)).toBe(false);
    rememberEarlierViewingKey(storage, ACCOUNT, OLD_KEY, NEW_KEY);
    expect(rememberEarlierViewingKey(storage, ACCOUNT, OLD_KEY.toUpperCase(), NEW_KEY)).toEqual({
      kind: 'held',
      reason: 'this device already holds that key for this account',
    });
    expect(loadEarlierViewingKeys(storage, ACCOUNT)).toEqual([OLD_KEY]);
  });

  it('refuses what is not a key, or not an account', () => {
    const { storage } = fakeStorage();
    expect(rememberEarlierViewingKey(storage, { network: '', address: ACCOUNT.address }, OLD_KEY, null))
      .toMatchObject({ kind: 'refused', reason: 'the account is not one this Passport can read' });
    expect(rememberEarlierViewingKey(storage, ACCOUNT, 'short', null)).toMatchObject({
      kind: 'refused',
      reason: 'the key is not the size a viewing key is',
    });
  });

  it('keeps the oldest keys when the list is full, because nothing else opens the oldest notes', () => {
    const { storage } = fakeStorage();
    const keys = Array.from({ length: EARLIER_VIEWING_KEYS_PER_ACCOUNT }, (_, index) =>
      (index + 16).toString(16).repeat(32),
    );
    for (const key of keys) {
      expect(rememberEarlierViewingKey(storage, ACCOUNT, key, null)).toEqual({ kind: 'added' });
    }
    expect(rememberEarlierViewingKey(storage, ACCOUNT, 'ee'.repeat(32), null)).toMatchObject({
      kind: 'refused',
      reason: `this device already holds ${EARLIER_VIEWING_KEYS_PER_ACCOUNT} earlier keys for this account`,
    });
    expect(loadEarlierViewingKeys(storage, ACCOUNT)).toEqual(keys);
  });

  it('counts a key as kept only where it can be read back', () => {
    const refused = fakeStorage({ denyWrites: true });
    expect(rememberEarlierViewingKey(refused.storage, ACCOUNT, OLD_KEY, null)).toEqual({
      kind: 'refused',
      reason: 'this browser did not store it',
    });
    /* A write that is accepted and not kept — a private tab's quota, say. */
    const forgetful = fakeStorage({ forget: true });
    expect(rememberEarlierViewingKey(forgetful.storage, ACCOUNT, OLD_KEY, null)).toEqual({
      kind: 'refused',
      reason: 'this browser did not store it',
    });
  });

  it('reads nothing it did not write, and nothing that is not a list of keys', () => {
    const { storage, map } = fakeStorage();
    map.set(EARLIER_VIEWING_KEYS_KEY, 'not json');
    expect(loadEarlierViewingKeys(storage, ACCOUNT)).toEqual([]);
    map.set(EARLIER_VIEWING_KEYS_KEY, '[1,2]');
    expect(loadEarlierViewingKeys(storage, ACCOUNT)).toEqual([]);
    map.set(EARLIER_VIEWING_KEYS_KEY, 'null');
    expect(loadEarlierViewingKeys(storage, ACCOUNT)).toEqual([]);
    map.set(
      EARLIER_VIEWING_KEYS_KEY,
      JSON.stringify({
        [`stagenet::${ACCOUNT.address}`]: [OLD_KEY, 'nonsense', OLD_KEY, NEW_KEY],
        [`stagenet::${OTHER.address}`]: 'not a list',
        [`stagenet::${'EF'.repeat(32)}`]: [OLD_KEY],
        nokey: [OLD_KEY],
        [`::${ACCOUNT.address}`]: [OLD_KEY],
        ['__proto__']: [OLD_KEY],
      }),
    );
    expect(loadEarlierViewingKeys(storage, ACCOUNT)).toEqual([OLD_KEY, NEW_KEY]);
    expect(loadEarlierViewingKeys(storage, OTHER)).toEqual([]);
    expect(loadEarlierViewingKeys(storage, { network: 'stagenet', address: 'zz' })).toEqual([]);
    /* A storage that refuses to be read holds nothing. */
    expect(loadEarlierViewingKeys(fakeStorage({ denyReads: true }).storage, ACCOUNT)).toEqual([]);
  });
});

describe('the keys an inbox walk tries', () => {
  it('tries the current key first, then each earlier one, never one twice', () => {
    const { storage } = fakeStorage();
    rememberEarlierViewingKey(storage, ACCOUNT, OLD_KEY, NEW_KEY);
    rememberEarlierViewingKey(storage, ACCOUNT, '33'.repeat(32), NEW_KEY);
    expect(viewingSecretsFor(storage, ACCOUNT, NEW_KEY)).toEqual([NEW_KEY, OLD_KEY, '33'.repeat(32)]);
    /* A current key that is also filed as an earlier one is tried once. */
    expect(viewingSecretsFor(storage, ACCOUNT, OLD_KEY)).toEqual([OLD_KEY, '33'.repeat(32)]);
    /* No current key: the earlier ones alone. */
    expect(viewingSecretsFor(storage, ACCOUNT, null)).toEqual([OLD_KEY, '33'.repeat(32)]);
    expect(viewingSecretsFor(storage, OTHER, null)).toEqual([]);
  });
});
