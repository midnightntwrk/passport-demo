/**
 * SIGN UP ALWAYS MAKES A NEW PASSPORT (2026/09/25).
 *
 * THE REPORT. Somebody who had signed up once in a browser pressed "Sign up"
 * again and could not make a new Passport: they were put straight back into
 * the first one, unfinished setup and all. "Sign up" was still running the
 * retired single button's guess — a browser holding a Passport was signed back
 * into it — and even its create path discovered first and excluded every
 * credential the browser knew of, which a platform authenticator answers by
 * refusing the create outright. The refusal was then turned into a sign-in.
 *
 * WHAT THIS HOLDS, from the outside:
 *
 *   - "Sign up" in a browser that already holds a Passport raises exactly ONE
 *     ceremony, a create, with an EMPTY exclusion list and no sign-in dialog in
 *     front of it;
 *   - the authenticator then holds two passkeys, the browser remembers the new
 *     one, and the screen is a new Passport's welcome — not the old one's name
 *     step, not its Home;
 *   - the old Passport is untouched and "Log in" is the way back into it,
 *     including into its unfinished setup, with no create on the way.
 *
 * Both routes a passkey Passport can be made on are walked: the one production
 * builds take, and the account custody route that `?accwalk=1` selects.
 *
 * THE FIXTURES, and why each one is there. The authenticator is Chromium's
 * virtual one, built by hand through CDP so the walk can count the passkeys it
 * holds. Every `navigator.credentials` call is recorded at the boundary so the
 * walk can say which ceremonies ran. And "Log in" raises the platform's own
 * picker, whose choice no test can make by pointing at it: the pick is made
 * where the platform makes it, by narrowing that one discoverable request to
 * the passkey the reader would have chosen — armed a call at a time, the same
 * class of fixture as the refused assertion `onboarding.spec.ts` arms.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type BrowserContext, type CDPSession, type Page } from '@playwright/test';

import { installNetworkBoundary } from './mocks.js';
import { walkContextOptions } from './walkContext.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const WALK_NETWORK = 'stagenet';

/** What a new Passport on a browser that already holds one is told. */
const OTHER_KEY_NOTICE =
  'This browser already holds a Passport set up with a different key. Use that key to open it, or carry on here to make a second one.';

type Ceremony = { kind: 'create' | 'get'; excluded?: number };

interface Harness {
  context: BrowserContext;
  page: Page;
  client: CDPSession;
  authenticatorId: string;
  calls: Ceremony[];
}

async function openHarness(
  browser: import('@playwright/test').Browser,
  before?: (page: Page) => Promise<void>,
): Promise<Harness> {
  const context = await browser.newContext(
    walkContextOptions({ viewport: { width: 420, height: 900 } }),
  );
  const page = await context.newPage();
  await installNetworkBoundary(page);
  if (before) await before(page);

  const client = await context.newCDPSession(page);
  await client.send('WebAuthn.enable', { enableUI: false });
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
      hasLargeBlob: true,
      automaticPresenceSimulation: true,
    },
  });

  const calls: Ceremony[] = [];
  await page.exposeFunction('__recordCeremony', (entry: Ceremony) => {
    calls.push(entry);
  });
  await page.addInitScript(() => {
    const api = navigator.credentials;
    const create = api.create.bind(api);
    const get = api.get.bind(api);
    const record = (entry: unknown) =>
      void (window as unknown as Record<string, (entry: unknown) => void>).__recordCeremony(entry);
    api.create = (options?: CredentialCreationOptions) => {
      const publicKey = options?.publicKey as { excludeCredentials?: unknown[] } | undefined;
      record({ kind: 'create', excluded: publicKey?.excludeCredentials?.length ?? 0 });
      return create(options);
    };
    api.get = (options?: CredentialRequestOptions) => {
      record({ kind: 'get' });
      /* THE READER'S PICK. The platform's picker would list every passkey this
         site has; the reader chooses one. Narrowing the one request to that
         credential is the choice, made where the platform makes it. */
      const state = window as unknown as { __pickCredential?: string | null };
      const picked = state.__pickCredential ?? null;
      if (picked !== null && options?.publicKey) {
        state.__pickCredential = null;
        const normal = picked.replace(/-/g, '+').replace(/_/g, '/');
        const padded = normal + '='.repeat((4 - (normal.length % 4)) % 4);
        const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
        return get({
          ...options,
          publicKey: {
            ...options.publicKey,
            allowCredentials: [{ type: 'public-key', id: bytes }],
          },
        });
      }
      return get(options);
    };
  });
  return { context, page, client, authenticatorId, calls };
}

async function closeHarness(h: Harness): Promise<void> {
  await h.client
    .send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: h.authenticatorId })
    .catch(() => {});
  await h.context.close();
}

/** How many passkeys the authenticator holds for this site. */
async function passkeysHeld(h: Harness): Promise<number> {
  const { credentials } = await h.client.send('WebAuthn.getCredentials', {
    authenticatorId: h.authenticatorId,
  });
  return credentials.length;
}

