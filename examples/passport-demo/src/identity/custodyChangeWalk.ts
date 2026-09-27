/**
 * THE CHANGE A PAYMENT KEPT, FOUND ON THE CHAIN WHEN NO NOTE DESCRIBES IT
 * (2026/09/27).
 *
 * WHY IT HAS TO BE FOUND
 * ----------------------
 * A payment of part of a coin spends the whole coin and makes two: the part
 * that was sent, and the change, which the account keeps. The device that paid
 * learns the change from the circuit's return value and files it; every OTHER
 * device learns it only from the note the paying device seals into the
 * account's inbox afterwards ("keep change"). When that note is never written —
 * the tab was closed after the payment and before the note, which is what a
 * tester did on a real Android phone on 2026/09/27 — no device can ever read
 * the change again. The account below held 100 mUSD, sent 23 from the device a
 * first recovery made, and the phone of the second recovery showed 0 where 77
 * was plainly still held: the chain check (`./custodySpentCoins.ts`) had rightly
 * stopped counting the spent 100, and nothing described what replaced it.
 *
 *   account 511f5fa8…a720, stagenet: the 100 mUSD opening grant at 05:00:06,
 *   the 23 mUSD payment in transaction c78b3fc0…2463 at 05:25:36, and no note
 *   for its change.
 *
 * WHY IT CAN BE FOUND: THE CHANGE IS A FUNCTION OF THE COIN IT CAME FROM
 * ----------------------------------------------------------------------
 * Read off the compiled build this app ships, not from prose:
 * `contracts/stagenet/account-custody/contract/index.js`, `_sendShielded_0`
 * (line 4743), the one function every `withdraw_shielded*` circuit spends
 * through (`_do_withdraw_shielded_0` and `_do_withdraw_shielded_to_contract_0`,
 * lines 6411 and 6428). It makes BOTH outputs from the spent input coin:
 *
 *   sent   = { nonce: upgradeFromTransient(transientHash<Vector<2, Field>>([
 *                      "midnight:kernel:nonce_evolve", degradeToTransient(input.nonce)])),
 *              color: input.color, value }                         (lines 4782–4790)
 *   change = { nonce: upgradeFromTransient(transientHash<Vector<2, Field>>([
 *                      "midnight:kernel:nonce_evolve/2", degradeToTransient(input.nonce)])),
 *              color: input.color, value: input.value - value }    (lines 4836–4844)
 *
 * the change made, when it is not zero, as an output to `right(self)` and filed
 * under `_coinCommitment_0(change, right(self))` (lines 4845–4850). Each domain
 * tag enters as `convertBytesToUint(<Field max>, n, <its bytes>, 'Field',
 * '<standard library>')`, exactly as written there. So a device that knows the
 * spent coin — from a note — knows the change's nonce and colour exactly.
 * {@link custodyChangeNonce} is that expression, and `./custodyChangeWalk.test.ts`
 * runs the compiled `_sendShielded_0` itself on known coins and holds this to
 * its output byte for byte.
 *
 * WHAT IS LEFT TO FIND IS THE VALUE, AND IT IS SMALL
 * --------------------------------------------------
 * The change's value is somewhere in [1, input.value − 1], and its commitment
 * is one of the outputs the SAME transaction made for this account — which the
 * spend's own Zswap events list, with where each landed (`zswapOutput`:
 * commitment, contract, `mtIndex`). So each candidate value costs one
 * commitment, compared against those one or two outputs. Every shielded colour
 * in this app is a whole count (`../lib/colour.ts`: decimals 0; an opening
 * grant is 100), so the search is a few dozen hashes. It is BOUNDED anyway:
 * {@link CUSTODY_CHANGE_SEARCH_CAP} candidates (2^20), tried from both ends of
 * the range — a small payment and "most of it" are both common — in slices of
 * {@link CUSTODY_CHANGE_SEARCH_SLICE} with the event loop given back between
 * them, so a large coin can never hold the screen. A search that runs out says
 * so in the console, in words, and the coin is not counted rather than guessed.
 * At about 12 µs a commitment on a laptop the whole cap is some twelve seconds
 * in the background; a phone is a few times slower, and still in the
 * background. It runs on the page rather than in a worker because the Compact
 * runtime it needs is already loaded there, and for every value this app can
 * hold it finishes inside one slice.
 *
 * AND THEN AGAIN: A CHAIN OF THEM
 * -------------------------------
 * The change may itself have been spent later, making change of its own. So
 * the walk follows the chain — spent coin, its spend, its change, that change's
 * spend — until it reaches a coin no spend has consumed, and puts THAT in the
 * store, at the position the chain gave it. On the way it learns what each
 * payment sent (input − change, or the whole coin where the spend made nothing
 * for this account), which Activity reads (`../lib/custodyChainActivity.ts`).
 *
 * CHEAP ON AN IDLE HOME
 * ---------------------
 * Each spend is walked ONCE: what it did is written down, per spent coin, under
 * `passport-custody-change-walk:v1` beside the account, and never searched
 * again — a transaction on the chain does not change. A coin whose spend has
 * not been read yet is kept as pending and tried on a later read. With nothing
 * new, a read asks nothing and hashes nothing.
 *
 * ONLY WHAT THE CHAIN SHOWS IS ADDED
 * ----------------------------------
 * A coin goes into the store only when its commitment is one the chain made for
 * this account, and nothing the store already knows is overwritten: a coin
 * already held or queued is left where it is (its position pinned to the
 * chain's where they differ), one this device has spent is refused by the
 * store itself, and one this device is still waiting to place — its own
 * payment's change — is left to that bookkeeping. Nor is anything filed while
 * a payment is running: a payment owns the store until it has finished
 * (`../lib/custodyScreenRules.ts`, `custodyMayReadHoldings`), so a walk asked
 * to stop leaves the coin waiting for the next read.
 *
 * It holds no DOM, no React, no `fetch`, no ledger, and no runtime: the
 * question to the indexer, the event decoder, and the Compact runtime are
 * handed in.
 */

