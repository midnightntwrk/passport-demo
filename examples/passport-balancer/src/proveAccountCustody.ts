/**
 * `POST /prove-account-custody` — proving a custody account's circuits on the sponsor's box.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * Every other client in this demo proves in the browser, through
 * `httpClientProofProvider`, which UPLOADS THE PROVER KEY with each request.
 * That works because the prototype account build's keys are a few megabytes.
 * The account custody contract's are 112 MB for `append_inbox_with_k256`, 224
 * MB for the largest, and 3.2 GB for the set (measured 2026/09/16), so a
 * browser can neither hold one nor upload one, however healthy
 * the proof server behind `/prover-v3` is. The keys therefore have to sit on
 * the side that already has a disk — this service — and the wire has to carry
 * the TRANSACTION rather than the key.
 *
 * So the contract is: the client posts the serialised unproven transaction and
 * the name of the circuit it is calling, and gets back the same transaction
 * with proofs in it. The three marker strings are the whole of it —
 * `Transaction<SignatureEnabled, PreProof, PreBinding>` in, `Transaction<
 * SignatureEnabled, Proof, PreBinding>` out — because it is the client's own
 * wallet that binds and submits. This service never sees a key of the account's
 * and never spends a Speck: `/prove-account-custody` is the one route here that costs
 * nothing but CPU.
 *
 * WHAT IT COSTS, AND WHY EVERYTHING BELOW IS A LIMIT
 * --------------------------------------------------
 * A k256 proof is seconds to tens of seconds of a 2-CPU box that is also
 * proving every `.night` claim and every activation grant this service pays
 * for. Two of them at once is not twice as fast, it is two proofs that are
 * both slow and a sponsor that has stopped answering. So:
 *
 *   - ONE account custody proof runs at a time ({@link CustodyProofQueue}), with a short bounded
 *     queue behind it and `429 PROVING_BUSY` past that, quoting a wait built
 *     from the queue's depth and this service's own last proof. A caller told
 *     to come back in twenty seconds is better served than a caller enrolled in
 *     a wait nobody can honour — the lesson `SpendAdmission` already writes
 *     down. A caller that closes its connection LEAVES the queue rather than
 *     being woken later to prove for a browser that has gone.
 *   - A REQUEST has a deadline, not a proof: it starts when the request is
 *     queued and covers the wait and the proving together, so the answer comes
 *     inside {@link PROVE_ACCOUNT_CUSTODY_TIMEOUT_MS} however busy the box is. The client
 *     gets `504 proving-timeout` rather than a socket held open for ten
 *     minutes.
 *   - A REFUSAL SAYS ONE FIXED SENTENCE ({@link REFUSAL_DETAIL}). The cause —
 *     a prover's own words, a path, the reason this host has no artefacts —
 *     goes to the journal, because `/prove-account-custody` answers unauthenticated callers
 *     and a refusal is not the place to publish the box's filesystem.
 *   - The ZK CONFIG IS BUILT PER REQUEST and dropped when the proof ends.
 *     `NodeZkConfigProvider` reads the prover key off disk when it is asked
 *     and caches only the integrity manifest, so the hundred-odd megabytes is
 *     a buffer with one reference, alive for one proof — 459 ms to read, RSS
 *     266 MB, measured against the staged artefacts on 2026/09/16. Holding a
 *     provider across requests would hold every key it had ever served — 3.2 GB
 *     on a box with 8 GB, and the sponsor's own wallet in the same heap.
 *   - The route is METERED PER CLIENT like every other POST here, and
 *     deliberately does NOT take a `SpendAdmission` slot: those are the
 *     sponsor's spend budget, and a proof spends nothing.
 *
 * WHAT IT IS NOT
 * --------------
 * It is not a counted proof. `./proving.ts`'s counter means "a proof of OURS is
 * at the prover", and the stall watchdog turns itself off while it is non-zero.
 * A client's account custody proof is not ours; counting it would disable the watchdog for
 * somebody else's traffic and hide a wedged sponsorship job behind it. What
 * `/status` publishes instead is {@link CustodyProver.snapshot}, which is this
 * route's own queue and nothing else's.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/* TYPE-ONLY, and the whole point of that. The ledger is a 9.8 MB WASM bundle;
   the engine below imports it at the moment it needs it, so a process that
   never proves a account custody circuit never loads it, and a test that drills the rules
   above the engine never loads it either. */
import type * as ledger from '@midnightntwrk/ledger-v9';
import type { ZKConfigProvider } from '@midnight-ntwrk/midnight-js-types';

import { proverForModule } from './accountModule.js';
import { managedBuildPath } from './contractRuntime.js';

