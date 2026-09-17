/**
 * DID THE SHIELDED AMOUNT ACTUALLY REACH THE PERSON IT WAS SENT TO?
 *
 * WHY THIS IS NOT THE USUAL QUESTION
 * ----------------------------------
 * A payment into one of the prototype accounts can be checked by reading that
 * account's balance back: it mirrors what it holds, so "is it bigger by the
 * amount" is a complete answer. The newer account keeps NO such mirror for
 * shielded value — the coin's description never reaches public state, which is
 * the whole point of it — so there is nothing to read back and a sender has to
 * confirm the payment out of something else.
 *
 * What it confirms out of is the 192-byte container the payment carried. The
 * sender seals the coin's description to the recipient's published key, the
 * call writes those exact bytes into the recipient's public list of deliveries,
 * and nothing else in the world can produce them. So the sender keeps the bytes
 * it sealed and looks for them.
 *
 * THE LIST GROWING IS NOT THE ANSWER, and that is the correction this module
 * exists to hold. The list grows for every payment anybody makes into that
 * account and for the change of every payment its holder makes out of it, so
 * "it is one longer than it was" is satisfied by a stranger's transaction while
 * ours was refused. Only OUR bytes, at one of the positions that appeared
 * since, say our payment landed.
 *
 * THREE ANSWERS AND NOT TWO. "Not there" and "could not be read at all" are
 * both "we did not find it", and they mean opposite things about what may be
 * concluded: the first is a list that was walked and did not hold our delivery,
 * which is a fact about this payment; the second is a list this build could not
 * walk, which is a fact about the reader and says nothing either way. Neither
 * is reported as delivered — see {@link custodyDeliveryOf}.
 *
 * Pure by construction: an injected reader, two positions, and the bytes. It
 * holds no network, no clock, and no contract, which is why the rule can be
 * drilled to the branch rather than argued about. The reference this mirrors is
 * the sponsor's own `scanInboxForEntry`.
 */

/**
 * How far back through new positions one confirmation will look.
 *
 * Bounded twice: by how much the list actually grew, so a long-lived account is
 * never walked end to end, and by this, so a burst of somebody else's traffic
 * cannot turn one confirmation into thousands of lookups. Sixty-four is the
 * sponsor's figure, kept identical so the two confirmations mean the same thing.
 */
export const CUSTODY_INBOX_SCAN_MAX = 64n;

/** What a walk of the new positions found. */
export type CustodyInboxScan = 'found' | 'absent' | 'unreadable';

/** What a sender may honestly say about a payment it has submitted. */
export type CustodyDelivery = 'delivered' | 'unconfirmed';

/**
 * Whether one of the positions that appeared since `before` holds `entry`.
 *
 * The positions are SCANNED rather than assumed, because the next one is not
 * ours to reserve: another payment can take the position ours was built for,
 * and ours is still perfectly good one along.
 *
 * `read` answers null for a position it cannot read. A walk in which no new
 * position could be read at all is `unreadable`; a walk that read positions and
 * found none of them ours is `absent`. A payment that sealed nothing has
 * nothing to look for, and that is `absent` rather than an invitation to
 * confirm on weaker evidence.
 */
export function scanCustodyInbox(
  read: (index: bigint) => Uint8Array | null,
  before: bigint,
  observed: bigint,
  entry: Uint8Array | null,
): CustodyInboxScan {
  if (entry === null || observed <= before) return 'absent';
  const last = observed - 1n;
  const first = observed - before > CUSTODY_INBOX_SCAN_MAX ? last - (CUSTODY_INBOX_SCAN_MAX - 1n) : before;
  let readAny = false;
  for (let index = first; index <= last; index += 1n) {
    const found = read(index);
    if (found === null) continue;
    readAny = true;
    if (sameEntryBytes(found, entry)) return 'found';
  }
  return readAny ? 'absent' : 'unreadable';
}

/**
 * What a walk lets the sender say.
 *
 * ONLY OUR OWN BYTES CONFIRM. The sponsor allows one weaker fallback — where
 * the list could not be walked at all, it accepts the payment's transaction
 * reaching a block — and this deliberately does not: reaching a block is where
 * a transaction was processed and never whether it was accepted there, and a
 * sender telling somebody their money arrived on that evidence would be making
 * a claim it cannot support. `unconfirmed` is not a failure and must not be
 * shown as one: the amount was submitted and may well be there already.
 */
export function custodyDeliveryOf(scan: CustodyInboxScan): CustodyDelivery {
  return scan === 'found' ? 'delivered' : 'unconfirmed';
}

/** Byte for byte, length first. */
function sameEntryBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}
