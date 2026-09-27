/**
 * The held-coin check (2026/09/26): a Passport counts, and offers to a
 * payment, only the coins the chain says it still holds.
 *
 * The defect these drill: a device that walked the inbox with an earlier key —
 * one the sign-in gave back, or a synced passkey re-derived — filed the
 * notes of coins another device had already sent. Home counted them, and a
 * payment drawn on one was refused by the node at the end of a whole proof.
 *
 * The nullifier is held to the compiled build's own method and to the ledger's
 * own input on the same coins, and the event reading to a real stagenet spend,
 * so what this file calls "the chain names it" is what the chain writes.
 */

import { createRequire } from 'node:module';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  CUSTODY_COIN_COMMITMENT_DOMAIN,
  CUSTODY_COIN_NULLIFIER_DOMAIN,
  CUSTODY_SPEND_QUERY_BATCH,
  custodyCoinCommitment,
  custodyCoinNullifier,
  custodyCreatedOutputs,
  custodySpendEventsFrom,
  custodySpendEventsQuery,
  custodySpendTransactions,
  custodySpentInputs,
  custodyTransactionAnswersFrom,
  forgetSpentCustodyCoins,
  readCustodyTransactions,
  type CustodyCoinDescription,
  type CustodyHashRuntime,
  type CustodySpentCoinsDeps,
  type CustodySpentInput,
  type CustodyTransactionFacts,
} from './custodySpentCoins.js';
import type { CustodyActionRow } from './custodyInboxIndex.js';
import {
  enqueueK1Coin,
  heldK1Coin,
  isK1NonceSpent,
  k1ColourBalance,
  queuedK1Coins,
  type K1Account,
} from './k1CoinStore.js';

/* -------------------------------------------------------------------------- */
/* The compiled build, the runtime it is decoded against, and the ledger      */
/* -------------------------------------------------------------------------- */

const requireFromTest = createRequire(import.meta.url);
const contractPath = requireFromTest.resolve(
  '../../contracts/stagenet/account-custody/contract/index.js',
);

/* By NODE, from the contract's own directory, so the contract and the runtime
   are resolved by one resolver and cannot be two copies. */
const runtime = createRequire(contractPath)('@midnight-ntwrk/compact-runtime') as CustodyHashRuntime;

interface CompiledCustody {
  Contract: new (witnesses: unknown) => {
    _coinNullifier_0(
      coin: { nonce: Uint8Array; color: Uint8Array; value: bigint },
      address: { bytes: Uint8Array },
    ): Uint8Array;
    _coinCommitment_0(
      coin: { nonce: Uint8Array; color: Uint8Array; value: bigint },
      recipient: { is_left: boolean; left: { bytes: Uint8Array }; right: { bytes: Uint8Array } },
    ): Uint8Array;
  };
}
const compiled = requireFromTest(contractPath) as CompiledCustody;

/** A contract instance, for its nullifier method alone: no witness is ever called. */
const contract = new compiled.Contract(
  new Proxy(
    {},
    {
      get: () => () => {
        throw new Error('no witness is called here');
      },
      has: () => true,
    },
  ),
);

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const ACCOUNT: K1Account = { network: 'stagenet', address: 'ab'.repeat(32) };
const OTHER_CONTRACT = 'cd'.repeat(32);
const MUSD = '1a'.repeat(32);
const SPENT = '7f'.repeat(32);
const KEPT = '3e'.repeat(32);
const SPEND_TX = 'e5'.repeat(32);
const DEPOSIT_TX = 'd1'.repeat(32);

/**
 * A real spend on stagenet: `withdraw_shielded_with_jubjub` on account
 * `098b18f2…`, transaction `47e1d1c1…` in block 519072
 * (`docs/demo/account-custody-layer-design.md` §3b). Its first Zswap ledger
 * event, exactly as the indexer served it on 2026/09/26, is the account's coin
 * going in; the second is the payment's output.
 */
const LIVE_ACCOUNT = '098b18f25ef9655e6fcd572d4650ea3e38708713cee48f5531d109421d98dbee';
const LIVE_TX = '47e1d1c1a0699479b2595d8cb34dd895bce31b01c89e4548a33828cb938435f3';
const LIVE_NULLIFIER = '56e865046fb46d9baa3662f40eeb67156a311f7aaf1ec94867c88eb3920497e8';
const LIVE_INPUT_EVENT =
  '6d69646e696768743a6576656e745b7631345d3a080080' +
  LIVE_ACCOUNT +
  '04001901' +
  LIVE_TX +
  '0000000000' +
  LIVE_NULLIFIER +
  '00';
