/**
 * THE FIVE THINGS THE COIN STORE MUST NEVER STOP BEING TRUE, held against
 * every write path and against two hundred of them in a row.
 *
 * WHAT THIS PROTECTS, AND WHY IT IS A SECOND FILE
 * -----------------------------------------------
 * `./k1CoinStore.test.ts` drills each write against the case it was written
 * for. This file drills them against EACH OTHER: a spend landing on a colour
 * that already has a queue, a candidate list surviving a write that should
 * have cleared it, a private state handed back by midnight-js arriving before
 * or after the app's own write. Those orderings are where a qualified
 * description goes missing, and a description that goes missing is a coin
 * nobody — not the holder, not this repository, not anybody — can ever move
 * again, because the chain does not carry one.
 *
 * The invariants, named once here and asserted after every single write below:
 *
 *   (a) a nonce recorded as SPENT is never in `coins`, `queued`, or `awaiting`;
 *   (b) a colour holds at most one spendable coin, and that coin's colour is
 *       the key it is filed under;
 *   (c) the balance of a colour is held + queued, and counts neither the
 *       coins awaiting a position nor a candidate list;
 *   (d) a colour with candidates outstanding has its current guess at the head
 *       of the list — a guess is stored as a guess, never as a fact;
 *   (e) no row survives a round-trip with a nonce or colour that is not 64 hex
 *       characters, or a value or position that is not a decimal integer.
 *
 * NO NEW DEPENDENCY. The randomised run uses a mulberry32 generator written
 * out below, seeded, so a failure names a seed somebody can re-run rather than
 * a shape nobody can reproduce.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  advanceK1CoinCandidate,
  awaitingK1Coins,
  dropK1Coin,
  enqueueK1Coin,
  heldK1Coin,
  isK1NonceSpent,
  k1AccountKey,
  k1CoinCandidates,
  k1ColourBalance,
  k1PrivateStateProvider,
  loadK1CoinStore,
  putK1Coin,
  putK1CoinCandidates,
  queuedK1Coins,
  rememberK1ChangeCoin,
  rememberK1EncSecretKey,
  replaceK1Coin,
  settleK1AwaitingCoin,
  settleK1Coin,
  type K1Account,
  type K1CoinStoreState,
  type K1HeldCoin,
} from './k1CoinStore.js';

const STORAGE_KEY = 'passport-k1-coins:v1';

const ALICE: K1Account = { network: 'stagenet', address: 'ab'.repeat(32) };
const BOB: K1Account = { network: 'stagenet', address: 'cd'.repeat(32) };
const ALICE_ON_PREVIEW: K1Account = { network: 'preview', address: 'ab'.repeat(32) };

const NIGHT = '0'.repeat(64);
const MUSD = '1a'.repeat(32);
const OTHER = '2b'.repeat(32);

/** A distinguishable 64-hex value from a small number. Never zero-length. */
function hex64(seed: number): string {
  return seed.toString(16).padStart(2, '0').repeat(32).slice(0, 64);
}

function coin(patch: Partial<K1HeldCoin> = {}): K1HeldCoin {
  return { colour: MUSD, nonce: hex64(0x7f), value: 100n, mtIndex: 42n, ...patch };
}

/* -------------------------------------------------------------------------- */
/* Storage                                                                    */
/* -------------------------------------------------------------------------- */

let storage: Map<string, string>;
/** Flipped mid-test by the drills that take the browser's storage away. */
let behaviour: { denyReads?: boolean; denyWrites?: boolean };

function installStorage(): void {
  storage = new Map<string, string>();
  behaviour = {};
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => {
          if (behaviour.denyReads) throw new Error('storage denied');
          return storage.get(key) ?? null;
        },
        setItem: (key: string, value: string) => {
          if (behaviour.denyWrites) throw new Error('QuotaExceededError');
          storage.set(key, value);
        },
        removeItem: (key: string) => void storage.delete(key),
      },
    },
  });
}

