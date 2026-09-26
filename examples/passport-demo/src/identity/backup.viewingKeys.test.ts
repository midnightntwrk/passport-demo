/**
 * The viewing key in the password backup (2026/09/26) — the format, the one
 * named exception to "no keys", and the whole point of it: a Passport restored
 * on a new device reads the notes it was sent before.
 *
 * Real WebCrypto and real X25519 throughout, as in `./backup.test.ts`. The only
 * thing replaced is `localStorage`, with a map, because every store involved
 * talks to it and to nothing else.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  PASSPORT_BACKUP_KDF,
  PASSPORT_BACKUP_VERSION,
  applyPassportBackup,
  assertNoKeyMaterial,
  collectPassportBackup,
  describeViewingKeyRestore,
  exportPassportBackup,
  importPassportBackup,
  openPassportBackup,
  sealPassportBackup,
  viewingKeyAccountCount,
  type PassportBackupBackend,
  type PassportBackupContents,
  type PassportBackupEnvelope,
} from './backup.js';
import {
  generateCustodyEncKeyPair,
  readInboxCustody,
  sealCustodyInboxEntry,
  type CustodyInboxReader,
} from './custodyInbox.js';
import { heldK1Coin, rememberK1EncSecretKey } from './k1CoinStore.js';
import {
  EARLIER_VIEWING_KEYS_KEY,
  loadEarlierViewingKeys,
  rememberEarlierViewingKey,
  viewingSecretsFor,
} from './viewingKeys.js';

const PASSWORD = 'correct horse battery staple';
const ACCOUNT = { network: 'stagenet', address: 'ab'.repeat(32) };
const MUSD = '1a'.repeat(32);

/** One device's storage. A new device is a new map. */
let storage: Map<string, string>;

function newDevice(): void {
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
}

beforeEach(() => newDevice());

/** A payload with no records and the viewing keys given. */
function keysOnly(viewingKeys: unknown): PassportBackupContents {
  return {
    version: PASSPORT_BACKUP_VERSION,
    createdAt: '2026-09-26T09:00:00.000Z',
    aliases: {},
    passportContracts: {},
    incentives: [],
    viewingKeys: viewingKeys as PassportBackupContents['viewingKeys'],
  };
}

/**
 * An envelope sealed by hand at a format number of the caller's choosing — the
 * way a build before 2026/09/26 sealed every file, header bytes and all. Written
 * out here rather than borrowed from the module, so "old backups still restore"
 * is held against the old format rather than against whatever the module now
 * writes.
 */
async function sealAtFormat(version: number, plaintext: string): Promise<PassportBackupEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(PASSWORD),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600_000 },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      additionalData: new TextEncoder().encode(
        `midnight-passport:backup:v1 ${version} ${PASSPORT_BACKUP_KDF}`,
      ),
    },
    key,
    new TextEncoder().encode(plaintext),
  );
  const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
  return {
    v: version,
    kdf: PASSPORT_BACKUP_KDF,
    salt: b64(salt),
    nonce: b64(nonce),
    ciphertext: b64(new Uint8Array(ciphertext)),
  };
}

/** An inbox reader over a list of entries, as the contract's state answers. */
function inbox(entries: Uint8Array[]): CustodyInboxReader {
  return {
    count: () => BigInt(entries.length),
    entryAt: (index) => entries[Number(index)] ?? null,
  };
}

/** A backend that keeps what it is given, so a test can carry the file across. */
function memoryBackend(): PassportBackupBackend & { written: string[] } {
  const written: string[] = [];
  return {
    id: 'memory',
    label: 'memory',
    written,
    isAvailable: () => true,
    write: (fileName, envelope) => {
      written.push(envelope);
      return Promise.resolve({ kind: 'saved', fileName, location: 'memory' });
    },
    read: () => Promise.resolve(written[written.length - 1] ?? ''),
  };
}

/* -------------------------------------------------------------------------- */
/* The format                                                                 */
/* -------------------------------------------------------------------------- */

