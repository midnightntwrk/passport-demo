/**
 * Encrypted Passport private state.
 *
 * Every record is an AES-GCM envelope whose additional authenticated data
 * binds it to one `(domain, appId, accountId)` scope, and whose storage key is
 * a digest of that same string. State therefore cannot be moved between
 * scopes: an envelope written for one app and account will not decrypt under
 * another, it will fail the tag check.
 *
 * KNOWN LIMITATION — ROLLBACK IS NOT DETECTED. An envelope's `updatedAt` sits
 * BESIDE the ciphertext, not inside the AAD, so it is not authenticated.
 * Anyone able to write to the record store can put back an earlier envelope
 * they captured for the same scope and the decrypt will succeed, silently
 * returning stale state. The scope binding still holds — this is a rewind
 * within one scope, never a swap between scopes.
 *
 * That is accepted on testnet, where the state carries device and recovery
 * secrets rather than spendable value, and where the record store is the
 * user's own browser. Revisit it before wallet-core tracks spent coins here:
 * a state rolled back to before a spend is a double-spend attempt, and the
 * answer (a monotonic counter inside the AAD, or a signed envelope head)
 * belongs in the envelope format rather than in any one caller.
 */
import {
  asArrayBuffer,
  decodeState,
  encodeState,
  fromBase64,
  toBase64,
  utf8,
  validatePassportStateScope,
} from './encoding.js';
import type {
  PassportEncryptedEnvelope,
  PassportEncryptedRecordStore,
  PassportPrivateStateStore,
  PassportStateKeyProvider,
  PassportStateScope,
} from './types.js';

const ENVELOPE_VERSION = 1 as const;
const DOMAIN = 'midnight-passport:private-state:v1';

function webCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is required for Passport private-state storage.');
  }
  return globalThis.crypto;
}

function additionalData(scope: PassportStateScope): Uint8Array {
  // The shared injectivity rule — see `validatePassportStateScope`. This site
  // glues with '|', the passkey derivation sites with ':'; one convention
  // covers all three so no pair of scopes can flatten to the same label.
  validatePassportStateScope(scope);
  return utf8(`${DOMAIN}|${scope.appId}|${scope.accountId}`);
}

async function storageKey(scope: PassportStateScope): Promise<string> {
  const digest = await webCrypto().subtle.digest('SHA-256', asArrayBuffer(additionalData(scope)));
  return `passport-state:${toBase64(new Uint8Array(digest))}`;
}

export class MemoryPassportEncryptedRecordStore implements PassportEncryptedRecordStore {
  private readonly values = new Map<string, PassportEncryptedEnvelope>();

  async get(key: string): Promise<PassportEncryptedEnvelope | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: PassportEncryptedEnvelope): Promise<void> {
    this.values.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async clear(): Promise<void> {
    this.values.clear();
  }

  /** Test-only inspection hook. It never decrypts an envelope. */
  snapshot(): PassportEncryptedEnvelope[] {
    return [...this.values.values()].map((value) => structuredClone(value));
  }
}

