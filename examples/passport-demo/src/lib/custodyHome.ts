/**
 * A PASSPORT ON THE ACCOUNT CUSTODY CONTRACT, AS THE REAL HOME ALREADY READS IT.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Until 2026/09/22 a Passport on the account custody contract landed on a page
 * of its own: a name, one figure, "People can pay you at", and a three-field
 * form. Everything the product actually is — the greeting, Send and Receive,
 * the asset rows with their `Arriving` word, the name card, "Your account is
 * ready", the apps, the activity trail, the bottom bar — lived on
 * `../screens/Home.tsx` and was reachable only by the prototype Passports.
 * Which contract holds somebody's money is not a reason to show them a
 * different product.
 *
 * Home is not forked to fix that, and it is not rewritten either. It already
 * takes everything it paints as props, so what was missing was a TRANSLATION:
 * the custody layer's own vocabulary — the contract's unshielded mirror, the
 * k1 coin store's colours, the custody name store, the account address — into
 * the four shapes Home asks for. That translation is this file, and it is pure
 * so that every rule in it can be drilled:
 *
 *   {@link custodyHomeAccount}         what the Passport holds
 *   {@link custodyHomePendingBalances} the word under a figure that has not settled
 *   {@link custodyHomeAliasRecord}     the name card
 *   {@link custodyHomeContractRecord}  "Your account is ready"
 *
 * …plus the trail, which is the other half of the same defect: every milestone
 * of an onboarding was happening and none of it was being written down, so a
 * custody Passport's activity feed was empty for ever. {@link
 * custodyMilestonesLanded} says which rows are newly owed, and it is idempotent
 * against a list of what has already been written, because the sponsor's
 * deposit is OBSERVED rather than awaited — the client learns about it when the
 * balance arrives, which can be on any read, including one after a reload.
 *
 * THE COPY RULE, as everywhere on this path. Nothing here says wallet address,
 * DUST, contract, registry, indexer, resolver, sponsor, SDK, or the name of any
 * sign-in vendor, and `custodyHome.test.ts` asserts it rather than trusting it.
 *
 * NO REACT, NO STORAGE, NO NETWORK. The screen reads the stores and holds the
 * state; everything here takes values and returns values.
 */

import type { AliasRecord } from '../identity/aliasStore.js';
import type { CustodyShieldedSendRecord } from '../identity/custodyContractSend.js';
import type { PassportContractRecord } from '../identity/passportContractStore.js';
/* The two labels the sponsor's deposits are recorded under, taken from the one
   place that owns them rather than re-typed: `lib/activation.ts` matches on
   them by identity to decide whether an opening grant is still on its way, and
   a second spelling here would leave "On the way · 100 mUSD…" under a balance
   that had already arrived. */
import {
  ACTIVATION_DEPOSITED_LABEL,
  ACTIVATION_STABLECOIN_LABEL,
} from './activation.js';
import { NIGHT_COLOUR_HEX, describeColour } from './colour.js';
import {
  custodyAssetRows,
  formatCustodyAmount,
  type CustodyAssetRow,
} from './custodyAssets.js';
import type { PendingBalanceNote, PendingBalanceNotes } from './pendingBalances.js';
import type { SendDraft, SendProgressView } from './sendProgress.js';
import type { RecoveryHomeEntry } from './recoveryStep.js';

/* -------------------------------------------------------------------------- */
/* What the Passport holds                                                    */
/* -------------------------------------------------------------------------- */

/** Everything the rows below are built from. Read by the screen, never here. */
export interface CustodyHoldings {
  /** The account's own NIGHT, off its unshielded mirror, or null when unread. */
  readonly night: bigint | null;
  /** Every shielded colour the coin store holds — held and queued together. */
  readonly shielded: readonly { readonly colourHex: string; readonly amount: bigint }[];
  /** True when the read failed, which is a different answer from "not yet". */
  readonly balanceFailed: boolean;
  /** The colour this build shows as its stablecoin. */
  readonly stablecoinColourHex: string;
  /** Coins that are demonstrably here with no position yet. Never a balance. */
  readonly arriving: number;
}

