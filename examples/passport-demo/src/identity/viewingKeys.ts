/**
 * THE EARLIER VIEWING KEYS A PASSPORT HOLDS (2026/09/26).
 *
 * WHY THIS EXISTS
 * ---------------
 * An account custody Passport is told what shielded coin it received by a note
 * in its own inbox, sealed to the account's viewing key (`./custodyInbox.ts`).
 * The key the account advertises is the one on the device that holds it, and a
 * Passport brought back on a new device through the sign-in points the account
 * at the NEW device's key (`rotate_enc_key`, `./custodyAdopt.ts`). Every note
 * delivered before that rotation stays sealed to the key on the device that is
 * gone — so mUSD received before a lost phone was on chain, the account's, and
 * neither visible nor spendable from anywhere.
 *
 * The answer for the demo is that the viewing key travels with the way back:
 * when the sign-in is added, the key is kept in that sign-in's own metadata
 * with the provider, and when the Passport is brought back through the same
 * sign-in the key is read back (`./signInViewingKeys.ts`). This module is where
 * it is put back to. (For a few hours on 2026/09/26 the key travelled in the
 * password backup instead, #108; that road is gone.)
 *
 * WHY THE RESTORED KEY SITS BESIDE THE CURRENT ONE, AND DOES NOT REPLACE IT
 * ------------------------------------------------------------------------
 * The account's CURRENT key stays exactly where it has always lived — the coin
 * store's `encSecretKeyHex` (`./k1CoinStore.ts`), the key `rotate_enc_key`
 * pointed the account at, and the one the new passkey re-derives on any device
 * it syncs to. A restored key is an EARLIER one, kept here in a list per
 * account, and the inbox walk tries every key it holds on every note
 * (`readInboxCustody`). Three reasons that is the design rather than skipping
 * the rotation when the sign-in supplies the original key:
 *
 *   1. THE ORDER THINGS HAPPEN IN. The rotation runs the moment the new key is
 *      on the account, as the last step of coming back (`./custodyAdopt.ts`).
 *      The sign-in's answer comes after it, or on a later open, or never.
 *      Holding both keys works whichever comes first; skipping the rotation
 *      would make an enrolment that is designed to resume by itself after a
 *      closed tab wait on a second party.
 *   2. THE SIGN-IN STAYS A BRIDGE TO A CLOSED SET. Skipping the rotation would
 *      keep every FUTURE delivery sealed to a key the new passkey cannot
 *      re-derive, so a synced copy of that passkey on another device — or this
 *      device after its storage is cleared — would read nothing new without the
 *      sign-in again. With the rotation, the new passkey reads everything from
 *      now on by itself, and the earlier key is needed only for a CLOSED set of
 *      notes.
 *   3. A KEY THAT OPENS NOTHING COSTS NOTHING. A note sealed to one key fails
 *      authentication under any other and is skipped, which is the inbox's
 *      normative rule anyway (MIP-0012 §6.5). Trying two keys is two X25519
 *      agreements per note, on a list that holds a handful.
 *
 * WHAT A VIEWING KEY CAN AND CANNOT DO
 * ------------------------------------
 * It decrypts notes. It authorises nothing: every spend is a device signature
 * checked by the account itself, and no device key is here or with the
 * sign-in. Somebody holding a viewing key learns what the account has been
 * paid and cannot move any of it.
 *
 * NO REACT AND NO CHAIN. The storage is handed in, as `../lib/backupDevice.ts`
 * takes it, so every rule here is drilled against a map.
 */

import { normalisedColourHex } from '../lib/colour.js';
import type { CustodyStorage } from './custodyContractPlan.js';

/** `localStorage` key for the earlier viewing keys, per account. */
export const EARLIER_VIEWING_KEYS_KEY = 'passport-earlier-viewing-keys:v1';

/**
 * How many earlier keys one account keeps.
 *
 * One per recovery, so a real account holds one or two. The ceiling is there
 * because this list is walked against every note on every read, and whatever
 * the sign-in hands back must not be able to make that walk as long as it
 * likes.
 */
export const EARLIER_VIEWING_KEYS_PER_ACCOUNT = 8;

/** Which account, on which network — `./k1CoinStore.ts`'s `K1Account`. */
export interface ViewingKeyAccount {
  readonly network: string;
  readonly address: string;
}

/** The storage this module reads. A `CustodyStorage` minus what it never calls. */
export type ViewingKeyStorage = Pick<CustodyStorage, 'getItem' | 'setItem'>;

/** A 32-byte viewing secret as lowercase hex, or null when it is not one. */
export function normalisedViewingSecret(value: unknown): string | null {
  return typeof value === 'string' ? normalisedColourHex(value) : null;
}

/**
 * The key an account's rows are filed under: network and address, both.
 *
 * Null for an account that is not one — no network, or an address that is not
 * 64 hex characters — so no row can be written under a key that collides with
 * somebody else's.
 */
