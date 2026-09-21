/**
 * WHAT A PASSPORT HELD BY A SOCIAL SIGN-IN HOLDS, AND WHAT IT CAN SEND.
 *
 * WHY IT IS A MODULE AND NOT TWENTY LINES IN THE SCREEN
 * ----------------------------------------------------
 * Two decisions live here, and both have an expensive wrong answer.
 *
 *   1. WHICH ROWS EXIST AND WHAT EACH IS CALLED. The account's NIGHT comes off
 *      the contract's own mirror; everything else comes out of the coin store,
 *      which holds one spendable coin per colour and a queue behind it
 *      (`../identity/k1CoinStore.ts`). A colour left off the list is money the
 *      holder cannot see and cannot spend, which is the worst thing this screen
 *      could do; a colour shown twice under one ticker is the wrong-send the
 *      naming authority in `./colour.ts` exists to prevent, so the whole list
 *      is named at once through it rather than a row at a time.
 *   2. WHAT A TYPED AMOUNT MEANS. NIGHT carries six decimal places and every
 *      shielded colour on this chain carries none — a shielded colour is minted
 *      by a contract and publishes no decimal scale anywhere on the ledger, so
 *      an amount of it is a whole count of its own units (`./colour.ts`,
 *      `TokenIdentity.decimals`). Reading "5" as five million of something that
 *      has no scale, or as five millionths of something that does, are both
 *      ways of sending the wrong amount of somebody's money with a control that
 *      looked right.
 *
 * THE COPY RULE, WHICH IS THE THIRD REASON
 * ----------------------------------------
 * Every sentence here reaches a person who chose a sign-in, not a chain. None
 * of them names a wallet address, the fee token, a contract, a name registry,
 * an indexer, a resolver, the fee sponsor, an SDK, or the sign-in vendor — and
 * `custodyAssets.test.ts` asserts that rather than trusting it, because a
 * developer-shaped path is where that rule slips first.
 *
 * NO STORAGE, NO NETWORK, NO REACT. The store is read by its own module and the
 * rows arrive here as values, which is what keeps this file in the coverage
 * denominator: every way it can be wrong is a way of misreporting somebody's
 * money.
 */

import {
  MUSD_COLOUR_HEX,
  NIGHT_COLOUR_HEX,
  describeColour,
  describeColours,
  normalisedColourHex,
  sortTokenHoldings,
  type TokenMarkArt,
} from './colour.js';
import {
  custodyShieldedSendOutcome,
  nextCustodyShieldedSendStep,
  type CustodyShieldedSendRecord,
} from '../identity/custodyContractSend.js';

/* -------------------------------------------------------------------------- */
/* Which colour is the stablecoin                                             */
/* -------------------------------------------------------------------------- */

/**
 * The colour this build calls mUSD.
 *
 * A configured colour wins, because a build pointed at another network's asset
 * is a build whose stablecoin is that one; `./colour.ts`'s entry is the
 * fall-back, and it is what names the colour on a build that carries no
 * configuration. Anything that is not 32 bytes of hex is not a colour and is
 * ignored rather than repaired — see {@link normalisedColourHex}.
 */
export function custodyStablecoinColour(configured?: string | null): string {
  return normalisedColourHex(configured) ?? MUSD_COLOUR_HEX;
}

/* -------------------------------------------------------------------------- */
/* The rows                                                                   */
/* -------------------------------------------------------------------------- */

/** Which ledger a row lives on, and therefore which send it takes. */
export type CustodyAssetMode = 'unshielded' | 'shielded';

/** One thing the Passport holds, as Home shows it and Send offers it. */
export interface CustodyAssetRow {
  /** Stable identity for the picker: the colour, which is unique by definition. */
  readonly id: string;
  readonly colourHex: string;
  /** What leads the row. Named across the whole list, so no two read alike. */
  readonly symbol: string;
  /** How many decimal places an amount of it is quoted with. */
  readonly decimals: number;
  /** The asset's own mark, where this build has one. */
  readonly mark?: TokenMarkArt;
  /** Atomic units held, or null where nothing has been read yet. */
  readonly amount: bigint | null;
  readonly mode: CustodyAssetMode;
}

