/**
 * A PASSKEY PASSPORT ON THE ACCOUNT CUSTODY CONTRACT, OPENED ON HOME — for the
 * walks that need to stand on a real Home rather than test how it got there.
 *
 * The shapes here are the ones `passkey-custody.spec.ts` seeds, spelled out
 * again rather than imported: Playwright registers the tests of any spec file
 * that is imported, so a helper living inside a spec cannot be shared. The
 * walk's own reason for spelling them out applies here too — the point is that
 * the SHIPPED reader reads what a previous session left behind.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, type Browser, type Page } from '@playwright/test';

import { PASSPORT_ACCOUNT_ADDRESS, installNetworkBoundary } from './mocks.js';
import { installVirtualAuthenticator } from './passkey.js';
import { SIGN_IN_BUTTON, walkContextOptions } from './walkContext.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The URL that puts this tab on the account custody route. */
export const CUSTODY_WALK = '/?accwalk=1';

const WALK_NETWORK = 'stagenet';

const ACCOUNT_CUSTODY_ADDRESS =
  'cbd6b1c14a99c1751caa80a5665f01cb8067a9758183bda5da581e4ef745d215';

/** The demo stablecoin's colour, as `src/lib/colour.ts` knows it. */
const MUSD_COLOUR = '1a2917fbed8b5ce44d12ebc7d337689045f6c96a6bbd39cf3d8691ab310ef6a6';

const fixture = (name: string): string => fs.readFileSync(path.join(here, 'fixtures', name), 'utf8');

/** Home's greeting: the time of day alone. */
export function homeGreeting(page: Page) {
  return page.getByRole('heading', { name: /^Good (morning|afternoon|evening)\.$/ });
}

/** Answers the recorded account custody state for the walk's accounts. */
export async function serveAccountCustodyState(page: Page): Promise<void> {
  const state = fixture('stagenet-account-custody.json');
  const deployTx = fixture('stagenet-account-custody-deploy-tx.json');
  const deployState = fixture('stagenet-account-custody-deploy-state.json');
  const wanted = new Set([ACCOUNT_CUSTODY_ADDRESS, PASSPORT_ACCOUNT_ADDRESS.toLowerCase()]);
  await page.route('**/indexer.stagenet.shielded.tools/**', async (route) => {
    const body = route.request().postData() ?? '';
    const asked = (/"address":"([0-9a-fA-F]+)"/.exec(body)?.[1] ?? '').toLowerCase();
    if (!wanted.has(asked)) return route.fallback();
    if (body.includes('DEPLOY_CONTRACT_STATE_TX_QUERY')) {
      return route.fulfill({ contentType: 'application/json', body: deployState });
    }
    if (body.includes('DEPLOY_TX_QUERY')) {
      return route.fulfill({ contentType: 'application/json', body: deployTx });
    }
    if (body.includes('CONTRACT_STATE_QUERY')) {
      return route.fulfill({ contentType: 'application/json', body: state });
    }
    return route.fallback();
  });
}

/**
 * Takes a fresh passkey through the landing, the welcome, and the name step as
 * far as the press on "Create my Passport", which is what makes the app derive
 * and record the device point every store is keyed by. `atStep` is called on
 * each screen on the way, so a walk can measure them.
 *
 * `open` is the URL the finished Passport is opened at. The default lands on
 * Home; `${CUSTODY_WALK}&dynamicwalk=out` lands on the way-back step first, as
 * a Passport that has just been named does on a build with a sign-in provider.
 */
export async function custodyPassportOnHome(
  browser: Browser,
  atStep: (page: Page, step: 'landing' | 'welcome' | 'name') => Promise<void> = async () => {},
  open: string = CUSTODY_WALK,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext(walkContextOptions({ viewport: { width: 420, height: 900 } }));
  const page = await context.newPage();
  await installNetworkBoundary(page);
  await serveAccountCustodyState(page);
  const authenticator = await installVirtualAuthenticator(context, page);

  await page.goto(CUSTODY_WALK);
  await expect(page.getByRole('button', { name: SIGN_IN_BUTTON })).toBeVisible({ timeout: 60_000 });
  await atStep(page, 'landing');
  await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
  await expect(page.getByRole('heading', { name: /Welcome to\s*Passport/ })).toBeVisible({
    timeout: 60_000,
  });
  await atStep(page, 'welcome');
  await page.getByRole('button', { name: /^Choose my (\.night )?name$/ }).click();
  await page.getByLabel('Your name').fill('walker');
  await expect(page.getByRole('button', { name: 'Create my Passport' })).toBeEnabled({
    timeout: 120_000,
  });
  await atStep(page, 'name');
  await page.getByRole('button', { name: 'Create my Passport' }).click();
  const seeded = await page.waitForFunction(
    () => {
      const credentialId = window.localStorage.getItem('passport-last-passkey');
      const raw = window.localStorage.getItem('passport-account-custody-passkey:v1');
      if (credentialId === null || raw === null) return null;
      const pointers = JSON.parse(raw) as Record<string, string>;
      const entry = Object.entries(pointers)[0];
      return entry === undefined ? null : { credentialId, userKey: entry[1] };
    },
    undefined,
    { timeout: 60_000 },
  );
  const identity = (await seeded.jsonValue()) as { credentialId: string; userKey: string };

  const key = `${identity.userKey}|${WALK_NETWORK}`;
  const record = {
    user: identity.userKey,
    network: WALK_NETWORK,
    address: ACCOUNT_CUSTODY_ADDRESS,
    privateStateId: `passport-account-custody-${identity.userKey.slice(7, 15)}`,
    saltHex: '',
    pkXHex: null,
    pkYHex: null,
    wavesDone: 4,
    totalWaves: 4,
    activated: true,
    txHashes: [],
  };
  const store = {
    [`${WALK_NETWORK}::${ACCOUNT_CUSTODY_ADDRESS}`]: {
      encSecretKeyHex: 'ab'.repeat(32),
      coins: {
        [MUSD_COLOUR]: { nonceHex: 'cd'.repeat(32), colorHex: MUSD_COLOUR, value: '250', mtIndex: '12' },
      },
      queued: {},
      spentNonces: [],
      mtIndexCandidates: {},
      awaiting: {},
    },
  };
  await page.addInitScript(
    ([recordKey, seededRecord, seededStore, pointerKey, seededUser]) => {
      window.localStorage.setItem('passport-account-custody:v1', JSON.stringify({ [recordKey]: seededRecord }));
      window.localStorage.setItem('passport-account-custody-name:v1', JSON.stringify({ [recordKey]: 'walker' }));
      window.localStorage.setItem('passport-k1-coins:v1', JSON.stringify(seededStore));
      window.localStorage.setItem('passport-account-custody-passkey:v1', JSON.stringify({ [pointerKey]: seededUser }));
    },
    [key, record, store, `${identity.credentialId}|${WALK_NETWORK}`, identity.userKey] as const,
  );
  await page.goto(open);
  if (open === CUSTODY_WALK) await expect(homeGreeting(page)).toBeVisible({ timeout: 60_000 });
  return {
    page,
    close: async () => {
      await authenticator.remove();
      await context.close();
    },
  };
}
