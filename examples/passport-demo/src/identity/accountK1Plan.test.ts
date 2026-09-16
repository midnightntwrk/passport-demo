import { describe, expect, it, vi } from 'vitest';

import {
  allK1Circuits,
  describeProveK1Failure,
  hexToBytes,
  k1AccountIsUsable,
  k1ArmCircuits,
  k1ExplorerLink,
  k1GrantTwins,
  k1LifecycleCircuits,
  k1MilestoneEnabled,
  k1OtherArm,
  k1ProvingEndpoint,
  k1RecordKey,
  K1_PROVE_PATH,
  K1_PROVER_UNCONFIGURED,
  K1_RESCAN_LIMIT,
  K1_SHARED_CIRCUITS,
  K1_STORAGE_KEY,
  K1_VERIFIER_BYTE_BUDGET,
  loadK1Record,
  loadK1Records,
  newK1Record,
  nextK1Step,
  parseProveK1Response,
  planK1Waves,
  proveK1Request,
  resolveK1UseCounter,
  saveK1Record,
  type K1AccountRecord,
  type K1Storage,
} from './accountK1Plan.js';

/**
 * The drill for the decisions the k1 custody layer makes.
 *
 * WHAT IS BEING HELD, AND AGAINST WHAT
 * ------------------------------------
 * Three of the things below cannot be checked by running the flow, because
 * getting them wrong costs a sponsored transaction the node then rejects:
 *
 *  - THE WAVE PLAN. Wave 1 must carry the activation circuit or the deployed
 *    account cannot be opened at all, and no later wave can fix it — the
 *    account is already deployed with the wrong roster. The fixture below is
 *    the roster and the budget the stagenet run of 2026/09/16 used.
 *  - THE PROVING ENDPOINT. A wrong origin is a 404 after a proof has been
 *    waited for, and the endpoint does not exist yet, so nothing else can
 *    check it.
 *  - THE USE COUNTER. A stale counter derives an entry the ledger does not
 *    hold, and the call is refused in-circuit after the user has approved it.
 *
 * The rest — the record, the storage, the sentences — is here because every one
 * of them is read by a person on a screen or by an operator in a console, and
 * because this module is in the coverage denominator at 100%.
 */

const STORAGE = (): K1Storage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
};

/** Every circuit at the same plausible size, so packing is arithmetic. */
const evenSizes = (bytes = 2_400): Map<string, number> =>
  new Map(allK1Circuits('k256').map((circuit) => [circuit, bytes]));

describe('the circuit roster', () => {
  it('names an arm’s eight circuits, activation first', () => {
    const circuits = k1ArmCircuits('k256');
    expect(circuits).toHaveLength(8);
    expect(circuits[0]).toBe('activate_initial_device_with_k256');
    expect(circuits).toContain('append_inbox_with_k256');
    expect(circuits).toContain('withdraw_shielded_with_k256');
  });

  it('names the grant twins and the lifecycle circuits per arm', () => {
    expect(k1GrantTwins('jubjub')).toEqual([
      'withdraw_unshielded_with_grant_jubjub',
      'withdraw_shielded_with_grant_jubjub',
      'withdraw_shielded_to_contract_with_grant_jubjub',
    ]);
    expect(k1LifecycleCircuits('k256')).toEqual([
      'issue_grant_with_k256',
      'revoke_grant_with_k256',
      'revoke_all_grants_with_k256',
    ]);
  });

  it('knows the other arm', () => {
    expect(k1OtherArm('k256')).toBe('jubjub');
    expect(k1OtherArm('jubjub')).toBe('k256');
  });

  /* THIRTY IS THE NUMBER THE CONTRACT EXPORTS. If this drifts, either the
     contract changed or the roster here is wrong, and both are worth stopping
     for: a roster that is missing a circuit deploys an account with an
     operation nobody can ever call. */
  it('is thirty circuits, whichever arm leads', () => {
    expect(allK1Circuits('k256')).toHaveLength(30);
    expect(allK1Circuits('jubjub')).toHaveLength(30);
    expect(new Set(allK1Circuits())).toEqual(new Set(allK1Circuits('jubjub')));
    expect(allK1Circuits()[0]).toBe(K1_SHARED_CIRCUITS[0]);
  });
});

