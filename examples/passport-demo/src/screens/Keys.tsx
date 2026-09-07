import { lazy, Suspense, useState } from 'react'
import { ArrowRight, FileKey2, Fingerprint, KeySquare, MonitorSmartphone, ScanLine } from 'lucide-react'

import { parseQrPayload, type QrPayload } from '../lib/qrPayload.js'
import type { CustodyPhase } from '../lib/custodySteps.js'
import CustodyProgress from './CustodyProgress.js'
import ThemeToggle from './ThemeToggle.js'
import './identity.css'

const QrScanSheet = lazy(() => import('./QrScanSheet.js'))

/**
 * Keys — what can open this Passport, and what can bring it back.
 *
 * The sub-page behind Access's keys row (P3). Four panels, every state real:
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
 *   - ANOTHER DEVICE: the admit half of the join handoff. A NEW device draws
 *     a join code (`JoinDevice.tsx`); THIS panel reads it — camera, image,
 *     or pasted text, because two browsers on one machine cannot point a
 *     camera at each other — and walks the same confirm-then-call beats as
 *     the recovery key, against the same `add_device` circuit.
 *
 * The screen is dumb; App.tsx owns both enrolment state machines and the
 * chain calls. When no injected wallet exists (or no session, or no account)
 * a panel says so in prose — a button for an act this browser cannot perform
 * is not offered.
 */

export interface KeysRecoveryState {
  /** The enrolled key, as recorded on this device. The LEDGER is the authority. */
  record: { ethAddress: string; txIdResolved: boolean } | null
  stage: 'idle' | 'deriving' | 'confirm' | 'submitting'
  /** Set at the confirm beat: what enrolment will put on chain. */
  pending: { ethAddress: string; commitmentTail: string } | null
  /** The live phase of the account call — drives the progress stepper. */
  phase: CustodyPhase | null
  error: string | null
  /** Starts connect-and-sign. Absent when no injected wallet is in this browser. */
  onBegin?: (() => void) | undefined
  /** Why `onBegin` is absent, said plainly — or null when it is present. */
  unavailableReason: string | null
  onConfirm: () => void
  onCancel: () => void
}

/**
 * The admit half of the join handoff, mirrored on {@link KeysRecoveryState}:
 * the same stages, because it is the same circuit with a different key
 * source — a code another device drew instead of a wallet signature.
 */
export interface KeysAdmitState {
  /** The pairing this device remembers, either role. The LEDGER is the authority. */
  record: { role: 'joined' | 'admitted'; at: string } | null
  stage: 'idle' | 'checking' | 'confirm' | 'submitting'
  /** Set at the confirm beat: what admitting will put on chain, and for whom. */
  pending: { domain: string; commitmentTail: string } | null
  phase: CustodyPhase | null
  error: string | null
  /**
   * Takes a decoded join code — from the camera, an image, or pasted text.
   * Absent when this browser cannot admit anything right now.
   */
  onCode?: ((payload: QrPayload) => void) | undefined
  /** Why `onCode` is absent, said plainly — or null when it is present. */
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
  admit: KeysAdmitState
  onDone: () => void
}

function shortEthAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`
}

export default function KeysScreen(props: KeysScreenProps) {
  const { passkeySummary, backupKept, onOpenBackup, recovery, admit, onDone } = props
  const [scanOpen, setScanOpen] = useState(false)
  const [pasted, setPasted] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)

  /* The paste funnel: parse locally so garbage gets its sentence at once,
     hand every REAL payload to the host — whose machine owns the refusal of
     codes that are real but not admissible (a payment code, a code for a
     different Passport). */
  const submitPasted = (): void => {
    const payload = parseQrPayload(pasted)
    if (!payload) {
      setPasteError('That text is not a Passport code. Paste the whole line the other device shows.')
      return
    }
    setPasteError(null)
    setPasted('')
    admit.onCode?.(payload)
  }

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
            <>
              <p>Adding the key to your account. This proves and submits a real transaction.</p>
              <CustodyProgress phase={recovery.phase} />
            </>
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

        <div className="mnid-panel">
          <p className="mnid-panel-head">
            <MonitorSmartphone size={16} aria-hidden="true" />
            Another device
          </p>

          {admit.record ? (
            <p>
              {admit.record.role === 'admitted'
                ? 'A second device holds its own passkey to this Passport — admitted from here, enrolled on your account.'
                : 'This device was admitted by another one, so at least two devices hold keys to this Passport.'}
            </p>
          ) : null}

          {admit.stage === 'confirm' && admit.pending ? (
            <>
              <p>
                A device asks to join <b>{admit.pending.domain}</b> — this Passport. Admitting it
                puts ONLY its public key commitment (…{admit.pending.commitmentTail}) on your
                account. A device holding that key can then do everything this one can: spend,
                grant, and admit more devices.
              </p>
              <div className="mnid-panel-actions">
                <button type="button" className="mnid-primary" onClick={admit.onConfirm}>
                  Admit this device
                </button>
                <button type="button" className="mnid-secondary" onClick={admit.onCancel}>
                  Cancel
                </button>
              </div>
            </>
          ) : admit.stage === 'checking' ? (
            <p>Checking that code against the registry — whose Passport it was drawn for…</p>
          ) : admit.stage === 'submitting' ? (
            <>
              <p>Admitting the device. This proves and submits a real transaction.</p>
              <CustodyProgress phase={admit.phase} />
            </>
          ) : (
            <>
              {!admit.record ? (
                <p>
                  A second device — a phone, a laptop — can hold its own passkey to this
                  Passport. On the new device, choose{' '}
                  <b>Add this device to a Passport that already exists</b> when it starts, and it
                  will show you a code to read here.
                </p>
              ) : null}
              {admit.onCode ? (
                <>
                  <div className="mnid-panel-actions">
                    <button
                      type="button"
                      className="mnid-primary"
                      onClick={() => setScanOpen(true)}
                    >
                      <ScanLine size={15} aria-hidden="true" />
                      Scan a join code
                    </button>
                  </div>
                  <form
                    className="mnid-admit-paste"
                    onSubmit={(event) => {
                      event.preventDefault()
                      submitPasted()
                    }}
                  >
                    <input
                      className="mnid-admit-input"
                      value={pasted}
                      onChange={(event) => {
                        setPasted(event.target.value)
                        setPasteError(null)
                      }}
                      placeholder="…or paste the code as text"
                      aria-label="Paste a join code"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                    <button
                      type="submit"
                      className="mnid-secondary"
                      disabled={pasted.trim().length === 0}
                    >
                      Read it
                    </button>
                  </form>
                  {pasteError ? (
                    <p className="mnid-keys-error" role="alert">
                      {pasteError}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="mnid-keys-unavailable">{admit.unavailableReason}</p>
              )}
            </>
          )}

          {admit.error ? (
            <p className="mnid-keys-error" role="alert">
              {admit.error}
            </p>
          ) : null}
        </div>

        {scanOpen && admit.onCode ? (
          <Suspense fallback={null}>
            <QrScanSheet
              onResult={(payload) => {
                setScanOpen(false)
                admit.onCode?.(payload)
              }}
              onClose={() => setScanOpen(false)}
            />
          </Suspense>
        ) : null}

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
