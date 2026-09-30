/**
 * The client half of background push: that it is OFF, and silent, whenever
 * the build is not configured for it, and that the two Firebase REST calls it
 * replicates from the SDK are shaped as the SDK shapes them.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PUSH_STORAGE_KEY,
  announcePayment,
  base64UrlFromBytes,
  bytesFromBase64Url,
  disablePush,
  enablePush,
  fcmRegistrationToken,
  generateFid,
  normaliseAccount,
  pushAvailable,
  pushConfigFrom,
  refreshPush,
  type PushConfig,
} from './push.js';

const ACCOUNT = 'ab'.repeat(32);
const TX = 'cd'.repeat(32);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('configuration', () => {
  it('is off without an API key or an app id', () => {
    expect(pushConfigFrom({})).toBeNull();
    expect(pushConfigFrom({ VITE_FIREBASE_API_KEY: 'key' })).toBeNull();
    expect(pushConfigFrom({ VITE_FIREBASE_APP_ID: 'app' })).toBeNull();
    expect(pushConfigFrom({ VITE_FIREBASE_API_KEY: ' ', VITE_FIREBASE_APP_ID: 'app' })).toBeNull();
  });

  it('fills the public project defaults once both are present', () => {
    const config = pushConfigFrom({ VITE_FIREBASE_API_KEY: 'key', VITE_FIREBASE_APP_ID: 'app' });
    expect(config).toMatchObject({
      apiKey: 'key',
      appId: 'app',
      projectId: 'midnight-passport-demo',
      senderId: '555154905726',
    });
    expect(config?.vapidKey).toMatch(/^BDSs1Ph/);
  });

  it('takes explicit values over the defaults', () => {
    const config = pushConfigFrom({
      VITE_FIREBASE_API_KEY: 'key',
      VITE_FIREBASE_APP_ID: 'app',
      VITE_FIREBASE_PROJECT_ID: 'other',
      VITE_FIREBASE_MESSAGING_SENDER_ID: '1',
      VITE_FIREBASE_VAPID_KEY: 'vapid',
    });
    expect(config).toMatchObject({ projectId: 'other', senderId: '1', vapidKey: 'vapid' });
  });
});

describe('with the build unconfigured (every build shipped today)', () => {
  it('is unavailable and never touches the network', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect(pushAvailable()).toBe(false);
    expect(await enablePush(ACCOUNT)).toBe(false);
    await disablePush(ACCOUNT);
    await refreshPush(ACCOUNT);
    announcePayment({ recipientAccount: ACCOUNT, tx: TX });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('announcePayment', () => {
  it('posts the recipient and hash, kept alive, once configured', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'key');
    vi.stubEnv('VITE_FIREBASE_APP_ID', 'app');
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', fetcher);
    announcePayment({ recipientAccount: ACCOUNT.toUpperCase(), tx: TX });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const [path, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/push/notify');
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual({ recipientAccount: ACCOUNT, txHash: TX });
  });

  it('looks an identifier up first, and never throws into the caller', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'key');
    vi.stubEnv('VITE_FIREBASE_APP_ID', 'app');
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetcher);
    const lookup = vi.fn().mockResolvedValue(TX);
    expect(() =>
      announcePayment({ recipientAccount: ACCOUNT, tx: `00${TX}`, lookup }),
    ).not.toThrow();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(lookup).toHaveBeenCalledWith(`00${TX}`);
  });

  it('ignores a recipient that is not an account address', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'key');
    vi.stubEnv('VITE_FIREBASE_APP_ID', 'app');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    announcePayment({ recipientAccount: 'mn_shield-addr1…', tx: TX });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('the pieces replicated from the SDK', () => {
  it('normalises an account address or refuses it', () => {
    expect(normaliseAccount(` ${ACCOUNT.toUpperCase()} `)).toBe(ACCOUNT);
    expect(normaliseAccount('abc')).toBeNull();
    expect(normaliseAccount(null)).toBeNull();
  });

  it('generates an installation id the installations API accepts', () => {
    for (let index = 0; index < 20; index += 1) expect(generateFid()).toMatch(/^[cdef][\w-]{21}$/);
    expect(generateFid((bytes) => bytes.fill(0xff))).toMatch(/^f/);
  });

  it('round-trips base64url without padding', () => {
    const bytes = Uint8Array.from([251, 255, 0, 1, 2]);
    const encoded = base64UrlFromBytes(bytes);
    expect(encoded).not.toMatch(/[=+/]/);
    expect(Array.from(bytesFromBase64Url(encoded))).toEqual(Array.from(bytes));
  });

  it('makes one installation and one registration, shaped as the SDK makes them', async () => {
    const config: PushConfig = {
      apiKey: 'api-key',
      appId: '1:555154905726:web:abc',
      projectId: 'midnight-passport-demo',
      senderId: '555154905726',
      vapidKey: 'vapid-public',
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ fid: 'x', refreshToken: 'r', authToken: { token: 'fis-token', expiresIn: '604800s' } }),
      )
      .mockResolvedValueOnce(Response.json({ token: 'fcm-token' }));
    const token = await fcmRegistrationToken(
      config,
      { endpoint: 'https://push.example/abc', p256dh: 'p', auth: 'a' },
      'midnightpassport.com',
      fetcher,
    );
    expect(token).toBe('fcm-token');

    const [installUrl, install] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(installUrl).toBe(
      'https://firebaseinstallations.googleapis.com/v1/projects/midnight-passport-demo/installations',
    );
    expect((install.headers as Record<string, string>)['x-goog-api-key']).toBe('api-key');
    const installBody = JSON.parse(install.body as string) as Record<string, string>;
    expect(installBody).toMatchObject({ authVersion: 'FIS_v2', appId: config.appId });
    expect(installBody.fid).toMatch(/^[cdef][\w-]{21}$/);

    const [registerUrl, register] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(registerUrl).toBe(
      'https://fcmregistrations.googleapis.com/v1/projects/midnight-passport-demo/registrations',
    );
    expect((register.headers as Record<string, string>)['x-goog-firebase-installations-auth']).toBe(
      'FIS fis-token',
    );
    expect(JSON.parse(register.body as string)).toEqual({
      web: {
        origin: 'midnightpassport.com',
        endpoint: 'https://push.example/abc',
        auth: 'a',
        p256dh: 'p',
        applicationPubKey: 'vapid-public',
      },
    });
  });

  it('throws on a refused registration, for the caller to catch', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ authToken: { token: 't' } }))
      .mockResolvedValueOnce(Response.json({ error: { message: 'no' } }, { status: 400 }));
    await expect(
      fcmRegistrationToken(
        { apiKey: 'k', appId: 'a', projectId: 'p', senderId: 's', vapidKey: 'v' },
        { endpoint: 'e', p256dh: 'p', auth: 'a' },
        'o',
        fetcher as unknown as typeof fetch,
      ),
    ).rejects.toThrow('registration refused: no');
  });

  it('stores nothing under its key while unconfigured', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    await enablePush(ACCOUNT);
    expect(store.has(PUSH_STORAGE_KEY)).toBe(false);
  });
});
