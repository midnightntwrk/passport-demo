import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, BadgeCheck, Copy, Loader2, RefreshCw, Search, ShieldCheck } from 'lucide-react'

import { useDynamicSession } from '../lib/dynamic.js'

import { recoverSecp256k1Point } from '../lib/custodyRecover.js'
import { normaliseNameForRecovery, type NameRecoveryOutcome } from '../lib/nameRecovery.js'
import { parseEndpointList } from '../lib/endpoints.js'
import { K256_ENVELOPE_NONE, k256Challenges, type K256DeviceIdentity } from '../identity/custodyContractSigning.js'
import {
  activateK1Device,
  defaultCustodyDeps,
  deployCustodyAccount,
  k1Call,
  recoverK1DevicePoint,
  startCustodyAccountAgain,
  type CustodyDynamicSession,
  type CustodyPhase,
} from '../identity/custodyContractClient.js'
import {
  hexToBytes,
  custodyFailureSentence,
  nextCustodyStep,
  resolveCustodyUseCounter,
  saveCustodyRecord,
  CUSTODY_SETUP_INTERRUPTED,
  type CustodyAccountRecord,
} from '../identity/custodyContractPlan.js'
import {
  choosePassportIdentity,
  dynamicSetupAction,
  dynamicSetupCopy,
  dynamicSetupInterrupted,
  dynamicSetupPhase,
  dynamicUserKey,
  k1PrivateStateId,
  custodyRecoveryOutcome,
  readDynamicPassport,
  recoveredCustodyRecord,
  saveCustodyName,
  type DynamicPassportView,
} from '../identity/custodyContractSession.js'
import {
  custodyApprovalPrompt,
  custodySendRefusal,
  custodyUnshieldedBalance,
  planCustodySend,
  shieldedSendRefusal,
  type CustodyUnshieldedLedger,
} from '../identity/custodyContractSend.js'
import ThemeToggle from './ThemeToggle'
import './onboarding.css'
import './dynamic-passport.css'

/**
 * A PASSPORT HELD BY A SOCIAL SIGN-IN, end to end.
 *
 * WHAT IT IS
 * ----------
 * The whole of the Dynamic-only path from `docs/demo/dynamic-build-out-plan.md`
 * §6: sign in with Google, Discord, Microsoft, or X; get a Passport set up for
 * that sign-in with the signed-in key as the key that approves for it; claim a
 * `.night` name; and pay somebody. No passkey is made and none is asked for.
 *
 * WHY IT IS ONE SCREEN AND NOT A BRANCH THROUGH `App.tsx`
 * -------------------------------------------------------
 * `App.tsx` is nine and a half thousand lines of a flow whose every state is
 * downstream of one thing: a passkey profile. `profile` gates the wallet, the
 * wallet gates `localSessionActive`, that gates the account address, and that
 * gates Home, Send, and the name step. Threading a second identity through all
 * of it would mean touching each of those gates, and every one of them is a
 * place an existing Passport could be broken by a mistake nobody would see
 * until a reviewer met it.
 *
 * So this is a screen with its own state, reached by ONE branch at the top of
 * that ladder. With no Dynamic session the branch is false and `App.tsx`
 * renders exactly what it renders today — which is the property the 89 mocked
 * specs hold us to, and the reason the flag-off build is untouched.
 *
 * THE COPY RULE
 * -------------
 * The words wallet address, DUST, contract, registry, indexer, resolver,
 * sponsor, and SDK do not appear on this screen, and neither does the name of
 * the fee token. Nor does "Dynamic": the reader chose Google, not a vendor, so
 * the approval prompt names the provider they recognise
 * ({@link custodyApprovalPrompt}).
 *
 * WHAT IS NOT BUILT YET, AND SAYS SO
 * ----------------------------------
 * Sending a shielded balance from one of these Passports needs the coin store
 * (`docs/demo/account-custody-layer-design.md` §3), so the shielded row is shown
 * with one sentence rather than a control that would fail. And the service that
 * finishes each step — `POST /prove-account-custody` on the balancer — is not deployed yet,
 * so a live run stops at the first of them with one plain sentence. Both are
 * deliberate: a surface that hides what it cannot do teaches its reader that
 * the things it does show are also approximate.
 */

