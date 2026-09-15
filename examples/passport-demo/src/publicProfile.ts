import type { PassportPasskeyReference } from './backend.js';
import type { PassportAccountOnPasskey } from './lib/accountOnPasskey.js';

const DATABASE = 'midnight-passport';
const STORE = 'public-profile';

export interface DemoPassportProfile {
  subjectId: string;
  passkey: PassportPasskeyReference;
  createdAt: string;
  /**
   * The `PassportStateScope` accountId this profile's private state and wallet
   * seed derive under. Absent on records written before multi-passkey support
   * (2026/08/05); those derive under the legacy fixed accountId
   * {@link LEGACY_LOCAL_PROFILE_ID}, which the migration preserves so no
   * existing encrypted state or wallet address changes.
   */
  accountId?: string;
  /**
   * What the platform said about the WebAuthn largeBlob extension when this
   * credential was enrolled: `true` when the credential can carry a blob,
   * `false` when it said it cannot, absent when it said nothing (an older
   * client, or a profile bound to a credential this browser did not enrol).
   *
   * Read only to decide whether attempting a blob WRITE is worth a user
   * prompt — a write on an unsupported credential costs a full assertion and
   * achieves nothing. It is set to `false` after any attempt that reports the
   * extension missing, so no user is prompted twice for nothing. Nothing else
   * in the app depends on it, and recovery never requires it: the blob READ
   * rides on the sign-in assertion either way.
   */
  largeBlobSupported?: boolean;
  /**
   * The account-custody contract a claim bound to this Passport, and whether
   * it has reached the passkey's largeBlob yet.
   *
   * Public metadata only — an address, a network, and a name. It is kept here
   * rather than written at claim time because writing it is an assertion, and
   * an assertion nobody asked for is a passkey prompt on a finished Home
   * screen. See `src/lib/accountOnPasskey.ts` for the rule and the incident.
   */
  accountOnPasskey?: PassportAccountOnPasskey;
}

/**
 * "A VERSIONED OPEN CAN NEVER SETTLE" — the hang this handles (2026/09/15).
 *
 * `midnight-passport` is opened from TWO places, and only one of them names a
 * version. This one asks for version 2. `IndexedDbPassportEncryptedRecordStore`
 * in `passport-demo-backend` opens the SAME DATABASE BY NAME with no version at
 * all, deliberately, so an integrator can add stores of their own to it — and
 * it CACHES the connection it gets for the life of the page.
 *
 * A browser will not raise a database's version while another connection to it
 * is still open. It asks the open connection to close, by firing
 * `versionchange` on it; if nothing is listening, nothing closes, and the
 * versioned open fires `blocked` instead. `blocked` is not an error: the
 * request stays pending, so with no `onblocked` handler the promise below
 * SETTLES NEVER. Every await of it — reading the profile a passkey belongs to,
 * writing one, listing them — waits for ever, and a screen that is waiting for
 * a profile shows a spinner rather than a sentence.
 *
 * All three halves of the answer are here and in the sibling opener:
 *
 *   - `onversionchange` closes this connection when the OTHER opener needs to
 *     upgrade, so the upgrade proceeds instead of blocking;
 *   - `onblocked` rejects with something a reader can act on, for the case the
 *     other end has no such handler (an older build, another tab);
 *   - `transaction.onabort` settles a request whose transaction was torn down
 *     rather than completed — a closing connection, or a quota refusal — which
 *     fires neither `success` nor `error` on the request itself.
 *
 * The same shape as `./lib/walletSnapshot.ts`, which takes no cached connection
 * at all and so needed only two of the three.
 */
async function database(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) throw new Error('IndexedDB is unavailable in this browser.');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      if (!request.result.objectStoreNames.contains('private-state')) {
        request.result.createObjectStore('private-state');
      }
    };
    request.onerror = () => reject(request.error ?? new Error('Unable to open Passport profile storage.'));
    request.onblocked = () =>
      reject(
        new Error(
          'Passport profile storage is held open elsewhere. Close Passport’s other tabs and try again.',
        ),
      );
    request.onsuccess = () => {
      const db = request.result;
      /* Let the other opener upgrade rather than making it wait on us. Nothing
         here holds a transaction across awaits, so closing is always safe: the
         next call opens again. */
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

async function request<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const result = operation(transaction.objectStore(STORE));
    result.onsuccess = () => resolve(result.result);
    result.onerror = () => reject(result.error ?? new Error('Passport profile storage request failed.'));
    /* An aborted transaction fires nothing on the request, so without this the
       promise is another one that never settles. */
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Passport profile storage was interrupted.'));
  });
}