/** The path this route answers on. The client composes it in `accountCustodyPlan.ts`. */
export const PROVE_ACCOUNT_CUSTODY_PATH = '/prove-account-custody';

/** The log prefix every line from this route carries. */
export const PROVE_ACCOUNT_CUSTODY_PREFIX = 'prove-account-custody';

/**
 * The biggest unproven transaction this route will look at, DECODED.
 *
 * Two megabytes is about fifty times the largest custody call anybody has built —
 * the preimages of one circuit, a fee leg, and nothing else — so it refuses
 * only bodies that are not transactions at all. Note that the request never
 * gets this far in practice: a body is read through the service's own
 * `MAX_BODY_BYTES` (4 MiB), and hex is two characters a byte, so a 2 MiB
 * transaction is already a 4 MiB body. Both refusals are JSON with a code; this
 * one is the one that names the transaction rather than the request.
 */
export const MAX_UNPROVEN_TX_BYTES = 2 * 1024 * 1024;

/**
 * How long ONE REQUEST may take, queue included, before the caller is told it
 * did not.
 *
 * Measured from the moment the request joins the queue, not from the moment it
 * reaches the prover: the two are the same for the first caller and three
 * minutes apart for the fifth, and it is the caller's socket that pays either
 * way. A proof that starts with ninety seconds of the budget left is given
 * ninety seconds, and the queue's share is named in the refusal so the journal
 * says which of the two ran out.
 */
export const PROVE_ACCOUNT_CUSTODY_TIMEOUT_MS = 180_000;

/**
 * How many callers may wait for the running proof before the rest are refused.
 *
 * Four, and four LIVE ones: a waiter whose request closes is evicted
 * ({@link CustodyProofQueue.acquire}), so this bounds the people actually waiting rather
 * than the requests that have ever arrived.
 */
export const PROVE_ACCOUNT_CUSTODY_MAX_WAITING = 4;

/**
 * What a `429` tells a caller to wait when nothing has been proved yet.
 *
 * Replaced by the measured time of the last proof as soon as there is one — a
 * `retryAfterMs` built from this service's own experience is worth more than a
 * constant, and the first caller of the day is the only one who gets a guess.
 */
export const PROVE_ACCOUNT_CUSTODY_ESTIMATE_MS = 20_000;

/* -------------------------------------------------------------------------- */
/* The wire                                                                   */
/* -------------------------------------------------------------------------- */

/** The 200 body, and the 4xx/5xx body. Mirrors `accountCustodyPlan.ts`. */
export interface ProveAccountCustodyOutcome {
  readonly status: number;
  readonly body: Record<string, unknown>;
  /** Milliseconds, when the answer is one the caller should wait out. */
  readonly retryAfterMs?: number;
}

function ok(provenTx: string): ProveAccountCustodyOutcome {
  return { status: 200, body: { provenTx } };
}

/**
 * A refusal, in the shape the client parses.
 *
 * `error` and `detail`, and no other field except `retryAfterMs` — the client's
 * `describeProveAccountCustodyFailure` reads exactly those two and prints them, so a
 * refusal that says nothing in `detail` is a refusal nobody can act on.
 */
function refuse(
  status: number,
  error: string,
  detail: string,
  retryAfterMs?: number,
): ProveAccountCustodyOutcome {
  return {
    status,
    body: { error, detail, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) },
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}

/**
 * WHAT A REFUSED CALLER IS TOLD — one fixed sentence per code, and nothing else.
 *
 * The reason this is a table rather than a string built at the point of the
 * refusal is that the interesting refusals are the ones whose cause is a
 * sentence somebody else wrote: a proof server quoting the key it could not
 * open, `NodeZkConfigProvider` quoting `<assets>/keys/<circuit>.prover`, the
 * start-up explanation of why this host has no prover, which names an
 * environment variable and a URL. Interpolating any of those into the body
 * publishes this box's filesystem and its internal endpoints to anybody who can
 * post a malformed transaction — and `/prove-account-custody` is a route an unauthenticated
 * browser calls.
 *
 * The caller loses nothing it can act on. It knows the circuit and the network
 * it asked for, and `code` is what its `describeProveAccountCustodyFailure` switches on;
 * the sentence is there to be read by a human, not parsed. The cause — all of
 * it, unredacted — goes to the journal, where the operator who can act on it
 * already is. `/status` carries the same cause with this host's geography taken
 * out, because that page is on the internet and the journal is not.
 *
 * Every code this route can answer with is here. A code added without a
 * sentence would fall through to the last line, which says nothing useful, so
 * add both together.
 */
