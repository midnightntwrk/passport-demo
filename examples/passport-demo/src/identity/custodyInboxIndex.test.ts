/**
 * The inbox-index → transaction rule, drilled.
 *
 * Every case here is a way of pointing a coin at the wrong transaction, which
 * is the one failure this module exists to not have: a coin reconciled against
 * another transaction's commitment window gets a confident wrong position, and
 * a confident wrong position fails at proving time for ever while looking
 * perfectly spendable on screen.
 */

import { describe, expect, it } from 'vitest';

import {
  CUSTODY_ACTION_HISTORY_LIMIT,
  INBOX_APPENDING_ENTRY_POINTS,
  INBOX_MAY_APPEND_ENTRY_POINTS,
  custodyActionHistoryQuery,
  custodyActionRowsFrom,
  custodyInboxTransactions,
  custodyTxIdForInboxIndex,
  type CustodyActionRow,
} from './custodyInboxIndex.js';

const ADDRESS = 'ab'.repeat(32);

function call(entryPoint: string | null, txHash: string | null): CustodyActionRow {
  return { kind: 'ContractCall', entryPoint, txHash };
}

/** The indexer's own answer shape: newest first, `contract.actions`. */
function answer(actions: unknown[]): unknown {
  return { data: { contract: { actions } } };
}

describe('the entry points that append', () => {
  it('names the three that always append and the four that may', () => {
    /* Read off the compiled build: `_do_append_inbox_0` and the one inline
       copy of it in `deposit_shielded`. If the pinned contract gains another
       writer, this is the assertion that has to be updated with it. */
    expect(INBOX_APPENDING_ENTRY_POINTS).toEqual([
      'deposit_shielded',
      'append_inbox_with_k256',
      'append_inbox_with_jubjub',
    ]);
    expect(INBOX_MAY_APPEND_ENTRY_POINTS).toEqual([
      'withdraw_shielded_with_grant_k256',
      'withdraw_shielded_with_grant_jubjub',
      'withdraw_shielded_to_contract_with_grant_k256',
      'withdraw_shielded_to_contract_with_grant_jubjub',
    ]);
  });
});

describe('custodyActionHistoryQuery', () => {
  it('asks for the entry point and the transaction, and nothing else', () => {
    const text = custodyActionHistoryQuery(ADDRESS);
    expect(text).toContain(`contract(address: "${ADDRESS}")`);
    expect(text).toContain(`actions(limit: ${CUSTODY_ACTION_HISTORY_LIMIT})`);
    expect(text).toContain('... on ContractCall { entryPoint }');
    /* And the ledger's apply result, which decides whether a call that names
       an appending entry point actually wrote a cell. */
    expect(text).toContain(
      'transaction { hash ... on RegularTransaction { transactionResult { status } } }',
    );
    /* The one field that must NOT be selected: ~19 KB of hex per action, on a
       query that runs every time Home opens. */
    expect(text).not.toContain('state');
  });

  it('takes a limit, for a caller that wants a shorter answer', () => {
    expect(custodyActionHistoryQuery(ADDRESS, 5)).toContain('actions(limit: 5)');
  });
});

