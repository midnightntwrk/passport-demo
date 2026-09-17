/**
 * PAYING SOMEBODY FROM A DYNAMIC PASSPORT — the plan, and only the plan.
 *
 * WHAT A SEND IS ON THIS BUILD
 * ----------------------------
 * Two transactions, exactly as it is on the passkey build, and for the same
 * reason (`App.tsx`, the long comment above `runNameSend`): an account's
 * unshielded holdings are a mirror the contract keeps, `withdraw_unshielded`
 * pays a USER address by type and cannot pay a contract, and the recipient's
 * mirror is only written by a deposit. So value leaves the sender's account to
 * the sender's own receiving address, and a second, permissionless call puts it
 * into the recipient's account.
 *
 *   leg 1  withdraw_unshielded_with_k256(colour, amount, this device's address)
 *          — gated. The Dynamic key signs the contract's own challenge.
 *   leg 2  deposit_night        into a prototype account, or
 *          deposit_unshielded   into another Dynamic Passport
 *          — permissionless either way. Nothing signs it.
 *
 * WHICH ONE LEG TWO IS, IS A QUESTION ABOUT THE RECIPIENT AND IS ASKED OF THE
 * CHAIN. `accountModuleFor` reads the deployed circuit set; a local record is
 * never the answer, because the recipient's build is not something the sender
 * can know from anything it stores.
 *
 * WHY THIS FILE HOLDS NO SOCKETS
 * ------------------------------
 * The same split `custodyContractPlan.ts` and `custodyContractClient.ts` already keep: the
 * decisions are here and are drilled to the branch, and the wiring — a wallet, a
 * sponsor, an indexer, a proof service — is passed in. Everything below is a
 * pure function of its arguments, which is why it is in the coverage
 * denominator. Getting a send plan wrong is how value leaves an account and
 * arrives nowhere.
 *
 * SHIELDED IS NOT HERE, AND SAYS SO
 * ---------------------------------
 * `withdraw_shielded_with_k256` binds the qualified coin it will spend into the
 * challenge (AUTH-10), so the approver signs over the exact note — and the note
 * comes from the `held_coin` witness, which is the coin store that is a separate
 * piece of work (`docs/demo/account-custody-layer-design.md` §3). Until that lands a
 * shielded balance on one of these Passports can be received and shown and
 * cannot be spent. {@link shieldedSendRefusal} is the one sentence that says so,
 * and the surface shows it instead of offering a control that would fail.
 */

import type { CustodyAccountRecord } from './custodyContractPlan.js';
import type { PassportContractName } from './contractRuntime.js';

/* -------------------------------------------------------------------------- */
/* What leg two is                                                            */
/* -------------------------------------------------------------------------- */

/** The permissionless circuit that writes the recipient's unshielded mirror. */
export type DepositCircuit = 'deposit_night' | 'deposit_unshielded';

/**
 * Which deposit circuit a recipient's account takes.
 *
 * Both prototype builds carry `deposit_night`; the account custody build renamed it
 * `deposit_unshielded` along with the mirror it writes. `midnames` is not an
 * account at all — a name that resolves to the registry is somebody's mistake,
 * not a recipient — and it is refused by name rather than by a cast.
 */
export function depositCircuitFor(module: PassportContractName): DepositCircuit | null {
  if (module === 'account' || module === 'account-v1') return 'deposit_night';
  if (module === 'account-custody') return 'deposit_unshielded';
  return null;
}

/* -------------------------------------------------------------------------- */
/* The plan                                                                   */
/* -------------------------------------------------------------------------- */

/** Leg one, as the gated call takes it. */
export interface CustodyWithdrawLeg {
  /** Unsuffixed, the way `CustodyCallRequest.operation` wants it. */
  readonly operation: 'withdraw_unshielded';
  readonly colourHex: string;
  readonly amount: bigint;
  /**
   * Where leg one pays: THIS DEVICE'S OWN receiving address, never the
   * recipient's.
   *
   * It reads oddly until the second leg is in view. The withdrawal's recipient
   * is a user address by type and the person being paid holds an account, not
   * an address — so the only address this leg can name that leads anywhere is
   * the sender's own, and leg two carries it the rest of the way. A run that
   * stops between the two has left the value at the sender's own address, which
   * is why it can be resumed and why it is never lost.
   */
  readonly recipientAddress: string;
}

/** Leg two, as the permissionless deposit takes it. */
export interface CustodyDepositLeg {
  readonly circuit: DepositCircuit;
  /** The recipient's account, resolved from the name. */
  readonly contractAddress: string;
  readonly colourHex: string;
  readonly amount: bigint;
}

/** A whole NIGHT payment from one of these Passports. */
export interface CustodySendPlan {
  readonly withdraw: CustodyWithdrawLeg;
  readonly deposit: CustodyDepositLeg;
}

/** Everything a plan is built from. */
export interface CustodySendPlanInput {
  /** This Passport's setup record. Must be finished. */
  readonly record: CustodyAccountRecord | null;
  /** NIGHT, as the ledger quotes the colour. */
  readonly colourHex: string;
  readonly amount: bigint;
  /** This device's own receiving address — where leg one pays. */
  readonly ownReceivingAddress: string;
  /** The recipient's account contract, resolved from the name. */
  readonly recipientAccountAddress: string;
  /** What the chain says the recipient's account is built from. */
  readonly recipientModule: PassportContractName;
  /** The account's own mirrored balance of `colourHex`, or null if unread. */
  readonly heldBalance: bigint | null;
}