/** The account's whole state as it sits in storage, not as an API reads it. */
function blobFor(account: K1Account): Record<string, unknown> {
  const raw = storage.get(STORAGE_KEY);
  if (raw === undefined) return {};
  const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
  return parsed[k1AccountKey(account)] ?? {};
}

beforeEach(() => {
  installStorage();
});

/* -------------------------------------------------------------------------- */
/* The invariants                                                             */
/* -------------------------------------------------------------------------- */

const HEX64 = /^[0-9a-f]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;

/**
 * Every invariant, checked against the state as it is STORED and as the API
 * answers it, with `where` naming the write that has just happened.
 */
function expectInvariants(account: K1Account, where: string): void {
  const state = loadK1CoinStore(account);
  const spent = new Set(state.spentNonces);

  for (const [colourKey, row] of Object.entries(state.coins)) {
    /* (b) and (e). */
    expect(row.colorHex, `${where}: held row filed under the wrong colour`).toBe(colourKey);
    expect(HEX64.test(row.colorHex), `${where}: held colour ${row.colorHex}`).toBe(true);
    expect(HEX64.test(row.nonceHex), `${where}: held nonce ${row.nonceHex}`).toBe(true);
    expect(DECIMAL.test(row.value), `${where}: held value ${row.value}`).toBe(true);
    expect(DECIMAL.test(row.mtIndex), `${where}: held position ${row.mtIndex}`).toBe(true);
    /* (a). */
    expect(spent.has(row.nonceHex), `${where}: spent coin ${row.nonceHex} is held again`).toBe(
      false,
    );
    /* (d). */
    const candidates = state.mtIndexCandidates[colourKey] ?? [];
    if (candidates.length > 0) {
      expect(candidates[0], `${where}: the current guess is not the head of the list`).toBe(
        row.mtIndex,
      );
    }
  }

  for (const [colourKey, rows] of Object.entries(state.queued)) {
    expect(rows.length, `${where}: an empty queue was written back`).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.colorHex, `${where}: queued row filed under the wrong colour`).toBe(colourKey);
      expect(HEX64.test(row.nonceHex), `${where}: queued nonce ${row.nonceHex}`).toBe(true);
      expect(DECIMAL.test(row.value), `${where}: queued value ${row.value}`).toBe(true);
      expect(DECIMAL.test(row.mtIndex), `${where}: queued position ${row.mtIndex}`).toBe(true);
      expect(spent.has(row.nonceHex), `${where}: spent coin ${row.nonceHex} is queued`).toBe(false);
    }
  }

  for (const [colourKey, row] of Object.entries(state.awaiting)) {
    expect(row.colorHex, `${where}: awaiting row filed under the wrong colour`).toBe(colourKey);
    expect(HEX64.test(row.nonceHex), `${where}: awaiting nonce ${row.nonceHex}`).toBe(true);
    expect(DECIMAL.test(row.value), `${where}: awaiting value ${row.value}`).toBe(true);
    expect(row.txId.length, `${where}: an awaiting coin with nothing to look it up by`)
      .toBeGreaterThan(0);
    expect(spent.has(row.nonceHex), `${where}: spent coin ${row.nonceHex} is awaiting`).toBe(false);
  }

  /* (c). The figure a holder is shown is held + queued and nothing else. */
  for (const colour of [NIGHT, MUSD, OTHER]) {
    const held = heldK1Coin(account, colour);
    const queued = queuedK1Coins(account, colour).reduce((total, row) => total + row.value, 0n);
    expect(k1ColourBalance(account, colour), `${where}: the balance of ${colour.slice(0, 4)}`).toBe(
      (held?.value ?? 0n) + queued,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Every write path against every prior state                                 */
/* -------------------------------------------------------------------------- */

/** The prior states a write can land on, each built from the public API. */
const priorStates: { name: string; build: () => void }[] = [
  { name: 'an empty store', build: () => undefined },
  {
    name: 'a held coin',
    build: () => {
      putK1Coin(ALICE, coin({ nonce: hex64(0x11), value: 100n, mtIndex: 5n }));
    },
  },
  {
    name: 'a held coin with a queue behind it',
    build: () => {
      enqueueK1Coin(ALICE, coin({ nonce: hex64(0x11), value: 100n, mtIndex: 5n }));
      enqueueK1Coin(ALICE, coin({ nonce: hex64(0x22), value: 40n, mtIndex: 6n }));
    },
  },
  {
    name: 'a coin awaiting a position',
    build: () => {
      putK1Coin(ALICE, coin({ nonce: hex64(0x11), value: 100n, mtIndex: 5n }));
      rememberK1ChangeCoin(
        ALICE,
        MUSD,
        { colour: MUSD, nonce: hex64(0x33), value: 60n },
        'withdraw-tx',
      );
    },
  },
  {
    name: 'a coin whose position is still a guess',
    build: () => {
      putK1CoinCandidates(ALICE, { colour: MUSD, nonce: hex64(0x44), value: 80n }, [8n, 9n]);
    },
  },
  {
    name: 'a colour whose coin has already been spent',
    build: () => {
      putK1Coin(ALICE, coin({ nonce: hex64(0x11), value: 100n, mtIndex: 5n }));
      dropK1Coin(ALICE, MUSD);
    },
  },
];

/** The writes, each described by the sentence it is being held to. */
const writes: { name: string; run: () => Promise<void> | void }[] = [
  {
    name: 'replacing the held coin',
    run: () => putK1Coin(ALICE, coin({ nonce: hex64(0x55), value: 10n, mtIndex: 1n })),
  },
  { name: 'dropping the held coin', run: () => dropK1Coin(ALICE, MUSD) },
  {
    name: 'a delivery arriving',
    run: () => void enqueueK1Coin(ALICE, coin({ nonce: hex64(0x66), value: 25n, mtIndex: 2n })),
  },
  {
    name: 'a spend that left change',
    run: () =>
      rememberK1ChangeCoin(
        ALICE,
        MUSD,
        { colour: MUSD, nonce: hex64(0x77), value: 30n },
        'spend-tx',
      ),
  },
  {
    name: 'a spend that consumed the coin exactly',
    run: () => rememberK1ChangeCoin(ALICE, MUSD, null, 'spend-tx'),
  },
  {
    name: 'a spend whose change could not be described',
    run: () => rememberK1ChangeCoin(ALICE, MUSD, 'unreadable', 'spend-tx'),
  },
  {
    name: 'the change coin taking the spent one’s place',
    run: () =>
      replaceK1Coin(ALICE, MUSD, { colour: MUSD, nonce: hex64(0x88), value: 55n, mtIndex: 12n }),
  },
  {
    name: 'a spend with nothing left over',
    run: () => replaceK1Coin(ALICE, MUSD, null),
  },
  {
    name: 'two candidate positions being written down',
    run: () => putK1CoinCandidates(ALICE, { colour: MUSD, nonce: hex64(0x99), value: 70n }, [3n, 4n]),
  },
  { name: 'moving to the next candidate', run: () => void advanceK1CoinCandidate(ALICE, MUSD) },
  { name: 'settling the position a spend proved', run: () => settleK1Coin(ALICE, MUSD) },
  {
    name: 'the chain answering where an awaiting coin landed',
    run: async () => {
      await settleK1AwaitingCoin(ALICE, MUSD, () =>
        Promise.resolve({ startIndex: 21, endIndex: 22 }),
      );
    },
  },
  {
    name: 'remembering the viewing secret',
    run: () => rememberK1EncSecretKey(ALICE, 'ff'.repeat(32)),
  },
];

describe('every write, on every prior state', () => {
  for (const prior of priorStates) {
    for (const write of writes) {
      it(`keeps every invariant when ${write.name} lands on ${prior.name}`, async () => {
        prior.build();
        expectInvariants(ALICE, `before ${write.name}`);
        await write.run();
        expectInvariants(ALICE, `${write.name} on ${prior.name}`);
      });
    }
  }
});

/* -------------------------------------------------------------------------- */
/* The named consequences, rather than only the invariants                    */
/* -------------------------------------------------------------------------- */

describe('what each write leaves behind', () => {
  it('promotes the next payment only when the spend left nothing behind', () => {
    enqueueK1Coin(ALICE, coin({ nonce: hex64(0x11), value: 100n, mtIndex: 5n }));
    enqueueK1Coin(ALICE, coin({ nonce: hex64(0x22), value: 40n, mtIndex: 6n }));

    /* Change outstanding: the second payment must NOT jump the queue, or the
       change lands behind it and the balance moves about for no reason a
       holder could follow. */
    rememberK1ChangeCoin(ALICE, MUSD, { colour: MUSD, nonce: hex64(0x33), value: 60n }, 'tx-1');
    expect(heldK1Coin(ALICE, MUSD)).toBeNull();
    expect(queuedK1Coins(ALICE, MUSD).map((row) => row.nonce)).toEqual([hex64(0x22)]);

    /* Nothing left over: the queue is what the account can spend next. */
    rememberK1ChangeCoin(ALICE, MUSD, null, 'tx-2');
    expect(heldK1Coin(ALICE, MUSD)?.nonce).toBe(hex64(0x22));
    expectInvariants(ALICE, 'after the promotion');
  });

  it('never hands back a coin whose nonce a spend consumed', () => {
    putK1Coin(ALICE, coin({ nonce: hex64(0x11), value: 100n, mtIndex: 5n }));
    replaceK1Coin(ALICE, MUSD, { colour: MUSD, nonce: hex64(0x33), value: 60n, mtIndex: 9n });

    expect(isK1NonceSpent(ALICE, hex64(0x11))).toBe(true);
    /* The inbox walk re-reading the entry that first described it. */
    expect(enqueueK1Coin(ALICE, coin({ nonce: hex64(0x11), value: 100n, mtIndex: 5n }))).toBe(
      'spent',
    );
    expect(heldK1Coin(ALICE, MUSD)?.nonce).toBe(hex64(0x33));
    expectInvariants(ALICE, 'after the walk offered the spent coin back');
  });

  it('clears a candidate list that has nothing left to try, and holds the coin still', () => {
    putK1CoinCandidates(ALICE, { colour: MUSD, nonce: hex64(0x44), value: 80n }, [8n, 9n]);
    expect(advanceK1CoinCandidate(ALICE, MUSD)?.mtIndex).toBe(9n);
    /* Exhausted does not drop the coin: the description is still the only one
       that exists, and the failure may have been about something else. */
    expect(advanceK1CoinCandidate(ALICE, MUSD)).toBeNull();
    expect(heldK1Coin(ALICE, MUSD)?.nonce).toBe(hex64(0x44));
    expect(k1CoinCandidates(ALICE, MUSD)).toEqual([]);
    expectInvariants(ALICE, 'after the candidates ran out');
  });

  /**
   * DEFECT, 2026/09/17: the awaiting slot holds ONE coin per colour, and a
   * second spend of that colour overwrites the first change coin's
   * description — which exists nowhere else in the world, so the value is
   * unreachable by anybody for ever.
   *
   * REACHED BY AN ORDINARY SEQUENCE. A spend leaves change (the colour is now
   * awaiting a position); the inbox walk that runs on every Home open delivers
   * a second payment of the same colour, which takes the empty held slot; that
   * payment is spent before the indexer has answered about the first change.
   * The second `rememberK1ChangeCoin` then writes `awaiting[colour]` over the
   * first.
   *
   * NOT FIXED HERE, because it cannot be fixed in this module alone: the slot
   * has to become a list, and `settleK1AwaitingCoin` and `renameK1AwaitingTx`
   * are called per COLOUR by `./custodyContractClient.ts` — the file this
   * change is not permitted to touch. Marked failing rather than deleted so
   * the sequence is written down and the test starts passing the day the slot
   * becomes a list.
   */
  it.fails('keeps BOTH change coins when a colour is spent twice before the chain answers', () => {
    putK1Coin(ALICE, coin({ nonce: hex64(0x11), value: 100n, mtIndex: 5n }));
    rememberK1ChangeCoin(ALICE, MUSD, { colour: MUSD, nonce: hex64(0x33), value: 60n }, 'tx-1');

    /* A second payment arrives and takes the empty held slot. */
    expect(enqueueK1Coin(ALICE, coin({ nonce: hex64(0x22), value: 40n, mtIndex: 6n }))).toBe('held');
    rememberK1ChangeCoin(ALICE, MUSD, { colour: MUSD, nonce: hex64(0x44), value: 10n }, 'tx-2');

    const awaiting = awaitingK1Coins(ALICE).map((row) => row.nonce);
    expect(awaiting).toContain(hex64(0x44));
    expect(awaiting).toContain(hex64(0x33));
  });

  it('does not invent a coin out of a candidate list left behind by another build', () => {
    /* A blob with positions for a colour that holds nothing. The list must not
       become a coin, and the first read that touches it clears it. */
    storage.set(
      STORAGE_KEY,
      JSON.stringify({
        [k1AccountKey(ALICE)]: {
          encSecretKeyHex: null,
          coins: {},
          queued: {},
          spentNonces: [],
          mtIndexCandidates: { [MUSD]: ['8', '9'] },
          awaiting: {},
          unreadChange: {},
        },
      }),
    );
    expect(heldK1Coin(ALICE, MUSD)).toBeNull();
    expect(advanceK1CoinCandidate(ALICE, MUSD)).toBeNull();
    expect(k1CoinCandidates(ALICE, MUSD)).toEqual([]);
    expectInvariants(ALICE, 'after an orphan candidate list was read');
  });
});

/* -------------------------------------------------------------------------- */
/* Two hundred writes in a row                                                */
/* -------------------------------------------------------------------------- */

/**
 * mulberry32 — thirty-two bits of state, written out rather than depended on.
 *
 * A seeded generator, because a randomised drill that cannot be re-run is a
 * report of a failure nobody can look at.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('two hundred writes in a row', () => {
  for (const seed of [1, 7, 2026]) {
    it(`keeps every invariant, and never re-spends a coin (seed ${seed})`, async () => {
      const random = mulberry32(seed);
      const pick = <T,>(values: readonly T[]): T => values[Math.floor(random() * values.length)];
      const colours = [NIGHT, MUSD, OTHER];
      /* Nonces are never reused, which is what the chain guarantees and what
         makes "was this coin ever spent" a question with an answer. */
      let nextNonce = 0x100;
      const freshNonce = (): string => {
        nextNonce += 1;
        return nextNonce.toString(16).padStart(64, '0');
      };
      /* The model: every nonce this run has ever spent. Nothing more is
         modelled, because a second implementation of the store would only
         agree with the first one's bugs. */
      const everSpent = new Set<string>();

      for (let step = 0; step < 200; step += 1) {
        const colour = pick(colours);
        const before = loadK1CoinStore(ALICE);
        const heldNonce = before.coins[colour]?.nonceHex ?? null;
        const operation = Math.floor(random() * 9);
        switch (operation) {
          case 0:
            putK1Coin(ALICE, {
              colour,
              nonce: freshNonce(),
              value: BigInt(Math.floor(random() * 500) + 1),
              mtIndex: BigInt(Math.floor(random() * 50)),
            });
            break;
          case 1:
            enqueueK1Coin(ALICE, {
              colour,
              nonce: freshNonce(),
              value: BigInt(Math.floor(random() * 500) + 1),
              mtIndex: BigInt(Math.floor(random() * 50)),
            });
            break;
          case 2:
            if (heldNonce !== null) everSpent.add(heldNonce);
            dropK1Coin(ALICE, colour);
            break;
          case 3:
            if (heldNonce !== null) everSpent.add(heldNonce);
            replaceK1Coin(
              ALICE,
              colour,
              random() < 0.5
                ? null
                : {
                    colour,
                    nonce: freshNonce(),
                    value: BigInt(Math.floor(random() * 400) + 1),
                    mtIndex: BigInt(Math.floor(random() * 50)),
                  },
            );
            break;
          case 4: {
            if (heldNonce !== null) everSpent.add(heldNonce);
            const roll = random();
            rememberK1ChangeCoin(
              ALICE,
              colour,
              roll < 0.2
                ? null
                : roll < 0.3
                  ? 'unreadable'
                  : {
                      colour,
                      nonce: freshNonce(),
                      value: BigInt(Math.floor(random() * 400) + 1),
                    },
              `tx-${step}`,
            );
            break;
          }
          case 5:
            putK1CoinCandidates(
              ALICE,
              { colour, nonce: freshNonce(), value: BigInt(Math.floor(random() * 300) + 1) },
              [BigInt(Math.floor(random() * 50)), BigInt(Math.floor(random() * 50) + 60)],
            );
            break;
          case 6:
            advanceK1CoinCandidate(ALICE, colour);
            break;
          case 7:
            settleK1Coin(ALICE, colour);
            break;
          default: {
            const windowRoll = random();
            await settleK1AwaitingCoin(ALICE, colour, () =>
              Promise.resolve(
                windowRoll < 0.3
                  ? null
                  : windowRoll < 0.7
                    ? { startIndex: step, endIndex: step + 1 }
                    : { startIndex: step, endIndex: step + 2 },
              ),
            );
            break;
          }
        }

        expectInvariants(ALICE, `seed ${seed}, step ${step}, operation ${operation}`);
        /* THE ONE RULE A SEQUENCE CAN BREAK THAT A SINGLE WRITE CANNOT: a coin
           that was ever spent coming back as spendable, by any route. */
        const after = loadK1CoinStore(ALICE);
        for (const nonce of everSpent) {
          for (const row of Object.values(after.coins)) {
            expect(row.nonceHex, `seed ${seed}, step ${step}: ${nonce} is spendable again`).not.toBe(
              nonce,
            );
          }
          for (const rows of Object.values(after.queued)) {
            for (const row of rows) {
              expect(row.nonceHex, `seed ${seed}, step ${step}: ${nonce} is queued again`).not.toBe(
                nonce,
              );
            }
          }
        }
      }
    });
  }
});