describe('custodyActionRowsFrom', () => {
  it('reverses the indexer into block order, keeping the three fields', () => {
    const rows = custodyActionRowsFrom(
      answer([
        { __typename: 'ContractCall', entryPoint: 'deposit_shielded', transaction: { hash: 'bb' } },
        { __typename: 'ContractDeploy', transaction: { hash: 'aa' } },
      ]),
    );
    expect(rows).toEqual([
      { kind: 'ContractDeploy', entryPoint: null, txHash: 'aa' },
      { kind: 'ContractCall', entryPoint: 'deposit_shielded', txHash: 'bb' },
    ]);
  });

  it('answers an empty history as a fact', () => {
    expect(custodyActionRowsFrom(answer([]))).toEqual([]);
  });

  it('keeps a row it cannot read, rather than dropping it', () => {
    /* Dropping it would count the entries after it as earlier ones. */
    expect(custodyActionRowsFrom(answer([null, 7, { __typename: 'Something' }]))).toEqual([
      { kind: null, entryPoint: null, txHash: null },
      { kind: null, entryPoint: null, txHash: null },
      { kind: null, entryPoint: null, txHash: null },
    ]);
  });

  it('reads a row whose transaction or hash is missing as having no hash', () => {
    expect(
      custodyActionRowsFrom(
        answer([
          { __typename: 'ContractCall', entryPoint: 'deposit_shielded' },
          { __typename: 'ContractCall', entryPoint: 'deposit_shielded', transaction: 3 },
          { __typename: 'ContractCall', entryPoint: 'deposit_shielded', transaction: { hash: '' } },
          {
            __typename: 'ContractCall',
            entryPoint: 'deposit_shielded',
            transaction: { hash: 12 },
          },
        ]),
      ),
    ).toEqual([
      { kind: 'ContractCall', entryPoint: 'deposit_shielded', txHash: null },
      { kind: 'ContractCall', entryPoint: 'deposit_shielded', txHash: null },
      { kind: 'ContractCall', entryPoint: 'deposit_shielded', txHash: null },
      { kind: 'ContractCall', entryPoint: 'deposit_shielded', txHash: null },
    ]);
  });

  it('refuses everything that is not an answer about a contract', () => {
    for (const body of [
      null,
      undefined,
      'no',
      {},
      { data: null },
      { data: 'no' },
      { data: {} },
      { data: { contract: null } },
      { data: { contract: 'no' } },
      { data: { contract: {} } },
      { data: { contract: { actions: 'no' } } },
      /* A partially answered query. A history missing rows counts short. */
      { errors: [{ message: 'too complex' }], data: { contract: { actions: [] } } },
    ]) {
      expect(custodyActionRowsFrom(body)).toBeNull();
    }
    /* An empty `errors` array is not a refusal. */
    expect(custodyActionRowsFrom({ errors: [], data: { contract: { actions: [] } } })).toEqual([]);
  });
});

describe('custodyInboxTransactions', () => {
  it('counts the appending calls and ignores the rest', () => {
    expect(
      custodyInboxTransactions([
        { kind: 'ContractDeploy', entryPoint: null, txHash: 'deploy' },
        { kind: 'ContractUpdate', entryPoint: null, txHash: 'wave2' },
        { kind: 'ContractUpdate', entryPoint: null, txHash: 'wave3' },
        call('activate_initial_device_with_k256', 'activate'),
        call('deposit_unshielded', 'night'),
        call('deposit_shielded', 'first'),
        call('withdraw_unshielded_with_k256', 'out'),
        call('append_inbox_with_k256', 'second'),
        call('append_inbox_with_jubjub', 'third'),
      ]),
    ).toEqual({ transactions: ['first', 'second', 'third'], indeterminateFrom: null });
  });

  it('stops at a grant withdrawal, which appends one entry or none', () => {
    const counted = custodyInboxTransactions([
      call('deposit_shielded', 'first'),
      call('withdraw_shielded_with_grant_k256', 'grant'),
      call('deposit_shielded', 'after'),
    ]);
    expect(counted).toEqual({ transactions: ['first'], indeterminateFrom: 1 });
  });

  it('stops at a row it could not read, and at a call with no entry point', () => {
    expect(
      custodyInboxTransactions([call('deposit_shielded', 'first'), call(null, 'mystery')]),
    ).toEqual({ transactions: ['first'], indeterminateFrom: 1 });
    expect(
      custodyInboxTransactions([
        call('deposit_shielded', 'first'),
        { kind: null, entryPoint: null, txHash: null },
      ]),
    ).toEqual({ transactions: ['first'], indeterminateFrom: 1 });
  });

  it('remembers an appending call that carried no hash', () => {
    /* The entry exists and its transaction does not: the index is real, and
       nothing can be asked about where its coin landed. */
    expect(custodyInboxTransactions([call('deposit_shielded', null)])).toEqual({
      transactions: [null],
      indeterminateFrom: null,
    });
  });

  it('answers an empty history with an empty count', () => {
    expect(custodyInboxTransactions([])).toEqual({ transactions: [], indeterminateFrom: null });
  });
});

