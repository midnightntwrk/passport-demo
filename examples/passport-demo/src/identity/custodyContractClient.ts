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
  enrolmentEntry,
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
  custodyProofNotBuiltDetail,
  isCustodyProofNotBuilt,
  CUSTODY_SEND_FAILED,
  CUSTODY_SEND_NOT_SENT,
  CUSTODY_SEND_UNCONFIRMED,
  CUSTODY_SUBMIT_WAIT_MS,
  CUSTODY_PREPARE_WAIT_MS,
  CUSTODY_STATE_RACE_RETRIES,
  CUSTODY_STATE_RACE_WAIT_MS,
  CUSTODY_SPENT_COIN_RETRIES,
  custodyCoinAlreadySpent,
  custodyNodeRefused,
  custodyRebuildOnRefusal,
  custodyRebuildRefusal,
  withinCustodyBound,
  type CustodyTxOutcome,
  custodySubmitVerdict,
  CUSTODY_SETUP_INTERRUPTED,
  CUSTODY_SETUP_UNCONFIRMED,
  custodyActivatedRecord,
  custodyAlreadyActivated,
  custodyAnswerWasLost,
  loadCustodyAuthorityKey,
  loadCustodyRecord,
  newCustodyRecord,
  nextCustodyStep,
  custodyWavesPending,
  custodySubmitOnLiveConnection,
  type CustodySubmitRoute,
  CUSTODY_STILL_FINISHING,
  CUSTODY_KEY_NOT_ADDED,
  CUSTODY_KEY_UNCONFIRMED,
  CUSTODY_KEY_RECHECKS,
  CUSTODY_KEY_RECHECK_WAIT_MS,
  CUSTODY_PHASE_PROVED,
  parseProveCustodyResponse,
  proveAccountCustodyDetail,
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
  contractZkConfigProvider,
  createContractProviders,
  walletProviderFor,
  loadContractModule,
  messageOf,
  resolveTransactionHash,
  resolveTxCommitmentWindowByHashOnce,
  resolveTxHashOnce,
  resolveTxOutcomeOnce,
} from './contractRuntime.js';
import { transactionIdentifierOf } from '../lib/chainWait.js';
import { custodyAccountLock, type CustodyAccountLock } from '../lib/custodyAccountLock.js';
import {
  advanceK1CoinCandidate,
  emptyK1CoinStoreState,
  forgetSpentK1Coins,
  heldK1Coin,
  k1AccountKey,
  k1CoinPositionsLeft,
  k1PrivateStateId,
  landK1Spend,
  k1PrivateStateProvider,
  loadK1CoinStore,
  rememberK1ChangeCoin,
  rememberK1EncSecretKey,
  renameK1AwaitingTx,
  restartK1CoinCandidates,
  pinK1CoinPosition,
  settleK1AwaitingCoinByChainHash,
  settleK1Coin,
  undoK1ChangeCoin,
  widenK1CoinCandidates,
  type K1Account,
  type K1CoinStoreState,
  type K1HeldCoin,
} from './k1CoinStore.js';
import { normalisedColourHex } from '../lib/colour.js';
import {
  changeCoinFromResult,
  custodyChangeBackfill,
  directSpendFromResult,
  spendFailureText,
  spendPositionMayBeWrong,
  spendRefusalMayBePosition,
  zswapLeafIndex,
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
  /**
   * The transaction's id, on the `confirm` of a spend and nowhere else.
   *
   * IT IS THE LINE BETWEEN TWO DIFFERENT TRUTHS a person can be told. Before it
   * there is no transaction and "nothing was sent" is a fact; after it there is
   * one and the honest answer is "it landed or it did not". The screen writes
   * it into the stored record the moment it arrives, so a tab closed a second
   * later still knows which of the two it is owed.
   */
  readonly txId?: string;
  /**
   * What the submit wrote to the coin store, on the same `confirm` — so the
   * screen can store it beside the id and take it back after a reload if the
   * chain turns out never to have recorded the payment.
   */
  readonly undo?: {
    readonly held: K1HeldCoin;
    readonly change: { readonly colour: string; readonly nonce: string } | null;
  };
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
   * How long a submitted payment is waited on before the account is asked
   * whether it ran — see {@link CUSTODY_SUBMIT_WAIT_MS}. Injected so a drill
   * of a payment that never lands does not wait three minutes.
   */
  submitWaitMs?: number;
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
  /**
   * How long everything before a payment is handed over may take — see
   * {@link CUSTODY_PREPARE_WAIT_MS}. Injected so a drill of a step that hangs
   * does not wait two minutes.
   */
  prepareWaitMs?: number;
  /** How long proving and balancing may take before an unbooked attempt is abandoned. */
  handoverWaitMs?: number;
  /** How long a payment the node refused for a moved state waits before it is built again. */
  stateRaceWaitMs?: number;
  /** The identifier a balanced transaction will be submitted under. `../lib/chainWait.ts`'s by default. */
  identifierOf?(balanced: unknown): string | null;
  /** What the indexer says of one transaction — `contractRuntime.ts`'s `resolveTxOutcomeOnce`. */
  txOutcome?(
    indexerHttpUrl: string,
    txId: string,
  ): Promise<{ outcome: CustodyTxOutcome; hash: string | null } | null>;
  /**
   * Forget the connection this user's payments are made on, so the next one
   * opens afresh. Called when a payment's submission was lost: the socket that
   * lost it is not trusted with the next one.
   */
  releaseWallet?(user: string): void;
  /** One transaction per account at a time — `../lib/custodyAccountLock.ts`. */
  accountLock?: CustodyAccountLock;
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
  /**
   * One call, executed and turned into an unproven transaction, and NOT sent.
   *
   * The seam a composed transaction is built through: the sender's spend and
   * the recipient's claim are each created here, the claim's intent is grafted
   * onto the spend, and the pair goes to {@link CustodyContractsApi.submitTx}
   * once. It is also how a spend reads `[sent, change]` before anything leaves
   * the tab.
   */
  createUnprovenCallTx(providers: unknown, options: unknown): Promise<unknown>;
  submitTx(providers: unknown, options: unknown): Promise<unknown>;
  /**
   * Prove, balance, and submit — and come back with the id, not the outcome.
   *
   * THE HALF OF `submitTx` A SPEND NEEDS. `submitTx` is this followed by an
   * unbounded `watchForTxData`, so a caller using it cannot write anything down
   * between the node taking the transaction and the chain ruling on it. A
   * shielded spend has to: the change coin's description is the circuit's
   * return value and exists nowhere else, and the wait is where the sockets
   * drop. See {@link spendShieldedK1}.
   */
  submitTxAsync(providers: unknown, options: unknown): Promise<string>;
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

/**
 * How long a step whose answer was lost is given to prove itself on the chain.
 *
 * TWO MINUTES, AND IT IS A CEILING RATHER THAN A WAIT. Nothing spends this
 * unless a submission's own answer failed to arrive; a transaction that was
 * included is visible within a block or two, and one that was never taken is
 * not going to appear at all. Past the ceiling the person is told the true
 * thing — {@link CUSTODY_SETUP_UNCONFIRMED} — rather than being held for ever
 * against a node that is not answering.
 */
export const CUSTODY_CONFIRM_WAIT_MS = 120_000;
const CUSTODY_CONFIRM_POLL_MS = 3_000;

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
  /**
   * Every circuit the transaction calls, for the service to stage the keys.
   *
   * A LIST because a transaction may have two calls in it — a direct transfer
   * is one. The service proves the transaction, not a named circuit; the names
   * are what let it refuse an unstaged one by name.
   */
  readonly circuits: readonly string[];
  /** Rehydrates the proven bytes. Injected so a drill needs no ledger WASM. */
  readonly deserialise: (bytes: Uint8Array) => unknown;
  readonly fetchFn?: typeof fetch;
  /** Overridable so a drill does not wait four minutes to watch one expire. */
  readonly timeoutMs?: number;
  /**
   * Called the moment a proof comes back, and never if one does not.
   *
   * THE PHASE LINE A SPEND RETRIES ON. `submitTx` proves, balances and submits
   * behind one call, so a caller that catches its failure cannot otherwise tell
   * a proof that was refused — nothing submitted, safe to try another candidate
   * position — from a submission that failed after the transaction was already
   * away. This fires between the two, so `spendShieldedK1` can.
   */
  readonly onProved?: () => void;
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
      const body = proveAccountCustodyRequest(
        options.circuits,
        unprovenTx.serialize(),
        options.network,
      );
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
          `[account-custody] could not reach the proving service at ${options.endpoint} for ${options.circuits.join(' + ')}`,
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
        /* THE SERVICE'S OWN WORDS TRAVEL WITH IT. The refusal arms a retry
           against the next candidate position and a retry costs an approval,
           so the caller has to be able to ask whether this refusal was about a
           position at all — and the message it throws is the sentence a person
           reads, which cannot answer that. */
        if (proveAccountCustodyRefused(parsed)) {
          throw custodyProofNotBuilt(proveAccountCustodyDetail(parsed));
        }
        throw new Error(CUSTODY_PROVER_UNAVAILABLE);
      }
      const proven = options.deserialise(parseProveCustodyResponse(parsed));
      /* AFTER the response is known good and rehydrated, so a parse failure is
         still a pre-proof failure. Everything past this line is balancing and
         submission, which nothing may retry. */
      options.onProved?.();
      return proven;
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
  return rebuildSetupStep('the setup', overrides, async () => {
    const plan = await prepareCustodyDeploy(session, device, onPhase, overrides);
    const landed = await landWaveOne(plan, onPhase);
    const record = await landRemainingWaves(plan, landed.record, landed.onChain, onPhase);
    return custodyStepResult(record, plan.network);
  });
}

/**
 * A setup entry point, run again when the node refused it without applying it
 * (104 or 196 — see `custodyRebuildRefusal`), before anything is surfaced.
 *
 * LIVE ON THE DEV SITE, 2026/09/23 17:44 UTC. A second Passport's activation
 * was refused with `Custom error: 196`: the sponsor had paid its fee and the
 * first Passport's background wave from the same DUST coin. Nothing was
 * applied, and the next press activated at once — so the press is no longer
 * asked for. The WHOLE entry point runs again, not the transaction: each one
 * reads the chain before it sends (a deploy that landed, a wave the counter
 * shows, an account already booted), so a second run never pays twice.
 */
function rebuildSetupStep<T>(
  what: string,
  overrides: Partial<CustodyDeps>,
  step: () => Promise<T>,
): Promise<T> {
  const deps = withDefaults(overrides);
  return custodyRebuildOnRefusal(what, step, {
    sleep: (milliseconds) => deps.sleep(milliseconds),
    waitMs: deps.stateRaceWaitMs ?? CUSTODY_STATE_RACE_WAIT_MS,
    log: (line) => console.info(line),
  });
}

/** What {@link deployCustodyWaveOne} can be told while it runs. */
export interface CustodyWaveOneOptions {
  /**
   * Called ONCE, the moment the node has taken the deploy — before it is in a
   * block, and long before the indexer serves it. The address is final from
   * here: it is derived from the state the deploy carries, not from where it
   * lands.
   *
   * WHAT IT IS FOR is the name. The sponsor's registration accepts a target
   * that is submitted and not yet served (`targetPending`), and checks it only
   * before `register_domain_for` — several proofs and a block later. So the
   * claim can start here and run beside everything that follows, instead of
   * waiting for the account, its activation, and its funding in turn.
   *
   * Not called when the deploy had already landed on an earlier press; the
   * caller has the address off the returned record then.
   */
  readonly onSubmitted?: (address: string) => void;
}

/**
 * The deploy, and nothing after it — wave 1 only.
 *
 * WHY THIS EXISTS BESIDE {@link deployCustodyAccount} (2026/09/22). A full
 * deploy is the deploy plus every maintenance wave, and each wave is a
 * dependent transaction: included, then read back through an indexer that runs
 * twenty-odd seconds behind, before the next can be built. Four of them in a
 * row were seventy seconds of a four-minute setup, and none of them is needed
 * to USE the Passport — wave 1 carries the two deposits and every circuit of
 * the device's own arm, activation included (`planCustodyWaves`). So the setup
 * press lands this, activates, shows Home, and runs
 * {@link finishCustodyWaves} behind it.
 *
 * Resumable exactly as the full deploy is: an account the chain already
 * carries is not deployed again.
 */
export async function deployCustodyWaveOne(
  session: CustodySession,
  device: CustodyDeviceIdentity,
  onPhase?: (phase: CustodyPhase) => void,
  overrides: Partial<CustodyDeps> = {},
  options: CustodyWaveOneOptions = {},
): Promise<CustodyStepResult> {
  return rebuildSetupStep('the first step', overrides, async () => {
    const plan = await prepareCustodyDeploy(session, device, onPhase, overrides);
    const { record } = await landWaveOne(plan, onPhase, options.onSubmitted);
    return custodyStepResult(record, plan.network);
  });
}

/**
 * Waves 2 and up, for an account whose deploy has landed.
 *
 * RUN BEHIND HOME, and resumable by the same rule every wave has always kept:
 * the chain is read first, a wave it already carries is recorded rather than
 * paid for twice, and a wave is recorded only once the counter shows it
 * applied. So a tab closed half-way through leaves a record the next run picks
 * up from, and the wave that was in flight is either on the chain or sent
 * again — never skipped.
 *
 * It needs the same device as the deploy: a passkey's maintenance authority is
 * DERIVED from it and written nowhere, so there is no finishing without the
 * key that started. A record with nothing on chain is refused rather than
 * deployed — this is the finishing half, and a deploy belongs to the press.
 */
export async function finishCustodyWaves(
  session: CustodySession,
  device: CustodyDeviceIdentity,
  onPhase?: (phase: CustodyPhase) => void,
  overrides: Partial<CustodyDeps> = {},
): Promise<CustodyStepResult> {
  return rebuildSetupStep('a setup wave', overrides, async () => {
    const plan = await prepareCustodyDeploy(session, device, onPhase, overrides);
    const onChain =
      plan.record.address === null
        ? null
        : await readCustodyChainOperations(plan.providers, plan.ledgerApi, plan.record.address, plan.waves);
    if (onChain === null) throw new Error('There is no Passport to finish yet.');
    const record = await landRemainingWaves(plan, plan.record, onChain, onPhase);
    return custodyStepResult(record, plan.network);
  });
}

/** The result every deploy entry point hands back. */
function custodyStepResult(record: CustodyAccountRecord, network: string): CustodyStepResult {
  const txHash = record.txHashes[record.txHashes.length - 1] ?? null;
  return { record, txHash, explorerUrl: txHash ? custodyExplorerLink(txHash, network) : null };
}

