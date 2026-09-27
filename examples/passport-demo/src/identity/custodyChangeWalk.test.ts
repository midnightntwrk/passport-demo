/**
 * The change a payment kept, found on the chain (2026/09/27).
 *
 * The defect these drill: a Passport recovered on a new phone showed 0 mUSD
 * where 77 was held. The 100 it was given had been spent in a payment of 23
 * from another device, whose note for the change was never written, so no
 * device could describe the 77.
 *
 * The change's nonce is held to the compiled build's own `_sendShielded_0`,
 * RUN on known coins, and its commitment to the build's `_coinCommitment_0`
 * and to the ledger's own output — so "the walk found it" means the contract
 * made it. The events are the ledger's own bytes: a real stagenet payment's,
 * recorded, and synthetic ones laid out the same way and read back by the
 * ledger's decoder.
 */

import { createRequire } from 'node:module';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CUSTODY_CHANGE_NONCE_DOMAIN,
  CUSTODY_CHANGE_PENDING_LIMIT,
  CUSTODY_CHANGE_SEARCH_CAP,
  CUSTODY_CHANGE_SEARCH_SLICE,
  CUSTODY_FIELD_MAX,
  CUSTODY_SENT_NONCE_DOMAIN,
  custodyChangeCandidates,
  custodyChangeHashes,
  custodyChangeNonce,
  custodyChangeRoots,
  custodyEvolvedNonce,
  findCustodyChangeValue,
  loadCustodyChangeSteps,
  recoverCustodyChange,
  rememberCustodyChangeRoots,
  walkCustodyChange,
  type CustodyChangeHashes,
  type CustodyWalkRuntime,
} from './custodyChangeWalk.js';
import {
  custodyCoinCommitment,
  custodyCoinNullifier,
  custodyCreatedOutputs,
  custodySpentInputs,
  type CustodyCoinDescription,
  type CustodyTransactionFacts,
} from './custodySpentCoins.js';
import type { CustodyActionRow } from './custodyInboxIndex.js';
import {
  enqueueK1Coin,
  forgetSpentK1Coins,
  heldK1Coin,
  isK1NonceSpent,
  k1ColourBalance,
  queuedK1Coins,
  rememberK1ChangeCoin,
  type K1Account,
} from './k1CoinStore.js';

/* -------------------------------------------------------------------------- */
/* The compiled build, and the runtime it runs on                             */
/* -------------------------------------------------------------------------- */

const requireFromTest = createRequire(import.meta.url);
const contractPath = requireFromTest.resolve(
  '../../contracts/stagenet/account-custody/contract/index.js',
);

interface CircuitContext {
  callContext: { currentZswapLocalState: { outputs: { coinInfo: CompiledCoin; recipient: Either }[] } };
}

interface CompiledCoin {
  nonce: Uint8Array;
  color: Uint8Array;
  value: bigint;
}

interface Either {
  is_left: boolean;
  left: { bytes: Uint8Array };
  right: { bytes: Uint8Array };
}

/* By NODE, from the contract's own directory, so the contract and the runtime
   are one copy. */
const runtime = createRequire(contractPath)('@midnight-ntwrk/compact-runtime') as CustodyWalkRuntime & {
  createCircuitContext(
    circuitId: string,
    address: string,
    coinPublicKey: string,
    state: unknown,
    privateState: unknown,
  ): CircuitContext;
  ContractState: new () => unknown;
};

interface CompiledCustody {
  Contract: new (witnesses: unknown) => {
    _sendShielded_0(
      context: CircuitContext,
      proof: unknown,
      input: CompiledCoin & { mt_index: bigint },
      recipient: Either,
      value: bigint,
    ): Promise<{ sent: CompiledCoin; change: { is_some: boolean; value: CompiledCoin } }>;
    _coinCommitment_0(coin: CompiledCoin, recipient: Either): Uint8Array;
  };
}
const compiled = requireFromTest(contractPath) as CompiledCustody;

/** A contract instance for its internal methods alone: no witness is called. */
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
const bytes = (value: string): Uint8Array => Buffer.from(value, 'hex');

const toContract = (address: string): Either => ({
  is_left: false,
  left: { bytes: new Uint8Array(32) },
  right: { bytes: bytes(address) },
});
const toPerson = (key: string): Either => ({
  is_left: true,
  left: { bytes: bytes(key) },
  right: { bytes: new Uint8Array(32) },
});

/**
 * THE COMPILED BUILD'S OWN PAYMENT: `_sendShielded_0` run on `input` with this
 * account as `self`, exactly as every `withdraw_shielded*` circuit runs it.
 */
