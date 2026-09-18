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
  accountCustodyEnabled,
  CUSTODY_OTHER_KEY_NOTICE,
  CUSTODY_PASSKEY_KEY,
  custodyOtherKeyNotice,
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

describe('what a browser holding somebody else’s Passport is told first', () => {
  const CREDENTIAL = 'AQIDBAUGBwgJCg';
  const USER = 'jubjub:2a1f';
  const OTHER = 'a-second-key-on-this-laptop';

  /* THE POINTER IS PER CREDENTIAL, so `new` means "no Passport for THIS key
     here" and not "no Passport here". A browser two keys have been used on
     answers `new` for the second while plainly holding the first's Passport,
     and the screen offered to create one with nothing said — so somebody who
     picked the wrong key at the browser's prompt made a SECOND Passport, with
     a second name to claim and a second balance to fund, and nothing on the
     screen said the first was still there. */
  it('says what the browser holds when the key that signed in is a different one', () => {
    expect(
      custodyOtherKeyNotice({
        route: 'new',
        pointers: { [custodyPasskeyKey(OTHER, 'TestNet')]: 'jubjub:99ff' },
        credentialId: CREDENTIAL,
        network: 'TestNet',
      }),
    ).toBe(CUSTODY_OTHER_KEY_NOTICE);
  });

  it('says nothing when the only Passport here is this key’s own', () => {
    expect(
      custodyOtherKeyNotice({
        route: 'new',
        pointers: { [custodyPasskeyKey(CREDENTIAL, 'TestNet')]: USER },
        credentialId: CREDENTIAL,
        network: 'TestNet',
      }),
    ).toBeNull();
  });

  it('says nothing about a Passport on another network, which this screen cannot open', () => {
    expect(
      custodyOtherKeyNotice({
        route: 'new',
        pointers: { [custodyPasskeyKey(OTHER, 'Undeployed')]: 'jubjub:99ff' },
        credentialId: CREDENTIAL,
        network: 'TestNet',
      }),
    ).toBeNull();
  });

  it('says nothing to a browser that holds nothing at all', () => {
    expect(
      custodyOtherKeyNotice({
        route: 'new',
        pointers: {},
        credentialId: CREDENTIAL,
        network: 'TestNet',
      }),
    ).toBeNull();
  });

  /* ONLY IN FRONT OF THE OFFER. A holder being sent to their own Passport is
     not being offered anything and has nothing to be warned about. */
  it('says nothing to a holder who is being sent to a Passport rather than offered one', () => {
    const pointers = { [custodyPasskeyKey(OTHER, 'TestNet')]: 'jubjub:99ff' };
    for (const route of ['custody', 'legacy'] as const) {
      expect(
        custodyOtherKeyNotice({ route, pointers, credentialId: CREDENTIAL, network: 'TestNet' }),
      ).toBeNull();
    }
  });

  /* ONE SENTENCE, IN THE ARM'S OWN VOCABULARY — and naming no machinery. */
  it('is one sentence a reader can act on, with none of the machinery in it', () => {
    expect(CUSTODY_OTHER_KEY_NOTICE.length).toBeLessThan(160);
    for (const word of [
      'wallet address',
      'dust',
      'contract',
      'registry',
      'indexer',
      'resolver',
      'sponsor',
      'sdk',
      'credential',
      'passkey',
      'pointer',
    ]) {
      expect(CUSTODY_OTHER_KEY_NOTICE.toLowerCase()).not.toContain(word);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Whether this build makes new Passports on the account custody contract      */
/* -------------------------------------------------------------------------- */

describe('accountCustodyEnabled', () => {
  it('is false in a build that sets neither flag, which is every build shipped today', () => {
    expect(
      accountCustodyEnabled({ productFlag: undefined, walkFlag: undefined, search: '' }),
    ).toBe(false);
  });

  it('is true wherever the product flag is set, whatever the URL says', () => {
    expect(
      accountCustodyEnabled({ productFlag: '1', walkFlag: undefined, search: '' }),
    ).toBe(true);
  });

  it('is false for a walk build until a URL asks for it', () => {
    /* THE PROPERTY EVERY OTHER SPEC RESTS ON. One preview build serves the
       whole mocked tier, so the flag's mere presence must change nothing. */
    expect(accountCustodyEnabled({ productFlag: undefined, walkFlag: '1', search: '' })).toBe(
      false,
    );
    expect(
      accountCustodyEnabled({ productFlag: undefined, walkFlag: '1', search: '?dynamicwalk=1' }),
    ).toBe(false);
  });

  it('is true for a walk build whose URL asks for it', () => {
    expect(
      accountCustodyEnabled({ productFlag: undefined, walkFlag: '1', search: '?accwalk=1' }),
    ).toBe(true);
    /* The value is not read: asking is the whole of it, exactly as
       `?dynamicwalk=` is asked for. */
    expect(
      accountCustodyEnabled({ productFlag: undefined, walkFlag: '1', search: '?accwalk' }),
    ).toBe(true);
  });

  it('ignores the URL where the walk flag is not set', () => {
    /* A deployed build cannot be talked into the new route by a query string,
       which is the difference between a harness switch and a back door. */
    expect(
      accountCustodyEnabled({ productFlag: undefined, walkFlag: undefined, search: '?accwalk=1' }),
    ).toBe(false);
    expect(
      accountCustodyEnabled({ productFlag: '0', walkFlag: '0', search: '?accwalk=1' }),
    ).toBe(false);
  });

  it('reads a search string with other things in it', () => {
    expect(
      accountCustodyEnabled({ productFlag: undefined, walkFlag: '1', search: '?a=b&accwalk=1' }),
    ).toBe(true);
  });
});
