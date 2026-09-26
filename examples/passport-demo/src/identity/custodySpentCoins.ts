/**
 * WHICH OF THE COINS A PASSPORT HAS DESCRIBED IT STILL HOLDS — asked of the
 * chain, never assumed (2026/09/26).
 *
 * WHY IT HAS TO BE ASKED
 * ----------------------
 * The inbox is append-only. A note describes a coin the account was paid and
 * it stays there after the coin is spent, because nothing ever removes one. A
 * device that walks the inbox from the start therefore finds every note ever
 * sealed to its key, spent or not: a Passport recovered on a new device whose
 * password backup gave its earlier viewing key back (`./viewingKeys.ts`), or a
 * second device whose synced passkey derives the same key. Each note for a coin
 * the OTHER device had already sent was counted on Home, and a payment drawn on
 * one proved and was then refused by the node — `NullifierAlreadyPresent`,
 * refusal 239 — for money that was not there.
 *
 * WHAT THE CHAIN CAN SAY, AND WHERE
 * ---------------------------------
 *   - The account's public state holds no coins. The compiled build's `Ledger`
 *     (`contracts/stagenet/account-custody/contract/index.d.ts`, `export type
 *     Ledger`) is the inbox, its count, the unshielded balances, the devices,
 *     and the grants: there is no map or set of shielded coins to look in.
 *   - The commitment tree cannot say either. A commitment is never removed when
 *     its coin is spent, and the per-contract tree the indexer serves — what
 *     the spend's position lookup fetches (`queryZSwapAndContractState`) — is
 *     the ledger's `ZswapChainState.filter`, which keeps the tree and drops the
 *     nullifier set.
 *   - A spend publishes the coin's NULLIFIER. For a coin a contract holds it is
 *     a hash of the coin and the contract's address with no secret in it — the
 *     compiled build's own `coinNullifier`, which {@link custodyCoinNullifier}
 *     computes the same way — and the chain records it in a `zswapInput` ledger
 *     event of the transaction that spent it, with the contract named beside
 *     it.
 *
 * So a coin is spent when its nullifier is in a `zswapInput` event of one of
 * THIS ACCOUNT'S own spends. Only the account can spend a coin the account
 * holds — the ledger takes a contract's coin only in a call on that contract —
 * and every call on it is already in the action history the holdings read
 * fetches for the inbox walk (`./custodyInboxIndex.ts`). The transactions to
 * look at are its `withdraw_shielded*` calls, the set `custodyLandedSpendCount`
 * counts: read off the compiled build, they are the only circuits that spend a
 * shielded coin. Nothing has to be searched for.
 *
 * ONLY POSITIVE EVIDENCE TAKES A COIN AWAY
 * ----------------------------------------
 * A history that could not be read, a transaction the indexer did not answer
 * for, an event this build cannot decode: every one of them leaves the store
 * exactly as it was, and says nothing. A coin is dropped only when the chain
 * names its nullifier. The cost of a miss is today's behaviour — and the send's
 * own safety net (`./custodyContractClient.ts`, `custodyCoinAlreadySpent`) —
 * and the cost of a wrong drop would be money that vanished from the screen.
 *
 * CHEAP BY CONSTRUCTION
 * ---------------------
 * Nothing is asked when the store holds no coins or the history holds no
 * spends. The events of every spend not already known are asked for in one
 * request per {@link CUSTODY_SPEND_QUERY_BATCH}, and a spend's events, once
 * read, are kept for the life of the tab: a transaction on the chain never
 * changes, so Home's watch asks again only about a spend that is new.
 *
 * It holds no DOM, no React, no `fetch`, no ledger, and no runtime: the
 * question to the indexer, the event decoder, and the hash are handed in, and
 * the whole of it is drilled in `./custodySpentCoins.test.ts`.
 */

import { normalisedColourHex } from '../lib/colour.js';
import { hexToBytes } from './custodyContractPlan.js';
import type { CustodyActionRow } from './custodyInboxIndex.js';
import { forgetSpentK1Coins, k1CountedCoins, type K1Account, type K1HeldCoin } from './k1CoinStore.js';

