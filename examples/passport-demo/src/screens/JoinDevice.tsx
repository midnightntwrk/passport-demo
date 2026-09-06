import { ArrowRight, Check, Copy, KeyRound, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import ThemeToggle from './ThemeToggle.js'
import './identity.css'

/**
 * Join — adding THIS device to a Passport that already exists.
 *
 * The other half of the add-device handoff (P3). A person with a Passport on
 * their phone opens the app on their laptop, makes a passkey — the enrolment
 * is identical either way — and then, instead of naming a NEW Passport, walks
 * this screen: name the Passport, make this device's key, show the code, and
 * wait for the other device to admit it. Three stages, each honest about
 * what has and has not happened:
 *
 *   - NAME: which Passport? Resolved against the real registry; a name that
 *     resolves to a wallet rather than an account is refused in words,
 *     because only an account contract can admit a second device.
 *   - FOUND: what the registry answered, and the one ceremony left — the
 *     passkey assertion that derives this device's key commitment. Nothing
 *     has touched the chain.
 *   - SHOW: the join code. Everything in it is public (the name, the network,
 *     the key COMMITMENT — the value `add_device` publishes anyway); the
 *     secret it binds never leaves this device. The screen watches the
 *     ledger, and the ledger — never this screen — is what says the join
 *     landed.
 *
 * The screen is dumb: App.tsx owns the state machine, the registry reads,
 * the ceremony, and the poll. What the screen owns is the QR rendering and
 * the copy path, because a laptop showing a code to a phone is the easy case
 * — two browsers on ONE machine (the demo, often) need the code as text.
 */

export interface JoinDeviceState {
  stage: 'name' | 'found' | 'show'
  /** A lookup or the key ceremony in flight — the primary control waits. */
  busy: boolean
  error: string | null
  /** Stage 'found' onwards. */
  domain: string | null
  accountAddress: string | null
  /** How many keys the account holds today — read from the ledger at FOUND. */
  deviceCount: number | null
  /** Stage 'show'. */
  payload: string | null
  commitmentTail: string | null
  /** The watcher's honest status line at SHOW, in App's words. */
  watchLine: string | null
}

export interface JoinDeviceProps {
  /** The network the lookup runs against, named for the reader. */
  networkLabel: string
  state: JoinDeviceState
  onLookup: (typed: string) => void
  /** The passkey ceremony that derives this device's commitment. */
  onMakeKey: () => void
  /** Stage 'found' → back to 'name': wrong Passport, no ceremony spent. */
  onBackToName: () => void
  /** The exit: abandon the join and take the choose-a-name journey. */
  onStartFresh: () => void
}

function accountTailOf(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-6)}`
}

export default function JoinDevice(props: JoinDeviceProps) {
  const { networkLabel, state, onLookup, onMakeKey, onBackToName, onStartFresh } = props
  const [typed, setTyped] = useState('')
  const [copied, setCopied] = useState(false)
  const [code, setCode] = useState<{ size: number; path: string } | null>(null)

  /* The same lazy QR drawing as ShowPassport, for the same reason: a
     generator has no business in the first bundle, and the quiet zone is
     drawn INTO the matrix because a camera reads the image, not the CSS. */
  useEffect(() => {
    setCode(null)
    const payload = state.payload
    if (!payload) return undefined
    let live = true
    void import('uqr')
      .then(({ encode }) => {
        if (!live) return
        const matrix = encode(payload, { ecc: 'M', border: 4 })
        let path = ''
        for (let row = 0; row < matrix.size; row += 1) {
          for (let column = 0; column < matrix.size; column += 1) {
            if (matrix.data[row]?.[column]) path += `M${column} ${row}h1v1h-1z`
          }
        }
        setCode({ size: matrix.size, path })
      })
      .catch((cause: unknown) => {
        // The text code below still works; nothing here claims otherwise.
        console.warn('[passport] the join code could not be drawn:', cause)
      })
    return () => {
      live = false
    }
  }, [state.payload])

  const handleCopy = useCallback(() => {
    if (!state.payload) return
    void navigator.clipboard?.writeText(state.payload).then(
      () => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1_600)
      },
      () => undefined,
    )
  }, [state.payload])

  return (
    <section className="mnid-screen">
      <header className="mnid-bar">
        <img className="mnid-wordmark" src="/skunk/mark.svg" alt="Midnight" />
        <span className="mnid-step">Add this device</span>
        <ThemeToggle size="sm" className="mnid-theme" />
      </header>

      <div className="mnid-body">
        <p className="mnid-kicker">Your Passport, on another device</p>

        {state.stage === 'name' ? (
          <>
            <h1 className="mnid-title">Which Passport?</h1>
            <p className="mnid-lede">
              This device just made its own passkey. Name the Passport it should open, and a
              device that already opens it can let this one in.
            </p>
            <form
              className="mnid-panel"
              onSubmit={(event) => {
                event.preventDefault()
                if (!state.busy) onLookup(typed)
              }}
            >
              <label className="mnid-panel-head" htmlFor="mnjoin-name">
                <Search size={16} aria-hidden="true" />
                Your name on {networkLabel}
              </label>
              <div className="mnid-field">
                <input
                  id="mnjoin-name"
                  type="text"
                  inputMode="text"
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  placeholder="yourname"
                  aria-label="Your Midnight name"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={state.busy}
                />
                <span className="mnid-suffix">.night</span>
              </div>
              <div className="mnid-panel-actions">
                <button type="submit" className="mnid-primary" disabled={state.busy}>
                  {state.busy ? 'Asking the registry…' : 'Find my Passport'}
                </button>
              </div>
            </form>
          </>
        ) : state.stage === 'found' ? (
          <>
            <h1 className="mnid-title">{state.domain}</h1>
            <p className="mnid-lede">
              The registry answers: <b>{state.domain}</b> points at account{' '}
              <code>{state.accountAddress ? accountTailOf(state.accountAddress) : ''}</code>
              {state.deviceCount !== null
                ? `, which holds ${state.deviceCount} ${state.deviceCount === 1 ? 'key' : 'keys'} today.`
                : '.'}
            </p>
            <div className="mnid-panel">
              <p className="mnid-panel-head">
                <KeyRound size={16} aria-hidden="true" />
                One ceremony left
              </p>
              <p>
                Confirming with the passkey you just made derives this device&rsquo;s key. Only
                its PUBLIC commitment goes into the code — the key itself never leaves this
                device, and nothing touches the chain until your other device says so.
              </p>
              <div className="mnid-panel-actions">
                <button
                  type="button"
                  className="mnid-primary"
                  onClick={onMakeKey}
                  disabled={state.busy}
                >
                  {state.busy ? 'Waiting for your passkey…' : 'Make this device’s key'}
                </button>
                <button
                  type="button"
                  className="mnid-secondary"
                  onClick={onBackToName}
                  disabled={state.busy}
                >
                  Not this name
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <h1 className="mnid-title">Show this to your other device</h1>
            <p className="mnid-lede">
              On a device that already opens <b>{state.domain}</b>: the <b>Access</b> tab, then{' '}
              <b>Keys</b>, then <b>Admit a device</b> — and scan this code, or paste it as text.
            </p>

            <div className="mnid-panel mnjoin-show">
              {code ? (
                <div className="mnjoin-plate">
                  <svg
                    className="mnjoin-qr"
                    viewBox={`0 0 ${code.size} ${code.size}`}
                    shapeRendering="crispEdges"
                    role="img"
                    aria-label={`Join code for ${state.domain ?? 'your Passport'}`}
                  >
                    <path d={code.path} fill="#000000" />
                  </svg>
                </div>
              ) : null}
              <div className="mnjoin-copyrow">
                <code className="mnjoin-code">{state.payload}</code>
                <button
                  type="button"
                  className="mnid-secondary mnjoin-copy"
                  onClick={handleCopy}
                  aria-label="Copy the join code"
                >
                  {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  {copied ? 'Copied' : 'Copy code'}
                </button>
              </div>
              <p className="mnjoin-note">
                Everything in this code is public — the name, the network, and this
                device&rsquo;s key commitment{state.commitmentTail ? ` (…${state.commitmentTail})` : ''}.
                The key itself stays here.
              </p>
              {state.watchLine ? (
                <p className="mnjoin-watch" role="status" aria-live="polite">
                  {state.watchLine}
                </p>
              ) : null}
            </div>
          </>
        )}

        {state.error ? (
          <p className="mnid-keys-error" role="alert">
            {state.error}
          </p>
        ) : null}

        <div className="mnid-actions" data-toast-clear>
          {/* The exit is the OTHER journey, named as one — never a bare
              "cancel" into a state with no account and no name. */}
          <button type="button" className="mnid-secondary" onClick={onStartFresh}>
            <ArrowRight size={17} aria-hidden="true" />
            Start fresh instead — choose a new name
          </button>
        </div>
      </div>
    </section>
  )
}
