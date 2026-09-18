/**
 * Drills for the passkey (jubjub) arm of the custody signing boundary.
 *
 * FOUR THINGS ARE HELD HERE, AND THREE OF THEM ARE HELD AGAINST SOMETHING
 * OTHER THAN THIS MODULE'S OWN OPINION.
 *
 * 1. THE COMPILED CONTRACT. `derive_device_entry_with_jubjub`,
 *    `derive_boot_commitment_with_jubjub`, `compute_public_point_with_jubjub`,
 *    and all seven `challenge_*_with_jubjub` circuits are loaded from the real
 *    `account-custody` build and called directly, in the argument order the
 *    generated `index.d.ts` declares, and compared with what this layer
 *    produces. Argument order is where a hand-written wrapper around a
 *    generated ABI actually goes wrong, and a fake cannot catch it.
 *
 * 2. THE REFERENCE SIGNER. `scratchpad/nicolas-ref/contract/src/wallet/signer.ts`
 *    is the normative implementation. Its rule — sample `r`, `R = r·G`, grind
 *    `grind_nonce` until the LITTLE-endian reading of the challenge hash is
 *    below `r_J`, `s = r + c·sk mod r_J` — is re-implemented here, in full, in
 *    {@link referenceJubjubSign}, and asserted to produce the identical
 *    `(R, s, grind_nonce)` for the same key, the same challenge, and the same
 *    nonce. Re-implemented rather than imported because that file imports the
 *    reference client's own compiled contract module, which is a different
 *    build of a different tree; copying nothing into `src` is the rule, and
 *    copying the RULE into a test is how the rule gets checked.
 *
 * 3. THE CURVE. `s·G == R + c·pk` is verified with the runtime's own
 *    `ecMulGenerator`/`ecAdd`/`ecMul`, which is the equation the circuit
 *    checks. A signature that satisfies it and a signature the contract accepts
 *    are the same thing, so this is the offline half of the stagenet run.
 *
 * 4. THE SUBGROUP ORDER. {@link JUBJUB_R} is restated in `src` rather than
 *    imported from the WASM runtime; it is asserted equal to the runtime's
 *    `JUBJUB_SCALAR_MODULUS` here so the restatement cannot drift.
 *
 * `@midnight-ntwrk/compact-runtime` and the compiled contract are loaded
 * through `createRequire`, the way `accountCustody.test.ts` does it: by NODE,
 * from the contract's own directory, so the contract and the runtime it is
 * asked to decode against are resolved by one resolver and cannot be two
 * copies.
 */

import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import {
  jubjubChallenges,
  bootCommitment,
  deviceEntry,
  enrolmentEntry,
  authArgs,
  type CurvePoint,
  type CustodyPureCircuits,
  type JubjubChallengeBuilder,
  type QualifiedCoin,
} from './custodyContractSigning.js';
import {
  JUBJUB_DEVICE_LABEL,
  JUBJUB_R,
  bytesToBigIntLE,
  deriveJubjubDeviceScalar,
  grindJubjubChallenge,
  isJubjubScalar,
  jubjubAddressArg,
  jubjubDeviceIdentity,
  jubjubDeviceSigner,
  jubjubPublicPoint,
  jubjubScalarToBytes,
  passkeyJubjubSigner,
  randomJubjubScalar,
} from './custodyJubjubSigner.js';

/* -------------------------------------------------------------------------- */
/* The real build                                                             */
/* -------------------------------------------------------------------------- */

interface JubjubPoint {
  readonly x: bigint;
  readonly y: bigint;
}

interface FixtureRuntime {
  JUBJUB_SCALAR_MODULUS: bigint;
  ecAdd(a: JubjubPoint, b: JubjubPoint): JubjubPoint;
  ecMul(a: JubjubPoint, b: bigint): JubjubPoint;
  ecMulGenerator(b: bigint): JubjubPoint;
}

const requireFromTest = createRequire(import.meta.url);
const contractPath = requireFromTest.resolve(
  '../../contracts/stagenet/account-custody/contract/index.js',
);
const compiled = requireFromTest(contractPath) as { pureCircuits: CustodyPureCircuits };
const runtime = createRequire(contractPath)('@midnight-ntwrk/compact-runtime') as FixtureRuntime;

