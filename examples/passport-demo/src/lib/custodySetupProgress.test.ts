/**
 * THE SETUP TIMELINE, DRILLED AS A RULE.
 *
 * Every assertion here is about a value, because the whole module is a value
 * in and a value out. What a browser is needed for — that the clock genuinely
 * ticks on a phase that is not moving — is held in
 * `e2e/passkey-custody.spec.ts` and `e2e/claim-progress.spec.ts`, for the
 * reason the latter states: a number rendered once from `Date.now()` passes
 * every test about its format and is exactly the hang it was built to
 * disprove.
 *
 * The defect this file exists to keep out is specific. A reader watched the
 * old counter say "Setting up your Passport, step 1 of 3" while the chain
 * showed all three steps landed, because the count was read off a record that
 * is re-read only when a press finishes. So the first group below is about
 * which answer wins, and it is the one that matters.
 */

import { describe, expect, it } from 'vitest'

import {
  CUSTODY_SETUP_COUNTED_STEPS,
  CUSTODY_SETUP_EXPECTED_SECONDS,
  CUSTODY_SETUP_PROMISE,
  custodyIdentityStepLabel,
  custodySetupHint,
  custodySetupPhase,
  custodySetupSteps,
  custodySetupSubStages,
  type CustodySetupPhase,
  type CustodySetupProgressInput,
  type CustodySetupSignal,
} from './custodySetupProgress.js'

const idle: CustodySetupProgressInput = {
  running: false,
  signal: null,
  recordStep: null,
  named: false,
}

describe('which phase the setup is in', () => {
  it('believes what this press said, over anything that is stored', () => {
    /* THE DEFECT, AS A TEST. The record still says "nothing deployed" for the
       whole of the press that deploys it, so a timeline that read the record
       would sit on the first row until the press was over — which is exactly
       what was seen on 2026/09/22. */
    const signals: [CustodySetupSignal, CustodySetupPhase][] = [
      ['identity', 'confirm-identity'],
      ['deploy', 'creating'],
      ['waves', 'finishing'],
      ['activate', 'activating'],
      ['register', 'registering'],
      ['confirm', 'confirming'],
    ]
    for (const [signal, phase] of signals) {
      expect(
        custodySetupPhase({ running: true, signal, recordStep: 'deploy', named: false }),
      ).toBe(phase)
    }
  })

  it('falls back to the record when nothing has been reported — which is a reload', () => {
    expect(custodySetupPhase({ ...idle, recordStep: 'deploy' })).toBe('creating')
    expect(custodySetupPhase({ ...idle, recordStep: 'waves' })).toBe('finishing')
    expect(custodySetupPhase({ ...idle, recordStep: 'activate' })).toBe('activating')
  })

  it('shows nothing where a timeline would be furniture', () => {
    // Nothing started.
    expect(custodySetupPhase(idle)).toBeNull()
    // Built and activated, waiting on a press that has not been made.
    expect(custodySetupPhase({ ...idle, recordStep: 'ready' })).toBeNull()
    /* A setup that cannot be finished. The offer is a fresh Passport, and a
       timeline over it would be counting a wait nobody is in. */
    expect(custodySetupPhase({ ...idle, recordStep: 'interrupted' })).toBeNull()
    // Finished and named: this Passport is past onboarding entirely.
    expect(custodySetupPhase({ ...idle, recordStep: 'ready', named: true })).toBeNull()
  })

  it('reads a running press with nothing reported off the record, and a missing one as the start', () => {
    expect(custodySetupPhase({ ...idle, running: true, recordStep: 'waves' })).toBe('finishing')
    expect(custodySetupPhase({ ...idle, running: true, recordStep: 'interrupted' })).toBe('creating')
    expect(custodySetupPhase({ ...idle, running: true, recordStep: 'ready' })).toBe('registering')
    expect(custodySetupPhase({ ...idle, running: true })).toBe('creating')
  })

  it('is done when the name has landed and the press has not let go yet', () => {
    expect(
      custodySetupPhase({ running: true, signal: null, recordStep: 'ready', named: true }),
    ).toBe('done')
  })
})

