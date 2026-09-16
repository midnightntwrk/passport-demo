/**
 * `POST /prove-k1`, drilled without a proof server, a ledger, or 3.2 GB of keys.
 *
 * Everything below the engine seam is real: the parsing, the circuit check
 * against the compiled build, the staged-artefact check against a temporary
 * directory, the one-at-a-time queue, the deadline, and the `/status` book.
 * What is stubbed is the one thing that cannot be had in a unit test — the
 * proof itself — and it is stubbed at the same seam the service injects, so
 * the wiring between the two is exercised too.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  MAX_UNPROVEN_TX_BYTES,
  PROVE_K1_ESTIMATE_MS,
  PROVE_K1_PATH,
  bytesFromHex,
  createK1Prover,
  createK1ProveEngine,
  hexFromBytes,
  k1ImpureCircuits,
  type K1ProofJob,
  type K1Prover,
  type K1ProverOptions,
} from '../src/proveK1.js';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** The circuit every drill below names, and one that is not on the build. */
const CIRCUIT = 'append_inbox_with_k256';
const NOT_A_CIRCUIT = 'append_inbox_with_ed25519';

/** Enough of the k1 build for the artefact check to pass, and not a byte more. */
function stageArtefacts(circuits: readonly string[] = [CIRCUIT]): string {
  const root = mkdtempSync(join(tmpdir(), 'prove-k1-'));
  mkdirSync(join(root, 'keys'), { recursive: true });
  mkdirSync(join(root, 'zkir'), { recursive: true });
  for (const circuit of circuits) {
    writeFileSync(join(root, 'keys', `${circuit}.prover`), 'not a prover key');
    writeFileSync(join(root, 'keys', `${circuit}.verifier`), 'not a verifier key');
    writeFileSync(join(root, 'zkir', `${circuit}.bzkir`), 'not a zkir');
  }
  return root;
}

/** A prover with every real rule and a stubbed proof. */
function proverWith(options: Partial<K1ProverOptions> = {}): K1Prover {
  return createK1Prover({
    network: 'stagenet',
    assetsPath: stageArtefacts(),
    proverUrl: 'http://127.0.0.1:6300',
    proverWhy: 'account-k1 is ZKIR v3 and proves at BALANCER_PROVER_URL_V3',
    /* The compiled build is read for real in its own suite below; here it is
       stated, so that a machine with no `contracts-stagenet` still drills the
       rules. */
    circuits: () => Promise.resolve([CIRCUIT, 'activate_initial_device_with_k256']),
    engine: () => Promise.resolve(new Uint8Array([0xbe, 0xef])),
    log: () => {},
    ...options,
  });
}

function request(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    circuit: CIRCUIT,
    unprovenTx: 'deadbeef',
    network: 'stagenet',
    ...overrides,
  });
}

/* -------------------------------------------------------------------------- */
/* What the wire says                                                         */
/* -------------------------------------------------------------------------- */

describe('the path the client composes', () => {
  it('is the one this route answers on', () => {
    assert.equal(PROVE_K1_PATH, '/prove-k1');
  });
});

describe('a proof that works', () => {
  it('answers the proven transaction as lower-case hex with no 0x', async () => {
    const outcome = await proverWith().prove(request());
    assert.equal(outcome.status, 200);
    assert.equal(outcome.body.provenTx, 'beef');
  });

  it('hands the engine the circuit, the decoded bytes, and this host’s two settings', async () => {
    const seen: K1ProofJob[] = [];
    const staged = stageArtefacts();
    const prover = proverWith({
      assetsPath: staged,
      engine: (job) => {
        seen.push(job);
        return Promise.resolve(new Uint8Array([1, 2, 3]));
      },
    });
    const outcome = await prover.prove(request({ unprovenTx: '00ff10' }));
    assert.equal(outcome.status, 200);
    assert.equal(outcome.body.provenTx, '010203');
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.circuit, CIRCUIT);
    assert.deepEqual([...(seen[0]?.unprovenTx ?? [])], [0x00, 0xff, 0x10]);
    assert.equal(seen[0]?.assetsPath, staged);
    assert.equal(seen[0]?.proverUrl, 'http://127.0.0.1:6300');
    rmSync(staged, { recursive: true, force: true });
  });

  it('remembers how long it took, and says so on /status', async () => {
    let clock = 1_000;
    const prover = proverWith({
      now: () => clock,
      engine: () => {
        clock += 9_400;
        return Promise.resolve(new Uint8Array([0x01]));
      },
    });
    assert.equal(prover.snapshot().lastProofMs, null);
    await prover.prove(request());
    const snapshot = prover.snapshot();
    assert.equal(snapshot.configured, true);
    assert.equal(snapshot.proofsServed, 1);
    assert.equal(snapshot.lastProofMs, 9_400);
    assert.equal(snapshot.queueDepth, 0);
    assert.equal(snapshot.lastError, null);
  });
});

