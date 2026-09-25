/**
 * The sponsor paying a custody Passport's opening balance by itself, on the
 * account's activation — `src/fundOnActivation.ts` — and the verifier-key
 * scoping that lets a deposit into an account with only wave 1 be opened at all.
 *
 * Pinned to 2026/09/24–25: an Android reviewer switched apps after Home, the
 * phone's background waves stalled, and nothing asked `/fund-account` for more
 * than ten minutes.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ContractState } from '@midnight-ntwrk/compact-runtime';
import { verifyContractState } from '@midnight-ntwrk/midnight-js-contracts';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';

import { isNodeRejection } from '../src/account.js';
import { CUSTODY_SPONSOR_CIRCUITS, verifierKeysScopedTo } from '../src/accountModule.js';
import { loadConfig, switchFrom } from '../src/config.js';
import {
  accountsToResume,
  classifyFundOutcome,
  concurrentFundingAnswer,
  createFundOnActivation,
  mentionsCustomError104,
  type ActivationProbe,
  type FundOnActivationOptions,
  type FundOutcome,
} from '../src/fundOnActivation.js';

const ACCOUNT = 'a'.repeat(64);
const FUNDED: FundOutcome = { status: 200, body: { nightTx: '0xnight', assetTx: '0xmusd' } };

/** A clock that only moves when a watch sleeps, so ten minutes pass in microseconds. */
function fakeClock() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
      await Promise.resolve();
    },
    advance: (ms: number) => {
      t += ms;
    },
    sleeps,
  };
}

function harness(
  overrides: Partial<FundOnActivationOptions> & {
    probes?: ActivationProbe[];
    outcomes?: FundOutcome[];
  } = {},
) {
  const clock = fakeClock();
  const lines: string[] = [];
  const probes = [...(overrides.probes ?? [])];
  const outcomes = [...(overrides.outcomes ?? [])];
  const funded: string[] = [];
  let probeCount = 0;
  const watcher = createFundOnActivation({
    enabled: true,
    probe: async () => {
      probeCount += 1;
      return probes.length > 1 ? (probes.shift() as ActivationProbe) : (probes[0] ?? { kind: 'not-activated' });
    },
    fund: async (address) => {
      funded.push(address);
      return outcomes.length > 1 ? (outcomes.shift() as FundOutcome) : (outcomes[0] ?? FUNDED);
    },
    isFunded: () => false,
    now: clock.now,
    sleep: clock.sleep,
    log: (line) => lines.push(line),
    warn: (line) => lines.push(`WARN ${line}`),
    ...overrides,
  });
  return { watcher, clock, lines, funded, probeCount: () => probeCount };
}

