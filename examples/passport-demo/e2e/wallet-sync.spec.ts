/**
 * WHAT IS LEFT RUNNING BEHIND A HOME (2026/09/27).
 *
 * A Passport on the account custody contract keeps its money in the account:
 * its figures are the account's state and its list of deliveries, its fees
 * are paid for it, and its circuits are proved by the proving service. The
 * wallet behind it has nothing to follow the chain for, and it used to follow
 * it anyway — two wallets, three indexer subscriptions each, for minutes after
 * every sign-up — while Home painted "Syncing · N%" over a Passport that could
 * already send. See "A wallet that does not walk the chain at all" in
 * `src/lib/localWallet.ts`.
 *
 * A prototype Passport is the other half of the rule: its wallet holds money
 * its own flows spend, so on the very same build it walks exactly as before.
 *
 * WHAT A SOCKET TELLS US HERE. The network boundary accepts every WebSocket and
 * never answers it, so no walk in this tier ever applies a block — but a walk
 * that STARTS opens its subscriptions to the indexer at once, and that is what
 * both tests read: the URL of every socket the page opens after the reload.
 */

import { expect, test, type Page } from '@playwright/test';

import { CUSTODY_WALK, custodyPassportOnHome, homeGreeting } from './custodyWalk.js';
import { PASSPORT_ACCOUNT_ADDRESS, installNetworkBoundary } from './mocks.js';
import { installVirtualAuthenticator } from './passkey.js';
import { SIGN_IN_BUTTON, walkContextOptions } from './walkContext.js';

/** A socket the wallet SDK opens to follow the chain: its indexer subscriptions. */
const CHAIN_SUBSCRIPTION = /indexer\.stagenet\.shielded\.tools/;

/**
 * Every WebSocket the page opens from here on, by URL, answered as the network
 * boundary answers them: accepted, and never spoken to. Registered after
 * `installNetworkBoundary`, so it is this route that handles them.
 */
async function recordSockets(page: Page): Promise<string[]> {
  const opened: string[] = [];
  await page.routeWebSocket(/.*/, (socket) => {
    opened.push(socket.url());
  });
  return opened;
}

test('a custody Passport opens no chain subscription and shows no sync strip', async ({
  browser,
}) => {
  const { page, close } = await custodyPassportOnHome(browser);
  try {
    /* A reload is how a Passport opens right after its setup, and it opens
       both wallets again: the passkey's own, on the silent restore, and the
       one every custody call is made on, on the first read of the account. */
    const sockets = await recordSockets(page);
    await page.reload();
    await expect(homeGreeting(page)).toBeVisible({ timeout: 60_000 });
    /* The account has been read, and then a while longer: the walk this
       replaces subscribed within a second of each wallet opening. */
    await expect(page.locator('.mnhome-token-row', { hasText: 'mUSD' })).toContainText('250');
    await page.waitForTimeout(5_000);

    expect(
      sockets.filter((url) => CHAIN_SUBSCRIPTION.test(url)),
      'a custody Home subscribed to the chain',
    ).toEqual([]);
    /* The recorder is live: the connection to the node a payment is handed to
       is still opened, because a payment still needs it. */
    expect(sockets.some((url) => !CHAIN_SUBSCRIPTION.test(url))).toBe(true);
    await expect(page.locator('.mnhome-syncstrip')).toHaveCount(0);
    await expect(page.getByRole('progressbar', { name: /sync/i })).toHaveCount(0);
    await expect(page.getByText(/Syncing ·/)).toHaveCount(0);
  } finally {
    await close();
  }
});

test('a prototype Passport on the same build still walks the chain it spends from', async ({
  browser,
}) => {
  const context = await browser.newContext(
    walkContextOptions({ viewport: { width: 420, height: 900 } }),
  );
  const page = await context.newPage();
  await installNetworkBoundary(page);
  const authenticator = await installVirtualAuthenticator(context, page);
  try {
    await page.goto(CUSTODY_WALK);
    await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
    await expect(page.getByRole('heading', { name: /Welcome to\s*Passport/ })).toBeVisible({
      timeout: 60_000,
    });
    /* A prototype account for this credential, as a previous build left it. The
       prototype record wins the route, whatever else is stored. */
    const seeded = await page.evaluate((address) => {
      const credentialId = localStorage.getItem('passport-last-passkey');
      if (!credentialId) return null;
      const now = new Date().toISOString();
      localStorage.setItem(
        'passport-alias:v1',
        JSON.stringify({
          stagenet: {
            alias: 'walker',
            domain: 'walker.night',
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
    }, PASSPORT_ACCOUNT_ADDRESS);
    expect(seeded).not.toBeNull();

    const sockets = await recordSockets(page);
    await page.goto(CUSTODY_WALK);
    await expect(page.getByRole('button', { name: /^Send$/ }).first()).toBeVisible({
      timeout: 90_000,
    });
    /* The prototype Home, not the custody one: no custody setup on offer. */
    await expect(page.getByRole('button', { name: 'Create my Passport' })).toHaveCount(0);
    /* Its wallet's three component walks — shielded, unshielded, and DUST —
       each subscribe to the indexer, as they always have. */
    await expect
      .poll(() => sockets.filter((url) => CHAIN_SUBSCRIPTION.test(url)).length, {
        timeout: 30_000,
      })
      .toBeGreaterThanOrEqual(3);
  } finally {
    await authenticator.remove();
    await context.close();
  }
});
