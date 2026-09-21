import { beforeEach, describe, expect, it, vi } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';

import {
  bytesToHex,
  envelopeDigest,
  K256_ENVELOPE_NONE,
  pointFromUncompressed,
  scalarToBytesBE,
  type CurvePoint,
  type CustodyPureCircuits,
  type K256DeviceIdentity,
} from './custodyContractSigning.js';
import {
  allCustodyCircuits,
  K1_ENROLMENT_UNCONFIRMED,
  CUSTODY_PROVER_UNAVAILABLE,
  CUSTODY_SETUP_INTERRUPTED,
  custodyProofNotBuilt,
  hexToBytes,
  loadCustodyAuthorityKey,
  loadCustodyRecord,
  type CustodyStorage,
} from './custodyContractPlan.js';
import {
  awaitingK1Coins,
  dropK1Coin,
  enqueueK1Coin,
  heldK1Coin,
  isK1NonceSpent,
  k1CoinCandidates,
  putK1Coin,
  putK1CoinCandidates,
} from './k1CoinStore.js';
import {
  activateK1Device,
  appendInboxK1,
  deployCustodyAccount,
  custodyPermissionlessCallAt,
  custodyPrivateStateId,
  custodyProofProvider,
  depositShieldedIntoCustody,
  k1Call,
  custodyPermissionlessCall,
  custodyUserKey,
  k1UserKey,
  custodyWalletSeed,
  custodyWitnesses,
  recoverK1DevicePoint,
  resetCustodySessionState,
  startCustodyAccountAgain,
  withdrawShieldedK1,
  type CustodyContractModule,
  type CustodyDeps,
  type CustodyDynamicSession,
  type CustodyLedgerApi,
} from './custodyContractClient.js';
import { jubjubDeviceSigner, type JubjubSigner } from './custodyJubjubSigner.js';

/**
 * The drill for the half of the account custody layer that has sockets on the end of
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
 * under test names it nowhere; `src/lib/custodyRecover.ts` is the only file in `src`
 * that does, inside an `import()`.
 */

/* -------------------------------------------------------------------------- */
/* Fakes                                                                      */
/* -------------------------------------------------------------------------- */

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

/**
 * A stand-in for the compiled build's pure circuits.
 *
 * Every derivation is a distinguishable, deterministic byte string rather than
 * the real hash, because what is being held here is WHICH derivation was called
 * with WHICH arguments — the real preimages are `custodyContractSigning.test.ts`'s business
 * and are already held there against the contract's own circuit.
 */
function pureFake(): CustodyPureCircuits {
  const tag = (name: string, ...parts: unknown[]): Uint8Array => {
    const text = `${name}:${parts.map((part) => String(part)).join('|')}`;
    const out = new Uint8Array(32);
    /* A FOLD OVER THE WHOLE TEXT, and not merely a spread of it. The first
       version xored each character into `out[i % 32]`, which leaves the TOP
       byte — the only one the jubjub grind's little-endian reading cares
       about — untouched by most of the text and, worse, CONSTANT across grind
       nonces, since a grind counter appended at the end moves only the last
       few positions. A jubjub signature against that fake could never land
       below the subgroup order and threw after every attempt: a failure about
       the fake dressed as a failure about the signer. Folding puts every
       character into every byte, which is the one property a stand-in for a
       hash has to have here. */
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
      out[i % 32] ^= text.charCodeAt(i);
    }
    for (let i = 0; i < 32; i++) {
      h = Math.imul(h ^ (i + 1), 0x01000193) >>> 0;
      out[i] ^= (h >>> 24) & 0xff;
    }
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
    /* The jubjub arm's circuits. `sig_r` second, `grind_nonce` last — the
       generated order, which is the whole point of holding a fake to it. The
       tag's bytes are effectively random in the top position, so the grind
       loop lands below the subgroup order after a handful of turns exactly as
       it does against the real build. */
    compute_public_point_with_jubjub: (scalar) => ({ x: scalar, y: scalar + 1n }),
    challenge_withdraw_unshielded_with_jubjub: (self, sigR, pk, color, amount, recipient, nonce, grind) =>
      tag('jj-wu', bytesToHex(self.bytes), sigR.x, pk.x, color, amount, bytesToHex(recipient.bytes), nonce, grind),
    challenge_withdraw_shielded_with_jubjub: (self, sigR, pk, recipient, color, amount, coin, nonce, grind) =>
      tag('jj-ws', bytesToHex(self.bytes), sigR.x, pk.x, bytesToHex(recipient.bytes), color, amount, coin.value, nonce, grind),
    challenge_withdraw_shielded_to_contract_with_jubjub: (self, sigR, pk, recipient, color, amount, coin, nonce, grind) =>
      tag('jj-wsc', bytesToHex(self.bytes), sigR.x, pk.x, bytesToHex(recipient.bytes), color, amount, coin.value, nonce, grind),
    challenge_append_inbox_with_jubjub: (self, sigR, pk, entry, nonce, grind) =>
      tag('jj-ai', bytesToHex(self.bytes), sigR.x, pk.x, entry.length, nonce, grind),
    challenge_rotate_enc_key_with_jubjub: (self, sigR, pk, newKey, nonce, grind) =>
      tag('jj-rk', bytesToHex(self.bytes), sigR.x, pk.x, bytesToHex(newKey), nonce, grind),
    challenge_add_device_with_jubjub: (self, sigR, pk, entry, nonce, grind) =>
      tag('jj-ad', bytesToHex(self.bytes), sigR.x, pk.x, bytesToHex(entry), nonce, grind),
    challenge_remove_device_with_jubjub: (self, sigR, pk, entry, nonce, grind) =>
      tag('jj-rd', bytesToHex(self.bytes), sigR.x, pk.x, bytesToHex(entry), nonce, grind),
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
  /** What the circuit returns — the change coin, for the shielded withdrawal. */
  circuitResult?: unknown;
  /** Where the indexer says a transaction's shielded outputs landed. */
  window?: { startIndex: number; endIndex: number } | null;
  /**
   * The CHAIN's hash for the identifier a coin was filed under, or null for an
   * indexer that cannot name the transaction yet.
   *
   * This harness's wallet carries no indexer url, so the spend's own hash walk
   * hands back midnight-js's identifier — which is the state a row has to be
   * renamed out of before a position can be asked about at all
   * (`settleK1AwaitingCoinByChainHash`). A drill that wants a settled position
   * has to say what the chain calls the transaction.
   */
  chainHash?: string | null;
  /** How many more spends fail the way a wrong coin POSITION fails. */
  spendFailures?: number;
  /**
   * How many more spends fail the way the PROVING SERVICE reports one.
   *
   * The same defect, arriving differently: for these circuits the proof is made
   * on a service, so an unsatisfiable witness reaches the client as that
   * service declining to prove rather than as a runtime naming a merkle path.
   */
  proofRefusals?: number;
}