/** Everything a wave needs, gathered once per entry point. */
interface CustodyDeployPlan {
  readonly deps: CustodyDeps;
  readonly network: string;
  readonly storage: CustodyStorage;
  readonly record: CustodyAccountRecord;
  readonly device: CustodyDeviceIdentity;
  readonly module: CustodyContractModule;
  readonly ledgerApi: CustodyLedgerApi;
  readonly contracts: CustodyContractsApi;
  readonly providers: Record<string, unknown>;
  readonly verifierKeys: Map<string, Uint8Array>;
  readonly waves: CustodyWave[];
  readonly derivedAuthority: (() => unknown) | null;
}

async function prepareCustodyDeploy(
  session: CustodySession,
  device: CustodyDeviceIdentity,
  onPhase: ((phase: CustodyPhase) => void) | undefined,
  overrides: Partial<CustodyDeps>,
): Promise<CustodyDeployPlan> {
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
  const waves = planCustodyWaves(sizes, device.arm, custodyRetiresAuthority(device));
  record = { ...record, totalWaves: waves.length };
  /* Decided ONCE, from the plan this deploy will actually run, and handed to
     both wave runners: the one that builds the authority and the one that has
     to sign with it. See {@link derivedMaintenanceAuthority}. */
  const derivedAuthority = derivedMaintenanceAuthority(ledgerApi, device, waves);
  return {
    deps,
    network,
    storage,
    record,
    device,
    module,
    ledgerApi,
    contracts,
    providers,
    verifierKeys,
    waves,
    derivedAuthority,
  };
}

/** Wave 1, unless the chain already carries it. */
async function landWaveOne(
  plan: CustodyDeployPlan,
  onPhase?: (phase: CustodyPhase) => void,
  onSubmitted?: (address: string) => void,
): Promise<{ record: CustodyAccountRecord; onChain: Set<string> }> {
  const { deps, device, derivedAuthority, module, ledgerApi, contracts, providers, storage, waves } = plan;
  /* What the chain already carries, read ONCE before any wave runs. Null means
     there is nothing at that address — either no deploy yet, or a deploy that
     was recorded and never landed — and both answers are the same wave. */
  const onChain =
    plan.record.address === null
      ? null
      : await readCustodyChainOperations(providers, ledgerApi, plan.record.address, waves);
  if (onChain !== null) return { record: plan.record, onChain };

  onPhase?.({ step: 'deploy', detail: `1 of ${waves.length}` });
  const record = await runWaveOne({
    deps,
    record: plan.record,
    device,
    derivedAuthority,
    wave: waves[0],
    module,
    ledgerApi,
    contracts,
    providers,
    storage,
    onSubmitted,
  });
  return { record, onChain: new Set(waves[0].circuits) };
}

/** Waves 2 and up, skipping any the chain already carries. */
async function landRemainingWaves(
  plan: CustodyDeployPlan,
  landed: CustodyAccountRecord,
  onChain: ReadonlySet<string>,
  onPhase?: (phase: CustodyPhase) => void,
): Promise<CustodyAccountRecord> {
  const { deps, derivedAuthority, verifierKeys, ledgerApi, providers, storage, waves } = plan;
  let record = landed;
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
    /* ONE TRANSACTION ON THIS ACCOUNT AT A TIME (2026/09/22). Behind Home a
       wave is a custody transaction on the same account as a payment or the
       inbox backfill, and two in flight at once is what the node refused with
       `Custom error: 104`. So each wave takes the account's lock — per wave,
       not for the run, so a payment waits one wave (~25 s) at most — and
       reads the stored record INSIDE it, after whatever held the lock last
       has written. */
    const address = record.address as string;
    record = await (deps.accountLock ?? custodyAccountLock()).run(
      k1AccountKey({ network: record.network, address }),
      CUSTODY_WAVE_LOCK_WAIT_MS,
      () => runMaintenanceWave({
      deps,
      /* THE STORED RECORD, NOT THE ONE THIS PLAN READ. Behind Home the
         activation lands while these waves run, and each wave writes the
         record it was handed back with one more wave on it — so writing from a
         copy read before the activation would put `activated: false` back over
         a Passport whose key is on. Reading afresh keeps both writers' facts. */
      record: {
        ...(loadCustodyRecord(storage, record.user, record.network) ?? record),
        totalWaves: record.totalWaves,
      },
      derivedAuthority,
      wave,
      verifierKeys,
      ledgerApi,
      providers,
      storage,
    }),
    );
  }
  return record;
}

/**
 * How long a wave waits for the account behind a payment.
 *
 * Longer than a payment's own wait, because a wave is behind Home and nobody is
 * watching it: a payment holds the account for at most its submit wait
 * (`CUSTODY_SUBMIT_WAIT_MS`), and the wave simply goes after it.
 */
export const CUSTODY_WAVE_LOCK_WAIT_MS = 5 * 60 * 1000;

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
 * Whether this account's maintenance authority is thrown away on the last wave.
 *
 * HECTOR DECIDED THIS ON 2026/09/18, and decided it for one reason: the
 * prototype accounts made this week cannot take a circuit fix. A retired
 * authority makes the account immutable — no verifier key can ever be replaced
 * — so a defect in a circuit means a fresh account and a migration of
 * everything in the old one, which is exactly the position those Passports are
 * in and exactly what he did not want to repeat.
 *
 * SO A PASSKEY KEEPS IT, and only a passkey. The cost of keeping it is that
 * whoever can complete the assertion can replace a verifier key and therefore
 * replace the rule that guards the coins, which is a strictly larger prize than
 * the balance; the cost of retiring it is an account nobody can ever fix. What
 * makes keeping it worth having is that the key is DERIVED from the passkey and
 * never written down (see `PASSPORT_MAINTENANCE_LABEL`), so it survives a
 * reinstall for exactly as long as the passkey does.
 *
 * A k256 device carries no derived key — the vendor's signatures are randomised
 * and there is nothing deterministic to hash — so a kept authority there would
 * be backed by a sampled key living in one browser: an authority nobody holds,
 * which is the worst of both answers. That arm retires, as it always has, and
 * the Dynamic product is parked in any case.
 */
function custodyRetiresAuthority(device: CustodyDeviceIdentity): boolean {
  return !('maintenanceSecretHex' in device && device.maintenanceSecretHex !== undefined);
}

/**
 * The maintenance signing key the passkey hands down — or null, which is the
 * answer for a device that carries none.
 *
 * TWO CONDITIONS, AND THE SECOND ONE WAS MISSING. A device that carries a
 * `maintenanceSecretHex` was enough to take this branch, so a passkey Passport
 * got an authority built from a secret derived from somebody's authenticator
 * ON A PLAN THAT RETIRES THE AUTHORITY TWO WAVES LATER. That is a derived
 * upgrade secret created, stored, and made worthless in the same setup. The
 * plan is now asked NOT to retire for exactly the devices that carry a key
 * ({@link custodyRetiresAuthority}), so the two conditions agree by
 * construction; the second is kept because a plan is a value a caller can hand
 * in, and a key built against a plan that retires is still worthless.
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
    /** See {@link CustodyWaveOneOptions.onSubmitted}. */
    onSubmitted?: (address: string) => void;
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

  /* SUBMITTED AND WAITED FOR, SPLIT, and the split is the fix. `submitTx` is
     `submitTxAsync` followed by an unbounded `watchForTxData`, so a caller
     using it cannot tell a transaction that was never sent from one that was
     sent and whose answer was lost — and the two want opposite responses.
     Everything up to and including the node taking the transaction is reported
     the moment it fails, unchanged; only the WAIT is settled against the
     chain. The address is known before anything is sent, so the question is
     available: is there a contract at it? Without this, a dropped socket here
     costs a whole second account — the record has no address, the next press
     deploys again, and the first one sits on chain for ever holding nothing. */
  const txId = await contracts.submitTxAsync(providers, { unprovenTx });
  /* THE NODE HAS IT, so the address is real from here. A caller's own failure
     is its own business and must not be mistaken for the deploy's. */
  try {
    context.onSubmitted?.(address);
  } catch (cause) {
    console.warn('[account-custody] the caller could not act on the submitted deploy', cause);
  }
  try {
    await watchForTxData(providers, txId);
  } catch (cause) {
    if (!custodyAnswerWasLost(cause)) throw cause;
    console.info('[account-custody] the answer to the first step was lost; asking the chain', messageOf(cause));
    if (!(await awaitCustodyDeployed(deps, providers, address))) {
      throw new Error(CUSTODY_SETUP_UNCONFIRMED);
    }
  }
  const txHash = await resolveHash(context.providers, { txId });

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
  /* THE SAME SPLIT AS THE DEPLOY, and the same reason. A lost WAIT needs no
     new machinery here: the counter wait below already polls the chain for two
     minutes and already refuses on its own deadline, so a wave whose answer
     never arrived falls through to it rather than out of the function — the
     counter moving is the update landing, whoever did or did not hear about
     it. A failure before the node took the transaction still goes straight
     out, because there is nothing for the chain to have an opinion about. */
  const txId = await contracts.submitTxAsync(providers, { unprovenTx });
  try {
    await watchForTxData(providers, txId);
  } catch (cause) {
    if (!custodyAnswerWasLost(cause)) throw cause;
    console.info('[account-custody] the answer to this step was lost; the counter will settle it', messageOf(cause));
  }
  const txHash = await resolveHash(providers, { txId });

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
/* What the chain says about an account                                       */
/* -------------------------------------------------------------------------- */

/**
 * Whether the account at `address` is turned on, or null when it cannot be read.
 *
 * NULL IS NOT FALSE, and the distinction is the reason this returns three
 * answers rather than two. `booted` is what the activation circuit asserts on,
 * so false means the circuit will run and true means it will refuse; but an
 * indexer that did not answer knows neither, and reading its silence as false
 * is what would send a second activation at an account that already has one.
 * Every caller below treats null as "ask again", never as "not yet".
 */
async function custodyAccountBooted(
  providers: Record<string, unknown>,
  module: CustodyContractModule,
  address: string,
): Promise<boolean | null> {
  try {
    return module.ledger(await queryStateData(providers, address)).booted;
  } catch (cause) {
    console.info('[account-custody] this Passport could not be read just now', messageOf(cause));
    return null;
  }
}

/**
 * Wait, to a ceiling, for the chain to show the account turned on.
 *
 * ONLY EVER REACHED BY A LOST ANSWER. A submission that came back with a
 * verdict does not come here; this is what a dropped socket costs, and what it
 * buys is the difference between a Passport that works and a sentence saying it
 * does not. See {@link CUSTODY_CONFIRM_WAIT_MS}.
 */
async function awaitCustodyBooted(
  deps: CustodyDeps,
  providers: Record<string, unknown>,
  module: CustodyContractModule,
  address: string,
): Promise<boolean> {
  const deadline = deps.now() + CUSTODY_CONFIRM_WAIT_MS;
  for (;;) {
    if ((await custodyAccountBooted(providers, module, address)) === true) return true;
    if (deps.now() >= deadline) return false;
    await deps.sleep(CUSTODY_CONFIRM_POLL_MS);
  }
}

/** The same wait for wave 1: is there a contract at the address we built? */
async function awaitCustodyDeployed(
  deps: CustodyDeps,
  providers: Record<string, unknown>,
  address: string,
): Promise<boolean> {
  const reader = providers.publicDataProvider as {
    queryContractState(address: string): Promise<unknown>;
  };
  const deadline = deps.now() + CUSTODY_CONFIRM_WAIT_MS;
  for (;;) {
    const state = await reader.queryContractState(address).catch(() => null);
    if (state) return true;
    if (deps.now() >= deadline) return false;
    await deps.sleep(CUSTODY_CONFIRM_POLL_MS);
  }
}

/**
 * Whether the account a record names is already turned on, asked of the chain.
 *
 * FOR A SCREEN OPENING ONTO A RECORD IT DOES NOT TRUST. The record says what
 * this browser managed to write down; a confirmation that never arrived leaves
 * it saying `activated: false` about an account that is activated and working.
 * One read settles it, and it costs no ceremony: the device is not needed to
 * ask, only to act.
 *
 * Null for a chain that could not be asked, false for a record with no address
 * — neither of which is a reason to change anything.
 */
export async function custodyAccountActivatedOnChain(
  record: CustodyAccountRecord,
  overrides: Partial<CustodyDeps> = {},
): Promise<boolean | null> {
  if (record.address === null) return false;
  const deps = withDefaults(overrides);
  const wallet = await deps.wallet(record.user);
  const [module, providers] = await Promise.all([
    deps.contractModule(),
    deps.providers(wallet, custodyPrivateStateId(record), custodyStoreAccount(record)),
  ]);
  return custodyAccountBooted(providers, module, record.address);
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
  /* Run again on a curable refusal; the chain is read first on every run. */
  return rebuildSetupStep('the activation', overrides, () =>
    activateK1DeviceOnce(session, device, onPhase, overrides),
  );
}

