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
 *   2. THE BACKUP — the encrypted file. The first thing that flips the card
 *      to GUARDED.
 *   3. THE SECOND KEY — real since P3, and satisfied two ways: a
 *      MetaMask-derived recovery key (`identity/recoveryKey.ts`), or a
 *      second DEVICE holding its own passkey, admitted through the join
 *      code (`identity/secondDevice.ts`). Both are devices on the account
 *      contract itself, able to let their holder back in with this device
 *      gone. The rung carries an action ONLY when the host can open the
 *      keys surface; without one it is a row that says what it is, never a
 *      control for an act the build cannot perform.
 *
 * Rendered on the Passport page under the card's acts, and inside the guard
 * step of onboarding (GuardStep.tsx) — same component, so the ladder a new
 * Passport is shown is exactly the ladder Home keeps nagging with.
 */

export interface GuardMeterProps {
  /** Level 2 — a backup exists (exported or restored from). */
  backup: boolean
  /** Level 3 — a second key is on the account: a recovery key, or another device. */
  secondKey: boolean
  /**
   * Opens the backup surface. Omit it and level 2 renders without a control
   * — the guard step does this, because its own primary action is the same
   * act and one screen should not offer it twice.
   */
  onGuard?: (() => void) | undefined
  /** Opens the keys surface, where a second key is added — either kind. */
  onSecondKey?: (() => void) | undefined
}

export default function GuardMeter(props: GuardMeterProps) {
  const { backup, secondKey, onGuard, onSecondKey } = props
  const level = 1 + (backup ? 1 : 0) + (secondKey ? 1 : 0)
  const guarded = backup || secondKey

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
        <span className={`mnguard-seg${backup ? ' mnguard-seg-on' : ''}`} />
        <span className={`mnguard-seg${secondKey ? ' mnguard-seg-on' : ''}`} />
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

        <li className={`mnguard-rung${backup ? ' mnguard-rung-done' : ' mnguard-rung-now'}`}>
          <span className="mnguard-rung-mark" aria-hidden="true">
            {backup ? <Check size={14} strokeWidth={2.6} /> : <span className="mnguard-dot" />}
          </span>
          <span className="mnguard-rung-text">
            <b>
              <FileKey2 size={13} aria-hidden="true" /> A backup can revive it
            </b>
            <span>One encrypted file, one password, kept anywhere safe.</span>
          </span>
          {!backup && onGuard ? (
            <button type="button" className="mnguard-cta" onClick={onGuard}>
              Keep a backup
            </button>
          ) : null}
        </li>

        <li
          className={`mnguard-rung${
            secondKey ? ' mnguard-rung-done' : backup ? ' mnguard-rung-now' : ' mnguard-rung-next'
          }`}
        >
          <span className="mnguard-rung-mark" aria-hidden="true">
            {secondKey ? (
              <Check size={14} strokeWidth={2.6} />
            ) : (
              <span className="mnguard-dot" />
            )}
          </span>
          <span className="mnguard-rung-text">
            <b>
              <KeySquare size={13} aria-hidden="true" /> A second key can rescue it
            </b>
            <span>
              {secondKey
                ? 'A key that is not this device can open this Passport, with this one gone.'
                : 'A wallet-derived recovery key, or a second device with its own passkey.'}
            </span>
          </span>
          {!secondKey && onSecondKey ? (
            <button type="button" className="mnguard-cta" onClick={onSecondKey}>
              Add one
            </button>
          ) : null}
        </li>
      </ol>

      <p className="mnguard-foot">
        {level === 3
          ? 'Fully guarded — a lost device is an errand, not a catastrophe.'
          : guarded
            ? 'Guarded. Next: a second key, so no single device is special.'
            : 'Not valid until guarded — one device, no spares.'}
      </p>
    </section>
  )
}
