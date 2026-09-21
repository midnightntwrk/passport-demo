import { createRequire } from 'node:module';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A PASSKEY Passport spending, through both doors, against the REAL build.
 *
 * WHY A THIRD SPEND FILE. `custodyContractClient.spend.test.ts` drills the
 * ordering of the writes around a spend — what is on disk while an indexer is
 * being asked — and it does that through a tagging `pureCircuits` fake, which is
 * the right tool for a question about ordering. The question here is a
 * different one and a fake cannot answer it: does the jubjub arm hand the
 * generated ABI the arguments it actually declares? The challenge takes
 * `sig_r` SECOND and `grind_nonce` LAST, the gated circuit takes a FIVE-tuple
 * where the k256 arm takes four, and every one of those is a proof that never
 * verifies rather than an error anybody sees. So the pure circuits below are
 * the compiled build's own, and the signature is checked against the
 * verification equation the circuit itself computes.
 *
 * WHAT IS STILL A SEAM. Everything with a socket on the end: midnight-js's
 * `createUnprovenCallTx` and `submitTx`, the proving service, the indexer. The
 * spend engine between them is the real one — the same function the k256 arm
 * goes through, which is the point of the merge this file belongs to.
 */

import { secp256k1 } from '@noble/curves/secp256k1.js';

import {
  bytesToHex,
  jubjubChallenges,
  K256_ENVELOPE_NONE,
  pointFromUncompressed,
  scalarToBytesBE,
  type CurvePoint,
  type CustodyPureCircuits,
  type K1CallContext,
  type K256DeviceIdentity,
} from './custodyContractSigning.js';
import {
  hexToBytes,
  saveCustodyRecord,
  type CustodyAccountRecord,
  type CustodyStorage,
} from './custodyContractPlan.js';
import { jubjubDeviceSigner } from './custodyJubjubSigner.js';
import { generateCustodyEncKeyPair, openCustodyInboxEntry } from './custodyInbox.js';
import { heldK1Coin, putK1Coin, putK1CoinCandidates, type K1Account } from './k1CoinStore.js';
import {
  appendChangeToInboxK1,
  custodyUserKey,
  resetCustodySessionState,
  withdrawShieldedK1,
  withdrawShieldedToContractK1,
  type CustodyDeps,
  type CustodyDynamicSession,
  type CustodyPasskeyDevice,
} from './custodyContractClient.js';

/** The indexer walk that names the chain's hash, as the sibling file mocks it. */
vi.mock('./contractRuntime.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./contractRuntime.js')>()),
  resolveTransactionHash: (_indexer: string, identifier: string) =>
    Promise.resolve(identifier.replace(/[^0-9a-f]/gi, '').padEnd(64, 'c').slice(0, 64)),
}));

/* -------------------------------------------------------------------------- */
/* The real build                                                             */
/* -------------------------------------------------------------------------- */

interface JubjubPoint {
  readonly x: bigint;
  readonly y: bigint;
}

/** The three curve operations the circuit's own verification equation is made of. */
interface FixtureRuntime {
  ecAdd(a: JubjubPoint, b: JubjubPoint): JubjubPoint;
  ecMul(a: JubjubPoint, b: bigint): JubjubPoint;
  ecMulGenerator(b: bigint): JubjubPoint;
}

const requireFromTest = createRequire(import.meta.url);
const contractPath = requireFromTest.resolve(
  '../../contracts/stagenet/account-custody/contract/index.js',
);
const compiled = requireFromTest(contractPath) as { pureCircuits: CustodyPureCircuits };

/** The real `pureCircuits`, which satisfies {@link CustodyPureCircuits} structurally. */
const pure: CustodyPureCircuits = compiled.pureCircuits;

/* By NODE, from the contract's own directory, so the contract and the runtime it
   is decoded against are resolved by one resolver and cannot be two copies. */
const runtime = createRequire(contractPath)('@midnight-ntwrk/compact-runtime') as FixtureRuntime;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const ADDRESS = 'ab'.repeat(32);
const PEER = 'cd'.repeat(32);
const COLOUR = '1a'.repeat(32);
const NONCE = '7f'.repeat(32);
const CHANGE_NONCE = 'a1'.repeat(32);
const SENT_NONCE = 'b2'.repeat(32);
const ACCOUNT: K1Account = { network: 'stagenet', address: ADDRESS };

