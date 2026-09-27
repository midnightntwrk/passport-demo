/**
 * A PASSPORT'S ACTIVITY, READ BACK FROM ITS OWN HISTORY ON THE CHAIN, AT THE
 * TIMES IT HAPPENED (2026/09/27).
 *
 * WHY
 * ---
 * Activity is written by the device a thing happens on, as it happens. A
 * Passport brought back on a new phone therefore had none of it, and the
 * screen's milestone observer (`../screens/CustodyPassport.tsx`) filled the gap
 * by writing the setup rows the moment it noticed each was true — "Passport
 * created", "Your account is set up", "Opening balance deposited", all stamped
 * "1 min ago" on a Passport made that morning — and nothing at all for the
 * 23 mUSD another device had sent from it. The account's history says all of
 * it, with each block's time: the delivery walk already reads that history on
 * every read of Home (`../identity/custodyInboxIndex.ts`), and since 2026/09/27
 * it asks for the block time too.
 *
 * WHAT A ROW IS
 * -------------
 * One per transaction that did something a holder would recognise, oldest
 * first, each carrying its transaction's hash — so Home gives it the same View
 * link every other row has, `https://explorer.1am.xyz/tx/<hash>?network=…`
 * ({@link CustodyChainActivityRow.href}) — and the block's time as when it
 * happened. A history row with no time, no hash, or a status other than
 * success is not a row: nothing is placed at a guessed time.
 *
 *   the deploy                                  Passport created
 *   `activate_initial_device_*`                 Your account is set up
 *   the first `deposit_unshielded`              Opening balance deposited
 *   the first `deposit_shielded`                Stablecoin deposited (and how much, from its note)
 *   `add_device_with_jubjub`                    Way back added (this Passport's key added the sign-in)
 *   `add_device_with_k256`                      A device was added by the sign-in — the newest one
 *                                               "This device", on a device that did not see the
 *                                               Passport made (see {@link CustodyChainActivityInput.witnessed})
 *   `withdraw_shielded*`                        Sent 23 mUSD — the amount from the change walk
 *                                               (`../identity/custodyChangeWalk.ts`), else the
 *                                               colour alone, else "Payment sent"
 *   the change a walk found                     Found 77 mUSD of change
 *   `withdraw_unshielded*`                      Sent NIGHT
 *   a later `deposit_shielded` with a note      Received 10 mUSD
 *
 * The name's own registration is not in this list and cannot be: it is a call
 * on the name service, not on the account, so the account's history has no
 * time for it.
 *
 * NOT TWICE
 * ---------
 * Rows are merged by the host (`./activityFeed.ts`,
 * {@link mergeRestoredActivity}): a row this device already has for the same
 * transaction — its own "Sent … to bob.night", written under the id its submit
 * answered with, which is one of {@link CustodyChainActivityRow.identifiers} —
 * wins, and a setup row it wrote at the wrong time is corrected in place rather
 * than written again.
 *
 * THE COPY RULE, as everywhere on this path: no row says wallet address, DUST,
 * contract, registry, indexer, resolver, sponsor, SDK, or the name of any
 * sign-in vendor, and `./custodyChainActivity.test.ts` asserts it. No React, no
 * storage, no network: values in, rows out.
 */

import { custodyExplorerLink } from '../identity/custodyContractPlan.js';
import type { CustodyActionRow } from '../identity/custodyInboxIndex.js';
import type { CustodyChangeStep } from '../identity/custodyChangeWalk.js';
import type { CustodyTransactionFacts } from '../identity/custodySpentCoins.js';
import { NIGHT_COLOUR_HEX, normalisedColourHex } from './colour.js';
import { formatCustodyAmount } from './custodyAssets.js';
import { custodyMilestoneEntry, type CustodyMilestone } from './custodyHome.js';

/** What a row records. */
export type CustodyChainActivityKind =
  | 'created'
  | 'activated'
  | 'opening-night'
  | 'opening-stablecoin'
  | 'way-back'
  | 'device'
  | 'sent'
  | 'change'
  | 'received';

