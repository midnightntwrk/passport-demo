/**
 * The three push endpoints as plain functions: a parsed request in, a status
 * and a JSON body out. `http.ts` adapts them to Vercel's Node signature; the
 * tests call them directly.
 *
 * WHAT THE SERVER KNOWS. An account address and up to five FCM tokens for it,
 * and the hash of each transaction it has announced. A `notify` answers the
 * same way whether the account has devices or not, so it cannot be used to
 * ask whether somebody turned push on.
 */

import { sendPayment } from './fcm.js';
import { addToken, claimTransaction, readTokens, removeTokens, type FirestoreContext } from './firestore.js';
import { accessToken, parseServiceAccount } from './googleAuth.js';
import { DEFAULT_INDEXER_URL, verifyPayment } from './indexer.js';
import { isAccount, isPushToken, isTxHash, originAllowed } from './validate.js';

export interface PushRequest {
  method: string;
  origin: string | undefined;
  /** Parsed JSON, or `undefined` when the body was absent or not JSON. */
  body: unknown;
}

export interface PushResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface PushDeps {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const UNAVAILABLE: PushResponse = { status: 503, body: { error: 'push-unavailable' } };
const OK: PushResponse = { status: 200, body: { ok: true } };
const ACCEPTED: PushResponse = { status: 202, body: { ok: true } };

function bad(error: string): PushResponse {
  return { status: 400, body: { error } };
}

/** The gate every endpoint shares: method, origin, and a JSON object body. */
function refusal(request: PushRequest): PushResponse | null {
  if (request.method !== 'POST') return { status: 405, body: { error: 'method-not-allowed' } };
  if (!originAllowed(request.origin)) return { status: 403, body: { error: 'origin-not-allowed' } };
  if (typeof request.body !== 'object' || request.body === null) return bad('invalid-body');
  return null;
}

async function firestoreFor(deps: PushDeps): Promise<FirestoreContext | null> {
  const account = parseServiceAccount(deps.env.FIREBASE_SERVICE_ACCOUNT);
  if (account === null) return null;
  return {
    projectId: deps.env.FIREBASE_PROJECT_ID || account.projectId,
    accessToken: await accessToken(account, deps.fetch, deps.now),
    fetch: deps.fetch,
  };
}

export async function handleRegister(request: PushRequest, deps: PushDeps): Promise<PushResponse> {
  const refused = refusal(request);
  if (refused) return refused;
  const { account, token } = request.body as { account?: unknown; token?: unknown };
  if (!isAccount(account)) return bad('invalid-account');
  if (!isPushToken(token)) return bad('invalid-token');
  const context = await firestoreFor(deps);
  if (context === null) return UNAVAILABLE;
  await addToken(context, account, token);
  return OK;
}

export async function handleUnregister(request: PushRequest, deps: PushDeps): Promise<PushResponse> {
  const refused = refusal(request);
  if (refused) return refused;
  const { account, token } = request.body as { account?: unknown; token?: unknown };
  if (!isAccount(account)) return bad('invalid-account');
  if (!isPushToken(token)) return bad('invalid-token');
  const context = await firestoreFor(deps);
  if (context === null) return UNAVAILABLE;
  await removeTokens(context, account, [token]);
  return OK;
}

export async function handleNotify(request: PushRequest, deps: PushDeps): Promise<PushResponse> {
  const refused = refusal(request);
  if (refused) return refused;
  const { recipientAccount, txHash } = request.body as { recipientAccount?: unknown; txHash?: unknown };
  if (!isAccount(recipientAccount)) return bad('invalid-account');
  if (!isTxHash(txHash)) return bad('invalid-tx');
  if (!parseServiceAccount(deps.env.FIREBASE_SERVICE_ACCOUNT)) return UNAVAILABLE;

  const verified = await verifyPayment(txHash, recipientAccount, {
    url: deps.env.PUSH_INDEXER_URL || DEFAULT_INDEXER_URL,
    fetch: deps.fetch,
    now: deps.now,
    sleep: deps.sleep,
  });
  if (verified !== 'verified') return ACCEPTED;

  const context = await firestoreFor(deps);
  if (context === null) return UNAVAILABLE;
  if (!(await claimTransaction(context, txHash, deps.now()))) return OK;

  const { tokens } = await readTokens(context, recipientAccount);
  const outcomes = await Promise.all(tokens.map((token) => sendPayment(context, token, txHash)));
  const stale = tokens.filter((_, index) => outcomes[index] === 'stale');
  if (stale.length > 0) await removeTokens(context, recipientAccount, stale);
  return ACCEPTED;
}
