/**
 * A Passport's Activity, read back from its history on the chain at the times
 * it happened (2026/09/27), and merged into the trail once.
 *
 * The defect these drill: a Passport recovered on an Android phone showed its
 * setup as four rows stamped "1 min ago" and nothing for the 23 mUSD another
 * device had sent. The history below is that account's own, as the indexer
 * served it on 2026/09/27 (read only), parsed by the same reader Home uses.
 */

import { describe, expect, it } from 'vitest';

import { custodyExplorerLink } from '../identity/custodyContractPlan.js';
import type { CustodyChangeStep } from '../identity/custodyChangeWalk.js';
import { custodyActionRowsFrom, type CustodyActionRow } from '../identity/custodyInboxIndex.js';
import type { CustodyTransactionFacts } from '../identity/custodySpentCoins.js';
import {
  ACTIVITY_KEEP,
  RESTORED_ACTIVITY_PREFIX,
  mergeRestoredActivity,
  type ActivityFeedEntry,
  type RestoredActivityRow,
} from './activityFeed.js';
import { MUSD_COLOUR_HEX, NIGHT_COLOUR_HEX, describeColour } from './colour.js';
import {
  custodyChainActivity,
  custodyMilestoneAction,
  custodyOutgoingTransactions,
  type CustodyChainActivityInput,
  type CustodyChainActivityRow,
} from './custodyChainActivity.js';
import { explorerTxUrl } from './networks.js';

/* -------------------------------------------------------------------------- */
/* The account from the Android recovery, as the indexer answered for it      */
/* -------------------------------------------------------------------------- */

const DEPLOY = 'b1d9686bef9e8f65d395128a6835a9b06f23b3c6ba5b869113afb347f3d17577';
const ACTIVATE = '86abf594e618cb2cb7682eb5b6dbfefe939bb8ce725382b48d8cae9d8268e731';
const NIGHT_GRANT = '39d6b40754cffef28fb79eba5cfcaf38c50792a5d0fc0805cb97957237908509';
const MUSD_GRANT = '1f8227968cc53388ffdb0891d72e7f61524c3df06a4bf67fc13a2717e449e189';
const WAY_BACK = 'fa499f80ea587d22f69a562493aba2e0fa0220cb2ddc5a95589fb01f7123f93c';
const RECOVERY_ONE = '09394ca6ac5f33cc308a60a58618298eb8fe78c591c381784672dfec4e82b1b7';
const PAYMENT = 'c78b3fc042d6766dabec60f486174627b948554b9fcb714c8a0f66fe87e82463';
const RECOVERY_TWO = '7c0ad697abd50c483febd3c53411e422fd2374ff93ca3573ddd19190314127f4';
/** One of the ids the payment's submit could have answered with. */
const PAYMENT_ID = '00628580c6cbf9e37a0452a07e38b8fb8c897fb5af52da0f999d382069405e6b6b';

function action(typename: string, entryPoint: string | null, hash: string, timestamp: number) {
  return {
    __typename: typename,
    ...(entryPoint === null ? {} : { entryPoint }),
    transaction: { hash, block: { timestamp }, transactionResult: { status: 'SUCCESS' } },
  };
}

/** Newest first, as the indexer answers. */
const ANSWER = {
  data: {
    contract: {
      actions: [
        action('ContractCall', 'rotate_enc_key_with_jubjub', '8e1447d99d240f6bc7944e444affbadea9ccf368140315d7bf6e52f9148e3550', 1790486976000),
        action('ContractCall', 'add_device_with_k256', RECOVERY_TWO, 1790486916000),
        action('ContractCall', 'withdraw_shielded_to_contract_with_jubjub', PAYMENT, 1790486736001),
        action('ContractCall', 'rotate_enc_key_with_jubjub', '67df73dd75c1782f1287b5bd4f67a22c627c31c58161a2654a1fde85c9741ec0', 1790486628000),
        action('ContractCall', 'add_device_with_k256', RECOVERY_ONE, 1790486574000),
        action('ContractCall', 'add_device_with_jubjub', WAY_BACK, 1790485458000),
        action('ContractUpdate', null, 'b6314b1deb5979ea151795e99f0f7b9daa697ebcece7b1d79ecf427ef172d964', 1790485206001),
        action('ContractCall', 'deposit_shielded', MUSD_GRANT, 1790485206001),
        action('ContractUpdate', null, '54c6e3a2834e6815243d3863c817c1eb9e9b2660fd7a80ea18e963f57ffaa7e3', 1790485182000),
        action('ContractCall', 'deposit_unshielded', NIGHT_GRANT, 1790485170001),
        action('ContractUpdate', null, '395ac5bf35c0a680a1caeae4208612d5144c33cbe02412acad83347f733672e8', 1790485158001),
        action('ContractCall', 'activate_initial_device_with_jubjub', ACTIVATE, 1790485134000),
        action('ContractDeploy', null, DEPLOY, 1790485092000),
      ],
    },
  },
};

