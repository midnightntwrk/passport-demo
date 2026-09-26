/**
 * COMING BACK ON A NEW DEVICE, walked from an EMPTY browser to Home.
 *
 * THE DEFECT THIS FILE EXISTS FOR (live, 2026/09/26)
 * --------------------------------------------------
 * A Passport made in one incognito window, with Google added as its way back,
 * was recovered in a fresh one: the sign-in worked, the name was found, a key
 * was made on the new device — and the screen said "Adding this device to …"
 * for ever. Nothing reached the prover. The add is a call the SIGN-IN makes,
 * and every such call reads its signer's record on this device first; a new
 * device has none, so it refused before asking for a signature, and the screen
 * had nowhere to say so.
 *
 * Every walk of this road until today stopped short of that line: the one in
 * `provider-recovery.spec.ts` stops at the name check (the recorded account's
 * device set holds the gate run's key, not this build's stand-in signer), and
 * the recovered-device walks there SEED the state the recovery would have
 * left. So none of them ever ran the second half on a browser that held
 * nothing — which is the only browser this road is for.
 *
 * WHAT IS REAL IN THIS RUN
 * ------------------------
 * The shipped preview build, from a context with nothing in its storage: the
 * landing, the provider sign-in (the stand-in of `src/lib/dynamicWalk.ts`,
 * whose signatures are real secp256k1 ones), the name resolved through the real
 * Midnames module, the check against the account's device set, the passkey
 * made on this device (a CDP virtual authenticator with PRF), and the whole of
 * `adoptDeviceKey` — the records it writes and the guards that read them, the
 * account opened against its real recorded deploy with its verifier keys
 * checked, the account's state decoded by the compiled module, the device-set
 * scans, the entries the contract's own pure circuits derive, and both
 * signatures. Then Home.
 *
 * WHAT IS STOOD IN FOR, AND WHY IT IS THE HONEST PLACE
 * ----------------------------------------------------
 * The proving service and the chain, and nothing nearer the app — see
 * `src/lib/walkChain.ts`. The two calls are handed over to this file instead
 * of to a prover, and "landing" one means the account state this file serves
 * then carries it, which is what the contract would do: an added key is in the
 * device set.
 *
 * The account is the one recorded from stagenet on 2026/09/16, with ONE change
 * made through the ledger's own serialiser: the stand-in sign-in's key is in
 * its device set, which is what "Google was added as the way back" leaves on
 * an account. The name is the recorded `iamtester.night`, resolving to that
 * account: the recorded resolver leaf, with its 32-byte target pointed at it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { RESOLVABLE_NAME, installNetworkBoundary } from './mocks.js';
import { installVirtualAuthenticator } from './passkey.js';
import { SIGN_IN_BUTTON, walkContextOptions } from './walkContext.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => fs.readFileSync(path.join(here, 'fixtures', name), 'utf8');

/** A tab with no key and no Passport, and a sign-in available but not signed in. */
const START = '/?accwalk=1&dynamicwalk=out';

/** The account the name is found at: the recorded stagenet account. */
const FOUND = 'cbd6b1c14a99c1751caa80a5665f01cb8067a9758183bda5da581e4ef745d215';

/** The resolver leaf `iamtester.night` is held by, and the account it names in the recording. */
const RESOLVER = '0291d8f9e4f851f24cd1a8d89c5b9d4152343b32d0329de442ff6567739baa66';
const RECORDED_TARGET = '8054fcaccc83b5e1ad8e4f8c5d555010b61dbecd838d412a85635dc2b5bf5263';

/**
 * The stand-in sign-in: its address, and the fixed test scalar behind it —
 * `src/lib/dynamicWalk.ts`'s, spelled out here because what this file derives
 * from it has to be what the build derives from its signatures.
 */
const WALK_USER = '0x00a329c0648769a73afac7f9381e08fb43dbea72';
const WALK_SCALAR = '4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318';

/** Where the build's stand-in for the chain hands a call over. `src/lib/walkChain.ts`. */
const CHAIN = 'https://passport-walk.invalid/chain';

/** The sentence a refused add is shown with. `src/lib/custodyAdoption.ts`. */
const NOT_ADDED = 'This device was not added to your Passport, and nothing on it changed. Try again.';

/** Everything a screen may not say. */
const FORBIDDEN_ON_SCREEN = [
  'wallet address',
  'dust',
  'contract',
  'registry',
  'indexer',
  'resolver',
  'sponsor',
  'sdk',
  'dynamic',
];

function greeting(page: Page) {
  return page.getByRole('heading', { name: /^Good (morning|afternoon|evening)\.$/ });
}

