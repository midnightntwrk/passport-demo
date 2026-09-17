/**
 * Drills for BEING PAID — the deposits, on every build a recipient may hold.
 *
 * WHY THESE ARE MOCKED WHERE THE REST OF `accountCustody.test.ts` IS NOT
 * ---------------------------------------------------------------------
 * That file drills byte helpers and a decoder, both of which are pure, and
 * leaves everything that moves money to the live walk. These are also things
 * that move money — and they are here because what decides them is not a proof
 * or a balance but a CHOICE OF WORDS: which circuit is called, how many
 * arguments it is given, which artefact namespace its keys are fetched under,
 * and which private state and witness set the connection carries. Every one of
 * those is wrong SILENTLY against a recipient on the newer build:
 *
 *   - `deposit_night` does not exist there, so a payment is refused after the
 *     money has already left the sender's account in an earlier leg;
 *   - `deposit_shielded(coin)` with the entry missing is refused by the
 *     compiled ABI, and were it not, a deposit with a placeholder entry LANDS
 *     and the coin is unreachable for ever;
 *   - the wrong label fetches keys for circuits that tree has never heard of;
 *   - the prototype's private state and three witnesses belong to a different
 *     contract altogether.
 *
 * None of that needs a chain to be established, and none of it should wait for
 * one. What IS left to the live walk is the only thing these cannot answer:
 * whether the network accepts the transaction they build.
 *
 * The seams replaced are the ones that need a network or a WASM ledger — the
 * providers, the compiled artefact, `findDeployedContract`, the indexer read,
 * and the fee sponsor. The sealing, the delivery walk, and every decision under
 * test are the real ones.
 */

import * as Rx from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LocalMidnightWallet } from '../lib/localWallet.js';
import {
  ACCOUNT_CUSTODY_LABEL,
  custodyWitnesses,
} from './custodyContractClient.js';
import {
  CUSTODY_INBOX_ENTRY_BYTES,
  generateCustodyEncKeyPair,
  openCustodyInboxEntry,
} from './custodyInbox.js';

/* -------------------------------------------------------------------------- */
/* The seams                                                                  */
/* -------------------------------------------------------------------------- */

/** Which build the indexer says is deployed at an address. */
const readAccountBuild =
  vi.fn<(url: string, address: string) => Promise<'account' | 'account-v1' | 'account-custody' | null>>();

vi.mock('./passportContract.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./passportContract.js')>()),
  readAccountBuild: (url: string, address: string) => readAccountBuild(url, address),
  /* The identifier→hash lookup, answered at once: its twenty half-second
     attempts are not what these drills are about. */
  resolveDeployTxHashOnce: () => Promise.resolve('ledgerhash'),
}));

/** Every circuit call that reached the contract, in order. */
const calls: { circuit: string; args: unknown[] }[] = [];
/** Every compiled artefact this module asked for. */
const compiled: { module: string; label: string; witnesses: unknown }[] = [];
/** Every provider set, so the artefact tree and proof route can be checked. */
const providerSets: { contract: string; initialPrivateState: unknown }[] = [];
/** What `findDeployedContract` was opened with. */
const openings: { contractAddress: string; initialPrivateState: unknown }[] = [];

/** The recipient's public state, mutable so a deposit can be seen to land. */
const recipient = {
  encKeyHex: null as string | null,
  inboxCount: 0n,
  entries: new Map<string, Uint8Array>(),
};

/** The contract module for the newer build: one decode, over the state above. */
const custodyModule = {
  ledger: () => ({
    get enc_key(): Uint8Array | null {
      return recipient.encKeyHex === null ? null : hexToBytes(recipient.encKeyHex);
    },
    get inbox_count(): bigint {
      return recipient.inboxCount;
    },
    inbox: {
      member: (index: bigint) => recipient.entries.has(index.toString()),
      lookup: (index: bigint) => recipient.entries.get(index.toString()) as Uint8Array,
    },
  }),
};

