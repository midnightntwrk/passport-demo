/**
 * THE ORDER OF THE WRITES AROUND A SHIELDED SPEND, drilled through the
 * injected seams.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * A withdrawal's change coin is described by ONE value in the world: the
 * circuit's own return. It is not on the chain, not in an inbox entry, not in
 * the transaction. So the only thing standing between a Passport and an
 * unspendable balance is that the description reaches storage BEFORE anything
 * slow happens — and the two slow things after the call resolves are both
 * questions to an indexer: the chain's hash for the transaction, and the
 * commitment window the change landed in. This file hangs each of them in turn
 * and reads the browser's storage while they hang, which is exactly what a
 * closed tab would have left behind.
 *
 * It also holds the witness, which is the read on the other side of the same
 * coin: `held_coin` is what the proof is built from, and a witness that
 * answered a coin the store no longer holds would spend something that is gone.
 *
 * WHY A SECOND FILE. `./custodyContractClient.test.ts` drills the setup, the
 * signature, and the argument order, through a harness that deploys an account
 * wave by wave. Nothing here needs a deploy: the record is seeded as a
 * finished one, which is the state every spend runs in, and the harness is
 * therefore small enough to see the ordering in.
 *
 * The seam that is MOCKED rather than injected is `./contractRuntime.js`'s
 * `resolveTransactionHash` — the indexer walk that turns midnight-js's
 * identifier into the chain's hash. It is not a seam the module takes as a
 * dependency and it is not the unit under test; everything else here is the
 * real module driven through `CustodyDeps`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';

import {
  bytesToHex,
  K256_ENVELOPE_NONE,
  pointFromUncompressed,
  scalarToBytesBE,
  type CustodyPureCircuits,
  type K256DeviceIdentity,
} from './custodyContractSigning.js';
import {
  CUSTODY_PROVER_UNAVAILABLE,
  hexToBytes,
  saveCustodyRecord,
  type CustodyAccountRecord,
  type CustodyStorage,
} from './custodyContractPlan.js';
import {
  awaitingK1Coins,
  enqueueK1Coin,
  heldK1Coin,
  isK1NonceSpent,
  k1CoinCandidates,
  loadK1CoinStore,
  putK1Coin,
  putK1CoinCandidates,
  rememberK1ChangeCoin,
  type K1Account,
} from './k1CoinStore.js';
import { openCustodyInboxEntry, generateCustodyEncKeyPair } from './custodyInbox.js';
import {
  custodyPermissionlessCallAt,
  custodyWitnesses,
  depositShieldedIntoCustody,
  resetCustodySessionState,
  withdrawShieldedK1,
  type CustodyDeps,
  type CustodyDynamicSession,
} from './custodyContractClient.js';

/** The indexer walk that names the chain's hash. Controlled per test. */
let resolveHashWith: (indexer: string, identifier: string) => Promise<string> = (
  _indexer,
  identifier,
) => Promise.resolve(`hash-of-${identifier}`);

vi.mock('./contractRuntime.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./contractRuntime.js')>()),
  resolveTransactionHash: (indexer: string, identifier: string) =>
    resolveHashWith(indexer, identifier),
}));

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const ADDRESS = 'ab'.repeat(32);
const PEER = 'dd'.repeat(32);
const COLOUR = '1a'.repeat(32);
const OTHER_COLOUR = '2b'.repeat(32);
const NONCE = '7f'.repeat(32);
const CHANGE_NONCE = 'a1'.repeat(32);
const ACCOUNT: K1Account = { network: 'stagenet', address: ADDRESS };

function storageFake(): CustodyStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

