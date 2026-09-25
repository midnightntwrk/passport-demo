import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from 'react'
import {
  ArrowRight,
  Gamepad2,
  Loader2,
  Search,
  ShieldCheck,
} from 'lucide-react'

import { normaliseNameForRecovery, type NameRecoveryOutcome } from '../lib/nameRecovery.js'
import RecoveryStep from './RecoveryStep'
import { saveBackupRecord, type BackupRecord } from '../lib/backupDevice.js'
import { saveAdoption, type AdoptionHandoff } from '../lib/custodyAdoption.js'
import {
  RECOVERY_COPY,
  loadRecoveryRecord,
  recoveryHomeEntry,
  recoveryRefusal,
  recoveryResumes,
  recoveryStepDue,
} from '../lib/recoveryStep.js'
import type { CustodyArm, CustodyIdentity } from '../lib/custodyArm.js'
import { parseEndpointList } from '../lib/endpoints.js'
import { type K256DeviceIdentity } from '../identity/custodyContractSigning.js'
import {
  activateK1Device,
  addDeviceK1,
  appendChangeToInboxK1,
  custodyAccountActivatedOnChain,
  defaultCustodyDeps,
  deployCustodyWaveOne,
  finishCustodyWaves,
  freshCustodyWallet,
  startCustodyAccountAgain,
  warmCustodySetup,
  withdrawShieldedK1 as engineWithdrawShieldedK1,
  withdrawShieldedToContractK1 as engineWithdrawShieldedToContractK1,
  withdrawUnshieldedK1 as engineWithdrawUnshieldedK1,
  custodyPrepareWaitMs,
  type CustodyCallDevice,
  type CustodyPhase,
  type CustodyShieldedSpendResult,
  type CustodyStepResult,
} from '../identity/custodyContractClient.js'
import {
  hexToBytes,
  CUSTODY_SEND_NOT_SENT,
  custodyActivatedRecord,
  custodyFailureSentence,
  custodyOpeningBalanceDue,
  custodySubmissionLost,
  CUSTODY_SETUP_UNCONFIRMED,
  custodyWavesPending,
  loadCustodyRecord,
  nextCustodyStep,
  resolveCustodyUseCounter,
  saveCustodyRecord,
  CUSTODY_SETUP_INTERRUPTED,
  CUSTODY_SUBMIT_WAIT_MS,
  CUSTODY_UNDONE_KEEP_MS,
  withinCustodyBound,
  type CustodyAccountRecord,
} from '../identity/custodyContractPlan.js'
import {
  dynamicSetupInterrupted,
  forgetCustodyChosenName,
  k1PrivateStateId,
  custodyRecoveryOutcome,
  readDynamicPassport,
  recoveredCustodyRecord,
  saveCustodyChosenName,
  saveCustodyName,
  type DynamicPassportView,
} from '../identity/custodyContractSession.js'
import {
  clearCustodyShieldedSend,
  custodyShieldedAddressSendRefusal,
  custodyStoppedSendSentence,
  custodyStoppedSendVerdict,
  custodyShieldedSendOutcome,
  custodyShieldedSendRefusal,
  custodyUnshieldedBalance,
  loadCustodyShieldedSend,
  newCustodyShieldedSend,
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
  custodyLandedSpendCount,
  custodyTxIdForInboxIndex,
} from '../identity/custodyInboxIndex.js'
import {
  custodyAssetRow,
  custodyAssetRows,
  formatCustodyAmount,
  custodyStablecoinColour,
  type CustodyAssetRow,
} from '../lib/custodyAssets.js'
/* The translation between what this screen holds and what the real Home
   paints, plus the trail's own rules. Pure — see `../lib/custodyHome.ts`. */
import {
  CUSTODY_NIGHT_SEND_REFUSAL,
  custodyActivityMarkKey,
  custodyRecipientAccountRefusal,
  custodySentToastTitle,
  custodyMilestoneEntry,
  custodyMilestoneTxHash,
  custodyOpeningDepositTxHash,
  custodyMilestonesLanded,
  custodyHomeSendableHoldings,
  custodySendPhase,
  custodySentEntry,
  custodyStablecoinHeld,
  type CustodyActivityEntry,
  type CustodyHomeView,
} from '../lib/custodyHome.js'
import {
  custodyArrivingCount,
  custodyInFlightRefusal,
  custodyMayReadHoldings,
  custodyUnplacedDeliveries,
  runCustodyPayment,
  runCustodyWork,
} from '../lib/custodyScreenRules.js'
import {
  custodyBackgroundWork,
  custodyFinishSetupCard,
  custodySetupClock,
  custodySetupHint,
  custodySetupPhase,
  custodySetupSteps,
  custodySetupSubStages,
  type CustodySetupClock,
  type CustodySetupSignal,
} from '../lib/custodySetupProgress.js'
import { LONG_WAIT_NOTE } from '../lib/claimSteps.js'
import { OFFER_AFTER_MS } from '../lib/waitingGame.js'
import ProgressTimeline, { useTimelineClock, type TimelineRow } from './ProgressTimeline.js'
import WaitingGame from './WaitingGame.js'
import SnakeGame from './SnakeGame.js'
import {
  recoveryAddFailureSentence,
  recoveryAddNeedsReader,
  recoveryAddRows,
  runRecoveryAdd as addRecoveryInOrder,
  type RecoveryAddProgress,
} from '../lib/recoveryAdd.js'
import {
  CUSTODY_NAME_CHECKING_SENTENCE,
  CUSTODY_NAME_UNREACHABLE_SENTENCE,
  custodyNameAvailableSentence,
  custodyNameEmptySentence,
  custodyNameFirstAction,
  custodyNameFirstEnabled,
  custodyNameFirstStage,
  custodyNameRaceOutcome,
  custodyNameTakenSentence,
  custodyNameWasTaken,
} from '../lib/custodyNameFirst.js'
/* `../identity/midnamesText.js` and NOT `../identity/midnames.js`, for the
   reason `AliasClaim.tsx` gives at the same import: the module that goes and
   ASKS top-level awaits a 9.84 MB ledger WASM, and naming a value from it here
   would hold this screen's first render behind that fetch. The rules are text;
   the question is a dynamic import at the moment it is put. */
import {
  aliasDomain,
  normalizePassportAlias,
  type AliasAvailability,
} from '../identity/midnamesText.js'
import { NETWORK_LABELS, type PassportNetwork } from './NetworkSwitcher.js'
import type { PassportContractName } from '../identity/contractRuntime.js'
import type { LocalMidnightWallet } from '../lib/localWallet.js'
import { pushToast } from './ToastStack.js'
/* The explorer link a finished payment's toast and trail row carry. Pure, and
   free of the wallet SDK — see `../lib/networks.ts`. */
import { txReceiptLink } from '../lib/networks.js'
/* A payment that runs behind the Passport rather than in front of it: the one
   transition function, and the view the pill and the live row paint. Pure —
   see `../lib/sendProgress.ts`. */
import {
  SEND_SENT_DISMISS_MS,
  sendInFlightReason,
  sendProgressReduce,
  sendProgressView,
  type SendDraft,
  type SendProgressLink,
  type SendProgressSubject,
} from '../lib/sendProgress.js'
import ThemeToggle from './ThemeToggle'
import NameArtwork from './NameArtwork.js'
import { WELCOME_BENEFITS } from './Welcome.js'
import './welcome.css'
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


/** How long "Recovery is on" stays ticked on screen before Home. */
const RECOVERY_DONE_HOLD_MS = 1_500

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

/**
 * Which of the custody road's reported steps moves the timeline on.
 *
 * Two of the seven, and the other five are deliberately absent — see the note
 * at the one call site. `waves` joined the absent ones on 2026/09/22: the waves
 * after the deploy land behind Home now, and a row about them would count a
 * wait nobody is in. `../lib/custodySetupProgress.ts` turns these into the row
 * and the state a reader is shown.
 */
const SETUP_SIGNAL_OF_STEP: Partial<Record<CustodyPhase['step'], CustodySetupSignal>> = {
  deploy: 'deploy',
  activate: 'activate',
}

/**
 * The stopwatch for a live run: `[setup-timing] <phase> <ms since the press>`
 * in the page console, one line per phase. See `custodySetupClock`.
 */
function startSetupClock(): CustodySetupClock {
  return custodySetupClock(
    () => performance.now(),
    (line) => console.info(line),
  )
}

/** Where the chosen name's claim is, in THIS tab. */
type NameClaimState = 'idle' | 'running' | 'done' | 'failed'

export interface CustodyPassportProps {
  /** The network this build transacts on. */
  network: string
  /** Who is holding this Passport. See `../lib/custodyArm.ts`. */
  arm: CustodyArm
  /**
   * One sentence about what this BROWSER already holds, shown before the offer
   * to make a Passport — or null when there is nothing to say.
   *
   * Decided by `../lib/custodyRoute.ts`'s `custodyOtherKeyNotice`, which is
   * where the reasoning is. It is a notice and never a refusal: a second
   * Passport on one browser is a legitimate thing to want.
   */
  notice?: string | null
  /**
   * PAINTS A FINISHED PASSPORT — the real Home, the bottom bar, and everything
   * that hangs off them.
   *
   * THIS SCREEN NO LONGER HAS A HOME OF ITS OWN, and that is the change of
   * 2026/09/22. It had one: a name, one figure, "People can pay you at", and a
   * three-field form. It was never the product — the product's Home is
   * `./Home.tsx`, with the greeting, Send and Receive, the asset rows and their
   * `Arriving` word, the name card, "Your account is ready", the apps, and the
   * trail — and a Passport was being shown a different product because of which
   * contract happened to be holding its money.
   *
   * The shell is rendered by `App.tsx` rather than from here for one reason: it
   * is the SAME shell, with the same tab state, the same apps grid, and the
   * same overlays a prototype Passport gets, and a second copy of it here would
   * be two Homes to keep in step. What this screen keeps is the state, the
   * wallet, and the seams — see `../lib/custodyHome.ts#CustodyHomeView`.
   *
   * What is left here is onboarding: the welcome page, the name step, the
   * counted setup, and coming back by name.
   */
  renderHome: (view: CustodyHomeView) => React.ReactNode
  /**
   * Records something that happened, for the trail Home renders.
   *
   * The host owns the trail — it is keyed, stored, paged, and linked to the
   * explorer there — so this screen only ever says what happened. Every call is
   * at the moment the thing LANDS, and the milestones are written at most once
   * per account: see `custodyMilestonesLanded`.
   */
  onActivity?: (entry: CustodyActivityEntry) => void
  /**
   * THE PROVIDER SIGN-IN, AS A WAY BACK — and as nothing else.
   *
   * Narrow on purpose: whether somebody is signed in, what to call the
   * provider, how to open the overlay, how to reach the key behind it, and how
   * to leave. This screen needs no more than that, and giving it more would put
   * a vendor inside a flow whose whole design is that there is not one.
   *
   * Null where the build has no sign-in, which is most builds — and then the
   * recovery step is never due (`../lib/recoveryStep.ts`) and this screen is
   * exactly what it was before the step existed.
   */
  social?: CustodySocialSignIn | null
  /**
   * Hand a Passport found by a sign-in over to a key made on THIS device.
   *
   * THE SIGN-IN NEVER HOLDS IT, which is the ruling of 2026/09/22 and the
   * reason this is a hand-off rather than a recovery. A provider key is a way
   * back — it proves who is asking — and what opens a Passport on a new phone
   * is a key that phone makes. So the found account is written down and the
   * host is asked for the enrolment; the second half runs under the new key.
   * See `../lib/custodyAdoption.ts` and `../identity/custodyAdopt.ts`.
   */
  onRecoverToDeviceKey?: ((handoff: AdoptionHandoff) => void) | null
  /** Leave the way-back road — signs out of the provider and goes back. */
  onLeaveRecovery?: (() => void) | null
}

/** What this screen may ask of a provider sign-in, and the whole of it. */
export interface CustodySocialSignIn {
  /** `disabled`, `loading`, `signed-out`, or `signed-in`. */
  readonly status: string
  /** "Google", "Discord", … — whatever the session reports, or null. */
  readonly provider: string | null
  /** What to call the person, for a receipt. Never shown as an address. */
  readonly handle: string | null
  /** Whether the session has a key behind it yet. */
  readonly address: string | null
  /** Opens the provider's own overlay. */
  openAuthFlow(): void
  /** The key behind the sign-in, recovered from a signature it makes. */
  device(): Promise<K256DeviceIdentity>
  /** Ends the sign-in. */
  signOut(): void
}

/**
 * THE THREE SCREENS OF MAKING ONE, AND THE WAY BACK IN.
 *
 * `create` is gone (2026/09/22). It was a page whose whole content was an offer
 * and a button, sitting between a person and the two things they came for — an
 * explanation and a name — and the flow it started then asked for the name
 * afterwards, on a fourth screen, behind a second press. The offer is now the
 * button on the name step, which is the screen that has something to offer it
 * ABOUT. See `../lib/custodyNameFirst.ts`.
 */
type Screen = 'welcome' | 'name' | 'recovery' | 'home' | 'recover'

