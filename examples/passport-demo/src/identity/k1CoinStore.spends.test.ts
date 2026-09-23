/**
 * Booked spends, and the chain's answer to each (2026/09/22).
 *
 * The defect these drill: a payment booked at submission and never recorded by
 * the chain left the store saying its coin was spent — the balance read nought
 * and "Arriving" for a change coin that never existed, for good. Every state a
 * spend can leave behind, and every rule that answers it from the chain, is
 * here.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  adoptK1PendingSpend,
  awaitingK1Coins,
  enqueueK1Coin,
  heldK1Coin,
  isK1NonceSpent,
  k1AccountKey,
  k1ColourBalance,
  landK1Spend,
  loadK1CoinStore,
  pendingK1Spends,
  putK1Coin,
  queuedK1Coins,
  reconcileK1Spends,
  rememberK1ChangeCoin,
  undoK1ChangeCoin,
  undoneK1Spends,
  type K1Account,
  type K1HeldCoin,
  type K1SpendReconcileOptions,
} from './k1CoinStore.js';

const STORAGE_KEY = 'passport-k1-coins:v1';
const ALICE: K1Account = { network: 'stagenet', address: 'ab'.repeat(32) };
const MUSD = '1a'.repeat(32);
const NONCE = '7f'.repeat(32);
const SECOND = '3e'.repeat(32);
const CHANGE = 'c4'.repeat(32);
/** midnight-js's identifier: 33 bytes, which the indexer answers only as an identifier. */
const TX = `00${'d1'.repeat(32)}`;
const TX2 = `00${'d2'.repeat(32)}`;
const HASH = 'e5'.repeat(32);
const T0 = 1_790_000_000_000;
const BOUND = 180_000;
const KEEP = 3_600_000;

let storage: Map<string, string>;

beforeEach(() => {
  storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
      },
    },
  });
});

function held(patch: Partial<K1HeldCoin> = {}): K1HeldCoin {
  return { colour: MUSD, nonce: NONCE, value: 100n, mtIndex: 4139n, ...patch };
}

/** Alice holds 100 mUSD and sends 10 of it: the store as a submit leaves it. */
function bookSpend(txId = TX, at = T0): void {
  putK1Coin(ALICE, held());
  rememberK1ChangeCoin(ALICE, MUSD, { colour: MUSD, nonce: CHANGE, value: 90n }, txId, at);
}

function options(
  answers: Record<string, boolean | null | 'throw'>,
  patch: Partial<K1SpendReconcileOptions> = {},
): K1SpendReconcileOptions {
  return {
    onChain: (txId) => {
      const answer = Object.hasOwn(answers, txId) ? answers[txId] : null;
      if (answer === 'throw') return Promise.reject(new Error('the indexer is down'));
      return Promise.resolve(answer);
    },
    now: T0 + BOUND,
    boundMs: BOUND,
    keepUndoneMs: KEEP,
    ...patch,
  };
}

describe('a spend is booked in the same write as what it books', () => {
  it('names the transaction, when, the coin it consumed, and the change it filed', () => {
    bookSpend();
    expect(pendingK1Spends(ALICE)).toEqual([
      {
        txId: TX,
        at: T0,
        parent: { nonceHex: NONCE, colorHex: MUSD, value: '100', mtIndex: '4139' },
        change: { nonceHex: CHANGE, colorHex: MUSD, value: '90' },
      },
    ]);
    expect(heldK1Coin(ALICE, MUSD)).toBeNull();
    expect(awaitingK1Coins(ALICE)).toHaveLength(1);
  });

  it('books an exact spend with no change, and books nothing when nothing was held', () => {
    putK1Coin(ALICE, held());
    rememberK1ChangeCoin(ALICE, MUSD, null, TX, T0);
    expect(pendingK1Spends(ALICE)[0].change).toBeNull();
    rememberK1ChangeCoin(ALICE, MUSD, null, TX2, T0);
    expect(pendingK1Spends(ALICE).map((row) => row.txId)).toEqual([TX]);
  });

  it('keeps one booking per transaction, the latest', () => {
    putK1Coin(ALICE, held());
    rememberK1ChangeCoin(ALICE, MUSD, null, TX, T0);
    putK1Coin(ALICE, held({ nonce: SECOND }));
    rememberK1ChangeCoin(ALICE, MUSD, null, TX, T0 + 5);
    expect(pendingK1Spends(ALICE)).toHaveLength(1);
    expect(pendingK1Spends(ALICE)[0].parent.nonceHex).toBe(SECOND);
  });

  it('stamps the booking with the clock when no time is given', () => {
    putK1Coin(ALICE, held());
    rememberK1ChangeCoin(ALICE, MUSD, null, TX);
    expect(pendingK1Spends(ALICE)[0].at).toBeGreaterThan(T0);
  });
});

