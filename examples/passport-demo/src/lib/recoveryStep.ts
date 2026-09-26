/**
 * THE WAY BACK, AS A STEP OF ONBOARDING — when it is offered, when it is not,
 * and what it says.
 *
 * WHY A STEP AND NOT A CARD ON HOME (2026/09/22)
 * ----------------------------------------------
 * The offer used to be a card on Home, dismissable, and re-offered a day
 * later. That put the one decision that decides whether a Passport survives a
 * lost phone behind the everyday surface, where it competed with a balance and
 * an apps grid and was read as an advertisement. The product owner's drawing
 * puts it where it belongs: one screen, immediately after the name is claimed
 * and before Home, asked once.
 *
 * Asked ONCE is the whole rule. A step that comes back every time somebody
 * opens their Passport is not a step, it is a nag, and the answer "not now" has
 * to mean something or it should not be offered as an answer. So a skip is
 * written down exactly as a success is, and neither is asked about again — the
 * way back is still reachable from Home, which is where a person who changed
 * their mind goes looking for it.
 *
 * NO IMPORTS AT RUN TIME BUT THE RECORD STORE, and the record store is
 * `./backupDevice.ts`'s, unchanged: `passport-account-custody-backup:v1`, with
 * `doneAt` for a way back that was added and `dismissedAt` for one that was
 * declined. Reusing it rather than inventing a second key is what lets a
 * Passport that added a spare key on the old road be recognised on this one.
 */

import { loadBackupRecord, type BackupRecord } from './backupDevice.js';
import type { CustodyStorage } from '../identity/custodyContractPlan.js';

/* -------------------------------------------------------------------------- */
/* Whether the step is due                                                    */
/* -------------------------------------------------------------------------- */

/** Everything the offer is decided from. */
export interface RecoveryStepInput {
  /** Whether every step of the setup has landed. */
  readonly setupFinished: boolean;
  /** The `.night` name this Passport has CLAIMED, or null. */
  readonly claimedName: string | null;
  /** Whether this build offers a provider sign-in at all. */
  readonly socialAvailable: boolean;
  /**
   * Whether the key holding this Passport IS a provider key.
   *
   * There is nothing to offer such a Passport: the way back it would be given
   * is the key it is already held by, so the step would add a second name for
   * the same thing and call it recovery.
   */
  readonly heldBySocial: boolean;
  /** What this Passport's record says, or null where there is none. */
  readonly record: BackupRecord | null;
  /**
   * Whether the name is still being registered.
   *
   * THE STEP IS PART OF ONBOARDING, BEFORE HOME (reviewer, 2026/09/22). The
   * name lands within seconds of the key, so the step does not wait for it; it
   * does not wait for the maintenance waves either, because the add finishes
   * them itself before enrolling the key (`runRecoveryAdd`).
   */
  readonly nameRegistering?: boolean;
}

/**
 * Whether the "Add recovery" step belongs between the name and Home.
 *
 * READ IN THIS ORDER. A Passport that already has a way back is never asked
 * again, whatever else is true — that is the answer this step exists to get,
 * and it has it. A Passport that said "not now" is not asked again either, for
 * the reason in the header.
 *
 * Everything else is a matter of whether the step CAN be taken: a build with no
 * provider sign-in has nothing to offer, a Passport held by a sign-in has
 * nothing to add, and a Passport that is not finished and named is not at this
 * point in the flow yet.
 */
export function recoveryStepDue(input: RecoveryStepInput): boolean {
  if (input.record?.doneAt !== undefined) return false;
  if (input.record?.dismissedAt !== undefined) return false;
  if (!input.socialAvailable || input.heldBySocial) return false;
  return input.setupFinished && (input.claimedName !== null || input.nameRegistering === true);
}

/** Whether this Passport has a way back on it. */
export function recoveryHeld(record: BackupRecord | null): boolean {
  return record?.doneAt !== undefined;
}

