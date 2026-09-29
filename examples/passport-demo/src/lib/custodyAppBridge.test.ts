import { createKeystore } from '@midnight-ntwrk/wallet-sdk/unshielded';
import { describe, expect, it } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { hexToBytes } from '@noble/curves/utils.js';
import { signPasskeyAppProfile, signProviderAppPayload } from './custodyAppBridge.js';
import { buildPassportCallbackPayload, passportCallbackSuccessUrl } from '../identity/callbackProtocol.js';
import { parsePassportCallbackReturn, verifyPassportCallbackReply } from '@midnight-passport/connect/redirect';
import type { CustodyArm } from './custodyArm.js';

describe('custody signed profile bridge', () => {
  const launch = { callbackUrl: 'https://builder.example/auth/callback', callbackOrigin: 'https://builder.example', fields: ['displayName'] as const, state: 'test-state' };
  const payload = () => buildPassportCallbackPayload({ launch, profile: { displayName: 'alice' } });
  it('the existing passkey profile key survives a custody upgrade and verifies through connect', async () => {
    const root = new Uint8Array(32).fill(42);
    const { bytes, encoded } = payload();
    const keystore = createKeystore({ kind: 'schnorr', secret: root }, 'stagenet');
    const signed = signPasskeyAppProfile(keystore, bytes, encoded);
    const parsed = parsePassportCallbackReturn(new URL(passportCallbackSuccessUrl(launch, signed)).hash);
    expect(parsed.kind).toBe('response');
    if (parsed.kind !== 'response') return;
    expect(verifyPassportCallbackReply(parsed.envelope, { expectedAudience: launch.callbackOrigin, expectedState: launch.state }).ok).toBe(true);
    expect(verifyPassportCallbackReply(parsed.envelope, { expectedAudience: 'https://attacker.example', expectedState: launch.state }).ok).toBe(false);
    const again = signPasskeyAppProfile(keystore, bytes, encoded);
    expect(again.publicKey).toBe(signed.publicKey);
    expect(parsed.envelope.publicKey).toBe(keystore.getPublicKey().value);
    root.fill(0);
  });
  it('provider keys sign without exporting a private key; wrong-key and tampered replies fail', async () => {
    const key = new Uint8Array(32).fill(9);
    const point = secp256k1.Point.fromBytes(secp256k1.getPublicKey(key)).toAffine();
    let released = 0;
    const arm = {
      approve: () => ({ ready: Promise.resolve({ device: { arm: 'k256', pk: { ...point, identity: false } } }), release: () => { released++; } }),
      session: { address: '0x123', signRaw: async ({ message }: { message: string }) => {
        const signature = secp256k1.sign(hexToBytes(message), key, { prehash: false });
        return `0x${Buffer.from(signature).toString('hex')}1b`;
      } },
    } as unknown as CustodyArm;
    const { bytes, encoded } = payload();
    const signature = await signProviderAppPayload(arm, bytes);
    expect(released).toBe(1);
    const signed = { protocol: 'org.midnight.passport.callback/v1' as const, type: 'passport.callback.response' as const, scheme: 'ecdsa-secp256k1-sha256' as const, payload: encoded, ...signature };
    const parsed = parsePassportCallbackReturn(new URL(passportCallbackSuccessUrl(launch, signed)).hash);
    expect(parsed.kind).toBe('response');
    if (parsed.kind !== 'response') return;
    expect(verifyPassportCallbackReply(parsed.envelope, { expectedAudience: launch.callbackOrigin, expectedState: launch.state }).ok).toBe(true);
    expect(verifyPassportCallbackReply({ ...parsed.envelope, signature: '0'.repeat(128) }, { expectedAudience: launch.callbackOrigin, expectedState: launch.state }).ok).toBe(false);
  });
});
