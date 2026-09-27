/**
 * A PAYMENT THAT RUNS BEHIND THE PASSPORT RATHER THAN IN FRONT OF IT (2026/09/25).
 *
 * "When we are doing a USDC send it blocks the whole UI with the modal; move
 * this to a small in-progress transaction state so the user can continue with
 * the Passport." Until this date the Send sheet stayed open, with every control
 * in it disabled, for the whole of a payment — the approval, the proof, and the
 * wait for the network — and the Passport underneath it could not be used.
 *
 * The sheet now closes the moment the payment has been handed over, and what it
 * used to say is said by two small surfaces instead: a pill above the tab bar
 * on every tab, and a live row at the head of Home's activity list. Both read
 * ONE value, {@link SendProgressView}, and this file is the whole of how that
 * value is decided. It holds no React and no DOM, so every branch is drilled in
 * `./sendProgress.test.ts`.
 *
 * WHERE THE TRUTH IS
 * ------------------
 * Not here. A payment in flight is written down by the host before it goes out
 * (`saveCustodyShieldedSend`), and that record is what a reload reads back. This
 * file only adds what a record cannot know: the step the running payment is on
 * in THIS tab, and the one-sentence outcome it came to. A reload therefore
 * shows the same pill from the same record, and nothing here is persisted.
 */

/**
 * The four things a running payment can be doing, in the order it does them —
 * and `waiting`, which comes before all four for a payment confirmed while the
 * last one was still finishing (2026/09/26). It is never an engine step: see
 * {@link SendProgressEvent}'s `waiting`.
 */
export type SendProgressPhase = 'waiting' | 'preparing' | 'approving' | 'proving' | 'confirming';

/**
 * What each phase is called on screen. Short, because it sits after a dot on
 * one line; each is true of the step it names and says nothing further ahead.
 */
export const SEND_PROGRESS_PHASE_LABEL: Readonly<Record<SendProgressPhase, string>> = {
  waiting: 'Waiting for your last payment to finish…',
  preparing: 'Preparing…',
  approving: 'Waiting for your approval…',
  proving: 'Proving…',
  confirming: 'Confirming…',
};

/** The steps the payment engine reports, as it names them. */
export type SendProgressStep =
  | 'wallet'
  | 'deploy'
  | 'waves'
  | 'activate'
  | 'sign'
  | 'submit'
  | 'confirm';

/**
 * The engine's step, in the pill's four words.
 *
 * `submit` is build, prove, and hand over in one step, and the proof is the
 * long part of it, so it is said as proving. `confirm` is reported the moment
 * the transaction has an id: it has been handed to the network and is waiting
 * to be included. The three setup steps cannot reach a payment; if one ever
 * did, "Proving…" keeps the line moving without saying anything untrue.
 */
export function sendProgressPhase(step: SendProgressStep | null): SendProgressPhase {
  switch (step) {
    case null:
    case 'wallet':
      return 'preparing';
    case 'sign':
      return 'approving';
    case 'confirm':
      return 'confirming';
    default:
      return 'proving';
  }
}

/** Who was paid what, as the pill names it. */
export interface SendProgressSubject {
  /** The amount as it is shown, without its ticker: `10`, `0.5`. */
  readonly amount: string;
  readonly symbol: string;
  /** A `.night` name, or the shortened address that was pasted. */
  readonly recipient: string;
}

/**
 * What the Send sheet would need to be opened again on the same payment —
 * which is what "Try again" does. It is a draft, not a payment: the sheet opens
 * on it at the first step and nothing is sent until it has been reviewed and
 * confirmed again.
 */
export interface SendDraft {
  /** The sheet's own asset id: `night`, or the colour. */
  readonly assetId: string;
  /** What goes in the recipient field. */
  readonly recipient: string;
  /** Atomic units, as a decimal string, so it survives being written down. */
  readonly amount: string;
}

