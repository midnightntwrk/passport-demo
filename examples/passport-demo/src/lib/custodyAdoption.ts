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
  /**
   * The passkey made on this device FOR this hand-off, by its credential id —
   * once it has been made (2026/09/27). See {@link bindAdoption}.
   *
   * Absent on a hand-off whose key is still to be made, and on every record
   * written before this field existed, which still read: they are the
   * recoveries that were in flight when it was added.
   */
  readonly credentialId?: string;
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
    /* A credential that is there and is not a credential is not something this
       build wrote. Read as unbound, it would be a hand-off any key could take. */
    const credentialId = record.credentialId;
    if (credentialId !== undefined && (typeof credentialId !== 'string' || credentialId.length === 0)) {
      return null;
    }
    return {
      network: record.network as string,
      address: record.address as string,
      name: record.name as string,
      socialUser: record.socialUser as string,
      ...(credentialId === undefined ? {} : { credentialId }),
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
 * Ties the hand-off to the key made on this device for it, and returns what is
 * stored afterwards (2026/09/27).
 *
 * WHY THE KEY IS WRITTEN DOWN. A hand-off used to be resumed by ANY key on this
 * device while its sign-in was signed in, and it was cleared only when it
 * finished. So a recovery that failed here, followed by a brand-new Passport
 * made on the same browser, was resumed the moment that Passport added the same
 * sign-in as its way back: the screen jumped to "Adding this device to …" and
 * offered the new Passport's key to the old account — on Android, live, and
 * again after every reload. From here on only the key made for the hand-off
 * resumes it.
 *
 * NEVER MOVED TO ANOTHER KEY: a hand-off already tied to one is returned as it
 * is. Nothing is written when there is no hand-off.
 */
export function bindAdoption(storage: CustodyStorage, credentialId: string): AdoptionHandoff | null {
  const handoff = loadAdoption(storage);
  if (handoff === null || handoff.credentialId !== undefined) return handoff;
  const bound: AdoptionHandoff = { ...handoff, credentialId };
  saveAdoption(storage, bound);
  return bound;
}

/**
 * Forget it, once the new key is on the account or the reader has given up.
 *
 * CLEARED ON SUCCESS AND ON ABANDONMENT, never on a failure that could be
 * retried: a hand-off deleted because the chain was unreachable is a reader
 * sent back to the beginning of a flow that had already worked. And, since
 * 2026/09/27, when it has gone STALE — see {@link adoptionStale}.
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
  /**
   * The credential of the key this device is signed in with — `profile` in
   * `App.tsx` — or null where there is none.
   */
  readonly credentialId: string | null;
  /**
   * Whether that key already holds a Passport of its own in this browser, from
   * storage alone — see {@link deviceKeyHoldsPassport}. False where there is no
   * key.
   */
  readonly holdsPassport: boolean;
  /**
   * Whether this browser holds any Passport that is not this recovery's own —
   * see {@link browserHoldsOtherPassport}. Read only for a hand-off not tied to
   * a key yet.
   */
  readonly otherPassports: boolean;
  /**
   * The sign-in that is signed in, by the key its stores are filed under (its
   * address, lower-cased), or null where none is.
   */
  readonly socialUser: string | null;
}

/**
 * Which half of a recovery is next, decided without asking for a ceremony — and
 * decided from STORAGE, never from an open wallet, so a stale hand-off cannot
 * win the beat in which a wallet is still opening (2026/09/27).
 *
 * THE NETWORK IS PART OF IT. A hand-off written on one network is not a
 * recovery on another: the account address means nothing there, and adopting a
 * key into it would be adding a key to whatever happens to live at that address
 * elsewhere. An app that has not settled on a network yet is `idle` rather than
 * blocked, because "not yet" and "no" are different answers and only one of
 * them is worth a sentence.
 *
 * ONLY THE KEY MADE FOR IT RESUMES IT. A hand-off tied to a key
 * ({@link bindAdoption}) is resumed by that key and by no other. One that is not
 * tied yet is a key still to be made: with no key here, that is the enrolment
 * the hand-off is waiting for. With a key here it is a record from before keys
 * were tied (the enrolment ties it the moment the key exists), and it may carry
 * on only where this browser holds no Passport at all but the recovery's own —
 * the new device it was written for. A key with a Passport of its own is
 * somebody's Passport and never the new device a recovery made; and a Passport
 * whose key cannot be named without a ceremony is still a Passport this
 * browser holds (the live defect of 2026/09/27, see {@link bindAdoption}).
 *
 * A KEY THAT HOLDS A PASSPORT ENDS IT. For the key made for the hand-off, that
 * is the second half having landed — the pointer it writes is how this reads —
 * and running it again on every open would cost an approval and a transaction
 * on every open, for an add the chain already has.
 */