/** The recipient's coin public key, for the address door. */
const RECIPIENT_COIN_PK = new Uint8Array(32).fill(0x4d);
const RECIPIENT_ENC_PK = new Uint8Array(32).fill(0x5e);

/** The recipient's advertised encryption key, as the composed door asks for it. */
const PEER_ENC_KEY = 'ab'.repeat(32);

/**
 * A reader of that key that counts how many times it was asked, and can be
 * made to answer something different from one call to the next.
 *
 * COUNTED, because the whole of A6 is WHEN the key is read: the engine must
 * ask at seal time, not take a value the screen read before the approval and
 * the proof. A reader that answers a second key on its second call is a
 * recipient rotating theirs inside that window.
 */
function encKeyReader(...answers: string[]): (() => Promise<string>) & { reads: number } {
  const reader = (): Promise<string> => {
    const answer = answers[reader.reads] ?? answers[answers.length - 1] ?? PEER_ENC_KEY;
    reader.reads += 1;
    return Promise.resolve(answer);
  };
  reader.reads = 0;
  return reader;
}

/** A device scalar. Fixed rather than derived: the derivation is drilled next door. */
const DEVICE_SCALAR = 0x51ee_2a3b_9c4d_7e18n;

/** The passkey's device: a signer, which is what makes it a CALL device. */
function passkeyDevice(): CustodyPasskeyDevice & {
  sign: ReturnType<typeof jubjubDeviceSigner>['sign'];
} {
  return jubjubDeviceSigner({ pure, secretScalar: DEVICE_SCALAR });
}

/**
 * A Dynamic device, for the one drill that asks whether the two arms still
 * choose different circuits out of the same engine.
 */
function dynamicDevice(): { session: CustodyDynamicSession; device: K256DeviceIdentity } {
  const secret = scalarToBytesBE(12345678901234567890n);
  const point = pointFromUncompressed(secp256k1.getPublicKey(secret, false));
  return {
    session: {
      address: '0xAbCdEf0000000000000000000000000000000001',
      signRaw: ({ message }) => {
        const recovered = secp256k1.sign(hexToBytes(message), secret, {
          prehash: false,
          format: 'recovered',
        });
        const r = bytesToHex(recovered.subarray(1, 33));
        const s = bytesToHex(recovered.subarray(33, 65));
        const v = (recovered[0] + 27).toString(16).padStart(2, '0');
        return Promise.resolve(`0x${r}${s}${v}`);
      },
    },
    device: { arm: 'k256', pk: point, envelope: K256_ENVELOPE_NONE },
  };
}

function storageFake(): CustodyStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

interface ChainFake {
  /** How many spends fail the way a wrong position fails, before one lands. */
  positionFailures?: number;
  /**
   * How many times the RECIPIENT'S CLAIM fails to build, before one does.
   *
   * The same trap, one step later — and the step matters here, because the
   * seal happens between the two. A retry from this point is a retry that has
   * already asked the recipient for their key once.
   */
  claimFailures?: number;
  /**
   * Whether `addIntent` quietly attaches nothing.
   *
   * A build that returned the transaction unchanged is the shape the silent
   * `?? sender` fallback was written for, and the shape that ends in a
   * transaction which spends the sender's coin and pays nobody.
   */
  graftDoesNothing?: boolean;
  /** What a wrong position says. The live shape is a bare WASM trap. */
  positionFailure?: () => Error;
}

/** An unproven call, with the two members a graft needs. */
interface FakeCallTx {
  readonly circuit: string;
  readonly args: readonly unknown[];
  readonly serialize: () => Uint8Array;
  readonly grafted: readonly unknown[];
  readonly intents: Map<number, unknown>;
  addIntent(segment: { tag: string }, intent: unknown): FakeCallTx;
}

