/**
 * Drills for the viewing keys a Passport keeps in its sign-in's metadata
 * (2026/09/26): the versioned shape, the merge that keeps everything else the
 * sign-in holds, the fresh read a write is built on, the read-back that decides
 * whether it counted, and the road a new device takes to get the keys back.
 *
 * The provider is a stand-in that keeps what it is given and remembers every
 * read and write; the storage is a map. Nothing here needs a browser.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  publishDynamicActions,
  publishDynamicSession,
  resetDynamicSessionStoreForTests,
  type DynamicActions,
} from '../lib/dynamicSession.js';
import { rememberK1EncSecretKey } from './k1CoinStore.js';
import {
  SIGN_IN_KEYS_BUDGET_BYTES,
  SIGN_IN_KEYS_PER_ACCOUNT,
  SIGN_IN_KEYS_VERSION,
  SIGN_IN_METADATA_KEY,
  keepViewingKeysWithSignIn,
  readSignInKeys,
  restoreViewingKeyFromSignIn,
  signInAccountKey,
  signInFromSession,
  signInKeysFor,
  withViewingKeys,
  type SignInMetadata,
} from './signInViewingKeys.js';
import { loadEarlierViewingKeys, viewingSecretsFor, type ViewingKeyStorage } from './viewingKeys.js';

const ACCOUNT = { network: 'stagenet', address: 'ab'.repeat(32) };
const OTHER = { network: 'preview', address: 'cd'.repeat(32) };
const SLOT = `stagenet:${'ab'.repeat(32)}`;
const OTHER_SLOT = `preview:${'cd'.repeat(32)}`;
/** The key of the device that made the Passport, then one per recovery. */
const OLD_KEY = '11'.repeat(32);
const NEW_KEY = '22'.repeat(32);
const THIRD_KEY = '33'.repeat(32);
const USER = '0x00a329c0648769a73afac7f9381e08fb43dbea72';

/** A copy as it comes back over the wire. */
function wire<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function mapStorage(): { storage: ViewingKeyStorage & { removeItem(key: string): void }; map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => void map.set(key, value),
      removeItem: (key) => void map.delete(key),
    },
  };
}

/**
 * A provider holding `held`, and this browser's copy of it (`local`, the same
 * unless given). It keeps what it is written unless told not to, and the
 * browser's copy follows a write, as the SDK's does.
 */
function provider(
  held: unknown,
  options: { local?: unknown; keeps?: boolean; failRead?: boolean; failWrite?: boolean } = {},
) {
  let onServer = wire(held);
  let inBrowser = wire(options.local === undefined ? held : options.local);
  const reads: boolean[] = [];
  const writes: unknown[] = [];
  const signIn: SignInMetadata = {
    user: USER,
    read: ({ fresh }) => {
      reads.push(fresh);
      if (options.failRead) return Promise.reject(new Error('offline'));
      return Promise.resolve(wire(fresh ? onServer : inBrowser));
    },
    write: (metadata) => {
      if (options.failWrite) return Promise.reject(new Error('offline'));
      writes.push(wire(metadata));
      if (options.keeps !== false) onServer = wire(metadata);
      inBrowser = wire(onServer);
      return Promise.resolve(wire(onServer));
    },
  };
  return { signIn, reads, writes, held: () => onServer };
}

function v1(keys: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { ...extra, [SIGN_IN_METADATA_KEY]: { v: SIGN_IN_KEYS_VERSION, keys } };
}

describe('the name an account is filed under', () => {
  it('is the network and the account as lower-case hex, and nothing that is not one', () => {
    expect(signInAccountKey({ network: ' stagenet ', address: `0x${'AB'.repeat(32)}` })).toBe(SLOT);
    expect(signInAccountKey({ network: ' ', address: 'ab'.repeat(32) })).toBeNull();
    expect(signInAccountKey({ network: 7 as unknown as string, address: 'ab'.repeat(32) })).toBeNull();
    expect(signInAccountKey({ network: 'stagenet', address: 'ab' })).toBeNull();
  });
});

