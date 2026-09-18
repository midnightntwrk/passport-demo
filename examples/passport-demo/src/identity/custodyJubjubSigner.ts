/**
 * The JubJub (MIP-0013 §5) half of the custody signing boundary — the arm a
 * Passport made by a PASSKEY authorises on.
 *
 * WHY THIS EXISTS (2026/09/18)
 * ----------------------------
 * `custodyContractSigning.ts` said, at the bottom of its header, what was not
 * yet here: "the JubJub signing side … needs the per-circuit challenge builder
 * in its hand". This is that side. It exists so a Passport created by a passkey
 * can live on the same account custody contract as the Dynamic (secp256k1)
 * Passport does, use the same one-transaction sends, and never touch the app's
 * internal wallet.
 *
 * The two arms share ONE device set. A passkey deploys and activates on
 * `jubjub`; a Dynamic key enrols later on `k256` through `add_device`, which
 * takes a derived 32-byte ENTRY and so never learns which curve produced it.
 * Nothing in this file knows about Dynamic and nothing in the k256 file knows
 * about passkeys.
 *
 * THE RULES IT INHERITS FROM ITS NEIGHBOUR, UNCHANGED
 * ---------------------------------------------------
 * 1. THE PURE CIRCUITS ARE INJECTED, NEVER IMPORTED. Every derivation takes a
 *    {@link CustodyPureCircuits}. The compiled `account-custody` build is ~100 MB
 *    of prover keys, staged by a script and gitignored; a static import would
 *    put a contract build on the entry graph and make this module unloadable in
 *    a unit test.
 * 2. NO CURVE LIBRARY. The public point is `compute_public_point_with_jubjub`,
 *    the contract's own arithmetic, so wallet and circuit cannot disagree about
 *    what key was enrolled. `@noble/curves`'s jubjub is a TEST dependency of
 *    this workspace and is not declared for `src`; nothing here needs it, and
 *    the only point arithmetic outside the circuit — the `s·G == R + c·pk`
 *    cross-check — lives in `custodyJubjubSigner.test.ts`, where the runtime's
 *    own `ecMulGenerator`/`ecAdd`/`ecMul` do it.
 * 3. NOTHING WITH A SOCKET ON IT. No provider, no proving, no submission, no
 *    storage. `custodyContractClient.ts` has those.
 *
 * AND ONE THING THAT IS TRUE OF THE WHOLE ARM: THERE IS NO IN-BROWSER PROVER
 * FOR ZKIR v3. Every account-custody proof goes to the droplet's proof server —
 * directly through `/prover-v3` for the small keys, and through the sponsor's
 * own proving route for the big ones. Signing is what happens locally; proving
 * is not, on either arm, and nothing here should be read as saying otherwise.
 *
 * THE DEVICE KEY IS DERIVED FROM THE PASSKEY, AND THAT IS A CHOICE
 * ---------------------------------------------------------------
 * Nicolas's reference signer says of both arms: "keys are never derived from
 * one another or from a seed (AUTH-7)", and `JubjubDevice.generate()` samples
 * a fresh scalar from the system CSPRNG. THIS MODULE DOES NOT DO THAT, and the
 * reason is recovery by name.
 *
 * A Passport is a passkey and a `.night` name. A reader who reinstalls the PWA,
 * or opens it on a second phone, has their passkey and nothing else: no local
 * storage, no backup file, no seed phrase. If the device scalar were random it
 * would live only in that browser's storage, and a cleared origin would be an
 * account with a device set nobody can sign for — the contract's own rolling
 * entries would still be there, and unusable for ever. Deriving the scalar from
 * the passkey's PRF output makes the passkey the ONLY thing that has to
 * survive, which is exactly what `derivePassportContractSecrets` already does
 * for the existing account contract's device and recovery secrets (see
 * `passportContract.ts`) and for the Midnames owner key.
 *
 * WHAT IT COSTS, SAID PLAINLY. A passkey compromise is a device-key
 * compromise: an attacker who can complete a WebAuthn assertion with the PRF
 * extension recovers the contract root, and from it this scalar and the
 * account's viewing secret — so they can both spend and READ the whole inbox
 * history, where a random key would have cost them only what they could steal
 * from that moment on. The passkey is hardware-bound and user-verified, so that
 * is the same trust boundary the rest of the Passport already sits behind; it
 * is not a NEW exposure, but it is a WIDER one, and it is a question for
 * Nicolas (see the questions list in the delivery note) because AUTH-7 is his
 * invariant, not ours.
 *
 * ONE PASSKEY CREDENTIAL, ONE DEVICE KEY
 * --------------------------------------
 * Nicolas's second rule (2026/09/18): "a second physical passkey enrols through
 * `add_device` rather than re-deriving". The scalar below is derived from the
 * PRF output of THIS CREDENTIAL, so it is per credential and not per person.
 * There is no cross-credential derivation anywhere in this module and there must
 * not be one: a second phone's passkey is a different credential with a
 * different PRF output, and the contract already has the right answer for it —
 * the first device signs `add_device_with_jubjub` over the second device's
 * derived ENTRY, which is 32 opaque bytes and carries no curve and no key.
 *
 * TODO(passkey-arm, add-device flow): the "add this device" screen and the
 * `add_device_with_jubjub` call that backs it. `jubjubChallenges.addDevice` and
 * `enrolmentEntry` are the two pieces it needs and both are here; what is not
 * here is the pairing surface that gets the new credential's public point to
 * the old device. It is its own PR.
 *
 * THE DERIVATION, EXACTLY
 * -----------------------
 * Nicolas's first rule (2026/09/18): "derive the scalar by expand-and-reject
 * below r_J, not a bare reduction", under a label distinct from the enc
 * secret's and from the prototype's `.dev`/`.rec`.
 *
 *   expand:  block(i) = SHA-256(label32 ‖ root32 ‖ u32be(i))  for i = 0, 1, 2, …
 *   read:    v(i)     = the BIG-ENDIAN integer of block(i)
 *   reject:  take the first v(i) with 0 < v(i) < r_J; otherwise try i + 1
 *
 * with `label32` the ASCII of {@link JUBJUB_DEVICE_LABEL} zero-padded to 32
 * bytes — the shape `derivePassportContractSecrets` and `deriveMidnamesOwnerKey`
 * already use — `u32be(i)` the counter in FOUR big-endian bytes, and `r_J` the
 * JubJub prime-order subgroup order. That is counter-mode expansion of an
 * already-HKDF-extracted root: the passkey's PRF output is stretched into the
 * 32-byte contract root upstream, and the counter is what turns a single
 * 32-byte block into an unbounded stream so rejection has somewhere to go.
 *
 * THE COUNTER IS FOUR BYTES BECAUSE ONE BYTE IS NOT A STREAM. It was one byte
 * until 2026/09/18 — `payload[64] = counter` into a `Uint8Array`, which stores
 * the counter MOD 256 and says nothing about it. Block 256 was block 0 again,
 * the “unbounded stream” was 256 blocks repeating for ever, and a passkey
 * whose root missed on all 256 of them could never make a Passport: not on a
 * retry, not on another phone, not ever, because the derivation is a pure
 * function of that credential. At one acceptance in ~17.7 that is one passkey
 * in three million rather than none — {@link JUBJUB_REJECTION_ATTEMPTS} has the
 * arithmetic, which is also where the bound of 256 came from.
 *
 * WIDENING THE COUNTER CHANGED EVERY DERIVED KEY, and it was done on
 * 2026/09/18, BEFORE ANY PASSKEY ACCOUNT EXISTED. No passkey Passport had been
 * deployed, so no device key, no account, and no sealed inbox anywhere depends
 * on the old rule. The one artefact that does is the stagenet run written up in
 * `scratchpad/jj-stagenet/RESULT.md`: the scalar recorded there, `030d8410…`,
 * is the ONE-BYTE-counter answer for that root and is not what this file
 * derives now. That run proved the ARM — that a derived JubJub key deploys,
 * activates, and has a gated call verified on-node — and the arm is not changed
 * by the width of a counter. From the first live passkey account onwards this
 * payload is frozen: changing it again is an account whose device nobody can
 * sign for.
 *
 * NEVER `mod r_J`. That is the whole of the rule and it is not a style
 * preference. `r_J` is a shade over 2^251 while a block is 2^256 wide, so a
 * bare reduction folds the top of the range onto the bottom and makes the low
 * ~2^251 of the scalar space roughly twice as likely as the rest — a bias the
 * reference's own `randomJubjubScalar` does not have, because its rule is "draw
 * 32 bytes, read them as an integer, keep it ONLY if it is in `[1, r_J)`". This
 * is that rule with a counter in place of the CSPRNG, so the distribution is
 * the reference's and only the source of entropy differs. Acceptance is
 * `r_J / 2^256 ≈ 0.0566`, about one draw in 17.7, and the bound is
 * {@link JUBJUB_REJECTION_ATTEMPTS}. `custodyJubjubSigner.test.ts` drills it on
 * a root that is REJECTED thirteen times over, and asserts the answer is
 * neither the reduction of a rejected block nor the block the one-byte counter
 * would have stopped at — so "expand and reject", "reduce", and the old
 * payload cannot be confused for one another by anybody reading the diff.
 *
 * The 68-byte payload also domain-separates this label from the 64-byte
 * payloads `derivePassportContractSecrets` hashes, so even an identical label
 * could not collide with the device, recovery, viewing, or maintenance secret.
 *
 * THE SIGNATURE, EXACTLY AS THE REFERENCE MAKES IT
 * ------------------------------------------------
 * Arm `jubjub` (MIP-0013 §5), from `contract/src/wallet/signer.ts`:
 *
 *   1. sample a nonce scalar `r` uniformly from `[1, r_J)`
 *   2. `R = r·G`, through the contract's own `compute_public_point_with_jubjub`
 *   3. GRIND: `h = challenge(R, grind_nonce)` for `grind_nonce = 0, 1, 2, …`
 *      until the LITTLE-ENDIAN integer value of `h` is strictly below `r_J`;
 *      that value is `c`
 *   4. `s = r + c·sk mod r_J`
 *   5. emit `(pk, use_counter, R, s, grind_nonce)`
 *
 * TWO ENDIANNESSES, AND THEY ARE NOT INTERCHANGEABLE. The scalar derivation
 * above reads its hash BIG-endian because that is what `randomJubjubScalar`
 * does with its bytes (`BigInt('0x' + hex)`); the grind reads the challenge
 * LITTLE-endian because that is how the circuit casts a `Field` to a
 * `JubjubScalar`. Swapping either one produces a signature that verifies
 * nowhere, and the live run is what proves neither has been swapped.
 *
 * THE NONCE IS THE ONE THING HERE THAT IS NOT DERIVED, and it must stay that
 * way. Schnorr reveals the secret to anyone who sees two signatures made under
 * one nonce: `sk = (s₁ - s₂)/(c₁ - c₂)`. A deterministic nonce would have to be
 * a function of the message, and the message here is a challenge the signer
 * grinds — so two calls that happened to agree on a preimage would reuse it.
 * {@link jubjubDeviceSigner} takes its randomness from an injected
 * `randomBytes`, defaulting to `crypto.getRandomValues`.
 */