describe('taking a booking back', () => {
  it('drops the booking with what it booked, and keeps nothing aside for a refused transaction', () => {
    bookSpend();
    undoK1ChangeCoin(ALICE, held(), { colour: MUSD, nonce: CHANGE });
    expect(heldK1Coin(ALICE, MUSD)?.value).toBe(100n);
    expect(pendingK1Spends(ALICE)).toEqual([]);
    expect(undoneK1Spends(ALICE)).toEqual([]);
    expect(awaitingK1Coins(ALICE)).toEqual([]);
    expect(isK1NonceSpent(ALICE, NONCE)).toBe(false);
  });

  it('sets the booking aside when the transaction may still land, stamped when it was taken back', () => {
    bookSpend();
    undoK1ChangeCoin(ALICE, held(), { colour: MUSD, nonce: CHANGE }, { mayStillLand: true, now: T0 + 9 });
    expect(undoneK1Spends(ALICE)).toEqual([expect.objectContaining({ txId: TX, at: T0 + 9 })]);
  });

  it('keeps the booking’s own time when no clock is given', () => {
    bookSpend();
    undoK1ChangeCoin(ALICE, held(), { colour: MUSD, nonce: CHANGE }, { mayStillLand: true });
    expect(undoneK1Spends(ALICE)[0].at).toBe(T0);
  });

  it('is harmless the second time: the coin is not queued behind itself', () => {
    bookSpend();
    undoK1ChangeCoin(ALICE, held(), { colour: MUSD, nonce: CHANGE });
    undoK1ChangeCoin(ALICE, held(), { colour: MUSD, nonce: CHANGE });
    expect(heldK1Coin(ALICE, MUSD)?.nonce).toBe(NONCE);
    expect(queuedK1Coins(ALICE, MUSD)).toEqual([]);
    expect(k1ColourBalance(ALICE, MUSD)).toBe(100n);
  });

  it('takes the restored coin out of the queue if a walk filed it there meanwhile', () => {
    putK1Coin(ALICE, held({ nonce: SECOND, value: 5n }));
    enqueueK1Coin(ALICE, held());
    enqueueK1Coin(ALICE, held({ nonce: CHANGE, value: 7n }));
    undoK1ChangeCoin(ALICE, held(), null);
    expect(heldK1Coin(ALICE, MUSD)?.nonce).toBe(NONCE);
    expect(queuedK1Coins(ALICE, MUSD).map((coin) => coin.nonce)).toEqual([SECOND, CHANGE]);
  });

  it('drops the queue key when the restored coin was the only thing in it', () => {
    putK1Coin(ALICE, held({ nonce: SECOND }));
    enqueueK1Coin(ALICE, held());
    undoK1ChangeCoin(ALICE, held({ nonce: SECOND }), null);
    undoK1ChangeCoin(ALICE, held(), null);
    expect(heldK1Coin(ALICE, MUSD)?.nonce).toBe(NONCE);
    expect(queuedK1Coins(ALICE, MUSD).map((coin) => coin.nonce)).toEqual([SECOND]);
  });
});

