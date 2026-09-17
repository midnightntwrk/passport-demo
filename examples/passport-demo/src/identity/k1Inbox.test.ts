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
  K1_ENC_KEY_KEY,
  K1_INBOX_ENTRY_BYTES,
  K1_INBOX_HKDF_INFO,
  K1_INBOX_PLAINTEXT_BYTES,
  K1_INBOX_SUITE,
  K1_INBOX_VERSION,
  decodeK1InboxPlaintext,
  defaultK1InboxDeps,
  depositShieldedK1,
  encodeK1InboxPlaintext,
  generateK1EncKeyPair,
  k1EncKeyPair,
  k1EncKeySlot,
  k1EncPublicKey,
  openK1InboxEntry,
  packK1InboxEntry,
  readInboxK1,
  sealK1InboxEntry,
  unpackK1InboxEntry,
  type K1InboxCoin,
  type K1InboxDeps,
  type K1InboxReader,
  type K1InboxStorage,
} from './k1Inbox.js';
import { bytesToHex } from './accountK1.js';
import { hexToBytes } from './accountK1Plan.js';
import { heldK1Coin, type K1Account, type K1CommitmentWindow } from './k1CoinStore.js';

import fixtures from './fixtures/inbox-v1.json' with { type: 'json' };

const ALICE: K1Account = { network: 'stagenet', address: 'ab'.repeat(32) };

const NONCE = '7f'.repeat(32);
const COLOUR = '1a'.repeat(32);

function coin(patch: Partial<K1InboxCoin> = {}): K1InboxCoin {
  return { colour: COLOUR, nonce: NONCE, value: 100n, ...patch };
}

/** Real randomness, real `crypto.subtle` — the defaults, named for legibility. */
const REAL: K1InboxDeps = defaultK1InboxDeps();

/** The smallest thing that behaves like `localStorage`, and its backing map. */
function fakeStorage(behaviour: { denyWrites?: boolean } = {}): {
  storage: K1InboxStorage;
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
      const opened = await openK1InboxEntry(
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
      const opened = await openK1InboxEntry(
        fixtures.stranger.secretKeyHex,
        hexToBytes(fixture.entryHex),
      );
      expect(opened).toBeNull();
    }
  });

  it('agrees with the reference about the container’s shape', () => {
    expect(K1_INBOX_ENTRY_BYTES).toBe(fixtures.entryBytes);
    expect(K1_INBOX_HKDF_INFO).toBe(fixtures.hkdfInfo);
    for (const fixture of fixtures.entries) {
      const bytes = hexToBytes(fixture.entryHex);
      expect(bytes.length).toBe(K1_INBOX_ENTRY_BYTES);
      expect(bytes[0]).toBe(K1_INBOX_VERSION);
      expect(bytes[1]).toBe(K1_INBOX_SUITE);
      /* The last fifty bytes are zero in every entry the reference writes. A
         reader must ignore them; a writer that filled them would be the only
         writer that did, and that is itself a signal. */
      expect([...bytes.subarray(142)]).toEqual(Array.from({ length: 50 }, () => 0));
    }
  });

  it('derives the same public key the reference advertised', () => {
    expect(k1EncPublicKey(fixtures.owner.secretKeyHex)).toBe(fixtures.owner.publicKeyHex);
    expect(k1EncPublicKey(fixtures.stranger.secretKeyHex)).toBe(fixtures.stranger.publicKeyHex);
  });

  it('seals entries the reference-generated owner key can be read back from', async () => {
    /* The other direction of the same claim: an entry THIS module produced,
       opened with the secret half of a keypair this module never generated. */
    const entry = await sealK1InboxEntry(fixtures.owner.publicKeyHex, coin({ value: 7n }));
    expect(await openK1InboxEntry(fixtures.owner.secretKeyHex, entry)).toEqual(coin({ value: 7n }));
  });
});

/* -------------------------------------------------------------------------- */

