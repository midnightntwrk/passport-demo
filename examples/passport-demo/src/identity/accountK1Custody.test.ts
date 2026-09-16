import { beforeEach, describe, expect, it, vi } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';

import {
  bytesToHex,
  envelopeDigest,
  K256_ENVELOPE_NONE,
  pointFromUncompressed,
  scalarToBytesBE,
  type CurvePoint,
  type K1PureCircuits,
  type K256DeviceIdentity,
} from './accountK1.js';
import {
  allK1Circuits,
  hexToBytes,
  K1_PROVER_UNAVAILABLE,
  loadK1Record,
  type K1Storage,
} from './accountK1Plan.js';
import {
  activateK1Device,
  appendInboxK1,
  deployK1Account,
  k1ProofProvider,
  k1UserKey,
  k1WalletSeed,
  k1Witnesses,
  recoverK1DevicePoint,
  resetK1SessionState,
  type K1ContractModule,
  type K1Deps,
  type K1DynamicSession,
  type K1LedgerApi,
} from './accountK1Custody.js';

/**
 * The drill for the half of the k1 custody layer that has sockets on the end of
 * it.
 *
 * THE FAKES ARE THE POINT, AND SO IS WHAT THEY ARE FAKES OF. Every seam this
 * module reaches through — the wallet, the providers, the ledger primitives, and
 * midnight-js's deploy and call entry points — is injected, so what is held here
 * is the ORDER and the ARGUMENTS, which is exactly what a live run cannot check
 * cheaply: each wrong one costs a sponsored transaction the node then rejects,
 * and a rejection names none of them.
 *
 * Four things are held against something other than themselves:
 *
 *  - THE SIGNATURE IS VERIFIED ON THE CURVE. The gated-call drill signs with a
 *    real secp256k1 key through a fake Dynamic, and then checks the `r` and `s`
 *    the circuit received verify against the digest the contract would
 *    recompute. Comparing bigints to bigints would pass just as happily with the
 *    envelope, the challenge, or the byte order wrong.
 *  - THE POINT IS RECOVERED, NOT ASSERTED. `recoverK1DevicePoint` is checked by
 *    signing with a known key and getting that key's point back.
 *  - THE ARGUMENT ORDER IS READ OFF THE CALL. `append_inbox_with_k256(entry, pk,
 *    use_counter, sig, envelope)` is the generated ABI's order and the drill
 *    reads the recorded arguments positionally rather than by name.
 *  - THE WAVES ARE COUNTED AS TRANSACTIONS. Three, because thirteen circuits fit
 *    a block and this contract has thirty.
 *
 * `@noble/curves` is used HERE as a verifier and a stand-in device. The module
 * under test names it nowhere; `src/lib/k1Recover.ts` is the only file in `src`
 * that does, inside an `import()`.
 */

/* -------------------------------------------------------------------------- */
/* Fakes                                                                      */
/* -------------------------------------------------------------------------- */