/** The `.night` registry networks this build can claim on. */
const FUNDER_URLS = parseEndpointList(
  (import.meta.env as Record<string, string | undefined>).VITE_FUNDER_URL,
)

/** What the screen is doing right now, for the one busy line it shows. */
const PHASE_LABELS: Record<CustodyPhase['step'], string> = {
  wallet: 'Opening your Passport',
  deploy: 'Setting up your Passport',
  waves: 'Finishing your Passport',
  activate: 'Turning on your sign-in',
  sign: 'Waiting for your approval',
  submit: 'Sending',
  confirm: 'Confirming',
}

export interface DynamicPassportProps {
  /** The network this build transacts on. */
  network: string
}

type Screen = 'create' | 'name' | 'home' | 'recover'

export default function DynamicPassport({ network }: DynamicPassportProps) {
  const session = useDynamicSession()
  const user = dynamicUserKey(session.evmAddress)

  const [view, setView] = useState<DynamicPassportView | null>(null)
  const [screen, setScreen] = useState<Screen | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [balance, setBalance] = useState<bigint | null>(null)
  const [balanceFailed, setBalanceFailed] = useState(false)
  const [receivingAddress, setReceivingAddress] = useState<string | null>(null)
  /* A setup whose remaining steps can never be signed. The offer below turns
     into the one thing that can be done about it.

     READ FROM THE RECORD, not learnt from a failure. It starts false only
     because there is nothing read yet; `refresh` below settles it on the first
     pass, so a reload onto an interrupted setup offers "Start again" straight
     away rather than offering to create a Passport and throwing
     `CUSTODY_SETUP_INTERRUPTED` at whoever pressed it. */
  const [interrupted, setInterrupted] = useState(false)
  const device = useRef<K256DeviceIdentity | null>(null)

  /** Re-reads what is stored and moves the screen to match it. */
  const refresh = useCallback((): DynamicPassportView | null => {
    if (user === null) return null
    const next = readDynamicPassport({ storage: window.localStorage, user, network })
    setView(next)
    setInterrupted(dynamicSetupInterrupted(next.record))
    setScreen(next.stage === 'home' ? 'home' : next.stage === 'name' ? 'name' : 'create')
    return next
  }, [network, user])

  useEffect(() => {
    if (user === null) {
      setView(null)
      setScreen(null)
      return
    }
    refresh()
  }, [refresh, user])

  /**
   * The key that approves, recovered once.
   *
   * ONE SIGNATURE, AND IT IS NOT THE ONE THAT MATTERS: the sign-in hands out an
   * address and nothing else, so the point behind it is recovered from a
   * signature over a digest Passport chose. Doing it per call would mean an
   * approval before every approval, which is the thing a person would notice.
   */
  const ensureDevice = useCallback(async (): Promise<K256DeviceIdentity> => {
    if (device.current) return device.current
    const pk = await recoverK1DevicePoint({
      session: custodySession(session),
      recover: recoverSecp256k1Point,
    })
    const identity: K256DeviceIdentity = { arm: 'k256', pk, envelope: K256_ENVELOPE_NONE }
    device.current = identity
    return identity
  }, [session])

  /**
   * Runs one piece of work with the single busy line and the single sentence.
   *
   * THE SENTENCE IS NOT THE CAUSE. Every refusal this path throws on purpose is
   * one plain sentence written for the person reading it, and painting
   * `cause.message` verbatim works right up to the first cause that comes from
   * a vendor, a WASM deserialiser, or a node — at which point this screen shows
   * a stack-shaped string carrying exactly the words the demo keeps off it.
   * {@link custodyFailureSentence} paints a message only while it still reads like
   * something we wrote; the cause itself goes to the console, where it is of
   * use to somebody.
   */
  const run = useCallback(
    async (label: string, work: () => Promise<void>): Promise<void> => {
      setBusy(label)
      setError(null)
      try {
        await work()
      } catch (cause) {
        console.warn('[account-custody] that step did not finish', cause)
        if (cause instanceof Error && cause.message === CUSTODY_SETUP_INTERRUPTED) {
          setInterrupted(true)
        }
        setError(custodyFailureSentence(cause))
      } finally {
        setBusy(null)
      }
    },
    [],
  )

  /* ---------------------------------------------------------------------- */
  /* Making one                                                             */
  /* ---------------------------------------------------------------------- */

  const createPassport = useCallback(() => {
    /* The BUTTON says what is happening; the line under it says how far along
       that is. Putting the counted sentence on both would be the same words
       twice, which reads as a stutter rather than as progress. */
    void run(PHASE_LABELS.deploy, async () => {
      /* An interrupted setup is thrown away first, so this press deploys a
         fresh Passport rather than pressing the same broken step again. The
         account already on chain is left where it is: it is dormant, it holds
         nothing, and there is no transaction that would tidy it away. */
      if (interrupted) {
        await startCustodyAccountAgain(custodySession(session))
        setInterrupted(false)
      }
      const identity = await ensureDevice()
      const onPhase = (phase: CustodyPhase) => {
        setBusy(phase.detail ? `${PHASE_LABELS[phase.step]}` : PHASE_LABELS[phase.step])
      }
      /* Both halves are resumable and both check the chain before they act, so
         running them one after the other is safe on a second press: whatever
         already landed is skipped rather than replayed. */
      let record = (await deployCustodyAccount(custodySession(session), identity, onPhase)).record
      if (!record.activated) {
        record = (await activateK1Device(custodySession(session), identity, onPhase)).record
      }
      refresh()
    })
  }, [ensureDevice, interrupted, refresh, run, session])

  /* ---------------------------------------------------------------------- */
  /* The name                                                               */
  /* ---------------------------------------------------------------------- */

  const claimName = useCallback(
    (alias: string) => {
      void run('Choosing your name', async () => {
        const address = view?.record?.address ?? null
        if (user === null || address === null) {
          throw new Error('Your Passport is still being set up. Try again once it is ready.')
        }
        const [{ deriveMidnamesOwnerKey }, { sponsorAliasRegistrationAcross }, deps] =
          await Promise.all([
            import('../identity/midnames.js'),
            import('../identity/sponsoredAlias.js'),
            Promise.resolve(defaultCustodyDeps()),
          ])
        /* The name's owner secret comes from this device's own transaction key
           rather than from anything the sign-in holds, because the sign-in holds
           nothing a key can be derived from — its signatures carry fresh
           randomness every time (DKLs23), so there is nothing deterministic to
           hash. The consequence is written down in `dynamic-integration.md`:
           the name can be claimed here and cannot be re-pointed from a second
           device in this version. Coming back to the Passport does not need it.
           */
        const { custodyWalletSeed } = await import('../identity/custodyContractClient.js')
        const ownerKey = await deriveMidnamesOwnerKey(custodyWalletSeed(deps, user))
        await sponsorAliasRegistrationAcross(FUNDER_URLS, {
          alias,
          ownerKey,
          contractAddress: address,
          network: network as 'stagenet',
        })
        saveCustodyName(window.localStorage, user, network, alias)
        refresh()
      })
    },
    [network, refresh, run, user, view],
  )

  /* ---------------------------------------------------------------------- */
  /* What the Passport holds                                                */
  /* ---------------------------------------------------------------------- */

  const readBalance = useCallback(async (): Promise<void> => {
    const record = view?.record ?? null
    if (user === null || record?.address == null) return
    setBalanceFailed(false)
    try {
      const deps = defaultCustodyDeps()
      const [wallet, contractModule] = await Promise.all([
        deps.wallet(user),
        deps.contractModule(),
      ])
      setReceivingAddress(wallet.unshieldedAddress)
      const providers = await deps.providers(wallet, record.privateStateId)
      const reader = providers.publicDataProvider as {
        queryContractState(address: string): Promise<{ data: unknown } | null>
      }
      const state = await reader.queryContractState(record.address)
      if (!state) throw new Error('unreadable')
      const { nightColourBytes } = await import('../identity/accountCustody.js')
      /* `.data`, not the whole state. A compiled build's `ledger()` takes the
         StateValue; handing it the ContractState decodes nothing. Same call
         `readAccountState` makes for the prototype build, and the same one the
         sponsor makes for this one. */
      const ledger = contractModule.ledger(state.data) as unknown as CustodyUnshieldedLedger
      setBalance(custodyUnshieldedBalance(ledger, nightColourBytes()))
    } catch (cause) {
      console.warn('[account-custody] could not read this Passport', cause)
      setBalanceFailed(true)
    }
  }, [user, view])

  useEffect(() => {
    if (screen !== 'home') return
    void readBalance()
  }, [readBalance, screen])

  /* ---------------------------------------------------------------------- */
  /* Paying somebody                                                        */
  /* ---------------------------------------------------------------------- */

  const sendToName = useCallback(
    (typed: string, amountText: string) => {
      void run('Checking that name', async () => {
        const record = view?.record ?? null
        if (user === null || record === null) {
          throw new Error('Your Passport is still being set up. Try again once it is ready.')
        }
        const label = normaliseNameForRecovery(typed)
        if (label.length === 0) throw new Error('Type the name you want to pay.')
        const amount = parseAmount(amountText)

        const [{ resolveAliasTarget }, { accountModuleFor, nightColourHex, nightColourBytes }] =
          await Promise.all([
            import('../identity/midnames.js'),
            import('../identity/accountCustody.js'),
          ])
        const resolved = await resolveAliasTarget(network as 'stagenet', label)
        if (!resolved || resolved.target.kind !== 'contract') {
          throw new Error('No Passport is registered under that name.')
        }
        const deps = defaultCustodyDeps()
        const wallet = await deps.wallet(user)
        const ownReceivingAddress = wallet.unshieldedAddress
        setReceivingAddress(ownReceivingAddress)
        const recipientModule = await accountModuleFor(
          { indexerHttpUrl: wallet.network.indexerHttpUrl },
          resolved.target.hex,
        )

        const input = {
          record,
          colourHex: nightColourHex(),
          amount,
          ownReceivingAddress,
          recipientAccountAddress: resolved.target.hex,
          recipientModule,
          heldBalance: balance,
        }
        const refusal = custodySendRefusal(input)
        if (refusal !== null) throw new Error(refusal)
        const plan = planCustodySend(input)

        /* LEG ONE — gated, and the only thing the holder approves. */
        setBusy(custodyApprovalPrompt(session.provider))
        const identity = await ensureDevice()
        const colour = nightColourBytes()
        const recipientBytes = await unshieldedRecipientBytes(
          plan.withdraw.recipientAddress,
          wallet.network.networkId,
        )
        await k1Call(
          custodySession(session),
          identity,
          {
            operation: 'withdraw_unshielded',
            args: [colour, plan.withdraw.amount, { bytes: recipientBytes }],
            challenge: (pure, context, pk) =>
              k256Challenges.withdrawUnshielded(
                pure,
                context,
                pk,
                colour,
                plan.withdraw.amount,
                recipientBytes,
              ),
          },
          (phase) => setBusy(PHASE_LABELS[phase.step]),
        )

        /* LEG TWO — permissionless. Nothing signs it, and which circuit it is
           was decided by the chain's answer about the recipient. */
        setBusy('Paying ' + label)
        if (plan.deposit.circuit === 'deposit_night') {
          const { depositNight } = await import('../identity/accountCustody.js')
          await depositNight(wallet, {
            contractAddress: plan.deposit.contractAddress,
            colourHex: plan.deposit.colourHex,
            amount: plan.deposit.amount,
          })
        } else {
          /* Paying ANOTHER Dynamic Passport needs `deposit_unshielded`, and the
             connection that would carry it is owned by the inbox change landing
             beside this one. One sentence rather than a call that would fail
             three files away. */
          throw new Error(
            `${label} holds the same kind of Passport as you, and paying one of those is not built yet.`,
          )
        }
        await readBalance()
      })
    },
    [balance, ensureDevice, network, readBalance, run, session, user, view],
  )

  /* ---------------------------------------------------------------------- */
  /* Coming back on a new device                                            */
  /* ---------------------------------------------------------------------- */

  const findByName = useCallback(
    async (typed: string): Promise<NameRecoveryOutcome> => {
      if (user === null) {
        return { kind: 'unreachable', detail: 'Your sign-in is still starting up.' }
      }
      const label = normaliseNameForRecovery(typed)
      const [{ resolveAliasTarget }, { readAccountOperations }] = await Promise.all([
        import('../identity/midnames.js'),
        import('../identity/passportContract.js'),
      ])
      let resolved: Awaited<ReturnType<typeof resolveAliasTarget>>
      try {
        resolved = await resolveAliasTarget(network as 'stagenet', label)
      } catch (cause) {
        return {
          kind: 'unreachable',
          detail: cause instanceof Error ? cause.message : String(cause),
        }
      }
      if (!resolved) return { kind: 'unknown' }
      if (resolved.target.kind !== 'contract') return { kind: 'not-yours' }

      const address = resolved.target.hex
      let operations: readonly string[] | null = null
      let holdsDevice: boolean | null = null
      let pk: K256DeviceIdentity['pk'] | null = null
      try {
        const deps = defaultCustodyDeps()
        const wallet = await deps.wallet(user)
        operations = await readAccountOperations(wallet.network.indexerHttpUrl, address)
        if (operations !== null) {
          const identity = await ensureDevice()
          pk = identity.pk
          const [contractModule, providers] = await Promise.all([
            deps.contractModule(),
            deps.providers(wallet, k1PrivateStateId(user)),
          ])
          const reader = providers.publicDataProvider as {
            queryContractState(a: string): Promise<{ data: unknown } | null>
          }
          const state = await reader.queryContractState(address)
          if (state) {
            const ledger = contractModule.ledger(state.data)
            const { deviceEntry } = await import('../identity/custodyContractSigning.js')
            /* THE SAME SCAN A CALL DOES, and for the same reason. The ledger
               stores no counter — it stores opaque entries — and a device's
               entry ROLLS FORWARD every time it approves something: the entry
               is consumed and the next one inserted. Asking only about counter
               0 therefore recognises a Passport that has never been used and
               fails to recognise one that has, which is every Passport a
               person would actually be coming back to. `resolveCustodyUseCounter`
               probes the series the way `k1Call` does and refuses at the same
               rescan limit; the refusal is caught below and reads as "this
               name is not yours", which is what it means here. */
            try {
              resolveCustodyUseCounter({
                entryAt: (counter) =>
                  deviceEntry(
                    contractModule.pureCircuits,
                    identity,
                    hexToBytes(address),
                    ledger.device_epoch,
                    counter,
                  ),
                isMember: (entry) => ledger.devices.member(entry),
              })
              holdsDevice = true
            } catch {
              holdsDevice = false
            }
          }
        }
      } catch (cause) {
        console.warn('[account-custody] could not check that name', cause)
      }

      const outcome = custodyRecoveryOutcome(resolved, { operations, holdsDevice })
      if (outcome.kind !== 'found' || pk === null) return outcome
      const restored: CustodyAccountRecord = recoveredCustodyRecord({
        user,
        network,
        address,
        privateStateId: k1PrivateStateId(user),
        pkXHex: pk.x.toString(16),
        pkYHex: pk.y.toString(16),
      })
      saveCustodyRecord(window.localStorage, restored)
      saveCustodyName(window.localStorage, user, network, label)
      refresh()
      return outcome
    },
    [ensureDevice, network, refresh, user],
  )

  /* ---------------------------------------------------------------------- */
  /* What is on screen                                                      */
  /* ---------------------------------------------------------------------- */

  if (
    choosePassportIdentity({
      hasPasskeyProfile: false,
      dynamicStatus: session.status,
      evmAddress: session.evmAddress,
    }) !== 'dynamic'
  ) {
    return (
      <Shell label="Passport">
        <p className="mnob-lede">Getting your Passport ready…</p>
      </Shell>
    )
  }

  const who = session.handle ?? 'your account'
  const via = session.provider ?? 'your sign-in'

  if (screen === 'recover') {
    return (
      <RecoverStep
        provider={via}
        onFind={findByName}
        onBack={() => setScreen(view?.stage === 'home' ? 'home' : 'create')}
      />
    )
  }

  if (screen === 'name') {
    return (
      <NameStep
        busy={busy}
        error={error}
        onClaim={claimName}
        onSkip={() => setScreen('home')}
      />
    )
  }

  if (screen === 'home') {
    return (
      <HomeStep
        provider={via}
        handle={who}
        name={view?.name ?? null}
        address={view?.address ?? null}
        receivingAddress={receivingAddress}
        balance={balance}
        balanceFailed={balanceFailed}
        busy={busy}
        error={error}
        onRefresh={() => void readBalance()}
        onSend={sendToName}
        onDismissError={() => setError(null)}
      />
    )
  }

  const phase = dynamicSetupPhase(view?.record ?? null)
  return (
    <Shell label="Passport">
      <p className="mnob-kicker">Signed in with {via}</p>
      <h1 className="mnob-title">
        <span>Set up</span>
        <span>your Passport</span>
      </h1>
      <p className="mnob-lede">
        {who} is all Passport needs. Nothing else to remember, and nothing to install — the same
        sign-in brings your Passport back on any device.
      </p>

      <div className="mndyn-actions">
        <button
          type="button"
          className="mnob-primary"
          onClick={createPassport}
          disabled={busy !== null}
        >
          <span className="mnob-primary-copy">
            {busy !== null ? (
              <Loader2 className="mnob-working-spinner" size={17} strokeWidth={2} aria-hidden="true" />
            ) : (
              <ShieldCheck size={17} strokeWidth={2} aria-hidden="true" />
            )}
            {busy ?? dynamicSetupAction(view?.record ?? null)}
          </span>
          <ArrowRight size={17} strokeWidth={2.2} aria-hidden="true" />
        </button>

        <p className="mnob-hint" role="status">
          {busy !== null || (view?.record && nextCustodyStep(view.record) !== 'ready')
            ? dynamicSetupCopy(phase)
            : 'Setting your Passport up is paid for on your behalf.'}
        </p>

        {error ? (
          <div className="mnob-unusable" role="alert">
            <p className="mnob-unusable-copy">{error}</p>
          </div>
        ) : null}

        <button
          type="button"
          className="mnob-alt"
          onClick={() => setScreen('recover')}
          disabled={busy !== null}
        >
          I already have a Passport
        </button>
      </div>
    </Shell>
  )
}

