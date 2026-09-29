/**
 * Drills for the per-network endpoint tables and the guards over them.
 *
 * This module exists because the demo used to be pinned to Preview in a dozen
 * places, and pointing the deployment elsewhere left the UI saying "preview
 * only" and linking at the Preview faucet. So the things drilled here are the
 * ones that produce a LIE on screen when they are wrong: a link that resolves
 * to nothing, a faucet for a network that has none, a claim path offered on a
 * network this build's ledger cannot speak.
 *
 * Every environment-reading function is drilled through the optional `env`
 * parameter each of them carries, not by rewriting the ambient one. Both
 * alternatives were measured here on 2026/08/25 and neither reaches the module:
 * `vi.stubEnv` writes `process.env` and leaves vitest's `import.meta.env`
 * untouched, and writing `import.meta.env` from a test writes the TEST file's
 * `import.meta`, which the SSR transform gives each module separately. A test
 * built on either would pass against a value `networks.ts` never sees.
 *
 * Run from the workspace root: `npx vitest run examples/passport-demo/src/lib`.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  CLAIMABLE_NETWORKS,
  DEFAULT_NETWORK_ID,
  EXPLORER_URLS,
  FAUCET_URLS,
  TRANSACTABLE_NETWORKS,
  aliasRegistrationSupported,
  asPassportNetwork,
  configuredNetworkId,
  defaultSelectedNetwork,
  explorerTxUrl,
  txReceiptLink,
  isTxIdentifier,
  resolveReceiptHash,
  RECEIPT_HASH_ATTEMPTS,
  RECEIPT_HASH_INTERVAL_MS,
  explorerUrlFor,
  faucetAvailable,
  faucetUrlFor,
  isLedgerTxHash,
  networkIsTransactable,
  networkUnavailableReason,
  walletNetwork,
} from './networks.js';

/** A real 32-byte ledger transaction hash: 64 hex characters. */
const TX_HASH = 'ea39f2c1b47d80a95e6f3c2d1b0a9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e';
/** What `submitTransaction` answers with: a 33-byte IDENTIFIER, 66 characters. */
const TX_IDENTIFIER = `00${TX_HASH}`;

describe('what this build can actually do', () => {
  it('transacts on stagenet and on nothing else', () => {
    expect(TRANSACTABLE_NETWORKS).toEqual(['stagenet']);
    expect(DEFAULT_NETWORK_ID).toBe('stagenet');
    expect(networkIsTransactable('stagenet')).toBe(true);
    for (const network of ['preview', 'preprod', 'mainnet', 'undeployed', null, undefined]) {
      expect(networkIsTransactable(network)).toBe(false);
    }
  });

  it('registers a name on stagenet and on nothing else', () => {
    expect(CLAIMABLE_NETWORKS).toEqual(['stagenet']);
    expect(aliasRegistrationSupported('stagenet')).toBe(true);
    // Mainnet was always absent: a wallet seeded from a browser passkey has no
    // business spending real NIGHT.
    for (const network of ['preview', 'preprod', 'mainnet', 'undeployed', null, undefined]) {
      expect(aliasRegistrationSupported(network)).toBe(false);
    }
  });
});

describe('networkUnavailableReason', () => {
  it('says nothing about a network that works', () => {
    expect(networkUnavailableReason('stagenet')).toBeNull();
  });

  it('names the ledger-9 protocol gap for the two ledger-8 networks', () => {
    for (const network of ['preview', 'preprod']) {
      const reason = networkUnavailableReason(network);
      expect(reason).toContain('ledger-9 protocol');
      expect(reason).toContain(network);
      // Already-registered names still resolve there; the sentence says so.
      expect(reason).toContain('still resolve');
    }
  });

  it('gives mainnet its own, different reason', () => {
    expect(networkUnavailableReason('mainnet')).toContain('no business spending real NIGHT');
  });

  it('has nothing to say about a network it does not know', () => {
    // A devnet id is not a KNOWN network, so there is no honest sentence to
    // show — and inventing one would be worse than the switcher's silence.
    expect(networkUnavailableReason('undeployed')).toBeNull();
    expect(networkUnavailableReason(null)).toBeNull();
    expect(networkUnavailableReason(undefined)).toBeNull();
  });
});

