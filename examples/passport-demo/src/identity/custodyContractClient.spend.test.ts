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
  CUSTODY_PROOF_NOT_BUILT,
  CUSTODY_PROVER_UNAVAILABLE,
  CUSTODY_SPENT_COIN_RETRIES,
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
  pendingK1Spends,
  queuedK1Coins,
  rememberK1ChangeCoin,
  undoneK1Spends,
  type K1Account,
} from './k1CoinStore.js';
import {
  custodyWitnesses,
  resetCustodySessionState,
  withdrawShieldedK1,
  type CustodyDeps,
  type CustodyDynamicSession,
} from './custodyContractClient.js';

/**
 * A 64-hex stand-in for the chain's hash of an identifier.
 *
 * THE SHAPE MATTERS HERE. A chain hash is 32 bytes and midnight-js's
 * identifier is 33, and that difference is how `settleK1AwaitingCoinByChainHash`
 * tells a row that still needs resolving from one that is ready to settle — so
 * a fake hash of any other shape would drill a path production never takes.
 */
function chainHashOf(identifier: string): string {
  return identifier.replace(/[^0-9a-f]/gi, '').padEnd(64, 'c').slice(0, 64);
}

/** The indexer walk that names the chain's hash. Controlled per test. */
let resolveHashWith: (indexer: string, identifier: string) => Promise<string> = (
  _indexer,
  identifier,
) => Promise.resolve(chainHashOf(identifier));

vi.mock('./contractRuntime.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./contractRuntime.js')>()),
  resolveTransactionHash: (indexer: string, identifier: string) =>
    resolveHashWith(indexer, identifier),
}));

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const ADDRESS = 'ab'.repeat(32);
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
    challenge_withdraw_shielded_to_contract_with_k256: (
      self,
      pk,
      recipient,
      color,
      amount,
      coin,
      nonce,
    ) =>
      tag(
        'ch-wsc',
        bytesToHex(self.bytes),
        pk.x,
        bytesToHex(recipient.bytes),
        color,
        amount,
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
    /* The jubjub arm's circuits. `sig_r` second, `grind_nonce` last — the
       generated order, which is the whole point of holding a fake to it. The
       tag's bytes are effectively random in the top position, so the grind
       loop lands below the subgroup order after a handful of turns exactly as
       it does against the real build. */
    compute_public_point_with_jubjub: (scalar) => ({ x: scalar, y: scalar + 1n }),
    challenge_withdraw_unshielded_with_jubjub: (self, sigR, pk, color, amount, recipient, nonce, grind) =>
      tag('jj-wu', bytesToHex(self.bytes), sigR.x, pk.x, color, amount, bytesToHex(recipient.bytes), nonce, grind),
    challenge_withdraw_shielded_with_jubjub: (self, sigR, pk, recipient, color, amount, coin, nonce, grind) =>
      tag('jj-ws', bytesToHex(self.bytes), sigR.x, pk.x, bytesToHex(recipient.bytes), color, amount, coin.value, nonce, grind),
    challenge_withdraw_shielded_to_contract_with_jubjub: (self, sigR, pk, recipient, color, amount, coin, nonce, grind) =>
      tag('jj-wsc', bytesToHex(self.bytes), sigR.x, pk.x, bytesToHex(recipient.bytes), color, amount, coin.value, nonce, grind),
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
  /** The node took it and the chain never records it: the wait never answers. */
  neverLands?: boolean;
  /** The account's `auth_nonce` on the read after the wait ran out. */
  nonceAfter?: bigint;
  /** What a call returns as the circuit's own result. */
  circuitResult?: unknown;
  /** How many spends fail the way a wrong position fails, before one lands. */
  positionFailures?: number;
  /**
   * Where the chain really has the coin: a spend at any other position fails
   * as a wrong position does, and the account's tree dump lists the coin here.
   */
  truePosition?: bigint;
  /** The account's commitment-tree dump, as the indexer serves it. */
  zswapDump?: string;
  /** A failure a different position could not fix. */
  otherFailure?: string;
  /**
   * What a wrong position says when it fails. The default is the runtime naming
   * the merkle path; the LIVE shape is a bare trap with no words in it at all
   * (2026/09/18), which is why it is settable.
   */
  positionFailureMessage?: string;
  /**
   * A failure raised from inside `submitTx` AFTER the proof came back — a
   * balancing or submission failure. The transaction may be away, so nothing
   * may retry it however the failure is worded.
   */
  submitFailure?: string;
  /**
   * The chain's verdict on the transaction, as the finalised data carries it.
   *
   * `undefined` is the ordinary success. `null` is finalised data with NO
   * status in it at all — the shape this build cannot read a verdict out of,
   * which is not the same as a verdict of no.
   */
  submitStatus?: string | null;
  /**
   * A failure raised while WAITING for the chain's verdict.
   *
   * The node has the transaction and the wait for finality failed — a dropped
   * socket, which is what the outages of 2026/09/05 and 2026/09/07 were. It
   * says nothing about whether the transaction landed.
   */
  watchFailure?: string;
  /**
   * What the indexer answers when a row still filed under an identifier is
   * asked about again — `settleK1AwaitingCoinByChainHash`'s second chance.
   */
  chainHashLater?: (txId: string) => string | null;
  /* 2026/09/22 — the bounds, the booking at balance, and the node's refusals. */
  /** A wallet provider is in the set, so the booking happens at balance. */
  withWallet?: boolean;
  /** Thrown by the submit as it is, rather than as an `Error` from `submitFailure`. */
  submitError?: unknown;
  /** The first N submits are refused because the account moved (`Custom error: 104`). */
  races?: number;
  /** The code those refusals carry: `104` by default, `196` for a DUST collision. */
  raceCode?: string;
  /** The submit never answers, after balancing. */
  submitHangs?: boolean;
  /** Balancing waits on this before it answers. */
  balanceGate?: Promise<void>;
  /** Reading the account never answers. */
  stateHangs?: boolean;
  /** What the indexer says of the transaction when asked after the wait. */
  outcome?: { outcome: 'success' | 'failure' | 'absent'; hash: string | null } | null;
}

/** The node's refusal as it really arrives: four layers deep (live, 2026/09/22). */
function nodeRefusal(code: string): Error {
  const rpc = Object.assign(new Error('1010: Invalid Transaction'), { name: 'RpcError', data: `Custom error: ${code}` });
  const fiber = new Error('Transaction submission error');
  fiber.name = '(FiberFailure) SubmissionError';
  Object.defineProperty(fiber, Symbol.for('effect/Runtime/FiberFailure/Cause'), {
    value: { _tag: 'Fail', error: { _tag: 'SubmissionError', message: 'Transaction submission error', cause: rpc } },
  });
  return fiber;
}

/** An unproven CALL, as the fake `createUnprovenCallTx` hands it back. */
interface FakeCallTx {
  readonly circuit: string;
  readonly args: readonly unknown[];
  /** The proof provider serialises the transaction it is given. */
  readonly serialize: () => Uint8Array;
  /** Every intent grafted onto this one — the direct transfer's claim. */
  readonly grafted: readonly unknown[];
  readonly intents: Map<number, unknown>;
  addIntent(segment: { tag: string }, intent: unknown): FakeCallTx;
}

interface SpendHarness {
  deps: Partial<CustodyDeps>;
  storage: CustodyStorage & { data: Map<string, string> };
  calls: { circuit: string; args: unknown[]; options?: unknown }[];
  /** How many intents each submitted transaction carried grafted onto it. */
  grafts: number[];
  connections: { privateStateId: string; account: unknown }[];
  opened: string[];
  /** Every commitment-window question asked, by transaction. */
  windowQuestions: string[];
  /** Every identifier the settle asked the indexer to name the hash of. */
  hashQuestions: string[];
  /** Every transaction the run waited on the chain's verdict for. */
  watched: string[];
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

