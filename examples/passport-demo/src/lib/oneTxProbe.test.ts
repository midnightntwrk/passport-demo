/**
 * The schedule that closes the window a brand-new Passport used to fall into.
 *
 * The defect being held to a standard, from 2026/09/15: an account deployed by
 * this very session is not yet served by the chain, the read answers "could not
 * ask", and a caller that turned that into "no" and never asked again left the
 * Passport sending in two steps for its whole first session — although the
 * contract it had just deployed carries the circuit that does it in one.
 *
 * So the drill is about three things, and all three are clock-shaped: that an
 * unknown answer is asked again, that it is asked again on the stated waits and
 * not on a loop, and that the asking STOPS — both when an answer arrives and
 * when the budget runs out. The clock is injected, so none of it takes a real
 * five seconds.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  ONE_TX_PROBE_DELAYS_MS,
  probeOneTransactionSupport,
  type OneTxProbeTimers,
} from './oneTxProbe.js';

/**
 * A clock that records what it was asked to wait, and runs the waits when the
 * drill says so. Deliberately not `vi.useFakeTimers`: the module never touches
 * a global, and a fake that has to be installed would be testing vitest.
 */
function fakeTimers(): OneTxProbeTimers & {
  waits: number[];
  cleared: number[];
  run(): void;
  pendingCount(): number;
} {
  const queue = new Map<number, () => void>();
  const waits: number[] = [];
  const cleared: number[] = [];
  let next = 1;
  return {
    waits,
    cleared,
    set(run, ms) {
      const handle = next;
      next += 1;
      waits.push(ms);
      queue.set(handle, run);
      return handle;
    },
    clear(handle) {
      cleared.push(handle);
      queue.delete(handle);
    },
    /** Fires every wait currently due, exactly once each. */
    run() {
      const due = [...queue.entries()];
      queue.clear();
      for (const [, fire] of due) fire();
    },
    pendingCount() {
      return queue.size;
    },
  };
}

/** Lets every already-resolved promise in the chain settle. */
const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('ONE_TX_PROBE_DELAYS_MS', () => {
  it('is five seconds, ten, twenty, forty — and then nothing', () => {
    /* The list is the attempt budget as much as it is the waits: four waits is
       five reads, and about seventy-five seconds of asking. An account that is
       going to appear appears in about fourteen. */
    expect([...ONE_TX_PROBE_DELAYS_MS]).toEqual([5_000, 10_000, 20_000, 40_000]);
    expect(ONE_TX_PROBE_DELAYS_MS.reduce((a, b) => a + b, 0)).toBe(75_000);
  });
});