const LIVE_OUTPUT_EVENT =
  '6d69646e696768743a6576656e745b7631345d3a0400bd04' +
  LIVE_TX +
  '00000000015642a6284c0959b483642a3236b7699c0eea2e5e99f4531a579bdf19cf63550700ddb00fb1f5df1bc5586311af495dd3cc4aa316185266af0c1d5612d7327d280d73f1be758e2971afb1c325fe064f341bc943a82dd3ed6fc84ea0b542bdc6554b15735b0caf95314265272f23b82e1468fae656dd4095bf6a8d85a327964c0d0bb563735607e72b75543ace84d4be4c79f95e2908dacc653ce684851dfe938a6d0f5b49731e71d94cd744b09e0381dca6d3794cfd13e21f3f28d443f5ad667e727d4ea05a731a771c8be500b2cb528db12a51d9a8940f768ebab29869427b7f6d78510e626b73891431d528b4accf4c8c62be66691b36cc4928d249a0c75ffa2fa219fb4b634a01113c';

function call(entryPoint: string, txHash: string | null, status?: string): CustodyActionRow {
  return { kind: 'ContractCall', entryPoint, txHash, ...(status === undefined ? {} : { status }) };
}

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
      /* The ledger's randomness looks for it on `window` once there is one. */
      crypto: globalThis.crypto,
    },
  });
});

/* -------------------------------------------------------------------------- */
/* The nullifier                                                              */
/* -------------------------------------------------------------------------- */

describe('a coin’s nullifier', () => {
  const coins: CustodyCoinDescription[] = [
    { colour: '00'.repeat(31) + '07', nonce: 'ab'.repeat(32), value: 123_456_789n },
    { colour: 'fe'.repeat(32), nonce: '0123456789abcdef'.repeat(4), value: 1n },
    { colour: MUSD, nonce: SPENT, value: (1n << 128n) - 1n },
  ];

  it('is the compiled build’s own coinNullifier, byte for byte', () => {
    for (const coin of coins) {
      const expected = hex(
        contract._coinNullifier_0(
          {
            nonce: Buffer.from(coin.nonce, 'hex'),
            color: Buffer.from(coin.colour, 'hex'),
            value: coin.value,
          },
          { bytes: Buffer.from(LIVE_ACCOUNT, 'hex') },
        ),
      );
      expect(custodyCoinNullifier(runtime, coin, LIVE_ACCOUNT)).toBe(expected);
    }
  });

  it('is the nullifier the ledger’s own input for the coin carries', async () => {
    const ledger = await import('@midnightntwrk/ledger-v9');
    for (const coin of coins.slice(0, 2)) {
      const output = ledger.ZswapOutput.newContractOwned(
        { type: coin.colour, nonce: coin.nonce, value: coin.value },
        0,
        LIVE_ACCOUNT,
      );
      const [tree] = new ledger.ZswapChainState().tryApply(
        ledger.ZswapOffer.fromOutput(output, coin.colour, coin.value),
      );
      const input = ledger.ZswapInput.newContractOwned(
        { type: coin.colour, nonce: coin.nonce, value: coin.value, mt_index: 0n },
        0,
        LIVE_ACCOUNT,
        tree.postBlockUpdate(new Date(), 3_600n),
      );
      expect(custodyCoinNullifier(runtime, coin, LIVE_ACCOUNT)).toBe(input.nullifier);
    }
  });

  it('belongs to the account: the same coin held by another has another', () => {
    const coin = coins[0];
    expect(custodyCoinNullifier(runtime, coin, LIVE_ACCOUNT)).not.toBe(
      custodyCoinNullifier(runtime, coin, OTHER_CONTRACT),
    );
    expect(custodyCoinNullifier(runtime, coin, LIVE_ACCOUNT)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('names its domain the way the compiled build spells it', () => {
    expect(CUSTODY_COIN_NULLIFIER_DOMAIN).toHaveLength(21);
    expect(
      new TextDecoder().decode(
        new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 122, 115, 119, 97, 112, 45, 99, 110, 91, 118, 49, 93]),
      ),
    ).toBe(CUSTODY_COIN_NULLIFIER_DOMAIN);
  });
});

describe('a coin’s commitment (2026/09/27)', () => {
  const coins: CustodyCoinDescription[] = [
    { colour: '00'.repeat(31) + '07', nonce: 'ab'.repeat(32), value: 123_456_789n },
    { colour: 'fe'.repeat(32), nonce: '0123456789abcdef'.repeat(4), value: 1n },
    { colour: MUSD, nonce: SPENT, value: 77n },
  ];

  it('is the compiled build’s own coinCommitment for a coin held by the account, byte for byte', () => {
    for (const coin of coins) {
      const expected = hex(
        contract._coinCommitment_0(
          { nonce: Buffer.from(coin.nonce, 'hex'), color: Buffer.from(coin.colour, 'hex'), value: coin.value },
          { is_left: false, left: { bytes: new Uint8Array(32) }, right: { bytes: Buffer.from(LIVE_ACCOUNT, 'hex') } },
        ),
      );
      expect(custodyCoinCommitment(runtime, coin, LIVE_ACCOUNT)).toBe(expected);
    }
  });

  it('is the commitment the ledger’s own output for the coin carries, and not its nullifier', async () => {
    const ledger = await import('@midnightntwrk/ledger-v9');
    for (const coin of coins) {
      expect(custodyCoinCommitment(runtime, coin, LIVE_ACCOUNT)).toBe(
        ledger.ZswapOutput.newContractOwned({ type: coin.colour, nonce: coin.nonce, value: coin.value }, 0, LIVE_ACCOUNT)
          .commitment,
      );
      expect(custodyCoinCommitment(runtime, coin, LIVE_ACCOUNT)).not.toBe(custodyCoinNullifier(runtime, coin, LIVE_ACCOUNT));
    }
  });

  it('names its domain the way the compiled build spells it', () => {
    expect(
      new TextDecoder().decode(
        new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 122, 115, 119, 97, 112, 45, 99, 99, 91, 118, 49, 93]),
      ),
    ).toBe(CUSTODY_COIN_COMMITMENT_DOMAIN);
  });
});

