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
  custodyStoppedSendSentence,
  custodyStoppedSendVerdict,
  loadCustodyShieldedSend,
  newCustodyShieldedSend,
  nextCustodyShieldedSendStep,
  saveCustodyShieldedSend,
  spendFailureText,
  spendPositionMayBeWrong,
  zswapLeafIndex,
  spendRefusalMayBePosition,
  CUSTODY_APPROVAL_WAITING,
  CUSTODY_SHIELDED_SEND_KEY,
  custodyShieldedAddressSendRefusal,
  custodyShieldedSendRefusal,
  planCustodyShieldedAddressSend,
  planCustodyShieldedSend,
  shieldedDepositRouteFor,
  depositCircuitFor,
  custodyApprovalPrompt,
  custodySendRefusal,
  custodyUnshieldedBalance,
  planCustodySend,
  type CustodySendPlanInput,
  type CustodyShieldedAddressSendPlanInput,
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
 *
 * The third is the PROTOTYPE recipient, refused because a payment to one
 * cannot be a single transaction at all — the two builds compile to different
 * intermediate representations and are proved by different services — and the
 * only other way to reach one is through a wallet the ruling of 2026/09/18
 * forbids in a value flow.
 */
const ENC_KEY = 'ab'.repeat(32);
const NONCE = '7f'.repeat(32);

function shieldedInput(
  patch: Partial<CustodyShieldedSendPlanInput> = {},
): CustodyShieldedSendPlanInput {
  return {
    record: RECORD,
    colourHex: '1a'.repeat(32),
    amount: 40n,
    recipientAccountAddress: 'dd'.repeat(32),
    recipientModule: 'account-custody',
    heldCoin: { nonce: NONCE, value: 100n, mtIndex: 7n },
    queuedValues: [],
    recipientEncKeyHex: ENC_KEY,
    ...patch,
  };
}

function addressInput(
  patch: Partial<CustodyShieldedAddressSendPlanInput> = {},
): CustodyShieldedAddressSendPlanInput {
  return {
    record: RECORD,
    colourHex: '1a'.repeat(32),
    amount: 40n,
    recipientShieldedAddress: 'mn_shield-addr_test1qqqqqqqqq',
    heldCoin: { nonce: NONCE, value: 100n, mtIndex: 7n },
    queuedValues: [],
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
        shieldedInput({ recipientEncKeyHex: `0x${ENC_KEY.toUpperCase()}` }),
      ),
    ).toBeNull();
  });

  it('refuses before the Passport is finished being set up', () => {
    expect(custodyShieldedSendRefusal(shieldedInput({ record: null }))).toMatch(/still being set up/);
    expect(
      custodyShieldedSendRefusal(shieldedInput({ record: { ...RECORD, activated: false } })),
    ).toMatch(/still being set up/);
    expect(
      custodyShieldedSendRefusal(shieldedInput({ record: { ...RECORD, address: null } })),
    ).toMatch(/still being set up/);
  });

  it('refuses an amount of nothing', () => {
    expect(custodyShieldedSendRefusal(shieldedInput({ amount: 0n }))).toMatch(/greater than zero/);
  });

  it('refuses a name that is not a Passport at all', () => {
    expect(custodyShieldedSendRefusal(shieldedInput({ recipientModule: 'midnames' }))).toMatch(
      /does not belong to a Passport/,
    );
  });

  it('refuses an older Passport, because the payment could not be one transaction', () => {
    /* THE REFUSAL WORTH ARGUING WITH. A passkey Passport's account is a
       different build, compiled to a different intermediate representation and
       proved by a different service, so one transaction cannot hold a call of
       each — and the only other route is through a wallet the ruling forbids. */
    for (const module of ['account', 'account-v1'] as const) {
      expect(custodyShieldedSendRefusal(shieldedInput({ recipientModule: module }))).toMatch(
        /on the older version, so it can't be paid from this one/,
      );
    }
  });

  it('tells an empty colour apart from an amount split across payments', () => {
    expect(custodyShieldedSendRefusal(shieldedInput({ heldCoin: null }))).toMatch(/holds none/);
    expect(
      custodyShieldedSendRefusal(
        shieldedInput({ heldCoin: { nonce: NONCE, value: 10n, mtIndex: 1n }, amount: 100n }),
      ),
    ).toMatch(/do not hold enough/);
    expect(
      custodyShieldedSendRefusal(
        shieldedInput({
          heldCoin: { nonce: NONCE, value: 10n, mtIndex: 1n },
          queuedValues: [50n, 60n],
          amount: 100n,
        }),
      ),
    ).toMatch(/arrived as separate payments/);
  });

  it('refuses a recipient whose encryption key is missing or malformed', () => {
    for (const key of [null, undefined, '', 'nonsense', ENC_KEY.slice(0, 60)]) {
      expect(custodyShieldedSendRefusal(shieldedInput({ recipientEncKeyHex: key }))).toMatch(
        /cannot be paid this kind of amount yet/,
      );
    }
  });
});