/**
 * Home's `account` prop — what its balance strip, the Assets shelf, and the
 * Send sheet's picker all read.
 *
 * THE ROWS ARE `custodyAssetRows`' AND NOT A SECOND LIST. That function is
 * already the authority on which colours exist, what each is called, and what
 * scale an amount of it is on (`./custodyAssets.ts`); building a parallel list
 * here is how two surfaces come to disagree about somebody's money. What this
 * does is only re-SHAPE it: NIGHT as a formatted string, because that is the
 * prop's contract, the stablecoin singled out because Home gives it its own
 * slot, and everything else behind it.
 *
 * `status` carries the three answers the strip can paint, and they are three
 * different facts: `ready` is a figure, `loading` is a read that has not
 * happened, `unavailable` is one that failed. A failed read shown as `0` is the
 * one that would be a lie, which is why `balanceFailed` outranks everything.
 */
export interface CustodyHomeAccount {
  readonly nightBalance: string | null;
  readonly stablecoin: { symbol: string; colourHex: string; amount: bigint } | null;
  readonly otherShielded: { colourHex: string; amount: bigint }[];
  readonly status: 'idle' | 'loading' | 'ready' | 'unavailable';
  readonly error: string | null;
}

/** The rows, in the one order both this screen and the Assets shelf use. */
export function custodyHomeRows(holdings: CustodyHoldings): CustodyAssetRow[] {
  return custodyAssetRows({
    night: holdings.night,
    shielded: holdings.shielded,
    stablecoinColourHex: holdings.stablecoinColourHex,
  });
}

export function custodyHomeAccount(holdings: CustodyHoldings): CustodyHomeAccount {
  const rows = custodyHomeRows(holdings);
  const night = rows[0];
  const shielded = rows.slice(1);
  const stablecoinHex = holdings.stablecoinColourHex.trim().toLowerCase();
  const stablecoinRow = shielded.find((row) => row.colourHex === stablecoinHex) ?? null;
  return {
    nightBalance:
      night.amount === null ? null : formatCustodyAmount(night.amount, night.decimals),
    stablecoin: stablecoinRow
      ? {
          symbol: stablecoinRow.symbol,
          colourHex: stablecoinRow.colourHex,
          amount: stablecoinRow.amount ?? 0n,
        }
      : null,
    otherShielded: shielded
      .filter((row) => row.colourHex !== stablecoinRow?.colourHex)
      .map((row) => ({ colourHex: row.colourHex, amount: row.amount ?? 0n })),
    status: holdings.balanceFailed ? 'unavailable' : holdings.night === null ? 'loading' : 'ready',
    error: null,
  };
}

/**
 * What the Send sheet's picker may offer in its first frame.
 *
 * SHIELDED ONLY, AND ONLY WHAT IS POSITIVE. NIGHT is not a shielded holding:
 * the sheet always offers it itself, off the account's own NIGHT figure. A
 * zero row is not a holding either: it is a row that exists so a reader can
 * see the token, which is a different job.
 */
export function custodyHomeSendableHoldings(
  holdings: CustodyHoldings,
): { tokenType: string; amount: bigint }[] {
  return custodyHomeRows(holdings)
    .filter((row) => row.mode === 'shielded' && (row.amount ?? 0n) > 0n)
    .map((row) => ({ tokenType: row.colourHex, amount: row.amount ?? 0n }));
}

/**
 * The one word under a figure that is not the whole truth yet.
 *
 * A COUNT OF ARRIVING COINS IS NOT A BALANCE, and this does not make it one:
 * the figure painted is the figure the store already reports, and all this adds
 * is `Arriving` beneath it. A coin whose position in the commitment tree is not
 * known cannot go into a proof, so adding it to the total would offer a Send
 * that fails; saying nothing at all would be a payment that arrived with no
 * sign of it anywhere. The word is the honest middle.
 *
 * ON THE SHIELDED ROWS ONLY. NIGHT arrives on the account's own mirror, which
 * is either the figure or it is not — there is no queue behind it for a word to
 * be about.
 */
