import { useCallback, useState } from 'react'
import { BadgeCheck, ExternalLink, LoaderCircle } from 'lucide-react'

import { useDynamicSession } from '../lib/dynamic.js'
import { shortEvmAddress } from '../lib/dynamicSession.js'
import { recoverSecp256k1Point } from '../lib/k1Recover.js'
import { K256_ENVELOPE_NONE, type K256DeviceIdentity } from '../identity/accountK1.js'
import {
  activateK1Device,
  appendInboxK1,
  deployK1Account,
  recoverK1DevicePoint,
  startK1AccountAgain,
  type K1Phase,
} from '../identity/accountK1Custody.js'
import { k1FailureSentence, K1_SETUP_INTERRUPTED } from '../identity/accountK1Plan.js'
import './k1-milestone.css'

/**
 * The developer milestone for a Dynamic-only Passport, off in every build.
 *
 * WHAT IT IS FOR
 * --------------
 * One screen, four rows, and a person can record it: sign in with a provider,
 * set a Passport up for that sign-in, make the signed-in key the key that
 * approves for it, and then make one approved action the chain verifies. Each
 * row prints the transaction it produced and links it to the explorer, because
 * "it worked" is not a claim anybody can check and a block height is.
 *
 * It is a MILESTONE, not a product surface, and the difference is that every row
 * here is a step somebody is watching rather than a thing somebody wants. A
 * Passport does not ask its holder to activate a key; it activates it. The order
 * is exposed because the order is the evidence.
 *
 * WHAT IT IS NOT
 * --------------
 * Not reachable by accident. `?k1=1` or a build with `VITE_K1_MILESTONE=1`, and
 * nothing else; `main.tsx` holds the switch. Not wired into onboarding, Home, or
 * any existing flow — the passkey Passport is untouched by all of this. And not
 * a place where the key can lose anything: the only approved action offered is
 * the one that moves no value.
 *
 * THE COPY RULE
 * -------------
 * The screen never says wallet address, contract, registry, indexer, resolver,
 * sponsor, or SDK, and never names the fee token. Those are the words this
 * demo's readers have no use for, and a developer surface is not an exemption
 * from that — the recording is the point, and the recording is watched by people
 * who are not us.
 */

type RowId = 'create' | 'activate' | 'call'

interface RowState {
  busy: boolean
  detail: string | null
  txHash: string | null
  explorerUrl: string | null
  error: string | null
}

const IDLE: RowState = { busy: false, detail: null, txHash: null, explorerUrl: null, error: null }

