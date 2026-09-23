/**
 * THE JOURNEY, PAINTED ONCE — circle, line, circle, and a clock on the row
 * that is running.
 *
 * WHY IT IS ITS OWN FILE (2026/09/22)
 * -----------------------------------
 * This markup lived inside `AliasClaim.tsx`, which is the old name step. The
 * name-first setup on the account custody contract needed the same thing —
 * "I like how we showed the full TX journey here … this part same way with the
 * game is critical" — and there were two ways to give it one: copy the JSX, or
 * lift it. A copy would have been two steppers to keep in step, two places to
 * fix a wrap on a 360 px phone, and — the failure that actually happens — one
 * of them quietly acquiring a behaviour the other never got.
 *
 * So it is lifted, whole and unchanged: the same classes, the same
 * `data-state` attributes, the same marks always in the DOM so a row fills in
 * rather than changing shape, and the same timing lines built by
 * `../lib/claimSteps.ts`. Every assertion `e2e/claim-progress.spec.ts` makes
 * about the old road is an assertion about this file now.
 *
 * IT HOLDS NO RULES. Which row is running, which state the long row is in, and
 * what the rows are called are decided by `../lib/claimSteps.ts` for the old
 * road and `../lib/custodySetupProgress.ts` for the new one. What lives here is
 * the painting and the measuring — and the measuring is here rather than in
 * either screen because a clock that is written twice is a clock that resets on
 * one of the two roads.
 */

import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'

import { formatElapsed, stepTimingLine, type ClaimStepState } from '../lib/claimSteps.js'
import './identity.css'

/** One of the filling rows beneath a long step. */
export interface TimelineSubStage {
  readonly id: string
  readonly label: string
  readonly state: ClaimStepState
}

/** One row of the timeline, with everything it is allowed to say. */
export interface TimelineRow {
  /** Stable identity, for React keys, for the clock, and for tests. */
  readonly id: string
  readonly label: string
  readonly state: ClaimStepState
  /** How long this row usually takes, or null for "as long as you take". */
  readonly expectedSeconds: number | null
  /** How long it HAS taken, measured, or null when there is nothing to say. */
  readonly elapsedMs: number | null
  /** The phase's own sentence beneath the label, for a row that is one thing. */
  readonly detail?: string | null
  /** A quiet line about what the row is held on — the fee wait, and no more. */
  readonly wait?: string | null
  /** The states a long row is made of, on screen from the first frame. */
  readonly subStages?: readonly TimelineSubStage[] | null
  /** The warning about the minutes, said up front rather than mid-wait. */
  readonly note?: string | null
}

/**
 * What a row says about time.
 *
 * A running row says what it usually costs and what it has cost so far; a
 * finished one says what it took, measured rather than estimated. A row that
 * finished inside a second says nothing at all: "Took 0:00" is a number about
 * nothing, and a ticked row is already the whole of what happened.
 */
function timingLine(row: TimelineRow): string | null {
  if (row.elapsedMs === null) return null
  if (row.state === 'active') return stepTimingLine(row, row.elapsedMs)
  return row.elapsedMs >= 1_000 ? `Took ${formatElapsed(row.elapsedMs)}` : null
}

/** The panel, as both roads paint it. */
export default function ProgressTimeline({ rows }: { rows: readonly TimelineRow[] }) {
  return (
    <div className="mnid-panel" role="status" aria-live="polite">
      <ol className="mnid-stepper">
        {rows.map((row) => {
          const timing = timingLine(row)
          return (
            <li key={row.id} className="mnid-stepper-item" data-state={row.state}>
              {/* Both marks are always in the DOM and the state chooses which
                  is painted, so a row never changes shape as it completes — it
                  only fills in. */}
              <span className="mnid-stepper-mark" aria-hidden="true">
                <span className="mnid-stepper-dot" />
                <Check className="mnid-stepper-check" size={13} strokeWidth={3} />
              </span>
              <span className="mnid-stepper-text">
                <span className="mnid-stepper-label">{row.label}</span>
                {/* A sentence identical to its own label is dropped rather than
                    printed twice, which is what the passkey row used to do. */}
                {row.detail != null && row.detail !== row.label ? (
                  <span className="mnid-stepper-detail">{row.detail}</span>
                ) : null}
                {/* THE TIMER. `aria-live="off"` because the panel around it is
                    polite and a value that changes every second would otherwise
                    be read aloud every second — the number is for the eye, and
                    the row changes it sits between are what a screen reader is
                    told. */}
                {timing !== null ? (
                  <span className="mnid-stepper-timing" aria-live="off">
                    {timing}
                  </span>
                ) : null}
                {row.wait != null && row.state === 'active' ? (
                  <span className="mnid-stepper-note mnid-stepper-wait" aria-live="off">
                    {row.wait}
                  </span>
                ) : null}
                {row.subStages != null ? (
                  <ol className="mnid-substages">
                    {row.subStages.map((stage) => (
                      <li key={stage.id} className="mnid-substage" data-state={stage.state}>
                        <span className="mnid-substage-pip" aria-hidden="true" />
                        <span className="mnid-substage-label">{stage.label}</span>
                      </li>
                    ))}
                  </ol>
                ) : null}
                {row.note != null ? <span className="mnid-stepper-note">{row.note}</span> : null}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Which row is being timed, when it started, and what the time is now.
 *
 * `now` is state rather than a read at render time because a row whose phase
 * does not change would otherwise never re-render, and a counter that stops
 * moving is exactly the hang this whole view exists to disprove. It ticks once
 * a second from an interval cleared when the row changes, when the work ends,
 * and when the screen unmounts.
 *
 * `done` keeps what each finished row actually cost, so a ticked row can say
 * so. It is measured, never estimated: a row that took eleven seconds against
 * an estimate of ten says eleven.
 */
interface TimelineClock {
  rowId: string
  startedAt: number
  now: number
  done: Record<string, number>
}

/**
 * Measures the row that is running, and remembers what the finished ones cost.
 *
 * Keyed on the RUNNING ROW, so the interval is cleared and restarted when the
 * row changes, cleared when the work ends or fails, and cleared on unmount —
 * and, crucially, NOT keyed on the underlying phase: the five phases of the
 * long row share one clock, so a phase that sits still for two minutes goes on
 * counting rather than looking stuck.
 *
 * Returns the reader a row wants: how long this one has been running, or what
 * it took, or null when there is nothing honest to say.
 */
export function useTimelineClock(
  activeRowId: string | null,
): (row: { id: string; state: ClaimStepState }) => number | null {
  const [clock, setClock] = useState<TimelineClock | null>(null)

  useEffect(() => {
    if (activeRowId === null) {
      // The work ended, one way or the other. The next run starts from zero.
      setClock(null)
      return undefined
    }
    const at = Date.now()
    setClock((previous) => {
      if (previous === null) return { rowId: activeRowId, startedAt: at, now: at, done: {} }
      // An unchanged row keeps its start time, so the count never resets.
      if (previous.rowId === activeRowId) return previous
      return {
        rowId: activeRowId,
        startedAt: at,
        now: at,
        done: { ...previous.done, [previous.rowId]: at - previous.startedAt },
      }
    })
    const timer = window.setInterval(() => {
      setClock((previous) => (previous === null ? previous : { ...previous, now: Date.now() }))
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [activeRowId])

  return (row) => {
    if (clock === null) return null
    if (row.state === 'active') {
      return clock.rowId === row.id ? clock.now - clock.startedAt : null
    }
    return clock.done[row.id] ?? null
  }
}
