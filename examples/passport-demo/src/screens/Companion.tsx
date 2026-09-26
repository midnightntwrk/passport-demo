import { MessageCircle } from 'lucide-react'

import { lazy, memo, Suspense, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { COMPANION_LABEL, companionEnabled, companionUrl } from '../lib/companionLink.js'
import { startCompanionMotion, type CompanionMotion } from '../lib/companionMotion.js'
import './companion.css'

/* THE COMPANION HAS A FACE (2026/09/22): an animated bot from `bot-avatars`
   (MIT, pinned at 0.1.1, no runtime dependencies, 2D canvas). Loaded lazily so
   the entry chunk does not grow; until it arrives the old chat bubble stands
   in. It switches to its "working" animation — hopping — while the pointer or
   focus is on the control. The avatar is decoration: the control's own label
   says what it does, so it is hidden from assistive technology.

   AND IT MOVES ONLY WHEN THERE IS A REASON TO (2026/09/25): a few seconds when
   it appears, a few more when it is pressed or focused, and while a pointer
   rests on it. Otherwise it holds a still frame. Left running, its frame loop
   was most of what an idle Home cost a phone — see `lib/companionMotion.ts`. */
const BotAvatar = lazy(() => import('bot-avatars').then((m) => ({ default: m.BotAvatar })))

function reducedMotionQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null
}

/**
 * The face's motion, for one control. The rule is `lib/companionMotion.ts`'s;
 * this is the wiring: the reduced-motion query, and the controller's lifetime.
 */
function useCompanionMotion(): {
  moving: boolean
  wake: () => void
  hold: (held: boolean) => void
} {
  const [moving, setMoving] = useState(() => !(reducedMotionQuery()?.matches ?? false))
  const motion = useRef<CompanionMotion | null>(null)
  useEffect(() => {
    const query = reducedMotionQuery()
    const controller = startCompanionMotion({
      onChange: setMoving,
      reducedMotion: () => query?.matches ?? false,
    })
    motion.current = controller
    setMoving(controller.moving())
    const onPreference = () => controller.reconsider()
    query?.addEventListener('change', onPreference)
    return () => {
      query?.removeEventListener('change', onPreference)
      controller.stop()
      motion.current = null
    }
  }, [])
  return {
    moving,
    wake: () => motion.current?.wake(),
    hold: (held: boolean) => motion.current?.hold(held),
  }
}

function CompanionFace(props: { size: number; active: boolean; moving: boolean; fallbackSize: number }) {
  return (
    <span className="mncompanion-face" aria-hidden="true">
      <Suspense fallback={<MessageCircle size={props.fallbackSize} aria-hidden="true" />}>
        {/* A FRESH CANVAS EACH WAY. Paused, the library freezes whatever frame
            it had reached — mid-hop, mid-blink. Mounting a paused one instead
            draws the face's resting pose, eyes open and facing forward, which
            is the still frame this is meant to hold. */}
        <BotAvatar
          key={props.moving ? 'moving' : 'still'}
          paused={!props.moving}
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

/* MEMOISED, because it takes nothing its host changes: Home re-renders on
   every read of the account, and each re-render reached the canvas and drew
   the face again. */
export default memo(CompanionLink)

function CompanionLink({ variant = 'row' }: CompanionLinkProps) {
  const configured = import.meta.env.VITE_COMPANION_URL
  const enabled = companionEnabled(configured)
  const href = companionUrl(configured)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(false)
  const { moving, wake, hold } = useCompanionMotion()
  const hoverProps = {
    onMouseEnter: () => {
      setActive(true)
      hold(true)
    },
    onMouseLeave: () => {
      setActive(false)
      hold(false)
    },
    onFocus: () => {
      setActive(true)
      wake()
    },
    onBlur: () => setActive(false),
    onPointerDown: wake,
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
              <CompanionFace size={72} active moving={moving} fallbackSize={28} />
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
          <CompanionFace size={26} active={active} moving={moving} fallbackSize={15} />
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
        <CompanionFace size={26} active={active} moving={moving} fallbackSize={15} />
      </a>
    )
  }

  const inner = (
    <>
      <span className="mncompanion-mark" aria-hidden="true">
        <CompanionFace size={34} active={active} moving={moving} fallbackSize={16} />
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