describe('asPassportNetwork', () => {
  it('narrows the four public networks and refuses everything else', () => {
    for (const network of ['stagenet', 'preview', 'preprod', 'mainnet']) {
      expect(asPassportNetwork(network)).toBe(network);
    }
    expect(asPassportNetwork('undeployed')).toBeNull();
    expect(asPassportNetwork('')).toBeNull();
    expect(asPassportNetwork(null)).toBeNull();
    expect(asPassportNetwork(undefined)).toBeNull();
  });
});

describe('configuredNetworkId', () => {
  it('reads the build’s own id, trimming it, and defaults to stagenet', () => {
    expect(configuredNetworkId({ VITE_MIDNIGHT_NETWORK_ID: '  preview  ' })).toBe('preview');
    expect(configuredNetworkId({ VITE_MIDNIGHT_NETWORK_ID: '   ' })).toBe('stagenet');
    expect(configuredNetworkId({})).toBe('stagenet');
  });

  it('reads the build’s own environment when nothing is passed', () => {
    /* The zero-argument form is what every caller in the app uses. It cannot
       be told what to read, so what is asserted is the invariant that holds
       for any build: an id, never an empty string. */
    expect(configuredNetworkId()).toMatch(/^\S+$/);
  });
});

describe('walletNetwork and defaultSelectedNetwork', () => {
  it('answers with the configured public network', () => {
    const env = { VITE_MIDNIGHT_NETWORK_ID: 'preview' };
    expect(walletNetwork(env)).toBe('preview');
    expect(defaultSelectedNetwork(env)).toBe('preview');
  });

  it('reads the build’s own environment when nothing is passed', () => {
    // Whatever this build is, the switcher always opens on a known network.
    expect(asPassportNetwork(defaultSelectedNetwork())).not.toBeNull();
  });

  it('is null on a devnet build, and the switcher falls back to the default', () => {
    const env = { VITE_MIDNIGHT_NETWORK_ID: 'undeployed' };
    expect(walletNetwork(env)).toBeNull();
    // The switcher still has to show SOMETHING, so it shows the documented
    // default — while the wallet keeps signing on its real configured network.
    expect(defaultSelectedNetwork(env)).toBe('stagenet');
    // An override present but blank is not an override.
    expect(walletNetwork({ ...env, VITE_MIDNAMES_TLD_ADDRESS: '   ' })).toBeNull();
  });

  it('lets a devnet build carrying a local TLD present as the default network', () => {
    /* The env-gated demo masquerade. Public builds never set this, so the
       branch is dead there and behaviour is byte-identical. */
    const env = {
      VITE_MIDNIGHT_NETWORK_ID: 'undeployed',
      VITE_MIDNAMES_TLD_ADDRESS: 'be'.repeat(32),
    };
    expect(walletNetwork(env)).toBe('stagenet');
    expect(defaultSelectedNetwork(env)).toBe('stagenet');
  });
});

describe('faucets', () => {
  it('names one only where a public faucet really exists', () => {
    expect(faucetUrlFor('stagenet')).toBe(FAUCET_URLS.stagenet);
    expect(faucetUrlFor('preview')).toBe('https://faucet.preview.midnight.network');
    expect(faucetUrlFor('preprod')).toBe('https://faucet.preprod.midnight.network');
    expect(faucetAvailable('stagenet')).toBe(true);
  });

  it('has no faucet for mainnet, and none for an unknown network', () => {
    // Mainnet has no faucet and never will — its absence here is the point.
    expect(faucetUrlFor('mainnet')).toBeNull();
    expect(faucetAvailable('mainnet')).toBe(false);
    expect(faucetUrlFor('undeployed')).toBeNull();
    expect(faucetUrlFor(null)).toBeNull();
    expect(faucetAvailable(undefined)).toBe(false);
  });
});

