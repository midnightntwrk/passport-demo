/**
 * The push endpoints, end to end against a fake Google: one `fetch` that
 * answers for the token endpoint, Firestore, FCM, and the indexer, and records
 * every request so their shapes can be asserted.
 */

import { createVerify, generateKeyPairSync } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { paymentMessage, sendPayment } from './fcm.js';
import { addToken, claimTransaction, removeTokens } from './firestore.js';
import { GOOGLE_SCOPES, accessToken, parseServiceAccount, resetAccessTokenCache, signedJwt } from './googleAuth.js';
import { handleNotify, handleRegister, handleUnregister, type PushDeps, type PushRequest } from './handlers.js';
import { transactionQuery, verifyPayment } from './indexer.js';
import { isAccount, isPushToken, isTxHash, originAllowed } from './validate.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const SERVICE_ACCOUNT = JSON.stringify({
  project_id: 'midnight-passport-demo',
  client_email: 'push@midnight-passport-demo.iam.gserviceaccount.com',
  private_key: PRIVATE_PEM,
});

const ACCOUNT = 'a1'.repeat(32);
const TX = 'b2'.repeat(32);
const TOKEN = 'fcm-token-'.padEnd(40, 'x');
const NOW = 1_790_000_000_000;

interface Recorded {
  url: string;
  method: string;
  body: string | undefined;
  headers: Record<string, string>;
}

/** A fake of every Google service the endpoints call, plus the indexer. */
function fakeGoogle(options: {
  tokens?: string[];
  indexer?: unknown[];
  claimed?: boolean;
  fcm?: (token: string) => Response;
}) {
  const requests: Recorded[] = [];
  let stored: string[] | null = options.tokens ?? null;
  let claimed = options.claimed ?? false;
  const indexerAnswers = [...(options.indexer ?? [])];
  const fetcher = vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(answer(url, init));
  });
  function answer(url: string, init?: RequestInit): Response {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : undefined;
    requests.push({ url, method, body, headers: (init?.headers ?? {}) as Record<string, string> });
    if (url === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'access', expires_in: 3600 });
    }
    if (url.includes('/documents/passportPush/')) {
      if (method === 'GET') {
        return stored === null
          ? Response.json({ error: { status: 'NOT_FOUND' } }, { status: 404 })
          : Response.json({
              updateTime: '2026-09-30T00:00:00Z',
              fields: { tokens: { arrayValue: { values: stored.map((stringValue) => ({ stringValue })) } } },
            });
      }
      const fields = (JSON.parse(body ?? '{}') as { fields: { tokens: { arrayValue: { values?: { stringValue: string }[] } } } })
        .fields;
      stored = (fields.tokens.arrayValue.values ?? []).map((value) => value.stringValue);
      return Response.json({});
    }
    if (url.includes('/documents/passportPushSent')) {
      if (claimed) return Response.json({ error: { status: 'ALREADY_EXISTS' } }, { status: 409 });
      claimed = true;
      return Response.json({});
    }
    if (url.startsWith('https://fcm.googleapis.com/')) {
      const token = (JSON.parse(body ?? '{}') as { message: { token: string } }).message.token;
      return options.fcm ? options.fcm(token) : Response.json({ name: 'sent' });
    }
    if (url.includes('indexer')) {
      const next = indexerAnswers.length > 1 ? indexerAnswers.shift() : indexerAnswers[0];
      return Response.json({ data: { transactions: next ?? [] } });
    }
    throw new Error(`unexpected request ${url}`);
  }
  return { fetcher, requests, tokens: () => stored };
}

function deps(fetcher: typeof fetch, env: Record<string, string | undefined> = { FIREBASE_SERVICE_ACCOUNT: SERVICE_ACCOUNT }): PushDeps {
  return { env, fetch: fetcher, now: () => NOW, sleep: () => Promise.resolve() };
}

function post(body: unknown, origin?: string): PushRequest {
  return { method: 'POST', origin, body };
}

function landed(address = ACCOUNT, timestamp = NOW - 30_000) {
  return [{ hash: TX, block: { height: 1, timestamp }, contractActions: [{ address, __typename: 'ContractCall' }] }];
}

beforeEach(() => resetAccessTokenCache());
afterEach(() => vi.restoreAllMocks());

