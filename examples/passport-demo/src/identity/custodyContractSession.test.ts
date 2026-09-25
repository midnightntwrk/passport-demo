/**
 * The Dynamic-only session's rules, drilled to the branch.
 *
 * WHAT THESE TESTS ARE PROTECTING
 * ------------------------------
 * Two of them matter more than the rest and are worth naming here rather than
 * leaving to be inferred from an `it` string:
 *
 *   - "a passkey profile always wins". If that ever stops being true, a passkey
 *     holder who signs in with Google to look at the identity row is shown a
 *     Dynamic Passport instead of their own — and the one they cannot see is
 *     the one holding the money.
 *   - "a read that did not complete is unreachable, never not-yours". The whole
 *     of `nameRecovery.ts`'s header is about that distinction, and this module
 *     adds two more reads that can fail. A `false` where a `null` belongs tells
 *     somebody their Passport is not theirs because an indexer was slow.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  DYNAMIC_SETUP_STEPS,
  CUSTODY_MARKER_CIRCUIT,
  custodyArmFromOperations,
  CUSTODY_NAME_KEY,
  choosePassportIdentity,
  dynamicSetupAction,
  dynamicSetupCopy,
  dynamicSetupInterrupted,
  dynamicSetupInterruptedAnywhere,
  dynamicSetupPhase,
  dynamicSetupStep,
  dynamicStage,
  dynamicUserKey,
  custodyNameKey,
  CUSTODY_CHOSEN_NAME_KEY,
  forgetCustodyChosenName,
  loadCustodyChosenName,
  loadCustodyChosenNames,
  saveCustodyChosenName,
  k1PrivateStateId,
  custodyRecoveryOutcome,
  loadCustodyName,
  loadCustodyNames,
  readDynamicPassport,
  recoveredCustodyRecord,
  saveCustodyName,
} from './custodyContractSession.js';
import { CUSTODY_STORAGE_KEY, custodyRecordKey, type CustodyAccountRecord, type CustodyStorage } from './custodyContractPlan.js';
import type { ResolvedName } from '../lib/nameRecovery.js';

/** A storage a test owns outright. Three methods, exactly as the module takes. */
function memoryStorage(seed: Record<string, string> = {}): CustodyStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** A storage that refuses everything, the way a browser blocking site data does. */
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

const RECORD: CustodyAccountRecord = {
  user: '0xabcdef0123456789abcdef0123456789abcdef01',
  network: 'stagenet',
  address: 'aa'.repeat(32),
  privateStateId: 'passport-account-custody-abcdef01',
  saltHex: 'bb'.repeat(32),
  pkXHex: '1',
  pkYHex: '2',
  wavesDone: 3,
  totalWaves: 3,
  activated: true,
  txHashes: [],
};

const RESOLVED: ResolvedName = {
  resolverAddress: 'cc'.repeat(32),
  target: { kind: 'contract', hex: 'aa'.repeat(32) },
};