describe('custodyTxIdForInboxIndex', () => {
  const txIdFor = custodyTxIdForInboxIndex([
    { kind: 'ContractDeploy', entryPoint: null, txHash: 'deploy' },
    call('deposit_shielded', 'first'),
    call('deposit_shielded', null),
    call('withdraw_shielded_to_contract_with_grant_jubjub', 'grant'),
    call('deposit_shielded', 'never-counted'),
  ]);

  it('answers the k-th appending call for the k-th entry', () => {
    expect(txIdFor(0n)).toBe('first');
  });

  it('answers null for an entry whose call carried no hash', () => {
    expect(txIdFor(1n)).toBeNull();
  });

  it('answers null from the point the count stopped being honest', () => {
    expect(txIdFor(2n)).toBeNull();
    expect(txIdFor(3n)).toBeNull();
  });

  it('answers null outside the history in either direction', () => {
    expect(txIdFor(-1n)).toBeNull();
    expect(txIdFor(99n)).toBeNull();
  });
});

describe('a history longer than one page', () => {
  /* THE DEFECT THIS CATCHES points every coin at the wrong transaction.
     `actions(limit: N)` gives the NEWEST N, so a full page is a truncated
     history: reversed, its index 0 is not the first action the account ever
     took, and every inbox index derived from it is out by however many were
     dropped. The module's header has always said such an account answers
     `null`; this is the assertion that it does. */
  it('answers nothing rather than counting a truncated history', () => {
    const full = Array.from({ length: CUSTODY_ACTION_HISTORY_LIMIT }, (_unused, index) =>
      call('deposit_shielded', `${index}`.padStart(64, '0')),
    );
    expect(custodyActionRowsFrom(answer(full))).toBeNull();
  });

  it('counts a page that is not full', () => {
    const nearly = Array.from({ length: CUSTODY_ACTION_HISTORY_LIMIT - 1 }, (_unused, index) =>
      call('deposit_shielded', `${index}`.padStart(64, '0')),
    );
    expect(custodyActionRowsFrom(answer(nearly))).toHaveLength(CUSTODY_ACTION_HISTORY_LIMIT - 1);
  });

  /* And the limit is the caller's, so a caller that asks for fewer is held to
     its own page rather than to the default. */
  it('uses the limit it was asked about', () => {
    const three = [call('deposit_shielded', 'aa'.repeat(32)), call('deposit_shielded', 'bb'.repeat(32)), call('deposit_shielded', 'cc'.repeat(32))];
    expect(custodyActionRowsFrom(answer(three), 3)).toBeNull();
    expect(custodyActionRowsFrom(answer(three), 4)).toHaveLength(3);
  });
});

describe('custodyLandedSpendCount — the spends the chain holds', () => {
  it('counts the shielded withdrawals that ran, and nothing else', async () => {
    const { custodyLandedSpendCount } = await import('./custodyInboxIndex.js');
    const rows = [
      { kind: 'ContractDeploy' as const, entryPoint: null, txHash: 'a' },
      { kind: 'ContractCall' as const, entryPoint: 'withdraw_shielded_to_contract_with_jubjub', txHash: 'b', status: 'SUCCESS' },
      { kind: 'ContractCall' as const, entryPoint: 'withdraw_shielded_with_k256', txHash: 'c' },
      { kind: 'ContractCall' as const, entryPoint: 'withdraw_shielded_with_k256', txHash: 'd', status: 'FAILURE' },
      { kind: 'ContractCall' as const, entryPoint: 'withdraw_unshielded_with_jubjub', txHash: 'e' },
      { kind: 'ContractCall' as const, entryPoint: null, txHash: 'f' },
    ];
    expect(custodyLandedSpendCount(rows)).toBe(2);
  });

  it('cannot say for a history it could not read, one that may be cut short, or one with a row it cannot read', async () => {
    const { custodyLandedSpendCount } = await import('./custodyInboxIndex.js');
    expect(custodyLandedSpendCount(null)).toBeNull();
    const call = { kind: 'ContractCall' as const, entryPoint: 'withdraw_shielded_with_k256', txHash: 'b' };
    expect(custodyLandedSpendCount([call, call], 2)).toBeNull();
    expect(custodyLandedSpendCount([call, { kind: null, entryPoint: null, txHash: null }])).toBeNull();
  });
});
