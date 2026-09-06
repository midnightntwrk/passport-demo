import { ArrowRight, FileKey2, Fingerprint, KeySquare } from 'lucide-react'

import ThemeToggle from './ThemeToggle.js'
import './identity.css'

/**
 * Keys — what can open this Passport, and what can bring it back.
 *
 * The sub-page behind Access's keys row (P3). Three kinds of key, one panel
 * each, every state real:
 *
 *   - THE PASSKEY: what signs everything today.
 *   - THE BACKUP: the encrypted file — level 2 of the guard ladder, managed
 *     on the Backup screen this panel opens.
 *   - THE RECOVERY KEY: the MetaMask-derived device (see
 *     `identity/recoveryKey.ts`) — level 3, enrolled on the account contract
 *     itself with `add_device`, which is what makes it able to let you back
 *     in with this device gone. Enrolment is a three-beat ceremony and every
 *     beat is labelled: connect-and-sign (the wallet's own prompts), a
 *     CONFIRM step that says exactly what goes on chain before anything
 *     does, then the gated call, passkey-authorised like every other one.
 *
 * The screen is dumb; App.tsx owns the enrolment state machine and the
 * chain call. When no injected wallet exists the panel says so in prose —
 * a button for an act this browser cannot perform is not offered.
 */

export interface KeysRecoveryState {
  /** The enrolled key, as recorded on this device. The LEDGER is the authority. */
  record: { ethAddress: string; txIdResolved: boolean } | null
  stage: 'idle' | 'deriving' | 'confirm' | 'submitting'
  /** Set at the confirm beat: what enrolment will put on chain. */
  pending: { ethAddress: string; commitmentTail: string } | null
  /** The live phase of the account call, in the seam's own words. */
  phase: string | null
  error: string | null
  /** Starts connect-and-sign. Absent when no injected wallet is in this browser. */
  onBegin?: (() => void) | undefined
  /** Why `onBegin` is absent, said plainly — or null when it is present. */
  unavailableReason: string | null
  onConfirm: () => void
  onCancel: () => void
}

export interface KeysScreenProps {
  /** One line describing the passkey session — never invented. */
  passkeySummary: string | null
  backupKept: boolean
  onOpenBackup: () => void
  recovery: KeysRecoveryState
  onDone: () => void
}

function shortEthAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`
}

export default function KeysScreen(props: KeysScreenProps) {
  const { passkeySummary, backupKept, onOpenBackup, recovery, onDone } = props

  return (
    <section className="mnid-screen">
      <header className="mnid-bar">
        <img className="mnid-wordmark" src="/skunk/mark.svg" alt="Midnight" />
        <span className="mnid-step">Keys</span>
        <ThemeToggle size="sm" className="mnid-theme" />
      </header>

      <div className="mnid-body">
        <p className="mnid-kicker">Your Passport</p>
        <h1 className="mnid-title">Keys</h1>
        <p className="mnid-lede">What can open this Passport, and what can bring it back.</p>

        <div className="mnid-panel">
          <p className="mnid-panel-head">
            <Fingerprint size={16} aria-hidden="true" />
            The passkey
          </p>
          <p>{passkeySummary ?? 'No passkey session is open in this browser right now.'}</p>
          <p>It signs everything your Passport does, and it never leaves this device.</p>
        </div>

        <div className="mnid-panel">
          <p className="mnid-panel-head">
            <FileKey2 size={16} aria-hidden="true" />
            The backup
          </p>
          <p>
            {backupKept
              ? 'A backup has been kept: one encrypted file, one password, and this Passport can be revived from it.'
              : 'No backup yet. One encrypted file, one password — it is what revives this Passport if this browser forgets it.'}
          </p>
          <div className="mnid-panel-actions">
            <button type="button" className="mnid-secondary" onClick={onOpenBackup}>
              Back up or restore
            </button>
          </div>
        </div>

        <div className="mnid-panel">
          <p className="mnid-panel-head">
            <KeySquare size={16} aria-hidden="true" />
            The recovery key
          </p>

          {recovery.record ? (
            <>
              <p>
                <b>{shortEthAddress(recovery.record.ethAddress)}</b> holds this Passport&rsquo;s
                recovery key. Signing one fixed message with that wallet re-derives it — on any
                device, with this one gone.
              </p>
              <p>
                {recovery.record.txIdResolved
                  ? 'Enrolled on your account, confirmed on the ledger.'
                  : 'Enrolled on your account — the ledger has not reported the transaction yet.'}
              </p>
            </>
          ) : recovery.stage === 'confirm' && recovery.pending ? (
            <>
              <p>
                <b>{shortEthAddress(recovery.pending.ethAddress)}</b> signed, and the key is
                derived. Adding it to your account puts ONLY its public commitment
                (…{recovery.pending.commitmentTail}) on chain — the signature and the key stay
                with you.
              </p>
              <p>
                From then on that wallet can let you back in: sign the same message anywhere,
                and the same key comes back.
              </p>
              <div className="mnid-panel-actions">
                <button type="button" className="mnid-primary" onClick={recovery.onConfirm}>
                  Add to your account
                </button>
                <button type="button" className="mnid-secondary" onClick={recovery.onCancel}>
                  Cancel
                </button>
              </div>
            </>
          ) : recovery.stage === 'deriving' ? (
            <p>Waiting for the wallet — connect it, then sign the recovery message…</p>
          ) : recovery.stage === 'submitting' ? (
            <p>
              Adding the key to your account…
              {recovery.phase ? ` (${recovery.phase})` : ''} This proves and submits a real
              transaction, and can take a minute.
            </p>
          ) : (
            <>
              <p>
                A key that is NOT on this device, derived from one fixed message signed by a
                wallet you already hold. Lose this device, sign the same message anywhere, and
                you are back in.
              </p>
              {recovery.onBegin ? (
                <div className="mnid-panel-actions">
                  <button type="button" className="mnid-primary" onClick={recovery.onBegin}>
                    Connect MetaMask
                  </button>
                </div>
              ) : (
                <p className="mnid-keys-unavailable">{recovery.unavailableReason}</p>
              )}
            </>
          )}

          {recovery.error ? (
            <p className="mnid-keys-error" role="alert">
              {recovery.error}
            </p>
          ) : null}
        </div>

        <div className="mnid-actions" data-toast-clear>
          <button type="button" className="mnid-secondary" onClick={onDone}>
            <ArrowRight size={17} aria-hidden="true" />
            Done
          </button>
        </div>
      </div>
    </section>
  )
}
