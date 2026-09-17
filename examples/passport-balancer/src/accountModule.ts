/**
 * Which compiled account module a deployed account must be spoken to with.
 *
 * The account-custody contract gained `transfer_shielded_to_account` on
 * 2026/09/10. A deployed Compact contract cannot gain a circuit afterwards, so
 * every Passport set up before that date carries eleven entry points and every
 * one set up after it carries twelve — and `findDeployedContract` refuses to
 * open a contract whose state does not carry every circuit of the module it
 * was handed ("Following operations: transfer_shielded_to_account, are
 * undefined or have mismatched verifier keys"). That refusal stopped every
 * gift into an older Passport on 2026/09/15.
 *
 * The eleven shared circuits have bit-identical verifier keys across the two
 * builds, so the older module proves against the same key files.
 *
 * `null` — the chain could not be asked — chooses the current module: it is
 * what every account set up since the change carries, and the retry ladder
 * around each call reads the state afresh on the next attempt.
 *
 * A THIRD build joined the two on 2026/09/16: `account-k1`, the k1-arm
 * reference contract, which is a different contract rather than a later
 * revision of this one — a different circuit set, a different vocabulary for
 * the same deposits, a different ledger shape, and ZKIR v3 where both
 * prototypes are v2. It is told apart by a circuit of its own; see
 * {@link K256_WITHDRAWAL_OPERATION_NAME}.
 */
export type AccountModuleName = 'account' | 'account-v1' | 'account-k1';

/**
 * @param carriesOneTxTransfer whether the deployed state carries
 *   {@link ONE_TX_TRANSFER_OPERATION_NAME} — the question that separates the
 *   two prototype builds.
 * @param carriesK256Withdrawal whether it carries
 *   {@link K256_WITHDRAWAL_OPERATION_NAME}, which separates the reference
 *   contract from both of them. Asked SECOND in the argument list and FIRST in
 *   the body: a k1 account has no `transfer_shielded_to_account` either, so the
 *   first question answers `false` for it and would send it to `account-v1`.
 *   Defaulting to `null` keeps every existing caller — and every existing test
 *   — asking exactly the question it asked before.
 */
export function accountModuleFor(
  carriesOneTxTransfer: boolean | null,
  carriesK256Withdrawal: boolean | null = null,
): AccountModuleName {
  if (carriesK256Withdrawal === true) return 'account-k1';
  return carriesOneTxTransfer === false ? 'account-v1' : 'account';
}

/** The operation this decides on; the name the deployed build answers with. */
export const ONE_TX_TRANSFER_OPERATION_NAME = 'transfer_shielded_to_account';

/**
 * Reads the answer off a contract state the indexer served: `true` or `false`
 * from `ContractState.operations()`, `null` when the state cannot say.
 */
export function carriesOneTxTransferIn(state: unknown): boolean | null {
  return operationNamesIn(state)?.includes(ONE_TX_TRANSFER_OPERATION_NAME) ?? null;
}

/* -------------------------------------------------------------------------- */
/* The third build: the k1-arm reference contract                             */
/* -------------------------------------------------------------------------- */

/**
 * The circuit that says an account is the K1-ARM REFERENCE CONTRACT.
 *
 * The reference contract carries every gated operation once per authorisation
 * arm — `<operation>_with_jubjub` and `<operation>_with_k256` — so a single
 * k256 name is enough to tell it apart from both prototype builds, neither of
 * which has an arm suffix on anything. `withdraw_shielded_with_k256` is chosen
 * over the other twenty-nine because it is the one a Passport cannot exist
 * without: it is how value leaves, and a build without it is not this build.
 */
export const K256_WITHDRAWAL_OPERATION_NAME = 'withdraw_shielded_with_k256';

/** The same reading as {@link carriesOneTxTransferIn}, for the k1 arm. */
export function carriesK256WithdrawalIn(state: unknown): boolean | null {
  return operationNamesIn(state)?.includes(K256_WITHDRAWAL_OPERATION_NAME) ?? null;
}

/**
 * `ContractState.operations()` as plain strings, or `null` when the state
 * cannot say. Both readings above are this question asked twice.
 */
