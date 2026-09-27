/**
 * The inbox, held to the one thing that makes it worth having: bytes this
 * client seals are bytes the REFERENCE opens, and bytes the reference sealed
 * are bytes this client opens.
 *
 * `./fixtures/inbox-v1.json` is the load-bearing part of this file. It was
 * produced by running the reference's own `contract/src/wallet/inbox.ts` —
 * Node crypto, a different X25519 implementation, a different AEAD binding —
 * and nothing in this repository can regenerate it. A change here that broke
 * compatibility while staying self-consistent would pass every round-trip test
 * anybody could write and still strand every coin ever deposited, so the
 * fixtures are the test and the round trips are the sanity check.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import {
  CUSTODY_ENC_KEY_KEY,
  CUSTODY_INBOX_ENTRY_BYTES,
  CUSTODY_INBOX_HKDF_INFO,
  CUSTODY_INBOX_PLAINTEXT_BYTES,
  CUSTODY_INBOX_SUITE,
  CUSTODY_INBOX_VERSION,
  decodeCustodyInboxPlaintext,
  defaultCustodyInboxDeps,
  depositShieldedCustody,
  encodeCustodyInboxPlaintext,
  generateCustodyEncKeyPair,
  custodyEncKeyPair,
  custodyEncKeySlot,
  custodyEncPublicKey,
  openCustodyInboxEntry,
  packCustodyInboxEntry,
  readInboxCustody,
  sealCustodyInboxEntry,
  unpackCustodyInboxEntry,
  type CustodyInboxCoin,
  type CustodyInboxDeps,
  type CustodyInboxReader,
  type CustodyInboxStorage,
} from './custodyInbox.js';
import { bytesToHex } from './custodyContractSigning.js';
import { hexToBytes } from './custodyContractPlan.js';
import {
  heldK1Coin,
  k1ColourBalance,
  putK1Coin,
  type K1Account,
  type K1CommitmentWindow,
} from './k1CoinStore.js';
import { custodyUnplacedDeliveries } from '../lib/custodyScreenRules.js';

import fixtures from './fixtures/inbox-v1.json' with { type: 'json' };

const ALICE: K1Account = { network: 'stagenet', address: 'ab'.repeat(32) };

const NONCE = '7f'.repeat(32);
const COLOUR = '1a'.repeat(32);

function coin(patch: Partial<CustodyInboxCoin> = {}): CustodyInboxCoin {
  return { colour: COLOUR, nonce: NONCE, value: 100n, ...patch };
}

/** Real randomness, real `crypto.subtle` — the defaults, named for legibility. */
const REAL: CustodyInboxDeps = defaultCustodyInboxDeps();

/** The smallest thing that behaves like `localStorage`, and its backing map. */
function fakeStorage(behaviour: { denyWrites?: boolean } = {}): {
  storage: CustodyInboxStorage;
  map: Map<string, string>;
} {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        if (behaviour.denyWrites) throw new Error('quota');
        map.set(key, value);
      },
    },
  };
}

let storage: Map<string, string>;

