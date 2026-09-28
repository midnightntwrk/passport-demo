import { Download, Share, SquarePlus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { INSTALL_HINT_STEPS, INSTALL_LABEL } from '../lib/installPrompt.js'
import { promptInstall, useInstallOffer } from '../pwa.js'
import './install-passport.css'

/**
 * The install control, in the top bar where a person looks for it.
 *
 * Everything it decides is in `lib/installPrompt.ts`, which is drilled; this
 * file reads the browser, holds the captured event, and paints two things: a
 * button that opens Chromium's own install dialogue, and — on iOS Safari,
 * which fires no install event and never will — the two taps the reader has to
 * make themselves.
 *
 * IT DOES NOT NAG. It appears when installing is possible and disappears the
 * moment it is not, and it never opens anything by itself. `prompt()` runs on
 * a press and nowhere else. There is no "not now", because there is nothing to
 * decline: it is a control in a toolbar, not an invitation.
 */

export default function InstallPassport() {
  const { affordance } = useInstallOffer()
  const [hintOpen, setHintOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!hintOpen) return undefined
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setHintOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHintOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [hintOpen])

  if (affordance === 'hidden') return null

  return (
    <div className="mninstall" ref={rootRef}>
      <button
        type="button"
        className="mnhome-icon-button"
        aria-label={INSTALL_LABEL}
        title={INSTALL_LABEL}
        aria-expanded={affordance === 'hint' ? hintOpen : undefined}
        onClick={() => {
          if (affordance === 'hint') setHintOpen((open) => !open)
          else void promptInstall()
        }}
      >
        <Download size={15} aria-hidden="true" />
      </button>

      {affordance === 'hint' && hintOpen ? (
        <div className="mninstall-hint" role="dialog" aria-label={INSTALL_LABEL}>
          <p className="mninstall-hint-title">
            {INSTALL_LABEL}
            <button
              type="button"
              className="mninstall-hint-close"
              onClick={() => setHintOpen(false)}
              aria-label="Close"
            >
              <X size={13} aria-hidden="true" />
            </button>
          </p>
          <ol className="mninstall-hint-steps">
            <li>
              <Share size={14} strokeWidth={2} aria-hidden="true" />
              <span>{INSTALL_HINT_STEPS[0]}</span>
            </li>
            <li>
              <SquarePlus size={14} strokeWidth={2} aria-hidden="true" />
              <span>{INSTALL_HINT_STEPS[1]}</span>
            </li>
          </ol>
        </div>
      ) : null}
    </div>
  )
}
