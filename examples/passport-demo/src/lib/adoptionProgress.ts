/**
 * BRINGING A PASSPORT TO A NEW DEVICE, AS SOMETHING A PERSON CAN FOLLOW
 * (2026/09/27).
 *
 * WHAT THIS IS FOR
 * ----------------
 * Live on an Android phone: the second half of a recovery reached the proving
 * service, the proof was made in 43 seconds, and the phone never heard back.
 * The person had put it down, the screen dimmed, Android froze the tab, and the
 * request in flight was dropped. The screen had shown one sentence the whole
 * time — "Adding this device to …" on a black page — and then a failure that
 * asked them to start again.
 *
 * So this module is two things, and neither of them paints:
 *
 *   1. {@link adoptionRows}, the timeline "Opening your Passport" shows, row
 *      for row the steps the second half really takes, moved only by what it
 *      reports ({@link adoptionStepOfPhase}) — never by a timer.
 *   2. {@link adoptionHandedOver} and {@link adoptionCancellable}, which say
 *      when a transaction is in flight: the long wait is allowed then, and a
 *      way out is not.
 *
 * The rule that picks a step back up after its connection dropped is
 * `./adoptionResume.ts`, apart from this, because this module is read on every
 * render of `App.tsx` and that one needs the custody client's sentences.
 *
 * NOTHING AT RUN TIME BUT THE STANDARD LIBRARY, for the reason
 * `./custodyAdoption.ts` gives: a question asked from the entry chunk must not
 * drag the custody layer into it. NO REACT, NO STORAGE, NO NETWORK, NO CLOCK —
 * every branch is drilled directly, in `./adoptionProgress.test.ts`.
 */

import type { ClaimStepState } from './claimSteps.js'

/* -------------------------------------------------------------------------- */
/* Where the second half is                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What the second half is doing right now, in the order it does it.
 *
 * THE SIGN-IN'S KEY COMES FIRST, because the check that the right sign-in is
 * the one approving is made before this device's passkey is asked for anything
 * (`../identity/custodyAdopt.ts`, step 0) — and that check needs the key.
 */
export type AdoptionStep =
  /** The sign-in's key, read off the signatures it makes. */
  | 'sign-in'
  /** This device's key, from its passkey. */
  | 'passkey'
  /** The account opened, and the add approved by the sign-in. */
  | 'approve'
  /** The add's proof being made. */
  | 'prove'
  /** The proof made; the fee being covered. */
  | 'fee'
  /** The fee covered; handed to the network. */
  | 'send'
  /** Waiting for the network to include it. */
  | 'confirm'
  /** The account's payments pointed at this device's key. */
  | 'rotate'
  /** The payments sent before this device, brought back. */
  | 'earlier'
  /** Here. */
  | 'done'

/**
 * The `detail` the adoption reports on a `submit` phase once the fee has been
 * covered — the one line between balancing and the hand-over that the custody
 * client does not draw itself. See `../identity/custodyAdopt.ts`.
 */
export const ADOPTION_PHASE_FEE_COVERED = 'fee-covered'

/**
 * The `detail` the custody client reports on a `submit` phase once the proof is
 * made — `CUSTODY_PHASE_PROVED` in `../identity/custodyContractPlan.ts`,
 * written out rather than imported for the reason in this module's header, and
 * held equal to it by `./adoptionProgress.test.ts`.
 */
export const ADOPTION_PHASE_PROVED = 'proved'

/** The part of a custody phase this module reads. */
export interface AdoptionPhase {
  readonly step: string
  readonly detail?: string
}

/**
 * The step a phase reported by the ADD moves the timeline to, or null for a
 * phase that moves nothing.
 *
 * `submit` is reported three times on the way out: when the proof is asked
 * for, when it is made ({@link ADOPTION_PHASE_PROVED}), and when the fee is
 * covered ({@link ADOPTION_PHASE_FEE_COVERED}). `confirm` is the transaction
 * having an id — handed to the network, waiting to be included.
 */
export function adoptionStepOfPhase(phase: AdoptionPhase): AdoptionStep | null {
  if (phase.step === 'sign') return 'approve'
  if (phase.step === 'submit') {
    if (phase.detail === ADOPTION_PHASE_PROVED) return 'fee'
    return phase.detail === ADOPTION_PHASE_FEE_COVERED ? 'send' : 'prove'
  }
  return phase.step === 'confirm' ? 'confirm' : null
}

/**
 * Whether the add is in flight: its proof asked for, and its outcome not known
 * yet. The long wait belongs here and nowhere else — a proof alone is most of
 * a minute — and a way out does not, because the add cannot be called back.
 */
export function adoptionHandedOver(step: AdoptionStep): boolean {
  return step === 'prove' || step === 'fee' || step === 'send' || step === 'confirm'
}

/**
 * Whether "Cancel" is offered: only before anything has been handed over.
 * After the add lands the Passport is here, and the steps after it are this
 * device's own, so there is nothing left to cancel.
 */
export function adoptionCancellable(step: AdoptionStep): boolean {
  return step === 'sign-in' || step === 'passkey' || step === 'approve'
}

