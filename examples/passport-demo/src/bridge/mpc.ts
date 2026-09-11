// The MPC round trip for a deposit: wait for the MPC to sign the EVM sweep,
// broadcast it to Sepolia, then wait for the MPC's attestation of the result.
// Modelled directly on the sig.network reference webapps (full-stack-demo /
// Collateral-Warehouse), adapted to Passport's providers + config.
//
// NOTE: not build- or run-verified here. The event-log reads, the EVM broadcast,
// and the responder output fetch only prove out against live stagenet + Sepolia
// + the deployed responder; validate before relying on it.

import {
  deriveMidnightResponseKey,
  deserializeEvmOutput,
  MPC_FAILURE_OUTPUT,
  type RequestIdHex,
  serializeRespondOutput,
  signBidirectionalEventToSignedEvmTransaction,
} from '@sig-net/midnight';
import { JsonRpcProvider, type Transaction } from 'ethers';

import type { BridgeConfig } from './config.js';
import { makeResponseReader, type VaultConnection } from './vaultClient.js';
import { RESULT_SCHEMA } from './vaultConstants.js';

const MINUTE = 60_000;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The resolved outcome of a settled deposit request. */
export interface RespondOutcome {
  /** The attested respond-bidirectional event (fed verbatim to `claim`). */
  readonly event: unknown;
  /** The recomputed serialized output the attestation verifies over. */
  readonly serializedOutput: Uint8Array;
  /** True when the EVM transfer succeeded (a failed sweep mints nothing). */
  readonly succeeded: boolean;
  /** True when the MPC attested the fixed failure output. */
  readonly matchedFailureOutput: boolean;
  /** The Sepolia tx hash, when known. */
  readonly evmTxHash?: string;
}

/** The current EVM nonce of an address (the deposit sweep's sender). */
export async function evmNonce(config: BridgeConfig, address: string): Promise<bigint> {
  const provider = new JsonRpcProvider(config.sepoliaRpcUrl);
  return BigInt(await provider.getTransactionCount(address));
}

/** Fetch the responder's cached raw EVM output for a request (used to recompute the output bytes). */
async function fetchResponderOutput(
  config: BridgeConfig,
  requestId: RequestIdHex,
  timeoutMs = 30_000,
): Promise<{ success?: boolean; output?: string } | undefined> {
  const url = `${config.responsesUrl}/responses/${requestId}`;
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      const r = await fetch(url);
      if (r.ok) return (await r.json()) as { success?: boolean; output?: string };
    } catch {
      /* transient — retry until the deadline */
    }
    await sleep(1000);
  } while (Date.now() < deadline);
  return undefined;
}

/** Stage 1: poll the signet contract until the MPC signature appears, and return the signed EVM tx. */
export async function pollSignatureResponse(
  connection: VaultConnection,
  config: BridgeConfig,
  requestId: RequestIdHex,
  expectedSigner: string,
  timeoutMs = 6 * MINUTE,
): Promise<Transaction> {
  const reader = makeResponseReader(connection, config);
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const { verified } = await reader.getVerifiedSignatureRespondedEvent(requestId, expectedSigner);
    if (verified !== undefined) {
      const request = await reader.getSignatureRequest(requestId);
      return signBidirectionalEventToSignedEvmTransaction(
        request,
        verified,
      ) as unknown as Transaction;
    }
    await sleep(1000);
  }
  throw new Error(`timed out waiting for MPC signature on request ${requestId}`);
}

/** Broadcast the MPC-signed EVM tx to Sepolia. Idempotent: the signed tx is content-addressed. */
export async function broadcastEvm(config: BridgeConfig, tx: Transaction): Promise<void> {
  const provider = new JsonRpcProvider(config.sepoliaRpcUrl);
  const { hash } = tx;
  if (!hash) throw new Error('signed EVM tx has no hash');
  const mined = await provider.getTransactionReceipt(hash);
  if (mined) return; // a revert still gets attested; the caller reads the outcome
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; ; attempt++) {
    try {
      await provider.broadcastTransaction(tx.serialized);
      break;
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? '').toLowerCase();
      const code = (e as { code?: string })?.code;
      if (code === 'NONCE_EXPIRED' || msg.includes('already known') || msg.includes('nonce too low'))
        break;
      if (attempt >= MAX_ATTEMPTS) throw e;
      await sleep(2000);
    }
  }
  await provider.waitForTransaction(hash, 1, 3 * MINUTE);
}

/** Stage 2: recompute the output bytes and return the first candidate the MPC attestation verifies. */
async function fetchAttestedRespondOutcome(
  connection: VaultConnection,
  config: BridgeConfig,
  requestId: RequestIdHex,
): Promise<RespondOutcome | undefined> {
  const reader = makeResponseReader(connection, config);
  const mpcResponseKey = deriveMidnightResponseKey(
    config.mpcSecp256k1Pubkey,
    config.vaultContractAddress,
  );
  const cached = await fetchResponderOutput(config, requestId).catch(() => undefined);

  const candidates: { serializedOutput: Uint8Array; isFailure: boolean; succeeded: boolean }[] = [];
  if (cached?.success && cached.output != null) {
    try {
      const decoded = deserializeEvmOutput(RESULT_SCHEMA as never, cached.output) as {
        success?: boolean;
      };
      candidates.push({
        serializedOutput: serializeRespondOutput(RESULT_SCHEMA as never, decoded as never),
        isFailure: false,
        succeeded: decoded.success === true,
      });
    } catch {
      /* only the failure candidate can match */
    }
  }
  candidates.push({ serializedOutput: MPC_FAILURE_OUTPUT, isFailure: true, succeeded: false });

  for (const c of candidates) {
    const event = await reader.getVerifiedRespondBidirectionalEvent(
      requestId,
      c.serializedOutput,
      mpcResponseKey,
    );
    if (event) {
      return {
        event,
        serializedOutput: c.serializedOutput,
        succeeded: c.succeeded,
        matchedFailureOutput: c.isFailure,
      };
    }
  }
  return undefined;
}

/** Sign (poll) → broadcast → attest (poll): the whole MPC round trip for one request. */
export async function settleViaMpc(
  connection: VaultConnection,
  config: BridgeConfig,
  requestId: RequestIdHex,
  expectedSigner: string,
): Promise<RespondOutcome> {
  const signed = await pollSignatureResponse(connection, config, requestId, expectedSigner);
  await broadcastEvm(config, signed);
  const end = Date.now() + 6 * MINUTE;
  while (Date.now() < end) {
    const outcome = await fetchAttestedRespondOutcome(connection, config, requestId);
    if (outcome) return { ...outcome, evmTxHash: signed.hash ?? undefined };
    await sleep(1000);
  }
  throw new Error(`timed out waiting for MPC attestation on request ${requestId}`);
}
