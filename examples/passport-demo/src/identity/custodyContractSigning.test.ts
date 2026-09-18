/**
 * The account custody layer, drilled directly.
 *
 * Two things here are worth more than the rest, and they are the two that would
 * cost real money if they were wrong:
 *
 * 1. THE DIGEST. `envelopeDigest` is the local copy of a rule the circuit also
 *    applies, and the fixtures below are not "what the code returns" — they are
 *    the values the COMPILED contract's own `envelope_digest` pure circuit
 *    produced for the same inputs, read off the 2026/09/16 build (`compactc
 *    0.34.0 --feature-zkir-v3`, 30 circuits). If the local rule ever drifts, a
 *    Passport signs a digest the circuit will not recompute, and every call
 *    fails at verification after the user has approved it.
 *
 * 2. THE SIGNATURE ROUND TRIP. `@noble/curves` stands in for Dynamic: it signs
 *    a digest, the result is packed into the `0x` + `r‖s‖v` shape Dynamic
 *    returns, and `parseEvmSignature` has to give back scalars that verify
 *    against the same key. A parser that read the bytes in the wrong order
 *    would still produce two plausible-looking bigints, so the only check worth
 *    making is one that puts them back through the curve.
 *
 * `@noble/curves` is used HERE ONLY, and never in `src`. It is not a declared
 * dependency of this workspace — it resolves from the hoisted tree — which is
 * acceptable for a test signer and would not be acceptable for shipped code.
 * The design doc records that, and the reason `src/identity/custodyContractSigning.ts`
 * hashes through WebCrypto instead.
 */

import { describe, expect, it } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';

import {
  authArgs,
  assertCanonicalSignature,
  authoriseWithK256,
  bootCommitment,
  bytesEqual,
  bytesToBigIntBE,
  bytesToHex,
  deviceEntry,
  dynamicK256Signer,
  enrolmentEntry,
  envelopeDigest,
  envelopeDigestMatches,
  envelopePrefixBytes,
  gatedCircuitName,
  isK256Envelope,
  k256Challenges,
  K256_ENVELOPE_CONNECTOR,
  K256_ENVELOPE_NONE,
  parseEvmSignature,
  pointFromUncompressed,
  pointToUncompressed,
  scalarToBytesBE,
  SECP256K1_N,
  type CurvePoint,
  type K1CallContext,
  type CustodyPureCircuits,
  type K256Envelope,
  type QualifiedCoin,
} from './custodyContractSigning.js';

/*
 * The challenge the two digest fixtures were taken over: 32 bytes of 0x07. A
 * flat byte pattern on purpose — a fixture with structure invites somebody to
 * assume the structure matters.
 */
const CHALLENGE = new Uint8Array(32).fill(7);

/** `SHA-256(challenge)` — envelope 0, from the compiled contract. */
const DIGEST_ENVELOPE_0 = '4bb06f8e4e3a7715d201d573d0aa423762e55dabd61a2c02278fa56cc6d294e0';

/** `SHA-256("midnight_signed_message:32:" || challenge)` — envelope 1, ditto. */
const DIGEST_ENVELOPE_1 = 'e1329f59cac3a587b117a70546e7fb5aff60457415eece10f7fb2f0e898807a3';

const POINT: CurvePoint = { x: 11n, y: 22n, identity: false };
const OTHER_POINT: CurvePoint = { x: 33n, y: 44n, identity: false };

const CONTEXT: K1CallContext = {
  contractAddress: Uint8Array.from([1, 2, 3, 4]),
  authNonce: 9n,
};

const COIN: QualifiedCoin = {
  nonce: new Uint8Array(32).fill(1),
  color: new Uint8Array(32).fill(2),
  value: 500n,
  mt_index: 3n,
};

/**
 * A stand-in for the compiled contract's `pureCircuits`.
 *
 * Every function records the arguments it was called with rather than doing
 * arithmetic, because what these tests are checking is ARGUMENT ORDER — which
 * is where a hand-written wrapper around a generated ABI actually goes wrong.
 * Real derivations are the contract's business and are proved by its own
 * conformance suite, not here.
 */