/**
 * The same question, asked of storage.
 *
 * A convenience for the screens, which know the user key and the network and
 * have no business knowing the shape of the record.
 */
export function loadRecoveryRecord(
  storage: CustodyStorage,
  user: string,
  network: string,
): BackupRecord | null {
  return loadBackupRecord(storage, user, network);
}

/* -------------------------------------------------------------------------- */
/* What Home shows about it                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What Home says about the way back.
 *
 *   `on`     — one small line beside the name. It is a statement and not a
 *              control: there is nothing to press about a thing that is done.
 *   `add`    — the small entry where "Back up or restore" used to sit, for a
 *              Passport that skipped the step or was made before it existed.
 *   `hidden` — a build with no sign-in, or a Passport held by one.
 */
export type RecoveryHomeEntry = 'on' | 'add' | 'hidden';

export function recoveryHomeEntry(input: {
  readonly socialAvailable: boolean;
  readonly heldBySocial: boolean;
  readonly record: BackupRecord | null;
}): RecoveryHomeEntry {
  if (recoveryHeld(input.record)) return 'on';
  if (!input.socialAvailable || input.heldBySocial) return 'hidden';
  return 'add';
}

/* -------------------------------------------------------------------------- */
/* Picking the step back up                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Whether the add should be RUN, with nothing further pressed.
 *
 * THE SIGN-IN TAKES THE READER AWAY AND BRINGS THEM BACK, which is the whole
 * reason this question exists. Pressing the offer opens a provider's own
 * overlay, and on a phone that can mean a redirect and a fresh load of this
 * app; the intent is therefore written down in `sessionStorage` before the
 * overlay opens ({@link saveRecoveryIntent}), and what comes back — the same
 * render, or a fresh load of the same tab — finds a Passport on the recovery
 * step with a sign-in attached and finishes the job rather than asking a
 * second time. A fresh load resumes a stored press at most ONCE: see
 * {@link loadRecoveryIntent}.
 *
 * `busy` is in here rather than checked by the caller so the answer is false
 * for the whole time the add is running — an effect that re-fired on a render
 * during a signature would ask for a second approval for an enrolment that is
 * already away.
 */
export function recoveryResumes(input: {
  /** Whether the reader pressed the offer and has not been answered yet. */
  readonly intended: boolean;
  /**
   * Whether the screen on show is one the add can finish on — the recovery
   * step, or Home.
   *
   * BOTH, because the press comes from both. Home offers "Add recovery" to a
   * Passport that skipped the step or predates it, and that press opens the
   * same overlay; a rule that only resumed on the step would leave somebody who
   * pressed it from Home signed in, back on Home, and no further forward.
   */
  readonly readyScreen: boolean;
  /** Whether a provider sign-in is attached and has a key behind it. */
  readonly socialReady: boolean;
  /** Whether this Passport already has a way back. */
  readonly record: BackupRecord | null;
  readonly busy: boolean;
}): boolean {
  if (!input.intended) return false;
  if (recoveryHeld(input.record)) return false;
  return input.readyScreen && input.socialReady && !input.busy;
}

/* -------------------------------------------------------------------------- */
/* Remembering the press across a reload                                      */
/* -------------------------------------------------------------------------- */

/**
 * THE PRESS, WRITTEN DOWN, SO A RELOAD DOES NOT LOSE IT (2026/09/25).
 *
 * Until today the press lived in React state alone, while two comments said
 * it survived a fresh load. It did not: on Android Chrome a reload during the
 * provider's sign-in — the provider's own error view reloads the page — came
 * back to a Passport that had forgotten the press, and the reader was asked
 * again, or reloaded again, for as long as they kept trying.
 *
 * `sessionStorage`, and not `localStorage`, because the press belongs to this
 * tab and this visit: a Passport opened tomorrow in a new tab must not start
 * an enrolment nobody pressed for. Scoped to the account and the network for
 * the same reason, and dropped after {@link RECOVERY_INTENT_TTL_MS}.
 *
 * AT MOST ONE AUTOMATIC RESUME PER PRESS. The resume marks the stored press
 * consumed as it starts ({@link consumeRecoveryIntent}); a load that finds a
 * consumed press does not resume it. So a sign-in that reloads the page every
 * time it loads costs one attempt and then the offer, never a loop.
 */
