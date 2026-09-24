/**
 * ADDING RECOVERY, AS SOMETHING A PERSON CAN FOLLOW — and as something that
 * always ends in a true sentence (2026/09/24).
 *
 * WHAT THIS IS FOR
 * ----------------
 * Two requests from the product owner on the same day. "Sometimes the recovery
 * transaction didn't go through correctly", with no error text, and "show the
 * whole transaction life cycle when adding recovery, like onboarding does".
 * They are one piece of work: a timeline can only be honest about an add whose
 * every step ends — in "Recovery is on", or in one plain sentence and the same
 * press again — and an add that ends can be shown step by step.
 *
 * So this module is three things, and none of them paints:
 *
 *   1. {@link runRecoveryAdd}, the order of the add with a bound on every step
 *      that can hang, and the checks the screen used to skip: the rest of the
 *      setup finishing (or saying it has not), and the sign-in's key being
 *      ready (or saying it is not).
 *   2. {@link recoveryAddRows}, the rows the timeline shows, driven by the
 *      callbacks the add really makes — never by a timer.
 *   3. {@link recoveryAddFailureSentence}, the one sentence a failure gets.
 *
 * NO REACT, NO STORAGE, NO NETWORK, NO CLOCK. The steps and the wait are
 * injected, so every path — a refusal, a hang, a key not ready yet — is drilled
 * directly in `./recoveryAdd.test.ts`, the same rule as
 * `./custodySetupProgress.ts`.
 */

import type { ClaimStepState } from './claimSteps.js'
import {
  CUSTODY_KEY_NOT_ADDED,
  CUSTODY_KEY_UNCONFIRMED,
  CUSTODY_PHASE_PROVED,
  CUSTODY_STILL_FINISHING,
} from '../identity/custodyContractPlan.js'

/* -------------------------------------------------------------------------- */
/* Where the add is                                                           */
/* -------------------------------------------------------------------------- */

/**
 * What the add is doing right now, in the order it does it.
 *
 * THE PASSKEY COMES FIRST, BEFORE THE SIGN-IN'S KEY, and not by taste: a
 * browser only allows a passkey prompt close to the press that asked for it,
 * and the sign-in's signature can take long enough to use that window up.
 */
export type RecoveryAddStage =
  /** This device's passkey, which is the key that approves the add. */
  | 'passkey'
  /** The rest of the setup, landed first — only when it was still pending. */
  | 'finish'
  /** The recovery account's key, read off a signature it makes. */
  | 'key'
  /** The account read and the add approved with the key already in hand. */
  | 'prepare'
  /** The add's proof being made. */
  | 'prove'
  /** Handed to the network. */
  | 'send'
  /** Waiting for the chain to say so. */
  | 'confirm'
  /** On. */
  | 'done'

/** Everything the timeline is drawn from. */
export interface RecoveryAddProgress {
  readonly stage: RecoveryAddStage
  /** Whether the rest of the setup was pending when the add started. */
  readonly finishing: boolean
}

/** The part of a custody phase this module reads. */
export interface RecoveryAddPhase {
  readonly step: string
  readonly detail?: string
}

/**
 * The stage a phase reported by the add itself moves the timeline to, or null
 * for a phase that moves nothing.
 *
 * `sign` is the passkey's signature over the add, made with the key already in
 * hand, so it is part of getting ready rather than a row of its own. A `submit`
 * that follows a `confirm` — the node refused, and the add is being built
 * again — really is proving again, and the timeline says so.
 */
export function recoveryAddStageOfPhase(phase: RecoveryAddPhase): RecoveryAddStage | null {
  if (phase.step === 'submit') return phase.detail === CUSTODY_PHASE_PROVED ? 'send' : 'prove'
  if (phase.step === 'confirm') return 'confirm'
  return null
}

/**
 * Whether the reader's hands are wanted at this stage — the passkey prompt, or
 * the sign-in's own approval — so anything offered beside the wait goes away.
 */
