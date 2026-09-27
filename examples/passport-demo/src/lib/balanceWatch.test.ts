/**
 * The account watch, driven on a fake clock.
 *
 * What is held to a standard here is exactly the reviewer's two sentences from
 * 2026/09/02 — "the mUSD balance was never updated to 100; after I refresh the
 * page the 100 mUSD appeared", and "the recipient's balance did not update
 * automatically after a send". Both come down to one thing: does the account
 * get read again, on its own, until the figure moves — and does it keep being
 * read slowly afterwards so a transfer nobody on this device started still
 * turns up.
 *
 * The clock and the timers are injected, so none of this waits on real time.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  openingBalanceLegsHeld,
  ACCOUNT_HEAD_TIMEOUT_MS,
  BALANCE_WATCH_BUSY_STANDOFF_MS,
  BALANCE_WATCH_CHASE_CEILING_MS,
  BALANCE_WATCH_CHASE_FIRST_MS,
  BALANCE_WATCH_CHASE_WINDOW_MS,
  BALANCE_WATCH_LOOK_CEILING_MS,
  BALANCE_WATCH_LOOK_FIRST_MS,
  BALANCE_WATCH_QUIET_READ_MS,
  BALANCE_WATCH_STEADY_MS,
  accountHeadFrom,
  accountHeadRequest,
  accountReadDue,
  chaseIsSpent,
  holdingsSignature,
  nextBalanceProbeDelayMs,
  nextLookDelayMs,
  readAccountHead,
  startBalanceWatch,
  type HoldingsSnapshot,
} from './balanceWatch.js';

/* -------------------------------------------------------------------------- */
/* A hand-driven clock and timer queue                                         */
/* -------------------------------------------------------------------------- */

/**
 * One pending timer at a time is all the controller ever holds, but the fake
 * keeps a map anyway so a stray second one would show up as a failure rather
 * than as a silently overwritten handle.
 */