/** What the rows are built from. */
export interface CustodyAssetRowsInput {
  /** The account's own NIGHT, off the contract's mirror, or null when unread. */
  readonly night: bigint | null;
  /** Every shielded colour the coin store holds, held and queued together. */
  readonly shielded: readonly { readonly colourHex: string; readonly amount: bigint }[];
  /** The colour to show as the stablecoin — {@link custodyStablecoinColour}. */
  readonly stablecoinColourHex: string;
}

/**
 * NIGHT first, then the stablecoin, then every other colour the store holds.
 *
 * NIGHT IS ALWAYS PRESENT, at whatever balance, for the reason
 * `./sendAssets.ts` gives about the passkey picker: it is the one asset every
 * Passport has and the only thing a name can be paid in, and removing the row
 * at a zero balance would replace a readable zero with a puzzle about where
 * NIGHT went.
 *
 * THE STABLECOIN ROW IS ALWAYS PRESENT TOO, and that is this list's own
 * decision. A Dynamic Passport is opened with NIGHT and mUSD paid in on its
 * behalf, and the mUSD arrives as a shielded payment whose description reaches
 * the store through the account's own list of deliveries — which can lag the
 * money by a block or by an unreachable indexer. A row that appeared only once
 * the store had caught up would mean a Passport that has been paid showing no
 * sign of it at all; a row reading zero is the honest state of that same
 * moment, and it becomes the balance the instant the description lands.
 *
 * Everything else follows in `sortTokenHoldings`' order — the order Home's
 * balance list puts colours in on the passkey path, so the two screens do not
 * disagree about what a list of colours looks like.
 */
export function custodyAssetRows(input: CustodyAssetRowsInput): CustodyAssetRow[] {
  const stablecoin = custodyStablecoinColour(input.stablecoinColourHex);
  const held = new Map<string, bigint>();
  for (const row of input.shielded) {
    const colour = normalisedColourHex(row.colourHex);
    /* A row whose colour is not one is not a row: it names no token, and the
       amount beside it belongs to nothing. The store drops such rows on the
       way in; this is the second guard, because the cost is a figure shown
       under a heading that identifies nothing. */
    if (colour === null || colour === NIGHT_COLOUR_HEX) continue;
    held.set(colour, (held.get(colour) ?? 0n) + row.amount);
  }
  if (!held.has(stablecoin)) held.set(stablecoin, 0n);
  const shielded = sortTokenHoldings(
    [...held.entries()].map(([colourHex, amount]) => ({ colourHex, amount })),
  );
  const ordered: { colourHex: string; amount: bigint | null; mode: CustodyAssetMode }[] = [
    { colourHex: NIGHT_COLOUR_HEX, amount: input.night, mode: 'unshielded' },
    ...shielded.map((row) => ({
      colourHex: row.colourHex,
      amount: row.amount,
      mode: 'shielded' as const,
    })),
  ];
  const identities = describeColours(ordered.map((row) => row.colourHex));
  return ordered.map((row, index) => {
    const identity = identities[index];
    return {
      id: row.colourHex,
      colourHex: row.colourHex,
      symbol: identity.symbol,
      decimals: identity.decimals,
      ...(identity.mark ? { mark: identity.mark } : {}),
      amount: row.amount,
      mode: row.mode,
    };
  });
}