describe('a restored coin found only in the queue', () => {
  it('leaves the queue, and the queue key goes with it', () => {
    storage.set(
      STORAGE_KEY,
      JSON.stringify({
        [k1AccountKey(ALICE)]: {
          coins: {},
          queued: { [MUSD]: [{ nonceHex: NONCE, colorHex: MUSD, value: '100', mtIndex: '4139' }] },
        },
      }),
    );
    undoK1ChangeCoin(ALICE, held(), null);
    expect(heldK1Coin(ALICE, MUSD)?.nonce).toBe(NONCE);
    expect(loadK1CoinStore(ALICE).queued).toEqual({});
  });
});

describe('a spend the chain has recorded', () => {
  it('is landed: the booking goes, and so does anything set aside under it', () => {
    bookSpend();
    undoK1ChangeCoin(ALICE, held(), { colour: MUSD, nonce: CHANGE }, { mayStillLand: true });
    bookSpend(TX2);
    landK1Spend(ALICE, TX);
    landK1Spend(ALICE, TX2);
    expect(pendingK1Spends(ALICE)).toEqual([]);
    expect(undoneK1Spends(ALICE)).toEqual([]);
    expect(awaitingK1Coins(ALICE)).toHaveLength(1);
  });
});

describe('adopting a booking the screen kept', () => {
  const booking = {
    txId: TX,
    at: T0,
    parent: held(),
    change: { colour: MUSD, nonce: CHANGE },
  };

  function legacySpend(): void {
    bookSpend();
    /* An older build: the store booked nothing. */
    const all = JSON.parse(storage.get(STORAGE_KEY) as string) as Record<string, Record<string, unknown>>;
    all[k1AccountKey(ALICE)].pendingSpends = [];
    storage.set(STORAGE_KEY, JSON.stringify(all));
  }

  it('takes it on while it is still true of the store', () => {
    legacySpend();
    adoptK1PendingSpend(ALICE, booking);
    expect(pendingK1Spends(ALICE)).toEqual([
      expect.objectContaining({ txId: TX, change: { nonceHex: CHANGE, colorHex: MUSD, value: '90' } }),
    ]);
  });

  it('takes on an exact spend with no change', () => {
    legacySpend();
    adoptK1PendingSpend(ALICE, { ...booking, change: null });
    expect(pendingK1Spends(ALICE)[0].change).toBeNull();
  });

  it('changes nothing when the store already has it, pending or set aside', () => {
    bookSpend();
    adoptK1PendingSpend(ALICE, booking);
    expect(pendingK1Spends(ALICE)).toHaveLength(1);
    undoK1ChangeCoin(ALICE, held(), { colour: MUSD, nonce: CHANGE }, { mayStillLand: true });
    rememberK1ChangeCoin(ALICE, MUSD, { colour: MUSD, nonce: CHANGE, value: 90n }, TX2, T0);
    landK1Spend(ALICE, TX2);
    adoptK1PendingSpend(ALICE, booking);
    expect(pendingK1Spends(ALICE)).toEqual([]);
  });

  it('changes nothing once the coin is no longer spent, or is held again', () => {
    putK1Coin(ALICE, held());
    adoptK1PendingSpend(ALICE, booking);
    expect(pendingK1Spends(ALICE)).toEqual([]);
    legacySpend();
    const all = JSON.parse(storage.get(STORAGE_KEY) as string) as Record<string, Record<string, unknown>>;
    all[k1AccountKey(ALICE)].coins = {
      [MUSD]: { nonceHex: NONCE, colorHex: MUSD, value: '100', mtIndex: '4139' },
    };
    storage.set(STORAGE_KEY, JSON.stringify(all));
    adoptK1PendingSpend(ALICE, booking);
    expect(pendingK1Spends(ALICE)).toEqual([]);
  });

  it('changes nothing when the change it names is no longer waiting', () => {
    legacySpend();
    adoptK1PendingSpend(ALICE, { ...booking, change: { colour: MUSD, nonce: SECOND } });
    adoptK1PendingSpend(ALICE, { ...booking, change: { colour: '2b'.repeat(32), nonce: CHANGE } });
    expect(pendingK1Spends(ALICE)).toEqual([]);
  });

  it('refuses a booking with no transaction or no time', () => {
    expect(() => adoptK1PendingSpend(ALICE, { ...booking, txId: '  ' })).toThrow(/transaction/);
    expect(() => adoptK1PendingSpend(ALICE, { ...booking, at: Number.NaN })).toThrow(/transaction/);
    expect(() =>
      adoptK1PendingSpend(ALICE, { ...booking, txId: 7 as unknown as string }),
    ).toThrow(/transaction/);
  });
});