export function adoptionStage(input: AdoptionStageInput): AdoptionStage {
  const { handoff } = input;
  if (handoff === null) return 'idle';
  if (input.network === null) return 'idle';
  if (handoff.network !== input.network) return 'idle';
  if (adoptionStale(input)) return 'idle';
  if (input.credentialId === null) return handoff.credentialId === undefined ? 'enrol' : 'idle';
  if (handoff.credentialId !== undefined && handoff.credentialId !== input.credentialId) return 'idle';
  if (input.holdsPassport) return 'idle';
  return input.socialUser === null ? 'blocked' : 'adopt';
}

/**
 * Whether the hand-off should be FORGOTTEN now, rather than merely not run
 * (2026/09/27). Two things make one stale, and neither can be undone by
 * waiting:
 *
 *   - a sign-in is signed in and it is not the one that found the Passport.
 *     The recovery was checked against that sign-in's key; no other can
 *     approve the add, and a person signed in as somebody else is not in the
 *     middle of this recovery.
 *   - the key signed in here holds a Passport of its own and is not the key
 *     made for this hand-off — or the hand-off is tied to no key, and this
 *     browser holds a Passport that is not the recovery's own. The device is
 *     somebody's Passport, and a recovery left over from before it must never
 *     be offered it again.
 *
 * The key made for the hand-off holding a Passport is NOT stale: that is the
 * hand-off landing, and it is cleared by the run that landed it.
 */
export function adoptionStale(input: AdoptionStageInput): boolean {
  const { handoff } = input;
  if (handoff === null) return false;
  if (input.socialUser !== null && input.socialUser !== handoff.socialUser.toLowerCase()) return true;
  if (input.credentialId === null || handoff.credentialId === input.credentialId) return false;
  return input.holdsPassport || (handoff.credentialId === undefined && input.otherPassports);
}

/**
 * Forgets the stored hand-off if it is stale ({@link adoptionStale}), and says
 * whether it did. The host runs it whenever the answer may have changed; a
 * hand-off that is not stale is left exactly where it is.
 */
export function forgetStaleAdoption(storage: CustodyStorage, input: AdoptionStageInput): boolean {
  if (!adoptionStale(input)) return false;
  clearAdoption(storage);
  return true;
}

/**
 * `passport-account-custody:v1` — the account custody record store, keyed
 * `user|network`. `CUSTODY_STORAGE_KEY` in `../identity/custodyContractPlan.ts`,
 * written out rather than imported for the reason in this module's header, and
 * held equal to it by `./custodyAdoption.test.ts`.
 */
export const CUSTODY_RECORDS_KEY = 'passport-account-custody:v1';

/**
 * Whose account custody records this browser holds — the user half of every
 * key in the record store, read without reading the records. A storage that
 * refuses, or holds something that is not a map, reads as nobody's.
 */
export function custodyRecordUsers(storage: CustodyStorage): string[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(CUSTODY_RECORDS_KEY) ?? '{}');
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    return Object.keys(parsed).map((key) => key.split('|')[0] as string);
  } catch {
    return [];
  }
}

/**
 * Whether this browser holds any Passport that is not the recovery's own: a
 * pointer, a prototype account, or an account custody record under any user
 * but the sign-in that found the Passport — whose record is the one the second
 * half writes for itself (step 0, `../identity/custodyAdopt.ts`).
 *
 * THE BROWSER, AND NOT THE KEY, because a hand-off not tied to a key has no key
 * to ask about, and a custody Passport's record is filed under a key that costs
 * a ceremony to name: a Passport made here whose pointer is missing is found by
 * its record, or not at all.
 */
