import { useId } from 'react'
import { ArrowRight, BadgeCheck, LoaderCircle, Orbit } from 'lucide-react'

import { useDynamicSession } from '../lib/dynamic.js'

/**
 * Keep the secondary sign-in route visible while Dynamic starts or is
 * unavailable. Only a ready session can open the vendor's authentication
 * flow; the SDK remains lazily loaded by the existing integration.
 */
export default function ContinueWithSocial() {
  const session = useDynamicSession()
  const statusId = useId()

  if (session.status === 'signed-in') {
    const who = session.handle ?? 'your account'
    const via = session.provider ? ` with ${session.provider}` : ''
    return (
      <p className="mnob-social-note" role="status">
        <BadgeCheck size={13} aria-hidden="true" />
        {/* "Finish with your passkey above" until 2026/09/16, and it was true
            then: a sign-in proved who somebody was and produced no key this
            Passport could be held by, so the passkey button was still the way
            forward and the sentence had to say so.
            It is not true now. A signed-in person with no passkey profile is
            taken to their own Passport by `App.tsx`'s first branch — the
            account is set up for the sign-in and the signed-in key is what
            approves for it. This component only renders at all when that
            branch did NOT fire, which is exactly one case: a passkey profile
            already exists on this device. So the sentence says the thing that
            is true of that case, and points at nothing. */}
        Signed in{via} as {who}.
      </p>
    )
  }

  const loading = session.status === 'loading'
  const ready = session.status === 'signed-out'
  const status = loading
    ? 'Getting Dynamic sign-in ready…'
    : session.status === 'disabled'
      ? 'Dynamic sign-in is currently unavailable. You can continue with a passkey.'
      : null

  return (
    <>
      <div className="mnob-or" aria-hidden="true">
        <span />
        <small>or</small>
        <span />
      </div>
      <button
        type="button"
        className="mnob-social"
        onClick={session.openAuthFlow}
        disabled={!ready}
        aria-busy={loading}
        aria-label="Continue with Dynamic"
        aria-describedby={status ? statusId : undefined}
      >
        <span className="mnob-method-icon" aria-hidden="true">
          <Orbit size={22} strokeWidth={1.7} />
        </span>
        <span className="mnob-social-copy mnob-method-copy">
          <span>Continue with Dynamic</span>
          <small aria-hidden="true">Connect with your account</small>
        </span>
        {loading ? (
          <LoaderCircle size={18} className="mnob-social-spin" aria-hidden="true" />
        ) : (
          <ArrowRight size={17} strokeWidth={2.2} aria-hidden="true" />
        )}
      </button>
      {status ? (
        <p id={statusId} className="mnob-social-note" role="status">{status}</p>
      ) : null}
    </>
  )
}