describe('the format that carries a viewing key', () => {
  it('writes format 2, with the key and the account it reads, and nothing about coins', async () => {
    rememberK1EncSecretKey(ACCOUNT, 'CC'.repeat(32));
    const collected = await collectPassportBackup();
    expect(collected.version).toBe(2);
    expect(collected.viewingKeys).toEqual([
      { network: 'stagenet', address: ACCOUNT.address, viewingSecret: 'cc'.repeat(32) },
    ]);
    const envelope = await sealPassportBackup(collected, PASSWORD);
    expect(envelope.v).toBe(2);
    expect(JSON.stringify(envelope)).not.toContain('cc'.repeat(32));
    expect(await openPassportBackup(envelope, PASSWORD)).toEqual(collected);
  });

  it('carries earlier keys too, so a Passport that comes back twice still reads the first stretch', async () => {
    rememberK1EncSecretKey(ACCOUNT, 'cc'.repeat(32));
    rememberEarlierViewingKey(window.localStorage, ACCOUNT, 'dd'.repeat(32), 'cc'.repeat(32));
    /* An earlier key that is also some account's current key is carried once. */
    const other = { network: 'stagenet', address: 'ef'.repeat(32) };
    rememberK1EncSecretKey(other, '12'.repeat(32));
    storage.set(
      EARLIER_VIEWING_KEYS_KEY,
      JSON.stringify({
        ...JSON.parse(storage.get(EARLIER_VIEWING_KEYS_KEY)!),
        [`stagenet::${other.address}`]: ['12'.repeat(32)],
      }),
    );
    const collected = await collectPassportBackup();
    expect(collected.viewingKeys).toEqual([
      { network: 'stagenet', address: ACCOUNT.address, viewingSecret: 'cc'.repeat(32) },
      { network: 'stagenet', address: other.address, viewingSecret: '12'.repeat(32) },
      { network: 'stagenet', address: ACCOUNT.address, viewingSecret: 'dd'.repeat(32) },
    ]);
    expect(viewingKeyAccountCount(collected)).toBe(2);
  });

  it('writes no viewing key field at all for a browser that holds none', async () => {
    const collected = await collectPassportBackup();
    expect('viewingKeys' in collected).toBe(false);
    expect(viewingKeyAccountCount(collected)).toBe(0);
  });

  it('says how many accounts an export carried a key for', async () => {
    rememberK1EncSecretKey(ACCOUNT, 'cc'.repeat(32));
    const backend = memoryBackend();
    const exported = await exportPassportBackup(PASSWORD, backend);
    expect(exported.counts.viewingKeyAccounts).toBe(1);
    expect((JSON.parse(backend.written[0] ?? '{}') as { v: number }).v).toBe(2);
  });
});

describe('a backup written before the viewing key existed', () => {
  it('still opens, still restores, and carries no key', async () => {
    const old = await sealAtFormat(
      1,
      JSON.stringify({
        version: 1,
        createdAt: '2026-08-19T09:00:00.000Z',
        aliases: {},
        passportContracts: {},
        incentives: [
          {
            id: 'raffle-1',
            app: 'Midnight Raffle',
            label: 'One free entry',
            network: 'stagenet',
            redeemedAt: '2026-08-19T08:57:00.000Z',
          },
        ],
      }),
    );
    const opened = await openPassportBackup(JSON.stringify(old), PASSWORD);
    expect(opened.version).toBe(1);
    expect('viewingKeys' in opened).toBe(false);
    const summary = await applyPassportBackup(opened);
    expect(summary.incentives.restored).toBe(1);
    expect(summary.viewingKeys).toEqual({ found: 0, restored: 0, skipped: [], restoredKeys: [] });
    expect(describeViewingKeyRestore(summary.viewingKeys)).toBeNull();
  });

  it('is refused if it claims to carry a key, because format 1 never did', async () => {
    const forged = await sealAtFormat(
      1,
      JSON.stringify(
        keysOnly([{ network: 'stagenet', address: ACCOUNT.address, viewingSecret: 'cc'.repeat(32) }]),
      ),
    );
    await expect(openPassportBackup(forged, PASSWORD)).rejects.toMatchObject({
      code: 'key-material-present',
    });
    await expect(openPassportBackup(forged, PASSWORD)).rejects.toThrow(
      /format-1 Passport backup never carried a viewing key/,
    );
    expect(storage.has(EARLIER_VIEWING_KEYS_KEY)).toBe(false);
  });

  it('cannot be made by relabelling a format-2 file, because the number is authenticated', async () => {
    rememberK1EncSecretKey(ACCOUNT, 'cc'.repeat(32));
    const envelope = await sealPassportBackup(await collectPassportBackup(), PASSWORD);
    await expect(openPassportBackup({ ...envelope, v: 1 }, PASSWORD)).rejects.toMatchObject({
      code: 'wrong-password-or-tampered',
    });
  });
});

/* -------------------------------------------------------------------------- */
/* The one named exception                                                    */
/* -------------------------------------------------------------------------- */

