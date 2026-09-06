import { LogOut } from 'lucide-react'

import ThemeToggle from './ThemeToggle.js'
import ActivityFeed, { type ActivityFeedItem } from './ActivityFeed.js'
import './stamps.css'

/**
 * Stamps — where this Passport has been.
 *
 * The activity trail, moved off Home in the identity-first redesign: the
 * grid of things a person USES lives on the other tabs; this page is what
 * they come back to CHECK. The entries are the same `addActivity` rows the
 * trail has always carried; the passport-stamp visual treatment is a later
 * pass (P4 in the design study), so today this page mounts the existing feed
 * under the new roof.
 */

export interface StampsScreenProps {
  entries: readonly ActivityFeedItem[]
  /**
   * Signs this Passport out. On every tab's bar, not only Home's: the way
   * out must not depend on which page somebody happens to be reading
   * (reported missing here 2026/09/06).
   */
  onSignOut: () => void
}

export default function StampsScreen(props: StampsScreenProps) {
  const { entries, onSignOut } = props

  return (
    <section className="mnstamps-screen">
      <header className="mnstamps-bar">
        <img className="mnstamps-wordmark" src="/skunk/mark.svg" alt="Midnight" />
        <div className="mnstamps-bar-actions">
          <ThemeToggle size="sm" />
          {/* Home's 34px icon button; home.css is loaded wherever Home is —
              the same rule the trail below already leans on. */}
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

      <header className="mnstamps-head">
        <p className="mnstamps-kicker">Your Passport</p>
        <h1 className="mnstamps-title">Stamps</h1>
        <p className="mnstamps-lede">Where this Passport has been.</p>
      </header>

      <ActivityFeed entries={entries} />
    </section>
  )
}
