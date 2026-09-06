/**
 * The section bar, in a real browser.
 *
 * This file was `assets.spec.ts` until the identity-first redesign retired
 * the Assets tab (money lives in the Pocket now; the parked screen is
 * `src/screens/Assets.tsx`, and its shelf drills return with it). What
 * survived the surface is drilled here: that the bar really offers the three
 * sections — PASSPORT, ACCESS, STAMPS — that they really switch and none is
 * a dead end, that no raw colour or address reaches any of the three, and
 * the split rule seen from Home: a holding filed as an ITEM is never
 * rendered among the balances. The split itself is pure and drilled in
 * `src/lib/colour.test.ts`; what a browser alone can answer is whether the
 * strip obeys it.
 *
 * WHY THIS FILE, AND NOT A COMPONENT TEST
 * ---------------------------------------
 * There is no jsdom in this workspace, on purpose: `vitest.config.ts` says so
 * and gives the reason — a fake DOM proves what a fake DOM does. Rendering is
 * drilled here, against a production build, driven by a real passkey.
 */

import { expect, test, type Page } from '@playwright/test';

import { installNetworkBoundary, PASSPORT_ACCOUNT_ADDRESS } from './mocks.js';
import { installVirtualAuthenticator } from './passkey.js';
import { specViewport } from './viewport.js';

test.describe.configure({ mode: 'serial' });

let page: Page;

/** A label that is free in the recorded registry snapshot. */
const NAME = 'navwalk';

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: specViewport({ width: 420, height: 900 }) });
  page = await context.newPage();
  await installNetworkBoundary(page);
  await installVirtualAuthenticator(context, page);

  /* A Passport that already exists, which is the state these screens are read
     in: the ceremony is drilled by `onboarding.spec.ts` and, for real, by
     `stagenet.live.spec.ts`. Enrol once, then seed the records a completed
     claim writes — the returning-Passport path, through the same components
     with the same props. */
  await page.goto('/');
  await page.getByRole('button', { name: /Continue with Passport/i }).click();
  await expect(page.getByRole('heading', { name: /Welcome to Passport/i })).toBeVisible({
    timeout: 90_000,
  });

  const seeded = await page.evaluate(
    ({ alias, address }) => {
      const credentialId = localStorage.getItem('passport-last-passkey');
      if (!credentialId) return null;
      const now = new Date().toISOString();
      localStorage.setItem(
        'passport-alias:v1',
        JSON.stringify({
          stagenet: {
            alias,
            domain: `${alias}.night`,
            network: 'stagenet',
            status: 'registered',
            resolverAddress: 'dd'.repeat(32),
            resolverDeployTxId: 'aa'.repeat(32),
            registerTxId: 'bb'.repeat(32),
            registryConfirmed: true,
            resolverTarget: 'contract',
            resolverTargetHex: address,
            updatedAt: now,
          },
        }),
      );
      localStorage.setItem(
        'passport-contract:v1',
        JSON.stringify({
          [`${credentialId}::stagenet`]: {
            credentialId,
            network: 'stagenet',
            status: 'deployed',
            address,
            deployTxId: 'cc'.repeat(32),
            txIdResolved: true,
            ledgerConfirmed: true,
            feePaidBy: 'sponsored',
            updatedAt: now,
          },
        }),
      );
      return credentialId;
    },
    { alias: NAME, address: PASSPORT_ACCOUNT_ADDRESS },
  );
  expect(seeded).not.toBeNull();

  await page.reload();
  /* The card proves the records landed; Pay inside the Pocket proves the
     session restored (the send seam is withheld without one) — the same two
     facts the old Send button's presence proved. The Pocket is closed again
     so every test starts on the plain Passport page. */
  await expect(page.locator('.mnpcard')).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: /^Pocket$/ }).click();
  await expect(page.getByRole('button', { name: /^Pay$/ })).toBeVisible({ timeout: 90_000 });
  await page.keyboard.press('Escape');
});

test.afterAll(async () => {
  await page.context().close();
});

/** The bar's tabs, in the order they are drawn. */
function tabs() {
  return page.locator('.mnnav .mnnav-tab');
}

