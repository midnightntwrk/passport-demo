/**
 * THE WINDOW THE DELIVERY WALK LOOKS IN, over positions nobody wrote out.
 *
 * WHAT THIS PROTECTS. `scanCustodyInbox` decides whether a sender is told
 * somebody was paid, and the decision is arithmetic: which positions appeared
 * since the seal was made, and which of those the cap allows looking at. An
 * off-by-one at either end is a sentence that is not true — "they have it" over
 * a payment the network refused, or "not confirmed" over one that is plainly
 * there and one position outside the window.
 *
 * `./custodyDelivery.test.ts` names each case. This file states the rule and
 * holds it against six hundred generated walks, with a seeded mulberry32 so a
 * failure names a seed that can be re-run. No new dependency.
 */

import { describe, expect, it } from 'vitest';

import {
  CUSTODY_INBOX_SCAN_MAX,
  custodyDeliveryOf,
  scanCustodyInbox,
} from './custodyDelivery.js';

/** The bytes one payment sealed. Opaque; only identity matters. */
const OURS = new Uint8Array(192).fill(7);

/** Somebody else's, sharing every byte but the last. */
const NEARLY = (() => {
  const other = new Uint8Array(192).fill(7);
  other[191] ^= 1;
  return other;
})();

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

describe('the positions a walk looks at', () => {
  for (const seed of [5, 23]) {
    it(`confirms exactly when our bytes are inside the window, and never outside it (seed ${seed})`, () => {
      const random = mulberry32(seed);

      for (let run = 0; run < 300; run += 1) {
        const before = BigInt(Math.floor(random() * 500));
        const growth = BigInt(Math.floor(random() * 200));
        const observed = before + growth;
        /* Where our entry sits, which may be outside the window on purpose. */
        const at = BigInt(Math.floor(random() * Number(observed + 5n)));

        const readable = random() < 0.9;
        const rows = new Map<string, Uint8Array>();
        for (let index = 0n; index < observed; index += 1n) {
          rows.set(index.toString(), NEARLY);
        }
        rows.set(at.toString(), OURS);
        const read = (index: bigint): Uint8Array | null =>
          readable ? (rows.get(index.toString()) ?? null) : null;

        /* THE RULE, stated rather than walked: the walk reads the positions
           that appeared since the seal, capped to the most recent
           CUSTODY_INBOX_SCAN_MAX of them, and confirms only on our own bytes
           at one of those positions. */
        const last = observed - 1n;
        const first =
          observed - before > CUSTODY_INBOX_SCAN_MAX ? last - (CUSTODY_INBOX_SCAN_MAX - 1n) : before;
        const inWindow = observed > before && at >= first && at <= last;
        const expected = observed <= before ? 'absent' : inWindow && readable ? 'found' : readable ? 'absent' : 'unreadable';

        const scan = scanCustodyInbox(read, before, observed, OURS);
        expect(scan, `seed ${seed}, run ${run}: before ${before}, observed ${observed}, at ${at}`).toBe(
          expected,
        );
        /* And only `found` ever lets a sender say somebody was paid. */
        expect(custodyDeliveryOf(scan)).toBe(scan === 'found' ? 'delivered' : 'unconfirmed');
      }
    });
  }

  it('looks at the first new position and at the last, and not one beyond either', () => {
    const rows = (at: bigint): ((index: bigint) => Uint8Array | null) => {
      const map = new Map<string, Uint8Array>([[at.toString(), OURS]]);
      return (index) => map.get(index.toString()) ?? NEARLY;
    };
    /* Positions 4 and 5 appeared; 3 was there before and 6 does not exist. */
    expect(scanCustodyInbox(rows(4n), 4n, 6n, OURS)).toBe('found');
    expect(scanCustodyInbox(rows(5n), 4n, 6n, OURS)).toBe('found');
    expect(scanCustodyInbox(rows(3n), 4n, 6n, OURS)).toBe('absent');
    expect(scanCustodyInbox(rows(6n), 4n, 6n, OURS)).toBe('absent');
  });

  it('keeps a burst of somebody else’s traffic from turning one walk into thousands', () => {
    const looked: bigint[] = [];
    const read = (index: bigint): Uint8Array | null => {
      looked.push(index);
      return NEARLY;
    };
    expect(scanCustodyInbox(read, 0n, 5_000n, OURS)).toBe('absent');
    expect(BigInt(looked.length)).toBe(CUSTODY_INBOX_SCAN_MAX);
    /* Ending at the last position, because the newest entries are where a
       payment made moments ago would be. */
    expect(looked.at(-1)).toBe(4_999n);
  });
});
