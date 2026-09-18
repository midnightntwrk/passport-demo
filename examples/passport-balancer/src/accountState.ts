/**
 * Whether a served contract state is an account this service may pay into, and
 * what it holds — for all three builds, over a state the caller has read.
 *
 * WHY THIS IS ITS OWN FILE. It used to be four closures inside
 * `createAccountFunder`, which meant the only way to ask "what would the
 * balancer make of this state?" was to build a funder, which needs a wallet,
 * which needs a seed and a node. So the answer was never asked in a test, and
 * on 2026/09/18 a passkey Passport that had been set up, activated, and named
 * on stagenet was told by `POST /fund-account`:
 *
 *     {"error":"not-an-account","message":"The contract at 9448e166… is not a
 *      Passport account-custody contract — its state does not decode as one —
 *      so the balancer will not deposit into it."}
 *
 * It was one, and the sentence was the prototype decoder's. The pre-flight
 * asked `balances()`, which read through the PROTOTYPE ledger and its
 * structural fingerprint; a custody account has neither `recovery_shares` nor
 * `night_balances`, so the decode threw and the account was refused before a
 * coin moved. Everything below takes a plain state and the build's own
 * `ledger` function, so `test/accountCustodyState.test.ts` asks it the same
 * question with three real stagenet states and no chain at all.
 *
 * THE FINGERPRINTS ARE STRUCTURAL, NOT "the decoder did not throw". Compact
 * decodes positionally, so a foreign contract can occasionally produce a
 * plausible-looking object, and the balancer will not pay coins into a
 * contract it cannot recognise.
 */

import {
  accountEncKey,
  accountModuleForState,
  type AccountModuleName,
} from './accountModule.js';

/**
 * Why a state was refused, kept apart from the sentence.
 *
 * `not-an-account` is "this is not a Passport", which is the caller's error and
 * never worth retrying. `account-not-activated` is "this IS a Passport and it
 * has not finished being set up", which is a different thing to say to a person
 * and a different thing for the sponsor's own retry ladder to do about it —
 * both are permanent as far as this request is concerned, and only one of them
 * means something is wrong.
 */
export type AccountStateRefusalCode = 'not-an-account' | 'account-not-activated';

export class AccountStateRefusal extends Error {
  constructor(
    readonly code: AccountStateRefusalCode,
    message: string,
  ) {
    super(message);
    this.name = 'AccountStateRefusal';
  }
}

/**
 * The little of a prototype account's ledger this service reads.
 *
 * `night_balances` is the contract's explicit MIRROR of its NIGHT holdings per
 * colour; `coins` is the shielded side and not a mirror at all — it holds the
 * account's actual coins, which is what lets a deposit be confirmed by somebody
 * who was not the depositor.
 */
export interface PrototypeAccountLedger {
  readonly device_count: bigint;
  readonly device_epoch: bigint;
  devices: {
    member(commitment: bigint): boolean;
    [Symbol.iterator](): Iterator<[bigint, bigint]>;
  };
  recovery_shares: { size(): bigint };
  night_balances: {
    member(colour: Uint8Array): boolean;
    lookup(colour: Uint8Array): bigint;
  };
  coins: {
    member(colour: Uint8Array): boolean;
    lookup(colour: Uint8Array): { nonce: Uint8Array; color: Uint8Array; value: bigint };
  };
}

/**
 * The little of an account custody contract's ledger this service reads.
 *
 * Two differences from {@link PrototypeAccountLedger} matter and both are
 * deliberate in the contract rather than incidental: `unshielded_balances` is
 * what `night_balances` is, and THERE IS NO `coins` MAP — shielded custody is
 * stateless by design (MIP-0012 §6.1), so the inbox is the only public trace a
 * deposit leaves.
 */
export interface CustodyAccountLedger {
  readonly device_count: bigint;
  readonly booted: boolean;
  readonly inbox_count: bigint;
  inbox: { member(index: bigint): boolean; lookup(index: bigint): Uint8Array };
  readonly enc_key: Uint8Array;
  unshielded_balances: {
    member(colour: Uint8Array): boolean;
    lookup(colour: Uint8Array): bigint;
  };
}

/**
 * What this service needs to know about an account it is about to pay, read off
 * the account's own state in one pass: which build it is, and what it already
 * holds of the colour being deposited.
 */
