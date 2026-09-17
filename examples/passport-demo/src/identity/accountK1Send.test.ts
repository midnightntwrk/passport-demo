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
  K1_APPROVAL_WAITING,
  depositCircuitFor,
  k1ApprovalPrompt,
  k1SendRefusal,
  k1UnshieldedBalance,
  planK1Send,
  shieldedSendRefusal,
  type K1SendPlanInput,
  type K1UnshieldedLedger,
} from './accountK1Send.js';
import type { K1AccountRecord } from './accountK1Plan.js';

const RECORD: K1AccountRecord = {
  user: '0xabc',
  network: 'stagenet',
  address: 'aa'.repeat(32),
  privateStateId: 'passport-account-k1-abc',
  saltHex: 'bb'.repeat(32),
  pkXHex: '1',
  pkYHex: '2',
  wavesDone: 3,
  totalWaves: 3,
  activated: true,
  txHashes: [],
};

function input(patch: Partial<K1SendPlanInput> = {}): K1SendPlanInput {
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

  it('names the k1 build deposit_unshielded', () => {
    expect(depositCircuitFor('account-k1')).toBe('deposit_unshielded');
  });

  it('refuses the registry, which is not an account at all', () => {
    expect(depositCircuitFor('midnames')).toBeNull();
  });
});

describe('k1SendRefusal', () => {
  it('refuses while the Passport is still being set up', () => {
    const sentence = 'Your Passport is still being set up. Try again once it is ready.';
    expect(k1SendRefusal(input({ record: null }))).toBe(sentence);
    expect(k1SendRefusal(input({ record: { ...RECORD, address: null } }))).toBe(sentence);
    expect(k1SendRefusal(input({ record: { ...RECORD, activated: false } }))).toBe(sentence);
  });

  it('refuses zero and below', () => {
    expect(k1SendRefusal(input({ amount: 0n }))).toBe('Enter an amount greater than zero.');
    expect(k1SendRefusal(input({ amount: -1n }))).toBe('Enter an amount greater than zero.');
  });

  it('refuses before the wallet has an address to be paid at', () => {
    expect(k1SendRefusal(input({ ownReceivingAddress: '   ' }))).toBe(
      'Your Passport is still opening. Try again in a moment.',
    );
  });

  it('refuses a name that does not point at an account', () => {
    expect(k1SendRefusal(input({ recipientModule: 'midnames' }))).toBe(
      'That name does not belong to a Passport that can be paid.',
    );
  });

  it('refuses more than the account holds', () => {
    expect(k1SendRefusal(input({ heldBalance: 1n }))).toBe('You do not hold enough to send that.');
  });

  it('does NOT refuse when the balance could not be read', () => {
    expect(k1SendRefusal(input({ heldBalance: null }))).toBeNull();
  });

  it('allows a send of exactly what is held', () => {
    expect(k1SendRefusal(input({ heldBalance: 5_000_000n }))).toBeNull();
  });
});

describe('planK1Send', () => {
  it('pays leg one to the SENDER’s own address, and leg two to the recipient', () => {
    const plan = planK1Send(input());
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
    expect(planK1Send(input({ recipientModule: 'account-k1' })).deposit.circuit).toBe(
      'deposit_unshielded',
    );
  });

  it('throws the refusal rather than planning something that cannot run', () => {
    expect(() => planK1Send(input({ amount: 0n }))).toThrow('Enter an amount greater than zero.');
  });
});

describe('the words a person reads', () => {
  it('names the provider, not the vendor', () => {
    expect(k1ApprovalPrompt('Google')).toBe('Approve with your Google account');
    expect(k1ApprovalPrompt('X')).toBe('Approve with your X account');
  });

  it('still works when the provider is not known', () => {
    const fallback = 'Approve with the account you signed in with';
    expect(k1ApprovalPrompt(null)).toBe(fallback);
    expect(k1ApprovalPrompt('  ')).toBe(fallback);
    expect(k1ApprovalPrompt(7 as unknown as string)).toBe(fallback);
  });

  it('has one line for the wait', () => {
    expect(K1_APPROVAL_WAITING).toBe('Waiting for your approval');
  });

  it('says a shielded balance is there and cannot go out yet', () => {
    expect(shieldedSendRefusal('mUSD')).toBe(
      'mUSD can be received into this Passport, but sending it is not built yet.',
    );
    expect(shieldedSendRefusal(null)).toBe(
      'This can be received into this Passport, but sending it is not built yet.',
    );
    expect(shieldedSendRefusal(' ')).toBe(
      'This can be received into this Passport, but sending it is not built yet.',
    );
  });
});

describe('k1UnshieldedBalance', () => {
  const colour = new Uint8Array(32);

  function ledger(value: bigint | null): K1UnshieldedLedger {
    return {
      unshielded_balances: {
        member: () => value !== null,
        lookup: () => value as bigint,
      },
    };
  }

  it('reads what the mirror holds', () => {
    expect(k1UnshieldedBalance(ledger(42n), colour)).toBe(42n);
  });

  it('reads a colour the mirror has never seen as a REAL zero', () => {
    expect(k1UnshieldedBalance(ledger(null), colour)).toBe(0n);
  });
});
