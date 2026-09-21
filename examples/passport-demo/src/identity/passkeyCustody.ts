/**
 * A PASSKEY, AS THE CUSTODY LAYER SEES ONE.
 *
 * WHAT IT IS FOR
 * --------------
 * The custody layer takes a device: an arm, a point, and — for a gated call —
 * something that can sign. A social sign-in hands it one by recovering a
 * secp256k1 point from two vendor signatures. A passkey hands it one by
 * DERIVING a JubJub scalar from the contract root a single user-verified
 * assertion produces, and that derivation, the point, the viewing secret, and
 * the maintenance key all come from the same 32 bytes under four distinct
 * labels.
 *
 * This module is the one place those pieces are put together, so that
 * `custodyContractClient.ts` never sees a passkey and the screen never sees a
 * scalar.
 *
 * ONE ASSERTION PER ACTION, AND THE SIGNER OUTLIVES THE CALL
 * ----------------------------------------------------------
 * {@link passkeyCustodyDevice} takes a contract root that has already been
 * derived — it asks for no ceremony of its own — and the signer it returns
 * holds the scalar in memory for as long as the caller keeps it. That is what
 * makes a send one prompt rather than several: a spend, its `mt_index`
 * candidate retries, and the inbox backfill that follows are all authorised by
 * the signer the one assertion produced. The `forget` on what comes back zeroes
 * what can be zeroed when the action is over.
 *
 * WHAT THIS MODULE MUST NEVER DO
 * ------------------------------
 * Persist any of it. The scalar, the viewing secret, and the maintenance key
 * are all re-derivable from the passkey and are worth exactly as much as the
 * passkey is; writing any of them down would make a cleared browser or a stolen
 * laptop into a compromise the authenticator was supposed to prevent. The only
 * thing that is stored is the device POINT, inside the user key, which is
 * public.
 */

import {
  derivePassportContractSecrets,
  PASSPORT_ENC_LABEL,
  PASSPORT_MAINTENANCE_LABEL,
} from './passportContract.js';
import {
  deriveJubjubDeviceScalar,
  jubjubDeviceSigner,
  type JubjubSigner,
} from './custodyJubjubSigner.js';
import {
  custodyUserKey,
  type CustodyPasskeyDevice,
} from './custodyContractClient.js';
import { bytesToHex, type CustodyPureCircuits } from './custodyContractSigning.js';

/**
 * A passkey's device: the identity, the signer, and the secrets the account is
 * built around.
 *
 * `CustodyPasskeyDevice & JubjubSigner` is exactly the type
 * `custodyContractClient.ts` calls `CustodyCallDevice` on this arm, so this
 * object goes straight into `deployCustodyAccount`, `activateK1Device`, and
 * `k1Call` with nothing unwrapped on the way.
 */
export interface PasskeyCustodyDevice {
  /** The device itself, ready for any custody entry point. */
  readonly device: CustodyPasskeyDevice & JubjubSigner;
  /** What every store this Passport owns is keyed by. See {@link custodyUserKey}. */
  readonly userKey: string;
  /** Zero what can be zeroed. The scalar inside the signer cannot be reached. */
  forget(): void;
}

/**
 * Build the device for the passkey behind a contract root.
 *
 * `contractRoot` is the 32 bytes one user-verified assertion produces against
 * `PASSPORT_CONTRACT_SCOPE`. It is READ and not retained: the four derivations
 * happen here and the caller is free to zero it the moment this resolves.
 *
 * THE MAINTENANCE KEY IS DERIVED, AND THE AUTHORITY IS KEPT — Hector's decision
 * of 2026/09/18, made for one reason: the prototype accounts made this week
 * cannot take a circuit fix. A retired authority makes the account immutable, so
 * a defect in a circuit means a fresh account and a migration of everything in
 * the old one, which is exactly the position those Passports are in.
 *
 * The default here is therefore `true`, and the wave plan follows the DEVICE
 * rather than a flag a caller might forget (`custodyRetiresAuthority`): a device
 * that carries a key keeps the authority that key is to, and one that does not
 * retires it. A caller may still pass `false` — the developer surface makes an
 * account it never intends to upgrade — and then nothing is derived at all,
 * which is the point: a signing secret in a field nothing reads is the kind of
 * thing somebody stores later. See `PASSPORT_MAINTENANCE_LABEL` for what each
 * answer costs, and `custodyRetiresAuthority` for why only this arm may choose.
 */
export async function passkeyCustodyDevice(options: {
  readonly pure: CustodyPureCircuits;
  readonly contractRoot: Uint8Array;
  /** False only where the account is meant to be immutable. Defaults to true. */
  readonly keepMaintenanceAuthority?: boolean;
  /** Injected so a drill can pin the signature nonce. */
  readonly randomBytes?: (length: number) => Uint8Array;
}): Promise<PasskeyCustodyDevice> {
  const secrets = await derivePassportContractSecrets(options.contractRoot);
  const scalar = await deriveJubjubDeviceScalar(options.contractRoot);
  const signer = jubjubDeviceSigner({
    pure: options.pure,
    secretScalar: scalar,
    randomBytes: options.randomBytes,
  });
  const encSecretKeyHex = bytesToHex(secrets.encSecret);
  const maintenanceSecretHex =
    options.keepMaintenanceAuthority === false ? undefined : bytesToHex(secrets.maintenanceSecret);
  /* The three we did not ask for go back to zero before anybody can hold them.
     `deviceSecret` and `recoverySecret` belong to the PROTOTYPE contract and
     have no meaning on this one; they come back only because the derivation is
     one function and splitting it would cost a second reading of the root. */
  secrets.deviceSecret.fill(0);
  secrets.recoverySecret.fill(0);
  if (maintenanceSecretHex === undefined) secrets.maintenanceSecret.fill(0);

  const device: CustodyPasskeyDevice & JubjubSigner = {
    arm: 'jubjub',
    pk: signer.pk,
    sign: signer.sign.bind(signer),
    encSecretKeyHex,
    ...(maintenanceSecretHex === undefined ? {} : { maintenanceSecretHex }),
  };
  return {
    device,
    /* No session: this arm has no vendor and no address. */
    userKey: custodyUserKey(null, device),
    forget: () => {
      secrets.encSecret.fill(0);
      secrets.maintenanceSecret.fill(0);
    },
  };
}

/**
 * The user key for a passkey's device point, without building a device.
 *
 * For a router that has the point already — from the pointer store, or from a
 * recovery that read the account's device set — and only wants to know which
 * record to open.
 */
export function passkeyCustodyUserKey(pointX: bigint): string {
  return `jubjub:${pointX.toString(16)}`;
}

/**
 * The two labels this module hands on, named once so a reader can see they are
 * distinct and a drill can assert they stay so.
 *
 * `midnight.passport.jj` is the device scalar's and lives in
 * `custodyJubjubSigner.ts`, beside the rejection rule that consumes it; these
 * two are `passportContract.ts`'s. Nothing here derives anything under a label
 * of its own.
 */
export const PASSKEY_CUSTODY_LABELS = {
  enc: PASSPORT_ENC_LABEL,
  maintenance: PASSPORT_MAINTENANCE_LABEL,
} as const;