import {
  type ContractAddressArg,
  type CurvePoint,
  type CustodyPureCircuits,
  type JubjubAuthorisation,
  type JubjubChallengeBuilder,
  type JubjubDeviceIdentity,
} from './custodyContractSigning.js';

/* -------------------------------------------------------------------------- */
/* The subgroup                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The order of the JubJub prime-order subgroup, `r_J` (MIP-0013 §2).
 *
 * Restated rather than imported from `@midnight-ntwrk/compact-runtime`'s
 * `JUBJUB_SCALAR_MODULUS`, for the same reason `CurvePoint` is restated next
 * door: that package is a ledger-9 WASM bundle, and a pure-arithmetic module
 * that pulls it in is a pure module only on paper. The two are asserted equal
 * in `custodyJubjubSigner.test.ts`, so the restatement cannot drift.
 */
export const JUBJUB_R = BigInt(
  '0x0e7db4ea6533afa906673b0101343b00a6682093ccc81082d0970e5ed6f72cb7',
);

/** The derivation label for the passkey's JubJub device scalar. */
export const JUBJUB_DEVICE_LABEL = 'midnight.passport.jj';

/**
 * How many draws each of the three rejection loops in this file makes before
 * giving up: the scalar derivation, the nonce sampler, and the grind.
 *
 * THE ARITHMETIC, WRITTEN OUT, BECAUSE THE SENTENCE THAT WAS HERE HAD IT WRONG
 * IN BOTH DIRECTIONS. All three loops keep a 32-byte value only when it reads
 * below `r_J`, and `r_J` is a shade over 2^251 against a range 2^256 wide, so
 * one draw in `2^256 / r_J ≈ 17.7` is accepted: `p ≈ 0.0566`, not the “1 in
 * 16” that was written next door, and ~17.7 expected draws rather than ~16.
 *
 * The bound was 256, and the comment beside it called reaching 32 draws a
 * “one-in-10^37 event”. Thirty-two draws all miss with probability
 * `(1 - p)^32 ≈ 0.15` — about one derivation in six gets that far, on ordinary
 * roots, every day. Two hundred and fifty-six all miss with probability
 * `(1 - p)^256 ≈ 3.3 × 10^-7`: one passkey in three million, which is not a
 * number to stake “this reader can never make a Passport” on. At 1024 it is
 * `(1 - p)^1024 ≈ 1.2 × 10^-26`, which is the “does not happen” the old
 * sentence was claiming.
 *
 * A generous bound costs nothing — it is reached only once every draw before
 * it has already failed — and what it buys is that the give-up path stays a
 * real sentence for a caller who hands in something pathological, rather than
 * a spinning tab.
 */
