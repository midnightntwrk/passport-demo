/**
 * THE SETUP, AS SOMETHING A PERSON CAN FOLLOW — the rules, and only the rules.
 *
 * WHAT THIS IS FOR
 * ----------------
 * The old name step showed a claim you could watch: three rows with a mark
 * each, the finished ones ticked and saying what they took, the running one
 * alive and counting against what it usually costs, and the long one broken
 * into the states it passes through. `./claimSteps.ts` is the rule behind it
 * and `../screens/ProgressTimeline.tsx` paints it.
 *
 * The name-first setup on the account custody contract showed one button and a
 * counted sentence — "Setting up your Passport, step 1 of 3" — and the counter
 * did not move: it was read off a stored record that is only re-read when the
 * whole press finishes, so somebody watched it say "1 of 3" while all three
 * steps had already landed. A count that does not count is worse than no count
 * at all, because a reader who has learnt to believe it stops believing the
 * screen.
 *
 * "I like how we showed the full TX journey here … this part same way with the
 * game is critical" (2026/09/22). So the new road gets the same timeline, the
 * same clock, and the same game, and this module is the half of it that is a
 * decision rather than a paint: which row is running, which of the three states
 * the long row is in, and what the one remaining sentence says.
 *
 * NO REACT, NO STORAGE, NO NETWORK, NO CLOCK. Every answer here is a value in
 * and a value out, so the mapping can be drilled directly rather than inferred
 * from a rendered screen — the same rule, and for the same reason, as
 * `./custodyNameFirst.ts` and `./claimSteps.ts`.
 */

import type { ClaimStepState } from './claimSteps.js'

/* -------------------------------------------------------------------------- */
/* Where the setup is                                                         */
/* -------------------------------------------------------------------------- */

/**
 * What the setup road is doing right now.
 *
 * THERE IS NO `checking-name` PHASE, and its absence is a decision. The name
 * was checked before the press — the press is not even enabled until the
 * registry has said the name is free (`custodyNameFirstEnabled`) — so by the
 * time this timeline exists that row is already ticked. A phase for it would be
 * a state the screen can never be in, and a state nothing can reach is a lie
 * told to the next reader of this file.
 */
export type CustodySetupPhase =
  /** The ceremony this arm needs — a passkey touch, or the sign-in's approval. */
  | 'confirm-identity'
  /** The account itself coming into existence. */
  | 'creating'
  /**
   * The key being turned on.
   *
   * STRAIGHT AFTER THE ACCOUNT, since 2026/09/22. There used to be a
   * `finishing` phase between the two — the maintenance waves carrying the
   * other twenty circuits — and it was seventy seconds of somebody watching a
   * row about work their Passport does not use. The deploy carries every
   * circuit the key's own arm calls, so the key is turned on at once and the
   * rest of the roster goes in behind Home, where nobody waits for it. It has
   * no row, because a row about work nobody is waiting on is furniture.
   */
  | 'activating'
  /** The `.night` name being registered against the account. */
  | 'registering'
  /** The name being read back, so what is shown is what landed. */
  | 'confirming'
  /** Set up, named, and done. */
  | 'done'

/**
 * What the screen SAYS happened, as opposed to what it worked out.
 *
 * The two middle ones are the custody road's own phases; the other three are
 * the screen's, because the ceremony and the name claim are not the custody
 * road's to report. Every other phase the custody road reports — `wallet`,
 * `waves`, `sign`, `submit`, `confirm` — is a moment INSIDE one of these, or
 * work behind Home, and deliberately has no signal: advancing the timeline on
 * the `confirm` that ends the activation would move it to the name before the
 * name had been asked for.
 */
export type CustodySetupSignal = 'identity' | 'deploy' | 'activate' | 'register' | 'confirm'

/** What `nextCustodyStep` says is still to do about a stored record. */
export type CustodySetupRecordStep = 'deploy' | 'activate' | 'ready' | 'interrupted'

/** Everything the phase is decided from. */
export interface CustodySetupProgressInput {
  /** True while the one press is still running. */
  readonly running: boolean
  /** The last thing this press reported, or null when nothing has. */
  readonly signal: CustodySetupSignal | null
  /** What the stored record still has to do, or null when nothing is stored. */
  readonly recordStep: CustodySetupRecordStep | null
  /** True once this Passport holds a `.night` name. */
  readonly named: boolean
}

const PHASE_OF_SIGNAL: Record<CustodySetupSignal, CustodySetupPhase> = {
  identity: 'confirm-identity',
  deploy: 'creating',
  activate: 'activating',
  register: 'registering',
  confirm: 'confirming',
}

