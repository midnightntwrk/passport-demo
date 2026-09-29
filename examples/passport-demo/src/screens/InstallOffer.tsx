import { AppWindow, ChevronRight, Compass, Download, EllipsisVertical, Menu, MonitorDown, Share, SquarePlus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  INSTALL_CARD_LINE,
  INSTALL_GUIDES,
  INSTALL_HINT_STEPS,
  INSTALL_LABEL,
  INSTALL_NOT_NOW,
  INSTALL_SHOW_HOW,
  installLandingLine,
  isSafariBrowser,
  type InstallGuide,
  type InstallGuideStep,
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
function useInstallPress(): {
  press: () => void
  stepsOpen: boolean
  closeSteps: () => void
} {
  const offer = useInstallOffer()
  const [stepsOpen, setStepsOpen] = useState(false)
  return {
    press: () => {
      /* The browser's own dialogue when the page holds one; otherwise the
         steps for this browser, which is the most any page can do. */
      if (offer.affordance === 'prompt') void promptInstall()
      else setStepsOpen(true)
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
  const offer = useInstallOffer()
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
      {stepsOpen ? <InstallSteps guide={offer.guide} onClose={closeSteps} /> : null}
    </section>
  )
}

/**
 * The landing's install button, under Sign up and Log in (2026/09/29).
 *
 * ON EVERY BROWSER, unless Passport is installed already. It used to render
 * only on a phone that could install right then, so a desktop reviewer saw no
 * way to install at all. The press opens the browser's own dialogue where the
 * page holds one, and the steps for this browser where it does not — see
 * `INSTALL_GUIDES`. A control, not an invitation: a "not now" on Home does
 * not hide it, and neither does a Passport already on this device.
 */
export function LandingInstall(_props: { hasExistingPassport: boolean | null }) {
  const offer = useInstallOffer()
  const { press, stepsOpen, closeSteps } = useInstallPress()
  if (!offer.landingVisible) return null
  return (
    <>
      <button type="button" className="mninstall-landing" onClick={press} data-testid="landing-install">
        <span className="mninstall-landing-badge" aria-hidden="true">
          {offer.mobile ? <Download size={18} strokeWidth={2} /> : <MonitorDown size={18} strokeWidth={2} />}
        </span>
        <span className="mninstall-landing-copy">
          <span className="mninstall-landing-title">{INSTALL_LABEL}</span>
          <span className="mninstall-landing-line">{installLandingLine(offer.guide)}</span>
        </span>
        <ChevronRight className="mninstall-landing-chevron" size={18} aria-hidden="true" />
      </button>
      {stepsOpen ? <InstallSteps guide={offer.guide} onClose={closeSteps} /> : null}
    </>
  )
}

/** The glyph a step shows beside its words: the one the browser itself shows. */
function StepGlyph({ glyph }: { glyph: InstallGuideStep['glyph'] }) {
  const props = { size: 18, strokeWidth: 2 } as const
  if (glyph === 'share') return <Share {...props} />
  if (glyph === 'add') return <SquarePlus {...props} />
  if (glyph === 'menu') return /Macintosh/.test(navigator.userAgent) && isSafariBrowser(navigator.userAgent) ? <Menu {...props} /> : <EllipsisVertical {...props} />
  if (glyph === 'dock') return <AppWindow {...props} />
  if (glyph === 'browser') return <Compass {...props} />
  return <Download {...props} />
}

/**
 * The steps that install Passport in this browser, as a sheet from the bottom
 * of the screen: what installing gives and the two steps, with the glyphs the
 * browser itself shows. On iOS it also says what the installed app will ask
 * once, and Safari's steps name Safari's toolbar.
 */
export function InstallSteps({ guide = 'ios', onClose }: { guide?: InstallGuide; onClose: () => void }) {
  const copy = INSTALL_GUIDES[guide]
  const iosSafari = guide === 'ios' && isSafariBrowser(navigator.userAgent)
  const steps: readonly InstallGuideStep[] = iosSafari
    ? [
        { glyph: 'share', text: INSTALL_HINT_STEPS[0] ?? copy.steps[0]?.text ?? '' },
        { glyph: 'add', text: INSTALL_HINT_STEPS[1] ?? copy.steps[1]?.text ?? '' },
      ]
    : copy.steps
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
            <h2 id="pwainstall-title">{copy.title}</h2>
            {/* The honest note on iOS, kept from the sheet this replaces: an
                installed web app there has storage of its own, so the passkey
                follows through iCloud Keychain and is asked for once. */}
            <p>{guide === 'ios' ? INSTALL_LEDE_IOS : copy.lede}</p>
          </div>
        </header>
        <ol className="pwainstall-steps mninstall-steps">
          {steps.map((step, index) => (
            <li key={step.text}>
              <span className="mninstall-step-number" aria-hidden="true">
                {index + 1}
              </span>
              <span className="mninstall-step-glyph" aria-hidden="true">
                <StepGlyph glyph={step.glyph} />
              </span>
              <span>{step.text}</span>
            </li>
          ))}
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
