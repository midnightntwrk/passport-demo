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
  custodyReturnedSentence,
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
    stage: 'depositing',
    colourHex: MUSD_COLOUR_HEX,
    amount: '40',
    recipientLabel: 'alice',
    recipientAccountAddress: 'dd'.repeat(32),
    noteNonce: 'ee'.repeat(32),
    withdrawTxId: 'ff',
    depositTxId: null,
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
  it('offers to finish a payment whose last leg needs no approval', () => {
    const offer = custodyResumeOffer(sendRecord());
    expect(offer).toEqual({
      kind: 'finish',
      sentence:
        'Your payment of 40 mUSD to alice did not finish. It has left your Passport and can still be delivered.',
      action: 'Finish this payment',
    });
  });

  it('offers the same when the note still has to be identified', () => {
    expect(custodyResumeOffer(sendRecord({ stage: 'awaiting-note' })).kind).toBe('finish');
    expect(
      custodyResumeOffer(sendRecord({ stage: 'depositing', noteNonce: null })).kind,
    ).toBe('finish');
  });

  it('names somebody when the record kept no name', () => {
    const offer = custodyResumeOffer(sendRecord({ recipientLabel: '  ' }));
    expect(offer.kind === 'finish' && offer.sentence).toContain('to somebody');
  });

  it('quotes the figure in the asset own scale', () => {
    const offer = custodyResumeOffer(sendRecord({ amount: '2500000', colourHex: NIGHT_COLOUR_HEX }));
    expect(offer.kind === 'finish' && offer.sentence).toContain('2.5 NIGHT');
  });

  it('reports rather than offers where there is no leg left to run', () => {
    for (const stage of ['returning', 'stranded', 'withdrawing'] as const) {
      const offer = custodyResumeOffer(sendRecord({ stage }));
      expect(offer.kind).toBe('report');
    }
  });

  it('says nothing about a payment that finished, or one that was never made', () => {
    expect(custodyResumeOffer(sendRecord({ stage: 'done' }))).toEqual({ kind: 'none' });
    expect(custodyResumeOffer(null)).toEqual({ kind: 'none' });
  });

  it('says a returned payment is back, not on its way back', () => {
    expect(custodyReturnedSentence('alice')).toBe(
      'It did not reach alice, so it is back in your Passport.',
    );
    expect(custodyReturnedSentence('  ')).toBe(
      'It did not reach them, so it is back in your Passport.',
    );
  });

  it('says none of the words a person has never chosen to meet', () => {
    const forbidden = /wallet address|DUST|contract|registry|indexer|resolver|sponsor|SDK|Dynamic/i;
    const sentences = [
      custodyArrivingSentence(1),
      custodyArrivingSentence(4),
      custodyResumeOffer(sendRecord()),
      custodyResumeOffer(sendRecord({ stage: 'returning' })),
      custodyResumeOffer(sendRecord({ stage: 'stranded' })),
      custodyResumeOffer(sendRecord({ stage: 'withdrawing' })),
      custodyReturnedSentence('alice'),
      custodyReturnedSentence(' '),
    ]
      .flatMap((value) =>
        typeof value === 'string'
          ? [value]
          : value === null
            ? []
            : [
                'sentence' in value ? value.sentence : '',
                'action' in value ? value.action : '',
              ],
      )
      .filter((sentence) => sentence.length > 0);
    expect(sentences.length).toBeGreaterThan(5);
    for (const sentence of sentences) {
      expect(sentence, sentence).not.toMatch(forbidden);
    }
  });
});
