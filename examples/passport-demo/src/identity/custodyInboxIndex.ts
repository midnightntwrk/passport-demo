/**
 * WHICH TRANSACTION WROTE INBOX ENTRY `k` — the one question the inbox walk
 * cannot answer by itself.
 *
 * WHY IT HAS TO BE ANSWERED AT ALL
 * --------------------------------
 * An inbox entry describes a coin: its nonce, its colour, and its value. It
 * does not carry the coin's POSITION in the Zswap commitment tree, because the
 * depositor did not know it — the position is allocated by the transaction that
 * is at that moment still being submitted. A coin with no position cannot be
 * spent (`./k1CoinStore.ts`), and the only thing that will ever say where one
 * landed is the commitment window of the transaction that produced it. So
 * `readInboxCustody` takes a `txIdFor(index)`, and this module is that function.
 *
 * THE RULE, AND WHY IT IS COUNTING RATHER THAN LOOKING UP
 * ------------------------------------------------------
 * The inbox is an append-only map keyed by `inbox_count`, and `inbox_count`
 * rises by exactly one each time an entry is written. Nothing in the contract's
 * public state records WHICH transaction wrote which key. What the indexer can
 * give is the account's action history — every call on the contract, in block
 * order, with its entry point and its transaction. So entry `k` was written by
 * the `k`-th action in that history whose entry point appends to the inbox, and
 * the mapping is a count over the history rather than a lookup.
 *
 * WHICH ENTRY POINTS APPEND, READ OFF THE COMPILED BUILD
 * ------------------------------------------------------
 * Taken from the build this app ships, not from the contract's prose:
 * `examples/passport-balancer/contracts-stagenet/managed/account-custody/
 * contract/index.js`, where `_do_append_inbox_0` is the ONE function that
 * writes `inbox[inbox_count]` and bumps the count. Its callers are
 * `append_inbox_with_k256` and `append_inbox_with_jubjub`, plus the four
 * grant-authorised shielded withdrawals, which append their CHANGE entry.
 * `deposit_shielded` writes the same two cells inline rather than through that
 * helper (`account.compact` line 1012, quoted in the generated cast guard), so
 * it appends exactly one entry too. Every other circuit in the build — the
 * deposits of NIGHT, the device and key circuits, the ungated withdrawals, the
 * grant lifecycle — touches neither cell. {@link INBOX_APPENDING_ENTRY_POINTS}
 * is that list, and {@link INBOX_MAY_APPEND_ENTRY_POINTS} is the four that
 * append CONDITIONALLY.
 *
 * THE CONDITIONAL FOUR ARE WHY THIS RETURNS `null` RATHER THAN A GUESS
 * -------------------------------------------------------------------
 * A grant-authorised shielded withdrawal appends its change entry only `if
 * (result.is_some)` — that is, only when the spend left change. From the
 * outside there is no way to tell which happened: the entry point is the same
 * either way. One such action in the history therefore puts every later index
 * out by either nothing or one, and an out-by-one index is a coin reconciled
 * against somebody else's transaction — a confident wrong position, which
 * `k1CoinStore.ts` exists to never hold. So the count stops being trustworthy
 * at the first of them, every index from there on answers `null`, and the walk
 * reports those coins as arriving rather than storing them (MIP-0012 §6.5).
 * Passport issues no grants on this path today; the arm is here because the
 * deployed contract has it, and a client that counted past it would be wrong
 * the first time somebody used one.
 *
 * AND A CALL THAT DID NOT APPLY APPENDED NOTHING (2026/09/17)
 * ----------------------------------------------------------
 * The history carries every action that touched the account, including the
 * ones the ledger refused: `transactionResult.status` is `SUCCESS`,
 * `FAILURE`, or `PARTIAL_SUCCESS` (`src/verify/indexer.ts`, `src/lib/
 * indexerTx.ts`). A `FAILURE` wrote no cell, so counting it puts every later
 * index out by one — the confident wrong position this module exists never to
 * produce — and it is skipped like a deploy. `PARTIAL_SUCCESS` is the one
 * nothing here can decide: part of the transaction applied and the answer does
 * not say which part, so an appender in that state stops the count exactly as
 * a grant withdrawal does. A row whose status the answer did not carry is
 * counted as before, because an indexer that does not report one says nothing
 * either way and the alternative would stop every count on this build.
 */