/* -------------------------------------------------------------------------- */
/* Which transactions, and what they spent                                    */
/* -------------------------------------------------------------------------- */

describe('the account’s own spends', () => {
  it('are its withdraw_shielded calls, each once, less any the ledger refused', () => {
    const rows: CustodyActionRow[] = [
      { kind: 'ContractDeploy', entryPoint: null, txHash: 'd0'.repeat(32) },
      call('deposit_shielded', DEPOSIT_TX, 'SUCCESS'),
      call('withdraw_shielded_with_jubjub', SPEND_TX.toUpperCase(), 'SUCCESS'),
      call('withdraw_shielded_to_contract_with_k256', 'e6'.repeat(32)),
      call('withdraw_shielded_with_grant_k256', 'e7'.repeat(32), 'PARTIAL_SUCCESS'),
      call('withdraw_shielded_with_k256', 'e8'.repeat(32), 'FAILURE'),
      call('withdraw_shielded_with_jubjub', SPEND_TX, 'SUCCESS'),
      call('withdraw_shielded_with_jubjub', null),
      call('withdraw_shielded_with_jubjub', 'not a hash'),
      { kind: 'ContractCall', entryPoint: null, txHash: 'e9'.repeat(32) },
      { kind: null, entryPoint: 'withdraw_shielded_with_k256', txHash: 'ea'.repeat(32) },
      call('withdraw_unshielded_with_k256', 'eb'.repeat(32)),
    ];
    expect(custodySpendTransactions(rows)).toEqual([SPEND_TX, 'e6'.repeat(32), 'e7'.repeat(32)]);
  });

  it('are none for a history that could not be read', () => {
    expect(custodySpendTransactions(null)).toEqual([]);
  });

  it('are asked about in one question, each under its own alias', () => {
    const query = custodySpendEventsQuery([SPEND_TX, 'not a hash', LIVE_TX.toUpperCase()]);
    expect(query).toMatch(/^query CustodySpentCoins \{/);
    expect(query).toContain(`t0: transactions(offset: { hash: "${SPEND_TX}" })`);
    expect(query).not.toContain('t1:');
    expect(query).toContain(`t2: transactions(offset: { hash: "${LIVE_TX}" })`);
    expect(query.match(/zswapLedgerEvents \{ raw \}/g)).toHaveLength(2);
  });
});

describe('what the indexer answered', () => {
  const asked = [SPEND_TX, LIVE_TX];

  it('is each transaction’s raw events, by hash', () => {
    const found = custodySpendEventsFrom(
      {
        data: {
          t0: [{ hash: SPEND_TX.toUpperCase(), zswapLedgerEvents: [{ raw: 'aa' }, { raw: 7 }, null, { raw: 'bb' }] }],
          t1: [{ hash: LIVE_TX, zswapLedgerEvents: [] }],
        },
      },
      asked,
    );
    expect([...found]).toEqual([
      [SPEND_TX, ['aa', 'bb']],
      [LIVE_TX, []],
    ]);
  });

  it('leaves out every transaction it did not answer for', () => {
    expect(
      [
        ...custodySpendEventsFrom(
          {
            data: {
              t0: [],
              t1: [null, 7, { hash: 42 }, { hash: SPEND_TX, zswapLedgerEvents: [{ raw: 'cc' }] }],
            },
          },
          asked,
        ),
      ],
    ).toEqual([]);
    expect([...custodySpendEventsFrom({ data: { t0: [{ hash: SPEND_TX }] } }, asked)]).toEqual([]);
    expect([...custodySpendEventsFrom({ data: { t0: { hash: SPEND_TX } } }, asked)]).toEqual([]);
    expect(
      [...custodySpendEventsFrom({ data: { t0: [{ hash: 'nope', zswapLedgerEvents: [] }] } }, ['nope'])],
    ).toEqual([]);
  });

  it('is nothing at all when the answer is not one', () => {
    for (const body of [
      null,
      'not json',
      { errors: [{ message: 'no' }], data: { t0: [{ hash: SPEND_TX, zswapLedgerEvents: [] }] } },
      { data: null },
      { data: 'x' },
      {},
    ]) {
      expect(custodySpendEventsFrom(body, asked).size).toBe(0);
    }
    expect(
      custodySpendEventsFrom({ errors: [], data: { t0: [{ hash: SPEND_TX, zswapLedgerEvents: [] }] } }, asked).size,
    ).toBe(1);
  });

  it('reads a real spend: the account’s coin going in, and nothing from the output', async () => {
    const ledger = await import('@midnightntwrk/ledger-v9');
    const decoded = [LIVE_INPUT_EVENT, LIVE_OUTPUT_EVENT].map(
      (raw) => ledger.Event.deserialize(Buffer.from(raw, 'hex')).content,
    );
    expect(custodySpentInputs(decoded)).toEqual([{ nullifier: LIVE_NULLIFIER, contract: LIVE_ACCOUNT }]);
  });

  it('keeps each transaction’s identifiers, the way a submit spells them, and nothing that is not one', () => {
    const found = custodyTransactionAnswersFrom(
      {
        data: {
          t0: [
            {
              hash: SPEND_TX,
              identifiers: ['00ABCD', '0x00ef01', 'zz', 7, ''],
              zswapLedgerEvents: [{ raw: 'aa' }],
            },
          ],
          t1: [{ hash: LIVE_TX, identifiers: 'no', zswapLedgerEvents: [] }],
        },
      },
      asked,
    );
    expect([...found]).toEqual([
      [SPEND_TX, { raws: ['aa'], identifiers: ['00abcd', '00ef01'] }],
      [LIVE_TX, { raws: [], identifiers: [] }],
    ]);
    /* The same rules as the events alone: nothing from an answer with errors. */
    expect(custodyTransactionAnswersFrom({ errors: [{ message: 'no' }] }, asked).size).toBe(0);
  });

  it('reads what a real spend made: a coin for a person, which names no contract', async () => {
    const ledger = await import('@midnightntwrk/ledger-v9');
    const decoded = [LIVE_INPUT_EVENT, LIVE_OUTPUT_EVENT].map(
      (raw) => ledger.Event.deserialize(Buffer.from(raw, 'hex')).content,
    );
    const outputs = custodyCreatedOutputs(decoded);
    expect(outputs).toHaveLength(1);
    expect(outputs[0].contract).toBeNull();
    expect(outputs[0].commitment).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof outputs[0].mtIndex).toBe('bigint');
  });

  it('passes over everything that is not a readable coin coming out', () => {
    expect(
      custodyCreatedOutputs([
        null,
        undefined,
        { tag: 'zswapInput', nullifier: 'aa'.repeat(32), contract: ACCOUNT.address },
        { tag: 'zswapOutput', commitment: 'short', mtIndex: 1n },
        { tag: 'zswapOutput', commitment: 5, mtIndex: 1n },
        { tag: 'zswapOutput', commitment: 'aa'.repeat(32), mtIndex: 1n, contract: 42 },
        { tag: 'zswapOutput', commitment: 'aa'.repeat(32), mtIndex: 1 },
        { tag: 'zswapOutput', commitment: 'aa'.repeat(32), mtIndex: -1n },
        { tag: 'zswapOutput', commitment: 'aa'.repeat(32), mtIndex: 2n, contract: 'not a contract' },
        { tag: 'zswapOutput', commitment: 'BB'.repeat(32), mtIndex: 3n, contract: ACCOUNT.address.toUpperCase() },
        { tag: 'zswapOutput', commitment: 'cc'.repeat(32), mtIndex: 0n, contract: null },
      ]),
    ).toEqual([
      { commitment: 'bb'.repeat(32), contract: ACCOUNT.address, mtIndex: 3n },
      { commitment: 'cc'.repeat(32), contract: null, mtIndex: 0n },
    ]);
  });

  it('passes over everything that is not a contract’s coin going in', () => {
    expect(
      custodySpentInputs([
        null,
        undefined,
        'zswapInput',
        { tag: 'zswapOutput', commitment: 'aa'.repeat(32), mtIndex: 1n },
        { tag: 'zswapInput', nullifier: 'bb'.repeat(32) },
        { tag: 'zswapInput', nullifier: 42, contract: ACCOUNT.address },
        { tag: 'zswapInput', nullifier: 'short', contract: ACCOUNT.address },
        { tag: 'dustSpendProcessed', nullifier: 1n },
        { tag: 'zswapInput', nullifier: 'CC'.repeat(32), contract: ACCOUNT.address.toUpperCase() },
      ]),
    ).toEqual([{ nullifier: 'cc'.repeat(32), contract: ACCOUNT.address }]);
  });
});

