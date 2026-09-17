/**
 * The wallet's own shielded transfer — value moving from this Passport's
 * WALLET to somebody else's address, with no contract in it at all.
 *
 * WHY THIS EXISTS (2026/09/17)
 * ---------------------------
 * A shielded send to a raw `mn_shield-addr…` used to be one transaction: a
 * PARTIAL `withdraw_shielded` straight out of the sender's account to the
 * recipient. That is the branch of the deployed contract that splits the
 * account's coin and re-registers the remainder — and the remainder is a coin
 * the network refuses every later withdrawal against. One such send therefore
 * cost the Passport every shielded send after it, for as long as the Passport
 * existed. Otrix reproduced it on several accounts: the first mUSD send landed,
 * and every one after it was refused.
 *
 * The contract cannot be changed — altering a circuit changes the verifier keys
 * and strands every Passport already deployed — so the CLIENT stops asking for
 * a partial withdrawal. A send to an address now takes the same three legs a
 * send to a name has taken since 2026/09/03:
 *
 *   1. `withdraw_shielded(whole: true)` — the account's WHOLE coin out to the
 *      sender's own shielded address. The safe branch;
 *   2. THIS MODULE — a plain shielded transfer of what is owed, out of the
 *      sender's wallet, to the recipient's address;
 *   3. `deposit_shielded` — the sender's own change, back into their account.
 *
 * Leg two is the one that had no home. Legs one and three are account-custody
 * circuits and live in `./accountCustody.ts`; this one touches no contract, so
 * it is its own module rather than a circuit-shaped function that calls none.
 *
 * WHAT IT SHARES WITH A CONTRACT CALL, AND WHY
 * -------------------------------------------
 * Everything after the recipe: the sponsor gate, the sign → prove → hand to the
 * sponsor → deserialise dance, the bounded submit, the rule that hands a fee
 * booking back when the node refuses, and the per-stage timings a console reads
 * back. All of that is `walletProviderFor` in `./contractRuntime.ts`, reached
 * through the `balanceRecipeTx` seam added with this module — so there is one
 * implementation of the sponsored path and not two that can drift.
 *
 * WHAT IT DOES NOT DO. It never pays its own fee: `payFees: false` leaves the
 * transaction short and the fee sponsor covers it, which is the same
 * arrangement every other write in this app has. A Passport holder is never the
 * second payer.
 */

import type { LocalMidnightWallet } from '../lib/localWallet.js';
import {
  resolveTxHashOnce,
  wait,
  walletProviderFor,
} from './contractRuntime.js';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * How long the transfer may sit unincluded before the ledger drops it.
 *
 * Thirty minutes, the same window a contract call gets — long enough that a
 * sponsor round trip and a slow block cannot expire it, short enough that a
 * transaction nobody submitted does not keep the wallet's coins booked for an
 * afternoon.
 */
export const TRANSFER_TTL_MS = 30 * 60 * 1_000;

/** The window the indexer has to map an identifier to a ledger hash. */
const TX_HASH_ATTEMPTS = 20;
const TX_HASH_INTERVAL_MS = 500;

/* -------------------------------------------------------------------------- */
/* Failures                                                                   */
/* -------------------------------------------------------------------------- */

export type WalletTransferErrorCode =
  /** A malformed colour, address, or amount — refused before anything is built. */
  | 'invalid-request'
  /** A recipient address that belongs to a different Midnight network. */
  | 'wrong-network';

/**
 * A refusal this module made itself, before anything was built or submitted.
 *
 * Everything the SDK, the sponsor, or the node refuses travels UNTOUCHED, and
 * deliberately: `lib/sendLegs.ts` walks the cause chain to decide whether a leg
 * is worth attempting again, and a failure flattened into a sentence here is a
 * failure it can no longer read. The same rule `AccountCustodyError` keeps.
 */
export class WalletTransferError extends Error {
  constructor(
    readonly code: WalletTransferErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'WalletTransferError';
  }
}

/* -------------------------------------------------------------------------- */
/* The pure half                                                              */
/* -------------------------------------------------------------------------- */

/** How far the transfer has got, in the same words a contract call reports. */
export interface WalletTransferProgress {
  phase: 'checking' | 'submitting' | 'confirming';
}

export interface ShieldedTransferRequest {
  /** The ledger colour being moved, as 64 hex characters. */
  tokenType: string;
  /** Atomic units. */
  amount: bigint;
  /** The recipient's full `mn_shield-addr…`. */
  recipientShieldedAddress: string;
}

/** What one transfer did, in the same shape a contract call answers with. */
export interface WalletTransferResult {
  /**
   * The transaction, resolved to the ledger HASH an explorer takes where the
   * indexer could answer, and left as the identifier where it could not.
   */
  txId: string;
  /** Whether {@link txId} is the resolved hash, so a surface may link it. */
  txIdResolved: boolean;
  /** The network the wallet actually signed on. */
  network: string;
  submittedAt: string;
}

/**
 * Refuses an amount that could never be transferred, before anything is built.
 *
 * Separate from the transfer itself because it is a RULE and rules are drilled
 * directly — see `walletTransfer.test.ts`. A zero or negative transfer is not a
 * transfer, and a wallet asked to make one builds a transaction the node would
 * refuse for a reason nobody could act on.
 */
export function requireTransferableAmount(amount: bigint): void {
  if (typeof amount !== 'bigint') {
    throw new WalletTransferError(
      'invalid-request',
      'A transfer must be an amount in atomic units.',
    );
  }
  if (amount <= 0n) {
    throw new WalletTransferError('invalid-request', 'A transfer must be greater than zero.');
  }
}

