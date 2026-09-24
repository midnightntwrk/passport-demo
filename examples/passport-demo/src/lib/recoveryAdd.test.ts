import { describe, expect, it, vi } from 'vitest'

import {
  CUSTODY_KEY_NOT_ADDED,
  CUSTODY_KEY_UNCONFIRMED,
  CUSTODY_PHASE_PROVED,
  CUSTODY_SEND_NOT_SENT,
  CUSTODY_STILL_FINISHING,
} from '../identity/custodyContractPlan.js'
import {
  RECOVERY_ADD_WAIT_MS,
  RECOVERY_FINISH_WAIT_MS,
  RECOVERY_KEY_NOT_READY,
  RECOVERY_KEY_RETRY_MS,
  RECOVERY_KEY_WAIT_MS,
  RECOVERY_PASSKEY_DECLINED,
  recoveryAddFailureSentence,
  recoveryAddNeedsReader,
  recoveryAddRows,
  recoveryAddStageOfPhase,
  runRecoveryAdd,
  type RecoveryAddPhase,
  type RecoveryAddProgress,
  type RecoveryAddStage,
  type RecoveryAddSteps,
} from './recoveryAdd.js'

/* -------------------------------------------------------------------------- */
/* The rows                                                                   */
/* -------------------------------------------------------------------------- */

/** One row as `label:state`, and the add row's sub-stages as `[…]`. */
function shape(progress: RecoveryAddProgress): string[] {
  return recoveryAddRows(progress).map((row) =>
    row.subStages === null
      ? `${row.label}:${row.state}`
      : `${row.label}:${row.state} [${row.subStages.map((stage) => `${stage.label}:${stage.state}`).join(', ')}]`,
  )
}

describe('the rows of adding recovery', () => {
  it('ticks the sign-in row from the first frame, and runs the passkey', () => {
    expect(shape({ stage: 'passkey', finishing: false })).toEqual([
      'Sign in to your recovery account:done',
      'Approve with your passkey:active',
      'Add your recovery key:todo [Getting your recovery key:todo, Preparing:todo, Proving:todo, Sending:todo, Confirming:todo]',
      'Recovery is on:todo',
    ])
  })

  it('shows the finishing row only when there was something to finish', () => {
    expect(shape({ stage: 'finish', finishing: true })).toEqual([
      'Sign in to your recovery account:done',
      'Approve with your passkey:done',
      'Finish setting up your Passport:active',
      'Add your recovery key:todo [Getting your recovery key:todo, Preparing:todo, Proving:todo, Sending:todo, Confirming:todo]',
      'Recovery is on:todo',
    ])
    expect(shape({ stage: 'key', finishing: false }).join('\n')).not.toContain('Finish setting up')
  })

  it.each([
    ['key', 'Getting your recovery key:active, Preparing:todo, Proving:todo, Sending:todo, Confirming:todo'],
    ['prepare', 'Getting your recovery key:done, Preparing:active, Proving:todo, Sending:todo, Confirming:todo'],
    ['prove', 'Getting your recovery key:done, Preparing:done, Proving:active, Sending:todo, Confirming:todo'],
    ['send', 'Getting your recovery key:done, Preparing:done, Proving:done, Sending:active, Confirming:todo'],
    ['confirm', 'Getting your recovery key:done, Preparing:done, Proving:done, Sending:done, Confirming:active'],
  ] as const)('fills the add row in at %s', (stage, subStages) => {
    const rows = shape({ stage, finishing: true })
    expect(rows[2]).toBe('Finish setting up your Passport:done')
    expect(rows[3]).toBe(`Add your recovery key:active [${subStages}]`)
    expect(rows[4]).toBe('Recovery is on:todo')
  })

  it('ticks everything once recovery is on', () => {
    const rows = recoveryAddRows({ stage: 'done', finishing: true })
    expect(rows.every((row) => row.state === 'done')).toBe(true)
    expect(rows.find((row) => row.id === 'add')?.subStages?.every((stage) => stage.state === 'done')).toBe(true)
  })

  it('estimates the rows that are machinery, and not the ones that are the reader’s', () => {
    const rows = recoveryAddRows({ stage: 'passkey', finishing: true })
    expect(rows.map((row) => row.expectedSeconds)).toEqual([null, null, 90, 60, null])
  })

  it('says none of the words a reader has no use for', () => {
    const words = (['passkey', 'finish', 'key', 'prepare', 'prove', 'send', 'confirm', 'done'] as const)
      .flatMap((stage) => shape({ stage, finishing: true }))
      .join(' ')
      .toLowerCase()
    for (const forbidden of ['wallet address', 'dust', 'contract', 'registry', 'indexer', 'resolver', 'sponsor', 'sdk', 'dynamic']) {
      expect(words).not.toContain(forbidden)
    }
  })
})

