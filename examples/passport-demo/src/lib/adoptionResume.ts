/**
 * PICKING A STEP BACK UP AFTER ITS CONNECTION DROPPED, instead of ending in a
 * failure somebody has to press through (2026/09/27).
 *
 * THE LIVE CASE. A recovery's proof was made on the service in 43 seconds and
 * the phone never heard back: the person had put it down, the screen dimmed,
 * Android froze the tab, and the request in flight was dropped with "Failed to
 * fetch". The screen then said the device was not added and asked for "Try
 * again" — a press that would have worked, asked of somebody who had done
 * nothing wrong.
 *
 * The rule here says when a step may be run again WITHOUT that press: the page
 * went away while it ran (hidden, or offline), the failure is the connection
 * going and not something saying no, and it has not happened too often
 * already. The waiting for the page to come back, and the running again, are
 * `../identity/custodyAdopt.ts`'s; `./pagePresence.ts` is how it watches.
 *
 * APART FROM `./adoptionProgress.ts` because it needs the custody client's own
 * sentences, and that module is read on every render of `App.tsx`. This one
 * is only ever read from inside the second half, which is loaded on demand.
 *
 * NO DOM, NO CLOCK, NO NETWORK: drilled directly in `./adoptionResume.test.ts`.
 */

import {
  CUSTODY_KEY_NOT_ADDED,
  CUSTODY_KEY_UNCONFIRMED,
  CUSTODY_PROVER_UNAVAILABLE,
  CUSTODY_SEND_NOT_SENT,
  CUSTODY_SEND_UNCONFIRMED,
} from '../identity/custodyContractPlan.js'

/**
 * How many times one step is picked up again by itself before its failure is
 * shown. Each is only ever after the page has come back — visible and online —
 * so this bounds a connection that keeps dropping, not a wait.
 */
export const ADOPTION_RESUME_ATTEMPTS = 3

/**
 * The sentences a dropped connection arrives in once the custody client has
 * put it into words: the proving service not answering, and the add or the
 * payment either definitely not made or not seen to land. Every one of them is
 * a step that is safe to run again — nothing was applied, or the step reads the
 * account before it does anything — which is the only reason a step may be run
 * again without being asked.
 */
const DROPPED_SENTENCES: readonly string[] = [
  CUSTODY_PROVER_UNAVAILABLE,
  CUSTODY_KEY_NOT_ADDED,
  CUSTODY_KEY_UNCONFIRMED,
  CUSTODY_SEND_NOT_SENT,
  CUSTODY_SEND_UNCONFIRMED,
]

/** How far down a `cause` chain an error is read. */
const CAUSE_DEPTH = 4

/**
 * Whether an error is the connection going away rather than something saying
 * no: a `fetch` that failed (Chrome's "Failed to fetch", Firefox's
 * "NetworkError …", Safari's "Load failed"), an abort or a timeout, or one of
 * {@link DROPPED_SENTENCES}. Read down the `cause` chain, a few links deep.
 */
export function connectionLost(cause: unknown, depth = 0): boolean {
  if (!(cause instanceof Error) || depth > CAUSE_DEPTH) return false
  if (cause.name === 'AbortError' || cause.name === 'TimeoutError' || cause.name === 'NetworkError') {
    return true
  }
  if (cause instanceof TypeError && /fetch|network|load failed/i.test(cause.message)) return true
  if (DROPPED_SENTENCES.includes(cause.message.trim())) return true
  return connectionLost((cause as { cause?: unknown }).cause, depth + 1)
}

/**
 * Whether a step that failed is picked back up by itself, once the page is
 * visible and online again, rather than ending in its sentence.
 *
 * ONLY WHEN THE PAGE WENT AWAY WHILE IT RAN: hidden (a screen that dimmed, an
 * app switched away from, a tab Android froze) or offline. A step that failed
 * while somebody was watching is shown, with "Try again" — that press is theirs
 * to make. And only a {@link connectionLost} failure, a bounded number of
 * times.
 */
export function adoptionResumable(input: {
  readonly cause: unknown
  /** Whether the page was hidden or offline at any moment of the attempt. */
  readonly dropped: boolean
  /** How many times this step has already been picked up again. */
  readonly resumed: number
}): boolean {
  if (!input.dropped || input.resumed >= ADOPTION_RESUME_ATTEMPTS) return false
  return connectionLost(input.cause)
}