/* -------------------------------------------------------------------------- */
/* The entry points                                                           */
/* -------------------------------------------------------------------------- */

/** Every entry point that appends EXACTLY one inbox entry when it succeeds. */
export const INBOX_APPENDING_ENTRY_POINTS: readonly string[] = [
  'deposit_shielded',
  'append_inbox_with_k256',
  'append_inbox_with_jubjub',
];

/**
 * Every entry point that appends one entry OR none, and gives no way to tell.
 *
 * The change entry of a grant-authorised shielded withdrawal — see the header.
 */
export const INBOX_MAY_APPEND_ENTRY_POINTS: readonly string[] = [
  'withdraw_shielded_with_grant_k256',
  'withdraw_shielded_with_grant_jubjub',
  'withdraw_shielded_to_contract_with_grant_k256',
  'withdraw_shielded_to_contract_with_grant_jubjub',
];

/* -------------------------------------------------------------------------- */
/* Asking the indexer                                                         */
/* -------------------------------------------------------------------------- */

/**
 * How many actions of history are asked for.
 *
 * The same 200 `src/verify/indexer.ts` asks for, and for the same reason: the
 * selection set below carries no per-action `state` — which is ~19 KB of hex
 * each — so two hundred rows is one small answer, and an account with more
 * history than that has an inbox this client cannot count to anyway, which it
 * says by answering `null` rather than by counting a truncated list.
 */
export const CUSTODY_ACTION_HISTORY_LIMIT = 200;

/**
 * The action history query for one account.
 *
 * Deliberately the NARROWEST selection that answers the question — the entry
 * point and the transaction hash — because this runs on opening Home. The
 * shape is `src/verify/indexer.ts`'s `contractActions`, whose `ACTION_FIELDS`
 * documents why `transaction` sits outside the inline fragment and `entryPoint`
 * inside it: `entryPoint` is on `ContractCall` alone, and a deploy or an update
 * has no entry point to select.
 *
 * The address is interpolated raw because the caller has already normalised it
 * (64 hex characters, nothing else can pass `normalisedColourHex`), so there is
 * no quote for a malformed address to smuggle in.
 *
 * `transactionResult` SITS INSIDE `... on RegularTransaction` and has to.
 * `Transaction` is an interface and the apply result is declared on the regular
 * member alone, so selecting it one level up is an unknown field — which
 * GraphQL refuses for the WHOLE query rather than answering without it. Asked
 * flat, this query answered `{"data":null,"errors":[…]}` against
 * `indexer.stagenet.shielded.tools/api/v4` every time Home opened, so
 * {@link custodyActionRowsFrom} read `null`, no delivery could be matched to
 * the transaction that wrote it, and every one of them was counted as still
 * arriving — a Passport saying a payment it had already spent was on its way
 * (live, 2026/09/18). `src/verify/indexer.ts` and `src/lib/indexerTx.ts` both
 * put the field inside the fragment; this is the same shape.
 */
export function custodyActionHistoryQuery(
  address: string,
  limit: number = CUSTODY_ACTION_HISTORY_LIMIT,
): string {
  return `query CustodyInboxActions {
  contract(address: "${address}") {
    actions(limit: ${limit}) {
      __typename
      ... on ContractCall { entryPoint }
      transaction { hash ... on RegularTransaction { transactionResult { status } } }
    }
  }
}`;
}

/**
 * What kind of action a row is.
 *
 * `null` is a row this build could not read, which is not the same as a row
 * that ran no circuit — see {@link custodyInboxTransactions}, where the two are
 * treated differently on purpose.
 */
export type CustodyActionKind = 'ContractCall' | 'ContractDeploy' | 'ContractUpdate' | null;

