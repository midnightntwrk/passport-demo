// SCRATCH ONLY — never committed. Screenshots of the ported UI for review.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Browser, type Page } from '@playwright/test';

import { PASSPORT_ACCOUNT_ADDRESS, installNetworkBoundary } from './mocks.js';
import { installVirtualAuthenticator } from './passkey.js';
import { SIGN_IN_BUTTON, walkContextOptions } from './walkContext.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.SHOTS_DIR ?? path.join(here, '..', 'shots');
const WALK = '/?accwalk=1';
const NET = 'stagenet';
const ADDR = 'cbd6b1c14a99c1751caa80a5665f01cb8067a9758183bda5da581e4ef745d215';
const MUSD = '1a2917fbed8b5ce44d12ebc7d337689045f6c96a6bbd39cf3d8691ab310ef6a6';
const fx = (n: string) => fs.readFileSync(path.join(here, 'fixtures', n), 'utf8');
const STATE = fx('stagenet-account-custody.json');
const DTX = fx('stagenet-account-custody-deploy-tx.json');
const DSTATE = fx('stagenet-account-custody-deploy-state.json');

async function serve(page: Page) {
  const wanted = new Set([ADDR, PASSPORT_ACCOUNT_ADDRESS].map((a) => a.toLowerCase()));
  await page.route('**/indexer.stagenet.shielded.tools/**', async (route) => {
    const body = route.request().postData() ?? '';
    const asked = (/"address":"([0-9a-fA-F]+)"/.exec(body)?.[1] ?? '').toLowerCase();
    if (!wanted.has(asked)) return route.fallback();
    if (body.includes('DEPLOY_CONTRACT_STATE_TX_QUERY')) return route.fulfill({ contentType: 'application/json', body: DSTATE });
    if (body.includes('DEPLOY_TX_QUERY')) return route.fulfill({ contentType: 'application/json', body: DTX });
    if (body.includes('CONTRACT_STATE_QUERY')) return route.fulfill({ contentType: 'application/json', body: STATE });
    return route.fallback();
  });
}

async function seed(page: Page, credentialId: string, userKey: string) {
  const key = `${userKey}|${NET}`;
  const record = {
    user: userKey, network: NET, address: ADDR,
    privateStateId: `passport-account-custody-${userKey.slice(7, 15)}`,
    saltHex: '', pkXHex: null, pkYHex: null, wavesDone: 4, totalWaves: 4, activated: true, txHashes: [],
  };
  const store = {
    [`${NET}::${ADDR}`]: {
      encSecretKeyHex: 'ab'.repeat(32),
      coins: { [MUSD]: { nonceHex: 'cd'.repeat(32), colorHex: MUSD, value: '250', mtIndex: '12' } },
      queued: {}, spentNonces: [], mtIndexCandidates: {}, awaiting: {},
    },
  };
  await page.addInitScript(([k, r, s, p, u]) => {
    localStorage.setItem('passport-account-custody:v1', JSON.stringify({ [k]: r }));
    localStorage.setItem('passport-account-custody-name:v1', JSON.stringify({ [k]: 'walker' }));
    localStorage.setItem('passport-k1-coins:v1', JSON.stringify(s));
    localStorage.setItem('passport-account-custody-passkey:v1', JSON.stringify({ [p]: u }));
  }, [key, record, store, `${credentialId}|${NET}`, userKey] as const);
}

const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true, animations: 'disabled' });
};

async function ctx(browser: Browser, width: number, theme: string) {
  const context = await browser.newContext(
    { ...walkContextOptions({ serviceWorkers: 'block' }), viewport: { width, height: 900 } },
  );
  await context.addInitScript((t) => localStorage.setItem('passport-theme', t), theme);
  const page = await context.newPage();
  await installNetworkBoundary(page);
  await serve(page);
  const auth = await installVirtualAuthenticator(context, page);
  return { context, page, auth };
}

