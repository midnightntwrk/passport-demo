/**
 * THE SECOND HALF OF COMING BACK ON A NEW DEVICE, as a function.
 *
 * The first half is a screen: a name typed, resolved, and checked against the
 * account's own device set, with the sign-in's key found in it
 * (`screens/CustodyPassport.tsx`). What it leaves behind is a hand-off record
 * (`../lib/custodyAdoption.ts`) and a device key newly made on this device.
 * This is everything that happens next, in the order it has to happen in.
 *
 *   1. build the new device from the key this device now holds
 *   2. add it to the account, with the SIGN-IN approving — the new key cannot
 *      add itself, which is the whole reason a spare key exists
 *   3. point the account's deliveries at the new key, with the NEW key
 *      approving, so anything paid in from now on is readable here
 *   4. write the record, the name, and the pointer, so the next open goes
 *      straight to the Passport with no ceremony at all
 *   5. read back, from the sign-in, the key the payments sent before today
 *      were sealed to, and give it this device's new key to keep beside it
 *
 * The hand-off itself is cleared by the CALLER, once this resolves. Nothing
 * here clears it: a failure halfway through is a recovery to be resumed, and a
 * record deleted on the way past would send somebody back to the beginning of
 * a flow that had already half worked.
 *
 * WHY IT IS NOT IN `App.tsx`. Because every line of it is a decision about an
 * account — which key signs which step, what is written down and when, and what
 * a failure halfway through leaves behind — and `App.tsx` is where those
 * decisions go to become invisible. It is also why the order above is the
 * order: each step is safe to repeat, so a browser closed between any two of
 * them comes back and finishes rather than starting again.
 *
 * WHAT IT CANNOT DO BY ITSELF, STATED ONCE. Deliveries the account already
 * holds were sealed to the key on the device that is gone, and step 3 does not
 * open them: a client that cannot read a delivery cannot re-seal it under a new
 * key, and there is nothing a social sign-in can reproduce on a new device that
 * would let it. So what THIS function brings back is the Passport, its name,
 * its ability to be paid and to pay — and not the descriptions of tokens it was
 * sent before today.
 *
 * WHAT CLOSES IT (2026/09/26): the sign-in itself. When it was added as the
 * way back, the old device wrote its viewing key into the sign-in's metadata
 * with the provider (`./signInViewingKeys.ts`); step 5 reads it back and keeps
 * it as an EARLIER key of this account (`./viewingKeys.ts`), which the inbox
 * walk then tries beside the new one. Nothing is asked of the person.
 */

import { addDeviceK1, rotateEncKeyK1, defaultCustodyDeps, type CustodyPhase } from './custodyContractClient.js';
import { custodyEncPublicKey } from './custodyInbox.js';
import { passkeyCustodyDevice } from './passkeyCustody.js';
import { k1PrivateStateId, recoveredCustodyRecord, saveCustodyName } from './custodyContractSession.js';
import { saveCustodyRecord, type CustodyStorage } from './custodyContractPlan.js';
import { saveCustodyPasskeyPointer } from '../lib/custodyRoute.js';
import { rememberK1EncSecretKey } from './k1CoinStore.js';
import { restoreViewingKeyFromSignIn } from './signInViewingKeys.js';
import type { CustodyDynamicSession } from './custodyContractClient.js';
import type { K256DeviceIdentity } from './custodyContractSigning.js';
import type { AdoptionHandoff } from '../lib/custodyAdoption.js';

/** What the host supplies, and nothing it could work out for itself. */
export interface AdoptDeviceKeyOptions {
  /** The account a recovery found. See `../lib/custodyAdoption.ts`. */
  readonly handoff: AdoptionHandoff;
  /** One user-verified assertion's worth of contract root, derived on demand. */
  readonly contractRoot: () => Promise<Uint8Array>;
  /** The credential the pointer is filed under, so the next open is free. */
  readonly credentialId: string;
  /** The sign-in that found the account, and the key behind it. */
  readonly session: CustodyDynamicSession;
  readonly socialDevice: K256DeviceIdentity;
  /** `window.localStorage` in the app; a map in a drill. */
  readonly storage: CustodyStorage;
  readonly onPhase?: (phase: CustodyPhase) => void;
}