import { normalisedColourHex } from '../lib/colour.js';
import { hexToBytes } from './custodyContractPlan.js';
import type { CustodyActionRow } from './custodyInboxIndex.js';
import {
  CUSTODY_COIN_COMMITMENT_DOMAIN,
  custodyCoinHasher,
  custodyCoinNullifier,
  custodySpendTransactions,
  readCustodyTransactions,
  type CustodyCoinDescription,
  type CustodyCompactType,
  type CustodyHashRuntime,
  type CustodyTransactionFacts,
  type CustodyTransactionReadDeps,
} from './custodySpentCoins.js';
import {
  enqueueK1Coin,
  heldK1Coin,
  isK1NonceSpent,
  k1AccountKey,
  loadK1CoinStore,
  pinK1CoinPosition,
  refuseK1Account,
  type K1Account,
  type K1HeldCoin,
} from './k1CoinStore.js';

/* -------------------------------------------------------------------------- */
/* The change's nonce                                                         */
/* -------------------------------------------------------------------------- */

/** The tag the compiled build evolves a spent coin's nonce under for its CHANGE. */
export const CUSTODY_CHANGE_NONCE_DOMAIN = 'midnight:kernel:nonce_evolve/2';

/** The tag it evolves the same nonce under for the coin it SENDS. */
export const CUSTODY_SENT_NONCE_DOMAIN = 'midnight:kernel:nonce_evolve';

/**
 * The bound the compiled build hands `convertBytesToUint` for both tags — the
 * largest value of the proof system's scalar field, written there as a literal.
 */
export const CUSTODY_FIELD_MAX =
  52435875175126190479447740508185965837690552500527637822603658699938581184512n;