describe('reconcileK1Spends — the store made to agree with the chain', () => {
  it('rule 1: a booking the chain holds has landed, and its change stays to be placed', async () => {
    bookSpend();
    const result = await reconcileK1Spends(ALICE, options({ [TX]: true }));
    expect(result.landed).toEqual([TX]);
    expect(pendingK1Spends(ALICE)).toEqual([]);
    expect(awaitingK1Coins(ALICE)).toHaveLength(1);
    expect(isK1NonceSpent(ALICE, NONCE)).toBe(true);
  });

  it('rule 2: a booking the chain has not recorded past the bound is taken back and set aside', async () => {
    bookSpend();
    const result = await reconcileK1Spends(ALICE, options({ [TX]: false }));
    expect(result.undone).toEqual([TX]);
    expect(heldK1Coin(ALICE, MUSD)).toEqual(held());
    expect(awaitingK1Coins(ALICE)).toEqual([]);
    expect(isK1NonceSpent(ALICE, NONCE)).toBe(false);
    expect(undoneK1Spends(ALICE)).toEqual([expect.objectContaining({ txId: TX, at: T0 + BOUND })]);
  });

  it('rule 2 again: an exact spend is taken back the same way', async () => {
    putK1Coin(ALICE, held());
    rememberK1ChangeCoin(ALICE, MUSD, null, TX, T0);
    await reconcileK1Spends(ALICE, options({ [TX]: false }));
    expect(heldK1Coin(ALICE, MUSD)).toEqual(held());
  });

  it('leaves a booking alone inside the bound, and when the chain cannot be asked', async () => {
    bookSpend();
    const early = await reconcileK1Spends(ALICE, options({ [TX]: false }, { now: T0 + BOUND - 1 }));
    const unknown = await reconcileK1Spends(ALICE, options({ [TX]: null }));
    const failing = await reconcileK1Spends(ALICE, options({ [TX]: 'throw' }));
    for (const result of [early, unknown, failing]) {
      expect(result).toEqual({
        landed: [],
        undone: [],
        reapplied: [],
        expired: [],
        orphansDropped: [],
        noncesRestored: 0,
      });
    }
    expect(pendingK1Spends(ALICE)).toHaveLength(1);
  });

  it('rule 3: a spend set aside that lands after all is put back', async () => {
    bookSpend();
    await reconcileK1Spends(ALICE, options({ [TX]: false }));
    const result = await reconcileK1Spends(ALICE, options({ [TX]: true }));
    expect(result.reapplied).toEqual([TX]);
    expect(heldK1Coin(ALICE, MUSD)).toBeNull();
    expect(isK1NonceSpent(ALICE, NONCE)).toBe(true);
    expect(awaitingK1Coins(ALICE)).toEqual([
      { colour: MUSD, nonce: CHANGE, value: 90n, txId: TX },
    ]);
    expect(undoneK1Spends(ALICE)).toEqual([]);
  });

  it('rule 3, exact spend: the next queued coin is promoted when it is put back', async () => {
    putK1Coin(ALICE, held());
    enqueueK1Coin(ALICE, held({ nonce: SECOND, value: 5n }));
    rememberK1ChangeCoin(ALICE, MUSD, null, TX, T0);
    expect(heldK1Coin(ALICE, MUSD)?.nonce).toBe(SECOND);
    await reconcileK1Spends(ALICE, options({ [TX]: false }));
    expect(heldK1Coin(ALICE, MUSD)?.nonce).toBe(NONCE);
    expect(queuedK1Coins(ALICE, MUSD).map((coin) => coin.nonce)).toEqual([SECOND]);
    await reconcileK1Spends(ALICE, options({ [TX]: true }));
    expect(heldK1Coin(ALICE, MUSD)?.nonce).toBe(SECOND);
    expect(queuedK1Coins(ALICE, MUSD)).toEqual([]);
  });

  it('rule 3: a coin put back into the queue is taken out of it, leaving the rest', async () => {
    putK1Coin(ALICE, held());
    rememberK1ChangeCoin(ALICE, MUSD, null, TX, T0);
    await reconcileK1Spends(ALICE, options({ [TX]: false }));
    /* A delivery arrived meanwhile and the restored coin was queued behind it. */
    const all = JSON.parse(storage.get(STORAGE_KEY) as string) as Record<string, Record<string, unknown>>;
    all[k1AccountKey(ALICE)].coins = {
      [MUSD]: { nonceHex: SECOND, colorHex: MUSD, value: '5', mtIndex: '1' },
    };
    all[k1AccountKey(ALICE)].queued = {
      [MUSD]: [
        { nonceHex: NONCE, colorHex: MUSD, value: '100', mtIndex: '4139' },
        { nonceHex: CHANGE, colorHex: MUSD, value: '3', mtIndex: '2' },
      ],
    };
    storage.set(STORAGE_KEY, JSON.stringify(all));
    await reconcileK1Spends(ALICE, options({ [TX]: true }));
    expect(heldK1Coin(ALICE, MUSD)?.nonce).toBe(SECOND);
    expect(queuedK1Coins(ALICE, MUSD).map((coin) => coin.nonce)).toEqual([CHANGE]);
  });

  it('rule 3: a queue holding only the put-back coin loses its key', async () => {
    putK1Coin(ALICE, held());
    rememberK1ChangeCoin(ALICE, MUSD, null, TX, T0);
    await reconcileK1Spends(ALICE, options({ [TX]: false }));
    const all = JSON.parse(storage.get(STORAGE_KEY) as string) as Record<string, Record<string, unknown>>;
    all[k1AccountKey(ALICE)].coins = {
      [MUSD]: { nonceHex: SECOND, colorHex: MUSD, value: '5', mtIndex: '1' },
    };
    all[k1AccountKey(ALICE)].queued = {
      [MUSD]: [{ nonceHex: NONCE, colorHex: MUSD, value: '100', mtIndex: '4139' }],
    };
    storage.set(STORAGE_KEY, JSON.stringify(all));
    await reconcileK1Spends(ALICE, options({ [TX]: true }));
    expect(loadK1CoinStore(ALICE).queued).toEqual({});
  });

  it('rule 3: a spend set aside is forgotten once nothing could still be carrying it, and kept until then', async () => {
    bookSpend();
    await reconcileK1Spends(ALICE, options({ [TX]: false }));
    const kept = await reconcileK1Spends(ALICE, options({ [TX]: false }, { now: T0 + BOUND + 10 }));
    expect(kept.expired).toEqual([]);
    expect(undoneK1Spends(ALICE)).toHaveLength(1);
    const later = await reconcileK1Spends(ALICE, options({ [TX]: true }, { now: T0 + BOUND + KEEP }));
    expect(later.expired).toEqual([TX]);
    expect(later.reapplied).toEqual([]);
    expect(undoneK1Spends(ALICE)).toEqual([]);
    expect(heldK1Coin(ALICE, MUSD)).toEqual(held());
  });

  it('writes nothing for a booking that went away while the chain was being asked', async () => {
    bookSpend();
    const result = await reconcileK1Spends(ALICE, {
      ...options({}),
      onChain: (txId) => {
        landK1Spend(ALICE, txId);
        return Promise.resolve(false);
      },
    });
    expect(result.undone).toEqual([TX]);
    expect(isK1NonceSpent(ALICE, NONCE)).toBe(true);
    bookSpend(TX2);
    await reconcileK1Spends(ALICE, options({ [TX2]: false }));
    const again = await reconcileK1Spends(ALICE, {
      ...options({}),
      onChain: (txId) => {
        landK1Spend(ALICE, txId);
        return Promise.resolve(true);
      },
    });
    expect(again.reapplied).toEqual([TX2]);
    expect(heldK1Coin(ALICE, MUSD)?.nonce).toBe(NONCE);
  });

  describe('rule 4: change waiting under a spend no booking names', () => {
    /** `nagger.night`, live 2026/09/22: nought, "Arriving", and no booking. */
    function orphan(extraSpent: string[] = []): void {
      storage.set(
        STORAGE_KEY,
        JSON.stringify({
          [k1AccountKey(ALICE)]: {
            encSecretKeyHex: null,
            coins: {},
            queued: {},
            spentNonces: [...extraSpent, NONCE],
            mtIndexCandidates: {},
            awaiting: {
              [MUSD]: [
                { nonceHex: CHANGE, colorHex: MUSD, value: '90', txId: TX },
                { nonceHex: SECOND, colorHex: MUSD, value: '3', txId: HASH },
              ],
            },
            unreadChange: {},
          },
        }),
      );
    }

    it('is dropped, and the spent coin given back, when the chain holds fewer spends than the store', async () => {
      orphan();
      const result = await reconcileK1Spends(
        ALICE,
        options({ [TX]: false }, { landedSpendCount: () => Promise.resolve(0) }),
      );
      expect(result.orphansDropped).toEqual([TX]);
      expect(result.noncesRestored).toBe(1);
      expect(awaitingK1Coins(ALICE).map((coin) => coin.txId)).toEqual([HASH]);
      expect(isK1NonceSpent(ALICE, NONCE)).toBe(false);
    });

    it('gives back no more than the chain’s count allows', async () => {
      orphan([SECOND]);
      const result = await reconcileK1Spends(
        ALICE,
        options({ [TX]: false }, { landedSpendCount: () => Promise.resolve(2) }),
      );
      expect(result.orphansDropped).toEqual([TX]);
      expect(result.noncesRestored).toBe(0);
      expect(isK1NonceSpent(ALICE, NONCE)).toBe(true);
    });

    it('does nothing when the chain cannot count, cannot be asked, or is not asked', async () => {
      for (const landedSpendCount of [
        () => Promise.resolve(null),
        () => Promise.reject(new Error('down')),
        () => Promise.resolve(-1),
        () => Promise.resolve(1.5),
        undefined,
      ]) {
        orphan();
        const result = await reconcileK1Spends(
          ALICE,
          options({ [TX]: false }, landedSpendCount === undefined ? {} : { landedSpendCount }),
        );
        expect(result.orphansDropped).toEqual([]);
        expect(awaitingK1Coins(ALICE)).toHaveLength(2);
      }
    });

    it('leaves a row the chain holds, or one it could not say about', async () => {
      orphan();
      const count = { landedSpendCount: () => Promise.resolve(0) };
      expect((await reconcileK1Spends(ALICE, options({ [TX]: true }, count))).orphansDropped).toEqual([]);
      expect((await reconcileK1Spends(ALICE, options({ [TX]: null }, count))).orphansDropped).toEqual([]);
      expect(awaitingK1Coins(ALICE)).toHaveLength(2);
    });

    it('never gives back from a spent list that has forgotten its oldest entries', async () => {
      const full = Array.from({ length: 255 }, (_, index) => index.toString(16).padStart(64, '0'));
      orphan(full);
      const result = await reconcileK1Spends(
        ALICE,
        options({ [TX]: false }, { landedSpendCount: () => Promise.resolve(0) }),
      );
      expect(result.orphansDropped).toEqual([TX]);
      expect(result.noncesRestored).toBe(0);
    });

    it('is not rule 4 when a booking names the change', async () => {
      bookSpend();
      const result = await reconcileK1Spends(
        ALICE,
        options({ [TX]: null }, { landedSpendCount: () => Promise.resolve(0) }),
      );
      expect(result.orphansDropped).toEqual([]);
    });
  });
});

