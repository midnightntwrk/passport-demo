/**
 * THE DYNAMIC-ONLY PASSPORT, walked — the welcome path, with no passkey in it.
 *
 * WHAT IS REAL IN THIS RUN
 * ------------------------
 * The build under test is the shipped production bundle, served by `vite
 * preview`, with the network boundary of `mocks.ts` around it. What is replaced
 * is the VENDOR and nothing else: `src/lib/dynamicWalk.ts` publishes a
 * signed-in session into the same module-level store Dynamic's own bridge
 * writes to, with a real secp256k1 signer behind `signRaw`. Everything from
 * that point on — which identity the app chooses, which screen it renders, what
 * the copy says, what happens when the setup is asked for — is the shipped code
 * running against the shipped decisions.
 *
 * WHY THE VENDOR HAS TO BE REPLACED, WHICH IS NOT A CONVENIENCE
 * -------------------------------------------------------------
 * Dynamic's sign-in is a cross-origin overlay served by `app.dynamicauth.com`,
 * and its `settings`, `sdkSettings`, and `nonce` calls are refused by CORS from
 * any origin the dashboard does not list. Playwright's preview origin
 * (`http://localhost:4173`) is not one, and the MPC rounds that make a signature
 * run inside an iframe nothing on our side can drive. A spec that tried to walk
 * the real overlay would be a spec graded on whether a third party was up.
 *
 * WHERE THIS WALK STOPS, AND WHY THAT IS THE HONEST PLACE
 * -------------------------------------------------------
 * Setting one of these Passports up needs two things this build does not have:
 * the `account-custody` artefacts staged under `/zk`, and `POST /prove-account-custody` on the
 * balancer, which is not deployed (probed 2026/09/16: `404`). So the walk
 * asserts the path up to the first of those and then asserts the thing that
 * matters most about a service that is not there — that the refusal is ONE
 * plain sentence and the control comes back, rather than a spinner that runs
 * until a ten-minute proof timeout. That is the defect this assertion exists to
 * catch, and it is a defect a live run would meet today.
 *
 * WHAT IT DOES NOT TOUCH
 * ----------------------
 * No other spec passes `?dynamicwalk=`, so every other spec in this suite runs
 * against a build whose sign-in seam reports `disabled` — which is what it
 * reported before this file existed, and what every deployed build reports.
 */

import { expect, test } from '@playwright/test';

import { installNetworkBoundary } from './mocks.js';
import { walkContextOptions } from './walkContext.js';

/** The URL that hands the app a stand-in sign-in. See `src/lib/dynamicWalk.ts`. */
const WALK = '/?dynamicwalk=1';

test.describe('a Passport held by a social sign-in', () => {
  test('welcomes a signed-in person with a Passport of their own, not a passkey', async ({
    browser,
  }) => {
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    await page.goto(WALK);

    /* The sign-in is what the screen is about, and it names the PROVIDER —
       never the vendor, whom the reader has never chosen. */
    await expect(page.getByText('Signed in with Google')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Set up\s*your Passport/ })).toBeVisible();

    /* The sentence this whole path exists to delete. Until 2026/09/16 a social
       sign-in ended here, on the welcome screen, being told to go and make a
       passkey. */
    await expect(page.getByText('Finish with your passkey above')).toHaveCount(0);

    /* One offer, and the two things that are true about it. */
    await expect(page.getByRole('button', { name: 'Create my Passport' })).toBeEnabled();
    await expect(
      page.getByText('Setting your Passport up is paid for on your behalf.'),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'I already have a Passport' }),
    ).toBeVisible();

    /* NONE OF THE WORDS A READER HAS NO USE FOR. The rule this demo keeps
       everywhere, asserted rather than trusted, because a developer-shaped
       path is where it slips first. */
    const body = (await page.locator('body').innerText()).toLowerCase();
    /* `wallet address` and `sdk` are on the list because the vocabulary audit
       put them there and this screen's own header promises them. They are
       asserted as the two-word phrase and the acronym respectively: "wallet"
       alone is allowed — a Passport IS one — and it is the ADDRESS a reader
       has no use for. */
    for (const forbidden of [
      'contract',
      'registry',
      'indexer',
      'resolver',
      'sponsor',
      'dust',
      'wallet address',
      'sdk',
    ]) {
      expect(body, `"${forbidden}" is on screen`).not.toContain(forbidden);
    }

    await context.close();
  });

  test('offers coming back by name, and says a name alone is not enough', async ({ browser }) => {
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    await page.goto(WALK);

    await page.getByRole('button', { name: 'I already have a Passport' }).click();

    await expect(page.getByRole('heading', { name: /Find it\s*by its name/ })).toBeVisible();
    /* The name is the QUESTION and the account is the answer — the sentence
       that stops somebody thinking a public name is a credential. */
    await expect(page.getByText('Knowing the name is not enough on its own.')).toBeVisible();
    /* And the check is described as being about the sign-in, not a passkey. */
    await expect(page.getByText(/your Google sign-in is part of it/)).toBeVisible();

    await expect(page.getByRole('button', { name: 'Find my Passport' })).toBeDisabled();
    await page.getByLabel('Your name').fill('alice');
    await expect(page.getByRole('button', { name: 'Find my Passport' })).toBeEnabled();

    await page.getByRole('button', { name: 'Go back' }).click();
    await expect(page.getByRole('button', { name: 'Create my Passport' })).toBeVisible();

    await context.close();
  });

  test('refuses in one sentence when the service that finishes setup is not there', async ({
    browser,
  }) => {
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    await page.goto(WALK);

    await page.getByRole('button', { name: 'Create my Passport' }).click();

    /* The count line, while it is working. Three steps, and the copy says so
       rather than leaving somebody watching an unlabelled spinner. */
    await expect(page.locator('p.mnob-hint[role="status"]')).toHaveText(
      'Setting up your Passport, step 1 of 3',
    );

    /* Then one sentence, and the control back. NOT a spinner that runs until a
       proof timeout ten minutes later, which is what an unreachable proving
       service gives by default — the reason `custodyProofProvider` refuses
       immediately, and the reason this assertion is here. */
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 60_000 });
    const sentence = (await alert.innerText()).trim();
    expect(sentence.split('\n').filter((line) => line.trim().length > 0)).toHaveLength(1);
    await expect(page.getByRole('button', { name: /my Passport/ })).toBeEnabled();

    await context.close();
  });
});
