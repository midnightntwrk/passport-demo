/**
 * WHAT THIS PROTECTS: the three decisions the Dynamic Passport screen makes
 * about somebody's money, each of which is invisible while it is being made.
 *
 * Every branch of every function in `./custodyScreenRules.ts` is walked here,
 * and each drill is named after what it costs to get wrong rather than after
 * the code path it takes:
 *
 *   - a note that is still held goes BACK, and a note that is gone is never
 *     sent anywhere (a second spend the node refuses, under a line telling
 *     somebody their money is coming home);
 *   - a wallet that could not be asked takes the recoverable branch, because
 *     the two mistakes are not the same size;
 *   - a failed return leg reports where the value is and stops;
 *   - a second payment while one runs is refused with one sentence, and the
 *     background read of what the Passport holds is skipped for as long as the
 *     payment runs and runs again afterwards;
 *   - a delivery the chain could not place counts as arriving rather than as
 *     balance or as nothing, and a walk that could not be made at all falls
 *     back to the store's own rows rather than claiming it found none.
 *
 * Nothing here mocks the function under test. The seams are the values the
 * screen hands in, which is all these functions take.
 */

import { describe, expect, it } from 'vitest';

import {
  custodyArrivingCount,
  custodyDeliveryFailure,
  custodyInFlightRefusal,
  custodyMayReadHoldings,
  custodyUnplacedDeliveries,
  type CustodyWalkOutcome,
} from './custodyScreenRules.js';

/** The words no sentence on this path may contain. See the module header. */
const FORBIDDEN = [
  'wallet address',
  'DUST',
  'contract',
  'registry',
  'indexer',
  'resolver',
  'sponsor',
  'SDK',
  'Dynamic',
];

/* -------------------------------------------------------------------------- */
/* Putting a note back, or not                                                */
/* -------------------------------------------------------------------------- */

