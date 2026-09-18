/**
 * WHICH FLOW A PASSKEY SIGN-IN BELONGS IN — the pointer, and the rule.
 *
 * NO IMPORTS AT RUN TIME, and that is the whole reason this module exists
 * rather than the rule living beside the custody stores it is about. `App.tsx`
 * asks this question on every render; importing it from
 * `identity/custodyContractSession.ts` would pull that module's record format,
 * its name store, and its stage machine into the entry chunk — 29,701 bytes of
 * it, the same measurement that moved `choosePassportIdentity` out here on
 * 2026/09/16. The storage handle is the injected three-method one the custody
 * layer takes, as a TYPE, which is erased.
 */

import type { CustodyStorage } from '../identity/custodyContractPlan.js';

/**
 * `passport-account-custody-passkey:v1` — the pointer from a passkey CREDENTIAL
 * to the account custody Passport it made, per credential and network.
 *
 * WHY A POINTER EXISTS AT ALL, when the account's own record is already stored.
 * Every custody store — the record, the wallet seed, the viewing-key slot, the
 * coin store, the name — is keyed by {@link custodyUserKey}, which for a passkey
 * is the DEVICE POINT: `jubjub:<pk.x>`. That is the right key, because it is
 * derived from the passkey and so is the same value on every device the passkey
 * syncs to, and because it is the same point the account's own device set holds
 * on chain, so a record found under it can be checked against the chain rather
 * than merely believed.
 *
 * But it is not FREE. Reaching it costs a user-verified WebAuthn assertion and
 * a derivation, and a routing decision made on every open cannot cost a
 * fingerprint. The credential id costs nothing — the sign-in already has it —
 * so it is what the app asks on open, and the answer it gets back is the device
 * point it may then read everything else with.
 *
 * SO THIS IS A ROUTE AND NOT A RECORD. It says which screen to open, never what
 * the account is; nothing is decided from it beyond that. A pointer that is
 * missing on a new device is exactly right: a passkey arriving somewhere new
 * with no pointer recovers by name, which derives the root with one assertion
 * and finds the account on chain, and writes the pointer on the way through.
 */
export const CUSTODY_PASSKEY_KEY = 'passport-account-custody-passkey:v1';

/** The map key. Credential ids are case-sensitive base64url, so they are not lowered. */
export function custodyPasskeyKey(credentialId: string, network: string): string {
  return `${credentialId}|${network}`;
}

/** Every pointer stored, or an empty map. A storage that throws reads as empty. */
export function loadCustodyPasskeyPointers(storage: CustodyStorage): Record<string, string> {
  let raw: string | null = null;
  try {
    raw = storage.getItem(CUSTODY_PASSKEY_KEY);
  } catch {
    return {};
  }
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const pointers: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.length > 0) pointers[key] = value;
    }
    return pointers;
  } catch {
    return {};
  }
}

/**
 * The user key this credential's Passport is filed under on this network, or
 * null.
 *
 * Null is "this app has not seen a Passport for this passkey here", which is
 * both "there is not one" and "there is one and this browser has never opened
 * it". The two are the same question to a router, and the second is answered
 * by recovery rather than by a longer read.
 */
export function loadCustodyPasskeyPointer(
  storage: CustodyStorage,
  credentialId: string,
  network: string,
): string | null {
  return loadCustodyPasskeyPointers(storage)[custodyPasskeyKey(credentialId, network)] ?? null;
}

/** Remember which Passport this passkey holds, merged into whatever else is stored. */
export function saveCustodyPasskeyPointer(
  storage: CustodyStorage,
  credentialId: string,
  network: string,
  user: string,
): void {
  const pointers = loadCustodyPasskeyPointers(storage);
  pointers[custodyPasskeyKey(credentialId, network)] = user;
  try {
    storage.setItem(CUSTODY_PASSKEY_KEY, JSON.stringify(pointers));
  } catch (cause) {
    console.warn(
      '[account-custody] could not remember which Passport this passkey holds',
      cause,
    );
  }
}

/**
 * Which flow a PASSKEY sign-in belongs in, decided without asking for a
 * ceremony.
 *
 *   `legacy`  — this credential already has a prototype account on this
 *               network. Everything about it stays exactly as it is: the
 *               eleven- and twelve-circuit Passports in production are not
 *               migrated (Hector, 2026/09/18), and this app has one flow for
 *               them, which is the one it has always had.
 *   `custody` — this credential has an account custody Passport here. Open it.
 *   `new`     — neither. A Passport made from here is made on the account
 *               custody contract.
 *
 * THE PROTOTYPE RECORD WINS OVER THE POINTER, and the order matters rather than
 * being arbitrary: a holder who has a working Passport must never be routed
 * anywhere but to it, whatever else a store has accumulated. The reverse
 * ordering would take somebody's money off their screen on the strength of a
 * pointer written by a setup that failed.
 */
export type PasskeyPassportRoute = 'legacy' | 'custody' | 'new';

export function passkeyPassportRoute(input: {
  /** Whether a prototype account contract is recorded for this credential here. */
  readonly hasPrototypeAccount: boolean;
  /** The account custody pointer for this credential here, or null. */
  readonly custodyUser: string | null;
}): PasskeyPassportRoute {
  if (input.hasPrototypeAccount) return 'legacy';
  return input.custodyUser === null ? 'new' : 'custody';
}

