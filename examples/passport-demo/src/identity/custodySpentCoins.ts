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
 * sign-in gave its earlier viewing key back (`./signInViewingKeys.ts`), or a
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
 *
 * WHAT THE SAME READ NOW KEEPS AS WELL (2026/09/27)
 * -------------------------------------------------
 * A spend's events say what it CREATED as well as what it spent: each Zswap
 * output, with its commitment, the contract it was made for, and where in the
 * tree it landed. And the transaction's identifiers come back with them, which
 * are what this device's own trail wrote a payment under before the chain had
 * given it a hash. `./custodyChangeWalk.ts` reads the first to find the change a
 * payment from another device kept — a coin no note describes — and the
 * Activity rebuild reads the second so it never writes a payment twice. Both
 * are kept from the one request this module already makes, so nothing is asked
 * of the indexer that was not asked before: {@link readCustodyTransactions}.
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
 * The domain separator of a coin's COMMITMENT, as the compiled build spells it
 * — `_coinCommitment_0`, whose preimage is the nullifier's with this domain in
 * place of that one.
 */
export const CUSTODY_COIN_COMMITMENT_DOMAIN = 'midnight:zswap-cc[v1]';

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
  return custodyCoinHasher(runtime, CUSTODY_COIN_NULLIFIER_DOMAIN, address)(coin);
}

/**
 * The commitment a coin this account holds is filed under in the tree, as
 * lowercase hex — the bytes a `zswapOutput` event carries for it.
 *
 * The compiled build's `_coinCommitment_0` for a coin sent to `right(self)`:
 * the nullifier's preimage with {@link CUSTODY_COIN_COMMITMENT_DOMAIN}, `false`
 * because a contract and not a person holds it, and the account's address.
 * `./custodySpentCoins.test.ts` holds it to that method, and to the ledger's own
 * `ZswapOutput.newContractOwned(…).commitment`, on the same coins.
 */
export function custodyCoinCommitment(
  runtime: CustodyHashRuntime,
  coin: CustodyCoinDescription,
  address: string,
): string {
  return custodyCoinHasher(runtime, CUSTODY_COIN_COMMITMENT_DOMAIN, address)(coin);
}

/**
 * One of the two hashes above, with everything but the coin laid out ONCE.
 *
 * The change search (`./custodyChangeWalk.ts`) asks for the commitment of the
 * same coin at up to a million values in a row; building the Compact types and
 * encoding the domain and the address a million times over is most of the cost
 * of doing that, and none of it changes between calls.
 */
