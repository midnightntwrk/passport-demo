/**
 * The Dynamic Passport's send plan, drilled to the branch.
 *
 * THE ONE THAT MATTERS MOST is "an unread balance does not refuse the send".
 * The chain refuses an overdraw by itself; a Passport that refused every
 * payment because an indexer was slow would be a Passport nobody could use on a
 * poor connection, and the refusal would say something untrue about what they
 * hold.
 *
 * The second is that leg one pays the SENDER'S OWN address. It reads wrongly
 * until the second leg is in view, so the test names it rather than asserting
 * on an opaque string.
 */

import { describe, expect, it } from 'vitest';

import {
  changeCoinFromResult,
  clearCustodyShieldedSend,
  custodyShieldedSendOutcome,
  loadCustodyShieldedSend,
  newCustodyShieldedSend,
  nextCustodyShieldedSendStep,
  saveCustodyShieldedSend,
  spendPositionMayBeWrong,
  CUSTODY_APPROVAL_WAITING,
  CUSTODY_SHIELDED_SEND_KEY,
  custodyShieldedSendRefusal,
  planCustodyShieldedSend,
  shieldedDepositRouteFor,
  depositCircuitFor,
  custodyApprovalPrompt,
  custodySendRefusal,
  custodyUnshieldedBalance,
  planCustodySend,
  type CustodySendPlanInput,
  type CustodyShieldedSendPlanInput,
  type CustodyShieldedSendRecord,
  type CustodyUnshieldedLedger,
} from './custodyContractSend.js';
import type { CustodyAccountRecord } from './custodyContractPlan.js';

const RECORD: CustodyAccountRecord = {
  user: '0xabc',
  network: 'stagenet',
  address: 'aa'.repeat(32),
  privateStateId: 'passport-account-custody-abc',
  saltHex: 'bb'.repeat(32),
  pkXHex: '1',
  pkYHex: '2',
  wavesDone: 3,
  totalWaves: 3,
  activated: true,
  txHashes: [],
};

function input(patch: Partial<CustodySendPlanInput> = {}): CustodySendPlanInput {
  return {
    record: RECORD,
    colourHex: '00'.repeat(32),
    amount: 5_000_000n,
    ownReceivingAddress: 'mn_addr_test1sender',
    recipientAccountAddress: 'dd'.repeat(32),
    recipientModule: 'account',
    heldBalance: 10_000_000n,
    ...patch,
  };
}

describe('depositCircuitFor', () => {
  it('names the prototype builds deposit_night', () => {
    expect(depositCircuitFor('account')).toBe('deposit_night');
    expect(depositCircuitFor('account-v1')).toBe('deposit_night');
  });

  it('names the account custody build deposit_unshielded', () => {
    expect(depositCircuitFor('account-custody')).toBe('deposit_unshielded');
  });

  it('refuses the registry, which is not an account at all', () => {
    expect(depositCircuitFor('midnames')).toBeNull();
  });
});

describe('custodySendRefusal', () => {
  it('refuses while the Passport is still being set up', () => {
    const sentence = 'Your Passport is still being set up. Try again once it is ready.';
    expect(custodySendRefusal(input({ record: null }))).toBe(sentence);
    expect(custodySendRefusal(input({ record: { ...RECORD, address: null } }))).toBe(sentence);
    expect(custodySendRefusal(input({ record: { ...RECORD, activated: false } }))).toBe(sentence);
  });

  it('refuses zero and below', () => {
    expect(custodySendRefusal(input({ amount: 0n }))).toBe('Enter an amount greater than zero.');
    expect(custodySendRefusal(input({ amount: -1n }))).toBe('Enter an amount greater than zero.');
  });

  it('refuses before the wallet has an address to be paid at', () => {
    expect(custodySendRefusal(input({ ownReceivingAddress: '   ' }))).toBe(
      'Your Passport is still opening. Try again in a moment.',
    );
  });

  it('refuses a name that does not point at an account', () => {
    expect(custodySendRefusal(input({ recipientModule: 'midnames' }))).toBe(
      'That name does not belong to a Passport that can be paid.',
    );
  });

  it('refuses more than the account holds', () => {
    expect(custodySendRefusal(input({ heldBalance: 1n }))).toBe('You do not hold enough to send that.');
  });

  it('does NOT refuse when the balance could not be read', () => {
    expect(custodySendRefusal(input({ heldBalance: null }))).toBeNull();
  });

  it('allows a send of exactly what is held', () => {
    expect(custodySendRefusal(input({ heldBalance: 5_000_000n }))).toBeNull();
  });
});

