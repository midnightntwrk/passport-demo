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
 * It holds no DOM, no React, no wallet SDK, and no network:
 * {@link reconcileK1CoinFromChain} is handed a reader rather than making a
 * query, so the whole of this file is drilled directly in
 * `./k1CoinStore.test.ts` and sits in the coverage denominator at 100%. The
 * reader it is handed on a real connection is
 * `./contractRuntime.ts`'s `resolveTxCommitmentWindowOnce`, which is where the
 * indexer and its ten-second ceiling live.
 *
 * WHAT THE SPEND ADDED (2026/09/17)
 * ---------------------------------
 * The store is now WIRED IN: `./custodyContractClient.ts` serves it to
 * midnight-js as the custody connection's private-state provider, so
 * `held_coin` reads `context.privateState.coins[colourHex]` and a shielded
 * spend is a read of this file. Four things follow, and all four are here
 * rather than in the flow that needed them, because they are facts about what
 * an account holds and not steps in a send.
 *
 *   1. SPENT NONCES. A withdrawal consumes the whole held coin. The nonce it
 *      consumed is recorded ({@link replaceK1Coin}, {@link dropK1Coin}) and
 *      never accepted back — not by an inbox walk that re-reads the entry that
 *      first described it, and not by midnight-js writing the private state it
 *      read BEFORE the call back over the top of the change afterwards. See
 *      {@link k1PrivateStateProvider} for that second one, which is the
 *      dangerous one: it is a write this module does not make and cannot see
 *      coming.
 *   2. A QUEUE. The contract holds any number of coins per colour and
 *      `held_coin(color)` can name exactly one, so the second and later coins
 *      of a colour are {@link enqueueK1Coin}d instead of overwriting the first.
 *      What an account HOLDS of a colour is therefore held + queued
 *      ({@link k1ColourBalance}); what it can send in one payment is the held
 *      coin alone, which is a real limit and is said in a sentence rather than
 *      hidden (`./custodyContractSend.ts`).
 *   3. AWAITING POSITIONS. Between a spend returning its change coin and the
 *      indexer saying where that coin landed there is a state with no name in
 *      the reference: described, held, unspendable. {@link rememberK1ChangeCoin}
 *      writes it in the same write that records the spend, and
 *      {@link settleK1AwaitingCoin} files it when the chain answers — which
 *      may be after a reload, and is still not too late. A colour holds a
 *      LIST of these, not one: spend, be paid, spend again is an ordinary
 *      sequence, and one slot per colour meant the second spend wrote over the
 *      first change coin's description (2026/09/17).
 *   4. CANDIDATE POSITIONS. A withdrawal's transaction carries TWO shielded
 *      outputs — the recipient's note and the contract's change — so the
 *      commitment window it lands in gives two positions and no way to tell
 *      them apart from here. {@link putK1CoinCandidates} keeps both, in order,
 *      with the first as the current guess; a spend that fails to prove
 *      against it moves to the next ({@link advanceK1CoinCandidate}) and a
 *      spend that proves settles it ({@link settleK1Coin}). A guess is never
 *      written as a fact: a coin with candidates outstanding says so, in the
 *      store, until the chain has been asked the only question that decides it
 *      — can this position be proved.
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
  /**
   * Colour → the account's FURTHER coins of that colour, oldest first.
   *
   * Not part of the reference's shape, and it cannot be: the witness takes a
   * colour and returns a coin, so a second coin of a colour has nowhere to go
   * in `coins` and would otherwise be dropped by the write that stored the
   * first. A dropped description is an unspendable balance for ever, so they
   * are kept here and promoted into `coins` one at a time as spends empty it.
   *
   * The witness never reads this. A private state carrying a field the
   * contract's witness does not name costs nothing — the witness reads
   * `coins` — and losing the coins would cost everything.
   */
  readonly queued: Record<string, readonly StoredK1Coin[]>;
  /**
   * Every coin nonce a withdrawal has consumed, newest last.
   *
   * The store's memory of what is GONE, which is as load-bearing as its memory
   * of what is held: a consumed coin is still described by the inbox entry
   * that announced it and by the private state midnight-js read before the
   * spend, and both of those are re-read afterwards. Without this list either
   * of them puts the spent coin back and the account spends a coin that no
   * longer exists — a proof that fails, every time, naming nothing a reader
   * could act on.
   */
  readonly spentNonces: readonly string[];
  /**
   * Colour → the commitment-tree positions a held coin might occupy, in the
   * order they are to be tried, when the chain gave more than one.
   *
   * The head is always the position in `coins[colour].mtIndex`, so a reader
   * that knows nothing about candidates still reads a complete coin. An empty
   * or absent list means the position is SETTLED — either the transaction had
   * one output, or a spend proved against it.
   */
  readonly mtIndexCandidates: Record<string, readonly string[]>;
  /**
   * Colour → EVERY coin this account demonstrably holds and has no position
   * for yet, oldest first, each with the transaction that produced it.
   *
   * THE GAP BETWEEN A SPEND AND THE CHAIN ANSWERING, and the only place in
   * this store where a coin sits that the witness cannot use. A withdrawal
   * returns its change coin as the circuit's value — nonce, colour, and value,
   * and no `mt_index`, because the position is allocated by the transaction
   * that is at that moment still being submitted. That description exists
   * nowhere else: not on the chain, not in an inbox entry, nowhere. So it is
   * written down in the SAME write that records the spend, before anything is
   * asked of the indexer, and the position is filled in afterwards by
   * {@link settleK1AwaitingCoin} — which may take a second, or a reload, or a
   * day of the indexer being unreachable, and none of those lose the coin.
   *
   * It is NOT in `coins`, deliberately. A coin in `coins` is one the witness
   * will hand to a proof, and a position of "we have not asked yet" written as
   * a number is exactly the confident wrong answer this module refuses to
   * hold. A holder sees it as arriving rather than as balance.
   *
   * A LIST PER COLOUR, AND IT HAD TO BECOME ONE (2026/09/17). This was one row
   * per colour, and one row per colour loses money in a sequence nothing
   * unusual produces: a spend files its change here, an inbox delivery of the
   * same colour takes the held slot the spend emptied, and a second spend of
   * that colour files ITS change — over the first row, whose description
   * exists nowhere else in the world. The account is then holding a coin
   * nobody can ever describe again, and nothing on any screen says so. So a
   * colour holds as many awaiting rows as it has coins in flight, and
   * {@link settleK1AwaitingCoin} and {@link renameK1AwaitingTx} address ONE of
   * them by the transaction that produced it rather than the colour they are
   * filed under. Within a colour the nonce is the identity: the same coin is
   * never held twice, however many times it is offered.
   */
  readonly awaiting: Record<string, readonly AwaitingK1CoinRow[]>;
  /**
   * Colours whose last spend returned change this build could not READ.
   *
   * The value moved and its description — the circuit's own return value —
   * exists nowhere else, so nothing can say what is left. Dropping the colour
   * would make a Passport quietly stop showing a token it had been paid;
   * keeping a row with the transaction that spent it says what happened and
   * leaves somebody a hash to go and look with. Colour → transaction.
   */
  readonly unreadChange: Record<string, string>;
}

