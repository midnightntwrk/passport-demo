/**
 * THE COUNTING RULE ITSELF, over whole histories rather than a case at a time.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * `custodyTxIdForInboxIndex` decides which transaction a delivered coin is
 * reconciled against, and a wrong answer is not a missing coin — it is a coin
 * given a CONFIDENT WRONG POSITION, which looks spendable on screen and fails
 * at proving time for ever. Every row below is a way of being out by one: a
 * deploy in the middle of the history, a call the ledger refused, a call that
 * half applied, a grant withdrawal that may or may not have appended, a row
 * this build could not read, and a page that is full and therefore truncated.
 *
 * WHY A HISTORY AND NOT A ROW. The rule is a WALK: the answer for index 7
 * depends on everything before it, so a drill of one row at a time cannot see
 * the failure this module was written against. The table below gives whole
 * histories and the whole mapping each must produce, and the randomised run at
 * the end holds the same rule against a thousand histories nobody wrote out.
 *
 * `./custodyInboxIndex.test.ts` holds the shapes — what parses, what refuses,
 * what the entry-point lists are. Neither file repeats the other.
 *
 * No new dependency: the generator is a mulberry32 written out here, seeded,
 * so a failure names a seed that can be re-run.
 */

import { describe, expect, it } from 'vitest';

import {
  CUSTODY_ACTION_HISTORY_LIMIT,
  custodyActionHistoryQuery,
  custodyActionRowsFrom,
  custodyInboxTransactions,
  custodyTxIdForInboxIndex,
  type CustodyActionRow,
} from './custodyInboxIndex.js';

/* -------------------------------------------------------------------------- */
/* Rows, in the vocabulary of the thing that made them                        */
/* -------------------------------------------------------------------------- */

const deploy = (txHash: string): CustodyActionRow => ({
  kind: 'ContractDeploy',
  entryPoint: null,
  txHash,
});

const update = (txHash: string): CustodyActionRow => ({
  kind: 'ContractUpdate',
  entryPoint: null,
  txHash,
});

const call = (entryPoint: string, txHash: string | null, status?: string): CustodyActionRow => ({
  kind: 'ContractCall',
  entryPoint,
  txHash,
  ...(status === undefined ? {} : { status }),
});

/** A row this build could not read at all. */
const unreadable = (): CustodyActionRow => ({ kind: null, entryPoint: null, txHash: null });

/* -------------------------------------------------------------------------- */
/* The table                                                                  */
/* -------------------------------------------------------------------------- */

interface HistoryCase {
  readonly name: string;
  readonly rows: CustodyActionRow[];
  /** Index k of this array is what `txIdFor(k)` must answer. */
  readonly mapping: (string | null)[];
  /** The first index that can no longer be counted, or null. */
  readonly indeterminateFrom: number | null;
}

