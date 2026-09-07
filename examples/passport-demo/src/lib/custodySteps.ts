/**
 * The account-custody write, as a set of labelled steps a person can watch —
 * the twin of `./claimSteps.ts`, for every gated circuit rather than the
 * claim.
 *
 * WHY THIS EXISTS. The claim grew a stepper with estimates and an elapsed
 * clock on 2026/08/31, because a wait with no measure against it is
 * indistinguishable from a hang after about twenty seconds. Enrolling a
 * recovery key, admitting a device, and recovering with one are the SAME
 * shape of wait — a gated `add_device`, minutes of proving — and until now
 * they showed one flat "this can take a minute" line. Reported 2026/09/07:
 * "adding the metamask wallet... we don't see the same process step by step
 * with estimated time." So the custody call's own phases become steps here,
 * measured the same way, said in the same voice.
 *
 * The phases are `AccountCustodyProgress`'s own — `checking`, `connecting`,
 * `submitting`, `confirming` — one step each, in the order the call reports
 * them. The estimates are measurements of the live walk, not targets, which
 * is why the copy says "usually about" (via {@link stepTimingLine}) and the
 * clock keeps counting past them instead of stalling at done.
 */

import type { AccountCustodyProgress } from '../identity/accountCustody.js';
import type { ClaimStepState } from './claimSteps.js';

export type CustodyPhase = AccountCustodyProgress['phase'];

export interface CustodyStep {
  /** The phase this step IS — stable identity, React key, and the clock's key. */
  id: CustodyPhase;
  /** What the row says. Sentence case, no ellipsis — a step, not a status. */
  label: string;
  state: ClaimStepState;
  /**
   * The step's usual cost in seconds, a live-walk measurement rather than a
   * target. `checking` can now wait a busy sponsor out (up to two minutes —
   * see `sponsorReadinessSettled`), so its estimate is deliberately modest
   * and the timing line's "taking a little longer than usual" carries the
   * rest; `submitting` is the proving, which is the minutes this whole wait
   * is really about.
   */
  expectedSeconds: number;
}

/** The four steps, in order. Exported so a screen cannot invent a fifth. */
export const CUSTODY_STEPS: readonly Omit<CustodyStep, 'state'>[] = [
  { id: 'checking', label: 'Making sure fees are covered', expectedSeconds: 10 },
  { id: 'connecting', label: 'Connecting to your account', expectedSeconds: 15 },
  { id: 'submitting', label: 'Proving and submitting', expectedSeconds: 90 },
  { id: 'confirming', label: 'Confirming on the ledger', expectedSeconds: 20 },
];

const STEP_INDEX: Record<CustodyPhase, 0 | 1 | 2 | 3> = {
  checking: 0,
  connecting: 1,
  submitting: 2,
  confirming: 3,
};

/**
 * The four steps with the state each is in for `phase`, or `null` for a call
 * that is not running.
 *
 * `null` in, `null` out — no phase means no wait to show. Everything before
 * the running step is done, everything after it is still ahead; a step is
 * never skipped and never goes backwards, because the call reports its phases
 * in the order they are declared here.
 */
export function custodySteps(phase: CustodyPhase | null): CustodyStep[] | null {
  if (phase === null) return null;
  const active = STEP_INDEX[phase];
  return CUSTODY_STEPS.map((step, index) => ({
    ...step,
    state: index < active ? 'done' : index === active ? 'active' : 'todo',
  }));
}