/** The pieces of the Compact runtime a nonce is evolved with, and nothing else. */
export interface CustodyNonceRuntime {
  transientHash<A>(type: CustodyCompactType<A>, value: A): bigint;
  degradeToTransient(x: Uint8Array): bigint;
  upgradeFromTransient(x: bigint): Uint8Array;
  convertBytesToUint(maxval: bigint, n: number, a: Uint8Array, name: string, src: string): bigint;
  CompactTypeField: CustodyCompactType<bigint>;
}

/** Everything of the runtime the walk uses: the coin hashes and the nonce. */
export type CustodyWalkRuntime = CustodyHashRuntime & CustodyNonceRuntime;

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * A spent coin's nonce, evolved under `domain`, as the compiled build evolves
 * it — see the header for the lines. Lowercase hex.
 *
 * The pair is laid out as the build's `CompactTypeVector(2, CompactTypeField)`
 * lays one out — the field's alignment twice, and the two values one after the
 * other — in the way `./custodySpentCoins.ts` lays out a coin's preimage from
 * its parts; the test holds the result to the build's own output.
 */
export function custodyEvolvedNonce(runtime: CustodyNonceRuntime, nonce: string, domain: string): string {
  const tag = new TextEncoder().encode(domain);
  const field = runtime.CompactTypeField;
  const pair: CustodyCompactType<bigint[]> = {
    alignment: () => [...field.alignment(), ...field.alignment()],
    toValue: (value) => [...field.toValue(value[0]), ...field.toValue(value[1])],
  };
  return toHex(
    runtime.upgradeFromTransient(
      runtime.transientHash(pair, [
        runtime.convertBytesToUint(CUSTODY_FIELD_MAX, tag.length, tag, 'Field', '<standard library>'),
        runtime.degradeToTransient(hexToBytes(nonce)),
      ]),
    ),
  );
}

/** The nonce of the change a spend of the coin with this nonce keeps. */
export function custodyChangeNonce(runtime: CustodyNonceRuntime, nonce: string): string {
  return custodyEvolvedNonce(runtime, nonce, CUSTODY_CHANGE_NONCE_DOMAIN);
}

/* -------------------------------------------------------------------------- */
/* The change's value                                                         */
/* -------------------------------------------------------------------------- */

/** How many values one search may try before it gives up and says so. */
export const CUSTODY_CHANGE_SEARCH_CAP = 1 << 20;

/** How many values are tried between two returns to the event loop. */
export const CUSTODY_CHANGE_SEARCH_SLICE = 512;

/**
 * The values the change of a coin of `parentValue` could have, most likely
 * first, and at most `cap` of them: from both ends of [1, parentValue − 1] in
 * turn — 99, 1, 98, 2, … for a coin of 100 — because a small payment (large
 * change) and "most of it" (small change) are both ordinary.
 */
export function* custodyChangeCandidates(
  parentValue: bigint,
  cap: number = CUSTODY_CHANGE_SEARCH_CAP,
): Generator<bigint> {
  let high = parentValue - 1n;
  let low = 1n;
  let given = 0;
  while (low <= high && given < cap) {
    yield high;
    given += 1;
    high -= 1n;
    if (low > high || given >= cap) return;
    yield low;
    given += 1;
    low += 1n;
  }
}

/** How a search is paced and bounded. Every field has a default. */
export interface CustodyChangeSearchOptions {
  /** {@link CUSTODY_CHANGE_SEARCH_CAP} by default. */
  readonly cap?: number;
  /** {@link CUSTODY_CHANGE_SEARCH_SLICE} by default. */
  readonly slice?: number;
  /** Gives the event loop back between slices. The next macrotask by default. */
  readonly pause?: () => Promise<void>;
  /** Asked between slices; true abandons the search without an answer. */
  readonly shouldStop?: () => boolean;
}

/** What a search came to. */
export type CustodyChangeSearch =
  | { readonly kind: 'found'; readonly value: bigint; readonly mtIndex: bigint; readonly tried: number }
  /** Every value in the range was tried and none is one of these outputs. */
  | { readonly kind: 'none'; readonly tried: number }
  /** The cap ran out before the range did. */
  | { readonly kind: 'capped'; readonly tried: number }
  /** It was asked to stop. */
  | { readonly kind: 'stopped'; readonly tried: number };

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * THE VALUE SEARCH: the first candidate whose commitment is one of `outputs`
 * (commitment → position, the outputs the spend made for this account).
 */
