/**
 * The opening balance, paid by the sponsor ON ITS OWN the moment a custody
 * Passport is activated — without waiting for the phone to ask.
 *
 * WHY (2026/09/24–25). The phone asks `/fund-account` only after its background
 * maintenance waves (updates 2–4, the k256 and grant circuits) have landed,
 * which needs the page alive for two to three minutes after Home. On Android a
 * Chrome tab that goes to the background stalls there, and a reviewer who
 * switched to another app waited more than ten minutes for an opening balance
 * that nothing on the sponsor's side was waiting on. The sponsor already knows
 * the account's address when the phone asks for its `.night` name, at deploy
 * time; this watches that account until it is activated on chain and then runs
 * the SAME funding flow `/fund-account` runs.
 *
 * WHAT KEEPS IT SAFE, and where each property lives:
 *
 *   - ONCE PER ACCOUNT. The funding itself is `/fund-account`'s own function,
 *     so it is gated by `/fund-account`'s own once-only ledger (per leg,
 *     persisted), its in-flight lock, and its hourly ceiling. This module adds
 *     only one more in-memory guard — one watch per address per process — so a
 *     repeated name claim cannot start a second watch.
 *   - CUSTODY ONLY. Nothing is funded unless a read of the account says it is
 *     the account custody build AND activated. A prototype account (production
 *     v1.1 still uses them against this same sponsor) is recognised on its
 *     first readable state and dropped silently: no spend, no line in the
 *     journal, no change to anything it is answered.
 *   - BOUNDED. The watch gives up after `windowMs` (ten minutes by default) and
 *     says so; the phone's `/fund-account` still works after that, exactly as
 *     it did before this existed.
 *   - OFF SWITCH. `BALANCER_FUND_ON_ACTIVATION=0` and nothing here runs.
 *
 * Everything that touches the chain or the wallet is injected, so every rule
 * above is drilled in `test/fundOnActivation.test.ts` without either.
 */

/** What one read of the account says. */
export type ActivationProbe =
  /** The account custody build, with a device activated: fund it now. */
  | { kind: 'activated' }
  /** The account custody build, deployed but not activated yet: keep waiting. */
  | { kind: 'not-activated' }
  /** No state served yet (the deploy is not indexed), or the read failed: keep waiting. */
  | { kind: 'not-yet-readable'; why?: string }
  /** Any other build — a prototype account. Never touched. */
  | { kind: 'not-custody' }
  /** This host cannot serve the custody build at all. Waiting changes nothing. */
  | { kind: 'unservable'; why: string };

/** `/fund-account`'s own answer, unchanged. */
export interface FundOutcome {
  status: number;
  body: Record<string, unknown>;
}

export interface FundOnActivationOptions {
  /** `BALANCER_FUND_ON_ACTIVATION`. When false, {@link FundOnActivation.watch} does nothing. */
  readonly enabled: boolean;
  /** Reads the account once. Must not throw; a failed read is `not-yet-readable`. */
  probe(address: string): Promise<ActivationProbe>;
  /** Runs `/fund-account`'s flow for this account, as the sponsor itself. */
  fund(address: string): Promise<FundOutcome>;
  /** `true` when this service's own ledger already records the whole opening balance. */
  isFunded(address: string): boolean;
  /** How long a watch may last in all, from the moment it starts. Ten minutes by default. */
  readonly windowMs?: number;
  /** The first pause between reads. Five seconds by default. */
  readonly firstDelayMs?: number;
  /** The longest pause between reads. Thirty seconds by default. */
  readonly maxDelayMs?: number;
  /** How many times the funding itself may be run for one account. Four by default. */
  readonly maxFundAttempts?: number;
  /**
   * How many accounts may be watched at once. Fifty by default — far above
   * the sign-ups an hour this service pays for — so a caller posting name
   * claims for made-up addresses cannot make it hold thousands of watches.
   */
  readonly maxWatches?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly log?: (line: string) => void;
  readonly warn?: (line: string) => void;
}

/** Why a watch was or was not started. */
export type WatchAnswer = 'watching' | 'already-watching' | 'already-funded' | 'full' | 'off';

export interface FundOnActivation {
  /**
   * Starts watching one account, unless it is already watched, already funded,
   * or the switch is off. Never throws and never waits: the watch runs in the
   * background and the caller's request goes on exactly as before.
   */
  watch(address: string, because: string): WatchAnswer;
  /** `true` while this service is running the funding for `address` itself. */
  isFunding(address: string): boolean;
  /** How many accounts are being watched right now, for `/status` and the journal. */
  watching(): number;
  /** Resolves once every watch running now has ended. For the tests and a clean stop. */
  settled(): Promise<void>;
  /** Ends every watch at its next pause. */
  stop(): void;
}