const storageFake = (): K1Storage & { data: Map<string, string> } => {
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

/**
 * A stand-in for the compiled build's pure circuits.
 *
 * Every derivation is a distinguishable, deterministic byte string rather than
 * the real hash, because what is being held here is WHICH derivation was called
 * with WHICH arguments — the real preimages are `accountK1.test.ts`'s business
 * and are already held there against the contract's own circuit.
 */
function pureFake(): K1PureCircuits {
  const tag = (name: string, ...parts: unknown[]): Uint8Array => {
    const text = `${name}:${parts.map((part) => String(part)).join('|')}`;
    const out = new Uint8Array(32);
    for (let i = 0; i < text.length; i++) out[i % 32] ^= text.charCodeAt(i);
    out[0] = name.length;
    return out;
  };
  return {
    derive_boot_commitment_with_jubjub: (salt, pk) => tag('boot-jj', bytesToHex(salt), pk.x),
    derive_boot_commitment_with_k256: (salt, pk, envelope) =>
      tag('boot-k1', bytesToHex(salt), pk.x, envelope),
    derive_device_entry_with_jubjub: (self, pk, epoch, counter) =>
      tag('entry-jj', bytesToHex(self.bytes), pk.x, epoch, counter),
    derive_device_entry_with_k256: (self, pk, envelope, epoch, counter) =>
      tag('entry-k1', bytesToHex(self.bytes), pk.x, envelope, epoch, counter),
    envelope_digest: (envelope, challenge) => tag('digest', envelope, bytesToHex(challenge)),
    compute_public_point_with_k256: (scalar) => ({ x: scalar, y: scalar, identity: false }),
    challenge_withdraw_shielded_with_k256: (self, pk, recipient, color, amount, coin, nonce) =>
      tag('ch-ws', bytesToHex(self.bytes), pk.x, bytesToHex(recipient.bytes), color, amount, coin.value, nonce),
    challenge_withdraw_unshielded_with_k256: (self, pk, color, amount, recipient, nonce) =>
      tag('ch-wu', bytesToHex(self.bytes), pk.x, color, amount, bytesToHex(recipient.bytes), nonce),
    challenge_append_inbox_with_k256: (self, pk, entry, nonce) =>
      tag('ch-ai', bytesToHex(self.bytes), pk.x, entry.length, nonce),
    challenge_add_device_with_k256: (self, pk, entry, nonce) =>
      tag('ch-ad', bytesToHex(self.bytes), pk.x, bytesToHex(entry), nonce),
  };
}

const ADDRESS = 'ab'.repeat(32);

/** A ledger the fake contract module reports, mutable so a call can advance it. */
interface FakeChain {
  authNonce: bigint;
  epoch: bigint;
  devices: Set<string>;
  authorityCounter: bigint;
}

function moduleFake(chain: FakeChain): K1ContractModule {
  const pure = pureFake();
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

/** The ledger-v9 constructors, as objects that record what they were built with. */
function ledgerFake(chain: FakeChain, built: unknown[][]): K1LedgerApi {
  class State {
    data: unknown = null;
    maintenanceAuthority = { counter: chain.authorityCounter };
    private ops = new Map<string, unknown>();
    static deserialize(): State {
      const state = new State();
      state.data = 'constructor-state';
      state.maintenanceAuthority = { counter: chain.authorityCounter };
      for (const circuit of allK1Circuits('k256')) state.ops.set(circuit, `op:${circuit}`);
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
    get operationCount(): number {
      return this.ops.size;
    }
  }
  return {
    ContractState: State,
    ContractDeploy: class {
      address = ADDRESS;
      constructor(state: unknown) {
        built.push(['deploy', (state as State).operationCount]);
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
    Intent: {
      new: () => ({
        addDeploy: (deploy: unknown) => deploy,
        addMaintenanceUpdate: (update: unknown) => update,
      }),
    },
    MaintenanceUpdate: class {
      dataToSign = new Uint8Array([1]);
      constructor(address: string, updates: unknown[], counter: bigint) {
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
    Transaction: { fromParts: () => ({ kind: 'tx' }) },
    VerifierKeyInsert: class {
      constructor(circuit: string) {
        built.push(['insert', circuit]);
      }
    },
    signData: () => 'signature',
    networkId: () => 'stagenet',
  };
}

interface Harness {
  deps: Partial<K1Deps>;
  storage: ReturnType<typeof storageFake>;
  chain: FakeChain;
  built: unknown[][];
  calls: { circuit: string; args: unknown[] }[];
  submits: number;
}

function harness(overrides: { chain?: Partial<FakeChain> } = {}): Harness {
  const chain: FakeChain = {
    authNonce: 0n,
    epoch: 0n,
    devices: new Set<string>(),
    authorityCounter: 0n,
    ...overrides.chain,
  };
  const storage = storageFake();
  const built: unknown[][] = [];
  const calls: { circuit: string; args: unknown[] }[] = [];
  const state = { submits: 0 };

  /* Every fake resolves rather than being `async`: a promise-returning stub with
     nothing to await is what `@typescript-eslint/require-await` objects to, and
     the objection is fair — an `async` here would be decoration. */
  const providers: Record<string, unknown> = {
    zkConfigProvider: {
      getVerifierKey: (circuit: string) =>
        Promise.resolve(allK1Circuits('k256').includes(circuit) ? new Uint8Array(2_400) : null),
    },
    publicDataProvider: {
      queryContractState: () =>
        Promise.resolve({ serialize: () => new Uint8Array([1]), data: 'state' }),
    },
    privateStateProvider: {
      setContractAddress: () => undefined,
      setSigningKey: () => Promise.resolve(undefined),
      getSigningKey: () => Promise.resolve('the-signing-key'),
      set: () => Promise.resolve(undefined),
    },
    compiledContract: { label: 'passport-account-k1' },
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
          /* The seam, as the contract runs it: consume this entry, insert the
             next, advance auth_nonce. Only the gated circuits do this. */
          if (circuit.startsWith('activate_initial_device')) {
            chain.devices.add(bytesToHex(pureFake().derive_device_entry_with_k256(
              { bytes: hexToBytes(ADDRESS) },
              args[0] as CurvePoint,
              args[2] as bigint,
              chain.epoch,
              0n,
            )));
          } else {
            chain.authNonce += 1n;
          }
          return Promise.resolve({ public: { txId: `id-${calls.length}` } });
        },
    },
  );

  const deps: Partial<K1Deps> = {
    storage: () => storage,
    randomBytes: (length) => new Uint8Array(length).fill(7),
    wallet: () =>
      Promise.resolve({
        network: { networkId: 'stagenet', indexerHttpUrl: '' },
      } as never),
    contractModule: () => Promise.resolve(moduleFake(chain)),
    providers: () => Promise.resolve(providers),
    ledger: () => Promise.resolve(ledgerFake(chain, built)),
    contracts: () =>
      Promise.resolve({
        createUnprovenDeployTx: () =>
          Promise.resolve({
            public: { initialContractState: { serialize: () => new Uint8Array([30]) } },
            private: { signingKey: 'the-signing-key', initialPrivateState: {} },
          }),
        submitTx: () => {
          state.submits += 1;
          /* Each maintenance update the node applies advances the authority
             counter, which is what the next wave builds against. */
          chain.authorityCounter += 1n;
          return Promise.resolve({ public: { txId: `wave-${state.submits}` } });
        },
        findDeployedContract: () => Promise.resolve({ callTx }),
      }),
    now: () => 1_700_000_000_000,
    sleep: () => Promise.resolve(undefined),
  };

  return {
    deps,
    storage,
    chain,
    built,
    calls,
    get submits() {
      return state.submits;
    },
  };
}

/** A real secp256k1 key standing in for Dynamic's embedded one. */
function deviceFake(): {
  session: K1DynamicSession;
  device: K256DeviceIdentity;
  signed: Uint8Array[];
} {
  const secret = scalarToBytesBE(12345678901234567890n);
  const point = pointFromUncompressed(secp256k1.getPublicKey(secret, false));
  const signed: Uint8Array[] = [];
  const session: K1DynamicSession = {
    address: '0xAbCdEf0000000000000000000000000000000001',
    /* The vendor's shape: 64 hex in, `0x` + r‖s‖v out, and the 32 bytes signed
       verbatim — `prehash: false`, because the envelope digest IS the hash. The
       recovery byte is the real one, which is what makes the point recoverable
       from this at all. */
    signRaw: ({ message }) => {
      const digest = hexToBytes(message);
      signed.push(digest);
      const recovered = secp256k1.sign(digest, secret, { prehash: false, format: 'recovered' });
      const v = recovered[0] + 27;
      return Promise.resolve(
        `0x${bytesToHex(recovered.subarray(1))}${v.toString(16).padStart(2, '0')}`,
      );
    },
  };
  return { session, device: { arm: 'k256', pk: point, envelope: K256_ENVELOPE_NONE }, signed };
}

/** The uncompressed SEC1 bytes of a point, for handing to a curve library. */
function uncompressed(point: CurvePoint): Uint8Array {
  const out = new Uint8Array(65);
  out[0] = 4;
  out.set(scalarToBytesBE(point.x), 1);
  out.set(scalarToBytesBE(point.y), 33);
  return out;
}

beforeEach(() => {
  resetK1SessionState();
});

/* -------------------------------------------------------------------------- */

describe('the server proof provider', () => {
  const unproven = { serialize: () => new Uint8Array([0xab, 0xcd]) };

  it('posts the circuit, the transaction, and the network, and reads the proof back', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ provenTx: 'beef' }), { status: 200 })),
    );
    const provider = k1ProofProvider({
      endpoint: 'https://example.test/balancer/prove-k1',
      network: 'stagenet',
      circuit: 'append_inbox_with_k256',
      deserialise: (bytes) => ({ bytes }),
      fetchFn: fetchFn,
    });

    expect(await provider.proveTx(unproven)).toEqual({ bytes: new Uint8Array([0xbe, 0xef]) });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.test/balancer/prove-k1');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      circuit: 'append_inbox_with_k256',
      unprovenTx: 'abcd',
      network: 'stagenet',
    });
  });

  /* THE ENDPOINT DOES NOT EXIST YET. Every one of these has to be one plain
     sentence and a console line, and never a ten-minute spinner — which is what
     an unreachable proof server behind `httpClientProofProvider` gives you. */
  it('refuses in one sentence when the service cannot be reached', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const provider = k1ProofProvider({
      endpoint: 'https://example.test/balancer/prove-k1',
      network: 'stagenet',
      circuit: 'append_inbox_with_k256',
      deserialise: (bytes) => bytes,
      fetchFn: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    await expect(provider.proveTx(unproven)).rejects.toThrow(K1_PROVER_UNAVAILABLE);
    expect(warn.mock.calls[0]?.[0]).toContain('/prove-k1');
    warn.mockRestore();
  });

  it('refuses on a 5xx, and says the service’s own code in the console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const provider = k1ProofProvider({
      endpoint: 'https://example.test/balancer/prove-k1',
      network: 'stagenet',
      circuit: 'append_inbox_with_k256',
      deserialise: (bytes) => bytes,
      fetchFn: () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'no-key', detail: 'account-k1 not staged' }), {
            status: 503,
          }),
        ),
    });
    await expect(provider.proveTx(unproven)).rejects.toThrow(K1_PROVER_UNAVAILABLE);
    expect(warn.mock.calls[0]?.[0]).toContain('no-key');
    warn.mockRestore();
  });

  it('refuses a 200 that is a proxy error page rather than a proof', async () => {
    const provider = k1ProofProvider({
      endpoint: 'https://example.test/balancer/prove-k1',
      network: 'stagenet',
      circuit: 'append_inbox_with_k256',
      deserialise: (bytes) => bytes,
      fetchFn: () => Promise.resolve(new Response('<html>502 Bad Gateway</html>', { status: 200 })),
    });
    await expect(provider.proveTx(unproven)).rejects.toThrow(/without a proven transaction/);
  });
});

