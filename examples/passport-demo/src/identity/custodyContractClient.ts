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
  type JubjubDeviceIdentity,
  type K1Arm,
  type K1Authorisation,
  type K1Challenge,
  jubjubChallenges,
  k256Challenges,
  deviceEntry,
  bootCommitment,
} from './custodyContractSigning.js';
import { type JubjubSigner } from './custodyJubjubSigner.js';
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
  custodyProofNotBuilt,
  isCustodyProofNotBuilt,
  CUSTODY_SETUP_INTERRUPTED,
  loadCustodyAuthorityKey,
  loadCustodyRecord,
  newCustodyRecord,
  nextCustodyStep,
  parseProveCustodyResponse,
  proveAccountCustodyRefused,
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
  resolveTxCommitmentWindowByHashOnce,
  resolveTxHashOnce,
  transactionId,
} from './contractRuntime.js';
import {
  advanceK1CoinCandidate,
  emptyK1CoinStoreState,
  heldK1Coin,
  k1PrivateStateId,
  k1PrivateStateProvider,
  loadK1CoinStore,
  rememberK1ChangeCoin,
  rememberK1EncSecretKey,
  renameK1AwaitingTx,
  restartK1CoinCandidates,
  settleK1AwaitingCoinByChainHash,
  settleK1Coin,
  type K1Account,
  type K1CoinStoreState,
} from './k1CoinStore.js';
import { normalisedColourHex } from '../lib/colour.js';
import {
  changeCoinFromResult,
  spendPositionMayBeWrong,
  type CustodyChangeCoin,
} from './custodyContractSend.js';
import { custodyEncKeyPair } from './custodyInbox.js';
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

/**
 * A passkey Passport's device: the jubjub identity, and optionally the account's
 * VIEWING secret derived from the same authenticator.
 *
 * The viewing secret rides along rather than being derived here because this
 * module must never see a passkey: `passportContract.ts` does the assertion and
 * the four derivations, and hands the results down. `runWaveOne` files it as
 * the account's `enc_key` at deploy; see `PASSPORT_ENC_LABEL` for why a passkey
 * Passport cannot afford the random one the Dynamic arm uses.
 */
export interface CustodyPasskeyDevice extends JubjubDeviceIdentity {
  /** 32 bytes of hex, from `derivePassportContractSecrets(...).encSecret`. */
  readonly encSecretKeyHex?: string;
  /**
   * 32 bytes of hex, from `derivePassportContractSecrets(...).maintenanceSecret`.
   *
   * Supplied ONLY when the account is meant to keep its maintenance authority,
   * and IGNORED unless the wave plan says the same (`planCustodyWaves`'s third
   * argument, which is `true` for every account this app deploys today). An
   * authority built from this and then replaced by the empty committee on the
   * last wave is a derived secret with nothing left to authorise, and it used
   * to be built anyway. When the authority IS kept, a derived key is the only
   * kind worth keeping: a sampled one lives in this browser's storage, and a
   * Passport reinstalled elsewhere would hold an authority it cannot sign for.
   * See `PASSPORT_MAINTENANCE_LABEL` for what each choice costs.
   */
  readonly maintenanceSecretHex?: string;
}

/** The device a deploy, an activation, or a roster read is taken with. */
export type CustodyDeviceIdentity = K256DeviceIdentity | CustodyPasskeyDevice;

/**
 * The device a GATED call is taken with — the same union, except that the
 * jubjub half has to be able to sign.
 *
 * The k256 arm's secret is Dynamic's and is reached through `session.signRaw`,
 * so the identity is enough there. The jubjub arm's secret is the passkey's and
 * is held by a {@link JubjubSigner} the caller built from the contract root; it
 * never reaches this module as bytes.
 */
export type CustodyCallDevice = K256DeviceIdentity | (JubjubSigner & CustodyPasskeyDevice);

/**
 * The key a Passport's record, wallet seed, and viewing secret are filed under.
 *
 * A Dynamic Passport is named by its embedded address, as it always was. A
 * PASSKEY Passport has no such address, and naming it by one would mean a
 * passkey Passport and a Dynamic Passport could collide in storage or, worse,
 * that a passkey account's record could not be found again at all. It is named
 * by its own device point instead, which is derived from the passkey — so it is
 * the same key before and after a reinstall, which is the property the whole
 * arm exists for.
 */
export function custodyUserKey(
  session: Pick<CustodyDynamicSession, 'address'> | null,
  device: CustodyOwner,
): string {
  if (device.arm === 'jubjub') return `jubjub:${device.pk.x.toString(16)}`;
  /* Not reachable from the screen, which has a session before it has a k256
     device at all — the point is RECOVERED from a vendor signature. It is here
     because the type now admits null for the arm that has no vendor, and a
     type that admits something has to say what happens when it arrives. */
  if (session === null) throw new Error('A social sign-in Passport needs the sign-in it is held by.');
  return k1UserKey(session);
}

/**
 * The half of a device that NAMES a Passport in storage: which arm, and the
 * point.
 *
 * Everything the custody layer files — the record, the wallet seed, the
 * viewing-key slot, the coin store, the name — is keyed by
 * {@link custodyUserKey}, and every entry point that files anything therefore
 * needs this much of a device even when it needs no signature at all. A
 * permissionless deposit is the clearest case: it proves nothing and signs
 * nothing, and it still has to know whose record to write the hash into.
 */
export type CustodyOwner = Pick<CustodyDeviceIdentity, 'arm' | 'pk'>;

/**
 * Who is signed in with a VENDOR, or null where there is no vendor.
 *
 * A jubjub Passport is held by a passkey: there is no address to name it by and
 * no socket to sign over, and the two entry points that once demanded both read
 * neither on that arm. Null is the honest value, and it is narrower than a
 * stub session with an empty address — which is what the screen used to pass
 * and which would have filed a real Passport under `''` the first time anybody
 * mixed the arms up.
 */