/** The real `pureCircuits`, which satisfies {@link CustodyPureCircuits} structurally. */
const pure: CustodyPureCircuits = compiled.pureCircuits;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** A fixed stand-in for the 32 bytes a passkey's PRF output is stretched into. */
const ROOT = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 11) & 0xff);

const ADDRESS = new Uint8Array(32).fill(3);
const AUTH_NONCE = 41n;
const CONTEXT = { contractAddress: ADDRESS, authNonce: AUTH_NONCE };
const COLOUR = new Uint8Array(32).fill(2);
const RECIPIENT = new Uint8Array(32).fill(9);
const ENTRY = new Uint8Array(32).fill(4);
const INBOX_ENTRY = new Uint8Array(192).fill(6);
const NEW_KEY = new Uint8Array(32).fill(8);
const COIN: QualifiedCoin = {
  nonce: new Uint8Array(32).fill(1),
  color: COLOUR,
  value: 500n,
  mt_index: 3n,
};

const addr = { bytes: ADDRESS };

/** A counting stand-in for a CSPRNG: hands back a pinned sequence of scalars. */
function scalarSource(...values: bigint[]): (length: number) => Uint8Array {
  let index = 0;
  return (length: number) => {
    expect(length).toBe(32);
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return jubjubScalarToBytes(value);
  };
}

/* -------------------------------------------------------------------------- */
/* The reference signer's rule, re-implemented                                */
/* -------------------------------------------------------------------------- */

/**
 * `scratchpad/nicolas-ref/contract/src/wallet/signer.ts`'s `JubjubDevice.sign`,
 * written out here with the nonce supplied rather than sampled.
 *
 * Deliberately NOT factored against the module under test: it computes `R`,
 * the grind, and `s` from first principles so that agreeing with it is
 * evidence rather than tautology.
 */
function referenceJubjubSign(
  sk: bigint,
  nonce: bigint,
  challenge: JubjubChallengeBuilder,
): { sigR: JubjubPoint; s: bigint; grindNonce: bigint } {
  const sigR = pure.compute_public_point_with_jubjub(nonce);
  let grindNonce = 0n;
  let c = 0n;
  for (;;) {
    const hash = challenge(sigR as CurvePoint, grindNonce);
    /* The reference's `bytesToBigIntLE`, written out. */
    let value = 0n;
    for (let i = hash.length - 1; i >= 0; i--) value = (value << 8n) | BigInt(hash[i]);
    if (value < JUBJUB_R) {
      c = value;
      break;
    }
    grindNonce += 1n;
  }
  const s = (nonce + ((c % JUBJUB_R) * (sk % JUBJUB_R)) % JUBJUB_R) % JUBJUB_R;
  return { sigR, s, grindNonce };
}

/** The circuit's own verification equation: `s·G == R + c·pk`. */
function schnorrVerifies(
  pk: JubjubPoint,
  sigR: JubjubPoint,
  s: bigint,
  c: bigint,
): boolean {
  const left = runtime.ecMulGenerator(s);
  const right = runtime.ecAdd(sigR, runtime.ecMul(pk, c));
  return left.x === right.x && left.y === right.y;
}

/** The challenge value the grind settled on, read the circuit's way. */
function challengeValue(challenge: JubjubChallengeBuilder, sigR: CurvePoint, grind: bigint): bigint {
  return bytesToBigIntLE(challenge(sigR, grind));
}

/* -------------------------------------------------------------------------- */

