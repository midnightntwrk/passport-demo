/**
 * Drills for the one send today's Passports must not make.
 *
 * The rule is narrow on purpose, so the drill is a MATRIX rather than a handful
 * of examples: every asset kind, against every recipient kind, on every build,
 * at a whole amount and at a partial one. A rule that paused anything besides a
 * partial shielded amount to a raw address would be taking away a send that
 * works — the name path, a NIGHT payment, a whole coin to an address — and the
 * matrix is what makes that visible rather than trusted.
 *
 * The sentence is asserted too, and so is what it does NOT say: this refusal
 * arrives in front of somebody mid-payment, and the vocabulary rules for it are
 * the same ones every other sentence on that sheet keeps.
 */

import { describe, expect, it } from 'vitest';

import {
  addressSendRefusal,
  isPrototypeAccountBuild,
  partialAddressSendRefusal,
  PROTOTYPE_ACCOUNT_BUILDS,
  type AddressSendAsset,
  type AddressSendPolicyInput,
  type AddressSendRecipient,
  type SenderAccountBuild,
} from './addressSendPolicy.js';

/** The three axes, spelled out so the matrix below cannot quietly shrink. */
const ASSETS: readonly AddressSendAsset[] = ['night', 'shielded'];
const RECIPIENTS: readonly AddressSendRecipient[] = ['address', 'name', 'account'];
/**
 * Every build a caller can hand this rule: the two prototype compilations, the
 * unread answer, the absent one, and a build that is not the prototype at all —
 * which is what the account contract landing next week will be.
 */
const BUILDS: readonly (SenderAccountBuild | null)[] = [
  'account',
  'account-v1',
  'unknown',
  null,
  'account-custody',
];

const HELD = 100n;

function ask(overrides: Partial<AddressSendPolicyInput>): string | null {
  return addressSendRefusal({
    asset: 'shielded',
    recipient: 'address',
    senderBuild: 'account',
    amount: HELD,
    held: HELD,
    symbol: 'mUSD',
    ...overrides,
  });
}

describe('which builds have the defect', () => {
  it('names the two prototype compilations and nothing else', () => {
    expect([...PROTOTYPE_ACCOUNT_BUILDS]).toEqual(['account', 'account-v1']);
    expect(isPrototypeAccountBuild('account')).toBe(true);
    expect(isPrototypeAccountBuild('account-v1')).toBe(true);
    expect(isPrototypeAccountBuild('account-custody')).toBe(false);
  });

  it('counts a build nobody has read as the prototype it certainly is', () => {
    /* All three ways of saying "not asked". Allowing the split branch because a
       read had not come back would be the defect reached by a network hiccup. */
    expect(isPrototypeAccountBuild('unknown')).toBe(true);
    expect(isPrototypeAccountBuild(null)).toBe(true);
    expect(isPrototypeAccountBuild(undefined)).toBe(true);
  });
});

describe('the matrix', () => {
  it('pauses a partial shielded amount to an address, and nothing else', () => {
    /* Every combination, and the expectation derived from the rule as stated
       rather than from a copy of the implementation: shielded, to an address,
       from a prototype build, for less than is held. */
    const paused: string[] = [];
    for (const asset of ASSETS) {
      for (const recipient of RECIPIENTS) {
        for (const build of BUILDS) {
          for (const amount of [HELD, HELD - 1n]) {
            const refusal = ask({ asset, recipient, senderBuild: build, amount });
            const shouldPause =
              asset === 'shielded' &&
              recipient === 'address' &&
              build !== 'account-custody' &&
              amount < HELD;
            expect(
              refusal === null,
              `${asset} · ${recipient} · ${String(build)} · ${amount} of ${HELD}`,
            ).toBe(!shouldPause);
            if (refusal !== null) paused.push(`${asset}/${recipient}/${String(build)}/${amount}`);
          }
        }
      }
    }
    /* The count, so a rule that started pausing a second shape would fail here
       even if every assertion above had been softened. Four prototype builds
       (`account`, `account-v1`, `unknown`, absent), one partial amount each. */
    expect(paused).toHaveLength(4);
  });

  it('lets a whole shielded coin go to an address, on every prototype build', () => {
    for (const build of ['account', 'account-v1', 'unknown', null] as const) {
      expect(ask({ senderBuild: build, amount: HELD })).toBeNull();
    }
  });

  it('leaves NIGHT alone, whole or partial', () => {
    /* `withdraw_night` has no split branch and no coin to re-register. */
    expect(ask({ asset: 'night', amount: 1n })).toBeNull();
    expect(ask({ asset: 'night', amount: HELD })).toBeNull();
  });

  it('leaves the name and account routes alone, whole or partial', () => {
    for (const recipient of ['name', 'account'] as const) {
      expect(ask({ recipient, amount: 1n })).toBeNull();
      expect(ask({ recipient, amount: HELD })).toBeNull();
    }
  });

  it('says nothing about the build that fixes this', () => {
    expect(ask({ senderBuild: 'account-custody', amount: 1n })).toBeNull();
  });
});

describe('what the rule declines to decide', () => {
  it('is silent while there is no amount', () => {
    expect(ask({ amount: null })).toBeNull();
  });

  it('is silent over a nought, which is not a partial send of anything', () => {
    expect(ask({ amount: 0n })).toBeNull();
    expect(ask({ amount: -1n })).toBeNull();
  });

  it('is silent while the holding has not been read', () => {
    expect(ask({ held: null })).toBeNull();
  });

  it('leaves "more than you hold" to the sheet that already says it', () => {
    /* Two sentences over one field is how somebody is told to press Max and
       told the amount is too large at the same time. */
    expect(ask({ amount: HELD + 1n })).toBeNull();
  });
});

describe('the sentence', () => {
  it('names the asset, the control, and the route that still divides', () => {
    const said = ask({ amount: 1n });
    expect(said).toBe(
      'For now, sending to an address sends all of your mUSD — Max fills in the whole amount. To send part of it, send to a .night name.',
    );
  });

  it('falls back to a plain word where the caller has no ticker', () => {
    /* The backstop in `App.tsx` holds a colour, not a name. */
    expect(partialAddressSendRefusal()).toContain('all of your balance');
    expect(partialAddressSendRefusal(null)).toContain('all of your balance');
    expect(ask({ amount: 1n, symbol: null })).toContain('all of your balance');
    expect(ask({ amount: 1n, symbol: undefined })).toContain('all of your balance');
  });

  it('names no machinery', () => {
    /* The same rule the rest of the sheet keeps: what is paused is a send, not
       a subsystem, and none of these words is the reader's to act on. */
    const said = `${partialAddressSendRefusal('mUSD')} ${partialAddressSendRefusal()}`;
    for (const word of [
      'wallet address',
      'DUST',
      'contract',
      'registry',
      'indexer',
      'resolver',
      'sponsor',
      'SDK',
      'Dynamic',
      'withdraw_shielded',
      '239',
      'nullifier',
    ]) {
      expect(said.toLowerCase(), `the refusal names ${word}`).not.toContain(word.toLowerCase());
    }
  });
});
