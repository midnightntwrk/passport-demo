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
 * SHIELDED IS HERE NOW, AND IT IS THREE LEGS (2026/09/17)
 * -------------------------------------------------------
 * `withdraw_shielded_with_k256` binds the qualified coin it will spend into the
 * challenge (AUTH-10), so the approver signs over the exact note — and the note
 * comes from the `held_coin` witness, which is now answered by
 * `./k1CoinStore.ts` (`docs/demo/account-custody-layer-design.md` §3, "as
 * built"). So a shielded balance can be spent, and the shape of that spend is
 * the passkey path's, leg for leg:
 *
 *   leg 1  withdraw_shielded_with_k256(own coin public key, colour, amount)
 *          — gated, for EXACTLY the amount, with the change coin coming back
 *          as the circuit's own return value;
 *   leg 2  wait until the wallet holds the note, identified by NONCE and not
 *          by colour and value (`../lib/shieldedNote.ts`);
 *   leg 3  deposit_shielded into the recipient — the note alone into a
 *          prototype account, the note AND a sealed description into another
 *          of these accounts, because a custody account that is handed a coin
 *          with no description can never move it again.
 *
 * IF LEG THREE FAILS the note goes BACK into the sender's own account, sealed
 * to the sender's own encryption key — the same reasoning the passkey path
 * gives for its deposit-back, which is that Home's "money outside your
 * account" card cannot see a shielded note and so there is nothing to hand the
 * reader instead. {@link custodyShieldedSendOutcome} is the sentence for every
 * stage this can stop at, including the one where the return fails too.
 *
 * The sentence that stood in for this send while it was being built —
 * "sending it is not built yet" — is GONE rather than kept for reference
 * (2026/09/17). A refusal nothing reaches is a refusal somebody shows again by
 * accident, and the screen now has the send it described.
 */

import type { CustodyAccountRecord, CustodyStorage } from './custodyContractPlan.js';
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
/* A SHIELDED payment: three legs                                             */
/* -------------------------------------------------------------------------- */

/**
 * Where leg three puts the note, which depends on what the recipient is.
 *
 * `'prototype'` is `deposit_shielded(coin)` on the two prototype builds, which
 * take the note and nothing else. `'custody'` is `deposit_shielded(coin, entry)`
 * on another one of these accounts, where the second argument is the sealed
 * description the recipient needs in order to ever spend what it was sent —
 * see `./custodyInbox.ts`. A deposit into a custody account WITHOUT an entry
 * is a coin that has demonstrably arrived and that nobody can move again.
 */
export type ShieldedDepositRoute = 'prototype' | 'custody';

/** Which shielded deposit a recipient's account takes, or null for neither. */
export function shieldedDepositRouteFor(
  module: PassportContractName,
): ShieldedDepositRoute | null {
  if (module === 'account' || module === 'account-v1') return 'prototype';
  if (module === 'account-custody') return 'custody';
  return null;
}

/** The qualified coin a shielded spend consumes, as the store holds it. */
export interface CustodyHeldCoinPlan {
  readonly nonce: string;
  readonly value: bigint;
  readonly mtIndex: bigint;
}

/** Leg one: the gated withdrawal, out to this Passport's own receiving address. */
export interface CustodyShieldedWithdrawLeg {
  readonly operation: 'withdraw_shielded';
  readonly colourHex: string;
  /** EXACTLY the amount being sent — see {@link planCustodyShieldedSend}. */
  readonly amount: bigint;
  /**
   * Where the withdrawal pays: this Passport's own shielded receiving address,
   * whole, as `mn_shield-addr…`.
   *
   * The circuit takes only the coin public key inside it, and the caller is
   * the one that decodes — that needs the address SDK and this module has no
   * imports with sockets or WASM behind them. The whole address travels
   * because half of it cannot be derived from the other half.
   *
   * No coin-to-encryption-key mapping is needed for this leg, unlike the
   * passkey path's `withdrawShielded`: the payee is this wallet itself, and
   * midnight-js already holds its own encryption key.
   */
  readonly ownShieldedAddress: string;
  /**
   * The coin the spend will consume, bound into the challenge the device signs
   * (AUTH-10: the approver signs over the exact note, not over a colour and an
   * amount) and returned by the `held_coin` witness when the proof is built.
   * One coin, read once, so the two cannot disagree.
   */
  readonly coin: CustodyHeldCoinPlan;
}

/** Leg two: which note leg three is looking for, once the wallet holds it. */
export interface CustodyShieldedAwaitLeg {
  readonly colourHex: string;
  /** The arriving note's value must equal this EXACTLY — `lib/shieldedNote.ts`. */
  readonly amount: bigint;
}

/** Leg three: the permissionless deposit that makes the value the recipient's. */
export type CustodyShieldedDepositLeg =
  | {
      readonly route: 'prototype';
      readonly circuit: 'deposit_shielded';
      readonly contractAddress: string;
      readonly colourHex: string;
      readonly amount: bigint;
    }
  | {
      readonly route: 'custody';
      readonly circuit: 'deposit_shielded';
      readonly contractAddress: string;
      readonly colourHex: string;
      readonly amount: bigint;
      /**
       * The recipient's advertised encryption key, READ LIVE by the caller and
       * never remembered: an account may rotate it, and an entry sealed to a
       * key it has rotated away from is a coin the recipient cannot open.
       */
      readonly recipientEncKeyHex: string;
    };

/**
 * Where the note goes if leg three fails: back into the sender's own account.
 *
 * Null when this Passport cannot read its own encryption key, which does not
 * stop the send — it means a failed leg three leaves the value at the sender's
 * own receiving address instead, and {@link custodyShieldedSendOutcome} says
 * so rather than claiming it came back.
 */
export interface CustodyShieldedReturnLeg {
  readonly circuit: 'deposit_shielded';
  readonly contractAddress: string;
  readonly colourHex: string;
  readonly ownEncKeyHex: string;
}

/** The whole shielded payment. */
export interface CustodyShieldedSendPlan {
  readonly withdraw: CustodyShieldedWithdrawLeg;
  readonly await: CustodyShieldedAwaitLeg;
  readonly deposit: CustodyShieldedDepositLeg;
  readonly returnToSender: CustodyShieldedReturnLeg | null;
}

/** Everything a shielded plan is built from. */
export interface CustodyShieldedSendPlanInput {
  /** This Passport's setup record. Must be finished. */
  readonly record: CustodyAccountRecord | null;
  readonly colourHex: string;
  readonly amount: bigint;
  /** This Passport's own shielded receiving address. */
  readonly ownShieldedAddress: string;
  /** The recipient's account, resolved from the name. */
  readonly recipientAccountAddress: string;
  /** What the chain says the recipient's account is built from. */
  readonly recipientModule: PassportContractName;
  /** The coin the store holds in this colour, or null when it holds none. */
  readonly heldCoin: CustodyHeldCoinPlan | null;
  /** The values of the FURTHER coins of this colour the store has queued. */
  readonly queuedValues: readonly bigint[];
  /** The recipient's encryption key, read live. Only a custody recipient needs one. */
  readonly recipientEncKeyHex?: string | null;
  /** This Passport's own encryption key, read live, for the return leg. */
  readonly ownEncKeyHex?: string | null;
}

function totalOf(values: readonly bigint[]): bigint {
  let total = 0n;
  for (const value of values) total += value;
  return total;
}

/**
 * Why a shielded payment cannot be planned, in one sentence, or null.
 *
 * TWO REFUSALS HERE ARE ABOUT THE SAME MONEY AND ARE NOT THE SAME SENTENCE,
 * which is the whole reason this function is worth reading. An account can
 * hold three payments of a colour and send only the first, because
 * `held_coin(color)` names ONE coin and a spend consumes it whole: "you do not
 * hold enough" would be false, and offering a control that fails at proving
 * time would be worse. So a request that exceeds the held coin but not the
 * total says what is actually true — that it arrived as separate payments —
 * and asks for a smaller amount.
 *
 * None of these sentences names a wallet address, a fee token, a proving
 * service, a name registry, or the sign-in vendor. A refusal is the most
 * likely thing a person meets on this path, so it is the copy that most has to
 * be right.
 */
export function custodyShieldedSendRefusal(input: CustodyShieldedSendPlanInput): string | null {
  if (input.record === null || input.record.address === null || !input.record.activated) {
    return 'Your Passport is still being set up. Try again once it is ready.';
  }
  if (input.amount <= 0n) return 'Enter an amount greater than zero.';
  if (input.ownShieldedAddress.trim().length === 0) {
    return 'Your Passport is still opening. Try again in a moment.';
  }
  const route = shieldedDepositRouteFor(input.recipientModule);
  if (route === null) {
    return 'That name does not belong to a Passport that can be paid.';
  }
  if (input.heldCoin === null) {
    return 'Your Passport holds none of that to send.';
  }
  if (input.amount > input.heldCoin.value + totalOf(input.queuedValues)) {
    return 'You do not hold enough to send that.';
  }
  if (input.amount > input.heldCoin.value) {
    return 'That much arrived as separate payments, and one payment can only draw on one of them. Send a smaller amount for now.';
  }
  if (route === 'custody' && normalisedEncKey(input.recipientEncKeyHex) === null) {
    return 'That Passport cannot be paid this kind of amount yet.';
  }
  return null;
}

/**
 * An encryption key as 64 lower-case hex characters, or null.
 *
 * Checked HERE, in the pure layer, because the failure it prevents is the
 * expensive one: a deposit whose entry was sealed to a key that was not one is
 * a coin the recipient cannot describe and therefore cannot ever spend.
 * `./custodyInbox.ts` refuses it too, one leg later, with the value already
 * out of the sender's account.
 */
function normalisedEncKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase().replace(/^0x/, '');
  return /^[0-9a-f]{64}$/.test(trimmed) ? trimmed : null;
}

