/**
 * WHEN TO READ THE ACCOUNT AGAIN, SO A BALANCE STOPS NEEDING A RELOAD.
 *
 * THE DEFECT THIS IS THE PURE HALF OF
 * -----------------------------------
 * Reported 2026/09/02: "The mUSD balance was never updated to 100; after I
 * refresh the page the 100 mUSD appeared", and, from the other side of a
 * transfer, "the recipient's balance did not update automatically after a
 * send". Both are the same shape of mistake, made in two places:
 *
 *   THE SPONSOR'S ANSWER IS NOT THE LEDGER. Activation asks the sponsor for an
 *   opening balance and re-reads the account the instant the sponsor answers
 *   200. The sponsor answers when it has SUBMITTED the deposit; the figure the
 *   screen reads comes from the chain a beat later. One read, taken at exactly
 *   the wrong moment, is a read of the state before the deposit — and nothing
 *   ever read again, so the opening balance sat at zero until the reader
 *   reloaded the page themselves.
 *
 *   NOBODY TELLS YOU MONEY ARRIVED. Every read this app made was a
 *   consequence of something the READER had just done. An amount somebody else
 *   sends lands with no local event to hang a read off at all, so a Passport
 *   left open showed a stale figure indefinitely.
 *
 * So the account is WATCHED. Two cadences, because the two facts above want
 * different ones:
 *
 *   CHASING — something has been announced and the figure has not moved yet.
 *   Read after {@link BALANCE_WATCH_CHASE_FIRST_MS}, then further apart on each
 *   attempt up to {@link BALANCE_WATCH_CHASE_CEILING_MS}, for at most
 *   {@link BALANCE_WATCH_CHASE_WINDOW_MS} — the same ten minutes the activation
 *   grant's own retry schedule is given, because that is how long the thing
 *   being chased can honestly take. The chase ends the moment the holdings
 *   change, which is the only evidence that what was announced has landed.
 *
 *   STEADY — nothing is expected, but a transfer from someone else can arrive
 *   at any time. Every {@link BALANCE_WATCH_STEADY_MS} while the screen is in
 *   front of somebody. Slow on purpose: it is a courtesy, not a subscription,
 *   and a Passport left open on a desk should not be a load generator.
 *
 * WITH A CHEAP LOOK (2026/09/25), both cadences change shape. Where the screen
 * can ask "has anything landed on this account since it was last read?" for a
 * hundred bytes, it does, every {@link BALANCE_WATCH_LOOK_FIRST_MS} — further
 * apart, up to {@link BALANCE_WATCH_LOOK_CEILING_MS}, while the answer stays no
 * and nothing is being chased. The whole read — the account's state, 64 KB on
 * stagenet and 152 KB in the recorded fixture, a ledger decode, and the
 * delivery walk — happens only when the answer is yes, or when
 * {@link accountReadDue} says one is owed anyway: every
 * {@link BALANCE_WATCH_STEADY_MS} while a chase runs or a coin waits for its
 * position, and otherwise as a safety net. Measured on a Samsung phone left on
 * Home, that read twice a minute was most of the network the tab used and a
 * good part of its main thread, while a payment somebody else made could sit
 * unseen for thirty seconds; with the look it shows within about five, for a
 * fraction of the bytes. A screen with no look keeps both cadences above.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It never invents a figure. A watch only decides WHEN to ask; what comes back
 * is whatever the account itself says, and a reading that has not arrived is
 * shown as on its way, never as money. It also never runs while the document
 * is hidden — a backgrounded tab's timers are throttled to something between
 * useless and dishonest, so the watch pauses and reads once on the way back.
 *
 * There is no DOM and no React in here, on the same principle as
 * `feeReadinessPoll.ts`: a controller with injected timers and an injected
 * clock is a thing a test can drive with `vi.useFakeTimers()`, and this
 * workspace has no jsdom to render a hook into. The React glue that owns the
 * `visibilitychange` listener is `src/screens/useBalanceWatch.ts`.
 */

