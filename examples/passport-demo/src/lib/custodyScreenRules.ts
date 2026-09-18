/**
 * THE THREE DECISIONS THE DYNAMIC PASSPORT SCREEN MAKES ABOUT SOMEBODY'S MONEY,
 * taken out of the screen so each of them can be drilled against every branch.
 *
 * WHY THESE THREE AND NOT THE WHOLE SCREEN
 * ----------------------------------------
 * `../screens/DynamicPassport.tsx` is a React component: it holds refs, awaits
 * a wallet, writes `localStorage`, and paints. None of that can be asserted on
 * cheaply, and most of it does not need to be — a heading in the wrong place is
 * a thing a reader sees and reports. These three are different, because each
 * has a wrong answer that costs a payment and none of them is visible while it
 * is being made:
 *
 *   1. WHETHER TO PUT A NOTE BACK. The last leg of a shielded payment can throw
 *      after the transaction was broadcast — a dropped socket, a confirmation
 *      wait running out — and the recipient has the money. Depositing it "back"
 *      in that case is a second spend of a note that is gone, which the node
 *      refuses, after a screen has told somebody it is held for them. So the
 *      decision is made on what the WALLET says it holds, re-read after the
 *      failure, and {@link custodyDeliveryFailure} is that decision alone.
 *   2. WHETHER A SECOND PIECE OF WORK MAY START. The screen's payments read and
 *      write one coin store. Two at once file a delivery over a coin the other
 *      has just spent, or spend the same coin twice — and the store's own
 *      guards then refuse a proof for reasons no sentence on the screen could
 *      explain. {@link custodyInFlightRefusal} is the refusal,
 *      {@link custodyMayReadHoldings} is the same rule for the background read,
 *      and {@link runCustodyWork} is the ORDER those two imply: the read that
 *      shows what a payment changed cannot run inside the payment that is
 *      holding the store, or it is refused and the figure stays stale.
 *   2b. WHETHER THE NOTE A STOPPED PAYMENT LEFT IS HERE YET. Finish read the
 *      wallet's notes once, so the same button on the same payment failed in
 *      under a second 45 seconds after a re-open and completed three minutes
 *      later (live re-run, 2026/09/18). {@link awaitCustodyStoppedNote} is the
 *      wait the send path already had, and the one sentence for a window that
 *      closed with nothing written and nothing sent.
 *   3. WHAT THE WALK'S OUTCOMES MEAN FOR THE FIGURE SHOWN. A delivery the chain
 *      could not place is money that has arrived and cannot be spent yet, which
 *      is neither a balance nor nothing. {@link custodyUnplacedDeliveries} and
 *      {@link custodyArrivingCount} are that arithmetic.
 *
 * NO REACT, NO STORAGE, NO NETWORK, AND NO WALLET. Every input is a value the
 * screen already has by the time it decides, which is why this file is in the
 * coverage denominator (`../../vitest.config.ts`) at 100%.
 *
 * THE COPY RULE HOLDS HERE TOO. The one sentence in this file reaches somebody
 * who chose a sign-in, not a chain: it names no wallet address, fee token,
 * contract, name registry, indexer, resolver, fee sponsor, SDK, or sign-in
 * vendor, and `custodyScreenRules.test.ts` asserts that rather than trusting
 * it.
 */

import { pollUntilTrue } from './chainWait.js';
import type { CustodyShieldedSendStage } from '../identity/custodyContractSend.js';

/* -------------------------------------------------------------------------- */
/* 1. Putting a note back, or not                                             */
/* -------------------------------------------------------------------------- */

/**
 * What a failed last leg means, and what is to be done about it.
 *
 * `stage` is the record's next stage — the one place that answers "where is my
 * money" for a payment that stopped (`../identity/custodyContractSend.ts`'s
 * `custodyShieldedSendOutcome` reads it) — and `deposit` says whether there is
 * a return leg left to run.
 */
