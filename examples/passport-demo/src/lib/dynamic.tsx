import { useCallback, useEffect, useSyncExternalStore } from 'react'

import {
  DISABLED_SESSION,
  DYNAMIC_SOCIAL_PROVIDERS,
  describeDynamicSession,
  dynamicEnvironmentId,
  publishDynamicActions,
  publishDynamicSession,
  readDynamicActions,
  readDynamicSession,
  subscribeToDynamicSession,
  type DynamicSession,
} from './dynamicSession.js'

/**
 * The only module in this app that names `@dynamic-labs`, and it names it
 * exactly twice — both times inside `import()`, inside a function that is
 * never called unless `VITE_DYNAMIC_ENVIRONMENT_ID` is set.
 *
 * WHY THE PROVIDER IS NOT AN ANCESTOR OF THE APP
 * ----------------------------------------------
 * `DynamicContextProvider` is mounted in a SECOND React root, on a `<div>` of
 * its own appended to `document.body`, and the Passport tree is left exactly
 * as it is. The obvious shape — wrap `<PassportDemo />` once the chunk lands —
 * changes the app's tree structure at an arbitrary moment during boot, and
 * React reconciles by position: inserting a provider above a subtree unmounts
 * and remounts that subtree. Mid-onboarding that is a passkey ceremony
 * abandoned halfway and every piece of component state gone.
 *
 * Nothing is lost by the separation. Dynamic's auth flow is an overlay it
 * renders itself, not something the app composes, and the session crosses back
 * over the module-level store in `dynamicSession.ts` — which both roots can
 * see because it is a module, not a context.
 *
 * WHAT THE DASHBOARD DECIDES, AND THIS FILE CANNOT
 * ------------------------------------------------
 * Three things here are requests, not settings:
 *
 *   - WHICH social providers appear. `socialProvidersFilter` narrows the list
 *     the environment already has switched on; it cannot switch one on. A
 *     provider missing from the Dynamic dashboard's Authentication page does
 *     not appear because it is named in `DYNAMIC_SOCIAL_PROVIDERS`.
 *   - WHETHER an embedded Ethereum wallet is created on sign-in. That is
 *     Embedded Wallets → chains and automatic creation, in the dashboard.
 *     There is no client-side flag for it, which is why `evmAddress` is
 *     allowed to be null on a signed-in session rather than asserted.
 *   - WHETHER this origin may talk to the environment at all — Allowed
 *     Origins.
 *
 * `docs/demo/dynamic-integration.md` lists all of them with the values a
 * staging environment needs.
 */

/** Guards against a second mount when a hot reload re-runs the entry module. */
let mounted = false

/**
 * Brings the Dynamic SDK into the page, on its own root.
 *
 * Resolves when the provider has been rendered, or immediately when there is
 * no environment id. It never throws into the caller: a sign-in that cannot
 * load is a missing secondary control, not a Passport that fails to start, and
 * the entry module must not acquire a way to fail.
 */
