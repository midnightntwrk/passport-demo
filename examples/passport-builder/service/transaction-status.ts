export interface TransactionStatus {
  status: 'submitted' | 'confirmed' | 'failed';
  txId: string;
  blockHeight?: number;
  message?: string;
}

const query = `query BuilderTransaction($identifier: HexEncoded!) {
  transactions(offset: { identifier: $identifier }) {
    hash block { height }
    ... on RegularTransaction {
      identifiers transactionResult { status }
      contractActions { __typename address ... on ContractCall { entryPoint } }
    }
  }
}`;

/** Indexed inclusion alone is insufficient: verify execution and the app's call. */
export async function readTransactionStatus(input: { txId: string; contractAddress: string; circuits: string[] }, fetcher: typeof fetch = fetch): Promise<TransactionStatus> {
  const txId = input.txId.toLowerCase();
  if (!/^[0-9a-f]{66}$/.test(txId)) throw Object.assign(new Error('Invalid transaction identifier.'), { status: 400 });
  const endpoint = new URL(process.env.BUILDER_INDEXER_URL || 'https://indexer.stagenet.shielded.tools/api/v4/graphql');
  if (!['http:', 'https:'].includes(endpoint.protocol) || /\b(preview|preprod|mainnet)\b/i.test(endpoint.hostname)) throw new Error('Transaction queries require the stage-net indexer.');
  let response: Response;
  let body: any;
  try {
    response = await fetcher(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables: { identifier: txId } }), signal: AbortSignal.timeout(10_000) });
    body = await response.json();
  } catch { throw Object.assign(new Error('Stage-net confirmation is temporarily unavailable. The transaction may still be pending.'), { status: 502 }); }
  if (!response.ok || body.errors?.length || !Array.isArray(body.data?.transactions)) throw Object.assign(new Error('The stage-net indexer could not confirm this transaction. Retry the confirmation check.'), { status: 502 });
  const transaction = body.data.transactions.find((item: any) => Array.isArray(item.identifiers) && item.identifiers.some((identifier: unknown) => typeof identifier === 'string' && identifier.toLowerCase() === txId));
  if (!transaction) return { status: 'submitted', txId };
  const matches = transaction.contractActions?.some((action: any) => action.__typename === 'ContractCall' && typeof action.address === 'string' && action.address.toLowerCase() === input.contractAddress.toLowerCase() && input.circuits.includes(action.entryPoint));
  if (!matches) throw Object.assign(new Error('This indexed transaction does not contain a call to this deployed application.'), { status: 404 });
  const blockHeight = transaction.block?.height;
  if (!Number.isSafeInteger(blockHeight) || blockHeight < 0) throw Object.assign(new Error('The indexer has not returned a valid confirmation block.'), { status: 502 });
  const status = transaction.transactionResult?.status;
  if (status === 'SUCCESS') return { status: 'confirmed', txId, blockHeight };
  if (status === 'PARTIAL_SUCCESS' || status === 'FAILURE') return { status: 'failed', txId, blockHeight, message: status === 'PARTIAL_SUCCESS' ? 'The transaction executed only partially. Refresh the ledger and review the result before retrying.' : 'The indexed transaction failed. Refresh the ledger before retrying.' };
  throw Object.assign(new Error('The indexer has not returned a recognised execution result.'), { status: 502 });
}
