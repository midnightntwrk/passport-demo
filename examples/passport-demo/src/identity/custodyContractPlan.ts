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
 *
 * NOT RAISED TO 27,000 (2026/09/22), and the reason is the evidence rather
 * than caution. Raising it would pack a passkey's remaining twenty circuits
 * into two waves instead of three, and was proposed on the strength of
 * "29,484 bytes accepted on stagenet". That figure is the DEVNET one above.
 * The largest maintenance update stagenet has taken is 24,811 bytes in and
 * 27,998 balanced (the sponsor's journal, 2026/09/22 22:43:53), while two
 * transactions balanced to ~31,500 bytes that same evening were never included
 * ("not on chain 121 s after balancing"); a 27,000-verifier-byte wave balances
 * to about 31,800. Until a drill lands one on stagenet this stays where the
 * chain has shown it works — and since the waves after the first now run after
 * Home ({@link custodyWavesPending}), the third wave costs nobody a second.
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
 * The refusal when the proving service RAN and could not produce a proof.
 *
 * A DIFFERENT THING FROM NOT ANSWERING, and the difference is what makes a
 * spend work. An incorrect `mt_index` on the coin the witness names is an
 * unsatisfiable constraint system, and the only way that shows itself is the
 * prover declining to prove — so this refusal is exactly the shape a wrong
 * candidate position arrives in. Collapsing it into "not answering" told the
 * retry in `withdrawShieldedK1` that the position was fine and the network was
 * not, and the second candidate was never tried: seen live on 2026/09/18,
 * where the proof server answered 400 and the payment stopped with a sentence
 * about a service that was in fact up.
 *
 * WHAT THE SPONSOR PROMISES BY IT, SINCE 2026/09/18. `proving-failed` is
 * reserved for the proof server's own 4xx — a verdict on the transaction — and
 * a proof server that is unreachable, broken, or busy answers `503
 * prover-unavailable` instead (`../../../passport-balancer/src/
 * proveAccountCustody.ts`, `isCustodyProverVerdict`). Without that split a
 * proof service restarted in the middle of a spend armed the retry, which cost
 * the holder a second approval to learn nothing about either position.
 *
 * THE SIGNAL IS THE ERROR'S NAME, NOT ITS WORDS. The retry used to be armed by
 * matching the message, which would put "unsatisfiable constraint" in front of
 * somebody who chose Google — so the sentence here is the one they should read,
 * and {@link CUSTODY_PROOF_NOT_BUILT_NAME} is what the retry looks at.
 */
export const CUSTODY_PROOF_NOT_BUILT =
  'That payment could not be completed just now. Try again in a moment.';

/**
 * The refusal when the chain ANSWERED and the answer was no.
 *
 * A transaction the chain recorded as failed moved nothing: no coin was spent,
 * no note was created, and the account holds exactly what it held before
 * (MIP-0012 INV-5). So this is the one failure after submission that can be
 * said plainly, and saying it plainly matters — the hedged sentence below in
 * front of a verdict this definite would tell somebody to go and check a
 * balance that cannot have changed.
 */
export const CUSTODY_SEND_FAILED = 'That payment did not go through, and nothing left your Passport.';

/**
 * The sentence for a payment that WAS submitted and whose outcome is unknown.
 *
 * TWO WAYS TO ARRIVE HERE, and they are the same thing to the person reading
 * it: the finalised data carried no verdict this build could read, or the wait
 * for one failed — a dropped socket during the wait is the shape of the
 * outages of 2026/09/05 and 2026/09/07, and a socket is not a verdict. Either
 * way the transaction is out there and one of two things is true of it, so the
 * sentence hedges deliberately and points at the figure that settles it rather
 * than guessing. Claiming "nothing was sent" here is the one answer that can be
 * flatly wrong about somebody's money.
 */
export const CUSTODY_SEND_UNCONFIRMED =
  'Your payment was sent and this Passport could not confirm it. Check your balance in a moment to see whether it left.';

/**
 * The payment was handed to the network and never reached the chain.
 *
 * Seen live 2026/09/22: a proved, balanced transaction the node took and the
 * chain never recorded, and a Send sheet that waited on it for ever. The wait
 * is now bounded ({@link CUSTODY_SUBMIT_WAIT_MS}); when it runs out the
 * account itself is asked, and an account whose `auth_nonce` has not moved has
 * not run the call — every gated call advances it — so nothing left it. The
 * same signature can never be replayed once anything else moves the nonce.
 */
export const CUSTODY_SEND_NOT_SENT = "That payment didn't go through. Nothing left your Passport.";

/** How long a submitted payment is waited on before the account is asked. */
export const CUSTODY_SUBMIT_WAIT_MS = 3 * 60 * 1000;

/**
 * What a payment whose wait ran out is, from the account's own `auth_nonce`.
 *
 * `not-sent` only when the account was READ and its nonce is still the one
 * the payment was signed against: the gated call advances it, so an unmoved
 * nonce is an account that has not run the call. Anything else — a nonce that
 * moved, or a read that failed — is `unknown`, and the hedged sentence stays.
 */
export function custodySubmitVerdict(input: {
  readonly signedNonce: bigint;
  readonly liveNonce: bigint | null;
  /**
   * What the indexer says of the transaction itself, when it was asked
   * (2026/09/22): it ran, the chain refused it, it has no such transaction,
   * or it could not be asked (null).
   */
  readonly onChain?: CustodyTxOutcome | null;
}): 'landed' | 'refused' | 'not-sent' | 'unknown' {
  /* THE CHAIN'S OWN ANSWER FIRST. A transaction the indexer holds is not a
     question for the nonce at all. */
  if (input.onChain === 'success') return 'landed';
  if (input.onChain === 'failure') return 'refused';
  /* An account whose nonce has not moved has not run the call. */
  if (input.liveNonce !== null && input.liveNonce === input.signedNonce) return 'not-sent';
  /* THE SIGNATURE IS BOUND TO THE NONCE IT WAS MADE AGAINST. A nonce that has
     moved while the indexer says it has no such transaction is a nonce moved
     by something else — and this payment can then never run at all. The same
     answer when the account could not be read but the indexer could: a
     transaction nobody has recorded after the whole wait is not one to leave
     a balance at nought for. Either way the booking is only set aside, never
     forgotten — see `k1CoinStore.ts`'s `reconcileK1Spends`. */
  if (input.onChain === 'absent') return 'not-sent';
  return 'unknown';
}

/**
 * What the indexer says of one transaction: `success` it ran (wholly or in
 * part), `failure` the chain refused it, `absent` there is no such
 * transaction.
 */
export type CustodyTxOutcome = 'success' | 'failure' | 'absent';

/**
 * How long everything BEFORE a payment is handed over may take (2026/09/22).
 *
 * Opening the connection, reading the account, the approval, building the
 * transaction and the recipient's claim: none of it sends anything, and none
 * of it had a bound. Live on 2026/09/22 a Send sheet sat on "Proving and
 * submitting" with no proof ever asked for. Past this the payment is told,
 * definitely, that it did not go through — which is true: nothing was sent.
 */
export const CUSTODY_PREPARE_WAIT_MS = 2 * 60 * 1000;

/**
 * How long a payment taken back on a timeout is watched for a late landing.
 * An hour: twice the sponsored transaction's own time to live
 * ({@link CUSTODY_TX_TTL_MS} in the client), after which no transaction can be
 * carrying it.
 */
export const CUSTODY_UNDONE_KEEP_MS = 60 * 60 * 1000;

/**
 * How many times a payment the node refused because the account changed under
 * it is built again, and how long it waits first.
 *
 * `1010: Invalid Transaction: Custom error: 104` is the node refusing a call
 * built against a state another transaction has just moved — the sponsor's own
 * opening deposits meet it on every setup, and a payment meets it when the
 * recipient's account is busy at the same moment. Nothing was applied, so
 * building it again against the new state is safe; a block or two is the wait.
 */
export const CUSTODY_STATE_RACE_RETRIES = 2;
export const CUSTODY_STATE_RACE_WAIT_MS = 20_000;

/**
 * Whether a failure is the node refusing the transaction outright — by the
 * RPC's own words (`1010: Invalid Transaction`), or by the pool reporting it
 * invalid, dropped, or usurped. In every one of these nothing was applied and
 * nothing can be.
 */
export function custodyNodeRefused(cause: unknown): boolean {
  return /Invalid Transaction|\b1010\b|Transaction(?:Invalid|Dropped|Usurped)Error/.test(
    custodyFailureChainText(cause),
  );
}

/** Whether the node refused because the account's state moved under the call. */
export function custodyStateRace(cause: unknown): boolean {
  return /Custom error:\s*104\b/.test(custodyFailureChainText(cause));
}

/** Effect's key for the cause a `FiberFailure` carries. */
const FIBER_FAILURE_CAUSE = Symbol.for('effect/Runtime/FiberFailure/Cause');

/**
 * Every word a failure carries, down its whole chain of causes.
 *
 * WHY THE WHOLE CHAIN. The node's refusal reaches this app four layers deep —
 * an Effect `FiberFailure`, around the wallet's `SubmissionError` ("Transaction
 * submission error"), around the node client's own ("Transaction submission
 * failed"), around the RPC error that actually says `1010: Invalid
 * Transaction: Custom error: 104` (live, 2026/09/22). Reading the top message
 * alone read nothing, so a refusal nothing had applied was reported as an
 * error nobody could act on, and never built again.
 */
export function custodyFailureChainText(cause: unknown): string {
  const parts: string[] = [];
  const seen = new Set<object>();
  const walk = (value: unknown, depth: number): void => {
    if (typeof value === 'string') {
      parts.push(value);
      return;
    }
    if (value === null || typeof value !== 'object' || depth > 8 || seen.has(value)) return;
    seen.add(value);
    const view = value as Record<string | symbol, unknown>;
    for (const key of ['_tag', 'name', 'message', 'data', 'code']) {
      const field = view[key];
      if (typeof field === 'string' || typeof field === 'number') parts.push(String(field));
    }
    for (const key of ['cause', 'error', 'failure', 'defect', 'left', 'right']) {
      walk(view[key], depth + 1);
    }
    walk(view[FIBER_FAILURE_CAUSE], depth + 1);
  };
  walk(cause, 0);
  return parts.join(' | ');
}

/**
 * A piece of work, or `timeout` once `milliseconds` have passed. The work is
 * not cancelled — nothing it waits on offers a way to — it is simply no longer
 * waited for, and a caller that must stop it from acting LATER says so itself.
 */
export async function withinCustodyBound<T>(
  work: Promise<T>,
  milliseconds: number,
): Promise<{ readonly kind: 'done'; readonly value: T } | { readonly kind: 'timeout' }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ kind: 'timeout' }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), milliseconds);
  });
  try {
    return await Promise.race([work.then((value) => ({ kind: 'done' as const, value })), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** The `name` on the error carrying {@link CUSTODY_PROOF_NOT_BUILT}. */
export const CUSTODY_PROOF_NOT_BUILT_NAME = 'CustodyProofNotBuilt';

/**
 * The error the proving provider throws when the prover declined to prove.
 *
 * `detail` IS THE SERVICE'S OWN WORDS AND IS NEVER SHOWN. A refusal arms a
 * retry against the next candidate position, and a retry costs the holder an
 * approval — so the retry has to be able to ask whether this refusal was about
 * a position at all. The message cannot answer that: it is the one sentence
 * written for the person reading it. The service says what the proof server
 * said in `detail`, so that is what travels, for
 * {@link custodyProofNotBuiltDetail} to hand to `spendPositionMayBeWrong`.
 */
export function custodyProofNotBuilt(detail: string | null = null): Error {
  const error = new Error(CUSTODY_PROOF_NOT_BUILT) as Error & { detail: string | null };
  error.name = CUSTODY_PROOF_NOT_BUILT_NAME;
  error.detail = detail;
  return error;
}

/**
 * The service's `detail` off that error, or null.
 *
 * Walked exactly as {@link isCustodyProofNotBuilt} walks, and for the same
 * reason: the error may arrive wrapped. Null is "nothing said", and a caller
 * that rotates a position on nothing said is a caller asking for up to ten
 * approvals for a failure that was never about a position.
 */
export function custodyProofNotBuiltDetail(cause: unknown): string | null {
  for (let step: unknown = cause, depth = 0; step instanceof Error && depth < 8; depth += 1) {
    const detail = (step as { detail?: unknown }).detail;
    if (typeof detail === 'string' && detail.length > 0) return detail;
    step = step.cause;
  }
  return null;
}

/**
 * Whether a cause is that error — the one a different position can fix.
 *
 * IT IS LOOKED FOR THROUGH A WRAPPER, because midnight-js does not rethrow what
 * a provider threw. `submitTx` catches it and builds a NEW plain `Error` whose
 * message is its own preamble with our error's `name: message` appended, and
 * sets no `cause`:
 *
 * ```
 * Error: Unexpected error submitting scoped transaction '<unnamed>': \
 *   CustodyProofNotBuilt: That payment could not be completed just now. …
 * ```
 *
 * So the wrapper's own `name` is `Error`, and reading only `cause.name` said
 * "not that error" about exactly that error. Live on 2026/09/18: the coin's
 * stored position was the first of two candidates and the true one was the
 * second, the proof server declined, and the retry that exists to try the
 * second candidate never fired — the payment stopped on the first refusal and
 * the whole shielded send was written up as blocked. The `cause` chain is
 * walked in case a future version does set one, and the name in the text is
 * matched because today that is the only thing that survives the hop.
 */
export function isCustodyProofNotBuilt(cause: unknown): boolean {
  /* Bounded, because `cause` chains can be circular and a error-formatting
     helper is not a place to hang the tab. */
  for (let step: unknown = cause, depth = 0; step instanceof Error && depth < 8; depth += 1) {
    if (step.name === CUSTODY_PROOF_NOT_BUILT_NAME) return true;
    if (step.message.includes(`${CUSTODY_PROOF_NOT_BUILT_NAME}: `)) return true;
    step = step.cause;
  }
  return false;
}

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
  /**
   * Every circuit the transaction calls, e.g. `['append_inbox_with_k256']`.
   *
   * A LIST BECAUSE A TRANSACTION MAY HAVE TWO CALLS IN IT. The direct transfer
   * of MIP-0012 §6.6 is the sender's gated spend to a contract recipient with
   * the payee's own permissionless claim grafted onto the same transaction, and
   * both have to be staged where the proof is made. The proving service walks
   * the transaction's own calls either way; naming them buys the refusal — an
   * unstaged second circuit is refused by name rather than several seconds
   * later in a prover's own words.
   */
  readonly circuits: readonly string[];
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
  circuits: readonly string[],
  unprovenTx: Uint8Array,
  network: string,
): ProveCustodyRequest {
  if (circuits.length === 0) {
    throw new Error('a proof request must name the circuits its transaction calls');
  }
  return { circuits: [...circuits], unprovenTx: bytesToHex(unprovenTx), network };
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
 * Whether a refusal body says the prover RAN and could not build a proof.
 *
 * `proving-failed` is the service's own code for it, and it is the one refusal
 * a different candidate position can fix. Everything else — the artefacts are
 * not staged, the queue is full, the request was malformed, a gateway answered
 * instead of the service — is unimproved by trying again with another number.
 */
export function proveAccountCustodyRefused(body: unknown): boolean {
  return (body as { error?: unknown } | null)?.error === 'proving-failed';
}

/**
 * What the service said about the refusal, verbatim, or null.
 *
 * FOR THE RETRY TO JUDGE, AND FOR NO SCREEN. The sponsor's `detail` carries the
 * proof server's own message — "The proof server could not prove
 * withdraw_shielded_with_k256: …" — and the only question asked of it is
 * whether it reads like a coin at the wrong position. It is never painted:
 * {@link custodyFailureSentence} would refuse most of it anyway, and the
 * sentence somebody reads is {@link CUSTODY_PROOF_NOT_BUILT}.
 */
export function proveAccountCustodyDetail(body: unknown): string | null {
  const detail = (body as { detail?: unknown } | null)?.detail;
  return typeof detail === 'string' && detail.trim().length > 0 ? detail : null;
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
export type CustodyDeployStep = 'interrupted' | 'deploy' | 'activate' | 'ready';

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
  /**
   * `false` from the moment a setup starts, and `true` once the opening balance
   * has been asked for AND answered — granted or refused, either is an answer.
   *
   * ABSENT IS NEITHER. Every record written before 2026/09/22 was funded inside
   * its own setup press, so a missing field means "that was the old order, and
   * it already happened" — and such a Passport is never asked for a second
   * grant on open. See {@link custodyOpeningBalanceDue}.
   */
  readonly openingBalanceAsked?: boolean;
}

/**
 * The step a record is waiting on BEFORE the Passport can be used.
 *
 * THE WAVES ARE NOT A STEP OF IT ANY MORE (2026/09/22). Wave 1 — the deploy —
 * carries the two deposits and every circuit of the device's own arm,
 * activation included (`planCustodyWaves`), which is every circuit a Passport
 * held by that arm ever calls. So the order is deploy, activate, use; waves 2
 * and up install the OTHER arm and the grant circuits, and they are finished
 * after Home, in the background, where {@link custodyWavesPending} says so.
 * That took four dependent transactions (~70 s on stagenet) off the time to
 * Home.
 *
 * `interrupted` is terminal only BEFORE activation. An account whose key is on
 * is a working Passport whether or not its remaining waves can ever be signed,
 * and telling its holder to start again would abandon money that is there.
 */
export function nextCustodyStep(record: CustodyAccountRecord): CustodyDeployStep {
  if (record.interrupted === true && !record.activated) return 'interrupted';
  if (record.address === null) return 'deploy';
  if (!record.activated) return 'activate';
  return 'ready';
}

/**
 * Whether a usable Passport still has maintenance waves to land.
 *
 * Only after activation: before it, the waves are simply not the next thing.
 * Never for an interrupted record, because the key that would sign them is
 * gone and asking again would fail the same way every time.
 */
export function custodyWavesPending(record: CustodyAccountRecord): boolean {
  if (record.interrupted === true) return false;
  if (record.address === null || !record.activated) return false;
  return record.wavesDone < record.totalWaves;
}

/**
 * Whether the opening balance is still to be asked for.
 *
 * AFTER THE LAST WAVE, NOT AFTER ACTIVATION, and that is the chain's rule and
 * not a preference. The service pays the grant in through midnight-js's
 * `findDeployedContract`, which refuses a contract whose state does not carry
 * EVERY circuit of the build it was handed (`verifyContractState`) — so a grant
 * asked for between activation and the last wave is refused every time. The
 * balance therefore arrives a wave or two after Home, and Home says so by
 * showing it when it lands.
 */
export function custodyOpeningBalanceDue(record: CustodyAccountRecord): boolean {
  if (record.address === null || !record.activated) return false;
  if (record.openingBalanceAsked !== false) return false;
  return record.wavesDone >= record.totalWaves;
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
  const key = custodyRecordKey(record.user, record.network);
  records[key] = custodyRecordMerged(records[key] ?? null, record);
  writeCustodyMap(storage, CUSTODY_STORAGE_KEY, records);
}

/**
 * What to store when `next` is written over `stored`.
 *
 * THE FACTS THAT ONLY EVER MOVE FORWARD ARE NEVER WRITTEN BACK (2026/09/22).
 * Since the waves land behind Home, two writers share one record: a payment
 * reads it, waits for the account, and writes it back with its hash on; a wave
 * lands in between and writes one more wave on. The payment's copy is from
 * BEFORE the wave, so writing it whole put the wave count back — and a wave the
 * record forgets is a wave the next run pays for again, or a way back held for
 * ever. So for an ACTIVATED account at the same address, `wavesDone`,
 * `activated`, and `openingBalanceAsked` keep the furthest either copy has
 * reached, and the transaction hashes keep both. Before activation nothing is
 * merged: a deploy that never landed is legitimately redone from the start.
 */
export function custodyRecordMerged(
  stored: CustodyAccountRecord | null,
  next: CustodyAccountRecord,
): CustodyAccountRecord {
  if (stored === null || stored.address === null || stored.address !== next.address) return next;
  if (!stored.activated) return next;
  const hashes = [...next.txHashes, ...stored.txHashes.filter((hash) => !next.txHashes.includes(hash))];
  return {
    ...next,
    activated: true,
    wavesDone: Math.max(stored.wavesDone, next.wavesDone),
    txHashes: hashes,
    ...(stored.openingBalanceAsked === true ? { openingBalanceAsked: true } : {}),
  };
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
    openingBalanceAsked: false,
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

/**
 * The refusal for a step that needs the waves still landing behind Home.
 *
 * One plain sentence, none of the forbidden words, and TRUE: nothing is wrong,
 * the Passport is finishing, and the same press works a minute later.
 */
export const CUSTODY_STILL_FINISHING =
  'Your Passport is still finishing setting up. Try again in a minute.';

/** The sentence a half-built Passport shows when its setup cannot be finished. */
export const CUSTODY_SETUP_INTERRUPTED =
  'Setting up this Passport was interrupted. Start again to finish it.';

/* -------------------------------------------------------------------------- */
/* A setup whose answer was lost rather than refused                          */
/* -------------------------------------------------------------------------- */

/**
 * The sentence for a step that was sent and never answered for.
 *
 * IT IS NOT "SOMETHING WENT WRONG", AND THAT DISTINCTION COST SOMEBODY THEIR
 * PASSPORT. Live, 2026/09/22: a setup's activation was proved, balanced, and
 * INCLUDED — transaction `c01c7791…`, block 569232 — and the node's socket
 * dropped while the tab was waiting on it (`1000:: Normal Closure`, the same
 * intermittent as 2026/09/05 and 2026/09/07). The wait threw, the failure had
 * no sentence of its own, and the reader was shown {@link CUSTODY_UNEXPECTED}
 * over an account that was finished and working.
 *
 * A lost answer is not a failed transaction, so the sentence says the true
 * thing — it is still being set up — and invites the one action that resolves
 * it either way, because pressing again now READS THE CHAIN before it acts.
 */
export const CUSTODY_SETUP_UNCONFIRMED =
  'Your Passport is being set up. If this takes more than a minute, press again.';

/**
 * The words the activation circuit asserts with when the account is already on.
 *
 * Spelled once, here, because two callers match on it and a copy in the second
 * one is a copy that stays behind when this one is corrected.
 */
export const CUSTODY_ALREADY_ACTIVATED = 'already activated';

/**
 * Every message in a cause chain, lower-cased and joined.
 *
 * THE WHOLE CHAIN, because midnight-js re-throws what the runtime threw and the
 * words that matter are at the bottom of it. The live failure arrived as
 * `Unexpected error executing scoped transaction '<unnamed>': Error: failed
 * assert: already activated`, with `ContractRuntimeError` and `CompactError`
 * under it — the same words at every level, but nothing guarantees that, and a
 * reader of the top message alone is one library release away from missing it.
 *
 * A chain that points back at itself is walked once. It is not a shape anybody
 * writes on purpose; it is a shape a re-thrower can produce, and a loop here
 * would hang the tab rather than fail it.
 */
function custodyCauseText(cause: unknown): string {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  let here: unknown = cause;
  while (here instanceof Error && !seen.has(here)) {
    seen.add(here);
    parts.push(here.message);
    here = (here as { cause?: unknown }).cause;
  }
  return parts.join(' ').toLowerCase();
}

/**
 * Whether the circuit refused because the account is ALREADY turned on.
 *
 * THIS IS A SUCCESS AND NOT A FAILURE, and reading it as one is the whole of
 * the defect above. The assert fires on `booted`, which nothing ever clears —
 * so the account the caller is trying to activate is activated, by this very
 * device, and the only honest thing to do with that answer is to record it and
 * carry on to the name.
 */
export function custodyAlreadyActivated(cause: unknown): boolean {
  return custodyCauseText(cause).includes(CUSTODY_ALREADY_ACTIVATED);
}

/**
 * Whether the chain itself refused, as opposed to the answer being lost.
 *
 * THE DIFFERENCE DECIDES WHETHER WAITING IS WORTH ANYTHING. A refused proof or
 * a failed assert is a verdict: the transaction will never land, and polling
 * for two minutes only makes somebody wait two minutes for the same sentence.
 * A dropped socket is not a verdict at all — the transaction may well be in a
 * block — so the chain is the only thing that can settle it, and the caller
 * asks it rather than guessing.
 *
 * `already activated` is excluded explicitly although it IS a failed assert:
 * it is the one verdict that means the work is done, and it is handled by
 * {@link custodyAlreadyActivated} before anything here is consulted. Saying so
 * in the code as well as in the order of the callers is what keeps the two
 * answers from ever being read as the same one.
 */
export function custodyChainRefused(cause: unknown): boolean {
  if (isCustodyProofNotBuilt(cause)) return true;
  const text = custodyCauseText(cause);
  if (text.includes(CUSTODY_ALREADY_ACTIVATED)) return false;
  return text.includes('failed assert');
}

/**
 * The shapes a lost connection arrives in, as this stack has produced them.
 *
 * `socket` and `disconnected` are polkadot-js's, verbatim, from the outages of
 * 2026/09/05 (`WebSocket is not connected`) and 2026/09/22 (`disconnected from
 * wss://rpc.stagenet.shielded.tools/: 1000:: Normal Closure`); the rest are
 * what `fetch` and an aborted request say when the indexer or the node goes
 * away mid-question.
 */
const CUSTODY_LOST_ANSWER_SIGNS: readonly string[] = [
  'socket',
  'disconnected',
  'network',
  'connection',
  'econnreset',
  'fetch failed',
  'failed to fetch',
  'timed out',
  'timeout',
  'aborted',
];

/**
 * Whether the ANSWER was lost, as opposed to the work having failed.
 *
 * A POSITIVE TEST, AND IT HAS TO BE. Treating every unrecognised failure as a
 * lost answer would put two minutes of polling in front of every honest
 * refusal this layer can produce — a proving service that is not deployed, a
 * transaction that could not be built, a balance that would not cover a fee —
 * and what a person would see is a spinner where a sentence used to be. So a
 * lost answer must LOOK like one, and everything else is reported at once and
 * unchanged.
 *
 * The cost of the choice is that a socket dropping in words nobody has seen
 * yet falls back to the old behaviour rather than to the new one, which is the
 * right way round: the old behaviour is a sentence, and the failure mode of the
 * alternative is a wait nobody can explain.
 */
export function custodyAnswerWasLost(cause: unknown): boolean {
  if (custodyAlreadyActivated(cause)) return false;
  if (custodyChainRefused(cause)) return false;
  const text = custodyCauseText(cause);
  return CUSTODY_LOST_ANSWER_SIGNS.some((sign) => text.includes(sign));
}

/**
 * The record for an account the chain shows is turned on.
 *
 * The device is optional because the two callers know different things. The
 * setup driver holds the device it just activated with and files its point, so
 * a later call can name the roster entry without a second ceremony; a screen
 * healing a record on open holds no device at all — settling one costs an
 * assertion — and must not overwrite a point that is already there with
 * nothing.
 */
export function custodyActivatedRecord(
  record: CustodyAccountRecord,
  device: { readonly pk: { readonly x: bigint; readonly y: bigint } } | null,
  txHash: string | null,
): CustodyAccountRecord {
  return {
    ...record,
    activated: true,
    pkXHex: device === null ? record.pkXHex : device.pk.x.toString(16),
    pkYHex: device === null ? record.pkYHex : device.pk.y.toString(16),
    txHashes: txHash === null ? record.txHashes : [...record.txHashes, txHash],
  };
}

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
 * The built-in error classes a library throws when it meets something it did
 * not expect. None of them is ever raised on purpose by this layer.
 */
const RUNTIME_ERROR_NAMES: ReadonlySet<string> = new Set([
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
  'URIError',
  /* THE ONE A LEDGER TRAP ARRIVES UNDER, and the one that reached a screen.
     A WebAssembly trap is `name: 'RuntimeError'`, `message: 'unreachable'` —
     nine characters, no vocabulary in them, and therefore through both of the
     checks above and painted verbatim. "unreachable", alone, on the screen of
     somebody who pressed Send. It is the most likely of the lot to be raised
     here, because this layer's position guesses are exactly what makes the
     on-chain runtime trap (see `spendPositionMayBeWrong`), and it is no more
     ours than a `TypeError` is. */
  'RuntimeError',
]);

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
  const message = unwrapCustodyMessage(cause instanceof Error ? cause.message.trim() : '');
  if (message.length === 0 || message.length > 160) return CUSTODY_UNEXPECTED;
  /* A RUNTIME ERROR IS NEVER ONE OF OURS. Every refusal this layer writes is a
     plain `Error`; a `TypeError` or a `RangeError` comes from a library reading
     something this build did not give it, and its message is machine-shaped
     even when it is short and carries none of the vocabulary above — "Cannot
     use 'in' operator to search for 'deploy' in undefined" reached a screen on
     2026/09/17 by passing both of those checks. */
  if (cause instanceof Error && RUNTIME_ERROR_NAMES.has(cause.name)) return CUSTODY_UNEXPECTED;
  const lower = message.toLowerCase();
  if (CUSTODY_FORBIDDEN_WORDS.some((word) => lower.includes(word))) return CUSTODY_UNEXPECTED;
  return message;
}

/**
 * Our own sentence, out of whatever a library wrapped it in.
 *
 * midnight-js re-throws what it catches with its own preamble, so the refusal
 * this layer wrote reaches a screen as
 *
 *   Unexpected error submitting scoped transaction '<unnamed>': Error: The
 *   service that finishes this step is not answering right now.
 *
 * — which is short, carries none of the forbidden vocabulary, and is not a
 * runtime error, so every check below waved it through and a reader was shown a
 * library's internals over a payment they had approved (seen live,
 * 2026/09/18). The tell is the nested `Error:`: nothing this layer writes
 * contains one. So the text after the LAST such marker is taken, which is our
 * sentence where there is one and the library's own words where there is not —
 * and those then meet the same checks as any other message, which is what
 * catches them.
 *
 * ANY ERROR NAME, not only ones ending in "Error". `CustodyProofNotBuilt` is
 * one of ours and it leaked through a pattern that looked for the suffix
 * (2026/09/18), so the marker is a capitalised identifier followed by a colon
 * and a space — which is what an error name rendered into a message looks like,
 * and which no sentence this layer writes contains.
 */
function unwrapCustodyMessage(message: string): string {
  /* ONE PASS, because it takes the LAST marker: however many layers a stack of
     re-throws added, the innermost message begins after the final name, and a
     second pass over what is left would have nothing further to find. */
  /* The boundary is a LOOKBEHIND so it is not consumed: a matched name eats the
     space in front of the next one, and a scan that consumed the boundary
     skipped every other layer of a stack. */
  const marker = /(?<![^\s:])[A-Z][A-Za-z0-9_]{2,}:\s+/g;
  let last: number | null = null;
  for (let found = marker.exec(message); found !== null; found = marker.exec(message)) {
    last = found.index + found[0].length;
  }
  return (last === null ? message : message.slice(last)).trim();
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
