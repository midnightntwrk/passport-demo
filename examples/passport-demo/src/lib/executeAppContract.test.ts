import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeAppContract } from './executeAppContract.js';
import { assertSponsoredContractTransaction } from './contractTxApproval.js';
import type { PassportContractTransactionIntent } from '@midnight-passport/connect';

const txId = '00' + 'ac'.repeat(32);
vi.mock('./contractTxApproval.js', () => ({
  inspectContractTransaction: () => ({ identifiers: () => ['00' + 'ac'.repeat(32)], intents: new Map([[0, { ttl: new Date(Date.now() + 60_000) }]]) }),
  assertSponsoredContractTransaction: vi.fn(),
}));
const intent = { networkId: 'stagenet', entryPoint: 'reserveOffer', contractAddress: 'ab'.repeat(32), transaction: 'checked by fixture', purpose: 'Reserve offer' } as PassportContractTransactionIntent;
function provider(submit = vi.fn().mockResolvedValue(txId)) {
  return { balanceTx: vi.fn().mockResolvedValue({ identifiers: () => [txId] }), submitTx: submit } as unknown as Parameters<typeof executeAppContract>[1];
}
beforeEach(() => {
  vi.clearAllMocks();
  const store = new Map<string, string>();
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) });
});
afterEach(() => vi.unstubAllGlobals());
describe('Passport submission recovery', () => {
  it('retains the exact identifier after a lost node reply and never resubmits it', async () => {
    const submit = vi.fn().mockRejectedValue(new Error('connection lost'));
    const wallet = provider(submit);
    expect(await executeAppContract(intent, wallet)).toEqual({ txId });
    expect(sessionStorage.getItem(`passport:contract-submission:${txId}`)).toBeTruthy();
    expect(await executeAppContract(intent, wallet)).toEqual({ txId });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(wallet.balanceTx).toHaveBeenCalledTimes(1);
    expect(assertSponsoredContractTransaction).toHaveBeenCalledTimes(1);
  });
  it('records before sending and preserves a receipt when the node returns an unrelated identifier', async () => {
    const submit = vi.fn(async () => {
      expect(sessionStorage.getItem(`passport:contract-submission:${txId}`)).toBeTruthy();
      return 'different-id';
    });
    expect(await executeAppContract(intent, provider(submit))).toEqual({ txId });
  });
  it('an explicit node rejection removes the pending marker', async () => {
    const wallet = provider(vi.fn().mockRejectedValue(new Error('1010: Invalid Transaction')));
    await expect(executeAppContract(intent, wallet)).rejects.toThrow('Invalid Transaction');
    expect(sessionStorage.getItem(`passport:contract-submission:${txId}`)).toBeNull();
  });
  it('a changed session stops before submission', async () => {
    const wallet = provider();
    await expect(executeAppContract(intent, wallet, () => false)).rejects.toThrow('session changed');
    expect(wallet.submitTx).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(`passport:contract-submission:${txId}`)).toBeNull();
  });
});
