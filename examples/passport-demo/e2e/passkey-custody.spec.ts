/**
 * A PASSPORT MADE BY A PASSKEY ON THE ACCOUNT CUSTODY CONTRACT.
 *
 * WHAT THIS TIER CAN AND CANNOT SEE
 * ---------------------------------
 * The passkey is REAL: Chromium's virtual authenticator answers
 * `navigator.credentials.create()` and `.get()` with a CTAP 2.1 credential that
 * evaluates PRF, so the contract root, the JubJub scalar derived from it, the
 * device point, and the viewing secret are all the shipped derivations over
 * bytes a real authenticator produced. Nothing about the identity is a
 * stand-in.
 *
 * The CHAIN is not. `installNetworkBoundary` answers the node, the indexer, and
 * the sponsor from recordings, and there is no proving service behind it — so a
 * setup started here reaches the first proof and stops with the sentence it is
 * supposed to stop with. That is the honest limit of the mocked tier and it is
 * what `RUN-onboard.md` is for.
 *
 * WHAT IT IS HOLDING, THEN, AND WHY EACH ONE MATTERS
 * --------------------------------------------------
 * THE ROUTE, which is the whole of PR 5's risk. A passkey with no Passport must
 * reach the account custody screen; a passkey that already has one on the old
 * contract must reach the flow it has always had, because the Passports in
 * production are not migrated and there is no way back from showing one the
 * wrong screen. Those two cases are the first two tests and they are the
 * reason this file exists.
 *
 * THE POINTER, because it is what makes the second visit free. The key every
 * store is under is the device point, which costs an assertion; a returning
 * passkey that had to pay one just to be routed would ask for a fingerprint
 * before it had shown anybody anything.
 *
 * THE SETUP AND THE NAME, as far as a tier with no chain can take them.
 *
 * `?accwalk=1` IS WHAT SELECTS THE ROUTE, the same shape as `?dynamicwalk=` and
 * for the same reason: one preview build serves the whole mocked tier, and the
 * flag that makes this path reachable is set for that build and for no
 * deployment. No other spec writes it, so no other spec is affected. See
 * `src/lib/custodyRoute.ts`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import {
  PASSPORT_ACCOUNT_ADDRESS,
  RECIPIENT_ACCOUNT_ADDRESS,
  RESOLVABLE_NAME,
  installNetworkBoundary,
} from './mocks.js';
import { installVirtualAuthenticator } from './passkey.js';
import { SIGN_IN_BUTTON, walkContextOptions } from './walkContext.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The URL that puts this tab on the account custody route. */
const WALK = '/?accwalk=1';

const WALK_NETWORK = 'stagenet';

/**
 * THE REAL HOME, WHICH IS WHERE A FINISHED PASSPORT NOW LANDS.
 *
 * Until 2026/09/22 a Passport on this contract landed on a page of its own — a
 * big name, one figure, "People can pay you at", and a three-field form — while
 * every prototype Passport got the product. These helpers name the product's
 * own furniture, so a walk that ended up back on the bare page fails on its
 * first line rather than on a figure that renders either way.
 */
function greeting(page: Page) {
  /* Since the Home polish (2026/09/22) the greeting is the time of day alone;
     the name lives once, in the identity card. */
  return page.getByRole('heading', { name: /^Good (morning|afternoon|evening)\.$/ });
}

/** One row of Home's balance strip, by its ticker. */
function assetRow(page: Page, symbol: string) {
  return page.locator('.mnhome-token-row', { hasText: symbol });
}

/** Opens the Send sheet from Home's money row. */
async function openSend(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Send$/ }).first().click();
  await expect(page.locator('.mnhome-send')).toBeVisible();
}

const sendPicker = (page: Page) => page.locator('.mnhome-send-asset');
const sendRecipient = (page: Page) => page.locator('.mnhome-send').getByRole('textbox').first();
const sendAmount = (page: Page) => page.locator('.mnhome-send-amount input');

/** The Send sheet's own failure panel. */
const sendFailure = (page: Page) =>
  page.locator('.mnhome-send').locator('.mnhome-notice[role="alert"]');

/** The demo stablecoin's colour, as `src/lib/colour.ts` knows it. */
const MUSD_COLOUR = '1a2917fbed8b5ce44d12ebc7d337689045f6c96a6bbd39cf3d8691ab310ef6a6';

/**
 * A real account on the account custody build, recorded off stagenet, and the
 * two recordings midnight-js wants before it will open a connection to it.
 *
 * Shared with `provider-recovery.spec.ts` deliberately: the account is the same
 * whichever arm holds it, which is the claim the whole adapter rests on.
 */
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
const ACCOUNT_CUSTODY_ADDRESS =
  'cbd6b1c14a99c1751caa80a5665f01cb8067a9758183bda5da581e4ef745d215';

/**
 * The same recorded account with 5 NIGHT on its unshielded mirror — the
 * recording above run through the build's own `deposit_unshielded` circuit,
 * locally, once. The recording itself holds no NIGHT.
 */
const ACCOUNT_CUSTODY_NIGHT_STATE = fs.readFileSync(
  path.join(here, 'fixtures', 'stagenet-account-custody-night.json'),
  'utf8',
);

/** A real stagenet unshielded address that belongs to nobody in this walk. */
const NIGHT_ADDRESS = 'mn_addr_stagenet127xnp9uuxwhh7a8an77mxv02ypt6u09xkk63c9zvdkjsrj4mj68qg7c5ad';

/** Answers the account custody recordings for one address, ahead of the boundary. */
async function serveAccountCustodyState(
  page: Page,
  addresses: readonly string[],
  states: Readonly<Record<string, string>> = {},
): Promise<void> {
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
      return route.fulfill({
        contentType: 'application/json',
        body: states[asked] ?? ACCOUNT_CUSTODY_STATE,
      });
    }
    return route.fallback();
  });
}

/**
 * A passkey that already holds a FINISHED account custody Passport, seeded
 * before the app runs.
 *
 * `credentialId` is what the pointer is keyed by and `userKey` is what
 * everything else is keyed by, and the two are written separately on purpose:
 * that separation IS the design, and a seeding helper that collapsed them would
 * stop testing it. The stored shapes are spelled out here rather than imported,
 * for the reason `provider-recovery.spec.ts` gives: the walk's point is that the
 * SHIPPED reader reads what a previous session left behind.
 */
async function seedPasskeyPassport(
  page: Page,
  options: {
    credentialId: string;
    userKey: string;
    /** The `.night` name this Passport holds, or null for one that has none. */
    name: string | null;
    musd: string;
    /**
     * What the RECORD says about the last step, which is not always what the
     * chain says. False seeds the state of the live defect of 2026/09/22: the
     * activation landed and the confirmation did not, so this browser wrote
     * down "not finished" about an account that is finished.
     */
    activated?: boolean;
  },
): Promise<void> {
  const key = `${options.userKey}|${WALK_NETWORK}`;
  const record = {
    user: options.userKey,
    network: WALK_NETWORK,
    address: ACCOUNT_CUSTODY_ADDRESS,
    privateStateId: `passport-account-custody-${options.userKey.slice(7, 15)}`,
    saltHex: '',
    pkXHex: null,
    pkYHex: null,
    wavesDone: 4,
    totalWaves: 4,
    activated: options.activated ?? true,
    txHashes: [],
  };
  const store = {
    [`${WALK_NETWORK}::${ACCOUNT_CUSTODY_ADDRESS}`]: {
      encSecretKeyHex: 'ab'.repeat(32),
      coins: {
        [MUSD_COLOUR]: {
          nonceHex: 'cd'.repeat(32),
          colorHex: MUSD_COLOUR,
          value: options.musd,
          mtIndex: '12',
        },
      },
      queued: {},
      spentNonces: [],
      mtIndexCandidates: {},
      awaiting: {},
    },
  };
  await page.addInitScript(
    ([recordKey, seededRecord, seededName, seededStore, pointerKey, seededUser]) => {
      window.localStorage.setItem(
        'passport-account-custody:v1',
        JSON.stringify({ [recordKey]: seededRecord }),
      );
      /* A Passport with no name yet writes no name, because a seeded empty
         string is a name as far as the reader is concerned and would send the
         walk to Home over the step it is about. */
      if (seededName !== null) {
        window.localStorage.setItem(
          'passport-account-custody-name:v1',
          JSON.stringify({ [recordKey]: seededName }),
        );
      }
      window.localStorage.setItem('passport-k1-coins:v1', JSON.stringify(seededStore));
      window.localStorage.setItem(
        'passport-account-custody-passkey:v1',
        JSON.stringify({ [pointerKey]: seededUser }),
      );
    },
    [key, record, options.name, store, `${options.credentialId}|${WALK_NETWORK}`, options.userKey] as const,
  );
}

