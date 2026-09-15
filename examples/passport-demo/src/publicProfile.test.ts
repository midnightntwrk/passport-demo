/**
 * The profile store's open, and the promise that used to settle never.
 *
 * `midnight-passport` is opened from two places. This module asks for version
 * 2. `IndexedDbPassportEncryptedRecordStore` in `passport-demo-backend` opens
 * the SAME database by name with no version at all — deliberately, so an
 * integrator can add stores of their own — and caches the connection it gets
 * for the life of the page.
 *
 * A browser will not raise a database's version while another connection to it
 * is open: it asks the open one to close by firing `versionchange`, and if
 * nothing closes it fires `blocked` on the versioned open instead. `blocked`
 * is NOT an error. The request stays pending, so with no handler the promise
 * below never settled at all, and every await of it — reading the profile a
 * passkey belongs to, writing one, listing them — waited for ever. On screen
 * that is a spinner with no end and no sentence.
 *
 * Three drills, one per half of the answer, plus the aborted transaction that
 * fires neither `success` nor `error` on the request it belongs to.
 *
 * The fake IndexedDB here is hand-rolled rather than a dependency, for the
 * reason the rest of this suite avoids them: what is being tested is which
 * HANDLERS the module installs, so a fake whose handlers a test fires by hand
 * is both smaller than a real implementation and a more direct question.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadDemoProfile } from './publicProfile.js';

/** The open request shape `indexedDB.open` hands back, driven by hand. */
class FakeOpenRequest {
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onblocked: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  error: Error | null = null;
  result: FakeDatabase;

  constructor(database: FakeDatabase) {
    this.result = database;
  }
}

class FakeTransaction {
  onabort: (() => void) | null = null;
  error: Error | null = null;
  constructor(private readonly store: FakeStore) {}
  objectStore(): FakeStore {
    return this.store;
  }
}

class FakeStore {
  /** Every request this store handed out, so a test can settle them. */
  readonly requests: FakeStoreRequest[] = [];
  get(): FakeStoreRequest {
    const request = new FakeStoreRequest();
    this.requests.push(request);
    return request;
  }
}

class FakeStoreRequest {
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error: Error | null = null;
  result: unknown = undefined;
}

class FakeDatabase {
  onversionchange: (() => void) | null = null;
  closed = false;
  readonly store = new FakeStore();
  readonly objectStoreNames = { contains: () => true };
  transactions: FakeTransaction[] = [];

  transaction(): FakeTransaction {
    const transaction = new FakeTransaction(this.store);
    this.transactions.push(transaction);
    return transaction;
  }

  close(): void {
    this.closed = true;
  }
}

/** Installs a fake `indexedDB` and hands back the request each open produced. */
function stubIndexedDb(): { opens: FakeOpenRequest[] } {
  const opens: FakeOpenRequest[] = [];
  vi.stubGlobal('indexedDB', {
    open: () => {
      const request = new FakeOpenRequest(new FakeDatabase());
      opens.push(request);
      return request;
    },
  });
  return { opens };
}

/** Lets the module's own microtasks run so its handlers are installed. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('opening the profile store', () => {
  it('rejects with something readable when the open is blocked, rather than waiting for ever', async () => {
    const { opens } = stubIndexedDb();
    const settled = loadDemoProfile('passkey:abc').then(
      () => 'resolved',
      (cause: Error) => cause.message,
    );
    await settle();
    expect(opens).toHaveLength(1);

    /* What the browser does when another connection is holding the database at
       a lower version: not an error, just `blocked` — and then silence. */
    opens[0].onblocked?.();

    const message = await settled;
    expect(message).toContain('held open elsewhere');
    // The sentence names the action, and none of the machinery.
    expect(message).toContain('other tabs');
    for (const word of ['IndexedDB', 'version', 'blocked', 'transaction']) {
      expect(message).not.toContain(word);
    }
  });

  it('closes its own connection when the other opener needs to upgrade', async () => {
    const { opens } = stubIndexedDb();
    const settled = loadDemoProfile('passkey:abc');
    await settle();
    const database = opens[0].result;
    opens[0].onsuccess?.();
    await settle();

    /* This is the handler whose absence caused the hang at the other end: with
       nothing listening, nothing closes, and the versioned open is blocked. */
    expect(database.onversionchange).toBeTypeOf('function');
    expect(database.closed).toBe(false);
    database.onversionchange?.();
    expect(database.closed).toBe(true);

    // The read in flight still settles; a closed connection is not a hang.
    const request = database.store.requests[0];
    request.result = undefined;
    request.onsuccess?.();
    await expect(settled).resolves.toBeNull();
  });

  it('settles a request whose transaction was aborted, which fires nothing on the request', async () => {
    const { opens } = stubIndexedDb();
    const settled = loadDemoProfile('passkey:abc').then(
      () => 'resolved',
      (cause: Error) => cause.message,
    );
    await settle();
    opens[0].onsuccess?.();
    await settle();

    const transaction = opens[0].result.transactions[0];
    expect(transaction.onabort).toBeTypeOf('function');
    /* A closing connection and a quota refusal both land here, and neither
       fires `success` or `error` on the request itself. */
    transaction.onabort?.();

    await expect(settled).resolves.toContain('interrupted');
  });

  it('still rejects on a plain open failure', async () => {
    const { opens } = stubIndexedDb();
    const settled = loadDemoProfile('passkey:abc').then(
      () => 'resolved',
      (cause: Error) => cause.message,
    );
    await settle();
    opens[0].error = new Error('storage is disabled in this browser');
    opens[0].onerror?.();
    await expect(settled).resolves.toBe('storage is disabled in this browser');
  });

  it('says so plainly where there is no storage at all', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(loadDemoProfile('passkey:abc')).rejects.toThrow(/unavailable/i);
  });
});
