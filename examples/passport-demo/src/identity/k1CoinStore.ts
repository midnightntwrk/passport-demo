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
 *
 * WHAT THE FIRST PAYMENT INTO A FUNDED PASSPORT ADDED (2026/09/21)
 * ----------------------------------------------------------------
 * Points 2 and 4 above were built a day apart and did not meet. The candidate
 * list is keyed by COLOUR, so it can only ever describe the held coin; a
 * delivery whose transaction had two outputs — which is every payment of part
 * of what somebody holds — arriving into a colour that already held a coin
 * therefore had nowhere to put its positions, and was reported rather than
 * stored. Every Passport opens holding a grant, so that was the first payment
 * anybody was ever sent: it read as "one payment is still arriving" on a
 * balance that never moved, for ever, and the money could not be spent (twice
 * on stagenet, blocks 562508 and 562697).
 *
 * The repair is that the guesses travel with the coin instead of being tied to
 * the slot: a queued row may carry its own candidate list ({@link
 * QueuedK1Coin}), and {@link promoteQueued} moves list and coin into the held
 * slot together, where the spend's existing retry decides between them exactly
 * as it does for a change coin. Nothing about a position is written as a fact
 * any earlier than it was before — the queue simply stops being a place a
 * description goes to die.
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
 * A QUEUED coin as it is stored — a held coin's row, plus the other positions
 * it might occupy when the chain gave more than one.
 *
 * WHY THE QUEUE CARRIES ITS OWN GUESSES (live, 2026/09/21). `mtIndexCandidates`
 * is keyed by colour because the witness names one coin per colour, so it can
 * only ever describe the HELD coin. A delivery into a colour that already holds
 * something therefore had nowhere to put its candidates, and was dropped with
 * its description — a Passport paid 10 while holding its opening 100 showed the
 * 100 and "one payment is still arriving" for ever, and could never spend the
 * 10 (block 562697 on stagenet, twice in a day). The guesses ride with the coin
 * instead, and {@link promoteQueued} moves them into the colour's list in the
 * same write that moves the coin into the held slot, so the spend's existing
 * retry resolves the position exactly as it does for a change coin.
 *
 * OPTIONAL, AND BOTH DIRECTIONS OF THE UPGRADE ARE SAFE. A row written by the
 * build before this one carries no `mtIndexCandidates` and reads as a coin with
 * a settled position, which is what it was; a row written by this build is read
 * by the older one through `coinFromRow`, which keeps the four fields it knows
 * and ignores this one — the coin survives a downgrade, only its alternatives
 * do not.
 */
export interface QueuedK1Coin extends StoredK1Coin {
  /**
   * Decimal positions, in the order they are to be tried, with the head equal
   * to this row's own `mtIndex` — the same arrangement
   * {@link K1CoinStoreState.mtIndexCandidates} keeps for a held coin, for the
   * same reason: one fact, so a coin and its current guess cannot disagree.
   *
   * Absent, or empty, means the position is settled and needs no retry.
   */
  readonly mtIndexCandidates?: readonly string[];
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
   *
   * A queued row may carry its own candidate positions — see
   * {@link QueuedK1Coin}. The colour's `mtIndexCandidates` list belongs to the
   * held coin alone and cannot describe a second one.
   */
  readonly queued: Record<string, readonly QueuedK1Coin[]>;
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
  /**
   * Every spend this store has booked and the chain has not yet answered for,
   * oldest first (2026/09/22).
   *
   * THE STORE'S OWN MEMORY OF WHAT A SPEND TOOK. A spend is booked before its
   * transaction is known to have landed — the change coin's description exists
   * nowhere else, so it cannot wait — and until 2026/09/22 the only thing that
   * could take a booking back was a record the SCREEN kept beside the store.
   * A tab closed at the wrong moment, a build that wrote no such record, or a
   * second payment that replaced it, left the store saying a coin had been
   * spent that the chain still held: the balance read nought, "Arriving" for a
   * change coin that never existed, for good (live, `nagger.night`). A row here
   * names the transaction, when it was booked, the coin it consumed, and the
   * change it filed, which is everything {@link reconcileK1Spends} needs to
   * take the booking back — or to keep it — on the chain's word alone.
   */
  readonly pendingSpends: readonly PendingK1SpendRow[];
  /**
   * Spends that were taken back because the chain had not recorded them within
   * the bound, kept for a while in case it records them after all.
   *
   * A transaction the node has lost is gone; one it is merely slow with can
   * still land, and a booking taken back on a guess must be able to come back
   * on the facts. {@link reconcileK1Spends} re-applies one of these the moment
   * the chain shows its transaction, and forgets it once no transaction could
   * still be carrying it.
   */
  readonly undoneSpends: readonly PendingK1SpendRow[];
}

/**
 * One booked spend, as it is STORED.
 *
 * `txId` is whatever the spend was submitted under — midnight-js's identifier,
 * which the indexer answers to — and `at` is when it was booked, in
 * milliseconds. `parent` is the coin the spend consumed, exactly as it was
 * held; `change` is the coin it filed as awaiting, or null for an exact spend.
 */