beforeEach(() => {
  storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
      },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */

describe('the reference’s own bytes', () => {
  it('opens every fixture entry with the owner’s secret', async () => {
    expect(fixtures.entries.length).toBeGreaterThan(0);
    for (const fixture of fixtures.entries) {
      const opened = await openCustodyInboxEntry(
        fixtures.owner.secretKeyHex,
        hexToBytes(fixture.entryHex),
      );
      expect(opened).toEqual({
        nonce: fixture.coin.nonceHex,
        colour: fixture.coin.colourHex,
        value: BigInt(fixture.coin.value),
      });
    }
  });

  it('refuses every fixture entry with a stranger’s secret', async () => {
    for (const fixture of fixtures.entries) {
      const opened = await openCustodyInboxEntry(
        fixtures.stranger.secretKeyHex,
        hexToBytes(fixture.entryHex),
      );
      expect(opened).toBeNull();
    }
  });

  it('agrees with the reference about the container’s shape', () => {
    expect(CUSTODY_INBOX_ENTRY_BYTES).toBe(fixtures.entryBytes);
    expect(CUSTODY_INBOX_HKDF_INFO).toBe(fixtures.hkdfInfo);
    for (const fixture of fixtures.entries) {
      const bytes = hexToBytes(fixture.entryHex);
      expect(bytes.length).toBe(CUSTODY_INBOX_ENTRY_BYTES);
      expect(bytes[0]).toBe(CUSTODY_INBOX_VERSION);
      expect(bytes[1]).toBe(CUSTODY_INBOX_SUITE);
      /* The last fifty bytes are zero in every entry the reference writes. A
         reader must ignore them; a writer that filled them would be the only
         writer that did, and that is itself a signal. */
      expect([...bytes.subarray(142)]).toEqual(Array.from({ length: 50 }, () => 0));
    }
  });

  it('derives the same public key the reference advertised', () => {
    expect(custodyEncPublicKey(fixtures.owner.secretKeyHex)).toBe(fixtures.owner.publicKeyHex);
    expect(custodyEncPublicKey(fixtures.stranger.secretKeyHex)).toBe(fixtures.stranger.publicKeyHex);
  });

  it('seals entries the reference-generated owner key can be read back from', async () => {
    /* The other direction of the same claim: an entry THIS module produced,
       opened with the secret half of a keypair this module never generated. */
    const entry = await sealCustodyInboxEntry(fixtures.owner.publicKeyHex, coin({ value: 7n }));
    expect(await openCustodyInboxEntry(fixtures.owner.secretKeyHex, entry)).toEqual(coin({ value: 7n }));
  });
});

/* -------------------------------------------------------------------------- */

describe('the plaintext codec', () => {
  it('round trips a coin through eighty bytes', () => {
    const encoded = encodeCustodyInboxPlaintext(coin({ value: 1_000_000n }));
    expect(encoded.length).toBe(CUSTODY_INBOX_PLAINTEXT_BYTES);
    expect(bytesToHex(encoded.subarray(0, 32))).toBe(NONCE);
    expect(bytesToHex(encoded.subarray(32, 64))).toBe(COLOUR);
    expect(decodeCustodyInboxPlaintext(encoded)).toEqual(coin({ value: 1_000_000n }));
  });

  it('writes the value big-endian, the reference’s way', () => {
    const encoded = encodeCustodyInboxPlaintext(coin({ value: 1n }));
    expect(encoded[79]).toBe(1);
    expect(encoded[64]).toBe(0);
    const big = encodeCustodyInboxPlaintext(coin({ value: (1n << 127n) }));
    expect(big[64]).toBe(0x80);
  });

  it('carries the largest value the field can hold, and no more', () => {
    const max = (1n << 128n) - 1n;
    expect(decodeCustodyInboxPlaintext(encodeCustodyInboxPlaintext(coin({ value: max })))).toEqual(
      coin({ value: max }),
    );
    expect(() => encodeCustodyInboxPlaintext(coin({ value: max + 1n }))).toThrow(/128-bit/);
  });

  it('refuses a coin it could not encode faithfully', () => {
    expect(() => encodeCustodyInboxPlaintext(coin({ nonce: 'ff' }))).toThrow(/coin nonce/);
    expect(() => encodeCustodyInboxPlaintext(coin({ colour: 'not hex' }))).toThrow(/colour/);
    expect(() => encodeCustodyInboxPlaintext(coin({ value: -1n }))).toThrow(/128-bit/);
    expect(() =>
      encodeCustodyInboxPlaintext(coin({ value: 5 as unknown as bigint })),
    ).toThrow(/128-bit/);
    expect(() =>
      encodeCustodyInboxPlaintext(coin({ nonce: 42 as unknown as string })),
    ).toThrow(/coin nonce/);
  });

  it('accepts a 0x-prefixed, upper-case coin as the same coin', () => {
    const prefixed = encodeCustodyInboxPlaintext({
      nonce: `0x${NONCE.toUpperCase()}`,
      colour: `0x${COLOUR.toUpperCase()}`,
      value: 9n,
    });
    expect(decodeCustodyInboxPlaintext(prefixed)).toEqual(coin({ value: 9n }));
  });

  it('decodes nothing from a plaintext that is not eighty bytes', () => {
    expect(decodeCustodyInboxPlaintext(new Uint8Array(79))).toBeNull();
    expect(decodeCustodyInboxPlaintext(new Uint8Array(81))).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe('the container codec', () => {
  const parts = {
    ephemeralPublicKey: new Uint8Array(32).fill(3),
    nonce: new Uint8Array(12).fill(4),
    tag: new Uint8Array(16).fill(5),
    ciphertext: new Uint8Array(80).fill(6),
  };

  it('packs and unpacks every field at the reference’s offsets', () => {
    const entry = packCustodyInboxEntry(parts);
    expect(entry.length).toBe(CUSTODY_INBOX_ENTRY_BYTES);
    expect(entry[0]).toBe(CUSTODY_INBOX_VERSION);
    expect(entry[1]).toBe(CUSTODY_INBOX_SUITE);
    expect(unpackCustodyInboxEntry(entry)).toEqual(parts);
  });

  it('refuses to pack a field of the wrong length', () => {
    expect(() =>
      packCustodyInboxEntry({ ...parts, ephemeralPublicKey: new Uint8Array(31) }),
    ).toThrow(/ephemeral public key/);
    expect(() => packCustodyInboxEntry({ ...parts, nonce: new Uint8Array(11) })).toThrow(/AEAD nonce/);
    expect(() => packCustodyInboxEntry({ ...parts, tag: new Uint8Array(15) })).toThrow(/AEAD tag/);
    expect(() => packCustodyInboxEntry({ ...parts, ciphertext: new Uint8Array(79) })).toThrow(
      /ciphertext/,
    );
  });

  it('refuses to pack something that is not bytes at all', () => {
    expect(() =>
      packCustodyInboxEntry({ ...parts, nonce: undefined as unknown as Uint8Array }),
    ).toThrow(/AEAD nonce/);
  });

  it('skips an entry it must not read, rather than failing', () => {
    expect(unpackCustodyInboxEntry(new Uint8Array(191))).toBeNull();
    expect(unpackCustodyInboxEntry('nope' as unknown as Uint8Array)).toBeNull();

    const futureVersion = packCustodyInboxEntry(parts);
    futureVersion[0] = 0x02;
    expect(unpackCustodyInboxEntry(futureVersion)).toBeNull();

    const futureSuite = packCustodyInboxEntry(parts);
    futureSuite[1] = 0x09;
    expect(unpackCustodyInboxEntry(futureSuite)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe('sealing and opening', () => {
  it('round trips through a freshly generated keypair', async () => {
    const keys = generateCustodyEncKeyPair();
    const entry = await sealCustodyInboxEntry(keys.publicKeyHex, coin({ value: 4_200n }));
    expect(entry.length).toBe(CUSTODY_INBOX_ENTRY_BYTES);
    expect(await openCustodyInboxEntry(keys.secretKeyHex, entry)).toEqual(coin({ value: 4_200n }));
  });

  it('gives two deposits of the same coin two different entries', async () => {
    const keys = generateCustodyEncKeyPair();
    const first = await sealCustodyInboxEntry(keys.publicKeyHex, coin());
    const second = await sealCustodyInboxEntry(keys.publicKeyHex, coin());
    expect(bytesToHex(first)).not.toBe(bytesToHex(second));
  });

  it('will not open with the wrong secret', async () => {
    const keys = generateCustodyEncKeyPair();
    const stranger = generateCustodyEncKeyPair();
    const entry = await sealCustodyInboxEntry(keys.publicKeyHex, coin());
    expect(await openCustodyInboxEntry(stranger.secretKeyHex, entry)).toBeNull();
  });

  it('will not open an entry whose bytes were touched', async () => {
    const keys = generateCustodyEncKeyPair();
    const entry = await sealCustodyInboxEntry(keys.publicKeyHex, coin());

    const flippedCiphertext = entry.slice();
    flippedCiphertext[62] ^= 0x01;
    expect(await openCustodyInboxEntry(keys.secretKeyHex, flippedCiphertext)).toBeNull();

    const flippedTag = entry.slice();
    flippedTag[46] ^= 0x01;
    expect(await openCustodyInboxEntry(keys.secretKeyHex, flippedTag)).toBeNull();

    const flippedEphemeral = entry.slice();
    flippedEphemeral[2] ^= 0x01;
    expect(await openCustodyInboxEntry(keys.secretKeyHex, flippedEphemeral)).toBeNull();
  });

  it('ignores the padding, as a reader must', async () => {
    const keys = generateCustodyEncKeyPair();
    const entry = await sealCustodyInboxEntry(keys.publicKeyHex, coin());
    const scribbled = entry.slice();
    scribbled.fill(0xaa, 142);
    expect(await openCustodyInboxEntry(keys.secretKeyHex, scribbled)).toEqual(coin());
  });

  it('refuses to seal to something that is not a key', async () => {
    await expect(sealCustodyInboxEntry('ab', coin())).rejects.toThrow(/32-byte/);
  });

  it('opens nothing with something that is not a secret', async () => {
    const keys = generateCustodyEncKeyPair();
    const entry = await sealCustodyInboxEntry(keys.publicKeyHex, coin());
    expect(await openCustodyInboxEntry('', entry)).toBeNull();
    expect(await openCustodyInboxEntry(keys.secretKeyHex, new Uint8Array(10))).toBeNull();
  });

  it('refuses a public key that is not one', () => {
    expect(() => custodyEncPublicKey('zz')).toThrow(/32 bytes/);
  });

  it('uses real randomness and real WebCrypto by default', () => {
    const deps = defaultCustodyInboxDeps();
    const first = deps.randomBytes(16);
    expect(first.length).toBe(16);
    expect(bytesToHex(first)).not.toBe(bytesToHex(deps.randomBytes(16)));
    expect(deps.subtle()).toBe(globalThis.crypto.subtle);
  });
});

/* -------------------------------------------------------------------------- */

describe('the viewing key this Passport keeps', () => {
  /** One account of one user on one network. */
  const ACCOUNT = { network: 'stagenet', accountId: 'aa'.repeat(32) };
  const OTHER_ACCOUNT = { network: 'stagenet', accountId: 'bb'.repeat(32) };
  const OTHER_NETWORK = { network: 'devnet', accountId: 'aa'.repeat(32) };

  it('makes one key and then keeps handing back the same one', () => {
    const { storage: store } = fakeStorage();
    const first = custodyEncKeyPair(store, 'user-a', ACCOUNT);
    const second = custodyEncKeyPair(store, 'user-a', ACCOUNT);
    expect(second).toEqual(first);
    expect(custodyEncPublicKey(first.secretKeyHex)).toBe(first.publicKeyHex);
  });

  it('keeps two Dynamic users apart', () => {
    const { storage: store } = fakeStorage();
    expect(custodyEncKeyPair(store, 'user-a', ACCOUNT).secretKeyHex).not.toBe(
      custodyEncKeyPair(store, 'user-b', ACCOUNT).secretKeyHex,
    );
  });

  /* PER ACCOUNT AND PER NETWORK. One secret across all of a user's accounts
     made a stagenet account and a devnet account advertise the same public
     half — visibly one person to anybody who sends to both — and made one
     leaked secret open every inbox instead of one. */
  it('keeps two accounts of the same user apart', () => {
    const { storage: store } = fakeStorage();
    expect(custodyEncKeyPair(store, 'user-a', ACCOUNT).secretKeyHex).not.toBe(
      custodyEncKeyPair(store, 'user-a', OTHER_ACCOUNT).secretKeyHex,
    );
  });

  it('keeps one account’s two networks apart', () => {
    const { storage: store } = fakeStorage();
    expect(custodyEncKeyPair(store, 'user-a', ACCOUNT).secretKeyHex).not.toBe(
      custodyEncKeyPair(store, 'user-a', OTHER_NETWORK).secretKeyHex,
    );
  });

  /* THE PASSKEY ARM'S VIEWING SECRET. Derived from the same authenticator as
     the device key, so a Passport reinstalled on a new phone re-derives the
     key its own inbox was sealed to. See PASSPORT_ENC_LABEL. */
  it('files a derived secret into an empty slot, and advertises its public half', () => {
    const { storage: store } = fakeStorage();
    const derived = '5c'.repeat(32);
    const pair = custodyEncKeyPair(store, 'passkey-a', ACCOUNT, undefined, derived);
    expect(pair.secretKeyHex).toBe(derived);
    expect(pair.publicKeyHex).toBe(custodyEncPublicKey(derived));
    /* And it is remembered, so the next visit does not have to re-derive. */
    expect(custodyEncKeyPair(store, 'passkey-a', ACCOUNT)).toEqual(pair);
  });

  it('re-derives the same key for the same passkey, with nothing in storage', () => {
    const derived = '5c'.repeat(32);
    const first = custodyEncKeyPair(fakeStorage().storage, 'passkey-a', ACCOUNT, undefined, derived);
    const reinstalled = custodyEncKeyPair(fakeStorage().storage, 'passkey-a', ACCOUNT, undefined, derived);
    expect(reinstalled).toEqual(first);
  });

  /* A stored key is a key somebody has already sealed to. Replacing it would
     make exactly the entries the derivation exists to recover unreadable. */
  it('never replaces a secret already in the slot', () => {
    const { storage: store } = fakeStorage();
    const stored = custodyEncKeyPair(store, 'passkey-a', ACCOUNT);
    expect(custodyEncKeyPair(store, 'passkey-a', ACCOUNT, undefined, '5c'.repeat(32))).toEqual(stored);
  });

  it('falls back to a random secret when the derived one is not 32 bytes', () => {
    const { storage: store } = fakeStorage();
    const pair = custodyEncKeyPair(store, 'passkey-a', ACCOUNT, undefined, 'too short');
    expect(pair.secretKeyHex).not.toBe('too short');
    expect(pair.secretKeyHex.length).toBe(64);
  });

  it('does not make a second key out of a different spelling', () => {
    const { storage: store } = fakeStorage();
    const made = custodyEncKeyPair(store, 'USER-A', ACCOUNT);
    expect(custodyEncKeyPair(store, 'user-a', { ...ACCOUNT, accountId: 'AA'.repeat(32) })).toEqual(made);
    expect(custodyEncKeySlot('User-A', ACCOUNT)).toBe(`user-a|stagenet|${'aa'.repeat(32)}`);
  });

  it('survives a reload — the same storage, a new call', () => {
    const { storage: store, map } = fakeStorage();
    const made = custodyEncKeyPair(store, 'user-a', ACCOUNT);
    const reloaded: CustodyInboxStorage = {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => void map.set(key, value),
    };
    expect(custodyEncKeyPair(reloaded, 'user-a', ACCOUNT)).toEqual(made);
  });

  it('replaces a stored blob it cannot read, rather than trusting it', () => {
    const { storage: store, map } = fakeStorage();
    map.set(CUSTODY_ENC_KEY_KEY, 'not json');
    expect(custodyEncKeyPair(store, 'user-a', ACCOUNT).secretKeyHex).toHaveLength(64);

    map.set(CUSTODY_ENC_KEY_KEY, '["an array"]');
    expect(custodyEncKeyPair(store, 'user-a', ACCOUNT).secretKeyHex).toHaveLength(64);

    map.set(CUSTODY_ENC_KEY_KEY, 'null');
    expect(custodyEncKeyPair(store, 'user-a', ACCOUNT).secretKeyHex).toHaveLength(64);

    map.set(CUSTODY_ENC_KEY_KEY, JSON.stringify({ [custodyEncKeySlot('user-a', ACCOUNT)]: 'too short' }));
    expect(custodyEncKeyPair(store, 'user-a', ACCOUNT).secretKeyHex).toHaveLength(64);
  });

  it('still serves this session when the write is denied', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { storage: store } = fakeStorage({ denyWrites: true });
    const made = custodyEncKeyPair(store, 'user-a', ACCOUNT);
    expect(made.secretKeyHex).toHaveLength(64);
    expect(warn).toHaveBeenCalled();
  });

  it('takes injected randomness, so a drill is repeatable', () => {
    const fixed: CustodyInboxDeps = {
      randomBytes: (length) => new Uint8Array(length).fill(7),
      subtle: () => globalThis.crypto.subtle,
    };
    const { storage: store } = fakeStorage();
    expect(custodyEncKeyPair(store, 'user-a', ACCOUNT, fixed).secretKeyHex).toBe('07'.repeat(32));
    expect(generateCustodyEncKeyPair(fixed).secretKeyHex).toBe('07'.repeat(32));
  });
});

/* -------------------------------------------------------------------------- */

/** An inbox built out of whatever entries a drill wants in it. */
function reader(entries: readonly (Uint8Array | null)[]): CustodyInboxReader {
  return {
    count: () => BigInt(entries.length),
    entryAt: (index) => entries[Number(index)] ?? null,
  };
}

const WINDOW: K1CommitmentWindow = { startIndex: 11, endIndex: 12 };

describe('the inbox walk', () => {
  it('recovers a coin somebody else deposited and stores it', async () => {
    const keys = generateCustodyEncKeyPair();
    const entry = await sealCustodyInboxEntry(keys.publicKeyHex, coin({ value: 250n }));

    const result = await readInboxCustody(ALICE, keys.secretKeyHex, reader([entry]), {
      txIdFor: () => 'tx-1',
      windows: () => Promise.resolve(WINDOW),
    });

    expect(result.coins).toEqual([{ ...coin({ value: 250n }), inboxIndex: 0n }]);
    expect(result.outcomes[0].reconciliation.outcome).toBe('learned');
    expect(heldK1Coin(ALICE, COLOUR)).toEqual({
      colour: COLOUR,
      nonce: NONCE,
      value: 250n,
      mtIndex: 11n,
    });
  });

  /* THE FIRST PAYMENT ANYBODY IS SENT (live, 2026/09/21). The Passport is
     already holding its opening grant, so the delivery lands in a colour with
     a held coin, and the payer's transaction has two shielded outputs — the
     recipient's note and the payer's change. It is QUEUED with its candidate
     positions rather than reported and dropped, which is what left 10 mUSD
     unspendable behind a figure that never moved. */
  it('queues a two-output delivery behind the coin the colour already holds', async () => {
    const keys = generateCustodyEncKeyPair();
    putK1Coin(ALICE, { colour: COLOUR, nonce: 'c3'.repeat(32), value: 100n, mtIndex: 3n });
    const entry = await sealCustodyInboxEntry(keys.publicKeyHex, coin({ value: 10n }));

    const result = await readInboxCustody(ALICE, keys.secretKeyHex, reader([entry]), {
      txIdFor: () => 'tx-paid',
      windows: () => Promise.resolve({ startIndex: 20, endIndex: 22 }),
      candidates: 'store',
    });

    expect(result.outcomes[0].reconciliation).toEqual({
      outcome: 'ambiguous',
      candidates: [20n, 21n],
      stored: true,
      placed: 'queued',
    });
    /* The grant is untouched and the payment is money, not a rumour. */
    expect(heldK1Coin(ALICE, COLOUR)?.value).toBe(100n);
    expect(k1ColourBalance(ALICE, COLOUR)).toBe(110n);
    /* And nothing on the screen calls it still arriving. */
    expect(custodyUnplacedDeliveries(result.outcomes)).toBe(0);

    /* A SECOND WALK, WHICH IS WHAT EVERY READ OF HOME IS. The same delivery is
       not queued twice, and the chain is not asked about it again. */
    const ask = vi.fn(() => Promise.resolve({ startIndex: 20, endIndex: 22 }));
    const again = await readInboxCustody(ALICE, keys.secretKeyHex, reader([entry]), {
      txIdFor: () => 'tx-paid',
      windows: ask,
      candidates: 'store',
    });
    expect(again.outcomes[0].reconciliation).toEqual({ outcome: 'known', nonce: NONCE });
    expect(ask).not.toHaveBeenCalled();
    expect(k1ColourBalance(ALICE, COLOUR)).toBe(110n);
  });

  /* A PASSPORT BROUGHT BACK ON A NEW DEVICE (2026/09/26). Its account was
     pointed at the new device's key, and every note delivered before that is
     sealed to the key on the device that is gone. Handed both keys — the
     earlier one given back by the sign-in it came back through — the walk
     reads both sets, and a key that opens nothing changes nothing. */
  it('tries every key it is handed on every entry, and reads notes sealed to an earlier key', async () => {
    const before = generateCustodyEncKeyPair();
    const after = generateCustodyEncKeyPair();
    const early = await sealCustodyInboxEntry(before.publicKeyHex, coin({ value: 25n }));
    const late = await sealCustodyInboxEntry(
      after.publicKeyHex,
      coin({ value: 7n, colour: '2b'.repeat(32), nonce: '6e'.repeat(32) }),
    );
    const options = { txIdFor: () => null, windows: () => Promise.resolve(WINDOW) };

    const newKeyOnly = await readInboxCustody(ALICE, [after.secretKeyHex], reader([early, late]), options);
    expect(newKeyOnly.coins.map((found) => found.value)).toEqual([7n]);
    expect(newKeyOnly.skipped).toBe(1);

    const both = await readInboxCustody(
      ALICE,
      [after.secretKeyHex, before.secretKeyHex],
      reader([early, late]),
      options,
    );
    expect(both.coins.map((found) => [found.inboxIndex, found.value])).toEqual([
      [0n, 25n],
      [1n, 7n],
    ]);
    expect(both.skipped).toBe(0);

    /* No key at all opens nothing, and says so rather than failing. */
    const none = await readInboxCustody(ALICE, [], reader([early]), options);
    expect(none.coins).toEqual([]);
    expect(none.skipped).toBe(1);
  });

  it('walks past entries addressed to somebody else', async () => {
    const keys = generateCustodyEncKeyPair();
    const stranger = generateCustodyEncKeyPair();
    const mine = await sealCustodyInboxEntry(keys.publicKeyHex, coin({ value: 5n }));
    const theirs = await sealCustodyInboxEntry(stranger.publicKeyHex, coin({ value: 999n }));

    const result = await readInboxCustody(
      ALICE,
      keys.secretKeyHex,
      reader([theirs, mine, null, new Uint8Array(CUSTODY_INBOX_ENTRY_BYTES)]),
      { txIdFor: () => 'tx-1', windows: () => Promise.resolve(WINDOW) },
    );

    expect(result.coins).toEqual([{ ...coin({ value: 5n }), inboxIndex: 1n }]);
    expect(result.skipped).toBe(3);
  });

  it('reports a coin whose transaction nothing here knows, and stores nothing', async () => {
    const keys = generateCustodyEncKeyPair();
    const entry = await sealCustodyInboxEntry(keys.publicKeyHex, coin());

    const result = await readInboxCustody(ALICE, keys.secretKeyHex, reader([entry]), {
      txIdFor: () => null,
      windows: () => Promise.resolve(WINDOW),
      deps: REAL,
    });

    expect(result.coins).toHaveLength(1);
    expect(result.outcomes[0].reconciliation).toEqual({
      outcome: 'unavailable',
      reason: 'Nothing here knows which transaction wrote inbox entry 0.',
    });
    expect(heldK1Coin(ALICE, COLOUR)).toBeNull();
  });

  it('stores nothing for a coin whose position is still ambiguous', async () => {
    const keys = generateCustodyEncKeyPair();
    const entry = await sealCustodyInboxEntry(keys.publicKeyHex, coin());

    const result = await readInboxCustody(ALICE, keys.secretKeyHex, reader([entry]), {
      txIdFor: () => 'tx-many',
      windows: () => Promise.resolve({ startIndex: 4, endIndex: 7 }),
    });

    expect(result.outcomes[0].reconciliation).toEqual({
      outcome: 'ambiguous',
      candidates: [4n, 5n, 6n],
      stored: false,
      placed: null,
    });
    expect(heldK1Coin(ALICE, COLOUR)).toBeNull();
  });

  it('finds nothing in an empty inbox', async () => {
    const keys = generateCustodyEncKeyPair();
    const result = await readInboxCustody(ALICE, keys.secretKeyHex, reader([]), {
      txIdFor: () => 'tx-1',
      windows: () => Promise.resolve(WINDOW),
    });
    expect(result).toEqual({ coins: [], outcomes: [], skipped: 0 });
  });

  it('is told which transaction wrote which entry', async () => {
    const keys = generateCustodyEncKeyPair();
    const first = await sealCustodyInboxEntry(keys.publicKeyHex, coin({ value: 1n }));
    const second = await sealCustodyInboxEntry(keys.publicKeyHex, {
      colour: 'cc'.repeat(32),
      nonce: 'dd'.repeat(32),
      value: 2n,
    });
    const asked: string[] = [];

    await readInboxCustody(ALICE, keys.secretKeyHex, reader([first, second]), {
      txIdFor: (index) => `tx-${index}`,
      windows: (txId) => {
        asked.push(txId);
        return Promise.resolve(WINDOW);
      },
    });

    expect(asked).toEqual(['tx-0', 'tx-1']);
  });
});

/* -------------------------------------------------------------------------- */

describe('paying into another custody Passport', () => {
  it('builds both arguments deposit_shielded takes', async () => {
    const recipient = generateCustodyEncKeyPair();
    const deposit = await depositShieldedCustody(recipient.publicKeyHex, coin({ value: 77n }));

    expect(deposit.entry.length).toBe(CUSTODY_INBOX_ENTRY_BYTES);
    expect(bytesToHex(deposit.coin.nonce)).toBe(NONCE);
    expect(bytesToHex(deposit.coin.color)).toBe(COLOUR);
    expect(deposit.coin.value).toBe(77n);

    /* The recipient, and only the recipient, can learn what arrived. */
    expect(await openCustodyInboxEntry(recipient.secretKeyHex, deposit.entry)).toEqual(
      coin({ value: 77n }),
    );
  });

  it('refuses a coin it cannot describe', async () => {
    const recipient = generateCustodyEncKeyPair();
    await expect(
      depositShieldedCustody(recipient.publicKeyHex, coin({ nonce: 'short' })),
    ).rejects.toThrow(/coin nonce/);
  });
});