function fakePureCircuits(): CustodyPureCircuits & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  const record = (name: string, args: unknown[], out = 0x11): Uint8Array => {
    calls.push([name, ...args]);
    return new Uint8Array(32).fill(out);
  };
  return {
    calls,
    derive_boot_commitment_with_jubjub: (...a) => record('boot_jubjub', a),
    derive_boot_commitment_with_k256: (...a) => record('boot_k256', a),
    derive_device_entry_with_jubjub: (...a) => record('entry_jubjub', a),
    derive_device_entry_with_k256: (...a) => record('entry_k256', a),
    envelope_digest: (envelope, challenge) => {
      calls.push(['envelope_digest', envelope, challenge]);
      return hexToBytes(envelope === K256_ENVELOPE_NONE ? DIGEST_ENVELOPE_0 : DIGEST_ENVELOPE_1);
    },
    compute_public_point_with_k256: (scalar) => {
      calls.push(['compute_public_point_with_k256', scalar]);
      return POINT;
    },
    challenge_withdraw_shielded_with_k256: (...a) => record('ch_withdraw_shielded', a),
    challenge_withdraw_shielded_to_contract_with_k256: (...a) =>
      record('ch_withdraw_shielded_to_contract', a),
    challenge_withdraw_unshielded_with_k256: (...a) => record('ch_withdraw_unshielded', a),
    challenge_append_inbox_with_k256: (...a) => record('ch_append_inbox', a),
    challenge_add_device_with_k256: (...a) => record('ch_add_device', a),
  };
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Pack `r`, `s`, and a recovery byte the way an EVM signer returns them. */
function packEvmSignature(r: bigint, s: bigint, v: number): string {
  return `0x${bytesToHex(scalarToBytesBE(r))}${bytesToHex(scalarToBytesBE(s))}${v
    .toString(16)
    .padStart(2, '0')}`;
}

describe('arms and circuit names', () => {
  it('names the gated circuit for each arm', () => {
    expect(gatedCircuitName('withdraw_shielded', 'k256')).toBe('withdraw_shielded_with_k256');
    expect(gatedCircuitName('add_device', 'jubjub')).toBe('add_device_with_jubjub');
  });
});

describe('envelopes', () => {
  it('recognises the two enumerated ids and nothing else', () => {
    expect(isK256Envelope(0n)).toBe(true);
    expect(isK256Envelope(1n)).toBe(true);
    expect(isK256Envelope(2n)).toBe(false);
  });

  it('gives envelope 0 an empty prefix and envelope 1 the connector prefix', () => {
    expect(envelopePrefixBytes(K256_ENVELOPE_NONE)).toEqual(new Uint8Array(0));
    expect(new TextDecoder().decode(envelopePrefixBytes(K256_ENVELOPE_CONNECTOR))).toBe(
      'midnight_signed_message:32:',
    );
  });

  it('refuses an id it has no prefix for rather than defaulting to none', () => {
    /* Only reachable from a build that enrolled an envelope this one does not
       know, which is precisely when falling back would sign the wrong digest. */
    expect(() => envelopePrefixBytes(7n as K256Envelope)).toThrow(/unknown k256 envelope/);
  });
});

describe('the digest a device signs', () => {
  it('matches the compiled contract for envelope 0', async () => {
    expect(bytesToHex(await envelopeDigest(K256_ENVELOPE_NONE, CHALLENGE))).toBe(DIGEST_ENVELOPE_0);
  });

  it('matches the compiled contract for envelope 1', async () => {
    expect(bytesToHex(await envelopeDigest(K256_ENVELOPE_CONNECTOR, CHALLENGE))).toBe(
      DIGEST_ENVELOPE_1,
    );
  });

  it('is never the challenge itself', async () => {
    expect(bytesToHex(await envelopeDigest(K256_ENVELOPE_NONE, CHALLENGE))).not.toBe(
      bytesToHex(CHALLENGE),
    );
  });

  it('agrees with the contract circuit when the contract agrees', async () => {
    await expect(
      envelopeDigestMatches(fakePureCircuits(), K256_ENVELOPE_NONE, CHALLENGE),
    ).resolves.toBe(true);
  });

  it('reports disagreement rather than trusting the local copy', async () => {
    const pure = fakePureCircuits();
    pure.envelope_digest = () => new Uint8Array(32);
    await expect(envelopeDigestMatches(pure, K256_ENVELOPE_NONE, CHALLENGE)).resolves.toBe(false);
  });
});

describe('authorisation arguments', () => {
  it('expands the k256 arm in the order its circuits declare', () => {
    expect(
      authArgs({
        arm: 'k256',
        pk: POINT,
        use_counter: 4n,
        sig: { r: 1n, s: 2n },
        envelope: K256_ENVELOPE_NONE,
      }),
    ).toEqual([POINT, 4n, { r: 1n, s: 2n }, 0n]);
  });

  it('expands the jubjub arm in the order its circuits declare', () => {
    expect(
      authArgs({
        arm: 'jubjub',
        pk: POINT,
        use_counter: 4n,
        sig_r: OTHER_POINT,
        sig_s: 7n,
        grind_nonce: 12n,
      }),
    ).toEqual([POINT, 4n, OTHER_POINT, 7n, 12n]);
  });
});

