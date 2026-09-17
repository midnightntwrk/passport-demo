/**
 * The client-side custody layer for the account custody reference account contract —
 * the arithmetic half, with nothing in it that touches the network, the
 * wallet, the DOM, or Dynamic.
 *
 * WHY THIS EXISTS (2026/09/16)
 * ----------------------------
 * The reference account contract (`contract/contracts/account.compact` on the
 * retired `passport` repository, compiled here with `compactc 0.34.0
 * --feature-zkir-v3`) gates every asset-releasing circuit behind an in-circuit
 * signature check, and it exports that gate twice: once over JubJub Schnorr
 * (arm `jubjub`, the normative MIP-0013 scheme) and once over secp256k1 ECDSA
 * (arm `k256`, an interim arm standing in for the P-256 passkey arm that
 * Compact cannot yet express). The two arms share ONE device set, and
 * `add_device` binds a new device as its already-derived 32-byte ENTRY, so a
 * JubJub device can enrol a k256 device and the other way round.
 *
 * That cross-arm seam is the whole reason this file exists. Dynamic's embedded
 * wallet holds a secp256k1 key it will never export, and will sign a 32-byte
 * digest handed to it verbatim. It cannot be turned into a JubJub scalar and it
 * cannot be reconstructed from a passkey. But it CAN be a k256 device on an
 * account whose first device is the passkey — which is what makes "sign in with
 * Dynamic, on a device that has never seen this Passport" a thing the contract
 * already supports rather than a thing we would have to invent.
 *
 * WHAT THIS MODULE IS, AND IS NOT
 * -------------------------------
 * It is the SIGNING BOUNDARY, and only that: arms, envelopes, entry and
 * challenge derivation, the digest a device actually signs, and the parsing of
 * what an EVM signer hands back. Everything with a socket on the end of it —
 * providers, proving, submission, the private-state coin store, the module
 * choice per address — stays in `contractRuntime.ts`, `accountCustody.ts`, and
 * `accountUpgrade.ts`, and none of it is wired up yet. See
 * `docs/demo/account-custody-layer-design.md` for the shape of that wiring and the
 * PR sequence that builds it.
 *
 * THREE RULES THIS FILE KEEPS, AND WHY EACH IS A RULE
 * --------------------------------------------------
 * 1. THE PURE CIRCUITS ARE INJECTED, NEVER IMPORTED. Every derivation below
 *    takes a {@link CustodyPureCircuits} as its first argument instead of reaching
 *    for a compiled contract module. The compiled `account-custody` build is ~100 MB
 *    of prover keys staged by a script and gitignored (see the root
 *    `.gitignore`); a static import here would make this module unloadable in a
 *    unit test and would put a contract build on the entry graph. The loader
 *    that supplies the real object is a TODO — `contractRuntime.ts`'s
 *    `compiledContractFor` is where it belongs, and the interface below is
 *    deliberately the exact subset of the generated `PureCircuits` type that
 *    this layer needs, so the real module satisfies it structurally with no
 *    adapter.
 *
 * 2. THE DIGEST IS COMPUTED TWICE, ON PURPOSE. `envelope_digest` is an exported
 *    pure circuit; {@link envelopeDigest} recomputes the same thing in
 *    TypeScript from WebCrypto. That is not duplication for its own sake — the
 *    contract's own circuit is the authority, and {@link envelopeDigestMatches}
 *    exists so a test (and, later, a startup assertion) can prove the two agree
 *    on a build before anybody signs anything with the local one. The local
 *    copy is what the app uses, because asking a 100 MB contract module for a
 *    SHA-256 is not a sensible thing to do on a phone.
 *
 * 3. NOTHING FROM `@dynamic-labs` IS IMPORTED, STATICALLY OR OTHERWISE.
 *    `src/lib/dynamicBundle.test.ts` forbids it on the entry graph, and the
 *    reason is bundle size on a PWA that has to install over a hotel Wi-Fi.
 *    {@link dynamicK256Signer} takes the `signRawMessage` FUNCTION as an
 *    argument. The caller — which is already inside the lazily-loaded Dynamic
 *    boundary — hands it in.
 *
 * WHAT IS NOT HERE YET
 * --------------------
 * The JubJub signing side. A JubJub device has to grind a nonce until the
 * challenge hash reads below the subgroup order, and the grind loop needs the
 * per-circuit challenge builder in its hand, which means it needs the real
 * compiled module. The types for a JubJub authorisation are here because
 * {@link authArgs} has to expand both arms; the signer is not, and the design
 * doc says which PR brings it.
 */