describe('explorer links', () => {
  it('has an explorer only where a real transaction has been seen to render', () => {
    expect(explorerUrlFor('preview')).toBe('https://explorer.1am.xyz');
    expect(explorerUrlFor('preprod')).toBe(EXPLORER_URLS.preprod);
    // Stagenet went in on 2026/08/25, once a real stagenet transaction was
    // seen to render there; mainnet still has not been.
    expect(explorerUrlFor('stagenet')).toBe('https://explorer.1am.xyz');
    expect(explorerUrlFor('mainnet')).toBeNull();
    expect(explorerUrlFor('undeployed')).toBeNull();
    expect(explorerUrlFor(null)).toBeNull();
  });

  it('accepts a 64-hex ledger hash and refuses the 66-hex identifier', () => {
    expect(isLedgerTxHash(TX_HASH)).toBe(true);
    expect(isLedgerTxHash(TX_HASH.toUpperCase())).toBe(true);
    // The identifier midnight-js answers a submit with. Linking it produced an
    // explorer page saying the transaction does not exist.
    expect(isLedgerTxHash(TX_IDENTIFIER)).toBe(false);
    expect(isLedgerTxHash(`${TX_HASH.slice(0, 63)}g`)).toBe(false);
    expect(isLedgerTxHash(null)).toBe(false);
    expect(isLedgerTxHash(undefined)).toBe(false);
    expect(isLedgerTxHash(42 as unknown as string)).toBe(false);
  });

  it('builds a link only when the explorer AND the hash are both real', () => {
    expect(explorerTxUrl('preview', TX_HASH)).toBe(
      `https://explorer.1am.xyz/tx/${TX_HASH}?network=preview`,
    );
    expect(explorerTxUrl('stagenet', TX_HASH)).toBe(
      `https://explorer.1am.xyz/tx/${TX_HASH}?network=stagenet`,
    );
    // Every way this can fail lands on null, and the caller renders text.
    expect(explorerTxUrl('mainnet', TX_HASH)).toBeNull();
    expect(explorerTxUrl('undeployed', TX_HASH)).toBeNull();
    expect(explorerTxUrl(null, TX_HASH)).toBeNull();
    expect(explorerTxUrl('preview', TX_IDENTIFIER)).toBeNull();
    expect(explorerTxUrl('preview', null)).toBeNull();
    expect(explorerTxUrl('preview', undefined)).toBeNull();
  });
});

describe('the link a submitted transaction gets', () => {
  /* What a success toast is FOR: the moment the user can go and look at the
     thing that just happened. The rule is that there is either a link that
     resolves or no link at all — never one that lands on "does not exist". */

  it('sends a real ledger hash to the explorer', () => {
    expect(txReceiptLink('stagenet', TX_HASH)).toEqual({
      label: 'View on explorer',
      href: `https://explorer.1am.xyz/tx/${TX_HASH}?network=stagenet`,
    });
  });

  it('never links a payment to the verifier, or to anything by name (2026/09/28)', () => {
    /* A tester who sent mUSD was handed the verifier searched by their own
       name. An identifier the indexer has not mapped yet now gets NO link, and
       the link arrives once the hash does. */
    for (const value of [TX_HASH, TX_IDENTIFIER, 'alice.night', 'alice', null, undefined, '']) {
      for (const network of ['stagenet', 'preview', 'preprod', 'mainnet', null]) {
        const link = txReceiptLink(network, value);
        if (link === null) continue;
        expect(link.href).toMatch(/^https:\/\/explorer\.1am\.xyz\/tx\/[0-9a-f]{64}\?network=/);
        expect(link.href).not.toMatch(/verify|\?q=|night/);
      }
    }
    // The function no longer takes a name at all.
    expect(txReceiptLink.length).toBe(2);
  });

  it('gives no link when there is genuinely nowhere to send anyone', () => {
    expect(txReceiptLink('stagenet', TX_IDENTIFIER)).toBeNull();
    expect(txReceiptLink('mainnet', TX_HASH)).toBeNull();
    expect(txReceiptLink(null, null)).toBeNull();
  });
});

