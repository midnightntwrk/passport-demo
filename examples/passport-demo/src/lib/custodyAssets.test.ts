/**
 * The Dynamic Passport's money, drilled.
 *
 * Every case here is either a balance shown wrong, an amount read wrong, or a
 * sentence carrying a word its reader never asked to meet.
 */

import { describe, expect, it } from 'vitest';

import {
  MUSD_COLOUR_HEX,
  NIGHT_COLOUR_HEX,
  SUSD_COLOUR_HEX,
} from './colour.js';
import {
  custodyAmountFigure,
  custodyArrivingSentence,
  custodyAssetRow,
  custodyAssetRows,
  custodyResumeOffer,
  custodyStablecoinColour,
  formatCustodyAmount,
  parseCustodyAmount,
} from './custodyAssets.js';
import type { CustodyShieldedSendRecord } from '../identity/custodyContractSend.js';

const OTHER_COLOUR = 'cd'.repeat(32);

function sendRecord(
  over: Partial<CustodyShieldedSendRecord> = {},
): CustodyShieldedSendRecord {
  return {
    network: 'stagenet',
    accountAddress: 'ab'.repeat(32),
    stage: 'sending',
    colourHex: MUSD_COLOUR_HEX,
    amount: '40',
    recipientLabel: 'alice',
    recipientAccountAddress: 'dd'.repeat(32),
    sendTxId: 'ff',
    startedAt: 0,
    ...over,
  };
}

describe('custodyStablecoinColour', () => {
  it('takes a configured colour and falls back to the one this build knows', () => {
    expect(custodyStablecoinColour(OTHER_COLOUR)).toBe(OTHER_COLOUR);
    expect(custodyStablecoinColour(`0x${OTHER_COLOUR.toUpperCase()}`)).toBe(OTHER_COLOUR);
    expect(custodyStablecoinColour(null)).toBe(MUSD_COLOUR_HEX);
    expect(custodyStablecoinColour()).toBe(MUSD_COLOUR_HEX);
    /* Not a colour is not an abbreviation: a short value is a misconfiguration
       and padding it would show one colour's balance under another's name. */
    expect(custodyStablecoinColour('1a29')).toBe(MUSD_COLOUR_HEX);
  });
});

describe('custodyAssetRows', () => {
  it('leads with NIGHT and always carries the stablecoin, even at nothing', () => {
    const rows = custodyAssetRows({
      night: 2_500_000n,
      shielded: [],
      stablecoinColourHex: MUSD_COLOUR_HEX,
    });
    expect(rows.map((row) => [row.symbol, row.amount, row.decimals, row.mode])).toEqual([
      ['NIGHT', 2_500_000n, 6, 'unshielded'],
      ['mUSD', 0n, 0, 'shielded'],
    ]);
    /* Both of these carry a mark in this build, and the row hands it on. */
    expect(rows[0].mark).toBeDefined();
    expect(rows[1].mark).toBeDefined();
  });

  it('shows a NIGHT balance that has not been read as unread rather than zero', () => {
    const rows = custodyAssetRows({
      night: null,
      shielded: [],
      stablecoinColourHex: MUSD_COLOUR_HEX,
    });
    expect(rows[0].amount).toBeNull();
  });

  it('adds every other colour the store holds, named, in the balance list order', () => {
    const rows = custodyAssetRows({
      night: 0n,
      shielded: [
        { colourHex: OTHER_COLOUR, amount: 3n },
        { colourHex: SUSD_COLOUR_HEX, amount: 12n },
      ],
      stablecoinColourHex: MUSD_COLOUR_HEX,
    });
    expect(rows.map((row) => row.symbol)).toEqual([
      'NIGHT',
      'mUSD',
      'sUSD',
      `Token · ${OTHER_COLOUR.slice(0, 4)}…`,
    ]);
    /* A colour nothing can name carries no mark rather than borrowing one. */
    expect(rows[3].mark).toBeUndefined();
    expect(rows[3].amount).toBe(3n);
    expect(rows[3].decimals).toBe(0);
  });

  it('adds up two rows of the same colour and keeps a balance already held', () => {
    const rows = custodyAssetRows({
      night: 0n,
      shielded: [
        { colourHex: MUSD_COLOUR_HEX, amount: 40n },
        { colourHex: `0x${MUSD_COLOUR_HEX}`, amount: 2n },
      ],
      stablecoinColourHex: MUSD_COLOUR_HEX,
    });
    expect(rows[1].amount).toBe(42n);
  });

  it('drops a row that names no colour, and one that claims to be NIGHT', () => {
    /* NIGHT is not held in the coin store — the account mirrors it — so a
       shielded row claiming it would put the same money on the screen twice. */
    const rows = custodyAssetRows({
      night: 1n,
      shielded: [
        { colourHex: 'not-a-colour', amount: 9n },
        { colourHex: NIGHT_COLOUR_HEX, amount: 9n },
      ],
      stablecoinColourHex: MUSD_COLOUR_HEX,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].amount).toBe(1n);
  });
});