export function viewingKeyAccountKey(account: ViewingKeyAccount): string | null {
  if (typeof account.network !== 'string' || account.network.trim() === '') return null;
  const address = normalisedColourHex(account.address);
  return address === null ? null : `${account.network}::${address}`;
}

/** A JSON object from storage, or an empty one. A storage that throws reads as empty. */
function readMap(storage: ViewingKeyStorage, key: string): Record<string, unknown> {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return Object.create(null) as Record<string, unknown>;
  }
  if (raw === null) return Object.create(null) as Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return Object.create(null) as Record<string, unknown>;
    }
    /* A NULL-PROTOTYPE COPY, for the reason `./aliasStore.ts` gives: a key of
       `__proto__` in an ordinary object assigns a prototype and stores
       nothing. */
    return Object.assign(Object.create(null) as Record<string, unknown>, parsed);
  } catch {
    return Object.create(null) as Record<string, unknown>;
  }
}

/** Writes a map back. Returns whether the write was taken. */
function writeMap(storage: ViewingKeyStorage, key: string, map: Record<string, unknown>): boolean {
  try {
    storage.setItem(key, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

/** The secrets one row holds, normalised, deduplicated, in the order written. */
function secretsFrom(row: unknown): string[] {
  if (!Array.isArray(row)) return [];
  const kept: string[] = [];
  for (const value of row) {
    const secret = normalisedViewingSecret(value);
    if (secret !== null && !kept.includes(secret)) kept.push(secret);
  }
  return kept.slice(0, EARLIER_VIEWING_KEYS_PER_ACCOUNT);
}

/** The earlier viewing keys this browser holds for one account, oldest first. */
export function loadEarlierViewingKeys(
  storage: ViewingKeyStorage,
  account: ViewingKeyAccount,
): string[] {
  const key = viewingKeyAccountKey(account);
  if (key === null) return [];
  return secretsFrom(readMap(storage, EARLIER_VIEWING_KEYS_KEY)[key]);
}

/** What one write of earlier keys did. */
export type EarlierViewingKeyOutcome =
  | { readonly kind: 'added' }
  | { readonly kind: 'held'; readonly reason: string }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * Keeps one earlier viewing key for an account.
 *
 * `current` is the key the account's coin store already reads with. A restored
 * key equal to it is not an earlier one — it is the key this device already
 * holds, which is what the sign-in hands back to the device that put it there
 * — and it is reported as held rather than written twice.
 *
 * THE LIST IS BOUNDED AND THE OLDEST KEY IS KEPT. A list at its ceiling refuses
 * a newcomer rather than dropping the first key it ever held: the first key is
 * the one the oldest notes are sealed to, and nothing else opens them.
 */
export function rememberEarlierViewingKey(
  storage: ViewingKeyStorage,
  account: ViewingKeyAccount,
  secret: string,
  current: string | null,
): EarlierViewingKeyOutcome {
  const key = viewingKeyAccountKey(account);
  if (key === null) {
    return { kind: 'refused', reason: 'the account is not one this Passport can read' };
  }
  const normalised = normalisedViewingSecret(secret);
  if (normalised === null) {
    return { kind: 'refused', reason: 'the key is not the size a viewing key is' };
  }
  if (normalised === normalisedViewingSecret(current)) {
    return { kind: 'held', reason: 'this device already reads this account with that key' };
  }
  const map = readMap(storage, EARLIER_VIEWING_KEYS_KEY);
  const existing = secretsFrom(map[key]);
  if (existing.includes(normalised)) {
    return { kind: 'held', reason: 'this device already holds that key for this account' };
  }
  if (existing.length >= EARLIER_VIEWING_KEYS_PER_ACCOUNT) {
    return {
      kind: 'refused',
      reason: `this device already holds ${EARLIER_VIEWING_KEYS_PER_ACCOUNT} earlier keys for this account`,
    };
  }
  map[key] = [...existing, normalised];
  if (!writeMap(storage, EARLIER_VIEWING_KEYS_KEY, map)) {
    return { kind: 'refused', reason: 'this browser did not store it' };
  }
  /* COUNTED ONLY WHERE IT IS READ BACK, the rule `./backup.ts` keeps for every
     record a restore claims to have written, and `./signInViewingKeys.ts` for
     every key it asks the sign-in to keep. */
  return loadEarlierViewingKeys(storage, account).includes(normalised)
    ? { kind: 'added' }
    : { kind: 'refused', reason: 'this browser did not store it' };
}

/**
 * Every key the inbox walk should try for one account: the current key first,
 * then each earlier one, with no key twice.
 *
 * The current key first because it opens every note written from the rotation
 * on, which is most of them; the earlier ones are the fallback for the notes
 * that came before.
 */
export function viewingSecretsFor(
  storage: ViewingKeyStorage,
  account: ViewingKeyAccount,
  current: string | null,
): string[] {
  const secrets: string[] = [];
  const head = normalisedViewingSecret(current);
  if (head !== null) secrets.push(head);
  for (const earlier of loadEarlierViewingKeys(storage, account)) {
    if (!secrets.includes(earlier)) secrets.push(earlier);
  }
  return secrets;
}