describe('planCustodyShieldedSend', () => {
  it('is ONE leg: the gated spend to the recipient’s account, binding the coin', () => {
    expect(planCustodyShieldedSend(shieldedInput()).transfer).toEqual({
      operation: 'withdraw_shielded_to_contract',
      contractAddress: 'dd'.repeat(32),
      colourHex: '1a'.repeat(32),
      amount: 40n,
      recipientEncKeyHex: ENC_KEY,
      coin: { nonce: NONCE, value: 100n, mtIndex: 7n },
    });
  });

  it('normalises the recipient’s encryption key however it was published', () => {
    expect(
      planCustodyShieldedSend(shieldedInput({ recipientEncKeyHex: `0x${ENC_KEY.toUpperCase()}` }))
        .transfer.recipientEncKeyHex,
    ).toBe(ENC_KEY);
  });

  it('spends EXACTLY the amount, not the whole coin', () => {
    /* The change comes back in the same transaction as the circuit's own
       value, so asking for the whole coin would mean sending a stranger more
       than the amount. */
    expect(planCustodyShieldedSend(shieldedInput({ amount: 1n })).transfer.amount).toBe(1n);
  });

  it('throws the refusal rather than planning a payment that cannot be made', () => {
    expect(() => planCustodyShieldedSend(shieldedInput({ amount: 0n }))).toThrow(
      /greater than zero/,
    );
  });
});

