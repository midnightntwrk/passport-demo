import { MessageCircle } from 'lucide-react'

import { lazy, Suspense, useState } from 'react'
import { createPortal } from 'react-dom'

import { COMPANION_LABEL, companionEnabled, companionUrl } from '../lib/companionLink.js'
import './companion.css'

/* THE COMPANION HAS A FACE (2026/09/22): an animated bot from `bot-avatars`
   (MIT, pinned at 0.1.1, no runtime dependencies, 2D canvas). Loaded lazily so
   the entry chunk does not grow; until it arrives the old chat bubble stands
   in. It looks around when idle, switches to its "working" animation while
   the pointer or focus is on the control, and hops when pressed. The library
   honours prefers-reduced-motion by holding a still pose. The avatar is
   decoration: the control's own label says what it does, so it is hidden from
   assistive technology. */
const BotAvatar = lazy(() => import('bot-avatars').then((m) => ({ default: m.BotAvatar })))

function CompanionFace(props: { size: number; active: boolean; fallbackSize: number }) {
  return (
    <span className="mncompanion-face" aria-hidden="true">
      <Suspense fallback={<MessageCircle size={props.fallbackSize} aria-hidden="true" />}>
        <BotAvatar
          type="clover"
          face="mouth"
          color="#0000FE"
          brightness={1.25}
          saturation={1.1}
          size={props.size}
          state={props.active ? 'working' : 'default'}
          seed={0.37}
        />
      </Suspense>
    </span>
  )
}

/**
 * "Chat with your Midnight Companion" — a link out to a Telegram chat, and
 * nothing else.
 *
 * It is an anchor rather than a button because that is exactly what it does:
 * the browser opens a new tab, Passport takes no other action, holds no state,
 * and is told nothing about what happens on the other side. There is no
 * handshake here and no session; if that changes, it changes somewhere else.
 *
 * The address is decided by `../lib/companionLink.ts`, which is drilled. This
 * file paints two shapes of the same link:
 *
 *   `variant="row"`  the full control on the Apps tab, where a person is
 *                    already looking for something to open.
 *   `variant="icon"` the 34px circle in Home's top bar, beside the install
 *                    and theme controls, borrowing `.mnhome-icon-button` so it
 *                    is the same circle as its neighbours rather than a
 *                    lookalike.
 *
 * The handle the default points at is a PLACEHOLDER — see the link module's
 * header. A build with the real one sets `VITE_COMPANION_URL`.
 */

export interface CompanionLinkProps {
  variant?: 'row' | 'icon'
}

export default function CompanionLink({ variant = 'row' }: CompanionLinkProps) {
  const configured = import.meta.env.VITE_COMPANION_URL
  const enabled = companionEnabled(configured)
  const href = companionUrl(configured)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(false)
  const hoverProps = {
    onMouseEnter: () => setActive(true),
    onMouseLeave: () => setActive(false),
    onFocus: () => setActive(true),
    onBlur: () => setActive(false),
  }

  /* Until the Companions team has an address, the button stays exactly where
     it is and looks exactly as it will, and a press says "coming soon" rather
     than opening a chat that does not exist. With a real handle configured it
     is a plain link out and nothing else. */
  const soon = !enabled

  const modal = open
    ? createPortal(
        <div className="mnid-scrim" role="presentation" onMouseDown={() => setOpen(false)}>
          <div
            className="mnid-modal mncompanion-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Midnight Companion"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mncompanion-modal-face">
              <CompanionFace size={72} active fallbackSize={28} />
            </div>
            <p className="mnid-kicker">Coming soon</p>
            <h2 className="mnid-modal-title">Your Midnight Companion is on its way</h2>
            <p className="mnid-lede">
              A chat with your own Midnight agent, from inside your Passport. It is not open yet;
              this is where it will live.
            </p>
            <div className="mnid-actions">
              <button type="button" className="mnid-primary" onClick={() => setOpen(false)} autoFocus>
                Got it
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null

  if (variant === 'icon') {
    return soon ? (
      <>
        <button
          type="button"
          className="mnhome-icon-button mncompanion-icon"
          aria-label={COMPANION_LABEL}
          title={COMPANION_LABEL}
          onClick={() => setOpen(true)}
          {...hoverProps}
        >
          <CompanionFace size={26} active={active} fallbackSize={15} />
        </button>
        {modal}
      </>
    ) : (
      <a
        className="mnhome-icon-button mncompanion-icon"
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        aria-label={COMPANION_LABEL}
        title={COMPANION_LABEL}
        {...hoverProps}
      >
        <CompanionFace size={26} active={active} fallbackSize={15} />
      </a>
    )
  }

  const inner = (
    <>
      <span className="mncompanion-mark" aria-hidden="true">
        <CompanionFace size={34} active={active} fallbackSize={16} />
      </span>
      <span className="mncompanion-copy">
        <span className="mncompanion-label">{COMPANION_LABEL}</span>
        <span className="mncompanion-hint">{soon ? 'Coming soon' : 'Opens a chat in a new tab'}</span>
      </span>
    </>
  )

  return soon ? (
    <>
      <button type="button" className="mncompanion-row" onClick={() => setOpen(true)} {...hoverProps}>
        {inner}
      </button>
      {modal}
    </>
  ) : (
    <a className="mncompanion-row" href={href} target="_blank" rel="noreferrer noopener" {...hoverProps}>
      {inner}
    </a>
  )
}
