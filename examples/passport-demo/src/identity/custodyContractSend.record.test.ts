/**
 * THE SENTENCES A REFUSED OR HALF-FINISHED PAYMENT PRODUCES, and the record
 * that has to survive a reload for any of them to be said at all.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * Two failures, both of which reach a person rather than a log:
 *
 *   1. A REFUSAL THAT SAYS THE WRONG TRUE THING. An account can hold three
 *      payments of a colour and send only the first, so "you do not hold
 *      enough" and "that much arrived as separate payments" are different
 *      sentences about the same money, and swapping them tells somebody they
 *      are poorer than they are. Each refusal is asserted as its exact
 *      sentence below, not by a fragment, and every one of them is run through
 *      the vocabulary guard this demo keeps.
 *   2. A RECORD THAT WILL NOT PARSE. The record is the only thing that says a
 *      payment left the Passport and did not arrive. A stage the reader
 *      refuses is a payment that silently stops existing on reload — which is
 *      how `'unconfirmed'`, the stage written exactly when value is out and
 *      nothing here can see which side holds it, was lost until 2026/09/17. So
 *      every stage is round-tripped through storage here rather than only
 *      being asked for its sentence.
 *
 * `./custodyContractSend.test.ts` drills the plan's legs and the happy paths.
 * This file drills the refusals, the persistence, and the circuit result.
 */

import { describe, expect, it } from 'vitest';

import {
  CUSTODY_SHIELDED_SEND_KEY,
  changeCoinFromResult,
  clearCustodyShieldedSend,
  custodyShieldedSendOutcome,
  custodyChangeBackfill,
  custodyShieldedSendRefusal,
  directSpendFromResult,
  loadCustodyShieldedSend,
  newCustodyShieldedSend,
  nextCustodyShieldedSendStep,
  planCustodyShieldedSend,
  saveCustodyShieldedSend,
  type CustodyShieldedSendPlanInput,
  type CustodyShieldedSendRecord,
  type CustodyShieldedSendStage,
} from './custodyContractSend.js';
import { parseCustodyAmount } from '../lib/custodyAssets.js';
import type { CustodyAccountRecord } from './custodyContractPlan.js';

/**
 * The vocabulary guard, as `./custodyContractSend.test.ts` and
 * `../lib/custodyAssets.test.ts` both write it. One expression, so a word
 * added in one place is added everywhere it is checked.
 */
const FORBIDDEN = /wallet address|DUST|contract|registry|indexer|resolver|sponsor|SDK|Dynamic/i;

const NONCE = '7f'.repeat(32);
const COLOUR = '1a'.repeat(32);
const ENC_KEY = 'ab'.repeat(32);
const RECIPIENT_ENC_KEY = 'ee'.repeat(32);

const RECORD: CustodyAccountRecord = {
  user: '0xabc',
  network: 'stagenet',
  address: 'bb'.repeat(32),
  privateStateId: 'passport-account-custody-0xabc',
  saltHex: '11'.repeat(32),
  pkXHex: '22'.repeat(32),
  pkYHex: '33'.repeat(32),
  wavesDone: 3,
  totalWaves: 3,
  activated: true,
  txHashes: [],
};

function shieldedInput(
  patch: Partial<CustodyShieldedSendPlanInput> = {},
): CustodyShieldedSendPlanInput {
  return {
    record: RECORD,
    colourHex: COLOUR,
    amount: 40n,
    recipientAccountAddress: 'dd'.repeat(32),
    recipientModule: 'account-custody',
    heldCoin: { nonce: NONCE, value: 100n, mtIndex: 7n },
    queuedValues: [],
    recipientEncKeyHex: ENC_KEY,
    ...patch,
  };
}

/* -------------------------------------------------------------------------- */
/* Every refusal, as the exact sentence                                       */
/* -------------------------------------------------------------------------- */