/** The payment this tab is running or has just finished, and nothing older. */
export type SendProgress =
  | {
      readonly kind: 'running';
      readonly subject: SendProgressSubject;
      readonly draft: SendDraft;
      /** When it was confirmed, for the progress view's elapsed time. */
      readonly startedAt: number;
      /** Whether it is still waiting for the last payment to finish. */
      readonly waiting: boolean;
    }
  | {
      readonly kind: 'sent';
      readonly subject: SendProgressSubject;
      readonly link: SendProgressLink | null;
      readonly startedAt: number;
    }
  | {
      readonly kind: 'failed';
      readonly subject: SendProgressSubject;
      readonly sentence: string;
      readonly draft: SendDraft;
      readonly startedAt: number;
    };

/** Where the finished transaction can be looked at. */
export interface SendProgressLink {
  readonly label: string;
  readonly href: string;
}

/** Everything that can happen to a payment while this tab watches it. */
export type SendProgressEvent =
  | {
      readonly type: 'start';
      readonly subject: SendProgressSubject;
      readonly draft: SendDraft;
      readonly at: number;
    }
  /**
   * The account is still finishing the last payment, and this one waits for
   * it rather than being refused; `turn` is the moment it goes. Both are about
   * a RUNNING payment and are ignored otherwise.
   */
  | { readonly type: 'waiting' }
  | { readonly type: 'turn' }
  | { readonly type: 'sent'; readonly link: SendProgressLink | null }
  | {
      readonly type: 'failed';
      readonly sentence: string;
      /**
       * Whether the payment had already been handed to the network when it
       * stopped. It then has a written record with a transaction id, and the
       * chain — not this tab — says what it came to, so this tab's own
       * failure is set aside and the record is what the pill shows.
       */
      readonly handedOver: boolean;
    }
  | { readonly type: 'dismiss' };

/**
 * The one transition function.
 *
 * `sent` and `failed` are answers to a RUNNING payment and are ignored
 * otherwise: an answer that arrives after the reader has already moved on is
 * not news about anything on screen. A running payment cannot be dismissed —
 * there is nothing to put away while the money is moving, and a pill that
 * could be closed over a payment still in flight would be hiding the one thing
 * it is for.
 */
export function sendProgressReduce(
  state: SendProgress | null,
  event: SendProgressEvent,
): SendProgress | null {
  switch (event.type) {
    case 'start':
      return {
        kind: 'running',
        subject: event.subject,
        draft: event.draft,
        startedAt: event.at,
        waiting: false,
      };
    case 'waiting':
    case 'turn':
      return state?.kind === 'running' && state.waiting !== (event.type === 'waiting')
        ? { ...state, waiting: !state.waiting }
        : state;
    case 'sent':
      return state?.kind === 'running'
        ? { kind: 'sent', subject: state.subject, link: event.link, startedAt: state.startedAt }
        : state;
    case 'failed':
      if (state?.kind !== 'running') return state;
      if (event.handedOver) return null;
      return {
        kind: 'failed',
        subject: state.subject,
        sentence: event.sentence,
        draft: state.draft,
        startedAt: state.startedAt,
      };
    case 'dismiss':
      return state?.kind === 'running' ? state : null;
  }
}

/** "Sending 10 mUSD to alice.night". */
export function sendingLine(subject: SendProgressSubject): string {
  return `Sending ${subject.amount} ${subject.symbol} to ${subject.recipient}`;
}

/** "Sent 10 mUSD to alice.night". */
export function sentLine(subject: SendProgressSubject): string {
  return `Sent ${subject.amount} ${subject.symbol} to ${subject.recipient}`;
}

/**
 * A payment written down by an earlier visit, as far as this file needs it.
 *
 * `submitted` is whether the record carries a transaction id. Without one the
 * payment was abandoned before anything was handed over — the approval was
 * dismissed, the tab was closed, the proof never came back — and nothing left
 * the account; `sentence` is the host's own words for that.
 */
export interface SendProgressRecord {
  readonly subject: SendProgressSubject;
  readonly draft: SendDraft;
  /** When the payment was started, as the record wrote it down. */
  readonly startedAt: number;
  readonly submitted: boolean;
  readonly sentence: string;
}

