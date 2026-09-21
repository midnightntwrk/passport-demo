/**
 * EVERY FIGURE AND EVERY SENTENCE THE DYNAMIC PASSPORT'S HOME CAN SHOW,
 * enumerated in one place and held to the two rules that matter.
 *
 * WHAT THIS PROTECTS
 * ------------------
 *   1. A FIGURE THAT MISREPORTS SOMEBODY'S MONEY. There are three states a
 *      balance can be in — a figure, a read that has not happened, and a read
 *      that failed — and showing the second or third as `0` is the lie this
 *      screen most easily tells. There are also two kinds of money that are not
 *      balance: coins arriving, which are here and not spendable yet, and a
 *      payment that stopped between its legs, which is out of the account
 *      altogether. Neither may be added to a figure, and neither may be silent.
 *   2. A WORD THE READER NEVER CHOSE TO MEET. Every sentence below is run
 *      through the vocabulary guard, including the ones that come out of a
 *      FAILURE — a proving service, a fee sponsor answering 429, an indexer
 *      that is down — because those are the paths where developer words reach a
 *      screen without anybody having written them.
 *
 * `./custodyAssets.test.ts` drills each helper against the case it was written
 * for. This file drills the SCREEN's set of them: the rows for every holding
 * state, the offer for every stage a payment can stop at, and one enumeration
 * that no sentence escapes.
 */

import { describe, expect, it } from 'vitest';

import {
  custodyAmountFigure,
  custodyArrivingSentence,
  custodyAssetRow,
  custodyAssetRows,
  custodyResumeOffer,
  custodyReturnedSentence,
  custodyStablecoinColour,
  formatCustodyAmount,
  parseCustodyAmount,
} from './custodyAssets.js';
import { MUSD_COLOUR_HEX, NIGHT_COLOUR_HEX } from './colour.js';
import {
  CUSTODY_APPROVAL_WAITING,
  custodyApprovalPrompt,
  custodyShieldedSendOutcome,
  newCustodyShieldedSend,
  type CustodyShieldedSendRecord,
  type CustodyShieldedSendStage,
} from '../identity/custodyContractSend.js';
import {
  CUSTODY_PROVER_UNAVAILABLE,
  CUSTODY_SETUP_INTERRUPTED,
  CUSTODY_UNEXPECTED,
  custodyFailureSentence,
} from '../identity/custodyContractPlan.js';

/** The guard, as every other drill of this demo's copy writes it. */
const FORBIDDEN = /wallet address|DUST|contract|registry|indexer|resolver|sponsor|SDK|Dynamic/i;

const OTHER_COLOUR = '3c'.repeat(32);

function record(patch: Partial<CustodyShieldedSendRecord> = {}): CustodyShieldedSendRecord {
  return {
    ...newCustodyShieldedSend({
      network: 'stagenet',
      accountAddress: 'aa'.repeat(32),
      colourHex: MUSD_COLOUR_HEX,
      amount: 40n,
      recipientLabel: 'alice.night',
      recipientAccountAddress: 'dd'.repeat(32),
      now: 1_700_000_000_000,
    }),
    ...patch,
  };
}

/* -------------------------------------------------------------------------- */
/* The rows, for every state a Passport's holdings can be in                  */
/* -------------------------------------------------------------------------- */