/** An awaiting coin as it is STORED. Strings, for the module header's reason. */
export interface AwaitingK1CoinRow {
  readonly nonceHex: string;
  readonly colorHex: string;
  readonly value: string;
  /** The transaction that produced it — what a later position lookup asks about. */
  readonly txId: string;
}

/** A coin whose description is known and whose position is not, in app terms. */
export interface K1AwaitingCoin {
  readonly colour: string;
  readonly nonce: string;
  readonly value: bigint;
  readonly txId: string;
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

/**
 * The queued rows of one colour, filtered the way {@link readAll} filters the
 * held ones — the key has to agree with the row, and a row that is not a coin
 * is dropped rather than repaired.
 */
function queuedRowsFrom(colourKey: string, rows: unknown): StoredK1Coin[] {
  if (!Array.isArray(rows)) return [];
  const wanted = normalisedColourHex(colourKey);
  const kept: StoredK1Coin[] = [];
  for (const row of rows as unknown[]) {
    const coin = coinFromRow(row);
    if (coin === null || coin.colour !== wanted) continue;
    kept.push(rowFromCoin(coin));
  }
  return kept;
}

/** A stored list of 64-hex nonces, deduplicated, oldest first. */
function nonceListFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const kept: string[] = [];
  for (const entry of value as unknown[]) {
    /* `typeof` first, because the normaliser takes a string and a stored list
       is whatever JSON somebody else's build left behind. */
    const nonce = typeof entry === 'string' ? normalisedColourHex(entry) : null;
    if (nonce === null || kept.includes(nonce)) continue;
    kept.push(nonce);
  }
  return kept;
}

/**
 * A stored awaiting row, or null when it is not one.
 *
 * The transaction id is checked as well as the coin, because a row without one
 * is a coin whose position can never be looked up — which is the same as a row
 * that cannot be read, and is dropped the same way.
 */
function awaitingRowFrom(row: unknown): AwaitingK1CoinRow | null {
  if (!row || typeof row !== 'object') return null;
  const candidate = row as Partial<AwaitingK1CoinRow>;
  const colour = normalisedColourHex(candidate.colorHex);
  const nonce = normalisedColourHex(candidate.nonceHex);
  const value = normalisedDecimal(candidate.value);
  const txId = typeof candidate.txId === 'string' ? candidate.txId.trim() : '';
  if (colour === null || nonce === null || value === null || txId === '') return null;
  return { nonceHex: nonce, colorHex: colour, value, txId };
}

/**
 * The awaiting rows of ONE colour, from either shape a store may hold them in.
 *
 * THE MIGRATION LIVES HERE, in the read, and it is lossless. Until 2026/09/17
 * a colour held a single awaiting row and stored it as a bare object; it now
 * holds a list, for the reason {@link K1CoinStoreState.awaiting} gives. A
 * store written by the older build is therefore read as a one-element list —
 * the coin keeps its nonce, its value, and the transaction to look it up by,
 * which is everything there is to keep, and the next spend of that colour
 * appends beside it rather than over it. Nothing is rewritten on read: the new
 * shape is written by the next write to the account, and a build that is
 * downgraded reads the first row of the list, which is the oldest coin.
 *
 * A row filed under the wrong colour, or a second row with a nonce the list
 * already holds, is dropped for the reasons {@link coinFromRow} gives: the
 * store's answers go into proofs, and one coin counted twice is a balance that
 * cannot be spent down.
 */
function awaitingRowsFrom(colour: string, value: unknown): AwaitingK1CoinRow[] {
  const rows: unknown[] = Array.isArray(value) ? (value as unknown[]) : [value];
  const kept: AwaitingK1CoinRow[] = [];
  for (const entry of rows) {
    const row = awaitingRowFrom(entry);
    if (row === null || row.colorHex !== colour) continue;
    if (kept.some((held) => held.nonceHex === row.nonceHex)) continue;
    kept.push(row);
  }
  return kept;
}

