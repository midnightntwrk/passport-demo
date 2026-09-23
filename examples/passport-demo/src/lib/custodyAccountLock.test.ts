/**
 * One transaction per account at a time, in this browser (2026/09/22).
 *
 * Live, two payments that met in one block were refused by the node
 * (`1010: Invalid Transaction: Custom error: 104`). These drill the lock that
 * keeps this browser from building a second call on an account while the first
 * is still on its way — in one tab, across tabs, and past a tab that went away.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CUSTODY_ACCOUNT_BUSY,
  CUSTODY_ACCOUNT_LEASE_KEY,
  CUSTODY_ACCOUNT_LEASE_MS,
  createCustodyAccountLock,
  custodyAccountLock,
  type CustodyAccountLockDeps,
  type CustodyLeaseStorage,
} from './custodyAccountLock.js';

function memoryStorage(options: { denyWrites?: boolean } = {}): CustodyLeaseStorage & {
  data: Map<string, string>;
} {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      if (options.denyWrites) throw new Error('denied');
      data.set(key, value);
    },
  };
}

function deps(
  storage: CustodyLeaseStorage | null,
  holder: string,
  clock: { now: number },
  patch: Partial<CustodyAccountLockDeps> = {},
): CustodyAccountLockDeps & { ticks: (() => void)[]; stopped: number } {
  const ticks: (() => void)[] = [];
  const made = {
    storage: () => storage,
    now: () => clock.now,
    sleep: (milliseconds: number) => {
      clock.now += milliseconds;
      return Promise.resolve();
    },
    holder,
    ticks,
    stopped: 0,
    every: (_milliseconds: number, tick: () => void) => {
      ticks.push(tick);
      return () => {
        made.stopped += 1;
      };
    },
    ...patch,
  };
  return made;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('in one tab', () => {
  it('runs one call at a time on an account, in the order they came', async () => {
    const clock = { now: 0 };
    const lock = createCustodyAccountLock(deps(memoryStorage(), 'tab-a', clock));
    const order: string[] = [];
    let finishFirst!: () => void;
    const first = lock.run('acct', 60_000, async () => {
      order.push('first:start');
      await new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
      order.push('first:end');
      return 1;
    });
    const second = lock.run('acct', 60_000, () => {
      order.push('second');
      return Promise.resolve(2);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(['first:start']);
    finishFirst();
    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(2);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('does not hold one account up behind another', async () => {
    const lock = createCustodyAccountLock(deps(memoryStorage(), 'tab-a', { now: 0 }));
    const hung = lock.run('one', 60_000, () => new Promise<never>(() => undefined));
    await expect(lock.run('two', 60_000, () => Promise.resolve('two'))).resolves.toBe('two');
    void hung;
  });

  it('refuses in one sentence, sending nothing, when the call before it does not finish in time', async () => {
    const lock = createCustodyAccountLock(deps(memoryStorage(), 'tab-a', { now: 0 }));
    void lock.run('acct', 60_000, () => new Promise<never>(() => undefined));
    const work = vi.fn(() => Promise.resolve());
    await expect(lock.run('acct', 5, work)).rejects.toThrow(CUSTODY_ACCOUNT_BUSY);
    expect(work).not.toHaveBeenCalled();
  });

  it('lets the next call through after one that failed, and releases its lease', async () => {
    const storage = memoryStorage();
    const made = deps(storage, 'tab-a', { now: 0 });
    const lock = createCustodyAccountLock(made);
    await expect(lock.run('acct', 1_000, () => Promise.reject(new Error('refused')))).rejects.toThrow('refused');
    expect(made.stopped).toBe(1);
    expect(JSON.parse(storage.data.get(CUSTODY_ACCOUNT_LEASE_KEY) as string)).toEqual({});
    await expect(lock.run('acct', 1_000, () => Promise.resolve('next'))).resolves.toBe('next');
  });
});

describe('across tabs', () => {
  it('waits while another tab holds a live lease, and takes it once that tab lets go', async () => {
    const storage = memoryStorage();
    const clock = { now: 1_000 };
    storage.data.set(
      CUSTODY_ACCOUNT_LEASE_KEY,
      JSON.stringify({ acct: { holder: 'tab-b', until: 1_000 + CUSTODY_ACCOUNT_LEASE_MS } }),
    );
    const made = deps(storage, 'tab-a', clock, {
      sleep: (milliseconds) => {
        clock.now += milliseconds;
        /* Tab B finishes three seconds in. */
        if (clock.now >= 4_000) storage.data.set(CUSTODY_ACCOUNT_LEASE_KEY, JSON.stringify({}));
        return Promise.resolve();
      },
    });
    const lock = createCustodyAccountLock(made);
    await expect(lock.run('acct', 60_000, () => Promise.resolve('mine'))).resolves.toBe('mine');
    expect(clock.now).toBe(4_000);
  });

  it('takes a lease its holder stopped renewing', async () => {
    const storage = memoryStorage();
    storage.data.set(CUSTODY_ACCOUNT_LEASE_KEY, JSON.stringify({ acct: { holder: 'tab-b', until: 10 } }));
    const lock = createCustodyAccountLock(deps(storage, 'tab-a', { now: 11 }));
    let during: unknown = null;
    await lock.run('acct', 1_000, () => {
      during = JSON.parse(storage.data.get(CUSTODY_ACCOUNT_LEASE_KEY) as string);
      return Promise.resolve();
    });
    expect(during).toEqual({ acct: { holder: 'tab-a', until: 11 + CUSTODY_ACCOUNT_LEASE_MS } });
  });

  it('renews its lease while it works, and leaves another account’s lease alone on release', async () => {
    const storage = memoryStorage();
    storage.data.set(CUSTODY_ACCOUNT_LEASE_KEY, JSON.stringify({ other: { holder: 'tab-b', until: 99 } }));
    const clock = { now: 0 };
    const made = deps(storage, 'tab-a', clock);
    const lock = createCustodyAccountLock(made);
    await lock.run('acct', 1_000, () => {
      clock.now = 20_000;
      made.ticks[0]();
      const leases = JSON.parse(storage.data.get(CUSTODY_ACCOUNT_LEASE_KEY) as string) as Record<string, { until: number }>;
      expect(leases.acct.until).toBe(20_000 + CUSTODY_ACCOUNT_LEASE_MS);
      return Promise.resolve();
    });
    expect(JSON.parse(storage.data.get(CUSTODY_ACCOUNT_LEASE_KEY) as string)).toEqual({
      other: { holder: 'tab-b', until: 99 },
    });
  });

  it('refuses when another tab keeps the account past the wait', async () => {
    const storage = memoryStorage();
    storage.data.set(
      CUSTODY_ACCOUNT_LEASE_KEY,
      JSON.stringify({ acct: { holder: 'tab-b', until: Number.MAX_SAFE_INTEGER } }),
    );
    const lock = createCustodyAccountLock(deps(storage, 'tab-a', { now: 0 }));
    await expect(lock.run('acct', 5_000, () => Promise.resolve())).rejects.toThrow(CUSTODY_ACCOUNT_BUSY);
  });

  it('does not release a lease another tab has since taken', async () => {
    const storage = memoryStorage();
    const lock = createCustodyAccountLock(deps(storage, 'tab-a', { now: 0 }));
    await lock.run('acct', 1_000, () => {
      storage.data.set(
        CUSTODY_ACCOUNT_LEASE_KEY,
        JSON.stringify({ acct: { holder: 'tab-b', until: 50_000 } }),
      );
      return Promise.resolve();
    });
    expect(JSON.parse(storage.data.get(CUSTODY_ACCOUNT_LEASE_KEY) as string)).toEqual({
      acct: { holder: 'tab-b', until: 50_000 },
    });
  });

  it('reads past a lease record that is not one', async () => {
    for (const raw of ['not json', '"text"', JSON.stringify({ acct: 'x', b: null, c: { holder: 1, until: 2 } })]) {
      const storage = memoryStorage();
      storage.data.set(CUSTODY_ACCOUNT_LEASE_KEY, raw);
      const lock = createCustodyAccountLock(deps(storage, 'tab-a', { now: 0 }));
      await expect(lock.run('acct', 1_000, () => Promise.resolve('ok'))).resolves.toBe('ok');
    }
  });

  it('is this tab’s alone where storage is denied or absent', async () => {
    const denied = createCustodyAccountLock(deps(memoryStorage({ denyWrites: true }), 'tab-a', { now: 0 }));
    await expect(denied.run('acct', 1_000, () => Promise.resolve('ok'))).resolves.toBe('ok');
    const none = createCustodyAccountLock(deps(null, 'tab-a', { now: 0 }));
    await expect(none.run('acct', 1_000, () => Promise.resolve('ok'))).resolves.toBe('ok');
  });
});