/** Deterministic stand-ins for the compiled build's pure circuits. */
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
    challenge_withdraw_shielded_with_k256: (self, pk, recipient, color, amount, coin, nonce) =>
      tag(
        'ch-ws',
        bytesToHex(self.bytes),
        pk.x,
        bytesToHex(recipient.bytes),
        color,
        amount,
        /* THE COIN IS IN THE CHALLENGE, and its position with it — which is
           what makes "was the challenge rebuilt for the next candidate" a
           question this fake can answer. */
        coin.value,
        coin.mt_index,
        nonce,
      ),
    challenge_withdraw_unshielded_with_k256: (self, pk, color, amount, recipient, nonce) =>
      tag('ch-wu', bytesToHex(self.bytes), pk.x, color, amount, bytesToHex(recipient.bytes), nonce),
    challenge_append_inbox_with_k256: (self, pk, entry, nonce) =>
      tag('ch-ai', bytesToHex(self.bytes), pk.x, entry.length, nonce),
    challenge_add_device_with_k256: (self, pk, entry, nonce) =>
      tag('ch-ad', bytesToHex(self.bytes), pk.x, bytesToHex(entry), nonce),
  };
}

/** A real secp256k1 key standing in for the embedded one behind the sign-in. */
function deviceFake(): {
  session: CustodyDynamicSession;
  device: K256DeviceIdentity;
  signed: Uint8Array[];
} {
  const secret = scalarToBytesBE(12345678901234567890n);
  const point = pointFromUncompressed(secp256k1.getPublicKey(secret, false));
  const signed: Uint8Array[] = [];
  return {
    session: {
      address: '0xAbCdEf0000000000000000000000000000000001',
      signRaw: ({ message }) => {
        const digest = hexToBytes(message);
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

interface ChainFake {
  /** What a call returns as the circuit's own result. */
  circuitResult?: unknown;
  /** How many spends fail the way a wrong position fails, before one lands. */
  positionFailures?: number;
  /** A failure a different position could not fix. */
  otherFailure?: string;
}

interface SpendHarness {
  deps: Partial<CustodyDeps>;
  storage: CustodyStorage & { data: Map<string, string> };
  calls: { circuit: string; args: unknown[] }[];
  connections: { privateStateId: string; account: unknown }[];
  opened: string[];
  /** Every commitment-window question asked, by transaction. */
  windowQuestions: string[];
  chain: ChainFake;
}

function harness(
  chain: ChainFake = {},
  options: {
    /** Answers the position question. A promise that never settles hangs it. */
    window?: (txId: string) => Promise<{ startIndex: number; endIndex: number } | null>;
  } = {},
): SpendHarness {
  const storage = storageFake();
  const record: CustodyAccountRecord = {
    user: '0xabcdef0000000000000000000000000000000001',
    network: 'stagenet',
    address: ADDRESS,
    privateStateId: 'passport-account-custody-0xabcdef',
    saltHex: '11'.repeat(32),
    pkXHex: '22'.repeat(32),
    pkYHex: '33'.repeat(32),
    wavesDone: 3,
    totalWaves: 3,
    activated: true,
    txHashes: [],
  };
  saveCustodyRecord(storage, record);

  const calls: { circuit: string; args: unknown[] }[] = [];
  const connections: { privateStateId: string; account: unknown }[] = [];
  const opened: string[] = [];
  const windowQuestions: string[] = [];
  let submitted = 0;

  const callTx = new Proxy(
    {},
    {
      get:
        (_target, circuit: string) =>
        (...args: unknown[]) => {
          calls.push({ circuit, args });
          if (circuit.startsWith('withdraw_shielded')) {
            if ((chain.positionFailures ?? 0) > 0) {
              chain.positionFailures = (chain.positionFailures ?? 0) - 1;
              return Promise.reject(new Error('could not build the merkle path for this coin'));
            }
            if (chain.otherFailure !== undefined) {
              return Promise.reject(new Error(chain.otherFailure));
            }
          }
          submitted += 1;
          return Promise.resolve({
            public: { txId: `id-${submitted}` },
            private: { result: chain.circuitResult, nextPrivateState: { coins: {} } },
          });
        },
    },
  );

  const providers: Record<string, unknown> = {
    publicDataProvider: {
      queryContractState: () =>
        Promise.resolve({ data: 'state', serialize: () => new Uint8Array([1]) }),
    },
    privateStateProvider: {
      setContractAddress: () => undefined,
      setSigningKey: () => Promise.resolve(undefined),
      getSigningKey: () => Promise.resolve('the-signing-key'),
      set: () => Promise.resolve(undefined),
    },
    compiledContract: { label: 'passport-account-custody' },
    /* NON-EMPTY, so the hash is actually resolved rather than short-circuited
       — the question this file hangs on purpose. */
    indexerHttpUrl: 'https://indexer.example/api/v4/graphql',
  };

  return {
    storage,
    calls,
    connections,
    opened,
    windowQuestions,
    chain,
    deps: {
      storage: () => storage,
      randomBytes: (length) => new Uint8Array(length).fill(7),
      wallet: () =>
        Promise.resolve({
          network: {
            networkId: 'stagenet',
            indexerHttpUrl: 'https://indexer.example/api/v4/graphql',
          },
        } as never),
      contractModule: () =>
        Promise.resolve({
          pureCircuits: pureFake(),
          Contract: class {},
          ledger: () => ({
            auth_nonce: 3n,
            device_epoch: 0n,
            device_count: 1n,
            booted: true,
            /* One enrolled device, at use counter zero. */
            devices: { member: () => true },
          }),
        }),
      providers: (_wallet: unknown, privateStateId: string, account: unknown = null) => {
        connections.push({ privateStateId, account });
        return Promise.resolve(providers);
      },
      contracts: () =>
        Promise.resolve({
          createUnprovenDeployTx: () => Promise.reject(new Error('not used here')),
          submitTx: () => Promise.reject(new Error('not used here')),
          findDeployedContract: (_providers: unknown, callOptions: unknown) => {
            opened.push((callOptions as { contractAddress: string }).contractAddress);
            return Promise.resolve({ callTx });
          },
        } as never),
      commitmentWindow: (_indexer: string, txId: string) => {
        windowQuestions.push(txId);
        return (options.window ?? (() => Promise.resolve({ startIndex: 8, endIndex: 9 })))(txId);
      },
      now: () => 1_700_000_000_000,
      sleep: () => Promise.resolve(undefined),
    },
  };
}

/** A change coin as the circuit returns it. */
function changeResult(value: bigint, nonce = CHANGE_NONCE, colour = COLOUR): unknown {
  return {
    is_some: true,
    value: { nonce: hexToBytes(nonce), color: hexToBytes(colour), value },
  };
}

/** A promise that never settles, and the way to let it go at the end. */
function hanging<T>(): { promise: Promise<T>; release: (value: T) => void } {
  let release: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/**
 * Runs the event loop until something is true, or gives up.
 *
 * WAITED FOR RATHER THAN COUNTED. The flow under test awaits a dynamic import
 * and several promises before it reaches the point these drills read storage
 * at, and a fixed number of ticks is a drill that passes or fails on how many
 * microtasks somebody's refactor added. Bounded, so a condition that never
 * comes true fails the test rather than hanging it.
 */
async function until(condition: () => boolean, what: string): Promise<void> {
  for (let tick = 0; tick < 200; tick += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`the run never reached: ${what}`);
}

beforeEach(() => {
  resetCustodySessionState();
  resolveHashWith = (_indexer, identifier) => Promise.resolve(`hash-of-${identifier}`);
  const coins = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => coins.get(key) ?? null,
        setItem: (key: string, value: string) => void coins.set(key, value),
        removeItem: (key: string) => void coins.delete(key),
      },
    },
  });
});

/* -------------------------------------------------------------------------- */
/* What is on disk while the indexer is being asked                           */
/* -------------------------------------------------------------------------- */

describe('the change coin reaches storage before anything slow happens', () => {
  it('is written, with the spent nonce, while the chain hash is still being asked for', async () => {
    const test = harness({ circuitResult: changeResult(60n) });
    const { session, device } = deviceFake();
    putK1Coin(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n, mtIndex: 5n });

    const gate = hanging<string>();
    let hashAsked = false;
    resolveHashWith = () => {
      hashAsked = true;
      return gate.promise;
    };

    const pending = withdrawShieldedK1(
      session,
      device,
      { recipientCoinPublicKey: new Uint8Array(32).fill(0x11), colourHex: COLOUR, amount: 40n },
      undefined,
      test.deps,
    );
    /* THE MOMENT THIS DRILL IS ABOUT: the call has resolved, the first
       question to an indexer is out and hanging, and a tab closed here is what
       the store below has to survive. */
    await until(() => hashAsked, 'the chain hash being asked for');

    /* A RELOAD, READ OUT OF THE SAME STORAGE. Nothing in the store is held in
       memory between calls, so a fresh read is a fresh session. */
    expect(isK1NonceSpent(ACCOUNT, NONCE)).toBe(true);
    expect(heldK1Coin(ACCOUNT, COLOUR)).toBeNull();
    expect(awaitingK1Coins(ACCOUNT)).toEqual([
      { colour: COLOUR, nonce: CHANGE_NONCE, value: 60n, txId: 'id-1' },
    ]);
    /* And nothing has been asked about the position yet. */
    expect(test.windowQuestions).toEqual([]);

    gate.release('chain-hash');
    await pending;
  });

  it('files the change under the chain’s hash once there is one, and settles it', async () => {
    const test = harness({ circuitResult: changeResult(60n) });
    const { session, device } = deviceFake();
    putK1Coin(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n, mtIndex: 5n });

    const result = await withdrawShieldedK1(
      session,
      device,
      { recipientCoinPublicKey: new Uint8Array(32), colourHex: COLOUR, amount: 40n },
      undefined,
      test.deps,
    );

    /* THE IDENTIFIER IS NOT A KEY THE INDEXER CAN ANSWER — a sponsored
       transaction is superseded — so the row is renamed to the hash before the
       position is asked about, and the question is asked about the hash. */
    expect(test.windowQuestions).toEqual(['hash-of-id-1']);
    expect(result.txHash).toBe('hash-of-id-1');
    expect(result.changePosition).toBe('settled');
    expect(heldK1Coin(ACCOUNT, COLOUR)).toEqual({
      colour: COLOUR,
      nonce: CHANGE_NONCE,
      value: 60n,
      mtIndex: 8n,
    });
    expect(awaitingK1Coins(ACCOUNT)).toEqual([]);
  });

  it('leaves the change described and waiting when the position question hangs', async () => {
    const gate = hanging<{ startIndex: number; endIndex: number } | null>();
    const test = harness({ circuitResult: changeResult(60n) }, { window: () => gate.promise });
    const { session, device } = deviceFake();
    putK1Coin(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n, mtIndex: 5n });

    const pending = withdrawShieldedK1(
      session,
      device,
      { recipientCoinPublicKey: new Uint8Array(32), colourHex: COLOUR, amount: 40n },
      undefined,
      test.deps,
    );
    await until(() => test.windowQuestions.length > 0, 'the position being asked about');

    /* Described, held by this account, and not spendable — which is exactly
       what the row says, and is why it is not counted as balance. */
    expect(awaitingK1Coins(ACCOUNT).map((row) => row.nonce)).toEqual([CHANGE_NONCE]);
    expect(heldK1Coin(ACCOUNT, COLOUR)).toBeNull();

    gate.release(null);
    const result = await pending;
    /* An indexer that has not caught up is a question to ask again, not a lost
       coin: the row stays where it is. */
    expect(result.changePosition).toBe('awaiting');
    expect(awaitingK1Coins(ACCOUNT).map((row) => row.nonce)).toEqual([CHANGE_NONCE]);
  });

  it('keeps both candidate positions when the transaction had two outputs', async () => {
    const test = harness(
      { circuitResult: changeResult(60n) },
      { window: () => Promise.resolve({ startIndex: 8, endIndex: 10 }) },
    );
    const { session, device } = deviceFake();
    putK1Coin(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n, mtIndex: 5n });

    const result = await withdrawShieldedK1(
      session,
      device,
      { recipientCoinPublicKey: new Uint8Array(32), colourHex: COLOUR, amount: 40n },
      undefined,
      test.deps,
    );

    expect(result.changePosition).toBe('candidates');
    expect(k1CoinCandidates(ACCOUNT, COLOUR)).toEqual([8n, 9n]);
    expect(heldK1Coin(ACCOUNT, COLOUR)?.mtIndex).toBe(8n);
  });

  it('records a spend whose change it could not read, rather than losing the colour', async () => {
    const test = harness({ circuitResult: { is_some: true, value: 'not a coin' } });
    const { session, device } = deviceFake();
    putK1Coin(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n, mtIndex: 5n });

    const result = await withdrawShieldedK1(
      session,
      device,
      { recipientCoinPublicKey: new Uint8Array(32), colourHex: COLOUR, amount: 40n },
      undefined,
      test.deps,
    );

    expect(result.change.outcome).toBe('unreadable');
    expect(result.changePosition).toBe('none');
    /* The colour keeps a row naming the transaction, so nothing silently stops
       being shown and somebody has a hash to go and look with. */
    expect(loadK1CoinStore(ACCOUNT).unreadChange[COLOUR]).toBe('id-1');
    expect(isK1NonceSpent(ACCOUNT, NONCE)).toBe(true);
  });

  it('promotes the next payment when the spend consumed the coin exactly', async () => {
    const test = harness({ circuitResult: { is_some: false } });
    const { session, device } = deviceFake();
    enqueueK1Coin(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n, mtIndex: 5n });
    enqueueK1Coin(ACCOUNT, { colour: COLOUR, nonce: '4c'.repeat(32), value: 40n, mtIndex: 6n });

    const result = await withdrawShieldedK1(
      session,
      device,
      { recipientCoinPublicKey: new Uint8Array(32), colourHex: COLOUR, amount: 100n },
      undefined,
      test.deps,
    );

    expect(result.change.outcome).toBe('none');
    expect(heldK1Coin(ACCOUNT, COLOUR)?.nonce).toBe('4c'.repeat(32));
    expect(test.windowQuestions).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* A position that was a guess                                                */
/* -------------------------------------------------------------------------- */

describe('a spend against a position that may be the wrong one', () => {
  it('rebuilds the challenge for the next candidate, and settles the one that proves', async () => {
    const test = harness({ circuitResult: changeResult(60n), positionFailures: 1 });
    const { session, device, signed } = deviceFake();
    putK1CoinCandidates(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n }, [5n, 6n]);

    await withdrawShieldedK1(
      session,
      device,
      { recipientCoinPublicKey: new Uint8Array(32), colourHex: COLOUR, amount: 40n },
      undefined,
      test.deps,
    );

    /* TWO CALLS, TWO SIGNATURES, TWO DIFFERENT DIGESTS. The challenge binds
       the qualified coin, so a retry that re-used the first digest would be a
       signature over a coin the second proof does not spend. */
    expect(test.calls.filter((call) => call.circuit === 'withdraw_shielded_with_k256')).toHaveLength(
      2,
    );
    expect(signed).toHaveLength(2);
    expect(bytesToHex(signed[0])).not.toBe(bytesToHex(signed[1]));
    /* The winner is the coin's position from here, with no list beside it. */
    expect(k1CoinCandidates(ACCOUNT, COLOUR)).toEqual([]);
    expect(heldK1Coin(ACCOUNT, COLOUR)?.nonce).toBe(CHANGE_NONCE);
  });

  it('does not retry a failure a different position could not fix', async () => {
    const test = harness({ otherFailure: 'The service that finishes this step is not answering.' });
    const { session, device } = deviceFake();
    putK1CoinCandidates(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n }, [5n, 6n]);

    await expect(
      withdrawShieldedK1(
        session,
        device,
        { recipientCoinPublicKey: new Uint8Array(32), colourHex: COLOUR, amount: 40n },
        undefined,
        test.deps,
      ),
    ).rejects.toThrow(/not answering/);

    /* One approval asked for, one call made, and the guess untouched: a retry
       would ask the person to approve again for nothing. */
    expect(test.calls.filter((call) => call.circuit === 'withdraw_shielded_with_k256')).toHaveLength(
      1,
    );
    expect(k1CoinCandidates(ACCOUNT, COLOUR)).toEqual([5n, 6n]);
    expect(heldK1Coin(ACCOUNT, COLOUR)?.mtIndex).toBe(5n);
    expect(isK1NonceSpent(ACCOUNT, NONCE)).toBe(false);
  });

  it('gives up with the failure’s own words when every candidate has been tried', async () => {
    const test = harness({ positionFailures: 5 });
    const { session, device } = deviceFake();
    putK1CoinCandidates(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n }, [5n, 6n]);

    await expect(
      withdrawShieldedK1(
        session,
        device,
        { recipientCoinPublicKey: new Uint8Array(32), colourHex: COLOUR, amount: 40n },
        undefined,
        test.deps,
      ),
    ).rejects.toThrow(/merkle/);

    /* NOTHING WAS SPENT. An unsatisfiable witness submits no transaction, so
       the coin is still the coin. AND NOTHING WAS FORGOTTEN: the description
       and BOTH positions survive, with the head back on the coin, so the next
       spend of this colour starts where the chain's own answer put it. A run
       that kept the last guess and dropped the list was a colour nothing could
       spend again — `reconcileK1CoinFromChain` answers 'known' for a nonce the
       store holds, so no later read rebuilt it (review, 2026/09/18). */
    expect(heldK1Coin(ACCOUNT, COLOUR)?.nonce).toBe(NONCE);
    expect(heldK1Coin(ACCOUNT, COLOUR)?.mtIndex).toBe(5n);
    expect(k1CoinCandidates(ACCOUNT, COLOUR)).toEqual([5n, 6n]);
    expect(isK1NonceSpent(ACCOUNT, NONCE)).toBe(false);
    expect(Object.keys(loadK1CoinStore(ACCOUNT).coins)).toEqual([COLOUR]);
    expect(test.calls.filter((call) => call.circuit === 'withdraw_shielded_with_k256')).toHaveLength(
      2,
    );
  });

  /* THE SCENARIO, and the reason the sponsor now has two codes for it: the
     proof service is restarted while a spend is being proved. It has looked at
     neither candidate position, so a retry against the second one asks for a
     second approval to learn nothing — and on a two-candidate coin it used to
     run the list out and leave the store on the wrong guess for good. */
  it('asks for one approval only when the proof service is not there mid-spend', async () => {
    const test = harness({ otherFailure: CUSTODY_PROVER_UNAVAILABLE });
    const { session, device, signed } = deviceFake();
    putK1CoinCandidates(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n }, [5n, 6n]);

    await expect(
      withdrawShieldedK1(
        session,
        device,
        { recipientCoinPublicKey: new Uint8Array(32), colourHex: COLOUR, amount: 40n },
        undefined,
        test.deps,
      ),
    ).rejects.toThrow(CUSTODY_PROVER_UNAVAILABLE);

    expect(signed).toHaveLength(1);
    expect(test.calls.filter((call) => call.circuit === 'withdraw_shielded_with_k256')).toHaveLength(
      1,
    );
    /* The guess, the list, and the coin are all exactly as they were. */
    expect(heldK1Coin(ACCOUNT, COLOUR)?.mtIndex).toBe(5n);
    expect(k1CoinCandidates(ACCOUNT, COLOUR)).toEqual([5n, 6n]);
    expect(isK1NonceSpent(ACCOUNT, NONCE)).toBe(false);
  });

  it('refuses before anything is signed when the store holds nothing of that colour', async () => {
    const test = harness();
    const { session, device, signed } = deviceFake();

    await expect(
      withdrawShieldedK1(
        session,
        device,
        { recipientCoinPublicKey: new Uint8Array(32), colourHex: COLOUR, amount: 40n },
        undefined,
        test.deps,
      ),
    ).rejects.toThrow('There is nothing of that kind in this Passport to send.');
    expect(signed).toEqual([]);
    expect(test.calls).toEqual([]);
  });

  it('refuses a colour that is not one, before anything is opened', async () => {
    const test = harness();
    const { session, device } = deviceFake();

    await expect(
      withdrawShieldedK1(
        session,
        device,
        { recipientCoinPublicKey: new Uint8Array(32), colourHex: 'not-a-colour', amount: 40n },
        undefined,
        test.deps,
      ),
    ).rejects.toThrow('That is not something this Passport can send.');
    expect(test.opened).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* The witness the proof is built from                                        */
/* -------------------------------------------------------------------------- */

describe('held_coin, read out of the private state the connection serves', () => {
  /* Bound through a wrapper: the witness set is a plain object of functions
     and lifting one off it is what `@typescript-eslint/unbound-method` warns
     about, fairly, since the real caller is midnight-js reading the set. */
  const witness = (
    context: { privateState: ReturnType<typeof loadK1CoinStore> },
    colour: Uint8Array,
  ) => custodyWitnesses().held_coin(context, colour);

  it('answers the held coin in the compiled build’s own field names', () => {
    putK1Coin(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n, mtIndex: 5n });
    const [state, coin] = witness(
      { privateState: loadK1CoinStore(ACCOUNT) },
      hexToBytes(COLOUR),
    );

    expect(coin).toEqual({
      nonce: hexToBytes(NONCE),
      color: hexToBytes(COLOUR),
      value: 100n,
      mt_index: 5n,
    });
    /* A READ: the private state comes back unchanged, or midnight-js writes a
       second opinion about the store over the top of it. */
    expect(state).toEqual(loadK1CoinStore(ACCOUNT));
  });

  it('answers the current guess while a position is still being decided', () => {
    putK1CoinCandidates(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n }, [5n, 6n]);
    const [, first] = witness({ privateState: loadK1CoinStore(ACCOUNT) }, hexToBytes(COLOUR));
    expect(first.mt_index).toBe(5n);
  });

  it('refuses in one sentence for a colour the account holds nothing of', () => {
    putK1Coin(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n, mtIndex: 5n });
    expect(() =>
      witness({ privateState: loadK1CoinStore(ACCOUNT) }, hexToBytes(OTHER_COLOUR)),
    ).toThrow('There is nothing of that kind in this Passport to send.');
  });

  it('refuses when the colour holds only a coin that is still arriving', () => {
    /* Described, demonstrably held, and with no position: it cannot go into a
       proof, and answering with a zero position would build a transaction the
       node rejects for a reason that names none of this. */
    putK1Coin(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n, mtIndex: 5n });
    rememberK1ChangeCoin(ACCOUNT, COLOUR, { colour: COLOUR, nonce: CHANGE_NONCE, value: 60n }, 'tx');
    expect(() => witness({ privateState: loadK1CoinStore(ACCOUNT) }, hexToBytes(COLOUR))).toThrow(
      'There is nothing of that kind in this Passport to send.',
    );
  });

  it('refuses a colour that is not 32 bytes, and a private state with no coins', () => {
    putK1Coin(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n, mtIndex: 5n });
    expect(() =>
      witness({ privateState: loadK1CoinStore(ACCOUNT) }, new Uint8Array(4)),
    ).toThrow('There is nothing of that kind in this Passport to send.');
    expect(() =>
      witness({ privateState: { coins: {} } as never }, hexToBytes(COLOUR)),
    ).toThrow('There is nothing of that kind in this Passport to send.');
  });

  it('does not answer a coin the store has stopped holding since the challenge', () => {
    /* The store changed between the challenge and the proof — a spend landing
       from another tab. The witness reads the store, so it says so rather than
       handing a proof a coin that is gone. */
    putK1Coin(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n, mtIndex: 5n });
    const served = loadK1CoinStore(ACCOUNT);
    rememberK1ChangeCoin(ACCOUNT, COLOUR, null, 'tx');

    /* Served the state as it was, the witness would still answer the old coin
       — which is why the connection is served the STORE and not a snapshot. */
    expect(witness({ privateState: served }, hexToBytes(COLOUR))[1].value).toBe(100n);
    expect(() => witness({ privateState: loadK1CoinStore(ACCOUNT) }, hexToBytes(COLOUR))).toThrow(
      'There is nothing of that kind in this Passport to send.',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Paying another one of these accounts                                       */
/* -------------------------------------------------------------------------- */

describe('a deposit into somebody else’s account', () => {
  it('seals a description only the recipient can open, and sends it with the note', async () => {
    const test = harness();
    const { session } = deviceFake();
    const recipient = generateCustodyEncKeyPair();

    await depositShieldedIntoCustody(
      session,
      {
        targetAddress: PEER,
        recipientEncKeyHex: recipient.publicKeyHex,
        coin: { colour: COLOUR, nonce: NONCE, value: 250n },
      },
      undefined,
      test.deps,
    );

    const call = test.calls.find((row) => row.circuit === 'deposit_shielded');
    expect(call?.args).toHaveLength(2);
    const entry = call?.args[1] as Uint8Array;
    /* EXACTLY 192 BYTES, which is what the compiled ABI takes and what the
       recipient's list of deliveries holds. */
    expect(entry).toBeInstanceOf(Uint8Array);
    expect(entry.length).toBe(192);
    const opened = await openCustodyInboxEntry(recipient.secretKeyHex, entry);
    expect(opened).toMatchObject({ colour: COLOUR, nonce: NONCE, value: 250n });

    /* The call went to the RECIPIENT's address, and the connection was opened
       without this Passport's own coin store behind it. */
    expect(test.opened).toEqual([PEER]);
    expect(test.connections.at(-1)?.account).toBeNull();
    expect(test.connections.at(-1)?.privateStateId).toContain(PEER);
  });

  it('refuses a key that is not one before anything is submitted', async () => {
    const test = harness();
    const { session } = deviceFake();

    await expect(
      depositShieldedIntoCustody(
        session,
        {
          targetAddress: PEER,
          recipientEncKeyHex: 'not-a-key',
          coin: { colour: COLOUR, nonce: NONCE, value: 250n },
        },
        undefined,
        test.deps,
      ),
    ).rejects.toThrow();
    expect(test.calls).toEqual([]);
    expect(test.opened).toEqual([]);
  });

  it('refuses an address that is not one, and pays nobody', async () => {
    const test = harness();
    const { session } = deviceFake();

    await expect(
      custodyPermissionlessCallAt(
        session,
        'not-an-address',
        { operation: 'deposit_unshielded', args: [] },
        undefined,
        test.deps,
      ),
    ).rejects.toThrow('That Passport cannot be paid from here.');
    expect(test.calls).toEqual([]);
  });

  it('puts a note back into this Passport’s own account by the same route', async () => {
    /* THE DEPOSIT-BACK. One more permissionless deposit, to the sender's own
       address, sealed to the sender's own key — no approval from anybody. */
    const test = harness();
    const { session } = deviceFake();
    const own = generateCustodyEncKeyPair();

    await depositShieldedIntoCustody(
      session,
      {
        targetAddress: ADDRESS,
        recipientEncKeyHex: own.publicKeyHex,
        coin: { colour: COLOUR, nonce: NONCE, value: 40n },
      },
      undefined,
      test.deps,
    );

    expect(test.opened).toEqual([ADDRESS]);
    const entry = test.calls.at(-1)?.args[1] as Uint8Array;
    expect(await openCustodyInboxEntry(own.secretKeyHex, entry)).toMatchObject({ value: 40n });
  });
});