describe('a last leg that did not land', () => {
  it('puts the note back when the wallet still holds it', () => {
    expect(custodyDeliveryFailure({ stillHeld: true })).toEqual({
      stage: 'returning',
      deposit: true,
    });
  });

  /* THE DEFECT THIS CATCHES would have paid nobody twice and told somebody
     their money was on its way home. A leg can throw after its transaction was
     broadcast — a dropped socket, a confirmation wait running out — and the
     recipient has the note. Re-sending it is a double spend the node refuses,
     and the screen would have said "putting it back in your Passport" first. */
  it('sends nothing anywhere when the note has gone from the wallet', () => {
    const decided = custodyDeliveryFailure({ stillHeld: false });
    expect(decided).toEqual({ stage: 'unconfirmed', deposit: false });
  });

  /* A WALLET THAT COULD NOT BE ASKED IS NOT AN ANSWER, and the two mistakes are
     different sizes: a deposit-back of a note that is gone is refused by the
     node and costs a fee, while not returning a note that IS held leaves the
     value where no screen can reach it — Home sweeps NIGHT and cannot see a
     shielded note. */
  it('takes the recoverable branch when the wallet could not be asked', () => {
    expect(custodyDeliveryFailure({ stillHeld: null })).toEqual({
      stage: 'returning',
      deposit: true,
    });
  });

  it('reports where the value is, and stops, when the return leg fails too', () => {
    for (const stillHeld of [true, false, null]) {
      expect(custodyDeliveryFailure({ stillHeld, returnFailed: true })).toEqual({
        stage: 'stranded',
        deposit: false,
      });
    }
  });

  it('treats a return leg that has not been tried as one that has not failed', () => {
    expect(custodyDeliveryFailure({ stillHeld: true, returnFailed: false }).stage).toBe(
      'returning',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* One thing at a time                                                        */
/* -------------------------------------------------------------------------- */

describe('a second piece of work while one is running', () => {
  it('is refused in one sentence', () => {
    const refusal = custodyInFlightRefusal(true);
    expect(refusal).not.toBeNull();
    expect(refusal).toMatch(/still finishing/);
    /* One sentence, not a paragraph, and not a stack. */
    expect(refusal!.split('. ').length).toBeLessThanOrEqual(2);
  });

  it('is allowed when nothing is running', () => {
    expect(custodyInFlightRefusal(false)).toBeNull();
  });

  it('says nothing a person did not choose', () => {
    const refusal = custodyInFlightRefusal(true)!;
    for (const word of FORBIDDEN) {
      expect(refusal.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });

  /* THE WALK INSIDE THE READ WRITES COINS, which is why the read is skipped
     rather than queued: a walk landing mid-payment files a delivery over the
     coin the payment has just spent. */
  it('skips the read of what the Passport holds, and runs it afterwards', () => {
    expect(custodyMayReadHoldings(true)).toBe(false);
    /* The ref goes back to false in the payment's `finally`, and the next read
       is the one that shows the new figures. */
    expect(custodyMayReadHoldings(false)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* What the walk found                                                        */
/* -------------------------------------------------------------------------- */

function outcome(reconciliation: CustodyWalkOutcome['reconciliation']): CustodyWalkOutcome {
  return { reconciliation };
}

describe('the deliveries a walk could not place', () => {
  /* THE DEFECT THIS CATCHES made money that had demonstrably arrived vanish off
     the screen: the count came from the store's own rows alone, and a delivery
     the chain had not placed was in neither the balance nor the count. */
  it('counts an unanswered position as arriving', () => {
    expect(
      custodyUnplacedDeliveries([outcome({ outcome: 'unavailable', stored: false })]),
    ).toBe(1);
  });

  it('counts an ambiguous position the store could not take as arriving', () => {
    expect(custodyUnplacedDeliveries([outcome({ outcome: 'ambiguous', stored: false })])).toBe(1);
    /* Absent is the same as false: a walk that reported rather than stored. */
    expect(custodyUnplacedDeliveries([outcome({ outcome: 'ambiguous' })])).toBe(1);
  });

  it('counts an ambiguous position the store DID take as balance, not as arriving', () => {
    expect(custodyUnplacedDeliveries([outcome({ outcome: 'ambiguous', stored: true })])).toBe(0);
  });

  it('counts nothing for the outcomes that are in the store or are no news', () => {
    expect(
      custodyUnplacedDeliveries([
        outcome({ outcome: 'learned' }),
        outcome({ outcome: 'spent' }),
        outcome({ outcome: 'known' }),
        outcome({ outcome: 'refused' }),
      ]),
    ).toBe(0);
  });

  it('counts each of a mixed walk once', () => {
    expect(
      custodyUnplacedDeliveries([
        outcome({ outcome: 'learned' }),
        outcome({ outcome: 'unavailable' }),
        outcome({ outcome: 'ambiguous', stored: false }),
        outcome({ outcome: 'ambiguous', stored: true }),
      ]),
    ).toBe(2);
  });

  it('counts nothing for a walk that found nothing', () => {
    expect(custodyUnplacedDeliveries([])).toBe(0);
  });
});

describe('the figure for payments still arriving', () => {
  it('adds the store rows and the walk could not place', () => {
    expect(custodyArrivingCount({ awaitingRows: 2, unplaced: 1 })).toBe(3);
  });

  /* A WALK THAT COULD NOT BE MADE IS NOT A WALK THAT FOUND NOTHING. The
     control comes back either way and the figures already on screen stay on
     it; what must not happen is the screen claiming the walk answered. */
  it('falls back to the store rows when the walk could not be made', () => {
    expect(custodyArrivingCount({ awaitingRows: 2, unplaced: null })).toBe(2);
    expect(custodyArrivingCount({ awaitingRows: 0, unplaced: null })).toBe(0);
  });

  it('never shows a negative or a nonsense count', () => {
    expect(custodyArrivingCount({ awaitingRows: -3, unplaced: 1 })).toBe(1);
    expect(custodyArrivingCount({ awaitingRows: 1, unplaced: -3 })).toBe(1);
    expect(custodyArrivingCount({ awaitingRows: Number.NaN, unplaced: 2 })).toBe(2);
    expect(custodyArrivingCount({ awaitingRows: 2, unplaced: Number.NaN })).toBe(2);
    expect(
      custodyArrivingCount({ awaitingRows: Number.POSITIVE_INFINITY, unplaced: null }),
    ).toBe(0);
  });
});