/**
 * The outputs a shielded transfer is made of — ONE, to one address.
 *
 * The facade takes a list of transfer groups, each with its own ledger and its
 * own outputs, and this shape is the whole of what leg two needs: one colour,
 * one amount, one recipient. It is built here rather than inline so the shape
 * can be asserted without a wallet, a prover, or a chain.
 *
 * `receiverAddress` is the DECODED address object and not the string it came
 * from: the facade resolves the recipient's encryption key off it to build the
 * note's ciphertext, exactly as `withdraw_shielded` needs the same key handed
 * to it as a mapping.
 */
export function shieldedTransferOutputs(input: {
  tokenType: string;
  amount: bigint;
  receiverAddress: unknown;
}): readonly { type: 'shielded'; outputs: readonly unknown[] }[] {
  return [
    {
      type: 'shielded',
      outputs: [
        {
          type: input.tokenType,
          receiverAddress: input.receiverAddress,
          amount: input.amount,
        },
      ],
    },
  ];
}

/**
 * `mainnet` arrives from the codec as a symbol; every other network is a
 * string. The same reading `./accountCustody.ts` makes, for the same codec.
 */
function parsedNetworkName(value: unknown): string {
  return typeof value === 'string' ? value : 'mainnet';
}

/**
 * Decodes an `mn_shield-addr…` and refuses one from another network.
 *
 * The same two refusals `decodeShieldedRecipient` makes in
 * `./accountCustody.ts`, and they are not optional: a shielded transfer to an
 * address from another network is unrecoverable, and a string that is not a
 * shielded address at all would otherwise fail inside the SDK, unreadably,
 * after the person had already touched their authenticator for leg one.
 */
export async function decodeShieldedReceiver(
  address: string,
  networkId: string,
): Promise<unknown> {
  const { MidnightBech32m, ShieldedAddress } = await import(
    '@midnight-ntwrk/wallet-sdk/address-format'
  );
  let parsed;
  try {
    parsed = MidnightBech32m.parse(address.trim());
  } catch (cause) {
    throw new WalletTransferError('invalid-request', 'That is not a Midnight address.', {
      cause,
    });
  }
  const recipientNetwork = parsedNetworkName(parsed.network);
  if (recipientNetwork !== networkId) {
    throw new WalletTransferError(
      'wrong-network',
      `That address belongs to the ${recipientNetwork} network; this Passport is on ${networkId}.`,
    );
  }
  try {
    return parsed.decode(ShieldedAddress, networkId);
  } catch (cause) {
    throw new WalletTransferError(
      'invalid-request',
      'That is a Midnight address, but not a shielded (mn_shield-addr…) one.',
      { cause },
    );
  }
}

/* -------------------------------------------------------------------------- */
/* The half that moves money                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Pays `amount` of one shielded colour from this wallet to an address.
 *
 * THE COINS IT SPENDS ARE THE WALLET'S OWN, and on the send this exists for
 * that means the note leg one paid in. The facade's balancing picks it, funds
 * the output, and returns the difference as a fresh note in the same wallet —
 * which is exactly the shape leg three then puts back into the account, and
 * exactly the shape it already handled when leg two was a `deposit_shielded`
 * into a recipient's account. Nothing about the change note is new; what is new
 * is only who received the amount.
 *
 * THE FEE IS THE SPONSOR'S. `payFees: false` leaves the transaction short, and
 * `balanceRecipeTx` refuses to produce it at all unless the sponsor has said it
 * will cover the difference.
 */
export async function transferShieldedFromWallet(
  handle: LocalMidnightWallet,
  request: ShieldedTransferRequest,
  onPhase?: (progress: WalletTransferProgress) => void,
): Promise<WalletTransferResult> {
  onPhase?.({ phase: 'checking' });
  requireTransferableAmount(request.amount);
  const receiverAddress = await decodeShieldedReceiver(
    request.recipientShieldedAddress,
    handle.network.networkId,
  );

  const facade = handle.facade as unknown as {
    transferTransaction(
      outputs: readonly unknown[],
      secretKeys: unknown,
      options: { ttl: Date; payFees?: boolean },
    ): Promise<unknown>;
  };
  const provider = walletProviderFor(handle);

  onPhase?.({ phase: 'submitting' });
  const finalized = await provider.balanceRecipeTx(
    (ttl) =>
      facade.transferTransaction(
        shieldedTransferOutputs({
          tokenType: request.tokenType,
          amount: request.amount,
          receiverAddress,
        }),
        {
          shieldedSecretKeys: handle.keys.shieldedSecretKeys,
          dustSecretKey: handle.keys.dustSecretKey,
        },
        { ttl, payFees: false },
      ),
    new Date(Date.now() + TRANSFER_TTL_MS),
  );
  const identifier = String(await provider.submitTx(finalized));

  onPhase?.({ phase: 'confirming' });
  const { txId, resolved } = await resolveTransferHash(
    handle.network.indexerHttpUrl,
    identifier,
  );
  return {
    txId,
    txIdResolved: resolved,
    network: handle.network.networkId,
    submittedAt: new Date().toISOString(),
  };
}

/**
 * The identifier the submit answered with, mapped to the ledger hash where the
 * indexer can do it — and left as itself where it cannot, never fabricated.
 * The same ten-second window a contract call gets, for the same reason: a
 * lagging indexer costs a link, never a wrong one.
 */
async function resolveTransferHash(
  indexerHttpUrl: string,
  identifier: string,
): Promise<{ txId: string; resolved: boolean }> {
  for (let attempt = 0; attempt < TX_HASH_ATTEMPTS; attempt += 1) {
    const hash = await resolveTxHashOnce(indexerHttpUrl, identifier);
    if (hash) return { txId: hash, resolved: true };
    if (attempt + 1 < TX_HASH_ATTEMPTS) await wait(TX_HASH_INTERVAL_MS);
  }
  return { txId: identifier, resolved: false };
}