export interface CustodyDeliveryDecision {
  readonly stage: CustodyShieldedSendStage;
  /** Whether the note is to be deposited back into the sender's own account. */
  readonly deposit: boolean;
}

/** What the wallet said when it was asked whether it still holds the note. */
export interface CustodyDeliveryFailureInput {
  /**
   * Whether the note paid by leg one is STILL HELD by this wallet, by nonce.
   *
   * Three values and they mean three different things. `true` is the note here
   * and undelivered. `false` is the note gone — either the recipient has it or
   * something else does, and this screen cannot tell which. `null` is a wallet
   * that could not be asked, which is not the same as an answer.
   */
  readonly stillHeld: boolean | null;
  /** Whether the return leg has ALSO failed. Only then is the value stranded. */
  readonly returnFailed?: boolean;
}

/**
 * Whether to put the note back, and what the record says either way.
 *
 * A NOTE THAT IS GONE IS NEVER SENT ANYWHERE. `stillHeld: false` is the case
 * this function exists for: the leg threw, and the transaction it threw out of
 * had already been broadcast. Re-sending that note is a double spend the node
 * refuses, and doing it under the line "putting it back in your Passport"
 * tells somebody their money is coming home when it may well be with the
 * person they paid. So the record goes to `'unconfirmed'`, whose sentence says
 * exactly that much and no more.
 *
 * A WALLET THAT COULD NOT BE ASKED IS TREATED AS STILL HOLDING IT. The two
 * mistakes are not the same size: a deposit-back of a note that is gone is
 * refused by the node and costs a fee, while not returning a note that IS held
 * leaves the value in a wallet with no screen that can reach it — Home sweeps
 * NIGHT and cannot see a shielded note. So an unanswerable wallet takes the
 * recoverable branch.
 */
export function custodyDeliveryFailure(
  input: CustodyDeliveryFailureInput,
): CustodyDeliveryDecision {
  if (input.returnFailed === true) return { stage: 'stranded', deposit: false };
  if (input.stillHeld === false) return { stage: 'unconfirmed', deposit: false };
  return { stage: 'returning', deposit: true };
}

/* -------------------------------------------------------------------------- */
/* 2. One thing at a time                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Why a second piece of work may not start while one is running, or null when
 * it may.
 *
 * ONE SENTENCE, AND IT IS NOT AN ERROR ABOUT THE SECOND PAYMENT. Nothing has
 * gone wrong: the person pressed twice, or pressed again on a screen whose
 * button had not yet caught up. It says what is true and what to do, and says
 * nothing about a store, a proof, or a coin.
 */
export function custodyInFlightRefusal(inFlight: boolean): string | null {
  return inFlight
    ? 'Your Passport is still finishing the last thing you asked it to do. Try again in a moment.'
    : null;
}

/**
 * Whether the background read of what the Passport holds may run now.
 *
 * THE WALK INSIDE IT WRITES COINS. It opens the account's own list of
 * deliveries and files what it finds, so a read that landed in the middle of a
 * payment could file a delivery over the coin the payment had just spent, or
 * re-place one it had just moved. What is already on the screen stays on it,
 * and the read happens again when the payment finishes — which is the moment
 * the figures change anyway.
 */
export function custodyMayReadHoldings(inFlight: boolean): boolean {
  return !inFlight;
}

/** A mutable flag holder — React's `useRef` is one, and so is `{ current }`. */
export interface CustodyInFlightFlag {
  current: boolean;
}

/** What a piece of the screen's work came to. */
export interface CustodyWorkOutcome {
  /** What the work threw, or null when it finished. */
  readonly failure: unknown;
}

