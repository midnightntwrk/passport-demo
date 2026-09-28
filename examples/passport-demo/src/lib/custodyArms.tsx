/**
 * THE TWO ADAPTERS, and the hooks that build them.
 *
 * `./custodyArm.ts` is the contract between `screens/CustodyPassport.tsx` and
 * whoever is holding the Passport. This file is the two implementations of it,
 * kept apart from the types so that a host importing the CONTRACT does not pull
 * a vendor boundary or a passkey ceremony into its chunk.
 *
 * Neither hook reaches the custody client statically. Both settle their device
 * behind an `import()`, which is what keeps the wallet facade, its WASM ledger,
 * and its chain sync out of the entry chunk for every visitor of every build —
 * the same rule, and the same measurement, as the lazy screen itself.
 */

import { useCallback, useMemo, useRef } from 'react'

import {
  PASSKEY_APPROVAL_PROMPT,
  PASSKEY_COPY,
  type CustodyArm,
  type CustodyIdentity,
} from './custodyArm.js'
import {
  providerApproval,
  startPasskeyApproval,
  type CustodyApproval,
} from './custodyApproval.js'

/* -------------------------------------------------------------------------- */
/* A Passport held by a passkey                                               */
/* -------------------------------------------------------------------------- */

/** What the passkey arm needs from its host, and nothing more. */
export interface PasskeyArmInput {
  /**
   * One user-verified assertion's worth of contract root, derived on demand.
   *
   * The host owns the ceremony — it holds the profile, the watchdog, and the
   * one-prompt-per-action rule — and hands back the 32 bytes. This arm reads
   * them, derives, and does not retain them; the host is free to zero the
   * buffer the moment the promise it returned resolves.
   *
   * IT MUST RAISE THE PROMPT BEFORE ITS FIRST AWAIT. This arm calls it before
   * anything else, so that a press which asks for an approval is still the
   * gesture the browser sees when `navigator.credentials.get` is called.
   */
  readonly contractRoot: () => Promise<Uint8Array>
  /** The user key a previous visit recorded for this passkey, or null. */
  readonly knownUserKey: string | null
  /** Remember which Passport this passkey holds, once it is known. */
  readonly remember: (userKey: string) => void
  /** Whether the host is far enough along to show a Passport at all. */
  readonly ready: boolean
}

/**
 * The passkey arm.
 *
 * A FRESH ASSERTION FOR EVERY ACTION, AND NOTHING THAT CAN SIGN IS KEPT
 * (2026/09/27). This arm used to build the device once and hold it for the life
 * of the page, "so that one send is one prompt" — which made every send after
 * the first one no prompt at all: "I can send transfers without being prompted
 * to confirm the transaction with my passkeys." Now each `approve` asks for its
 * own assertion, builds its own device, and hands back the release that ends
 * it. One send is still one prompt — the spend, its position retries, and the
 * note of its change are all signed by that one approval — and the next send is
 * one more. See `./custodyApproval.ts`.
 *
 * What is kept is public: the user key, as the pointer `remember` writes.
 */
export function usePasskeyCustodyArm(input: PasskeyArmInput): CustodyArm {
  const { contractRoot, knownUserKey, remember, ready } = input

  const approve = useCallback(
    (): CustodyApproval<CustodyIdentity> =>
      startPasskeyApproval<CustodyIdentity>({
        /* FIRST, before anything is awaited: the prompt goes up in the same
           turn as the press that asked for it. */
        contractRoot,
        build: async (root) => {
          const [{ passkeyCustodyDevice }, { defaultCustodyDeps }] = await Promise.all([
            import('../identity/passkeyCustody.js'),
            import('../identity/custodyContractClient.js'),
          ])
          const module = await defaultCustodyDeps().contractModule()
          /* The root is READ here and zeroed by the approval the moment this
             settles; nothing in this arm retains it. */
          const made = await passkeyCustodyDevice({ pure: module.pureCircuits, contractRoot: root })
          /* The public half is kept: it is what every store is filed under. */
          remember(made.userKey)
          return {
            identity: { device: made.device, userKey: made.userKey },
            forget: () => made.forget(),
          }
        },
      }),
    [contractRoot, remember],
  )

  return useMemo(
    () => ({
      kind: 'passkey',
      userKey: knownUserKey,
      /* NO VENDOR, so no session. `null` is narrower than a stub with an empty
         address, which is what a Passport would have been filed under the first
         time anybody mixed the arms up. */
      session: null,
      ready,
      approve,
      approvalPrompt: PASSKEY_APPROVAL_PROMPT,
      ...PASSKEY_COPY,
    }),
    [approve, knownUserKey, ready],
  )
}

/* -------------------------------------------------------------------------- */
/* A Passport held by a social sign-in                                        */
/* -------------------------------------------------------------------------- */