/** What the pill and the live row paint. */
export interface SendProgressView {
  readonly kind: 'running' | 'sent' | 'failed';
  /** The first line: who, what, and how much. */
  readonly title: string;
  /** The live phase while running; the one sentence when it failed. */
  readonly detail: string | null;
  readonly phase: SendProgressPhase | null;
  readonly link: SendProgressLink | null;
  /** The sheet's draft, for "Try again". Only on a failure. */
  readonly retry: SendDraft | null;
  /** Who the payment is for, for the one line that explains a waiting Review. */
  readonly recipient: string;
  /** Who was paid what, for the progress view's summary. */
  readonly subject: SendProgressSubject;
  /** When the payment was started, for the progress view's elapsed time. */
  readonly startedAt: number;
}

/**
 * The view, from the payment this tab is running and the record on disk.
 *
 * THIS TAB'S PAYMENT WINS while there is one: it knows the live step, which a
 * record does not. With none, a record left by an earlier visit is shown —
 * as confirming when it was handed over (the host asks the chain and clears
 * the record when it answers), and as the failure it is when it was not.
 */
export function sendProgressView(input: {
  readonly progress: SendProgress | null;
  readonly step: SendProgressStep | null;
  readonly record: SendProgressRecord | null;
}): SendProgressView | null {
  const { progress, record } = input;
  if (progress?.kind === 'running') {
    const phase = progress.waiting ? 'waiting' : sendProgressPhase(input.step);
    return {
      kind: 'running',
      title: sendingLine(progress.subject),
      detail: SEND_PROGRESS_PHASE_LABEL[phase],
      phase,
      link: null,
      retry: null,
      recipient: progress.subject.recipient,
      subject: progress.subject,
      startedAt: progress.startedAt,
    };
  }
  if (progress?.kind === 'sent') {
    return {
      kind: 'sent',
      title: sentLine(progress.subject),
      detail: null,
      phase: null,
      link: progress.link,
      retry: null,
      recipient: progress.subject.recipient,
      subject: progress.subject,
      startedAt: progress.startedAt,
    };
  }
  if (progress?.kind === 'failed') {
    return {
      kind: 'failed',
      title: sendingLine(progress.subject),
      detail: progress.sentence,
      phase: null,
      link: null,
      retry: progress.draft,
      recipient: progress.subject.recipient,
      subject: progress.subject,
      startedAt: progress.startedAt,
    };
  }
  if (record === null) return null;
  if (record.submitted) {
    return {
      kind: 'running',
      title: sendingLine(record.subject),
      detail: SEND_PROGRESS_PHASE_LABEL.confirming,
      phase: 'confirming',
      link: null,
      retry: null,
      recipient: record.subject.recipient,
      subject: record.subject,
      startedAt: record.startedAt,
    };
  }
  return {
    kind: 'failed',
    title: sendingLine(record.subject),
    detail: record.sentence,
    phase: null,
    link: null,
    retry: record.draft,
    recipient: record.subject.recipient,
    subject: record.subject,
    startedAt: record.startedAt,
  };
}

/**
 * Why a second payment has to wait, in one line, or null when it need not.
 *
 * THE SAFER OF THE TWO ANSWERS. The account allows one payment at a time and
 * its own lock already refuses a second — but a second payment planned now is
 * planned against coins the first one is spending, and one started "after the
 * current one" would be carrying a plan that may no longer be true by the time
 * it runs. So the sheet may be opened and filled in, and its Review waits,
 * rather than queueing a payment nobody will get to review again.
 *
 * A payment confirmed once this says nothing — the pill has said "Sent" and
 * the account is still writing down what the last one kept — has been
 * reviewed, and waits BEFORE anything about it is planned (2026/09/26): see
 * `awaitCustodyTurn` in `./custodyScreenRules.ts`.
 */
export function sendInFlightReason(view: SendProgressView | null): string | null {
  if (view === null || view.kind !== 'running') return null;
  return `Your payment to ${view.recipient} is still going through. You can send again once it has finished.`;
}

/** The steps the progress view lists, in order, ending in Sent. */
export const SEND_PROGRESS_STEPS: readonly { readonly key: SendProgressPhase | 'sent'; readonly label: string }[] = [
  { key: 'preparing', label: 'Preparing' },
  { key: 'approving', label: 'Waiting for your approval' },
  { key: 'proving', label: 'Proving' },
  { key: 'confirming', label: 'Confirming' },
  { key: 'sent', label: 'Sent' },
];

/** The step a waiting payment is on, as the progress view lists it. */
export const SEND_WAITING_STEP_LABEL = 'Waiting for your last payment';

