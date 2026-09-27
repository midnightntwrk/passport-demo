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
 *   no vendor and no address; the signer is built from a contract root — a
 *   FRESH one for every action, since 2026/09/27 — and signs synchronously, and
 *   the Passport is named by its own device point.
 *
 * An adapter is those differences and nothing else. The screen asks it for an
 * approval and a name, and asks the custody layer for everything else.
 *
 * WHY THE SCREEN DOES NOT SIMPLY ASK "WHICH ARM"
 * ----------------------------------------------
 * Because the answer is needed before the arm is known. A passkey's device
 * point costs a user-verified assertion, and the screen has to render — the
 * header, the setup step, the stored record — before anybody has touched an
 * authenticator. So the adapter carries a `userKey` it may already know (from
 * the pointer a previous visit wrote) and an `approve` that asks for the
 * ceremony when an action actually warrants one.
 *
 * NO REACT AND NO STORAGE FORMAT. Both adapters are built by their host and
 * handed in; this module holds the contract between them and the screen, and
 * the two rules that are genuinely decisions rather than plumbing.
 */

import type { CustodyCallDevice, CustodyDynamicSession } from '../identity/custodyContractClient.js';
import type { CustodyApproval } from './custodyApproval.js';

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
  /**
   * ONE APPROVAL, FOR ONE ACTION (2026/09/27) — the device that signs it, and
   * the release that ends it. See `./custodyApproval.ts`.
   *
   * A PASSKEY is asked a fresh user-verified assertion on every call, and the
   * prompt is raised before this returns — so a press that calls it
   * synchronously is still the gesture the browser sees. What it builds can
   * sign only until it is released. Nothing is cached between calls but the
   * public key the Passport is filed under.
   *
   * A SOCIAL SIGN-IN has nothing to ask here: its key signs inside the
   * provider, call by call. Its approval hands back the identity the arm
   * already knows and holds nothing to release.
   */
  approve(): CustodyApproval<CustodyIdentity>;
  /** The busy line while an approval is outstanding. */
  readonly approvalPrompt: string;
  /**
   * THE FIVE SENTENCES THAT ARE ABOUT HOW THE READER GOT IN, and therefore the
   * arm's rather than the screen's.
   *
   * They are whole strings and not fragments the screen interpolates, which is
   * the lesson of the first passkey render: `Signed in with {via}` and
   * `{who} is all Passport needs` were written for a sign-in that has a
   * provider and a handle, and with a passkey's words poured into them they
   * came out as "SIGNED IN WITH THIS DEVICE" and "your Passport is all Passport
   * needs". A template that reads well for one arm is not a template; it is one
   * arm's sentence with a hole in it.
   */
  /** The small line above the title. */
  readonly kicker: string;
  /** The paragraph under the title on the setup screen. */
  readonly lede: string;
  /** The line above the title on Home, naming who is signed in. */
  readonly badge: string;
  /**
   * The noun phrase for the thing that proves this Passport is the reader's,
   * as it reads mid-sentence: "…that {keyPhrase} is part of it".
   */
  readonly keyPhrase: string;
  /** What to try when a name turns out to belong to somebody else's Passport. */
  readonly otherKeyHint: string;
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
 * Everything a passkey Passport's screens say about how its reader got in.
 *
 * A social sign-in has a provider and a handle to show. A passkey has neither:
 * there is no vendor, no account name, and nothing to be signed in TO. What
 * there is is a key this device holds, and every sentence here says that and
 * stops — no "sign-in", because there was none, and no "passkey" where the
 * reader would have to know the word for a thing they experienced as a
 * fingerprint.
 */
export const PASSKEY_COPY = {
  kicker: 'Your key is on this device',
  lede:
    'The key on this device is all Passport needs. Nothing else to remember, and nothing to ' +
    'install — the same key brings your Passport back on any device it is on.',
  badge: 'Held on this device',
  keyPhrase: 'the key on this device',
  otherKeyHint: 'If you set this Passport up with a different key, use the device that holds it.',
} as const;