/**
 * Run one piece of work under the in-flight flag, and THEN the read that shows
 * what it changed.
 *
 * WHY THE ORDER IS A FUNCTION AND NOT TWO LINES IN THE SCREEN. The flag above
 * makes {@link custodyMayReadHoldings} refuse a read while a payment owns the
 * coin store — and a payment that asked for its own follow-up read INSIDE its
 * own work is therefore a payment whose read is refused. That was live on
 * 2026/09/18: "Sent." appeared over the figure the account held BEFORE the
 * payment, and only Refresh or a reload moved it. The read has to happen after
 * the flag clears, which is one statement in the wrong place either way and is
 * the whole of the defect, so the order is written down here and drilled rather
 * than left to the sequence of lines in a component.
 *
 * THE FOLLOW-UP RUNS EVEN WHEN THE WORK FAILED. A payment can fail after the
 * value has moved — the last leg throws having broadcast — so a failure is
 * exactly when the figures on screen are least trustworthy. What the work threw
 * is what the person is told about; a follow-up that ALSO throws is reported
 * only when there was nothing else to report, because the work's own failure is
 * the one that names what they asked for.
 */
export async function runCustodyWork(
  inFlight: CustodyInFlightFlag,
  work: () => Promise<void>,
  followUp: (() => Promise<void>) | null = null,
): Promise<CustodyWorkOutcome> {
  let failure: unknown = null;
  inFlight.current = true;
  try {
    await work();
  } catch (cause) {
    failure = cause;
  } finally {
    /* BEFORE the follow-up, which is the point of this function. */
    inFlight.current = false;
  }
  if (followUp === null) return { failure };
  try {
    await followUp();
  } catch (cause) {
    if (failure === null) failure = cause;
  }
  return { failure };
}

/* -------------------------------------------------------------------------- */
/* 2b. Whether the note a stopped payment left is here YET                    */
/* -------------------------------------------------------------------------- */

/**
 * What Finish says when the note leg one paid is not in this Passport's hands
 * yet.
 *
 * NOT A FAILURE, AND IT NAMES THE BUTTON. The value has left the account and
 * the wallet's own sync has not applied the arrival; the one thing a person can
 * do is press the same button again in a moment, so the sentence says that and
 * nothing about a sync, a note, or a leg.
 */
export const CUSTODY_FINISH_NOT_SETTLED_YET =
  'This payment has not settled yet, so it cannot be sent on. Give it a moment and press Finish this payment again.';

/** Where this payment's note is: here, or not here yet. */
export type CustodyStoppedNoteOutcome<TNote> =
  | { readonly kind: 'here'; readonly note: TNote }
  | { readonly kind: 'not-yet'; readonly sentence: string };

/** How this payment's note is looked for, read afresh on every look. */
export interface CustodyStoppedNoteLook<TNote extends { readonly nonce: string }> {
  /** Every shielded note this Passport's own wallet holds, now. */
  readonly notes: () => Promise<readonly TNote[]>;
  /**
   * Which of them is this payment's, for a record that kept NO nonce.
   *
   * A payment interrupted between leg one landing and the note being identified
   * has no nonce to go on, and the snapshot of what was held before went with
   * the tab. `../lib/shieldedNote.ts`'s rule is the fall-back and it is the
   * caller's, not this one's.
   */
  readonly withoutNonce: (notes: readonly TNote[]) => TNote | null;
}

/**
 * Waits for the note a stopped payment left behind, the way the send itself
 * waits for it.
 *
 * THE DEFECT THIS IS THE REPAIR FOR (live re-run, 2026/09/18). Finish read the
 * wallet's notes ONCE. Pressed 45 seconds after a Passport was re-opened it
 * failed in under a second — the wallet had not applied the arrival yet — and
 * pressed three minutes later the same button completed the same payment. A
 * person cannot tell those two presses apart, so the difference read as a
 * payment that sometimes works: the wait belongs on both paths, with the same
 * window and the same line on screen.
 *
 * BY THE NONCE WHERE THERE IS ONE, which is exact: that nonce came out of leg
 * one's own result and names one note in the world. A `0x` prefix and case are
 * not part of the name.
 *
 * `'not-yet'` IS NOT `'gone'`. The window closing says nothing about whether
 * the note exists — `pollUntilTrue` counts a read that threw as a no — so
 * nothing is written, nothing is sent, and the record is left exactly as it
 * was for the next press.
 */