export interface AccountView {
  readonly module: AccountModuleName;
  /** The mirrored unshielded balance of `colour` — `night_balances` or `unshielded_balances`. */
  unshielded(colour: Uint8Array): bigint;
  /**
   * The mirrored shielded balance of `colour`, or `null` on a build that keeps
   * no such mirror. `null` is not "zero": it is "this cannot be asked".
   */
  shielded(colour: Uint8Array): bigint | null;
  /**
   * The account's advertised `enc_key`, or `null` on a build that has none.
   *
   * READ LIVE, EVERY TIME, and never cached: `rotate_enc_key_with_<arm>` is a
   * circuit an owner may call at any moment, and a depositor sealing to a key
   * the account has moved on from writes an entry the owner cannot open, with
   * a coin inside it that is then unspendable for ever.
   */
  encKey(): Uint8Array | null;
  /**
   * `inbox_count`, or `null` on a build that has no inbox.
   *
   * It says how many entries there are and NOT whose they are: see
   * {@link AccountView.inboxEntry}.
   */
  inboxCount(): bigint | null;
  /**
   * The entry at one index, or `null` when there is none, or when this build
   * has no inbox at all.
   *
   * What turns "the inbox grew" into "our deposit landed". Never throws: a map
   * this service cannot walk is a `null` and a weaker confirmation, not a
   * failed activation.
   */
  inboxEntry(index: bigint): Uint8Array | null;
}

/**
 * The prototype decode and fingerprint, over a state already read.
 *
 * Every real prototype account has at least one device (the constructor inserts
 * one and `remove_device` asserts it cannot remove the last) and exactly three
 * recovery shares.
 *
 * `module` is passed in so the refusal can be TRUE. A custody account fails
 * this decode and is not "not an account"; it is an account this decoder is the
 * wrong one for, and saying so is the difference between an operator looking
 * for a broken Passport and an operator looking for a pre-flight that asked the
 * wrong build.
 */
export function decodePrototypeAccount<Ledger extends PrototypeAccountLedger>(
  decode: (data: unknown) => Ledger,
  state: unknown,
  address: string,
  module: AccountModuleName,
  colour: Uint8Array,
): Ledger {
  let decoded: Ledger | null = null;
  try {
    const candidate = decode((state as { data: unknown }).data);
    if (candidate.device_count >= 1n && candidate.recovery_shares.size() === 3n) {
      candidate.night_balances.member(colour);
      decoded = candidate;
    }
  } catch {
    decoded = null;
  }
  if (!decoded) {
    throw new AccountStateRefusal(
      'not-an-account',
      module === 'account-custody'
        ? `The contract at ${address} is an account custody account, and this is the prototype reader. It has to be opened with the account-custody build.`
        : `The contract at ${address} is not a Passport account-custody contract — its state does not decode as one — so the balancer will not deposit into it.`,
    );
  }
  return decoded;
}

/**
 * The account custody decode and fingerprint, over a state already read.
 *
 * FOUR THINGS ARE ASKED, and they are two different questions.
 *
 * Whether this is the contract at all: the state decodes, it advertises a
 * 32-byte `enc_key` (the constructor sets one and `rotate_enc_key` is the only
 * circuit that can change it, so an account without one is not this contract),
 * and its `unshielded_balances` mirror can be read — which is the map a NIGHT
 * deposit is confirmed in, so a state where it cannot be walked is one no
 * deposit could be confirmed against.
 *
 * And whether it has finished being set up: `booted`, with at least one device.
 * The constructor leaves `booted = false` and `device_count = 0`, and
 * `activate_initial_device_with_<arm>` sets both in the same circuit. An
 * account between its deploy and its activation is REAL, and is refused
 * plainly, because the deposit it is asking for would land in a contract with
 * no device that can ever move it out again.
 */
export function decodeCustodyAccount<Ledger extends CustodyAccountLedger>(
  decode: (data: unknown) => Ledger,
  state: unknown,
  address: string,
  colour: Uint8Array,
): Ledger {
  let decoded: Ledger | null = null;
  try {
    const candidate = decode((state as { data: unknown }).data);
    if (accountEncKey(candidate) !== null) {
      candidate.unshielded_balances.member(colour);
      decoded = candidate;
    }
  } catch {
    decoded = null;
  }
  if (!decoded) {
    throw new AccountStateRefusal(
      'not-an-account',
      `The contract at ${address} declares the account custody circuits but its state does not decode as a custody account, so the balancer will not deposit into it.`,
    );
  }
  if (!decoded.booted || decoded.device_count < 1n) {
    throw new AccountStateRefusal(
      'account-not-activated',
      `The Passport at ${address} has been created but not finished: no device has been activated on it yet, so there is nothing that could spend what was deposited. Finish setting it up and ask again.`,
    );
  }
  return decoded;
}

/**
 * The account's view, built from the build it actually is.
 *
 * ONE STATE, read once by the caller, because the module and the balances come
 * off the same read and asking twice would let them disagree.
 */
export function accountViewFrom<
  Prototype extends PrototypeAccountLedger,
  Custody extends CustodyAccountLedger,