export function browserHoldsOtherPassport(input: {
  readonly handoff: AdoptionHandoff;
  readonly pointers: Readonly<Record<string, string>>;
  readonly prototypeRecords: Readonly<Record<string, unknown>>;
  /** {@link custodyRecordUsers}. */
  readonly custodyUsers: readonly string[];
}): boolean {
  if (Object.keys(input.pointers).length > 0) return true;
  if (Object.keys(input.prototypeRecords).length > 0) return true;
  const own = input.handoff.socialUser.toLowerCase();
  return input.custodyUsers.some((user) => user.toLowerCase() !== own);
}

/**
 * Whether a key holds a Passport of its own in this browser, read from storage
 * and nothing else, so the answer is there before any wallet has opened.
 *
 * A POINTER ON ANY NETWORK, OR A PROTOTYPE ACCOUNT ON ANY NETWORK. The pointer
 * is how a key reaches its account custody Passport (`./custodyRoute.ts`), and
 * the record of the key's Passport lives under the key the pointer names, so
 * the pointer is the whole of what can be read about it without a ceremony. A
 * prototype account record of any status counts, for the reason `App.tsx`
 * routes on one: a failed deploy is a Passport half made. Any network, because
 * a key made for a recovery is new, and has nothing anywhere.
 */
export function deviceKeyHoldsPassport(input: {
  readonly credentialId: string;
  /** Every pointer this browser holds, keyed `credential|network`. */
  readonly pointers: Readonly<Record<string, string>>;
  /** Every prototype account record this browser holds. */
  readonly prototypeRecords: Readonly<Record<string, { readonly credentialId: string }>>;
}): boolean {
  const mine = `${input.credentialId}|`;
  if (Object.keys(input.pointers).some((key) => key.startsWith(mine))) return true;
  return Object.values(input.prototypeRecords).some((record) => record.credentialId === input.credentialId);
}

/* -------------------------------------------------------------------------- */
/* What a second half that did not finish says                                */
/* -------------------------------------------------------------------------- */

/**
 * THE SENTENCES A FAILED HAND-OFF IS SHOWN WITH (2026/09/26).
 *
 * Until today there were none. A second half that failed was caught, written
 * to the console, and never run again, so "Adding this device to …" stayed on
 * screen for ever over a flow that had already stopped — which is what a live
 * recovery on a new device met on 2026/09/26. Every failure now ends in one of
 * these and a press that runs the second half again, which is safe because
 * every step of it is.
 *
 * HERE, AND NOT BESIDE THE CODE THAT RAISES THEM, because the host has to be
 * able to say the first one even when the module that raises the others never
 * loaded: `App.tsx` imports this file on every render, and this file imports
 * nothing at run time. Which failure earns which sentence is
 * `./recoveryAdd.ts#adoptionFailureSentence`.
 *
 * None of them names what holds the Passport, and none of them blames the
 * person: each says what is true of the Passport and what the press will do.
 */

/**
 * Not added, and nothing changed. TRUE of every failure that is not one of the
 * sentences below: each of those is raised before anything is handed over, or
 * is the answer a handed-over add was definitely refused with.
 */
export const ADOPTION_NOT_ADDED =
  'This device was not added to your Passport, and nothing on it changed. Try again.';

/**
 * Handed over, and not seen to land. The add is idempotent, so the press it
 * points at is safe: a key that did land is found and nothing is asked for.
 */
export const ADOPTION_UNCONFIRMED =
  'We could not confirm that this device was added. Try again to check: it is never added twice.';

/** The passkey prompt was dismissed or refused. */
export const ADOPTION_PASSKEY_DECLINED =
  'This device was not added because the passkey was not confirmed. Try again.';

/**
 * Signed in as somebody other than the account that found the Passport.
 *
 * The recovery was CHECKED against one sign-in's key: the name resolved and
 * that key was in the account's device set. A different sign-in would be asked
 * to approve an addition it has no part in, and the account would refuse it.
 */
export const ADOPTION_OTHER_SIGN_IN =
  'This is not the account that found your Passport. Sign in with the one you added as your way back.';

/**
 * This sign-in already opens a DIFFERENT Passport in this browser.
 *
 * A sign-in's record on a device is one per network, so bringing a second
 * Passport here through it would write over the first. It is said and refused
 * rather than done.
 */
export const ADOPTION_OTHER_PASSPORT =
  'This account already opens a different Passport in this browser, so this one cannot be added here.';