describe('the subgroup order', () => {
  it('is the runtime’s own JubJub scalar modulus', () => {
    expect(JUBJUB_R).toBe(runtime.JUBJUB_SCALAR_MODULUS);
  });

  it('accepts only scalars strictly inside [1, r_J)', () => {
    expect(isJubjubScalar(0n)).toBe(false);
    expect(isJubjubScalar(1n)).toBe(true);
    expect(isJubjubScalar(JUBJUB_R - 1n)).toBe(true);
    expect(isJubjubScalar(JUBJUB_R)).toBe(false);
  });

  it('reads bytes little-endian, the way the circuit casts a Field', () => {
    expect(bytesToBigIntLE(Uint8Array.from([1, 2]))).toBe(0x0201n);
    expect(bytesToBigIntLE(new Uint8Array(0))).toBe(0n);
  });

  it('round-trips a scalar through its 32-byte big-endian encoding', () => {
    const bytes = jubjubScalarToBytes(0x0102n);
    expect(bytes.length).toBe(32);
    expect(bytes[31]).toBe(0x02);
    expect(bytes[30]).toBe(0x01);
  });
});

describe('the derivation label', () => {
  it('fits the 32-byte field it is padded into', () => {
    expect(new TextEncoder().encode(JUBJUB_DEVICE_LABEL).length).toBeLessThanOrEqual(32);
  });

  it('is not one of the labels the other secrets use', () => {
    expect(JUBJUB_DEVICE_LABEL).toBe('midnight.passport.jj');
    expect(JUBJUB_DEVICE_LABEL).not.toBe('midnight.passport.dev');
    expect(JUBJUB_DEVICE_LABEL).not.toBe('midnight.passport.rec');
  });
});

describe('deriving the device scalar from a passkey contract root', () => {
  it('is deterministic and lands strictly inside [1, r_J)', async () => {
    const first = await deriveJubjubDeviceScalar(ROOT);
    const again = await deriveJubjubDeviceScalar(ROOT);
    expect(again).toBe(first);
    expect(isJubjubScalar(first)).toBe(true);
  });

  it('reproduces the rule written down in the header, counter and all', async () => {
    /* The rule, computed here from WebCrypto directly: the first
       SHA-256(label32 ‖ root ‖ counter) read big-endian that is in range. */
    const label = new TextEncoder().encode(JUBJUB_DEVICE_LABEL);
    let expected: bigint | null = null;
    let acceptedAt = -1;
    for (let counter = 0; counter < 256 && expected === null; counter++) {
      const payload = new Uint8Array(65);
      payload.set(label, 0);
      payload.set(ROOT, 32);
      payload[64] = counter;
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', payload));
      let value = 0n;
      for (const byte of digest) value = (value << 8n) | BigInt(byte);
      if (value > 0n && value < JUBJUB_R) {
        expected = value;
        acceptedAt = counter;
      }
    }
    expect(expected).not.toBeNull();
    expect(await deriveJubjubDeviceScalar(ROOT)).toBe(expected);
    /* Rejection really happens: this root is not accepted at counter 0, so the
       loop's reject branch is exercised by the fixture rather than asserted
       about in the abstract. */
    expect(acceptedAt).toBeGreaterThan(0);
  });

  it('gives different keys to different passkeys', async () => {
    const other = new Uint8Array(32).fill(1);
    expect(await deriveJubjubDeviceScalar(other)).not.toBe(await deriveJubjubDeviceScalar(ROOT));
  });

  it('refuses a root that is not 32 bytes', async () => {
    await expect(deriveJubjubDeviceScalar(new Uint8Array(31))).rejects.toThrow(
      'must be 32 bytes, received 31',
    );
  });

  it('gives up rather than looping for ever', async () => {
    await expect(deriveJubjubDeviceScalar(ROOT, 0)).rejects.toThrow(
      'could not derive a JubJub device scalar in range',
    );
  });
});

describe('sampling a nonce', () => {
  it('takes the first draw that is in range', () => {
    expect(randomJubjubScalar(scalarSource(7n))).toBe(7n);
  });

  it('rejects zero and anything at or above r_J', () => {
    /* `jubjubScalarToBytes` truncates to 32 bytes, so `JUBJUB_R` itself is the
       out-of-range value to feed: it encodes exactly and is rejected. */
    expect(randomJubjubScalar(scalarSource(0n, JUBJUB_R, 5n))).toBe(5n);
  });

  it('gives up rather than looping for ever', () => {
    expect(() => randomJubjubScalar(scalarSource(0n))).toThrow(
      'could not sample a JubJub scalar in range',
    );
  });
});

