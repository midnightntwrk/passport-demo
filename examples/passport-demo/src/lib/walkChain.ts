/**
 * A STAND-IN FOR THE CHAIN, for the mocked walk of bringing a Passport to a new
 * device — and for nothing else (2026/09/26).
 *
 * WHY IT HAS TO EXIST
 * -------------------
 * Bringing a Passport to a new device ends in two gated calls on the account:
 * the sign-in adds this device's key, and the new key points the account's
 * deliveries at itself. The mocked tier has no proving service and no chain to
 * take either, so every walk of this road stopped short of it — at the name
 * check, or by SEEDING the state the calls would have left — and none of them
 * ever ran the code in front of the calls on an empty browser. That code is
 * where the defect of 2026/09/26 was: the add refused before it asked for a
 * signature, because the sign-in had no record on the new device.
 *
 * WHAT IS REPLACED, AND WHAT IS NOT
 * ---------------------------------
 * Replaced: midnight-js's build of the unproven call and its hand-over (proof,
 * balance, submission), and the indexer's answer about the transaction. That
 * is the proving service and the chain, and nothing nearer the app.
 *
 * NOT replaced: everything in front of the hand-over — the records the
 * adoption writes and the guards that read them, the account opened against
 * its real recorded deploy with its verifier keys checked, the account's state
 * read and decoded by the compiled module, the device-set scan, the entry the
 * contract's own pure circuit derives, and the signature, made by the
 * stand-in sign-in's real secp256k1 key or this device's passkey-derived key.
 *
 * The walk is TOLD what was handed over — the circuit, and its first argument —
 * by a request to {@link WALK_CHAIN_URL}, and it answers once the account state
 * it serves carries the result, which is what "the chain took it" means to
 * everything that reads the account afterwards. An answer other than 200 is a
 * refusal, raised as the proving service's own refusal is.
 *
 * WHY IT CANNOT REACH A SHIPPED BUILD
 * -----------------------------------
 * `App.tsx` imports this module only inside `import.meta.env.
 * VITE_PASSPORT_ACC_WALK === '1'`, written out, which Vite turns into a literal
 * and Rollup then deletes with the module behind it — the mechanism `main.tsx`
 * uses for `./dynamicWalk.ts`. The flag is set for `playwright.config.ts`'s
 * preview build and for no deployment, and even there this returns no seams
 * unless the walk put `window.__passportWalkChain` on the page before it loaded.
 */

import { SucceedEntirely } from '@midnight-ntwrk/midnight-js-types'

import { defaultCustodyDeps, type CustodyDeps } from '../identity/custodyContractClient.js'
import { custodyProofNotBuilt } from '../identity/custodyContractPlan.js'

/** Where the stand-in tells the walk what was handed over. Never a real host. */
export const WALK_CHAIN_URL = 'https://passport-walk.invalid/chain'

/** Every id the stand-in makes starts with this, so its answers never meet a real one. */
const WALK_TX_PREFIX = 'walk-'

/** What the stand-in's "unproven transaction" carries to its hand-over. */
interface WalkCall {
  readonly circuit: string
  /** The call's first argument, as hex, where it is bytes — the entry, or the key. */
  readonly first: string | null
}

function hexOf(value: unknown): string | null {
  return value instanceof Uint8Array
    ? Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')
    : null
}

/**
 * The custody client's seams for the walk, or none at all.
 *
 * Handed to the adoption as its `overrides`; the client falls back to its own
 * dependency for every seam not named here.
 */
export function walkChainOverrides(): Partial<CustodyDeps> {
  const hook = (globalThis as { __passportWalkChain?: unknown }).__passportWalkChain
  if (hook === undefined || hook === null || typeof hook !== 'object') return {}
  const real = defaultCustodyDeps()
  return {
    contracts: async () => {
      const contracts = await real.contracts()
      return {
        ...contracts,
        createUnprovenCallTx: (_providers: unknown, options: unknown) => {
          const call = options as { circuitId: string; args?: readonly unknown[] }
          const walkCall: WalkCall = { circuit: call.circuitId, first: hexOf(call.args?.[0]) }
          return Promise.resolve({ private: { unprovenTx: walkCall } })
        },
        submitTxAsync: async (_providers: unknown, options: unknown) => {
          const call = (options as { unprovenTx: WalkCall }).unprovenTx
          const response = await fetch(WALK_CHAIN_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(call),
          })
          if (!response.ok) throw custodyProofNotBuilt(`the walk refused ${call.circuit}`)
          const { txId } = (await response.json()) as { txId: string }
          return `${WALK_TX_PREFIX}${txId}`
        },
      }
    },
    providers: async (wallet, privateStateId, account) => {
      const providers = await real.providers(wallet, privateStateId, account)
      const reader = providers.publicDataProvider as Record<PropertyKey, unknown>
      const publicDataProvider = new Proxy(reader, {
        get(target, key) {
          if (key === 'watchForTxData') {
            return (txId: string): Promise<unknown> =>
              txId.startsWith(WALK_TX_PREFIX)
                ? Promise.resolve({
                    txId,
                    txHash: txId.slice(WALK_TX_PREFIX.length).padStart(64, '0'),
                    status: SucceedEntirely,
                  })
                : (target.watchForTxData as (id: string) => Promise<unknown>)(txId)
          }
          const value: unknown = Reflect.get(target, key)
          return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
        },
      })
      return { ...providers, publicDataProvider }
    },
  }
}