describe('the holdings a Passport shows', () => {
  const stablecoin = custodyStablecoinColour(MUSD_COLOUR_HEX);

  it('shows NIGHT and the stablecoin even when it has been paid nothing', () => {
    const rows = custodyAssetRows({ night: 0n, shielded: [], stablecoinColourHex: stablecoin });
    expect(rows.map((row) => row.symbol)).toEqual(['NIGHT', 'mUSD']);
    /* A readable zero, rather than a puzzle about where a token went. */
    expect(custodyAmountFigure(rows[0].amount, rows[0].decimals)).toBe('0');
    expect(custodyAmountFigure(rows[1].amount, rows[1].decimals)).toBe('0');
  });

  it('shows a held coin as the figure a person can spend', () => {
    const rows = custodyAssetRows({
      night: 2_500_000n,
      shielded: [{ colourHex: MUSD_COLOUR_HEX, amount: 40n }],
      stablecoinColourHex: stablecoin,
    });
    expect(custodyAmountFigure(rows[0].amount, rows[0].decimals)).toBe('2.5');
    expect(custodyAssetRow(rows, MUSD_COLOUR_HEX)?.amount).toBe(40n);
  });

  it('adds a queue behind a held coin into one figure, because both are held', () => {
    /* The screen hands in held + queued as one amount — what the account HOLDS
       of a colour. What one payment can draw on is smaller, and the difference
       is a sentence rather than a smaller figure. */
    const rows = custodyAssetRows({
      night: 0n,
      shielded: [{ colourHex: MUSD_COLOUR_HEX, amount: 140n }],
      stablecoinColourHex: stablecoin,
    });
    expect(custodyAssetRow(rows, MUSD_COLOUR_HEX)?.amount).toBe(140n);
  });

  it('keeps a colour that is not the stablecoin, and names it apart from the others', () => {
    const rows = custodyAssetRows({
      night: 0n,
      shielded: [
        { colourHex: MUSD_COLOUR_HEX, amount: 40n },
        { colourHex: OTHER_COLOUR, amount: 7n },
      ],
      stablecoinColourHex: stablecoin,
    });
    expect(rows).toHaveLength(3);
    const symbols = rows.map((row) => row.symbol);
    expect(new Set(symbols).size).toBe(3);
  });

  it('never counts NIGHT twice, however a shielded row names it', () => {
    const rows = custodyAssetRows({
      night: 10n,
      shielded: [{ colourHex: NIGHT_COLOUR_HEX, amount: 999n }],
      stablecoinColourHex: stablecoin,
    });
    expect(rows.filter((row) => row.colourHex === NIGHT_COLOUR_HEX)).toHaveLength(1);
    expect(rows[0].amount).toBe(10n);
  });

  it('drops a row whose colour is not one, rather than heading a figure with nothing', () => {
    const rows = custodyAssetRows({
      night: 0n,
      shielded: [{ colourHex: 'not-a-colour', amount: 40n }],
      stablecoinColourHex: stablecoin,
    });
    expect(rows).toHaveLength(2);
    expect(custodyAssetRow(rows, MUSD_COLOUR_HEX)?.amount).toBe(0n);
  });

  it('tells a read that has not happened apart from one that failed, and from zero', () => {
    expect(custodyAmountFigure(0n, 6)).toBe('0');
    expect(custodyAmountFigure(null, 6)).toBe('—');
    expect(custodyAmountFigure(null, 6, true)).toBe('Unavailable');
    /* A FAILED READ IS NEVER A ZERO. That is the one of the three that would
       tell somebody their Passport is empty when it is not. */
    expect(custodyAmountFigure(null, 6, true)).not.toBe('0');
  });

  it('says what is arriving, and only when something is', () => {
    expect(custodyArrivingSentence(0)).toBeNull();
    expect(custodyArrivingSentence(-1)).toBeNull();
    expect(custodyArrivingSentence(Number.NaN)).toBeNull();
    expect(custodyArrivingSentence(1)).toBe(
      'One payment is still arriving. It will be ready to spend in a moment.',
    );
    expect(custodyArrivingSentence(4)).toBe(
      '4 payments are still arriving. They will be ready to spend in a moment.',
    );
  });

  it('formats and reads back an amount of each kind, without moving the point', () => {
    expect(formatCustodyAmount(2_500_000n, 6)).toBe('2.5');
    expect(formatCustodyAmount(40n, 0)).toBe('40');
    expect(parseCustodyAmount('2.5', 6)).toBe(2_500_000n);
    expect(parseCustodyAmount('40', 0)).toBe(40n);
    /* A colour with no scale takes no decimal point, and the refusal says so
       rather than inviting something that is then refused. */
    expect(() => parseCustodyAmount('2.5', 0)).toThrow('Enter a whole amount, like 5.');
    expect(() => parseCustodyAmount('1.2345678', 6)).toThrow('Enter an amount like 1 or 1.5.');
  });
});

/* -------------------------------------------------------------------------- */
/* The offer, for every stage a payment can stop at                           */
/* -------------------------------------------------------------------------- */

describe('what a Passport offers about a payment that stopped', () => {
  const expectations: {
    stage: CustodyShieldedSendStage;
    kind: 'none' | 'finish' | 'report';
    says?: RegExp;
  }[] = [
    { stage: 'withdrawing', kind: 'report', says: /still in your Passport/ },
    { stage: 'awaiting-note', kind: 'finish', says: /can still be delivered/ },
    { stage: 'depositing', kind: 'finish', says: /can still be delivered/ },
    { stage: 'returning', kind: 'report', says: /being put back/ },
    { stage: 'unconfirmed', kind: 'report', says: /nothing here can see whether/ },
    { stage: 'stranded', kind: 'report', says: /could not be put back/ },
    { stage: 'done', kind: 'none' },
  ];

  for (const expectation of expectations) {
    it(`offers ${expectation.kind} at ${expectation.stage}`, () => {
      const offer = custodyResumeOffer(record({ stage: expectation.stage }));
      expect(offer.kind).toBe(expectation.kind);
      if (expectation.says !== undefined && 'sentence' in offer) {
        expect(offer.sentence).toMatch(expectation.says);
      }
    });
  }

  it('offers nothing at all when there is no payment outstanding', () => {
    expect(custodyResumeOffer(null)).toEqual({ kind: 'none' });
  });

  it('names the amount and the colour out of the record, not off the screen', () => {
    /* The money has left the account, so the colour may have no row left at
       all — "your payment of 40" with nothing after it is worse than a
       shortened colour. */
    const offer = custodyResumeOffer(record({ stage: 'awaiting-note' }));
    expect(offer).toMatchObject({ kind: 'finish', action: 'Finish this payment' });
    if (offer.kind !== 'finish') throw new Error('unreachable');
    expect(offer.sentence).toContain('40 mUSD');
    expect(offer.sentence).toContain('alice.night');
  });

  it('still reads as a sentence when there is no name to use', () => {
    const offer = custodyResumeOffer(record({ stage: 'awaiting-note', recipientLabel: '  ' }));
    if (offer.kind !== 'finish') throw new Error('unreachable');
    expect(offer.sentence).toContain('to somebody');
  });
});

