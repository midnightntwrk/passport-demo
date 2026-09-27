/**
 * THE CHANGE OF A PAYMENT ANOTHER DEVICE MADE, AND THE HISTORY BEHIND IT, ON A
 * RECOVERED DEVICE (2026/09/27).
 *
 * What a tester met on a real Android phone: a Passport brought back through
 * its sign-in, whose opening 100 mUSD had been spent by the device of an
 * earlier recovery in a payment of 23. That device closed before it wrote its
 * note for the change, so the phone could read the 100 (spent, rightly not
 * counted) and nothing for the 77: Home said 0. And Activity said the setup
 * had all happened "1 min ago", with no payment in it at all.
 *
 * This walk is that phone, in the mocked tier: a device that did not see the
 * Passport made (its record carries no setup hashes), whose coin store holds
 * the 100 it read from the note, looking at an account whose history has the
 * setup, the way back, two additions by the sign-in, and the payment — each
 * with its block's time — and whose payment's events are the ledger's own
 * bytes: the 100 going in, the recipient's coin, and the change.
 *
 * The change coin is made here by the COMPILED BUILD ITSELF — its own
 * `_sendShielded_0`, run on the 100 — so what the page has to find is what
 * the contract really made, not what this file assumed. Nothing is mocked but
 * the network, exactly as in every other walk of this tier.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { homeGreeting, serveAccountCustodyState, CUSTODY_WALK } from './custodyWalk.js';
import { installNetworkBoundary } from './mocks.js';
import { installVirtualAuthenticator } from './passkey.js';
import { SIGN_IN_BUTTON, walkContextOptions } from './walkContext.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const WALK_NETWORK = 'stagenet';
/** The recorded account the custody walks read, as `custodyWalk.ts` serves it. */
const ACCOUNT = 'cbd6b1c14a99c1751caa80a5665f01cb8067a9758183bda5da581e4ef745d215';
/** The account the 23 went to. */
const RECIPIENT = 'b9dc2d630ef4e9256abb5f9bc797dda38bf6667eb5f0fd2625203e59284c2973';
/** The demo stablecoin's colour, as `src/lib/colour.ts` knows it. */
const MUSD = '1a2917fbed8b5ce44d12ebc7d337689045f6c96a6bbd39cf3d8691ab310ef6a6';
/** The opening grant's coin, as its note described it. */
const GRANT_NONCE = '6e'.repeat(32);

const DEPLOY = 'a0'.repeat(32);
const ACTIVATE = 'a1'.repeat(32);
const NIGHT_GRANT = 'a2'.repeat(32);
const MUSD_GRANT = 'a3'.repeat(32);
const WAY_BACK = 'a4'.repeat(32);
const RECOVERY_ONE = 'a5'.repeat(32);
const PAYMENT = 'a6'.repeat(32);
const RECOVERY_TWO = 'a7'.repeat(32);
const ROTATE = 'a8'.repeat(32);
/** One of the ids the payment's submit answered with on the other device. */
const PAYMENT_ID = `00${'c7'.repeat(32)}`;

const HOUR = 3_600_000;
const MINUTE = 60_000;

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

/* -------------------------------------------------------------------------- */
/* The payment, as the compiled build makes it                                */
/* -------------------------------------------------------------------------- */

interface Coin {
  nonce: Uint8Array;
  color: Uint8Array;
  value: bigint;
}

interface Either {
  is_left: boolean;
  left: { bytes: Uint8Array };
  right: { bytes: Uint8Array };
}

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const toContract = (address: string): Either => ({
  is_left: false,
  left: { bytes: new Uint8Array(32) },
  right: { bytes: Buffer.from(address, 'hex') },
});

/**
 * The 100 spent in a payment of 23 by the compiled build's own
 * `_sendShielded_0`: the nullifier the spend publishes, and the change it
 * makes, with the commitment it is filed under.
 */
