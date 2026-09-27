import { AlertTriangle, Check, Circle, ExternalLink, Loader2, RotateCcw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  sendClosingNote,
  sendElapsed,
  sendProgressSteps,
  type SendDraft,
  type SendProgressView,
} from '../lib/sendProgress.js'
import { useSheetBackButton } from './useSheetBackButton.js'
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
 * WHAT CLOSING PASSPORT DOES is said on all three (2026/09/26): keep it open
 * while the payment is unsent, and closing will not stop it once it has been
 * handed over. The words are `sendClosingNote`'s.
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
  const keepOpen = sendClosingNote(view)?.pill ?? null
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
            <span className="mnsendp-line">
              <span className="mnsendp-phase" data-phase={view.phase ?? undefined}>
                {view.detail}
              </span>
              {keepOpen ? (
                <span className="mnsendp-hold" data-testid="send-keep-open">
                  {keepOpen}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      </button>
      <ProgressActions {...props} compact />
    </div>,
    document.body,
  )
}

/**
 * The live row at the head of Home's activity list — a PENDING row, set apart
 * from the recorded ones by its accent and its spinner, and a real button:
 * pressing it reopens the payment in {@link SendProgressSheet}.
 */
export function SendProgressRow(
  props: SendProgressHandlers & { view: SendProgressView; onOpen: () => void },
) {
  const { view, onOpen } = props
  const closing = sendClosingNote(view)
  return (
    <div
      className="mnsendp-row"
      id={SEND_PROGRESS_ROW_ID}
      data-state={view.kind}
      data-testid="send-progress-row"
    >
      <button
        type="button"
        className="mnsendp-open"
        onClick={onOpen}
        aria-label={`${view.title} — view progress`}
      >
        <span className="mnsendp-icon">
          <ProgressIcon view={view} />
        </span>
        <span className="mnsendp-text">
          <span className="mnsendp-tag">{view.kind === 'failed' ? 'Not sent' : 'Pending'}</span>
          <span className="mnsendp-title">{view.title}</span>
          {view.detail ? <span className="mnsendp-phase">{view.detail}</span> : null}
          {closing ? (
            <span className="mnsendp-hold" data-testid="send-keep-open">
              {closing.row}
            </span>
          ) : null}
        </span>
      </button>
      <ProgressActions {...props} compact={false} />
    </div>
  )
}

/**
 * THE PAYMENT, REOPENED (2026/09/25). "The send transaction should move to the
 * activity as a pending transaction … so I can click it and reopen this modal,
 * but it shouldn't occupy my whole screen."
 *
 * Read-only: what is being paid, to whom, the five steps with the live one
 * marked, how long it has been running, and Close — which returns to Home with
 * the payment still running. Sent adds the View link; a failure its sentence
 * and Try again. It paints the same view the pill and the row paint, so the
 * three cannot disagree, and it holds nothing of its own but the clock.
 */
export function SendProgressSheet(
  props: SendProgressHandlers & { view: SendProgressView; onClose: () => void },
) {
  const { view, onClose, onRetry } = props
  const [now, setNow] = useState(() => Date.now())
  const running = view.kind === 'running'
  useEffect(() => {
    if (!running) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [running])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useSheetBackButton('send-progress', true, onClose)
  const steps = sendProgressSteps(view)
  const closing = sendClosingNote(view)
  const heading =
    view.kind === 'sent' ? 'Sent' : view.kind === 'failed' ? 'Not sent' : 'Sending'
  return createPortal(
    <div className="mnhome-addr-scrim" onClick={onClose} role="presentation">
      <div
        className="mnhome-addr-modal mnhome-surface-modal mnsendp-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mnsendp-sheet-title"
        data-testid="send-progress-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mnhome-addr-head mnhome-surface-head">
          <div className="mnhome-surface-heading">
            <span className="mnhome-surface-eyebrow">Your Passport</span>
            <h2 className="mnhome-surface-title" id="mnsendp-sheet-title">
              {heading}
            </h2>
            <p className="mnhome-surface-description" data-testid="send-progress-closing">
              {closing
                ? closing.sheet
                : view.kind === 'sent'
                  ? 'It has been handed to the network.'
                  : view.detail}
            </p>
          </div>
          <button type="button" className="mnhome-icon-button" onClick={onClose} aria-label="Close">
            <X size={15} aria-hidden="true" />
          </button>
        </div>
        <dl className="mnhome-send-rows">
          <div className="mnhome-send-row">
            <dt>Asset</dt>
            <dd>
              <strong>{view.subject.symbol}</strong>
            </dd>
          </div>
          <div className="mnhome-send-row">
            <dt>Amount</dt>
            <dd>
              <strong>
                {view.subject.amount} {view.subject.symbol}
              </strong>
            </dd>
          </div>
          <div className="mnhome-send-row">
            <dt>Recipient</dt>
            <dd>
              <strong>{view.subject.recipient}</strong>
            </dd>
          </div>
          <div className="mnhome-send-row">
            <dt>Time</dt>
            <dd data-testid="send-progress-elapsed">{sendElapsed(view.startedAt, now)}</dd>
          </div>
        </dl>
        <ol className="mnsendp-steps" aria-label="Progress">
          {steps.map((step) => (
            <li
              key={step.key}
              className="mnsendp-step"
              data-state={step.state}
              aria-current={step.state === 'current' ? 'step' : undefined}
            >
              <span className="mnsendp-step-mark" aria-hidden="true">
                {step.state === 'done' ? (
                  <Check size={12} />
                ) : step.state === 'current' ? (
                  <Loader2 className="mnhome-send-spinner" size={12} />
                ) : (
                  <Circle size={10} />
                )}
              </span>
              <span>{step.label}</span>
            </li>
          ))}
        </ol>
        <div className="mnhome-send-actions">
          {view.link ? (
            <a className="mnhome-send-secondary mnsendp-sheet-link" href={view.link.href} target="_blank" rel="noreferrer">
              <span>{view.link.label}</span>
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          ) : null}
          {view.retry ? (
            <button
              type="button"
              className="mnhome-send-secondary"
              onClick={() => {
                if (view.retry) onRetry(view.retry)
              }}
            >
              <RotateCcw size={13} aria-hidden="true" />
              <span>Try again</span>
            </button>
          ) : null}
          <button type="button" className="mnhome-send-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