/**
 * Why a payment cannot be planned, in one sentence a person can read, or null.
 *
 * EVERY REFUSAL IS A SENTENCE AND NOT A CODE, and none of them uses a word from
 * the forbidden list — no contract, no wallet address, no sponsor, no registry,
 * no resolver, no fee token. A refusal is the most likely thing a person meets
 * on this path today, so it is the copy that most has to be right.
 *
 * An unread balance is NOT a refusal to send. It is a refusal to claim the
 * amount is affordable, and the two are different: the chain refuses an
 * overdraw by itself, and a Passport that would not let anybody pay anybody
 * because an indexer was slow is worse than one that tries.
 */
export function custodySendRefusal(input: CustodySendPlanInput): string | null {
  if (input.record === null || input.record.address === null || !input.record.activated) {
    return 'Your Passport is still being set up. Try again once it is ready.';
  }
  if (input.amount <= 0n) return 'Enter an amount greater than zero.';
  if (input.ownReceivingAddress.trim().length === 0) {
    return 'Your Passport is still opening. Try again in a moment.';
  }
  if (depositCircuitFor(input.recipientModule) === null) {
    return 'That name does not belong to a Passport that can be paid.';
  }
  if (input.heldBalance !== null && input.heldBalance < input.amount) {
    return 'You do not hold enough to send that.';
  }
  return null;
}

/**
 * The two legs, or a throw carrying the refusal.
 *
 * Throws rather than returning a union because every caller of this has already
 * asked {@link custodySendRefusal} — the throw is the assertion that it did, and it
 * carries the same sentence so a caller that forgot still shows something a
 * person can read.
 */
export function planCustodySend(input: CustodySendPlanInput): CustodySendPlan {
  const refusal = custodySendRefusal(input);
  if (refusal !== null) throw new Error(refusal);
  /* NARROWING, AND NOT A FALLBACK. `custodySendRefusal` above has already refused
     every module with no deposit circuit, so there is no case left in which
     this is null — and the two things TypeScript would otherwise be satisfied
     by are both worse than an assertion. A `?? 'deposit_night'` would INVENT a
     circuit for a recipient that has none, which is how a payment goes to a
     contract that cannot take it; an `if (circuit === null) throw` would be a
     branch no input can reach, which is a line this module's own coverage rule
     could never account for honestly. */
  const circuit = depositCircuitFor(input.recipientModule) as DepositCircuit;
  return {
    withdraw: {
      operation: 'withdraw_unshielded',
      colourHex: input.colourHex,
      amount: input.amount,
      recipientAddress: input.ownReceivingAddress,
    },
    deposit: {
      circuit,
      contractAddress: input.recipientAccountAddress,
      colourHex: input.colourHex,
      amount: input.amount,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* What the person is asked                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The line on the consent sheet, naming the provider that will approve.
 *
 * IT NAMES DYNAMIC'S PROVIDER, NOT DYNAMIC. "Approve with your Google account"
 * is a thing the reader recognises; "approve with Dynamic" names a vendor they
 * have never chosen to have a relationship with, and "sign with your key" names
 * something they do not hold. The provider string comes from
 * `describeDynamicIdentity`, which is where `twitter` already became `X`.
 *
 * With no provider known the sentence still has to work, so it falls back to the
 * sign-in itself rather than to a blank.
 */
export function custodyApprovalPrompt(provider: string | null): string {
  const trimmed = typeof provider === 'string' ? provider.trim() : '';
  if (trimmed.length === 0) return 'Approve with the account you signed in with';
  return `Approve with your ${trimmed} account`;
}

/** What the sheet says while the sign-in is being asked for a signature. */
export const CUSTODY_APPROVAL_WAITING = 'Waiting for your approval';

/**
 * Why a shielded amount cannot be sent from one of these Passports yet.
 *
 * SHOWN, NOT HIDDEN. A balance the holder can see and a Send control that
 * silently omits it is a Passport that appears to have lost money. One sentence
 * that says what is true — it is there, it arrived, it cannot go out yet — is
 * the honest surface, and it is the sentence the Assets row carries too.
 */
export function shieldedSendRefusal(symbol: string | null): string {
  const asset = typeof symbol === 'string' && symbol.trim().length > 0 ? symbol.trim() : 'This';
  return `${asset} can be received into this Passport, but sending it is not built yet.`;
}

/* -------------------------------------------------------------------------- */
/* The account's own NIGHT, read off the custody ledger                            */
/* -------------------------------------------------------------------------- */

/**
 * The mirrored unshielded map, as the compiled `account-custody` build exposes it.
 *
 * `CustodyLedger` in `custodyContractClient.ts` carries only what a gated call needs —
 * the nonce, the epoch, and the device set — so the balance half is declared
 * here rather than by widening a type another change owns. It is the same shape
 * the sponsor reads (`examples/passport-balancer/src/account.ts`): a member
 * check and a lookup, keyed by the colour's raw hex bytes.
 */
export interface CustodyUnshieldedLedger {
  readonly unshielded_balances: {
    member(colour: Uint8Array): boolean;
    lookup(colour: Uint8Array): bigint;
  };
}

/**
 * What the account holds of one colour. Zero when the mirror has no entry.
 *
 * A COLOUR THE MIRROR HAS NEVER SEEN IS A REAL ZERO, not an absence: the map is
 * written by deposits, so "no entry" means nothing of that colour has ever
 * arrived. Returning null for it would put "Unavailable" on a screen over an
 * account that is simply empty, which is the defect this function exists to not
 * have.
 */
export function custodyUnshieldedBalance(
  ledger: CustodyUnshieldedLedger,
  colour: Uint8Array,
): bigint {
  return ledger.unshielded_balances.member(colour) ? ledger.unshielded_balances.lookup(colour) : 0n;
}