describe('planCustodySend', () => {
  it('pays leg one to the SENDER’s own address, and leg two to the recipient', () => {
    const plan = planCustodySend(input());
    expect(plan.withdraw).toEqual({
      operation: 'withdraw_unshielded',
      colourHex: '00'.repeat(32),
      amount: 5_000_000n,
      recipientAddress: 'mn_addr_test1sender',
    });
    expect(plan.deposit).toEqual({
      circuit: 'deposit_night',
      contractAddress: 'dd'.repeat(32),
      colourHex: '00'.repeat(32),
      amount: 5_000_000n,
    });
  });

  it('chooses leg two from the recipient’s build', () => {
    expect(planCustodySend(input({ recipientModule: 'account-custody' })).deposit.circuit).toBe(
      'deposit_unshielded',
    );
  });

  it('throws the refusal rather than planning something that cannot run', () => {
    expect(() => planCustodySend(input({ amount: 0n }))).toThrow('Enter an amount greater than zero.');
  });
});

describe('the words a person reads', () => {
  it('names the provider, not the vendor', () => {
    expect(custodyApprovalPrompt('Google')).toBe('Approve with your Google account');
    expect(custodyApprovalPrompt('X')).toBe('Approve with your X account');
  });

  it('still works when the provider is not known', () => {
    const fallback = 'Approve with the account you signed in with';
    expect(custodyApprovalPrompt(null)).toBe(fallback);
    expect(custodyApprovalPrompt('  ')).toBe(fallback);
    expect(custodyApprovalPrompt(7 as unknown as string)).toBe(fallback);
  });

  it('has one line for the wait', () => {
    expect(CUSTODY_APPROVAL_WAITING).toBe('Waiting for your approval');
  });
});