/* -------------------------------------------------------------------------- */
/* Everything it will not look at                                             */
/* -------------------------------------------------------------------------- */

describe('a request this service refuses to read', () => {
  const refusals: Array<[string, string, number, string]> = [
    ['a body that is not JSON', 'not json at all', 400, 'invalid-request'],
    ['a body with no circuit', JSON.stringify({ unprovenTx: 'aa', network: 'stagenet' }), 400, 'invalid-request'],
    ['a circuit that is not a string', request({ circuit: 7 }), 400, 'invalid-request'],
    ['no network', JSON.stringify({ circuit: CIRCUIT, unprovenTx: 'aa' }), 400, 'invalid-request'],
    ['no transaction', JSON.stringify({ circuit: CIRCUIT, network: 'stagenet' }), 400, 'invalid-request'],
    ['a transaction that is not hex', request({ unprovenTx: 'zzzz' }), 400, 'invalid-request'],
    ['hex with an odd number of digits', request({ unprovenTx: 'abc' }), 400, 'invalid-request'],
    ['hex wearing an 0x prefix', request({ unprovenTx: '0xdeadbeef' }), 400, 'invalid-request'],
    ['another chain’s transaction', request({ network: 'undeployed' }), 400, 'unsupported-network'],
    ['a circuit the build does not have', request({ circuit: NOT_A_CIRCUIT }), 400, 'unknown-circuit'],
  ];

  for (const [what, body, status, code] of refusals) {
    it(`refuses ${what} with ${status} ${code}`, async () => {
      const outcome = await proverWith().prove(body);
      assert.equal(outcome.status, status);
      assert.equal(outcome.body.error, code);
      assert.equal(typeof outcome.body.detail, 'string');
      assert.ok((outcome.body.detail as string).length > 0);
    });
  }

  it('refuses a transaction past the ceiling by naming the ceiling', async () => {
    const tooBig = 'ab'.repeat(MAX_UNPROVEN_TX_BYTES + 1);
    const outcome = await proverWith().prove(request({ unprovenTx: tooBig }));
    assert.equal(outcome.status, 413);
    assert.equal(outcome.body.error, 'transaction-too-large');
    assert.match(String(outcome.body.detail), new RegExp(String(MAX_UNPROVEN_TX_BYTES)));
  });

  it('never reaches the engine for any of them', async () => {
    let proofs = 0;
    const prover = proverWith({
      engine: () => {
        proofs += 1;
        return Promise.resolve(new Uint8Array());
      },
    });
    for (const [, body] of refusals) await prover.prove(body);
    assert.equal(proofs, 0);
    /* A refusal is remembered for `/status`, with its code. */
    assert.equal(prover.snapshot().lastError?.code, 'unknown-circuit');
  });

  it('logs every refusal under the one prefix', async () => {
    const lines: string[] = [];
    const prover = proverWith({ log: (line) => lines.push(line) });
    await prover.prove('not json at all');
    await prover.prove(request({ circuit: NOT_A_CIRCUIT }));
    assert.equal(lines.length, 2);
    for (const line of lines) assert.ok(line.startsWith('[prove-k1] refused: '), line);
  });
});

/* -------------------------------------------------------------------------- */
/* A host that cannot prove                                                   */
/* -------------------------------------------------------------------------- */