const REFUSAL_DETAIL: Readonly<Record<string, string>> = {
  'invalid-request':
    'The request body must be JSON of the form {"circuit": "…", "unprovenTx": "<hex>", "network": "…"}, with the transaction as an even number of hex digits and no 0x prefix.',
  'unsupported-network': 'This service cannot prove a transaction for that network.',
  'transaction-too-large': `An unproven transaction may be at most ${MAX_UNPROVEN_TX_BYTES} bytes.`,
  'unknown-circuit': 'That is not a circuit of the account-custody build.',
  'prover-unavailable':
    'This service cannot prove account-custody circuits at the moment. It is the sponsor that needs attention, not the request.',
  PROVING_BUSY:
    'This service proves one account custody circuit at a time and its waiting room is full. Try again shortly.',
  'proving-timeout': 'The proof did not finish inside this service’s deadline.',
  'proving-failed': 'The proof server could not prove this transaction.',
  'client-gone': 'The request was abandoned before its proof started.',
};

/** The sentence for a code, and a serviceable one for a code nobody wrote. */
function clientDetail(code: string): string {
  return REFUSAL_DETAIL[code] ?? 'This service refused the request.';
}

/* -------------------------------------------------------------------------- */
/* One at a time, and not many waiting                                        */
/* -------------------------------------------------------------------------- */

/** Thrown by {@link CustodyProofQueue.acquire} when the queue is full. */
export class ProvingBusy extends Error {
  constructor(
    readonly waiting: number,
    /** Waiting plus the one proving — what the wait actually costs. */
    readonly depth: number,
  ) {
    super(`${waiting} callers are already waiting for a account custody proof.`);
    this.name = 'ProvingBusy';
  }
}

/**
 * Thrown by {@link CustodyProofQueue.acquire} when the caller went away while queued.
 *
 * Not an error of this service's: a browser that navigated, reloaded, or was
 * closed halfway through onboarding is the ordinary case. What matters is that
 * it stops occupying a place in a four-deep room and stops the proof it asked
 * for from ever starting — a proof nobody is waiting for is a minute of the
 * sponsor's CPU spent on a socket that is already shut.
 */
export class ProvingAbandoned extends Error {
  constructor() {
    super('The caller closed the connection while waiting for a account custody proof.');
    this.name = 'ProvingAbandoned';
  }
}

/**
 * A one-slot FIFO with a bounded waiting room.
 *
 * FIFO, not a free-for-all: the callers here are a browser walking a Passport
 * through four ordered steps, and a queue that served the newest first would
 * strand the oldest for the length of the demo.
 */
export class CustodyProofQueue {
  private running = false;
  private readonly waiters: Array<{ readonly wake: () => void }> = [];

  constructor(private readonly maxWaiting: number) {}

  /** Callers waiting for the slot, not counting the one holding it. */
  get waiting(): number {
    return this.waiters.length;
  }

  /** Waiting plus running — what `/status` publishes as the queue's depth. */
  get depth(): number {
    return this.waiters.length + (this.running ? 1 : 0);
  }

  /**
   * Claims the slot, or throws.
   *
   * {@link ProvingBusy} when the waiting room is full, {@link ProvingAbandoned}
   * when `signal` fires before the slot comes free. Every claim that RETURNS
   * needs a release; neither throw holds anything.
   *
   * The signal is the difference between a queue that bounds waiting and a
   * queue that bounds arrivals. Four places, each held by a browser that may
   * already be gone, is a room that fills up once and stays full: the abandoned
   * callers are woken in turn, prove for a minute each, and every live caller
   * behind them is told `PROVING_BUSY` for four minutes. A waiter that leaves
   * when its request does keeps the room's depth equal to the number of people
   * actually in it.
   */
  async acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted === true) throw new ProvingAbandoned();
    if (!this.running) {
      this.running = true;
      return;
    }
    if (this.waiters.length >= this.maxWaiting)
      throw new ProvingBusy(this.waiters.length, this.depth);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const waiter = {
        wake: () => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          resolve();
        },
      };
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        const at = this.waiters.indexOf(waiter);
        if (at >= 0) this.waiters.splice(at, 1);
        signal?.removeEventListener('abort', onAbort);
        reject(new ProvingAbandoned());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  /** Hands the slot to the next waiter, or puts it back. */
  release(): void {
    const next = this.waiters.shift();
    if (next) next.wake();
    else this.running = false;
  }
}

/* -------------------------------------------------------------------------- */
/* The part with the keys and the socket on it                                */
/* -------------------------------------------------------------------------- */

