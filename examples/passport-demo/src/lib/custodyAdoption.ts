/**
 * COMING BACK ON A NEW DEVICE — the hand-off between the two halves of it, and
 * the rule that says which half is next.
 *
 * WHAT THE FLOW IS (2026/09/21)
 * -----------------------------
 * Somebody whose phone is gone opens Passport on a new one. There is no key on
 * this device, so there is nothing to sign in with. They choose the social
 * sign-in, sign in with the provider they backed up with, and type the name
 * they already hold. Passport resolves the name, checks with Midnight that the
 * key behind that sign-in really is part of that Passport — which is the whole
 * of the check, and knowing the name is not part of it — and then makes a NEW
 * key on this device and adds it to the Passport, authorised by the sign-in.
 *
 * From that moment the new device's own key is what approves, exactly as on the
 * device that is gone. The sign-in goes back to being the spare.
 *
 * WHY IT IS TWO HALVES AND A RECORD BETWEEN THEM
 * ----------------------------------------------
 * Making a key on this device is an enrolment, and an enrolment CHANGES WHICH
 * PASSPORT THE APP THINKS IT IS SHOWING: `choosePassportIdentity` answers
 * `passkey` the moment a profile exists, and it is right to — a device key
 * always wins over a sign-in. So the screen that started the recovery is
 * replaced by the one the new key routes to, mid-ceremony, and anything held in
 * that screen's state at the time is gone with it.
 *
 * A record in storage survives that, and survives the reload of a browser that
 * was closed between the two halves, which is the same thing. It carries only
 * what the second half cannot work out for itself: which account, under which
 * name, found by which sign-in.
 *
 * WHAT IT DELIBERATELY DOES NOT CARRY
 * -----------------------------------
 * The viewing secret that opens this account's deliveries. It cannot: on the
 * device that is gone that secret is derived from the key on that device, and
 * nothing a social sign-in can reproduce on a new one will produce it again —
 * the embedded signer's ECDSA is randomised, so even a signature over a fixed
 * message is a different signature every time (audited 2026/09/16). So what
 * comes back here is AUTHORITY and not the view: the Passport can be opened,
 * paid, and spent from, and the descriptions of tokens it was sent before the
 * new device existed stay sealed to the key on the device that received them.
 *
 * The view comes back by another road (2026/09/26): the old device kept that
 * key in the sign-in's own metadata when it added the sign-in as its way back,
 * and the last step of the recovery reads it from there
 * (`../identity/signInViewingKeys.ts`). This record still carries no key: a
 * hand-off is a note about which account to join, and nothing it is used for
 * needs one.
 *
 * NOTHING AT RUN TIME BUT THE STANDARD LIBRARY, for the reason
 * `./custodyRoute.ts` gives: `App.tsx` asks this question on every render, and
 * a question asked from the entry chunk must not drag the custody layer into
 * the entry chunk to answer it.
 */

import type { CustodyStorage } from '../identity/custodyContractPlan.js';

/** `passport-account-custody-adopt:v1` — one recovery, in flight. */
export const CUSTODY_ADOPT_KEY = 'passport-account-custody-adopt:v1';

/** The account a recovery has found, and how it was found. */
export interface AdoptionHandoff {
  /** The network it was found on. A recovery does not cross networks. */
  readonly network: string;
  /** The account's address, as hex. */
  readonly address: string;
  /** The `.night` name that was typed, without its suffix. */
  readonly name: string;
  /** The key every store of the sign-in's own is filed under. */
  readonly socialUser: string;
}

/**
 * The recovery in flight, or null.
 *
 * ONE AT A TIME, and not a map. Two recoveries in flight in one browser would
 * mean two accounts wanting the same new key, and there is no order in which
 * that ends well; the second write replaces the first, which is what a reader
 * starting again means by starting again.
 */
export function loadAdoption(storage: CustodyStorage): AdoptionHandoff | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(CUSTODY_ADOPT_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const fields = ['network', 'address', 'name', 'socialUser'] as const;
    for (const field of fields) {
      if (typeof record[field] !== 'string' || record[field].length === 0) return null;
    }
    return {
      network: record.network as string,
      address: record.address as string,
      name: record.name as string,
      socialUser: record.socialUser as string,
    };
  } catch {
    return null;
  }
}

/** Write the hand-off. Replaces whatever was there — see {@link loadAdoption}. */
export function saveAdoption(storage: CustodyStorage, handoff: AdoptionHandoff): void {
  try {
    storage.setItem(CUSTODY_ADOPT_KEY, JSON.stringify(handoff));
  } catch (cause) {
    console.warn('[account-custody] could not write down the Passport being brought back', cause);
  }
}

/**
 * Forget it, once the new key is on the account or the reader has given up.
 *
 * CLEARED ON SUCCESS AND ON ABANDONMENT, never on a failure that could be
 * retried: a hand-off deleted because the chain was unreachable is a reader
 * sent back to the beginning of a flow that had already worked.
 */
export function clearAdoption(storage: CustodyStorage): void {
  try {
    storage.removeItem(CUSTODY_ADOPT_KEY);
  } catch {
    /* A hand-off that could not be cleared is re-run, and re-running is
       harmless: the second add finds the key already there and the record
       already written. Nothing to say to anybody about it. */
  }
}

/** Which half of a recovery is next. */
export type AdoptionStage =
  /** Nothing in flight. */
  | 'idle'
  /** Found, and waiting for a key to be made on this device. */
  | 'enrol'
  /** A key exists here; add it to the account, with the sign-in approving. */
  | 'adopt'
  /** Found, but the sign-in that found it is no longer there to approve. */
  | 'blocked';

/** What the host knows when it has to choose. */
export interface AdoptionStageInput {
  /** The hand-off, or null. */
  readonly handoff: AdoptionHandoff | null;
  /**
   * The network the app is on, or null where even that is not settled.
   *
   * The APP's network and not an open wallet's: a device with no key on it has
   * no wallet, and that is the whole population this flow exists for.
   */
  readonly network: string | null;
  /** Whether a key exists on this device — `profile` in `App.tsx`. */
  readonly hasDeviceKey: boolean;
  /** Whether the sign-in that found the account is still signed in. */
  readonly socialSignedIn: boolean;
  /** Whether the new key is already recorded against this account. */
  readonly alreadyAdopted: boolean;
}

/**
 * Which half of a recovery is next, decided without asking for a ceremony.
 *
 * THE NETWORK IS PART OF IT. A hand-off written on one network is not a
 * recovery on another: the account address means nothing there, and adopting a
 * key into it would be adding a key to whatever happens to live at that address
 * elsewhere. A wallet that has not settled on a network yet is `idle` rather
 * than blocked, because "not yet" and "no" are different answers and only one
 * of them is worth a sentence.
 *
 * `alreadyAdopted` ends it. The second half is idempotent on the chain — adding
 * a key that is already enrolled inserts an element that is already in the set —
 * but it is not free: it costs an approval and a transaction, and a flow that
 * ran it on every open would ask for both on every open.
 */
export function adoptionStage(input: AdoptionStageInput): AdoptionStage {
  if (input.handoff === null) return 'idle';
  if (input.network === null) return 'idle';
  if (input.handoff.network !== input.network) return 'idle';
  if (input.alreadyAdopted) return 'idle';
  if (!input.hasDeviceKey) return 'enrol';
  return input.socialSignedIn ? 'adopt' : 'blocked';
}
