import { AlertTriangle, Banknote, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { useEffect } from 'react'

import './pocket.css'

/**
 * The Pocket — money, in a sheet, off the page.
 *
 * The identity-first ruling made literal: a passport has a pocket in the back
 * cover that happens to hold some cash, and this is it. Balances left the
 * Passport page in P2 and live here, deliberately utilitarian — a list, two
 * acts, no charts, no fiat, no portfolio language. The pocket is allowed to
 * be boring; that is the point, and the October payment beat being the least
 * interesting screen in the app is the message.
 *
 * The sheet is DUMB. Home computes the rows (they are the same
 * `describeColours`-named rows the balance strip carried, cap removed — a
 * sheet scrolls), owns the money notices, and hands everything down; the
 * pocket renders. `onPay` present means there is genuinely a session and an
 * account behind Send — the same withholding rule the old Send button kept.
 */

export interface PocketRow {
  key: string
  icon: ReactNode
  label: string
  /** `null` = not yet known: 'Syncing' while loading, 'Unavailable' after a failed read. */
  value: string | null
  unit: string
}

export interface PocketSheetProps {
  rows: PocketRow[]
  loading: boolean
  /** A read that failed — one fixed sentence, the reader's words go to the log. */
  unavailable: boolean
  /** NIGHT sitting at the wallet address, outside the account. See Home. */
  legacyFunds: { balance: string; busy: boolean; onMove: () => void } | null
  /** Opens Show — receiving starts with showing who you are. */
  onShow: () => void
  /** Opens the Send sheet. Absent = no session or no account; the act is then not offered. */
  onPay?: (() => void) | undefined
  onClose: () => void
}

export default function PocketSheet(props: PocketSheetProps) {
  const { rows, loading, unavailable, legacyFunds, onShow, onPay, onClose } = props

  // Escape closes the sheet, mirroring the scrim click.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="mnhome-addr-scrim" onClick={onClose} role="presentation">
      <div
        className="mnhome-addr-modal mnpocket"
        role="dialog"
        aria-modal="true"
        aria-label="Your Pocket"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mnhome-addr-head">
          <p className="mnhome-micro">Pocket</p>
          <button
            type="button"
            className="mnhome-icon-button"
            onClick={onClose}
            aria-label="Close the Pocket"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        <p className="mnpocket-sub">Held by your Passport, in its own contract.</p>

        <ul className="mnpocket-coins" aria-busy={loading}>
          {rows.map((row) => (
            <li className="mnpocket-coin" key={row.key}>
              <span className="mnpocket-coin-icon" aria-hidden="true">
                {row.icon}
              </span>
              <span className="mnpocket-coin-name">
                <b>{row.label}</b>
                <span>{row.value === null ? '' : row.unit}</span>
              </span>
              <span
                className={`mnpocket-coin-amount${row.value === null ? ' mnpocket-coin-amount-muted' : ''}`}
              >
                {row.value ?? (loading ? 'Syncing' : 'Unavailable')}
              </span>
            </li>
          ))}
        </ul>

        {unavailable ? (
          /* FIXED PROSE. The reader's own words go to the console — see
             `HomeScreenProps.account.error`. */
          <p className="mnpocket-notice">
            <AlertTriangle size={14} aria-hidden="true" />
            <span>
              Your balances could not be read just now. They will refresh once the network
              answers.
            </span>
          </p>
        ) : null}

        {/* Money that is OUTSIDE the account — a pocket concern, so it lives
            in the pocket. `deposit_night` is the only route that makes it
            spendable; see `HomeScreenProps.legacyFunds`. */}
        {legacyFunds ? (
          <div className="mnpocket-legacy">
            <p className="mnpocket-legacy-head">
              <Banknote size={14} aria-hidden="true" />
              <span className="mnhome-micro">Money outside your account</span>
            </p>
            <p className="mnpocket-legacy-body">
              {legacyFunds.balance} NIGHT is sitting at your receiving address, outside your
              Passport account. Your account cannot see it or spend it until it is moved in, and
              moving it in is one transaction.
            </p>
            <button
              type="button"
              className="mnpocket-primary"
              onClick={legacyFunds.onMove}
              disabled={legacyFunds.busy}
            >
              {legacyFunds.busy ? 'Moving…' : 'Move into your account'}
            </button>
          </div>
        ) : null}

        <div className="mnpocket-acts">
          {onPay ? (
            <button type="button" className="mnpocket-primary" onClick={onPay}>
              Pay
            </button>
          ) : null}
          <button type="button" className="mnpocket-ghost" onClick={onShow}>
            Show to receive
          </button>
        </div>

        <p className="mnpocket-note">No charts. No prices. It is a pocket, not a portfolio.</p>
      </div>
    </div>,
    document.body,
  )
}
