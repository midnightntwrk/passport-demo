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
  RESOLVABLE_NAME,
  installNetworkBoundary,
} from './mocks.js';
import { installVirtualAuthenticator } from './passkey.js';
import { SIGN_IN_BUTTON, walkContextOptions } from './walkContext.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The URL that puts this tab on the account custody route. */
const WALK = '/?accwalk=1';

const WALK_NETWORK = 'stagenet';

/** The demo stablecoin's colour, as `src/lib/colour.ts` knows it. */
const MUSD_COLOUR = '1a2917fbed8b5ce44d12ebc7d337689045f6c96a6bbd39cf3d8691ab310ef6a6';

/**
 * A real account on the account custody build, recorded off stagenet, and the
 * two recordings midnight-js wants before it will open a connection to it.
 *
 * Shared with `dynamic-only.spec.ts` deliberately: the account is the same
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
 * for the reason `dynamic-only.spec.ts` gives: the walk's point is that the
 * SHIPPED reader reads what a previous session left behind.
 */
async function seedPasskeyPassport(
  page: Page,
  options: { credentialId: string; userKey: string; name: string; musd: string },
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
    activated: true,
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
      window.localStorage.setItem(
        'passport-account-custody-name:v1',
        JSON.stringify({ [recordKey]: seededName }),
      );
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

    /* AND THEN THE NEW SCREEN, not "Welcome to Passport" and not "Choose your
       name". This is the routing claim: a passkey with no account of its own
       makes its next Passport on the account custody contract. */
    await expect(page.getByRole('heading', { name: /Set up\s*your Passport/ })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole('button', { name: 'Create my Passport' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Choose my name' })).toHaveCount(0);

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

    await context.close();
  });

  test('counts the setup steps, and asks the sponsor to pay for the first one', async ({
    browser,
  }) => {
    /* Building wave 1 is real work — the compiled module, the ledger WASM, and
       a deploy transaction — and on the shared CI runner it took longer than
       this file's default 90 s (2026/09/21), so the poll below never got to
       see the sponsor asked. The budget covers the poll it contains. */
    test.setTimeout(240_000);
    /* The first wave is a DEPLOY of the account custody build, which needs
       that build's verifier keys staged under /zk/account-custody. They are
       compiler output, gitignored, and no CI runner carries them (the ZK
       bundle pinned for CI holds the prototype modules only), so on such a
       build the setup cannot even be constructed and this walk would assert
       nothing true. It is skipped there, with the reason on record; the live
       run on stagenet (RUN-onboard.md) is where this flow is proven. */
    const probe = await page.request.get(
      new URL('/zk/account-custody/keys/activate_initial_device_with_jubjub.verifier', WALK).href,
    );
    test.skip(
      !probe.ok(),
      'this build carries no account-custody verifier keys, so wave 1 cannot be built here',
    );
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    const network = await installNetworkBoundary(page);
    await installVirtualAuthenticator(context, page);
    await page.goto(WALK);
    await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
    await expect(page.getByRole('button', { name: 'Create my Passport' })).toBeEnabled({
      timeout: 60_000,
    });

    const before = network.sponsorTraffic().requests;
    await page.getByRole('button', { name: 'Create my Passport' }).click();

    /* The count line while it works. It is the SAME three steps as the other
       arm — set the Passport up, finish it, turn the key on — even though a
       jubjub-born account is four transactions rather than three, because the
       middle ones are one thing to the person waiting. */
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
      .poll(() => network.sponsorTraffic().requests, { timeout: 120_000 })
      .toBeGreaterThan(before);

    /* And whatever the screen ends up saying, it is not a stack. */
    const shown = await page.locator('body').innerText();
    expect(shown.toLowerCase()).not.toContain('error:');
    expect(shown.toLowerCase()).not.toContain('undefined');

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
    await expect(page.getByRole('heading', { name: /Set up\s*your Passport/ })).toBeVisible({
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
    await expect(page.getByRole('heading', { name: 'walker.night' })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole('button', { name: SIGN_IN_BUTTON })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create my Passport' })).toHaveCount(0);
    /* What it has been paid, read out of the store the shipped reader reads. */
    await expect(page.getByText('250')).toBeVisible();
    /* And it is named by the device, not by a sign-in. */
    await expect(page.getByText('Held on this device')).toBeVisible();

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

    await page.getByRole('button', { name: 'Go back' }).click();
    await expect(page.getByRole('button', { name: 'Create my Passport' })).toBeVisible();

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
async function passkeyPassportOnHome(browser: import('@playwright/test').Browser): Promise<{
  page: Page;
  close: () => Promise<void>;
}> {
  const context = await browser.newContext(
    walkContextOptions({ viewport: { width: 420, height: 900 } }),
  );
  const page = await context.newPage();
  await installNetworkBoundary(page);
  await serveAccountCustodyState(page, [ACCOUNT_CUSTODY_ADDRESS, PASSPORT_ACCOUNT_ADDRESS]);
  const authenticator = await installVirtualAuthenticator(context, page);
  await page.goto(WALK);
  await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
  await expect(page.getByRole('heading', { name: /Set up\s*your Passport/ })).toBeVisible({
    timeout: 60_000,
  });

  /* THE KEY THIS PASSPORT IS REALLY FILED UNDER, and it cannot be invented.
     A passkey Passport is keyed by its DEVICE POINT, which is derived from the
     authenticator — so a record seeded under a made-up key is a record Home
     will show (Home reads the pointer) and every payment will refuse, because
     a payment settles the identity first and then looks the record up under
     it. The two walks below are about payments, so the setup is started once
     purely to make the app derive and record the point, and the record is then
     seeded under the point it derived. */
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
  await page.goto(WALK);
  await expect(page.getByRole('heading', { name: 'walker.night' })).toBeVisible({
    timeout: 60_000,
  });
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

    await page.getByLabel('What to send').selectOption({ label: 'mUSD' });

    /* NOTHING TO SAY YET. The field decides which transaction gets built, so
       there is nothing to disclose until somebody has typed into it. */
    await expect(page.locator('.mnob-disclosure')).toHaveCount(0);

    /* A NAME IS THE DIRECT TRANSFER: one transaction carrying a call on each
       account, so the chain records that the two of them transacted. That is
       the per-payment choice of MIP-0012 §6.6 and it is said at the field that
       makes it. */
    await page.getByLabel('Send to').fill(RESOLVABLE_NAME);
    await expect(
      page.getByText('Both Passports are named on chain for this payment.'),
    ).toBeVisible();

    /* THE SAME MONEY THE OTHER WAY NAMES NOBODY. */
    await page.getByLabel('Send to').fill(THROWAWAY_ADDRESS);
    await expect(
      page.getByText('This payment names neither Passport on chain.'),
    ).toBeVisible();

    /* And it is about the shielded route only: the account's NIGHT moves by a
       different pair of legs and this sentence would describe the wrong one. */
    await page.getByLabel('What to send').selectOption({ label: 'NIGHT' });
    await expect(page.locator('.mnob-disclosure')).toHaveCount(0);

    await close();
  });

  test('plans a payment to a name and stops where every payment stops', async ({ browser }) => {
    const { page, close } = await passkeyPassportOnHome(browser);

    await page.getByLabel('Send to').fill(RESOLVABLE_NAME);
    await page.getByLabel('What to send').selectOption({ label: 'mUSD' });
    await page.getByLabel('Amount').fill('10');
    await page.getByRole('button', { name: /^Send/ }).click();

    /* ONE SENTENCE, AND THE CONTROL BACK. There is no proving service behind
       this tier, so the payment is planned in full — the coin chosen out of
       the store, the recipient read off the chain as one of these accounts,
       the amount checked against what one payment can draw on — and then
       stops. What is held is the property that holds whatever the refusal is,
       exactly as the k256 walk next door holds it. */
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 60_000 });
    const sentence = (await alert.innerText()).trim();
    expect(sentence).not.toContain('not built yet');
    expect(sentence).not.toContain('Paying somebody from this Passport is coming');
    await expect(page.getByRole('button', { name: /^Send/ })).toBeEnabled();

    /* AND THE PASSPORT SAYS WHERE THE MONEY IS: nothing went out, and the
       figure it started with is the figure it still holds. */
    await expect(
      page.getByText('Nothing was sent, and it is all still in your Passport.'),
    ).toBeVisible();
    await expect(page.locator('.mndyn-holding-figure')).toHaveText('250');

    await close();
  });

  test('plans a payment to a shielded address and stops the same way', async ({ browser }) => {
    const { page, close } = await passkeyPassportOnHome(browser);

    await page.getByLabel('Send to').fill(THROWAWAY_ADDRESS);
    await page.getByLabel('What to send').selectOption({ label: 'mUSD' });
    await page.getByLabel('Amount').fill('5');
    await page.getByRole('button', { name: /^Send/ }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 60_000 });
    const sentence = (await alert.innerText()).trim();
    expect(sentence).not.toContain('not built yet');
    expect(sentence).not.toContain('Paying somebody from this Passport is coming');
    await expect(page.getByRole('button', { name: /^Send/ })).toBeEnabled();
    await expect(page.locator('.mndyn-holding-figure')).toHaveText('250');

    await close();
  });

  /* A7, 2026/09/18. The decode of a pasted address is also the check that it
     belongs to this network, and it used to run AFTER the stopped-send record
     was written and after the approval. So an address this Passport cannot pay
     cost a touch of the authenticator and left a card on Home saying a payment
     was in flight — for a payment that was never built. The check asks nothing
     of anybody and can only refuse, so it goes first. */
  test('refuses an address it cannot pay without writing a payment down', async ({ browser }) => {
    const { page, close } = await passkeyPassportOnHome(browser);

    /* Shaped like an address the field will accept and take the address door
       for, and not one this Passport can pay. */
    await page.getByLabel('Send to').fill('mn_shield-addr_stagenet1qqqqqqqqqqqqqqqqqqq');
    await page.getByLabel('What to send').selectOption({ label: 'mUSD' });
    await page.getByLabel('Amount').fill('5');
    await page.getByRole('button', { name: /^Send/ }).click();

    await expect(page.getByRole('alert')).toBeVisible({ timeout: 60_000 });
    /* AND NO PAYMENT WAS WRITTEN DOWN. The card below is what a stopped
       payment puts on Home, and nothing here was ever in flight. */
    await expect(
      page.getByText('Nothing was sent, and it is all still in your Passport.'),
    ).toHaveCount(0);
    await expect(page.locator('.mndyn-holding-figure')).toHaveText('250');
    await expect(page.getByRole('button', { name: /^Send/ })).toBeEnabled();

    await close();
  });

  test('refuses the account’s NIGHT in one sentence, and says the rest works', async ({
    browser,
  }) => {
    const { page, close } = await passkeyPassportOnHome(browser);

    await page.getByLabel('Send to').fill(RESOLVABLE_NAME);
    await page.getByLabel('What to send').selectOption({ label: 'NIGHT' });
    await page.getByLabel('Amount').fill('0.5');
    await page.getByRole('button', { name: /^Send/ }).click();

    /* THE ONE THING STILL COMING, and it is the ROUTE rather than the arm: the
       account's NIGHT still moves in two legs, the second of which goes through
       this Passport's own wallet. Everything else on this screen works, which
       is why the sentence can say so. */
    await expect(
      page.getByText('Paying somebody from this Passport is coming. Everything else here works.'),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: /^Send/ })).toBeEnabled();

    await close();
  });
});