vi.mock('./contractRuntime.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./contractRuntime.js')>()),
  createContractProviders: (
    _wallet: unknown,
    options: { contract: string; initialPrivateState: unknown },
  ) => {
    providerSets.push({
      contract: options.contract,
      initialPrivateState: options.initialPrivateState,
    });
    return Promise.resolve({});
  },
  compiledContractFor: (module: string, label: string, witnesses: unknown) => {
    compiled.push({ module, label, witnesses });
    return Promise.resolve({ label });
  },
  loadContractModule: (name: string) =>
    Promise.resolve(name === 'account-custody' ? custodyModule : {}),
  sharedPublicDataProvider: () =>
    Promise.resolve({
      queryContractState: () => Promise.resolve({ data: {} }),
    }),
}));

vi.mock('../lib/sponsor.js', () => ({
  sponsorReadiness: () => Promise.resolve({ state: 'ready' }),
  sponsorFeeRefusal: () => 'The fee sponsor is not covering payments just now.',
}));

vi.mock('@midnight-ntwrk/midnight-js-contracts', () => ({
  findDeployedContract: (
    _providers: unknown,
    options: { contractAddress: string; initialPrivateState: unknown },
  ) => {
    openings.push({
      contractAddress: options.contractAddress,
      initialPrivateState: options.initialPrivateState,
    });
    return Promise.resolve({
      callTx: new Proxy(
        {},
        {
          get:
            (_target, circuit: string) =>
            (...args: unknown[]) => {
              calls.push({ circuit, args });
              onCall?.(circuit, args);
              return Promise.resolve({ public: { txId: 'submitted-identifier' } });
            },
        },
      ),
    });
  },
}));

/** What the contract does when a circuit is called, for the drill that cares. */
let onCall: ((circuit: string, args: unknown[]) => void) | null = null;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

const PEER = '26aef743602f1bd50bb3c41ac9d106635781e8eaf35b3c7903e3c6f2d4913a40';
const MUSD = '1a2917fbed8b5ce44d12ebc7d337689045f6c96a6bbd39cf3d8691ab310ef6a6';
const NIGHT_COLOUR = `${'00'.repeat(32)}`;

/** One shielded note, as a deposit takes it. */
const COIN = {
  nonce: hexToBytes('11'.repeat(32)),
  color: hexToBytes(MUSD),
  value: 250_000n,
};

/** A wallet facade that holds NIGHT and answers at once. */
function walletHolding(nightAtomic: bigint): LocalMidnightWallet {
  return {
    network: {
      indexerHttpUrl: 'https://indexer.example/api/v4/graphql',
      indexerWsUrl: 'wss://indexer.example/api/v4/graphql/ws',
      networkId: 'stagenet',
      provingServerUrls: [],
      provingServerUrlsV3: ['https://prover.example/prover-v3'],
    },
    facade: {
      state: () =>
        Rx.of({
          shielded: { coinPublicKey: {}, encryptionPublicKey: {}, availableCoins: [] },
          unshielded: { balances: { [NIGHT_COLOUR]: nightAtomic } },
          dust: { balance: () => 0n },
        }),
    },
  } as unknown as LocalMidnightWallet;
}

async function loadModule() {
  const module = await import('./accountCustody.js');
  module.resetAccountModuleChoice();
  return module;
}