describe('finding the hash a receipt links to', () => {
  it('knows an identifier when it sees one', () => {
    expect(isTxIdentifier(TX_IDENTIFIER)).toBe(true);
    expect(isTxIdentifier(TX_IDENTIFIER.toUpperCase())).toBe(true);
    expect(isTxIdentifier(TX_HASH)).toBe(false);
    expect(isTxIdentifier(`0x${TX_HASH}`)).toBe(false);
    expect(isTxIdentifier(null)).toBe(false);
    expect(isTxIdentifier(undefined)).toBe(false);
  });

  it('takes a ledger hash as its own answer, without asking anybody', async () => {
    let asked = 0;
    const lookup = () => {
      asked += 1;
      return Promise.resolve(null);
    };
    await expect(resolveReceiptHash(TX_HASH.toUpperCase(), { lookup })).resolves.toBe(TX_HASH);
    expect(asked).toBe(0);
  });

  it('asks nothing about a value that is neither', async () => {
    let asked = 0;
    const lookup = () => {
      asked += 1;
      return Promise.resolve(TX_HASH);
    };
    for (const value of ['alice.night', '', null, undefined, `0x${TX_HASH}`]) {
      await expect(resolveReceiptHash(value, { lookup })).resolves.toBeNull();
    }
    expect(asked).toBe(0);
  });

  it('asks about an identifier until the indexer answers, and waits between asks', async () => {
    const answers: (string | null | Error)[] = [null, new Error('socket dropped'), 'not-a-hash', TX_HASH.toUpperCase()];
    const asked: string[] = [];
    const waits: number[] = [];
    const hash = await resolveReceiptHash(TX_IDENTIFIER, {
      lookup: (identifier) => {
        asked.push(identifier);
        const next = answers.shift() ?? null;
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
      },
      intervalMs: 250,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    expect(hash).toBe(TX_HASH);
    expect(asked).toEqual([TX_IDENTIFIER, TX_IDENTIFIER, TX_IDENTIFIER, TX_IDENTIFIER]);
    expect(waits).toEqual([250, 250, 250]);
  });

  it('gives up after its window with no answer, and never waits after the last ask', async () => {
    let asked = 0;
    let waited = 0;
    const hash = await resolveReceiptHash(TX_IDENTIFIER, {
      lookup: () => {
        asked += 1;
        return Promise.resolve(null);
      },
      attempts: 3,
      sleep: () => {
        waited += 1;
        return Promise.resolve();
      },
    });
    expect(hash).toBeNull();
    expect(asked).toBe(3);
    expect(waited).toBe(2);
  });

  it('stops when the caller has gone, before or after an ask', async () => {
    await expect(
      resolveReceiptHash(TX_IDENTIFIER, { lookup: () => Promise.resolve(TX_HASH), cancelled: () => true }),
    ).resolves.toBeNull();
    let gone = false;
    await expect(
      resolveReceiptHash(TX_IDENTIFIER, {
        lookup: () => {
          gone = true;
          return Promise.resolve(TX_HASH);
        },
        cancelled: () => gone,
      }),
    ).resolves.toBeNull();
  });

  it('by default asks every five seconds for two and a half minutes, on a real clock', async () => {
    expect(RECEIPT_HASH_ATTEMPTS * RECEIPT_HASH_INTERVAL_MS).toBe(150_000);
    vi.useFakeTimers();
    try {
      let asked = 0;
      const pending = resolveReceiptHash(TX_IDENTIFIER, {
        lookup: () => {
          asked += 1;
          return Promise.resolve(asked === 2 ? TX_HASH : null);
        },
      });
      await vi.advanceTimersByTimeAsync(RECEIPT_HASH_INTERVAL_MS);
      await expect(pending).resolves.toBe(TX_HASH);
      expect(asked).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

});