/** The passkey this browser last opened a Passport with. */
function lastPasskey(page: Page): Promise<string | null> {
  return page.evaluate(() => window.localStorage.getItem('passport-last-passkey'));
}

/** Every local Passport profile this browser holds. */
async function storedProfileKeys(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('midnight-passport', 2);
      open.onerror = () => reject(new Error('the profile store would not open'));
      open.onsuccess = () => resolve(open.result);
    });
    const keys = await new Promise<string[]>((resolve, reject) => {
      const request = db
        .transaction('public-profile', 'readonly')
        .objectStore('public-profile')
        .getAllKeys();
      request.onsuccess = () => resolve(request.result.map(String));
      request.onerror = () => reject(new Error('the profile keys could not be read'));
    });
    db.close();
    return keys;
  });
}

/**
 * Back to the landing screen with every Passport and every passkey intact —
 * what signing out does. The session record is the reload stopgap; clearing it
 * is the whole of a sign-out as far as stored state goes.
 */
async function signOutToLanding(page: Page, url: string): Promise<void> {
  await page.evaluate(
    async () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase('midnight-passport-session');
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      }),
  );
  await page.goto(url);
  await expect(page.getByRole('button', { name: 'Sign up', exact: true })).toBeVisible({
    timeout: 60_000,
  });
}

const welcome = (page: Page) => page.getByRole('heading', { name: /Welcome to\s*Passport/i });
const nameStep = (page: Page) => page.getByRole('heading', { name: /Choose\s*your \.night name/i });

/* -------------------------------------------------------------------------- */
/* The route production builds take                                           */
/* -------------------------------------------------------------------------- */

test('Sign up in a browser that already holds a Passport makes a second one with a new passkey', async ({
  browser,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'the walk counts the passkeys the authenticator holds, which only a CDP-built authenticator lets Playwright read.',
  );
  test.setTimeout(240_000);
  const h = await openHarness(browser);
  const { page, calls } = h;

  try {
    /* THE FIRST PASSPORT, left unfinished on its name step. */
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign up', exact: true }).click();
    await expect(welcome(page)).toBeVisible({ timeout: 120_000 });
    const first = await lastPasskey(page);
    expect(first, 'the app records the passkey it enrolled').not.toBeNull();
    await page.getByRole('button', { name: /^Choose my (\.night )?name$/ }).click();
    await expect(nameStep(page)).toBeVisible({ timeout: 60_000 });

    /* Signed out, the landing points a returning reader at Log in. */
    await signOutToLanding(page, '/');
    await expect(page.getByTestId('login-to-carry-on')).toHaveText(
      'Already have a Passport on this device? Log in to carry on with it.',
    );

    /* SIGN UP AGAIN. One create, nothing excluded, no sign-in in front of it. */
    calls.length = 0;
    await page.getByRole('button', { name: 'Sign up', exact: true }).click();
    await expect(welcome(page)).toBeVisible({ timeout: 120_000 });
    expect(calls).toEqual([{ kind: 'create', excluded: 0 }]);

    const second = await lastPasskey(page);
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(await passkeysHeld(h)).toBe(2);
    expect((await storedProfileKeys(page)).length).toBe(2);
    /* A new Passport's welcome, and none of the first one's screens. */
    await expect(nameStep(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)\.$/ })).toHaveCount(0);
    await expect(page.getByText(/already holds a Passport passkey/i)).toHaveCount(0);

    /* LOG IN IS THE WAY BACK to the first one, and it makes nothing. */
    await signOutToLanding(page, '/');
    calls.length = 0;
    await page.evaluate((id) => {
      (window as unknown as { __pickCredential?: string }).__pickCredential = id;
    }, first as string);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    /* Reopened, not created: no welcome, straight back to its name step. */
    await expect(nameStep(page)).toBeVisible({ timeout: 120_000 });
    await expect(welcome(page)).toHaveCount(0);
    expect(calls.map((entry) => entry.kind)).not.toContain('create');
    expect(await lastPasskey(page)).toBe(first);
    /* And the second Passport is still there beside it. */
    expect(await passkeysHeld(h)).toBe(2);
    expect((await storedProfileKeys(page)).length).toBe(2);
  } finally {
    await closeHarness(h);
  }
});

/* -------------------------------------------------------------------------- */
/* The account custody route                                                  */
/* -------------------------------------------------------------------------- */

const ACCOUNT_CUSTODY_STATE = fs.readFileSync(
  path.join(here, 'fixtures', 'stagenet-account-custody.json'),
  'utf8',
);
const ACCOUNT_CUSTODY_DEPLOY_TX = fs.readFileSync(
  path.join(here, 'fixtures', 'stagenet-account-custody-deploy-tx.json'),
  'utf8',
);
const ACCOUNT_CUSTODY_DEPLOY_STATE = fs.readFileSync(
  path.join(here, 'fixtures', 'stagenet-account-custody-deploy-state.json'),
  'utf8',
);
const ACCOUNT_CUSTODY_ADDRESS = 'cbd6b1c14a99c1751caa80a5665f01cb8067a9758183bda5da581e4ef745d215';
const WALK = '/?accwalk=1';