export function custodyCoinHasher(
  runtime: CustodyHashRuntime,
  domainSeparator: string,
  address: string,
): (coin: CustodyCoinDescription) => string {
  const bytes32 = new runtime.CompactTypeBytes(32);
  const domain = new runtime.CompactTypeBytes(domainSeparator.length);
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
  const domainBytes = new TextEncoder().encode(domainSeparator);
  const data = hexToBytes(address);
  return (coin) => {
    const hash = runtime.persistentHash(preimage, {
      domain_sep: domainBytes,
      info: { nonce: hexToBytes(coin.nonce), color: hexToBytes(coin.colour), value: coin.value },
      dataType: false,
      data,
    });
    return [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  };
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
 *
 * `identifiers` rides along (2026/09/27): the ids a submit answers with, which
 * is what this device's own trail wrote a payment under — see the header.
 */
export function custodySpendEventsQuery(hashes: readonly string[]): string {
  const asked = hashes.flatMap((asked, index) => {
    const hash = normalisedColourHex(asked);
    return hash === null
      ? []
      : [
          `  t${index}: transactions(offset: { hash: "${hash}" }) ` +
            '{ hash ... on RegularTransaction { identifiers zswapLedgerEvents { raw } } }',
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
  return new Map(
    [...custodyTransactionAnswersFrom(body, hashes)].map(([hash, answer]) => [hash, answer.raws]),
  );
}

/** What the indexer said about one transaction: its raw events, and its ids. */
export interface CustodyTransactionAnswer {
  readonly raws: string[];
  /** Lowercase hex, as the submit that sent it answered; empty where none came back. */
  readonly identifiers: string[];
}

/**
 * {@link custodySpendEventsFrom}, with each transaction's identifiers kept as
 * well. The same rules: only what was answered, and nothing from an answer
 * with errors in it. An identifier that is not hex is left out.
 */
export function custodyTransactionAnswersFrom(
  body: unknown,
  hashes: readonly string[],
): Map<string, CustodyTransactionAnswer> {
  const found = new Map<string, CustodyTransactionAnswer>();
  if (!body || typeof body !== 'object') return found;
  const envelope = body as { data?: unknown; errors?: unknown };
  if (Array.isArray(envelope.errors) && envelope.errors.length > 0) return found;
  if (!envelope.data || typeof envelope.data !== 'object') return found;
  const data = envelope.data as Record<string, unknown>;
  hashes.forEach((asked, index) => {
    const hash = normalisedColourHex(asked);
    const answer = data[`t${index}`];
    if (hash === null || !Array.isArray(answer)) return;
    const transaction = (
      answer as { hash?: unknown; zswapLedgerEvents?: unknown; identifiers?: unknown }[]
    ).find((row) => normalisedColourHex(typeof row?.hash === 'string' ? row.hash : null) === hash);
    if (transaction === undefined || !Array.isArray(transaction.zswapLedgerEvents)) return;
    found.set(hash, {
      raws: (transaction.zswapLedgerEvents as { raw?: unknown }[]).flatMap((event) =>
        typeof event?.raw === 'string' ? [event.raw] : [],
      ),
      identifiers: (Array.isArray(transaction.identifiers) ? (transaction.identifiers as unknown[]) : []).flatMap(
        (identifier) => {
          const id = typeof identifier === 'string' ? identifier.trim().toLowerCase().replace(/^0x/, '') : '';
          return /^[0-9a-f]+$/.test(id) ? [id] : [];
        },
      ),
    });
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

/** One coin a transaction made: its commitment, whose it is, and where it landed. */
export interface CustodyCreatedOutput {
  readonly commitment: string;
  /** The contract the coin was made for, or null for a coin made for a person. */
  readonly contract: string | null;
  /** Its position in the commitment tree — the `mt_index` a spend of it proves against. */
  readonly mtIndex: bigint;
}

/**
 * The outputs a transaction's events record, out of events already decoded by
 * the ledger. A `zswapOutput` names its commitment and its position always,
 * and its contract only when a contract holds the coin — the shape a real
 * stagenet payment's events have (`./custodySpentCoins.test.ts`). Anything
 * that is not a readable output is passed over.
 */
export function custodyCreatedOutputs(events: readonly unknown[]): CustodyCreatedOutput[] {
  const outputs: CustodyCreatedOutput[] = [];
  for (const event of events) {
    const content = event as
      | { tag?: unknown; commitment?: unknown; contract?: unknown; mtIndex?: unknown }
      | null
      | undefined;
    if (content?.tag !== 'zswapOutput') continue;
    const commitment = normalisedColourHex(typeof content.commitment === 'string' ? content.commitment : null);
    const mtIndex = typeof content.mtIndex === 'bigint' && content.mtIndex >= 0n ? content.mtIndex : null;
    if (commitment === null || mtIndex === null) continue;
    if (content.contract === undefined || content.contract === null) {
      outputs.push({ commitment, contract: null, mtIndex });
      continue;
    }
    /* A contract that is named and cannot be read is not "nobody's": the
       output is left out rather than guessed at. */
    const contract = normalisedColourHex(typeof content.contract === 'string' ? content.contract : null);
    if (contract !== null) outputs.push({ commitment, contract, mtIndex });
  }
  return outputs;
}

/* -------------------------------------------------------------------------- */
/* The check                                                                  */
/* -------------------------------------------------------------------------- */

/** How the account's own transactions are read: the question, and the decoder. */
export interface CustodyTransactionReadDeps {
  /** Ask the indexer one GraphQL question and hand back the parsed answer. May throw. */
  readonly ask: (query: string) => Promise<unknown>;
  /** One raw event as the ledger decodes it — `Event.deserialize(bytes).content`. May throw. */
  readonly decode: (raw: string) => unknown;
  /** Spends already read, by transaction hash. The tab's own by default. */
  readonly known?: Map<string, readonly CustodySpentInput[]>;
  /** Everything else those reads said, by transaction hash. The tab's own by default. */
  readonly facts?: Map<string, CustodyTransactionFacts>;
}

/** What {@link forgetSpentCustodyCoins} is handed: the three things it cannot do itself. */
export interface CustodySpentCoinsDeps extends CustodyTransactionReadDeps {
  /** A coin's nullifier as this account would spend it — {@link custodyCoinNullifier}. */
  readonly nullifierOf: (coin: CustodyCoinDescription) => string;
}

/** What one check did. */
export interface CustodySpentCoinsResult {
  /** Whether every spend in the history had been read when the coins were checked. */
  readonly complete: boolean;
  /** The coins the chain says are gone, now forgotten by the store. */
  readonly forgotten: readonly K1HeldCoin[];
}

/** Everything one of the account's own transactions was read to say. */
export interface CustodyTransactionFacts {
  /** The coins it spent, with the contract that held each. */
  readonly inputs: readonly CustodySpentInput[];
  /** The coins it made, with where each landed. */
  readonly outputs: readonly CustodyCreatedOutput[];
  /** The ids its submit could have answered with. */
  readonly identifiers: readonly string[];
  /**
   * Whether EVERY event the indexer gave for it was read. A transaction with an
   * event this build could not decode may have made a coin nobody here can see,
   * so "it made nothing for this account" is said only of a whole one.
   */
  readonly whole: boolean;
}

/**
 * A transaction's events, once read, for the life of the tab. A transaction on
 * the chain does not change, so neither does this.
 */
const KNOWN_SPENDS = new Map<string, readonly CustodySpentInput[]>();

/** The rest of what those reads said, kept beside them for the same reason. */
const KNOWN_FACTS = new Map<string, CustodyTransactionFacts>();

/**
 * THE ONE READ: what each of these transactions spent, made, and was known by,
 * asked of the indexer only for the ones this tab has not read yet, in batches
 * of {@link CUSTODY_SPEND_QUERY_BATCH}.
 *
 * `facts` is every asked transaction that HAS been read, now or before; one the
 * indexer did not answer for is simply absent — "cannot say", never "made
 * nothing". A batch that cannot be asked stops the reading, and `complete` says
 * so; what earlier batches answered is kept.
 */
export async function readCustodyTransactions(
  hashes: readonly string[],
  deps: CustodyTransactionReadDeps,
): Promise<{ readonly complete: boolean; readonly facts: ReadonlyMap<string, CustodyTransactionFacts> }> {
  const known = deps.known ?? KNOWN_SPENDS;
  const facts = deps.facts ?? KNOWN_FACTS;
  const wanted = [
    ...new Set(hashes.map((hash) => normalisedColourHex(hash)).filter((hash): hash is string => hash !== null)),
  ];
  const unread = wanted.filter((hash) => !known.has(hash) || !facts.has(hash));
  for (let start = 0; start < unread.length; start += CUSTODY_SPEND_QUERY_BATCH) {
    const batch = unread.slice(start, start + CUSTODY_SPEND_QUERY_BATCH);
    let answered: Map<string, CustodyTransactionAnswer>;
    try {
      answered = custodyTransactionAnswersFrom(await deps.ask(custodySpendEventsQuery(batch)), batch);
    } catch {
      break;
    }
    for (const [hash, answer] of answered) {
      const decoded = answer.raws.flatMap((raw) => {
        try {
          return [deps.decode(raw)];
        } catch {
          return [];
        }
      });
      const inputs = custodySpentInputs(decoded);
      known.set(hash, inputs);
      facts.set(hash, {
        inputs,
        outputs: custodyCreatedOutputs(decoded),
        identifiers: answer.identifiers,
        whole: decoded.length === answer.raws.length,
      });
    }
  }
  const read = new Map<string, CustodyTransactionFacts>();
  for (const hash of wanted) {
    const fact = facts.get(hash);
    if (fact !== undefined) read.set(hash, fact);
  }
  return { complete: read.size === wanted.length, facts: read };
}

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

  await readCustodyTransactions(spends, { ...deps, known });

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
