/**
 * WHEN A STEP IS PICKED BACK UP BY ITSELF (2026/09/27), drilled against the
 * live case — a proof whose answer never reached a frozen tab — and against
 * every way the rule must say no.
 */

import { describe, expect, it } from 'vitest'

import { ADOPTION_RESUME_ATTEMPTS, adoptionResumable, connectionLost } from './adoptionResume.js'
import {
  CUSTODY_KEY_NOT_ADDED,
  CUSTODY_KEY_UNCONFIRMED,
  CUSTODY_PROVER_UNAVAILABLE,
  CUSTODY_SEND_NOT_SENT,
  CUSTODY_SEND_UNCONFIRMED,
} from '../identity/custodyContractPlan.js'

function named(name: string, message = 'stopped'): Error {
  return Object.assign(new Error(message), { name })
}

describe('whether an error is the connection going', () => {
  it('is, for a fetch that failed, in each engine’s words', () => {
    expect(connectionLost(new TypeError('Failed to fetch'))).toBe(true)
    expect(connectionLost(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true)
    expect(connectionLost(new TypeError('Load failed'))).toBe(true)
  })

  it('is, for an abort, a timeout, or a network error by name', () => {
    expect(connectionLost(named('AbortError'))).toBe(true)
    expect(connectionLost(named('TimeoutError'))).toBe(true)
    expect(connectionLost(named('NetworkError'))).toBe(true)
  })

  it('is, for the sentences the custody client puts a dropped connection into', () => {
    for (const sentence of [
      CUSTODY_PROVER_UNAVAILABLE,
      CUSTODY_KEY_NOT_ADDED,
      CUSTODY_KEY_UNCONFIRMED,
      CUSTODY_SEND_NOT_SENT,
      CUSTODY_SEND_UNCONFIRMED,
    ]) {
      expect(connectionLost(new Error(` ${sentence} `))).toBe(true)
    }
  })

  it('is, when the connection going is further down the chain of causes', () => {
    const wrapped = new Error('the step stopped', { cause: new TypeError('Failed to fetch') })
    expect(connectionLost(new Error('outer', { cause: wrapped }))).toBe(true)
  })

  it('is not, for something saying no, for a type error that is not a fetch, or for a non-error', () => {
    expect(connectionLost(new Error('This is not the account that found your Passport.'))).toBe(false)
    expect(connectionLost(named('NotAllowedError'))).toBe(false)
    expect(connectionLost(new TypeError('x is not a function'))).toBe(false)
    expect(connectionLost('Failed to fetch')).toBe(false)
    expect(connectionLost(null)).toBe(false)
  })

  it('stops reading down a chain of causes that goes on for ever', () => {
    const loop = new Error('loop') as Error & { cause?: unknown }
    loop.cause = loop
    expect(connectionLost(loop)).toBe(false)
  })
})

describe('whether a step is picked back up by itself', () => {
  const dropped = new TypeError('Failed to fetch')

  it('is, for the live case: the connection went while the page was away', () => {
    expect(adoptionResumable({ cause: dropped, dropped: true, resumed: 0 })).toBe(true)
  })

  it('is not, while somebody was watching: that "Try again" is theirs to press', () => {
    expect(adoptionResumable({ cause: dropped, dropped: false, resumed: 0 })).toBe(false)
  })

  it('is not, for a failure that is not the connection', () => {
    expect(adoptionResumable({ cause: named('NotAllowedError'), dropped: true, resumed: 0 })).toBe(false)
  })

  it('is not, once it has been picked up the most times it may be', () => {
    expect(
      adoptionResumable({ cause: dropped, dropped: true, resumed: ADOPTION_RESUME_ATTEMPTS - 1 }),
    ).toBe(true)
    expect(adoptionResumable({ cause: dropped, dropped: true, resumed: ADOPTION_RESUME_ATTEMPTS })).toBe(false)
  })
})
