/**
 * The network half of the account custody layer: a Dynamic Passport, deployed,
 * activated, and called, on a contract whose device is an embedded EVM key.
 *
 * WHAT THIS IS (2026/09/16)
 * -------------------------
 * `custodyContractSigning.ts` is the signing boundary and knows no sockets.
 * `custodyContractPlan.ts` is the decisions and knows no sockets either. This module
 * is everything with a socket on the end of it, for exactly one flow:
 *
 *   sign in with Dynamic → deploy a custody account in three sponsored waves →
 *   activate the Dynamic key as the account's first device →
 *   make one k256-gated call the contract verifies.
 *
 * That flow was proved end to end on stagenet on 2026/09/16 by the reference
 * client (`contract/src/wallet/account.ts` on the retired repository):
 * `activate_initial_device_with_k256` at block 490985 and
 * `append_inbox_with_k256` at block 490999, both SUCCESS, `device_count 1` and
 * `auth_nonce 0 → 1`. This module is that flow rewritten for a browser, against
 * this app's own sponsor, wallet, and providers.
 *
 * THE THING THAT MAKES IT DIFFERENT FROM `accountCustody.ts`
 * ---------------------------------------------------------
 * Three things, and each of them is why this is a sibling rather than an
 * option on the existing one:
 *
 * 1. PROVING IS SERVER-SIDE, AND HAS TO BE. The account custody build's prover keys are
 *    3.2 GB — 224 MB per k256 circuit. `httpClientProofProvider`, which is what
 *    every other module in this app proves through, uploads the prover key with
 *    every request. A browser can neither hold one nor upload one, so the route
 *    PR #58 opened (`VITE_MIDNIGHT_PROVING_URL_V3` → a proof server) cannot
 *    carry this traffic however healthy that server is. {@link custodyProofProvider}
 *    posts the SERIALISED TRANSACTION to a service that already holds the keys
 *    and gets a proven transaction back. See `custodyContractPlan.ts` for the
 *    endpoint and why it hangs off the sponsor's origin.
 *
 * 2. A DEPLOY IS THREE TRANSACTIONS, NOT ONE. Thirteen circuits fit a block and
 *    this contract has thirty, so the roster is deployed in waves: the deposits
 *    plus the whole k256 arm in the deploy itself, then the rest by two signed
 *    maintenance updates, the last of which retires the maintenance authority.
 *    A Passport's setup therefore has a middle, and a reload during it has
 *    somewhere to resume from — which is what {@link CustodyAccountRecord} is for.
 *
 * 3. THERE IS NO PASSKEY AND NO SECRET OF OUR OWN. A Dynamic-only Passport's
 *    authority is the key inside Dynamic's MPC, which never leaves it. The
 *    Midnight wallet here exists only to CONSTRUCT transactions — the account
 *    holds the value — so it is built from a random per-device seed remembered
 *    against the Dynamic user, and it never needs funds because every fee comes
 *    from the sponsor.
 *
 * WHAT IS STUBBED, AND SAID OUT LOUD
 * ----------------------------------
 * `POST /prove-account-custody` does not exist yet. Until it does, every path that needs a
 * proof fails with ONE PLAIN SENTENCE and a console line naming the endpoint —
 * never a hang, which is what an unreachable proof server would otherwise give
 * you after ten minutes of `PROOF_TIMEOUT_MS`.
 *
 * The `held_coin` witness REFUSES. The shielded coin store is PR 4 of the
 * design doc's sequence and no branch this module reaches invokes the witness:
 * `activate_initial_device_with_k256` and `append_inbox_with_k256` declare no
 * witness at all. A refusing witness is the honest shape — a witness that
 * returned a zero coin would let a shielded spend build a transaction the node
 * then rejects for a reason that names none of this.
 *
 * WHY THE SEAMS ARE INJECTED
 * --------------------------
 * Every function below takes an optional `Partial<CustodyDeps>`. That is the idiom
 * `accountUpgrade.ts` established and it is here for the same reason: the real
 * dependencies are a 9.84 MB ledger WASM bundle, a wallet, an indexer, and a
 * vendor SDK, and a machine with four ordered steps and a resume rule has to be
 * drillable without any of them.
 */

import {
  authArgs,
  bytesToHex,
  dynamicK256Signer,
  envelopeDigest,
  K256_ENVELOPE_NONE,
  parseEvmSignature,
  pointFromUncompressed,
  type CurvePoint,
  type DynamicSignRawMessage,
  type K1CallContext,
  type CustodyPureCircuits,
  type K256Authorisation,
  type K256DeviceIdentity,
  k256Challenges,
  deviceEntry,
  bootCommitment,
} from './custodyContractSigning.js';
import {
  allCustodyCircuits,
  forgetCustodyAuthorityKey,
  hexToBytes,
  k1EnrolmentChallenges,
  custodyExplorerLink,
  custodyProvingEndpoint,
  k1SamePoint,
  custodyWaveIsOnChain,
  K1_ENROLMENT_UNCONFIRMED,
  CUSTODY_PROOF_TIMEOUT_MS,
  CUSTODY_PROVER_UNAVAILABLE,
  CUSTODY_SETUP_INTERRUPTED,
  loadCustodyAuthorityKey,
  loadCustodyRecord,
  newCustodyRecord,
  nextCustodyStep,
  parseProveCustodyResponse,
  describeProveAccountCustodyFailure,
  planCustodyWaves,
  proveAccountCustodyRequest,
  removeCustodyRecord,
  resolveCustodyUseCounter,
  saveCustodyAuthorityKey,
  saveCustodyRecord,
  type CustodyAccountRecord,
  type CustodyStorage,
  type CustodyWave,
} from './custodyContractPlan.js';
import {
  compiledContractFor,
  createContractProviders,
  loadContractModule,
  messageOf,
  resolveTransactionHash,
  transactionId,
} from './contractRuntime.js';
import { createLocalMidnightWallet, type LocalMidnightWallet } from '../lib/localWallet.js';
import { sponsorConfig } from '../lib/sponsor.js';

/* -------------------------------------------------------------------------- */
/* The Dynamic session, as this module needs it                               */
/* -------------------------------------------------------------------------- */

/**
 * Who is signed in and how to make them sign — and NOTHING from
 * `@dynamic-labs`, which `src/lib/dynamicBundle.test.ts` forbids on the entry
 * graph and which this module must therefore never name.
 *
 * `signRaw` is handed in by the caller, from inside the lazily-loaded Dynamic
 * boundary in `src/lib/dynamic.tsx`. It takes 64 lower-case hex characters with
 * no `0x` and returns `0x` + `r‖s‖v`.
 */
export interface CustodyDynamicSession {
  /** `primaryWallet.address`. The per-user key, and what `signRaw` addresses. */
  readonly address: string;
  readonly signRaw: DynamicSignRawMessage;
}