test('the bar offers the three sections of the identity-first design', async () => {
  await expect(tabs()).toHaveCount(3);
  await expect(tabs()).toHaveText([/Passport/i, /Access/i, /Stamps/i]);

  /* Three tabs in a bar sized for two is how a label wraps inside a
     fixed-height pill. Each one gets a real share of the bar and none of them
     overflows it. The same bounds hold for the desktop rail
     (PW_VIEWPORT=1440x900), where the tabs are rows inside the rail. */
  const bar = await page.locator('.mnnav').boundingBox();
  expect(bar).not.toBeNull();
  for (let index = 0; index < 3; index += 1) {
    const box = await tabs().nth(index).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(80);
    expect(box!.x).toBeGreaterThanOrEqual(bar!.x - 1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(bar!.x + bar!.width + 1);
  }
});

test('Access carries the grant surface honestly, and the keys row is real', async () => {
  await tabs().nth(1).click();
  await expect(tabs().nth(1)).toHaveAttribute('aria-current', 'page');

  await expect(page.getByRole('heading', { name: 'Access', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Connections', level: 2 })).toBeVisible();

  /* NO INVENTED TENANTS. Until the scoped-grant primitives exist on-chain the
     truthful content of Connections is the empty state saying what will
     appear, not a mocked app pretending a grant is held. */
  await expect(page.getByText('Nothing may act for you yet.')).toBeVisible();

  /* The keys row is the part of this screen that is real today, and with a
     session open it names the passkey and opens the backup surface. */
  const keys = page.getByRole('button', { name: /Keys/ });
  await expect(keys).toBeVisible();
  await expect(keys).toBeEnabled();
  await expect(keys).toContainText('The passkey on this device');
});

test('no raw colour, address, or fee token reaches any of the three sections', async () => {
  /* The one thing that must never reach a card: a colour is 64 characters and
     identifies nothing to a reader (2026/08/26); an address is the engine's,
     and the engine is invisible; DUST is the fee's business and the fees are
     the sponsor's. Swept across all three tabs in one pass. The old shelf's
     wider vocabulary sweep (wallet/contract/registry…) retired with the
     shelf: Access now says "contract" ON PURPOSE — the grant is enforced by
     the contract, not by the app's manners, and saying so is the point. */
  const sweeps: { tab: number; root: string }[] = [
    { tab: 0, root: '.mnhome-screen' },
    { tab: 1, root: '.mnaccess-screen' },
    { tab: 2, root: '.mnstamps-screen' },
  ];
  for (const sweep of sweeps) {
    await tabs().nth(sweep.tab).click();
    const text = await page.locator(sweep.root).innerText();
    expect(text, `${sweep.root} leaks a raw colour`).not.toMatch(/\b[0-9a-f]{32,}\b/);
    expect(text, `${sweep.root} leaks an address`).not.toContain('mn_addr');
    expect(text, `${sweep.root} leaks an address`).not.toContain('mn_shield-addr');
    expect(text).not.toContain(PASSPORT_ACCOUNT_ADDRESS);
    expect(text, `${sweep.root} names the fee token`).not.toMatch(/\bDUST\b/);
  }
});

test('the three sections really switch, and none is a dead end', async () => {
  await tabs().nth(2).click();
  await expect(page.getByRole('heading', { name: 'Stamps', level: 1 })).toBeVisible();
  await expect(page.locator('.mnhome-activity')).toBeVisible();
  await expect(page.locator('.mnaccess-screen')).toHaveCount(0);

  await tabs().nth(0).click();
  await expect(page.locator('.mnpcard')).toBeVisible();

  /* Back to Access, and the surface is rendered again rather than left behind
     by whichever tab was drawn first. */
  await tabs().nth(1).click();
  await expect(page.getByRole('heading', { name: 'Connections', level: 2 })).toBeVisible();
});

test('an item is not left among the balances in the Pocket', async () => {
  /* The split rule, seen from the only money surface left — the Pocket: the
     list carries the account's three balances — NIGHT, the sponsor's colour
     at a real zero, and the recorded stablecoin at 100 — and nothing filed as
     an item. With no item in the recorded account the count is the whole
     assertion: it is what would change the day a single-supply colour arrives
     and the list failed to hand it over to the Pocket's shelf (P4). */
  await tabs().nth(0).click();
  await page.getByRole('button', { name: /^Pocket$/ }).click();
  const strip = page.locator('.mnpocket-coins');
  await expect(strip).toBeVisible();
  await expect(strip.locator('.mnpocket-coin')).toHaveCount(3);

  /* Two rows that would both have read "mUSD" over different money is exactly
     the collision `describeColours` qualifies, and this tier is really in
     that configuration: the mocked sponsor names a DIFFERENT colour than the
     recorded account holds. Each row carries four characters of its own
     colour — the four are the qualifier, not a leak, and the sweep above
     bounds them. */
  const stripText = (await strip.locator('.mnpocket-coin').allInnerTexts()).join(' ');
  expect(stripText.match(/MUSD · [0-9A-F]{4}…/gi) ?? []).toHaveLength(2);

  /* And the retired shelf really is retired — nothing mounts it. */
  const shelf = await page.evaluate(() => document.querySelectorAll('.mnassets-card').length);
  expect(shelf).toBe(0);
  await page.keyboard.press('Escape');
});
