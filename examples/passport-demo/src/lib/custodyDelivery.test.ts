/**
 * Drills for the delivery walk — the only evidence a sender has that a shielded
 * payment into one of the newer accounts arrived.
 *
 * Every one of these is a case where the wrong answer is a sentence on a screen
 * that is not true: "they were paid" over a payment the network refused, or
 * "not confirmed" over one that is demonstrably there. The walk holds no
 * network and no clock, so all of it is decided here rather than against a
 * chain.
 */

import { describe, expect, it } from 'vitest';

import {
  CUSTODY_INBOX_SCAN_MAX,
  custodyDeliveryOf,
  scanCustodyInbox,
} from './custodyDelivery.js';

/** The bytes a payment sealed. Their content is opaque; only identity matters. */
const OURS = new Uint8Array(192).fill(7);
/** Somebody else's payment, the same length, one byte apart. */
const THEIRS = (() => {
  const other = new Uint8Array(192).fill(7);
  other[191] = 8;
  return other;
})();

/** A reader over a fixed map of position → bytes. Anything else is unreadable. */
const readerOver = (rows: Record<string, Uint8Array>) => (index: bigint) =>
  rows[index.toString()] ?? null;

describe('scanCustodyInbox', () => {
  it('finds our own bytes among the positions that appeared since', () => {
    const read = readerOver({ '4': THEIRS, '5': OURS });
    expect(scanCustodyInbox(read, 4n, 6n, OURS)).toBe('found');
  });

  it('is absent when the list grew but none of the new positions is ours', () => {
    /* THE LIST GROWING IS NOT THE CONFIRMATION. Somebody else paid into the
       same account while ours was refused, and this is the case that used to
       report that refusal as a delivery. */
    const read = readerOver({ '4': THEIRS, '5': THEIRS });
    expect(scanCustodyInbox(read, 4n, 6n, OURS)).toBe('absent');
  });

  it('is absent when the list has not grown at all', () => {
    const read = readerOver({ '0': OURS });
    expect(scanCustodyInbox(read, 3n, 3n, OURS)).toBe('absent');
    /* And where it somehow went backwards, which is an indexer serving an
       older state rather than anything about this payment. */
    expect(scanCustodyInbox(read, 3n, 2n, OURS)).toBe('absent');
  });

  it('is absent when nothing was sealed to look for', () => {
    /* A payment into an account that takes no sealed delivery has nothing of
       its own in the list, and the walk must not confirm on the growth alone. */
    const read = readerOver({ '4': OURS });
    expect(scanCustodyInbox(read, 4n, 5n, null)).toBe('absent');
  });

  it('is unreadable when no new position could be read', () => {
    /* A build that cannot decode the list has said nothing either way, which is
       a different answer from "our payment is not there". */
    expect(scanCustodyInbox(() => null, 4n, 6n, OURS)).toBe('unreadable');
  });

  it('reads at most the capped number of new positions, ending at the last', () => {
    const asked: bigint[] = [];
    const read = (index: bigint): Uint8Array | null => {
      asked.push(index);
      return null;
    };
    /* A list that grew by a thousand while this payment was proving: the walk
       looks at the newest sixty-four and stops, so one confirmation cannot
       become a thousand lookups. */
    scanCustodyInbox(read, 0n, 1_000n, OURS);
    expect(BigInt(asked.length)).toBe(CUSTODY_INBOX_SCAN_MAX);
    expect(asked[0]).toBe(1_000n - CUSTODY_INBOX_SCAN_MAX);
    expect(asked[asked.length - 1]).toBe(999n);
  });

  it('reads every new position when the growth is within the cap', () => {
    const asked: bigint[] = [];
    const read = (index: bigint): Uint8Array | null => {
      asked.push(index);
      return null;
    };
    scanCustodyInbox(read, 10n, 13n, OURS);
    expect(asked).toEqual([10n, 11n, 12n]);
  });

  it('does not mistake a shorter or longer entry for ours', () => {
    /* Length first, because a truncated read that happens to share a prefix
       with our bytes is not our payment. */
    const short = OURS.slice(0, 191);
    expect(scanCustodyInbox(readerOver({ '4': short }), 4n, 5n, OURS)).toBe('absent');
  });

  it('skips a position it cannot read and keeps walking to ours', () => {
    const read = readerOver({ '6': OURS });
    expect(scanCustodyInbox(read, 4n, 7n, OURS)).toBe('found');
  });
});

describe('custodyDeliveryOf', () => {
  it('confirms only on our own bytes', () => {
    expect(custodyDeliveryOf('found')).toBe('delivered');
  });

  it('leaves both kinds of "not found" unconfirmed rather than done', () => {
    /* Neither is a failure, and neither is a delivery. The amount was
       submitted; what is missing is the evidence that it arrived. */
    expect(custodyDeliveryOf('absent')).toBe('unconfirmed');
    expect(custodyDeliveryOf('unreadable')).toBe('unconfirmed');
  });
});
