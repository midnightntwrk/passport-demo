/**
 * BRINGING A PASSPORT TO A NEW DEVICE, drilled from an EMPTY browser.
 *
 * WHAT THIS PROTECTS (2026/09/26)
 * -------------------------------
 * Live, on a genuinely new device: the name was found, the sign-in was checked
 * against the account, a key was made here, and the screen then said "Adding
 * this device to …" for ever. The add is a gated call made by the SIGN-IN, and
 * every gated call reads its signer's record on this device first; a new device
 * has none, so `addDeviceK1` refused with "This Passport is not finished being
 * set up yet." before a signature was asked for. Every drill of this road —
 * `./custodyContractClient.addDevice.test.ts` included — had seeded that record
 * first, which is exactly the one thing a new device does not have.
 *
 * So every run below starts from storage that holds NOTHING, and drives the
 * real `adoptDeviceKey` through the real `addDeviceK1` and `rotateEncKeyK1` —
 * their guards, their device-set scans, the challenge builders, and a genuine
 * secp256k1 signature. What is injected is the chain, through the same
 * `CustodyDeps` seams `./custodyContractClient.addDevice.test.ts` uses.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';

import {
  bytesToHex,
  K256_ENVELOPE_NONE,
  pointFromUncompressed,
  scalarToBytesBE,
  type CurvePoint,
  type CustodyPureCircuits,
  type K256DeviceIdentity,
} from './custodyContractSigning.js';
import {
  CUSTODY_KEY_NOT_ADDED,
  custodyProofNotBuilt,
  loadCustodyRecord,
  saveCustodyRecord,
  type CustodyAccountRecord,
  type CustodyStorage,
} from './custodyContractPlan.js';
import {
  addDeviceK1,
  type CustodyDeps,
  type CustodyDynamicSession,
} from './custodyContractClient.js';
import { k1PrivateStateId, loadCustodyName } from './custodyContractSession.js';
import { passkeyCustodyDevice } from './passkeyCustody.js';
import { earlierPaymentsOfferDue } from './viewingKeys.js';
import { loadK1CoinStore } from './k1CoinStore.js';
import { adoptDeviceKey, bringPassportHere, type AdoptDeviceKeyOptions } from './custodyAdopt.js';
import { loadCustodyPasskeyPointer } from '../lib/custodyRoute.js';
import { loadBackupRecord } from '../lib/backupDevice.js';
import {
  ADOPTION_NOT_ADDED,
  ADOPTION_OTHER_PASSPORT,
  ADOPTION_OTHER_SIGN_IN,
  ADOPTION_PASSKEY_DECLINED,
  ADOPTION_UNCONFIRMED,
  type AdoptionHandoff,
} from '../lib/custodyAdoption.js';

const ADDRESS = 'ab'.repeat(32);
const NETWORK = 'stagenet';
const EPOCH = 3n;
/** Any 32 bytes: the passkey's contract root, as one assertion yields it. */
const ROOT = 0x5a;

/* THE PROVING SERVICE, STUBBED as `./custodyContractClient.addDevice.test.ts`
   stubs it: both circuits here are big-key ones, so the real
   `custodyProofProvider` is built around `globalThis.fetch` and exercised. */
beforeEach(() => {
  vi.stubGlobal('fetch', () =>
    Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ provenTx: 'ab' })),
    } as Response),
  );
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * The browser's storage, EMPTY — and installed as `window.localStorage` too,
 * because the coin store writes the viewing secret there directly.
 */
function emptyBrowser(): CustodyStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  const storage = {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
  vi.stubGlobal('window', { localStorage: storage });
  return storage;
}

/**
 * Deterministic stand-ins for the compiled build's pure circuits — the shape
 * `./custodyContractClient.addDevice.test.ts` spells out, spelled out again
 * for the reason that file gives.
 */