/** What the host needs back: the key every store of this Passport is under. */
export interface AdoptDeviceKeyResult {
  readonly userKey: string;
  /** Whether the account's deliveries were pointed at the new key. */
  readonly pointedAtNewKey: boolean;
}

export async function adoptDeviceKey(
  options: AdoptDeviceKeyOptions,
): Promise<AdoptDeviceKeyResult> {
  const { handoff, storage } = options;
  const module = await defaultCustodyDeps().contractModule();

  /* The root is READ and not retained, exactly as the passkey arm reads it.
     `passkeyCustodyDevice` derives from it and the buffer is zeroed here as
     well as there — twice costs nothing and a root left in memory is the one
     thing this flow must not leave behind. */
  const root = await options.contractRoot();
  let made;
  try {
    made = await passkeyCustodyDevice({ pure: module.pureCircuits, contractRoot: root });
  } finally {
    root.fill(0);
  }
  const device = made.device;

  /* STEP 2. The sign-in approves, because the new key is not on the account
     yet and therefore cannot approve anything. Already-enrolled is not an
     error here — see `addDeviceK1`, which is what makes this resumable. */
  await addDeviceK1(
    options.session,
    options.socialDevice,
    { arm: 'jubjub', pk: device.pk },
    options.onPhase,
  );

  /* The record comes BEFORE the rotation, and the order is the point: from
     here on the new key is on the account, and every call it makes needs a
     record to make it against. A browser closed between the two comes back to
     a Passport that works and deliveries that still point at the old key,
     which is exactly the state the screen's own sentence describes. */
  const userKey = made.userKey;
  saveCustodyRecord(
    storage,
    recoveredCustodyRecord({
      user: userKey,
      network: handoff.network,
      address: handoff.address,
      privateStateId: k1PrivateStateId(userKey),
      pkXHex: device.pk.x.toString(16),
      pkYHex: device.pk.y.toString(16),
    }),
  );
  saveCustodyName(storage, userKey, handoff.network, handoff.name);
  /* AND THE POINTER, which is what makes the NEXT open free: the key every
     store is under costs an assertion to derive, and a returning reader must
     not be asked for a fingerprint merely to be shown their own Passport. See
     `../lib/custodyRoute.ts`. */
  saveCustodyPasskeyPointer(storage, options.credentialId, handoff.network, userKey);

  /* STEP 3. The NEW key approves this one: it is the key whose secret the
     account is being pointed at, and it is on the account as of the call
     above. A failure here is not a failure of the recovery — the Passport is
     back, and what is lost is only the reading of deliveries made from now on,
     which the next open retries. */
  const account = { network: handoff.network, address: handoff.address };
  const secret = device.encSecretKeyHex;
  let pointedAtNewKey = false;
  try {
    /* A device with no secret of its own has nothing to point the account at.
       It cannot happen on this path — `passkeyCustodyDevice` always derives one
       — and the narrowing is the compiler's rather than a comment. */
    if (secret === undefined) throw new Error('this device has no key of its own to use');
    await rotateEncKeyK1(null, device, custodyEncPublicKey(secret), options.onPhase);
    rememberK1EncSecretKey(account, secret);
    pointedAtNewKey = true;
  } catch (cause) {
    console.warn('[account-custody] this Passport is back, but its deliveries still point at the other device', cause);
  }

  /* STEP 5 (2026/09/26). The payments this Passport was sent before today are
     sealed to the key on the device that is gone, and the sign-in that has
     just approved this device keeps that key for it — written when it was
     added as the way back. So it is read back and kept as an earlier key, and
     this device's new key goes in beside it for the next one. Run whether or
     not step 3 landed: the earlier key is needed for the earlier notes either
     way. Bounded, and never a failure of the recovery — a sign-in with nothing
     kept for this Passport leaves one that works, and says nothing new. */
  await restoreViewingKeyFromSignIn({ storage, account, signInUser: options.session.address });

  made.forget();
  return { userKey, pointedAtNewKey };
}