export class IndexedDbPassportEncryptedRecordStore implements PassportEncryptedRecordStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly databaseName = 'midnight-passport',
    private readonly objectStoreName = 'private-state',
  ) {}

  async get(key: string): Promise<PassportEncryptedEnvelope | null> {
    return this.request('readonly', (store) => store.get(key)).then(
      (value) => (value as PassportEncryptedEnvelope | undefined) ?? null,
    );
  }

  async set(key: string, value: PassportEncryptedEnvelope): Promise<void> {
    await this.request('readwrite', (store) => store.put(value, key));
  }

  async delete(key: string): Promise<void> {
    await this.request('readwrite', (store) => store.delete(key));
  }

  async clear(): Promise<void> {
    await this.request('readwrite', (store) => store.clear());
  }

  /**
   * THE CACHED CONNECTION IS WHAT BLOCKED A VERSIONED OPEN (2026/09/15).
   *
   * This opener asks for no version on purpose — see the comment below — and it
   * keeps the connection it gets in `dbPromise` for the life of the page. Both
   * of those are wanted. Together, and with no `versionchange` listener, they
   * were also a hang: a browser will not raise a database's version while
   * another connection to it is open, so it asks the open one to close by
   * firing `versionchange`. Nothing was listening, so nothing closed, and the
   * OTHER opener of this same database by name — `publicProfile.ts` in the
   * Passport demo, which does name a version — got `blocked` instead of
   * `success`. `blocked` leaves the request pending rather than failing it, so
   * that side waited for ever on a profile read it never got.
   *
   * `onversionchange` closes and FORGETS this connection, so the next request
   * opens a fresh one against whatever version the upgrade settled on. That is
   * safe here because nothing holds a transaction across an await: a
   * transaction is created, used, and settled inside one `request()` call.
   */
  private async database(): Promise<IDBDatabase> {
    if (!globalThis.indexedDB) {
      throw new Error('IndexedDB is unavailable. Use a browser storage adapter.');
    }
    this.dbPromise ??= new Promise((resolve, reject) => {
      // Do not request a fixed database version. Integrators can safely add
      // their own object stores to the same Passport database over time.
      const request = globalThis.indexedDB.open(this.databaseName);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(this.objectStoreName)) {
          request.result.createObjectStore(this.objectStoreName);
        }
      };
      /* A failed open must not be remembered: a cached rejected promise makes
         one bad moment permanent for the rest of the page's life. */
      request.onerror = () => {
        this.dbPromise = null;
        reject(request.error ?? new Error('Unable to open Passport storage.'));
      };
      /* This open names no version, so it can only be blocked by a DELETE of
         the database. Handled for the same reason as above — pending for ever
         is the one outcome a caller cannot recover from. */
      request.onblocked = () => {
        this.dbPromise = null;
        reject(new Error('Passport storage is held open elsewhere. Close the other tabs and retry.'));
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };
        resolve(db);
      };
    });
    return this.dbPromise;
  }

  private async request<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.database();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(this.objectStoreName, mode);
      const request = operation(transaction.objectStore(this.objectStoreName));
      request.onerror = () => reject(request.error ?? new Error('Passport storage request failed.'));
      request.onsuccess = () => resolve(request.result);
      /* An aborted transaction fires neither `success` nor `error` on the
         request, so without this a request interrupted by a closing connection
         or refused for quota never settles at all. */
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Passport storage was interrupted.'));
    });
  }
}

export class EncryptedPassportPrivateStateStore implements PassportPrivateStateStore {
  constructor(
    private readonly records: PassportEncryptedRecordStore,
    private readonly keys: PassportStateKeyProvider,
  ) {}

  async save<T>(scope: PassportStateScope, state: T): Promise<void> {
    const crypto = webCrypto();
    const key = await this.keys.getKey(scope);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: asArrayBuffer(iv),
        additionalData: asArrayBuffer(additionalData(scope)),
        tagLength: 128,
      },
      key,
      asArrayBuffer(encodeState(state)),
    );
    await this.records.set(await storageKey(scope), {
      version: ENVELOPE_VERSION,
      iv: toBase64(iv),
      ciphertext: toBase64(new Uint8Array(ciphertext)),
      updatedAt: new Date().toISOString(),
    });
  }

  async load<T>(scope: PassportStateScope): Promise<T | null> {
    const envelope = await this.records.get(await storageKey(scope));
    if (!envelope) return null;
    if (envelope.version !== ENVELOPE_VERSION) {
      throw new Error(`Unsupported Passport private-state version: ${String(envelope.version)}.`);
    }
    const key = await this.keys.getKey(scope);
    try {
      const plaintext = await webCrypto().subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: asArrayBuffer(fromBase64(envelope.iv)),
          additionalData: asArrayBuffer(additionalData(scope)),
          tagLength: 128,
        },
        key,
        asArrayBuffer(fromBase64(envelope.ciphertext)),
      );
      return decodeState<T>(new Uint8Array(plaintext));
    } catch (error) {
      throw new Error(
        `Passport private state could not be unlocked for this app and account: ${
          error instanceof Error ? error.message : 'unknown encryption error'
        }`,
      );
    }
  }

  async remove(scope: PassportStateScope): Promise<void> {
    await this.records.delete(await storageKey(scope));
  }

  async clear(): Promise<void> {
    await this.records.clear();
  }
}
