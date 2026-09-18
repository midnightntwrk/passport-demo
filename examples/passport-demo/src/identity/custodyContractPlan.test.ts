import { describe, expect, it, vi } from 'vitest';

import {
  allCustodyCircuits,
  describeProveAccountCustodyFailure,
  forgetCustodyAuthorityKey,
  hexToBytes,
  custodyAccountIsUsable,
  k1ArmCircuits,
  k1EnrolmentChallenges,
  custodyExplorerLink,
  custodyFailureSentence,
  custodyGrantTwins,
  custodyLifecycleCircuits,
  accountCustodyMilestoneEnabled,
  k1OtherArm,
  custodyProvingEndpoint,
  custodyRecordKey,
  k1SamePoint,
  custodyWaveIsOnChain,
  CUSTODY_AUTHORITY_STORAGE_KEY,
  CUSTODY_PROOF_TIMEOUT_MS,
  CUSTODY_PROVE_PATH,
  CUSTODY_PROVER_UNCONFIGURED,
  CUSTODY_RESCAN_LIMIT,
  CUSTODY_SHARED_CIRCUITS,
  CUSTODY_STORAGE_KEY,
  CUSTODY_PROOF_NOT_BUILT,
  CUSTODY_UNEXPECTED,
  custodyProofNotBuilt,
  custodyProofNotBuiltDetail,
  isCustodyProofNotBuilt,
  proveAccountCustodyDetail,
  proveAccountCustodyRefused,
  CUSTODY_VERIFIER_BYTE_BUDGET,
  loadCustodyAuthorityKey,
  loadCustodyRecord,
  loadCustodyRecords,
  newCustodyRecord,
  nextCustodyStep,
  parseProveCustodyResponse,
  planCustodyWaves,
  proveAccountCustodyRequest,
  removeCustodyRecord,
  resolveCustodyUseCounter,
  saveCustodyAuthorityKey,
  saveCustodyRecord,
  type CustodyAccountRecord,
  type CustodyStorage,
} from './custodyContractPlan.js';

/**
 * The drill for the decisions the account custody layer makes.
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

const STORAGE = (): CustodyStorage & { data: Map<string, string> } => {
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
  new Map(allCustodyCircuits('k256').map((circuit) => [circuit, bytes]));

describe('the circuit roster', () => {
  it('names an arm’s eight circuits, activation first', () => {
    const circuits = k1ArmCircuits('k256');
    expect(circuits).toHaveLength(8);
    expect(circuits[0]).toBe('activate_initial_device_with_k256');
    expect(circuits).toContain('append_inbox_with_k256');
    expect(circuits).toContain('withdraw_shielded_with_k256');
  });

  it('names the grant twins and the lifecycle circuits per arm', () => {
    expect(custodyGrantTwins('jubjub')).toEqual([
      'withdraw_unshielded_with_grant_jubjub',
      'withdraw_shielded_with_grant_jubjub',
      'withdraw_shielded_to_contract_with_grant_jubjub',
    ]);
    expect(custodyLifecycleCircuits('k256')).toEqual([
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
    expect(allCustodyCircuits('k256')).toHaveLength(30);
    expect(allCustodyCircuits('jubjub')).toHaveLength(30);
    expect(new Set(allCustodyCircuits())).toEqual(new Set(allCustodyCircuits('jubjub')));
    expect(allCustodyCircuits()[0]).toBe(CUSTODY_SHARED_CIRCUITS[0]);
  });
});

describe('the wave plan', () => {
  it('leads with the deposits and the whole of the first arm', () => {
    const waves = planCustodyWaves(evenSizes(), 'k256');
    expect(waves[0]?.index).toBe(1);
    expect(waves[0]?.circuits).toEqual([...CUSTODY_SHARED_CIRCUITS, ...k1ArmCircuits('k256')]);
    /* The property that matters: the account is activatable after wave 1. */
    expect(waves[0]?.circuits).toContain('activate_initial_device_with_k256');
    expect(waves[0]?.circuits).toContain('append_inbox_with_k256');
  });

  it('plans the measured roster as three waves and covers every circuit', () => {
    const waves = planCustodyWaves(evenSizes(), 'k256');
    expect(waves).toHaveLength(3);
    expect(waves.flatMap((wave) => wave.circuits).sort()).toEqual(allCustodyCircuits('k256').sort());
  });

  it('keeps every maintenance wave under the measured budget', () => {
    const sizes = evenSizes();
    for (const wave of planCustodyWaves(sizes, 'k256').slice(1)) {
      const used = wave.circuits.reduce((total, id) => total + (sizes.get(id) as number), 0);
      expect(used).toBeLessThanOrEqual(CUSTODY_VERIFIER_BYTE_BUDGET);
    }
  });

  it('retires the authority on the last wave, and only the last', () => {
    const waves = planCustodyWaves(evenSizes(), 'k256');
    expect(waves.filter((wave) => wave.retiresAuthority)).toHaveLength(1);
    expect(waves[waves.length - 1]?.retiresAuthority).toBe(true);
  });

  it('leaves the authority alone when told to', () => {
    expect(planCustodyWaves(evenSizes(), 'k256', false).some((w) => w.retiresAuthority)).toBe(false);
  });

  /* A key bigger than the whole budget is a plan that cannot land: a wave of
     its own is still over the ceiling, and the node refuses it at submission
     with a message naming neither the circuit nor the size — after the sponsor
     has paid. The reference stops here and so does this. */
  it('refuses a key bigger than the whole budget, naming it', () => {
    const sizes = evenSizes();
    sizes.set('activate_initial_device_with_jubjub', CUSTODY_VERIFIER_BYTE_BUDGET + 1);
    expect(() => planCustodyWaves(sizes, 'k256')).toThrow(
      /activate_initial_device_with_jubjub.*exceeds the per-update budget/,
    );
  });

  it('refuses a roster it has no size for', () => {
    const sizes = evenSizes();
    sizes.delete('append_inbox_with_jubjub');
    expect(() => planCustodyWaves(sizes, 'k256')).toThrow(/append_inbox_with_jubjub/);
  });
});