describe('the public point, against the contract’s own circuit', () => {
  it('is compute_public_point_with_jubjub, with the shared shape’s identity flag', async () => {
    const sk = await deriveJubjubDeviceScalar(ROOT);
    const expected = pure.compute_public_point_with_jubjub(sk);
    const point = jubjubPublicPoint(pure, sk);
    expect(point.x).toBe(expected.x);
    expect(point.y).toBe(expected.y);
    expect(point.identity).toBe(false);
  });

  it('is inert about the extra identity flag when handed back to a circuit', async () => {
    const sk = await deriveJubjubDeviceScalar(ROOT);
    const bare = pure.compute_public_point_with_jubjub(sk);
    expect(
      Array.from(pure.derive_device_entry_with_jubjub(addr, jubjubPublicPoint(pure, sk), 0n, 0n)),
    ).toEqual(Array.from(pure.derive_device_entry_with_jubjub(addr, bare as CurvePoint, 0n, 0n)));
  });

  it('refuses a scalar outside [1, r_J)', () => {
    expect(() => jubjubPublicPoint(pure, 0n)).toThrow('must be in [1, r_J)');
    expect(() => jubjubPublicPoint(pure, JUBJUB_R)).toThrow('must be in [1, r_J)');
  });
});

describe('the device as the custody layer identifies it', () => {
  it('derives its entry through derive_device_entry_with_jubjub', async () => {
    const sk = await deriveJubjubDeviceScalar(ROOT);
    const device = jubjubDeviceIdentity(pure, sk);
    expect(device.arm).toBe('jubjub');
    expect(Array.from(deviceEntry(pure, device, ADDRESS, 2n, 5n))).toEqual(
      Array.from(pure.derive_device_entry_with_jubjub(addr, device.pk, 2n, 5n)),
    );
  });

  it('enrols at the current epoch and counter zero', async () => {
    const device = jubjubDeviceIdentity(pure, await deriveJubjubDeviceScalar(ROOT));
    expect(Array.from(enrolmentEntry(pure, device, ADDRESS, 2n))).toEqual(
      Array.from(pure.derive_device_entry_with_jubjub(addr, device.pk, 2n, 0n)),
    );
  });

  it('commits to itself at deploy through derive_boot_commitment_with_jubjub', async () => {
    const device = jubjubDeviceIdentity(pure, await deriveJubjubDeviceScalar(ROOT));
    const salt = new Uint8Array(32).fill(5);
    expect(Array.from(bootCommitment(pure, device, salt))).toEqual(
      Array.from(pure.derive_boot_commitment_with_jubjub(salt, device.pk)),
    );
  });
});