export const JUBJUB_REJECTION_ATTEMPTS = 1024;

/* -------------------------------------------------------------------------- */
/* Scalars                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The LITTLE-endian integer a byte run encodes.
 *
 * This is the reading the circuit applies when it casts the challenge `Field`
 * to a `JubjubScalar`, and therefore the reading the grind loop has to test
 * against `r_J`. Its big-endian twin lives next door as `bytesToBigIntBE` and
 * is used for the scalar derivation; they are different functions on purpose.
 */
export function bytesToBigIntLE(bytes: Uint8Array): bigint {
  let out = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) out = (out << 8n) | BigInt(bytes[i]);
  return out;
}

/** Whether a scalar is a usable JubJub secret or nonce: strictly in `[1, r_J)`. */
export function isJubjubScalar(value: bigint): boolean {
  return value > 0n && value < JUBJUB_R;
}

/**
 * A uniform scalar in `[1, r_J)` by rejection — the reference's
 * `randomJubjubScalar`, with the source of bytes injected.
 *
 * Injected rather than reaching for `crypto.getRandomValues` directly so a
 * drill can pin the nonce and assert the exact `(R, s)` a known key produces.
 * Nothing in the app passes anything but the real CSPRNG.
 */
export function randomJubjubScalar(randomBytes: (length: number) => Uint8Array): bigint {
  for (let attempt = 0; attempt < JUBJUB_REJECTION_ATTEMPTS; attempt++) {
    const candidate = bytesToBigIntBE(randomBytes(32));
    if (isJubjubScalar(candidate)) return candidate;
  }
  throw new Error(
    `Could not sample a JubJub nonce below the subgroup order in ${JUBJUB_REJECTION_ATTEMPTS} draws.`,
  );
}