describe('funding a custody Passport on its activation', () => {
  it('waits while the account is not activated, then funds it ONCE', async () => {
    const h = harness({
      probes: [
        { kind: 'not-yet-readable', why: 'not indexed yet' },
        { kind: 'not-activated' },
        { kind: 'not-activated' },
        { kind: 'activated' },
      ],
    });
    assert.equal(h.watcher.watch(ACCOUNT, 'its name was claimed'), 'watching');
    await h.watcher.settled();
    assert.deepEqual(h.funded, [ACCOUNT], 'funded exactly once');
    assert.equal(h.probeCount(), 4, 'not funded before the read that said activated');
    assert.ok(h.lines.some((line) => line.includes(`funding ${ACCOUNT} on activation (no request from the phone needed)`)));
    assert.ok(h.lines.some((line) => line.includes('is a custody Passport that is not activated yet')));
  });

  it('never funds before activation, and gives up when the window runs out', async () => {
    const h = harness({ probes: [{ kind: 'not-activated' }], windowMs: 600_000 });
    h.watcher.watch(ACCOUNT, 'test');
    await h.watcher.settled();
    assert.deepEqual(h.funded, []);
    assert.ok(h.clock.now() <= 600_000, 'the wait is bounded by the window');
    assert.ok(Math.max(...h.clock.sleeps) <= 30_000, 'backs off to at most thirty seconds');
    assert.ok(h.clock.sleeps[1]! > h.clock.sleeps[0]!, 'backs off');
    assert.ok(h.lines.some((line) => line.startsWith('WARN') && line.includes('stopped waiting to fund on activation after 10 min')));
  });

  it('leaves a PROTOTYPE account untouched: no spend and no journal line', async () => {
    const h = harness({ probes: [{ kind: 'not-yet-readable' }, { kind: 'not-custody' }] });
    h.watcher.watch(ACCOUNT, 'its name was claimed');
    await h.watcher.settled();
    assert.deepEqual(h.funded, []);
    assert.deepEqual(h.lines, []);
  });

  it('watches an account once per process, however many times its name is claimed', async () => {
    const h = harness({ probes: [{ kind: 'activated' }] });
    assert.equal(h.watcher.watch(ACCOUNT, 'first'), 'watching');
    assert.equal(h.watcher.watch(ACCOUNT, 'second'), 'already-watching');
    await h.watcher.settled();
    assert.equal(h.watcher.watch(ACCOUNT, 'third'), 'already-watching');
    assert.deepEqual(h.funded, [ACCOUNT]);
  });

  it('does not start for an account the ledger already records as funded', () => {
    const h = harness({ isFunded: () => true });
    assert.equal(h.watcher.watch(ACCOUNT, 'test'), 'already-funded');
    assert.equal(h.watcher.watching(), 0);
  });

  it('stops without spending when the phone funded it during the wait', async () => {
    let fundedByPhone = false;
    const h = harness({
      probes: [{ kind: 'not-activated' }],
      isFunded: () => fundedByPhone,
      sleep: async () => {
        fundedByPhone = true;
      },
    });
    h.watcher.watch(ACCOUNT, 'test');
    await h.watcher.settled();
    assert.deepEqual(h.funded, []);
  });

  it('does nothing at all when switched off', () => {
    const h = harness({ enabled: false, probes: [{ kind: 'activated' }] });
    assert.equal(h.watcher.watch(ACCOUNT, 'test'), 'off');
    assert.equal(h.probeCount(), 0);
  });

  it('holds a bounded number of watches', () => {
    const h = harness({ maxWatches: 2, probes: [{ kind: 'not-activated' }] });
    assert.equal(h.watcher.watch('1'.repeat(64), 'a'), 'watching');
    assert.equal(h.watcher.watch('2'.repeat(64), 'b'), 'watching');
    assert.equal(h.watcher.watch('3'.repeat(64), 'c'), 'full');
    h.watcher.stop();
  });

  it('stops on a host that cannot serve the custody build', async () => {
    const h = harness({ probes: [{ kind: 'unservable', why: 'BALANCER_PROVER_URL_V3 is not set' }] });
    h.watcher.watch(ACCOUNT, 'test');
    await h.watcher.settled();
    assert.deepEqual(h.funded, []);
    assert.equal(h.probeCount(), 1);
  });
});

describe('a Custom error 104 while a maintenance wave lands', () => {
  const refused104: FundOutcome = {
    status: 502,
    body: {
      error: 'deposit-failed',
      message: 'The activation grant could not be deposited into x; nothing was credited.',
      detail: 'RpcError: 1010: Invalid Transaction: Custom error: 104',
    },
  };

  it('is a node rejection, so the deposit itself rebuilds it (withNodeRejectionRetry)', () => {
    assert.equal(isNodeRejection(new Error('1010: Invalid Transaction: Custom error: 104')), true);
  });

  it('is tried again by the watch, bounded, with a journal line naming it', async () => {
    const h = harness({ probes: [{ kind: 'activated' }], outcomes: [refused104, refused104, FUNDED] });
    h.watcher.watch(ACCOUNT, 'test');
    await h.watcher.settled();
    assert.equal(h.funded.length, 3);
    assert.equal(h.lines.filter((line) => line.includes('Custom error 104')).length, 2);
    assert.ok(h.lines.some((line) => line.includes('funded on activation — funded')));
  });

  it('gives up after the attempt ceiling and leaves it to the phone', async () => {
    const h = harness({ probes: [{ kind: 'activated' }], outcomes: [refused104], maxFundAttempts: 3 });
    h.watcher.watch(ACCOUNT, 'test');
    await h.watcher.settled();
    assert.equal(h.funded.length, 3);
    assert.ok(h.lines.some((line) => line.includes('gave up after 3 attempts')));
  });

  it('recognises the refusal in either leg', () => {
    assert.equal(mentionsCustomError104(refused104), true);
    assert.equal(
      mentionsCustomError104({ status: 200, body: { assetError: 'asset-deposit-failed: … (1010: Invalid Transaction: Custom error: 104)' } }),
      true,
    );
    assert.equal(mentionsCustomError104({ status: 502, body: { detail: 'Custom error: 231' } }), false);
  });
});

