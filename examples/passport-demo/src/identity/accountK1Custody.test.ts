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
  K1_ENROLMENT_UNCONFIRMED,
  K1_PROVER_UNAVAILABLE,
  K1_SETUP_INTERRUPTED,
  hexToBytes,
  loadK1AuthorityKey,
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
  startK1AccountAgain,
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

/**
 * The chain, as much of it as this module can see: a ledger a call advances,
 * and — the part that matters for the resume rule — THE OPERATIONS THE CONTRACT
 * ACTUALLY CARRIES.
 *
 * `operations` is why the fake is shaped this way rather than reporting a fixed
 * state. The module decides whether to submit a wave by asking what is already
 * deployed, so a fake that answered "all thirty, always" would make every drill
 * of that decision pass by accident. Here the deploy and each maintenance
 * update ADD to this set, exactly as the node would, and `deployed` is false
 * until wave 1 has landed so the read can answer "there is nothing there".
 */
interface FakeChain {
  authNonce: bigint;
  epoch: bigint;
  devices: Set<string>;
  authorityCounter: bigint;
  deployed: boolean;
  operations: Set<string>;
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

/** What a submitted transaction would do to the chain if the node applied it. */
interface FakeTx {
  kind: 'tx';
  deploys: string[] | null;
  inserts: string[] | null;
}

/** The ledger-v9 constructors, as objects that record what they were built with. */
function ledgerFake(chain: FakeChain, built: unknown[][]): K1LedgerApi {
  /* The constructor's own state carries all thirty operations; a state read off
     the chain carries the ones that have actually landed. The two arrive
     through the same `deserialize`, and the serialised length is what tells
     them apart — which is the fake's own convention and is why the deploy data
     below serialises to `[30]`. */
  class State {
    data: unknown = null;
    maintenanceAuthority = { counter: chain.authorityCounter };
    private ops = new Map<string, unknown>();
    static deserialize(raw: Uint8Array): State {
      const state = new State();
      state.maintenanceAuthority = { counter: chain.authorityCounter };
      const roster = raw[0] === 30 ? allK1Circuits('k256') : [...chain.operations];
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
    Intent: {
      /* The intent IS the transaction here: `fromParts` is handed the object
         `addDeploy` returned, so what it carries has to be what the node will
         be asked to apply. */
      new: () => {
        const intent = {
          kind: 'tx' as const,
          deploys: null as string[] | null,
          inserts: null as string[] | null,
          addDeploy(deploy: unknown) {
            intent.deploys = (deploy as { circuits: string[] }).circuits;
            return intent;
          },
          addMaintenanceUpdate(update: unknown) {
            intent.inserts = (update as { circuits: string[] }).circuits;
            return intent;
          },
        };
        return intent;
      },
    },
    MaintenanceUpdate: class {
      dataToSign = new Uint8Array([1]);
      circuits: string[];
      constructor(address: string, updates: unknown[], counter: bigint) {
        this.circuits = updates
          .filter((update): update is { circuit: string } => typeof
            (update as { circuit?: unknown }).circuit === 'string')
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

function harness(
  overrides: {
    chain?: Partial<FakeChain>;
    /** A node that accepts a submission and never applies it. */
    dropSubmissions?: boolean;
    storage?: ReturnType<typeof storageFake>;
  } = {},
): Harness {
  const chain: FakeChain = {
    authNonce: 0n,
    epoch: 0n,
    devices: new Set<string>(),
    authorityCounter: 0n,
    deployed: false,
    operations: new Set<string>(),
    ...overrides.chain,
  };
  const storage = overrides.storage ?? storageFake();
  const built: unknown[][] = [];
  const calls: { circuit: string; args: unknown[] }[] = [];
  const state = { submits: 0, clock: 1_700_000_000_000 };

  /* Every fake resolves rather than being `async`: a promise-returning stub with
     nothing to await is what `@typescript-eslint/require-await` objects to, and
     the objection is fair — an `async` here would be decoration. */
  const providers: Record<string, unknown> = {
    zkConfigProvider: {
      getVerifierKey: (circuit: string) =>
        Promise.resolve(allK1Circuits('k256').includes(circuit) ? new Uint8Array(2_400) : null),
    },
    publicDataProvider: {
      /* NOTHING AT THAT ADDRESS UNTIL WAVE 1 HAS LANDED. The module reads this
         to decide whether to deploy at all, so a fake that always answered with
         a state would make that decision untestable. */
      queryContractState: () =>
        Promise.resolve(
          chain.deployed
            ? { serialize: () => new Uint8Array([chain.operations.size]), data: 'state' }
            : null,
        ),
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
        submitTx: (_providers: unknown, options: unknown) => {
          state.submits += 1;
          /* THE NODE APPLYING THE TRANSACTION, which is a different event from
             accepting it. `dropSubmissions` is the node that accepts and never
             applies — a real and unremarkable outcome — and it is what holds
             the rule that a wave is recorded only once the chain shows it. */
          if (!overrides.dropSubmissions) {
            const tx = (options as { unprovenTx: FakeTx }).unprovenTx;
            if (tx.deploys) {
              chain.deployed = true;
              for (const circuit of tx.deploys) chain.operations.add(circuit);
            }
            if (tx.inserts) {
              for (const circuit of tx.inserts) chain.operations.add(circuit);
              /* Each maintenance update the node applies advances the authority
                 counter, which is what the next wave builds against. */
              chain.authorityCounter += 1n;
            }
          }
          return Promise.resolve({ public: { txId: `wave-${state.submits}` } });
        },
        findDeployedContract: () => Promise.resolve({ callTx }),
      }),
    /* A CLOCK THAT MOVES. `awaitAuthorityCounter` gives up on a deadline, and a
       frozen clock would spin for ever in the one drill that wants to see it
       give up. Five seconds a read reaches the deadline in two dozen turns. */
    now: () => {
      state.clock += 5_000;
      return state.clock;
    },
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

/** The secp256k1 group order, for making the high-S twin of a signature. */
const CURVE_N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

/**
 * What a signer does with the two things a recovery depends on.
 *
 * These are not invented shapes. `lowS` is the ordinary one and `highS` is the
 * malleated twin WITH `v` flipped to match, which is still a correct signature
 * and which the contract accepts. `highSKeepingV` is the defect: the S form
 * changed and the recovery byte left alone, which is what a signer that
 * normalises without flipping emits — every signature verifies, and every
 * recovery lands on a point the key cannot sign for.
 */
type SignerStyle = 'lowS' | 'highS' | 'highSKeepingV' | 'zeroBasedV' | 'tampered';

/** A real secp256k1 key standing in for Dynamic's embedded one. */
function deviceFake(style: SignerStyle = 'lowS'): {
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
      let r = BigInt(`0x${bytesToHex(recovered.subarray(1, 33))}`);
      let s = BigInt(`0x${bytesToHex(recovered.subarray(33, 65))}`);
      let v = recovered[0];
      if (style === 'highS' || style === 'highSKeepingV') {
        s = CURVE_N - s;
        /* Flipping S moves R to its other root, so a correct signer flips the
           recovery byte with it. `highSKeepingV` is the one that does not. */
        if (style === 'highS') v = v ^ 1;
      }
      if (style === 'tampered') r = r ^ 1n;
      const encoded =
        bytesToHex(scalarToBytesBE(r)) +
        bytesToHex(scalarToBytesBE(s)) +
        (style === 'zeroBasedV' ? v : v + 27).toString(16).padStart(2, '0');
      return Promise.resolve(`0x${encoded}`);
    },
  };
  return { session, device: { arm: 'k256', pk: point, envelope: K256_ENVELOPE_NONE }, signed };
}

/** The recovery `src/lib/k1Recover.ts` performs, written out for the drill. */
const recoverHere = (digest: Uint8Array, r: bigint, s: bigint, v: number): Uint8Array =>
  new secp256k1.Signature(r, s, v).recoverPublicKey(digest).toBytes(false);

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
  it('is recovered from a signature, and confirmed against a second one', async () => {
    const { session, device, signed } = deviceFake();
    const point = await recoverK1DevicePoint({ session, recover: recoverHere });
    expect(point.x).toBe(device.pk.x);
    expect(point.y).toBe(device.pk.y);
    /* TWO DIGESTS, AND THEY ARE DIFFERENT ONES. One signature proves nothing:
       recovery always succeeds, and a recovery byte that does not match the
       signature it arrives with simply lands on another point. */
    expect(signed).toHaveLength(2);
    expect(signed[0]).toHaveLength(32);
    expect(bytesToHex(signed[1])).not.toBe(bytesToHex(signed[0]));
  });

  /* The contract accepts both S forms, so enrolment must too — a low-S rule
     imposed here would refuse signers the seam itself is happy with. */
  it('accepts a high-S signature whose recovery byte was flipped with it', async () => {
    const { session, device } = deviceFake('highS');
    const point = await recoverK1DevicePoint({ session, recover: recoverHere });
    expect(point.x).toBe(device.pk.x);
    expect(point.y).toBe(device.pk.y);
  });

  it('accepts a recovery byte given as 0 or 1 rather than 27 or 28', async () => {
    const { session, device } = deviceFake('zeroBasedV');
    const point = await recoverK1DevicePoint({ session, recover: recoverHere });
    expect(point.x).toBe(device.pk.x);
  });

  /* THE DEFECT THIS EXISTS FOR. High S with the recovery byte left alone
     recovers a point the key cannot sign for, silently, and enrolling it would
     activate an account around a device that can never authorise anything. */
  it('refuses a high-S signature whose recovery byte was not flipped', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { session } = deviceFake('highSKeepingV');
    await expect(recoverK1DevicePoint({ session, recover: recoverHere })).rejects.toThrow(
      K1_ENROLMENT_UNCONFIRMED,
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('refuses a signature whose scalars were tampered with', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { session } = deviceFake('tampered');
    await expect(recoverK1DevicePoint({ session, recover: recoverHere })).rejects.toThrow(
      K1_ENROLMENT_UNCONFIRMED,
    );
    warn.mockRestore();
  });

  it('refuses a recovery byte that is no dialect at all', async () => {
    const session: K1DynamicSession = {
      address: '0xabc',
      signRaw: () => Promise.resolve(`0x${'11'.repeat(64)}07`),
    };
    await expect(recoverK1DevicePoint({ session, recover: recoverHere })).rejects.toThrow(
      /recovery byte out of range/,
    );
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

  /* The constructor mints the authority at counter 0, and only an APPLIED
     maintenance update advances it — the deploy does not. So wave 2 builds
     against 0 and wave 3 against 1, each read off the chain at the time rather
     than assumed from the deploy. */
  it('builds each maintenance update against the counter the chain reports', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    await deployK1Account(session, device, undefined, test.deps);
    const counters = test.built.filter((e) => e[0] === 'update').map((e) => e[3]);
    expect(counters).toEqual([0n, 1n]);
    /* And the retirement carries the counter its own application expects: one
       past the update it rides on. */
    expect(test.built.filter((e) => e[0] === 'authority').map((e) => e[3])).toEqual([2n]);
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

/* -------------------------------------------------------------------------- */

describe('resuming a half-built Passport', () => {
  /* THREE CASES, AND EACH OF THEM HAPPENED TO SOMEBODY. The record and the
     chain disagree in both directions, and the module now asks the chain. */

  it('re-submits a wave the record calls done that the chain does not have', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    await deployK1Account(session, device, undefined, test.deps);

    /* Wave 3's keys are taken back off the chain, as a dropped update would
       leave them, while the record still says all three waves landed. */
    for (const circuit of ['issue_grant_with_k256', 'revoke_grant_with_k256',
      'revoke_all_grants_with_k256']) {
      test.chain.operations.delete(circuit);
    }
    const before = test.submits;
    await deployK1Account(session, device, undefined, test.deps);
    expect(test.submits).toBeGreaterThan(before);
    /* And what it re-submitted is a maintenance update, not a second deploy. */
    expect(test.built.filter((entry) => entry[0] === 'deploy')).toHaveLength(1);
  });

  it('skips a wave the chain has that the record never recorded', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    await deployK1Account(session, device, undefined, test.deps);
    const landed = test.submits;

    /* The tab closed before the last write: the chain is complete, the record
       is two waves behind. Nothing may be paid for twice. */
    const record = loadK1Record(test.storage, k1UserKey(session), 'stagenet');
    test.storage.data.set(
      'passport-k1-account:v1',
      JSON.stringify({
        [`${k1UserKey(session)}|stagenet`]: { ...record, wavesDone: 1 },
      }),
    );

    const again = await deployK1Account(session, device, undefined, test.deps);
    expect(test.submits).toBe(landed);
    expect(again.record.wavesDone).toBe(3);
    expect(loadK1Record(test.storage, k1UserKey(session), 'stagenet')?.wavesDone).toBe(3);
  });

  it('redeploys when the record names an address the chain has never heard of', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    await deployK1Account(session, device, undefined, test.deps);

    /* The deploy itself was dropped: a record, an address, and nothing there. */
    test.chain.deployed = false;
    test.chain.operations.clear();
    test.chain.authorityCounter = 0n;
    await deployK1Account(session, device, undefined, test.deps);
    expect(test.built.filter((entry) => entry[0] === 'deploy')).toHaveLength(2);
  });

  /* THE ORDER THAT MATTERS: the counter first, the record second. A submission
     the node accepts and never applies must leave `wavesDone` where it was, or
     the next attempt skips ten circuits nothing can add afterwards. */
  it('does not record a wave whose update never landed', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    await deployK1Account(session, device, undefined, test.deps);

    const stuck = harness({
      chain: { ...test.chain, operations: new Set(test.chain.operations) },
      storage: test.storage,
      dropSubmissions: true,
    });
    stuck.chain.operations.delete('issue_grant_with_k256');
    const before = loadK1Record(test.storage, k1UserKey(session), 'stagenet')?.wavesDone;

    await expect(deployK1Account(session, device, undefined, stuck.deps)).rejects.toThrow(
      /taking longer than expected/,
    );
    expect(loadK1Record(test.storage, k1UserKey(session), 'stagenet')?.wavesDone).toBe(before);
  });
});

describe('a setup that cannot be finished', () => {
  /** A node that applies the first transaction and drops every one after it. */
  const oneWaveOnly = (deps: Partial<K1Deps>): Partial<K1Deps> => {
    let submits = 0;
    return {
      ...deps,
      /* The counter is OUTSIDE the factory on purpose: the module asks for
         `contracts()` once per wave, so a counter made inside would restart at
         zero every time and never refuse anything. */
      contracts: async () => {
        const real = await (deps.contracts as NonNullable<K1Deps['contracts']>)();
        return {
          ...real,
          submitTx: (providers: unknown, options: unknown) => {
            submits += 1;
            if (submits > 1) return Promise.reject(new Error('tab closed'));
            return real.submitTx(providers, options);
          },
        };
      },
    };
  };

  /** Providers whose private-state store has never heard of this account. */
  const withoutTheProvidersKey = async (deps: Partial<K1Deps>) => ({
    ...(await (deps.providers as NonNullable<K1Deps['providers']>)(null as never, 'p')),
    privateStateProvider: {
      setContractAddress: () => undefined,
      setSigningKey: () => Promise.resolve(undefined),
      getSigningKey: () => Promise.resolve(null),
      set: () => Promise.resolve(undefined),
    },
  });

  /* THE KEY IS PERSISTED, WHICH IS WHAT MAKES A RELOAD SURVIVABLE. The
     private-state provider this app builds is in-memory, so a reload between
     wave 1 and wave 3 used to leave a live account with a live authority and
     no key anywhere that could drive it. */
  it('keeps the maintenance key where a reload can find it', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    await expect(
      deployK1Account(session, device, undefined, oneWaveOnly(test.deps)),
    ).rejects.toThrow('tab closed');

    const address = loadK1Record(test.storage, k1UserKey(session), 'stagenet')?.address as string;
    expect(loadK1AuthorityKey(test.storage, address)).toBe('the-signing-key');

    /* THE RELOAD: the tab's own cache is gone and the provider never held it,
       so only the stored key can finish the account. */
    resetK1SessionState();
    const reloaded = harness({ chain: test.chain, storage: test.storage });
    const finished = await deployK1Account(session, device, undefined, {
      ...reloaded.deps,
      providers: () => withoutTheProvidersKey(reloaded.deps),
    });
    expect(finished.record.wavesDone).toBe(3);
    /* The retirement landed with the last wave, so the key is deleted rather
       than left in a browser for ever. */
    expect(loadK1AuthorityKey(test.storage, address)).toBeNull();
  });

  /* THE OTHER PATH. When the key is genuinely gone — a browser that cleared
     its storage, or one that refused to write it in the first place — the
     record says so ONCE and every entry point refuses from there, rather than
     offering a step that fails every time it is pressed. */
  it('marks the record terminal when the key is gone, and refuses from then on', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    /* A browser that remembers the progress and not the key. */
    const forgetful: K1Storage = {
      getItem: (key) => test.storage.getItem(key),
      setItem: (key, value) => {
        if (key === 'passport-k1-authority:v1') return;
        test.storage.setItem(key, value);
      },
      removeItem: (key) => test.storage.removeItem(key),
    };
    await expect(
      deployK1Account(session, device, undefined, {
        ...oneWaveOnly(test.deps),
        storage: () => forgetful,
      }),
    ).rejects.toThrow('tab closed');

    resetK1SessionState();
    const reloaded = harness({ chain: test.chain, storage: test.storage });
    await expect(
      deployK1Account(session, device, undefined, {
        ...reloaded.deps,
        storage: () => forgetful,
        providers: () => withoutTheProvidersKey(reloaded.deps),
      }),
    ).rejects.toThrow(K1_SETUP_INTERRUPTED);

    expect(loadK1Record(test.storage, k1UserKey(session), 'stagenet')?.interrupted).toBe(true);

    /* Every door is shut from here, and each says the same sentence. */
    await expect(deployK1Account(session, device, undefined, test.deps)).rejects.toThrow(
      K1_SETUP_INTERRUPTED,
    );
    await expect(activateK1Device(session, device, undefined, test.deps)).rejects.toThrow(
      K1_SETUP_INTERRUPTED,
    );
  });

  it('starts again by throwing the record and the key away', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    await deployK1Account(session, device, undefined, test.deps);
    const address = loadK1Record(test.storage, k1UserKey(session), 'stagenet')?.address as string;

    await startK1AccountAgain(session, test.deps);
    expect(loadK1Record(test.storage, k1UserKey(session), 'stagenet')).toBeNull();
    expect(loadK1AuthorityKey(test.storage, address)).toBeNull();

    /* A fresh chain, and the next press builds a whole Passport again. */
    const fresh = harness({ storage: test.storage });
    const again = await deployK1Account(session, device, undefined, fresh.deps);
    expect(again.record.wavesDone).toBe(3);
    expect(fresh.built.filter((entry) => entry[0] === 'deploy')).toHaveLength(1);
  });

  it('has nothing to throw away when there is no record', async () => {
    const test = harness();
    const { session } = deviceFake();
    await expect(startK1AccountAgain(session, test.deps)).resolves.toBeUndefined();
  });
});

describe('the proving deadline', () => {
  /* IT DOES NOT HANG, and this is the part of that claim `fetch` does not give
     you for nothing: a socket to a box that stopped answering without closing
     it stays open until the operating system gives up. */
  it('carries an abort on every request', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ provenTx: 'ab' }), { status: 200 })),
    );
    const provider = k1ProofProvider({
      endpoint: 'https://example.test/balancer/prove-k1',
      network: 'stagenet',
      circuit: 'append_inbox_with_k256',
      deserialise: (bytes) => bytes,
      fetchFn,
    });
    await provider.proveTx({ serialize: () => new Uint8Array([1]) });
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(false);
  });

  it('gives up in one sentence when the deadline passes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const provider = k1ProofProvider({
      endpoint: 'https://example.test/balancer/prove-k1',
      network: 'stagenet',
      circuit: 'append_inbox_with_k256',
      deserialise: (bytes) => bytes,
      timeoutMs: 1,
      /* A request that never answers, exactly as a hung socket does not. */
      fetchFn: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'TimeoutError')),
          );
        }),
    });
    await expect(provider.proveTx({ serialize: () => new Uint8Array([1]) })).rejects.toThrow(
      K1_PROVER_UNAVAILABLE,
    );
    expect(warn.mock.calls[0]?.[0]).toContain('/prove-k1');
    warn.mockRestore();
  });
});
