/**
 * A partner gift into an account custody Passport.
 *
 * Until 2026/09/18 the gift desk refused every one of them with
 * `501 account-custody-build-required` before a coin was minted, because it
 * prepared three compiled contracts of its own and none of them was
 * `account-custody`. It now borrows the account funder's build, and what this
 * file checks is the two decisions that cost money if they are wrong:
 *
 *   - the PRE-FLIGHT, which must refuse an account it cannot seal an entry for
 *     BEFORE the mint, and must read the inbox baseline the confirmation is
 *     measured against;
 *   - the CONFIRMATION, which must be this service's own entry in the account's
 *     public inbox and never "the inbox is one longer than it was".
 *
 * Both are asked of the two real stagenet states in `test/fixtures/`: the
 * passkey account `9448e166…` with an empty inbox, and the Dynamic-born
 * `0ffd70ad…`, which has four entries somebody else's transactions put there.
 * Neither needs a chain, a wallet, or a faucet.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ContractState } from '@midnight-ntwrk/compact-runtime';

import { accountModuleForState, scanInboxForEntry, shieldedDepositConfirmed } from '../src/accountModule.js';
import { accountViewFrom, type AccountView, type CustodyAccountLedger, type PrototypeAccountLedger } from '../src/accountState.js';
import { ColourPayFailure, asColourPayFailure, custodyGiftPlan } from '../src/gift.js';
import { sealInboxEntry } from '../src/custodyInbox.js';

import * as prototypeBuild from '../contracts-stagenet/managed/account/contract/index.js';
import * as custodyBuild from '../contracts-stagenet/managed/account-custody/contract/index.js';

const fixtures = join(import.meta.dirname, '..', '..', 'test', 'fixtures');
const NATIVE_COLOUR = new Uint8Array(32);
const GIFT_NAME = 'Midnight Genesis Pass';

function stateFrom(file: string): ContractState {
  const served = JSON.parse(readFileSync(join(fixtures, file), 'utf8')) as {
    data: { contract: { state: string } };
  };
  return ContractState.deserialize(
    Uint8Array.from(
      (served.data.contract.state.match(/.{2}/g) ?? []).map((byte) => parseInt(byte, 16)),
    ),
  );
}

const prototypeLedger = (prototypeBuild as unknown as {
  ledger: (data: unknown) => PrototypeAccountLedger;
}).ledger;
const custodyLedger = (custodyBuild as unknown as {
  ledger: (data: unknown) => CustodyAccountLedger;
}).ledger;

function viewOf(state: ContractState, address: string): AccountView {
  return accountViewFrom<PrototypeAccountLedger, CustodyAccountLedger>({
    state,
    address,
    module: accountModuleForState(state),
    nativeColour: NATIVE_COLOUR,
    prototypeLedger,
    custodyLedger,
  });
}

const JUBJUB = '9448e16665d0aa3ef103ff2eff5ca50694d44318d8a9c66998b8d57927755c11';
const K256 = '0ffd70ad38ce81e8378c8269ef1b127d5f90a77dba4f7618bf48eeb836ad2746';

const jubjubView = viewOf(stateFrom('account-state-custody-jubjub.json'), JUBJUB);
const k256View = viewOf(stateFrom('account-state-custody-k256.json'), K256);

describe('the pre-flight for a gift into a custody account', () => {
  it('reads a key and an inbox baseline off the passkey account that was refused', () => {
    const plan = custodyGiftPlan(jubjubView, JUBJUB, GIFT_NAME);
    /* An account that has never been paid: the first gift's entry is slot 0. */
    assert.equal(plan.inboxBefore, 0n);
    assert.equal(jubjubView.encKey()?.length, 32);
  });

  it('takes the baseline from an account that has already been written to', () => {
    /* Four entries are already there and none of them is ours. The baseline is
       what makes that difference legible afterwards. */
    assert.equal(custodyGiftPlan(k256View, K256, GIFT_NAME).inboxBefore, 4n);
  });

  it('refuses an account with no usable key BEFORE anything is minted', () => {
    /* The refusal that saves a coin. A deposit sealed to no key still lands:
       the coin moves into the contract's Zswap balance and the owner's witness
       walks the inbox and never finds it. */
    const unsealable: AccountView = { ...k256View, encKey: () => null };
    let refused: ColourPayFailure | null = null;
    try {
      custodyGiftPlan(unsealable, K256, GIFT_NAME);
    } catch (cause) {
      refused = cause as ColourPayFailure;
    }
    assert.ok(refused instanceof ColourPayFailure);
    assert.equal(refused.status, 400);
    assert.equal(refused.error, 'recipient-not-sealable');
    assert.match(refused.message, /Nothing was minted and nothing was spent/);
  });
});

