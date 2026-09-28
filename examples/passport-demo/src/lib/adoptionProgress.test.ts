/**
 * THE TIMELINE "OPENING YOUR PASSPORT" IS SHOWN WITH (2026/09/27), drilled
 * row by row: which phase moves it where, which rows are ticked, running, and
 * still to come, and when a way out is offered.
 */

import { describe, expect, it } from 'vitest'
import { stepTimingLine } from './claimSteps.js'

import {
  ADOPTION_ADD_EXPECTED_SECONDS,
  ADOPTION_DONE_BEAT_MS,
  ADOPTION_KEEP_OPEN,
  ADOPTION_PHASE_FEE_COVERED,
  ADOPTION_PHASE_PROVED,
  ADOPTION_ROTATE_EXPECTED_SECONDS,
  adoptionCancellable,
  adoptionHandedOver,
  adoptionRows,
  adoptionStepOfPhase,
  type AdoptionStep,
} from './adoptionProgress.js'
import { RECOVERY_ADD_EXPECTED_SECONDS } from './recoveryAdd.js'
import { CUSTODY_PHASE_PROVED } from '../identity/custodyContractPlan.js'

const STEPS: readonly AdoptionStep[] = [
  'sign-in',
  'passkey',
  'approve',
  'prove',
  'fee',
  'send',
  'confirm',
  'rotate',
  'earlier',
  'done',
]

describe('the phases the add reports', () => {
  it('move the timeline in the order they happen', () => {
    expect(adoptionStepOfPhase({ step: 'sign' })).toBe('approve')
    expect(adoptionStepOfPhase({ step: 'submit' })).toBe('prove')
    expect(adoptionStepOfPhase({ step: 'submit', detail: ADOPTION_PHASE_PROVED })).toBe('fee')
    expect(adoptionStepOfPhase({ step: 'submit', detail: ADOPTION_PHASE_FEE_COVERED })).toBe('send')
    expect(adoptionStepOfPhase({ step: 'confirm' })).toBe('confirm')
  })

  it('leave it where it is for a phase that is not a step of the add', () => {
    for (const step of ['wallet', 'deploy', 'waves', 'activate']) {
      expect(adoptionStepOfPhase({ step })).toBeNull()
    }
  })

  it('read the proof being made as the custody client says it', () => {
    /* Written out rather than imported, so the entry chunk never reaches the
       custody client — and held to it here, so the two cannot drift. */
    expect(ADOPTION_PHASE_PROVED).toBe(CUSTODY_PHASE_PROVED)
  })
})

describe('what is in flight, and when there is a way out', () => {
  it('is in flight from the proof to the chain, and at no other step', () => {
    expect(STEPS.filter(adoptionHandedOver)).toEqual(['prove', 'fee', 'send', 'confirm'])
  })

  it('offers Cancel only before anything is handed over', () => {
    expect(STEPS.filter(adoptionCancellable)).toEqual(['sign-in', 'passkey', 'approve'])
  })
})

