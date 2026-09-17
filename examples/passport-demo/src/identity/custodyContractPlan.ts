/**
 * The decisions the account custody layer makes, with nothing in it that touches
 * the network, the wallet, the DOM, or Dynamic.
 *
 * WHY THIS IS A SEPARATE FILE FROM `custodyContractClient.ts` (2026/09/16)
 * ------------------------------------------------------------------
 * `custodyContractSigning.ts` is the signing boundary — arms, envelopes, entries,
 * challenges, digests. `custodyContractClient.ts` is the orchestration — providers,
 * a wallet, three sponsored waves, a proof server on the other end of a
 * `fetch`. Between them sits a third thing that is neither: the wave plan, the
 * resumable progress record, the proving endpoint, the shape of the proof
 * server's request and reply, and the sentences a person reads when one of
 * those fails. Every one of those is a decision with a right answer and no
 * socket, and each is exactly the kind of thing that is wrong in production
 * because it was never drilled.
 *
 * So they live here, this module is in the coverage denominator at 100%, and
 * `custodyContractClient.ts` — which cannot be held to that bar, because half of it
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

import { bytesToHex, type K1Arm } from './custodyContractSigning.js';

/* -------------------------------------------------------------------------- */
/* The circuit roster                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The two permissionless circuits. No device, no signature, no envelope —
 * which is what lets a gift desk pay INTO an account it has no key for, and
 * why both ride in the first wave regardless of which arm goes first.
 */
export const CUSTODY_SHARED_CIRCUITS: readonly string[] = ['deposit_unshielded', 'deposit_shielded'];

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
export function custodyGrantTwins(arm: K1Arm): string[] {
  return GRANT_TWIN_BASES.map((base) => `${base}_with_grant_${arm}`);
}