async function compiledPayment(): Promise<{ nullifier: string; changeCommitment: string; changeNonce: string }> {
  const contractPath = path.join(here, '..', 'contracts', 'stagenet', 'account-custody', 'contract', 'index.js');
  const compiled = (await import(pathToFileURL(contractPath).href)) as {
    Contract: new (witnesses: unknown) => {
      _sendShielded_0(
        context: unknown,
        proof: unknown,
        input: Coin & { mt_index: bigint },
        recipient: Either,
        value: bigint,
      ): Promise<{ change: { is_some: boolean; value: Coin } }>;
      _coinCommitment_0(coin: Coin, recipient: Either): Uint8Array;
      _coinNullifier_0(coin: Coin, address: { bytes: Uint8Array }): Uint8Array;
    };
  };
  const runtime = createRequire(contractPath)('@midnight-ntwrk/compact-runtime') as {
    createCircuitContext(id: string, address: string, key: string, state: unknown, privateState: unknown): unknown;
    ContractState: new () => unknown;
  };
  const contract = new compiled.Contract(
    new Proxy(
      {},
      {
        get: () => () => {
          throw new Error('no witness is called here');
        },
        has: () => true,
      },
    ),
  );
  const grant: Coin = { nonce: Buffer.from(GRANT_NONCE, 'hex'), color: Buffer.from(MUSD, 'hex'), value: 100n };
  const context = runtime.createCircuitContext(
    'withdraw_shielded_to_contract_with_jubjub',
    ACCOUNT,
    '00'.repeat(32),
    new runtime.ContractState(),
    {},
  );
  const proof = { input: { value: [], alignment: [] }, output: undefined, publicTranscript: [], privateTranscriptOutputs: [] };
  const made = await contract._sendShielded_0(context, proof, { ...grant, mt_index: 4702n }, toContract(RECIPIENT), 23n);
  expect(made.change.is_some).toBe(true);
  expect(made.change.value.value).toBe(77n);
  return {
    nullifier: hex(contract._coinNullifier_0(grant, { bytes: Buffer.from(ACCOUNT, 'hex') })),
    changeCommitment: hex(contract._coinCommitment_0(made.change.value, toContract(ACCOUNT))),
    changeNonce: hex(made.change.value.nonce),
  };
}

/* -------------------------------------------------------------------------- */
/* The chain, as the indexer serves it                                        */
/* -------------------------------------------------------------------------- */

/** A real stagenet Zswap event's layout, cut where its fields sit. */
const EVENT_HEAD = '6d69646e696768743a6576656e745b7631345d3a080080';

function inputEvent(contract: string, tx: string, nullifier: string): string {
  return `${EVENT_HEAD}${contract}04001901${tx}0000000000${nullifier}00`;
}

/** A coin made for a contract; the position is SCALE's two-byte compact integer. */
function outputEvent(contract: string, tx: string, commitment: string, mtIndex: number): string {
  const compact = (mtIndex << 2) | 1;
  const position = Buffer.from([compact & 0xff, (compact >> 8) & 0xff]).toString('hex');
  return `${EVENT_HEAD}${contract}04002501${tx}0000000001${commitment}0200${position}`;
}

/**
 * The account's history, newest first, each action at its block's time, and
 * the payment's events. `now` is the walk's own clock, so the times Activity
 * shows are known to the hour.
 */
async function serveTheChain(
  page: Page,
  now: number,
  payment: { nullifier: string; changeCommitment: string },
  asked: string[],
): Promise<void> {
  const action = (typename: string, entryPoint: string | null, hash: string, at: number) => ({
    __typename: typename,
    ...(entryPoint === null ? {} : { entryPoint }),
    transaction: { hash, block: { timestamp: at }, transactionResult: { status: 'SUCCESS' } },
  });
  const start = now - 5 * HOUR;
  const history = [
    action('ContractCall', 'rotate_enc_key_with_jubjub', ROTATE, now - 2 * HOUR + MINUTE),
    action('ContractCall', 'add_device_with_k256', RECOVERY_TWO, now - 2 * HOUR),
    action('ContractCall', 'withdraw_shielded_to_contract_with_jubjub', PAYMENT, now - 3 * HOUR),
    action('ContractCall', 'add_device_with_k256', RECOVERY_ONE, now - 3 * HOUR - 30 * MINUTE),
    action('ContractCall', 'add_device_with_jubjub', WAY_BACK, start + 10 * MINUTE),
    action('ContractCall', 'deposit_shielded', MUSD_GRANT, start + 3 * MINUTE),
    action('ContractCall', 'deposit_unshielded', NIGHT_GRANT, start + 2 * MINUTE),
    action('ContractCall', 'activate_initial_device_with_jubjub', ACTIVATE, start + MINUTE),
    action('ContractDeploy', null, DEPLOY, start),
  ];
  const events = [
    inputEvent(ACCOUNT, PAYMENT, payment.nullifier),
    outputEvent(RECIPIENT, PAYMENT, '5f'.repeat(32), 4705),
    outputEvent(ACCOUNT, PAYMENT, payment.changeCommitment, 4706),
  ];
  await page.route('**/indexer.stagenet.shielded.tools/**', async (route) => {
    const body = route.request().postData() ?? '';
    if (body.toLowerCase().includes(ACCOUNT) && body.includes('CustodyInboxActions')) {
      return route.fulfill({ json: { data: { contract: { actions: history } } } });
    }
    if (body.includes('CustodySpentCoins')) {
      const query = (JSON.parse(body) as { query: string }).query;
      const data: Record<string, unknown> = {};
      for (const [, alias, hash] of query.matchAll(/(t\d+): transactions\(offset: \{ hash: "([0-9a-f]{64})" \}\)/g)) {
        asked.push(hash);
        data[alias] =
          hash === PAYMENT
            ? [{ hash, identifiers: [PAYMENT_ID], zswapLedgerEvents: events.map((raw) => ({ raw })) }]
            : [];
      }
      return route.fulfill({ json: { data } });
    }
    return route.fallback();
  });
}