/** One row, ready for the host's trail. */
export interface CustodyChainActivityRow {
  /** `chain:<kind>:<hash>` — the same row every time it is rebuilt. */
  readonly id: string;
  readonly kind: CustodyChainActivityKind;
  readonly label: string;
  readonly detail: string;
  readonly status: 'complete';
  /** The ledger hash of the transaction, lowercase. */
  readonly txHash: string;
  /** The other ids the same transaction is known by — what a submit answers with. */
  readonly identifiers: readonly string[];
  /** When its block was made, ISO-8601. */
  readonly createdAt: string;
  /**
   * The explorer page Home's View link opens for it — {@link
   * custodyExplorerLink}, which is the URL `explorerTxUrl` builds from the
   * row's hash and network; the test holds the two to each other.
   */
  readonly href: string;
  /** The setup milestone it is, for the rows the milestone observer also writes. */
  readonly milestone: CustodyMilestone | null;
}

/** Everything the rows are built from. Every field is read, never inferred. */
export interface CustodyChainActivityInput {
  /** The account's history, oldest first, as the delivery walk read it — null when it could not. */
  readonly actions: readonly CustodyActionRow[] | null;
  /** The network the Passport is on: what the View links are built for. */
  readonly network: string;
  /** What each of the account's own payments was read to say, by hash. */
  readonly facts: ReadonlyMap<string, CustodyTransactionFacts>;
  /** What the change walk learnt, by the coin each payment spent. */
  readonly steps: ReadonlyMap<string, CustodyChangeStep>;
  /** The notes this device can open, each with the transaction that wrote it. */
  readonly notes: readonly { readonly colour: string; readonly value: bigint; readonly txHash: string | null }[];
  /**
   * Whether this device saw the Passport made — its record carries the setup's
   * hashes. A device that did not came to it through a sign-in, and the newest
   * device the sign-in added is this one.
   */
  readonly witnessed: boolean;
  /** How to name a colour (`./colour.ts`, `describeColour`). */
  readonly describe: (colour: string) => { readonly symbol: string; readonly decimals: number };
}

/** A successful call with a hash and a time — the only kind of history row that becomes a row. */
function placed(row: CustodyActionRow): { hash: string; at: number } | null {
  if (row.status !== undefined && row.status !== null && row.status !== 'SUCCESS') return null;
  const hash = normalisedColourHex(row.txHash);
  return hash === null || row.at === undefined ? null : { hash, at: row.at };
}

/**
 * The history row a setup milestone was, or null where the history has none —
 * the deploy, the first activation, the first NIGHT deposit, the first
 * stablecoin deposit, each only as a successful, timed row.
 */
export function custodyMilestoneAction(
  milestone: CustodyMilestone,
  actions: readonly CustodyActionRow[] | null,
): CustodyActionRow | null {
  if (actions === null) return null;
  const matches = (row: CustodyActionRow): boolean => {
    if (milestone === 'created') return row.kind === 'ContractDeploy';
    if (row.kind !== 'ContractCall') return false;
    const entryPoint = row.entryPoint ?? '';
    if (milestone === 'activated') return entryPoint.startsWith('activate_initial_device');
    if (milestone === 'opening-night') return entryPoint === 'deposit_unshielded';
    if (milestone === 'opening-stablecoin') return entryPoint === 'deposit_shielded';
    return false;
  };
  const found = actions.find((row) => matches(row) && placed(row) !== null);
  return found ?? null;
}

/**
 * The account's own payments out, oldest first and each once: every successful
 * `withdraw_*` call, shielded and not. Their identifiers are what keeps a
 * payment this device made from being written twice, so they are read before
 * the rows are built.
 */
export function custodyOutgoingTransactions(actions: readonly CustodyActionRow[] | null): string[] {
  if (actions === null) return [];
  const hashes: string[] = [];
  for (const row of actions) {
    if (row.kind !== 'ContractCall' || !(row.entryPoint ?? '').startsWith('withdraw_')) continue;
    const at = placed(row);
    if (at !== null && !hashes.includes(at.hash)) hashes.push(at.hash);
  }
  return hashes;
}

/**
 * THE ROWS: the account's history, as a holder would describe it, at the
 * times it happened. See the header for each row and every rule.
 */