/** A stored candidate list: decimal positions, in the order they are tried. */
function candidateListFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const kept: string[] = [];
  for (const entry of value as unknown[]) {
    const index = normalisedDecimal(entry);
    if (index === null || kept.includes(index)) continue;
    kept.push(index);
  }
  return kept;
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
      const queued = emptyMap<readonly StoredK1Coin[]>();
      if (entry.queued && typeof entry.queued === 'object') {
        for (const [colourKey, rows] of Object.entries(entry.queued as Record<string, unknown>)) {
          const colour = normalisedColourHex(colourKey);
          const kept = colour === null ? [] : queuedRowsFrom(colourKey, rows);
          /* An empty list is not written back. A colour whose every queued row
             was unreadable is a colour with nothing queued, and a key mapping
             to `[]` would be a row this store hands out for ever. */
          if (colour !== null && kept.length > 0) queued[colour] = kept;
        }
      }
      const mtIndexCandidates = emptyMap<readonly string[]>();
      if (entry.mtIndexCandidates && typeof entry.mtIndexCandidates === 'object') {
        for (const [colourKey, list] of Object.entries(
          entry.mtIndexCandidates as Record<string, unknown>,
        )) {
          const colour = normalisedColourHex(colourKey);
          const kept = candidateListFrom(list);
          if (colour !== null && kept.length > 0) mtIndexCandidates[colour] = kept;
        }
      }
      const awaiting = emptyMap<readonly AwaitingK1CoinRow[]>();
      if (entry.awaiting && typeof entry.awaiting === 'object') {
        for (const [colourKey, rows] of Object.entries(
          entry.awaiting as Record<string, unknown>,
        )) {
          const colour = normalisedColourHex(colourKey);
          if (colour === null) continue;
          const kept = awaitingRowsFrom(colour, rows);
          /* An empty list is not written back, for the reason the queue's is
             not: a key mapping to `[]` is a row this store hands out for ever
             and a colour that reads as having something arriving when it has
             nothing. */
          if (kept.length > 0) awaiting[colour] = kept;
        }
      }
      const unreadChange = emptyMap<string>();
      if (entry.unreadChange && typeof entry.unreadChange === 'object') {
        for (const [colourKey, txId] of Object.entries(
          entry.unreadChange as Record<string, unknown>,
        )) {
          const colour = normalisedColourHex(colourKey);
          if (colour !== null && typeof txId === 'string' && txId.trim().length > 0) {
            unreadChange[colour] = txId;
          }
        }
      }
      accounts[key] = {
        encSecretKeyHex: typeof entry.encSecretKeyHex === 'string' ? entry.encSecretKeyHex : null,
        coins,
        queued,
        spentNonces: nonceListFrom(entry.spentNonces),
        mtIndexCandidates,
        awaiting,
        unreadChange,
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

/**
 * A fresh empty state — what an account that holds nothing serves to a witness.
 *
 * A FUNCTION, not a shared constant, because the maps in it are mutable
 * objects: one shared instance handed to two accounts is one account's coin
 * appearing in the other's store the moment anything wrote to it in place.
 *
 * Exported because a connection made before the account has an address has no
 * store to read and still has to open with a state of the right SHAPE — a
 * private state missing a field the witness reads fails at proving time rather
 * than here (`./custodyContractClient.ts`).
 */
export function emptyK1CoinStoreState(): K1CoinStoreState {
  return {
    encSecretKeyHex: null,
    coins: emptyMap(),
    queued: emptyMap(),
    spentNonces: [],
    mtIndexCandidates: emptyMap(),
    awaiting: emptyMap(),
    unreadChange: emptyMap(),
  };
}

/**
 * The whole private state of one account — what {@link k1PrivateStateProvider}
 * serves to midnight-js, and what a `held_coin` witness reads.
 */
export function loadK1CoinStore(account: K1Account): K1CoinStoreState {
  const normalised = normalisedAccount(account);
  if (normalised === null) return emptyK1CoinStoreState();
  const accounts = readAll();
  const key = k1AccountKey(normalised);
  return Object.hasOwn(accounts, key) ? accounts[key] : emptyK1CoinStoreState();
}

function saveK1CoinStore(account: K1Account, state: K1CoinStoreState): void {
  const accounts = readAll();
  accounts[k1AccountKey(account)] = state;
  writeAll(accounts);
}

/**
 * The state of one account, in a shape a writer can edit, and the save that
 * puts it back.
 *
 * Every writer below goes through this rather than assembling a whole state
 * itself: five fields assembled by hand in seven places is six places for a
 * field to be quietly dropped, and a dropped `spentNonces` is a spent coin
 * that comes back.
 */
interface K1StoreDraft {
  encSecretKeyHex: string | null;
  coins: Record<string, StoredK1Coin>;
  queued: Record<string, StoredK1Coin[]>;
  spentNonces: string[];
  mtIndexCandidates: Record<string, string[]>;
  awaiting: Record<string, AwaitingK1CoinRow[]>;
  unreadChange: Record<string, string>;
}

function draftOf(state: K1CoinStoreState): K1StoreDraft {
  const coins = emptyMap<StoredK1Coin>();
  Object.assign(coins, state.coins);
  const queued = emptyMap<StoredK1Coin[]>();
  for (const [colour, rows] of Object.entries(state.queued)) queued[colour] = [...rows];
  const mtIndexCandidates = emptyMap<string[]>();
  for (const [colour, list] of Object.entries(state.mtIndexCandidates)) {
    mtIndexCandidates[colour] = [...list];
  }
  const awaiting = emptyMap<AwaitingK1CoinRow[]>();
  /* Copied row by row rather than assigned. The lists are what a writer edits
     in place, and a shared list is one colour's edit landing in the state a
     caller is still reading. */
  for (const [colour, rows] of Object.entries(state.awaiting)) awaiting[colour] = [...rows];
  const unreadChange = emptyMap<string>();
  Object.assign(unreadChange, state.unreadChange);
  return {
    encSecretKeyHex: state.encSecretKeyHex,
    coins,
    queued,
    spentNonces: [...state.spentNonces],
    mtIndexCandidates,
    awaiting,
    unreadChange,
  };
}

/**
 * How many spent nonces are remembered.
 *
 * Bounded because this list only ever grows and lives in storage somebody
 * else's data shares, and unbounded growth in `localStorage` is how a write
 * starts failing for reasons no screen can explain. The oldest are dropped
 * first: a nonce spent a thousand coins ago cannot be offered back by an inbox
 * walk that has long since passed it, and the write that would resurrect it —
 * midnight-js handing back the private state it read before the last call — is
 * about a coin spent moments ago, not months.
 */
const SPENT_NONCE_MEMORY = 256;

function rememberSpentNonce(draft: K1StoreDraft, nonce: string): void {
  if (draft.spentNonces.includes(nonce)) return;
  draft.spentNonces.push(nonce);
  if (draft.spentNonces.length > SPENT_NONCE_MEMORY) {
    draft.spentNonces = draft.spentNonces.slice(-SPENT_NONCE_MEMORY);
  }
}

/**
 * Moves the next queued coin of a colour into the held slot, when the slot is
 * empty and the queue is not.
 *
 * A colour with a queue and no held coin is a balance nobody can spend: the
 * witness reads `coins[colour]` and finds nothing while the store plainly
 * holds something. Every write that can empty the slot ends here.
 */
function promoteQueued(draft: K1StoreDraft, colour: string): void {
  if (Object.hasOwn(draft.coins, colour)) return;
  const queue = Object.hasOwn(draft.queued, colour) ? draft.queued[colour] : [];
  const next = queue.shift();
  if (next === undefined) return;
  draft.coins[colour] = next;
  if (queue.length === 0) delete draft.queued[colour];
}

function saveDraft(account: K1Account, draft: K1StoreDraft): void {
  saveK1CoinStore(account, {
    encSecretKeyHex: draft.encSecretKeyHex,
    coins: draft.coins,
    queued: draft.queued,
    unreadChange: draft.unreadChange,
    spentNonces: draft.spentNonces,
    mtIndexCandidates: draft.mtIndexCandidates,
    awaiting: draft.awaiting,
  });
}

/** Load, edit, save — the shape every writer below has. */
function editStore(account: K1Account, edit: (draft: K1StoreDraft) => void): void {
  const draft = draftOf(loadK1CoinStore(account));
  edit(draft);
  saveDraft(account, draft);
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
  const normalised = requireCoin(coin);
  editStore(target, (draft) => {
    draft.coins[normalised.colour] = rowFromCoin(normalised);
    /* A coin put here is a coin somebody KNOWS the position of — a
       single-output transaction, or the winner of a candidate run. Any
       outstanding guesses about that colour are about the coin that has just
       been replaced, so they go with it. */
    delete draft.mtIndexCandidates[normalised.colour];
  });
}

/** The coin, normalised, or a throw carrying the refusal. */
function requireCoin(coin: K1HeldCoin): K1HeldCoin {
  const refusal = refuseK1Coin(coin);
  if (refusal !== null) throw new Error(refusal);
  return {
    colour: normalisedColourHex(coin.colour)!,
    nonce: normalisedColourHex(coin.nonce)!,
    value: coin.value,
    mtIndex: coin.mtIndex,
  };
}

/**
 * Forgets the coin held in a colour, remembering that its nonce is gone.
 *
 * Used where a coin has LEFT the account by a route that returns no change —
 * and the nonce is recorded for the same reason {@link replaceK1Coin} records
 * it: the description survives in an inbox entry and in whatever private state
 * midnight-js last read, and both are re-read. Silent when there was none.
 */
export function dropK1Coin(account: K1Account, colour: string): void {
  const target = requireAccount(account);
  const wanted = requireColour(colour);
  editStore(target, (draft) => {
    if (!Object.hasOwn(draft.coins, wanted)) return;
    rememberSpentNonce(draft, draft.coins[wanted].nonceHex);
    delete draft.coins[wanted];
    delete draft.mtIndexCandidates[wanted];
    promoteQueued(draft, wanted);
  });
}

function requireColour(colour: string): string {
  const wanted = normalisedColourHex(colour);
  if (wanted === null) throw new Error(`Not a colour: ${JSON.stringify(colour)}.`);
  return wanted;
}

/* -------------------------------------------------------------------------- */
/* More than one coin of a colour                                             */
/* -------------------------------------------------------------------------- */

/** The further coins this account holds of a colour, oldest first. */
export function queuedK1Coins(account: K1Account, colour: string): K1HeldCoin[] {
  const wanted = normalisedColourHex(colour);
  if (wanted === null) return [];
  const state = loadK1CoinStore(account);
  const queue = Object.hasOwn(state.queued, wanted) ? state.queued[wanted] : [];
  return queue.map(coinFromStoredRow);
}

/**
 * Every colour this account holds anything of, with what it holds of each.
 *
 * HELD UNION QUEUED, and the union is the point (review, 2026/09/18).
 * {@link listK1Coins} lists the HELD slots alone, and a colour can perfectly
 * well have an empty held slot and a queue behind it: a spend takes the held
 * coin and files its change as awaiting, leaving a coin that arrived earlier
 * sitting in the queue. A screen drawing its rows from the held slots showed no
 * row at all for that colour — money the holder could neither see nor, since
 * nothing offered it, promote and spend. A row is what says it is here.
 *
 * Colour order, so two reads agree, and a colour whose whole holding is zero is
 * still a colour this account has coins of.
 */
export function k1ColourHoldings(account: K1Account): { colour: string; value: bigint }[] {
  const state = loadK1CoinStore(account);
  const colours = new Set([...Object.keys(state.coins), ...Object.keys(state.queued)]);
  return [...colours].sort().map((colour) => ({
    colour,
    value: k1ColourBalance(account, colour),
  }));
}

/**
 * What this account holds of a colour: the held coin plus everything queued
 * behind it.
 *
 * The figure a holder is shown. It is deliberately NOT the figure a single
 * payment can draw on — that is the held coin alone, because the witness can
 * name one coin — and the two are allowed to differ on screen only because the
 * refusal that meets the difference says so in a sentence.
 */
export function k1ColourBalance(account: K1Account, colour: string): bigint {
  const held = heldK1Coin(account, colour);
  let total = held === null ? 0n : held.value;
  for (const coin of queuedK1Coins(account, colour)) total += coin.value;
  return total;
}

/** Whether a nonce belongs to a coin this account has already spent. */
export function isK1NonceSpent(account: K1Account, nonce: string): boolean {
  const wanted = normalisedColourHex(nonce);
  if (wanted === null) return false;
  return loadK1CoinStore(account).spentNonces.includes(wanted);
}

/**
 * Remembers a coin WITHOUT displacing the one already held in its colour.
 *
 * The rule an inbox walk and a deposit both want: the first coin of a colour
 * becomes the held one, and every later coin joins the queue behind it. A coin
 * already known — same nonce, held or queued — is not stored twice, and a coin
 * whose nonce has been spent is refused outright, which is what makes a second
 * walk of the same inbox harmless.
 *
 * Returns where the coin went, because the caller's next sentence depends on
 * it: `'held'` is spendable now, `'queued'` is arriving behind something, and
 * `'spent'` or `'known'` are nothing happening at all.
 */
export function enqueueK1Coin(
  account: K1Account,
  coin: K1HeldCoin,
): 'held' | 'queued' | 'known' | 'spent' {
  const target = requireAccount(account);
  const normalised = requireCoin(coin);
  const state = loadK1CoinStore(target);
  if (state.spentNonces.includes(normalised.nonce)) return 'spent';
  const held = Object.hasOwn(state.coins, normalised.colour)
    ? state.coins[normalised.colour]
    : null;
  if (held !== null && held.nonceHex === normalised.nonce) return 'known';
  const queue = Object.hasOwn(state.queued, normalised.colour)
    ? state.queued[normalised.colour]
    : [];
  if (queue.some((row) => row.nonceHex === normalised.nonce)) return 'known';
  editStore(target, (draft) => {
    if (held === null) {
      draft.coins[normalised.colour] = rowFromCoin(normalised);
      return;
    }
    const existing = Object.hasOwn(draft.queued, normalised.colour)
      ? draft.queued[normalised.colour]
      : [];
    existing.push(rowFromCoin(normalised));
    draft.queued[normalised.colour] = existing;
  });
  return held === null ? 'held' : 'queued';
}

/* -------------------------------------------------------------------------- */
/* The change a spend left, before the chain has said where it is             */
/* -------------------------------------------------------------------------- */

/**
 * The whole bookkeeping of a spend, in ONE write: the coin that was consumed
 * goes, its nonce is remembered as spent, and the change coin — described but
 * not yet positioned — is put where a later lookup can find it.
 *
 * ONE WRITE, for the reason {@link replaceK1Coin} gives and more sharply. The
 * change coin's description arrives as the circuit's return value and exists
 * nowhere else in the world: not on the chain, not in an inbox entry, not in
 * the transaction. A reload between two writes here is a coin that has
 * demonstrably arrived and that nobody — not the owner, not this repository,
 * not anybody — can ever move again.
 *
 * `change` of null is the spend that consumed the coin exactly. It promotes
 * whatever was queued behind it, exactly as {@link replaceK1Coin} does.
 */
export function rememberK1ChangeCoin(
  account: K1Account,
  spentColour: string,
  change: { colour: string; nonce: string; value: bigint } | null | 'unreadable',
  txId: string,
): void {
  const target = requireAccount(account);
  const spent = requireColour(spentColour);
  /* `'unreadable'` is a spend whose change this build could not describe — see
     {@link K1CoinStoreState.unreadChange}. It behaves like no change at all
     except that the colour keeps a row naming the transaction, so nothing
     silently stops being shown. */
  const unreadable = change === 'unreadable';
  const described = unreadable ? null : change;
  const row =
    described === null
      ? null
      : awaitingRowFrom({
          nonceHex: described.nonce,
          colorHex: described.colour,
          value: described.value.toString(),
          txId,
        });
  if (described !== null && row === null) {
    throw new Error('A change coin needs a 64-hex nonce, a 64-hex colour, a value, and the transaction that produced it.');
  }
  editStore(target, (draft) => {
    if (Object.hasOwn(draft.coins, spent)) rememberSpentNonce(draft, draft.coins[spent].nonceHex);
    delete draft.coins[spent];
    delete draft.mtIndexCandidates[spent];
    /* APPENDED, NEVER OVERWRITTEN. See
       {@link K1CoinStoreState.awaiting}: a colour can have two coins in flight
       at once, and the row this write would have replaced describes a coin
       nothing else in the world describes. Same nonce twice is the same coin
       offered twice — a resumed run, a repeated call — and it is not stored
       twice. */
    if (row !== null) addAwaitingRow(draft, row);
    /* Written in the SAME write as the spend, for the reason the awaiting slot
       is: a description that exists nowhere else must not be lost between two
       writes, and the fact that there is no description is itself the thing
       worth not losing. */
    if (unreadable) draft.unreadChange[spent] = txId;
    else delete draft.unreadChange[spent];
    /* Only when there is no change. A colour whose change coin is awaiting a
       position must NOT promote a queued coin into the held slot, or the
       change would land behind it and the account would spend them out of
       order — which is legal but makes the balance jump about for no reason a
       holder could follow. */
    if (row === null) promoteQueued(draft, spent);
  });
}

/** Adds an awaiting row to its colour's list, unless the coin is already in it. */
function addAwaitingRow(draft: K1StoreDraft, row: AwaitingK1CoinRow): void {
  const rows = Object.hasOwn(draft.awaiting, row.colorHex) ? draft.awaiting[row.colorHex] : [];
  if (!rows.some((held) => held.nonceHex === row.nonceHex)) rows.push(row);
  draft.awaiting[row.colorHex] = rows;
}

/**
 * Removes one awaiting row by the coin it describes, and the colour's key with
 * it when that was the last row.
 *
 * By NONCE, not by transaction: the transaction a row is filed under is
 * renamed while the row waits ({@link renameK1AwaitingTx}), and the nonce is
 * the one thing about a coin that never changes.
 */
function dropAwaitingRow(draft: K1StoreDraft, colour: string, nonceHex: string): void {
  if (!Object.hasOwn(draft.awaiting, colour)) return;
  const rows = draft.awaiting[colour].filter((row) => row.nonceHex !== nonceHex);
  if (rows.length === 0) delete draft.awaiting[colour];
  else draft.awaiting[colour] = rows;
}

/**
 * Every coin this account holds that has no position yet — colour order, and
 * oldest first within a colour.
 *
 * All of them, which is what the count of "payments still arriving" is drawn
 * from. Two coins of one colour in flight is an ordinary state (a spend, a
 * delivery, a second spend), and a count that collapsed them would show one
 * payment arriving where two are.
 */
export function awaitingK1Coins(account: K1Account): K1AwaitingCoin[] {
  const state = loadK1CoinStore(account);
  return Object.keys(state.awaiting)
    .sort()
    .flatMap((colour) =>
      state.awaiting[colour].map((row) => ({
        colour: row.colorHex,
        nonce: row.nonceHex,
        value: BigInt(row.value),
        txId: row.txId,
      })),
    );
}

/**
 * Ask the chain where ONE awaiting coin landed, and file it once it answers.
 *
 * `txId` names which row — the transaction the row is currently filed under,
 * which is midnight-js's identifier until {@link renameK1AwaitingTx} has the
 * chain's hash. A colour can have more than one coin in flight
 * ({@link K1CoinStoreState.awaiting}), so a settle addressed at the colour
 * alone would file one coin and silently drop the others.
 *
 * `'unavailable'` LEAVES THE ROW WHERE IT IS, which is the whole reason the
 * awaiting slot exists: an indexer that has not caught up yet is a question to
 * ask again in a moment, or after a reload, or tomorrow, and none of those
 * cost the coin. So does an `'ambiguous'` the store did not take — candidates
 * go into a colour's held slot or nowhere, and a colour already holding
 * something has nowhere to put them, so the row waits for the slot rather than
 * being dropped with its description. `'learned'`, a stored `'ambiguous'`,
 * `'spent'`, and `'refused'` all remove the row: the coin is in `coins` now,
 * or it is one this store has already accounted for, or it is one this store
 * will not hold and will not start being able to.
 */
export async function settleK1AwaitingCoin(
  account: K1Account,
  colour: string,
  txId: string,
  reader: K1CommitmentWindowReader,
): Promise<K1Reconciliation> {
  const target = requireAccount(account);
  const wanted = requireColour(colour);
  const state = loadK1CoinStore(target);
  const rows = Object.hasOwn(state.awaiting, wanted) ? state.awaiting[wanted] : [];
  const row = rows.find((held) => held.txId === txId) ?? null;
  if (row === null) {
    return {
      outcome: 'refused',
      reason: `Nothing of colour ${wanted} is waiting for a position under ${JSON.stringify(txId)}.`,
    };
  }
  const outcome = await reconcileK1CoinFromChain(
    target,
    { colour: row.colorHex, nonce: row.nonceHex, value: BigInt(row.value), txId: row.txId },
    reader,
    { candidates: 'store' },
  );
  if (outcome.outcome === 'unavailable') return outcome;
  if (outcome.outcome === 'ambiguous' && !outcome.stored) return outcome;
  editStore(target, (draft) => {
    dropAwaitingRow(draft, wanted, row.nonceHex);
  });
  return outcome;
}

/**
 * Whether an awaiting row is still filed under midnight-js's own identifier
 * rather than the chain's hash.
 *
 * THE TWO ARE DIFFERENT LENGTHS, and that is the whole test: a chain hash is 32
 * bytes (64 hex characters) and midnight-js's identifier is 33 (66). Anything
 * else is neither, and it is treated the same way as an identifier — there is
 * nothing to lose by asking the indexer what it resolves to, and a coin filed
 * under something the indexer cannot answer is a coin that reads as arriving
 * for ever.
 */
export function k1AwaitingTxNeedsChainHash(txId: string): boolean {
  return !/^[0-9a-f]{64}$/i.test(typeof txId === 'string' ? txId.trim() : '');
}

/**
 * Settle an awaiting coin, resolving the chain's hash first when the row is
 * still filed under an identifier.
 *
 * THE DEFECT THIS EXISTS FOR (review, 2026/09/18). `resolveTransactionHash`
 * polls the indexer for ten seconds and then RETURNS THE IDENTIFIER IT WAS
 * GIVEN, which is not a failure and reads as an answer. A spend whose indexer
 * was more than ten seconds behind therefore filed its change under the
 * identifier, found nothing to rename it to, and every later read asked for a
 * commitment window at `{ hash: <identifier> }` — a question this indexer
 * answers for nothing (§3b). The coin read "arriving" for the rest of the
 * account's life, with the value in it.
 *
 * So the resolution is retried HERE, on the reads that follow, and the row is
 * renamed the first time the indexer knows the transaction. One place, because
 * both callers — the spend's own settle and Home's walk of the awaiting rows —
 * have to do the same thing, and a second copy of it is how one of them stops
 * doing it.
 *
 * A ROW WITH NO HASH YET IS NOT ASKED ABOUT. The identifier form of the
 * question has no answer in it, so asking costs a round trip and can only come
 * back empty; `'unavailable'` is what a row waiting for its own name is, and it
 * is what the count of payments still arriving is drawn from.
 */
export async function settleK1AwaitingCoinByChainHash(
  account: K1Account,
  colour: string,
  txId: string,
  resolveChainHash: (txId: string) => Promise<string | null>,
  reader: K1CommitmentWindowReader,
): Promise<K1Reconciliation> {
  if (!k1AwaitingTxNeedsChainHash(txId)) {
    return settleK1AwaitingCoin(account, colour, txId, reader);
  }
  const answer = await resolveChainHash(txId);
  const hash = typeof answer === 'string' ? answer.trim() : '';
  if (hash === txId.trim() || k1AwaitingTxNeedsChainHash(hash)) {
    return {
      outcome: 'unavailable',
      reason: `The transaction that produced this coin is not known to the chain by name yet (${JSON.stringify(txId)}).`,
    };
  }
  renameK1AwaitingTx(account, colour, txId, hash);
  return settleK1AwaitingCoin(account, colour, hash, reader);
}

/**
 * Re-file an awaiting coin under the transaction the CHAIN knows it by.
 *
 * A spend writes its change down the instant the circuit returns, and at that
 * moment the only name for the transaction is midnight-js's own identifier. A
 * sponsored transaction is superseded by the balanced one, so that identifier
 * is a key the indexer cannot answer commitment windows for — a change coin
 * filed under it stays "arriving" for ever however often it is asked about.
 * Once `resolveHash` has the chain's hash, the row is renamed to it.
 *
 * ONE ROW, named by the id it is currently filed under. A colour can have two
 * coins in flight ({@link K1CoinStoreState.awaiting}) and each is filed under
 * its own spend; renaming "the colour's row" would put one spend's hash on
 * another spend's coin, and a coin filed under a transaction that did not
 * produce it can never settle.
 *
 * Silent when nothing in that colour is filed under `fromTxId`, and silent on
 * an empty `toTxId` — a row with nothing to look it up by is worse than a row
 * filed under an id the indexer cannot answer, because the second can still be
 * renamed.
 */
export function renameK1AwaitingTx(
  account: K1Account,
  colour: string,
  fromTxId: string,
  toTxId: string,
): void {
  const target = requireAccount(account);
  const wanted = requireColour(colour);
  if (typeof toTxId !== 'string' || toTxId.trim() === '') return;
  editStore(target, (draft) => {
    if (!Object.hasOwn(draft.awaiting, wanted)) return;
    const rows = draft.awaiting[wanted];
    const at = rows.findIndex((row) => row.txId === fromTxId);
    if (at < 0) return;
    rows[at] = { ...rows[at], txId: toTxId.trim() };
    draft.awaiting[wanted] = rows;
  });
}

/** The colours whose last spend returned change nothing could read, with its tx. */
export function k1UnreadChanges(account: K1Account): { colour: string; txId: string }[] {
  const state = loadK1CoinStore(account);
  return Object.entries(state.unreadChange)
    .map(([colour, txId]) => ({ colour, txId }))
    .sort((a, b) => (a.colour < b.colour ? -1 : 1));
}

/* -------------------------------------------------------------------------- */
/* A position that is a guess, and how it stops being one                     */
/* -------------------------------------------------------------------------- */

/**
 * Stores a coin whose position the chain gave more than one answer for.
 *
 * The first candidate becomes the coin's `mtIndex` and the rest wait beside
 * it. That is not "storing a guess as a fact": the fact is the list, it is
 * stored as a list, and the coin is only complete enough to TRY. The thing
 * that decides is a proof — an incorrect qualified description is an
 * unsatisfiable witness and no transaction is submitted (MIP-0012 INV-5) — so
 * the sequence is try, fail cheaply, {@link advanceK1CoinCandidate}, try
 * again, and {@link settleK1Coin} the one that worked.
 *
 * Refuses an empty list rather than storing a coin with no position at all.
 */
export function putK1CoinCandidates(
  account: K1Account,
  coin: Omit<K1HeldCoin, 'mtIndex'>,
  candidates: readonly bigint[],
): void {
  const target = requireAccount(account);
  if (candidates.length === 0) {
    throw new Error('A coin whose position is not known needs at least one candidate position.');
  }
  const normalised = requireCoin({ ...coin, mtIndex: candidates[0] });
  /* Every candidate is checked BEFORE anything is written, so a list with a
     bad entry in the middle cannot leave the store holding half of it. */
  const positions = candidates.map((index) => {
    if (typeof index !== 'bigint' || index < 0n) {
      throw new Error('A held coin needs a commitment-tree position of zero or more.');
    }
    return index.toString();
  });
  editStore(target, (draft) => {
    draft.coins[normalised.colour] = rowFromCoin(normalised);
    draft.mtIndexCandidates[normalised.colour] = positions;
  });
}

/** The positions still to be tried for a colour, current guess first. */
export function k1CoinCandidates(account: K1Account, colour: string): bigint[] {
  const wanted = normalisedColourHex(colour);
  if (wanted === null) return [];
  const state = loadK1CoinStore(account);
  const list = Object.hasOwn(state.mtIndexCandidates, wanted)
    ? state.mtIndexCandidates[wanted]
    : [];
  return list.map((index) => BigInt(index));
}

/**
 * The spend against the current position failed to prove; move to the next.
 *
 * Returns the coin as it now stands, or null when every candidate has been
 * tried. Exhausted does NOT drop the coin: the description is still the only
 * one that exists, the failure may have been about something else entirely,
 * and this module simply has nothing further to suggest — the caller says so
 * rather than looping.
 *
 * THE LIST IS ROTATED THROUGH AND NEVER CONSUMED, and that is the repair for a
 * colour a Passport could be locked out of for good (review, 2026/09/18). The
 * earlier version deleted the list on exhaustion and left the coin sitting on
 * the LAST guess, so a failure that was never about the position at all — a
 * proof service restarted mid-spend answers the same way an unsatisfiable
 * witness does — cost both approvals and then left the store holding a
 * position nothing was going to move off, with `reconcileK1CoinFromChain`
 * answering `'known'` for the held nonce and so rebuilding nothing. Rotating
 * costs a stored list that stays honest about what is still a guess, and it
 * means the next spend of that colour starts from the head again.
 *
 * WHICH CANDIDATE IS "CURRENT" IS THE COIN'S OWN POSITION, not a cursor beside
 * it: one fact, so the two cannot disagree. A held position that is not in the
 * list is not a place in it either, and the head is what gets tried.
 */
export function advanceK1CoinCandidate(account: K1Account, colour: string): K1HeldCoin | null {
  const target = requireAccount(account);
  const wanted = requireColour(colour);
  const draft = draftOf(loadK1CoinStore(target));
  const list = Object.hasOwn(draft.mtIndexCandidates, wanted)
    ? draft.mtIndexCandidates[wanted]
    : [];
  /* Nothing to suggest, or nothing to suggest it for. Whatever list there is
     stays exactly as it is: every writer of a coin in this colour clears it
     ({@link putK1Coin}, {@link dropK1Coin}, {@link replaceK1Coin},
     {@link settleK1Coin}), so it can only outlive the coin it belongs to. */
  if (list.length === 0 || !Object.hasOwn(draft.coins, wanted)) return null;
  const next = list.indexOf(draft.coins[wanted].mtIndex) + 1;
  if (next >= list.length) {
    /* Every position tried. The head goes back on the coin so the next spend
       starts where the reconciliation put it, and the list is kept. */
    draft.coins[wanted] = { ...draft.coins[wanted], mtIndex: list[0] };
    saveDraft(target, draft);
    return null;
  }
  draft.coins[wanted] = { ...draft.coins[wanted], mtIndex: list[next] };
  saveDraft(target, draft);
  return coinFromStoredRow(draft.coins[wanted]);
}

/**
 * The position in the store proved; it is a fact from here.
 *
 * Called on the success of a spend, which is the only evidence available:
 * nothing the indexer says distinguishes the two outputs of a withdrawal, and
 * a proof that verified against a position is the chain agreeing with it.
 */
export function settleK1Coin(account: K1Account, colour: string): void {
  const target = requireAccount(account);
  const wanted = requireColour(colour);
  editStore(target, (draft) => {
    delete draft.mtIndexCandidates[wanted];
  });
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
  const spent = requireColour(spentColour);
  const normalised = change === null ? null : requireCoin(change);
  editStore(target, (draft) => {
    /* THE SPENT NONCE IS RECORDED IN THE SAME WRITE. It has to be: the change
       coin arrives on the private channel, and the private state midnight-js
       hands back after the call is the one it READ BEFORE it — the spent coin
       still in it. Two writes would leave a moment in which the store says the
       coin is gone and does not yet say which one, and the write that lands in
       that moment puts it back. */
    if (Object.hasOwn(draft.coins, spent)) rememberSpentNonce(draft, draft.coins[spent].nonceHex);
    delete draft.coins[spent];
    /* The guesses were about the coin that has just been spent. Whatever the
       change coin's position turns out to be, it is not one of them. */
    delete draft.mtIndexCandidates[spent];
    if (normalised !== null) {
      draft.coins[normalised.colour] = rowFromCoin(normalised);
      delete draft.mtIndexCandidates[normalised.colour];
    }
    /* No change, and a queue behind it: the next coin of that colour becomes
       the held one, so a Passport that was paid twice can spend the second
       payment the moment the first is gone. */
    promoteQueued(draft, spent);
  });
}

/**
 * Remembers the account's X25519 viewing secret alongside its coins.
 *
 * Nothing in this PR reads it back except the private-state provider, which
 * serves it because the witness shape carries it. `null` clears it.
 */
export function rememberK1EncSecretKey(account: K1Account, encSecretKeyHex: string | null): void {
  const target = requireAccount(account);
  editStore(target, (draft) => {
    draft.encSecretKeyHex = encSecretKeyHex;
  });
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
  | { readonly outcome: 'learned'; readonly coin: K1HeldCoin; readonly placed: 'held' | 'queued' }
  | {
      readonly outcome: 'ambiguous';
      readonly candidates: readonly bigint[];
      /** Whether the candidates were written down, or only reported. */
      readonly stored: boolean;
    }
  /** The nonce is one this account has already spent. Nothing was written. */
  | { readonly outcome: 'spent'; readonly nonce: string }
  /** The coin is already held or already queued, at whatever position it has. */
  | { readonly outcome: 'known'; readonly nonce: string }
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
  options: {
    /**
     * What to do when the transaction had more than one shielded output.
     *
     * `'report'`, the default, is the inbox walk's rule and the one the
     * `'ambiguous'` doc above describes: say so and store nothing.
     *
     * `'store'` is the SPEND's rule, and it is new (2026/09/17). A withdrawal's
     * transaction always has two outputs — the payee's note and the account's
     * change — so `'report'` would make every change coin unstorable and every
     * Dynamic Passport spendable exactly once. The candidates are kept in
     * order instead ({@link putK1CoinCandidates}), which is not the same as
     * writing a guess: the store says the position is one of these and the
     * next spend is what decides.
     */
    readonly candidates?: 'report' | 'store';
  } = {},
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

  /* WHAT THE STORE ALREADY KNOWS, ASKED BEFORE THE CHAIN IS.
     This function used to end in `putK1Coin`, which writes the held slot of a
     colour whatever was in it. The inbox walk runs on every Home open and after
     every payment, so a Passport paid 100, having spent 40, re-walked its own
     inbox and wrote the SPENT hundred back over the sixty of change — deleting
     the change's candidate positions with it. An entry whose nonce this account
     has spent is history; one it already holds or has queued is not news; and
     neither is worth a question to the indexer. */
  const state = loadK1CoinStore(target);
  if (state.spentNonces.includes(nonce)) return { outcome: 'spent', nonce };
  const heldRow = Object.hasOwn(state.coins, colour) ? state.coins[colour] : null;
  const queue = Object.hasOwn(state.queued, colour) ? state.queued[colour] : [];
  if (heldRow?.nonceHex === nonce || queue.some((row) => row.nonceHex === nonce)) {
    return { outcome: 'known', nonce };
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
    /* CANDIDATES GO IN THE HELD SLOT OR NOWHERE. `putK1CoinCandidates` writes
       that slot, so storing them over a coin of the same colour would be the
       overwrite this function was just taught not to make. A colour that is
       already holding something keeps it and this one is reported — the
       difference is `stored`, so the caller can say "arriving" rather than
       claiming a position nothing wrote. */
    const stored = options.candidates === 'store' && heldRow === null;
    if (stored) putK1CoinCandidates(target, { colour, nonce, value }, candidates);
    return { outcome: 'ambiguous', candidates, stored };
  }
  const coin: K1HeldCoin = { colour, nonce, value, mtIndex: BigInt(start) };
  /* THE ENQUEUE RULE, not a write of the held slot: first coin of a colour is
     held, every later one queues behind it. */
  /* `'spent'` and `'known'` cannot come back here: both were asked about above,
     before the indexer was, and returned there. What is left is where the coin
     went. */
  const placement = enqueueK1Coin(target, coin) as 'held' | 'queued';
  return { outcome: 'learned', coin, placed: placement };
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

/**
 * A private state handed back by midnight-js, merged into the store rather
 * than written over it.
 *
 * THIS IS THE WRITE THAT WOULD OTHERWISE ERASE THE CHANGE COIN, and it is
 * worth being exact about how. `submitCallTx` builds a call against the
 * private state it reads BEFORE the circuit runs, carries the result of the
 * witnesses in `nextPrivateState`, and on success writes that back:
 * `privateStateProvider.set(id, callTxData.private.nextPrivateState)`
 * (`@midnight-ntwrk/midnight-js-contracts`, `TransactionContext[Submit]`).
 * `held_coin` is a READ — it returns the private state unchanged — so the
 * state written back after a withdrawal is the one that still holds the coin
 * the withdrawal has just consumed.
 *
 * The caller's own `replaceK1Coin` happens after that write resolves, so the
 * ORDER is in our favour today. The order is not a thing to depend on: it is
 * midnight-js's, it changed once already this release (`submitCallTxAsync`
 * hands the write back to the caller entirely), and a store whose correctness
 * rests on which of two writes lands last is a store that loses a coin the day
 * somebody adds an await. So the merge makes the order not matter:
 *
 *   - a row whose nonce this store has recorded as SPENT is dropped. That is
 *     the change coin's protection, and it is why {@link replaceK1Coin} writes
 *     the spent nonce in the same write as the change;
 *   - a colour this store already holds a coin in keeps the STORED coin. The
 *     incoming state is a snapshot from before the call and can only be older;
 *     nothing in it was learned after it was served;
 *   - a colour the store does not hold is taken from the incoming state, so a
 *     coin that reached the private state some other way is not lost;
 *   - the queue, the spent nonces, and the candidate positions are this app's
 *     own and are never taken from an incoming state. midnight-js round-trips
 *     whatever it was served, so an incoming copy is at best equal and at
 *     worst stale;
 *   - a viewing secret is not cleared by a state that carries none.
 */
function mergeIntoK1CoinStore(account: K1Account, incoming: K1CoinStoreState): void {
  editStore(account, (draft) => {
    for (const [colourKey, row] of Object.entries(incoming.coins)) {
      const coin = coinFromRow(row);
      if (coin === null || coin.colour !== normalisedColourHex(colourKey)) continue;
      if (draft.spentNonces.includes(coin.nonce)) continue;
      if (Object.hasOwn(draft.coins, coin.colour)) continue;
      draft.coins[coin.colour] = rowFromCoin(coin);
    }
    if (typeof incoming.encSecretKeyHex === 'string' && draft.encSecretKeyHex === null) {
      draft.encSecretKeyHex = incoming.encSecretKeyHex;
    }
  });
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
      mergeIntoK1CoinStore(target, state);
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
