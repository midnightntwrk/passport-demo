/**
 * BACKING A PASSPORT UP — when to offer it, how often to ask again, and what
 * the offer is allowed to say.
 *
 * THE DECISION THIS FILE ENCODES (2026/09/21, Hector, Nicolas, Karmel)
 * --------------------------------------------------------------------
 * A Passport is held by the key on the device that made it. That key is the
 * default and it stays the default: it is what approves every payment, and
 * nothing here changes that. What the decision adds is a SECOND key on the same
 * Passport — a social sign-in, added by the first one — so that somebody who
 * loses the device has a way back in that is not "type these twelve words".
 *
 * So this is a BACKUP and not a second Passport. Until 2026/09/21 a social
 * sign-in could make a Passport of its own, with no device key anywhere in it;
 * that shape is retired (see `./custodyAdoption.ts`, which is the way back in
 * that replaces it) and a sign-in's only job now is to be the spare key.
 *
 * WHY THE OFFER IS OPTIONAL AND STILL COMES BACK
 * ----------------------------------------------
 * A reader who has just made a Passport has not yet been paid anything, so the
 * offer is worth the least at exactly the moment it is easiest to accept, and
 * worth the most on the day the phone goes in the river. Forcing it would put a
 * vendor sign-in in front of somebody who came here to avoid one. Asking once
 * and never again would mean nearly nobody has a spare key.
 *
 * The compromise is a dismissal with a clock on it: pressing "Not now" is
 * honoured, and the offer comes back a day later. Not on the next render, and
 * not on the next open — a card that reappears when a balance refreshes is a
 * card that gets dismissed reflexively, which is worse than not asking.
 *
 * NO REACT, NO STORAGE FORMAT BEYOND ONE KEY, AND NO CONTRACT. The ceremony
 * itself is `../identity/custodyContractClient.ts`'s `addDeviceK1`; what lives
 * here is the decision about whether to ask, and the words used to ask.
 */

import type { CustodyStorage } from '../identity/custodyContractPlan.js';

/**
 * `passport-account-custody-backup:v1` — what this browser knows about the
 * spare key on each Passport it holds.
 *
 * PER ACCOUNT AND PER NETWORK, keyed the way every other custody store is
 * keyed, because "backed up" is a fact about one account: a reader with two
 * Passports on one browser has backed up neither by backing up one.
 */
export const CUSTODY_BACKUP_KEY = 'passport-account-custody-backup:v1';

/** How long a "Not now" is honoured for. One day, and a day is a judgement. */
export const BACKUP_REMINDER_MS = 24 * 60 * 60 * 1000;

/** What this browser recorded about one Passport's spare key. */
export interface BackupRecord {
  /** When the spare key was added, or undefined while there is not one. */
  readonly doneAt?: number;
  /** The provider it was added with, for the line that says so afterwards. */
  readonly provider?: string;
  /** When the offer was last put away. */
  readonly dismissedAt?: number;
}

/** The map key. Lower-cased on the user, as {@link custodyEncKeySlot} is. */
export function backupSlot(user: string, network: string): string {
  return `${user.toLowerCase()}|${network}`;
}

/** Everything this browser has recorded. A storage that throws reads as empty. */
export function loadBackupRecords(storage: CustodyStorage): Record<string, BackupRecord> {
  let raw: string | null = null;
  try {
    raw = storage.getItem(CUSTODY_BACKUP_KEY);
  } catch {
    return {};
  }
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const records: Record<string, BackupRecord> = {};
    for (const [slot, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        records[slot] = value;
      }
    }
    return records;
  } catch {
    return {};
  }
}

/** What this browser knows about ONE Passport's spare key. */
export function loadBackupRecord(
  storage: CustodyStorage,
  user: string,
  network: string,
): BackupRecord | null {
  return loadBackupRecords(storage)[backupSlot(user, network)] ?? null;
}

/**
 * Merge a change into what is recorded, leaving every other field alone.
 *
 * MERGED RATHER THAN REPLACED, because the two things written here are written
 * at different moments by different code paths: a dismissal by a press, and the
 * spare key by a confirmed transaction. A write that replaced the record would
 * let a "Not now" pressed on a stale card erase the fact that the account has a
 * spare key on it, and the offer would then be made for a second time to
 * somebody who has already accepted it.
 */
export function saveBackupRecord(
  storage: CustodyStorage,
  user: string,
  network: string,
  change: BackupRecord,
): void {
  const records = loadBackupRecords(storage);
  const slot = backupSlot(user, network);
  records[slot] = { ...records[slot], ...change };
  try {
    storage.setItem(CUSTODY_BACKUP_KEY, JSON.stringify(records));
  } catch (cause) {
    /* Worth a line and not worth throwing: the spare key is on the chain
       either way, and refusing here would undo nothing and lose the run. */
    console.warn('[account-custody] could not remember this Passport’s spare key', cause);
  }
}

/* -------------------------------------------------------------------------- */
/* A Passport started from a sign-in                                          */
/* -------------------------------------------------------------------------- */