/** One proof, as the engine takes it. */
export interface CustodyProofJob {
  readonly circuit: string;
  readonly unprovenTx: Uint8Array;
  /** The directory holding `keys/` and `zkir/` for the `account-custody` build. */
  readonly assetsPath: string;
  /** The ZKIR v3 proof server. `BALANCER_PROVER_URL_V3`. */
  readonly proverUrl: string;
  readonly timeoutMs: number;
}

/**
 * Everything that touches the ledger WASM, the disk, and a socket.
 *
 * Injected as one unit so that every rule above it — validation, the queue, the
 * deadline, the bookkeeping — is drillable without a 9.8 MB WASM bundle, 3.2 GB
 * of keys, or a proof server. That is the same seam `accountCustody.ts` puts
 * on the client's side of this wire, for the same reason.
 */
export type CustodyProveEngine = (job: CustodyProofJob) => Promise<Uint8Array>;

/**
 * A proof provider as this module uses it: one method, one argument.
 *
 * Narrower than midnight-js's `ProofProvider` on purpose — the real one is
 * generic over a circuit-id union and typed against the ledger's transaction
 * classes, and stating the whole of that here would make the seam impossible to
 * stand a stub in front of. The two lines below are what is actually called.
 */
export interface CustodyProofProviderLike {
  proveTx(
    unprovenTx: unknown,
    config: { readonly timeout: number },
  ): Promise<{ serialize(): Uint8Array }>;
}

/** The three pieces of the real engine, each replaceable in a drill. */
export interface CustodyEngineDeps {
  /** `NodeZkConfigProvider` over the artefacts directory. ONE PER PROOF. */
  zkConfigProviderFor(directory: string): Promise<unknown>;
  /** `httpClientProofProvider` at the v3 server. */
  proofProviderFor(options: {
    readonly url: string;
    readonly zkConfigProvider: unknown;
    readonly timeout: number;
  }): Promise<CustodyProofProviderLike>;
  /** `Transaction.deserialize('signature', 'pre-proof', 'pre-binding', …)`. */
  deserialiseUnproven(bytes: Uint8Array): Promise<unknown>;
}

const REAL_ENGINE_DEPS: CustodyEngineDeps = {
  async zkConfigProviderFor(directory) {
    const { NodeZkConfigProvider } = await import(
      '@midnight-ntwrk/midnight-js-node-zk-config-provider'
    );
    return new NodeZkConfigProvider(directory);
  },
  async proofProviderFor(options) {
    const { httpClientProofProvider } = await import(
      '@midnight-ntwrk/midnight-js-http-client-proof-provider'
    );
    return httpClientProofProvider({
      url: options.url,
      zkConfigProvider: options.zkConfigProvider as ZKConfigProvider<string>,
      timeout: options.timeout,
    });
  },
  async deserialiseUnproven(bytes) {
    const { Transaction } = await import('@midnightntwrk/ledger-v9');
    return Transaction.deserialize<ledger.SignatureEnabled, ledger.PreProof, ledger.PreBinding>(
      'signature',
      'pre-proof',
      'pre-binding',
      bytes,
    );
  },
};

/**
 * The real engine: midnight-js's proof provider, over the v3 proof server.
 *
 * Read it as three lines. `NodeZkConfigProvider` turns the assets directory
 * into the prover key, verifier key, and ZKIR for whatever circuit the
 * transaction names — `<dir>/keys/<circuit>.prover`, `.verifier`, and
 * `<dir>/zkir/<circuit>.bzkir` — and checks each against `compactc`'s
 * integrity manifest, which is the only thing standing between a half-finished
 * rsync and a proof that fails inside the prover with nothing to say.
 * `httpClientProofProvider` walks the transaction's calls, asks the provider
 * for each one's key material, and posts it with the preimage to the proof
 * server's `/check` and `/prove`. The ledger turns the bytes into a transaction
 * at one end and back at the other.
 *
 * BOTH OBJECTS ARE LOCAL TO THE CALL, and that is the memory rule of this whole
 * module rather than a style preference. A provider kept between requests keeps
 * every prover key it has ever served: 112 to 224 MB for one circuit and 3.2 GB
 * for the set, on a box with 8 GB that is also holding the sponsor's wallet. Built
 * here, they are unreachable the moment the promise settles. The drill for it
 * is structural — `test/proveAccountCustody.test.ts` counts the constructions rather than
 * the megabytes, because a test that allocated the real key material would need
 * the 3.2 GB it exists to keep out of the heap.
 */
