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
 * Why a shielded deposit into the reference contract cannot be made here yet.
 *
 * `deposit_shielded(coin, entry)` takes the protocol coin claim AND the
 * 192-byte inbox entry the owner's client will decrypt to learn the coin's
 * description. The entry is encrypted to the account's `enc_key` by a scheme
 * this repository does not yet implement anywhere — not in the sponsor, not in
 * the demo. A deposit made with a placeholder entry would still LAND: the coin
 * would move into the contract's Zswap balance and be gone, because the
 * owner's `held_coin` witness walks the inbox and would never find it. Refusing
 * is the only answer that does not destroy the value it is trying to deliver.
 */
export class InboxEntryRequired extends Error {
  constructor() {
    super(
      'deposit_shielded on the k1-arm account takes a 192-byte InboxEntry v1 alongside the coin, and this service cannot build one: the entry is encrypted to the account enc_key by client-side cryptography that does not exist in this repository yet. A deposit with a placeholder entry would land and the coin would be unspendable for ever, so nothing is submitted.',
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
