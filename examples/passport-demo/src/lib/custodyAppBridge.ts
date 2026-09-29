import { secp256k1 } from '@noble/curves/secp256k1.js';
import { hexToBytes } from '@noble/curves/utils.js';
import type { CustodyArm } from './custodyArm.js';
import { dynamicK256Signer } from '../identity/custodyContractSigning.js';
import type { PassportCallbackEnvelope } from '../identity/callbackProtocol.js';

async function digest(bytes: Uint8Array) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer));
}

/** Reuse the existing profile key so a custody upgrade preserves the builder account. */
export function signPasskeyAppProfile(keystore: { getPublicKey(): string | { tag: string; value: string }; signData(bytes: Uint8Array): string | { tag: string; value: string } }, bytes: Uint8Array, encoded: string): PassportCallbackEnvelope {
  const encode = (value: string | { tag: string; value: string }) => typeof value === 'string' ? value : `${value.tag}:${value.value}`;
  return {
    protocol: 'org.midnight.passport.callback/v1', type: 'passport.callback.response', payload: encoded,
    scheme: 'bip340-schnorr-secp256k1-sha256', publicKey: encode(keystore.getPublicKey()), signature: encode(keystore.signData(bytes)),
  };
}

/** One provider approval, using the enrolled public point and a domain-bound payload. */
export async function signProviderAppPayload(arm: CustodyArm, bytes: Uint8Array) {
  const approval = arm.approve();
  try {
    const { device } = await approval.ready;
    if (device.arm !== 'k256' || !arm.session) throw new Error('The provider signing session is unavailable.');
    const signer = dynamicK256Signer({ accountAddress: arm.session.address, pk: device.pk, signRawMessage: arm.session.signRaw });
    const hash = await digest(bytes);
    const signature = await signer.signDigest(hash);
    const publicKey = `${device.pk.y % 2n ? '03' : '02'}${device.pk.x.toString(16).padStart(64, '0')}`;
    const compact = `${signature.r.toString(16).padStart(64, '0')}${signature.s.toString(16).padStart(64, '0')}`;
    if (!secp256k1.verify(hexToBytes(compact), hash, hexToBytes(publicKey), { prehash: false, lowS: false })) throw new Error('The provider returned a signature that does not match this Passport.');
    return { publicKey, signature: compact };
  } finally { approval.release(); }
}