/** The half of `useDynamicSession` this arm reads. */
export interface DynamicArmInput {
  readonly evmAddress: string | null
  readonly handle: string | null
  readonly provider: string | null
  readonly status: string
  readonly signRaw: (digestHex: string) => Promise<string>
}

/**
 * The social sign-in arm, and the one thing the host asks of it directly.
 *
 * `ensureIdentity` is the sign-in's key as a device, which the host needs on
 * its own — to recognise the way back, and to approve bringing a Passport to a
 * new device — and which nothing on this arm can sign with by itself: the
 * signatures are the provider's.
 */
export interface DynamicCustodyArm extends CustodyArm {
  ensureIdentity(): Promise<CustodyIdentity>
}

/**
 * The social sign-in arm, unchanged below the seam.
 *
 * The point is recovered from two signatures over digests Passport chose,
 * because the sign-in hands out an address and nothing else. The address it is
 * handed back by a caller is ignored on purpose: the bridge already closes over
 * the key it signs with, and letting a caller name another would be a way to
 * ask the wrong one for an approval.
 *
 * ITS APPROVAL IS THE PROVIDER'S, call by call. The identity cached here is a
 * public point and a flag, and signs nothing: every gated call this arm makes
 * goes out through `signRaw`, and whether the provider asks the person before
 * it signs is the provider's setting, not this app's. So `approve` asks for
 * nothing and has nothing to release (`providerApproval`), and the rule of
 * 2026/09/27 — a fresh passkey approval per transaction — is the passkey arm's.
 */
export function useDynamicCustodyArm(session: DynamicArmInput): DynamicCustodyArm {
  const built = useRef<CustodyIdentity | null>(null)
  const { evmAddress, handle, provider, status, signRaw } = session

  const custodySession = useMemo(
    () => ({
      address: evmAddress ?? '',
      /* Not `async`: the vendor's own promise is handed straight back, and
         wrapping it would only add a tick. The address a caller hands in is
         ignored on purpose — see the header. */
      signRaw: (input: { accountAddress: string; message: string }) => signRaw(input.message),
    }),
    [evmAddress, signRaw],
  )

  const ensureIdentity = useCallback(async (): Promise<CustodyIdentity> => {
    /* ONLY THIS SIGN-IN'S KEY (2026/09/24). The cache outlived the sign-in it
       was made for: signed out and back in as somebody else in the same tab,
       the next ask returned the FIRST account's key — and adding recovery
       would have put that key on the Passport. It is keyed on the address the
       session reports now, and a session with no address yet has no key. */
    if (custodySession.address.length === 0) {
      throw new Error('Your sign-in is still finishing. Try again in a moment.')
    }
    if (built.current && built.current.userKey === custodySession.address.toLowerCase()) {
      return built.current
    }
    const [{ recoverK1DevicePoint, k1UserKey }, { recoverSecp256k1Point }, signing] =
      await Promise.all([
        import('../identity/custodyContractClient.js'),
        import('./custodyRecover.js'),
        import('../identity/custodyContractSigning.js'),
      ])
    const pk = await recoverK1DevicePoint({
      session: custodySession,
      recover: recoverSecp256k1Point,
    })
    const identity: CustodyIdentity = {
      device: { arm: 'k256', pk, envelope: signing.K256_ENVELOPE_NONE },
      userKey: k1UserKey(custodySession),
    }
    built.current = identity
    return identity
  }, [custodySession])

  const approve = useCallback(
    (): CustodyApproval<CustodyIdentity> => providerApproval(ensureIdentity),
    [ensureIdentity],
  )

  return useMemo(
    () => ({
      kind: 'dynamic',
      userKey: evmAddress === null || evmAddress === '' ? null : evmAddress.toLowerCase(),
      session: custodySession,
      /* The same question `choosePassportIdentity` asks, narrowed to what this
         screen needs: signed in, with an embedded key. */
      ready: status === 'signed-in' && typeof evmAddress === 'string' && evmAddress.length > 0,
      ensureIdentity,
      approve,
      /* The reader chose Google, not a vendor, so the prompt names the provider
         they recognise. */
      approvalPrompt:
        provider === null || provider.trim().length === 0
          ? 'Approve with the account you signed in with'
          : `Approve with your ${provider.trim()} account`,
      kicker: `Signed in with ${provider ?? 'your sign-in'}`,
      lede:
        `${handle ?? 'your account'} is all Passport needs. Nothing else to remember, and ` +
        'nothing to install — the same sign-in brings your Passport back on any device.',
      badge: `${provider ?? 'your sign-in'} · ${handle ?? 'your account'}`,
      keyPhrase: `your ${provider ?? 'sign-in'} sign-in`,
      otherKeyHint: 'If you have more than one sign-in, go back and use the other one.',
    }),
    [approve, custodySession, ensureIdentity, evmAddress, handle, provider, status],
  )
}
