/**
 * The record store's cached connection, and the hang at the other end of it.
 *
 * `IndexedDbPassportEncryptedRecordStore` opens the Passport database BY NAME
 * with no version, on purpose: an integrator may add object stores of their
 * own to it over time, and naming a version would fight them for it. It also
 * caches the connection it gets, so a page's many small reads and writes do
 * not each pay an open.
 *
 * Both are wanted. Together, with nothing listening for `versionchange`, they
 * were also a hang somewhere else entirely. A browser will not raise a
 * database's version while another connection to it is open — it asks the open
 * one to close by firing `versionchange`, and where nothing closes, the
 * versioned open is told `blocked` instead. `blocked` leaves that request
 * PENDING rather than failing it, so the Passport demo's own opener of this
 * same database (`src/publicProfile.ts`, which asks for version 2) had a
 * promise that settled never, and the screens waiting on a profile waited for
 * ever.
 *
 * What is drilled here is that this side now gets out of the way: it closes
 * AND forgets its connection when asked, so the next request opens a fresh one
 * rather than reusing a closed handle.
 *
 * The fake IndexedDB is hand-rolled rather than a dependency. The question is
 * which handlers this class installs and what it does when they fire, so a
 * fake a test drives by hand asks it more directly than a real implementation
 * would — and this package has no test dependencies at all today.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { IndexedDbPassportEncryptedRecordStore } from '../src/index.js';

class FakeStoreRequest {
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error: Error | null = null;
  result: unknown = undefined;
}

class FakeStore {
  readonly requests: FakeStoreRequest[] = [];
  get(): FakeStoreRequest {
    const request = new FakeStoreRequest();
    this.requests.push(request);
    return request;
  }
  put(): FakeStoreRequest {
    return this.get();
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

class FakeDatabase {
  onversionchange: (() => void) | null = null;
  closed = false;
  readonly store = new FakeStore();
  readonly objectStoreNames = { contains: () => true };
  readonly transactions: FakeTransaction[] = [];

  transaction(): FakeTransaction {
    const transaction = new FakeTransaction(this.store);
    this.transactions.push(transaction);
    return transaction;
  }

  close(): void {
    this.closed = true;
  }
}

class FakeOpenRequest {
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onblocked: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  error: Error | null = null;
  readonly result = new FakeDatabase();
}

function stubIndexedDb(): { opens: FakeOpenRequest[] } {
  const opens: FakeOpenRequest[] = [];
  vi.stubGlobal('indexedDB', {
    open: () => {
      const request = new FakeOpenRequest();
      opens.push(request);
      return request;
    },
  });
  return { opens };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('IndexedDbPassportEncryptedRecordStore', () => {
  it('closes and forgets its connection when another opener needs to upgrade', async () => {
    const { opens } = stubIndexedDb();
    const store = new IndexedDbPassportEncryptedRecordStore();

    const first = store.get('passport-state:one');
    await settle();
    const database = opens[0].result;
    opens[0].onsuccess?.();
    await settle();
    database.store.requests[0].onsuccess?.();
    await expect(first).resolves.toBeNull();

    /* The handler whose absence was the whole defect. */
    expect(database.onversionchange).toBeTypeOf('function');
    database.onversionchange?.();
    expect(database.closed).toBe(true);

    /* FORGOTTEN, not merely closed. A cached promise holding a closed
       connection would make every later request throw on `transaction()`
       instead — a different permanent failure in place of the first. */
    const second = store.get('passport-state:two');
    await settle();
    expect(opens).toHaveLength(2);
    opens[1].onsuccess?.();
    await settle();
    opens[1].result.store.requests[0].onsuccess?.();
    await expect(second).resolves.toBeNull();
  });

  it('rejects rather than hanging when the open is blocked, and can be retried', async () => {
    const { opens } = stubIndexedDb();
    const store = new IndexedDbPassportEncryptedRecordStore();

    const blocked = store.get('passport-state:one');
    await settle();
    opens[0].onblocked?.();
    await expect(blocked).rejects.toThrow(/held open elsewhere/);

    /* A refusal must not be cached: one blocked moment cannot be the rest of
       the page's life. */
    const retried = store.get('passport-state:one');
    await settle();
    expect(opens).toHaveLength(2);
    opens[1].onsuccess?.();
    await settle();
    opens[1].result.store.requests[0].onsuccess?.();
    await expect(retried).resolves.toBeNull();
  });

  it('does not cache a failed open either', async () => {
    const { opens } = stubIndexedDb();
    const store = new IndexedDbPassportEncryptedRecordStore();

    const failed = store.get('passport-state:one');
    await settle();
    opens[0].error = new Error('storage is disabled in this browser');
    opens[0].onerror?.();
    await expect(failed).rejects.toThrow('storage is disabled in this browser');

    const retried = store.get('passport-state:one');
    await settle();
    expect(opens).toHaveLength(2);
    opens[1].onsuccess?.();
    await settle();
    opens[1].result.store.requests[0].onsuccess?.();
    await expect(retried).resolves.toBeNull();
  });

  it('settles a request whose transaction was aborted', async () => {
    const { opens } = stubIndexedDb();
    const store = new IndexedDbPassportEncryptedRecordStore();

    const settled = store.set('passport-state:one', {
      version: 1,
      iv: 'aXY=',
      ciphertext: 'Yw==',
      updatedAt: '2026-09-15T00:00:00.000Z',
    });
    await settle();
    opens[0].onsuccess?.();
    await settle();

    const transaction = opens[0].result.transactions[0];
    expect(transaction.onabort).toBeTypeOf('function');
    /* Neither `success` nor `error` fires on the request when its transaction
       is torn down, so without this the write never settles. */
    transaction.onabort?.();
    await expect(settled).rejects.toThrow(/interrupted/);
  });

  it('says so plainly where there is no storage at all', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const store = new IndexedDbPassportEncryptedRecordStore();
    await expect(store.get('passport-state:one')).rejects.toThrow(/unavailable/i);
  });
});