async function saysNothingForbidden(page: Page): Promise<void> {
  const said = (await page.locator('body').innerText()).toLowerCase();
  for (const forbidden of FORBIDDEN_ON_SCREEN) {
    expect(said, `"${forbidden}" is on screen`).not.toContain(forbidden);
  }
}

/* -------------------------------------------------------------------------- */
/* The account, as the chain holds it                                         */
/* -------------------------------------------------------------------------- */

/**
 * The recorded account, with the keys a way back and a recovery put on it.
 *
 * Built with the ledger's own serialiser and read back with the compiled
 * module, so what the build decodes is a state the ledger wrote: field 6 of
 * the account's state is the device set (a map to nulls) and field 9 is
 * `auth_nonce`, the layout `contracts/stagenet/account-custody` reads.
 */
async function accountState(extraEntries: readonly string[], nonceBump: bigint): Promise<string> {
  const runtime = await import('@midnight-ntwrk/compact-runtime');
  const account = (await import(
    pathToFileURL(path.join(here, '..', 'contracts', 'stagenet', 'account-custody', 'contract', 'index.js')).href
  )) as {
    pureCircuits: {
      derive_device_entry_with_k256(
        self: { bytes: Uint8Array },
        pk: { x: bigint; y: bigint; identity: boolean },
        envelope: bigint,
        epoch: bigint,
        counter: bigint,
      ): Uint8Array;
    };
    ledger(state: unknown): { auth_nonce: bigint; device_epoch: bigint };
  };
  const { secp256k1 } = await import('@noble/curves/secp256k1.js');
  const recorded = JSON.parse(fixture('stagenet-account-custody.json')) as { data: { contract: { state: string } } };
  const state = runtime.ContractState.deserialize(Buffer.from(recorded.data.contract.state, 'hex'));
  const before = account.ledger(state.data);

  /* THE WAY BACK: the stand-in sign-in's key, at the account's epoch and
     counter zero — derived by the contract's own pure circuit from the point
     the build will recover from the sign-in's signatures. */
  const point = secp256k1.getPublicKey(Buffer.from(WALK_SCALAR, 'hex'), false);
  const big = (bytes: Uint8Array) => BigInt(`0x${Buffer.from(bytes).toString('hex')}`);
  const wayBack = account.pureCircuits.derive_device_entry_with_k256(
    { bytes: Uint8Array.from(Buffer.from(FOUND, 'hex')) },
    { x: big(point.subarray(1, 33)), y: big(point.subarray(33, 65)), identity: false },
    0n,
    before.device_epoch,
    0n,
  );

  const bytes32 = new runtime.CompactTypeBytes(32);
  const u64 = new runtime.CompactTypeUnsignedInteger(18446744073709551615n, 8);
  const fields = state.data.state.asArray()!;
  let devices = fields[6].asMap()!;
  for (const entry of [wayBack, ...extraEntries.map((hex) => Uint8Array.from(Buffer.from(hex, 'hex')))]) {
    devices = devices.insert({ value: bytes32.toValue(entry), alignment: bytes32.alignment() }, runtime.StateValue.newNull());
  }
  let next = runtime.StateValue.newArray();
  fields.forEach((field, position) => {
    next = next.arrayPush(
      position === 6
        ? runtime.StateValue.newMap(devices)
        : position === 9
          ? runtime.StateValue.newCell({ value: u64.toValue(before.auth_nonce + nonceBump), alignment: u64.alignment() })
          : field,
    );
  });
  state.data = new runtime.ChargedState(next);
  return JSON.stringify({ data: { contract: { state: Buffer.from(state.serialize()).toString('hex') } } });
}

/** What the chain was handed, in order, and the dials a walk turns. */
interface Chain {
  readonly handedOver: string[];
}

/**
 * The account, its name, and the chain that takes the two calls.
 *
 * Registered after `installNetworkBoundary`, so these answer first and fall
 * back to it for everything else.
 */
