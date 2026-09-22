import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  Fingerprint,
  Gamepad2,
  Loader2,
  Search,
  ShieldCheck,
  Sparkles,
  Tag,
} from 'lucide-react'

import { normaliseNameForRecovery, type NameRecoveryOutcome } from '../lib/nameRecovery.js'
import RecoveryStep from './RecoveryStep'
import { saveBackupRecord, type BackupRecord } from '../lib/backupDevice.js'
import { saveAdoption, type AdoptionHandoff } from '../lib/custodyAdoption.js'
import {
  RECOVERY_COPY,
  loadRecoveryRecord,
  recoveryFailureSentence,
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
  deployCustodyAccount,
  startCustodyAccountAgain,
  withdrawShieldedK1,
  withdrawShieldedToContractK1,
  type CustodyCallDevice,
  type CustodyPhase,
} from '../identity/custodyContractClient.js'
import {
  hexToBytes,
  custodyActivatedRecord,
  custodyFailureSentence,
  nextCustodyStep,
  resolveCustodyUseCounter,
  saveCustodyRecord,
  CUSTODY_SETUP_INTERRUPTED,
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
  custodyTxIdForInboxIndex,
} from '../identity/custodyInboxIndex.js'
import {
  custodyAssetRow,
  custodyAssetRows,
  custodyResumeOffer,
  custodyStablecoinColour,
  type CustodyAssetRow,
} from '../lib/custodyAssets.js'
/* The translation between what this screen holds and what the real Home
   paints, plus the trail's own rules. Pure — see `../lib/custodyHome.ts`. */
import {
  CUSTODY_NIGHT_SEND_REFUSAL,
  custodyActivityMarkKey,
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
  runCustodyKeepRecord,
  custodyUnplacedDeliveries,
  runCustodyWork,
} from '../lib/custodyScreenRules.js'
import {
  custodySetupHint,
  custodySetupPhase,
  custodySetupSteps,
  custodySetupSubStages,
  type CustodySetupSignal,
} from '../lib/custodySetupProgress.js'
import { LONG_WAIT_NOTE } from '../lib/claimSteps.js'
import { OFFER_AFTER_MS } from '../lib/waitingGame.js'
import ProgressTimeline, { useTimelineClock, type TimelineRow } from './ProgressTimeline.js'
import WaitingGame from './WaitingGame.js'
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

/**
 * Which of the custody road's reported steps moves the timeline on.
 *
 * Three of the seven, and the other four are deliberately absent — see the
 * note at the one call site. `../lib/custodySetupProgress.ts` turns these into
 * the row and the state a reader is shown.
 */
