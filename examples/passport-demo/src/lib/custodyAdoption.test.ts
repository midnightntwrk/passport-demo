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
  ADOPT_COPY,
  CUSTODY_ADOPT_KEY,
  adoptionStage,
  clearAdoption,
  loadAdoption,
  saveAdoption,
  socialStart,
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

describe('what a signed-in person with no Passport is offered', () => {
  it('is the road a passkey takes, on a device that can make a key', () => {
    /* The dead end of 2026/09/21, in one assertion: signed in on a clean phone
       and told to go and find a device that can make a key, on the device that
       could. */
    expect(socialStart({ canMakeDeviceKey: true })).toBe('create');
  });

  it('is the same road while the question has not been answered yet', () => {
    /* `null` is not `false`. A probe in flight must not read as a refusal, or
       the commonest device in the world reads one for the length of a promise. */
    expect(socialStart({ canMakeDeviceKey: null })).toBe('create');
  });

  it('is only the way back, on a device that genuinely cannot make one', () => {
    expect(socialStart({ canMakeDeviceKey: false })).toBe('recover-only');
  });
});

describe('the copy', () => {
  const everything = [
    ADOPT_COPY.title,
    ADOPT_COPY.found('alice'),
    ADOPT_COPY.action,
    ADOPT_COPY.busy,
    ADOPT_COPY.blocked,
    ADOPT_COPY.limit,
    ADOPT_COPY.socialCanCreate('Google'),
    ADOPT_COPY.socialCanCreate(null),
    ADOPT_COPY.socialCreateAction,
    ADOPT_COPY.socialCreateHint,
    ADOPT_COPY.socialRecoverAction,
    ADOPT_COPY.socialCannotCreate,
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

  it('says what does not come back, on the screen that brings the rest back', () => {
    expect(ADOPT_COPY.limit).toMatch(/stay listed on your other device/);
  });

  it('names the Passport being brought back by the name that was typed', () => {
    expect(ADOPT_COPY.found('alice')).toContain('alice.night');
  });

  it('refuses to offer a new Passport only where a device cannot make a key', () => {
    /* Still the right sentence, and now shown only where it is true. */
    expect(ADOPT_COPY.socialCannotCreate).toMatch(/brings back a Passport you already hold/);
  });

  it('says where the Passport will be held, and what the sign-in is for', () => {
    /* The two things a reader would otherwise have to infer, and the retirement
       of "your sign-in is all Passport needs" — which was true of the shape
       2026/09/21 replaced and of nothing since. */
    expect(ADOPT_COPY.socialCanCreate('Google')).toMatch(/key on this device/);
    expect(ADOPT_COPY.socialCanCreate('Google')).toMatch(/Your Google sign-in/);
    expect(ADOPT_COPY.socialCanCreate(null)).toMatch(/The account you signed in with/);
    expect(ADOPT_COPY.socialCanCreate('  ')).toBe(ADOPT_COPY.socialCanCreate(null));
  });

  it('uses the passkey road’s own words for the press and for who pays', () => {
    /* Same screens, same wording: the two arms must not name one action two
       ways, or the road stops looking like one road. */
    expect(ADOPT_COPY.socialCreateAction).toBe('Create my Passport');
    expect(ADOPT_COPY.socialCreateHint).toBe('Setting your Passport up is paid for on your behalf.');
  });
});