describe('probeOneTransactionSupport', () => {
  it('asks once, at once, when the chain already has the answer', async () => {
    const timers = fakeTimers();
    const read = vi.fn<() => Promise<boolean | null>>().mockResolvedValue(true);
    const onAnswer = vi.fn();

    probeOneTransactionSupport({ read, onAnswer, timers });
    await settle();

    expect(read).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith(true);
    /* No wait was ever armed, so an account the chain serves costs no delay. */
    expect(timers.waits).toEqual([]);
  });

  it('settles on a definite `false` just as firmly as on a `true`', async () => {
    const timers = fakeTimers();
    const onAnswer = vi.fn();
    probeOneTransactionSupport({
      read: async () => false,
      onAnswer,
      timers,
    });
    await settle();

    expect(onAnswer).toHaveBeenCalledExactlyOnceWith(false);
    expect(timers.waits).toEqual([]);
  });

  it('asks again on the stated waits while the answer is unknown', async () => {
    const timers = fakeTimers();
    const read = vi.fn<() => Promise<boolean | null>>().mockResolvedValue(null);
    const onAnswer = vi.fn();

    probeOneTransactionSupport({ read, onAnswer, timers });
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
    expect(timers.waits).toEqual([5_000]);

    for (const expected of [10_000, 20_000, 40_000]) {
      timers.run();
      await settle();
      expect(timers.waits.at(-1)).toBe(expected);
    }

    /* The budget: five reads, four waits, and nothing pending after the last. */
    timers.run();
    await settle();
    expect(read).toHaveBeenCalledTimes(5);
    expect(timers.waits).toEqual([...ONE_TX_PROBE_DELAYS_MS]);
    expect(timers.pendingCount()).toBe(0);
    /* And the whole point: never a guess. */
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('stops the moment a definite answer arrives, with its budget unspent', async () => {
    const timers = fakeTimers();
    const read = vi
      .fn<() => Promise<boolean | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(true);
    const onAnswer = vi.fn();

    probeOneTransactionSupport({ read, onAnswer, timers });
    await settle();
    timers.run();
    await settle();
    timers.run();
    await settle();

    expect(read).toHaveBeenCalledTimes(3);
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith(true);
    /* Two waits were armed and the third never was. */
    expect(timers.waits).toEqual([5_000, 10_000]);
    expect(timers.pendingCount()).toBe(0);
  });

  it('treats a read that THREW exactly as it treats an unknown answer', async () => {
    /* A transport blip has learned no more than a `null` did, and ending the
       session's answer on one would be the original defect wearing a hat. */
    const timers = fakeTimers();
    const read = vi
      .fn<() => Promise<boolean | null>>()
      .mockRejectedValueOnce(new Error('the chain could not be reached'))
      .mockResolvedValue(true);
    const onAnswer = vi.fn();

    probeOneTransactionSupport({ read, onAnswer, timers });
    await settle();
    expect(timers.waits).toEqual([5_000]);
    expect(onAnswer).not.toHaveBeenCalled();

    timers.run();
    await settle();
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('clears a pending wait when it is cancelled', async () => {
    const timers = fakeTimers();
    const onAnswer = vi.fn();
    const stop = probeOneTransactionSupport({
      read: async () => null,
      onAnswer,
      timers,
      delays: [1_000],
    });
    await settle();
    expect(timers.pendingCount()).toBe(1);

    stop();
    expect(timers.cleared).toHaveLength(1);
    expect(timers.pendingCount()).toBe(0);

    /* Idempotent, and there is nothing left to clear the second time. */
    stop();
    expect(timers.cleared).toHaveLength(1);
  });

  it('suppresses the answer of a read already in flight when it is cancelled', async () => {
    /* An effect that re-ran because the account changed must not have the
       PREVIOUS account's answer land on it. */
    const timers = fakeTimers();
    const onAnswer = vi.fn();
    let release: (value: boolean | null) => void = () => {};
    const stop = probeOneTransactionSupport({
      read: () =>
        new Promise<boolean | null>((resolve) => {
          release = resolve;
        }),
      onAnswer,
      timers,
      delays: [],
    });

    stop();
    /* Nothing was pending, so nothing was cleared — and the late answer is
       still dropped. */
    expect(timers.cleared).toEqual([]);
    release(true);
    await settle();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('does not schedule anything at all when the budget is empty', async () => {
    const timers = fakeTimers();
    const onAnswer = vi.fn();
    probeOneTransactionSupport({
      read: async () => null,
      onAnswer,
      timers,
      delays: [],
    });
    await settle();

    expect(timers.waits).toEqual([]);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('drops a rejection that arrives after cancelling', async () => {
    const timers = fakeTimers();
    const onAnswer = vi.fn();
    let fail: (cause: unknown) => void = () => {};
    const stop = probeOneTransactionSupport({
      read: () =>
        new Promise<boolean | null>((_resolve, reject) => {
          fail = reject;
        }),
      onAnswer,
      timers,
      delays: [1_000],
    });

    stop();
    fail(new Error('too late'));
    await settle();

    expect(timers.waits).toEqual([]);
    expect(onAnswer).not.toHaveBeenCalled();
  });
});