describe('the wave plan', () => {
  it('leads with the deposits and the whole of the first arm', () => {
    const waves = planK1Waves(evenSizes(), 'k256');
    expect(waves[0]?.index).toBe(1);
    expect(waves[0]?.circuits).toEqual([...K1_SHARED_CIRCUITS, ...k1ArmCircuits('k256')]);
    /* The property that matters: the account is activatable after wave 1. */
    expect(waves[0]?.circuits).toContain('activate_initial_device_with_k256');
    expect(waves[0]?.circuits).toContain('append_inbox_with_k256');
  });

  it('plans the measured roster as three waves and covers every circuit', () => {
    const waves = planK1Waves(evenSizes(), 'k256');
    expect(waves).toHaveLength(3);
    expect(waves.flatMap((wave) => wave.circuits).sort()).toEqual(allK1Circuits('k256').sort());
  });

  it('keeps every maintenance wave under the measured budget', () => {
    const sizes = evenSizes();
    for (const wave of planK1Waves(sizes, 'k256').slice(1)) {
      const used = wave.circuits.reduce((total, id) => total + (sizes.get(id) as number), 0);
      expect(used).toBeLessThanOrEqual(K1_VERIFIER_BYTE_BUDGET);
    }
  });

  it('retires the authority on the last wave, and only the last', () => {
    const waves = planK1Waves(evenSizes(), 'k256');
    expect(waves.filter((wave) => wave.retiresAuthority)).toHaveLength(1);
    expect(waves[waves.length - 1]?.retiresAuthority).toBe(true);
  });

  it('leaves the authority alone when told to', () => {
    expect(planK1Waves(evenSizes(), 'k256', false).some((w) => w.retiresAuthority)).toBe(false);
  });

  /* A key bigger than the whole budget still has to go SOMEWHERE — it gets a
     wave of its own rather than making the plan unsatisfiable. */
  it('gives an oversized key its own wave rather than refusing', () => {
    const sizes = evenSizes();
    sizes.set('activate_initial_device_with_jubjub', K1_VERIFIER_BYTE_BUDGET + 1);
    const waves = planK1Waves(sizes, 'k256');
    expect(waves[1]?.circuits).toEqual(['activate_initial_device_with_jubjub']);
  });

  it('refuses a roster it has no size for', () => {
    const sizes = evenSizes();
    sizes.delete('append_inbox_with_jubjub');
    expect(() => planK1Waves(sizes, 'k256')).toThrow(/append_inbox_with_jubjub/);
  });
});

describe('the proving endpoint', () => {
  it('hangs off the origin it is given', () => {
    expect(k1ProvingEndpoint('https://example.test/balancer')).toBe(
      `https://example.test/balancer${K1_PROVE_PATH}`,
    );
  });

  it('does not double a slash', () => {
    expect(k1ProvingEndpoint('https://example.test/balancer//')).toBe(
      `https://example.test/balancer${K1_PROVE_PATH}`,
    );
  });

  it('refuses rather than guessing when nothing is configured', () => {
    expect(() => k1ProvingEndpoint(null)).toThrow(K1_PROVER_UNCONFIGURED);
    expect(() => k1ProvingEndpoint('   ')).toThrow(K1_PROVER_UNCONFIGURED);
    expect(() => k1ProvingEndpoint(undefined)).toThrow(K1_PROVER_UNCONFIGURED);
  });
});

describe('the proving request and reply', () => {
  it('carries the circuit, the transaction as hex, and the network', () => {
    expect(proveK1Request('append_inbox_with_k256', new Uint8Array([0xde, 0xad]), 'stagenet')).toEqual(
      { circuit: 'append_inbox_with_k256', unprovenTx: 'dead', network: 'stagenet' },
    );
  });

  it('reads a proven transaction back, with or without 0x', () => {
    expect(parseProveK1Response({ provenTx: 'beef' })).toEqual(new Uint8Array([0xbe, 0xef]));
    expect(parseProveK1Response({ provenTx: '0xBEEF' })).toEqual(new Uint8Array([0xbe, 0xef]));
  });

  /* A reverse proxy answering 200 with an HTML error page is the failure this
     guards, and it must name the shape rather than dying inside a WASM
     deserialiser four frames later. */
  it('refuses a 200 that is not a proven transaction', () => {
    for (const body of [null, {}, { provenTx: 7 }, { provenTx: '<html>' }]) {
      expect(() => parseProveK1Response(body)).toThrow(/without a proven transaction/);
    }
  });

  it('says what the service refused with, for a console', () => {
    expect(describeProveK1Failure(503, { error: 'busy', detail: 'all workers in use' })).toBe(
      '[k1] the proving service refused with HTTP 503 (busy) — all workers in use',
    );
    expect(describeProveK1Failure(500, null)).toBe(
      '[k1] the proving service refused with HTTP 500 (unknown)',
    );
    expect(describeProveK1Failure(400, { error: '', detail: '' })).toBe(
      '[k1] the proving service refused with HTTP 400 (unknown)',
    );
  });
});

describe('hex', () => {
  it('round-trips, with or without a prefix', () => {
    expect(hexToBytes('0x00ff10')).toEqual(new Uint8Array([0, 255, 16]));
    expect(hexToBytes('')).toEqual(new Uint8Array(0));
  });

  it('refuses a half byte and a digit that is not hex', () => {
    expect(() => hexToBytes('abc')).toThrow(/even number/);
    expect(() => hexToBytes('zz')).toThrow(/not hex/);
  });
});

