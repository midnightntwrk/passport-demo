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
 * WHAT A SEEDED PASSPORT ADDS, AND WHERE ITS WALKS STOP
 * -----------------------------------------------------
 * The three walks at the foot of this file drive a Passport that already
 * exists: a finished setup, a name, and a coin store, written into
 * `localStorage` in exactly the shape the app's own modules persist them, and a
 * REAL account read back through recordings of the stagenet account deployed on
 * 2026/09/16. They cover the mUSD row, a mUSD payment, and a NIGHT payment to a
 * Passport of the same kind — the one that was refused as "not built yet" until
 * 2026/09/17.
 *
 * Neither payment can complete in a box, and the honest statement of why is
 * worth making: the account being driven is somebody else's, so its device set
 * holds the key the gate run enrolled rather than this walk's stand-in signer,
 * and the call is refused before it is proved. Two other walls stand behind
 * that one — `POST /prove-account-custody` is not deployed, and no release
 * bundle carries this build's ZK artefacts yet. So what these walks assert is
 * the property that holds whichever wall is met first: the payment is planned
 * in full, the refusal is ONE plain sentence, the control comes back, and the
 * Passport says where the money is. A completed payment is a live run's to
 * prove, and the live sequence is written down in
 * `docs/demo/account-custody-layer-design.md`.
 *
 * WHAT IT DOES NOT TOUCH
 * ----------------------
 * No other spec passes `?dynamicwalk=`, so every other spec in this suite runs
 * against a build whose sign-in seam reports `disabled` — which is what it
 * reported before this file existed, and what every deployed build reports.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { PASSPORT_ACCOUNT_ADDRESS, RESOLVABLE_NAME, installNetworkBoundary } from './mocks.js';
import { walkContextOptions } from './walkContext.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The URL that hands the app a stand-in sign-in. See `src/lib/dynamicWalk.ts`. */
const WALK = '/?dynamicwalk=1';

/**
 * THE REAL HOME, WHICH IS WHERE A FINISHED PASSPORT NOW LANDS.
 *
 * Until 2026/09/22 one of these Passports landed on a page of its own — a
 * name, one figure, "People can pay you at", and a three-field form — while
 * every prototype Passport got the product. These helpers name the product's
 * own furniture, so a walk that ended up back on the bare page would fail on
 * the first line rather than on a figure that happens to render either way.
 */
function greeting(page: Page) {
  return page.getByRole('heading', { name: /^Good (morning|afternoon|evening), walker$/ });
}

/** One asset row of the balance strip, by its ticker. */
function assetRow(page: Page, symbol: string) {
  return page.locator('.mnhome-token-row', { hasText: symbol });
}

/** Opens the Send sheet from Home's money row. */
async function openSend(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Send$/ }).first().click();
  await expect(page.locator('.mnhome-send')).toBeVisible();
}