describe('the proving endpoint', () => {
  it('hangs off the origin it is given', () => {
    expect(custodyProvingEndpoint('https://example.test/balancer')).toBe(
      `https://example.test/balancer${CUSTODY_PROVE_PATH}`,
    );
  });

  it('does not double a slash', () => {
    expect(custodyProvingEndpoint('https://example.test/balancer//')).toBe(
      `https://example.test/balancer${CUSTODY_PROVE_PATH}`,
    );
  });

  it('refuses rather than guessing when nothing is configured', () => {
    expect(() => custodyProvingEndpoint(null)).toThrow(CUSTODY_PROVER_UNCONFIGURED);
    expect(() => custodyProvingEndpoint('   ')).toThrow(CUSTODY_PROVER_UNCONFIGURED);
    expect(() => custodyProvingEndpoint(undefined)).toThrow(CUSTODY_PROVER_UNCONFIGURED);
  });
});

describe('the proving request and reply', () => {
  it('carries every circuit, the transaction as hex, and the network', () => {
    expect(
      proveAccountCustodyRequest(['append_inbox_with_k256'], new Uint8Array([0xde, 0xad]), 'stagenet'),
    ).toEqual({ circuits: ['append_inbox_with_k256'], unprovenTx: 'dead', network: 'stagenet' });
  });

  it('carries BOTH circuits of a composed transaction', () => {
    expect(
      proveAccountCustodyRequest(
        ['withdraw_shielded_to_contract_with_k256', 'deposit_shielded'],
        new Uint8Array([0x01]),
        'stagenet',
      ).circuits,
    ).toEqual(['withdraw_shielded_to_contract_with_k256', 'deposit_shielded']);
  });

  it('refuses a request that names no circuit at all', () => {
    expect(() => proveAccountCustodyRequest([], new Uint8Array([0x01]), 'stagenet')).toThrow(
      /name the circuits/,
    );
  });

  it('reads a proven transaction back, with or without 0x', () => {
    expect(parseProveCustodyResponse({ provenTx: 'beef' })).toEqual(new Uint8Array([0xbe, 0xef]));
    expect(parseProveCustodyResponse({ provenTx: '0xBEEF' })).toEqual(new Uint8Array([0xbe, 0xef]));
  });

  /* A reverse proxy answering 200 with an HTML error page is the failure this
     guards, and it must name the shape rather than dying inside a WASM
     deserialiser four frames later. */
  it('refuses a 200 that is not a proven transaction', () => {
    for (const body of [null, {}, { provenTx: 7 }, { provenTx: '<html>' }]) {
      expect(() => parseProveCustodyResponse(body)).toThrow(/without a proven transaction/);
    }
  });

  it('says what the service refused with, for a console', () => {
    expect(describeProveAccountCustodyFailure(503, { error: 'busy', detail: 'all workers in use' })).toBe(
      '[account-custody] the proving service refused with HTTP 503 (busy) — all workers in use',
    );
    expect(describeProveAccountCustodyFailure(500, null)).toBe(
      '[account-custody] the proving service refused with HTTP 500 (unknown)',
    );
    expect(describeProveAccountCustodyFailure(400, { error: '', detail: '' })).toBe(
      '[account-custody] the proving service refused with HTTP 400 (unknown)',
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
  const base = (): CustodyAccountRecord =>
    newCustodyRecord({
      user: '0xABCDEF',
      network: 'stagenet',
      privateStateId: 'passport-account-custody-abcdef',
      saltHex: '00'.repeat(32),
      totalWaves: 3,
    });

  it('starts before the deploy, lower-cased', () => {
    const record = base();
    expect(record.user).toBe('0xabcdef');
    expect(nextCustodyStep(record)).toBe('deploy');
    expect(custodyAccountIsUsable(record)).toBe(false);
  });

  it('walks deploy → waves → activate → ready', () => {
    const deployed = { ...base(), address: 'aa'.repeat(32), wavesDone: 1 };
    expect(nextCustodyStep(deployed)).toBe('waves');
    const wavedIn = { ...deployed, wavesDone: 3 };
    expect(nextCustodyStep(wavedIn)).toBe('activate');
    const ready = { ...wavedIn, activated: true };
    expect(nextCustodyStep(ready)).toBe('ready');
    expect(custodyAccountIsUsable(ready)).toBe(true);
  });

  it('keys one account per user per network', () => {
    expect(custodyRecordKey('0xAbC', 'stagenet')).toBe('0xabc|stagenet');
  });
});

describe('remembering a deploy', () => {
  it('writes and reads a record back', () => {
    const storage = STORAGE();
    const record = newCustodyRecord({
      user: '0xabc',
      network: 'stagenet',
      privateStateId: 'p',
      saltHex: '11',
      totalWaves: 3,
    });
    saveCustodyRecord(storage, record);
    expect(storage.data.get(CUSTODY_STORAGE_KEY)).toContain('0xabc');
    expect(loadCustodyRecord(storage, '0xABC', 'stagenet')).toEqual(record);
    expect(loadCustodyRecord(storage, '0xabc', 'devnet')).toBeNull();
  });

  /* A browser that blocks site data, or a quota that is full, costs one extra
     deploy. It must never cost a Passport that will not open. */
  it('reads empty when the storage refuses, throws, or holds rubbish', () => {
    const throwing: CustodyStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(loadCustodyRecords(throwing)).toEqual({});

    const storage = STORAGE();
    expect(loadCustodyRecords(storage)).toEqual({});
    storage.data.set(CUSTODY_STORAGE_KEY, 'not json');
    expect(loadCustodyRecords(storage)).toEqual({});
    storage.data.set(CUSTODY_STORAGE_KEY, '[]');
    expect(loadCustodyRecords(storage)).toEqual({});
    storage.data.set(CUSTODY_STORAGE_KEY, 'null');
    expect(loadCustodyRecords(storage)).toEqual({});
  });

  it('says so in the console when a write is refused, and carries on', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const refusing: CustodyStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
    };
    expect(() =>
      saveCustodyRecord(
        refusing,
        newCustodyRecord({ user: 'u', network: 'n', privateStateId: 'p', saltHex: '', totalWaves: 3 }),
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
    expect(resolveCustodyUseCounter({ ...probe, isMember }, 5n)).toBe(5n);
    expect(isMember).toHaveBeenCalledTimes(1);
  });

  /* A cache that is behind is behind by one or two — another device spent —
     so the scan carries on from where it was told rather than from zero. */
  it('scans forward when the cached counter is stale', () => {
    expect(resolveCustodyUseCounter(probeFor(7n), 5n)).toBe(7n);
  });

  it('scans from zero for a device it has never seen', () => {
    expect(resolveCustodyUseCounter(probeFor(3n))).toBe(3n);
  });

  it('gives up rather than scanning for ever', () => {
    const never = { entryAt: () => new Uint8Array([1]), isMember: () => false };
    expect(() => resolveCustodyUseCounter(never)).toThrow(/not one of the keys/);
    expect(CUSTODY_RESCAN_LIMIT).toBe(4096n);
  });
});

describe('the milestone switch and its links', () => {
  it('is off unless something turns it on', () => {
    expect(accountCustodyMilestoneEnabled('')).toBe(false);
    expect(accountCustodyMilestoneEnabled('?other=1')).toBe(false);
    expect(accountCustodyMilestoneEnabled('?custody=0')).toBe(false);
  });

  it('turns on for a build that is for this, or for a query on one that is not', () => {
    expect(accountCustodyMilestoneEnabled('', { VITE_ACCOUNT_CUSTODY_MILESTONE: '1' })).toBe(true);
    expect(accountCustodyMilestoneEnabled('?custody=1')).toBe(true);
    expect(accountCustodyMilestoneEnabled('?a=b&custody=1')).toBe(true);
  });

  it('links a hash to the explorer, with or without 0x', () => {
    expect(custodyExplorerLink('0xabc')).toBe('https://explorer.1am.xyz/tx/abc?network=stagenet');
    expect(custodyExplorerLink('abc', 'devnet')).toBe('https://explorer.1am.xyz/tx/abc?network=devnet');
  });
});

describe('the resume rule', () => {
  const wave = { index: 2, circuits: ['a', 'b'], retiresAuthority: false };

  /* THE RECORD IS A HINT AND THE CHAIN IS THE ANSWER. Both directions are held
     here because both were reachable and only one of them is loud: replaying a
     landed wave costs a sponsored rejection, and skipping a dropped one leaves
     ten circuits that nothing can ever add, silently. */
  it('skips a wave the chain already carries in full', () => {
    expect(custodyWaveIsOnChain(wave, new Set(['a', 'b', 'c']))).toBe(true);
  });

  it('does not skip a wave the chain carries only part of', () => {
    expect(custodyWaveIsOnChain(wave, new Set(['a']))).toBe(false);
    expect(custodyWaveIsOnChain(wave, new Set())).toBe(false);
  });

  it('is terminal once the key that finishes a setup is gone', () => {
    const half: CustodyAccountRecord = {
      ...newCustodyRecord({
        user: 'u',
        network: 'n',
        privateStateId: 'p',
        saltHex: '',
        totalWaves: 3,
      }),
      address: 'aa'.repeat(32),
      wavesDone: 1,
      interrupted: true,
    };
    expect(nextCustodyStep(half)).toBe('interrupted');
    expect(custodyAccountIsUsable(half)).toBe(false);
  });
});

describe('throwing a half-built Passport away', () => {
  it('removes the record and leaves anything else stored alone', () => {
    const storage = STORAGE();
    saveCustodyRecord(storage, newCustodyRecord({ user: 'a', network: 'n', privateStateId: 'p', saltHex: '', totalWaves: 3 }));
    saveCustodyRecord(storage, newCustodyRecord({ user: 'b', network: 'n', privateStateId: 'p', saltHex: '', totalWaves: 3 }));
    removeCustodyRecord(storage, 'A', 'n');
    expect(loadCustodyRecord(storage, 'a', 'n')).toBeNull();
    expect(loadCustodyRecord(storage, 'b', 'n')).not.toBeNull();
  });
});

describe('the maintenance signing key', () => {
  const KEY = { tag: 'bip340', value: 'ff'.repeat(32) };

  /* IT IS PERSISTED, AND THAT IS THE WHOLE POINT. The provider this app builds
     is in-memory, so without this a reload between wave 1 and wave 3 left a
     live account nobody could finish. */
  it('is remembered per address and read back', () => {
    const storage = STORAGE();
    saveCustodyAuthorityKey(storage, 'AA'.repeat(32), KEY);
    expect(loadCustodyAuthorityKey(storage, 'aa'.repeat(32))).toEqual(KEY);
    expect(storage.data.has(CUSTODY_AUTHORITY_STORAGE_KEY)).toBe(true);
  });

  it('takes a key that is a plain string too', () => {
    const storage = STORAGE();
    saveCustodyAuthorityKey(storage, 'bb'.repeat(32), 'a-signing-key');
    expect(loadCustodyAuthorityKey(storage, 'bb'.repeat(32))).toBe('a-signing-key');
  });

  it('reads absent for an address it has never held, and for rubbish', () => {
    const storage = STORAGE();
    expect(loadCustodyAuthorityKey(storage, 'cc'.repeat(32))).toBeNull();
    storage.data.set(CUSTODY_AUTHORITY_STORAGE_KEY, JSON.stringify({ [`${'dd'.repeat(32)}`]: 7 }));
    expect(loadCustodyAuthorityKey(storage, 'dd'.repeat(32))).toBeNull();
  });

  /* The retirement lands, the key authorises nothing, and it is deleted rather
     than left in a browser for ever. */
  it('is deleted once it is of no further use', () => {
    const storage = STORAGE();
    saveCustodyAuthorityKey(storage, 'ee'.repeat(32), KEY);
    forgetCustodyAuthorityKey(storage, 'EE'.repeat(32));
    expect(loadCustodyAuthorityKey(storage, 'ee'.repeat(32))).toBeNull();
  });
});

describe('enrolling a signed-in key', () => {
  it('asks for two distinct messages', () => {
    const [first, second] = k1EnrolmentChallenges('m');
    expect(first).toBe('m');
    expect(second).not.toBe(first);
  });

  it('compares two recovered points by their coordinates', () => {
    expect(k1SamePoint({ x: 1n, y: 2n }, { x: 1n, y: 2n })).toBe(true);
    expect(k1SamePoint({ x: 1n, y: 2n }, { x: 1n, y: 3n })).toBe(false);
    expect(k1SamePoint({ x: 1n, y: 2n }, { x: 4n, y: 2n })).toBe(false);
  });
});

describe('what a screen is allowed to paint', () => {
  it('paints a sentence this layer wrote', () => {
    expect(custodyFailureSentence(new Error('Try again in a moment.'))).toBe('Try again in a moment.');
  });

  /* A CAUSE IS NOT COPY. These are the shapes that actually arrive — a vendor
     string, a node rejection, a thrown value that is not an Error at all — and
     every one of them would put a word on screen that the demo keeps off it. */
  it('refuses a cause carrying vocabulary a reader has no use for', () => {
    expect(custodyFailureSentence(new Error('contract state not found'))).toBe(CUSTODY_UNEXPECTED);
    expect(custodyFailureSentence(new Error('1010: Invalid Transaction: DustDoubleSpend'))).toBe(
      CUSTODY_UNEXPECTED,
    );
    expect(custodyFailureSentence(new Error('the SDK returned nothing'))).toBe(CUSTODY_UNEXPECTED);
    expect(custodyFailureSentence(new Error('no wallet address for this session'))).toBe(CUSTODY_UNEXPECTED);
  });

  /* A RUNTIME ERROR IS NEVER ONE OF OURS, however short and however clean.
     This exact string reached a screen on 2026/09/17: sixty-six characters,
     none of the vocabulary above, and unmistakably not a sentence. */
  it('refuses a runtime error thrown by a library reading something odd', () => {
    expect(
      custodyFailureSentence(
        new TypeError("Cannot use 'in' operator to search for 'deploy' in undefined"),
      ),
    ).toBe(CUSTODY_UNEXPECTED);
    expect(custodyFailureSentence(new RangeError('Invalid array length'))).toBe(CUSTODY_UNEXPECTED);
    expect(custodyFailureSentence(new ReferenceError('x is not defined'))).toBe(CUSTODY_UNEXPECTED);
    /* And our own refusals are untouched. */
    expect(custodyFailureSentence(new Error('Type the name you want to pay.'))).toBe(
      'Type the name you want to pay.',
    );
  });

  it('refuses an empty message, a stack-shaped one, and a thrown non-error', () => {
    expect(custodyFailureSentence(new Error('   '))).toBe(CUSTODY_UNEXPECTED);
    expect(custodyFailureSentence(new Error('x'.repeat(161)))).toBe(CUSTODY_UNEXPECTED);
    expect(custodyFailureSentence('just a string')).toBe(CUSTODY_UNEXPECTED);
  });
});

describe('the proving deadline', () => {
  /* ABOVE THE SERVICE'S OWN 180 SECONDS, so a slow proof still comes back as
     the service's answer rather than as a browser giving up first. */
  it('is longer than the deadline the service keeps', () => {
    expect(CUSTODY_PROOF_TIMEOUT_MS).toBeGreaterThan(180_000);
  });
});

describe('a proving service that ran and declined to prove', () => {
  /* THE DEFECT THIS CATCHES stopped the first live spend of a change coin.
     A wrong candidate position is an unsatisfiable constraint system, and the
     only place that shows itself is the prover declining — which the client
     collapsed into "the service is not answering", telling the retry the
     position was fine and the network was not. The second candidate was never
     tried (2026/09/18, the service answered 400 while being up). */
  it('is told apart from a service that is not answering', () => {
    expect(proveAccountCustodyRefused({ error: 'proving-failed', detail: '…' })).toBe(true);
    expect(proveAccountCustodyRefused({ error: 'prover-unavailable' })).toBe(false);
    expect(proveAccountCustodyRefused({ error: 'busy' })).toBe(false);
    expect(proveAccountCustodyRefused(null)).toBe(false);
    expect(proveAccountCustodyRefused('not an object')).toBe(false);
  });

  /* The signal is the error's NAME, so the sentence a person reads stays the
     plain one — no talk of witnesses or constraints on a screen somebody
     reached by choosing Google. */
  it('carries the signal on the name and a plain sentence in the message', () => {
    const error = custodyProofNotBuilt();
    expect(isCustodyProofNotBuilt(error)).toBe(true);
    expect(error.message).toBe(CUSTODY_PROOF_NOT_BUILT);
    expect(error.message).not.toMatch(/witness|constraint|merkle/i);
    expect(custodyFailureSentence(error)).toBe(CUSTODY_PROOF_NOT_BUILT);
  });

  it('is not confused with any other error', () => {
    expect(isCustodyProofNotBuilt(new Error(CUSTODY_PROOF_NOT_BUILT))).toBe(false);
    expect(isCustodyProofNotBuilt('a string')).toBe(false);
    expect(isCustodyProofNotBuilt(null)).toBe(false);
  });

  /* THE SCENARIO: a wrong candidate position, refused by the proof server,
     inside midnight-js's own wrapper. That is the shape the refusal really
     arrives in — `submitTx` builds a new plain Error carrying our name and
     message as text and no `cause` — and reading only `cause.name` made the
     wrong-position retry sit out the one failure it exists for (live,
     2026/09/18). */
  it('sees the refusal through the wrapper midnight-js submits through', () => {
    const wrapped = new Error(
      `Unexpected error submitting scoped transaction '<unnamed>': ` +
        `CustodyProofNotBuilt: ${CUSTODY_PROOF_NOT_BUILT}`,
    );
    expect(isCustodyProofNotBuilt(wrapped)).toBe(true);
  });

  it('sees the refusal through a wrapper that does set a cause', () => {
    const wrapped = new Error('Unexpected error submitting scoped transaction', {
      cause: custodyProofNotBuilt(),
    });
    expect(isCustodyProofNotBuilt(wrapped)).toBe(true);
  });

  /* A cause chain that points at itself must not hang the tab, and a chain of
     unrelated errors must still say no. */
  it('gives up on a circular cause chain rather than following it', () => {
    const looping = new Error('one');
    looping.cause = looping;
    expect(isCustodyProofNotBuilt(looping)).toBe(false);
  });

  /* ---------------------------------------------------------------------- */
  /* WHAT THE SERVICE SAID, WHICH IS NOT WHAT THE PERSON READS (A2)          */
  /*                                                                        */
  /* The code `proving-failed` says the prover RAN and declined. A wrong     */
  /* candidate position is one thing that reaches; a verifier key that does  */
  /* not match is another. Rotating on the code alone cost up to ten         */
  /* approvals for a failure no position could fix, so the retry judges the  */
  /* service's own words — which travel on the error and reach no screen.    */
  /* ---------------------------------------------------------------------- */

  it('reads the detail off a refusal body, and nothing off one without it', () => {
    expect(
      proveAccountCustodyDetail({ error: 'proving-failed', detail: 'unsatisfiable constraints' }),
    ).toBe('unsatisfiable constraints');
    expect(proveAccountCustodyDetail({ error: 'proving-failed' })).toBeNull();
    expect(proveAccountCustodyDetail({ error: 'proving-failed', detail: '   ' })).toBeNull();
    expect(proveAccountCustodyDetail({ detail: 42 })).toBeNull();
    expect(proveAccountCustodyDetail(null)).toBeNull();
  });

  it('carries the detail on the error, and keeps it out of the sentence', () => {
    const error = custodyProofNotBuilt('The proof server could not prove it: unsatisfiable');
    expect(custodyProofNotBuiltDetail(error)).toBe(
      'The proof server could not prove it: unsatisfiable',
    );
    /* THE ONLY THING SOMEBODY READS is still the plain sentence. */
    expect(error.message).toBe(CUSTODY_PROOF_NOT_BUILT);
    expect(custodyFailureSentence(error)).toBe(CUSTODY_PROOF_NOT_BUILT);
  });

  it('says nothing for a refusal that carried no words, or no error at all', () => {
    expect(custodyProofNotBuiltDetail(custodyProofNotBuilt())).toBeNull();
    expect(custodyProofNotBuiltDetail(custodyProofNotBuilt(''))).toBeNull();
    expect(custodyProofNotBuiltDetail(new Error('something else'))).toBeNull();
    expect(custodyProofNotBuiltDetail('not an error')).toBeNull();
  });

  it('finds the detail through a wrapper that set a cause', () => {
    const wrapped = new Error('Unexpected error submitting scoped transaction', {
      cause: custodyProofNotBuilt('unsatisfiable constraint system'),
    });
    expect(custodyProofNotBuiltDetail(wrapped)).toBe('unsatisfiable constraint system');
  });

  it('gives up on a circular cause chain rather than following it for a detail', () => {
    const looping = new Error('one');
    looping.cause = looping;
    expect(custodyProofNotBuiltDetail(looping)).toBeNull();
  });
});

describe("a library's preamble around our own sentence", () => {
  /* THE DEFECT THIS CATCHES put a library's internals on the screen over a
     payment somebody had approved (live, 2026/09/18). midnight-js re-throws
     what it catches with its own words in front, and the result was short,
     carried none of the forbidden vocabulary, and was not a runtime error — so
     every check passed it. */
  it('paints our sentence, not the wrapper midnight-js put round it', () => {
    expect(
      custodyFailureSentence(
        new Error(
          "Unexpected error submitting scoped transaction '<unnamed>': Error: The service that finishes this step is not answering right now. Try again in a moment.",
        ),
      ),
    ).toBe('The service that finishes this step is not answering right now. Try again in a moment.');
  });

  /* And a wrapper with nothing of ours inside it still meets every check —
     the unwrapping finds words, not permission. */
  /* Any error NAME, not only ones spelled "…Error": `CustodyProofNotBuilt`
     leaked through a suffix-shaped pattern on 2026/09/18. */
  it('unwraps an error name that does not end in Error', () => {
    expect(
      custodyFailureSentence(
        new Error(
          "Unexpected error submitting scoped transaction '<unnamed>': CustodyProofNotBuilt: That payment could not be completed just now. Try again in a moment.",
        ),
      ),
    ).toBe('That payment could not be completed just now. Try again in a moment.');
  });

  it('refuses a wrapper whose inside is the vocabulary too', () => {
    expect(
      custodyFailureSentence(new Error('Error: contract state could not be deserialised')),
    ).toBe(CUSTODY_UNEXPECTED);
  });

  it('refuses a wrapper whose inside is still machine-shaped and long', () => {
    expect(
      custodyFailureSentence(
        new Error(`Error: ${'a call into the runtime failed for a reason nobody wrote down '.repeat(4)}`),
      ),
    ).toBe(CUSTODY_UNEXPECTED);
  });

  /* A STACK OF RE-THROWS comes off in one pass, because the innermost message
     begins after the LAST name however many there are. */
  it('unwraps a stack of re-throws down to the sentence at the bottom', () => {
    expect(
      custodyFailureSentence(
        new Error(
          'AError: BError: CustodyProofNotBuilt: DError: There is nothing of that kind in this Passport to send.',
        ),
      ),
    ).toBe('There is nothing of that kind in this Passport to send.');
  });

  /* A plain sentence of ours is untouched. */
  it('leaves a sentence with no preamble exactly as it is', () => {
    expect(custodyFailureSentence(new Error('There is nothing of that kind in this Passport to send.'))).toBe(
      'There is nothing of that kind in this Passport to send.',
    );
  });
});
