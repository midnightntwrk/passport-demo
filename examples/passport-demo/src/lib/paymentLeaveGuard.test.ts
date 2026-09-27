/**
 * WHAT THIS PROTECTS: a payment that has not been handed to the network yet is
 * lost if the page goes, so the browser is asked to warn — for exactly that
 * window, because a `beforeunload` listener keeps the page out of the
 * back/forward cache — and the silent update is held back for the same window,
 * so it never reloads the page into the warning.
 */

import { describe, expect, it, vi } from 'vitest';

import { criticalWorkInFlight } from './appBusy.js';
import { guardUnsentPayment, type LeaveListener } from './paymentLeaveGuard.js';

function fakeWindow() {
  const listeners = new Set<LeaveListener>();
  const order: string[] = [];
  return {
    listeners,
    order,
    target: {
      addEventListener: (_type: 'beforeunload', listener: LeaveListener) => {
        order.push('add');
        listeners.add(listener);
      },
      removeEventListener: (_type: 'beforeunload', listener: LeaveListener) => {
        order.push('remove');
        listeners.delete(listener);
      },
    },
  };
}

describe('the leave warning while a payment has not gone out', () => {
  it('asks the browser to warn, in the browser’s own words', () => {
    const page = fakeWindow();
    const stop = guardUnsentPayment(page.target);
    expect(page.listeners.size).toBe(1);
    const event = { preventDefault: vi.fn(), returnValue: undefined as unknown };
    for (const listener of page.listeners) listener(event as unknown as BeforeUnloadEvent);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.returnValue).toBe(true);
    stop();
  });

  it('comes off the page when it is stopped, and stopping twice changes nothing', () => {
    const page = fakeWindow();
    const stop = guardUnsentPayment(page.target);
    stop();
    expect(page.listeners.size).toBe(0);
    stop();
    expect(page.order).toEqual(['add', 'remove']);
  });

  it('holds the silent update back for the same window, and never for longer', () => {
    const page = fakeWindow();
    expect(criticalWorkInFlight()).toBe(false);
    const stop = guardUnsentPayment(page.target);
    expect(criticalWorkInFlight()).toBe(true);
    stop();
    expect(criticalWorkInFlight()).toBe(false);
  });

  it('takes the hold before the listener goes on, and gives it back after it comes off', () => {
    /* So an update released by the end of the hold never reloads a page that
       still has the warning on it. */
    const page = fakeWindow();
    const hold = vi.fn(() => {
      page.order.push('hold');
      return () => {
        page.order.push(`release with ${page.listeners.size} listener(s)`);
      };
    });
    const stop = guardUnsentPayment(page.target, hold);
    stop();
    expect(page.order).toEqual(['hold', 'add', 'remove', 'release with 0 listener(s)']);
  });
});