/** The first chase read, and the floor for every one after it. */
export const BALANCE_WATCH_CHASE_FIRST_MS = 5_000;

/**
 * The longest gap a chase will grow to.
 *
 * The backoff exists so ten minutes of chasing is not a hundred and twenty
 * reads; the ceiling exists so the tail of a chase is still quicker than the
 * steady cadence, which would otherwise overtake it and make the last minutes
 * of a chase slower than not chasing at all.
 */
export const BALANCE_WATCH_CHASE_CEILING_MS = 20_000;

/**
 * How long a chase may run before it gives up and falls back to steady.
 *
 * Ten minutes, matching the activation grant's own retry schedule in
 * `App.tsx`: the grant is the slowest thing that is ever chased, and a chase
 * that expired first would leave the one case it was written for uncovered.
 */
export const BALANCE_WATCH_CHASE_WINDOW_MS = 10 * 60_000;

/** The cadence when nothing in particular is expected. */
export const BALANCE_WATCH_STEADY_MS = 30_000;

/**
 * How long the watch stands off while the Passport is in the middle of
 * something, before asking again whether it still is.
 *
 * WHY A WATCH STANDS OFF AT ALL (2026/09/03). A read of the account is not
 * free: it is an indexer round trip and a ledger-state decode, and the timer
 * this module owns is the only read in the app that can land in the middle of
 * a proving run rather than following something the reader did. A shielded leg
 * is already the largest allocation Passport ever makes — 19.5 MB of prover
 * key per artefact read, RSS 330 MB at rest against 787 MB mid-leg, measured
 * on stagenet — and a browser died in that window on 2026/09/03 at 16:30:46
 * UTC. A courtesy read has no business being the thing on top.
 *
 * DEFERRED, NEVER DROPPED. The read that was due is taken as soon as the work
 * releases, so nothing this watch exists for is lost: the opening balance that
 * 2026/09/02's report was about lands DURING activation, which is exactly a
 * busy stretch, and a watch that skipped its read there would have been a
 * regression dressed as an optimisation. Two seconds, because that is short
 * against every cadence here and long enough that standing off is not itself a
 * poll.
 */
export const BALANCE_WATCH_BUSY_STANDOFF_MS = 2_000;

/** How the growth between chase reads is shaped. Gentle: 5s, 7.5s, 11.2s… */
const CHASE_GROWTH = 1.5;

/**
 * The first cheap look, and the one after anything has moved.
 *
 * Three seconds, so that a payment landing on an account somebody is looking
 * at shows within a few seconds of the indexer having it — the bar a person
 * holding two phones side by side actually applies.
 */
export const BALANCE_WATCH_LOOK_FIRST_MS = 3_000;

/**
 * The widest the cheap looks grow while nothing moves.
 *
 * The backoff is real but short, on purpose: a look is one small POST, and the
 * ceiling is what bounds how late an unannounced payment can be. Five seconds
 * plus a round trip is still "a few seconds".
 */
export const BALANCE_WATCH_LOOK_CEILING_MS = 5_000;

/**
 * The longest the whole read is left undone while every look says nothing
 * moved — a safety net rather than a cadence.
 *
 * Nothing about the account can change without a new action on it, so in
 * principle the look is enough. The net is there for what is not an action:
 * a coin whose position the indexer had not answered for yet, and an indexer
 * that answered the look from a replica a block behind the one that answers
 * the state.
 */
export const BALANCE_WATCH_QUIET_READ_MS = 5 * 60_000;

/** How the gap between cheap looks grows: 3s, 4.5s, then the ceiling. */
const LOOK_GROWTH = 1.5;

/**
 * How long to wait before the next cheap look.
 *
 * `quietLooks` is how many looks in a row have found nothing to read. Any look
 * that did read puts it back to zero, because an account that just moved is
 * the one most likely to move again — a send's change, a second payment.
 */