/* -------------------------------------------------------------------------- */
/* The recovered device                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A passkey Passport on the account custody contract, made the way
 * `custodyWalk.ts` makes one — a real passkey through the landing and the name
 * step — then left as a recovered phone leaves it: no setup hashes, and the
 * 100 it read from the note in its coin store.
 */
async function recoveredDevice(page: Page): Promise<void> {
  await page.goto(CUSTODY_WALK);
  await expect(page.getByRole('button', { name: SIGN_IN_BUTTON })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
  await expect(page.getByRole('heading', { name: /Welcome to\s*Passport/ })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /^Choose my (\.night )?name$/ }).click();
  await page.getByLabel('Your name').fill('walker');
  await expect(page.getByRole('button', { name: 'Create my Passport' })).toBeEnabled({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Create my Passport' }).click();
  const seeded = await page.waitForFunction(
    () => {
      const credentialId = window.localStorage.getItem('passport-last-passkey');
      const raw = window.localStorage.getItem('passport-account-custody-passkey:v1');
      if (credentialId === null || raw === null) return null;
      const entry = Object.entries(JSON.parse(raw) as Record<string, string>)[0];
      return entry === undefined ? null : { credentialId, userKey: entry[1] };
    },
    undefined,
    { timeout: 60_000 },
  );
  const identity = (await seeded.jsonValue()) as { credentialId: string; userKey: string };
  const record = {
    user: identity.userKey,
    network: WALK_NETWORK,
    address: ACCOUNT,
    privateStateId: `passport-account-custody-${identity.userKey.slice(7, 15)}`,
    saltHex: '',
    pkXHex: null,
    pkYHex: null,
    wavesDone: 4,
    totalWaves: 4,
    activated: true,
    /* A device that did not see the Passport made. */
    txHashes: [],
  };
  const store = {
    [`${WALK_NETWORK}::${ACCOUNT}`]: {
      encSecretKeyHex: 'ab'.repeat(32),
      coins: { [MUSD]: { nonceHex: GRANT_NONCE, colorHex: MUSD, value: '100', mtIndex: '4702' } },
      queued: {},
      spentNonces: [],
      mtIndexCandidates: {},
      awaiting: {},
    },
  };
  /* Before the app boots, as `custodyWalk.ts` seeds — and ONCE, so the reload
     at the end of the walk reads what the app itself wrote since. */
  await page.addInitScript(
    ([recordKey, seededRecord, seededStore, pointerKey, seededUser]) => {
      if (window.sessionStorage.getItem('recover-change-seeded') !== null) return;
      window.sessionStorage.setItem('recover-change-seeded', '1');
      window.localStorage.setItem('passport-account-custody:v1', JSON.stringify({ [recordKey]: seededRecord }));
      window.localStorage.setItem('passport-account-custody-name:v1', JSON.stringify({ [recordKey]: 'walker' }));
      window.localStorage.setItem('passport-k1-coins:v1', JSON.stringify(seededStore));
      window.localStorage.setItem('passport-account-custody-passkey:v1', JSON.stringify({ [pointerKey]: seededUser }));
    },
    [`${identity.userKey}|${WALK_NETWORK}`, record, store, `${identity.credentialId}|${WALK_NETWORK}`, identity.userKey] as const,
  );
  await page.goto(CUSTODY_WALK);
}

function activityRow(page: Page, label: string) {
  return page.locator('.mnhome-activity-row', { hasText: label });
}

async function expectRow(page: Page, label: string, when: string, txHash: string): Promise<void> {
  const row = activityRow(page, label);
  await expect(row).toHaveCount(1, { timeout: 60_000 });
  await expect(row.locator('.mnhome-activity-when')).toHaveText(when);
  /* The same View link, in the same place, as every other row. */
  const view = row.locator('a.mnhome-activity-view');
  await expect(view).toHaveText('View');
  await expect(view).toHaveAttribute('href', `https://explorer.1am.xyz/tx/${txHash}?network=stagenet`);
}

test.describe('a recovered device, and a payment another device made from its Passport (2026/09/27)', () => {
  test('shows the 77 the payment kept, and the payment itself at the time it was made', async ({ browser }) => {
    test.setTimeout(240_000);
    const now = Date.now();
    const payment = await compiledPayment();
    const asked: string[] = [];

    const context = await browser.newContext(walkContextOptions({ viewport: { width: 420, height: 900 } }));
    const page = await context.newPage();
    await installNetworkBoundary(page);
    await serveAccountCustodyState(page);
    await serveTheChain(page, now, payment, asked);
    const authenticator = await installVirtualAuthenticator(context, page);
    await recoveredDevice(page);

    /* HOME: 77 mUSD, not 0 — the change, found on the chain. */
    await expect(homeGreeting(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.mnhome-token-row', { hasText: 'mUSD' })).toContainText('77', { timeout: 60_000 });
    await expect(page.locator('.mnhome-token-row', { hasText: 'mUSD' })).not.toContainText('100');

    /* And filed where the chain put it, with the 100 remembered as spent. */
    const held = await page.evaluate((key) => {
      const all = JSON.parse(window.localStorage.getItem('passport-k1-coins:v1') ?? '{}') as Record<
        string,
        {
          coins: Record<string, { nonceHex: string; colorHex: string; value: string; mtIndex: string }>;
          spentNonces: string[];
        }
      >;
      return all[key];
    }, `${WALK_NETWORK}::${ACCOUNT}`);
    expect(held.coins[MUSD]).toEqual({ nonceHex: payment.changeNonce, colorHex: MUSD, value: '77', mtIndex: '4706' });
    expect(held.spentNonces).toContain(GRANT_NONCE);
    /* The payment's events were read once, for the check, the walk, and Activity together. */
    expect(asked).toEqual([PAYMENT]);

    /* ACTIVITY: the history, at the times it happened, every row with its link. */
    await expectRow(page, 'Sent 23 mUSD', '3 hours ago', PAYMENT);
    await expectRow(page, 'Found 77 mUSD of change', '3 hours ago', PAYMENT);
    await expectRow(page, 'This device was added', '2 hours ago', RECOVERY_TWO);
    await expectRow(page, 'Another device was added', '3 hours ago', RECOVERY_ONE);
    await expectRow(page, 'Way back added', '4 hours ago', WAY_BACK);
    await expectRow(page, 'Stablecoin deposited', '4 hours ago', MUSD_GRANT);
    await expectRow(page, 'Opening balance deposited', '4 hours ago', NIGHT_GRANT);
    await expectRow(page, 'Your account is set up', '4 hours ago', ACTIVATE);
    await expectRow(page, 'Passport created', '5 hours ago', DEPLOY);
    const trail = page.locator('.mnhome-activity');
    await expect(trail.locator('.mnhome-activity-row')).toHaveCount(9);
    /* Nothing that happened hours ago says it happened just now. */
    await expect(trail.locator('.mnhome-activity-when', { hasText: /just now|min ago/ })).toHaveCount(0);
    const said = (await trail.innerText()).toLowerCase();
    for (const forbidden of FORBIDDEN_ON_SCREEN) expect(said, `"${forbidden}" is on screen`).not.toContain(forbidden);

    /* AND A RELOAD CHANGES NOTHING: no row twice, 77 still. */
    const reread = page.waitForResponse(
      (response) => (response.request().postData() ?? '').includes('CustodyInboxActions'),
      { timeout: 60_000 },
    );
    await page.reload();
    await reread;
    await expect(homeGreeting(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.mnhome-token-row', { hasText: 'mUSD' })).toContainText('77', { timeout: 60_000 });
    await page.waitForTimeout(2_000);
    await expect(activityRow(page, 'Sent 23 mUSD')).toHaveCount(1);
    await expect(trail.locator('.mnhome-activity-row')).toHaveCount(9);

    await authenticator.remove();
    await context.close();
  });
});