const PHASE_OF_RECORD_STEP: Record<CustodySetupRecordStep, CustodySetupPhase> = {
  deploy: 'creating',
  activate: 'activating',
  /* Built and activated, and the only thing left is the name. */
  ready: 'registering',
  /* A setup that cannot be finished is back at the beginning, because the one
     thing that can be done about it is to start a fresh one — the same reading
     `custodyContractSession.ts#dynamicSetupPhase` makes of it. */
  interrupted: 'creating',
}

/**
 * Which phase to paint, or null for "show no timeline at all".
 *
 * READ IN THIS ORDER, and the order is the whole rule.
 *
 * WHAT THIS PRESS SAID OUTRANKS EVERYTHING, because it is the only thing that
 * is current. The stored record is re-read when a press finishes, not while it
 * runs, and believing it mid-press is exactly the defect this module was
 * written for: a counter frozen at the first step while the chain showed all
 * three done.
 *
 * WITH NOTHING REPORTED, THE RECORD IS THE TRUTH. That is the reload case, and
 * it is why the timeline survives one: a browser closed on the second wave
 * comes back to a timeline on the second wave, because the phase is recomputed
 * from what is stored rather than remembered in React state that a reload
 * throws away.
 *
 * AND WITH NEITHER, THERE IS NOTHING TO SHOW. A Passport that has not started,
 * one whose setup cannot be finished, and one that is finished and named are
 * all states where a timeline would be furniture — so the name step shows its
 * ordinary promise line instead.
 */
export function custodySetupPhase(input: CustodySetupProgressInput): CustodySetupPhase | null {
  if (input.signal !== null) return PHASE_OF_SIGNAL[input.signal]
  if (input.named) return input.running ? 'done' : null
  if (input.running) return PHASE_OF_RECORD_STEP[input.recordStep ?? 'deploy']
  if (input.recordStep === null) return null
  if (input.recordStep === 'ready' || input.recordStep === 'interrupted') return null
  return PHASE_OF_RECORD_STEP[input.recordStep]
}

/* -------------------------------------------------------------------------- */
/* The three rows                                                             */
/* -------------------------------------------------------------------------- */

/** One row of the timeline: what it says, and how long it usually costs. */
export interface CustodySetupStep {
  readonly id: 'name' | 'identity' | 'account'
  readonly label: string
  readonly state: ClaimStepState
  /** Seconds, or null when the answer is "as long as you take". */
  readonly expectedSeconds: number | null
}

/**
 * How long the long row usually takes.
 *
 * WAS FOUR MINUTES, measured on 2026/09/22 over nine dependent transactions:
 * the deploy, three maintenance waves, the activation, the opening balance,
 * and the name. The row now covers two of them — the deploy and the
 * activation, with the name running beside them — which on stagenet's
 * twenty-odd seconds a dependent step is about forty-five to sixty seconds
 * once the ceremony is over (`setup-speed-plan.md` §3a). Ninety is that,
 * rounded UP for the reason `./claimSteps.ts` gives about its own estimate:
 * over-stating one costs a reader nothing, while understating it turns every
 * ordinary setup into "taking a little longer than usual", which is the copy
 * kept for something going wrong. To be re-measured on the first live runs.
 */
export const CUSTODY_SETUP_EXPECTED_SECONDS = 90

/** The label the ceremony row carries, which is about how the reader got in. */
export function custodyIdentityStepLabel(arm: 'passkey' | 'dynamic'): string {
  return arm === 'passkey' ? 'Confirm with your passkey' : 'Confirm with your sign-in'
}

/** Which row a phase is, as an index into the three. */
function rowOfPhase(phase: CustodySetupPhase): 1 | 2 | 3 {
  if (phase === 'confirm-identity') return 1
  return phase === 'done' ? 3 : 2
}

/**
 * The three rows, with the state each one is in for `phase`.
 *
 * THE FIRST ROW IS ALWAYS TICKED. The press that produced this timeline could
 * not have been made over a name the registry had not reported free, so the
 * check it names is a thing that has already happened — and a row that sat
 * `todo` over work that was done would be the same untruth as a counter stuck
 * on one.
 */