export type CustodySession = CustodyDynamicSession | null;

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
  /**
   * Providers for one connection.
   *
   * `account` is the coin store this connection's private state IS — null
   * before the deploy has an address, and for a connection to SOMEBODY ELSE's
   * account, where serving our own coins would be both wrong and pointless
   * (the deposits declare no witness). See {@link custodyPrivateStateId}.
   */
  providers(
    wallet: LocalMidnightWallet,
    privateStateId: string,
    account?: K1Account | null,
  ): Promise<Record<string, unknown>>;
  /** The ledger primitives the wave deploy builds transactions out of. */
  ledger(): Promise<CustodyLedgerApi>;
  /** midnight-js's deploy and call entry points. */
  contracts(): Promise<CustodyContractsApi>;
  now(): number;
  sleep(milliseconds: number): Promise<void>;
  /**
   * Where a transaction's shielded outputs landed in the commitment tree.
   *
   * The only thing the chain will ever say about a held coin's position, and
   * therefore the only way a change coin becomes spendable. Injected so a
   * drill needs no indexer — `./contractRuntime.ts` holds the query and its
   * ten-second ceiling.
   */
  commitmentWindow(
    indexerHttpUrl: string,
    txId: string,
  ): Promise<{ startIndex: number; endIndex: number } | null>;
  /**
   * The chain's hash for one of midnight-js's identifiers, or null when the
   * indexer has no answer YET.
   *
   * One question, not the ten-second poll: this is asked again on every read
   * that finds a coin still filed under an identifier, so a lagging indexer
   * costs a question rather than a coin. See
   * `settleK1AwaitingCoinByChainHash`.
   */
  resolveChainHash(indexerHttpUrl: string, txId: string): Promise<string | null>;
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
  /* A maintenance signing key from 32 bytes of BIP-340 secret, and its
     verifying half — how a DERIVED authority is built instead of a sampled
     one. See `PASSPORT_MAINTENANCE_LABEL`. */
  signingKeyFromBip340: (data: Uint8Array) => unknown;
  signatureVerifyingKey: (key: unknown) => unknown;
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
        /* THE SERVICE ANSWERED AND DECLINED TO PROVE, which is not the same as
           the service being down — and for a shielded spend it is the shape a
           WRONG CANDIDATE POSITION arrives in. See {@link CUSTODY_PROOF_NOT_BUILT}. */
        if (proveAccountCustodyRefused(parsed)) throw custodyProofNotBuilt();
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
  /**
   * The JS value the circuit returned, for the circuits that return one.
   *
   * `withdraw_shielded_with_k256` returns the CHANGE COIN
   * (`{is_some, value:{nonce,color,value}}`) and that value exists nowhere
   * else: the chain carries the note and not its description, so a caller that
   * did not keep this has an account holding a coin nobody can ever name. See
   * {@link circuitResultOf} for why only this one field of the call result
   * crosses back.
   */
  readonly result?: unknown;
}

/**
 * The circuit's own return value, and NOTHING else from the call result.
 *
 * midnight-js hands back a `CallResult` whose `private` half is marked
 * privacy-sensitive in as many words: the ZK-aligned input and output, the
 * private transcript outputs of every witness call, the next private state,
 * and the next Zswap local state (`@midnight-ntwrk/midnight-js-contracts`,
 * `CallResultPrivate`). Its own guidance is to extract the field you need
 * rather than carry the object across a boundary, and this is that extraction:
 * `private.result`, by name, never the object it sits on. Nothing above this
 * line can log, serialise, or hand on what it never received.
 */