describe('reading what the sign-in keeps', () => {
  it('finds nothing where nothing of this app is kept', () => {
    for (const metadata of [undefined, null, [], 'text', 7, {}, { theme: 'dark' }]) {
      expect(readSignInKeys(metadata)).toEqual({ kind: 'absent' });
      expect(signInKeysFor(metadata, ACCOUNT)).toEqual([]);
    }
  });

  it('leaves alone, and reads nothing from, a shape it does not write', () => {
    const shapes: [unknown, RegExp][] = [
      ['text', /something else/],
      [[OLD_KEY], /something else/],
      [{ v: 2, keys: { [SLOT]: [OLD_KEY] } }, /version this Passport does not write \(2\)/],
      [{ keys: { [SLOT]: [OLD_KEY] } }, /version this Passport does not write \(undefined\)/],
      [{ v: 1 }, /without its keys/],
      [{ v: 1, keys: [OLD_KEY] }, /without its keys/],
    ];
    for (const [entry, reason] of shapes) {
      const read = readSignInKeys({ [SIGN_IN_METADATA_KEY]: entry });
      expect(read.kind).toBe('foreign');
      expect(read.kind === 'foreign' ? read.reason : '').toMatch(reason);
      expect(signInKeysFor({ [SIGN_IN_METADATA_KEY]: entry }, ACCOUNT)).toEqual([]);
    }
  });

  it('reads each account’s keys oldest first, normalised, once each, and skips what is not one', () => {
    const metadata = v1({
      [SLOT]: [OLD_KEY, `0x${NEW_KEY.toUpperCase()}`, 'short', OLD_KEY, 42],
      [OTHER_SLOT]: [THIRD_KEY],
      /* Rows this build would never have written. */
      nokey: [OLD_KEY],
      [`:${'ab'.repeat(32)}`]: [OLD_KEY],
      [`stagenet:${'AB'.repeat(32)}`]: [OLD_KEY],
      [`stagenet:${'zz'.repeat(32)}`]: [OLD_KEY],
      [`preview:${'ef'.repeat(32)}`]: 'not a list',
      [`preview:${'12'.repeat(32)}`]: ['short'],
    });
    const read = readSignInKeys(metadata);
    expect(read).toEqual({ kind: 'v1', keys: { [SLOT]: [OLD_KEY, NEW_KEY], [OTHER_SLOT]: [THIRD_KEY] } });
    expect(signInKeysFor(metadata, ACCOUNT)).toEqual([OLD_KEY, NEW_KEY]);
    expect(signInKeysFor(metadata, OTHER)).toEqual([THIRD_KEY]);
    expect(signInKeysFor(metadata, { network: 'stagenet', address: 'ef'.repeat(32) })).toEqual([]);
    expect(signInKeysFor(metadata, { network: '', address: 'ab'.repeat(32) })).toEqual([]);
  });
});