for (const theme of ['light', 'dark']) {
  for (const width of [420, 1440]) {
    const tag = `${width}-${theme}`;
    test(`onboarding ${tag}`, async ({ browser }) => {
      test.setTimeout(240_000);
      const { context, page } = await ctx(browser, width, theme);
      await page.route('**/zk/**', () => {});
      await page.goto(WALK);
      await expect(page.getByRole('button', { name: SIGN_IN_BUTTON })).toBeVisible();
      await expect(page.locator('#mn-splash')).toHaveCount(0);
      await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
      await expect(page.getByRole('heading', { name: /Welcome to\s*Passport/ })).toBeVisible({ timeout: 60_000 });
      await shot(page, `2-welcome-${tag}`);
      await page.getByRole('button', { name: 'Choose my name' }).click();
      await page.getByLabel('Your name').fill('walker');
      await expect(page.getByText('walker.night is available')).toBeVisible({ timeout: 60_000 });
      await shot(page, `3-name-${tag}`);
      await page.getByRole('button', { name: 'Create my Passport' }).click();
      await expect(page.locator('.mnid-stepper-item').nth(2)).toHaveAttribute('data-state', 'active', { timeout: 120_000 });
      await shot(page, `4-setup-${tag}`);
      const offer = page.getByRole('button', { name: 'Play while you wait' });
      await expect(offer).toBeVisible({ timeout: 60_000 });
      await offer.click();
      await expect(page.locator('.mngame')).toBeVisible();
      await shot(page, `4b-setup-game-${tag}`);
      await context.close();
    });

    test(`recovery and home ${tag}`, async ({ browser }) => {
      test.setTimeout(240_000);
      const { context, page, auth } = await ctx(browser, width, theme);
      await page.goto(WALK);
      await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
      await page.getByRole('button', { name: 'Choose my name' }).click({ timeout: 60_000 });
      await page.getByLabel('Your name').fill('walker');
      await expect(page.getByRole('button', { name: 'Create my Passport' })).toBeEnabled({ timeout: 120_000 });
      await page.getByRole('button', { name: 'Create my Passport' }).click();
      const seeded = await page.waitForFunction(() => {
        const credentialId = localStorage.getItem('passport-last-passkey');
        const raw = localStorage.getItem('passport-account-custody-passkey:v1');
        if (credentialId === null || raw === null) return null;
        const entry = Object.entries(JSON.parse(raw) as Record<string, string>)[0];
        return entry === undefined ? null : { credentialId, userKey: entry[1] };
      }, undefined, { timeout: 60_000 });
      const id = (await seeded.jsonValue()) as { credentialId: string; userKey: string };
      await seed(page, id.credentialId, id.userKey);
      await page.goto(`${WALK}&dynamicwalk=out`);
      await expect(page.getByRole('heading', { name: /Add a way\s*back/ })).toBeVisible({ timeout: 60_000 });
      await shot(page, `5-recovery-${tag}`);
      await page.getByTestId('skip-recovery').click();
      await expect(page.getByText('Your account is ready')).toBeVisible({ timeout: 60_000 });
      await expect(page.locator('.mnhome-activity')).toContainText('Passport created', { timeout: 30_000 });
      await shot(page, `6-home-${tag}`);
      await page.getByRole('button', { name: /^Send$/ }).first().click();
      await expect(page.locator('.mnhome-send')).toBeVisible();
      await shot(page, `7-send-${tag}`);
      await auth.remove();
      await context.close();
    });

    test(`landing ${tag}`, async ({ browser }) => {
      const { context, page } = await ctx(browser, width, theme);
      await page.route('**/zk/**', () => {});
      await page.goto(`${WALK}&dynamicwalk=out`);
      await expect(page.getByRole('button', { name: SIGN_IN_BUTTON })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('recover-lost-device')).toBeVisible();
      await expect(page.locator('#mn-splash')).toHaveCount(0);
      await shot(page, `1-landing-${tag}`);
      await context.close();
    });

    test(`recovery road ${tag}`, async ({ browser }) => {
      const { context, page } = await ctx(browser, width, theme);
      await page.goto(`${WALK}&dynamicwalk=out`);
      const road = page.getByTestId('recover-lost-device');
      if (await road.count()) {
        await road.click();
        await page.waitForTimeout(1200);
        await shot(page, `8-recovery-road-${tag}`);
      }
      await context.close();
    });
  }
}