async function compiledSend(
  address: string,
  input: CustodyCoinDescription,
  recipient: Either,
  value: bigint,
): Promise<{ sent: CompiledCoin; change: CompiledCoin | null; context: CircuitContext }> {
  const context = runtime.createCircuitContext(
    'withdraw_shielded_with_jubjub',
    address,
    '00'.repeat(32),
    new runtime.ContractState(),
    {},
  );
  const proof = { input: { value: [], alignment: [] }, output: undefined, publicTranscript: [], privateTranscriptOutputs: [] };
  const out = await contract._sendShielded_0(
    context,
    proof,
    { nonce: bytes(input.nonce), color: bytes(input.colour), value: input.value, mt_index: 0n },
    recipient,
    value,
  );
  return { sent: out.sent, change: out.change.is_some ? out.change.value : null, context };
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** The account from the Android recovery of 2026/09/27. */
const LIVE_ACCOUNT = '511f5fa8d7f2d03938e7705d72014781c714a66f2d3a689f636f4db70762a720';
/** Its payment of 23 mUSD, and the account that payment went to. */
const LIVE_PAYMENT = 'c78b3fc042d6766dabec60f486174627b948554b9fcb714c8a0f66fe87e82463';
const LIVE_RECIPIENT = 'b9dc2d630ef4e9256abb5f9bc797dda38bf6667eb5f0fd2625203e59284c2973';

/**
 * That payment's three Zswap ledger events, exactly as
 * `indexer.stagenet.shielded.tools/api/v4` served them on 2026/09/27 (read
 * only): the account's coin going in, the recipient's coin, and the account's
 * change.
 */
const EVENT_HEAD = '6d69646e696768743a6576656e745b7631345d3a080080';
const LIVE_PAYMENT_EVENTS = [
  `${EVENT_HEAD}${LIVE_ACCOUNT}04001901${LIVE_PAYMENT}000000000026209122420628782157ef9a1733fa6e9cc9893626c00edc4816b2f376a076cc00`,
  `${EVENT_HEAD}${LIVE_RECIPIENT}04002501${LIVE_PAYMENT}00000000015fd7aedcb959eec0f874bb8b6bd67a4b1d5587eabf1fe991d562906ace64e1b502008549`,
  `${EVENT_HEAD}${LIVE_ACCOUNT}04002501${LIVE_PAYMENT}0000000001a0a96b94c524a94d5aafafd78217df0375fe5dd4ca711b83f775364ecdbdaf1a02008949`,
];

/** A contract's coin going in, laid out as the live event above is. */
function inputEvent(contract: string, tx: string, nullifier: string): string {
  return `${EVENT_HEAD}${contract}04001901${tx}0000000000${nullifier}00`;
}

/**
 * A coin made for a contract, laid out as the live events above are: the
 * position is SCALE's compact integer in its two-byte form, `(n << 2) | 1`,
 * which covers 64 to 16383.
 */
function outputEvent(contract: string, tx: string, commitment: string, mtIndex: number): string {
  const compact = (mtIndex << 2) | 1;
  const position = Buffer.from([compact & 0xff, (compact >> 8) & 0xff]).toString('hex');
  return `${EVENT_HEAD}${contract}04002501${tx}0000000001${commitment}0200${position}`;
}

const ACCOUNT: K1Account = { network: 'stagenet', address: LIVE_ACCOUNT };
const MUSD = '1a2917fbed8b5ce44d12ebc7d337689045f6c96a6bbd39cf3d8691ab310ef6a6';
const ROOT: CustodyCoinDescription = { colour: MUSD, nonce: '7f'.repeat(32), value: 100n };
const PAYMENT_A = 'a1'.repeat(32);
const PAYMENT_B = 'b2'.repeat(32);
const WALK_KEY = 'passport-custody-change-walk:v1';

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
      crypto: globalThis.crypto,
    },
  });
});

const hashes: CustodyChangeHashes = custodyChangeHashes(runtime, LIVE_ACCOUNT);

/** The commitment the compiled build files this account's coin under. */
function compiledCommitment(coin: CompiledCoin): string {
  return hex(contract._coinCommitment_0(coin, toContract(LIVE_ACCOUNT)));
}

/**
 * A payment of `sent` out of `coin`, made by the compiled build, as the chain
 * records it: the coin's nullifier in, the recipient's coin out, and — when
 * there was change — the account's change out at `mtIndex`.
 */
async function payment(
  coin: CustodyCoinDescription,
  sent: bigint,
  mtIndex: bigint,
): Promise<{ fact: CustodyTransactionFacts; change: CustodyCoinDescription | null }> {
  const made = await compiledSend(LIVE_ACCOUNT, coin, toContract(LIVE_RECIPIENT), sent);
  const change =
    made.change === null ? null : { colour: coin.colour, nonce: hex(made.change.nonce), value: made.change.value };
  return {
    fact: {
      inputs: [{ nullifier: custodyCoinNullifier(runtime, coin, LIVE_ACCOUNT), contract: LIVE_ACCOUNT }],
      outputs: [
        { commitment: '5f'.repeat(32), contract: LIVE_RECIPIENT, mtIndex: mtIndex - 1n },
        ...(made.change === null
          ? []
          : [{ commitment: compiledCommitment(made.change), contract: LIVE_ACCOUNT, mtIndex }]),
      ],
      identifiers: [],
      whole: true,
    },
    change,
  };
}

function storedWalk(): Record<string, { pending: unknown[]; steps: Record<string, unknown> }> {
  return JSON.parse(storage.get(WALK_KEY) ?? '{}') as Record<string, { pending: unknown[]; steps: Record<string, unknown> }>;
}

const quiet = { log: () => {} };

/* -------------------------------------------------------------------------- */
/* The change's nonce, against the compiled build                             */
/* -------------------------------------------------------------------------- */