export async function mountDynamic(): Promise<void> {
  const environmentId = dynamicEnvironmentId()
  if (!environmentId || mounted) return
  mounted = true

  publishDynamicSession({ ...DISABLED_SESSION, status: 'loading' })

  try {
    /* The two `import()` calls this whole file exists to contain. Rollup gives
       them chunks of their own; nothing below reaches the entry graph. */
    const [core, ethereum, reactDom] = await Promise.all([
      import('@dynamic-labs/sdk-react-core'),
      import('@dynamic-labs/ethereum'),
      import('react-dom/client'),
    ])

    const host = document.createElement('div')
    host.id = 'mn-dynamic-root'
    document.body.appendChild(host)

    const { DynamicContextProvider, useDynamicContext, useRefreshUser, useUserUpdateRequest } = core

    /**
     * Reads Dynamic's context and publishes it. Renders nothing: the only
     * thing the app wants from this root is the store write.
     */
    function DynamicBridge() {
      const context = useDynamicContext()
      const wallet = context.primaryWallet
      /* Pulled out so the effects below depend on the two functions rather
         than on the whole context object, which is rebuilt on every one of the
         SDK's own renders and would re-register the actions each time. */
      const { setShowAuthFlow, handleLogOut, sdkHasLoaded, user } = context
      /* THE USER'S METADATA, READ AND WRITTEN (2026/09/26), for the key that
         reads a Passport's payments, kept beside its way back — see
         `../identity/signInViewingKeys.ts`. `updateUser` is the SDK's own
         (`useUserUpdateRequest`, typed in 5.8.0's
         `useUpdateUser.d.ts`); `useRefreshUser` re-reads the user from the
         provider rather than this browser's copy. */
      const { updateUser } = useUserUpdateRequest()
      const refreshUser = useRefreshUser()

      /* Both writes are effects rather than render-time statements. The store
         they write wakes `useSyncExternalStore` subscribers in the OTHER root,
         and React refuses — loudly, and correctly — to be told to update one
         component while another is rendering. */
      useEffect(() => {
        publishDynamicSession(
          describeDynamicSession({
            sdkHasLoaded,
            user,
            walletAddress: wallet?.address,
          }),
        )
      }, [sdkHasLoaded, user, wallet?.address])

      useEffect(() => {
        publishDynamicActions({
          openAuthFlow: () => setShowAuthFlow(true),
          signMessage: async (text: string) => {
            if (!wallet) throw new Error('Sign in first — there is no key to sign with yet.')
            const signature = await wallet.signMessage(text)
            /* `signMessage` resolves with `undefined` when the signer declines
               or the connector has no answer, which reads as success to every
               `await` that does not check. The next slice is going to compare
               signatures byte for byte, so an absent one has to be an error
               here rather than an empty string three files away. */
            if (!signature) throw new Error('Nothing was signed. The request may have been dismissed.')
            return signature
          },
          /* THE RAW PATH, and the only one the custody account contract can verify.
             It is reached through the CONNECTOR rather than the wallet, because
             `signRawMessage` is a capability of Dynamic's embedded (WaaS)
             connector and not of the wallet interface every connector
             satisfies — an externally connected MetaMask has no such method,
             and the `typeof` check below is what says so in a sentence instead
             of throwing `is not a function` from inside the vendor.

             The 64-hex, no-`0x` argument shape is the SDK's, not ours:
             `@dynamic-labs-sdk/client` enforces
             `RAW_MESSAGE_MESSAGE_REQUIRED_LENGTH = 64` and throws otherwise. */
          signRaw: async (digestHex: string) => {
            if (!wallet) throw new Error('Sign in first — there is no key to sign with yet.')
            const connector = wallet.connector as unknown as {
              signRawMessage?: (input: {
                accountAddress: string
                message: string
              }) => Promise<string | undefined>
            }
            if (typeof connector?.signRawMessage !== 'function') {
              throw new Error('This sign-in cannot approve Passport actions yet.')
            }
            const signature = await connector.signRawMessage({
              accountAddress: wallet.address,
              message: digestHex,
            })
            if (!signature) throw new Error('Nothing was signed. The request may have been dismissed.')
            return signature
          },
          signOut: async () => {
            await handleLogOut()
          },
          /* `user.metadata` is the copy the sign-in itself filled — the
             provider's sign-in answer carries it (`SdkUser.metadata`, and
             `convertSdkUserToUserProfile` passes it through) — so a new device
             that has just signed in reads it with no further request. */
          readMetadata: async ({ fresh }) => {
            if (!user) throw new Error('Sign in first — there is nobody to read.')
            if (!fresh) return user.metadata
            const refreshed = await refreshUser()
            return refreshed?.metadata
          },
          /* The SDK merges the top level of what it is given over its own copy
             before it sends it; the caller has already merged over a fresh
             read, so what is sent is the whole of what should be kept. The
             answer is the provider's own record of the user. */
          writeMetadata: async (metadata) => {
            if (!user) throw new Error('Sign in first — there is nobody to write to.')
            const result = await updateUser({ metadata: { ...metadata } })
            return result.updateUserProfileResponse.user.metadata
          },
        })
      }, [setShowAuthFlow, handleLogOut, wallet, user, updateUser, refreshUser])

      return null
    }

    reactDom.createRoot(host).render(
      <DynamicContextProvider
        settings={{
          environmentId,
          walletConnectors: [ethereum.EthereumWalletConnectors],
          appName: 'Midnight Passport',
          /* A pop-up rather than a redirect. A redirect discards this tab, and
             this tab is holding a half-finished passkey ceremony. */
          social: { strategy: 'popup' },
          /* Deliberately unannotated: the parameter takes its type from the
             settings object, which is Dynamic's own provider enum rather than
             `string`. Writing `string[]` here compiled against 4.96.0 and does
             not against 5.8.0, and the version that does not is the honest
             one — this narrows a list the vendor owns. */
          socialProvidersFilter: (providers) =>
            providers.filter((provider) =>
              (DYNAMIC_SOCIAL_PROVIDERS as readonly string[]).includes(provider),
            ),
        }}
      >
        <DynamicBridge />
      </DynamicContextProvider>,
    )
  } catch {
    /* Back to a seam that offers nothing. Every screen renders the same shape
       it renders in a build with no environment id at all. */
    publishDynamicSession(DISABLED_SESSION)
    publishDynamicActions(null)
  }
}