export function custodyHomePendingBalances(
  holdings: CustodyHoldings,
  /**
   * The asset a payment is moving right now, in the Send sheet's own ids —
   * `night`, or the colour — or null. Its row says `Transferring` for as long
   * as the in-progress pill says the payment is running, so the figure and the
   * pill never disagree about whether money is in motion (2026/09/25). It wins
   * over `Arriving` on the same row: the payment is the thing the reader has
   * just done, and it is what the pill is talking about.
   */
  sendingAssetId: string | null = null,
): PendingBalanceNotes {
  const notes = new Map<string, PendingBalanceNote>();
  const arriving = Number.isFinite(holdings.arriving) && holdings.arriving > 0;
  const sending = sendingAssetId === null ? null : sendingAssetId.trim().toLowerCase();
  for (const row of custodyHomeRows(holdings)) {
    const value = formatCustodyAmount(row.amount ?? 0n, row.decimals);
    if (row.mode !== 'shielded') {
      /* Home keys NIGHT by its own constant, whatever the account calls it. */
      if (sending === 'night') notes.set(NIGHT_COLOUR_HEX, { value, state: 'transferring' });
      continue;
    }
    if (sending === row.colourHex) {
      notes.set(row.colourHex, { value, state: 'transferring' });
      continue;
    }
    if (arriving) notes.set(row.colourHex, { value, state: 'arriving' });
  }
  return notes;
}

/* -------------------------------------------------------------------------- */
/* The name card, and the line under it                                       */
/* -------------------------------------------------------------------------- */

/** What the name card says under a name that is still being registered. */
export const CUSTODY_NAME_REGISTERING_REASON =
  'Your name is being registered. This usually takes under a minute.';

/**
 * The name card's record: the `.night` name this Passport holds, pointed at the
 * account it was bound to.
 *
 * `registered` AND NOTHING ELSE. The custody name store only ever holds a name
 * the registration succeeded for — a claim that was refused clears the chosen
 * name and sends the person back to the field (`./custodyNameFirst.ts`), so
 * there is no queued state on this path for the card to report. Writing one
 * anyway would put "not registered yet" under a name that is registered.
 *
 * `resolverTarget: 'contract'` is what makes the card say the name points at
 * this Passport's own account, which is what a sponsored claim binds it to.
 * Null when there is no name: the card then offers its own "choose a name"
 * copy, and the onboarding step is what actually answers it.
 */
export function custodyHomeAliasRecord(input: {
  readonly name: string | null;
  readonly network: string;
  readonly accountAddress: string | null;
  /** The transaction the registration landed in, where this session saw it. */
  readonly registerTxId?: string | null;
  /**
   * A name whose claim is RUNNING and has not landed, or null.
   *
   * Since 2026/09/22 the claim runs beside the activation, so Home can open
   * while the name is still being registered. The card then shows that name
   * as `queued` and `registering` — "being registered", never "Registered" —
   * because a sender cannot reach it yet, and the only thing that turns it
   * into a registered record is the claim landing and `name` being written.
   */
  readonly registeringName?: string | null;
}): AliasRecord | null {
  const name = (input.name ?? '').trim();
  const registering = (input.registeringName ?? '').trim();
  if (name.length === 0 && registering.length > 0) {
    return {
      alias: registering,
      domain: `${registering}.night`,
      network: input.network,
      status: 'queued',
      registering: true,
      queuedReason: CUSTODY_NAME_REGISTERING_REASON,
      registryConfirmed: false,
      resolverTarget: 'contract',
      ...(input.accountAddress ? { resolverTargetHex: input.accountAddress } : {}),
    };
  }
  if (name.length === 0) return null;
  return {
    alias: name,
    domain: `${name}.night`,
    network: input.network,
    status: 'registered',
    registryConfirmed: true,
    resolverTarget: 'contract',
    ...(input.accountAddress ? { resolverTargetHex: input.accountAddress } : {}),
    ...(input.registerTxId ? { registerTxId: input.registerTxId } : {}),
  };
}