export function recoveryAddNeedsReader(stage: RecoveryAddStage): boolean {
  return stage === 'passkey' || stage === 'key'
}

/* -------------------------------------------------------------------------- */
/* The rows                                                                   */
/* -------------------------------------------------------------------------- */

export type RecoveryAddRowId = 'signed-in' | 'passkey' | 'finish' | 'add' | 'on'
export type RecoveryAddSubStageId = 'key' | 'prepare' | 'prove' | 'send' | 'confirm'

export interface RecoveryAddSubStage {
  readonly id: RecoveryAddSubStageId
  readonly label: string
  readonly state: ClaimStepState
}

export interface RecoveryAddRow {
  readonly id: RecoveryAddRowId
  readonly label: string
  readonly state: ClaimStepState
  /** Seconds, or null when the answer is "as long as you take". */
  readonly expectedSeconds: number | null
  /** The states the long row passes through, or null for a row that is one thing. */
  readonly subStages: readonly RecoveryAddSubStage[] | null
}

/**
 * How long the add's own row usually takes: a proof on the service, the
 * network, and a block read back. Rounded UP, for the reason
 * `./claimSteps.ts` gives about its estimates.
 */
export const RECOVERY_ADD_EXPECTED_SECONDS = 60
/** How long the rest of the setup usually takes, when it is still to land. */
export const RECOVERY_FINISH_EXPECTED_SECONDS = 90

const ROW_OF_STAGE: Record<RecoveryAddStage, RecoveryAddRowId> = {
  passkey: 'passkey',
  finish: 'finish',
  key: 'add',
  prepare: 'add',
  prove: 'add',
  send: 'add',
  confirm: 'add',
  done: 'on',
}

const SUB_STAGES: readonly { id: RecoveryAddSubStageId; label: string }[] = [
  { id: 'key', label: 'Getting your recovery key' },
  { id: 'prepare', label: 'Preparing' },
  { id: 'prove', label: 'Proving' },
  { id: 'send', label: 'Sending' },
  { id: 'confirm', label: 'Confirming' },
]

/**
 * The rows, with the state each one is in.
 *
 * THE FIRST ROW IS ALWAYS TICKED. The add does not start until the recovery
 * account is signed in, so the row naming it is a thing that has happened —
 * the same rule as the setup's "Checking your name".
 *
 * THE FINISHING ROW IS THERE ONLY WHEN THERE WAS SOMETHING TO FINISH. A row
 * about work nobody is waiting on is furniture.
 *
 * THE LAST ROW IS NEVER RUNNING. It is the outcome, not a step: it is ticked
 * the moment the add is on, and until then it is what the others lead to.
 */
export function recoveryAddRows(progress: RecoveryAddProgress): RecoveryAddRow[] {
  const rows: Omit<RecoveryAddRow, 'state' | 'subStages'>[] = [
    { id: 'signed-in', label: 'Sign in to your recovery account', expectedSeconds: null },
    { id: 'passkey', label: 'Approve with your passkey', expectedSeconds: null },
    ...(progress.finishing
      ? [
          {
            id: 'finish' as const,
            label: 'Finish setting up your Passport',
            expectedSeconds: RECOVERY_FINISH_EXPECTED_SECONDS,
          },
        ]
      : []),
    { id: 'add', label: 'Add your recovery key', expectedSeconds: RECOVERY_ADD_EXPECTED_SECONDS },
    { id: 'on', label: 'Recovery is on', expectedSeconds: null },
  ]
  const done = progress.stage === 'done'
  const active = rows.findIndex((row) => row.id === ROW_OF_STAGE[progress.stage])
  const subActive = SUB_STAGES.findIndex((stage) => stage.id === progress.stage)
  return rows.map((row, index) => ({
    ...row,
    state: done || index < active ? 'done' : index === active ? 'active' : 'todo',
    subStages:
      row.id === 'add'
        ? SUB_STAGES.map((stage, at) => ({
            ...stage,
            state:
              done || (subActive !== -1 && at < subActive)
                ? 'done'
                : at === subActive
                  ? 'active'
                  : 'todo',
          }))
        : null,
  }))
}