export async function findCustodyChangeValue(
  commitmentAt: (value: bigint) => string,
  parentValue: bigint,
  outputs: ReadonlyMap<string, bigint>,
  options: CustodyChangeSearchOptions = {},
): Promise<CustodyChangeSearch> {
  const cap = options.cap ?? CUSTODY_CHANGE_SEARCH_CAP;
  const slice = Math.max(1, options.slice ?? CUSTODY_CHANGE_SEARCH_SLICE);
  const pause = options.pause ?? nextTask;
  let tried = 0;
  for (const value of custodyChangeCandidates(parentValue, cap)) {
    if (tried > 0 && tried % slice === 0) {
      await pause();
      if (options.shouldStop?.() === true) return { kind: 'stopped', tried };
    }
    tried += 1;
    const mtIndex = outputs.get(commitmentAt(value));
    if (mtIndex !== undefined) return { kind: 'found', value, mtIndex, tried };
  }
  const range = parentValue > 1n ? parentValue - 1n : 0n;
  return BigInt(tried) < range ? { kind: 'capped', tried } : { kind: 'none', tried };
}

/* -------------------------------------------------------------------------- */
/* What the walk remembers                                                    */
/* -------------------------------------------------------------------------- */

/** What one spend of one of this account's coins did. */
export interface CustodyChangeStep {
  /** The spend. */
  readonly txHash: string;
  /** The colour of the coin it spent, which is the colour of everything it made. */
  readonly colour: string;
  /** The value of the coin it spent. */
  readonly spentValue: bigint;
  /**
   * `change`: the change was found. `exact`: the spend made nothing for this
   * account, so the whole coin was sent. `unknown`: it made something for this
   * account that no value in the search matched — not counted, and said so.
   */
  readonly outcome: 'change' | 'exact' | 'unknown';
  /** The change, with where it landed, when the outcome is `change`. */
  readonly change: { readonly nonce: string; readonly value: bigint; readonly mtIndex: bigint } | null;
  /** What the payment sent, where it is known. */
  readonly sent: bigint | null;
  /** Whether THIS walk put the change in the store — it was nowhere on this device before. */
  readonly found: boolean;
}

const WALK_KEY = 'passport-custody-change-walk:v1';

/** How many coins may wait for a later read before the oldest is let go. */
export const CUSTODY_CHANGE_PENDING_LIMIT = 64;

interface StoredStep {
  txHash: string;
  colour: string;
  spentValue: string;
  outcome: 'change' | 'exact' | 'unknown';
  change?: { nonce: string; value: string; mtIndex: string };
  sent?: string;
  found?: true;
}

interface StoredCoin {
  colour: string;
  nonce: string;
  value: string;
}

interface StoredWalk {
  pending: StoredCoin[];
  steps: Record<string, StoredStep>;
}

function decimal(value: unknown): bigint | null {
  return typeof value === 'string' && /^\d+$/.test(value) ? BigInt(value) : null;
}

function coinFromStored(row: unknown): CustodyCoinDescription | null {
  if (!row || typeof row !== 'object') return null;
  const stored = row as Partial<StoredCoin>;
  const colour = normalisedColourHex(stored.colour);
  const nonce = normalisedColourHex(stored.nonce);
  const value = decimal(stored.value);
  return colour === null || nonce === null || value === null ? null : { colour, nonce, value };
}