/** The recorded account, answered ahead of the boundary. See `passkey-custody.spec.ts`. */
async function serveAccountCustodyState(page: Page): Promise<void> {
  await page.route('**/indexer.stagenet.shielded.tools/**', async (route) => {
    const body = route.request().postData() ?? '';
    const asked = (/"address":"([0-9a-fA-F]+)"/.exec(body)?.[1] ?? '').toLowerCase();
    if (asked !== ACCOUNT_CUSTODY_ADDRESS) return route.fallback();
    if (body.includes('DEPLOY_CONTRACT_STATE_TX_QUERY')) {
      return route.fulfill({ contentType: 'application/json', body: ACCOUNT_CUSTODY_DEPLOY_STATE });
    }
    if (body.includes('DEPLOY_TX_QUERY')) {
      return route.fulfill({ contentType: 'application/json', body: ACCOUNT_CUSTODY_DEPLOY_TX });
    }
    if (body.includes('CONTRACT_STATE_QUERY')) {
      return route.fulfill({ contentType: 'application/json', body: ACCOUNT_CUSTODY_STATE });
    }
    return route.fallback();
  });
}

/**
 * The first passkey's Passport, UNFINISHED: its account is up and no name has
 * been claimed, so it opens on the name step. Keyed by credential for the
 * pointer and by device key for the rest, exactly as a real setup leaves it.
 * Written once, into this browser's storage, rather than on every navigation.
 */
async function seedUnfinishedPassport(page: Page, credentialId: string): Promise<void> {
  const userKey = 'jubjub:2a1f';
  const recordKey = `${userKey}|${WALK_NETWORK}`;
  await page.evaluate(
    ([key, pointer, user, network, address]) => {
      window.localStorage.setItem(
        'passport-account-custody:v1',
        JSON.stringify({
          [key]: {
            user,
            network,
            address,
            privateStateId: `passport-account-custody-${user.slice(7, 15)}`,
            saltHex: '',
            pkXHex: null,
            pkYHex: null,
            wavesDone: 4,
            totalWaves: 4,
            activated: true,
            txHashes: [],
          },
        }),
      );
      window.localStorage.setItem(
        'passport-account-custody-passkey:v1',
        JSON.stringify({ [pointer]: user }),
      );
    },
    [recordKey, `${credentialId}|${WALK_NETWORK}`, userKey, WALK_NETWORK, ACCOUNT_CUSTODY_ADDRESS] as const,
  );
}

test('on the account custody route, Sign up makes a new Passport and Log in resumes the unfinished one', async ({
  browser,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'the walk counts the passkeys the authenticator holds, which only a CDP-built authenticator lets Playwright read.',
  );
  test.setTimeout(240_000);
  const h = await openHarness(browser, serveAccountCustodyState);
  const { page, calls } = h;

  try {
    await page.goto(WALK);
    await page.getByRole('button', { name: 'Sign up', exact: true }).click();
    await expect(welcome(page)).toBeVisible({ timeout: 120_000 });
    const first = await lastPasskey(page);
    expect(first).not.toBeNull();

    /* Its setup got as far as the account and stopped before the name. */
    await seedUnfinishedPassport(page, first as string);
    await page.goto(WALK);
    await expect(nameStep(page)).toBeVisible({ timeout: 60_000 });

    /* SIGN UP AGAIN, from the landing. */
    await signOutToLanding(page, WALK);
    calls.length = 0;
    await page.getByRole('button', { name: 'Sign up', exact: true }).click();
    await expect(welcome(page)).toBeVisible({ timeout: 120_000 });
    expect(calls).toEqual([{ kind: 'create', excluded: 0 }]);

    const second = await lastPasskey(page);
    expect(second).not.toBe(first);
    expect(await passkeysHeld(h)).toBe(2);
    /* A NEW Passport's welcome, which says — once — that the browser holds
       another one and how to reach it. None of the first one's screens. */
    await expect(page.getByText(OTHER_KEY_NOTICE)).toBeVisible();
    await expect(nameStep(page)).toHaveCount(0);
    /* The first Passport's pointer is still the only one: nothing was written
       over it, and the new passkey has not claimed anything. */
    const pointers = await page.evaluate(() =>
      window.localStorage.getItem('passport-account-custody-passkey:v1'),
    );
    expect(Object.keys(JSON.parse(pointers ?? '{}') as Record<string, string>)).toEqual([
      `${first}|${WALK_NETWORK}`,
    ]);

    /* LOG IN, PICKING THE FIRST: its unfinished setup resumes where it stopped. */
    await signOutToLanding(page, WALK);
    calls.length = 0;
    await page.evaluate((id) => {
      (window as unknown as { __pickCredential?: string }).__pickCredential = id;
    }, first as string);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(nameStep(page)).toBeVisible({ timeout: 120_000 });
    await expect(welcome(page)).toHaveCount(0);
    expect(calls.map((entry) => entry.kind)).not.toContain('create');
    expect(await lastPasskey(page)).toBe(first);
    expect(await passkeysHeld(h)).toBe(2);
  } finally {
    await closeHarness(h);
  }
});