describe('the rows', () => {
  const states = (step: AdoptionStep) =>
    adoptionRows({ step, provider: 'Google' }).map((row) => `${row.id}:${row.state}`)

  it('are the steps the second half really takes, named by the provider the person chose', () => {
    const rows = adoptionRows({ step: 'sign-in', provider: 'Google' })
    expect(rows.map((row) => row.label)).toEqual([
      'Check your Google sign-in',
      'Make this device’s key',
      'Google approves this device',
      'Add this device to your Passport',
      'Point your payments at this device',
      'Bring back earlier payments',
      'Open your Passport',
    ])
    expect(rows.map((row) => row.expectedSeconds)).toEqual([
      null,
      null,
      null,
      ADOPTION_ADD_EXPECTED_SECONDS,
      ADOPTION_ROTATE_EXPECTED_SECONDS,
      null,
      null,
    ])
  })

  it('waits on the reader only for the passkey prompt, never for what happens by itself (2026/09/28)', () => {
    /* "Check your Google sign-in", "Google approves this device", and "Bring
       back earlier payments" all read "Waiting for you" while nobody had
       anything to press. */
    const rows = adoptionRows({ step: 'approve', provider: 'Google' })
    expect(rows.filter((row) => row.actor === 'you').map((row) => row.id)).toEqual(['passkey'])
    for (const step of ['sign-in', 'approve', 'earlier'] as const) {
      const running = adoptionRows({ step, provider: 'Google' }).find((row) => row.state === 'active')
      expect(running?.actor).toBe('passport')
      expect(stepTimingLine(running!, 12_000)).toBe('Working — 0:12')
    }
    const passkey = adoptionRows({ step: 'passkey', provider: 'Google' }).find((row) => row.state === 'active')
    expect(stepTimingLine(passkey!, 4_000)).toBe('Waiting for you — 0:04')
  })

  it('name no provider where none is known', () => {
    for (const provider of [null, '  ']) {
      const labels = adoptionRows({ step: 'sign-in', provider }).map((row) => row.label)
      expect(labels[0]).toBe('Check your sign-in')
      expect(labels[2]).toBe('Your sign-in approves this device')
    }
  })

  it('tick what has happened, run one row, and leave the rest to come', () => {
    expect(states('sign-in')).toEqual([
      'sign-in:active',
      'passkey:todo',
      'approve:todo',
      'add:todo',
      'rotate:todo',
      'earlier:todo',
      'home:todo',
    ])
    expect(states('approve')).toEqual([
      'sign-in:done',
      'passkey:done',
      'approve:active',
      'add:todo',
      'rotate:todo',
      'earlier:todo',
      'home:todo',
    ])
    expect(states('earlier')).toEqual([
      'sign-in:done',
      'passkey:done',
      'approve:done',
      'add:done',
      'rotate:done',
      'earlier:active',
      'home:todo',
    ])
  })

  it('never run the last row: it is ticked when the Passport is here', () => {
    for (const step of STEPS.filter((step) => step !== 'done')) {
      expect(states(step)).toContain('home:todo')
    }
    expect(states('done').every((row) => row.endsWith(':done'))).toBe(true)
  })

  it('fill in the add’s own four states as the add reports them', () => {
    const subStates = (step: AdoptionStep) =>
      adoptionRows({ step, provider: null })
        .find((row) => row.id === 'add')
        ?.subStages?.map((stage) => `${stage.label}:${stage.state}`)
    expect(subStates('approve')).toEqual(['Proving:todo', 'Covering the fee:todo', 'Sending:todo', 'Confirming:todo'])
    expect(subStates('prove')).toEqual(['Proving:active', 'Covering the fee:todo', 'Sending:todo', 'Confirming:todo'])
    expect(subStates('fee')).toEqual(['Proving:done', 'Covering the fee:active', 'Sending:todo', 'Confirming:todo'])
    expect(subStates('send')).toEqual(['Proving:done', 'Covering the fee:done', 'Sending:active', 'Confirming:todo'])
    expect(subStates('confirm')).toEqual(['Proving:done', 'Covering the fee:done', 'Sending:done', 'Confirming:active'])
    /* An add found already on the account is ticked whole, with no proof run. */
    expect(subStates('rotate')).toEqual(['Proving:done', 'Covering the fee:done', 'Sending:done', 'Confirming:done'])
    expect(subStates('done')).toEqual(['Proving:done', 'Covering the fee:done', 'Sending:done', 'Confirming:done'])
    /* Only the add has states of its own. */
    expect(
      adoptionRows({ step: 'prove', provider: null })
        .filter((row) => row.id !== 'add')
        .every((row) => row.subStages === null),
    ).toBe(true)
  })
})

describe('what the screen says', () => {
  it('holds the estimate the way back’s add uses, for the same add run the other way', () => {
    expect(ADOPTION_ADD_EXPECTED_SECONDS).toBe(RECOVERY_ADD_EXPECTED_SECONDS)
  })

  it('asks for Passport to be kept open, in plain words, and ticks the end for a beat', () => {
    expect(ADOPTION_KEEP_OPEN).toBe('Keep Passport open until this finishes.')
    expect(ADOPTION_DONE_BEAT_MS).toBeGreaterThan(0)
    expect(ADOPTION_DONE_BEAT_MS).toBeLessThanOrEqual(2_000)
  })

  it('never names what holds the Passport', () => {
    const everything = [
      ADOPTION_KEEP_OPEN,
      ...STEPS.flatMap((step) =>
        adoptionRows({ step, provider: 'Google' }).flatMap((row) => [
          row.label,
          ...(row.subStages ?? []).map((stage) => stage.label),
        ]),
      ),
    ]
      .join(' ')
      .toLowerCase()
    for (const banned of ['wallet address', 'dust', 'contract', 'registry', 'indexer', 'resolver', 'sponsor', 'sdk', 'dynamic']) {
      expect(everything).not.toContain(banned)
    }
  })
})