/* -------------------------------------------------------------------------- */
/* Which screen a passkey reaches                                             */
/* -------------------------------------------------------------------------- */

test.describe('a passkey with no Passport yet', () => {
  test('is offered a Passport on the new contract, and not the old name step', async ({
    browser,
  }) => {
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    await installVirtualAuthenticator(context, page);
    await page.goto(WALK);

    /* The ceremony itself, unchanged: one way in, and it is a passkey. */
    await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();

    /* AND THEN THE WELCOME PAGE — the same one the old road showed, said now
       by the account custody screen itself. This is the routing claim: a
       passkey with no account of its own makes its next Passport on the
       account custody contract, and it is introduced to it first.

       The screen that used to be here, "Set up your Passport", is gone
       (2026/09/22): it was an offer with no name on it, in front of a flow
       that asked for the name two screens later. */
    await expect(page.getByRole('heading', { name: /Welcome to\s*Passport/ })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole('heading', { name: /Set up\s*your Passport/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Choose my name' })).toBeEnabled();

    /* NOTHING ON IT NAMES A VENDOR OR A SIGN-IN, because there was neither:
       this reader touched an authenticator. The first render of this screen
       said "SIGNED IN WITH THIS DEVICE" and "your Passport is all Passport
       needs", which is what a sign-in's sentence looks like with a passkey's
       words poured into it — so the sentences are the arm's now, whole, and
       this is what holds them that way. */
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/Google|Discord|Microsoft|signed in|sign-in/i);
    /* Case-insensitively: the kicker is upper-cased by the sheet, and what is
       being held is the words rather than the styling. */
    expect(body.toLowerCase()).toContain('your key is on this device');
    expect(body).toContain('The key on this device is all Passport needs.');

    /* NONE OF THE WORDS A READER HAS NO USE FOR. The same rule the Dynamic walk
       asserts, on the arm where it is easiest to slip: this path is the one a
       developer reads most often. */
    const lower = body.toLowerCase();
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
      expect(lower, `"${forbidden}" is on screen`).not.toContain(forbidden);
    }

    /* AND THE NAME IS THE NEXT THING ASKED FOR, not the last. The one press on
       that step makes the whole Passport, so it stays off until the registry
       has said the name is free — "Checking…" is not yes, and an empty field
       is certainly not. */
    await page.getByRole('button', { name: 'Choose my name' }).click();
    await expect(page.getByRole('heading', { name: /Choose\s*your \.night name/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create my Passport' })).toBeDisabled();
    /* THERE IS NO WAY PAST IT, and that is the point of asking here: the name
       is part of making the Passport, not a decoration on one that exists. */
    await expect(page.getByRole('button', { name: 'Choose one later' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'I already have a Passport' })).toBeVisible();

    await context.close();
  });

  test('will not make a Passport until the name has been answered for', async ({ browser }) => {
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    await installVirtualAuthenticator(context, page);
    await page.goto(WALK);
    await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
    await expect(page.getByRole('button', { name: 'Choose my name' })).toBeEnabled({
      timeout: 60_000,
    });
    await page.getByRole('button', { name: 'Choose my name' }).click();

    /* A NAME THAT IS REALLY TAKEN, read by the shipped Midnames module out of
       the stagenet `.night` TLD's own recorded state — the same two reads a
       live check makes. `iamtester` is registered there. */
    await page.getByLabel('Your name').fill(RESOLVABLE_NAME);
    await expect(page.getByText(`${RESOLVABLE_NAME}.night is already taken`)).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByRole('button', { name: 'Create my Passport' })).toBeDisabled();

    /* And one that is not. The control comes on, and nothing has been built
       yet — the press is what builds it. */
    await page.getByLabel('Your name').fill('walker');
    await expect(page.getByText('walker.night is available')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByRole('button', { name: 'Create my Passport' })).toBeEnabled();

    await context.close();
  });

  test('counts the setup steps, and asks the sponsor to pay for the first one', async ({
    browser,
  }) => {
    /* Building wave 1 is real work — the compiled module, the ledger WASM, and
       a deploy transaction — and on the shared CI runner it took longer than
       this file's default 90 s (2026/09/21), so the poll below never got to
       see the sponsor asked. The budget covers the poll it contains. */
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    const network = await installNetworkBoundary(page);
    test.setTimeout(240_000);
    /* The first wave is a DEPLOY of the account custody build, which needs
       that build's verifier keys staged under /zk/account-custody. They are
       compiler output, gitignored, and no CI runner carries them (the ZK
       bundle pinned for CI holds the prototype modules only), so on such a
       build the setup cannot even be constructed and this walk would assert
       nothing true. It is skipped there, with the reason on record; the live
       run on stagenet (RUN-onboard.md) is where this flow is proven. */
    const probe = await page.request.get(
      '/zk/account-custody/keys/activate_initial_device_with_jubjub.verifier',
    );
    test.skip(
      !probe.ok(),
      'this build carries no account-custody verifier keys, so wave 1 cannot be built here',
    );
    await installVirtualAuthenticator(context, page);
    await page.goto(WALK);
    await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
    await expect(page.getByRole('button', { name: 'Choose my name' })).toBeEnabled({
      timeout: 60_000,
    });
    /* The welcome, then the name, and then the one press. Since 2026/09/22 the
       press that starts the setup is the press that chose the name, so the
       walk has to choose one before it can start anything. */
    await page.getByRole('button', { name: 'Choose my name' }).click();
    await page.getByLabel('Your name').fill('walker');
    await expect(page.getByRole('button', { name: 'Create my Passport' })).toBeEnabled({
      timeout: 120_000,
    });

    const before = network.sponsorTraffic().requests;
    await page.getByRole('button', { name: 'Create my Passport' }).click();

    /* The count line while it works. It is the SAME three steps as the other
       arm — set the Passport up, finish it, turn the key on — even though a
       jubjub-born account is four transactions rather than three, because the
       middle ones are one thing to the person waiting.

       Since 2026/09/22 it is read off the LIVE phase rather than off the
       stored record, which is what makes it true: the record is re-read when a
       press finishes, so a reader watched this line say "1 of 3" while the
       chain showed all three landed. The next test is where the whole journey
       it now belongs to is drilled. */
    await expect(page.locator('p.mnob-hint[role="status"]')).toHaveText(
      'Setting up your Passport, step 1 of 3',
      { timeout: 60_000 },
    );

    /* AND THE SETUP REALLY RUNS. The fees for wave 1 are asked of the sponsor,
       which is the first thing this flow does that leaves the tab — so a
       request arriving there is evidence that a transaction was BUILT around
       the device this passkey derived, rather than that a spinner started.
       Beyond it lies a chain this tier does not have, which is what the live
       run in `scratchpad/live-proxy/RUN-onboard.md` is for.

       Asserted on the sponsor rather than on a refusal sentence because this
       arm's first wave is a DEPLOY: it needs no proving service, so there is
       nothing here for it to be refused BY — it simply waits on a node that
       will not answer. Waiting is the honest behaviour and an assertion that
       demanded a refusal would be demanding a defect. */
    await expect
      .poll(() => network.sponsorTraffic().requests, { timeout: 210_000 })
      .toBeGreaterThan(before);

    /* And whatever the screen ends up saying, it is not a stack. */
    const shown = await page.locator('body').innerText();
    expect(shown.toLowerCase()).not.toContain('error:');
    expect(shown.toLowerCase()).not.toContain('undefined');

    await context.close();
  });

  /**
   * THE WHOLE JOURNEY, ON A SETUP THAT IS GENUINELY STUCK.
   *
   * "I like how we showed the full TX journey here … this part same way with
   * the game is critical" (2026/09/22). The old name step showed a claim you
   * could follow — rows with marks, a clock on the one that is running, the
   * long one broken into the states it passes through, and a game for the
   * minutes — and the name-first setup showed a button and a counter that did
   * not count. It shows the same panel now, painted by the same component
   * (`src/screens/ProgressTimeline.tsx`) and driven by this road's own phases.
   *
   * HOW A TIER WITH NO CHAIN HOLDS A SETUP STILL, and it is
   * `claim-progress.spec.ts`'s trick because the problem is the same one: the
   * deploy asks for its circuit keys over HTTP before it can build anything,
   * and a request that is never answered leaves the app in exactly the state a
   * slow prover leaves it in — the long row running, its first state live, and
   * nothing moving but the clock. Nothing is stubbed to arrange it.
   */
  test('shows the whole journey, counts while nothing moves, and offers the game', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    /* NO SERVICE WORKER IN THIS CONTEXT: `public/sw.js` serves `/zk/**`
       cache-first, and a worker's fetches are not the page's — so `page.route`
       would never see the request this walk means to hold open. */
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);

    /* Asked BEFORE the prover is held open, for the same reason the walk above
       asks it: a build with no account-custody verifier keys cannot construct
       wave 1 at all, so this walk would assert nothing true. */
    const probe = await page.request.get(
      '/zk/account-custody/keys/activate_initial_device_with_jubjub.verifier',
    );
    test.skip(
      !probe.ok(),
      'this build carries no account-custody verifier keys, so wave 1 cannot be built here',
    );

    // THE PROVER, HELD OPEN — never fulfilled, never aborted, and free.
    await page.route('**/zk/**', () => {
      /* Deliberately empty: the request stays in flight for the life of the
         context, which is what a prover taking its minutes looks like. */
    });

    await installVirtualAuthenticator(context, page);
    await page.goto(WALK);
    await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
    await expect(page.getByRole('button', { name: 'Choose my name' })).toBeEnabled({
      timeout: 60_000,
    });
    await page.getByRole('button', { name: 'Choose my name' }).click();
    await page.getByLabel('Your name').fill('walker');
    await expect(page.getByRole('button', { name: 'Create my Passport' })).toBeEnabled({
      timeout: 120_000,
    });
    await page.getByRole('button', { name: 'Create my Passport' }).click();

    /* THREE ROWS, AND THE FIRST IS ALREADY TICKED. The press that started this
       setup could not have been made over a name the registry had not reported
       free, so the check it names is a thing that has happened — and a row
       sitting `todo` over work that was done is the same untruth as a counter
       stuck on one. */
    const rows = page.locator('.mnid-stepper-item');
    await expect(rows).toHaveCount(3, { timeout: 120_000 });
    await expect(rows.nth(0)).toContainText('Checking your name');
    await expect(rows.nth(0)).toHaveAttribute('data-state', 'done');
    await expect(rows.nth(1)).toContainText('Confirm with your passkey');

    /* THE LONG ROW, RUNNING, AND THE FIVE STATES IT IS MADE OF — on screen
       whole from the first frame, so they fill in rather than appearing under
       a reader who is already waiting. */
    const account = rows.nth(2);
    await expect(account).toHaveAttribute('data-state', 'active', { timeout: 120_000 });
    await expect(account).toContainText('Setting up your account');
    const stages = account.locator('.mnid-substage');
    await expect(stages).toHaveCount(5);
    await expect(stages.nth(0)).toContainText('Creating your account');
    await expect(stages.nth(1)).toContainText('Finishing your account');
    await expect(stages.nth(2)).toContainText('Turning on your sign-in');
    await expect(stages.nth(3)).toContainText('Registering walker.night');
    await expect(stages.nth(4)).toContainText('Confirming your name');
    await expect(stages.nth(0)).toHaveAttribute('data-state', 'active');
    for (const index of [1, 2, 3, 4]) {
      await expect(stages.nth(index)).toHaveAttribute('data-state', 'todo');
    }
    /* And the warning about the minutes is up FRONT, on the row that costs
       them, rather than arriving once the reader is already inside the wait. */
    await expect(account).toContainText(
      'Your Passport is on its way. This part takes a few minutes.',
    );

    /* THE COUNT LINE, READ OFF THE LIVE PHASE. This is the counter that was
       stuck: it came off a stored record that is re-read only when the press
       FINISHES, so it said "1 of 3" through all three. */
    await expect(page.locator('p.mnob-hint[role="status"]')).toHaveText(
      'Setting up your Passport, step 1 of 3',
    );

    /* AND THE CLOCK KEEPS COUNTING ON A PHASE THAT IS NOT MOVING. This is the
       one thing a static assertion cannot establish: a number rendered once
       from `Date.now()` passes every test about its format and is exactly the
       hang it was built to disprove. Read twice, five seconds apart, with
       nothing changing between the two reads except the number. */
    const timing = account.locator('.mnid-stepper-timing');
    await expect(timing).toHaveText(/Usually about 4 minutes — \d+:\d{2} so far/);
    const clock = async (): Promise<number> => {
      const match = /(\d+):(\d{2})/.exec(await timing.innerText());
      if (match === null) throw new Error('no clock on the running row');
      return Number(match[1]) * 60 + Number(match[2]);
    };
    const first = await clock();
    await page.waitForTimeout(5_000);
    await expect(stages.nth(0)).toHaveAttribute('data-state', 'active');
    expect((await clock()) - first).toBeGreaterThanOrEqual(4);

    /* THE BUTTON NAMES THE ROW THAT IS RUNNING, and says it once: the panel
       above it is the progress indicator, and a button repeating a sentence
       already printed there is two spinners and one fact. */
    await expect(page.getByRole('button', { name: 'Setting up your account' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'I already have a Passport' })).toBeVisible();

    /* SOMETHING TO DO WITH THE MINUTES. Offered rather than started, after
       `OFFER_AFTER_MS`, and it sits BENEATH the panel in normal flow so it
       covers nothing — which the assertion after it holds. */
    const offer = page.getByRole('button', { name: 'Play while you wait' });
    await expect(offer).toBeVisible({ timeout: 60_000 });
    await offer.click();
    await expect(page.locator('.mngame')).toBeVisible();
    await expect(page.locator('.mngame-title')).toHaveText('While you wait');
    await expect(account).toHaveAttribute('data-state', 'active');
    await expect(stages.nth(0)).toHaveAttribute('data-state', 'active');

    /* No percentage, anywhere. There is no quantity to take a percentage OF —
       a proof either lands or it does not — so a bar filling to 60% would be a
       number nobody measured, and inventing one is how a progress view starts
       lying. */
    await expect(page.locator('.mnid-panel').first()).not.toContainText('%');

    /* AND NOTHING THE PANEL SAYS NAMES THE MACHINERY BEHIND IT. Swept while
       the setup is mid-flight, so the rows, the five states, the timing line,
       the hint, and the button are all in it. */
    const text = await page.locator('body').innerText();
    for (const forbidden of ['contract', 'registry', 'indexer', 'resolver', 'sponsor', 'sdk']) {
      expect(text.toLowerCase(), `"${forbidden}" is on screen`).not.toContain(forbidden);
    }
    expect(text).not.toMatch(/\bDUST\b/);
    expect(text.toLowerCase()).not.toContain('wallet address');

    await context.close();
  });
});

/* -------------------------------------------------------------------------- */
/* Coming back to one                                                         */
/* -------------------------------------------------------------------------- */

test.describe('a passkey that already holds one', () => {
  test('opens its own Passport with no second ceremony, and shows what it holds', async ({
    browser,
  }) => {
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    await serveAccountCustodyState(page, [ACCOUNT_CUSTODY_ADDRESS]);
    const authenticator = await installVirtualAuthenticator(context, page);
    await page.goto(WALK);

    /* One ceremony, to sign in — and that is the ONLY one. What routes this
       person is the pointer their last visit wrote, keyed by the credential id,
       which costs nothing to read. */
    await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
    await expect(page.getByRole('heading', { name: /Welcome to\s*Passport/ })).toBeVisible({
      timeout: 60_000,
    });

    /* Now seed the Passport this credential holds and come back. The credential
       id is read from the app's own profile rather than invented, so what is
       seeded is keyed exactly as a real second visit would find it. */
    const credentialId = await page.evaluate(() =>
      window.localStorage.getItem('passport-last-passkey'),
    );
    expect(credentialId, 'the app records the credential it enrolled').not.toBeNull();

    await seedPasskeyPassport(page, {
      credentialId: credentialId as string,
      userKey: 'jubjub:2a1f',
      name: 'walker',
      musd: '250',
    });
    await page.goto(WALK);

    /* HOME, AND NOT ONE MORE TOUCH. There is no sign-in button to press on this
       visit — the session is restored and the pointer, keyed by the credential
       id, says which Passport this passkey holds — so the screen opens on the
       name and the balance. That is the whole point of the pointer: the key
       every store is under is the device point, which costs an assertion, and
       a returning reader must not be asked for a fingerprint merely to be
       shown their own Passport. */
    /* THE REAL HOME (2026/09/22), and not the bare page this path used to land
       on. Everything below is something that page did not have. */
    await expect(greeting(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('People can pay you at')).toHaveCount(0);
    await expect(page.getByRole('button', { name: SIGN_IN_BUTTON })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create my Passport' })).toHaveCount(0);
    /* Nor is a Passport that already exists welcomed to Passport. */
    await expect(page.getByRole('heading', { name: /Welcome to\s*Passport/ })).toHaveCount(0);

    /* The money row, and what it has been paid — read out of the store the
       shipped reader reads. */
    await expect(page.getByRole('button', { name: /^Send$/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Receive$/ })).toBeVisible();
    /* The account's own NIGHT, off its unshielded mirror. A real zero here —
       this recorded account holds none — and a zero is what the row must show
       rather than "Syncing" or a blank. */
    await expect(assetRow(page, 'NIGHT')).toContainText('native token');
    await expect(assetRow(page, 'mUSD')).toContainText('250');

    /* The name card, the account line, the trail, and the bar. */
    await expect(page.getByText('Your name on Stagenet')).toHaveCount(0);
    await expect(page.getByText('Registered on Stagenet')).toBeVisible();
    await expect(page.locator('.mnid-alias')).toHaveText('walker.night');
    await expect(page.getByText('Your account is ready')).toBeVisible();
    await expect(page.locator('.mnhome-activity')).toContainText('Passport created', {
      timeout: 30_000,
    });
    await expect(page.locator('.mnhome-activity')).toContainText('Your name is registered');
    await expect(page.getByRole('button', { name: /^Apps$/ })).toBeVisible();

    /* RECEIVE OFFERS THE NAME AND THE ACCOUNT, and nothing else. */
    await page.getByRole('button', { name: /^Receive$/ }).click();
    const receive = page.getByRole('dialog', { name: 'Receive to your Passport' });
    await expect(receive).toBeVisible();
    await expect(receive).toContainText('walker.night');
    await expect(receive).toContainText('Your account');

    await authenticator.remove();
    await context.close();
  });

  /* THE LIVE DEFECT OF 2026/09/22, AS A WALK.
     ----------------------------------------
     The last step of a setup — turning the key on — was proved, balanced, and
     included in block 569232 as transaction `c01c7791…`, and the node's socket
     then closed under the wait (`1000:: Normal Closure`). The record was left
     saying the setup was unfinished about an account that was finished, and the
     screen offered the step again: the circuit's dry run refused it with
     `failed assert: already activated`, which reached the reader as "Something
     went wrong. Try that again." — for ever, over a working Passport.

     What this holds is the fix from the outside: a record that says unfinished
     over an account the chain says is on now heals itself on open. No press, no
     authenticator, nothing signed — the screen simply arrives where the
     Passport actually is, which is the name step. */
  test('opens on the name step when the record says unfinished and the chain says done', async ({
    browser,
  }) => {
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    await serveAccountCustodyState(page, [ACCOUNT_CUSTODY_ADDRESS]);
    const authenticator = await installVirtualAuthenticator(context, page);
    await page.goto(WALK);

    await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
    /* The welcome page, which is where a passkey with no Passport lands since
       the name-first flow (2026/09/22). It used to be "Set up your Passport" —
       a page whose whole content was an offer and a button — and that page is
       gone. */
    await expect(page.getByRole('heading', { name: /Welcome to\s*Passport/ })).toBeVisible({
      timeout: 60_000,
    });
    const credentialId = await page.evaluate(() =>
      window.localStorage.getItem('passport-last-passkey'),
    );

    /* The half-written record: every wave landed, the activation is not
       recorded, and no name has been claimed yet. */
    await seedPasskeyPassport(page, {
      credentialId: credentialId as string,
      userKey: 'jubjub:2a1f',
      name: null,
      musd: '0',
      activated: false,
    });
    await page.goto(WALK);

    /* AND IT ARRIVES AT THE NAME STEP BY ITSELF. Not "Finish setting up my
       Passport", and certainly not a failure sentence. */
    await expect(page.getByRole('heading', { name: /Choose\s*your \.night name/ })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByLabel('Your name')).toBeVisible();
    /* NO CEREMONY WAS ASKED FOR, which is the other half of the claim: the
       account was read, not acted on, and reading costs no authenticator. */
    await expect(page.getByRole('button', { name: SIGN_IN_BUTTON })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Finish setting up my Passport' })).toHaveCount(
      0,
    );

    const body = await page.locator('body').innerText();
    expect(body).not.toContain('Something went wrong');

    /* And the record itself was mended, so the next visit costs no read. */
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const raw = window.localStorage.getItem('passport-account-custody:v1');
            if (raw === null) return null;
            const records = JSON.parse(raw) as Record<string, { activated: boolean }>;
            return Object.values(records)[0]?.activated ?? null;
          }),
        { timeout: 30_000 },
      )
      .toBe(true);

    await authenticator.remove();
    await context.close();
  });

  test('offers coming back by name, and says a name alone is not enough', async ({ browser }) => {
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    await installVirtualAuthenticator(context, page);
    await page.goto(WALK);
    await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
    await expect(page.getByRole('button', { name: 'I already have a Passport' })).toBeVisible({
      timeout: 60_000,
    });

    await page.getByRole('button', { name: 'I already have a Passport' }).click();

    await expect(page.getByRole('heading', { name: /Find it\s*by its name/ })).toBeVisible();
    /* The sentence that stops somebody thinking a public name is a credential.
       It matters more on this arm than on the other: the thing that proves the
       Passport is theirs is the authenticator they are holding. */
    await expect(page.getByText('Knowing the name is not enough on its own.')).toBeVisible();

    await expect(page.getByRole('button', { name: 'Find my Passport' })).toBeDisabled();
    await page.getByLabel('Your name').fill('alice');
    await expect(page.getByRole('button', { name: 'Find my Passport' })).toBeEnabled();

    /* Back to where they came from, which is now the welcome page rather than
       an offer: nothing has been chosen and nothing has been built. */
    await page.getByRole('button', { name: 'Go back' }).click();
    await expect(page.getByRole('button', { name: 'Choose my name' })).toBeVisible();

    await context.close();
  });
});