describe('the "no keys" guard and its one exception', () => {
  const good = { network: 'stagenet', address: ACCOUNT.address, viewingSecret: 'cc'.repeat(32) };

  it('admits a viewing key in its own container, with its three fields', () => {
    expect(() => assertNoKeyMaterial(keysOnly([good]))).not.toThrow();
    expect(() => assertNoKeyMaterial(keysOnly([]))).not.toThrow();
  });

  it('refuses a viewing secret anywhere else, exactly as before', () => {
    expect(() => assertNoKeyMaterial({ ...keysOnly([good]), viewingSecret: 'cc'.repeat(32) })).toThrow(
      /state, never keys that can spend, and "backup\.viewingSecret" reads as key material/,
    );
    const inAlias = {
      ...keysOnly([]),
      aliases: { 'x::stagenet': { alias: 'a', domain: 'a.night', viewingSecret: 'cc'.repeat(32) } },
    };
    expect(() => assertNoKeyMaterial(inAlias)).toThrow(/aliases\.x::stagenet\.viewingSecret" reads as key material/);
    const inReward = { ...keysOnly([]), incentives: [{ id: 'r', viewingKey: 'cc'.repeat(32) }] };
    expect(() => assertNoKeyMaterial(inReward)).toThrow(/reads as key material/);
  });

  it('refuses anything in a viewing key record that is not one of its three fields', () => {
    for (const extra of ['spendingKey', 'seed', 'deviceSecret', 'encPublicKey', 'note']) {
      expect(() => assertNoKeyMaterial(keysOnly([{ ...good, [extra]: 'cc'.repeat(32) }]))).toThrow(
        /state, never keys that can spend/,
      );
    }
    expect(() => assertNoKeyMaterial(keysOnly([{ ...good, network: { nested: true } }]))).toThrow(
      /nested object where a plain value belongs/,
    );
  });

  it('checks the values too: a viewing key is 32 bytes, for an account, on a network', () => {
    const cases: [unknown, RegExp][] = [
      [{ ...good, viewingSecret: 'cc'.repeat(64) }, /viewingSecret" is not 32 bytes of hex/],
      [{ ...good, viewingSecret: 'CC'.repeat(32) }, /viewingSecret" is not 32 bytes of hex/],
      [{ ...good, viewingSecret: 12 }, /viewingSecret" is not 32 bytes of hex/],
      [{ network: 'stagenet', address: ACCOUNT.address }, /viewingSecret" is not 32 bytes of hex/],
      [{ ...good, address: 'ab' }, /address" is not one/],
      [{ ...good, address: 7 }, /address" is not one/],
      [{ ...good, network: ' ' }, /network" does not/],
      [{ ...good, network: 3 }, /network" does not/],
      ['cc'.repeat(32), /viewingKeys\[0\]" is not one/],
      [null, /viewingKeys\[0\]" is not one/],
    ];
    for (const [entry, message] of cases) {
      expect(() => assertNoKeyMaterial(keysOnly([entry])), String(message)).toThrow(message);
    }
    expect(() => assertNoKeyMaterial(keysOnly({ 0: good }))).toThrow(/as a list, and "backup\.viewingKeys" is not one/);
  });

  it('refuses a file carrying a bad viewing key before anything is written', async () => {
    /* Sealed by hand: the module's own seal refuses to write this at all. */
    await expect(
      sealPassportBackup(keysOnly([{ ...good, spendingKey: 'aa'.repeat(32) }]), PASSWORD),
    ).rejects.toMatchObject({ code: 'key-material-present' });
    const envelope = await sealAtFormat(
      2,
      JSON.stringify(keysOnly([{ ...good, spendingKey: 'aa'.repeat(32) }])),
    );
    await expect(openPassportBackup(envelope, PASSWORD)).rejects.toMatchObject({
      code: 'key-material-present',
    });
    expect(storage.has(EARLIER_VIEWING_KEYS_KEY)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Restoring it                                                               */
/* -------------------------------------------------------------------------- */

describe('giving a viewing key back', () => {
  it('keeps it as an earlier key beside the key this device already reads with', async () => {
    rememberK1EncSecretKey(ACCOUNT, 'ee'.repeat(32));
    const summary = await applyPassportBackup(
      keysOnly([
        { network: 'stagenet', address: ACCOUNT.address, viewingSecret: 'cc'.repeat(32) },
        { network: 'stagenet', address: ACCOUNT.address, viewingSecret: 'dd'.repeat(32) },
        /* The key this device already reads with — a backup restored onto the
           device that made it. */
        { network: 'stagenet', address: ACCOUNT.address, viewingSecret: 'ee'.repeat(32) },
      ]),
    );
    expect(summary.viewingKeys).toEqual({
      found: 3,
      restored: 2,
      skipped: [
        {
          key: `stagenet::${ACCOUNT.address}`,
          reason: 'this device already reads this account with that key',
        },
      ],
      restoredKeys: [`stagenet::${ACCOUNT.address}`, `stagenet::${ACCOUNT.address}`],
    });
    expect(loadEarlierViewingKeys(window.localStorage, ACCOUNT)).toEqual(['cc'.repeat(32), 'dd'.repeat(32)]);
    expect(describeViewingKeyRestore(summary.viewingKeys)).toBe(
      'Earlier payments: this Passport can now read what it was sent before this device. They appear on Home, ready to spend, once they have been read.',
    );
  });

  it('words the other endings: several Passports, nothing new, and nothing kept', async () => {
    const other = { network: 'preview', address: 'ef'.repeat(32) };
    const both = await applyPassportBackup(
      keysOnly([
        { network: 'stagenet', address: ACCOUNT.address, viewingSecret: 'cc'.repeat(32) },
        { ...other, viewingSecret: 'cc'.repeat(32) },
      ]),
    );
    expect(describeViewingKeyRestore(both.viewingKeys)).toMatch(/^Earlier payments: 2 Passports on this device/);

    /* The same file again: every key is already here. */
    const again = await applyPassportBackup(
      keysOnly([{ network: 'stagenet', address: ACCOUNT.address, viewingSecret: 'cc'.repeat(32) }]),
    );
    expect(again.viewingKeys.restored).toBe(0);
    expect(describeViewingKeyRestore(again.viewingKeys)).toBe(
      'Earlier payments: this device already reads everything this backup can.',
    );

    /* A browser that will not keep it. */
    newDevice();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem: () => null,
          setItem: () => {
            throw new Error('quota');
          },
          removeItem: () => undefined,
        },
      },
    });
    const refused = await applyPassportBackup(
      keysOnly([{ network: 'stagenet', address: ACCOUNT.address, viewingSecret: 'cc'.repeat(32) }]),
    );
    expect(refused.viewingKeys.skipped).toEqual([
      { key: `stagenet::${ACCOUNT.address}`, reason: 'this browser did not store it' },
    ]);
    expect(describeViewingKeyRestore(refused.viewingKeys)).toBe(
      'Earlier payments: the key in this backup could not be kept on this device, so payments from before it are still hidden.',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The point of it                                                            */
/* -------------------------------------------------------------------------- */

describe('a Passport recovered on a new device', () => {
  it('reads, and can then spend from, the notes it was sent before the old device was lost', async () => {
    /* THE OLD DEVICE. Its account advertises `before`; a payment of 25 mUSD
       arrives sealed to it. The person makes a backup. */
    const before = generateCustodyEncKeyPair();
    rememberK1EncSecretKey(ACCOUNT, before.secretKeyHex);
    const early = await sealCustodyInboxEntry(before.publicKeyHex, {
      colour: MUSD,
      nonce: '7f'.repeat(32),
      value: 25n,
    });
    const backend = memoryBackend();
    await exportPassportBackup(PASSWORD, backend);

    /* THE NEW DEVICE, after the sign-in brought the Passport back: a fresh
       browser, and the account pointed at the new device's key, `after`. A
       payment made after the recovery is sealed to that. */
    newDevice();
    const after = generateCustodyEncKeyPair();
    rememberK1EncSecretKey(ACCOUNT, after.secretKeyHex);
    const late = await sealCustodyInboxEntry(after.publicKeyHex, {
      colour: '2b'.repeat(32),
      nonce: '6e'.repeat(32),
      value: 5n,
    });
    const walk = () =>
      readInboxCustody(ACCOUNT, viewingSecretsFor(window.localStorage, ACCOUNT, after.secretKeyHex), inbox([early, late]), {
        txIdFor: (index) => `tx-${index}`,
        windows: (txId) => Promise.resolve(txId === 'tx-0' ? { startIndex: 40, endIndex: 41 } : { startIndex: 50, endIndex: 51 }),
        candidates: 'store',
      });

    /* Before the restore, only what came after is visible. */
    const blind = await walk();
    expect(blind.coins.map((coin) => coin.value)).toEqual([5n]);
    expect(heldK1Coin(ACCOUNT, MUSD)).toBeNull();

    /* The restore: the file from the old device and its password. */
    const summary = await importPassportBackup(backend.written[0] ?? '', PASSWORD, backend);
    expect(summary.viewingKeys.restored).toBe(1);
    expect(loadEarlierViewingKeys(window.localStorage, ACCOUNT)).toEqual([before.secretKeyHex]);

    /* And the walk reads both — the earlier mUSD is described, placed, and
       held, which is what makes it spendable: `held_coin` reads this store. */
    const seeing = await walk();
    expect(seeing.coins.map((coin) => [coin.inboxIndex, coin.value])).toEqual([
      [0n, 25n],
      [1n, 5n],
    ]);
    expect(heldK1Coin(ACCOUNT, MUSD)).toEqual({ colour: MUSD, nonce: '7f'.repeat(32), value: 25n, mtIndex: 40n });

    /* The device's own key is untouched: it is still the one the account is
       pointed at, and the one a later payment is read with first. */
    expect(viewingSecretsFor(window.localStorage, ACCOUNT, after.secretKeyHex)[0]).toBe(after.secretKeyHex);
  });
});
