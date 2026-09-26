/**
 * When the Companion's face moves, driven on a hand-wound clock.
 *
 * What is held to a standard here is the audit of 2026/09/25: a face that
 * redrew itself every frame for as long as Home was open. It must move when
 * there is a reason to — arriving, being pressed, being pointed at — and hold
 * still otherwise, and never move at all for somebody who asked for less
 * motion.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  COMPANION_AWAKE_MS,
  COMPANION_GREETING_MS,
  startCompanionMotion,
} from './companionMotion.js';

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
    nextDelay: (): number => {
      const entry = [...pending.values()][0];
      if (!entry) throw new Error('nothing scheduled');
      return entry.at - clock;
    },
    fire(): void {
      const [id, entry] = [...pending.entries()].sort((a, b) => a[1].at - b[1].at)[0] ?? [];
      if (id === undefined || !entry) throw new Error('nothing scheduled');
      pending.delete(id);
      clock = Math.max(clock, entry.at);
      entry.run();
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('startCompanionMotion', () => {
  it('greets for a few seconds and then holds still', () => {
    const timers = fakeTimers();
    const onChange = vi.fn();
    const motion = startCompanionMotion({ onChange, ...timers });
    expect(motion.moving()).toBe(true);
    expect(timers.nextDelay()).toBe(COMPANION_GREETING_MS);
    timers.fire();
    expect(motion.moving()).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(false);
    /* Still, and nothing left to wake it: no timer, no frames. */
    expect(timers.pendingCount()).toBe(0);
    motion.stop();
  });

  it('moves again for a while when pressed or focused', () => {
    const timers = fakeTimers();
    const onChange = vi.fn();
    const motion = startCompanionMotion({ onChange, ...timers });
    timers.fire();
    motion.wake();
    expect(motion.moving()).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(timers.nextDelay()).toBe(COMPANION_AWAKE_MS);
    timers.fire();
    expect(motion.moving()).toBe(false);
    motion.stop();
  });

  it('extends a waking window rather than cutting it short', () => {
    const timers = fakeTimers();
    const motion = startCompanionMotion({ onChange: vi.fn(), ...timers });
    /* Pressed a second into the greeting: the longer of the two windows wins. */
    timers.advance(1_000);
    motion.wake();
    expect(timers.nextDelay()).toBe(COMPANION_AWAKE_MS);
    /* A short wake inside a long window changes nothing. */
    motion.wake(10);
    expect(timers.nextDelay()).toBe(COMPANION_AWAKE_MS);
    expect(timers.pendingCount()).toBe(1);
    motion.stop();
  });

  it('keeps moving while a pointer rests on it, and settles once it leaves', () => {
    const timers = fakeTimers();
    const onChange = vi.fn((_moving: boolean) => {});
    const motion = startCompanionMotion({ onChange, ...timers });
    timers.fire();
    motion.hold(true);
    expect(motion.moving()).toBe(true);
    /* Held: no timer ends it. */
    expect(timers.pendingCount()).toBe(0);
    timers.advance(60_000);
    motion.hold(false);
    expect(motion.moving()).toBe(false);
    expect(onChange.mock.calls.map(([moving]) => moving)).toEqual([false, true, false]);
    motion.stop();
  });

  it('finishes a waking window that a pointer left early', () => {
    const timers = fakeTimers();
    const motion = startCompanionMotion({ onChange: vi.fn(), ...timers });
    motion.hold(true);
    timers.advance(1_000);
    motion.hold(false);
    expect(motion.moving()).toBe(true);
    expect(timers.nextDelay()).toBe(COMPANION_GREETING_MS - 1_000);
    motion.stop();
  });

  it('never moves for somebody who asked for reduced motion', () => {
    const timers = fakeTimers();
    const onChange = vi.fn();
    const motion = startCompanionMotion({ onChange, reducedMotion: () => true, ...timers });
    expect(motion.moving()).toBe(false);
    motion.wake();
    motion.hold(true);
    expect(motion.moving()).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(timers.pendingCount()).toBe(0);
    motion.stop();
  });

  it('stops at once when the preference changes with the page open', () => {
    const timers = fakeTimers();
    let reduced = false;
    const onChange = vi.fn();
    const motion = startCompanionMotion({ onChange, reducedMotion: () => reduced, ...timers });
    expect(motion.moving()).toBe(true);
    reduced = true;
    motion.reconsider();
    expect(motion.moving()).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(timers.pendingCount()).toBe(0);
    motion.stop();
  });

  it('reports nothing once stopped', () => {
    const timers = fakeTimers();
    const onChange = vi.fn();
    const motion = startCompanionMotion({ onChange, ...timers });
    motion.stop();
    expect(timers.pendingCount()).toBe(0);
    motion.wake();
    motion.hold(true);
    motion.reconsider();
    expect(onChange).not.toHaveBeenCalled();
    /* Stopping twice is harmless. */
    motion.stop();
  });

  it('uses the real clock and real timers when none are injected', () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const motion = startCompanionMotion({ onChange });
      expect(motion.moving()).toBe(true);
      vi.advanceTimersByTime(COMPANION_GREETING_MS);
      expect(onChange).toHaveBeenCalledWith(false);
      motion.wake();
      motion.stop();
      vi.advanceTimersByTime(COMPANION_AWAKE_MS);
      expect(onChange).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