/** The per-user key. One Dynamic user has one embedded key. */
export function k1UserKey(session: Pick<CustodyDynamicSession, 'address'>): string {
  return session.address.toLowerCase();
}

/* -------------------------------------------------------------------------- */
/* The seams                                                                  */
/* -------------------------------------------------------------------------- */

/** How far along a step the caller is told it has got. */
export interface CustodyPhase {
  readonly step: 'wallet' | 'deploy' | 'waves' | 'activate' | 'sign' | 'submit' | 'confirm';
  readonly detail?: string;
}

/** Everything this module reaches for that a drill wants to replace. */
export interface CustodyDeps {
  storage(): CustodyStorage;
  randomBytes(length: number): Uint8Array;
  /** The wallet this Dynamic user's transactions are constructed with. */
  wallet(user: string): Promise<LocalMidnightWallet>;
  /** The compiled `account-custody` module, for its pure circuits and its ABI. */
  contractModule(): Promise<CustodyContractModule>;
  /** Providers, with this module's own proof provider already substituted in. */
  providers(
    wallet: LocalMidnightWallet,
    privateStateId: string,
  ): Promise<Record<string, unknown>>;
  /** The ledger primitives the wave deploy builds transactions out of. */
  ledger(): Promise<CustodyLedgerApi>;
  /** midnight-js's deploy and call entry points. */
  contracts(): Promise<CustodyContractsApi>;
  now(): number;
  sleep(milliseconds: number): Promise<void>;
}

/** The parts of the compiled build this module uses. */
export interface CustodyContractModule {
  readonly pureCircuits: CustodyPureCircuits;
  readonly Contract: unknown;
  ledger(state: unknown): CustodyLedger;
}

/** The ledger fields a gated call reads. */
export interface CustodyLedger {
  readonly auth_nonce: bigint;
  readonly device_epoch: bigint;
  readonly device_count: bigint;
  readonly booted: boolean;
  readonly devices: { member(entry: Uint8Array): boolean };
}

/** The ledger-v9 constructors the wave deploy needs, named rather than `any`. */
export interface CustodyLedgerApi {
  ContractState: (new () => CustodyContractState) & { deserialize(raw: Uint8Array): CustodyContractState };
  ContractDeploy: new (state: CustodyContractState) => { address: unknown };
  ContractMaintenanceAuthority: new (
    committee: unknown[],
    threshold: number,
    counter: bigint,
  ) => unknown;
  ContractOperationVersionedVerifierKey: new (version: string, key: Uint8Array) => unknown;
  Intent: { new: (ttl: Date) => CustodyIntent };
  MaintenanceUpdate: new (
    address: string,
    updates: unknown[],
    counter: bigint,
  ) => { dataToSign: Uint8Array; addSignature(index: bigint, signature: unknown): unknown };
  ReplaceAuthority: new (authority: unknown) => unknown;
  Transaction: {
    fromParts(
      networkId: string,
      guaranteed: undefined,
      fallible: undefined,
      intent: unknown,
    ): unknown;
  };
  VerifierKeyInsert: new (circuit: string, key: unknown) => unknown;
  signData(key: unknown, data: Uint8Array): unknown;
  networkId(): string;
}

/** A contract state with the two fields the wave-1 pruning copies across. */
export interface CustodyContractState {
  data: unknown;
  maintenanceAuthority: { counter: bigint };
  operation(circuit: string): unknown;
  setOperation(circuit: string, operation: unknown): void;
  serialize(): Uint8Array;
}

interface CustodyIntent {
  addDeploy(deploy: unknown): unknown;
  addMaintenanceUpdate(update: unknown): unknown;
}

/** midnight-js's two entry points, as this module calls them. */
export interface CustodyContractsApi {
  createUnprovenDeployTx(providers: unknown, options: unknown): Promise<CustodyDeployTxData>;
  submitTx(providers: unknown, options: unknown): Promise<unknown>;
  findDeployedContract(providers: unknown, options: unknown): Promise<{ callTx: CustodyCallTx }>;
}

/** What `createUnprovenDeployTx` hands back, narrowed to what is used here. */
export interface CustodyDeployTxData {
  public: { initialContractState: { serialize(): Uint8Array } };
  private: { signingKey: unknown; initialPrivateState: unknown };
}

type CustodyCallTx = Record<string, (...args: unknown[]) => Promise<unknown>>;

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** The contract module name, and the artefact tree PR #58 staged for it. */
export const ACCOUNT_CUSTODY_CONTRACT = 'account-custody' as const;

/**
 * The compiled-contract label — the namespace `FetchZkConfigProvider` composes
 * artefact URLs from. NOT `passport-account`: that is the prototype's tree, and
 * a account custody build asking for it would fetch keys for circuits that do not exist.
 */
export const ACCOUNT_CUSTODY_LABEL = 'passport-account-custody';

/** How long a custody transaction has to be included. The sponsored default. */
export const CUSTODY_TX_TTL_MS = 30 * 60 * 1000;

/**
 * How long the authority counter is waited on between waves.
 *
 * A maintenance update that has been included but not yet read back leaves the
 * next wave building against a stale counter, which the node rejects. The
 * reference waits for the counter to advance; so does this.
 */
export const CUSTODY_AUTHORITY_WAIT_MS = 120_000;
const CUSTODY_AUTHORITY_POLL_MS = 2_000;

/** `localStorage` key for the per-device wallet seeds. */
export const CUSTODY_SEED_KEY = 'passport-account-custody-seed:v1';

/** The digest the device signs once, at enrolment, so its point can be recovered. */
export const K1_ENROLMENT_MESSAGE = 'midnight-passport:k1-device-enrolment:v1';

/* -------------------------------------------------------------------------- */
/* The server proof provider                                                  */
/* -------------------------------------------------------------------------- */

/** What {@link custodyProofProvider} needs that is not the transaction. */
export interface CustodyProofProviderOptions {
  /** `POST` target. From `custodyContractPlan.ts`'s {@link custodyProvingEndpoint}. */
  readonly endpoint: string;
  readonly network: string;
  /** The circuit being proved, for the service to pick the right key. */
  readonly circuit: string;
  /** Rehydrates the proven bytes. Injected so a drill needs no ledger WASM. */
  readonly deserialise: (bytes: Uint8Array) => unknown;
  readonly fetchFn?: typeof fetch;
  /** Overridable so a drill does not wait four minutes to watch one expire. */
  readonly timeoutMs?: number;
}