  const calls: { circuit: string; args: unknown[]; options?: unknown }[] = [];
  /** How many intents each submitted transaction carried grafted onto it. */
  const grafts: number[] = [];
  const connections: { privateStateId: string; account: unknown }[] = [];
  const opened: string[] = [];
  const windowQuestions: string[] = [];
  const hashQuestions: string[] = [];
  const watched: string[] = [];
  let submitted = 0;

  /** An unproven call, with the two members a graft needs. */
  const unprovenCall = (circuit: string, args: readonly unknown[]): FakeCallTx => {
    /* THE INTENTS MAP GROWS, as the real `addIntent` grows it. A fake whose
       map stayed one long would drill a world in which a graft that attached
       nothing is indistinguishable from one that worked — which is the world
       the silent `?? sender` fallback lived in, and it ends in a transaction
       that spends the sender's coin and pays nobody. */
    const make = (grafted: readonly unknown[], intents: Map<number, unknown>): FakeCallTx => ({
      circuit,
      args,
      grafted,
      serialize: () => new Uint8Array([1, 2, 3]),
      intents,
      addIntent: (segment, intent) => {
        if (segment.tag !== 'random') throw new Error('a claim goes into a random segment');
        const next = new Map(intents);
        next.set(next.size, intent);
        return make([...grafted, intent], next);
      },
    });
    return make([], new Map([[0, { intentFor: circuit }]]));
  };

  /* THE SPEND IS BUILT HERE AND SENT BELOW. A wrong coin position traps while
     the circuit is executed against the contract's own Zswap tree, which is
     this step; the proving service's own refusal comes one step later. */
  const createUnprovenCallTx = (_providers: unknown, callOptions: unknown) => {
    const { circuitId, args, contractAddress } = callOptions as {
      circuitId: string;
      args: unknown[];
      contractAddress: string;
    };
    calls.push({ circuit: circuitId, args, options: callOptions });
    opened.push(contractAddress);
    if (circuitId.startsWith('withdraw_shielded')) {
      if (chain.truePosition !== undefined && heldK1Coin(ACCOUNT, COLOUR)?.mtIndex !== chain.truePosition) {
        return Promise.reject(new Error('could not build the merkle path for this coin'));
      }
      if ((chain.positionFailures ?? 0) > 0) {
        chain.positionFailures = (chain.positionFailures ?? 0) - 1;
        return Promise.reject(
          new Error(chain.positionFailureMessage ?? 'could not build the merkle path for this coin'),
        );
      }
      if (chain.otherFailure !== undefined) {
        return Promise.reject(new Error(chain.otherFailure));
      }
    }
    return Promise.resolve({
      private: {
        result: circuitId === 'deposit_shielded' ? null : chain.circuitResult,
        unprovenTx: unprovenCall(circuitId, args),
        nextPrivateState: { coins: {} },
      },
    });
  };

  /* REAL `submitTxAsync` PROVES, BALANCES, THEN SUBMITS, behind one call —
     which is why the caller cannot tell those three apart from the outside and
     why the proof provider reports the boundary. It comes back with the id the
     moment the node has the transaction and says NOTHING about what became of
     it; that is a second question, below. The fake does the same, so a test can
     fail on any of the four. */
  const submitTxAsync = async (submitProviders: unknown, submitOptions: unknown) => {
    const { unprovenTx } = submitOptions as { unprovenTx: FakeCallTx };
    const prover = (submitProviders as {
      proofProvider?: { proveTx(tx: unknown): Promise<unknown> };
    }).proofProvider;
    if (prover) await prover.proveTx(unprovenTx);
    /* BALANCED, WHEN THERE IS A WALLET: the step the booking now hangs on. */
    const wallet = (submitProviders as {
      walletProvider?: { balanceTx(tx: unknown): Promise<unknown> };
    }).walletProvider;
    let balancedId: string | null = null;
    if (wallet) balancedId = ((await wallet.balanceTx(unprovenTx)) as { id: string }).id;
    grafts.push(unprovenTx.grafted.length);
    submitted += 1;
    if ((chain.races ?? 0) > 0) {
      chain.races = (chain.races ?? 0) - 1;
      throw nodeRefusal(chain.raceCode ?? '104');
    }
    if (chain.submitError !== undefined) throw chain.submitError as Error;
    if (chain.submitFailure !== undefined) throw new Error(chain.submitFailure);
    if (chain.submitHangs === true) return new Promise<string>(() => undefined);
    return balancedId ?? `id-${submitted}`;
  };
  let balanced = 0;

  /* THE CHAIN'S ANSWER, ASKED FOR SEPARATELY. The status is part of it, and the
     real one carries it whether the chain took the transaction or refused it: a
     fake that answered only an id would drill a world in which arriving is the
     same as succeeding, which is exactly the world the defect lived in. */
  const watchForTxData = (txId: string) => {
    watched.push(txId);
    if (chain.neverLands === true) return new Promise(() => undefined);
    if (chain.watchFailure !== undefined) return Promise.reject(new Error(chain.watchFailure));
    return Promise.resolve({
      txId,
      ...(chain.submitStatus === null ? {} : { status: chain.submitStatus ?? 'SucceedEntirely' }),
    });
  };

  /* The library's own composition of the two, for anything that wants it. */
  const submitTx = async (submitProviders: unknown, submitOptions: unknown) =>
    watchForTxData(await submitTxAsync(submitProviders, submitOptions));

  const providers: Record<string, unknown> = {
    ...(chain.withWallet === true
      ? {
          walletProvider: {
            balanceTx: async (tx: unknown) => {
              if (chain.balanceGate) await chain.balanceGate;
              balanced += 1;
              return { id: `bal-${balanced}`, tx };
            },
          },
        }
      : {}),
    publicDataProvider: {
      queryContractState: () =>
        chain.stateHangs === true
          ? new Promise(() => undefined)
          : Promise.resolve({ data: 'state', serialize: () => new Uint8Array([1]) }),
      watchForTxData,
      ...(chain.zswapDump === undefined
        ? {}
        : { queryZSwapAndContractState: () => Promise.resolve([{ toString: () => chain.zswapDump }]) }),
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
    grafts,
    connections,
    opened,
    windowQuestions,
    hashQuestions,
    watched,
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
            auth_nonce: submitted > 0 && chain.nonceAfter !== undefined ? chain.nonceAfter : 3n,
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
          createUnprovenCallTx,
          submitTx,
          submitTxAsync,
          findDeployedContract: () => Promise.reject(new Error('not used here')),
        } as never),
      resolveChainHash: (_indexer: string, txId: string) => {
        hashQuestions.push(txId);
        return Promise.resolve(chain.chainHashLater?.(txId) ?? null);
      },
      commitmentWindow: (_indexer: string, txId: string) => {
        windowQuestions.push(txId);
        return (options.window ?? (() => Promise.resolve({ startIndex: 8, endIndex: 9 })))(txId);
      },
      now: () => 1_700_000_000_000,
      sleep: () => Promise.resolve(undefined),
      submitWaitMs: 5,
      identifierOf: (balancedTx: unknown) => (balancedTx as { id?: string }).id ?? null,
      txOutcome: () => Promise.resolve(chain.outcome ?? null),
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

/** What the stubbed proving service answers next. Set by the phase tests. */
let proveAnswer: () => Promise<Response> = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify({ provenTx: 'ab' })),
  } as Response);