function fakeTimers() {
  let clock = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => clock,
    setTimer: (run: () => void, delayMs: number): unknown => {
      const id = nextId++;
      pending.set(id, { at: clock + delayMs, run });
      return id;
    },
    clearTimer: (handle: unknown): void => {
      pending.delete(handle as number);
    },
    pendingCount: () => pending.size,
    /** The delay the single scheduled timer is waiting out. */
    nextDelay: (): number => {
      const entry = [...pending.values()][0];
      if (!entry) throw new Error('nothing scheduled');
      return entry.at - clock;
    },
    /** Runs the earliest timer, moving the clock to it — never backwards, so
        a hand-wound `advance` past a due timer stays wound. */
    async fire(): Promise<void> {
      const [id, entry] = [...pending.entries()].sort((a, b) => a[1].at - b[1].at)[0] ?? [];
      if (id === undefined || !entry) throw new Error('nothing scheduled');
      pending.delete(id);
      clock = Math.max(clock, entry.at);
      entry.run();
      await Promise.resolve();
      await Promise.resolve();
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const EMPTY: HoldingsSnapshot = { nightBalance: '0', stablecoin: null, otherShielded: [] };

const WITH_STABLECOIN: HoldingsSnapshot = {
  nightBalance: '0',
  stablecoin: { colourHex: '0xaa', amount: 100n },
  otherShielded: [],
};

/* -------------------------------------------------------------------------- */
/* The delay rule                                                              */
/* -------------------------------------------------------------------------- */

describe('nextBalanceProbeDelayMs', () => {
  it('waits the steady cadence when nothing is expected', () => {
    expect(nextBalanceProbeDelayMs({ chasing: false, attempt: 0, elapsedMs: 0 })).toBe(
      BALANCE_WATCH_STEADY_MS,
    );
    /* The attempt counter belongs to a chase; with none running it must not
       leak into the steady cadence. */
    expect(nextBalanceProbeDelayMs({ chasing: false, attempt: 9, elapsedMs: 9_999_999 })).toBe(
      BALANCE_WATCH_STEADY_MS,
    );
  });

  it('opens a chase at five seconds and backs off from there', () => {
    const delays = [0, 1, 2, 3, 4, 5, 6].map((attempt) =>
      nextBalanceProbeDelayMs({ chasing: true, attempt, elapsedMs: 0 }),
    );
    expect(delays[0]).toBe(BALANCE_WATCH_CHASE_FIRST_MS);
    /* Strictly increasing until the ceiling, and never past it. */
    for (let index = 1; index < delays.length; index += 1) {
      expect(delays[index]!).toBeGreaterThanOrEqual(delays[index - 1]!);
      expect(delays[index]!).toBeLessThanOrEqual(BALANCE_WATCH_CHASE_CEILING_MS);
    }
    expect(delays.at(-1)).toBe(BALANCE_WATCH_CHASE_CEILING_MS);
  });

  it('keeps every chase gap shorter than the steady one', () => {
    /* Otherwise the tail of a chase is slower than not chasing at all, which
       would make the last minutes of an activation grant worse than useless. */
    expect(BALANCE_WATCH_CHASE_CEILING_MS).toBeLessThan(BALANCE_WATCH_STEADY_MS);
  });

  it('treats a negative attempt as the first one', () => {
    expect(nextBalanceProbeDelayMs({ chasing: true, attempt: -3, elapsedMs: 0 })).toBe(
      BALANCE_WATCH_CHASE_FIRST_MS,
    );
  });

  it('falls back to the steady cadence once the chase window is spent', () => {
    expect(
      nextBalanceProbeDelayMs({
        chasing: true,
        attempt: 0,
        elapsedMs: BALANCE_WATCH_CHASE_WINDOW_MS,
      }),
    ).toBe(BALANCE_WATCH_STEADY_MS);
  });
});

describe('chaseIsSpent', () => {
  it('is the ten minutes the activation grant itself is given', () => {
    expect(BALANCE_WATCH_CHASE_WINDOW_MS).toBe(600_000);
    expect(chaseIsSpent(BALANCE_WATCH_CHASE_WINDOW_MS - 1)).toBe(false);
    expect(chaseIsSpent(BALANCE_WATCH_CHASE_WINDOW_MS)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* The fingerprint                                                             */
/* -------------------------------------------------------------------------- */

describe('holdingsSignature', () => {
  it('changes when a stablecoin lands', () => {
    expect(holdingsSignature(EMPTY)).not.toBe(holdingsSignature(WITH_STABLECOIN));
  });

  it('does not change when the same holdings come back in another order', () => {
    const one: HoldingsSnapshot = {
      nightBalance: '5',
      stablecoin: null,
      otherShielded: [
        { colourHex: '0xbb', amount: 2n },
        { colourHex: '0xaa', amount: 1n },
      ],
    };
    const other: HoldingsSnapshot = {
      nightBalance: '5',
      stablecoin: null,
      otherShielded: [
        { colourHex: '0xaa', amount: 1n },
        { colourHex: '0xbb', amount: 2n },
      ],
    };
    expect(holdingsSignature(one)).toBe(holdingsSignature(other));
  });

  it('tells an unread NIGHT figure apart from a real zero', () => {
    /* A failed read must never end a chase by looking like an arrival. */
    expect(
      holdingsSignature({ nightBalance: null, stablecoin: null, otherShielded: [] }),
    ).not.toBe(holdingsSignature(EMPTY));
  });

  it('has an answer for no account at all', () => {
    expect(holdingsSignature(null)).toBe('no-account');
  });
});

describe('openingBalanceLegsHeld', () => {
  it('holds neither leg with no account at all', () => {
    expect(openingBalanceLegsHeld(null)).toEqual({ night: false, stablecoin: false });
  });

  it('reads the two legs of the grant independently', () => {
    /* THE 2026/09/04 STABILITY AUDIT. The two deposits do not land together, so
       the answer has to be two facts rather than one: the caller retires the
       "on the way" row only when both are true, and the audit watched a row
       retired on the NIGHT leg alone leave `mUSD 0` unexplained for 18.1 s. */
    expect(
      openingBalanceLegsHeld({
        nightBalance: '0.002',
        stablecoin: { colourHex: '0xaa', amount: 0n },
        otherShielded: [],
      }),
    ).toEqual({ night: true, stablecoin: false });
    expect(
      openingBalanceLegsHeld({
        nightBalance: '0',
        stablecoin: { colourHex: '0xaa', amount: 100n },
        otherShielded: [],
      }),
    ).toEqual({ night: false, stablecoin: true });
    expect(openingBalanceLegsHeld(WITH_STABLECOIN).stablecoin).toBe(true);
  });

  it('holds neither leg on an account the grant has not reached', () => {
    expect(
      openingBalanceLegsHeld({
        nightBalance: '0',
        stablecoin: { colourHex: '0xaa', amount: 0n },
        otherShielded: [],
      }),
    ).toEqual({ night: false, stablecoin: false });
    expect(openingBalanceLegsHeld(EMPTY).night).toBe(false);
  });

  it('does not call the NIGHT leg held while its figure is unread', () => {
    /* A read nobody has made is not a zero, for the same reason it
       fingerprints as `?`: it must not end the wait by looking like an arrival. */
    expect(
      openingBalanceLegsHeld({ nightBalance: null, stablecoin: null, otherShielded: [] }).night,
    ).toBe(false);
  });

  it('treats a build with no stablecoin colour as having nothing to wait for', () => {
    /* `null` is not "a stablecoin at zero" — it is a sponsor that has named no
       colour, so the NIGHT leg is the whole grant and the row must not hang on
       a second deposit nobody is sending. */
    expect(
      openingBalanceLegsHeld({ nightBalance: '0', stablecoin: null, otherShielded: [] }).stablecoin,
    ).toBe(true);
  });

  it('ignores every other colour the account holds', () => {
    /* The grant is NIGHT and the sponsor's stablecoin. A colour somebody else
       sent is not one of them, and counting it would retire the row on money
       that has nothing to do with the sponsor. */
    expect(
      openingBalanceLegsHeld({
        nightBalance: '0',
        stablecoin: { colourHex: '0xaa', amount: 0n },
        otherShielded: [{ colourHex: '0xcc', amount: 7n }],
      }),
    ).toEqual({ night: false, stablecoin: false });
  });
});

/* -------------------------------------------------------------------------- */
/* The controller                                                              */
/* -------------------------------------------------------------------------- */

describe('startBalanceWatch', () => {
  it('does not read immediately — the screen has just read for itself', () => {
    const timers = fakeTimers();
    const refresh = vi.fn();
    const watch = startBalanceWatch({
      refresh,
      signature: () => 'a',
      ...timers,
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(timers.nextDelay()).toBe(BALANCE_WATCH_STEADY_MS);
    watch.stop();
  });

  it('keeps reading slowly so an incoming transfer turns up on its own', async () => {
    /* The recipient's half of the defect: nothing happened on this device, and
       the figure still has to move. */
    const timers = fakeTimers();
    let signature = 'before';
    const refresh = vi.fn(() => {
      signature = 'after';
    });
    const watch = startBalanceWatch({ refresh, signature: () => signature, ...timers });
    await timers.fire();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(timers.nextDelay()).toBe(BALANCE_WATCH_STEADY_MS);
    await timers.fire();
    expect(refresh).toHaveBeenCalledTimes(2);
    watch.stop();
  });

  it('chases an announced change every few seconds until the figure moves', async () => {
    /* The reviewer's mUSD: the sponsor answers, the screen reads, and the
       ledger is a beat behind. */
    const timers = fakeTimers();
    let holdings: HoldingsSnapshot = EMPTY;
    const refresh = vi.fn();
    const watch = startBalanceWatch({
      refresh,
      signature: () => holdingsSignature(holdings),
      ...timers,
    });

    watch.expectChange();
    expect(watch.chasing()).toBe(true);
    expect(timers.nextDelay()).toBe(BALANCE_WATCH_CHASE_FIRST_MS);

    /* Three reads that still find nothing. The chase carries on, backing off. */
    await timers.fire();
    expect(watch.chasing()).toBe(true);
    const second = timers.nextDelay();
    await timers.fire();
    expect(timers.nextDelay()).toBeGreaterThanOrEqual(second);
    await timers.fire();
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(watch.chasing()).toBe(true);

    /* The deposit lands. The chase ends and the steady cadence resumes. */
    holdings = WITH_STABLECOIN;
    await timers.fire();
    expect(watch.chasing()).toBe(false);
    expect(timers.nextDelay()).toBe(BALANCE_WATCH_STEADY_MS);
    watch.stop();
  });

  it('gives up chasing after ten minutes and settles back to steady', async () => {
    const timers = fakeTimers();
    const watch = startBalanceWatch({
      refresh: () => {},
      signature: () => 'unchanged',
      ...timers,
    });
    watch.expectChange();
    /* One read, then the clock jumps past the window: the next settle ends it. */
    await timers.fire();
    expect(watch.chasing()).toBe(true);
    timers.advance(BALANCE_WATCH_CHASE_WINDOW_MS);
    await timers.fire();
    expect(watch.chasing()).toBe(false);
    expect(timers.nextDelay()).toBe(BALANCE_WATCH_STEADY_MS);
    watch.stop();
  });

  it('restarts the chase when something else is announced mid-chase', async () => {
    const timers = fakeTimers();
    const watch = startBalanceWatch({
      refresh: () => {},
      signature: () => 'unchanged',
      ...timers,
    });
    watch.expectChange();
    await timers.fire();
    await timers.fire();
    expect(timers.nextDelay()).toBeGreaterThan(BALANCE_WATCH_CHASE_FIRST_MS);
    /* A send completes. The backoff starts over rather than continuing from
       wherever the previous chase had crept to. */
    watch.expectChange();
    expect(timers.nextDelay()).toBe(BALANCE_WATCH_CHASE_FIRST_MS);
    watch.stop();
  });

  it('survives a read that throws, and asks again', async () => {
    const timers = fakeTimers();
    const refresh = vi.fn(async () => {
      throw new Error('the indexer said no');
    });
    const watch = startBalanceWatch({ refresh, signature: () => 'a', ...timers });
    await timers.fire();
    expect(refresh).toHaveBeenCalledTimes(1);
    await timers.fire();
    expect(refresh).toHaveBeenCalledTimes(2);
    watch.stop();
  });

  it('never runs two reads at once', async () => {
    const timers = fakeTimers();
    const release: (() => void)[] = [];
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release.push(resolve);
        }),
    );
    const watch = startBalanceWatch({ refresh, signature: () => 'a', ...timers });
    await timers.fire();
    expect(refresh).toHaveBeenCalledTimes(1);
    /* Nothing is scheduled while one is in flight, so a slow indexer cannot be
       asked twice. `resume` while in flight is ignored for the same reason. */
    expect(timers.pendingCount()).toBe(0);
    watch.pause();
    watch.resume();
    expect(refresh).toHaveBeenCalledTimes(1);
    release.forEach((resolve) => resolve());
    await Promise.resolve();
    await Promise.resolve();
    watch.stop();
  });

  it('does not reschedule behind a pause that landed mid-read', async () => {
    /* A tab backgrounded while a read is in flight: the read settles, and must
       not quietly wind the watch back up in a document nobody is looking at. */
    const timers = fakeTimers();
    const release: (() => void)[] = [];
    const watch = startBalanceWatch({
      refresh: () =>
        new Promise<void>((resolve) => {
          release.push(resolve);
        }),
      signature: () => 'a',
      ...timers,
    });
    await timers.fire();
    watch.pause();
    release.forEach((resolve) => resolve());
    await Promise.resolve();
    await Promise.resolve();
    expect(timers.pendingCount()).toBe(0);
    watch.stop();
  });

  it('stops asking while the tab is in the background, and reads on the way back', async () => {
    const timers = fakeTimers();
    const refresh = vi.fn();
    const watch = startBalanceWatch({ refresh, signature: () => 'a', ...timers });
    watch.pause();
    expect(timers.pendingCount()).toBe(0);
    /* A second pause is not an error and does not queue anything. */
    watch.pause();
    expect(timers.pendingCount()).toBe(0);

    watch.resume();
    await Promise.resolve();
    await Promise.resolve();
    /* Coming back reads at once: the figure on screen stopped being watched. */
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(timers.nextDelay()).toBe(BALANCE_WATCH_STEADY_MS);
    /* A resume with nothing paused changes nothing. */
    watch.resume();
    expect(refresh).toHaveBeenCalledTimes(1);
    watch.stop();
  });

  it('does nothing at all once stopped', async () => {
    const timers = fakeTimers();
    const refresh = vi.fn();
    const watch = startBalanceWatch({ refresh, signature: () => 'a', ...timers });
    watch.stop();
    expect(timers.pendingCount()).toBe(0);
    watch.expectChange();
    watch.pause();
    watch.resume();
    expect(timers.pendingCount()).toBe(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('drops a read that lands after it was stopped', async () => {
    const timers = fakeTimers();
    const release: (() => void)[] = [];
    const watch = startBalanceWatch({
      refresh: () =>
        new Promise<void>((resolve) => {
          release.push(resolve);
        }),
      signature: () => 'a',
      ...timers,
    });
    await timers.fire();
    watch.stop();
    release.forEach((resolve) => resolve());
    await Promise.resolve();
    await Promise.resolve();
    /* Nothing rescheduled itself behind the stop. */
    expect(timers.pendingCount()).toBe(0);
  });

  /* ------------------------------------------------------------------------ */
  /* The standoff while the Passport is in the middle of something            */
  /* ------------------------------------------------------------------------ */

  it('does not read while the Passport is busy, and takes the read the moment it is not', async () => {
    /* The scheduling rule of 2026/09/03: this timer is the only read in the
       app that can land inside a proving run, and a shielded leg is already
       the largest allocation Passport makes. */
    const timers = fakeTimers();
    const refresh = vi.fn();
    let busy = false;
    const watch = startBalanceWatch({
      refresh,
      signature: () => 'a',
      busy: () => busy,
      ...timers,
    });

    busy = true;
    await timers.fire();
    expect(refresh).not.toHaveBeenCalled();
    /* Not skipped — stood off, and asked again shortly. */
    expect(timers.nextDelay()).toBe(BALANCE_WATCH_BUSY_STANDOFF_MS);

    await timers.fire();
    expect(refresh).not.toHaveBeenCalled();
    expect(timers.nextDelay()).toBe(BALANCE_WATCH_BUSY_STANDOFF_MS);

    busy = false;
    await timers.fire();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(timers.nextDelay()).toBe(BALANCE_WATCH_STEADY_MS);
    watch.stop();
  });

  it('costs a chase nothing but the standoff — the baseline, the clock, and the backoff all keep', async () => {
    /* The opening balance lands DURING activation, which is exactly a busy
       stretch. A watch that dropped its reads there would have regressed the
       defect it was written for. */
    const timers = fakeTimers();
    let holdings: HoldingsSnapshot = EMPTY;
    const refresh = vi.fn();
    let busy = true;
    const watch = startBalanceWatch({
      refresh,
      signature: () => holdingsSignature(holdings),
      busy: () => busy,
      ...timers,
    });

    watch.expectChange();
    expect(timers.nextDelay()).toBe(BALANCE_WATCH_CHASE_FIRST_MS);

    /* Two standoffs. No read is made, and no chase attempt is spent on one. */
    await timers.fire();
    await timers.fire();
    expect(refresh).not.toHaveBeenCalled();
    expect(watch.chasing()).toBe(true);

    busy = false;
    await timers.fire();
    expect(refresh).toHaveBeenCalledTimes(1);
    /* The FIRST chase read, at the first chase cadence: the standoff did not
       advance the backoff past the reads that never happened. */
    expect(timers.nextDelay()).toBe(BALANCE_WATCH_CHASE_FIRST_MS * 1.5);

    holdings = WITH_STABLECOIN;
    await timers.fire();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(watch.chasing()).toBe(false);
    watch.stop();
  });

  it('stands off on resume too, rather than reading on the way back from a background tab', async () => {
    const timers = fakeTimers();
    const refresh = vi.fn();
    let busy = true;
    const watch = startBalanceWatch({
      refresh,
      signature: () => 'a',
      busy: () => busy,
      ...timers,
    });

    watch.pause();
    watch.resume();
    await Promise.resolve();
    expect(refresh).not.toHaveBeenCalled();
    expect(timers.nextDelay()).toBe(BALANCE_WATCH_BUSY_STANDOFF_MS);

    busy = false;
    await timers.fire();
    expect(refresh).toHaveBeenCalledTimes(1);
    watch.stop();
  });

  it('reads on its own cadence when no busy signal is given', async () => {
    const timers = fakeTimers();
    const refresh = vi.fn();
    const watch = startBalanceWatch({ refresh, signature: () => 'a', ...timers });
    await timers.fire();
    expect(refresh).toHaveBeenCalledTimes(1);
    watch.stop();
  });

  it('uses the real clock and real timers when none are injected', async () => {
    vi.useFakeTimers();
    try {
      const refresh = vi.fn();
      const watch = startBalanceWatch({ refresh, signature: () => 'a' });
      await vi.advanceTimersByTimeAsync(BALANCE_WATCH_STEADY_MS);
      expect(refresh).toHaveBeenCalledTimes(1);
      watch.stop();
      await vi.advanceTimersByTimeAsync(BALANCE_WATCH_STEADY_MS * 2);
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The cheap look (2026/09/25)                                                */
/* -------------------------------------------------------------------------- */

describe('nextLookDelayMs', () => {
  it('looks after three seconds, and backs off to five while nothing moves', () => {
    expect(nextLookDelayMs(0)).toBe(BALANCE_WATCH_LOOK_FIRST_MS);
    expect(nextLookDelayMs(1)).toBe(4_500);
    expect(nextLookDelayMs(2)).toBe(BALANCE_WATCH_LOOK_CEILING_MS);
    expect(nextLookDelayMs(50)).toBe(BALANCE_WATCH_LOOK_CEILING_MS);
    expect(nextLookDelayMs(-3)).toBe(BALANCE_WATCH_LOOK_FIRST_MS);
  });

  it('keeps the slowest look well inside the old steady cadence', () => {
    /* The point of the look: a payment somebody else makes shows within a few
       seconds, where the steady read left it unseen for up to thirty. */
    expect(BALANCE_WATCH_LOOK_CEILING_MS).toBeLessThan(BALANCE_WATCH_STEADY_MS / 5);
  });
});

describe('accountReadDue', () => {
  const quiet = { head: 'h1', headAtLastRead: 'h1', arriving: false } as const;

  it('reads the moment the head moves', () => {
    expect(accountReadDue({ ...quiet, head: 'h2', sinceLastReadMs: 0 })).toBe(true);
    /* Never read with a head yet: anything it is told is news. */
    expect(accountReadDue({ ...quiet, headAtLastRead: null, sinceLastReadMs: 0 })).toBe(true);
  });

  it('leaves a still account alone until the safety net', () => {
    expect(accountReadDue({ ...quiet, sinceLastReadMs: BALANCE_WATCH_STEADY_MS })).toBe(false);
    expect(accountReadDue({ ...quiet, sinceLastReadMs: BALANCE_WATCH_QUIET_READ_MS - 1 })).toBe(false);
    expect(accountReadDue({ ...quiet, sinceLastReadMs: BALANCE_WATCH_QUIET_READ_MS })).toBe(true);
  });

  it('keeps the steady cadence while a delivered coin waits for its position', () => {
    /* Placing it is the indexer answering about an OLD transaction, which
       moves no head. */
    const arriving = { ...quiet, arriving: true };
    expect(accountReadDue({ ...arriving, sinceLastReadMs: BALANCE_WATCH_STEADY_MS - 1 })).toBe(false);
    expect(accountReadDue({ ...arriving, sinceLastReadMs: BALANCE_WATCH_STEADY_MS })).toBe(true);
  });

  it('falls back to the steady cadence when the look cannot be answered', () => {
    const blind = { ...quiet, head: null };
    expect(accountReadDue({ ...blind, sinceLastReadMs: BALANCE_WATCH_STEADY_MS - 1 })).toBe(false);
    expect(accountReadDue({ ...blind, sinceLastReadMs: BALANCE_WATCH_STEADY_MS })).toBe(true);
  });

  it('reads on the steady cadence while a chase runs, whatever the head says', () => {
    /* What a chase waits for almost always moves the head; the steady read is
       for what does not — a payment of this Passport's own that never landed. */
    const chasing = { ...quiet, chasing: true };
    expect(accountReadDue({ ...chasing, sinceLastReadMs: BALANCE_WATCH_STEADY_MS - 1 })).toBe(false);
    expect(accountReadDue({ ...chasing, sinceLastReadMs: BALANCE_WATCH_STEADY_MS })).toBe(true);
    expect(accountReadDue({ ...quiet, chasing: false, sinceLastReadMs: BALANCE_WATCH_STEADY_MS })).toBe(false);
  });

  it('does not hammer an indexer whose last read failed, however the head moves', () => {
    const failing = { ...quiet, head: 'h2', lastReadFailed: true };
    expect(accountReadDue({ ...failing, sinceLastReadMs: 5_000 })).toBe(false);
    expect(accountReadDue({ ...failing, sinceLastReadMs: BALANCE_WATCH_STEADY_MS })).toBe(true);
    /* And an explicit `false` is the ordinary rule. */
    expect(accountReadDue({ ...failing, lastReadFailed: false, sinceLastReadMs: 0 })).toBe(true);
  });
});

describe('accountHeadRequest', () => {
  it('asks for the newest action’s transaction and never for the state', () => {
    const body = JSON.parse(accountHeadRequest('ab'.repeat(32))) as {
      operationName: string;
      query: string;
      variables: { address: string };
    };
    expect(body.operationName).toBe('PassportAccountHead');
    expect(body.variables).toEqual({ address: 'ab'.repeat(32) });
    expect(body.query).toContain('contractAction(address: $address)');
    expect(body.query).toContain('transaction { hash }');
    /* The one field this exists to avoid asking for. */
    expect(body.query).not.toContain('state');
  });
});

describe('accountHeadFrom', () => {
  const answer = (contractAction: unknown) => ({ data: { contractAction } });

  it('reads the hash of the newest action', () => {
    expect(accountHeadFrom(answer({ transaction: { hash: 'f00d' } }))).toBe('f00d');
  });

  it('answers `none` for an account with no action at all — a real answer', () => {
    expect(accountHeadFrom(answer(null))).toBe('none');
  });

  it('answers null for anything it cannot compare against', () => {
    expect(accountHeadFrom(null)).toBeNull();
    expect(accountHeadFrom('text')).toBeNull();
    expect(accountHeadFrom({})).toBeNull();
    expect(accountHeadFrom({ data: null })).toBeNull();
    expect(accountHeadFrom({ data: {} })).toBeNull();
    expect(accountHeadFrom(answer('odd'))).toBeNull();
    expect(accountHeadFrom(answer({}))).toBeNull();
    expect(accountHeadFrom(answer({ transaction: 'odd' }))).toBeNull();
    expect(accountHeadFrom(answer({ transaction: { hash: 7 } }))).toBeNull();
    expect(accountHeadFrom(answer({ transaction: { hash: '' } }))).toBeNull();
  });

  it('refuses half an answer', () => {
    expect(
      accountHeadFrom({ data: { contractAction: { transaction: { hash: 'f00d' } } }, errors: [{}] }),
    ).toBeNull();
    /* An empty error list is no error. */
    expect(accountHeadFrom({ data: { contractAction: null }, errors: [] })).toBe('none');
  });
});

describe('readAccountHead', () => {
  const ok = (body: unknown) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as unknown as Response);

  it('posts the look to the indexer and reads the head back', async () => {
    const fetch = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      ok({ data: { contractAction: { transaction: { hash: 'beef' } } } }),
    );
    await expect(
      readAccountHead('https://indexer.example/graphql', 'cd'.repeat(32), { fetch, timeoutMs: 50 }),
    ).resolves.toBe('beef');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://indexer.example/graphql');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(accountHeadRequest('cd'.repeat(32)));
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('never throws: a refusal or a failure is an unanswered look', async () => {
    const refused = vi.fn(() => Promise.resolve({ ok: false } as Response));
    await expect(readAccountHead('u', 'a', { fetch: refused })).resolves.toBeNull();
    const failed = vi.fn(() => Promise.reject(new Error('offline')));
    await expect(readAccountHead('u', 'a', { fetch: failed })).resolves.toBeNull();
    const garbled = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.reject(new Error('not json')) } as unknown as Response),
    );
    await expect(readAccountHead('u', 'a', { fetch: garbled })).resolves.toBeNull();
  });

  it('uses the browser’s fetch and its own timeout when given neither', async () => {
    const fetch = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      ok({ data: { contractAction: null } }),
    );
    vi.stubGlobal('fetch', fetch);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    try {
      await expect(readAccountHead('u', 'a')).resolves.toBe('none');
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(timeout).toHaveBeenCalledWith(ACCOUNT_HEAD_TIMEOUT_MS);
    } finally {
      timeout.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe('startBalanceWatch with a cheap look', () => {
  it('looks every few seconds instead of reading in full, backing off while nothing moves', async () => {
    const timers = fakeTimers();
    const refresh = vi.fn();
    const look = vi.fn(() => false);
    const watch = startBalanceWatch({ refresh, look, signature: () => 'a', ...timers });
    expect(timers.nextDelay()).toBe(BALANCE_WATCH_LOOK_FIRST_MS);
    await timers.fire();
    expect(look).toHaveBeenCalledTimes(1);
    expect(timers.nextDelay()).toBe(4_500);
    await timers.fire();
    expect(timers.nextDelay()).toBe(BALANCE_WATCH_LOOK_CEILING_MS);
    await timers.fire();
    expect(timers.nextDelay()).toBe(BALANCE_WATCH_LOOK_CEILING_MS);
    /* The look decides whether to read; the watch never reads in full on its
       own while it is not chasing. */
    expect(refresh).not.toHaveBeenCalled();
    watch.stop();
  });

  it('comes back to the quick look after a look that read', async () => {
    const timers = fakeTimers();
    let moved = false;
    const look = vi.fn(() => Promise.resolve(moved));
    const watch = startBalanceWatch({ refresh: vi.fn(), look, signature: () => 'a', ...timers });
    await timers.fire();
    await timers.fire();
    expect(timers.nextDelay()).toBe(BALANCE_WATCH_LOOK_CEILING_MS);
    moved = true;
    await timers.fire();
    expect(timers.nextDelay()).toBe(BALANCE_WATCH_LOOK_FIRST_MS);
    watch.stop();
  });

  it('counts a look that threw as one that read nothing', async () => {
    const timers = fakeTimers();
    const look = vi.fn((): Promise<boolean> => Promise.reject(new Error('offline')));
    const watch = startBalanceWatch({ refresh: vi.fn(), look, signature: () => 'a', ...timers });
    await timers.fire();
    expect(look).toHaveBeenCalledTimes(1);
    expect(timers.nextDelay()).toBe(4_500);
    watch.stop();
  });

  it('looks every three seconds while chasing, and tells the look it is chasing', async () => {
    const timers = fakeTimers();
    const refresh = vi.fn();
    const look = vi.fn((_context: { chasing: boolean }) => false);
    const watch = startBalanceWatch({ refresh, look, signature: () => 'unchanged', ...timers });
    await timers.fire();
    await timers.fire();
    expect(timers.nextDelay()).toBe(BALANCE_WATCH_LOOK_CEILING_MS);
    expect(look).toHaveBeenLastCalledWith({ chasing: false });
    /* Something is announced: the looks stop backing off, and the look is told
       — it is the look that decides a chase's full reads (`accountReadDue`). */
    watch.expectChange();
    expect(timers.nextDelay()).toBe(BALANCE_WATCH_LOOK_FIRST_MS);
    await timers.fire();
    expect(look).toHaveBeenLastCalledWith({ chasing: true });
    expect(timers.nextDelay()).toBe(BALANCE_WATCH_LOOK_FIRST_MS);
    await timers.fire();
    expect(timers.nextDelay()).toBe(BALANCE_WATCH_LOOK_FIRST_MS);
    expect(refresh).not.toHaveBeenCalled();
    /* The window spent, the chase ends and the looks back off again. */
    timers.advance(BALANCE_WATCH_CHASE_WINDOW_MS);
    await timers.fire();
    expect(watch.chasing()).toBe(false);
    expect(timers.nextDelay()).toBeGreaterThan(BALANCE_WATCH_LOOK_FIRST_MS);
    watch.stop();
  });

  it('ends a chase when a look finds the figure moved', async () => {
    const timers = fakeTimers();
    let holdings: HoldingsSnapshot = EMPTY;
    const look = vi.fn(() => {
      holdings = WITH_STABLECOIN;
      return true;
    });
    const watch = startBalanceWatch({
      refresh: vi.fn(),
      look,
      signature: () => holdingsSignature(holdings),
      ...timers,
    });
    watch.expectChange();
    await timers.fire();
    expect(watch.chasing()).toBe(false);
    expect(timers.nextDelay()).toBe(BALANCE_WATCH_LOOK_FIRST_MS);
    watch.stop();
  });

  it('looks — rather than reading in full — on the way back from the background', async () => {
    const timers = fakeTimers();
    const refresh = vi.fn();
    const look = vi.fn(() => false);
    const watch = startBalanceWatch({ refresh, look, signature: () => 'a', ...timers });
    watch.pause();
    expect(timers.pendingCount()).toBe(0);
    watch.resume();
    await Promise.resolve();
    await Promise.resolve();
    expect(look).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    watch.stop();
  });

  it('stands off a busy Passport before a look too', async () => {
    const timers = fakeTimers();
    let busy = true;
    const look = vi.fn(() => false);
    const watch = startBalanceWatch({
      refresh: vi.fn(),
      look,
      busy: () => busy,
      signature: () => 'a',
      ...timers,
    });
    await timers.fire();
    expect(look).not.toHaveBeenCalled();
    expect(timers.nextDelay()).toBe(BALANCE_WATCH_BUSY_STANDOFF_MS);
    busy = false;
    await timers.fire();
    expect(look).toHaveBeenCalledTimes(1);
    watch.stop();
  });

  it('does not look again once stopped mid-look', async () => {
    const timers = fakeTimers();
    const release: ((value: boolean) => void)[] = [];
    const look = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          release.push(resolve);
        }),
    );
    const watch = startBalanceWatch({ refresh: vi.fn(), look, signature: () => 'a', ...timers });
    await timers.fire();
    watch.stop();
    release.forEach((resolve) => resolve(true));
    await Promise.resolve();
    await Promise.resolve();
    expect(timers.pendingCount()).toBe(0);
  });
});
