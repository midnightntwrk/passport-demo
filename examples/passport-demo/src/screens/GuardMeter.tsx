import { Check, FileKey2, Fingerprint, KeySquare } from 'lucide-react'

import './guard-meter.css'

/**
 * The guard meter — the mandatory-recovery gate, gamified.
 *
 * The card's chip says WHETHER the Passport is guarded; this says HOW FAR,
 * as three levels a person can climb, because "make a backup" nags better as
 * a ladder with a rung visibly missing than as a warning label. Every level
 * is honest about what it is:
 *
 *   1. THE PASSKEY — always lit by the time this renders: no session exists
 *      without one.
 *   2. THE BACKUP — the level that flips GUARDED today (see the guarded flag
 *      in App.tsx). Carries the one action this meter offers.
 *   3. THE SECOND KEY — the level that does not exist yet. It is a row, not
 *      a control: a button for an escape the build does not offer teaches
 *      the reader that this app's words are approximate (the welcome
 *      screen's rule, and it holds here). It says plainly that it is next.
 *      P3 (add-device, the MetaMask-derived recovery key) makes it real.
 *
 * Rendered on the Passport page under the card's acts, and inside the guard
 * step of onboarding (GuardStep.tsx) — same component, so the ladder a new
 * Passport is shown is exactly the ladder Home keeps nagging with.
 */

export interface GuardMeterProps {
  /** Level 2 — a backup exists (exported or restored from). */
  guarded: boolean
  /**
   * Opens the backup surface. Omit it and level 2 renders without a control
   * — the guard step does this, because its own primary action is the same
   * act and one screen should not offer it twice.
   */
  onGuard?: (() => void) | undefined
}

export default function GuardMeter(props: GuardMeterProps) {
  const { guarded, onGuard } = props
  const level = guarded ? 2 : 1

  return (
    <section
      className={`mnguard${guarded ? ' mnguard-ok' : ''}`}
      aria-label={`Guard level ${level} of 3`}
    >
      <header className="mnguard-head">
        <span className="mnguard-title">Guard level</span>
        <span className="mnguard-count">{level} of 3</span>
      </header>
      {/* The bar is decorative — the count above says the same thing. */}
      <div className="mnguard-bar" aria-hidden="true">
        <span className="mnguard-seg mnguard-seg-on" />
        <span className={`mnguard-seg${guarded ? ' mnguard-seg-on' : ''}`} />
        <span className="mnguard-seg" />
      </div>

      <ol className="mnguard-rungs">
        <li className="mnguard-rung mnguard-rung-done">
          <span className="mnguard-rung-mark" aria-hidden="true">
            <Check size={14} strokeWidth={2.6} />
          </span>
          <span className="mnguard-rung-text">
            <b>
              <Fingerprint size={13} aria-hidden="true" /> A passkey holds it
            </b>
            <span>This device signs for everything your Passport does.</span>
          </span>
        </li>

        <li className={`mnguard-rung${guarded ? ' mnguard-rung-done' : ' mnguard-rung-now'}`}>
          <span className="mnguard-rung-mark" aria-hidden="true">
            {guarded ? <Check size={14} strokeWidth={2.6} /> : <span className="mnguard-dot" />}
          </span>
          <span className="mnguard-rung-text">
            <b>
              <FileKey2 size={13} aria-hidden="true" /> A backup can revive it
            </b>
            <span>One encrypted file, one password, kept anywhere safe.</span>
          </span>
          {!guarded && onGuard ? (
            <button type="button" className="mnguard-cta" onClick={onGuard}>
              Keep a backup
            </button>
          ) : null}
        </li>

        {/* NOT A CONTROL — see the header comment. */}
        <li className="mnguard-rung mnguard-rung-next">
          <span className="mnguard-rung-mark" aria-hidden="true">
            <span className="mnguard-dot" />
          </span>
          <span className="mnguard-rung-text">
            <b>
              <KeySquare size={13} aria-hidden="true" /> A second key can rescue it
              <span className="mnguard-next-tag">Next</span>
            </b>
            <span>Another device or an external key that can let you back in. Not here yet — it arrives with recovery keys.</span>
          </span>
        </li>
      </ol>

      <p className="mnguard-foot">
        {guarded
          ? 'Guarded. Next: a second key, so no single device is special.'
          : 'Not valid until guarded — one device, no spares.'}
      </p>
    </section>
  )
}