describe('a stored booking that is not one', () => {
  it('is dropped rather than repaired, row by row', () => {
    const parent = { nonceHex: NONCE, colorHex: MUSD, value: '100', mtIndex: '4139' };
    storage.set(
      STORAGE_KEY,
      JSON.stringify({
        [k1AccountKey(ALICE)]: {
          coins: {},
          pendingSpends: [
            null,
            'nonsense',
            { txId: '', at: T0, parent, change: null },
            { txId: 42, at: T0, parent, change: null },
            { txId: TX, at: 'then', parent, change: null },
            { txId: TX, at: Number.POSITIVE_INFINITY, parent, change: null },
            { txId: TX, at: T0, parent: { nonceHex: 'zz' }, change: null },
            { txId: TX, at: T0, parent, change: { nonceHex: 'zz', colorHex: MUSD, value: '1' } },
            { txId: TX, at: T0, parent },
            { txId: TX, at: T0, parent, change: null },
            { txId: TX2, at: T0, parent, change: { nonceHex: CHANGE, colorHex: MUSD, value: '90' } },
          ],
          undoneSpends: 'not a list',
        },
      }),
    );
    expect(pendingK1Spends(ALICE)).toEqual([
      { txId: TX, at: T0, parent, change: null },
      { txId: TX2, at: T0, parent, change: { nonceHex: CHANGE, colorHex: MUSD, value: '90' } },
    ]);
    expect(undoneK1Spends(ALICE)).toEqual([]);
  });
});

