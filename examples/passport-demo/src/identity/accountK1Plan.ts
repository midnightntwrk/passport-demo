/**
 * The decisions the k1 custody layer makes, with nothing in it that touches
 * the network, the wallet, the DOM, or Dynamic.
 *
 * WHY THIS IS A SEPARATE FILE FROM `accountK1Custody.ts` (2026/09/16)
 * ------------------------------------------------------------------
 * `accountK1.ts` is the signing boundary — arms, envelopes, entries,
 * challenges, digests. `accountK1Custody.ts` is the orchestration — providers,
 * a wallet, three sponsored waves, a proof server on the other end of a
 * `fetch`. Between them sits a third thing that is neither: the wave plan, the
 * resumable progress record, the proving endpoint, the shape of the proof
 * server's request and reply, and the sentences a person reads when one of
 * those fails. Every one of those is a decision with a right answer and no
 * socket, and each is exactly the kind of thing that is wrong in production
 * because it was never drilled.
 *
 * So they live here, this module is in the coverage denominator at 100%, and
 * `accountK1Custody.ts` — which cannot be held to that bar, because half of it
 * IS the socket — imports them rather than restating them.
 *
 * WHAT IS PROVEN, AND WHERE
 * -------------------------
 * Every constant below was measured. The reference client deployed this exact
 * contract on stagenet on 2026/09/16 in three sponsored transactions, activated
 * a secp256k1 device, and made one gated call that the node verified —
 * `device_count 1`, `auth_nonce 0 -> 1`, all three SUCCESS. The wave sizes, the
 * verifier-byte budget, and the circuit roster here are that run's, not an
 * estimate of it.
 */

import { bytesToHex, type K1Arm } from './accountK1.js';

/* -------------------------------------------------------------------------- */
/* The circuit roster                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The two permissionless circuits. No device, no signature, no envelope —
 * which is what lets a gift desk pay INTO an account it has no key for, and
 * why both ride in the first wave regardless of which arm goes first.
 */
export const K1_SHARED_CIRCUITS: readonly string[] = ['deposit_unshielded', 'deposit_shielded'];

/** The gated operations that exist once per arm. */
const GATED_BASES: readonly string[] = [
  'withdraw_unshielded',
  'append_inbox',
  'withdraw_shielded',
  'withdraw_shielded_to_contract',
  'rotate_enc_key',
  'add_device',
  'remove_device',
];

/** The operations that also exist in a `_with_grant_<arm>` form. */
const GRANT_TWIN_BASES: readonly string[] = [
  'withdraw_unshielded',
  'withdraw_shielded',
  'withdraw_shielded_to_contract',
];

/** Grant lifecycle, once per arm. */
const LIFECYCLE_BASES: readonly string[] = ['issue_grant', 'revoke_grant', 'revoke_all_grants'];

/**
 * An arm's own eight circuits: its activation and its seven gated operations.
 *
 * ACTIVATION IS IN HERE, and that is the reason the arm a deploy leads with is
 * a choice rather than a detail. `activate_initial_device_with_<arm>` can only
 * open a boot commitment its own arm derived, so an account deployed leading
 * with jubjub cannot be activated by a k256 device and the other way round.
 */
export function k1ArmCircuits(arm: K1Arm): string[] {
  return ['activate_initial_device', ...GATED_BASES].map((base) => `${base}_with_${arm}`);
}

/** An arm's delegated-spend twins. */
export function k1GrantTwins(arm: K1Arm): string[] {
  return GRANT_TWIN_BASES.map((base) => `${base}_with_grant_${arm}`);
}

/** An arm's grant lifecycle circuits. */
export function k1LifecycleCircuits(arm: K1Arm): string[] {
  return LIFECYCLE_BASES.map((base) => `${base}_with_${arm}`);
}

/** The other arm. */
export function k1OtherArm(arm: K1Arm): K1Arm {
  return arm === 'k256' ? 'jubjub' : 'k256';
}

/**
 * All thirty circuits the compiled build exports, in the order the waves
 * consume them.
 */