export function nextLookDelayMs(quietLooks: number): number {
  const grown = BALANCE_WATCH_LOOK_FIRST_MS * LOOK_GROWTH ** Math.max(0, quietLooks);
  return Math.round(Math.min(grown, BALANCE_WATCH_LOOK_CEILING_MS));
}

/**
 * Whether a cheap look should go on to read the whole account.
 *
 * `head` is what the look was just told about the newest action on the
 * account, `headAtLastRead` what it was told before the last whole read began.
 * Both are opaque: equal means nothing has landed since, different means
 * something has, and `null` is a look that could not be answered.
 *
 *   - An unanswered look proves nothing either way, so the read falls back to
 *     the steady cadence it would have had without a look at all. A build whose
 *     indexer cannot answer the look is therefore exactly as fresh as before.
 *     So does a last read that could not fetch the state: retrying it every
 *     few seconds because the head "moved" would turn an indexer that is
 *     failing into one that is being hammered.
 *   - A head that moved is the whole point: read now.
 *   - A coin already delivered but not yet placed is settled by the indexer
 *     answering a question about an OLD transaction, which moves no head. While
 *     one is waiting, the steady cadence applies, as it always did. So it does
 *     while a chase runs: what is announced almost always lands as an action
 *     on the account, which the look sees within seconds, and the steady read
 *     is there for whatever does not — a payment of this Passport's own that
 *     never landed, taken back by the read's reconciliation.
 *   - Otherwise the safety net, {@link BALANCE_WATCH_QUIET_READ_MS}.
 */
export function accountReadDue(input: {
  head: string | null;
  headAtLastRead: string | null;
  sinceLastReadMs: number;
  arriving: boolean;
  /** The watch is chasing something announced. See below. */
  chasing?: boolean;
  /** The last read could not fetch the state. See below. */
  lastReadFailed?: boolean;
}): boolean {
  if (input.head === null || input.lastReadFailed === true) {
    return input.sinceLastReadMs >= BALANCE_WATCH_STEADY_MS;
  }
  if (input.head !== input.headAtLastRead) return true;
  if (input.arriving || input.chasing === true) {
    return input.sinceLastReadMs >= BALANCE_WATCH_STEADY_MS;
  }
  return input.sinceLastReadMs >= BALANCE_WATCH_QUIET_READ_MS;
}

/**
 * The cheap look, as an indexer request body: the newest action on one
 * contract, and nothing about it but the transaction it came in.
 *
 * `contractAction(address:)` with no offset is the latest action, the same
 * field midnight-js's own `LATEST_CONTRACT_TX_BLOCK_HEIGHT_QUERY` asks; and
 * `transaction { hash }` is the selection `custodyActionHistoryQuery` has
 * asked this indexer for since 2026/09/18. No `state` — that one field is
 * the 64 KB this exists to avoid. The address travels as a variable, so there
 * is nothing to escape.
 */
export function accountHeadRequest(address: string): string {
  return JSON.stringify({
    operationName: 'PassportAccountHead',
    query:
      'query PassportAccountHead($address: HexEncoded!) { contractAction(address: $address) { transaction { hash } } }',
    variables: { address },
  });
}

/**
 * The head a look answered with, or null where the answer says nothing usable.
 *
 * An account with no action at all answers `none` rather than null: that is a
 * real, comparable answer ("nothing yet"), where null means "could not tell".
 * An answer with errors is null even if some data came back — half an answer
 * is not one to compare against.
 */