/**
 * A `ProofProvider` that proves somewhere else.
 *
 * `proveTx` takes an `UnprovenTransaction` — `Transaction<SignatureEnabled,
 * PreProof, PreBinding>` — and must return an `UnboundTransaction`, the same
 * transaction with `Proof` in place of `PreProof` and its binding still
 * pre-bound, because it is `walletProvider.balanceTx` that binds. So the wire
 * carries `serialize()` in one direction and
 * `Transaction.deserialize('signature', 'proof', 'pre-binding', …)` in the
 * other, and the three marker strings are the whole contract.
 *
 * IT DOES NOT HANG, AND THE ABORT IS WHAT MAKES THAT TRUE. A proof server
 * behind `httpClientProofProvider` fails after `PROOF_TIMEOUT_MS`, which is ten
 * minutes of a spinner. `fetch` on its own fails after nothing at all: a socket
 * to a box that has stopped answering without closing it stays open until the
 * operating system gives up, and on a phone that is minutes with no screen to
 * read. So every request carries {@link CUSTODY_PROOF_TIMEOUT_MS} of
 * `AbortSignal.timeout`, above the service's own 180-second deadline so that a
 * slow proof still comes back as the service's own answer rather than as this.
 * An abort lands in the same `catch` as a refused connection and reads as the
 * same sentence, which is the right reading: from the person's side the service
 * did not answer.
 */
