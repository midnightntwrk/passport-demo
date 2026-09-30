/**
 * Background push for payments received, through Firebase Cloud Messaging.
 *
 * WHY THERE IS NO FIREBASE SDK HERE (2026/09/30)
 * ----------------------------------------------
 * FCM delivers to an ordinary Web Push subscription, but only Firebase holds
 * the VAPID private key that signs deliveries to it, so a subscription is no
 * use to our server on its own: it has to be exchanged for an FCM
 * registration token. `firebase/messaging` does that exchange with two REST
 * calls, and they are replicated below from its published source
 * (`@firebase/installations` 0.6.24, `@firebase/messaging` 0.13.3) rather than
 * adding the package and its lockfile churn:
 *
 *   1. POST firebaseinstallations …/installations  → an installation auth token
 *   2. POST fcmregistrations …/registrations        → the FCM registration token
 *
 * The token is posted to `/api/push/register` against this Passport's account
 * address, and the server sends to it when another Passport reports a payment
 * to that account (`/api/push/notify`, verified on the indexer there).
 *
 * OFF UNLESS CONFIGURED. With `VITE_FIREBASE_API_KEY` or
 * `VITE_FIREBASE_APP_ID` missing — every build shipped before this module —
 * {@link pushAvailable} is false, nothing here touches the network, and the
 * Home toggle behaves exactly as it always has. The same is true of a browser
 * with no `PushManager`, which includes every iOS Safari tab: on iPhone only a
 * Home Screen app on iOS 16.4 or later can receive a push.
 *
 * NOTHING HERE MAY BREAK ANYTHING ELSE. Every entry point resolves rather than
 * rejects, and logs with a `[push]` prefix. In-app notifications
 * (`./notifications.ts`) work whatever happens here.
 */

import { notificationPermission, requestNotificationPermission } from './notifications.js';
import { resolveReceiptHash, type ReceiptHashLookup } from './networks.js';

export interface PushConfig {
  apiKey: string;
  appId: string;
  projectId: string;
  senderId: string;
  vapidKey: string;
}

/** The public defaults for the Passport Firebase project. Not secrets. */
const DEFAULT_PROJECT_ID = 'midnight-passport-demo';
const DEFAULT_SENDER_ID = '555154905726';
const DEFAULT_VAPID_KEY =
  'BDSs1PhcrzV9xaVtVBtHgD4Bytt-f-1h5xbjk4-mnT4p-UmRkb0WnsGIfUMRP_w3A8Cfyrr9xK16Fjft_Q1TubM';

/** The SDK version string the installations API is told, as the SDK sends it. */
const INSTALLATIONS_SDK_VERSION = 'w:0.6.24';

/** localStorage key for the registration this browser holds. */
export const PUSH_STORAGE_KEY = 'passport-push';

/** Re-register at least this often, as the SDK refreshes its token weekly. */
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const ACCOUNT = /^[0-9a-f]{64}$/;

type Env = Record<string, string | boolean | undefined>;

function text(value: string | boolean | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * The config from a Vite env object, or null when push is not configured. The
 * API key and app id have no default: they are what turns the feature on.
 */
export function pushConfigFrom(env: Env): PushConfig | null {
  const apiKey = text(env.VITE_FIREBASE_API_KEY);
  const appId = text(env.VITE_FIREBASE_APP_ID);
  if (apiKey === null || appId === null) return null;
  return {
    apiKey,
    appId,
    projectId: text(env.VITE_FIREBASE_PROJECT_ID) ?? DEFAULT_PROJECT_ID,
    senderId: text(env.VITE_FIREBASE_MESSAGING_SENDER_ID) ?? DEFAULT_SENDER_ID,
    vapidKey: text(env.VITE_FIREBASE_VAPID_KEY) ?? DEFAULT_VAPID_KEY,
  };
}

function pushConfig(): PushConfig | null {
  return pushConfigFrom(import.meta.env);
}

/** True when this browser has everything a background push needs. */
export function pushSupported(): boolean {
  const scope = globalThis as {
    navigator?: Navigator;
    PushManager?: unknown;
    Notification?: unknown;
  };
  return (
    typeof scope.Notification === 'function' &&
    typeof scope.PushManager === 'function' &&
    scope.navigator?.serviceWorker !== undefined
  );
}

/** Configured for this build AND supported by this browser. */
export function pushAvailable(): boolean {
  return pushConfig() !== null && pushSupported();
}

/** A Passport account address as the server keys it, or null. */
export function normaliseAccount(value: string | null | undefined): string | null {
  const lowered = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ACCOUNT.test(lowered) ? lowered : null;
}

/* ------------------------------------------------------------------------ */
/* The FCM registration token, by REST                                       */
/* ------------------------------------------------------------------------ */

export function base64UrlFromBytes(bytes: ArrayBuffer | Uint8Array): string {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of array) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function bytesFromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/**
 * A Firebase Installation ID: 17 random bytes, the first four bits fixed to
 * 0111, base64url, cut to 22 characters — exactly `generateFid()` in
 * `@firebase/installations`.
 */
export function generateFid(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const bytes = random(new Uint8Array(17));
  bytes[0] = 0b01110000 + (bytes[0] % 0b00010000);
  return base64UrlFromBytes(bytes).slice(0, 22);
}

export interface SubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

async function errorText(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? String(response.status);
  } catch {
    return String(response.status);
  }
}

