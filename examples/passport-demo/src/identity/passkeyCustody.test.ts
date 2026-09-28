/**
 * The passkey adapter: one contract root in, one custody device out.
 *
 * WHAT IS HELD HERE, AND WHAT IS NOT. The derivation rule — expand and reject,
 * never `mod r_J` — is `custodyJubjubSigner.test.ts`'s and is drilled there
 * against the curve. The four labels are `passportContract.ts`'s. What is held
 * here is the ASSEMBLY: that the device which comes out is the one the custody
 * entry points take, that it is named by its own point, that the viewing secret
 * rides with it, and — the part that is a decision rather than plumbing — that
 * the maintenance key exists only where the account is going to keep it.
 */

import { describe, expect, it } from 'vitest';

import {
  passkeyCustodyDevice,
  passkeyCustodyUserKey,
  PASSKEY_CUSTODY_LABELS,
  PASSKEY_DEVICE_FORGOTTEN,
} from './passkeyCustody.js';
import { derivePassportContractSecrets } from './passportContract.js';
import { deriveJubjubDeviceScalar, JUBJUB_DEVICE_LABEL } from './custodyJubjubSigner.js';
import { bytesToHex, type CustodyPureCircuits } from './custodyContractSigning.js';

/** A stand-in for `compute_public_point_with_jubjub`, and nothing else is reached. */
const pure = {
  compute_public_point_with_jubjub: (scalar: bigint) => ({ x: scalar, y: scalar + 1n }),
} as unknown as CustodyPureCircuits;

/* A fixed root, so every expectation below is a statement about the same
   passkey rather than about a fresh one each run. */
const ROOT = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 11) & 0xff);

