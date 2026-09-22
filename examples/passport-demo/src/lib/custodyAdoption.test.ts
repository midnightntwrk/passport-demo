/**
 * COMING BACK ON A NEW DEVICE, drilled at the seam between its two halves.
 *
 * The hand-off exists because making a key on this device CHANGES WHICH
 * PASSPORT THE APP THINKS IT IS SHOWING, mid-ceremony, and takes the screen
 * that started the recovery with it. Every case below is about what has to
 * survive that, and about the three ways the second half can be asked for at a
 * moment it must not run: on another network, without a sign-in to approve it,
 * and again after it has already worked.
 */

import { describe, expect, it } from 'vitest';

import {
  CUSTODY_ADOPT_KEY,
  adoptionStage,
  clearAdoption,
  loadAdoption,
  saveAdoption,
  type AdoptionHandoff,
  type AdoptionStageInput,
} from './custodyAdoption.js';
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

const HANDOFF: AdoptionHandoff = {
  network: 'stagenet',
  address: 'ab'.repeat(32),
  name: 'alice',
  socialUser: '0xabcdef0000000000000000000000000000000001',
};

function found(over: Partial<AdoptionStageInput> = {}): AdoptionStageInput {
  return {
    handoff: HANDOFF,
    network: 'stagenet',
    hasDeviceKey: false,
    socialSignedIn: true,
    alreadyAdopted: false,
    ...over,
  };
}

/* -------------------------------------------------------------------------- */
/* Which half is next                                                         */
/* -------------------------------------------------------------------------- */

describe('the stage of a recovery', () => {
  it('is idle when nothing is in flight', () => {
    expect(adoptionStage(found({ handoff: null }))).toBe('idle');
  });

  it('asks for a key on this device when there is not one yet', () => {
    expect(adoptionStage(found())).toBe('enrol');
  });

  it('adopts once a key exists here and the sign-in is still there', () => {
    expect(adoptionStage(found({ hasDeviceKey: true }))).toBe('adopt');
  });

  it('is blocked when the sign-in that found the Passport has gone', () => {
    /* The sign-in is what AUTHORISES the addition — the new key cannot add
       itself — so a session that has gone between the halves is a real stop
       with a real remedy, and not a failure. */
    expect(adoptionStage(found({ hasDeviceKey: true, socialSignedIn: false }))).toBe('blocked');
  });

  it('is idle before the wallet has settled on a network', () => {
    /* "Not yet" and "no" are different answers and only one is worth a
       sentence. Blocking here would put a stop on the screen for a reason that
       resolves itself a beat later. */
    expect(adoptionStage(found({ network: null }))).toBe('idle');
  });

  it('is idle on a network the recovery was not started on', () => {
    /* An address means nothing on another network, and adopting into it would
       add a key to whatever happens to live at that address there. */
    expect(adoptionStage(found({ network: 'devnet' }))).toBe('idle');
  });

  it('is idle once the key is already on the account', () => {
    /* The chain would take a second add harmlessly; the reader would not take
       a second approval on every open harmlessly. */
    expect(adoptionStage(found({ hasDeviceKey: true, alreadyAdopted: true }))).toBe('idle');
  });
});

/* -------------------------------------------------------------------------- */
/* What survives the enrolment                                                */
/* -------------------------------------------------------------------------- */

describe('the hand-off', () => {
  it('comes back exactly as it was written', () => {
    const storage = memoryStorage();
    saveAdoption(storage, HANDOFF);
    expect(loadAdoption(storage)).toEqual(HANDOFF);
  });

  it('is one at a time, and a second recovery replaces the first', () => {
    const storage = memoryStorage();
    saveAdoption(storage, HANDOFF);
    saveAdoption(storage, { ...HANDOFF, name: 'bob' });
    expect(loadAdoption(storage)?.name).toBe('bob');
  });

  it('is gone once it is cleared', () => {
    const storage = memoryStorage();
    saveAdoption(storage, HANDOFF);
    clearAdoption(storage);
    expect(loadAdoption(storage)).toBeNull();
  });

  it('reads as nothing rather than as a half-recovery when a field is missing', () => {
    /* A record without an address is not a recovery that has lost its address;
       it is something else's data in our key. Reading it as a recovery would
       point the second half at `undefined`. */
    const partial = JSON.stringify({ network: 'stagenet', name: 'alice' });
    expect(loadAdoption(memoryStorage({ [CUSTODY_ADOPT_KEY]: partial }))).toBeNull();
  });

  it('reads as nothing over rubbish, an array, or an empty string field', () => {
    expect(loadAdoption(memoryStorage({ [CUSTODY_ADOPT_KEY]: 'not json' }))).toBeNull();
    expect(loadAdoption(memoryStorage({ [CUSTODY_ADOPT_KEY]: '[1]' }))).toBeNull();
    expect(
      loadAdoption(memoryStorage({ [CUSTODY_ADOPT_KEY]: JSON.stringify({ ...HANDOFF, name: '' }) })),
    ).toBeNull();
  });

  it('survives a storage that refuses, in both directions', () => {
    expect(loadAdoption(refusingStorage())).toBeNull();
    expect(() => saveAdoption(refusingStorage(), HANDOFF)).not.toThrow();
    expect(() => clearAdoption(refusingStorage())).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* The words                                                                  */
/* -------------------------------------------------------------------------- */
