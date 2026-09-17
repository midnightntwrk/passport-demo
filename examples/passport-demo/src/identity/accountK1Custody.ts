/**
 * The network half of the k1 custody layer: a Dynamic Passport, deployed,
 * activated, and called, on a contract whose device is an embedded EVM key.
 *
 * WHAT THIS IS (2026/09/16)
 * -------------------------
 * `accountK1.ts` is the signing boundary and knows no sockets.
 * `accountK1Plan.ts` is the decisions and knows no sockets either. This module
 * is everything with a socket on the end of it, for exactly one flow:
 *
 *   sign in with Dynamic → deploy a k1 account in three sponsored waves →
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
 * 1. PROVING IS SERVER-SIDE, AND HAS TO BE. The k1 build's prover keys are
 *    3.2 GB — 224 MB per k256 circuit. `httpClientProofProvider`, which is what
 *    every other module in this app proves through, uploads the prover key with
 *    every request. A browser can neither hold one nor upload one, so the route
 *    PR #58 opened (`VITE_MIDNIGHT_PROVING_URL_V3` → a proof server) cannot
 *    carry this traffic however healthy that server is. {@link k1ProofProvider}
 *    posts the SERIALISED TRANSACTION to a service that already holds the keys
 *    and gets a proven transaction back. See `accountK1Plan.ts` for the
 *    endpoint and why it hangs off the sponsor's origin.
 *
 * 2. A DEPLOY IS THREE TRANSACTIONS, NOT ONE. Thirteen circuits fit a block and
 *    this contract has thirty, so the roster is deployed in waves: the deposits
 *    plus the whole k256 arm in the deploy itself, then the rest by two signed
 *    maintenance updates, the last of which retires the maintenance authority.
 *    A Passport's setup therefore has a middle, and a reload during it has
 *    somewhere to resume from — which is what {@link K1AccountRecord} is for.
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
 * `POST /prove-k1` does not exist yet. Until it does, every path that needs a
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
 * Every function below takes an optional `Partial<K1Deps>`. That is the idiom
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
  type K1PureCircuits,
  type K256Authorisation,
  type K256DeviceIdentity,
  k256Challenges,
  deviceEntry,
  bootCommitment,
} from './accountK1.js';
import {
  allK1Circuits,
  hexToBytes,
  k1ExplorerLink,
  k1ProvingEndpoint,
  K1_PROVER_UNAVAILABLE,
  loadK1Record,
  newK1Record,
  nextK1Step,
  parseProveK1Response,
  describeProveK1Failure,
  planK1Waves,
  proveK1Request,
  resolveK1UseCounter,
  saveK1Record,
  type K1AccountRecord,
  type K1Storage,
  type K1Wave,
} from './accountK1Plan.js';
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
export interface K1DynamicSession {
  /** `primaryWallet.address`. The per-user key, and what `signRaw` addresses. */
  readonly address: string;
  readonly signRaw: DynamicSignRawMessage;
}

/** The per-user key. One Dynamic user has one embedded key. */
export function k1UserKey(session: Pick<K1DynamicSession, 'address'>): string {
  return session.address.toLowerCase();
}

/* -------------------------------------------------------------------------- */
/* The seams                                                                  */
/* -------------------------------------------------------------------------- */

/** How far along a step the caller is told it has got. */
export interface K1Phase {
  readonly step: 'wallet' | 'deploy' | 'waves' | 'activate' | 'sign' | 'submit' | 'confirm';
  readonly detail?: string;
}

/** Everything this module reaches for that a drill wants to replace. */
export interface K1Deps {
  storage(): K1Storage;
  randomBytes(length: number): Uint8Array;
  /** The wallet this Dynamic user's transactions are constructed with. */
  wallet(user: string): Promise<LocalMidnightWallet>;
  /** The compiled `account-k1` module, for its pure circuits and its ABI. */
  contractModule(): Promise<K1ContractModule>;
  /** Providers, with this module's own proof provider already substituted in. */
  providers(
    wallet: LocalMidnightWallet,
    privateStateId: string,
  ): Promise<Record<string, unknown>>;
  /** The ledger primitives the wave deploy builds transactions out of. */
  ledger(): Promise<K1LedgerApi>;
  /** midnight-js's deploy and call entry points. */
  contracts(): Promise<K1ContractsApi>;
  now(): number;
  sleep(milliseconds: number): Promise<void>;
}

