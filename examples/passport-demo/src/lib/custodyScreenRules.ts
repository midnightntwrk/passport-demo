/**
 * THE THREE DECISIONS THE DYNAMIC PASSPORT SCREEN MAKES ABOUT SOMEBODY'S MONEY,
 * taken out of the screen so each of them can be drilled against every branch.
 *
 * WHY THESE THREE AND NOT THE WHOLE SCREEN
 * ----------------------------------------
 * `../screens/CustodyPassport.tsx` is a React component: it holds refs, awaits
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


/* -------------------------------------------------------------------------- */
/* 1. One payment at a time                                                   */
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
/* 2b. The record of what the account kept, written INSIDE the payment        */
/* -------------------------------------------------------------------------- */

/** The busy line while the account's own note of the change is written. */
export const CUSTODY_KEEP_RECORD_BUSY = 'Writing down what you kept';

/**
 * Write down what the account kept, as the last thing the payment does.
 *
 * INSIDE THE PAYMENT, WHICH IS THE WHOLE POINT. This is a GATED call — it
 * costs an approval and it writes the coin store — and it used to be started
 * detached, with the payment already resolved and the in-flight flag already
 * cleared. So it overlapped whatever came next: the follow-up read of the
 * holdings, or a second Send. Two gated calls against one account read the
 * same device entry and sign against the same `auth_nonce`, and the one that
 * arrives second is signed against a nonce the first has already moved on
 * from — a transaction the node refuses, for a reason no sentence on the
 * screen could explain. That is the practical trigger of the defect above this
 * one: the second payment is submitted, the chain says no, and the store is
 * asked to believe it.
 *
 * IT IS STILL NOT PART OF THE PAYMENT'S SUCCESS. The recipient has their money
 * the moment the send lands; this is the sender's own note of the remainder. A
 * failure here loses the record and not the money, so it is reported to the
 * console and never to the person — the payment succeeded and saying otherwise
 * would be false.
 *
 * The busy line is set rather than left as the send's, because the send is
 * over and a line that still said "Sending" would be describing something that
 * has finished.
 */
export async function runCustodyKeepRecord(
  busy: (line: string) => void,
  write: () => Promise<void>,
): Promise<void> {
  busy(CUSTODY_KEEP_RECORD_BUSY);
  try {
    await write();
  } catch (cause) {
    console.warn('[account-custody] the change was not written to the inbox', cause);
  }
}

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

/* -------------------------------------------------------------------------- */

/** What a payment about to be made will put on the chain about the two parties. */
export interface CustodyPaymentDisclosureInput {
  /** Exactly what was typed into "Send to". */
  readonly typed: string;
  /** Whether the chosen asset is a shielded token rather than the account's NIGHT. */
  readonly shielded: boolean;
}

/**
 * The sentence that says what a payment publishes, or null when there is
 * nothing yet to say.
 *
 * THE PER-PAYMENT CHOICE OF MIP-0012 §6.6, SAID BEFORE IT IS MADE. The direct
 * transfer is one transaction carrying a call on the sender's account and a
 * call on the recipient's, so the chain records that those two accounts
 * transacted — the amount and the note stay shielded, and the pair does not.
 * The same money to a pasted shielded address is one call on one account and
 * names nobody. Which of the two happens is decided by what is typed into a
 * single field, so the difference has to be visible at that field and not in a
 * specification.
 *
 * SAID FOR THE SHIELDED ROUTE ONLY. The account's NIGHT moves by a different
 * pair of legs and this sentence would be describing a transaction that is not
 * the one about to be made.
 */
export function custodyPaymentDisclosure(
  input: CustodyPaymentDisclosureInput,
): string | null {
  if (!input.shielded) return null;
  const typed = input.typed.trim();
  if (typed.length === 0) return null;
  if (/^mn_shield-addr/i.test(typed)) {
    return 'This payment names neither Passport on chain.';
  }
  return 'Both Passports are named on chain for this payment.';
}
