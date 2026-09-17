/**
 * The qualified shielded coins a k1-arm account holds — the private state
 * behind the reference contract's `held_coin` witness.
 *
 * WHY THIS EXISTS (2026/09/16)
 * ----------------------------
 * The k1-arm account contract (`contract/contracts/account.compact` on the
 * reference, MIP-0012 §6.3) spends a shielded coin it never held in public
 * state:
 *
 *     witness held_coin(color: Bytes<32>): QualifiedShieldedCoinInfo;
 *
 * The qualified description — nonce, colour, value, AND the coin's position in
 * the Zswap commitment tree — enters proof generation as a private input. The
 * chain never carries it, so whatever the client forgets is gone, and a coin
 * whose description is gone cannot be spent by anybody, ever. That is the whole
 * reason this module is a STORE and not a cache.
 *
 * `docs/demo/k1-custody-layer-design.md` §3 names three things about the demo
 * as it stands today that each make the witness unanswerable:
 *
 *   1. The prototype's qualified coins live in PUBLIC ledger state, and the
 *      client projection drops what the witness needs — `AccountState.
 *      shieldedCoins` (`./accountCustody.ts`) is colour → value and nothing
 *      else. Nonces survive only wallet-side, and `shieldedCoinFromWalletCoin`
 *      drops `mt_index` outright, for a reason that is correct there and fatal
 *      here: the position a DEPOSIT allocates inside the contract is not the
 *      position the wallet held the note at. Nothing in the demo carries an
 *      `mt_index` today.
 *   2. The private-state provider is in-memory with a fresh id per connection
 *      (`./accountCustody.ts`, `passport-account-<addr8>-<random8>`). Fresh per
 *      connection is the right rule for a device secret — the secrets this call
 *      was handed must win over anything a previous connection left behind —
 *      and it is the wrong rule for a coin, because a coin store that does not
 *      outlive the connection cannot spend. See {@link k1PrivateStateProvider}.
 *   3. `accountWitnesses()` has no `held_coin` at all.
 *
 * This module answers (1) and (2). (3) is the custody module's, and this module
 * is the source it reads from.
 *
 * WHAT IS PERSISTED, AND IN WHOSE VOCABULARY
 * ------------------------------------------
 * {@link K1CoinStoreState} is byte-for-byte the shape the reference's
 * `CoinStorePrivateState` (`contract/src/wallet/witnesses.ts`) uses:
 * `encSecretKeyHex` plus `coins`, a colour → `{ nonceHex, colorHex, value,
 * mtIndex }` map, every field a string. Two deliberate consequences.
 *
 * Strings, because a `bigint` does not survive `JSON.stringify` and a
 * `Uint8Array` survives it as an object with numeric keys — the same rule
 * `./passportContractStore.ts` keeps for its drained amounts. A value that
 * silently round-trips into `{"0":12,"1":34}` is a coin that cannot be spent.
 *
 * `colorHex`, not `colourHex`, inside the stored shape. This app writes British
 * English and the API below does too ({@link heldK1Coin} takes a `colour`), but
 * the SERIALISED shape is the contract's, not ours: it is what a private-state
 * provider hands to a witness the reference wrote, and renaming a field across
 * that boundary would make the witness read `undefined` and throw. The spelling
 * stops at the storage edge, which is exactly where a wire format should.
 *
 * WHERE IT IS KEPT
 * ----------------
 * `localStorage`, under `passport-k1-coins:v1`, keyed by network AND account
 * address — the same two-part key and the same storage as
 * `./passportContractStore.ts`, for the same reason it gives: one browser may
 * hold an account on stagenet and another on preview, and a coin held by one is
 * not a coin held by the other. Reads filter; a row that cannot be read as a
 * qualified coin is dropped and never reaches the app, because the app's only
 * use for it is to put it in a proof.
 *
 * WHAT THIS MODULE IS NOT
 * -----------------------
 * It is not wired into anything. No screen reads it, no flow writes it, and
 * nothing in the app's behaviour changes by its existing — the k1 module itself
 * does not exist yet (design §1). It holds no DOM, no React, no wallet SDK, and
 * no network: {@link reconcileK1CoinFromChain} is handed a reader rather than
 * making a query, so the whole of this file is drilled directly in
 * `./k1CoinStore.test.ts` and sits in the coverage denominator at 100%. The
 * reader it is handed on a real connection is
 * `./contractRuntime.ts`'s `resolveTxCommitmentWindowOnce`, which is where the
 * indexer and its ten-second ceiling live.
 */