/** One action of an account's history, reduced to what the count needs. */
export interface CustodyActionRow {
  /** Which of the three action types this is, as the indexer names them. */
  readonly kind: CustodyActionKind;
  /** The circuit that was called, or null for a deploy, an update, or an unreadable row. */
  readonly entryPoint: string | null;
  /** The transaction's own hash, or null where the row carried none. */
  readonly txHash: string | null;
  /**
   * The ledger's apply result — `SUCCESS`, `FAILURE`, `PARTIAL_SUCCESS` — or
   * ABSENT where the answer carried none.
   *
   * Absent and null are not the same thing here and the count reads them
   * differently: absent is an indexer that was not asked or did not say, which
   * changes nothing; a status that is present and is not `SUCCESS` is a
   * transaction that did not do what its entry point names.
   */
  readonly status?: string | null;
}

/** The action types that run no circuit and therefore append nothing. */
const NON_CIRCUIT_ACTIONS: readonly CustodyActionKind[] = ['ContractDeploy', 'ContractUpdate'];

/** The three the indexer's `ContractAction` union has. Anything else is unreadable. */
const KNOWN_ACTION_KINDS: readonly CustodyActionKind[] = [
  'ContractCall',
  'ContractDeploy',
  'ContractUpdate',
];

/**
 * The account's actions OLDEST FIRST, or null when the answer was not one.
 *
 * `null` means "this client does not know the history", and every caller reads
 * it as exactly that: no coin is stored on the strength of a history that could
 * not be read. An account with no actions at all answers an empty array, which
 * is a different thing and is a fact — an inbox with nothing in it.
 *
 * THE ORDER IS REVERSED HERE. This indexer answers newest first (measured and
 * written down in `src/verify/indexer.ts`), and the count below is a walk
 * forwards through history, because inbox key 0 is the FIRST entry ever
 * written.
 */
export function custodyActionRowsFrom(
  body: unknown,
  limit: number = CUSTODY_ACTION_HISTORY_LIMIT,
): CustodyActionRow[] | null {
  if (!body || typeof body !== 'object') return null;
  const envelope = body as { data?: unknown; errors?: unknown };
  /* A partially answered query is not an answer: a history missing rows counts
     short, and counting short points a coin at the wrong transaction. */
  if (Array.isArray(envelope.errors) && envelope.errors.length > 0) return null;
  if (!envelope.data || typeof envelope.data !== 'object') return null;
  const contract = (envelope.data as { contract?: unknown }).contract;
  if (contract === null || contract === undefined) return null;
  if (typeof contract !== 'object') return null;
  const actions = (contract as { actions?: unknown }).actions;
  if (!Array.isArray(actions)) return null;
  const rows: CustodyActionRow[] = [];
  for (const action of actions) {
    if (!action || typeof action !== 'object') {
      /* A row this build cannot read is still a row that MAY have appended, so
         it is kept as unreadable — which stops the count at it rather than
         skipping it and counting the entries after it as earlier ones. */
      rows.push({ kind: null, entryPoint: null, txHash: null });
      continue;
    }
    const row = action as { __typename?: unknown; entryPoint?: unknown; transaction?: unknown };
    const transaction =
      row.transaction && typeof row.transaction === 'object'
        ? (row.transaction as { hash?: unknown; transactionResult?: unknown })
        : null;
    const result =
      transaction && transaction.transactionResult && typeof transaction.transactionResult === 'object'
        ? (transaction.transactionResult as { status?: unknown })
        : null;
    /* The key is left OFF where no status was reported, rather than set to
       null: the count treats "not said" and "said, and it was not SUCCESS" as
       different answers. */
    const status = result && typeof result.status === 'string' ? result.status : undefined;
    rows.push({
      kind: KNOWN_ACTION_KINDS.includes(row.__typename as CustodyActionKind)
        ? (row.__typename as CustodyActionKind)
        : null,
      entryPoint: typeof row.entryPoint === 'string' ? row.entryPoint : null,
      txHash:
        transaction && typeof transaction.hash === 'string' && transaction.hash.length > 0
          ? transaction.hash
          : null,
      ...(status === undefined ? {} : { status }),
    });
  }
  /* A FULL PAGE IS A TRUNCATED ONE, and a truncated history counts SHORT.
     `actions(limit: N)` gives the newest N; index 0 of the reversed list is
     then not the first action this account ever took, and every inbox index
     derived from it points at somebody else's transaction — a confident wrong
     position, which is the one thing this module exists never to produce. The
     header has always said an account with more history than this answers
     `null`; this is where it does. Paging it is a later change, and it is only
     worth making for an account that has had two hundred deliveries. */
  if (rows.length >= limit) return null;
  return rows.reverse();
}