/**
 * The three legs, or a throw carrying the refusal.
 *
 * EXACTLY THE AMOUNT LEAVES THE ACCOUNT, and the change comes back in the same
 * transaction. That is the opposite of the passkey path, which takes the whole
 * coin out and puts the difference back in a third transaction — a workaround
 * for `withdraw_shielded`'s split branch leaving behind a coin the node
 * refuses every later withdrawal against (node error 239, live 2026/09/03).
 * This contract's `withdraw_shielded_with_k256` RETURNS the change coin as the
 * circuit's value instead, so the change is described rather than re-derived,
 * and the description is what the store keeps. Asking for the whole coin here
 * would mean sending a stranger more than the amount.
 */
export function planCustodyShieldedSend(
  input: CustodyShieldedSendPlanInput,
): CustodyShieldedSendPlan {
  const refusal = custodyShieldedSendRefusal(input);
  if (refusal !== null) throw new Error(refusal);
  /* NARROWING, AND NOT A FALLBACK — the same argument `planCustodySend` makes:
     the refusal above has already answered every case in which either of these
     is absent, and inventing a value for one would be how a payment goes
     somewhere that cannot take it. */
  const route = shieldedDepositRouteFor(input.recipientModule) as ShieldedDepositRoute;
  const coin = input.heldCoin as CustodyHeldCoinPlan;
  const ownEncKey = normalisedEncKey(input.ownEncKeyHex);
  return {
    withdraw: {
      operation: 'withdraw_shielded',
      colourHex: input.colourHex,
      amount: input.amount,
      ownShieldedAddress: input.ownShieldedAddress,
      coin,
    },
    await: { colourHex: input.colourHex, amount: input.amount },
    deposit:
      route === 'custody'
        ? {
            route,
            circuit: 'deposit_shielded',
            contractAddress: input.recipientAccountAddress,
            colourHex: input.colourHex,
            amount: input.amount,
            recipientEncKeyHex: normalisedEncKey(input.recipientEncKeyHex) as string,
          }
        : {
            route,
            circuit: 'deposit_shielded',
            contractAddress: input.recipientAccountAddress,
            colourHex: input.colourHex,
            amount: input.amount,
          },
    returnToSender:
      ownEncKey === null
        ? null
        : {
            circuit: 'deposit_shielded',
            contractAddress: input.record?.address as string,
            colourHex: input.colourHex,
            ownEncKeyHex: ownEncKey,
          },
  };
}