/**
 * `passport-account-custody-backup-intent:v1` — a Passport being made BY
 * somebody who is already signed in with a provider, and the two things that
 * have to happen to it without being asked for again.
 *
 * WHY IT EXISTS (live, 2026/09/21). Pressing "Create my Passport" while signed
 * in has to give the passkey road and nothing else: the key is made on this
 * device, the setup runs, the name is claimed, and the sign-in already in hand
 * is attached as the spare — one press, and one approval for the spare at the
 * end. But making the key REPLACES the screen that was pressed, exactly as a
 * recovery does (`./custodyAdoption.ts`), so the intent behind the press has to
 * outlive it or the reader lands on the ordinary setup screen and presses the
 * same button a second time.
 *
 * ONE RECORD, TWO STAGES, and they are written down rather than inferred:
 * "the setup has not been started yet" and "the setup is running or done and the
 * spare key has not been attached yet" are different, and a flow that guessed
 * between them would either deploy a second Passport or never attach anything.
 */
export const CUSTODY_BACKUP_INTENT_KEY = 'passport-account-custody-backup-intent:v1';

/** How far a Passport started from a sign-in has got. */
export type BackupIntentStage =
  /** The key is made; the setup itself has not been started. */
  | 'setting-up'
  /** The setup is under way or finished; the spare key is not attached yet. */
  | 'backing-up';

export interface BackupIntent {
  /** The network it was started on. An intent does not cross networks. */
  readonly network: string;
  readonly stage: BackupIntentStage;
}

/** The intent in flight, or null. */
export function loadBackupIntent(storage: CustodyStorage): BackupIntent | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(CUSTODY_BACKUP_INTENT_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const network = record.network;
    const stage = record.stage;
    if (typeof network !== 'string' || network.length === 0) return null;
    if (stage !== 'setting-up' && stage !== 'backing-up') return null;
    return { network, stage };
  } catch {
    return null;
  }
}

/** Write it. Replaces whatever was there: one Passport is being made at a time. */
export function saveBackupIntent(storage: CustodyStorage, intent: BackupIntent): void {
  try {
    storage.setItem(CUSTODY_BACKUP_INTENT_KEY, JSON.stringify(intent));
  } catch (cause) {
    console.warn('[account-custody] could not write down how this Passport was started', cause);
  }
}

/** Forget it, once the spare key is attached or the attempt is over. */
export function clearBackupIntent(storage: CustodyStorage): void {
  try {
    storage.removeItem(CUSTODY_BACKUP_INTENT_KEY);
  } catch {
    /* An intent that could not be cleared costs one more attempt at a step
       that is safe to repeat. Nothing to say to anybody about it. */
  }
}

/**
 * Whether the setup should start on its own, without a second press.
 *
 * THE PRESS ALREADY HAPPENED. This is not a flow spending somebody's sponsored
 * fees unasked: they pressed "Create my Passport", and making the key on this
 * device is a step INSIDE that press rather than an answer to it. What this
 * rule prevents is the opposite defect — the same button offered again, on a
 * screen that looks like the one they thought they had left.
 *
 * Narrow, because a setup started by mistake is a Passport too many: the intent
 * must be for THIS network, the Passport must be at the very beginning, and the
 * key that would hold it must already be on this device.
 */
export function backupStartsSetup(input: {
  readonly intent: BackupIntent | null;
  readonly network: string;
  /** The custody screen's own `create` step — nothing set up yet. */
  readonly onCreateStep: boolean;
  /** Whether the key that would hold it is on this device. */
  readonly heldByDeviceKey: boolean;
  /** Whether something is already running. */
  readonly busy: boolean;
}): boolean {
  if (input.intent === null || input.intent.stage !== 'setting-up') return false;
  if (input.intent.network !== input.network) return false;
  return input.onCreateStep && input.heldByDeviceKey && !input.busy;
}

/**
 * Whether the spare key should be attached on its own, without being offered.
 *
 * The end of the same press. A Passport made by somebody who was already signed
 * in gets the sign-in attached the moment there is something to attach it to —
 * which is when the name has been claimed, for the reason
 * {@link BackupOfferInput.hasName} gives — and the reader is asked for the one
 * approval that costs, rather than for a decision they already made.
 */
export function backupAutomatically(input: {
  readonly intent: BackupIntent | null;
  readonly network: string;
  readonly onHome: boolean;
  readonly hasName: boolean;
  /** Whether the sign-in is there, with a key behind it. */
  readonly socialReady: boolean;
  /** What this browser has recorded. */
  readonly record: BackupRecord | null;
  readonly busy: boolean;
}): boolean {
  if (input.intent === null || input.intent.stage !== 'backing-up') return false;
  if (input.intent.network !== input.network) return false;
  if (input.record?.doneAt !== undefined) return false;
  return input.onHome && input.hasName && input.socialReady && !input.busy;
}

/** What the custody screen does about the spare key on this visit. */
export type BackupOffer =
  /** Say nothing. Not ready, not applicable, or asked recently enough. */
  | 'hidden'
  /** Show the offer. */
  | 'offer'
  /** Show the one line that says there is a spare key, and no button. */
  | 'done';

