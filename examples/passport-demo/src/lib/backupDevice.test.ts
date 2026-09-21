/**
 * THE SPARE KEY: when Passport asks for one, and what it is allowed to say.
 *
 * The decision of 2026/09/21 is that the offer is OPTIONAL and NAGGED, and
 * every case below is one half of that sentence. Optional means a dismissal is
 * honoured; nagged means it is honoured for a day and not for ever. The two
 * pull against each other, and a rule that got either wrong would be invisible
 * until somebody lost a phone.
 *
 * The copy is drilled here too, against the vocabulary rule the custody screen
 * keeps. It is the kind of thing that slips a word at a time, and a word at a
 * time is exactly what a reader notices.
 */

import { describe, expect, it } from 'vitest';

import {
  BACKUP_COPY,
  BACKUP_REMINDER_MS,
  backupOffer,
  backupRefusal,
  backupSlot,
  CUSTODY_BACKUP_KEY,
  loadBackupRecord,
  loadBackupRecords,
  saveBackupRecord,
  type BackupOfferInput,
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

/** A Passport that is finished, named, and has never been asked about. */
function ready(over: Partial<BackupOfferInput> = {}): BackupOfferInput {
  return {
    onHome: true,
    hasName: true,
    socialAvailable: true,
    heldBySocial: false,
    record: null,
    now: NOW,
    ...over,
  };
}

/* -------------------------------------------------------------------------- */
/* When the offer is made                                                     */
/* -------------------------------------------------------------------------- */

describe('whether to offer a spare key', () => {
  it('offers one to a finished, named Passport that has never been asked', () => {
    expect(backupOffer(ready())).toBe('offer');
  });

  it('says nothing while the Passport is still being set up', () => {
    expect(backupOffer(ready({ onHome: false }))).toBe('hidden');
  });

  it('waits for the name, because the name is what the way back in is typed', () => {
    expect(backupOffer(ready({ hasName: false }))).toBe('hidden');
  });

  it('says nothing in a build that has no other way in to offer', () => {
    expect(backupOffer(ready({ socialAvailable: false }))).toBe('hidden');
  });

  it('says nothing to a Passport whose only key IS the sign-in', () => {
    /* There is nothing to offer: the card would be offering the key it has. */
    expect(backupOffer(ready({ heldBySocial: true }))).toBe('hidden');
  });
});

/* -------------------------------------------------------------------------- */
/* Optional, and nagged                                                       */
/* -------------------------------------------------------------------------- */

describe('a dismissal', () => {
  it('is honoured, and the card goes away', () => {
    expect(backupOffer(ready({ record: { dismissedAt: NOW - 1000 } }))).toBe('hidden');
  });

  it('is honoured right up to the day, and not a moment less', () => {
    const justBefore = { dismissedAt: NOW - BACKUP_REMINDER_MS + 1 };
    expect(backupOffer(ready({ record: justBefore }))).toBe('hidden');
  });

  it('runs out after a day, and the offer comes back', () => {
    const aDayAgo = { dismissedAt: NOW - BACKUP_REMINDER_MS };
    expect(backupOffer(ready({ record: aDayAgo }))).toBe('offer');
  });

  it('dated in the future is a clock that moved, and the offer is due', () => {
    /* A device whose clock was wrong, or a record carried from another one. The
       alternative reading — suppress until a date that may never arrive —
       silently retires the nag for that browser for ever. */
    expect(backupOffer(ready({ record: { dismissedAt: NOW + 10 * BACKUP_REMINDER_MS } }))).toBe(
      'offer',
    );
  });
});

describe('a Passport that already has a spare key', () => {
  it('says so, and is asked nothing further', () => {
    expect(backupOffer(ready({ record: { doneAt: NOW - 5 } }))).toBe('done');
  });

  it('says so even on a visit where the offer would not have been made', () => {
    /* `done` is decided FIRST. A Passport that is backed up is backed up
       whether or not it is on Home, and a card that went silent mid-setup
       would read as the backup having come undone. */
    expect(backupOffer(ready({ onHome: false, hasName: false, record: { doneAt: NOW } }))).toBe(
      'done',
    );
  });

  it('is not un-done by a later dismissal landing on the same record', () => {
    expect(backupOffer(ready({ record: { doneAt: NOW - 5, dismissedAt: NOW - 1 } }))).toBe('done');
  });
});

/* -------------------------------------------------------------------------- */
/* What is written down                                                       */
/* -------------------------------------------------------------------------- */

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

describe('the refusal', () => {
  it('is null when a signed-in key is there to be added', () => {
    expect(backupRefusal({ status: 'signed-in', hasKey: true })).toBeNull();
  });

  it('is null before the sign-in, because that is what the button is for', () => {
    expect(backupRefusal({ status: 'signed-out', hasKey: false })).toBeNull();
  });

  it('says so in a build with no other way in', () => {
    expect(backupRefusal({ status: 'disabled', hasKey: false })).toMatch(/not available/);
  });

  it('says "in a moment" while the sign-in is still starting up', () => {
    expect(backupRefusal({ status: 'loading', hasKey: false })).toMatch(/moment/);
  });

  it('says "in a moment" for a sign-in that has no key yet', () => {
    /* The beat between the auth flow resolving and the embedded key existing.
       A button that opened the overlay again here would ask somebody to sign
       in to an account they are already signed in to. */
    expect(backupRefusal({ status: 'signed-in', hasKey: false })).toMatch(/moment/);
  });
});

/* -------------------------------------------------------------------------- */
/* The words                                                                  */
/* -------------------------------------------------------------------------- */

describe('the copy', () => {
  const everything = [
    BACKUP_COPY.title,
    BACKUP_COPY.lede,
    BACKUP_COPY.action,
    BACKUP_COPY.limit,
    BACKUP_COPY.dismiss,
    BACKUP_COPY.busy,
    BACKUP_COPY.done('Google'),
    BACKUP_COPY.done(null),
  ].join(' \n ');

  it('names none of the machinery, and does not name the vendor', () => {
    for (const forbidden of [
      'wallet address',
      'dust',
      'contract',
      'registry',
      'indexer',
      'resolver',
      'sponsor',
      'sdk',
      'dynamic',
      'passkey',
      'credential',
    ]) {
      expect(everything.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('names the providers a reader recognises, because those they did choose', () => {
    expect(BACKUP_COPY.lede).toContain('Google');
    expect(BACKUP_COPY.lede).toContain('Discord');
  });

  it('says what a new device will NOT bring back, in the offer', () => {
    /* The honest sentence. It is in the OFFER and not in a footnote after the
       fact, because somebody choosing a backup is choosing what it covers. */
    expect(BACKUP_COPY.limit).toMatch(/send and be paid/);
    expect(BACKUP_COPY.limit).toMatch(/this device only/);
  });

  it('names the provider in the line that says it is done, where there is one', () => {
    expect(BACKUP_COPY.done('Google')).toContain('Google');
    expect(BACKUP_COPY.done('  ')).toBe(BACKUP_COPY.done(null));
  });
});