/** The parts of the compiled build this module uses. */
export interface K1ContractModule {
  readonly pureCircuits: K1PureCircuits;
  readonly Contract: unknown;
  ledger(state: unknown): K1Ledger;
}

/** The ledger fields a gated call reads. */
export interface K1Ledger {
  readonly auth_nonce: bigint;
  readonly device_epoch: bigint;
  readonly device_count: bigint;
  readonly booted: boolean;
  readonly devices: { member(entry: Uint8Array): boolean };
}

/** The ledger-v9 constructors the wave deploy needs, named rather than `any`. */
export interface K1LedgerApi {
  ContractState: (new () => K1ContractState) & { deserialize(raw: Uint8Array): K1ContractState };
  ContractDeploy: new (state: K1ContractState) => { address: unknown };
  ContractMaintenanceAuthority: new (
    committee: unknown[],
    threshold: number,
    counter: bigint,
  ) => unknown;
  ContractOperationVersionedVerifierKey: new (version: string, key: Uint8Array) => unknown;
  Intent: { new: (ttl: Date) => K1Intent };
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
export interface K1ContractState {
  data: unknown;
  maintenanceAuthority: { counter: bigint };
  operation(circuit: string): unknown;
  setOperation(circuit: string, operation: unknown): void;
  serialize(): Uint8Array;
}

interface K1Intent {
  addDeploy(deploy: unknown): unknown;
  addMaintenanceUpdate(update: unknown): unknown;
}

/** midnight-js's two entry points, as this module calls them. */
export interface K1ContractsApi {
  createUnprovenDeployTx(providers: unknown, options: unknown): Promise<K1DeployTxData>;
  submitTx(providers: unknown, options: unknown): Promise<unknown>;
  findDeployedContract(providers: unknown, options: unknown): Promise<{ callTx: K1CallTx }>;
}

/** What `createUnprovenDeployTx` hands back, narrowed to what is used here. */
export interface K1DeployTxData {
  public: { initialContractState: { serialize(): Uint8Array } };
  private: { signingKey: unknown; initialPrivateState: unknown };
}

type K1CallTx = Record<string, (...args: unknown[]) => Promise<unknown>>;

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** The contract module name, and the artefact tree PR #58 staged for it. */
export const K1_CONTRACT = 'account-k1' as const;

/**
 * The compiled-contract label — the namespace `FetchZkConfigProvider` composes
 * artefact URLs from. NOT `passport-account`: that is the prototype's tree, and
 * a k1 build asking for it would fetch keys for circuits that do not exist.
 */
export const K1_LABEL = 'passport-account-k1';

/** How long a k1 transaction has to be included. The sponsored default. */
export const K1_TX_TTL_MS = 30 * 60 * 1000;

/**
 * How long the authority counter is waited on between waves.
 *
 * A maintenance update that has been included but not yet read back leaves the
 * next wave building against a stale counter, which the node rejects. The
 * reference waits for the counter to advance; so does this.
 */
export const K1_AUTHORITY_WAIT_MS = 120_000;
const K1_AUTHORITY_POLL_MS = 2_000;

/** `localStorage` key for the per-device wallet seeds. */
export const K1_SEED_KEY = 'passport-k1-seed:v1';

/** The digest the device signs once, at enrolment, so its point can be recovered. */
export const K1_ENROLMENT_MESSAGE = 'midnight-passport:k1-device-enrolment:v1';

/* -------------------------------------------------------------------------- */
/* The server proof provider                                                  */
/* -------------------------------------------------------------------------- */

/** What {@link k1ProofProvider} needs that is not the transaction. */
export interface K1ProofProviderOptions {
  /** `POST` target. From `accountK1Plan.ts`'s {@link k1ProvingEndpoint}. */
  readonly endpoint: string;
  readonly network: string;
  /** The circuit being proved, for the service to pick the right key. */
  readonly circuit: string;
  /** Rehydrates the proven bytes. Injected so a drill needs no ledger WASM. */
  readonly deserialise: (bytes: Uint8Array) => unknown;
  readonly fetchFn?: typeof fetch;
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
 * IT DOES NOT HANG. A proof server behind `httpClientProofProvider` fails after
 * `PROOF_TIMEOUT_MS`, which is ten minutes of a spinner. This endpoint does not
 * exist yet, so the failure has to be immediate and legible: one sentence for
 * the person, one line naming the endpoint for whoever is reading a console.
 */
export function k1ProofProvider(options: K1ProofProviderOptions): {
  proveTx(unprovenTx: { serialize(): Uint8Array }): Promise<unknown>;
} {
  const fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
  return {
    async proveTx(unprovenTx: { serialize(): Uint8Array }): Promise<unknown> {
      const body = proveK1Request(options.circuit, unprovenTx.serialize(), options.network);
      let response: Response;
      try {
        response = await fetchFn(options.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (cause) {
        console.warn(
          `[k1] could not reach the proving service at ${options.endpoint} for ${options.circuit}`,
          cause,
        );
        throw new Error(K1_PROVER_UNAVAILABLE);
      }
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      if (!response.ok) {
        console.warn(describeProveK1Failure(response.status, parsed), text.slice(0, 400));
        throw new Error(K1_PROVER_UNAVAILABLE);
      }
      return options.deserialise(parseProveK1Response(parsed));
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
export function k1WalletSeed(deps: K1Deps, user: string): Uint8Array {
  const storage = deps.storage();
  let seeds: Record<string, string> = {};
  try {
    const raw = storage.getItem(K1_SEED_KEY);
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
    storage.setItem(K1_SEED_KEY, JSON.stringify(seeds));
  } catch (cause) {
    console.warn('[k1] could not remember this device key; the next visit resyncs', cause);
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
 * goes through the injected `recover`. `accountK1.test.ts` already establishes
 * that `@noble/curves` is a TEST dependency here and never a `src` one; this
 * signature is what keeps that true.
 */
export async function recoverK1DevicePoint(options: {
  session: K1DynamicSession;
  /** `(digest, r, s, v) -> uncompressed SEC1 bytes`, injected by the caller. */
  recover: (
    digest: Uint8Array,
    r: bigint,
    s: bigint,
    v: number,
  ) => Uint8Array | Promise<Uint8Array>;
  message?: string;
}): Promise<CurvePoint> {
  const challenge = new TextEncoder().encode(options.message ?? K1_ENROLMENT_MESSAGE);
  const digest = await envelopeDigest(K256_ENVELOPE_NONE, await sha256(challenge));
  const raw = await options.session.signRaw({
    accountAddress: options.session.address,
    message: bytesToHex(digest),
  });
  const parsed = parseEvmSignature(raw);
  return pointFromUncompressed(await options.recover(digest, parsed.r, parsed.s, parsed.v));
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
export interface K1StepResult {
  readonly record: K1AccountRecord;
  /** The chain hash, when one was resolved, and the explorer link for it. */
  readonly txHash: string | null;
  readonly explorerUrl: string | null;
}

/**
 * Deploy a k1 account for this Dynamic user, resuming whatever is already done.
 *
 * THE CHAIN IS CHECKED BEFORE EVERY STEP, not the record — the same rule
 * `accountUpgrade.ts` keeps. The record says where we think we got to; the
 * authority counter on the ledger says where we actually did, and when they
 * disagree the ledger wins. A wave that has landed but whose write was lost to
 * a closed tab is therefore skipped rather than replayed into a rejection.
 *
 * Three transactions, and all three sponsored: the deploy carries the deposits
 * and the whole k256 arm — which is what makes the account activatable and
 * callable after the first one — and two maintenance updates carry the other
 * twenty verifier keys, the last of them retiring the maintenance authority.
 */
export async function deployK1Account(
  session: K1DynamicSession,
  device: K256DeviceIdentity,
  onPhase?: (phase: K1Phase) => void,
  overrides: Partial<K1Deps> = {},
): Promise<K1StepResult> {
  const deps = withDefaults(overrides);
  const user = k1UserKey(session);
  onPhase?.({ step: 'wallet' });
  const wallet = await deps.wallet(user);
  const network = wallet.network.networkId;
  const storage = deps.storage();

  let record =
    loadK1Record(storage, user, network) ??
    newK1Record({
      user,
      network,
      privateStateId: `passport-account-k1-${user.slice(2, 10)}`,
      saltHex: bytesToHex(deps.randomBytes(32)),
      totalWaves: 3,
    });

  const [module, ledgerApi, contracts] = await Promise.all([
    deps.contractModule(),
    deps.ledger(),
    deps.contracts(),
  ]);

  const providers = await deps.providers(wallet, record.privateStateId);
  const verifierKeys = await readVerifierKeys(providers, module);
  const sizes = new Map([...verifierKeys].map(([id, key]) => [id, key.length]));
  const waves = planK1Waves(sizes, 'k256');
  record = { ...record, totalWaves: waves.length };

  if (record.address === null) {
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
  }

  for (const wave of waves.slice(1)) {
    if (record.wavesDone >= wave.index) continue;
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
  return { record, txHash, explorerUrl: txHash ? k1ExplorerLink(txHash, network) : null };
}

/** Every circuit's verifier key, read off the staged artefacts. */
async function readVerifierKeys(
  providers: Record<string, unknown>,
  _module: K1ContractModule,
): Promise<Map<string, Uint8Array>> {
  const zk = providers.zkConfigProvider as {
    getVerifierKey(circuit: string): Promise<Uint8Array | null>;
  };
  const keys = new Map<string, Uint8Array>();
  for (const circuit of allK1Circuits('k256')) {
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

interface WaveContext {
  deps: K1Deps;
  record: K1AccountRecord;
  ledgerApi: K1LedgerApi;
  providers: Record<string, unknown>;
  storage: K1Storage;
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
    wave: K1Wave;
    module: K1ContractModule;
    contracts: K1ContractsApi;
  },
): Promise<K1AccountRecord> {
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
    initialPrivateState: k1PrivateState(),
    args: [boot, encryptionKey],
  });

  const full = ledgerApi.ContractState.deserialize(
    deployData.public.initialContractState.serialize(),
  );
  const wave1 = buildWaveOneState(ledgerApi, full, wave);

  const deploy = new ledgerApi.ContractDeploy(wave1);
  const address = String(deploy.address);
  const intent = ledgerApi.Intent.new(new Date(deps.now() + K1_TX_TTL_MS));
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
  rememberSigningKey(address, signingKey);

  const next: K1AccountRecord = {
    ...context.record,
    address,
    wavesDone: 1,
    txHashes: txHash ? [...context.record.txHashes, txHash] : context.record.txHashes,
  };
  saveK1Record(storage, next);
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
  ledgerApi: K1LedgerApi,
  full: K1ContractState,
  wave: K1Wave,
): K1ContractState {
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
  context: WaveContext & { wave: K1Wave; verifierKeys: ReadonlyMap<string, Uint8Array> },
): Promise<K1AccountRecord> {
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

  const signingKey = await signingKeyFor(providers, address);
  const bare = new ledgerApi.MaintenanceUpdate(address, updates, counter);
  const signed = bare.addSignature(0n, ledgerApi.signData(signingKey, bare.dataToSign));
  const intent = ledgerApi.Intent.new(new Date(deps.now() + K1_TX_TTL_MS));
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

  const next: K1AccountRecord = {
    ...context.record,
    wavesDone: wave.index,
    txHashes: txHash ? [...context.record.txHashes, txHash] : context.record.txHashes,
  };
  saveK1Record(storage, next);

  await awaitAuthorityCounter(deps, providers, ledgerApi, address, counter + 1n);
  return next;
}

/** The maintenance authority's counter, read off the chain. */
async function authorityCounter(
  providers: Record<string, unknown>,
  ledgerApi: K1LedgerApi,
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
  deps: K1Deps,
  providers: Record<string, unknown>,
  ledgerApi: K1LedgerApi,
  address: string,
  expected: bigint,
): Promise<void> {
  const deadline = deps.now() + K1_AUTHORITY_WAIT_MS;
  for (;;) {
    const seen = await authorityCounter(providers, ledgerApi, address);
    if (seen >= expected) return;
    if (deps.now() >= deadline) {
      throw new Error('Setting up your Passport is taking longer than expected. Try again.');
    }
    await deps.sleep(K1_AUTHORITY_POLL_MS);
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
  session: K1DynamicSession,
  device: K256DeviceIdentity,
  onPhase?: (phase: K1Phase) => void,
  overrides: Partial<K1Deps> = {},
): Promise<K1StepResult> {
  const deps = withDefaults(overrides);
  const user = k1UserKey(session);
  const wallet = await deps.wallet(user);
  const network = wallet.network.networkId;
  const storage = deps.storage();
  const record = loadK1Record(storage, user, network);
  if (!record || record.address === null) {
    throw new Error('There is no Passport to add this key to yet.');
  }

  onPhase?.({ step: 'activate' });
  const { callTx } = await openK1Account(deps, wallet, record, 'activate_initial_device_with_k256');
  const salt = hexToBytes(record.saltHex);
  const result = await callTx.activate_initial_device_with_k256?.(
    device.pk,
    salt,
    device.envelope,
  );

  onPhase?.({ step: 'confirm' });
  const providers = await deps.providers(wallet, record.privateStateId);
  const txHash = await resolveHash(providers, result);
  const next: K1AccountRecord = {
    ...record,
    activated: true,
    pkXHex: device.pk.x.toString(16),
    pkYHex: device.pk.y.toString(16),
    txHashes: txHash ? [...record.txHashes, txHash] : record.txHashes,
  };
  saveK1Record(storage, next);
  return { record: next, txHash, explorerUrl: txHash ? k1ExplorerLink(txHash, network) : null };
}

/* -------------------------------------------------------------------------- */
/* A gated call                                                               */
/* -------------------------------------------------------------------------- */

/** What one gated call needs beyond the session. */
export interface K1CallRequest {
  /** The operation, unsuffixed: `append_inbox`, `withdraw_unshielded`, … */
  readonly operation: string;
  /** The circuit's own leading arguments, before the authorisation trailer. */
  readonly args: readonly unknown[];
  /** Builds the challenge from the contract's own pure circuit. */
  readonly challenge: (
    pure: K1PureCircuits,
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
  session: K1DynamicSession,
  device: K256DeviceIdentity,
  request: K1CallRequest,
  onPhase?: (phase: K1Phase) => void,
  overrides: Partial<K1Deps> = {},
): Promise<K1StepResult> {
  const deps = withDefaults(overrides);
  const user = k1UserKey(session);
  const wallet = await deps.wallet(user);
  const network = wallet.network.networkId;
  const storage = deps.storage();
  const record = loadK1Record(storage, user, network);
  if (!record || record.address === null || nextK1Step(record) !== 'ready') {
    throw new Error('This Passport is not finished being set up yet.');
  }

  const module = await deps.contractModule();
  const circuit = `${request.operation}_with_k256`;
  const { callTx, providers } = await openK1Account(deps, wallet, record, circuit);
  const addressBytes = hexToBytes(record.address);

  const state = module.ledger(await queryStateData(providers, record.address));
  const context: K1CallContext = {
    contractAddress: addressBytes,
    authNonce: state.auth_nonce,
  };
  const useCounter = resolveK1UseCounter({
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
  const next: K1AccountRecord = {
    ...record,
    txHashes: txHash ? [...record.txHashes, txHash] : record.txHashes,
  };
  saveK1Record(storage, next);
  return { record: next, txHash, explorerUrl: txHash ? k1ExplorerLink(txHash, network) : null };
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
 * A PERMISSIONLESS call on a k1 account: the deposits, which anybody may make
 * and which carry no authorisation trailer. `k1Call` always appends
 * `_with_k256` and the four auth arguments, so paying INTO a k1 account —
 * this Passport's own opening balance arriving, or a send to somebody who
 * holds one of these Passports — goes through here with the plain circuit
 * name and the circuit's own arguments, nothing more.
 */
export async function k1PermissionlessCall(
  session: K1DynamicSession,
  request: { operation: string; args: readonly unknown[] },
  onPhase?: (phase: K1Phase) => void,
  overrides: Partial<K1Deps> = {},
): Promise<K1StepResult> {
  const deps = withDefaults(overrides);
  const user = k1UserKey(session);
  const wallet = await deps.wallet(user);
  const network = wallet.network.networkId;
  const storage = deps.storage();
  const record = loadK1Record(storage, user, network);
  if (!record || record.address === null || nextK1Step(record) !== 'ready') {
    throw new Error('This Passport is not finished being set up yet.');
  }
  const { callTx, providers } = await openK1Account(deps, wallet, record, request.operation);
  onPhase?.({ step: 'submit' });
  const call = callTx[request.operation];
  if (!call) throw new Error('This Passport cannot do that yet.');
  const result = await call(...request.args);
  onPhase?.({ step: 'confirm' });
  const txHash = await resolveHash(providers, result);
  const next: K1AccountRecord = {
    ...record,
    txHashes: txHash ? [...record.txHashes, txHash] : record.txHashes,
  };
  saveK1Record(storage, next);
  return { record: next, txHash, explorerUrl: txHash ? k1ExplorerLink(txHash, network) : null };
}

export async function appendInboxK1(
  session: K1DynamicSession,
  device: K256DeviceIdentity,
  entry: Uint8Array,
  onPhase?: (phase: K1Phase) => void,
  overrides: Partial<K1Deps> = {},
): Promise<K1StepResult> {
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
 * The private state the k1 build takes.
 *
 * ONE WITNESS, AND IT REFUSES. `held_coin` is the only witness this contract
 * declares, and the coin store that would answer it is PR 4. Nothing this
 * module calls invokes it — activation and `append_inbox` declare no witness —
 * so refusing is both correct today and the thing that will name itself the
 * moment a shielded spend is wired up.
 */
export function k1Witnesses(): Record<string, () => never> {
  return {
    held_coin(): never {
      throw new Error('Sending shielded value from this kind of Passport is not built yet.');
    },
  };
}

/** The private-state value. Empty: the coin store is PR 4. */
function k1PrivateState(): Record<string, unknown> {
  return { coins: {} };
}

/** Open the deployed contract for one circuit's proof route. */
async function openK1Account(
  deps: K1Deps,
  wallet: LocalMidnightWallet,
  record: K1AccountRecord,
  circuit: string,
): Promise<{ callTx: K1CallTx; providers: Record<string, unknown> }> {
  const providers = await deps.providers(wallet, record.privateStateId);
  /* The proof provider is per-CIRCUIT, because the service is told which key to
     use. Everything else in the set is shared. */
  const scoped = {
    ...providers,
    proofProvider: k1ProofProvider({
      endpoint: k1ProvingEndpoint(sponsorConfig()?.url ?? null),
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
    initialPrivateState: k1PrivateState(),
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
     wrapper decoded nothing; caught by the flow that first read a k1 balance
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
    console.info('[k1] the chain hash is not resolvable yet', messageOf(cause));
    return identifier;
  }
}

/* The maintenance signing key, for the waves that follow the deploy. Held for
   the life of the tab only: a durable private-state provider is PR 4, and a
   reload mid-deploy therefore cannot continue — which the milestone screen
   says rather than retrying into a rejection. */
const signingKeys = new Map<string, unknown>();

function rememberSigningKey(address: string, key: unknown): void {
  signingKeys.set(address, key);
}

async function signingKeyFor(
  providers: Record<string, unknown>,
  address: string,
): Promise<unknown> {
  const held = signingKeys.get(address);
  if (held !== undefined) return held;
  const priv = providers.privateStateProvider as {
    getSigningKey(address: string): Promise<unknown>;
  };
  const stored = await priv.getSigningKey(address);
  if (stored === null || stored === undefined) {
    throw new Error(
      'Setting up this Passport was interrupted. Start again to finish it.',
    );
  }
  return stored;
}

/** Reset the in-tab signing-key cache. For drills, and for a sign-out. */
export function resetK1SessionState(): void {
  signingKeys.clear();
}

/* -------------------------------------------------------------------------- */
/* The default seams                                                          */
/* -------------------------------------------------------------------------- */

function withDefaults(overrides: Partial<K1Deps>): K1Deps {
  return { ...defaultK1Deps(), ...overrides };
}

/**
 * The real dependencies, every one of them behind a function so that importing
 * this module costs nothing until a Dynamic Passport is actually asked for.
 */
export function defaultK1Deps(): K1Deps {
  return {
    storage: () => globalThis.localStorage,
    randomBytes: (length) => {
      const out = new Uint8Array(length);
      globalThis.crypto.getRandomValues(out);
      return out;
    },
    wallet: async (user) => {
      const seed = k1WalletSeed(defaultK1Deps(), user);
      return createLocalMidnightWallet(seed);
    },
    contractModule: async () =>
      (await loadContractModule(K1_CONTRACT)) as unknown as K1ContractModule,
    providers: async (wallet, privateStateId) => {
      const [providers, compiledContract, ledgerModule] = await Promise.all([
        createContractProviders(wallet, {
          contract: K1_CONTRACT,
          privateStateId,
          initialPrivateState: k1PrivateState(),
        }),
        compiledContractFor(K1_CONTRACT, K1_LABEL, k1Witnesses()),
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
        ...(ledgerModule as unknown as Omit<K1LedgerApi, 'networkId'>),
        networkId: () =>
          (networkIdModule as unknown as { getNetworkId(): string }).getNetworkId(),
      };
    },
    contracts: async () =>
      (await import('@midnight-ntwrk/midnight-js-contracts')) as unknown as K1ContractsApi,
    now: () => Date.now(),
    sleep: (milliseconds) =>
      new Promise((resolve) => {
        globalThis.setTimeout(resolve, milliseconds);
      }),
  };
}