function moduleFake(chain: FakeChain): CustodyContractModule {
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
function ledgerFake(chain: FakeChain, built: unknown[][]): CustodyLedgerApi {
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
      const roster = raw[0] === 30 ? allCustodyCircuits('k256') : [...chain.operations];
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
    /* A derived maintenance key is 32 bytes in, an opaque key out, and its
       verifying half is a tagged copy — enough for the deploy to carry an
       authority the caller can still sign for after a reinstall. */
    signingKeyFromBip340: (data: Uint8Array) => ({ bip340: bytesToHex(data) }),
    signatureVerifyingKey: (key: unknown) => ({ verifying: key }),
    ContractState: State,
    ContractDeploy: class {
      address = ADDRESS;
      circuits: string[];
      constructor(state: unknown) {
        this.circuits = (state as State).operationIds;
        /* The NAMES as well as the count: a wave-1 plan is right or wrong by
           which circuits it carries, and the arm's activation is the one that
           cannot be added later. */
        built.push(['deploy', this.circuits.length, this.circuits]);
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
         be asked to apply.
         AND IT RETURNS A NEW ONE, never itself. That is what the real binding
         does — `Intent.addDeploy` hands back a fresh wasm value and leaves the
         receiver alone — and a fake that mutated in place made three live
         deploys' worth of empty transactions invisible here (2026/09/17). With
         this shape, code that drops the return value submits a transaction
         carrying nothing, and the drills below say so. */
      new: () => intentFake(null, null),
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
  submitted: { unprovenTx: FakeTx }[];
  deps: Partial<CustodyDeps>;
  storage: ReturnType<typeof storageFake>;
  chain: FakeChain;
  built: unknown[][];
  calls: { circuit: string; args: unknown[] }[];
  /** Every connection opened: the id it was opened under, and whose store it serves. */
  connections: { privateStateId: string; account: unknown }[];
  /** Every address `findDeployedContract` was pointed at. */
  opened: string[];
  submits: number;
}

function harness(
  overrides: {
    chain?: Partial<FakeChain>;
    /** A node that accepts a submission and never applies it. */
    dropSubmissions?: boolean;
    /**
     * How many reads of the contract state answer NOTHING after the deploy has
     * landed — the indexer's own lag behind the node, which is a state every
     * live setup passes through and no fake had (2026/09/17).
     */
    indexerLagReads?: number;
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
  const connections: { privateStateId: string; account: unknown }[] = [];
  const opened: string[] = [];
  /* Every transaction as it was handed to the node, so a drill can assert what
     it CARRIED and not only that one was sent. */
  const submitted: { unprovenTx: FakeTx }[] = [];
  let lagReadsLeft = overrides.indexerLagReads ?? 0;
  const providers: Record<string, unknown> = {
    zkConfigProvider: {
      getVerifierKey: (circuit: string) =>
        Promise.resolve(allCustodyCircuits('k256').includes(circuit) ? new Uint8Array(2_400) : null),
    },
    publicDataProvider: {
      /* NOTHING AT THAT ADDRESS UNTIL WAVE 1 HAS LANDED. The module reads this
         to decide whether to deploy at all, so a fake that always answered with
         a state would make that decision untestable. */
      queryContractState: () => {
        /* The indexer's lag: the deploy has landed and this address is not
           served yet. Counted down so the same fake answers honestly once it
           has caught up. */
        if (chain.deployed && lagReadsLeft > 0) {
          lagReadsLeft -= 1;
          return Promise.resolve(null);
        }
        return Promise.resolve(
          chain.deployed
            ? { serialize: () => new Uint8Array([chain.operations.size]), data: 'state' }
            : null,
        );
      },
    },
    privateStateProvider: {
      setContractAddress: () => undefined,
      setSigningKey: () => Promise.resolve(undefined),
      getSigningKey: () => Promise.resolve('the-signing-key'),
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
          /* The seam, as the contract runs it: consume this entry, insert the
             next, advance auth_nonce. Only the gated circuits do this. */
          if (circuit.startsWith('activate_initial_device')) {
            /* THE ARM PICKS THE ENTRY DERIVATION, exactly as the contract does.
               A fake that always derived the k256 entry would put a device on
               the roster that a jubjub caller can never find, and the failure
               would read as "this key cannot approve" — a sentence about the
               fake rather than about the code. */
            const self = { bytes: hexToBytes(ADDRESS) };
            chain.devices.add(
              bytesToHex(
                circuit.endsWith('_with_jubjub')
                  ? pureFake().derive_device_entry_with_jubjub(
                      self,
                      args[0] as CurvePoint,
                      chain.epoch,
                      0n,
                    )
                  : pureFake().derive_device_entry_with_k256(
                      self,
                      args[0] as CurvePoint,
                      args[2] as bigint,
                      chain.epoch,
                      0n,
                    ),
              ),
            );
          } else {
            if (circuit.startsWith('withdraw_shielded') && (chain.proofRefusals ?? 0) > 0) {
              /* What the proving service's refusal reaches the caller as: a
                 plain sentence, and the signal on the error's NAME. */
              chain.proofRefusals = (chain.proofRefusals ?? 0) - 1;
              return Promise.reject(custodyProofNotBuilt());
            }
            if (circuit.startsWith('withdraw_shielded') && (chain.spendFailures ?? 0) > 0) {
              /* The failure a wrong position gives: no transaction is
                 submitted, nothing is spent, and the words name the merkle
                 path the runtime could not build. */
              chain.spendFailures = (chain.spendFailures ?? 0) - 1;
              return Promise.reject(new Error('could not build the merkle path for this coin'));
            }
            chain.authNonce += 1n;
          }
          /* The shape midnight-js hands back: a `public` half and a `private`
             half that is marked privacy-sensitive in its own type. The fake
             carries both so the drill can hold the rule that only
             `private.result` crosses back out of this module. */
          return Promise.resolve({
            public: { txId: `id-${calls.length}` },
            private: {
              result: chain.circuitResult,
              input: 'ZK-aligned input, which must never leave',
              nextPrivateState: { coins: {} },
            },
          });
        },
    },
  );

  const deps: Partial<CustodyDeps> = {
    storage: () => storage,
    randomBytes: (length) => new Uint8Array(length).fill(7),
    wallet: () =>
      Promise.resolve({
        network: { networkId: 'stagenet', indexerHttpUrl: '' },
      } as never),
    contractModule: () => Promise.resolve(moduleFake(chain)),
    providers: (_wallet: unknown, privateStateId: string, account: unknown = null) => {
      connections.push({ privateStateId, account });
      return Promise.resolve(providers);
    },
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
          submitted.push(options as { unprovenTx: FakeTx });
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
        findDeployedContract: (_providers: unknown, options: unknown) => {
          opened.push((options as { contractAddress: string }).contractAddress);
          return Promise.resolve({ callTx });
        },
      }),
    /* A CLOCK THAT MOVES. `awaitAuthorityCounter` gives up on a deadline, and a
       frozen clock would spin for ever in the one drill that wants to see it
       give up. Five seconds a read reaches the deadline in two dozen turns. */
    now: () => {
      state.clock += 5_000;
      return state.clock;
    },
    sleep: () => Promise.resolve(undefined),
    commitmentWindow: () => Promise.resolve(chain.window ?? null),
    resolveChainHash: () => Promise.resolve(chain.chainHash ?? null),
  };

  return {
    deps,
    storage,
    chain,
    built,
    calls,
    connections,
    opened,
    submitted,
    get submits() {
      return state.submits;
    },
  };
}

/**
 * An intent whose `add*` calls return a NEW intent, as the wasm binding's do.
 */
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
  session: CustodyDynamicSession;
  device: K256DeviceIdentity;
  signed: Uint8Array[];
} {
  const secret = scalarToBytesBE(12345678901234567890n);
  const point = pointFromUncompressed(secp256k1.getPublicKey(secret, false));
  const signed: Uint8Array[] = [];
  const session: CustodyDynamicSession = {
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

/** The recovery `src/lib/custodyRecover.ts` performs, written out for the drill. */
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
  resetCustodySessionState();
  /* The coin store reads `window.localStorage` directly — it is the private
     state, and a private state that did not survive a reload would not be one.
     A fresh map per test is a fresh browser. */
  const coins = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => coins.get(key) ?? null,
        setItem: (key: string, value: string) => void coins.set(key, value),
        removeItem: (key: string) => void coins.delete(key),
      },
    },
  });
});