function harness(chain: ChainFake = {}) {
  const storage = storageFake();
  const device = passkeyDevice();
  const user = custodyUserKey(null, device);
  const record: CustodyAccountRecord = {
    user,
    network: 'stagenet',
    address: ADDRESS,
    privateStateId: `passport-account-custody-stagenet-${ADDRESS}`,
    saltHex: '11'.repeat(32),
    pkXHex: device.pk.x.toString(16),
    pkYHex: device.pk.y.toString(16),
    wavesDone: 3,
    totalWaves: 3,
    activated: true,
    txHashes: [],
  };
  saveCustodyRecord(storage, record);

  const calls: { circuit: string; args: unknown[]; options?: unknown }[] = [];
  const grafts: number[] = [];
  /** Every circuit list the proving service was told to stage. */
  const staged: string[][] = [];
  let submitted = 0;

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
        if (chain.graftDoesNothing === true) return make(grafted, intents);
        const next = new Map(intents);
        next.set(next.size, intent);
        return make([...grafted, intent], next);
      },
    });
    return make([], new Map([[0, { intentFor: circuit }]]));
  };

  /* THE SPEND'S OWN RESULT. `withdraw_shielded_*` answers an option holding the
     change; `withdraw_shielded_to_contract_*` answers the PAIR — the coin the
     recipient will claim, and that same option — which is what the composed
     door reads to build the claim from. */
  const spendResult = (circuit: string): unknown => {
    const change = {
      is_some: true,
      value: { nonce: hexToBytes(CHANGE_NONCE), color: hexToBytes(COLOUR), value: 6n },
    };
    if (!circuit.startsWith('withdraw_shielded_to_contract')) return change;
    return [{ nonce: hexToBytes(SENT_NONCE), color: hexToBytes(COLOUR), value: 4n }, change];
  };

  const createUnprovenCallTx = (_providers: unknown, callOptions: unknown) => {
    const { circuitId, args, contractAddress } = callOptions as {
      circuitId: string;
      args: unknown[];
      contractAddress: string;
    };
    calls.push({ circuit: circuitId, args, options: callOptions });
    if (circuitId === 'deposit_shielded' && (chain.claimFailures ?? 0) > 0) {
      chain.claimFailures = (chain.claimFailures ?? 0) - 1;
      const trap = new Error('unreachable');
      trap.name = 'RuntimeError';
      return Promise.reject(trap);
    }
    if (circuitId.startsWith('withdraw_shielded') && (chain.positionFailures ?? 0) > 0) {
      chain.positionFailures = (chain.positionFailures ?? 0) - 1;
      /* THE LIVE SHAPE: `name` is `RuntimeError` and `message` is the single
         word `unreachable`. Nothing in the message identifies it, which is the
         defect of 2026/09/18 and why the predicate reads the name too. */
      const trap = chain.positionFailure?.() ?? new Error('unreachable');
      if (chain.positionFailure === undefined) trap.name = 'RuntimeError';
      return Promise.reject(trap);
    }
    void contractAddress;
    return Promise.resolve({
      private: {
        result: circuitId === 'deposit_shielded' ? null : spendResult(circuitId),
        unprovenTx: unprovenCall(circuitId, args),
        nextPrivateState: { coins: {} },
      },
    });
  };

  const submitTxAsync = async (submitProviders: unknown, submitOptions: unknown) => {
    const { unprovenTx, circuitId } = submitOptions as {
      unprovenTx: FakeCallTx;
      circuitId: string[];
    };
    staged.push([...circuitId]);
    const prover = (
      submitProviders as { proofProvider?: { proveTx(tx: unknown): Promise<unknown> } }
    ).proofProvider;
    if (prover) await prover.proveTx(unprovenTx);
    grafts.push(unprovenTx.grafted.length);
    submitted += 1;
    return `id-${submitted}`;
  };

  /* The chain's verdict, asked for separately — as the real pair are. */
  const watchForTxData = (txId: string) => Promise.resolve({ txId, status: 'SucceedEntirely' });

  const submitTx = async (submitProviders: unknown, submitOptions: unknown) =>
    watchForTxData(await submitTxAsync(submitProviders, submitOptions));

  const providers: Record<string, unknown> = {
    publicDataProvider: {
      queryContractState: () =>
        Promise.resolve({ data: 'state', serialize: () => new Uint8Array([1]) }),
      watchForTxData,
    },
    privateStateProvider: {
      setContractAddress: () => undefined,
      setSigningKey: () => Promise.resolve(undefined),
      getSigningKey: () => Promise.resolve('the-signing-key'),
      set: () => Promise.resolve(undefined),
    },
    compiledContract: { label: 'passport-account-custody' },
    indexerHttpUrl: 'https://indexer.example/api/v4/graphql',
  };

  const deps: Partial<CustodyDeps> = {
    storage: () => storage,
    randomBytes: (length) => new Uint8Array(length).fill(7),
    wallet: () =>
      Promise.resolve({
        network: { networkId: 'stagenet', indexerHttpUrl: 'https://indexer.example/api/v4/graphql' },
      } as never),
    contractModule: () =>
      Promise.resolve({
        /* THE REAL ONES. Everything this file exists for. */
        pureCircuits: pure,
        Contract: class {},
        ledger: () => ({
          auth_nonce: 3n,
          device_epoch: 0n,
          device_count: 1n,
          booted: true,
          devices: { member: () => true },
        }),
      }),
    providers: () => Promise.resolve(providers),
    contracts: () =>
      Promise.resolve({
        createUnprovenDeployTx: () => Promise.reject(new Error('not used here')),
        createUnprovenCallTx,
        submitTx,
        submitTxAsync,
        /* THE GATED CALL THAT IS NOT A SPEND. `append_inbox` composes nothing,
           so it still goes through midnight-js's own `callTx` — which is the
           path the backfill takes. */
        findDeployedContract: () =>
          Promise.resolve({
            callTx: new Proxy(
              {},
              {
                get: (_target, circuit: string) => (...args: unknown[]) => {
                  calls.push({ circuit, args });
                  submitted += 1;
                  return Promise.resolve({
                    public: { txId: `id-${submitted}` },
                    private: { result: null, nextPrivateState: { coins: {} } },
                  });
                },
              },
            ),
          }),
      } as never),
    resolveChainHash: () => Promise.resolve(null),
    commitmentWindow: () => Promise.resolve({ startIndex: 8, endIndex: 10 }),
    now: () => 1_700_000_000_000,
    sleep: () => Promise.resolve(undefined),
  };

  return { deps, storage, calls, grafts, staged, chain, device, record };
}

