/**
 * The k1 coin store, held to the one thing it exists for: a coin learned once
 * is still spendable after the browser has been closed and the connection
 * remade.
 *
 * Every statement in `./k1CoinStore.ts`'s header is executable, and this is it
 * executed. The expensive failure the module is written against is not a
 * crash — it is a qualified description quietly going missing, because the
 * chain does not carry one and nothing can reconstruct it afterwards. So the
 * drills below are mostly about what SURVIVES: a reload, a second account in
 * the same browser, a spend that leaves change, and a storage blob somebody
 * else's build wrote.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  advanceK1CoinCandidate,
  awaitingK1Coins,
  enqueueK1Coin,
  forgetK1Account,
  heldK1Coin,
  isK1NonceSpent,
  k1AccountKey,
  k1AwaitingTxNeedsChainHash,
  k1CoinCandidates,
  k1ColourBalance,
  k1PrivateStateId,
  k1PrivateStateProvider,
  listK1Coins,
  loadK1CoinStore,
  putK1Coin,
  putK1CoinCandidates,
  queuedK1Coins,
  k1UnreadChanges,
  renameK1AwaitingTx,
  dropK1Coin,
  reconcileK1CoinFromChain,
  refuseK1Account,
  refuseK1Coin,
  rememberK1EncSecretKey,
  rememberK1ChangeCoin,
  replaceK1Coin,
  settleK1AwaitingCoin,
  settleK1AwaitingCoinByChainHash,
  settleK1Coin,
  type K1Account,
  type K1CommitmentWindow,
  type K1CommitmentWindowReader,
  type K1HeldCoin,
} from './k1CoinStore.js';

const STORAGE_KEY = 'passport-k1-coins:v1';

const ALICE: K1Account = { network: 'stagenet', address: 'ab'.repeat(32) };
const BOB: K1Account = { network: 'stagenet', address: 'cd'.repeat(32) };
const ALICE_ON_PREVIEW: K1Account = { network: 'preview', address: 'ab'.repeat(32) };

const NIGHT = '0'.repeat(64);
const MUSD = '1a'.repeat(32);
const NONCE = '7f'.repeat(32);
const OTHER_NONCE = '3e'.repeat(32);

/** The whole private state of an account that holds nothing. */
const EMPTY_STORE = {
  encSecretKeyHex: null,
  coins: {},
  queued: {},
  spentNonces: [],
  mtIndexCandidates: {},
  awaiting: {},
  unreadChange: {},
};

function coin(patch: Partial<K1HeldCoin> = {}): K1HeldCoin {
  return { colour: NIGHT, nonce: NONCE, value: 100n, mtIndex: 42n, ...patch };
}

/** The smallest thing that behaves like `window.localStorage`, and its backing map. */
let storage: Map<string, string>;

function installStorage(behaviour: { denyWrites?: boolean; denyReads?: boolean } = {}): void {
  storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => {
          if (behaviour.denyReads) throw new Error('storage denied');
          return storage.get(key) ?? null;
        },
        setItem: (key: string, value: string) => {
          if (behaviour.denyWrites) throw new Error('storage denied');
          storage.set(key, value);
        },
        removeItem: (key: string) => void storage.delete(key),
      },
    },
  });
}

/** What another build, or a corrupted profile, might have left behind. */
function seed(raw: unknown): void {
  storage.set(STORAGE_KEY, typeof raw === 'string' ? raw : JSON.stringify(raw));
}

beforeEach(() => {
  installStorage();
});

/* -------------------------------------------------------------------------- */