/**
 * The session, for a screen.
 *
 * Safe to call from anywhere, including a build with no environment id, where
 * it returns the disabled session for ever and subscribes to a store nothing
 * ever writes. It imports no SDK, so a screen that calls it stays in the entry
 * chunk where it belongs.
 *
 * Not unit-tested, and deliberately: this workspace has no jsdom (see
 * `vitest.config.ts`), so the convention is that hooks stay thin and the
 * decisions live in a pure module. Everything this returns is computed by
 * `describeDynamicSession` in `dynamicSession.ts`, which is drilled directly.
 */
export function useDynamicSession(): DynamicSession & {
  /** Opens Dynamic's sign-in overlay, or does nothing when there is no seam. */
  openAuthFlow: () => void
  /** Signs `text` with the embedded Ethereum key. */
  signMessage: (text: string) => Promise<string>
  /** Signs a 64-hex digest verbatim. The only path a custody account can verify. */
  signRaw: (digestHex: string) => Promise<string>
  /** Ends the Dynamic session, leaving the Passport passkey alone. */
  signOut: () => Promise<void>
} {
  const session = useSyncExternalStore(
    subscribeToDynamicSession,
    readDynamicSession,
    /* The server snapshot. There is no server render here, and this is the
       honest answer for one if there ever is. */
    () => DISABLED_SESSION,
  )

  const openAuthFlow = useCallback(() => {
    readDynamicActions()?.openAuthFlow()
  }, [])

  const signMessage = useCallback(async (text: string) => {
    const actions = readDynamicActions()
    if (!actions) throw new Error('Sign-in is still starting up. Try again in a moment.')
    return actions.signMessage(text)
  }, [])

  const signRaw = useCallback(async (digestHex: string) => {
    const actions = readDynamicActions()
    if (!actions) throw new Error('Sign-in is still starting up. Try again in a moment.')
    return actions.signRaw(digestHex)
  }, [])

  const signOut = useCallback(async () => {
    await readDynamicActions()?.signOut()
    /* THE NEXT PERSON TO SIGN IN ON THIS TAB IS NOT THIS ONE. The custody layer
       caches a maintenance signing key per account for the life of the tab, so
       signing out has to drop it — otherwise a second sign-in in the same tab
       carries the first one's key. Imported lazily: this hook is on the entry
       graph and the custody layer must not be. */
    const { resetCustodySessionState } = await import('../identity/custodyContractClient.js')
    resetCustodySessionState()
  }, [])

  return { ...session, openAuthFlow, signMessage, signRaw, signOut }
}