describe('the challenge builders, against the compiled circuits', () => {
  const pk: CurvePoint = { x: 11n, y: 22n, identity: false };
  const sigR: CurvePoint = { x: 33n, y: 44n, identity: false };
  const GRIND = 6n;

  const same = (built: JubjubChallengeBuilder, direct: Uint8Array): void => {
    expect(Array.from(built(sigR, GRIND))).toEqual(Array.from(direct));
  };

  it('withdraw_unshielded takes (color, amount, recipient)', () => {
    same(
      jubjubChallenges.withdrawUnshielded(pure, CONTEXT, pk, COLOUR, 7n, RECIPIENT),
      pure.challenge_withdraw_unshielded_with_jubjub(
        addr, sigR, pk, COLOUR, 7n, { bytes: RECIPIENT }, AUTH_NONCE, GRIND,
      ),
    );
  });

  it('withdraw_shielded takes (recipient, color, amount, coin)', () => {
    same(
      jubjubChallenges.withdrawShielded(pure, CONTEXT, pk, RECIPIENT, COLOUR, 7n, COIN),
      pure.challenge_withdraw_shielded_with_jubjub(
        addr, sigR, pk, { bytes: RECIPIENT }, COLOUR, 7n, COIN, AUTH_NONCE, GRIND,
      ),
    );
  });

  it('withdraw_shielded_to_contract takes (recipient, color, amount, coin)', () => {
    same(
      jubjubChallenges.withdrawShieldedToContract(pure, CONTEXT, pk, RECIPIENT, COLOUR, 7n, COIN),
      pure.challenge_withdraw_shielded_to_contract_with_jubjub(
        addr, sigR, pk, { bytes: RECIPIENT }, COLOUR, 7n, COIN, AUTH_NONCE, GRIND,
      ),
    );
  });

  it('append_inbox takes (entry)', () => {
    same(
      jubjubChallenges.appendInbox(pure, CONTEXT, pk, INBOX_ENTRY),
      pure.challenge_append_inbox_with_jubjub(addr, sigR, pk, INBOX_ENTRY, AUTH_NONCE, GRIND),
    );
  });

  it('rotate_enc_key takes (new_key)', () => {
    same(
      jubjubChallenges.rotateEncKey(pure, CONTEXT, pk, NEW_KEY),
      pure.challenge_rotate_enc_key_with_jubjub(addr, sigR, pk, NEW_KEY, AUTH_NONCE, GRIND),
    );
  });

  it('add_device takes (new_entry)', () => {
    same(
      jubjubChallenges.addDevice(pure, CONTEXT, pk, ENTRY),
      pure.challenge_add_device_with_jubjub(addr, sigR, pk, ENTRY, AUTH_NONCE, GRIND),
    );
  });

  it('remove_device takes (entry)', () => {
    same(
      jubjubChallenges.removeDevice(pure, CONTEXT, pk, ENTRY),
      pure.challenge_remove_device_with_jubjub(addr, sigR, pk, ENTRY, AUTH_NONCE, GRIND),
    );
  });

  it('binds the account, the auth nonce, sig_r, and the grind nonce', () => {
    const build = (context: typeof CONTEXT): JubjubChallengeBuilder =>
      jubjubChallenges.appendInbox(pure, context, pk, INBOX_ENTRY);
    const base = Array.from(build(CONTEXT)(sigR, GRIND));
    expect(Array.from(build({ ...CONTEXT, authNonce: AUTH_NONCE + 1n })(sigR, GRIND))).not.toEqual(base);
    expect(
      Array.from(build({ ...CONTEXT, contractAddress: new Uint8Array(32).fill(4) })(sigR, GRIND)),
    ).not.toEqual(base);
    expect(Array.from(build(CONTEXT)({ x: 1n, y: 2n, identity: false }, GRIND))).not.toEqual(base);
    expect(Array.from(build(CONTEXT)(sigR, GRIND + 1n))).not.toEqual(base);
  });
});

describe('the grind', () => {
  it('stops at the first challenge that reads below the subgroup order', async () => {
    const device = jubjubDeviceIdentity(pure, await deriveJubjubDeviceScalar(ROOT));
    const builder = jubjubChallenges.appendInbox(pure, CONTEXT, device.pk, INBOX_ENTRY);
    const sigR = jubjubPublicPoint(pure, 12345n);
    const { c, grindNonce } = grindJubjubChallenge(builder, sigR);
    expect(c).toBeLessThan(JUBJUB_R);
    expect(c).toBe(challengeValue(builder, sigR, grindNonce));
    /* Every earlier nonce must have been rejected, or the loop stopped late. */
    for (let earlier = 0n; earlier < grindNonce; earlier++) {
      expect(challengeValue(builder, sigR, earlier)).toBeGreaterThanOrEqual(JUBJUB_R);
    }
  });

  it('gives up on a builder whose hash never reads below the order', () => {
    const always = (): Uint8Array => new Uint8Array(32).fill(0xff);
    expect(() => grindJubjubChallenge(always, { x: 1n, y: 2n, identity: false })).toThrow(
      'could not grind a JubJub challenge below the subgroup order',
    );
  });
});

