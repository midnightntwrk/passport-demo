/**
 * The check that stands between a `notify` request and anybody's phone: the
 * transaction exists on chain, it touched the recipient's account contract,
 * and it is recent. A request that fails any of those is dropped silently.
 */

export const DEFAULT_INDEXER_URL = 'https://indexer.stagenet.shielded.tools/api/v4/graphql';

/** How recent a payment must be to be announced. */
export const MAX_AGE_MS = 15 * 60 * 1000;

export type Verification = 'verified' | 'mismatch' | 'too-old' | 'not-found';

export interface IndexerOptions {
  url: string;
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Attempts while the indexer has not seen the transaction yet. */
  attempts?: number;
  intervalMs?: number;
}

interface IndexerTransaction {
  hash?: string;
  block?: { height?: number; timestamp?: number } | null;
  contractActions?: { address?: string }[];
}

export function transactionQuery(txHash: string): string {
  return `{ transactions(offset:{hash:"${txHash}"}) { hash block { height timestamp } contractActions { address __typename ... on ContractCall { entryPoint } } } }`;
}

async function lookup(txHash: string, options: IndexerOptions): Promise<IndexerTransaction | null> {
  const response = await options.fetch(options.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: transactionQuery(txHash) }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { data?: { transactions?: IndexerTransaction[] } };
  const found = body.data?.transactions?.find((transaction) => transaction.hash === txHash);
  return found?.block ? found : null;
}

/**
 * Verifies `txHash` against `account`. The indexer trails the chain by ten to
 * twenty seconds, so an unseen transaction is asked about again, four times
 * over about twenty seconds by default, before giving up.
 */
export async function verifyPayment(
  txHash: string,
  account: string,
  options: IndexerOptions,
): Promise<Verification> {
  const attempts = options.attempts ?? 5;
  const intervalMs = options.intervalMs ?? 5_000;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const found = await lookup(txHash, options).catch(() => null);
    if (found !== null) {
      const touches = (found.contractActions ?? []).some(
        (action) => typeof action.address === 'string' && action.address.toLowerCase() === account,
      );
      if (!touches) return 'mismatch';
      const timestamp = found.block?.timestamp;
      if (typeof timestamp !== 'number' || options.now() - timestamp > MAX_AGE_MS) return 'too-old';
      return 'verified';
    }
    if (attempt + 1 < attempts) await options.sleep(intervalMs);
  }
  return 'not-found';
}