describe('entry and boot derivation', () => {
  it('binds the envelope on the k256 arm and omits it on jubjub', () => {
    const pure = fakePureCircuits();
    const address = Uint8Array.from([9, 9]);
    deviceEntry(pure, { arm: 'k256', pk: POINT, envelope: K256_ENVELOPE_CONNECTOR }, address, 2n, 5n);
    deviceEntry(pure, { arm: 'jubjub', pk: POINT }, address, 2n, 5n);
    expect(pure.calls).toEqual([
      ['entry_k256', { bytes: address }, POINT, 1n, 2n, 5n],
      ['entry_jubjub', { bytes: address }, POINT, 2n, 5n],
    ]);
  });

  it('derives a boot commitment per arm', () => {
    const pure = fakePureCircuits();
    const salt = new Uint8Array(32).fill(3);
    bootCommitment(pure, { arm: 'k256', pk: POINT, envelope: K256_ENVELOPE_NONE }, salt);
    bootCommitment(pure, { arm: 'jubjub', pk: POINT }, salt);
    expect(pure.calls).toEqual([
      ['boot_k256', salt, POINT, 0n],
      ['boot_jubjub', salt, POINT],
    ]);
  });

  it('enrols a cross-arm device at counter zero of the current epoch', () => {
    /* The counter is not a parameter, and that is the point: there is exactly
       one correct value and a caller must not be able to pass another. */
    const pure = fakePureCircuits();
    const address = Uint8Array.from([7]);
    enrolmentEntry(pure, { arm: 'k256', pk: POINT, envelope: K256_ENVELOPE_NONE }, address, 6n);
    expect(pure.calls).toEqual([['entry_k256', { bytes: address }, POINT, 0n, 6n, 0n]]);
  });
});

describe('k256 challenges', () => {
  it('binds the held coin into a shielded withdrawal', () => {
    const pure = fakePureCircuits();
    const recipient = Uint8Array.from([8, 8]);
    const colour = new Uint8Array(32).fill(2);
    k256Challenges.withdrawShielded(pure, CONTEXT, POINT, recipient, colour, 100n, COIN);
    expect(pure.calls).toEqual([
      [
        'ch_withdraw_shielded',
        { bytes: CONTEXT.contractAddress },
        POINT,
        { bytes: recipient },
        colour,
        100n,
        COIN,
        9n,
      ],
    ]);
  });

  it('binds the held coin and the RECIPIENT CONTRACT into a direct transfer', () => {
    const pure = fakePureCircuits();
    const recipientContract = new Uint8Array(32).fill(0xbb);
    const colour = new Uint8Array(32).fill(2);
    k256Challenges.withdrawShieldedToContract(
      pure,
      CONTEXT,
      POINT,
      recipientContract,
      colour,
      100n,
      COIN,
    );
    expect(pure.calls).toEqual([
      [
        'ch_withdraw_shielded_to_contract',
        { bytes: CONTEXT.contractAddress },
        POINT,
        { bytes: recipientContract },
        colour,
        100n,
        COIN,
        9n,
      ],
    ]);
  });

  it('reaches a DIFFERENT circuit from the user-key spend, on identical bytes', () => {
    /* Thirty-two bytes are thirty-two bytes: the only thing that stops a
       signature approving a payment to a person being replayed as a payment to
       a contract is that the two circuits carry different domain-separation
       tags, which is to say that these two builders call different circuits. */
    const pure = fakePureCircuits();
    const target = new Uint8Array(32).fill(0xbb);
    const colour = new Uint8Array(32).fill(2);
    k256Challenges.withdrawShielded(pure, CONTEXT, POINT, target, colour, 100n, COIN);
    k256Challenges.withdrawShieldedToContract(pure, CONTEXT, POINT, target, colour, 100n, COIN);
    expect(pure.calls.map((call) => call[0])).toEqual([
      'ch_withdraw_shielded',
      'ch_withdraw_shielded_to_contract',
    ]);
  });

  it('puts the unshielded recipient after the amount, as the ABI declares it', () => {
    const pure = fakePureCircuits();
    const recipient = Uint8Array.from([8]);
    const colour = new Uint8Array(32);
    k256Challenges.withdrawUnshielded(pure, CONTEXT, POINT, colour, 50n, recipient);
    expect(pure.calls).toEqual([
      [
        'ch_withdraw_unshielded',
        { bytes: CONTEXT.contractAddress },
        POINT,
        colour,
        50n,
        { bytes: recipient },
        9n,
      ],
    ]);
  });

  it('binds the inbox entry and the auth nonce', () => {
    const pure = fakePureCircuits();
    const entry = new Uint8Array(192).fill(1);
    k256Challenges.appendInbox(pure, CONTEXT, POINT, entry);
    expect(pure.calls).toEqual([
      ['ch_append_inbox', { bytes: CONTEXT.contractAddress }, POINT, entry, 9n],
    ]);
  });

  it('binds the new device as its derived entry, not as a key', () => {
    const pure = fakePureCircuits();
    const newEntry = new Uint8Array(32).fill(4);
    k256Challenges.addDevice(pure, CONTEXT, POINT, newEntry);
    expect(pure.calls).toEqual([
      ['ch_add_device', { bytes: CONTEXT.contractAddress }, POINT, newEntry, 9n],
    ]);
  });
});