/* -------------------------------------------------------------------------- */
/* Reading the change coin out of the circuit's own result                    */
/* -------------------------------------------------------------------------- */

/** What the withdrawal said about the change it left. */
export type CustodyChangeCoin =
  | { readonly outcome: 'change'; readonly nonce: string; readonly colour: string; readonly value: bigint }
  | { readonly outcome: 'none' }
  | { readonly outcome: 'unreadable'; readonly reason: string };

function hexOf(bytes: unknown): string | null {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) return null;
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/**
 * The change coin `withdraw_shielded_with_k256` returned, read out of the
 * circuit's JS result.
 *
 * `{is_some, value:{nonce,color,value}}` — a Compact `Maybe`. `is_some: false`
 * is the spend that consumed the coin exactly, which is a real outcome and not
 * an error; the caller promotes the next queued coin instead of storing a
 * change coin that does not exist.
 *
 * THERE IS NO `mt_index` IN IT, and that is the whole difficulty this function
 * hands on. The chain allocated the change note a position inside the
 * transaction that produced it, and the description here is complete in every
 * respect except that one — so the caller reconciles the position against the
 * withdrawal's own transaction, which reports the two-output window the note
 * shares with the payee's note.
 *
 * `'unreadable'` is a shape this build did not expect rather than a failure of
 * the spend: the value has moved either way, so the caller must say where it
 * is and must not retry the withdrawal.
 */