import { normalisedColourHex } from '../lib/colour.js';

const STORAGE_KEY = 'passport-k1-coins:v1';

/**
 * Which account, on which network. Both, and never just the address.
 *
 * The API below takes this where a bare address would read more naturally,
 * because a bare address cannot say which chain it is an address ON, and the
 * two chains' coins must never be able to reach each other — a stagenet
 * `mt_index` used against preview is a proof that cannot be satisfied.
 */
export interface K1Account {
  /** The network id, as `../lib/networks.ts` spells it. */
  readonly network: string;
  /** The account contract, raw 64-hex — `../identity/accountCustody.ts`'s form. */
  readonly address: string;
}

/**
 * One held coin as it is STORED — the reference's `StoredCoin`, field for
 * field. See the module header for why every field is a string and why the
 * colour is spelled the contract's way here and ours everywhere else.
 */
export interface StoredK1Coin {
  readonly nonceHex: string;
  readonly colorHex: string;
  /** Decimal. The coin's whole value; a coin is spent whole. */
  readonly value: string;
  /** Decimal. The Zswap commitment-tree position. */
  readonly mtIndex: string;
}

/**
 * The private state a k1 account's `held_coin` witness reads, exactly as the
 * reference's `CoinStorePrivateState` defines it.
 *
 * `encSecretKeyHex` is the X25519 account encryption secret — the viewing
 * capability that decrypts inbox entries (MIP-0012 §6.4). Nothing in this PR
 * uses it; it is here because the private state is a SHAPE shared with the
 * contract's witness, and a provider that served a shape missing a field the
 * witness expects would fail at proving time rather than here.
 */
export interface K1CoinStoreState {
  readonly encSecretKeyHex: string | null;
  /** Colour (64-hex, lowercase) → the one coin held in it. */
  readonly coins: Record<string, StoredK1Coin>;
}

/**
 * One held coin in THIS APP's vocabulary — hex for the bytes, `bigint` for the
 * numbers, and `colour` spelled the way every other module in `src` spells it.
 *
 * Deliberately not `Uint8Array`s. The witness does its own `hexToBytes`, the
 * demo's notes (`../lib/shieldedNote.ts`) are already hex, and a module that
 * decoded bytes would be a module with a second copy of the hex rule in it.
 */
export interface K1HeldCoin {
  readonly colour: string;
  readonly nonce: string;
  readonly value: bigint;
  readonly mtIndex: bigint;
}

/* -------------------------------------------------------------------------- */
/* Reading and writing storage                                                */
/* -------------------------------------------------------------------------- */

/**
 * A null-prototype map, for the reason `./passportContractStore.ts` gives:
 * `__proto__` is a legal JSON key, an ordinary object turns a write to it into
 * a prototype assignment that stores nothing, and a colour is attacker-adjacent
 * enough (it arrives from a depositor) that the question is worth not asking.
 */
function emptyMap<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** Storage key for one account on one network. Both halves, neither shadowing. */
export function k1AccountKey(account: K1Account): string {
  return `${account.network}::${account.address}`;
}

/** A decimal non-negative integer, or null. Leading zeros are not one. */
function normalisedDecimal(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^(0|[1-9][0-9]*)$/.test(value) ? value : null;
}

/**
 * A stored row as a coin, or null when it is not one.
 *
 * Every field is checked, and a row that fails any check is DROPPED rather than
 * repaired: the only thing the app does with a coin is put it in a proof, and a
 * repaired coin is one that proves nothing while looking spendable.
 */
function coinFromRow(row: unknown): K1HeldCoin | null {
  if (!row || typeof row !== 'object') return null;
  const candidate = row as Partial<StoredK1Coin>;
  const colour = normalisedColourHex(candidate.colorHex);
  const nonce = normalisedColourHex(candidate.nonceHex);
  const value = normalisedDecimal(candidate.value);
  const mtIndex = normalisedDecimal(candidate.mtIndex);
  if (colour === null || nonce === null || value === null || mtIndex === null) return null;
  return { colour, nonce, value: BigInt(value), mtIndex: BigInt(mtIndex) };
}