describe('parsing what an EVM signer returns', () => {
  it('reads r, s, and a 27/28 recovery byte', () => {
    expect(parseEvmSignature(packEvmSignature(5n, 6n, 27))).toEqual({ r: 5n, s: 6n, v: 0 });
    expect(parseEvmSignature(packEvmSignature(5n, 6n, 28))).toEqual({ r: 5n, s: 6n, v: 1 });
  });

  it('reads a 0/1 recovery byte from the signers that use that dialect', () => {
    expect(parseEvmSignature(packEvmSignature(5n, 6n, 0))).toEqual({ r: 5n, s: 6n, v: 0 });
    expect(parseEvmSignature(packEvmSignature(5n, 6n, 1))).toEqual({ r: 5n, s: 6n, v: 1 });
  });

  it('accepts the hex with or without 0x, and in either case', () => {
    const packed = packEvmSignature(5n, 6n, 27);
    expect(parseEvmSignature(packed.slice(2))).toEqual({ r: 5n, s: 6n, v: 0 });
    expect(parseEvmSignature(packed.toUpperCase().replace('0X', '0x'))).toEqual({
      r: 5n,
      s: 6n,
      v: 0,
    });
  });

  it('refuses anything that is not 65 bytes of hex', () => {
    expect(() => parseEvmSignature('0xdeadbeef')).toThrow(/65 bytes of hex/);
    expect(() => parseEvmSignature(`0x${'zz'.repeat(65)}`)).toThrow(/65 bytes of hex/);
  });

  it('refuses a recovery byte it cannot normalise to 0 or 1', () => {
    expect(() => parseEvmSignature(packEvmSignature(5n, 6n, 5))).toThrow(/recovery byte/);
    expect(() => parseEvmSignature(packEvmSignature(5n, 6n, 0x40))).toThrow(/recovery byte/);
  });

  it('refuses scalars outside [1, n)', () => {
    expect(() => parseEvmSignature(packEvmSignature(0n, 6n, 27))).toThrow(/r is not in/);
    expect(() => parseEvmSignature(packEvmSignature(SECP256K1_N, 6n, 27))).toThrow(/r is not in/);
    expect(() => assertCanonicalSignature({ r: 1n, s: 0n })).toThrow(/s is not in/);
    expect(() => assertCanonicalSignature({ r: 1n, s: SECP256K1_N })).toThrow(/s is not in/);
  });

  it('accepts a high-S signature, because the arm deliberately does', () => {
    /* Not an oversight: the r1 arm this one stands in for has to accept the
       high-S signatures real P-256 authenticators emit, and a malleated twin
       cannot replay because its device entry is consumed on execution. */
    const highS = SECP256K1_N - 1n;
    expect(parseEvmSignature(packEvmSignature(5n, highS, 27)).s).toBe(highS);
  });
});

