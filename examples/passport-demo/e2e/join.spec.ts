/**
 * Tier 1 — the JOIN half of the add-device handoff, in a real browser with no
 * chain.
 *
 * This is the journey the welcome screen's second control opens: a fresh
 * device holds a fresh passkey, and instead of naming a new Passport it asks
 * to be admitted to one that already exists. What this tier can hold still,
 * against the same recorded registry the other mocked specs read:
 *
 *   - the fork on the welcome screen leads somewhere real, and the join
 *     screen's lookup runs a REAL resolution — `iamtester.night` resolves
 *     through the recorded TLD and leaf to a real account whose ledger
 *     decodes, device count included;
 *   - the one ceremony derives a commitment and draws a code in the agreed
 *     vocabulary (`lib/qrPayload.ts`), shown as a QR AND as copyable text;
 *   - the watch line reports the truth: the recorded account does not hold
 *     this device, and the screen says so instead of pretending progress;
 *   - a reload lands BACK on the join screen — the stored intent is what
 *     stands between a half-made join and the name step, whose claim would
 *     deploy a second account;
 *   - and the exit is the other journey, named: choose a name instead.
 *
 * What it cannot do: be admitted. `add_device` is a proved transaction on the
 * OTHER device; the two-context handoff end-to-end is the live tier's to
 * prove (`stagenet.live.spec.ts`).
 */

import { expect, test, type Page } from '@playwright/test';

import { installNetworkBoundary, PASSPORT_ACCOUNT_ADDRESS, RESOLVABLE_NAME } from './mocks.js';
import { installVirtualAuthenticator } from './passkey.js';
import { specViewport } from './viewport.js';

test.describe.configure({ mode: 'serial' });

let page: Page;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: specViewport({ width: 420, height: 900 }) });
  page = await context.newPage();
  await installNetworkBoundary(page);
  await installVirtualAuthenticator(context, page);
});

test.afterAll(async () => {
  await page.context().close();
});

test('the welcome screen forks, and the join lookup answers with the registry', async () => {
  await page.goto('/');
  await page.getByRole('button', { name: /Continue with Passport/i }).click();
  await expect(page.getByRole('heading', { name: /Welcome to Passport/i })).toBeVisible({
    timeout: 90_000,
  });

  await page.getByRole('button', { name: 'Add this device to a Passport that already exists' }).click();
  await expect(page.getByRole('heading', { name: 'Which Passport?' })).toBeVisible();

  const field = page.getByLabel('Your Midnight name');
  const find = page.getByRole('button', { name: 'Find my Passport' });

  // A label the registry could never hold is refused before any network runs.
  await field.fill('not a name!');
  await find.click();
  await expect(page.getByText(/letters, numbers, or hyphens/)).toBeVisible();

  // A free name gets the registry's own answer: nobody holds it.
  await field.fill('joinwalkfree');
  await find.click();
  await expect(page.getByText(/Nobody holds joinwalkfree\.night/)).toBeVisible({
    timeout: 30_000,
  });

  /* The real one: the recorded leaf points at a real account, whose ledger is
     read for the device count — so FOUND states facts, not hopes. */
  await field.fill(RESOLVABLE_NAME);
  await find.click();
  await expect(
    page.getByRole('heading', { name: `${RESOLVABLE_NAME}.night` }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/holds \d+ keys? today/)).toBeVisible();
});

test('one ceremony draws the code, and the watch line tells the truth', async () => {
  await page.getByRole('button', { name: 'Make this device’s key' }).click();

  /* The ceremony is the virtual authenticator's, for real; the code is the
     vocabulary of `lib/qrPayload.ts`, drawn as a QR and as text. */
  await expect(
    page.getByRole('heading', { name: 'Show this to your other device' }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.mnjoin-qr')).toBeVisible();
  const code = await page.locator('.mnjoin-code').innerText();
  expect(code).toMatch(
    new RegExp(
      `^midnight:add_device\\?v=1&name=${RESOLVABLE_NAME}\\.night&network=stagenet&commitment=[0-9a-f]{64}$`,
    ),
  );

  /* The watcher reads the recorded account and reports what it finds: this
     device is NOT on it. A screen that said anything warmer would be lying —
     nothing has admitted us and nothing can, offline. */
  await expect(page.getByText(/the other device has not admitted this one yet/)).toBeVisible({
    timeout: 30_000,
  });
});

test('a reload lands back on the join, never on the name step', async () => {
  /* THE GUARD THIS FLOW EXISTS FOR. A half-made join falling through to
     "choose your name" would end with a SECOND account deployed for a person
     who already has one. The stored intent re-raises the join screen, at the
     stage it reached, with the same code — no ceremony repeated. */
  const before = await page.locator('.mnjoin-code').innerText();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Show this to your other device' }),
  ).toBeVisible({ timeout: 90_000 });
  expect(await page.locator('.mnjoin-code').innerText()).toBe(before);
});

test('the exit is the other journey, and it clears the intent', async () => {
  await page.getByRole('button', { name: /Start fresh instead/ }).click();
  await expect(page.getByText(/Choose your .night name/i)).toBeVisible({ timeout: 30_000 });

  const intents = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.startsWith('mn-passport:join-intent:')),
  );
  expect(intents).toEqual([]);

  /* And no record claims this device holds anything: the join never landed,
     so nothing anywhere may say it did. */
  const stores = await page.evaluate(() => ({
    contracts: localStorage.getItem('passport-contract:v1'),
    aliases: localStorage.getItem('passport-alias:v1'),
    pairs: Object.keys(localStorage).filter((key) =>
      key.startsWith('mn-passport:second-device:'),
    ),
  }));
  expect(stores.contracts ?? '').not.toContain(PASSPORT_ACCOUNT_ADDRESS);
  expect(stores.aliases ?? '').not.toContain(RESOLVABLE_NAME);
  expect(stores.pairs).toEqual([]);
});