/**
 * A row that {@link readAll} has already checked, read back without checking it
 * twice.
 *
 * Split from {@link coinFromRow} rather than reusing it, because reuse there
 * would leave a "this cannot be read" branch that nothing can ever reach —
 * every row in a loaded state passed the check on the way in. A branch no test
 * can enter is a branch no reader can trust.
 */
function coinFromStoredRow(row: StoredK1Coin): K1HeldCoin {
  return {
    colour: row.colorHex,
    nonce: row.nonceHex,
    value: BigInt(row.value),
    mtIndex: BigInt(row.mtIndex),
  };
}

function rowFromCoin(coin: K1HeldCoin): StoredK1Coin {
  return {
    nonceHex: coin.nonce,
    colorHex: coin.colour,
    value: coin.value.toString(),
    mtIndex: coin.mtIndex.toString(),
  };
}

/** Every account's state, with unreadable accounts and rows filtered out. */
function readAll(): Record<string, K1CoinStoreState> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyMap();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return emptyMap();
    const accounts = emptyMap<K1CoinStoreState>();
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const entry = value as Partial<K1CoinStoreState>;
      const coins = emptyMap<StoredK1Coin>();
      if (entry.coins && typeof entry.coins === 'object') {
        for (const [colourKey, row] of Object.entries(entry.coins as Record<string, unknown>)) {
          const coin = coinFromRow(row);
          /* The KEY has to agree with the row. A row filed under one colour
             carrying another is not a coin with a typo in it — it is a coin the
             store would hand back for a colour it is not in, and the spend
             would fail at proving time with nothing to point at. */
          if (coin === null || coin.colour !== normalisedColourHex(colourKey)) continue;
          coins[coin.colour] = rowFromCoin(coin);
        }
      }
      accounts[key] = {
        encSecretKeyHex: typeof entry.encSecretKeyHex === 'string' ? entry.encSecretKeyHex : null,
        coins,
      };
    }
    return accounts;
  } catch {
    /* Storage denied, or a value that is not JSON. The session simply holds no
       remembered coins — which is the safe direction, because every path that
       would spend one asks this store first and refuses without an answer. */
    return emptyMap();
  }
}

function writeAll(accounts: Record<string, K1CoinStoreState>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
  } catch {
    /* A denied write loses the memory of the coin, not the coin: the
       description is still in whatever the caller holds, and `reconcile`
       against the same transaction learns it again. */
  }
}

/**
 * Why this account reference may not be used, in words, or null when it may.
 *
 * Writers throw on it and readers answer empty, which is the split
 * `./passportContractStore.ts` keeps: a malformed write is a bug in the caller
 * and should be loud, a malformed read is a question with a safe answer.
 */
export function refuseK1Account(account: K1Account): string | null {
  if (typeof account.network !== 'string' || account.network.trim() === '') {
    return 'A k1 coin store needs the network the account lives on.';
  }
  if (normalisedColourHex(account.address) === null) {
    return `A k1 coin store needs a raw 64-hex account address, not ${JSON.stringify(account.address)}.`;
  }
  return null;
}

function normalisedAccount(account: K1Account): K1Account | null {
  if (refuseK1Account(account) !== null) return null;
  return { network: account.network, address: normalisedColourHex(account.address)! };
}

function requireAccount(account: K1Account): K1Account {
  const refusal = refuseK1Account(account);
  if (refusal !== null) throw new Error(refusal);
  return { network: account.network, address: normalisedColourHex(account.address)! };
}

/* -------------------------------------------------------------------------- */
/* The store                                                                  */
/* -------------------------------------------------------------------------- */

const EMPTY_STATE: K1CoinStoreState = { encSecretKeyHex: null, coins: emptyMap() };

/**
 * The whole private state of one account — what {@link k1PrivateStateProvider}
 * serves to midnight-js, and what a `held_coin` witness reads.
 */
export function loadK1CoinStore(account: K1Account): K1CoinStoreState {
  const normalised = normalisedAccount(account);
  if (normalised === null) return EMPTY_STATE;
  const accounts = readAll();
  const key = k1AccountKey(normalised);
  return Object.hasOwn(accounts, key) ? accounts[key] : EMPTY_STATE;
}

