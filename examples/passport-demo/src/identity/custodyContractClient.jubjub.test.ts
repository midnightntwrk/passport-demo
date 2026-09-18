import { createRequire } from 'node:module';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The passkey (jubjub) arm of the custody client, drilled through its seams.
 *
 * WHY THERE IS A SECOND FILE AND NOT A LONGER FIRST ONE.
 * `custodyContractClient.test.ts` drives the k256 arm through a fake Dynamic
 * and a fake `pureCircuits`; everything here is the OTHER arm, and it is held
 * against the REAL compiled `account-custody` build rather than a tagging fake,
 * because what the jubjub branches get wrong is the shape of what they hand a
 * circuit — an activation with an envelope the contract has no field for, an
 * entry derived for the wrong arm, a challenge builder passed where finished
 * bytes were expected. A fake that answers every call agrees with all of those.
 *
 * WHY THESE ARE BEHAVIOUR DRILLS AND NOT A PERCENTAGE. `custodyContractClient.ts`
 * is deliberately OFF the 100% coverage allow-list in `vitest.config.ts`, and it
 * stays off: it is the half of the layer with the sockets on the end — a wallet,
 * an indexer, a proving service, and midnight-js's deploy and call entry points
 * — and every decision it makes has been lifted into `custodyContractPlan.ts` so
 * that what is left is wiring. A percentage over wiring measures how much of
 * midnight-js a fake can imitate. So what is held here is named behaviour: which
 * circuit was called, with which arguments, in which order, and what was written
 * down afterwards.
 *
 * THE WAVE PLAN IS A SEAM HERE, AND ONLY HERE. `deployCustodyAccount` asks
 * `planCustodyWaves` for a plan and never passes its third argument, so every
 * account this app deploys today RETIRES its maintenance authority on the last
 * wave. The derived-authority path exists for the day that changes, and a rule
 * with no reachable branch is a rule nobody has read — so the plan is mocked to
 * answer the other way for the drills that need it, and the client is otherwise
 * untouched.
 */

/** Which answer `planCustodyWaves` gives this test; `true` is what the app gets. */
const planning = vi.hoisted(() => ({ retireAuthority: true }));

vi.mock('./custodyContractPlan.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./custodyContractPlan.js')>();
  return {
    ...actual,
    planCustodyWaves: (sizes: ReadonlyMap<string, number>, firstArm: 'jubjub' | 'k256') =>
      actual.planCustodyWaves(sizes, firstArm, planning.retireAuthority),
  };
});

import {
  bytesToHex,
  type CurvePoint,
  type CustodyPureCircuits,
} from './custodyContractSigning.js';
import {
  allCustodyCircuits,
  hexToBytes,
  loadCustodyAuthorityKey,
  type CustodyStorage,
} from './custodyContractPlan.js';
import { jubjubDeviceSigner } from './custodyJubjubSigner.js';
import {
  deployCustodyAccount,
  resetCustodySessionState,
  type CustodyContractModule,
  type CustodyDeps,
  type CustodyDynamicSession,
  type CustodyLedgerApi,
  type CustodyPasskeyDevice,
} from './custodyContractClient.js';

/* -------------------------------------------------------------------------- */
/* The real build                                                             */
/* -------------------------------------------------------------------------- */

const requireFromTest = createRequire(import.meta.url);
const compiled = requireFromTest(
  '../../contracts/stagenet/account-custody/contract/index.js',
) as { pureCircuits: CustodyPureCircuits };

/** The real `pureCircuits`, which satisfies {@link CustodyPureCircuits} structurally. */
const pure: CustodyPureCircuits = compiled.pureCircuits;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const ADDRESS = 'ab'.repeat(32);

/** A device scalar. Fixed rather than derived: the derivation is drilled next door. */
const DEVICE_SCALAR = 0x51ee_2a3b_9c4d_7e18n;

/** `derivePassportContractSecrets(...).maintenanceSecret`, as the passkey hands it down. */
const MAINTENANCE_SECRET = 'c3'.repeat(32);

/**
 * The passkey's device, with whichever of the two derived secrets this drill
 * means to hand down.
 *
 * It is a {@link JubjubSigner} as well as an identity, because a gated call
 * needs one that can sign; deploy and activation take the identity half.
 */
function passkeyDevice(
  secrets: Pick<CustodyPasskeyDevice, 'encSecretKeyHex' | 'maintenanceSecretHex'> = {},
): CustodyPasskeyDevice & { sign: ReturnType<typeof jubjubDeviceSigner>['sign'] } {
  const signer = jubjubDeviceSigner({ pure, secretScalar: DEVICE_SCALAR });
  return { ...signer, ...secrets };
}