describe('the write that keeps them', () => {
  it('starts this app’s entry where the sign-in keeps nothing', () => {
    for (const metadata of [undefined, null, 'text', {}]) {
      expect(withViewingKeys(metadata, ACCOUNT, [OLD_KEY])).toEqual({
        kind: 'write',
        metadata: { passport: { v: 1, keys: { [SLOT]: [OLD_KEY] } } },
        added: [OLD_KEY],
      });
    }
  });

  it('keeps every other key, every other account, and every key already kept, and adds after them', () => {
    const metadata = {
      theme: 'dark',
      favourites: { colour: 'blue' },
      passport: {
        v: 1,
        note: 'kept as it is',
        keys: { [OTHER_SLOT]: [THIRD_KEY], 'a row this build cannot read': 7, [SLOT]: [OLD_KEY] },
      },
    };
    const plan = withViewingKeys(metadata, ACCOUNT, [OLD_KEY, NEW_KEY]);
    expect(plan).toEqual({
      kind: 'write',
      metadata: {
        theme: 'dark',
        favourites: { colour: 'blue' },
        passport: {
          v: 1,
          note: 'kept as it is',
          keys: {
            [OTHER_SLOT]: [THIRD_KEY],
            'a row this build cannot read': 7,
            [SLOT]: [OLD_KEY, NEW_KEY],
          },
        },
      },
      added: [NEW_KEY],
    });
    /* IDEMPOTENT: planned again over its own result, there is nothing to do —
       whatever case or prefix the keys are handed in with. */
    const written = plan.kind === 'write' ? plan.metadata : null;
    expect(withViewingKeys(written, ACCOUNT, [OLD_KEY, NEW_KEY])).toEqual({ kind: 'unchanged' });
    expect(withViewingKeys(written, ACCOUNT, [`0x${NEW_KEY.toUpperCase()}`])).toEqual({ kind: 'unchanged' });
    /* The input is not changed in place. */
    expect(metadata.passport.keys[SLOT]).toEqual([OLD_KEY]);
  });

  it('adds only keys, once each, and nothing when there is nothing to add', () => {
    expect(withViewingKeys({}, ACCOUNT, [NEW_KEY, 'nonsense', NEW_KEY.toUpperCase()])).toMatchObject({
      kind: 'write',
      added: [NEW_KEY],
    });
    expect(withViewingKeys({}, ACCOUNT, [])).toEqual({ kind: 'unchanged' });
    expect(withViewingKeys({}, ACCOUNT, ['short'])).toEqual({ kind: 'unchanged' });
  });

  it('refuses an account it cannot name, and a shape it does not write', () => {
    expect(withViewingKeys({}, { network: 'stagenet', address: 'zz' }, [OLD_KEY])).toEqual({
      kind: 'refused',
      reason: 'the account is not one this Passport can read',
    });
    expect(withViewingKeys({ passport: { v: 2 } }, ACCOUNT, [OLD_KEY])).toEqual({
      kind: 'refused',
      reason: 'the sign-in keeps a version this Passport does not write (2)',
    });
  });

  it('never takes a key out to make room, and stays inside its budget', () => {
    const full = Array.from({ length: SIGN_IN_KEYS_PER_ACCOUNT }, (_, index) => (index + 16).toString(16).repeat(32));
    expect(withViewingKeys(v1({ [SLOT]: full }), ACCOUNT, [...full, 'ee'.repeat(32)])).toEqual({
      kind: 'refused',
      reason: `the sign-in already keeps ${SIGN_IN_KEYS_PER_ACCOUNT} keys for this Passport, and ${SIGN_IN_KEYS_PER_ACCOUNT} is the most it keeps`,
    });
    /* One account with a full list fits with room to spare. */
    const oneFull = withViewingKeys({}, ACCOUNT, full);
    expect(oneFull.kind).toBe('write');
    const entry = oneFull.kind === 'write' ? oneFull.metadata.passport : null;
    expect(new TextEncoder().encode(JSON.stringify(entry)).length).toBeLessThan(SIGN_IN_KEYS_BUDGET_BYTES / 2);
    /* What else is kept under this app's name counts against the budget too. */
    const heavy = { passport: { v: 1, note: 'x'.repeat(SIGN_IN_KEYS_BUDGET_BYTES), keys: {} } };
    const refused = withViewingKeys(heavy, ACCOUNT, [OLD_KEY]);
    expect(refused.kind).toBe('refused');
    expect(refused.kind === 'refused' ? refused.reason : '').toMatch(
      new RegExp(`the keys would take \\d+ bytes of the sign-in, and ${SIGN_IN_KEYS_BUDGET_BYTES} is the most`),
    );
  });
});