/**
 * The "Your account is ready" line, and the address Receive shows.
 *
 * ONE RECORD DOES BOTH, because Home reads the account address off exactly this
 * prop — a `deployed` record's address is the first thing its Receive sheet
 * reaches for. So a Passport whose setup has finished gets a `deployed` record
 * and a Passport still being set up gets nothing at all, which is the same
 * answer the card gives a prototype Passport mid-onboarding: it renders
 * nothing rather than narrating machinery.
 *
 * `ledgerConfirmed: true` is not decoration. Without it the card reads
 * "Setting up your account…" for ever over an account that is demonstrably set
 * up — this Passport's own activation landed, which is the strongest
 * confirmation there is.
 */
export function custodyHomeContractRecord(input: {
  readonly accountAddress: string | null;
  readonly network: string;
  /** Whether every setup step has landed. A half-built account is not ready. */
  readonly ready: boolean;
  /** Who holds it, for the record's own key field. */
  readonly user: string | null;
}): PassportContractRecord | null {
  if (!input.ready || !input.accountAddress) return null;
  return {
    credentialId: input.user ?? '',
    network: input.network,
    status: 'deployed',
    address: input.accountAddress,
    ledgerConfirmed: true,
  };
}

/* -------------------------------------------------------------------------- */
/* What a send is refused with                                                */
/* -------------------------------------------------------------------------- */

/**
 * NIGHT to a name, refused in one sentence (2026/09/22).
 *
 * NIGHT leaves this build's account by ONE route: `withdraw_unshielded`, whose
 * recipient is a `UserAddress` by type. The contract has nothing that moves
 * NIGHT into another account, so a name — which resolves to an account — can
 * be paid in the stablecoin and not in NIGHT. The Send sheet says this at the
 * recipient field before Review (`nightToName: false`); this constant is the
 * backstop behind it, and says the same thing in the same words.
 */
export const CUSTODY_NIGHT_SEND_REFUSAL =
  'NIGHT can be sent to an address for now. To pay a name, choose mUSD.';

/** A name that leads to a Passport on the older build. */
export const CUSTODY_OLDER_NAME_REFUSAL =
  "This name belongs to a Passport on the older version, so it can't be paid from this one. Paying between the two versions isn't supported.";

/** The same, about a Passport account typed out rather than named. */
export const CUSTODY_OLDER_ACCOUNT_REFUSAL =
  "This is a Passport on the older version, so it can't be paid from this one. Paying between the two versions isn't supported.";

/**
 * Whether a recipient's Passport can be paid from this one at all, decided from
 * which build holds it — the answer `accountModuleFor` reads off the account's
 * own operations (`deposit_unshielded` marks this build; the prototype has
 * `withdraw_shielded` and `transfer_shielded_to_account` and not it).
 *
 * THE OLDER BUILD IS REFUSED IN EVERY ASSET, AND AT THE FIELD. The two builds
 * are proved to different intermediate representations and one transaction
 * cannot hold a call of each; there is no migration (2026/09/18). So the
 * sentence goes under the recipient field when the name resolves, never after
 * somebody has approved a payment.
 */
export function custodyRecipientAccountRefusal(
  build: string,
  recipient: 'name' | 'account',
): string | null {
  if (build !== 'account' && build !== 'account-v1') return null;
  return recipient === 'name' ? CUSTODY_OLDER_NAME_REFUSAL : CUSTODY_OLDER_ACCOUNT_REFUSAL;
}

/** The success toast's title, by which ledger the payment left from. */
export function custodySentToastTitle(mode: 'shielded' | 'unshielded'): string {
  return mode === 'shielded'
    ? 'Shielded transfer accepted by the network — confirming'
    : 'Transfer accepted by the network — confirming';
}

/* -------------------------------------------------------------------------- */
/* The seam between the screen that HOLDS a custody Passport and the shell     */
/* that PAINTS it                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Everything `App.tsx` needs to render the real Home over a custody Passport.
 *
 * WHY IT IS A VALUE HANDED UP RATHER THAN STATE LIFTED OUT. Every store this
 * describes is reached through `identity/custodyContractClient.ts`, which
 * statically pulls the wallet — the whole reason `screens/CustodyPassport.tsx`
 * is lazy and the reason `./custodyRoute.ts` has no imports at run time. A hook
 * in `App.tsx` that read those stores would drag all of it into the entry
 * chunk, for every visitor, including the ones who never make a Passport. So
 * the screen keeps the state and the wallet, and hands the shell a plain value
 * with the seams already bound.
 *
 * The send seams are the Send sheet's OWN four, in its own shapes, so the shell
 * passes them straight through and there is no second dispatch to get wrong.
 */
