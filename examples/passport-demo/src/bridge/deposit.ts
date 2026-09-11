// The deposit-and-claim flow, run from Passport's internal wallet: submit the
// vault's `deposit` circuit, drive the MPC round trip (sign → broadcast →
// attest), then submit `claim` to mint the bridged-USDC coin to this wallet.
// The claim leaves the coin in the internal wallet; moving it into the ACC is
// the next phase (`depositToAcc.ts`).
//
// NOTE: not build- or run-verified in this environment. It reproduces the
// sig.network reference webapps' deposit flow against the vendored 0.19 vault;
// validate end to end against live stagenet + Sepolia + a proof server, and
// re-confirm the request-id fields against the deployed contract.

import {
  calculateRequestId,
  evmAddressAbiWord,
  hexToBytes,
  numericAbiWord,
  type RequestIdHex,
  requestIdBytes,
  requestIdHex,
  type SignBidirectionalEvent,
  SIGNET_DEFAULT_KEY_VERSION,
  stripHexPrefix,
  TxParamType,
} from '@sig-net/midnight';

import type { LocalMidnightWallet } from '../lib/localWallet.js';
import type { BridgeConfig } from './config.js';
import { pureCircuits } from './contract-exports.js';
import { signetDepositAddress } from './identity.js';
import { settleViaMpc } from './mpc.js';
import { connectVault, readVaultLedger, type VaultConnection } from './vaultClient.js';
import {
  DEPOSIT_REQUESTS_PATH,
  ERC20_TRANSFER_GAS_LIMIT,
  ERC20_TRANSFER_MAX_FEE_PER_GAS,
  ERC20_TRANSFER_MAX_PRIORITY_FEE_PER_GAS,
  ERC20_TRANSFER_SELECTOR,
  MPC_ROUTING,
} from './vaultConstants.js';
import { evmNonce } from './mpc.js';

const rand32 = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));

/** The result of a completed deposit+claim: what the ACC hand-off needs. */
export interface BridgeDepositResult {
  /** The vault request id this deposit settled. */
  readonly requestId: RequestIdHex;
  /** The mint nonce the claimed coin carries (the ACC deposit reuses it). */
  readonly mintNonce: Uint8Array;
  /** The bridged amount, in USDC base units. */
  readonly amount: bigint;
  /** The Sepolia sweep tx hash, when known. */
  readonly evmTxHash?: string;
}

/** Predict the request id the `deposit` circuit will record, so we can poll for it. */
function predictRequestId(
  config: BridgeConfig,
  before: Record<string, unknown>,
  commitment: Uint8Array,
  nonce: bigint,
  erc20: Uint8Array,
  transferTo: unknown,
  amount: bigint,
): RequestIdHex {
  const expected = {
    sender: { bytes: hexToBytes(stripHexPrefix(config.vaultContractAddress)) },
    requestNonce: before.signetRequestNonce,
    keyVersion: SIGNET_DEFAULT_KEY_VERSION,
    path: commitment,
    ...MPC_ROUTING,
    txParamType: TxParamType.evmType2,
    caip2Id: before.caip2Id,
    txParams: {
      to: erc20,
      chainId: before.evmChainId,
      nonce,
      gasLimit: ERC20_TRANSFER_GAS_LIMIT,
      maxFeePerGas: ERC20_TRANSFER_MAX_FEE_PER_GAS,
      maxPriorityFeePerGas: ERC20_TRANSFER_MAX_PRIORITY_FEE_PER_GAS,
      value: 0n,
      accessListEntryCount: 0n,
      accessList: [],
      calldata: {
        is_some: true,
        value: {
          selector: ERC20_TRANSFER_SELECTOR,
          noWords: 2n,
          words: [evmAddressAbiWord(transferTo as never), numericAbiWord(amount)],
        },
      },
    },
  } as unknown as SignBidirectionalEvent;
  return requestIdHex(calculateRequestId(expected)) as RequestIdHex;
}

/** The `claim` recipient meaning "mint to me" (the internal wallet's own coin public key). */
const SELF_RECIPIENT = {
  is_some: false,
  value: {
    is_left: true,
    left: { bytes: new Uint8Array(32) },
    right: { bytes: new Uint8Array(32) },
  },
} as const;

/**
 * Deposit `amount` (USDC base units) from the internal wallet's derived Sepolia
 * address into the vault, and claim the resulting bridged-USDC coin to this
 * wallet. The USDC must already sit at the deposit address (the user sends it).
 *
 * @param wallet - The internal wallet (pays fees, receives the coin).
 * @param config - The bridge configuration.
 * @param secret - The 32-byte vault identity secret.
 * @param amount - The amount to bridge, in USDC base units.
 * @param log - Optional progress sink.
 * @throws {Error} If the vault is uninitialised or the MPC attests the sweep as failed.
 */
export async function runBridgeDeposit(
  wallet: LocalMidnightWallet,
  config: BridgeConfig,
  secret: Uint8Array,
  amount: bigint,
  log: (message: string) => void = () => {},
): Promise<BridgeDepositResult> {
  if (amount <= 0n) throw new Error(`amount must be positive; got ${String(amount)}`);

  const connection: VaultConnection = await connectVault(wallet, config, secret);
  const commitment = pureCircuits.userCommitment(secret);
  const userEvm = signetDepositAddress(secret, config);
  const nonce = await evmNonce(config, userEvm);
  const erc20 = hexToBytes(stripHexPrefix(config.erc20UsdcAddress));

  const before = await readVaultLedger(connection, config);
  if (before.initialised !== true && before.initialized !== true) {
    throw new Error('vault is not initialised');
  }
  const requestId = predictRequestId(
    config,
    before,
    commitment,
    nonce,
    erc20,
    before.vaultEvmAddress,
    amount,
  );
  log(`deposit request ${requestId} (sweep from ${userEvm}, nonce ${String(nonce)})`);

  await connection.vault.callTx.deposit(
    nonce,
    ERC20_TRANSFER_GAS_LIMIT,
    ERC20_TRANSFER_MAX_FEE_PER_GAS,
    ERC20_TRANSFER_MAX_PRIORITY_FEE_PER_GAS,
    SIGNET_DEFAULT_KEY_VERSION,
    { erc20Address: erc20, amount },
  );
  // The request must now be on the vault's ledger before the MPC will act.
  const after = await readVaultLedger(connection, config);
  void after;
  void DEPOSIT_REQUESTS_PATH;

  log('waiting for the MPC to sweep the deposit on Sepolia…');
  const outcome = await settleViaMpc(connection, config, requestId, userEvm);
  if (!outcome.succeeded) {
    throw new Error(`the MPC attested deposit ${requestId} as failed; nothing to claim`);
  }

  const mintNonce = rand32();
  log('claiming the bridged USDC into the internal wallet…');
  await connection.vault.callTx.claim(
    requestIdBytes(requestId),
    outcome.event,
    outcome.serializedOutput,
    mintNonce,
    SELF_RECIPIENT,
  );

  return { requestId, mintNonce, amount, evmTxHash: outcome.evmTxHash };
}