const HISTORY = custodyActionRowsFrom(ANSWER) as CustodyActionRow[];

/** What the change walk learnt about the payment: 100 spent, 23 sent, 77 found. */
const WALKED: CustodyChangeStep = {
  txHash: PAYMENT,
  colour: MUSD_COLOUR_HEX,
  spentValue: 100n,
  outcome: 'change',
  change: { nonce: '9b'.repeat(32), value: 77n, mtIndex: 4706n },
  sent: 23n,
  found: true,
};

const PAYMENT_FACTS: CustodyTransactionFacts = { inputs: [], outputs: [], identifiers: [PAYMENT_ID], whole: true };

function input(overrides: Partial<CustodyChainActivityInput> = {}): CustodyChainActivityInput {
  return {
    actions: HISTORY,
    network: 'stagenet',
    facts: new Map([[PAYMENT, PAYMENT_FACTS]]),
    steps: new Map([['7f'.repeat(32), WALKED]]),
    notes: [{ colour: MUSD_COLOUR_HEX, value: 100n, txHash: MUSD_GRANT }],
    witnessed: false,
    describe: (colour) => describeColour(colour),
    ...overrides,
  };
}

const at = (ms: number): string => new Date(ms).toISOString();

/* -------------------------------------------------------------------------- */
/* The rows                                                                   */
/* -------------------------------------------------------------------------- */

