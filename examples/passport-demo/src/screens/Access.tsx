import { ChevronRight, KeyRound, LogOut } from 'lucide-react'

import ThemeToggle from './ThemeToggle.js'
import './access.css'

/**
 * Access — who may act with this Passport, and how far.
 *
 * The middle tab of the identity-first navigation. Its long-run content is
 * the scoped-grant surface: every connected app or agent as a card whose
 * permission lines are C10 triples (operation × object × bound), with the
 * C11 lifecycle (last used, expiry, revoke) as the card's chrome. Until the
 * grant primitives exist on-chain this screen carries the honest empty state
 * — it never invents connections — and the KEYS row, which is real today:
 * the passkey that opens this Passport and the way to the backup/restore
 * surface.
 *
 * See `.planning/skunk-demo/DESIGN.md` (Access) in the planning workspace for
 * the full design this screen grows into.
 */

export interface AccessScreenProps {
  /**
   * One line describing what currently guards this Passport — the passkey on
   * this device, plus recovery keys once they exist. `null` when no session
   * is open, which renders the row without a detail line rather than
   * inventing one.
   */
  keysSummary: string | null
  /** Opens the keys surface (today: the backup/restore screen). */
  onOpenKeys?: () => void
  /**
   * Signs this Passport out. On every tab's bar, not only Home's: the way
   * out must not depend on which page somebody happens to be reading
   * (reported missing here 2026/09/06).
   */
  onSignOut: () => void
}

export default function AccessScreen(props: AccessScreenProps) {
  const { keysSummary, onOpenKeys, onSignOut } = props

  return (
    <section className="mnaccess-screen">
      <header className="mnaccess-bar">
        <img className="mnaccess-wordmark" src="/skunk/mark.svg" alt="Midnight" />
        <div className="mnaccess-bar-actions">
          <ThemeToggle size="sm" />
          {/* Home's 34px icon button; home.css is loaded wherever Home is,
              which is every session that can reach this tab — the same rule
              the Stamps trail already leans on. */}
          <button
            type="button"
            className="mnhome-icon-button"
            onClick={onSignOut}
            aria-label="Sign out of this Passport"
            title="Sign out"
          >
            <LogOut size={15} aria-hidden="true" />
          </button>
        </div>
      </header>

      <header className="mnaccess-head">
        <p className="mnaccess-kicker">Your Passport</p>
        <h1 className="mnaccess-title">Access</h1>
        <p className="mnaccess-lede">Who may act with this Passport, and how far.</p>
      </header>

      {/* Connections. There is no way to hold a grant yet, so the truthful
          content is the promise of the surface, not a mocked tenant. */}
      <section className="mnaccess-connections" aria-labelledby="mnaccess-connections-title">
        <h2 className="mnaccess-section-title" id="mnaccess-connections-title">
          Connections
        </h2>
        <div className="mnaccess-empty">
          <p className="mnaccess-empty-lead">Nothing may act for you yet.</p>
          <p className="mnaccess-empty-body">
            Apps and agents you connect will appear here with exactly what they are allowed to
            do — each permission is a grant your Passport&rsquo;s own contract enforces, so
            revoked means revoked.
          </p>
        </div>
      </section>

      {/* The keys — real today. */}
      <button
        type="button"
        className="mnaccess-keysrow"
        onClick={onOpenKeys}
        disabled={!onOpenKeys}
      >
        <span className="mnaccess-keysrow-icon" aria-hidden="true">
          <KeyRound size={19} />
        </span>
        <span className="mnaccess-keysrow-text">
          <b>Keys</b>
          {keysSummary ? <span>{keysSummary}</span> : null}
        </span>
        <ChevronRight size={18} aria-hidden="true" className="mnaccess-keysrow-chevron" />
      </button>
    </section>
  )
}