describe('the change’s nonce', () => {
  const coins: CustodyCoinDescription[] = [
    ROOT,
    { colour: MUSD, nonce: 'ff'.repeat(32), value: 1_000n },
    { colour: '00'.repeat(31) + '07', nonce: '00'.repeat(32), value: 2n },
    { colour: 'fe'.repeat(32), nonce: '0123456789abcdef'.repeat(4), value: (1n << 63n) + 5n },
  ];

  it('is the one the compiled build’s own payment makes, byte for byte — and so is the sent coin’s', async () => {
    for (const coin of coins) {
      const made = await compiledSend(LIVE_ACCOUNT, coin, toContract(LIVE_RECIPIENT), 1n);
      expect(made.change).not.toBeNull();
      expect(custodyChangeNonce(runtime, coin.nonce)).toBe(hex(made.change!.nonce));
      expect(made.change!.value).toBe(coin.value - 1n);
      expect(hex(made.change!.color)).toBe(coin.colour);
      /* The sent coin's nonce is the same expression under the other tag. */
      expect(custodyEvolvedNonce(runtime, coin.nonce, CUSTODY_SENT_NONCE_DOMAIN)).toBe(hex(made.sent.nonce));
      expect(custodyEvolvedNonce(runtime, coin.nonce, CUSTODY_SENT_NONCE_DOMAIN)).not.toBe(
        custodyChangeNonce(runtime, coin.nonce),
      );
    }
  });

  it('is the same whoever was paid: a person as well as another account', async () => {
    const toSomebody = await compiledSend(LIVE_ACCOUNT, ROOT, toPerson('aa'.repeat(32)), 23n);
    expect(custodyChangeNonce(runtime, ROOT.nonce)).toBe(hex(toSomebody.change!.nonce));
  });

  it('files the change for this account, under the commitment the build and the ledger both compute', async () => {
    const made = await compiledSend(LIVE_ACCOUNT, ROOT, toContract(LIVE_RECIPIENT), 23n);
    const change = { colour: MUSD, nonce: hex(made.change!.nonce), value: 77n };
    /* The build made it as an output to `right(self)`. */
    const outputs = made.context.callContext.currentZswapLocalState.outputs;
    expect(outputs).toHaveLength(2);
    expect(hex(outputs[1].coinInfo.nonce)).toBe(change.nonce);
    expect(outputs[1].recipient.is_left).toBe(false);
    expect(hex(outputs[1].recipient.right.bytes)).toBe(LIVE_ACCOUNT);
    /* And files it under the same commitment three ways. */
    const ledger = await import('@midnightntwrk/ledger-v9');
    expect(custodyCoinCommitment(runtime, change, LIVE_ACCOUNT)).toBe(compiledCommitment(made.change!));
    expect(custodyCoinCommitment(runtime, change, LIVE_ACCOUNT)).toBe(
      ledger.ZswapOutput.newContractOwned({ type: MUSD, nonce: change.nonce, value: 77n }, 0, LIVE_ACCOUNT).commitment,
    );
    expect(hashes.commitmentsFor({ nonce: change.nonce, colour: MUSD })(77n)).toBe(compiledCommitment(made.change!));
  });

  it('spells its tags and its field bound the way the build does', () => {
    /* The byte arrays and the literal in `_sendShielded_0`, lines 4783–4785
       and 4837–4839 of the compiled build. */
    expect(
      new TextDecoder().decode(
        new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 107, 101, 114, 110, 101, 108, 58, 110, 111, 110, 99, 101, 95, 101, 118, 111, 108, 118, 101, 47, 50]),
      ),
    ).toBe(CUSTODY_CHANGE_NONCE_DOMAIN);
    expect(
      new TextDecoder().decode(
        new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 107, 101, 114, 110, 101, 108, 58, 110, 111, 110, 99, 101, 95, 101, 118, 111, 108, 118, 101]),
      ),
    ).toBe(CUSTODY_SENT_NONCE_DOMAIN);
    expect(CUSTODY_FIELD_MAX).toBe(52435875175126190479447740508185965837690552500527637822603658699938581184512n);
  });

  it('makes no change at all when the whole coin is sent', async () => {
    const made = await compiledSend(LIVE_ACCOUNT, ROOT, toContract(LIVE_RECIPIENT), 100n);
    expect(made.change).toBeNull();
    expect(made.context.callContext.currentZswapLocalState.outputs).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* What a real payment's events say                                           */
/* -------------------------------------------------------------------------- */

describe('a real payment’s events (stagenet, 2026/09/27)', () => {
  it('made exactly two coins for contracts: the recipient’s, and this account’s change', async () => {
    const ledger = await import('@midnightntwrk/ledger-v9');
    const decoded = LIVE_PAYMENT_EVENTS.map((raw) => ledger.Event.deserialize(bytes(raw)).content);
    const outputs = custodyCreatedOutputs(decoded);
    expect(outputs).toEqual([
      {
        commitment: '5fd7aedcb959eec0f874bb8b6bd67a4b1d5587eabf1fe991d562906ace64e1b5',
        contract: LIVE_RECIPIENT,
        mtIndex: 4705n,
      },
      {
        commitment: 'a0a96b94c524a94d5aafafd78217df0375fe5dd4ca711b83f775364ecdbdaf1a',
        contract: LIVE_ACCOUNT,
        mtIndex: 4706n,
      },
    ]);
    expect(outputs.filter((output) => output.contract !== null)).toHaveLength(2);
    expect(outputs.filter((output) => output.contract === LIVE_ACCOUNT)).toHaveLength(1);
    /* And spent one coin of this account's. */
    expect(custodySpentInputs(decoded)).toEqual([
      { nullifier: '26209122420628782157ef9a1733fa6e9cc9893626c00edc4816b2f376a076cc', contract: LIVE_ACCOUNT },
    ]);
  });

  it('are the layout a synthetic event is built on, and the ledger reads one back', async () => {
    const ledger = await import('@midnightntwrk/ledger-v9');
    const raw = outputEvent(LIVE_ACCOUNT, PAYMENT_A, 'ee'.repeat(32), 4811);
    const event = ledger.Event.deserialize(bytes(raw));
    expect(event.source.transactionHash).toBe(PAYMENT_A);
    expect(custodyCreatedOutputs([event.content])).toEqual([
      { commitment: 'ee'.repeat(32), contract: LIVE_ACCOUNT, mtIndex: 4811n },
    ]);
    expect(
      custodySpentInputs([ledger.Event.deserialize(bytes(inputEvent(LIVE_ACCOUNT, PAYMENT_A, 'dd'.repeat(32)))).content]),
    ).toEqual([{ nullifier: 'dd'.repeat(32), contract: LIVE_ACCOUNT }]);
  });
});

/* -------------------------------------------------------------------------- */
/* The value search                                                           */
/* -------------------------------------------------------------------------- */

describe('the value search', () => {
  it('tries both ends of the range in turn, and never more than the cap', () => {
    expect([...custodyChangeCandidates(6n)]).toEqual([5n, 1n, 4n, 2n, 3n]);
    expect([...custodyChangeCandidates(5n)]).toEqual([4n, 1n, 3n, 2n]);
    expect([...custodyChangeCandidates(100n, 3)]).toEqual([99n, 1n, 98n]);
    expect([...custodyChangeCandidates(100n, 2)]).toEqual([99n, 1n]);
    /* A coin of one, or of nothing, has no change to find. */
    expect([...custodyChangeCandidates(1n)]).toEqual([]);
    expect([...custodyChangeCandidates(0n)]).toEqual([]);
    expect(CUSTODY_CHANGE_SEARCH_CAP).toBe(2 ** 20);
    expect(CUSTODY_CHANGE_SEARCH_SLICE).toBe(512);
  });

  it('finds the change of a payment of 23 out of 100, and where it landed', async () => {
    const change = { colour: MUSD, nonce: custodyChangeNonce(runtime, ROOT.nonce) };
    const commitmentAt = hashes.commitmentsFor(change);
    const outputs = new Map([
      ['5f'.repeat(32), 4705n],
      [commitmentAt(77n), 4706n],
    ]);
    const found = await findCustodyChangeValue(commitmentAt, 100n, outputs);
    expect(found).toEqual({ kind: 'found', value: 77n, mtIndex: 4706n, tried: 45 });
  });

  it('gives the event loop back between slices, and stops when asked', async () => {
    const seen: bigint[] = [];
    let pauses = 0;
    const result = await findCustodyChangeValue(
      (value) => {
        seen.push(value);
        return value.toString();
      },
      1_000n,
      new Map([['500', 9n]]),
      {
        slice: 100,
        pause: () => {
          pauses += 1;
          return Promise.resolve();
        },
      },
    );
    expect(result).toEqual({ kind: 'found', value: 500n, mtIndex: 9n, tried: seen.length });
    expect(pauses).toBe(Math.floor((seen.length - 1) / 100));

    let asked = 0;
    const stopped = await findCustodyChangeValue((value) => value.toString(), 1_000n, new Map(), {
      slice: 10,
      pause: async () => {},
      shouldStop: () => (asked += 1) === 3,
    });
    expect(stopped).toEqual({ kind: 'stopped', tried: 30 });
  });

  it('says whether it covered the range or ran out of its cap', async () => {
    expect(await findCustodyChangeValue((value) => value.toString(), 10n, new Map())).toEqual({
      kind: 'none',
      tried: 9,
    });
    expect(
      await findCustodyChangeValue((value) => value.toString(), 10n, new Map(), { cap: 4, slice: 0 }),
    ).toEqual({ kind: 'capped', tried: 4 });
    expect(await findCustodyChangeValue((value) => value.toString(), 1n, new Map())).toEqual({
      kind: 'none',
      tried: 0,
    });
  });

  it('paces itself on the next task when no pause is handed in', async () => {
    const result = await findCustodyChangeValue((value) => value.toString(), 1_200n, new Map([['1', 0n]]));
    /* 1 is the second candidate: it is found before the first slice ends. */
    expect(result).toEqual({ kind: 'found', value: 1n, mtIndex: 0n, tried: 2 });
    const far = await findCustodyChangeValue((value) => value.toString(), 1_200n, new Map([['600', 3n]]));
    expect(far.kind).toBe('found');
    expect(far.tried).toBeGreaterThan(CUSTODY_CHANGE_SEARCH_SLICE);
  });
});

/* -------------------------------------------------------------------------- */
/* The walk                                                                   */
/* -------------------------------------------------------------------------- */

describe('the chain walk', () => {
  it('follows two chained payments to the coin still held, and files it where the chain put it', async () => {
    /* 100 → sent 23, kept 77 → sent 7 of the 77, kept 70. */
    const first = await payment(ROOT, 23n, 4706n);
    const second = await payment(first.change!, 7n, 4811n);
    const facts = new Map([
      [PAYMENT_A, first.fact],
      [PAYMENT_B, second.fact],
    ]);

    const result = await walkCustodyChange(ACCOUNT, [ROOT], [PAYMENT_A, PAYMENT_B], { ...hashes, facts });

    expect(result.pending).toEqual([]);
    expect(result.added).toEqual([{ colour: MUSD, nonce: second.change!.nonce, value: 70n, mtIndex: 4811n }]);
    expect(heldK1Coin(ACCOUNT, MUSD)).toEqual({ colour: MUSD, nonce: second.change!.nonce, value: 70n, mtIndex: 4811n });
    expect(k1ColourBalance(ACCOUNT, MUSD)).toBe(70n);
    /* What each payment sent, remembered by the coin it spent. */
    const steps = loadCustodyChangeSteps(ACCOUNT);
    expect(steps.get(ROOT.nonce)).toEqual({
      txHash: PAYMENT_A,
      colour: MUSD,
      spentValue: 100n,
      outcome: 'change',
      change: { nonce: first.change!.nonce, value: 77n, mtIndex: 4706n },
      sent: 23n,
      found: false,
    });
    expect(steps.get(first.change!.nonce)).toEqual({
      txHash: PAYMENT_B,
      colour: MUSD,
      spentValue: 77n,
      outcome: 'change',
      change: { nonce: second.change!.nonce, value: 70n, mtIndex: 4811n },
      sent: 7n,
      found: true,
    });
  });

  it('finds the 77 of the Android recovery: 100 spent in a payment of 23, and no note for the change', async () => {
    const first = await payment(ROOT, 23n, 4706n);
    const result = await walkCustodyChange(ACCOUNT, [ROOT], [PAYMENT_A], {
      ...hashes,
      facts: new Map([[PAYMENT_A, first.fact]]),
    });
    expect(result.added).toEqual([{ colour: MUSD, nonce: first.change!.nonce, value: 77n, mtIndex: 4706n }]);
    expect(k1ColourBalance(ACCOUNT, MUSD)).toBe(77n);
    expect(loadCustodyChangeSteps(ACCOUNT).get(ROOT.nonce)).toMatchObject({ sent: 23n, found: true });
  });

  it('knows a payment of the whole coin sent all of it, and keeps nothing', async () => {
    const whole = await payment(ROOT, 100n, 4706n);
    expect(whole.change).toBeNull();
    const result = await walkCustodyChange(ACCOUNT, [ROOT], [PAYMENT_A], {
      ...hashes,
      facts: new Map([[PAYMENT_A, whole.fact]]),
    });
    expect(result).toEqual({ added: [], pending: [] });
    expect(loadCustodyChangeSteps(ACCOUNT).get(ROOT.nonce)).toEqual({
      txHash: PAYMENT_A,
      colour: MUSD,
      spentValue: 100n,
      outcome: 'exact',
      change: null,
      sent: 100n,
      found: false,
    });
    expect(k1ColourBalance(ACCOUNT, MUSD)).toBe(0n);
  });

  it('does not take a spend it could not read whole as having sent the whole coin', async () => {
    const whole = await payment(ROOT, 100n, 4706n);
    const lines: string[] = [];
    const result = await walkCustodyChange(ACCOUNT, [ROOT], [PAYMENT_A], {
      ...hashes,
      facts: new Map([[PAYMENT_A, { ...whole.fact, whole: false }]]),
      log: (line) => void lines.push(line),
    });
    expect(result).toEqual({ added: [], pending: [] });
    expect(loadCustodyChangeSteps(ACCOUNT).get(ROOT.nonce)).toMatchObject({ outcome: 'unknown', sent: null });
    expect(lines).toEqual([
      `[account-custody] part of payment ${PAYMENT_A} could not be read; its change is not counted here`,
    ]);
  });

  it('counts nothing it cannot match, says so, and never searches that payment again', async () => {
    const first = await payment(ROOT, 23n, 4706n);
    const facts = new Map([
      [
        PAYMENT_A,
        { ...first.fact, outputs: [{ commitment: '66'.repeat(32), contract: LIVE_ACCOUNT, mtIndex: 4706n }] },
      ],
    ]);
    const lines: string[] = [];
    const commitmentsFor = vi.fn(hashes.commitmentsFor);
    const deps = { ...hashes, commitmentsFor, facts, log: (line: string) => void lines.push(line) };
    const result = await walkCustodyChange(ACCOUNT, [ROOT], [PAYMENT_A], deps);
    expect(result).toEqual({ added: [], pending: [] });
    expect(lines).toEqual([
      `[account-custody] no amount matches the change of payment ${PAYMENT_A}; it is not counted here`,
    ]);
    expect(loadCustodyChangeSteps(ACCOUNT).get(ROOT.nonce)).toMatchObject({ outcome: 'unknown', sent: null });

    /* Capped, in words, and remembered the same way. */
    const capped = await walkCustodyChange(
      ACCOUNT,
      [{ ...ROOT, nonce: '7e'.repeat(32) }],
      [PAYMENT_B],
      {
        ...deps,
        facts: new Map([
          [
            PAYMENT_B,
            {
              inputs: [
                { nullifier: custodyCoinNullifier(runtime, { ...ROOT, nonce: '7e'.repeat(32) }, LIVE_ACCOUNT), contract: LIVE_ACCOUNT },
              ],
              outputs: [{ commitment: '67'.repeat(32), contract: LIVE_ACCOUNT, mtIndex: 12n }],
              identifiers: [],
              whole: true,
            },
          ],
        ]),
        search: { cap: 5 },
      },
    );
    expect(capped.pending).toEqual([]);
    expect(lines[1]).toBe(
      `[account-custody] the change of payment ${PAYMENT_B} was not found in the 5 amounts tried; it is not counted here`,
    );

    /* Asked again: nothing is searched. */
    commitmentsFor.mockClear();
    await walkCustodyChange(ACCOUNT, [ROOT], [PAYMENT_A], deps);
    expect(commitmentsFor).not.toHaveBeenCalled();
  });

  it('says a search that ran out on the console when no log is handed in', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = await payment(ROOT, 23n, 4706n);
    await walkCustodyChange(ACCOUNT, [ROOT], [PAYMENT_A], {
      ...hashes,
      facts: new Map([[PAYMENT_A, first.fact]]),
      search: { cap: 3 },
    });
    expect(warn).toHaveBeenCalledWith(
      `[account-custody] the change of payment ${PAYMENT_A} was not found in the 3 amounts tried; it is not counted here`,
    );
    warn.mockRestore();
  });

  it('keeps a coin waiting while the spend that might have consumed it is unread, and finishes it later', async () => {
    const first = await payment(ROOT, 23n, 4706n);
    const second = await payment(first.change!, 7n, 4811n);
    /* Only the first spend is read: the 77 might have been spent by the second. */
    const early = await walkCustodyChange(ACCOUNT, [ROOT], [PAYMENT_A, PAYMENT_B], {
      ...hashes,
      facts: new Map([[PAYMENT_A, first.fact]]),
    });
    expect(early).toEqual({ added: [], pending: [ROOT] });
    expect(k1ColourBalance(ACCOUNT, MUSD)).toBe(0n);
    expect(storedWalk()[`stagenet::${LIVE_ACCOUNT}`].pending).toEqual([
      { colour: MUSD, nonce: ROOT.nonce, value: '100' },
    ]);

    /* A later read, with no root handed in: the waiting coin is walked, and the
       first spend is not searched again. */
    const commitmentsFor = vi.fn(hashes.commitmentsFor);
    const later = await walkCustodyChange(ACCOUNT, [], [PAYMENT_A, PAYMENT_B], {
      ...hashes,
      commitmentsFor,
      facts: new Map([
        [PAYMENT_A, first.fact],
        [PAYMENT_B, second.fact],
      ]),
    });
    expect(later.pending).toEqual([]);
    expect(later.added.map((coin) => coin.value)).toEqual([70n]);
    expect(commitmentsFor).toHaveBeenCalledTimes(1);
  });

  it('keeps a coin waiting when the walk is asked to stop, or a hash cannot be made', async () => {
    const first = await payment(ROOT, 23n, 4706n);
    const facts = new Map([[PAYMENT_A, first.fact]]);
    const stopped = await walkCustodyChange(ACCOUNT, [ROOT], [PAYMENT_A], {
      ...hashes,
      facts,
      search: { slice: 1, pause: async () => {}, shouldStop: () => true },
    });
    expect(stopped).toEqual({ added: [], pending: [ROOT] });
    expect(loadCustodyChangeSteps(ACCOUNT).size).toBe(0);

    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const broken = await walkCustodyChange(ACCOUNT, [], [PAYMENT_A], {
      ...hashes,
      facts,
      nullifierOf: () => {
        throw new Error('no runtime');
      },
    });
    expect(broken.pending).toEqual([ROOT]);
    expect(info).toHaveBeenCalledWith(
      '[account-custody] the change of a payment could not be followed this time',
      expect.any(Error),
    );
    info.mockRestore();
  });

  it('files nothing for a coin no spend consumed, and nothing twice', async () => {
    const result = await walkCustodyChange(ACCOUNT, [ROOT, { ...ROOT, colour: MUSD.toUpperCase() }], [PAYMENT_A], {
      ...hashes,
      facts: new Map([[PAYMENT_A, { inputs: [], outputs: [], identifiers: [], whole: true }]]),
    });
    expect(result).toEqual({ added: [], pending: [] });
    /* And nothing that is not a coin is walked at all. */
    const odd = await walkCustodyChange(
      ACCOUNT,
      [{ colour: 'x', nonce: ROOT.nonce, value: 1n }, { colour: MUSD, nonce: 'y', value: 1n }],
      [PAYMENT_A],
      { ...hashes, facts: new Map() },
    );
    expect(odd).toEqual({ added: [], pending: [] });
  });

  it('leaves what the store already holds where it is, and puts it where the chain says', async () => {
    const first = await payment(ROOT, 23n, 4706n);
    const facts = new Map([[PAYMENT_A, first.fact]]);
    /* This device filed the change itself — from the note — with the two
       positions that payment made, the wrong one first. */
    expect(enqueueK1Coin(ACCOUNT, { ...first.change!, mtIndex: 4705n }, [4705n, 4706n])).toBe('held');
    const result = await walkCustodyChange(ACCOUNT, [ROOT], [PAYMENT_A], { ...hashes, facts });
    expect(result.added).toEqual([]);
    expect(heldK1Coin(ACCOUNT, MUSD)).toEqual({ ...first.change!, mtIndex: 4706n });
    expect(loadCustodyChangeSteps(ACCOUNT).get(ROOT.nonce)?.found).toBe(false);
    expect(k1ColourBalance(ACCOUNT, MUSD)).toBe(77n);
  });

  it('touches a held coin already in the right place no further, and a queued one not at all', async () => {
    const first = await payment(ROOT, 23n, 4706n);
    const facts = new Map([[PAYMENT_A, first.fact]]);
    expect(enqueueK1Coin(ACCOUNT, { ...first.change!, mtIndex: 4706n })).toBe('held');
    await walkCustodyChange(ACCOUNT, [ROOT], [PAYMENT_A], { ...hashes, facts });
    expect(heldK1Coin(ACCOUNT, MUSD)?.mtIndex).toBe(4706n);

    /* Queued behind another coin, at a position of its own: left as it is. */
    storage.clear();
    expect(enqueueK1Coin(ACCOUNT, { colour: MUSD, nonce: '01'.repeat(32), value: 5n, mtIndex: 1n })).toBe('held');
    expect(enqueueK1Coin(ACCOUNT, { ...first.change!, mtIndex: 4700n })).toBe('queued');
    await walkCustodyChange(ACCOUNT, [ROOT], [PAYMENT_A], { ...hashes, facts });
    expect(queuedK1Coins(ACCOUNT, MUSD)).toEqual([{ ...first.change!, mtIndex: 4700n }]);
    expect(heldK1Coin(ACCOUNT, MUSD)?.nonce).toBe('01'.repeat(32));
  });

  it('refuses a change this device has spent, and leaves its own payment’s change to its own bookkeeping', async () => {
    const first = await payment(ROOT, 23n, 4706n);
    const facts = new Map([[PAYMENT_A, first.fact]]);
    /* Spent here already. */
    expect(enqueueK1Coin(ACCOUNT, { ...first.change!, mtIndex: 4706n })).toBe('held');
    forgetSpentK1Coins(ACCOUNT, [first.change!.nonce]);
    expect(isK1NonceSpent(ACCOUNT, first.change!.nonce)).toBe(true);
    const spent = await walkCustodyChange(ACCOUNT, [ROOT], [PAYMENT_A], { ...hashes, facts });
    expect(spent.added).toEqual([]);
    expect(k1ColourBalance(ACCOUNT, MUSD)).toBe(0n);

    /* This device's own payment, waiting for its position: not filed twice. */
    storage.clear();
    expect(enqueueK1Coin(ACCOUNT, { ...ROOT, mtIndex: 4702n })).toBe('held');
    rememberK1ChangeCoin(ACCOUNT, MUSD, { colour: MUSD, nonce: first.change!.nonce, value: 77n }, 'own-payment');
    const own = await walkCustodyChange(ACCOUNT, [ROOT], [PAYMENT_A], { ...hashes, facts });
    expect(own.added).toEqual([]);
    expect(heldK1Coin(ACCOUNT, MUSD)).toBeNull();
  });

  it('ends even where what it remembers goes round in a circle', async () => {
    /* Two remembered steps whose changes are each other's coins — nothing a
       real chain can say, and the bound on the walk is what ends it. */
    const a = '0a'.repeat(32);
    const b = '0b'.repeat(32);
    const step = (change: string) => ({
      txHash: PAYMENT_A,
      colour: MUSD,
      spentValue: '5',
      outcome: 'change',
      change: { nonce: change, value: '5', mtIndex: '1' },
    });
    storage.set(
      WALK_KEY,
      JSON.stringify({ [`stagenet::${LIVE_ACCOUNT}`]: { pending: [], steps: { [a]: step(b), [b]: step(a) } } }),
    );
    const result = await walkCustodyChange(ACCOUNT, [{ colour: MUSD, nonce: a, value: 5n }], [PAYMENT_A], {
      ...hashes,
      facts: new Map(),
    });
    expect(result).toEqual({ added: [], pending: [] });
  });
});

/* -------------------------------------------------------------------------- */
/* What the walk remembers                                                    */
/* -------------------------------------------------------------------------- */

describe('what the walk remembers', () => {
  it('reads back only what it wrote, and nothing malformed', () => {
    const good = {
      txHash: PAYMENT_A,
      colour: MUSD,
      spentValue: '100',
      outcome: 'exact',
      sent: '100',
    };
    storage.set(
      WALK_KEY,
      JSON.stringify({
        [`stagenet::${LIVE_ACCOUNT}`]: {
          pending: [null, { colour: MUSD, nonce: 'short', value: '1' }, { colour: MUSD, nonce: '01'.repeat(32), value: 'x' }, { colour: MUSD, nonce: '02'.repeat(32), value: '3' }],
          steps: {
            [ROOT.nonce]: good,
            ['03'.repeat(32)]: { ...good, sent: 'lots' },
            ['04'.repeat(32)]: { ...good, outcome: 'maybe' },
            ['05'.repeat(32)]: { ...good, outcome: 'change', change: { nonce: 'no', value: '1', mtIndex: '1' } },
            ['06'.repeat(32)]: { ...good, outcome: 'change' },
            ['07'.repeat(32)]: { ...good, txHash: 'no' },
            ['08'.repeat(32)]: null,
            nonsense: good,
          },
        },
      }),
    );
    const steps = loadCustodyChangeSteps(ACCOUNT);
    expect([...steps.keys()]).toEqual([ROOT.nonce, '03'.repeat(32)]);
    expect(steps.get('03'.repeat(32))?.sent).toBeNull();
    expect(steps.get(ROOT.nonce)?.sent).toBe(100n);
  });

  it('reads nothing from storage that is not a record, and nothing for an account that is not one', () => {
    for (const raw of ['not json', '[1,2]', 'null', JSON.stringify({ [`stagenet::${LIVE_ACCOUNT}`]: 7 })]) {
      storage.set(WALK_KEY, raw);
      expect(loadCustodyChangeSteps(ACCOUNT).size).toBe(0);
    }
    storage.set(WALK_KEY, JSON.stringify({ [`stagenet::${LIVE_ACCOUNT}`]: { steps: 'x', pending: 'y' } }));
    expect(loadCustodyChangeSteps(ACCOUNT).size).toBe(0);
    expect(loadCustodyChangeSteps({ network: '', address: LIVE_ACCOUNT }).size).toBe(0);
  });

  it('writes nothing for an account that is not one, and survives storage that refuses', async () => {
    await walkCustodyChange({ network: 'stagenet', address: 'nope' }, [ROOT], [PAYMENT_A], {
      ...hashes,
      facts: new Map(),
    });
    expect(storage.has(WALK_KEY)).toBe(false);

    const first = await payment(ROOT, 23n, 4706n);
    const setItem = vi.fn(() => {
      throw new Error('full');
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: { getItem: () => null, setItem, removeItem: () => {} }, crypto: globalThis.crypto },
    });
    const result = await walkCustodyChange(ACCOUNT, [ROOT], [PAYMENT_A], {
      ...hashes,
      facts: new Map([[PAYMENT_A, first.fact]]),
      ...quiet,
    });
    expect(result.pending).toEqual([]);
    expect(setItem).toHaveBeenCalled();
  });

  it('lets the oldest waiting coin go past the limit', async () => {
    const roots = Array.from({ length: CUSTODY_CHANGE_PENDING_LIMIT + 2 }, (_, index) => ({
      colour: MUSD,
      nonce: index.toString(16).padStart(2, '0').repeat(32),
      value: 10n,
    }));
    const result = await walkCustodyChange(ACCOUNT, roots, [PAYMENT_A], { ...hashes, facts: new Map() });
    expect(result.pending).toHaveLength(CUSTODY_CHANGE_PENDING_LIMIT + 2);
    const kept = storedWalk()[`stagenet::${LIVE_ACCOUNT}`].pending as { nonce: string }[];
    expect(kept).toHaveLength(CUSTODY_CHANGE_PENDING_LIMIT);
    expect(kept[0].nonce).toBe(roots[2].nonce);
  });
});