describe('the per-user wallet seed', () => {
  it('is made once and reused', () => {
    const test = harness();
    const first = k1WalletSeed(test.deps as K1Deps, '0xabc');
    const second = k1WalletSeed(test.deps as K1Deps, '0xabc');
    expect(first).toHaveLength(32);
    expect(bytesToHex(second)).toBe(bytesToHex(first));
  });

  it('gives a different user a different one', () => {
    const test = harness();
    const deps = { ...test.deps, randomBytes: (n: number) => new Uint8Array(n).fill(1) };
    k1WalletSeed(deps as K1Deps, '0xabc');
    const other = k1WalletSeed(
      { ...deps, randomBytes: (n: number) => new Uint8Array(n).fill(2) } as K1Deps,
      '0xdef',
    );
    expect(bytesToHex(other)).toBe('02'.repeat(32));
  });

  it('carries on when the browser will not remember it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const test = harness();
    const deps = {
      ...test.deps,
      storage: () => ({
        getItem: () => null,
        setItem: () => {
          throw new Error('blocked');
        },
        removeItem: () => undefined,
      }),
    };
    expect(k1WalletSeed(deps as K1Deps, '0xabc')).toHaveLength(32);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('the device point', () => {
  /* Dynamic exports no key and no point, so the point is recovered from a
     signature over a digest we chose. Held by signing with a KNOWN key and
     getting that key's point back — not by comparing it to itself. */
  it('is recovered from one signature at enrolment', async () => {
    const { session, device, signed } = deviceFake();
    const point = await recoverK1DevicePoint({
      session,
      /* The same recovery `src/lib/k1Recover.ts` performs, written out here so
         the drill does not depend on a lazy import of the curve. */
      recover: (digest, r, s, v) =>
        new secp256k1.Signature(r, s, v).recoverPublicKey(digest).toBytes(false),
    });
    expect(point.x).toBe(device.pk.x);
    expect(point.y).toBe(device.pk.y);
    expect(signed).toHaveLength(1);
    expect(signed[0]).toHaveLength(32);
  });
});

describe('creating a Dynamic Passport', () => {
  it('is three sponsored transactions, the first carrying the whole k256 arm', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    const result = await deployK1Account(session, device, undefined, test.deps);

    expect(test.submits).toBe(3);
    expect(result.record.address).toBe(ADDRESS);
    expect(result.record.wavesDone).toBe(3);
    expect(result.record.totalWaves).toBe(3);

    /* Wave 1's deploy carries ten operations: the two deposits plus the eight
       k256 circuits. Anything else and the account cannot be activated. */
    const deploy = test.built.find((entry) => entry[0] === 'deploy');
    expect(deploy?.[1]).toBe(10);

    /* Two maintenance updates, ten keys each, and only the last retires. */
    const updates = test.built.filter((entry) => entry[0] === 'update');
    expect(updates).toHaveLength(2);
    expect(test.built.filter((entry) => entry[0] === 'retire')).toHaveLength(1);
  });

  /* `'v4'` is load-bearing: `compact-js` hardcodes `'v3'`, whose keys carry a
     different header, and the insert throws before a transaction exists. */
  it('inserts verifier keys at version v4', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    await deployK1Account(session, device, undefined, test.deps);
    const versions = new Set(
      test.built.filter((entry) => entry[0] === 'vk').map((entry) => entry[1]),
    );
    expect([...versions]).toEqual(['v4']);
  });

  it('builds each maintenance update against the counter the chain reports', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    await deployK1Account(session, device, undefined, test.deps);
    const counters = test.built.filter((e) => e[0] === 'update').map((e) => e[3]);
    expect(counters).toEqual([1n, 2n]);
  });

  it('remembers where it got to, and resumes rather than redeploying', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    await deployK1Account(session, device, undefined, test.deps);
    const after = test.submits;

    const again = await deployK1Account(session, device, undefined, test.deps);
    expect(test.submits).toBe(after);
    expect(again.record.address).toBe(ADDRESS);
    expect(loadK1Record(test.storage, k1UserKey(session), 'stagenet')?.wavesDone).toBe(3);
  });

  it('reports the steps as it goes', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    const phases: string[] = [];
    await deployK1Account(
      session,
      device,
      (phase) => phases.push(phase.step),
      test.deps,
    );
    expect(phases).toEqual(['wallet', 'deploy', 'waves', 'waves']);
  });

  it('refuses in plain words when the pieces are not in the build', async () => {
    const test = harness();
    const deps = {
      ...test.deps,
      providers: async () => ({
        ...(await (test.deps.providers as NonNullable<K1Deps['providers']>)(
          null as never,
          'p',
        )),
        zkConfigProvider: { getVerifierKey: () => Promise.resolve(null) },
      }),
    };
    const { session, device } = deviceFake();
    await expect(deployK1Account(session, device, undefined, deps)).rejects.toThrow(
      /not part of this build yet/,
    );
  });
});