/* -------------------------------------------------------------------------- */
/* The check                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A chain in miniature: each spend's events, keyed by raw event, and a hash
 * that is the coin's nonce — so "the chain names it" reads plainly below. The
 * real hash and the real decoder are held to the chain above.
 */
function chain(spends: Record<string, readonly { nullifier: string; contract: string }[]>) {
  const asked: string[][] = [];
  const events = new Map<string, unknown>();
  const deps: CustodySpentCoinsDeps & { known: Map<string, readonly CustodySpentInput[]> } = {
    ask: (query) => {
      const hashes = [...query.matchAll(/hash: "([0-9a-f]{64})"/g)].map((match) => match[1]);
      asked.push(hashes);
      const data: Record<string, unknown> = {};
      hashes.forEach((hash, index) => {
        /* Every spend asked about is on the chain; most spent no coin here. */
        data[`t${index}`] = [
          {
            hash,
            zswapLedgerEvents: (spends[hash] ?? []).map((input, position) => {
              const raw = `${hash}${position}`;
              events.set(raw, { tag: 'zswapInput', ...input });
              return { raw };
            }),
          },
        ];
      });
      return Promise.resolve({ data });
    },
    decode: (raw) => {
      if (!events.has(raw)) throw new Error('not an event');
      return events.get(raw);
    },
    nullifierOf: (coin) => coin.nonce,
    known: new Map(),
  };
  return { deps, asked };
}

