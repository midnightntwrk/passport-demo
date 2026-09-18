import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, BadgeCheck, Copy, Loader2, RefreshCw, Search, ShieldCheck } from 'lucide-react'

import { normaliseNameForRecovery, type NameRecoveryOutcome } from '../lib/nameRecovery.js'
import type { CustodyArm, CustodyIdentity } from '../lib/custodyArm.js'
import { parseEndpointList } from '../lib/endpoints.js'
import { k256Challenges, type K256DeviceIdentity } from '../identity/custodyContractSigning.js'
import {
  activateK1Device,
  appendChangeToInboxK1,
  defaultCustodyDeps,
  deployCustodyAccount,
  k1Call,
  startCustodyAccountAgain,
  withdrawShieldedK1,
  withdrawShieldedToContractK1,
  type CustodyCallDevice,
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
  dynamicSetupAction,
  dynamicSetupCopy,
  dynamicSetupInterrupted,
  dynamicSetupPhase,
  k1PrivateStateId,
  custodyRecoveryOutcome,
  readDynamicPassport,
  recoveredCustodyRecord,
  saveCustodyName,
  type DynamicPassportView,
} from '../identity/custodyContractSession.js'
import {
  clearCustodyShieldedSend,
  custodySendRefusal,
  custodyShieldedAddressSendRefusal,
  custodyShieldedSendOutcome,
  custodyShieldedSendRefusal,
  custodyUnshieldedBalance,
  loadCustodyShieldedSend,
  newCustodyShieldedSend,
  planCustodySend,
  planCustodyShieldedAddressSend,
  planCustodyShieldedSend,
  saveCustodyShieldedSend,
  type CustodyChangeCoin,
  type CustodyShieldedSendRecord,
  type CustodyUnshieldedLedger,
} from '../identity/custodyContractSend.js'
import {
  custodyActionHistoryQuery,
  custodyActionRowsFrom,
  custodyTxIdForInboxIndex,
} from '../identity/custodyInboxIndex.js'
import { NIGHT_COLOUR_HEX } from '../lib/colour.js'
import {
  custodyAmountFigure,
  custodyArrivingSentence,
  custodyAssetRows,
  custodyResumeOffer,
  custodyStablecoinColour,
  parseCustodyAmount,
  type CustodyAssetRow,
} from '../lib/custodyAssets.js'
import {
  custodyArrivingCount,
  custodyInFlightRefusal,
  custodyMayReadHoldings,
  custodyUnplacedDeliveries,
  runCustodyWork,
} from '../lib/custodyScreenRules.js'
import type { PassportContractName } from '../identity/contractRuntime.js'
import type { LocalMidnightWallet } from '../lib/localWallet.js'
import ThemeToggle from './ThemeToggle'
import './onboarding.css'
import './dynamic-passport.css'

/**
 * A PASSPORT ON THE ACCOUNT CUSTODY CONTRACT, end to end, for EITHER ARM.
 *
 * WHAT IT IS
 * ----------
 * Set a Passport up in waves on Nicolas's account custody contract, activate
 * the key that approves for it, claim a `.night` name, show what it holds, come
 * back to it by name on another device, and pay somebody. The contract is the
 * same and every one of those steps is the same whoever is holding the
 * Passport; what differs is only the key, and that difference is an ARM.
 *
 * A PASSKEY holds a JubJub scalar derived from its own PRF output. There is no
 * vendor: the signer is built once from the contract root a single assertion
 * produces and signs synchronously, and the Passport is named by its own device
 * point, which is the same value on every device the passkey syncs to.
 *
 * A SOCIAL SIGN-IN holds a secp256k1 key inside a vendor. The point is
 * recovered from two signatures, every approval is a round trip, and the
 * Passport is named by the embedded address.
 *
 * `../lib/custodyArm.ts` is that difference and nothing else. This screen asks
 * it for a device and a name, and asks the custody layer for everything else —
 * which is why the passkey arm cost an adapter rather than a second screen.
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
 * that ladder. A passkey holder who already has a PROTOTYPE account never
 * reaches it — `passkeyPassportRoute` sends them to the flow they have always
 * had — so every Passport in production takes the branch it took yesterday,
 * which is the property the mocked specs hold us to.
 *
 * THE COPY RULE
 * -------------
 * The words wallet address, DUST, contract, registry, indexer, resolver,
 * sponsor, and SDK do not appear on this screen, and neither does the name of
 * the fee token. Nor does "Dynamic": a reader who signed in chose Google, not a
 * vendor, and a reader who did not chose a fingerprint, not a passkey. Both
 * sentences come from the arm.
 *
 * WHAT THE SCREEN DOES WITH MONEY
 * -------------------------------
 * Home shows what the Passport holds: its NIGHT, off the account's own mirror,
 * and every token it has been paid, out of the coin store. A token's
 * description reaches that store through the account's own list of deliveries,
 * which is walked on opening and on every refresh — and a coin whose position
 * in the commitment tree cannot be established is shown as ARRIVING rather than
 * as balance, because a position nobody has confirmed is a payment that cannot
 * be spent (`../identity/custodyInboxIndex.ts`, `../identity/k1CoinStore.ts`).
 *
 * Send takes either. NIGHT leaves in two legs — the gated withdrawal the holder
 * approves, then the recipient's own permissionless deposit, whichever of the
 * three builds they hold. A token leaves in three, because a shielded amount
 * cannot be paid straight into a stranger's account: it is withdrawn to this
 * Passport's own receiving address, identified there by its nonce, and then
 * deposited into the recipient — with a description sealed to their key where
 * the recipient holds one of these accounts, since a coin that arrives
 * undescribed can never be moved again. A send that stops between legs is
 * written down and offered again on the next open; where it cannot be finished,
 * the screen says where the money is rather than which leg failed.
 *
 * WHAT IS NOT DEPLOYED, AND SAYS SO
 * ---------------------------------
 * The service that proves each of these calls — `POST /prove-account-custody`
 * on the balancer — is not deployed yet, so a live run stops at the first one
 * with one plain sentence and the control comes back. That is deliberate: a
 * surface that hides what it cannot do teaches its reader that the things it
 * does show are also approximate.
 */

/** The `.night` registry networks this build can claim on. */
const FUNDER_URLS = parseEndpointList(
  (import.meta.env as Record<string, string | undefined>).VITE_FUNDER_URL,
)