describe('the stage a reported phase moves to', () => {
  it.each([
    [{ step: 'submit' }, 'prove'],
    [{ step: 'submit', detail: CUSTODY_PHASE_PROVED }, 'send'],
    [{ step: 'confirm', detail: 'tx' }, 'confirm'],
    [{ step: 'sign' }, null],
    [{ step: 'wallet' }, null],
  ] as const)('%o moves to %s', (phase, stage) => {
    expect(recoveryAddStageOfPhase(phase)).toBe(stage)
  })

  it('wants the reader for the passkey and the sign-in, and for nothing else', () => {
    const stages: RecoveryAddStage[] = ['passkey', 'finish', 'key', 'prepare', 'prove', 'send', 'confirm', 'done']
    expect(stages.filter(recoveryAddNeedsReader)).toEqual(['passkey', 'key'])
  })
})

/* -------------------------------------------------------------------------- */
/* The add                                                                    */
/* -------------------------------------------------------------------------- */

/** A wait that never ends, for a bound that must not fire. */
const never = (): Promise<void> => new Promise(() => undefined)

interface Run {
  steps: RecoveryAddSteps<string, string>
  seen: RecoveryAddProgress[]
  waited: number[]
  calls: string[]
}

function run(overrides: Partial<RecoveryAddSteps<string, string>> & { pending?: boolean[] } = {}): Run {
  const seen: RecoveryAddProgress[] = []
  const waited: number[] = []
  const calls: string[] = []
  const pending = overrides.pending ?? [false]
  let reads = 0
  const steps: RecoveryAddSteps<string, string> = {
    ensureIdentity: () => {
      calls.push('passkey')
      return Promise.resolve('device')
    },
    wavesPending: () => pending[Math.min(reads++, pending.length - 1)],
    finishWaves: () => {
      calls.push('finish')
      return Promise.resolve()
    },
    recoveryKey: () => {
      calls.push('key')
      return Promise.resolve('recovery-key')
    },
    addKey: (_identity, _key, onPhase) => {
      calls.push('add')
      onPhase({ step: 'sign' })
      onPhase({ step: 'submit' })
      onPhase({ step: 'submit', detail: CUSTODY_PHASE_PROVED })
      onPhase({ step: 'confirm' })
      return Promise.resolve()
    },
    onProgress: (progress) => seen.push(progress),
    wait: (milliseconds) => {
      waited.push(milliseconds)
      return never()
    },
    ...overrides,
  }
  return { steps, seen, waited, calls }
}