function holdBoth(): void {
  expect(enqueueK1Coin(ACCOUNT, { colour: MUSD, nonce: SPENT, value: 40n, mtIndex: 700n })).toBe('held');
  expect(enqueueK1Coin(ACCOUNT, { colour: MUSD, nonce: KEPT, value: 25n, mtIndex: 702n })).toBe('queued');
}

const HISTORY: CustodyActionRow[] = [
  call('deposit_shielded', DEPOSIT_TX, 'SUCCESS'),
  call('deposit_shielded', 'd2'.repeat(32), 'SUCCESS'),
  call('withdraw_shielded_with_jubjub', SPEND_TX, 'SUCCESS'),
];

describe('the held-coin check', () => {
  it('forgets a coin the chain says another device spent, and counts only what is left', async () => {
    holdBoth();
    expect(k1ColourBalance(ACCOUNT, MUSD)).toBe(65n);
    const { deps, asked } = chain({ [SPEND_TX]: [{ nullifier: SPENT, contract: ACCOUNT.address }] });

    const result = await forgetSpentCustodyCoins(ACCOUNT, HISTORY, deps);

    expect(asked).toEqual([[SPEND_TX]]);
    expect(result.complete).toBe(true);
    expect(result.forgotten.map((coin) => coin.nonce)).toEqual([SPENT]);
    /* The coin that is still there is the one a payment is offered. */
    expect(k1ColourBalance(ACCOUNT, MUSD)).toBe(25n);
    expect(heldK1Coin(ACCOUNT, MUSD)?.nonce).toBe(KEPT);
    expect(queuedK1Coins(ACCOUNT, MUSD)).toEqual([]);
    /* And the next walk of the same inbox cannot file it again. */
    expect(isK1NonceSpent(ACCOUNT, SPENT)).toBe(true);
    expect(enqueueK1Coin(ACCOUNT, { colour: MUSD, nonce: SPENT, value: 40n, mtIndex: 700n })).toBe('spent');
  });

  it('asks nothing about a spend it has already read, and still applies it', async () => {
    holdBoth();
    const { deps, asked } = chain({ [SPEND_TX]: [{ nullifier: KEPT, contract: 'ef'.repeat(32) }] });
    await forgetSpentCustodyCoins(ACCOUNT, HISTORY, deps);
    expect(k1ColourBalance(ACCOUNT, MUSD)).toBe(65n);
    /* A coin the chain names later — here, one filed after the spend was read. */
    deps.known.set(SPEND_TX, [{ nullifier: SPENT, contract: ACCOUNT.address }]);
    const again = await forgetSpentCustodyCoins(ACCOUNT, HISTORY, deps);
    expect(asked).toEqual([[SPEND_TX]]);
    expect(again.forgotten.map((coin) => coin.nonce)).toEqual([SPENT]);
    expect(k1ColourBalance(ACCOUNT, MUSD)).toBe(25n);
  });

  it('keeps every coin whose nullifier the chain does not name, and a coin another account spent', async () => {
    holdBoth();
    const { deps } = chain({ [SPEND_TX]: [{ nullifier: SPENT, contract: OTHER_CONTRACT }] });
    const result = await forgetSpentCustodyCoins(ACCOUNT, HISTORY, deps);
    expect(result).toEqual({ complete: true, forgotten: [] });
    expect(k1ColourBalance(ACCOUNT, MUSD)).toBe(65n);
  });

  it('asks nothing when there is nothing to check', async () => {
    const { deps, asked } = chain({});
    expect(await forgetSpentCustodyCoins(ACCOUNT, HISTORY, deps)).toEqual({ complete: true, forgotten: [] });
    holdBoth();
    expect(
      await forgetSpentCustodyCoins(ACCOUNT, [call('deposit_shielded', DEPOSIT_TX)], deps),
    ).toEqual({ complete: true, forgotten: [] });
    expect(await forgetSpentCustodyCoins(ACCOUNT, null, deps)).toEqual({ complete: true, forgotten: [] });
    expect(asked).toEqual([]);
  });

  it('asks in batches, and uses what one batch answered when the next could not be asked', async () => {
    holdBoth();
    const spends = Array.from({ length: CUSTODY_SPEND_QUERY_BATCH + 3 }, (_, index) =>
      index.toString(16).padStart(2, '0').repeat(32),
    );
    const { deps, asked } = chain({ [spends[1]]: [{ nullifier: SPENT, contract: ACCOUNT.address }] });
    const ask = deps.ask;
    let questions = 0;
    const flaky: CustodySpentCoinsDeps = {
      ...deps,
      ask: async (query) => {
        questions += 1;
        if (questions === 2) throw new Error('the indexer went away');
        return ask(query);
      },
    };
    const rows = spends.map((hash) => call('withdraw_shielded_with_k256', hash));

    const result = await forgetSpentCustodyCoins(ACCOUNT, rows, flaky);

    expect(asked).toEqual([spends.slice(0, CUSTODY_SPEND_QUERY_BATCH)]);
    expect(questions).toBe(2);
    expect(result.complete).toBe(false);
    expect(result.forgotten.map((coin) => coin.nonce)).toEqual([SPENT]);
    /* The next read asks only about what it did not get. */
    const next = await forgetSpentCustodyCoins(ACCOUNT, rows, deps);
    expect(asked[1]).toEqual(spends.slice(CUSTODY_SPEND_QUERY_BATCH));
    expect(next.complete).toBe(true);
  });

  it('changes nothing, and says nothing, when the chain cannot be asked', async () => {
    holdBoth();
    const { deps } = chain({ [SPEND_TX]: [{ nullifier: SPENT, contract: ACCOUNT.address }] });
    for (const ask of [
      () => Promise.reject(new Error('offline')),
      () => Promise.resolve({ errors: [{ message: 'busy' }] }),
      () => Promise.resolve('not json'),
    ]) {
      const result = await forgetSpentCustodyCoins(ACCOUNT, HISTORY, { ...deps, ask });
      expect(result).toEqual({ complete: false, forgotten: [] });
    }
    expect(k1ColourBalance(ACCOUNT, MUSD)).toBe(65n);
    expect(heldK1Coin(ACCOUNT, MUSD)?.nonce).toBe(SPENT);
  });

  it('reads the events it can decode, and keeps a coin whose nullifier cannot be made', async () => {
    holdBoth();
    const { deps } = chain({
      [SPEND_TX]: [
        { nullifier: SPENT, contract: ACCOUNT.address },
        { nullifier: KEPT, contract: ACCOUNT.address },
      ],
    });
    const decode = deps.decode;
    const result = await forgetSpentCustodyCoins(ACCOUNT, HISTORY, {
      ...deps,
      /* The second event is one this build cannot read. */
      decode: (raw) => {
        if (raw.endsWith('1')) throw new Error('an event from a later ledger');
        return decode(raw);
      },
      nullifierOf: (coin) => {
        if (coin.nonce === KEPT) throw new Error('no runtime');
        return coin.nonce;
      },
    });
    expect(result.forgotten.map((coin) => coin.nonce)).toEqual([SPENT]);
    expect(deps.known.get(SPEND_TX)).toEqual([{ nullifier: SPENT, contract: ACCOUNT.address }]);
    expect(k1ColourBalance(ACCOUNT, MUSD)).toBe(25n);
  });

  it('keeps what it has read for the life of the tab when no memory is handed in', async () => {
    holdBoth();
    const tabOnly = 'f1'.repeat(32);
    const { deps, asked } = chain({ [tabOnly]: [{ nullifier: SPENT, contract: ACCOUNT.address }] });
    const { known: _unused, ...withoutMemory } = deps;
    const rows = [call('withdraw_shielded_with_jubjub', tabOnly)];
    const first = await forgetSpentCustodyCoins(ACCOUNT, rows, withoutMemory);
    expect(first.forgotten.map((coin) => coin.nonce)).toEqual([SPENT]);
    await forgetSpentCustodyCoins(ACCOUNT, rows, withoutMemory);
    expect(asked).toEqual([[tabOnly]]);
  });
});