/* -------------------------------------------------------------------------- */

describe('the server proof provider', () => {
  const unproven = { serialize: () => new Uint8Array([0xab, 0xcd]) };

  it('posts the circuit, the transaction, and the network, and reads the proof back', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ provenTx: 'beef' }), { status: 200 })),
    );
    const provider = custodyProofProvider({
      endpoint: 'https://example.test/balancer/prove-account-custody',
      network: 'stagenet',
      circuit: 'append_inbox_with_k256',
      deserialise: (bytes) => ({ bytes }),
      fetchFn: fetchFn,
    });

    expect(await provider.proveTx(unproven)).toEqual({ bytes: new Uint8Array([0xbe, 0xef]) });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.test/balancer/prove-account-custody');
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
    const provider = custodyProofProvider({
      endpoint: 'https://example.test/balancer/prove-account-custody',
      network: 'stagenet',
      circuit: 'append_inbox_with_k256',
      deserialise: (bytes) => bytes,
      fetchFn: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    await expect(provider.proveTx(unproven)).rejects.toThrow(CUSTODY_PROVER_UNAVAILABLE);
    expect(warn.mock.calls[0]?.[0]).toContain('/prove-account-custody');
    warn.mockRestore();
  });

  it('refuses on a 5xx, and says the service’s own code in the console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const provider = custodyProofProvider({
      endpoint: 'https://example.test/balancer/prove-account-custody',
      network: 'stagenet',
      circuit: 'append_inbox_with_k256',
      deserialise: (bytes) => bytes,
      fetchFn: () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'no-key', detail: 'account-custody not staged' }), {
            status: 503,
          }),
        ),
    });
    await expect(provider.proveTx(unproven)).rejects.toThrow(CUSTODY_PROVER_UNAVAILABLE);
    expect(warn.mock.calls[0]?.[0]).toContain('no-key');
    warn.mockRestore();
  });

  it('refuses a 200 that is a proxy error page rather than a proof', async () => {
    const provider = custodyProofProvider({
      endpoint: 'https://example.test/balancer/prove-account-custody',
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
    const first = custodyWalletSeed(test.deps as CustodyDeps, '0xabc');
    const second = custodyWalletSeed(test.deps as CustodyDeps, '0xabc');
    expect(first).toHaveLength(32);
    expect(bytesToHex(second)).toBe(bytesToHex(first));
  });

  it('gives a different user a different one', () => {
    const test = harness();
    const deps = { ...test.deps, randomBytes: (n: number) => new Uint8Array(n).fill(1) };
    custodyWalletSeed(deps as CustodyDeps, '0xabc');
    const other = custodyWalletSeed(
      { ...deps, randomBytes: (n: number) => new Uint8Array(n).fill(2) } as CustodyDeps,
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
    expect(custodyWalletSeed(deps as CustodyDeps, '0xabc')).toHaveLength(32);
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
    const session: CustodyDynamicSession = {
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
    const result = await deployCustodyAccount(session, device, undefined, test.deps);

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

  /* THE DEFECT THIS CATCHES cost three live deploys on 2026/09/17. `addDeploy`
     hands back a NEW intent, so a transaction built from the intent the call
     was made ON carries nothing: the node accepts it, a fee is booked, and no
     contract is created. Asserted on what was SUBMITTED, because everything
     else about that run looked right. */
  it('submits a transaction that actually carries the deploy', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    await deployCustodyAccount(session, device, undefined, test.deps);

    const first = test.submitted[0].unprovenTx;
    expect(first.deploys).toHaveLength(10);
    /* And each maintenance wave carries its ten keys. */
    expect(test.submitted[1].unprovenTx.inserts).toHaveLength(10);
    expect(test.submitted[2].unprovenTx.inserts).toHaveLength(10);
  });

  /* THE DEFECT THIS CATCHES ended every live setup on stagenet on 2026/09/17,
     about twenty seconds in. The deploy lands, the wave that follows it asks
     the chain for the authority counter, and for the first seconds the indexer
     does not serve the new address yet — `queryContractState` answers null and
     `queryState` turns that into a refusal. The wait is the one caller that has
     a recourse, so an unreadable read is "not yet" here, not a failure. */
  it('waits through an indexer that does not serve the new account yet', async () => {
    const test = harness({ indexerLagReads: 6 });
    const { session, device } = deviceFake();
    const result = await deployCustodyAccount(session, device, undefined, test.deps);

    expect(result.record.wavesDone).toBe(3);
    expect(test.submits).toBe(3);
  });

  /* And the deadline still refuses, so an indexer that never answers is a
     sentence rather than a spinner. */
  it('gives up in one sentence when the account is never served', async () => {
    const test = harness({ indexerLagReads: Number.MAX_SAFE_INTEGER });
    const { session, device } = deviceFake();
    await expect(deployCustodyAccount(session, device, undefined, test.deps)).rejects.toThrow(
      'Setting up your Passport is taking longer than expected. Try again.',
    );
  });

  /* `'v4'` is load-bearing: `compact-js` hardcodes `'v3'`, whose keys carry a
     different header, and the insert throws before a transaction exists. */
  it('inserts verifier keys at version v4', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    await deployCustodyAccount(session, device, undefined, test.deps);
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
    await deployCustodyAccount(session, device, undefined, test.deps);
    const counters = test.built.filter((e) => e[0] === 'update').map((e) => e[3]);
    expect(counters).toEqual([0n, 1n]);
    /* And the retirement carries the counter its own application expects: one
       past the update it rides on. */
    expect(test.built.filter((e) => e[0] === 'authority').map((e) => e[3])).toEqual([2n]);
  });

  it('remembers where it got to, and resumes rather than redeploying', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    await deployCustodyAccount(session, device, undefined, test.deps);
    const after = test.submits;

    const again = await deployCustodyAccount(session, device, undefined, test.deps);
    expect(test.submits).toBe(after);
    expect(again.record.address).toBe(ADDRESS);
    expect(loadCustodyRecord(test.storage, k1UserKey(session), 'stagenet')?.wavesDone).toBe(3);
  });

  it('reports the steps as it goes', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    const phases: string[] = [];
    await deployCustodyAccount(
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
        ...(await (test.deps.providers as NonNullable<CustodyDeps['providers']>)(
          null as never,
          'p',
        )),
        zkConfigProvider: { getVerifierKey: () => Promise.resolve(null) },
      }),
    };
    const { session, device } = deviceFake();
    await expect(deployCustodyAccount(session, device, undefined, deps)).rejects.toThrow(
      /not part of this build yet/,
    );
  });
});