async function serveTheAccount(page: Page, options: { refuseAdds?: number } = {}): Promise<Chain> {
  const handedOver: string[] = [];
  const added: string[] = [];
  let nonceBump = 0n;
  let state = await accountState(added, nonceBump);
  let refusals = options.refuseAdds ?? 0;

  const resolver = fixture('stagenet-night-resolver.json').replace(RECORDED_TARGET, FOUND);
  const deployTx = fixture('stagenet-account-custody-deploy-tx.json');
  const deployState = fixture('stagenet-account-custody-deploy-state.json');

  await page.route('**/indexer.stagenet.shielded.tools/**', async (route) => {
    const body = route.request().postData() ?? '';
    const asked = (/"address":"([0-9a-fA-F]+)"/.exec(body)?.[1] ?? '').toLowerCase();
    if (asked === RESOLVER && body.includes('CONTRACT_STATE_QUERY')) {
      return route.fulfill({ contentType: 'application/json', body: resolver });
    }
    if (asked !== FOUND) return route.fallback();
    if (body.includes('DEPLOY_CONTRACT_STATE_TX_QUERY')) {
      return route.fulfill({ contentType: 'application/json', body: deployState });
    }
    if (body.includes('DEPLOY_TX_QUERY')) {
      return route.fulfill({ contentType: 'application/json', body: deployTx });
    }
    if (body.includes('CONTRACT_STATE_QUERY')) {
      return route.fulfill({ contentType: 'application/json', body: state });
    }
    return route.fallback();
  });

  await page.route(CHAIN, async (route) => {
    const call = JSON.parse(route.request().postData() ?? '{}') as { circuit: string; first: string | null };
    handedOver.push(call.circuit);
    if (call.circuit.startsWith('add_device_with_') && refusals > 0) {
      refusals -= 1;
      return route.fulfill({ status: 503, body: 'refused' });
    }
    /* LANDED: the next read of the account carries it. An added key is in
       the device set; every authorised call moves `auth_nonce` on. A moment's
       wait first, so the screen the person watches is one a walk can see. */
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    if (call.circuit.startsWith('add_device_with_') && call.first !== null) added.push(call.first);
    nonceBump += 1n;
    state = await accountState(added, nonceBump);
    return route.fulfill({ json: { txId: `${handedOver.length}`.padStart(64, '0') } });
  });

  /* The build's stand-in for the chain answers only on a page that asks. */
  await page.addInitScript(() => {
    (window as unknown as { __passportWalkChain?: unknown }).__passportWalkChain = {};
  });
  return { handedOver };
}

/**
 * The landing, the sign-in, and the name — up to the press that finds the
 * Passport, on a browser that holds nothing at all.
 */
