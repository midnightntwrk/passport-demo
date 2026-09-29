import { createHash, randomUUID } from 'node:crypto';
import { schnorr } from '@noble/curves/secp256k1.js';

export const aliceKey = new Uint8Array(32).fill(7);
export const bobKey = new Uint8Array(32).fill(9);
export const subjectFor = (key: Uint8Array) => `passport:${createHash('sha256').update(Buffer.from(schnorr.getPublicKey(key)).toString('hex')).digest('hex')}`;
export function signedCallback(launchUrl: string, input: { key?: Uint8Array; payload?: Record<string, unknown>; envelope?: Record<string, unknown> } = {}): string {
  const launch = new URL(launchUrl);
  const value = {
    protocol: 'org.midnight.passport.callback/v1', type: 'passport.callback.profile', version: 1,
    audience: new URL(launch.searchParams.get('passportCallback')!).origin,
    state: launch.searchParams.get('passportState'), issuedAt: Date.now(), nonce: randomUUID(),
    fields: ['displayName', 'passportContract'], profile: { displayName: 'Same claimed name', passportContract: { address: 'ab'.repeat(32), network: 'stagenet' } },
    ...input.payload,
  };
  const bytes = Buffer.from(JSON.stringify(value));
  const key = input.key || aliceKey;
  const envelope = {
    protocol: 'org.midnight.passport.callback/v1', type: 'passport.callback.response', payload: bytes.toString('base64url'),
    scheme: 'bip340-schnorr-secp256k1-sha256',
    publicKey: `schnorr:${Buffer.from(schnorr.getPublicKey(key)).toString('hex')}`,
    signature: `schnorr:${Buffer.from(schnorr.sign(createHash('sha256').update(bytes).digest(), key)).toString('hex')}`,
    ...input.envelope,
  };
  return `#passportResponse=${Buffer.from(JSON.stringify(envelope)).toString('base64url')}`;
}
export const cookieHeader = (cookies: string[]) => cookies.map(cookie => cookie.split(';')[0]).join('; ');
