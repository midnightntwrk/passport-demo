/**
 * The last step of coming back on a new device, wired (2026/09/26): once this
 * device is on the account and the account points at its key,
 * `adoptDeviceKey` asks the sign-in that approved it for the key the payments
 * from before were sealed to, and keeps it as an earlier key — with no
 * question, no password, and no file.
 *
 * `adoptDeviceKey` runs as it ships. What is stood in for is the chain (the two
 * circuit calls), the passkey derivation (a device made from a fixed secret),
 * and the provider (a map behind the same store the sign-in bridge fills).
 * Everything the recovery writes, and everything the restore reads and writes,
 * is the real code against one storage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./custodyContractClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./custodyContractClient.js')>();
  const landed = { record: {}, txHash: null, explorerUrl: null };
  return {
    ...actual,
    addDeviceK1: vi.fn(() => Promise.resolve(landed)),
    rotateEncKeyK1: vi.fn(() => Promise.resolve(landed)),
    defaultCustodyDeps: () => ({ contractModule: () => Promise.resolve({ pureCircuits: {} }) }),
  };
});

vi.mock('./passkeyCustody.js', () => ({
  passkeyCustodyDevice: vi.fn(() =>
    Promise.resolve({
      device: { arm: 'jubjub', pk: { x: 0x1234n, y: 0x5678n }, encSecretKeyHex: '22'.repeat(32) },
      userKey: 'jubjub:1234',
      forget: () => undefined,
    }),
  ),
}));

import {
  publishDynamicActions,
  publishDynamicSession,
  resetDynamicSessionStoreForTests,
} from '../lib/dynamicSession.js';
import { adoptDeviceKey } from './custodyAdopt.js';
import { rotateEncKeyK1 } from './custodyContractClient.js';
import { K256_ENVELOPE_NONE, type K256DeviceIdentity } from './custodyContractSigning.js';
import { SIGN_IN_KEYS_WAIT_MS } from './signInViewingKeys.js';
import { loadEarlierViewingKeys, viewingSecretsFor } from './viewingKeys.js';

const ACCOUNT = { network: 'stagenet', address: 'ab'.repeat(32) };
const SLOT = `stagenet:${'ab'.repeat(32)}`;
/** The key on the device that is gone, and the one this device derives. */
const OLD_KEY = '11'.repeat(32);
const NEW_KEY = '22'.repeat(32);
const USER = '0x00a329c0648769a73afac7f9381e08fb43dbea72';
/** The sign-in's key. Only the stood-in add reads it. */
const SOCIAL_DEVICE: K256DeviceIdentity = {
  arm: 'k256',
  pk: { x: 3n, y: 4n, identity: false },
  envelope: K256_ENVELOPE_NONE,
};

let map: Map<string, string>;
const storage = {
  getItem: (key: string) => map.get(key) ?? null,
  setItem: (key: string, value: string) => void map.set(key, value),
  removeItem: (key: string) => void map.delete(key),
};

/** What the provider holds for the signed-in person, and every write it took. */
let held: unknown;
let writes: unknown[];
let reads: number;
let silent: boolean;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  map = new Map();
  vi.stubGlobal('window', { localStorage: storage });
  held = undefined;
  writes = [];
  reads = 0;
  silent = false;
  resetDynamicSessionStoreForTests();
  publishDynamicActions({
    openAuthFlow: () => undefined,
    signMessage: () => Promise.reject(new Error('unused')),
    signRaw: () => Promise.reject(new Error('unused')),
    signOut: () => Promise.resolve(),
    readMetadata: () => {
      reads += 1;
      return silent ? new Promise(() => undefined) : Promise.resolve(structuredClone(held));
    },
    writeMetadata: (metadata) => {
      writes.push(structuredClone(metadata));
      held = structuredClone(metadata);
      return Promise.resolve(structuredClone(held));
    },
  });
  publishDynamicSession({ status: 'signed-in', provider: 'Google', handle: 'walker', evmAddress: USER });
  vi.mocked(rotateEncKeyK1).mockClear();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  warn.mockRestore();
  vi.useRealTimers();
  resetDynamicSessionStoreForTests();
});

function adopt() {
  return adoptDeviceKey({
    handoff: { network: ACCOUNT.network, address: ACCOUNT.address, name: 'walker', socialUser: USER },
    contractRoot: () => Promise.resolve(new Uint8Array(32)),
    credentialId: 'credential',
    session: { address: USER, signRaw: () => Promise.reject(new Error('unused')) },
    socialDevice: SOCIAL_DEVICE,
    storage,
  });
}

describe('coming back on a new device through the sign-in', () => {
  it('ends by keeping the key the sign-in holds for this Passport, and gives it this device’s key', async () => {
    held = { theme: 'dark', passport: { v: 1, keys: { [SLOT]: [OLD_KEY] } } };
    await expect(adopt()).resolves.toMatchObject({ userKey: 'jubjub:1234', pointedAtNewKey: true });

    /* The inbox walk now opens what was sealed before this device, and
       everything sealed from the rotation on. */
    expect(viewingSecretsFor(storage, ACCOUNT, NEW_KEY)).toEqual([NEW_KEY, OLD_KEY]);
    /* The sign-in keeps both, oldest first, for the next device — and keeps
       what else it held. The rotation came first, so the key it wrote is the
       one the account now points at. */
    expect(held).toEqual({ theme: 'dark', passport: { v: 1, keys: { [SLOT]: [OLD_KEY, NEW_KEY] } } });
    expect(writes).toHaveLength(1);
    expect(vi.mocked(rotateEncKeyK1)).toHaveBeenCalledTimes(1);
  });

  it('still brings the Passport here when the sign-in keeps nothing for it, and says nothing new', async () => {
    await expect(adopt()).resolves.toMatchObject({ pointedAtNewKey: true });
    expect(loadEarlierViewingKeys(storage, ACCOUNT)).toEqual([]);
    /* This device's key is kept for the next one all the same. */
    expect(held).toEqual({ passport: { v: 1, keys: { [SLOT]: [NEW_KEY] } } });
  });

  it('reads nothing from a sign-in other than the one that found the Passport', async () => {
    held = { passport: { v: 1, keys: { [SLOT]: [OLD_KEY] } } };
    publishDynamicSession({
      status: 'signed-in',
      provider: 'Google',
      handle: 'somebody',
      evmAddress: '0x1111111111111111111111111111111111111111',
    });
    await expect(adopt()).resolves.toMatchObject({ pointedAtNewKey: true });
    expect(reads).toBe(0);
    expect(loadEarlierViewingKeys(storage, ACCOUNT)).toEqual([]);
  });

  it('is not held by a sign-in that never answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    silent = true;
    const adopted = adopt();
    await vi.advanceTimersByTimeAsync(SIGN_IN_KEYS_WAIT_MS);
    await expect(adopted).resolves.toMatchObject({ pointedAtNewKey: true });
    expect(reads).toBe(1);
  });
});