/* -------------------------------------------------------------------------- */
/* Where it starts, and the whole of it                                       */
/* -------------------------------------------------------------------------- */

describe('a coin written down before a walk runs', () => {
  it('is walked by the next walk, even one that was already running when it was written', async () => {
    const first = await payment(ROOT, 23n, 4706n);
    rememberCustodyChangeRoots(ACCOUNT, [ROOT, ROOT, { colour: 'x', nonce: ROOT.nonce, value: 1n }]);
    expect(storedWalk()[`stagenet::${LIVE_ACCOUNT}`].pending).toEqual([
      { colour: MUSD, nonce: ROOT.nonce, value: '100' },
    ]);
    /* Nothing new: nothing written. */
    const before = storage.get(WALK_KEY);
    rememberCustodyChangeRoots(ACCOUNT, [ROOT]);
    expect(storage.get(WALK_KEY)).toBe(before);

    /* A second coin written down WHILE a walk is running — here, from inside
       the walk's own search — is still waiting when that walk finishes. */
    const later = { colour: MUSD, nonce: '55'.repeat(32), value: 9n };
    const result = await walkCustodyChange(ACCOUNT, [], [PAYMENT_A], {
      ...hashes,
      commitmentsFor: (coin) => {
        rememberCustodyChangeRoots(ACCOUNT, [later]);
        return hashes.commitmentsFor(coin);
      },
      facts: new Map([[PAYMENT_A, first.fact]]),
    });
    expect(result.added.map((coin) => coin.value)).toEqual([77n]);
    expect(storedWalk()[`stagenet::${LIVE_ACCOUNT}`].pending).toEqual([
      { colour: MUSD, nonce: later.nonce, value: '9' },
    ]);
    /* And a coin already followed is not written down again. */
    rememberCustodyChangeRoots(ACCOUNT, [ROOT]);
    expect(storedWalk()[`stagenet::${LIVE_ACCOUNT}`].pending).toHaveLength(1);
  });

  it('files nothing while a payment owns the store, and files it on the next walk', async () => {
    const first = await payment(ROOT, 23n, 4706n);
    const facts = new Map([[PAYMENT_A, first.fact]]);
    const busy = await walkCustodyChange(ACCOUNT, [ROOT], [PAYMENT_A], {
      ...hashes,
      facts,
      search: { shouldStop: () => true },
    });
    expect(busy).toEqual({ added: [], pending: [ROOT] });
    expect(k1ColourBalance(ACCOUNT, MUSD)).toBe(0n);
    /* The search itself is remembered, so the next walk only files. */
    expect(loadCustodyChangeSteps(ACCOUNT).get(ROOT.nonce)).toMatchObject({ sent: 23n, found: false });
    const commitmentsFor = vi.fn(hashes.commitmentsFor);
    const free = await walkCustodyChange(ACCOUNT, [], [PAYMENT_A], { ...hashes, commitmentsFor, facts });
    expect(free.added.map((coin) => coin.value)).toEqual([77n]);
    expect(commitmentsFor).not.toHaveBeenCalled();
  });
});