describe('a payment to an address somebody pasted', () => {
  it('lets one through, and plans the single gated spend', () => {
    expect(custodyShieldedAddressSendRefusal(addressInput())).toBeNull();
    expect(planCustodyShieldedAddressSend(addressInput())).toEqual({
      operation: 'withdraw_shielded',
      colourHex: '1a'.repeat(32),
      amount: 40n,
      recipientShieldedAddress: 'mn_shield-addr_test1qqqqqqqqq',
      coin: { nonce: NONCE, value: 100n, mtIndex: 7n },
    });
  });

  it('trims what was pasted, because a copied address brings whitespace with it', () => {
    expect(
      planCustodyShieldedAddressSend(
        addressInput({ recipientShieldedAddress: '  mn_shield-addr_test1qqqqqqqqq \n' }),
      ).recipientShieldedAddress,
    ).toBe('mn_shield-addr_test1qqqqqqqqq');
  });

  it('refuses before the Passport is finished, and an amount of nothing', () => {
    expect(custodyShieldedAddressSendRefusal(addressInput({ record: null }))).toMatch(
      /still being set up/,
    );
    expect(
      custodyShieldedAddressSendRefusal(addressInput({ record: { ...RECORD, activated: false } })),
    ).toMatch(/still being set up/);
    expect(
      custodyShieldedAddressSendRefusal(addressInput({ record: { ...RECORD, address: null } })),
    ).toMatch(/still being set up/);
    expect(custodyShieldedAddressSendRefusal(addressInput({ amount: 0n }))).toMatch(
      /greater than zero/,
    );
  });

  it('refuses anything that is not a shielded address', () => {
    for (const typed of ['', '   ', 'alice.night', 'mn_addr_test1qqq', 'mn_shield-addr']) {
      expect(
        custodyShieldedAddressSendRefusal(addressInput({ recipientShieldedAddress: typed })),
      ).toMatch(/not an address this Passport can pay/);
    }
  });

  it('tells an empty colour apart from an amount split across payments', () => {
    expect(custodyShieldedAddressSendRefusal(addressInput({ heldCoin: null }))).toMatch(
      /holds none/,
    );
    expect(
      custodyShieldedAddressSendRefusal(
        addressInput({ heldCoin: { nonce: NONCE, value: 10n, mtIndex: 1n }, amount: 100n }),
      ),
    ).toMatch(/do not hold enough/);
    expect(
      custodyShieldedAddressSendRefusal(
        addressInput({
          heldCoin: { nonce: NONCE, value: 10n, mtIndex: 1n },
          queuedValues: [50n, 60n],
          amount: 100n,
        }),
      ),
    ).toMatch(/arrived as separate payments/);
  });

  it('throws the refusal rather than planning a payment that cannot be made', () => {
    expect(() => planCustodyShieldedAddressSend(addressInput({ amount: 0n }))).toThrow(
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

describe('spendFailureText', () => {
  /* THE DEFECT THIS CATCHES, live on 2026/09/18 and on the second attempt at
     fixing it: a WebAssembly trap is `name: 'RuntimeError'`, `message:
     'unreachable'`, so the message on its own is one word with nothing in it to
     recognise — and the predicate below, however right, cannot judge evidence it
     is not given. It is also what a person was shown: the alert read
     `unreachable`. */
  it('carries the error’s name, because a WASM trap keeps its evidence there', () => {
    const trap = new Error('unreachable');
    trap.name = 'RuntimeError';
    expect(spendFailureText(trap)).toBe('RuntimeError: unreachable');
    expect(spendPositionMayBeWrong(spendFailureText(trap))).toBe(true);
  });

  it('does not repeat a name the message already carries', () => {
    const named = new Error('RuntimeError: unreachable');
    named.name = 'RuntimeError';
    expect(spendFailureText(named)).toBe('RuntimeError: unreachable');
  });

  it('adds nothing when the name says nothing', () => {
    const nameless = new Error('could not build the merkle path');
    nameless.name = '';
    expect(spendFailureText(nameless)).toBe('could not build the merkle path');
  });

  it('reads anything that is not an error as itself', () => {
    expect(spendFailureText('a plain string')).toBe('a plain string');
    expect(spendFailureText(null)).toBe('null');
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

  /* THE SHAPE THE LIVE FAILURE ACTUALLY HAS (2026/09/18, defect 19). A position
     past the last leaf the contract's own Zswap state retains does not produce a
     wrong Merkle path — the runtime traps, and all that reaches the caller is
     the bare trap. This assertion was `false` until the phase guard went in, and
     that is precisely why a Passport whose stored position was stale could not
     send at all. */
  it('retries the bare runtime trap a stale position really produces', () => {
    expect(spendPositionMayBeWrong('RuntimeError: unreachable')).toBe(true);
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

  /* WHERE THE OLD DISCRIMINATOR WENT. This predicate no longer tries to tell a
     trap raised while executing the call from a trap raised while submitting
     it: it cannot, because the wording is the same, and pretending otherwise is
     what produced defect 19. `spendShieldedK1` answers that question from the
     proof boundary instead and never asks this one after a proof has come
     back — so a trap from the submission half is unreachable here rather than
     mis-sorted here. */
  it('leaves WHETHER a retry is safe to the caller, and answers only whether it is worth it', () => {
    expect(spendPositionMayBeWrong('RuntimeError: memory access out of bounds')).toBe(true);
    expect(
      spendPositionMayBeWrong('proving failed: RuntimeError: table index is out of bounds'),
    ).toBe(true);
    /* And a submission refusal is still not a position's problem, whatever
       phase it arrives in. */
    expect(spendPositionMayBeWrong('1010: Invalid Transaction: Custom error: 217')).toBe(false);
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
    expect(record.stage).toBe('sending');
    /* A decimal string, because a bigint does not survive JSON. */
    expect(record.amount).toBe('40');
    saveCustodyShieldedSend(storage, record);
    expect(loadCustodyShieldedSend(storage, ACCOUNT)).toEqual(record);

    /* And once there is a transaction to name it by, that comes back too. */
    const inFlight = send({ sendTxId: 'tx-send' });
    saveCustodyShieldedSend(storage, inFlight);
    expect(loadCustodyShieldedSend(storage, ACCOUNT)).toEqual(inFlight);
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
          stage: 'sending',
          colourHex: '1a'.repeat(32),
          amount: '40',
        },
      }),
    );
    expect(loadCustodyShieldedSend(storage, ACCOUNT)).toEqual({
      network: ACCOUNT.network,
      accountAddress: ACCOUNT.accountAddress,
      stage: 'sending',
      colourHex: '1a'.repeat(32),
      amount: '40',
      recipientLabel: '',
      recipientAccountAddress: '',
      sendTxId: null,
      startedAt: 0,
    });
  });

  it('knows what a run that found a record should do with it', () => {
    /* TWO STAGES AND NO 'finish'. A send is one transaction, so a record that
       is not 'done' is one nobody saw land — and what is owed is a sentence,
       not a button that would offer to send the money twice. */
    expect(nextCustodyShieldedSendStep(send())).toBe('report');
    expect(nextCustodyShieldedSendStep(send({ stage: 'done' }))).toBe('nothing');
  });

  it('says where the value is, and never claims more than it can see', () => {
    /* A payment that landed is an activity row, never a sentence (2026/09/25). */
    expect(custodyShieldedSendOutcome(send({ stage: 'done' }))).toBeNull();
    const inFlight = custodyShieldedSendOutcome(send({ sendTxId: 'cc'.repeat(32) }));
    /* ASKED OF THE CHAIN, and until it answers the line says so (2026/09/22). */
    expect(inFlight).toBe('Checking whether your payment to alice.night went through…');
    /* AND IT PROMISES NOTHING NOBODY WROTE: no resume, no button, no wait. */
    expect(inFlight).not.toMatch(/by itself|on its own|Finish/);
    /* With no name to use, the sentence still has to work. */
    expect(
      custodyShieldedSendOutcome(send({ recipientLabel: '', sendTxId: 'cc'.repeat(32) })),
    ).toMatch(/payment to them went through/);
  });

  /* THE STRONGER SENTENCE, AND WHEN IT IS EARNED (defect 18, fixed
     2026/09/18). Most of what can go wrong with a payment goes wrong before a
     transaction exists: the approval is dismissed, the proving service does not
     answer, the position cannot be proved. A record still holding no id was
     abandoned in one of those, the coin is untouched, and hedging about it
     ("either it reached them or nothing left") is a worse answer than the truth.
     The live run of 2026/09/18 showed the hedge on screen beside a balance that
     had not moved. */
  it('says nothing was sent when no transaction was ever submitted', () => {
    const untouched = custodyShieldedSendOutcome(send({ sendTxId: null }));
    expect(untouched).toBe('Nothing was sent, and it is all still in your Passport.');
    /* It must NOT hedge, and it must not offer a resume. */
    expect(untouched).not.toMatch(/either it reached|one payment|Finish|by itself/);
  });

  it('checks only once there is a transaction that could have landed', () => {
    /* The SAME stage, the only difference being that a transaction exists. */
    const away = custodyShieldedSendOutcome(send({ sendTxId: 'cc'.repeat(32) }));
    expect(away).toMatch(/Checking whether your payment to alice\.night went through/);
    expect(away).not.toMatch(/Nothing was sent|either it reached|says which/);
  });

  it('answers a stopped payment from the chain: sent, not sent, or still checking', () => {
    const now = 1_800_000_000_000;
    const away = send({ sendTxId: 'cc'.repeat(32), startedAt: now - 60_000 });
    /* The indexer has it: sent, whenever it is asked. There is no sentence for
       it — the type of `custodyStoppedSendSentence` refuses 'landed', because a
       landed payment is recorded as activity, not announced (2026/09/25). */
    expect(custodyStoppedSendVerdict({ record: away, onChain: true, now })).toBe('landed');
    /* Answered and absent, but still inside the wait: not yet a verdict. */
    expect(custodyStoppedSendVerdict({ record: away, onChain: false, now })).toBe('checking');
    /* Answered and absent, and the wait has passed since it was SENT. */
    const late = { ...away, sentAt: now - 3 * 60 * 1000 };
    expect(custodyStoppedSendVerdict({ record: late, onChain: false, now })).toBe('not-landed');
    expect(custodyStoppedSendSentence(late, 'not-landed')).toBe(
      "That payment didn't go through. Nothing left your Passport.",
    );
    /* An indexer that could not be asked is never a verdict, however late. */
    expect(custodyStoppedSendVerdict({ record: late, onChain: null, now })).toBe('checking');
    expect(custodyStoppedSendSentence(late, 'checking')).toBe(
      'Checking whether your payment to alice.night went through…',
    );
  });

  it('keeps what a submit wrote, so a payment that never landed can be taken back', () => {
    const storage = new Map<string, string>();
    const store = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    };
    const undo = {
      held: { colour: 'aa'.repeat(32), nonce: 'bb'.repeat(32), value: '100', mtIndex: '12' },
      change: { colour: 'aa'.repeat(32), nonce: 'cc'.repeat(32) },
    };
    const record = { ...send({ sendTxId: 'dd'.repeat(32) }), sentAt: 5, undo };
    saveCustodyShieldedSend(store, record);
    const read = loadCustodyShieldedSend(store, {
      network: record.network,
      accountAddress: record.accountAddress,
    });
    expect(read?.sentAt).toBe(5);
    expect(read?.undo).toEqual(undo);
    /* No change coin is a real answer, kept as null. */
    saveCustodyShieldedSend(store, { ...record, undo: { ...undo, change: null } });
    expect(
      loadCustodyShieldedSend(store, { network: record.network, accountAddress: record.accountAddress })
        ?.undo?.change,
    ).toBeNull();
    /* A malformed undo is dropped, never half-read. */
    for (const broken of [
      'nope',
      { held: null },
      { held: { ...undo.held, value: '-1' } },
      { held: { ...undo.held, mtIndex: 7 } },
      { held: { ...undo.held, colour: 1 } },
      { held: { ...undo.held, nonce: 1 } },
      { held: { ...undo.held, value: 1 } },
    ]) {
      saveCustodyShieldedSend(store, { ...record, undo: broken as never });
      expect(
        loadCustodyShieldedSend(store, { network: record.network, accountAddress: record.accountAddress })
          ?.undo,
      ).toBeUndefined();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* A SPONSORED REFUSAL, AND WHETHER IT IS WORTH ANOTHER POSITION              */
/*                                                                            */
/* THE DEFECT THESE ARE WRITTEN AGAINST (live, 2026/09/21). The candidate      */
/* retry was armed by the words the refusal arrived with, and on the sponsored */
/* route those words are one fixed sentence — the service redacts the proof    */
/* server's own text so that a malformed transaction cannot make it publish    */
/* its filesystem and its internal endpoints. So the predicate answered no to  */
/* every sponsored refusal, and the first payment out of a freshly funded      */
/* Passport stopped on the first one with `Public transcript input mismatch`   */
/* in the proof server's log — a position that rebuilds a different root,      */
/* which is precisely the failure the retry exists for.                        */
/* -------------------------------------------------------------------------- */

/** The body the deployed sponsor answers a refused proof with, verbatim. */
const SPONSOR_DETAIL = 'The proof server could not prove this transaction.';

describe('whether a refusal from the proving service is worth another position', () => {
  it('retries the sponsor’s own redacted sentence while a position is left', () => {
    /* THE LIVE CASE. Nothing in that sentence says merkle, mt_index,
       membership, witness, unsatisfiable, or constraint — and it never will. */
    expect(spendPositionMayBeWrong(SPONSOR_DETAIL)).toBe(false);
    expect(
      spendRefusalMayBePosition({
        proofNotBuilt: true,
        detail: SPONSOR_DETAIL,
        positionsLeft: true,
      }),
    ).toBe(true);
  });

  it('is over once there is nowhere left to try', () => {
    /* WHAT BOUNDS THE APPROVALS. A verdict no position can fix — a verifier
       key that does not match, a circuit staged the wrong way — costs one
       approval per remaining position and not one more. */
    expect(
      spendRefusalMayBePosition({
        proofNotBuilt: true,
        detail: SPONSOR_DETAIL,
        positionsLeft: false,
      }),
    ).toBe(false);
  });

  it('retries a refusal that said nothing at all, while a position is left', () => {
    expect(
      spendRefusalMayBePosition({ proofNotBuilt: true, detail: null, positionsLeft: true }),
    ).toBe(true);
    expect(
      spendRefusalMayBePosition({ proofNotBuilt: true, detail: null, positionsLeft: false }),
    ).toBe(false);
  });

  it('honours a refusal that names a position on its words alone', () => {
    /* A LOCAL PROVER, OR A FUTURE SPONSOR THAT FORWARDS THE TEXT, loses
       nothing: the wording is still the fast yes, and it does not wait on the
       store to agree that there is somewhere to go. */
    expect(
      spendRefusalMayBePosition({
        proofNotBuilt: true,
        detail: 'Public transcript input mismatch: the merkle path does not rebuild the root',
        positionsLeft: false,
      }),
    ).toBe(true);
  });

  it('is not armed by anything that is not the service’s verdict', () => {
    /* `503 prover-unavailable` is a DIFFERENT error and is untouched: the
       service was restarted mid-spend, it looked at no position, and a retry
       would cost an approval to learn nothing. Same for a refusal this build
       never classified at all. */
    expect(
      spendRefusalMayBePosition({
        proofNotBuilt: false,
        detail: SPONSOR_DETAIL,
        positionsLeft: true,
      }),
    ).toBe(false);
    expect(
      spendRefusalMayBePosition({
        proofNotBuilt: false,
        detail: 'the merkle path could not be built',
        positionsLeft: true,
      }),
    ).toBe(false);
  });
});

describe('zswapLeafIndex', () => {
  const A = 'ab'.repeat(32);
  const dump = [
    'State {',
    `    coin_coms: MerkleTree(root = Some(${'00'.repeat(32)})) {`,
    '        0..=4212: <collapsed>,',
    `        4213: (${'03'.repeat(32)}, Some(ContractAddress(${A}))),`,
    '        4214..=4218: <collapsed>,',
    `        4219: (${'06'.repeat(32)}, Some(ContractAddress(${A}))),`,
    '    },',
    '}',
  ].join('\n');

  it('reads the index a commitment is listed at', () => {
    expect(zswapLeafIndex(dump, '06'.repeat(32))).toBe(4219n);
    expect(zswapLeafIndex(dump, '03'.repeat(32).toUpperCase())).toBe(4213n);
  });

  it('is null for a commitment the tree does not list, or the root', () => {
    expect(zswapLeafIndex(dump, '07'.repeat(32))).toBeNull();
    expect(zswapLeafIndex(dump, '00'.repeat(32))).toBeNull();
  });

  it('is null for anything that is not a commitment or a dump', () => {
    expect(zswapLeafIndex(dump, 'not hex')).toBeNull();
    expect(zswapLeafIndex(undefined as unknown as string, '06'.repeat(32))).toBeNull();
    expect(zswapLeafIndex(dump, 6 as unknown as string)).toBeNull();
  });
});