function operationNamesIn(state: unknown): string[] | null {
  const operations = (state as { operations?: () => (string | Uint8Array)[] } | null)?.operations;
  if (typeof operations !== 'function') return null;
  try {
    const decoder = new TextDecoder();
    return operations
      .call(state)
      .map((entry) => (typeof entry === 'string' ? entry : decoder.decode(entry)));
  } catch {
    return null;
  }
}

/**
 * The module for a contract state, read in one pass.
 *
 * The k1 question is asked FIRST because it is the decisive one: the reference
 * contract has no `transfer_shielded_to_account` either, so a k1 account read
 * only through {@link carriesOneTxTransferIn} answers `false` and would be
 * opened with `account-v1` — a module whose twelve circuits it does not have
 * and whose verifier keys are nothing like its own.
 */
export function accountModuleForState(state: unknown): AccountModuleName {
  const names = operationNamesIn(state);
  if (names === null) return accountModuleFor(null, null);
  return accountModuleFor(
    names.includes(ONE_TX_TRANSFER_OPERATION_NAME),
    names.includes(K256_WITHDRAWAL_OPERATION_NAME),
  );
}

/* -------------------------------------------------------------------------- */
/* What a sponsor may call on each build                                      */
/* -------------------------------------------------------------------------- */

/**
 * The InboxEntry v1 container: 192 opaque bytes (MIP-0012 §6.4).
 *
 * The contract never inspects an entry — all of its cryptography is
 * client-side — so the length is the only thing this service can check, and
 * checking it is the only thing standing between a malformed deposit and a
 * coin nobody can ever spend.
 */
import { sealInboxEntry } from './k1Inbox.js';

export const INBOX_ENTRY_BYTES = 192;

/** A shielded coin as a deposit circuit takes it. */
export interface ShieldedCoin {
  readonly nonce: Uint8Array;
  readonly color: Uint8Array;
  readonly value: bigint;
}

/**
 * The two deposit entry points of a build, by name and by argument shape.
 *
 * Every deposit this service makes is permissionless on all three builds — no
 * device check, no witness, no caller check — so the difference between them is
 * entirely in the vocabulary, and this is where the vocabulary lives.
 */
export interface AccountDeposits {
  /** The unshielded (NIGHT) deposit circuit's name on this build. */
  readonly unshieldedCircuit: 'deposit_night' | 'deposit_unshielded';
  /** Its arguments, in order. Identical on all three builds. */
  unshieldedArgs(colour: Uint8Array, amount: bigint): readonly unknown[];
  /** The shielded deposit circuit's name. The same on all three builds. */
  readonly shieldedCircuit: 'deposit_shielded';
  /**
   * Its arguments, in order. The prototype builds take the coin alone; the
   * reference contract pairs the coin claim with an inbox entry, and REFUSES
   * rather than inventing one.
   */
  shieldedArgs(coin: ShieldedCoin, entry?: Uint8Array | null): readonly unknown[];
  /**
   * Whether the build mirrors its shielded holdings into readable ledger state.
   *
   * The prototype builds keep a `coins` map, which is what lets a deposit be
   * confirmed by somebody who was not the depositor. The reference contract is
   * STATELESS shielded custody by design (MIP-0012 §6.1): no held coin's
   * description ever reaches public state, so there is no balance to read back
   * and a confirmation has to be built out of something else.
   */
  readonly mirrorsShieldedBalance: boolean;
}

/**
 * The last check before a shielded deposit into the reference contract is
 * submitted: there is an entry, and it is the right length.
 *
 * `deposit_shielded(coin, entry)` takes the protocol coin claim AND the
 * 192-byte inbox entry the owner's client will decrypt to learn the coin's
 * description. `./k1Inbox.ts` builds one now, so this is no longer "nothing
 * here can do that" — it is the guard on a caller that reached this point
 * without one, most often because the account's `enc_key` could not be read.
 *
 * It is still a THROW rather than a fallback, and for the original reason: a
 * deposit made with a placeholder entry still LANDS. The coin moves into the
 * contract's Zswap balance and is gone, because the owner's `held_coin` witness
 * walks the inbox and would never find it. Refusing is the only answer that
 * does not destroy the value it is trying to deliver.
 */
