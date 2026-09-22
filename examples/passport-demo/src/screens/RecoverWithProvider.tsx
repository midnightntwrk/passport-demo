import { ArrowRight, Loader2, ShieldCheck } from 'lucide-react'

import BrandMarks from './BrandMarks.js'
import ThemeToggle from './ThemeToggle.js'
import { RECOVERY_COPY, providerRecoveryStage } from '../lib/recoveryStep.js'

/**
 * THE ONLY PLACE A PROVIDER SIGN-IN IS OFFERED (2026/09/22).
 *
 * It used to be on the landing, under "Continue with Passkey", where it read as
 * a second way to START — and a sign-in cannot start a Passport: it produces a
 * key that proves who somebody is and nothing that a new Passport would be held
 * by. The product owner's drawing removes it from the landing and puts it
 * HERE, behind "I already have a Passport", which is the one question it can
 * actually answer.
 *
 * WHAT COMES AFTER IT, so the sentence on this screen is not a promise this
 * flow cannot keep: signing in does not open anything by itself. The next
 * screen asks for the `.night` name, Passport checks with Midnight that this
 * sign-in is one of that Passport's own devices, and only then is a key made on
 * this device and added. See `./CustodyPassport.tsx`'s way-back road and
 * `../identity/custodyAdopt.ts`.
 *
 * It renders on a device with NO Passport and no key of its own, which is why
 * it is its own screen rather than a panel inside one: there is no arm to hold
 * the custody screen up yet, and there will not be until the sign-in lands.
 */
export default function RecoverWithProvider(props: {
  /** The sign-in's own status: `disabled`, `loading`, `signed-out`, … */
  status: string
  /** Opens the provider's overlay. */
  onSignIn: () => void
  /** Back to the landing. */
  onBack: () => void
}) {
  const stage = providerRecoveryStage({ status: props.status, hasAddress: false })
  const loading = props.status === 'loading'
  return (
    <section className="mnob-screen">
      <header className="mnob-bar">
        <img className="mnob-wordmark" src="/midnight-wordmark.svg" alt="Midnight" />
        <span className="mnob-bar-label">Passport</span>
        <ThemeToggle size="sm" className="mnob-theme" />
      </header>

      <div className="mnob-body">
        <p className="mnob-kicker">{RECOVERY_COPY.recoverEntry}</p>
        <h1 className="mnob-title">
          <span>Open your</span>
          <span>Passport here</span>
        </h1>
        <p className="mnob-lede">{RECOVERY_COPY.recoverLede}</p>

        <div className="mnob-stage">
          {/* A build with no sign-in behind it cannot walk this road, and says
              so plainly rather than offering a control that does nothing. The
              landing does not show the entry to this screen in that case
              either — this is the second belt, for a link held from before. */}
          {stage === 'unavailable' ? (
            <div className="mnob-unusable" role="alert">
              <p className="mnob-unusable-copy">{RECOVERY_COPY.unavailable}</p>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="mnob-primary"
                onClick={props.onSignIn}
                disabled={loading}
                data-testid="recover-sign-in"
              >
                <span className="mnob-primary-copy">
                  {loading ? (
                    <Loader2
                      className="mnob-working-spinner"
                      size={17}
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                  ) : (
                    <BrandMarks />
                  )}
                  {loading ? RECOVERY_COPY.loading : RECOVERY_COPY.recoverAction}
                </span>
                <ArrowRight size={17} strokeWidth={2.2} aria-hidden="true" />
              </button>
              <p className="mnob-hint">
                <ShieldCheck size={14} strokeWidth={2} aria-hidden="true" /> Passport asks for your
                name next, and checks it with Midnight before bringing anything back.
              </p>
            </>
          )}
          <button type="button" className="mnob-alt" onClick={props.onBack}>
            {RECOVERY_COPY.recoverBack}
          </button>
        </div>
      </div>

      <footer className="mnob-foot">
        <span>Test network demo — not production</span>
      </footer>
    </section>
  )
}
