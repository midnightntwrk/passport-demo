/**
 * A SECOND KEY ON THE SAME PASSPORT, drilled through the injected seams.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * `add_device` is the whole of the spare-key decision of 2026/09/21, and it is
 * the one call on this contract where the two arms meet in a single
 * transaction: a device key signs to enrol a sign-in (the backup), and a
 * sign-in signs to enrol a device key (the way back in on a new phone). The
 * contract sees 32 opaque bytes and cannot tell us we got it wrong — an entry
 * derived for the wrong curve, at a stale epoch, or at a counter other than
 * zero is accepted, stored, counted, and useless. So the argument is what these
 * drills are about, and the failure they exist to catch is one nobody would see
 * until the day the spare key was needed.
 *
 * The second thing they hold is that a device ALREADY on the account costs
 * nothing: no approval, no transaction. The recovery flow is resumable by
 * design, so this function is run again by any browser that was closed halfway
 * through one.
 *
 * WHAT IS REAL HERE. The module under test, its use-counter scan, the challenge
 * builders, and a genuine secp256k1 signature. What is injected is the chain:
 * `CustodyDeps` supplies the wallet, the compiled module, the providers, and
 * midnight-js, exactly as `./custodyContractClient.spend.test.ts` supplies them.
 */

import { describe, expect, it } from 'vitest';
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
import { jubjubDeviceSigner } from './custodyJubjubSigner.js';
import {
  saveCustodyRecord,
  type CustodyAccountRecord,
  type CustodyStorage,
} from './custodyContractPlan.js';
import {
  addDeviceK1,
  type CustodyCallDevice,
  type CustodyDeps,
  type CustodyDynamicSession,
} from './custodyContractClient.js';

const ADDRESS = 'ab'.repeat(32);
const EPOCH = 7n;

function storageFake(): CustodyStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

/**
 * Deterministic stand-ins for the compiled build's pure circuits.
 *
 * The same shape as the one in `./custodyContractClient.spend.test.ts`, and
 * spelled out again rather than shared for the reason that file gives: a fake
 * that drifted toward whatever the test needed would stop being a statement
 * about the generated ABI, which is the only thing it is for.
 */