export function custodyProofProvider(options: CustodyProofProviderOptions): {
  proveTx(unprovenTx: { serialize(): Uint8Array }): Promise<unknown>;
} {
  const fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? CUSTODY_PROOF_TIMEOUT_MS;
  return {
    async proveTx(unprovenTx: { serialize(): Uint8Array }): Promise<unknown> {
      const body = proveAccountCustodyRequest(options.circuit, unprovenTx.serialize(), options.network);
      let response: Response;
      try {
        response = await fetchFn(options.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        console.warn(
          `[account-custody] could not reach the proving service at ${options.endpoint} for ${options.circuit}`,
          cause,
        );
        throw new Error(CUSTODY_PROVER_UNAVAILABLE);
      }
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      if (!response.ok) {
        console.warn(describeProveAccountCustodyFailure(response.status, parsed), text.slice(0, 400));
        throw new Error(CUSTODY_PROVER_UNAVAILABLE);
      }
      return options.deserialise(parseProveCustodyResponse(parsed));
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The per-user wallet                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The seed this Dynamic user's transactions are constructed with, made once and
 * remembered.
 *
 * NOT DERIVED FROM ANYTHING DYNAMIC HOLDS, and it does not need to be. The
 * account contract holds the value and the Dynamic key is what authorises
 * moving it; this wallet only assembles transactions and pays nothing, because
 * the sponsor pays. A fresh random seed per device is therefore the correct
 * shape rather than a compromise — it means losing it costs a resync and
 * nothing else.
 */
export function custodyWalletSeed(deps: CustodyDeps, user: string): Uint8Array {
  const storage = deps.storage();
  let seeds: Record<string, string> = {};
  try {
    const raw = storage.getItem(CUSTODY_SEED_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        seeds = parsed as Record<string, string>;
      }
    }
  } catch {
    seeds = {};
  }
  const existing = seeds[user];
  if (typeof existing === 'string' && existing.length === 64) return hexToBytes(existing);

  const seed = deps.randomBytes(32);
  seeds[user] = bytesToHex(seed);
  try {
    storage.setItem(CUSTODY_SEED_KEY, JSON.stringify(seeds));
  } catch (cause) {
    console.warn('[account-custody] could not remember this device key; the next visit resyncs', cause);
  }
  return seed;
}

/* -------------------------------------------------------------------------- */
/* Recovering the device's public point                                       */
/* -------------------------------------------------------------------------- */

/**
 * The secp256k1 point behind a Dynamic address.
 *
 * DYNAMIC EXPORTS NO KEY AND NO POINT. `@dynamic-labs/waas-evm` offers
 * `signRawMessage` and an address, and an Ethereum address is the tail of a
 * keccak hash of the point — it cannot be run backwards. So the point is
 * RECOVERED from a signature, once, using the recovery byte `parseEvmSignature`
 * keeps, and cached against the address from then on. Recovering it per call
 * would mean a signature before every signature that matters.
 *
 * The curve arithmetic is the contract's own — `compute_public_point_with_k256`
 * is exported for exactly this reason — but recovery is not a circuit, so it
 * goes through the injected `recover`. `custodyContractSigning.test.ts` already establishes
 * that `@noble/curves` is a TEST dependency here and never a `src` one; this
 * signature is what keeps that true.
 *
 * TWO SIGNATURES, AND THE POINT HAS TO SURVIVE BOTH. Recovery never fails: it
 * is arithmetic, and a recovery byte that does not match the signature it
 * arrives with simply yields a DIFFERENT point, silently. That shape is not
 * hypothetical — a signer that normalises S to the low form without flipping
 * `v` to match produces it on every signature it makes — and the point it
 * yields is one the key cannot sign for, so the account would be activated
 * around a device that can never authorise anything. Recovering the point from
 * a second, distinct challenge and requiring the two to agree is what rules
 * that out; see {@link k1EnrolmentChallenges} for the whole argument and for
 * what is, and is not, yet known about the live vendor's output.
 */
export async function recoverK1DevicePoint(options: {
  session: CustodyDynamicSession;
  /** `(digest, r, s, v) -> uncompressed SEC1 bytes`, injected by the caller. */
  recover: (
    digest: Uint8Array,
    r: bigint,
    s: bigint,
    v: number,
  ) => Uint8Array | Promise<Uint8Array>;
  message?: string;
}): Promise<CurvePoint> {
  const [first, second] = k1EnrolmentChallenges(options.message ?? K1_ENROLMENT_MESSAGE);
  const claimed = await recoverOnce(options, first);
  const confirming = await recoverOnce(options, second);
  if (!k1SamePoint(claimed, confirming)) {
    console.warn(
      '[account-custody] the two enrolment signatures recovered different points; the recovery byte ' +
        'or the signature does not match the key that is signing',
    );
    throw new Error(K1_ENROLMENT_UNCONFIRMED);
  }
  return claimed;
}

/** One challenge: hash it, have it signed, recover the point behind it. */
async function recoverOnce(
  options: {
    session: CustodyDynamicSession;
    recover: (
      digest: Uint8Array,
      r: bigint,
      s: bigint,
      v: number,
    ) => Uint8Array | Promise<Uint8Array>;
  },
  message: string,
): Promise<CurvePoint> {
  const challenge = new TextEncoder().encode(message);
  const digest = await envelopeDigest(K256_ENVELOPE_NONE, await sha256(challenge));
  const raw = await options.session.signRaw({
    accountAddress: options.session.address,
    message: bytesToHex(digest),
  });
  /* `parseEvmSignature` takes all four dialects of the recovery byte — 0, 1,
     27, 28 — and hands back 0 or 1, so nothing downstream has to ask which one
     the vendor speaks. It also refuses anything else outright. */
  const parsed = parseEvmSignature(raw);
  try {
    return pointFromUncompressed(await options.recover(digest, parsed.r, parsed.s, parsed.v));
  } catch (cause) {
    /* Recovery USUALLY succeeds and lands somewhere wrong, which is what the
       second challenge is for. Sometimes it fails outright instead — a
       tampered `r` names an x with no square root on the curve — and a curve
       library's own words for that ("bad point: is not on curve, sqrt error")
       are not something to put in front of a person. */
    console.warn('[account-custody] the enrolment signature did not yield a point', cause);
    throw new Error(K1_ENROLMENT_UNCONFIRMED);
  }
}

/** SHA-256 through WebCrypto, the way every other hash in this app is taken. */
async function sha256(payload: Uint8Array): Promise<Uint8Array> {
  const buffer = await globalThis.crypto.subtle.digest('SHA-256', payload as BufferSource);
  return new Uint8Array(buffer);
}

/* -------------------------------------------------------------------------- */
/* The deploy, in waves                                                       */
/* -------------------------------------------------------------------------- */

/** What a deploy or a call reports back. */
export interface CustodyStepResult {
  readonly record: CustodyAccountRecord;
  /** The chain hash, when one was resolved, and the explorer link for it. */
  readonly txHash: string | null;
  readonly explorerUrl: string | null;
}

/**
 * Deploy a custody account for this Dynamic user, resuming whatever is already done.
 *
 * THE CHAIN IS CHECKED BEFORE EVERY STEP, not the record — the same rule
 * `accountUpgrade.ts` keeps. The record says where we think we got to; the
 * OPERATIONS THE CONTRACT CARRIES say where we actually did, and when they
 * disagree the chain wins, in both directions:
 *
 *   a wave that landed but whose write was lost to a closed tab is SKIPPED
 *   rather than replayed into a rejection the sponsor has already paid for;
 *
 *   a wave that was recorded but never landed — a submission dropped by the
 *   node, a tab closed after `saveCustodyRecord` and before the transaction was
 *   included — is RE-SUBMITTED rather than skipped, which matters more: the
 *   last wave retires the maintenance authority, so ten circuits missed here
 *   are ten circuits nothing can ever add.
 *
 * And a record is written only once the chain has shown the wave applied. The
 * previous order wrote first and waited afterwards, which is what made the
 * second case reachable at all.
 *
 * Three transactions, and all three sponsored: the deploy carries the deposits
 * and the whole k256 arm — which is what makes the account activatable and
 * callable after the first one — and two maintenance updates carry the other
 * twenty verifier keys, the last of them retiring the maintenance authority.
 */
export async function deployCustodyAccount(
  session: CustodyDynamicSession,
  device: K256DeviceIdentity,
  onPhase?: (phase: CustodyPhase) => void,
  overrides: Partial<CustodyDeps> = {},
): Promise<CustodyStepResult> {
  const deps = withDefaults(overrides);
  const user = k1UserKey(session);
  onPhase?.({ step: 'wallet' });
  const wallet = await deps.wallet(user);
  const network = wallet.network.networkId;
  const storage = deps.storage();

  let record =
    loadCustodyRecord(storage, user, network) ??
    newCustodyRecord({
      user,
      network,
      privateStateId: `passport-account-custody-${user.slice(2, 10)}`,
      saltHex: bytesToHex(deps.randomBytes(32)),
      totalWaves: 3,
    });
  /* TERMINAL, AND NOT A STEP TO OFFER AGAIN. The key that signs the remaining
     waves is gone; the account on chain cannot be completed by anybody. The
     only move is `startCustodyAccountAgain`, which is what the screen offers. */
  if (record.interrupted === true) throw new Error(CUSTODY_SETUP_INTERRUPTED);

  const [module, ledgerApi, contracts] = await Promise.all([
    deps.contractModule(),
    deps.ledger(),
    deps.contracts(),
  ]);

  const providers = await deps.providers(wallet, record.privateStateId);
  const verifierKeys = await readVerifierKeys(providers, module);
  const sizes = new Map([...verifierKeys].map(([id, key]) => [id, key.length]));
  const waves = planCustodyWaves(sizes, 'k256');
  record = { ...record, totalWaves: waves.length };

  /* What the chain already carries, read ONCE before any wave runs. Null means
     there is nothing at that address — either no deploy yet, or a deploy that
     was recorded and never landed — and both answers are the same wave. */
  let onChain =
    record.address === null
      ? null
      : await readCustodyChainOperations(providers, ledgerApi, record.address, waves);

  if (onChain === null) {
    onPhase?.({ step: 'deploy', detail: `1 of ${waves.length}` });
    record = await runWaveOne({
      deps,
      record,
      device,
      wave: waves[0],
      module,
      ledgerApi,
      contracts,
      providers,
      storage,
    });
    onChain = new Set(waves[0].circuits);
  }

  for (const wave of waves.slice(1)) {
    if (custodyWaveIsOnChain(wave, onChain)) {
      /* On chain but not in the record: the write was lost, not the wave. Catch
         the record up rather than paying for the same update twice. */
      if (record.wavesDone < wave.index) {
        record = { ...record, wavesDone: wave.index };
        saveCustodyRecord(storage, record);
      }
      continue;
    }
    onPhase?.({ step: 'waves', detail: `${wave.index} of ${waves.length}` });
    record = await runMaintenanceWave({
      deps,
      record,
      wave,
      verifierKeys,
      ledgerApi,
      providers,
      storage,
    });
  }

  const txHash = record.txHashes[record.txHashes.length - 1] ?? null;
  return { record, txHash, explorerUrl: txHash ? custodyExplorerLink(txHash, network) : null };
}

/** Every circuit's verifier key, read off the staged artefacts. */
async function readVerifierKeys(
  providers: Record<string, unknown>,
  _module: CustodyContractModule,
): Promise<Map<string, Uint8Array>> {
  const zk = providers.zkConfigProvider as {
    getVerifierKey(circuit: string): Promise<Uint8Array | null>;
  };
  const keys = new Map<string, Uint8Array>();
  for (const circuit of allCustodyCircuits('k256')) {
    const key = await zk.getVerifierKey(circuit);
    if (!key) {
      throw new Error(
        'The pieces this kind of Passport needs are not part of this build yet.',
      );
    }
    keys.set(circuit, key);
  }
  return keys;
}

/**
 * The operations a deployed account already carries, or null when there is
 * nothing at that address.
 *
 * ONLY THE PLAN'S OWN CIRCUITS ARE PROBED, not the whole roster: a wave is
 * skipped on the strength of this, so what it needs to answer is "is every
 * circuit of wave N present", and asking about thirty operations to decide
 * about twenty is work with no reader.
 *
 * A read that fails is NOT an empty answer. `queryState` throws its own plain
 * sentence, and that is the right outcome: an indexer that cannot be reached
 * must not be read as "the chain has nothing", which would redeploy an account
 * that already exists.
 */
async function readCustodyChainOperations(
  providers: Record<string, unknown>,
  ledgerApi: CustodyLedgerApi,
  address: string,
  waves: readonly CustodyWave[],
): Promise<Set<string> | null> {
  const reader = providers.publicDataProvider as {
    queryContractState(address: string): Promise<{ serialize(): Uint8Array } | null>;
  };
  const state = await reader.queryContractState(address);
  if (!state) return null;
  const ledgerState = ledgerApi.ContractState.deserialize(state.serialize());
  const present = new Set<string>();
  for (const wave of waves) {
    for (const circuit of wave.circuits) {
      if (ledgerState.operation(circuit)) present.add(circuit);
    }
  }
  return present;
}

interface WaveContext {
  deps: CustodyDeps;
  record: CustodyAccountRecord;
  ledgerApi: CustodyLedgerApi;
  providers: Record<string, unknown>;
  storage: CustodyStorage;
}

/**
 * Wave 1: the constructor's state, pruned to ten operations, deployed.
 *
 * NOT `deployContract` AND NOT THE DEPLOY `createUnprovenDeployTx` BUILDS.
 * That transaction carries all thirty operations and can never be included —
 * the ledger's own fee computation refuses it before the node sees it. What is
 * kept from it is the state the constructor produced and the maintenance
 * authority; the transaction itself is discarded and a `ContractDeploy` is
 * built by hand over a state carrying only this wave's operations.
 */
async function runWaveOne(
  context: WaveContext & {
    device: K256DeviceIdentity;
    wave: CustodyWave;
    module: CustodyContractModule;
    contracts: CustodyContractsApi;
  },
): Promise<CustodyAccountRecord> {
  const { deps, ledgerApi, providers, storage, module, contracts, wave } = context;
  const salt = hexToBytes(context.record.saltHex);
  const boot = bootCommitment(module.pureCircuits, context.device, salt);
  /* The account's X25519 viewing key. The inbox is sealed to it, and the
     secret half belongs in the private coin store — which is PR 4. For this
     milestone the public half is generated and advertised so the constructor's
     shape is the real one; nothing this flow does reads the inbox back. */
  const encryptionKey = deps.randomBytes(32);

  const deployData = await contracts.createUnprovenDeployTx(providers, {
    compiledContract: providers.compiledContract,
    privateStateId: context.record.privateStateId,
    initialPrivateState: custodyPrivateState(),
    args: [boot, encryptionKey],
  });

  const full = ledgerApi.ContractState.deserialize(
    deployData.public.initialContractState.serialize(),
  );
  const wave1 = buildWaveOneState(ledgerApi, full, wave);

  const deploy = new ledgerApi.ContractDeploy(wave1);
  const address = String(deploy.address);
  const intent = ledgerApi.Intent.new(new Date(deps.now() + CUSTODY_TX_TTL_MS));
  intent.addDeploy(deploy);
  const unprovenTx = ledgerApi.Transaction.fromParts(
    ledgerApi.networkId(),
    undefined,
    undefined,
    intent,
  );

  const result = await contracts.submitTx(providers, { unprovenTx });
  const txHash = await resolveHash(context.providers, result);

  const signingKey = deployData.private.signingKey;
  const priv = providers.privateStateProvider as {
    setContractAddress?(address: string): void;
    setSigningKey(address: string, key: unknown): Promise<void>;
    set(id: string, state: unknown): Promise<void>;
  };
  priv.setContractAddress?.(address);
  await priv.setSigningKey(address, signingKey);
  await priv.set(context.record.privateStateId, deployData.private.initialPrivateState);
  rememberSigningKey(storage, address, signingKey);

  const next: CustodyAccountRecord = {
    ...context.record,
    address,
    wavesDone: 1,
    txHashes: txHash ? [...context.record.txHashes, txHash] : context.record.txHashes,
  };
  saveCustodyRecord(storage, next);
  return next;
}

/**
 * A state carrying this wave's operations and nothing else.
 *
 * `ContractState` has no "remove operation", so the wave-1 state is a NEW one
 * with the constructor's data and authority copied across and only the wave's
 * operations set on it. That is the reference's shape and it is the only one
 * available: a state built any other way either carries all thirty operations
 * or loses the ledger the constructor wrote.
 */
function buildWaveOneState(
  ledgerApi: CustodyLedgerApi,
  full: CustodyContractState,
  wave: CustodyWave,
): CustodyContractState {
  const fresh = new ledgerApi.ContractState();
  fresh.data = full.data;
  fresh.maintenanceAuthority = full.maintenanceAuthority;
  for (const circuit of wave.circuits) {
    const operation = full.operation(circuit);
    if (!operation) throw new Error(`the compiled build has no operation '${circuit}'`);
    fresh.setOperation(circuit, operation);
  }
  return fresh;
}

/**
 * One maintenance update: ten verifier keys, and on the last wave the
 * retirement of the authority that could replace them.
 *
 * `'v4'` IS LOAD-BEARING. `compact-js` hardcodes `'v3'`, whose raw keys carry a
 * `midnight:verifier-key[v6]:` header, and `compactc 0.33.0-rc.2` emits v7-headed
 * keys — which is why midnight-js's own per-circuit maintenance API cannot be
 * used here and the update is assembled by hand.
 *
 * The retirement's counter is `counter + 1`: the replacement authority carries
 * the counter its own application will expect, one past the counter the update
 * it rides on was built against.
 */
async function runMaintenanceWave(
  context: WaveContext & { wave: CustodyWave; verifierKeys: ReadonlyMap<string, Uint8Array> },
): Promise<CustodyAccountRecord> {
  const { deps, ledgerApi, providers, storage, wave, verifierKeys } = context;
  const address = context.record.address as string;
  const counter = await authorityCounter(providers, ledgerApi, address);

  const updates: unknown[] = wave.circuits.map((circuit) => {
    const key = verifierKeys.get(circuit);
    if (!key) throw new Error(`no verifier key for '${circuit}'`);
    return new ledgerApi.VerifierKeyInsert(
      circuit,
      new ledgerApi.ContractOperationVersionedVerifierKey('v4', key),
    );
  });
  if (wave.retiresAuthority) {
    updates.push(
      new ledgerApi.ReplaceAuthority(
        new ledgerApi.ContractMaintenanceAuthority([], 1, counter + 1n),
      ),
    );
  }

  const signingKey = await signingKeyFor(providers, storage, address);
  if (signingKey === null) {
    /* The account exists, its authority is live, and the key that drives it is
       gone. Nothing later can finish it, so the record says so ONCE and every
       entry point refuses from here rather than offering a step that cannot
       work. The screen offers starting again instead. */
    saveCustodyRecord(storage, { ...context.record, interrupted: true });
    throw new Error(CUSTODY_SETUP_INTERRUPTED);
  }
  const bare = new ledgerApi.MaintenanceUpdate(address, updates, counter);
  const signed = bare.addSignature(0n, ledgerApi.signData(signingKey, bare.dataToSign));
  const intent = ledgerApi.Intent.new(new Date(deps.now() + CUSTODY_TX_TTL_MS));
  intent.addMaintenanceUpdate(signed);
  const unprovenTx = ledgerApi.Transaction.fromParts(
    ledgerApi.networkId(),
    undefined,
    undefined,
    intent,
  );

  const contracts = await deps.contracts();
  const result = await contracts.submitTx(providers, { unprovenTx });
  const txHash = await resolveHash(providers, result);

  /* THE WAIT COMES FIRST, AND THE WRITE AFTER IT. A submission that is accepted
     is not a wave that landed: it can still be dropped, and the counter is what
     says otherwise. Recording the wave before the counter moved is what made a
     dropped update look finished, and a finished-looking wave 3 is an account
     missing ten circuits with a retired authority and no way to add them. If
     the wait times out the record is untouched, so the next attempt reads the
     chain and re-submits. */
  await awaitAuthorityCounter(deps, providers, ledgerApi, address, counter + 1n);

  const next: CustodyAccountRecord = {
    ...context.record,
    wavesDone: wave.index,
    txHashes: txHash ? [...context.record.txHashes, txHash] : context.record.txHashes,
  };
  saveCustodyRecord(storage, next);
  /* The retirement landed with this update: the key authorises nothing from
     here, so it is deleted rather than left in a browser for ever. */
  if (wave.retiresAuthority) forgetCustodyAuthorityKey(storage, address);
  return next;
}

/** The maintenance authority's counter, read off the chain. */
async function authorityCounter(
  providers: Record<string, unknown>,
  ledgerApi: CustodyLedgerApi,
  address: string,
): Promise<bigint> {
  const state = await queryState(providers, address);
  return ledgerApi.ContractState.deserialize(state.serialize()).maintenanceAuthority.counter;
}

/**
 * Wait until the counter the next wave will build against is the one the chain
 * agrees with.
 *
 * Without this the next wave is built against a stale counter and the node
 * rejects it — after a sponsored fee has been booked for it.
 */
async function awaitAuthorityCounter(
  deps: CustodyDeps,
  providers: Record<string, unknown>,
  ledgerApi: CustodyLedgerApi,
  address: string,
  expected: bigint,
): Promise<void> {
  const deadline = deps.now() + CUSTODY_AUTHORITY_WAIT_MS;
  for (;;) {
    const seen = await authorityCounter(providers, ledgerApi, address);
    if (seen >= expected) return;
    if (deps.now() >= deadline) {
      throw new Error('Setting up your Passport is taking longer than expected. Try again.');
    }
    await deps.sleep(CUSTODY_AUTHORITY_POLL_MS);
  }
}

/* -------------------------------------------------------------------------- */
/* Activation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Turn the Dynamic key into the account's first device.
 *
 * `kernel.self()` is not available in a Compact constructor, so the account is
 * DORMANT until this runs: the constructor stored a salted commitment to the
 * device, and this opens it and inserts the real address-bound entry at epoch 0
 * and counter 0. The envelope is the third argument and it is not optional —
 * the commitment binds it, and `(pk, salt)` fails before a transaction exists.
 *
 * It advances `device_count` to 1 and leaves `auth_nonce` alone: activation is
 * not itself an authorised call.
 */
export async function activateK1Device(
  session: CustodyDynamicSession,
  device: K256DeviceIdentity,
  onPhase?: (phase: CustodyPhase) => void,
  overrides: Partial<CustodyDeps> = {},
): Promise<CustodyStepResult> {
  const deps = withDefaults(overrides);
  const user = k1UserKey(session);
  const wallet = await deps.wallet(user);
  const network = wallet.network.networkId;
  const storage = deps.storage();
  const record = loadCustodyRecord(storage, user, network);
  if (record?.interrupted === true) throw new Error(CUSTODY_SETUP_INTERRUPTED);
  if (!record || record.address === null) {
    throw new Error('There is no Passport to add this key to yet.');
  }

  onPhase?.({ step: 'activate' });
  const { callTx } = await openCustodyAccount(deps, wallet, record, 'activate_initial_device_with_k256');
  const salt = hexToBytes(record.saltHex);
  const result = await callTx.activate_initial_device_with_k256?.(
    device.pk,
    salt,
    device.envelope,
  );

  onPhase?.({ step: 'confirm' });
  const providers = await deps.providers(wallet, record.privateStateId);
  const txHash = await resolveHash(providers, result);
  const next: CustodyAccountRecord = {
    ...record,
    activated: true,
    pkXHex: device.pk.x.toString(16),
    pkYHex: device.pk.y.toString(16),
    txHashes: txHash ? [...record.txHashes, txHash] : record.txHashes,
  };
  saveCustodyRecord(storage, next);
  return { record: next, txHash, explorerUrl: txHash ? custodyExplorerLink(txHash, network) : null };
}

/* -------------------------------------------------------------------------- */
/* A gated call                                                               */
/* -------------------------------------------------------------------------- */

/** What one gated call needs beyond the session. */
export interface CustodyCallRequest {
  /** The operation, unsuffixed: `append_inbox`, `withdraw_unshielded`, … */
  readonly operation: string;
  /** The circuit's own leading arguments, before the authorisation trailer. */
  readonly args: readonly unknown[];
  /** Builds the challenge from the contract's own pure circuit. */
  readonly challenge: (
    pure: CustodyPureCircuits,
    context: K1CallContext,
    pk: CurvePoint,
  ) => Uint8Array;
}

/**
 * One authorised call, the whole dance.
 *
 *   1. read the ledger        → `auth_nonce` and `device_epoch`
 *   2. resolve the use counter → derive the candidate entry, ask the ledger
 *   3. build the challenge     → the contract's own pure circuit
 *   4. hash it                 → `SHA-256(challenge)`, envelope 0
 *   5. sign it                 → Dynamic, 64 hex in, `0x r‖s‖v` out
 *   6. submit                  → `<op>_with_k256(...args, pk, counter, sig, envelope)`
 *
 * `auth_nonce` is read BEFORE the call and is its own cell rather than the
 * `round` counter, which is what stops a permissionless deposit landing between
 * the read and the submit from invalidating a signature the user has already
 * approved.
 */
export async function k1Call(
  session: CustodyDynamicSession,
  device: K256DeviceIdentity,
  request: CustodyCallRequest,
  onPhase?: (phase: CustodyPhase) => void,
  overrides: Partial<CustodyDeps> = {},
): Promise<CustodyStepResult> {
  const deps = withDefaults(overrides);
  const user = k1UserKey(session);
  const wallet = await deps.wallet(user);
  const network = wallet.network.networkId;
  const storage = deps.storage();
  const record = loadCustodyRecord(storage, user, network);
  if (!record || record.address === null || nextCustodyStep(record) !== 'ready') {
    throw new Error('This Passport is not finished being set up yet.');
  }

  const module = await deps.contractModule();
  const circuit = `${request.operation}_with_k256`;
  const { callTx, providers } = await openCustodyAccount(deps, wallet, record, circuit);
  const addressBytes = hexToBytes(record.address);

  const state = module.ledger(await queryStateData(providers, record.address));
  const context: K1CallContext = {
    contractAddress: addressBytes,
    authNonce: state.auth_nonce,
  };
  const useCounter = resolveCustodyUseCounter({
    entryAt: (counter) =>
      deviceEntry(module.pureCircuits, device, addressBytes, state.device_epoch, counter),
    isMember: (entry) => state.devices.member(entry),
  });

  onPhase?.({ step: 'sign' });
  const challenge = request.challenge(module.pureCircuits, context, device.pk);
  const signer = dynamicK256Signer({
    accountAddress: session.address,
    pk: device.pk,
    signRawMessage: session.signRaw,
    envelope: device.envelope,
  });
  const digest = await envelopeDigest(device.envelope, challenge);
  const auth: K256Authorisation = {
    arm: 'k256',
    pk: device.pk,
    use_counter: useCounter,
    sig: await signer.signDigest(digest),
    envelope: device.envelope,
  };

  onPhase?.({ step: 'submit' });
  const call = callTx[circuit];
  if (!call) throw new Error('This Passport cannot do that yet.');
  const result = await call(...request.args, ...authArgs(auth));

  onPhase?.({ step: 'confirm' });
  const txHash = await resolveHash(providers, result);
  const next: CustodyAccountRecord = {
    ...record,
    txHashes: txHash ? [...record.txHashes, txHash] : record.txHashes,
  };
  saveCustodyRecord(storage, next);
  return { record: next, txHash, explorerUrl: txHash ? custodyExplorerLink(txHash, network) : null };
}

/**
 * The first gated call: put 192 bytes in the account's inbox.
 *
 * CHOSEN BECAUSE IT MOVES NOTHING. `append_inbox` takes no coin, invokes no
 * witness, and releases no asset, so it exercises the entire authorisation seam
 * — the entry is consumed, the next one inserted, the ECDSA verified in-circuit,
 * `auth_nonce` advanced — with nothing at stake if the signature is wrong. It is
 * the same call the stagenet run used as its proof on 2026/09/16, and for the
 * same reason.
 */
/**
 * A PERMISSIONLESS call on a custody account: the deposits, which anybody may make
 * and which carry no authorisation trailer. `k1Call` always appends
 * `_with_k256` and the four auth arguments, so paying INTO a custody account —
 * this Passport's own opening balance arriving, or a send to somebody who
 * holds one of these Passports — goes through here with the plain circuit
 * name and the circuit's own arguments, nothing more.
 */
export async function custodyPermissionlessCall(
  session: CustodyDynamicSession,
  request: { operation: string; args: readonly unknown[] },
  onPhase?: (phase: CustodyPhase) => void,
  overrides: Partial<CustodyDeps> = {},
): Promise<CustodyStepResult> {
  const deps = withDefaults(overrides);
  const user = k1UserKey(session);
  const wallet = await deps.wallet(user);
  const network = wallet.network.networkId;
  const storage = deps.storage();
  const record = loadCustodyRecord(storage, user, network);
  if (!record || record.address === null || nextCustodyStep(record) !== 'ready') {
    throw new Error('This Passport is not finished being set up yet.');
  }
  const { callTx, providers } = await openCustodyAccount(deps, wallet, record, request.operation);
  onPhase?.({ step: 'submit' });
  const call = callTx[request.operation];
  if (!call) throw new Error('This Passport cannot do that yet.');
  const result = await call(...request.args);
  onPhase?.({ step: 'confirm' });
  const txHash = await resolveHash(providers, result);
  const next: CustodyAccountRecord = {
    ...record,
    txHashes: txHash ? [...record.txHashes, txHash] : record.txHashes,
  };
  saveCustodyRecord(storage, next);
  return { record: next, txHash, explorerUrl: txHash ? custodyExplorerLink(txHash, network) : null };
}

export async function appendInboxK1(
  session: CustodyDynamicSession,
  device: K256DeviceIdentity,
  entry: Uint8Array,
  onPhase?: (phase: CustodyPhase) => void,
  overrides: Partial<CustodyDeps> = {},
): Promise<CustodyStepResult> {
  if (entry.length !== 192) {
    throw new Error(`an inbox entry is 192 bytes, got ${entry.length}`);
  }
  return k1Call(
    session,
    device,
    {
      operation: 'append_inbox',
      args: [entry],
      challenge: (pure, context, pk) => k256Challenges.appendInbox(pure, context, pk, entry),
    },
    onPhase,
    overrides,
  );
}

/* -------------------------------------------------------------------------- */
/* Shared plumbing                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The private state the account custody build takes.
 *
 * ONE WITNESS, AND IT REFUSES. `held_coin` is the only witness this contract
 * declares, and the coin store that would answer it is PR 4. Nothing this
 * module calls invokes it — activation and `append_inbox` declare no witness —
 * so refusing is both correct today and the thing that will name itself the
 * moment a shielded spend is wired up.
 */
export function custodyWitnesses(): Record<string, () => never> {
  return {
    held_coin(): never {
      throw new Error('Sending shielded value from this kind of Passport is not built yet.');
    },
  };
}

/** The private-state value. Empty: the coin store is PR 4. */
function custodyPrivateState(): Record<string, unknown> {
  return { coins: {} };
}

/** Open the deployed contract for one circuit's proof route. */
async function openCustodyAccount(
  deps: CustodyDeps,
  wallet: LocalMidnightWallet,
  record: CustodyAccountRecord,
  circuit: string,
): Promise<{ callTx: CustodyCallTx; providers: Record<string, unknown> }> {
  const providers = await deps.providers(wallet, record.privateStateId);
  /* The proof provider is per-CIRCUIT, because the service is told which key to
     use. Everything else in the set is shared. */
  const scoped = {
    ...providers,
    proofProvider: custodyProofProvider({
      endpoint: custodyProvingEndpoint(sponsorConfig()?.url ?? null),
      network: wallet.network.networkId,
      circuit,
      deserialise: (providers.deserialiseUnbound as (b: Uint8Array) => unknown) ?? identity,
    }),
  };
  const contracts = await deps.contracts();
  const deployed = await contracts.findDeployedContract(scoped, {
    compiledContract: providers.compiledContract,
    contractAddress: record.address,
    privateStateId: record.privateStateId,
    initialPrivateState: custodyPrivateState(),
  });
  return { callTx: deployed.callTx, providers: scoped };
}

const identity = (value: unknown): unknown => value;

async function queryState(
  providers: Record<string, unknown>,
  address: string,
): Promise<{ serialize(): Uint8Array }> {
  const reader = providers.publicDataProvider as {
    queryContractState(address: string): Promise<{ serialize(): Uint8Array } | null>;
  };
  const state = await reader.queryContractState(address);
  if (!state) throw new Error('We could not read this Passport just now. Try again in a moment.');
  return state;
}

async function queryStateData(
  providers: Record<string, unknown>,
  address: string,
): Promise<unknown> {
  /* `ledger()` decodes the STATE VALUE, not the contract state that wraps it
     — `accountCustody.ts` and the sponsor both hand it `.data`. Handing it the
     wrapper decoded nothing; caught by the flow that first read a custody balance
     (2026/09/17). */
  return ((await queryState(providers, address)) as unknown as { data: unknown }).data;
}

/**
 * The hash the chain knows the transaction by.
 *
 * NOT the identifier midnight-js returns. A sponsored transaction is
 * SUPERSEDED by the balanced one the sponsor hands back, so the client-side
 * identifier is 33 bytes the indexer answers nothing for — observed verbatim on
 * 2026/09/16: `invalid transaction hash: cannot convert to ByteArray<32>`. The
 * app's own `resolveTransactionHash` walks the indexer from the identifier and
 * is the supported way to land on the real one; a failure to resolve is not a
 * failed transaction, so it reads as "no link yet" rather than as an error.
 */
async function resolveHash(
  providers: Record<string, unknown>,
  result: unknown,
): Promise<string | null> {
  let identifier: string;
  try {
    identifier = transactionId(result);
  } catch {
    return null;
  }
  const indexer = (providers.indexerHttpUrl as string | undefined) ?? '';
  if (indexer.length === 0) return identifier;
  try {
    return await resolveTransactionHash(indexer, identifier);
  } catch (cause) {
    console.info('[account-custody] the chain hash is not resolvable yet', messageOf(cause));
    return identifier;
  }
}

/**
 * The maintenance signing key, for the waves that follow the deploy.
 *
 * THREE PLACES, AND THE ORDER IS THE POINT. This tab's own map is first because
 * it is free. The private-state provider is second, because that is where
 * midnight-js's own deploy puts it and a durable one would answer here. And
 * `localStorage` is third and is the one that actually survives a reload today,
 * because the provider this app builds is `inMemoryPrivateStateProvider` — so
 * without it a reload between wave 1 and wave 3 left a live account nobody
 * could finish. See {@link CUSTODY_AUTHORITY_STORAGE_KEY} for what that costs and
 * why it is paid.
 */
const signingKeys = new Map<string, unknown>();

function rememberSigningKey(storage: CustodyStorage, address: string, key: unknown): void {
  signingKeys.set(address, key);
  saveCustodyAuthorityKey(storage, address, key);
}

/** The key for an address, or null when it is genuinely gone. */
async function signingKeyFor(
  providers: Record<string, unknown>,
  storage: CustodyStorage,
  address: string,
): Promise<unknown> {
  const held = signingKeys.get(address);
  if (held !== undefined) return held;
  const priv = providers.privateStateProvider as {
    getSigningKey(address: string): Promise<unknown>;
  };
  const stored = await priv.getSigningKey(address);
  if (stored !== null && stored !== undefined) return stored;
  const remembered = loadCustodyAuthorityKey(storage, address);
  if (remembered !== null) {
    signingKeys.set(address, remembered);
    return remembered;
  }
  return null;
}

/**
 * Abandon a half-built Passport, so the next attempt deploys a fresh one.
 *
 * The account already on chain is LEFT WHERE IT IS. It is dormant — the device
 * was never activated, so it holds nothing and nobody can call it — and there
 * is no transaction that would tidy it away. Deleting the record and the key is
 * the whole of what can be done, and it is what turns a screen that fails for
 * ever into one press that works.
 */
export async function startCustodyAccountAgain(
  session: CustodyDynamicSession,
  overrides: Partial<CustodyDeps> = {},
): Promise<void> {
  const deps = withDefaults(overrides);
  const user = k1UserKey(session);
  const wallet = await deps.wallet(user);
  const storage = deps.storage();
  const record = loadCustodyRecord(storage, user, wallet.network.networkId);
  if (record?.address) {
    signingKeys.delete(record.address);
    forgetCustodyAuthorityKey(storage, record.address);
  }
  removeCustodyRecord(storage, user, wallet.network.networkId);
}

/** Reset the in-tab signing-key cache. For drills, and for a sign-out. */
export function resetCustodySessionState(): void {
  signingKeys.clear();
}

/* -------------------------------------------------------------------------- */
/* The default seams                                                          */
/* -------------------------------------------------------------------------- */

function withDefaults(overrides: Partial<CustodyDeps>): CustodyDeps {
  return { ...defaultCustodyDeps(), ...overrides };
}

/**
 * The real dependencies, every one of them behind a function so that importing
 * this module costs nothing until a Dynamic Passport is actually asked for.
 */
export function defaultCustodyDeps(): CustodyDeps {
  return {
    storage: () => globalThis.localStorage,
    randomBytes: (length) => {
      const out = new Uint8Array(length);
      globalThis.crypto.getRandomValues(out);
      return out;
    },
    wallet: async (user) => {
      const seed = custodyWalletSeed(defaultCustodyDeps(), user);
      return createLocalMidnightWallet(seed);
    },
    contractModule: async () =>
      (await loadContractModule(ACCOUNT_CUSTODY_CONTRACT)) as unknown as CustodyContractModule,
    providers: async (wallet, privateStateId) => {
      const [providers, compiledContract, ledgerModule] = await Promise.all([
        createContractProviders(wallet, {
          contract: ACCOUNT_CUSTODY_CONTRACT,
          privateStateId,
          initialPrivateState: custodyPrivateState(),
        }),
        compiledContractFor(ACCOUNT_CUSTODY_CONTRACT, ACCOUNT_CUSTODY_LABEL, custodyWitnesses()),
        import('@midnightntwrk/ledger-v9'),
      ]);
      return {
        ...(providers as Record<string, unknown>),
        compiledContract,
        indexerHttpUrl: wallet.network.indexerHttpUrl,
        /* The proven-but-unbound rehydration the proof provider hands back:
           `Proof` in place of `PreProof`, binding still pre-bound, because it
           is `balanceTx` that binds. */
        deserialiseUnbound: (bytes: Uint8Array) =>
          (
            ledgerModule.Transaction as unknown as {
              deserialize(s: string, p: string, b: string, raw: Uint8Array): unknown;
            }
          ).deserialize('signature', 'proof', 'pre-binding', bytes),
      };
    },
    ledger: async () => {
      const [ledgerModule, networkIdModule] = await Promise.all([
        import('@midnightntwrk/ledger-v9'),
        import('@midnight-ntwrk/midnight-js-network-id'),
      ]);
      return {
        ...(ledgerModule as unknown as Omit<CustodyLedgerApi, 'networkId'>),
        networkId: () =>
          (networkIdModule as unknown as { getNetworkId(): string }).getNetworkId(),
      };
    },
    contracts: async () =>
      (await import('@midnight-ntwrk/midnight-js-contracts')) as unknown as CustodyContractsApi,
    now: () => Date.now(),
    sleep: (milliseconds) =>
      new Promise((resolve) => {
        globalThis.setTimeout(resolve, milliseconds);
      }),
  };
}
