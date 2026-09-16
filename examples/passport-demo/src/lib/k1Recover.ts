/**
 * Recovering a secp256k1 public point from a signature over a known digest.
 *
 * WHY THIS IS A FILE OF ITS OWN
 * -----------------------------
 * It is the one place `@noble/curves` is named in `src`, and it is named inside
 * an `import()` so the curve never reaches the entry chunk. Everything else in
 * the k1 layer takes the curve arithmetic from the contract's own exported pure
 * circuits — `compute_public_point_with_k256` exists precisely so a signer uses
 * the generator the circuit uses — but RECOVERY is not a circuit the contract
 * exports, and it cannot be: it needs a general scalar multiplication on a point
 * read off the signature, not a multiplication of the generator.
 *
 * It exists at all because Dynamic exports no key and no point. An Ethereum
 * address is the tail of a keccak hash of the point and cannot be run backwards,
 * so the point is recovered ONCE, at enrolment, from a signature over a digest
 * we chose — which is why `parseEvmSignature` keeps the recovery byte that every
 * other reader of an EVM signature throws away.
 *
 * `@noble/curves` is pinned EXACTLY at 2.4.0 in `package.json`. Not a caret: the
 * v11 incident was a `@scure/base` float that made a released build refuse
 * pasted addresses, and a curve library is a worse thing to float than a base
 * codec.
 */

/**
 * The point that signed `digest`, as uncompressed SEC1 (`0x04 ‖ X ‖ Y`).
 *
 * BYTES OUT, NOT A `CurvePoint`, so this module carries no import from the
 * custody layer and the conversion stays in `accountK1.ts`'s
 * `pointFromUncompressed` — which is where every other check on the shape of a
 * point already lives, including the refusal of the curve identity.
 *
 * `digest` is the 32 bytes the device actually signed — already hashed, already
 * enveloped — so recovery must not hash it again. `v` is normalised to 0 or 1 by
 * `parseEvmSignature` before it gets here.
 */
export async function recoverSecp256k1Point(
  digest: Uint8Array,
  r: bigint,
  s: bigint,
  v: number,
): Promise<Uint8Array> {
  const { secp256k1 } = await import('@noble/curves/secp256k1.js');
  const signature = new secp256k1.Signature(r, s, v);
  /* `false` is "not compressed". The generated ABI carries X and Y separately,
     so the 65-byte form is the one that maps onto it without a decompression. */
  return signature.recoverPublicKey(digest).toBytes(false);
}