/* -------------------------------------------------------------------------- */
/* The private state midnight-js hands back                                   */
/* -------------------------------------------------------------------------- */

describe('a private state written back over the app’s own writes', () => {
  const HELD = coin({ nonce: hex64(0x11), value: 100n, mtIndex: 5n });
  const CHANGE = { colour: MUSD, nonce: hex64(0x33), value: 60n, mtIndex: 9n };

  /** A private state of the shape midnight-js round-trips. */
  function incoming(coins: Record<string, unknown>): unknown {
    return { encSecretKeyHex: null, coins, queued: {}, spentNonces: [], mtIndexCandidates: {} };
  }

  const rowOf = (row: K1HeldCoin) => ({
    nonceHex: row.nonce,
    colorHex: row.colour,
    value: row.value.toString(),
    mtIndex: row.mtIndex.toString(),
  });

  /* Each case is described by what the incoming state carries, and by what
     must survive it whichever order the two writes land in. */
  const cases: {
    name: string;
    state: unknown;
    /** What the store must hold in mUSD afterwards, by nonce, or null. */
    survivor: string | null;
  }[] = [
    { name: 'nothing about the held coin', state: incoming({}), survivor: CHANGE.nonce },
    {
      name: 'the coin the spend consumed',
      state: incoming({ [MUSD]: rowOf(HELD) }),
      survivor: CHANGE.nonce,
    },
    {
      name: 'the same colour at a different position',
      state: incoming({ [MUSD]: { ...rowOf(CHANGE), mtIndex: '999' } }),
      survivor: CHANGE.nonce,
    },
    {
      name: 'a colour the store knows nothing about',
      state: incoming({ [OTHER]: rowOf({ ...CHANGE, colour: OTHER, nonce: hex64(0x44) }) }),
      survivor: CHANGE.nonce,
    },
    { name: 'no coins at all', state: incoming({}), survivor: CHANGE.nonce },
    { name: 'something that is not a private state', state: 'nonsense', survivor: CHANGE.nonce },
    { name: 'null', state: null, survivor: CHANGE.nonce },
  ];

  for (const testCase of cases) {
    it(`keeps the change when the state carrying ${testCase.name} lands AFTER the spend`, async () => {
      const provider = k1PrivateStateProvider(ALICE);
      putK1Coin(ALICE, HELD);
      replaceK1Coin(ALICE, MUSD, CHANGE);
      await provider.set(provider.privateStateId, testCase.state);

      expect(heldK1Coin(ALICE, MUSD)?.nonce).toBe(testCase.survivor);
      expect(heldK1Coin(ALICE, MUSD)?.mtIndex).toBe(CHANGE.mtIndex);
      expectInvariants(ALICE, `the state carrying ${testCase.name} landed after the spend`);
    });

    it(`keeps the change when the state carrying ${testCase.name} lands BEFORE the spend`, async () => {
      const provider = k1PrivateStateProvider(ALICE);
      putK1Coin(ALICE, HELD);
      await provider.set(provider.privateStateId, testCase.state);
      replaceK1Coin(ALICE, MUSD, CHANGE);

      expect(heldK1Coin(ALICE, MUSD)?.nonce).toBe(testCase.survivor);
      expectInvariants(ALICE, `the state carrying ${testCase.name} landed before the spend`);
    });
  }

  it('takes a colour the store does not hold from the incoming state, and only then', async () => {
    const provider = k1PrivateStateProvider(ALICE);
    const stranger = { colour: OTHER, nonce: hex64(0x44), value: 15n, mtIndex: 3n };
    await provider.set(
      provider.privateStateId,
      incoming({ [OTHER]: rowOf(stranger) }),
    );
    expect(heldK1Coin(ALICE, OTHER)?.nonce).toBe(stranger.nonce);
    expectInvariants(ALICE, 'a coin arrived through the private state');
  });

  it('ignores a row whose colour does not agree with the key it arrived under', async () => {
    const provider = k1PrivateStateProvider(ALICE);
    await provider.set(
      provider.privateStateId,
      incoming({ [OTHER]: rowOf(coin({ nonce: hex64(0x55) })) }),
    );
    expect(heldK1Coin(ALICE, OTHER)).toBeNull();
    expect(heldK1Coin(ALICE, MUSD)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* A browser that will not remember anything                                  */
/* -------------------------------------------------------------------------- */

describe('storage that refuses', () => {
  it('answers empty rather than throwing when reads are denied', () => {
    putK1Coin(ALICE, coin());
    behaviour.denyReads = true;

    expect(() => heldK1Coin(ALICE, MUSD)).not.toThrow();
    expect(heldK1Coin(ALICE, MUSD)).toBeNull();
    expect(k1ColourBalance(ALICE, MUSD)).toBe(0n);
    expect(awaitingK1Coins(ALICE)).toEqual([]);
    expect(isK1NonceSpent(ALICE, hex64(0x11))).toBe(false);
    /* And a write against a store it cannot read still does not throw at the
       caller — a spend must not fail because a browser is in private mode. */
    expect(() => putK1Coin(ALICE, coin({ nonce: hex64(0x22) }))).not.toThrow();
  });

  it('carries on through a quota that runs out mid-sequence', async () => {
    putK1Coin(ALICE, coin({ nonce: hex64(0x11), value: 100n, mtIndex: 5n }));
    behaviour.denyWrites = true;

    /* Every writer, against a browser that has stopped accepting writes. Not
       one of them may throw: the coin is still described by whatever the
       caller holds, and a throw here turns a lost memory into a lost payment. */
    expect(() => replaceK1Coin(ALICE, MUSD, { ...coin({ nonce: hex64(0x33) }) })).not.toThrow();
    expect(() => dropK1Coin(ALICE, MUSD)).not.toThrow();
    expect(() => enqueueK1Coin(ALICE, coin({ nonce: hex64(0x44) }))).not.toThrow();
    expect(() =>
      rememberK1ChangeCoin(ALICE, MUSD, { colour: MUSD, nonce: hex64(0x55), value: 1n }, 'tx'),
    ).not.toThrow();
    expect(() => settleK1Coin(ALICE, MUSD)).not.toThrow();
    expect(() => rememberK1EncSecretKey(ALICE, 'ab'.repeat(32))).not.toThrow();
    await expect(
      settleK1AwaitingCoin(ALICE, MUSD, () => Promise.resolve({ startIndex: 1, endIndex: 2 })),
    ).resolves.toBeDefined();

    /* And the session still answers with the last state that DID land, rather
       than with a half-written one. */
    expect(heldK1Coin(ALICE, MUSD)?.nonce).toBe(hex64(0x11));
    expectInvariants(ALICE, 'after the quota ran out');
  });
});

/* -------------------------------------------------------------------------- */
/* Two accounts, two networks, one browser                                    */
/* -------------------------------------------------------------------------- */

describe('one browser holding more than one account', () => {
  it('keeps each account’s coins, spends, and awaiting rows to itself', () => {
    putK1Coin(ALICE, coin({ nonce: hex64(0x11), value: 100n, mtIndex: 5n }));
    putK1Coin(BOB, coin({ nonce: hex64(0x22), value: 200n, mtIndex: 6n }));
    putK1Coin(ALICE_ON_PREVIEW, coin({ nonce: hex64(0x33), value: 300n, mtIndex: 7n }));

    replaceK1Coin(ALICE, MUSD, null);

    expect(heldK1Coin(ALICE, MUSD)).toBeNull();
    expect(heldK1Coin(BOB, MUSD)?.value).toBe(200n);
    /* The same address on another chain is another account: a stagenet
       position used against preview is a proof that cannot be satisfied. */
    expect(heldK1Coin(ALICE_ON_PREVIEW, MUSD)?.value).toBe(300n);
    expect(isK1NonceSpent(ALICE, hex64(0x11))).toBe(true);
    expect(isK1NonceSpent(BOB, hex64(0x11))).toBe(false);
    expect(isK1NonceSpent(ALICE_ON_PREVIEW, hex64(0x11))).toBe(false);

    for (const account of [ALICE, BOB, ALICE_ON_PREVIEW]) {
      expectInvariants(account, 'after a spend on one of three accounts');
    }
  });

  it('gives each account its own private-state provider, serving only its own coins', async () => {
    putK1Coin(ALICE, coin({ nonce: hex64(0x11), value: 100n, mtIndex: 5n }));
    putK1Coin(BOB, coin({ nonce: hex64(0x22), value: 200n, mtIndex: 6n }));

    const alice = k1PrivateStateProvider(ALICE);
    const bob = k1PrivateStateProvider(BOB);
    expect(alice.privateStateId).not.toBe(bob.privateStateId);

    const served = (await alice.get(alice.privateStateId)) as K1CoinStoreState;
    expect(Object.values(served.coins).map((row) => row.nonceHex)).toEqual([hex64(0x11)]);

    /* Bob's connection clearing its own state must not touch Alice's. */
    await bob.remove(bob.privateStateId);
    expect(heldK1Coin(BOB, MUSD)).toBeNull();
    expect(heldK1Coin(ALICE, MUSD)?.nonce).toBe(hex64(0x11));
  });

  it('keeps a blob it cannot read from taking another account’s coins with it', () => {
    putK1Coin(ALICE, coin({ nonce: hex64(0x11), value: 100n, mtIndex: 5n }));
    const raw = JSON.parse(storage.get(STORAGE_KEY) as string) as Record<string, unknown>;
    raw[k1AccountKey(BOB)] = 'not an account state at all';
    storage.set(STORAGE_KEY, JSON.stringify(raw));

    expect(heldK1Coin(ALICE, MUSD)?.value).toBe(100n);
    expect(heldK1Coin(BOB, MUSD)).toBeNull();
    expect(blobFor(ALICE).coins).toBeDefined();
  });
});