export function allK1Circuits(firstArm: K1Arm = 'k256'): string[] {
  const second = k1OtherArm(firstArm);
  return [
    ...K1_SHARED_CIRCUITS,
    ...k1ArmCircuits(firstArm),
    ...k1ArmCircuits(second),
    ...k1GrantTwins(firstArm),
    ...k1LifecycleCircuits(firstArm),
    ...k1GrantTwins(second),
    ...k1LifecycleCircuits(second),
  ];
}

/* -------------------------------------------------------------------------- */
/* The wave plan                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The verifier bytes one maintenance update may carry.
 *
 * MEASURED, not chosen. The ceiling observed on devnet sits in
 * `(29,484, 32,229]` verifier bytes — above it the node refuses at submission
 * with `1010: Invalid Transaction: Transaction would exhaust the block limits`,
 * which is a rejection AFTER a sponsored fee has been booked. 25,000 leaves
 * room for the intent envelope and lands the thirty-circuit roster on three
 * waves, which is the shape stagenet accepted on 2026/09/16.
 */
export const K1_VERIFIER_BYTE_BUDGET = 25_000;

/** One sponsored transaction's worth of the deploy. */
export interface K1Wave {
  /** 1 for the deploy; 2 and up are maintenance updates. */
  readonly index: number;
  readonly circuits: readonly string[];
  /** Whether this wave also retires the maintenance authority. Only the last. */
  readonly retiresAuthority: boolean;
}

/**
 * Split the roster into waves.
 *
 * WAVE 1 IS FIXED, not packed: the deposits plus the whole of the leading arm.
 * That is not a size decision — it is what makes the account USABLE after one
 * transaction, because `activate_initial_device_with_<arm>` and every gated
 * operation of that arm are in it. Packing wave 1 by size could scatter the
 * activation circuit into wave 3 and leave a deployed account nobody can open.
 *
 * Everything after it is packed greedily under {@link K1_VERIFIER_BYTE_BUDGET},
 * and the LAST wave retires the authority — see {@link K1_AUTHORITY_WARNING}.
 */
export function planK1Waves(
  sizes: ReadonlyMap<string, number>,
  firstArm: K1Arm,
  retireAuthority = true,
): K1Wave[] {
  const second = k1OtherArm(firstArm);
  const waveOne = [...K1_SHARED_CIRCUITS, ...k1ArmCircuits(firstArm)];
  const remaining = [
    ...k1ArmCircuits(second),
    ...k1GrantTwins(firstArm),
    ...k1LifecycleCircuits(firstArm),
    ...k1GrantTwins(second),
    ...k1LifecycleCircuits(second),
  ];

  const waves: K1Wave[] = [{ index: 1, circuits: waveOne, retiresAuthority: false }];
  let batch: string[] = [];
  let used = 0;
  for (const circuit of remaining) {
    const size = sizes.get(circuit);
    if (size === undefined) throw new Error(`no verifier key size for '${circuit}'`);
    if (batch.length > 0 && used + size > K1_VERIFIER_BYTE_BUDGET) {
      waves.push({ index: waves.length + 1, circuits: batch, retiresAuthority: false });
      batch = [];
      used = 0;
    }
    batch.push(circuit);
    used += size;
  }
  if (batch.length > 0) {
    waves.push({ index: waves.length + 1, circuits: batch, retiresAuthority: false });
  }

  if (retireAuthority) {
    const last = waves[waves.length - 1];
    waves[waves.length - 1] = { ...last, retiresAuthority: true };
  }
  return waves;
}

/**
 * Why the authority is retired, written down where the code that retires it can
 * be read beside it.
 *
 * A `VerifierKeyInsert` REPLACES an operation's verifier key. Whoever holds the
 * maintenance signing key can therefore substitute their own relation for
 * `withdraw_shielded_with_k256` and release the account's assets with no device
 * signature and no `auth_nonce` advance. A live authority is full custody of
 * the account, so the last wave replaces it with an empty committee.
 */
export const K1_AUTHORITY_WARNING =
  'the maintenance authority can replace any verifier key, so it is retired by the last wave';

/* -------------------------------------------------------------------------- */
/* Where a k1 circuit gets proved                                             */
/* -------------------------------------------------------------------------- */