describe('the deploy record', () => {
  const base = (): K1AccountRecord =>
    newK1Record({
      user: '0xABCDEF',
      network: 'stagenet',
      privateStateId: 'passport-account-k1-abcdef',
      saltHex: '00'.repeat(32),
      totalWaves: 3,
    });

  it('starts before the deploy, lower-cased', () => {
    const record = base();
    expect(record.user).toBe('0xabcdef');
    expect(nextK1Step(record)).toBe('deploy');
    expect(k1AccountIsUsable(record)).toBe(false);
  });

  it('walks deploy → waves → activate → ready', () => {
    const deployed = { ...base(), address: 'aa'.repeat(32), wavesDone: 1 };
    expect(nextK1Step(deployed)).toBe('waves');
    const wavedIn = { ...deployed, wavesDone: 3 };
    expect(nextK1Step(wavedIn)).toBe('activate');
    const ready = { ...wavedIn, activated: true };
    expect(nextK1Step(ready)).toBe('ready');
    expect(k1AccountIsUsable(ready)).toBe(true);
  });

  it('keys one account per user per network', () => {
    expect(k1RecordKey('0xAbC', 'stagenet')).toBe('0xabc|stagenet');
  });
});

describe('remembering a deploy', () => {
  it('writes and reads a record back', () => {
    const storage = STORAGE();
    const record = newK1Record({
      user: '0xabc',
      network: 'stagenet',
      privateStateId: 'p',
      saltHex: '11',
      totalWaves: 3,
    });
    saveK1Record(storage, record);
    expect(storage.data.get(K1_STORAGE_KEY)).toContain('0xabc');
    expect(loadK1Record(storage, '0xABC', 'stagenet')).toEqual(record);
    expect(loadK1Record(storage, '0xabc', 'devnet')).toBeNull();
  });

  /* A browser that blocks site data, or a quota that is full, costs one extra
     deploy. It must never cost a Passport that will not open. */
  it('reads empty when the storage refuses, throws, or holds rubbish', () => {
    const throwing: K1Storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(loadK1Records(throwing)).toEqual({});

    const storage = STORAGE();
    expect(loadK1Records(storage)).toEqual({});
    storage.data.set(K1_STORAGE_KEY, 'not json');
    expect(loadK1Records(storage)).toEqual({});
    storage.data.set(K1_STORAGE_KEY, '[]');
    expect(loadK1Records(storage)).toEqual({});
    storage.data.set(K1_STORAGE_KEY, 'null');
    expect(loadK1Records(storage)).toEqual({});
  });

  it('says so in the console when a write is refused, and carries on', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const refusing: K1Storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
    };
    expect(() =>
      saveK1Record(
        refusing,
        newK1Record({ user: 'u', network: 'n', privateStateId: 'p', saltHex: '', totalWaves: 3 }),
      ),
    ).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('the use counter', () => {
  /** A ledger holding exactly one entry, the one at `at`. */
  const probeFor = (at: bigint) => ({
    entryAt: (counter: bigint) => new Uint8Array([Number(counter & 0xffn)]),
    isMember: (entry: Uint8Array) => entry[0] === Number(at & 0xffn),
  });

  it('trusts a cached counter the ledger still holds', () => {
    const probe = probeFor(5n);
    const isMember = vi.fn(probe.isMember);
    expect(resolveK1UseCounter({ ...probe, isMember }, 5n)).toBe(5n);
    expect(isMember).toHaveBeenCalledTimes(1);
  });

  /* A cache that is behind is behind by one or two — another device spent —
     so the scan carries on from where it was told rather than from zero. */
  it('scans forward when the cached counter is stale', () => {
    expect(resolveK1UseCounter(probeFor(7n), 5n)).toBe(7n);
  });

  it('scans from zero for a device it has never seen', () => {
    expect(resolveK1UseCounter(probeFor(3n))).toBe(3n);
  });

  it('gives up rather than scanning for ever', () => {
    const never = { entryAt: () => new Uint8Array([1]), isMember: () => false };
    expect(() => resolveK1UseCounter(never)).toThrow(/not one of the keys/);
    expect(K1_RESCAN_LIMIT).toBe(4096n);
  });
});

describe('the milestone switch and its links', () => {
  it('is off unless something turns it on', () => {
    expect(k1MilestoneEnabled('')).toBe(false);
    expect(k1MilestoneEnabled('?other=1')).toBe(false);
    expect(k1MilestoneEnabled('?k1=0')).toBe(false);
  });

  it('turns on for a build that is for this, or for a query on one that is not', () => {
    expect(k1MilestoneEnabled('', { VITE_K1_MILESTONE: '1' })).toBe(true);
    expect(k1MilestoneEnabled('?k1=1')).toBe(true);
    expect(k1MilestoneEnabled('?a=b&k1=1')).toBe(true);
  });

  it('links a hash to the explorer, with or without 0x', () => {
    expect(k1ExplorerLink('0xabc')).toBe('https://explorer.1am.xyz/tx/abc?network=stagenet');
    expect(k1ExplorerLink('abc', 'devnet')).toBe('https://explorer.1am.xyz/tx/abc?network=devnet');
  });
});