function pureFake(): CustodyPureCircuits {
  const tag = (name: string, ...parts: unknown[]): Uint8Array => {
    const text = `${name}:${parts.map((part) => String(part)).join('|')}`;
    const out = new Uint8Array(32);
    for (let index = 0; index < text.length; index += 1) out[index % 32] ^= text.charCodeAt(index);
    out[0] = name.length;
    /* A JubJub challenge is read little-endian and must land below the
       subgroup order; the real circuit's hash does so ~1 time in 17 and the
       signer grinds for it. This stand-in's XOR does not vary where it would
       need to, so its top byte is held at zero and every grind lands first
       time — which is all a drill of the CALLS needs of it. */
    out[31] = 0;
    return out;
  };
  return {
    derive_boot_commitment_with_jubjub: (salt, pk) => tag('boot-jj', bytesToHex(salt), pk.x),
    derive_boot_commitment_with_k256: (salt, pk, envelope) =>
      tag('boot-k1', bytesToHex(salt), pk.x, envelope),
    derive_device_entry_with_jubjub: (self, pk, epoch, counter) =>
      tag('entry-jj', bytesToHex(self.bytes), pk.x, epoch, counter),
    derive_device_entry_with_k256: (self, pk, envelope, epoch, counter) =>
      tag('entry-k1', bytesToHex(self.bytes), pk.x, envelope, epoch, counter),
    envelope_digest: (envelope, challenge) => tag('digest', envelope, bytesToHex(challenge)),
    compute_public_point_with_k256: (scalar) => ({ x: scalar, y: scalar, identity: false }),
    compute_public_point_with_jubjub: (scalar) => ({ x: scalar, y: scalar + 1n }),
    challenge_withdraw_shielded_with_k256: (self, pk) => tag('ch-ws', bytesToHex(self.bytes), pk.x),
    challenge_withdraw_shielded_to_contract_with_k256: (self, pk) =>
      tag('ch-wsc', bytesToHex(self.bytes), pk.x),
    challenge_withdraw_unshielded_with_k256: (self, pk) => tag('ch-wu', bytesToHex(self.bytes), pk.x),
    challenge_append_inbox_with_k256: (self, pk, entry, nonce) =>
      tag('ch-ai', bytesToHex(self.bytes), pk.x, entry.length, nonce),
    challenge_add_device_with_k256: (self, pk, entry, nonce) =>
      tag('ch-ad', bytesToHex(self.bytes), pk.x, bytesToHex(entry), nonce),
    challenge_withdraw_unshielded_with_jubjub: (self, sigR, pk) =>
      tag('jj-wu', bytesToHex(self.bytes), sigR.x, pk.x),
    challenge_withdraw_shielded_with_jubjub: (self, sigR, pk) =>
      tag('jj-ws', bytesToHex(self.bytes), sigR.x, pk.x),
    challenge_withdraw_shielded_to_contract_with_jubjub: (self, sigR, pk) =>
      tag('jj-wsc', bytesToHex(self.bytes), sigR.x, pk.x),
    challenge_append_inbox_with_jubjub: (self, sigR, pk, entry, nonce, grind) =>
      tag('jj-ai', bytesToHex(self.bytes), sigR.x, pk.x, entry.length, nonce, grind),
    challenge_rotate_enc_key_with_jubjub: (self, sigR, pk, newKey, nonce, grind) =>
      tag('jj-rk', bytesToHex(self.bytes), sigR.x, pk.x, bytesToHex(newKey), nonce, grind),
    challenge_add_device_with_jubjub: (self, sigR, pk, entry, nonce, grind) =>
      tag('jj-ad', bytesToHex(self.bytes), sigR.x, pk.x, bytesToHex(entry), nonce, grind),
    challenge_remove_device_with_jubjub: (self, sigR, pk, entry, nonce, grind) =>
      tag('jj-rd', bytesToHex(self.bytes), sigR.x, pk.x, bytesToHex(entry), nonce, grind),
  };
}