describe('choosePassportIdentity', () => {
  it('answers passkey whenever a profile exists, whatever the sign-in says', () => {
    expect(
      choosePassportIdentity({
        hasPasskeyProfile: true,
        dynamicStatus: 'signed-in',
        evmAddress: '0xAbC',
      }),
    ).toBe('passkey');
  });

  it('answers none when nothing is signed in', () => {
    expect(
      choosePassportIdentity({
        hasPasskeyProfile: false,
        dynamicStatus: 'disabled',
        evmAddress: null,
      }),
    ).toBe('none');
    expect(
      choosePassportIdentity({
        hasPasskeyProfile: false,
        dynamicStatus: 'signed-out',
        evmAddress: null,
      }),
    ).toBe('none');
  });

  it('answers none for the beat between signing in and having an address', () => {
    expect(
      choosePassportIdentity({
        hasPasskeyProfile: false,
        dynamicStatus: 'signed-in',
        evmAddress: '   ',
      }),
    ).toBe('none');
  });

  it('answers none, not dynamic, while a passkey session is still being reopened', () => {
    expect(
      choosePassportIdentity({
        hasPasskeyProfile: false,
        dynamicStatus: 'signed-in',
        evmAddress: '0xAbC',
        passkeyRestoring: true,
      }),
    ).toBe('none');
    /* The profile, once back, wins as it always has. */
    expect(
      choosePassportIdentity({
        hasPasskeyProfile: true,
        dynamicStatus: 'signed-in',
        evmAddress: '0xAbC',
        passkeyRestoring: true,
      }),
    ).toBe('passkey');
    /* And a restore that has ended hands the sign-in its answer back. */
    expect(
      choosePassportIdentity({
        hasPasskeyProfile: false,
        dynamicStatus: 'signed-in',
        evmAddress: '0xAbC',
        passkeyRestoring: false,
      }),
    ).toBe('dynamic');
  });

  it('answers dynamic for a signed-in session with an address and no passkey', () => {
    expect(
      choosePassportIdentity({
        hasPasskeyProfile: false,
        dynamicStatus: 'signed-in',
        evmAddress: '0xAbC',
      }),
    ).toBe('dynamic');
  });
});

describe('dynamicUserKey', () => {
  it('lower-cases, so a checksummed address is one user and not two', () => {
    expect(dynamicUserKey('0xAbCdEf')).toBe('0xabcdef');
  });

  it('reads a blank, a whitespace string, and a non-string as no user', () => {
    expect(dynamicUserKey('')).toBeNull();
    expect(dynamicUserKey('  ')).toBeNull();
    expect(dynamicUserKey(null)).toBeNull();
    expect(dynamicUserKey(undefined)).toBeNull();
    expect(dynamicUserKey(7 as unknown as string)).toBeNull();
  });
});

describe('dynamicStage', () => {
  it('is sign-in for any identity that is not the Dynamic one', () => {
    expect(dynamicStage({ identity: 'passkey', record: RECORD, name: 'alice' })).toBe('sign-in');
    expect(dynamicStage({ identity: 'none', record: null, name: null })).toBe('sign-in');
  });

  it('offers to create when nothing is stored', () => {
    expect(dynamicStage({ identity: 'dynamic', record: null, name: null })).toBe('create');
  });

  it('offers to create when a record exists with no address yet', () => {
    expect(
      dynamicStage({ identity: 'dynamic', record: { ...RECORD, address: null }, name: null }),
    ).toBe('create');
  });

  it('resumes a setup that has an address and is unfinished', () => {
    expect(
      dynamicStage({
        identity: 'dynamic',
        record: { ...RECORD, wavesDone: 1, activated: false },
        name: null,
      }),
    ).toBe('resume');
    expect(
      dynamicStage({ identity: 'dynamic', record: { ...RECORD, activated: false }, name: null }),
    ).toBe('resume');
  });

  it('asks for a name once the Passport is usable, then goes home', () => {
    expect(dynamicStage({ identity: 'dynamic', record: RECORD, name: null })).toBe('name');
    expect(dynamicStage({ identity: 'dynamic', record: RECORD, name: 'alice' })).toBe('home');
  });

  /* Usable is ACTIVATED, not every wave in: the rest land behind Home. */
  it('goes home with waves still to land once the key is on', () => {
    expect(
      dynamicStage({ identity: 'dynamic', record: { ...RECORD, wavesDone: 1 }, name: 'alice' }),
    ).toBe('home');
  });
});