export function createCustodyProveEngine(deps: Partial<CustodyEngineDeps> = {}): CustodyProveEngine {
  const { zkConfigProviderFor, proofProviderFor, deserialiseUnproven } = {
    ...REAL_ENGINE_DEPS,
    ...deps,
  };
  return async (job) => {
    const unproven = await deserialiseUnproven(job.unprovenTx);
    const zkConfigProvider = await zkConfigProviderFor(job.assetsPath);
    const proofProvider = await proofProviderFor({
      url: job.proverUrl,
      zkConfigProvider,
      timeout: job.timeoutMs,
    });
    const proven = await proofProvider.proveTx(unproven, { timeout: job.timeoutMs });
    return proven.serialize();
  };
}

/** The engine the service runs with. */
export const httpCustodyProveEngine: CustodyProveEngine = createCustodyProveEngine();

/* -------------------------------------------------------------------------- */
/* Reading the circuit names off the build                                    */
/* -------------------------------------------------------------------------- */

/**
 * The impure circuits of the `account-custody` build, from the build itself.
 *
 * NOT A LIST IN THIS FILE. The account custody contract has thirty entry points
 * today, gains one whenever a gated operation gains an arm, and a hand-kept
 * copy here would refuse a circuit the droplet's own artefacts can prove the
 * first time the two disagreed. `contract/index.js` travels in git — it is the
 * `keys/` beside it that does not — so this answer is available on every host,
 * configured or not, which is what makes `unknown-circuit` a deterministic
 * 4xx rather than something that depends on what was rsynced.
 *
 * A LITERAL specifier, for the reason `./account.ts` sets out at its own
 * import: `contracts-stagenet` carries its own `node_modules`, and a computed
 * absolute path into that tree resolves a second `@midnight-ntwrk/compact-
 * runtime`.
 */
export async function custodyImpureCircuits(): Promise<readonly string[]> {
  const module = (await import('../contracts-stagenet/managed/account-custody/contract/index.js')) as {
    Contract: new (witnesses: unknown) => { impureCircuits: Record<string, unknown> };
  };
  /* The one witness the build demands of a constructor. It is never called:
     nothing here executes a circuit, it only asks what the circuits are. */
  const contract = new module.Contract({
    held_coin: () => {
      throw new Error('held_coin is never answered by the proving route.');
    },
  });
  return Object.keys(contract.impureCircuits);
}

/* -------------------------------------------------------------------------- */
/* The route                                                                  */
/* -------------------------------------------------------------------------- */

/** What `/status` publishes under `accountCustodyProving`. No paths, no URLs, no keys. */
export interface CustodyProvingSnapshot {
  /** True when both the assets and a v3 proof server are configured. */
  readonly configured: boolean;
  /** Running plus waiting. */
  readonly queueDepth: number;
  /** Waiting alone, against {@link CustodyProverOptions.maxWaiting}. */
  readonly queueWaiting: number;
  readonly queueMax: number;
  /** Proofs answered 200 since this process started. */
  readonly proofsServed: number;
  /** How long the last successful proof took, in milliseconds. */
  readonly lastProofMs: number | null;
  readonly lastProofAt: string | null;
  /** The last refusal's code and its detail, redacted. `null` until there is one. */
  readonly lastError: { readonly code: string; readonly detail: string; readonly at: string } | null;
}

export interface CustodyProverOptions {
  /** `config.networkId`. A transaction for another chain is refused, not proved. */
  readonly network: string;
  /** Where `keys/` and `zkir/` are. `null` when this host has no account custody build. */
  readonly assetsPath: string | null;
  /** The v3 proof server. `null` when `BALANCER_PROVER_URL_V3` is unset. */
  readonly proverUrl: string | null;
  /** Why there is no prover, for the refusal to quote. */
  readonly proverWhy: string;
  /** Defaults to {@link custodyImpureCircuits}, read once and remembered. */
  readonly circuits?: () => Promise<readonly string[]>;
  readonly engine?: CustodyProveEngine;
  readonly timeoutMs?: number;
  /**
   * How long a timed-out proof may go on holding its slot before this service
   * stops believing it will ever end. Defaults to {@link CustodyProverOptions.timeoutMs}.
   */
  readonly graceMs?: number;
  readonly maxWaiting?: number;
  readonly now?: () => number;
  /**
   * Every line this route writes. One sink for both levels so a drill can
   * silence the whole route with `() => {}`; the default sends refusals to
   * `console.warn` and everything else to `console.log`, which is what the rest
   * of this service does.
   */
  readonly log?: (line: string, level: 'info' | 'warn') => void;
}

export interface CustodyProver {
  /**
   * Answers one request. `body` is the raw request body.
   *
   * `signal` is the caller's connection: fire it when the socket closes and a
   * request still in the queue leaves it instead of being woken to prove for a
   * browser that is no longer there. Omitted, the request behaves as it always
   * did, which is what every drill that does not care about disconnection wants.
   */
  prove(body: Buffer | string, signal?: AbortSignal): Promise<ProveAccountCustodyOutcome>;
  snapshot(): CustodyProvingSnapshot;
}