/** The row for one colour, or null when the list has none. */
export function custodyAssetRow(
  rows: readonly CustodyAssetRow[],
  colourHex: string,
): CustodyAssetRow | null {
  const wanted = normalisedColourHex(colourHex);
  if (wanted === null) return null;
  return rows.find((row) => row.colourHex === wanted) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Amounts                                                                    */
/* -------------------------------------------------------------------------- */

/** Atomic units as a figure a person reads, trailing zeros trimmed. */
export function formatCustodyAmount(atomic: bigint, decimals: number): string {
  if (decimals <= 0) return atomic.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = atomic / scale;
  const fraction = (atomic % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
}

/**
 * What a balance says when there is no balance to say.
 *
 * Three states and three different characters, because they mean three
 * different things: a figure, a read that has not happened yet, and a read that
 * failed. Showing a failed read as `0` is the one that would be a lie.
 */
export function custodyAmountFigure(
  amount: bigint | null,
  decimals: number,
  failed = false,
): string {
  if (amount !== null) return formatCustodyAmount(amount, decimals);
  return failed ? 'Unavailable' : '—';
}

/**
 * A typed amount in atomic units, or a throw carrying one sentence.
 *
 * THE SENTENCE NAMES THE SHAPE THAT IS ACCEPTED, and it differs by asset on
 * purpose: "like 1 or 1.5" over a colour that has no decimal places would be
 * an invitation to type something that is then refused.
 */
export function parseCustodyAmount(typed: string, decimals: number): bigint {
  const trimmed = typed.trim();
  if (decimals <= 0) {
    if (!/^\d+$/.test(trimmed)) throw new Error('Enter a whole amount, like 5.');
    return BigInt(trimmed);
  }
  const pattern = new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`);
  if (!pattern.test(trimmed)) throw new Error('Enter an amount like 1 or 1.5.');
  const [whole, fraction = ''] = trimmed.split('.');
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
}

/* -------------------------------------------------------------------------- */
/* Money that is here and not yet spendable                                   */
/* -------------------------------------------------------------------------- */

/**
 * The line for coins this Passport demonstrably holds and cannot spend yet, or
 * null when there are none.
 *
 * SHOWN, AND NOT COUNTED AS BALANCE. A coin whose position in the commitment
 * tree is not known cannot go into a proof, so adding it to the figure above
 * would offer a Send that fails; leaving it out silently would be a payment
 * that arrived and that nothing on the screen mentions. So it is its own
 * sentence, and it says the two things that are true: it is here, and it is not
 * ready yet.
 */
export function custodyArrivingSentence(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count === 1
    ? 'One payment is still arriving. It will be ready to spend in a moment.'
    : `${count} payments are still arriving. They will be ready to spend in a moment.`;
}

/* -------------------------------------------------------------------------- */
/* A payment that stopped half-way                                            */
/* -------------------------------------------------------------------------- */

/** What to offer somebody whose last payment did not finish. */
export type CustodyResumeOffer =
  /** Nothing outstanding, or nothing outstanding that a person need be told. */
  | { readonly kind: 'none' }
  /** The value is out and the recipient can still be paid, with no approval. */
  | { readonly kind: 'finish'; readonly sentence: string; readonly action: string }
  /** Nothing left to run. The sentence says where the money is. */
  | { readonly kind: 'report'; readonly sentence: string };

/**
 * Whether a stopped payment can be finished, and what to say about it.
 *
 * `'finish'` is the case this exists for: leg one took the value out of the
 * account into this Passport's own hands and only the last leg makes it the
 * recipient's, and that leg needs no approval from anybody — so a Passport
 * opened again can simply finish it. The offer says so in the two facts that
 * matter to the person: it has left, and it can still be delivered.
 *
 * `'report'` is a record with no leg left to run, and the sentence is A's
 * {@link custodyShieldedSendOutcome} — the one place that answers "where is my
 * money" for every stage a payment can stop at. Nothing is re-worded here,
 * because two wordings of the same fact is how one of them goes stale.
 */
export function custodyResumeOffer(
  record: CustodyShieldedSendRecord | null,
): CustodyResumeOffer {
  if (record === null) return { kind: 'none' };
  const step = nextCustodyShieldedSendStep(record);
  if (step === 'nothing') return { kind: 'none' };
  if (step === 'report' || step === 'withdraw') {
    return { kind: 'report', sentence: custodyShieldedSendOutcome(record) };
  }
  /* NAMED HERE, from the colour, rather than taken from the rows on screen.
     The money has left the account, so the colour it was in may have no row
     left at all — and "your payment of 40" with nothing after it is worse than
     a shortened colour. */
  const identity = describeColour(record.colourHex);
  const who = record.recipientLabel.trim().length > 0 ? record.recipientLabel.trim() : 'somebody';
  const figure = formatCustodyAmount(BigInt(record.amount), identity.decimals);
  return {
    kind: 'finish',
    sentence: `Your payment of ${figure} ${identity.symbol} to ${who} did not finish. It has left your Passport and can still be delivered.`,
    action: 'Finish this payment',
  };
}

/**
 * What to say when a payment that could not be delivered went back where it
 * came from.
 *
 * NOT {@link custodyShieldedSendOutcome}'s `returning` sentence, which says it
 * is BEING put back: by the time this is shown the deposit has landed, and a
 * sentence that leaves somebody waiting for money that is already there is a
 * sentence they will refresh at for a minute.
 */
export function custodyReturnedSentence(recipientLabel: string): string {
  const who = recipientLabel.trim().length > 0 ? recipientLabel.trim() : 'them';
  return `It did not reach ${who}, so it is back in your Passport.`;
}