describe('a coin survives the thing that loses it today', () => {
  it('is read back whole after the store has been written and re-read', () => {
    putK1Coin(ALICE, coin());
    /* A fresh read of the same storage IS the reload: nothing in the module
       holds state between calls, so a second read is a second session. */
    expect(heldK1Coin(ALICE, NIGHT)).toEqual({
      colour: NIGHT,
      nonce: NONCE,
      value: 100n,
      mtIndex: 42n,
    });
  });

  it('keeps the value and the position as strings, so neither is lost to JSON', () => {
    putK1Coin(ALICE, coin({ value: 2n ** 70n, mtIndex: 9007199254740993n }));
    const written = JSON.parse(storage.get(STORAGE_KEY)!) as Record<string, unknown>;
    expect(written[k1AccountKey(ALICE)]).toEqual({
      encSecretKeyHex: null,
      coins: {
        [NIGHT]: {
          nonceHex: NONCE,
          colorHex: NIGHT,
          value: '1180591620717411303424',
          mtIndex: '9007199254740993',
        },
      },
      queued: {},
      spentNonces: [],
      mtIndexCandidates: {},
      awaiting: {},
      unreadChange: {},
    });
    expect(heldK1Coin(ALICE, NIGHT)?.value).toBe(2n ** 70n);
    expect(heldK1Coin(ALICE, NIGHT)?.mtIndex).toBe(9007199254740993n);
  });

  it('holds one coin per colour, because `held_coin(color)` can name only one', () => {
    putK1Coin(ALICE, coin({ value: 100n }));
    putK1Coin(ALICE, coin({ value: 250n, nonce: OTHER_NONCE, mtIndex: 43n }));
    expect(listK1Coins(ALICE)).toEqual([
      { colour: NIGHT, nonce: OTHER_NONCE, value: 250n, mtIndex: 43n },
    ]);
  });

  it('lists coins in colour order, whatever order they were learned in', () => {
    const LAST = 'ff'.repeat(32);
    putK1Coin(ALICE, coin({ colour: MUSD, value: 7n }));
    putK1Coin(ALICE, coin({ colour: NIGHT, value: 9n }));
    putK1Coin(ALICE, coin({ colour: LAST, value: 11n }));
    expect(listK1Coins(ALICE).map((held) => held.colour)).toEqual([NIGHT, MUSD, LAST]);
  });

  it('normalises the colour, the nonce, and the address it is asked about', () => {
    putK1Coin(
      { network: 'stagenet', address: `0x${'AB'.repeat(32)}` },
      coin({ colour: `0X${'0'.repeat(64)}`, nonce: NONCE.toUpperCase() }),
    );
    expect(heldK1Coin(ALICE, `0x${NIGHT}`)).toEqual(coin());
  });

  it('forgets a colour on request, and says nothing when there was none', () => {
    putK1Coin(ALICE, coin());
    dropK1Coin(ALICE, MUSD);
    expect(heldK1Coin(ALICE, NIGHT)).not.toBeNull();
    dropK1Coin(ALICE, NIGHT);
    expect(heldK1Coin(ALICE, NIGHT)).toBeNull();
    expect(listK1Coins(ALICE)).toEqual([]);
  });

  it('forgets a whole account on request, and says nothing when there was none', () => {
    putK1Coin(ALICE, coin());
    putK1Coin(BOB, coin({ value: 5n }));
    forgetK1Account(ALICE);
    forgetK1Account(ALICE);
    expect(listK1Coins(ALICE)).toEqual([]);
    expect(listK1Coins(BOB)).toHaveLength(1);
  });

  it('remembers the account viewing secret beside the coins, and clears it', () => {
    putK1Coin(ALICE, coin());
    rememberK1EncSecretKey(ALICE, 'ff'.repeat(32));
    expect(loadK1CoinStore(ALICE).encSecretKeyHex).toBe('ff'.repeat(32));
    expect(listK1Coins(ALICE)).toHaveLength(1);
    rememberK1EncSecretKey(ALICE, null);
    expect(loadK1CoinStore(ALICE).encSecretKeyHex).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe('one browser, more than one account', () => {
  it('keeps two accounts on the same network apart', () => {
    putK1Coin(ALICE, coin({ value: 100n }));
    putK1Coin(BOB, coin({ value: 250n }));
    expect(heldK1Coin(ALICE, NIGHT)?.value).toBe(100n);
    expect(heldK1Coin(BOB, NIGHT)?.value).toBe(250n);
    dropK1Coin(BOB, NIGHT);
    expect(heldK1Coin(ALICE, NIGHT)?.value).toBe(100n);
  });

  it('keeps the same address on two networks apart — a position is chain-local', () => {
    putK1Coin(ALICE, coin({ mtIndex: 42n }));
    putK1Coin(ALICE_ON_PREVIEW, coin({ mtIndex: 7n }));
    expect(heldK1Coin(ALICE, NIGHT)?.mtIndex).toBe(42n);
    expect(heldK1Coin(ALICE_ON_PREVIEW, NIGHT)?.mtIndex).toBe(7n);
    expect(k1AccountKey(ALICE)).not.toBe(k1AccountKey(ALICE_ON_PREVIEW));
  });
});

/* -------------------------------------------------------------------------- */

describe('a spend, which is one write and not two', () => {
  it('drops the consumed coin and stores the change in a single write', () => {
    putK1Coin(ALICE, coin({ value: 100n, mtIndex: 42n }));
    const writes: string[] = [];
    const inner = (globalThis as { window: { localStorage: { setItem: unknown } } }).window
      .localStorage;
    const original = inner.setItem as (key: string, value: string) => void;
    inner.setItem = (key: string, value: string) => {
      writes.push(value);
      original(key, value);
    };
    replaceK1Coin(ALICE, NIGHT, { colour: NIGHT, nonce: OTHER_NONCE, value: 70n, mtIndex: 51n });
    inner.setItem = original;
    expect(writes).toHaveLength(1);
    expect(heldK1Coin(ALICE, NIGHT)).toEqual({
      colour: NIGHT,
      nonce: OTHER_NONCE,
      value: 70n,
      mtIndex: 51n,
    });
  });

  it('leaves nothing behind when the spend consumed the coin exactly', () => {
    putK1Coin(ALICE, coin());
    replaceK1Coin(ALICE, NIGHT, null);
    expect(heldK1Coin(ALICE, NIGHT)).toBeNull();
  });

  it('can move the change into another colour without disturbing the rest', () => {
    putK1Coin(ALICE, coin({ colour: NIGHT }));
    putK1Coin(ALICE, coin({ colour: MUSD, value: 5n }));
    replaceK1Coin(ALICE, NIGHT, { colour: MUSD, nonce: OTHER_NONCE, value: 3n, mtIndex: 8n });
    expect(listK1Coins(ALICE)).toEqual([
      { colour: MUSD, nonce: OTHER_NONCE, value: 3n, mtIndex: 8n },
    ]);
  });

  it('normalises the change coin it is handed', () => {
    putK1Coin(ALICE, coin());
    replaceK1Coin(ALICE, `0x${NIGHT}`, {
      colour: `0x${MUSD.toUpperCase()}`,
      nonce: OTHER_NONCE.toUpperCase(),
      value: 1n,
      mtIndex: 0n,
    });
    expect(heldK1Coin(ALICE, MUSD)).toEqual({
      colour: MUSD,
      nonce: OTHER_NONCE,
      value: 1n,
      mtIndex: 0n,
    });
  });
});

/* -------------------------------------------------------------------------- */

describe('what the store will not hold', () => {
  it('refuses an account with no network and one with no usable address', () => {
    expect(refuseK1Account({ network: '  ', address: ALICE.address })).toMatch(/network/);
    expect(
      refuseK1Account({ network: undefined as unknown as string, address: ALICE.address }),
    ).toMatch(/network/);
    expect(refuseK1Account({ network: 'stagenet', address: 'not-an-address' })).toMatch(/64-hex/);
    expect(refuseK1Account(ALICE)).toBeNull();
  });

  it('refuses a coin missing any of the four things the witness returns', () => {
    expect(refuseK1Coin(coin({ colour: 'short' }))).toMatch(/64-hex colour/);
    expect(refuseK1Coin(coin({ nonce: 'short' }))).toMatch(/64-hex nonce/);
    expect(refuseK1Coin(coin({ value: 1 as unknown as bigint }))).toMatch(/value/);
    expect(refuseK1Coin(coin({ value: -1n }))).toMatch(/value/);
    expect(refuseK1Coin(coin({ mtIndex: 0 as unknown as bigint }))).toMatch(/position/);
    expect(refuseK1Coin(coin({ mtIndex: -1n }))).toMatch(/position/);
    expect(refuseK1Coin(coin({ value: 0n, mtIndex: 0n }))).toBeNull();
  });

  it('throws on a write it cannot store, rather than storing a coin nothing can spend', () => {
    expect(() => putK1Coin({ network: '', address: ALICE.address }, coin())).toThrow(/network/);
    expect(() => putK1Coin(ALICE, coin({ nonce: 'short' }))).toThrow(/nonce/);
    expect(() => dropK1Coin({ network: '', address: ALICE.address }, NIGHT)).toThrow(/network/);
    expect(() => dropK1Coin(ALICE, 'short')).toThrow(/Not a colour/);
    expect(() => replaceK1Coin({ network: '', address: ALICE.address }, NIGHT, null)).toThrow(
      /network/,
    );
    expect(() => replaceK1Coin(ALICE, 'short', null)).toThrow(/Not a colour/);
    expect(() => replaceK1Coin(ALICE, NIGHT, coin({ value: -1n }))).toThrow(/value/);
    expect(() => rememberK1EncSecretKey({ network: '', address: ALICE.address }, null)).toThrow(
      /network/,
    );
    expect(() => forgetK1Account({ network: '', address: ALICE.address })).toThrow(/network/);
    expect(() => k1PrivateStateId({ network: '', address: ALICE.address })).toThrow(/network/);
  });

  it('answers empty rather than throwing when a READ names an account it cannot parse', () => {
    expect(loadK1CoinStore({ network: '', address: ALICE.address })).toEqual(EMPTY_STORE);
    expect(heldK1Coin({ network: '', address: ALICE.address }, NIGHT)).toBeNull();
    expect(heldK1Coin(ALICE, 'not-a-colour')).toBeNull();
    expect(listK1Coins({ network: '', address: ALICE.address })).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

describe('a storage blob that is not what this build wrote', () => {
  it('reads nothing at all out of an empty, unparseable, or non-object blob', () => {
    expect(listK1Coins(ALICE)).toEqual([]);
    seed('{not json');
    expect(listK1Coins(ALICE)).toEqual([]);
    seed('null');
    expect(listK1Coins(ALICE)).toEqual([]);
    seed('"a string"');
    expect(listK1Coins(ALICE)).toEqual([]);
  });

  it('drops the rows it cannot read and keeps the ones it can', () => {
    seed({
      [k1AccountKey(ALICE)]: {
        encSecretKeyHex: null,
        coins: {
          [NIGHT]: { nonceHex: NONCE, colorHex: NIGHT, value: '100', mtIndex: '42' },
          [MUSD]: { nonceHex: 'short', colorHex: MUSD, value: '1', mtIndex: '0' },
          bad_colour_key: { nonceHex: NONCE, colorHex: NIGHT, value: '1', mtIndex: '0' },
          ['ee'.repeat(32)]: { nonceHex: NONCE, colorHex: 'ff'.repeat(32), value: '1', mtIndex: '0' },
          ['dd'.repeat(32)]: { nonceHex: NONCE, colorHex: 'dd'.repeat(32), value: '007', mtIndex: '0' },
          ['cc'.repeat(32)]: { nonceHex: NONCE, colorHex: 'cc'.repeat(32), value: '1', mtIndex: 3 },
          ['bb'.repeat(32)]: null,
          ['aa'.repeat(32)]: 'not an object',
        },
      },
    });
    expect(listK1Coins(ALICE)).toEqual([
      { colour: NIGHT, nonce: NONCE, value: 100n, mtIndex: 42n },
    ]);
  });

  it('drops an account entry that is not an object, and a coins field that is not one', () => {
    seed({
      [k1AccountKey(ALICE)]: { encSecretKeyHex: 'ab', coins: 'not a map' },
      [k1AccountKey(BOB)]: 'not an object',
      [k1AccountKey(ALICE_ON_PREVIEW)]: { encSecretKeyHex: 12 },
    });
    expect(loadK1CoinStore(ALICE)).toEqual({ ...EMPTY_STORE, encSecretKeyHex: 'ab' });
    expect(loadK1CoinStore(BOB)).toEqual(EMPTY_STORE);
    expect(loadK1CoinStore(ALICE_ON_PREVIEW)).toEqual(EMPTY_STORE);
  });

  it('cannot be made to write through `__proto__`', () => {
    seed({ [k1AccountKey(ALICE)]: { coins: { __proto__: { nonceHex: NONCE } } } });
    expect(listK1Coins(ALICE)).toEqual([]);
    expect(({} as Record<string, unknown>).nonceHex).toBeUndefined();
  });

  it('survives a browser that denies storage, in both directions', () => {
    installStorage({ denyReads: true });
    expect(listK1Coins(ALICE)).toEqual([]);
    installStorage({ denyWrites: true });
    expect(() => putK1Coin(ALICE, coin())).not.toThrow();
    expect(heldK1Coin(ALICE, NIGHT)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe('learning a position from the chain', () => {
  const TX = 'ab'.repeat(33);

  function reader(window: K1CommitmentWindow | null) {
    return vi.fn(() => Promise.resolve(window));
  }

  it('takes startIndex as the position when the transaction carried one output', async () => {
    const ask = reader({ startIndex: 17, endIndex: 18 });
    const result = await reconcileK1CoinFromChain(
      ALICE,
      { colour: NIGHT, nonce: NONCE, value: 100n, txId: TX },
      ask,
    );
    expect(ask).toHaveBeenCalledWith(TX);
    expect(result).toEqual({
      outcome: 'learned',
      coin: { colour: NIGHT, nonce: NONCE, value: 100n, mtIndex: 17n },
      placed: 'held',
    });
    expect(heldK1Coin(ALICE, NIGHT)?.mtIndex).toBe(17n);
  });

  it('keeps the value already stored when the reconciliation does not name one', async () => {
    putK1Coin(ALICE, coin({ value: 100n, mtIndex: 42n }));
    const result = await reconcileK1CoinFromChain(
      ALICE,
      { colour: NIGHT, nonce: OTHER_NONCE, txId: TX },
      reader({ startIndex: 51, endIndex: 52 }),
    );
    expect(result).toEqual({
      outcome: 'learned',
      /* QUEUED, not held: the colour already holds a coin, and the enqueue
         rule never displaces one (2026/09/17). */
      coin: { colour: NIGHT, nonce: OTHER_NONCE, value: 100n, mtIndex: 51n },
      placed: 'queued',
    });
  });

  /* THE DEFECT THIS CATCHES would have emptied a Passport's change on the next
     Home open. The inbox walk re-reconciles every entry it can read, on every
     open and after every payment, so the entry that delivered the coin a spend
     has since consumed came round again and wrote that SPENT coin back over the
     change — taking the change's candidate positions with it. */
  it('a second walk after a spend keeps the change coin', async () => {
    /* Paid 100 (inbox entry 0), spent it, 60 of change now held. */
    putK1Coin(ALICE, coin({ value: 100n, mtIndex: 3n }));
    rememberK1ChangeCoin(ALICE, NIGHT, { colour: NIGHT, nonce: OTHER_NONCE, value: 60n }, TX);
    await settleK1AwaitingCoin(
      ALICE,
      NIGHT,
      TX,
      vi.fn<K1CommitmentWindowReader>().mockResolvedValue({ startIndex: 8, endIndex: 9 }),
    );
    expect(heldK1Coin(ALICE, NIGHT)).toEqual({
      colour: NIGHT,
      nonce: OTHER_NONCE,
      value: 60n,
      mtIndex: 8n,
    });

    /* Home re-opens and the walk offers entry 0 again — the hundred. */
    const again = await reconcileK1CoinFromChain(
      ALICE,
      { colour: NIGHT, nonce: NONCE, value: 100n, txId: TX },
      vi.fn<K1CommitmentWindowReader>().mockResolvedValue({ startIndex: 3, endIndex: 4 }),
    );

    expect(again).toEqual({ outcome: 'spent', nonce: NONCE });
    /* The change is untouched, and worth what it was. */
    expect(heldK1Coin(ALICE, NIGHT)).toEqual({
      colour: NIGHT,
      nonce: OTHER_NONCE,
      value: 60n,
      mtIndex: 8n,
    });
    expect(k1ColourBalance(ALICE, NIGHT)).toBe(60n);
  });

  /* And an entry for a coin the store already holds is not news either — it is
     not written twice, and the indexer is not asked about it. */
  it('says nothing happened for a coin it already holds', async () => {
    putK1Coin(ALICE, coin({ value: 100n, mtIndex: 3n }));
    const ask = vi.fn<K1CommitmentWindowReader>();
    const result = await reconcileK1CoinFromChain(
      ALICE,
      { colour: NIGHT, nonce: NONCE, value: 100n, txId: TX },
      ask,
    );
    expect(result).toEqual({ outcome: 'known', nonce: NONCE });
    expect(ask).not.toHaveBeenCalled();
  });

  /* A second coin of a colour QUEUES; it never displaces the held one. */
  it('queues a second delivery of a colour behind the coin already held', async () => {
    putK1Coin(ALICE, coin({ value: 100n, mtIndex: 3n }));
    const result = await reconcileK1CoinFromChain(
      ALICE,
      { colour: NIGHT, nonce: OTHER_NONCE, value: 25n, txId: TX },
      vi.fn<K1CommitmentWindowReader>().mockResolvedValue({ startIndex: 9, endIndex: 10 }),
    );
    expect(result.outcome).toBe('learned');
    expect(heldK1Coin(ALICE, NIGHT)?.nonce).toBe(NONCE);
    expect(queuedK1Coins(ALICE, NIGHT).map((row) => row.nonce)).toEqual([OTHER_NONCE]);
    expect(k1ColourBalance(ALICE, NIGHT)).toBe(125n);
  });

  /* Candidates go in the held slot or nowhere: a two-output delivery into a
     colour that already holds something is reported, never written over it. */
  it('does not write candidates over a colour that already holds a coin', async () => {
    putK1Coin(ALICE, coin({ value: 100n, mtIndex: 3n }));
    const result = await reconcileK1CoinFromChain(
      ALICE,
      { colour: NIGHT, nonce: OTHER_NONCE, value: 25n, txId: TX },
      vi.fn<K1CommitmentWindowReader>().mockResolvedValue({ startIndex: 9, endIndex: 11 }),
      { candidates: 'store' },
    );
    expect(result).toEqual({ outcome: 'ambiguous', candidates: [9n, 10n], stored: false });
    expect(heldK1Coin(ALICE, NIGHT)?.nonce).toBe(NONCE);
    expect(heldK1Coin(ALICE, NIGHT)?.value).toBe(100n);
  });

  it('stores NOTHING when the transaction had several outputs, and hands back every candidate', async () => {
    const result = await reconcileK1CoinFromChain(
      ALICE,
      { colour: NIGHT, nonce: NONCE, value: 100n, txId: TX },
      reader({ startIndex: 4, endIndex: 7 }),
    );
    expect(result).toEqual({ outcome: 'ambiguous', candidates: [4n, 5n, 6n], stored: false });
    expect(heldK1Coin(ALICE, NIGHT)).toBeNull();
  });

  it('reads silence from the chain as "ask again", never as an answer', async () => {
    const lagging = await reconcileK1CoinFromChain(
      ALICE,
      { colour: NIGHT, nonce: NONCE, value: 100n, txId: TX },
      reader(null),
    );
    expect(lagging).toMatchObject({ outcome: 'unavailable' });

    const threw = await reconcileK1CoinFromChain(
      ALICE,
      { colour: NIGHT, nonce: NONCE, value: 100n, txId: TX },
      () => Promise.reject(new Error('socket closed')),
    );
    expect(threw).toMatchObject({ outcome: 'unavailable', reason: /socket closed/ as never });
    expect((threw as { reason: string }).reason).toMatch(/socket closed/);
    expect(heldK1Coin(ALICE, NIGHT)).toBeNull();
  });

  it('reads an unusable window the same way — the indexer has not settled', async () => {
    for (const window of [
      { startIndex: -1, endIndex: 4 },
      { startIndex: 1.5, endIndex: 4 },
      { startIndex: '3' as unknown as number, endIndex: 4 },
      { startIndex: 4, endIndex: -1 },
      { startIndex: 4, endIndex: 4 },
      { startIndex: 9, endIndex: 4 },
    ]) {
      const result = await reconcileK1CoinFromChain(
        ALICE,
        { colour: NIGHT, nonce: NONCE, value: 100n, txId: TX },
        reader(window),
      );
      expect(result).toMatchObject({ outcome: 'unavailable' });
    }
    expect(heldK1Coin(ALICE, NIGHT)).toBeNull();
  });

  it('refuses — rather than waits — for anything a retry cannot improve', async () => {
    const ask = reader({ startIndex: 1, endIndex: 2 });
    const cases = [
      [{ network: '', address: ALICE.address }, { colour: NIGHT, nonce: NONCE, value: 1n, txId: TX }],
      [ALICE, { colour: 'short', nonce: NONCE, value: 1n, txId: TX }],
      [ALICE, { colour: NIGHT, nonce: 'short', value: 1n, txId: TX }],
      [ALICE, { colour: NIGHT, nonce: NONCE, txId: TX }],
      [ALICE, { colour: NIGHT, nonce: NONCE, value: 1n, txId: '   ' }],
      [ALICE, { colour: NIGHT, nonce: NONCE, value: 1n, txId: 7 as unknown as string }],
    ] as const;
    for (const [account, pending] of cases) {
      const result = await reconcileK1CoinFromChain(account, pending, ask);
      expect(result).toMatchObject({ outcome: 'refused' });
    }
    expect(ask).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */

describe('the private-state provider midnight-js is given', () => {
  it('uses an id that is the same on the next connection', () => {
    expect(k1PrivateStateId(ALICE)).toBe(k1PrivateStateId({ ...ALICE }));
    expect(k1PrivateStateId(ALICE)).not.toBe(k1PrivateStateId(BOB));
    expect(k1PrivateStateId(ALICE)).not.toBe(k1PrivateStateId(ALICE_ON_PREVIEW));
    expect(k1PrivateStateProvider(ALICE).privateStateId).toBe(k1PrivateStateId(ALICE));
  });

  it('serves the stored coins, so a reconnection can still spend', async () => {
    putK1Coin(ALICE, coin());
    const provider = k1PrivateStateProvider(ALICE);
    expect(await provider.get(provider.privateStateId)).toEqual({
      ...EMPTY_STORE,
      coins: { [NIGHT]: { nonceHex: NONCE, colorHex: NIGHT, value: '100', mtIndex: '42' } },
    });
  });

  it('persists a private state written back through it, filtering what it cannot read', async () => {
    const provider = k1PrivateStateProvider(ALICE);
    await provider.set(provider.privateStateId, {
      encSecretKeyHex: 'ff'.repeat(32),
      coins: {
        [NIGHT]: { nonceHex: NONCE, colorHex: NIGHT, value: '100', mtIndex: '42' },
        [MUSD]: { nonceHex: 'short', colorHex: MUSD, value: '1', mtIndex: '0' },
        mismatched: { nonceHex: NONCE, colorHex: NIGHT, value: '1', mtIndex: '0' },
      },
    });
    expect(listK1Coins(ALICE)).toEqual([{ colour: NIGHT, nonce: NONCE, value: 100n, mtIndex: 42n }]);
    expect(loadK1CoinStore(ALICE).encSecretKeyHex).toBe('ff'.repeat(32));

    /* A state that carries NO secret does not clear the one the store holds.
       The write comes from midnight-js handing back what it read, and what it
       read is at best as new as the store — see `mergeIntoK1CoinStore`. */
    await provider.set(provider.privateStateId, { coins: {}, encSecretKeyHex: 12 });
    expect(loadK1CoinStore(ALICE).encSecretKeyHex).toBe('ff'.repeat(32));
  });

  it('ignores a write under its own id that is not a coin store at all', async () => {
    putK1Coin(ALICE, coin());
    const provider = k1PrivateStateProvider(ALICE);
    await provider.set(provider.privateStateId, null);
    await provider.set(provider.privateStateId, 'a string');
    await provider.set(provider.privateStateId, { coins: null });
    expect(listK1Coins(ALICE)).toHaveLength(1);
  });

  it('holds any OTHER contract state for the session, exactly as the in-memory one does', async () => {
    const provider = k1PrivateStateProvider(ALICE);
    expect(await provider.get('somebody-else')).toBeNull();
    await provider.set('somebody-else', { anything: true });
    expect(await provider.get('somebody-else')).toEqual({ anything: true });
    await provider.remove('somebody-else');
    expect(await provider.get('somebody-else')).toBeNull();
  });

  it('removes and clears only what it was asked to', async () => {
    putK1Coin(ALICE, coin());
    putK1Coin(BOB, coin());
    const provider = k1PrivateStateProvider(ALICE);
    await provider.remove(provider.privateStateId);
    expect(listK1Coins(ALICE)).toEqual([]);
    expect(listK1Coins(BOB)).toHaveLength(1);

    putK1Coin(ALICE, coin());
    await provider.set('somebody-else', { anything: true });
    await provider.clear();
    expect(listK1Coins(ALICE)).toEqual([]);
    expect(await provider.get('somebody-else')).toBeNull();
    expect(listK1Coins(BOB)).toHaveLength(1);
  });

  it('keeps signing keys for the session and refuses to export private state', async () => {
    const provider = k1PrivateStateProvider(ALICE);
    provider.setContractAddress();
    expect(await provider.getSigningKey('0xabc')).toBeNull();
    await provider.setSigningKey('0xabc', 'key');
    expect(await provider.getSigningKey('0xabc')).toBe('key');
    await provider.removeSigningKey('0xabc');
    expect(await provider.getSigningKey('0xabc')).toBeNull();
    await provider.setSigningKey('0xabc', 'key');
    await provider.clearSigningKeys();
    expect(await provider.getSigningKey('0xabc')).toBeNull();
    await expect(provider.exportPrivateStates()).rejects.toThrow(/not supported/);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * More than one coin of a colour, which the contract permits and the witness
 * cannot describe.
 *
 * The failure this guards against is arithmetic that a holder can see: two
 * payments arrive, the second write lands on the first, and a Passport that
 * was paid twice shows one of them. The queue is the answer, and the rule that
 * makes it safe is that the held slot is never empty while the queue is not.
 */
describe('a second coin of the same colour', () => {
  it('queues behind the held one and counts towards the balance', () => {
    expect(enqueueK1Coin(ALICE, coin({ value: 100n }))).toBe('held');
    expect(enqueueK1Coin(ALICE, coin({ value: 250n, nonce: OTHER_NONCE, mtIndex: 43n }))).toBe(
      'queued',
    );
    expect(heldK1Coin(ALICE, NIGHT)?.value).toBe(100n);
    expect(queuedK1Coins(ALICE, NIGHT)).toEqual([
      { colour: NIGHT, nonce: OTHER_NONCE, value: 250n, mtIndex: 43n },
    ]);
    expect(k1ColourBalance(ALICE, NIGHT)).toBe(350n);
    expect(k1ColourBalance(ALICE, MUSD)).toBe(0n);
  });

  it('does not store the same coin twice, held or queued', () => {
    enqueueK1Coin(ALICE, coin());
    expect(enqueueK1Coin(ALICE, coin())).toBe('known');
    enqueueK1Coin(ALICE, coin({ nonce: OTHER_NONCE }));
    expect(enqueueK1Coin(ALICE, coin({ nonce: OTHER_NONCE }))).toBe('known');
    expect(k1ColourBalance(ALICE, NIGHT)).toBe(200n);
  });

  it('refuses a coin this account has already spent, however it is offered again', () => {
    putK1Coin(ALICE, coin());
    replaceK1Coin(ALICE, NIGHT, null);
    expect(isK1NonceSpent(ALICE, NONCE)).toBe(true);
    expect(isK1NonceSpent(ALICE, OTHER_NONCE)).toBe(false);
    expect(isK1NonceSpent(ALICE, 'not-a-nonce')).toBe(false);
    expect(enqueueK1Coin(ALICE, coin())).toBe('spent');
    expect(heldK1Coin(ALICE, NIGHT)).toBeNull();
  });

  it('promotes the next queued coin when a spend leaves no change', () => {
    enqueueK1Coin(ALICE, coin({ value: 100n }));
    enqueueK1Coin(ALICE, coin({ value: 250n, nonce: OTHER_NONCE, mtIndex: 43n }));
    enqueueK1Coin(ALICE, coin({ value: 7n, nonce: 'a1'.repeat(32), mtIndex: 44n }));
    replaceK1Coin(ALICE, NIGHT, null);
    expect(heldK1Coin(ALICE, NIGHT)).toEqual({
      colour: NIGHT,
      nonce: OTHER_NONCE,
      value: 250n,
      mtIndex: 43n,
    });
    expect(queuedK1Coins(ALICE, NIGHT)).toHaveLength(1);
    expect(k1ColourBalance(ALICE, NIGHT)).toBe(257n);
  });

  it('leaves the queue alone when the spend returned change', () => {
    enqueueK1Coin(ALICE, coin({ value: 100n }));
    enqueueK1Coin(ALICE, coin({ value: 250n, nonce: OTHER_NONCE, mtIndex: 43n }));
    replaceK1Coin(ALICE, NIGHT, {
      colour: NIGHT,
      nonce: 'a1'.repeat(32),
      value: 40n,
      mtIndex: 99n,
    });
    expect(heldK1Coin(ALICE, NIGHT)?.value).toBe(40n);
    expect(queuedK1Coins(ALICE, NIGHT)).toHaveLength(1);
    expect(isK1NonceSpent(ALICE, NONCE)).toBe(true);
  });

  it('promotes on a drop as well, so a colour never keeps a queue with no head', () => {
    enqueueK1Coin(ALICE, coin({ value: 100n }));
    enqueueK1Coin(ALICE, coin({ value: 250n, nonce: OTHER_NONCE, mtIndex: 43n }));
    dropK1Coin(ALICE, NIGHT);
    expect(heldK1Coin(ALICE, NIGHT)?.nonce).toBe(OTHER_NONCE);
    expect(queuedK1Coins(ALICE, NIGHT)).toEqual([]);
    expect(isK1NonceSpent(ALICE, NONCE)).toBe(true);
    dropK1Coin(ALICE, MUSD);
    expect(queuedK1Coins(ALICE, 'not-a-colour')).toEqual([]);
  });

  it('remembers a bounded number of spent nonces, oldest dropped first', () => {
    /* The cap is 256. Two hundred and sixty spends leave the first four
       forgotten and the last in place, which is the direction that matters:
       the nonce a write could resurrect is the one spent moments ago. */
    for (let index = 0; index < 260; index += 1) {
      const nonce = index.toString(16).padStart(64, '0');
      putK1Coin(ALICE, coin({ nonce }));
      replaceK1Coin(ALICE, NIGHT, null);
    }
    expect(isK1NonceSpent(ALICE, '0'.repeat(63) + '0')).toBe(false);
    expect(isK1NonceSpent(ALICE, (259).toString(16).padStart(64, '0'))).toBe(true);
    expect(loadK1CoinStore(ALICE).spentNonces).toHaveLength(256);
  });

  it('records a nonce once, however many times the same coin is spent again', () => {
    /* `putK1Coin` is the low-level writer and does not consult the spent list —
       a reconciliation re-learning a position is entitled to write a coin
       whatever this store thinks of it — so the same nonce can reach the spend
       path twice. The list is a set, not a log. */
    putK1Coin(ALICE, coin());
    dropK1Coin(ALICE, NIGHT);
    putK1Coin(ALICE, coin());
    dropK1Coin(ALICE, NIGHT);
    expect(loadK1CoinStore(ALICE).spentNonces).toEqual([NONCE]);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * A position that is a guess, and the rule that stops it being written as a
 * fact.
 *
 * A withdrawal's transaction carries two shielded outputs and the indexer
 * reports the window they share, so the change coin's position is one of two
 * numbers with nothing here to choose between them. Storing the first and
 * calling it the coin is precisely the "confident wrong answer" the module is
 * written against; storing both and letting a proof decide is not.
 */
describe('a coin whose position the chain gave two answers for', () => {
  const CANDIDATES = [10n, 11n];

  it('stores the coin at the first candidate and keeps the rest beside it', () => {
    putK1CoinCandidates(ALICE, { colour: NIGHT, nonce: NONCE, value: 60n }, CANDIDATES);
    expect(heldK1Coin(ALICE, NIGHT)).toEqual({
      colour: NIGHT,
      nonce: NONCE,
      value: 60n,
      mtIndex: 10n,
    });
    expect(k1CoinCandidates(ALICE, NIGHT)).toEqual([10n, 11n]);
    expect(k1CoinCandidates(ALICE, 'not-a-colour')).toEqual([]);
    expect(k1CoinCandidates(ALICE, MUSD)).toEqual([]);
  });

  it('moves to the next candidate when the current one will not prove', () => {
    putK1CoinCandidates(ALICE, { colour: NIGHT, nonce: NONCE, value: 60n }, CANDIDATES);
    expect(advanceK1CoinCandidate(ALICE, NIGHT)).toEqual({
      colour: NIGHT,
      nonce: NONCE,
      value: 60n,
      mtIndex: 11n,
    });
    expect(heldK1Coin(ALICE, NIGHT)?.mtIndex).toBe(11n);
    /* THE LIST IS NOT CONSUMED. Both positions are still the only two answers
       the chain gave, and the next spend of this colour has to start from the
       first of them again. */
    expect(k1CoinCandidates(ALICE, NIGHT)).toEqual([10n, 11n]);
  });

  it('runs out rather than looping, and keeps the coin and its candidates', () => {
    putK1CoinCandidates(ALICE, { colour: NIGHT, nonce: NONCE, value: 60n }, [10n]);
    expect(advanceK1CoinCandidate(ALICE, NIGHT)).toBeNull();
    expect(heldK1Coin(ALICE, NIGHT)?.mtIndex).toBe(10n);
    expect(k1CoinCandidates(ALICE, NIGHT)).toEqual([10n]);
    /* And with no coin to advance at all, which is a resumed run against a
       store somebody has reset in another tab. */
    expect(advanceK1CoinCandidate(ALICE, MUSD)).toBeNull();
  });

  it('tries the head when the position held is not one of the candidates', () => {
    /* A blob from another build: a coin at a position its own list does not
       contain. Walking off the end of the list is the one thing that must not
       happen, and the head is the only guess this store ever offered. */
    seed({
      [k1AccountKey(ALICE)]: {
        encSecretKeyHex: null,
        coins: { [NIGHT]: { colorHex: NIGHT, nonceHex: NONCE, value: '60', mtIndex: '99' } },
        queued: {},
        spentNonces: [],
        mtIndexCandidates: { [NIGHT]: ['10', '11'] },
        awaiting: {},
        unreadChange: {},
      },
    });

    expect(advanceK1CoinCandidate(ALICE, NIGHT)?.mtIndex).toBe(10n);
    expect(k1CoinCandidates(ALICE, NIGHT)).toEqual([10n, 11n]);
  });

  it('drops the candidates for a colour whose coin was spent or settled', () => {
    putK1CoinCandidates(ALICE, { colour: NIGHT, nonce: NONCE, value: 60n }, CANDIDATES);
    settleK1Coin(ALICE, NIGHT);
    expect(k1CoinCandidates(ALICE, NIGHT)).toEqual([]);
    expect(heldK1Coin(ALICE, NIGHT)?.mtIndex).toBe(10n);

    putK1CoinCandidates(ALICE, { colour: MUSD, nonce: NONCE, value: 60n }, CANDIDATES);
    replaceK1Coin(ALICE, MUSD, null);
    expect(k1CoinCandidates(ALICE, MUSD)).toEqual([]);

    putK1CoinCandidates(ALICE, { colour: MUSD, nonce: NONCE, value: 60n }, CANDIDATES);
    putK1Coin(ALICE, coin({ colour: MUSD, mtIndex: 7n }));
    expect(k1CoinCandidates(ALICE, MUSD)).toEqual([]);
  });

  it('refuses a candidate list that decides nothing', () => {
    expect(() =>
      putK1CoinCandidates(ALICE, { colour: NIGHT, nonce: NONCE, value: 60n }, []),
    ).toThrow(/at least one candidate/);
    expect(() =>
      putK1CoinCandidates(ALICE, { colour: NIGHT, nonce: NONCE, value: 60n }, [10n, -1n]),
    ).toThrow(/zero or more/);
    expect(() =>
      putK1CoinCandidates(
        ALICE,
        { colour: NIGHT, nonce: NONCE, value: 60n },
        [10n, 2 as unknown as bigint],
      ),
    ).toThrow(/zero or more/);
    /* Nothing was written by the refused calls. */
    expect(heldK1Coin(ALICE, NIGHT)).toBeNull();
  });

  it('refuses a colour it cannot read, on every writer that takes one', () => {
    expect(() => dropK1Coin(ALICE, 'nope')).toThrow(/Not a colour/);
    expect(() => replaceK1Coin(ALICE, 'nope', null)).toThrow(/Not a colour/);
    expect(() => advanceK1CoinCandidate(ALICE, 'nope')).toThrow(/Not a colour/);
    expect(() => settleK1Coin(ALICE, 'nope')).toThrow(/Not a colour/);
  });

  it('is what a reconciliation writes when the spend asks it to', async () => {
    const window: K1CommitmentWindow = { startIndex: 10, endIndex: 12 };
    const reader = vi.fn<K1CommitmentWindowReader>().mockResolvedValue(window);

    const reported = await reconcileK1CoinFromChain(
      ALICE,
      { colour: NIGHT, nonce: NONCE, value: 60n, txId: 'tx-1' },
      reader,
    );
    expect(reported).toEqual({ outcome: 'ambiguous', candidates: [10n, 11n], stored: false });
    expect(heldK1Coin(ALICE, NIGHT)).toBeNull();

    const stored = await reconcileK1CoinFromChain(
      ALICE,
      { colour: NIGHT, nonce: NONCE, value: 60n, txId: 'tx-1' },
      reader,
      { candidates: 'store' },
    );
    expect(stored).toEqual({ outcome: 'ambiguous', candidates: [10n, 11n], stored: true });
    expect(heldK1Coin(ALICE, NIGHT)?.mtIndex).toBe(10n);
    expect(k1CoinCandidates(ALICE, NIGHT)).toEqual([10n, 11n]);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * The write this module does not make, and the one that would otherwise cost a
 * change coin.
 *
 * midnight-js writes `nextPrivateState` back through the provider after a
 * successful call, and that state is the one it READ BEFORE the call — the
 * spent coin still in it. These drills run the write in both orders, because
 * the order is midnight-js's and not ours.
 */
describe('a private state written back over the top of a spend', () => {
  const CHANGE: K1HeldCoin = { colour: NIGHT, nonce: OTHER_NONCE, value: 40n, mtIndex: 77n };

  /** What midnight-js read before the call: the coin the call consumed. */
  const BEFORE_THE_CALL = {
    encSecretKeyHex: null,
    coins: { [NIGHT]: { nonceHex: NONCE, colorHex: NIGHT, value: '100', mtIndex: '42' } },
  };

  it('cannot resurrect the spent coin when the write lands AFTER the change', async () => {
    putK1Coin(ALICE, coin());
    replaceK1Coin(ALICE, NIGHT, CHANGE);
    const provider = k1PrivateStateProvider(ALICE);
    await provider.set(provider.privateStateId, BEFORE_THE_CALL);
    expect(heldK1Coin(ALICE, NIGHT)).toEqual(CHANGE);
  });

  it('cannot resurrect it when the write lands BEFORE the change either', async () => {
    putK1Coin(ALICE, coin());
    const provider = k1PrivateStateProvider(ALICE);
    /* The spend records the nonce and the change in ONE write, so a write that
       lands before it is simply the state as it was. */
    await provider.set(provider.privateStateId, BEFORE_THE_CALL);
    replaceK1Coin(ALICE, NIGHT, CHANGE);
    await provider.set(provider.privateStateId, BEFORE_THE_CALL);
    expect(heldK1Coin(ALICE, NIGHT)).toEqual(CHANGE);
  });

  it('never overwrites a held coin, and still fills a colour the store lacks', async () => {
    putK1Coin(ALICE, coin({ value: 5n, nonce: OTHER_NONCE }));
    const provider = k1PrivateStateProvider(ALICE);
    await provider.set(provider.privateStateId, {
      encSecretKeyHex: 'ab'.repeat(32),
      coins: {
        ...BEFORE_THE_CALL.coins,
        [MUSD]: { nonceHex: 'a1'.repeat(32), colorHex: MUSD, value: '9', mtIndex: '3' },
      },
    });
    expect(heldK1Coin(ALICE, NIGHT)?.value).toBe(5n);
    expect(heldK1Coin(ALICE, MUSD)?.value).toBe(9n);
    expect(loadK1CoinStore(ALICE).encSecretKeyHex).toBe('ab'.repeat(32));
  });

  it('leaves the queue, the spent nonces, and the candidates to this app', async () => {
    enqueueK1Coin(ALICE, coin({ value: 100n }));
    enqueueK1Coin(ALICE, coin({ value: 250n, nonce: OTHER_NONCE, mtIndex: 43n }));
    const provider = k1PrivateStateProvider(ALICE);
    await provider.set(provider.privateStateId, {
      ...BEFORE_THE_CALL,
      queued: {},
      spentNonces: [OTHER_NONCE],
      mtIndexCandidates: { [NIGHT]: ['1'] },
    });
    expect(queuedK1Coins(ALICE, NIGHT)).toHaveLength(1);
    expect(isK1NonceSpent(ALICE, OTHER_NONCE)).toBe(false);
    expect(k1CoinCandidates(ALICE, NIGHT)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

describe('the new fields, read out of a blob somebody else wrote', () => {
  it('drops what it cannot read and keeps what it can', () => {
    seed({
      [k1AccountKey(ALICE)]: {
        encSecretKeyHex: null,
        coins: { [NIGHT]: { nonceHex: NONCE, colorHex: NIGHT, value: '100', mtIndex: '42' } },
        queued: {
          [NIGHT]: [
            { nonceHex: OTHER_NONCE, colorHex: NIGHT, value: '250', mtIndex: '43' },
            { nonceHex: 'short', colorHex: NIGHT, value: '1', mtIndex: '0' },
            { nonceHex: NONCE, colorHex: MUSD, value: '1', mtIndex: '0' },
          ],
          [MUSD]: 'not a list',
          bad_colour_key: [{ nonceHex: NONCE, colorHex: NIGHT, value: '1', mtIndex: '0' }],
          ['ee'.repeat(32)]: [{ nonceHex: 'short', colorHex: 'ee'.repeat(32), value: '1', mtIndex: '0' }],
        },
        spentNonces: [OTHER_NONCE, OTHER_NONCE, 'short', 12, `0x${NONCE.toUpperCase()}`],
        mtIndexCandidates: {
          [NIGHT]: ['10', '10', '11', 'x', 12],
          bad_colour_key: ['1'],
          [MUSD]: [],
          ['ee'.repeat(32)]: 'not a list',
        },
      },
    });
    const state = loadK1CoinStore(ALICE);
    expect(queuedK1Coins(ALICE, NIGHT)).toEqual([
      { colour: NIGHT, nonce: OTHER_NONCE, value: 250n, mtIndex: 43n },
    ]);
    expect(Object.keys(state.queued)).toEqual([NIGHT]);
    expect(state.spentNonces).toEqual([OTHER_NONCE, NONCE]);
    expect(k1CoinCandidates(ALICE, NIGHT)).toEqual([10n, 11n]);
    expect(Object.keys(state.mtIndexCandidates)).toEqual([NIGHT]);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * The change a spend left, before the chain has said where it is.
 *
 * The description arrives as the circuit's return value and exists nowhere
 * else in the world. A reload between recording the spend and recording the
 * change is a coin that has demonstrably arrived and that nobody can ever move
 * again — so it is one write, and the position is filled in afterwards, for as
 * many attempts as it takes.
 */
describe('a change coin waiting for its position', () => {
  const CHANGE = { colour: NIGHT, nonce: OTHER_NONCE, value: 60n };

  it('is written in the same breath as the spend, and is not spendable yet', () => {
    putK1Coin(ALICE, coin());
    rememberK1ChangeCoin(ALICE, NIGHT, CHANGE, 'tx-withdraw');
    /* The consumed coin is gone and recorded as spent... */
    expect(isK1NonceSpent(ALICE, NONCE)).toBe(true);
    /* ...the change is remembered whole... */
    expect(awaitingK1Coins(ALICE)).toEqual([
      { colour: NIGHT, nonce: OTHER_NONCE, value: 60n, txId: 'tx-withdraw' },
    ]);
    /* ...and the witness cannot reach it, because nothing yet knows where it
       is and a position nobody has asked about is not a position. */
    expect(heldK1Coin(ALICE, NIGHT)).toBeNull();
    expect(k1ColourBalance(ALICE, NIGHT)).toBe(0n);
  });

  /* THE DEFECT THIS CATCHES left a change coin "arriving" for ever. A spend
     files its change the instant the circuit returns, when the only name for
     the transaction is midnight-js's identifier — and a sponsored transaction
     is superseded, so the indexer cannot answer a commitment window for that
     id. Renaming the row to the chain's hash is what lets it ever settle. */
  it('settles a change coin once the row is renamed to the chain hash', async () => {
    const TX = 'ab'.repeat(33);
    putK1Coin(ALICE, coin());
    rememberK1ChangeCoin(ALICE, NIGHT, CHANGE, 'midnight-js-identifier');
    const reader = vi
      .fn<K1CommitmentWindowReader>()
      .mockImplementation((txId) =>
        Promise.resolve(txId === TX ? { startIndex: 8, endIndex: 9 } : null),
      );

    /* Under the identifier the chain has never heard of, it stays where it is. */
    expect(
      (await settleK1AwaitingCoin(ALICE, NIGHT, 'midnight-js-identifier', reader)).outcome,
    ).toBe('unavailable');
    expect(awaitingK1Coins(ALICE)).toHaveLength(1);

    renameK1AwaitingTx(ALICE, NIGHT, 'midnight-js-identifier', TX);
    expect((await settleK1AwaitingCoin(ALICE, NIGHT, TX, reader)).outcome).toBe('learned');
    expect(heldK1Coin(ALICE, NIGHT)?.mtIndex).toBe(8n);
    expect(awaitingK1Coins(ALICE)).toEqual([]);
  });

  it('files itself the moment the chain answers, and is spendable then', async () => {
    putK1Coin(ALICE, coin());
    rememberK1ChangeCoin(ALICE, NIGHT, CHANGE, 'tx-withdraw');
    const reader = vi.fn<K1CommitmentWindowReader>().mockResolvedValue({
      startIndex: 8,
      endIndex: 9,
    });
    expect(await settleK1AwaitingCoin(ALICE, NIGHT, 'tx-withdraw', reader)).toEqual({
      outcome: 'learned',
      coin: { colour: NIGHT, nonce: OTHER_NONCE, value: 60n, mtIndex: 8n },
      placed: 'held',
    });
    expect(reader).toHaveBeenCalledWith('tx-withdraw');
    expect(heldK1Coin(ALICE, NIGHT)?.mtIndex).toBe(8n);
    expect(awaitingK1Coins(ALICE)).toEqual([]);
  });

  it('keeps the two-output window as candidates, because a withdrawal has two', async () => {
    rememberK1ChangeCoin(ALICE, NIGHT, CHANGE, 'tx-withdraw');
    const reader = vi.fn<K1CommitmentWindowReader>().mockResolvedValue({
      startIndex: 8,
      endIndex: 10,
    });
    expect(await settleK1AwaitingCoin(ALICE, NIGHT, 'tx-withdraw', reader)).toEqual({
      outcome: 'ambiguous',
      candidates: [8n, 9n],
      stored: true,
    });
    expect(heldK1Coin(ALICE, NIGHT)?.mtIndex).toBe(8n);
    expect(k1CoinCandidates(ALICE, NIGHT)).toEqual([8n, 9n]);
    expect(awaitingK1Coins(ALICE)).toEqual([]);
  });

  it('waits rather than forgetting when the chain cannot be asked', async () => {
    rememberK1ChangeCoin(ALICE, NIGHT, CHANGE, 'tx-withdraw');
    const silent = vi.fn<K1CommitmentWindowReader>().mockResolvedValue(null);
    expect((await settleK1AwaitingCoin(ALICE, NIGHT, 'tx-withdraw', silent)).outcome).toBe(
      'unavailable',
    );
    /* Still there, with the transaction to ask about again — after a reload,
       or tomorrow. */
    expect(awaitingK1Coins(ALICE)).toHaveLength(1);
    const answered = vi.fn<K1CommitmentWindowReader>().mockResolvedValue({
      startIndex: 3,
      endIndex: 4,
    });
    expect((await settleK1AwaitingCoin(ALICE, NIGHT, 'tx-withdraw', answered)).outcome).toBe(
      'learned',
    );
    expect(heldK1Coin(ALICE, NIGHT)?.mtIndex).toBe(3n);
  });

  it('says so when asked about a colour with nothing waiting', async () => {
    const reader = vi.fn<K1CommitmentWindowReader>();
    const outcome = await settleK1AwaitingCoin(ALICE, MUSD, 'tx-withdraw', reader);
    expect(outcome.outcome).toBe('refused');
    expect(outcome).toHaveProperty('reason');
    expect(reader).not.toHaveBeenCalled();
  });

  it('promotes the queue only when the spend left no change at all', () => {
    enqueueK1Coin(ALICE, coin({ value: 100n }));
    enqueueK1Coin(ALICE, coin({ value: 250n, nonce: 'a1'.repeat(32), mtIndex: 43n }));
    /* With change: the queued coin stays queued, so the change does not land
       behind it and the balance does not jump about. */
    rememberK1ChangeCoin(ALICE, NIGHT, CHANGE, 'tx-withdraw');
    expect(heldK1Coin(ALICE, NIGHT)).toBeNull();
    expect(queuedK1Coins(ALICE, NIGHT)).toHaveLength(1);

    forgetK1Account(ALICE);
    enqueueK1Coin(ALICE, coin({ value: 100n }));
    enqueueK1Coin(ALICE, coin({ value: 250n, nonce: 'a1'.repeat(32), mtIndex: 43n }));
    rememberK1ChangeCoin(ALICE, NIGHT, null, 'tx-withdraw');
    expect(heldK1Coin(ALICE, NIGHT)?.value).toBe(250n);
    expect(awaitingK1Coins(ALICE)).toEqual([]);
  });

  it('refuses a change coin it could never look up, and a colour it cannot read', () => {
    expect(() => rememberK1ChangeCoin(ALICE, NIGHT, CHANGE, '  ')).toThrow(/transaction/);
    expect(() => rememberK1ChangeCoin(ALICE, NIGHT, { ...CHANGE, nonce: 'short' }, 'tx')).toThrow(
      /64-hex/,
    );
    expect(() => rememberK1ChangeCoin(ALICE, 'nope', null, 'tx')).toThrow(/Not a colour/);
    expect(awaitingK1Coins(ALICE)).toEqual([]);
  });

  /* THE DEFECT THESE CATCH LOST A COIN OUTRIGHT, and the sequence that produced
     it is an ordinary one: spend, be paid, spend again. `awaiting` held one row
     per colour, the second spend's change landed on the first's row, and the
     row it replaced was the only description of that coin anywhere — the chain
     carries the note and not its nonce, value, or transaction. The account was
     then holding money nobody could ever move, with nothing on screen saying
     so. */
  describe('two coins of one colour waiting at once', () => {
    const SECOND = { colour: NIGHT, nonce: '5c'.repeat(32), value: 10n };

    it('keeps both, and settles each against its own transaction', async () => {
      putK1Coin(ALICE, coin({ value: 100n, mtIndex: 5n }));
      rememberK1ChangeCoin(ALICE, NIGHT, CHANGE, 'tx-one');
      /* A delivery arrives and takes the held slot the spend emptied... */
      expect(enqueueK1Coin(ALICE, coin({ nonce: 'a4'.repeat(32), value: 40n, mtIndex: 6n }))).toBe(
        'held',
      );
      /* ...and is itself spent, so the colour has two coins in flight. */
      rememberK1ChangeCoin(ALICE, NIGHT, SECOND, 'tx-two');

      expect(awaitingK1Coins(ALICE)).toEqual([
        { colour: NIGHT, nonce: OTHER_NONCE, value: 60n, txId: 'tx-one' },
        { colour: NIGHT, nonce: SECOND.nonce, value: 10n, txId: 'tx-two' },
      ]);

      /* The second transaction answers; the FIRST coin stays exactly where it
         is, rather than being filed at the second one's position or dropped. */
      const reader = vi
        .fn<K1CommitmentWindowReader>()
        .mockImplementation((txId) =>
          Promise.resolve(txId === 'tx-two' ? { startIndex: 11, endIndex: 12 } : null),
        );
      expect((await settleK1AwaitingCoin(ALICE, NIGHT, 'tx-two', reader)).outcome).toBe('learned');
      expect(heldK1Coin(ALICE, NIGHT)).toEqual({
        colour: NIGHT,
        nonce: SECOND.nonce,
        value: 10n,
        mtIndex: 11n,
      });
      expect(awaitingK1Coins(ALICE)).toEqual([
        { colour: NIGHT, nonce: OTHER_NONCE, value: 60n, txId: 'tx-one' },
      ]);
    });

    it('renames the row it is told to, and leaves the other one alone', () => {
      rememberK1ChangeCoin(ALICE, NIGHT, CHANGE, 'identifier-one');
      rememberK1ChangeCoin(ALICE, NIGHT, SECOND, 'identifier-two');
      renameK1AwaitingTx(ALICE, NIGHT, 'identifier-two', 'hash-two');
      expect(awaitingK1Coins(ALICE).map((row) => row.txId)).toEqual([
        'identifier-one',
        'hash-two',
      ]);
      /* An id nothing is filed under renames nothing at all. */
      renameK1AwaitingTx(ALICE, NIGHT, 'identifier-three', 'hash-three');
      expect(awaitingK1Coins(ALICE).map((row) => row.txId)).toEqual([
        'identifier-one',
        'hash-two',
      ]);
    });

    it('stores the same coin once, however many times a resumed run offers it', () => {
      rememberK1ChangeCoin(ALICE, NIGHT, CHANGE, 'tx-one');
      rememberK1ChangeCoin(ALICE, NIGHT, CHANGE, 'tx-one');
      expect(awaitingK1Coins(ALICE)).toHaveLength(1);
    });

    /* Candidates go into a colour's held slot or nowhere, so a colour that is
       already holding something has nowhere to put them. The row WAITS for the
       slot: dropping it would drop the only description of the coin, which is
       the whole defect above in a second costume. */
    it('keeps a row whose candidates could not be stored', async () => {
      putK1Coin(ALICE, coin({ nonce: 'a4'.repeat(32), value: 40n, mtIndex: 6n }));
      rememberK1ChangeCoin(ALICE, MUSD, { colour: MUSD, nonce: OTHER_NONCE, value: 60n }, 'tx-m');
      enqueueK1Coin(ALICE, { colour: MUSD, nonce: 'b7'.repeat(32), value: 5n, mtIndex: 2n });
      const reader = vi
        .fn<K1CommitmentWindowReader>()
        .mockResolvedValue({ startIndex: 8, endIndex: 10 });

      expect(await settleK1AwaitingCoin(ALICE, MUSD, 'tx-m', reader)).toEqual({
        outcome: 'ambiguous',
        candidates: [8n, 9n],
        stored: false,
      });
      expect(awaitingK1Coins(ALICE)).toEqual([
        { colour: MUSD, nonce: OTHER_NONCE, value: 60n, txId: 'tx-m' },
      ]);
    });
  });

  it('reads a stored list that names the same coin twice as one coin', () => {
    seed({
      [k1AccountKey(ALICE)]: {
        ...EMPTY_STORE,
        awaiting: {
          [NIGHT]: [
            { nonceHex: OTHER_NONCE, colorHex: NIGHT, value: '60', txId: 'tx-one' },
            { nonceHex: OTHER_NONCE, colorHex: NIGHT, value: '60', txId: 'tx-one-again' },
          ],
        },
      },
    });
    /* The FIRST wins, and the duplicate goes: two rows for one coin is the
       same value counted twice in the figure of what is still arriving. */
    expect(awaitingK1Coins(ALICE)).toEqual([
      { colour: NIGHT, nonce: OTHER_NONCE, value: 60n, txId: 'tx-one' },
    ]);
  });

  /* ANOTHER TAB, OR A RESET, WHILE THE INDEXER WAS BEING ASKED. The settle
     reads the row, asks the chain, and writes afterwards — and the store it
     writes to is whatever is there by then. It must not throw at somebody
     mid-payment over a row that has already gone. */
  it('does not throw when the row it was settling vanished while it asked', async () => {
    rememberK1ChangeCoin(ALICE, NIGHT, CHANGE, 'tx-withdraw');
    const reader = vi.fn<K1CommitmentWindowReader>().mockImplementation(() => {
      forgetK1Account(ALICE);
      return Promise.resolve({ startIndex: 8, endIndex: 9 });
    });
    expect((await settleK1AwaitingCoin(ALICE, NIGHT, 'tx-withdraw', reader)).outcome).toBe(
      'learned',
    );
    expect(awaitingK1Coins(ALICE)).toEqual([]);
    expect(heldK1Coin(ALICE, NIGHT)?.mtIndex).toBe(8n);
  });

  /* A STORE WRITTEN BY THE BUILD BEFORE THE LIST. One row per colour, filed as
     a bare object. It must come back whole — the coin, its value, and the
     transaction to look it up by — or the upgrade itself is the thing that
     loses the money. */
  it('reads an older store written with a single awaiting row per colour', async () => {
    seed({
      [k1AccountKey(ALICE)]: {
        ...EMPTY_STORE,
        awaiting: {
          [NIGHT]: { nonceHex: OTHER_NONCE, colorHex: NIGHT, value: '60', txId: 'tx-old' },
          [MUSD]: { nonceHex: NONCE, colorHex: MUSD, value: '7', txId: 'tx-older' },
        },
      },
    });
    expect(awaitingK1Coins(ALICE)).toEqual([
      { colour: NIGHT, nonce: OTHER_NONCE, value: 60n, txId: 'tx-old' },
      { colour: MUSD, nonce: NONCE, value: 7n, txId: 'tx-older' },
    ]);

    /* And it settles and appends like any other row, so nothing about the old
       shape survives the first write. */
    const reader = vi
      .fn<K1CommitmentWindowReader>()
      .mockResolvedValue({ startIndex: 4, endIndex: 5 });
    expect((await settleK1AwaitingCoin(ALICE, NIGHT, 'tx-old', reader)).outcome).toBe('learned');
    expect(heldK1Coin(ALICE, NIGHT)?.mtIndex).toBe(4n);
    rememberK1ChangeCoin(ALICE, MUSD, { colour: MUSD, nonce: OTHER_NONCE, value: 1n }, 'tx-new');
    expect(awaitingK1Coins(ALICE).filter((row) => row.colour === MUSD)).toEqual([
      { colour: MUSD, nonce: NONCE, value: 7n, txId: 'tx-older' },
      { colour: MUSD, nonce: OTHER_NONCE, value: 1n, txId: 'tx-new' },
    ]);
  });

  it('drops an awaiting row a blob left behind that cannot be looked up', () => {
    seed({
      [k1AccountKey(ALICE)]: {
        coins: {},
        awaiting: {
          [NIGHT]: { nonceHex: NONCE, colorHex: NIGHT, value: '60', txId: 'tx-1' },
          [MUSD]: { nonceHex: NONCE, colorHex: MUSD, value: '60' },
          ['ee'.repeat(32)]: { nonceHex: NONCE, colorHex: 'ff'.repeat(32), value: '1', txId: 'x' },
          bad_colour_key: { nonceHex: NONCE, colorHex: NIGHT, value: '1', txId: 'x' },
          ['dd'.repeat(32)]: 'not an object',
        },
      },
    });
    expect(awaitingK1Coins(ALICE)).toEqual([
      { colour: NIGHT, nonce: NONCE, value: 60n, txId: 'tx-1' },
    ]);
  });
});

describe('change this build could not describe', () => {
  const TX = 'ab'.repeat(33);

  /* THE DEFECT THIS CATCHES made a Passport quietly stop showing a token it had
     been paid. The value moved, the circuit's return value could not be read,
     and the colour was recorded as spent and vanished — with nothing to say a
     payment had gone out or which transaction took it. */
  it('keeps the colour and the transaction, rather than losing both', () => {
    putK1Coin(ALICE, coin({ value: 100n, mtIndex: 3n }));
    rememberK1ChangeCoin(ALICE, NIGHT, 'unreadable', TX);

    expect(k1UnreadChanges(ALICE)).toEqual([{ colour: NIGHT, txId: TX }]);
    /* The spend is still recorded in full: the coin is gone and its nonce is
       remembered, so the inbox walk cannot resurrect it. */
    expect(heldK1Coin(ALICE, NIGHT)).toBeNull();
    expect(isK1NonceSpent(ALICE, NONCE)).toBe(true);
    /* And nothing is claimed to be arriving, because nothing is described. */
    expect(awaitingK1Coins(ALICE)).toEqual([]);
  });

  /* A later spend of the same colour that CAN be described clears the row. */
  it('clears the row once a spend of that colour comes back readable', () => {
    putK1Coin(ALICE, coin({ value: 100n, mtIndex: 3n }));
    rememberK1ChangeCoin(ALICE, NIGHT, 'unreadable', TX);
    putK1Coin(ALICE, coin({ nonce: OTHER_NONCE, value: 40n, mtIndex: 4n }));
    rememberK1ChangeCoin(
      ALICE,
      NIGHT,
      { colour: NIGHT, nonce: NONCE, value: 10n },
      'cd'.repeat(33),
    );
    expect(k1UnreadChanges(ALICE)).toEqual([]);
  });

  it('is empty for an account that has never had one', () => {
    expect(k1UnreadChanges(ALICE)).toEqual([]);
  });

  /* Read back the way every other row is: a stored blob this build did not
     write must not throw, and a row that is not a transaction is dropped. */
  it('drops unreadable rows when the stored blob is read back', () => {
    window.localStorage.setItem(
      'passport-k1-coins:v1',
      JSON.stringify({
        [k1AccountKey(ALICE)]: {
          coins: {},
          unreadChange: {
            [NIGHT]: TX,
            'not-a-colour': TX,
            [OTHER_NONCE]: '',
            ['cd'.repeat(32)]: 17,
          },
        },
      }),
    );
    expect(k1UnreadChanges(ALICE)).toEqual([{ colour: NIGHT, txId: TX }]);
  });

  it('survives an unreadChange field that is not an object', () => {
    window.localStorage.setItem(
      'passport-k1-coins:v1',
      JSON.stringify({ [k1AccountKey(ALICE)]: { coins: {}, unreadChange: 'nonsense' } }),
    );
    expect(k1UnreadChanges(ALICE)).toEqual([]);
  });
});

describe('re-filing an awaiting coin under the chain hash', () => {
  const TX = 'ab'.repeat(33);
  const CHANGE = { colour: NIGHT, nonce: OTHER_NONCE, value: 60n };

  it('does nothing when there is no transaction to file it under', () => {
    putK1Coin(ALICE, coin());
    rememberK1ChangeCoin(ALICE, NIGHT, CHANGE, 'midnight-js-identifier');
    renameK1AwaitingTx(ALICE, NIGHT, 'midnight-js-identifier', '');
    renameK1AwaitingTx(ALICE, NIGHT, 'midnight-js-identifier', '   ');
    renameK1AwaitingTx(ALICE, NIGHT, 'midnight-js-identifier', 17 as unknown as string);
    expect(awaitingK1Coins(ALICE)[0].txId).toBe('midnight-js-identifier');
  });

  it('does nothing when nothing of that colour is waiting', () => {
    renameK1AwaitingTx(ALICE, NIGHT, 'midnight-js-identifier', TX);
    expect(awaitingK1Coins(ALICE)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Settling a row that is still filed under midnight-js's identifier          */
/* -------------------------------------------------------------------------- */

/**
 * WHAT THIS PROTECTS: the change coin of a spend whose indexer was more than
 * ten seconds behind.
 *
 * `resolveTransactionHash` polls for ten seconds and then RETURNS THE
 * IDENTIFIER it was given — not a failure, and indistinguishable from an answer
 * at the call site. The row was therefore left filed under a name the indexer
 * answers no commitment window for, nothing renamed it afterwards, and the
 * change read "arriving" for the rest of the account's life with the value in
 * it (review, 2026/09/18).
 */
describe('a coin still waiting under the identifier it was filed with', () => {
  const IDENTIFIER = 'cd'.repeat(33);
  const HASH = 'ef'.repeat(32);
  const CHANGE = { colour: NIGHT, nonce: OTHER_NONCE, value: 60n };

  it('knows a chain hash from one of midnight-js’s identifiers', () => {
    expect(k1AwaitingTxNeedsChainHash(HASH)).toBe(false);
    expect(k1AwaitingTxNeedsChainHash(` ${HASH.toUpperCase()} `)).toBe(false);
    expect(k1AwaitingTxNeedsChainHash(IDENTIFIER)).toBe(true);
    expect(k1AwaitingTxNeedsChainHash('tx-1')).toBe(true);
    expect(k1AwaitingTxNeedsChainHash('')).toBe(true);
    expect(k1AwaitingTxNeedsChainHash(undefined as unknown as string)).toBe(true);
  });

  it('is renamed to the hash and settled on the next read once the indexer answers', async () => {
    putK1Coin(ALICE, coin());
    rememberK1ChangeCoin(ALICE, NIGHT, CHANGE, IDENTIFIER);
    const window = vi
      .fn<K1CommitmentWindowReader>()
      .mockResolvedValue({ startIndex: 12, endIndex: 13 });
    const resolve = vi.fn<(txId: string) => Promise<string | null>>().mockResolvedValue(HASH);

    const outcome = await settleK1AwaitingCoinByChainHash(
      ALICE,
      NIGHT,
      IDENTIFIER,
      resolve,
      window,
    );

    expect(outcome.outcome).toBe('learned');
    expect(resolve).toHaveBeenCalledWith(IDENTIFIER);
    /* THE QUESTION IS ASKED ABOUT THE HASH, never the identifier. */
    expect(window).toHaveBeenCalledWith(HASH);
    expect(heldK1Coin(ALICE, NIGHT)?.mtIndex).toBe(12n);
    expect(awaitingK1Coins(ALICE)).toEqual([]);
  });

  it('asks nothing about a position while the indexer cannot name the transaction', async () => {
    putK1Coin(ALICE, coin());
    rememberK1ChangeCoin(ALICE, NIGHT, CHANGE, IDENTIFIER);
    const window = vi.fn<K1CommitmentWindowReader>().mockResolvedValue(null);

    for (const answer of [null, IDENTIFIER, ` ${IDENTIFIER} `, 'still-not-a-hash']) {
      const outcome = await settleK1AwaitingCoinByChainHash(
        ALICE,
        NIGHT,
        IDENTIFIER,
        () => Promise.resolve(answer),
        window,
      );
      expect(outcome.outcome).toBe('unavailable');
    }
    /* The row is still here, with its description and its identifier, which is
       what makes a read tomorrow the remedy it ought to be. */
    expect(window).not.toHaveBeenCalled();
    expect(awaitingK1Coins(ALICE)).toEqual([
      { colour: NIGHT, nonce: OTHER_NONCE, value: 60n, txId: IDENTIFIER },
    ]);
  });

  it('asks nobody to name a row that is already filed under a chain hash', async () => {
    putK1Coin(ALICE, coin());
    rememberK1ChangeCoin(ALICE, NIGHT, CHANGE, HASH);
    const window = vi
      .fn<K1CommitmentWindowReader>()
      .mockResolvedValue({ startIndex: 3, endIndex: 4 });
    const resolve = vi.fn<(txId: string) => Promise<string | null>>().mockResolvedValue(null);

    const outcome = await settleK1AwaitingCoinByChainHash(ALICE, NIGHT, HASH, resolve, window);

    expect(outcome.outcome).toBe('learned');
    expect(resolve).not.toHaveBeenCalled();
    expect(window).toHaveBeenCalledWith(HASH);
  });
});

describe('a delivery of a coin that is already queued', () => {
  /* The held slot holds another coin and the QUEUE holds this one: still not
     news, and still not worth a question to the indexer. */
  it('is known, and the chain is not asked', async () => {
    putK1Coin(ALICE, coin({ value: 100n, mtIndex: 3n }));
    enqueueK1Coin(ALICE, { colour: NIGHT, nonce: OTHER_NONCE, value: 25n, mtIndex: 9n });
    const ask = vi.fn<K1CommitmentWindowReader>();

    expect(
      await reconcileK1CoinFromChain(
        ALICE,
        { colour: NIGHT, nonce: OTHER_NONCE, value: 25n, txId: 'ab'.repeat(33) },
        ask,
      ),
    ).toEqual({ outcome: 'known', nonce: OTHER_NONCE });
    expect(ask).not.toHaveBeenCalled();
  });
});