export function changeCoinFromResult(result: unknown): CustodyChangeCoin {
  if (!result || typeof result !== 'object') {
    return { outcome: 'unreadable', reason: 'The payment went out and this Passport could not read what was left over.' };
  }
  const maybe = result as { is_some?: unknown; value?: unknown };
  if (maybe.is_some === false) return { outcome: 'none' };
  if (maybe.is_some !== true || !maybe.value || typeof maybe.value !== 'object') {
    return { outcome: 'unreadable', reason: 'The payment went out and this Passport could not read what was left over.' };
  }
  const coin = maybe.value as { nonce?: unknown; color?: unknown; value?: unknown };
  const nonce = hexOf(coin.nonce);
  const colour = hexOf(coin.color);
  if (nonce === null || colour === null || typeof coin.value !== 'bigint' || coin.value < 0n) {
    return { outcome: 'unreadable', reason: 'The payment went out and this Passport could not read what was left over.' };
  }
  return { outcome: 'change', nonce, colour, value: coin.value };
}

/**
 * Whether a failed spend failed because the coin's POSITION was the wrong
 * guess, which is the one failure worth retrying.
 *
 * A qualified description with an incorrect `mt_index` is an unsatisfiable
 * witness: the proof cannot be built, nothing is submitted, and nothing is
 * spent (MIP-0012 INV-5). So retrying against the next candidate position
 * costs a signature and a proof attempt and risks nothing. Every OTHER
 * failure — a refused connection, a rejected transaction, an unavailable
 * proving service — is not improved by trying a different position, and
 * retrying it would ask the person to approve again for no reason.
 *
 * Matched on the words the failure arrives with, which is unlovely and is the
 * only material available: the merkle path is named by the runtime that could
 * not build it, not by an error code.
 */