const refusals: { name: string; input: Partial<CustodyShieldedSendPlanInput>; sentence: string }[] =
  [
    {
      name: 'the Passport has no record at all',
      input: { record: null },
      sentence: 'Your Passport is still being set up. Try again once it is ready.',
    },
    {
      name: 'the account has no address yet',
      input: { record: { ...RECORD, address: null } },
      sentence: 'Your Passport is still being set up. Try again once it is ready.',
    },
    {
      name: 'the key has not been activated',
      input: { record: { ...RECORD, activated: false } },
      sentence: 'Your Passport is still being set up. Try again once it is ready.',
    },
    {
      name: 'the amount is zero',
      input: { amount: 0n },
      sentence: 'Enter an amount greater than zero.',
    },
    {
      name: 'the amount is negative',
      input: { amount: -5n },
      sentence: 'Enter an amount greater than zero.',
    },
    {
      name: 'the recipient holds an older kind of Passport',
      input: { recipientModule: 'account' },
      sentence:
        'That Passport is an older kind, and this version cannot pay it this way. Ask them to set their Passport up again.',
    },
    {
      name: 'the recipient holds the first prototype build',
      input: { recipientModule: 'account-v1' },
      sentence:
        'That Passport is an older kind, and this version cannot pay it this way. Ask them to set their Passport up again.',
    },
    {
      name: 'the name belongs to something that is not a Passport',
      input: { recipientModule: 'midnames' },
      sentence: 'That name does not belong to a Passport that can be paid.',
    },
    {
      name: 'the Passport holds none of that colour',
      input: { heldCoin: null },
      sentence: 'Your Passport holds none of that to send.',
    },
    {
      name: 'the amount is more than everything held of that colour',
      input: { amount: 5_000n },
      sentence: 'You do not hold enough to send that.',
    },
    {
      name: 'the amount is held, but across separate payments',
      input: { amount: 150n, queuedValues: [100n] },
      sentence:
        'That much arrived as separate payments, and one payment can only draw on one of them. Send a smaller amount for now.',
    },
    {
      name: 'the recipient publishes no key to seal a description to',
      input: { recipientEncKeyHex: null },
      sentence: 'That Passport cannot be paid this kind of amount yet.',
    },
    {
      name: 'the recipient publishes a key that is not one',
      input: { recipientEncKeyHex: 'short' },
      sentence: 'That Passport cannot be paid this kind of amount yet.',
    },
  ];