describe('what confirms a gift that cannot be read back off the chain', () => {
  const ours = sealInboxEntry(k256View.encKey() as Uint8Array, {
    nonce: new Uint8Array(32).fill(9),
    color: new Uint8Array(32).fill(1),
    value: 1n,
  });
  /** The account's inbox as it is, plus whatever landed after the baseline. */
  const inboxWith = (extra: Array<Uint8Array | null>) => (index: bigint): Uint8Array | null =>
    index < 4n ? k256View.inboxEntry(index) : (extra[Number(index - 4n)] ?? null);

  it('is our own entry in the account inbox, and says so', () => {
    const scan = scanInboxForEntry(inboxWith([ours]), 4n, 5n, ours);
    assert.equal(scan, 'found');
    assert.equal(
      shieldedDepositConfirmed('account-custody', 4n, 5n, 1n, {
        entryFound: true,
        inboxUnreadable: false,
        included: false,
      }),
      true,
    );
  });

  it('is NOT the inbox growing, which is what somebody else writing looks like', () => {
    /* The correction this rule exists for. The inbox grows for every other
       depositor, for the change entry of every send the owner makes, and for
       every backfill; a wait on `observed > before` is satisfied by a stranger's
       transaction and would report a gift delivered that had been refused. */
    const somebodyElse = sealInboxEntry(k256View.encKey() as Uint8Array, {
      nonce: new Uint8Array(32).fill(7),
      color: new Uint8Array(32).fill(2),
      value: 500n,
    });
    assert.equal(scanInboxForEntry(inboxWith([somebodyElse]), 4n, 5n, ours), 'absent');
    assert.equal(
      shieldedDepositConfirmed('account-custody', 4n, 5n, 1n, {
        entryFound: false,
        inboxUnreadable: false,
        included: true,
      }),
      false,
      'a block the deposit reached must not confirm it while the map can be walked',
    );
  });

  it('finds our entry even when somebody else took the slot it was built for', () => {
    /* `inbox_count` is not ours to reserve: another depositor's entry can land
       in the slot this one was built for, and the gift is perfectly good one
       index further along. */
    const somebodyElse = sealInboxEntry(k256View.encKey() as Uint8Array, {
      nonce: new Uint8Array(32).fill(3),
      color: new Uint8Array(32).fill(4),
      value: 2n,
    });
    assert.equal(scanInboxForEntry(inboxWith([somebodyElse, ours]), 4n, 6n, ours), 'found');
  });

  it('falls back to the deposit own block only where the map cannot be walked at all', () => {
    assert.equal(scanInboxForEntry(() => null, 4n, 5n, ours), 'unreadable');
    assert.equal(
      shieldedDepositConfirmed('account-custody', 4n, 5n, 1n, {
        entryFound: false,
        inboxUnreadable: true,
        included: true,
      }),
      true,
    );
    /* And not even then, if the transaction never reached a block. */
    assert.equal(
      shieldedDepositConfirmed('account-custody', 4n, 5n, 1n, {
        entryFound: false,
        inboxUnreadable: true,
        included: false,
      }),
      false,
    );
  });
});

describe('the account funder refusals, as this desk answers them', () => {
  it('keeps a recipient error a 400 and names it', () => {
    for (const code of ['not-an-account', 'account-not-activated']) {
      const failure = asColourPayFailure(
        Object.assign(new Error('the sentence the funder wrote'), { code }),
        JUBJUB,
        GIFT_NAME,
      );
      assert.equal(failure.status, 400);
      assert.equal(failure.error, code);
      assert.equal(failure.message, 'the sentence the funder wrote');
    }
  });

  it('keeps a host error a 503, so a partner is not told their recipient is wrong', () => {
    for (const code of ['indexer-unreachable', 'prover-unavailable']) {
      const failure = asColourPayFailure(
        Object.assign(new Error('this host, not that account'), { code }),
        JUBJUB,
        GIFT_NAME,
      );
      assert.equal(failure.status, 503);
      assert.equal(failure.error, code);
    }
  });

  it('passes a refusal this desk already made through unchanged', () => {
    const original = new ColourPayFailure(501, 'account-custody-build-required', 'no build here');
    assert.equal(asColourPayFailure(original, JUBJUB, GIFT_NAME), original);
  });

  it('calls anything it does not recognise a gift-failed, with the cause in the sentence', () => {
    const failure = asColourPayFailure(new Error('socket hang up'), JUBJUB, GIFT_NAME);
    assert.equal(failure.status, 503);
    assert.equal(failure.error, 'gift-failed');
    assert.match(failure.message, /socket hang up/);
  });
});