describe('the rows a Passport’s history reads back as', () => {
  it('are the Android account’s whole history, at the times it happened, each with its View link', () => {
    const rows = custodyChainActivity(input());
    expect(rows.map((row) => [row.label, row.createdAt, row.txHash])).toEqual([
      ['Passport created', at(1790485092000), DEPLOY],
      ['Your account is set up', at(1790485134000), ACTIVATE],
      ['Opening balance deposited', at(1790485170001), NIGHT_GRANT],
      ['Stablecoin deposited', at(1790485206001), MUSD_GRANT],
      ['Way back added', at(1790485458000), WAY_BACK],
      ['Another device was added', at(1790486574000), RECOVERY_ONE],
      ['Sent 23 mUSD', at(1790486736001), PAYMENT],
      ['Found 77 mUSD of change', at(1790486736001), PAYMENT],
      ['This device was added', at(1790486916000), RECOVERY_TWO],
    ]);
    /* The times are the blocks', in the reader's own zone on screen: 05:25:36
       UTC for the payment, which is what the explorer says. */
    expect(rows.find((row) => row.kind === 'sent')?.createdAt).toBe('2026-09-27T05:25:36.001Z');
    /* The opening mUSD says how much, from the note. */
    expect(rows[3].detail).toBe('Your opening 100 mUSD arrived, paid for on your behalf.');
    expect(rows.map((row) => row.milestone)).toEqual([
      'created',
      'activated',
      'opening-night',
      'opening-stablecoin',
      null,
      null,
      null,
      null,
      null,
    ]);
    /* Every one is a transaction, and every one carries the explorer link the
       rest of the trail does — the same URL Home builds from the hash. */
    for (const row of rows) {
      expect(row.href).toBe(`https://explorer.1am.xyz/tx/${row.txHash}?network=stagenet`);
      expect(row.href).toBe(custodyExplorerLink(row.txHash, 'stagenet'));
      expect(row.href).toBe(explorerTxUrl('stagenet', row.txHash));
      expect(row.id).toBe(`${RESTORED_ACTIVITY_PREFIX}${row.kind}:${row.txHash}`);
      expect(row.status).toBe('complete');
    }
    /* The payment carries the ids this device would have written it under. */
    expect(rows.find((row) => row.kind === 'sent')?.identifiers).toEqual([PAYMENT_ID]);
  });

  it('never names the machinery', () => {
    const said = custodyChainActivity(input())
      .flatMap((row) => [row.label, row.detail])
      .join(' ')
      .toLowerCase();
    for (const forbidden of ['wallet address', 'dust', 'contract', 'registry', 'indexer', 'resolver', 'sponsor', 'sdk', 'dynamic']) {
      expect(said).not.toContain(forbidden);
    }
  });

  it('calls every addition another device’s on the device that saw the Passport made', () => {
    const rows = custodyChainActivity(input({ witnessed: true }));
    expect(rows.filter((row) => row.kind === 'device').map((row) => row.label)).toEqual([
      'Another device was added',
      'Another device was added',
    ]);
  });

  it('says what it knows of a payment and no more', () => {
    const sent = (overrides: Partial<CustodyChainActivityInput>) =>
      custodyChainActivity(input(overrides)).filter((row) => row.kind === 'sent' || row.kind === 'change');
    /* The colour, and not the amount, when the search could not say. */
    expect(sent({ steps: new Map([['7f'.repeat(32), { ...WALKED, outcome: 'unknown', change: null, sent: null, found: false }]]) }).map((row) => row.label)).toEqual(['Sent mUSD']);
    /* Neither, when no coin it spent is described on this device. */
    expect(sent({ steps: new Map() }).map((row) => row.label)).toEqual(['Payment sent']);
    /* A change this device already held is not "found". */
    expect(sent({ steps: new Map([['7f'.repeat(32), { ...WALKED, found: false }]]) }).map((row) => row.label)).toEqual(['Sent 23 mUSD']);
    /* And nothing until the payment's ids are known, so this device's own row cannot be doubled. */
    expect(sent({ facts: new Map() })).toEqual([]);
  });

  it('reads NIGHT sent from the account, and a payment received from its note', () => {
    const OUT = 'ee'.repeat(32);
    const IN = 'dd'.repeat(32);
    const QUIET = 'cc'.repeat(32);
    const rows = custodyChainActivity(
      input({
        actions: [
          ...HISTORY,
          { kind: 'ContractCall', entryPoint: 'withdraw_unshielded_with_jubjub', txHash: OUT, status: 'SUCCESS', at: 1790487000000 },
          { kind: 'ContractCall', entryPoint: 'deposit_shielded', txHash: IN, at: 1790487060000 },
          { kind: 'ContractCall', entryPoint: 'deposit_shielded', txHash: QUIET, at: 1790487120000 },
        ],
        facts: new Map([
          [PAYMENT, PAYMENT_FACTS],
          [OUT, { inputs: [], outputs: [], identifiers: [], whole: true }],
        ]),
        notes: [
          { colour: MUSD_COLOUR_HEX, value: 100n, txHash: MUSD_GRANT },
          { colour: MUSD_COLOUR_HEX, value: 10n, txHash: IN.toUpperCase() },
          { colour: MUSD_COLOUR_HEX, value: 3n, txHash: null },
        ],
      }),
    );
    expect(rows.slice(-2).map((row) => [row.kind, row.label, row.detail])).toEqual([
      ['sent', 'Sent NIGHT', 'It left your Passport.'],
      ['received', 'Received 10 mUSD', 'It arrived in your Passport.'],
    ]);
    expect(describeColour(NIGHT_COLOUR_HEX).symbol).toBe('NIGHT');
  });

  it('places nothing at a time it does not have, and nothing that did not happen', () => {
    const rows = custodyChainActivity(
      input({
        actions: [
          { kind: 'ContractDeploy', entryPoint: null, txHash: DEPLOY },
          { kind: 'ContractCall', entryPoint: 'add_device_with_jubjub', txHash: WAY_BACK, status: 'FAILURE', at: 1 },
          { kind: 'ContractCall', entryPoint: 'add_device_with_jubjub', txHash: 'not a hash', at: 2 },
          { kind: 'ContractCall', entryPoint: null, txHash: 'ab'.repeat(32), at: 3 },
          { kind: null, entryPoint: null, txHash: 'ac'.repeat(32), at: 4 },
          { kind: 'ContractCall', entryPoint: 'add_device_with_jubjub', txHash: 'ad'.repeat(32), status: null, at: 5 },
        ],
      }),
    );
    expect(rows.map((row) => row.txHash)).toEqual(['ad'.repeat(32)]);
    expect(custodyChainActivity(input({ actions: null }))).toEqual([]);
  });

  it('says the opening stablecoin arrived without a figure when no note gives one', () => {
    const [row] = custodyChainActivity(input({ notes: [] })).filter((row) => row.kind === 'opening-stablecoin');
    expect(row.detail).toBe('Your opening stablecoin arrived, paid for on your behalf.');
  });
});