describe('the three rows', () => {
  it('always ticks the name check, because the press could not have happened without it', () => {
    for (const phase of [
      'confirm-identity',
      'creating',
      'finishing',
      'activating',
      'registering',
      'confirming',
      'done',
    ] as const) {
      expect(custodySetupSteps(phase, 'passkey')[0]).toMatchObject({
        id: 'name',
        label: 'Checking your name',
        state: 'done',
      })
    }
  })

  it('runs the ceremony row, then the long one, then neither', () => {
    expect(custodySetupSteps('confirm-identity', 'passkey').map((row) => row.state)).toEqual([
      'done',
      'active',
      'todo',
    ])
    for (const phase of ['creating', 'finishing', 'activating', 'registering', 'confirming'] as const) {
      expect(custodySetupSteps(phase, 'passkey').map((row) => row.state)).toEqual([
        'done',
        'done',
        'active',
      ])
    }
    expect(custodySetupSteps('done', 'passkey').map((row) => row.state)).toEqual([
      'done',
      'done',
      'done',
    ])
  })

  it('names the ceremony after the way the reader got in', () => {
    expect(custodyIdentityStepLabel('passkey')).toBe('Confirm with your passkey')
    expect(custodyIdentityStepLabel('dynamic')).toBe('Confirm with your sign-in')
    expect(custodySetupSteps('confirm-identity', 'dynamic')[1].label).toBe(
      'Confirm with your sign-in',
    )
  })

  it('gives the reader no deadline for their own hands, and a measured one for the wait', () => {
    const rows = custodySetupSteps('creating', 'passkey')
    expect(rows[1].expectedSeconds).toBeNull()
    expect(rows[2].expectedSeconds).toBe(CUSTODY_SETUP_EXPECTED_SECONDS)
    /* Four minutes, said as "about 4 minutes" by `./claimSteps.ts`. Measured
       on 2026/09/22 and rounded UP, so an ordinary setup is not reported as
       taking longer than usual every single time. */
    expect(CUSTODY_SETUP_EXPECTED_SECONDS).toBe(240)
  })
})

describe('the five states of the long row', () => {
  it('is on screen whole from the first frame, so a row fills in rather than appearing', () => {
    const stages = custodySetupSubStages('confirm-identity')
    expect(stages.map((stage) => stage.id)).toEqual([
      'account',
      'finish',
      'activate',
      'register',
      'confirm',
    ])
    expect(stages.every((stage) => stage.state === 'todo')).toBe(true)
  })

  it('names them in the reader’s words, and names the name being claimed', () => {
    expect(custodySetupSubStages('creating', 'alice.night').map((stage) => stage.label)).toEqual([
      'Creating your account',
      'Finishing your account',
      'Turning on your sign-in',
      'Registering alice.night',
      'Confirming your name',
    ])
    expect(custodySetupSubStages('creating')[3].label).toBe('Registering your name')
  })

  it('marks the one that is running, and every one behind it', () => {
    expect(custodySetupSubStages('activating').map((stage) => stage.state)).toEqual([
      'done',
      'done',
      'active',
      'todo',
      'todo',
    ])
    expect(custodySetupSubStages('confirming').map((stage) => stage.state)).toEqual([
      'done',
      'done',
      'done',
      'done',
      'active',
    ])
    expect(custodySetupSubStages('done').every((stage) => stage.state === 'done')).toBe(true)
  })
})

describe('the one sentence under the button', () => {
  it('counts the three, off the live phase and not off a stored record', () => {
    expect(custodySetupHint('creating')).toBe('Setting up your Passport, step 1 of 3')
    expect(custodySetupHint('finishing')).toBe('Setting up your Passport, step 2 of 3')
    expect(custodySetupHint('activating')).toBe('Setting up your Passport, step 3 of 3')
    expect(CUSTODY_SETUP_COUNTED_STEPS).toBe(3)
  })

  it('says what it is instead of guessing a number, where there is no number', () => {
    expect(custodySetupHint('confirm-identity')).toBe('Confirm it is you, and the rest is ours.')
    expect(custodySetupHint('registering')).toBe('Registering your name.')
    expect(custodySetupHint('confirming')).toBe('Confirming your name.')
    expect(custodySetupHint('done')).toBe('Your Passport is ready.')
  })

  it('promises who is paying, before anything has started', () => {
    expect(custodySetupHint(null)).toBe(CUSTODY_SETUP_PROMISE)
    expect(CUSTODY_SETUP_PROMISE).toBe(
      'Setting your Passport up and claiming your name are paid for on your behalf.',
    )
  })

  it('names none of the machinery, on any phase', () => {
    const phases: (CustodySetupPhase | null)[] = [
      null,
      'confirm-identity',
      'creating',
      'finishing',
      'activating',
      'registering',
      'confirming',
      'done',
    ]
    const words = [
      ...phases.map((phase) => custodySetupHint(phase)),
      ...custodySetupSteps('creating', 'passkey').map((row) => row.label),
      ...custodySetupSteps('creating', 'dynamic').map((row) => row.label),
      ...custodySetupSubStages('creating', 'alice.night').map((stage) => stage.label),
    ].join(' ')
    for (const forbidden of [
      'contract',
      'registry',
      'indexer',
      'resolver',
      'sponsor',
      'DUST',
      'wallet',
      'SDK',
      'Dynamic',
    ]) {
      expect(words.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })
})