/* -------------------------------------------------------------------------- */
/* The steps                                                                  */
/* -------------------------------------------------------------------------- */

function Shell(props: { label: string; children: React.ReactNode }) {
  return (
    <section className="mnob-screen mndyn">
      <header className="mnob-bar">
        <img className="mnob-wordmark" src="/midnight-wordmark.svg" alt="Midnight" />
        <span className="mnob-bar-label">{props.label}</span>
        <ThemeToggle size="sm" className="mnob-theme" />
      </header>
      <div className="mnob-body">{props.children}</div>
      <footer className="mnob-foot">
        <span>Test network demo — not production</span>
      </footer>
    </section>
  )
}

function NameStep(props: {
  busy: string | null
  error: string | null
  onClaim: (alias: string) => void
  onSkip: () => void
}) {
  const [name, setName] = useState('')
  const trimmed = normaliseNameForRecovery(name)
  return (
    <Shell label="Passport">
      <p className="mnob-kicker">Your Passport is ready</p>
      <h1 className="mnob-title">
        <span>Choose</span>
        <span>your name</span>
      </h1>
      <p className="mnob-lede">
        Pick a name people can send to, instead of a long string they have to copy carefully.
      </p>
      <form
        className="mnob-stage"
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          if (props.busy === null && trimmed) props.onClaim(trimmed)
        }}
      >
        <label className="mnob-hint" htmlFor="dynamic-name">
          Your name
        </label>
        <input
          id="dynamic-name"
          className="mnob-input"
          type="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="alice"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={props.busy !== null}
        />
        {props.error ? (
          <div className="mnob-unusable" role="alert">
            <p className="mnob-unusable-copy">{props.error}</p>
          </div>
        ) : null}
        <button type="submit" className="mnob-primary" disabled={props.busy !== null || !trimmed}>
          <span className="mnob-primary-copy">
            {props.busy !== null ? (
              <Loader2 className="mnob-working-spinner" size={17} strokeWidth={2} aria-hidden="true" />
            ) : (
              <BadgeCheck size={17} strokeWidth={2} aria-hidden="true" />
            )}
            {props.busy ?? 'Claim my name'}
          </span>
          <ArrowRight size={17} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <p className="mnob-hint">Claiming a name is paid for on your behalf.</p>
        <button
          type="button"
          className="mnob-alt"
          onClick={props.onSkip}
          disabled={props.busy !== null}
        >
          Choose one later
        </button>
      </form>
    </Shell>
  )
}