/* -------------------------------------------------------------------------- */
/* What a passkey Passport can pay, and what it says before it pays it        */
/* -------------------------------------------------------------------------- */

/**
 * A THROWAWAY SHIELDED ADDRESS, for the door that is one call rather than two.
 *
 * It is a real stagenet address in shape and belongs to nobody: what the walk
 * needs from it is that `decodeShieldedRecipient` reads two keys out of it, and
 * that the field's own branch takes the address door rather than the registry.
 */
const THROWAWAY_ADDRESS =
  'mn_shield-addr_stagenet1rp8w5asc5y6k0yvy8awxkzay78gqfmfzurjv9mlncktwdluc2nz5px' +
  'tqtvfk7z5dtthx7kk6ewhluygc3xp2wrmyp3erzwdwns78fus5nm2xk';

/** Opens a passkey Passport that already holds 250 mUSD, on Home. */
async function passkeyPassportOnHome(
  browser: import('@playwright/test').Browser,
  options: {
    /** The account also holds 5 NIGHT. */
    night?: boolean;
    /** `iamtester` (and the typed-out recipient) lead to an OLDER Passport. */
    recipientIsOlder?: boolean;
    /**
     * Seeds more state after the Passport itself and before the app opens it
     * — a payment a previous session left behind (2026/09/22).
     */
    beforeOpen?: (page: Page, identity: { credentialId: string; userKey: string }) => Promise<void>;
  } = {},
): Promise<{
  page: Page;
  close: () => Promise<void>;
}> {
  const context = await browser.newContext(
    walkContextOptions({ viewport: { width: 420, height: 900 } }),
  );
  const page = await context.newPage();
  await installNetworkBoundary(page);
  /* Where `iamtester` is served no custody recording, the boundary answers it
     with its own: the prototype account `stagenet-passport-account.json`. */
  await serveAccountCustodyState(
    page,
    options.recipientIsOlder === true
      ? [ACCOUNT_CUSTODY_ADDRESS]
      : [ACCOUNT_CUSTODY_ADDRESS, PASSPORT_ACCOUNT_ADDRESS],
    options.night === true ? { [ACCOUNT_CUSTODY_ADDRESS]: ACCOUNT_CUSTODY_NIGHT_STATE } : {},
  );
  const authenticator = await installVirtualAuthenticator(context, page);
  await page.goto(WALK);
  await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
  await expect(page.getByRole('heading', { name: /Welcome to\s*Passport/ })).toBeVisible({
    timeout: 60_000,
  });

  /* THE KEY THIS PASSPORT IS REALLY FILED UNDER, and it cannot be invented.
     A passkey Passport is keyed by its DEVICE POINT, which is derived from the
     authenticator — so a record seeded under a made-up key is a record Home
     will show (Home reads the pointer) and every payment will refuse, because
     a payment settles the identity first and then looks the record up under
     it. The two walks below are about payments, so the setup is started once
     purely to make the app derive and record the point, and the record is then
     seeded under the point it derived.

     Since 2026/09/22 that press lives on the name step, behind a name the
     registry has called free, so the walk goes through the welcome page and
     chooses one — the same three taps a person makes. */
  await page.getByRole('button', { name: 'Choose my name' }).click();
  await page.getByLabel('Your name').fill('walker');
  await expect(page.getByRole('button', { name: 'Create my Passport' })).toBeEnabled({
    timeout: 120_000,
  });
  await page.getByRole('button', { name: 'Create my Passport' }).click();
  const seeded = await page.waitForFunction(() => {
    const credentialId = window.localStorage.getItem('passport-last-passkey');
    const raw = window.localStorage.getItem('passport-account-custody-passkey:v1');
    if (credentialId === null || raw === null) return null;
    const pointers = JSON.parse(raw) as Record<string, string>;
    const entry = Object.entries(pointers)[0];
    return entry === undefined ? null : { credentialId, userKey: entry[1] };
  }, undefined, { timeout: 60_000 });
  const identity = (await seeded.jsonValue()) as { credentialId: string; userKey: string };

  await seedPasskeyPassport(page, {
    credentialId: identity.credentialId,
    userKey: identity.userKey,
    name: 'walker',
    musd: '250',
  });
  await options.beforeOpen?.(page, identity);
  await page.goto(WALK);
  await expect(greeting(page)).toBeVisible({ timeout: 60_000 });
  return {
    page,
    close: async () => {
      await authenticator.remove();
      await context.close();
    },
  };
}