const histories: HistoryCase[] = [
  {
    name: 'an account that has only ever been set up',
    rows: [deploy('deploy'), update('wave2'), update('wave3'), call('activate_initial_device_with_k256', 'act')],
    mapping: [],
    indeterminateFrom: null,
  },
  {
    name: 'three deliveries through the three appending entry points',
    rows: [
      deploy('deploy'),
      call('deposit_shielded', 'first'),
      call('append_inbox_with_k256', 'second'),
      call('append_inbox_with_jubjub', 'third'),
    ],
    mapping: ['first', 'second', 'third'],
    indeterminateFrom: null,
  },
  {
    name: 'deliveries with calls that touch neither inbox cell between them',
    rows: [
      call('deposit_shielded', 'first'),
      call('deposit_unshielded', 'night'),
      call('withdraw_unshielded_with_k256', 'out'),
      call('add_device_with_k256', 'device'),
      call('deposit_shielded', 'second'),
    ],
    mapping: ['first', 'second'],
    indeterminateFrom: null,
  },
  {
    name: 'a maintenance update in the middle of the deliveries',
    rows: [call('deposit_shielded', 'first'), update('wave4'), call('deposit_shielded', 'second')],
    mapping: ['first', 'second'],
    indeterminateFrom: null,
  },
  {
    name: 'a delivery whose action carried no transaction hash',
    rows: [call('deposit_shielded', null), call('deposit_shielded', 'second')],
    mapping: [null, 'second'],
    indeterminateFrom: null,
  },
  {
    name: 'a grant withdrawal, which appended one entry or none',
    rows: [
      call('deposit_shielded', 'first'),
      call('withdraw_shielded_with_grant_k256', 'grant'),
      call('deposit_shielded', 'after'),
    ],
    mapping: ['first', null, null],
    indeterminateFrom: 1,
  },
  {
    name: 'each of the other three grant withdrawals, one history at a time',
    rows: [call('deposit_shielded', 'first'), call('withdraw_shielded_with_grant_jubjub', 'grant')],
    mapping: ['first', null],
    indeterminateFrom: 1,
  },
  {
    name: 'a grant withdrawal to a contract',
    rows: [call('withdraw_shielded_to_contract_with_grant_k256', 'grant'), call('deposit_shielded', 'after')],
    mapping: [null],
    indeterminateFrom: 0,
  },
  {
    name: 'a grant withdrawal to a contract, the jubjub arm',
    rows: [call('withdraw_shielded_to_contract_with_grant_jubjub', 'grant')],
    mapping: [null],
    indeterminateFrom: 0,
  },
  {
    name: 'a call whose entry point the answer did not carry',
    rows: [call('deposit_shielded', 'first'), { kind: 'ContractCall', entryPoint: null, txHash: 'x' }],
    mapping: ['first', null],
    indeterminateFrom: 1,
  },
  {
    name: 'a row this build could not read',
    rows: [call('deposit_shielded', 'first'), unreadable(), call('deposit_shielded', 'after')],
    mapping: ['first', null],
    indeterminateFrom: 1,
  },
  {
    name: 'a delivery the ledger refused',
    rows: [
      call('deposit_shielded', 'first', 'SUCCESS'),
      call('deposit_shielded', 'refused', 'FAILURE'),
      call('deposit_shielded', 'second', 'SUCCESS'),
    ],
    /* THE DEFECT THIS CATCHES. A refused call appended nothing, so counting it
       would file the second delivery under the refused transaction's hash and
       reconcile a real coin against a commitment window it has no part in. */
    mapping: ['first', 'second'],
    indeterminateFrom: null,
  },
  {
    name: 'a delivery that half applied',
    rows: [
      call('deposit_shielded', 'first', 'SUCCESS'),
      call('deposit_shielded', 'half', 'PARTIAL_SUCCESS'),
      call('deposit_shielded', 'after', 'SUCCESS'),
    ],
    mapping: ['first', null, null],
    indeterminateFrom: 1,
  },
  {
    name: 'a status this build has never heard of',
    rows: [call('deposit_shielded', 'first', 'SUCCESS'), call('deposit_shielded', 'odd', 'REVERTED')],
    mapping: ['first', null],
    indeterminateFrom: 1,
  },
  {
    name: 'a refused call that was not a delivery at all',
    rows: [
      call('deposit_shielded', 'first', 'SUCCESS'),
      call('withdraw_unshielded_with_k256', 'refused', 'FAILURE'),
      call('deposit_shielded', 'second', 'SUCCESS'),
    ],
    mapping: ['first', 'second'],
    indeterminateFrom: null,
  },
  {
    name: 'a grant withdrawal the ledger refused, which appended nothing',
    rows: [
      call('deposit_shielded', 'first', 'SUCCESS'),
      call('withdraw_shielded_with_grant_k256', 'refused', 'FAILURE'),
      call('deposit_shielded', 'second', 'SUCCESS'),
    ],
    mapping: ['first', 'second'],
    indeterminateFrom: null,
  },
  {
    name: 'a history with nothing in it',
    rows: [],
    mapping: [],
    indeterminateFrom: null,
  },
];