async function activateK1DeviceOnce(
  session: CustodySession,
  device: CustodyDeviceIdentity,
  onPhase: ((phase: CustodyPhase) => void) | undefined,
  overrides: Partial<CustodyDeps>,
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

  const module = await deps.contractModule();
  const providers = await deps.providers(
    wallet,
    custodyPrivateStateId(record),
    custodyStoreAccount(record),
  );

  /**
   * The finished record, written down once, wherever this call decides the
   * account is on: because the chain already said so, because the circuit said
   * so, or because the chain said so after the answer was lost.
   */
  const settle = (txHash: string | null): CustodyStepResult => {
    const next = custodyActivatedRecord(record, device, txHash);
    saveCustodyRecord(storage, next);
    return {
      record: next,
      txHash,
      explorerUrl: txHash ? custodyExplorerLink(txHash, network) : null,
    };
  };

  /* THE CHAIN BEFORE THE CIRCUIT, the same rule the waves above keep. The
     record says what this browser wrote down and the account says what
     happened, and when they disagree the account wins: an activation that
     landed while the confirmation was lost leaves `activated: false` over a
     Passport that works, and running the circuit again is a dry run that
     throws `failed assert: already activated` — which is what a reader was
     shown as "Something went wrong" on 2026/09/22, about their own finished
     Passport. A read that cannot be made changes nothing and the call proceeds
     as it always did. */
  if ((await custodyAccountBooted(providers, module, record.address)) === true) {
    return settle(null);
  }

  onPhase?.({ step: 'activate' });
  /* GENERALISATION 3 of 5: the activation circuit and ITS ARGUMENT LIST.
     The two arms do not take the same arguments -- `_with_jubjub` is
     `(pk, salt)` and `_with_k256` is `(pk, salt, envelope)`, because an
     envelope is a property of a vendor wrapping bytes before signing them and
     there is no vendor on the passkey arm. The circuit is also not a free
     choice: the constructor's boot commitment binds the arm, so an account
     deployed with a passkey can only ever be opened by
     `activate_initial_device_with_jubjub`. */
  const circuit = `activate_initial_device_with_${device.arm}`;
  const { callTx } = await openCustodyAccount(deps, wallet, record, [circuit]);
  const salt = hexToBytes(record.saltHex);
  const activationArgs =
    device.arm === 'jubjub' ? [device.pk, salt] : [device.pk, salt, device.envelope];

  let result: unknown;
  try {
    result = await callTx[circuit]?.(...activationArgs);
  } catch (cause) {
    /* ALREADY ON IS DONE, NOT BROKEN. The assert fires on `booted`, nothing
       ever clears it, and the account it fires about is this one — so the only
       honest reading of it is that the work this call exists to do is already
       finished. It is checked before the read below because it is an answer
       and the read is a question. */
    if (custodyAlreadyActivated(cause)) {
      console.info('[account-custody] this Passport was already turned on', messageOf(cause));
      return settle(null);
    }
    /* A LOST ANSWER IS NOT A LOST TRANSACTION, and it is the only failure this
       waits on. The socket to the node drops on this network often enough to
       have its own history (2026/09/05, 2026/09/07, 2026/09/22), and it drops
       while the tab is waiting on a transaction that is already in a block —
       so the chain is asked, under "Confirming", because that is what is
       happening. Every other failure is a verdict or a refusal and is reported
       at once, exactly as it always was: waiting on one buys nothing and costs
       somebody two minutes. */
    if (!custodyAnswerWasLost(cause)) throw cause;
    onPhase?.({ step: 'confirm' });
    console.info('[account-custody] the answer to this step was lost; asking the chain', messageOf(cause));
    if (!(await awaitCustodyBooted(deps, providers, module, record.address))) {
      throw new Error(CUSTODY_SETUP_UNCONFIRMED);
    }
    return settle(null);
  }

  onPhase?.({ step: 'confirm' });
  return settle(await resolveHash(providers, result));
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
  /**
   * A PAYMENT, submitted and waited on separately and for a BOUNDED time
   * (2026/09/22) — the same discipline the shielded spend follows. A
   * transaction the chain never records is settled as not sent once the
   * account shows it did not run, rather than holding a sheet on "Submitted"
   * for ever. Setup steps leave this off and keep midnight-js's own wait.
   */
  readonly bounded?: boolean;
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
  const prepareMs = deps.prepareWaitMs ?? CUSTODY_PREPARE_WAIT_MS;
  try {
    /* A BOUNDED CALL IS BOUNDED BEFORE THE HANDOVER TOO — the same rule the
       shielded spend keeps, for the same reason. */
    const wallet = request.bounded === true
      ? await beforeHandover(deps.wallet(user), prepareMs, 'opening the connection')
      : await deps.wallet(user);
    const network = wallet.network.networkId;
    const storage = deps.storage();
    const record = loadCustodyRecord(storage, user, network);
    if (!record || record.address === null || nextCustodyStep(record) !== 'ready') {
      throw new Error('This Passport is not finished being set up yet.');
    }
    const account: K1Account = { network: record.network, address: record.address };
    /* ONE TRANSACTION ON THIS ACCOUNT AT A TIME — see
       `../lib/custodyAccountLock.ts`. A gated call the node refuses because the
       account moved under it is built again, a bounded number of times: it
       was refused, so nothing was applied. */
    return await (deps.accountLock ?? custodyAccountLock()).run(k1AccountKey(account), prepareMs, async () => {
      for (let races = 0; ; races += 1) {
        try {
          return await k1CallOnce(deps, session, device, request, onPhase, { wallet, record });
        } catch (cause) {
          /* 104 (the account moved) and 196 (the sponsor paid its fee from a
             DUST coin another transaction spent): refused whole, so nothing
             was applied and building it again is safe. */
          if (request.bounded !== true || !custodyRebuildRefusal(cause)) throw cause;
          if (races >= CUSTODY_STATE_RACE_RETRIES) {
            console.warn(`[account-custody] ${request.operation} kept being refused without being applied`, cause);
            throw new CustodySubmitSettled(CUSTODY_SEND_NOT_SENT);
          }
          console.info(
            `[account-custody] the node refused ${request.operation} without applying it; building it again (${races + 1} of ${CUSTODY_STATE_RACE_RETRIES})`,
          );
          await deps.sleep(deps.stateRaceWaitMs ?? CUSTODY_STATE_RACE_WAIT_MS);
        }
      }
    });
  } catch (cause) {
    if (cause instanceof CustodySubmitSettled) throw new Error(cause.message);
    throw cause;
  }
}