function pureFake(): CustodyPureCircuits {
  const tag = (name: string, ...parts: unknown[]): Uint8Array => {
    const text = `${name}:${parts.map((part) => String(part)).join('|')}`;
    const out = new Uint8Array(32);
    for (let index = 0; index < text.length; index += 1) out[index % 32] ^= text.charCodeAt(index);
    out[0] = name.length;
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

/** A real secp256k1 key standing in for the one behind a social sign-in. */
function k256Fake(): {
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

/** The passkey's device: a real signer over the fake's own JubJub arithmetic. */
function jubjubFake(scalar = 4242n): CustodyCallDevice {
  const signer = jubjubDeviceSigner({
    pure: pureFake(),
    secretScalar: scalar,
    randomBytes: (length) => new Uint8Array(length).fill(9),
  });
  return {
    arm: 'jubjub',
    pk: signer.pk,
    sign: signer.sign.bind(signer),
    encSecretKeyHex: 'cd'.repeat(32),
  };
}

interface Harness {
  deps: Partial<CustodyDeps>;
  storage: CustodyStorage & { data: Map<string, string> };
  calls: { circuit: string; args: unknown[] }[];
  /** Every device entry the ledger was asked about, as hex. */
  asked: string[];
}

function harness(options: {
  user: string;
  /** The entries the account's device set holds, as hex. */
  members: readonly string[];
  /** A record that is not finished, for the refusal drill. */
  unfinished?: boolean;
}): Harness {
  const storage = storageFake();
  const record: CustodyAccountRecord = {
    user: options.user,
    network: 'stagenet',
    address: ADDRESS,
    privateStateId: 'passport-account-custody-test',
    saltHex: '11'.repeat(32),
    pkXHex: '22'.repeat(32),
    pkYHex: '33'.repeat(32),
    wavesDone: options.unfinished === true ? 1 : 3,
    totalWaves: 3,
    activated: options.unfinished !== true,
    txHashes: [],
  };
  saveCustodyRecord(storage, record);

  const calls: { circuit: string; args: unknown[] }[] = [];
  const asked: string[] = [];
  const members = new Set(options.members);

  /* The connection's own call surface, as midnight-js hands it over: one
     member per circuit. A Proxy rather than a literal, so a call to a circuit
     nobody expected is recorded rather than read as "this Passport cannot do
     that yet". */
  const callTx = new Proxy(
    {},
    {
      get:
        (_target, circuit: string) =>
        (...args: unknown[]) => {
          calls.push({ circuit, args });
          return Promise.resolve({ public: { txId: 'tx-1' }, private: { result: null } });
        },
    },
  );

  const providers: Record<string, unknown> = {
    publicDataProvider: {
      queryContractState: () =>
        Promise.resolve({ data: 'state', serialize: () => new Uint8Array([1]) }),
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

  return {
    storage,
    calls,
    asked,
    deps: {
      storage: () => storage,
      randomBytes: (length) => new Uint8Array(length).fill(7),
      wallet: () =>
        Promise.resolve({
          network: { networkId: 'stagenet', indexerHttpUrl: '' },
        } as never),
      contractModule: () =>
        Promise.resolve({
          pureCircuits: pureFake(),
          Contract: class {},
          ledger: () => ({
            auth_nonce: 11n,
            device_epoch: EPOCH,
            device_count: 1n,
            booted: true,
            devices: {
              member: (entry: Uint8Array) => {
                const hex = bytesToHex(entry);
                asked.push(hex);
                return members.has(hex);
              },
            },
          }),
        }),
      providers: () => Promise.resolve(providers),
      contracts: () =>
        Promise.resolve({
          createUnprovenDeployTx: () => Promise.reject(new Error('not used here')),
          createUnprovenCallTx: () => Promise.reject(new Error('not used here')),
          submitTx: () => Promise.resolve({ txId: 'tx-1', status: 'SucceedEntirely' }),
          submitTxAsync: () => Promise.resolve('tx-1'),
          findDeployedContract: () => Promise.resolve({ callTx }),
        } as never),
      resolveChainHash: () => Promise.resolve(null),
      now: () => 1_800_000_000_000,
      sleep: () => Promise.resolve(undefined),
    },
  };
}

/**
 * What the fake's own derivation says one device's entry is, against the
 * account this harness uses — so a drill asserts on the argument the call made
 * rather than on a copy of the code that made it.
 */
function entryFor(
  pure: CustodyPureCircuits,
  kind: 'jj' | 'k1',
  pk: CurvePoint,
  counter: bigint,
  epoch: bigint = EPOCH,
): string {
  const self = {
    bytes: Uint8Array.from((ADDRESS.match(/.{2}/g) ?? []).map((byte) => parseInt(byte, 16))),
  };
  return bytesToHex(
    kind === 'jj'
      ? pure.derive_device_entry_with_jubjub(self, pk, epoch, counter)
      : pure.derive_device_entry_with_k256(self, pk, K256_ENVELOPE_NONE, epoch, counter),
  );
}

/* -------------------------------------------------------------------------- */
/* The backup: a device key enrols a sign-in                                  */
/* -------------------------------------------------------------------------- */

describe('backing a Passport up with a sign-in', () => {
  it('proves the device key’s own circuit, and hands it the sign-in’s entry', async () => {
    const pure = pureFake();
    const signer = jubjubFake();
    const spare = k256Fake();
    const mine = entryFor(pure, 'jj', signer.pk, 0n);
    const run = harness({ user: 'jubjub:1092', members: [mine] });

    await addDeviceK1(null, signer, spare.device, undefined, run.deps);

    const call = run.calls.at(-1);
    /* The SIGNING arm names the circuit. The new device signs nothing. */
    expect(call?.circuit).toBe('add_device_with_jubjub');
    /* And the first argument is the new device's own entry, on ITS curve. */
    expect(bytesToHex(call?.args[0] as Uint8Array)).toBe(entryFor(pure, 'k1', spare.device.pk, 0n));
  });

  it('binds the entry to the account’s CURRENT epoch, never to zero', async () => {
    /* An entry at a stale epoch is accepted, stored, and counted, and opens
       nothing. The contract cannot tell us; this drill can. */
    const pure = pureFake();
    const signer = jubjubFake();
    const spare = k256Fake();
    const run = harness({ user: 'jubjub:1092', members: [entryFor(pure, 'jj', signer.pk, 0n)] });

    await addDeviceK1(null, signer, spare.device, undefined, run.deps);

    const entry = bytesToHex(run.calls.at(-1)?.args[0] as Uint8Array);
    expect(entry).toBe(entryFor(pure, 'k1', spare.device.pk, 0n, EPOCH));
    expect(entry).not.toBe(entryFor(pure, 'k1', spare.device.pk, 0n, 0n));
  });

  it('enrols at use counter zero, which is the one value the contract cannot check', async () => {
    const pure = pureFake();
    const signer = jubjubFake();
    const spare = k256Fake();
    const run = harness({ user: 'jubjub:1092', members: [entryFor(pure, 'jj', signer.pk, 0n)] });

    await addDeviceK1(null, signer, spare.device, undefined, run.deps);

    const entry = bytesToHex(run.calls.at(-1)?.args[0] as Uint8Array);
    expect(entry).not.toBe(entryFor(pure, 'k1', spare.device.pk, 1n));
  });
});

/* -------------------------------------------------------------------------- */
/* The way back: a sign-in enrols a device key                                */
/* -------------------------------------------------------------------------- */

describe('bringing a Passport to a new device', () => {
  it('proves the sign-in’s circuit, and hands it the new device key’s entry', async () => {
    const pure = pureFake();
    const social = k256Fake();
    const fresh = jubjubFake(31337n);
    const run = harness({
      user: social.session.address.toLowerCase(),
      members: [entryFor(pure, 'k1', social.device.pk, 0n)],
    });

    await addDeviceK1(social.session, social.device, { arm: 'jubjub', pk: fresh.pk }, undefined, run.deps);

    const call = run.calls.at(-1);
    expect(call?.circuit).toBe('add_device_with_k256');
    expect(bytesToHex(call?.args[0] as Uint8Array)).toBe(entryFor(pure, 'jj', fresh.pk, 0n));
  });

  it('asks the sign-in for exactly one signature', async () => {
    /* One approval per action is the rule this whole layer keeps. A second
       round trip here would be a second overlay in front of somebody who is
       already halfway through getting their Passport back. */
    const pure = pureFake();
    const social = k256Fake();
    const fresh = jubjubFake(31337n);
    const run = harness({
      user: social.session.address.toLowerCase(),
      members: [entryFor(pure, 'k1', social.device.pk, 0n)],
    });

    await addDeviceK1(social.session, social.device, { arm: 'jubjub', pk: fresh.pk }, undefined, run.deps);

    expect(social.signed).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* A key that is already there                                                */
/* -------------------------------------------------------------------------- */

describe('a device already on the account', () => {
  it('costs no transaction and no approval', async () => {
    /* The recovery flow is resumable, so this runs again on any browser that
       was closed halfway through one. */
    const pure = pureFake();
    const social = k256Fake();
    const fresh = jubjubFake(31337n);
    const run = harness({
      user: social.session.address.toLowerCase(),
      members: [entryFor(pure, 'k1', social.device.pk, 0n), entryFor(pure, 'jj', fresh.pk, 0n)],
    });

    const result = await addDeviceK1(
      social.session,
      social.device,
      { arm: 'jubjub', pk: fresh.pk },
      undefined,
      run.deps,
    );

    expect(run.calls).toHaveLength(0);
    expect(social.signed).toHaveLength(0);
    expect(result.txHash).toBeNull();
  });

  it('is recognised even once it has approved something and its entry has rolled', async () => {
    /* A device's entry moves forward every time it approves: the entry is
       consumed and the next one inserted. Asking only about counter zero would
       fail to recognise every device that has ever been used. */
    const pure = pureFake();
    const signer = jubjubFake();
    const spare = k256Fake();
    const run = harness({
      user: 'jubjub:1092',
      members: [entryFor(pure, 'jj', signer.pk, 0n), entryFor(pure, 'k1', spare.device.pk, 3n)],
    });

    await addDeviceK1(null, signer, spare.device, undefined, run.deps);

    expect(run.calls).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* The refusals                                                               */
/* -------------------------------------------------------------------------- */

describe('a Passport that is not ready', () => {
  it('is refused in one sentence, before anybody is asked to approve anything', async () => {
    const signer = jubjubFake();
    const spare = k256Fake();
    const run = harness({ user: 'jubjub:1092', members: [], unfinished: true });

    await expect(addDeviceK1(null, signer, spare.device, undefined, run.deps)).rejects.toThrow(
      /not finished being set up/,
    );
    expect(run.calls).toHaveLength(0);
  });
});