export function custodySetupSteps(
  phase: CustodySetupPhase,
  arm: 'passkey' | 'dynamic',
): CustodySetupStep[] {
  const active = rowOfPhase(phase)
  const rows: readonly Omit<CustodySetupStep, 'state'>[] = [
    { id: 'name', label: 'Checking your name', expectedSeconds: 10 },
    /* No estimate, on purpose and for `./claimSteps.ts`'s reason: this row is
       the READER'S, and a countdown against somebody's own hands is a deadline
       rather than an estimate. */
    { id: 'identity', label: custodyIdentityStepLabel(arm), expectedSeconds: null },
    { id: 'account', label: 'Setting up your account', expectedSeconds: CUSTODY_SETUP_EXPECTED_SECONDS },
  ]
  return rows.map((row, index) => ({
    ...row,
    state: index < active ? 'done' : index === active ? 'active' : 'todo',
  }))
}

/* -------------------------------------------------------------------------- */
/* The long row, from the inside                                              */
/* -------------------------------------------------------------------------- */

/** Stable identity for one of the three states the long row passes through. */
export type CustodySetupSubStageId = 'account' | 'activate' | 'register'

export interface CustodySetupSubStage {
  readonly id: CustodySetupSubStageId
  /** Plain words, in the rows' own register. Never the machinery. */
  readonly label: string
  readonly state: ClaimStepState
}

/** The two SEQUENTIAL states of the long row, in the order they run. */
const LONG_ROW_PHASES: readonly CustodySetupPhase[] = ['creating', 'activating']

/**
 * The name's own state, when nothing says otherwise.
 *
 * The press that sets a Passport up starts the name the moment the account is
 * SUBMITTED, so the name runs BESIDE the other two rather than after them —
 * and what the screen knows about it is handed in. Without that, the phase is
 * the only witness: a press that is registering or confirming the name, or is
 * done, is the name-only press a Passport whose name was not yet claimed makes.
 */
function nameStateOfPhase(phase: CustodySetupPhase): ClaimStepState {
  if (phase === 'registering') return 'active'
  if (phase === 'confirming' || phase === 'done') return 'done'
  return 'todo'
}

/**
 * The three states of the long row, with the ones that are running now.
 *
 * They are NOT three more rows — a person cannot act on the difference between
 * them, which is the whole reason they fold into one. What they answer is "is
 * anything actually happening", which a minute of one unchanging sentence
 * cannot. They are returned for EVERY phase, all `todo` before the row is
 * reached, because the timeline's shape rule holds inside a row as well as
 * outside it: a state fills in, it never appears under a reader mid-wait.
 *
 * TWO CAN BE ACTIVE AT ONCE, and that is the truth rather than a glitch. Since
 * 2026/09/22 the name is claimed as soon as the account is submitted, so
 * "Registering alice.night" runs while the key is being turned on. `name` is
 * that state as the screen knows it; omitted, it is read off the phase.
 *
 * `domain` is the name being claimed — `alice.night` — so the registration
 * state can name it; omitted, it says "your name".
 */
export function custodySetupSubStages(
  phase: CustodySetupPhase,
  domain?: string,
  name?: ClaimStepState,
): CustodySetupSubStage[] {
  const active =
    phase === 'registering' || phase === 'confirming' || phase === 'done'
      ? LONG_ROW_PHASES.length
      : LONG_ROW_PHASES.indexOf(phase)
  const sequential: readonly { id: CustodySetupSubStageId; label: string }[] = [
    { id: 'account', label: 'Creating your account' },
    { id: 'activate', label: 'Turning on your sign-in' },
  ]
  const stateAt = (index: number): ClaimStepState =>
    index < active ? 'done' : index === active ? 'active' : 'todo'
  return [
    ...sequential.map((stage, index) => ({ ...stage, state: stateAt(index) })),
    {
      id: 'register',
      label: domain !== undefined ? `Registering ${domain}` : 'Registering your name',
      state: name ?? nameStateOfPhase(phase),
    },
  ]
}

/* -------------------------------------------------------------------------- */
/* The one sentence that is left                                              */
/* -------------------------------------------------------------------------- */

/** The promise the name step makes before anything has started. */
export const CUSTODY_SETUP_PROMISE =
  'Setting your Passport up and claiming your name are paid for on your behalf.'

/** How many steps the counted sentence counts. */
export const CUSTODY_SETUP_COUNTED_STEPS = 2

const COUNTED_PHASES: readonly CustodySetupPhase[] = ['creating', 'activating']

/**
 * The hint beneath the button, which must never disagree with the timeline
 * above it.
 *
 * THE COUNT IS KEPT AND MADE TRUE, rather than deleted. It was not wrong to
 * count — "step 2 of 3" is a useful thing to know — it was wrong to read the
 * count off a record that only changes when the press is over. It is read off
 * the live phase now, so the three it counts are the three the timeline's long
 * row is showing, and the words are the ones
 * `../identity/custodyContractSession.ts#dynamicSetupCopy` has always used so
 * the two surfaces cannot drift apart.
 *
 * The phases outside the count say what they are instead of guessing a number:
 * the ceremony is the reader's, and the name is not one of the three.
 */