describe('why a shielded payment is refused, in the exact words', () => {
  for (const refusal of refusals) {
    it(`says one sentence when ${refusal.name}`, () => {
      const sentence = custodyShieldedSendRefusal(shieldedInput(refusal.input));
      expect(sentence).toBe(refusal.sentence);
      /* The plan must refuse to build rather than building something the
         caller then has to check again. */
      expect(() => planCustodyShieldedSend(shieldedInput(refusal.input))).toThrow(
        refusal.sentence,
      );
    });
  }

  it('says none of the words a person has never chosen to meet, in any of them', () => {
    for (const refusal of refusals) {
      const sentence = custodyShieldedSendRefusal(shieldedInput(refusal.input));
      expect(sentence, refusal.name).not.toBeNull();
      expect(sentence as string, refusal.name).not.toMatch(FORBIDDEN);
      /* And it reads as a sentence rather than as a fragment of one. */
      expect((sentence as string).trim().endsWith('.'), refusal.name).toBe(true);
    }
  });

  it('tells apart the two refusals about the same money', () => {
    /* MORE THAN IS HELD AT ALL, versus more than one payment can draw on.
       Swapping these tells somebody they are poorer than they are. */
    const short = custodyShieldedSendRefusal(shieldedInput({ amount: 400n, queuedValues: [50n] }));
    const split = custodyShieldedSendRefusal(shieldedInput({ amount: 120n, queuedValues: [50n] }));
    expect(short).toMatch(/do not hold enough/);
    expect(split).toMatch(/separate payments/);
    expect(split).not.toMatch(/do not hold enough/);
    /* Exactly the held coin still goes, because one payment can draw on it. */
    expect(custodyShieldedSendRefusal(shieldedInput({ amount: 100n, queuedValues: [50n] }))).toBeNull();
  });

  it('refuses an amount that is not a whole number before it ever reaches the plan', () => {
    /* The plan takes a bigint, so a typed "1.5" of a colour with no decimal
       places is refused where it is READ, and that sentence is a person's too. */
    expect(() => parseCustodyAmount('1.5', 0)).toThrow('Enter a whole amount, like 5.');
    expect(() => parseCustodyAmount('-1', 0)).toThrow('Enter a whole amount, like 5.');
    expect(() => parseCustodyAmount('', 0)).toThrow('Enter a whole amount, like 5.');
    expect(parseCustodyAmount('40', 0)).toBe(40n);
  });

  it('lets a payment this Passport can make through, on both routes', () => {
    expect(custodyShieldedSendRefusal(shieldedInput())).toBeNull();
    expect(
      custodyShieldedSendRefusal(
        shieldedInput({ recipientModule: 'account-custody', recipientEncKeyHex: RECIPIENT_ENC_KEY }),
      ),
    ).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The record, at every stage                                                 */
/* -------------------------------------------------------------------------- */

function storageFake(behaviour: { deny?: boolean } = {}) {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      getItem: (key: string) => {
        if (behaviour.deny) throw new Error('storage denied');
        return map.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (behaviour.deny) throw new Error('storage denied');
        map.set(key, value);
      },
      removeItem: (key: string) => void map.delete(key),
    },
  };
}

const ACCOUNT = { network: 'stagenet', accountAddress: 'aa'.repeat(32) };

function send(patch: Partial<CustodyShieldedSendRecord> = {}): CustodyShieldedSendRecord {
  return {
    ...newCustodyShieldedSend({
      network: ACCOUNT.network,
      accountAddress: ACCOUNT.accountAddress,
      colourHex: COLOUR,
      amount: 40n,
      recipientLabel: 'alice.night',
      recipientAccountAddress: 'dd'.repeat(32),
      now: 1_700_000_000_000,
    }),
    ...patch,
  };
}

/** Every stage, what a resumed run does with it, and what it says. */
const stages: { stage: CustodyShieldedSendStage; step: 'report' | 'nothing'; says: RegExp }[] = [
  { stage: 'sending', step: 'report', says: /either it reached alice\.night or nothing left/ },
  { stage: 'done', step: 'nothing', says: /alice\.night has it/ },
];

describe('a payment at every stage it can be in', () => {
  for (const row of stages) {
    it(`knows what to do with it, and where the money is, at ${row.stage}`, () => {
      const record = send({ stage: row.stage });
      expect(nextCustodyShieldedSendStep(record)).toBe(row.step);
      const sentence = custodyShieldedSendOutcome(record);
      expect(sentence).toMatch(row.says);
      expect(sentence).not.toMatch(FORBIDDEN);
      /* Nothing claims the value came back, because nothing can put it back:
         a send is one transaction and there is no wallet in the middle of it
         to hold anything. */
      expect(sentence).not.toMatch(/back in your Passport/);
    });

    it(`survives being written down and read back at ${row.stage}`, () => {
      /* THE DEFECT THIS CATCHES was a stage missing from the reader's list:
         the record was written, the tab was reloaded, and the screen read "no
         payment in flight" over value that had demonstrably left the
         Passport. */
      const { storage } = storageFake();
      const record = send({ stage: row.stage });
      saveCustodyShieldedSend(storage, record);
      const reloaded = loadCustodyShieldedSend(storage, ACCOUNT);
      expect(reloaded, `stage ${row.stage} did not survive a reload`).toEqual(record);
      expect(nextCustodyShieldedSendStep(reloaded as CustodyShieldedSendRecord)).toBe(row.step);
    });
  }

  it('keeps the latest write when the same stage is written twice', () => {
    const { storage } = storageFake();
    saveCustodyShieldedSend(storage, send({ sendTxId: null }));
    saveCustodyShieldedSend(storage, send({ sendTxId: 'tx-send' }));
    expect(loadCustodyShieldedSend(storage, ACCOUNT)?.sendTxId).toBe('tx-send');
  });

  it('takes the stages out of order without inventing a state between them', () => {
    /* A record is a fact about the last thing that happened, not a ratchet. */
    const { storage } = storageFake();
    saveCustodyShieldedSend(storage, send({ stage: 'done' }));
    saveCustodyShieldedSend(storage, send({ stage: 'sending' }));
    expect(loadCustodyShieldedSend(storage, ACCOUNT)?.stage).toBe('sending');
  });

  it('forgets a payment the person has been told about, and only that one', () => {
    const { storage } = storageFake();
    saveCustodyShieldedSend(storage, send({ stage: 'sending' }));
    saveCustodyShieldedSend(
      storage,
      send({ network: 'preview', stage: 'done', recipientLabel: 'bob.night' }),
    );
    clearCustodyShieldedSend(storage, ACCOUNT);
    expect(loadCustodyShieldedSend(storage, ACCOUNT)).toBeNull();
    expect(loadCustodyShieldedSend(storage, { ...ACCOUNT, network: 'preview' })?.stage).toBe('done');
  });
});

describe('a record nothing can read is no payment in flight, and never a throw', () => {
  const key = `${ACCOUNT.network}::${ACCOUNT.accountAddress}`;

  const corruptions: { name: string; raw: string }[] = [
    { name: 'something that is not JSON', raw: '{not json' },
    { name: 'JSON that is not an object', raw: '"a string"' },
    { name: 'JSON null', raw: 'null' },
    { name: 'an array where the map should be', raw: '[]' },
    { name: 'a row that is not an object', raw: JSON.stringify({ [key]: 7 }) },
    { name: 'a stage this build has never heard of', raw: JSON.stringify({ [key]: { ...send(), stage: 'inventing' } }) },
    { name: 'no stage at all', raw: JSON.stringify({ [key]: { ...send(), stage: undefined } }) },
    { name: 'an amount that is a number', raw: JSON.stringify({ [key]: { ...send(), amount: 40 } }) },
    { name: 'an amount that is not a figure', raw: JSON.stringify({ [key]: { ...send(), amount: 'forty' } }) },
    { name: 'an amount with a leading zero', raw: JSON.stringify({ [key]: { ...send(), amount: '040' } }) },
    { name: 'a negative amount', raw: JSON.stringify({ [key]: { ...send(), amount: '-40' } }) },
    { name: 'no network', raw: JSON.stringify({ [key]: { ...send(), network: '' } }) },
    { name: 'an account address that is a number', raw: JSON.stringify({ [key]: { ...send(), accountAddress: 12 } }) },
    { name: 'a colour that is a number', raw: JSON.stringify({ [key]: { ...send(), colourHex: 12 } }) },
  ];

  for (const corruption of corruptions) {
    it(`reads ${corruption.name} as nothing in flight`, () => {
      const { storage, map } = storageFake();
      map.set(CUSTODY_SHIELDED_SEND_KEY, corruption.raw);
      expect(() => loadCustodyShieldedSend(storage, ACCOUNT)).not.toThrow();
      expect(loadCustodyShieldedSend(storage, ACCOUNT)).toBeNull();
      /* And a write on top of it still leaves a readable record rather than
         carrying the damage forward. */
      saveCustodyShieldedSend(storage, send({ stage: 'sending' }));
      expect(loadCustodyShieldedSend(storage, ACCOUNT)?.stage).toBe('sending');
    });
  }

  it('does not throw at a caller when the browser refuses storage outright', () => {
    const denied = storageFake({ deny: true });
    expect(() => saveCustodyShieldedSend(denied.storage, send())).not.toThrow();
    expect(() => clearCustodyShieldedSend(denied.storage, ACCOUNT)).not.toThrow();
    expect(loadCustodyShieldedSend(denied.storage, ACCOUNT)).toBeNull();
  });

  it('keeps another account’s record out of a damaged row', () => {
    const { storage, map } = storageFake();
    map.set(
      CUSTODY_SHIELDED_SEND_KEY,
      JSON.stringify({ [key]: 'damaged', 'preview::aaaa': { ...send({ network: 'preview' }) } }),
    );
    expect(loadCustodyShieldedSend(storage, ACCOUNT)).toBeNull();
    expect(
      loadCustodyShieldedSend(storage, { network: 'preview', accountAddress: 'aaaa' })?.stage,
    ).toBe('sending');
  });
});

/* -------------------------------------------------------------------------- */
/* What the circuit said about the change                                     */
/* -------------------------------------------------------------------------- */

describe('backing the change up into this account’s own inbox', () => {
  const CHANGE = {
    outcome: 'change' as const,
    nonce: '7f'.repeat(32),
    colour: '1a'.repeat(32),
    value: 60n,
  };

  it('seals the change to this account’s own key when there is change to seal', () => {
    expect(custodyChangeBackfill(CHANGE, ENC_KEY)).toEqual({
      kind: 'append',
      ownEncKeyHex: ENC_KEY,
      coin: { colour: '1a'.repeat(32), nonce: '7f'.repeat(32), value: 60n },
    });
    /* However the key was published. */
    expect(
      custodyChangeBackfill(CHANGE, `0x${ENC_KEY.toUpperCase()}`),
    ).toMatchObject({ ownEncKeyHex: ENC_KEY });
  });

  it('skips rather than fails when there is nothing to describe', () => {
    /* A spend that consumed the coin exactly leaves no change, and there is
       nothing wrong with that. */
    expect(custodyChangeBackfill({ outcome: 'none' }, ENC_KEY)).toEqual({
      kind: 'skip',
      reason: 'the payment consumed the whole coin, so there is no change',
    });
    expect(
      custodyChangeBackfill({ outcome: 'unreadable', reason: 'whatever' }, ENC_KEY),
    ).toMatchObject({ kind: 'skip' });
  });

  it('skips an account whose published key is missing or is not one', () => {
    /* Sealing to a key that is not one produces an entry nobody can open,
       which is worse than no entry at all. */
    for (const key of [null, undefined, '', 'nonsense', ENC_KEY.slice(0, 60)]) {
      expect(custodyChangeBackfill(CHANGE, key)).toMatchObject({ kind: 'skip' });
    }
  });
});

describe('reading [sent, change] out of a direct transfer', () => {
  const COIN = (fill: number, value: bigint) => ({
    nonce: new Uint8Array(32).fill(fill),
    color: new Uint8Array(32).fill(0x1a),
    value,
  });

  it('reads the coin the recipient will claim, and the change beside it', () => {
    const read = directSpendFromResult([COIN(0x7f, 40n), { is_some: true, value: COIN(0x80, 60n) }]);
    expect(read.sent).toEqual({ nonce: '7f'.repeat(32), colour: '1a'.repeat(32), value: 40n });
    expect(read.change).toEqual({
      outcome: 'change',
      nonce: '80'.repeat(32),
      colour: '1a'.repeat(32),
      value: 60n,
    });
  });

  it('reads a spend that consumed the coin exactly as no change at all', () => {
    expect(directSpendFromResult([COIN(0x7f, 100n), { is_some: false }]).change).toEqual({
      outcome: 'none',
    });
  });

  it('refuses to describe a coin it cannot read, rather than inventing one', () => {
    /* THE EXPENSIVE FAILURE. `sent` is the only description of the coin the
       recipient is handed, and it is sealed into their inbox — so a shape this
       build cannot read has to stop the payment, which it can, because nothing
       has been submitted when this is read. */
    for (const result of [
      null,
      'not an array',
      [],
      [COIN(0x7f, 40n)],
      [{ nonce: 'not bytes', color: new Uint8Array(32), value: 40n }, { is_some: false }],
      [{ nonce: new Uint8Array(32), color: new Uint8Array(31), value: 40n }, { is_some: false }],
      [{ nonce: new Uint8Array(32), color: new Uint8Array(32), value: 40 }, { is_some: false }],
      [{ nonce: new Uint8Array(32), color: new Uint8Array(32), value: -1n }, { is_some: false }],
    ].entries()) {
      expect(directSpendFromResult(result[1]).sent, `shape ${result[0]}`).toBeNull();
    }
  });

  it('says the change is unreadable when the result is not a pair at all', () => {
    expect(directSpendFromResult(null).change).toEqual({
      outcome: 'unreadable',
      reason: 'The payment went out and this Passport could not read what was left over.',
    });
  });
});

describe('reading the change coin out of a result', () => {
  const bytes = (fill: number): Uint8Array => new Uint8Array(32).fill(fill);

  it('reads a change coin of zero as a described coin, not as nothing', () => {
    /* A `Maybe` that says `is_some` is the circuit's own answer, and this
       layer does not second-guess the value inside it: a coin of zero that is
       described is still a description, and dropping it here would be this
       build deciding a spend left nothing when the circuit said otherwise. */
    expect(changeCoinFromResult({ is_some: true, value: { nonce: bytes(1), color: bytes(2), value: 0n } })).toEqual({
      outcome: 'change',
      nonce: '01'.repeat(32),
      colour: '02'.repeat(32),
      value: 0n,
    });
  });

  const unreadable: { name: string; result: unknown }[] = [
    { name: 'undefined', result: undefined },
    { name: 'null', result: null },
    { name: 'a number', result: 7 },
    { name: 'an array', result: [] },
    { name: 'an array carrying a coin', result: [{ is_some: true, value: { nonce: bytes(1), color: bytes(2), value: 1n } }] },
    { name: 'is_some as a string', result: { is_some: 'true', value: { nonce: bytes(1), color: bytes(2), value: 1n } } },
    { name: 'is_some as zero', result: { is_some: 0, value: { nonce: bytes(1), color: bytes(2), value: 1n } } },
    { name: 'no value at all', result: { is_some: true } },
    { name: 'a value that is null', result: { is_some: true, value: null } },
    { name: 'a nonce of the wrong length', result: { is_some: true, value: { nonce: new Uint8Array(31), color: bytes(2), value: 1n } } },
    { name: 'a colour that is an array of numbers', result: { is_some: true, value: { nonce: bytes(1), color: [1, 2], value: 1n } } },
    { name: 'a value that is a number', result: { is_some: true, value: { nonce: bytes(1), color: bytes(2), value: 1 } } },
    { name: 'a negative value', result: { is_some: true, value: { nonce: bytes(1), color: bytes(2), value: -1n } } },
  ];

  for (const row of unreadable) {
    it(`says it could not read the change when the result is ${row.name}`, () => {
      const read = changeCoinFromResult(row.result);
      expect(read.outcome).toBe('unreadable');
      /* THE VALUE HAS MOVED EITHER WAY, so the sentence says that rather than
         suggesting the payment did not happen — and it carries none of the
         vocabulary, because it reaches a screen. */
      const reason = (read as { reason: string }).reason;
      expect(reason).toBe('The payment went out and this Passport could not read what was left over.');
      expect(reason).not.toMatch(FORBIDDEN);
    });
  }

  it('reads a spend that consumed the coin exactly as a real outcome', () => {
    expect(changeCoinFromResult({ is_some: false })).toEqual({ outcome: 'none' });
    /* Even where a zero coin rides along in the unused arm of the Maybe. */
    expect(
      changeCoinFromResult({ is_some: false, value: { nonce: bytes(0), color: bytes(0), value: 0n } }),
    ).toEqual({ outcome: 'none' });
  });
});
