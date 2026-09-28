/**
 * Coins the chain says are already spent, forgotten wherever the store holds
 * them (2026/09/26).
 *
 * A device that walks the inbox with an earlier key files the notes of coins
 * another device has already sent. `./custodySpentCoins.ts` asks the chain
 * which; these drill what the store then does — the coin leaves its slot, the
 * next one of its colour is promoted, and the nonce is remembered so the next
 * walk cannot file it again.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  enqueueK1Coin,
  forgetSpentK1Coins,
  heldK1Coin,
  isK1NonceSpent,
  k1ColourBalance,
  k1ColourHoldings,
  k1CoinCandidates,
  k1CountedCoins,
  putK1CoinCandidates,
  queuedK1Coins,
  type K1Account,
  type K1HeldCoin,
} from './k1CoinStore.js';

const STORAGE_KEY = 'passport-k1-coins:v1';
const ALICE: K1Account = { network: 'stagenet', address: 'ab'.repeat(32) };
const NIGHT = '0'.repeat(64);
const MUSD = '1a'.repeat(32);
const FIRST = '7f'.repeat(32);
const SECOND = '3e'.repeat(32);
const THIRD = '5c'.repeat(32);

function coin(nonce: string, value: bigint, colour = MUSD, mtIndex = 700n): K1HeldCoin {
  return { colour, nonce, value, mtIndex };
}

let storage: Map<string, string>;
let writes: number;

beforeEach(() => {
  storage = new Map<string, string>();
  writes = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          writes += 1;
          storage.set(key, value);
        },
        removeItem: (key: string) => void storage.delete(key),
      },
    },
  });
});

describe('the coins a Passport counts', () => {
  it('are every held coin and everything queued behind it, colour by colour', () => {
    enqueueK1Coin(ALICE, coin(FIRST, 40n));
    enqueueK1Coin(ALICE, coin(SECOND, 25n));
    enqueueK1Coin(ALICE, coin(THIRD, 9n, NIGHT, 3n));
    expect(k1CountedCoins(ALICE)).toEqual([coin(THIRD, 9n, NIGHT, 3n), coin(FIRST, 40n), coin(SECOND, 25n)]);
    expect(k1CountedCoins({ network: 'stagenet', address: 'cd'.repeat(32) })).toEqual([]);
  });

  it('include a queue whose held slot a spend has emptied', () => {
    storage.set(
      STORAGE_KEY,
      JSON.stringify({
        [`stagenet::${ALICE.address}`]: {
          encSecretKeyHex: null,
          coins: {},
          queued: { [MUSD]: [{ nonceHex: SECOND, colorHex: MUSD, value: '25', mtIndex: '702' }] },
          spentNonces: [],
          mtIndexCandidates: {},
          awaiting: {},
        },
      }),
    );
    expect(k1CountedCoins(ALICE)).toEqual([coin(SECOND, 25n, MUSD, 702n)]);
  });
});

describe('forgetting a coin the chain says is spent', () => {
  it('takes the held coin out, promotes the next with its own guesses, and remembers the nonce', () => {
    putK1CoinCandidates(ALICE, { colour: MUSD, nonce: FIRST, value: 40n }, [700n, 701n]);
    enqueueK1Coin(ALICE, coin(SECOND, 25n, MUSD, 702n), [702n, 703n]);

    expect(forgetSpentK1Coins(ALICE, [FIRST.toUpperCase()])).toEqual([coin(FIRST, 40n)]);

    expect(heldK1Coin(ALICE, MUSD)).toEqual(coin(SECOND, 25n, MUSD, 702n));
    expect(k1CoinCandidates(ALICE, MUSD)).toEqual([702n, 703n]);
    expect(queuedK1Coins(ALICE, MUSD)).toEqual([]);
    expect(k1ColourBalance(ALICE, MUSD)).toBe(25n);
    expect(isK1NonceSpent(ALICE, FIRST)).toBe(true);
    /* A walk that meets the note again files nothing. */
    expect(enqueueK1Coin(ALICE, coin(FIRST, 40n))).toBe('spent');
  });

  it('takes a queued coin out and leaves the held one and the rest of the queue', () => {
    enqueueK1Coin(ALICE, coin(FIRST, 40n));
    enqueueK1Coin(ALICE, coin(SECOND, 25n));
    enqueueK1Coin(ALICE, coin(THIRD, 5n));

    expect(forgetSpentK1Coins(ALICE, [SECOND])).toEqual([coin(SECOND, 25n)]);

    expect(heldK1Coin(ALICE, MUSD)?.nonce).toBe(FIRST);
    expect(queuedK1Coins(ALICE, MUSD).map((row) => row.nonce)).toEqual([THIRD]);
    expect(k1ColourBalance(ALICE, MUSD)).toBe(45n);
  });

  it('can take every coin of a colour, and the colour stops being counted', () => {
    enqueueK1Coin(ALICE, coin(FIRST, 40n));
    enqueueK1Coin(ALICE, coin(SECOND, 25n));
    enqueueK1Coin(ALICE, coin(THIRD, 9n, NIGHT, 3n));

    expect(forgetSpentK1Coins(ALICE, [SECOND, FIRST]).map((row) => row.nonce)).toEqual([FIRST, SECOND]);

    expect(k1ColourHoldings(ALICE)).toEqual([{ colour: NIGHT, value: 9n }]);
    expect(isK1NonceSpent(ALICE, FIRST) && isK1NonceSpent(ALICE, SECOND)).toBe(true);
  });

  it('takes a coin out of a queue whose held slot is empty', () => {
    storage.set(
      STORAGE_KEY,
      JSON.stringify({
        [`stagenet::${ALICE.address}`]: {
          encSecretKeyHex: null,
          coins: {},
          queued: {
            [MUSD]: [
              { nonceHex: FIRST, colorHex: MUSD, value: '40', mtIndex: '700' },
              { nonceHex: SECOND, colorHex: MUSD, value: '25', mtIndex: '702' },
            ],
          },
          spentNonces: [],
          mtIndexCandidates: {},
          awaiting: {},
        },
      }),
    );
    expect(forgetSpentK1Coins(ALICE, [FIRST])).toEqual([coin(FIRST, 40n)]);
    /* And the one left is promoted, so it can be spent. */
    expect(heldK1Coin(ALICE, MUSD)).toEqual(coin(SECOND, 25n, MUSD, 702n));
  });

  it('writes nothing for a nonce it does not hold, or one that is not a nonce', () => {
    enqueueK1Coin(ALICE, coin(FIRST, 40n));
    const before = writes;
    expect(forgetSpentK1Coins(ALICE, [SECOND, 'not a nonce', ''])).toEqual([]);
    expect(forgetSpentK1Coins(ALICE, [])).toEqual([]);
    expect(writes).toBe(before);
    expect(heldK1Coin(ALICE, MUSD)?.nonce).toBe(FIRST);
    expect(isK1NonceSpent(ALICE, SECOND)).toBe(false);
  });

  it('refuses an account that is not one', () => {
    expect(() => forgetSpentK1Coins({ network: 'stagenet', address: 'nope' }, [FIRST])).toThrow();
  });
});
