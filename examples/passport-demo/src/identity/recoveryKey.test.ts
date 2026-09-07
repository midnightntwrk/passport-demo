import { describe, expect, it } from 'vitest';

import {
  RECOVERY_MESSAGE_V1,
  recoverySecretFromSignature,
  requestRecoverySignature,
  type EthereumProvider,
} from './recoveryKey.js';

/**
 * The recovery key's whole promise is REPRODUCIBILITY: the same wallet
 * signing the same message, years later on a different machine, must derive
 * the same device secret — or the enrolled commitment on the ledger admits
 * nobody. These drills hold the two halves of that promise still.
 */

describe('RECOVERY_MESSAGE_V1', () => {
  it('is frozen — a changed message is a lost key, not an edit', () => {
    /* Byte-for-byte. If this test is failing, the fix is a NEW versioned
       message enrolled as an ADDITIONAL device, never a change here. */
    expect(RECOVERY_MESSAGE_V1).toBe(
      'Midnight Passport recovery key (v1).\n' +
        'Signing this derives the key that can restore access to your Passport.\n' +
        'It never leaves this device. Only sign this inside Midnight Passport.',
    );
  });
});

describe('requestRecoverySignature', () => {
  it('asks for the frozen message, hex-encoded, bound to the connected account', async () => {
    const calls: { method: string; params?: unknown[] }[] = [];
    const provider: EthereumProvider = {
      request: async (args) => {
        calls.push(args);
        if (args.method === 'eth_requestAccounts') return ['0xAbCd00000000000000000000000000000000Ef12'];
        if (args.method === 'personal_sign') return `0x${'42'.repeat(65)}`;
        throw new Error(`unexpected ${args.method}`);
      },
    };
    const result = await requestRecoverySignature(provider);
    expect(result.ethAddress).toBe('0xAbCd00000000000000000000000000000000Ef12');
    expect(result.signature).toBe(`0x${'42'.repeat(65)}`);

    const sign = calls.find((call) => call.method === 'personal_sign');
    expect(sign).toBeDefined();
    const [messageHex, address] = sign!.params as [string, string];
    expect(address).toBe('0xAbCd00000000000000000000000000000000Ef12');
    /* The hex really is the frozen message — decoded back rather than
       trusted by construction. */
    const bytes = messageHex
      .slice(2)
      .match(/../g)!
      .map((pair) => Number.parseInt(pair, 16));
    expect(new TextDecoder().decode(new Uint8Array(bytes))).toBe(RECOVERY_MESSAGE_V1);
  });

  it('refuses a wallet that connects with no account', async () => {
    const provider: EthereumProvider = {
      request: async (args) =>
        args.method === 'eth_requestAccounts' ? [] : `0x${'11'.repeat(65)}`,
    };
    await expect(requestRecoverySignature(provider)).rejects.toThrow(/no account/i);
  });

  it('a decline in the wallet reads as an answer, never as [object Object]', async () => {
    /* EIP-1193 code 4001, thrown the way real wallets throw it — a plain
       object with a code, not always an Error instance. The machines print
       `String(cause)` for unknown shapes, so an unmapped 4001 reached the
       screen as noise. */
    const provider: EthereumProvider = {
      request: async (args) => {
        if (args.method === 'eth_requestAccounts') return ['0xAbCd00000000000000000000000000000000Ef12'];
        throw { code: 4001, message: 'MetaMask Message Signature: User denied message signature.' };
      },
    };
    await expect(requestRecoverySignature(provider)).rejects.toThrow(
      /You declined in the wallet — nothing was signed\./,
    );
  });

  it('a wallet already showing a request says where to look', async () => {
    const provider: EthereumProvider = {
      request: async () => {
        throw { code: -32002, message: 'Request of type wallet_requestPermissions already pending' };
      },
    };
    await expect(requestRecoverySignature(provider)).rejects.toThrow(
      /already showing a request/i,
    );
  });
});

describe('recoverySecretFromSignature', () => {
  it('is deterministic: one signature, one secret, forever', async () => {
    const signature = `0x${'42'.repeat(65)}`;
    const first = await recoverySecretFromSignature(signature);
    const second = await recoverySecretFromSignature(signature);
    expect(first).toHaveLength(32);
    expect(Buffer.from(first).toString('hex')).toBe(Buffer.from(second).toString('hex'));
  });

  it('separates wallets: a different signature is a different secret', async () => {
    const first = await recoverySecretFromSignature(`0x${'42'.repeat(65)}`);
    const other = await recoverySecretFromSignature(`0x${'43'.repeat(65)}`);
    expect(Buffer.from(first).toString('hex')).not.toBe(Buffer.from(other).toString('hex'));
  });

  it('refuses an answer that is not hex — a wallet must not be guessed at', async () => {
    await expect(recoverySecretFromSignature('not-a-signature')).rejects.toThrow(
      /not a signature/i,
    );
  });
});