/*
 * The affine-point shape the generated ABI uses for BOTH curves —
 * `compact-runtime`'s `JubjubPoint` and `Secp256k1Point` are the same three
 * fields, and 0.19.0-rc.0 (what this app pins) already declares both.
 *
 * It is restated here rather than imported so that this module carries no
 * runtime dependency at all: `@midnight-ntwrk/compact-runtime` is a ledger-9
 * WASM bundle, and a pure-arithmetic module that pulls it in is a pure module
 * only on paper. The shapes are structurally identical, so the real ABI's
 * points satisfy these types and the real ABI's functions satisfy
 * {@link CustodyPureCircuits} without a cast at the call site.
 */
export interface CurvePoint {
  readonly x: bigint;
  readonly y: bigint;
  readonly identity: boolean;
}

/** A contract address as the generated ABI takes it: raw bytes in a wrapper. */
export interface ContractAddressArg {
  readonly bytes: Uint8Array;
}

/**
 * A held shielded coin's qualified description — the `held_coin` witness value.
 *
 * It appears here only because the two shielded-spend challenges BIND it
 * (AUTH-10: the approver signs over the exact coin the spend will consume), so
 * a challenge builder cannot be typed without it. Where the coin comes from is
 * `accountCustody.ts`'s problem.
 */
export interface QualifiedCoin {
  readonly nonce: Uint8Array;
  readonly color: Uint8Array;
  readonly value: bigint;
  readonly mt_index: bigint;
}

// ─────────────────────────────────────────────────────────────────────────────
// Arms
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The authorisation arms the contract exports circuits for.
 *
 * The string is not decoration: every gated circuit is named
 * `<operation>_with_<arm>`, so the arm IS the half of the circuit name that
 * selects which proof gets made. {@link gatedCircuitName} is the only place
 * that concatenation is written down.
 */
export type K1Arm = 'jubjub' | 'k256';