describe('adding recovery, start to end', () => {
  it('walks every row in order, driven by what the add reports', async () => {
    const r = run()
    await runRecoveryAdd(r.steps)
    expect(r.seen.map((progress) => progress.stage)).toEqual([
      'passkey',
      'key',
      'prepare',
      'prove',
      'send',
      'confirm',
      'done',
    ])
    expect(r.seen.every((progress) => !progress.finishing)).toBe(true)
    expect(r.calls).toEqual(['passkey', 'key', 'add'])
  })

  it('bounds every step it waits on, with the real bounds by default', async () => {
    const r = run()
    await runRecoveryAdd(r.steps)
    expect(r.waited).toEqual([RECOVERY_KEY_WAIT_MS, RECOVERY_ADD_WAIT_MS])
  })

  it('goes straight to "on" for a key that is already there', async () => {
    const r = run({ addKey: () => Promise.resolve() })
    await runRecoveryAdd(r.steps)
    expect(r.seen.map((progress) => progress.stage)).toEqual(['passkey', 'key', 'prepare', 'done'])
  })

  it('finishes the rest of the setup first, after the passkey, when it is pending', async () => {
    const r = run({ pending: [true, true, false] })
    await runRecoveryAdd(r.steps)
    expect(r.calls).toEqual(['passkey', 'finish', 'key', 'add'])
    expect(r.seen.map((progress) => progress.stage).slice(0, 3)).toEqual(['passkey', 'finish', 'key'])
    expect(r.seen.every((progress) => progress.finishing)).toBe(true)
    expect(r.waited[0]).toBe(RECOVERY_FINISH_WAIT_MS)
  })

  it('does not finish what landed while the passkey was being asked', async () => {
    const r = run({ pending: [true, false] })
    await runRecoveryAdd(r.steps)
    expect(r.calls).toEqual(['passkey', 'key', 'add'])
  })

  it('says the Passport is still finishing when the rest did not land — before asking for the key', async () => {
    /* THE SILENT FAILURE: the finishing call swallows its own error, and the
       add used to go on to ask the sign-in for its key and refuse afterwards. */
    const r = run({ pending: [true] })
    await expect(runRecoveryAdd(r.steps)).rejects.toThrow(CUSTODY_STILL_FINISHING)
    expect(r.calls).toEqual(['passkey', 'finish'])
  })

  it('says the same, within the bound, when finishing the rest hangs', async () => {
    const r = run({
      pending: [true],
      finishWaves: () => new Promise(() => undefined),
      wait: () => Promise.resolve(),
    })
    await expect(runRecoveryAdd(r.steps)).rejects.toThrow(CUSTODY_STILL_FINISHING)
  })

  it('asks for the key once more after a pause when the sign-in is still starting up', async () => {
    let asked = 0
    const r = run({
      recoveryKey: () => {
        asked += 1
        return asked === 1
          ? Promise.reject(new Error('Sign-in is still starting up. Try again in a moment.'))
          : Promise.resolve('recovery-key')
      },
      wait: (milliseconds) => (milliseconds === RECOVERY_KEY_RETRY_MS ? Promise.resolve() : never()),
    })
    await runRecoveryAdd(r.steps)
    expect(asked).toBe(2)
  })

  it('says the sign-in is still finishing when it is still not ready the second time', async () => {
    const r = run({
      recoveryKey: () => Promise.reject(new Error('Your sign-in is still finishing.')),
      wait: (milliseconds) => (milliseconds === RECOVERY_KEY_RETRY_MS ? Promise.resolve() : never()),
    })
    await expect(runRecoveryAdd(r.steps)).rejects.toThrow(RECOVERY_KEY_NOT_READY)
  })

  it('bounds a key that never comes, and asks once more before saying so', async () => {
    const key = vi.fn(() => new Promise<string>(() => undefined))
    const r = run({ recoveryKey: key, wait: () => Promise.resolve() })
    await expect(runRecoveryAdd(r.steps)).rejects.toThrow(RECOVERY_KEY_NOT_READY)
    expect(key).toHaveBeenCalledTimes(2)
  })

  it('does not ask again for a key the sign-in refused for another reason', async () => {
    const refusal = new Error('declined')
    const key = vi.fn(() => Promise.reject(refusal))
    const r = run({ recoveryKey: key })
    await expect(runRecoveryAdd(r.steps)).rejects.toBe(refusal)
    expect(key).toHaveBeenCalledTimes(1)
  })

  it('says it could not confirm when the add outlives its last bound', async () => {
    const r = run({
      addKey: () => new Promise(() => undefined),
      wait: (milliseconds) => (milliseconds === 5 ? Promise.resolve() : never()),
      bounds: { addMs: 5 },
    })
    await expect(runRecoveryAdd(r.steps)).rejects.toThrow(CUSTODY_KEY_UNCONFIRMED)
    expect(r.seen.at(-1)?.stage).toBe('prepare')
  })

  it('passes the add’s own sentence through', async () => {
    const r = run({ addKey: () => Promise.reject(new Error(CUSTODY_KEY_NOT_ADDED)) })
    await expect(runRecoveryAdd(r.steps)).rejects.toThrow(CUSTODY_KEY_NOT_ADDED)
    expect(r.seen.map((progress) => progress.stage)).not.toContain('done')
  })

  it('moves the timeline back to proving when the add is built again', async () => {
    const phases: RecoveryAddPhase[] = [
      { step: 'submit' },
      { step: 'submit', detail: CUSTODY_PHASE_PROVED },
      { step: 'submit' },
      { step: 'submit', detail: CUSTODY_PHASE_PROVED },
      { step: 'confirm' },
    ]
    const r = run({
      addKey: (_identity, _key, onPhase) => {
        phases.forEach(onPhase)
        return Promise.resolve()
      },
    })
    await runRecoveryAdd(r.steps)
    expect(r.seen.map((progress) => progress.stage)).toEqual([
      'passkey',
      'key',
      'prepare',
      'prove',
      'send',
      'prove',
      'send',
      'confirm',
      'done',
    ])
  })
})

/* -------------------------------------------------------------------------- */
/* What a failure says                                                        */
/* -------------------------------------------------------------------------- */

describe('the one sentence a failed add shows', () => {
  it.each([CUSTODY_KEY_NOT_ADDED, CUSTODY_KEY_UNCONFIRMED, CUSTODY_STILL_FINISHING, RECOVERY_KEY_NOT_READY])(
    'shows "%s" as it is',
    (sentence) => {
      expect(recoveryAddFailureSentence(new Error(sentence))).toBe(sentence)
    },
  )

  it('says the passkey was not confirmed when the prompt was dismissed', () => {
    const dismissed = Object.assign(new Error('The operation either timed out or was not allowed.'), {
      name: 'NotAllowedError',
    })
    expect(recoveryAddFailureSentence(dismissed)).toBe(RECOVERY_PASSKEY_DECLINED)
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' })
    expect(recoveryAddFailureSentence(aborted)).toBe(RECOVERY_PASSKEY_DECLINED)
  })

  it('never shows a payment’s sentence, a library’s words, or nothing', () => {
    for (const cause of [new Error(CUSTODY_SEND_NOT_SENT), new Error('RpcError: 1010'), 'text', null]) {
      expect(recoveryAddFailureSentence(cause)).toBe(CUSTODY_KEY_NOT_ADDED)
    }
  })
})