describe('a whole history, counted', () => {
  for (const history of histories) {
    it(`maps every index for ${history.name}`, () => {
      const counted = custodyInboxTransactions(history.rows);
      expect(counted.indeterminateFrom).toBe(history.indeterminateFrom);

      const txIdFor = custodyTxIdForInboxIndex(history.rows);
      history.mapping.forEach((expected, index) => {
        expect(txIdFor(BigInt(index)), `index ${index}`).toBe(expected);
      });
      /* And the first index past the mapping answers null rather than
         something from the next account's history. */
      expect(txIdFor(BigInt(history.mapping.length + 1))).toBeNull();
      expect(txIdFor(-1n)).toBeNull();
    });
  }
});

/* -------------------------------------------------------------------------- */
/* The order, which is reversed exactly once                                  */
/* -------------------------------------------------------------------------- */

describe('the order the indexer answers in', () => {
  /** The indexer's envelope: newest action first. */
  const answer = (actions: unknown[]): unknown => ({ data: { contract: { actions } } });

  const action = (entryPoint: string, hash: string, status = 'SUCCESS'): unknown => ({
    __typename: 'ContractCall',
    entryPoint,
    transaction: { hash, transactionResult: { status } },
  });

  it('turns a newest-first answer into inbox order, once and not twice', () => {
    /* DISTINGUISHABLE ON PURPOSE: three deliveries whose hashes say which is
       which, so a second reversal is a failure and not a coincidence. */
    const rows = custodyActionRowsFrom(
      answer([action('deposit_shielded', 'newest'), action('deposit_shielded', 'middle'), action('deposit_shielded', 'oldest')]),
    );
    expect(rows?.map((row) => row.txHash)).toEqual(['oldest', 'middle', 'newest']);

    const txIdFor = custodyTxIdForInboxIndex(rows ?? []);
    /* Inbox key 0 is the FIRST entry ever written, which is the OLDEST action. */
    expect(txIdFor(0n)).toBe('oldest');
    expect(txIdFor(2n)).toBe('newest');
  });

  it('reads the ledger result the query now asks for', () => {
    expect(custodyActionHistoryQuery('ab'.repeat(32))).toContain(
      '... on RegularTransaction { transactionResult { status } }',
    );
    const rows = custodyActionRowsFrom(
      answer([action('deposit_shielded', 'refused', 'FAILURE'), action('deposit_shielded', 'landed')]),
    );
    /* Reversed into inbox order: the landed one is older than the refused one. */
    expect(rows?.map((row) => row.status)).toEqual(['SUCCESS', 'FAILURE']);
    /* The refused one is skipped, so the landed one is still entry 0. */
    expect(custodyTxIdForInboxIndex(rows ?? [])(0n)).toBe('landed');
  });

  it('leaves the status off a row whose answer carried none', () => {
    const rows = custodyActionRowsFrom(
      answer([
        { __typename: 'ContractCall', entryPoint: 'deposit_shielded', transaction: { hash: 'a' } },
        { __typename: 'ContractCall', entryPoint: 'deposit_shielded', transaction: { hash: 'b', transactionResult: null } },
        { __typename: 'ContractCall', entryPoint: 'deposit_shielded', transaction: { hash: 'c', transactionResult: { status: 7 } } },
      ]),
    );
    /* Absent is "the indexer did not say", which counts exactly as it did
       before this rule existed — anything else would stop every count on a
       build whose answer carries no result. */
    for (const row of rows ?? []) expect(row.status).toBeUndefined();
    expect(custodyInboxTransactions(rows ?? []).transactions).toHaveLength(3);
  });
});

/* -------------------------------------------------------------------------- */
/* A thousand histories nobody wrote out                                      */
/* -------------------------------------------------------------------------- */

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