/** An arm's grant lifecycle circuits. */
export function custodyLifecycleCircuits(arm: K1Arm): string[] {
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
export function allCustodyCircuits(firstArm: K1Arm = 'k256'): string[] {
  const second = k1OtherArm(firstArm);
  return [
    ...CUSTODY_SHARED_CIRCUITS,
    ...k1ArmCircuits(firstArm),
    ...k1ArmCircuits(second),
    ...custodyGrantTwins(firstArm),
    ...custodyLifecycleCircuits(firstArm),
    ...custodyGrantTwins(second),
    ...custodyLifecycleCircuits(second),
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
export const CUSTODY_VERIFIER_BYTE_BUDGET = 25_000;

/** One sponsored transaction's worth of the deploy. */
export interface CustodyWave {
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
 * Everything after it is packed greedily under {@link CUSTODY_VERIFIER_BYTE_BUDGET},
 * and the LAST wave retires the authority — see {@link CUSTODY_AUTHORITY_WARNING}.
 */
export function planCustodyWaves(
  sizes: ReadonlyMap<string, number>,
  firstArm: K1Arm,
  retireAuthority = true,
): CustodyWave[] {
  const second = k1OtherArm(firstArm);
  const waveOne = [...CUSTODY_SHARED_CIRCUITS, ...k1ArmCircuits(firstArm)];
  const remaining = [
    ...k1ArmCircuits(second),
    ...custodyGrantTwins(firstArm),
    ...custodyLifecycleCircuits(firstArm),
    ...custodyGrantTwins(second),
    ...custodyLifecycleCircuits(second),
  ];

  const waves: CustodyWave[] = [{ index: 1, circuits: waveOne, retiresAuthority: false }];
  let batch: string[] = [];
  let used = 0;
  for (const circuit of remaining) {
    const size = sizes.get(circuit);
    if (size === undefined) throw new Error(`no verifier key size for '${circuit}'`);
    /* A KEY LARGER THAN THE WHOLE BUDGET IS A PLAN THAT CANNOT LAND, and the
       reference refuses it here rather than packing it into a wave of its own.
       That is the right place to stop: a single-key wave over the budget is
       refused by the NODE, at submission, after a sponsored fee has been
       booked for it, and the rejection (`1010: Invalid Transaction`) names
       neither the circuit nor the size. Refusing while the plan is still a
       plan costs nothing and says which key. */
    if (size > CUSTODY_VERIFIER_BYTE_BUDGET) {
      throw new Error(`verifier key for '${circuit}' (${size} bytes) exceeds the per-update budget`);
    }
    if (batch.length > 0 && used + size > CUSTODY_VERIFIER_BYTE_BUDGET) {
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
export const CUSTODY_AUTHORITY_WARNING =
  'the maintenance authority can replace any verifier key, so it is retired by the last wave';

/**
 * Whether the chain already carries everything a wave would insert.
 *
 * THIS IS THE RESUME RULE, AND IT IS A QUESTION ABOUT THE CHAIN. A progress
 * record says where we THINK the deploy got to, and it is wrong in both
 * directions: a tab closed between the submission and the write leaves a wave
 * that landed unrecorded, and a submission that was dropped leaves a wave
 * recorded that never landed. Replaying a landed wave costs a sponsored fee for
 * a rejection; skipping a dropped one leaves an account missing ten circuits
 * that nothing later will ever add, because the authority is retired.
 *
 * The operations a contract carries are readable off its state, so the record
 * is demoted to a hint and this is what decides.
 */
export function custodyWaveIsOnChain(wave: CustodyWave, present: ReadonlySet<string>): boolean {
  return wave.circuits.every((circuit) => present.has(circuit));
}

/* -------------------------------------------------------------------------- */
/* Where a account custody circuit gets proved                                             */
/* -------------------------------------------------------------------------- */

/**
 * The refusal when no proving endpoint is configured. ONE PLAIN SENTENCE, and
 * no vocabulary from the forbidden list — a person may read this.
 */
export const CUSTODY_PROVER_UNCONFIGURED =
  'Creating a Dynamic Passport is not switched on in this build yet.';

/** The refusal when the endpoint is configured but is not answering. */
export const CUSTODY_PROVER_UNAVAILABLE =
  'The service that finishes this step is not answering right now. Try again in a moment.';

/**
 * How long a single `POST /prove-account-custody` is given before the browser abandons it.
 *
 * ABOVE THE SERVICE'S OWN DEADLINE, DELIBERATELY. The proving service holds a
 * 180-second deadline of its own and answers with a status when it passes; a
 * client that gave up first would turn every slow proof into "not answering"
 * and lose the service's own reason for it. Four minutes leaves the service a
 * full minute past its deadline to say so.
 *
 * It exists at all because `fetch` has no timeout. A TCP connection to a box
 * that has stopped answering but not closed the socket hangs until the
 * operating system gives up, which on a phone is minutes with nothing on
 * screen — and this module's whole claim is that it does not hang.
 */
export const CUSTODY_PROOF_TIMEOUT_MS = 240_000;

/**
 * The path, on whichever origin serves it.
 *
 * WHY THE SPONSOR'S ORIGIN AND NOT `VITE_MIDNIGHT_PROVING_URL_V3`
 * ---------------------------------------------------------------
 * The v3 list points at a PROOF SERVER — `…/prover-v3` — and a proof server's
 * contract is `midnight-js`'s own: `httpClientProofProvider` uploads the prover
 * key with every request. The account custody build's keys are 3.2 GB (224 MB per k256
 * circuit). A browser cannot hold one, let alone upload one per call, so that
 * route cannot carry this traffic however healthy the server behind it is.
 *
 * What CAN carry it is a service that already holds the keys on disk and takes
 * a transaction instead: the balancer, which is where `/balance-only` already
 * lives and where the keys are being staged
 * (`/opt/passport-account-custody-artefacts/managed/account-custody`). So the endpoint hangs off
 * the sponsor's origin, and `VITE_MIDNIGHT_PROVING_URL_V3` stays what PR #58
 * made it — the switch that says a v3 route exists at all.
 */
export const CUSTODY_PROVE_PATH = '/prove-account-custody';

/**
 * The full proving URL, from the sponsor's base.
 *
 * Refuses rather than guessing. A build with no sponsor cannot pay for the
 * deploy either, so there is nothing for a fallback to do.
 */
export function custodyProvingEndpoint(sponsorBaseUrl: string | null | undefined): string {
  const base = typeof sponsorBaseUrl === 'string' ? sponsorBaseUrl.trim() : '';
  if (base.length === 0) throw new Error(CUSTODY_PROVER_UNCONFIGURED);
  return `${base.replace(/\/+$/, '')}${CUSTODY_PROVE_PATH}`;
}

/** The request body `POST /prove-account-custody` takes. */
export interface ProveCustodyRequest {
  /** The circuit being proved, e.g. `append_inbox_with_k256`. */
  readonly circuit: string;
  /** Lower-case hex, no `0x`, of the serialised UNPROVEN transaction. */
  readonly unprovenTx: string;
  /** The network the transaction is for, e.g. `stagenet`. */
  readonly network: string;
}

/** The 200 body `POST /prove-account-custody` returns. */
export interface ProveCustodyResponse {
  /** Lower-case hex, no `0x`, of the serialised PROVEN transaction. */
  readonly provenTx: string;
}

/** The 4xx/5xx body `POST /prove-account-custody` returns. */
export interface ProveCustodyError {
  readonly error: string;
  readonly detail: string;
}

/** Build the request body. Hex, because JSON has no bytes. */
export function proveAccountCustodyRequest(
  circuit: string,
  unprovenTx: Uint8Array,
  network: string,
): ProveCustodyRequest {
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
export function parseProveCustodyResponse(body: unknown): Uint8Array {
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
export function describeProveAccountCustodyFailure(status: number, body: unknown): string {
  const error = (body as { error?: unknown } | null)?.error;
  const detail = (body as { detail?: unknown } | null)?.detail;
  const code = typeof error === 'string' && error.length > 0 ? error : 'unknown';
  const text = typeof detail === 'string' && detail.length > 0 ? ` — ${detail}` : '';
  return `[account-custody] the proving service refused with HTTP ${status} (${code})${text}`;
}

/* -------------------------------------------------------------------------- */
/* Hex                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Bytes from hex, with or without `0x`.
 *
 * `custodyContractSigning.ts` exports the other direction and deliberately not this one — it
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

/**
 * Where a Dynamic Passport's setup has got to.
 *
 * `interrupted` is TERMINAL and it is not a stage of the sequence. It means the
 * maintenance key that finishes the remaining waves is gone, so the account on
 * chain can never be completed and nothing is served by offering the next step
 * again. The only move from here is to start again, which is why it is a step
 * of its own rather than a flag the screens are free to ignore.
 */
export type CustodyDeployStep = 'interrupted' | 'deploy' | 'waves' | 'activate' | 'ready';

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
export interface CustodyAccountRecord {
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
  /**
   * Set when the maintenance key for {@link CustodyAccountRecord.address} is gone
   * and the remaining waves can therefore never be signed. Optional so records
   * written before this field existed still parse.
   */
  readonly interrupted?: boolean;
}

/** The step a record is waiting on. */
export function nextCustodyStep(record: CustodyAccountRecord): CustodyDeployStep {
  if (record.interrupted === true) return 'interrupted';
  if (record.address === null) return 'deploy';
  if (record.wavesDone < record.totalWaves) return 'waves';
  if (!record.activated) return 'activate';
  return 'ready';
}

/** Whether the account can take a gated call. */
export function custodyAccountIsUsable(record: CustodyAccountRecord): boolean {
  return nextCustodyStep(record) === 'ready';
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

/**
 * `passport-account-custody:v1`, a map of records — the same shape and the same
 * versioned-key convention as `passportContractStore.ts`'s
 * `passport-contract:v1`, so an operator clearing one knows where the other is.
 */
export const CUSTODY_STORAGE_KEY = 'passport-account-custody:v1';

/** The map key. One Dynamic user has one account per network. */
export function custodyRecordKey(user: string, network: string): string {
  return `${user.toLowerCase()}|${network}`;
}

/** The slice of `Storage` this module uses. A fake in a test is three methods. */
export interface CustodyStorage {
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
export function loadCustodyRecords(storage: CustodyStorage): Record<string, CustodyAccountRecord> {
  return readCustodyMap(storage, CUSTODY_STORAGE_KEY) as Record<string, CustodyAccountRecord>;
}

/** One stored JSON map, or an empty one. Shared by both stores below. */
function readCustodyMap(storage: CustodyStorage, key: string): Record<string, unknown> {
  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return {};
  }
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Write one stored JSON map, saying so in the console if the browser refuses. */
function writeCustodyMap(storage: CustodyStorage, key: string, map: Record<string, unknown>): void {
  try {
    storage.setItem(key, JSON.stringify(map));
  } catch (cause) {
    console.warn('[account-custody] could not remember the setup progress; a reload will start again', cause);
  }
}

/** One record, or null. */
export function loadCustodyRecord(
  storage: CustodyStorage,
  user: string,
  network: string,
): CustodyAccountRecord | null {
  return loadCustodyRecords(storage)[custodyRecordKey(user, network)] ?? null;
}

/**
 * Write a record, merged into whatever else is stored.
 *
 * Swallows a storage failure for the same reason the read does, and says so in
 * the console rather than on screen: a person cannot act on "your browser
 * refused to remember this", and the flow still works — it just cannot resume.
 */
export function saveCustodyRecord(storage: CustodyStorage, record: CustodyAccountRecord): void {
  const records = loadCustodyRecords(storage);
  records[custodyRecordKey(record.user, record.network)] = record;
  writeCustodyMap(storage, CUSTODY_STORAGE_KEY, records);
}

/**
 * Throw a record away, so the next attempt deploys a fresh account.
 *
 * The only caller is "start again" after an interrupted setup. It does NOT
 * touch the chain: the half-built account stays where it is, dormant, holding
 * nothing, with a retired-or-unusable authority. Abandoning it is the whole
 * point — it can never be finished, and the alternative offered to the person
 * in front of the screen is a button that will fail every time they press it.
 */
export function removeCustodyRecord(storage: CustodyStorage, user: string, network: string): void {
  const records = loadCustodyRecords(storage);
  delete records[custodyRecordKey(user, network)];
  writeCustodyMap(storage, CUSTODY_STORAGE_KEY, records);
}

/* -------------------------------------------------------------------------- */
/* The maintenance signing key                                                */
/* -------------------------------------------------------------------------- */

/**
 * `passport-account-custody-authority:v1`, the maintenance signing key each deploy mints,
 * keyed by contract address.
 *
 * IT IS IN `localStorage` AND IT IS NOT ENCRYPTED AT REST. That is a decision
 * with a cost, and here is the cost and why it is paid. A deploy mints a
 * maintenance authority; waves 2 and 3 are signed with it; and while it lives,
 * whoever holds it can replace any verifier key on the account, which is full
 * custody. Holding it only in a module variable — which is what this did — made
 * a RELOAD between wave 1 and wave 3 terminal: the account exists, the
 * authority on it is live, the key that drives it is gone, and the screen
 * cheerfully offers the step again for ever.
 *
 * A Passport that cannot be finished is worse than a key in `localStorage` for
 * a demo, so the key is persisted, and the exposure is bounded three ways: it
 * is per contract address and belongs to an account holding nothing until it is
 * activated; the last wave RETIRES the authority, after which the key
 * authorises nothing at all; and {@link forgetCustodyAuthorityKey} deletes it the
 * moment that retirement lands, so a finished Passport leaves nothing behind.
 * A production Passport would keep it in a private-state provider backed by
 * IndexedDB and wrapped by a key the device holds; this is a demo and says so.
 */
export const CUSTODY_AUTHORITY_STORAGE_KEY = 'passport-account-custody-authority:v1';

/**
 * The stored key for an address, or null.
 *
 * `unknown` rather than a type: the ledger calls it `{ tag, value }` today and
 * this module has no business knowing that. What it must know is that whatever
 * comes back survived `JSON.stringify`, so a string or an object is returned
 * and anything else reads as absent.
 */
export function loadCustodyAuthorityKey(storage: CustodyStorage, address: string): unknown {
  const held = readCustodyMap(storage, CUSTODY_AUTHORITY_STORAGE_KEY)[address.toLowerCase()];
  if (typeof held === 'string') return held;
  if (held !== null && typeof held === 'object') return held;
  return null;
}

/** Remember the key for an address. */
export function saveCustodyAuthorityKey(storage: CustodyStorage, address: string, key: unknown): void {
  const keys = readCustodyMap(storage, CUSTODY_AUTHORITY_STORAGE_KEY);
  keys[address.toLowerCase()] = key;
  writeCustodyMap(storage, CUSTODY_AUTHORITY_STORAGE_KEY, keys);
}

/** Delete the key for an address: the retirement landed, or the record is gone. */
export function forgetCustodyAuthorityKey(storage: CustodyStorage, address: string): void {
  const keys = readCustodyMap(storage, CUSTODY_AUTHORITY_STORAGE_KEY);
  delete keys[address.toLowerCase()];
  writeCustodyMap(storage, CUSTODY_AUTHORITY_STORAGE_KEY, keys);
}

/** A fresh record for a user who has never had one. */
export function newCustodyRecord(options: {
  user: string;
  network: string;
  privateStateId: string;
  saltHex: string;
  totalWaves: number;
}): CustodyAccountRecord {
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
export const CUSTODY_RESCAN_LIMIT = 4096n;

/** What a device entry lookup needs: derive a candidate, ask the ledger. */
export interface CustodyCounterProbe {
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
export function resolveCustodyUseCounter(probe: CustodyCounterProbe, known?: bigint): bigint {
  const start = known ?? 0n;
  if (known !== undefined && probe.isMember(probe.entryAt(known))) return known;
  for (let counter = start; counter < start + CUSTODY_RESCAN_LIMIT; counter++) {
    if (probe.isMember(probe.entryAt(counter))) return counter;
  }
  throw new Error(
    'This key is not one of the keys that can approve for this Passport yet.',
  );
}

/* -------------------------------------------------------------------------- */
/* Enrolling a signed-in key                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The refusal when the point recovered from a sign-in cannot be shown to be
 * that sign-in's own key. One plain sentence, no vocabulary from the list.
 */
export const K1_ENROLMENT_UNCONFIRMED =
  'We could not confirm this sign-in can approve for a Passport. Try again.';

/** The sentence a half-built Passport shows when its setup cannot be finished. */
export const CUSTODY_SETUP_INTERRUPTED =
  'Setting up this Passport was interrupted. Start again to finish it.';

/**
 * The two distinct messages enrolment asks a signed-in key to sign.
 *
 * TWO, BECAUSE ONE PROVES NOTHING. Recovery is arithmetic on `(digest, r, s,
 * v)` and it always succeeds: every `v` yields SOME point, and the wrong one
 * yields the wrong point without complaint. A high-S signature paired with a
 * recovery byte that was not flipped to match it — a shape real EVM signers
 * emit — therefore enrols a point the signer cannot sign for, and the failure
 * arrives much later as a contract call that verifies against nothing.
 *
 * So the key is asked for a signature over a SECOND, different message, the
 * point is recovered from that one too, and the two must be the same point. A
 * wrong recovery byte, a tampered scalar, or a signer answering for a different
 * key all make the second recovery land somewhere else.
 *
 * WHAT DYNAMIC ACTUALLY EMITS IS NOT YET OBSERVED LIVE. Whether
 * `signRawMessage` returns low-S or high-S, and whether its `v` is 0/1 or
 * 27/28, has not been measured against the live vendor — only against the
 * in-suite stand-in. `parseEvmSignature` accepts all four `v` dialects and
 * normalises them, the contract accepts both S forms, and this check is what
 * makes the question safe to leave open.
 */
export function k1EnrolmentChallenges(message: string): [string, string] {
  return [message, `${message}:confirm`];
}

/* -------------------------------------------------------------------------- */
/* What a screen is allowed to paint                                          */
/* -------------------------------------------------------------------------- */

/** The one sentence a screen shows for a failure nobody wrote a sentence for. */
export const CUSTODY_UNEXPECTED = 'Something went wrong. Try that again.';

/**
 * The words this demo never puts on a screen, including a developer-shaped one.
 *
 * `wallet address` and `sdk` are on the list because the vocabulary audit added
 * them and the e2e walk asserts them; they are checked here as well because an
 * error thrown from four layers down is the one path that reaches a screen
 * without anybody having written the words.
 */
const CUSTODY_FORBIDDEN_WORDS: readonly string[] = [
  'contract',
  'registry',
  'indexer',
  'resolver',
  'sponsor',
  'dust',
  'wallet address',
  'sdk',
  'zswap',
  'utxo',
];

/**
 * The sentence a screen paints for a failure.
 *
 * A CAUSE IS NOT COPY. Every refusal this layer throws on purpose is one plain
 * sentence written for the person reading it, and painting `cause.message`
 * verbatim works right up until the cause comes from a vendor, a WASM
 * deserialiser, or a node — at which point the screen shows a stack-shaped
 * string full of exactly the words the demo has spent months keeping off it.
 * So a message is painted only if it still reads like something we wrote: short,
 * and free of the vocabulary. Everything else becomes {@link CUSTODY_UNEXPECTED},
 * and the real cause goes to the console, where it is of use to somebody.
 */
export function custodyFailureSentence(cause: unknown): string {
  const message = cause instanceof Error ? cause.message.trim() : '';
  if (message.length === 0 || message.length > 160) return CUSTODY_UNEXPECTED;
  const lower = message.toLowerCase();
  if (CUSTODY_FORBIDDEN_WORDS.some((word) => lower.includes(word))) return CUSTODY_UNEXPECTED;
  return message;
}

/** Whether two recovered points are the same point. */
export function k1SamePoint(
  a: { readonly x: bigint; readonly y: bigint },
  b: { readonly x: bigint; readonly y: bigint },
): boolean {
  return a.x === b.x && a.y === b.y;
}

/* -------------------------------------------------------------------------- */
/* The milestone screen's switch, and its links                               */
/* -------------------------------------------------------------------------- */

/**
 * Whether the developer milestone screen is reachable.
 *
 * OFF BY DEFAULT and off in every build shipped today. Two ways to turn it on,
 * because they answer different needs: `VITE_ACCOUNT_CUSTODY_MILESTONE=1` is a build that is
 * for this and nothing else, and `?custody=1` is a person on a build that is not,
 * who needs to show somebody the flow without a redeploy.
 */
export function accountCustodyMilestoneEnabled(
  search: string,
  env: Record<string, unknown> = {},
): boolean {
  if (env.VITE_ACCOUNT_CUSTODY_MILESTONE === '1') return true;
  return new URLSearchParams(search).get('custody') === '1';
}

/** The explorer link for a chain hash. */
export function custodyExplorerLink(hash: string, network = 'stagenet'): string {
  return `https://explorer.1am.xyz/tx/${hash.replace(/^0x/, '')}?network=${network}`;
}
