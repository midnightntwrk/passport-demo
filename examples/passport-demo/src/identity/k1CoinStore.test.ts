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
  forgetK1Account,
  heldK1Coin,
  k1AccountKey,
  k1PrivateStateId,
  k1PrivateStateProvider,
  listK1Coins,
  loadK1CoinStore,
  putK1Coin,
  dropK1Coin,
  reconcileK1CoinFromChain,
  refuseK1Account,
  refuseK1Coin,
  rememberK1EncSecretKey,
  replaceK1Coin,
  type K1Account,
  type K1CommitmentWindow,
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
    expect(loadK1CoinStore({ network: '', address: ALICE.address })).toEqual({
      encSecretKeyHex: null,
      coins: {},
    });
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
    expect(loadK1CoinStore(ALICE)).toEqual({ encSecretKeyHex: 'ab', coins: {} });
    expect(loadK1CoinStore(BOB)).toEqual({ encSecretKeyHex: null, coins: {} });
    expect(loadK1CoinStore(ALICE_ON_PREVIEW)).toEqual({ encSecretKeyHex: null, coins: {} });
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
      coin: { colour: NIGHT, nonce: OTHER_NONCE, value: 100n, mtIndex: 51n },
    });
  });

  it('stores NOTHING when the transaction had several outputs, and hands back every candidate', async () => {
    const result = await reconcileK1CoinFromChain(
      ALICE,
      { colour: NIGHT, nonce: NONCE, value: 100n, txId: TX },
      reader({ startIndex: 4, endIndex: 7 }),
    );
    expect(result).toEqual({ outcome: 'ambiguous', candidates: [4n, 5n, 6n] });
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
      encSecretKeyHex: null,
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

    await provider.set(provider.privateStateId, { coins: {}, encSecretKeyHex: 12 });
    expect(loadK1CoinStore(ALICE).encSecretKeyHex).toBeNull();
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