describe('what a /fund-account answer means to the watch', () => {
  it('a full success, or somebody else having paid, ends it', () => {
    assert.equal(classifyFundOutcome(FUNDED).verdict, 'done');
    assert.equal(classifyFundOutcome({ status: 409, body: { error: 'already-activated' } }).verdict, 'done');
    assert.equal(classifyFundOutcome({ status: 409, body: { error: 'already-funded' } }).verdict, 'done');
    assert.equal(classifyFundOutcome({ status: 409, body: { error: 'funding-in-flight' } }).verdict, 'done');
  });

  it('half an opening balance, a busy wallet, or the ceiling is tried again', () => {
    assert.equal(classifyFundOutcome({ status: 200, body: { nightTx: '0x', assetError: 'x' } }).verdict, 'retry');
    assert.equal(classifyFundOutcome({ status: 503, body: { error: 'wallet-syncing' } }).verdict, 'retry');
    assert.equal(classifyFundOutcome({ status: 429, body: { error: 'rate-limited' } }).verdict, 'retry');
    assert.equal(classifyFundOutcome({ status: 429, body: { error: 'grant-retrying' } }).verdict, 'retry');
  });

  it('an answer about the account itself stops it', () => {
    assert.equal(classifyFundOutcome({ status: 400, body: { error: 'not-an-account' } }).verdict, 'give-up');
    assert.equal(classifyFundOutcome({ status: 400, body: { error: 'wrong-network' } }).verdict, 'give-up');
  });
});

describe('the phone asking while the sponsor is already paying', () => {
  /**
   * `/fund-account`'s own once-only gates, as `src/server.ts` applies them:
   * the in-flight set, then the per-account ledger. Enough of the route to
   * show that the two callers together pay ONE opening balance.
   */
  function route() {
    const inFlight = new Set<string>();
    const activationInFlight = new Set<string>();
    const ledger = new Map<string, true>();
    let deposits = 0;
    let release: (() => void) | null = null;
    const fund = async (address: string, origin: 'client' | 'activation' = 'client'): Promise<FundOutcome> => {
      if (inFlight.has(address)) {
        const busy = concurrentFundingAnswer(activationInFlight.has(address), 15_000);
        return { status: busy.status, body: { error: busy.error, message: busy.message, ...(busy.extra ?? {}) } };
      }
      if (ledger.has(address)) return { status: 409, body: { error: 'already-activated' } };
      inFlight.add(address);
      if (origin === 'activation') activationInFlight.add(address);
      try {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        deposits += 1;
        ledger.set(address, true);
        return FUNDED;
      } finally {
        inFlight.delete(address);
        activationInFlight.delete(address);
      }
    };
    return { fund, ledger, deposits: () => deposits, release: () => release?.() };
  }

  it('answers the phone "in progress" (429, retry) during the sponsor’s funding and "already funded" after it', async () => {
    const ref: { current: ReturnType<typeof createFundOnActivation> | null } = { current: null };
    const r = route();
    const clock = fakeClock();
    ref.current = createFundOnActivation({
      enabled: true,
      probe: async () => ({ kind: 'activated' }),
      fund: (address) => r.fund(address, 'activation'),
      isFunded: (address) => r.ledger.has(address),
      now: clock.now,
      sleep: clock.sleep,
      log: () => {},
      warn: () => {},
    });
    ref.current.watch(ACCOUNT, 'test');
    /* Let the watch reach the deposit and hold there. */
    for (let i = 0; i < 10 && !ref.current.isFunding(ACCOUNT); i += 1) await Promise.resolve();
    assert.equal(ref.current.isFunding(ACCOUNT), true);

    const during = await r.fund(ACCOUNT);
    assert.equal(during.status, 429, 'the app reads 429 as "ask again shortly", never as a refusal');
    assert.equal(during.body.error, 'funding-on-activation');
    assert.equal(during.body.retryAfterMs, 15_000);

    r.release();
    await ref.current.settled();
    const after = await r.fund(ACCOUNT);
    assert.equal(after.status, 409);
    assert.equal(after.body.error, 'already-activated');
    assert.equal(r.deposits(), 1, 'one opening balance between the two callers');
  });

  it('keeps the old 409 word for word when the running funding is another caller’s', () => {
    assert.deepEqual(concurrentFundingAnswer(false, 15_000), {
      status: 409,
      error: 'funding-in-flight',
      message:
        'A funding for this Passport is already in progress. Wait for it to finish before asking again.',
    });
  });

  it('ends the watch without a second deposit when the phone got there first', async () => {
    const ref: { current: ReturnType<typeof createFundOnActivation> | null } = { current: null };
    const r = route();
    const phone = r.fund(ACCOUNT);
    const clock = fakeClock();
    const lines: string[] = [];
    ref.current = createFundOnActivation({
      enabled: true,
      probe: async () => ({ kind: 'activated' }),
      fund: (address) => r.fund(address, 'activation'),
      isFunded: (address) => r.ledger.has(address),
      now: clock.now,
      sleep: clock.sleep,
      log: (line) => lines.push(line),
      warn: (line) => lines.push(line),
    });
    ref.current.watch(ACCOUNT, 'test');
    await ref.current.settled();
    assert.ok(lines.some((line) => line.includes('the phone is funding it right now')));
    r.release();
    await phone;
    assert.equal(r.deposits(), 1);
  });
});