function circuitResultOf(callResult: unknown): unknown {
  if (!callResult || typeof callResult !== 'object') return undefined;
  const privatePart = (callResult as { private?: unknown }).private;
  if (!privatePart || typeof privatePart !== 'object') return undefined;
  return (privatePart as { result?: unknown }).result;
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
  session: CustodySession,
  /* THE ARM WIDENING (2026/09/18, passkey arm). Either arm's device now, and
     the Passport is filed under the device's own key — `custodyUserKey` — so a
     passkey account is not named by a Dynamic address it does not have. The
     five points that were hardcoded to `k256` are marked GENERALISATION n of 5
     where each of them is. */
  device: CustodyDeviceIdentity,
  onPhase?: (phase: CustodyPhase) => void,
  overrides: Partial<CustodyDeps> = {},
): Promise<CustodyStepResult> {
  const deps = withDefaults(overrides);
  const user = custodyUserKey(session, device);
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

  const providers = await deps.providers(
    wallet,
    custodyPrivateStateId(record),
    custodyStoreAccount(record),
  );
  const verifierKeys = await readVerifierKeys(providers, module, device.arm);
  const sizes = new Map([...verifierKeys].map(([id, key]) => [id, key.length]));
  /* GENERALISATION 1 of 5. The plan's FIRST arm is the device's: wave 1 must
     carry `activate_initial_device_with_<arm>`, because the constructor's boot
     commitment binds the arm and no later wave can repair a deploy that left
     the activation circuit out. `planCustodyWaves` has taken the arm since it
     was written; only the caller was hardcoded. */
  const waves = planCustodyWaves(sizes, device.arm);
  record = { ...record, totalWaves: waves.length };
  /* Decided ONCE, from the plan this deploy will actually run, and handed to
     both wave runners: the one that builds the authority and the one that has
     to sign with it. See {@link derivedMaintenanceAuthority}. */
  const derivedAuthority = derivedMaintenanceAuthority(ledgerApi, device, waves);

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
      derivedAuthority,
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
      derivedAuthority,
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
  /* GENERALISATION 2 of 5. `allCustodyCircuits` orders the roster by which arm
     goes first; the sizes feed the wave plan, so reading them for the other arm
     would plan the waves in the wrong order. */
  firstArm: K1Arm,
): Promise<Map<string, Uint8Array>> {
  const zk = providers.zkConfigProvider as {
    getVerifierKey(circuit: string): Promise<Uint8Array | null>;
  };
  const keys = new Map<string, Uint8Array>();
  for (const circuit of allCustodyCircuits(firstArm)) {
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
  /**
   * The passkey's own maintenance signing key, re-derived on demand, or null
   * when this account's authority is the sampled one the plan retires.
   *
   * A FUNCTION RATHER THAN A KEY, because a derived authority is never written
   * down: every wave that needs it asks the passkey's secret for it again.
   */
  derivedAuthority: (() => unknown) | null;
}

/**
 * The maintenance signing key the passkey hands down — or null, which is the
 * answer for every account this app deploys today.
 *
 * TWO CONDITIONS, AND THE SECOND ONE WAS MISSING. A device that carries a
 * `maintenanceSecretHex` was enough to take this branch, so a passkey Passport
 * got an authority built from a secret derived from somebody's authenticator
 * ON A PLAN THAT RETIRES THE AUTHORITY TWO WAVES LATER. That is a derived
 * upgrade secret created, stored, and made worthless in the same setup.
 * `planCustodyWaves` retires by default and nothing here asks it not to, so
 * the honest reading of the plan is the gate: the key is derived only for an
 * account that is going to KEEP the authority it is the key to.
 *
 * It hands back a function because nothing persists a derived key; see
 * {@link signingKeyFor} for the other half of that rule.
 */
function derivedMaintenanceAuthority(
  ledgerApi: CustodyLedgerApi,
  device: CustodyDeviceIdentity,
  waves: readonly CustodyWave[],
): (() => unknown) | null {
  const secretHex = 'maintenanceSecretHex' in device ? device.maintenanceSecretHex : undefined;
  if (secretHex === undefined) return null;
  if (waves.some((wave) => wave.retiresAuthority)) return null;
  return () => ledgerApi.signingKeyFromBip340(hexToBytes(secretHex));
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
    device: CustodyDeviceIdentity;
    wave: CustodyWave;
    module: CustodyContractModule;
    contracts: CustodyContractsApi;
  },
): Promise<CustodyAccountRecord> {
  const { deps, ledgerApi, providers, storage, module, contracts, wave } = context;
  const salt = hexToBytes(context.record.saltHex);
  const boot = bootCommitment(module.pureCircuits, context.device, salt);
  /* The account's X25519 viewing key, which the constructor advertises as
     `enc_key` and every depositor seals inbox entries to.

     IT IS REMEMBERED NOW, AND IT USED NOT TO BE. The previous milestone put
     `deps.randomBytes(32)` here and threw the secret half away, which made the
     constructor the right SHAPE and the account permanently unable to read its
     own inbox: an entry is opened with the secret half or by nobody, and every
     coin ever deposited into this account is described in one. `custodyEncKeyPair`
     makes the pair once per Dynamic user and hands back the same one for ever
     after — the same rule, and the same storage discipline, as the per-device
     wallet seed beside it. */
  const encKeys = custodyEncKeyPair(
    storage,
    context.record.user,
    /* Per ACCOUNT and per NETWORK. The salt is what names this account before
       it has an address, and it is in the record, so a resumed deploy asks for
       and receives the same key rather than advertising a second one. */
    { network: context.record.network, accountId: context.record.saltHex },
    { randomBytes: (length) => deps.randomBytes(length), subtle: () => globalThis.crypto.subtle },
    /* PASSKEY SECRET (a). A PASSKEY account's viewing secret is derived
       from the same authenticator as its device key, so a Passport reinstalled
       on another phone re-derives the key its own inbox was sealed to. A
       Dynamic account passes nothing here and keeps the random secret it has
       always had, because Dynamic can hand that browser its storage back and a
       passkey cannot. An existing slot always wins; see `custodyEncKeyPair`. */
    'encSecretKeyHex' in context.device ? context.device.encSecretKeyHex : undefined,
  );
  const encryptionKey = hexToBytes(encKeys.publicKeyHex);

  const deployData = await contracts.createUnprovenDeployTx(providers, {
    compiledContract: providers.compiledContract,
    privateStateId: custodyPrivateStateId(context.record),
    initialPrivateState: custodyPrivateState(context.record),
    args: [boot, encryptionKey],
  });

  const full = ledgerApi.ContractState.deserialize(
    deployData.public.initialContractState.serialize(),
  );
  /* PASSKEY SECRET (b). The maintenance authority, DERIVED when the caller
     asked for one it can still hold after a reinstall AND the plan is keeping
     it — {@link derivedMaintenanceAuthority} is where both halves of that are
     decided, and null is the answer for every account deployed today.

     midnight-js samples `deployData.private.signingKey` at random and this app
     files it in `localStorage`; the wave plan then retires the authority on its
     last wave, so that key is spent by the time anybody could miss it. The
     moment the plan is told NOT to retire (`planCustodyWaves`'s third
     argument), a sampled key becomes an authority that dies with the browser —
     so when the passkey hands one down, the deploy is built around that key
     instead and nothing about the authority is stored at all. Nicolas asked us
     to decide rather than inherit; the default is unchanged (retire) and
     `PASSPORT_MAINTENANCE_LABEL` says what each answer costs. */
  const derivedMaintenance = context.derivedAuthority?.() ?? null;
  const wave1 = buildWaveOneState(ledgerApi, full, wave);
  if (derivedMaintenance !== null) {
    wave1.maintenanceAuthority = new ledgerApi.ContractMaintenanceAuthority(
      [ledgerApi.signatureVerifyingKey(derivedMaintenance)],
      1,
      0n,
    ) as CustodyContractState['maintenanceAuthority'];
  }

  const deploy = new ledgerApi.ContractDeploy(wave1);
  const address = String(deploy.address);
  /* THE RETURN VALUE IS THE INTENT THAT CARRIES THE DEPLOY. `addDeploy` hands
     back a new `Intent` rather than mutating the receiver — the binding is a
     wasm value, not an object with methods on it — so building the transaction
     out of the intent this call was made ON submits an EMPTY one. Three live
     deploys were paid for and landed as transactions carrying nothing on
     2026/09/17 before this was found: the node accepted each, no contract was
     created, and the wave that followed waited for an account that did not
     exist. The reference client at `scratchpad/ref-wave-deploy.ts` always
     chained the call for this reason. */
  const intent = ledgerApi.Intent.new(new Date(deps.now() + CUSTODY_TX_TTL_MS)).addDeploy(deploy);
  const unprovenTx = ledgerApi.Transaction.fromParts(
    ledgerApi.networkId(),
    undefined,
    undefined,
    intent,
  );

  const result = await contracts.submitTx(providers, { unprovenTx });
  const txHash = await resolveHash(context.providers, result);

  const priv = providers.privateStateProvider as {
    setContractAddress?(address: string): void;
    setSigningKey(address: string, key: unknown): Promise<void>;
    set(id: string, state: unknown): Promise<void>;
  };
  priv.setContractAddress?.(address);
  await priv.set(custodyPrivateStateId(context.record), deployData.private.initialPrivateState);
  /* A DERIVED AUTHORITY IS NEVER WRITTEN DOWN, and that is the whole of what
     makes deriving it worth doing. `PASSPORT_MAINTENANCE_LABEL` says the
     maintenance secret is not stored; this function stored it — into the
     private-state provider and then, through `rememberSigningKey`, into
     `localStorage`, where the app's own backup and every script with access to
     this origin can read it. A key that survives a reinstall does not need to
     survive a reload: the waves ask the passkey for it again.

     The SAMPLED key still goes to both places, unchanged. It exists nowhere
     else, the last wave throws away the authority it drives, and a reload
     between wave 1 and wave 3 with nothing stored is a live account nobody can
     finish. See {@link signingKeyFor}. */
  if (derivedMaintenance === null) {
    await priv.setSigningKey(address, deployData.private.signingKey);
    rememberSigningKey(storage, address, deployData.private.signingKey);
  }

  /* The coin store keeps the viewing secret beside the coins it will decrypt,
     because that is the shape the `held_coin` witness's private state has and
     because a walk needs both in the same place. It is written only once the
     address exists, since the store is keyed by it.

     A store that will not take it is not a reason to abandon a deploy that has
     already landed: the key is still in `CUSTODY_ENC_KEY_KEY`, where the walk reads
     it from, and this write is the convenience copy. */
  try {
    rememberK1EncSecretKey({ network: context.record.network, address }, encKeys.secretKeyHex);
  } catch (cause) {
    console.warn('[account-custody] could not file this Passport’s viewing key beside its coins', cause);
  }

  const next: CustodyAccountRecord = {
    ...context.record,
    address,
    /* THE ID BECOMES THE COIN STORE'S, now that there is an address to key it
       by. Until this line the record carried an id derived from the Dynamic
       user, because that was all there was before the deploy; from here the
       account has an address and the store, the witness, and midnight-js all
       have to be talking about the same private state. Written into the record
       as well as computed, so a reader of the record sees one id and not two.
       See {@link custodyPrivateStateId}. */
    privateStateId: k1PrivateStateId({ network: context.record.network, address }),
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
  /* THROUGH THE WAIT, NOT A BARE READ. This is the first thing asked of the
     chain after the deploy landed, and for the first seconds the indexer does
     not serve the new address — which ended every live setup on 2026/09/17.
     `0n` is a counter every live authority is at or past, so this waits for the
     account to be READABLE and takes whatever counter it reports. */
  const counter = await awaitAuthorityCounter(deps, providers, ledgerApi, address, 0n);

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

  const signingKey = await signingKeyFor(providers, storage, address, context.derivedAuthority);
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
  /* Chained for the reason `runWaveOne` gives: the intent that carries the
     update is the one this call RETURNS. */
  const intent = ledgerApi.Intent.new(new Date(deps.now() + CUSTODY_TX_TTL_MS)).addMaintenanceUpdate(
    signed,
  );
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
 *
 * AN UNREADABLE STATE IS "NOT YET", NOT A FAILURE. Between the deploy landing
 * and the indexer serving the new address there is a window — 20-odd seconds on
 * stagenet — in which `queryContractState` answers null, and `queryState` turns
 * that into a plain refusal for the callers that have no other recourse. Here
 * there is one: this function's whole job is to wait. Letting the refusal out
 * of the FIRST poll ended every live setup on 2026/09/17 about twenty seconds
 * in, with a Passport that was deployed, paid for, and abandoned. So a read
 * that cannot answer is retried to the same deadline as a counter that has not
 * moved, and only the deadline refuses.
 */
async function awaitAuthorityCounter(
  deps: CustodyDeps,
  providers: Record<string, unknown>,
  ledgerApi: CustodyLedgerApi,
  address: string,
  expected: bigint,
): Promise<bigint> {
  const deadline = deps.now() + CUSTODY_AUTHORITY_WAIT_MS;
  for (;;) {
    const seen = await authorityCounter(providers, ledgerApi, address).catch(() => null);
    if (seen !== null && seen >= expected) return seen;
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
  session: CustodySession,
  device: CustodyDeviceIdentity,
  onPhase?: (phase: CustodyPhase) => void,
  overrides: Partial<CustodyDeps> = {},
): Promise<CustodyStepResult> {
  const deps = withDefaults(overrides);
  const user = custodyUserKey(session, device);
  const wallet = await deps.wallet(user);
  const network = wallet.network.networkId;
  const storage = deps.storage();
  const record = loadCustodyRecord(storage, user, network);
  if (record?.interrupted === true) throw new Error(CUSTODY_SETUP_INTERRUPTED);
  if (!record || record.address === null) {
    throw new Error('There is no Passport to add this key to yet.');
  }

  onPhase?.({ step: 'activate' });
  /* GENERALISATION 3 of 5: the activation circuit and ITS ARGUMENT LIST.
     The two arms do not take the same arguments — `_with_jubjub` is
     `(pk, salt)` and `_with_k256` is `(pk, salt, envelope)`, because an
     envelope is a property of a vendor wrapping bytes before signing them and
     there is no vendor on the passkey arm. The circuit is also not a free
     choice: the constructor's boot commitment binds the arm, so an account
     deployed with a passkey can only ever be opened by
     `activate_initial_device_with_jubjub`. */
  const circuit = `activate_initial_device_with_${device.arm}`;
  const { callTx } = await openCustodyAccount(deps, wallet, record, circuit);
  const salt = hexToBytes(record.saltHex);
  const activationArgs =
    device.arm === 'jubjub' ? [device.pk, salt] : [device.pk, salt, device.envelope];
  const result = await callTx[circuit]?.(...activationArgs);

  onPhase?.({ step: 'confirm' });
  const providers = await deps.providers(
    wallet,
    custodyPrivateStateId(record),
    custodyStoreAccount(record),
  );
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
  ) => K1Challenge;
  /**
   * The circuit's own return value, handed over the INSTANT the call resolves.
   *
   * WHY IT IS NOT JUST THE RETURN OF THIS FUNCTION. Between the call resolving
   * and this function returning there is `resolveHash`, which asks the indexer
   * for the chain's hash and polls for it. That is up to ten seconds of a
   * screen reading "Confirming" — and for a shielded withdrawal the circuit's
   * return value is the ONLY description of the change coin that exists
   * anywhere in the world. A tab closed in that window left the spent coin
   * still held, the change gone for ever, and the send record claiming nothing
   * had been sent while the note sat in the wallet.
   *
   * So the caller writes what it must write here, before anything is asked of
   * anybody. `identifier` is midnight-js's own transaction id, which is what
   * there is to name the transaction by until the hash resolves.
   */
  readonly onSubmitted?: (result: unknown, identifier: string | null) => void;
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
  session: CustodySession,
  device: CustodyCallDevice,
  request: CustodyCallRequest,
  onPhase?: (phase: CustodyPhase) => void,
  overrides: Partial<CustodyDeps> = {},
): Promise<CustodyStepResult> {
  const deps = withDefaults(overrides);
  const user = custodyUserKey(session, device);
  const wallet = await deps.wallet(user);
  const network = wallet.network.networkId;
  const storage = deps.storage();
  const record = loadCustodyRecord(storage, user, network);
  if (!record || record.address === null || nextCustodyStep(record) !== 'ready') {
    throw new Error('This Passport is not finished being set up yet.');
  }

  const module = await deps.contractModule();
  /* GENERALISATION 4 of 5: the gated circuit's name. The arm IS the half of
     every gated circuit's name that selects which proof gets made. */
  const circuit = `${request.operation}_with_${device.arm}`;
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
  /* GENERALISATION 5 of 5: how the authorisation is built.
     The two arms diverge here and nowhere else. A k256 device is Dynamic's: the
     challenge is finished bytes, they are hashed into the envelope digest, and
     the vendor signs them over a socket — so the step is async and the secret
     never comes near this module. A jubjub device is the PASSKEY's: the
     challenge is a BUILDER, because a Schnorr preimage contains its own
     signature nonce and the grind counter, and the signer holds the derived
     scalar and closes the loop itself — so the step is synchronous and there is
     no vendor to wait for. `authArgs` puts both back into the same call. */
  let auth: K1Authorisation;
  if (device.arm === 'jubjub') {
    if (typeof challenge !== 'function') {
      throw new Error('the jubjub arm needs a challenge builder, not finished bytes');
    }
    auth = device.sign(challenge, useCounter);
  } else {
    if (typeof challenge === 'function') {
      throw new Error('the k256 arm needs a finished challenge, not a builder');
    }
    /* `custodyUserKey` has already refused a k256 device with no session, so
       this cannot be reached; it is here so the narrowing is the compiler's
       and not a comment. */
    if (session === null) {
      throw new Error('A social sign-in Passport needs the sign-in it is held by.');
    }
    const signer = dynamicK256Signer({
      accountAddress: session.address,
      pk: device.pk,
      signRawMessage: session.signRaw,
      envelope: device.envelope,
    });
    const digest = await envelopeDigest(device.envelope, challenge);
    const k256: K256Authorisation = {
      arm: 'k256',
      pk: device.pk,
      use_counter: useCounter,
      sig: await signer.signDigest(digest),
      envelope: device.envelope,
    };
    auth = k256;
  }

  onPhase?.({ step: 'submit' });
  const call = callTx[circuit];
  if (!call) throw new Error('This Passport cannot do that yet.');
  const result = await call(...request.args, ...authArgs(auth));

  /* BEFORE THE HASH IS ASKED FOR. See `onSubmitted`. */
  request.onSubmitted?.(circuitResultOf(result), identifierOf(result));

  onPhase?.({ step: 'confirm' });
  const txHash = await resolveHash(providers, result);
  const next: CustodyAccountRecord = {
    ...record,
    txHashes: txHash ? [...record.txHashes, txHash] : record.txHashes,
  };
  saveCustodyRecord(storage, next);
  return {
    record: next,
    txHash,
    explorerUrl: txHash ? custodyExplorerLink(txHash, network) : null,
    result: circuitResultOf(result),
  };
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
  session: CustodySession,
  owner: CustodyOwner,
  request: { operation: string; args: readonly unknown[] },
  onPhase?: (phase: CustodyPhase) => void,
  overrides: Partial<CustodyDeps> = {},
): Promise<CustodyStepResult> {
  const deps = withDefaults(overrides);
  const user = custodyUserKey(session, owner);
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

/* -------------------------------------------------------------------------- */
/* Leg one of a shielded payment                                              */
/* -------------------------------------------------------------------------- */

/** What the gated shielded withdrawal needs beyond the session. */
export interface CustodyShieldedWithdrawRequest {
  /**
   * Where the note is paid: 32 bytes of coin public key.
   *
   * THIS WALLET'S OWN, on the send path. The circuit pays a user key by type
   * and the person being paid holds an account, so the only key this leg can
   * name that leads anywhere is the sender's, and leg three carries it the
   * rest of the way — the same shape, and the same reason, as the NIGHT
   * withdrawal in `./custodyContractSend.ts`.
   */
  readonly recipientCoinPublicKey: Uint8Array;
  readonly colourHex: string;
  readonly amount: bigint;
}

/** What a shielded withdrawal did, including what it left behind. */
export interface CustodyShieldedWithdrawResult extends CustodyStepResult {
  /** The change coin, read out of the circuit's own result. */
  readonly change: CustodyChangeCoin;
  /** Whether the change's position is settled, still being asked about, or absent. */
  readonly changePosition: 'settled' | 'candidates' | 'awaiting' | 'none';
}

/**
 * Leg one: move a shielded amount out of this Passport to a coin public key.
 *
 * THE COIN IS READ ONCE AND USED TWICE, which is the thing this function
 * exists to guarantee. The challenge the device signs BINDS the qualified coin
 * (AUTH-10), and the proof is built from whatever the `held_coin` witness
 * returns; if those two were read at different moments from different places
 * the signature would be over a coin the proof does not spend, and the call
 * would fail in a way that names none of that. Both come from the store, and
 * the witness reads the same store this reads.
 *
 * THE POSITION MAY BE A GUESS, AND A WRONG GUESS IS CHEAP. A change coin from
 * an earlier spend is stored with the candidate positions the chain's
 * two-output window allowed. An incorrect one cannot be proved, so nothing is
 * submitted and nothing is spent (MIP-0012 INV-5) — so this retries with the
 * next candidate rather than refusing, and the candidate that proves is
 * settled as the coin's position from then on. Only the failures a different
 * position could fix are retried ({@link spendPositionMayBeWrong}); everything
 * else is somebody's proving service or somebody's node, and a retry would ask
 * the person to approve again for nothing.
 *
 * THE CHANGE IS RECORDED BEFORE ANYTHING ELSE HAPPENS. See
 * {@link rememberK1ChangeCoin}: its description exists nowhere but in the
 * value this call returned.
 */
/* WHERE THE PASSKEY ARM PLUGS IN. `session`/`device` here become
   `CustodySession`/`CustodyCallDevice` and the two `k1UserKey(session)` reads
   become `custodyUserKey(session, device)`, exactly as every entry point above
   now does — left to the direct-send builder, who owns this function and its
   challenge builders. */
export async function withdrawShieldedK1(
  session: CustodyDynamicSession,
  device: K256DeviceIdentity,
  request: CustodyShieldedWithdrawRequest,
  onPhase?: (phase: CustodyPhase) => void,
  overrides: Partial<CustodyDeps> = {},
): Promise<CustodyShieldedWithdrawResult> {
  const deps = withDefaults(overrides);
  const wallet = await deps.wallet(k1UserKey(session));
  const record = loadCustodyRecord(deps.storage(), k1UserKey(session), wallet.network.networkId);
  if (!record || record.address === null) {
    throw new Error('This Passport is not finished being set up yet.');
  }
  const account: K1Account = { network: record.network, address: record.address };
  const colour = normalisedColourHex(request.colourHex);
  if (colour === null) throw new Error('That is not something this Passport can send.');
  const colourBytes = hexToBytes(colour);

  let attempt = 0;
  for (;;) {
    const held = heldK1Coin(account, colour);
    if (held === null) {
      throw new Error('There is nothing of that kind in this Passport to send.');
    }
    const coin = {
      nonce: hexToBytes(held.nonce),
      color: hexToBytes(held.colour),
      value: held.value,
      mt_index: held.mtIndex,
    };
    /* WHAT THE SPEND WROTE, BEFORE ANYTHING WAS ASKED OF THE CHAIN. See
       `CustodyCallRequest.onSubmitted`: the change coin's description is the
       circuit's return value and exists nowhere else, so it is written the
       instant the call resolves rather than after `resolveHash` has polled the
       indexer for the chain's own hash. What is recorded here is what the run
       stands on if the tab is closed a moment later. */
    let written: ShieldedChangeWrite | null = null;
    try {
      const step = await k1Call(
        session,
        device,
        {
          operation: 'withdraw_shielded',
          args: [{ bytes: request.recipientCoinPublicKey }, colourBytes, request.amount],
          challenge: (pure, context, pk) =>
            k256Challenges.withdrawShielded(
              pure,
              context,
              pk,
              request.recipientCoinPublicKey,
              colourBytes,
              request.amount,
              coin,
            ),
          onSubmitted: (result, identifier) => {
            /* It proved against this position, which is the only evidence there
               is that the position is the right one. */
            settleK1Coin(account, colour);
            written = writeShieldedChange(account, colour, result, identifier);
          },
        },
        onPhase,
        overrides,
      );
      return await settleShieldedChange(deps, wallet, account, colour, step, written);
    } catch (cause) {
      const message = messageOf(cause);
      /* EITHER TELL. The runtime that could not build the merkle path names it
         in words; the proving service, which is where an unsatisfiable witness
         actually surfaces for these circuits, says only that it declined to
         prove — and that arrives as the error's NAME so the sentence a person
         reads stays plain. */
      if (!spendPositionMayBeWrong(message) && !isCustodyProofNotBuilt(cause)) {
        /* NOT THE POSITION, so this run is over — and the store must not be
           left mid-rotation. A coin persisted at the second candidate is a coin
           whose next press starts there and runs the list out after ONE
           approval, never trying the position the chain offered first. */
        restartK1CoinCandidates(account, colour);
        throw cause;
      }
      const next = advanceK1CoinCandidate(account, colour);
      if (next === null) throw cause;
      attempt += 1;
      console.info(
        `[account-custody] retrying the spend against candidate position ${attempt} of this coin`,
      );
    }
  }
}

/** What the spend wrote down at submission time, for the settle that follows. */
interface ShieldedChangeWrite {
  readonly change: CustodyChangeCoin;
  /** The name the coin was filed under, until the chain's hash is known. */
  readonly txId: string;
}

/**
 * File what the withdrawal returned, in ONE write, asking nothing of anybody.
 *
 * Called from `onSubmitted`, which is to say before `resolveHash` — so this
 * runs while the only thing that has happened is that the call resolved.
 */
function writeShieldedChange(
  account: K1Account,
  colour: string,
  result: unknown,
  identifier: string | null,
): ShieldedChangeWrite {
  const change = changeCoinFromResult(result);
  if (change.outcome === 'unreadable') {
    /* THE VALUE HAS MOVED and this build could not read the description of what
       came back. The coin is not dropped: a dropped coin is a colour this
       Passport silently stops showing. It is recorded as spent with the
       transaction that spent it, so the row can say a payment left and its
       change could not be described, and a later run has the hash to go and
       look. */
    console.warn('[account-custody] the withdrawal succeeded and its change could not be read');
    rememberK1ChangeCoin(account, colour, 'unreadable', identifier ?? 'unknown');
    return { change, txId: identifier ?? 'unknown' };
  }
  if (change.outcome === 'none') {
    rememberK1ChangeCoin(account, colour, null, identifier ?? 'unknown');
    return { change, txId: identifier ?? 'unknown' };
  }
  rememberK1ChangeCoin(
    account,
    colour,
    { colour: change.colour, nonce: change.nonce, value: change.value },
    identifier ?? 'unknown',
  );
  return { change, txId: identifier ?? 'unknown' };
}

/**
 * Learn where the change landed, now that there is a hash to ask about.
 *
 * The write already happened ({@link writeShieldedChange}); this only asks the
 * question. A position that is not learned yet is learned on a later pass,
 * which is the whole reason the store has a place for a coin that has a
 * description and not a position.
 */
async function settleShieldedChange(
  deps: CustodyDeps,
  wallet: LocalMidnightWallet,
  account: K1Account,
  colour: string,
  step: CustodyStepResult,
  written: ShieldedChangeWrite | null,
): Promise<CustodyShieldedWithdrawResult> {
  const change = written?.change ?? changeCoinFromResult(step.result);
  if (change.outcome !== 'change') return { ...step, change, changePosition: 'none' };
  if (step.txHash === null) {
    console.warn('[account-custody] the change coin has no transaction to look its position up by');
    return { ...step, change, changePosition: 'awaiting' };
  }
  /* THE HASH REPLACES THE IDENTIFIER the coin was filed under. The indexer
     answers commitment windows by the chain's hash, and a sponsored
     transaction is superseded, so the id midnight-js returned is not a key it
     can answer — which is exactly how a change coin used to stay "arriving"
     for ever. */
  if (written !== null && written.txId !== step.txHash) {
    renameK1AwaitingTx(account, change.colour, written.txId, step.txHash);
  }
  /* AND `step.txHash` MAY STILL BE THE IDENTIFIER. `resolveTransactionHash`
     polls for ten seconds and then hands back what it was given, which is not
     a failure and reads as an answer — so an indexer more than ten seconds
     behind left the row filed under a name it will never answer for, with
     every later read asking the same unanswerable question (review,
     2026/09/18). The settle below resolves it again when that is what the row
     is holding, which is also what Home's walk does with the same helper.

     THE HASH NAMES THE ROW, not the colour. A colour can have a second coin in
     flight — an earlier spend's change, or a delivery this walk has not placed
     — and settling "the colour" would file one of them and drop the rest. */
  const settled = await settleK1AwaitingCoinByChainHash(
    account,
    change.colour,
    step.txHash,
    (txId) => deps.resolveChainHash(wallet.network.indexerHttpUrl, txId),
    (txId) => deps.commitmentWindow(wallet.network.indexerHttpUrl, txId),
  );
  if (settled.outcome === 'learned') return { ...step, change, changePosition: 'settled' };
  if (settled.outcome === 'ambiguous') {
    return { ...step, change, changePosition: settled.stored ? 'candidates' : 'awaiting' };
  }
  return { ...step, change, changePosition: 'awaiting' };
}

/**
 * A permissionless call on SOMEBODY ELSE's custody account — paying one.
 *
 * The same circuits as {@link custodyPermissionlessCall} and a different
 * contract at the other end, which is the whole of the difference and is worth
 * the separate entry point: `deposit_shielded(coin, entry)` on the recipient's
 * account is how a shielded payment lands, and everything about that call is
 * the SENDER's except the address — the sender's own wallet builds the
 * transaction, the sender's own fees pay for it, and the note being deposited
 * is one the sender holds.
 *
 * THIS PASSPORT'S COIN STORE IS NOT SERVED TO IT. The connection is opened
 * with `account: null`, so the private state is a session-only one under an id
 * of the recipient's address. That is not caution for its own sake: the
 * deposits declare no witness, so there is nothing for a private state to
 * answer, and serving our own store to a connection addressed at somebody
 * else's account would put our coins in the one place a mix-up is expensive.
 *
 * The recipient's record is not ours and is not written. What comes back is
 * the sender's own record, untouched apart from the transaction hash, because
 * that hash is the only thing the sender learned.
 */
export async function custodyPermissionlessCallAt(
  session: CustodySession,
  owner: CustodyOwner,
  targetAddress: string,
  request: { operation: string; args: readonly unknown[] },
  onPhase?: (phase: CustodyPhase) => void,
  overrides: Partial<CustodyDeps> = {},
): Promise<CustodyStepResult> {
  const deps = withDefaults(overrides);
  const user = custodyUserKey(session, owner);
  const wallet = await deps.wallet(user);
  const network = wallet.network.networkId;
  const storage = deps.storage();
  const record = loadCustodyRecord(storage, user, network);
  if (!record || record.address === null || nextCustodyStep(record) !== 'ready') {
    throw new Error('This Passport is not finished being set up yet.');
  }
  if (normalisedColourHex(targetAddress) === null) {
    throw new Error('That Passport cannot be paid from here.');
  }
  const { callTx, providers } = await openCustodyContract(deps, wallet, {
    address: targetAddress,
    /* An id of the RECIPIENT's address, served by the session half of the
       provider rather than by the store — see the header above. */
    privateStateId: `passport-account-custody-peer-${network}-${targetAddress}`,
    account: null,
    initialPrivateState: emptyK1CoinStoreState(),
    circuit: request.operation,
  });
  onPhase?.({ step: 'submit' });
  const call = callTx[request.operation];
  if (!call) throw new Error('That Passport cannot be paid this way.');
  const result = await call(...request.args);
  onPhase?.({ step: 'confirm' });
  const txHash = await resolveHash(providers, result);
  const next: CustodyAccountRecord = {
    ...record,
    txHashes: txHash ? [...record.txHashes, txHash] : record.txHashes,
  };
  saveCustodyRecord(storage, next);
  return {
    record: next,
    txHash,
    explorerUrl: txHash ? custodyExplorerLink(txHash, network) : null,
    result: circuitResultOf(result),
  };
}

/**
 * Leg three into another one of these accounts: the note, and a description of
 * it the recipient can open.
 *
 * TWO ARGUMENTS AND BOTH ARE LOAD-BEARING. `deposit_shielded(coin, entry)`
 * takes the note into the recipient's balance and 192 opaque bytes into its
 * inbox, and the second is the only thing that will ever tell the recipient
 * what it was sent: the chain carries the note, not its description, so a
 * deposit made without a readable entry is a coin that has demonstrably
 * arrived and that nobody can ever move again.
 *
 * THE KEY IS READ LIVE BY THE CALLER AND PASSED IN. An account rotates its
 * encryption key, and an entry sealed to a key it has rotated away from is
 * exactly the coin described above. Callers pass the value they have just
 * read; they must not pass one they read yesterday.
 *
 * This is also the DEPOSIT-BACK: a leg three that failed puts the note into
 * the SENDER's own account by calling this with the sender's own address and
 * the sender's own key, which is one more permissionless deposit and no
 * approval from anybody.
 */
export async function depositShieldedIntoCustody(
  session: CustodySession,
  owner: CustodyOwner,
  request: {
    readonly targetAddress: string;
    readonly recipientEncKeyHex: string;
    readonly coin: { readonly colour: string; readonly nonce: string; readonly value: bigint };
  },
  onPhase?: (phase: CustodyPhase) => void,
  overrides: Partial<CustodyDeps> = {},
): Promise<CustodyStepResult> {
  const { depositShieldedCustody } = await import('./custodyInbox.js');
  const sealed = await depositShieldedCustody(request.recipientEncKeyHex, {
    colour: request.coin.colour,
    nonce: request.coin.nonce,
    value: request.coin.value,
  });
  return custodyPermissionlessCallAt(
    session,
    owner,
    request.targetAddress,
    { operation: 'deposit_shielded', args: [sealed.coin, sealed.entry] },
    onPhase,
    overrides,
  );
}

export async function appendInboxK1(
  session: CustodySession,
  device: CustodyCallDevice,
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
      /* THE ARM PICKS THE CHALLENGE, and the two are not the same kind of
         thing: k256's is finished bytes, jubjub's is a BUILDER, because a
         Schnorr preimage contains its own signature nonce and grind counter.
         `k1Call` asserts it got the kind the arm wants; see GENERALISATION 5. */
      challenge: (pure, context, pk) =>
        device.arm === 'jubjub'
          ? jubjubChallenges.appendInbox(pure, context, pk, entry)
          : k256Challenges.appendInbox(pure, context, pk, entry),
    },
    onPhase,
    overrides,
  );
}

/* -------------------------------------------------------------------------- */
/* Shared plumbing                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The shielded coin `held_coin` hands the circuit, in the compiled build's own
 * field names (`examples/passport-balancer/contracts-stagenet/managed/
 * account-custody/contract/index.d.ts`, `Witnesses<PS>`).
 */
export interface CustodyHeldCoin {
  readonly nonce: Uint8Array;
  readonly color: Uint8Array;
  readonly value: bigint;
  readonly mt_index: bigint;
}

/**
 * The one witness the account custody build declares, answered from the coin store.
 *
 * `held_coin(color)` is how a shielded spend learns WHICH note it is spending:
 * the nonce, the colour, the value, and the note's position in the commitment
 * tree, none of which the chain carries. `./k1CoinStore.ts` is where those
 * live, and because that store is also the private state this connection is
 * served ({@link custodyPrivateStateId}), the witness is a plain read of
 * `context.privateState.coins[colourHex]` — no closure, no second source, and
 * nothing to go stale between the read that built the challenge and the read
 * that builds the proof.
 *
 * A MISSING COIN THROWS ONE SENTENCE. It is a real outcome — a Passport that
 * has been paid nothing of that colour, or one whose store was cleared — and
 * the alternative is worse than an error: a witness returning a zero coin
 * builds a transaction the node rejects for a reason that names none of this.
 * The sentence carries no machinery, because it reaches a person.
 */
export function custodyWitnesses(): {
  held_coin(
    context: { privateState: K1CoinStoreState },
    color: Uint8Array,
  ): [K1CoinStoreState, CustodyHeldCoin];
} {
  return {
    held_coin(context: { privateState: K1CoinStoreState }, color: Uint8Array) {
      const colourHex = normalisedColourHex(bytesToHex(color));
      const coins = context.privateState?.coins;
      const row = colourHex !== null && coins && Object.hasOwn(coins, colourHex)
        ? coins[colourHex]
        : null;
      if (row === null) {
        throw new Error('There is nothing of that kind in this Passport to send.');
      }
      /* The private state is returned UNCHANGED, which is what makes this a
         read. midnight-js writes whatever a witness returns back through the
         provider after the call, so a witness that edited here would be a
         second writer to the store with no idea what the store has learned
         since — see `mergeIntoK1CoinStore`. */
      return [
        context.privateState,
        {
          nonce: hexToBytes(row.nonceHex),
          color: hexToBytes(row.colorHex),
          value: BigInt(row.value),
          mt_index: BigInt(row.mtIndex),
        },
      ];
    },
  };
}

/**
 * THE private-state id for a custody account. One account, one id, for ever.
 *
 * There were two, and that was the defect this resolves. The record makes its
 * own id at deploy time (`passport-account-custody-<user8>`) because the
 * account has no address yet; the coin store keys everything it knows by
 * network and address ({@link k1PrivateStateId}), because a coin belongs to an
 * account on a chain and not to whoever happened to deploy it. Serving the
 * store under one id while midnight-js read and wrote another would mean the
 * witness reading an empty state on every connection — a Passport that can be
 * paid and can never spend.
 *
 * So the address decides as soon as there is one, and the record is rewritten
 * to agree the moment wave 1 lands ({@link runWaveOne}). A record from before
 * this change still resolves to the same id, because this is computed from the
 * address rather than read from the record.
 */
export function custodyPrivateStateId(
  record: Pick<CustodyAccountRecord, 'network' | 'address' | 'privateStateId'>,
): string {
  if (record.address === null) return record.privateStateId;
  return k1PrivateStateId({ network: record.network, address: record.address });
}

/** The account a record names, or null before the deploy has landed. */
function custodyStoreAccount(
  record: Pick<CustodyAccountRecord, 'network' | 'address'>,
): K1Account | null {
  return record.address === null ? null : { network: record.network, address: record.address };
}

/**
 * The private state a connection opens with.
 *
 * It is the STORE's current contents, not an empty map, and the difference is
 * not cosmetic: `findDeployedContract` writes `initialPrivateState` through the
 * provider before it returns anything (`setOrGetInitialPrivateState`), so a
 * connection opening with `{coins:{}}` would be a write of nothing over
 * everything on every call. The provider's merge would survive it; opening
 * with the truth means it never has to.
 */
function custodyPrivateState(record: Pick<CustodyAccountRecord, 'network' | 'address'>): unknown {
  const account = custodyStoreAccount(record);
  return account === null ? emptyK1CoinStoreState() : loadK1CoinStore(account);
}

/**
 * Whether a circuit's proof has to go to the service that holds the big keys.
 *
 * The gated circuits' prover keys are 235 MB and cannot cross a browser, so
 * they go to the sponsor's own proving route ({@link custodyProofProvider}).
 * The permissionless ones — the deposits — are 0.4 MB and 11 MB and prove
 * through the ordinary v3 route `createContractProviders` already built, which
 * is the route every other contract in this app uses. Sending a deposit to the
 * big-key service would work and would put a queue for 235 MB proofs in front
 * of a payment that does not need one.
 */
function custodyNeedsBigKeyProver(circuit: string): boolean {
  return circuit.endsWith('_with_k256') || circuit.endsWith('_with_jubjub');
}

/** Open a deployed custody account for one circuit's proof route. */
async function openCustodyContract(
  deps: CustodyDeps,
  wallet: LocalMidnightWallet,
  target: {
    readonly address: string;
    readonly privateStateId: string;
    readonly account: K1Account | null;
    readonly initialPrivateState: unknown;
    readonly circuit: string;
  },
): Promise<{ callTx: CustodyCallTx; providers: Record<string, unknown> }> {
  const providers = await deps.providers(wallet, target.privateStateId, target.account);
  /* The proof provider is per-CIRCUIT, because the service is told which key to
     use. Everything else in the set is shared. */
  const scoped = custodyNeedsBigKeyProver(target.circuit)
    ? {
        ...providers,
        proofProvider: custodyProofProvider({
          endpoint: custodyProvingEndpoint(sponsorConfig()?.url ?? null),
          network: wallet.network.networkId,
          circuit: target.circuit,
          deserialise: (providers.deserialiseUnbound as (b: Uint8Array) => unknown) ?? identity,
        }),
      }
    : providers;
  const contracts = await deps.contracts();
  const deployed = await contracts.findDeployedContract(scoped, {
    compiledContract: providers.compiledContract,
    contractAddress: target.address,
    privateStateId: target.privateStateId,
    initialPrivateState: target.initialPrivateState,
  });
  return { callTx: deployed.callTx, providers: scoped };
}

/** Open THIS Passport's own account — the common case. */
async function openCustodyAccount(
  deps: CustodyDeps,
  wallet: LocalMidnightWallet,
  record: CustodyAccountRecord,
  circuit: string,
): Promise<{ callTx: CustodyCallTx; providers: Record<string, unknown> }> {
  return openCustodyContract(deps, wallet, {
    address: record.address as string,
    privateStateId: custodyPrivateStateId(record),
    account: custodyStoreAccount(record),
    initialPrivateState: custodyPrivateState(record),
    circuit,
  });
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
/** midnight-js's own transaction id, or null when the result carries none. */
function identifierOf(result: unknown): string | null {
  try {
    return transactionId(result);
  } catch {
    return null;
  }
}

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
 * THE PASSKEY FIRST, WHEN THERE IS ONE, AND IT IS ASKED RATHER THAN READ. A
 * derived authority is written nowhere — not into this map, not into the
 * private-state provider, not into `localStorage` — so the only place it can
 * come from is the secret the passkey derived it from, and re-deriving costs a
 * hash. That is what lets the key survive a reinstall without also sitting in
 * this origin's storage until somebody reads it.
 *
 * THEN THREE PLACES FOR A SAMPLED ONE, AND THE ORDER IS THE POINT. This tab's
 * own map is first because it is free. The private-state provider is second,
 * because that is where midnight-js's own deploy puts it and a durable one
 * would answer here. And `localStorage` is third and is the one that actually
 * survives a reload today, because the provider this app builds is
 * `inMemoryPrivateStateProvider` — so without it a reload between wave 1 and
 * wave 3 left a live account nobody could finish. See
 * {@link CUSTODY_AUTHORITY_STORAGE_KEY} for what that costs and why it is paid.
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
  derivedAuthority: (() => unknown) | null,
): Promise<unknown> {
  if (derivedAuthority !== null) return derivedAuthority();
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
  session: CustodySession,
  owner: CustodyOwner,
  overrides: Partial<CustodyDeps> = {},
): Promise<void> {
  const deps = withDefaults(overrides);
  const user = custodyUserKey(session, owner);
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
    providers: async (wallet, privateStateId, account = null) => {
      const [providers, compiledContract, ledgerModule] = await Promise.all([
        createContractProviders(wallet, {
          contract: ACCOUNT_CUSTODY_CONTRACT,
          privateStateId,
          initialPrivateState:
            account === null ? emptyK1CoinStoreState() : loadK1CoinStore(account),
        }),
        compiledContractFor(ACCOUNT_CUSTODY_CONTRACT, ACCOUNT_CUSTODY_LABEL, custodyWitnesses()),
        import('@midnightntwrk/ledger-v9'),
      ]);
      return {
        ...(providers as Record<string, unknown>),
        /* THE STORE IS THE PRIVATE STATE. `createContractProviders` builds an
           in-memory provider, which is the right answer for a device secret
           the caller has just handed over and the wrong one for a coin: a
           qualified description exists nowhere but here, so a provider that
           does not outlive the connection is a balance that cannot be spent
           after a reload. Substituted rather than parameterised inside
           `contractRuntime.ts`, because the coin store is this module's
           concern and every other contract in the app wants the in-memory
           one. */
        ...(account === null ? {} : { privateStateProvider: k1PrivateStateProvider(account) }),
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
    /* BY THE CHAIN'S HASH, which is the only offset this indexer answers a
       commitment window at (`docs/demo/account-custody-layer-design.md` §3b,
       the live run of 2026/09/18). What is handed in here IS a hash:
       `settleShieldedChange` renames the awaiting row to it before asking, for
       exactly that reason. This was `resolveTxCommitmentWindowOnce`, which asks
       at `offset: { identifier: … }` — so the withdrawal's own settle asked a
       question the indexer cannot answer with a value it would not have
       recognised either way, and the change coin could only ever be placed by
       the next read of Home. */
    commitmentWindow: (indexerHttpUrl, txId) =>
      resolveTxCommitmentWindowByHashOnce(indexerHttpUrl, txId),
    resolveChainHash: (indexerHttpUrl, txId) => resolveTxHashOnce(indexerHttpUrl, txId),
    now: () => Date.now(),
    sleep: (milliseconds) =>
      new Promise((resolve) => {
        globalThis.setTimeout(resolve, milliseconds);
      }),
  };
}