/* -------------------------------------------------------------------------- */
/* The rows                                                                   */
/* -------------------------------------------------------------------------- */

export type AdoptionRowId = 'sign-in' | 'passkey' | 'approve' | 'add' | 'rotate' | 'earlier' | 'home'
export type AdoptionSubStageId = 'prove' | 'fee' | 'send' | 'confirm'

export interface AdoptionSubStage {
  readonly id: AdoptionSubStageId
  readonly label: string
  readonly state: ClaimStepState
}

export interface AdoptionRow {
  readonly id: AdoptionRowId
  readonly label: string
  readonly state: ClaimStepState
  /** Seconds, or null when the answer is "as long as you take". */
  readonly expectedSeconds: number | null
  /** The states the long row passes through, or null for a row that is one thing. */
  readonly subStages: readonly AdoptionSubStage[] | null
}

/**
 * How long the add usually takes: a proof on the service, the fee, and a block
 * read back — `RECOVERY_ADD_EXPECTED_SECONDS` in `./recoveryAdd.ts`, the same
 * add run the other way, written out for the reason in this module's header
 * and held equal to it by `./adoptionProgress.test.ts`.
 */
export const ADOPTION_ADD_EXPECTED_SECONDS = 60

/** Pointing the payments at this device is the same shape of transaction. */
export const ADOPTION_ROTATE_EXPECTED_SECONDS = ADOPTION_ADD_EXPECTED_SECONDS

const ROW_OF_STEP: Record<Exclude<AdoptionStep, 'done'>, AdoptionRowId> = {
  'sign-in': 'sign-in',
  passkey: 'passkey',
  approve: 'approve',
  prove: 'add',
  fee: 'add',
  send: 'add',
  confirm: 'add',
  rotate: 'rotate',
  earlier: 'earlier',
}

const SUB_STAGES: readonly { id: AdoptionSubStageId; label: string }[] = [
  { id: 'prove', label: 'Proving' },
  { id: 'fee', label: 'Covering the fee' },
  { id: 'send', label: 'Sending' },
  { id: 'confirm', label: 'Confirming' },
]

/**
 * The rows, with the state each one is in.
 *
 * NAMED BY THE PROVIDER where one is known — "Approve with Google" — because
 * that is what the person chose, and nothing here names what stands behind it.
 *
 * THE LAST ROW IS NEVER RUNNING. It is the outcome, not a step: it is ticked
 * the moment the Passport is here, and until then it is what the others lead
 * to — the rule `./recoveryAdd.ts` keeps.
 */
export function adoptionRows(progress: {
  readonly step: AdoptionStep
  readonly provider: string | null
}): AdoptionRow[] {
  const provider = progress.provider?.trim() ?? ''
  const rows: Omit<AdoptionRow, 'state' | 'subStages'>[] = [
    {
      id: 'sign-in',
      label: provider.length > 0 ? `Check your ${provider} sign-in` : 'Check your sign-in',
      expectedSeconds: null,
    },
    { id: 'passkey', label: 'Make this device’s key', expectedSeconds: null },
    {
      id: 'approve',
      label: provider.length > 0 ? `Approve with ${provider}` : 'Approve with your sign-in',
      expectedSeconds: null,
    },
    { id: 'add', label: 'Add this device to your Passport', expectedSeconds: ADOPTION_ADD_EXPECTED_SECONDS },
    {
      id: 'rotate',
      label: 'Point your payments at this device',
      expectedSeconds: ADOPTION_ROTATE_EXPECTED_SECONDS,
    },
    { id: 'earlier', label: 'Bring back earlier payments', expectedSeconds: null },
    { id: 'home', label: 'Open your Passport', expectedSeconds: null },
  ]
  const done = progress.step === 'done'
  const active = done ? rows.length : rows.findIndex((row) => row.id === ROW_OF_STEP[progress.step as Exclude<AdoptionStep, 'done'>])
  const subActive = SUB_STAGES.findIndex((stage) => stage.id === progress.step)
  const addIndex = rows.findIndex((row) => row.id === 'add')
  return rows.map((row, index) => ({
    ...row,
    state: index < active ? 'done' : index === active ? 'active' : 'todo',
    subStages:
      row.id === 'add'
        ? SUB_STAGES.map((stage, at) => ({
            ...stage,
            state:
              active > addIndex || (subActive !== -1 && at < subActive)
                ? 'done'
                : at === subActive
                  ? 'active'
                  : 'todo',
          }))
        : null,
  }))
}

/**
 * How long every row is shown ticked before Home: the last row is the outcome,
 * and an outcome nobody sees is a jump rather than an end.
 */
export const ADOPTION_DONE_BEAT_MS = 1_200

/**
 * The line under the timeline while the second half runs. Closing Passport
 * stops it wherever it is — the add, the payments, and the records this device
 * writes afterwards are all this tab's to do — so it is said for the whole of
 * it, in the words a payment uses for the same thing (2026/09/26).
 */
export const ADOPTION_KEEP_OPEN = 'Keep Passport open until this finishes.'