describe('picking watches up again after a restart', () => {
  it('resumes accounts named inside the window and not yet funded', () => {
    const now = Date.parse('2026-09-25T10:10:00Z');
    const named = [
      { address: '1'.repeat(64), at: '2026-09-25T10:05:00Z' },
      { address: '2'.repeat(64), at: '2026-09-25T09:00:00Z' },
      { address: '3'.repeat(64), at: '2026-09-25T10:08:00Z' },
      { address: '4'.repeat(64), at: 'not a date' },
    ];
    assert.deepEqual(
      accountsToResume(named, (address) => address === '3'.repeat(64), now, 600_000),
      ['1'.repeat(64)],
    );
  });
});

describe('the off switch', () => {
  const env = (extra: Record<string, string> = {}) =>
    ({ BALANCER_SEED: 'ab'.repeat(32), ...extra }) as NodeJS.ProcessEnv;

  it('is ON by default, with a ten-minute window', () => {
    const config = loadConfig(env());
    assert.equal(config.fundOnActivation, true);
    assert.equal(config.fundOnActivationWindowMs, 600_000);
  });

  it('turns off with BALANCER_FUND_ON_ACTIVATION=0', () => {
    assert.equal(loadConfig(env({ BALANCER_FUND_ON_ACTIVATION: '0' })).fundOnActivation, false);
    assert.equal(loadConfig(env({ BALANCER_FUND_ON_ACTIVATION: 'off' })).fundOnActivation, false);
  });

  it('refuses a spelling that could mean either', () => {
    assert.throws(() => switchFrom('X', 'maybe', true), /X must be one of/);
    assert.throws(
      () => loadConfig(env({ BALANCER_FUND_ON_ACTIVATION_WINDOW_MS: '1000' })),
      /BALANCER_FUND_ON_ACTIVATION_WINDOW_MS/,
    );
  });
});

describe('opening a custody account that has landed only wave 1', () => {
  /** Thirty circuits, as the account custody build declares them; wave 1 is a subset. */
  const ALL = [
    'deposit_unshielded',
    'deposit_shielded',
    'activate_initial_device_with_jubjub',
    'withdraw_shielded_with_jubjub',
    'withdraw_shielded_with_k256',
    'grant_withdraw_with_k256',
  ];
  const WAVE_1 = new Set(['deposit_unshielded', 'deposit_shielded', 'activate_initial_device_with_jubjub', 'withdraw_shielded_with_jubjub']);
  const vk = (id: string) => new TextEncoder().encode(`vk:${id}`);

  const provider = {
    asked: [] as string[][],
    async getVerifierKeys(ids: readonly string[]) {
      this.asked.push([...ids]);
      return ids.map((id) => [id, vk(id)] as [string, Uint8Array]);
    },
    async getVerifierKey(id: string) {
      return vk(id);
    },
  };
  const state = (carries: (id: string) => boolean, key = vk) =>
    ({
      operation: (id: string) => (carries(id) ? { verifierKey: key(id) } : undefined),
      toString: () => 'state',
    }) as never;

  it('the unscoped check refuses it — the defect: every circuit of the build is demanded', async () => {
    const keys = await provider.getVerifierKeys(ALL);
    assert.throws(() => verifyContractState(keys as never, state((id) => WAVE_1.has(id))), /undefined or have mismatched verifier keys/);
  });

  it('the scoped check accepts it, asking only for the deposits', async () => {
    const scoped = verifierKeysScopedTo(provider, CUSTODY_SPONSOR_CIRCUITS);
    const keys = await scoped.getVerifierKeys(ALL);
    assert.deepEqual(provider.asked.at(-1), ['deposit_unshielded', 'deposit_shielded']);
    assert.doesNotThrow(() => verifyContractState(keys as never, state((id) => WAVE_1.has(id))));
  });

  it('still refuses a deposit circuit whose deployed key does not match', async () => {
    const scoped = verifierKeysScopedTo(provider, CUSTODY_SPONSOR_CIRCUITS);
    const keys = await scoped.getVerifierKeys(ALL);
    const forged = state(
      (id) => WAVE_1.has(id),
      (id) => new TextEncoder().encode(`other:${id}`),
    );
    assert.throws(() => verifyContractState(keys as never, forged), /deposit_unshielded, deposit_shielded/);
  });

  it('still refuses an account without the deposits', async () => {
    const scoped = verifierKeysScopedTo(provider, CUSTODY_SPONSOR_CIRCUITS);
    const keys = await scoped.getVerifierKeys(ALL);
    assert.throws(() => verifyContractState(keys as never, state(() => false)));
  });

  it('refuses rather than checking nothing when the build declares none of the deposits', async () => {
    const scoped = verifierKeysScopedTo(provider, CUSTODY_SPONSOR_CIRCUITS);
    await assert.rejects(scoped.getVerifierKeys(['withdraw_shielded_with_k256']), /None of the circuits/);
  });

  it('passes every other method through to the provider unchanged', async () => {
    const scoped = verifierKeysScopedTo(provider, CUSTODY_SPONSOR_CIRCUITS);
    assert.deepEqual(await scoped.getVerifierKey('withdraw_shielded_with_k256'), vk('withdraw_shielded_with_k256'));
  });
});