/* -------------------------------------------------------------------------- */
/* One enumeration, and nothing escapes it                                    */
/* -------------------------------------------------------------------------- */

describe('every sentence this screen can show', () => {
  /**
   * The failures a person actually meets on this path, in the words the layer
   * below hands up. Each goes through `custodyFailureSentence`, which is the
   * one funnel between a library's message and a screen.
   */
  const failures: { name: string; cause: unknown }[] = [
    { name: 'the proving service is down', cause: new Error(CUSTODY_PROVER_UNAVAILABLE) },
    {
      name: 'the proving service answered 503',
      cause: new Error('Request failed with status 503 at https://example.test/prove-account-custody'),
    },
    {
      name: 'the fee sponsor is rate limiting',
      cause: new Error('POST https://sponsor.example/balancer/fund 429 Too Many Requests'),
    },
    {
      name: 'the indexer is unreachable',
      cause: new Error('FetchError: request to https://indexer.example/api/v4/graphql failed'),
    },
    { name: 'the setup was interrupted', cause: new Error(CUSTODY_SETUP_INTERRUPTED) },
    { name: 'no Passport under that name', cause: new Error('No Passport is registered under that name.') },
    {
      name: 'the name is not a Passport that can be paid',
      cause: new Error('That name does not belong to a Passport that can be paid.'),
    },
    { name: 'nothing of that kind to send', cause: new Error('There is nothing of that kind in this Passport to send.') },
    { name: 'a library read something it did not expect', cause: new TypeError("Cannot use 'in' operator to search for 'deploy' in undefined") },
    {
      name: 'a library wrapped our own sentence in its preamble',
      cause: new Error(
        "Unexpected error submitting scoped transaction '<unnamed>': Error: The service that finishes this step is not answering right now.",
      ),
    },
    { name: 'something with no message at all', cause: new Error('') },
    { name: 'something that is not an error', cause: 'a string' },
  ];

  it('says none of the words a person has never chosen to meet, in any of them', () => {
    const sentences: string[] = [
      custodyArrivingSentence(1) as string,
      custodyArrivingSentence(9) as string,
      custodyReturnedSentence('alice.night'),
      custodyReturnedSentence('  '),
      custodyApprovalPrompt('Google'),
      custodyApprovalPrompt(null),
      CUSTODY_APPROVAL_WAITING,
      custodyAmountFigure(null, 6, true),
      'Enter a whole amount, like 5.',
      'Enter an amount like 1 or 1.5.',
    ];

    for (const stage of [
      'withdrawing',
      'awaiting-note',
      'depositing',
      'returning',
      'unconfirmed',
      'stranded',
      'done',
    ] as CustodyShieldedSendStage[]) {
      sentences.push(custodyShieldedSendOutcome(record({ stage })));
      const offer = custodyResumeOffer(record({ stage }));
      if ('sentence' in offer) sentences.push(offer.sentence);
      if ('action' in offer) sentences.push(offer.action);
    }

    for (const failure of failures) {
      sentences.push(custodyFailureSentence(failure.cause));
    }

    /* A count, so a refactor that quietly stops enumerating is a failure here
       rather than a green run over nothing. */
    expect(sentences.length).toBeGreaterThan(25);
    for (const sentence of sentences) {
      expect(sentence, sentence).not.toMatch(FORBIDDEN);
      expect(sentence.length, sentence).toBeGreaterThan(0);
    }
  });

  it('turns a failure that is not ours into the one sentence that is', () => {
    /* A machine-shaped message must not be painted, however short it is: the
       reader gets our sentence, and the cause goes to the console. */
    for (const failure of failures.slice(-4)) {
      const sentence = custodyFailureSentence(failure.cause);
      expect(sentence, failure.name).not.toMatch(FORBIDDEN);
    }
    expect(custodyFailureSentence(new TypeError('x'))).toBe(CUSTODY_UNEXPECTED);
    expect(custodyFailureSentence('a string')).toBe(CUSTODY_UNEXPECTED);
    /* And our own sentences survive, because a person can act on them. */
    expect(custodyFailureSentence(new Error('No Passport is registered under that name.'))).toBe(
      'No Passport is registered under that name.',
    );
  });
});