export const FUND_ON_ACTIVATION_WINDOW_MS = 10 * 60_000;
const FIRST_DELAY_MS = 5_000;
const MAX_DELAY_MS = 30_000;
const MAX_FUND_ATTEMPTS = 4;
const MAX_WATCHES = 50;

/**
 * What to do with one `/fund-account` answer, from the watcher's side.
 *
 * `done` — the opening balance is in place, or somebody else is paying it.
 * `retry` — the chain, the wallet, or the ceiling may answer differently later.
 * `give-up` — the answer is about the account itself, and waiting changes nothing.
 */
export function classifyFundOutcome(outcome: FundOutcome): {
  verdict: 'done' | 'retry' | 'give-up';
  why: string;
} {
  const error = typeof outcome.body.error === 'string' ? outcome.body.error : null;
  const message = typeof outcome.body.message === 'string' ? outcome.body.message : '';
  if (outcome.status === 200) {
    const assetError = typeof outcome.body.assetError === 'string' ? outcome.body.assetError : null;
    /* A landed NIGHT leg with a failed mUSD leg is half an opening balance. The
       ledger records only the half that landed, so running it again pays the
       missing half and nothing else. */
    if (assetError) return { verdict: 'retry', why: `the mUSD half did not land: ${assetError}` };
    return { verdict: 'done', why: 'funded' };
  }
  if (error === 'already-activated' || error === 'already-funded') {
    return { verdict: 'done', why: `already funded (${error})` };
  }
  /* The phone asked first and its funding is running now. Its answer is the
     one that counts, and a second runner behind it would only be refused. */
  if (error === 'funding-in-flight') return { verdict: 'done', why: 'the phone is funding it right now' };
  if (outcome.status === 429 || outcome.status >= 500) {
    return { verdict: 'retry', why: `${error ?? outcome.status}: ${message}` };
  }
  return { verdict: 'give-up', why: `${error ?? outcome.status}: ${message}` };
}

/**
 * What `/fund-account` answers a caller while a funding for the same account
 * is already running.
 *
 * `sponsorIsFunding` — the running one is THIS service's own, on activation.
 * That is "in progress", and it goes out as a 429 with a wait because the app
 * reads a 409 it does not know as a refusal and shows a blocked row, where a
 * 429 is "ask again shortly", and `grant-retrying` has had exactly that shape
 * since 2026/09/03. Otherwise — two callers racing — the answer is the 409 this
 * route has always given, word for word, so nothing a prototype Passport is
 * told changes.
 */
export function concurrentFundingAnswer(
  sponsorIsFunding: boolean,
  retryAfterMs: number,
): { status: number; error: string; message: string; extra?: Record<string, unknown> } {
  if (sponsorIsFunding) {
    return {
      status: 429,
      error: 'funding-on-activation',
      message:
        'This service is already paying this Passport its opening balance on its own. Ask again shortly.',
      extra: { retryAfterMs },
    };
  }
  return {
    status: 409,
    error: 'funding-in-flight',
    message:
      'A funding for this Passport is already in progress. Wait for it to finish before asking again.',
  };
}

/**
 * `Custom error: 104` — the refusal the sponsor has already been seen to get on
 * a deposit into a custody account while a maintenance wave was landing on it.
 * Rebuilt inside the deposit itself (`withNodeRejectionRetry`, three attempts);
 * named here so the journal says which refusal a further attempt is for.
 */
export function mentionsCustomError104(outcome: FundOutcome): boolean {
  const text = `${String(outcome.body.message ?? '')} ${String(outcome.body.detail ?? '')} ${String(outcome.body.assetError ?? '')}`;
  return /custom error:?\s*104\b/i.test(text);
}