describe('a host with no k1 proving on it', () => {
  it('answers 503 prover-unavailable when no v3 proof server is configured', async () => {
    const outcome = await proverWith({
      proverUrl: null,
      proverWhy: 'account-k1 is compiled --feature-zkir-v3, and neither route can prove it.',
    }).prove(request());
    assert.equal(outcome.status, 503);
    assert.equal(outcome.body.error, 'prover-unavailable');
    assert.match(String(outcome.body.detail), /zkir-v3/);
  });

  it('answers 503 prover-unavailable when the artefacts are not on the host', async () => {
    const outcome = await proverWith({ assetsPath: null }).prove(request());
    assert.equal(outcome.status, 503);
    assert.equal(outcome.body.error, 'prover-unavailable');
  });

  it('answers 503 for a circuit whose key material was never rsynced', async () => {
    const staged = stageArtefacts(['activate_initial_device_with_k256']);
    const outcome = await proverWith({ assetsPath: staged }).prove(request());
    assert.equal(outcome.status, 503);
    assert.equal(outcome.body.error, 'prover-unavailable');
    assert.match(String(outcome.body.detail), new RegExp(CIRCUIT));
    rmSync(staged, { recursive: true, force: true });
  });

  it('says so on /status without naming a path or a prover', async () => {
    const prover = proverWith({ assetsPath: null });
    await prover.prove(request());
    const snapshot = prover.snapshot();
    assert.equal(snapshot.configured, false);
    assert.equal(snapshot.lastError?.code, 'prover-unavailable');
  });

  it('keeps this host’s geography out of what /status publishes', async () => {
    const staged = stageArtefacts();
    const prover = proverWith({
      assetsPath: staged,
      proverUrl: 'http://127.0.0.1:6300',
      engine: () =>
        Promise.reject(
          new Error(`no key at ${staged}/keys and no server at http://127.0.0.1:6300`),
        ),
    });
    const outcome = await prover.prove(request());
    assert.equal(outcome.status, 502);
    assert.equal(outcome.body.error, 'proving-failed');
    const published = prover.snapshot().lastError?.detail ?? '';
    assert.ok(!published.includes(staged), published);
    assert.ok(!published.includes('127.0.0.1:6300'), published);
    assert.match(published, /<k1-assets>/);
    assert.match(published, /<k1-prover>/);
    rmSync(staged, { recursive: true, force: true });
  });
});

/* -------------------------------------------------------------------------- */
/* One at a time                                                              */
/* -------------------------------------------------------------------------- */

/** A proof that finishes when the drill says so. */
function heldProof(): { engine: () => Promise<Uint8Array>; release: () => void; started: () => number } {
  let starts = 0;
  const waiting: Array<() => void> = [];
  return {
    engine: async () => {
      starts += 1;
      await new Promise<void>((resolve) => waiting.push(resolve));
      return new Uint8Array([0x01]);
    },
    release: () => waiting.shift()?.(),
    started: () => starts,
  };
}

