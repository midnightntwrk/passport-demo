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

import { installNetworkBoundary, PASSPORT_ACCOUNT_ADDRESS, RESOLVABLE_NAME } from './mocks.js';
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

test('an unguarded Passport is nagged, honestly, and the ladder leads somewhere real', async () => {
  /* THE GUARD METER. This walk's Passport has a name and an account but no
     backup and no recovery key, so it is unguarded — and the page must say
     so in three registers at once: the card's chip, the meter's level, and
     where the two real acts lead. */
  await tabs().nth(0).click();
  const meter = page.locator('.mnguard');
  await expect(meter).toBeVisible();
  await expect(meter).toContainText('1 of 3');
  await expect(meter).toContainText('Not valid until guarded');
  await expect(page.locator('.mnpcard')).toContainText('NOT VALID UNTIL GUARDED');

  // The one act on the second rung opens the real backup surface, and comes back.
  await meter.getByRole('button', { name: 'Keep a backup' }).click();
  await expect(page.getByRole('heading', { name: 'Where your Passport lives' })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.mnpcard')).toBeVisible();

  /* The third rung is REAL since P3 — its act opens the Keys page. This
     headless browser injects no wallet, and the recovery panel must say
     exactly that in prose rather than offer a connect button for an act the
     browser cannot perform. */
  await meter.getByRole('button', { name: 'Add one' }).click();
  await expect(page.getByRole('heading', { name: 'Keys', level: 1 })).toBeVisible();
  await expect(page.getByText('The recovery key')).toBeVisible();
  await expect(page.getByText(/No wallet extension was found in this browser/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect MetaMask' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.mnpcard')).toBeVisible();
});

test('a stubbed wallet drives sign-to-derive to the confirm beat, and cancel touches nothing', async () => {
  /* `personal_sign` is deterministic (RFC 6979), so a fixed signature IS a
     faithful wallet for everything after the signature — which is exactly
     the part this app owns: the derivation, and the CONFIRM beat that names
     what would go on chain before anything does. The submit itself is the
     live tier's to prove (stagenet.live.spec.ts); here the beat is reached,
     read, and CANCELLED, and cancelling must leave no record anywhere. */
  await page.addInitScript(() => {
    (window as unknown as { ethereum: unknown }).ethereum = {
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_requestAccounts') return ['0xc0ffee0000000000000000000000000000005a5a'];
        if (method === 'personal_sign') return `0x${'42'.repeat(65)}`;
        throw new Error(`unexpected wallet call: ${method}`);
      },
    };
  });
  await page.reload();
  await expect(page.locator('.mnpcard')).toBeVisible({ timeout: 90_000 });

  await tabs().nth(1).click();
  await page.getByRole('button', { name: /Keys/ }).click();
  /* Offered now — the stub is a wallet, the session restores, the account is
     seeded. Waited on with a retrying assertion because the session restore
     is what arms it. */
  const connect = page.getByRole('button', { name: 'Connect MetaMask' });
  await expect(connect).toBeVisible({ timeout: 90_000 });
  await connect.click();

  /* The confirm beat: the signer is named, the commitment is named as the
     ONLY thing that goes public, and nothing has been submitted. */
  await expect(page.getByText(/0xc0ff…5a5a/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/puts ONLY its public commitment/)).toBeVisible();
  const confirm = page.getByRole('button', { name: 'Add to your account' });
  await expect(confirm).toBeVisible();

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(connect).toBeVisible();
  const record = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.startsWith('mn-passport:recovery-key:')),
  );
  expect(record).toEqual([]);
  await page.getByRole('button', { name: 'Done' }).click();
});