/** The big-endian integer a byte run encodes. */
function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let out = 0n;
  for (const byte of bytes) out = (out << 8n) | BigInt(byte);
  return out;
}

/**
 * The 32-byte big-endian encoding of a scalar.
 *
 * Exported because a harness that wants to hand the same key to the reference
 * implementation needs it in the reference's format, and because a derived
 * scalar is worth being able to print in a fixture.
 */
export function jubjubScalarToBytes(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let rest = value;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Derivation from the passkey                                                */
/* -------------------------------------------------------------------------- */

/**
 * The label's bytes, encoded once.
 *
 * There is no "label too long" check below, and that is deliberate: a label
 * wider than its 32-byte field makes `payload.set` throw a `RangeError` on the
 * spot, so the failure is real rather than a branch no test can reach.
 * `custodyJubjubSigner.test.ts` asserts the constant fits.
 */
const LABEL_BYTES = new TextEncoder().encode(JUBJUB_DEVICE_LABEL);

/**
 * `SHA-256(label padded to 32 bytes ‖ root ‖ counter in four big-endian bytes)`.
 *
 * The same shape as `derivePassportContractSecrets` and `deriveMidnamesOwnerKey`,
 * plus the four counter bytes that make rejection sampling possible. Async
 * because WebCrypto is.
 */
async function derivationHash(root: Uint8Array, counter: number): Promise<Uint8Array> {
  const payload = new Uint8Array(68);
  payload.set(LABEL_BYTES, 0);
  payload.set(root, 32);
  /* FOUR BYTES, BIG-ENDIAN, AND NOT `payload[64] = counter`. One byte takes the
     counter mod 256 in silence, which made block 256 block 0 again and put a
     ceiling on a stream that is supposed to have none; the header says what
     that cost. `setUint32`'s third argument is `littleEndian`, and it is false
     here because the block this payload produces is read big-endian too. */
  new DataView(payload.buffer).setUint32(64, counter, false);
  const digest = await crypto.subtle.digest('SHA-256', payload);
  return new Uint8Array(digest);
}

/**
 * The passkey's JubJub device scalar: the first derivation hash that lands in
 * `[1, r_J)`, read big-endian.
 *
 * `contractRoot` is the 32-byte contract root the passkey's PRF output is
 * already stretched into — the SAME input `derivePassportContractSecrets` takes
 * — so a Passport asks its authenticator once and gets its device secret, its
 * recovery secret, this scalar, and its viewing secret out of the one assertion.
 * That is the one-prompt-per-action rule, not an optimisation.
 */
export async function deriveJubjubDeviceScalar(
  contractRoot: Uint8Array,
  /* A parameter rather than a constant so the give-up path is drillable: at
     ~1-in-16 acceptance the default bound is never reached, and a `throw` no
     test can reach is a `throw` nobody has read. */
  attempts: number = JUBJUB_REJECTION_ATTEMPTS,
): Promise<bigint> {
  if (contractRoot.length !== 32) {
    throw new Error(
      `The Passport contract root secret must be 32 bytes, received ${contractRoot.length}.`,
    );
  }
  for (let counter = 0; counter < attempts; counter++) {
    const candidate = bytesToBigIntBE(await derivationHash(contractRoot, counter));
    if (isJubjubScalar(candidate)) return candidate;
  }
  /* THE ONE SENTENCE HERE A PERSON CAN REACH. It is on the onboarding path:
     somebody has just been asked for their passkey and this is what they would
     be shown. So it says what happened to them and what to do about it, in the
     house style and without a word from the on-screen vocabulary list — and it
     does not say “try again” on its own, because the derivation is a pure
     function of the credential and the same passkey gives the same answer for
     ever. A different passkey is the only thing that helps.
     At ~1.2 x 10^-26 nobody will read it; that is not a reason for it to be a
     fragment of somebody's debugging. */
  throw new Error('This passkey cannot be used to make a Passport. Try again with a new passkey.');
}

/* -------------------------------------------------------------------------- */
/* The public point, the entry, the boot commitment                           */
/* -------------------------------------------------------------------------- */

/**
 * `pk = sk·G`, through the contract's own circuit.
 *
 * `identity: false` is added because the generated JubJub ABI carries only `x`
 * and `y` — the curve's neutral element is a representable point, not a flag —
 * while {@link CurvePoint} is the shape BOTH arms share and secp256k1 needs the
 * flag. The extra property is inert: the circuits read `x` and `y`, and
 * `custodyJubjubSigner.test.ts` asserts a derivation is identical with and
 * without it. It is never `true` here: `sk` is in `[1, r_J)` and `G` generates
 * a prime-order subgroup, so `sk·G` is never the neutral element.
 */
export function jubjubPublicPoint(pure: CustodyPureCircuits, secretScalar: bigint): CurvePoint {
  if (!isJubjubScalar(secretScalar)) {
    throw new Error('A JubJub device scalar must be in [1, r_J).');
  }
  const point = pure.compute_public_point_with_jubjub(secretScalar);
  return { x: point.x, y: point.y, identity: false };
}

/**
 * The passkey's device, as the rest of the custody layer identifies one.
 *
 * A {@link JubjubDeviceIdentity} is all `deviceEntry`, `bootCommitment`, and
 * `enrolmentEntry` need — there is no envelope on this arm, because there is no
 * vendor wrapping the bytes before they are signed.
 */
export function jubjubDeviceIdentity(
  pure: CustodyPureCircuits,
  secretScalar: bigint,
): JubjubDeviceIdentity {
  return { arm: 'jubjub', pk: jubjubPublicPoint(pure, secretScalar) };
}

/* -------------------------------------------------------------------------- */
/* Signing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A JubJub device that can authorise one gated call.
 *
 * It is a {@link JubjubDeviceIdentity} with a `sign`, so anything that only
 * needs to know WHICH device this is — the entry derivation, the roster scan,
 * the activation — takes it without knowing it can sign. Synchronous, unlike
 * the k256 signer: the secret is in hand and the grind is arithmetic, so there
 * is no vendor round trip to await.
 */
export interface JubjubSigner extends JubjubDeviceIdentity {
  /**
   * Grind and sign one challenge.
   *
   * `challenge` is the per-circuit builder — the contract's own pure circuit,
   * closed over the account, the call's arguments, and the observed
   * `auth_nonce`. The signer varies only `grind_nonce`, which is why the
   * builder takes `(sig_r, grind_nonce)` and nothing else.
   */
  sign(challenge: JubjubChallengeBuilder, useCounter: bigint): JubjubAuthorisation;
}

/**
 * The grind loop, on its own so a drill can watch it.
 *
 * Returns the challenge value `c` — the little-endian reading of the first hash
 * that lands below `r_J` — and the `grind_nonce` that produced it. ~17.7
 * expected attempts (MIP-0013 §5.2 rounds it to 17.5), and the bound is
 * {@link JUBJUB_REJECTION_ATTEMPTS}, which a builder that really is the
 * contract's misses with probability ~1.2 × 10^-26 — so reaching it means the
 * challenge builder is not the contract's.
 */
export function grindJubjubChallenge(
  challenge: JubjubChallengeBuilder,
  sigR: CurvePoint,
): { readonly c: bigint; readonly grindNonce: bigint } {
  for (let grindNonce = 0n; grindNonce < BigInt(JUBJUB_REJECTION_ATTEMPTS); grindNonce++) {
    const value = bytesToBigIntLE(challenge(sigR, grindNonce));
    if (value < JUBJUB_R) return { c: value, grindNonce };
  }
  throw new Error(
    `Could not grind a JubJub challenge below the subgroup order in ${JUBJUB_REJECTION_ATTEMPTS} tries.`,
  );
}

/**
 * Wrap a derived scalar as a signer.
 *
 * The secret stays closed over: the returned object exposes the point and a
 * `sign`, and there is no accessor for `sk` — the same discipline
 * {@link K256Signer} keeps for a key it could not export even if it wanted to.
 */
export function jubjubDeviceSigner(options: {
  readonly pure: CustodyPureCircuits;
  readonly secretScalar: bigint;
  /** Injected so a drill can pin the nonce. Defaults to the platform CSPRNG. */
  readonly randomBytes?: (length: number) => Uint8Array;
}): JubjubSigner {
  const { pure, secretScalar } = options;
  const pk = jubjubPublicPoint(pure, secretScalar);
  const randomBytes =
    options.randomBytes ?? ((length: number) => crypto.getRandomValues(new Uint8Array(length)));
  return {
    arm: 'jubjub',
    pk,
    sign(challenge: JubjubChallengeBuilder, useCounter: bigint): JubjubAuthorisation {
      const nonce = randomJubjubScalar(randomBytes);
      const sigR = jubjubPublicPoint(pure, nonce);
      const { c, grindNonce } = grindJubjubChallenge(challenge, sigR);
      /* s = r + c·sk mod r_J. Both factors are reduced before multiplying, as
         the reference does — they are already in range, but a scalar that
         arrived from somewhere else must not be able to make `s` wrap twice. */
      const s = (nonce + ((c % JUBJUB_R) * (secretScalar % JUBJUB_R)) % JUBJUB_R) % JUBJUB_R;
      return {
        arm: 'jubjub',
        pk,
        use_counter: useCounter,
        sig_r: sigR,
        sig_s: s,
        grind_nonce: grindNonce,
      };
    },
  };
}

/**
 * A signer for the passkey behind a Passport: one derivation, one device.
 *
 * The whole passkey arm in one call — the app has a contract root and wants a
 * thing that can authorise, and the steps between are this module's business.
 */
export async function passkeyJubjubSigner(options: {
  readonly pure: CustodyPureCircuits;
  readonly contractRoot: Uint8Array;
  readonly randomBytes?: (length: number) => Uint8Array;
}): Promise<JubjubSigner> {
  return jubjubDeviceSigner({
    pure: options.pure,
    secretScalar: await deriveJubjubDeviceScalar(options.contractRoot),
    randomBytes: options.randomBytes,
  });
}

/**
 * The account address a challenge binds to, in the wrapper the ABI takes.
 *
 * Exported for a harness that builds a challenge by hand against the compiled
 * module rather than through `jubjubChallenges`.
 */
export function jubjubAddressArg(contractAddress: Uint8Array): ContractAddressArg {
  return { bytes: contractAddress };
}