/**
 * The Dynamic session a passkey Passport carries: an address for the storage
 * key it does NOT use, and a `signRaw` that must never be reached.
 *
 * A passkey account is filed under `custodyUserKey`'s `jubjub:` key and signs
 * with its own scalar. Anything on this arm that asks a vendor to sign is a
 * branch that took the k256 path by mistake, and this is how it says so.
 */
const session: CustodyDynamicSession = {
  address: '0xAbCdEf0000000000000000000000000000000001',
  signRaw: () => Promise.reject(new Error('the passkey arm never asks Dynamic to sign')),
};

const storageFake = (): CustodyStorage & { data: Map<string, string> } => {
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

/** The chain, as much of it as this module can see. */
interface FakeChain {
  authNonce: bigint;
  epoch: bigint;
  devices: Set<string>;
  authorityCounter: bigint;
  deployed: boolean;
  operations: Set<string>;
}

function moduleFake(chain: FakeChain): CustodyContractModule {
  return {
    pureCircuits: pure,
    Contract: class {},
    ledger: () => ({
      auth_nonce: chain.authNonce,
      device_epoch: chain.epoch,
      device_count: BigInt(chain.devices.size),
      booted: chain.devices.size > 0,
      devices: { member: (entry: Uint8Array) => chain.devices.has(bytesToHex(entry)) },
    }),
  };
}

/** What a submitted transaction would do to the chain if the node applied it. */
interface FakeTx {
  kind: 'tx';
  deploys: string[] | null;
  inserts: string[] | null;
}

/** An intent whose `add*` calls return a NEW intent, as the wasm binding's do. */
function intentFake(deploys: string[] | null, inserts: string[] | null) {
  return {
    kind: 'tx' as const,
    deploys,
    inserts,
    addDeploy(deploy: unknown) {
      return intentFake((deploy as { circuits: string[] }).circuits, inserts);
    },
    addMaintenanceUpdate(update: unknown) {
      return intentFake(deploys, (update as { circuits: string[] }).circuits);
    },
  };
}

/** The ledger-v9 constructors, as objects that record what they were built with. */
function ledgerFake(chain: FakeChain, built: unknown[][], signed: unknown[]): CustodyLedgerApi {
  class State {
    data: unknown = null;
    maintenanceAuthority = { counter: chain.authorityCounter };
    private ops = new Map<string, unknown>();
    static deserialize(raw: Uint8Array): State {
      const state = new State();
      state.maintenanceAuthority = { counter: chain.authorityCounter };
      const roster = raw[0] === 30 ? allCustodyCircuits('jubjub') : [...chain.operations];
      state.data = raw[0] === 30 ? 'constructor-state' : 'chain-state';
      for (const circuit of roster) state.ops.set(circuit, `op:${circuit}`);
      return state;
    }
    operation(circuit: string): unknown {
      return this.ops.get(circuit);
    }
    setOperation(circuit: string, operation: unknown): void {
      this.ops.set(circuit, operation);
    }
    serialize(): Uint8Array {
      return new Uint8Array([this.ops.size]);
    }
    get operationIds(): string[] {
      return [...this.ops.keys()];
    }
  }
  return {
    /* 32 bytes of BIP-340 secret in, an opaque key out, tagged so a drill can
       say WHICH key signed a maintenance update. */
    signingKeyFromBip340: (data: Uint8Array) => ({ bip340: bytesToHex(data) }),
    signatureVerifyingKey: (key: unknown) => ({ verifying: key }),
    ContractState: State,
    ContractDeploy: class {
      address = ADDRESS;
      circuits: string[];
      constructor(state: unknown) {
        this.circuits = (state as State).operationIds;
        built.push(['deploy', this.circuits.length]);
      }
    },
    ContractMaintenanceAuthority: class {
      constructor(committee: unknown[], threshold: number, counter: bigint) {
        built.push(['authority', committee.length, threshold, counter]);
      }
    },
    ContractOperationVersionedVerifierKey: class {
      constructor(version: string, key: Uint8Array) {
        built.push(['vk', version, key.length]);
      }
    },
    Intent: { new: () => intentFake(null, null) },
    MaintenanceUpdate: class {
      dataToSign = new Uint8Array([1]);
      circuits: string[];
      constructor(address: string, updates: unknown[], counter: bigint) {
        this.circuits = updates
          .filter((update): update is { circuit: string } =>
            typeof (update as { circuit?: unknown }).circuit === 'string')
          .map((update) => update.circuit);
        built.push(['update', address, updates.length, counter]);
      }
      addSignature(): unknown {
        return this;
      }
    },
    ReplaceAuthority: class {
      constructor() {
        built.push(['retire']);
      }
    },
    Transaction: {
      fromParts: (_network: string, _g: undefined, _f: undefined, intent: unknown) => intent,
    },
    VerifierKeyInsert: class {
      constructor(readonly circuit: string) {
        built.push(['insert', circuit]);
      }
    },
    signData: (key: unknown) => {
      signed.push(key);
      return 'signature';
    },
    networkId: () => 'stagenet',
  };
}

interface Harness {
  deps: Partial<CustodyDeps>;
  storage: ReturnType<typeof storageFake>;
  chain: FakeChain;
  /** Every ledger primitive the run built, in order. */
  built: unknown[][];
  /** Every key a maintenance update was signed with. */
  signed: unknown[];
  /** Every circuit called, with the arguments it was called with. */
  calls: { circuit: string; args: unknown[] }[];
  /** Every key written to the private-state provider. */
  storedKeys: unknown[];
}

function harness(
  overrides: {
    /** What a durable private-state provider would answer; null is this app's. */
    providerSigningKey?: unknown;
  } = {},
): Harness {
  const chain: FakeChain = {
    authNonce: 0n,
    epoch: 0n,
    devices: new Set<string>(),
    authorityCounter: 0n,
    deployed: false,
    operations: new Set<string>(),
  };
  const storage = storageFake();
  const built: unknown[][] = [];
  const signed: unknown[] = [];
  const storedKeys: unknown[] = [];
  const calls: { circuit: string; args: unknown[] }[] = [];
  const state = { submits: 0, clock: 1_700_000_000_000 };

  const providers: Record<string, unknown> = {
    zkConfigProvider: {
      getVerifierKey: (circuit: string) =>
        Promise.resolve(
          allCustodyCircuits('jubjub').includes(circuit) ? new Uint8Array(2_400) : null,
        ),
    },
    publicDataProvider: {
      queryContractState: () =>
        Promise.resolve(
          chain.deployed
            ? { serialize: () => new Uint8Array([chain.operations.size]), data: 'state' }
            : null,
        ),
    },
    privateStateProvider: {
      setContractAddress: () => undefined,
      setSigningKey: (_address: string, key: unknown) => {
        storedKeys.push(key);
        return Promise.resolve(undefined);
      },
      getSigningKey: () =>
        Promise.resolve(
          'providerSigningKey' in overrides ? overrides.providerSigningKey : 'the-signing-key',
        ),
      set: () => Promise.resolve(undefined),
    },
    compiledContract: { label: 'passport-account-custody' },
    indexerHttpUrl: '',
    deserialiseUnbound: (bytes: Uint8Array) => ({ proven: bytes.length }),
  };

  const callTx = new Proxy(
    {},
    {
      get:
        (_target, circuit: string) =>
        (...args: unknown[]) => {
          calls.push({ circuit, args });
          if (circuit.startsWith('activate_initial_device')) {
            /* The seam, as the contract runs it: the activation opens the boot
               commitment and inserts the real address-bound entry at epoch 0,
               counter 0. Derived with the REAL circuit, so a client that
               derived it any other way finds no device to use. */
            chain.devices.add(
              bytesToHex(
                pure.derive_device_entry_with_jubjub(
                  { bytes: hexToBytes(ADDRESS) },
                  args[0] as CurvePoint,
                  chain.epoch,
                  0n,
                ),
              ),
            );
          } else {
            chain.authNonce += 1n;
          }
          return Promise.resolve({
            public: { txId: `id-${calls.length}` },
            private: { result: null, nextPrivateState: { coins: {} } },
          });
        },
    },
  );

  const deps: Partial<CustodyDeps> = {
    storage: () => storage,
    randomBytes: (length) => new Uint8Array(length).fill(7),
    wallet: () =>
      Promise.resolve({ network: { networkId: 'stagenet', indexerHttpUrl: '' } } as never),
    contractModule: () => Promise.resolve(moduleFake(chain)),
    providers: () => Promise.resolve(providers),
    ledger: () => Promise.resolve(ledgerFake(chain, built, signed)),
    contracts: () =>
      Promise.resolve({
        createUnprovenDeployTx: () =>
          Promise.resolve({
            public: { initialContractState: { serialize: () => new Uint8Array([30]) } },
            private: { signingKey: 'the-sampled-key', initialPrivateState: {} },
          }),
        submitTx: (_providers: unknown, options: unknown) => {
          state.submits += 1;
          const tx = (options as { unprovenTx: FakeTx }).unprovenTx;
          if (tx.deploys) {
            chain.deployed = true;
            for (const circuit of tx.deploys) chain.operations.add(circuit);
          }
          if (tx.inserts) {
            for (const circuit of tx.inserts) chain.operations.add(circuit);
            chain.authorityCounter += 1n;
          }
          return Promise.resolve({ public: { txId: `wave-${state.submits}` } });
        },
        findDeployedContract: () => Promise.resolve({ callTx }),
      }),
    now: () => {
      state.clock += 5_000;
      return state.clock;
    },
    sleep: () => Promise.resolve(undefined),
  };

  return { deps, storage, chain, built, signed, calls, storedKeys };
}

/** Every maintenance authority this run built with a committee in it. */
const committees = (built: unknown[][]): unknown[][] =>
  built.filter((entry) => entry[0] === 'authority' && entry[1] === 1);

beforeEach(() => {
  planning.retireAuthority = true;
  resetCustodySessionState();
});

/* -------------------------------------------------------------------------- */

describe('the maintenance authority a passkey Passport deploys with', () => {
  it('ignores the passkey’s maintenance secret while the plan retires the authority', async () => {
    const { deps, built, storage, signed, storedKeys } = harness();

    await deployCustodyAccount(
      session,
      passkeyDevice({ maintenanceSecretHex: MAINTENANCE_SECRET }),
      undefined,
      deps,
    );

    /* The authority the deploy carried is midnight-js's own sampled one: no
       committee of ours was built for it. The empty committee that RETIRES it
       on the last wave is a different thing and is still there. */
    expect(committees(built)).toEqual([]);
    expect(built.filter((entry) => entry[0] === 'retire')).toHaveLength(1);
    /* And the sampled key is filed in both places while it is needed, exactly
       as it was: it exists nowhere else, and a reload between wave 1 and wave 3
       without it is a live account nobody can finish. The last wave retires the
       authority and forgets the key, which is why storage is empty at the end
       of a run rather than at the start of one. */
    expect(storedKeys).toEqual(['the-sampled-key']);
    expect(signed).toEqual(['the-sampled-key', 'the-sampled-key']);
    expect(loadCustodyAuthorityKey(storage, ADDRESS)).toBeNull();
  });

  it('never writes the derived key down when the account keeps its authority', async () => {
    planning.retireAuthority = false;
    /* Nothing durable answers for this address either, so a run that finishes
       has re-derived the key rather than read it back from anywhere. */
    const { deps, built, storage, signed, storedKeys } = harness({ providerSigningKey: null });

    await deployCustodyAccount(
      session,
      passkeyDevice({ maintenanceSecretHex: MAINTENANCE_SECRET }),
      undefined,
      deps,
    );

    /* The deploy carried an authority of ONE verifying key: the passkey's. */
    expect(committees(built)).toEqual([['authority', 1, 1, 0n]]);
    expect(built.filter((entry) => entry[0] === 'retire')).toEqual([]);
    /* And it is nowhere a reader of this origin could find it. */
    expect(storedKeys).toEqual([]);
    expect(loadCustodyAuthorityKey(storage, ADDRESS)).toBeNull();
    expect([...storage.data.values()].join(' ')).not.toContain(MAINTENANCE_SECRET);
    /* The waves that follow still signed — with the key the passkey's secret
       re-derives, which is the only copy that exists. */
    expect(signed).toEqual([{ bip340: MAINTENANCE_SECRET }, { bip340: MAINTENANCE_SECRET }]);
  });

  it('keeps the sampled key when the account keeps an authority no passkey handed down', async () => {
    planning.retireAuthority = false;
    const { deps, built, storage, signed, storedKeys } = harness();

    await deployCustodyAccount(session, passkeyDevice(), undefined, deps);

    /* No secret to derive from, so the authority is midnight-js's sampled one
       and the storage rule is the one it has always been. */
    expect(committees(built)).toEqual([]);
    expect(storedKeys).toEqual(['the-sampled-key']);
    expect(loadCustodyAuthorityKey(storage, ADDRESS)).toBe('the-sampled-key');
    expect(signed).toEqual(['the-sampled-key', 'the-sampled-key']);
  });
});