describe('which history row a setup milestone was', () => {
  it('is the first successful, timed one of its kind', () => {
    expect(custodyMilestoneAction('created', HISTORY)?.txHash).toBe(DEPLOY);
    expect(custodyMilestoneAction('activated', HISTORY)?.txHash).toBe(ACTIVATE);
    expect(custodyMilestoneAction('opening-night', HISTORY)?.txHash).toBe(NIGHT_GRANT);
    expect(custodyMilestoneAction('opening-stablecoin', HISTORY)?.txHash).toBe(MUSD_GRANT);
    const later: CustodyActionRow[] = [
      { kind: 'ContractCall', entryPoint: 'deposit_shielded', txHash: 'aa'.repeat(32), status: 'FAILURE', at: 1 },
      { kind: 'ContractCall', entryPoint: 'deposit_shielded', txHash: 'ab'.repeat(32) },
      { kind: 'ContractCall', entryPoint: 'deposit_shielded', txHash: 'ac'.repeat(32), at: 3 },
    ];
    expect(custodyMilestoneAction('opening-stablecoin', later)?.txHash).toBe('ac'.repeat(32));
  });

  it('is nothing for the name, which the account’s history does not hold, or for no history', () => {
    expect(custodyMilestoneAction('named', HISTORY)).toBeNull();
    expect(custodyMilestoneAction('created', null)).toBeNull();
    expect(custodyMilestoneAction('activated', [{ kind: 'ContractCall', entryPoint: null, txHash: DEPLOY, at: 1 }])).toBeNull();
  });
});