export interface CustodyHomeView {
  readonly user: string | null;
  readonly network: string;
  /** The `.night` name, without its suffix, or null. */
  readonly name: string | null;
  /**
   * The name whose claim is still running beside a Passport that is already
   * usable, or null. See `custodyHomeAliasRecord`'s `registeringName`.
   */
  readonly registeringName?: string | null;
  /** The account this Passport is, and the address Receive offers. */
  readonly accountAddress: string | null;
  /** Whether every setup step has landed. */
  readonly ready: boolean;
  readonly holdings: CustodyHoldings;
  /** Live wallet sync, 0–100, or null when no figure is known. */
  readonly syncPercent: number | null;
  /** A failure from any control, in one sentence, or null. */
  readonly error: string | null;
  /** A payment that stopped and has nothing left to press, or null. */
  readonly stoppedSentence: string | null;
  readonly onRefresh: () => void;
  /**
   * The account watch's cheap look: reads in full only when something has
   * landed since the last read, and answers whether it did (2026/09/25).
   */
  readonly onWatch?: (context: { chasing: boolean }) => Promise<boolean>;
  readonly onDismissError: () => void;
  readonly onDismissStopped: () => void;
  /**
   * WHETHER THIS PASSPORT CAN BE OPENED ANYWHERE ELSE, and what Home may do
   * about it. `state` is `./recoveryStep.ts`'s answer; `onAdd` is the press
   * that starts the same add the step after the name offers.
   */
  readonly recovery?: {
    readonly state: RecoveryHomeEntry;
    readonly onAdd: () => void;
  };
  readonly send: CustodyHomeSend;
  /**
   * THE PAYMENT IN FLIGHT, OR THE ONE THAT HAS JUST FINISHED (2026/09/25), for
   * the pill above the tab bar and the live row at the head of the activity
   * list. Null when there is nothing to say. See `./sendProgress.ts`.
   */
  readonly sendProgress?: CustodySendProgress | null;
  /**
   * THE REST OF THE SETUP, WHEN NOTHING ELSE WILL FINISH IT (2026/09/24).
   * Present only while the Passport's waves are pending and this tab cannot
   * land them silently — see `custodyFinishSetupCard` in
   * `./custodySetupProgress.ts`. While it is present the opening balance is
   * NOT on its way, because it is asked for only after the rest has landed.
   */
  readonly finishSetup?: {
    readonly state: 'offer' | 'running' | 'failed';
    readonly onFinish: () => void;
  } | null;
}

/** A payment in flight, as Home and the other tabs are handed it. */
export interface CustodySendProgress {
  readonly view: SendProgressView;
  /** The asset whose row says `Transferring`, in the sheet's ids, or null. */
  readonly sendingAssetId: string | null;
  /** Puts away an outcome. A running payment cannot be put away. */
  readonly onDismiss: () => void;
}

/** What "Try again" hands back to the Send sheet. Re-exported for the host. */
export type CustodySendDraft = SendDraft;