function RecoverStep(props: {
  provider: string
  onFind: (name: string) => Promise<NameRecoveryOutcome>
  onBack: () => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const trimmed = normaliseNameForRecovery(name)
  return (
    <Shell label="Passport">
      <p className="mnob-kicker">Already have a Passport</p>
      <h1 className="mnob-title">
        <span>Find it</span>
        <span>by its name</span>
      </h1>
      <p className="mnob-lede">
        Type the <code>.night</code> name you already hold. Passport will check with Midnight that
        your {props.provider} sign-in is part of it before bringing anything back.
      </p>
      <form
        className="mnob-stage"
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          if (busy || !trimmed) return
          setBusy(true)
          setMessage(null)
          void props
            .onFind(trimmed)
            .then((outcome) => setMessage(recoveryMessage(outcome, props.provider)))
            .catch((cause: unknown) =>
              setMessage(
                cause instanceof Error
                  ? cause.message
                  : 'That name could not be checked just now. Try again in a moment.',
              ),
            )
            .finally(() => setBusy(false))
        }}
      >
        <label className="mnob-hint" htmlFor="dynamic-recover">
          Your name
        </label>
        <input
          id="dynamic-recover"
          className="mnob-input"
          type="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="alice"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={busy}
        />
        {message ? (
          <div className="mnob-unusable" role="alert">
            <p className="mnob-unusable-copy">{message}</p>
          </div>
        ) : null}
        <button type="submit" className="mnob-primary" disabled={busy || !trimmed}>
          <span className="mnob-primary-copy">
            {busy ? (
              <Loader2 className="mnob-working-spinner" size={17} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Search size={17} strokeWidth={2} aria-hidden="true" />
            )}
            {busy ? 'Checking with Midnight' : 'Find my Passport'}
          </span>
          <ArrowRight size={17} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <p className="mnob-hint">
          <ShieldCheck size={14} strokeWidth={2} aria-hidden="true" /> Knowing the name is not enough
          on its own.
        </p>
        <button type="button" className="mnob-alt" onClick={props.onBack} disabled={busy}>
          Go back
        </button>
      </form>
    </Shell>
  )
}

