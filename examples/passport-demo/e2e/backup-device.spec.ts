/**
 * THE SPARE KEY, walked — the offer on a Passport that has one to make, and the
 * way back on a device that has none.
 *
 * WHAT THE DECISION OF 2026/09/21 IS
 * ----------------------------------
 * The key on the device is the Passport and stays the Passport: it is what
 * approves every payment. A social sign-in is a SPARE key added to it, offered
 * once the Passport is finished and named, optional, and asked for again a day
 * after it is put away. On a new device that spare key is what brings the
 * Passport back — it proves the account is yours, a new key is made here, and
 * the sign-in authorises adding it.
 *
 * WHAT IS REAL IN THESE RUNS
 * --------------------------
 * The shipped bundle on `vite preview`, behind `mocks.ts`. Two seams are
 * replaced and only two: the AUTHENTICATOR (a CDP virtual one, as every walk in
 * this suite uses) and the VENDOR (`src/lib/dynamicWalk.ts`, which publishes a
 * signed-in session into the same store Dynamic's own bridge writes to, with a
 * real secp256k1 signer behind it). Everything between them is the shipped
 * code: which Passport the app chooses, which screen it renders, what the copy
 * says, and what is written to storage.
 *
 * WHERE THEY STOP, AND WHY THAT IS HONEST
 * ---------------------------------------
 * Adding a device is a gated call on the account custody contract, so it needs
 * `POST /prove-account-custody` on the balancer and that build's artefacts
 * under `/zk`. Neither is here. So the walks assert what a box can establish —
 * the offer, its words, the dismissal and its clock, the step an interrupted
 * recovery comes back to, and the refusal being ONE plain sentence with the
 * control back — and the chain half is the live run's to prove. That split is
 * the same one `dynamic-only.spec.ts` and `passkey-custody.spec.ts` make, for
 * the same reason.
 *
 * WHAT THEY DO NOT TOUCH
 * ----------------------
 * Only the specs that pass `?dynamicwalk=` see a sign-in at all. Every other
 * spec runs against a build whose sign-in seam reports `disabled`, which is
 * what every deployed build reports and what these paths therefore never reach
 * there.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { RESOLVABLE_NAME, installNetworkBoundary } from './mocks.js';
import { installVirtualAuthenticator } from './passkey.js';
import { SIGN_IN_BUTTON, walkContextOptions } from './walkContext.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** A tab on the account custody route, with a stand-in sign-in available. */
const WALK = '/?accwalk=1&dynamicwalk=1';
/** The same, with no sign-in at all — the shape every deployed build has. */
const WALK_NO_SOCIAL = '/?accwalk=1';
/** A tab with a sign-in and no key on the device: the way back on a new phone. */
const WALK_SOCIAL_ONLY = '/?dynamicwalk=1';

const WALK_NETWORK = 'stagenet';
const MUSD_COLOUR = '1a2917fbed8b5ce44d12ebc7d337689045f6c96a6bbd39cf3d8691ab310ef6a6';

/* The same recordings the other two custody specs use, of the same real
   stagenet account. Shared deliberately: the account is the same whichever arm
   holds it, which is the claim the whole adapter rests on. */
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