/** The four seams the Send sheet takes, bound to this Passport's account. */
export interface CustodyHomeSend {
  readonly networkId: string;
  /** Looks a `.night` name up. The same answer shape the prototype gives. */
  readonly resolveName: (
    domain: string,
  ) => Promise<{ found: true; domain: string; accountAddress: string } | { found: false; reason: string }>;
  /** NIGHT, to an `mn_addr…` address. One gated `withdraw_unshielded`. */
  readonly onSend: (params: { recipientAddress: string; amount: bigint }) => Promise<void>;
  /** NIGHT, to a name. Refused — see {@link CUSTODY_NIGHT_SEND_REFUSAL}. */
  readonly onSendToName: (params: {
    domain: string;
    accountAddress: string;
    amount: bigint;
  }) => Promise<void>;
  /** A shielded amount to an address somebody pasted. One transaction. */
  readonly onSendShielded: (params: {
    recipientAddress: string;
    tokenType: string;
    amount: bigint;
  }) => Promise<void>;
  /** A shielded amount to a name. One transaction, paid straight in. */
  readonly onSendShieldedToName: (params: {
    domain: string;
    accountAddress: string;
    tokenType: string;
    amount: bigint;
  }) => Promise<void>;
  /** Whether a resolved Passport can be paid from this one; the sentence if not. */
  readonly checkRecipientAccount: (input: {
    accountAddress: string;
    name: boolean;
  }) => Promise<string | null>;
  /** What the picker may offer, read again when the sheet opens. */
  readonly readShieldedHoldings: () => Promise<{ tokenType: string; amount: bigint }[]>;
  /** The live step of a payment, in the sheet's own four words. */
  readonly phase: 'checking' | 'connecting' | 'submitting' | 'confirming' | null;
  /** The sheet closes once a payment is handed over; the pill carries it. */
  readonly background?: boolean;
  /** Why a second payment waits for the first, or null. */
  readonly inFlightReason?: string | null;
}

/**
 * The custody layer's own step names, in the Send sheet's vocabulary.
 *
 * FOUR WORDS AND NOT SEVEN. The sheet narrates a payment with four, and the
 * custody client reports seven because three of them are about a setup rather
 * than a spend. Mapping rather than widening the sheet's type is deliberate:
 * "Finishing your Passport" has no business appearing over a transfer, and a
 * step this sheet cannot narrate is better shown as the nearest thing that is
 * true than as a word invented for it.
 */
export function custodySendPhase(
  step: 'wallet' | 'deploy' | 'waves' | 'activate' | 'sign' | 'submit' | 'confirm' | null,
): 'checking' | 'connecting' | 'submitting' | 'confirming' | null {
  switch (step) {
    case null:
      return null;
    /* `sign` is read here as opening the account too: the sheet's own
       `checking` line names the fee service, which is not a word a custody
       Passport's screens say (2026/09/22). */
    case 'wallet':
    case 'sign':
      return 'connecting';
    case 'submit':
      return 'submitting';
    case 'confirm':
      return 'confirming';
    default:
      /* A setup step reaching a Send sheet is a state that should not arise;
         reporting it as "submitting" keeps the line moving rather than blanking
         it, and says nothing untrue about where the payment is. */
      return 'submitting';
  }
}

/* -------------------------------------------------------------------------- */
/* The trail                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The five things that happen to a Passport on its way to being one, plus the
 * payments it makes afterwards.
 *
 * Each is a MILESTONE and not an event: it is a fact about the Passport that is
 * either true or not, so a row for it is owed exactly once however many times
 * the screen reads. That is what lets the sponsor's deposit be OBSERVED — the
 * client never waits on it, it simply notices the balance the next time it
 * reads, whenever that is, including after a reload on another day.
 */
export type CustodyMilestone =
  | 'created'
  | 'activated'
  | 'named'
  | 'opening-night'
  | 'opening-stablecoin';

/** One row, in the shape `addActivity` takes. */
export interface CustodyActivityEntry {
  readonly label: string;
  readonly detail: string;
  readonly status: 'pending' | 'complete' | 'blocked' | 'error';
  readonly txHash?: string;
}

/** What each milestone says, and which transaction it links to. */
export function custodyMilestoneEntry(
  milestone: CustodyMilestone,
  input: {
    readonly name?: string | null;
    readonly stablecoinSymbol?: string;
    readonly txHash?: string | null;
  } = {},
): CustodyActivityEntry {
  const tx = input.txHash && input.txHash.trim().length > 0 ? { txHash: input.txHash } : {};
  switch (milestone) {
    case 'created':
      return {
        label: 'Passport created',
        detail: 'Your Passport was made on Midnight.',
        status: 'complete',
        ...tx,
      };
    case 'activated':
      return {
        label: 'Your account is set up',
        detail: 'The key that approves for this Passport was turned on.',
        status: 'complete',
        ...tx,
      };
    case 'named':
      return {
        label: 'Your name is registered',
        detail:
          input.name && input.name.trim().length > 0
            ? `${input.name.trim()}.night now points at your Passport.`
            : 'Your name now points at your Passport.',
        status: 'complete',
        ...tx,
      };
    case 'opening-night':
      return {
        label: ACTIVATION_DEPOSITED_LABEL,
        detail: 'Your opening NIGHT arrived, paid for on your behalf.',
        status: 'complete',
        ...tx,
      };
    case 'opening-stablecoin':
      return {
        label: ACTIVATION_STABLECOIN_LABEL,
        detail: `Your opening ${input.stablecoinSymbol ?? 'stablecoin'} arrived, paid for on your behalf.`,
        status: 'complete',
        ...tx,
      };
  }
}