export const RECOVERY_INTENT_KEY = 'passport-recovery-intent:v1';

/** How long a press is remembered for. */
export const RECOVERY_INTENT_TTL_MS = 10 * 60_000;

/** What a load finds: a press to resume, one already resumed, or nothing. */
export type RecoveryIntentState = 'pending' | 'consumed' | null;

interface StoredRecoveryIntent {
  readonly at: number;
  readonly consumed: boolean;
}

function recoveryIntentSlot(user: string, network: string): string {
  return `${RECOVERY_INTENT_KEY}:${user.toLowerCase()}|${network}`;
}

/* Every access is guarded: a private window or blocked site data makes the
   storage throw, and then the press is simply not remembered — which is what
   happened before this store existed, and nothing worse. */
function writeIntent(
  storage: CustodyStorage,
  user: string,
  network: string,
  intent: StoredRecoveryIntent,
): void {
  try {
    storage.setItem(recoveryIntentSlot(user, network), JSON.stringify(intent));
  } catch {
    /* Not remembered. */
  }
}

/** Remembers a press on the offer, as the overlay opens. */
export function saveRecoveryIntent(
  storage: CustodyStorage,
  user: string,
  network: string,
  now: number,
): void {
  writeIntent(storage, user, network, { at: now, consumed: false });
}

/** Forgets the press: the add has ended, or the reader said "Not now". */
export function clearRecoveryIntent(storage: CustodyStorage, user: string, network: string): void {
  try {
    storage.removeItem(recoveryIntentSlot(user, network));
  } catch {
    /* Nothing to forget with. */
  }
}

/**
 * What a load finds for this account on this network.
 *
 * A press older than {@link RECOVERY_INTENT_TTL_MS}, one dated in the future,
 * and one this build cannot read are all forgotten and answered `null`.
 */
