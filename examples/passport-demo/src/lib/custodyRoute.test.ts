/**
 * The passkey pointer, and the rule that reads it.
 *
 * A ROUTE AND NOT A RECORD, which is what every case below is about: it says
 * which screen to open and never what an account is. The stores it points AT
 * are keyed by the device point, which costs an assertion to reach; this is
 * what the app asks on open, because a routing decision made on every open
 * cannot cost a fingerprint.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  CUSTODY_PASSKEY_KEY,
  custodyPasskeyKey,
  loadCustodyPasskeyPointer,
  loadCustodyPasskeyPointers,
  passkeyPassportRoute,
  saveCustodyPasskeyPointer,
} from './custodyRoute.js';
import type { CustodyStorage } from '../identity/custodyContractPlan.js';

/** A storage a test owns outright. Three methods, exactly as the module takes. */
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

/* -------------------------------------------------------------------------- */
/* Which Passport a passkey on this device holds                              */
/* -------------------------------------------------------------------------- */

describe('the passkey pointer', () => {
  const CREDENTIAL = 'AQIDBAUGBwgJCg';
  const USER = 'jubjub:2a1f';

  it('keys by credential and network, and does not lower the credential id', () => {
    /* A credential id is base64url, where case is data. Lowering it the way a
       Dynamic address is lowered would file two passkeys under one key. */
    expect(custodyPasskeyKey(CREDENTIAL, 'TestNet')).toBe('AQIDBAUGBwgJCg|TestNet');
  });

  it('remembers which Passport a passkey holds, and reads it back', () => {
    const storage = memoryStorage();
    saveCustodyPasskeyPointer(storage, CREDENTIAL, 'TestNet', USER);
    expect(loadCustodyPasskeyPointer(storage, CREDENTIAL, 'TestNet')).toBe(USER);
  });

  it('keeps a second passkey in the same browser apart from the first', () => {
    const storage = memoryStorage();
    saveCustodyPasskeyPointer(storage, CREDENTIAL, 'TestNet', USER);
    saveCustodyPasskeyPointer(storage, 'OTHER', 'TestNet', 'jubjub:99ff');
    expect(loadCustodyPasskeyPointer(storage, CREDENTIAL, 'TestNet')).toBe(USER);
    expect(loadCustodyPasskeyPointer(storage, 'OTHER', 'TestNet')).toBe('jubjub:99ff');
  });

  it('keeps one passkey apart on two networks', () => {
    const storage = memoryStorage();
    saveCustodyPasskeyPointer(storage, CREDENTIAL, 'TestNet', USER);
    expect(loadCustodyPasskeyPointer(storage, CREDENTIAL, 'Undeployed')).toBeNull();
  });

  it('has no pointer for a passkey it has never seen', () => {
    expect(loadCustodyPasskeyPointer(memoryStorage(), CREDENTIAL, 'TestNet')).toBeNull();
  });

  it('reads a storage that throws as empty rather than refusing to open', () => {
    expect(loadCustodyPasskeyPointers(refusingStorage())).toEqual({});
  });

  it('reads nonsense in the slot as empty', () => {
    expect(loadCustodyPasskeyPointers(memoryStorage({ [CUSTODY_PASSKEY_KEY]: 'not json' }))).toEqual({});
    expect(loadCustodyPasskeyPointers(memoryStorage({ [CUSTODY_PASSKEY_KEY]: '[1,2]' }))).toEqual({});
    expect(loadCustodyPasskeyPointers(memoryStorage({ [CUSTODY_PASSKEY_KEY]: 'null' }))).toEqual({});
  });

  it('drops entries that are not a non-empty string', () => {
    const storage = memoryStorage({
      [CUSTODY_PASSKEY_KEY]: JSON.stringify({ a: 1, b: '', c: USER }),
    });
    expect(loadCustodyPasskeyPointers(storage)).toEqual({ c: USER });
  });

  it('says so and carries on when the pointer cannot be written', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      saveCustodyPasskeyPointer(refusingStorage(), CREDENTIAL, 'TestNet', USER),
    ).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('passkeyPassportRoute', () => {
  it('sends a passkey with a prototype account to the flow it has always had', () => {
    expect(passkeyPassportRoute({ hasPrototypeAccount: true, custodyUser: null })).toBe('legacy');
  });

  it('sends a passkey with an account custody Passport to that Passport', () => {
    expect(passkeyPassportRoute({ hasPrototypeAccount: false, custodyUser: 'jubjub:2a1f' })).toBe(
      'custody',
    );
  });

  it('sends a passkey with neither to a NEW Passport, which is made on the new contract', () => {
    expect(passkeyPassportRoute({ hasPrototypeAccount: false, custodyUser: null })).toBe('new');
  });

  it('prefers a working prototype Passport over any pointer beside it', () => {
    /* The reverse ordering would take somebody's money off their screen on the
       strength of a pointer written by a setup that failed. */
    expect(
      passkeyPassportRoute({ hasPrototypeAccount: true, custodyUser: 'jubjub:2a1f' }),
    ).toBe('legacy');
  });
});