describe('custodyAssetRow', () => {
  const rows = custodyAssetRows({
    night: 0n,
    shielded: [],
    stablecoinColourHex: MUSD_COLOUR_HEX,
  });

  it('finds a colour, however it was spelled, and answers null otherwise', () => {
    expect(custodyAssetRow(rows, `0x${MUSD_COLOUR_HEX}`)?.symbol).toBe('mUSD');
    expect(custodyAssetRow(rows, OTHER_COLOUR)).toBeNull();
    expect(custodyAssetRow(rows, 'nonsense')).toBeNull();
  });
});

describe('amounts', () => {
  it('formats a scaled asset and an unscaled one', () => {
    expect(formatCustodyAmount(2_500_000n, 6)).toBe('2.5');
    expect(formatCustodyAmount(2_000_000n, 6)).toBe('2');
    expect(formatCustodyAmount(1n, 6)).toBe('0.000001');
    expect(formatCustodyAmount(42n, 0)).toBe('42');
  });

  it('says which of the three states a balance is in', () => {
    expect(custodyAmountFigure(1_500_000n, 6)).toBe('1.5');
    expect(custodyAmountFigure(null, 6)).toBe('—');
    expect(custodyAmountFigure(null, 6, true)).toBe('Unavailable');
  });

  it('reads a typed amount in the asset own units', () => {
    expect(parseCustodyAmount(' 1.5 ', 6)).toBe(1_500_000n);
    expect(parseCustodyAmount('2', 6)).toBe(2_000_000n);
    expect(parseCustodyAmount('40', 0)).toBe(40n);
  });

  it('refuses what it cannot read, naming the shape it takes', () => {
    expect(() => parseCustodyAmount('1.5', 0)).toThrow('Enter a whole amount, like 5.');
    expect(() => parseCustodyAmount('', 0)).toThrow('Enter a whole amount, like 5.');
    expect(() => parseCustodyAmount('1.0000001', 6)).toThrow('Enter an amount like 1 or 1.5.');
    expect(() => parseCustodyAmount('one', 6)).toThrow('Enter an amount like 1 or 1.5.');
  });
});

describe('custodyArrivingSentence', () => {
  it('says how much is here and not ready, or nothing at all', () => {
    expect(custodyArrivingSentence(0)).toBeNull();
    expect(custodyArrivingSentence(-1)).toBeNull();
    expect(custodyArrivingSentence(Number.NaN)).toBeNull();
    expect(custodyArrivingSentence(1)).toBe(
      'One payment is still arriving. It will be ready to spend in a moment.',
    );
    expect(custodyArrivingSentence(3)).toBe(
      '3 payments are still arriving. They will be ready to spend in a moment.',
    );
  });
});

describe('custodyResumeOffer', () => {
  it('reports a payment nobody saw land, in the sentence that says where it is', () => {
    expect(custodyResumeOffer(sendRecord())).toEqual({
      kind: 'report',
      sentence:
        'Your payment to alice was sent as one payment: either it reached alice or nothing left your Passport. Your balance below says which.',
    });
  });

  it('names them when the record kept no name', () => {
    const offer = custodyResumeOffer(sendRecord({ recipientLabel: '  ' }));
    expect(offer.kind === 'report' && offer.sentence).toContain('reached them');
  });

  it('offers no button, because a send is one transaction', () => {
    /* "Finish this payment" used to be here, for a send whose last leg had not
       run. There is no last leg: an offer to finish would be an offer to send
       the money twice. */
    expect(Object.keys(custodyResumeOffer(sendRecord())).sort()).toEqual(['kind', 'sentence']);
  });

  it('says nothing about a payment that finished, or one that was never made', () => {
    expect(custodyResumeOffer(sendRecord({ stage: 'done' }))).toEqual({ kind: 'none' });
    expect(custodyResumeOffer(null)).toEqual({ kind: 'none' });
  });

  it('says none of the words a person has never chosen to meet', () => {
    const forbidden = /wallet address|DUST|contract|registry|indexer|resolver|sponsor|SDK|Dynamic/i;
    const sentences = [
      custodyArrivingSentence(1),
      custodyArrivingSentence(4),
      custodyResumeOffer(sendRecord()),
      custodyResumeOffer(sendRecord({ recipientLabel: ' ' })),
      custodyResumeOffer(sendRecord({ stage: 'done' })),
    ]
      .flatMap((value) =>
        typeof value === 'string' ? [value] : value === null ? [] : ['sentence' in value ? value.sentence : ''],
      )
      .filter((sentence) => sentence.length > 0);
    expect(sentences.length).toBeGreaterThan(3);
    for (const sentence of sentences) {
      expect(sentence, sentence).not.toMatch(forbidden);
    }
  });
});
