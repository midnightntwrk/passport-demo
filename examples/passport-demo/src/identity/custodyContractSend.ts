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

import {
  CUSTODY_SEND_NOT_SENT,
  CUSTODY_SUBMIT_WAIT_MS,
  type CustodyAccountRecord,
  type CustodyStorage,
} from './custodyContractPlan.js';
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
/* A SHIELDED payment: ONE transaction                                        */
/* -------------------------------------------------------------------------- */

/**
 * Which shielded deposit a recipient's account takes, or null for neither.
 *
 * Kept because the ANSWER still decides whether a recipient can be paid at
 * all: `'custody'` is another one of these accounts, whose claim is
 * `deposit_shielded(coin, entry)` and which the direct transfer grafts onto
 * the sender's own transaction. `'prototype'` is the passkey build, and
 * {@link custodyShieldedSendRefusal} refuses it — see the refusal for why.
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

/**
 * The direct transfer, whole: one gated spend to the recipient's account, with
 * the recipient's own claim grafted onto the same transaction.
 */
export interface CustodyShieldedTransferLeg {
  readonly operation: 'withdraw_shielded_to_contract';
  /** The recipient's account contract, raw 64-hex. */
  readonly contractAddress: string;
  readonly colourHex: string;
  /** EXACTLY the amount being sent; the change comes back in the same transaction. */
  readonly amount: bigint;
  /**
   * The recipient's advertised encryption key, READ LIVE by the caller and
   * never remembered: an account may rotate it, and an entry sealed to a key it
   * has rotated away from is a coin the recipient cannot open.
   */
  readonly recipientEncKeyHex: string;
  /**
   * The coin the spend will consume, bound into the challenge the device signs
   * (AUTH-10: the approver signs over the exact note, not over a colour and an
   * amount) and returned by the `held_coin` witness when the proof is built.
   * One coin, read once, so the two cannot disagree.
   */
  readonly coin: CustodyHeldCoinPlan;
}

/** The whole shielded payment to another account. */
export interface CustodyShieldedSendPlan {
  readonly transfer: CustodyShieldedTransferLeg;
}