describe('custodyUnshieldedBalance', () => {
  const colour = new Uint8Array(32);

  function ledger(value: bigint | null): CustodyUnshieldedLedger {
    return {
      unshielded_balances: {
        member: () => value !== null,
        lookup: () => value as bigint,
      },
    };
  }

  it('reads what the mirror holds', () => {
    expect(custodyUnshieldedBalance(ledger(42n), colour)).toBe(42n);
  });

  it('reads a colour the mirror has never seen as a REAL zero', () => {
    expect(custodyUnshieldedBalance(ledger(null), colour)).toBe(0n);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * The shielded plan, drilled to the branch.
 *
 * THE ONE THAT MATTERS MOST is the difference between "you do not hold enough"
 * and "that much arrived as separate payments". They are about the same money
 * and only one of them is true, and getting them the wrong way round tells
 * somebody they are poorer than they are.
 *
 * The second is that a custody recipient with no published encryption key is
 * REFUSED rather than paid: a deposit into one of these accounts without a
 * sealed description is a coin that has arrived and that nobody can ever move.
 */
const ENC_KEY = 'ab'.repeat(32);
const OWN_ENC_KEY = 'cd'.repeat(32);
const NONCE = '7f'.repeat(32);

function shieldedInput(
  patch: Partial<CustodyShieldedSendPlanInput> = {},
): CustodyShieldedSendPlanInput {
  return {
    record: RECORD,
    colourHex: '1a'.repeat(32),
    amount: 40n,
    ownShieldedAddress: 'mn_shield-addr_test1sender',
    recipientAccountAddress: 'dd'.repeat(32),
    recipientModule: 'account',
    heldCoin: { nonce: NONCE, value: 100n, mtIndex: 7n },
    queuedValues: [],
    ownEncKeyHex: OWN_ENC_KEY,
    ...patch,
  };
}

describe('which shielded deposit a recipient takes', () => {
  it('names the prototype builds and the custody build apart, and refuses the registry', () => {
    expect(shieldedDepositRouteFor('account')).toBe('prototype');
    expect(shieldedDepositRouteFor('account-v1')).toBe('prototype');
    expect(shieldedDepositRouteFor('account-custody')).toBe('custody');
    expect(shieldedDepositRouteFor('midnames')).toBeNull();
  });
});

describe('custodyShieldedSendRefusal', () => {
  it('lets a payment this Passport can make through', () => {
    expect(custodyShieldedSendRefusal(shieldedInput())).toBeNull();
    expect(
      custodyShieldedSendRefusal(
        shieldedInput({ recipientModule: 'account-custody', recipientEncKeyHex: ENC_KEY }),
      ),
    ).toBeNull();
  });

  it('refuses before the Passport is finished being set up', () => {
    expect(custodyShieldedSendRefusal(shieldedInput({ record: null }))).toMatch(/still being set up/);
    expect(
      custodyShieldedSendRefusal(shieldedInput({ record: { ...RECORD, address: null } })),
    ).toMatch(/still being set up/);
    expect(
      custodyShieldedSendRefusal(shieldedInput({ record: { ...RECORD, activated: false } })),
    ).toMatch(/still being set up/);
  });

  it('refuses an amount of nothing, and an address it has not got yet', () => {
    expect(custodyShieldedSendRefusal(shieldedInput({ amount: 0n }))).toMatch(/greater than zero/);
    expect(custodyShieldedSendRefusal(shieldedInput({ amount: -1n }))).toMatch(/greater than zero/);
    expect(custodyShieldedSendRefusal(shieldedInput({ ownShieldedAddress: '   ' }))).toMatch(
      /still opening/,
    );
  });

  it('refuses a name that is not a Passport', () => {
    expect(custodyShieldedSendRefusal(shieldedInput({ recipientModule: 'midnames' }))).toMatch(
      /does not belong to a Passport/,
    );
  });

  it('tells an empty colour apart from an amount split across payments', () => {
    expect(custodyShieldedSendRefusal(shieldedInput({ heldCoin: null }))).toMatch(/holds none of that/);
    /* Not enough anywhere: the plain refusal. */
    expect(
      custodyShieldedSendRefusal(
        shieldedInput({ amount: 500n, heldCoin: { nonce: NONCE, value: 100n, mtIndex: 7n }, queuedValues: [100n] }),
      ),
    ).toMatch(/do not hold enough/);
    /* Enough in total, and not in one payment — which is a different sentence,
       because the money IS there. */
    const split = custodyShieldedSendRefusal(
      shieldedInput({ amount: 150n, queuedValues: [100n] }),
    );
    expect(split).toMatch(/separate payments/);
    expect(split).not.toMatch(/do not hold enough/);
  });

  it('refuses a custody recipient that publishes no usable key to seal to', () => {
    const custody = { recipientModule: 'account-custody' as const };
    expect(custodyShieldedSendRefusal(shieldedInput(custody))).toMatch(/cannot be paid/);
    expect(
      custodyShieldedSendRefusal(shieldedInput({ ...custody, recipientEncKeyHex: null })),
    ).toMatch(/cannot be paid/);
    expect(
      custodyShieldedSendRefusal(shieldedInput({ ...custody, recipientEncKeyHex: 'short' })),
    ).toMatch(/cannot be paid/);
    expect(
      custodyShieldedSendRefusal(shieldedInput({ ...custody, recipientEncKeyHex: 12 as never })),
    ).toMatch(/cannot be paid/);
  });

  it('says none of the words a person has never chosen to meet', () => {
    const forbidden = /wallet address|DUST|contract|registry|indexer|resolver|sponsor|SDK|Dynamic/i;
    const sentences = [
      custodyShieldedSendRefusal(shieldedInput({ record: null })),
      custodyShieldedSendRefusal(shieldedInput({ amount: 0n })),
      custodyShieldedSendRefusal(shieldedInput({ ownShieldedAddress: '' })),
      custodyShieldedSendRefusal(shieldedInput({ recipientModule: 'midnames' })),
      custodyShieldedSendRefusal(shieldedInput({ heldCoin: null })),
      custodyShieldedSendRefusal(shieldedInput({ amount: 5_000n })),
      custodyShieldedSendRefusal(shieldedInput({ amount: 150n, queuedValues: [100n] })),
      custodyShieldedSendRefusal(shieldedInput({ recipientModule: 'account-custody' })),
    ];
    for (const sentence of sentences) {
      expect(sentence).not.toBeNull();
      expect(sentence).not.toMatch(forbidden);
    }
  });
});

describe('planCustodyShieldedSend', () => {
  it('spends EXACTLY the amount, out to this Passport\'s own address, binding the coin', () => {
    const plan = planCustodyShieldedSend(shieldedInput());
    expect(plan.withdraw).toEqual({
      operation: 'withdraw_shielded',
      colourHex: '1a'.repeat(32),
      amount: 40n,
      ownShieldedAddress: 'mn_shield-addr_test1sender',
      coin: { nonce: NONCE, value: 100n, mtIndex: 7n },
    });
    /* Leg two looks for a note of exactly the amount, not the whole coin. */
    expect(plan.await).toEqual({ colourHex: '1a'.repeat(32), amount: 40n });
  });

  it('deposits the note alone into a prototype account', () => {
    expect(planCustodyShieldedSend(shieldedInput()).deposit).toEqual({
      route: 'prototype',
      circuit: 'deposit_shielded',
      contractAddress: 'dd'.repeat(32),
      colourHex: '1a'.repeat(32),
      amount: 40n,
    });
  });

  it('deposits the note AND a sealed description into another of these accounts', () => {
    const plan = planCustodyShieldedSend(
      shieldedInput({
        recipientModule: 'account-custody',
        recipientEncKeyHex: `0x${ENC_KEY.toUpperCase()}`,
      }),
    );
    expect(plan.deposit).toEqual({
      route: 'custody',
      circuit: 'deposit_shielded',
      contractAddress: 'dd'.repeat(32),
      colourHex: '1a'.repeat(32),
      amount: 40n,
      recipientEncKeyHex: ENC_KEY,
    });
  });

  it('knows where to put the note back, and says so plainly when it does not', () => {
    expect(planCustodyShieldedSend(shieldedInput()).returnToSender).toEqual({
      circuit: 'deposit_shielded',
      contractAddress: RECORD.address,
      colourHex: '1a'.repeat(32),
      ownEncKeyHex: OWN_ENC_KEY,
    });
    expect(planCustodyShieldedSend(shieldedInput({ ownEncKeyHex: null })).returnToSender).toBeNull();
    expect(
      planCustodyShieldedSend(shieldedInput({ ownEncKeyHex: undefined })).returnToSender,
    ).toBeNull();
  });

  it('throws the refusal rather than planning a payment that cannot be made', () => {
    expect(() => planCustodyShieldedSend(shieldedInput({ amount: 0n }))).toThrow(
      /greater than zero/,
    );
  });
});

/* -------------------------------------------------------------------------- */

/**
 * The change coin, read out of the circuit's own result.
 *
 * This is the only place the change coin's description ever exists. The chain
 * carries the note and not the nonce, colour, and value that describe it, so a
 * result this function cannot read is a coin nobody can ever spend — which is
 * why `'unreadable'` is its own outcome and not an exception, and why its
 * sentence says the payment went out rather than implying it did not.
 */
describe('changeCoinFromResult', () => {
  const CHANGE = {
    is_some: true,
    value: { nonce: bytes(0x7f), color: bytes(0x1a), value: 60n },
  };

  function bytes(fill: number): Uint8Array {
    return new Uint8Array(32).fill(fill);
  }

  it('reads the change the withdrawal left', () => {
    expect(changeCoinFromResult(CHANGE)).toEqual({
      outcome: 'change',
      nonce: '7f'.repeat(32),
      colour: '1a'.repeat(32),
      value: 60n,
    });
  });

  it('reads a spend that consumed the coin exactly as a real outcome', () => {
    expect(changeCoinFromResult({ is_some: false, value: { nonce: bytes(0), color: bytes(0), value: 0n } })).toEqual({
      outcome: 'none',
    });
  });

  it('refuses to invent a coin out of a shape it does not recognise', () => {
    for (const result of [
      null,
      'a string',
      {},
      { is_some: true },
      { is_some: true, value: 'not a coin' },
      { is_some: true, value: { nonce: bytes(1), color: bytes(2) } },
      { is_some: true, value: { nonce: new Uint8Array(4), color: bytes(2), value: 1n } },
      { is_some: true, value: { nonce: bytes(1), color: 'nope', value: 1n } },
      { is_some: true, value: { nonce: bytes(1), color: bytes(2), value: -1n } },
    ]) {
      const read = changeCoinFromResult(result);
      expect(read.outcome).toBe('unreadable');
      expect(read).toHaveProperty('reason');
    }
  });
});

describe('spendPositionMayBeWrong', () => {
  it('retries only the failure a different position could fix', () => {
    expect(spendPositionMayBeWrong('could not build the merkle path')).toBe(true);
    expect(spendPositionMayBeWrong('Witness value did not satisfy the constraint')).toBe(true);
    expect(spendPositionMayBeWrong('mt_index out of range')).toBe(true);
    expect(spendPositionMayBeWrong('membership proof failed')).toBe(true);
    expect(spendPositionMayBeWrong('unsatisfiable')).toBe(true);
  });

  /* THE SCENARIO: a position past the last leaf the contract's own Zswap state
     retains. The runtime does not build a wrong path for it, it traps, and the
     trap names nothing about positions (live, 2026/09/18). */
  it('retries a runtime trap from inside the call, which names nothing', () => {
    expect(
      spendPositionMayBeWrong(
        `Unexpected error executing scoped transaction '<unnamed>': RuntimeError: unreachable`,
      ),
    ).toBe(true);
  });

  it('does not retry anything else, because a retry costs another approval', () => {
    expect(spendPositionMayBeWrong('')).toBe(false);
    expect(spendPositionMayBeWrong(undefined as never)).toBe(false);
    expect(spendPositionMayBeWrong('The proving service did not answer.')).toBe(false);
    expect(spendPositionMayBeWrong('1010: Invalid Transaction: Custom error: 239')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * A send that stopped between legs, and the one question it has to answer.
 *
 * Leg one takes the value out of the account; only leg three makes it the
 * recipient's. Every stage in between is a state somebody can close a tab in,
 * and the only thing owed to them is where their money is.
 */
describe('the record a stopped send leaves behind', () => {
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
        colourHex: '1a'.repeat(32),
        amount: 40n,
        recipientLabel: 'alice.night',
        recipientAccountAddress: 'dd'.repeat(32),
        now: 1_700_000_000_000,
      }),
      ...patch,
    };
  }

  it('is written down before leg one goes out, and read back whole', () => {
    const { storage } = storageFake();
    const record = send();
    expect(record.stage).toBe('withdrawing');
    /* A decimal string, because a bigint does not survive JSON. */
    expect(record.amount).toBe('40');
    saveCustodyShieldedSend(storage, record);
    expect(loadCustodyShieldedSend(storage, ACCOUNT)).toEqual(record);

    /* And once the run has learned the note and the transactions it produced,
       those come back too — they are what a resumed run finishes with. */
    const midFlight = send({
      stage: 'depositing',
      noteNonce: '7f'.repeat(32),
      withdrawTxId: 'tx-withdraw',
      depositTxId: 'tx-deposit',
    });
    saveCustodyShieldedSend(storage, midFlight);
    expect(loadCustodyShieldedSend(storage, ACCOUNT)).toEqual(midFlight);
    clearCustodyShieldedSend(storage, ACCOUNT);
    expect(loadCustodyShieldedSend(storage, ACCOUNT)).toBeNull();
  });

  it('keeps one send per account, and not one per attempt', () => {
    const { storage } = storageFake();
    saveCustodyShieldedSend(storage, send({ recipientLabel: 'alice.night' }));
    saveCustodyShieldedSend(storage, send({ recipientLabel: 'bob.night' }));
    saveCustodyShieldedSend(
      storage,
      send({ network: 'preview', recipientLabel: 'carol.night' }),
    );
    expect(loadCustodyShieldedSend(storage, ACCOUNT)?.recipientLabel).toBe('bob.night');
    expect(
      loadCustodyShieldedSend(storage, { ...ACCOUNT, network: 'preview' })?.recipientLabel,
    ).toBe('carol.night');
  });

  it('survives a browser that denies storage, and a blob somebody else wrote', () => {
    const denied = storageFake({ deny: true });
    saveCustodyShieldedSend(denied.storage, send());
    expect(loadCustodyShieldedSend(denied.storage, ACCOUNT)).toBeNull();
    clearCustodyShieldedSend(denied.storage, ACCOUNT);

    const { storage, map } = storageFake();
    map.set(CUSTODY_SHIELDED_SEND_KEY, '{not json');
    expect(loadCustodyShieldedSend(storage, ACCOUNT)).toBeNull();
    map.set(CUSTODY_SHIELDED_SEND_KEY, 'null');
    expect(loadCustodyShieldedSend(storage, ACCOUNT)).toBeNull();
    map.set(
      CUSTODY_SHIELDED_SEND_KEY,
      JSON.stringify({
        [`${ACCOUNT.network}::${ACCOUNT.accountAddress}`]: { ...send(), stage: 'inventing' },
      }),
    );
    expect(loadCustodyShieldedSend(storage, ACCOUNT)).toBeNull();
  });

  it('drops a row missing anything a resumed run would need', () => {
    const { storage, map } = storageFake();
    const key = `${ACCOUNT.network}::${ACCOUNT.accountAddress}`;
    for (const row of [
      null,
      'not an object',
      { ...send(), network: '' },
      { ...send(), accountAddress: 12 },
      { ...send(), colourHex: 12 },
      { ...send(), amount: 'forty' },
      { ...send(), amount: 40 },
    ]) {
      map.set(CUSTODY_SHIELDED_SEND_KEY, JSON.stringify({ [key]: row }));
      expect(loadCustodyShieldedSend(storage, ACCOUNT)).toBeNull();
    }
    /* And the fields a run can do without come back as blanks rather than
       taking the whole record with them. */
    map.set(
      CUSTODY_SHIELDED_SEND_KEY,
      JSON.stringify({
        [key]: {
          network: ACCOUNT.network,
          accountAddress: ACCOUNT.accountAddress,
          stage: 'depositing',
          colourHex: '1a'.repeat(32),
          amount: '40',
        },
      }),
    );
    expect(loadCustodyShieldedSend(storage, ACCOUNT)).toEqual({
      network: ACCOUNT.network,
      accountAddress: ACCOUNT.accountAddress,
      stage: 'depositing',
      colourHex: '1a'.repeat(32),
      amount: '40',
      recipientLabel: '',
      recipientAccountAddress: '',
      noteNonce: null,
      withdrawTxId: null,
      depositTxId: null,
      startedAt: 0,
    });
  });

  it('knows what a resumed run should do next at every stage', () => {
    expect(nextCustodyShieldedSendStep(send())).toBe('withdraw');
    expect(nextCustodyShieldedSendStep(send({ stage: 'awaiting-note' }))).toBe('find-note');
    /* Depositing with no note identified is the same position one step back —
       the note is in the wallet and has to be picked out by nonce again. */
    expect(nextCustodyShieldedSendStep(send({ stage: 'depositing' }))).toBe('find-note');
    expect(
      nextCustodyShieldedSendStep(send({ stage: 'depositing', noteNonce: '7f'.repeat(32) })),
    ).toBe('deposit');
    expect(nextCustodyShieldedSendStep(send({ stage: 'returning' }))).toBe('report');
    expect(nextCustodyShieldedSendStep(send({ stage: 'stranded' }))).toBe('report');
    expect(nextCustodyShieldedSendStep(send({ stage: 'done' }))).toBe('nothing');
  });

  it('says where the value is, and never claims it came back when it did not', () => {
    expect(custodyShieldedSendOutcome(send({ stage: 'done' }))).toMatch(/alice\.night has it/);
    expect(custodyShieldedSendOutcome(send())).toMatch(/still in your Passport/);
    expect(custodyShieldedSendOutcome(send({ stage: 'awaiting-note' }))).toMatch(/has not reached/);
    expect(custodyShieldedSendOutcome(send({ stage: 'depositing' }))).toMatch(/has not reached/);
    expect(custodyShieldedSendOutcome(send({ stage: 'returning' }))).toMatch(/being put back/);
    const stranded = custodyShieldedSendOutcome(send({ stage: 'stranded' }));
    expect(stranded).toMatch(/could not be put back/);
    expect(stranded).toMatch(/your own receiving address/);
    /* With no name to use, the sentence still has to work. */
    expect(custodyShieldedSendOutcome(send({ stage: 'done', recipientLabel: '  ' }))).toMatch(
      /them has it/,
    );
  });
});

describe('a payment whose last leg threw after the note had gone', () => {
  /* THE DEFECT THIS NAMES is a screen that says "held for you" while the
     recipient has the money. Leg three can be broadcast and still reject — a
     socket dropping, a confirmation wait running out — so the screen re-reads
     the wallet before it tries to put anything back, and where the note has
     left it says exactly that it cannot see which side has it. */
  it('says nothing here can see whether it arrived, and does not claim it came back', () => {
    const sentence = custodyShieldedSendOutcome({
      stage: 'unconfirmed',
      network: 'stagenet',
      accountAddress: 'ab'.repeat(32),
      recipientAccountAddress: 'cd'.repeat(32),
      recipientLabel: 'alice.night',
      colourHex: 'ef'.repeat(32),
      amount: '40',
      noteNonce: '01'.repeat(32),
      withdrawTxId: 'ab'.repeat(32),
      depositTxId: null,
      startedAt: 1789689600000,
    });
    expect(sentence).toBe(
      'It has left your Passport and nothing here can see whether alice.night has it yet. Check with alice.night before sending it again.',
    );
    /* Not the stranded sentence, which promises a sweep of value this Passport
       may not have. */
    expect(sentence).not.toMatch(/held for you/);
  });
});
