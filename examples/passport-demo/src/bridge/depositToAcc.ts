// The ACC hand-off: move the bridged-USDC coin the claim minted into the internal
// wallet on into the user's Account Custody Contract, via its permissionless
// `deposit_shielded` circuit. This is the second, plain Midnight transaction the
// design calls for — the claim cannot land in the ACC directly (see
// docs/bridge/sig-network-integration.md).
//
// The coin the claim minted carries the mint nonce we chose, so we build the
// deposit note from it directly — the same mint-then-deposit pairing the balancer
// uses to hand out mUSD (examples/passport-balancer/src/account.ts). The fee is
// sponsored through the account contract's existing deposit path.
//
// NOTE: not build- or run-verified here (the PWA's deps are not installed).

import {
  type AccountShieldedCoin,
  type AccountCustodyProgress,
  type AccountCustodyTxResult,
  depositShielded,
} from '../identity/accountCustody.js';
import type { LocalMidnightWallet } from '../lib/localWallet.js';
import type { BridgeConfig } from './config.js';
import { type BridgeDepositResult, runBridgeDeposit } from './deposit.js';

/** A 64-hex colour to its 32 bytes. */
function colourBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error(`a colour is 32 bytes of hex; got "${hex}"`);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Deposit the just-claimed bridged-USDC coin into the user's ACC.
 *
 * @param wallet - The internal wallet holding the claimed coin.
 * @param accountAddress - The user's account custody contract address.
 * @param result - The deposit result from {@link runBridgeDeposit} (carries the mint nonce + amount).
 * @param config - The bridge configuration (for the USDC colour).
 * @param onPhase - Optional progress sink (the account contract's own phases).
 */
export async function depositBridgedUsdcToAcc(
  wallet: LocalMidnightWallet,
  accountAddress: string,
  result: BridgeDepositResult,
  config: BridgeConfig,
  onPhase?: (progress: AccountCustodyProgress) => void,
): Promise<AccountCustodyTxResult> {
  const coin: AccountShieldedCoin = {
    nonce: result.mintNonce,
    color: colourBytes(config.usdcColourHex),
    value: result.amount,
  };
  return depositShielded(wallet, { contractAddress: accountAddress, coin }, onPhase);
}

/**
 * The whole bridge-in: deposit USDC on Ethereum, claim it to the internal wallet,
 * and deposit it into the user's ACC. The USDC must already sit at the deposit
 * address (the user sends it there first).
 *
 * @param wallet - The internal wallet.
 * @param config - The bridge configuration.
 * @param secret - The 32-byte vault identity secret.
 * @param accountAddress - The user's ACC address.
 * @param amount - The amount to bridge, in USDC base units.
 * @param log - Optional progress sink.
 * @returns The deposit result (request id, mint nonce, amount, Sepolia tx hash).
 */
export async function runBridgeIn(
  wallet: LocalMidnightWallet,
  config: BridgeConfig,
  secret: Uint8Array,
  accountAddress: string,
  amount: bigint,
  log: (message: string) => void = () => {},
): Promise<BridgeDepositResult> {
  const result = await runBridgeDeposit(wallet, config, secret, amount, log);
  log('depositing the bridged USDC into your account…');
  await depositBridgedUsdcToAcc(wallet, accountAddress, result, config);
  log('bridge-in complete — USDC is in your account.');
  return result;
}