/** The coin this Passport is spending, at a position the store is sure of. */
function seedCoin(position = 3n): void {
  putK1Coin(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 10n, mtIndex: position });
}

/** The same coin, with its position still a guess out of a reported window. */
function seedCandidates(candidates: readonly bigint[] = [3n, 4n]): void {
  putK1CoinCandidates(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 10n }, candidates);
}

/**
 * The verification equation the circuit itself computes: `s·G == R + c·pk`.
 *
 * `c` is the challenge read as a little-endian field element, which is how the
 * contract reads the bytes its own `challenge_…` circuit returned.
 */
function signatureVerifies(
  challenge: Uint8Array,
  pk: CurvePoint,
  sigR: CurvePoint,
  sigS: bigint,
): boolean {
  let c = 0n;
  for (let i = challenge.length - 1; i >= 0; i--) c = (c << 8n) | BigInt(challenge[i]);
  /* A CHALLENGE THE GRIND NEVER ACCEPTED IS NOT ONE THIS SIGNATURE IS FOR, and
     the runtime says so by refusing the scalar outright rather than by
     answering a different point. That refusal is a false, not an error: it is
     the same verification failing, one step earlier. */
  try {
    const left = runtime.ecMulGenerator(sigS);
    const right = runtime.ecAdd(sigR, runtime.ecMul(pk, c));
    return left.x === right.x && left.y === right.y;
  } catch {
    return false;
  }
}

beforeEach(() => {
  resetCustodySessionState();
  vi.stubGlobal('fetch', () =>
    Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ provenTx: 'ab' })),
    } as Response),
  );
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
/* The address door                                                           */
/* -------------------------------------------------------------------------- */

