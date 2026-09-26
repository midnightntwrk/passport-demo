/**
 * THE SECOND HALF OF COMING BACK ON A NEW DEVICE, as a function.
 *
 * The first half is a screen: a name typed, resolved, and checked against the
 * account's own device set, with the sign-in's key found in it
 * (`screens/CustodyPassport.tsx`). What it leaves behind is a hand-off record
 * (`../lib/custodyAdoption.ts`) and a device key newly made on this device.
 * This is everything that happens next, in the order it has to happen in.
 *
 *   0. write down, ON THIS DEVICE, the account the sign-in approves against
 *   1. build the new device from the key this device now holds
 *   2. add it to the account, with the SIGN-IN approving — the new key cannot
 *      add itself, which is the whole reason a spare key exists
 *   3. point the account's deliveries at the new key, with the NEW key
 *      approving, so anything paid in from now on is readable here
 *   4. write the record, the name, the way back, and the pointer, so the next
 *      open goes straight to the Passport with no ceremony at all
 *   5. record that this device should be asked for the person's password
 *      backup, which is what brings back the payments sent before today
 *
 * The hand-off itself is cleared by the CALLER, once this resolves. Nothing
 * here clears it: a failure halfway through is a recovery to be resumed, and a
 * record deleted on the way past would send somebody back to the beginning of
 * a flow that had already half worked.
 *
 * STEP 0, AND THE DEFECT IT CLOSES (live, 2026/09/26). Step 2 is a gated call
 * made by the sign-in, and every gated call reads its signer's record on this
 * device first — refusing, without one, with "This Passport is not finished
 * being set up yet." A genuinely new device has no record for the sign-in:
 * the name check files nothing under its key (the ruling of 2026/09/22), and
 * the only record this function used to write was the NEW key's, after step 2.
 * So the add was refused on every new device before a signature was asked for,
 * and the screen waited on it for ever. Every drill of this road had run where
 * such a record already existed. See `adoptionApproverRecord` for what is
 * written and why it is the truth about the account.
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
 * WHAT CLOSES IT (2026/09/26): the person's password backup. It carries the
 * old device's viewing key (`./backup.ts`), and a restore gives it back as an
 * EARLIER key of this account (`./viewingKeys.ts`), which the inbox walk then
 * tries beside the new one. Step 5 below records that this device should be
 * asked for that backup, and the screen asks once.
 */

import {
  addDeviceK1,
  defaultCustodyDeps,
  k1UserKey,
  rotateEncKeyK1,
  type CustodyDeps,
  type CustodyPhase,
} from './custodyContractClient.js';
import { custodyEncPublicKey } from './custodyInbox.js';
import { passkeyCustodyDevice } from './passkeyCustody.js';
import {
  adoptionApproverRecord,
  k1PrivateStateId,
  recoveredCustodyRecord,
  saveCustodyName,
} from './custodyContractSession.js';
import {
  loadCustodyRecord,
  saveCustodyRecord,
  withinCustodyBound,
  type CustodyStorage,
} from './custodyContractPlan.js';
import { saveCustodyPasskeyPointer } from '../lib/custodyRoute.js';
import { saveBackupRecord } from '../lib/backupDevice.js';
import {
  ADOPTION_OTHER_PASSPORT,
  ADOPTION_OTHER_SIGN_IN,
  ADOPTION_UNCONFIRMED,
} from '../lib/custodyAdoption.js';
import { RECOVERY_ADD_WAIT_MS, adoptionFailureSentence } from '../lib/recoveryAdd.js';
import { rememberK1EncSecretKey } from './k1CoinStore.js';
import { offerEarlierPayments } from './viewingKeys.js';
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
  /**
   * What the person signed in with ("Google"), for the line Home shows about
   * the way back — or null where it is not known.
   */
  readonly provider?: string | null;
  /** `window.localStorage` in the app; a map in a drill. */
  readonly storage: CustodyStorage;
  readonly onPhase?: (phase: CustodyPhase) => void;
  /**
   * The custody client's seams, for a drill or the mocked walk; nothing in the
   * app. Whatever is passed, the client reads {@link storage} — the storage the
   * records below are written to — so a step can never be refused over a record
   * that was written somewhere else.
   */
  readonly overrides?: Partial<CustodyDeps>;
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
  const deps: Partial<CustodyDeps> = { ...options.overrides, storage: () => storage };

  /* STEP 0. The sign-in that found the account is the one that approves: its
     key is what the check found in the account's device set. Any other would
     be asked to approve an addition the account would refuse, so it is told
     so before anybody is asked for anything. */
  const socialUser = k1UserKey(options.session);
  if (socialUser !== handoff.socialUser.toLowerCase()) {
    throw new Error(ADOPTION_OTHER_SIGN_IN);
  }
  /* And the sign-in's own record ON THIS DEVICE, which step 2 reads before it
     does anything — see the header for the day it was not there. */
  const approver = adoptionApproverRecord({
    stored: loadCustodyRecord(storage, socialUser, handoff.network),
    user: socialUser,
    network: handoff.network,
    address: handoff.address,
    pk: options.socialDevice.pk,
  });
  if (approver.kind === 'other-passport') {
    console.warn('[account-custody] this sign-in already opens a different Passport in this browser; nothing was changed');
    throw new Error(ADOPTION_OTHER_PASSPORT);
  }
  if (approver.kind === 'write') saveCustodyRecord(storage, approver.record);

  const module = await (deps.contractModule ?? defaultCustodyDeps().contractModule)();

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

  try {
    /* STEP 2. The sign-in approves, because the new key is not on the account
       yet and therefore cannot approve anything. Already-enrolled is not an
       error here — see `addDeviceK1`, which is what makes this resumable. */
    await addDeviceK1(
      options.session,
      options.socialDevice,
      { arm: 'jubjub', pk: device.pk },
      options.onPhase,
      deps,
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
    /* THE WAY BACK IS ON, and it is the one that just brought this Passport
       here: the sign-in's key approved step 2, so it is on the account. Written
       down so this device's Home says so, rather than offering to add, as a
       first step on the new device, the way back that has just been used. */
    const provider = typeof options.provider === 'string' ? options.provider.trim() : '';
    saveBackupRecord(storage, userKey, handoff.network, {
      doneAt: Date.now(),
      ...(provider.length > 0 ? { provider } : {}),
    });
    /* AND THE POINTER, which is what makes the NEXT open free: the key every
       store is under costs an assertion to derive, and a returning reader must
       not be asked for a fingerprint merely to be shown their own Passport. See
       `../lib/custodyRoute.ts`. Last of the four, because it is the one that
       moves the host to the Passport. */
    saveCustodyPasskeyPointer(storage, options.credentialId, handoff.network, userKey);

    /* STEP 3. The NEW key approves this one: it is the key whose secret the
       account is being pointed at, and it is on the account as of the call
       above. A failure here is not a failure of the recovery — the Passport is
       back, and what is lost is only the reading of deliveries made from now
       on. It is bounded (`rotateEncKeyK1`), so it cannot hold the screen. */
    const account = { network: handoff.network, address: handoff.address };
    const secret = device.encSecretKeyHex;
    let pointedAtNewKey = false;
    try {
      /* A device with no secret of its own has nothing to point the account at.
         It cannot happen on this path — `passkeyCustodyDevice` always derives one
         — and the narrowing is the compiler's rather than a comment. */
      if (secret === undefined) throw new Error('this device has no key of its own to use');
      await rotateEncKeyK1(null, device, custodyEncPublicKey(secret), options.onPhase, deps);
      rememberK1EncSecretKey(account, secret);
      pointedAtNewKey = true;
    } catch (cause) {
      console.warn('[account-custody] this Passport is back, but its deliveries still point at the other device', cause);
    }

    /* STEP 5 (2026/09/26). The payments this Passport was sent before today are
       sealed to the key on the device that is gone, and the one thing that can
       bring that key back is the person's own password backup. So the recovery
       ends by recording the question — "do you have a backup?" — for the screen
       to ask once. Written whether or not step 3 landed: the earlier key is
       needed for the earlier notes either way. */
    offerEarlierPayments(storage, account);

    return { userKey, pointedAtNewKey };
  } finally {
    /* On every road out, a failure included: the derived secrets are this
       flow's to zero, and a retry derives them again from a fresh assertion. */
    made.forget();
  }
}

