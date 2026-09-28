/**
 * A wallet that does not walk the chain, and a wallet that does (2026/09/27).
 *
 * WHAT IS REPLACED. The facade's `init`, the three component wallets' starters,
 * the snapshot store, and the address codec's encoder — the SDK objects that
 * open sockets or need a synced state. Everything in front of them is the real
 * module: the seed goes through the real HD derivation and the real ledger key
 * constructors, and the network id is the real configuration's.
 *
 * WHAT IS HELD. For `chainSync: false`, the facade is never started, no
 * snapshot is read or written, the depth of the chain is never asked, the
 * starters are the cold ones, and every question about the wallet's own
 * balance or progress is answered honestly rather than from a starting state's
 * zeros. For the default, the wallet is exactly the one a prototype Passport
 * has always had: the snapshot is looked for, the depth guard runs, and the
 * facade is started with the wallet's own keys.
 */

import * as Rx from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** What the replaced SDK objects saw, and what the snapshot store answers. */
interface Recorded {
  starters: string[];
  facades: Array<{
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    state: ReturnType<typeof vi.fn>;
  }>;
  /** What `loadWalletSnapshot` finds; nothing unless a test puts one there. */
  snapshot: unknown;
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  height: ReturnType<typeof vi.fn>;
}

const recorded = vi.hoisted(
  (): Recorded => ({
    starters: [],
    facades: [],
    snapshot: null,
    load: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
    height: vi.fn(),
  }),
);

vi.mock('@midnight-ntwrk/wallet-sdk/facade', () => ({
  WalletFacade: {
    init: vi.fn((params: Record<string, (config: unknown) => unknown> & { configuration: unknown }) => {
      /* The starters are the wallet's own closures, run as the SDK runs them,
         so which of cold and restore was chosen is recorded by the mocks below. */
      params.shielded(params.configuration);
      params.unshielded(params.configuration);
      params.dust(params.configuration);
      const facade = {
        start: vi.fn(() => Promise.resolve()),
        stop: vi.fn(() => Promise.resolve()),
        state: vi.fn(() => new Rx.Subject()),
        shielded: {
          getAddress: () => Promise.resolve({}),
          serializeState: () => Promise.resolve('shielded'),
        },
        unshielded: { serializeState: () => Promise.resolve('unshielded') },
        dust: {
          getAddress: () => Promise.resolve({}),
          serializeState: () => Promise.resolve('dust'),
        },
      };
      recorded.facades.push(facade);
      return Promise.resolve(facade);
    }),
  },
}));

vi.mock('@midnight-ntwrk/wallet-sdk/shielded', () => ({
  ShieldedWallet: () => ({
    startWithSecretKeys: () => recorded.starters.push('shielded:cold'),
    restore: () => recorded.starters.push('shielded:restore'),
  }),
}));

vi.mock('@midnight-ntwrk/wallet-sdk/dust', () => ({
  DustWallet: () => ({
    startWithSecretKey: () => recorded.starters.push('dust:cold'),
    restore: () => recorded.starters.push('dust:restore'),
  }),
}));

vi.mock('@midnight-ntwrk/wallet-sdk/unshielded', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@midnight-ntwrk/wallet-sdk/unshielded')>()),
  UnshieldedWallet: () => ({
    startWithPublicKey: () => recorded.starters.push('unshielded:cold'),
    restore: () => recorded.starters.push('unshielded:restore'),
  }),
}));

vi.mock('@midnight-ntwrk/wallet-sdk/address-format', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@midnight-ntwrk/wallet-sdk/address-format')>()),
  MidnightBech32m: { encode: () => ({ asString: () => 'mn_encoded' }) },
}));

vi.mock('./walletSnapshot.js', () => ({
  WALLET_SNAPSHOT_VERSION: 1,
  clearWalletSnapshots: vi.fn(() => Promise.resolve()),
  deleteWalletSnapshot: recorded.remove,
  fetchChainHeight: recorded.height,
  loadWalletSnapshot: recorded.load,
  saveWalletSnapshot: recorded.save,
}));

import { createLocalMidnightWallet, type LocalWalletBalances } from './localWallet.js';

/** A fresh seed per call: the wallet zeroes nothing it is handed, but the test owns it. */
const seed = (): Uint8Array => new Uint8Array(32).fill(7);

beforeEach(() => {
  recorded.starters.length = 0;
  recorded.facades.length = 0;
  recorded.load.mockReset().mockImplementation(() => Promise.resolve(recorded.snapshot));
  recorded.save.mockReset().mockResolvedValue(undefined);
  recorded.remove.mockReset().mockResolvedValue(undefined);
  /* Shallow, so a walking wallet with no snapshot is allowed its cold start. */
  recorded.height.mockReset().mockResolvedValue(120n);
  recorded.snapshot = null;
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
});