export async function awaitCustodyStoppedNote<TNote extends { readonly nonce: string }>(
  noteNonce: string | null,
  look: CustodyStoppedNoteLook<TNote>,
  wait: {
    readonly windowMs: number;
    readonly intervalMs: number;
    readonly now?: () => number;
    readonly sleep?: (milliseconds: number) => Promise<void>;
  },
): Promise<CustodyStoppedNoteOutcome<TNote>> {
  const wanted = bareNonce(noteNonce);
  /* A BOX, because what the poll finds has to survive the closure it is found
     in — the same shape the screen's own note wait uses. */
  const found: { note: TNote | null } = { note: null };
  await pollUntilTrue(async () => {
    const notes = await look.notes();
    found.note =
      wanted.length > 0
        ? notes.find((note) => bareNonce(note.nonce) === wanted) ?? null
        : look.withoutNonce(notes);
    return found.note !== null;
  }, wait);
  if (found.note === null) {
    return { kind: 'not-yet', sentence: CUSTODY_FINISH_NOT_SETTLED_YET };
  }
  return { kind: 'here', note: found.note };
}

/** A nonce with nothing on it that is not the nonce. */
function bareNonce(nonce: string | null): string {
  return typeof nonce === 'string' ? nonce.trim().toLowerCase().replace(/^0x/, '') : '';
}

/* -------------------------------------------------------------------------- */
/* 3. What the walk found, as a figure                                        */
/* -------------------------------------------------------------------------- */

/** One delivery's outcome, as much of it as this arithmetic reads. */
export interface CustodyWalkOutcome {
  readonly reconciliation: {
    readonly outcome: string;
    /** Whether an ambiguous position was written down, or only reported. */
    readonly stored?: boolean;
  };
}

/**
 * How many of a walk's deliveries are here and not spendable yet.
 *
 * TWO OUTCOMES COUNT AND THE REST DO NOT. `'unavailable'` is the indexer not
 * having answered where the coin landed; an `'ambiguous'` the store did not
 * take is a two-output transaction whose candidates had nowhere to go, because
 * candidates live in a colour's held slot and that slot was occupied. Both are
 * coins the account demonstrably holds and cannot put in a proof — which is
 * what "arriving" means. `'learned'` and a stored `'ambiguous'` are in the
 * store and counted in the balance; `'spent'` and `'known'` are nothing
 * happening at all; `'refused'` is a row this store will not hold.
 *
 * Counting only the store's own awaiting rows made these coins vanish off the
 * screen entirely, which is the defect this exists to have fixed.
 */
export function custodyUnplacedDeliveries(outcomes: readonly CustodyWalkOutcome[]): number {
  return outcomes.filter(
    (entry) =>
      entry.reconciliation.outcome === 'unavailable' ||
      (entry.reconciliation.outcome === 'ambiguous' && entry.reconciliation.stored !== true),
  ).length;
}

/** What the arriving count is drawn from. */
export interface CustodyArrivingInput {
  /** The store's own rows: coins described, held, and without a position. */
  readonly awaitingRows: number;
  /**
   * The deliveries THIS walk could not place, or null when the walk could not
   * be made at all.
   *
   * Null is not zero, and the difference is the honest one: a walk that threw
   * says nothing about whether a delivery is waiting, so the count falls back
   * to what the store knows rather than claiming the walk found none. What is
   * already stored is still shown either way, which is why a failed walk is not
   * a sentence on the screen.
   */
  readonly unplaced: number | null;
}

/** The number of payments the screen says are still arriving. */
export function custodyArrivingCount(input: CustodyArrivingInput): number {
  const rows = Number.isFinite(input.awaitingRows) ? Math.max(0, input.awaitingRows) : 0;
  const unplaced =
    input.unplaced !== null && Number.isFinite(input.unplaced) ? Math.max(0, input.unplaced) : 0;
  return rows + unplaced;
}