/**
 * The colour this build shows as its stablecoin.
 *
 * Configuration first and `../lib/colour.ts`'s own entry behind it — see
 * {@link custodyStablecoinColour}. It is read once, at module scope, because
 * Vite substitutes the variable with a literal at build time and a build cannot
 * change its mind about which token it means.
 */
const STABLECOIN_COLOUR = custodyStablecoinColour(
  (import.meta.env as Record<string, string | undefined>).VITE_MUSD_COLOUR_HEX,
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

export interface CustodyPassportProps {
  /** The network this build transacts on. */
  network: string
  /** Who is holding this Passport. See `../lib/custodyArm.ts`. */
  arm: CustodyArm
}

type Screen = 'create' | 'name' | 'home' | 'recover'

export default function CustodyPassport({ network, arm }: CustodyPassportProps) {
  /**
   * The key every store this Passport owns is filed under.
   *
   * IT CAN ARRIVE LATE, and that is the one thing about this screen the Dynamic
   * arm did not have to think about. A sign-in knows its key as soon as it is
   * signed in; a passkey's key is its device point, which costs a user-verified
   * assertion to derive. The arm supplies whatever it already knows — for a
   * passkey, the pointer a previous visit wrote — and {@link ensureIdentity}
   * settles it the first time a ceremony is warranted anyway.
   */
  const [user, setUser] = useState<string | null>(arm.userKey)
  /**
   * The same value, where a CALLBACK can see it.
   *
   * LIVE, 2026/09/18, AND NOTHING SHORT OF A LIVE RUN WOULD HAVE FOUND IT. The
   * setup succeeded on stagenet — four waves, an activation, all landed — and
   * the screen stayed on "Create my Passport" as though nothing had happened.
   * `refresh` is a `useCallback` over `user`, and the copy of it that `create`
   * closed over was made BEFORE the ceremony, when `user` was still null; so
   * the read that was supposed to move the screen to the name step returned
   * early and the Passport the person had just paid for was invisible until
   * they reloaded. A ref is what a callback can read after the render that made
   * it, so `refresh` reads this and depends on nothing.
   */
  const userRef = useRef<string | null>(arm.userKey)
  const rememberUser = useCallback((next: string | null) => {
    userRef.current = next
    setUser(next)
  }, [])
  useEffect(() => {
    /* The arm's own answer wins whenever it changes: a second sign-in, or a
       pointer that appeared while this screen was open. A settled identity is
       never thrown away for a null, because the ceremony that produced it is
       not free. */
    if (arm.userKey !== null) rememberUser(arm.userKey)
  }, [arm.userKey, rememberUser])

  const [view, setView] = useState<DynamicPassportView | null>(null)
  const [screen, setScreen] = useState<Screen | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [balance, setBalance] = useState<bigint | null>(null)
  const [balanceFailed, setBalanceFailed] = useState(false)
  const [receivingAddress, setReceivingAddress] = useState<string | null>(null)
  /* Every token the coin store holds of a colour — held and queued together,
     which is what the account HOLDS as opposed to what one payment can draw
     on (`../identity/k1CoinStore.ts`). */
  const [tokens, setTokens] = useState<{ colourHex: string; amount: bigint }[]>([])
  /* Coins that are demonstrably here and have no position yet. Counted, never
     added to a figure: see the header. */
  const [arriving, setArriving] = useState(0)
  /* The good news, kept apart from `error` so a finished payment does not read
     as a failure and a failure does not read as a receipt. */
  const [notice, setNotice] = useState<string | null>(null)
  /* A shielded payment that stopped between its legs, read on open. */
  const [stopped, setStopped] = useState<CustodyShieldedSendRecord | null>(null)
  /* A setup whose remaining steps can never be signed. The offer below turns
     into the one thing that can be done about it.

     READ FROM THE RECORD, not learnt from a failure. It starts false only
     because there is nothing read yet; `refresh` below settles it on the first
     pass, so a reload onto an interrupted setup offers "Start again" straight
     away rather than offering to create a Passport and throwing
     `CUSTODY_SETUP_INTERRUPTED` at whoever pressed it. */
  const [interrupted, setInterrupted] = useState(false)
  const device = useRef<CustodyIdentity | null>(null)
  /* Whether a payment or a setup is running. See {@link run}. */
  const inFlight = useRef(false)

  /** Re-reads what is stored and moves the screen to match it. */
  const refresh = useCallback((): DynamicPassportView | null => {
    const settled = userRef.current
    if (settled === null) return null
    const next = readDynamicPassport({ storage: window.localStorage, user: settled, network })
    setView(next)
    setInterrupted(dynamicSetupInterrupted(next.record))
    setScreen(next.stage === 'home' ? 'home' : next.stage === 'name' ? 'name' : 'create')
    return next
  }, [network])

  useEffect(() => {
    if (user === null) {
      setView(null)
      setScreen(null)
      return
    }
    refresh()
  }, [refresh, user])

  /**
   * The key that approves, settled once.
   *
   * ONE CEREMONY, AND IT IS NOT FREE ON EITHER ARM. A sign-in hands out an
   * address and nothing else, so the point behind it is recovered from a
   * signature over a digest Passport chose; a passkey hands out nothing until
   * somebody touches the authenticator. Doing either per call would mean an
   * approval before every approval, which is the thing a person would notice.
   *
   * It also settles {@link user}, which on the passkey arm is not known before
   * this runs — so every caller below awaits this before reading a store.
   */
  const ensureIdentity = useCallback(async (): Promise<CustodyIdentity> => {
    if (device.current) return device.current
    const identity = await arm.ensureIdentity()
    device.current = identity
    rememberUser(identity.userKey)
    return identity
  }, [arm, rememberUser])

  /**
   * The busy line, and the one write that changes what a stopped payment is
   * told.
   *
   * WHY THE RECORD IS NOT WRITTEN WITH AN ID FROM THE START. A record saved
   * before the approval says a payment is in flight from the moment the button
   * is pressed, and most of what can go wrong goes wrong before anything is
   * submitted — the approval is dismissed, the proving service is down, the
   * position cannot be proved. Telling those people "either it arrived or it
   * did not" hedges about money that never moved. So the id is written on the
   * `confirm` phase, the first moment a transaction exists, and
   * {@link custodyShieldedSendOutcome} reads its absence as the stronger, truer
   * sentence.
   */
  const sendPhase = useCallback(
    (record: CustodyShieldedSendRecord) => (phase: CustodyPhase) => {
      setBusy(PHASE_LABELS[phase.step])
      if (phase.txId === undefined) return
      const away: CustodyShieldedSendRecord = { ...record, sendTxId: phase.txId }
      saveCustodyShieldedSend(window.localStorage, away)
      setStopped(away)
    },
    [],
  )

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
    async (
      label: string,
      work: () => Promise<void>,
      /**
       * The read that shows what the work changed, run once the work has let
       * the coin store go.
       *
       * NOT A LINE AT THE END OF `work`. The flag below makes `readHoldings`
       * refuse while a payment is running, so a payment that read its own
       * result from inside itself read nothing at all — "Sent." over the
       * figure from before the payment, until Refresh (live, 2026/09/18). The
       * order is `../lib/custodyScreenRules.ts`'s `runCustodyWork`.
       */
      after: (() => Promise<void>) | null = null,
    ): Promise<void> => {
      /* NOTHING ELSE READS THE STORE WHILE THIS RUNS. `readHoldings` fires from
         an effect, and the inbox walk inside it writes coins — so a walk that
         landed in the middle of a payment could file a delivery over the coin
         the payment had just spent, or re-place one it had just moved. A ref
         rather than `busy`, because the guard has to be true from the first
         line of the payment and a state update is not. */
      /* ONE AT A TIME, AND THE SECOND PRESS IS TOLD SO. Two of these at once
         read and write one coin store: the second would file a delivery over
         the coin the first has just spent, or sign against a coin the first is
         spending — and what a person would then see is a proof refused for a
         reason no sentence on this screen could explain. The refusal is
         `../lib/custodyScreenRules.ts`'s one sentence, and nothing has gone
         wrong: the press was early. */
      const refusal = custodyInFlightRefusal(inFlight.current)
      if (refusal !== null) {
        setError(refusal)
        return
      }
      setBusy(label)
      setError(null)
      /* THE LABEL STAYS UP ACROSS THE FOLLOW-UP READ, on purpose: the flag is
         already clear by then, so the only thing left holding a second press
         off the store is the busy state the buttons read. */
      const { failure } = await runCustodyWork(inFlight, work, after)
      setBusy(null)
      if (failure === null) return
      console.warn('[account-custody] that step did not finish', failure)
      if (failure instanceof Error && failure.message === CUSTODY_SETUP_INTERRUPTED) {
        setInterrupted(true)
      }
      setError(custodyFailureSentence(failure))
    },
    [],
  )

  /**
   * Asks for this Passport's opening balance, and never pretends it arrived.
   *
   * WHAT IT IS ALLOWED TO DO IS ASK. The figures on Home come from the account's
   * own state and its own list of deliveries and from nowhere else; this call
   * adds nothing to them. So a refusal here is not a failure of the setup — the
   * Passport is made, named, and usable — and it must not throw, or it would
   * undo a setup that worked over money that has not turned up yet.
   *
   * IT IS REFUSED TODAY, AND THE REFUSAL IS WORTH READING. The deployed service
   * decodes the account with the PROTOTYPE module and fingerprints it on
   * `recovery_shares` and `night_balances`, neither of which this contract has,
   * so it answers `not-an-account` — about an account that is one. The fix is
   * the sponsor's (it reads through its own account view instead), and until it
   * lands an opening balance arrives another way or not at all. The service's
   * own words go to the console, where they are of use to somebody; what the
   * reader gets is the truth in a sentence of ours, because the service's
   * sentence is both wrong and full of words this screen does not say.
   */
  const askForOpeningBalance = useCallback(async (contractAddress: string): Promise<void> => {
    for (const funderUrl of FUNDER_URLS) {
      try {
        const response = await fetch(`${funderUrl}/fund-account`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contractAddress }),
        })
        if (response.ok) return
        const body: unknown = await response.json().catch(() => ({}))
        console.warn('[account-custody] the opening balance was refused', response.status, body)
        return
      } catch (cause) {
        console.warn('[account-custody] the opening balance could not be asked for', cause)
      }
    }
  }, [])

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
      const { device: identity } = await ensureIdentity()
      if (interrupted) {
        await startCustodyAccountAgain(arm.session, identity)
        setInterrupted(false)
      }
      const onPhase = (phase: CustodyPhase) => {
        setBusy(phase.detail ? `${PHASE_LABELS[phase.step]}` : PHASE_LABELS[phase.step])
      }
      /* Both halves are resumable and both check the chain before they act, so
         running them one after the other is safe on a second press: whatever
         already landed is skipped rather than replayed. */
      let record = (await deployCustodyAccount(arm.session, identity, onPhase)).record
      if (!record.activated) {
        record = (await activateK1Device(arm.session, identity, onPhase)).record
      }
      /* THE OPENING BALANCE IS ASKED FOR WHEN THE KEY IS ON, and not when the
         account lands. An unactivated account holds nothing and can be called
         by nobody, and the service refuses to fund one — so asking at the
         deploy is a refusal every time, on a schedule. */
      if (record.address !== null) await askForOpeningBalance(record.address)
      refresh()
    })
  }, [arm, askForOpeningBalance, ensureIdentity, interrupted, refresh, run])

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

  /**
   * The wallet, the record, and the account key, or one sentence.
   *
   * Every money path below starts here, so the "not ready yet" answer is
   * written once. The account key carries the NETWORK as well as the address
   * for the reason `../identity/k1CoinStore.ts` gives: a position learned on
   * one chain is a proof that cannot be satisfied on another.
   */
  const custodyContext = useCallback(async () => {
    const record = view?.record ?? null
    if (user === null || record === null || record.address === null) {
      throw new Error('Your Passport is still being set up. Try again once it is ready.')
    }
    const deps = defaultCustodyDeps()
    const wallet = await deps.wallet(user)
    return {
      deps,
      wallet,
      record,
      account: { network: record.network, address: record.address },
    }
  }, [user, view])

  /**
   * Reads this Passport's own list of deliveries and files what it finds.
   *
   * THIS IS HOW A TOKEN BECOMES SPENDABLE. The chain carries the coin; the
   * description of it — nonce, colour, value — travels in the account's own
   * list, sealed to a key only this Passport holds, and the position in the
   * commitment tree is in neither. So each opened entry is matched against the
   * transaction that wrote it ({@link custodyTxIdForInboxIndex}) and that
   * transaction is asked where its outputs landed. A coin any of those steps
   * cannot answer for is left OUT of the store and counted as arriving: the
   * alternative is a stored position nobody confirmed, which fails at proving
   * time every time and looks like a broken Passport.
   *
   * Nothing here can add to a balance without the chain's agreement, which is
   * why the whole of it is allowed to fail quietly — what is already stored is
   * still shown.
   */
  const walkDeliveries = useCallback(
    async (
      wallet: { network: { indexerHttpUrl: string } },
      account: { network: string; address: string },
    ): Promise<number> => {
      const [{ loadK1CoinStore }, { readInboxCustody }, accountModule, runtime] = await Promise.all([
        import('../identity/k1CoinStore.js'),
        import('../identity/custodyInbox.js'),
        import('../identity/accountCustody.js'),
        import('../identity/contractRuntime.js'),
      ])
      const encSecretKeyHex = loadK1CoinStore(account).encSecretKeyHex
      /* No viewing secret, nothing to open the list with. That is a Passport
         restored from a name on a second device, and the sentence for it is not
         here — the row simply shows what the store holds. */
      if (encSecretKeyHex === null) return 0
      const indexerHttpUrl = wallet.network.indexerHttpUrl
      const reader = await accountModule.readCustodyAccountView({ indexerHttpUrl }, account.address)
      const actions = await readCustodyActions(indexerHttpUrl, account.address)
      const txIdFor =
        actions === null ? () => null : custodyTxIdForInboxIndex(actions)
      const walked = await readInboxCustody(account, encSecretKeyHex, reader, {
        txIdFor,
        windows: (txId: string) =>
          runtime.resolveTxCommitmentWindowByHashOnce(indexerHttpUrl, txId),
        /* A DELIVERY'S TRANSACTION HAS TWO SHIELDED OUTPUTS when the payer sent
           part of what it held, which is the ordinary case — so the window
           gives two positions and reporting them would leave every such payment
           permanently unshowable. They are kept as candidates, in order, in the
           same way a spend's change is; `stored` says whether that happened,
           because candidates go in a colour's held slot or nowhere. */
        candidates: 'store',
      })
      /* WHAT THE CHAIN COULD NOT PLACE IS STILL HERE. A coin whose position the
         indexer has not answered for, or answered ambiguously into a colour
         already holding something, is demonstrably delivered and not yet
         spendable — which is what "arriving" means. Counting only the store's
         own awaiting rows made those coins vanish off the screen entirely. */
      const unplaced = custodyUnplacedDeliveries(walked.outcomes)
      console.info(
        `[account-custody] read ${walked.coins.length} of this Passport's own deliveries`,
      )
      return unplaced
    },
    [],
  )

  /** What the Passport holds, in NIGHT and in every token it has been paid. */
  const readHoldings = useCallback(async (): Promise<void> => {
    const record = view?.record ?? null
    if (user === null || record?.address == null) return
    /* A payment is running and it owns the store until it is finished. What is
       already on the screen stays on it; this read happens again when the
       payment does finish, which is the moment the figures change anyway. */
    if (!custodyMayReadHoldings(inFlight.current)) return
    const account = { network: record.network, address: record.address }
    const deps = defaultCustodyDeps()
    let opened: Awaited<ReturnType<typeof deps.wallet>> | null = null
    setBalanceFailed(false)
    try {
      const [wallet, contractModule] = await Promise.all([
        deps.wallet(user),
        deps.contractModule(),
      ])
      opened = wallet
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

    /* NULL, NOT ZERO, UNTIL THE WALK HAS ANSWERED. A walk that could not be
       made says nothing about whether a delivery is waiting, and the count then
       falls back to the store's own rows rather than claiming none. */
    let unplaced: number | null = null
    if (opened !== null) {
      /* EVERY AWAITING COIN IS ASKED ABOUT AGAIN, on every read. A spend files
         its change with a description and no position, and the one question
         that settles it was asked once — immediately after the withdrawal, when
         the indexer had not seen the transaction yet, and never again. The coin
         then read as "arriving" for the rest of the account's life. Asking here
         costs one indexer call per waiting coin and is what makes a reload, or
         simply coming back tomorrow, the remedy it ought to be. */
      try {
        const { awaitingK1Coins, settleK1AwaitingCoinByChainHash } = await import(
          '../identity/k1CoinStore.js'
        )
        const runtime = await import('../identity/contractRuntime.js')
        for (const waiting of awaitingK1Coins(account)) {
          /* EACH ROW BY ITS OWN TRANSACTION. A colour can hold more than one
             coin waiting for a position — a spend's change, then a delivery,
             then a second spend's change — and each is filed under the
             transaction that produced it.

             AND BY THE CHAIN'S NAME FOR IT, which a row written while the
             indexer lagged does not have: the spend's own resolution gives up
             after ten seconds and hands back midnight-js's identifier, which
             the indexer answers nothing for. The same helper the spend's settle
             uses resolves it again here, so a row filed under an identifier is
             renamed and placed by a later read rather than reading "arriving"
             for ever. */
          await settleK1AwaitingCoinByChainHash(
            account,
            waiting.colour,
            waiting.txId,
            (txId) => runtime.resolveTxHashOnce(opened.network.indexerHttpUrl, txId),
            (txId) =>
              runtime.resolveTxCommitmentWindowByHashOnce(opened.network.indexerHttpUrl, txId),
          )
        }
      } catch (cause) {
        console.info('[account-custody] a waiting coin could not be placed this time', cause)
      }

      try {
        unplaced = await walkDeliveries(opened, account)
      } catch (cause) {
        /* QUIET ON PURPOSE, and not the same silence as above: this costs the
           descriptions that have not been filed YET, and the ones already
           filed are read below and shown. A sentence here would tell somebody
           their money was missing when it is on the screen underneath. */
        console.info('[account-custody] the deliveries could not be read this time', cause)
      }
    }

    try {
      const { awaitingK1Coins, k1ColourHoldings } = await import('../identity/k1CoinStore.js')
      /* HELD PLUS QUEUED, over the colours that have EITHER — which is not the
         same list as the colours with a held coin. A spend takes the held coin
         and files its change as awaiting, so a colour whose earlier delivery is
         sitting in the queue has an empty held slot and real money behind it;
         drawing the rows from the held slots alone showed no row for it at all
         (review, 2026/09/18). What one payment can draw on is smaller again,
         and the refusal for that difference is a sentence rather than a
         smaller figure — `custodyShieldedSendRefusal`'s. */
      setTokens(
        k1ColourHoldings(account).map((holding) => ({
          colourHex: holding.colour,
          amount: holding.value,
        })),
      )
      /* The store's own waiting rows PLUS the deliveries this walk could not
         place. Both are coins that are here and cannot be spent yet. */
      setArriving(
        custodyArrivingCount({ awaitingRows: awaitingK1Coins(account).length, unplaced }),
      )
    } catch (cause) {
      console.warn('[account-custody] could not read what this Passport was paid', cause)
    }

    setStopped(
      loadCustodyShieldedSend(window.localStorage, {
        network: record.network,
        accountAddress: record.address,
      }),
    )
  }, [user, view, walkDeliveries])

  useEffect(() => {
    if (screen !== 'home') return
    void readHoldings()
  }, [readHoldings, screen])

  /* ---------------------------------------------------------------------- */
  /* Paying somebody                                                        */
  /* ---------------------------------------------------------------------- */

  /** NIGHT out of the account, in the two legs every build takes. */
  const sendNight = useCallback(
    async (params: {
      wallet: LocalMidnightWallet
      record: CustodyAccountRecord
      label: string
      amount: bigint
      recipientAccountAddress: string
      recipientModule: PassportContractName
    }): Promise<void> => {
      const { wallet, record, label, amount } = params
      const { nightColourBytes, nightColourHex, payCustodyAccount } = await import(
        '../identity/accountCustody.js'
      )
      const input = {
        record,
        colourHex: nightColourHex(),
        amount,
        ownReceivingAddress: wallet.unshieldedAddress,
        recipientAccountAddress: params.recipientAccountAddress,
        recipientModule: params.recipientModule,
        heldBalance: balance,
      }
      const refusal = custodySendRefusal(input)
      if (refusal !== null) throw new Error(refusal)
      const plan = planCustodySend(input)

      /* LEG ONE — gated, and the only thing the holder approves. */
      setBusy(arm.approvalPrompt)
      const { device: identity } = await ensureIdentity()
      const colour = nightColourBytes()
      const recipientBytes = await unshieldedRecipientBytes(
        plan.withdraw.recipientAddress,
        wallet.network.networkId,
      )
      await k1Call(
        arm.session,
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

      /* LEG TWO — permissionless, and the same call whichever of the three
         builds the recipient holds. `plan.deposit.circuit` says which circuit
         that is and is deliberately not read here: the account is re-read at
         the moment of the call, and a screen that named the circuit itself
         would be a second place for that answer to be wrong. */
      setBusy(`Paying ${label}`)
      await payCustodyAccount(wallet, {
        targetAddress: plan.deposit.contractAddress,
        kind: 'night',
        colourHex: plan.deposit.colourHex,
        amount: plan.deposit.amount,
      })
      setNotice(`Sent. ${label} has it.`)
    },
    [arm, balance, ensureIdentity],
  )

  /**
   * Write the change this account kept into its own inbox.
   *
   * AFTER THE SEND, NEVER INSIDE IT. The recipient has their money the moment
   * the send lands. This is the sender tidying up: the change's description
   * came back privately, to this tab and to nowhere else, so an entry sealed to
   * this account's own key is what lets a second device ever find it. It costs
   * a second approval, so it is offered after the payment is reported and a
   * refusal loses the record rather than the money.
   */
  const backfillChange = useCallback(
    async (params: {
      wallet: LocalMidnightWallet
      record: CustodyAccountRecord
      identity: CustodyCallDevice
      change: CustodyChangeCoin
    }): Promise<void> => {
      const { readCustodyAccountView } = await import('../identity/accountCustody.js')
      const view = await readCustodyAccountView(
        { indexerHttpUrl: params.wallet.network.indexerHttpUrl },
        params.record.address as string,
      )
      await appendChangeToInboxK1(
        arm.session,
        params.identity,
        { change: params.change, ownEncKeyHex: view.encKeyHex },
      )
    },
    [arm],
  )

  /**
   * A token out of the account, in ONE transaction.
   *
   * THREE LEGS BECAME ONE (2026/09/18). The value used to leave the account to
   * this Passport's own wallet, wait there to be recognised, and go on in a
   * third transaction — so a payment could stop with somebody's money in a
   * place neither party owned, which is what the ruling of 2026/09/18 forbids
   * and what every stopped payment in this build's history was. A Passport's
   * value lives in its account; the only wallet left assembles the transaction,
   * holds nothing, and relays nothing.
   *
   * WHICH ONE TRANSACTION IT IS depends on what the recipient is, and that is
   * asked of the chain rather than assumed: another one of these accounts is
   * paid by the direct transfer of MIP-0012 §6.6 — the gated spend to a
   * contract recipient with the recipient's own claim grafted onto the same
   * transaction — and a pasted shielded address is paid by the ordinary gated
   * spend, with the recipient's encryption key attached so midnight-js can
   * build their note.
   */
  const sendShielded = useCallback(
    async (params: {
      wallet: LocalMidnightWallet
      record: CustodyAccountRecord
      account: { network: string; address: string }
      label: string
      asset: CustodyAssetRow
      amount: bigint
      recipientAccountAddress: string
      recipientModule: PassportContractName
    }): Promise<void> => {
      const { account, amount, asset, label, record, wallet } = params
      const [store, accountModule] = await Promise.all([
        import('../identity/k1CoinStore.js'),
        import('../identity/accountCustody.js'),
      ])
      const indexerHttpUrl = wallet.network.indexerHttpUrl
      const held = store.heldK1Coin(account, asset.colourHex)
      /* READ NOW, FROM THE CHAIN, and not remembered: an account rotates its
         encryption key, and a description sealed to one it has rotated away
         from is a coin its holder can never open. */
      const recipientEncKeyHex =
        params.recipientModule === 'account-custody'
          ? (
              await accountModule.readCustodyAccountView(
                { indexerHttpUrl },
                params.recipientAccountAddress,
              )
            ).encKeyHex
          : null
      const input = {
        record,
        colourHex: asset.colourHex,
        amount,
        recipientAccountAddress: params.recipientAccountAddress,
        recipientModule: params.recipientModule,
        heldCoin:
          held === null ? null : { nonce: held.nonce, value: held.value, mtIndex: held.mtIndex },
        queuedValues: store.queuedK1Coins(account, asset.colourHex).map((coin) => coin.value),
        recipientEncKeyHex,
      }
      const refusal = custodyShieldedSendRefusal(input)
      if (refusal !== null) throw new Error(refusal)
      const plan = planCustodyShieldedSend(input)

      /* WRITTEN DOWN BEFORE IT GOES OUT, and it is now the only thing a tab
         closed mid-payment leaves behind: one transaction, which either landed
         or did not. There is no leg for a later run to finish. */
      const stoppedRecord = newCustodyShieldedSend({
        network: record.network,
        accountAddress: account.address,
        colourHex: asset.colourHex,
        amount,
        recipientLabel: label,
        recipientAccountAddress: params.recipientAccountAddress,
        now: Date.now(),
      })
      saveCustodyShieldedSend(window.localStorage, stoppedRecord)
      setStopped(stoppedRecord)

      /* THE APPROVAL IS THE ARM'S. A social sign-in asks a vendor over a
         socket; a passkey asks the authenticator in front of the reader. The
         send does not care which, and the busy line is the arm's own sentence
         so that neither reader is shown the other's. */
      setBusy(arm.approvalPrompt)
      const { device: identity } = await ensureIdentity()
      const sent = await withdrawShieldedToContractK1(
        arm.session,
        identity,
        {
          recipientAccountAddress: plan.transfer.contractAddress,
          recipientEncKeyHex: plan.transfer.recipientEncKeyHex,
          colourHex: plan.transfer.colourHex,
          amount: plan.transfer.amount,
        },
        sendPhase(stoppedRecord),
      )
      void backfillChange({ wallet, record, identity, change: sent.change }).catch((cause) => {
        console.warn('[account-custody] the change was not written to the inbox', cause)
      })
      clearCustodyShieldedSend(window.localStorage, {
        network: record.network,
        accountAddress: account.address,
      })
      setStopped(null)
      setNotice(custodyShieldedSendOutcome({ ...stoppedRecord, stage: 'done' }))
    },
    [arm, backfillChange, ensureIdentity, sendPhase],
  )

  /**
   * The same amount, out to a shielded address somebody pasted.
   *
   * ONE TRANSACTION AND ONE RECIPIENT: the circuit takes the coin public key
   * inside the address and midnight-js takes the encryption key beside it, so
   * the whole address is decoded and both halves are used. Nothing is paid to
   * this Passport's own wallet on the way.
   */
  const sendShieldedToAddress = useCallback(
    async (params: {
      wallet: LocalMidnightWallet
      record: CustodyAccountRecord
      account: { network: string; address: string }
      asset: CustodyAssetRow
      amount: bigint
      shieldedAddress: string
    }): Promise<void> => {
      const { account, amount, asset, record, wallet } = params
      const [store, accountModule] = await Promise.all([
        import('../identity/k1CoinStore.js'),
        import('../identity/accountCustody.js'),
      ])
      const held = store.heldK1Coin(account, asset.colourHex)
      const input = {
        record,
        colourHex: asset.colourHex,
        amount,
        recipientShieldedAddress: params.shieldedAddress,
        heldCoin:
          held === null ? null : { nonce: held.nonce, value: held.value, mtIndex: held.mtIndex },
        queuedValues: store.queuedK1Coins(account, asset.colourHex).map((coin) => coin.value),
      }
      const refusal = custodyShieldedAddressSendRefusal(input)
      if (refusal !== null) throw new Error(refusal)
      const plan = planCustodyShieldedAddressSend(input)

      const label = shortHex(params.shieldedAddress)
      const stoppedRecord = newCustodyShieldedSend({
        network: record.network,
        accountAddress: account.address,
        colourHex: asset.colourHex,
        amount,
        recipientLabel: label,
        recipientAccountAddress: '',
        now: Date.now(),
      })
      saveCustodyShieldedSend(window.localStorage, stoppedRecord)
      setStopped(stoppedRecord)

      setBusy(arm.approvalPrompt)
      const { device: identity } = await ensureIdentity()
      /* BOTH KEYS COME OUT OF THE ADDRESS, and the decode is also the check
         that stops a payment going to an address from another network and
         vanishing. */
      const keys = await accountModule.decodeShieldedRecipient(
        plan.recipientShieldedAddress,
        wallet.network.networkId,
      )
      const sent = await withdrawShieldedK1(
        arm.session,
        identity,
        {
          recipientCoinPublicKey: keys.coinPublicKey,
          recipientEncryptionPublicKey: keys.encryptionPublicKey,
          colourHex: plan.colourHex,
          amount: plan.amount,
        },
        sendPhase(stoppedRecord),
      )
      void backfillChange({ wallet, record, identity, change: sent.change }).catch((cause) => {
        console.warn('[account-custody] the change was not written to the inbox', cause)
      })
      clearCustodyShieldedSend(window.localStorage, {
        network: record.network,
        accountAddress: account.address,
      })
      setStopped(null)
      setNotice(custodyShieldedSendOutcome({ ...stoppedRecord, stage: 'done' }))
    },
    [arm, backfillChange, ensureIdentity, sendPhase],
  )

  /**
   * Pays whatever was typed, in whichever asset the form is on.
   *
   * TWO THINGS CAN BE TYPED and the difference is decided here, once, on the
   * shape of what was typed: a name belongs to a Passport and is resolved, and
   * an `mn_shield-addr…` belongs to whoever holds it and is paid directly. A
   * name is resolved and the recipient's build read ONCE so that every branch
   * below works from the same answer, and none of them decides anything about
   * a payment on a render's word.
   */
  const sendToName = useCallback(
    (typed: string, amountText: string, asset: CustodyAssetRow) => {
      void run('Checking that name', async () => {
        setNotice(null)
        const { account, record, wallet } = await custodyContext()
        const typedTrimmed = typed.trim()
        const amount = parseCustodyAmount(amountText, asset.decimals)

        /* AN ADDRESS, NOT A NAME. Only a shielded amount can go to one: the
           account's unshielded holdings are a mirror the contract keeps, and
           nothing at a shielded address can write one. */
        if (/^mn_shield-addr/i.test(typedTrimmed)) {
          if (asset.mode !== 'shielded') {
            throw new Error('That kind of amount can only be sent to a Passport name.')
          }
          await sendShieldedToAddress({
            wallet,
            record,
            account,
            asset,
            amount,
            shieldedAddress: typedTrimmed,
          })
          return
        }

        const label = normaliseNameForRecovery(typed)
        if (label.length === 0) throw new Error('Type the name you want to pay.')

        const [{ resolveAliasTarget }, { accountModuleFor }] = await Promise.all([
          import('../identity/midnames.js'),
          import('../identity/accountCustody.js'),
        ])
        const resolved = await resolveAliasTarget(network as 'stagenet', label)
        if (!resolved || resolved.target.kind !== 'contract') {
          throw new Error('No Passport is registered under that name.')
        }
        setReceivingAddress(wallet.unshieldedAddress)
        const recipientModule = await accountModuleFor(
          { indexerHttpUrl: wallet.network.indexerHttpUrl },
          resolved.target.hex,
        )
        const shared = {
          wallet,
          record,
          label,
          amount,
          recipientAccountAddress: resolved.target.hex,
          recipientModule,
        }
        if (asset.mode === 'shielded') {
          await sendShielded({ ...shared, account, asset })
        } else {
          await sendNight(shared)
        }
        /* The figures are read by `run` AFTER this returns — see its `after`
           argument. A read from here reads nothing: the payment still holds
           the store. */
      }, readHoldings)
    },
    [custodyContext, network, readHoldings, run, sendNight, sendShielded, sendShieldedToAddress],
  )

  /** Forgets a payment the person has been told about. */
  const dismissStoppedSend = useCallback(() => {
    const record = view?.record ?? null
    if (record?.address == null) return
    clearCustodyShieldedSend(window.localStorage, {
      network: record.network,
      accountAddress: record.address,
    })
    setStopped(null)
  }, [view])

  /* ---------------------------------------------------------------------- */
  /* Coming back on a new device                                            */
  /* ---------------------------------------------------------------------- */

  const findByName = useCallback(
    async (typed: string): Promise<NameRecoveryOutcome> => {
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
      /* THE CEREMONY COMES FIRST HERE, AND ONLY HERE. Everywhere else the key
         this Passport is filed under is already known; on a NEW DEVICE it is
         not — that is what coming back by name means — and on the passkey arm
         that key IS the device point, which is what the assertion produces. So
         the identity is settled before any store is read rather than after it,
         and somebody who typed a name they do not own has paid one touch for
         the answer, which is the cheapest honest price for it. */
      let restoredUser: string
      let identity: CustodyIdentity
      try {
        identity = await ensureIdentity()
        restoredUser = identity.userKey
        pk = identity.device.pk
      } catch (cause) {
        console.warn('[account-custody] could not open this Passport', cause)
        return { kind: 'unreachable', detail: 'Your Passport is still starting up.' }
      }
      try {
        const deps = defaultCustodyDeps()
        const wallet = await deps.wallet(restoredUser)
        operations = await readAccountOperations(wallet.network.indexerHttpUrl, address)
        if (operations !== null) {
          const [contractModule, providers] = await Promise.all([
            deps.contractModule(),
            deps.providers(wallet, k1PrivateStateId(restoredUser)),
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
                    identity.device,
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
        user: restoredUser,
        network,
        address,
        privateStateId: k1PrivateStateId(restoredUser),
        pkXHex: pk.x.toString(16),
        pkYHex: pk.y.toString(16),
      })
      saveCustodyRecord(window.localStorage, restored)
      saveCustodyName(window.localStorage, restoredUser, network, label)
      /* THE VIEWING SECRET, SO A RECOVERED PASSPORT CAN DESCRIBE ITS OWN MONEY.
         The account's whole coin store is rebuilt by opening its own list of
         deliveries, and an entry opens with this secret or with nothing; a
         Passport brought back on a second device has an empty store, so
         `readHoldings` walks the list, opens nothing, and shows a balance of
         zero over a chain that says otherwise.

         A PASSKEY CAN FIX THAT AND A SIGN-IN CANNOT, which is the whole reason
         the secret is derived on this arm: the same authenticator that produced
         the device point produces the secret the account's entries were sealed
         to, so it is in hand here with no further ceremony. A Dynamic device
         carries none and the store keeps whatever it had, which for that arm is
         what Dynamic's own storage restore is for.

         Only where the store has NONE. An existing secret is this account's own
         and is never written over — see `rememberK1EncSecretKey`'s caller at
         the deploy, which files it when the account is created. */
      if ('encSecretKeyHex' in identity.device && identity.device.encSecretKeyHex !== undefined) {
        const { loadK1CoinStore, rememberK1EncSecretKey } = await import(
          '../identity/k1CoinStore.js'
        )
        const account = { network, address }
        if (loadK1CoinStore(account).encSecretKeyHex === null) {
          rememberK1EncSecretKey(account, identity.device.encSecretKeyHex)
        }
      }
      refresh()
      return outcome
    },
    [ensureIdentity, network, refresh],
  )

  /* ---------------------------------------------------------------------- */
  /* What is on screen                                                      */
  /* ---------------------------------------------------------------------- */

  if (!arm.ready) {
    return (
      <Shell label="Passport">
        <p className="mnob-lede">Getting your Passport ready…</p>
      </Shell>
    )
  }



  if (screen === 'recover') {
    return (
      <RecoverStep
        keyPhrase={arm.keyPhrase}
        otherKeyHint={arm.otherKeyHint}
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
        badge={arm.badge}
        name={view?.name ?? null}
        address={view?.address ?? null}
        receivingAddress={receivingAddress}
        rows={custodyAssetRows({
          night: balance,
          shielded: tokens,
          stablecoinColourHex: STABLECOIN_COLOUR,
        })}
        balanceFailed={balanceFailed}
        arriving={arriving}
        offer={custodyResumeOffer(stopped)}
        busy={busy}
        error={error}
        notice={notice}
        onRefresh={() => void readHoldings()}
        onSend={sendToName}
        onDismissStopped={dismissStoppedSend}
        onDismissError={() => setError(null)}
      />
    )
  }

  const phase = dynamicSetupPhase(view?.record ?? null)
  return (
    <Shell label="Passport">
      <p className="mnob-kicker">{arm.kicker}</p>
      <h1 className="mnob-title">
        <span>Set up</span>
        <span>your Passport</span>
      </h1>
      <p className="mnob-lede">{arm.lede}</p>

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
          placeholder="alice, or an address they gave you"
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
  /** "…that {keyPhrase} is part of it". See `../lib/custodyArm.ts`. */
  keyPhrase: string
  /** What to try when the name turns out to be somebody else's. */
  otherKeyHint: string
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
        {' '}{props.keyPhrase} is part of it before bringing anything back.
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
            .then((outcome) =>
              setMessage(recoveryMessage(outcome, props.keyPhrase, props.otherKeyHint)),
            )
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
  badge: string
  name: string | null
  address: string | null
  receivingAddress: string | null
  /** Everything the Passport holds, NIGHT first. See `../lib/custodyAssets.ts`. */
  rows: CustodyAssetRow[]
  balanceFailed: boolean
  /** How many payments are here with no position yet. Never part of a figure. */
  arriving: number
  /** A payment that stopped between legs, and what can be done about it. */
  offer: ReturnType<typeof custodyResumeOffer>
  busy: string | null
  error: string | null
  notice: string | null
  onRefresh: () => void
  onSend: (name: string, amount: string, asset: CustodyAssetRow) => void
  onDismissStopped: () => void
  onDismissError: () => void
}) {
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  /* The colour being sent, by id. Held as the COLOUR rather than as an index so
     a list that gains a row between renders — which it does, the moment a
     payment's description lands — cannot move the selection to another token
     under somebody who has already typed an amount. */
  const [assetId, setAssetId] = useState<string>(NIGHT_COLOUR_HEX)
  const payable = props.name ?? props.address ?? null
  const asset = props.rows.find((row) => row.id === assetId) ?? props.rows[0]
  const arriving = custodyArrivingSentence(props.arriving)

  return (
    <Shell label="Passport">
      <p className="mnob-kicker">
        <BadgeCheck size={13} aria-hidden="true" /> {props.badge}
      </p>
      <h1 className="mnob-title">
        <span>{props.name ? `${props.name}.night` : 'Your Passport'}</span>
      </h1>

      <div className="mndyn-balance" aria-label="What your Passport holds">
        <span className="mndyn-balance-figure">
          {custodyAmountFigure(props.rows[0].amount, props.rows[0].decimals, props.balanceFailed)}
        </span>
        <span className="mndyn-balance-unit">{props.rows[0].symbol}</span>
        <button type="button" className="mndyn-icon" onClick={props.onRefresh} aria-label="Refresh">
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </div>

      {props.rows.length > 1 ? (
        <ul className="mndyn-holdings">
          {props.rows.slice(1).map((row) => (
            <li className="mndyn-holding" key={row.id}>
              <span className="mndyn-holding-figure">
                {custodyAmountFigure(row.amount, row.decimals)}
              </span>
              <span className="mndyn-holding-unit">{row.symbol}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {arriving ? <p className="mnob-hint">{arriving}</p> : null}

      {props.offer.kind === 'none' ? null : (
        /* A SENTENCE AND A DISMISS, and no third thing to press. A send is one
           transaction: it landed or it did not, and a button offering to
           "finish" it would be a button offering to send the money twice. */
        <div className="mnob-unusable" role="status">
          <p className="mnob-unusable-copy">{props.offer.sentence}</p>
          <button type="button" className="mnob-alt" onClick={props.onDismissStopped}>
            Dismiss
          </button>
        </div>
      )}

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
          if (props.busy === null) props.onSend(recipient, amount, asset)
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
        <label className="mnob-hint" htmlFor="dynamic-send-asset">
          What to send
        </label>
        <select
          id="dynamic-send-asset"
          className="mnob-input"
          value={asset.id}
          onChange={(event) => setAssetId(event.target.value)}
          disabled={props.busy !== null}
        >
          {props.rows.map((row) => (
            <option key={row.id} value={row.id}>
              {row.symbol}
            </option>
          ))}
        </select>
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
        {props.notice ? (
          <p className="mnob-hint" role="status">
            {props.notice}
          </p>
        ) : null}
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
            {props.busy ?? `Send ${asset.symbol}`}
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

/** The one place the recovery answers become sentences on this path. */
function recoveryMessage(
  outcome: NameRecoveryOutcome,
  keyPhrase: string,
  otherKeyHint: string,
): string | null {
  if (outcome.kind === 'found') return null
  if (outcome.kind === 'unknown') {
    return 'No Passport is registered under that name. Check the spelling, or go back and set a new one up.'
  }
  if (outcome.kind === 'not-yours') {
    return `That name belongs to a Passport ${keyPhrase} is not part of. ${otherKeyHint}`
  }
  return outcome.detail
}

/* NIGHT's own formatter and amount reader lived here until 2026/09/17. They
   are `formatCustodyAmount` and `parseCustodyAmount` in `../lib/custodyAssets.ts`
   now, because the screen sends more than one asset and only one of them
   carries six decimal places — and because both are decisions about somebody's
   money, which belong where a test can hold them to it. */

/** Enough of a 32-byte address to compare by eye, never all of it. */
function shortHex(value: string): string {
  return value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`
}

/**
 * The account's own action history, oldest first, or null when it could not be
 * read.
 *
 * ONE POST, and the only network call this screen makes itself. The document
 * and the reading of the answer are both in `../identity/custodyInboxIndex.ts`,
 * which is drilled; what is here is the fetch, the ten-second ceiling every
 * other indexer read in this app carries (`../identity/contractRuntime.ts`),
 * and the rule that every way of not getting an answer is the SAME answer:
 * null, which the walk reads as "nothing here knows which transaction wrote
 * that entry" and files no coin on.
 */
async function readCustodyActions(indexerHttpUrl: string, address: string) {
  try {
    const response = await fetch(indexerHttpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: custodyActionHistoryQuery(address) }),
      signal: AbortSignal.timeout(10_000),
    })
    return custodyActionRowsFrom(await response.json())
  } catch (cause) {
    console.info('[account-custody] the history of this Passport could not be read', cause)
    return null
  }
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
