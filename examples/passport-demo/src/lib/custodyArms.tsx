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
 * THE DEVICE IS BUILT ONCE PER SCREEN AND HELD, not rebuilt per call. A signer
 * holds the derived scalar, and that is exactly what makes one send one prompt:
 * the spend, its position retries, and the backfill that follows are all
 * authorised by the signer the one assertion produced.
 */
export function usePasskeyCustodyArm(input: PasskeyArmInput): CustodyArm {
  const built = useRef<CustodyIdentity | null>(null)
  const { contractRoot, knownUserKey, remember, ready } = input

  const ensureIdentity = useCallback(async (): Promise<CustodyIdentity> => {
    if (built.current) return built.current
    const [{ passkeyCustodyDevice }, { defaultCustodyDeps }] = await Promise.all([
      import('../identity/passkeyCustody.js'),
      import('../identity/custodyContractClient.js'),
    ])
    const module = await defaultCustodyDeps().contractModule()
    const root = await contractRoot()
    let device
    try {
      device = await passkeyCustodyDevice({ pure: module.pureCircuits, contractRoot: root })
    } finally {
      /* The root's only job is done. Nothing here retains it, and the host is
         welcome to zero it too — `fill` twice costs nothing and a root left in
         a buffer is the one thing this arm must not leave behind. */
      root.fill(0)
    }
    const identity: CustodyIdentity = { device: device.device, userKey: device.userKey }
    built.current = identity
    remember(identity.userKey)
    return identity
  }, [contractRoot, remember])

  return useMemo(
    () => ({
      kind: 'passkey',
      userKey: knownUserKey,
      /* NO VENDOR, so no session. `null` is narrower than a stub with an empty
         address, which is what a Passport would have been filed under the first
         time anybody mixed the arms up. */
      session: null,
      ready,
      ensureIdentity,
      approvalPrompt: PASSKEY_APPROVAL_PROMPT,
      ...PASSKEY_COPY,
    }),
    [ensureIdentity, knownUserKey, ready],
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
 * The social sign-in arm, unchanged below the seam.
 *
 * The point is recovered from two signatures over digests Passport chose,
 * because the sign-in hands out an address and nothing else. The address it is
 * handed back by a caller is ignored on purpose: the bridge already closes over
 * the key it signs with, and letting a caller name another would be a way to
 * ask the wrong one for an approval.
 */
export function useDynamicCustodyArm(session: DynamicArmInput): CustodyArm {
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
    if (built.current) return built.current
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

  return useMemo(
    () => ({
      kind: 'dynamic',
      userKey: evmAddress === null || evmAddress === '' ? null : evmAddress.toLowerCase(),
      session: custodySession,
      /* The same question `choosePassportIdentity` asks, narrowed to what this
         screen needs: signed in, with an embedded key. */
      ready: status === 'signed-in' && typeof evmAddress === 'string' && evmAddress.length > 0,
      ensureIdentity,
      /* The reader chose Google, not a vendor, so the prompt names the provider
         they recognise. */
      approvalPrompt:
        provider === null || provider.trim().length === 0
          ? 'Approve with the account you signed in with'
          : `Approve with your ${provider.trim()} account`,
      kicker: `Signed in with ${provider ?? 'your sign-in'}`,
      /* TRUE OF THIS ARM AS OF 2026/09/21, and it was not before. The sentence
         used to read "…is all Passport needs", which described a Passport whose
         only key was the sign-in — the shape that day retired. A sign-in is now
         the SPARE key on a Passport the device holds, so the lede says what the
         next press will actually do: make a key here, and keep the sign-in as
         the way back. See `./custodyAdoption.ts`. */
      lede:
        `Signed in as ${handle ?? 'your account'}. Passport will make a key on this device to ` +
        'hold your Passport, and your sign-in becomes the way back if you lose it.',
      badge: `${provider ?? 'your sign-in'} · ${handle ?? 'your account'}`,
      keyPhrase: `your ${provider ?? 'sign-in'} sign-in`,
      otherKeyHint: 'If you have more than one sign-in, go back and use the other one.',
    }),
    [custodySession, ensureIdentity, evmAddress, handle, provider, status],
  )
}