function saveK1CoinStore(account: K1Account, state: K1CoinStoreState): void {
  const accounts = readAll();
  accounts[k1AccountKey(account)] = state;
  writeAll(accounts);
}

/** The coin this account holds in this colour, or null. */
export function heldK1Coin(account: K1Account, colour: string): K1HeldCoin | null {
  const wanted = normalisedColourHex(colour);
  if (wanted === null) return null;
  const state = loadK1CoinStore(account);
  return Object.hasOwn(state.coins, wanted) ? coinFromStoredRow(state.coins[wanted]) : null;
}

/** Every coin this account holds, ordered by colour so two reads agree. */
export function listK1Coins(account: K1Account): K1HeldCoin[] {
  const state = loadK1CoinStore(account);
  return Object.values(state.coins)
    .map(coinFromStoredRow)
    .sort((a, b) => (a.colour < b.colour ? -1 : 1));
}

/**
 * Why this coin may not be stored, or null when it may.
 *
 * ONE COIN PER COLOUR is the contract's own rule, not a simplification here:
 * `held_coin(color)` takes a colour and returns a coin, so a second coin of the
 * same colour is a coin the witness has no way to name. {@link putK1Coin}
 * therefore replaces rather than appends, and the caller that has two must
 * decide which survives — see {@link replaceK1Coin}.
 */
export function refuseK1Coin(coin: K1HeldCoin): string | null {
  if (normalisedColourHex(coin.colour) === null) {
    return `A held coin needs a 64-hex colour, not ${JSON.stringify(coin.colour)}.`;
  }
  if (normalisedColourHex(coin.nonce) === null) {
    return `A held coin needs a 64-hex nonce, not ${JSON.stringify(coin.nonce)}.`;
  }
  if (typeof coin.value !== 'bigint' || coin.value < 0n) {
    return 'A held coin needs a value of zero or more.';
  }
  if (typeof coin.mtIndex !== 'bigint' || coin.mtIndex < 0n) {
    return 'A held coin needs a commitment-tree position of zero or more.';
  }
  return null;
}

/**
 * Remembers a coin, replacing whatever this account held in that colour.
 *
 * Throws on a coin it cannot store, for the reason
 * `savePassportContractRecord` throws: a store that quietly accepted a coin it
 * could not read back would turn a caller's bug into an unspendable balance
 * discovered days later at proving time.
 */
export function putK1Coin(account: K1Account, coin: K1HeldCoin): void {
  const target = requireAccount(account);
  const refusal = refuseK1Coin(coin);
  if (refusal !== null) throw new Error(refusal);
  const normalised: K1HeldCoin = {
    colour: normalisedColourHex(coin.colour)!,
    nonce: normalisedColourHex(coin.nonce)!,
    value: coin.value,
    mtIndex: coin.mtIndex,
  };
  const state = loadK1CoinStore(target);
  const coins = emptyMap<StoredK1Coin>();
  Object.assign(coins, state.coins);
  coins[normalised.colour] = rowFromCoin(normalised);
  saveK1CoinStore(target, { encSecretKeyHex: state.encSecretKeyHex, coins });
}

/** Forgets the coin held in a colour. Silent when there was none. */
export function dropK1Coin(account: K1Account, colour: string): void {
  const target = requireAccount(account);
  const wanted = normalisedColourHex(colour);
  if (wanted === null) throw new Error(`Not a colour: ${JSON.stringify(colour)}.`);
  const state = loadK1CoinStore(target);
  if (!Object.hasOwn(state.coins, wanted)) return;
  const coins = emptyMap<StoredK1Coin>();
  Object.assign(coins, state.coins);
  delete coins[wanted];
  saveK1CoinStore(target, { encSecretKeyHex: state.encSecretKeyHex, coins });
}

/**
 * The move a spend makes: the coin that was consumed goes, and the change coin
 * the contract handed back takes its place.
 *
 * ONE write, and that is the point. `withdraw_shielded_with_k256` consumes the
 * whole held coin and returns the surviving change on the transaction's
 * communication commitment (MIP-0012 §6.3, R4); between dropping the spent coin
 * and putting the change there is a moment where this account appears to hold
 * nothing in that colour, and a reload landing in it would leave the change
 * description nowhere at all — unrecoverable, because the chain does not carry
 * it. A drop and a put are two writes; this is one.
 *
 * `change` of `null` is the spend that consumed the coin exactly, with nothing
 * left over. It is a real outcome and not an error.
 */