/**
 * The refusal when no proving endpoint is configured. ONE PLAIN SENTENCE, and
 * no vocabulary from the forbidden list — a person may read this.
 */
export const K1_PROVER_UNCONFIGURED =
  'Creating a Dynamic Passport is not switched on in this build yet.';

/** The refusal when the endpoint is configured but is not answering. */
export const K1_PROVER_UNAVAILABLE =
  'The service that finishes this step is not answering right now. Try again in a moment.';

/**
 * The path, on whichever origin serves it.
 *
 * WHY THE SPONSOR'S ORIGIN AND NOT `VITE_MIDNIGHT_PROVING_URL_V3`
 * ---------------------------------------------------------------
 * The v3 list points at a PROOF SERVER — `…/prover-v3` — and a proof server's
 * contract is `midnight-js`'s own: `httpClientProofProvider` uploads the prover
 * key with every request. The k1 build's keys are 3.2 GB (224 MB per k256
 * circuit). A browser cannot hold one, let alone upload one per call, so that
 * route cannot carry this traffic however healthy the server behind it is.
 *
 * What CAN carry it is a service that already holds the keys on disk and takes
 * a transaction instead: the balancer, which is where `/balance-only` already
 * lives and where the keys are being staged
 * (`/opt/passport-k1-artefacts/managed/account-k1`). So the endpoint hangs off
 * the sponsor's origin, and `VITE_MIDNIGHT_PROVING_URL_V3` stays what PR #58
 * made it — the switch that says a v3 route exists at all.
 */
export const K1_PROVE_PATH = '/prove-k1';

/**
 * The full proving URL, from the sponsor's base.
 *
 * Refuses rather than guessing. A build with no sponsor cannot pay for the
 * deploy either, so there is nothing for a fallback to do.
 */
export function k1ProvingEndpoint(sponsorBaseUrl: string | null | undefined): string {
  const base = typeof sponsorBaseUrl === 'string' ? sponsorBaseUrl.trim() : '';
  if (base.length === 0) throw new Error(K1_PROVER_UNCONFIGURED);
  return `${base.replace(/\/+$/, '')}${K1_PROVE_PATH}`;
}

/** The request body `POST /prove-k1` takes. */
export interface ProveK1Request {
  /** The circuit being proved, e.g. `append_inbox_with_k256`. */
  readonly circuit: string;
  /** Lower-case hex, no `0x`, of the serialised UNPROVEN transaction. */
  readonly unprovenTx: string;
  /** The network the transaction is for, e.g. `stagenet`. */
  readonly network: string;
}

/** The 200 body `POST /prove-k1` returns. */
export interface ProveK1Response {
  /** Lower-case hex, no `0x`, of the serialised PROVEN transaction. */
  readonly provenTx: string;
}

/** The 4xx/5xx body `POST /prove-k1` returns. */
export interface ProveK1Error {
  readonly error: string;
  readonly detail: string;
}

/** Build the request body. Hex, because JSON has no bytes. */
export function proveK1Request(
  circuit: string,
  unprovenTx: Uint8Array,
  network: string,
): ProveK1Request {
  return { circuit, unprovenTx: bytesToHex(unprovenTx), network };
}

/**
 * The proven transaction's bytes out of a 200 body.
 *
 * Validated rather than cast. A gateway that answers 200 with an HTML error
 * page — which every reverse proxy in this stack will do at least once — must
 * fail HERE, with a sentence naming the shape, and not four frames later inside
 * a WASM deserialiser saying nothing at all.
 */
export function parseProveK1Response(body: unknown): Uint8Array {
  const provenTx = (body as { provenTx?: unknown } | null)?.provenTx;
  if (typeof provenTx !== 'string' || !/^(0x)?[0-9a-fA-F]+$/.test(provenTx)) {
    throw new Error('the proving service answered without a proven transaction');
  }
  return hexToBytes(provenTx);
}