/* -------------------------------------------------------------------------- */
/* A coin's nullifier                                                         */
/* -------------------------------------------------------------------------- */

/** The domain separator of a coin's nullifier, as the compiled build spells it. */
export const CUSTODY_COIN_NULLIFIER_DOMAIN = 'midnight:zswap-cn[v1]';

/**
 * The one shape the hash is told about a type: how it is laid out, and how a
 * value becomes field elements. `@midnight-ntwrk/compact-runtime`'s own
 * `CompactType`, reduced to the two methods its `persistentHash` calls.
 */
export interface CustodyCompactType<A> {
  alignment(): unknown[];
  toValue(value: A): Uint8Array[];
}

/** The four pieces of the Compact runtime a nullifier is made with. */
export interface CustodyHashRuntime {
  persistentHash<A>(type: CustodyCompactType<A>, value: A): Uint8Array;
  CompactTypeBytes: new (length: number) => CustodyCompactType<Uint8Array>;
  CompactTypeUnsignedInteger: new (max: bigint, bytes: number) => CustodyCompactType<bigint>;
  CompactTypeBoolean: CustodyCompactType<boolean>;
}

/** A coin as the nullifier needs it: what the inbox note says, and nothing else. */
export interface CustodyCoinDescription {
  readonly colour: string;
  readonly nonce: string;
  readonly value: bigint;
}

/** Laid out as the compiled build's `CoinPreimage` is. */
interface CoinPreimage {
  readonly domain_sep: Uint8Array;
  readonly info: { readonly nonce: Uint8Array; readonly color: Uint8Array; readonly value: bigint };
  readonly dataType: boolean;
  readonly data: Uint8Array;
}

/**
 * The nullifier a spend of this coin by this account publishes, as lowercase
 * hex — the same bytes a `zswapInput` event carries.
 *
 * WRITTEN OUT FROM THE COMPILED BUILD, NOT FROM A SPECIFICATION. The build's
 * `_coinNullifier_0` is `persistentHash<CoinPreimage>` over the domain
 * `midnight:zswap-cn[v1]` (21 bytes), the coin (nonce, colour, value as a
 * `Uint<128>`), `false` for "a contract holds it", and the contract's address.
 * `./custodySpentCoins.test.ts` holds this to that very method, and to the
 * ledger's own `ZswapInput.newContractOwned(…).nullifier`, on the same coins.
 */