export function replaceK1Coin(
  account: K1Account,
  spentColour: string,
  change: K1HeldCoin | null,
): void {
  const target = requireAccount(account);
  const spent = normalisedColourHex(spentColour);
  if (spent === null) throw new Error(`Not a colour: ${JSON.stringify(spentColour)}.`);
  if (change !== null) {
    const refusal = refuseK1Coin(change);
    if (refusal !== null) throw new Error(refusal);
  }
  const state = loadK1CoinStore(target);
  const coins = emptyMap<StoredK1Coin>();
  Object.assign(coins, state.coins);
  delete coins[spent];
  if (change !== null) {
    const normalised: K1HeldCoin = {
      colour: normalisedColourHex(change.colour)!,
      nonce: normalisedColourHex(change.nonce)!,
      value: change.value,
      mtIndex: change.mtIndex,
    };
    coins[normalised.colour] = rowFromCoin(normalised);
  }
  saveK1CoinStore(target, { encSecretKeyHex: state.encSecretKeyHex, coins });
}

/**
 * Remembers the account's X25519 viewing secret alongside its coins.
 *
 * Nothing in this PR reads it back except the private-state provider, which
 * serves it because the witness shape carries it. `null` clears it.
 */
export function rememberK1EncSecretKey(account: K1Account, encSecretKeyHex: string | null): void {
  const target = requireAccount(account);
  const state = loadK1CoinStore(target);
  const coins = emptyMap<StoredK1Coin>();
  Object.assign(coins, state.coins);
  saveK1CoinStore(target, { encSecretKeyHex, coins });
}

/** Forgets everything this account holds. Used by a reset, never by a spend. */
export function forgetK1Account(account: K1Account): void {
  const target = requireAccount(account);
  const accounts = readAll();
  const key = k1AccountKey(target);
  if (!Object.hasOwn(accounts, key)) return;
  delete accounts[key];
  writeAll(accounts);
}

/* -------------------------------------------------------------------------- */
/* Learning mt_index from the chain                                           */
/* -------------------------------------------------------------------------- */

/**
 * The Zswap commitment-tree window a transaction's outputs occupy, as the
 * indexer reports it — `startIndex` inclusive, `endIndex` exclusive.
 *
 * This is the ONLY thing the chain tells a client about a held coin's position,
 * and the reference says so in as many words (`contract/src/wallet/capture.ts`,
 * MIP-0012 §6.5): for a transaction carrying exactly one shielded output the
 * coin's `mt_index` IS `startIndex`.
 */
export interface K1CommitmentWindow {
  readonly startIndex: number;
  readonly endIndex: number;
}

/**
 * Whatever asks the indexer where a transaction's outputs landed. Injected
 * rather than imported so this module stays pure — see the module header.
 *
 * `null` means the question could not be answered: a lagging indexer, a
 * timeout, a dropped socket. It never means "that transaction has no outputs".
 */
export type K1CommitmentWindowReader = (txId: string) => Promise<K1CommitmentWindow | null>;

/** The coin a reconciliation is trying to complete — everything but its position. */
export interface K1PendingCoin {
  readonly colour: string;
  readonly nonce: string;
  /**
   * The coin's whole value, or absent to keep the value already stored for this
   * colour.
   *
   * Absent is the CHANGE case: a spend's surviving coin arrives on the private
   * channel with its description already known to the caller, and a client that
   * is only re-learning a position after a reorg or a resume has the value in
   * the store and nothing new to say about it. It is refused when the store has
   * nothing either, because inventing one is how an unspendable row gets
   * written.
   */
  readonly value?: bigint;
  /** The transaction that produced the coin, as submitted. */
  readonly txId: string;
}

/**
 * What a reconciliation learned.
 *
 * `'ambiguous'` stores NOTHING, deliberately. A multi-output transaction gives
 * every candidate position and no way to tell them apart from here; the
 * reference resolves it by retrying the spend across candidates, which is safe
 * because an incorrect qualified description is an unsatisfiable witness at
 * proving time and no transaction is submitted (MIP-0012 INV-5). Writing the
 * first candidate and calling it the coin would replace that safe retry with a
 * store that confidently holds the wrong answer.
 */