describe('the setup copy', () => {
  it('counts three steps, whatever the wave plan does', () => {
    expect(DYNAMIC_SETUP_STEPS).toBe(3);
    expect(dynamicSetupCopy('create')).toBe('Setting up your Passport, step 1 of 3');
    expect(dynamicSetupCopy('activate')).toBe('Setting up your Passport, step 2 of 3');
    expect(dynamicSetupCopy('finish')).toBe('Setting up your Passport, step 3 of 3');
    expect(dynamicSetupCopy('done')).toBe('Your Passport is ready.');
  });

  it('reads the phase off the record', () => {
    expect(dynamicSetupPhase(null)).toBe('create');
    expect(dynamicSetupPhase({ ...RECORD, address: null })).toBe('create');
    /* Activated with waves still to land: the finishing is the LAST step now. */
    expect(dynamicSetupPhase({ ...RECORD, wavesDone: 1 })).toBe('finish');
    expect(dynamicSetupPhase({ ...RECORD, activated: false })).toBe('activate');
    expect(dynamicSetupPhase({ ...RECORD, wavesDone: 1, activated: false })).toBe('activate');
    expect(dynamicSetupPhase(RECORD)).toBe('done');
    /* A setup that cannot be finished is back at the beginning, not `done`,
       which is what it would otherwise fall through to — and "Your Passport is
       ready" over a Passport that can never work is the worst sentence on the
       screen. */
    expect(dynamicSetupPhase({ ...RECORD, activated: false, interrupted: true })).toBe('create');
  });

  it('numbers the phases, and puts done past the last one', () => {
    expect(dynamicSetupStep('create')).toBe(1);
    expect(dynamicSetupStep('activate')).toBe(2);
    expect(dynamicSetupStep('finish')).toBe(3);
    expect(dynamicSetupStep('done')).toBe(3);
  });

  it('never offers to CREATE over a setup that has already started', () => {
    expect(dynamicSetupAction(null)).toBe('Create my Passport');
    expect(dynamicSetupAction({ ...RECORD, address: null })).toBe('Create my Passport');
    expect(dynamicSetupAction({ ...RECORD, wavesDone: 1 })).toBe(
      'Finish setting up my Passport',
    );
    /* And never offers to FINISH one that cannot be finished: the key that
       signs the remaining steps is gone, so that button fails every press. */
    expect(dynamicSetupAction({ ...RECORD, wavesDone: 1, interrupted: true })).toBe(
      'Start again',
    );
  });

  /* THE ANSWER A SCREEN MUST NOT HAVE TO FAIL TO LEARN. Both setup screens kept
     "this setup cannot be finished" in React state that began false on every
     load, so a reload offered to create a Passport over an interrupted record
     and the press under it threw `CUSTODY_SETUP_INTERRUPTED`. The record knew. */
  it('reads an interrupted setup off the record, so a reload does not have to fail first', () => {
    expect(dynamicSetupInterrupted(null)).toBe(false);
    expect(dynamicSetupInterrupted(RECORD)).toBe(false);
    expect(dynamicSetupInterrupted({ ...RECORD, wavesDone: 1 })).toBe(false);
    expect(
      dynamicSetupInterrupted({ ...RECORD, wavesDone: 1, activated: false, interrupted: true }),
    ).toBe(true);
    /* And an interrupted record whose key is ON is a working Passport. */
    expect(dynamicSetupInterrupted({ ...RECORD, wavesDone: 1, interrupted: true })).toBe(false);
  });

  it('answers for a sign-in whose network is not to hand, and for nobody else', () => {
    const halted: CustodyAccountRecord = {
      ...RECORD,
      wavesDone: 1,
      activated: false,
      interrupted: true,
    };
    const other = '0x00000000000000000000000000000000000000ff';
    const storage = memoryStorage({
      [CUSTODY_STORAGE_KEY]: JSON.stringify({
        [custodyRecordKey(RECORD.user, 'stagenet')]: RECORD,
        [custodyRecordKey(RECORD.user, 'undeployed')]: halted,
        [custodyRecordKey(other, 'stagenet')]: halted,
      }),
    });
    /* One of this sign-in's records is halted, on a network the milestone
       screen cannot name, and that is the whole reason every network is asked. */
    expect(dynamicSetupInterruptedAnywhere(storage, RECORD.user)).toBe(true);
    /* The case on the address is the record key's, not the caller's. */
    expect(dynamicSetupInterruptedAnywhere(storage, RECORD.user.toUpperCase())).toBe(true);
    /* SOMEBODY ELSE'S HALTED SETUP IS NOT OURS. A prefix that matched loosely
       would put "Start again" in front of a person whose own Passport is fine. */
    const onlyOurs = memoryStorage({
      [CUSTODY_STORAGE_KEY]: JSON.stringify({ [custodyRecordKey(other, 'stagenet')]: halted }),
    });
    expect(dynamicSetupInterruptedAnywhere(onlyOurs, RECORD.user)).toBe(false);
    /* Nothing stored, and no sign-in yet: both are "no", and neither throws. */
    expect(dynamicSetupInterruptedAnywhere(memoryStorage(), RECORD.user)).toBe(false);
    expect(dynamicSetupInterruptedAnywhere(storage, null)).toBe(false);
    expect(dynamicSetupInterruptedAnywhere(storage, '')).toBe(false);
    /* A browser refusing site data answers "no" rather than throwing at a
       screen that is only deciding what a button says. */
    expect(dynamicSetupInterruptedAnywhere(refusingStorage(), RECORD.user)).toBe(false);
  });
});