export function accountHeadFrom(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const envelope = body as { data?: unknown; errors?: unknown };
  if (Array.isArray(envelope.errors) && envelope.errors.length > 0) return null;
  if (!envelope.data || typeof envelope.data !== 'object') return null;
  if (!('contractAction' in envelope.data)) return null;
  const action = (envelope.data as { contractAction?: unknown }).contractAction;
  if (action === null) return 'none';
  if (!action || typeof action !== 'object') return null;
  const transaction = (action as { transaction?: unknown }).transaction;
  if (!transaction || typeof transaction !== 'object') return null;
  const hash = (transaction as { hash?: unknown }).hash;
  return typeof hash === 'string' && hash.length > 0 ? hash : null;
}

/** How long a look may take before it counts as unanswered. */
export const ACCOUNT_HEAD_TIMEOUT_MS = 8_000;

/**
 * Asks the indexer for an account's head. Never throws: a look that could not
 * be made is `null`, which {@link accountReadDue} treats as "cannot tell".
 *
 * `fetch` is injected for the drills; the app passes nothing and gets the
 * browser's.
 */
export async function readAccountHead(
  indexerHttpUrl: string,
  address: string,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<string | null> {
  const request = options.fetch ?? ((input, init) => fetch(input, init));
  try {
    const response = await request(indexerHttpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: accountHeadRequest(address),
      signal: AbortSignal.timeout(options.timeoutMs ?? ACCOUNT_HEAD_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return accountHeadFrom(await response.json());
  } catch {
    return null;
  }
}

/** Everything the delay rule needs to know about where a watch has got to. */
export interface BalanceProbeSchedule {
  /** True while something has been announced and the holdings have not moved. */
  chasing: boolean;
  /** Chase reads already made in this run. `0` before the first one. */
  attempt: number;
  /** Milliseconds since this chase began. Ignored when not chasing. */
  elapsedMs: number;
}

/**
 * A chase that has run out of its window.
 *
 * Separate from the delay rule because the controller has to ACT on it — the
 * chase is abandoned, not merely slowed — and a caller that only read the
 * delay back would keep an expired chase alive forever at the steady cadence
 * while still calling itself chasing.
 */
export function chaseIsSpent(elapsedMs: number): boolean {
  return elapsedMs >= BALANCE_WATCH_CHASE_WINDOW_MS;
}

/**
 * How long to wait before reading the account again.
 *
 * An expired chase gets the steady cadence rather than a chase one, so a
 * controller that has not yet noticed the window is spent still cannot poll
 * quickly forever.
 */
export function nextBalanceProbeDelayMs(schedule: BalanceProbeSchedule): number {
  if (!schedule.chasing) return BALANCE_WATCH_STEADY_MS;
  if (chaseIsSpent(schedule.elapsedMs)) return BALANCE_WATCH_STEADY_MS;
  const grown = BALANCE_WATCH_CHASE_FIRST_MS * CHASE_GROWTH ** Math.max(0, schedule.attempt);
  return Math.round(Math.min(grown, BALANCE_WATCH_CHASE_CEILING_MS));
}

/**
 * What the account holds, as the screens are handed it.
 *
 * A subset of Home's `account` prop rather than an import of it: this module
 * is in the coverage denominator and the screen's prop type is a `.tsx` away,
 * and the only thing the watch needs from a balance is whether it CHANGED.
 */
export interface HoldingsSnapshot {
  /** Formatted NIGHT. `null` is "not known", never a zero. */
  nightBalance: string | null;
  stablecoin: { colourHex: string; amount: bigint } | null;
  otherShielded: readonly { colourHex: string; amount: bigint }[];
}

/**
 * A fingerprint of what an account holds, for "has it moved yet".
 *
 * Sorted by colour, so the same holdings read twice cannot fingerprint
 * differently because the indexer returned them in another order — a chase
 * that ended on a re-ordering would end on nothing having happened.
 *
 * An unknown NIGHT figure fingerprints as `?`, distinct from a real `0`: a
 * read that failed and an account that is empty are different facts, and a
 * chase must not treat "the read came back broken" as "the money arrived".
 */
export function holdingsSignature(account: HoldingsSnapshot | null): string {
  if (!account) return 'no-account';
  const colours = [
    ...(account.stablecoin ? [account.stablecoin] : []),
    ...account.otherShielded,
  ]
    .map((held) => `${held.colourHex}:${held.amount}`)
    .sort();
  return `night=${account.nightBalance ?? '?'}|${colours.join(',')}`;
}

/** Which legs of the sponsor's opening grant this account is already holding. */
export interface OpeningBalanceLegs {
  /** The opening NIGHT. */
  night: boolean;
  /** The opening stablecoin. */
  stablecoin: boolean;
}

/**
 * Which halves of the opening balance have landed.
 *
 * The question the opening-balance line asks, and until 2026/09/04 it asked a
 * coarser one — "does this account hold anything at all" — which went true on
 * whichever of the two deposits arrived first and retired the row while the
 * other was still coming. See `openingBalanceOnTheWay` in `lib/activation.ts`
 * for what the audit watched that do.
 *
 * A `null` NIGHT figure is NOT a zero — it is a figure nobody has read yet — so
 * it answers false here for the same reason it fingerprints as `?` above.
 *
 * A `null` stablecoin answers TRUE, and that is deliberate: `null` means this
 * build's sponsor has named no stablecoin colour, so there is no second deposit
 * to wait for and the NIGHT leg is the whole grant. A colour that IS named but
 * sits at zero is a deposit that has not arrived, and answers false.
 *
 * Other shielded colours are not consulted at all. The grant is these two
 * assets; a colour somebody else sent is not one of them, and counting it would
 * retire the row on money that has nothing to do with the sponsor.
 */
export function openingBalanceLegsHeld(account: HoldingsSnapshot | null): OpeningBalanceLegs {
  if (!account) return { night: false, stablecoin: false };
  return {
    night: account.nightBalance !== null && account.nightBalance !== '0',
    stablecoin: account.stablecoin === null || account.stablecoin.amount > 0n,
  };
}

export interface BalanceWatchOptions {
  /**
   * Re-reads the account. A rejection is swallowed: a read that failed is not
   * news the watch can act on, and the next tick will ask again.
   */
  refresh: () => void | Promise<void>;
  /** The holdings fingerprint RIGHT NOW. Read after each probe settles. */
  signature: () => string;
  /**
   * The cheap look, where the screen has one: asks whether anything has landed
   * and reads the account only if so — or if {@link accountReadDue} says a read
   * is owed, which is why it is told whether a chase is running — answering
   * whether it read. Given, every tick is a look: every
   * {@link BALANCE_WATCH_LOOK_FIRST_MS} while chasing, backing off to
   * {@link BALANCE_WATCH_LOOK_CEILING_MS} otherwise. Absent, every tick is a
   * full `refresh` on the cadences above, as before. A rejection counts as
   * "did not read".
   */
  look?: (context: { chasing: boolean }) => boolean | Promise<boolean>;
  /**
   * Whether the Passport is in the middle of something a read must not be
   * piled on top of — see {@link BALANCE_WATCH_BUSY_STANDOFF_MS}. Defaults to
   * "never busy", so a caller that does not know keeps the old behaviour.
   */
  busy?: () => boolean;
  /** Defaults to `Date.now`. */
  now?: () => number;
  /** Defaults to `setTimeout`. Returns whatever handle `clearTimer` takes. */
  setTimer?: (run: () => void, delayMs: number) => unknown;
  /** Defaults to `clearTimeout`. */
  clearTimer?: (handle: unknown) => void;
}

export interface BalanceWatch {
  /**
   * Something has been announced — an opening balance, a send, a row on the
   * trail that was not there a moment ago. Starts (or restarts) a chase from
   * the fingerprint as it stands now.
   */
  expectChange: () => void;
  /** The document went away, or the screen did. No reads until `resume`. */
  pause: () => void;
  /** Back in front of somebody: read once now, then carry on. */
  resume: () => void;
  /** For good. Any read in flight is ignored when it lands. */
  stop: () => void;
  /** Whether a chase is running. For drills, and for a screen that asks. */
  chasing: () => boolean;
}

/**
 * Starts watching an account.
 *
 * The first read is scheduled, not immediate: every caller has just read the
 * account itself — that is what put the screen on screen — and an immediate
 * second read would be the same answer twice. `resume` is the exception, and
 * deliberately so: a tab coming back from the background has been showing a
 * figure that stopped being watched, and the first thing it owes the reader is
 * a fresh one. With a cheap look that fresh one is the look, which reads in
 * full only if something landed while the tab was away.
 *
 * Each read — and each look — is scheduled after the previous one SETTLED,
 * never on a fixed clock, so a slow indexer cannot be asked twice at once.
 */
export function startBalanceWatch(options: BalanceWatchOptions): BalanceWatch {
  const now = options.now ?? (() => Date.now());
  const busy = options.busy ?? ((): boolean => false);
  const setTimer =
    options.setTimer ?? ((run: () => void, delayMs: number) => setTimeout(run, delayMs));
  const clearTimer =
    options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let stopped = false;
  let paused = false;
  let inFlight = false;
  let timer: unknown = null;
  let chasing = false;
  let chaseStartedAt = 0;
  let chaseAttempt = 0;
  /* The fingerprint the chase is measured against — what the account held when
     the announcement was made. The chase ends when the account stops matching
     it, which is the only evidence available that the thing landed. */
  let chaseBaseline = '';
  /* With a look: how many looks in a row have found nothing to read. A chase
     does not let them back off. */
  const look = options.look;
  let quietLooks = 0;

  const cancel = (): void => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const schedule = (delayMs?: number): void => {
    if (stopped || paused) return;
    cancel();
    const delay =
      delayMs ??
      (look !== undefined
        ? nextLookDelayMs(chasing ? 0 : quietLooks)
        : nextBalanceProbeDelayMs({
            chasing,
            attempt: chaseAttempt,
            elapsedMs: now() - chaseStartedAt,
          }));
    timer = setTimer(() => {
      timer = null;
      void probe();
    }, delay);
  };

  const probe = async (): Promise<void> => {
    if (stopped || paused || inFlight) return;
    /* STOOD OFF, NOT SKIPPED. The read that was due is taken as soon as the
       work releases — the chase keeps its baseline, its clock, and its attempt
       count, so a stretch of busy costs the chase nothing but the standoff. */
    if (busy()) {
      schedule(BALANCE_WATCH_BUSY_STANDOFF_MS);
      return;
    }
    inFlight = true;
    if (chasing) chaseAttempt += 1;
    let read = false;
    try {
      if (look === undefined) await options.refresh();
      else read = (await look({ chasing })) === true;
    } catch {
      /* A read that could not be made says nothing about the money. The screen
         shows its own unavailable state; the watch simply asks again. A look
         that threw read nothing. */
    } finally {
      inFlight = false;
      if (!stopped) {
        /* Two ways a chase ends: the figure moved, or the window is spent. */
        if (chasing && (options.signature() !== chaseBaseline || chaseIsSpent(now() - chaseStartedAt))) {
          chasing = false;
        }
        quietLooks = read ? 0 : quietLooks + 1;
        schedule();
      }
    }
  };

  schedule();

  return {
    expectChange: (): void => {
      if (stopped) return;
      chasing = true;
      chaseAttempt = 0;
      chaseStartedAt = now();
      chaseBaseline = options.signature();
      schedule();
    },
    pause: (): void => {
      if (stopped || paused) return;
      paused = true;
      cancel();
    },
    resume: (): void => {
      if (stopped || !paused) return;
      paused = false;
      void probe();
    },
    stop: (): void => {
      stopped = true;
      cancel();
    },
    chasing: (): boolean => chasing,
  };
}
