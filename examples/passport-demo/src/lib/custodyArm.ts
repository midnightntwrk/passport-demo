/**
 * WHICH KIND OF PASSPORT THE ACCOUNT CUSTODY SCREEN IS SHOWING.
 *
 * WHAT THIS IS FOR
 * ----------------
 * One screen drives the whole account custody flow — set up in waves, activate,
 * claim a `.night` name, read what the Passport holds, come back by name, pay
 * somebody — and that flow is the same for both arms of the contract. What
 * differs is only who is holding the Passport:
 *
 *   a SOCIAL SIGN-IN holds a secp256k1 key inside a vendor. The point has to be
 *   recovered from two signatures, every approval is a round trip over a
 *   socket, and the Passport is named by the embedded address.
 *
 *   a PASSKEY holds a JubJub scalar derived from its own PRF output. There is
 *   no vendor and no address; the signer is built once from a contract root and
 *   signs synchronously, and the Passport is named by its own device point.
 *
 * An adapter is those differences and nothing else. The screen asks it for a
 * device and a name, and asks the custody layer for everything else.
 *
 * WHY THE SCREEN DOES NOT SIMPLY ASK "WHICH ARM"
 * ----------------------------------------------
 * Because the answer is needed before the arm is known. A passkey's device
 * point costs a user-verified assertion, and the screen has to render — the
 * header, the setup step, the stored record — before anybody has touched an
 * authenticator. So the adapter carries a `userKey` it may already know (from
 * the pointer a previous visit wrote) and a `ensureIdentity` that settles it
 * when a ceremony is actually warranted.
 *
 * NO REACT AND NO STORAGE FORMAT. Both adapters are built by their host and
 * handed in; this module holds the contract between them and the screen, and
 * the two rules that are genuinely decisions rather than plumbing.
 */

import type { CustodyCallDevice, CustodyDynamicSession } from '../identity/custodyContractClient.js';

/** The device, and the key every store this Passport owns is filed under. */
export interface CustodyIdentity {
  readonly device: CustodyCallDevice;
  readonly userKey: string;
}

/** What the screen needs to know about whoever is holding this Passport. */
export interface CustodyArm {
  /** Which kind. Used for copy and for nothing that decides money. */
  readonly kind: 'passkey' | 'dynamic';
  /**
   * The key this Passport's stores are under, where it is already known.
   *
   * A social sign-in knows it the moment it is signed in: it is the embedded
   * address. A passkey knows it only from the pointer a previous visit wrote,
   * and `null` means "this browser has not opened this passkey's Passport
   * before" — which is both "there is not one" and "there is one somewhere
   * else", and the two are the same question until somebody asks for a name.
   */
  readonly userKey: string | null;
  /** The vendor half of the identity, or null where there is no vendor. */
  readonly session: CustodyDynamicSession | null;
  /**
   * Whether this arm is far enough along to show a Passport at all.
   *
   * False is a spinner, never a refusal: a sign-in still starting up and a
   * passkey whose wallet is still opening are both "not yet".
   */
  readonly ready: boolean;
  /** Settle the device, asking for whatever ceremony that costs. */
  ensureIdentity(): Promise<CustodyIdentity>;
  /** The busy line while an approval is outstanding. */
  readonly approvalPrompt: string;
  /** Who this Passport belongs to, as the reader would name themselves. */
  readonly who: string;
  /** How they got in, as the reader would name it. Never a vendor's name. */
  readonly via: string;
}

/**
 * The sentence under the spinner while a passkey is being asked for.
 *
 * NOT "approve with your passkey", because the reader did not choose a passkey
 * — they chose a fingerprint, or a face, or a PIN, and which of those it is is
 * the platform's business. The words name the gesture the browser is about to
 * ask for without claiming to know which one it will be.
 */
export const PASSKEY_APPROVAL_PROMPT = 'Confirm it is you';

/**
 * How a passkey Passport's holder is named on screen.
 *
 * A social sign-in has a handle to show. A passkey has nothing: it is a secret
 * on this device, and the honest second person is the only name there is.
 */
export const PASSKEY_WHO = 'your Passport';

/** And how they got in. */
export const PASSKEY_VIA = 'this device';