/* -------------------------------------------------------------------------- */
/* The add, with a bound on every step that can hang                          */
/* -------------------------------------------------------------------------- */

/** How long the rest of the setup is waited on before the add says so. */
export const RECOVERY_FINISH_WAIT_MS = 5 * 60_000
/** How long the recovery account's key is waited on. */
export const RECOVERY_KEY_WAIT_MS = 2 * 60_000
/** How long before a key that is "still starting up" is asked for again. */
export const RECOVERY_KEY_RETRY_MS = 2_000
/**
 * A last bound on the add itself. The add bounds each of its own steps, so
 * this is a net under them rather than the rule — and an add it catches is one
 * whose outcome is unknown, so it says so.
 */
export const RECOVERY_ADD_WAIT_MS = 15 * 60_000

/** The one sentence for a sign-in whose key is not ready yet. */
export const RECOVERY_KEY_NOT_READY = 'Your sign-in is still finishing. Try again in a moment.'
/** The one sentence for a passkey prompt that was dismissed or refused. */
export const RECOVERY_PASSKEY_DECLINED =
  'Recovery was not added because the passkey was not confirmed. Try again.'

/** Everything the add does, injected. */
export interface RecoveryAddSteps<Identity, Key> {
  /** This device's passkey — the key that approves the add. */
  ensureIdentity: () => Promise<Identity>
  /** Whether the rest of the setup is still to land, as stored now. */
  wavesPending: () => boolean
  /** Lands the rest of the setup. Resolves whether or not it managed to. */
  finishWaves: (identity: Identity) => Promise<void>
  /** The recovery account's key. */
  recoveryKey: () => Promise<Key>
  /** Puts the key on the account, reporting its phases as it goes. */
  addKey: (identity: Identity, key: Key, onPhase: (phase: RecoveryAddPhase) => void) => Promise<void>
  /** Told every time the add moves. */
  onProgress: (progress: RecoveryAddProgress) => void
  /** Resolves after `milliseconds`. Every bound and every pause is one of these. */
  wait: (milliseconds: number) => Promise<void>
  /** Shorter bounds, for a drill or a walk. */
  bounds?: Partial<{
    finishMs: number
    keyMs: number
    keyRetryMs: number
    addMs: number
  }>
}

/** An answer in time, or `timeout`. The work is not cancelled, only no longer waited for. */
async function within<T>(
  work: Promise<T>,
  milliseconds: number,
  wait: (milliseconds: number) => Promise<void>,
): Promise<{ kind: 'done'; value: T } | { kind: 'timeout' }> {
  return Promise.race([
    work.then((value) => ({ kind: 'done' as const, value })),
    wait(milliseconds).then(() => ({ kind: 'timeout' as const })),
  ])
}

/** Whether a sign-in refused because its key is not ready yet. */
function keyNotReady(cause: unknown): boolean {
  return cause instanceof Error && /still (starting up|finishing)/i.test(cause.message)
}

/**
 * The recovery account's key, bounded, and asked once more after a pause when
 * the sign-in says it is not ready yet — which it says, for a moment, straight
 * after coming back from its own overlay.
 */
async function askForKey<Identity, Key>(
  steps: RecoveryAddSteps<Identity, Key>,
  bounds: { keyMs: number; keyRetryMs: number },
  attempt = 1,
): Promise<Key> {
  try {
    const asked = await within(steps.recoveryKey(), bounds.keyMs, steps.wait)
    if (asked.kind === 'timeout') throw new Error(RECOVERY_KEY_NOT_READY)
    return asked.value
  } catch (cause) {
    if (!keyNotReady(cause)) throw cause
    if (attempt >= 2) throw new Error(RECOVERY_KEY_NOT_READY)
  }
  await steps.wait(bounds.keyRetryMs)
  return askForKey(steps, bounds, attempt + 1)
}