test.describe('a passkey Passport paying somebody', () => {
  test('says which of the two payments this one is, before it is made', async ({ browser }) => {
    const { page, close } = await passkeyPassportOnHome(browser);

    await openSend(page);
    await chooseAsset(page, 'mUSD');

    /* NOTHING TO SAY YET. The field decides which transaction gets built, so
       there is nothing to disclose until somebody has typed into it. */
    await expect(page.locator('.mnob-disclosure')).toHaveCount(0);

    /* A NAME IS THE DIRECT TRANSFER: one transaction carrying a call on each
       account, so the chain records that the two of them transacted. That is
       the per-payment choice of MIP-0012 §6.6 and it is said at the field that
       makes it. */
    await sendRecipient(page).fill(RESOLVABLE_NAME);
    await expect(
      page.getByText('Both Passports are named on chain for this payment.'),
    ).toBeVisible();

    /* THE SAME MONEY THE OTHER WAY NAMES NOBODY. */
    await sendRecipient(page).fill(THROWAWAY_ADDRESS);
    await expect(
      page.getByText('This payment names neither Passport on chain.'),
    ).toBeVisible();

    /* And it is about the shielded route only: the account's NIGHT moves by a
       different pair of legs and this sentence would describe the wrong one. */
    await chooseAsset(page, 'NIGHT');
    await expect(page.locator('.mnob-disclosure')).toHaveCount(0);

    await close();
  });

  test('plans a payment to a name and stops where every payment stops', async ({ browser }) => {
    const { page, close } = await passkeyPassportOnHome(browser);

    await openSend(page);
    await chooseAsset(page, 'mUSD');
    await sendRecipient(page).fill(RESOLVABLE_NAME);
    await sendAmount(page).fill('10');
    await expect(page.getByRole('button', { name: /^Review$/ })).toBeEnabled({ timeout: 30_000 });
    await page.getByRole('button', { name: /^Review$/ }).click();
    await page.locator('.mnhome-send-primary').click();

    /* ONE SENTENCE, AND THE CONTROL BACK. There is no proving service behind
       this tier, so the payment is planned in full — the coin chosen out of
       the store, the recipient read off the chain as one of these accounts,
       the amount checked against what one payment can draw on — and then
       stops. What is held is the property that holds whatever the refusal is,
       exactly as the k256 walk next door holds it. */
    await expect(sendFailure(page).first()).toBeVisible({ timeout: 60_000 });
    const sentence = (await sendFailure(page).first().innerText()).trim();
    expect(sentence).not.toContain('not built yet');
    expect(sentence).not.toContain('Paying somebody from this Passport is coming');
    await expect(page.locator('.mnhome-send-primary')).toBeEnabled();

    /* AND THE PASSPORT SAYS WHERE THE MONEY IS: nothing went out, and the
       figure it started with is the figure it still holds. */
    await page.locator('.mnhome-send').getByRole('button', { name: 'Close' }).click();
    await expect(greeting(page)).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText('Nothing was sent, and it is all still in your Passport.'),
    ).toBeVisible();
    await expect(assetRow(page, 'mUSD')).toContainText('250');

    await close();
  });

  test('plans a payment to a shielded address and stops the same way', async ({ browser }) => {
    const { page, close } = await passkeyPassportOnHome(browser);

    await openSend(page);
    await chooseAsset(page, 'mUSD');
    await sendRecipient(page).fill(THROWAWAY_ADDRESS);
    await sendAmount(page).fill('5');
    await expect(page.getByRole('button', { name: /^Review$/ })).toBeEnabled({ timeout: 30_000 });
    await page.getByRole('button', { name: /^Review$/ }).click();
    await page.locator('.mnhome-send-primary').click();

    await expect(sendFailure(page).first()).toBeVisible({ timeout: 60_000 });
    const sentence = (await sendFailure(page).first().innerText()).trim();
    expect(sentence).not.toContain('not built yet');
    expect(sentence).not.toContain('Paying somebody from this Passport is coming');
    await expect(page.locator('.mnhome-send-primary')).toBeEnabled();

    await close();
  });

  /* A7, 2026/09/18. The decode of a pasted address is also the check that it
     belongs to this network, and it used to run AFTER the stopped-send record
     was written and after the approval. So an address this Passport cannot pay
     cost a touch of the authenticator and left a card on Home saying a payment
     was in flight — for a payment that was never built.

     ON THE REAL SEND SHEET THE REFUSAL IS EARLIER STILL, and that is the point
     of moving to it: the field itself will not accept an address the codec
     cannot place, so the control never comes up, no ceremony is asked for, and
     there is nothing to write down. */
  test('refuses an address it cannot pay without writing a payment down', async ({ browser }) => {
    const { page, close } = await passkeyPassportOnHome(browser);

    await openSend(page);
    await chooseAsset(page, 'mUSD');
    /* Shaped like an address the field will take the address door for, and not
       one this Passport can pay. */
    await sendRecipient(page).fill('mn_shield-addr_stagenet1qqqqqqqqqqqqqqqqqqq');
    await sendAmount(page).fill('5');

    await expect(page.locator('#mnhome-send-recipient-error')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /^Review$/ })).toBeDisabled();

    /* AND NO PAYMENT WAS WRITTEN DOWN. The banner on Home is what a stopped
       payment puts there, and nothing here was ever in flight. */
    await page.locator('.mnhome-send').getByRole('button', { name: 'Close' }).click();
    await expect(greeting(page)).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText('Nothing was sent, and it is all still in your Passport.'),
    ).toHaveCount(0);
    await expect(assetRow(page, 'mUSD')).toContainText('250');

    await close();
  });

  /* NIGHT TO A NAME IS REFUSED AT THE FIELD (2026/09/22). The contract has no
     route that moves NIGHT between two accounts, so the sheet says so the
     moment the pair is known — before Review, before any approval — and the
     "coming" sentence is gone from this path entirely. */
  test('refuses NIGHT to a name before anything is asked for', async ({ browser }) => {
    const { page, close } = await passkeyPassportOnHome(browser, { night: true });

    await openSend(page);
    await chooseAsset(page, 'NIGHT');
    await sendRecipient(page).fill(RESOLVABLE_NAME);
    await sendAmount(page).fill('1');

    await expect(page.locator('#mnhome-send-recipient-error')).toHaveText(
      'NIGHT can be sent to an address for now. To pay a name, choose mUSD.',
      { timeout: 30_000 },
    );
    await expect(page.getByRole('button', { name: /^Review$/ })).toBeDisabled();
    const sheet = await page.locator('.mnhome-send').innerText();
    expect(sheet).not.toContain('is coming');
    /* No ceremony: nothing was pressed that could raise one, and no failure. */
    await expect(sendFailure(page)).toHaveCount(0);

    await close();
  });

  test('takes NIGHT to an address as far as the review, in part', async ({ browser }) => {
    const { page, close } = await passkeyPassportOnHome(browser, { night: true });
    await expect(assetRow(page, 'NIGHT')).toContainText('5', { timeout: 30_000 });

    await openSend(page);
    await chooseAsset(page, 'NIGHT');
    await sendRecipient(page).fill(NIGHT_ADDRESS);
    await sendAmount(page).fill('1.5');

    await expect(page.locator('#mnhome-send-recipient-error')).toHaveCount(0);
    const review = page.getByRole('button', { name: /^Review$/ });
    await expect(review).toBeEnabled({ timeout: 30_000 });
    await review.click();

    const sheet = page.locator('.mnhome-send');
    await expect(sheet.getByText('1.5 NIGHT', { exact: true })).toBeVisible();
    await expect(page.locator('.mnhome-send-primary')).toBeEnabled();
    const text = await sheet.innerText();
    expect(text).not.toContain('is coming');
    expect(text).not.toContain('expected to be covered');

    await close();
  });

  test('refuses NIGHT to a shielded address, in words', async ({ browser }) => {
    const { page, close } = await passkeyPassportOnHome(browser, { night: true });

    await openSend(page);
    await chooseAsset(page, 'NIGHT');
    await sendRecipient(page).fill(THROWAWAY_ADDRESS);
    await sendAmount(page).fill('1');

    await expect(page.locator('#mnhome-send-recipient-error')).toContainText(
      'NIGHT goes to an unshielded (mn_addr…) address',
      { timeout: 30_000 },
    );
    await expect(page.getByRole('button', { name: /^Review$/ })).toBeDisabled();

    await close();
  });

  /* A NAME THAT LEADS TO A PASSPORT ON THE OLDER VERSION, refused where it is
     typed. The two builds cannot share a transaction and there is no
     migration, so this is decided when the name resolves — never after an
     approval. */
  test('refuses a name that leads to an older Passport, under the field', async ({ browser }) => {
    const { page, close } = await passkeyPassportOnHome(browser, { recipientIsOlder: true });

    await openSend(page);
    await chooseAsset(page, 'mUSD');
    await sendRecipient(page).fill(RESOLVABLE_NAME);
    await sendAmount(page).fill('10');

    await expect(page.locator('#mnhome-send-recipient-error')).toHaveText(
      "This name belongs to a Passport on the older version, so it can't be paid from this one. Paying between the two versions isn't supported.",
      { timeout: 30_000 },
    );
    await expect(page.getByRole('button', { name: /^Review$/ })).toBeDisabled();
    await expect(sendFailure(page)).toHaveCount(0);
    expect(await page.locator('.mnhome-send').innerText()).not.toContain(
      'set their Passport up again',
    );

    /* The same Passport typed out as an account is refused about what was typed. */
    await sendRecipient(page).fill(RECIPIENT_ACCOUNT_ADDRESS);
    await expect(page.locator('#mnhome-send-recipient-error')).toHaveText(
      "This is a Passport on the older version, so it can't be paid from this one. Paying between the two versions isn't supported.",
      { timeout: 30_000 },
    );
    await expect(page.getByRole('button', { name: /^Review$/ })).toBeDisabled();

    await close();
  });
});

