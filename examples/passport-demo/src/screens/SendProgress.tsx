import { AlertTriangle, Check, ExternalLink, Loader2, RotateCcw, X } from 'lucide-react'
import { createPortal } from 'react-dom'

import type { SendDraft, SendProgressView } from '../lib/sendProgress.js'
import './home.css'

/**
 * A PAYMENT IN FLIGHT, SAID IN TWO SMALL PLACES (2026/09/25).
 *
 * The Send sheet closes once a payment is handed over, so the Passport can be
 * used while it runs. What the sheet used to say is said here instead:
 *
 * - {@link SendProgressPill}, a compact strip pinned above the tab bar, on every
 *   tab and over the Receive sheet — "Sending 10 mUSD to bob.night · Proving…"
 *   with a spinner, then "Sent" with the View link, or the failure's one
 *   sentence and "Try again". Pressing it opens the details.
 * - {@link SendProgressRow}, the details: a live row at the head of Home's
 *   activity list, in the same words, which the ordinary "Sent" row takes over
 *   from when the payment lands.
 *
 * Both paint ONE value, `SendProgressView`, and hold no decisions: which phase,
 * which sentence, and whether it can be put away are `../lib/sendProgress.ts`'s.
 *
 * FIXED, SO NOTHING MOVES. The pill is positioned over the page rather than in
 * it, so it arriving, changing phase, and going never shifts anything under the
 * reader's thumb; the live row is at the head of a list at the foot of Home.
 */

export interface SendProgressHandlers {
  /** Puts away an outcome. Absent from a running payment's controls. */
  onDismiss: () => void
  /** Opens the Send sheet again on the payment that did not go through. */
  onRetry: (draft: SendDraft) => void
}

/** The element id of the live row, which the pill scrolls to. */
export const SEND_PROGRESS_ROW_ID = 'mnhome-send-live'

function ProgressIcon({ view }: { view: SendProgressView }) {
  if (view.kind === 'running') {
    return <Loader2 className="mnhome-send-spinner" size={14} aria-hidden="true" />
  }
  if (view.kind === 'sent') return <Check size={14} aria-hidden="true" />
  return <AlertTriangle size={14} aria-hidden="true" />
}

/** The controls an outcome carries: the View link, or Try again, and a close. */
function ProgressActions(props: SendProgressHandlers & { view: SendProgressView; compact: boolean }) {
  const { view, compact, onDismiss, onRetry } = props
  const retry = view.retry
  return (
    <span className="mnsendp-actions">
      {view.link ? (
        <a
          className="mnsendp-link"
          href={view.link.href}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
        >
          <span>{view.link.label}</span>
          <ExternalLink size={11} aria-hidden="true" />
        </a>
      ) : null}
      {retry ? (
        <button
          type="button"
          className="mnsendp-retry"
          onClick={(event) => {
            event.stopPropagation()
            onRetry(retry)
          }}
        >
          <RotateCcw size={11} aria-hidden="true" />
          <span>Try again</span>
        </button>
      ) : null}
      {view.kind === 'running' ? null : (
        <button
          type="button"
          className="mnsendp-close"
          onClick={(event) => {
            event.stopPropagation()
            onDismiss()
          }}
          aria-label={compact ? 'Dismiss' : 'Dismiss this payment note'}
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </span>
  )
}

/**
 * The strip above the tab bar. Portalled to the document, so it sits over
 * whichever tab is showing and over the Receive sheet, and nothing in the page
 * makes room for it.
 */
export function SendProgressPill(
  props: SendProgressHandlers & {
    view: SendProgressView
    onOpen: () => void
    /** `top` while a sheet owns the foot of the screen. */
    placement?: 'bottom' | 'top'
  },
) {
  const { view, onOpen, placement = 'bottom' } = props
  return createPortal(
    <div
      className="mnsendp-pill"
      data-state={view.kind}
      data-placement={placement}
      /* The toasts measure this and lift themselves clear of it. */
      data-toast-clear=""
      data-testid="send-progress"
      role="status"
      aria-live="polite"
    >
      <button type="button" className="mnsendp-open" onClick={onOpen}>
        <span className="mnsendp-icon">
          <ProgressIcon view={view} />
        </span>
        <span className="mnsendp-text">
          <span className="mnsendp-title">{view.kind === 'failed' ? view.detail : view.title}</span>
          {view.kind === 'running' && view.detail ? (
            <span className="mnsendp-phase" data-phase={view.phase ?? undefined}>
              {view.detail}
            </span>
          ) : null}
        </span>
      </button>
      <ProgressActions {...props} compact />
    </div>,
    document.body,
  )
}

/** The details: a live row at the head of Home's activity list. */
export function SendProgressRow(props: SendProgressHandlers & { view: SendProgressView }) {
  const { view } = props
  return (
    <div
      className="mnsendp-row"
      id={SEND_PROGRESS_ROW_ID}
      data-state={view.kind}
      data-testid="send-progress-row"
    >
      <span className="mnsendp-icon">
        <ProgressIcon view={view} />
      </span>
      <span className="mnsendp-text">
        <span className="mnsendp-title">{view.title}</span>
        {view.detail ? <span className="mnsendp-phase">{view.detail}</span> : null}
      </span>
      <ProgressActions {...props} compact={false} />
    </div>
  )
}