/**
 * Adds recovery, start to end. Resolves when the key is on; rejects with an
 * `Error` whose message is already the sentence to show — see
 * {@link recoveryAddFailureSentence}.
 *
 * WHAT WAS FRAGILE, AND WHAT EACH STEP NOW DOES ABOUT IT:
 *
 *   The rest of the setup was finished with a call that swallows its own
 *   failure, and the add then went on to ask the sign-in for its key and to
 *   refuse only afterwards. It is now waited on for a bounded time and the
 *   record READ AGAIN: still pending is said at once, before anybody is asked
 *   for anything.
 *
 *   The sign-in's key was asked for with no bound, and a sign-in whose own
 *   machinery was still starting was a failure. It is bounded now, and asked
 *   once more after a pause when it says it is not ready.
 *
 *   The add itself is bounded step by step in `addDeviceK1`; this is a last net.
 */
export async function runRecoveryAdd<Identity, Key>(
  steps: RecoveryAddSteps<Identity, Key>,
): Promise<void> {
  const bounds = {
    finishMs: RECOVERY_FINISH_WAIT_MS,
    keyMs: RECOVERY_KEY_WAIT_MS,
    keyRetryMs: RECOVERY_KEY_RETRY_MS,
    addMs: RECOVERY_ADD_WAIT_MS,
    ...steps.bounds,
  }
  const finishing = steps.wavesPending()
  const report = (stage: RecoveryAddStage) => steps.onProgress({ stage, finishing })

  report('passkey')
  const identity = await steps.ensureIdentity()

  /* Read again: it may have landed behind Home while the passkey was asked. */
  if (finishing && steps.wavesPending()) {
    report('finish')
    const finished = await within(steps.finishWaves(identity), bounds.finishMs, steps.wait)
    if (finished.kind === 'timeout' || steps.wavesPending()) {
      throw new Error(CUSTODY_STILL_FINISHING)
    }
  }

  report('key')
  const key = await askForKey(steps, bounds)

  report('prepare')
  const added = await within(
    steps.addKey(identity, key, (phase) => {
      const stage = recoveryAddStageOfPhase(phase)
      if (stage !== null) report(stage)
    }),
    bounds.addMs,
    steps.wait,
  )
  if (added.kind === 'timeout') throw new Error(CUSTODY_KEY_UNCONFIRMED)
  report('done')
}

/* -------------------------------------------------------------------------- */
/* What a failure says                                                        */
/* -------------------------------------------------------------------------- */

/** The sentences a failure may be shown verbatim, because they were written for it. */
const SHOWN_AS_IS: readonly string[] = [
  CUSTODY_KEY_NOT_ADDED,
  CUSTODY_KEY_UNCONFIRMED,
  CUSTODY_STILL_FINISHING,
  RECOVERY_KEY_NOT_READY,
]

/**
 * The one sentence a failed add shows.
 *
 * ONLY SENTENCES WRITTEN FOR THIS STEP ARE SHOWN AS THEY ARE. Anything else —
 * a library's message, a payment's sentence, a stack — is not a statement
 * about recovery and would be a wrong one, so it becomes "not added", which is
 * TRUE of every failure that is not one of the four above: each of those is
 * raised before anything is handed over, and every outcome after the handover
 * arrives as one of the two `CUSTODY_KEY_*` sentences.
 */
export function recoveryAddFailureSentence(cause: unknown): string {
  const message = cause instanceof Error ? cause.message.trim() : ''
  if (SHOWN_AS_IS.includes(message)) return message
  if (cause instanceof Error && (cause.name === 'NotAllowedError' || cause.name === 'AbortError')) {
    return RECOVERY_PASSKEY_DECLINED
  }
  return CUSTODY_KEY_NOT_ADDED
}

/** What the primary control says under a failure: the same press, again. */
export const RECOVERY_RETRY = 'Try again'