function stepFromStored(row: unknown): CustodyChangeStep | null {
  if (!row || typeof row !== 'object') return null;
  const stored = row as Partial<StoredStep>;
  const txHash = normalisedColourHex(stored.txHash);
  const colour = normalisedColourHex(stored.colour);
  const spentValue = decimal(stored.spentValue);
  if (txHash === null || colour === null || spentValue === null) return null;
  const sent = stored.sent === undefined ? null : decimal(stored.sent);
  if (stored.outcome === 'change') {
    const change = stored.change;
    const nonce = normalisedColourHex(change?.nonce);
    const value = decimal(change?.value);
    const mtIndex = decimal(change?.mtIndex);
    if (nonce === null || value === null || mtIndex === null) return null;
    return {
      txHash,
      colour,
      spentValue,
      outcome: 'change',
      change: { nonce, value, mtIndex },
      sent,
      found: stored.found === true,
    };
  }
  if (stored.outcome !== 'exact' && stored.outcome !== 'unknown') return null;
  return { txHash, colour, spentValue, outcome: stored.outcome, change: null, sent, found: false };
}

function storedStep(step: CustodyChangeStep): StoredStep {
  return {
    txHash: step.txHash,
    colour: step.colour,
    spentValue: step.spentValue.toString(),
    outcome: step.outcome,
    ...(step.change === null
      ? {}
      : {
          change: {
            nonce: step.change.nonce,
            value: step.change.value.toString(),
            mtIndex: step.change.mtIndex.toString(),
          },
        }),
    ...(step.sent === null ? {} : { sent: step.sent.toString() }),
    ...(step.found ? { found: true as const } : {}),
  };
}

