// Constants the erc20-vault deposit binds, matched to the DEPLOYED contract this
// app vendors (the sig.network full-stack-demo lineage, @sig-net/midnight 0.19).
// They are hard-coded here because the sig.network contract PACKAGE that exports
// them (VAULT_REQUESTS_PATH, the MPC routing, the gas envelope) is Node-oriented
// and not a dependency; the reference webapps inline them the same way. If the
// deployed vault is ever replaced, re-confirm these against it — a wrong request
// path or schema makes the MPC round trip silently never match.

import {
  asciiPadded,
  MPCDestination,
  MPCSignatureAlgorithm,
  PATH_BYTES,
} from '@sig-net/midnight';

/** `transfer(address,uint256)` selector — the EVM call the vault sweeps the deposit with. */
export const ERC20_TRANSFER_SELECTOR = new Uint8Array([0xa9, 0x05, 0x9c, 0xbb]);

/** The EVM output ABI the deposit's `transfer` returns: a single bool. */
export const RESULT_SCHEMA = '[{"name":"success","type":"bool"}]';

/** The gas envelope the deposit sweep is signed with (matches the deployed vault). */
export const ERC20_TRANSFER_GAS_LIMIT = 100_000n;
export const ERC20_TRANSFER_MAX_FEE_PER_GAS = 30_000_000_000n; // 30 gwei
export const ERC20_TRANSFER_MAX_PRIORITY_FEE_PER_GAS = 1_000_000_000n; // 1 gwei

/** The derivation path of the vault's own EVM account (the sweep recipient). */
export const VAULT_PATH = asciiPadded('vault', PATH_BYTES);

/**
 * The ledger-tree path of the request map the deposit registers in. On the
 * @sig-net/midnight 0.19 vault, deposit/withdraw requests live at field 0.
 * Re-confirm against the deployed contract's ledger layout if it changes.
 */
export const DEPOSIT_REQUESTS_PATH: readonly number[] = [0];

/** The MPC routing the deposit request carries (ECDSA; the output schema is the bool). */
export const MPC_ROUTING = {
  algo: MPCSignatureAlgorithm.ecdsa,
  dest: MPCDestination.unused,
  outputDeserializationSchema: asciiPadded(RESULT_SCHEMA, RESULT_SCHEMA.length),
  respondSerializationSchema: asciiPadded(RESULT_SCHEMA, RESULT_SCHEMA.length),
} as const;
