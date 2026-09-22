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
import { installVirtualAuthenticator } from './passkey.js';
import { walkContextOptions } from './walkContext.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The URL that hands the app a stand-in sign-in. See `src/lib/dynamicWalk.ts`. */
const WALK = '/?dynamicwalk=1';

test.describe('a Passport held by a social sign-in', () => {
  test('is offered the road a passkey takes, in the passkey road’s own words', async ({
    browser,
  }) => {
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    /* A device that CAN make a key of its own, which is what the primary offer
       below is conditioned on. Without one the app is right to say so — that
       branch is the last walk in this describe. */
    const authenticator = await installVirtualAuthenticator(context, page);
    await page.goto(WALK);

    /* The kicker is true of the state the reader is in, and names the provider
       they chose rather than the vendor they never did. */
    await expect(page.getByText('Signed in with Google')).toBeVisible();

    /* THE SAME HEADING, THE SAME BUTTON, AND THE SAME SENTENCE ABOUT WHO PAYS
       as the passkey road. Between 09/16 and 09/21 this screen made a Passport
       whose only key was the sign-in — nothing on any device — and that shape
       is retired. For one night what replaced it offered nothing but "I already
       have a Passport", which turned the commonest way in into a dead end. What
       is offered now is the passkey road: the key is made here, the sign-in
       becomes the spare. */
    await expect(page.getByRole('heading', { name: /Set up\s*your Passport/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create my Passport' })).toBeEnabled();
    await expect(
      page.getByText('Setting your Passport up is paid for on your behalf.'),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'I already have a Passport' }),
    ).toBeVisible();

    /* And the lede says the two things a reader would otherwise have to infer:
       where the Passport will be held, and what the sign-in is now for. The
       sentence it replaces — "your sign-in is all Passport needs" — was true of
       the shape that was retired and of nothing since. */
    await expect(page.getByText(/make a key on this device/)).toBeVisible();
    await expect(page.getByText(/Your Google sign-in becomes your way back/)).toBeVisible();
    await expect(page.getByText('is all Passport needs')).toHaveCount(0);

    /* The sentence this whole path exists to delete. Until 2026/09/16 a social
       sign-in ended on the welcome screen, being told to go and make a passkey. */
    await expect(page.getByText('Finish with your passkey above')).toHaveCount(0);

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
      'dynamic',
    ]) {
      expect(body, `"${forbidden}" is on screen`).not.toContain(forbidden);
    }

    await authenticator.remove();
    await context.close();
  });

  test('starts the setup itself on one press, with no second button to find', async ({
    browser,
  }) => {
    /* ONE PRESS AND ONE ROAD. Making the key on this device REPLACES this
       screen — a device key wins the identity question the moment it exists —
       so without the press being written down first the reader would land on
       the ordinary setup screen and be offered the same button again. What this
       asserts is that they are not: the press carries through, and what comes
       next is the counted setup the passkey road shows. */
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    const authenticator = await installVirtualAuthenticator(context, page);
    test.setTimeout(240_000);
    await page.goto(WALK);

    await page.getByRole('button', { name: 'Create my Passport' }).click();

    /* The key is made on this device, and the press is remembered across the
       screen it replaces. */
    await expect
      .poll(
        () => page.evaluate(() => window.localStorage.getItem('passport-last-passkey')),
        { timeout: 120_000 },
      )
      .not.toBeNull();
    const intent = await page.evaluate(() =>
      window.localStorage.getItem('passport-account-custody-backup-intent:v1'),
    );
    expect(intent, 'the press is written down before the ceremony').toContain('stagenet');

    await authenticator.remove();
    await context.close();
  });

  test('offers coming back by name, and says a name alone is not enough', async ({ browser }) => {
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    const authenticator = await installVirtualAuthenticator(context, page);
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
    await expect(page.getByRole('heading', { name: /Set up\s*your Passport/ })).toBeVisible();

    await authenticator.remove();
    await context.close();
  });

  test('is told plainly when the browser itself cannot make a key', async ({ browser }) => {
    /* The branch the dead end used to be shown to EVERYBODY. The only definite
       no is a browser with no WebAuthn at all — a desktop with no built-in
       authenticator still makes a key through a security key or the phone
       beside it — so that is what this walk removes, and the sentence is then
       true, which is the whole of the rule: shown where it is true and nowhere
       else. */
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    await page.addInitScript(() => {
      Reflect.deleteProperty(window, 'PublicKeyCredential');
    });
    await page.goto(WALK);

    await expect(page.getByRole('heading', { name: /Bring your\s*Passport here/ })).toBeVisible();
    await expect(page.getByText(/use a device that can make a key of its own/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create my Passport' })).toHaveCount(0);
    /* And the way back is still there, as the only thing on offer. */
    await expect(
      page.getByRole('button', { name: 'I already have a Passport' }),
    ).toBeEnabled();

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
  test('shows what it holds in mUSD as well as in NIGHT', async ({ browser }) => {
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

    await expect(page.getByRole('heading', { name: 'walker.night' })).toBeVisible();

    /* THE ROW THIS WHOLE PR IS ABOUT. Forty of them, named, beside the NIGHT
       figure — and read out of the store, which is where a delivery's
       description lands. */
    const holding = page.locator('.mndyn-holding');
    await expect(holding).toHaveCount(1);
    await expect(holding.locator('.mndyn-holding-figure')).toHaveText('40');
    await expect(holding.locator('.mndyn-holding-unit')).toHaveText('mUSD');

    /* And the sentence that stood where the row is now. */
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body).not.toContain('not built yet');

    /* The copy rule, on the screen that shows money. */
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

    await page.getByLabel('Send to').fill(RESOLVABLE_NAME);
    await page.getByLabel('What to send').selectOption({ label: 'mUSD' });
    await page.getByLabel('Amount').fill('10');
    await page.getByRole('button', { name: /^Send/ }).click();

    /* ONE SENTENCE, AND THE CONTROL BACK. Where this run stops is worth being
       exact about: the account it is driving is a REAL one, and its device set
       holds the key the gate run enrolled rather than this walk's stand-in, so
       the refusal is the account's own — "this key is not one of the keys that
       can approve for this Passport". That is a refusal a person can genuinely
       meet, and it lands after the payment has been planned in full: the coin
       chosen out of the store, the recipient read off the chain as one of these
       accounts, the amount checked against what one payment can draw on. What
       is asserted here is the property that holds whatever the refusal is —
       one plain sentence, the control back, and the money accounted for. */
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 60_000 });
    const sentence = (await alert.innerText()).trim();
    expect(sentence.split('\n').filter((line) => line.trim().length > 0)).toHaveLength(2);
    expect(sentence).not.toContain('not built yet');
    await expect(page.getByRole('button', { name: /^Send/ })).toBeEnabled();

    /* AND THE PASSPORT SAYS WHERE THE MONEY IS. The payment was written down
       before anything went out, and a run that stopped before the withdrawal
       reports exactly that — the sentence comes from the record, through
       storage, which is what makes a closed tab survivable. */
    await expect(
      page.getByText('Nothing was sent, and it is all still in your Passport.'),
    ).toBeVisible();
    await expect(page.locator('.mndyn-holding-figure')).toHaveText('40');

    await context.close();
  });

  /* A5, 2026/09/18. This used to assert that the NIGHT payment ran the same
     course as every other one. It no longer runs at all, on either arm: the
     second of its two legs paid the recipient from this Passport's OWN wallet,
     so the value left the account into a wallet the app builds and a tab closed
     between the legs left somebody's money where neither party owned it. That
     is the route the shielded send had taken out of it, and it is now out of
     this one too — refused before the name is resolved and before anything is
     signed, in the sentence the passkey arm already showed. */
  test('refuses a NIGHT payment on this arm too, in the same sentence', async ({
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

    await page.getByLabel('Send to').fill(RESOLVABLE_NAME);
    await page.getByLabel('What to send').selectOption({ label: 'NIGHT' });
    await page.getByLabel('Amount').fill('0.5');
    await page.getByRole('button', { name: /^Send/ }).click();

    await expect(
      page.getByText('Paying somebody from this Passport is coming. Everything else here works.'),
    ).toBeVisible({ timeout: 60_000 });
    /* AND THE OLD SENTENCE IS STILL GONE: this is a route that is not offered,
       not a Passport of this kind being told it cannot pay anybody. The
       shielded send above is what works, on the same screen. */
    const sentence = (await page.getByRole('alert').innerText()).trim();
    expect(sentence).not.toContain('not built yet');
    /* NOTHING WENT OUT, so no payment is written down and the control comes
       back. */
    await expect(
      page.getByText('Nothing was sent, and it is all still in your Passport.'),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Send/ })).toBeEnabled();

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

    const holding = page.locator('.mndyn-holding');
    await expect(holding.locator('.mndyn-holding-figure')).toHaveText('30');

    /* THE RELOAD IS THE ASSERTION. The change coin's description exists
       nowhere but in this browser, and the inbox walk that runs on every open
       re-reads the entry that described the coin the spend consumed — so a
       reload is where a build that let that walk win puts the spent hundred
       back over the thirty of change. */
    await page.reload();
    await expect(page.getByRole('heading', { name: 'walker.night' })).toBeVisible();
    await expect(holding.locator('.mndyn-holding-figure')).toHaveText('30');
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('100');

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
    const offer = page.locator('.mnob-unusable');
    await expect(offer).toBeVisible();
    await expect(offer).toContainText('was sent as one payment');
    await expect(offer).toContainText('Your balance below says which.');
    await expect(page.getByRole('button', { name: 'Finish this payment' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Dismiss' })).toBeVisible();

    /* And the sentence points at a balance that is really on the screen
       beside it — the sentence is only the truth if the figure is there. */
    await expect(page.locator('.mndyn-holding-figure')).toHaveText('30');

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
    await expect(page.getByRole('heading', { name: 'walker.night' })).toBeVisible();
    await expect(page.locator('.mnob-unusable')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Finish this payment' })).toHaveCount(0);

    await context.close();
  });
});