describe('a coin taken back after a spend that promoted a queued coin with guesses (#82 with #84)', () => {
  it('sends the promoted coin back to the queue with its guesses, and clears the slot’s list', async () => {
    const store = await import('./k1CoinStore.js');
    putK1Coin(ALICE, held());
    /* A delivery queued behind it, whose place is one of two. */
    storage.set(
      STORAGE_KEY,
      JSON.stringify({
        ...JSON.parse(storage.get(STORAGE_KEY) as string),
      }),
    );
    const all = JSON.parse(storage.get(STORAGE_KEY) as string) as Record<string, Record<string, unknown>>;
    all[k1AccountKey(ALICE)].queued = {
      [MUSD]: [{ nonceHex: SECOND, colorHex: MUSD, value: '10', mtIndex: '7', mtIndexCandidates: ['7', '8'] }],
    };
    storage.set(STORAGE_KEY, JSON.stringify(all));
    rememberK1ChangeCoin(ALICE, MUSD, null, TX, T0);
    expect(heldK1Coin(ALICE, MUSD)?.nonce).toBe(SECOND);
    expect(store.k1CoinCandidates(ALICE, MUSD)).toEqual([7n, 8n]);
    undoK1ChangeCoin(ALICE, held(), null);
    expect(heldK1Coin(ALICE, MUSD)).toEqual(held());
    expect(store.k1CoinCandidates(ALICE, MUSD)).toEqual([]);
    expect(loadK1CoinStore(ALICE).queued[MUSD]).toEqual([
      { nonceHex: SECOND, colorHex: MUSD, value: '10', mtIndex: '7', mtIndexCandidates: ['7', '8'] },
    ]);
  });

  it('has nothing to widen when nothing is held', async () => {
    const store = await import('./k1CoinStore.js');
    expect(store.widenK1CoinCandidates(ALICE, MUSD)).toBeNull();
  });
});