beforeEach(() => {
  calls.length = 0;
  compiled.length = 0;
  providerSets.length = 0;
  openings.length = 0;
  recipient.encKeyHex = null;
  recipient.inboxCount = 0n;
  recipient.entries.clear();
  onCall = null;
  readAccountBuild.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

/** What the delivery watch is given, in fake time, before it gives up.
 *
 * Stepped rather than advanced in one jump, because the watch does not exist
 * yet when the test starts advancing: the sealing in front of it is real
 * asynchronous work, and each step flushes what has settled since the last. */
const runOutTheDeliveryWatch = async (): Promise<void> => {
  for (let tick = 0; tick < 40; tick += 1) await vi.advanceTimersByTimeAsync(3_000);
};

/* -------------------------------------------------------------------------- */
/* NIGHT                                                                      */
/* -------------------------------------------------------------------------- */

describe('depositNight, against the build the recipient really holds', () => {
  it('calls deposit_night on a prototype account, exactly as it always has', async () => {
    readAccountBuild.mockResolvedValue('account');
    const { depositNight, nightColourHex } = await loadModule();
    await depositNight(walletHolding(10n), {
      contractAddress: PEER,
      colourHex: nightColourHex(),
      amount: 5n,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.circuit).toBe('deposit_night');
    expect(calls[0]?.args).toHaveLength(2);
  });

  it('calls deposit_unshielded on the newer build, with the same two arguments', async () => {
    /* The rename is the whole difference: same permissionless payment, same
       colour and amount, a name the other build does not carry. */
    readAccountBuild.mockResolvedValue('account-custody');
    const { depositNight, nightColourHex } = await loadModule();
    await depositNight(walletHolding(10n), {
      contractAddress: PEER,
      colourHex: nightColourHex(),
      amount: 5n,
    });
    expect(calls[0]?.circuit).toBe('deposit_unshielded');
    expect(calls[0]?.args[1]).toBe(5n);
  });

  it('opens the newer build with its own artefacts, private state, and witness', async () => {
    readAccountBuild.mockResolvedValue('account-custody');
    const { depositNight, nightColourHex } = await loadModule();
    await depositNight(walletHolding(10n), {
      contractAddress: PEER,
      colourHex: nightColourHex(),
      amount: 5n,
    });
    /* The artefact tree and the proof route both follow the module NAME —
       `contractRuntime.ts` sends `account-custody` to the v3 proof servers and
       to `/zk/account-custody`, and `contractRuntime.test.ts` drills that. This
       is the half that decides which name it is handed. */
    expect(providerSets[0]?.contract).toBe('account-custody');
    expect(compiled[0]?.module).toBe('account-custody');
    expect(compiled[0]?.label).toBe(ACCOUNT_CUSTODY_LABEL);
    /* The coin store's shape, empty — not the prototype's three secrets. */
    expect(providerSets[0]?.initialPrivateState).toEqual({ coins: {} });
    expect(openings[0]?.initialPrivateState).toEqual({ coins: {} });
    /* And the only witness that build declares, refusing, because no payment
       INTO an account spends what that account holds. */
    expect(Object.keys(compiled[0]?.witnesses as object)).toEqual(
      Object.keys(custodyWitnesses()),
    );
    expect(() => (compiled[0]?.witnesses as { held_coin(): never }).held_coin()).toThrow(
      /cannot spend/,
    );
  });

  it('refuses a name that resolves to something that is not an account', async () => {
    readAccountBuild.mockResolvedValue(null);
    const { depositNight, nightColourHex } = await loadModule();
    await expect(
      depositNight(walletHolding(10n), {
        contractAddress: PEER,
        colourHex: nightColourHex(),
        amount: 5n,
      }),
    ).rejects.toMatchObject({ code: 'network-unreachable' });
    expect(calls).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Shielded                                                                   */
/* -------------------------------------------------------------------------- */

describe('depositShielded, into a prototype account', () => {
  it('passes the coin alone, and says nothing about delivery', async () => {
    readAccountBuild.mockResolvedValue('account-v1');
    const { depositShielded } = await loadModule();
    const result = await depositShielded(walletHolding(0n), {
      contractAddress: PEER,
      coin: COIN,
    });
    expect(calls[0]?.circuit).toBe('deposit_shielded');
    expect(calls[0]?.args).toHaveLength(1);
    /* Those accounts mirror what they hold, so the credit is readable and a
       caller that never heard of this field behaves as it always did. */
    expect(result.delivery).toBeUndefined();
  });
});

describe('depositShielded, into the newer build', () => {
  it('seals the coin to the key the account publishes, and the owner can open it', async () => {
    const keys = generateCustodyEncKeyPair();
    recipient.encKeyHex = keys.publicKeyHex;
    recipient.inboxCount = 4n;
    readAccountBuild.mockResolvedValue('account-custody');
    onCall = (circuit, args) => {
      /* The contract writes the entry it was given into the public list. */
      if (circuit !== 'deposit_shielded') return;
      recipient.entries.set(recipient.inboxCount.toString(), args[1] as Uint8Array);
      recipient.inboxCount += 1n;
    };

    const { depositShielded } = await loadModule();
    const result = await depositShielded(walletHolding(0n), {
      contractAddress: PEER,
      coin: COIN,
    });

    expect(calls[0]?.circuit).toBe('deposit_shielded');
    expect(calls[0]?.args).toHaveLength(2);
    const [coin, entry] = calls[0]?.args as [
      { nonce: Uint8Array; color: Uint8Array; value: bigint },
      Uint8Array,
    ];
    expect(bytesToHex(coin.nonce)).toBe(bytesToHex(COIN.nonce));
    expect(bytesToHex(coin.color)).toBe(MUSD);
    expect(coin.value).toBe(COIN.value);
    expect(entry).toHaveLength(CUSTODY_INBOX_ENTRY_BYTES);

    /* THE POINT OF THE SECOND ARGUMENT: the recipient, and only the recipient,
       learns what they were paid. */
    await expect(openCustodyInboxEntry(keys.secretKeyHex, entry)).resolves.toEqual({
      colour: MUSD,
      nonce: bytesToHex(COIN.nonce),
      value: COIN.value,
    });

    /* And the payment is reported delivered only because those same bytes were
       found in the list. */
    expect(result.delivery).toBe('delivered');
  });

  it('refuses when the account publishes no key to seal to, and sends nothing', async () => {
    /* A deposit with a placeholder entry lands and the coin is unreachable for
       ever, so this is the one case where refusing IS the careful answer. */
    recipient.encKeyHex = null;
    readAccountBuild.mockResolvedValue('account-custody');
    const { depositShielded } = await loadModule();
    const error = await depositShielded(walletHolding(0n), {
      contractAddress: PEER,
      coin: COIN,
    }).catch((cause: unknown) => cause);
    expect((error as { code: string }).code).toBe('invalid-request');
    expect((error as Error).message).toBe(
      'That Passport cannot receive this kind of payment yet, so nothing was sent.',
    );
    expect(calls).toHaveLength(0);
  });

  it('reports unconfirmed, not done, when the delivery cannot be found', async () => {
    /* The transaction was submitted and may well be there; what is missing is
       the evidence. The caller shows that as a payment still confirming, never
       as a failure and never as an arrival. */
    const keys = generateCustodyEncKeyPair();
    recipient.encKeyHex = keys.publicKeyHex;
    readAccountBuild.mockResolvedValue('account-custody');
    const { depositShielded } = await loadModule();
    vi.useFakeTimers();
    const pending = depositShielded(walletHolding(0n), { contractAddress: PEER, coin: COIN });
    await runOutTheDeliveryWatch();
    await expect(pending).resolves.toMatchObject({ delivery: 'unconfirmed' });
    expect(calls).toHaveLength(1);
  });

  it('is not talked into confirming by somebody else’s payment landing', async () => {
    /* The list grows for every payment anybody makes into that account. Ours
       was refused here, and a confirmation built on the growth alone would have
       told the sender it arrived. */
    const keys = generateCustodyEncKeyPair();
    recipient.encKeyHex = keys.publicKeyHex;
    readAccountBuild.mockResolvedValue('account-custody');
    onCall = () => {
      recipient.entries.set(recipient.inboxCount.toString(), new Uint8Array(192).fill(3));
      recipient.inboxCount += 1n;
    };
    const { depositShielded } = await loadModule();
    vi.useFakeTimers();
    const pending = depositShielded(walletHolding(0n), { contractAddress: PEER, coin: COIN });
    await runOutTheDeliveryWatch();
    await expect(pending).resolves.toMatchObject({ delivery: 'unconfirmed' });
  });
});

/* -------------------------------------------------------------------------- */
/* The one helper another surface calls                                       */
/* -------------------------------------------------------------------------- */

describe('payCustodyAccount', () => {
  it('pays NIGHT without the caller naming a circuit', async () => {
    readAccountBuild.mockResolvedValue('account-custody');
    const { payCustodyAccount, nightColourHex } = await loadModule();
    await payCustodyAccount(walletHolding(10n), {
      targetAddress: PEER,
      kind: 'night',
      colourHex: nightColourHex(),
      amount: 5n,
    });
    expect(calls[0]?.circuit).toBe('deposit_unshielded');
  });

  it('pays a shielded amount, sealed, and answers with what it could establish', async () => {
    const keys = generateCustodyEncKeyPair();
    recipient.encKeyHex = keys.publicKeyHex;
    readAccountBuild.mockResolvedValue('account-custody');
    onCall = (circuit, args) => {
      recipient.entries.set(recipient.inboxCount.toString(), args[1] as Uint8Array);
      recipient.inboxCount += 1n;
    };
    const { payCustodyAccount } = await loadModule();
    const result = await payCustodyAccount(walletHolding(0n), {
      targetAddress: PEER,
      kind: 'shielded',
      coin: COIN,
    });
    expect(calls[0]?.circuit).toBe('deposit_shielded');
    expect(calls[0]?.args).toHaveLength(2);
    expect(result.delivery).toBe('delivered');
  });

  it('routes the same payment into a prototype account with the older words', async () => {
    readAccountBuild.mockResolvedValue('account');
    const { payCustodyAccount } = await loadModule();
    const result = await payCustodyAccount(walletHolding(0n), {
      targetAddress: PEER,
      kind: 'shielded',
      coin: COIN,
    });
    expect(calls[0]?.circuit).toBe('deposit_shielded');
    expect(calls[0]?.args).toHaveLength(1);
    expect(result.delivery).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* The label, in two places, agreeing                                         */
/* -------------------------------------------------------------------------- */

describe('accountContractLabel', () => {
  it('is the account custody namespace for that build and the account’s for both prototypes', async () => {
    const { accountContractLabel } = await loadModule();
    /* The two modules that name this build declare the string separately —
       this is the assertion that they cannot drift. */
    expect(accountContractLabel('account-custody')).toBe(ACCOUNT_CUSTODY_LABEL);
    expect(accountContractLabel('account')).toBe('passport-account');
    expect(accountContractLabel('account-v1')).toBe('passport-account');
  });
});

/* -------------------------------------------------------------------------- */
/* Narrowing a route without deciding a payment                               */
/* -------------------------------------------------------------------------- */

describe('accountModuleIfKnown', () => {
  const NETWORK = { indexerHttpUrl: 'https://indexer.example/api/v4/graphql' };

  it('hands back a definite answer as itself', async () => {
    readAccountBuild.mockResolvedValue('account-custody');
    const { accountModuleIfKnown } = await loadModule();
    await expect(accountModuleIfKnown(NETWORK, PEER)).resolves.toBe('account-custody');
  });

  it('answers null where the build could not be established', async () => {
    readAccountBuild.mockResolvedValue(null);
    const { accountModuleIfKnown } = await loadModule();
    await expect(accountModuleIfKnown(NETWORK, PEER)).resolves.toBeNull();
  });

  it('answers null for something that is not an address at all', async () => {
    const { accountModuleIfKnown } = await loadModule();
    await expect(accountModuleIfKnown(NETWORK, 'not-an-address')).resolves.toBeNull();
    expect(readAccountBuild).not.toHaveBeenCalled();
  });
});
