/**
 * The second hundred mUSD, and what stops it.
 *
 * `fundAsset` submits `deposit_shielded` and then watches for the credit for up
 * to ninety seconds (180 attempts, 500 ms apart) before it resolves, and the
 * caller writes its journal row from what it returns. A restart inside that
 * window — a deploy, the watchdog, an operator — leaves the deposit on chain
 * and nothing on disk naming it.
 *
 * ON A PROTOTYPE ACCOUNT THE CHAIN COVERS FOR THAT. The next `/fund-account`
 * reads `coins[mUSD]`, sees the grant already there, and `activationLegs`
 * answers `assetNeeded: false`. ON A CUSTODY ACCOUNT NOTHING COVERS FOR IT:
 * shielded custody is stateless (MIP-0012 §6.1), so `balances()` answers null
 * for the asset, the endpoint reads that as zero, and the retry mints and
 * deposits a SECOND hundred mUSD into an account that already holds one.
 *
 * The fix is `FundAssetOptions.onDepositSubmitted`: the two hashes are handed
 * over the moment the deposit is submitted, and the endpoint persists a
 * provisional row — no `balanceAfter`, because nothing has been read — before
 * the wait begins. What these cases pin is that chain: callback → journal →
 * `activationLegs`, on both builds, with the pre-fix behaviour asserted beside
 * it so the difference is legible.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { activationLegs, type LedgerEntryLike } from '../src/activationLegs.js';
import type { AssetDepositSubmitted, FundAssetOptions } from '../src/account.js';
import type { AccountAssetEntry, AccountEntry } from '../src/ledgers.js';

const ADDRESS = '9448e16665d0aa3ef103ff2eff5ca50694d44318d8a9c66998b8d57927755c11';
const GRANT = 100n;
const NIGHT_GRANT = 2000n;

/** The journal, as much of it as this question needs. */
function journal() {
  const rows = new Map<string, AccountEntry>();
  return {
    rows,
    get: (key: string): AccountEntry | null => rows.get(key) ?? null,
    record: (key: string, entry: AccountEntry): Promise<void> => {
      rows.set(key, entry);
      return Promise.resolve();
    },
  };
}

/**
 * The endpoint's asset leg, reduced to the two writes that matter: the
 * provisional one from the callback, and the confirmed one from the return.
 */
async function assetLeg(
  ledger: ReturnType<typeof journal>,
  fundAsset: (address: string, options?: FundAssetOptions) => Promise<AccountAssetEntry>,
): Promise<'confirmed' | 'restarted'> {
  try {
    const confirmed = await fundAsset(ADDRESS, {
      onDepositSubmitted: async (submitted: AssetDepositSubmitted) => {
        await ledger.record(ADDRESS, {
          at: submitted.at,
          asset: {
            symbol: 'mUSD',
            colourHex: submitted.colourHex,
            amount: submitted.amount.toString(),
            mintTx: submitted.mintTxHash,
            depositTx: submitted.depositTxHash,
            at: submitted.at,
          },
        });
      },
    });
    await ledger.record(ADDRESS, { at: confirmed.at, asset: confirmed });
    return 'confirmed';
  } catch {
    /* The process went away between the submit and the confirmation. */
    return 'restarted';
  }
}

const SUBMITTED: AssetDepositSubmitted = {
  mintTxHash: 'a'.repeat(64),
  depositTxHash: 'b'.repeat(64),
  amount: GRANT,
  colourHex: '1a'.repeat(32),
  at: '2026-09-18T17:30:00.000Z',
};

/** A deposit that is submitted and then never confirms, because we stopped. */
const restartedDuringConfirm = async (
  _address: string,
  options?: FundAssetOptions,
): Promise<AccountAssetEntry> => {
  await options?.onDepositSubmitted?.(SUBMITTED);
  throw new Error('SIGTERM — the process stopped while the credit was being watched for');
};

/** The same deposit, with the pre-fix contract: nothing is said until the end. */
const restartedWithNoCallback = (): Promise<AccountAssetEntry> =>
  Promise.reject(
    new Error('SIGTERM — the process stopped while the credit was being watched for'),
  );

const legsFor = (previous: LedgerEntryLike | null, heldAsset: bigint) =>
  activationLegs({
    previous,
    heldNight: NIGHT_GRANT,
    heldAsset,
    assetSupported: true,
    grantAtomic: NIGHT_GRANT,
    assetGrant: GRANT,
  });

describe('a restart between the asset deposit and its confirmation', () => {
  it('leaves a row naming both transactions, and no balance, because none was read', async () => {
    const ledger = journal();
    assert.equal(await assetLeg(ledger, restartedDuringConfirm), 'restarted');
    const row = ledger.get(ADDRESS)?.asset;
    assert.ok(row, 'the deposit was submitted and nothing recorded it');
    assert.equal(row.mintTx, SUBMITTED.mintTxHash);
    assert.equal(row.depositTx, SUBMITTED.depositTxHash);
    assert.equal(row.amount, '100');
    /* PROVISIONAL, and it says so by what it omits. A row carrying a balance
       would be recording a number nobody has read. */
    assert.equal(row.balanceAfter, undefined);
  });

  it('makes the retry pay nothing more, on a CUSTODY account, where the chain cannot help', async () => {
    const ledger = journal();
    await assetLeg(ledger, restartedDuringConfirm);
    /* Zero is what the endpoint passes for a custody account: `balances()`
       answers null — custody there is stateless — and null reads as zero. So
       the row is the only thing standing between this account and a second
       hundred mUSD. */
    assert.equal(legsFor(ledger.get(ADDRESS), 0n).assetNeeded, false);
  });

  it('is what the pre-fix behaviour got wrong, and this is the second grant', async () => {
    const ledger = journal();
    assert.equal(await assetLeg(ledger, restartedWithNoCallback), 'restarted');
    assert.equal(ledger.get(ADDRESS), null, 'nothing was recorded, which was the defect');
    /* The same retry, against the same account, with the same coin already on
       chain — and the endpoint mints and deposits another. */
    assert.equal(legsFor(ledger.get(ADDRESS), 0n).assetNeeded, true);
  });

  it('never mattered on a prototype account, whose own coins map answers', async () => {
    const ledger = journal();
    await assetLeg(ledger, restartedWithNoCallback);
    /* A prototype account mirrors its shielded holding, so the retry reads the
       grant off the chain and stops there whatever the journal says. That is
       why this defect could exist for as long as it did. */
    assert.equal(legsFor(ledger.get(ADDRESS), GRANT).assetNeeded, false);
  });

  it('is replaced by the confirmed row when nothing goes wrong', async () => {
    const ledger = journal();
    const confirmed = async (
      _address: string,
      options?: FundAssetOptions,
    ): Promise<AccountAssetEntry> => {
      await options?.onDepositSubmitted?.(SUBMITTED);
      return {
        symbol: 'mUSD',
        colourHex: SUBMITTED.colourHex,
        amount: '100',
        mintTx: SUBMITTED.mintTxHash,
        depositTx: SUBMITTED.depositTxHash,
        balanceAfter: '100',
        at: '2026-09-18T17:31:00.000Z',
      };
    };
    assert.equal(await assetLeg(ledger, confirmed), 'confirmed');
    /* One row, the confirmed one, carrying the reading the provisional had not
       got. Two writes to one key, not two rows. */
    assert.equal(ledger.rows.size, 1);
    assert.equal(ledger.get(ADDRESS)?.asset?.balanceAfter, '100');
    assert.equal(legsFor(ledger.get(ADDRESS), 0n).assetNeeded, false);
  });
});