export function custodySetupHint(phase: CustodySetupPhase | null): string {
  if (phase === null) return CUSTODY_SETUP_PROMISE
  if (phase === 'confirm-identity') return 'Confirm it is you, and the rest is ours.'
  if (phase === 'registering') return 'Registering your name.'
  if (phase === 'confirming') return 'Confirming your name.'
  if (phase === 'done') return 'Your Passport is ready.'
  const step = COUNTED_PHASES.indexOf(phase) + 1
  return `Setting up your Passport, step ${step} of ${CUSTODY_SETUP_COUNTED_STEPS}`
}

/* -------------------------------------------------------------------------- */
/* The stopwatch a live run is measured with                                  */
/* -------------------------------------------------------------------------- */

/** The tag every timing line carries, so a page console can be filtered to it. */
export const CUSTODY_SETUP_TIMING_TAG = '[setup-timing]'

/**
 * One timing line: `[setup-timing] <phase> <ms since the press>`.
 *
 * Whole milliseconds and nothing else on the line, so a live run can be read
 * straight out of the page console and pasted into a table without editing.
 */
export function custodySetupTimingLine(phase: string, sinceMs: number): string {
  return `${CUSTODY_SETUP_TIMING_TAG} ${phase} ${Math.max(0, Math.round(sinceMs))}`
}

/** A stopwatch started at a press. */
export interface CustodySetupClock {
  /** Logs `phase` against the press and returns the milliseconds since it. */
  mark(phase: string): number
}

/**
 * Start the stopwatch for one press.
 *
 * The clock and the log are handed in, so the rule — every line is measured
 * from the SAME press, and a phase is logged the moment it happens — can be
 * drilled without a browser; the screen hands in `performance.now` and
 * `console.info`.
 */
export function custodySetupClock(
  now: () => number,
  log: (line: string) => void,
): CustodySetupClock {
  const pressedAt = now()
  return {
    mark(phase: string): number {
      const since = now() - pressedAt
      log(custodySetupTimingLine(phase, since))
      return since
    },
  }
}

/* -------------------------------------------------------------------------- */
/* Behind Home: what to pick back up, and when                                */
/* -------------------------------------------------------------------------- */

/** What the screen knows when it asks whether to start the work behind Home. */
export interface CustodyBackgroundInput {
  /** The record's maintenance waves are not all in (`custodyWavesPending`). */
  readonly wavesPending: boolean
  /** The opening balance is still to be asked for (`custodyOpeningBalanceDue`). */
  readonly openingBalanceDue: boolean
  /** This tab holds the device key — the ceremony has happened here. */
  readonly keyHeld: boolean
  /** A press, a payment, or the background work itself is running. */
  readonly busy: boolean
  /** This tab has already asked for the opening balance once. */
  readonly balanceTried: boolean
  /**
   * How long ago the last run of the waves in this tab stopped short, or null
   * when none has. A failure that comes straight back is not retried on every
   * render: see {@link CUSTODY_WAVES_RETRY_MS}.
   */
  readonly wavesStoppedMsAgo?: number | null
}

/** How long the waves are left alone after a run that stopped short. */
export const CUSTODY_WAVES_RETRY_MS = 60_000

/**
 * Which piece of the work behind Home to start now, or null for none.
 *
 * THE WAVES FIRST, AND ONLY WITH THE KEY. A passkey's maintenance authority is
 * derived from the device key and written nowhere, so the waves resume the
 * moment the key is held in this tab — the setup press, a payment, adding the
 * way back — and never by prompting for it: a browser refuses a passkey prompt
 * nobody pressed for. Until then NOTHING else starts either, because the
 * opening balance cannot be paid into an account that is missing circuits.
 *
 * THE BALANCE NEEDS NOBODY, and is asked once per tab from here; the waves'
 * own finish asks again, because a wave landing is new news.
 */
export function custodyBackgroundWork(
  input: CustodyBackgroundInput,
): 'waves' | 'opening-balance' | null {
  if (input.busy) return null
  if (input.wavesPending) {
    const cooling =
      input.wavesStoppedMsAgo != null && input.wavesStoppedMsAgo < CUSTODY_WAVES_RETRY_MS
    return input.keyHeld && !cooling ? 'waves' : null
  }
  if (input.openingBalanceDue && !input.balanceTried) return 'opening-balance'
  return null
}
