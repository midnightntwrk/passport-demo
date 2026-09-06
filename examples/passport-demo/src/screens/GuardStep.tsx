import { ShieldCheck } from 'lucide-react'

import GuardMeter from './GuardMeter.js'
import './identity.css'

/**
 * The guard step — the chapter of onboarding that comes AFTER the name.
 *
 * A claim that lands used to end the wizard outright: name, then dashboard.
 * But the Passport it lands is held by exactly one passkey on exactly one
 * device, and a Passport nobody can recover is one lost phone away from
 * gone — recovery belongs at creation, not in a settings page someone may
 * find later. So the wizard gained this screen: the guard ladder, the one
 * act that climbs it today (the encrypted backup file), and an honest way
 * to walk past.
 *
 * WHY THERE IS A SKIP, WHEN THE NAME STEP HAS NONE
 * -------------------------------------------------
 * The name step deploys the account — Home without it is not a state the
 * app may reach, so no control can offer it. Guarding is different in kind:
 * the account exists and works, the risk is real but the user's to take,
 * and the exit is labelled with the consequence ("it stays marked not
 * valid") rather than a soft "later" that pretends there is none. The nag
 * does not end here either way: the card wears NOT VALID UNTIL GUARDED, the
 * meter sits under it, and sign-in reminds — this screen is the START of
 * the nagging, not the whole of it.
 *
 * Shown once, in flow — it is not stored or re-raised, because the surfaces
 * above re-raise better than a repeated interstitial would.
 */

export interface GuardStepProps {
  /** The one act that climbs the ladder today: the backup surface. */
  onGuard: () => void
  /** Walk past, marked. The card and the meter carry on from here. */
  onLater: () => void
}

export default function GuardStep(props: GuardStepProps) {
  const { onGuard, onLater } = props

  return (
    <section className="mnid-screen">
      <header className="mnid-bar">
        <img className="mnid-wordmark" src="/skunk/mark.svg" alt="Midnight" />
        <span className="mnid-step">Guard</span>
      </header>

      <div className="mnid-body">
        <p className="mnid-kicker">One more thing</p>
        <h1 className="mnid-title">Not valid until guarded</h1>
        <p className="mnid-lede">
          Your name is yours and your account is live — but it is all held by one passkey on
          this one device. Lose the device and nothing can bring it back. Guarding fixes that,
          and it takes about a minute.
        </p>

        {/* The same ladder Home keeps. No inline actions — the primary below
            IS the second rung's action, and one screen does not offer the
            same act twice; the third rung's surface is a page away, after
            this step has been answered. */}
        <GuardMeter backup={false} secondKey={false} />

        <div className="mnid-actions" data-toast-clear>
          <button type="button" className="mnid-primary" onClick={onGuard}>
            <ShieldCheck size={17} aria-hidden="true" />
            Guard it now
          </button>
          {/* The exit carries its consequence. */}
          <button type="button" className="mnid-secondary" onClick={onLater}>
            Later — it stays marked not valid
          </button>
        </div>
      </div>
    </section>
  )
}