/** One step of the progress view's list, and where the payment is against it. */
export interface SendProgressStepRow {
  readonly key: SendProgressPhase | 'sent';
  readonly label: string;
  readonly state: 'done' | 'current' | 'waiting';
}

/**
 * The progress view's step list, from the view.
 *
 * Every step before the current one is done, and a Sent payment has done them
 * all. Approval is a step a Passport may not need — a key already held in this
 * tab skips it — so it reads done once anything after it is. A FAILED payment
 * claims no step at all: it was never handed over, so nothing on the list
 * happened in any sense a reader cares about, and its one sentence says so.
 */
export function sendProgressSteps(view: SendProgressView): SendProgressStepRow[] {
  const order = SEND_PROGRESS_STEPS.map((step) => step.key);
  const at =
    view.kind === 'sent'
      ? order.length
      : view.kind === 'running'
        ? order.indexOf(view.phase ?? 'preparing')
        : -1;
  const steps = SEND_PROGRESS_STEPS.map((step, index): SendProgressStepRow => ({
    key: step.key,
    label: step.label,
    state: at < 0 || index > at ? 'waiting' : index < at ? 'done' : 'current',
  }));
  /* A PAYMENT WAITING FOR THE LAST ONE (2026/09/26) has done none of the five
     and is on a step the list does not otherwise have, so that step is put in
     front of the five, as the current one, for as long as it lasts. */
  if (view.phase === 'waiting') {
    return [{ key: 'waiting', label: SEND_WAITING_STEP_LABEL, state: 'current' }, ...steps];
  }
  return steps;
}

/** "12 s", "1 min 05 s" — elapsed time, said plainly. */
export function sendElapsed(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${String(seconds % 60).padStart(2, '0')} s`;
}

/** How long "Sent" stays on the pill before it goes by itself. */
export const SEND_SENT_DISMISS_MS = 6_000;

/**
 * Whether the payment on screen is running and has NOT yet been handed to the
 * network (2026/09/26) — the window in which closing Passport stops it.
 *
 * `confirming` is the first moment the transaction has left this tab (see
 * {@link sendProgressPhase}); every phase before it is work this tab is still
 * doing. A view read back from a record is either confirming — it was handed
 * over — or a failure, so a reload is never inside the window: whatever that
 * payment came to, it came to without this tab.
 */
export function sendUnsent(view: SendProgressView | null): boolean {
  return view !== null && view.kind === 'running' && view.phase !== 'confirming';
}

/** What the progress surfaces say about closing Passport. */
export interface SendClosingNote {
  /** The progress sheet's line under "Sending". */
  readonly sheet: string;
  /** The live row's line under the phase. */
  readonly row: string;
  /** The pill's few words beside the phase, or null for none. */
  readonly pill: string | null;
}

/**
 * WHAT CLOSING PASSPORT DOES TO A RUNNING PAYMENT, SAID PLAINLY (2026/09/26).
 *
 * Hector: people should be asked to keep Passport open while a payment is being
 * made. The sheet used to say "You can close this and keep using your
 * Passport. It carries on." — true of the SHEET, and read as true of the app.
 * Closing the app before the payment is handed over stops it.
 *
 * ONCE IT HAS BEEN HANDED OVER, the opposite is true and is said: the
 * transaction is the network's, and the next open of Passport reads its record
 * back and asks the chain what it came to (`e2e/provider-recovery.spec.ts`, "a
 * Passport opened again after a payment"). Closing Passport does not stop it.
 * The pill says nothing then — it is the compact surface, and it only ever
 * asks for something.
 *
 * Null for an outcome: there is nothing left to keep open for.
 */
export function sendClosingNote(view: SendProgressView): SendClosingNote | null {
  if (view.kind !== 'running') return null;
  if (sendUnsent(view)) {
    return {
      sheet: 'Keep Passport open until this is sent. You can close this sheet.',
      row: 'Keep Passport open until this is sent.',
      pill: 'Keep Passport open',
    };
  }
  return {
    sheet: 'It has been handed to the network. Closing Passport now will not stop it.',
    row: 'Closing Passport now will not stop it.',
    pill: null,
  };
}
