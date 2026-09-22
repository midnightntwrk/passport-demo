import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { installNetworkBoundary, PASSPORT_ACCOUNT_ADDRESS } from './mocks.js';
import { installVirtualAuthenticator } from './passkey.js';
import { SIGN_IN_BUTTON } from './walkContext.js';

// The September reference is a product-wide contract, not just a login hero.
// Use recorded network responses and a virtual passkey; never submit to a chain.
const NAME = 'referencewalk';

async function capture(page: Page, info: TestInfo, name: string) {
  await expect(page.locator('#mn-splash')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: !['home', 'send', 'receive'].includes(name),
    animations: 'disabled',
  });
}

async function completedPassport(page: Page) {
  // End the deliberately suspended claim before writing the returning-account
  // fixture: an in-flight claim's unload rejection otherwise overwrites it.
  await page.goto('about:blank');
  await page.goto('/');
  await expect(page.locator('.mnid-screen, .mnhome-screen')).toBeVisible();
  // Same returning-account fixture as assets.spec.ts. This does not claim that
  // the mocked tier has proved or submitted a registration transaction.
  await page.evaluate(({ alias, address }) => {
    const credentialId = localStorage.getItem('passport-last-passkey');
    if (!credentialId) throw new Error('The virtual passkey ceremony did not complete');
    const updatedAt = new Date().toISOString();
    localStorage.setItem('passport-alias:v1', JSON.stringify({ stagenet: {
      alias, domain: `${alias}.night`, network: 'stagenet', status: 'registered',
      resolverAddress: 'dd'.repeat(32), resolverDeployTxId: 'aa'.repeat(32),
      registerTxId: 'bb'.repeat(32), registryConfirmed: true,
      resolverTarget: 'contract', resolverTargetHex: address, updatedAt,
    } }));
    localStorage.setItem('passport-contract:v1', JSON.stringify({ [`${credentialId}::stagenet`]: {
      credentialId, network: 'stagenet', status: 'deployed', address,
      deployTxId: 'cc'.repeat(32), txIdResolved: true, ledgerConfirmed: true,
      feePaidBy: 'sponsored', updatedAt,
    } }));
  }, { alias: NAME, address: PASSPORT_ACCOUNT_ADDRESS });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Send', exact: true }).first()).toBeVisible();
}

for (const theme of ['Light', 'Dark'] as const) {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    test(`${theme} ${viewport.width}: the reference design follows the whole journey`, async ({ browser }, info) => {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block', reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await installNetworkBoundary(page);
      // A deterministic directory entry exercises the illustrated/featured
      // state from the reference without depending on a live app directory.
      await page.route('https://raw.githubusercontent.com/webisoftSoftware/1AM-app-registery/main/registry.json', route => route.fulfill({
        json: { apps: [{
          id: 'raffle-demo', name: 'Midnight Raffle', url: 'https://raffle.example.test',
          description: 'Connect your Passport to claim a race-weekend perk and a demo raffle ticket',
          category: 'other', networks: ['stagenet'], featured: true,
        }] },
      }));
      await installVirtualAuthenticator(context, page);
      try {
        await page.goto('/');
        await page.getByRole('button', { name: theme, exact: true }).click();
        await expect(page.getByRole('button', { name: SIGN_IN_BUTTON })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Continue with Dynamic', exact: true })).toBeVisible();
        await capture(page, info, 'login');

        await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
        await expect(page.locator('.mnid-title')).toHaveText('Welcome to Passport', { timeout: 60_000 });
        await expect(page.locator('.mnid-screen')).toHaveCSS('background-image', 'none');
        await expect(page.locator('.mnid-title')).toHaveCSS('font-weight', '800');
        await capture(page, info, 'welcome');
        await page.getByRole('button', { name: 'Choose my name' }).click();
        await page.getByLabel('Your Midnight name').fill(NAME);
        await expect(page.getByText(`${NAME}.night is available`)).toBeVisible();
        await expect(page.locator('.mnid-primary')).toHaveCSS('background-image', 'none');
        await capture(page, info, 'name');

        await page.route('**/zk/**', () => {});
        await page.getByRole('button', { name: `Claim ${NAME}.night` }).click();
        await expect(page.locator('.mnid-stepper-item').nth(2)).toHaveAttribute('data-state', 'active', { timeout: 60_000 });
        await capture(page, info, 'progress');
        await page.getByRole('button', { name: /Play while you wait/i }).click();
        await capture(page, info, 'progress-game');

        await completedPassport(page);
        await expect(page.locator('.mnhome-name')).toContainText(`, ${NAME}`);
        await expect(page.locator('.mnhome-screen')).toHaveCSS('background-image', 'none');
        await expect(page.locator('.mnhome-action-primary')).toHaveCSS('background-image', 'none');
        await expect(page.locator('.mnnav-tab-active')).toHaveCSS('background-color', 'rgb(0, 0, 254)');
        await expect(page.locator('.mnnav-tab-active')).toHaveCSS('color', 'rgb(255, 255, 255)');
        await expect(page.locator('.mnhome-token-row')).toHaveCount(3);
        await expect(page.getByRole('button', { name: /Midnight Raffle/ })).toBeVisible();
        for (const notice of await page.getByRole('button', { name: 'Dismiss notification' }).all()) {
          await notice.click();
        }
        await capture(page, info, 'home');

        await page.getByRole('button', { name: 'Send', exact: true }).first().click();
        await expect(page.locator('.mnhome-send')).toBeVisible();
        const send = await page.locator('.mnhome-send').boundingBox();
        expect(send!.y).toBeGreaterThanOrEqual(0);
        expect(send!.y + send!.height).toBeLessThanOrEqual(viewport.height);
        await capture(page, info, 'send');
        await page.getByRole('button', { name: 'Close', exact: true }).click();
        await page.getByRole('button', { name: 'Receive', exact: true }).click();
        await expect(page.locator('.mnhome-addr-modal')).toBeVisible();
        await capture(page, info, 'receive');
        await page.getByRole('button', { name: 'Close', exact: true }).click();

        await page.locator('.mnnav-tab').filter({ hasText: 'Assets' }).click();
        await expect(page.getByRole('heading', { name: 'Assets', exact: true })).toBeVisible();
        await expect(page.locator('.mnassets-screen')).toHaveCSS('background-image', 'none');
        await capture(page, info, 'assets');
        await page.locator('.mnnav-tab').filter({ hasText: 'Apps' }).click();
        await expect(page.getByRole('heading', { name: 'Apps', exact: true })).toBeVisible();
        await expect(page.locator('.mnapps-screen')).toHaveCSS('background-image', 'none');
        await expect(page.getByRole('button', { name: /Midnight Raffle/ })).toBeVisible();
        await capture(page, info, 'apps');
        await page.getByPlaceholder('Search apps').fill('no-such-app');
        await expect(page.locator('.mnapps-empty')).toHaveText('No app matches “no-such-app”.');
        await capture(page, info, 'apps-empty');
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
}