describe('where a walk starts', () => {
  it('is every described coin the store counts as spent and no walk has followed', async () => {
    enqueueK1Coin(ACCOUNT, { ...ROOT, mtIndex: 4702n });
    forgetSpentK1Coins(ACCOUNT, [ROOT.nonce]);
    const unspent = { colour: MUSD, nonce: '44'.repeat(32), value: 3n };
    const described = [ROOT, ROOT, unspent, { colour: 'x', nonce: ROOT.nonce, value: 1n }, { colour: MUSD, nonce: 'x', value: 1n }];
    expect(custodyChangeRoots(ACCOUNT, described)).toEqual([ROOT]);

    /* Once followed, it is not a place to start from again. */
    const whole = await payment(ROOT, 100n, 4706n);
    await walkCustodyChange(ACCOUNT, [ROOT], [PAYMENT_A], { ...hashes, facts: new Map([[PAYMENT_A, whole.fact]]) });
    expect(custodyChangeRoots(ACCOUNT, described)).toEqual([]);
  });
});

describe('the change recovery, as Home runs it', () => {
  const HISTORY: CustodyActionRow[] = [
    { kind: 'ContractCall', entryPoint: 'deposit_shielded', txHash: 'd1'.repeat(32), status: 'SUCCESS' },
    { kind: 'ContractCall', entryPoint: 'withdraw_shielded_to_contract_with_jubjub', txHash: PAYMENT_A, status: 'SUCCESS' },
  ];

  it('reads the spend with the ledger’s own decoder, finds the change, and asks nothing the next time', async () => {
    const ledger = await import('@midnightntwrk/ledger-v9');
    const made = await compiledSend(LIVE_ACCOUNT, ROOT, toContract(LIVE_RECIPIENT), 23n);
    const raws = [
      inputEvent(LIVE_ACCOUNT, PAYMENT_A, custodyCoinNullifier(runtime, ROOT, LIVE_ACCOUNT)),
      outputEvent(LIVE_RECIPIENT, PAYMENT_A, '5f'.repeat(32), 4705),
      outputEvent(LIVE_ACCOUNT, PAYMENT_A, compiledCommitment(made.change!), 4706),
    ];
    const asked: string[] = [];
    const deps = {
      ...hashes,
      ask: (query: string) => {
        asked.push(query);
        return Promise.resolve({
          data: { t0: [{ hash: PAYMENT_A, identifiers: ['00ab'], zswapLedgerEvents: raws.map((raw) => ({ raw })) }] },
        });
      },
      decode: (raw: string) => ledger.Event.deserialize(bytes(raw)).content,
      known: new Map(),
      facts: new Map(),
    };

    const result = await recoverCustodyChange(ACCOUNT, HISTORY, [ROOT], deps);
    expect(result).toEqual({
      added: [{ colour: MUSD, nonce: hex(made.change!.nonce), value: 77n, mtIndex: 4706n }],
      pending: [],
    });
    expect(k1ColourBalance(ACCOUNT, MUSD)).toBe(77n);
    expect(asked).toHaveLength(1);

    /* An idle read: nothing handed in, nothing waiting — nothing asked. */
    expect(await recoverCustodyChange(ACCOUNT, HISTORY, [], deps)).toEqual({ added: [], pending: [] });
    expect(asked).toHaveLength(1);
  });

  it('asks nothing for a history with no spends in it, or none at all', async () => {
    const ask = vi.fn();
    const deps = { ...hashes, ask, decode: () => null, known: new Map(), facts: new Map() };
    expect(await recoverCustodyChange(ACCOUNT, [HISTORY[0]], [ROOT], deps)).toEqual({ added: [], pending: [] });
    expect(await recoverCustodyChange(ACCOUNT, null, [ROOT], deps)).toEqual({ added: [], pending: [] });
    expect(ask).not.toHaveBeenCalled();
  });

  it('walks what a previous read left waiting even when nothing new is handed in', async () => {
    const first = await payment(ROOT, 23n, 4706n);
    storage.set(
      WALK_KEY,
      JSON.stringify({
        [`stagenet::${LIVE_ACCOUNT}`]: { pending: [{ colour: MUSD, nonce: ROOT.nonce, value: '100' }], steps: {} },
      }),
    );
    const facts = new Map([[PAYMENT_A, first.fact]]);
    const result = await recoverCustodyChange(ACCOUNT, HISTORY, [], {
      ...hashes,
      ask: vi.fn(),
      decode: () => null,
      known: new Map([[PAYMENT_A, first.fact.inputs]]),
      facts,
    });
    expect(result.added.map((coin) => coin.value)).toEqual([77n]);
  });
});
