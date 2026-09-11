// Static configuration for the sig.network erc20-vault bridge on stagenet.
//
// The vault + USDC pair named here is the same one `src/lib/colour.ts` derives
// USDC_COLOUR_HEX from — the colour a bridged-USDC coin carries. Kept beside the
// bridge feature rather than in colour.ts so the feature reads as one unit; the
// colour itself stays the app-wide constant it already is.

import { USDC_COLOUR_HEX } from '../lib/colour.js';

/** The deployed sig.network erc20-vault on stagenet. */
export const STAGENET_VAULT_CONTRACT_ADDRESS =
  '3fdef8491a0f769cda62e03b4cc7d5ee39cf85ba907b0750fd128f86906f733d';

/** The central sig.network signet contract the vault notifies. */
export const STAGENET_SIGNET_CONTRACT_ADDRESS =
  '6ba7292a3b5682c596bc08c55ecbd417a6a7ea7f7a3d80cc077ed87495651246';

/** Circle USDC on Ethereum Sepolia — the token a user bridges in. */
export const SEPOLIA_USDC_ADDRESS = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

/** Everything the bridge needs to resolve a user's deposit address and drive a claim. */
export interface BridgeConfig {
  /** Deployed vault contract address on Midnight. */
  readonly vaultContractAddress: string;
  /** Central signet contract address on Midnight. */
  readonly signetContractAddress: string;
  /** Circle USDC address on Sepolia. */
  readonly erc20UsdcAddress: string;
  /** Colour a bridged-USDC coin carries on Midnight (from colour.ts). */
  readonly usdcColourHex: string;
  /**
   * The deployment's MPC secp256k1 public key (compressed, `0x02…`/`0x03…`).
   * `deriveEvmAddress` binds it into the user's Sepolia deposit address, so it
   * MUST be the key for this vault's deployment. There is deliberately no
   * committed default: a wrong key yields a deposit address the MPC never signs
   * from. Provide it via `VITE_SIGNET_MPC_PUBKEY`.
   */
  readonly mpcSecp256k1Pubkey: string;
  /** JSON-RPC endpoint for Ethereum Sepolia (reads and broadcast). */
  readonly sepoliaRpcUrl: string;
}

/** A minimal view of the Vite env, so this module stays testable without `import.meta`. */
export interface BridgeEnv {
  readonly VITE_SIGNET_MPC_PUBKEY?: string;
  readonly VITE_SEPOLIA_RPC_URL?: string;
}

const DEFAULT_SEPOLIA_RPC_URL = 'https://ethereum-sepolia-rpc.publicnode.com';

/**
 * Resolve the bridge configuration from the environment.
 *
 * Throws when the MPC key is absent: unlike the Midnight endpoints, it has no
 * safe default, and silently deriving a deposit address against the wrong key
 * would send a user's USDC somewhere the MPC cannot sweep.
 *
 * @param env - The Vite env (defaults to `import.meta.env`).
 * @throws {Error} If `VITE_SIGNET_MPC_PUBKEY` is unset or malformed.
 */
export function bridgeConfigFromEnv(env: BridgeEnv): BridgeConfig {
  const mpcSecp256k1Pubkey = (env.VITE_SIGNET_MPC_PUBKEY ?? '').trim();
  if (!/^0x(02|03)[0-9a-fA-F]{64}$/.test(mpcSecp256k1Pubkey)) {
    throw new Error(
      'VITE_SIGNET_MPC_PUBKEY must be the deployment’s compressed secp256k1 MPC ' +
        'public key (0x02… or 0x03…, 33 bytes); the bridge cannot derive a deposit ' +
        'address without it.',
    );
  }
  return {
    vaultContractAddress: STAGENET_VAULT_CONTRACT_ADDRESS,
    signetContractAddress: STAGENET_SIGNET_CONTRACT_ADDRESS,
    erc20UsdcAddress: SEPOLIA_USDC_ADDRESS,
    usdcColourHex: USDC_COLOUR_HEX,
    mpcSecp256k1Pubkey,
    sepoliaRpcUrl: (env.VITE_SEPOLIA_RPC_URL ?? '').trim() || DEFAULT_SEPOLIA_RPC_URL,
  };
}
