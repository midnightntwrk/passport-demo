/**
 * An OAuth2 access token from the Firebase service account, with no Google
 * library: an RS256 JWT signed with node:crypto, exchanged at Google's token
 * endpoint (the service-account "JWT bearer" grant).
 */

import { createSign } from 'node:crypto';

export interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
}

export const GOOGLE_SCOPES =
  'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore';

const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';

/**
 * The service account from `FIREBASE_SERVICE_ACCOUNT` (the whole JSON key
 * file), or null when it is missing or unusable. A private key pasted with
 * literal `\n` sequences is repaired.
 */
export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  if (!raw || raw.trim() === '') return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const projectId = value.project_id;
    const clientEmail = value.client_email;
    const privateKey = value.private_key;
    if (typeof projectId !== 'string' || typeof clientEmail !== 'string' || typeof privateKey !== 'string') {
      return null;
    }
    return {
      projectId,
      clientEmail,
      privateKey: privateKey.includes('\\n') ? privateKey.replace(/\\n/g, '\n') : privateKey,
      tokenUri: typeof value.token_uri === 'string' ? value.token_uri : DEFAULT_TOKEN_URI,
    };
  } catch {
    return null;
  }
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

/** The signed assertion. `nowSeconds` is injectable for tests. */
export function signedJwt(account: ServiceAccount, nowSeconds: number): string {
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(
    JSON.stringify({
      iss: account.clientEmail,
      scope: GOOGLE_SCOPES,
      aud: account.tokenUri,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${signer.sign(account.privateKey).toString('base64url')}`;
}

let cached: { email: string; token: string; expiresAt: number } | null = null;

/** Drops the cached token. Test seam. */
export function resetAccessTokenCache(): void {
  cached = null;
}

/**
 * A bearer token for the Firebase APIs, reused across invocations of a warm
 * function until a minute before it expires.
 */
export async function accessToken(
  account: ServiceAccount,
  fetcher: typeof fetch,
  now: () => number = Date.now,
): Promise<string> {
  if (cached && cached.email === account.clientEmail && cached.expiresAt > now() + 60_000) {
    return cached.token;
  }
  const response = await fetcher(account.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedJwt(account, Math.floor(now() / 1000)),
    }).toString(),
  });
  if (!response.ok) throw new Error(`token exchange answered ${response.status}`);
  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (typeof body.access_token !== 'string') throw new Error('token exchange returned no token');
  cached = {
    email: account.clientEmail,
    token: body.access_token,
    expiresAt: now() + (body.expires_in ?? 3600) * 1000,
  };
  return body.access_token;
}