/** What the screen knows when it has to decide. */
export interface BackupOfferInput {
  /** Whether the Passport is finished and open — the custody screen's `home`. */
  readonly onHome: boolean;
  /**
   * Whether a name has been claimed.
   *
   * THE OFFER WAITS FOR IT, and this is the one ordering in the decision that
   * is not obvious. A name is what the way back in is typed against
   * (`./custodyAdoption.ts`), so a spare key on a Passport with no name is a
   * key that opens a door nobody can find. Offering the backup first would
   * therefore be offering something that does not yet work.
   */
  readonly hasName: boolean;
  /** Whether this build has a social sign-in at all. False in most builds. */
  readonly socialAvailable: boolean;
  /**
   * Whether THIS Passport is held by a social sign-in already.
   *
   * There is nothing to offer such a Passport: its only key is the sign-in, so
   * a "back up with a sign-in" card would be offering the key it already has.
   * These are the Passports made before 2026/09/21 and there are no new ones.
   */
  readonly heldBySocial: boolean;
  /** What this browser recorded. See {@link loadBackupRecord}. */
  readonly record: BackupRecord | null;
  /**
   * Whether a spare key is being attached on its own right now.
   *
   * A Passport started from a sign-in gets one without being asked, so offering
   * it would be offering something already under way — and a reader who
   * dismissed that card would be dismissing a thing that then happened anyway.
   */
  readonly autoPending: boolean;
  readonly now: number;
}

/**
 * Whether to ask, to say nothing, or to say it is done.
 *
 * THE ORDER IS THE FUNCTION. `done` is decided before anything else that could
 * hide the card, so a Passport with a spare key says so even on a visit where
 * the offer would not have been made — and every "not applicable" is decided
 * before the clock, so a build with no sign-in never reads a dismissal it could
 * not have written.
 */
export function backupOffer(input: BackupOfferInput): BackupOffer {
  if (input.record?.doneAt !== undefined) return 'done';
  if (!input.socialAvailable || input.heldBySocial) return 'hidden';
  if (input.autoPending) return 'hidden';
  if (!input.onHome || !input.hasName) return 'hidden';
  const dismissed = input.record?.dismissedAt;
  if (dismissed === undefined) return 'offer';
  /* A dismissal from the FUTURE is a clock that moved, not a press that has
     not happened yet, and the offer is due rather than suppressed for a day
     that may never end. */
  if (dismissed > input.now) return 'offer';
  return input.now - dismissed >= BACKUP_REMINDER_MS ? 'offer' : 'hidden';
}

/* -------------------------------------------------------------------------- */
/* What it says                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The words, in one place, and every one of them chosen against the copy rule
 * this screen keeps: no wallet address, DUST, contract, registry, indexer,
 * resolver, sponsor, or SDK — and no "Dynamic" either, because the reader
 * chooses Google, not a vendor. The PROVIDERS may be named; they are what the
 * reader recognises.
 *
 * "A second way in" rather than "a backup device", because a reader who has
 * never thought of their phone as a device holding a key has no use for either
 * noun. The sentence says what it is for.
 */
export const BACKUP_COPY = {
  title: 'Back up your Passport',
  lede:
    'Right now this Passport opens on this device and nowhere else. Add a second way in with ' +
    'Google, Microsoft, X, or Discord, and you can open it again on a new phone.',
  action: 'Add a second way in',
  /* WHAT IT DOES NOT BRING BACK, said in the offer and not discovered
     afterwards. See `./custodyAdoption.ts` for why it cannot, and the pull
     request for what would change it. */
  limit:
    'A new phone will be able to send and be paid. Tokens you were sent before will still be ' +
    'listed on this device only.',
  dismiss: 'Not now',
  busy: 'Adding your second way in',
  /* Named by the provider the reader chose, and by nothing else. */
  done: (provider: string | null): string =>
    provider === null || provider.trim().length === 0
      ? 'Your Passport has a second way in.'
      : `Your Passport has a second way in, with ${provider.trim()}.`,
} as const;

/**
 * Why a backup cannot be asked for right now, or null when it can.
 *
 * SAID BEFORE THE OVERLAY RATHER THAN AFTER IT. A sign-in that is still
 * starting up, and one that has signed in without finishing, both look to a
 * reader like a button that did nothing — so the button says the sentence
 * instead of opening something that will fail.
 */
export function backupRefusal(input: {
  /** {@link DynamicSession.status}. */
  readonly status: string;
  /** Whether the sign-in has produced a key yet. */
  readonly hasKey: boolean;
}): string | null {
  if (input.status === 'disabled') {
    return 'A second way in is not available in this version.';
  }
  if (input.status === 'loading') {
    return 'The other ways in are still getting ready. Try again in a moment.';
  }
  if (input.status === 'signed-in' && !input.hasKey) {
    return 'Your sign-in is still finishing. Try again in a moment.';
  }
  return null;
}