describe('the plaintext codec', () => {
  it('round trips a coin through eighty bytes', () => {
    const encoded = encodeK1InboxPlaintext(coin({ value: 1_000_000n }));
    expect(encoded.length).toBe(K1_INBOX_PLAINTEXT_BYTES);
    expect(bytesToHex(encoded.subarray(0, 32))).toBe(NONCE);
    expect(bytesToHex(encoded.subarray(32, 64))).toBe(COLOUR);
    expect(decodeK1InboxPlaintext(encoded)).toEqual(coin({ value: 1_000_000n }));
  });

  it('writes the value big-endian, the reference’s way', () => {
    const encoded = encodeK1InboxPlaintext(coin({ value: 1n }));
    expect(encoded[79]).toBe(1);
    expect(encoded[64]).toBe(0);
    const big = encodeK1InboxPlaintext(coin({ value: (1n << 127n) }));
    expect(big[64]).toBe(0x80);
  });

  it('carries the largest value the field can hold, and no more', () => {
    const max = (1n << 128n) - 1n;
    expect(decodeK1InboxPlaintext(encodeK1InboxPlaintext(coin({ value: max })))).toEqual(
      coin({ value: max }),
    );
    expect(() => encodeK1InboxPlaintext(coin({ value: max + 1n }))).toThrow(/128-bit/);
  });

  it('refuses a coin it could not encode faithfully', () => {
    expect(() => encodeK1InboxPlaintext(coin({ nonce: 'ff' }))).toThrow(/coin nonce/);
    expect(() => encodeK1InboxPlaintext(coin({ colour: 'not hex' }))).toThrow(/colour/);
    expect(() => encodeK1InboxPlaintext(coin({ value: -1n }))).toThrow(/128-bit/);
    expect(() =>
      encodeK1InboxPlaintext(coin({ value: 5 as unknown as bigint })),
    ).toThrow(/128-bit/);
    expect(() =>
      encodeK1InboxPlaintext(coin({ nonce: 42 as unknown as string })),
    ).toThrow(/coin nonce/);
  });

  it('accepts a 0x-prefixed, upper-case coin as the same coin', () => {
    const prefixed = encodeK1InboxPlaintext({
      nonce: `0x${NONCE.toUpperCase()}`,
      colour: `0x${COLOUR.toUpperCase()}`,
      value: 9n,
    });
    expect(decodeK1InboxPlaintext(prefixed)).toEqual(coin({ value: 9n }));
  });

  it('decodes nothing from a plaintext that is not eighty bytes', () => {
    expect(decodeK1InboxPlaintext(new Uint8Array(79))).toBeNull();
    expect(decodeK1InboxPlaintext(new Uint8Array(81))).toBeNull();
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
    const entry = packK1InboxEntry(parts);
    expect(entry.length).toBe(K1_INBOX_ENTRY_BYTES);
    expect(entry[0]).toBe(K1_INBOX_VERSION);
    expect(entry[1]).toBe(K1_INBOX_SUITE);
    expect(unpackK1InboxEntry(entry)).toEqual(parts);
  });

  it('refuses to pack a field of the wrong length', () => {
    expect(() =>
      packK1InboxEntry({ ...parts, ephemeralPublicKey: new Uint8Array(31) }),
    ).toThrow(/ephemeral public key/);
    expect(() => packK1InboxEntry({ ...parts, nonce: new Uint8Array(11) })).toThrow(/AEAD nonce/);
    expect(() => packK1InboxEntry({ ...parts, tag: new Uint8Array(15) })).toThrow(/AEAD tag/);
    expect(() => packK1InboxEntry({ ...parts, ciphertext: new Uint8Array(79) })).toThrow(
      /ciphertext/,
    );
  });

  it('refuses to pack something that is not bytes at all', () => {
    expect(() =>
      packK1InboxEntry({ ...parts, nonce: undefined as unknown as Uint8Array }),
    ).toThrow(/AEAD nonce/);
  });

  it('skips an entry it must not read, rather than failing', () => {
    expect(unpackK1InboxEntry(new Uint8Array(191))).toBeNull();
    expect(unpackK1InboxEntry('nope' as unknown as Uint8Array)).toBeNull();

    const futureVersion = packK1InboxEntry(parts);
    futureVersion[0] = 0x02;
    expect(unpackK1InboxEntry(futureVersion)).toBeNull();

    const futureSuite = packK1InboxEntry(parts);
    futureSuite[1] = 0x09;
    expect(unpackK1InboxEntry(futureSuite)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe('sealing and opening', () => {
  it('round trips through a freshly generated keypair', async () => {
    const keys = generateK1EncKeyPair();
    const entry = await sealK1InboxEntry(keys.publicKeyHex, coin({ value: 4_200n }));
    expect(entry.length).toBe(K1_INBOX_ENTRY_BYTES);
    expect(await openK1InboxEntry(keys.secretKeyHex, entry)).toEqual(coin({ value: 4_200n }));
  });

  it('gives two deposits of the same coin two different entries', async () => {
    const keys = generateK1EncKeyPair();
    const first = await sealK1InboxEntry(keys.publicKeyHex, coin());
    const second = await sealK1InboxEntry(keys.publicKeyHex, coin());
    expect(bytesToHex(first)).not.toBe(bytesToHex(second));
  });

  it('will not open with the wrong secret', async () => {
    const keys = generateK1EncKeyPair();
    const stranger = generateK1EncKeyPair();
    const entry = await sealK1InboxEntry(keys.publicKeyHex, coin());
    expect(await openK1InboxEntry(stranger.secretKeyHex, entry)).toBeNull();
  });

  it('will not open an entry whose bytes were touched', async () => {
    const keys = generateK1EncKeyPair();
    const entry = await sealK1InboxEntry(keys.publicKeyHex, coin());

    const flippedCiphertext = entry.slice();
    flippedCiphertext[62] ^= 0x01;
    expect(await openK1InboxEntry(keys.secretKeyHex, flippedCiphertext)).toBeNull();

    const flippedTag = entry.slice();
    flippedTag[46] ^= 0x01;
    expect(await openK1InboxEntry(keys.secretKeyHex, flippedTag)).toBeNull();

    const flippedEphemeral = entry.slice();
    flippedEphemeral[2] ^= 0x01;
    expect(await openK1InboxEntry(keys.secretKeyHex, flippedEphemeral)).toBeNull();
  });

  it('ignores the padding, as a reader must', async () => {
    const keys = generateK1EncKeyPair();
    const entry = await sealK1InboxEntry(keys.publicKeyHex, coin());
    const scribbled = entry.slice();
    scribbled.fill(0xaa, 142);
    expect(await openK1InboxEntry(keys.secretKeyHex, scribbled)).toEqual(coin());
  });

  it('refuses to seal to something that is not a key', async () => {
    await expect(sealK1InboxEntry('ab', coin())).rejects.toThrow(/32-byte/);
  });

  it('opens nothing with something that is not a secret', async () => {
    const keys = generateK1EncKeyPair();
    const entry = await sealK1InboxEntry(keys.publicKeyHex, coin());
    expect(await openK1InboxEntry('', entry)).toBeNull();
    expect(await openK1InboxEntry(keys.secretKeyHex, new Uint8Array(10))).toBeNull();
  });

  it('refuses a public key that is not one', () => {
    expect(() => k1EncPublicKey('zz')).toThrow(/32 bytes/);
  });

  it('uses real randomness and real WebCrypto by default', () => {
    const deps = defaultK1InboxDeps();
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
    const first = k1EncKeyPair(store, 'user-a', ACCOUNT);
    const second = k1EncKeyPair(store, 'user-a', ACCOUNT);
    expect(second).toEqual(first);
    expect(k1EncPublicKey(first.secretKeyHex)).toBe(first.publicKeyHex);
  });

  it('keeps two Dynamic users apart', () => {
    const { storage: store } = fakeStorage();
    expect(k1EncKeyPair(store, 'user-a', ACCOUNT).secretKeyHex).not.toBe(
      k1EncKeyPair(store, 'user-b', ACCOUNT).secretKeyHex,
    );
  });

  /* PER ACCOUNT AND PER NETWORK. One secret across all of a user's accounts
     made a stagenet account and a devnet account advertise the same public
     half — visibly one person to anybody who sends to both — and made one
     leaked secret open every inbox instead of one. */
  it('keeps two accounts of the same user apart', () => {
    const { storage: store } = fakeStorage();
    expect(k1EncKeyPair(store, 'user-a', ACCOUNT).secretKeyHex).not.toBe(
      k1EncKeyPair(store, 'user-a', OTHER_ACCOUNT).secretKeyHex,
    );
  });

  it('keeps one account’s two networks apart', () => {
    const { storage: store } = fakeStorage();
    expect(k1EncKeyPair(store, 'user-a', ACCOUNT).secretKeyHex).not.toBe(
      k1EncKeyPair(store, 'user-a', OTHER_NETWORK).secretKeyHex,
    );
  });

  it('does not make a second key out of a different spelling', () => {
    const { storage: store } = fakeStorage();
    const made = k1EncKeyPair(store, 'USER-A', ACCOUNT);
    expect(k1EncKeyPair(store, 'user-a', { ...ACCOUNT, accountId: 'AA'.repeat(32) })).toEqual(made);
    expect(k1EncKeySlot('User-A', ACCOUNT)).toBe(`user-a|stagenet|${'aa'.repeat(32)}`);
  });

  it('survives a reload — the same storage, a new call', () => {
    const { storage: store, map } = fakeStorage();
    const made = k1EncKeyPair(store, 'user-a', ACCOUNT);
    const reloaded: K1InboxStorage = {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => void map.set(key, value),
    };
    expect(k1EncKeyPair(reloaded, 'user-a', ACCOUNT)).toEqual(made);
  });

  it('replaces a stored blob it cannot read, rather than trusting it', () => {
    const { storage: store, map } = fakeStorage();
    map.set(K1_ENC_KEY_KEY, 'not json');
    expect(k1EncKeyPair(store, 'user-a', ACCOUNT).secretKeyHex).toHaveLength(64);

    map.set(K1_ENC_KEY_KEY, '["an array"]');
    expect(k1EncKeyPair(store, 'user-a', ACCOUNT).secretKeyHex).toHaveLength(64);

    map.set(K1_ENC_KEY_KEY, 'null');
    expect(k1EncKeyPair(store, 'user-a', ACCOUNT).secretKeyHex).toHaveLength(64);

    map.set(K1_ENC_KEY_KEY, JSON.stringify({ [k1EncKeySlot('user-a', ACCOUNT)]: 'too short' }));
    expect(k1EncKeyPair(store, 'user-a', ACCOUNT).secretKeyHex).toHaveLength(64);
  });

  it('still serves this session when the write is denied', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { storage: store } = fakeStorage({ denyWrites: true });
    const made = k1EncKeyPair(store, 'user-a', ACCOUNT);
    expect(made.secretKeyHex).toHaveLength(64);
    expect(warn).toHaveBeenCalled();
  });

  it('takes injected randomness, so a drill is repeatable', () => {
    const fixed: K1InboxDeps = {
      randomBytes: (length) => new Uint8Array(length).fill(7),
      subtle: () => globalThis.crypto.subtle,
    };
    const { storage: store } = fakeStorage();
    expect(k1EncKeyPair(store, 'user-a', ACCOUNT, fixed).secretKeyHex).toBe('07'.repeat(32));
    expect(generateK1EncKeyPair(fixed).secretKeyHex).toBe('07'.repeat(32));
  });
});

/* -------------------------------------------------------------------------- */

/** An inbox built out of whatever entries a drill wants in it. */
function reader(entries: readonly (Uint8Array | null)[]): K1InboxReader {
  return {
    count: () => BigInt(entries.length),
    entryAt: (index) => entries[Number(index)] ?? null,
  };
}

const WINDOW: K1CommitmentWindow = { startIndex: 11, endIndex: 12 };

describe('the inbox walk', () => {
  it('recovers a coin somebody else deposited and stores it', async () => {
    const keys = generateK1EncKeyPair();
    const entry = await sealK1InboxEntry(keys.publicKeyHex, coin({ value: 250n }));

    const result = await readInboxK1(ALICE, keys.secretKeyHex, reader([entry]), {
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

  it('walks past entries addressed to somebody else', async () => {
    const keys = generateK1EncKeyPair();
    const stranger = generateK1EncKeyPair();
    const mine = await sealK1InboxEntry(keys.publicKeyHex, coin({ value: 5n }));
    const theirs = await sealK1InboxEntry(stranger.publicKeyHex, coin({ value: 999n }));

    const result = await readInboxK1(
      ALICE,
      keys.secretKeyHex,
      reader([theirs, mine, null, new Uint8Array(K1_INBOX_ENTRY_BYTES)]),
      { txIdFor: () => 'tx-1', windows: () => Promise.resolve(WINDOW) },
    );

    expect(result.coins).toEqual([{ ...coin({ value: 5n }), inboxIndex: 1n }]);
    expect(result.skipped).toBe(3);
  });

  it('reports a coin whose transaction nothing here knows, and stores nothing', async () => {
    const keys = generateK1EncKeyPair();
    const entry = await sealK1InboxEntry(keys.publicKeyHex, coin());

    const result = await readInboxK1(ALICE, keys.secretKeyHex, reader([entry]), {
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
    const keys = generateK1EncKeyPair();
    const entry = await sealK1InboxEntry(keys.publicKeyHex, coin());

    const result = await readInboxK1(ALICE, keys.secretKeyHex, reader([entry]), {
      txIdFor: () => 'tx-many',
      windows: () => Promise.resolve({ startIndex: 4, endIndex: 7 }),
    });

    expect(result.outcomes[0].reconciliation).toEqual({
      outcome: 'ambiguous',
      candidates: [4n, 5n, 6n],
    });
    expect(heldK1Coin(ALICE, COLOUR)).toBeNull();
  });

  it('finds nothing in an empty inbox', async () => {
    const keys = generateK1EncKeyPair();
    const result = await readInboxK1(ALICE, keys.secretKeyHex, reader([]), {
      txIdFor: () => 'tx-1',
      windows: () => Promise.resolve(WINDOW),
    });
    expect(result).toEqual({ coins: [], outcomes: [], skipped: 0 });
  });

  it('is told which transaction wrote which entry', async () => {
    const keys = generateK1EncKeyPair();
    const first = await sealK1InboxEntry(keys.publicKeyHex, coin({ value: 1n }));
    const second = await sealK1InboxEntry(keys.publicKeyHex, {
      colour: 'cc'.repeat(32),
      nonce: 'dd'.repeat(32),
      value: 2n,
    });
    const asked: string[] = [];

    await readInboxK1(ALICE, keys.secretKeyHex, reader([first, second]), {
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

describe('paying into another k1 Passport', () => {
  it('builds both arguments deposit_shielded takes', async () => {
    const recipient = generateK1EncKeyPair();
    const deposit = await depositShieldedK1(recipient.publicKeyHex, coin({ value: 77n }));

    expect(deposit.entry.length).toBe(K1_INBOX_ENTRY_BYTES);
    expect(bytesToHex(deposit.coin.nonce)).toBe(NONCE);
    expect(bytesToHex(deposit.coin.color)).toBe(COLOUR);
    expect(deposit.coin.value).toBe(77n);

    /* The recipient, and only the recipient, can learn what arrived. */
    expect(await openK1InboxEntry(recipient.secretKeyHex, deposit.entry)).toEqual(
      coin({ value: 77n }),
    );
  });

  it('refuses a coin it cannot describe', async () => {
    const recipient = generateK1EncKeyPair();
    await expect(
      depositShieldedK1(recipient.publicKeyHex, coin({ nonce: 'short' })),
    ).rejects.toThrow(/coin nonce/);
  });
});