>(deps: {
  readonly state: unknown;
  readonly address: string;
  readonly module: AccountModuleName;
  /** The native colour, which is the one the fingerprints are checked against. */
  readonly nativeColour: Uint8Array;
  readonly prototypeLedger: (data: unknown) => Prototype;
  /** Absent until a custody account is met; see `./account.ts` on loading it late. */
  readonly custodyLedger?: (data: unknown) => Custody;
}): AccountView {
  const { state, address, module, nativeColour } = deps;
  if (module === 'account-custody') {
    if (!deps.custodyLedger) {
      throw new AccountStateRefusal(
        'not-an-account',
        `The contract at ${address} is an account custody account and the compiled account-custody build was not supplied, so it cannot be read here.`,
      );
    }
    const custody = decodeCustodyAccount(deps.custodyLedger, state, address, nativeColour);
    return {
      module,
      unshielded: (c) =>
        custody.unshielded_balances.member(c) ? custody.unshielded_balances.lookup(c) : 0n,
      /* Stateless shielded custody: there is no mirror to read. NOT zero. */
      shielded: () => null,
      encKey: () => accountEncKey(custody),
      inboxCount: () => custody.inbox_count,
      inboxEntry: (index) => {
        try {
          if (index < 0n || index >= custody.inbox_count) return null;
          if (!custody.inbox.member(index)) return null;
          const entry = custody.inbox.lookup(index);
          return entry instanceof Uint8Array ? entry : null;
        } catch {
          /* An older build, or a map shape this decode does not know. The
             confirmation falls back to the deposit's own inclusion. */
          return null;
        }
      },
    };
  }
  const decoded = decodePrototypeAccount(
    deps.prototypeLedger,
    state,
    address,
    module,
    nativeColour,
  );
  return {
    module,
    unshielded: (c) => (decoded.night_balances.member(c) ? decoded.night_balances.lookup(c) : 0n),
    shielded: (c) => (decoded.coins.member(c) ? decoded.coins.lookup(c).value : 0n),
    /* The prototype builds have neither. They mirror their shielded holdings
       instead, which is what `shielded` above reads. */
    encKey: () => null,
    inboxCount: () => null,
    inboxEntry: () => null,
  };
}

/**
 * The whole of what a funding pre-flight does with a state it has read: pick
 * the build, load the reader for it, decode, fingerprint.
 *
 * ONE FUNCTION so that `balances()` in `./account.ts` has nothing of its own to
 * get wrong. The defect this file exists for was not in the decode — it was in
 * the closure ABOVE the decode calling the prototype reader whatever the
 * account was, and a test that drilled only the decode would have passed
 * throughout. What is left in the closure now is the indexer read and the
 * translation of a refusal; everything that decides is here, and
 * `test/accountCustodyState.test.ts` calls this with a fake reader and real
 * served states.
 */
export async function accountViewFor<
  Prototype extends PrototypeAccountLedger,
  Custody extends CustodyAccountLedger,
>(deps: {
  readonly address: string;
  /** The state, already read and already refused if there is none. */
  readonly state: unknown;
  readonly nativeColour: Uint8Array;
  readonly prototypeLedger: (data: unknown) => Prototype;
  /**
   * The custody build's `ledger`, loaded ON DEMAND and OUTSIDE the decode.
   *
   * A host that cannot load the build at all has said nothing about this
   * account, and its refusal — `prover-unavailable` — must travel rather than
   * be swallowed into `not-an-account`, which would tell a caller its Passport
   * is not a Passport. So this throws on its own terms and nothing here
   * catches it.
   */
  readonly custodyLedgerFor: () => Promise<(data: unknown) => Custody>;
}): Promise<AccountView> {
  const module = accountModuleForState(deps.state);
  const custodyLedger = module === 'account-custody' ? await deps.custodyLedgerFor() : undefined;
  return accountViewFrom<Prototype, Custody>({
    state: deps.state,
    address: deps.address,
    module,
    nativeColour: deps.nativeColour,
    prototypeLedger: deps.prototypeLedger,
    custodyLedger,
  });
}

/** Both balances an account holds, from one view. */
export interface AccountBalancesRead {
  readonly night: bigint;
  /**
   * `null` on the account custody build, which mirrors no shielded holding at
   * all — and `0n`, not null, where this service has no asset colour
   * configured, which is what the prototype path answered before any of this
   * and must go on answering.
   */
  readonly asset: bigint | null;
}

/**
 * What `/fund-account`'s pre-flight asks of a view.
 *
 * Here rather than in the closure for the reason {@link accountViewFor} gives:
 * the two lines that turn a view into an answer are the two lines that were
 * wrong, and they are worth a test of their own.
 */
export function accountBalancesFrom(
  view: AccountView,
  nativeColour: Uint8Array,
  assetColour: Uint8Array | null,
): AccountBalancesRead {
  return {
    night: view.unshielded(nativeColour),
    asset: assetColour ? view.shielded(assetColour) : 0n,
  };
}