export function custodyChainActivity(input: CustodyChainActivityInput): CustodyChainActivityRow[] {
  const actions = input.actions ?? [];
  const rows: CustodyChainActivityRow[] = [];
  const add = (
    kind: CustodyChainActivityKind,
    at: { hash: string; at: number },
    text: { label: string; detail: string },
    milestone: CustodyMilestone | null = null,
    identifiers: readonly string[] = [],
  ): void => {
    rows.push({
      id: `chain:${kind}:${at.hash}`,
      kind,
      label: text.label,
      detail: text.detail,
      status: 'complete',
      txHash: at.hash,
      identifiers,
      createdAt: new Date(at.at).toISOString(),
      href: custodyExplorerLink(at.hash, input.network),
      milestone,
    });
  };
  const figure = (colour: string, amount: bigint): string => {
    const named = input.describe(colour);
    return `${formatCustodyAmount(amount, named.decimals)} ${named.symbol}`;
  };
  const noteFor = (hash: string) =>
    input.notes.find((note) => normalisedColourHex(note.txHash) === hash) ?? null;
  const stepFor = (hash: string): CustodyChangeStep | null =>
    [...input.steps.values()].find((step) => step.txHash === hash) ?? null;

  /* The setup milestones, each at most once. */
  const milestones = ['created', 'activated', 'opening-night', 'opening-stablecoin'] as const;
  const milestoneRows = new Map<string, (typeof milestones)[number]>();
  for (const milestone of milestones) {
    const row = custodyMilestoneAction(milestone, actions);
    if (row !== null) milestoneRows.set(normalisedColourHex(row.txHash) as string, milestone);
  }

  /* The newest sign-in addition, which is this device on one that came by it. */
  const additions = actions.filter(
    (row) => row.kind === 'ContractCall' && row.entryPoint === 'add_device_with_k256' && placed(row) !== null,
  );
  const thisDevice = input.witnessed ? null : (additions[additions.length - 1] ?? null);

  for (const row of actions) {
    const at = placed(row);
    if (at === null) continue;
    const milestone = milestoneRows.get(at.hash);
    if (milestone !== undefined) {
      const note = milestone === 'opening-stablecoin' ? noteFor(at.hash) : null;
      const entry = custodyMilestoneEntry(milestone);
      add(
        milestone,
        at,
        {
          label: entry.label,
          detail:
            note === null
              ? entry.detail
              : `Your opening ${figure(note.colour, note.value)} arrived, paid for on your behalf.`,
        },
        milestone,
      );
      continue;
    }
    if (row.kind !== 'ContractCall') continue;
    const entryPoint = row.entryPoint ?? '';
    if (entryPoint === 'add_device_with_jubjub') {
      add('way-back', at, {
        label: 'Way back added',
        detail: 'You can bring this Passport back by signing in.',
      });
    } else if (entryPoint === 'add_device_with_k256') {
      add(
        'device',
        at,
        row === thisDevice
          ? { label: 'This device was added', detail: 'Your sign-in brought this Passport here.' }
          : { label: 'Another device was added', detail: 'Your sign-in brought this Passport to another device.' },
      );
    } else if (entryPoint.startsWith('withdraw_')) {
      /* Only once the payment's ids are known: without them a payment this
         device made and wrote down itself would be written again. */
      const fact = input.facts.get(at.hash);
      if (fact === undefined) continue;
      const shielded = entryPoint.startsWith('withdraw_shielded');
      const step = shielded ? stepFor(at.hash) : null;
      const label = !shielded
        ? `Sent ${input.describe(NIGHT_COLOUR_HEX).symbol}`
        : step === null
          ? 'Payment sent'
          : step.sent === null
            ? `Sent ${input.describe(step.colour).symbol}`
            : `Sent ${figure(step.colour, step.sent)}`;
      add('sent', at, { label, detail: 'It left your Passport.' }, null, fact.identifiers);
      if (step !== null && step.found && step.change !== null) {
        add('change', at, {
          label: `Found ${figure(step.colour, step.change.value)} of change`,
          detail: 'What was left after that payment, now counted on this device.',
        });
      }
    } else if (entryPoint === 'deposit_shielded') {
      const note = noteFor(at.hash);
      if (note !== null) {
        add('received', at, {
          label: `Received ${figure(note.colour, note.value)}`,
          detail: 'It arrived in your Passport.',
        });
      }
    }
  }
  return rows;
}
