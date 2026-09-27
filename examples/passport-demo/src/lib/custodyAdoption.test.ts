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
  ADOPTION_NOT_ADDED,
  ADOPTION_OTHER_PASSPORT,
  ADOPTION_OTHER_SIGN_IN,
  ADOPTION_PASSKEY_DECLINED,
  ADOPTION_UNCONFIRMED,
  CUSTODY_ADOPT_KEY,
  CUSTODY_RECORDS_KEY,
  adoptionStage,
  adoptionStale,
  bindAdoption,
  browserHoldsOtherPassport,
  clearAdoption,
  custodyRecordUsers,
  deviceKeyHoldsPassport,
  forgetStaleAdoption,
  loadAdoption,
  saveAdoption,
  type AdoptionHandoff,
  type AdoptionStageInput,
} from './custodyAdoption.js';
import { CUSTODY_STORAGE_KEY, type CustodyStorage } from '../identity/custodyContractPlan.js';

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

/** The sign-in that found the Passport, as the host reads it: its address, lowered. */
const SIGN_IN = HANDOFF.socialUser;
/** The key a recovery made on this device, and a key that is somebody's own Passport. */
const NEW_KEY = 'credential-made-for-the-recovery';
const OWN_KEY = 'credential-of-a-passport-made-here';

/** A recovery found by name, with no key made on this device yet, and its sign-in still there. */
function found(over: Partial<AdoptionStageInput> = {}): AdoptionStageInput {
  return {
    handoff: HANDOFF,
    network: 'stagenet',
    credentialId: null,
    holdsPassport: false,
    otherPassports: false,
    socialUser: SIGN_IN,
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

  it('adopts once a key exists here that holds nothing, and the sign-in is still there', () => {
    /* A hand-off not tied to a key yet is the enrolment having just made one:
       the key is new, so it holds no Passport of its own. */
    expect(adoptionStage(found({ credentialId: NEW_KEY }))).toBe('adopt');
  });

  it('adopts with the key it is tied to', () => {
    expect(adoptionStage(found({ handoff: { ...HANDOFF, credentialId: NEW_KEY }, credentialId: NEW_KEY }))).toBe(
      'adopt',
    );
  });

  it('is blocked when the sign-in that found the Passport has gone', () => {
    /* The sign-in is what AUTHORISES the addition — the new key cannot add
       itself — so a session that has gone between the halves is a real stop
       with a real remedy, and not a failure. */
    expect(adoptionStage(found({ credentialId: NEW_KEY, socialUser: null }))).toBe('blocked');
  });

  it('is idle before the app has settled on a network', () => {
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

  it('is idle once the key made for it holds the Passport, and that is not stale', () => {
    /* The pointer the second half writes is how "landed" reads. The chain would
       take a second add harmlessly; the reader would not take a second approval
       on every open harmlessly. And it is the run that landed it that clears
       it, not the staleness rule. */
    const input = found({
      handoff: { ...HANDOFF, credentialId: NEW_KEY },
      credentialId: NEW_KEY,
      holdsPassport: true,
    });
    expect(adoptionStage(input)).toBe('idle');
    expect(adoptionStale(input)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Only the key made for it (2026/09/27)                                      */
/* -------------------------------------------------------------------------- */

describe('a hand-off and the keys that may resume it (the Android hijack, 2026/09/27)', () => {
  it('never takes a device that has its own Passport, with the same sign-in back, and is forgotten', () => {
    /* THE LIVE DEFECT. A recovery failed in this browser and left its hand-off
       behind. A NEW Passport was made here, and added the same Google sign-in
       as its way back — which signed the sign-in in. The screen jumped to
       "Adding this device to …" and offered the new Passport's key to the old
       account, and did it again after every reload. */
    const storage = memoryStorage();
    saveAdoption(storage, HANDOFF);
    const input = found({ handoff: loadAdoption(storage), credentialId: OWN_KEY, holdsPassport: true });

    expect(adoptionStage(input)).toBe('idle');
    expect(adoptionStale(input)).toBe(true);
    expect(forgetStaleAdoption(storage, input)).toBe(true);
    expect(loadAdoption(storage)).toBeNull();
  });

  it('decides it before any wallet has opened: the answer is read from storage alone', () => {
    /* The beat that lost the race before: the profile is set first on every
       enrolment and sign-in, and the wallet's network arrives later. Nothing
       in the input waits for it. */
    const input = found({ credentialId: OWN_KEY, holdsPassport: true });
    expect(adoptionStage(input)).toBe('idle');
  });

  it('is never resumed by a key other than the one it is tied to', () => {
    const bound = { ...HANDOFF, credentialId: NEW_KEY };
    /* Another key that holds nothing here: not this recovery's, and nothing to
       forget it over — the key it is tied to may come back. */
    const other = found({ handoff: bound, credentialId: 'another-new-key' });
    expect(adoptionStage(other)).toBe('idle');
    expect(adoptionStale(other)).toBe(false);
    /* Another key that holds a Passport: forgotten. */
    const owner = found({ handoff: bound, credentialId: OWN_KEY, holdsPassport: true });
    expect(adoptionStage(owner)).toBe('idle');
    expect(adoptionStale(owner)).toBe(true);
  });

  it('waits for its own key rather than asking for a new one once that key exists', () => {
    expect(adoptionStage(found({ handoff: { ...HANDOFF, credentialId: NEW_KEY } }))).toBe('idle');
  });

  it('is forgotten when a different sign-in is signed in', () => {
    const input = found({ credentialId: NEW_KEY, socialUser: '0x2222222222222222222222222222222222222222' });
    expect(adoptionStage(input)).toBe('idle');
    expect(adoptionStale(input)).toBe(true);
  });

  it('compares the sign-in without regard to case', () => {
    const input = found({
      handoff: { ...HANDOFF, socialUser: SIGN_IN.toUpperCase().replace('0X', '0x') },
      credentialId: NEW_KEY,
    });
    expect(adoptionStale(input)).toBe(false);
    expect(adoptionStage(input)).toBe('adopt');
  });

  it('is not stale with nobody signed in, nor with nothing in flight', () => {
    expect(adoptionStale(found({ socialUser: null }))).toBe(false);
    expect(adoptionStale(found({ handoff: null, credentialId: OWN_KEY, holdsPassport: true }))).toBe(false);
    const storage = memoryStorage();
    saveAdoption(storage, HANDOFF);
    expect(forgetStaleAdoption(storage, found({ credentialId: NEW_KEY }))).toBe(false);
    expect(loadAdoption(storage)).toEqual(HANDOFF);
  });
});

describe('a hand-off tied to no key, on a browser that holds another Passport', () => {
  it('is never carried on by a key signed in here, and is forgotten', () => {
    /* A record from before keys were tied, meeting a Passport this browser
       made — even one whose own key cannot be named without a ceremony. */
    const input = found({ credentialId: OWN_KEY, otherPassports: true });
    expect(adoptionStage(input)).toBe('idle');
    expect(adoptionStale(input)).toBe(true);
  });

  it('still waits for its enrolment where no key is signed in', () => {
    expect(adoptionStage(found({ otherPassports: true }))).toBe('enrol');
    expect(adoptionStale(found({ otherPassports: true }))).toBe(false);
  });

  it('is not asked about once it is tied to its key: a shared browser recovers as any other', () => {
    const input = found({
      handoff: { ...HANDOFF, credentialId: NEW_KEY },
      credentialId: NEW_KEY,
      otherPassports: true,
    });
    expect(adoptionStage(input)).toBe('adopt');
    expect(adoptionStale(input)).toBe(false);
  });
});

describe('whether this browser holds a Passport that is not the recovery’s own', () => {
  const none = { handoff: HANDOFF, pointers: {}, prototypeRecords: {}, custodyUsers: [] as string[] };

  it('does not, on a browser that holds nothing', () => {
    expect(browserHoldsOtherPassport(none)).toBe(false);
  });

  it('does not, for the record the second half writes for the sign-in itself', () => {
    expect(browserHoldsOtherPassport({ ...none, custodyUsers: [HANDOFF.socialUser.toUpperCase()] })).toBe(false);
  });

  it('does, for a pointer, a prototype account, or anybody else’s record', () => {
    expect(browserHoldsOtherPassport({ ...none, pointers: { 'any|stagenet': 'jubjub:1' } })).toBe(true);
    expect(browserHoldsOtherPassport({ ...none, prototypeRecords: { 'any::stagenet': {} } })).toBe(true);
    expect(browserHoldsOtherPassport({ ...none, custodyUsers: [HANDOFF.socialUser, 'jubjub:2a1f'] })).toBe(true);
  });
});

describe('whose records this browser holds', () => {
  it('reads the user half of every key, without reading the records', () => {
    const storage = memoryStorage({
      [CUSTODY_RECORDS_KEY]: JSON.stringify({ 'jubjub:2a1f|stagenet': {}, '0xabc|preview': 'rubbish' }),
    });
    expect(custodyRecordUsers(storage)).toEqual(['jubjub:2a1f', '0xabc']);
  });

  it('reads nobody from nothing, from rubbish, from an array, or from a storage that refuses', () => {
    expect(custodyRecordUsers(memoryStorage())).toEqual([]);
    expect(custodyRecordUsers(memoryStorage({ [CUSTODY_RECORDS_KEY]: 'not json' }))).toEqual([]);
    expect(custodyRecordUsers(memoryStorage({ [CUSTODY_RECORDS_KEY]: '[1]' }))).toEqual([]);
    expect(custodyRecordUsers(memoryStorage({ [CUSTODY_RECORDS_KEY]: 'null' }))).toEqual([]);
    expect(custodyRecordUsers(refusingStorage())).toEqual([]);
  });

  it('reads the store the custody client writes', () => {
    expect(CUSTODY_RECORDS_KEY).toBe(CUSTODY_STORAGE_KEY);
  });
});

describe('tying a hand-off to the key made for it', () => {
  it('writes the key into it, and keeps everything else', () => {
    const storage = memoryStorage();
    saveAdoption(storage, HANDOFF);
    expect(bindAdoption(storage, NEW_KEY)).toEqual({ ...HANDOFF, credentialId: NEW_KEY });
    expect(loadAdoption(storage)).toEqual({ ...HANDOFF, credentialId: NEW_KEY });
  });

  it('never moves it to another key', () => {
    const storage = memoryStorage();
    saveAdoption(storage, { ...HANDOFF, credentialId: NEW_KEY });
    expect(bindAdoption(storage, 'another-key')).toEqual({ ...HANDOFF, credentialId: NEW_KEY });
    expect(loadAdoption(storage)?.credentialId).toBe(NEW_KEY);
  });

  it('writes nothing when there is nothing in flight', () => {
    const storage = memoryStorage();
    expect(bindAdoption(storage, NEW_KEY)).toBeNull();
    expect(storage.getItem(CUSTODY_ADOPT_KEY)).toBeNull();
  });
});

describe('whether a key holds a Passport of its own here', () => {
  const noRecords = {};

  it('does, with a pointer on any network', () => {
    expect(
      deviceKeyHoldsPassport({
        credentialId: OWN_KEY,
        pointers: { [`${OWN_KEY}|preview`]: 'jubjub:1' },
        prototypeRecords: noRecords,
      }),
    ).toBe(true);
  });

  it('does, with a prototype account record of any status', () => {
    expect(
      deviceKeyHoldsPassport({
        credentialId: OWN_KEY,
        pointers: {},
        prototypeRecords: { [`${OWN_KEY}::stagenet`]: { credentialId: OWN_KEY } },
      }),
    ).toBe(true);
  });

  it('does not, for a key whose only neighbours are other keys', () => {
    /* A credential that merely STARTS the same is another credential: the
       pointer key is `credential|network`, and the bar is part of the match. */
    expect(
      deviceKeyHoldsPassport({
        credentialId: NEW_KEY,
        pointers: { [`${NEW_KEY}-other|stagenet`]: 'jubjub:2', [`${OWN_KEY}|stagenet`]: 'jubjub:1' },
        prototypeRecords: { [`${OWN_KEY}::stagenet`]: { credentialId: OWN_KEY } },
      }),
    ).toBe(false);
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

  it('reads a record written before the key was tied to it, as not tied', () => {
    /* The recoveries that were in flight when the field arrived. */
    const storage = memoryStorage({ [CUSTODY_ADOPT_KEY]: JSON.stringify(HANDOFF) });
    expect(loadAdoption(storage)).toEqual(HANDOFF);
    expect(loadAdoption(storage)?.credentialId).toBeUndefined();
  });

  it('reads as nothing when the key it is tied to is not a key', () => {
    for (const credentialId of ['', 7, null]) {
      const raw = JSON.stringify({ ...HANDOFF, credentialId });
      expect(loadAdoption(memoryStorage({ [CUSTODY_ADOPT_KEY]: raw }))).toBeNull();
    }
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

describe('what a hand-off that did not finish says (2026/09/26)', () => {
  const sentences = [
    ADOPTION_NOT_ADDED,
    ADOPTION_UNCONFIRMED,
    ADOPTION_PASSKEY_DECLINED,
    ADOPTION_OTHER_SIGN_IN,
    ADOPTION_OTHER_PASSPORT,
  ];

  it('never says what holds the Passport', () => {
    const everything = sentences.join(' ');
    for (const banned of [
      'wallet address',
      'DUST',
      'contract',
      'registry',
      'indexer',
      'resolver',
      'sponsor',
      'SDK',
      'Dynamic',
    ]) {
      expect(everything).not.toContain(banned);
    }
  });

  it('is one plain sentence or two each, and every one says what the press will do or why not', () => {
    for (const sentence of sentences) {
      expect(sentence.length).toBeGreaterThan(0);
      expect(sentence.endsWith('.')).toBe(true);
    }
    /* The three a press can cure point at it. */
    for (const sentence of [ADOPTION_NOT_ADDED, ADOPTION_UNCONFIRMED, ADOPTION_PASSKEY_DECLINED]) {
      expect(sentence).toContain('Try again');
    }
  });
});