export default function CustodyPassport({
  network,
  arm,
  notice: browserNotice = null,
  renderHome,
  onActivity,
  social = null,
  onRecoverToDeviceKey = null,
  onLeaveRecovery = null,
}: CustodyPassportProps) {
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
  /**
   * THE LAST THING THE SETUP SAID, and the reason the timeline can be trusted.
   *
   * The counted hint used to be read off the stored record, which is re-read
   * when a press FINISHES — so somebody watched "step 1 of 3" while the chain
   * showed all three landed (2026/09/22). What is live is what this press
   * reports, so this is what it reports; the record is still the answer after a
   * reload, and `../lib/custodySetupProgress.ts` is where the two are weighed.
   */
  const [setupSignal, setSetupSignal] = useState<CustodySetupSignal | null>(null)
  /* The name THIS press is claiming, so the timeline can name it from the
     first frame. The stored one is only readable after a refresh, and a row
     that said "your name" for three minutes and then swapped in the real one
     would move under a reader who is already watching it. */
  const [setupName, setSetupName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [balance, setBalance] = useState<bigint | null>(null)
  const [balanceFailed, setBalanceFailed] = useState(false)
  /* Every token the coin store holds of a colour — held and queued together,
     which is what the account HOLDS as opposed to what one payment can draw
     on (`../identity/k1CoinStore.ts`). */
  const [tokens, setTokensState] = useState<{ colourHex: string; amount: bigint }[]>([])
  /* THE SAME FIGURES ARE NOT NEWS (2026/09/25). Every read of the holdings
     rebuilt this list, so every read re-rendered Home and everything the list
     is threaded into — the Send sheet's seams among them — whether or not a
     single figure had moved. A list equal to the one held is kept. */
  const setTokens = useCallback((next: { colourHex: string; amount: bigint }[]) => {
    setTokensState((held) => (sameTokenList(held, next) ? held : next))
  }, [])
  /* Coins that are demonstrably here and have no position yet. Counted, never
     added to a figure: see the header. */
  const [arriving, setArriving] = useState(0)
  /* The good news, kept apart from `error` so a finished payment does not read
     as a failure and a failure does not read as a receipt. */
  const [notice, setNotice] = useState<string | null>(null)
  /* A shielded payment that stopped between its legs, read on open. */
  const [stopped, setStoppedState] = useState<CustodyShieldedSendRecord | null>(null)
  /* Read back from storage on every holdings read, which makes a new object
     each time for the same record. The record held is kept when nothing in it
     changed, for the reason `setTokens` gives. */
  const setStopped = useCallback((next: CustodyShieldedSendRecord | null) => {
    setStoppedState((held) => (sameSendRecord(held, next) ? held : next))
  }, [])
  /* A setup whose remaining steps can never be signed. The offer below turns
     into the one thing that can be done about it.

     READ FROM THE RECORD, not learnt from a failure. It starts false only
     because there is nothing read yet; `refresh` below settles it on the first
     pass, so a reload onto an interrupted setup offers "Start again" straight
     away rather than offering to create a Passport and throwing
     `CUSTODY_SETUP_INTERRUPTED` at whoever pressed it. */
  const [interrupted, setInterrupted] = useState(false)
  /* The name that was TAKEN between being chosen and being claimed, so the name
     step can say so over a field the person is about to retype. Cleared the
     moment they type. See `../lib/custodyNameFirst.ts`. */
  const [taken, setTaken] = useState<string | null>(null)
  /* Whether the holdings have been read AT ALL on this Passport. It is not the
     same question as "is the balance null": the shielded rows always carry a
     stablecoin row, at zero where nothing has arrived, so without this a first
     render would read "you have been paid nothing" and write no trail row for
     the deposit when it landed. See `custodyStablecoinHeld`. */
  const [holdingsRead, setHoldingsRead] = useState(false)
  /* The wallet's own chain position, for the hairline bar under Home's top
     bar. Null until the wallet has published one. */
  const [syncPercent, setSyncPercent] = useState<number | null>(null)
  /* The transaction the name registration landed in, where THIS session
     watched it happen. It is not stored: the trail keeps it, and the name card
     does not need it to say the name is registered. */
  const [registerTxId, setRegisterTxId] = useState<string | null>(null)
  /* Which step of a PAYMENT is running, in the Send sheet's four words.
     Separate from `busy`, which is the onboarding steps' line. */
  const [sendStep, setSendStep] = useState<CustodyPhase['step'] | null>(null)
  /* THE PAYMENT THIS TAB IS RUNNING, OR HAS JUST FINISHED (2026/09/25). Not a
     second record of it: the record on disk (`stopped`) is what a reload
     reads, and this holds only what a record cannot — who it is for before
     the record is written, and the one-sentence answer it came to. See
     `../lib/sendProgress.ts`. */
  const [progress, dispatchProgress] = useReducer(sendProgressReduce, null)
  /* Where the finished payment can be looked at, written by `reportSent` and
     read by the runner that reports it, in the same tick. */
  const lastSentLink = useRef<SendProgressLink | null>(null)
  /* "Sent" goes by itself after a few seconds; the trail keeps the row. */
  useEffect(() => {
    if (progress?.kind !== 'sent') return undefined
    const timer = setTimeout(() => dispatchProgress({ type: 'dismiss' }), SEND_SENT_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [progress])
  /**
   * Whether the welcome page has been read in this session.
   *
   * A REF AND NOT STATE, for the reason `userRef` above exists: {@link refresh}
   * decides the screen and is a `useCallback` that depends on nothing, so a
   * refresh fired after the welcome was left would read the value the callback
   * closed over — `false` — and put the reader back on the introduction. There
   * is nothing to re-render for either: whoever sets it moves the screen in the
   * same breath.
   */
  const welcomeReadRef = useRef(false)
  /**
   * WHERE THE NAME'S CLAIM IS, IN THIS TAB (2026/09/22).
   *
   * The claim starts the moment the account is submitted and runs beside the
   * activation, so it can still be running when the key is on — and a Passport
   * in that state goes to Home, whose name card says the name is being
   * registered. State for the render; the ref for {@link refresh}, which
   * decides the screen and depends on nothing (see `userRef`).
   */
  const [nameClaim, setNameClaimState] = useState<NameClaimState>('idle')
  const nameClaimRef = useRef<NameClaimState>('idle')
  const setNameClaim = useCallback((next: NameClaimState) => {
    nameClaimRef.current = next
    setNameClaimState(next)
  }, [])
  /* The claim itself, so a second press joins it rather than starting another. */
  const nameClaimRun = useRef<Promise<void> | null>(null)
  /* The waves after the deploy, landing behind Home. One run at a time. */
  const wavesRun = useRef<Promise<void> | null>(null)
  /* The stopwatch of the press that is running, for the lines behind Home. */
  const setupClock = useRef<CustodySetupClock | null>(null)
  /* Whether the device is settled in this tab, for the effect that picks the
     waves back up — a ref cannot wake an effect. */
  const [identityHeld, setIdentityHeld] = useState(false)
  const device = useRef<CustodyIdentity | null>(null)
  /* Whether a payment or a setup is running. See {@link run}. */
  const inFlight = useRef(false)
  /* The sync subscription's own handle — see {@link readHoldings}. */
  const syncOff = useRef<(() => void) | null>(null)
  useEffect(
    () => () => {
      syncOff.current?.()
      syncOff.current = null
    },
    [],
  )

  /* ---------------------------------------------------------------------- */
  /* The way back                                                            */
  /* ---------------------------------------------------------------------- */

  /** What this Passport's record says about a way back, or null. */
  const [recoveryRecord, setRecoveryRecord] = useState<BackupRecord | null>(null)
  /**
   * Whether the offer has been PRESSED and not yet answered.
   *
   * It exists because the press does not finish the job: it opens a provider's
   * own overlay, and on a phone that can mean leaving this app and coming back
   * to a fresh load of it. What comes back finds this false, the session
   * signed in, and the step still due — which is the state
   * `recoveryResumes` reads, and why the reader is not asked a second time.
   */
  const [recoveryIntended, setRecoveryIntended] = useState(false)
  /* One add at a time. A second run would ask for a second approval for an
     enrolment that is already away. */
  const recoveryRunning = useRef(false)
  /**
   * Where a running add of recovery has got to, for its timeline — null when
   * none is running. Set only from the add's own callbacks
   * (`../lib/recoveryAdd.ts#runRecoveryAdd`), never from a timer.
   */
  const [recoveryProgress, setRecoveryProgress] = useState<RecoveryAddProgress | null>(null)
  /**
   * Whether the key holding this Passport IS a provider key.
   *
   * There is nothing to offer such a Passport: the way back it would be given
   * is the key it is already held by. See `../lib/recoveryStep.ts`.
   */
  const heldBySocial = arm.kind === 'dynamic'
  const socialAvailable = social !== null && social.status !== 'disabled'
  /* The two answers above, where a callback made on an earlier render can read
     them — the same device {@link refresh} needs and for the same reason
     `userRef` exists. Written in an effect declared BEFORE the one that calls
     `refresh`, so the first read of the day already sees them. */
  const socialRef = useRef<CustodySocialSignIn | null>(social)
  const socialAvailableRef = useRef(socialAvailable)
  const heldBySocialRef = useRef(heldBySocial)
  useEffect(() => {
    socialRef.current = social
    socialAvailableRef.current = socialAvailable
    heldBySocialRef.current = heldBySocial
  })

  /** Re-reads what is stored and moves the screen to match it. */
  const refresh = useCallback((): DynamicPassportView | null => {
    const settled = userRef.current
    if (settled === null) return null
    const next = readDynamicPassport({ storage: window.localStorage, user: settled, network })
    setView(next)
    setInterrupted(dynamicSetupInterrupted(next.record))
    /* THE WAY BACK IS READ HERE AND NOWHERE ELSE, which is what makes the step
       resumable: nothing remembers that the reader was on it, so a browser
       closed on the offer comes back to the offer and one that answered it —
       either way — comes back to Home. */
    const record = loadRecoveryRecord(window.localStorage, settled, network)
    setRecoveryRecord(record)
    /* THE ONE PLACE THE SCREEN IS DECIDED, and it is decided from what is
       stored rather than from what just happened. `next.stage` is the old
       four-way answer and is still what says whether the setup is FINISHED —
       `name` and `home` are both "every step landed"; which of the two is
       shown is the name-first rule's to say, not this read's. */
    const decided = custodyNameFirstStage({
        setupStarted: next.record !== null,
        setupFinished: next.stage === 'name' || next.stage === 'home',
        claimedName: next.name,
        chosenName: next.chosenName,
        welcomeRead: welcomeReadRef.current,
        nameRegistering: nameClaimRef.current === 'running',
        recoveryDue: recoveryStepDue({
          setupFinished: next.stage === 'name' || next.stage === 'home',
          claimedName: next.name,
          socialAvailable: socialAvailableRef.current,
          heldBySocial: heldBySocialRef.current,
          record,
          nameRegistering: nameClaimRef.current === 'running',
        }),
      })
    setScreen(decided)
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

  /* Whether the read below is already running. See {@link healFromChain}. */
  const healing = useRef(false)

  /**
   * A RECORD THAT SAYS UNFINISHED OVER AN ACCOUNT THAT IS FINISHED.
   *
   * Live, 2026/09/22. The last step of a setup — turning the key on — was
   * proved, balanced, and included in a block, and the node's socket dropped
   * while this tab was waiting on it. The record was therefore never marked
   * done, and this screen offered the step again over an account that already
   * had it: the next press re-ran the circuit, the chain refused it because it
   * was already on, and the person was shown a generic failure about a Passport
   * that worked perfectly.
   *
   * So the record is no longer the last word. When it says the only thing left
   * is the activation, the account itself is asked, and an account that is
   * already on heals the record and moves the screen to the name step — with no
   * press, no approval, and nothing signed. A read that cannot be made, or an
   * account that genuinely is not on, changes nothing and leaves the offer
   * where it was.
   *
   * It re-runs on `error` as well as on the record, which is what makes a press
   * that failed this way correct itself in front of the person who made it.
   */
  useEffect(() => {
    const record = view?.record ?? null
    if (record === null || record.address === null) return
    if (nextCustodyStep(record) !== 'activate') return
    /* Not while a setup or a payment is running: that work reads the chain
       itself and writes the same record, and two writers lose each other. */
    if (healing.current || inFlight.current) return
    healing.current = true
    void (async () => {
      try {
        if ((await custodyAccountActivatedOnChain(record)) !== true) return
        saveCustodyRecord(window.localStorage, custodyActivatedRecord(record, null, null))
        setError(null)
        refresh()
      } catch (cause) {
        console.info('[account-custody] could not check whether this Passport is on yet', cause)
      } finally {
        healing.current = false
      }
    })()
  }, [error, refresh, view])

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
    setIdentityHeld(true)
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
      /* The same step, in the four words the Send sheet narrates with — it is
         the surface a payment is made from now, and the onboarding line above
         is not on screen at the time. See `custodySendPhase`. */
      setSendStep(phase.step)
      if (phase.txId === undefined) return
      /* WHERE THE TRAIL'S LINK COMES FROM. A ref rather than state because the
         send that is about to report itself reads this in the same tick it was
         written, before any render. */
      sentTxId.current = phase.txId
      const away: CustodyShieldedSendRecord = {
        ...record,
        sendTxId: phase.txId,
        sentAt: Date.now(),
        /* What the submit wrote, so a payment the chain never records can be
           taken back after a reload exactly as this tab would take it back. */
        undo: phase.undo
          ? {
              held: {
                colour: phase.undo.held.colour,
                nonce: phase.undo.held.nonce,
                value: phase.undo.held.value.toString(),
                mtIndex: phase.undo.held.mtIndex.toString(),
              },
              change: phase.undo.change
                ? { colour: phase.undo.change.colour, nonce: phase.undo.change.nonce }
                : null,
            }
          : null,
      }
      saveCustodyShieldedSend(window.localStorage, away)
      setStopped(away)
    },
    [setStopped],
  )

  /** The transaction the last payment went out in, for its trail row. */
  const sentTxId = useRef<string | null>(null)

  /**
   * A payment the chain never recorded, settled in the tab that sent it
   * (2026/09/22). The client has already taken its coin-store write back; what
   * is left is the record that says a payment is in flight, which would
   * otherwise stay on Home saying so. Every other failure passes through.
   */
  const settleNotSent = useCallback(
    async <T,>(record: CustodyShieldedSendRecord, work: () => Promise<T>): Promise<T> => {
      try {
        return await work()
      } catch (cause) {
        if (cause instanceof Error && cause.message === CUSTODY_SEND_NOT_SENT) {
          clearCustodyShieldedSend(window.localStorage, {
            network: record.network,
            accountAddress: record.accountAddress,
          })
          setStopped(null)
        }
        throw cause
      }
    },
    [setStopped],
  )

  /**
   * One finished payment, said in all three places it is owed: the trail, the
   * toast, and the quiet line the screen already had.
   *
   * ONE FUNCTION, because the two shielded routes — to a name and to a pasted
   * address — differ only in who the recipient is, and a payment reported two
   * ways is a payment described differently depending on how it was addressed.
   */
  const reportSent = useCallback(
    (sent: {
      asset: CustodyAssetRow
      amount: bigint
      recipientLabel: string
      network: string
    }) => {
      const txHash = sentTxId.current
      onActivity?.(
        custodySentEntry({
          amount: sent.amount,
          decimals: sent.asset.decimals,
          symbol: sent.asset.symbol,
          recipient: sent.recipientLabel,
          txHash,
        }),
      )
      /* The explorer where the id is a ledger hash, and otherwise the step
         verifier, which finds the payment by this Passport's name. */
      const receipt = txHash ? txReceiptLink(sent.network, txHash, view?.name ?? null) : null
      lastSentLink.current = receipt ? { label: 'View', href: receipt.href } : null
      pushToast({
        tone: 'success',
        /* Accepted, not yet included — the same claim every other send on this
           app makes, and the only one that is true at this moment. */
        title: custodySentToastTitle(sent.asset.mode === 'unshielded' ? 'unshielded' : 'shielded'),
        body: 'The network fee was covered on your behalf.',
        ...(txHash ? { link: txReceiptLink(sent.network, txHash) ?? undefined } : {}),
      })
      sentTxId.current = null
    },
    [onActivity, view],
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
      /* The timeline goes with the busy line: a panel left standing over a
         press that is over would be counting seconds nobody is waiting. */
      setSetupSignal(null)
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
   *
   * NOT AWAITED BY THE SETUP ANY MORE (2026/09/22). It was a minute of every
   * setup — the service pays both legs into the account before it answers —
   * and Home already shows the figures off the chain when they land. It is
   * asked behind Home once the last wave is in (`custodyOpeningBalanceDue`
   * says why not sooner), and answers whether a service ANSWERED: a refusal is
   * an answer, and a Passport that got one is not asked again.
   */
  const askForOpeningBalance = useCallback(async (contractAddress: string): Promise<boolean> => {
    for (const funderUrl of FUNDER_URLS) {
      try {
        const response = await fetch(`${funderUrl}/fund-account`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contractAddress }),
        })
        if (response.ok) return true
        const body: unknown = await response.json().catch(() => ({}))
        console.warn('[account-custody] the opening balance was refused', response.status, body)
        /* A verdict (4xx) is an answer; a busy or broken service (429, 5xx) is
           not, and the next open asks again. */
        return response.status < 500 && response.status !== 429
      } catch (cause) {
        console.warn('[account-custody] the opening balance could not be asked for', cause)
      }
    }
    return false
  }, [])

  /* ---------------------------------------------------------------------- */
  /* Making one                                                             */
  /* ---------------------------------------------------------------------- */

  /**
   * The registry's own answer about one name, asked as the person types.
   *
   * The ASK is a dynamic import for the reason this file's `midnamesText`
   * import gives; the debounce and the staleness token are the field's, in
   * {@link NameStep}, exactly as `AliasClaim.tsx` has done it since 2026/08/25.
   */
  const checkName = useCallback(
    async (alias: string): Promise<AliasAvailability> => {
      const { checkAliasAvailability } = await import('../identity/midnames.js')
      return checkAliasAvailability(network as PassportNetwork, alias)
    },
    [network],
  )

  /**
   * Registers the chosen name against an account that has been SUBMITTED.
   *
   * THE RE-READ BEFORE THE CLAIM IS NOT BELT AND BRACES. The name was chosen
   * before the setup, and a name is a first-come thing — so by the time there
   * is an account to bind it to, somebody else may hold it. Asking once more
   * costs one read and turns a refusal from the service into a sentence the
   * reader can act on, on a screen with a field in it. `fresh` because the
   * answer from the typing is exactly the answer that may have gone stale.
   *
   * WHAT A LOST RACE DOES NOT DO IS THROW THE PASSPORT AWAY. The account is
   * built, activated, and theirs; only the name went. See
   * {@link custodyNameRaceOutcome}.
   *
   * IT RUNS BESIDE THE SETUP, NOT AFTER IT (2026/09/22). The service accepts a
   * target that is submitted and not yet served (`targetPending`) and checks it
   * just before the registry call, a leaf deploy later — so the claim starts
   * the moment the deploy is submitted and overlaps the activation, instead of
   * waiting for the account, its key, and its opening balance in turn. It
   * therefore owns none of the press's busy line or timeline signal; it reports
   * where it is through {@link setNameClaim}, and a failure that is not a lost
   * race is said here, because the press it started beside may be long over.
   */
  const claimChosenName = useCallback(
    async (options: {
      alias: string
      user: string
      address: string
      /** Resolves when the deploy has landed; the service's own fallback. */
      awaitTarget?: () => Promise<unknown>
      clock?: CustodySetupClock | null
    }): Promise<void> => {
      const { alias, user: owner, address, clock = null } = options
      const networkLabel = NETWORK_LABELS[network as PassportNetwork] ?? network
      const loseTheRace = () => {
        const outcome = custodyNameRaceOutcome(aliasDomain(alias), networkLabel)
        forgetCustodyChosenName(window.localStorage, owner, network)
        setNameClaim('idle')
        setTaken(alias)
        setError(outcome.sentence)
        clock?.mark('name-taken')
        refresh()
      }

      setNameClaim('running')
      clock?.mark('name-claim-start')
      try {
        const [{ checkAliasAvailability, deriveMidnamesOwnerKey }, { sponsorAliasRegistrationAcross }, deps] =
          await Promise.all([
            import('../identity/midnames.js'),
            import('../identity/sponsoredAlias.js'),
            Promise.resolve(defaultCustodyDeps()),
          ])
        const stillFree = await checkAliasAvailability(network as PassportNetwork, alias, {
          fresh: true,
        })
        if (stillFree.status === 'taken') {
          loseTheRace()
          return
        }
        /* The name's owner secret comes from this device's own transaction key
           rather than from anything the sign-in holds, because the sign-in holds
           nothing a key can be derived from — its signatures carry fresh
           randomness every time (DKLs23), so there is nothing deterministic to
           hash. The consequence is written down in `dynamic-integration.md`: the
           name can be claimed here and cannot be re-pointed from a second device
           in this version. Coming back to the Passport does not need it. */
        const { custodyWalletSeed } = await import('../identity/custodyContractClient.js')
        const ownerKey = await deriveMidnamesOwnerKey(custodyWalletSeed(deps, owner))
        let claimed
        try {
          claimed = await sponsorAliasRegistrationAcross(
            FUNDER_URLS,
            {
              alias,
              ownerKey,
              contractAddress: address,
              network: network as 'stagenet',
              /* THE DEPLOY IS IN FLIGHT, and the service is told so: it checks
                 the target before the registry call rather than before it will
                 talk to us. Harmless for an account already served. */
              targetPending: true,
            },
            options.awaitTarget ? { awaitTarget: options.awaitTarget } : {},
          )
        } catch (cause) {
          if (custodyNameWasTaken(cause)) {
            loseTheRace()
            return
          }
          throw cause
        }
        /* KEPT FOR THE TRAIL AND FOR NOTHING ELSE. The row that says the name
           is registered is worth a link to the transaction that registered it;
           the name card needs no such thing, and neither does anything else on
           screen, so it is session state rather than another stored field. */
        setRegisterTxId(claimed.registerTxId ?? null)
        saveCustodyName(window.localStorage, owner, network, alias)
        forgetCustodyChosenName(window.localStorage, owner, network)
        setTaken(null)
        setNameClaim('done')
        clock?.mark('name-registered')
        refresh()
      } catch (cause) {
        /* NOT A LOST PASSPORT, AND NOT A LOST NAME EITHER. The chosen name is
           still written down, so the name step offers the claim again — which
           is where a claim that is no longer running always lands. */
        console.warn('[account-custody] the name could not be claimed this time', cause)
        setNameClaim('failed')
        setError(custodyFailureSentence(cause))
        clock?.mark('name-failed')
        refresh()
      }
    },
    [network, refresh, setNameClaim],
  )

  /**
   * Starts the claim, or joins the one that is already running.
   *
   * One claim per Passport at a time: a second press made while the first is
   * still with the service would ask for the same name twice, and the service
   * would answer the second with a refusal about a name this Passport holds.
   */
  const startNameClaim = useCallback(
    (options: Parameters<typeof claimChosenName>[0]): Promise<void> => {
      if (nameClaimRun.current !== null) return nameClaimRun.current
      const running = claimChosenName(options).finally(() => {
        nameClaimRun.current = null
      })
      nameClaimRun.current = running
      return running
    },
    [claimChosenName],
  )

  /**
   * Hands the waves after the deploy to the background. Assigned below, once
   * {@link finishInBackground} exists — it reads the holdings, which are
   * declared after this press.
   */
  const backgroundRef = useRef<(identity: CustodyIdentity, clock: CustodySetupClock | null) => Promise<void>>(
    () => Promise.resolve(),
  )

  /**
   * ONE PRESS: the approval, the account, the key — and the name beside them.
   *
   * THE ORDER, SINCE 2026/09/22, AND WHY. The press used to run nine dependent
   * transactions in a row — the deploy, three maintenance waves, the
   * activation, the opening balance, a resolver leaf, and the registration —
   * at twenty-odd seconds each on stagenet, 251 s measured. It now runs:
   *
   *   ceremony → deploy (wave 1) ─┬─ activation → Home
   *                               └─ name claim, from the moment the deploy
   *                                  is SUBMITTED, beside the activation
   *
   * and behind Home: waves 2 and up, then the opening balance. Wave 1 carries
   * every circuit a Passport held by this arm calls, so nothing a person can
   * do on Home waits on the waves; the one thing that does — adding a sign-in
   * as the way back — is gated on them (`recoveryStepDue`).
   *
   * The name is written down BEFORE the first transaction leaves, so a reload
   * in the middle comes back to a Passport that still knows what it is called;
   * and the name is written after {@link ensureIdentity} and not before it,
   * because on the passkey arm the key every store is filed under IS the
   * ceremony's output.
   */
  const createPassport = useCallback(
    (alias: string) => {
      setSetupName(alias)
      const clock = startSetupClock()
      setupClock.current = clock
      clock.mark('press')
      /* The BUTTON names the row that is running; the line under it counts the
         steps. Putting the same sentence on both would be the same words twice,
         which reads as a stutter rather than as progress. */
      void run(PHASE_LABELS.deploy, async () => {
        try {
          await setUp()
        } catch (cause) {
          /* A SUBMISSION THAT DID NOT GET THROUGH IS NOT A BROKEN PASSPORT
             (2026/09/23: "Transaction submission error", verbatim, over a
             setup that simply had not reached the chain). Everything here is
             resumable — the next press reads the chain first — so the
             sentence is the one that says so. */
          if (custodySubmissionLost(cause)) {
            console.warn('[account-custody] a setup step did not reach the network', cause)
            throw new Error(CUSTODY_SETUP_UNCONFIRMED)
          }
          throw cause
        }
      })
      async function setUp(): Promise<void> {
        /* The ceremony is the first thing the press costs, and it is the
           reader's own step — so the timeline names it before anything is
           asked of them rather than after they have answered. */
        setSetupSignal('identity')
        const settled = await ensureIdentity()
        clock.mark('identity')
        /* THE CONNECTION IS OPENED NOW, not while the name was typed: an idle
           socket is one the node closes, and the deploy must not go out on it. */
        await freshCustodyWallet(settled.userKey)
        clock.mark('connection')
        /* THE CEREMONY IS OVER THE MOMENT IT ANSWERS, and the timeline says so
           here rather than waiting for the custody road's first report. */
        setSetupSignal('deploy')
        const identity = settled.device
        const owner = settled.userKey
        saveCustodyChosenName(window.localStorage, owner, network, alias)
        /* An interrupted setup is thrown away first, so this press deploys a
           fresh Passport rather than pressing the same broken step again. The
           account already on chain is left where it is: it is dormant, it holds
           nothing, and there is no transaction that would tidy it away. */
        if (interrupted) {
          await startCustodyAccountAgain(arm.session, identity)
          setInterrupted(false)
        }
        const onPhase = (phase: CustodyPhase) => {
          setBusy(PHASE_LABELS[phase.step])
          clock.mark(phase.detail ? `phase:${phase.step}:${phase.detail}` : `phase:${phase.step}`)
          /* ONLY THE TWO THAT MOVE THE TIMELINE. `wallet`, `sign`, `submit`,
             and `confirm` are moments INSIDE one of these — advancing on the
             `confirm` that ends the activation would move the row to the name
             before the name had been asked for. */
          const signal = SETUP_SIGNAL_OF_STEP[phase.step]
          if (signal !== undefined) setSetupSignal(signal)
        }
        /* One wallet connection per user for the tab is `defaultCustodyDeps`'s
           own rule now, so the setup needs no seams of its own. */
        const deps = {}

        /* THE NAME, FROM THE MOMENT THE DEPLOY IS SUBMITTED. Not awaited here:
           it runs beside the activation, and Home is shown with the name card
           saying it is being registered if it is still running then. */
        let landed: () => void = () => undefined
        const deployLanded = new Promise<void>((resolve) => {
          landed = resolve
        })
        const claimFor = (address: string) => {
          /* A Passport that already holds its name is not asked to claim it. */
          if (readDynamicPassport({ storage: window.localStorage, user: owner, network }).name !== null) {
            return
          }
          void startNameClaim({ alias, user: owner, address, awaitTarget: () => deployLanded, clock })
        }

        let record = (
          await deployCustodyWaveOne(arm.session, identity, onPhase, deps, {
            onSubmitted: (address) => {
              clock.mark('deploy-submitted')
              claimFor(address)
            },
          })
        ).record
        landed()
        clock.mark('deploy-landed')
        if (record.address === null) {
          throw new Error('Your Passport is still being set up. Try again once it is ready.')
        }
        /* A deploy that had landed on an earlier press reports no submission;
           the claim starts here instead, against the address it already has. */
        claimFor(record.address)

        if (!record.activated) {
          record = (await activateK1Device(arm.session, identity, onPhase, deps)).record
        }
        clock.mark('activated')
        /* HOME, NOW. The screen is decided from what is stored plus whether the
           name's claim is still running (`custodyNameFirstStage`). */
        refresh()
        clock.mark('home')
        /* And behind it: the rest of the roster, then the opening balance. */
        void backgroundRef.current(settled, clock)
      }
    },
    [arm, ensureIdentity, interrupted, network, refresh, run, startNameClaim],
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
  /* The account's chain history as the last delivery walk read it, so the
     opening-balance rows can link to the sponsor's deposits. */
  const lastActionsRef = useRef<Awaited<ReturnType<typeof readCustodyActions>>>(null)
  /* Bumped each time a history read finishes (answered or not), so the
     opening rows are reconsidered after it rather than before it. */
  const [historyReads, setHistoryReads] = useState(0)

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
      const indexerHttpUrl = wallet.network.indexerHttpUrl
      /* The history is read first and kept for the opening rows' View links,
         whether or not there is a list to open below. */
      const actions = await readCustodyActions(indexerHttpUrl, account.address)
      lastActionsRef.current = actions
      setHistoryReads((count) => count + 1)
      /* No viewing secret, nothing to open the list with. That is a Passport
         restored from a name on a second device, and the sentence for it is not
         here — the row simply shows what the store holds. */
      if (encSecretKeyHex === null) return 0
      const reader = await accountModule.readCustodyAccountView({ indexerHttpUrl }, account.address)
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
           same way a spend's change is, and they go WHERE THE COIN GOES: into
           the held slot when the colour was empty, into the queue behind what
           was there when it was not. That second case is every first payment
           into a Passport still holding its opening grant, and until
           2026/09/21 it was where the description was dropped. */
        candidates: 'store',
      })
      /* WHAT THE CHAIN COULD NOT PLACE IS STILL HERE. A coin whose position the
         indexer has not answered for is demonstrably delivered and not yet
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

  /**
   * The figures, redrawn from the coin store alone — no chain, no wallet, no
   * wait. What a payment that has just been booked shows at once, before the
   * read that follows it has asked the chain anything.
   */
  const showStoreHoldings = useCallback(async (): Promise<void> => {
    const record = view?.record ?? null
    if (record?.address == null) return
    const account = { network: record.network, address: record.address }
    const { awaitingK1Coins, k1ColourHoldings } = await import('../identity/k1CoinStore.js')
    setTokens(
      k1ColourHoldings(account).map((holding) => ({ colourHex: holding.colour, amount: holding.value })),
    )
    setArriving(custodyArrivingCount({ awaitingRows: awaitingK1Coins(account).length, unplaced: null }))
  }, [setTokens, view])

  /* ONE READ AT A TIME. Home's effect, the Send sheet opening, a refresh, and
     the read after a payment all ask; the second of two overlapping asks waits
     for the first rather than opening the same questions again beside it. */
  const holdingsInFlight = useRef<Promise<void> | null>(null)

  /** What the Passport holds, in NIGHT and in every token it has been paid. */
  const readHoldings = useCallback((): Promise<void> => {
    if (holdingsInFlight.current !== null) return holdingsInFlight.current
    const reading = readHoldingsOnce().finally(() => {
      holdingsInFlight.current = null
    })
    holdingsInFlight.current = reading
    return reading
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, view, walkDeliveries])

  const readHoldingsOnce = async (): Promise<void> => {
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
      /* BOUNDED: a read that cannot open its connection says so and shows
         what the store holds, rather than holding every caller behind it. */
      const openedPair = await withinCustodyBound(
        Promise.all([deps.wallet(user), deps.contractModule()]),
        HOLDINGS_READ_WAIT_MS,
      )
      if (openedPair.kind === 'timeout') throw new Error('the connection did not open in time')
      const [wallet, contractModule] = openedPair.value
      opened = wallet
      /* THE SYNC BAR, SUBSCRIBED ONCE. Home paints a hairline strip while the
         wallet walks the chain, and it is the one thing about the wallet a
         person needs: nothing can be signed until it has caught up. Subscribed
         on the first read rather than per read, because the facade republishes
         on every applied index and a second listener would double the renders
         it causes. The handle is dropped when this screen goes. */
      if (syncOff.current === null) {
        syncOff.current = wallet.subscribeSyncProgress((progress) => {
          setSyncPercent(progress.percent)
        })
      }
      const providers = await deps.providers(wallet, record.privateStateId)
      const reader = providers.publicDataProvider as {
        queryContractState(address: string): Promise<{ data: unknown } | null>
      }
      const answered = await withinCustodyBound(
        reader.queryContractState(record.address),
        HOLDINGS_READ_WAIT_MS,
      )
      const state = answered.kind === 'done' ? answered.value : null
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
    /* THE STORE IS MADE TO AGREE WITH THE CHAIN FIRST (2026/09/22): a payment
       booked and never recorded is taken back, one the chain holds after all
       is put back, and a change coin that never existed stops reading as
       arriving. Only the indexer is asked, so it runs whether or not the
       connection above opened. See `reconcileCustodySpends`. */
    try {
      const indexerHttpUrl =
        opened?.network.indexerHttpUrl ??
        (await import('../lib/localWallet.js')).localWalletNetworkConfig().indexerHttpUrl
      await reconcileCustodySpends(account, indexerHttpUrl)
    } catch (cause) {
      console.info('[account-custody] the payments in flight could not be checked this time', cause)
    }
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
      /* ONLY NOW is a zero a real zero. Until this line nothing has asked the
         store anything, and the rows' own stablecoin row — which exists at zero
         by design — would otherwise be read as "paid nothing". */
      setHoldingsRead(true)
    } catch (cause) {
      console.warn('[account-custody] could not read what this Passport was paid', cause)
    }

    setStopped(
      loadCustodyShieldedSend(window.localStorage, {
        network: record.network,
        accountAddress: record.address,
      }),
    )
  }

  useEffect(() => {
    if (screen !== 'home') return
    void readHoldings()
  }, [readHoldings, screen])

  /* ---------------------------------------------------------------------- */
  /* Behind Home: the rest of the roster, then the opening balance          */
  /* ---------------------------------------------------------------------- */

  /**
   * Asks for the opening balance once the account can be paid into, and writes
   * down that it was answered.
   *
   * No ceremony: the grant needs the address and nothing else. A Passport the
   * service answered is never asked again (`custodyOpeningBalanceDue`).
   */
  const balanceAsking = useRef(false)
  /* Whether THIS tab has already asked once. The effect below asks at most once
     per tab, so a service that cannot be reached is not asked on every
     refresh; the waves' own finish always asks, because it is new news. */
  const balanceTried = useRef(false)
  const settleOpeningBalance = useCallback(
    async (record: CustodyAccountRecord, clock: CustodySetupClock | null): Promise<void> => {
      if (!custodyOpeningBalanceDue(record) || record.address === null) return
      /* One question at a time: the effect below re-runs on every refresh. */
      if (balanceAsking.current) return
      balanceAsking.current = true
      balanceTried.current = true
      try {
        clock?.mark('balance-asked')
        const answered = await askForOpeningBalance(record.address)
        clock?.mark(answered ? 'balance-answered' : 'balance-unanswered')
        if (!answered) return
        const latest = loadCustodyRecord(window.localStorage, record.user, record.network) ?? record
        saveCustodyRecord(window.localStorage, { ...latest, openingBalanceAsked: true })
      } finally {
        balanceAsking.current = false
      }
      refresh()
      void readHoldings()
    },
    [askForOpeningBalance, readHoldings, refresh],
  )

  /**
   * Lands the waves after the deploy, then asks for the opening balance.
   *
   * BEHIND HOME, AND RESUMABLE (2026/09/22). The waves install the other arm and
   * the grant circuits — nothing a Passport held by this arm calls — so nobody
   * waits for them; they are landed here after the key is on, one at a time,
   * each recorded only once the chain shows it (`finishCustodyWaves`). A tab
   * closed half-way leaves a record that says how far they got, and the next
   * time this device's key is settled they are picked up from there (see the
   * effect below). The opening balance follows the last wave because the
   * service cannot pay into an account that is missing any of its circuits.
   *
   * A FAILURE HERE IS NOT SHOWN AS ONE. The Passport works; the next settle of
   * the key tries again. The console says what happened, for whoever is
   * measuring.
   */
  /* When the last background run stopped short, so a failure that comes back
     at once is not retried on every render. */
  const wavesStoppedAt = useRef<number | null>(null)
  const finishInBackground = useCallback(
    (identity: CustodyIdentity, clock: CustodySetupClock | null): Promise<void> => {
      if (wavesRun.current !== null) return wavesRun.current
      const settled = userRef.current
      const stored =
        settled === null ? null : loadCustodyRecord(window.localStorage, settled, network)
      if (stored === null) return Promise.resolve()
      /* THE WAVES, AND ONLY THE WAVES, are what a caller waits on — adding the
         way back waits for them, and must not also wait out a minute of the
         opening balance behind them. */
      const waves = (async (): Promise<CustodyAccountRecord | null> => {
        if (!custodyWavesPending(stored)) return stored
        clock?.mark('waves-start')
        try {
          const finished = (
            await finishCustodyWaves(
              arm.session,
              identity.device,
              (phase) => {
                if (phase.step === 'waves') {
                  clock?.mark(`wave-${phase.detail ?? ''}`.replace(/\s+/g, '-'))
                }
              },
              {},
            )
          ).record
          clock?.mark('waves-done')
          wavesStoppedAt.current = null
          return finished
        } catch (cause) {
          clock?.mark('waves-stopped')
          wavesStoppedAt.current = Date.now()
          console.warn('[account-custody] the rest of this Passport could not be finished this time', cause)
          return null
        }
      })()
      const running = waves
        .then(() => undefined)
        .finally(() => {
          wavesRun.current = null
          refresh()
        })
      wavesRun.current = running
      /* Then the opening balance, behind the waves and awaited by nobody. */
      void waves.then((record) => (record === null ? undefined : settleOpeningBalance(record, clock)))
      return running
    },
    [arm.session, network, refresh, settleOpeningBalance],
  )
  backgroundRef.current = finishInBackground

  /**
   * "FINISH SETUP" ON HOME — THE WAY OUT OF THE DEADLOCK OF 2026/09/24.
   *
   * The effect below picks the waves up only once the key is held in this tab,
   * and never prompts for it. A tab closed in the minute after Home therefore
   * left the rest pending with no key on every later open: nothing landed it,
   * the opening balance behind it was never asked for, and there was no money
   * for a payment that would have settled the key. So Home offers the press
   * (`custodyFinishSetupCard`), and the press settles the key through the same
   * {@link ensureIdentity} every other press uses — a browser allows a prompt
   * somebody pressed for — and runs {@link finishInBackground}, which asks for
   * the opening balance after the last wave exactly as it does after setup.
   *
   * Stopped short means the record still has waves pending once the run is
   * over, or the key was not settled; either is one sentence and the press
   * again. The cause goes to the console.
   */
  const [finishPress, setFinishPress] = useState<'running' | 'failed' | null>(null)
  const finishPressing = useRef(false)
  const finishSetup = useCallback(async (): Promise<void> => {
    if (finishPressing.current) return
    finishPressing.current = true
    setFinishPress('running')
    try {
      const identity = await ensureIdentity()
      await finishInBackground(identity, setupClock.current)
      const settled = userRef.current
      const latest = settled === null ? null : loadCustodyRecord(window.localStorage, settled, network)
      setFinishPress(latest !== null && custodyWavesPending(latest) ? 'failed' : null)
    } catch (cause) {
      console.warn('[account-custody] the rest of this Passport could not be finished from Home', cause)
      setFinishPress('failed')
    } finally {
      finishPressing.current = false
    }
  }, [ensureIdentity, finishInBackground, network])

  /**
   * PICKS THE BACKGROUND WORK BACK UP, whenever it can be done without asking.
   *
   * The opening balance needs nobody, so a Passport whose last wave landed and
   * whose balance was never asked for is asked on open. The waves need this
   * device's key — a passkey's maintenance authority is derived from it and
   * written nowhere — so they resume the moment the key is settled in this tab
   * for any reason: the setup press, a payment, adding the way back. Never by
   * prompting on open: a browser refuses a passkey prompt nobody pressed for,
   * and a fingerprint asked for out of nowhere is the one thing about this that
   * a person would notice.
   */
  useEffect(() => {
    const record = view?.record ?? null
    if (record === null) return
    const work = custodyBackgroundWork({
      wavesPending: custodyWavesPending(record),
      openingBalanceDue: custodyOpeningBalanceDue(record),
      keyHeld: identityHeld && device.current !== null,
      busy: inFlight.current || wavesRun.current !== null || balanceAsking.current,
      balanceTried: balanceTried.current,
      wavesStoppedMsAgo:
        wavesStoppedAt.current === null ? null : Date.now() - wavesStoppedAt.current,
    })
    if (work === 'waves' && device.current !== null) {
      void finishInBackground(device.current, setupClock.current)
    } else if (work === 'opening-balance') {
      void settleOpeningBalance(record, setupClock.current)
    }
  }, [finishInBackground, identityHeld, settleOpeningBalance, view])

  /**
   * A STOPPED PAYMENT, ANSWERED FROM THE CHAIN (2026/09/22).
   *
   * A record with a transaction behind it used to be reported with a hedge —
   * "either it reached them or nothing left" — and left for the reader to work
   * out from the balance. The chain can say which, so it is asked: the indexer
   * has the transaction (sent), or it answered that it does not and the wait a
   * payment is given has passed (not sent: the coin-store write is taken back
   * and the record cleared). Only while neither is known — inside the wait, or
   * an indexer that cannot be reached — does the line say it is checking, and
   * it asks again.
   */
  useEffect(() => {
    const record = stopped
    if (record === null || record.stage !== 'sending' || record.sendTxId === null) return
    if (inFlight.current) return
    const txId = record.sendTxId
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = async (): Promise<void> => {
      const [{ resolveTxOnChainOnce }, { localWalletNetworkConfig }] = await Promise.all([
        import('../identity/contractRuntime.js'),
        import('../lib/localWallet.js'),
      ])
      const onChain = await resolveTxOnChainOnce(localWalletNetworkConfig().indexerHttpUrl, txId)
      if (!live || inFlight.current) return
      const verdict = custodyStoppedSendVerdict({ record, onChain, now: Date.now() })
      if (verdict === 'checking') {
        timer = setTimeout(() => void check(), 15_000)
        return
      }
      if (verdict === 'not-landed') {
        /* TAKEN BACK BY THE STORE, ON THE CHAIN'S WORD — the same reconciliation
           every read runs, so a booking is set aside (and put back if it lands
           after all) rather than forgotten, and a record from an older build
           with nothing to take back by is answered by the store's own rules. */
        try {
          await reconcileCustodySpends(
            { network: record.network, address: record.accountAddress },
            localWalletNetworkConfig().indexerHttpUrl,
          )
        } catch (cause) {
          console.warn('[account-custody] the payment that did not land could not be taken back', cause)
        }
      }
      clearCustodyShieldedSend(window.localStorage, {
        network: record.network,
        accountAddress: record.accountAddress,
      })
      setStopped(null)
      setNotice(custodyStoppedSendSentence(record, verdict))
      if (verdict === 'not-landed') void readHoldings()
    }
    void check()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [readHoldings, setStopped, stopped])

  /* ---------------------------------------------------------------------- */
  /* The trail                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * Writes down each thing that has happened, once, the moment it is TRUE.
   *
   * WHY IT IS AN OBSERVER AND NOT FIVE CALL SITES. Three of these five facts
   * are things this tab did — the account was made, the key was turned on, the
   * name was registered — and two are things that happen TO the Passport: the
   * opening NIGHT and the stablecoin are deposited on its behalf, and nothing
   * here is waiting on either. A Passport whose deposit lands after the tab was
   * closed would get no row at all from a call site, and a Passport opened for
   * the first time on a second device would get none of the five. An observer
   * over what is now true gets all of them, in the order they happened, whenever
   * the reader happens to look.
   *
   * ONCE PER ACCOUNT, and the marks are stored under the account rather than
   * held in memory, because the whole point is that a reload must not repeat
   * them. `../lib/custodyHome.ts` owns both the rule and the key.
   *
   * NOTHING IS OWED ON A NULL. A balance nobody has read is not a balance of
   * zero — see `custodyMilestonesLanded`.
   */
  useEffect(() => {
    const record = view?.record ?? null
    const address = record?.address ?? null
    if (onActivity === undefined || record === null || address === null) return
    const key = custodyActivityMarkKey(record.network, address)
    let written: string[] = []
    try {
      const raw = window.localStorage.getItem(key)
      const parsed: unknown = raw === null ? [] : JSON.parse(raw)
      if (Array.isArray(parsed)) written = parsed.filter((row): row is string => typeof row === 'string')
    } catch {
      /* Storage blocked or unreadable. A trail is a convenience; the worst this
         costs is a row written twice, which is better than a Passport whose
         history is blank. */
      written = []
    }
    const holdings = {
      night: balance,
      shielded: tokens,
      balanceFailed,
      stablecoinColourHex: STABLECOIN_COLOUR,
      arriving,
    }
    const owed = custodyMilestonesLanded({
      written,
      hasAccount: true,
      activated: record.activated,
      name: view?.name ?? null,
      night: balance,
      stablecoin: custodyStablecoinHeld(holdings, holdingsRead),
    })
    if (owed.length === 0) return
    const stablecoinRow = custodyAssetRow(custodyAssetRows({
      night: balance,
      shielded: tokens,
      stablecoinColourHex: STABLECOIN_COLOUR,
    }), STABLECOIN_COLOUR)
    const writtenNow: typeof owed = []
    for (const milestone of owed) {
      const opening = milestone === 'opening-night' || milestone === 'opening-stablecoin'
      const txHash = opening
        ? custodyOpeningDepositTxHash(milestone, lastActionsRef.current)
        : custodyMilestoneTxHash(milestone, record.txHashes, registerTxId)
      /* An opening row waits only until the history has been READ, so it is
         written once and with its View link; a history that holds no such
         deposit writes the row without one rather than never. */
      if (opening && txHash === null && historyReads === 0) continue
      onActivity(
        custodyMilestoneEntry(milestone, {
          name: view?.name ?? null,
          ...(stablecoinRow ? { stablecoinSymbol: stablecoinRow.symbol } : {}),
          txHash,
        }),
      )
      writtenNow.push(milestone)
    }
    if (writtenNow.length === 0) return
    try {
      window.localStorage.setItem(key, JSON.stringify([...written, ...writtenNow]))
    } catch {
      // As above: nothing on screen depends on the write succeeding.
    }
  }, [
    arriving,
    balance,
    balanceFailed,
    historyReads,
    holdingsRead,
    onActivity,
    registerTxId,
    tokens,
    view,
  ])

  /* ---------------------------------------------------------------------- */
  /* Paying somebody                                                        */
  /* ---------------------------------------------------------------------- */

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
      /* Nothing to write down for a payment that kept no change. */
      if (params.change == null) return
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
    }): Promise<() => Promise<void>> => {
      const { account, amount, asset, label, record, wallet } = params
      const [store, accountModule] = await Promise.all([
        import('../identity/k1CoinStore.js'),
        import('../identity/accountCustody.js'),
      ])
      const indexerHttpUrl = wallet.network.indexerHttpUrl
      const held = store.heldK1Coin(account, asset.colourHex)
      /* READ FROM THE CHAIN, never remembered: an account rotates its
         encryption key, and a description sealed to one it has rotated away
         from is a coin its holder can never open.

         THIS READ IS THE REFUSAL'S, NOT THE SEAL'S. It answers one question —
         does this recipient advertise a key at all — so the payment can be
         refused before anybody is asked to approve anything. The key the coin
         is actually SEALED to is read again, by the send engine, immediately
         before it seals: everything in between is an approval and a proof, and
         on the passkey arm that is a person walking to their phone. */
      const readRecipientEncKey = async (): Promise<string | null> =>
        (await accountModule.readCustodyAccountView({ indexerHttpUrl }, params.recipientAccountAddress))
          .encKeyHex
      const recipientEncKeyHex =
        params.recipientModule === 'account-custody'
          ? await beforePayment(readRecipientEncKey(), 'reading the recipient')
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
      const sent = await settleNotSent(stoppedRecord, () => paymentEngine().withdrawShieldedToContractK1(
        arm.session,
        identity,
        {
          recipientAccountAddress: plan.transfer.contractAddress,
          /* READ AGAIN AT SEAL TIME. The plan's copy is what the refusal above
             was decided on; the seal uses what the account advertises when the
             seal happens, and refuses rather than sealing to nothing. */
          readRecipientEncKey: async () => {
            const live = await readRecipientEncKey()
            if (live === null) {
              throw new Error('This Passport could not prepare that payment. Nothing was sent.')
            }
            return live
          },
          colourHex: plan.transfer.colourHex,
          amount: plan.transfer.amount,
        },
        sendPhase(stoppedRecord),
      ))
      clearCustodyShieldedSend(window.localStorage, {
        network: record.network,
        accountAddress: account.address,
      })
      setStopped(null)
      setNotice(custodyShieldedSendOutcome({ ...stoppedRecord, stage: 'done' }))
      /* THE TIDY-UP IS HANDED BACK, NOT AWAITED. It is a gated call of its own,
         so it still runs under the payment's flag — two gated calls against one
         account must never sign against the same `auth_nonce` — but the sheet
         is not held on it. See `runCustodyPayment`. */
      return () => backfillChange({ wallet, record, identity, change: sent.change })
    },
    [arm, backfillChange, ensureIdentity, sendPhase, setStopped, settleNotSent],
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
    }): Promise<() => Promise<void>> => {
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

      /* BOTH KEYS COME OUT OF THE ADDRESS, and the decode is also the CHECK
         that the address belongs to the network this Passport is on — a
         payment to an address from another network lands somewhere nobody
         here can reach.

         IT HAPPENS BEFORE ANYTHING IS WRITTEN OR ASKED FOR. It used to run
         after the stopped-send record was saved and after the approval: an
         address from the wrong network therefore cost a fingerprint or a
         sign-in prompt, and left a record on screen saying a payment was in
         flight that had never been built. The decode asks nothing of anybody
         and can only refuse, so it goes first, and the refusal arrives before
         the person is interrupted. */
      const keys = await accountModule.decodeShieldedRecipient(
        plan.recipientShieldedAddress,
        wallet.network.networkId,
      )

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
      const sent = await settleNotSent(stoppedRecord, () => paymentEngine().withdrawShieldedK1(
        arm.session,
        identity,
        {
          recipientCoinPublicKey: keys.coinPublicKey,
          recipientEncryptionPublicKey: keys.encryptionPublicKey,
          colourHex: plan.colourHex,
          amount: plan.amount,
        },
        sendPhase(stoppedRecord),
      ))
      clearCustodyShieldedSend(window.localStorage, {
        network: record.network,
        accountAddress: account.address,
      })
      setStopped(null)
      setNotice(custodyShieldedSendOutcome({ ...stoppedRecord, stage: 'done' }))
      /* As above: under the payment's flag, and not holding the sheet. */
      return () => backfillChange({ wallet, record, identity, change: sent.change })
    },
    [arm, backfillChange, ensureIdentity, sendPhase, setStopped, settleNotSent],
  )

  /* ---------------------------------------------------------------------- */
  /* The Send sheet's four seams                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * Everything this Passport holds, named once for every surface that reads it.
   *
   * MEMOISED BECAUSE IT IS AN IDENTITY, not for speed: the seams below close
   * over it, and a fresh array on every render would rebuild every one of them
   * on every render, which is a new `onSend` handed to an open Send sheet in
   * the middle of a payment.
   */
  const assetRows = useMemo(
    () =>
      custodyAssetRows({
        night: balance,
        shielded: tokens,
        stablecoinColourHex: STABLECOIN_COLOUR,
      }),
    [balance, tokens],
  )

  /**
   * ONE PAYMENT AT A TIME, AND IT THROWS RATHER THAN PAINTING.
   *
   * THIS IS NOT {@link run}. `run` is onboarding's runner: it puts a label on
   * this screen's own busy line and turns a failure into a sentence on this
   * screen's own error card. Neither of those is on screen when a payment is
   * made now — the Send sheet is, and it has a busy state, a review step, and a
   * failure panel of its own, which is where a person making a payment is
   * looking. So the seam does the one thing the sheet cannot do for itself —
   * hold the coin store against the read that fires from an effect — and lets
   * the failure out to the surface that asked for it.
   *
   * The follow-up read runs AFTER the flag is cleared, for the reason
   * `runCustodyWork` exists: a read from inside the payment reads the figures
   * from before it.
   */
  const runPayment = useCallback(
    async (
      payment: { subject: SendProgressSubject; draft: SendDraft },
      work: () => Promise<(() => Promise<void>) | void>,
    ): Promise<void> => {
      /* THE PILL IS UP FROM THE PRESS (2026/09/25). The Send sheet has closed by
         now, so this is the only thing on screen that says a payment is
         running — including the second or two before its record is written. */
      dispatchProgress({ type: 'start', subject: payment.subject, draft: payment.draft, at: Date.now() })
      const refusal = custodyInFlightRefusal(inFlight.current)
      if (refusal !== null) {
        dispatchProgress({ type: 'failed', sentence: refusal, handedOver: false })
        throw new Error(refusal)
      }
      setError(null)
      lastSentLink.current = null
      /* THE SHEET HAS ITS ANSWER THE MOMENT THE PAYMENT HAS ONE (2026/09/22):
         the tidy-up and the read that follow run on without it — see
         `runCustodyPayment` — and the figures are redrawn from the store at
         once, so "Sent" never sits over the balance from before. */
      const { failure } = await runCustodyPayment(inFlight, work, readHoldings)
      void showStoreHoldings()
      setBusy(null)
      setSendStep(null)
      if (failure === null) {
        dispatchProgress({ type: 'sent', link: lastSentLink.current })
        lastSentLink.current = null
        return
      }
      console.warn('[account-custody] that payment did not finish', failure)
      /* THE PILL GETS A SENTENCE, THE CONSOLE GETS THE CAUSE — the same rule
         `run` follows, and for the same reason: a cause from a vendor, a WASM
         deserialiser, or a node carries exactly the words this app keeps off
         its screens. */
      const sentence = custodyFailureSentence(failure)
      /* WHICH OF TWO FAILURES THIS IS, and the record says. A payment that has
         a transaction id was handed to the network, and whether it landed is
         the chain's to say: the record stays, and the pill shows it as
         confirming until the chain answers. One with no id never left — the
         approval was refused, the proof never came — so the record has nothing
         more to tell anybody, and the sentence is the whole answer. */
      const record = view?.record ?? null
      const written =
        record?.address == null
          ? null
          : loadCustodyShieldedSend(window.localStorage, {
              network: record.network,
              accountAddress: record.address,
            })
      const handedOver = written !== null && written.sendTxId !== null
      if (written !== null && !handedOver) {
        clearCustodyShieldedSend(window.localStorage, {
          network: written.network,
          accountAddress: written.accountAddress,
        })
        setStopped(null)
      }
      dispatchProgress({ type: 'failed', sentence, handedOver })
      throw new Error(sentence)
    },
    [readHoldings, setStopped, showStoreHoldings, view],
  )

  /**
   * Who a payment is for and how much, in the pill's words, and the draft that
   * "Try again" reopens the sheet on — both built from exactly what the sheet
   * handed over, before anything is awaited.
   */
  const paymentOf = useCallback(
    (input: {
      asset: CustodyAssetRow | null
      amount: bigint
      recipient: string
      /** The recipient as the pill names it; the typed text when omitted. */
      recipientLabel?: string
      assetId: string
    }): { subject: SendProgressSubject; draft: SendDraft } => ({
      subject: {
        amount: input.asset ? formatCustodyAmount(input.amount, input.asset.decimals) : input.amount.toString(),
        symbol: input.asset?.symbol ?? '',
        recipient: input.recipientLabel ?? input.recipient,
      },
      draft: { assetId: input.assetId, recipient: input.recipient, amount: input.amount.toString() },
    }),
    [],
  )

  /**
   * The registry's answer about one name, in the shape the sheet expects.
   *
   * REFUSED IN A SENTENCE AND NOT AS AN ERROR, in every case: a name nobody
   * holds, a name pointing somewhere that is not a Passport account, and a
   * lookup that could not be made are three different things a person can act
   * on, and the field says which.
   */
  const resolveName = useCallback(
    async (
      typed: string,
    ): Promise<{ found: true; domain: string; accountAddress: string } | { found: false; reason: string }> => {
      let label: string
      try {
        label = normalizePassportAlias(typed)
      } catch {
        return { found: false, reason: 'That is not a Midnight name.' }
      }
      const { resolveAliasTarget } = await import('../identity/midnames.js')
      const resolved = await resolveAliasTarget(network as 'stagenet', label)
      if (!resolved || resolved.target.kind !== 'contract') {
        return { found: false, reason: `No Passport is registered under ${aliasDomain(label)}.` }
      }
      /* An all-zero target is a name that was never pointed at anything.
         Treating it as an account would send money to nobody. */
      if (/^0*$/.test(resolved.target.hex)) {
        return {
          found: false,
          reason: `${aliasDomain(label)} is registered, but no Passport has been attached to it yet.`,
        }
      }
      return { found: true, domain: aliasDomain(label), accountAddress: resolved.target.hex }
    },
    [network],
  )

  /**
   * A shielded amount out to a name, in ONE transaction.
   *
   * The sheet has already resolved the name and hands the account it points at,
   * so nothing is resolved twice; what is still this seam's to do is read which
   * build holds that account, because a recipient on a different build is a
   * payment that must be refused rather than sent somewhere it cannot be opened
   * — `custodyShieldedSendRefusal` owns that sentence.
   */
  const sendShieldedToName = useCallback(
    async (params: {
      domain: string
      accountAddress: string
      tokenType: string
      amount: bigint
    }): Promise<void> => {
      const payment = paymentOf({
        asset: custodyAssetRow(assetRows, params.tokenType),
        amount: params.amount,
        recipient: params.domain,
        assetId: params.tokenType,
      })
      await runPayment(payment, async () => {
        setNotice(null)
        const { account, record, wallet } = await beforePayment(custodyContext(), 'opening this Passport')
        const asset = custodyAssetRow(assetRows, params.tokenType)
        if (asset === null) throw new Error('This Passport does not hold that token.')
        const { accountModuleFor } = await import('../identity/accountCustody.js')
        const recipientModule = await beforePayment(
          accountModuleFor({ indexerHttpUrl: wallet.network.indexerHttpUrl }, params.accountAddress),
          'reading the recipient',
        )
        const label = normaliseNameForRecovery(params.domain)
        const tidyUp = await sendShielded({
          wallet,
          record,
          account,
          label,
          asset,
          amount: params.amount,
          recipientAccountAddress: params.accountAddress,
          recipientModule,
        })
        reportSent({
          asset,
          amount: params.amount,
          recipientLabel: params.domain,
          network: record.network,
        })
        return tidyUp
      })
    },
    [assetRows, custodyContext, paymentOf, reportSent, runPayment, sendShielded],
  )

  /**
   * NIGHT out to an unshielded (`mn_addr…`) address, in ONE gated transaction.
   *
   * `withdraw_unshielded_with_<arm>` debits the account's NIGHT mirror by
   * exactly the amount and pays the address; there is no coin to split and no
   * change to put back, so a partial amount is simply a smaller debit. The
   * address is decoded — and checked against this Passport's network — before
   * anybody is asked to approve anything.
   */
  const sendNightToAddress = useCallback(
    async (params: { recipientAddress: string; amount: bigint }): Promise<void> => {
      const address = params.recipientAddress.trim()
      const payment = paymentOf({
        asset: assetRows.find((row) => row.mode === 'unshielded') ?? null,
        amount: params.amount,
        recipient: address,
        recipientLabel: shortHex(address),
        /* The sheet's own id for NIGHT — `NIGHT_ASSET_ID` in
           `../lib/sendAssets.ts`. */
        assetId: 'night',
      })
      await runPayment(payment, async () => {
        setNotice(null)
        const { account, record, wallet } = await beforePayment(custodyContext(), 'opening this Passport')
        if (!record.activated) {
          throw new Error('Your Passport is still being set up. Try again once it is ready.')
        }
        if (params.amount <= 0n) throw new Error('Enter an amount greater than zero.')
        const accountModule = await import('../identity/accountCustody.js')
        const asset = custodyAssetRow(assetRows, accountModule.nightColourHex())
        if (asset === null) throw new Error('This Passport does not hold that token.')
        if (asset.amount !== null && params.amount > asset.amount) {
          throw new Error('You do not hold enough to send that.')
        }
        const recipient = accountModule.unshieldedAddressBytes(address, wallet.network.networkId)
        /* WRITTEN DOWN BEFORE IT GOES OUT, as a shielded payment is (2026/09/25),
           so a reload in the middle of one shows the same pill — confirming,
           once the transaction has an id — rather than nothing at all. It is
           the same one-per-account record; there is no coin to take back for
           NIGHT, so it carries no undo, and the chain's answer is all it waits
           for. */
        const stoppedRecord = newCustodyShieldedSend({
          network: record.network,
          accountAddress: account.address,
          colourHex: asset.colourHex,
          amount: params.amount,
          recipientLabel: shortHex(address),
          recipientAccountAddress: '',
          now: Date.now(),
        })
        saveCustodyShieldedSend(window.localStorage, stoppedRecord)
        setStopped(stoppedRecord)
        setBusy(arm.approvalPrompt)
        const { device: identity } = await ensureIdentity()
        const sent = await settleNotSent(stoppedRecord, () =>
          paymentEngine().withdrawUnshieldedK1(
            arm.session,
            identity,
            { recipient, colourHex: accountModule.nightColourHex(), amount: params.amount },
            sendPhase(stoppedRecord),
          ),
        )
        clearCustodyShieldedSend(window.localStorage, {
          network: stoppedRecord.network,
          accountAddress: stoppedRecord.accountAddress,
        })
        setStopped(null)
        sentTxId.current = sent.txHash
        reportSent({
          asset,
          amount: params.amount,
          recipientLabel: shortHex(address),
          network: record.network,
        })
      })
    },
    [
      arm,
      assetRows,
      custodyContext,
      ensureIdentity,
      paymentOf,
      reportSent,
      runPayment,
      sendPhase,
      setStopped,
      settleNotSent,
    ],
  )

  /**
   * Whether the Passport a recipient resolved to can be paid from this one.
   * Asked by the Send sheet when the name resolves, so an older Passport is
   * refused under the field, before Review — never after an approval.
   */
  const checkRecipientAccount = useCallback(
    async (input: { accountAddress: string; name: boolean }): Promise<string | null> => {
      /* The indexer from configuration, not from an open wallet: this is asked
         while somebody types, and opening a wallet for it would be seconds. */
      const [{ accountModuleFor }, { localWalletNetworkConfig }] = await Promise.all([
        import('../identity/accountCustody.js'),
        import('../lib/localWallet.js'),
      ])
      const build = await accountModuleFor(
        { indexerHttpUrl: localWalletNetworkConfig().indexerHttpUrl },
        input.accountAddress,
      )
      return custodyRecipientAccountRefusal(build, input.name ? 'name' : 'account')
    },
    [],
  )

  /** The same amount, out to a shielded address somebody pasted or scanned. */
  const sendShieldedToPastedAddress = useCallback(
    async (params: {
      recipientAddress: string
      tokenType: string
      amount: bigint
    }): Promise<void> => {
      const payment = paymentOf({
        asset: custodyAssetRow(assetRows, params.tokenType),
        amount: params.amount,
        recipient: params.recipientAddress.trim(),
        recipientLabel: shortHex(params.recipientAddress.trim()),
        assetId: params.tokenType,
      })
      await runPayment(payment, async () => {
        setNotice(null)
        const { account, record, wallet } = await beforePayment(custodyContext(), 'opening this Passport')
        const asset = custodyAssetRow(assetRows, params.tokenType)
        if (asset === null) throw new Error('This Passport does not hold that token.')
        const tidyUp = await sendShieldedToAddress({
          wallet,
          record,
          account,
          asset,
          amount: params.amount,
          shieldedAddress: params.recipientAddress.trim(),
        })
        reportSent({
          asset,
          amount: params.amount,
          recipientLabel: shortHex(params.recipientAddress.trim()),
          network: record.network,
        })
        return tidyUp
      })
    },
    [assetRows, custodyContext, paymentOf, reportSent, runPayment, sendShieldedToAddress],
  )

  /**
   * What the picker may offer, read again when the sheet opens.
   *
   * THE ROWS ON SCREEN ARE HANDED TO THE SHEET SEPARATELY so its first frame is
   * already populated; this is the re-read behind them, and it is the answer a
   * send is enabled against. Both come out of `../lib/custodyHome.ts`, so the
   * strip, the shelf, and the picker cannot disagree.
   */
  /* ONE SEAM FOR THE LIFE OF THE SCREEN (2026/09/25). It used to close over
     the four figures below, so the read it starts — which sets those figures —
     handed the open Send sheet a NEW seam every time it answered, and the
     sheet asked again: an endless loop of account reads, and Home re-rendered
     around every one of them, for as long as Send was open. The figures are
     read through a ref instead, after the read has had a turn to land. */
  const sendableRef = useRef({ arriving, balance, balanceFailed, tokens })
  sendableRef.current = { arriving, balance, balanceFailed, tokens }
  const readHoldingsRef = useRef(readHoldings)
  readHoldingsRef.current = readHoldings
  const readShieldedHoldings = useCallback(async (): Promise<
    { tokenType: string; amount: bigint }[]
  > => {
    /* Bounded: the picker opens on what is known rather than waiting on a
       read that may not come back. */
    await withinCustodyBound(readHoldingsRef.current(), HOLDINGS_READ_WAIT_MS)
    /* One turn for React to commit what the read set, so the ref holds it. */
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    const latest = sendableRef.current
    return custodyHomeSendableHoldings({
      night: latest.balance,
      shielded: latest.tokens,
      balanceFailed: latest.balanceFailed,
      stablecoinColourHex: STABLECOIN_COLOUR,
      arriving: latest.arriving,
    })
  }, [])

  /** Forgets a payment the person has been told about. */
  const dismissStoppedSend = useCallback(() => {
    const record = view?.record ?? null
    if (record?.address == null) return
    clearCustodyShieldedSend(window.localStorage, {
      network: record.network,
      accountAddress: record.address,
    })
    setStopped(null)
  }, [setStopped, view])

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
      /**
       * FOUND BY A SIGN-IN, AND HANDED TO A KEY THIS DEVICE MAKES.
       *
       * The check above is the whole of what a sign-in is for on this road: the
       * name resolved, and the key behind the sign-in is one of the account's
       * own devices. What it is NOT for is holding the Passport afterwards —
       * that is the ruling of 2026/09/22 — so nothing is filed under the
       * sign-in's key here. The account is written down and the host is asked
       * for a key of this device's own; the second half runs under that key and
       * enrols it, with the sign-in approving. See `../identity/custodyAdopt.ts`.
       */
      if (arm.kind === 'dynamic' && onRecoverToDeviceKey !== null) {
        const handoff: AdoptionHandoff = {
          network,
          address,
          name: label,
          socialUser: restoredUser,
        }
        saveAdoption(window.localStorage, handoff)
        onRecoverToDeviceKey(handoff)
        return outcome
      }
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
    [arm.kind, ensureIdentity, network, onRecoverToDeviceKey, refresh],
  )

  /* ---------------------------------------------------------------------- */
  /* Adding the way back                                                     */
  /* ---------------------------------------------------------------------- */

  /**
   * Puts the provider's key on this account as a SECOND device.
   *
   * ONE APPROVAL, AND IT IS THE KEY ON THIS DEVICE THAT GIVES IT. The key being
   * added is not on the account yet and so cannot approve its own enrolment;
   * the key that already holds the Passport can, which is why the signer here
   * is this device's and the argument is the provider's. `addDeviceK1` is
   * idempotent — a key already on the account returns without asking for
   * anything — so a run repeated after a browser was closed costs nothing.
   *
   * A FAILURE IS NOT A FAILURE OF THE PASSPORT, and the sentence says so. What
   * is offered underneath is the same thing that was offered before the press:
   * Home. See `../lib/recoveryAdd.ts#recoveryAddFailureSentence`.
   */
  const runRecoveryAdd = useCallback(
    async (signIn: CustodySocialSignIn): Promise<void> => {
      if (recoveryRunning.current) return
      recoveryRunning.current = true
      setBusy(RECOVERY_COPY.busy)
      setError(null)
      const wavesPending = (): boolean => {
        const settled = userRef.current
        const stored = settled === null ? null : loadCustodyRecord(window.localStorage, settled, network)
        return stored !== null && custodyWavesPending(stored)
      }
      const wait = (milliseconds: number): Promise<void> =>
        new Promise((resolve) => window.setTimeout(resolve, milliseconds))
      try {
        /* THE ORDER AND EVERY BOUND ARE `../lib/recoveryAdd.ts`'s (2026/09/24).
           What stood here awaited the rest of the setup through a call that
           swallows its own failure and then asked for the sign-in's key
           anyway; asked for that key with no bound; and reported an add whose
           socket dropped after the chain took it as a failure. */
        let identity: CustodyIdentity | null = null
        await addRecoveryInOrder<CustodyIdentity, K256DeviceIdentity>({
          ensureIdentity: async () => {
            identity = await ensureIdentity()
            return identity
          },
          wavesPending,
          /* THE WAY BACK WAITS FOR THE WAVES. It is a k256 key, and every
             k256 circuit lands in the waves behind Home (2026/09/22). */
          finishWaves: (held) => finishInBackground(held, setupClock.current),
          recoveryKey: () => signIn.device(),
          addKey: async (held, spare, onPhase) => {
            await addDeviceK1(arm.session, held.device, spare, onPhase)
          },
          onProgress: setRecoveryProgress,
          wait,
        })
        const held = identity as CustodyIdentity | null
        if (held !== null) {
          saveBackupRecord(window.localStorage, held.userKey, network, {
            doneAt: Date.now(),
            ...(signIn.provider === null ? {} : { provider: signIn.provider }),
          })
        }
        setNotice(RECOVERY_COPY.done(signIn.provider))
        /* "Recovery is on", ticked, long enough to be read. */
        await wait(RECOVERY_DONE_HOLD_MS)
      } catch (cause) {
        console.warn('[account-custody] the way back could not be added', cause)
        setError(recoveryAddFailureSentence(cause))
      } finally {
        recoveryRunning.current = false
        setRecoveryIntended(false)
        setRecoveryProgress(null)
        setBusy(null)
        refresh()
      }
    },
    [arm.session, ensureIdentity, finishInBackground, network, refresh],
  )

  /** The press on the offer. */
  const addRecovery = useCallback((): void => {
    const signIn = socialRef.current
    if (signIn === null) return
    const refusal = recoveryRefusal({
      status: signIn.status,
      hasKey: (signIn.address ?? '').length > 0,
    })
    if (refusal !== null) {
      setError(refusal)
      return
    }
    if (signIn.status !== 'signed-in') {
      /* The overlay is opened and the press is REMEMBERED, because the reader
         may not come back to this render — see {@link recoveryIntended}. */
      setRecoveryIntended(true)
      setError(null)
      signIn.openAuthFlow()
      return
    }
    void runRecoveryAdd(signIn)
  }, [runRecoveryAdd])

  /**
   * "Not now", and the same press under a failure.
   *
   * THE ANSWER IS WRITTEN DOWN, which is what makes it an answer: a step that
   * comes back every time somebody opens their Passport is a nag, and offering
   * "Not now" while meaning "not this once" is a small lie. Home keeps a way in
   * for anybody who changes their mind (`recoveryHomeEntry`).
   */
  const skipRecovery = useCallback((): void => {
    const settled = userRef.current
    if (settled !== null) {
      saveBackupRecord(window.localStorage, settled, network, { dismissedAt: Date.now() })
    }
    setRecoveryIntended(false)
    setError(null)
    refresh()
  }, [network, refresh])

  /* Picks the add back up for somebody who has just come back from a
     provider's overlay. See `recoveryResumes`, which owns the rule. */
  useEffect(() => {
    if (
      !recoveryResumes({
        intended: recoveryIntended,
        readyScreen: screen === 'recovery' || screen === 'home',
        socialReady: social !== null && social.status === 'signed-in' && (social.address ?? '').length > 0,
        record: recoveryRecord,
        busy: busy !== null,
      })
    ) {
      return
    }
    if (social === null) return
    void runRecoveryAdd(social)
  }, [busy, recoveryIntended, recoveryRecord, runRecoveryAdd, screen, social])

  /* ---------------------------------------------------------------------- */
  /* THE JOURNEY, SHOWN THE WAY THE OLD ROAD SHOWED IT (2026/09/22)          */
  /*                                                                         */
  /* "I like how we showed the full TX journey here … this part same way     */
  /* with the game is critical." What stood here was one button and a        */
  /* counted sentence that did not count: it was read off a record that is   */
  /* re-read only when a press finishes, so a reader watched "step 1 of 3"   */
  /* while the chain showed all three landed.                                */
  /*                                                                         */
  /* What stands here now is the panel `./ProgressTimeline.tsx` paints for   */
  /* the old name step, row for row, with the phases of THIS road in it —    */
  /* and the same game beneath it, offered once the wait is long enough to   */
  /* be worth a distraction. The rule is `../lib/custodySetupProgress.ts`'s; */
  /* nothing below decides anything.                                         */
  /* ---------------------------------------------------------------------- */
  /**
   * THE WARM-UP, WHILE THE NAME IS BEING TYPED (2026/09/22).
   *
   * Fourteen seconds of a measured setup were the client getting ready — the
   * compiled module, the ledger WASM, the thirty verifier keys, a wallet — with
   * nothing on chain. The name step is ten to thirty seconds of somebody typing,
   * so it is fetched then, once per screen, and the press finds it in hand. A
   * warm-up that fails costs nothing: the press fetches what is missing.
   */
  const warmed = useRef(false)
  useEffect(() => {
    if (screen !== 'name' || warmed.current) return
    warmed.current = true
    const shownAt = performance.now()
    void warmCustodySetup({
      user: userRef.current,
      arm: arm.kind === 'passkey' ? 'jubjub' : 'k256',
    }).then(() => {
      console.info(`[setup-timing] warmup-done-since-name-step ${Math.round(performance.now() - shownAt)}`)
    })
  }, [arm.kind, screen])

  /* The name's own state on the long row, when this tab knows it: the claim
     runs BESIDE the account and the key, so it can be live at the same time. */
  const nameSubState =
    nameClaim === 'running' ? 'active' : nameClaim === 'done' ? 'done' : undefined

  const setupPhase = custodySetupPhase({
    running: busy !== null,
    signal: setupSignal,
    recordStep: view?.record != null ? nextCustodyStep(view.record) : null,
    named: (view?.name ?? null) !== null,
  })
  const setupRows = setupPhase === null ? null : custodySetupSteps(setupPhase, arm.kind)
  /* This press's name first, then the one written down before it — which is
     what a reload has to go on. */
  const timelineName = setupName ?? view?.chosenName ?? null
  const runningRow = setupRows?.find((row) => row.state === 'active') ?? null
  const elapsedFor = useTimelineClock(runningRow?.id ?? null)

  /* ---------------------------------------------------------------------- */
  /* SOMETHING TO DO WITH THE MINUTES                                        */
  /*                                                                         */
  /* OFFERED, NEVER STARTED, exactly as on the old road: a control appears   */
  /* once the setup has been running for {@link OFFER_AFTER_MS} and nothing  */
  /* is on screen until it is pressed. It sits BENEATH the timeline in       */
  /* normal flow so it covers nothing, it goes away while the ceremony has   */
  /* the reader's hands, and it can be shut for the rest of this setup.      */
  /* ---------------------------------------------------------------------- */
  const setupRunning = setupPhase !== null && busy !== null
  const [waitedMs, setWaitedMs] = useState(0)
  const [gameOpen, setGameOpen] = useState(false)
  const [gameDismissed, setGameDismissed] = useState(false)
  useEffect(() => {
    if (!setupRunning) {
      // The setup ended, one way or the other. The next one is offered afresh.
      setWaitedMs(0)
      setGameOpen(false)
      setGameDismissed(false)
      return undefined
    }
    const startedAt = Date.now()
    const timer = window.setInterval(() => setWaitedMs(Date.now() - startedAt), 1_000)
    return () => window.clearInterval(timer)
  }, [setupRunning])

  /* The ceremony is a prompt over this screen — a passkey dialogue, or the
     provider's overlay — and the game goes away for it rather than competing
     with it. */
  const identityPromptUp = setupPhase === 'confirm-identity'
  const offerGame = setupRunning && waitedMs >= OFFER_AFTER_MS && !gameDismissed

  const setupProgress =
    setupRows === null || setupPhase === null ? null : (
      <div className="mnob-setup-progress">
        <ProgressTimeline
          rows={setupRows.map((row): TimelineRow => ({
            id: row.id,
            label: row.label,
            state: row.state,
            expectedSeconds: row.expectedSeconds,
            elapsedMs: elapsedFor(row),
            /* The arm's own sentence, for the one row that is the reader's.
               Dropped where it repeats the label, which is what
               `./ProgressTimeline.tsx` does with a detail equal to it. */
            detail: row.id === 'identity' && row.state === 'active' ? arm.approvalPrompt : null,
            subStages:
              row.id === 'account'
                ? custodySetupSubStages(
                    setupPhase,
                    timelineName !== null ? aliasDomain(timelineName) : undefined,
                    nameSubState,
                  )
                : null,
            note: row.id === 'account' ? LONG_WAIT_NOTE : null,
          }))}
        />
        {offerGame ? (
          gameOpen ? (
            <WaitingGame
              paused={identityPromptUp}
              onDismiss={() => {
                setGameOpen(false)
                setGameDismissed(true)
              }}
            />
          ) : identityPromptUp ? null : (
            <button type="button" className="mngame-offer" onClick={() => setGameOpen(true)}>
              <Gamepad2 size={14} aria-hidden="true" />
              Play while you wait
            </button>
          )
        ) : null}
      </div>
    )

  /* ---------------------------------------------------------------------- */
  /* ADDING RECOVERY, SHOWN THE SAME WAY (2026/09/24)                        */
  /*                                                                         */
  /* "Show the whole transaction life cycle when adding recovery, like       */
  /* onboarding does." The same panel and clock as the setup above, with     */
  /* the add's rows — `../lib/recoveryAdd.ts#recoveryAddRows`, moved only by */
  /* the add's own callbacks — and a different game beneath it, offered      */
  /* after the same {@link OFFER_AFTER_MS}.                                  */
  /* ---------------------------------------------------------------------- */
  const recoveryRows = recoveryProgress === null ? null : recoveryAddRows(recoveryProgress)
  const recoveryRunningRow = recoveryRows?.find((row) => row.state === 'active') ?? null
  const recoveryElapsedFor = useTimelineClock(recoveryRunningRow?.id ?? null)
  const recoveryAdding = recoveryProgress !== null
  const [recoveryWaitedMs, setRecoveryWaitedMs] = useState(0)
  const [snakeOpen, setSnakeOpen] = useState(false)
  const [snakeDismissed, setSnakeDismissed] = useState(false)
  useEffect(() => {
    if (!recoveryAdding) {
      setRecoveryWaitedMs(0)
      setSnakeOpen(false)
      setSnakeDismissed(false)
      return undefined
    }
    const startedAt = Date.now()
    const timer = window.setInterval(() => setRecoveryWaitedMs(Date.now() - startedAt), 1_000)
    return () => window.clearInterval(timer)
  }, [recoveryAdding])
  /* The passkey prompt, or the sign-in's own approval, has the reader's hands. */
  const recoveryNeedsReader = recoveryProgress !== null && recoveryAddNeedsReader(recoveryProgress.stage)
  const offerSnake =
    recoveryAdding && recoveryProgress.stage !== 'done' && recoveryWaitedMs >= OFFER_AFTER_MS && !snakeDismissed

  const recoveryTimeline =
    recoveryRows === null ? null : (
      <>
        <ProgressTimeline
          rows={recoveryRows.map((row): TimelineRow => ({
            id: row.id,
            label: row.label,
            state: row.state,
            expectedSeconds: row.expectedSeconds,
            elapsedMs: recoveryElapsedFor(row),
            subStages: row.subStages,
          }))}
        />
        {offerSnake ? (
          snakeOpen ? (
            <SnakeGame
              paused={recoveryNeedsReader}
              onDismiss={() => {
                setSnakeOpen(false)
                setSnakeDismissed(true)
              }}
            />
          ) : recoveryNeedsReader ? null : (
            <button type="button" className="mngame-offer" onClick={() => setSnakeOpen(true)}>
              <Gamepad2 size={14} aria-hidden="true" />
              Play Snake while you wait
            </button>
          )
        ) : null}
      </>
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



  /**
   * THE SCREEN WHEN NOTHING IS SETTLED YET, and it is not a spinner.
   *
   * A PASSKEY THAT HAS NEVER OPENED A PASSPORT ON THIS BROWSER HAS NO USER KEY,
   * because the key is its device point and that costs a user-verified
   * assertion — so {@link refresh} returns early, `screen` stays null, and it
   * stays null until the ceremony that the first press asks for. The old
   * fall-through hid that: the setup offer was what rendered when nothing else
   * matched, so it covered both "nothing is stored" and "nothing is known yet"
   * without either being written down.
   *
   * Written down now. A null screen is somebody with nothing behind them, which
   * is the welcome page — or the name step, once they have read it. The Dynamic
   * arm never sees this branch: a sign-in knows its key the moment it is signed
   * in.
   */
  const stage: Screen = screen ?? (welcomeReadRef.current ? 'name' : 'welcome')

  /**
   * A PROVIDER SIGN-IN NEVER MAKES A PASSPORT (2026/09/22).
   *
   * The only road a sign-in opens is the way back: somebody on a new phone who
   * already holds a Passport and added this account as their way in. So a
   * sign-in with nothing behind it is never shown the welcome page, the name
   * field, or an offer to create — it is shown this, and what it finds is
   * handed to a key this device makes rather than kept by the sign-in. See
   * `onRecoverToDeviceKey`.
   *
   * A SIGN-IN THAT ALREADY HOLDS ONE IS LEFT ALONE. `stage === 'home'` is a
   * finished, named Passport filed under the sign-in's own key — made before
   * today's ruling, and opening it is not creating it. It goes to its Home
   * exactly as it did.
   */
  if (screen === 'recover' || (arm.kind === 'dynamic' && stage !== 'home')) {
    return (
      <RecoverStep
        keyPhrase={arm.keyPhrase}
        otherKeyHint={arm.otherKeyHint}
        onFind={findByName}
        onBack={
          arm.kind === 'dynamic'
            ? onLeaveRecovery === null
              ? null
              : onLeaveRecovery
            : () =>
                setScreen(
                  custodyNameFirstStage({
                    setupStarted: view?.record != null,
                    setupFinished: view?.stage === 'name' || view?.stage === 'home',
                    claimedName: view?.name ?? null,
                    chosenName: view?.chosenName ?? null,
                    welcomeRead: welcomeReadRef.current,
                    nameRegistering: nameClaim === 'running',
                    recoveryDue: recoveryStepDue({
                      setupFinished: view?.stage === 'name' || view?.stage === 'home',
                      claimedName: view?.name ?? null,
                      socialAvailable,
                      heldBySocial,
                      record: recoveryRecord,
                      nameRegistering: nameClaim === 'running',
                    }),
                  }),
                )
        }
      />
    )
  }

  if (stage === 'welcome') {
    return (
      <WelcomeStep
        kicker={arm.kicker}
        lede={arm.lede}
        browserNotice={browserNotice}
        onChooseName={() => {
          welcomeReadRef.current = true
          setScreen('name')
        }}
        onRecover={() => setScreen('recover')}
      />
    )
  }

  if (stage === 'name') {
    const setupFinished = view?.stage === 'name' || view?.stage === 'home'
    return (
      <NameStep
        kicker={arm.kicker}
        networkLabel={NETWORK_LABELS[network as PassportNetwork] ?? network}
        chosenName={view?.chosenName ?? null}
        takenName={taken}
        action={custodyNameFirstAction({
          setupStarted: view?.record != null,
          setupFinished,
          interrupted,
        })}
        /* THE HINT IS READ OFF THE LIVE PHASE NOW, which is the whole of the
           counter fix: it used to come from a stored record that changes only
           when the press is over, so it said "step 1 of 3" through all three.
           See `../lib/custodySetupProgress.ts#custodySetupHint`. */
        hint={custodySetupHint(setupPhase)}
        progress={setupProgress}
        /* THE BUTTON NAMES THE ROW THAT IS RUNNING, and says it once — the
           timeline above it is the progress indicator, and a button repeating
           a sentence already printed there is two spinners and one fact. */
        busy={runningRow?.label ?? busy}
        error={error}
        checkName={checkName}
        onCreate={createPassport}
        onTyping={() => {
          if (taken !== null) setTaken(null)
          if (error !== null) setError(null)
        }}
        onRecover={() => setScreen('recover')}
      />
    )
  }

  /* THE STEP, AND HOME'S OWN "ADD RECOVERY" WHILE IT RUNS. The press on Home
     used to run with nothing on screen but a banner at the end; it now shows
     the same timeline, and Home comes back when the add has ended. */
  if (stage === 'recovery' || (stage === 'home' && recoveryAdding)) {
    return (
      <RecoveryStep
        provider={social?.provider ?? null}
        /* The button names the row that is running, once — the timeline
           above it is the progress. */
        busy={busy === null ? null : (recoveryRunningRow?.label ?? busy)}
        error={error}
        onAdd={addRecovery}
        onSkip={skipRecovery}
        progress={recoveryTimeline}
      />
    )
  }

  if (stage === 'home') {
    /* THE REAL HOME, AND NOT A SECOND ONE (2026/09/22). Everything below the
       name is the shell every other Passport gets — the greeting, Send and
       Receive, the asset rows, the name card, "Your account is ready", the
       apps, the trail, and the bottom bar — painted by `App.tsx` from this
       value. See `CustodyPassportProps.renderHome`. */
    /* THE PAYMENT IN FLIGHT, AS THE PILL AND THE LIVE ROW SAY IT (2026/09/25):
       this tab's own payment while there is one, and otherwise the record an
       earlier visit left — confirming when it was handed over, and the plain
       "nothing was sent" when it was not. It replaces the banner that used to
       carry the stopped payment's sentence; one surface says it now. */
    const stoppedAsset = stopped === null ? null : custodyAssetRow(assetRows, stopped.colourHex)
    const sendView = sendProgressView({
      progress,
      step: sendStep,
      record:
        stopped === null || stopped.stage !== 'sending'
          ? null
          : {
              subject: {
                amount: stoppedAsset
                  ? formatCustodyAmount(BigInt(stopped.amount), stoppedAsset.decimals)
                  : stopped.amount,
                symbol: stoppedAsset?.symbol ?? '',
                recipient: stopped.recipientLabel,
              },
              draft: {
                assetId: stoppedAsset?.mode === 'unshielded' ? 'night' : stopped.colourHex,
                /* A name goes back into the field as a name; an address was
                   only ever kept shortened, so the field is left for the
                   person to paste it again. */
                recipient: stopped.recipientAccountAddress.length > 0 ? stopped.recipientLabel : '',
                amount: stopped.amount,
              },
              startedAt: stopped.startedAt,
              submitted: stopped.sendTxId !== null,
              sentence: custodyShieldedSendOutcome(stopped),
            },
    })
    const finishState = custodyFinishSetupCard({
      wavesPending: view?.record != null && custodyWavesPending(view.record),
      keyHeld: identityHeld,
      press: finishPress,
    })
    return renderHome({
      user,
      network,
      name: view?.name ?? null,
      /* THE NAME STILL BEING REGISTERED, beside the key that is already on
         (2026/09/22). The name card says so, and says "Registered" only once
         the claim has landed — `view.name` is written by nothing else. */
      registeringName: view?.name == null && nameClaim === 'running' ? (view?.chosenName ?? setupName) : null,
      /* THE ACCOUNT, AND NOT THE WALLET. Receive offers this and only this: it
         is what the name points at and what a payment is made into. The
         wallet's own address is machinery and is never handed out. */
      accountAddress: view?.address ?? null,
      ready: view?.record != null && nextCustodyStep(view.record) === 'ready',
      holdings: {
        night: balance,
        shielded: tokens,
        balanceFailed,
        stablecoinColourHex: STABLECOIN_COLOUR,
        arriving,
      },
      syncPercent,
      /* ONE BANNER, TWO SOURCES. A refusal from a control on this screen and
         the sentence about a payment that stopped are both "something you
         should read", and Home has one place for that. The stopped payment's
         sentence wins only when there is no live failure, because a failure is
         about the press that just happened. */
      error: error ?? notice,
      stoppedSentence: sendView?.kind === 'failed' ? sendView.detail : null,
      onRefresh: () => void readHoldings(),
      /* PUTS AWAY EXACTLY WHAT IS ON SCREEN, in the order the banner shows
         them. Clearing all three on one press would discard the record of a
         stopped payment because an unrelated refusal happened to be showing,
         and that record is the only thing on this device that knows where
         somebody's money got to. */
      onDismissError: () => {
        if (error !== null) {
          setError(null)
          return
        }
        if (notice !== null) {
          setNotice(null)
          return
        }
      },
      onDismissStopped: dismissStoppedSend,
      /* The pill and the live row. Dismissing puts away a finished payment's
         outcome, and the record of one an earlier visit never handed over. */
      sendProgress:
        sendView === null
          ? null
          : {
              view: sendView,
              /* The balance that is moving says so, in the same word the
                 prototype's rows use. */
              sendingAssetId:
                sendView.kind !== 'running'
                  ? null
                  : progress?.kind === 'running'
                    ? progress.draft.assetId
                    : stoppedAsset?.mode === 'unshielded'
                      ? 'night'
                      : (stopped?.colourHex ?? null),
              onDismiss: () => {
                dispatchProgress({ type: 'dismiss' })
                if (progress === null) dismissStoppedSend()
              },
            },
      /* WHETHER THIS PASSPORT CAN BE OPENED ANYWHERE ELSE — one line where it
         can, one small entry where it cannot yet. The offer after the name is
         asked once; this is where somebody who said "not now", or whose
         Passport predates the step, finds it again. */
      recovery: {
        state: recoveryHomeEntry({ socialAvailable, heldBySocial, record: recoveryRecord }),
        onAdd: addRecovery,
      },
      /* THE REST OF THE SETUP, WHEN NOTHING ELSE WILL FINISH IT. Null in the
         ordinary case, where this tab holds the key and the waves are already
         landing — see `custodyFinishSetupCard`. */
      finishSetup:
        finishState === null ? null : { state: finishState, onFinish: () => void finishSetup() },
      send: {
        networkId: network,
        resolveName,
        /* NIGHT goes to an `mn_addr…` address in one gated transaction. To a
           name it cannot go at all — the sheet says so at the field, before
           Review; this rejection is only the backstop behind that. */
        onSend: sendNightToAddress,
        onSendToName: () => Promise.reject(new Error(CUSTODY_NIGHT_SEND_REFUSAL)),
        checkRecipientAccount,
        onSendShielded: sendShieldedToPastedAddress,
        onSendShieldedToName: sendShieldedToName,
        readShieldedHoldings,
        phase: custodySendPhase(sendStep),
        /* The sheet closes once the payment is handed over; the pill carries
           it from there. And a second payment waits for the first. */
        background: true,
        inFlightReason: sendInFlightReason(sendView),
      },
    })
  }

  /* EVERY SCREEN THIS FLOW HAS IS NAMED ABOVE, and `stage` is one of four, so
     nothing reaches this line. Until 2026/09/22 the fall-through WAS a screen —
     "Set up your Passport", one button, no name on it — and it is the screen
     this work deleted; what is left is the branch TypeScript needs and nobody
     reads. It paints the same "getting ready" the arm gets before it is ready
     rather than nothing, because a blank screen is the one thing that would be
     worse than an unreachable one. */
  return (
    <Shell label="Passport">
      <p className="mnob-lede">Getting your Passport ready…</p>
    </Shell>
  )
}