describe('a passkey Passport pays a shielded address', () => {
  it('calls the arm’s own circuit with the five-tuple the generated ABI takes', async () => {
    const run = harness();
    seedCoin();

    const result = await withdrawShieldedK1(
      null,
      run.device,
      {
        recipientCoinPublicKey: RECIPIENT_COIN_PK,
        recipientEncryptionPublicKey: RECIPIENT_ENC_PK,
        colourHex: COLOUR,
        amount: 4n,
      },
      undefined,
      run.deps,
    );

    const call = run.calls[run.calls.length - 1];
    expect(call.circuit).toBe('withdraw_shielded_with_jubjub');
    /* `(recipient, colour, amount)` and then the arm's trailer: five, not the
       k256 arm's four, and `grind_nonce` last. */
    expect(call.args).toHaveLength(8);
    const [recipient, colour, amount, pk, useCounter, sigR, sigS, grindNonce] = call.args;
    expect(recipient).toEqual({ bytes: RECIPIENT_COIN_PK });
    expect(colour).toEqual(hexToBytes(COLOUR));
    expect(amount).toBe(4n);
    expect(pk).toEqual(run.device.pk);
    expect(useCounter).toBe(0n);
    expect(typeof sigS).toBe('bigint');
    expect(typeof grindNonce).toBe('bigint');

    /* AND IT VERIFIES, against the challenge the contract would rebuild from
       the arguments it was handed. */
    const context: K1CallContext = { contractAddress: hexToBytes(ADDRESS), authNonce: 3n };
    const builder = jubjubChallenges.withdrawShielded(
      pure,
      context,
      run.device.pk,
      RECIPIENT_COIN_PK,
      hexToBytes(COLOUR),
      4n,
      { nonce: hexToBytes(NONCE), color: hexToBytes(COLOUR), value: 10n, mt_index: 3n },
    );
    expect(
      signatureVerifies(
        builder(sigR as CurvePoint, grindNonce as bigint),
        run.device.pk,
        sigR as CurvePoint,
        sigS as bigint,
      ),
    ).toBe(true);

    /* ONE CALL AND ONE TRANSACTION: the address door composes nothing. */
    expect(run.grafts).toEqual([0]);
    expect(run.staged).toEqual([['withdraw_shielded_with_jubjub']]);
    expect(result.sent).toBeNull();
  });

  it('hands midnight-js the recipient’s encryption key, so a wallet can find the coin', async () => {
    const run = harness();
    seedCoin();

    await withdrawShieldedK1(
      null,
      run.device,
      {
        recipientCoinPublicKey: RECIPIENT_COIN_PK,
        recipientEncryptionPublicKey: RECIPIENT_ENC_PK,
        colourHex: COLOUR,
        amount: 4n,
      },
      undefined,
      run.deps,
    );

    const options = run.calls[run.calls.length - 1].options as {
      additionalCoinEncPublicKeyMappings?: Map<string, string>;
    };
    expect(options.additionalCoinEncPublicKeyMappings?.get(bytesToHex(RECIPIENT_COIN_PK))).toBe(
      bytesToHex(RECIPIENT_ENC_PK),
    );
  });

  it('keeps the change it was handed, and the coin it spent is gone', async () => {
    const run = harness();
    seedCoin();

    const result = await withdrawShieldedK1(
      null,
      run.device,
      {
        recipientCoinPublicKey: RECIPIENT_COIN_PK,
        recipientEncryptionPublicKey: RECIPIENT_ENC_PK,
        colourHex: COLOUR,
        amount: 4n,
      },
      undefined,
      run.deps,
    );

    expect(result.change).toMatchObject({ value: 6n, nonce: CHANGE_NONCE });
    expect(heldK1Coin(ACCOUNT, COLOUR)?.nonce).toBe(CHANGE_NONCE);
  });
});

/* -------------------------------------------------------------------------- */
/* The composed door                                                          */
/* -------------------------------------------------------------------------- */