export class InboxEntryRequired extends Error {
  constructor() {
    super(
      'deposit_shielded on the k1-arm account takes a 192-byte InboxEntry v1 alongside the coin, and none was supplied — usually because the account advertised no readable enc_key to seal one to. A deposit with a placeholder entry would land and the coin would be unspendable for ever, so nothing is submitted.',
    );
    this.name = 'InboxEntryRequired';
  }
}

export function accountDeposits(module: AccountModuleName): AccountDeposits {
  if (module === 'account-k1') {
    return {
      unshieldedCircuit: 'deposit_unshielded',
      unshieldedArgs: (colour, amount) => [colour, amount],
      shieldedCircuit: 'deposit_shielded',
      shieldedArgs: (coin, entry) => {
        if (!entry || entry.length !== INBOX_ENTRY_BYTES) throw new InboxEntryRequired();
        return [coin, entry];
      },
      mirrorsShieldedBalance: false,
    };
  }
  return {
    unshieldedCircuit: 'deposit_night',
    unshieldedArgs: (colour, amount) => [colour, amount],
    shieldedCircuit: 'deposit_shielded',
    shieldedArgs: (coin) => [coin],
    mirrorsShieldedBalance: true,
  };
}

/* -------------------------------------------------------------------------- */
/* Which proof server proves which build                                      */
/* -------------------------------------------------------------------------- */

/** The environment variable naming a ZKIR v3 proof server. */
export const V3_PROVER_ENV = 'BALANCER_PROVER_URL_V3';

/**
 * What the droplet sets it to: its own proof server, over the loopback.
 *
 * Deliberately NOT a default in `./config.ts`. A default would make every
 * laptop and every CI run quietly dial a port that is not there and wait out a
 * proof timeout to discover it; an unset variable refuses in one line and says
 * what to set. The droplet's value is here so the runbook and the code cannot
 * drift apart.
 */
export const DROPLET_V3_PROVER_URL = 'http://127.0.0.1:6300';

/** What may prove a module's circuits, and why. */
export type ProverSelection =
  | { readonly kind: 'server'; readonly url: string; readonly why: string }
  | { readonly kind: 'wasm'; readonly why: string }
  | { readonly kind: 'refused'; readonly why: string };

/**
 * The proof route for a build, which is a question about ZKIR VERSION.
 *
 * The prototype builds are ZKIR v2 and keep exactly the route they have had:
 * `BALANCER_PROVER_URL` when it is set, this process's own WASM prover when it
 * is not. Nothing here changes for them.
 *
 * The k1-arm build is compiled `--feature-zkir-v3`, and neither of those can
 * prove it. `BALANCER_PROVER_URL` on the droplet is the 1AM gateway route,
 * which is `ledger9-zkir2-dispatch`; the in-process prover is
 * `@midnight-ntwrk/zkir-v2`. Stagenet VERIFIES v3 proofs, so the only missing
 * piece is a prover that can make them, and it has to be named separately —
 * "this box rather than the gateway" is an operational question and "an image
 * that can prove v3" is a capability, and routing the second by the first is
 * how a k1 deposit would be sent to a server that cannot answer it.
 */
export function proverForModule(
  module: AccountModuleName,
  config: { readonly provingServerUrl?: string; readonly provingServerUrlV3?: string },
): ProverSelection {
  if (module !== 'account-k1') {
    return config.provingServerUrl
      ? {
          kind: 'server',
          url: config.provingServerUrl,
          why: `${module} is ZKIR v2 and proves at BALANCER_PROVER_URL`,
        }
      : { kind: 'wasm', why: `${module} is ZKIR v2 and proves in this process` };
  }
  if (config.provingServerUrlV3) {
    return {
      kind: 'server',
      url: config.provingServerUrlV3,
      why: `account-k1 is ZKIR v3 and proves at ${V3_PROVER_ENV}`,
    };
  }
  return {
    kind: 'refused',
    why: `account-k1 is compiled --feature-zkir-v3, and neither BALANCER_PROVER_URL (the 1AM gateway route, ledger9-zkir2-dispatch) nor this process's own prover (@midnight-ntwrk/zkir-v2) can prove those circuits. Set ${V3_PROVER_ENV} to a proof server that can — on the droplet that is ${DROPLET_V3_PROVER_URL}, reached from outside as /prover-v3.`,
  };
}