async function k1CallOnce(
  deps: CustodyDeps,
  session: CustodySession,
  device: CustodyCallDevice,
  request: CustodyCallRequest,
  onPhase: ((phase: CustodyPhase) => void) | undefined,
  opened: { readonly wallet: LocalMidnightWallet; readonly record: CustodyAccountRecord },
): Promise<CustodyStepResult> {
  const { wallet } = opened;
  const record = opened.record as CustodyAccountRecord & { address: string };
  const network = wallet.network.networkId;
  const storage = deps.storage();
  if (request.bounded === true) {
    const prepared = await beforeHandover(
      prepareK1Call(deps, session, device, request, onPhase, wallet, record),
      deps.prepareWaitMs ?? CUSTODY_PREPARE_WAIT_MS,
      `preparing ${request.operation}`,
    );
    onPhase?.({ step: 'submit' });
    return boundedK1Submit(deps, prepared.providers, record, prepared.circuit, prepared.args, {
      signedNonce: prepared.authNonce,
      module: prepared.module,
      network,
      storage,
      onPhase,
    });
  }
  const prepared = await prepareK1Call(deps, session, device, request, onPhase, wallet, record);
  onPhase?.({ step: 'submit' });
  const { circuit, callTx, providers } = prepared;
  const call = callTx[circuit];
  if (!call) throw new Error('This Passport cannot do that yet.');
  const result = await call(...prepared.args);

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
 * Everything a gated call does before anything is handed over: open the
 * account, read its state, and authorise the call. Nothing here sends.
 */
async function prepareK1Call(
  deps: CustodyDeps,
  session: CustodySession,
  device: CustodyCallDevice,
  request: CustodyCallRequest,
  onPhase: ((phase: CustodyPhase) => void) | undefined,
  wallet: LocalMidnightWallet,
  record: CustodyAccountRecord & { address: string },
): Promise<{
  readonly module: CustodyContractModule;
  readonly circuit: string;
  readonly callTx: CustodyCallTx;
  readonly providers: Record<string, unknown>;
  readonly args: readonly unknown[];
  readonly authNonce: bigint;
}> {
  const module = await deps.contractModule();
  /* GENERALISATION 4 of 5: the gated circuit's name. The arm IS the half of
     every gated circuit's name that selects which proof gets made. */
  const circuit = `${request.operation}_with_${device.arm}`;
  const { callTx, providers } = await openCustodyAccount(deps, wallet, record, [circuit]);
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

  return {
    module,
    circuit,
    callTx,
    providers,
    args: [...request.args, ...authArgs(auth)],
    authNonce: context.authNonce,
  };
}

/**
 * A gated payment's submit and its bounded wait — see
 * {@link CustodyCallRequest.bounded}.
 *
 * Built unproven, then `submitTxAsync` (which proves, balances, and hands it
 * to the node), then the chain's verdict waited on for at most
 * `submitWaitMs`. Three outcomes, each said once: the chain accepted it (the
 * step result, with its hash); the chain refused it ({@link CUSTODY_SEND_FAILED});
 * or the wait ran out, when the account's own `auth_nonce` decides between
 * {@link CUSTODY_SEND_NOT_SENT} and the hedged {@link CUSTODY_SEND_UNCONFIRMED}.
 */
async function boundedK1Submit(
  deps: CustodyDeps,
  providers: Record<string, unknown>,
  record: CustodyAccountRecord,
  circuit: string,
  args: readonly unknown[],
  context: {
    readonly signedNonce: bigint;
    readonly module: CustodyContractModule;
    readonly network: string;
    readonly storage: CustodyStorage;
    readonly onPhase?: (phase: CustodyPhase) => void;
  },
): Promise<CustodyStepResult> {
  const address = record.address as string;
  const contracts = await deps.contracts();
  const unproven = (await contracts.createUnprovenCallTx(providers, {
    compiledContract: providers.compiledContract,
    circuitId: circuit,
    contractAddress: address,
    args: [...args],
    privateStateId: custodyPrivateStateId(record),
  })) as CustodyUnprovenCall;
  let identifier: string;
  try {
    identifier = await contracts.submitTxAsync(announceProved(providers, context.onPhase), {
      unprovenTx: unproven.private.unprovenTx,
      circuitId: [circuit],
    });
  } catch (cause) {
    /* THE NODE REFUSED IT: nothing was applied. A refusal that building it
       again can cure (the account moved, or the fee's DUST coin was spent by
       another) goes back to `k1Call`, which builds it again; any other is said
       plainly. */
    if (custodyNodeRefused(cause) && !custodyRebuildRefusal(cause)) {
      console.warn(`[account-custody] the node refused ${circuit}`, cause);
      throw new CustodySubmitSettled(CUSTODY_SEND_NOT_SENT);
    }
    throw cause;
  }
  context.onPhase?.({ step: 'confirm', txId: identifier ?? undefined });

  let finalized: unknown;
  try {
    const waited = await watchWithin(providers, identifier, deps.submitWaitMs ?? CUSTODY_SUBMIT_WAIT_MS);
    if (waited.kind === 'timeout') {
      const verdict = custodySubmitVerdict({
        signedNonce: context.signedNonce,
        liveNonce: await liveAuthNonce(context.module, providers, address),
      });
      throw new CustodySubmitSettled(
        verdict === 'not-sent' ? CUSTODY_SEND_NOT_SENT : CUSTODY_SEND_UNCONFIRMED,
      );
    }
    finalized = waited.value;
  } catch (cause) {
    if (cause instanceof CustodySubmitSettled) throw new Error(cause.message);
    console.warn('[account-custody] the payment was sent and its outcome is not known', cause);
    throw new Error(CUSTODY_SEND_UNCONFIRMED);
  }
  const status = finalizedStatus(finalized);
  if (status !== (await succeededEntirely())) {
    console.warn(`[account-custody] the chain did not accept the payment (${status ?? 'no status'})`);
    throw new Error(status === null ? CUSTODY_SEND_UNCONFIRMED : CUSTODY_SEND_FAILED);
  }
  const txHash = finalizedTxHash(finalized) ?? (await resolveHash(providers, finalized));
  const next: CustodyAccountRecord = {
    ...record,
    txHashes: txHash ? [...record.txHashes, txHash] : record.txHashes,
  };
  saveCustodyRecord(context.storage, next);
  return {
    record: next,
    txHash,
    explorerUrl: txHash ? custodyExplorerLink(txHash, context.network) : null,
    result: null,
  };
}

/**
 * The same providers, with one addition: the moment the proof is made, the
 * caller is told (`submit`, {@link CUSTODY_PHASE_PROVED}).
 *
 * `submitTxAsync` proves, balances, and hands over in one call, and a screen
 * that wants to show proving and sending as two states has no other honest
 * place to draw the line — a timer would be a guess. The provider is
 * delegated to, not copied, so every other method it has is untouched.
 */
function announceProved(
  providers: Record<string, unknown>,
  onPhase: ((phase: CustodyPhase) => void) | undefined,
): Record<string, unknown> {
  const prover = providers.proofProvider as
    | { proveTx?: (...args: unknown[]) => Promise<unknown> }
    | undefined;
  const proveTx = prover?.proveTx;
  if (onPhase === undefined || prover === undefined || typeof proveTx !== 'function') return providers;
  const announcing = Object.assign(Object.create(prover) as object, {
    proveTx: async (...args: unknown[]): Promise<unknown> => {
      const proved = await proveTx.apply(prover, args);
      onPhase({ step: 'submit', detail: CUSTODY_PHASE_PROVED });
      return proved;
    },
  });
  return { ...providers, proofProvider: announcing };
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
  const { callTx, providers } = await openCustodyAccount(deps, wallet, record, [request.operation]);
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
/* A shielded payment, in ONE transaction                                     */
/* -------------------------------------------------------------------------- */

/**
 * Where a shielded amount is paid.
 *
 * TWO SHAPES BECAUSE THE CONTRACT HAS TWO CIRCUITS, and MIP-0012 §6.6 is the
 * reason there are two. `withdraw_shielded` pays a person's Zswap key and the
 * transaction names nobody but the sender's account; `withdraw_shielded_to_
 * contract` pays another ACCOUNT, and a contract-addressed output carries that
 * address in cleartext, so the transaction publishes the pair. The second is
 * therefore a deliberate per-payment choice and not a default, which is why the
 * caller states which one it means rather than this inferring it from a string.
 */
export type CustodyShieldedTarget =
  | {
      readonly kind: 'address';
      /** 32 bytes, from inside the pasted `mn_shield-addr…`. */
      readonly coinPublicKey: Uint8Array;
      /**
       * The OTHER 32 bytes of the same address.
       *
       * The circuit never sees it. midnight-js does: it builds the output's
       * note ciphertext client-side and refuses a third-party shielded output
       * at construction time without the recipient's encryption key ("Provide a
       * mapping via the encryptionPublicKeyResolver", hit live 2026/08/24).
       * Neither key can be derived from the other, which is why the whole
       * address travels and this takes both.
       */
      readonly encryptionPublicKey: Uint8Array;
    }
  | {
      readonly kind: 'account';
      /** The recipient's account contract, raw 64-hex. */
      readonly contractAddress: string;
      /**
       * The recipient's advertised encryption key, ASKED FOR AT SEAL TIME.
       *
       * The sender seals the coin it is about to send into the 192-byte inbox
       * entry the recipient's own claim carries, because the chain carries the
       * note and not its description: a coin deposited into one of these
       * accounts with no readable entry has demonstrably arrived and nobody can
       * ever move it again.
       *
       * A FUNCTION, NOT A VALUE, AND THAT IS THE WHOLE OF IT. An account
       * rotates this key — `rotate_enc_key` is one of its circuits — and the
       * window between reading it and using it used to hold an approval and a
       * proof, which on the passkey arm is a person walking to their phone. A
       * rotation inside that window sealed the coin to a key its holder had
       * already replaced, and the payment still lands: the money arrives and
       * nobody can ever describe it again. So the key is read HERE, in the
       * candidate loop, immediately before the seal — and read again for each
       * retry, because a retry is another window.
       */
      readonly readRecipientEncKey: () => Promise<string>;
    };

/** What a shielded spend needs beyond the session and the device. */
export interface CustodyShieldedSpendRequest {
  readonly target: CustodyShieldedTarget;
  readonly colourHex: string;
  readonly amount: bigint;
}

/** The coin the recipient's account was handed, read off the circuit's result. */
export interface CustodySentCoin {
  readonly nonce: string;
  readonly colour: string;
  readonly value: bigint;
}

/** What a shielded spend did, including what it left behind. */
export interface CustodyShieldedSpendResult extends CustodyStepResult {
  /** The change coin, read out of the circuit's own result. */
  readonly change: CustodyChangeCoin;
  /** Whether the change's position is settled, still being asked about, or absent. */
  readonly changePosition: 'settled' | 'candidates' | 'awaiting' | 'none';
  /** The coin the recipient's account claimed. Null for a payment to an address. */
  readonly sent: CustodySentCoin | null;
  /** The block the transaction landed in, when the chain told us. */
  readonly blockHeight: number | null;
  /** Which candidate position proved, counting from zero. */
  readonly candidate: number;
}

/** Kept for the name every caller already uses. */
export type CustodyShieldedWithdrawResult = CustodyShieldedSpendResult;

/**
 * Pay a shielded amount out of this Passport — ONE transaction, and no wallet
 * anywhere in it.
 *
 * WHAT CHANGED ON 2026/09/18, AND WHY. This used to be the first of three legs:
 * the account paid the sender's OWN wallet, the wallet waited for the note, and
 * a third transaction deposited it into the recipient. Value therefore sat in
 * an app-built wallet between legs — which is the thing the ruling of
 * 2026/09/18 forbids, and which is also where every stopped payment in this
 * build's history got stuck. A Passport's value lives in its account and
 * nowhere else. The only wallet left is the one midnight-js needs to assemble a
 * transaction; it holds nothing and relays nothing, and the fees come from the
 * sponsor.
 *
 * SO THERE ARE TWO SHAPES AND BOTH ARE ONE TRANSACTION:
 *
 *   to an ADDRESS  `withdraw_shielded_with_k256(their coin public key, colour,
 *                  amount, …auth)`. The stdlib routes the change back to the
 *                  contract and returns its description privately; the client
 *                  persists it.
 *
 *   to an ACCOUNT  `withdraw_shielded_to_contract_with_k256(their contract,
 *                  colour, amount, …auth)` with the recipient's own
 *                  permissionless `deposit_shielded(coin, entry)` GRAFTED onto
 *                  the same transaction. The sender reads `[sent, change]` off
 *                  the unproven call, seals `sent` to the recipient's live
 *                  encryption key, builds their claim, and grafts the intent —
 *                  `addIntent`, never a merge: a merged transaction
 *                  materialises a second copy of the claimed output and fails
 *                  balancing (MIP-0012 §6.6, and the reference client's own
 *                  conformance test says so in as many words).
 *
 * THE COIN IS READ ONCE AND USED TWICE. The challenge the device signs BINDS
 * the qualified coin (AUTH-10) and the proof is built from whatever the
 * `held_coin` witness returns; both come from the same store, read in the same
 * pass, so the signature cannot be over a coin the proof does not spend.
 *
 * THE POSITION MAY BE A GUESS, AND A WRONG GUESS IS CHEAP. A change coin is
 * stored with the candidate positions its transaction's window allowed. An
 * incorrect one cannot be built or proved, so nothing is submitted and nothing
 * is spent (MIP-0012 INV-5) — so this retries with the next candidate rather
 * than refusing, and the candidate that works is settled as the coin's position
 * from then on.
 */
export async function spendShieldedK1(
  session: CustodySession,
  device: CustodyCallDevice,
  request: CustodyShieldedSpendRequest,
  onPhase?: (phase: CustodyPhase) => void,
  overrides: Partial<CustodyDeps> = {},
): Promise<CustodyShieldedSpendResult> {
  try {
    return await spendShieldedK1Bounded(session, device, request, onPhase, overrides);
  } catch (cause) {
    /* A settled answer leaves as a plain `Error` carrying its sentence. */
    if (cause instanceof CustodySubmitSettled) throw new Error(cause.message);
    throw cause;
  }
}

async function spendShieldedK1Bounded(
  session: CustodySession,
  device: CustodyCallDevice,
  request: CustodyShieldedSpendRequest,
  onPhase: ((phase: CustodyPhase) => void) | undefined,
  overrides: Partial<CustodyDeps>,
): Promise<CustodyShieldedSpendResult> {
  const deps = withDefaults(overrides);
  const user = custodyUserKey(session, device);
  /* EVERYTHING BEFORE THE PAYMENT IS HANDED OVER IS BOUNDED (2026/09/22). Live,
     a Send sheet sat on "Proving and submitting" with no proof ever asked for:
     somewhere between opening the connection and building the transaction a
     promise never settled, and nothing had a bound. None of that work sends
     anything, so running out of time here is a definite answer — see
     {@link beforeHandover}. */
  const prepareMs = deps.prepareWaitMs ?? CUSTODY_PREPARE_WAIT_MS;
  const wallet = await beforeHandover(deps.wallet(user), prepareMs, 'opening the connection');
  const network = wallet.network.networkId;
  const storage = deps.storage();
  const record = loadCustodyRecord(storage, user, network);
  if (!record || record.address === null || nextCustodyStep(record) !== 'ready') {
    throw new Error('This Passport is not finished being set up yet.');
  }
  const account: K1Account = { network: record.network, address: record.address };
  const colour = normalisedColourHex(request.colourHex);
  if (colour === null) throw new Error('That is not something this Passport can send.');
  /* ONE TRANSACTION ON THIS ACCOUNT AT A TIME, from this browser — see
     `../lib/custodyAccountLock.ts`. The wait for it is part of the bound. */
  return (deps.accountLock ?? custodyAccountLock()).run(
    k1AccountKey(account),
    prepareMs,
    () => spendWithAccount(deps, session, device, request, onPhase, { user, wallet, record, account, colour }),
  );
}

/** What {@link spendShieldedK1} has settled before it takes the account. */
interface SpendContext {
  readonly user: string;
  readonly wallet: LocalMidnightWallet;
  readonly record: CustodyAccountRecord;
  readonly account: K1Account;
  readonly colour: string;
}

/**
 * Work that sends nothing, given `milliseconds` to finish.
 *
 * Past the bound the payment is refused with {@link CUSTODY_SEND_NOT_SENT} —
 * which is true, because nothing has been handed to anybody — and the work is
 * left behind rather than cancelled. A caller whose abandoned work could still
 * go on to SEND something stops it itself (the balance hook's `abandoned`).
 */
async function beforeHandover<T>(work: Promise<T>, milliseconds: number, what: string): Promise<T> {
  const outcome = await withinCustodyBound(work, milliseconds);
  if (outcome.kind === 'timeout') {
    console.warn(`[account-custody] ${what} did not finish in ${Math.round(milliseconds / 1000)} s; nothing was sent`);
    throw new CustodySubmitSettled(CUSTODY_SEND_NOT_SENT);
  }
  return outcome.value;
}

async function spendWithAccount(
  deps: CustodyDeps,
  session: CustodySession,
  device: CustodyCallDevice,
  request: CustodyShieldedSpendRequest,
  onPhase: ((phase: CustodyPhase) => void) | undefined,
  context0: SpendContext,
): Promise<CustodyShieldedSpendResult> {
  const { user, wallet, record, account, colour } = context0;
  const address = record.address as string;
  const network = wallet.network.networkId;
  const storage = deps.storage();
  const prepareMs = deps.prepareWaitMs ?? CUSTODY_PREPARE_WAIT_MS;
  const colourBytes = hexToBytes(colour);

  const target = request.target;
  /* Narrowed ONCE, here, because the branch that needs it is several `await`s
     away and TypeScript cannot carry a discriminant across them. */
  const payee = target.kind === 'account' ? target : null;
  /* THE WHOLE TRANSACTION'S CIRCUITS, named before the connection is opened:
     the proving service is told what to stage, and a composed transaction
     whose claim is not staged is refused by name rather than in a prover's own
     words several seconds later. The arm picks the gated half and nothing else:
     `deposit_shielded` is permissionless, so the recipient's claim is the same
     circuit whichever arm the SENDER is on. */
  const spendCircuit =
    target.kind === 'address'
      ? `withdraw_shielded_with_${device.arm}`
      : `withdraw_shielded_to_contract_with_${device.arm}`;
  const circuits =
    target.kind === 'address' ? [spendCircuit] : [spendCircuit, 'deposit_shielded'];

  /* WHERE THIS ATTEMPT GOT TO, which is the whole of what decides a retry.
     `building` covers executing the circuit and grafting the second call —
     nothing has been handed to anybody. `submitting` covers `submitTxAsync`,
     which proves, balances and submits behind one call; `proved` is set from
     inside it the moment a proof comes back. */
  let phase: 'building' | 'submitting' = 'building';
  let proved = false;
  /* Only OUR proof provider reports that line. */
  const provingIsOurs = custodyNeedsBigKeyProver(circuits);
  const opened = await beforeHandover(
    Promise.all([
      deps.contractModule(),
      deps.contracts(),
      custodyProviders(deps, wallet, {
        address,
        privateStateId: custodyPrivateStateId(record),
        account: { network: record.network, address },
        initialPrivateState: custodyPrivateState(record),
        circuits,
        onProved: () => {
          proved = true;
        },
      }),
    ]),
    prepareMs,
    'opening this Passport',
  );
  const [module, contracts, providers] = opened;
  const addressBytes = hexToBytes(address);
  const privateStateId = custodyPrivateStateId(record);

  let attempt = 0;
  let races = 0;
  let spentCoins = 0;
  for (;;) {
    phase = 'building';
    proved = false;
    /* THE CHAIN SAYS WHERE THE COIN IS, before anything is proved (2026/09/23).
       Only on a first attempt: a retry is already walking the candidates. */
    if (attempt === 0) await locateHeldCoin(deps, providers, account, colour, address);
    const held = heldK1Coin(account, colour);
    if (held === null) {
      throw new Error('There is nothing of that kind in this Passport to send.');
    }
    const coin: CustodyHeldCoin = {
      nonce: hexToBytes(held.nonce),
      color: hexToBytes(held.colour),
      value: held.value,
      mt_index: held.mtIndex,
    };
    /* WHAT THE BALANCE HOOK WROTE, and the one flag that stops a transaction
       this attempt has given up on from ever being handed over. */
    let booked: { readonly txId: string; readonly write: ShieldedChangeWrite } | null = null;
    let abandoned = false;
    try {
      const built = await beforeHandover(
        buildShieldedSpend({
          deps,
          session,
          device,
          module,
          contracts,
          providers,
          address,
          addressBytes,
          privateStateId,
          target,
          payee,
          spendCircuit,
          colourBytes,
          amount: request.amount,
          coin,
          onPhase,
        }),
        prepareMs,
        'building the payment',
      );
      const { change, sent, spendResult, unprovenTx, authNonce } = built;
      const changeRef = change.outcome === 'change' ? change : null;

      /* THE BOOKING IS MADE THE MOMENT THE TRANSACTION IS BALANCED, BEFORE IT IS
         HANDED TO THE NODE (2026/09/22). It used to be made when the submit
         returned — and the submit waits for the node to put the transaction in
         a block, so a tab closed in those seconds left a transaction on its way
         and a store that had written nothing: the coin it spent still held, and
         the change coin's only description, the circuit's return value, gone.
         Balanced, the transaction has its final identifier; nothing has left
         the tab; and the write that happens here is one the chain's answer can
         always take back (`k1CoinStore.ts`, `reconcileK1Spends`). */
      const hooked = withBalanceHook(
        providers,
        (balanced) => {
          const identifier = (deps.identifierOf ?? transactionIdentifierOf)(balanced);
          if (identifier === null) return;
          settleK1Coin(account, colour);
          booked = { txId: identifier, write: writeShieldedChange(account, colour, change, identifier, deps.now()) };
          onPhase?.({ step: 'submit', txId: identifier, undo: { held, change: changeRef } });
        },
        () => abandoned,
      );

      phase = 'submitting';
      /* THE HANDOVER ITSELF IS BOUNDED TOO. Proving has its own abort and the
         submit its own two bounded offers; balancing, between them, waits on
         the wallet. Past this bound an attempt that has not been booked is
         abandoned — the hook refuses to hand anything over from then on — and
         one that has been booked goes on to ask the chain. */
      const handover = contracts
        .submitTxAsync(hooked, { unprovenTx, circuitId: [...circuits] })
        .then(
          (identifier) => ({ kind: 'submitted' as const, identifier }),
          (cause: unknown) => ({ kind: 'failed' as const, cause }),
        );
      const waited = await withinCustodyBound(
        handover,
        deps.handoverWaitMs ?? CUSTODY_PROOF_TIMEOUT_MS + prepareMs,
      );
      let identifier: string;
      if (waited.kind === 'timeout') {
        abandoned = true;
        const soFar = booked as { txId: string } | null;
        if (soFar === null) {
          console.warn('[account-custody] the payment was not handed over in time; nothing was sent');
          throw new CustodySubmitSettled(CUSTODY_SEND_NOT_SENT);
        }
        identifier = soFar.txId;
      } else if (waited.value.kind === 'failed') {
        const cause = waited.value.cause;
        const soFar = booked as { txId: string } | null;
        /* THE COIN WAS ALREADY SPENT (2026/09/26). The node's
           `NullifierAlreadyPresent` (239) is the chain saying the coin this
           payment was built on is gone — sent by another device that read the
           same notes, before Home's own check could say so. Nothing was
           applied. The booking, if there was one, is taken back; the coin is
           then forgotten and its nonce remembered as spent, which is what
           Home's check would have done; and the payment is built again on the
           next coin of the colour when that coin can cover it. Otherwise it
           did not go through, in the sentence it always had, and the next read
           of Home shows what is really there. */
        if (custodyCoinAlreadySpent(cause)) {
          if (soFar !== null) undoK1ChangeCoin(account, held, changeRef);
          forgetSpentK1Coins(account, [held.nonce]);
          const next = heldK1Coin(account, colour);
          if (next !== null && next.value >= request.amount && spentCoins < CUSTODY_SPENT_COIN_RETRIES) {
            spentCoins += 1;
            attempt = 0;
            console.info(
              `[account-custody] the chain says that coin was already spent; building the payment on the next one (${spentCoins} of ${CUSTODY_SPENT_COIN_RETRIES})`,
            );
            continue;
          }
          console.warn('[account-custody] the chain says that coin was already spent, and no other can cover it', cause);
          throw new CustodySubmitSettled(CUSTODY_SEND_NOT_SENT);
        }
        /* NOT BOOKED: nothing was handed over, and the retry rules below
           decide exactly as they always have. */
        if (soFar === null) throw cause;
        if (custodyNodeRefused(cause)) {
          /* THE NODE REFUSED IT, so nothing was applied and nothing can be:
             the booking is taken back exactly. */
          undoK1ChangeCoin(account, held, changeRef);
          restartK1CoinCandidates(account, colour);
          if (custodyRebuildRefusal(cause) && races < CUSTODY_STATE_RACE_RETRIES) {
            races += 1;
            console.info(
              `[account-custody] the node refused the payment without applying it; building it again (${races} of ${CUSTODY_STATE_RACE_RETRIES})`,
            );
            await deps.sleep(deps.stateRaceWaitMs ?? CUSTODY_STATE_RACE_WAIT_MS);
            continue;
          }
          console.warn('[account-custody] the node refused the payment', cause);
          throw new CustodySubmitSettled(CUSTODY_SEND_NOT_SENT);
        }
        /* ANY OTHER FAILURE AFTER THE BOOKING says nothing about whether the
           node has it — a socket, a wait. The chain is asked below, exactly as
           for a submit that returned. */
        console.warn('[account-custody] the submit did not answer; asking the chain', cause);
        identifier = soFar.txId;
      } else {
        identifier = waited.value.identifier;
      }

      /* A HOOK THAT COULD NOT NAME THE TRANSACTION books it here instead, on
         the id the submit came back with — the order this used to have. */
      const written =
        (booked as { write: ShieldedChangeWrite } | null)?.write ??
        (settleK1Coin(account, colour), writeShieldedChange(account, colour, change, identifier, deps.now()));
      /* AND THE RECORD NAMES THE TRANSACTION FROM HERE ON. */
      onPhase?.({ step: 'confirm', txId: identifier, undo: { held, change: changeRef } });

      /* THE CHAIN'S VERDICT, WAITED FOR FOR A BOUNDED TIME. When the bound
         runs out the chain is asked two ways — the indexer, for the
         transaction itself, and the account, for its `auth_nonce` — each with
         its own short bound, and `custodySubmitVerdict` decides. */
      let finalized: unknown;
      try {
        const watched = await watchWithin(providers, identifier, deps.submitWaitMs ?? CUSTODY_SUBMIT_WAIT_MS);
        if (watched.kind === 'timeout') {
          const [liveNonce, onChain] = await Promise.all([
            liveAuthNonce(module, providers, address),
            askTxOutcome(deps, wallet, identifier),
          ]);
          const verdict = custodySubmitVerdict({
            signedNonce: authNonce,
            liveNonce,
            onChain: onChain?.outcome ?? null,
          });
          if (verdict === 'landed') {
            finalized = { txId: identifier, txHash: onChain?.hash ?? undefined, status: await succeededEntirely() };
          } else if (verdict === 'refused') {
            undoK1ChangeCoin(account, held, changeRef);
            restartK1CoinCandidates(account, colour);
            throw new CustodySubmitSettled(CUSTODY_SEND_FAILED);
          } else if (verdict === 'not-sent') {
            /* SET ASIDE, NOT FORGOTTEN: a transaction the node is merely slow
               with can still land, and the store puts the booking back if it
               does. */
            undoK1ChangeCoin(account, held, changeRef, { mayStillLand: true, now: deps.now() });
            restartK1CoinCandidates(account, colour);
            /* The connection that lost it is not trusted with the next one. */
            deps.releaseWallet?.(user);
            throw new CustodySubmitSettled(CUSTODY_SEND_NOT_SENT);
          } else {
            throw new CustodySubmitSettled(CUSTODY_SEND_UNCONFIRMED);
          }
        } else {
          finalized = watched.value;
        }
      } catch (cause) {
        if (cause instanceof CustodySubmitSettled) throw cause;
        /* THE WRITE STAYS. A wait that failed says nothing about the
           transaction; the store's own reconciliation settles it from the
           chain on the next read. */
        console.warn('[account-custody] the payment was sent and its outcome is not known', cause);
        throw new CustodySubmitSettled(CUSTODY_SEND_UNCONFIRMED);
      }
      const chainHash = finalizedTxHash(finalized);

      /* THE CHAIN'S VERDICT, AND NOT THE FACT THAT IT ANSWERED. A failed
         transaction spent NOTHING (MIP-0012 INV-5), so the write is taken back
         exactly and the position the proof verified against is put back at the
         head rather than left mid-rotation. */
      const status = finalizedStatus(finalized);
      if (status !== (await succeededEntirely())) {
        console.warn(
          `[account-custody] the chain did not accept the payment (${status ?? 'no status'})`,
        );
        undoK1ChangeCoin(account, held, changeRef);
        restartK1CoinCandidates(account, colour);
        throw new CustodySubmitSettled(status === null ? CUSTODY_SEND_UNCONFIRMED : CUSTODY_SEND_FAILED);
      }
      /* LANDED: the booking is a fact now, and nothing may take it back. */
      landK1Spend(account, identifier);

      const txHash = chainHash ?? (await resolveHash(providers, finalized));
      const next: CustodyAccountRecord = {
        ...record,
        txHashes: txHash ? [...record.txHashes, txHash] : record.txHashes,
      };
      saveCustodyRecord(storage, next);
      const step: CustodyStepResult = {
        record: next,
        txHash,
        explorerUrl: txHash ? custodyExplorerLink(txHash, network) : null,
        result: spendResult,
      };
      const settled = await settleShieldedChange(deps, wallet, account, colour, step, written);
      return {
        ...settled,
        sent,
        blockHeight: finalizedBlockHeight(finalized),
        candidate: attempt,
      };
    } catch (cause) {
      /* A SETTLED ANSWER — a bound that ran out, a verdict from the chain —
         is final, and is said in its own sentence. The store is left where the
         chain can be reconciled with it rather than mid-rotation. */
      if (cause instanceof CustodySubmitSettled) {
        abandoned = true;
        restartK1CoinCandidates(account, colour);
        throw new Error(cause.message);
      }
      /* NAME AND MESSAGE BOTH. A WASM trap's message is the bare word
         `unreachable`; what identifies it is its NAME. */
      const message = spendFailureText(cause);
      /* THE ONE QUESTION THAT DECIDES A RETRY: could this transaction already
         be away? A proof that came back means `submitTxAsync` went on to
         balance and submit, and a transaction that may be on its way must
         NEVER be built a second time. Phase is the honest discriminator and
         the wording never was. */
      const mayRetry = phase === 'building' || (!proved && provingIsOurs);
      if (!mayRetry) {
        restartK1CoinCandidates(account, colour);
        throw cause;
      }
      /* A REFUSAL IS EVIDENCE ABOUT A POSITION WHILE THERE IS A POSITION LEFT
         (fixed 2026/09/21). `proving-failed` is the service's code for "the
         prover ran and declined", which is the shape a wrong candidate position
         arrives in — and is equally the shape of a verifier key that does not
         match, a circuit that is not staged the way the transaction expects,
         and every other verdict the proof server can reach about a
         transaction. Rotating on the CODE alone spent up to ten approvals, one
         per candidate, on a failure no position could fix.

         Judging the service's own `detail` by the wording predicate was the
         first answer to that and was no answer at all: the sponsor redacts the
         proof server's text to one fixed sentence by design, so the predicate
         was false for EVERY sponsored refusal and the retry could not fire on
         the only route a Passport uses. A first payment out of a freshly
         funded Passport stopped on the first refusal with `Public transcript
         input mismatch` in the proof server's log — a position that rebuilds a
         different root, which is precisely what this retry is for.

         `spendRefusalMayBePosition` keeps the wording as the fast yes and puts
         the bound somewhere honest: while `advance ?? widen` has a position
         left, a verdict is worth trying it; when it has not, the run is over
         after this attempt. Same worst case in approvals, without a rule that
         cannot fire. `503 prover-unavailable` is not this error and is
         untouched. */
      const refusalMayBePosition = spendRefusalMayBePosition({
        proofNotBuilt: isCustodyProofNotBuilt(cause),
        detail: custodyProofNotBuiltDetail(cause),
        /* ASKED BEFORE ANYTHING ROTATES, and it has to be: the advance below is
           what consumes the position this is asking about. */
        positionsLeft: k1CoinPositionsLeft(account, colour),
      });
      if (!spendPositionMayBeWrong(message) && !refusalMayBePosition) {
        restartK1CoinCandidates(account, colour);
        throw cause;
      }
      /* THE REPORTED WINDOW FIRST, AND THE SWEEP ONLY AFTER IT. */
      const nextCandidate =
        advanceK1CoinCandidate(account, colour) ?? widenK1CoinCandidates(account, colour);
      if (nextCandidate === null) throw cause;
      attempt += 1;
      console.info(
        `[account-custody] retrying the spend against candidate position ${attempt} of this coin`,
      );
    }
  }
}

/** How long the position lookup may take before the spend goes ahead without it. */
export const CUSTODY_LOCATE_WAIT_MS = 8_000;

/**
 * Move the held coin to the tree position the chain has it at, where the chain
 * can say.
 *
 * WHY (live, 2026/09/23). The change coin of a payment lands at one of two or
 * more positions and the order is not predictable, so the stored position was
 * a guess, and a wrong guess cost a whole proof on the droplet (about 45 s)
 * before the proof server declined it with "Public transcript input mismatch".
 * That was half of all shielded sends. The account's commitment tree, as the
 * indexer serves it, lists each of the account's coins by commitment and
 * index, and the coin's commitment is computable here.
 *
 * NEVER A NEW FAILURE. Any error, a slow answer, or a coin not yet listed
 * leaves the store exactly as it was, and the candidate retry does what it
 * always did.
 */
async function locateHeldCoin(
  deps: CustodyDeps,
  providers: unknown,
  account: K1Account,
  colour: string,
  address: string,
): Promise<void> {
  try {
    const held = heldK1Coin(account, colour);
    if (held === null) return;
    const reader = (providers as { publicDataProvider?: unknown }).publicDataProvider as
      | { queryZSwapAndContractState?(address: string): Promise<readonly unknown[] | null> }
      | undefined;
    if (typeof reader?.queryZSwapAndContractState !== 'function') return;
    const query = reader.queryZSwapAndContractState.bind(reader);
    const lookup = (async (): Promise<bigint | null> => {
      const ledger = (await deps.ledger()) as unknown as {
        ZswapOutput?: {
          newContractOwned(
            coin: { type: string; nonce: string; value: bigint },
            segment: number,
            contract: string,
          ): { commitment: string };
        };
      };
      if (ledger.ZswapOutput === undefined) return null;
      const states = await query(address);
      const zswap = states?.[0] as { toString(compact?: boolean): string } | undefined;
      if (zswap === undefined || zswap === null) return null;
      const commitment = ledger.ZswapOutput.newContractOwned(
        { type: held.colour, nonce: held.nonce, value: held.value },
        0,
        address,
      ).commitment;
      return zswapLeafIndex(zswap.toString(false), commitment);
    })();
    const waited = await withinCustodyBound(lookup, CUSTODY_LOCATE_WAIT_MS);
    if (waited.kind === 'timeout' || waited.value === null) return;
    const found = waited.value;
    if (found === held.mtIndex) return;
    console.info(
      `[account-custody] the chain has this coin at position ${found}, not ${held.mtIndex}; using that`,
    );
    pinK1CoinPosition(account, colour, found);
  } catch (cause) {
    console.warn('[account-custody] could not read where this coin is; trying the stored position', cause);
  }
}

/** What building one attempt of a shielded spend produced, before any of it is handed over. */
interface BuiltShieldedSpend {
  readonly change: CustodyReadableChange;
  readonly sent: CustodySentCoin | null;
  readonly spendResult: unknown;
  readonly unprovenTx: CustodyUnprovenTx;
  /** The `auth_nonce` the authorisation was signed against. */
  readonly authNonce: bigint;
}

/**
 * Everything one attempt does before the transaction is handed over: read the
 * account, sign, execute the spend, read what it returns, and — for a payment
 * to another account — seal the recipient's coin and graft their claim.
 *
 * NOTHING HERE SENDS ANYTHING, which is what lets {@link spendWithAccount}
 * bound it and say "it didn't go through" when the bound runs out.
 */
async function buildShieldedSpend(input: {
  readonly deps: CustodyDeps;
  readonly session: CustodySession;
  readonly device: CustodyCallDevice;
  readonly module: CustodyContractModule;
  readonly contracts: CustodyContractsApi;
  readonly providers: Record<string, unknown>;
  readonly address: string;
  readonly addressBytes: Uint8Array;
  readonly privateStateId: string;
  readonly target: CustodyShieldedTarget;
  readonly payee: Extract<CustodyShieldedTarget, { kind: 'account' }> | null;
  readonly spendCircuit: string;
  readonly colourBytes: Uint8Array;
  readonly amount: bigint;
  readonly coin: CustodyHeldCoin;
  readonly onPhase?: (phase: CustodyPhase) => void;
}): Promise<BuiltShieldedSpend> {
  const { session, device, module, contracts, providers, target, payee } = input;
  const state = module.ledger(await queryStateData(providers, input.address));
  const context: K1CallContext = {
    contractAddress: input.addressBytes,
    authNonce: state.auth_nonce,
  };
  const useCounter = resolveCustodyUseCounter({
    entryAt: (counter) =>
      deviceEntry(module.pureCircuits, device, input.addressBytes, state.device_epoch, counter),
    isMember: (entry) => state.devices.member(entry),
  });

  input.onPhase?.({ step: 'sign' });
  const recipientBytes =
    target.kind === 'address' ? target.coinPublicKey : hexToBytes(target.contractAddress);
  /* THE SAME FOUR ARGUMENTS ON BOTH ARMS, and in the same order:
     `(recipient, colour, amount, coin)` between the account and `auth_nonce`.
     What differs is what comes back — finished bytes for a vendor to sign, or
     a builder for the passkey's signer to grind. */
  const challengeArgs = [
    module.pureCircuits,
    context,
    device.pk,
    recipientBytes,
    input.colourBytes,
    input.amount,
    input.coin,
  ] as const;
  const challenges = device.arm === 'jubjub' ? jubjubChallenges : k256Challenges;
  const challenge: K1Challenge =
    target.kind === 'address'
      ? challenges.withdrawShielded(...challengeArgs)
      : challenges.withdrawShieldedToContract(...challengeArgs);

  let auth: K1Authorisation;
  if (device.arm === 'jubjub') {
    if (typeof challenge !== 'function') {
      throw new Error('the jubjub arm needs a challenge builder, not finished bytes');
    }
    /* SYNCHRONOUS, AND NO THIRD PARTY: the grind happens in this tab. */
    auth = device.sign(challenge, useCounter);
  } else {
    if (typeof challenge === 'function') {
      throw new Error('the k256 arm needs a finished challenge, not a builder');
    }
    if (session === null) {
      throw new Error('A social sign-in Passport needs the sign-in it is held by.');
    }
    const signer = dynamicK256Signer({
      accountAddress: session.address,
      pk: device.pk,
      signRawMessage: session.signRaw,
      envelope: device.envelope,
    });
    const k256: K256Authorisation = {
      arm: 'k256',
      pk: device.pk,
      use_counter: useCounter,
      sig: await signer.signDigest(await envelopeDigest(device.envelope, challenge)),
      envelope: device.envelope,
    };
    auth = k256;
  }

  input.onPhase?.({ step: 'submit' });
  /* THE SPEND, UNPROVEN AND UNSUBMITTED. Built rather than called so that
     `[sent, change]` can be read before anything leaves this tab. */
  const spend = (await contracts.createUnprovenCallTx(providers, {
    compiledContract: providers.compiledContract,
    circuitId: input.spendCircuit,
    contractAddress: input.address,
    args: [{ bytes: recipientBytes }, input.colourBytes, input.amount, ...authArgs(auth)],
    privateStateId: input.privateStateId,
    ...(target.kind === 'address'
      ? {
          /* The coin-pk → encryption-pk mapping midnight-js needs to build a
             THIRD PARTY's note ciphertext. */
          additionalCoinEncPublicKeyMappings: new Map([
            [bytesToHex(target.coinPublicKey), bytesToHex(target.encryptionPublicKey)],
          ]),
        }
      : {}),
  })) as CustodyUnprovenCall;

  const spendResult = spend.private.result;
  const direct = payee === null ? null : directSpendFromResult(spendResult);
  const change = direct === null ? changeCoinFromResult(spendResult) : direct.change;
  if (change.outcome === 'unreadable') {
    /* NOTHING HAS BEEN SUBMITTED, AND SO NOTHING IS AT RISK. A transaction sent
       with a change description this build could not read would leave the
       remainder of somebody's balance on chain with nobody ever able to
       describe it again. */
    console.warn(`[account-custody] the change could not be read: ${change.reason}`);
    throw new Error('This Passport could not prepare that payment. Nothing was sent.');
  }

  let unprovenTx = spend.private.unprovenTx;
  let sent: CustodySentCoin | null = null;
  if (payee !== null && direct !== null) {
    if (direct.sent === null) {
      throw new Error('This Passport could not prepare that payment. Nothing was sent.');
    }
    sent = direct.sent;
    const { depositShieldedCustody } = await import('./custodyInbox.js');
    /* READ NOW, AND NOT WHEN THE PAYMENT WAS SET UP: a coin sealed to a
       rotated key arrives and can never be moved again. */
    const recipientEncKeyHex = await payee.readRecipientEncKey();
    const sealed = await depositShieldedCustody(recipientEncKeyHex, {
      colour: direct.sent.colour,
      nonce: direct.sent.nonce,
      value: direct.sent.value,
    });
    const claim = (await contracts.createUnprovenCallTx(providers, {
      compiledContract: providers.compiledContract,
      circuitId: 'deposit_shielded',
      contractAddress: payee.contractAddress,
      args: [sealed.coin, sealed.entry],
      /* NO PRIVATE STATE: `deposit_shielded` declares no witness. */
    })) as CustodyUnprovenCall;
    unprovenTx = graftIntent(unprovenTx, claim.private.unprovenTx);
  }
  return { change, sent, spendResult, unprovenTx, authNonce: context.authNonce };
}

/**
 * The providers, with a hook on balancing: `onBalanced` sees the finished
 * transaction before it is handed to the node, and nothing is balanced — so
 * nothing is handed over — once `abandoned` says so. A provider set with no
 * wallet provider is returned as it is, and the booking falls back to the
 * submit's own answer.
 */
function withBalanceHook(
  providers: Record<string, unknown>,
  onBalanced: (balanced: unknown) => void,
  abandoned: () => boolean,
): Record<string, unknown> {
  const wallet = providers.walletProvider as
    | ({ balanceTx(tx: unknown, ttl?: Date): Promise<unknown> } & Record<string, unknown>)
    | undefined;
  if (wallet === undefined || typeof wallet.balanceTx !== 'function') return providers;
  return {
    ...providers,
    walletProvider: {
      ...wallet,
      balanceTx: async (tx: unknown, ttl?: Date): Promise<unknown> => {
        if (abandoned()) throw new Error(CUSTODY_SEND_NOT_SENT);
        const balanced = await wallet.balanceTx(tx, ttl);
        if (abandoned()) throw new Error(CUSTODY_SEND_NOT_SENT);
        onBalanced(balanced);
        return balanced;
      },
    },
  };
}

/** What the indexer says of a transaction, or null when it could not be asked. */
async function askTxOutcome(
  deps: CustodyDeps,
  wallet: LocalMidnightWallet,
  txId: string,
): Promise<{ outcome: CustodyTxOutcome; hash: string | null } | null> {
  try {
    return await (deps.txOutcome ?? resolveTxOutcomeOnce)(wallet.network.indexerHttpUrl, txId);
  } catch {
    return null;
  }
}

/**
 * The gated spend to somebody's shielded address — the name every caller of
 * the three-leg build used, now one transaction and paying the RECIPIENT.
 */
export async function withdrawShieldedK1(
  session: CustodySession,
  device: CustodyCallDevice,
  request: {
    readonly recipientCoinPublicKey: Uint8Array;
    readonly recipientEncryptionPublicKey: Uint8Array;
    readonly colourHex: string;
    readonly amount: bigint;
  },
  onPhase?: (phase: CustodyPhase) => void,
  overrides: Partial<CustodyDeps> = {},
): Promise<CustodyShieldedSpendResult> {
  return spendShieldedK1(
    session,
    device,
    {
      target: {
        kind: 'address',
        coinPublicKey: request.recipientCoinPublicKey,
        encryptionPublicKey: request.recipientEncryptionPublicKey,
      },
      colourHex: request.colourHex,
      amount: request.amount,
    },
    onPhase,
    overrides,
  );
}

/** The direct transfer: this account pays another one, in one transaction. */
export async function withdrawShieldedToContractK1(
  session: CustodySession,
  device: CustodyCallDevice,
  request: {
    readonly recipientAccountAddress: string;
    /** Asked at seal time — see {@link CustodyShieldedTarget}. */
    readonly readRecipientEncKey: () => Promise<string>;
    readonly colourHex: string;
    readonly amount: bigint;
  },
  onPhase?: (phase: CustodyPhase) => void,
  overrides: Partial<CustodyDeps> = {},
): Promise<CustodyShieldedSpendResult> {
  return spendShieldedK1(
    session,
    device,
    {
      target: {
        kind: 'account',
        contractAddress: request.recipientAccountAddress,
        readRecipientEncKey: request.readRecipientEncKey,
      },
      colourHex: request.colourHex,
      amount: request.amount,
    },
    onPhase,
    overrides,
  );
}

/** What `createUnprovenCallTx` hands back, narrowed to what is used here. */
interface CustodyUnprovenCall {
  readonly private: { readonly result: unknown; readonly unprovenTx: CustodyUnprovenTx };
}

/** An unproven transaction, narrowed to the two members grafting needs. */
interface CustodyUnprovenTx {
  readonly intents?: Map<number, unknown>;
  addIntent(segment: { tag: string }, intent: unknown): CustodyUnprovenTx | undefined;
}

/**
 * Graft the recipient's claim onto the sender's transaction.
 *
 * GRAFT, DO NOT MERGE, and the difference is the whole of MIP-0012 §6.6's
 * client recipe. A merged transaction duplicates the claimed output — the
 * recipient's call materialises its own funding copy — and fails balancing.
 * `addIntent` puts the claim into the sender's already-balanced offer, in a
 * random segment, which is what the reference client's conformance test
 * submits and what the node accepts.
 *
 * THE RESULT IS CHECKED, AND IT DID NOT USED TO BE. `addIntent` returns the new
 * transaction, and a build that returned nothing fell back to the original —
 * the same defensive read the deploy waves make of `addDeploy` after three live
 * deploys landed carrying nothing. The two are not alike. A deploy that loses
 * its addition fails at the node, loudly, having spent a sponsored fee. A SPEND
 * that loses its graft is a perfectly valid transaction: the withdrawal half is
 * intact, so the sender's coin is spent and the output is addressed to the
 * recipient's contract — and the claim that was supposed to take it, and the
 * inbox entry that was supposed to describe it, are simply not there. The money
 * leaves, nobody holds it, and nobody can ever describe it. Nothing downstream
 * could detect that: the transaction succeeds.
 *
 * So the count is asserted. One intent more than went in, or the payment does
 * not go out — which costs nothing, because this runs before the proof.
 */
function graftIntent(sender: CustodyUnprovenTx, claim: CustodyUnprovenTx): CustodyUnprovenTx {
  const intents = claim.intents;
  const first = intents === undefined ? undefined : [...intents.values()][0];
  if (first === undefined) {
    throw new Error('This Passport could not prepare that payment. Nothing was sent.');
  }
  const before = sender.intents?.size ?? 0;
  const grafted = sender.addIntent({ tag: 'random' }, first);
  if (grafted === undefined || (grafted.intents?.size ?? 0) !== before + 1) {
    console.warn('[account-custody] the recipient’s claim did not attach to the payment');
    throw new Error('This Passport could not prepare that payment. Nothing was sent.');
  }
  return grafted;
}

/** midnight-js's own transaction id, off either shape of finalised data. */
function finalizedTxId(result: unknown): string | null {
  const view = result as { txId?: unknown; public?: { txId?: unknown } } | null;
  const value = view?.txId ?? view?.public?.txId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** The chain's own hash, when the finalised data carried one. */
function finalizedTxHash(result: unknown): string | null {
  const view = result as { txHash?: unknown; public?: { txHash?: unknown } } | null;
  const value = view?.txHash ?? view?.public?.txHash;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * What the chain said about a transaction that has been submitted.
 *
 * ASKED OF THE CONNECTION, not of midnight-js's `submitTx`, because the whole
 * point of {@link spendShieldedK1}'s split is that the write happens between
 * the submission and this. The provider's own wait is unbounded by contract —
 * see `passportContract.ts` for what that costs a screen — but a spend is
 * already past the point where anything can be undone by giving up, so the
 * honest thing is to wait and to say so if the wait fails.
 */
/** A bounded wait's own verdict, passed through the wait's catch untouched. */
class CustodySubmitSettled extends Error {}

/** How long one read made after a bound has run out may take. */
const CUSTODY_READ_WAIT_MS = 15_000;

/**
 * {@link watchForTxData}, or `timeout` once `milliseconds` have passed. The
 * wait itself is not cancelled — midnight-js offers no way to — it is simply
 * no longer listened to.
 */
async function watchWithin(
  providers: Record<string, unknown>,
  txId: string,
  milliseconds: number,
): Promise<{ kind: 'data'; value: unknown } | { kind: 'timeout' }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ kind: 'timeout' }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), milliseconds);
  });
  try {
    return await Promise.race([
      watchForTxData(providers, txId).then((value) => ({ kind: 'data' as const, value })),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** The account's `auth_nonce` as the chain has it now, or null when unreadable. */
async function liveAuthNonce(
  module: CustodyContractModule,
  providers: Record<string, unknown>,
  address: string,
): Promise<bigint | null> {
  try {
    /* BOUNDED, like everything asked after a wait has already run out: an
       answer that never comes is the same as none. */
    const read = await withinCustodyBound(queryStateData(providers, address), CUSTODY_READ_WAIT_MS);
    if (read.kind === 'timeout') throw new Error('the account did not answer in time');
    return module.ledger(read.value).auth_nonce;
  } catch (cause) {
    console.warn('[account-custody] the account could not be read after the wait', cause);
    return null;
  }
}

async function watchForTxData(providers: Record<string, unknown>, txId: string): Promise<unknown> {
  const reader = providers.publicDataProvider as
    | { watchForTxData?: (id: string) => Promise<unknown> }
    | undefined;
  if (typeof reader?.watchForTxData !== 'function') {
    throw new Error('this connection cannot be asked what became of a payment');
  }
  return reader.watchForTxData(txId);
}

/**
 * The chain's verdict on the transaction, off either shape of finalised data.
 *
 * Null is "the finalised data did not carry one", which is NOT a success: a
 * spend that cannot read the verdict has no business booking the coin as spent,
 * and the sentence for it says so rather than claiming either outcome.
 */
function finalizedStatus(result: unknown): string | null {
  const view = result as { status?: unknown; public?: { status?: unknown } } | null;
  const value = view?.status ?? view?.public?.status;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * midnight-js's own name for the one status that means the call ran.
 *
 * IMPORTED RATHER THAN SPELLED OUT, and dynamically, which is the idiom
 * `passportContract.ts` established for the same constant: the string belongs
 * to the library, and a copy of it here is a copy that stays behind when the
 * library renames it.
 */
async function succeededEntirely(): Promise<string> {
  const { SucceedEntirely } = await import('@midnight-ntwrk/midnight-js-types');
  return SucceedEntirely;
}

/** The block it landed in, for the record and for nothing on screen. */
function finalizedBlockHeight(result: unknown): number | null {
  const view = result as { blockHeight?: unknown; public?: { blockHeight?: unknown } } | null;
  const value = view?.blockHeight ?? view?.public?.blockHeight;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * A change coin this build could describe.
 *
 * THE ONLY KIND A SPEND EVER REACHES. An unreadable one is refused on the
 * UNPROVEN call and nothing is submitted, so the write below has no case for
 * it and is not given one: a branch that cannot fire is a branch nothing can
 * ever drill, and a write that could file an undescribed coin is a shape this
 * module should not be able to express.
 */
type CustodyReadableChange = Exclude<CustodyChangeCoin, { readonly outcome: 'unreadable' }>;

/** What the spend wrote down at submission time, for the settle that follows. */
interface ShieldedChangeWrite {
  readonly change: CustodyReadableChange;
  /** The name the coin was filed under, until the chain's hash is known. */
  readonly txId: string;
}

/**
 * File what the withdrawal returned, in ONE write, asking nothing of anybody.
 */
function writeShieldedChange(
  account: K1Account,
  colour: string,
  change: CustodyReadableChange,
  identifier: string | null,
  at: number,
): ShieldedChangeWrite {
  const txId = identifier ?? 'unknown';
  if (change.outcome === 'none') {
    rememberK1ChangeCoin(account, colour, null, txId, at);
    return { change, txId };
  }
  rememberK1ChangeCoin(
    account,
    colour,
    { colour: change.colour, nonce: change.nonce, value: change.value },
    txId,
    at,
  );
  return { change, txId };
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
  written: ShieldedChangeWrite,
): Promise<CustodyShieldedWithdrawResult> {
  const base = { ...step, sent: null, blockHeight: null, candidate: 0 };
  const change = written.change;
  if (change.outcome !== 'change') return { ...base, change, changePosition: 'none' };
  if (step.txHash === null) {
    console.warn('[account-custody] the change coin has no transaction to look its position up by');
    return { ...base, change, changePosition: 'awaiting' };
  }
  /* THE HASH REPLACES THE IDENTIFIER the coin was filed under. The indexer
     answers commitment windows by the chain's hash, and a sponsored
     transaction is superseded, so the id midnight-js returned is not a key it
     can answer — which is exactly how a change coin used to stay "arriving"
     for ever. */
  if (written.txId !== step.txHash) {
    renameK1AwaitingTx(account, change.colour, written.txId, step.txHash);
  }
  /* THE HASH NAMES THE ROW, not the colour. A colour can have a second coin in
     flight — an earlier spend's change this walk has not placed — and settling
     "the colour" would file one of them and drop the rest. */
  const settled = await settleK1AwaitingCoinByChainHash(
    account,
    change.colour,
    step.txHash,
    (txId) => deps.resolveChainHash(wallet.network.indexerHttpUrl, txId),
    (txId) => deps.commitmentWindow(wallet.network.indexerHttpUrl, txId),
  );
  if (settled.outcome === 'learned') return { ...base, change, changePosition: 'settled' };
  if (settled.outcome === 'ambiguous') {
    return { ...base, change, changePosition: settled.stored ? 'candidates' : 'awaiting' };
  }
  return { ...base, change, changePosition: 'awaiting' };
}

/**
 * Put the change coin's description into this account's own inbox.
 *
 * THE TIDY-UP AFTER A SEND, AND NEVER PART OF IT. The recipient has their money
 * the moment the send lands; this writes down what the account kept, so a
 * second device — or this one after its storage is cleared — can find it. The
 * description exists nowhere else: the chain carries the note and the circuit
 * returned its description privately, to this tab and to nobody else.
 *
 * IT COSTS A SECOND APPROVAL, because `append_inbox` is gated like every other
 * operation on this contract. That is why it runs after the send has been
 * reported rather than inside it, and why a caller that cannot get one loses
 * the record and not the money.
 *
 * Skipped rather than failed when there is nothing to describe — see
 * {@link custodyChangeBackfill}, which decides, and returns null here.
 */
export async function appendChangeToInboxK1(
  session: CustodySession,
  device: CustodyCallDevice,
  request: {
    readonly change: CustodyChangeCoin;
    /** This account's own advertised encryption key, read live by the caller. */
    readonly ownEncKeyHex: string | null;
  },
  onPhase?: (phase: CustodyPhase) => void,
  overrides: Partial<CustodyDeps> = {},
): Promise<CustodyStepResult | null> {
  const decided = custodyChangeBackfill(request.change, request.ownEncKeyHex);
  if (decided.kind === 'skip') {
    console.info(`[account-custody] no inbox entry for the change: ${decided.reason}`);
    return null;
  }
  const { sealCustodyInboxEntry } = await import('./custodyInbox.js');
  const entry = await sealCustodyInboxEntry(decided.ownEncKeyHex, decided.coin);
  return appendInboxK1(session, device, entry, onPhase, overrides);
}

/* -------------------------------------------------------------------------- */
/* NIGHT out to an address                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Pay NIGHT out of this Passport to an unshielded (`mn_addr…`) address — ONE
 * gated transaction, `withdraw_unshielded_with_<arm>(colour, amount,
 * recipient, …auth)`.
 *
 * NO COIN, SO NO SPLIT. NIGHT lives on the account's `unshielded_balances`
 * mirror, which the circuit debits by exactly `amount` before
 * `sendUnshielded` pays the recipient; there is no note to consume whole, so a
 * partial amount is simply a smaller debit, and there is no change to backfill.
 *
 * THE ARGUMENT ORDER IS THE CIRCUIT'S OWN: `(color, amount, recipient)`, where
 * the two shielded spends take `(recipient, color, amount)`. The challenge
 * builders already encode that order; this passes the same three values to the
 * circuit and to the challenge, so the signature is over exactly what is paid.
 *
 * WHAT IT CANNOT DO is pay another Passport's account: the recipient is a
 * `UserAddress` by type, and the contract has no route that moves NIGHT
 * between two accounts. The Send sheet refuses that pair before anything is
 * asked of anybody.
 */
export async function withdrawUnshieldedK1(
  session: CustodySession,
  device: CustodyCallDevice,
  request: {
    /** The 32 bytes inside an `mn_addr…` address. */
    readonly recipient: Uint8Array;
    readonly colourHex: string;
    readonly amount: bigint;
  },
  onPhase?: (phase: CustodyPhase) => void,
  overrides: Partial<CustodyDeps> = {},
): Promise<CustodyStepResult> {
  if (request.recipient.length !== 32) {
    throw new Error('That is not an address this Passport can pay.');
  }
  if (request.amount <= 0n) throw new Error('Enter an amount greater than zero.');
  const colour = normalisedColourHex(request.colourHex);
  if (colour === null) throw new Error('That is not something this Passport can send.');
  const colourBytes = hexToBytes(colour);
  const recipient = request.recipient;
  const amount = request.amount;
  return k1Call(
    session,
    device,
    {
      operation: 'withdraw_unshielded',
      args: [colourBytes, amount, { bytes: recipient }],
      bounded: true,
      challenge: (pure, context, pk) =>
        device.arm === 'jubjub'
          ? jubjubChallenges.withdrawUnshielded(pure, context, pk, colourBytes, amount, recipient)
          : k256Challenges.withdrawUnshielded(pure, context, pk, colourBytes, amount, recipient),
    },
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
      /* BOUNDED (2026/09/22). This is the tidy-up after every payment, and it
         went through midnight-js's own `callTx`, whose wait for finality has no
         end: a tidy-up whose transaction the chain never recorded held the
         screen that started it, and every payment after it, for ever. */
      bounded: true,
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
/* A second key on the same Passport                                          */
/* -------------------------------------------------------------------------- */

/**
 * Enrol ANOTHER device on this account, authorised by one that is already on
 * it — the whole of the spare-key decision of 2026/09/21, in one call.
 *
 * IT IS CROSS-ARM BY CONSTRUCTION AND NOT BY A BRANCH. `add_device` takes a
 * derived ENTRY rather than a key, so the contract sees 32 opaque bytes and
 * never learns which curve produced them. That is what lets the device key back
 * up a sign-in (the backup: a jubjub device signs, a k256 entry goes in) and a
 * sign-in bring a Passport to a new phone (the recovery: a k256 device signs, a
 * jubjub entry goes in) through the same function, with the arm deciding only
 * which circuit is proved and which challenge is built.
 *
 * THE EPOCH IS READ, NOT ASSUMED. `enrolmentEntry` binds the new device's entry
 * to the account's CURRENT `device_epoch`, and an entry derived at a stale one
 * is dead weight that still counts toward `device_count` — the contract cannot
 * tell the difference and neither can the holder, until the day the spare key
 * is needed and does not work. So the ledger is read here before the entry is
 * built, which is a second read of a state `k1Call` reads again for its own
 * `auth_nonce`. Deliberate: those two reads answer different questions and
 * sharing one would mean building the entry against a nonce that may since have
 * moved.
 *
 * ALREADY ENROLLED IS NOT AN ERROR. The probe below is the same series scan
 * `k1Call` and the recovery check do, and a device it finds is a device that is
 * already on the account — so the call is skipped and nobody is asked for an
 * approval. That matters because the recovery flow is resumable: a browser
 * closed between making a key and recording it comes back and runs this again,
 * and a second enrolment would cost a second approval and insert a second entry
 * for one device.
 */
export async function addDeviceK1(
  session: CustodySession,
  device: CustodyCallDevice,
  newDevice: JubjubDeviceIdentity | K256DeviceIdentity,
  onPhase?: (phase: CustodyPhase) => void,
  overrides: Partial<CustodyDeps> = {},
): Promise<CustodyStepResult> {
  const deps = withDefaults(overrides);
  const user = custodyUserKey(session, device);
  const prepareMs = deps.prepareWaitMs ?? CUSTODY_PREPARE_WAIT_MS;
  /* BOUNDED BEFORE ANYTHING IS ASKED FOR (2026/09/24). Opening the connection
     and reading the account had no end, so a node that never answered left
     "Adding your way back" on screen for ever. Nothing has been sent here, so
     running out is a definite "not added". */
  const opened = await withinCustodyBound(
    (async () => {
      const wallet = await deps.wallet(user);
      const network = wallet.network.networkId;
      const record = loadCustodyRecord(deps.storage(), user, network);
      if (!record || record.address === null || nextCustodyStep(record) !== 'ready') {
        throw new Error('This Passport is not finished being set up yet.');
      }
      /* A KEY OF THE OTHER ARM NEEDS THE OTHER ARM'S CIRCUITS, and since
         2026/09/22 those land in the waves after Home. Enrolling it before them
         would put a key on the account that can approve nothing — so it waits,
         and says so in words the screen may show. */
      if (newDevice.arm !== device.arm && custodyWavesPending(record)) {
        throw new Error(CUSTODY_STILL_FINISHING);
      }
      const module = await deps.contractModule();
      const { providers } = await openCustodyAccount(deps, wallet, record, [
        `add_device_with_${device.arm}`,
      ]);
      const state = module.ledger(await queryStateData(providers, record.address));
      return { record, module, providers, state };
    })(),
    prepareMs,
  );
  if (opened.kind === 'timeout') {
    console.warn(`[account-custody] opening the account to add a key did not finish in ${Math.round(prepareMs / 1000)} s; nothing was sent`);
    throw new Error(CUSTODY_KEY_NOT_ADDED);
  }
  const { record, module, providers, state } = opened.value;
  const address = record.address as string;
  const addressBytes = hexToBytes(address);

  /* Already on the account? Then there is nothing to do and nothing to ask
     for. */
  if (deviceIsEnrolled(module, newDevice, addressBytes, state)) {
    return { record, txHash: null, explorerUrl: null };
  }

  const entry = enrolmentEntry(
    module.pureCircuits,
    newDevice,
    addressBytes,
    state.device_epoch,
  );
  /* Whether anything was handed over. Before the `submit` phase nothing was,
     and a failure there is a definite "not added"; after it the only honest
     answer is the account's own. */
  let handedOver = false;
  try {
    return await k1Call(
      session,
      device,
      {
        operation: 'add_device',
        args: [entry],
        /* BOUNDED (2026/09/24), and for the reasons every payment already is.
           Unbounded, it went through midnight-js's own `callTx`, whose wait for
           finality has no end — and `k1Call` only builds a call again on the
           node's 104 or 196 when it is bounded, so a refusal that the next
           attempt would have cured was reported to the reader as a failure. */
        bounded: true,
        /* The SIGNING device's arm picks the challenge, never the new one's: the
           new device is 32 bytes of argument and signs nothing here. */
        challenge: (pure, context, pk) =>
          device.arm === 'jubjub'
            ? jubjubChallenges.addDevice(pure, context, pk, entry)
            : k256Challenges.addDevice(pure, context, pk, entry),
      },
      (phase) => {
        if (phase.step === 'submit') handedOver = true;
        onPhase?.(phase);
      },
      overrides,
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '';
    /* DEFINITELY NOT ADDED: nothing handed over, the node refused it whole,
       the chain recorded it as failed, or no proof was ever made. */
    const definite =
      !handedOver ||
      message === CUSTODY_SEND_NOT_SENT ||
      message === CUSTODY_SEND_FAILED ||
      message === CUSTODY_PROVER_UNAVAILABLE ||
      isCustodyProofNotBuilt(cause) ||
      custodyNodeRefused(cause);
    if (definite) {
      console.warn('[account-custody] the key was not added', cause);
      throw new Error(CUSTODY_KEY_NOT_ADDED);
    }
    /* AN OUTCOME NOBODY SAW — a socket dropped after the booking, or a wait
       that ran out over an account that moved. The add is idempotent, so the
       account is ASKED: a key it holds is a key that is on, and the reader is
       told so rather than told it failed. */
    console.warn('[account-custody] the key was sent and its outcome is not known; asking the account', cause);
    for (let attempt = 0; attempt < CUSTODY_KEY_RECHECKS; attempt += 1) {
      if (attempt > 0) await deps.sleep(CUSTODY_KEY_RECHECK_WAIT_MS);
      const read = await withinCustodyBound(
        queryStateData(providers, address).catch(() => null),
        CUSTODY_READ_WAIT_MS,
      );
      if (read.kind === 'done' && read.value !== null) {
        if (deviceIsEnrolled(module, newDevice, addressBytes, module.ledger(read.value))) {
          console.info('[account-custody] the account holds the new key: it landed');
          return { record, txHash: null, explorerUrl: null };
        }
      }
    }
    throw new Error(CUSTODY_KEY_UNCONFIRMED);
  }
}

/**
 * Whether `newDevice` is already on the account whose state is `state`.
 *
 * The same series scan `k1Call` and the recovery check do: a device's entry
 * rolls forward each time it approves, so counter zero alone would miss every
 * device that has ever been used. `resolveCustodyUseCounter` throws when the
 * series is not in the set, which is the ordinary answer here.
 */
function deviceIsEnrolled(
  module: CustodyContractModule,
  newDevice: JubjubDeviceIdentity | K256DeviceIdentity,
  addressBytes: Uint8Array,
  state: CustodyLedger,
): boolean {
  try {
    resolveCustodyUseCounter({
      entryAt: (counter) =>
        deviceEntry(module.pureCircuits, newDevice, addressBytes, state.device_epoch, counter),
      isMember: (entry) => state.devices.member(entry),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Point this account's deliveries at a new key.
 *
 * WHAT IT IS FOR, AND IT IS ONE THING. A Passport brought back on a new device
 * has a new key on it, and the secret that OPENS this account's deliveries is
 * derived from the key that made the Passport — which is on the device that is
 * gone. Nothing a sign-in can do reproduces it: the embedded signer's ECDSA is
 * randomised, so even a signature over a fixed message is different every time
 * (audited 2026/09/16). So the account is pointed at the new device's own key
 * instead, and everything paid in from that moment is readable here.
 *
 * WHAT IT DOES NOT DO IS RECOVER THE PAST. Deliveries already in the account
 * were sealed to the old key and stay sealed to it; the contract's own note on
 * this circuit says a client SHOULD re-seal what it holds under the new key
 * afterwards, and a client that cannot READ them cannot re-seal them. That is
 * the honest limit of this circuit on its own.
 *
 * WHAT READS THE PAST INSTEAD (2026/09/26), with no contract change: the old
 * key itself, carried in the person's password backup (`./backup.ts`) and kept
 * on the new device as an EARLIER key beside the new one (`./viewingKeys.ts`).
 * The inbox walk tries both, so the rotation still does what it is for — every
 * delivery from now on is readable by the new passkey alone — and the notes
 * sealed before it are read with the key they were sealed to. Nothing is
 * re-sealed and nothing is written to the account.
 *
 * JUBJUB ONLY, and not by preference. `challenge_rotate_enc_key_with_k256` is
 * not on the compiled build's pure-circuit surface this app declares
 * (`custodyContractSigning.ts`), so there is no way to build the challenge a
 * k256 signature would have to be over. The one caller wants the new DEVICE
 * key to sign anyway — it is the key whose secret the account is being pointed
 * at — so the gap costs nothing and is refused out loud rather than worked
 * around.
 */
export async function rotateEncKeyK1(
  session: CustodySession,
  device: CustodyCallDevice,
  newPublicKeyHex: string,
  onPhase?: (phase: CustodyPhase) => void,
  overrides: Partial<CustodyDeps> = {},
): Promise<CustodyStepResult> {
  if (device.arm !== 'jubjub') {
    throw new Error('Only the key on a device can point this Passport at a new one.');
  }
  const newKey = hexToBytes(newPublicKeyHex);
  if (newKey.length !== 32) {
    throw new Error(`an account encryption key is 32 bytes, got ${newKey.length}`);
  }
  return k1Call(
    session,
    device,
    {
      operation: 'rotate_enc_key',
      args: [newKey],
      challenge: (pure, context, pk) => jubjubChallenges.rotateEncKey(pure, context, pk, newKey),
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
 * Whether a transaction's proof has to go to the service that holds the big keys.
 *
 * NOTHING HERE IS PROVED IN THE TAB, AND NOTHING CAN BE (Nicolas, 2026/09/18).
 * The whole account custody contract is ZKIR v3 and there is no in-browser v3
 * prover, so every proof of every one of its circuits is made somewhere else.
 * The only question is WHICH somewhere: the gated circuits' prover keys are
 * 235 MB and cannot cross a browser at all, so they go to the sponsor's own
 * route, which holds the keys and is handed the transaction
 * ({@link custodyProofProvider}); the permissionless deposits are 0.4 MB and
 * 11 MB, so the browser can upload their keys to the proof server through the
 * ordinary v3 route `createContractProviders` already built. Either way the
 * proof is made on the droplet and the service that makes it sees the coin and
 * the amount — that is a property of this build, not a bug in it, and it is
 * recorded in `docs/demo/account-custody-layer-design.md`.
 *
 * Sending a deposit to the big-key service would work and would put a queue for
 * 235 MB proofs in front of a payment that does not need one.
 */
function custodyNeedsBigKeyProver(circuits: readonly string[]): boolean {
  /* ANY of them. A composed transaction pairs a gated spend with a
     permissionless claim, and one 224 MB key in it is enough to put the whole
     transaction where the keys are. */
  return circuits.some(
    (circuit) => circuit.endsWith('_with_k256') || circuit.endsWith('_with_jubjub'),
  );
}

/** What a connection is opened against. */
interface CustodyConnectionTarget {
  readonly address: string;
  readonly privateStateId: string;
  readonly account: K1Account | null;
  readonly initialPrivateState: unknown;
  /** Every circuit the transaction this connection builds will call. */
  readonly circuits: readonly string[];
  /** Forwarded to {@link custodyProofProvider}; see its `onProved`. */
  readonly onProved?: () => void;
}

/**
 * The providers for one transaction, with its proof route already chosen.
 *
 * SEPARATE FROM {@link openCustodyContract} because a composed transaction has
 * no deployed-contract handle to make: it builds each call itself, grafts one
 * onto the other, and submits the pair. Asking `findDeployedContract` for a
 * `callTx` it would never use would be a verifier-key round trip per attempt,
 * and a spend retries.
 */
async function custodyProviders(
  deps: CustodyDeps,
  wallet: LocalMidnightWallet,
  target: CustodyConnectionTarget,
): Promise<Record<string, unknown>> {
  const providers = await deps.providers(wallet, target.privateStateId, target.account);
  /* The proof provider is per-TRANSACTION, because the service is told which
     keys to stage. Everything else in the set is shared. */
  const scoped = custodyNeedsBigKeyProver(target.circuits)
    ? {
        ...providers,
        proofProvider: custodyProofProvider({
          endpoint: custodyProvingEndpoint(sponsorConfig()?.url ?? null),
          network: wallet.network.networkId,
          circuits: target.circuits,
          deserialise: (providers.deserialiseUnbound as (b: Uint8Array) => unknown) ?? identity,
          onProved: target.onProved,
        }),
      }
    : providers;
  return scoped;
}

/**
 * The verifier-key check `findDeployedContract` makes, narrowed to the circuits
 * this connection will call.
 *
 * WHY IT IS NARROWED (2026/09/22). midnight-js refuses to open a contract whose
 * state does not carry EVERY circuit of the compiled build it is handed
 * (`verifyContractState`, with a `ContractTypeError` naming the missing ones).
 * Since the waves after the deploy land behind Home, a Passport is activated
 * and used while twenty of its thirty operations are still on their way — and
 * the check would refuse the activation itself, and every gated call, for the
 * minute or so it takes them to land.
 *
 * What the check is FOR is kept: every circuit this connection actually calls
 * is still compared against the key on chain, byte for byte, before anything is
 * built. The chain verifies each proof against its own key in any case; this is
 * the early, named refusal, for exactly the operations in play.
 */
function custodyCallScopedZkConfig(
  providers: Record<string, unknown>,
  circuits: readonly string[],
): Record<string, unknown> {
  const zk = providers.zkConfigProvider as
    | { getVerifierKeys?(ids: readonly string[]): Promise<unknown> }
    | undefined;
  if (zk?.getVerifierKeys === undefined) return providers;
  const wanted = new Set(circuits);
  const scopedZk = Object.create(zk) as typeof zk & object;
  scopedZk.getVerifierKeys = (ids: readonly string[]) =>
    (zk.getVerifierKeys as (ids: readonly string[]) => Promise<unknown>).call(
      zk,
      ids.filter((id) => wanted.has(id)),
    );
  return { ...providers, zkConfigProvider: scopedZk };
}

/** Open a deployed custody account for one circuit's proof route. */
async function openCustodyContract(
  deps: CustodyDeps,
  wallet: LocalMidnightWallet,
  target: CustodyConnectionTarget,
): Promise<{ callTx: CustodyCallTx; providers: Record<string, unknown> }> {
  const scoped = await custodyProviders(deps, wallet, target);
  const contracts = await deps.contracts();
  const deployed = await contracts.findDeployedContract(custodyCallScopedZkConfig(scoped, target.circuits), {
    compiledContract: scoped.compiledContract,
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
  circuits: readonly string[],
): Promise<{ callTx: CustodyCallTx; providers: Record<string, unknown> }> {
  return openCustodyContract(deps, wallet, {
    address: record.address as string,
    privateStateId: custodyPrivateStateId(record),
    account: custodyStoreAccount(record),
    initialPrivateState: custodyPrivateState(record),
    circuits,
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
  return finalizedTxId(result);
}

async function resolveHash(
  providers: Record<string, unknown>,
  result: unknown,
): Promise<string | null> {
  /* EITHER SHAPE. A call made through `callTx` comes back wrapped in a
     `public` half; one built and submitted by hand comes back as the finalised
     transaction data itself. Both carry the same id under the same name. */
  const identifier = finalizedTxId(result);
  if (identifier === null) return null;
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
/* The setup's warm-up                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Fetch and build what a setup needs, BEFORE the press that needs it.
 *
 * WHY (2026/09/22). The first fourteen seconds of a measured setup were the
 * client getting ready — the compiled module, the ledger WASM, midnight-js, the
 * thirty verifier keys, and a wallet — and nothing on chain. The name step
 * gives the person ten to thirty seconds of typing for free, so the screen
 * calls this when the field is shown and the press finds it all in hand.
 *
 * THE WALLET IS NOT OPENED HERE (2026/09/23). It was, and its socket to the
 * node sat idle while the person typed; the node closed it, and the deploy
 * went out on the dead socket and never reached the chain. The connection is
 * opened at the press instead (`freshCustodyWallet`). `user` is kept in the
 * signature for the callers and the drills that pass it. Every failure is
 * swallowed — a warm-up that fails leaves the press to do the work exactly as
 * it always did.
 */
export async function warmCustodySetup(
  options: { readonly user: string | null; readonly arm: K1Arm },
  overrides: Partial<CustodyDeps> = {},
): Promise<void> {
  /* The wallet is `defaultCustodyDeps`'s: one connection per user for the tab,
     so the one warmed here is the one the press uses. */
  const deps = withDefaults(overrides);
  const tasks: Promise<unknown>[] = [
    deps.contractModule(),
    deps.ledger(),
    deps.contracts(),
    compiledContractFor(ACCOUNT_CUSTODY_CONTRACT, ACCOUNT_CUSTODY_LABEL, custodyWitnesses()),
    contractZkConfigProvider(ACCOUNT_CUSTODY_CONTRACT).then((zk) =>
      Promise.all(allCustodyCircuits(options.arm).map((circuit) => zk.getVerifierKey(circuit))),
    ),
  ];
  const settled = await Promise.allSettled(tasks);
  const failed = settled.filter((outcome) => outcome.status === 'rejected').length;
  if (failed > 0) {
    console.info(`[account-custody] ${failed} of the setup's pieces could not be fetched early; the press will fetch them`);
  }
}

/* -------------------------------------------------------------------------- */
/* The default seams                                                          */
/* -------------------------------------------------------------------------- */

function withDefaults(overrides: Partial<CustodyDeps>): CustodyDeps {
  return { ...defaultCustodyDeps(), ...overrides };
}

/** The connection each user's calls are made on, shared for the tab. */
const openWallets = new Map<string, Promise<LocalMidnightWallet>>();
/** Whose connection a wallet is, so a submission on it can reopen it. */
const walletUsers = new WeakMap<LocalMidnightWallet, string>();
/** When each user's connection was opened, so an idle one can be refreshed. */
const walletOpenedAt = new Map<string, number>();

/**
 * Whether a wallet's socket to the node is KNOWN to be closed.
 *
 * polkadot-js's `ApiPromise.isConnected`, on the submission service the facade
 * submits through. Anything that does not carry one reads as open, and the
 * failure of the submission itself is then what says otherwise.
 */
function walletSocketOpen(wallet: LocalMidnightWallet): boolean {
  const service = (wallet.facade as unknown as { submissionService?: { api?: { isConnected?: unknown } } })
    .submissionService;
  return service?.api?.isConnected !== false;
}

/**
 * The providers' submit, made to survive a node socket closed while idle.
 *
 * LIVE ON THE DEV SITE, 2026/09/23. The setup's deploy was balanced, then
 * submitted on a socket the node had closed while the person typed, and never
 * reached the chain. Every custody submission — the deploy, the waves, the
 * activation, a payment — goes through here: a connection known to be closed
 * is replaced first, and a submission refused because the socket closed under
 * it is offered once more, as the same balanced bytes, on a fresh connection.
 * See `custodySubmitOnLiveConnection`.
 */
export function custodyLiveSubmitProvider(
  walletProvider: { submitTx(tx: unknown): Promise<unknown> } & Record<string, unknown>,
  isOpen: () => boolean,
  reconnect: () => Promise<{ submitTx(tx: unknown): Promise<unknown> }>,
): Record<string, unknown> {
  return {
    ...walletProvider,
    submitTx: (tx: unknown) =>
      custodySubmitOnLiveConnection(
        tx,
        { submit: (next) => walletProvider.submitTx(next), isOpen },
        async (): Promise<CustodySubmitRoute<unknown>> => {
          const fresh = await reconnect();
          return { submit: (next) => fresh.submitTx(next), isOpen: () => true };
        },
        (line) => console.info(line),
      ),
  };
}

/** The same, for one user's shared connection: reconnecting reopens it. */
function submitOnLiveConnection(
  walletProvider: { submitTx(tx: unknown): Promise<unknown> } & Record<string, unknown>,
  wallet: LocalMidnightWallet,
  user: string,
): Record<string, unknown> {
  return custodyLiveSubmitProvider(
    walletProvider,
    () => walletSocketOpen(wallet),
    async () => {
      const deps = defaultCustodyDeps();
      deps.releaseWallet?.(user);
      return walletProviderFor(await deps.wallet(user));
    },
  );
}

/**
 * The user's connection, refreshed when it has sat idle past
 * {@link CUSTODY_IDLE_WALLET_MS} or is known to be closed. For the setup press:
 * a connection opened when the page loaded may have been closed by the node
 * while the person was typing.
 */
export async function freshCustodyWallet(user: string): Promise<void> {
  const deps = defaultCustodyDeps();
  const opened = walletOpenedAt.get(user);
  const held = openWallets.get(user);
  if (held !== undefined && opened !== undefined) {
    const wallet = await held.catch(() => null);
    const stale = Date.now() - opened > CUSTODY_IDLE_WALLET_MS;
    if (wallet !== null && !stale && walletSocketOpen(wallet)) return;
    deps.releaseWallet?.(user);
  }
  await deps.wallet(user);
}

/** How long an idle connection is trusted before a setup press reopens it. */
export const CUSTODY_IDLE_WALLET_MS = 20_000;

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
    /* ONE CONNECTION PER USER FOR THE TAB (2026/09/22). This opened a fresh
       wallet on EVERY call — every read of Home, every refresh, every Send
       sheet, every payment — and closed none of them, so a Passport that had
       been looked at for a while had dozens running at once, each restoring
       its snapshot and syncing on its own sockets (live, 2026/09/22: ten in
       the first five minutes of one walk). A connection is now shared and
       dropped only when a payment's submission was lost on it
       (`releaseWallet`), so the next one opens afresh. */
    wallet: (user) => {
      const held = openWallets.get(user);
      if (held !== undefined) return held;
      const opening = createLocalMidnightWallet(custodyWalletSeed(defaultCustodyDeps(), user));
      openWallets.set(user, opening);
      walletOpenedAt.set(user, Date.now());
      void opening.then((wallet) => walletUsers.set(wallet, user)).catch(() => undefined);
      opening.catch(() => {
        if (openWallets.get(user) === opening) openWallets.delete(user);
      });
      return opening;
    },
    releaseWallet: (user) => {
      openWallets.delete(user);
      walletOpenedAt.delete(user);
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
      const owner = walletUsers.get(wallet);
      const live =
        owner === undefined
          ? {}
          : (() => {
              const submitting = submitOnLiveConnection(
                (providers as { walletProvider: { submitTx(tx: unknown): Promise<unknown> } & Record<string, unknown> })
                  .walletProvider,
                wallet,
                owner,
              );
              return { walletProvider: submitting, midnightProvider: submitting };
            })();
      return {
        ...(providers as Record<string, unknown>),
        ...live,
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
    ...walkBounds(),
  };
}

/**
 * How long everything before a payment is handed over may take, as this tab
 * runs it — {@link CUSTODY_PREPARE_WAIT_MS}, or a walk's shorter bound. For
 * the screen's own steps in front of the client's (opening, reading the
 * recipient), which answer to the same rule.
 */
export function custodyPrepareWaitMs(): number {
  return walkBounds().prepareWaitMs ?? CUSTODY_PREPARE_WAIT_MS;
}

/**
 * Shorter bounds for a browser walk, and for nothing else.
 *
 * A walk that drills "a payment stuck before it is proved is answered within
 * the bound" cannot wait the two minutes the bound really is, so it sets
 * `window.__passportCustodyBounds` before the app loads. Nothing in the app
 * writes it; a value that is not a positive number is ignored.
 */
function walkBounds(): Partial<Pick<CustodyDeps, 'prepareWaitMs' | 'handoverWaitMs' | 'submitWaitMs'>> {
  const hook = (globalThis as { __passportCustodyBounds?: Record<string, unknown> })
    .__passportCustodyBounds;
  if (!hook || typeof hook !== 'object') return {};
  const bounds: Partial<Pick<CustodyDeps, 'prepareWaitMs' | 'handoverWaitMs' | 'submitWaitMs'>> = {};
  for (const key of ['prepareWaitMs', 'handoverWaitMs', 'submitWaitMs'] as const) {
    const value = hook[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) bounds[key] = value;
  }
  return bounds;
}