/** The Send sheet's asset picker, its recipient field, and its amount. */
const sendPicker = (page: Page) => page.locator('.mnhome-send-asset');
const sendRecipient = (page: Page) => page.locator('.mnhome-send').getByRole('textbox').first();
const sendAmount = (page: Page) => page.locator('.mnhome-send-amount input');

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
    /* THE SAME WELCOME PAGE THE PASSKEY ROAD SHOWS, said to a person who
       signed in with Google. Before 2026/09/22 this arm opened on an offer —
       "Set up your Passport", one button — and was never told what a Passport
       is at all. */
    await expect(page.getByRole('heading', { name: /Welcome to\s*Passport/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Set up\s*your Passport/ })).toHaveCount(0);
    await expect(page.getByText('Fees are covered for you')).toBeVisible();

    /* The sentence this whole path exists to delete. Until 2026/09/16 a social
       sign-in ended here, on the welcome screen, being told to go and make a
       passkey. */
    await expect(page.getByText('Finish with your passkey above')).toHaveCount(0);

    /* One way on, and one way back in for somebody who is not new. */
    await expect(page.getByRole('button', { name: 'Choose my name' })).toBeEnabled();
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
    await expect(page.getByRole('button', { name: 'Choose my name' })).toBeVisible();

    await context.close();
  });

  test('asks for the name first, and makes the whole Passport on that one press', async ({
    browser,
  }) => {
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    await page.goto(WALK);

    await page.getByRole('button', { name: 'Choose my name' }).click();
    await expect(page.getByRole('heading', { name: /Choose\s*your \.night name/ })).toBeVisible();

    /* Nothing may be built over a name the registry has not answered for, and
       there is nothing on this step that walks past it — the name is part of
       making the Passport, not a decoration on one that exists. */
    await expect(page.getByRole('button', { name: 'Create my Passport' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Choose one later' })).toHaveCount(0);

    /* A name that is really taken, decoded by the shipped Midnames module from
       the stagenet `.night` TLD's own recorded state. */
    await page.getByLabel('Your name').fill(RESOLVABLE_NAME);
    await expect(page.getByText(`${RESOLVABLE_NAME}.night is already taken`)).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByRole('button', { name: 'Create my Passport' })).toBeDisabled();

    /* And one that is not. */
    await page.getByLabel('Your name').fill('alice');
    await expect(page.getByText('alice.night is available')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByRole('button', { name: 'Create my Passport' })).toBeEnabled();

    /* THE NAME IS WRITTEN DOWN BEFORE ANYTHING IS BUILT, which is what makes a
       reload halfway through a three-step setup come back to the name already
       chosen rather than to an empty field over an account that exists. */
    await page.getByRole('button', { name: 'Create my Passport' }).click();
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            window.localStorage.getItem('passport-account-custody-chosen-name:v1'),
          ),
        { timeout: 120_000 },
      )
      .toContain('alice');

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

    /* The welcome, the name, and then the one press that makes the whole
       thing — the order this flow has had since 2026/09/22. */
    await page.getByRole('button', { name: 'Choose my name' }).click();
    await page.getByLabel('Your name').fill('alice');
    await expect(page.getByRole('button', { name: 'Create my Passport' })).toBeEnabled({
      timeout: 120_000,
    });
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

/* -------------------------------------------------------------------------- */
/* A Passport that already exists, and already holds something                */
/* -------------------------------------------------------------------------- */

/**
 * The stand-in sign-in's own address, and the Passport seeded under it.
 *
 * Both halves are written EXACTLY as the app's own modules persist them —
 * `custodyRecordKey` and `custodyNameKey` in `src/identity/`, and
 * `k1AccountKey` in `src/identity/k1CoinStore.ts` — because that is the point
 * of seeding here rather than adding a back door to the build: what the walk
 * puts in storage is what a real run would have put there, and a change to
 * either format fails this spec rather than quietly rendering an empty
 * Passport.
 */
const WALK_USER = '0x00a329c0648769a73afac7f9381e08fb43dbea72';
const WALK_NETWORK = 'stagenet';

/** The demo stablecoin's colour, as `src/lib/colour.ts` knows it. */
const MUSD_COLOUR = '1a2917fbed8b5ce44d12ebc7d337689045f6c96a6bbd39cf3d8691ab310ef6a6';

/**
 * A recording of a REAL account on the account custody build — the one deployed
 * to stagenet on 2026/09/16 (`cbd6b1c1…`), read back through the indexer.
 *
 * It is served for the seeded Passport's own account AND for the account the
 * `.night` name resolves to, which makes both halves of these walks honest: the
 * screen decodes a genuine `enc_key` and a genuine list of deliveries with the
 * shipped module, and the recipient is genuinely a Passport of the same kind —
 * the case that used to be refused as "not built yet".
 */
const ACCOUNT_CUSTODY_STATE = fs.readFileSync(
  path.join(here, 'fixtures', 'stagenet-account-custody.json'),
  'utf8',
);

/**
 * The same account's deploy transaction and the state that deploy left.
 *
 * midnight-js asks for both before it will open a connection to a deployed
 * contract — it checks the verifier keys the chain holds against the ones this
 * build carries — so a walk that stops at "the service is not deployed" has to
 * get past them first. Recorded, like everything else here.
 */
const ACCOUNT_CUSTODY_DEPLOY_TX = fs.readFileSync(
  path.join(here, 'fixtures', 'stagenet-account-custody-deploy-tx.json'),
  'utf8',
);
const ACCOUNT_CUSTODY_DEPLOY_STATE = fs.readFileSync(
  path.join(here, 'fixtures', 'stagenet-account-custody-deploy-state.json'),
  'utf8',
);

/**
 * The account those three recordings are OF — a real one, deployed to stagenet
 * on 2026/09/16 with the account custody contract.
 *
 * The seeded Passport is that account, rather than a hand-made address, because
 * the deploy recording names it: midnight-js correlates the address it was
 * asked about against the addresses inside the transaction, and an invented
 * address would mean forging a recording to match. This way every byte the walk
 * feeds the client is a byte the chain produced.
 */
const ACCOUNT_CUSTODY_ADDRESS =
  'cbd6b1c14a99c1751caa80a5665f01cb8067a9758183bda5da581e4ef745d215';

/** Answers the account custody recordings for one address, ahead of the boundary. */
async function serveAccountCustodyState(page: Page, addresses: readonly string[]): Promise<void> {
  const wanted = new Set(addresses.map((address) => address.toLowerCase()));
  await page.route('**/indexer.stagenet.shielded.tools/**', async (route) => {
    const body = route.request().postData() ?? '';
    const asked = (/"address":"([0-9a-fA-F]+)"/.exec(body)?.[1] ?? '').toLowerCase();
    if (!wanted.has(asked)) return route.fallback();
    if (body.includes('DEPLOY_CONTRACT_STATE_TX_QUERY')) {
      return route.fulfill({ contentType: 'application/json', body: ACCOUNT_CUSTODY_DEPLOY_STATE });
    }
    if (body.includes('DEPLOY_TX_QUERY')) {
      return route.fulfill({ contentType: 'application/json', body: ACCOUNT_CUSTODY_DEPLOY_TX });
    }
    if (body.includes('CONTRACT_STATE_QUERY')) {
      return route.fulfill({ contentType: 'application/json', body: ACCOUNT_CUSTODY_STATE });
    }
    /* Everything else is the boundary's, unchanged. */
    return route.fallback();
  });
}

/**
 * Seeds a finished Passport, its name, and its coin store, before the app runs.
 *
 * `addInitScript` rather than an `evaluate` after `goto`: the screen reads all
 * three on its first render, and a Passport seeded afterwards would be a
 * Passport the walk had to reload to see.
 */
async function seedDynamicPassport(
  page: Page,
  options: {
    name: string;
    accountAddress: string;
    musd: string;
    /**
     * The coin this Passport's mUSD row is drawn from, where the walk wants a
     * state a SPEND has already left behind rather than a delivery: the change
     * coin's own nonce, and the nonce of the coin it replaced recorded as
     * spent. Written the way `k1CoinStore.ts` writes it, because the point of
     * the walk is that the shipped reader reads it.
     */
    coin?: { nonceHex: string; mtIndex: string };
    spentNonces?: readonly string[];
    /** A shielded payment that stopped between its legs, as it is persisted. */
    stoppedSend?: Record<string, unknown>;
  },
): Promise<void> {
  const key = `${WALK_USER}|${WALK_NETWORK}`;
  const record = {
    user: WALK_USER,
    network: WALK_NETWORK,
    address: options.accountAddress,
    privateStateId: `passport-account-custody-${WALK_USER.slice(2, 10)}`,
    saltHex: '',
    pkXHex: null,
    pkYHex: null,
    wavesDone: 3,
    totalWaves: 3,
    activated: true,
    txHashes: [],
  };
  const store = {
    [`${WALK_NETWORK}::${options.accountAddress}`]: {
      /* A viewing secret this Passport holds and the recorded account's own
         deliveries were NOT sealed to, which is the honest state of a seeded
         walk: the list is walked, nothing in it opens, and the store's own coin
         is what the row is drawn from. */
      encSecretKeyHex: 'ab'.repeat(32),
      coins: {
        [MUSD_COLOUR]: {
          nonceHex: options.coin?.nonceHex ?? 'cd'.repeat(32),
          colorHex: MUSD_COLOUR,
          value: options.musd,
          mtIndex: options.coin?.mtIndex ?? '12',
        },
      },
      queued: {},
      spentNonces: options.spentNonces ?? [],
      mtIndexCandidates: {},
      awaiting: {},
    },
  };
  const sends =
    options.stoppedSend === undefined
      ? null
      : { [`${WALK_NETWORK}::${options.accountAddress}`]: options.stoppedSend };
  await page.addInitScript(
    ([recordKey, seededRecord, seededName, seededStore, seededSends]) => {
      window.localStorage.setItem(
        'passport-account-custody:v1',
        JSON.stringify({ [recordKey as string]: seededRecord }),
      );
      window.localStorage.setItem(
        'passport-account-custody-name:v1',
        JSON.stringify({ [recordKey as string]: seededName }),
      );
      window.localStorage.setItem('passport-k1-coins:v1', JSON.stringify(seededStore));
      if (seededSends !== null) {
        window.localStorage.setItem(
          'passport-account-custody-shielded-send:v1',
          JSON.stringify(seededSends),
        );
      }
    },
    [key, record, options.name, store, sends] as const,
  );
}

/**
 * A shielded payment that stopped, as `custodyContractSend.ts` persists one.
 *
 * Written out here rather than imported: the walk's whole point is that the
 * SHIPPED reader reads what a previous session left in `localStorage`, and a
 * record built by the module under test would agree with itself whatever the
 * stored shape had become.
 */
function stoppedSendRow(stage: string): Record<string, unknown> {
  return {
    network: WALK_NETWORK,
    accountAddress: ACCOUNT_CUSTODY_ADDRESS,
    stage,
    colourHex: MUSD_COLOUR,
    amount: '10',
    recipientLabel: `${RESOLVABLE_NAME}.night`,
    recipientAccountAddress: PASSPORT_ACCOUNT_ADDRESS,
    sendTxId: 'ab'.repeat(32),
    startedAt: 1_789_600_000_000,
  };
}

test.describe('a Passport that has been paid', () => {
  test('lands on the real Home, with everything a Passport has', async ({ browser }) => {
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    await serveAccountCustodyState(page, [ACCOUNT_CUSTODY_ADDRESS, PASSPORT_ACCOUNT_ADDRESS]);
    await seedDynamicPassport(page, {
      name: 'walker',
      accountAddress: ACCOUNT_CUSTODY_ADDRESS,
      musd: '40',
    });
    await page.goto(WALK);

    /* THE DEFECT THIS WALK IS ABOUT (2026/09/22). This Passport used to land on
       a page of its own — a big name, one figure, "People can pay you at", and
       a send form — while every other Passport got the product. It gets the
       product now, and each line below is one of the things that page did not
       have. */
    await expect(greeting(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('People can pay you at')).toHaveCount(0);

    /* The money row. */
    await expect(page.getByRole('button', { name: /^Send$/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Receive$/ })).toBeVisible();

    /* The asset rows — the account's own NIGHT, and what the store says it has
       been paid. */
    /* The account's own NIGHT, off its unshielded mirror. A real zero here —
       this recorded account holds none — and a zero is what the row must show
       rather than "Syncing" or a blank. */
    await expect(assetRow(page, 'NIGHT')).toContainText('native token');
    await expect(assetRow(page, 'mUSD')).toContainText('40');

    /* The name card, and the line under it. */
    await expect(page.getByText('Your name on Stagenet')).toBeVisible();
    await expect(page.getByText('Registered on Stagenet')).toBeVisible();
    await expect(page.locator('.mnid-alias')).toHaveText('walker.night');
    await expect(page.getByText('Your account is ready')).toBeVisible();

    /* Everything down the page that a Passport has — and the two things that
       are deliberately NOT on it, because neither applies to a Passport on this
       contract: a back-up file that would restore none of its state, and the
       developer panel whose own sentence ("nothing in your Passport is held by
       this key") is false here. */
    await expect(page.getByRole('button', { name: 'Back up or restore' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sign a test message' })).toHaveCount(0);
    await expect(page.getByText('Ethereum address')).toHaveCount(0);
    await expect(page.locator('.mnhome-activity')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Home$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Assets$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Apps$/ })).toBeVisible();

    /* THE TRAIL, WRITTEN AS THE SCREEN LEARNS EACH THING IS TRUE. Before this
       a Passport of this kind had an empty history for ever: every one of these
       happened and nothing wrote any of it down. */
    const trail = page.locator('.mnhome-activity');
    for (const row of [
      'Passport created',
      'Your account is set up',
      'Your name is registered',
      'Stablecoin deposited',
    ]) {
      await expect(trail).toContainText(row, { timeout: 30_000 });
    }
    /* AND NOT A ROW FOR MONEY THAT NEVER ARRIVED. This recorded account holds
       no NIGHT, so "Opening balance deposited" is not owed and is not written
       — which is the rule that keeps the trail from narrating a deposit that
       did not happen. */
    await expect(trail).not.toContainText('Opening balance deposited');

    /* The copy rule, over everything this screen says about money and identity.
       The apps grid is left out on purpose: it renders a third-party registry's
       own words, which are not this repository's to hold to. */
    const said = (
      await Promise.all(
        ['.mnhome-identity', '.mnhome-assets', '.mnid-card', '.mnhome-activity'].map(
          async (selector) => (await page.locator(selector).allInnerTexts()).join(' '),
        ),
      )
    )
      .join(' ')
      .toLowerCase();
    for (const forbidden of [
      'contract',
      'registry',
      'indexer',
      'resolver',
      'sponsor',
      'dust',
      'wallet address',
      'sdk',
      'dynamic',
    ]) {
      expect(said, `"${forbidden}" is on screen`).not.toContain(forbidden);
    }
    expect(said).not.toContain('not built yet');

    await context.close();
  });

  test('carries the same figures onto the Assets shelf', async ({ browser }) => {
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    await serveAccountCustodyState(page, [ACCOUNT_CUSTODY_ADDRESS, PASSPORT_ACCOUNT_ADDRESS]);
    await seedDynamicPassport(page, {
      name: 'walker',
      accountAddress: ACCOUNT_CUSTODY_ADDRESS,
      musd: '40',
    });
    await page.goto(WALK);
    await expect(greeting(page)).toBeVisible({ timeout: 60_000 });

    /* THE BOTTOM BAR REALLY MOVES, and the shelf is fed the same snapshot the
       strip above reads — so the two tabs cannot disagree about what this
       Passport holds. */
    await page.getByRole('button', { name: /^Assets$/ }).click();
    await expect(page.locator('.mnassets-table')).toContainText('40', { timeout: 30_000 });

    await page.getByRole('button', { name: /^Home$/ }).click();
    await expect(greeting(page)).toBeVisible();

    await context.close();
  });

  test('sends mUSD to a Passport of the same kind, and stops where every payment stops', async ({
    browser,
  }) => {
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    await serveAccountCustodyState(page, [ACCOUNT_CUSTODY_ADDRESS, PASSPORT_ACCOUNT_ADDRESS]);
    await seedDynamicPassport(page, {
      name: 'walker',
      accountAddress: ACCOUNT_CUSTODY_ADDRESS,
      musd: '40',
    });
    await page.goto(WALK);
    await expect(greeting(page)).toBeVisible({ timeout: 60_000 });

    await openSend(page);
    /* WHAT THIS PAYMENT WILL PUBLISH, said at the field that decides it — the
       per-payment choice of MIP-0012 §6.6, which moved onto this sheet with the
       rest of the send. */
    await sendPicker(page).selectOption({ index: 1 });
    await sendRecipient(page).fill(RESOLVABLE_NAME);
    await expect(
      page.getByText('Both Passports are named on chain for this payment.'),
    ).toBeVisible();

    await sendAmount(page).fill('10');
    await expect(page.getByRole('button', { name: /^Review$/ })).toBeEnabled({ timeout: 30_000 });
    await page.getByRole('button', { name: /^Review$/ }).click();
    await expect(page.getByText('Review this transfer')).toBeVisible();
    await page.locator('.mnhome-send-primary').click();

    /* ONE SENTENCE, AND THE CONTROL BACK. Where this run stops is worth being
       exact about: the account it is driving is a REAL one, and its device set
       holds the key the gate run enrolled rather than this walk's stand-in, so
       the refusal is the account's own. What is asserted is the property that
       holds whatever the refusal is — one plain sentence on the sheet, the
       control back, and the money accounted for. */
    const failure = page.locator('.mnhome-send').locator('.mnhome-notice[role="alert"]');
    await expect(failure.first()).toBeVisible({ timeout: 60_000 });
    expect((await failure.first().innerText()).trim()).not.toContain('not built yet');
    await expect(page.locator('.mnhome-send-primary')).toBeEnabled();

    await context.close();
  });

  /* A5, 2026/09/18. This used to assert that the NIGHT payment ran the same
     course as every other one. It no longer runs at all, on either arm: the
     second of its two legs paid the recipient from this Passport's OWN wallet,
     so the value left the account into a wallet the app builds and a tab closed
     between the legs left somebody's money where neither party owned it. That
     is the route the shielded send had taken out of it, and it is now out of
     this one too.

     WHERE THE REFUSAL LANDS NOW, AND WHY IT IS EARLIER THAN IT WAS. The bare
     form this Passport used to land on had no idea what the account held, so a
     NIGHT send reached the seam and was refused there in one sentence. The real
     Send sheet checks the balance first, and the account in this recording holds
     no NIGHT — so the refusal it gets is the truer of the two, and it arrives
     before anybody is asked to review anything. The seam's own sentence is held
     to in `src/lib/custodyHome.test.ts`, which is where a sentence belongs. */
  test('will not offer NIGHT this Passport does not hold', async ({ browser }) => {
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    await serveAccountCustodyState(page, [ACCOUNT_CUSTODY_ADDRESS, PASSPORT_ACCOUNT_ADDRESS]);
    await seedDynamicPassport(page, {
      name: 'walker',
      accountAddress: ACCOUNT_CUSTODY_ADDRESS,
      musd: '40',
    });
    await page.goto(WALK);
    await expect(greeting(page)).toBeVisible({ timeout: 60_000 });

    await openSend(page);
    await sendPicker(page).selectOption({ index: 0 });
    await sendRecipient(page).fill(RESOLVABLE_NAME);
    await sendAmount(page).fill('0.001');

    /* NOTHING IS SIGNED AND NOTHING IS REVIEWED. The control stays down, which
       is the house rule for an action that cannot work. */
    await expect(page.getByRole('button', { name: /^Review$/ })).toBeDisabled();
    /* And the old sentence is still gone: this is not a Passport of this kind
       being told it cannot pay anybody. */
    expect(await page.locator('.mnhome-send').innerText()).not.toContain('not built yet');

    /* The shielded balance beside it is what sends, and the sheet says so by
       offering it. */
    await expect(sendPicker(page).locator('option')).toHaveCount(2);

    await context.close();
  });
});

/**
 * WHAT A PREVIOUS SESSION LEFT BEHIND, read by the shipped build.
 *
 * Both walks here start from `localStorage` written before the app runs, in
 * the shape the app's own modules persist — which is the only way to drill the
 * thing that actually goes wrong with a payment: not the leg that fails, but
 * what the NEXT open of Passport says about it. A tab is closed between two
 * legs far more often than a leg fails, and until 2026/09/17 one of these
 * states came back as no payment at all.
 */
test.describe('a Passport opened again after a payment', () => {
  test('still holds the change a spend left, after a reload', async ({ browser }) => {
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    await serveAccountCustodyState(page, [ACCOUNT_CUSTODY_ADDRESS, PASSPORT_ACCOUNT_ADDRESS]);
    /* The state a spend of 70 out of 100 leaves: the change coin held at the
       position that proved, and the consumed nonce recorded as spent. */
    await seedDynamicPassport(page, {
      name: 'walker',
      accountAddress: ACCOUNT_CUSTODY_ADDRESS,
      musd: '30',
      coin: { nonceHex: 'a1'.repeat(32), mtIndex: '13' },
      spentNonces: ['cd'.repeat(32)],
    });
    await page.goto(WALK);

    await expect(assetRow(page, 'mUSD')).toContainText('30', { timeout: 60_000 });

    /* THE RELOAD IS THE ASSERTION. The change coin's description exists
       nowhere but in this browser, and the inbox walk that runs on every open
       re-reads the entry that described the coin the spend consumed — so a
       reload is where a build that let that walk win puts the spent hundred
       back over the thirty of change. */
    await page.reload();
    await expect(greeting(page)).toBeVisible({ timeout: 60_000 });
    await expect(assetRow(page, 'mUSD')).toContainText('30');
    expect(await page.locator('.mnhome-assets').innerText()).not.toContain('100');

    await context.close();
  });

  test('says where a one-transaction payment got to, and offers no button to repeat it', async ({
    browser,
  }) => {
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    await serveAccountCustodyState(page, [ACCOUNT_CUSTODY_ADDRESS, PASSPORT_ACCOUNT_ADDRESS]);
    await seedDynamicPassport(page, {
      name: 'walker',
      accountAddress: ACCOUNT_CUSTODY_ADDRESS,
      musd: '30',
      stoppedSend: stoppedSendRow('sending'),
    });
    await page.goto(WALK);

    /* THE WHOLE OF WHAT THE ONE-TRANSACTION SEND CHANGES HERE. Until
       2026/09/18 a tab closed mid-payment left value in the sender's own
       wallet with a leg still to run, so the offer was a sentence AND a
       "Finish this payment" button. There is now no such leg: the transaction
       either landed or it did not, so what is owed is the sentence and a way
       to put it away. A button would be a button offering to pay twice. */
    /* IT IS SAID WHERE HOME SAYS EVERYTHING ELSE THAT WANTS READING — the
       banner at the top, with the one control that puts it away. */
    const offer = page.locator('.mnhome-notice[role="alert"]');
    await expect(offer).toBeVisible({ timeout: 60_000 });
    await expect(offer).toContainText('was sent as one payment');
    await expect(offer).toContainText('Your balance below says which.');
    await expect(page.getByRole('button', { name: 'Finish this payment' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Dismiss error' })).toBeVisible();

    /* And the sentence points at a balance that is really on the screen
       beside it — the sentence is only the truth if the figure is there. */
    await expect(assetRow(page, 'mUSD')).toContainText('30');

    await context.close();
  });

  test('says nothing at all about a payment that landed', async ({ browser }) => {
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    await serveAccountCustodyState(page, [ACCOUNT_CUSTODY_ADDRESS, PASSPORT_ACCOUNT_ADDRESS]);
    await seedDynamicPassport(page, {
      name: 'walker',
      accountAddress: ACCOUNT_CUSTODY_ADDRESS,
      musd: '30',
      stoppedSend: stoppedSendRow('done'),
    });
    await page.goto(WALK);

    /* A payment that finished owes nobody an interruption on the next open.
       The record is still there — it is cleared by the screen, not by the
       reader — and the screen is quiet about it. */
    await expect(greeting(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.mnhome-notice[role="alert"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Finish this payment' })).toHaveCount(0);

    await context.close();
  });
});