async function serveAccountCustodyState(page: Page): Promise<void> {
  await page.route('**/indexer.stagenet.shielded.tools/**', async (route) => {
    const body = route.request().postData() ?? '';
    const asked = (/"address":"([0-9a-fA-F]+)"/.exec(body)?.[1] ?? '').toLowerCase();
    if (asked !== ACCOUNT_CUSTODY_ADDRESS) return route.fallback();
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
 * A passkey that already holds a finished, named Passport — and whatever this
 * browser has recorded about its spare key.
 *
 * Every shape is spelled out rather than imported, which is the convention of
 * the two specs next door and the point of seeding at all: what the walk puts
 * in storage is what a real previous session would have put there, so a change
 * to any of these formats fails a spec rather than quietly rendering an empty
 * Passport.
 */
async function seedPasskeyPassport(
  page: Page,
  options: {
    credentialId: string;
    userKey: string;
    name: string;
    /** `passport-account-custody-backup:v1`, or nothing recorded at all. */
    backup?: Record<string, unknown>;
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
          value: '250',
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
    ([recordKey, seededRecord, seededName, seededStore, pointerKey, seededUser, seededBackup]) => {
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
        JSON.stringify({ [pointerKey as string]: seededUser }),
      );
      if (seededBackup) {
        window.localStorage.setItem(
          'passport-account-custody-backup:v1',
          JSON.stringify(seededBackup),
        );
      }
    },
    [
      key,
      record,
      options.name,
      store,
      `${options.credentialId}|${WALK_NETWORK}`,
      options.userKey,
      options.backup ?? null,
    ] as const,
  );
}

/**
 * Makes a passkey on this device, and hands back the credential the app
 * recorded for it.
 *
 * IT OPENS THE TAB WITHOUT A SIGN-IN, and that is not a detail. A signed-in
 * session with no key on the device IS a Passport-shaped state — the way back
 * on a new phone — so the welcome screen and its one button are not what such a
 * tab renders. A walk that needs a key on the device therefore makes one first
 * and brings the sign-in in afterwards, which is also the order a person does
 * it in: the key comes first and the spare comes later.
 */
async function signInAndReadCredential(page: Page): Promise<string> {
  await page.goto(WALK_NO_SOCIAL);
  await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
  await expect(page.getByRole('heading', { name: /Set up\s*your Passport/ })).toBeVisible({
    timeout: 60_000,
  });
  const credentialId = await page.evaluate(() =>
    window.localStorage.getItem('passport-last-passkey'),
  );
  expect(credentialId, 'the app records the credential it enrolled').not.toBeNull();
  return credentialId as string;
}

/* -------------------------------------------------------------------------- */
/* The offer                                                                  */
/* -------------------------------------------------------------------------- */

test.describe('a Passport with no spare key', () => {
  test('is offered one, and told what a new device will not bring back', async ({ browser }) => {
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    await serveAccountCustodyState(page);
    const authenticator = await installVirtualAuthenticator(context, page);

    const credentialId = await signInAndReadCredential(page);
    await seedPasskeyPassport(page, {
      credentialId,
      userKey: 'jubjub:2a1f',
      name: 'walker',
      backup: {},
    });
    await page.goto(WALK);

    await expect(page.getByRole('heading', { name: 'walker.night' })).toBeVisible({
      timeout: 60_000,
    });

    /* THE OFFER. One card, and the two sentences that are true about it: what
       it is for, and what it does not cover. */
    await expect(page.getByRole('heading', { name: 'Back up your Passport' })).toBeVisible();
    await expect(page.getByText(/opens on this device and nowhere else/)).toBeVisible();
    await expect(page.getByText(/Tokens you were sent before will still be/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add a second way in' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Not now' })).toBeVisible();

    /* It names the providers a reader chose and never the vendor behind them,
       and none of the machinery — the rule this screen keeps everywhere. */
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body).toContain('google');
    for (const forbidden of [
      'dynamic',
      'contract',
      'registry',
      'indexer',
      'resolver',
      'sponsor',
      'dust',
      'wallet address',
      'sdk',
      'passkey',
    ]) {
      expect(body, `"${forbidden}" is on screen`).not.toContain(forbidden);
    }

    await authenticator.remove();
    await context.close();
  });

  test('is offered nothing at all in a build that has no other way in', async ({ browser }) => {
    /* Every deployed build, and the property that keeps this whole slice out of
       them: the card is not hidden by a flag inside itself, it is not rendered,
       because there is no sign-in for it to offer. */
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    await serveAccountCustodyState(page);
    const authenticator = await installVirtualAuthenticator(context, page);

    const credentialId = await signInAndReadCredential(page);
    await seedPasskeyPassport(page, { credentialId, userKey: 'jubjub:2a1f', name: 'walker' });
    await page.goto(WALK_NO_SOCIAL);

    await expect(page.getByRole('heading', { name: 'walker.night' })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole('heading', { name: 'Back up your Passport' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add a second way in' })).toHaveCount(0);

    await authenticator.remove();
    await context.close();
  });
});

/* -------------------------------------------------------------------------- */
/* Optional, and nagged                                                       */
/* -------------------------------------------------------------------------- */

test.describe('putting the offer away', () => {
  test('is honoured now, and the offer comes back a day later', async ({ browser }) => {
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    await serveAccountCustodyState(page);
    const authenticator = await installVirtualAuthenticator(context, page);

    const credentialId = await signInAndReadCredential(page);
    await seedPasskeyPassport(page, {
      credentialId,
      userKey: 'jubjub:2a1f',
      name: 'walker',
      backup: {},
    });
    await page.goto(WALK);

    await expect(page.getByRole('button', { name: 'Not now' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Not now' }).click();

    /* Gone, and gone from STORAGE — which is what makes it gone on the next
       open too, rather than until the next render. */
    await expect(page.getByRole('heading', { name: 'Back up your Passport' })).toHaveCount(0);
    const written = await page.evaluate(() =>
      window.localStorage.getItem('passport-account-custody-backup:v1'),
    );
    expect(written, 'the dismissal is written down').toContain('dismissedAt');

    /* And a day later it is asked for again. The clock is not something a walk
       can move, so what is seeded is a dismissal from yesterday — which is the
       same record the press above writes, dated. */
    await seedPasskeyPassport(page, {
      credentialId,
      userKey: 'jubjub:2a1f',
      name: 'walker',
      backup: { 'jubjub:2a1f|stagenet': { dismissedAt: Date.now() - 2 * 24 * 60 * 60 * 1000 } },
    });
    await page.goto(WALK);

    await expect(page.getByRole('heading', { name: 'Back up your Passport' })).toBeVisible({
      timeout: 60_000,
    });

    await authenticator.remove();
    await context.close();
  });

  test('never comes back once the spare key is really there', async ({ browser }) => {
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    await serveAccountCustodyState(page);
    const authenticator = await installVirtualAuthenticator(context, page);

    const credentialId = await signInAndReadCredential(page);
    await seedPasskeyPassport(page, {
      credentialId,
      userKey: 'jubjub:2a1f',
      name: 'walker',
      backup: {
        'jubjub:2a1f|stagenet': { doneAt: Date.now() - 60_000, provider: 'Google' },
      },
    });
    await page.goto(WALK);

    await expect(page.getByRole('heading', { name: 'walker.night' })).toBeVisible({
      timeout: 60_000,
    });
    /* One line, naming the provider the reader chose, and no button. */
    await expect(page.getByText('Your Passport has a second way in, with Google.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add a second way in' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Not now' })).toHaveCount(0);

    await authenticator.remove();
    await context.close();
  });
});

/* -------------------------------------------------------------------------- */
/* Asking for one                                                             */
/* -------------------------------------------------------------------------- */

test.describe('asking for a spare key', () => {
  test('stops at the service that is not there, in one sentence, with the control back', async ({
    browser,
  }) => {
    /* The chain half of this needs `POST /prove-account-custody` and that
       build's artefacts under `/zk`, neither of which is here. What the walk
       therefore asserts is the property that holds whichever wall is met
       first, and it is the one that matters most about a service that is not
       there: ONE plain sentence, and the button comes back — not a spinner
       that runs until a proof timeout ten minutes later. */
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    await serveAccountCustodyState(page);
    const authenticator = await installVirtualAuthenticator(context, page);
    test.setTimeout(180_000);

    const credentialId = await signInAndReadCredential(page);
    await seedPasskeyPassport(page, {
      credentialId,
      userKey: 'jubjub:2a1f',
      name: 'walker',
      backup: {},
    });
    await page.goto(WALK);

    await expect(page.getByRole('button', { name: 'Add a second way in' })).toBeEnabled({
      timeout: 60_000,
    });
    await page.getByRole('button', { name: 'Add a second way in' }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 120_000 });
    const sentence = (await alert.innerText()).trim();
    expect(sentence.split('\n').filter((line) => line.trim().length > 0)).toHaveLength(1);
    expect(sentence.toLowerCase()).not.toContain('error:');
    expect(sentence.toLowerCase()).not.toContain('undefined');

    /* And nothing was recorded. A Passport is backed up when the chain says so
       and not when a button was pressed. */
    const written = await page.evaluate(() =>
      window.localStorage.getItem('passport-account-custody-backup:v1'),
    );
    expect(written ?? '').not.toContain('doneAt');

    await authenticator.remove();
    await context.close();
  });
});

/* -------------------------------------------------------------------------- */
/* Coming back on a new device                                                */
/* -------------------------------------------------------------------------- */

test.describe('a device with no key on it', () => {
  test('is offered the way back by name, and nothing to create', async ({ browser }) => {
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    await page.goto(WALK_SOCIAL_ONLY);

    await expect(page.getByRole('heading', { name: /Bring your\s*Passport here/ })).toBeVisible();
    await page.getByRole('button', { name: 'I already have a Passport' }).click();

    await expect(page.getByRole('heading', { name: /Find it\s*by its name/ })).toBeVisible();
    await expect(page.getByText('Knowing the name is not enough on its own.')).toBeVisible();

    /* A name that RESOLVES but whose Passport does not hold this sign-in's key.
       The answer is the same one it gives for a Passport of the other kind, and
       deliberately so: saying which of the two it was would be telling somebody
       about an account that is not theirs. */
    await page.getByLabel('Your name').fill(RESOLVABLE_NAME);
    await page.getByRole('button', { name: 'Find my Passport' }).click();

    const answer = page.getByRole('alert');
    await expect(answer).toBeVisible({ timeout: 120_000 });
    const sentence = (await answer.innerText()).trim();
    expect(sentence.split('\n').filter((line) => line.trim().length > 0)).toHaveLength(1);
    /* Whatever it says, it does not offer to make a Passport instead. */
    const controls = await page.getByRole('button').allInnerTexts();
    for (const label of controls) expect(label.toLowerCase()).not.toContain('create');

    await context.close();
  });

  test('comes back to the step an interrupted recovery was on', async ({ browser }) => {
    /* The hand-off is the whole reason coming back works at all: making a key
       on this device replaces the screen that found the Passport, so what is in
       storage is what the second half reads. Seeded here — which is exactly
       what the first half writes — so the step it produces is walked without a
       chain. */
    const context = await browser.newContext(
      walkContextOptions({ viewport: { width: 420, height: 900 } }),
    );
    const page = await context.newPage();
    await installNetworkBoundary(page);
    await page.addInitScript(
      ([address]) => {
        window.localStorage.setItem(
          'passport-account-custody-adopt:v1',
          JSON.stringify({
            network: 'stagenet',
            address,
            name: 'walker',
            socialUser: '0x00a329c0648769a73afac7f9381e08fb43dbea72',
          }),
        );
      },
      [ACCOUNT_CUSTODY_ADDRESS] as const,
    );
    await page.goto(WALK_SOCIAL_ONLY);

    await expect(page.getByRole('heading', { name: 'Bring your Passport here' })).toBeVisible();
    await expect(page.getByText('walker.night is yours.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Make a key on this device' })).toBeEnabled();

    /* AND THE ONE HONEST SENTENCE ABOUT WHAT DOES NOT COME BACK. It is on the
       screen that brings the rest back, before the press, rather than
       discovered afterwards as an empty list of tokens. */
    await expect(page.getByText(/stay listed on your other device/)).toBeVisible();

    /* Giving up clears it, so the next open is not this screen again. */
    await page.getByRole('button', { name: 'Go back' }).click();
    await expect(page.getByRole('heading', { name: /Bring your\s*Passport here/ })).toBeVisible();
    const held = await page.evaluate(() =>
      window.localStorage.getItem('passport-account-custody-adopt:v1'),
    );
    expect(held).toBeNull();

    await context.close();
  });
});