describe('proving one k1 circuit at a time', () => {
  it('runs one and queues the rest', async () => {
    const held = heldProof();
    const prover = proverWith({ engine: held.engine, maxWaiting: 4 });
    const first = prover.prove(request());
    const second = prover.prove(request());
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(held.started(), 1, 'the second proof must not have started');
    assert.equal(prover.snapshot().queueDepth, 2);
    assert.equal(prover.snapshot().queueWaiting, 1);
    held.release();
    assert.equal((await first).status, 200);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(held.started(), 2);
    held.release();
    assert.equal((await second).status, 200);
    assert.equal(prover.snapshot().queueDepth, 0);
  });

  it('refuses the caller past the waiting room with 429 PROVING_BUSY', async () => {
    const held = heldProof();
    const prover = proverWith({ engine: held.engine, maxWaiting: 2 });
    const running = [prover.prove(request()), prover.prove(request()), prover.prove(request())];
    await new Promise((resolve) => setImmediate(resolve));
    const refused = await prover.prove(request());
    assert.equal(refused.status, 429);
    assert.equal(refused.body.error, 'PROVING_BUSY');
    assert.equal(typeof refused.body.retryAfterMs, 'number');
    assert.ok((refused.body.retryAfterMs as number) > 0);
    assert.equal(refused.retryAfterMs, refused.body.retryAfterMs);
    /* Whoever is already in the room is still served. */
    for (let i = 0; i < 3; i += 1) {
      held.release();
      await new Promise((resolve) => setImmediate(resolve));
    }
    for (const outcome of await Promise.all(running)) assert.equal(outcome.status, 200);
  });

  it('guesses the constant until it has measured a proof, then quotes the measurement', async () => {
    const held = heldProof();
    const fresh = proverWith({ engine: held.engine, maxWaiting: 0 });
    const first = fresh.prove(request());
    await new Promise((resolve) => setImmediate(resolve));
    const guessed = await fresh.prove(request());
    assert.equal(guessed.status, 429);
    assert.equal(guessed.body.retryAfterMs, PROVE_K1_ESTIMATE_MS);
    held.release();
    await first;

    /* The same prover, once it has measured a forty-second proof: the next
       caller it turns away is told forty seconds, not the constant. */
    let clock = 0;
    const slow = heldProof();
    let firstProof = true;
    const measured = proverWith({
      now: () => clock,
      maxWaiting: 0,
      engine: () => {
        if (firstProof) {
          firstProof = false;
          clock += 40_000;
          return Promise.resolve(new Uint8Array([0x01]));
        }
        return slow.engine();
      },
    });
    await measured.prove(request());
    assert.equal(measured.snapshot().lastProofMs, 40_000);
    const second = measured.prove(request());
    await new Promise((resolve) => setImmediate(resolve));
    const quoted = await measured.prove(request());
    assert.equal(quoted.status, 429);
    assert.equal(quoted.body.retryAfterMs, 40_000);
    slow.release();
    await second;
  });
});

/* -------------------------------------------------------------------------- */
/* The deadline                                                               */
/* -------------------------------------------------------------------------- */

describe('a proof that does not finish', () => {
  it('answers 504 proving-timeout rather than holding the socket', async () => {
    const held = heldProof();
    const prover = proverWith({ engine: held.engine, timeoutMs: 20 });
    const outcome = await prover.prove(request());
    assert.equal(outcome.status, 504);
    assert.equal(outcome.body.error, 'proving-timeout');
    assert.match(String(outcome.body.detail), new RegExp(CIRCUIT));
    held.release();
  });

  it('keeps the slot until the abandoned proof actually ends', async () => {
    const held = heldProof();
    const prover = proverWith({
      engine: held.engine,
      timeoutMs: 20,
      /* Long, so the drill's own assertions cannot outrun the grace window and
         see a slot released for a reason it is not testing. */
      graceMs: 60_000,
      maxWaiting: 0,
    });
    assert.equal((await prover.prove(request())).status, 504);
    /* The proof is still on the box, so a second one is refused rather than
       started beside it. */
    const refused = await prover.prove(request());
    assert.equal(refused.status, 429);
    assert.equal(refused.body.error, 'PROVING_BUSY');
    assert.equal(held.started(), 1);
    held.release();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await prover.prove(request())).status, 504);
    held.release();
  });
});

/* -------------------------------------------------------------------------- */
/* The engine, with the proof server stubbed                                  */
/* -------------------------------------------------------------------------- */