/**
 * Exchanges a Web Push subscription for an FCM registration token: one
 * installation, then one registration. Throws on any refusal; the callers
 * catch.
 */
export async function fcmRegistrationToken(
  config: PushConfig,
  keys: SubscriptionKeys,
  origin: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const installations = `https://firebaseinstallations.googleapis.com/v1/projects/${config.projectId}/installations`;
  const installed = await fetcher(installations, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-goog-api-key': config.apiKey,
    },
    body: JSON.stringify({
      fid: generateFid(),
      authVersion: 'FIS_v2',
      appId: config.appId,
      sdkVersion: INSTALLATIONS_SDK_VERSION,
    }),
  });
  if (!installed.ok) throw new Error(`installation refused: ${await errorText(installed)}`);
  const installation = (await installed.json()) as { authToken?: { token?: string } };
  const authToken = installation.authToken?.token;
  if (!authToken) throw new Error('installation returned no auth token');

  const registered = await fetcher(
    `https://fcmregistrations.googleapis.com/v1/projects/${config.projectId}/registrations`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-goog-api-key': config.apiKey,
        'x-goog-firebase-installations-auth': `FIS ${authToken}`,
      },
      body: JSON.stringify({
        web: {
          origin,
          endpoint: keys.endpoint,
          auth: keys.auth,
          p256dh: keys.p256dh,
          applicationPubKey: config.vapidKey,
        },
      }),
    },
  );
  if (!registered.ok) throw new Error(`registration refused: ${await errorText(registered)}`);
  const registration = (await registered.json()) as { token?: string };
  if (!registration.token) throw new Error('registration returned no token');
  return registration.token;
}

/* ------------------------------------------------------------------------ */
/* What this browser remembers                                               */
/* ------------------------------------------------------------------------ */

export interface StoredPush {
  account: string;
  token: string;
  endpoint: string;
  at: number;
}

function storage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

export function readStoredPush(): StoredPush | null {
  try {
    const raw = storage()?.getItem(PUSH_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredPush>;
    if (
      typeof value.account === 'string' &&
      typeof value.token === 'string' &&
      typeof value.endpoint === 'string' &&
      typeof value.at === 'number'
    ) {
      return value as StoredPush;
    }
  } catch {
    /* Unreadable is the same as absent. */
  }
  return null;
}

function writeStoredPush(value: StoredPush | null): void {
  try {
    if (value === null) storage()?.removeItem(PUSH_STORAGE_KEY);
    else storage()?.setItem(PUSH_STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* A registration that is not remembered is re-made on the next refresh. */
  }
}

/* ------------------------------------------------------------------------ */
/* The browser side                                                          */
/* ------------------------------------------------------------------------ */

async function serviceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  const container = navigator.serviceWorker;
  const existing = await container.getRegistration();
  if (existing?.active) return existing;
  /* `ready` never settles where no worker is registered (a dev server without
     VITE_ENABLE_PWA_DEV), so it is raced against a deadline. */
  return Promise.race([
    container.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
  ]);
}

function sameKey(current: ArrayBuffer | null, wanted: Uint8Array): boolean {
  if (current === null) return true;
  return base64UrlFromBytes(current) === base64UrlFromBytes(wanted);
}

async function pushSubscription(
  registration: ServiceWorkerRegistration,
  vapidKey: string,
): Promise<PushSubscription> {
  const applicationServerKey = bytesFromBase64Url(vapidKey);
  const existing = await registration.pushManager.getSubscription();
  if (existing && sameKey(existing.options.applicationServerKey, applicationServerKey)) {
    return existing;
  }
  /* A subscription under another key cannot be re-subscribed over. */
  if (existing) await existing.unsubscribe();
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey as BufferSource,
  });
}