async function findItByName(page: Page): Promise<void> {
  await page.goto(START);
  await expect(page.getByRole('button', { name: SIGN_IN_BUTTON })).toBeVisible({ timeout: 60_000 });
  /* EMPTY: nothing of any Passport's in this browser. */
  expect(
    await page.evaluate(() =>
      Object.keys(window.localStorage).filter((key) => key.startsWith('passport-account-custody')),
    ),
  ).toEqual([]);

  await page.getByTestId('recover-lost-device').click();
  await expect(page.getByRole('heading', { name: /Open your\s*Passport here/ })).toBeVisible();
  await page.getByTestId('recover-sign-in').click();
  await expect(page.getByRole('heading', { name: /Find it\s*by its name/ })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Your name').fill(RESOLVABLE_NAME);
  await page.getByRole('button', { name: 'Find my Passport' }).click();
}

/** What this browser has written down, by store. */
async function stored(page: Page, key: string): Promise<Record<string, Record<string, unknown>>> {
  const raw = await page.evaluate((name) => window.localStorage.getItem(name), key);
  return raw === null ? {} : (JSON.parse(raw) as Record<string, Record<string, unknown>>);
}

/* -------------------------------------------------------------------------- */
/* The walks                                                                  */
/* -------------------------------------------------------------------------- */

test.describe('coming back on a new device, from a browser that holds nothing (2026/09/26)', () => {
  test('finds the Passport by name, adds this device with the sign-in approving, and lands on Home', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const context = await browser.newContext(walkContextOptions({ viewport: { width: 420, height: 900 } }));
    const page = await context.newPage();
    await installNetworkBoundary(page);
    const chain = await serveTheAccount(page);
    const authenticator = await installVirtualAuthenticator(context, page);
    try {
      await findItByName(page);

      /* THE SECOND HALF, ON SCREEN WHILE IT RUNS — the screen the live run
         never left. */
      await expect(page.getByTestId('adopting')).toHaveText(
        `Adding this device to ${RESOLVABLE_NAME}.night. Approve it with the account you just signed in with.`,
        { timeout: 120_000 },
      );
      await saysNothingForbidden(page);

      /* HOME, by way of the one question a Passport that has just come back
         is asked (#108): its earlier payments. */
      await expect(page.getByRole('heading', { name: 'Bring back your earlier payments' })).toBeVisible({
        timeout: 120_000,
      });
      await page.getByRole('button', { name: 'Not now' }).click();
      await expect(greeting(page)).toBeVisible({ timeout: 60_000 });
      await expect(page.locator('.mnid-alias')).toHaveText(`${RESOLVABLE_NAME}.night`);
      /* The way back that brought it here is ON, not offered again. */
      await expect(page.getByRole('heading', { name: 'Add a way back' })).toHaveCount(0);
      await saysNothingForbidden(page);

      /* WHAT THE CHAIN WAS HANDED: the sign-in's add, then the new key's
         rotation — and nothing refused on the way. */
      expect(chain.handedOver).toEqual(['add_device_with_k256', 'rotate_enc_key_with_jubjub']);

      /* WHAT THIS BROWSER NOW HOLDS. The sign-in's record, written by the
         adoption itself — the record whose absence was the defect — and no
         name beside it, so the sign-in does not become the Passport's holder. */
      const records = await stored(page, 'passport-account-custody:v1');
      expect(records[`${WALK_USER}|stagenet`]).toMatchObject({
        user: WALK_USER,
        address: FOUND,
        activated: true,
        privateStateId: `passport-account-custody-${WALK_USER.slice(2, 10)}`,
      });
      const names = await stored(page, 'passport-account-custody-name:v1');
      expect(names[`${WALK_USER}|stagenet`]).toBeUndefined();
      /* And the new device's own: its record, its name, and the pointer that
         makes the next open free. */
      const pointers = await stored(page, 'passport-account-custody-passkey:v1');
      const userKey = Object.values(pointers)[0] as unknown as string;
      expect(userKey).toMatch(/^jubjub:[0-9a-f]+$/u);
      expect(records[`${userKey}|stagenet`]).toMatchObject({ address: FOUND, activated: true });
      expect(names[`${userKey}|stagenet`]).toBe(RESOLVABLE_NAME);
      /* The hand-off is finished with. */
      expect(await page.evaluate(() => window.localStorage.getItem('passport-account-custody-adopt:v1'))).toBeNull();
    } finally {
      await authenticator.remove().catch(() => {});
      await context.close();
    }
  });

  test('says so when the add is refused, and Try again brings the Passport here', async ({ browser }) => {
    test.setTimeout(300_000);
    const context = await browser.newContext(walkContextOptions({ viewport: { width: 420, height: 900 } }));
    const page = await context.newPage();
    await installNetworkBoundary(page);
    const chain = await serveTheAccount(page, { refuseAdds: 1 });
    const authenticator = await installVirtualAuthenticator(context, page);
    try {
      await findItByName(page);

      /* NOT A SPINNER FOR EVER: one sentence, the press, and the way out. */
      await expect(page.getByTestId('adopt-failed')).toHaveText(NOT_ADDED, { timeout: 120_000 });
      await expect(page.getByTestId('adopting')).toHaveCount(0);
      await expect(page.locator('section.mnob-screen')).toHaveAttribute('aria-busy', 'false');
      await expect(page.getByTestId('adopt-retry')).toHaveText('Try again');
      await expect(page.getByRole('button', { name: 'Use a different sign-in' })).toBeVisible();
      await saysNothingForbidden(page);
      /* Nothing is cleared by a failure: the hand-off is still there to resume. */
      expect(await page.evaluate(() => window.localStorage.getItem('passport-account-custody-adopt:v1'))).not.toBeNull();
      expect(chain.handedOver).toEqual(['add_device_with_k256']);

      /* TRY AGAIN RESUMES IT, from the same records. */
      await page.getByTestId('adopt-retry').click();
      await expect(page.getByRole('heading', { name: 'Bring back your earlier payments' })).toBeVisible({
        timeout: 120_000,
      });
      await page.getByRole('button', { name: 'Not now' }).click();
      await expect(greeting(page)).toBeVisible({ timeout: 60_000 });
      await expect(page.locator('.mnid-alias')).toHaveText(`${RESOLVABLE_NAME}.night`);
      expect(chain.handedOver).toEqual(['add_device_with_k256', 'add_device_with_k256', 'rotate_enc_key_with_jubjub']);
    } finally {
      await authenticator.remove().catch(() => {});
      await context.close();
    }
  });

  test('offers a way out of a refused add, back to choosing a sign-in', async ({ browser }) => {
    test.setTimeout(300_000);
    const context = await browser.newContext(walkContextOptions({ viewport: { width: 420, height: 900 } }));
    const page = await context.newPage();
    await installNetworkBoundary(page);
    await serveTheAccount(page, { refuseAdds: 1 });
    const authenticator = await installVirtualAuthenticator(context, page);
    try {
      await findItByName(page);
      await expect(page.getByTestId('adopt-failed')).toHaveText(NOT_ADDED, { timeout: 120_000 });

      await page.getByRole('button', { name: 'Use a different sign-in' }).click();
      await expect(page.getByRole('heading', { name: /Open your\s*Passport here/ })).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.getByTestId('recover-sign-in')).toBeVisible();
      /* This recovery is put down, so nothing resumes it behind the screen. */
      expect(await page.evaluate(() => window.localStorage.getItem('passport-account-custody-adopt:v1'))).toBeNull();
    } finally {
      await authenticator.remove().catch(() => {});
      await context.close();
    }
  });
});