describe('a real signature, through the parser and back onto the curve', () => {
  const privateKey = scalarToBytesBE(0x1234_5678_9abc_def0n);

  it('round-trips a noble signature packed the way Dynamic packs one', async () => {
    const digest = await envelopeDigest(K256_ENVELOPE_NONE, CHALLENGE);
    const signature = secp256k1.Signature.fromBytes(
      secp256k1.sign(digest, privateKey, { prehash: false }),
    );
    const parsed = parseEvmSignature(packEvmSignature(signature.r, signature.s, 27));
    expect(parsed.r).toBe(signature.r);
    expect(parsed.s).toBe(signature.s);
    expect(
      secp256k1.verify(
        secp256k1.Signature.fromBytes(
          new Uint8Array([...scalarToBytesBE(parsed.r), ...scalarToBytesBE(parsed.s)]),
        ).toBytes(),
        digest,
        secp256k1.getPublicKey(privateKey, false),
        { prehash: false },
      ),
    ).toBe(true);
  });

  it('carries a signed digest all the way to an authorisation', async () => {
    const digest = await envelopeDigest(K256_ENVELOPE_NONE, CHALLENGE);
    const publicKey = pointFromUncompressed(secp256k1.getPublicKey(privateKey, false));
    const seen: { accountAddress: string; message: string }[] = [];

    const signer = dynamicK256Signer({
      accountAddress: '0xabc',
      pk: publicKey,
      signRawMessage: (input) => {
        seen.push(input);
        const signature = secp256k1.Signature.fromBytes(
          secp256k1.sign(hexToBytes(input.message), privateKey, { prehash: false }),
        );
        return Promise.resolve(packEvmSignature(signature.r, signature.s, 27));
      },
    });

    const auth = await authoriseWithK256(signer, CHALLENGE, 3n);

    /* Dynamic is handed the envelope digest as 64 hex characters with no 0x —
       the one shape it signs verbatim. */
    expect(seen).toEqual([{ accountAddress: '0xabc', message: bytesToHex(digest) }]);
    expect(auth.arm).toBe('k256');
    expect(auth.envelope).toBe(K256_ENVELOPE_NONE);
    expect(auth.use_counter).toBe(3n);
    expect(auth.pk).toEqual(publicKey);
    expect(
      secp256k1.verify(
        new Uint8Array([...scalarToBytesBE(auth.sig.r), ...scalarToBytesBE(auth.sig.s)]),
        digest,
        secp256k1.getPublicKey(privateKey, false),
        { prehash: false, format: 'compact' },
      ),
    ).toBe(true);
  });

  it('signs under the connector envelope when a device was enrolled with it', async () => {
    const signer = dynamicK256Signer({
      accountAddress: '0xabc',
      pk: POINT,
      envelope: K256_ENVELOPE_CONNECTOR,
      signRawMessage: ({ message }) => {
        expect(message).toBe(DIGEST_ENVELOPE_1);
        return Promise.resolve(packEvmSignature(5n, 6n, 27));
      },
    });
    const auth = await authoriseWithK256(signer, CHALLENGE, 0n);
    expect(auth.envelope).toBe(K256_ENVELOPE_CONNECTOR);
  });

  it('refuses to ask for a signature over anything but 32 bytes', async () => {
    const signer = dynamicK256Signer({
      accountAddress: '0xabc',
      pk: POINT,
      signRawMessage: () => Promise.reject(new Error('must not be called')),
    });
    await expect(signer.signDigest(new Uint8Array(31))).rejects.toThrow(/must be 32 bytes/);
  });
});

describe('point encoding', () => {
  it('round-trips through uncompressed SEC1', () => {
    const bytes = pointToUncompressed(POINT);
    expect(bytes[0]).toBe(0x04);
    expect(bytes).toHaveLength(65);
    expect(pointFromUncompressed(bytes)).toEqual(POINT);
  });

  it('refuses the identity, which would authorise with no secret', () => {
    expect(() => pointToUncompressed({ x: 0n, y: 0n, identity: true })).toThrow(/identity/);
  });

  it('refuses bytes that are not uncompressed SEC1', () => {
    expect(() => pointFromUncompressed(new Uint8Array(64))).toThrow(/uncompressed SEC1/);
    const wrongTag = new Uint8Array(65);
    wrongTag[0] = 0x02;
    expect(() => pointFromUncompressed(wrongTag)).toThrow(/uncompressed SEC1/);
  });
});

describe('byte plumbing', () => {
  it('writes lower-case hex with leading zeroes intact', () => {
    expect(bytesToHex(Uint8Array.from([0, 15, 255]))).toBe('000fff');
  });

  it('encodes and decodes a scalar big-endian', () => {
    expect(bytesToBigIntBE(scalarToBytesBE(0n))).toBe(0n);
    expect(bytesToBigIntBE(scalarToBytesBE(SECP256K1_N - 1n))).toBe(SECP256K1_N - 1n);
  });

  it('compares bytes by length and then by content', () => {
    expect(bytesEqual(Uint8Array.from([1, 2]), Uint8Array.from([1, 2]))).toBe(true);
    expect(bytesEqual(Uint8Array.from([1, 2]), Uint8Array.from([1]))).toBe(false);
    expect(bytesEqual(Uint8Array.from([1, 2]), Uint8Array.from([1, 3]))).toBe(false);
  });
});