/**
 * Builds the route from the service's configuration.
 *
 * Resolves the two things that can be missing ONCE, at start-up, and remembers
 * which: a host with no account custody artefacts and a host with no v3 proof server are
 * both `503 prover-unavailable`, and neither is a reason for this service not
 * to start — see `./account.ts`, which takes the same view of the same two
 * absences for the same build.
 */
export function custodyProverFromConfig(
  config: {
    readonly networkId: string;
    readonly accountCustodyAssetsPath?: string;
    readonly provingServerUrl?: string;
    readonly provingServerUrlV3?: string;
  },
  options: Partial<CustodyProverOptions> = {},
): CustodyProver {
  let assetsPath: string | null = null;
  try {
    assetsPath = managedBuildPath('account-custody', {
      configured: config.accountCustodyAssetsPath,
      remedy: 'Set BALANCER_ACCOUNT_CUSTODY_ASSETS to the rsynced artefacts directory.',
    });
  } catch {
    /* Absent is the normal case on a host that has not been given the 3.2 GB.
       The refusal is per request, and says so. */
  }
  const prover = proverForModule('account-custody', config);
  return createCustodyProver({
    network: config.networkId,
    assetsPath,
    proverUrl: prover.kind === 'server' ? prover.url : null,
    proverWhy: prover.why,
    ...options,
  });
}