export default function K1Milestone() {
  const session = useDynamicSession()
  const [rows, setRows] = useState<Record<RowId, RowState>>({
    create: IDLE,
    activate: IDLE,
    call: IDLE,
  })
  /* The recovered point, cached for the life of the screen. Recovering it costs
     a signature, so it is asked for once and reused by every row after it. */
  const [device, setDevice] = useState<K256DeviceIdentity | null>(null)
  /* A setup that cannot be finished. The row below turns into the one thing
     that can be done about it, and the two rows after it stop pretending. */
  const [interrupted, setInterrupted] = useState(false)

  const patch = useCallback((id: RowId, next: Partial<RowState>) => {
    setRows((current) => ({ ...current, [id]: { ...current[id], ...next } }))
  }, [])

  const k1Session = useCallback(
    () => ({ address: session.evmAddress as string, signRaw: signRawFor(session.signRaw) }),
    [session.evmAddress, session.signRaw],
  )

  /**
   * The device identity, recovered on first use.
   *
   * ONE SIGNATURE, AND IT IS NOT THE ONE THAT MATTERS. Dynamic hands out an
   * address and nothing else, so the point behind it is recovered from a
   * signature over a digest we chose. Doing it per call would mean a signature
   * before every signature, which is exactly the thing a person would notice.
   */
  const ensureDevice = useCallback(async (): Promise<K256DeviceIdentity> => {
    if (device) return device
    const pk = await recoverK1DevicePoint({
      session: k1Session(),
      recover: recoverSecp256k1Point,
    })
    const identity: K256DeviceIdentity = { arm: 'k256', pk, envelope: K256_ENVELOPE_NONE }
    setDevice(identity)
    return identity
  }, [device, k1Session])

  const run = useCallback(
    async (id: RowId, work: (device: K256DeviceIdentity) => Promise<RunResult>) => {
      patch(id, { busy: true, error: null, txHash: null, explorerUrl: null, detail: null })
      try {
        const identity = await ensureDevice()
        const result = await work(identity)
        patch(id, {
          busy: false,
          txHash: result.txHash,
          explorerUrl: result.explorerUrl,
          detail: null,
        })
      } catch (cause) {
        console.warn('[k1] the milestone step did not finish', cause)
        if (cause instanceof Error && cause.message === K1_SETUP_INTERRUPTED) {
          setInterrupted(true)
        }
        patch(id, { busy: false, detail: null, error: k1FailureSentence(cause) })
      }
    },
    [ensureDevice, patch],
  )

  const onPhase = useCallback(
    (id: RowId) => (phase: K1Phase) => {
      patch(id, { detail: phase.detail ?? PHASE_LABELS[phase.step] })
    },
    [patch],
  )

  if (session.status !== 'signed-in') {
    return (
      <section className="mnk1" aria-label="Dynamic Passport milestone">
        <h2 className="mnk1-title">Dynamic Passport</h2>
        <p className="mnk1-note">
          {session.status === 'loading'
            ? 'Starting sign-in…'
            : 'Sign in with a provider first, then come back to this screen.'}
        </p>
        <button type="button" className="mnk1-button" onClick={session.openAuthFlow}>
          Sign in
        </button>
      </section>
    )
  }

  const ready = Boolean(session.evmAddress)

  return (
    <section className="mnk1" aria-label="Dynamic Passport milestone">
      <h2 className="mnk1-title">Dynamic Passport</h2>

      <p className="mnk1-who">
        <BadgeCheck size={14} aria-hidden="true" />
        <span>
          {session.provider ? `${session.provider} · ` : ''}
          {session.handle ?? 'Signed in'}
        </span>
      </p>
      {session.evmAddress ? (
        <p className="mnk1-addr" title={session.evmAddress}>
          Ethereum address {shortEvmAddress(session.evmAddress)}
        </p>
      ) : (
        <p className="mnk1-addr">Setting up your Ethereum address</p>
      )}

      {/* ONE ROW, TWO MEANINGS, AND THE SECOND ONE IS THE HONEST OFFER. While
          the setup can still be finished this creates or resumes it. Once it
          cannot — the key that signs the remaining steps is gone — pressing it
          again would fail every time, so it throws the half-built one away
          first and starts a fresh one. */}
      <Row
        id="create"
        label={interrupted ? 'Start again' : 'Create my Dynamic Passport'}
        busyLabel={interrupted ? 'Starting again' : 'Creating'}
        state={rows.create}
        disabled={!ready}
        onRun={() =>
          void run('create', async (identity) => {
            if (interrupted) {
              await startK1AccountAgain(k1Session())
              setInterrupted(false)
            }
            return deployK1Account(k1Session(), identity, onPhase('create'))
          })
        }
      />

      <Row
        id="activate"
        label="Activate my Dynamic key"
        busyLabel="Activating"
        state={rows.activate}
        disabled={!ready || interrupted}
        onRun={() =>
          void run('activate', async (identity) =>
            activateK1Device(k1Session(), identity, onPhase('activate')),
          )
        }
      />

      <Row
        id="call"
        label="Sign a test call"
        busyLabel="Signing"
        state={rows.call}
        disabled={!ready || interrupted}
        onRun={() =>
          void run('call', async (identity) =>
            /* 192 bytes of nothing. `append_inbox` releases no value and reads
               no witness, so it exercises the whole approval path with nothing
               at stake if the signature is wrong. */
            appendInboxK1(k1Session(), identity, new Uint8Array(192), onPhase('call')),
          )
        }
      />
    </section>
  )
}

interface RunResult {
  txHash: string | null
  explorerUrl: string | null
}

const PHASE_LABELS: Record<K1Phase['step'], string> = {
  wallet: 'Getting ready',
  deploy: 'Creating',
  waves: 'Finishing setup',
  activate: 'Activating',
  sign: 'Waiting for your approval',
  submit: 'Sending',
  confirm: 'Confirming',
}

function Row(props: {
  id: RowId
  label: string
  busyLabel: string
  state: RowState
  disabled: boolean
  onRun: () => void
}) {
  const { state } = props
  return (
    <div className="mnk1-row">
      <button
        type="button"
        className="mnk1-button"
        onClick={props.onRun}
        disabled={props.disabled || state.busy}
      >
        {state.busy ? (
          <LoaderCircle size={14} className="mnk1-spin" aria-hidden="true" />
        ) : null}
        <span>{state.busy ? (state.detail ?? props.busyLabel) : props.label}</span>
      </button>

      {state.error ? (
        <p className="mnk1-note mnk1-note-error" role="alert">
          {state.error}
        </p>
      ) : null}

      {state.txHash ? (
        <p className="mnk1-tx">
          {state.explorerUrl ? (
            <a href={state.explorerUrl} target="_blank" rel="noreferrer">
              <span className="mnk1-hash">{state.txHash}</span>
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          ) : (
            <span className="mnk1-hash">{state.txHash}</span>
          )}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Adapts the session's `signRaw(hex)` to the two-field shape the custody layer
 * takes.
 *
 * The custody layer deliberately does not know the vendor's argument names, so
 * the address it is handed back is ignored here: the bridge already closes over
 * the wallet it is signing with, and letting a caller name a different one would
 * be a way to ask the wrong key for a signature.
 */
function signRawFor(signRaw: (digestHex: string) => Promise<string>) {
  return async (input: { accountAddress: string; message: string }) => signRaw(input.message)
}
