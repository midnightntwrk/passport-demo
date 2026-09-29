import type { DeploymentResult } from './chain.js';

export interface DeploymentJournal extends DeploymentResult {
  /** Version 1 verifies identifier, execution result, exact deploy action, and block. */
  confirmationVersion?: 1;
  /** Terminal indexed failure or action mismatch; never rebroadcast automatically. */
  confirmationError?: string;
}

const query = `query BuilderDeployment($identifier: HexEncoded!) {
  transactions(offset: { identifier: $identifier }) {
    hash block { height }
    ... on RegularTransaction {
      identifiers transactionResult { status }
      contractActions { __typename address }
    }
  }
}`;

type IndexedDeployment = { status: 'submitted' } | { status: 'confirmed'; txHash: string; blockHeight: number } | { status: 'failed'; message: string };

function validateInput(input: { txId: string; contractAddress: string; indexer: string }): URL {
  if (!/^[0-9a-f]{66}$/i.test(input.txId) || !/^[0-9a-f]{64}$/i.test(input.contractAddress)) throw new Error('Invalid saved deployment identifier or contract address.');
  const endpoint = new URL(input.indexer);
  if (!['http:', 'https:'].includes(endpoint.protocol) || /\b(preview|preprod|mainnet)\b/i.test(endpoint.hostname)) throw new Error('Deployment confirmation requires the stage-net indexer.');
  return endpoint;
}

export async function readDeploymentStatus(input: { txId: string; contractAddress: string; indexer: string }, fetcher: typeof fetch = fetch): Promise<IndexedDeployment> {
  const endpoint = validateInput(input);
  const response = await fetcher(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { identifier: input.txId.toLowerCase() } }), signal: AbortSignal.timeout(10_000) });
  const body = await response.json();
  if (!response.ok || body.errors?.length || !Array.isArray(body.data?.transactions)) throw new Error('The stage-net indexer could not confirm the deployment.');
  const transaction = body.data.transactions.find((value: any) => Array.isArray(value?.identifiers)
    && value.identifiers.some((id: unknown) => typeof id === 'string' && id.toLowerCase() === input.txId.toLowerCase()));
  if (!transaction) return { status: 'submitted' };
  const blockHeight = transaction.block?.height;
  if (!Number.isSafeInteger(blockHeight) || blockHeight < 0) throw new Error('Deployment confirmation has no valid indexed block.');
  const status = transaction.transactionResult?.status;
  if (status === 'FAILURE' || status === 'PARTIAL_SUCCESS') return { status: 'failed', message: `The indexed deployment transaction ${status === 'FAILURE' ? 'failed' : 'executed only partially'}. Its saved transaction is retained; automatic deployment retry is disabled.` };
  if (status !== 'SUCCESS') throw new Error('The indexer has not returned a recognised deployment execution result.');
  const actions = transaction.contractActions;
  if (!Array.isArray(actions) || actions.length !== 1 || actions[0]?.__typename !== 'ContractDeploy'
    || typeof actions[0].address !== 'string' || actions[0].address.toLowerCase() !== input.contractAddress.toLowerCase()) {
    return { status: 'failed', message: 'The indexed transaction does not contain exactly the expected contract deployment. Its saved transaction is retained; automatic deployment retry is disabled.' };
  }
  if (typeof transaction.hash !== 'string' || !/^[0-9a-f]{64}$/i.test(transaction.hash)) throw new Error('Deployment confirmation has no valid transaction hash.');
  return { status: 'confirmed', blockHeight, txHash: transaction.hash.toLowerCase() };
}

/** Never return through the rebroadcast path after an indexed failure. */
export async function confirmDeployment(journal: DeploymentJournal, options: {
  indexer: string;
  persist: (journal: DeploymentJournal) => Promise<void>;
  fetcher?: typeof fetch;
  attempts?: number;
  wait?: () => Promise<void>;
}): Promise<DeploymentJournal> {
  if (journal.network !== 'stagenet') throw new Error('The deployment journal belongs to a different network.');
  validateInput({ ...journal, indexer: options.indexer });
  if (journal.confirmationError) throw new Error(journal.confirmationError);
  if (journal.status === 'confirmed' && journal.confirmationVersion === 1) return journal;
  // Older journals accepted mere inclusion. Recheck them rather than trusting
  // an unverified confirmed flag when this worker next reads the journal.
  const pending: DeploymentJournal = { ...journal, status: 'submitted' };
  delete pending.confirmationVersion;
  if (journal.status === 'confirmed') await options.persist(pending);
  for (let attempt = 0; attempt < (options.attempts ?? 24); attempt++) {
    let result: IndexedDeployment;
    try { result = await readDeploymentStatus({ ...pending, indexer: options.indexer }, options.fetcher); }
    catch { if (attempt + 1 < (options.attempts ?? 24)) await (options.wait || (() => new Promise(resolve => setTimeout(resolve, 2500))))(); continue; }
    if (result.status === 'confirmed') {
      const confirmed: DeploymentJournal = { ...pending, status: 'confirmed', confirmationVersion: 1, txHash: result.txHash, blockHeight: result.blockHeight };
      await options.persist(confirmed);
      return confirmed;
    }
    if (result.status === 'failed') {
      const failed: DeploymentJournal = { ...pending, confirmationError: result.message };
      await options.persist(failed);
      throw new Error(result.message);
    }
    if (attempt + 1 < (options.attempts ?? 24)) await (options.wait || (() => new Promise(resolve => setTimeout(resolve, 2500))))();
  }
  return pending;
}