test('a pasted join code reaches the confirm beat only for THIS Passport', async () => {
  /* The ADMIT half of the add-device handoff (P3). The seeded account IS the
     account `iamtester.night` really resolves to in the recorded registry, so
     the whole checking beat — the registry's answer compared against the open
     account — runs here against real recordings, offline. The submit itself
     is the live tier's to prove; what this walk holds still is the gate in
     front of it: no code reaches CONFIRM unless the registry says it was
     drawn for THIS Passport, and cancelling leaves no record anywhere. */
  const commitment = 'ab12'.repeat(16);
  const codeFor = (name: string, network: string) =>
    `midnight:add_device?v=1&name=${name}&network=${network}&commitment=${commitment}`;
  await tabs().nth(1).click();
  await page.getByRole('button', { name: /Keys/ }).click();
  await expect(page.getByRole('heading', { name: 'Keys', level: 1 })).toBeVisible();
  await expect(page.getByText('Another device')).toBeVisible();

  const paste = page.getByLabel('Paste a join code');
  const readIt = page.getByRole('button', { name: 'Read it' });

  // Garbage is refused in words, before any machinery runs.
  await paste.fill('hello world');
  await readIt.click();
  await expect(page.getByText(/not a Passport code/)).toBeVisible();

  // A payment code is a real Passport code and still not a join code.
  await paste.fill(`midnight:${RESOLVABLE_NAME}.night`);
  await readIt.click();
  await expect(page.getByText(/payment code, not a join code/)).toBeVisible();

  // A code drawn for another network is refused naming the mismatch.
  await paste.fill(codeFor(`${RESOLVABLE_NAME}.night`, 'preview'));
  await readIt.click();
  await expect(page.getByText(/drawn for preview/)).toBeVisible();

  // A code for a name nobody holds is refused with the registry's answer.
  await paste.fill(codeFor('nobodyatall.night', 'stagenet'));
  await readIt.click();
  await expect(page.getByText(/nobody holds that name/i)).toBeVisible({ timeout: 30_000 });

  /* The real thing reaches CONFIRM: the Passport is named, the commitment
     tail is named as the ONLY thing going on chain, and the admitted
     device's full power is said out loud rather than softened. */
  await paste.fill(codeFor(`${RESOLVABLE_NAME}.night`, 'stagenet'));
  await readIt.click();
  await expect(page.getByText(/asks to join/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(new RegExp(`…${commitment.slice(-6)}`))).toBeVisible();
  await expect(page.getByText(/spend, grant, and admit more devices/)).toBeVisible();

  // Cancel: back to the reader, nothing enrolled, nothing remembered.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Scan a join code' })).toBeVisible();
  const records = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.startsWith('mn-passport:second-device:')),
  );
  expect(records).toEqual([]);
  // Done returns to the tab the Keys page was entered from — Access.
  await page.getByRole('button', { name: 'Done' }).click();
  await tabs().nth(0).click();
  await expect(page.locator('.mnpcard')).toBeVisible();
});

test('the way out is on every tab', async () => {
  /* Sign out lived only in Home's bar after the P1 cut, so a person reading
     Stamps had no way to leave without first finding their way back
     (reported 2026/09/06). The control is part of every tab's bar now, and
     this walk is what keeps it there. */
  for (const tab of [0, 1, 2]) {
    await tabs().nth(tab).click();
    await expect(
      page.getByRole('button', { name: 'Sign out of this Passport' }),
    ).toBeVisible();
  }
  await tabs().nth(0).click();
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

test('this device can forget its Passport, and onboarding starts over', async () => {
  /* LAST IN THE FILE ON PURPOSE — it destroys the walk's state. The forget
     control is the demo-replay and recovery-rehearsal substrate: two
     presses, then the landing screen exactly as a clean browser shows it,
     with not one Passport key left behind. The theme and the selected
     network survive — device preferences, not identity. The passkey survives too (the platform
     keychain is not the app's to clear), which is why the landing screen is
     what is asserted rather than anything about credentials. */
  /* The route is the product's own: Access → Keys (the sub-page since P3) →
     the backup surface, where the danger zone lives. */
  await tabs().nth(1).click();
  await page.getByRole('button', { name: /Keys/ }).click();
  await expect(page.getByRole('heading', { name: 'Keys', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Back up or restore' }).click();
  await expect(page.getByRole('heading', { name: 'Where your Passport lives' })).toBeVisible();

  // Two presses: arm, then act. One press must not be enough.
  await page.getByRole('button', { name: 'Forget this device' }).click();
  const doIt = page.getByRole('button', { name: 'Forget everything on this device' });
  await expect(doIt).toBeVisible();
  await doIt.click();

  await expect(page.getByRole('button', { name: /Continue with Passport/i })).toBeVisible({
    timeout: 30_000,
  });

  const leftovers = await page.evaluate(() =>
    Object.keys(localStorage).filter(
      (key) =>
        key !== 'passport-theme' &&
        key !== 'passport-network' &&
        (key.startsWith('passport-') ||
          key.startsWith('passkey:') ||
          key.startsWith('mn-passport:') ||
          key.startsWith('midnight.passport.')),
    ),
  );
  expect(leftovers).toEqual([]);
});