/* -------------------------------------------------------------------------- */
/* The way back, offered once between the name and Home                       */
/* -------------------------------------------------------------------------- */

/**
 * A finished, named passkey Passport, on a build whose sign-in is AVAILABLE and
 * not yet signed in.
 *
 * `?dynamicwalk=out` is what makes the step reachable at all: it is offered
 * only where a provider sign-in exists, and a build whose seam reports
 * `disabled` — which is every other spec in this suite, and every build shipped
 * today — never sees it. The sign-in itself is the stand-in's, and pressing the
 * offer publishes the session the overlay would have published. See
 * `src/lib/dynamicWalk.ts`.
 *
 * The setup is started once for real, for the reason `passkeyPassportOnHome`
 * gives: the key this Passport is filed under is the DEVICE POINT, and a record
 * seeded under an invented key is a record every call refuses.
 */
async function passkeyPassportAfterTheName(
  browser: import('@playwright/test').Browser,
  options: { recovered?: boolean } = {},
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext(
    walkContextOptions({ viewport: { width: 420, height: 900 } }),
  );
  const page = await context.newPage();
  await installNetworkBoundary(page);
  await serveAccountCustodyState(page, [ACCOUNT_CUSTODY_ADDRESS, PASSPORT_ACCOUNT_ADDRESS]);
  const authenticator = await installVirtualAuthenticator(context, page);
  await page.goto(WALK);
  await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
  await expect(page.getByRole('heading', { name: /Welcome to\s*Passport/ })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Choose my name' }).click();
  await page.getByLabel('Your name').fill('walker');
  await expect(page.getByRole('button', { name: 'Create my Passport' })).toBeEnabled({
    timeout: 120_000,
  });
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

  await seedPasskeyPassport(page, {
    credentialId: identity.credentialId,
    userKey: identity.userKey,
    name: 'walker',
    musd: '250',
  });
  if (options.recovered === true) {
    /* A Passport that already has a way back, written in the shape the app's
       own store writes it — `passport-account-custody-backup:v1`, per account
       and per network. Carried from passport-demo #83 unchanged, so a Passport
       that added one on that road is recognised here. */
    await page.addInitScript(
      ([slot]) => {
        window.localStorage.setItem(
          'passport-account-custody-backup:v1',
          JSON.stringify({ [slot]: { doneAt: 1_800_000_000_000, provider: 'Google' } }),
        );
      },
      [`${identity.userKey.toLowerCase()}|${WALK_NETWORK}`] as const,
    );
  }
  await page.goto(`${WALK}&dynamicwalk=out`);
  return {
    page,
    close: async () => {
      await authenticator.remove();
      await context.close();
    },
  };
}

test.describe('a passkey Passport that has just been named', () => {
  test('is offered a way back, and "Not now" is an answer rather than a delay', async ({
    browser,
  }) => {
    const { page, close } = await passkeyPassportAfterTheName(browser);

    /* THE STEP, BETWEEN THE NAME AND HOME. It is not a card on Home and it is
       not a banner: it is the last screen of onboarding, which is the one
       moment somebody has a Passport worth protecting and has not started
       using it. */
    await expect(page.getByRole('heading', { name: /Add a way\s*back/ })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId('add-recovery')).toHaveText('Add recovery');
    await expect(page.getByText('Google, Microsoft, X, Discord, or email', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('skip-recovery')).toHaveText('Not now');
    await expect(page.locator('.mnrecovery-art img')).toBeVisible();
    await expect(page.locator('.mnrecovery .mnob-foot')).toHaveCount(0);
    await expect(page.locator('#mn-splash')).toHaveCount(0);
    for (const notice of await page.getByRole('button', { name: 'Dismiss notification' }).all()) {
      await notice.click();
    }
    // The same actual recovery screen at phone, tablet, and desktop widths.
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['Light', 'Dark']) {
        await page.getByRole('button', { name: theme, exact: true }).click();
        await expect(page.getByTestId('add-recovery')).toBeInViewport();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        const action = await page.getByTestId('add-recovery').boundingBox();
        expect(action!.height).toBeGreaterThanOrEqual(48);
        await page.screenshot({ path: test.info().outputPath(`recovery-${theme}-${width}.png`), fullPage: true });
      }
    }
    /* Home is behind it and has not been painted. */
    await expect(greeting(page)).toHaveCount(0);

    /* NONE OF THE WORDS A READER HAS NO USE FOR, on the newest screen in the
       flow — which is where vocabulary slips first. */
    const body = (await page.locator('body').innerText()).toLowerCase();
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
      expect(body, `"${forbidden}" is on screen`).not.toContain(forbidden);
    }

    await page.getByTestId('skip-recovery').click();
    await expect(greeting(page)).toBeVisible({ timeout: 60_000 });

    /* AND IT IS NOT ASKED AGAIN. "Not now" that came back on the next open
       would be a nag rather than an answer; the skip is written down exactly as
       a success is, and the next open goes straight to Home. */
    await page.goto(`${WALK}&dynamicwalk=out`);
    await expect(greeting(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('heading', { name: /Add a way\s*back/ })).toHaveCount(0);

    /* What is left is the small entry beside the support link, which is where
       somebody who changed their mind goes looking for it. */
    await expect(page.getByRole('button', { name: 'Add recovery' })).toBeVisible();
    await expect(page.getByTestId('recovery-state')).toHaveCount(0);

    await close();
  });

  test('says the way back is on, and stops offering it, once there is one', async ({
    browser,
  }) => {
    const { page, close } = await passkeyPassportAfterTheName(browser, { recovered: true });

    /* Straight past the step — the answer it asks for is already recorded —
       and Home states the fact in one line beside the account it is about. */
    await expect(greeting(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('heading', { name: /Add a way\s*back/ })).toHaveCount(0);
    await expect(page.getByTestId('recovery-state')).toHaveText('Recovery: on');
    /* A statement, and not a control: there is nothing to press about a thing
       that is done. */
    await expect(page.getByRole('button', { name: 'Add recovery' })).toHaveCount(0);

    await close();
  });

  test('never leaves anybody stuck on the offer, whichever way the add ends', async ({
    browser,
  }) => {
    const { page, close } = await passkeyPassportAfterTheName(browser);
    await expect(page.getByTestId('add-recovery')).toBeVisible({ timeout: 60_000 });

    /* YES. The press opens the provider's overlay — stood in for here — and the
       session it publishes is what the step picks itself back up from. */
    await page.getByTestId('add-recovery').click();

    /* WHERE THIS WALK STOPS, AND WHY THAT IS THE HONEST PLACE. Putting the
       sign-in's key on the account is a real circuit call, and this tier has no
       proving service behind it — the same wall every other write in this suite
       meets. So what is asserted is the property that holds whichever way it
       ends: the reader is never stranded. Either the add lands and Home is
       painted with the way back on it, or it does not and there is ONE plain
       sentence saying the Passport is fine, with the control to Home back
       underneath. A spinner that ran to a ten-minute proof timeout would fail
       this, and that is the defect it exists to catch. */
    const settled = page
      .locator('.mnhome-name, .mnob-unusable-copy')
      .first();
    await expect(settled).toBeVisible({ timeout: 120_000 });

    if ((await page.getByTestId('skip-recovery').count()) > 0) {
      await expect(page.locator('.mnob-unusable-copy')).toHaveCount(1);
      await expect(page.locator('.mnob-unusable-copy')).toContainText('Your Passport is set up');
      await expect(page.getByTestId('skip-recovery')).toBeEnabled();
      await expect(page.getByTestId('skip-recovery')).toHaveText('Continue to my Passport');
      await page.getByTestId('skip-recovery').click();
    }
    await expect(greeting(page)).toBeVisible({ timeout: 60_000 });

    await close();
  });
});


/* -------------------------------------------------------------------------- */
/* A payment never waits for ever, and a reload shows the chain's truth       */
/* (2026/09/22)                                                               */
/* -------------------------------------------------------------------------- */

const NOT_SENT = "That payment didn't go through. Nothing left your Passport.";

/** midnight-js's identifier for a payment a previous session submitted. */
const LOST_TX = `00${'d1'.repeat(32)}`;

/**
 * The store and the stopped-payment record as a tab closed mid-payment leaves
 * them: 10 of 250 mUSD sent, the coin booked as spent, 240 of change filed as
 * arriving — and the chain never recorded the transaction.
 */
function lostPaymentSeed(options: { storeBooking: boolean }) {
  const sentAt = Date.now() - 10 * 60_000;
  const parent = { nonceHex: 'cd'.repeat(32), colorHex: MUSD_COLOUR, value: '250', mtIndex: '12' };
  const change = { nonceHex: 'c4'.repeat(32), colorHex: MUSD_COLOUR, value: '240' };
  const store = {
    [`${WALK_NETWORK}::${ACCOUNT_CUSTODY_ADDRESS}`]: {
      encSecretKeyHex: 'ab'.repeat(32),
      coins: {},
      queued: {},
      spentNonces: [parent.nonceHex],
      mtIndexCandidates: {},
      awaiting: { [MUSD_COLOUR]: [{ ...change, txId: LOST_TX }] },
      unreadChange: {},
      ...(options.storeBooking ? { pendingSpends: [{ txId: LOST_TX, at: sentAt, parent, change }] } : {}),
    },
  };
  const record = {
    [`${WALK_NETWORK}::${ACCOUNT_CUSTODY_ADDRESS}`]: {
      network: WALK_NETWORK,
      accountAddress: ACCOUNT_CUSTODY_ADDRESS,
      stage: 'sending',
      colourHex: MUSD_COLOUR,
      amount: '10',
      recipientLabel: 'iamtester',
      recipientAccountAddress: PASSPORT_ACCOUNT_ADDRESS,
      sendTxId: LOST_TX,
      startedAt: sentAt - 60_000,
      sentAt,
      undo: {
        held: { colour: MUSD_COLOUR, nonce: parent.nonceHex, value: '250', mtIndex: '12' },
        change: { colour: MUSD_COLOUR, nonce: change.nonceHex },
      },
    },
  };
  return async (page: Page): Promise<void> => {
    await page.addInitScript(
      ([seededStore, seededRecord]) => {
        window.localStorage.setItem('passport-k1-coins:v1', JSON.stringify(seededStore));
        window.localStorage.setItem('passport-account-custody-shielded-send:v1', JSON.stringify(seededRecord));
      },
      [store, record] as const,
    );
    /* The chain's answer: no such transaction. */
    await page.route('**/indexer.stagenet.shielded.tools/**', async (route) => {
      const body = route.request().postData() ?? '';
      if (body.includes(LOST_TX)) {
        return route.fulfill({ json: { data: { transactions: [] } } });
      }
      return route.fallback();
    });
  };
}

test.describe('a payment that cannot wait for ever (2026/09/22)', () => {
  test('is answered within the bound when it hangs before anything is proved, and nothing is sent', async ({
    browser,
  }) => {
    const { page, close } = await passkeyPassportOnHome(browser, {
      beforeOpen: async (opening) => {
        await opening.addInitScript(() => {
          (window as unknown as { __passportCustodyBounds?: unknown }).__passportCustodyBounds = {
            prepareWaitMs: 4_000,
            handoverWaitMs: 4_000,
          };
        });
      },
    });
    const proofs: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('prove-account-custody')) proofs.push(request.url());
    });

    await openSend(page);
    await chooseAsset(page, 'mUSD');
    await sendRecipient(page).fill(RESOLVABLE_NAME);
    await sendAmount(page).fill('10');
    await expect(page.getByRole('button', { name: /^Review$/ })).toBeEnabled({ timeout: 30_000 });
    await page.getByRole('button', { name: /^Review$/ }).click();

    /* FROM HERE ON THIS PASSPORT'S OWN ACCOUNT NEVER ANSWERS — the shape of
       the live defect: "Proving and submitting…" with no proof ever asked for. */
    await page.route('**/indexer.stagenet.shielded.tools/**', async (route) => {
      const body = route.request().postData() ?? '';
      if (body.includes('CONTRACT_STATE_QUERY') && body.toLowerCase().includes(ACCOUNT_CUSTODY_ADDRESS)) {
        return new Promise<void>(() => undefined);
      }
      return route.fallback();
    });
    await page.locator('.mnhome-send-primary').click();

    await expect(sendFailure(page).first()).toContainText(NOT_SENT, { timeout: 30_000 });
    expect(proofs).toEqual([]);
    await expect(page.locator('.mnhome-send-primary')).toBeEnabled();

    /* The coin never left the store, and Home says so. */
    await page.locator('.mnhome-send').getByRole('button', { name: 'Close' }).click();
    await expect(assetRow(page, 'mUSD')).toContainText('250');
    const held = await page.evaluate(() => window.localStorage.getItem('passport-k1-coins:v1'));
    expect(held).toContain('"value":"250"');
    expect(held).not.toContain('"spentNonces":["cd');

    await close();
  });

  test('shows the coin back after a reload when the payment it booked never reached the chain', async ({
    browser,
  }) => {
    const { page, close } = await passkeyPassportOnHome(browser, {
      beforeOpen: lostPaymentSeed({ storeBooking: true }),
    });
    await expect(assetRow(page, 'mUSD')).toContainText('250', { timeout: 30_000 });
    await expect(assetRow(page, 'mUSD')).not.toContainText(/Arriving/i);
    await expect(page.getByText(NOT_SENT)).toBeVisible({ timeout: 30_000 });
    await close();
  });

  test('does the same for a payment an earlier build wrote down only on the screen’s record', async ({
    browser,
  }) => {
    const { page, close } = await passkeyPassportOnHome(browser, {
      beforeOpen: lostPaymentSeed({ storeBooking: false }),
    });
    await expect(assetRow(page, 'mUSD')).toContainText('250', { timeout: 30_000 });
    await expect(assetRow(page, 'mUSD')).not.toContainText(/Arriving/i);
    await close();
  });
});

/**
 * Chooses an asset in the Send sheet's picker by its label, whatever order the
 * picker offers them in (the order is the sheet's to change).
 */
async function chooseAsset(page: Page, symbol: string): Promise<void> {
  /* Waited for, as an index-based choice waits: the picker fills from a read. */
  const option = sendPicker(page).locator('option').filter({ hasText: new RegExp(`^\\s*${symbol}\\b`) });
  await expect(option.first()).toBeAttached({ timeout: 30_000 });
  await sendPicker(page).selectOption({ label: ((await option.first().textContent()) ?? '').trim() });
}
