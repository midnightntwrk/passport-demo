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

import { describe, expect, it, vi } from 'vitest';

import {
  custodyArrivingCount,
  custodyInFlightRefusal,
  custodyMayReadHoldings,
  custodyPaymentDisclosure,
  custodyUnplacedDeliveries,
  runCustodyKeepRecord,
  runCustodyWork,
  CUSTODY_KEEP_RECORD_BUSY,
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

  /* THE PAYMENT INTO A PASSPORT THAT ALREADY HOLDS SOMETHING (live,
     2026/09/21). It is queued behind the coin the colour holds, with its
     candidate positions, so it is in the balance and it is NOT arriving — the
     screen said "one payment is still arriving" over a figure that never moved
     for as long as anybody watched. Held and queued read the same way here,
     because both are money the store has. */
  it('counts a delivery queued behind a held coin as balance, not as arriving', () => {
    expect(
      custodyUnplacedDeliveries([
        outcome({ outcome: 'ambiguous', stored: true, placed: 'queued' }),
        outcome({ outcome: 'ambiguous', stored: true, placed: 'held' }),
      ]),
    ).toBe(0);
    /* And a delivery nothing could place is still arriving, whatever it says
       about where it went. */
    expect(
      custodyUnplacedDeliveries([outcome({ outcome: 'ambiguous', stored: false, placed: null })]),
    ).toBe(1);
    expect(
      custodyUnplacedDeliveries([outcome({ outcome: 'unavailable', placed: null })]),
    ).toBe(1);
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

/* -------------------------------------------------------------------------- */
/* The order a payment and its follow-up read happen in                       */
/* -------------------------------------------------------------------------- */

describe('the order a payment and the read of its result happen in', () => {
  /* THE DEFECT THIS IS THE DRILL FOR (live, 2026/09/18): "Sent." appeared over
     the figure the Passport held BEFORE the payment, because the follow-up read
     ran inside the payment — where `custodyMayReadHoldings` refuses it — and
     only Refresh or a reload moved the figure afterwards. */
  it('reads what the Passport holds only once the payment has let the store go', async () => {
    const flag = { current: false };
    const seen: string[] = [];
    const outcome = await runCustodyWork(
      flag,
      () => {
        seen.push(`work:${flag.current}`);
        return Promise.resolve();
      },
      () => {
        /* What `readHoldings` asks, in the one form that matters here. */
        seen.push(`read:${custodyMayReadHoldings(flag.current)}`);
        return Promise.resolve();
      },
    );

    expect(seen).toEqual(['work:true', 'read:true']);
    expect(outcome.failure).toBeNull();
    expect(flag.current).toBe(false);
  });

  it('reads again even when the payment failed, because that is when the figures lie', async () => {
    const flag = { current: false };
    const cause = new Error('the last leg threw after the value had moved');
    let read = 0;

    const outcome = await runCustodyWork(
      flag,
      () => Promise.reject(cause),
      () => {
        read += 1;
        expect(flag.current).toBe(false);
        return Promise.resolve();
      },
    );

    expect(read).toBe(1);
    expect(outcome.failure).toBe(cause);
  });

  it('tells somebody about the payment’s own failure, not the read’s', async () => {
    const flag = { current: false };
    const cause = new Error('the payment failed');

    const outcome = await runCustodyWork(
      flag,
      () => Promise.reject(cause),
      () => Promise.reject(new Error('and the read after it failed too')),
    );

    expect(outcome.failure).toBe(cause);
    expect(flag.current).toBe(false);
  });

  it('reports a failed read when the payment itself finished', async () => {
    const flag = { current: false };
    const cause = new Error('the read failed');

    const outcome = await runCustodyWork(flag, () => Promise.resolve(), () =>
      Promise.reject(cause),
    );

    expect(outcome.failure).toBe(cause);
  });

  it('runs work with nothing to read afterwards, and clears the flag either way', async () => {
    const flag = { current: false };
    expect((await runCustodyWork(flag, () => Promise.resolve())).failure).toBeNull();
    expect(flag.current).toBe(false);
    const cause = new Error('nothing to read after this either');
    expect((await runCustodyWork(flag, () => Promise.reject(cause), null)).failure).toBe(cause);
    expect(flag.current).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* The record of what the account kept, written inside the payment            */
/* -------------------------------------------------------------------------- */

describe('writing down what the account kept', () => {
  /* IT IS A GATED CALL. Started detached — which is what it was — it overlapped
     whatever came next: the follow-up read, or a second Send. Two gated calls
     against one account sign against the same `auth_nonce`, and the second is
     refused by the node for a reason no sentence on the screen could explain.
     So it is awaited by the payment, under the payment's own flag. */
  it('runs to completion before the caller moves on', async () => {
    const order: string[] = [];
    await runCustodyKeepRecord(
      (line) => order.push(`busy:${line}`),
      async () => {
        order.push('writing');
        await Promise.resolve();
        order.push('written');
      },
    );
    order.push('after');

    expect(order).toEqual([
      `busy:${CUSTODY_KEEP_RECORD_BUSY}`,
      'writing',
      'written',
      'after',
    ]);
  });

  /* THE PAYMENT ALREADY SUCCEEDED. The recipient has their money; this is the
     sender's own note of the remainder, and a failure to write it loses the
     record and not the money. Reporting it would tell somebody their payment
     failed when it did not. */
  it('swallows its own failure, because the payment already succeeded', async () => {
    await expect(
      runCustodyKeepRecord(
        () => undefined,
        () => Promise.reject(new Error('the approval was dismissed')),
      ),
    ).resolves.toBeUndefined();
  });

  /* The line says what is happening rather than leaving "Sending" up over
     something that has finished, and it names no machinery. */
  it('says what is happening in words about the person, not the machinery', () => {
    expect(CUSTODY_KEEP_RECORD_BUSY).toBe('Writing down what you kept');
    for (const word of [
      'wallet address',
      'dust',
      'contract',
      'registry',
      'indexer',
      'resolver',
      'sponsor',
      'sdk',
      'inbox',
      'coin',
    ]) {
      expect(CUSTODY_KEEP_RECORD_BUSY.toLowerCase()).not.toContain(word);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* What a payment publishes about the two parties                             */
/* -------------------------------------------------------------------------- */

describe('the sentence that says what a payment will publish', () => {
  it('says both Passports are named when a shielded amount goes to a name', () => {
    expect(custodyPaymentDisclosure({ typed: 'alice', shielded: true })).toBe(
      'Both Passports are named on chain for this payment.',
    );
    /* Whitespace around a name is a name. */
    expect(custodyPaymentDisclosure({ typed: '  alice  ', shielded: true })).toBe(
      'Both Passports are named on chain for this payment.',
    );
  });

  it('says neither is named when the same amount goes to a shielded address', () => {
    expect(
      custodyPaymentDisclosure({ typed: 'mn_shield-addr_stagenet1abc', shielded: true }),
    ).toBe('This payment names neither Passport on chain.');
    /* The prefix is matched however it was typed or pasted. */
    expect(
      custodyPaymentDisclosure({ typed: 'MN_SHIELD-ADDR_stagenet1abc', shielded: true }),
    ).toBe('This payment names neither Passport on chain.');
  });

  it('says nothing before there is a recipient to say it about', () => {
    expect(custodyPaymentDisclosure({ typed: '', shielded: true })).toBeNull();
    expect(custodyPaymentDisclosure({ typed: '   ', shielded: true })).toBeNull();
  });

  it('says nothing about the account’s NIGHT, which moves a different way', () => {
    expect(custodyPaymentDisclosure({ typed: 'alice', shielded: false })).toBeNull();
  });
});

describe('runCustodyPayment — the answer is not held up by what follows it', () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('answers when the payment is done, keeps the flag up across the tidy-up, and reads after it', async () => {
    const { runCustodyPayment } = await import('./custodyScreenRules.js');
    const inFlight = { current: false };
    const order: string[] = [];
    let finishTidy!: () => void;
    const tidy = new Promise<void>((resolve) => {
      finishTidy = resolve;
    });
    const outcome = await runCustodyPayment(
      inFlight,
      () => {
        order.push(`work:${String(inFlight.current)}`);
        return Promise.resolve(async () => {
          order.push('tidy');
          await tidy;
        });
      },
      () => {
        order.push(`read:${String(inFlight.current)}`);
        return Promise.resolve();
      },
    );
    expect(outcome.failure).toBeNull();
    /* Answered with the tidy-up still running, and the flag still up. */
    expect(inFlight.current).toBe(true);
    finishTidy();
    await tick();
    expect(inFlight.current).toBe(false);
    expect(order).toEqual(['work:true', 'tidy', 'read:false']);
  });

  it('brings the flag down at once when there is no tidy-up, and reports the failure', async () => {
    const { runCustodyPayment } = await import('./custodyScreenRules.js');
    const inFlight = { current: false };
    const failure = new Error('refused');
    const outcome = await runCustodyPayment(inFlight, () => Promise.reject(failure), () => Promise.resolve());
    expect(outcome.failure).toBe(failure);
    expect(inFlight.current).toBe(false);
  });

  it('survives a tidy-up and a read that fail, and never waits on them', async () => {
    const { runCustodyPayment } = await import('./custodyScreenRules.js');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const inFlight = { current: false };
    const outcome = await runCustodyPayment(
      inFlight,
      () => Promise.resolve(() => Promise.reject(new Error('tidy failed'))),
      () => Promise.reject(new Error('read failed')),
    );
    expect(outcome.failure).toBeNull();
    await tick();
    expect(inFlight.current).toBe(false);
    expect(warn).toHaveBeenCalled();
    expect(info).toHaveBeenCalled();
    /* A read that never answers does not hold the payment's answer either. */
    const never = await runCustodyPayment({ current: false }, () => Promise.resolve(), () => new Promise(() => undefined));
    expect(never.failure).toBeNull();
    warn.mockRestore();
    info.mockRestore();
  });
});