export function custodyCoinNullifier(
  runtime: CustodyHashRuntime,
  coin: CustodyCoinDescription,
  address: string,
): string {
  const bytes32 = new runtime.CompactTypeBytes(32);
  const domain = new runtime.CompactTypeBytes(CUSTODY_COIN_NULLIFIER_DOMAIN.length);
  const uint128 = new runtime.CompactTypeUnsignedInteger((1n << 128n) - 1n, 16);
  const boolean = runtime.CompactTypeBoolean;
  const coinType: CustodyCompactType<CoinPreimage['info']> = {
    alignment: () => [...bytes32.alignment(), ...bytes32.alignment(), ...uint128.alignment()],
    toValue: (value) => [
      ...bytes32.toValue(value.nonce),
      ...bytes32.toValue(value.color),
      ...uint128.toValue(value.value),
    ],
  };
  const preimage: CustodyCompactType<CoinPreimage> = {
    alignment: () => [
      ...domain.alignment(),
      ...coinType.alignment(),
      ...boolean.alignment(),
      ...bytes32.alignment(),
    ],
    toValue: (value) => [
      ...domain.toValue(value.domain_sep),
      ...coinType.toValue(value.info),
      ...boolean.toValue(value.dataType),
      ...bytes32.toValue(value.data),
    ],
  };
  const hash = runtime.persistentHash(preimage, {
    domain_sep: new TextEncoder().encode(CUSTODY_COIN_NULLIFIER_DOMAIN),
    info: { nonce: hexToBytes(coin.nonce), color: hexToBytes(coin.colour), value: coin.value },
    dataType: false,
    data: hexToBytes(address),
  });
  return [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/* -------------------------------------------------------------------------- */
/* Which transactions, and what they spent                                    */
/* -------------------------------------------------------------------------- */

/**
 * The account's own transactions that can have spent one of its shielded
 * coins, oldest first and each once: its `withdraw_shielded*` calls, less any
 * the ledger refused outright (a refused transaction spent nothing).
 *
 * Empty for a history that could not be read — which is "cannot say", and
 * leaves every coin where it is.
 */
export function custodySpendTransactions(rows: readonly CustodyActionRow[] | null): string[] {
  if (rows === null) return [];
  const hashes: string[] = [];
  for (const row of rows) {
    if (row.kind !== 'ContractCall' || !(row.entryPoint ?? '').startsWith('withdraw_shielded')) continue;
    if (row.status === 'FAILURE') continue;
    const hash = normalisedColourHex(row.txHash);
    if (hash !== null && !hashes.includes(hash)) hashes.push(hash);
  }
  return hashes;
}

/** How many transactions one question to the indexer asks about. */
export const CUSTODY_SPEND_QUERY_BATCH = 25;

/**
 * One question for the Zswap ledger events of several transactions, each under
 * its own alias so one answer carries them all.
 *
 * The hashes are interpolated raw because they have already been normalised to
 * 64 hex characters ({@link custodySpendTransactions}), so there is no quote
 * for one to smuggle in; anything else is left out rather than asked about.
 */
export function custodySpendEventsQuery(hashes: readonly string[]): string {
  const asked = hashes.flatMap((asked, index) => {
    const hash = normalisedColourHex(asked);
    return hash === null
      ? []
      : [
          `  t${index}: transactions(offset: { hash: "${hash}" }) ` +
            '{ hash ... on RegularTransaction { zswapLedgerEvents { raw } } }',
        ];
  });
  return `query CustodySpentCoins {\n${asked.join('\n')}\n}`;
}

/**
 * Each transaction's raw Zswap ledger events, by hash, out of the indexer's
 * answer to {@link custodySpendEventsQuery} asked with the same `hashes`.
 *
 * ONLY WHAT WAS ANSWERED. A transaction the indexer does not know, an answer
 * with errors in it, or one this build cannot read, is simply absent — asked
 * again next time, and never read as "it spent nothing".
 */
export function custodySpendEventsFrom(
  body: unknown,
  hashes: readonly string[],
): Map<string, string[]> {
  const found = new Map<string, string[]>();
  if (!body || typeof body !== 'object') return found;
  const envelope = body as { data?: unknown; errors?: unknown };
  if (Array.isArray(envelope.errors) && envelope.errors.length > 0) return found;
  if (!envelope.data || typeof envelope.data !== 'object') return found;
  const data = envelope.data as Record<string, unknown>;
  hashes.forEach((asked, index) => {
    const hash = normalisedColourHex(asked);
    const answer = data[`t${index}`];
    if (hash === null || !Array.isArray(answer)) return;
    const transaction = (answer as { hash?: unknown; zswapLedgerEvents?: unknown }[]).find(
      (row) => normalisedColourHex(typeof row?.hash === 'string' ? row.hash : null) === hash,
    );
    if (transaction === undefined || !Array.isArray(transaction.zswapLedgerEvents)) return;
    found.set(
      hash,
      (transaction.zswapLedgerEvents as { raw?: unknown }[]).flatMap((event) =>
        typeof event?.raw === 'string' ? [event.raw] : [],
      ),
    );
  });
  return found;
}

/** One coin a transaction spent: its nullifier, and the contract that held it. */
export interface CustodySpentInput {
  readonly nullifier: string;
  readonly contract: string;
}

/**
 * The inputs a transaction's events record, out of events already decoded by
 * the ledger (`Event.deserialize(…).content`). Everything that is not a
 * contract's `zswapInput` — an output, a user's coin, a DUST event, a shape
 * this build has not met — is passed over.
 */
export function custodySpentInputs(events: readonly unknown[]): CustodySpentInput[] {
  const inputs: CustodySpentInput[] = [];
  for (const event of events) {
    const content = event as { tag?: unknown; nullifier?: unknown; contract?: unknown } | null | undefined;
    if (content?.tag !== 'zswapInput') continue;
    const nullifier = normalisedColourHex(typeof content.nullifier === 'string' ? content.nullifier : null);
    /* A user's coin names no contract, and is nobody's business here. */
    const contract = normalisedColourHex(typeof content.contract === 'string' ? content.contract : null);
    if (nullifier !== null && contract !== null) inputs.push({ nullifier, contract });
  }
  return inputs;
}

/* -------------------------------------------------------------------------- */
/* The check                                                                  */
/* -------------------------------------------------------------------------- */

/** What {@link forgetSpentCustodyCoins} is handed: the three things it cannot do itself. */
export interface CustodySpentCoinsDeps {
  /** Ask the indexer one GraphQL question and hand back the parsed answer. May throw. */
  readonly ask: (query: string) => Promise<unknown>;
  /** One raw event as the ledger decodes it — `Event.deserialize(bytes).content`. May throw. */
  readonly decode: (raw: string) => unknown;
  /** A coin's nullifier as this account would spend it — {@link custodyCoinNullifier}. */
  readonly nullifierOf: (coin: CustodyCoinDescription) => string;
  /** Spends already read, by transaction hash. The tab's own by default. */
  readonly known?: Map<string, readonly CustodySpentInput[]>;
}

/** What one check did. */
export interface CustodySpentCoinsResult {
  /** Whether every spend in the history had been read when the coins were checked. */
  readonly complete: boolean;
  /** The coins the chain says are gone, now forgotten by the store. */
  readonly forgotten: readonly K1HeldCoin[];
}

/**
 * A transaction's events, once read, for the life of the tab. A transaction on
 * the chain does not change, so neither does this.
 */
const KNOWN_SPENDS = new Map<string, readonly CustodySpentInput[]>();

/**
 * THE HELD-COIN CHECK: every coin the store counts, against the nullifiers the
 * account's own spends published, and the ones the chain names forgotten.
 *
 * Run by Home after each delivery walk, on the history that walk just read, so
 * it covers a first load, a reload, and the read that follows a restore alike.
 * Nothing here can add a coin or make a figure larger; see the header for why
 * every failure is silent.
 */
export async function forgetSpentCustodyCoins(
  account: K1Account,
  actions: readonly CustodyActionRow[] | null,
  deps: CustodySpentCoinsDeps,
): Promise<CustodySpentCoinsResult> {
  const known = deps.known ?? KNOWN_SPENDS;
  const coins = k1CountedCoins(account);
  const spends = custodySpendTransactions(actions);
  if (coins.length === 0 || spends.length === 0) return { complete: true, forgotten: [] };

  const unread = spends.filter((hash) => !known.has(hash));
  for (let start = 0; start < unread.length; start += CUSTODY_SPEND_QUERY_BATCH) {
    const batch = unread.slice(start, start + CUSTODY_SPEND_QUERY_BATCH);
    let answered: Map<string, string[]>;
    try {
      answered = custodySpendEventsFrom(await deps.ask(custodySpendEventsQuery(batch)), batch);
    } catch {
      break;
    }
    for (const [hash, raws] of answered) {
      known.set(
        hash,
        custodySpentInputs(
          raws.flatMap((raw) => {
            try {
              return [deps.decode(raw)];
            } catch {
              return [];
            }
          }),
        ),
      );
    }
  }

  const address = normalisedColourHex(account.address);
  const spent = new Set(
    spends.flatMap((hash) =>
      (known.get(hash) ?? [])
        .filter((input) => input.contract === address)
        .map((input) => input.nullifier),
    ),
  );
  const gone = coins.filter((coin) => {
    try {
      return spent.has(deps.nullifierOf(coin));
    } catch {
      return false;
    }
  });
  return {
    complete: spends.every((hash) => known.has(hash)),
    forgotten: gone.length === 0 ? [] : forgetSpentK1Coins(account, gone.map((coin) => coin.nonce)),
  };
}