describe('the name store', () => {
  it('keys the same way the record store does', () => {
    expect(custodyNameKey('0xABC', 'stagenet')).toBe('0xabc|stagenet');
    expect(custodyNameKey('0xabc', 'stagenet')).toBe(custodyRecordKey('0xABC', 'stagenet'));
  });

  it('round-trips a name', () => {
    const storage = memoryStorage();
    saveCustodyName(storage, '0xABC', 'stagenet', 'alice');
    expect(loadCustodyName(storage, '0xabc', 'stagenet')).toBe('alice');
    expect(storage.map.has(CUSTODY_NAME_KEY)).toBe(true);
  });

  it('merges rather than replacing', () => {
    const storage = memoryStorage();
    saveCustodyName(storage, '0xa', 'stagenet', 'alice');
    saveCustodyName(storage, '0xb', 'stagenet', 'bob');
    expect(loadCustodyNames(storage)).toEqual({ '0xa|stagenet': 'alice', '0xb|stagenet': 'bob' });
  });

  it('reads nothing stored, a storage that throws, and rubbish as empty', () => {
    expect(loadCustodyNames(memoryStorage())).toEqual({});
    expect(loadCustodyNames(refusingStorage())).toEqual({});
    expect(loadCustodyNames(memoryStorage({ [CUSTODY_NAME_KEY]: 'not json' }))).toEqual({});
    expect(loadCustodyNames(memoryStorage({ [CUSTODY_NAME_KEY]: 'null' }))).toEqual({});
    expect(loadCustodyNames(memoryStorage({ [CUSTODY_NAME_KEY]: '[]' }))).toEqual({});
  });

  it('drops entries that are not names, so a bad write cannot become a label', () => {
    const stored = JSON.stringify({ 'a|stagenet': 3, 'b|stagenet': '', 'c|stagenet': 'carol' });
    expect(loadCustodyNames(memoryStorage({ [CUSTODY_NAME_KEY]: stored }))).toEqual({
      'c|stagenet': 'carol',
    });
  });

  it('answers null for a user with no name', () => {
    expect(loadCustodyName(memoryStorage(), '0xa', 'stagenet')).toBeNull();
  });

  it('says so in the console rather than on screen when a write is refused', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    saveCustodyName(refusingStorage(), '0xa', 'stagenet', 'alice');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('the name a Passport CHOSE and has not claimed', () => {
  it('is kept in its own key, apart from the one it holds', () => {
    const storage = memoryStorage();
    saveCustodyChosenName(storage, '0xA', 'stagenet', 'alice');
    /* The claimed store is untouched: a typed name is not a registration, and
       everything downstream of `CUSTODY_NAME_KEY` treats what is in it as one. */
    expect(storage.getItem(CUSTODY_NAME_KEY)).toBeNull();
    expect(loadCustodyChosenName(storage, '0xa', 'stagenet')).toBe('alice');
  });

  it('is per user and per network, like everything else this Passport owns', () => {
    const storage = memoryStorage();
    saveCustodyChosenName(storage, '0xa', 'stagenet', 'alice');
    saveCustodyChosenName(storage, '0xb', 'stagenet', 'bob');
    expect(loadCustodyChosenName(storage, '0xa', 'stagenet')).toBe('alice');
    expect(loadCustodyChosenName(storage, '0xb', 'stagenet')).toBe('bob');
    expect(loadCustodyChosenName(storage, '0xa', 'preview')).toBeNull();
  });

  it('is forgotten when the claim settles, either way', () => {
    const storage = memoryStorage();
    saveCustodyChosenName(storage, '0xa', 'stagenet', 'alice');
    saveCustodyChosenName(storage, '0xb', 'stagenet', 'bob');
    forgetCustodyChosenName(storage, '0xa', 'stagenet');
    expect(loadCustodyChosenName(storage, '0xa', 'stagenet')).toBeNull();
    /* And nobody else's is taken with it. */
    expect(loadCustodyChosenName(storage, '0xb', 'stagenet')).toBe('bob');
  });

  it('reads a store that is not a map of names as empty', () => {
    /* Not JSON at all, and JSON that is not an object of strings. Both are a
       store somebody else wrote, and neither is a reason to refuse a setup. */
    expect(loadCustodyChosenNames(memoryStorage({ [CUSTODY_CHOSEN_NAME_KEY]: '{' }))).toEqual({});
    expect(loadCustodyChosenNames(memoryStorage({ [CUSTODY_CHOSEN_NAME_KEY]: '[]' }))).toEqual({});
    expect(
      loadCustodyChosenNames(memoryStorage({ [CUSTODY_CHOSEN_NAME_KEY]: '{"a|b":7,"c|d":""}' })),
    ).toEqual({});
  });

  it('says so in the console when the forgetting itself is refused', () => {
    /* A store that reads and will not be written — which is where a name that
       has been claimed would otherwise sit forever, offering to claim it
       again. The console is told; the screen is not, because the claim
       succeeded. */
    const readable = memoryStorage();
    saveCustodyChosenName(readable, '0xa', 'stagenet', 'alice');
    const storage: CustodyStorage = {
      getItem: (key) => readable.getItem(key),
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    forgetCustodyChosenName(storage, '0xa', 'stagenet');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('forgets nothing it was not holding', () => {
    const storage = memoryStorage();
    forgetCustodyChosenName(storage, '0xa', 'stagenet');
    expect(loadCustodyChosenNames(storage)).toEqual({});
  });

  it('reads a storage that throws as empty rather than refusing the setup', () => {
    expect(loadCustodyChosenNames(refusingStorage())).toEqual({});
    expect(loadCustodyChosenName(refusingStorage(), '0xa', 'stagenet')).toBeNull();
  });

  it('says so in the console rather than on screen when a write is refused', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    saveCustodyChosenName(refusingStorage(), '0xa', 'stagenet', 'alice');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('readDynamicPassport', () => {
  it('carries the chosen name beside the claimed one, never merged into it', () => {
    const storage = memoryStorage({
      [CUSTODY_STORAGE_KEY]: JSON.stringify({ [custodyRecordKey(RECORD.user, 'stagenet')]: RECORD }),
    });
    saveCustodyChosenName(storage, RECORD.user, 'stagenet', 'alice');
    const view = readDynamicPassport({ storage, user: RECORD.user, network: 'stagenet' });
    expect(view.chosenName).toBe('alice');
    /* A Passport with a name it has only TYPED has not got a name. */
    expect(view.name).toBeNull();
    expect(view.stage).toBe('name');
  });

  it('assembles the record, the name, and the stage in one read', () => {
    const storage = memoryStorage({
      [CUSTODY_STORAGE_KEY]: JSON.stringify({ [custodyRecordKey(RECORD.user, 'stagenet')]: RECORD }),
      [CUSTODY_NAME_KEY]: JSON.stringify({ [custodyNameKey(RECORD.user, 'stagenet')]: 'alice' }),
    });
    expect(readDynamicPassport({ storage, user: RECORD.user.toUpperCase(), network: 'stagenet' })).toEqual({
      user: RECORD.user,
      network: 'stagenet',
      record: RECORD,
      name: 'alice',
      chosenName: null,
      address: RECORD.address,
      stage: 'home',
    });
  });

  it('answers a user who has nothing with the create stage and no address', () => {
    const view = readDynamicPassport({ storage: memoryStorage(), user: '0xa', network: 'stagenet' });
    expect(view.record).toBeNull();
    expect(view.address).toBeNull();
    expect(view.stage).toBe('create');
  });
});

describe('custodyRecoveryOutcome', () => {
  it('is unreachable when the circuit list could not be read', () => {
    expect(custodyRecoveryOutcome(RESOLVED, { operations: null, holdsDevice: true })).toEqual({
      kind: 'unreachable',
      detail: 'Midnight could not be reached to check that name. Try again in a moment.',
    });
  });

  it('is not-yours when the name belongs to a passkey Passport', () => {
    expect(
      custodyRecoveryOutcome(RESOLVED, { operations: ['withdraw_night'], holdsDevice: true }),
    ).toEqual({ kind: 'not-yours' });
  });

  it('is unreachable when the device set could not be read', () => {
    expect(
      custodyRecoveryOutcome(RESOLVED, { operations: [CUSTODY_MARKER_CIRCUIT], holdsDevice: null }),
    ).toEqual({
      kind: 'unreachable',
      detail: 'Midnight could not be reached to check that name. Try again in a moment.',
    });
  });

  it('is not-yours when this sign-in is not one of the account devices', () => {
    expect(
      custodyRecoveryOutcome(RESOLVED, { operations: [CUSTODY_MARKER_CIRCUIT], holdsDevice: false }),
    ).toEqual({ kind: 'not-yours' });
  });

  it('is found, carrying the address and the leaf, when both reads say yes', () => {
    expect(
      custodyRecoveryOutcome(RESOLVED, { operations: [CUSTODY_MARKER_CIRCUIT], holdsDevice: true }),
    ).toEqual({
      kind: 'found',
      address: RESOLVED.target.hex,
      resolverAddress: RESOLVED.resolverAddress,
    });
  });
});

describe('recoveredCustodyRecord', () => {
  it('writes a FINISHED record, because the chain has just said it is one', () => {
    const record = recoveredCustodyRecord({
      user: '0xABCDEF0123456789',
      network: 'stagenet',
      address: RECORD.address as string,
      privateStateId: 'passport-account-custody-abcdef01',
      pkXHex: '1',
      pkYHex: '2',
    });
    expect(record.user).toBe('0xabcdef0123456789');
    expect(record.wavesDone).toBe(3);
    expect(record.totalWaves).toBe(3);
    expect(record.activated).toBe(true);
    /* The salt opens the boot commitment, and activation has already happened.
       Inventing one would put a value in storage that is not true here. */
    expect(record.saltHex).toBe('');
    expect(record.txHashes).toEqual([]);
  });

  it('takes a wave count when the caller knows a different one', () => {
    const record = recoveredCustodyRecord({
      user: '0xa',
      network: 'stagenet',
      address: RECORD.address as string,
      privateStateId: 'x',
      pkXHex: '1',
      pkYHex: '2',
      totalWaves: 4,
    });
    expect(record.wavesDone).toBe(4);
    expect(record.totalWaves).toBe(4);
  });
});

describe('k1PrivateStateId', () => {
  it('composes the id the deploy composes, so both devices read one store', () => {
    expect(k1PrivateStateId('0xABCDEF0123456789')).toBe('passport-account-custody-abcdef01');
  });
});

/* -------------------------------------------------------------------------- */
/* Which build, and which arm, a list of entry points is                      */
/* -------------------------------------------------------------------------- */

/**
 * The marker and the arm, on lists of names taken from the compiled modules.
 *
 * THE LISTS ARE REAL. They were read off
 * `contracts/stagenet/<module>/contract/index.js` on 2026/09/18 rather than
 * recalled, which is the difference between drilling the rule and drilling a
 * memory of it: the list this repository used to call the prototype's carried
 * `deposit_unshielded`, a name no prototype has ever declared.
 */
describe('CUSTODY_MARKER_CIRCUIT', () => {
  /* Wave 1 of a jubjub-born account: the two deposits and the jubjub arm. */
  const JUBJUB_WAVE_ONE = [
    'deposit_unshielded',
    'deposit_shielded',
    'activate_initial_device_with_jubjub',
    'append_inbox_with_jubjub',
    'withdraw_shielded_with_jubjub',
  ];
  /* Wave 1 of a k256-born account. */
  const K256_WAVE_ONE = [
    'deposit_unshielded',
    'deposit_shielded',
    'activate_initial_device_with_k256',
    'append_inbox_with_k256',
    'withdraw_shielded_with_k256',
  ];
  /* The eleven-circuit prototype's own names, in full. */
  const PROTOTYPE = [
    'add_device',
    'add_grant',
    'deposit_night',
    'deposit_shielded',
    'grant_withdraw_night',
    'grant_withdraw_shielded',
    'recover',
    'remove_device',
    'revoke_grant',
    'withdraw_night',
    'withdraw_shielded',
  ];

  it('is a name wave 1 of EITHER arm already carries', () => {
    expect(JUBJUB_WAVE_ONE).toContain(CUSTODY_MARKER_CIRCUIT);
    expect(K256_WAVE_ONE).toContain(CUSTODY_MARKER_CIRCUIT);
  });

  it('is a name no prototype carries', () => {
    expect(PROTOTYPE).not.toContain(CUSTODY_MARKER_CIRCUIT);
    /* And the near miss that makes the point: the prototypes DO have an
       unshielded deposit, under another name. */
    expect(PROTOTYPE).toContain('deposit_night');
  });

  it('is not the k256 gated circuit any more, which wave 1 of a passkey account lacks', () => {
    expect(JUBJUB_WAVE_ONE).not.toContain('withdraw_shielded_with_k256');
    expect(CUSTODY_MARKER_CIRCUIT).not.toBe('withdraw_shielded_with_k256');
  });
});

describe('custodyArmFromOperations', () => {
  const JUBJUB_WAVE_ONE = [
    'deposit_unshielded',
    'deposit_shielded',
    'activate_initial_device_with_jubjub',
  ];
  const K256_WAVE_ONE = [
    'deposit_unshielded',
    'deposit_shielded',
    'activate_initial_device_with_k256',
  ];

  it('reads a passkey-born account off its own activation circuit', () => {
    expect(custodyArmFromOperations(JUBJUB_WAVE_ONE)).toBe('jubjub');
  });

  it('reads a sign-in-born account off its own activation circuit', () => {
    expect(custodyArmFromOperations(K256_WAVE_ONE)).toBe('k256');
  });

  it('refuses to guess for a finished account, which carries both activations', () => {
    /* Deliberately null rather than a guess: the roster the last wave leaves
       behind is the same for both arms, and a caller that needs the answer
       holds the device and can ask the device set. */
    expect(custodyArmFromOperations([...JUBJUB_WAVE_ONE, ...K256_WAVE_ONE])).toBeNull();
  });

  it('is null for a prototype, which has no arm at all', () => {
    expect(custodyArmFromOperations(['deposit_night', 'withdraw_shielded'])).toBeNull();
  });

  it('is null for a read that did not complete, which is never an answer', () => {
    expect(custodyArmFromOperations(null)).toBeNull();
  });

  it('is null for an account custody account with neither activation, which cannot happen', () => {
    /* Not reachable from any wave plan — wave 1 carries one of them — but the
       function must not answer a question it has not been given evidence for. */
    expect(custodyArmFromOperations(['deposit_unshielded', 'deposit_shielded'])).toBeNull();
  });
});