describe('activating the Dynamic key', () => {
  it('passes the point, the salt, and the envelope, in that order', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    await deployCustodyAccount(session, device, undefined, test.deps);
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
    await deployCustodyAccount(fake.session, fake.device, undefined, test.deps);
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
    await deployCustodyAccount(session, device, undefined, test.deps);
    await expect(
      appendInboxK1(session, device, new Uint8Array(192), undefined, test.deps),
    ).rejects.toThrow(/not finished being set up/);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * The connection, the id it is made under, and what comes back out of a call.
 *
 * ONE PRIVATE-STATE ID. There were two — the record made one from the Dynamic
 * user before the account had an address, and the coin store keys everything
 * by network and address — and a witness reading one while the store writes
 * the other is a Passport that can be paid and can never spend.
 */
describe('the private state a connection is opened with', () => {
  async function readyPassport() {
    const test = harness();
    const fake = deviceFake();
    await deployCustodyAccount(fake.session, fake.device, undefined, test.deps);
    await activateK1Device(fake.session, fake.device, undefined, test.deps);
    return { test, ...fake };
  }

  it('is the coin store\'s, from the moment the account has an address', async () => {
    const { test, session } = await readyPassport();
    const record = loadCustodyRecord(test.storage, k1UserKey(session), 'stagenet');
    expect(record?.address).toBe(ADDRESS);
    /* The record's own id and the store's are now the same string, and the
       helper agrees with both — so a record written by an older build resolves
       to the same place. */
    expect(record?.privateStateId).toBe(`passport-account-custody-stagenet-${ADDRESS}`);
    expect(custodyPrivateStateId(record!)).toBe(record?.privateStateId);
    expect(
      custodyPrivateStateId({ network: 'stagenet', address: null, privateStateId: 'before-deploy' }),
    ).toBe('before-deploy');

    /* And every connection after the deploy is opened under it, serving THIS
       account's store. */
    const afterDeploy = test.connections.slice(1);
    expect(afterDeploy.length).toBeGreaterThan(0);
    for (const connection of afterDeploy) {
      expect(connection.privateStateId).toBe(record?.privateStateId);
      expect(connection.account).toEqual({ network: 'stagenet', address: ADDRESS });
    }
  });

  it('hands back the circuit\'s own result and nothing else from the call', async () => {
    const { test, session, device } = await readyPassport();
    const change = { is_some: true, value: { nonce: new Uint8Array(32), color: new Uint8Array(32), value: 40n } };
    test.chain.circuitResult = change;

    const result = await k1Call(
      session,
      device,
      {
        operation: 'append_inbox',
        args: [new Uint8Array(192)],
        challenge: (pure, context, pk) =>
          pure.challenge_append_inbox_with_k256({ bytes: context.contractAddress }, pk, new Uint8Array(192), context.authNonce),
      },
      undefined,
      test.deps,
    );

    expect(result.result).toBe(change);
    /* The ZK-aligned input, the private transcript, and the next private state
       are all on the object midnight-js returned and none of them are on this
       one. `CallResultPrivate` says in as many words that the field you need
       is extracted rather than the object carried. */
    expect(Object.keys(result).sort()).toEqual(['explorerUrl', 'record', 'result', 'txHash']);
    expect(JSON.stringify(Object.keys(result))).not.toContain('private');
  });

  it('reads no result out of a call that returned none', async () => {
    const { test, session, device } = await readyPassport();
    test.chain.circuitResult = undefined;
    const result = await appendInboxK1(session, device, new Uint8Array(192), undefined, test.deps);
    expect(result.result).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */

/**
 * Paying somebody else's Passport: the same permissionless circuit, a
 * different contract at the other end, and — deliberately — none of this
 * Passport's own private state served to it.
 */
describe('a permissionless call on another account', () => {
  async function readyPassport() {
    const test = harness();
    const fake = deviceFake();
    await deployCustodyAccount(fake.session, fake.device, undefined, test.deps);
    await activateK1Device(fake.session, fake.device, undefined, test.deps);
    return { test, ...fake };
  }

  const PEER = 'cd'.repeat(32);

  it('calls the circuit on the target, with the circuit\'s own arguments only', async () => {
    const { test, session, device } = await readyPassport();
    const coin = { nonce: new Uint8Array(32), color: new Uint8Array(32), value: 40n };
    const entry = new Uint8Array(192).fill(3);

    const result = await custodyPermissionlessCallAt(
      session,
      device,
      PEER,
      { operation: 'deposit_shielded', args: [coin, entry] },
      undefined,
      test.deps,
    );

    const call = test.calls.find((c) => c.circuit === 'deposit_shielded');
    /* Two arguments and no authorisation trailer: nobody signs a deposit. */
    expect(call?.args).toEqual([coin, entry]);
    expect(test.opened[test.opened.length - 1]).toBe(PEER);
    expect(result.txHash).toBe('id-2');

    /* The connection was made under an id of the RECIPIENT's address, with no
       account — so the store this Passport spends from is never served to a
       connection addressed at somebody else's account. */
    const connection = test.connections[test.connections.length - 1];
    expect(connection.privateStateId).toBe(`passport-account-custody-peer-stagenet-${PEER}`);
    expect(connection.account).toBeNull();
  });

  it('refuses an address that is not one', async () => {
    const { test, session, device } = await readyPassport();
    await expect(
      custodyPermissionlessCallAt(session, device, 'not-an-address', { operation: 'deposit_shielded', args: [] }, undefined, test.deps),
    ).rejects.toThrow(/cannot be paid from here/);
  });

  it('refuses before this Passport is finished being set up', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    await expect(
      custodyPermissionlessCallAt(session, device, PEER, { operation: 'deposit_shielded', args: [] }, undefined, test.deps),
    ).rejects.toThrow(/not finished being set up/);
  });
});

/* -------------------------------------------------------------------------- */

describe('the witnesses', () => {
  /* ONE WITNESS, AND IT READS THE COIN STORE. `held_coin` is the only witness
     the compiled build declares, and the private state this connection is
     served IS the store (`k1PrivateStateProvider`), so the witness is a read
     of `coins[colourHex]` and a spend is a read of the same thing the balance
     was shown from. */
  const COLOUR = new Uint8Array(32).fill(0x1a);
  const COLOUR_HEX = '1a'.repeat(32);
  const NONCE_HEX = '7f'.repeat(32);

  function storeState(coins: Record<string, unknown>) {
    return { encSecretKeyHex: null, coins, queued: {}, spentNonces: [], mtIndexCandidates: {} };
  }

  it('answers held_coin from the private state, in the contract\'s own field names', () => {
    const witnesses = custodyWitnesses();
    expect(Object.keys(witnesses)).toEqual(['held_coin']);
    const privateState = storeState({
      [COLOUR_HEX]: { nonceHex: NONCE_HEX, colorHex: COLOUR_HEX, value: '250', mtIndex: '7' },
    });
    const [returned, coin] = witnesses.held_coin({ privateState } as never, COLOUR);
    /* Returned UNCHANGED: a witness that edited the private state would be a
       second writer to the store, and midnight-js writes whatever it returns
       back through the provider after the call. */
    expect(returned).toBe(privateState);
    expect(bytesToHex(coin.nonce)).toBe(NONCE_HEX);
    expect(bytesToHex(coin.color)).toBe(COLOUR_HEX);
    expect(coin.value).toBe(250n);
    expect(coin.mt_index).toBe(7n);
  });

  it('refuses in one sentence when the store holds nothing of that colour', () => {
    const witnesses = custodyWitnesses();
    expect(() =>
      witnesses.held_coin({ privateState: storeState({}) } as never, COLOUR),
    ).toThrow(/nothing of that kind/);
    expect(() =>
      witnesses.held_coin({ privateState: undefined } as never, COLOUR),
    ).toThrow(/nothing of that kind/);
    expect(() =>
      witnesses.held_coin({ privateState: storeState({}) } as never, new Uint8Array(4)),
    ).toThrow(/nothing of that kind/);
  });
});

/* -------------------------------------------------------------------------- */

describe('resuming a half-built Passport', () => {
  /* THREE CASES, AND EACH OF THEM HAPPENED TO SOMEBODY. The record and the
     chain disagree in both directions, and the module now asks the chain. */

  it('re-submits a wave the record calls done that the chain does not have', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    await deployCustodyAccount(session, device, undefined, test.deps);

    /* Wave 3's keys are taken back off the chain, as a dropped update would
       leave them, while the record still says all three waves landed. */
    for (const circuit of ['issue_grant_with_k256', 'revoke_grant_with_k256',
      'revoke_all_grants_with_k256']) {
      test.chain.operations.delete(circuit);
    }
    const before = test.submits;
    await deployCustodyAccount(session, device, undefined, test.deps);
    expect(test.submits).toBeGreaterThan(before);
    /* And what it re-submitted is a maintenance update, not a second deploy. */
    expect(test.built.filter((entry) => entry[0] === 'deploy')).toHaveLength(1);
  });

  it('skips a wave the chain has that the record never recorded', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    await deployCustodyAccount(session, device, undefined, test.deps);
    const landed = test.submits;

    /* The tab closed before the last write: the chain is complete, the record
       is two waves behind. Nothing may be paid for twice. */
    const record = loadCustodyRecord(test.storage, k1UserKey(session), 'stagenet');
    test.storage.data.set(
      'passport-account-custody:v1',
      JSON.stringify({
        [`${k1UserKey(session)}|stagenet`]: { ...record, wavesDone: 1 },
      }),
    );

    const again = await deployCustodyAccount(session, device, undefined, test.deps);
    expect(test.submits).toBe(landed);
    expect(again.record.wavesDone).toBe(3);
    expect(loadCustodyRecord(test.storage, k1UserKey(session), 'stagenet')?.wavesDone).toBe(3);
  });

  it('redeploys when the record names an address the chain has never heard of', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    await deployCustodyAccount(session, device, undefined, test.deps);

    /* The deploy itself was dropped: a record, an address, and nothing there. */
    test.chain.deployed = false;
    test.chain.operations.clear();
    test.chain.authorityCounter = 0n;
    await deployCustodyAccount(session, device, undefined, test.deps);
    expect(test.built.filter((entry) => entry[0] === 'deploy')).toHaveLength(2);
  });

  /* THE ORDER THAT MATTERS: the counter first, the record second. A submission
     the node accepts and never applies must leave `wavesDone` where it was, or
     the next attempt skips ten circuits nothing can add afterwards. */
  it('does not record a wave whose update never landed', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    await deployCustodyAccount(session, device, undefined, test.deps);

    const stuck = harness({
      chain: { ...test.chain, operations: new Set(test.chain.operations) },
      storage: test.storage,
      dropSubmissions: true,
    });
    stuck.chain.operations.delete('issue_grant_with_k256');
    const before = loadCustodyRecord(test.storage, k1UserKey(session), 'stagenet')?.wavesDone;

    await expect(deployCustodyAccount(session, device, undefined, stuck.deps)).rejects.toThrow(
      /taking longer than expected/,
    );
    expect(loadCustodyRecord(test.storage, k1UserKey(session), 'stagenet')?.wavesDone).toBe(before);
  });
});

describe('a setup that cannot be finished', () => {
  /** A node that applies the first transaction and drops every one after it. */
  const oneWaveOnly = (deps: Partial<CustodyDeps>): Partial<CustodyDeps> => {
    let submits = 0;
    return {
      ...deps,
      /* The counter is OUTSIDE the factory on purpose: the module asks for
         `contracts()` once per wave, so a counter made inside would restart at
         zero every time and never refuse anything. */
      contracts: async () => {
        const real = await (deps.contracts as NonNullable<CustodyDeps['contracts']>)();
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
  const withoutTheProvidersKey = async (deps: Partial<CustodyDeps>) => ({
    ...(await (deps.providers as NonNullable<CustodyDeps['providers']>)(null as never, 'p')),
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
      deployCustodyAccount(session, device, undefined, oneWaveOnly(test.deps)),
    ).rejects.toThrow('tab closed');

    const address = loadCustodyRecord(test.storage, k1UserKey(session), 'stagenet')?.address as string;
    expect(loadCustodyAuthorityKey(test.storage, address)).toBe('the-signing-key');

    /* THE RELOAD: the tab's own cache is gone and the provider never held it,
       so only the stored key can finish the account. */
    resetCustodySessionState();
    const reloaded = harness({ chain: test.chain, storage: test.storage });
    const finished = await deployCustodyAccount(session, device, undefined, {
      ...reloaded.deps,
      providers: () => withoutTheProvidersKey(reloaded.deps),
    });
    expect(finished.record.wavesDone).toBe(3);
    /* The retirement landed with the last wave, so the key is deleted rather
       than left in a browser for ever. */
    expect(loadCustodyAuthorityKey(test.storage, address)).toBeNull();
  });

  /* THE OTHER PATH. When the key is genuinely gone — a browser that cleared
     its storage, or one that refused to write it in the first place — the
     record says so ONCE and every entry point refuses from there, rather than
     offering a step that fails every time it is pressed. */
  it('marks the record terminal when the key is gone, and refuses from then on', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    /* A browser that remembers the progress and not the key. */
    const forgetful: CustodyStorage = {
      getItem: (key) => test.storage.getItem(key),
      setItem: (key, value) => {
        if (key === 'passport-account-custody-authority:v1') return;
        test.storage.setItem(key, value);
      },
      removeItem: (key) => test.storage.removeItem(key),
    };
    await expect(
      deployCustodyAccount(session, device, undefined, {
        ...oneWaveOnly(test.deps),
        storage: () => forgetful,
      }),
    ).rejects.toThrow('tab closed');

    resetCustodySessionState();
    const reloaded = harness({ chain: test.chain, storage: test.storage });
    await expect(
      deployCustodyAccount(session, device, undefined, {
        ...reloaded.deps,
        storage: () => forgetful,
        providers: () => withoutTheProvidersKey(reloaded.deps),
      }),
    ).rejects.toThrow(CUSTODY_SETUP_INTERRUPTED);

    expect(loadCustodyRecord(test.storage, k1UserKey(session), 'stagenet')?.interrupted).toBe(true);

    /* Every door is shut from here, and each says the same sentence. */
    await expect(deployCustodyAccount(session, device, undefined, test.deps)).rejects.toThrow(
      CUSTODY_SETUP_INTERRUPTED,
    );
    await expect(activateK1Device(session, device, undefined, test.deps)).rejects.toThrow(
      CUSTODY_SETUP_INTERRUPTED,
    );
  });

  it('starts again by throwing the record and the key away', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    await deployCustodyAccount(session, device, undefined, test.deps);
    const address = loadCustodyRecord(test.storage, k1UserKey(session), 'stagenet')?.address as string;

    await startCustodyAccountAgain(session, device, test.deps);
    expect(loadCustodyRecord(test.storage, k1UserKey(session), 'stagenet')).toBeNull();
    expect(loadCustodyAuthorityKey(test.storage, address)).toBeNull();

    /* A fresh chain, and the next press builds a whole Passport again. */
    const fresh = harness({ storage: test.storage });
    const again = await deployCustodyAccount(session, device, undefined, fresh.deps);
    expect(again.record.wavesDone).toBe(3);
    expect(fresh.built.filter((entry) => entry[0] === 'deploy')).toHaveLength(1);
  });

  it('has nothing to throw away when there is no record', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    await expect(startCustodyAccountAgain(session, device, test.deps)).resolves.toBeUndefined();
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
    const provider = custodyProofProvider({
      endpoint: 'https://example.test/balancer/prove-account-custody',
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
    const provider = custodyProofProvider({
      endpoint: 'https://example.test/balancer/prove-account-custody',
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
      CUSTODY_PROVER_UNAVAILABLE,
    );
    expect(warn.mock.calls[0]?.[0]).toContain('/prove-account-custody');
    warn.mockRestore();
  });
});

/* -------------------------------------------------------------------------- */

/**
 * Leg one of a shielded payment, and what it leaves behind.
 *
 * THE COIN IS READ ONCE AND USED TWICE — the challenge the device signs binds
 * it, and the witness hands the same one to the proof. The drills below hold
 * that, and hold the more expensive rule: the change coin's description exists
 * nowhere but in the value the call returned, so it is written down before
 * anything else happens and it is never written with a position nobody has
 * asked about.
 */
describe('the shielded withdrawal', () => {
  const COLOUR = '1a'.repeat(32);
  const NONCE = '7f'.repeat(32);
  const CHANGE_NONCE = 'a1'.repeat(32);
  /* 32 bytes, as a chain hash is: the shape is what tells a row that is ready
     to settle from one still filed under midnight-js's 33-byte identifier. */
  const CHAIN_HASH = 'bc'.repeat(32);

  function changeResult(value: bigint) {
    return {
      is_some: true,
      value: {
        nonce: hexToBytes(CHANGE_NONCE),
        color: hexToBytes(COLOUR),
        value,
      },
    };
  }

  async function readyPassport(chain: Partial<FakeChain> = {}) {
    const test = harness({ chain });
    const fake = deviceFake();
    await deployCustodyAccount(fake.session, fake.device, undefined, test.deps);
    await activateK1Device(fake.session, fake.device, undefined, test.deps);
    const account = { network: 'stagenet', address: ADDRESS };
    putK1Coin(account, { colour: COLOUR, nonce: NONCE, value: 100n, mtIndex: 5n });
    return { test, account, ...fake };
  }

  it('signs over the coin the store holds, and pays the key it was given', async () => {
    const { test, session, device } = await readyPassport({
      circuitResult: changeResult(60n),
      window: { startIndex: 8, endIndex: 9 },
      chainHash: CHAIN_HASH,
    });
    const ownKey = new Uint8Array(32).fill(0x11);

    await withdrawShieldedK1(
      session,
      device,
      { recipientCoinPublicKey: ownKey, colourHex: COLOUR, amount: 40n },
      undefined,
      test.deps,
    );

    const call = test.calls.find((c) => c.circuit === 'withdraw_shielded_with_k256');
    /* (recipient, colour, amount) then the four authorisation arguments. */
    expect(call?.args).toHaveLength(7);
    expect(call?.args[0]).toEqual({ bytes: ownKey });
    expect(call?.args[1]).toEqual(hexToBytes(COLOUR));
    expect(call?.args[2]).toBe(40n);
  });

  it('records the change coin and its position when the chain gives one answer', async () => {
    const { test, account, session, device } = await readyPassport({
      circuitResult: changeResult(60n),
      window: { startIndex: 8, endIndex: 9 },
      chainHash: CHAIN_HASH,
    });

    const result = await withdrawShieldedK1(
      session,
      device,
      { recipientCoinPublicKey: new Uint8Array(32), colourHex: COLOUR, amount: 40n },
      undefined,
      test.deps,
    );

    expect(result.change).toEqual({
      outcome: 'change',
      nonce: CHANGE_NONCE,
      colour: COLOUR,
      value: 60n,
    });
    expect(result.changePosition).toBe('settled');
    expect(heldK1Coin(account, COLOUR)).toEqual({
      colour: COLOUR,
      nonce: CHANGE_NONCE,
      value: 60n,
      mtIndex: 8n,
    });
    /* The coin that was spent cannot come back, by any route. */
    expect(isK1NonceSpent(account, NONCE)).toBe(true);
  });

  it('keeps both candidates when the withdrawal had two outputs', async () => {
    const { test, account, session, device } = await readyPassport({
      circuitResult: changeResult(60n),
      window: { startIndex: 8, endIndex: 10 },
      chainHash: CHAIN_HASH,
    });

    const result = await withdrawShieldedK1(
      session,
      device,
      { recipientCoinPublicKey: new Uint8Array(32), colourHex: COLOUR, amount: 40n },
      undefined,
      test.deps,
    );

    expect(result.changePosition).toBe('candidates');
    expect(k1CoinCandidates(account, COLOUR)).toEqual([8n, 9n]);
    expect(heldK1Coin(account, COLOUR)?.mtIndex).toBe(8n);
  });

  it('holds the change as arriving when the chain has not answered yet', async () => {
    const { test, account, session, device } = await readyPassport({
      circuitResult: changeResult(60n),
      window: null,
    });

    const result = await withdrawShieldedK1(
      session,
      device,
      { recipientCoinPublicKey: new Uint8Array(32), colourHex: COLOUR, amount: 40n },
      undefined,
      test.deps,
    );

    expect(result.changePosition).toBe('awaiting');
    expect(heldK1Coin(account, COLOUR)).toBeNull();
    expect(awaitingK1Coins(account)).toEqual([
      { colour: COLOUR, nonce: CHANGE_NONCE, value: 60n, txId: 'id-2' },
    ]);
  });

  it('promotes the next payment when the spend consumed the coin exactly', async () => {
    const { test, account, session, device } = await readyPassport({
      circuitResult: { is_some: false, value: { nonce: hexToBytes(NONCE), color: hexToBytes(COLOUR), value: 0n } },
    });
    enqueueK1Coin(account, { colour: COLOUR, nonce: CHANGE_NONCE, value: 250n, mtIndex: 9n });

    const result = await withdrawShieldedK1(
      session,
      device,
      { recipientCoinPublicKey: new Uint8Array(32), colourHex: COLOUR, amount: 100n },
      undefined,
      test.deps,
    );

    expect(result.change).toEqual({ outcome: 'none' });
    expect(result.changePosition).toBe('none');
    expect(heldK1Coin(account, COLOUR)?.value).toBe(250n);
  });

  it('retries the next candidate position, and settles the one that proves', async () => {
    const { test, account, session, device } = await readyPassport({
      circuitResult: changeResult(60n),
      window: { startIndex: 20, endIndex: 21 },
      chainHash: CHAIN_HASH,
      /* The first attempt fails the way a wrong position fails. */
      spendFailures: 1,
    });
    putK1CoinCandidates(account, { colour: COLOUR, nonce: NONCE, value: 100n }, [5n, 6n]);

    const result = await withdrawShieldedK1(
      session,
      device,
      { recipientCoinPublicKey: new Uint8Array(32), colourHex: COLOUR, amount: 40n },
      undefined,
      test.deps,
    );

    /* Two attempts, the second against the second candidate, and the position
       that proved is a fact from then on. */
    expect(test.calls.filter((c) => c.circuit === 'withdraw_shielded_with_k256')).toHaveLength(2);
    expect(result.changePosition).toBe('settled');
    expect(k1CoinCandidates(account, COLOUR)).toEqual([]);
  });

  /* THE DEFECT THIS CATCHES stopped the first live spend of a change coin on
     2026/09/18. A wrong position is an unsatisfiable witness, and for these
     circuits the proof is made on a SERVICE — so it arrives as that service
     declining, not as a runtime naming a merkle path. Collapsed into "the
     service is not answering", it told this retry the position was fine, and
     the second candidate was never tried. */
  it('retries the next candidate when the proving service declines to prove', async () => {
    const { test, account, session, device } = await readyPassport({
      circuitResult: changeResult(60n),
      window: { startIndex: 20, endIndex: 21 },
      chainHash: CHAIN_HASH,
      proofRefusals: 1,
    });
    putK1CoinCandidates(account, { colour: COLOUR, nonce: NONCE, value: 100n }, [5n, 6n]);

    const result = await withdrawShieldedK1(
      session,
      device,
      { recipientCoinPublicKey: new Uint8Array(32), colourHex: COLOUR, amount: 40n },
      undefined,
      test.deps,
    );

    expect(test.calls.filter((c) => c.circuit === 'withdraw_shielded_with_k256')).toHaveLength(2);
    expect(result.changePosition).toBe('settled');
    expect(k1CoinCandidates(account, COLOUR)).toEqual([]);
  });

  /* And when they run out, the sentence is the plain one — not a word about
     witnesses in front of somebody who chose Google. */
  it('gives up in the plain sentence when the service declines every candidate', async () => {
    const { test, account, session, device } = await readyPassport({ proofRefusals: 5 });
    putK1CoinCandidates(account, { colour: COLOUR, nonce: NONCE, value: 100n }, [5n, 6n]);

    await expect(
      withdrawShieldedK1(
        session,
        device,
        { recipientCoinPublicKey: new Uint8Array(32), colourHex: COLOUR, amount: 40n },
        undefined,
        test.deps,
      ),
    ).rejects.toThrow('That payment could not be completed just now. Try again in a moment.');
    expect(test.calls.filter((c) => c.circuit === 'withdraw_shielded_with_k256')).toHaveLength(2);
  });

  it('gives up rather than looping when the candidates run out', async () => {
    const { test, account, session, device } = await readyPassport({ spendFailures: 5 });
    putK1CoinCandidates(account, { colour: COLOUR, nonce: NONCE, value: 100n }, [5n, 6n]);

    await expect(
      withdrawShieldedK1(
        session,
        device,
        { recipientCoinPublicKey: new Uint8Array(32), colourHex: COLOUR, amount: 40n },
        undefined,
        test.deps,
      ),
    ).rejects.toThrow(/merkle/);
    expect(test.calls.filter((c) => c.circuit === 'withdraw_shielded_with_k256')).toHaveLength(2);
  });

  it('refuses before anything is signed when there is nothing to send', async () => {
    const { test, account, session, device } = await readyPassport();
    dropK1Coin(account, COLOUR);
    await expect(
      withdrawShieldedK1(
        session,
        device,
        { recipientCoinPublicKey: new Uint8Array(32), colourHex: COLOUR, amount: 40n },
        undefined,
        test.deps,
      ),
    ).rejects.toThrow(/nothing of that kind/);
    await expect(
      withdrawShieldedK1(
        session,
        device,
        { recipientCoinPublicKey: new Uint8Array(32), colourHex: 'not-a-colour', amount: 40n },
        undefined,
        test.deps,
      ),
    ).rejects.toThrow(/not something this Passport can send/);
  });

  it('refuses before the Passport is finished being set up', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    await expect(
      withdrawShieldedK1(
        session,
        device,
        { recipientCoinPublicKey: new Uint8Array(32), colourHex: COLOUR, amount: 40n },
        undefined,
        test.deps,
      ),
    ).rejects.toThrow(/not finished being set up/);
  });
});

/* -------------------------------------------------------------------------- */

describe('leg three into another one of these accounts', () => {
  it('seals a description the recipient can open and sends it with the note', async () => {
    const test = harness();
    const fake = deviceFake();
    await deployCustodyAccount(fake.session, fake.device, undefined, test.deps);
    await activateK1Device(fake.session, fake.device, undefined, test.deps);
    const peer = 'cd'.repeat(32);

    await depositShieldedIntoCustody(
      fake.session,
      fake.device,
      {
        targetAddress: peer,
        recipientEncKeyHex: 'ab'.repeat(32),
        coin: { colour: '1a'.repeat(32), nonce: '7f'.repeat(32), value: 40n },
      },
      undefined,
      test.deps,
    );

    const call = test.calls.find((c) => c.circuit === 'deposit_shielded');
    expect(call?.args).toHaveLength(2);
    expect(call?.args[0]).toEqual({
      nonce: hexToBytes('7f'.repeat(32)),
      color: hexToBytes('1a'.repeat(32)),
      value: 40n,
    });
    /* 192 bytes, whatever is in them — the container is a fixed size so an
       observer counting bytes learns nothing about the coin. */
    expect((call?.args[1] as Uint8Array).length).toBe(192);
    expect(test.opened[test.opened.length - 1]).toBe(peer);
  });
});

/* -------------------------------------------------------------------------- */
/* The same entry points, taken by a PASSKEY                                  */
/* -------------------------------------------------------------------------- */

/**
 * Every widened entry point, driven by a jubjub device and NO session at all.
 *
 * WHAT IS BEING HELD HERE. Until 2026/09/18 each of these read
 * `k1UserKey(session)` — the lower-cased Dynamic address — to decide whose
 * record to load and whose wallet to open. A passkey Passport has no such
 * address, so every one of them either filed a real account under `''` or
 * refused to find one that was there; the jubjub arm had no caller from the UI
 * and so the defect had nowhere to show itself. They read
 * `custodyUserKey(session, device)` now, which on this arm is the device point,
 * and `null` is the honest session rather than a stub with an empty address.
 */
describe('a passkey Passport, through the widened entry points', () => {
  /** The device, and the user key every store should be under. */
  function passkeyFake(): { session: null; device: JubjubSigner; user: string } {
    /* A fixed scalar rather than a derivation: the plumbing is what is under
       test, and `custodyJubjubSigner.test.ts` owns the derivation. */
    const device = jubjubDeviceSigner({
      pure: pureFake(),
      secretScalar: 0x2a1fn,
      randomBytes: (length) => new Uint8Array(length).fill(9),
    });
    return { session: null, device, user: custodyUserKey(null, device) };
  }

  it('names the Passport by its device point, not by an address it does not have', () => {
    const { device, user } = passkeyFake();
    expect(user).toBe(`jubjub:${device.pk.x.toString(16)}`);
  });

  it('refuses to name a social sign-in Passport with no sign-in behind it', () => {
    expect(() =>
      custodyUserKey(null, { arm: 'k256', pk: { x: 1n, y: 2n, identity: false } }),
    ).toThrow(/needs the sign-in it is held by/);
  });

  it('deploys, and files the record under the device point', async () => {
    const test = harness();
    const { session, device, user } = passkeyFake();
    await deployCustodyAccount(session, device, undefined, test.deps);

    expect(loadCustodyRecord(test.storage, user, 'stagenet')?.address).toBe(ADDRESS);
    /* Wave 1 carries the JUBJUB arm: the constructor's boot commitment binds
       the arm, and no later wave can repair a deploy that left the activation
       circuit out. */
    const deploy = test.built.find((entry) => entry[0] === 'deploy');
    expect(deploy?.[2]).toContain('activate_initial_device_with_jubjub');
    expect(deploy?.[2]).toContain('deposit_unshielded');
    /* And NOT the other arm's, which arrives with a later wave. */
    expect(deploy?.[2]).not.toContain('activate_initial_device_with_k256');
  });

  it('activates with the point and the salt, and no envelope', async () => {
    const test = harness();
    const { session, device } = passkeyFake();
    await deployCustodyAccount(session, device, undefined, test.deps);
    await activateK1Device(session, device, undefined, test.deps);

    const call = test.calls.find((c) => c.circuit === 'activate_initial_device_with_jubjub');
    /* TWO arguments. The k256 arm's third is an envelope, which is a property
       of a vendor wrapping bytes before signing them; there is no vendor here. */
    expect(call?.args).toHaveLength(2);
    expect(call?.args[0]).toEqual(device.pk);
  });

  it('signs a gated call with the derived scalar and no vendor round trip', async () => {
    const test = harness();
    const { session, device, user } = passkeyFake();
    await deployCustodyAccount(session, device, undefined, test.deps);
    await activateK1Device(session, device, undefined, test.deps);
    await appendInboxK1(session, device, new Uint8Array(192), undefined, test.deps);

    const call = test.calls.find((c) => c.circuit === 'append_inbox_with_jubjub');
    /* (entry, pk, use_counter, sig_r, sig_s, grind_nonce) — six, against the
       k256 arm's five, because a Schnorr signature carries its own nonce point
       and the grind counter the challenge was found at. */
    expect(call?.args).toHaveLength(6);
    expect(call?.args[0]).toEqual(new Uint8Array(192));
    expect(call?.args[1]).toEqual(device.pk);
    expect(call?.args[2]).toBe(0n);
    expect(loadCustodyRecord(test.storage, user, 'stagenet')?.txHashes.length).toBeGreaterThan(0);
  });

  it('makes a permissionless deposit into its own account, under its own record', async () => {
    const test = harness();
    const { session, device, user } = passkeyFake();
    await deployCustodyAccount(session, device, undefined, test.deps);
    await activateK1Device(session, device, undefined, test.deps);
    const before = loadCustodyRecord(test.storage, user, 'stagenet')?.txHashes.length ?? 0;

    await custodyPermissionlessCall(
      session,
      device,
      { operation: 'deposit_unshielded', args: [new Uint8Array(32), 5n] },
      undefined,
      test.deps,
    );

    /* No authorisation trailer: nobody signs a deposit, on either arm. */
    expect(test.calls.find((c) => c.circuit === 'deposit_unshielded')?.args).toHaveLength(2);
    expect(loadCustodyRecord(test.storage, user, 'stagenet')?.txHashes.length).toBe(before + 1);
  });

  it('pays another Passport, and writes only the hash into its own record', async () => {
    const test = harness();
    const { session, device, user } = passkeyFake();
    await deployCustodyAccount(session, device, undefined, test.deps);
    await activateK1Device(session, device, undefined, test.deps);
    const peer = 'cd'.repeat(32);

    await custodyPermissionlessCallAt(
      session,
      device,
      peer,
      { operation: 'deposit_shielded', args: [{}, new Uint8Array(192)] },
      undefined,
      test.deps,
    );

    expect(test.opened[test.opened.length - 1]).toBe(peer);
    /* The RECIPIENT's record is not ours and is not written; ours gains the
       hash, which is the only thing this Passport learned. */
    expect(loadCustodyRecord(test.storage, user, 'stagenet')?.txHashes.length).toBeGreaterThan(0);
    expect(test.connections.at(-1)?.account).toBeNull();
  });

  it('seals a deposit description with the sender’s own hands on this arm too', async () => {
    const test = harness();
    const { session, device } = passkeyFake();
    await deployCustodyAccount(session, device, undefined, test.deps);
    await activateK1Device(session, device, undefined, test.deps);

    await depositShieldedIntoCustody(
      session,
      device,
      {
        targetAddress: 'cd'.repeat(32),
        recipientEncKeyHex: 'ab'.repeat(32),
        coin: { colour: '1a'.repeat(32), nonce: '7f'.repeat(32), value: 40n },
      },
      undefined,
      test.deps,
    );

    const call = test.calls.find((c) => c.circuit === 'deposit_shielded');
    expect(call?.args).toHaveLength(2);
    expect((call?.args[1] as Uint8Array).length).toBe(192);
  });

  it('starts again by throwing away THIS device’s record and nobody else’s', async () => {
    const test = harness();
    const { session, device, user } = passkeyFake();
    await deployCustodyAccount(session, device, undefined, test.deps);
    /* A Dynamic Passport in the same browser, which must survive. */
    const other = deviceFake();
    await deployCustodyAccount(other.session, other.device, undefined, test.deps);

    await startCustodyAccountAgain(session, device, test.deps);

    expect(loadCustodyRecord(test.storage, user, 'stagenet')).toBeNull();
    expect(loadCustodyRecord(test.storage, k1UserKey(other.session), 'stagenet')).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Who may fix this account's circuits afterwards                             */
/* -------------------------------------------------------------------------- */

/**
 * The maintenance authority, and Hector's decision of 2026/09/18: keep it.
 *
 * The reason is the week's prototype accounts, which cannot take a circuit fix
 * — a retired authority makes an account immutable, so a defect means a fresh
 * account and a migration of everything in the old one. A passkey Passport can
 * afford to keep it because the key is DERIVED from the passkey and never
 * written down; a social sign-in cannot, because there is nothing deterministic
 * to derive from and a kept authority there would be backed by a sampled key
 * living in one browser — an authority nobody holds.
 */
describe('the maintenance authority', () => {
  function passkeyDevice(): JubjubSigner & { maintenanceSecretHex: string } {
    const signer = jubjubDeviceSigner({
      pure: pureFake(),
      secretScalar: 0x2a1fn,
      randomBytes: (length) => new Uint8Array(length).fill(9),
    });
    return { ...signer, sign: signer.sign.bind(signer), maintenanceSecretHex: 'dd'.repeat(32) };
  }

  it('is NOT retired for a passkey, so its circuits can be fixed later', async () => {
    const test = harness();
    const device = passkeyDevice();
    await deployCustodyAccount(null, device, undefined, test.deps);

    /* No wave retires it. The old plan's last wave replaced the committee with
       an empty one, which is what made the account immutable. */
    expect(test.built.filter((entry) => entry[0] === 'retire')).toHaveLength(0);
  });

  it('is the key the passkey derived, and not one this browser sampled', async () => {
    const test = harness();
    const device = passkeyDevice();
    await deployCustodyAccount(null, device, undefined, test.deps);

    /* The fake's `signingKeyFromBip340` tags what it was handed, so this is the
       derived secret arriving at the authority rather than a sampled one. A
       sampled key would be an authority that dies with this browser — the worst
       of both answers. */
    const committees = test.built.filter((entry) => entry[0] === 'authority');
    expect(committees).toHaveLength(1);
    /* ONE key in the committee, and not the empty committee a retirement
       installs. */
    expect(committees[0][1]).toBe(1);
  });

  it('IS retired for a social sign-in, exactly as it always was', async () => {
    const test = harness();
    const { session, device } = deviceFake();
    await deployCustodyAccount(session, device, undefined, test.deps);

    expect(test.built.filter((entry) => entry[0] === 'retire')).toHaveLength(1);
    /* And the only committee it ever builds is the EMPTY one the retirement
       installs — nothing derived is put behind it, because that arm has no key
       to derive. */
    const committees = test.built.filter((entry) => entry[0] === 'authority');
    expect(committees).toHaveLength(1);
    expect(committees[0][1]).toBe(0);
  });

  it('retires for a passkey that was asked for an account nobody can fix', async () => {
    /* The developer surface's case, and the guard that makes the two halves
       agree: a device with no key gets a plan that retires. */
    const test = harness();
    const signer = jubjubDeviceSigner({
      pure: pureFake(),
      secretScalar: 0x2a1fn,
      randomBytes: (length) => new Uint8Array(length).fill(9),
    });
    await deployCustodyAccount(null, signer, undefined, test.deps);

    expect(test.built.filter((entry) => entry[0] === 'retire')).toHaveLength(1);
  });
});
