import { ChevronRight, KeyRound, LogOut } from 'lucide-react'

import type { ConnectionRecord } from '../identity/connections.js'
import ThemeToggle from './ThemeToggle.js'
import './access.css'

/**
 * Access — who may act with this Passport, and how far.
 *
 * The middle tab of the identity-first navigation, and since P3 the scoped-
 * grant surface: every connected app or agent as a card whose permission
 * lines are C10 triples (operation × object × bound), with the C11 lifecycle
 * (connected, last used, revoke) as the card's chrome. The cards render the
 * connections STORE (`identity/connections.ts`), which only real approvals
 * write — the empty state is therefore still the truth for a Passport that
 * has approved nothing.
 *
 * THE SCREEN IS THE SPECIFICATION. Until the C10 grant lives on the account
 * contract, revoking removes the local record and the app is a stranger
 * again — every flow still asks every time, so nothing is granted that a
 * revoke fails to end. The closing line states the stronger promise in the
 * contract's name, not the app's, because that is whose it will be to keep.
 *
 * The KEYS row is real today: the passkey that opens this Passport and the
 * way to the Keys sub-page.
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
   * The connections the open Passport has approved — the store's answer,
   * never invented here. Empty renders the honest empty state.
   */
  connections: ConnectionRecord[]
  /** Removes one connection. Absent when no session is open to act for. */
  onRevoke?: (origin: string) => void
  /**
   * Signs this Passport out. On every tab's bar, not only Home's: the way
   * out must not depend on which page somebody happens to be reading
   * (reported missing here 2026/09/06).
   */
  onSignOut: () => void
}

/** `2026/09/07` — the repo's own date form, from an ISO timestamp. */
function shortDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`
}

export default function AccessScreen(props: AccessScreenProps) {
  const { keysSummary, onOpenKeys, connections, onRevoke, onSignOut } = props

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

      {/* Connections: the store's answer, one card per approved origin. The
          empty state stays exactly as honest as it always was — the store is
          only ever written by a real approval. */}
      <section className="mnaccess-connections" aria-labelledby="mnaccess-connections-title">
        <h2 className="mnaccess-section-title" id="mnaccess-connections-title">
          Connections
        </h2>
        {connections.length === 0 ? (
          <div className="mnaccess-empty">
            <p className="mnaccess-empty-lead">Nothing may act for you yet.</p>
            <p className="mnaccess-empty-body">
              Apps and agents you connect will appear here with exactly what they are allowed to
              do — each permission is a grant your Passport&rsquo;s own contract enforces, so
              revoked means revoked.
            </p>
          </div>
        ) : (
          <>
            <ul className="mnaccess-apps">
              {connections.map((connection) => (
                <li key={connection.origin} className="mnaccess-app">
                  <div className="mnaccess-app-top">
                    <span className="mnaccess-app-text">
                      <b>{connection.name}</b>
                      <span className="mnaccess-app-origin">
                        connected {shortDate(connection.connectedAt)}
                      </span>
                    </span>
                    {connection.kind === 'agent' ? (
                      <span className="mnaccess-agent-tag">AGENT</span>
                    ) : null}
                    {onRevoke ? (
                      <button
                        type="button"
                        className="mnaccess-revoke"
                        onClick={() => onRevoke(connection.origin)}
                        aria-label={`Revoke ${connection.name}`}
                      >
                        Revoke
                      </button>
                    ) : null}
                  </div>
                  <ul className="mnaccess-scopes">
                    {connection.scopes.map((scope) => (
                      <li
                        key={`${scope.operation}·${scope.object}·${scope.bound}`}
                        className="mnaccess-scope"
                      >
                        <span className="mnaccess-scope-verb">{scope.operation}</span>
                        <span className="mnaccess-scope-object">{scope.object}</span>
                        <span className="mnaccess-scope-bound">{scope.bound}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mnaccess-app-meta">
                    <span>last used {shortDate(connection.lastUsedAt)}</span>
                    <span>
                      {connection.uses} {connection.uses === 1 ? 'approval' : 'approvals'}
                    </span>
                    <span>{connection.expiresAt ? `expires ${shortDate(connection.expiresAt)}` : 'no expiry'}</span>
                  </p>
                </li>
              ))}
            </ul>
            {/* The closing line, and whose promise it is. Today a revoked app
                is a stranger that must ask again; the day these scopes are
                grants on the account contract, revoked means revoked whatever
                the app does. Said in the contract's name on purpose. */}
            <p className="mnaccess-promise">
              Each line above is a permission your Passport&rsquo;s own contract will enforce —
              revoked means revoked, held by the contract, not by an app&rsquo;s manners.
            </p>
          </>
        )}
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