describe('the engine that would talk to a proof server', () => {
  it('deserialises, builds the provider, and hands back the serialised proof', async () => {
    const calls: Record<string, unknown>[] = [];
    const engine = createK1ProveEngine({
      deserialiseUnproven: (bytes) => Promise.resolve({ unproven: [...bytes] }),
      zkConfigProviderFor: (directory) => {
        calls.push({ zkConfigProviderFor: directory });
        return Promise.resolve({ directory });
      },
      proofProviderFor: (options) => {
        calls.push({ proofProviderFor: options.url, timeout: options.timeout });
        return Promise.resolve({
          proveTx: (unprovenTx, config) => {
            calls.push({ proveTx: unprovenTx, timeout: config.timeout });
            return Promise.resolve({ serialize: () => new Uint8Array([0xaa, 0xbb]) });
          },
        });
      },
    });
    const out = await engine({
      circuit: CIRCUIT,
      unprovenTx: new Uint8Array([0x09]),
      assetsPath: '/opt/passport-k1-artefacts/managed/account-k1',
      proverUrl: 'http://127.0.0.1:6300',
      timeoutMs: 180_000,
    });
    assert.deepEqual([...out], [0xaa, 0xbb]);
    assert.deepEqual(calls[0], {
      zkConfigProviderFor: '/opt/passport-k1-artefacts/managed/account-k1',
    });
    assert.deepEqual(calls[1], { proofProviderFor: 'http://127.0.0.1:6300', timeout: 180_000 });
    assert.deepEqual(calls[2], { proveTx: { unproven: [0x09] }, timeout: 180_000 });
  });

  it('builds a ZK config provider PER PROOF and keeps none of them', async () => {
    /* The memory rule of this module, drilled structurally. A provider that
       outlived a request would hold every prover key it had served — 224 MB
       each — so what is asserted is that a second proof constructs a second
       provider and the engine holds no reference to either. A test cannot
       weigh the real thing without allocating the 3.2 GB it exists to keep out
       of the heap. */
    const built: unknown[] = [];
    const engine = createK1ProveEngine({
      deserialiseUnproven: () => Promise.resolve({}),
      zkConfigProviderFor: (directory) => {
        const provider = { directory, id: built.length };
        built.push(provider);
        return Promise.resolve(provider);
      },
      proofProviderFor: () =>
        Promise.resolve({
          proveTx: () => Promise.resolve({ serialize: () => new Uint8Array([0x00]) }),
        }),
    });
    const job: K1ProofJob = {
      circuit: CIRCUIT,
      unprovenTx: new Uint8Array([0x01]),
      assetsPath: '/opt/passport-k1-artefacts/managed/account-k1',
      proverUrl: 'http://127.0.0.1:6300',
      timeoutMs: 1_000,
    };
    await engine(job);
    await engine(job);
    assert.equal(built.length, 2);
    assert.notEqual(built[0], built[1]);
  });

  it('turns a proof server’s failure into 502 proving-failed', async () => {
    const prover = proverWith({
      engine: createK1ProveEngine({
        deserialiseUnproven: () => Promise.resolve({}),
        zkConfigProviderFor: () => Promise.resolve({}),
        proofProviderFor: () =>
          Promise.resolve({
            proveTx: () => Promise.reject(new Error('connect ECONNREFUSED')),
          }),
      }),
    });
    const outcome = await prover.prove(request());
    assert.equal(outcome.status, 502);
    assert.equal(outcome.body.error, 'proving-failed');
    assert.match(String(outcome.body.detail), /ECONNREFUSED/);
  });
});

/* -------------------------------------------------------------------------- */
/* The circuit list, off the build itself                                     */
/* -------------------------------------------------------------------------- */

describe('the circuits this route will prove', () => {
  it('are read off the compiled account-k1 build and not written down here', async () => {
    const circuits = await k1ImpureCircuits();
    assert.ok(circuits.includes(CIRCUIT), CIRCUIT);
    assert.ok(circuits.includes('activate_initial_device_with_k256'));
    assert.ok(circuits.includes('withdraw_shielded_with_k256'));
    assert.ok(!circuits.includes(NOT_A_CIRCUIT));
    /* Thirty today. Asserted as a floor rather than an equality: the build
       gains an entry point whenever a gated operation gains an arm, and a test
       that had to be edited for that would be a hand-kept list by another
       name. */
    assert.ok(circuits.length >= 30, `${circuits.length} circuits`);
  });
});

/* -------------------------------------------------------------------------- */
/* Hex                                                                        */
/* -------------------------------------------------------------------------- */

describe('the hex on the wire', () => {
  it('round-trips, lower case, with no 0x', () => {
    const bytes = new Uint8Array([0x00, 0x0f, 0xa0, 0xff]);
    assert.equal(hexFromBytes(bytes), '000fa0ff');
    assert.deepEqual([...bytesFromHex('000fa0ff')], [...bytes]);
  });
});