describe('bringing a device and its sign-in level', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('puts the key of the device that made the Passport with the sign-in it adds as its way back', async () => {
    const { storage } = mapStorage();
    const theProvider = provider({ theme: 'dark' });
    await expect(
      keepViewingKeysWithSignIn({ signIn: theProvider.signIn, storage, account: ACCOUNT, current: OLD_KEY }),
    ).resolves.toEqual({ kind: 'kept', restored: 0, written: 1 });
    expect(theProvider.held()).toEqual({ theme: 'dark', passport: { v: 1, keys: { [SLOT]: [OLD_KEY] } } });
    /* Its own key is not an earlier one. */
    expect(loadEarlierViewingKeys(storage, ACCOUNT)).toEqual([]);
    /* A write is built on the provider's copy, not only on this browser's. */
    expect(theProvider.reads).toEqual([false, true]);

    /* IDEMPOTENT: the next open reads this browser's copy and does nothing. */
    await expect(
      keepViewingKeysWithSignIn({ signIn: theProvider.signIn, storage, account: ACCOUNT, current: OLD_KEY }),
    ).resolves.toEqual({ kind: 'kept', restored: 0, written: 0 });
    expect(theProvider.reads).toEqual([false, true, false]);
    expect(theProvider.writes).toHaveLength(1);
  });

  it('gives a device that has come back the key the sign-in keeps, and puts its own beside it', async () => {
    const { storage } = mapStorage();
    const theProvider = provider(v1({ [SLOT]: [OLD_KEY] }, { theme: 'dark' }));
    await expect(
      keepViewingKeysWithSignIn({ signIn: theProvider.signIn, storage, account: ACCOUNT, current: NEW_KEY }),
    ).resolves.toEqual({ kind: 'kept', restored: 1, written: 1 });
    /* The inbox walk now tries both: this device's key first, then the one
       the notes from before were sealed to. */
    expect(viewingSecretsFor(storage, ACCOUNT, NEW_KEY)).toEqual([NEW_KEY, OLD_KEY]);
    /* And the sign-in keeps both, oldest first, for the next device. */
    expect(theProvider.held()).toEqual(v1({ [SLOT]: [OLD_KEY, NEW_KEY] }, { theme: 'dark' }));
  });

  it('reads back a key with no current key beside it, when the device’s own never landed', async () => {
    const { storage } = mapStorage();
    const theProvider = provider(v1({ [SLOT]: [OLD_KEY] }));
    await expect(
      keepViewingKeysWithSignIn({ signIn: theProvider.signIn, storage, account: ACCOUNT, current: null }),
    ).resolves.toEqual({ kind: 'kept', restored: 1, written: 0 });
    expect(viewingSecretsFor(storage, ACCOUNT, null)).toEqual([OLD_KEY]);
    expect(theProvider.writes).toEqual([]);
  });

  it('does nothing at all for a device with no key and a sign-in with none kept', async () => {
    const { storage } = mapStorage();
    const theProvider = provider(undefined);
    await expect(
      keepViewingKeysWithSignIn({ signIn: theProvider.signIn, storage, account: ACCOUNT, current: null }),
    ).resolves.toEqual({ kind: 'kept', restored: 0, written: 0 });
    expect(theProvider.reads).toEqual([false]);
  });

  it('builds its write on what the provider holds now, not on this browser’s older copy', async () => {
    const { storage } = mapStorage();
    /* A second device added its key after this browser last looked. */
    const theProvider = provider(v1({ [SLOT]: [OLD_KEY, THIRD_KEY] }, { theme: 'dark' }), {
      local: v1({ [SLOT]: [OLD_KEY] }),
    });
    await expect(
      keepViewingKeysWithSignIn({ signIn: theProvider.signIn, storage, account: ACCOUNT, current: NEW_KEY }),
    ).resolves.toEqual({ kind: 'kept', restored: 2, written: 1 });
    expect(theProvider.held()).toEqual(v1({ [SLOT]: [OLD_KEY, THIRD_KEY, NEW_KEY] }, { theme: 'dark' }));
    expect(loadEarlierViewingKeys(storage, ACCOUNT)).toEqual([OLD_KEY, THIRD_KEY]);
  });

  it('writes nothing when the provider already has what this browser’s copy lacked', async () => {
    const { storage } = mapStorage();
    const theProvider = provider(v1({ [SLOT]: [NEW_KEY] }), { local: {} });
    await expect(
      keepViewingKeysWithSignIn({ signIn: theProvider.signIn, storage, account: ACCOUNT, current: NEW_KEY }),
    ).resolves.toEqual({ kind: 'kept', restored: 0, written: 0 });
    expect(theProvider.writes).toEqual([]);
  });

  it('refuses to write over a shape it does not write, and says so in the console', async () => {
    const { storage } = mapStorage();
    const theProvider = provider({ passport: { v: 2, whatever: true } });
    await expect(
      keepViewingKeysWithSignIn({ signIn: theProvider.signIn, storage, account: ACCOUNT, current: NEW_KEY }),
    ).resolves.toEqual({
      kind: 'refused',
      restored: 0,
      reason: 'the sign-in keeps a version this Passport does not write (2)',
    });
    expect(theProvider.writes).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[account-custody\] .*was not kept with its sign-in/));
  });

  it('counts a write only when the provider’s answer carries the keys', async () => {
    const { storage } = mapStorage();
    const theProvider = provider({}, { keeps: false });
    await expect(
      keepViewingKeysWithSignIn({ signIn: theProvider.signIn, storage, account: ACCOUNT, current: NEW_KEY }),
    ).resolves.toEqual({ kind: 'failed', restored: 0, reason: 'the sign-in did not keep it' });
    expect(theProvider.writes).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/did not keep the key.*next open/));
  });

  it('never throws: a sign-in that does not answer is logged and tried again later', async () => {
    const { storage } = mapStorage();
    for (const failure of [{ failRead: true }, { failWrite: true }]) {
      const theProvider = provider({}, failure);
      await expect(
        keepViewingKeysWithSignIn({ signIn: theProvider.signIn, storage, account: ACCOUNT, current: NEW_KEY }),
      ).resolves.toEqual({ kind: 'failed', restored: 0, reason: 'the sign-in did not answer' });
    }
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/could not be kept with its sign-in; trying again on the next open/),
      expect.any(Error),
    );
  });

  it('runs once for two callers at once, and again once that run is over', async () => {
    const { storage } = mapStorage();
    const theProvider = provider({});
    const options = { signIn: theProvider.signIn, storage, account: ACCOUNT, current: NEW_KEY };
    const first = keepViewingKeysWithSignIn(options);
    const second = keepViewingKeysWithSignIn(options);
    expect(second).toBe(first);
    await first;
    expect(theProvider.writes).toHaveLength(1);
    await keepViewingKeysWithSignIn(options);
    expect(theProvider.reads).toEqual([false, true, false]);
  });

  it('refuses an account it cannot name, before asking anybody anything', async () => {
    const { storage } = mapStorage();
    const theProvider = provider({});
    await expect(
      keepViewingKeysWithSignIn({
        signIn: theProvider.signIn,
        storage,
        account: { network: '', address: ACCOUNT.address },
        current: NEW_KEY,
      }),
    ).resolves.toEqual({ kind: 'refused', restored: 0, reason: 'the account is not one this Passport can read' });
    expect(theProvider.reads).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* The sign-in on the page, and the road a new device takes                   */
/* -------------------------------------------------------------------------- */

/** Actions over a provider's two calls, as the bridge or the walk registers them. */
function actionsOver(signIn: SignInMetadata): DynamicActions {
  return {
    openAuthFlow: () => undefined,
    signMessage: () => Promise.reject(new Error('unused')),
    signRaw: () => Promise.reject(new Error('unused')),
    signOut: () => Promise.resolve(),
    readMetadata: (options) => signIn.read(options),
    writeMetadata: (metadata) => signIn.write(metadata),
  };
}

function signedIn(address: string | null = USER): void {
  publishDynamicSession({ status: 'signed-in', provider: 'Google', handle: 'walker', evmAddress: address });
}

describe('the sign-in on this page', () => {
  beforeEach(() => resetDynamicSessionStoreForTests());
  afterEach(() => resetDynamicSessionStoreForTests());

  it('is nobody until a sign-in is live, signed in, and the one asked for', () => {
    const theProvider = provider({});
    /* No sign-in in this build at all. */
    expect(signInFromSession(USER)).toBeNull();
    /* Signed in, and the bridge has not registered its calls yet. */
    signedIn();
    expect(signInFromSession(USER)).toBeNull();
    publishDynamicActions(actionsOver(theProvider.signIn));
    /* Signed in for a beat with no key behind it yet. */
    signedIn(null);
    expect(signInFromSession(USER)).toBeNull();
    signedIn();
    expect(signInFromSession('0x1111111111111111111111111111111111111111')).toBeNull();
    expect(signInFromSession('')).toBeNull();
    expect(signInFromSession(USER.toUpperCase().replace('0X', '0x'))?.user).toBe(USER);
  });

  it('reaches whichever calls are registered when it is used, and says so once there are none', async () => {
    const first = provider({ from: 'first' });
    const second = provider({ from: 'second' });
    publishDynamicActions(actionsOver(first.signIn));
    signedIn();
    const signIn = signInFromSession(USER)!;
    /* The bridge registers its calls again whenever the user changes. */
    publishDynamicActions(actionsOver(second.signIn));
    await expect(signIn.read({ fresh: false })).resolves.toEqual({ from: 'second' });
    await expect(signIn.write({ from: 'written' })).resolves.toEqual({ from: 'written' });
    expect(second.writes).toEqual([{ from: 'written' }]);
    publishDynamicActions(null);
    await expect(signIn.read({ fresh: true })).rejects.toThrow('the sign-in is no longer available');
  });
});

describe('coming back on a new device', () => {
  let map: Map<string, string>;
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetDynamicSessionStoreForTests();
    const made = mapStorage();
    map = made.map;
    vi.stubGlobal('window', { localStorage: made.storage });
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    warn.mockRestore();
    resetDynamicSessionStoreForTests();
  });

  const storage = (): ViewingKeyStorage => ({
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  });

  it('reads back from the sign-in that found the Passport, and keeps this device’s key beside it', async () => {
    /* What the recovery leaves before its last step: this device's own key,
       filed where the coin store files it. */
    rememberK1EncSecretKey(ACCOUNT, NEW_KEY);
    const theProvider = provider(v1({ [SLOT]: [OLD_KEY] }));
    publishDynamicActions(actionsOver(theProvider.signIn));
    signedIn();
    await expect(
      restoreViewingKeyFromSignIn({ storage: storage(), account: ACCOUNT, signInUser: USER }),
    ).resolves.toEqual({ kind: 'kept', restored: 1, written: 1 });
    expect(viewingSecretsFor(storage(), ACCOUNT, NEW_KEY)).toEqual([NEW_KEY, OLD_KEY]);
    expect(theProvider.held()).toEqual(v1({ [SLOT]: [OLD_KEY, NEW_KEY] }));
  });

  it('changes nothing and says so when the sign-in here is not the one that found it', async () => {
    const theProvider = provider(v1({ [SLOT]: [OLD_KEY] }));
    publishDynamicActions(actionsOver(theProvider.signIn));
    signedIn('0x1111111111111111111111111111111111111111');
    await expect(
      restoreViewingKeyFromSignIn({ storage: storage(), account: ACCOUNT, signInUser: USER }),
    ).resolves.toEqual({ kind: 'failed', restored: 0, reason: 'nobody is signed in' });
    expect(theProvider.reads).toEqual([]);
    expect(loadEarlierViewingKeys(storage(), ACCOUNT)).toEqual([]);
    expect(warn).toHaveBeenCalledWith("[account-custody] no sign-in to read this Passport's earlier payments from");
  });

  it('does not wait for ever for a sign-in that never answers', async () => {
    /* A user of its own: a run that never ends stays in flight, and must not
       be one any other drill here joins. */
    const silent: SignInMetadata = {
      user: '0x2222222222222222222222222222222222222222',
      read: () => new Promise(() => undefined),
      write: () => new Promise(() => undefined),
    };
    await expect(
      restoreViewingKeyFromSignIn({
        storage: storage(),
        account: ACCOUNT,
        signInUser: USER,
        signIn: silent,
        current: () => Promise.resolve(NEW_KEY),
        waitMs: 5,
      }),
    ).resolves.toEqual({ kind: 'failed', restored: 0, reason: 'the sign-in did not answer in time' });
  });

  it('says so, and throws nothing, when this device’s own key cannot be read', async () => {
    const theProvider = provider(v1({ [SLOT]: [OLD_KEY] }));
    await expect(
      restoreViewingKeyFromSignIn({
        storage: storage(),
        account: ACCOUNT,
        signInUser: USER,
        signIn: theProvider.signIn,
        current: () => Promise.reject(new Error('storage denied')),
      }),
    ).resolves.toEqual({ kind: 'failed', restored: 0, reason: 'the coin store could not be read' });
    expect(theProvider.reads).toEqual([]);
  });
});
