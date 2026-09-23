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
  CUSTODY_WAVES_RETRY_MS,
  custodyBackgroundWork,
  CUSTODY_SETUP_TIMING_TAG,
  custodySetupClock,
  custodySetupTimingLine,
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
    expect(custodySetupPhase({ ...idle, running: true, recordStep: 'activate' })).toBe('activating')
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
    for (const phase of ['creating', 'activating', 'registering', 'confirming'] as const) {
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
    /* Ninety seconds, said as "about 2 minutes" by `./claimSteps.ts`: the
       deploy and the activation, with the name beside them, rounded UP so an
       ordinary setup is not reported as taking longer than usual every time.
       It was four minutes while the waves and the grant sat in front of Home. */
    expect(CUSTODY_SETUP_EXPECTED_SECONDS).toBe(90)
  })
})

describe('the three states of the long row', () => {
  it('is on screen whole from the first frame, so a row fills in rather than appearing', () => {
    const stages = custodySetupSubStages('confirm-identity')
    expect(stages.map((stage) => stage.id)).toEqual(['account', 'activate', 'register'])
    expect(stages.every((stage) => stage.state === 'todo')).toBe(true)
  })

  it('names them in the reader’s words, and names the name being claimed', () => {
    expect(custodySetupSubStages('creating', 'alice.night').map((stage) => stage.label)).toEqual([
      'Creating your account',
      'Turning on your sign-in',
      'Registering alice.night',
    ])
    expect(custodySetupSubStages('creating')[2].label).toBe('Registering your name')
  })

  /* THE NEW ORDER (2026/09/22): no "Finishing your account" between the two —
     that work runs behind Home now — and the key straight after the account. */
  it('turns the key on straight after the account, with nothing between', () => {
    expect(custodySetupSubStages('creating').map((stage) => stage.state)).toEqual([
      'active',
      'todo',
      'todo',
    ])
    expect(custodySetupSubStages('activating').map((stage) => stage.state)).toEqual([
      'done',
      'active',
      'todo',
    ])
  })

  /* The name is claimed the moment the account is SUBMITTED, so it runs beside
     the other two — and two states active at once is the truth. */
  it('runs the name beside the account and the key, as the screen reports it', () => {
    expect(custodySetupSubStages('creating', 'a.night', 'active').map((s) => s.state)).toEqual([
      'active',
      'todo',
      'active',
    ])
    expect(custodySetupSubStages('activating', 'a.night', 'done').map((s) => s.state)).toEqual([
      'done',
      'active',
      'done',
    ])
  })

  it('reads the name off the phase when nothing reports it — the name-only press', () => {
    expect(custodySetupSubStages('registering').map((stage) => stage.state)).toEqual([
      'done',
      'done',
      'active',
    ])
    expect(custodySetupSubStages('confirming').map((stage) => stage.state)).toEqual([
      'done',
      'done',
      'done',
    ])
    expect(custodySetupSubStages('done').every((stage) => stage.state === 'done')).toBe(true)
  })
})

describe('the one sentence under the button', () => {
  it('counts the two, off the live phase and not off a stored record', () => {
    expect(custodySetupHint('creating')).toBe('Setting up your Passport, step 1 of 2')
    expect(custodySetupHint('activating')).toBe('Setting up your Passport, step 2 of 2')
    expect(CUSTODY_SETUP_COUNTED_STEPS).toBe(2)
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

describe('the stopwatch a live run is measured with', () => {
  it('writes one filterable line per phase, in whole milliseconds since the press', () => {
    expect(custodySetupTimingLine('activated', 41_234.6)).toBe('[setup-timing] activated 41235')
    expect(custodySetupTimingLine('press', -3)).toBe('[setup-timing] press 0')
    expect(CUSTODY_SETUP_TIMING_TAG).toBe('[setup-timing]')
  })

  it('measures every mark from the same press', () => {
    let clock = 1_000
    const lines: string[] = []
    const watch = custodySetupClock(
      () => clock,
      (line) => lines.push(line),
    )
    clock = 1_250
    expect(watch.mark('identity')).toBe(250)
    clock = 20_000
    expect(watch.mark('deploy-submitted')).toBe(19_000)
    expect(lines).toEqual([
      '[setup-timing] identity 250',
      '[setup-timing] deploy-submitted 19000',
    ])
  })
})

describe('what is picked back up behind Home', () => {
  const idleHome = {
    wavesPending: false,
    openingBalanceDue: false,
    keyHeld: false,
    busy: false,
    balanceTried: false,
  }

  it('finishes the waves the moment the key is held, and never prompts for it', () => {
    expect(custodyBackgroundWork({ ...idleHome, wavesPending: true, keyHeld: true })).toBe('waves')
    expect(custodyBackgroundWork({ ...idleHome, wavesPending: true })).toBeNull()
  })

  /* The service cannot pay into an account missing any circuit, so the balance
     waits for the waves even when it is otherwise due. */
  it('asks for the opening balance only once the waves are in, and once per tab', () => {
    expect(
      custodyBackgroundWork({ ...idleHome, wavesPending: true, openingBalanceDue: true }),
    ).toBeNull()
    expect(custodyBackgroundWork({ ...idleHome, openingBalanceDue: true })).toBe('opening-balance')
    expect(
      custodyBackgroundWork({ ...idleHome, openingBalanceDue: true, balanceTried: true }),
    ).toBeNull()
  })

  it('starts nothing while a press, a payment, or the work itself is running', () => {
    expect(
      custodyBackgroundWork({ ...idleHome, wavesPending: true, keyHeld: true, busy: true }),
    ).toBeNull()
    expect(custodyBackgroundWork({ ...idleHome, openingBalanceDue: true, busy: true })).toBeNull()
  })

  /* A run that stopped short is not retried on every render — only once the
     cooling-off has passed, on the next thing that refreshes the screen. */
  it('leaves the waves alone for a minute after a run that stopped short', () => {
    const pending = { ...idleHome, wavesPending: true, keyHeld: true }
    expect(custodyBackgroundWork({ ...pending, wavesStoppedMsAgo: 1_000 })).toBeNull()
    expect(
      custodyBackgroundWork({ ...pending, wavesStoppedMsAgo: CUSTODY_WAVES_RETRY_MS }),
    ).toBe('waves')
    expect(custodyBackgroundWork({ ...pending, wavesStoppedMsAgo: null })).toBe('waves')
  })

  it('has nothing to do for a finished Passport', () => {
    expect(custodyBackgroundWork({ ...idleHome, keyHeld: true })).toBeNull()
  })
})