/* -------------------------------------------------------------------------- */
/* Reading the key, and sealing to it                                         */
/* -------------------------------------------------------------------------- */

/**
 * The account's advertised `enc_key`, read off decoded ledger state, or null.
 *
 * NULL IS A REFUSAL AND NOT A DEFAULT. A build with no such cell (the two
 * prototype accounts), a cell that decoded as something other than 32 bytes, or
 * state that is not an account at all all arrive here as null, and every caller
 * treats null as "do not deposit" rather than "seal to zeros". Sealing to a key
 * that is not the account's produces an entry the owner cannot open and a coin
 * nobody can ever name.
 */
export function accountEncKey(ledgerState: unknown): Uint8Array | null {
  const key = (ledgerState as { enc_key?: unknown } | null | undefined)?.enc_key;
  return key instanceof Uint8Array && key.length === 32 ? key : null;
}

/**
 * The arguments a shielded deposit takes on this build, with the entry sealed
 * here rather than passed in.
 *
 * ONE PLACE SEALS, and that is the point: the entry has to be built from a key
 * read in the same breath as the deposit, and a caller holding an entry it
 * built earlier is a caller that can seal to a key the account has since
 * rotated away from. The prototype builds ignore `encKey` entirely — they take
 * the coin alone — so passing one is harmless and omitting one on a k1 account
 * is the refusal {@link InboxEntryRequired} describes.
 */
export function sealedShieldedArgs(
  module: AccountModuleName,
  coin: ShieldedCoin,
  encKey: Uint8Array | null,
): readonly unknown[] {
  return sealedShieldedDeposit(module, coin, encKey).args;
}

/**
 * The same seal, with the ENTRY KEPT — which is what makes the deposit
 * confirmable afterwards.
 *
 * `sealInboxEntry` throws its ephemeral secret away, so this service can never
 * read back what it deposited. It can still RECOGNISE it: the 192 bytes it
 * handed the circuit are the 192 bytes `do_append_inbox` writes into
 * `inbox[inbox_count]`, and that map is public. Holding on to them turns the
 * only public trace of a k1 deposit from "the inbox is one longer than it was",
 * which any other depositor's entry satisfies, into "OUR entry is in the
 * inbox", which nothing else does.
 *
 * `entry` is `null` on the prototype builds, which take the coin alone.
 */
export function sealedShieldedDeposit(
  module: AccountModuleName,
  coin: ShieldedCoin,
  encKey: Uint8Array | null,
): { readonly args: readonly unknown[]; readonly entry: Uint8Array | null } {
  const deposits = accountDeposits(module);
  if (deposits.mirrorsShieldedBalance) return { args: deposits.shieldedArgs(coin), entry: null };
  if (encKey === null) throw new InboxEntryRequired();
  const entry = sealInboxEntry(encKey, coin);
  return { args: deposits.shieldedArgs(coin, entry), entry };
}

/** How far back through new inbox entries one confirmation will look. */
export const INBOX_SCAN_MAX = 64n;

/**
 * What a walk of the new inbox slots found, which is THREE answers and not two.
 *
 * `absent` and `unreadable` are both "our entry is not here", and they mean
 * opposite things about what may be concluded from anything else. `absent` is a
 * map this service walked and did not find itself in, which is a fact about
 * this deposit: it has not landed yet. `unreadable` is a map it could not walk
 * at all, which is a fact about this build's decode and about nothing else —
 * the only case in which the deposit transaction's own inclusion is allowed to
 * stand in for the entry.
 */
export type InboxScan = 'found' | 'absent' | 'unreadable';