/* -------------------------------------------------------------------------- */
/* The count                                                                  */
/* -------------------------------------------------------------------------- */

/** The transaction per inbox index, and where counting stopped being honest. */
export interface CustodyInboxTransactions {
  /**
   * Index `k` of this array is the transaction that wrote inbox entry `k`, or
   * null where that action carried no hash.
   */
  readonly transactions: readonly (string | null)[];
  /**
   * The first index the count can no longer stand behind, or null when it can
   * stand behind all of them. See the header: one conditional append puts
   * everything after it out by nothing or one.
   */
  readonly indeterminateFrom: number | null;
}

/** A transaction the ledger refused outright: it wrote nothing at all. */
function appliedNothing(row: CustodyActionRow): boolean {
  return row.status === 'FAILURE';
}

/**
 * A transaction that either applied whole or said nothing about it.
 *
 * `PARTIAL_SUCCESS` — and any status this build does not recognise — is
 * neither, and an appending call in that state stops the count.
 */
function appliedWhole(row: CustodyActionRow): boolean {
  return row.status === undefined || row.status === null || row.status === 'SUCCESS';
}

/**
 * Walk a history and say which transaction wrote each inbox entry.
 *
 * The walk stops ADDING at the first conditional appender, and records where —
 * it does not stop reading, because there is nothing further to learn and
 * nothing to be gained by pretending otherwise.
 */
export function custodyInboxTransactions(
  rows: readonly CustodyActionRow[],
): CustodyInboxTransactions {
  const transactions: (string | null)[] = [];
  for (const row of rows) {
    /* A DEPLOY AND A MAINTENANCE UPDATE RUN NO CIRCUIT. Both are ordinary in
       one of these accounts' history — the roster lands in a deploy and two
       updates before the account is usable at all — and neither can write a
       cell, so both are skipped rather than stopping the count. */
    if (NON_CIRCUIT_ACTIONS.includes(row.kind)) continue;
    if (row.kind === 'ContractCall' && row.entryPoint !== null) {
      /* A CALL THE LEDGER REFUSED WROTE NO CELL. Skipped like a deploy: the
         action is in the history and the entry is not in the inbox, so
         counting it would put every later index out by one. */
      if (appliedNothing(row)) continue;
      if (INBOX_APPENDING_ENTRY_POINTS.includes(row.entryPoint) && appliedWhole(row)) {
        transactions.push(row.txHash);
        continue;
      }
      if (
        !INBOX_APPENDING_ENTRY_POINTS.includes(row.entryPoint) &&
        !INBOX_MAY_APPEND_ENTRY_POINTS.includes(row.entryPoint)
      ) {
        continue;
      }
    }
    /* Everything left is a call that MAY have appended one entry and gives no
       way to tell — the four grant withdrawals — or a row this build could not
       read at all. Both put every later index out by nothing or one, so the
       count stops here: the cost of being cautious is a coin shown as
       arriving, and the cost of being wrong is a coin reconciled against
       somebody else's transaction. */
    return { transactions, indeterminateFrom: transactions.length };
  }
  return { transactions, indeterminateFrom: null };
}

/**
 * `txIdFor` as `readInboxCustody` takes it: an inbox index in, a transaction
 * hash or null out.
 *
 * Null for an index past the history, for an index at or after the point the
 * count stopped being honest, and for an action that carried no hash. All three
 * mean the same thing to the walk — the coin is reported and not stored.
 */
export function custodyTxIdForInboxIndex(
  rows: readonly CustodyActionRow[],
): (index: bigint) => string | null {
  const { transactions } = custodyInboxTransactions(rows);
  /* The point the count stopped at needs no separate check here: the walk above
     stops APPENDING there, so every index at or after it is already past the
     end of this list. */
  return (index: bigint) =>
    index < 0n || index >= BigInt(transactions.length) ? null : transactions[Number(index)];
}