describe('a wallet opened with chainSync: false', () => {
  it('is never started, and never reads a snapshot or asks how deep the chain is', async () => {
    const wallet = await createLocalMidnightWallet(seed(), { chainSync: false });

    expect(wallet.chainSync).toBe(false);
    expect(recorded.facades).toHaveLength(1);
    const [facade] = recorded.facades;
    expect(facade.start).not.toHaveBeenCalled();
    expect(recorded.load).not.toHaveBeenCalled();
    expect(recorded.height).not.toHaveBeenCalled();
    expect(recorded.starters).toEqual(['shielded:cold', 'unshielded:cold', 'dust:cold']);
    /* Not even the snapshot checkpointer listens: there is no stream to follow. */
    expect(facade.state).not.toHaveBeenCalled();
    expect(wallet.resumedFromSnapshot).toBe(false);
  });

  it('is not refused on a chain too deep to walk, because it walks nothing', async () => {
    recorded.height.mockResolvedValue(10_000_000n);
    const wallet = await createLocalMidnightWallet(seed(), { chainSync: false });
    expect(wallet.chainSync).toBe(false);
  });

  it('still carries the keys and addresses a contract call is made with', async () => {
    const wallet = await createLocalMidnightWallet(seed(), { chainSync: false });
    expect(wallet.unshieldedAddress).toMatch(/^mn_addr/);
    expect(wallet.shieldedAddress).toBe('mn_encoded');
    expect(typeof wallet.keys.shieldedSecretKeys.coinPublicKey).toBe('string');
    expect(typeof wallet.keys.unshieldedKeystore.signDataAsync).toBe('function');
    expect(wallet.network.networkId).toBe('stagenet');
  });

  it('answers unavailable for its own balance, never the zeros of a state it never read', async () => {
    const wallet = await createLocalMidnightWallet(seed(), { chainSync: false });

    const balances = await wallet.getBalances();
    expect(balances).toMatchObject({
      balanceStatus: 'unavailable',
      unshieldedBalance: null,
      dustBalance: null,
      shieldedTokenCount: null,
    });
    expect(balances.balanceError).toMatch(/without a chain sync/);

    const surfaces = await wallet.surfaces();
    expect(surfaces.addressStatus).toBe('ready');
    expect(surfaces.balanceStatus).toBe('unavailable');

    await expect(wallet.shieldedHoldings()).rejects.toThrow(/without a chain sync/);
    await expect(wallet.waitForSync()).rejects.toThrow(/without a chain sync/);
  });

  it('hands a balance listener one unavailable reading and nothing after it', async () => {
    const wallet = await createLocalMidnightWallet(seed(), { chainSync: false });
    const heard: LocalWalletBalances[] = [];
    const off = wallet.subscribeBalances((balances) => heard.push(balances));
    expect(heard).toHaveLength(1);
    expect(heard[0].balanceStatus).toBe('unavailable');
    off();
    expect(recorded.facades[0].state).not.toHaveBeenCalled();
  });

  it('publishes no sync progress, not even a reading a stall watch could act on', async () => {
    const wallet = await createLocalMidnightWallet(seed(), { chainSync: false });
    const listener = vi.fn();
    const off = wallet.subscribeSyncProgress(listener);
    off();
    expect(listener).not.toHaveBeenCalled();
  });

  it('writes no snapshot, by hand or on close, so a real one is never replaced', async () => {
    const wallet = await createLocalMidnightWallet(seed(), { chainSync: false });
    await wallet.saveSnapshot();
    await wallet.close();
    await wallet.close();
    expect(recorded.save).not.toHaveBeenCalled();
    expect(recorded.facades[0].stop).toHaveBeenCalledTimes(1);
    /* A closed wallet has no listener to answer. */
    const heard: LocalWalletBalances[] = [];
    wallet.subscribeBalances((balances) => heard.push(balances));
    expect(heard).toHaveLength(0);
  });

  it('asks a function for its answer with the network id it really opens on', async () => {
    const asked: string[] = [];
    const wallet = await createLocalMidnightWallet(seed(), {
      chainSync: (networkId) => {
        asked.push(networkId);
        return false;
      },
    });
    expect(asked).toEqual([wallet.network.networkId]);
    expect(wallet.chainSync).toBe(false);
    expect(recorded.facades[0].start).not.toHaveBeenCalled();
  });
});

describe('a wallet opened as every wallet was before (the prototype Passport)', () => {
  it('looks for its snapshot, runs the depth guard, and starts the walk with its own keys', async () => {
    const wallet = await createLocalMidnightWallet(seed());

    expect(wallet.chainSync).toBe(true);
    expect(recorded.load).toHaveBeenCalledWith('stagenet', wallet.unshieldedAddress);
    expect(recorded.height).toHaveBeenCalledTimes(1);
    expect(recorded.starters).toEqual(['shielded:cold', 'unshielded:cold', 'dust:cold']);
    const [facade] = recorded.facades;
    expect(facade.start).toHaveBeenCalledTimes(1);
    expect(facade.start).toHaveBeenCalledWith(
      wallet.keys.shieldedSecretKeys,
      wallet.keys.dustSecretKey,
    );
    /* The snapshot checkpointer follows the stream the walk drives. */
    expect(facade.state).toHaveBeenCalled();
    await wallet.close();
  });

  it('resumes from its snapshot and walks on from there', async () => {
    recorded.snapshot = {
      version: 1,
      networkId: 'stagenet',
      unshieldedAddress: 'mn_addr_test',
      savedAt: '2026-09-27T00:00:00.000Z',
      shielded: 'shielded',
      unshielded: 'unshielded',
      dust: 'dust',
    };
    const wallet = await createLocalMidnightWallet(seed(), { chainSync: () => true });

    expect(wallet.resumedFromSnapshot).toBe(true);
    expect(recorded.height).not.toHaveBeenCalled();
    expect(recorded.starters).toEqual(['shielded:restore', 'unshielded:restore', 'dust:restore']);
    expect(recorded.facades[0].start).toHaveBeenCalledTimes(1);
    await wallet.close();
  });

  it('is still refused on a chain too deep to walk from nothing', async () => {
    recorded.height.mockResolvedValue(10_000_000n);
    await expect(createLocalMidnightWallet(seed(), { chainSync: true })).rejects.toMatchObject({
      name: 'WalletBootstrapError',
      code: 'chain-too-deep',
    });
  });
});