describe('a passkey Passport pays another one of these accounts', () => {
  it('builds ONE transaction carrying the gated spend and the recipient’s claim', async () => {
    const run = harness();
    seedCoin();

    const result = await withdrawShieldedToContractK1(
      null,
      run.device,
      {
        recipientAccountAddress: PEER,
        readRecipientEncKey: encKeyReader(),
        colourHex: COLOUR,
        amount: 4n,
      },
      undefined,
      run.deps,
    );

    /* TWO CALLS BUILT, ONE TRANSACTION SUBMITTED. The claim is grafted onto the
       spend rather than merged with it (MIP-0012 §6.6). */
    expect(run.calls.map((call) => call.circuit)).toEqual([
      'withdraw_shielded_to_contract_with_jubjub',
      'deposit_shielded',
    ]);
    expect(run.grafts).toEqual([1]);
    /* AND BOTH ARE STAGED, so the proving service has the keys for the pair. */
    expect(run.staged).toEqual([
      ['withdraw_shielded_to_contract_with_jubjub', 'deposit_shielded'],
    ]);
    expect(result.sent).toMatchObject({ value: 4n, nonce: SENT_NONCE });
  });

  /* A6, 2026/09/18. The key the coin is sealed to used to be read by the
     SCREEN, before the approval and before the proof — on the passkey arm,
     before a person walked to their phone. `rotate_enc_key` is one of this
     account's circuits, so a recipient rotating inside that window got a
     payment sealed to a key they had already replaced: the money arrives, and
     nobody can describe it again for as long as it exists. */
  it('seals to the key the recipient advertises at seal time, not at setup', async () => {
    const run = harness();
    seedCoin();

    const stale = generateCustodyEncKeyPair();
    const current = generateCustodyEncKeyPair();
    /* The recipient rotates between the payment being set up and the seal. */
    const reader = encKeyReader(current.publicKeyHex);

    await withdrawShieldedToContractK1(
      null,
      run.device,
      {
        recipientAccountAddress: PEER,
        readRecipientEncKey: reader,
        colourHex: COLOUR,
        amount: 4n,
      },
      undefined,
      run.deps,
    );

    /* ASKED ONCE, and asked by the engine rather than handed a value. */
    expect(reader.reads).toBe(1);

    const claim = run.calls.find((call) => call.circuit === 'deposit_shielded');
    const entry = claim?.args[1] as Uint8Array;
    /* THE RECIPIENT CAN OPEN IT with the key they hold now… */
    await expect(openCustodyInboxEntry(current.secretKeyHex, entry)).resolves.toMatchObject({
      nonce: SENT_NONCE,
      value: 4n,
    });
    /* …and the key they had before opens nothing, which is what the defect
       would have left them with. */
    await expect(openCustodyInboxEntry(stale.secretKeyHex, entry)).resolves.toBeNull();
  });

  it('asks the recipient again for every attempt, because a retry is another window', async () => {
    const run = harness({ claimFailures: 1 });
    putK1CoinCandidates(ACCOUNT, { colour: COLOUR, nonce: NONCE, value: 10n }, [3n, 4n]);

    const reader = encKeyReader();
    await withdrawShieldedToContractK1(
      null,
      run.device,
      {
        recipientAccountAddress: PEER,
        readRecipientEncKey: reader,
        colourHex: COLOUR,
        amount: 4n,
      },
      undefined,
      run.deps,
    );

    expect(
      run.calls.filter((call) => call.circuit === 'withdraw_shielded_to_contract_with_jubjub'),
    ).toHaveLength(2);
    expect(reader.reads).toBe(2);
  });

  /* A8, 2026/09/18. `addIntent` used to fall back to the ungrafted transaction
     when a build returned nothing — the defensive read the deploy waves make of
     `addDeploy`. The two are not alike: a deploy that loses its addition fails
     at the node, and a SPEND that loses its graft is a perfectly valid
     transaction that spends the sender's coin, addresses the output to the
     recipient's contract, and carries neither the claim that takes it nor the
     entry that describes it. Nothing downstream can notice, because it
     succeeds. */
  it('refuses to send a payment whose claim did not attach', async () => {
    const run = harness({ graftDoesNothing: true });
    seedCoin();

    await expect(
      withdrawShieldedToContractK1(
        null,
        run.device,
        {
          recipientAccountAddress: PEER,
          readRecipientEncKey: encKeyReader(),
          colourHex: COLOUR,
          amount: 4n,
        },
        undefined,
        run.deps,
      ),
    ).rejects.toThrow('This Passport could not prepare that payment. Nothing was sent.');

    /* NOTHING WAS SUBMITTED, so the coin is exactly where it was. */
    expect(run.grafts).toEqual([]);
    expect(heldK1Coin(ACCOUNT, COLOUR)?.nonce).toBe(NONCE);
  });

  it('signs the direct transfer’s own challenge, which is not the address door’s', async () => {
    const run = harness();
    seedCoin();

    await withdrawShieldedToContractK1(
      null,
      run.device,
      {
        recipientAccountAddress: PEER,
        readRecipientEncKey: encKeyReader(),
        colourHex: COLOUR,
        amount: 4n,
      },
      undefined,
      run.deps,
    );

    const spend = run.calls[0];
    const [recipient, , , , , sigR, sigS, grindNonce] = spend.args;
    expect(recipient).toEqual({ bytes: hexToBytes(PEER) });

    const context: K1CallContext = { contractAddress: hexToBytes(ADDRESS), authNonce: 3n };
    const coin = {
      nonce: hexToBytes(NONCE),
      color: hexToBytes(COLOUR),
      value: 10n,
      mt_index: 3n,
    };
    const direct = jubjubChallenges.withdrawShieldedToContract(
      pure,
      context,
      run.device.pk,
      hexToBytes(PEER),
      hexToBytes(COLOUR),
      4n,
      coin,
    )(sigR as CurvePoint, grindNonce as bigint);
    expect(signatureVerifies(direct, run.device.pk, sigR as CurvePoint, sigS as bigint)).toBe(true);

    /* THE TAGS DIFFER, which is the whole reason the contract has two circuits:
       32 bytes of recipient is 32 bytes of recipient, so a signature over the
       address door must never be replayable as a transfer to a contract. */
    const asAddress = jubjubChallenges.withdrawShielded(
      pure,
      context,
      run.device.pk,
      hexToBytes(PEER),
      hexToBytes(COLOUR),
      4n,
      coin,
    )(sigR as CurvePoint, grindNonce as bigint);
    expect(bytesToHex(asAddress)).not.toBe(bytesToHex(direct));
    expect(signatureVerifies(asAddress, run.device.pk, sigR as CurvePoint, sigS as bigint)).toBe(
      false,
    );
  });

  it('serves the recipient’s claim NO private state of ours', async () => {
    const run = harness();
    seedCoin();

    await withdrawShieldedToContractK1(
      null,
      run.device,
      {
        recipientAccountAddress: PEER,
        readRecipientEncKey: encKeyReader(),
        colourHex: COLOUR,
        amount: 4n,
      },
      undefined,
      run.deps,
    );

    const claim = run.calls[1].options as { privateStateId?: string; contractAddress: string };
    expect(claim.contractAddress).toBe(PEER);
    expect(claim.privateStateId).toBeUndefined();
  });

  it('chooses the k256 circuit for a social sign-in out of the same engine', async () => {
    const run = harness();
    seedCoin();
    const dynamic = dynamicDevice();
    /* The same account, re-filed under the address the k256 arm names it by. */
    saveCustodyRecord(run.storage, { ...run.record, user: dynamic.session.address.toLowerCase() });

    await withdrawShieldedToContractK1(
      dynamic.session,
      dynamic.device,
      {
        recipientAccountAddress: PEER,
        readRecipientEncKey: encKeyReader(),
        colourHex: COLOUR,
        amount: 4n,
      },
      undefined,
      run.deps,
    );

    expect(run.calls[0].circuit).toBe('withdraw_shielded_to_contract_with_k256');
    /* Four, not five: `(pk, use_counter, sig, envelope)`. */
    expect(run.calls[0].args).toHaveLength(7);
  });
});