describe('signing, against the reference rule and against the curve', () => {
  it('produces exactly what the reference signer produces for the same nonce', async () => {
    const sk = await deriveJubjubDeviceScalar(ROOT);
    const device = jubjubDeviceIdentity(pure, sk);
    const builder = jubjubChallenges.appendInbox(pure, CONTEXT, device.pk, INBOX_ENTRY);
    const nonce = 0x1234_5678_9abc_def0n;

    const ours = jubjubDeviceSigner({
      pure,
      secretScalar: sk,
      randomBytes: scalarSource(nonce),
    }).sign(builder, 3n);
    const theirs = referenceJubjubSign(sk, nonce, builder);

    expect(ours.sig_r.x).toBe(theirs.sigR.x);
    expect(ours.sig_r.y).toBe(theirs.sigR.y);
    expect(ours.sig_s).toBe(theirs.s);
    expect(ours.grind_nonce).toBe(theirs.grindNonce);
    expect(ours.use_counter).toBe(3n);
    expect(ours.arm).toBe('jubjub');
  });

  it('satisfies s·G == R + c·pk, which is what the circuit checks', async () => {
    const sk = await deriveJubjubDeviceScalar(ROOT);
    const device = jubjubDeviceIdentity(pure, sk);
    const builder = jubjubChallenges.withdrawUnshielded(
      pure, CONTEXT, device.pk, COLOUR, 7n, RECIPIENT,
    );
    const auth = jubjubDeviceSigner({ pure, secretScalar: sk }).sign(builder, 0n);
    const c = challengeValue(builder, auth.sig_r, auth.grind_nonce);
    expect(schnorrVerifies(device.pk, auth.sig_r, auth.sig_s, c)).toBe(true);
  });

  it('does not verify under another key, which is the whole point of the gate', async () => {
    const sk = await deriveJubjubDeviceScalar(ROOT);
    const other = jubjubDeviceIdentity(pure, await deriveJubjubDeviceScalar(new Uint8Array(32).fill(1)));
    const builder = jubjubChallenges.appendInbox(pure, CONTEXT, other.pk, INBOX_ENTRY);
    const auth = jubjubDeviceSigner({ pure, secretScalar: sk }).sign(builder, 0n);
    const c = challengeValue(builder, auth.sig_r, auth.grind_nonce);
    expect(schnorrVerifies(other.pk, auth.sig_r, auth.sig_s, c)).toBe(false);
  });

  it('uses a fresh nonce every time, so two signatures never share an R', async () => {
    const signer = jubjubDeviceSigner({ pure, secretScalar: await deriveJubjubDeviceScalar(ROOT) });
    const builder = jubjubChallenges.appendInbox(pure, CONTEXT, signer.pk, INBOX_ENTRY);
    const first = signer.sign(builder, 0n);
    const second = signer.sign(builder, 1n);
    expect(second.sig_r.x).not.toBe(first.sig_r.x);
  });

  it('expands to (pk, use_counter, sig_r, sig_s, grind_nonce)', async () => {
    const signer = jubjubDeviceSigner({
      pure,
      secretScalar: await deriveJubjubDeviceScalar(ROOT),
      randomBytes: scalarSource(99n),
    });
    const auth = signer.sign(jubjubChallenges.appendInbox(pure, CONTEXT, signer.pk, INBOX_ENTRY), 4n);
    expect(authArgs(auth)).toEqual([auth.pk, 4n, auth.sig_r, auth.sig_s, auth.grind_nonce]);
  });
});

describe('the passkey in one call', () => {
  it('derives, and signs with the derived key', async () => {
    const signer = await passkeyJubjubSigner({
      pure,
      contractRoot: ROOT,
      randomBytes: scalarSource(77n),
    });
    const device = jubjubDeviceIdentity(pure, await deriveJubjubDeviceScalar(ROOT));
    expect(signer.pk.x).toBe(device.pk.x);
    const builder = jubjubChallenges.appendInbox(pure, CONTEXT, signer.pk, INBOX_ENTRY);
    const auth = signer.sign(builder, 0n);
    const c = challengeValue(builder, auth.sig_r, auth.grind_nonce);
    expect(schnorrVerifies(signer.pk, auth.sig_r, auth.sig_s, c)).toBe(true);
  });

  it('wraps an address for a harness building a challenge by hand', () => {
    expect(jubjubAddressArg(ADDRESS)).toEqual({ bytes: ADDRESS });
  });
});
