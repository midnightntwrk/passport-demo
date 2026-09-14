/**
 * Drills for the sig.network vault identity derivation.
 *
 * The point is determinism against a fixed secret: the identity commitment and
 * the Sepolia deposit address must be reproducible, because the address is where
 * a user sends real USDC and the commitment is what the vault gates the claim on.
 * The expected values below were produced by the same `userCommitment` circuit
 * and `deriveEvmAddress` the code calls, run offline against the fixed inputs
 * here — so a drift in either derivation is caught.
 */

import { describe, expect, it } from 'vitest';

import type { BridgeConfig } from './config.js';
import { signetDepositAddress, signetIdentityCommitmentHex } from './identity.js';

/** A fixed, non-secret test identity: bytes 0x01..0x20. */
const TEST_SECRET = new Uint8Array(32);
for (let i = 0; i < 32; i++) TEST_SECRET[i] = i + 1;

/**
 * A config with the real stagenet MPC network key and the deployed vault, so the
 * deposit address below is the address the fixed test secret actually maps to on
 * stagenet — not a stand-in.
 */
const TEST_CONFIG: BridgeConfig = {
  vaultContractAddress: '3fdef8491a0f769cda62e03b4cc7d5ee39cf85ba907b0750fd128f86906f733d',
  signetContractAddress: '6ba7292a3b5682c596bc08c55ecbd417a6a7ea7f7a3d80cc077ed87495651246',
  erc20UsdcAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  usdcColourHex: '3954535699b5cd4c04f5db5b495d7fcac0f7a7ff13a0643eabdc2e088825d628',
  mpcSecp256k1Pubkey: '0x024eef776e4f257d68983e45b340c2e9546c5df95447900b6aadfec68fb46fdee2',
  sepoliaRpcUrl: 'http://localhost:8545',
  responsesUrl: 'http://localhost:3040',
};

describe('signet vault identity', () => {
  it('derives a deterministic identity commitment via the vault circuit', () => {
    expect(signetIdentityCommitmentHex(TEST_SECRET)).toBe(
      '2671884fade102ade95035e22341a585ebef59393eb2ec6bad0a1711c7d6c991',
    );
  });

  it('derives a deterministic Sepolia deposit address from the commitment', () => {
    expect(signetDepositAddress(TEST_SECRET, TEST_CONFIG)).toBe(
      '0x8a61c6b6ff41cb75229957902333C90f0A75717E',
    );
  });
});