const SETUP_SIGNAL_OF_STEP: Partial<Record<CustodyPhase['step'], CustodySetupSignal>> = {
  deploy: 'deploy',
  waves: 'waves',
  activate: 'activate',
}

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
    setScreen(
      custodyNameFirstStage({
        setupStarted: next.record !== null,
        setupFinished: next.stage === 'name' || next.stage === 'home',
        claimedName: next.name,
        chosenName: next.chosenName,
        welcomeRead: welcomeReadRef.current,
        recoveryDue: recoveryStepDue({
          setupFinished: next.stage === 'name' || next.stage === 'home',
          claimedName: next.name,
          socialAvailable: socialAvailableRef.current,
          heldBySocial: heldBySocialRef.current,
          record,
        }),
      }),
    )
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
      const away: CustodyShieldedSendRecord = { ...record, sendTxId: phase.txId }
      saveCustodyShieldedSend(window.localStorage, away)
      setStopped(away)
    },
    [],
  )

  /** The transaction the last payment went out in, for its trail row. */
  const sentTxId = useRef<string | null>(null)

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
      pushToast({
        tone: 'success',
        /* Accepted, not yet included — the same claim every other send on this
           app makes, and the only one that is true at this moment. */
        title: 'Shielded transfer accepted by the network — confirming',
        body: 'The network fee was covered on your behalf.',
        ...(txHash ? { link: txReceiptLink(sent.network, txHash) ?? undefined } : {}),
      })
      sentTxId.current = null
    },
    [onActivity],
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
   * Registers the chosen name against an account that now exists.
   *
   * THE RE-READ BEFORE THE CLAIM IS NOT BELT AND BRACES. The name was chosen
   * before a three-step setup, which is minutes, and a name is a first-come
   * thing — so by the time there is an account to bind it to, somebody else may
   * hold it. Asking once more costs one read and turns a refusal from the
   * service into a sentence the reader can act on, on a screen with a field in
   * it. `fresh` because the answer from the typing is exactly the answer that
   * may have gone stale.
   *
   * WHAT A LOST RACE DOES NOT DO IS THROW THE PASSPORT AWAY. The account is
   * built, activated, and theirs; only the name went. See
   * {@link custodyNameRaceOutcome}.
   */
  const claimChosenName = useCallback(
    async (options: {
      alias: string
      user: string
      address: string
    }): Promise<void> => {
      const { alias, user: owner, address } = options
      const networkLabel = NETWORK_LABELS[network as PassportNetwork] ?? network
      const loseTheRace = () => {
        const outcome = custodyNameRaceOutcome(aliasDomain(alias), networkLabel)
        forgetCustodyChosenName(window.localStorage, owner, network)
        setTaken(alias)
        setError(outcome.sentence)
        refresh()
      }

      setBusy('Claiming your name')
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
      setSetupSignal('register')
      try {
        const claimed = await sponsorAliasRegistrationAcross(FUNDER_URLS, {
          alias,
          ownerKey,
          contractAddress: address,
          network: network as 'stagenet',
        })
        /* KEPT FOR THE TRAIL AND FOR NOTHING ELSE. The row that says the name
           is registered is worth a link to the transaction that registered it;
           the name card needs no such thing, and neither does anything else on
           screen, so it is session state rather than another stored field. */
        setRegisterTxId(claimed.registerTxId ?? null)
      } catch (cause) {
        if (custodyNameWasTaken(cause)) {
          loseTheRace()
          return
        }
        throw cause
      }
      /* REGISTERED IS NOT YET CONFIRMED. What is shown from here on is read
         back rather than assumed, so the last state of the long row is the
         read and not a flourish over one that already happened. */
      setSetupSignal('confirm')
      saveCustodyName(window.localStorage, owner, network, alias)
      forgetCustodyChosenName(window.localStorage, owner, network)
      setTaken(null)
      refresh()
    },
    [network, refresh],
  )

  /**
   * ONE PRESS: the approval, the setup, and the name.
   *
   * THE ORDER IS THE POINT (2026/09/22). The name is written down BEFORE the
   * first transaction leaves, so a reload in the middle of a three-step setup
   * comes back to a Passport that still knows what it is called; and the claim
   * runs on the same press as the setup, so nobody is shown a "your Passport is
   * ready" screen whose only content is a second button.
   *
   * The name is written after {@link ensureIdentity} and not before it, because
   * on the passkey arm the key every store is filed under IS the ceremony's
   * output: writing earlier would mean writing under a user key that is either
   * null or somebody else's.
   */
  const createPassport = useCallback(
    (alias: string) => {
      setSetupName(alias)
      /* The BUTTON names the row that is running; the line under it counts the
         three. Putting the same sentence on both would be the same words twice,
         which reads as a stutter rather than as progress. */
      void run(PHASE_LABELS.deploy, async () => {
        /* The ceremony is the first thing the press costs, and it is the
           reader's own step — so the timeline names it before anything is
           asked of them rather than after they have answered. */
        setSetupSignal('identity')
        const settled = await ensureIdentity()
        /* THE CEREMONY IS OVER THE MOMENT IT ANSWERS, and the timeline says so
           here rather than waiting for the custody road's first report. That
           report comes after the compiled module, the ledger WASM, and the
           circuit keys have been fetched — tens of seconds on a cold cache,
           and forever behind a prover that is not answering — and a reader
           held on "Confirm with your passkey" through all of it has already
           done the one thing that row is about. */
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
          setBusy(phase.detail ? `${PHASE_LABELS[phase.step]}` : PHASE_LABELS[phase.step])
          /* ONLY THE THREE THAT MOVE THE TIMELINE. `wallet`, `sign`, `submit`,
             and `confirm` are moments INSIDE one of these waves — advancing on
             the `confirm` that ends the activation would move the row to the
             name before the name had been asked for. */
          const signal = SETUP_SIGNAL_OF_STEP[phase.step]
          if (signal !== undefined) setSetupSignal(signal)
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
        if (record.address === null) {
          throw new Error('Your Passport is still being set up. Try again once it is ready.')
        }
        await claimChosenName({ alias, user: owner, address: record.address })
      })
    },
    [
      arm,
      askForOpeningBalance,
      claimChosenName,
      ensureIdentity,
      interrupted,
      network,
      refresh,
      run,
    ],
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
  }, [user, view, walkDeliveries])

  useEffect(() => {
    if (screen !== 'home') return
    void readHoldings()
  }, [readHoldings, screen])

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
        params.recipientModule === 'account-custody' ? await readRecipientEncKey() : null
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
      )
      clearCustodyShieldedSend(window.localStorage, {
        network: record.network,
        accountAddress: account.address,
      })
      setStopped(null)
      setNotice(custodyShieldedSendOutcome({ ...stoppedRecord, stage: 'done' }))
      /* THE TIDY-UP RUNS HERE, INSIDE THE PAYMENT. It is a gated call of its
         own, so starting it detached let it overlap whatever came next — the
         follow-up read, or a second Send — and two gated calls against one
         account sign against the same `auth_nonce`. See
         `../lib/custodyScreenRules.ts`. */
      await runCustodyKeepRecord(setBusy, () =>
        backfillChange({ wallet, record, identity, change: sent.change }),
      )
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
      clearCustodyShieldedSend(window.localStorage, {
        network: record.network,
        accountAddress: account.address,
      })
      setStopped(null)
      setNotice(custodyShieldedSendOutcome({ ...stoppedRecord, stage: 'done' }))
      /* As above: inside the payment, and last. */
      await runCustodyKeepRecord(setBusy, () =>
        backfillChange({ wallet, record, identity, change: sent.change }),
      )
    },
    [arm, backfillChange, ensureIdentity, sendPhase],
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
    async (work: () => Promise<void>): Promise<void> => {
      const refusal = custodyInFlightRefusal(inFlight.current)
      if (refusal !== null) throw new Error(refusal)
      setError(null)
      const { failure } = await runCustodyWork(inFlight, work, readHoldings)
      setBusy(null)
      setSendStep(null)
      if (failure === null) return
      console.warn('[account-custody] that payment did not finish', failure)
      /* THE SHEET GETS A SENTENCE, THE CONSOLE GETS THE CAUSE — the same rule
         `run` follows, and for the same reason: a cause from a vendor, a WASM
         deserialiser, or a node carries exactly the words this app keeps off
         its screens. */
      throw new Error(custodyFailureSentence(failure))
    },
    [readHoldings],
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
      await runPayment(async () => {
        setNotice(null)
        const { account, record, wallet } = await custodyContext()
        const asset = custodyAssetRow(assetRows, params.tokenType)
        if (asset === null) throw new Error('This Passport does not hold that token.')
        const { accountModuleFor } = await import('../identity/accountCustody.js')
        const recipientModule = await accountModuleFor(
          { indexerHttpUrl: wallet.network.indexerHttpUrl },
          params.accountAddress,
        )
        const label = normaliseNameForRecovery(params.domain)
        await sendShielded({
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
      })
    },
    [assetRows, custodyContext, reportSent, runPayment, sendShielded],
  )

  /** The same amount, out to a shielded address somebody pasted or scanned. */
  const sendShieldedToPastedAddress = useCallback(
    async (params: {
      recipientAddress: string
      tokenType: string
      amount: bigint
    }): Promise<void> => {
      await runPayment(async () => {
        setNotice(null)
        const { account, record, wallet } = await custodyContext()
        const asset = custodyAssetRow(assetRows, params.tokenType)
        if (asset === null) throw new Error('This Passport does not hold that token.')
        await sendShieldedToAddress({
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
      })
    },
    [assetRows, custodyContext, reportSent, runPayment, sendShieldedToAddress],
  )

  /**
   * What the picker may offer, read again when the sheet opens.
   *
   * THE ROWS ON SCREEN ARE HANDED TO THE SHEET SEPARATELY so its first frame is
   * already populated; this is the re-read behind them, and it is the answer a
   * send is enabled against. Both come out of `../lib/custodyHome.ts`, so the
   * strip, the shelf, and the picker cannot disagree.
   */
  const readShieldedHoldings = useCallback(async (): Promise<
    { tokenType: string; amount: bigint }[]
  > => {
    await readHoldings()
    return custodyHomeSendableHoldings({
      night: balance,
      shielded: tokens,
      balanceFailed,
      stablecoinColourHex: STABLECOIN_COLOUR,
      arriving,
    })
  }, [arriving, balance, balanceFailed, readHoldings, tokens])

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
   * Home. See `../lib/recoveryStep.ts#recoveryFailureSentence`.
   */
  const runRecoveryAdd = useCallback(
    async (signIn: CustodySocialSignIn): Promise<void> => {
      if (recoveryRunning.current) return
      recoveryRunning.current = true
      setBusy(RECOVERY_COPY.busy)
      setError(null)
      try {
        const identity = await ensureIdentity()
        const spare = await signIn.device()
        await addDeviceK1(arm.session, identity.device, spare, (phase) =>
          setBusy(PHASE_LABELS[phase.step] ?? RECOVERY_COPY.busy),
        )
        saveBackupRecord(window.localStorage, identity.userKey, network, {
          doneAt: Date.now(),
          ...(signIn.provider === null ? {} : { provider: signIn.provider }),
        })
        setNotice(RECOVERY_COPY.done(signIn.provider))
      } catch (cause) {
        console.warn('[account-custody] the way back could not be added', cause)
        setError(recoveryFailureSentence(cause))
      } finally {
        recoveryRunning.current = false
        setRecoveryIntended(false)
        setBusy(null)
        refresh()
      }
    },
    [arm.session, ensureIdentity, network, refresh],
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
                ? custodySetupSubStages(setupPhase, timelineName !== null ? aliasDomain(timelineName) : undefined)
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
                    recoveryDue: recoveryStepDue({
                      setupFinished: view?.stage === 'name' || view?.stage === 'home',
                      claimedName: view?.name ?? null,
                      socialAvailable,
                      heldBySocial,
                      record: recoveryRecord,
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

  if (stage === 'recovery') {
    return (
      <RecoveryStep
        provider={social?.provider ?? null}
        busy={busy}
        error={error}
        onAdd={addRecovery}
        onSkip={skipRecovery}
      />
    )
  }

  if (stage === 'home') {
    /* THE REAL HOME, AND NOT A SECOND ONE (2026/09/22). Everything below the
       name is the shell every other Passport gets — the greeting, Send and
       Receive, the asset rows, the name card, "Your account is ready", the
       apps, the trail, and the bottom bar — painted by `App.tsx` from this
       value. See `CustodyPassportProps.renderHome`. */
    const offer = custodyResumeOffer(stopped)
    return renderHome({
      user,
      network,
      name: view?.name ?? null,
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
      error: error ?? notice ?? (offer.kind === 'report' ? offer.sentence : null),
      stoppedSentence: offer.kind === 'report' ? offer.sentence : null,
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
        dismissStoppedSend()
      },
      onDismissStopped: dismissStoppedSend,
      /* WHETHER THIS PASSPORT CAN BE OPENED ANYWHERE ELSE — one line where it
         can, one small entry where it cannot yet. The offer after the name is
         asked once; this is where somebody who said "not now", or whose
         Passport predates the step, finds it again. */
      recovery: {
        state: recoveryHomeEntry({ socialAvailable, heldBySocial, record: recoveryRecord }),
        onAdd: addRecovery,
      },
      send: {
        networkId: network,
        resolveName,
        /* THE ACCOUNT'S NIGHT, REFUSED IN ONE SENTENCE, whichever way it is
           addressed — the route it would take is the one ruled out on
           2026/09/18. See `CUSTODY_NIGHT_SEND_REFUSAL`. */
        onSend: () => Promise.reject(new Error(CUSTODY_NIGHT_SEND_REFUSAL)),
        onSendToName: () => Promise.reject(new Error(CUSTODY_NIGHT_SEND_REFUSAL)),
        onSendShielded: sendShieldedToPastedAddress,
        onSendShieldedToName: sendShieldedToName,
        readShieldedHoldings,
        phase: custodySendPhase(sendStep),
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

function Shell(props: { label: string; children: React.ReactNode }) {
  return (
    <section className="mnob-screen mndyn">
      <header className="mnob-bar">
        <img className="mnob-wordmark" src="/midnight-wordmark.svg" alt="Midnight" />
        <span className="mnob-bar-label">{props.label}</span>
        <ThemeToggle size="sm" className="mnob-theme" />
      </header>
      <div className="mnob-body">{props.children}</div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* The page that says what a Passport is                                      */
/* -------------------------------------------------------------------------- */

/**
 * THE FOUR PROMISES, and every one of them is a thing this build does today.
 *
 * Adapted from `Welcome.tsx`, which has said them to passkey holders since
 * 2026/08/26 — "an intro page… what is this, what am I getting" (Hector,
 * 09:47) — and is now said to BOTH arms in the same words. The first point is
 * the only one that had to change: the passkey road could say "behind the
 * passkey you just made", and this one cannot, because half its readers signed
 * in with Google. What is true of both is that nobody issued it to them.
 *
 * An intro screen is the worst possible place to over-claim: it is read before
 * anything can contradict it. Nothing here describes a feature that is coming.
 */
const WELCOME_POINTS = [
  {
    icon: Fingerprint,
    title: 'An identity you hold',
    body: 'Your Passport is yours. Nobody issues it to you, nobody holds it for you, and nobody can take it back.',
  },
  {
    icon: Tag,
    title: 'A name, not an address',
    body: 'Pick a name people can actually send to and apps can recognise you by, instead of a long string you have to copy carefully.',
  },
  {
    icon: Sparkles,
    title: 'Fees are covered for you',
    body: 'You hold nothing and spend nothing to get started. Setting your Passport up is paid for on your behalf.',
  },
  {
    icon: BadgeCheck,
    title: 'Prove things privately',
    body: 'Share what an app genuinely needs to know about you — and nothing else. You are asked every time, and you can say no.',
  },
] as const

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
  return (
    <Shell label="Welcome">
      <p className="mnob-kicker">{props.kicker}</p>
      <h1 className="mnob-title">
        <span>Welcome to</span>
        <span>Passport</span>
      </h1>
      <p className="mnob-lede">{props.lede}</p>

      {/* WHAT THIS BROWSER ALREADY HOLDS, said before the offer rather than
          discovered afterwards as a second Passport with a second name to
          claim. See `../lib/custodyRoute.ts`. */}
      {props.browserNotice !== null ? (
        <p className="mnob-hint mndyn-browser-notice" role="status">
          {props.browserNotice}
        </p>
      ) : null}

      <ul className="mndyn-points">
        {WELCOME_POINTS.map((point) => (
          <li key={point.title} className="mndyn-point">
            <span className="mndyn-point-mark" aria-hidden="true">
              <point.icon size={16} strokeWidth={2} />
            </span>
            <span className="mndyn-point-text">
              <span className="mndyn-point-title">{point.title}</span>
              <span className="mndyn-point-body">{point.body}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="mndyn-actions">
        <button type="button" className="mnob-primary" onClick={props.onChooseName}>
          <span className="mnob-primary-copy">
            <Tag size={17} strokeWidth={2} aria-hidden="true" />
            Choose my name
          </span>
          <ArrowRight size={17} strokeWidth={2.2} aria-hidden="true" />
        </button>
        {/* The way in for somebody who is not new. It is quiet, and under the
            primary action, because the common reader of this screen genuinely
            is making their first Passport. */}
        <button type="button" className="mnob-alt" onClick={props.onRecover}>
          I already have a Passport
        </button>
      </div>
    </Shell>
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
    <Shell label="Passport">
      <p className="mnob-kicker">{props.kicker}</p>
      <h1 className="mnob-title">
        <span>Choose</span>
        <span>your .night name</span>
      </h1>
      <p className="mnob-lede">
        Pick a name people can send to, instead of a long string they have to copy carefully. It is
        part of your Passport from the moment it is made.
      </p>

      <form
        className="mnob-stage"
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