/** The row one outgoing payment writes. */
export function custodySentEntry(input: {
  readonly amount: bigint;
  readonly decimals: number;
  readonly symbol: string;
  readonly recipient: string;
  readonly txHash?: string | null;
}): CustodyActivityEntry {
  const figure = formatCustodyAmount(input.amount, input.decimals);
  const who = input.recipient.trim().length > 0 ? input.recipient.trim() : 'another Passport';
  return {
    label: `Sent ${figure} ${input.symbol} to ${who}`,
    detail: 'It left your Passport and is on its way.',
    status: 'complete',
    ...(input.txHash && input.txHash.trim().length > 0 ? { txHash: input.txHash } : {}),
  };
}

/**
 * The row a payment interrupted by a reload writes once the chain says it
 * LANDED (2026/09/25).
 *
 * A payment that finishes in the tab writes its row through
 * {@link custodySentEntry} as it goes. One whose tab was closed or reloaded
 * while it was on its way never got that far, and the screen used to report it
 * afterwards with an alert-styled "Sent. … has it." strip over Home instead.
 * The activity list is where a finished payment is recorded, so that is where
 * this one goes too, in the same words — named from the colour alone, because
 * the record is all that survived the reload.
 */
export function custodyLandedSendEntry(record: CustodyShieldedSendRecord): CustodyActivityEntry {
  const identity = describeColour(record.colourHex);
  return custodySentEntry({
    /* The store only hands back records whose amount is a decimal integer. */
    amount: BigInt(record.amount),
    decimals: identity.decimals,
    symbol: identity.symbol,
    recipient: record.recipientLabel,
    txHash: record.sendTxId,
  });
}

/** What the milestones are decided from. Every field is read, never inferred. */
export interface CustodyMilestoneReading {
  /** Milestones already written down for this account. */
  readonly written: readonly string[];
  /** Whether an account exists on chain at all. */
  readonly hasAccount: boolean;
  /** Whether the key that approves for it has been turned on. */
  readonly activated: boolean;
  /** The `.night` name this Passport holds, or null. */
  readonly name: string | null;
  /** The account's own NIGHT, or null when nothing has been read yet. */
  readonly night: bigint | null;
  /** What the stablecoin row holds, or null when nothing has been read yet. */
  readonly stablecoin: bigint | null;
}

/**
 * Which rows are owed that have not been written, in the order they happened.
 *
 * NOTHING IS OWED ON A NULL. A balance nobody has read yet is not a balance of
 * zero, and treating it as one would either write "your opening balance
 * arrived" about money that has not, or — worse the other way round — leave the
 * row unwritten for ever because the first read after a reload found the
 * account already funded and the milestone already "past".
 *
 * THE ORDER IS THE ORDER THEY HAPPEN IN, because the trail sorts by the clock
 * and rows written in one pass share a moment. A pass that discovers a whole
 * finished Passport at once — a second device, a restore, a reload — therefore
 * lays the history down the way it occurred rather than backwards.
 */
export function custodyMilestonesLanded(
  reading: CustodyMilestoneReading,
): CustodyMilestone[] {
  const already = new Set(reading.written);
  const owed: CustodyMilestone[] = [];
  const owe = (milestone: CustodyMilestone, earned: boolean) => {
    if (earned && !already.has(milestone)) owed.push(milestone);
  };
  owe('created', reading.hasAccount);
  owe('activated', reading.hasAccount && reading.activated);
  owe('named', (reading.name ?? '').trim().length > 0);
  owe('opening-night', reading.night !== null && reading.night > 0n);
  owe('opening-stablecoin', reading.stablecoin !== null && reading.stablecoin > 0n);
  return owed;
}