describe('the lock the tab shares', () => {
  it('is one lock, on this browser’s storage and clock, renewing on a real timer', async () => {
    vi.useFakeTimers();
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    });
    const lock = custodyAccountLock();
    expect(custodyAccountLock()).toBe(lock);
    const running = lock.run('acct', 60_000, async () => {
      await vi.advanceTimersByTimeAsync(10_000);
      return (JSON.parse(data.get(CUSTODY_ACCOUNT_LEASE_KEY) as string) as Record<string, { holder: string }>).acct.holder;
    });
    await vi.advanceTimersByTimeAsync(0);
    await expect(running).resolves.toMatch(/^tab-/);
    /* A lease held by somebody else is waited on by sleeping on the real clock. */
    data.set(CUSTODY_ACCOUNT_LEASE_KEY, JSON.stringify({ acct: { holder: 'tab-z', until: Date.now() + 1_500 } }));
    const waiting = lock.run('acct', 60_000, () => Promise.resolve('after'));
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(waiting).resolves.toBe('after');
    vi.unstubAllGlobals();
  });

  it('falls back to this tab alone when reading storage throws', async () => {
    vi.stubGlobal('localStorage', undefined);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('denied');
      },
    });
    await expect(custodyAccountLock().run('denied', 1_000, () => Promise.resolve('ok'))).resolves.toBe('ok');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined, writable: true });
    await expect(custodyAccountLock().run('absent', 1_000, () => Promise.resolve('ok'))).resolves.toBe('ok');
    vi.unstubAllGlobals();
  });
});