/* -------------------------------------------------------------------------- */
/* The steps                                                                  */
/* -------------------------------------------------------------------------- */

function Shell(props: { label: string; children: React.ReactNode; bodyClassName?: string }) {
  return (
    <section className="mnob-screen mndyn">
      <header className="mnob-bar">
        <img className="mnob-wordmark" src="/midnight-wordmark.svg" alt="Midnight" />
        <span className="mnob-bar-label">{props.label}</span>
        <ThemeToggle size="sm" className="mnob-theme" />
      </header>
      <div className={`mnob-body${props.bodyClassName ? ` ${props.bodyClassName}` : ''}`}>
        {props.children}
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* The page that says what a Passport is                                      */
/* -------------------------------------------------------------------------- */

/**
 * The first thing a new Passport sees, on either arm.
 *
 * ONE SCREEN, ONE ACTION, AND NO SKIP. There was a skip on the passkey road
 * until 2026/08/30 and it led to the same mandatory name step, which is what a
 * skip promises not to do. That is even truer here: the name IS the creation
 * now, so a control offering to walk past it would describe an escape that
 * does not exist.
 *
 * The kicker is the ARM's, whole — "Signed in with Google", or the passkey's
 * own words — for the reason `../lib/custodyArm.ts` gives: a template that
 * reads well for one arm is one arm's sentence with a hole in it.
 */
function WelcomeStep(props: {
  kicker: string
  lede: string
  browserNotice: string | null
  onChooseName: () => void
  onRecover: () => void
}) {
  /* THE FOUR ILLUSTRATED BENEFITS (2026/09/23), the same cards and words as
     `Welcome.tsx`: four across on desktop, two by two on a phone. */
  return (
    <section className="mnob-screen mndyn mnwl-screen">
      <header className="mnob-bar mnwl-bar">
        <img className="mnob-wordmark" src="/midnight-wordmark.svg" alt="Midnight" />
        <span className="mnob-bar-label">Welcome</span>
        <ThemeToggle size="sm" className="mnob-theme" />
      </header>
      <div className="mnob-body mnwl-body">
        <div className="mnwl-intro">
          <p className="mnob-kicker">{props.kicker}</p>
          <h1 className="mnob-title mnwl-title">Welcome to Passport.</h1>
          <p className="mnob-lede mnwl-lede">{props.lede}</p>
        </div>

        {/* WHAT THIS BROWSER ALREADY HOLDS, said before the offer rather than
            discovered afterwards as a second Passport with a second name to
            claim. See `../lib/custodyRoute.ts`. */}
        {props.browserNotice !== null ? (
          <p className="mnob-hint mndyn-browser-notice" role="status">
            {props.browserNotice}
          </p>
        ) : null}

        <ul className="mnwl-grid" aria-label="What your Passport gives you">
          {WELCOME_BENEFITS.map((benefit, index) => (
            <li key={benefit.title} className="mnwl-card">
              <div className="mnwl-art" aria-hidden="true">
                <img src={benefit.image} alt="" loading={index < 2 ? 'eager' : 'lazy'} />
              </div>
              <div className="mnwl-card-copy">
                <h2>{benefit.title}</h2>
                <p>{benefit.body}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mnwl-actions" data-toast-clear>
          <button type="button" className="mnwl-primary" onClick={props.onChooseName}>
            <span>Choose my .night name</span>
            <ArrowRight size={19} strokeWidth={2.2} aria-hidden="true" />
          </button>
          {/* The way in for somebody who is not new: quiet, and under the
              primary action, because most readers are making their first. */}
          <button type="button" className="mnob-alt" onClick={props.onRecover}>
            I already have a Passport
          </button>
        </div>
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* The name, and the press that makes the whole Passport                      */
/* -------------------------------------------------------------------------- */

/** How long the field waits after the last keystroke before it asks. */
const NAME_DEBOUNCE_MS = 500

/** What the field knows about what has been typed into it. */
type NameFieldState =
  | { kind: 'empty' }
  | { kind: 'invalid'; message: string }
  | { kind: 'checking'; alias: string }
  | { kind: 'answered'; alias: string; availability: AliasAvailability }

/**
 * THE SCREEN THE WHOLE PASSPORT IS MADE FROM.
 *
 * Choose a name, and press once. The press asks for the approval this arm
 * needs, sets the Passport up in its three counted steps, and registers the
 * name against it — see `createPassport` above. There is no "choose one later"
 * on it, and there must not be: the name is not a decoration on a Passport
 * that already exists, it is part of making one.
 *
 * THE FIELD IS `AliasClaim.tsx`'S, DELIBERATELY. Same 500 ms debounce, same
 * staleness token, same rules (`normalizePassportAlias`), and the same two
 * sentences about what the registry said — through `../lib/custodyNameFirst.ts`,
 * so the words on the two roads cannot drift apart. What is NOT carried over is
 * the queue: the old road could keep a name it had not checked, because there
 * the account already existed. Here there is nothing honest to queue.
 */
function NameStep(props: {
  kicker: string
  networkLabel: string
  /** The name written down before this setup started, prefilled on a resume. */
  chosenName: string | null
  /** A name that was taken between being chosen and being claimed. */
  takenName: string | null
  /** What the one primary control says. See {@link custodyNameFirstAction}. */
  action: string
  hint: string
  /** The timeline and the game, or null before anything has started. */
  progress: React.ReactNode
  busy: string | null
  error: string | null
  checkName: (alias: string) => Promise<AliasAvailability>
  onCreate: (alias: string) => void
  onTyping: () => void
  onRecover: () => void
}) {
  const { checkName, chosenName, takenName, onTyping } = props
  const [value, setValue] = useState('')
  const [field, setField] = useState<NameFieldState>({ kind: 'empty' })
  const probe = useRef(0)

  const busy = props.busy !== null

  /**
   * A name carried over from a previous visit, or from a race that was lost,
   * goes into the field rather than being asked for again — and is CHECKED
   * rather than assumed, because the reason it is here may be that somebody
   * else took it.
   *
   * ONCE EACH, WHICH THE REF IS FOR. Without it, clearing the field to type
   * something else put the carried name straight back: the effect sees an
   * empty field and a name to put in it, and it is the same effect either way.
   * Somebody whose name was taken would then be unable to delete the name they
   * had just been told they cannot have.
   */
  const carried = useRef<string | null>(null)
  useEffect(() => {
    const name = chosenName ?? takenName
    if (name === null || carried.current === name) return
    carried.current = name
    setValue(name)
  }, [chosenName, takenName])

  useEffect(() => {
    const raw = value.trim()
    if (!raw) {
      setField({ kind: 'empty' })
      return undefined
    }
    let alias: string
    try {
      alias = normalizePassportAlias(raw)
    } catch (cause) {
      setField({ kind: 'invalid', message: cause instanceof Error ? cause.message : String(cause) })
      return undefined
    }
    setField({ kind: 'checking', alias })
    const token = probe.current + 1
    probe.current = token
    const timer = window.setTimeout(() => {
      void checkName(alias).then(
        (availability) => {
          if (probe.current !== token) return
          setField({ kind: 'answered', alias, availability })
        },
        (cause: unknown) => {
          if (probe.current !== token) return
          setField({
            kind: 'answered',
            alias,
            availability: {
              status: 'unreachable',
              detail: cause instanceof Error ? cause.message : String(cause),
            },
          })
        },
      )
    }, NAME_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [checkName, value])

  const alias = field.kind === 'checking' || field.kind === 'answered' ? field.alias : null
  /* A NAME THE CLAIM ITSELF FOUND TAKEN OUTRANKS THE FIELD'S OWN ANSWER, and
     it has to: the field asked before the setup, the claim asked after it, and
     the later answer is the true one. Without this the line under the field
     would go on saying a name is free beside a message saying it is gone. */
  const lostTheRace = alias !== null && alias === takenName
  const available =
    !lostTheRace && field.kind === 'answered' && field.availability.status === 'available'
  const enabled = custodyNameFirstEnabled({ busy, available })

  return (
    <Shell label="Passport" bodyClassName="mndyn-name-body">
      <div className="mndyn-name-intro">
        <p className="mnob-kicker">{props.kicker}</p>
        <h1 className="mnob-title">
          <span>Choose</span>
          <span>your .night name</span>
        </h1>
        <p className="mnob-lede">
          Pick a name people can send to, instead of a long string they have to copy carefully. It
          is part of your Passport from the moment it is made.
        </p>
      </div>
      {/* The name artwork, frameless on the page (Codex, 2026/09/23). */}
      <NameArtwork className="mndyn-name-art" />

      <form
        className="mnob-stage mndyn-name-stage"
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          if (enabled && alias !== null) props.onCreate(alias)
        }}
      >
        <label className="mnob-hint" htmlFor="custody-name">
          Your name
        </label>
        <input
          id="custody-name"
          className="mnob-input"
          type="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="alice"
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            onTyping()
          }}
          disabled={busy}
        />

        <NameAvailability
          field={field}
          networkLabel={props.networkLabel}
          takenName={takenName}
        />

        {props.error ? (
          <div className="mnob-unusable" role="alert">
            <p className="mnob-unusable-copy">{props.error}</p>
          </div>
        ) : null}

        {/* THE FULL JOURNEY, above the control rather than under it: what a
            person is watching while they wait is the progress, and the button
            beneath it is a label on that wait rather than a thing to press. */}
        {props.progress}

        <button type="submit" className="mnob-primary" disabled={!enabled}>
          <span className="mnob-primary-copy">
            {busy ? (
              <Loader2 className="mnob-working-spinner" size={17} strokeWidth={2} aria-hidden="true" />
            ) : (
              <ShieldCheck size={17} strokeWidth={2} aria-hidden="true" />
            )}
            {props.busy ?? props.action}
          </span>
          <ArrowRight size={17} strokeWidth={2.2} aria-hidden="true" />
        </button>

        {/* The counted line while the setup runs, and the promise before it
            starts. One `role="status"` element, because a reader watching
            three steps go by should not have two places to look. */}
        <p className="mnob-hint" role="status">
          {props.hint}
        </p>

        <button type="button" className="mnob-alt" onClick={props.onRecover} disabled={busy}>
          I already have a Passport
        </button>
      </form>
    </Shell>
  )
}

/** The one line under the field, in the words `../lib/custodyNameFirst.ts` sets. */
function NameAvailability(props: {
  field: NameFieldState
  networkLabel: string
  /** A name the claim found taken, whatever the field was told earlier. */
  takenName: string | null
}) {
  const { field, networkLabel, takenName } = props
  if (
    (field.kind === 'checking' || field.kind === 'answered') &&
    field.alias === takenName
  ) {
    return (
      <p className="mndyn-status mndyn-status-taken" role="status">
        <span className="mndyn-status-dot" aria-hidden="true" />
        <span>{custodyNameTakenSentence(aliasDomain(field.alias), networkLabel)}</span>
      </p>
    )
  }
  if (field.kind === 'empty') {
    return (
      <p className="mndyn-status mndyn-status-checking">
        <span className="mndyn-status-dot" aria-hidden="true" />
        <span>{custodyNameEmptySentence(networkLabel)}</span>
      </p>
    )
  }
  if (field.kind === 'invalid') {
    return (
      <p className="mndyn-status mndyn-status-error" role="alert">
        <span className="mndyn-status-dot" aria-hidden="true" />
        <span>{field.message}</span>
      </p>
    )
  }
  if (field.kind === 'checking') {
    return (
      <p className="mndyn-status mndyn-status-checking" role="status">
        <Loader2 className="mnob-working-spinner" size={13} aria-hidden="true" />
        <span>{CUSTODY_NAME_CHECKING_SENTENCE}</span>
      </p>
    )
  }
  if (field.availability.status === 'available') {
    return (
      <p className="mndyn-status mndyn-status-available" role="status">
        <span className="mndyn-status-dot" aria-hidden="true" />
        <span>{custodyNameAvailableSentence(aliasDomain(field.alias))}</span>
      </p>
    )
  }
  if (field.availability.status === 'taken') {
    return (
      <p className="mndyn-status mndyn-status-taken" role="status">
        <span className="mndyn-status-dot" aria-hidden="true" />
        <span>{custodyNameTakenSentence(aliasDomain(field.alias), networkLabel)}</span>
      </p>
    )
  }
  /* A question that could not be put is never a "no" — and it is never a yes
     either, which is why the control stays off. The service's own words go to
     the console, where they are of use to somebody. */
  return (
    <p className="mndyn-status mndyn-status-error" role="status">
      <span className="mndyn-status-dot" aria-hidden="true" />
      <span>{CUSTODY_NAME_UNREACHABLE_SENTENCE}</span>
    </p>
  )
}

/* -------------------------------------------------------------------------- */
/* Finding an existing Passport                                              */
/* -------------------------------------------------------------------------- */

function RecoverStep(props: {
  /** "…that {keyPhrase} is part of it". See `../lib/custodyArm.ts`. */
  keyPhrase: string
  /** What to try when the name turns out to be somebody else's. */
  otherKeyHint: string
  onFind: (name: string) => Promise<NameRecoveryOutcome>
  /** Where "Go back" goes, or null where there is nowhere behind this screen. */
  onBack: (() => void) | null
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
        {props.onBack ? (
          <button type="button" className="mnob-alt" onClick={props.onBack} disabled={busy}>
            {RECOVERY_COPY.recoverBack}
          </button>
        ) : null}
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
/**
 * A step in front of a payment that sends nothing, given the same bound the
 * payment's own preparation has (2026/09/22). The screen opens the connection
 * and reads the recipient before it hands anything to the client, and neither
 * read had an end: past the bound the payment is told, definitely, that it did
 * not go through — which is true.
 */
async function beforePayment<T>(work: Promise<T>, what: string): Promise<T> {
  const outcome = await withinCustodyBound(work, custodyPrepareWaitMs())
  if (outcome.kind === 'timeout') {
    console.warn(`[account-custody] ${what} did not finish in time; nothing was sent`)
    throw new Error(CUSTODY_SEND_NOT_SENT)
  }
  return outcome.value
}

/** How long one read behind the Home figures may take before it gives up. */
const HOLDINGS_READ_WAIT_MS = 30_000

/**
 * THE COIN STORE, MADE TO AGREE WITH THE CHAIN — run on every read of the
 * holdings, and by the stopped-payment check (2026/09/22).
 *
 * First a booking the SCREEN's stopped-payment record holds and the store does
 * not — written by a build from before the store kept its own — is handed to
 * the store. Then `reconcileK1Spends` asks the chain about every booking, every
 * booking set aside, and every change coin whose parent it cannot name, and
 * takes back, puts back, or drops accordingly. Its rules are its own and are
 * drilled in `../identity/k1CoinStore.test.ts`; what is here is the wiring:
 * the indexer, the clock, the bound, and the account's history for the count.
 */
async function reconcileCustodySpends(
  account: { network: string; address: string },
  indexerHttpUrl: string,
) {
  const [store, runtime] = await Promise.all([
    import('../identity/k1CoinStore.js'),
    import('../identity/contractRuntime.js'),
  ])
  const record = loadCustodyShieldedSend(window.localStorage, {
    network: account.network,
    accountAddress: account.address,
  })
  if (record !== null && record.sendTxId !== null && record.undo) {
    try {
      store.adoptK1PendingSpend(account, {
        txId: record.sendTxId,
        at: record.sentAt ?? record.startedAt,
        parent: {
          colour: record.undo.held.colour,
          nonce: record.undo.held.nonce,
          value: BigInt(record.undo.held.value),
          mtIndex: BigInt(record.undo.held.mtIndex),
        },
        change: record.undo.change,
      })
    } catch (cause) {
      console.info('[account-custody] a stopped payment’s record could not be read', cause)
    }
  }
  const result = await store.reconcileK1Spends(account, {
    onChain: (txId) => runtime.resolveTxOnChainOnce(indexerHttpUrl, txId),
    now: Date.now(),
    boundMs: CUSTODY_SUBMIT_WAIT_MS,
    keepUndoneMs: CUSTODY_UNDONE_KEEP_MS,
    landedSpendCount: async () =>
      custodyLandedSpendCount(await readCustodyActions(indexerHttpUrl, account.address)),
  })
  const moved =
    result.landed.length + result.undone.length + result.reapplied.length + result.orphansDropped.length
  if (moved > 0) console.info('[account-custody] payments in flight, answered from the chain', result)
  return result
}

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

/** Whether two holdings lists say the same thing, colour for colour. */
function sameTokenList(
  a: readonly { colourHex: string; amount: bigint }[],
  b: readonly { colourHex: string; amount: bigint }[],
): boolean {
  if (a.length !== b.length) return false
  return a.every((row, index) => row.colourHex === b[index]?.colourHex && row.amount === b[index]?.amount)
}

/** Whether two readings of the in-flight payment record are the same record. */
function sameSendRecord(
  a: CustodyShieldedSendRecord | null,
  b: CustodyShieldedSendRecord | null,
): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

/* -------------------------------------------------------------------------- */
/* The payment engine, and the stand-in a browser walk may put in its place    */
/* -------------------------------------------------------------------------- */

const PAYMENT_ENGINE = {
  withdrawShieldedK1: engineWithdrawShieldedK1,
  withdrawShieldedToContractK1: engineWithdrawShieldedToContractK1,
  withdrawUnshieldedK1: engineWithdrawUnshieldedK1,
}

/**
 * The three calls that move value out of the account — the real ones, or, in a
 * walk build, a stand-in the walk asked for.
 *
 * WHY A STAND-IN EXISTS AT ALL (2026/09/25). The mocked tier has no proving
 * service and no chain to take a transaction, so a payment there always stops
 * at the proof — and the in-progress pill's whole job is what happens AFTER the
 * hand-over: the phases, "Sent" with its link, a failure's one sentence. A walk
 * sets `window.__passportWalkPayment = { stepMs, fail? }` before the app loads,
 * and the stand-in reports the same phases the engine reports, a step apart,
 * then answers or fails. Everything in front of it — the sheet, the plan, the
 * record written before the hand-over, the approval — is the shipped code.
 *
 * DEAD IN EVERY DEPLOYED BUILD. `VITE_PASSPORT_ACC_WALK` is set for the mocked
 * tier's preview build and for no deployment, and Vite writes it in as a
 * literal, so the bundler sees this branch cannot be taken and drops it.
 */
function paymentEngine(): typeof PAYMENT_ENGINE {
  if (import.meta.env.VITE_PASSPORT_ACC_WALK !== '1') return PAYMENT_ENGINE
  const hook = (globalThis as { __passportWalkPayment?: unknown }).__passportWalkPayment
  if (!hook || typeof hook !== 'object') return PAYMENT_ENGINE
  const asked = hook as { stepMs?: unknown; fail?: unknown }
  const stepMs = typeof asked.stepMs === 'number' && asked.stepMs >= 0 ? asked.stepMs : 1_000
  const fail = typeof asked.fail === 'string' ? asked.fail : null
  const walk = async (onPhase?: (phase: CustodyPhase) => void): Promise<CustodyShieldedSpendResult> => {
    const wait = () => new Promise<void>((resolve) => setTimeout(resolve, stepMs))
    onPhase?.({ step: 'sign' })
    await wait()
    onPhase?.({ step: 'submit' })
    await wait()
    if (fail !== null) throw new Error(fail)
    const txHash = 'e5'.repeat(32)
    onPhase?.({ step: 'confirm', txId: `00${txHash}` })
    await wait()
    return {
      txHash,
      explorerUrl: null,
      change: null,
      changePosition: 'none',
      sent: null,
      blockHeight: null,
      candidate: 0,
    } as unknown as CustodyShieldedSpendResult
  }
  return {
    withdrawShieldedK1: (_session, _identity, _input, onPhase) => walk(onPhase),
    withdrawShieldedToContractK1: (_session, _identity, _input, onPhase) => walk(onPhase),
    withdrawUnshieldedK1: async (_session, _identity, _input, onPhase): Promise<CustodyStepResult> =>
      walk(onPhase),
  }
}
