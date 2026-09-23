/**
 * NIGHT OUT OF A PASSPORT, TO AN ADDRESS — `withdraw_unshielded_with_<arm>`.
 *
 * What these drills hold: the circuit named is the signing arm's own; the
 * arguments are the circuit's declared `(color, amount, recipient)` — the
 * reverse of the shielded spends' order, which yields a proof that verifies
 * nowhere if it is got wrong; the recipient travels as a `UserAddress`
 * `{ bytes }`; the signature is over the same three values; and every refusal
 * happens before anybody is asked to approve anything.
 *
 * The harness is `./custodyContractClient.addDevice.test.ts`'s: the module
 * under test, the use-counter scan, the challenge builders, and a genuine
 * secp256k1 signature are real; the chain is injected through `CustodyDeps`.
 */

import { describe, expect, it, vi } from 'vitest';
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
  withdrawUnshieldedK1,
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
  /** What the chain says about the submitted payment: landed, refused, or never. */
  chain?: 'landed' | 'refused' | 'never';
  /** The account's `auth_nonce` on the read after the wait ran out. */
  nonceAfter?: bigint | 'unreadable';
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

  let stateReads = 0;
  const chain = options.chain ?? 'landed';
  const providers: Record<string, unknown> = {
    publicDataProvider: {
      queryContractState: () => {
        stateReads += 1;
        /* The first read is the call's own; the one after a wait that ran out
           is the account being asked whether the payment ran. */
        if (stateReads > 1 && options.nonceAfter === 'unreadable') {
          return Promise.reject(new Error('indexer down'));
        }
        return Promise.resolve({ data: stateReads > 1 ? 'after' : 'state', serialize: () => new Uint8Array([1]) });
      },
      watchForTxData: (txId: string) =>
        chain === 'never'
          ? new Promise(() => undefined)
          : Promise.resolve({
              txId,
              txHash: 'ab'.repeat(32),
              status: chain === 'landed' ? 'SucceedEntirely' : 'FailEntirely',
            }),
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
          ledger: (data: unknown) => ({
            auth_nonce:
              data === 'after' && typeof options.nonceAfter === 'bigint' ? options.nonceAfter : 11n,
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
          createUnprovenCallTx: (_providers: unknown, call: { circuitId: string; args: unknown[] }) => {
            calls.push({ circuit: call.circuitId, args: call.args });
            return Promise.resolve({ private: { unprovenTx: 'unproven', result: [] } });
          },
          submitTx: () => Promise.resolve({ txId: 'tx-1', status: 'SucceedEntirely' }),
          submitTxAsync: () => Promise.resolve('tx-1'),
          findDeployedContract: () => Promise.resolve({ callTx }),
        } as never),
      resolveChainHash: () => Promise.resolve(null),
      submitWaitMs: 5,
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


const NIGHT = '00'.repeat(32);
const RECIPIENT = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

describe('withdrawUnshieldedK1', () => {
  it('proves the passkey arm’s own circuit with (colour, amount, recipient)', async () => {
    const pure = pureFake();
    const signer = jubjubFake();
    const run = harness({ user: 'jubjub:1092', members: [entryFor(pure, 'jj', signer.pk, 0n)] });
    const phases: string[] = [];

    const result = await withdrawUnshieldedK1(
      null,
      signer,
      { recipient: RECIPIENT, colourHex: NIGHT, amount: 1_500_000n },
      (phase) => phases.push(phase.step),
      run.deps,
    );

    const call = run.calls.at(-1);
    expect(call?.circuit).toBe('withdraw_unshielded_with_jubjub');
    expect(bytesToHex(call?.args[0] as Uint8Array)).toBe(NIGHT);
    /* A PARTIAL amount is simply a smaller debit of the mirror. */
    expect(call?.args[1]).toBe(1_500_000n);
    expect(call?.args[2]).toEqual({ bytes: RECIPIENT });
    /* The authorisation trailer follows: pk, counter, sig_r, sig_s, grind. */
    expect(call?.args).toHaveLength(8);
    expect(call?.args[4]).toBe(0n);
    expect(phases).toEqual(['sign', 'submit', 'confirm']);
    expect(result.record.address).toBe(ADDRESS);
    /* The chain's own hash, for the trail row's View link. */
    expect(result.txHash).toBe('ab'.repeat(32));
  });

  it('asks a sign-in to sign the unshielded challenge, and proves the k256 circuit', async () => {
    const pure = pureFake();
    const k1 = k256Fake();
    const run = harness({
      user: '0xabcdef0000000000000000000000000000000002',
      members: [entryFor(pure, 'k1', k1.device.pk, 0n)],
    });

    await withdrawUnshieldedK1(
      k1.session,
      k1.device,
      { recipient: RECIPIENT, colourHex: NIGHT, amount: 7n },
      undefined,
      run.deps,
    );

    const call = run.calls.at(-1);
    expect(call?.circuit).toBe('withdraw_unshielded_with_k256');
    expect(call?.args.slice(0, 3)).toEqual([new Uint8Array(32), 7n, { bytes: RECIPIENT }]);
    /* Exactly one approval, and it was over this circuit's challenge. */
    expect(k1.signed).toHaveLength(1);
  });

  it('refuses a malformed request before anything is asked of anybody', async () => {
    const pure = pureFake();
    const k1 = k256Fake();
    const run = harness({
      user: '0xabcdef0000000000000000000000000000000002',
      members: [entryFor(pure, 'k1', k1.device.pk, 0n)],
    });
    const ask = (request: { recipient: Uint8Array; colourHex: string; amount: bigint }) =>
      withdrawUnshieldedK1(k1.session, k1.device, request, undefined, run.deps);

    await expect(ask({ recipient: new Uint8Array(31), colourHex: NIGHT, amount: 1n })).rejects.toThrow(
      'That is not an address this Passport can pay.',
    );
    await expect(ask({ recipient: RECIPIENT, colourHex: NIGHT, amount: 0n })).rejects.toThrow(
      'Enter an amount greater than zero.',
    );
    await expect(ask({ recipient: RECIPIENT, colourHex: 'nope', amount: 1n })).rejects.toThrow(
      'That is not something this Passport can send.',
    );
    expect(run.calls).toHaveLength(0);
    expect(k1.signed).toHaveLength(0);
  });

  it('refuses a Passport that is not finished being set up', async () => {
    const signer = jubjubFake();
    const run = harness({ user: 'jubjub:1092', members: [], unfinished: true });
    await expect(
      withdrawUnshieldedK1(
        null,
        signer,
        { recipient: RECIPIENT, colourHex: NIGHT, amount: 1n },
        undefined,
        run.deps,
      ),
    ).rejects.toThrow('This Passport is not finished being set up yet.');
    expect(run.calls).toHaveLength(0);
  });
});

describe('a NIGHT payment the chain does not record', () => {
  const pay = (run: Harness, signer: CustodyCallDevice) =>
    withdrawUnshieldedK1(
      null,
      signer,
      { recipient: RECIPIENT, colourHex: NIGHT, amount: 1n },
      undefined,
      run.deps,
    );

  it('is settled as not sent once the wait runs out and the account has not moved', async () => {
    const pure = pureFake();
    const signer = jubjubFake();
    const run = harness({
      user: 'jubjub:1092',
      members: [entryFor(pure, 'jj', signer.pk, 0n)],
      chain: 'never',
      nonceAfter: 11n,
    });
    await expect(pay(run, signer)).rejects.toThrow(
      "That payment didn't go through. Nothing left your Passport.",
    );
  });

  it('stays hedged when the account moved, or could not be read', async () => {
    const pure = pureFake();
    const signer = jubjubFake();
    const members = [entryFor(pure, 'jj', signer.pk, 0n)];
    await expect(
      pay(harness({ user: 'jubjub:1092', members, chain: 'never', nonceAfter: 12n }), signer),
    ).rejects.toThrow('could not confirm it');
    await expect(
      pay(harness({ user: 'jubjub:1092', members, chain: 'never', nonceAfter: 'unreadable' }), signer),
    ).rejects.toThrow('could not confirm it');
  });

  it('says plainly when the chain refused it', async () => {
    const pure = pureFake();
    const signer = jubjubFake();
    const run = harness({
      user: 'jubjub:1092',
      members: [entryFor(pure, 'jj', signer.pk, 0n)],
      chain: 'refused',
    });
    await expect(pay(run, signer)).rejects.toThrow('That payment did not go through');
  });
});

describe('a NIGHT payment the node refuses (2026/09/22)', () => {
  function refusal(code: string): Error {
    const rpc = Object.assign(new Error('1010: Invalid Transaction'), { data: `Custom error: ${code}` });
    return Object.assign(new Error('Transaction submission error'), { cause: { _tag: 'SubmissionError', cause: rpc } });
  }

  function run(submits: (() => Promise<string>)[]) {
    const pure = pureFake();
    const signer = jubjubFake();
    const test = harness({ user: 'jubjub:1092', members: [entryFor(pure, 'jj', signer.pk, 0n)] });
    let submitted = 0;
    const contracts = test.deps.contracts as unknown as () => Promise<Record<string, unknown>>;
    test.deps.contracts = async () => ({
      ...(await contracts()),
      submitTxAsync: () => {
        const next = submits[Math.min(submitted, submits.length - 1)];
        submitted += 1;
        return next();
      },
    }) as never;
    const pay = () =>
      withdrawUnshieldedK1(null, signer, { recipient: RECIPIENT, colourHex: NIGHT, amount: 1n }, undefined, test.deps);
    return { pay, submitted: () => submitted };
  }

  it('is built again when the account moved under it, and lands', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const drill = run([() => Promise.reject(refusal('104')), () => Promise.resolve('tx-2')]);
    await expect(drill.pay()).resolves.toEqual(expect.objectContaining({ txHash: 'ab'.repeat(32) }));
    expect(drill.submitted()).toBe(2);
    info.mockRestore();
  });

  it('is built again when its fee coin was spent by another transaction (196), and lands', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const drill = run([() => Promise.reject(refusal('196')), () => Promise.resolve('tx-2')]);
    await expect(drill.pay()).resolves.toEqual(expect.objectContaining({ txHash: 'ab'.repeat(32) }));
    expect(drill.submitted()).toBe(2);
    info.mockRestore();
  });

  it('is not built again for a refusal that is a verdict (239)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const refused = run([() => Promise.reject(refusal('239'))]);
    await expect(refused.pay()).rejects.toThrow("That payment didn't go through. Nothing left your Passport.");
    expect(refused.submitted()).toBe(1);
    warn.mockRestore();
  });

  it('says it did not go through when the account keeps moving, or for any other refusal', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const moving = run([() => Promise.reject(refusal('104'))]);
    await expect(moving.pay()).rejects.toThrow("That payment didn't go through. Nothing left your Passport.");
    expect(moving.submitted()).toBe(3);
    const refused = run([() => Promise.reject(refusal('231'))]);
    await expect(refused.pay()).rejects.toThrow("That payment didn't go through. Nothing left your Passport.");
    expect(refused.submitted()).toBe(1);
    const socket = run([() => Promise.reject(new Error('WebSocket is not connected'))]);
    await expect(socket.pay()).rejects.toThrow('WebSocket is not connected');
    info.mockRestore();
    warn.mockRestore();
  });

  it('is answered within the bound when the account cannot be read before it is sent', async () => {
    const pure = pureFake();
    const signer = jubjubFake();
    const test = harness({ user: 'jubjub:1092', members: [entryFor(pure, 'jj', signer.pk, 0n)] });
    test.deps.prepareWaitMs = 5;
    test.deps.contractModule = () => new Promise(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(
      withdrawUnshieldedK1(null, signer, { recipient: RECIPIENT, colourHex: NIGHT, amount: 1n }, undefined, test.deps),
    ).rejects.toThrow("That payment didn't go through. Nothing left your Passport.");
    warn.mockRestore();
  });
});
