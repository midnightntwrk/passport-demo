/**
 * Drills for the wallet's own shielded transfer — its PURE half.
 *
 * The module is mixed, as `./accountCustody.ts` is and for the same reason: one
 * half of it moves money and needs a wallet, a prover, a fee sponsor, and a
 * chain, and that half is drilled against stagenet by `e2e/stagenet.live.spec.ts`.
 * What is here is the half that can be wrong without any of those — the refusals
 * made before anything is built, and the shape handed to the facade.
 *
 * Both matter for the reason the module exists at all. This is leg two of a
 * shielded send to an address, and legs one and three have already moved the
 * sender's money by the time it runs: an amount or an address refused HERE
 * costs a person nothing, and the same refusal arriving from inside the SDK
 * costs them a half-finished payment and a card on Home.
 */

import { describe, expect, it } from 'vitest';

import {
  decodeShieldedReceiver,
  requireTransferableAmount,
  shieldedTransferOutputs,
  TRANSFER_TTL_MS,
  WalletTransferError,
} from './walletTransfer.js';

/**
 * A real stagenet shielded address, built with the wallet SDK's own codec — the
 * same one `e2e/send-assets.spec.ts` pastes. Nothing is ever sent to it.
 */
const SHIELDED =
  'mn_shield-addr_stagenet1zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygjyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygs74ltnl';

/** The unshielded shape, which names the wrong ledger for a shielded transfer. */
const UNSHIELDED =
  'mn_addr_stagenet127xnp9uuxwhh7a8an77mxv02ypt6u09xkk63c9zvdkjsrj4mj68qg7c5ad';

const COLOUR = 'dd'.repeat(32);

describe('requireTransferableAmount', () => {
  it('takes a positive amount', () => {
    expect(() => requireTransferableAmount(1n)).not.toThrow();
  });

  it('refuses zero and refuses a negative, before anything is built', () => {
    expect(() => requireTransferableAmount(0n)).toThrow(WalletTransferError);
    expect(() => requireTransferableAmount(-1n)).toThrow(/greater than zero/);
  });

  it('refuses an amount that is not an amount', () => {
    expect(() => requireTransferableAmount(10 as unknown as bigint)).toThrow(
      /atomic units/,
    );
  });
});

describe('shieldedTransferOutputs', () => {
  it('is one output, on the shielded ledger, to one address', () => {
    const receiverAddress = { marker: 'decoded' };
    expect(
      shieldedTransferOutputs({ tokenType: COLOUR, amount: 10n, receiverAddress }),
    ).toEqual([
      {
        type: 'shielded',
        outputs: [{ type: COLOUR, receiverAddress, amount: 10n }],
      },
    ]);
  });

  it('carries the DECODED address, never the string it came from', () => {
    /* The facade resolves the recipient's encryption key off the decoded
       address to build the note's ciphertext — the same key `withdraw_shielded`
       has to be handed as a mapping. A string here fails inside the SDK, after
       the person has already touched their authenticator for leg one. */
    const [group] = shieldedTransferOutputs({
      tokenType: COLOUR,
      amount: 1n,
      receiverAddress: { coinPublicKey: 'x', encryptionPublicKey: 'y' },
    });
    expect(group.outputs[0]).toHaveProperty('receiverAddress.encryptionPublicKey', 'y');
  });
});

describe('decodeShieldedReceiver', () => {
  it('decodes a shielded address for its own network', async () => {
    await expect(decodeShieldedReceiver(SHIELDED, 'stagenet')).resolves.toBeDefined();
  });

  it('ignores surrounding whitespace, as a pasted address carries', async () => {
    await expect(decodeShieldedReceiver(`  ${SHIELDED}\n`, 'stagenet')).resolves.toBeDefined();
  });

  it('refuses a string that is not a Midnight address at all', async () => {
    await expect(decodeShieldedReceiver('not-an-address', 'stagenet')).rejects.toThrow(
      /not a Midnight address/,
    );
  });

  it('refuses an address from another network, which would be unrecoverable', async () => {
    const error = await decodeShieldedReceiver(SHIELDED, 'undeployed').catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(WalletTransferError);
    expect((error as WalletTransferError).code).toBe('wrong-network');
    expect((error as Error).message).toContain('stagenet');
  });

  it('refuses a Midnight address on the wrong LEDGER', async () => {
    const error = await decodeShieldedReceiver(UNSHIELDED, 'stagenet').catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(WalletTransferError);
    expect((error as WalletTransferError).code).toBe('invalid-request');
    expect((error as Error).message).toContain('mn_shield-addr');
  });
});

describe('TRANSFER_TTL_MS', () => {
  it('is the same half-hour window a contract call gets', () => {
    expect(TRANSFER_TTL_MS).toBe(30 * 60 * 1_000);
  });
});