describe('validation', () => {
  it('accepts 64 lower-case hex for accounts and hashes only', () => {
    expect(isAccount(ACCOUNT)).toBe(true);
    expect(isAccount(ACCOUNT.toUpperCase())).toBe(false);
    expect(isAccount(`${ACCOUNT}00`)).toBe(false);
    expect(isTxHash(TX)).toBe(true);
    expect(isTxHash(42)).toBe(false);
  });

  it('bounds a token and refuses whitespace', () => {
    expect(isPushToken(TOKEN)).toBe(true);
    expect(isPushToken('short')).toBe(false);
    expect(isPushToken('x'.repeat(4097))).toBe(false);
    expect(isPushToken(`${TOKEN} x`)).toBe(false);
  });

  it('allows the Passport hosts, localhost, and no origin', () => {
    for (const origin of [
      undefined,
      'https://midnightpassport.com',
      'https://staging.midnightpassport.com',
      'https://midnight-passport-dev.vercel.app',
      'http://localhost:4173',
    ]) {
      expect(originAllowed(origin)).toBe(true);
    }
    for (const origin of ['https://evil.example', 'http://midnightpassport.com', 'https://midnightpassport.com.evil.example', 'null']) {
      expect(originAllowed(origin)).toBe(false);
    }
  });
});