export function createCustodyProver(options: CustodyProverOptions): CustodyProver {
  const now = options.now ?? Date.now;
  const log =
    options.log ??
    ((line: string, level: 'info' | 'warn') => {
      if (level === 'warn') console.warn(line);
      else console.log(line);
    });
  const timeoutMs = options.timeoutMs ?? PROVE_ACCOUNT_CUSTODY_TIMEOUT_MS;
  const graceMs = options.graceMs ?? timeoutMs;
  const maxWaiting = options.maxWaiting ?? PROVE_ACCOUNT_CUSTODY_MAX_WAITING;
  const engine = options.engine ?? httpCustodyProveEngine;
  const readCircuits = options.circuits ?? custodyImpureCircuits;
  const queue = new CustodyProofQueue(maxWaiting);

  let circuits: Promise<readonly string[]> | null = null;
  let proofsServed = 0;
  let lastProofMs: number | null = null;
  let lastProofAt: string | null = null;
  let lastError: CustodyProvingSnapshot['lastError'] = null;

  /**
   * Whatever a failure said, with this host's own geography taken out of it.
   *
   * `/status` is on the internet and a proof server's errors quote file paths.
   * An operator has the journal, which carries the whole thing; a reader of
   * `/status` gets the code and a sentence.
   */
  const redact = (text: string): string => {
    let out = text;
    if (options.assetsPath) out = out.split(options.assetsPath).join('<custody-assets>');
    if (options.proverUrl) out = out.split(options.proverUrl).join('<custody-prover>');
    return out.length > 300 ? `${out.slice(0, 300)}…` : out;
  };

  /**
   * Every refusal, in one place: it goes to the journal, to `/status`, and back
   * to the caller. One function so that none of the three can be forgotten —
   * a refusal nobody logged is a refusal nobody can explain afterwards.
   */
  const refused = (
    status: number,
    code: string,
    /** The whole cause, for the journal. NEVER what the caller is handed. */
    because: string,
    retryAfterMs?: number,
  ): ProveAccountCustodyOutcome => {
    lastError = { code, detail: redact(because), at: new Date(now()).toISOString() };
    log(`[${PROVE_ACCOUNT_CUSTODY_PREFIX}] refused: ${code} — ${because}`, 'warn');
    return refuse(status, code, clientDetail(code), retryAfterMs);
  };

  /** What to tell a refused caller to wait: this service's own measured pace. */
  const estimateMs = (): number => {
    const measured = lastProofMs ?? PROVE_ACCOUNT_CUSTODY_ESTIMATE_MS;
    return Math.min(60_000, Math.max(5_000, measured));
  };

  const prove = async (
    rawBody: Buffer | string,
    signal?: AbortSignal,
  ): Promise<ProveAccountCustodyOutcome> => {
    /* PARSED AND CHECKED BEFORE THE QUEUE IS TOUCHED. A malformed body is the
       caller's mistake and must not cost anybody else a slot — the rule
       `/balance-only` already follows, for the same reason. */
    let parsed: { circuit?: unknown; unprovenTx?: unknown; network?: unknown };
    try {
      parsed = JSON.parse(
        (typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')) || '{}',
      ) as typeof parsed;
    } catch {
      return refused(
        400,
        'invalid-request',
        'The request body must be JSON of the form {"circuit": "…", "unprovenTx": "<hex>", "network": "…"}.',
      );
    }
    if (parsed === null || typeof parsed !== 'object') {
      return refused(400, 'invalid-request', 'The request body must be a JSON object.');
    }

    const circuit = typeof parsed.circuit === 'string' ? parsed.circuit.trim() : '';
    if (circuit.length === 0) {
      return refused(400, 'invalid-request', 'The request must name the circuit to prove.');
    }

    const network = typeof parsed.network === 'string' ? parsed.network.trim() : '';
    if (network.length === 0) {
      return refused(400, 'invalid-request', 'The request must name the network it is for.');
    }
    if (network !== options.network) {
      return refused(
        400,
        'unsupported-network',
        `This service is on ${options.network} and cannot prove a transaction for ${network}.`,
      );
    }

    const hex = typeof parsed.unprovenTx === 'string' ? parsed.unprovenTx.trim() : '';
    if (hex.length === 0) {
      return refused(
        400,
        'invalid-request',
        'The request must carry the unproven transaction as hex.',
      );
    }
    if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
      return refused(
        400,
        'invalid-request',
        'unprovenTx must be an even number of hex digits, with no 0x prefix and nothing else in it.',
      );
    }
    if (hex.length / 2 > MAX_UNPROVEN_TX_BYTES) {
      return refused(
        413,
        'transaction-too-large',
        `An unproven transaction may be at most ${MAX_UNPROVEN_TX_BYTES} bytes; this one is ${hex.length / 2}.`,
      );
    }

    /* The circuit set comes from the compiled build, read once. A name that is
       not in it is a caller's error however well the artefacts are staged. */
    circuits ??= readCircuits();
    let known: readonly string[];
    try {
      known = await circuits;
    } catch (cause) {
      circuits = null;
      return refused(
        503,
        'prover-unavailable',
        `The compiled account-custody build could not be read on this host: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    if (!known.includes(circuit)) {
      return refused(
        400,
        'unknown-circuit',
        `${circuit} is not a circuit of the account-custody build. It has ${known.length}, among them ${known.slice(0, 3).join(', ')}.`,
      );
    }

    /* The two absences that are this HOST's rather than the caller's. Both are
       503 under one code, because the client's refusal is one sentence and
       which of the two it is is the operator's business, not the caller's. */
    if (!options.assetsPath) {
      return refused(
        503,
        'prover-unavailable',
        `The account-custody artefacts are not on this host. ${options.proverWhy}`,
      );
    }
    if (!options.proverUrl) {
      return refused(503, 'prover-unavailable', options.proverWhy);
    }
    /* The named circuit, staged or not. Checked HERE rather than inside the
       engine so that a half-finished rsync answers in a millisecond with the
       circuit's name in it, instead of several seconds later in a prover's own
       words. */
    const missing = [
      join(options.assetsPath, 'keys', `${circuit}.prover`),
      join(options.assetsPath, 'keys', `${circuit}.verifier`),
      join(options.assetsPath, 'zkir', `${circuit}.bzkir`),
    ].filter((file) => !existsSync(file));
    if (missing.length > 0) {
      return refused(
        503,
        'prover-unavailable',
        `The key material for ${circuit} is not staged on this host (${missing.length} of 3 files missing). Re-run the artefacts rsync.`,
      );
    }

    /* THE DEADLINE STARTS HERE, not when the slot comes free. What the caller
       is promised is an answer inside `timeoutMs` — a socket held open for the
       queue and then again for the proof is two deadlines, and four of those in
       a row is twelve minutes of a browser waiting on a route documented as
       answering in three. Queueing and proving spend the same budget. */
    const enqueuedAt = now();
    const deadlineAt = enqueuedAt + timeoutMs;

    try {
      await queue.acquire(signal);
    } catch (cause) {
      if (cause instanceof ProvingBusy) {
        /* An HONEST wait: everybody ahead of this caller has to prove before it
           does, at the pace this service last managed. `depth` counts the one
           proving as well as the ones waiting, which is why it is the queue's
           number rather than `waiting + 1` — a full room whose proof has just
           finished is one shorter than a full room whose proof has just
           started, and the caller should be told the difference. */
        return refused(
          429,
          'PROVING_BUSY',
          `This service proves one account custody circuit at a time and ${cause.waiting} callers are already waiting (queue depth ${cause.depth}).`,
          Math.max(1, cause.depth) * estimateMs(),
        );
      }
      if (cause instanceof ProvingAbandoned) {
        /* Nobody is listening. Answered rather than thrown so the route's
           bookkeeping stays in one place; the write goes to a closed socket and
           Node drops it. */
        log(`[${PROVE_ACCOUNT_CUSTODY_PREFIX}] a caller waiting for ${circuit} closed its connection`, 'info');
        return refuse(499, 'client-gone', clientDetail('client-gone'));
      }
      throw cause;
    }

    const startedAt = now();
    /* What is LEFT of the deadline after the queue took its share. Zero or less
       means the caller has already been waiting the whole of it, and starting a
       proof now would only tie up the box on a socket about to be answered
       504 anyway. */
    const remainingMs = deadlineAt - startedAt;
    if (remainingMs <= 0) {
      queue.release();
      return refused(
        504,
        'proving-timeout',
        `A caller waited ${startedAt - enqueuedAt} ms in the queue for ${circuit}, which is the whole of the ${timeoutMs} ms deadline; its proof was never started.`,
        estimateMs(),
      );
    }

    const job: CustodyProofJob = {
      circuit,
      unprovenTx: bytesFromHex(hex),
      assetsPath: options.assetsPath,
      proverUrl: options.proverUrl,
      timeoutMs: remainingMs,
    };
    log(`[${PROVE_ACCOUNT_CUSTODY_PREFIX}] proving ${circuit} (${hex.length / 2} bytes in)`, 'info');

    let timer: ReturnType<typeof setTimeout> | undefined;
    let grace: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const running = engine(job);
    /* The slot is released when the PROOF ends, not when the caller is
       answered. A timed-out proof is still on the box using a CPU, and letting
       a second one start beside it would be exactly the pile-up the queue
       exists to prevent. The grace timer is the bound on that promise: the
       proof provider retries internally and can outlive its own timeout, and a
       slot held by something that never settles would answer every later
       caller `PROVING_BUSY` for the life of the process. */
    const releaseWhenDone = (): void => {
      if (settled) return;
      settled = true;
      if (grace !== undefined) clearTimeout(grace);
      queue.release();
    };
    running.then(releaseWhenDone, releaseWhenDone);

    try {
      const provenTx = await new Promise<Uint8Array>((resolve, reject) => {
        timer = setTimeout(() => {
          grace = setTimeout(() => {
            log(
              `[${PROVE_ACCOUNT_CUSTODY_PREFIX}] the proof of ${circuit} never settled; releasing its slot after the grace window`,
              'warn',
            );
            releaseWhenDone();
          }, graceMs);
          if (typeof grace.unref === 'function') grace.unref();
          reject(new ProvingTimeout(remainingMs));
        }, remainingMs);
        if (typeof timer.unref === 'function') timer.unref();
        running.then(resolve, reject);
      });
      const tookMs = now() - startedAt;
      proofsServed += 1;
      lastProofMs = tookMs;
      lastProofAt = new Date(now()).toISOString();
      log(
        `[${PROVE_ACCOUNT_CUSTODY_PREFIX}] proved ${circuit} in ${Math.round(tookMs / 100) / 10} s (${provenTx.length} bytes out)`,
        'info',
      );
      return ok(hexFromBytes(provenTx));
    } catch (cause) {
      if (cause instanceof ProvingTimeout) {
        return refused(
          504,
          'proving-timeout',
          `The proof of ${circuit} did not finish inside the ${Math.round(timeoutMs / 1_000)} seconds the caller was promised (${Math.round((startedAt - enqueuedAt) / 1_000)} of them spent queueing).`,
          estimateMs(),
        );
      }
      return refused(
        502,
        'proving-failed',
        `The proof server could not prove ${circuit}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  return {
    prove,
    snapshot: (): CustodyProvingSnapshot => ({
      configured: Boolean(options.assetsPath && options.proverUrl),
      queueDepth: queue.depth,
      queueWaiting: queue.waiting,
      queueMax: maxWaiting,
      proofsServed,
      lastProofMs,
      lastProofAt,
      lastError,
    }),
  };
}

/** The deadline fired. Separate from the engine's own failures on purpose. */
class ProvingTimeout extends Error {
  constructor(readonly afterMs: number) {
    super(`No proof after ${afterMs} ms.`);
    this.name = 'ProvingTimeout';
  }
}

/* -------------------------------------------------------------------------- */
/* Hex                                                                        */
/* -------------------------------------------------------------------------- */

/** Validated already by the caller; this only decodes. */
export function bytesFromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Lower case, no `0x` — what `accountCustodyPlan.ts`'s `hexToBytes` reads. */
export function hexFromBytes(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}