/**
 * Whether one of the inbox slots that appeared since `before` holds `entry`.
 *
 * The indices are SCANNED rather than assumed, because `inbox_count` is not
 * ours to reserve: another depositor's entry can land in the slot this one was
 * built for, and our deposit is still perfectly good one index further along.
 * Bounded by the growth, so a long-lived account is never walked end to end,
 * and by {@link INBOX_SCAN_MAX}, so a burst of somebody else's traffic cannot
 * turn one confirmation into thousands of map lookups.
 *
 * `read` answers `null` for a slot it cannot read. A walk in which no new slot
 * could be read is `unreadable` — the map is one this build does not know, and
 * it has said nothing either way — while a walk that read slots and found none
 * of them ours is `absent`, which is the map saying our coin is not there yet.
 * A build that sealed nothing has nothing to look for, and that too is `absent`
 * rather than an invitation to confirm on weaker evidence.
 */
export function scanInboxForEntry(
  read: (index: bigint) => Uint8Array | null,
  before: bigint,
  observed: bigint,
  entry: Uint8Array | null,
): InboxScan {
  if (entry === null || observed <= before) return 'absent';
  const last = observed - 1n;
  const first = observed - before > INBOX_SCAN_MAX ? last - (INBOX_SCAN_MAX - 1n) : before;
  let readAny = false;
  for (let index = first; index <= last; index += 1n) {
    const found = read(index);
    if (found === null) continue;
    readAny = true;
    if (sameEntryBytes(found, entry)) return 'found';
  }
  return readAny ? 'absent' : 'unreadable';
}

/** Byte for byte, length first. */
function sameEntryBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * What the chain says about a k1 deposit, as opposed to what it says about the
 * inbox.
 *
 * Every field is about THIS deposit and none is about the account's activity.
 * `entryFound` is the strong one: the 192 bytes this service sealed, found in
 * the account's public `inbox` map. `included` is the weaker one, and weaker
 * than it looks — the indexer maps the deposit's identifier to a block, and a
 * transaction that reached a block may still have been refused there. Nothing
 * in that answer says the deposit SUCCEEDED, so paired with an inbox that grew
 * it would confirm a failed deposit whenever anybody else wrote to the account
 * in the same minutes. It stands only where `inboxUnreadable` says the entry
 * could not be looked for at all, which is the fallback it was written to be.
 */
export interface OwnDepositEvidence {
  /** The entry this service sealed is in the account's inbox. */
  readonly entryFound: boolean;
  /** The inbox could not be walked, so the entry could not be looked for. */
  readonly inboxUnreadable: boolean;
  /** The deposit transaction resolved to a block. */
  readonly included: boolean;
}

/**
 * Whether a shielded deposit has been seen on chain yet.
 *
 * TWO BUILDS, TWO DIFFERENT QUESTIONS. A prototype account mirrors what it
 * holds, so the credit itself is read back and `>=` the target is the answer.
 *
 * A k1 account mirrors nothing (MIP-0012 §6.1) — the coin's description never
 * reaches public state — so the confirmation has to be built out of the inbox.
 * The inbox GROWING is not that confirmation, and this is the correction: the
 * inbox grows for every deposit any sponsor makes, for the change entry of
 * every send the owner does, and for every `append_inbox` backfill, so a wait
 * on `observed > before` is satisfied by somebody else's transaction and would
 * report a coin delivered that had in fact been refused. It is necessary —
 * nothing was written if the inbox did not move — and on its own it is nothing.
 *
 * What confirms is `evidence`: this service's OWN entry in the map. Only where
 * the map could not be walked at all does its own transaction reaching a block
 * stand in for that, because a block is where a transaction was processed and
 * not proof that it was accepted — on a map this service CAN walk, an entry it
 * cannot find is an entry that is not there. Called without evidence, a k1
 * deposit is never confirmed, which is the honest answer when the caller has
 * not looked.
 */
export function shieldedDepositConfirmed(
  module: AccountModuleName,
  before: bigint,
  observed: bigint,
  amount: bigint,
  evidence?: OwnDepositEvidence,
): boolean {
  if (accountDeposits(module).mirrorsShieldedBalance) return observed >= before + amount;
  if (observed <= before) return false;
  if (evidence?.entryFound === true) return true;
  return evidence?.inboxUnreadable === true && evidence.included === true;
}