/* -------------------------------------------------------------------------- */
/* The one read, as the change walk and Activity share it (2026/09/27)        */
/* -------------------------------------------------------------------------- */

describe('the one read of the account’s own transactions', () => {
  function answering(facts: Record<string, { events: unknown[]; identifiers?: string[] }>) {
    const asked: string[][] = [];
    const events = new Map<string, unknown>();
    const deps = {
      ask: (query: string) => {
        const hashes = [...query.matchAll(/hash: "([0-9a-f]{64})"/g)].map((match) => match[1]);
        asked.push(hashes);
        const data: Record<string, unknown> = {};
        hashes.forEach((hash, index) => {
          if (!(hash in facts)) return;
          data[`t${index}`] = [
            {
              hash,
              identifiers: facts[hash].identifiers ?? [],
              zswapLedgerEvents: facts[hash].events.map((event, position) => {
                const raw = `${hash}${position}`;
                events.set(raw, event);
                return { raw };
              }),
            },
          ];
        });
        return Promise.resolve({ data });
      },
      decode: (raw: string) => events.get(raw),
      known: new Map<string, readonly CustodySpentInput[]>(),
      facts: new Map<string, CustodyTransactionFacts>(),
    };
    return { deps, asked };
  }

  it('keeps what each spend spent, made, and was known by — once, however it was spelled', async () => {
    const { deps, asked } = answering({
      [SPEND_TX]: {
        events: [
          { tag: 'zswapInput', nullifier: SPENT, contract: ACCOUNT.address },
          { tag: 'zswapOutput', commitment: KEPT, contract: ACCOUNT.address, mtIndex: 9n },
          { tag: 'zswapOutput', commitment: 'ab'.repeat(32), mtIndex: 8n },
        ],
        identifiers: ['00' + 'e5'.repeat(32)],
      },
    });
    const read = await readCustodyTransactions([SPEND_TX, SPEND_TX.toUpperCase(), 'not a hash'], deps);
    expect(asked).toEqual([[SPEND_TX]]);
    expect(read.complete).toBe(true);
    expect([...read.facts]).toEqual([
      [
        SPEND_TX,
        {
          inputs: [{ nullifier: SPENT, contract: ACCOUNT.address }],
          outputs: [
            { commitment: KEPT, contract: ACCOUNT.address, mtIndex: 9n },
            { commitment: 'ab'.repeat(32), contract: null, mtIndex: 8n },
          ],
          identifiers: ['00' + 'e5'.repeat(32)],
          whole: true,
        },
      ],
    ]);
    /* The held-coin check reads the same inputs without asking again. */
    expect(deps.known.get(SPEND_TX)).toEqual([{ nullifier: SPENT, contract: ACCOUNT.address }]);
    await readCustodyTransactions([SPEND_TX], deps);
    expect(asked).toHaveLength(1);
  });

  it('says a spend with an event it could not read is not whole', async () => {
    const { deps } = answering({
      [SPEND_TX]: { events: [{ tag: 'zswapInput', nullifier: SPENT, contract: ACCOUNT.address }, 'from a later ledger'] },
    });
    const decode = deps.decode;
    const read = await readCustodyTransactions([SPEND_TX], {
      ...deps,
      decode: (raw) => {
        const event = decode(raw);
        if (typeof event === 'string') throw new Error(event);
        return event;
      },
    });
    expect(read.facts.get(SPEND_TX)).toMatchObject({
      inputs: [{ nullifier: SPENT, contract: ACCOUNT.address }],
      outputs: [],
      whole: false,
    });
  });

  it('says it is not complete while the indexer has not answered for one, and asks for it again', async () => {
    const { deps, asked } = answering({ [SPEND_TX]: { events: [] } });
    const read = await readCustodyTransactions([SPEND_TX, DEPOSIT_TX], deps);
    expect(read.complete).toBe(false);
    expect([...read.facts.keys()]).toEqual([SPEND_TX]);
    await readCustodyTransactions([SPEND_TX, DEPOSIT_TX], deps);
    expect(asked).toEqual([[SPEND_TX, DEPOSIT_TX], [DEPOSIT_TX]]);
  });

  it('asks again about a spend whose inputs are known and whose outputs are not', async () => {
    const { deps, asked } = answering({ [SPEND_TX]: { events: [] } });
    deps.known.set(SPEND_TX, []);
    const read = await readCustodyTransactions([SPEND_TX], deps);
    expect(asked).toEqual([[SPEND_TX]]);
    expect(read.complete).toBe(true);
  });

  it('keeps its own memory for the life of the tab when none is handed in', async () => {
    const tabOnly = 'f2'.repeat(32);
    const { deps, asked } = answering({ [tabOnly]: { events: [], identifiers: ['0012'] } });
    const { known: _known, facts: _facts, ...withoutMemory } = deps;
    expect((await readCustodyTransactions([tabOnly], withoutMemory)).facts.get(tabOnly)?.identifiers).toEqual(['0012']);
    await readCustodyTransactions([tabOnly], withoutMemory);
    expect(asked).toEqual([[tabOnly]]);
  });
});
