import type { PassportContractTransactionIntent } from '@midnight-passport/connect';
import { inspectContractTransaction, assertSponsoredContractTransaction } from './contractTxApproval.js';
import type { walletProviderFor } from '../identity/contractRuntime.js';

/** Called only after the current account has approved this exact request. */
export async function executeAppContract(intent: PassportContractTransactionIntent, provider: ReturnType<typeof walletProviderFor>, sameSession: () => boolean = () => true) {
  const approved = inspectContractTransaction(intent, 'stagenet');
  const txId = approved.identifiers()[0];
  if (!txId) throw new Error('This transaction has no identifier. Nothing was submitted.');
  const key = `passport:contract-submission:${txId}`;
  // Retain a pending identifier before the network write. A lost response or
  // a reload must not offer another, freshly built transaction as a retry.
  if (sessionStorage.getItem(key)) return { txId };
  const balanced = await provider.balanceTx(approved, [...approved.intents!.values()][0].ttl);
  assertSponsoredContractTransaction(inspectContractTransaction(intent, 'stagenet'), balanced);
  if (!sameSession()) throw new Error('The Passport session changed. Nothing was submitted.');
  sessionStorage.setItem(key, new Date().toISOString());
  try {
    const returned = await provider.submitTx(balanced);
    if (typeof returned !== 'string' || !balanced.identifiers().includes(returned)) {
      // The exact approved identifier remains the reconciliation key.
      return { txId };
    }
    return { txId };
  } catch (cause) {
    if (/Invalid Transaction|\b1010\b/i.test(cause instanceof Error ? cause.message : String(cause))) {
      sessionStorage.removeItem(key);
      throw cause;
    }
    // Submission was attempted. The app must reconcile this ID, never report
    // a connection loss as a rejection or automatically prepare another call.
    return { txId };
  }
}