/* -------------------------------------------------------------------------- */
/* The whole of it, as the host runs it: bounded, and ending in a sentence    */
/* -------------------------------------------------------------------------- */

/** What the host is told: the Passport is here, or one sentence and why. */
export type AdoptionOutcome =
  | { readonly kind: 'back'; readonly result: AdoptDeviceKeyResult }
  | { readonly kind: 'failed'; readonly sentence: string; readonly cause: unknown };

/**
 * A last net under the whole hand-off — the same one adding a way back has
 * (`../lib/recoveryAdd.ts`). Every step inside is bounded on its own: the
 * sign-in's approval and everything before the hand-over, the proof, the wait
 * for the chain, the rechecks. This catches what is not, and an outcome it
 * catches is one nobody saw, so it says so.
 */
export const ADOPTION_WAIT_MS = RECOVERY_ADD_WAIT_MS;

/**
 * {@link adoptDeviceKey}, bounded, with the sign-in's key asked for inside the
 * bound, and every way it can end turned into something the screen can say.
 *
 * NEVER REJECTS. What stood in `App.tsx` caught every failure with a console
 * line and nothing else, never ran the second half again, and left "Adding this
 * device to …" on screen for ever (live, 2026/09/26). A failure is now a
 * sentence (`../lib/recoveryAdd.ts#adoptionFailureSentence`) and the cause, for
 * the host to show and log, and the host's "Try again" runs this again — which
 * is safe, because every step of it is.
 */
export async function bringPassportHere(
  options: Omit<AdoptDeviceKeyOptions, 'socialDevice'> & {
    /** The sign-in's key. Asked for inside the bound: a sign-in can hang too. */
    readonly socialDevice: () => Promise<K256DeviceIdentity>;
    /** {@link ADOPTION_WAIT_MS}, or a drill's shorter one. */
    readonly waitMs?: number;
  },
): Promise<AdoptionOutcome> {
  const waitMs = options.waitMs ?? ADOPTION_WAIT_MS;
  try {
    const run = await withinCustodyBound(
      options.socialDevice().then((socialDevice) => adoptDeviceKey({ ...options, socialDevice })),
      waitMs,
    );
    if (run.kind === 'timeout') {
      return {
        kind: 'failed',
        sentence: ADOPTION_UNCONFIRMED,
        cause: new Error(`bringing this Passport here did not finish in ${Math.round(waitMs / 1000)} s`),
      };
    }
    return { kind: 'back', result: run.value };
  } catch (cause) {
    return { kind: 'failed', sentence: adoptionFailureSentence(cause), cause };
  }
}
