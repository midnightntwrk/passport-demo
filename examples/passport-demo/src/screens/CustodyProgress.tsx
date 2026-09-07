import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'

import {
  custodySteps,
  type CustodyPhase,
  type CustodyStep,
} from '../lib/custodySteps.js'
import { formatElapsed, stepTimingLine } from '../lib/claimSteps.js'

/**
 * The account-custody write as a live stepper — the claim's progress UI, made
 * reusable for every gated `add_device` (recovery-key enrolment, admitting a
 * device, recovering with a recovery key).
 *
 * It renders the same `mnid-stepper` markup and CSS the claim screen owns, so
 * the two waits look and read identically, and it carries its OWN clock keyed
 * on the running step — cleared and restarted when the step changes, cleared
 * when the call ends (phase back to null) or the component unmounts. The clock
 * is deliberately NOT keyed on anything but the step id, so a phase that sits
 * still for a minute of proving keeps counting rather than looking hung, which
 * is the whole reason the claim grew this (2026/08/31).
 */

export interface CustodyProgressProps {
  /** The custody call's phase, or null when nothing is running. */
  phase: CustodyPhase | null
}

interface Clock {
  stepId: CustodyPhase
  startedAt: number
  now: number
  /** How long each finished step took, so a done row can say so. */
  done: Partial<Record<CustodyPhase, number>>
}

export default function CustodyProgress({ phase }: CustodyProgressProps) {
  const steps = custodySteps(phase)
  const activeStepId = steps?.find((step) => step.state === 'active')?.id ?? null

  const [clock, setClock] = useState<Clock | null>(null)
  useEffect(() => {
    if (activeStepId === null) {
      setClock(null)
      return undefined
    }
    const at = Date.now()
    setClock((previous) => {
      if (previous === null) return { stepId: activeStepId, startedAt: at, now: at, done: {} }
      if (previous.stepId === activeStepId) return previous
      return {
        stepId: activeStepId,
        startedAt: at,
        now: at,
        done: { ...previous.done, [previous.stepId]: at - previous.startedAt },
      }
    })
    const timer = window.setInterval(() => {
      setClock((previous) => (previous === null ? previous : { ...previous, now: Date.now() }))
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [activeStepId])

  if (steps === null) return null

  const elapsedFor = (step: CustodyStep): number | null => {
    if (clock === null) return null
    if (step.state === 'active') {
      return clock.stepId === step.id ? clock.now - clock.startedAt : null
    }
    return clock.done[step.id] ?? null
  }

  return (
    <div className="mnid-panel" role="status" aria-live="polite">
      <ol className="mnid-stepper">
        {steps.map((step) => {
          const elapsed = elapsedFor(step)
          /* A running step says what it usually costs and what it has cost so
             far; a finished one says what it took, measured. A step gone in
             under a second says nothing — "Took 0:00" is a number about
             nothing, and the ticked row already tells the story. */
          const timing =
            elapsed === null
              ? null
              : step.state === 'active'
                ? stepTimingLine(step, elapsed)
                : elapsed >= 1_000
                  ? `Took ${formatElapsed(elapsed)}`
                  : null
          return (
            <li key={step.id} className="mnid-stepper-item" data-state={step.state}>
              {/* Both marks are always in the DOM; the state chooses which is
                  painted, so a step never changes shape as it completes. */}
              <span className="mnid-stepper-mark" aria-hidden="true">
                <span className="mnid-stepper-dot" />
                <Check className="mnid-stepper-check" size={13} strokeWidth={3} />
              </span>
              <span className="mnid-stepper-text">
                <span className="mnid-stepper-label">{step.label}</span>
                {timing !== null ? (
                  <span className="mnid-stepper-timing" aria-live="off">
                    {timing}
                  </span>
                ) : null}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