/** The name of the gated circuit an operation reaches through on an arm. */
export function gatedCircuitName(operation: string, arm: K1Arm): string {
  return `${operation}_with_${arm}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Envelopes (the k256 arm only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Envelope 0 — no prefix. The signed digest is plain `SHA-256(challenge)`, i.e.
 * ordinary ECDSA-SHA256 over the challenge bytes as the message.
 *
 * THIS IS THE ONE DYNAMIC CAN DO. `signRawMessage` signs the 32 bytes it is
 * given and adds nothing: no keccak, no EIP-191 `\x19Ethereum Signed Message`
 * preamble. Hand it `SHA-256(challenge)` and the contract's in-circuit
 * recomputation agrees. Hand it anything wrapped and it does not.
 */
export const K256_ENVELOPE_NONE = 0n;

/**
 * Envelope 1 — the dApp-connector `signData` envelope, prefix
 * `midnight_signed_message:32:`, which that surface applies unconditionally and
 * will not let a caller skip. Unused by the Dynamic path; here because the
 * envelope is fixed at ENROLMENT and bound into the device's entry derivation,
 * so a layer that only knew about envelope 0 could not read a roster that
 * contained a connector device.
 */
export const K256_ENVELOPE_CONNECTOR = 1n;

/** The enumerated envelope ids the contract's `envelope_digest` accepts. */
export type K256Envelope = typeof K256_ENVELOPE_NONE | typeof K256_ENVELOPE_CONNECTOR;

/**
 * The ASCII prefix each envelope id prepends to the challenge before hashing.
 *
 * An id rather than the prefix bytes because Compact has no variable-length
 * `Bytes`: an empty prefix cannot be a shorter value of the same field, and a
 * prefix of another length would be another type and so another ABI. The id
 * selects among fixed hash shapes instead.
 */
const ENVELOPE_PREFIXES: ReadonlyMap<bigint, string> = new Map([
  [K256_ENVELOPE_NONE, ''],
  [K256_ENVELOPE_CONNECTOR, 'midnight_signed_message:32:'],
]);

/** Whether a bigint is an envelope id this build knows how to digest. */
export function isK256Envelope(value: bigint): value is K256Envelope {
  return ENVELOPE_PREFIXES.has(value);
}

/**
 * The prefix bytes for an envelope.
 *
 * Fails closed on an unknown id rather than falling back to the empty prefix:
 * silently treating an unrecognised envelope as envelope 0 would produce a
 * signature over the wrong digest, which the contract rejects — but only after
 * the user has been asked to approve it.
 */
export function envelopePrefixBytes(envelope: K256Envelope): Uint8Array {
  const prefix = ENVELOPE_PREFIXES.get(envelope);
  if (prefix === undefined) {
    throw new Error(`unknown k256 envelope id ${String(envelope)}`);
  }
  return new TextEncoder().encode(prefix);
}

// ─────────────────────────────────────────────────────────────────────────────
// Authorisations
// ─────────────────────────────────────────────────────────────────────────────

/** An ECDSA signature in the two scalars the generated ABI carries. */
export interface EcdsaSignature {
  readonly r: bigint;
  readonly s: bigint;
}

/** What a `_with_jubjub` gated circuit consumes after its own arguments. */
export interface JubjubAuthorisation {
  readonly arm: 'jubjub';
  readonly pk: CurvePoint;
  /** The device's position in its rolling entry series (AUTH-9). */
  readonly use_counter: bigint;
  readonly sig_r: CurvePoint;
  readonly sig_s: bigint;
  readonly grind_nonce: bigint;
}

/** What a `_with_k256` gated circuit consumes after its own arguments. */
export interface K256Authorisation {
  readonly arm: 'k256';
  readonly pk: CurvePoint;
  /** The device's position in its rolling entry series (AUTH-9). */
  readonly use_counter: bigint;
  readonly sig: EcdsaSignature;
  /**
   * The device's envelope, fixed at enrolment and bound into its entry
   * derivation — a property of the device, not of this call. Presenting the
   * wrong one fails the membership assert before any signature is examined.
   */
  readonly envelope: K256Envelope;
}

export type K1Authorisation = JubjubAuthorisation | K256Authorisation;

/**
 * The trailing circuit arguments an authorisation expands to, in the order the
 * arm's gated circuits declare them.
 *
 * Both arms are `(…args, pk, use_counter, …)` and then diverge. Writing the
 * divergence once, here, is what keeps a caller from having to know which arm
 * it is on beyond choosing the circuit name.
 */
export function authArgs(auth: K1Authorisation): readonly unknown[] {
  return auth.arm === 'jubjub'
    ? [auth.pk, auth.use_counter, auth.sig_r, auth.sig_s, auth.grind_nonce]
    : [auth.pk, auth.use_counter, auth.sig, auth.envelope];
}

// ─────────────────────────────────────────────────────────────────────────────
// The compiled contract's exported pure circuits
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The subset of the compiled contract's `pureCircuits` this layer needs.
 *
 * TODO(account-custody, PR 2): supply the real object. It comes from the compiled
 * `account-custody` module, loaded the way `contractRuntime.ts` loads the other
 * contract modules — from the staged `contracts/stagenet/managed/account-custody/`
 * tree, not from a package import, because the build is generated output and is
 * gitignored. Until that lands, callers inject a fake and the unit tests below
 * inject one too; the real `PureCircuits` type in the generated `index.d.ts`
 * satisfies this interface structurally, so the loader needs no adapter.
 *
 * The argument names are the generated ones minus the compiler's `_0` suffix,
 * and the orders are the generated orders — including the oddity that the
 * jubjub challenges take `sig_r` SECOND (a Schnorr challenge commits to its own
 * signature nonce) while the k256 challenges have no signature term at all (an
 * ECDSA message must not depend on its own signature).
 */
export interface CustodyPureCircuits {
  derive_boot_commitment_with_jubjub(salt: Uint8Array, pk: CurvePoint): Uint8Array;
  derive_boot_commitment_with_k256(
    salt: Uint8Array,
    pk: CurvePoint,
    envelope: bigint,
  ): Uint8Array;
  derive_device_entry_with_jubjub(
    self_addr: ContractAddressArg,
    pk: CurvePoint,
    epoch: bigint,
    counter: bigint,
  ): Uint8Array;
  derive_device_entry_with_k256(
    self_addr: ContractAddressArg,
    pk: CurvePoint,
    envelope: bigint,
    epoch: bigint,
    counter: bigint,
  ): Uint8Array;
  envelope_digest(envelope: bigint, challenge: Uint8Array): Uint8Array;
  compute_public_point_with_k256(scalar: bigint): CurvePoint;
  challenge_withdraw_shielded_with_k256(
    self_addr: ContractAddressArg,
    pk: CurvePoint,
    recipient: ContractAddressArg,
    color: Uint8Array,
    amount: bigint,
    coin: QualifiedCoin,
    nonce_value: bigint,
  ): Uint8Array;
  challenge_withdraw_unshielded_with_k256(
    self_addr: ContractAddressArg,
    pk: CurvePoint,
    color: Uint8Array,
    amount: bigint,
    recipient: ContractAddressArg,
    nonce_value: bigint,
  ): Uint8Array;
  challenge_append_inbox_with_k256(
    self_addr: ContractAddressArg,
    pk: CurvePoint,
    entry: Uint8Array,
    nonce_value: bigint,
  ): Uint8Array;
  challenge_add_device_with_k256(
    self_addr: ContractAddressArg,
    pk: CurvePoint,
    new_entry: Uint8Array,
    nonce_value: bigint,
  ): Uint8Array;
}

/**
 * Everything a challenge needs that is not one of the call's own arguments: the
 * account it binds to (AUTH-3) and the `auth_nonce` it will execute against
 * (AUTH-2, read BEFORE the call and pre-increment).
 *
 * `auth_nonce` is its own cell rather than the `round` counter precisely so a
 * permissionless deposit landing between the read and the submit cannot
 * invalidate a signature the user has already approved.
 */
export interface K1CallContext {
  readonly contractAddress: Uint8Array;
  readonly authNonce: bigint;
}

const addressArg = (context: K1CallContext): ContractAddressArg => ({
  bytes: context.contractAddress,
});

// ─────────────────────────────────────────────────────────────────────────────
// Entry and boot derivation
// ─────────────────────────────────────────────────────────────────────────────

/** A k256 device as this layer identifies one: its public point and envelope. */
export interface K256DeviceIdentity {
  readonly arm: 'k256';
  readonly pk: CurvePoint;
  readonly envelope: K256Envelope;
}

/** A JubJub device as this layer identifies one. */
export interface JubjubDeviceIdentity {
  readonly arm: 'jubjub';
  readonly pk: CurvePoint;
}

export type K1DeviceIdentity = K256DeviceIdentity | JubjubDeviceIdentity;

/**
 * The 32-byte set element that IS the device's authority at one position in its
 * series — bound to the account address, the device epoch, and the use counter,
 * and (on the k256 arm) to the envelope.
 *
 * Every gated call consumes the element at the current counter and inserts the
 * one at counter + 1, which is what makes a signature single-use.
 */
export function deviceEntry(
  pure: CustodyPureCircuits,
  device: K1DeviceIdentity,
  contractAddress: Uint8Array,
  epoch: bigint,
  counter: bigint,
): Uint8Array {
  const self = { bytes: contractAddress };
  return device.arm === 'k256'
    ? pure.derive_device_entry_with_k256(self, device.pk, device.envelope, epoch, counter)
    : pure.derive_device_entry_with_jubjub(self, device.pk, epoch, counter);
}

/**
 * The salted boot commitment stored by the constructor.
 *
 * `kernel.self()` is not available in a Compact constructor, so the real
 * address-bound entry cannot be inserted at deploy time: the constructor stores
 * this commitment and the arm's `activate_initial_device` opens it immediately
 * afterwards. The initial device's ARM therefore selects which activation
 * circuit can ever match — which is why the migration in the design doc deploys
 * with the PASSKEY, not with Dynamic.
 */
export function bootCommitment(
  pure: CustodyPureCircuits,
  device: K1DeviceIdentity,
  salt: Uint8Array,
): Uint8Array {
  return device.arm === 'k256'
    ? pure.derive_boot_commitment_with_k256(salt, device.pk, device.envelope)
    : pure.derive_boot_commitment_with_jubjub(salt, device.pk);
}

/**
 * The entry a cross-arm `add_device` enrols a NEW device as.
 *
 * Enrolment takes a derived entry rather than a key, which is exactly why one
 * arm can enrol another: the contract sees 32 opaque bytes and never learns
 * which curve produced them. The epoch must be the CURRENT `device_epoch` and
 * the counter must be 0 — the contract cannot check either, and an entry at a
 * stale epoch is dead weight that still counts toward `device_count`. The
 * counter is not a parameter here for that reason: there is one correct value
 * and a caller should not be able to pass another by accident.
 */
export function enrolmentEntry(
  pure: CustodyPureCircuits,
  newDevice: K1DeviceIdentity,
  contractAddress: Uint8Array,
  currentEpoch: bigint,
): Uint8Array {
  return deviceEntry(pure, newDevice, contractAddress, currentEpoch, 0n);
}

// ─────────────────────────────────────────────────────────────────────────────
// Challenges (k256 arm)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The per-circuit challenge builders for the k256 arm.
 *
 * Each mirrors one gated circuit and returns the 32 bytes that go into
 * {@link envelopeDigest}. The preimage binds the circuit's own
 * domain-separation tag, the account, the signing key, every argument in
 * declaration order, the values returned by every witness invocation, and
 * `auth_nonce` — which is why the two shielded builders take the qualified
 * coin: the approver signs over the exact note the spend will consume, not over
 * a colour and an amount.
 */
export const k256Challenges = {
  withdrawShielded(
    pure: CustodyPureCircuits,
    context: K1CallContext,
    pk: CurvePoint,
    recipient: Uint8Array,
    color: Uint8Array,
    amount: bigint,
    coin: QualifiedCoin,
  ): Uint8Array {
    return pure.challenge_withdraw_shielded_with_k256(
      addressArg(context),
      pk,
      { bytes: recipient },
      color,
      amount,
      coin,
      context.authNonce,
    );
  },

  withdrawUnshielded(
    pure: CustodyPureCircuits,
    context: K1CallContext,
    pk: CurvePoint,
    color: Uint8Array,
    amount: bigint,
    recipient: Uint8Array,
  ): Uint8Array {
    return pure.challenge_withdraw_unshielded_with_k256(
      addressArg(context),
      pk,
      color,
      amount,
      { bytes: recipient },
      context.authNonce,
    );
  },

  appendInbox(
    pure: CustodyPureCircuits,
    context: K1CallContext,
    pk: CurvePoint,
    entry: Uint8Array,
  ): Uint8Array {
    return pure.challenge_append_inbox_with_k256(
      addressArg(context),
      pk,
      entry,
      context.authNonce,
    );
  },

  addDevice(
    pure: CustodyPureCircuits,
    context: K1CallContext,
    pk: CurvePoint,
    newEntry: Uint8Array,
  ): Uint8Array {
    return pure.challenge_add_device_with_k256(
      addressArg(context),
      pk,
      newEntry,
      context.authNonce,
    );
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// The digest a k256 device actually signs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `SHA-256(prefix(envelope) || challenge)` — never the challenge itself.
 *
 * Async because WebCrypto is: the app already reaches `crypto.subtle.digest`
 * this way in `midnames.ts` and `passportContract.ts`, and a synchronous
 * SHA-256 would mean a hashing dependency this workspace does not declare.
 */
export async function envelopeDigest(
  envelope: K256Envelope,
  challenge: Uint8Array,
): Promise<Uint8Array> {
  const prefix = envelopePrefixBytes(envelope);
  const payload = new Uint8Array(prefix.length + challenge.length);
  payload.set(prefix, 0);
  payload.set(challenge, prefix.length);
  const digest = await crypto.subtle.digest('SHA-256', payload);
  return new Uint8Array(digest);
}

/**
 * Whether the local digest agrees with the contract's own `envelope_digest` on
 * a build.
 *
 * Rule 2 of the module header in one function. The local copy is what signs, so
 * something has to be able to prove it is the same rule the circuit will apply,
 * and "the tests passed against the contract we shipped" is a stronger claim
 * than "we read the spec carefully".
 */
export async function envelopeDigestMatches(
  pure: CustodyPureCircuits,
  envelope: K256Envelope,
  challenge: Uint8Array,
): Promise<boolean> {
  const local = await envelopeDigest(envelope, challenge);
  return bytesEqual(local, pure.envelope_digest(envelope, challenge));
}

// ─────────────────────────────────────────────────────────────────────────────
// Signing: the k256 device behind an interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A k256 device that can be asked for a signature over a digest.
 *
 * Deliberately narrow: no key, no export, no curve library. Dynamic gives us
 * nothing more than this, and writing the interface to what the weakest signer
 * can do means a software signer, an HSM profile, and Dynamic are all the same
 * shape to every caller.
 */
export interface K256Signer {
  readonly arm: 'k256';
  readonly pk: CurvePoint;
  readonly envelope: K256Envelope;
  /** ECDSA-sign the 32-byte digest EXACTLY as given — no further hashing. */
  signDigest(digest: Uint8Array): Promise<EcdsaSignature>;
}

/**
 * The shape of Dynamic's raw-message signing call, restated so this module
 * never names `@dynamic-labs`.
 *
 * `message` is the digest as 64 lower-case hex characters with no `0x`, and
 * Dynamic signs those 32 bytes verbatim — no keccak, no EIP-191 preamble. That
 * is the entire reason envelope 0 is the one the Dynamic path uses.
 *
 * The real `IDynamicWaasConnector.signRawMessage` takes two more fields
 * (`context` and `password`) that mean nothing to this layer. The caller — on
 * the Dynamic side of the lazy boundary, where the connector actually lives —
 * closes over them and hands in a two-field function, which keeps the vendor's
 * argument shape from becoming part of the custody layer's ABI.
 */
export type DynamicSignRawMessage = (input: {
  accountAddress: string;
  message: string;
}) => Promise<string>;

/**
 * Wrap Dynamic's embedded EVM key as a k256 device.
 *
 * The public point is a parameter rather than something derived here because
 * Dynamic exports no key: the point is recovered once at enrolment (from a
 * signature over a known digest, using the recovery byte this parser keeps) and
 * stored alongside the account. Deriving it per call would mean a signature per
 * call before the signature that matters.
 */
export function dynamicK256Signer(options: {
  readonly accountAddress: string;
  readonly pk: CurvePoint;
  readonly signRawMessage: DynamicSignRawMessage;
  readonly envelope?: K256Envelope;
}): K256Signer {
  const envelope = options.envelope ?? K256_ENVELOPE_NONE;
  return {
    arm: 'k256',
    pk: options.pk,
    envelope,
    async signDigest(digest: Uint8Array): Promise<EcdsaSignature> {
      if (digest.length !== 32) {
        throw new Error(`k256 digest must be 32 bytes, got ${digest.length}`);
      }
      const raw = await options.signRawMessage({
        accountAddress: options.accountAddress,
        message: bytesToHex(digest),
      });
      const parsed = parseEvmSignature(raw);
      return { r: parsed.r, s: parsed.s };
    },
  };
}

/**
 * Build the authorisation for one gated call: hash the challenge into the
 * device's envelope digest, sign it, and pair the signature with the use
 * counter the seam will consume.
 *
 * The use counter is a parameter, not something read here, because reading it
 * needs the ledger — and the rule that it must be read fresh (the roster is
 * self-healing by rescan, not by memory) belongs with the code that has a
 * provider in its hand.
 */
export async function authoriseWithK256(
  signer: K256Signer,
  challenge: Uint8Array,
  useCounter: bigint,
): Promise<K256Authorisation> {
  const digest = await envelopeDigest(signer.envelope, challenge);
  const sig = await signer.signDigest(digest);
  assertCanonicalSignature(sig);
  return {
    arm: 'k256',
    pk: signer.pk,
    use_counter: useCounter,
    sig,
    envelope: signer.envelope,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing what an EVM signer hands back
// ─────────────────────────────────────────────────────────────────────────────

/** The secp256k1 group order `n`. */
export const SECP256K1_N = BigInt(
  '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141',
);

/** A parsed `0x` + r‖s‖v signature, recovery byte included. */
export interface EvmSignature {
  readonly r: bigint;
  readonly s: bigint;
  /** The recovery parameter, normalised to 0 or 1. */
  readonly v: number;
}

const HEX_65_BYTES = /^(?:0x)?[0-9a-fA-F]{130}$/;

/**
 * Parse the 65-byte `r‖s‖v` an EVM signer returns.
 *
 * The recovery byte is kept, not discarded, because it is how the public point
 * gets recovered at enrolment from a signature over a known digest — the only
 * route to a `pk` when the signer exports no key. It arrives as 27/28 from most
 * Ethereum tooling and as 0/1 from some; both are normalised to 0/1 here so a
 * caller never has to ask which dialect it got.
 *
 * `r` and `s` are checked to be in `[1, n)`. That is not the same as rejecting
 * high-S: the contract deliberately accepts both S forms, because real P-256
 * authenticators emit high-S and the arm this one stands in for must accept
 * them. A malleated twin cannot replay — the device entry it authorised is
 * consumed on execution and `auth_nonce` advances — so there is nothing for a
 * low-S rule to buy here, and imposing one would reject valid signatures.
 */
export function parseEvmSignature(value: string): EvmSignature {
  if (!HEX_65_BYTES.test(value)) {
    throw new Error('EVM signature must be 65 bytes of hex (r‖s‖v)');
  }
  const hex = (value.startsWith('0x') ? value.slice(2) : value).toLowerCase();
  const r = BigInt(`0x${hex.slice(0, 64)}`);
  const s = BigInt(`0x${hex.slice(64, 128)}`);
  const vRaw = Number.parseInt(hex.slice(128, 130), 16);
  const v = vRaw >= 27 ? vRaw - 27 : vRaw;
  if (v !== 0 && v !== 1) {
    throw new Error(`EVM signature recovery byte out of range: ${vRaw}`);
  }
  assertCanonicalSignature({ r, s });
  return { r, s, v };
}

/**
 * Reject a signature scalar outside `[1, n)`.
 *
 * Zero or out-of-range scalars are not a hostile-input worry so much as a
 * wrong-encoding worry: a signer that returned big-endian where we expected
 * little-endian, or 64 bytes where we expected 65, tends to show up here first
 * and the message is what tells the difference.
 */
export function assertCanonicalSignature(sig: EcdsaSignature): void {
  if (sig.r <= 0n || sig.r >= SECP256K1_N) {
    throw new Error('ECDSA r is not in [1, n)');
  }
  if (sig.s <= 0n || sig.s >= SECP256K1_N) {
    throw new Error('ECDSA s is not in [1, n)');
  }
}

/**
 * The uncompressed SEC1 encoding (`0x04 ‖ X ‖ Y`) of a point, which is what a
 * curve library wants when it is handed a key that came from an ABI.
 *
 * The identity has no SEC1 encoding and the contract rejects small-order device
 * keys anyway — both schemes degenerate at the curve identity, so an identity
 * key would authorise with no secret — so it fails here rather than producing
 * 65 bytes of zeroes that some library might accept.
 */
export function pointToUncompressed(point: CurvePoint): Uint8Array {
  if (point.identity) {
    throw new Error('the curve identity is not a usable device key');
  }
  const out = new Uint8Array(65);
  out[0] = 0x04;
  out.set(scalarToBytesBE(point.x), 1);
  out.set(scalarToBytesBE(point.y), 33);
  return out;
}

/** A point from a curve library's uncompressed SEC1 bytes. */
export function pointFromUncompressed(bytes: Uint8Array): CurvePoint {
  if (bytes.length !== 65 || bytes[0] !== 0x04) {
    throw new Error('expected 65 bytes of uncompressed SEC1 (0x04 ‖ X ‖ Y)');
  }
  return {
    x: bytesToBigIntBE(bytes.subarray(1, 33)),
    y: bytesToBigIntBE(bytes.subarray(33, 65)),
    identity: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Byte and scalar plumbing
// ─────────────────────────────────────────────────────────────────────────────
//
// Restated here rather than imported from `contractRuntime.ts`, which exports
// the same two conversions. That module is the provider stack — wallet SDK,
// indexer client, proof provider — and importing it for a hex loop would make
// this module untestable without a browser and would drag all of it onto any
// entry graph that touched a signature. Ten lines of duplication is the cheaper
// of the two, and the design doc records the choice.

/** Lower-case hex, no `0x`. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** Big-endian 32-byte encoding of a scalar — the curve-library key format. */
export function scalarToBytesBE(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let rest = value;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

/** The big-endian integer a byte run encodes. */
export function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let out = 0n;
  for (const byte of bytes) out = (out << 8n) | BigInt(byte);
  return out;
}

/** Constant-shape byte comparison. Not constant-TIME: nothing here is secret. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
