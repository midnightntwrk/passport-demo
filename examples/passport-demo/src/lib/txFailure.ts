/**
 * WHAT A PARTNER APP — AND THE PERSON LOOKING AT THE APPROVAL SHEET — IS TOLD
 * WHEN A PAYMENT FAILS.
 *
 * WHAT WAS WRONG (2026/09/15). Both approval surfaces answered a failed
 * payment with `transferErrorFrom`, which pairs a code with `messageOf(cause)`
 * — the thrown message, verbatim. So the reply that reached an integrating
 * app, and the line that reached the sheet the person was watching, could read
 *
 *     SubmissionError: 1010: Invalid Transaction: Custom error: 239
 *
 * which names the machinery, quotes a number, and says nothing about the one
 * thing the reader is asking, which is what happened to their money. Worse, it
 * travels: an app renders `detail`, so every partner's user saw it too.
 *
 * WHAT IS TRUE NOW. The CODE still comes from the protocol's fixed vocabulary
 * (`packages/connect/src/protocol/errors.ts`) and is unchanged for every cause
 * that was already mapped — an app that branches on `error` keeps working
 * exactly as it did. The `detail` is drawn from a sentence table and can never
 * be a thrown message: the coded failures get the sentences below, and
 * everything unclassified gets `sendRefusalText` — the same sentence the send
 * panel has shown since 2026/09/03, from the same table, so the two surfaces
 * cannot drift.
 *
 * THE CAUSE IS NOT THROWN AWAY. It is the caller's to `console.debug` with the
 * value itself rather than a string of it, because an error printed as an
 * object keeps its chain and the chain is the whole of what a debugger wants.
 *
 * Nothing here touches the DOM, React, or a wallet. A cause in, a reply out.
 */

import type { PassportTxErrorCode } from '../backend.js';
import { sendRefusalText } from './sendLegs.js';

/** The two fields of a `failed` reply that this module decides. */
export interface AppTxFailure {
  /** The protocol's own word for it. Branched on by apps; never displayed. */
  error: PassportTxErrorCode;
  /** One sentence, for a person. Never a thrown message, ever. */
  detail: string;
}

/**
 * The sentences, one per outcome a person can act on.
 *
 * None of them names a circuit, a contract, a node, or a number, and none of
 * them apologises. Each says what happened to the payment, because that is the
 * only question being asked.
 */
const SIGNING_SESSION_CLOSED =
  'The Passport signing session closed before this could be signed.';
const NOT_ENOUGH =
  'This Passport does not hold enough to cover that payment, so nothing was sent.';
const WRONG_NETWORK =
  'That recipient belongs to a different network from this Passport, so nothing was sent.';
const UNREADABLE_RECIPIENT =
  'Passport could not read that recipient, so nothing was signed.';
const FEES_UNAVAILABLE =
  'Network fees for this payment could not be covered just now — nothing was signed. Try again shortly.';

/** The thrown shape every custody and contract failure carries: `{ code }`. */
function codeOf(cause: unknown): string | null {
  if (typeof cause !== 'object' || cause === null) return null;
  const code = (cause as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/**
 * Maps a payment failure onto the protocol's vocabulary AND onto one sentence.
 *
 * The codes are the ones `transferErrorFrom` already produced, for the same
 * causes, deliberately: they are on the wire and already handled by shipped
 * apps, so changing them would be a breaking change dressed up as a copy fix.
 *
 * `fee-unavailable` is NOT reported as `insufficient-funds`, and this is the
 * one mapping worth defending: the fee payer standing down is not the user
 * running short, and telling an app otherwise puts the shortfall on the wrong
 * party — a user who is never asked to hold fee tokens in the first place, and
 * who has nothing to top up in response. It is a submission that could not be
 * made, which is what `submit-failed` means.
 */
export function txFailureForApp(cause: unknown): AppTxFailure {
  switch (codeOf(cause)) {
    case 'insufficient-night':
      return { error: 'insufficient-funds', detail: NOT_ENOUGH };
    case 'wrong-network':
      return { error: 'network-mismatch', detail: WRONG_NETWORK };
    case 'invalid-recipient':
      return { error: 'invalid-request', detail: UNREADABLE_RECIPIENT };
    /* The signing session went away between the sheet appearing and the
       approval landing, or the session's passkey could not be asserted at all.
       Genuinely unavailable, not a failed submission. The wire word is
       `wallet-unavailable` because that is the versioned protocol's; nothing a
       person reads says "wallet". */
    case 'wallet-closed':
    case 'presence-unavailable':
      return { error: 'wallet-unavailable', detail: SIGNING_SESSION_CLOSED };
    case 'fee-unavailable':
      return { error: 'submit-failed', detail: FEES_UNAVAILABLE };
    default:
      return { error: 'submit-failed', detail: sendRefusalText(cause) };
  }
}