export type K1Reconciliation =
  | { readonly outcome: 'learned'; readonly coin: K1HeldCoin }
  | { readonly outcome: 'ambiguous'; readonly candidates: readonly bigint[] }
  | { readonly outcome: 'unavailable'; readonly reason: string }
  | { readonly outcome: 'refused'; readonly reason: string };

function wholeIndex(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

/**
 * Learns a deposited or change coin's `mt_index` from the transaction that
 * produced it, and stores the completed coin.
 *
 * `'unavailable'` and `'refused'` are two different things and the caller does
 * two different things with them. `'unavailable'` is the chain not having
 * answered yet — the indexer lags, and asking again in a moment is the whole
 * remedy. `'refused'` is a coin this store will not hold, which is a bug in
 * whatever built it and will not improve by being retried.
 */
export async function reconcileK1CoinFromChain(
  account: K1Account,
  pending: K1PendingCoin,
  reader: K1CommitmentWindowReader,
): Promise<K1Reconciliation> {
  const refusal = refuseK1Account(account);
  if (refusal !== null) return { outcome: 'refused', reason: refusal };
  const target = requireAccount(account);
  const colour = normalisedColourHex(pending.colour);
  if (colour === null) {
    return { outcome: 'refused', reason: `Not a colour: ${JSON.stringify(pending.colour)}.` };
  }
  const nonce = normalisedColourHex(pending.nonce);
  if (nonce === null) {
    return { outcome: 'refused', reason: `Not a nonce: ${JSON.stringify(pending.nonce)}.` };
  }
  const held = heldK1Coin(target, colour);
  const value = pending.value ?? held?.value;
  if (value === undefined) {
    return {
      outcome: 'refused',
      reason: `Nothing says what this coin is worth: no value was given and none is stored for colour ${colour}.`,
    };
  }
  if (typeof pending.txId !== 'string' || pending.txId.trim() === '') {
    return { outcome: 'refused', reason: 'A reconciliation needs the transaction that produced the coin.' };
  }

  let window: K1CommitmentWindow | null;
  try {
    window = await reader(pending.txId);
  } catch (error) {
    /* A reader that threw is a reader that could not ask, exactly as one that
       answered null is — `resolveTxCommitmentWindowOnce` swallows its own
       failures, but a caller may hand in something that does not. */
    return { outcome: 'unavailable', reason: `The chain could not be asked: ${String(error)}` };
  }
  if (window === null) {
    return { outcome: 'unavailable', reason: `The indexer has no position yet for ${pending.txId}.` };
  }
  const start = wholeIndex(window.startIndex);
  const end = wholeIndex(window.endIndex);
  if (start === null || end === null || end <= start) {
    return {
      outcome: 'unavailable',
      reason: `The indexer reported no usable commitment window for ${pending.txId}.`,
    };
  }
  if (end - start > 1) {
    const candidates: bigint[] = [];
    for (let index = start; index < end; index += 1) candidates.push(BigInt(index));
    return { outcome: 'ambiguous', candidates };
  }
  const coin: K1HeldCoin = { colour, nonce, value, mtIndex: BigInt(start) };
  putK1Coin(target, coin);
  return { outcome: 'learned', coin };
}

/* -------------------------------------------------------------------------- */
/* The private-state provider                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The private-state id for a k1 account — STABLE, and that is the whole point.
 *
 * `./accountCustody.ts` makes a fresh id per connection and is right to: the
 * secrets a connection was handed must win over anything a previous connection
 * left behind. A coin has the opposite requirement. It is learned once, from a
 * transaction that will never be asked about again, and if the next connection
 * looks under a new id it finds an empty store and the account cannot spend
 * what it demonstrably holds. Design §3 names this as one of the three things
 * standing between the demo and a k1 spend.
 *
 * Network and address both, for the reason {@link K1Account} gives.
 */
export function k1PrivateStateId(account: K1Account): string {
  const target = requireAccount(account);
  return `passport-account-custody-${target.network}-${target.address}`;
}

/**
 * The midnight-js `PrivateStateProvider` surface, as much of it as this app
 * uses. Structural on purpose: importing the SDK's type would pull the SDK into
 * a module the tests load directly.
 */
export interface K1PrivateStateProvider {
  /** The stable id this provider persists under. */
  readonly privateStateId: string;
  setContractAddress(): void;
  set(id: string, state: unknown): Promise<void>;
  get(id: string): Promise<unknown>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  setSigningKey(address: string, key: unknown): Promise<void>;
  getSigningKey(address: string): Promise<unknown>;
  removeSigningKey(address: string): Promise<void>;
  clearSigningKeys(): Promise<void>;
  exportPrivateStates(): Promise<never>;
}

function isCoinStoreState(state: unknown): state is K1CoinStoreState {
  return (
    !!state &&
    typeof state === 'object' &&
    typeof (state as { coins?: unknown }).coins === 'object' &&
    (state as { coins?: unknown }).coins !== null
  );
}

/**
 * A private-state provider for one k1 account, backed by this store instead of
 * by fresh memory.
 *
 * Only {@link k1PrivateStateId}'s own id is persisted. midnight-js may ask for
 * others — another contract in the same providers object — and those are held
 * for the session exactly as `inMemoryPrivateStateProvider` holds everything,
 * because this store has an opinion about qualified coins and none about
 * anything else.
 *
 * SIGNING KEYS ARE NOT PERSISTED, and that is not an oversight. A signing key
 * is an opaque SDK value with no serialisation this module can promise, and the
 * provider it replaces does not outlive the session either — so nothing
 * regresses, and inventing a format for a value we cannot validate would be a
 * worse answer than the honest one. A maintenance update after a reload
 * re-supplies it, as it must today.
 */
export function k1PrivateStateProvider(account: K1Account): K1PrivateStateProvider {
  const target = requireAccount(account);
  const privateStateId = k1PrivateStateId(target);
  const session = new Map<string, unknown>();
  const signingKeys = new Map<string, unknown>();
  /* `Promise.resolve(…)` rather than `async`, on every one of these. The
     surface midnight-js asks for is promise-returning and none of the work
     behind it is: a store read is synchronous, and an `async` method with no
     `await` in it is the shape `@typescript-eslint/require-await` exists to
     catch, because everywhere else in this app it means a forgotten `await`. */
  return {
    privateStateId,
    setContractAddress() {},
    set(id: string, state: unknown): Promise<void> {
      if (id !== privateStateId) {
        session.set(id, state);
        return Promise.resolve();
      }
      /* Written through the store's own validation rather than stringified as
         handed over: a witness may return a private state with a coin in it,
         and a coin that fails the check here is one that would be read back
         unspendable. */
      if (!isCoinStoreState(state)) return Promise.resolve();
      const coins = emptyMap<StoredK1Coin>();
      for (const [colourKey, row] of Object.entries(state.coins)) {
        const coin = coinFromRow(row);
        if (coin === null || coin.colour !== normalisedColourHex(colourKey)) continue;
        coins[coin.colour] = rowFromCoin(coin);
      }
      const encSecretKeyHex =
        typeof state.encSecretKeyHex === 'string' ? state.encSecretKeyHex : null;
      saveK1CoinStore(target, { encSecretKeyHex, coins });
      return Promise.resolve();
    },
    get(id: string): Promise<unknown> {
      if (id !== privateStateId) {
        return Promise.resolve(session.has(id) ? session.get(id) : null);
      }
      return Promise.resolve(loadK1CoinStore(target));
    },
    remove(id: string): Promise<void> {
      if (id !== privateStateId) {
        session.delete(id);
        return Promise.resolve();
      }
      forgetK1Account(target);
      return Promise.resolve();
    },
    clear(): Promise<void> {
      session.clear();
      forgetK1Account(target);
      return Promise.resolve();
    },
    setSigningKey(address: string, key: unknown): Promise<void> {
      signingKeys.set(address, key);
      return Promise.resolve();
    },
    getSigningKey(address: string): Promise<unknown> {
      return Promise.resolve(signingKeys.has(address) ? signingKeys.get(address) : null);
    },
    removeSigningKey(address: string): Promise<void> {
      signingKeys.delete(address);
      return Promise.resolve();
    },
    clearSigningKeys(): Promise<void> {
      signingKeys.clear();
      return Promise.resolve();
    },
    exportPrivateStates(): Promise<never> {
      return Promise.reject(
        new Error('Private-state export is not supported by the Passport demo.'),
      );
    },
  };
}