export interface PendingK1SpendRow {
  readonly txId: string;
  readonly at: number;
  readonly parent: StoredK1Coin;
  readonly change: { readonly nonceHex: string; readonly colorHex: string; readonly value: string } | null;
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
 *
 * The candidate positions are kept where a row carries them, and their absence
 * is a coin with a settled position rather than an unreadable row: that is the
 * whole of the backward compatibility {@link QueuedK1Coin} promises, and it is
 * here, in the read, exactly as the awaiting list's migration is.
 */
function queuedRowsFrom(colourKey: string, rows: unknown): QueuedK1Coin[] {
  if (!Array.isArray(rows)) return [];
  const wanted = normalisedColourHex(colourKey);
  const kept: QueuedK1Coin[] = [];
  for (const row of rows as unknown[]) {
    const coin = coinFromRow(row);
    if (coin === null || coin.colour !== wanted) continue;
    const candidates = candidateListFrom((row as Partial<QueuedK1Coin>).mtIndexCandidates);
    kept.push(queuedRowFromCoin(coin, candidates));
  }
  return kept;
}

/** A queued row, with its candidate list only where there is one to keep. */
function queuedRowFromCoin(coin: K1HeldCoin, candidates: readonly string[]): QueuedK1Coin {
  const row = rowFromCoin(coin);
  return candidates.length === 0 ? row : { ...row, mtIndexCandidates: [...candidates] };
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

/**
 * A stored list of booked spends, each checked the way every other row is: a
 * row that cannot be read is dropped rather than repaired, because the only
 * thing done with one is to put a coin back or take one away.
 */
function spendRowsFrom(value: unknown): PendingK1SpendRow[] {
  if (!Array.isArray(value)) return [];
  const kept: PendingK1SpendRow[] = [];
  for (const entry of value as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Partial<PendingK1SpendRow>;
    const txId = typeof candidate.txId === 'string' ? candidate.txId.trim() : '';
    const at = candidate.at;
    const parent = coinFromRow(candidate.parent);
    if (txId === '' || typeof at !== 'number' || !Number.isFinite(at) || parent === null) continue;
    let change: PendingK1SpendRow['change'] = null;
    if (candidate.change !== null && candidate.change !== undefined) {
      const row = awaitingRowFrom({ ...(candidate.change as object), txId });
      if (row === null) continue;
      change = { nonceHex: row.nonceHex, colorHex: row.colorHex, value: row.value };
    }
    if (kept.some((held) => held.txId === txId)) continue;
    kept.push({ txId, at, parent: rowFromCoin(parent), change });
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
        pendingSpends: spendRowsFrom(entry.pendingSpends),
        undoneSpends: spendRowsFrom(entry.undoneSpends),
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
    pendingSpends: [],
    undoneSpends: [],
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
  queued: Record<string, QueuedK1Coin[]>;
  spentNonces: string[];
  mtIndexCandidates: Record<string, string[]>;
  awaiting: Record<string, AwaitingK1CoinRow[]>;
  unreadChange: Record<string, string>;
  pendingSpends: PendingK1SpendRow[];
  undoneSpends: PendingK1SpendRow[];
}

function draftOf(state: K1CoinStoreState): K1StoreDraft {
  const coins = emptyMap<StoredK1Coin>();
  Object.assign(coins, state.coins);
  const queued = emptyMap<QueuedK1Coin[]>();
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
    pendingSpends: [...state.pendingSpends],
    undoneSpends: [...state.undoneSpends],
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
 *
 * THE COIN'S GUESSES COME WITH IT. A queued coin may have arrived from a
 * transaction with two shielded outputs and so have candidate positions of its
 * own ({@link QueuedK1Coin}); those become the COLOUR's candidate list in this
 * same write, because that list is what the spend's retry reads. Promoting the
 * coin and leaving its alternatives behind would put a guess in the held slot
 * with nothing to advance to — a coin that fails to prove once and then has no
 * second position to try, which is the same dead end as never storing it.
 *
 * A coin promoted WITHOUT candidates clears the colour's list rather than
 * leaving it: whatever was in it described the coin that has just left.
 */
function promoteQueued(draft: K1StoreDraft, colour: string): void {
  if (Object.hasOwn(draft.coins, colour)) return;
  const queue = Object.hasOwn(draft.queued, colour) ? draft.queued[colour] : [];
  const next = queue.shift();
  if (next === undefined) return;
  const { mtIndexCandidates, ...row } = next;
  draft.coins[colour] = row;
  if (mtIndexCandidates !== undefined && mtIndexCandidates.length > 0) {
    draft.mtIndexCandidates[colour] = [...mtIndexCandidates];
  } else {
    delete draft.mtIndexCandidates[colour];
  }
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
    pendingSpends: draft.pendingSpends,
    undoneSpends: draft.undoneSpends,
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
 * Every coin this account COUNTS — the held slot of each colour and the queue
 * behind it — oldest first within a colour. What {@link k1ColourHoldings} adds
 * up, one coin at a time, so a caller can ask the chain about each.
 */
export function k1CountedCoins(account: K1Account): K1HeldCoin[] {
  const state = loadK1CoinStore(account);
  const colours = new Set([...Object.keys(state.coins), ...Object.keys(state.queued)]);
  return [...colours].sort().flatMap((colour) => [
    ...(Object.hasOwn(state.coins, colour) ? [coinFromStoredRow(state.coins[colour])] : []),
    ...(Object.hasOwn(state.queued, colour) ? state.queued[colour].map(coinFromStoredRow) : []),
  ]);
}

/**
 * Forgets coins the CHAIN says this account has already spent, wherever the
 * store holds them, and remembers their nonces as spent (2026/09/26).
 *
 * WHY THE STORE CAN HOLD A SPENT COIN AT ALL. The inbox is append-only: a note
 * stays after the coin it describes is spent. A device that walks the inbox
 * from the start — a Passport recovered on a new device and given its earlier
 * viewing key back by a password backup, or a second device whose synced
 * passkey derives the same key — files every note it can open, including the
 * notes for coins another device has already sent. Those were counted on Home
 * and offered to a payment, and the payment was refused by the node
 * (`NullifierAlreadyPresent`, 239) at the end of a whole proof.
 *
 * Same bookkeeping as a spend that returned no change: the coin leaves its
 * slot, the next queued coin of its colour is promoted, and the nonce is
 * remembered so the next inbox walk cannot file it again. Only a nonce the
 * store holds is touched, and nothing is written when none is. Returns the
 * coins it forgot.
 */
export function forgetSpentK1Coins(account: K1Account, nonces: readonly string[]): K1HeldCoin[] {
  const target = requireAccount(account);
  const wanted = new Set(
    nonces.map((nonce) => normalisedColourHex(nonce)).filter((nonce): nonce is string => nonce !== null),
  );
  const forgotten = k1CountedCoins(target).filter((coin) => wanted.has(coin.nonce));
  if (forgotten.length === 0) return [];
  editStore(target, (draft) => {
    for (const coin of forgotten) {
      rememberSpentNonce(draft, coin.nonce);
      if (Object.hasOwn(draft.coins, coin.colour) && draft.coins[coin.colour].nonceHex === coin.nonce) {
        delete draft.coins[coin.colour];
        delete draft.mtIndexCandidates[coin.colour];
      }
      if (Object.hasOwn(draft.queued, coin.colour)) {
        const rest = draft.queued[coin.colour].filter((row) => row.nonceHex !== coin.nonce);
        if (rest.length === 0) delete draft.queued[coin.colour];
        else draft.queued[coin.colour] = rest;
      }
    }
    for (const coin of forgotten) promoteQueued(draft, coin.colour);
  });
  return forgotten;
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
 *
 * `candidates` is the positions the coin MIGHT occupy, current guess first,
 * for a coin whose transaction carried more than one shielded output. The head
 * is taken as the coin's position wherever it lands — the held slot's
 * candidate list when the colour was empty, the queued row's own when it was
 * not ({@link QueuedK1Coin}) — so a delivery is placed and spendable in its
 * turn whatever the colour was holding when it arrived. Absent is a coin whose
 * position is settled, which is what a single-output transaction gives.
 */
export function enqueueK1Coin(
  account: K1Account,
  coin: K1HeldCoin,
  candidates?: readonly bigint[],
): 'held' | 'queued' | 'known' | 'spent' {
  const target = requireAccount(account);
  const normalised = requireCoin(coin);
  /* CHECKED BEFORE ANYTHING IS WRITTEN, for {@link putK1CoinCandidates}'s
     reason: a list with a bad entry in the middle must not leave the store
     holding half of it. */
  const positions = candidates === undefined ? null : requireCandidatePositions(candidates);
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
      /* The colour's list describes the HELD coin, and the held coin is now
         this one — so it is this coin's guesses or none at all. */
      if (positions === null) delete draft.mtIndexCandidates[normalised.colour];
      else draft.mtIndexCandidates[normalised.colour] = positions;
      return;
    }
    const existing = Object.hasOwn(draft.queued, normalised.colour)
      ? draft.queued[normalised.colour]
      : [];
    existing.push(queuedRowFromCoin(normalised, positions ?? []));
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
  at: number = Date.now(),
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
    /* THE BOOKING, IN THE SAME WRITE AS WHAT IT BOOKS (2026/09/22). The coin
       being consumed is read here, before it is deleted, so the row can put it
       back exactly — position and all — if the chain never records the spend.
       See {@link K1CoinStoreState.pendingSpends}. */
    if (Object.hasOwn(draft.coins, spent)) {
      const parent = draft.coins[spent];
      draft.pendingSpends = draft.pendingSpends.filter((pending) => pending.txId !== txId);
      draft.pendingSpends.push({
        txId,
        at,
        parent,
        change:
          row === null ? null : { nonceHex: row.nonceHex, colorHex: row.colorHex, value: row.value },
      });
    }
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
 * Take {@link rememberK1ChangeCoin} back, in ONE write, for a transaction that
 * turned out not to have happened.
 *
 * THE ONE CALLER IS A SPEND WHOSE TRANSACTION THE CHAIN REFUSED. A payment is
 * booked at SUBMISSION, not at finality, because the change coin's description
 * is the circuit's return value and exists nowhere else in the world — a tab
 * closed during the wait for a verdict must not be the thing that loses it. The
 * price of writing that early is that the verdict can come back no, and a
 * refused transaction spent nothing (MIP-0012 INV-5): the coin was never
 * consumed, the change was never created, and leaving the write in place would
 * mark a live nonce spent for ever and file a coin that does not exist.
 *
 * So this is the exact inverse of that write and nothing more:
 *
 *   - the change coin's awaiting row goes, addressed by its nonce;
 *   - the spent nonce is forgotten, so the coin can be offered again;
 *   - whatever was promoted into the held slot behind the spend goes back to
 *     the FRONT of its queue, oldest-first order intact;
 *   - the coin the spend consumed is put back, at the position it was held at.
 *
 * THE CANDIDATE LIST IS NOT RESTORED, AND MUST NOT BE. `settleK1Coin` ran on a
 * proof that verified against this position, and a proof verifying is the chain
 * agreeing with it — that is a fact about the coin whatever the transaction
 * carrying it came to afterwards. Putting the guesses back would make the next
 * spend of this colour re-try positions the chain has already settled, at one
 * approval each.
 */
export function undoK1ChangeCoin(
  account: K1Account,
  coin: K1HeldCoin,
  change: { readonly colour: string; readonly nonce: string } | null,
  options: {
    /**
     * True when the transaction may still land — the chain simply has not
     * recorded it within the bound — so the booking is kept aside and put back
     * if it does ({@link K1CoinStoreState.undoneSpends}). False (the default)
     * for a transaction the chain REFUSED, which can never land.
     */
    readonly mayStillLand?: boolean;
    /** When it was taken back, for how long it is kept aside. */
    readonly now?: number;
  } = {},
): void {
  const target = requireAccount(account);
  const restored = requireCoin(coin);
  editStore(target, (draft) => {
    undoSpendInDraft(draft, restored, change, options);
  });
}

/**
 * The inverse of one booking, on a draft — shared by {@link undoK1ChangeCoin}
 * and {@link reconcileK1Spends}, so the two can never take a spend back in two
 * different ways.
 */
function undoSpendInDraft(
  draft: K1StoreDraft,
  restored: K1HeldCoin,
  change: { readonly colour: string; readonly nonce: string } | null,
  options: { readonly mayStillLand?: boolean; readonly now?: number },
): void {
  /* The booking goes with what it booked. Kept aside when the transaction
     might yet land, so a late landing puts it back rather than leaving the
     account spending a coin the chain has already spent. */
  const booked = draft.pendingSpends.filter((pending) => pending.parent.nonceHex === restored.nonce);
  draft.pendingSpends = draft.pendingSpends.filter(
    (pending) => pending.parent.nonceHex !== restored.nonce,
  );
  if (options.mayStillLand === true) {
    for (const pending of booked) {
      draft.undoneSpends = draft.undoneSpends.filter((kept) => kept.txId !== pending.txId);
      draft.undoneSpends.push({ ...pending, at: options.now ?? pending.at });
    }
  }
  if (change !== null) {
    dropAwaitingRow(draft, requireColour(change.colour), requireColour(change.nonce));
  }
  draft.spentNonces = draft.spentNonces.filter((nonce) => nonce !== restored.nonce);
  /* WHATEVER TOOK THE SLOT GOES BACK WHERE IT CAME FROM. A spend that left no
     change promotes the next queued coin of the colour into the held slot;
     the coin being restored is the one that was there before it, so the
     promoted coin returns to the front of the queue rather than being
     overwritten by the restore. */
  const occupant = Object.hasOwn(draft.coins, restored.colour)
    ? draft.coins[restored.colour]
    : null;
  if (occupant !== null) {
    const queue = Object.hasOwn(draft.queued, restored.colour)
      ? draft.queued[restored.colour]
      : [];
    /* Unless the occupant IS the coin being restored — a second take-back of
       the same booking, from the screen's record after the store's own. */
    if (occupant.nonceHex !== restored.nonce) {
      /* AND ITS GUESSES GO BACK WITH IT (#82). The colour's candidate list
         describes whatever is in the held slot, which at this moment is the
         promoted coin and not the one being restored; leaving it behind would
         hand the restored coin positions belonging to another coin, and take
         the promoted coin's own alternatives away from it for ever. */
      const guesses = Object.hasOwn(draft.mtIndexCandidates, restored.colour)
        ? draft.mtIndexCandidates[restored.colour]
        : [];
      queue.unshift(queuedRowFromCoin(coinFromStoredRow(occupant), guesses));
      draft.queued[restored.colour] = queue;
    }
  }
  /* The restored coin goes back at the position its proof verified against;
     any list left in the slot belonged to the coin it displaced. */
  delete draft.mtIndexCandidates[restored.colour];
  /* And out of the queue, if a walk filed it there meanwhile: one coin is
     never counted twice. */
  if (Object.hasOwn(draft.queued, restored.colour)) {
    const rest = draft.queued[restored.colour].filter((row) => row.nonceHex !== restored.nonce);
    if (rest.length === 0) delete draft.queued[restored.colour];
    else draft.queued[restored.colour] = rest;
  }
  draft.coins[restored.colour] = rowFromCoin(restored);
}

/* -------------------------------------------------------------------------- */
/* Booked spends, answered from the chain                                     */
/* -------------------------------------------------------------------------- */

/** The spends this store has booked and the chain has not yet answered for. */
export function pendingK1Spends(account: K1Account): PendingK1SpendRow[] {
  return [...loadK1CoinStore(account).pendingSpends];
}

/** The spends taken back on a timeout and kept aside in case they land. */
export function undoneK1Spends(account: K1Account): PendingK1SpendRow[] {
  return [...loadK1CoinStore(account).undoneSpends];
}

/**
 * The chain recorded this spend: its booking is a fact now, not a guess, and
 * there is nothing left to take back. Silent when there was no such booking.
 */
export function landK1Spend(account: K1Account, txId: string): void {
  const target = requireAccount(account);
  editStore(target, (draft) => {
    draft.pendingSpends = draft.pendingSpends.filter((pending) => pending.txId !== txId);
    draft.undoneSpends = draft.undoneSpends.filter((kept) => kept.txId !== txId);
  });
}

/**
 * Takes on a booking the SCREEN wrote down and this store did not.
 *
 * Builds from before 2026/09/22 kept the only record of what a spend took in
 * the screen's stopped-payment record: the coin it consumed, and the nonce of
 * the change it filed. A booking is adopted only where it is still true of
 * the store — the consumed coin is marked spent and is not held, and the
 * change, if there was one, is still waiting — so adopting one twice, or one
 * the store has already settled or taken back, changes nothing.
 */
export function adoptK1PendingSpend(
  account: K1Account,
  booking: {
    readonly txId: string;
    readonly at: number;
    readonly parent: K1HeldCoin;
    readonly change: { readonly colour: string; readonly nonce: string } | null;
  },
): void {
  const target = requireAccount(account);
  const parent = requireCoin(booking.parent);
  const txId = typeof booking.txId === 'string' ? booking.txId.trim() : '';
  if (txId === '' || !Number.isFinite(booking.at)) {
    throw new Error('A booked spend needs the transaction it went out in and when.');
  }
  const changeColour = booking.change === null ? null : requireColour(booking.change.colour);
  const changeNonce = booking.change === null ? null : requireColour(booking.change.nonce);
  editStore(target, (draft) => {
    if (draft.pendingSpends.some((pending) => pending.txId === txId)) return;
    if (draft.undoneSpends.some((kept) => kept.txId === txId)) return;
    if (!draft.spentNonces.includes(parent.nonce)) return;
    const held = Object.hasOwn(draft.coins, parent.colour) ? draft.coins[parent.colour] : null;
    if (held?.nonceHex === parent.nonce) return;
    let change: PendingK1SpendRow['change'] = null;
    if (changeColour !== null) {
      const rows = Object.hasOwn(draft.awaiting, changeColour) ? draft.awaiting[changeColour] : [];
      const waiting = rows.find((row) => row.nonceHex === changeNonce);
      if (waiting === undefined) return;
      change = { nonceHex: waiting.nonceHex, colorHex: waiting.colorHex, value: waiting.value };
    }
    draft.pendingSpends.push({ txId, at: booking.at, parent: rowFromCoin(parent), change });
  });
}

/** What {@link reconcileK1Spends} is handed: the chain's answers, and the clock. */
export interface K1SpendReconcileOptions {
  /**
   * Whether the chain holds a transaction: `true` it does, `false` the indexer
   * ANSWERED and has none, `null` it could not be asked. Only `false` ever
   * takes a booking back.
   */
  readonly onChain: (txId: string) => Promise<boolean | null>;
  readonly now: number;
  /** How long a booked spend is given to appear before it is taken back. */
  readonly boundMs: number;
  /** How long a taken-back spend is watched for a late landing. */
  readonly keepUndoneMs: number;
  /**
   * How many spends of this account's shielded coins the chain holds, or null
   * when it could not be asked. Consulted only for awaiting rows written by
   * builds that kept no booking — see {@link reconcileK1Spends}.
   */
  readonly landedSpendCount?: () => Promise<number | null>;
}

/** What one reconciliation did, by transaction. */
export interface K1SpendReconciliation {
  readonly landed: readonly string[];
  readonly undone: readonly string[];
  readonly reapplied: readonly string[];
  readonly expired: readonly string[];
  /** Awaiting rows from before bookings were kept, dropped as never having existed. */
  readonly orphansDropped: readonly string[];
  /** Spent nonces given back because the chain holds fewer spends than the store. */
  readonly noncesRestored: number;
}

async function askOnChain(
  onChain: K1SpendReconcileOptions['onChain'],
  txId: string,
): Promise<boolean | null> {
  try {
    return await onChain(txId);
  } catch {
    return null;
  }
}

/**
 * THE STORE, MADE TO AGREE WITH THE CHAIN (2026/09/22).
 *
 * Run on every read of a Passport's holdings — a reload, Home opening, a
 * refresh — so that whatever a closed tab, a lost socket, or an older build
 * left behind, what the screen shows is what the chain holds. Four rules, each
 * decided by the chain's own answer and never by a guess:
 *
 *   1. A booked spend the chain HOLDS has landed: its booking is dropped and
 *      the change it filed stays, to be placed by the usual settle.
 *   2. A booked spend the chain has NOT recorded, once `boundMs` has passed
 *      since it was booked, is taken back exactly — the coin it consumed
 *      returns to the held slot at its position, the change it filed is
 *      dropped, the nonce is no longer spent — and kept aside for rule 3.
 *   3. A spend taken back that the chain turns out to hold after all is put
 *      back, so the store never offers a coin the chain has already spent; one
 *      older than `keepUndoneMs` is forgotten, because no transaction could be
 *      carrying it any more.
 *   4. An awaiting row written by a build that kept no booking, filed under a
 *      transaction the chain answers it has never seen, describes a change
 *      coin that does not exist: it is dropped. The coin that spend consumed
 *      was written nowhere but the spent list, so it is given back only where
 *      the chain can say how many spends there really were — the store's
 *      surplus of spent nonces over the account's recorded spends, newest
 *      first — and the next walk of the account's deliveries files it again
 *      with the chain's own position. An indexer that cannot be asked leaves
 *      everything as it is.
 *
 * Nothing is written unless something changed, and everything is written in
 * one write.
 */
export async function reconcileK1Spends(
  account: K1Account,
  options: K1SpendReconcileOptions,
): Promise<K1SpendReconciliation> {
  const target = requireAccount(account);
  const state = loadK1CoinStore(target);
  const landed: string[] = [];
  const undone: string[] = [];
  const reapplied: string[] = [];
  const expired: string[] = [];
  const orphans: { colour: string; nonce: string; txId: string }[] = [];

  for (const pending of state.pendingSpends) {
    const answer = await askOnChain(options.onChain, pending.txId);
    if (answer === true) landed.push(pending.txId);
    else if (answer === false && options.now - pending.at >= options.boundMs) undone.push(pending.txId);
  }
  for (const kept of state.undoneSpends) {
    if (options.now - kept.at >= options.keepUndoneMs) {
      expired.push(kept.txId);
      continue;
    }
    if ((await askOnChain(options.onChain, kept.txId)) === true) reapplied.push(kept.txId);
  }
  const booked = new Set(
    [...state.pendingSpends, ...state.undoneSpends].flatMap((row) =>
      row.change === null ? [] : [row.change.nonceHex],
    ),
  );
  for (const rows of Object.values(state.awaiting)) {
    for (const row of rows) {
      if (booked.has(row.nonceHex) || !k1AwaitingTxNeedsChainHash(row.txId)) continue;
      if ((await askOnChain(options.onChain, row.txId)) === false) {
        orphans.push({ colour: row.colorHex, nonce: row.nonceHex, txId: row.txId });
      }
    }
  }
  let restoreNewest = 0;
  let orphansDropped: string[] = [];
  if (orphans.length > 0 && options.landedSpendCount !== undefined) {
    let count: number | null;
    try {
      count = await options.landedSpendCount();
    } catch {
      count = null;
    }
    if (count !== null && Number.isSafeInteger(count) && count >= 0) {
      orphansDropped = orphans.map((orphan) => orphan.txId);
      /* THE SPENT LIST IS BOUNDED, and a list that has dropped its oldest
         entries can no longer be counted against the chain. */
      const surplus = state.spentNonces.length - count;
      if (state.spentNonces.length < SPENT_NONCE_MEMORY && surplus > 0) {
        restoreNewest = Math.min(surplus, orphans.length);
      }
    }
  }

  const changed =
    landed.length + undone.length + reapplied.length + expired.length + orphansDropped.length > 0;
  if (changed) {
    editStore(target, (draft) => {
      draft.pendingSpends = draft.pendingSpends.filter((pending) => !landed.includes(pending.txId));
      for (const txId of undone) {
        const pending = draft.pendingSpends.find((row) => row.txId === txId);
        if (pending === undefined) continue;
        undoSpendInDraft(
          draft,
          coinFromStoredRow(pending.parent),
          pending.change === null
            ? null
            : { colour: pending.change.colorHex, nonce: pending.change.nonceHex },
          { mayStillLand: true, now: options.now },
        );
      }
      for (const txId of reapplied) {
        const kept = draft.undoneSpends.find((row) => row.txId === txId);
        if (kept === undefined) continue;
        reapplyInDraft(draft, kept);
      }
      draft.undoneSpends = draft.undoneSpends.filter(
        (kept) => !expired.includes(kept.txId) && !reapplied.includes(kept.txId),
      );
      for (const orphan of orphans) {
        if (orphansDropped.includes(orphan.txId)) dropAwaitingRow(draft, orphan.colour, orphan.nonce);
      }
      if (restoreNewest > 0) draft.spentNonces = draft.spentNonces.slice(0, -restoreNewest);
    });
  }
  return {
    landed,
    undone,
    reapplied,
    expired,
    orphansDropped,
    noncesRestored: restoreNewest,
  };
}

/**
 * A spend the chain holds after all, put back on a draft: the coin it consumed
 * leaves wherever it was put back to, its nonce is spent again, and its change
 * is filed as awaiting under the transaction that made it.
 */
function reapplyInDraft(draft: K1StoreDraft, kept: PendingK1SpendRow): void {
  const colour = kept.parent.colorHex;
  const nonce = kept.parent.nonceHex;
  if (Object.hasOwn(draft.coins, colour) && draft.coins[colour].nonceHex === nonce) {
    delete draft.coins[colour];
    delete draft.mtIndexCandidates[colour];
  }
  if (Object.hasOwn(draft.queued, colour)) {
    const rest = draft.queued[colour].filter((row) => row.nonceHex !== nonce);
    if (rest.length === 0) delete draft.queued[colour];
    else draft.queued[colour] = rest;
  }
  rememberSpentNonce(draft, nonce);
  if (kept.change !== null) addAwaitingRow(draft, { ...kept.change, txId: kept.txId });
  else promoteQueued(draft, colour);
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
 * `'unavailable'` LEAVES THE ROW WHERE IT IS, and it is the only outcome that
 * does — which is the whole reason the awaiting slot exists: an indexer that
 * has not caught up yet is a question to ask again in a moment, or after a
 * reload, or tomorrow, and none of those cost the coin.
 *
 * `'ambiguous'` used to leave the row too, because candidates went into a
 * colour's held slot or nowhere and a colour already holding something had
 * nowhere to put them. They now ride with the coin into the queue
 * ({@link QueuedK1Coin}), so the coin is in the store either way and the row
 * has to go: a row left beside a stored coin is the same value counted twice,
 * once as balance and once as still arriving.
 *
 * `'learned'`, `'ambiguous'`, `'spent'`, and `'refused'` therefore all remove
 * the row: the coin is in the store now, or it is one this store has already
 * accounted for, or it is one this store will not hold and will not start
 * being able to.
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
 * A candidate list as it is STORED, or a throw carrying the refusal.
 *
 * One function rather than one per caller: a list that decides nothing and a
 * position that is not a position are the same two refusals wherever the
 * candidates are going, and a second copy of them is how the held slot and the
 * queue start disagreeing about what a position is.
 */
function requireCandidatePositions(candidates: readonly bigint[]): string[] {
  if (candidates.length === 0) {
    throw new Error('A coin whose position is not known needs at least one candidate position.');
  }
  return candidates.map((index) => {
    if (typeof index !== 'bigint' || index < 0n) {
      throw new Error('A held coin needs a commitment-tree position of zero or more.');
    }
    return index.toString();
  });
}

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
  /* Every candidate is checked BEFORE anything is written, so a list with a
     bad entry in the middle cannot leave the store holding half of it. */
  const positions = requireCandidatePositions(candidates);
  const normalised = requireCoin({ ...coin, mtIndex: candidates[0] });
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
  const list = candidateListOf(draft, wanted);
  /* Nothing to suggest, or nothing to suggest it for. Whatever list there is
     stays exactly as it is: every writer of a coin in this colour clears it
     ({@link putK1Coin}, {@link dropK1Coin}, {@link replaceK1Coin},
     {@link settleK1Coin}), so it can only outlive the coin it belongs to. */
  if (list.length === 0 || !Object.hasOwn(draft.coins, wanted)) return null;
  const next = nextCandidatePosition(draft, wanted);
  if (next === null) {
    /* Every position tried. The head goes back on the coin so the next spend
       starts where the reconciliation put it, and the list is kept. */
    draft.coins[wanted] = { ...draft.coins[wanted], mtIndex: list[0] };
    saveDraft(target, draft);
    return null;
  }
  draft.coins[wanted] = { ...draft.coins[wanted], mtIndex: next };
  saveDraft(target, draft);
  return coinFromStoredRow(draft.coins[wanted]);
}

/**
 * Put the coin at the position the chain says it is at (2026/09/23).
 *
 * The found position becomes the head, and any other candidates stay behind
 * it, so a retry still has somewhere to go if the reading was ever wrong.
 * Returns the coin as it now stands, or null where there is no such coin.
 */
export function pinK1CoinPosition(
  account: K1Account,
  colour: string,
  mtIndex: bigint,
): K1HeldCoin | null {
  const target = requireAccount(account);
  const wanted = requireColour(colour);
  const draft = draftOf(loadK1CoinStore(target));
  if (!Object.hasOwn(draft.coins, wanted)) return null;
  const found = mtIndex.toString();
  const list = candidateListOf(draft, wanted);
  draft.coins[wanted] = { ...draft.coins[wanted], mtIndex: found };
  if (list.length > 0) {
    draft.mtIndexCandidates[wanted] = [found, ...list.filter((position) => position !== found)];
  }
  saveDraft(target, draft);
  return coinFromStoredRow(draft.coins[wanted]);
}

/* -------------------------------------------------------------------------- */
/* What is still worth trying, asked WITHOUT writing anything                 */
/* -------------------------------------------------------------------------- */

/** A colour's candidate list as it stands, or an empty one. */
function candidateListOf(draft: K1StoreDraft, colour: string): string[] {
  return Object.hasOwn(draft.mtIndexCandidates, colour)
    ? draft.mtIndexCandidates[colour]
    : [];
}

/**
 * The position AFTER the one the held coin sits on, or null.
 *
 * The arithmetic {@link advanceK1CoinCandidate} used to carry inline, lifted
 * out so {@link k1CoinPositionsLeft} can ask the same question without writing
 * — one copy, because a predicate that disagrees with the rotation it predicts
 * is worse than no predicate at all.
 */
function nextCandidatePosition(draft: K1StoreDraft, colour: string): string | null {
  const list = candidateListOf(draft, colour);
  if (list.length === 0 || !Object.hasOwn(draft.coins, colour)) return null;
  const next = list.indexOf(draft.coins[colour].mtIndex) + 1;
  return next >= list.length ? null : list[next];
}

/**
 * What the sweep would append, and the list it would append to — or null where
 * there is no coin to sweep around.
 *
 * Lifted out of {@link widenK1CoinCandidates} for {@link nextCandidatePosition}'s
 * reason, and it is pure: nothing here reads or writes storage.
 */
function sweepPlan(
  draft: K1StoreDraft,
  colour: string,
): { readonly list: string[]; readonly added: string[] } | null {
  if (!Object.hasOwn(draft.coins, colour)) return null;
  const reported = candidateListOf(draft, colour);
  const list = reported.length > 0 ? reported : [draft.coins[colour].mtIndex];
  let span = 1;
  while (span < list.length && BigInt(list[span]) === BigInt(list[span - 1]) + 1n) span += 1;
  const first = BigInt(list[0]);
  const last = BigInt(list[span - 1]);
  const sweep = BigInt(K1_CANDIDATE_SWEEP);
  const lo = first > sweep ? first - sweep : 0n;
  const hi = last + sweep + 1n;
  const held = new Set(list);
  const added: string[] = [];
  for (let index = lo; index < hi; index += 1n) {
    const text = index.toString();
    if (held.has(text)) continue;
    held.add(text);
    added.push(text);
  }
  return { list, added };
}

/**
 * Whether this colour has a position left to try — the exact question
 * `advanceK1CoinCandidate(…) ?? widenK1CoinCandidates(…)` answers, asked
 * before either of them writes a thing.
 *
 * WHY THE SPEND NEEDS TO ASK IT AHEAD OF TIME (live, 2026/09/21). The retry
 * that rotates a coin through its candidate positions is armed by the words a
 * failure arrives with, and on the sponsored route those words are a fixed
 * sentence: the service redacts the proof server's own text deliberately, so
 * that a malformed transaction cannot make it publish its filesystem and its
 * internal endpoints (`../../../passport-balancer/src/proveAccountCustody.ts`,
 * `REFUSAL_DETAIL`). `spendPositionMayBeWrong` can match nothing in it, so the
 * retry could not fire at all on the only route a Passport actually uses — the
 * first payment out of a freshly funded Passport stopped on the first refusal
 * with no second position ever tried.
 *
 * What replaces the wording there is this: a refusal that IS the proof
 * server's verdict on the transaction retries while there is somewhere to
 * retry TO, and is over the moment there is not. That is what bounds the
 * approvals — the reported window plus one sweep of it, and nothing after.
 *
 * Total on purpose. It is read inside a `catch`, where a throw of its own
 * would replace the failure it was called about, so an unreadable account or
 * colour is `false` rather than an exception.
 */
export function k1CoinPositionsLeft(account: K1Account, colour: string): boolean {
  let draft: K1StoreDraft;
  let wanted: string | null;
  try {
    wanted = normalisedColourHex(colour);
    if (wanted === null) return false;
    draft = draftOf(loadK1CoinStore(requireAccount(account)));
  } catch {
    return false;
  }
  if (nextCandidatePosition(draft, wanted) !== null) return true;
  const plan = sweepPlan(draft, wanted);
  return plan !== null && plan.added.length > 0;
}

/**
 * How far either side of the reported window the sweep looks.
 *
 * The reference client's own numbers (`contract/src/tests/custody-payments.ts`,
 * the direct-transfer test): four before the first reported position and four
 * after the last.
 */
export const K1_CANDIDATE_SWEEP = 4;

/**
 * Widen a coin's candidate list past the window the indexer reported.
 *
 * OPTIONAL INSURANCE, AND ONLY AFTER THE REPORTED WINDOW IS EXHAUSTED (Nicolas,
 * 2026/09/18). The rule is candidate retry over the reported start/end window;
 * the composed-transfer run found the recipient's coin inside it and this sweep
 * never fired. It is here because a coin claimed by a GRAFTED intent — the
 * direct transfer's second call — may escape the indexer's position attribution
 * altogether, and the reference client saw exactly that once. So the reported
 * positions are tried first, in order, and only when every one of them has
 * failed does this append the neighbours.
 *
 * APPENDED, NEVER SUBSTITUTED: the list keeps its head, so a later run still
 * starts where the reconciliation put it. A second call adds nothing, because
 * every swept position is already in the list — which is what bounds the
 * approvals a person can be asked for at one guess each.
 *
 * Returns the coin at the first NEW position, or null when there was nothing to
 * widen or nothing left to add.
 */
export function widenK1CoinCandidates(account: K1Account, colour: string): K1HeldCoin | null {
  const target = requireAccount(account);
  const wanted = requireColour(colour);
  const draft = draftOf(loadK1CoinStore(target));
  /* A SETTLED COIN HAS NO LIST, AND IS THE CASE THAT MATTERS MOST (live,
     2026/09/18). Reconciliation keeps the winning position and drops the
     candidates, which is right — until the chain moves the coin and the one
     position left is the wrong one. D1 sat in exactly that state: a coin
     recorded at 3813 that the chain had at 3814, no candidates, and therefore
     nothing for the retry to advance TO however well it recognised the failure.

     Its own position is then the only thing known about it, so that is what the
     sweep goes around. Seeding the list with it rather than sweeping here
     directly is deliberate: the widening below is already idempotent for a list
     whose head is a single position — the contiguous ascending prefix is just
     that position, so a second call recomputes the same neighbours and adds
     nothing — and a spend whose loop is `advance ?? widen` would never end if
     widening kept finding more. */
  /* THE REPORTED WINDOW IS THE ASCENDING CONTIGUOUS PREFIX, and reading it back
     off the list is what makes this idempotent. The indexer reports
     `[startIndex, endIndex)`, which `putK1CoinCandidates` stores in order, and
     the sweep is appended after it — so the prefix is still the window on a
     second call, the same neighbours are computed, and nothing is added. A
     sweep computed from the WHOLE list would widen around its own last
     addition every time and never run out, which is a person asked for an
     approval per round for ever.

     The arithmetic itself is {@link sweepPlan}'s, so that
     {@link k1CoinPositionsLeft} can predict this call without making it. */
  const plan = sweepPlan(draft, wanted);
  if (plan === null) return null;
  const { list, added } = plan;
  if (added.length === 0) return null;
  draft.mtIndexCandidates[wanted] = [...list, ...added];
  draft.coins[wanted] = { ...draft.coins[wanted], mtIndex: added[0] };
  saveDraft(target, draft);
  return coinFromStoredRow(draft.coins[wanted]);
}

/**
 * Put the coin back on the head of its candidate list.
 *
 * THE OTHER HALF OF ROTATION, and the half a person can walk out of the middle
 * of (review, 2026/09/18). A rotation is only canonical while the run doing it
 * is still running: a spend that has advanced once and then exits for a reason
 * that is NOT about the position — the second approval dismissed, the tab
 * closed, a proof service restarted — leaves the coin persisted at the second
 * candidate. The next press starts there, and if that guess is the wrong one it
 * runs out of list after a SINGLE approval without ever trying the head. Two
 * approvals for one press, and the position the chain offered first never
 * tried.
 *
 * So every exit that is not a retry puts the head back, and the persisted state
 * is the same whether a run finished, threw, or was abandoned: candidate 0 is
 * the current guess whenever no spend is in flight.
 *
 * Silent where there is no list or no coin — there is nothing to be canonical
 * about — and it never touches the list itself.
 */
export function restartK1CoinCandidates(account: K1Account, colour: string): void {
  const target = requireAccount(account);
  const wanted = requireColour(colour);
  const draft = draftOf(loadK1CoinStore(target));
  const list = Object.hasOwn(draft.mtIndexCandidates, wanted)
    ? draft.mtIndexCandidates[wanted]
    : [];
  if (list.length === 0 || !Object.hasOwn(draft.coins, wanted)) return;
  if (draft.coins[wanted].mtIndex === list[0]) return;
  draft.coins[wanted] = { ...draft.coins[wanted], mtIndex: list[0] };
  saveDraft(target, draft);
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

/**
 * Every account this browser holds a viewing secret for, with that secret.
 *
 * READ-ONLY, AND ITS ONE READER IS THE PASSWORD BACKUP (2026/09/26). The
 * backup carries this secret so a Passport brought back on a new device can
 * read the notes delivered before it came back (`./backup.ts`,
 * `./viewingKeys.ts`). It is the ONLY field of this store the backup may see:
 * this function returns the secret and the account it belongs to, and nothing
 * else a coin store holds — no coin, no position, no spend.
 *
 * An account whose key or address this store cannot read is left out rather
 * than listed with a guess, for the reason the store drops an unreadable coin.
 */
export function k1ViewingSecrets(): { network: string; address: string; encSecretKeyHex: string }[] {
  const listed: { network: string; address: string; encSecretKeyHex: string }[] = [];
  for (const [key, state] of Object.entries(readAll())) {
    const separator = key.lastIndexOf('::');
    const account = { network: key.slice(0, separator), address: key.slice(separator + 2) };
    const secret = normalisedColourHex(state.encSecretKeyHex);
    if (separator < 1 || secret === null || normalisedAccount(account) === null) continue;
    listed.push({ network: account.network, address: normalisedColourHex(account.address)!, encSecretKeyHex: secret });
  }
  return listed;
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
 * `'ambiguous'` under the default rule stores NOTHING, deliberately. A
 * multi-output transaction gives every candidate position and no way to tell
 * them apart from here; the reference resolves it by retrying the spend across
 * candidates, which is safe because an incorrect qualified description is an
 * unsatisfiable witness at proving time and no transaction is submitted
 * (MIP-0012 INV-5). Writing the first candidate and calling it the coin, with
 * nothing beside it to try, would replace that safe retry with a store that
 * confidently holds the wrong answer.
 *
 * Under `candidates: 'store'` the list IS kept, and `placed` says where — the
 * held slot, or the queue behind a coin the colour already held.
 */
export type K1Reconciliation =
  | { readonly outcome: 'learned'; readonly coin: K1HeldCoin; readonly placed: 'held' | 'queued' }
  | {
      readonly outcome: 'ambiguous';
      readonly candidates: readonly bigint[];
      /** Whether the candidates were written down, or only reported. */
      readonly stored: boolean;
      /**
       * Where the coin went when they were written down, and null when they
       * were not.
       *
       * EXPLICIT RATHER THAN INFERRED, because the two stored cases read
       * differently to somebody looking at a screen: `'held'` is spendable
       * now, `'queued'` is spendable when what is in front of it has gone, and
       * neither is "still arriving". `stored` alone said only that something
       * had happened.
       */
      readonly placed: 'held' | 'queued' | null;
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
    /* CANDIDATES GO WHERE THE COIN GOES — the held slot when the colour is
       empty, and the QUEUE behind whatever is in it when it is not (live,
       2026/09/21).

       They used to go in the held slot or nowhere, on the reasoning that
       `putK1CoinCandidates` writes that slot and writing it over a coin of the
       same colour would be the overwrite this function had just been taught
       not to make. The conclusion did not follow: the coin did not have to go
       in the held slot at all. Every Passport opens holding its grant, so the
       first payment anybody was ever sent arrived into an occupied colour,
       landed here, and was dropped with its description — 100 mUSD on screen,
       10 mUSD on the chain, "one payment is still arriving" for ever, and no
       way to spend it (blocks 562508 and 562697 on stagenet, twice in one
       day). The queue is where a second coin of a colour belongs, it has been
       since 2026/09/17, and {@link QueuedK1Coin} is what lets the guesses
       travel with it until a promotion makes it the held coin and the spend's
       own retry decides between them. */
    if (options.candidates !== 'store') {
      return { outcome: 'ambiguous', candidates, stored: false, placed: null };
    }
    /* `'spent'` and `'known'` cannot come back from the enqueue: both were
       asked about above, before the indexer was, and returned there. */
    const placed = enqueueK1Coin(
      target,
      { colour, nonce, value, mtIndex: candidates[0] },
      candidates,
    ) as 'held' | 'queued';
    return { outcome: 'ambiguous', candidates, stored: true, placed };
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
