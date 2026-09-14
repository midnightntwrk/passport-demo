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

/**
 * The stagenet sig.network MPC network's secp256k1 public key (compressed).
 *
 * This is the MPC NETWORK's key, not a per-vault key: `deriveEvmAddress` binds
 * the vault address separately, so one key serves every vault the network signs
 * for. The sig.network full-stack-demo and the Collateral-Warehouse reference app
 * both list this same key against DIFFERENT vaults, which is what confirms it is
 * network-wide. Overridable via `VITE_SIGNET_MPC_PUBKEY`.
 */
export const STAGENET_MPC_SECP256K1_PUBKEY =
  '0x024eef776e4f257d68983e45b340c2e9546c5df95447900b6aadfec68fb46fdee2';

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
   * The MPC network's secp256k1 public key (compressed, `0x02…`/`0x03…`).
   * `deriveEvmAddress` binds it into the user's Sepolia deposit address, so a
   * wrong key yields an address the MPC never signs from. Defaults to the
   * stagenet network key ({@link STAGENET_MPC_SECP256K1_PUBKEY}); override with
   * `VITE_SIGNET_MPC_PUBKEY` for another network.
   */
  readonly mpcSecp256k1Pubkey: string;
  /** JSON-RPC endpoint for Ethereum Sepolia (reads and broadcast). */
  readonly sepoliaRpcUrl: string;
  /**
   * The sig.network MPC responder's `/responses` cache. The claim recomputes the
   * EVM output bytes from this to check the attestation; the deployed stagenet
   * responder is the default. Override with `VITE_SIGNET_RESPONSES_URL`.
   */
  readonly responsesUrl: string;
  /**
   * Where the vault's (and signet's) ZK proving keys are fetched from. The vault
   * circuits are large and are hosted on object storage, not staged locally; the
   * signet keys live under `<origin>/signet`. Matches the sig.network reference
   * apps' `NEXT_PUBLIC_ZK_CONFIG_ORIGIN`. Override with `VITE_SIGNET_ZK_ORIGIN`.
   */
  readonly zkOrigin: string;
}

/** A minimal view of the Vite env, so this module stays testable without `import.meta`. */
export interface BridgeEnv {
  readonly VITE_SIGNET_MPC_PUBKEY?: string;
  readonly VITE_SEPOLIA_RPC_URL?: string;
  readonly VITE_SIGNET_RESPONSES_URL?: string;
  readonly VITE_SIGNET_ZK_ORIGIN?: string;
}

const DEFAULT_SEPOLIA_RPC_URL = 'https://ethereum-sepolia-rpc.publicnode.com';

/** The deployed stagenet sig.network responder cache (the reference apps' default). */
const DEFAULT_RESPONSES_URL = 'https://fakenet-production.up.railway.app';

/** The hosted vault/signet ZK key bucket (the reference apps' NEXT_PUBLIC_ZK_CONFIG_ORIGIN). */
const DEFAULT_ZK_ORIGIN = 'https://pub-40793a8fb6614e07b7850ef647fceaaf.r2.dev';

/**
 * Resolve the bridge configuration from the environment.
 *
 * The MPC key defaults to the stagenet network key; an override is validated so
 * a malformed value fails loudly rather than deriving a deposit address the MPC
 * cannot sweep.
 *
 * @param env - The Vite env (defaults to `import.meta.env`).
 * @throws {Error} If `VITE_SIGNET_MPC_PUBKEY` is set but malformed.
 */
export function bridgeConfigFromEnv(env: BridgeEnv): BridgeConfig {
  const mpcSecp256k1Pubkey = (env.VITE_SIGNET_MPC_PUBKEY ?? STAGENET_MPC_SECP256K1_PUBKEY).trim();
  if (!/^0x(02|03)[0-9a-fA-F]{64}$/.test(mpcSecp256k1Pubkey)) {
    throw new Error(
      'VITE_SIGNET_MPC_PUBKEY must be a compressed secp256k1 MPC public key ' +
        '(0x02… or 0x03…, 33 bytes); the bridge cannot derive a deposit address ' +
        'from a malformed key.',
    );
  }
  return {
    vaultContractAddress: STAGENET_VAULT_CONTRACT_ADDRESS,
    signetContractAddress: STAGENET_SIGNET_CONTRACT_ADDRESS,
    erc20UsdcAddress: SEPOLIA_USDC_ADDRESS,
    usdcColourHex: USDC_COLOUR_HEX,
    mpcSecp256k1Pubkey,
    sepoliaRpcUrl: (env.VITE_SEPOLIA_RPC_URL ?? '').trim() || DEFAULT_SEPOLIA_RPC_URL,
    responsesUrl: (env.VITE_SIGNET_RESPONSES_URL ?? '').trim() || DEFAULT_RESPONSES_URL,
    zkOrigin: ((env.VITE_SIGNET_ZK_ORIGIN ?? '').trim() || DEFAULT_ZK_ORIGIN).replace(/\/$/, ''),
  };
}