/** A real secp256k1 key standing in for the one behind the social sign-in. */
function socialSignIn(): {
  session: CustodyDynamicSession;
  device: K256DeviceIdentity;
  signed: Uint8Array[];
} {
  const secret = scalarToBytesBE(98765432109876543210n);
  const point = pointFromUncompressed(secp256k1.getPublicKey(secret, false));
  const signed: Uint8Array[] = [];
  return {
    session: {
      address: '0xAbCdEf0000000000000000000000000000000002',
      signRaw: ({ message }) => {
        const digest = Uint8Array.from(
          message.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
        );
        signed.push(digest);
        const recovered = secp256k1.sign(digest, secret, { prehash: false, format: 'recovered' });
        const r = bytesToHex(recovered.subarray(1, 33));
        const s = bytesToHex(recovered.subarray(33, 65));
        const v = (recovered[0] + 27).toString(16).padStart(2, '0');
        return Promise.resolve(`0x${r}${s}${v}`);
      },
    },
    device: { arm: 'k256', pk: point, envelope: K256_ENVELOPE_NONE },
    signed,
  };
}

/** A device's entry on this account, as the fake's own derivation makes it. */
function entryOf(kind: 'jj' | 'k1', pk: CurvePoint, counter = 0n): string {
  const pure = pureFake();
  const self = { bytes: Uint8Array.from((ADDRESS.match(/.{2}/g) ?? []).map((byte) => parseInt(byte, 16))) };
  return bytesToHex(
    kind === 'jj'
      ? pure.derive_device_entry_with_jubjub(self, pk, EPOCH, counter)
      : pure.derive_device_entry_with_k256(self, pk, K256_ENVELOPE_NONE, EPOCH, counter),
  );
}

/** The key this device's passkey makes, from the same root the drill hands over. */
async function thisDevicesKey(): Promise<CurvePoint> {
  const made = await passkeyCustodyDevice({ pure: pureFake(), contractRoot: new Uint8Array(32).fill(ROOT) });
  made.forget();
  return made.device.pk;
}

interface Chain {
  deps: Partial<CustodyDeps>;
  /** Every call built, in order, and every call made on the unbounded road. */
  calls: { circuit: string; args: readonly unknown[] }[];
  /** The entries the account's device set holds, as hex. */
  members: Set<string>;
}

/**
 * THE CHAIN, and only the chain: an account whose device set holds the
 * sign-in's key, and which takes what is submitted to it — an added key lands
 * in the device set, as the contract would put it there.
 */
function chain(options: {
  members: readonly string[];
  /** The first `times` submits of `circuit` are refused, as the proving service refuses. */
  refuse?: { circuit: string; times: number };
}): Chain {
  const calls: Chain['calls'] = [];
  const members = new Set(options.members);
  let refused = 0;
  const callTx = new Proxy(
    {},
    {
      get:
        (_target, circuit: string) =>
        (...args: unknown[]) => {
          calls.push({ circuit: `callTx:${circuit}`, args });
          return Promise.reject(new Error('the unbounded road is not taken by this flow'));
        },
    },
  );
  const providers: Record<string, unknown> = {
    publicDataProvider: {
      queryContractState: () => Promise.resolve({ data: 'state', serialize: () => new Uint8Array([1]) }),
      watchForTxData: (txId: string) => Promise.resolve({ txId, status: 'SucceedEntirely' }),
    },
    privateStateProvider: {
      setContractAddress: () => undefined,
      setSigningKey: () => Promise.resolve(undefined),
      getSigningKey: () => Promise.resolve('the-signing-key'),
      set: () => Promise.resolve(undefined),
    },
    compiledContract: { label: 'passport-account-custody' },
    indexerHttpUrl: '',
  };
  let submits = 0;
  return {
    calls,
    members,
    deps: {
      randomBytes: (length) => new Uint8Array(length).fill(7),
      wallet: () => Promise.resolve({ network: { networkId: NETWORK, indexerHttpUrl: '' } } as never),
      contractModule: () =>
        Promise.resolve({
          pureCircuits: pureFake(),
          Contract: class {},
          ledger: () => ({
            auth_nonce: 11n,
            device_epoch: EPOCH,
            device_count: BigInt(members.size),
            booted: true,
            devices: { member: (entry: Uint8Array) => members.has(bytesToHex(entry)) },
          }),
        }),
      providers: () => Promise.resolve(providers),
      contracts: () =>
        Promise.resolve({
          createUnprovenDeployTx: () => Promise.reject(new Error('not used here')),
          createUnprovenCallTx: (_providers: unknown, call: { circuitId: string; args: unknown[] }) => {
            calls.push({ circuit: call.circuitId, args: call.args });
            return Promise.resolve({
              private: {
                unprovenTx: { serialize: () => new Uint8Array([2]), circuit: call.circuitId, first: call.args[0] },
              },
            });
          },
          submitTx: () => Promise.reject(new Error('the unbounded road is not taken by this flow')),
          submitTxAsync: async (
            given: Record<string, unknown>,
            call: { unprovenTx: { circuit: string; first: unknown } },
          ) => {
            submits += 1;
            const prover = given.proofProvider as { proveTx?: (tx: unknown) => Promise<unknown> } | undefined;
            await prover?.proveTx?.(call.unprovenTx);
            if (options.refuse?.circuit === call.unprovenTx.circuit && refused < options.refuse.times) {
              refused += 1;
              throw custodyProofNotBuilt('refused by the drill');
            }
            if (call.unprovenTx.circuit.startsWith('add_device_with_')) {
              members.add(bytesToHex(call.unprovenTx.first as Uint8Array));
            }
            return `tx-${submits}`;
          },
          findDeployedContract: () => Promise.resolve({ callTx }),
        } as never),
      resolveChainHash: () => Promise.resolve(null),
      now: () => 1_800_000_000_000,
      sleep: () => Promise.resolve(undefined),
    },
  };
}