/**
 * Which transaction a milestone's row links to, or null where there is none.
 *
 * THE SETUP'S HASHES ARE ORDERED, NEWEST LAST — that is the record's own
 * contract (`../identity/custodyContractPlan.ts`) — so the deploy is the first
 * and turning the key on is the last. They are read positionally rather than
 * labelled because the record does not label them, and inventing a label here
 * would be this module claiming to know something it was not told.
 *
 * A MISSING HASH IS NOT AN ERROR. A record healed from the chain — the fix of
 * 2026/09/22, where the activation landed and the confirmation was lost — is
 * marked activated with no hash to show for it, and a Passport read for the
 * first time on a second device has none of them. The row is still true and
 * still worth writing; it simply carries no link, which is what the feed
 * already renders for every row without one.
 */
export function custodyMilestoneTxHash(
  milestone: CustodyMilestone,
  txHashes: readonly string[],
  registerTxId: string | null,
): string | null {
  if (milestone === 'created') return txHashes[0] ?? null;
  if (milestone === 'activated') return txHashes[txHashes.length - 1] ?? null;
  if (milestone === 'named') return registerTxId;
  /* The deposits are the sponsor's own transactions and are never seen by this
     client: it learns of them by the balance changing, which carries no hash. */
  return null;
}

/**
 * The sponsor's opening deposit into this account, read off the account's own
 * chain history (2026/09/22), so the two opening rows carry a View link like
 * every other row. The history is oldest first; the opening grant is the FIRST
 * `deposit_unshielded` (NIGHT) or `deposit_shielded` (stablecoin) that
 * succeeded. Null when the history has not been read or holds no such call.
 */
export function custodyOpeningDepositTxHash(
  milestone: CustodyMilestone,
  rows: readonly { entryPoint: string | null; txHash: string | null; status?: string | null }[] | null,
): string | null {
  if (rows === null) return null;
  const wanted =
    milestone === 'opening-night' ? 'deposit_unshielded' : milestone === 'opening-stablecoin' ? 'deposit_shielded' : null;
  if (wanted === null) return null;
  const row = rows.find(
    (candidate) =>
      candidate.entryPoint === wanted &&
      candidate.txHash !== null &&
      (candidate.status === undefined || candidate.status === null || candidate.status === 'SUCCESS'),
  );
  return row?.txHash ?? null;
}

/**
 * Where the written milestones are remembered, per account and network.
 *
 * PER ACCOUNT, not per browser and not per holder: a second Passport made on
 * the same machine has its own history, and a browser that has never seen this
 * one has none of it — which is correct, because the trail itself is stored the
 * same way and a device with no trail is a device with nothing to avoid
 * repeating.
 */
export function custodyActivityMarkKey(network: string, accountAddress: string): string {
  return `passport-account-custody-activity:v1:${network}::${accountAddress.toLowerCase()}`;
}

/* -------------------------------------------------------------------------- */
/* The stablecoin figure the milestones are read from                         */
/* -------------------------------------------------------------------------- */

/**
 * What the stablecoin row holds, or null when nothing has been read.
 *
 * `null` AND `0n` ARE DIFFERENT ANSWERS and this is the one place that keeps
 * them apart on the shielded side: the rows always CARRY a stablecoin row, at
 * zero where nothing has arrived, so a caller reading the row alone cannot tell
 * "paid nothing yet" from "not read yet". An empty holdings list before the
 * first read is the second, and the milestone above must not fire on it.
 */
export function custodyStablecoinHeld(
  holdings: CustodyHoldings,
  read: boolean,
): bigint | null {
  if (!read) return null;
  const stablecoinHex = holdings.stablecoinColourHex.trim().toLowerCase();
  let total = 0n;
  for (const row of holdings.shielded) {
    if (row.colourHex.trim().toLowerCase() === stablecoinHex) total += row.amount;
  }
  return total;
}

/** The NIGHT colour, re-exported so a caller need not reach past this module. */
export { NIGHT_COLOUR_HEX };