describe('activating the Dynamic key', () => {
  it('passes the point, the salt, and the envelope, in that order', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    await deployK1Account(session, device, undefined, test.deps);
    await activateK1Device(session, device, undefined, test.deps);

    const call = test.calls.find((c) => c.circuit === 'activate_initial_device_with_k256');
    expect(call).toBeDefined();
    expect(call?.args).toHaveLength(3);
    expect(call?.args[0]).toEqual(device.pk);
    expect(call?.args[1]).toEqual(new Uint8Array(32).fill(7));
    expect(call?.args[2]).toBe(K256_ENVELOPE_NONE);
    /* Two arguments, not three, is the failure this guards: the k256 arm binds
       the envelope into the boot commitment and the jubjub arm has none. */
  });

  it('refuses when there is nothing to add the key to', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    await expect(activateK1Device(session, device, undefined, test.deps)).rejects.toThrow(
      /no Passport to add this key to/,
    );
  });
});

describe('a gated call', () => {
  async function readyPassport() {
    const test = harness();
    const fake = deviceFake();
    await deployK1Account(fake.session, fake.device, undefined, test.deps);
    await activateK1Device(fake.session, fake.device, undefined, test.deps);
    return { test, ...fake };
  }

  it('sends the arguments in the order the generated ABI declares', async () => {
    const { test, session, device } = await readyPassport();
    await appendInboxK1(session, device, new Uint8Array(192), undefined, test.deps);

    const call = test.calls.find((c) => c.circuit === 'append_inbox_with_k256');
    expect(call).toBeDefined();
    /* (entry, pk, use_counter, sig, envelope) */
    expect(call?.args).toHaveLength(5);
    expect(call?.args[0]).toEqual(new Uint8Array(192));
    expect(call?.args[1]).toEqual(device.pk);
    expect(call?.args[2]).toBe(0n);
    expect(call?.args[4]).toBe(K256_ENVELOPE_NONE);
  });

  /* THE SIGNATURE IS CHECKED ON THE CURVE, against the digest the contract
     recomputes — `SHA-256(challenge)` for envelope 0. Comparing the scalars to
     themselves would pass with the wrong envelope, the wrong challenge, or the
     two scalars swapped. */
  it('signs the digest the contract will recompute, and it verifies', async () => {
    const { test, session, device } = await readyPassport();
    await appendInboxK1(session, device, new Uint8Array(192), undefined, test.deps);

    const call = test.calls.find((c) => c.circuit === 'append_inbox_with_k256');
    const sig = call?.args[3] as { r: bigint; s: bigint };

    const pure = pureFake();
    const challenge = pure.challenge_append_inbox_with_k256(
      { bytes: hexToBytes(ADDRESS) },
      device.pk,
      new Uint8Array(192),
      /* auth_nonce read BEFORE the call — zero, because activation does not
         advance it. */
      0n,
    );
    const digest = await envelopeDigest(K256_ENVELOPE_NONE, challenge);
    const encoded = new Uint8Array(64);
    encoded.set(scalarToBytesBE(sig.r), 0);
    encoded.set(scalarToBytesBE(sig.s), 32);
    expect(
      secp256k1.verify(encoded, digest, uncompressed(device.pk), {
        prehash: false,
        /* The circuit accepts both S forms — it consumes the device entry and
           advances `auth_nonce`, so a malleated twin buys nothing — and so the
           drill must not impose a rule the contract does not have. */
        lowS: false,
      }),
    ).toBe(true);
  });

  it('resolves the use counter off the ledger rather than assuming zero', async () => {
    const { test, session, device } = await readyPassport();
    /* The roster now holds the entry at counter 3 only — a device that has
       already approved three times, on a client that has never seen it. */
    const pure = pureFake();
    test.chain.devices.clear();
    test.chain.devices.add(
      bytesToHex(
        pure.derive_device_entry_with_k256(
          { bytes: hexToBytes(ADDRESS) },
          device.pk,
          K256_ENVELOPE_NONE,
          0n,
          3n,
        ),
      ),
    );
    await appendInboxK1(session, device, new Uint8Array(192), undefined, test.deps);
    const call = test.calls.filter((c) => c.circuit === 'append_inbox_with_k256').pop();
    expect(call?.args[2]).toBe(3n);
  });

  it('refuses an inbox entry that is not 192 bytes', async () => {
    const { test, session, device } = await readyPassport();
    await expect(
      appendInboxK1(session, device, new Uint8Array(32), undefined, test.deps),
    ).rejects.toThrow(/192 bytes/);
  });

  it('refuses before the Passport is finished', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    await deployK1Account(session, device, undefined, test.deps);
    await expect(
      appendInboxK1(session, device, new Uint8Array(192), undefined, test.deps),
    ).rejects.toThrow(/not finished being set up/);
  });
});

describe('the witnesses', () => {
  /* One witness, and it refuses. The coin store is PR 4, nothing this module
     calls invokes `held_coin`, and a witness that answered with a zero coin
     would build a transaction the node rejects for a reason naming none of
     this. */
  it('refuses held_coin in words a person can read', () => {
    const witnesses = k1Witnesses();
    expect(Object.keys(witnesses)).toEqual(['held_coin']);
    expect(() => witnesses.held_coin?.()).toThrow(/not built yet/);
  });
});