describe('google auth', () => {
  it('reads the service account and repairs an escaped key', () => {
    const escaped = JSON.stringify({ ...JSON.parse(SERVICE_ACCOUNT), private_key: PRIVATE_PEM.replace(/\n/g, '\\n') });
    expect(parseServiceAccount(escaped)?.privateKey).toBe(PRIVATE_PEM);
    expect(parseServiceAccount(undefined)).toBeNull();
    expect(parseServiceAccount('{')).toBeNull();
    expect(parseServiceAccount('{"project_id":"p"}')).toBeNull();
  });

  it('signs an RS256 assertion for the messaging and datastore scopes', () => {
    const account = parseServiceAccount(SERVICE_ACCOUNT)!;
    const jwt = signedJwt(account, 1000);
    const [header, claims, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({
      iss: account.clientEmail,
      scope: GOOGLE_SCOPES,
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1000,
      exp: 4600,
    });
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${claims}`);
    expect(verifier.verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
  });

  it('exchanges it once and reuses the token while it is fresh', async () => {
    const { fetcher, requests } = fakeGoogle({});
    const account = parseServiceAccount(SERVICE_ACCOUNT)!;
    expect(await accessToken(account, fetcher, () => NOW)).toBe('access');
    expect(await accessToken(account, fetcher, () => NOW + 60_000)).toBe('access');
    expect(requests).toHaveLength(1);
    const form = new URLSearchParams(requests[0].body);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(form.get('assertion')?.split('.')).toHaveLength(3);
  });
});

describe('firestore', () => {
  const context = (fetcher: typeof fetch) => ({ projectId: 'p', accessToken: 'access', fetch: fetcher });

  it('creates a missing document under an exists=false precondition', async () => {
    const google = fakeGoogle({});
    await addToken(context(google.fetcher), ACCOUNT, TOKEN);
    const write = google.requests.find((request) => request.method === 'PATCH')!;
    expect(write.url).toContain(`/projects/p/databases/(default)/documents/passportPush/${ACCOUNT}?`);
    expect(write.url).toContain('currentDocument.exists=false');
    expect(write.headers.Authorization).toBe('Bearer access');
    expect(google.tokens()).toEqual([TOKEN]);
  });

  it('keeps the newest five and moves a repeated token to newest', async () => {
    const google = fakeGoogle({ tokens: ['t1', 't2', 't3', 't4', 't5'] });
    await addToken(context(google.fetcher), ACCOUNT, 't6');
    expect(google.tokens()).toEqual(['t2', 't3', 't4', 't5', 't6']);
    await addToken(context(google.fetcher), ACCOUNT, 't3');
    expect(google.tokens()).toEqual(['t2', 't4', 't5', 't6', 't3']);
    const write = google.requests.filter((request) => request.method === 'PATCH')[0];
    expect(write.url).toContain('currentDocument.updateTime=');
  });

  it('retries a write that lost a race', async () => {
    const google = fakeGoogle({ tokens: [] });
    let refused = false;
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'PATCH' && !refused) {
        refused = true;
        return Response.json({ error: { status: 'FAILED_PRECONDITION' } }, { status: 400 });
      }
      return google.fetcher(input, init);
    });
    await addToken(context(fetcher), ACCOUNT, TOKEN);
    expect(google.tokens()).toEqual([TOKEN]);
  });

  it('writes nothing when removing a token that is not there', async () => {
    const google = fakeGoogle({ tokens: ['t1'] });
    await removeTokens(context(google.fetcher), ACCOUNT, ['t9']);
    expect(google.requests.some((request) => request.method === 'PATCH')).toBe(false);
  });

  it('claims a transaction once', async () => {
    const google = fakeGoogle({});
    expect(await claimTransaction(context(google.fetcher), TX, NOW)).toBe(true);
    expect(await claimTransaction(context(google.fetcher), TX, NOW)).toBe(false);
    expect(google.requests[0].url).toContain(`/documents/passportPushSent?documentId=${TX}`);
  });
});

describe('fcm', () => {
  it('sends a data-only web push with no amount, name, or address', () => {
    expect(paymentMessage(TOKEN, TX)).toEqual({
      message: {
        token: TOKEN,
        webpush: {
          headers: { TTL: '3600', Urgency: 'high' },
          data: { title: 'You received a payment', body: 'Open Passport to see it.', txHash: TX, url: '/' },
        },
      },
    });
  });

  it('calls a token stale on 404, UNREGISTERED, and INVALID_ARGUMENT only', async () => {
    const context = (response: Response) => ({
      projectId: 'p',
      accessToken: 'a',
      fetch: vi.fn().mockResolvedValue(response) as unknown as typeof fetch,
    });
    expect(await sendPayment(context(Response.json({})), TOKEN, TX)).toBe('sent');
    expect(await sendPayment(context(new Response('', { status: 404 })), TOKEN, TX)).toBe('stale');
    expect(
      await sendPayment(
        context(Response.json({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }, { status: 400 })),
        TOKEN,
        TX,
      ),
    ).toBe('stale');
    expect(await sendPayment(context(Response.json({ error: { status: 'INVALID_ARGUMENT' } }, { status: 400 })), TOKEN, TX)).toBe(
      'stale',
    );
    expect(await sendPayment(context(Response.json({ error: { status: 'UNAVAILABLE' } }, { status: 503 })), TOKEN, TX)).toBe(
      'failed',
    );
  });
});

describe('indexer verification', () => {
  const options = (fetcher: typeof fetch) => ({
    url: 'https://indexer.example/graphql',
    fetch: fetcher,
    now: () => NOW,
    sleep: () => Promise.resolve(),
  });

  it('asks for the transaction by hash', () => {
    expect(transactionQuery(TX)).toContain(`transactions(offset:{hash:"${TX}"})`);
    expect(transactionQuery(TX)).toContain('contractActions { address');
  });

  it('verifies a recent transaction that touched the account', async () => {
    const { fetcher } = fakeGoogle({ indexer: [landed()] });
    expect(await verifyPayment(TX, ACCOUNT, options(fetcher))).toBe('verified');
  });

  it('waits for a lagging indexer, then gives up', async () => {
    const lagging = fakeGoogle({ indexer: [[], [], landed()] });
    expect(await verifyPayment(TX, ACCOUNT, options(lagging.fetcher))).toBe('verified');
    expect(lagging.requests).toHaveLength(3);
    const never = fakeGoogle({ indexer: [[]] });
    expect(await verifyPayment(TX, ACCOUNT, options(never.fetcher))).toBe('not-found');
    expect(never.requests).toHaveLength(5);
  });

  it('refuses another account and an old transaction', async () => {
    expect(await verifyPayment(TX, ACCOUNT, options(fakeGoogle({ indexer: [landed('c3'.repeat(32))] }).fetcher))).toBe(
      'mismatch',
    );
    expect(
      await verifyPayment(TX, ACCOUNT, options(fakeGoogle({ indexer: [landed(ACCOUNT, NOW - 16 * 60_000)] }).fetcher)),
    ).toBe('too-old');
  });
});

describe('the endpoints', () => {
  it('answer 503 push-unavailable without the service account', async () => {
    const { fetcher } = fakeGoogle({});
    const none = deps(fetcher, {});
    for (const handle of [handleRegister, handleUnregister]) {
      expect(await handle(post({ account: ACCOUNT, token: TOKEN }), none)).toEqual({
        status: 503,
        body: { error: 'push-unavailable' },
      });
    }
    expect(await handleNotify(post({ recipientAccount: ACCOUNT, txHash: TX }), none)).toEqual({
      status: 503,
      body: { error: 'push-unavailable' },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuse the wrong method, a foreign origin, and bad input', async () => {
    const { fetcher } = fakeGoogle({});
    expect((await handleRegister({ method: 'GET', origin: undefined, body: undefined }, deps(fetcher))).status).toBe(405);
    expect((await handleRegister(post({ account: ACCOUNT, token: TOKEN }, 'https://evil.example'), deps(fetcher))).status).toBe(
      403,
    );
    expect((await handleRegister(post(undefined), deps(fetcher))).status).toBe(400);
    expect((await handleRegister(post({ account: 'nope', token: TOKEN }), deps(fetcher))).body).toEqual({
      error: 'invalid-account',
    });
    expect((await handleUnregister(post({ account: ACCOUNT, token: 'x' }), deps(fetcher))).body).toEqual({
      error: 'invalid-token',
    });
    expect((await handleNotify(post({ recipientAccount: ACCOUNT, txHash: 'x' }), deps(fetcher))).body).toEqual({
      error: 'invalid-tx',
    });
  });

  it('register then unregister a token', async () => {
    const google = fakeGoogle({});
    expect(await handleRegister(post({ account: ACCOUNT, token: TOKEN }, 'https://midnightpassport.com'), deps(google.fetcher))).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(google.tokens()).toEqual([TOKEN]);
    await handleUnregister(post({ account: ACCOUNT, token: TOKEN }), deps(google.fetcher));
    expect(google.tokens()).toEqual([]);
  });

  it('notify sends to every token once verified, and prunes the dead ones', async () => {
    const google = fakeGoogle({
      tokens: ['live-token-000000000000', 'dead-token-000000000000'],
      indexer: [landed()],
      fcm: (token) =>
        token.startsWith('dead')
          ? Response.json({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }, { status: 404 })
          : Response.json({ name: 'ok' }),
    });
    expect(await handleNotify(post({ recipientAccount: ACCOUNT, txHash: TX }), deps(google.fetcher))).toEqual({
      status: 202,
      body: { ok: true },
    });
    const sends = google.requests.filter((request) => request.url.startsWith('https://fcm.googleapis.com/'));
    expect(sends).toHaveLength(2);
    expect(sends[0].url).toBe('https://fcm.googleapis.com/v1/projects/midnight-passport-demo/messages:send');
    expect(google.tokens()).toEqual(['live-token-000000000000']);
  });

  it('notify for the same transaction twice sends once', async () => {
    const google = fakeGoogle({ tokens: [TOKEN], indexer: [landed()] });
    await handleNotify(post({ recipientAccount: ACCOUNT, txHash: TX }), deps(google.fetcher));
    expect(await handleNotify(post({ recipientAccount: ACCOUNT, txHash: TX }), deps(google.fetcher))).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(google.requests.filter((request) => request.url.startsWith('https://fcm.googleapis.com/'))).toHaveLength(1);
  });

  it('notify sends nothing for an unverified transaction, and answers the same either way', async () => {
    const mismatch = fakeGoogle({ tokens: [TOKEN], indexer: [landed('c3'.repeat(32))] });
    const noDevices = fakeGoogle({ indexer: [landed()] });
    const refused = await handleNotify(post({ recipientAccount: ACCOUNT, txHash: TX }), deps(mismatch.fetcher));
    const empty = await handleNotify(post({ recipientAccount: ACCOUNT, txHash: TX }), deps(noDevices.fetcher));
    expect(refused).toEqual(empty);
    expect(mismatch.requests.some((request) => request.url.includes('fcm.googleapis.com'))).toBe(false);
    expect(mismatch.requests.some((request) => request.url.includes('passportPushSent'))).toBe(false);
  });
});
