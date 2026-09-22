/**
 * WHAT THIS BROWSER KNOWS ABOUT A PASSPORT'S WAY BACK — one key, one record per
 * Passport, and nothing else.
 *
 * `passport-account-custody-backup:v1`, carried over from passport-demo #83
 * unchanged, so a Passport that added a spare key on the road that PR drew is
 * recognised by the step that replaced it. What is gone with that road is
 * everything it decided: the Home card, the day-long dismissal clock, the
 * "Back up your Passport" copy, and the intent record a Passport STARTED from
 * a sign-in needed. There are no Passports started from a sign-in any more
 * (2026/09/22), the card is a step between the name and Home, and the answer to
 * it is final — so the rules that are left live in `./recoveryStep.ts` and what
 * lives here is the record they are read from.
 *
 * NO REACT, NO CONTRACT, AND NO COPY. The ceremony itself is
 * `../identity/custodyContractClient.ts`'s `addDeviceK1`; the words are
 * `./recoveryStep.ts`'s; what is here is two fields and the reading of them.
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
