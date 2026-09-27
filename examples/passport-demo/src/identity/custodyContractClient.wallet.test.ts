/**
 * The connection every account custody call is made on, and the one thing
 * about it that changed on 2026/09/27: it never walks the chain.
 *
 * `defaultCustodyDeps().wallet` is the seam every custody path opens its
 * wallet through — the setup, the waves, a payment, a read of Home, a way
 * back — for BOTH arms, a passkey and a sign-in. So this is where "the custody
 * arm opens no sync" is held: the wallet module is replaced by a recorder, and
 * what the seam asks it for is read back.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const opened = vi.hoisted(() => ({ calls: [] as Array<{ seed: Uint8Array; options: unknown }> }));

vi.mock('../lib/localWallet.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/localWallet.js')>()),
  createLocalMidnightWallet: vi.fn((seed: Uint8Array, options: unknown) => {
    opened.calls.push({ seed, options });
    return Promise.resolve({ network: { networkId: 'stagenet' }, chainSync: false });
  }),
}));

import { defaultCustodyDeps, freshCustodyWallet } from './custodyContractClient.js';

/** A storage the test owns, standing in for the page's. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

beforeEach(() => {
  opened.calls.length = 0;
  vi.stubGlobal('localStorage', memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the account custody connection', () => {
  it('is opened without a chain walk', async () => {
    const deps = defaultCustodyDeps();
    await deps.wallet('jubjub:walk-1');
    expect(opened.calls).toHaveLength(1);
    expect(opened.calls[0].options).toEqual({ chainSync: false });
    deps.releaseWallet?.('jubjub:walk-1');
  });

  it('is opened on this device’s own key for that Passport, one per Passport for the tab', async () => {
    const deps = defaultCustodyDeps();
    const first = deps.wallet('jubjub:walk-2');
    const again = deps.wallet('jubjub:walk-2');
    expect(again).toBe(first);
    await first;
    expect(opened.calls).toHaveLength(1);
    expect(opened.calls[0].seed).toHaveLength(32);
    deps.releaseWallet?.('jubjub:walk-2');
  });

  it('is reopened, still without a walk, when a setup press finds it released', async () => {
    const deps = defaultCustodyDeps();
    await deps.wallet('jubjub:walk-3');
    deps.releaseWallet?.('jubjub:walk-3');
    await freshCustodyWallet('jubjub:walk-3');
    expect(opened.calls.map((call) => call.options)).toEqual([
      { chainSync: false },
      { chainSync: false },
    ]);
    deps.releaseWallet?.('jubjub:walk-3');
  });
});
