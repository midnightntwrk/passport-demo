/**
 * ASKING AGAIN WHETHER THIS PASSPORT CAN PAY IN ONE TRANSACTION.
 *
 * WHAT WAS WRONG (2026/09/15). Whether a send takes one step or two is a fact
 * about the SENDER's own deployed account, read from the chain once — when the
 * account address becomes known — and held for the session. For a Passport
 * that has existed for minutes that is exactly right. For one created SECONDS
 * ago it is not: the account was deployed by this very session, the chain has
 * not served it back yet, and the read answers "could not ask". The caller
 * turned that into `false`, nothing asked again until the next launch, and a
 * brand-new Passport therefore spent its whole first session sending in two
 * steps — although the contract it had just deployed carries the circuit that
 * does it in one.
 *
 * WHAT THIS IS. The schedule that closes that window: ask, and while the
 * answer is UNKNOWN ask again after five seconds, then ten, then twenty, then
 * forty, then stop. A definite answer — either one — ends it immediately,
 * because the question is about a deployed build and a deployed build does not
 * change under this app.
 *
 * WHY IT ENDS AT ALL. Roughly seventy-five seconds of asking covers an account
 * appearing on the chain (about fourteen seconds, measured — see
 * `RESUME_CONFIRM_WINDOW_MS` in `identity/passportContract.ts`) with a wide
 * margin. Past that the honest reading is not "the answer is slow" but "this
 * browser cannot reach the chain", and a poll that never stopped would be a
 * background request every forty seconds for as long as the tab is open, for a
 * question whose wrong answer costs a slower send and nothing else.
 *
 * WHY IT IS ITS OWN MODULE. It holds no React, no timers of its own, and no
 * knowledge of what is being asked: a reader in, a decision out, with the
 * clock injected. That is what makes the schedule drillable with fake timers
 * rather than something only a live indexer can demonstrate.
 */

/**
 * The waits between attempts, in order, for an answer that keeps coming back
 * unknown. The list is also the attempt BUDGET — four waits is five reads.
 */
export const ONE_TX_PROBE_DELAYS_MS: readonly number[] = [5_000, 10_000, 20_000, 40_000];

/**
 * The clock, injected.
 *
 * `window.setTimeout` in the app and a fake one in the drill. The handle is a
 * number because that is what the browser's timer returns and this module
 * never does anything with it but hand it back.
 */
export interface OneTxProbeTimers {
  set(run: () => void, ms: number): number;
  clear(handle: number): void;
}

export interface OneTxProbeOptions {
  /**
   * The question. `true` and `false` are both DEFINITE and end the schedule;
   * `null` means the chain could not be asked, and so does a rejection — a
   * read that threw has learned exactly as little as one that answered `null`,
   * and treating the two differently would end the schedule on a transport
   * blip.
   */
  read: () => Promise<boolean | null>;
  /** Called at most once, with the definite answer. Never with a guess. */
  onAnswer: (supported: boolean) => void;
  timers: OneTxProbeTimers;
  /** Defaults to {@link ONE_TX_PROBE_DELAYS_MS}. Supplied only by the drill. */
  delays?: readonly number[];
}

/**
 * Starts the schedule and returns the way to stop it.
 *
 * The first read happens IMMEDIATELY and synchronously-as-far-as-it-can, so an
 * account the chain already serves costs no delay at all; the waits exist only
 * for the account that is not there yet.
 *
 * Cancelling is total: it clears a pending wait AND suppresses the answer of a
 * read already in flight. An effect that re-ran because the account changed
 * must not have the previous account's answer land on it.
 */
export function probeOneTransactionSupport(options: OneTxProbeOptions): () => void {
  const delays = options.delays ?? ONE_TX_PROBE_DELAYS_MS;
  let live = true;
  let pending: number | null = null;
  let waited = 0;

  const scheduleNext = (): void => {
    /* The budget is spent. This Passport sends the way it sent a minute ago,
       and the next launch asks again from the top. */
    if (waited >= delays.length) return;
    const wait = delays[waited];
    waited += 1;
    pending = options.timers.set(() => {
      pending = null;
      ask();
    }, wait);
  };

  const ask = (): void => {
    void options.read().then(
      (answer) => {
        if (!live) return;
        if (answer === null) {
          scheduleNext();
          return;
        }
        options.onAnswer(answer);
      },
      () => {
        /* Same as `null`: nothing was learned, so ask again on the schedule
           rather than settling the session on a failure. */
        if (live) scheduleNext();
      },
    );
  };

  ask();

  return () => {
    live = false;
    if (pending !== null) {
      options.timers.clear(pending);
      pending = null;
    }
  };
}
