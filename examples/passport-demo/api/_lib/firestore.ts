/**
 * The two Firestore collections the push endpoints use, over the REST API.
 *
 *   passportPush/{account}      { tokens: string[] (newest last, at most 5), updatedAt }
 *   passportPushSent/{txHash}   { at, expireAt }  — one per notified payment
 *
 * Nothing else is stored: no names, amounts, or sender addresses. `expireAt`
 * is there so a Firestore TTL policy can clear the dedupe records; without the
 * policy they simply stay.
 */

export interface FirestoreContext {
  projectId: string;
  accessToken: string;
  fetch: typeof fetch;
}

export const TOKENS_COLLECTION = 'passportPush';
export const SENT_COLLECTION = 'passportPushSent';
export const MAX_TOKENS = 5;

function documentsUrl(context: FirestoreContext): string {
  return `https://firestore.googleapis.com/v1/projects/${context.projectId}/databases/(default)/documents`;
}

function headers(context: FirestoreContext): Record<string, string> {
  return { Authorization: `Bearer ${context.accessToken}`, 'Content-Type': 'application/json' };
}

interface TokensDocument {
  tokens: string[];
  /** Firestore's own update time, for the write precondition. */
  updateTime: string | null;
}

interface FirestoreDocument {
  updateTime?: string;
  fields?: { tokens?: { arrayValue?: { values?: { stringValue?: string }[] } } };
}

export async function readTokens(context: FirestoreContext, account: string): Promise<TokensDocument> {
  const response = await context.fetch(`${documentsUrl(context)}/${TOKENS_COLLECTION}/${account}`, {
    headers: headers(context),
  });
  if (response.status === 404) return { tokens: [], updateTime: null };
  if (!response.ok) throw new Error(`firestore read answered ${response.status}`);
  const document = (await response.json()) as FirestoreDocument;
  const values = document.fields?.tokens?.arrayValue?.values ?? [];
  return {
    tokens: values.map((value) => value.stringValue).filter((value): value is string => typeof value === 'string'),
    updateTime: document.updateTime ?? null,
  };
}

/**
 * Writes the token list, conditional on the document being exactly as it was
 * read. Returns false when somebody else wrote in between, so the caller can
 * read again.
 */
async function writeTokens(
  context: FirestoreContext,
  account: string,
  tokens: string[],
  readAt: string | null,
): Promise<boolean> {
  const url = new URL(`${documentsUrl(context)}/${TOKENS_COLLECTION}/${account}`);
  url.searchParams.append('updateMask.fieldPaths', 'tokens');
  url.searchParams.append('updateMask.fieldPaths', 'updatedAt');
  if (readAt === null) url.searchParams.set('currentDocument.exists', 'false');
  else url.searchParams.set('currentDocument.updateTime', readAt);
  const response = await context.fetch(url.toString(), {
    method: 'PATCH',
    headers: headers(context),
    body: JSON.stringify({
      fields: {
        tokens: { arrayValue: { values: tokens.map((token) => ({ stringValue: token })) } },
        updatedAt: { timestampValue: new Date().toISOString() },
      },
    }),
  });
  if (response.ok) return true;
  if (response.status === 400 || response.status === 409 || response.status === 412) {
    const body = (await response.json().catch(() => ({}))) as { error?: { status?: string } };
    const status = body.error?.status;
    if (status === 'FAILED_PRECONDITION' || status === 'ALREADY_EXISTS' || status === 'NOT_FOUND') {
      return false;
    }
  }
  throw new Error(`firestore write answered ${response.status}`);
}

/** Read, change, write under a precondition; three tries against a race. */
async function updateTokens(
  context: FirestoreContext,
  account: string,
  change: (tokens: string[]) => string[] | null,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readTokens(context, account);
    const next = change(current.tokens);
    if (next === null) return;
    if (await writeTokens(context, account, next, current.updateTime)) return;
  }
  throw new Error('firestore write kept conflicting');
}

/** Adds a token (moving it to newest if already present), keeping the newest five. */
export function addToken(context: FirestoreContext, account: string, token: string): Promise<void> {
  return updateTokens(context, account, (tokens) =>
    [...tokens.filter((existing) => existing !== token), token].slice(-MAX_TOKENS),
  );
}

/** Removes the given tokens. A no-op, with no write, when none is present. */
export function removeTokens(context: FirestoreContext, account: string, remove: string[]): Promise<void> {
  return updateTokens(context, account, (tokens) => {
    const next = tokens.filter((token) => !remove.includes(token));
    return next.length === tokens.length ? null : next;
  });
}

/**
 * Records that a transaction has been notified. Create-only: resolves true for
 * the first caller and false for every later one, which is the dedupe.
 */
export async function claimTransaction(
  context: FirestoreContext,
  txHash: string,
  now: number,
): Promise<boolean> {
  const url = new URL(`${documentsUrl(context)}/${SENT_COLLECTION}`);
  url.searchParams.set('documentId', txHash);
  const response = await context.fetch(url.toString(), {
    method: 'POST',
    headers: headers(context),
    body: JSON.stringify({
      fields: {
        at: { timestampValue: new Date(now).toISOString() },
        expireAt: { timestampValue: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString() },
      },
    }),
  });
  if (response.ok) return true;
  if (response.status === 409) return false;
  throw new Error(`firestore claim answered ${response.status}`);
}