export function loadRecoveryIntent(
  storage: CustodyStorage,
  user: string,
  network: string,
  now: number,
): RecoveryIntentState {
  let raw: string | null;
  try {
    raw = storage.getItem(recoveryIntentSlot(user, network));
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const intent = parsed as Partial<StoredRecoveryIntent> | null;
  const age = typeof intent?.at === 'number' ? now - intent.at : Number.NaN;
  if (!(age >= 0 && age <= RECOVERY_INTENT_TTL_MS) || typeof intent?.consumed !== 'boolean') {
    clearRecoveryIntent(storage, user, network);
    return null;
  }
  return intent.consumed ? 'consumed' : 'pending';
}

/**
 * Marks the press as resumed, as the resume starts — the rule that makes a
 * second load in a row find nothing to resume. A press that is not stored
 * (it expired, or storage refused it) is left alone. The consumed press is
 * dated from the resume, so it is forgotten ten minutes after that.
 */
export function consumeRecoveryIntent(
  storage: CustodyStorage,
  user: string,
  network: string,
  now: number,
): void {
  if (loadRecoveryIntent(storage, user, network, now) !== 'pending') return;
  writeIntent(storage, user, network, { at: now, consumed: true });
}

/* -------------------------------------------------------------------------- */
/* Whether the press can be answered at all                                   */
/* -------------------------------------------------------------------------- */

/**
 * The one sentence a press gets when the sign-in is not in a state to answer
 * it — or null, meaning go ahead.
 *
 * Every one of these is temporary and says so, because every one of them is: a
 * build without the machinery, a bridge still loading, and a session that is
 * signed in but has not produced its key yet. None of them is the reader's
 * fault and none of them is worth a dead end.
 */
export function recoveryRefusal(input: {
  readonly status: string;
  readonly hasKey: boolean;
}): string | null {
  if (input.status === 'disabled') return RECOVERY_COPY.unavailable;
  if (input.status === 'loading') return RECOVERY_COPY.loading;
  if (input.status === 'signed-in' && !input.hasKey) return RECOVERY_COPY.settling;
  return null;
}

/* What a failed add says is `./recoveryAdd.ts#recoveryAddFailureSentence`
   (2026/09/24). The sentence that stood here passed any message of up to 140
   characters through verbatim — "That payment didn't go through", a socket's
   own words — which is a wrong statement about a step that moves no money. */

/* -------------------------------------------------------------------------- */
/* Coming back on a new device                                                */
/* -------------------------------------------------------------------------- */

/** Which half of the new-device road a reader is on. */
export type ProviderRecoveryStage =
  /** Sign in with the provider that was added as the way back. */
  | 'sign-in'
  /** Signed in: type the name and let Passport check it. */
  | 'name'
  /** The build has no provider sign-in, so this road does not exist. */
  | 'unavailable';

/**
 * Where the new-device road starts.
 *
 * THE SIGN-IN COMES FIRST AND THE NAME SECOND, which is the order the product
 * owner drew and the order that is honest: a name typed by somebody with no
 * key behind it cannot be answered with anything but "prove it", and asking for
 * the proof afterwards means the screen asked a question it could not use.
 */
export function providerRecoveryStage(input: {
  readonly status: string;
  readonly hasAddress: boolean;
}): ProviderRecoveryStage {
  if (input.status === 'disabled') return 'unavailable';
  return input.status === 'signed-in' && input.hasAddress ? 'name' : 'sign-in';
}

/* -------------------------------------------------------------------------- */
/* What it says                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Every sentence this step shows.
 *
 * NO PROVIDER IS PROMISED THAT THE OVERLAY MAY NOT OFFER — the four names and
 * email are the ones the build is configured for, and they are named because
 * "add a way back" on its own describes nothing a person can picture. Nothing
 * here says what holds the Passport, because that is machinery, and nothing
 * here calls the sign-in a wallet, because it is not one.
 */
export const RECOVERY_COPY = {
  kicker: 'One last thing',
  title: 'Add a way back',
  lede:
    'Your Passport lives on this device. Add a way back and you can open it again on a new ' +
    'phone if this one is lost.',
  action: 'Add recovery',
  skip: 'Not now',
  busy: 'Adding your way back',
  hint: 'Adding it is paid for on your behalf, and takes one approval.',
  /** After a successful add, named by the provider where one is known. */
  done: (provider: string | null): string =>
    provider === null || provider.trim().length === 0
      ? 'Your Passport has a way back.'
      : `Your Passport has a way back, with ${provider.trim()}.`,
  /** The line Home shows beside the name for a Passport that has one. */
  homeOn: 'Recovery: on',
  /** The small entry on Home for a Passport that has not. */
  homeAdd: 'Add recovery',
  /** Offered under any failure, and under the offer itself. */
  continue: 'Continue to my Passport',
  unavailable: 'A way back is not available in this version.',
  loading: 'The ways back are still getting ready. Try again in a moment.',
  settling: 'Your sign-in is still finishing. Try again in a moment.',
  /** The new-device road. */
  recoverTitle: 'Open your Passport here',
  recoverLede:
    'Sign in with the account you added as your way back, then tell Passport the name you ' +
    'already hold.',
  recoverAction: 'Sign in to recover',
  recoverEntry: 'I already have a Passport',
  /** The landing's quiet link under Log in and Sign up, into the same road. */
  landingEntry: 'Lost your device? Recover your Passport',
  recoverBack: 'Go back',
  /** Under a second half that did not finish: the same run, again (2026/09/26). */
  adoptRetry: 'Try again',
  /** And the way out of it, back to choosing a sign-in. */
  adoptLeave: 'Use a different sign-in',
} as const;