export function spendPositionMayBeWrong(message: string): boolean {
  const text = typeof message === 'string' ? message.toLowerCase() : '';
  if (text.length === 0) return false;
  if (
    text.includes('merkle') ||
    text.includes('mt_index') ||
    text.includes('membership') ||
    text.includes('witness') ||
    text.includes('unsatisfiable') ||
    text.includes('constraint')
  ) {
    return true;
  }
  /* A WASM TRAP IS THE THIRD SHAPE THIS FAILURE COMES IN, and it names nothing
     about positions. A position past the leaves the contract's own Zswap state
     retains does not produce a wrong Merkle path — it makes the on-chain
     runtime trap while EXECUTING the call, and all that reaches here is
     `Unexpected error executing scoped transaction '<unnamed>': RuntimeError:
     unreachable` (live, 2026/09/18, position 3804 against a tree whose last
     leaf for this contract was 3803).
     `RuntimeError` ALONE IS NOT ENOUGH (review, 2026/09/18). It is the marker
     for every WebAssembly trap in the stack — the wallet's own proving and the
     runtime's serialisation included — and a retry is not free: it asks for a
     second approval and, on a coin whose list has run out, used to leave the
     store on the wrong guess. What makes this trap a position's trap is WHERE
     it happened: inside the execution of the call being retried, which the
     runtime's own wrapper names. A trap from anywhere else is somebody else's
     problem and the next candidate will not fix it. */
  return text.includes('runtimeerror') && text.includes('executing scoped transaction');
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

/* -------------------------------------------------------------------------- */
/* A send that stopped between legs                                           */
/* -------------------------------------------------------------------------- */

/** Where a shielded send got to. */
export type CustodyShieldedSendStage =
  /** Leg one is out. Nothing has left the account that the account knows of. */
  | 'withdrawing'
  /** Leg one landed; the note has not been identified in the wallet yet. */
  | 'awaiting-note'
  /** The note is identified; leg three is running. */
  | 'depositing'
  /** Leg three failed; the note is being put back into the sender's account. */
  | 'returning'
  /** The recipient has it. */
  | 'done'
  /**
   * Leg three threw AFTER the note had left this wallet.
   *
   * Which is a real outcome and not a tidy one: a transaction can be broadcast
   * and its promise still reject — a socket dropping, a confirmation wait
   * running out — and the recipient then has the money while this screen has an
   * error. The note is demonstrably gone from the sender's wallet, so it cannot
   * be put back, and nothing here can see the recipient's side. Saying "it is
   * held for you" would be a lie in the direction that costs the most.
   */
  | 'unconfirmed'
  /** The value is out of the account and in neither account. */
  | 'stranded';

/**
 * The minimum a resumed shielded send needs to know, and no more.
 *
 * WHY THIS IS PERSISTED AT ALL. Leg one takes value out of the account into
 * the sender's own wallet, and only leg three makes it the recipient's. A tab
 * closed in between leaves a note in a wallet with nothing on any screen
 * saying what it was for — and unlike the NIGHT path there is no card that
 * sweeps it back, because a shielded note is invisible to the card that does
 * that (`App.tsx`, above `executeShieldedSendToName`). So the three facts
 * needed to finish or explain it are written down before leg one goes out: the
 * colour, the amount, and who it was for.
 *
 * `amount` is a decimal STRING for the reason `./k1CoinStore.ts` gives about
 * every field it stores: a `bigint` does not survive `JSON.stringify`.
 *
 * ONE PER ACCOUNT. The app asks for one payment at a time, and a record keyed
 * per attempt would be a list nothing ever cleans up.
 */
export interface CustodyShieldedSendRecord {
  readonly network: string;
  /** The SENDER's account, raw 64-hex. */
  readonly accountAddress: string;
  readonly stage: CustodyShieldedSendStage;
  readonly colourHex: string;
  /** Decimal. */
  readonly amount: string;
  /** What the person typed — a name, not an address. */
  readonly recipientLabel: string;
  readonly recipientAccountAddress: string;
  /** The note leg one produced, once leg two has identified it. */
  readonly noteNonce: string | null;
  readonly withdrawTxId: string | null;
  readonly depositTxId: string | null;
  readonly startedAt: number;
}

/** `localStorage` key for the in-flight shielded send, one per account. */
export const CUSTODY_SHIELDED_SEND_KEY = 'passport-account-custody-shielded-send:v1';

function shieldedSendKey(network: string, accountAddress: string): string {
  return `${network}::${accountAddress}`;
}

/** The record a send starts with, before leg one is submitted. */
export function newCustodyShieldedSend(input: {
  network: string;
  accountAddress: string;
  colourHex: string;
  amount: bigint;
  recipientLabel: string;
  recipientAccountAddress: string;
  now: number;
}): CustodyShieldedSendRecord {
  return {
    network: input.network,
    accountAddress: input.accountAddress,
    stage: 'withdrawing',
    colourHex: input.colourHex,
    amount: input.amount.toString(),
    recipientLabel: input.recipientLabel,
    recipientAccountAddress: input.recipientAccountAddress,
    noteNonce: null,
    withdrawTxId: null,
    depositTxId: null,
    startedAt: input.now,
  };
}

/**
 * Every stage a stored record may be in — the list a record is READ BACK
 * against, so a stage missing from it is a record that vanishes on reload.
 *
 * `'unconfirmed'` was missing until 2026/09/17, and it is the most expensive
 * one to lose: it is written exactly when value has left the Passport and
 * nothing here can see which side holds it (`../screens/DynamicPassport.tsx`
 * saves it before it throws). A record that will not parse is a record the
 * screen reads as "no payment in flight", so a reload replaced the one
 * sentence that says what happened with silence.
 */
const SHIELDED_SEND_STAGES: readonly CustodyShieldedSendStage[] = [
  'withdrawing',
  'awaiting-note',
  'depositing',
  'returning',
  'done',
  'unconfirmed',
  'stranded',
];

function recordFromRow(row: unknown): CustodyShieldedSendRecord | null {
  if (!row || typeof row !== 'object') return null;
  const candidate = row as Partial<CustodyShieldedSendRecord>;
  if (typeof candidate.network !== 'string' || candidate.network.length === 0) return null;
  if (typeof candidate.accountAddress !== 'string') return null;
  if (!SHIELDED_SEND_STAGES.includes(candidate.stage as CustodyShieldedSendStage)) return null;
  if (typeof candidate.colourHex !== 'string') return null;
  if (typeof candidate.amount !== 'string' || !/^(0|[1-9][0-9]*)$/.test(candidate.amount)) {
    return null;
  }
  return {
    network: candidate.network,
    accountAddress: candidate.accountAddress,
    stage: candidate.stage as CustodyShieldedSendStage,
    colourHex: candidate.colourHex,
    amount: candidate.amount,
    recipientLabel: typeof candidate.recipientLabel === 'string' ? candidate.recipientLabel : '',
    recipientAccountAddress:
      typeof candidate.recipientAccountAddress === 'string'
        ? candidate.recipientAccountAddress
        : '',
    noteNonce: typeof candidate.noteNonce === 'string' ? candidate.noteNonce : null,
    withdrawTxId: typeof candidate.withdrawTxId === 'string' ? candidate.withdrawTxId : null,
    depositTxId: typeof candidate.depositTxId === 'string' ? candidate.depositTxId : null,
    startedAt: typeof candidate.startedAt === 'number' ? candidate.startedAt : 0,
  };
}

function readSends(storage: CustodyStorage): Record<string, CustodyShieldedSendRecord> {
  /* A null-prototype map, for the reason `./k1CoinStore.ts` gives: `__proto__`
     is a legal JSON key and a write to it on an ordinary object stores
     nothing. */
  const sends = Object.create(null) as Record<string, CustodyShieldedSendRecord>;
  try {
    const raw = storage.getItem(CUSTODY_SHIELDED_SEND_KEY);
    if (raw === null) return sends;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return sends;
    for (const [key, row] of Object.entries(parsed as Record<string, unknown>)) {
      const record = recordFromRow(row);
      if (record !== null) sends[key] = record;
    }
    return sends;
  } catch {
    /* Storage denied, or something that is not JSON. A send nobody can read is
       a send nobody can resume, which is the same position as no record at all
       — and the value is still described by the activity trail. */
    return sends;
  }
}

/** Write the in-flight send down. Never throws: a denied write loses the note's story, not the note. */
export function saveCustodyShieldedSend(
  storage: CustodyStorage,
  record: CustodyShieldedSendRecord,
): void {
  const sends = readSends(storage);
  sends[shieldedSendKey(record.network, record.accountAddress)] = record;
  try {
    storage.setItem(CUSTODY_SHIELDED_SEND_KEY, JSON.stringify(sends));
  } catch {
    /* Deliberately silent — see the doc comment. */
  }
}

/** The in-flight send for one account, or null. */
export function loadCustodyShieldedSend(
  storage: CustodyStorage,
  account: { network: string; accountAddress: string },
): CustodyShieldedSendRecord | null {
  const sends = readSends(storage);
  const key = shieldedSendKey(account.network, account.accountAddress);
  return Object.hasOwn(sends, key) ? sends[key] : null;
}

/** Forget a send that has finished, or one the person has been told about. */
export function clearCustodyShieldedSend(
  storage: CustodyStorage,
  account: { network: string; accountAddress: string },
): void {
  const sends = readSends(storage);
  delete sends[shieldedSendKey(account.network, account.accountAddress)];
  try {
    storage.setItem(CUSTODY_SHIELDED_SEND_KEY, JSON.stringify(sends));
  } catch {
    /* As above. */
  }
}

/**
 * What a resumed run should do next with a record it found.
 *
 * `'deposit'` is the case worth having this for: the value is in the sender's
 * wallet as a note, the recipient has not been paid, and the remaining leg
 * needs no approval from anybody — so a resumed run can simply finish it.
 * `'find-note'` is the same position one step earlier, where the note still
 * has to be identified by nonce.
 *
 * `'nothing'` is a record that has either finished or cannot be finished from
 * here; `'report'` is a record whose value is out of the account with no leg
 * left to run, and the caller's job is to say where it is rather than to try
 * anything.
 */
export function nextCustodyShieldedSendStep(
  record: CustodyShieldedSendRecord,
): 'withdraw' | 'find-note' | 'deposit' | 'report' | 'nothing' {
  if (record.stage === 'withdrawing') return 'withdraw';
  if (record.stage === 'awaiting-note') return 'find-note';
  if (record.stage === 'depositing') return record.noteNonce === null ? 'find-note' : 'deposit';
  if (record.stage === 'returning') return 'report';
  if (record.stage === 'stranded') return 'report';
  /* Out of the account, in neither account as far as this build can see, and
     with no leg left to run: the caller's job is to say so. `'nothing'` would
     leave a person who reopened Passport with no sign of a payment that has
     demonstrably left it. */
  if (record.stage === 'unconfirmed') return 'report';
  return 'nothing';
}

/**
 * Where the value is, in a sentence, for every stage a send can stop at.
 *
 * THE ONE RULE THIS FILE EXISTS FOR. A person whose payment failed is owed an
 * answer to exactly one question, and it is not "which leg failed" — it is
 * "where is my money". Each of these says that and nothing else: no leg
 * numbers, no circuit names, no proving service, and no claim that the value
 * came back unless it did.
 */
export function custodyShieldedSendOutcome(record: CustodyShieldedSendRecord): string {
  const who = record.recipientLabel.trim().length > 0 ? record.recipientLabel.trim() : 'them';
  switch (record.stage) {
    case 'done':
      return `Sent. ${who} has it.`;
    case 'withdrawing':
      return 'Nothing was sent, and it is all still in your Passport.';
    case 'awaiting-note':
    case 'depositing':
      return `It has left your Passport and has not reached ${who} yet. Open Passport again in a moment and it will finish by itself.`;
    case 'returning':
      return `It did not reach ${who}, so it is being put back into your Passport.`;
    case 'unconfirmed':
      return `It has left your Passport and nothing here can see whether ${who} has it yet. Check with ${who} before sending it again.`;
    default:
      return `It did not reach ${who}, and it could not be put back either. It is being held for you at your own receiving address, and the next version of Passport will sweep it up.`;
  }
}
