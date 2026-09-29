import { Download, Share, SquarePlus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  INSTALL_CARD_LINE,
  INSTALL_HINT_STEPS,
  INSTALL_LABEL,
  INSTALL_NOT_NOW,
  INSTALL_SHOW_HOW,
} from '../lib/installPrompt.js'
import { INSTALL_LEDE_IOS, promptInstall, useInstallOffer } from '../pwa.js'
import { CompanionFace, useCompanionMotion } from './Companion.js'
import '../pwa-install.css'
import './install-offer.css'

/**
 * "INSTALL PASSPORT", SAID SO SOMEBODY SEES IT (2026/09/28).
 *
 * The review of that day: the install control was a 34 px glyph in Home's top
 * bar, the only invitation a phone ever got was a sheet four seconds in that
 * any dismissal retired for ever, and the reviewer could not tell how to
 * install Passport — "make it prominent, like Coinbase". Three things live
 * here, and every rule they follow is `../lib/installPrompt.ts`'s, where it is
 * drilled:
 *
 *   {@link InstallCard}     a card on Home, on a phone that has not installed
 *                           Passport: the Companion, "Install Passport", one
 *                           line, and one button. "Not now" puts it away for a
 *                           week, not for good.
 *   {@link LandingInstall}  the same offer as a quiet secondary action under
 *                           Sign up and Log in, for a phone with no Passport.
 *   {@link InstallSteps}    the iPhone's two taps, illustrated. iOS Safari
 *                           fires no install event and never will, so the
 *                           button there shows the steps rather than pretending
 *                           to perform them — and says, as the old sheet did,
 *                           that the installed app asks for the passkey once.
 *
 * On Android and every Chromium, the button replays the browser's own dialogue
 * (`promptInstall`), and the card goes the moment Passport is installed.
 */

/** Opens the browser's dialogue where there is one, and the steps where there is not. */
function useInstallPress(): { press: () => void; stepsOpen: boolean; closeSteps: () => void } {
  const offer = useInstallOffer()
  const [stepsOpen, setStepsOpen] = useState(false)
  return {
    press: () => {
      if (offer.affordance === 'hint') setStepsOpen(true)
      else void promptInstall()
    },
    stepsOpen,
    closeSteps: () => setStepsOpen(false),
  }
}

/**
 * The card on Home. Renders nothing unless the rule says to — installed, a
 * desktop, a browser that cannot install, or a "not now" inside the week.
 *
 * NO LAYOUT SHIFT FROM THE FACE: the Companion sits in a box of its own size
 * from the first frame, and the chat bubble stands in until it has loaded.
 */
export function InstallCard() {
  const offer = useInstallOffer()
  if (!offer.cardVisible) return null
  return <InstallCardBody hint={offer.affordance === 'hint'} onNotNow={offer.snooze} />
}

/* The card itself, mounted only while it shows, so the Companion's motion runs
   for a card somebody can see and for nothing else. */
function InstallCardBody({ hint, onNotNow }: { hint: boolean; onNotNow: () => void }) {
  const { press, stepsOpen, closeSteps } = useInstallPress()
  const { moving, wake } = useCompanionMotion()
  return (
    <section
      className="mninstall-card"
      aria-labelledby="mninstall-card-title"
      data-testid="install-card"
      onPointerDown={wake}
    >
      <span className="mninstall-card-face" aria-hidden="true">
        <CompanionFace size={48} active={false} moving={moving} fallbackSize={22} />
      </span>
      <div className="mninstall-card-copy">
        <h2 id="mninstall-card-title" className="mninstall-card-title">
          {INSTALL_LABEL}
        </h2>
        <p className="mninstall-card-line">{INSTALL_CARD_LINE}</p>
      </div>
      <button
        type="button"
        className="mninstall-card-close"
        onClick={onNotNow}
        aria-label={INSTALL_NOT_NOW}
        title={INSTALL_NOT_NOW}
      >
        <X size={16} aria-hidden="true" />
      </button>
      <button type="button" className="mninstall-card-primary" onClick={press}>
        {hint ? <Share size={17} aria-hidden="true" /> : <Download size={17} aria-hidden="true" />}
        <span>{hint ? INSTALL_SHOW_HOW : 'Install'}</span>
      </button>
      {stepsOpen ? <InstallSteps onClose={closeSteps} /> : null}
    </section>
  )
}

/**
 * The landing's secondary action, under Sign up and Log in, for a phone that
 * can install Passport and holds no Passport yet. It is a control, not an
 * invitation, so a "not now" on Home does not hide it.
 */
export function LandingInstall({ hasExistingPassport }: { hasExistingPassport: boolean | null }) {
  const offer = useInstallOffer()
  const { press, stepsOpen, closeSteps } = useInstallPress()
  if (!offer.mobile || offer.affordance === 'hidden' || hasExistingPassport === true) return null
  return (
    <>
      <button type="button" className="mninstall-landing" onClick={press} data-testid="landing-install">
        <Download size={16} aria-hidden="true" />
        <span>{INSTALL_LABEL}</span>
      </button>
      {stepsOpen ? <InstallSteps onClose={closeSteps} /> : null}
    </>
  )
}

/**
 * The iPhone's two taps, as a sheet from the bottom of the screen: what
 * installing gives, what the installed app will ask once, and the two steps
 * with the icons Safari's own toolbar and menu show.
 */
export function InstallSteps({ onClose }: { onClose: () => void }) {
  const done = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    done.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <>
      <div className="pwainstall-scrim" role="presentation" onClick={onClose} />
      <section
        className="pwainstall-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pwainstall-title"
        data-testid="install-steps"
      >
        <span className="pwainstall-grip" aria-hidden="true" />
        <header className="pwainstall-head">
          <span className="pwainstall-mark" aria-hidden="true">
            <SquarePlus size={20} strokeWidth={2} />
          </span>
          <div>
            <h2 id="pwainstall-title">Add Passport to your home screen</h2>
            {/* The honest note, kept from the sheet this replaces: an
                installed web app on iOS has storage of its own, so the passkey
                follows through iCloud Keychain and is asked for once. */}
            <p>{INSTALL_LEDE_IOS}</p>
          </div>
        </header>
        <ol className="pwainstall-steps mninstall-steps">
          <li>
            <span className="mninstall-step-number" aria-hidden="true">
              1
            </span>
            <span className="mninstall-step-glyph" aria-hidden="true">
              <Share size={18} strokeWidth={2} />
            </span>
            <span>{INSTALL_HINT_STEPS[0]}</span>
          </li>
          <li>
            <span className="mninstall-step-number" aria-hidden="true">
              2
            </span>
            <span className="mninstall-step-glyph" aria-hidden="true">
              <SquarePlus size={18} strokeWidth={2} />
            </span>
            <span>{INSTALL_HINT_STEPS[1]}</span>
          </li>
        </ol>
        <div className="pwainstall-actions">
          <button type="button" className="pwainstall-primary" onClick={onClose} ref={done}>
            Done
          </button>
        </div>
      </section>
    </>,
    document.body,
  )
}
