/**
 * THE RECORD OF A PASSPORT'S WAY BACK, and nothing but the record.
 *
 * The rules that were drilled here on 2026/09/21 — when to offer a spare key,
 * how long a dismissal is honoured for, and what the offer may say — went with
 * the Home card they belonged to. They are `./recoveryStep.test.ts`'s now.
 * What is left is the store two of those rules are read from: per account and
 * per network, tolerant of a storage that refuses, and unbothered by whatever
 * somebody else wrote under the same key.
 */

import { describe, expect, it } from 'vitest';

import {
  CUSTODY_BACKUP_KEY,
  backupSlot,
  loadBackupRecord,
  loadBackupRecords,
  saveBackupRecord,
} from './backupDevice.js';
import type { CustodyStorage } from '../identity/custodyContractPlan.js';

function memoryStorage(seed: Record<string, string> = {}): CustodyStorage {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** A storage that refuses everything — private browsing, or site data blocked. */
function refusingStorage(): CustodyStorage {
  return {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
    removeItem: () => {
      throw new Error('denied');
    },
  };
}

const NOW = 1_800_000_000_000;

describe('the record', () => {
  const USER = 'jubjub:2A1F';
  const NETWORK = 'stagenet';

  it('is keyed per account and per network, lower-cased on the user', () => {
    expect(backupSlot(USER, NETWORK)).toBe('jubjub:2a1f|stagenet');
  });

  it('comes back for the account it was written for, and for no other', () => {
    const storage = memoryStorage();
    saveBackupRecord(storage, USER, NETWORK, { doneAt: NOW, provider: 'Google' });
    expect(loadBackupRecord(storage, USER, NETWORK)).toEqual({ doneAt: NOW, provider: 'Google' });
    expect(loadBackupRecord(storage, USER, 'devnet')).toBeNull();
    expect(loadBackupRecord(storage, 'jubjub:other', NETWORK)).toBeNull();
  });

  it('merges rather than replaces, so a dismissal cannot erase a spare key', () => {
    /* The two fields are written by different things at different moments: a
       press, and a confirmed transaction. A replace would let a stale card's
       "Not now" take the account back to being asked. */
    const storage = memoryStorage();
    saveBackupRecord(storage, USER, NETWORK, { doneAt: NOW, provider: 'Google' });
    saveBackupRecord(storage, USER, NETWORK, { dismissedAt: NOW + 1 });
    expect(loadBackupRecord(storage, USER, NETWORK)).toEqual({
      doneAt: NOW,
      provider: 'Google',
      dismissedAt: NOW + 1,
    });
  });

  it('leaves every other account alone when one is written', () => {
    const storage = memoryStorage();
    saveBackupRecord(storage, USER, NETWORK, { doneAt: NOW });
    saveBackupRecord(storage, 'jubjub:beef', NETWORK, { dismissedAt: NOW });
    expect(Object.keys(loadBackupRecords(storage))).toHaveLength(2);
  });

  it('reads as empty out of a storage that refuses, rather than throwing', () => {
    expect(loadBackupRecords(refusingStorage())).toEqual({});
    expect(loadBackupRecord(refusingStorage(), USER, NETWORK)).toBeNull();
  });

  it('survives a write that is refused, because the key is on the chain anyway', () => {
    expect(() => saveBackupRecord(refusingStorage(), USER, NETWORK, { doneAt: NOW })).not.toThrow();
  });

  it('reads as empty over rubbish, and over a value that is not a record', () => {
    expect(loadBackupRecords(memoryStorage({ [CUSTODY_BACKUP_KEY]: 'not json' }))).toEqual({});
    expect(loadBackupRecords(memoryStorage({ [CUSTODY_BACKUP_KEY]: '[1,2]' }))).toEqual({});
    expect(
      loadBackupRecords(memoryStorage({ [CUSTODY_BACKUP_KEY]: '{"a|stagenet":"yes"}' })),
    ).toEqual({});
  });
});

/* -------------------------------------------------------------------------- */
/* What the button says before it opens anything                              */
/* -------------------------------------------------------------------------- */
