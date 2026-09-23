/**
 * ONE TRANSACTION AT A TIME PER ACCOUNT, IN THIS BROWSER (2026/09/22).
 *
 * A gated call on an account custody Passport is built against the account's
 * state as it stands — its `round`, its `auth_nonce` — and a second call built
 * while the first is still on its way is built against a state the first is
 * about to move. The node refuses it (`1010: Invalid Transaction: Custom
 * error: 104`, seen live on 2026/09/22 when two payments met in one block), or
 * worse, it signs against a nonce the first consumes and can never run at all.
 *
 * The screen already refuses a second press while a payment is running. That
 * does not reach the recovery add, which runs from its own effect; or a second
 * tab of the same Passport; or a reload in the middle of a payment, which
 * starts a new page while the old one's transaction is still in flight. So the
 * rule lives here, below every screen: work on one account waits for the work
 * before it — in this tab by a promise chain, across tabs by a short lease in
 * `localStorage` that its holder renews while it works and that lapses on its
 * own if the holder goes away mid-call.
 *
 * THE WAIT IS BOUNDED. A call that cannot get the account within `waitMs` is
 * refused with {@link CUSTODY_ACCOUNT_BUSY} and nothing is sent — never a
 * spinner in front of somebody else's transaction.
 *
 * No DOM, no React, no network; the storage, the clock, and the sleep are
 * handed in, so the whole of it is drilled in `./custodyAccountLock.test.ts`.
 */

/** The one sentence a call refused for a busy account gets. */
export const CUSTODY_ACCOUNT_BUSY =
  'Your Passport is still finishing the last thing you asked it to do. Try again in a moment.';

/** Where the leases live. */
export const CUSTODY_ACCOUNT_LEASE_KEY = 'passport-account-custody-lease:v1';

/** How long a lease holds without being renewed. */
export const CUSTODY_ACCOUNT_LEASE_MS = 30_000;

/** How often a holder renews its lease while it works. */
export const CUSTODY_ACCOUNT_RENEW_MS = 10_000;

/** How often a waiter looks at another tab's lease again. */
export const CUSTODY_ACCOUNT_POLL_MS = 1_000;

/** The part of `Storage` a lease needs. */
export interface CustodyLeaseStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CustodyAccountLockDeps {
  /** Null where storage is denied: the lock is then this tab's alone. */
  storage(): CustodyLeaseStorage | null;
  now(): number;
  sleep(milliseconds: number): Promise<void>;
  /** This tab's name on a lease. */
  readonly holder: string;
  /** Starts the renewal; returns what stops it. */
  every(milliseconds: number, tick: () => void): () => void;
}

interface Lease {
  readonly holder: string;
  readonly until: number;
}

function readLeases(storage: CustodyLeaseStorage): Record<string, Lease> {
  const leases = Object.create(null) as Record<string, Lease>;
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(CUSTODY_ACCOUNT_LEASE_KEY) ?? '{}');
  } catch {
    return leases;
  }
  if (!parsed || typeof parsed !== 'object') return leases;
  for (const [account, value] of Object.entries(parsed as Record<string, unknown>)) {
    const lease = value as Partial<Lease> | null;
    if (lease && typeof lease.holder === 'string' && typeof lease.until === 'number') {
      leases[account] = { holder: lease.holder, until: lease.until };
    }
  }
  return leases;
}

function writeLeases(storage: CustodyLeaseStorage, leases: Record<string, Lease>): void {
  try {
    storage.setItem(CUSTODY_ACCOUNT_LEASE_KEY, JSON.stringify(leases));
  } catch {
    /* A denied write is a lease nobody else can see: the lock falls back to
       this tab's own chain, which is still one call at a time here. */
  }
}

/** A lock over accounts, keyed however the caller names them. */
export interface CustodyAccountLock {
  run<T>(account: string, waitMs: number, work: () => Promise<T>): Promise<T>;
}

export function createCustodyAccountLock(deps: CustodyAccountLockDeps): CustodyAccountLock {
  const tails = new Map<string, Promise<void>>();

  /** Takes the lease when it is free, lapsed, or already ours. */
  const tryLease = (account: string): boolean => {
    const storage = deps.storage();
    if (storage === null) return true;
    const leases = readLeases(storage);
    const held = Object.hasOwn(leases, account) ? leases[account] : null;
    if (held !== null && held.holder !== deps.holder && held.until > deps.now()) return false;
    leases[account] = { holder: deps.holder, until: deps.now() + CUSTODY_ACCOUNT_LEASE_MS };
    writeLeases(storage, leases);
    return true;
  };

  const releaseLease = (account: string): void => {
    const storage = deps.storage();
    if (storage === null) return;
    const leases = readLeases(storage);
    if (Object.hasOwn(leases, account) && leases[account].holder === deps.holder) {
      delete leases[account];
      writeLeases(storage, leases);
    }
  };

  return {
    async run<T>(account: string, waitMs: number, work: () => Promise<T>): Promise<T> {
      const deadline = deps.now() + waitMs;
      const before = tails.get(account) ?? Promise.resolve();
      let release!: () => void;
      const mine = new Promise<void>((resolve) => {
        release = resolve;
      });
      /* JOINED BEFORE WAITING, so a third caller queues behind this one and not
         beside it. `release` runs however this call ends, including a refusal
         below, so a caller that gave up never holds anybody else up. */
      const tail = before.then(() => mine);
      tails.set(account, tail);
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const turn = await Promise.race([
          before.then(() => true),
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), Math.max(0, waitMs));
          }),
        ]);
        clearTimeout(timer);
        if (!turn) throw new Error(CUSTODY_ACCOUNT_BUSY);
        while (!tryLease(account)) {
          if (deps.now() >= deadline) throw new Error(CUSTODY_ACCOUNT_BUSY);
          await deps.sleep(CUSTODY_ACCOUNT_POLL_MS);
        }
        const stop = deps.every(CUSTODY_ACCOUNT_RENEW_MS, () => void tryLease(account));
        try {
          return await work();
        } finally {
          stop();
          releaseLease(account);
        }
      } finally {
        release();
        if (tails.get(account) === tail) tails.delete(account);
      }
    },
  };
}

/** The lock every account custody call in this tab shares. */
let shared: CustodyAccountLock | null = null;

export function custodyAccountLock(): CustodyAccountLock {
  if (shared === null) {
    shared = createCustodyAccountLock({
      storage: () => {
        try {
          return globalThis.localStorage ?? null;
        } catch {
          return null;
        }
      },
      now: () => Date.now(),
      sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      holder: `tab-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`,
      every: (milliseconds, tick) => {
        const handle = setInterval(tick, milliseconds);
        return () => clearInterval(handle);
      },
    });
  }
  return shared;
}