/** The hand-off the name check leaves, for the sign-in that made it. */
function handoffFor(signIn: ReturnType<typeof socialSignIn>): AdoptionHandoff {
  return { network: NETWORK, address: ADDRESS, name: 'alice', socialUser: signIn.session.address.toLowerCase() };
}

function optionsFor(
  storage: CustodyStorage,
  signIn: ReturnType<typeof socialSignIn>,
  run: Chain,
  over: Partial<AdoptDeviceKeyOptions> = {},
): AdoptDeviceKeyOptions {
  return {
    handoff: handoffFor(signIn),
    contractRoot: () => Promise.resolve(new Uint8Array(32).fill(ROOT)),
    credentialId: 'credential-on-the-new-device',
    session: signIn.session,
    socialDevice: signIn.device,
    provider: 'Google',
    storage,
    overrides: run.deps,
    ...over,
  };
}

/* -------------------------------------------------------------------------- */
/* The defect                                                                 */
/* -------------------------------------------------------------------------- */

describe('bringing a Passport to a device that has never held anything', () => {
  it('is what the live run met: the add alone, on an empty device, refuses before it asks', async () => {
    /* The precondition, stated as the client states it. This is the sentence
       the tab logged on 2026/09/26, and the reason nothing reached the prover. */
    const storage = emptyBrowser();
    const signIn = socialSignIn();
    const run = chain({ members: [entryOf('k1', signIn.device.pk)] });
    await expect(
      addDeviceK1(signIn.session, signIn.device, { arm: 'jubjub', pk: await thisDevicesKey() }, undefined, {
        ...run.deps,
        storage: () => storage,
      }),
    ).rejects.toThrow('This Passport is not finished being set up yet.');
    expect(signIn.signed).toHaveLength(0);
  });

  it('reaches the add, with the sign-in approving, from EMPTY storage', async () => {
    const storage = emptyBrowser();
    const signIn = socialSignIn();
    const run = chain({ members: [entryOf('k1', signIn.device.pk)] });

    const result = await adoptDeviceKey(optionsFor(storage, signIn, run));

    const mine = await thisDevicesKey();
    /* STEP 2, signed by the sign-in and naming THIS device's entry. */
    expect(run.calls[0].circuit).toBe('add_device_with_k256');
    expect(bytesToHex(run.calls[0].args[0] as Uint8Array)).toBe(entryOf('jj', mine));
    expect(signIn.signed).toHaveLength(1);
    /* STEP 3, signed by the new key, on the bounded road. */
    expect(run.calls.map((call) => call.circuit)).toEqual(['add_device_with_k256', 'rotate_enc_key_with_jubjub']);
    expect(result).toEqual({ userKey: `jubjub:${mine.x.toString(16)}`, pointedAtNewKey: true });
  });

  it('writes the sign-in’s record in the shape a Passport found by a sign-in always had', async () => {
    const storage = emptyBrowser();
    const signIn = socialSignIn();
    const run = chain({ members: [entryOf('k1', signIn.device.pk)] });

    await adoptDeviceKey(optionsFor(storage, signIn, run));

    const user = signIn.session.address.toLowerCase();
    const record = loadCustodyRecord(storage, user, NETWORK);
    expect(record).toMatchObject({
      user,
      network: NETWORK,
      address: ADDRESS,
      privateStateId: k1PrivateStateId(user),
      saltHex: '',
      pkXHex: signIn.device.pk.x.toString(16),
      pkYHex: signIn.device.pk.y.toString(16),
      activated: true,
    });
    /* And NO name beside it: the sign-in approves the add and does not become
       the Passport's holder in this browser. */
    expect(loadCustodyName(storage, user, NETWORK)).toBeNull();
  });

  it('leaves everything the next open needs: record, name, way back, pointer, key, and the backup question', async () => {
    const storage = emptyBrowser();
    const signIn = socialSignIn();
    const run = chain({ members: [entryOf('k1', signIn.device.pk)] });

    const { userKey } = await adoptDeviceKey(optionsFor(storage, signIn, run));

    expect(loadCustodyRecord(storage, userKey, NETWORK)).toMatchObject({
      user: userKey,
      address: ADDRESS,
      activated: true,
    });
    expect(loadCustodyName(storage, userKey, NETWORK)).toBe('alice');
    expect(loadCustodyPasskeyPointer(storage, 'credential-on-the-new-device', NETWORK)).toBe(userKey);
    /* The way back that brought it here is on, so Home does not offer to add it. */
    expect(loadBackupRecord(storage, userKey, NETWORK)).toMatchObject({ provider: 'Google' });
    expect(typeof loadBackupRecord(storage, userKey, NETWORK)?.doneAt).toBe('number');
    /* The account's deliveries point at this device now, and it holds the key. */
    expect(loadK1CoinStore({ network: NETWORK, address: ADDRESS }).encSecretKeyHex).toMatch(/^[0-9a-f]{64}$/u);
    expect(earlierPaymentsOfferDue(storage, { network: NETWORK, address: ADDRESS })).toBe(true);
  });

  it('writes no provider it was not given', async () => {
    const storage = emptyBrowser();
    const signIn = socialSignIn();
    const run = chain({ members: [entryOf('k1', signIn.device.pk)] });
    const { userKey } = await adoptDeviceKey(optionsFor(storage, signIn, run, { provider: '  ' }));
    expect(loadBackupRecord(storage, userKey, NETWORK)?.provider).toBeUndefined();
    const other = emptyBrowser();
    const again = await adoptDeviceKey(optionsFor(other, signIn, chain({ members: [entryOf('k1', signIn.device.pk)] }), { provider: null }));
    expect(loadBackupRecord(other, again.userKey, NETWORK)?.provider).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Resumable                                                                  */
/* -------------------------------------------------------------------------- */

describe('a second half that is run again', () => {
  it('resumes after a refusal, on the same record, with one approval per attempt', async () => {
    const storage = emptyBrowser();
    const signIn = socialSignIn();
    const run = chain({
      members: [entryOf('k1', signIn.device.pk)],
      refuse: { circuit: 'add_device_with_k256', times: 1 },
    });

    await expect(adoptDeviceKey(optionsFor(storage, signIn, run))).rejects.toThrow(CUSTODY_KEY_NOT_ADDED);
    const user = signIn.session.address.toLowerCase();
    const written = loadCustodyRecord(storage, user, NETWORK);
    expect(written?.address).toBe(ADDRESS);

    const result = await adoptDeviceKey(optionsFor(storage, signIn, run));
    expect(result.pointedAtNewKey).toBe(true);
    expect(run.calls.map((call) => call.circuit)).toEqual([
      'add_device_with_k256',
      'add_device_with_k256',
      'rotate_enc_key_with_jubjub',
    ]);
    expect(signIn.signed).toHaveLength(2);
  });

  it('asks the sign-in for nothing when this device’s key already landed', async () => {
    /* The browser closed after the add and before the records: the account
       holds this device's key, and the second run finds it there. */
    const storage = emptyBrowser();
    const signIn = socialSignIn();
    const run = chain({ members: [entryOf('k1', signIn.device.pk), entryOf('jj', await thisDevicesKey())] });

    await adoptDeviceKey(optionsFor(storage, signIn, run));

    expect(signIn.signed).toHaveLength(0);
    expect(run.calls.map((call) => call.circuit)).toEqual(['rotate_enc_key_with_jubjub']);
  });

  it('uses a finished record this device already holds for the same account, as it is', async () => {
    const storage = emptyBrowser();
    const signIn = socialSignIn();
    const user = signIn.session.address.toLowerCase();
    const held: CustodyAccountRecord = {
      user,
      network: NETWORK,
      address: ADDRESS,
      privateStateId: 'passport-account-custody-held',
      saltHex: '11'.repeat(32),
      pkXHex: 'aa',
      pkYHex: 'bb',
      wavesDone: 3,
      totalWaves: 3,
      activated: true,
      txHashes: ['earlier'],
    };
    saveCustodyRecord(storage, held);
    const run = chain({ members: [entryOf('k1', signIn.device.pk)] });

    await adoptDeviceKey(optionsFor(storage, signIn, run));

    expect(loadCustodyRecord(storage, user, NETWORK)).toMatchObject({
      privateStateId: 'passport-account-custody-held',
      saltHex: '11'.repeat(32),
    });
  });

  it('is not undone by a rotation that fails: the Passport is back all the same', async () => {
    const storage = emptyBrowser();
    const signIn = socialSignIn();
    const run = chain({
      members: [entryOf('k1', signIn.device.pk)],
      refuse: { circuit: 'rotate_enc_key_with_jubjub', times: 1 },
    });

    const result = await adoptDeviceKey(optionsFor(storage, signIn, run));

    expect(result.pointedAtNewKey).toBe(false);
    expect(loadCustodyPasskeyPointer(storage, 'credential-on-the-new-device', NETWORK)).toBe(result.userKey);
    expect(earlierPaymentsOfferDue(storage, { network: NETWORK, address: ADDRESS })).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* The refusals, before anybody is asked for anything                         */
/* -------------------------------------------------------------------------- */

describe('a second half that must not run', () => {
  it('refuses a sign-in other than the one that found the Passport, before the passkey is asked', async () => {
    const storage = emptyBrowser();
    const signIn = socialSignIn();
    const run = chain({ members: [entryOf('k1', signIn.device.pk)] });
    const contractRoot = vi.fn(() => Promise.resolve(new Uint8Array(32).fill(ROOT)));

    await expect(
      adoptDeviceKey(
        optionsFor(storage, signIn, run, {
          handoff: { ...handoffFor(signIn), socialUser: '0x1111111111111111111111111111111111111111' },
          contractRoot,
        }),
      ),
    ).rejects.toThrow(ADOPTION_OTHER_SIGN_IN);
    expect(contractRoot).not.toHaveBeenCalled();
    expect(run.calls).toHaveLength(0);
    expect(storage.data.size).toBe(0);
  });

  it('never writes over a different Passport this sign-in opens here', async () => {
    const storage = emptyBrowser();
    const signIn = socialSignIn();
    const user = signIn.session.address.toLowerCase();
    const other: CustodyAccountRecord = {
      user,
      network: NETWORK,
      address: 'cd'.repeat(32),
      privateStateId: k1PrivateStateId(user),
      saltHex: '',
      pkXHex: '1',
      pkYHex: '2',
      wavesDone: 3,
      totalWaves: 3,
      activated: true,
      txHashes: [],
    };
    saveCustodyRecord(storage, other);
    const run = chain({ members: [entryOf('k1', signIn.device.pk)] });
    const contractRoot = vi.fn(() => Promise.resolve(new Uint8Array(32).fill(ROOT)));

    await expect(adoptDeviceKey(optionsFor(storage, signIn, run, { contractRoot }))).rejects.toThrow(
      ADOPTION_OTHER_PASSPORT,
    );
    expect(loadCustodyRecord(storage, user, NETWORK)).toEqual(other);
    expect(contractRoot).not.toHaveBeenCalled();
    expect(run.calls).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* As the host runs it: bounded, and ending in a sentence                     */
/* -------------------------------------------------------------------------- */

describe('the second half as the host runs it', () => {
  function hostOptions(storage: CustodyStorage, signIn: ReturnType<typeof socialSignIn>, run: Chain) {
    const { socialDevice: _device, ...rest } = optionsFor(storage, signIn, run);
    return { ...rest, socialDevice: () => Promise.resolve(signIn.device) };
  }

  it('says the Passport is back', async () => {
    const storage = emptyBrowser();
    const signIn = socialSignIn();
    const outcome = await bringPassportHere(
      hostOptions(storage, signIn, chain({ members: [entryOf('k1', signIn.device.pk)] })),
    );
    expect(outcome.kind).toBe('back');
  });

  it('turns a refused add into the one sentence, with its cause kept for the console', async () => {
    const storage = emptyBrowser();
    const signIn = socialSignIn();
    const run = chain({
      members: [entryOf('k1', signIn.device.pk)],
      refuse: { circuit: 'add_device_with_k256', times: 1 },
    });
    const outcome = await bringPassportHere(hostOptions(storage, signIn, run));
    expect(outcome).toMatchObject({ kind: 'failed', sentence: ADOPTION_NOT_ADDED });
    expect(outcome.kind === 'failed' ? (outcome.cause as Error).message : '').toBe(CUSTODY_KEY_NOT_ADDED);
  });

  it('says so when the passkey was not confirmed', async () => {
    const storage = emptyBrowser();
    const signIn = socialSignIn();
    const declined = Object.assign(new Error('The operation either timed out or was not allowed.'), {
      name: 'NotAllowedError',
    });
    const outcome = await bringPassportHere({
      ...hostOptions(storage, signIn, chain({ members: [entryOf('k1', signIn.device.pk)] })),
      contractRoot: () => Promise.reject(declined),
    });
    expect(outcome).toMatchObject({ kind: 'failed', sentence: ADOPTION_PASSKEY_DECLINED });
  });

  it('says so when a different account is signed in', async () => {
    const storage = emptyBrowser();
    const signIn = socialSignIn();
    const outcome = await bringPassportHere({
      ...hostOptions(storage, signIn, chain({ members: [entryOf('k1', signIn.device.pk)] })),
      handoff: { ...handoffFor(signIn), socialUser: '0x2222222222222222222222222222222222222222' },
    });
    expect(outcome).toMatchObject({ kind: 'failed', sentence: ADOPTION_OTHER_SIGN_IN });
  });

  it('is answered within the bound when a step never answers, and says the outcome is unknown', async () => {
    /* The sign-in's key never comes: the bound is what ends the wait. */
    const storage = emptyBrowser();
    const signIn = socialSignIn();
    const outcome = await bringPassportHere({
      ...hostOptions(storage, signIn, chain({ members: [entryOf('k1', signIn.device.pk)] })),
      socialDevice: () => new Promise<K256DeviceIdentity>(() => undefined),
      waitMs: 20,
    });
    expect(outcome).toMatchObject({ kind: 'failed', sentence: ADOPTION_UNCONFIRMED });
    expect(outcome.kind === 'failed' ? (outcome.cause as Error).message : '').toMatch(/did not finish in 0 s/);
  });
});