function HomeStep(props: {
  provider: string
  handle: string
  name: string | null
  address: string | null
  receivingAddress: string | null
  balance: bigint | null
  balanceFailed: boolean
  busy: string | null
  error: string | null
  onRefresh: () => void
  onSend: (name: string, amount: string) => void
  onDismissError: () => void
}) {
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const payable = props.name ?? props.address ?? null

  return (
    <Shell label="Passport">
      <p className="mnob-kicker">
        <BadgeCheck size={13} aria-hidden="true" /> {props.provider} · {props.handle}
      </p>
      <h1 className="mnob-title">
        <span>{props.name ? `${props.name}.night` : 'Your Passport'}</span>
      </h1>

      <div className="mndyn-balance" aria-label="What your Passport holds">
        <span className="mndyn-balance-figure">
          {props.balance === null
            ? props.balanceFailed
              ? 'Unavailable'
              : '—'
            : formatNight(props.balance)}
        </span>
        <span className="mndyn-balance-unit">NIGHT</span>
        <button type="button" className="mndyn-icon" onClick={props.onRefresh} aria-label="Refresh">
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </div>
      <p className="mnob-hint">{shieldedSendRefusal('mUSD')}</p>

      {payable ? (
        <div className="mndyn-receive">
          <span className="mnob-hint">People can pay you at</span>
          <code className="mndyn-code">{props.name ? `${props.name}.night` : shortHex(payable)}</code>
          <button
            type="button"
            className="mndyn-icon"
            onClick={() => void navigator.clipboard?.writeText(payable)}
            aria-label="Copy"
          >
            <Copy size={14} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <form
        className="mnob-stage"
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          if (props.busy === null) props.onSend(recipient, amount)
        }}
      >
        <label className="mnob-hint" htmlFor="dynamic-send-to">
          Send to
        </label>
        <input
          id="dynamic-send-to"
          className="mnob-input"
          type="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="alice"
          value={recipient}
          onChange={(event) => setRecipient(event.target.value)}
          disabled={props.busy !== null}
        />
        <label className="mnob-hint" htmlFor="dynamic-send-amount">
          Amount
        </label>
        <input
          id="dynamic-send-amount"
          className="mnob-input"
          type="text"
          inputMode="decimal"
          placeholder="1"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          disabled={props.busy !== null}
        />
        {props.error ? (
          <div className="mnob-unusable" role="alert">
            <p className="mnob-unusable-copy">{props.error}</p>
            <button type="button" className="mnob-alt" onClick={props.onDismissError}>
              Dismiss
            </button>
          </div>
        ) : null}
        <button
          type="submit"
          className="mnob-primary"
          disabled={props.busy !== null || recipient.trim().length === 0}
        >
          <span className="mnob-primary-copy">
            {props.busy !== null ? (
              <Loader2 className="mnob-working-spinner" size={17} strokeWidth={2} aria-hidden="true" />
            ) : (
              <ArrowRight size={17} strokeWidth={2} aria-hidden="true" />
            )}
            {props.busy ?? 'Send'}
          </span>
          <ArrowRight size={17} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </form>
    </Shell>
  )
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The two-field session the custody layer takes.
 *
 * The address it is handed back by a caller is ignored on purpose: the bridge
 * already closes over the key it signs with, and letting a caller name another
 * would be a way to ask the wrong one for an approval.
 */
function custodySession(session: {
  evmAddress: string | null
  signRaw: (digestHex: string) => Promise<string>
}): CustodyDynamicSession {
  return {
    address: session.evmAddress ?? '',
    signRaw: async (input: { accountAddress: string; message: string }) =>
      session.signRaw(input.message),
  }
}

/** The one place the recovery answers become sentences on this path. */
function recoveryMessage(outcome: NameRecoveryOutcome, provider: string): string | null {
  if (outcome.kind === 'found') return null
  if (outcome.kind === 'unknown') {
    return 'No Passport is registered under that name. Check the spelling, or go back and set a new one up.'
  }
  if (outcome.kind === 'not-yours') {
    return `That name belongs to a Passport your ${provider} sign-in is not part of. If you have more than one sign-in, go back and use the other one.`
  }
  return outcome.detail
}

/** NIGHT's atomic units, as a figure a person reads. Six decimal places. */
export function formatNight(atomic: bigint): string {
  const whole = atomic / 1_000_000n
  const fraction = (atomic % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString()
}

/** A typed amount as atomic units, or a throw with a sentence. */
export function parseAmount(typed: string): bigint {
  const trimmed = typed.trim()
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) throw new Error('Enter an amount like 1 or 1.5.')
  const [whole, fraction = ''] = trimmed.split('.')
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
}

/** Enough of a 32-byte address to compare by eye, never all of it. */
function shortHex(value: string): string {
  return value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`
}

/**
 * The 32 bytes `withdraw_unshielded` takes as its recipient.
 *
 * `unshieldedAddressBytes` checks the address really belongs to the network the
 * wallet is on, which is the check that stops a stagenet payment being sent to
 * a mainnet-shaped address and vanishing.
 */
async function unshieldedRecipientBytes(address: string, networkId: string): Promise<Uint8Array> {
  const { unshieldedAddressBytes } = await import('../identity/accountCustody.js')
  return unshieldedAddressBytes(address, networkId)
}