async function postJson(path: string, body: unknown, keepalive = false): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive,
  });
}

/**
 * Turns background push on for one Passport account. Asks for notification
 * permission if it has never been answered (so call it from a user gesture
 * the first time). Resolves true only when the server has the registration.
 */
export async function enablePush(account: string | null | undefined): Promise<boolean> {
  /* Two callers in one tick (a tap and a remount) share one registration. */
  inFlight ??= registerPush(account).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

let inFlight: Promise<boolean> | null = null;

async function registerPush(account: string | null | undefined): Promise<boolean> {
  const config = pushConfig();
  const normalised = normaliseAccount(account);
  if (config === null || !pushSupported() || normalised === null) return false;
  try {
    if ((await requestNotificationPermission()) !== 'granted') return false;
    const registration = await serviceWorkerRegistration();
    if (registration === null) {
      console.info('[push] no service worker, so no background push');
      return false;
    }
    const previous = readStoredPush();
    if (previous !== null && previous.account !== normalised) {
      /* One browser, one subscription: the Passport this browser used to
         notify for stops being notified here. */
      await postJson('/api/push/unregister', { account: previous.account, token: previous.token }).catch(
        () => undefined,
      );
    }
    const subscription = await pushSubscription(registration, config.vapidKey);
    const p256dh = subscription.getKey('p256dh');
    const auth = subscription.getKey('auth');
    if (p256dh === null || auth === null) throw new Error('the subscription carries no keys');
    const token = await fcmRegistrationToken(
      config,
      { endpoint: subscription.endpoint, p256dh: base64UrlFromBytes(p256dh), auth: base64UrlFromBytes(auth) },
      location.host,
    );
    const response = await postJson('/api/push/register', { account: normalised, token });
    if (!response.ok) throw new Error(`register answered ${response.status}`);
    writeStoredPush({ account: normalised, token, endpoint: subscription.endpoint, at: Date.now() });
    return true;
  } catch (cause) {
    console.info('[push] could not turn background push on', cause);
    return false;
  }
}

/** Turns background push off for this browser. Never rejects. */
export async function disablePush(account?: string | null): Promise<void> {
  const stored = readStoredPush();
  writeStoredPush(null);
  if (pushConfig() === null || !pushSupported()) return;
  try {
    const target = stored?.account ?? normaliseAccount(account);
    if (stored !== null && target !== null) {
      await postJson('/api/push/unregister', { account: target, token: stored.token });
    }
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
  } catch (cause) {
    console.info('[push] could not turn background push off cleanly', cause);
  }
}

/**
 * Keeps an existing opt-in current: re-registers when this browser has never
 * registered this account, when the subscription has changed under it (a
 * `pushsubscriptionchange` in the worker), or once a week. Call it only when
 * notifications are already on; it never prompts, because permission is
 * already granted by then.
 */
export async function refreshPush(account: string | null | undefined): Promise<void> {
  const normalised = normaliseAccount(account);
  if (!pushAvailable() || normalised === null || notificationPermission() !== 'granted') return;
  try {
    const stored = readStoredPush();
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    const current =
      stored !== null &&
      stored.account === normalised &&
      subscription?.endpoint === stored.endpoint &&
      Date.now() - stored.at < REFRESH_AFTER_MS;
    if (!current) await enablePush(normalised);
  } catch (cause) {
    console.info('[push] could not refresh background push', cause);
  }
}

/**
 * Tells the server a payment to another Passport account has gone out, so
 * that account's devices can be woken. Fire and forget: it returns at once,
 * and nothing it does can reach the send flow. `tx` may be the ledger hash or
 * the submit's identifier, which is looked up first when a `lookup` is given.
 */
export function announcePayment(input: {
  recipientAccount: string;
  tx: string | null | undefined;
  lookup?: ReceiptHashLookup;
}): void {
  if (pushConfig() === null) return;
  const recipientAccount = normaliseAccount(input.recipientAccount);
  if (recipientAccount === null) return;
  void (async () => {
    const txHash = await resolveReceiptHash(input.tx, {
      lookup: input.lookup ?? (() => Promise.resolve(null)),
      attempts: input.lookup ? 12 : 1,
    });
    if (txHash === null) return;
    await postJson('/api/push/notify', { recipientAccount, txHash }, true);
  })().catch((cause: unknown) => {
    console.info('[push] could not announce the payment', cause);
  });
}