function readAll(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WALK_KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function accountKey(account: K1Account): string | null {
  if (refuseK1Account(account) !== null) return null;
  return k1AccountKey({ network: account.network, address: normalisedColourHex(account.address)! });
}

/** What the walk remembers for one account: spends by the coin they spent, and coins waiting. */
function loadWalk(account: K1Account): {
  steps: Map<string, CustodyChangeStep>;
  pending: CustodyCoinDescription[];
} {
  const key = accountKey(account);
  const entry = key === null ? undefined : readAll()[key];
  const steps = new Map<string, CustodyChangeStep>();
  const pending: CustodyCoinDescription[] = [];
  if (entry && typeof entry === 'object') {
    const stored = entry as Partial<StoredWalk>;
    if (stored.steps && typeof stored.steps === 'object') {
      for (const [nonceKey, row] of Object.entries(stored.steps)) {
        const nonce = normalisedColourHex(nonceKey);
        const step = stepFromStored(row);
        if (nonce !== null && step !== null) steps.set(nonce, step);
      }
    }
    if (Array.isArray(stored.pending)) {
      for (const row of stored.pending) {
        const coin = coinFromStored(row);
        if (coin !== null) pending.push(coin);
      }
    }
  }
  return { steps, pending };
}

function saveWalk(
  account: K1Account,
  steps: ReadonlyMap<string, CustodyChangeStep>,
  pending: readonly CustodyCoinDescription[],
): void {
  const key = accountKey(account);
  if (key === null) return;
  const all = readAll();
  all[key] = {
    pending: pending.slice(-CUSTODY_CHANGE_PENDING_LIMIT).map((coin) => ({
      colour: coin.colour,
      nonce: coin.nonce,
      value: coin.value.toString(),
    })),
    steps: Object.fromEntries([...steps].map(([nonce, step]) => [nonce, storedStep(step)])),
  } satisfies StoredWalk;
  try {
    window.localStorage.setItem(WALK_KEY, JSON.stringify(all));
  } catch {
    /* A denied write costs a search on the next read, and nothing else: the
       coins themselves are in the coin store, which has its own write. */
  }
}

/** What every walk of this account has learnt: each spend, by the coin it spent. */
export function loadCustodyChangeSteps(account: K1Account): ReadonlyMap<string, CustodyChangeStep> {
  return loadWalk(account).steps;
}

/**
 * Writes spent coins down as waiting for a walk, BEFORE one runs.
 *
 * The chain check forgets a spent coin in the same read that finds it spent,
 * and a coin this device filed as its own change has no note to be found from
 * again. So its description is kept here first, and a walk — this read's, or
 * the next one's if this read's is busy or cut short — starts from it. A coin
 * already followed, or already waiting, is not written twice.
 */
export function rememberCustodyChangeRoots(account: K1Account, coins: readonly CustodyCoinDescription[]): void {
  const { steps, pending } = loadWalk(account);
  const next = [...pending];
  for (const coin of coins) {
    const nonce = normalisedColourHex(coin.nonce);
    const colour = normalisedColourHex(coin.colour);
    if (nonce === null || colour === null || steps.has(nonce) || next.some((held) => held.nonce === nonce)) continue;
    next.push({ colour, nonce, value: coin.value });
  }
  if (next.length > pending.length) saveWalk(account, steps, next);
}

/* -------------------------------------------------------------------------- */
/* Where the walk starts                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The coins described on this device that the store already counts as SPENT
 * and whose spend no walk has followed: where a walk starts on a device that
 * stopped counting a coin before this build could follow it (the chain check
 * shipped a day earlier), and after any other device's payment.
 *
 * A coin this device spent itself is in the list too, and is harmless there:
 * the walk finds the change this device already holds, and the store keeps it
 * where it is.
 */
export function custodyChangeRoots(
  account: K1Account,
  described: readonly CustodyCoinDescription[],
): CustodyCoinDescription[] {
  const { steps } = loadWalk(account);
  const roots: CustodyCoinDescription[] = [];
  for (const coin of described) {
    const nonce = normalisedColourHex(coin.nonce);
    const colour = normalisedColourHex(coin.colour);
    if (nonce === null || colour === null || steps.has(nonce)) continue;
    if (roots.some((root) => root.nonce === nonce) || !isK1NonceSpent(account, nonce)) continue;
    roots.push({ colour, nonce, value: coin.value });
  }
  return roots;
}

/* -------------------------------------------------------------------------- */
/* The walk                                                                   */
/* -------------------------------------------------------------------------- */

/** The three hashes a walk makes, bound to one account. */
export interface CustodyChangeHashes {
  /** A coin's nullifier as this account would spend it. */
  readonly nullifierOf: (coin: CustodyCoinDescription) => string;
  /** The change nonce of a spend of the coin with this nonce. */
  readonly changeNonceOf: (nonce: string) => string;
  /** The commitment this account's coin of this nonce and colour would have, by value. */
  readonly commitmentsFor: (coin: { readonly nonce: string; readonly colour: string }) => (value: bigint) => string;
}

/** {@link CustodyChangeHashes} made with the Compact runtime, for one account. */
export function custodyChangeHashes(runtime: CustodyWalkRuntime, address: string): CustodyChangeHashes {
  const commitment = custodyCoinHasher(runtime, CUSTODY_COIN_COMMITMENT_DOMAIN, address);
  return {
    nullifierOf: (coin) => custodyCoinNullifier(runtime, coin, address),
    changeNonceOf: (nonce) => custodyChangeNonce(runtime, nonce),
    commitmentsFor: ({ nonce, colour }) => (value) => commitment({ nonce, colour, value }),
  };
}

/** What a walk is handed: the chain's answers, and the hashes. */
export interface CustodyChangeWalkDeps extends CustodyChangeHashes {
  /** What each of the account's spends was read to say, by transaction hash. */
  readonly facts: ReadonlyMap<string, CustodyTransactionFacts>;
  readonly search?: CustodyChangeSearchOptions;
  /** Where a search that could not finish is said. `console.warn` by default. */
  readonly log?: (line: string) => void;
}

/** What one walk did. */
export interface CustodyChangeWalkResult {
  /** The coins it put in the store. */
  readonly added: readonly K1HeldCoin[];
  /** The coins still waiting for a spend to be read, or for a walk that was stopped. */
  readonly pending: readonly CustodyCoinDescription[];
}

/**
 * THE CHAIN WALK: from each coin that has been spent, through each spend's
 * change, to the coin that is still held — which goes in the store.
 *
 * `roots` are spent coins this device can describe. `spends` are the account's
 * spend transactions, oldest first ({@link custodySpendTransactions}). Coins a
 * previous walk left waiting are walked as well. See the header for every rule.
 */
export async function walkCustodyChange(
  account: K1Account,
  roots: readonly CustodyCoinDescription[],
  spends: readonly string[],
  deps: CustodyChangeWalkDeps,
): Promise<CustodyChangeWalkResult> {
  const address = normalisedColourHex(account.address);
  const log = deps.log ?? ((line: string) => console.warn(line));
  const { steps, pending: waiting } = loadWalk(account);
  const all: CustodyCoinDescription[] = [];
  for (const coin of [...waiting, ...roots]) {
    const nonce = normalisedColourHex(coin.nonce);
    const colour = normalisedColourHex(coin.colour);
    if (nonce !== null && colour !== null && !all.some((held) => held.nonce === nonce)) {
      all.push({ colour, nonce, value: coin.value });
    }
  }
  const added: K1HeldCoin[] = [];
  const pending: CustodyCoinDescription[] = [];
  const stop = (): boolean => deps.search?.shouldStop?.() === true;
  /* WRITTEN WITH WHATEVER WAS REMEMBERED MEANWHILE. A read that finds a coin
     spent writes it down while this walk may be running (see
     `rememberCustodyChangeRoots`); a save of this walk's own list alone would
     drop it. */
  const persist = (waitingNow: readonly CustodyCoinDescription[]): void => {
    const walked = new Set(all.map((coin) => coin.nonce));
    const since = loadWalk(account).pending.filter((coin) => !walked.has(coin.nonce));
    saveWalk(account, steps, [...waitingNow, ...since]);
  };

  /** The spend that consumed this coin, `unread` when a spend that might have is not read yet, or null. */
  const spendOf = (coin: CustodyCoinDescription): { readonly hash: string } | 'unread' | null => {
    const nullifier = deps.nullifierOf(coin);
    let unread = false;
    for (const hash of spends) {
      const fact = deps.facts.get(hash);
      if (fact === undefined) {
        unread = true;
        continue;
      }
      if (fact.inputs.some((input) => input.nullifier === nullifier && input.contract === address)) return { hash };
    }
    return unread ? 'unread' : null;
  };

  /** What one spend of `coin` did, searched for once. */
  const stepFor = async (coin: CustodyCoinDescription, txHash: string): Promise<CustodyChangeStep | 'stopped'> => {
    const fact = deps.facts.get(txHash) as CustodyTransactionFacts;
    const ours = new Map(
      fact.outputs.filter((output) => output.contract === address).map((output) => [output.commitment, output.mtIndex]),
    );
    const base = { txHash, colour: coin.colour, spentValue: coin.value, found: false };
    /* NOTHING MADE FOR THIS ACCOUNT is the whole coin sent — said only of a
       spend whose every event was read, because one this build could not
       decode may be the change. */
    if (ours.size === 0) {
      if (fact.whole) return { ...base, outcome: 'exact', change: null, sent: coin.value };
      log(`[account-custody] part of payment ${txHash} could not be read; its change is not counted here`);
      return { ...base, outcome: 'unknown', change: null, sent: null };
    }
    const nonce = deps.changeNonceOf(coin.nonce);
    const search = await findCustodyChangeValue(
      deps.commitmentsFor({ nonce, colour: coin.colour }),
      coin.value,
      ours,
      deps.search,
    );
    if (search.kind === 'stopped') return 'stopped';
    if (search.kind === 'found') {
      return {
        ...base,
        outcome: 'change',
        change: { nonce, value: search.value, mtIndex: search.mtIndex },
        sent: coin.value - search.value,
      };
    }
    log(
      search.kind === 'capped'
        ? `[account-custody] the change of payment ${txHash} was not found in the ${search.tried} amounts ` +
            'tried; it is not counted here'
        : `[account-custody] no amount matches the change of payment ${txHash}; it is not counted here`,
    );
    return { ...base, outcome: 'unknown', change: null, sent: null };
  };

  /** Files the coin the chain still holds, unless the store already has it. */
  const place = (coin: K1HeldCoin, madeBy: string): void => {
    const store = loadK1CoinStore(account);
    const awaited = Object.values(store.awaiting).some((rows) => rows.some((row) => row.nonceHex === coin.nonce));
    if (awaited) return;
    const where = enqueueK1Coin(account, coin);
    if (where === 'held' || where === 'queued') {
      added.push(coin);
      const step = steps.get(madeBy) as CustodyChangeStep;
      steps.set(madeBy, { ...step, found: true });
      return;
    }
    const held = heldK1Coin(account, coin.colour);
    if (where === 'known' && held !== null && held.nonce === coin.nonce && held.mtIndex !== coin.mtIndex) {
      pinK1CoinPosition(account, coin.colour, coin.mtIndex);
    }
  };

  const follow = async (root: CustodyCoinDescription): Promise<'done' | 'waiting'> => {
    let coin: CustodyCoinDescription = root;
    let placed: { coin: K1HeldCoin; madeBy: string } | null = null;
    /* Each step consumes a spend that no earlier step consumed, so a chain is
       never longer than the history; the bound is the proof it ends. */
    for (let depth = 0; depth <= spends.length; depth += 1) {
      let step = steps.get(coin.nonce);
      if (step === undefined) {
        const spentIn = spendOf(coin);
        if (spentIn === 'unread') return 'waiting';
        if (spentIn === null) {
          /* No spend consumed it: the coin the chain still holds. A root
             never gets here with a position, and has nothing to file. And
             nothing is filed while a payment owns the store — the next read
             files it. */
          if (placed === null) return 'done';
          if (stop()) return 'waiting';
          place(placed.coin, placed.madeBy);
          return 'done';
        }
        const found = await stepFor(coin, spentIn.hash);
        if (found === 'stopped') return 'waiting';
        step = found;
        steps.set(coin.nonce, step);
        persist(all);
      }
      if (step.change === null) return 'done';
      placed = {
        coin: { colour: step.colour, nonce: step.change.nonce, value: step.change.value, mtIndex: step.change.mtIndex },
        madeBy: coin.nonce,
      };
      coin = { colour: step.colour, nonce: step.change.nonce, value: step.change.value };
    }
    return 'done';
  };

  for (const root of all) {
    let outcome: 'done' | 'waiting';
    try {
      outcome = await follow(root);
    } catch (cause) {
      /* A hash that throws is a runtime this build cannot use; the coin waits
         for one that can, and nothing is written about it. */
      console.info('[account-custody] the change of a payment could not be followed this time', cause);
      outcome = 'waiting';
    }
    if (outcome === 'waiting') pending.push(root);
  }
  persist(pending);
  return { added, pending };
}

/* -------------------------------------------------------------------------- */
/* The whole of it, as Home runs it                                           */
/* -------------------------------------------------------------------------- */

/** What {@link recoverCustodyChange} is handed. */
export interface CustodyChangeRecoveryDeps extends CustodyTransactionReadDeps, CustodyChangeHashes {
  readonly search?: CustodyChangeSearchOptions;
  readonly log?: (line: string) => void;
}

/**
 * THE CHANGE RECOVERY, as one call: the spent coins handed in and the ones a
 * previous read left waiting, walked against the account's own spends —
 * which are read, from the one shared read, only when there is something to
 * walk. Nothing is asked and nothing is hashed on a read with nothing new.
 */
export async function recoverCustodyChange(
  account: K1Account,
  actions: readonly CustodyActionRow[] | null,
  spent: readonly CustodyCoinDescription[],
  deps: CustodyChangeRecoveryDeps,
): Promise<CustodyChangeWalkResult> {
  const spends = custodySpendTransactions(actions);
  if (spends.length === 0 || (spent.length === 0 && loadWalk(account).pending.length === 0)) {
    return { added: [], pending: loadWalk(account).pending };
  }
  const { facts } = await readCustodyTransactions(spends, deps);
  return walkCustodyChange(account, spent, spends, { ...deps, facts });
}