export function createFundOnActivation(options: FundOnActivationOptions): FundOnActivation {
  const windowMs = options.windowMs ?? FUND_ON_ACTIVATION_WINDOW_MS;
  const firstDelayMs = options.firstDelayMs ?? FIRST_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? MAX_DELAY_MS;
  const maxFundAttempts = options.maxFundAttempts ?? MAX_FUND_ATTEMPTS;
  const maxWatches = options.maxWatches ?? MAX_WATCHES;
  const now = options.now ?? (() => Date.now());
  const sleep =
    options.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        /* A watch must never hold the process open on its own. */
        (timer as { unref?: () => void }).unref?.();
      }));
  const log = options.log ?? ((line: string) => console.log(line));
  const warn = options.warn ?? ((line: string) => console.warn(line));

  /** Every account watched by this process, running or finished — one watch each. */
  const seen = new Set<string>();
  const running = new Map<string, Promise<void>>();
  const funding = new Set<string>();
  let stopped = false;

  const run = async (address: string, because: string): Promise<void> => {
    const deadline = now() + windowMs;
    let delay = firstDelayMs;
    let announced = false;
    let fundAttempts = 0;

    const pause = async (): Promise<boolean> => {
      if (now() + delay > deadline) return false;
      await sleep(delay);
      delay = Math.min(Math.round(delay * 1.5), maxDelayMs);
      return !stopped;
    };

    for (;;) {
      if (stopped) return;
      if (options.isFunded(address)) {
        if (announced) log(`[account] ${address} is already funded — the watch ends`);
        return;
      }

      let probe: ActivationProbe;
      try {
        probe = await options.probe(address);
      } catch (cause) {
        probe = { kind: 'not-yet-readable', why: cause instanceof Error ? cause.message : String(cause) };
      }

      if (probe.kind === 'not-custody') {
        /* A prototype account. Dropped without a word: nothing about how this
           service treats one may change. */
        return;
      }
      if (probe.kind === 'unservable') {
        warn(`[account] ${address}: cannot fund on activation — ${probe.why}. The phone's /fund-account gets the same answer.`);
        return;
      }
      if (probe.kind === 'not-activated' && !announced) {
        announced = true;
        log(
          `[account] ${address} is a custody Passport that is not activated yet (${because}) — it will be funded the moment it is, for up to ${Math.round(windowMs / 60_000)} min`,
        );
      }

      if (probe.kind === 'activated') {
        fundAttempts += 1;
        log(
          `[account] funding ${address} on activation (no request from the phone needed${fundAttempts > 1 ? `; attempt ${fundAttempts} of ${maxFundAttempts}` : ''})`,
        );
        funding.add(address);
        let outcome: FundOutcome;
        try {
          outcome = await options.fund(address);
        } catch (cause) {
          outcome = {
            status: 500,
            body: { error: 'internal', message: cause instanceof Error ? cause.message : String(cause) },
          };
        } finally {
          funding.delete(address);
        }
        const { verdict, why } = classifyFundOutcome(outcome);
        if (verdict === 'done') {
          log(`[account] ${address}: funded on activation — ${why}`);
          return;
        }
        if (verdict === 'give-up') {
          warn(`[account] ${address}: funding on activation stopped — ${why}. The phone's /fund-account still works.`);
          return;
        }
        if (fundAttempts >= maxFundAttempts) {
          warn(
            `[account] ${address}: funding on activation gave up after ${fundAttempts} attempts — ${why}. The phone's /fund-account still works.`,
          );
          return;
        }
        warn(
          mentionsCustomError104(outcome)
            ? `[account] ${address}: the deposit was refused with Custom error 104, most likely while one of the phone's maintenance waves landed on the same account — trying again in ${Math.round(delay / 1_000)} s (${why})`
            : `[account] ${address}: funding on activation did not finish — trying again in ${Math.round(delay / 1_000)} s (${why})`,
        );
      }

      if (!(await pause())) {
        if (!stopped) {
          warn(
            `[account] ${address}: stopped waiting to fund on activation after ${Math.round(windowMs / 60_000)} min (${probe.kind === 'activated' ? 'the funding kept failing' : `last read: ${probe.kind}`}). The phone's /fund-account still works.`,
          );
        }
        return;
      }
    }
  };

  return {
    watch(address: string, because: string): WatchAnswer {
      if (!options.enabled || stopped) return 'off';
      if (seen.has(address)) return 'already-watching';
      if (options.isFunded(address)) return 'already-funded';
      if (running.size >= maxWatches) {
        warn(
          `[account] ${address}: not watched for its activation — ${running.size} accounts are being watched already. The phone's /fund-account still works.`,
        );
        return 'full';
      }
      seen.add(address);
      const job = run(address, because)
        .catch((cause) => {
          warn(
            `[account] ${address}: the funding-on-activation watch failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        })
        .finally(() => running.delete(address));
      running.set(address, job);
      return 'watching';
    },
    isFunding(address: string): boolean {
      return funding.has(address);
    },
    watching(): number {
      return running.size;
    },
    async settled(): Promise<void> {
      while (running.size > 0) await Promise.all([...running.values()]);
    },
    stop(): void {
      stopped = true;
    },
  };
}

/**
 * The accounts a restart should pick up again: named by this service within
 * the last `windowMs`, and not yet funded. The watch itself decides whether
 * each is a custody account; a prototype one is dropped on its first read.
 */
export function accountsToResume(
  namedAt: ReadonlyArray<{ address: string; at: string }>,
  isFunded: (address: string) => boolean,
  nowMs: number,
  windowMs: number = FUND_ON_ACTIVATION_WINDOW_MS,
): string[] {
  return namedAt
    .filter(({ address, at }) => {
      const when = Date.parse(at);
      return Number.isFinite(when) && nowMs - when <= windowMs && !isFunded(address);
    })
    .map(({ address }) => address);
}