describe('the same, against the REAL stagenet custody account', () => {
  /* `9448e166…`, the passkey Passport of 2026/09/18 — see
     `accountCustodyState.test.ts`. Thirty entry points, all four waves landed.
     Its wave-1 self is rebuilt from it by dropping every k256 and grant
     circuit, which is what the three maintenance updates after Home add. */
  const fixtures = join(import.meta.dirname, '..', '..', 'test', 'fixtures');
  const served = JSON.parse(readFileSync(join(fixtures, 'account-state-custody-jubjub.json'), 'utf8')) as {
    data: { contract: { state: string } };
  };
  const full = ContractState.deserialize(
    Uint8Array.from((served.data.contract.state.match(/.{2}/g) ?? []).map((byte) => parseInt(byte, 16))),
  );
  const all = full.operations().map(String);
  const waveOne = new ContractState();
  waveOne.data = full.data;
  for (const id of all) {
    if (!id.includes('k256') && !id.includes('grant')) waveOne.setOperation(id, full.operation(id)!);
  }
  /** The account's own keys, standing in for this host's artefacts: it was deployed from them. */
  const keysOfTheBuild = {
    async getVerifierKeys(ids: readonly string[]) {
      return ids.map((id) => [id, full.operation(id)!.verifierKey] as [string, Uint8Array]);
    },
  };

  it('has thirty circuits, and wave 1 carries the deposits but not the k256 or grant ones', () => {
    assert.equal(all.length, 30);
    const landed = waveOne.operations().map(String);
    assert.ok(landed.includes('deposit_unshielded') && landed.includes('deposit_shielded'));
    assert.ok(!landed.some((id) => id.includes('k256')));
    assert.ok(landed.length < 30);
  });

  it('the unscoped check refuses the wave-1 account and names the missing circuits', async () => {
    const keys = await keysOfTheBuild.getVerifierKeys(all);
    assert.throws(() => verifyContractState(keys as never, waveOne as never), /with_k256/);
  });

  it('the scoped check opens it', async () => {
    const keys = await verifierKeysScopedTo(keysOfTheBuild, CUSTODY_SPONSOR_CIRCUITS).getVerifierKeys(all);
    assert.doesNotThrow(() => verifyContractState(keys as never, waveOne as never));
  });

  const custodyKeys = join(import.meta.dirname, '..', '..', 'contracts-stagenet', 'managed', 'account-custody');
  it(
    'the scoped check passes with THIS HOST’S key files, the provider the sponsor really opens with',
    { skip: !existsSync(join(custodyKeys, 'keys', 'deposit_unshielded.verifier')) && 'account-custody keys are not staged here' },
    async () => {
      const provider = new NodeZkConfigProvider(custodyKeys);
      const keys = await verifierKeysScopedTo(provider, CUSTODY_SPONSOR_CIRCUITS).getVerifierKeys(all as never);
      assert.doesNotThrow(() => verifyContractState(keys as never, waveOne as never));
    },
  );
});