export async function loadDemoProfile(subjectId: string): Promise<DemoPassportProfile | null> {
  return (await request('readonly', (store) => store.get(subjectId))) ?? null;
}

export async function saveDemoProfile(profile: DemoPassportProfile): Promise<void> {
  await request('readwrite', (store) => store.put(profile, profile.subjectId));
}

export async function deleteDemoProfile(subjectId: string): Promise<void> {
  await request('readwrite', (store) => store.delete(subjectId));
}

/* -------------------------------------------------------------------------- */
/* Local (passkey-route) profiles — one per credential                        */
/*                                                                            */
/* Before 2026/08/05 the passkey route kept a single per-browser record under */
/* the fixed key below. Profiles are now keyed per credential id so several   */
/* passkeys can each hold their own Passport in one browser; the legacy       */
/* record is migrated in place on first load and keeps its original scope.    */
/* -------------------------------------------------------------------------- */

/** The pre-multi-passkey storage key AND its private-state scope accountId. */
export const LEGACY_LOCAL_PROFILE_ID = 'passport-local-device';

const LOCAL_PROFILE_PREFIX = 'passkey:';

/** Standard base64 (as stored by enrolment) → base64url, for stable keys. */
function base64UrlOf(credentialId: string): string {
  return credentialId.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** Storage key of the local profile bound to `credentialId`. */
export function localProfileId(credentialId: string): string {
  return `${LOCAL_PROFILE_PREFIX}${base64UrlOf(credentialId)}`;
}

/**
 * The scope accountId for a NEW multi-passkey profile. Distinct per credential
 * so two passkeys' encrypted private-state records can never collide in the
 * shared store. Migrated legacy profiles do NOT use this — they keep
 * {@link LEGACY_LOCAL_PROFILE_ID} so their stored state and wallet survive.
 */
export function localCredentialAccountId(credentialId: string): string {
  return `passport-local:${base64UrlOf(credentialId)}`;
}

export async function loadLocalProfileByCredential(
  credentialId: string,
): Promise<DemoPassportProfile | null> {
  return loadDemoProfile(localProfileId(credentialId));
}

/** Every passkey-route profile in this browser. */
export async function listLocalProfiles(): Promise<DemoPassportProfile[]> {
  const all = (await request('readonly', (store) => store.getAll())) as DemoPassportProfile[];
  return all.filter(
    (profile) =>
      typeof profile?.subjectId === 'string' && profile.subjectId.startsWith(LOCAL_PROFILE_PREFIX),
  );
}

/**
 * Re-keys the single legacy per-browser record under its credential id.
 *
 * Idempotent, and deliberately conservative: the migrated record keeps
 * `accountId: 'passport-local-device'`, so the private-state ciphertext and
 * the wallet-seed derivation are untouched — the same passkey opens the same
 * wallet and decrypts the same state as before. Returns the migrated (or
 * already-migrated) record, or null when this browser never held one.
 */
export async function migrateLegacyLocalProfile(): Promise<DemoPassportProfile | null> {
  const legacy = await loadDemoProfile(LEGACY_LOCAL_PROFILE_ID);
  if (!legacy) return null;
  const nextId = localProfileId(legacy.passkey.credentialId);
  const existing = await loadDemoProfile(nextId);
  const migrated: DemoPassportProfile =
    existing ?? {
      ...legacy,
      subjectId: nextId,
      accountId: legacy.accountId ?? LEGACY_LOCAL_PROFILE_ID,
    };
  if (!existing) await saveDemoProfile(migrated);
  await deleteDemoProfile(LEGACY_LOCAL_PROFILE_ID);
  return migrated;
}