/**
 * What an operator reads in the console when the proving service refuses.
 *
 * The status and the service's own code and detail, because those are what
 * distinguishes "this circuit is not staged" from "this transaction is
 * malformed" from "the box is out of memory", and a person debugging a demo at
 * a conference has nothing else to go on.
 */
export function describeProveK1Failure(status: number, body: unknown): string {
  const error = (body as { error?: unknown } | null)?.error;
  const detail = (body as { detail?: unknown } | null)?.detail;
  const code = typeof error === 'string' && error.length > 0 ? error : 'unknown';
  const text = typeof detail === 'string' && detail.length > 0 ? ` — ${detail}` : '';
  return `[k1] the proving service refused with HTTP ${status} (${code})${text}`;
}

/* -------------------------------------------------------------------------- */
/* Hex                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Bytes from hex, with or without `0x`.
 *
 * `accountK1.ts` exports the other direction and deliberately not this one — it
 * never had to read hex. The two halves are here together because both the
 * proving request and its reply need the round trip.
 */
export function hexToBytes(value: string): Uint8Array {
  const hex = value.startsWith('0x') ? value.slice(2) : value;
  if (hex.length % 2 !== 0) throw new Error('hex must have an even number of digits');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error('hex contains a digit that is not hex');
    out[i] = byte;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* The resumable deploy record                                                */
/* -------------------------------------------------------------------------- */

/** Where a Dynamic Passport's setup has got to. */
export type K1DeployStep = 'deploy' | 'waves' | 'activate' | 'ready';

/**
 * Everything a reload needs to carry on, and nothing it does not.
 *
 * NO SECRET IS IN HERE. The device key lives inside Dynamic's MPC and the
 * account holds the value; what this record carries is an address, a salt, a
 * public point, and a count of finished waves. The maintenance signing key is
 * the one sensitive thing the deploy produces, and it stays where midnight-js
 * puts it — the private-state provider, keyed by address — rather than being
 * copied here.
 */
export interface K1AccountRecord {
  /** Lower-case Dynamic EVM address: one embedded key per Dynamic user. */
  readonly user: string;
  readonly network: string;
  /** The deployed address, once wave 1 has landed. */
  readonly address: string | null;
  /** The private-state id the waves and every later call read. */
  readonly privateStateId: string;
  /** Hex of the 32-byte boot salt — the opening of the boot commitment. */
  readonly saltHex: string;
  /** The device point, recovered once at enrolment and cached by address. */
  readonly pkXHex: string | null;
  readonly pkYHex: string | null;
  /** How many waves have landed. 0 before the deploy, 3 when the roster is in. */
  readonly wavesDone: number;
  readonly totalWaves: number;
  /** Whether `activate_initial_device_with_k256` has landed. */
  readonly activated: boolean;
  /** Chain hashes, newest last, for the milestone screen to link. */
  readonly txHashes: readonly string[];
}

/** The step a record is waiting on. */
export function nextK1Step(record: K1AccountRecord): K1DeployStep {
  if (record.address === null) return 'deploy';
  if (record.wavesDone < record.totalWaves) return 'waves';
  if (!record.activated) return 'activate';
  return 'ready';
}

/** Whether the account can take a gated call. */
export function k1AccountIsUsable(record: K1AccountRecord): boolean {
  return nextK1Step(record) === 'ready';
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

/**
 * `passport-k1-account:v1`, a map of records — the same shape and the same
 * versioned-key convention as `passportContractStore.ts`'s
 * `passport-contract:v1`, so an operator clearing one knows where the other is.
 */
export const K1_STORAGE_KEY = 'passport-k1-account:v1';

/** The map key. One Dynamic user has one account per network. */
export function k1RecordKey(user: string, network: string): string {
  return `${user.toLowerCase()}|${network}`;
}

/** The slice of `Storage` this module uses. A fake in a test is three methods. */
export interface K1Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Every record, or an empty map.
 *
 * A storage that throws (private browsing, a browser set to block site data) or
 * holds something that is not the map reads as EMPTY rather than as an error.
 * The cost of that is one extra deploy; the cost of the alternative is a
 * Passport that will not open because a quota was exceeded once.
 */
export function loadK1Records(storage: K1Storage): Record<string, K1AccountRecord> {
  let raw: string | null = null;
  try {
    raw = storage.getItem(K1_STORAGE_KEY);
  } catch {
    return {};
  }
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, K1AccountRecord>;
  } catch {
    return {};
  }
}

/** One record, or null. */
export function loadK1Record(
  storage: K1Storage,
  user: string,
  network: string,
): K1AccountRecord | null {
  return loadK1Records(storage)[k1RecordKey(user, network)] ?? null;
}

/**
 * Write a record, merged into whatever else is stored.
 *
 * Swallows a storage failure for the same reason the read does, and says so in
 * the console rather than on screen: a person cannot act on "your browser
 * refused to remember this", and the flow still works — it just cannot resume.
 */
export function saveK1Record(storage: K1Storage, record: K1AccountRecord): void {
  const records = loadK1Records(storage);
  records[k1RecordKey(record.user, record.network)] = record;
  try {
    storage.setItem(K1_STORAGE_KEY, JSON.stringify(records));
  } catch (cause) {
    console.warn('[k1] could not remember the setup progress; a reload will start again', cause);
  }
}

/** A fresh record for a user who has never had one. */
export function newK1Record(options: {
  user: string;
  network: string;
  privateStateId: string;
  saltHex: string;
  totalWaves: number;
}): K1AccountRecord {
  return {
    user: options.user.toLowerCase(),
    network: options.network,
    address: null,
    privateStateId: options.privateStateId,
    saltHex: options.saltHex,
    pkXHex: null,
    pkYHex: null,
    wavesDone: 0,
    totalWaves: options.totalWaves,
    activated: false,
    txHashes: [],
  };
}

/* -------------------------------------------------------------------------- */
/* The use counter                                                            */
/* -------------------------------------------------------------------------- */

/** How far the rescan probes before giving up. */
export const K1_RESCAN_LIMIT = 4096n;

/** What a device entry lookup needs: derive a candidate, ask the ledger. */
export interface K1CounterProbe {
  entryAt(counter: bigint): Uint8Array;
  isMember(entry: Uint8Array): boolean;
}

/**
 * The device's current position in its rolling entry series.
 *
 * THE LEDGER DOES NOT STORE THE COUNTER. It stores a set of opaque 32-byte
 * entries, and the counter is recovered by re-deriving the candidate entry and
 * testing membership. That is what makes the roster self-healing: a client that
 * has lost its cache, or whose cache is behind because another device spent,
 * finds the truth by scanning rather than by being told.
 *
 * The scan starts at the cached value when there is one, because a cache that
 * is behind is behind by one or two, not by four thousand — and starting at 0
 * every time would make every call after the first one slower than the last.
 */
export function resolveK1UseCounter(probe: K1CounterProbe, known?: bigint): bigint {
  const start = known ?? 0n;
  if (known !== undefined && probe.isMember(probe.entryAt(known))) return known;
  for (let counter = start; counter < start + K1_RESCAN_LIMIT; counter++) {
    if (probe.isMember(probe.entryAt(counter))) return counter;
  }
  throw new Error(
    'This key is not one of the keys that can approve for this Passport yet.',
  );
}

/* -------------------------------------------------------------------------- */
/* The milestone screen's switch, and its links                               */
/* -------------------------------------------------------------------------- */

/**
 * Whether the developer milestone screen is reachable.
 *
 * OFF BY DEFAULT and off in every build shipped today. Two ways to turn it on,
 * because they answer different needs: `VITE_K1_MILESTONE=1` is a build that is
 * for this and nothing else, and `?k1=1` is a person on a build that is not,
 * who needs to show somebody the flow without a redeploy.
 */
export function k1MilestoneEnabled(
  search: string,
  env: Record<string, unknown> = {},
): boolean {
  if (env.VITE_K1_MILESTONE === '1') return true;
  return new URLSearchParams(search).get('k1') === '1';
}

/** The explorer link for a chain hash. */
export function k1ExplorerLink(hash: string, network = 'stagenet'): string {
  return `https://explorer.1am.xyz/tx/${hash.replace(/^0x/, '')}?network=${network}`;
}