/* -------------------------------------------------------------------------- */
/* The retry, on this arm                                                     */
/* -------------------------------------------------------------------------- */

describe('a passkey spend against a position that may be the wrong one', () => {
  it('rebuilds the challenge for the next candidate and signs it again', async () => {
    const run = harness({ positionFailures: 1 });
    seedCandidates();

    const result = await withdrawShieldedK1(
      null,
      run.device,
      {
        recipientCoinPublicKey: RECIPIENT_COIN_PK,
        recipientEncryptionPublicKey: RECIPIENT_ENC_PK,
        colourHex: COLOUR,
        amount: 4n,
      },
      undefined,
      run.deps,
    );

    expect(run.calls).toHaveLength(2);
    expect(result.candidate).toBe(1);

    /* THE SECOND ATTEMPT IS A SECOND SIGNATURE, not the first one replayed:
       the coin's position is inside the challenge (AUTH-10), so a retry that
       reused the signature would be signing for a coin it is not spending. */
    const [first, second] = run.calls;
    expect(first.args[6]).not.toEqual(second.args[6]);

    const context: K1CallContext = { contractAddress: hexToBytes(ADDRESS), authNonce: 3n };
    const builder = jubjubChallenges.withdrawShielded(
      pure,
      context,
      run.device.pk,
      RECIPIENT_COIN_PK,
      hexToBytes(COLOUR),
      4n,
      /* Position FOUR — the second candidate, which is what the retry moved to. */
      { nonce: hexToBytes(NONCE), color: hexToBytes(COLOUR), value: 10n, mt_index: 4n },
    );
    expect(
      signatureVerifies(
        builder(second.args[5] as CurvePoint, second.args[7] as bigint),
        run.device.pk,
        second.args[5] as CurvePoint,
        second.args[6] as bigint,
      ),
    ).toBe(true);
  });

  it('retries the composed door too, and still submits one transaction', async () => {
    const run = harness({ positionFailures: 1 });
    seedCandidates();

    await withdrawShieldedToContractK1(
      null,
      run.device,
      {
        recipientAccountAddress: PEER,
        readRecipientEncKey: encKeyReader(),
        colourHex: COLOUR,
        amount: 4n,
      },
      undefined,
      run.deps,
    );

    /* The trapped attempt, then the spend and the claim that landed. */
    expect(run.calls.map((call) => call.circuit)).toEqual([
      'withdraw_shielded_to_contract_with_jubjub',
      'withdraw_shielded_to_contract_with_jubjub',
      'deposit_shielded',
    ]);
    expect(run.grafts).toEqual([1]);
  });

  it('gives up with the failure’s own words once the candidates run out', async () => {
    const run = harness({ positionFailures: 99 });
    /* Two candidates, and the sweep widens around the head only after both. */
    seedCandidates([3n, 4n]);

    await expect(
      withdrawShieldedK1(
        null,
        run.device,
        {
          recipientCoinPublicKey: RECIPIENT_COIN_PK,
          recipientEncryptionPublicKey: RECIPIENT_ENC_PK,
          colourHex: COLOUR,
          amount: 4n,
        },
        undefined,
        run.deps,
      ),
    ).rejects.toThrow('unreachable');

    /* AND THE COIN IS BACK ON ITS HEAD. A store left mid-rotation is a Passport
       whose next press starts at the second candidate and never tries the one
       the chain offered first. */
    expect(heldK1Coin(ACCOUNT, COLOUR)?.mtIndex).toBe(3n);
  });

  it('does not retry a failure a different position could not fix', async () => {
    const run = harness({
      positionFailures: 1,
      positionFailure: () => new Error('the sponsor is not answering'),
    });
    seedCandidates();

    await expect(
      withdrawShieldedK1(
        null,
        run.device,
        {
          recipientCoinPublicKey: RECIPIENT_COIN_PK,
          recipientEncryptionPublicKey: RECIPIENT_ENC_PK,
          colourHex: COLOUR,
          amount: 4n,
        },
        undefined,
        run.deps,
      ),
    ).rejects.toThrow('the sponsor is not answering');
    expect(run.calls).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* The backfill                                                               */
/* -------------------------------------------------------------------------- */

describe('the change backfill, on the passkey arm', () => {
  it('writes the entry with the arm’s own gated circuit', async () => {
    const run = harness();

    const result = await appendChangeToInboxK1(
      null,
      run.device,
      {
        change: { outcome: 'change', colour: COLOUR, nonce: CHANGE_NONCE, value: 6n },
        ownEncKeyHex: 'ab'.repeat(32),
      },
      undefined,
      run.deps,
    );

    expect(result).not.toBeNull();
    const call = run.calls[run.calls.length - 1];
    expect(call.circuit).toBe('append_inbox_with_jubjub');
    /* `(entry)` and the five-tuple. */
    expect(call.args).toHaveLength(6);
    expect((call.args[0] as Uint8Array).length).toBe(192);

    const context: K1CallContext = { contractAddress: hexToBytes(ADDRESS), authNonce: 3n };
    const builder = jubjubChallenges.appendInbox(
      pure,
      context,
      run.device.pk,
      call.args[0] as Uint8Array,
    );
    expect(
      signatureVerifies(
        builder(call.args[3] as CurvePoint, call.args[5] as bigint),
        run.device.pk,
        call.args[3] as CurvePoint,
        call.args[4] as bigint,
      ),
    ).toBe(true);
  });

  it('skips rather than fails when there is nothing to describe', async () => {
    const run = harness();

    const result = await appendChangeToInboxK1(
      null,
      run.device,
      { change: { outcome: 'change', colour: COLOUR, nonce: CHANGE_NONCE, value: 6n }, ownEncKeyHex: null },
      undefined,
      run.deps,
    );

    expect(result).toBeNull();
    expect(run.calls).toHaveLength(0);
  });
});