describe('the account’s own payments out', () => {
  it('are its successful withdrawals, of either kind, each once', () => {
    expect(
      custodyOutgoingTransactions([
        ...HISTORY,
        { kind: 'ContractCall', entryPoint: 'withdraw_unshielded_with_k256', txHash: 'ee'.repeat(32), at: 1 },
        { kind: 'ContractCall', entryPoint: 'withdraw_unshielded_with_k256', txHash: 'ef'.repeat(32), status: 'FAILURE', at: 2 },
        { kind: 'ContractCall', entryPoint: 'withdraw_shielded_with_jubjub', txHash: PAYMENT.toUpperCase(), at: 3 },
        { kind: 'ContractDeploy', entryPoint: 'withdraw_x', txHash: 'f0'.repeat(32), at: 4 },
        { kind: 'ContractCall', entryPoint: null, txHash: 'f1'.repeat(32), at: 5 },
      ]),
    ).toEqual([PAYMENT, 'ee'.repeat(32)]);
    expect(custodyOutgoingTransactions(null)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Into the trail, once                                                       */
/* -------------------------------------------------------------------------- */

interface Entry extends ActivityFeedEntry {
  source?: string;
}

const make = (row: RestoredActivityRow): Entry => ({
  id: row.id,
  label: row.label,
  detail: row.detail,
  status: row.status,
  createdAt: row.createdAt,
  txHash: row.txHash,
  network: 'stagenet',
  source: 'chain',
});

describe('restored rows, merged into the trail', () => {
  const rows: CustodyChainActivityRow[] = custodyChainActivity(input());

  it('are added newest first, and a second merge changes nothing at all', () => {
    const once = mergeRestoredActivity<Entry>([], rows, make);
    expect(once.map((entry) => entry.label)).toEqual([
      'This device was added',
      'Sent 23 mUSD',
      'Found 77 mUSD of change',
      'Another device was added',
      'Way back added',
      'Stablecoin deposited',
      'Opening balance deposited',
      'Your account is set up',
      'Passport created',
    ]);
    expect(mergeRestoredActivity(once, rows, make)).toBe(once);
    /* Rows restored twice in one pass are one row. */
    expect(mergeRestoredActivity<Entry>([], [rows[0], rows[0]], make)).toHaveLength(1);
  });

  it('never double a payment this device wrote down itself, under its hash or its submit’s id', () => {
    const mine: Entry = {
      id: 'own-send',
      label: 'Sent 23 mUSD to bob.night',
      detail: 'It left your Passport and is on its way.',
      status: 'complete',
      createdAt: at(1790486740000),
      txHash: `0x${PAYMENT_ID.toUpperCase()}`,
    };
    const merged = mergeRestoredActivity<Entry>([mine], rows, make);
    /* Still ONE row, the device's own — and it now carries the ledger hash, so
       its View link goes to the explorer rather than nowhere (2026/09/28). */
    expect(merged.filter((entry) => entry.label.startsWith('Sent'))).toEqual([{ ...mine, txHash: PAYMENT }]);
    /* The change row is its own row, and is still written. */
    expect(merged.some((entry) => entry.label === 'Found 77 mUSD of change')).toBe(true);
    const byHash = mergeRestoredActivity<Entry>([{ ...mine, txHash: PAYMENT }], rows, make);
    expect(byHash.filter((entry) => entry.label.startsWith('Sent'))).toHaveLength(1);
    /* And a second read changes nothing: the hash is already the chain's. */
    expect(mergeRestoredActivity<Entry>(merged, rows, make)).toBe(merged);
  });

  it('put a setup row written at the wrong time at the right one, with its link, rather than writing it again', () => {
    const now = at(1790500000000);
    const written: Entry[] = [
      /* What the recovered phone wrote: no hash, "1 min ago". */
      { id: 'a', label: 'Passport created', detail: 'Your Passport was made on Midnight.', status: 'complete', createdAt: now },
      /* What it wrote once the history was read: the hash, and still the wrong time. */
      { id: 'b', label: 'Opening balance deposited', detail: 'x', status: 'complete', createdAt: now, txHash: NIGHT_GRANT },
      /* A row this device wrote itself for the same transaction, and a different thing. */
      { id: 'c', label: 'Something else', detail: 'y', status: 'complete', createdAt: now, txHash: MUSD_GRANT },
    ];
    const merged = mergeRestoredActivity<Entry>(written, rows, make);
    expect(merged.find((entry) => entry.id === 'a')).toMatchObject({ createdAt: at(1790485092000), txHash: DEPLOY });
    expect(merged.find((entry) => entry.id === 'b')).toMatchObject({ createdAt: at(1790485170001), txHash: NIGHT_GRANT });
    /* That one wins, untouched, and the stablecoin row is not added beside it. */
    expect(merged.find((entry) => entry.id === 'c')).toEqual(written[2]);
    expect(merged.filter((entry) => entry.label === 'Stablecoin deposited')).toEqual([]);
    expect(merged.filter((entry) => entry.label === 'Passport created')).toHaveLength(1);
    expect(merged.filter((entry) => entry.label === 'Opening balance deposited')).toHaveLength(1);
    /* And a row already at the right time is left exactly as it is. */
    const settled = mergeRestoredActivity<Entry>(merged, rows, make);
    expect(settled).toBe(merged);
  });

  it('only correct, where a row is marked as a correction, and never add', () => {
    const corrections = rows.map((row) => ({ ...row, correctOnly: true }));
    expect(mergeRestoredActivity<Entry>([], corrections, make)).toEqual([]);
    const written: Entry = { id: 'a', label: 'Passport created', detail: 'd', status: 'complete', createdAt: 'not a time' };
    const merged = mergeRestoredActivity<Entry>([written], corrections, make);
    expect(merged).toEqual([{ ...written, createdAt: at(1790485092000), txHash: DEPLOY }]);
  });

  it('keep the newest, and put a row whose time cannot be read last', () => {
    const odd: Entry = { id: 'odd', label: 'Odd', detail: '', status: 'complete', createdAt: 'never' };
    const merged = mergeRestoredActivity<Entry>([odd], rows, make, 3);
    expect(merged.map((entry) => entry.label)).toEqual(['This device was added', 'Sent 23 mUSD', 'Found 77 mUSD of change']);
    const all = mergeRestoredActivity<Entry>([odd], rows, make);
    expect(all[all.length - 1]).toBe(odd);
    expect(all).toHaveLength(rows.length + 1);
    expect(ACTIVITY_KEEP).toBe(50);
  });
});