describe('the rule, over histories nobody wrote out', () => {
  /**
   * The rule stated independently of the walk: entry k was written by the k-th
   * action that appended, and nothing after the first STOPPER can be counted.
   * A stopper is a row that may or may not have appended and gives no way to
   * tell.
   */
  function expectedMapping(rows: readonly CustodyActionRow[]): (string | null)[] {
    const appended: (string | null)[] = [];
    for (const row of rows) {
      if (row.kind === 'ContractDeploy' || row.kind === 'ContractUpdate') continue;
      const refused = row.status === 'FAILURE';
      if (row.kind === 'ContractCall' && row.entryPoint !== null && refused) continue;
      const appends =
        row.kind === 'ContractCall' &&
        row.entryPoint !== null &&
        ['deposit_shielded', 'append_inbox_with_k256', 'append_inbox_with_jubjub'].includes(
          row.entryPoint,
        );
      const clean = row.status === undefined || row.status === null || row.status === 'SUCCESS';
      if (appends && clean) {
        appended.push(row.txHash);
        continue;
      }
      const touchesNothing =
        row.kind === 'ContractCall' &&
        row.entryPoint !== null &&
        !appends &&
        ![
          'withdraw_shielded_with_grant_k256',
          'withdraw_shielded_with_grant_jubjub',
          'withdraw_shielded_to_contract_with_grant_k256',
          'withdraw_shielded_to_contract_with_grant_jubjub',
        ].includes(row.entryPoint);
      if (touchesNothing) continue;
      return appended;
    }
    return appended;
  }

  for (const seed of [3, 11, 97]) {
    it(`answers the k-th appender, and null past the first stopper (seed ${seed})`, () => {
      const random = mulberry32(seed);
      const pick = <T,>(values: readonly T[]): T => values[Math.floor(random() * values.length)];
      const entryPoints = [
        'deposit_shielded',
        'append_inbox_with_k256',
        'append_inbox_with_jubjub',
        'deposit_unshielded',
        'withdraw_unshielded_with_k256',
        'add_device_with_k256',
        'withdraw_shielded_with_grant_k256',
        'withdraw_shielded_to_contract_with_grant_jubjub',
      ];
      const statuses = [undefined, 'SUCCESS', 'SUCCESS', 'FAILURE', 'PARTIAL_SUCCESS'];

      for (let run = 0; run < 300; run += 1) {
        const rows: CustodyActionRow[] = [];
        const length = Math.floor(random() * 12);
        for (let index = 0; index < length; index += 1) {
          const roll = random();
          if (roll < 0.08) rows.push(deploy(`d${index}`));
          else if (roll < 0.16) rows.push(update(`u${index}`));
          else if (roll < 0.2) rows.push(unreadable());
          else rows.push(call(pick(entryPoints), `tx${index}`, pick(statuses)));
        }

        const expected = expectedMapping(rows);
        const txIdFor = custodyTxIdForInboxIndex(rows);
        for (let index = 0; index < expected.length; index += 1) {
          expect(txIdFor(BigInt(index)), `seed ${seed}, run ${run}, index ${index}`).toBe(
            expected[index],
          );
        }
        /* Every index past what could be counted answers null — the walk never
           runs off the end into another entry's transaction. */
        for (let index = expected.length; index < expected.length + 3; index += 1) {
          expect(txIdFor(BigInt(index)), `seed ${seed}, run ${run}, past the end`).toBeNull();
        }

        const counted = custodyInboxTransactions(rows);
        expect(counted.transactions).toEqual(expected);
        /* And where the count stopped, it stopped at the end of what it had:
           an index at or after that point is past the end of the list. */
        if (counted.indeterminateFrom !== null) {
          expect(counted.indeterminateFrom).toBe(counted.transactions.length);
        }
      }
    });
  }

  it('answers nothing at all for a page that is full, however it was counted', () => {
    /* A full page is a truncated history, and a truncated history counts
       short — every index derived from it would name somebody else's
       transaction. */
    const answer = (actions: unknown[]): unknown => ({ data: { contract: { actions } } });
    const full = Array.from({ length: CUSTODY_ACTION_HISTORY_LIMIT }, (_unused, index) => ({
      __typename: 'ContractCall',
      entryPoint: 'deposit_shielded',
      transaction: { hash: `h${index}`, transactionResult: { status: 'SUCCESS' } },
    }));
    expect(custodyActionRowsFrom(answer(full))).toBeNull();
    expect(custodyActionRowsFrom(answer(full.slice(1)))).toHaveLength(
      CUSTODY_ACTION_HISTORY_LIMIT - 1,
    );
  });
});
