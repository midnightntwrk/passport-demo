import * as ledger from '@midnightntwrk/ledger-v9';
import { createPassportContractTxRequest, type PassportContractTransactionIntent } from '@midnight-passport/connect';

export type CheckedContractTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>;

export { contractRequestSourceMatches } from './contractTxSource.js';

/** Validate independently of the app's purpose string, before consent and again before signing. */
export function inspectContractTransaction(intent: PassportContractTransactionIntent, networkId: string, now = Date.now()): CheckedContractTransaction {
  createPassportContractTxRequest({ ...intent, requestId: 'inspect', nonce: 'inspect' });
  if (networkId !== 'stagenet' || intent.networkId !== networkId) throw new Error('This contract request belongs to a different network.');
  const bytes = Uint8Array.from(intent.transaction.match(/../g)!, (byte) => Number.parseInt(byte, 16));
  const tx = ledger.Transaction.deserialize<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>('signature', 'proof', 'pre-binding', bytes);
  assertRestrictedContractTransaction(tx, intent, now);
  return tx;
}

/** The pinned ledger has no network getter. Its own rendering supplies the network discriminator. */
export function assertRestrictedContractTransaction(tx: CheckedContractTransaction, intent: PassportContractTransactionIntent, now = Date.now()): void {
  if (!/^StandardTransaction\s*\{\s*network_id: "stagenet",/.test(tx.toString())) throw new Error('The serialised transaction is not a stagenet transaction.');
  if (tx.rewards || tx.guaranteedOffer || (tx.fallibleOffer?.size ?? 0) > 0) throw new Error('Shielded assets and rewards are not supported by this contract approval.');
  if (!tx.intents || tx.intents.size !== 1) throw new Error('Exactly one transaction intent is required.');
  for (const [segment, part] of tx.intents) {
    if (part.guaranteedUnshieldedOffer || part.fallibleUnshieldedOffer || part.dustActions) throw new Error('This request contains asset or fee inputs. Only calls without asset transfers are supported.');
    if (part.actions.length !== 1 || !(part.actions[0] instanceof ledger.ContractCall)) throw new Error('Exactly one contract call is required; deployment and maintenance requests are unsupported.');
    const call = part.actions[0];
    const address = String(call.address).toLowerCase().replace(/^0x/, '').replace(/^0200(?=[0-9a-f]{64}$)/, '');
    const entryPoint = typeof call.entryPoint === 'string' ? call.entryPoint : new TextDecoder('utf-8', { fatal: true }).decode(call.entryPoint);
    if (address !== intent.contractAddress || entryPoint !== intent.entryPoint) throw new Error('The transaction calls a different contract or circuit from the approval request.');
    const expires = part.ttl.getTime();
    if (!Number.isFinite(expires) || expires <= now + 15_000 || expires > now + 30 * 60_000) throw new Error('The transaction expires too soon or has an excessive lifetime. Rebuild it.');
    if ([...tx.imbalances(segment, 0n).values()].some((amount) => amount !== 0n)) throw new Error('This contract call requires an asset transfer, which this approval does not support.');
  }
}

/** A sponsor may append DUST fee intents, but may not replace or extend the approved call. */
export function assertSponsoredContractTransaction(approved: CheckedContractTransaction, candidate: ledger.FinalizedTransaction, now = Date.now()): void {
  if (!/^StandardTransaction\s*\{\s*network_id: "stagenet",/.test(candidate.toString())) throw new Error('The sponsored transaction is not a stagenet transaction.');
  if (candidate.rewards || candidate.guaranteedOffer || (candidate.fallibleOffer?.size ?? 0) > 0) throw new Error('The sponsor added an unsupported asset interaction.');
  if (!approved.intents || approved.intents.size !== 1 || !candidate.intents) throw new Error('The sponsor omitted the approved transaction.');
  const approvedIds = approved.identifiers();
  const candidateIds = new Set(candidate.identifiers());
  if (!approvedIds.length || approvedIds.some(id => !candidateIds.has(id))) throw new Error('The sponsor returned a different transaction.');
  for (const [segment, original] of approved.intents) {
    const retained = candidate.intents.get(segment);
    if (!retained || retained.intentHash(segment) !== original.intentHash(segment)) throw new Error('The sponsor changed the approved contract intent.');
  }
  for (const [segment, part] of candidate.intents) {
    const expiry = part.ttl.getTime();
    if (!Number.isFinite(expiry) || expiry <= now) throw new Error('The sponsored transaction expired before submission. Rebuild it.');
    if (part.guaranteedUnshieldedOffer || part.fallibleUnshieldedOffer) throw new Error('The sponsor added an unsupported asset transfer.');
    if (approved.intents.has(segment)) {
      if (part.actions.length !== 1 || !(part.actions[0] instanceof ledger.ContractCall)) throw new Error('The sponsor replaced the approved contract call.');
    } else if (part.actions.length !== 0) throw new Error('The sponsor added an unapproved contract action.');
  }
}