/** Everything a shielded plan is built from. */
export interface CustodyShieldedSendPlanInput {
  /** This Passport's setup record. Must be finished. */
  readonly record: CustodyAccountRecord | null;
  readonly colourHex: string;
  readonly amount: bigint;
  /** The recipient's account, resolved from the name. */
  readonly recipientAccountAddress: string;
  /** What the chain says the recipient's account is built from. */
  readonly recipientModule: PassportContractName;
  /** The coin the store holds in this colour, or null when it holds none. */
  readonly heldCoin: CustodyHeldCoinPlan | null;
  /** The values of the FURTHER coins of this colour the store has queued. */
  readonly queuedValues: readonly bigint[];
  /** The recipient's encryption key, read live. */
  readonly recipientEncKeyHex?: string | null;
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
 * THE PROTOTYPE RECIPIENT IS REFUSED, and it is the refusal worth arguing
 * with. A passkey Passport's account is a DIFFERENT BUILD, compiled to a
 * different intermediate representation (the account custody contract is ZKIR
 * v3, the prototype v2) and proved by a different proof server. One
 * transaction cannot hold a call of each, so the direct transfer cannot reach
 * one — and the only other way to reach one is through a wallet the ruling of
 * 2026/09/18 forbids in a value flow. Nothing here can mend that; a passkey
 * Passport on the account custody build can be paid like any other.
 *
 * None of these sentences names a wallet address, a fee token, a proving
 * service, a name registry, or the sign-in vendor. A refusal is the most likely
 * thing a person meets on this path, so it is the copy that most has to be
 * right.
 */
export function custodyShieldedSendRefusal(input: CustodyShieldedSendPlanInput): string | null {
  if (input.record === null || input.record.address === null || !input.record.activated) {
    return 'Your Passport is still being set up. Try again once it is ready.';
  }
  if (input.amount <= 0n) return 'Enter an amount greater than zero.';
  const route = shieldedDepositRouteFor(input.recipientModule);
  if (route === null) {
    return 'That name does not belong to a Passport that can be paid.';
  }
  if (route === 'prototype') {
    return "This name belongs to a Passport on the older version, so it can't be paid from this one. Paying between the two versions isn't supported.";
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
  if (normalisedEncKey(input.recipientEncKeyHex) === null) {
    return 'That Passport cannot be paid this kind of amount yet.';
  }
  return null;
}

/**
 * An encryption key as 64 lower-case hex characters, or null.
 *
 * Checked HERE, in the pure layer, because the failure it prevents is the
 * expensive one: a payment whose entry was sealed to a key that was not one is
 * a coin the recipient cannot describe and therefore cannot ever spend.
 * `./custodyInbox.ts` refuses it too, by which time the transaction is built.
 */
function normalisedEncKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase().replace(/^0x/, '');
  return /^[0-9a-f]{64}$/.test(trimmed) ? trimmed : null;
}

/**
 * The one transaction, or a throw carrying the refusal.
 *
 * EXACTLY THE AMOUNT LEAVES THE ACCOUNT, and the change comes back in the same
 * transaction. That is the opposite of the passkey path, which takes the whole
 * coin out and puts the difference back in a third transaction — a workaround
 * for `withdraw_shielded`'s split branch leaving behind a coin the node
 * refuses every later withdrawal against (node error 239, live 2026/09/03).
 * This contract RETURNS the change coin as the circuit's value instead, so the
 * change is described rather than re-derived, and the description is what the
 * store keeps.
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
  return {
    transfer: {
      operation: 'withdraw_shielded_to_contract',
      contractAddress: input.recipientAccountAddress,
      colourHex: input.colourHex,
      amount: input.amount,
      recipientEncKeyHex: normalisedEncKey(input.recipientEncKeyHex) as string,
      coin: input.heldCoin as CustodyHeldCoinPlan,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* A shielded payment to an ADDRESS somebody pasted                           */
/* -------------------------------------------------------------------------- */

/** The whole payment to a shielded address: one gated spend, no claim. */
export interface CustodyShieldedAddressSendPlan {
  readonly operation: 'withdraw_shielded';
  readonly colourHex: string;
  readonly amount: bigint;
  /**
   * The recipient's full `mn_shield-addr…`, whole.
   *
   * The circuit takes only the coin public key inside it, and midnight-js takes
   * the encryption key beside it to build the recipient's note — so the whole
   * address travels, because neither half can be derived from the other. The
   * caller decodes; this module has no imports with sockets or WASM behind them.
   */
  readonly recipientShieldedAddress: string;
  readonly coin: CustodyHeldCoinPlan;
}

/** Everything an address payment is planned from. */
export interface CustodyShieldedAddressSendPlanInput {
  readonly record: CustodyAccountRecord | null;
  readonly colourHex: string;
  readonly amount: bigint;
  readonly recipientShieldedAddress: string;
  readonly heldCoin: CustodyHeldCoinPlan | null;
  readonly queuedValues: readonly bigint[];
}

/** Why a payment to an address cannot be planned, in one sentence, or null. */
export function custodyShieldedAddressSendRefusal(
  input: CustodyShieldedAddressSendPlanInput,
): string | null {
  if (input.record === null || input.record.address === null || !input.record.activated) {
    return 'Your Passport is still being set up. Try again once it is ready.';
  }
  if (input.amount <= 0n) return 'Enter an amount greater than zero.';
  /* SHAPE ONLY. Whether the address belongs to this network is decided by the
     decode, which is the one place that can answer it — and it is the check
     that stops a payment vanishing into an address from another chain. */
  if (!/^mn_shield-addr[0-9a-z_-]*1[0-9a-z]{8,}$/i.test(input.recipientShieldedAddress.trim())) {
    return 'That is not an address this Passport can pay.';
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
  return null;
}

/** The one transaction, or a throw carrying the refusal. */
export function planCustodyShieldedAddressSend(
  input: CustodyShieldedAddressSendPlanInput,
): CustodyShieldedAddressSendPlan {
  const refusal = custodyShieldedAddressSendRefusal(input);
  if (refusal !== null) throw new Error(refusal);
  return {
    operation: 'withdraw_shielded',
    colourHex: input.colourHex,
    amount: input.amount,
    recipientShieldedAddress: input.recipientShieldedAddress.trim(),
    coin: input.heldCoin as CustodyHeldCoinPlan,
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

/** The coin a direct transfer handed the recipient's account. */
export interface CustodySentCoinDescription {
  readonly nonce: string;
  readonly colour: string;
  readonly value: bigint;
}

/** What `withdraw_shielded_to_contract_with_k256` returned. */
export interface CustodyDirectSpend {
  /** The coin the recipient's own claim must carry. Null when unreadable. */
  readonly sent: CustodySentCoinDescription | null;
  /** The change the account kept, read the same way the baseline spend's is. */
  readonly change: CustodyChangeCoin;
}

/**
 * Read `[sent, change]` off the direct transfer's own result.
 *
 * THE FIRST HALF IS NOT OPTIONAL AND THE SECOND HALF IS. `sent` is the stdlib's
 * `SendResult.sent` — the coin now owned by the recipient's contract, whose
 * nonce is the deterministic evolution of the input coin's — and it is the ONLY
 * description of that coin that will ever exist: the chain carries the note,
 * not what it is. The recipient's claim seals it into their inbox, so a `sent`
 * this build cannot read is a payment that must not be sent at all. `change` is
 * a `Maybe` for the ordinary reason: a spend that consumed the coin exactly
 * leaves none.
 *
 * Read from the UNPROVEN call, before anything has left the tab, which is what
 * makes "do not send it" an option rather than a regret.
 */
export function directSpendFromResult(result: unknown): CustodyDirectSpend {
  const unreadable: CustodyChangeCoin = {
    outcome: 'unreadable',
    reason: 'The payment went out and this Passport could not read what was left over.',
  };
  if (!Array.isArray(result) || result.length < 2) {
    return { sent: null, change: unreadable };
  }
  const first = result[0] as { nonce?: unknown; color?: unknown; value?: unknown } | null;
  const nonce = hexOf(first?.nonce);
  const colour = hexOf(first?.color);
  const value = first?.value;
  const sent =
    nonce === null || colour === null || typeof value !== 'bigint' || value < 0n
      ? null
      : { nonce, colour, value };
  return { sent, change: changeCoinFromResult(result[1]) };
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
/**
 * The text {@link spendPositionMayBeWrong} judges — an error's NAME as well as
 * its message.
 *
 * A WebAssembly trap arrives as `name: 'RuntimeError'`, `message: 'unreachable'`,
 * and `Error.prototype.message` alone is therefore the word `unreachable` with
 * nothing in it to recognise. Reading the message alone is why the retry did not
 * fire on the second live attempt of 2026/09/18 even after the predicate had
 * been corrected: the predicate was right and was being handed half the evidence.
 */
export function spendFailureText(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause);
  /* `Error.name` is a string by the type, so it is not guarded for: what IS
     guarded for is a name that says nothing (empty) or one the message already
     carries, either of which would only pad the text. */
  const { name, message } = cause;
  if (name.length === 0 || message.includes(name)) return message;
  return `${name}: ${message}`;
}

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
     `RuntimeError: unreachable` out of the ledger WASM (live, 2026/09/18:
     D1 at stored position 3813 against a coin the chain had moved to 3814).

     IT USED TO REQUIRE `executing scoped transaction` BESIDE IT, which was
     midnight-js's `scoped()` wrapper talking. This build composes its own
     transaction and never calls `scoped()`, so that text is never present and
     the clause made the predicate always false — the retry could not fire at
     all (defect 19). The clause is gone.

     WHAT MAKES THE BARE MATCH SAFE is not this function. The review of
     2026/09/18 was right that `RuntimeError` marks every WebAssembly trap in
     the stack, submission included, and that a retry costs an approval. The
     caller no longer asks this question at all once a proof has come back:
     `spendShieldedK1` tracks the proof boundary and only consults the wording
     while the transaction is still provably in its own hands. Phase decides
     whether a retry is SAFE; this decides whether it is WORTH it. */
  return text.includes('runtimeerror');
}

/* -------------------------------------------------------------------------- */
/* The change, written into this account's own inbox                          */
/* -------------------------------------------------------------------------- */

/** Whether the change a spend left is worth an inbox entry, and what goes in it. */
export type CustodyChangeBackfill =
  | { readonly kind: 'skip'; readonly reason: string }
  | {
      readonly kind: 'append';
      readonly ownEncKeyHex: string;
      readonly coin: { readonly colour: string; readonly nonce: string; readonly value: bigint };
    };

/**
 * Whether to back the change coin up into this account's own inbox.
 *
 * WHY A SPEND'S CHANGE NEEDS ONE AT ALL (MIP-0012 §6.3, INV-4). The change
 * comes back as the circuit's own return value, travelling privately in the
 * transaction's communication commitment — so the only copy of its description
 * in the world is the one this tab wrote to its own store. A second device, or
 * this one after its storage is cleared, has nothing to walk: the chain carries
 * the note, not what it is. `append_inbox` seals that description to the
 * account's own encryption key and puts it where any device holding the
 * viewing secret can find it.
 *
 * IT IS NEVER PART OF THE PAYMENT. The recipient has their money the moment
 * the send lands; this is the sender tidying up after it, so it runs after the
 * send has been reported and a failure costs the record, not the money.
 *
 * SKIPPED, NOT FAILED, when there is nothing to describe: a spend that consumed
 * the coin exactly leaves no change, and one whose change this build could not
 * read has nothing to seal. An account that publishes no usable encryption key
 * is the third: sealing to a key that is not one produces an entry nobody can
 * open, which is worse than no entry at all.
 */
export function custodyChangeBackfill(
  change: CustodyChangeCoin,
  ownEncKeyHex: string | null | undefined,
): CustodyChangeBackfill {
  if (change.outcome === 'none') {
    return { kind: 'skip', reason: 'the payment consumed the whole coin, so there is no change' };
  }
  if (change.outcome === 'unreadable') {
    return { kind: 'skip', reason: 'this build could not read the change to describe it' };
  }
  const key = normalisedEncKey(ownEncKeyHex);
  if (key === null) {
    return { kind: 'skip', reason: 'this account publishes no encryption key to seal it to' };
  }
  return {
    kind: 'append',
    ownEncKeyHex: key,
    coin: { colour: change.colour, nonce: change.nonce, value: change.value },
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

/**
 * Where a shielded send got to.
 *
 * TWO, BECAUSE A SEND IS ONE TRANSACTION (2026/09/18). It used to be six: the
 * value left the account into this Passport's own wallet, waited there to be
 * identified, and a third transaction made it the recipient's — so there were
 * four ways to stop with money in a place neither party owned, and each needed
 * its own sentence. A Passport's value now lives in its account and moves in
 * one transaction, so there is nothing in between to be in: it either landed or
 * it did not.
 */
export type CustodyShieldedSendStage =
  /** The transaction is out. Nothing has left the account unless it lands. */
  | 'sending'
  /** It landed. The recipient has it. */
  | 'done';

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
  /** What the person typed — a name, or a shielded address they pasted. */
  readonly recipientLabel: string;
  readonly recipientAccountAddress: string;
  /** The one transaction, once there is an id for it. */
  readonly sendTxId: string | null;
  readonly startedAt: number;
  /** When the transaction was handed to the network, or null before that. */
  readonly sentAt?: number | null;
  /**
   * What the submit wrote to the coin store, so a payment found NOT to have
   * reached the chain after a reload is taken back exactly as the tab that
   * sent it would have taken it back. Decimal strings for the two integers.
   */
  readonly undo?: CustodySendUndo | null;
}

/** The coin-store write a submit made, as it is stored. */
export interface CustodySendUndo {
  readonly held: {
    readonly colour: string;
    readonly nonce: string;
    readonly value: string;
    readonly mtIndex: string;
  };
  readonly change: { readonly colour: string; readonly nonce: string } | null;
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
    stage: 'sending',
    colourHex: input.colourHex,
    amount: input.amount.toString(),
    recipientLabel: input.recipientLabel,
    recipientAccountAddress: input.recipientAccountAddress,
    sendTxId: null,
    startedAt: input.now,
  };
}

/**
 * Every stage a stored record may be in — the list a record is READ BACK
 * against, so a stage missing from it is a record that vanishes on reload.
 *
 * A record that will not parse is a record the screen reads as "no payment in
 * flight", so a reload replaces the one sentence that says what happened with
 * silence. That is why the list is written down rather than inferred — a stage
 * was left out of it once (2026/09/17) and the cost was exactly that: the
 * record written at the one moment nobody can see which side holds the value
 * was the record a reload threw away.
 */
const SHIELDED_SEND_STAGES: readonly CustodyShieldedSendStage[] = ['sending', 'done'];

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
    sendTxId: typeof candidate.sendTxId === 'string' ? candidate.sendTxId : null,
    startedAt: typeof candidate.startedAt === 'number' ? candidate.startedAt : 0,
    /* Only where written, so a record from before these existed reads back
       exactly as it was stored. */
    ...(typeof candidate.sentAt === 'number' ? { sentAt: candidate.sentAt } : {}),
    ...(undoFromRow(candidate.undo) !== null ? { undo: undoFromRow(candidate.undo) } : {}),
  };
}

const DECIMAL = /^(0|[1-9][0-9]*)$/;

function undoFromRow(row: unknown): CustodySendUndo | null {
  if (!row || typeof row !== 'object') return null;
  const candidate = row as { held?: unknown; change?: unknown };
  const held = candidate.held as Record<string, unknown> | undefined;
  if (
    !held ||
    typeof held !== 'object' ||
    typeof held.colour !== 'string' ||
    typeof held.nonce !== 'string' ||
    typeof held.value !== 'string' ||
    !DECIMAL.test(held.value) ||
    typeof held.mtIndex !== 'string' ||
    !DECIMAL.test(held.mtIndex)
  ) {
    return null;
  }
  const change = candidate.change as Record<string, unknown> | null | undefined;
  const changeRow =
    change && typeof change === 'object' && typeof change.colour === 'string' && typeof change.nonce === 'string'
      ? { colour: change.colour, nonce: change.nonce }
      : null;
  return {
    held: { colour: held.colour, nonce: held.nonce, value: held.value, mtIndex: held.mtIndex },
    change: changeRow,
  };
}

/**
 * What a stopped payment with a transaction behind it came to, from what the
 * chain can say (2026/09/22).
 *
 *   `landed`      the indexer has the transaction.
 *   `not-landed`  the indexer answered that it does not, and the wait a
 *                 submitted payment is given has run out since it was sent.
 *   `checking`    anything else: inside the wait, or an indexer that could not
 *                 be asked. Never a guess either way.
 *
 * `onChain` is `true`, `false`, or `null` for "could not be asked".
 */
export function custodyStoppedSendVerdict(input: {
  readonly record: CustodyShieldedSendRecord;
  readonly onChain: boolean | null;
  readonly now: number;
}): 'landed' | 'not-landed' | 'checking' {
  if (input.onChain === true) return 'landed';
  const sentAt = input.record.sentAt ?? input.record.startedAt;
  if (input.onChain === false && input.now - sentAt >= CUSTODY_SUBMIT_WAIT_MS) return 'not-landed';
  return 'checking';
}

/** The sentence for each verdict, about the person it was paid to. */
export function custodyStoppedSendSentence(
  record: CustodyShieldedSendRecord,
  verdict: 'landed' | 'not-landed' | 'checking',
): string {
  const who = record.recipientLabel.trim().length > 0 ? record.recipientLabel.trim() : 'them';
  if (verdict === 'landed') return `Sent. ${who} has it.`;
  if (verdict === 'not-landed') return CUSTODY_SEND_NOT_SENT;
  return `Checking whether your payment to ${who} went through…`;
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
 * What a run that found a record should do with it.
 *
 * `'nothing'` for a payment that landed, and `'report'` for one that was in
 * flight when the tab went away. THERE IS NO `'finish'` ANY MORE, and its
 * absence is the point: a send is one transaction, so there is no leg left for
 * anybody to run and nothing for a button to do. What is owed is a sentence,
 * and the sentence is the truth — the transaction either landed or it did not,
 * and the balance on screen says which.
 */
export function nextCustodyShieldedSendStep(
  record: CustodyShieldedSendRecord,
): 'report' | 'nothing' {
  return record.stage === 'sending' ? 'report' : 'nothing';
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
  if (record.stage === 'done') return `Sent. ${who} has it.`;
  /* NO TRANSACTION EVER EXISTED, so there is a stronger thing to say than the
     one below, and saying the weaker one would be hedging about money that
     demonstrably never moved. `sendTxId` is written on the `confirm` phase, the
     moment the transaction has an id; a record still holding `null` was
     abandoned before that — the approval was dismissed, the proving service did
     not answer, the position could not be proved — and in every one of those
     the coin is untouched in the account. */
  if (record.sendTxId === null) return 'Nothing was sent, and it is all still in your Passport.';
  /* ONE TRANSACTION, SO ONE OF TWO THINGS. Either the chain took it and ${who}
     has the money, or it did not and the money never left — there is no third
     place for it to be, which is the whole of what the one-transaction send
     buys a person whose tab closed half-way. The balance is the answer and it
     is on the screen this sentence is shown beside, so the sentence points at
     it rather than offering a button that would have nothing to do. */
  /* A TRANSACTION EXISTS, and what it came to is asked of the chain by the
     screen (`custodyStoppedSendVerdict`). Until that answers, the sentence says
     it is being checked — never a hedge that leaves the reader to work it out. */
  return custodyStoppedSendSentence(record, 'checking');
}