describe('passkeyCustodyDevice', () => {
  it('hands back a jubjub device named by its own point', async () => {
    const built = await passkeyCustodyDevice({ pure, contractRoot: ROOT });
    const scalar = await deriveJubjubDeviceScalar(ROOT);

    expect(built.device.arm).toBe('jubjub');
    expect(built.device.pk.x).toBe(scalar);
    /* The user key IS the point, which is what makes it the same before and
       after a reinstall — the property the whole arm exists for. */
    expect(built.userKey).toBe(`jubjub:${scalar.toString(16)}`);
    expect(built.userKey).toBe(passkeyCustodyUserKey(built.device.pk.x));
  });

  it('carries the viewing secret the account’s inbox is sealed to', async () => {
    const built = await passkeyCustodyDevice({ pure, contractRoot: ROOT });
    const { encSecret } = await derivePassportContractSecrets(ROOT);
    /* DERIVED AND NOT RANDOM, so a Passport reinstalled on another phone
       re-derives the key its own inbox was sealed to and can describe its own
       coins again. */
    expect(built.device.encSecretKeyHex).toBe(bytesToHex(encSecret));
  });

  it('derives the maintenance key by default, because the authority is kept', async () => {
    /* HECTOR, 2026/09/18: keep it. This week's prototype accounts cannot take a
       circuit fix, and a retired authority is what makes that true. */
    const built = await passkeyCustodyDevice({ pure, contractRoot: ROOT });
    const { maintenanceSecret } = await derivePassportContractSecrets(ROOT);
    expect(built.device.maintenanceSecretHex).toBe(bytesToHex(maintenanceSecret));
  });

  it('derives none where the caller asks for an account that can never be fixed', async () => {
    /* ABSENT, not empty. A key for an authority the plan is about to retire is
       a signing secret in a field nothing reads, which is the kind of thing
       somebody stores later. */
    const built = await passkeyCustodyDevice({
      pure,
      contractRoot: ROOT,
      keepMaintenanceAuthority: false,
    });
    expect('maintenanceSecretHex' in built.device).toBe(false);
  });

  it('gives the same passkey the same device every time', async () => {
    const first = await passkeyCustodyDevice({ pure, contractRoot: ROOT });
    const second = await passkeyCustodyDevice({ pure, contractRoot: ROOT });
    expect(second.userKey).toBe(first.userKey);
    expect(second.device.encSecretKeyHex).toBe(first.device.encSecretKeyHex);
  });

  it('gives a different passkey a different device and a different inbox', async () => {
    const other = await passkeyCustodyDevice({
      pure,
      contractRoot: new Uint8Array(32).fill(3),
    });
    const ours = await passkeyCustodyDevice({ pure, contractRoot: ROOT });
    expect(other.userKey).not.toBe(ours.userKey);
    expect(other.device.encSecretKeyHex).not.toBe(ours.device.encSecretKeyHex);
  });

  it('signs with the derived scalar, synchronously, with no vendor to wait for', async () => {
    const built = await passkeyCustodyDevice({
      pure,
      contractRoot: ROOT,
      randomBytes: (length) => new Uint8Array(length).fill(4),
    });
    /* A challenge builder that ignores its arguments and answers below the
       subgroup order at once: what is under test is that `sign` is THERE and is
       synchronous, not the grind, which `custodyJubjubSigner.test.ts` owns. */
    const auth = built.device.sign(() => new Uint8Array(32), 0n);
    expect(auth.arm).toBe('jubjub');
    expect(auth.use_counter).toBe(0n);
    expect(auth.pk).toEqual(built.device.pk);
  });

  it('zeroes what it can when the action is over, and is safe to forget twice', async () => {
    const built = await passkeyCustodyDevice({ pure, contractRoot: ROOT });
    /* `forget` clears this module's own byte arrays, so nothing of the root
       survives in a buffer somebody could reach through a heap snapshot. It
       must not throw, and it must be safe to call twice. */
    expect(() => {
      built.forget();
      built.forget();
    }).not.toThrow();
  });

  /* THE REVIEW OF 2026/09/27: payments were signed with no prompt because the
     device built at the first ceremony was kept and used again. A forgotten
     device is the end of that device — whoever still holds a reference to it
     holds nothing that can sign. */
  it('cannot sign, or hand over a secret, once it has been forgotten', async () => {
    const built = await passkeyCustodyDevice({
      pure,
      contractRoot: ROOT,
      randomBytes: (length) => new Uint8Array(length).fill(4),
    });
    /* Before: it signs, and the deploy can read what it is built from. */
    expect(built.device.sign(() => new Uint8Array(32), 0n).arm).toBe('jubjub');
    expect(built.device.encSecretKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(built.device.maintenanceSecretHex).toMatch(/^[0-9a-f]{64}$/);

    built.forget();

    expect(() => built.device.sign(() => new Uint8Array(32), 1n)).toThrow(PASSKEY_DEVICE_FORGOTTEN);
    expect(() => built.device.encSecretKeyHex).toThrow(PASSKEY_DEVICE_FORGOTTEN);
    /* A THROW, not undefined: the custody layer reads an absent maintenance key
       as "retire the authority", and a forgotten device must never plan that. */
    expect(() => built.device.maintenanceSecretHex).toThrow(PASSKEY_DEVICE_FORGOTTEN);
    expect('maintenanceSecretHex' in built.device).toBe(true);
    /* What is public stays: the point and the key the stores are filed under. */
    expect(built.device.pk.x).toBe(await deriveJubjubDeviceScalar(ROOT));
    expect(built.userKey).toBe(passkeyCustodyUserKey(built.device.pk.x));
  });

  it('forgets the viewing secret of a device that carries no maintenance key, too', async () => {
    const built = await passkeyCustodyDevice({
      pure,
      contractRoot: ROOT,
      keepMaintenanceAuthority: false,
    });
    built.forget();
    expect(() => built.device.encSecretKeyHex).toThrow(PASSKEY_DEVICE_FORGOTTEN);
    expect('maintenanceSecretHex' in built.device).toBe(false);
  });

  it('refuses a root that is not 32 bytes, before any of it is used', async () => {
    await expect(
      passkeyCustodyDevice({ pure, contractRoot: new Uint8Array(31) }),
    ).rejects.toThrow(/32 bytes/);
  });

  it('names three labels, all distinct', () => {
    const labels = [JUBJUB_DEVICE_LABEL, PASSKEY_CUSTODY_LABELS.enc, PASSKEY_CUSTODY_LABELS.maintenance];
    /* DOMAIN SEPARATION IS THE WHOLE POINT of one assertion producing several
       secrets: two labels that collided would make the viewing secret and the
       spending key the same 32 bytes. */
    expect(new Set(labels).size).toBe(3);
  });
});