beforeEach(() => {
  resetCustodySessionState();
  resolveHashWith = (_indexer, identifier) => Promise.resolve(chainHashOf(identifier));
  /* THE PROVING SERVICE, STUBBED. `custodyProviders` builds the real
     `custodyProofProvider` around `globalThis.fetch`, and the whole point of
     these drills is that the provider's `onProved` is what tells a spend which
     side of the proof it failed on — so the provider is exercised rather than
     replaced. */
  proveAnswer = () =>
    Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ provenTx: 'ab' })),
    } as Response);
  vi.stubGlobal('fetch', () => proveAnswer());
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
      {
        recipientCoinPublicKey: new Uint8Array(32).fill(0x11),
        recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
        colourHex: COLOUR, amount: 40n },
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

    gate.release(chainHashOf('id-1'));
    await pending;
  });

  it('files the change under the chain’s hash once there is one, and settles it', async () => {
    const test = harness({ circuitResult: changeResult(60n) });
    const { session, device } = deviceFake();
    putK1Coin(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n, mtIndex: 5n });

    const result = await withdrawShieldedK1(
      session,
      device,
      {
        recipientCoinPublicKey: new Uint8Array(32),
        recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
        colourHex: COLOUR, amount: 40n },
      undefined,
      test.deps,
    );

    /* THE IDENTIFIER IS NOT A KEY THE INDEXER CAN ANSWER — a sponsored
       transaction is superseded — so the row is renamed to the hash before the
       position is asked about, and the question is asked about the hash. */
    expect(test.windowQuestions).toEqual([chainHashOf('id-1')]);
    expect(result.txHash).toBe(chainHashOf('id-1'));
    expect(result.changePosition).toBe('settled');
    expect(heldK1Coin(ACCOUNT, COLOUR)).toEqual({
      colour: COLOUR,
      nonce: CHANGE_NONCE,
      value: 60n,
      mtIndex: 8n,
    });
    expect(awaitingK1Coins(ACCOUNT)).toEqual([]);
  });

  /* THE DEFECT THIS IS THE DRILL FOR (review, 2026/09/18). `resolveTransactionHash`
     polls the indexer for ten seconds and then HANDS BACK THE IDENTIFIER it was
     given, which is not a failure and reads exactly like an answer. The row was
     therefore left filed under a name the indexer answers nothing for, and every
     later read asked the same unanswerable question: the change read "arriving"
     for the rest of the account's life whenever the indexer lagged by more than
     ten seconds. */
  it('asks the indexer again when the spend’s own hash walk ran out of patience', async () => {
    const test = harness({
      circuitResult: changeResult(60n),
      /* The indexer caught up between the two questions. */
      chainHashLater: () => chainHashOf('id-1'),
    });
    const { session, device } = deviceFake();
    putK1Coin(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n, mtIndex: 5n });
    /* Ten seconds of polling, and then the identifier back unchanged. */
    resolveHashWith = (_indexer, identifier) => Promise.resolve(identifier);

    const result = await withdrawShieldedK1(
      session,
      device,
      {
        recipientCoinPublicKey: new Uint8Array(32),
        recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
        colourHex: COLOUR, amount: 40n },
      undefined,
      test.deps,
    );

    /* The identifier was never put to the window — it has no answer in it —
       and the row was renamed the moment the indexer could name it. */
    expect(test.hashQuestions).toEqual(['id-1']);
    expect(test.windowQuestions).toEqual([chainHashOf('id-1')]);
    expect(result.changePosition).toBe('settled');
    expect(heldK1Coin(ACCOUNT, COLOUR)?.nonce).toBe(CHANGE_NONCE);
    expect(awaitingK1Coins(ACCOUNT)).toEqual([]);
  });

  it('keeps the change waiting under its identifier until the indexer knows it', async () => {
    const test = harness({ circuitResult: changeResult(60n) });
    const { session, device } = deviceFake();
    putK1Coin(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n, mtIndex: 5n });
    resolveHashWith = (_indexer, identifier) => Promise.resolve(identifier);

    const result = await withdrawShieldedK1(
      session,
      device,
      {
        recipientCoinPublicKey: new Uint8Array(32),
        recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
        colourHex: COLOUR, amount: 40n },
      undefined,
      test.deps,
    );

    /* NOTHING IS ASKED ABOUT A POSITION under a name the indexer cannot answer,
       and the row keeps its description so a later read can rename it. */
    expect(test.hashQuestions).toEqual(['id-1']);
    expect(test.windowQuestions).toEqual([]);
    expect(result.changePosition).toBe('awaiting');
    expect(awaitingK1Coins(ACCOUNT)).toEqual([
      { colour: COLOUR, nonce: CHANGE_NONCE, value: 60n, txId: 'id-1' },
    ]);
  });

  it('leaves the change described and waiting when the position question hangs', async () => {
    const gate = hanging<{ startIndex: number; endIndex: number } | null>();
    const test = harness({ circuitResult: changeResult(60n) }, { window: () => gate.promise });
    const { session, device } = deviceFake();
    putK1Coin(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n, mtIndex: 5n });

    const pending = withdrawShieldedK1(
      session,
      device,
      {
        recipientCoinPublicKey: new Uint8Array(32),
        recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
        colourHex: COLOUR, amount: 40n },
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
      {
        recipientCoinPublicKey: new Uint8Array(32),
        recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
        colourHex: COLOUR, amount: 40n },
      undefined,
      test.deps,
    );

    expect(result.changePosition).toBe('candidates');
    expect(k1CoinCandidates(ACCOUNT, COLOUR)).toEqual([8n, 9n]);
    expect(heldK1Coin(ACCOUNT, COLOUR)?.mtIndex).toBe(8n);
  });

  /* FLIPPED 2026/09/18. This used to assert that a spend whose change could not
     be read was SUBMITTED and the colour given a row naming the transaction.
     That is the wrong half of the choice: the description is the circuit's
     return value and exists nowhere else in the world, so submitting without it
     strands the remainder of somebody's balance on chain permanently, and the
     row naming the transaction buys nobody anything they can spend. The read
     happens on the unproven call, so refusing costs exactly nothing. */
  it('refuses to send a payment whose change it could not read, and sends nothing', async () => {
    const test = harness({ circuitResult: { is_some: true, value: 'not a coin' } });
    const { session, device } = deviceFake();
    putK1Coin(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n, mtIndex: 5n });

    await expect(
      withdrawShieldedK1(
        session,
        device,
        {
          recipientCoinPublicKey: new Uint8Array(32),
          recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
          colourHex: COLOUR, amount: 40n },
        undefined,
        test.deps,
      ),
    ).rejects.toThrow('This Passport could not prepare that payment. Nothing was sent.');

    /* NOTHING WAS SUBMITTED, so nothing moved and the store is untouched: the
       coin is still held, its nonce is not spent, and no colour carries a row
       saying a payment left. */
    expect(test.grafts).toEqual([]);
    expect(heldK1Coin(ACCOUNT, COLOUR)?.nonce).toBe(NONCE);
    expect(isK1NonceSpent(ACCOUNT, NONCE)).toBe(false);
    expect(loadK1CoinStore(ACCOUNT).unreadChange).toEqual({});
    expect(awaitingK1Coins(ACCOUNT)).toEqual([]);
  });

  /* ---------------------------------------------------------------------- */
  /* THE CHAIN'S VERDICT (R1)                                                */
  /*                                                                         */
  /* `submitTx` resolves with the finalised data for a transaction that      */
  /* FAILED exactly as it does for one that succeeded. Booking the spend on  */
  /* the strength of the promise resolving deletes the held coin, marks its  */
  /* nonce spent for ever, and files a change coin the chain never created — */
  /* and `reconcileK1CoinFromChain` then answers 'spent' about a coin the    */
  /* account still holds, which is a balance that cannot come back.          */
  /* ---------------------------------------------------------------------- */

  it('leaves the coin held when the chain refused the transaction', async () => {
    const test = harness({ circuitResult: changeResult(60n), submitStatus: 'FailFallible' });
    const { session, device } = deviceFake();
    putK1CoinCandidates(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n }, [5n, 6n]);

    const seen: string[] = [];
    await expect(
      withdrawShieldedK1(
        session,
        device,
        {
          recipientCoinPublicKey: new Uint8Array(32),
          recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
          colourHex: COLOUR,
          amount: 40n,
        },
        (phase) => {
          if (phase.txId !== undefined) seen.push(phase.txId);
        },
        test.deps,
      ),
    ).rejects.toThrow('That payment did not go through, and nothing left your Passport.');

    /* A FAILED TRANSACTION SPENT NOTHING, so the store says nothing happened. */
    expect(heldK1Coin(ACCOUNT, COLOUR)?.nonce).toBe(NONCE);
    expect(heldK1Coin(ACCOUNT, COLOUR)?.mtIndex).toBe(5n);
    expect(isK1NonceSpent(ACCOUNT, NONCE)).toBe(false);
    expect(awaitingK1Coins(ACCOUNT)).toEqual([]);
    /* THE GUESSES DO NOT COME BACK, and that is right: the proof verified
       against position 5, which is the chain agreeing with it, and that stays
       true whatever the transaction carrying it came to afterwards. Putting the
       list back would cost an approval per position on the next press. */
    expect(k1CoinCandidates(ACCOUNT, COLOUR)).toEqual([]);
    /* ONE ATTEMPT. A refused transaction is not a wrong position, and a second
       candidate would be a second approval and a second transaction. */
    expect(test.calls.filter((call) => call.circuit === 'withdraw_shielded_with_k256')).toHaveLength(
      1,
    );
    /* And the transaction is still named, because one exists: the record must
       not tell somebody nothing was sent when something was. */
    expect(seen).toEqual(['id-1']);
  });

  it('settles a payment the chain never recorded as not sent, and gives the coin back', async () => {
    /* Live, 2026/09/22: proved, balanced, taken by the node, and never on
       chain. The wait is bounded; the account's nonce has not moved, so the
       payment did not run and the write is taken back as a refusal's is. */
    const test = harness({ circuitResult: changeResult(60n), neverLands: true });
    const { session, device } = deviceFake();
    putK1CoinCandidates(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n }, [5n, 6n]);

    await expect(
      withdrawShieldedK1(
        session,
        device,
        {
          recipientCoinPublicKey: new Uint8Array(32),
          recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
          colourHex: COLOUR,
          amount: 40n,
        },
        undefined,
        test.deps,
      ),
    ).rejects.toThrow("That payment didn't go through. Nothing left your Passport.");

    expect(heldK1Coin(ACCOUNT, COLOUR)?.nonce).toBe(NONCE);
    expect(isK1NonceSpent(ACCOUNT, NONCE)).toBe(false);
    expect(awaitingK1Coins(ACCOUNT)).toEqual([]);
  });

  it('keeps the write and hedges when the account moved while the wait ran out', async () => {
    const test = harness({ circuitResult: changeResult(60n), neverLands: true, nonceAfter: 4n });
    const { session, device } = deviceFake();
    putK1CoinCandidates(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n }, [5n, 6n]);

    await expect(
      withdrawShieldedK1(
        session,
        device,
        {
          recipientCoinPublicKey: new Uint8Array(32),
          recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
          colourHex: COLOUR,
          amount: 40n,
        },
        undefined,
        test.deps,
      ),
    ).rejects.toThrow('could not confirm it');
    /* It may be on chain: the spent coin stays spent, the change stays filed. */
    expect(isK1NonceSpent(ACCOUNT, NONCE)).toBe(true);
    expect(awaitingK1Coins(ACCOUNT)).toHaveLength(1);
  });

  it('hedges rather than guessing when the finalised data carried no verdict', async () => {
    const test = harness({ circuitResult: changeResult(60n), submitStatus: null });
    const { session, device } = deviceFake();
    putK1Coin(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n, mtIndex: 5n });

    await expect(
      withdrawShieldedK1(
        session,
        device,
        {
          recipientCoinPublicKey: new Uint8Array(32),
          recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
          colourHex: COLOUR,
          amount: 40n,
        },
        undefined,
        test.deps,
      ),
    ).rejects.toThrow('Your payment was sent and this Passport could not confirm it.');

    expect(heldK1Coin(ACCOUNT, COLOUR)?.nonce).toBe(NONCE);
    expect(isK1NonceSpent(ACCOUNT, NONCE)).toBe(false);
  });

  it('promotes the next payment when the spend consumed the coin exactly', async () => {
    const test = harness({ circuitResult: { is_some: false } });
    const { session, device } = deviceFake();
    enqueueK1Coin(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n, mtIndex: 5n });
    enqueueK1Coin(ACCOUNT, { colour: COLOUR, nonce: '4c'.repeat(32), value: 40n, mtIndex: 6n });

    const result = await withdrawShieldedK1(
      session,
      device,
      {
        recipientCoinPublicKey: new Uint8Array(32),
        recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
        colourHex: COLOUR, amount: 100n },
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
      {
        recipientCoinPublicKey: new Uint8Array(32),
        recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
        colourHex: COLOUR, amount: 40n },
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

  /* LIVE, 2026/09/23: half of all shielded sends paid a whole proof on the
     droplet for a wrong guess. The chain's own tree says where the coin is. */
  it('spends at the position the chain lists the coin at, first time', async () => {
    const commitment = 'c0'.repeat(32);
    const test = harness({
      circuitResult: changeResult(60n),
      truePosition: 6n,
      zswapDump: `State {\n    coin_coms: MerkleTree(root = Some(${'00'.repeat(32)})) {\n        0..=4: <collapsed>,\n        5: (${'d1'.repeat(32)}, Some(ContractAddress(${ADDRESS}))),\n        6: (${commitment}, Some(ContractAddress(${ADDRESS}))),\n    },\n}`,
    });
    const { session, device, signed } = deviceFake();
    putK1CoinCandidates(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n }, [5n, 6n]);
    const asked: unknown[] = [];
    const ledger = {
      ZswapOutput: {
        newContractOwned: (coin: unknown, segment: number, contract: string) => {
          asked.push({ coin, segment, contract });
          return { commitment };
        },
      },
    };

    await withdrawShieldedK1(
      session,
      device,
      {
        recipientCoinPublicKey: new Uint8Array(32),
        recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
        colourHex: COLOUR, amount: 40n },
      undefined,
      { ...test.deps, ledger: () => Promise.resolve(ledger as never) },
    );

    /* ONE CALL, ONE SIGNATURE: no proof was spent on the wrong position. */
    expect(test.calls.filter((call) => call.circuit === 'withdraw_shielded_with_k256')).toHaveLength(1);
    expect(signed).toHaveLength(1);
    expect(asked).toEqual([{ coin: { type: COLOUR, nonce: NONCE, value: 100n }, segment: 0, contract: ADDRESS }]);
  });

  it('falls back to the candidate retry when the chain does not list the coin', async () => {
    const test = harness({
      circuitResult: changeResult(60n),
      truePosition: 6n,
      zswapDump: 'State { coin_coms: MerkleTree(root = None) { } }',
    });
    const { session, device } = deviceFake();
    putK1CoinCandidates(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n }, [5n, 6n]);
    const ledger = { ZswapOutput: { newContractOwned: () => ({ commitment: 'c0'.repeat(32) }) } };

    await withdrawShieldedK1(
      session,
      device,
      {
        recipientCoinPublicKey: new Uint8Array(32),
        recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
        colourHex: COLOUR, amount: 40n },
      undefined,
      { ...test.deps, ledger: () => Promise.resolve(ledger as never) },
    );

    expect(test.calls.filter((call) => call.circuit === 'withdraw_shielded_with_k256')).toHaveLength(2);
  });

  it('falls back to the candidate retry when the lookup itself fails', async () => {
    const test = harness({ circuitResult: changeResult(60n), truePosition: 6n, zswapDump: 'unused' });
    const { session, device } = deviceFake();
    putK1CoinCandidates(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n }, [5n, 6n]);

    await withdrawShieldedK1(
      session,
      device,
      {
        recipientCoinPublicKey: new Uint8Array(32),
        recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
        colourHex: COLOUR, amount: 40n },
      undefined,
      { ...test.deps, ledger: () => Promise.reject(new Error('the ledger did not load')) },
    );

    expect(test.calls.filter((call) => call.circuit === 'withdraw_shielded_with_k256')).toHaveLength(2);
  });

  it('does not retry a failure a different position could not fix', async () => {
    const test = harness({ otherFailure: 'The service that finishes this step is not answering.' });
    const { session, device } = deviceFake();
    putK1CoinCandidates(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n }, [5n, 6n]);

    await expect(
      withdrawShieldedK1(
        session,
        device,
        {
        recipientCoinPublicKey: new Uint8Array(32),
        recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
        colourHex: COLOUR, amount: 40n },
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

  it('sweeps around the window ONLY after every reported position has failed', async () => {
    /* Nicolas, 2026/09/18: the rule is candidate retry over the reported
       start/end window, and the sweep is insurance for a coin claimed by a
       grafted intent, which can escape position attribution. So the two
       reported positions go first, in order, and the third attempt is the
       first swept one. */
    const test = harness({ circuitResult: changeResult(60n), positionFailures: 2 });
    const { session, device } = deviceFake();
    putK1CoinCandidates(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n }, [5n, 6n]);

    await withdrawShieldedK1(
      session,
      device,
      {
        recipientCoinPublicKey: new Uint8Array(32),
        recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
        colourHex: COLOUR,
        amount: 40n,
      },
      undefined,
      test.deps,
    );

    /* Three attempts: 5, 6, then the first position the sweep added. */
    expect(
      test.calls.filter((call) => call.circuit === 'withdraw_shielded_with_k256'),
    ).toHaveLength(3);
    /* And the third one proved, so the position is settled and the list is
       gone: a settled position is a fact from then on. */
    expect(k1CoinCandidates(ACCOUNT, COLOUR)).toEqual([]);
  });

  it('gives up with the failure’s own words when every candidate has been tried', async () => {
    const test = harness({ positionFailures: 50 });
    const { session, device } = deviceFake();
    putK1CoinCandidates(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n }, [5n, 6n]);

    await expect(
      withdrawShieldedK1(
        session,
        device,
        {
        recipientCoinPublicKey: new Uint8Array(32),
        recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
        colourHex: COLOUR, amount: 40n },
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
    /* Appended, never substituted: the reported window keeps its place at the
       head of the list, so a later run still starts where the chain's own
       answer put it. */
    expect(k1CoinCandidates(ACCOUNT, COLOUR)).toEqual([5n, 6n, 1n, 2n, 3n, 4n, 7n, 8n, 9n, 10n]);
    expect(isK1NonceSpent(ACCOUNT, NONCE)).toBe(false);
    expect(Object.keys(loadK1CoinStore(ACCOUNT).coins)).toEqual([COLOUR]);
    /* Two reported positions and the eight the sweep adds around them, and not
       one attempt more: the list is what bounds the approvals. */
    expect(test.calls.filter((call) => call.circuit === 'withdraw_shielded_with_k256')).toHaveLength(
      10,
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
        {
        recipientCoinPublicKey: new Uint8Array(32),
        recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
        colourHex: COLOUR, amount: 40n },
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

  /* ---------------------------------------------------------------------- */
  /* THE PROOF BOUNDARY (defect 19, fixed 2026/09/18)                        */
  /*                                                                         */
  /* A spend may be retried while it is still in this tab's own hands and    */
  /* never once a proof has come back, because `submitTx` goes on from there */
  /* to balance and submit. The three drills below fix that line in place.   */
  /* Note what the first two have in common: the SAME words, `RuntimeError:  */
  /* unreachable`, on either side of the proof — one retried, one not. That  */
  /* is the whole point. The old code decided this on the wording and got it */
  /* exactly backwards, so a stale position could not be retried at all.     */
  /* ---------------------------------------------------------------------- */

  it('retries the bare runtime trap a stale position really produces', async () => {
    const test = harness({
      circuitResult: changeResult(60n),
      positionFailures: 1,
      /* NO MERKLE, NO WITNESS, NO WORDS AT ALL — what D1 produced live against
         a coin the chain had moved on from. */
      positionFailureMessage: 'RuntimeError: unreachable',
    });
    const { session, device, signed } = deviceFake();
    putK1CoinCandidates(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n }, [5n, 6n]);

    await withdrawShieldedK1(
      session,
      device,
      {
        recipientCoinPublicKey: new Uint8Array(32),
        recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
        colourHex: COLOUR,
        amount: 40n,
      },
      undefined,
      test.deps,
    );

    /* Two candidates tried, and ONE approval each — not one per failure. */
    expect(test.calls.filter((call) => call.circuit === 'withdraw_shielded_with_k256')).toHaveLength(
      2,
    );
    expect(signed).toHaveLength(2);
    expect(heldK1Coin(ACCOUNT, COLOUR)?.nonce).toBe(CHANGE_NONCE);
  });

  it('never retries a failure raised after the proof came back, whatever it says', async () => {
    const test = harness({
      circuitResult: changeResult(60n),
      /* THE SAME WORDS as the drill above, on the far side of the proof. */
      submitFailure: 'RuntimeError: unreachable',
    });
    const { session, device, signed } = deviceFake();
    putK1CoinCandidates(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n }, [5n, 6n]);

    await expect(
      withdrawShieldedK1(
        session,
        device,
        {
          recipientCoinPublicKey: new Uint8Array(32),
          recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
          colourHex: COLOUR,
          amount: 40n,
        },
        undefined,
        test.deps,
      ),
    ).rejects.toThrow('unreachable');

    /* ONE build and ONE approval. The transaction was proved, so it may be on
       its way; building it again would be a second payment. */
    expect(test.calls.filter((call) => call.circuit === 'withdraw_shielded_with_k256')).toHaveLength(
      1,
    );
    expect(signed).toHaveLength(1);
    /* And the store is left canonical rather than mid-rotation. Nothing was
       written, because the failure came before there was an id to write
       anything under — the transaction was never acknowledged. */
    expect(heldK1Coin(ACCOUNT, COLOUR)?.mtIndex).toBe(5n);
    expect(k1CoinCandidates(ACCOUNT, COLOUR)).toEqual([5n, 6n]);
    expect(awaitingK1Coins(ACCOUNT)).toEqual([]);
  });

  /* ---------------------------------------------------------------------- */
  /* THE WAIT FOR A VERDICT IS NOT THE SUBMISSION (R2)                       */
  /*                                                                         */
  /* `submitTx` is `submitTxAsync` followed by an unbounded wait for         */
  /* finality, so writing only after it returns puts the change coin's ONLY  */
  /* description behind a socket that has dropped twice in this build's      */
  /* history (2026/09/05, 2026/09/07). Split, the id arrives at submission   */
  /* and the write happens there — so a wait that fails loses nothing.       */
  /* ---------------------------------------------------------------------- */

  it('keeps the change and names the transaction when the wait for a verdict fails', async () => {
    const test = harness({
      circuitResult: changeResult(60n),
      /* The shape of a dropped socket: the node took it, the wait did not
         survive long enough to hear what became of it. */
      watchFailure: 'WebSocket is not connected',
    });
    const { session, device, signed } = deviceFake();
    putK1CoinCandidates(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n }, [5n, 6n]);

    const seen: string[] = [];
    await expect(
      withdrawShieldedK1(
        session,
        device,
        {
          recipientCoinPublicKey: new Uint8Array(32),
          recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
          colourHex: COLOUR,
          amount: 40n,
        },
        (phase) => {
          if (phase.txId !== undefined) seen.push(phase.txId);
        },
        test.deps,
      ),
    ).rejects.toThrow('Your payment was sent and this Passport could not confirm it.');

    /* THE DESCRIPTION SURVIVED, which is the whole of the fix: it exists
       nowhere else in the world, and the wait is exactly where it used to be
       lost. The coin is filed under the identifier it was submitted with. */
    expect(awaitingK1Coins(ACCOUNT)).toEqual([
      { colour: COLOUR, nonce: CHANGE_NONCE, value: 60n, txId: 'id-1' },
    ]);
    expect(isK1NonceSpent(ACCOUNT, NONCE)).toBe(true);
    expect(heldK1Coin(ACCOUNT, COLOUR)).toBeNull();
    /* The record names the transaction, so the screen hedges rather than
       telling somebody nothing was sent. */
    expect(seen).toEqual(['id-1']);
    /* And still one approval: the transaction may be away. */
    expect(signed).toHaveLength(1);
    expect(test.watched).toEqual(['id-1']);
  });

  it('restores the head and keeps the list when every candidate has been tried', async () => {
    const test = harness({
      circuitResult: changeResult(60n),
      positionFailures: 99,
      positionFailureMessage: 'RuntimeError: unreachable',
    });
    const { session, device } = deviceFake();
    putK1CoinCandidates(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n }, [5n, 6n]);

    await expect(
      withdrawShieldedK1(
        session,
        device,
        {
          recipientCoinPublicKey: new Uint8Array(32),
          recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
          colourHex: COLOUR,
          amount: 40n,
        },
        undefined,
        test.deps,
      ),
    ).rejects.toThrow('unreachable');

    /* THE HEAD IS THE FIRST POSITION THE CHAIN OFFERED, again. A coin left on
       the last candidate is a coin whose next press starts at the end of the
       list and runs it out after one approval, never trying the position the
       window reported first.

       THE LIST SURVIVES, AND IT IS LONGER THAN IT WAS: exhausting the reported
       window appends the ±4 sweep once, so the next press still has somewhere
       to go. What must NOT have happened is the list being cleared or the head
       being left at the end of it. */
    const candidates = k1CoinCandidates(ACCOUNT, COLOUR);
    expect(heldK1Coin(ACCOUNT, COLOUR)?.mtIndex).toBe(5n);
    expect(candidates[0]).toBe(5n);
    expect(candidates).toContain(6n);
    expect(candidates.length).toBeGreaterThan(2);
    expect(isK1NonceSpent(ACCOUNT, NONCE)).toBe(false);
  });

  /* THE DEFECT (review, 2026/09/18): the rotation is canonical only while the
     run doing it is still running. A press that advanced once and then stopped
     for a reason that was NOT the position — this one, the second approval
     dismissed — left the coin persisted at the second candidate. The next press
     started there, ran the list out after ONE approval, and never tried the
     position the chain offered first: two approvals spent for one payment, and
     the likelier guess untried. */
  it('leaves the coin on the head when somebody dismisses the second approval', async () => {
    const test = harness({ positionFailures: 1 });
    const { session, device } = deviceFake();
    let asks = 0;
    const dismissing: CustodyDynamicSession = {
      ...session,
      signRaw: (request) => {
        asks += 1;
        /* The first approval is given; the second is dismissed. */
        if (asks === 1) return session.signRaw(request);
        return Promise.reject(new Error('You did not approve that.'));
      },
    };
    putK1CoinCandidates(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n }, [5n, 6n]);

    await expect(
      withdrawShieldedK1(
        dismissing,
        device,
        {
        recipientCoinPublicKey: new Uint8Array(32),
        recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
        colourHex: COLOUR, amount: 40n },
        undefined,
        test.deps,
      ),
    ).rejects.toThrow('You did not approve that.');

    expect(asks).toBe(2);
    /* CANONICAL AGAIN: the head is the current guess whenever no spend is in
       flight, so the next press tries the position the chain offered first and
       still has the second to fall back on. */
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
        {
        recipientCoinPublicKey: new Uint8Array(32),
        recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
        colourHex: COLOUR, amount: 40n },
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
        {
        recipientCoinPublicKey: new Uint8Array(32),
        recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
        colourHex: 'not-a-colour', amount: 40n },
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
/* 2026/09/22 — never an unbounded wait, and a booking the chain can undo      */
/* -------------------------------------------------------------------------- */

describe('a payment that cannot wait for ever', () => {
  const NOT_SENT = "That payment didn't go through. Nothing left your Passport.";
  const request = {
    recipientCoinPublicKey: new Uint8Array(32).fill(0x11),
    recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
    colourHex: COLOUR,
    amount: 40n,
  };

  function hold(): void {
    putK1Coin(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n, mtIndex: 5n });
  }

  function send(test: SpendHarness, onPhase?: Parameters<typeof withdrawShieldedK1>[3]) {
    const { session, device } = deviceFake();
    return withdrawShieldedK1(session, device, request, onPhase, test.deps);
  }

  it('books the payment the moment it is balanced, before the node is asked anything', async () => {
    const test = harness({ circuitResult: changeResult(60n), withWallet: true });
    hold();
    const phases: { step: string; txId?: string }[] = [];
    const result = await send(test, (phase) => phases.push({ step: phase.step, txId: phase.txId }));
    /* The record names the transaction at `submit`, while it is still being
       handed over — a tab closed then still knows which one it is owed. */
    expect(phases).toContainEqual({ step: 'submit', txId: 'bal-1' });
    expect(phases).toContainEqual({ step: 'confirm', txId: 'bal-1' });
    expect(test.watched).toEqual(['bal-1']);
    /* Landed: the booking is a fact, and nothing is left to take back. */
    expect(pendingK1Spends(ACCOUNT)).toEqual([]);
    expect(result.change).toEqual(expect.objectContaining({ outcome: 'change', value: 60n }));
  });

  it('is answered within the bound when reading the account never comes back — and nothing was sent', async () => {
    const test = harness({ circuitResult: changeResult(60n), withWallet: true, stateHangs: true });
    test.deps.prepareWaitMs = 5;
    hold();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(send(test)).rejects.toThrow(NOT_SENT);
    expect(test.grafts).toEqual([]);
    expect(heldK1Coin(ACCOUNT, COLOUR)?.nonce).toBe(NONCE);
    expect(pendingK1Spends(ACCOUNT)).toEqual([]);
    warn.mockRestore();
  });

  it('is answered within the bound when the connection never opens', async () => {
    const test = harness({ circuitResult: changeResult(60n) });
    test.deps.prepareWaitMs = 5;
    test.deps.wallet = () => new Promise(() => undefined);
    hold();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(send(test)).rejects.toThrow(NOT_SENT);
    warn.mockRestore();
  });

  it('abandons an attempt not balanced within the bound, and can never hand it over afterwards', async () => {
    const gate = hanging<void>();
    const test = harness({ circuitResult: changeResult(60n), withWallet: true, balanceGate: gate.promise });
    test.deps.handoverWaitMs = 5;
    hold();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(send(test)).rejects.toThrow(NOT_SENT);
    /* The balance answers late; the hook refuses it, so nothing is submitted. */
    gate.release(undefined);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(test.grafts).toEqual([]);
    expect(heldK1Coin(ACCOUNT, COLOUR)?.nonce).toBe(NONCE);
    expect(pendingK1Spends(ACCOUNT)).toEqual([]);
    warn.mockRestore();
  });

  it('builds it again when the node refused it because the account moved, and it lands', async () => {
    const test = harness({ circuitResult: changeResult(60n), withWallet: true, races: 1 });
    hold();
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const result = await send(test);
    expect(test.grafts).toHaveLength(2);
    expect(test.watched).toEqual(['bal-2']);
    expect(result.txHash).not.toBeNull();
    expect(pendingK1Spends(ACCOUNT)).toEqual([]);
    expect(isK1NonceSpent(ACCOUNT, NONCE)).toBe(true);
    info.mockRestore();
  });

  it('builds it again when the sponsor paid its fee from a DUST coin already spent (196), and it lands', async () => {
    const test = harness({ circuitResult: changeResult(60n), withWallet: true, races: 1, raceCode: '196' });
    hold();
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const result = await send(test);
    expect(test.grafts).toHaveLength(2);
    expect(test.watched).toEqual(['bal-2']);
    expect(result.txHash).not.toBeNull();
    expect(isK1NonceSpent(ACCOUNT, NONCE)).toBe(true);
    info.mockRestore();
  });

  /* 2026/09/26: 239 is `NullifierAlreadyPresent` — the coin was already
     spent, by another device that read the same notes. It is a verdict on the
     COIN, so the same payment is never built on it again; it is built on the
     next coin, and the spent one stops being counted. */
  const SECOND_NONCE = '4c'.repeat(32);

  it('forgets a coin the chain says was already spent (239), and says it did not go through', async () => {
    const test = harness({ circuitResult: changeResult(60n), withWallet: true, races: 1, raceCode: '239' });
    hold();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(send(test)).rejects.toThrow(NOT_SENT);
    expect(test.grafts).toHaveLength(1);
    expect(heldK1Coin(ACCOUNT, COLOUR)).toBeNull();
    expect(isK1NonceSpent(ACCOUNT, NONCE)).toBe(true);
    expect(pendingK1Spends(ACCOUNT)).toEqual([]);
    expect(awaitingK1Coins(ACCOUNT)).toEqual([]);
    warn.mockRestore();
  });

  it('builds the payment again on the next coin when the first was already spent, and it lands', async () => {
    const test = harness({ circuitResult: changeResult(60n), withWallet: true, races: 1, raceCode: '239' });
    hold();
    enqueueK1Coin(ACCOUNT, { colour: COLOUR, nonce: SECOND_NONCE, value: 100n, mtIndex: 6n });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const result = await send(test);
    expect(test.calls.filter((call) => call.circuit.startsWith('withdraw_shielded'))).toHaveLength(2);
    expect(test.grafts).toHaveLength(2);
    expect(result.txHash).not.toBeNull();
    /* The first forgotten, the second spent by the payment that landed, and
       what is held now is the payment's change. */
    expect(isK1NonceSpent(ACCOUNT, NONCE)).toBe(true);
    expect(isK1NonceSpent(ACCOUNT, SECOND_NONCE)).toBe(true);
    expect(heldK1Coin(ACCOUNT, COLOUR)?.value).toBe(60n);
    expect(queuedK1Coins(ACCOUNT, COLOUR)).toEqual([]);
    expect(pendingK1Spends(ACCOUNT)).toEqual([]);
    info.mockRestore();
  });

  it('does not move on to a coin that cannot cover the payment', async () => {
    const test = harness({ circuitResult: changeResult(60n), withWallet: true, races: 1, raceCode: '239' });
    hold();
    enqueueK1Coin(ACCOUNT, { colour: COLOUR, nonce: SECOND_NONCE, value: 10n, mtIndex: 6n });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(send(test)).rejects.toThrow(NOT_SENT);
    expect(test.grafts).toHaveLength(1);
    expect(heldK1Coin(ACCOUNT, COLOUR)?.nonce).toBe(SECOND_NONCE);
    expect(isK1NonceSpent(ACCOUNT, SECOND_NONCE)).toBe(false);
    warn.mockRestore();
  });

  it('moves on a bounded number of times however many coins the chain says are spent', async () => {
    const test = harness({ circuitResult: changeResult(60n), withWallet: true, races: 99, raceCode: '239' });
    hold();
    for (let index = 0; index < CUSTODY_SPENT_COIN_RETRIES + 2; index += 1) {
      enqueueK1Coin(ACCOUNT, {
        colour: COLOUR,
        nonce: (index + 0x40).toString(16).repeat(32),
        value: 100n,
        mtIndex: BigInt(10 + index),
      });
    }
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(send(test)).rejects.toThrow(NOT_SENT);
    expect(test.grafts).toHaveLength(CUSTODY_SPENT_COIN_RETRIES + 1);
    /* Each coin the chain named is forgotten; the two it never named are
       still counted. */
    expect(isK1NonceSpent(ACCOUNT, NONCE)).toBe(true);
    expect(heldK1Coin(ACCOUNT, COLOUR)).not.toBeNull();
    expect(queuedK1Coins(ACCOUNT, COLOUR)).toHaveLength(1);
    info.mockRestore();
    warn.mockRestore();
  });

  it('forgets the coin when the refusal came back before anything was booked', async () => {
    const test = harness({ circuitResult: changeResult(60n), races: 1, raceCode: '239' });
    hold();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(send(test)).rejects.toThrow(NOT_SENT);
    expect(heldK1Coin(ACCOUNT, COLOUR)).toBeNull();
    expect(isK1NonceSpent(ACCOUNT, NONCE)).toBe(true);
    warn.mockRestore();
  });

  it('says it did not go through, and gives the coin back, when the account keeps moving', async () => {
    const test = harness({ circuitResult: changeResult(60n), withWallet: true, races: 9 });
    hold();
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(send(test)).rejects.toThrow(NOT_SENT);
    expect(test.grafts).toHaveLength(3);
    expect(heldK1Coin(ACCOUNT, COLOUR)?.nonce).toBe(NONCE);
    expect(isK1NonceSpent(ACCOUNT, NONCE)).toBe(false);
    expect(awaitingK1Coins(ACCOUNT)).toEqual([]);
    expect(undoneK1Spends(ACCOUNT)).toEqual([]);
    info.mockRestore();
    warn.mockRestore();
  });

  it('says it did not go through at once for any other refusal by the node', async () => {
    const test = harness({ circuitResult: changeResult(60n), withWallet: true, submitError: nodeRefusal('231') });
    hold();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(send(test)).rejects.toThrow(NOT_SENT);
    expect(test.grafts).toHaveLength(1);
    expect(heldK1Coin(ACCOUNT, COLOUR)?.nonce).toBe(NONCE);
    warn.mockRestore();
  });

  it('asks the chain, not the socket, when the submit failed after the booking', async () => {
    const test = harness({
      circuitResult: changeResult(60n),
      withWallet: true,
      submitError: new Error('WebSocket is not connected'),
    });
    hold();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await send(test);
    expect(test.watched).toEqual(['bal-1']);
    expect(result.txHash).not.toBeNull();
    warn.mockRestore();
  });

  it('asks the chain, not the socket, when the submit never answers after the booking', async () => {
    const test = harness({ circuitResult: changeResult(60n), withWallet: true, submitHangs: true });
    test.deps.handoverWaitMs = 5;
    hold();
    const result = await send(test);
    expect(test.watched).toEqual(['bal-1']);
    expect(result.txHash).not.toBeNull();
  });

  it('sets the booking aside — not forgotten — when the chain has no such transaction after the wait', async () => {
    const test = harness({
      circuitResult: changeResult(60n),
      withWallet: true,
      neverLands: true,
      outcome: { outcome: 'absent', hash: null },
    });
    hold();
    const released: string[] = [];
    test.deps.releaseWallet = (user) => released.push(user);
    await expect(send(test)).rejects.toThrow(NOT_SENT);
    expect(heldK1Coin(ACCOUNT, COLOUR)?.nonce).toBe(NONCE);
    expect(awaitingK1Coins(ACCOUNT)).toEqual([]);
    expect(undoneK1Spends(ACCOUNT).map((row) => row.txId)).toEqual(['bal-1']);
    expect(released).toHaveLength(1);
  });

  it('reports it sent when the chain holds it though the wait for it ran out', async () => {
    const test = harness({
      circuitResult: changeResult(60n),
      withWallet: true,
      neverLands: true,
      nonceAfter: 4n,
      outcome: { outcome: 'success', hash: 'f0'.repeat(32) },
    });
    hold();
    const result = await send(test);
    expect(result.txHash).toBe('f0'.repeat(32));
    expect(pendingK1Spends(ACCOUNT)).toEqual([]);
    expect(isK1NonceSpent(ACCOUNT, NONCE)).toBe(true);
  });

  it('reports it sent when the chain holds it but named no hash', async () => {
    const test = harness({
      circuitResult: changeResult(60n),
      withWallet: true,
      neverLands: true,
      nonceAfter: 4n,
      outcome: { outcome: 'success', hash: null },
    });
    hold();
    const result = await send(test);
    expect(result.txHash).toBe(chainHashOf('bal-1'));
  });

  it('gives the coin back when the chain says it refused the payment', async () => {
    const test = harness({
      circuitResult: changeResult(60n),
      withWallet: true,
      neverLands: true,
      outcome: { outcome: 'failure', hash: null },
    });
    hold();
    await expect(send(test)).rejects.toThrow('That payment did not go through, and nothing left your Passport.');
    expect(heldK1Coin(ACCOUNT, COLOUR)?.nonce).toBe(NONCE);
    expect(undoneK1Spends(ACCOUNT)).toEqual([]);
  });

  it('keeps the booking and says so when nothing can decide it', async () => {
    const test = harness({ circuitResult: changeResult(60n), withWallet: true, neverLands: true, nonceAfter: 4n });
    hold();
    await expect(send(test)).rejects.toThrow(/could not confirm/);
    expect(pendingK1Spends(ACCOUNT).map((row) => row.txId)).toEqual(['bal-1']);
  });

  it('asks the indexer through its own reader when none is injected, and survives it throwing', async () => {
    const test = harness({ circuitResult: changeResult(60n), withWallet: true, neverLands: true, nonceAfter: 4n });
    test.deps.txOutcome = () => Promise.reject(new Error('indexer down'));
    hold();
    await expect(send(test)).rejects.toThrow(/could not confirm/);
  });

  it('books on the submit’s own answer when the balanced transaction cannot be named', async () => {
    const test = harness({ circuitResult: changeResult(60n), withWallet: true });
    test.deps.identifierOf = () => null;
    hold();
    const result = await send(test);
    expect(test.watched).toEqual(['bal-1']);
    expect(result.txHash).not.toBeNull();
  });

  it('takes this account through the lock every call on it shares', async () => {
    const test = harness({ circuitResult: changeResult(60n) });
    const keys: string[] = [];
    test.deps.accountLock = {
      run: (account, _wait, work) => {
        keys.push(account);
        return work();
      },
    };
    hold();
    await send(test);
    expect(keys).toEqual([`stagenet::${ADDRESS}`]);
  });
});

/* -------------------------------------------------------------------------- */
/* THE SPONSORED REFUSAL (live, 2026/09/21)                                   */
/*                                                                            */
/* The drills above all fail the spend LOCALLY, where the runtime names what   */
/* it could not build. The only route a Passport actually uses fails           */
/* differently: the proving service answers `502 proving-failed` with one      */
/* fixed sentence, because it redacts the proof server's own words on purpose  */
/* — interpolating them would publish its filesystem and its internal          */
/* endpoints to anybody who can post a malformed transaction. The retry used   */
/* to be armed by matching those words, so it could not fire on that route at  */
/* all: the first payment out of a freshly funded Passport stopped on the      */
/* first refusal, with `Public transcript input mismatch` in the proof         */
/* server's log and no "retrying the spend against candidate position" line    */
/* anywhere. These three fix the new rule in place.                            */
/* -------------------------------------------------------------------------- */

describe('a refusal from the proving service', () => {
  /** The deployed sponsor's answer to a proof it will not make, verbatim. */
  const refusal = () =>
    Promise.resolve({
      ok: false,
      status: 502,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            error: 'proving-failed',
            detail: 'The proof server could not prove this transaction.',
          }),
        ),
    } as Response);

  const proven = () =>
    Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ provenTx: 'ab' })),
    } as Response);

  it('retries the next candidate position, and the payment lands on it', async () => {
    const test = harness({ circuitResult: changeResult(60n) });
    const { session, device, signed } = deviceFake();
    putK1CoinCandidates(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n }, [5n, 6n]);

    /* THE FIRST POSITION IS THE WRONG GUESS, which is what the service refuses
       and what its sentence does not say. */
    let asked = 0;
    proveAnswer = () => {
      asked += 1;
      return asked === 1 ? refusal() : proven();
    };

    await withdrawShieldedK1(
      session,
      device,
      {
        recipientCoinPublicKey: new Uint8Array(32),
        recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
        colourHex: COLOUR,
        amount: 40n,
      },
      undefined,
      test.deps,
    );

    /* TWO ATTEMPTS, ONE APPROVAL EACH, and the change coin of the one that
       proved is what the Passport now holds. */
    expect(asked).toBe(2);
    expect(test.calls.filter((call) => call.circuit === 'withdraw_shielded_with_k256')).toHaveLength(
      2,
    );
    expect(signed).toHaveLength(2);
    expect(heldK1Coin(ACCOUNT, COLOUR)?.nonce).toBe(CHANGE_NONCE);
  });

  it('gives up once the window and one sweep of it have been refused', async () => {
    const test = harness({ circuitResult: changeResult(60n) });
    const { session, device } = deviceFake();
    putK1CoinCandidates(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n }, [5n, 6n]);
    proveAnswer = refusal;

    await expect(
      withdrawShieldedK1(
        session,
        device,
        {
          recipientCoinPublicKey: new Uint8Array(32),
          recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
          colourHex: COLOUR,
          amount: 40n,
        },
        undefined,
        test.deps,
      ),
    ).rejects.toThrow(CUSTODY_PROOF_NOT_BUILT);

    /* WHAT BOUNDS THE APPROVALS is the list and nothing else: the two reported
       positions and the eight the sweep adds around them, and not one more —
       so a refusal no position could fix costs the same as it did before. */
    expect(test.calls.filter((call) => call.circuit === 'withdraw_shielded_with_k256')).toHaveLength(
      10,
    );
    /* And the coin is left where the chain's own answer put it, with its list. */
    expect(heldK1Coin(ACCOUNT, COLOUR)?.mtIndex).toBe(5n);
    expect(k1CoinCandidates(ACCOUNT, COLOUR)[0]).toBe(5n);
    expect(isK1NonceSpent(ACCOUNT, NONCE)).toBe(false);
  });

  it('still costs one approval when the service is simply not there', async () => {
    /* `503 prover-unavailable` IS UNTOUCHED, and that is half the rule. The
       service was restarted mid-spend; it looked at no position, so a second
       position would ask for a second approval to learn nothing. */
    const test = harness({ circuitResult: changeResult(60n) });
    const { session, device, signed } = deviceFake();
    putK1CoinCandidates(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 100n }, [5n, 6n]);
    proveAnswer = () =>
      Promise.resolve({
        ok: false,
        status: 503,
        text: () =>
          Promise.resolve(
            JSON.stringify({ error: 'prover-unavailable', detail: 'It is the sponsor.' }),
          ),
      } as Response);

    await expect(
      withdrawShieldedK1(
        session,
        device,
        {
          recipientCoinPublicKey: new Uint8Array(32),
          recipientEncryptionPublicKey: new Uint8Array(32).fill(0xee),
          colourHex: COLOUR,
          amount: 40n,
        },
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
});
