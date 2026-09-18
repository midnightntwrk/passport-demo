/**
 * What the sponsor makes of an account custody contract's REAL state.
 *
 * The three fixtures beside this file are not constructions. Each is the
 * verbatim `contract(address){ state }` answer the stagenet indexer
 * (`https://indexer.stagenet.shielded.tools/api/v4/graphql`) gave on
 * 2026/09/18 for a contract that exists:
 *
 *   - `account-state-custody-jubjub.json` —
 *     `9448e16665d0aa3ef103ff2eff5ca50694d44318d8a9c66998b8d57927755c11`, the
 *     passkey Passport made in a browser that morning and named
 *     `jjmu762ou7yywl.night` (activation `c6f4e234…`, block 517984). Thirty
 *     entry points, `booted`, one device, an empty inbox.
 *   - `account-state-custody-k256.json` —
 *     `0ffd70ad38ce81e8378c8269ef1b127d5f90a77dba4f7618bf48eeb836ad2746`, the
 *     Dynamic-born account behind `dynone1.night`, which has been spending: it
 *     is at round 14 with four inbox entries.
 *   - `contract-state-not-an-account.json` —
 *     `4fc92e152e8d854ef9337275504244e18bd6e3d7d41fd81ed2dabf62be78e92f`, the
 *     mUSD faucet this sponsor mints from. One entry point, `mint_shielded`,
 *     and a ledger shaped nothing like an account's. It is here so the refusal
 *     the balancer exists to make — a contract that is not a Passport — is
 *     asserted against a real contract rather than against a decoder somebody
 *     told to throw.
 *   - `account-state-prototype.json` —
 *     `0f2ddd277102e73380dd6751e839fbfc0d017bbef89c01bc7dc70f03c6e30f93`, the
 *     twelve-circuit prototype Passport `pkmu66rhz9dvmc.night`, holding
 *     2,000 NIGHT and a coin of 40. It is the SNAPSHOT: every assertion about
 *     it here is what the sponsor answered before any of this changed, so a
 *     custody-aware pre-flight that quietly moved a prototype account's answer
 *     would fail this file rather than a Passport.
 *
 * THE DEFECT THIS REPRODUCES. `POST /fund-account`'s pre-flight asks
 * `funder.balances()`, which read through `readAccount` → the PROTOTYPE decode
 * and its structural fingerprint. A custody account has neither
 * `recovery_shares` nor `night_balances`, so the decode throws and a Passport
 * that had just been set up and named was told:
 *
 *     HTTP 400 {"error":"not-an-account","message":"The contract at 9448e166…
 *     is not a Passport account-custody contract — its state does not decode as
 *     one — so the balancer will not deposit into it."}
 *
 * The first `describe` below is that refusal, reproduced off the same state the
 * sponsor was refusing. The rest is the fix: the module read from a POSITIVE
 * marker, and the view read with the build the account actually is.
 */

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ContractState } from '@midnight-ntwrk/compact-runtime';

import { accountModuleForState } from '../src/accountModule.js';
import {
  AccountStateRefusal,
  decodePrototypeAccount,
  type PrototypeAccountLedger,
} from '../src/accountState.js';

const prototypeLedgerOf = (build: unknown): ((data: unknown) => PrototypeAccountLedger) =>
  (build as { ledger: (data: unknown) => PrototypeAccountLedger }).ledger;

/* LITERAL relative specifiers, for the reason `src/account.ts` gives at its own
   imports: `contracts-stagenet` carries its own `node_modules`, so a computed
   absolute path into that tree resolves a SECOND compact-runtime and decoding a
   state dies on `expected instance of ChargedState`. */
import * as prototypeBuild from '../contracts-stagenet/managed/account/contract/index.js';
import * as custodyBuild from '../contracts-stagenet/managed/account-custody/contract/index.js';

/* Resolved from this file rather than from the working directory: the tests are
   bundled to `dist/test/` and run from the package root. */
const fixtures = join(import.meta.dirname, '..', '..', 'test', 'fixtures');

/** One saved indexer answer, back to the `ContractState` the sponsor reads. */
function stateFrom(file: string): ContractState {
  const served = JSON.parse(readFileSync(join(fixtures, file), 'utf8')) as {
    data: { contract: { state: string } };
  };
  const hex = served.data.contract.state;
  return ContractState.deserialize(
    Uint8Array.from((hex.match(/.{2}/g) ?? []).map((byte) => parseInt(byte, 16))),
  );
}

export const CUSTODY_JUBJUB_ADDRESS =
  '9448e16665d0aa3ef103ff2eff5ca50694d44318d8a9c66998b8d57927755c11';
export const CUSTODY_K256_ADDRESS =
  '0ffd70ad38ce81e8378c8269ef1b127d5f90a77dba4f7618bf48eeb836ad2746';
export const PROTOTYPE_ADDRESS =
  '0f2ddd277102e73380dd6751e839fbfc0d017bbef89c01bc7dc70f03c6e30f93';
export const FAUCET_ADDRESS =
  '4fc92e152e8d854ef9337275504244e18bd6e3d7d41fd81ed2dabf62be78e92f';

const custodyJubjub = stateFrom('account-state-custody-jubjub.json');
const custodyK256 = stateFrom('account-state-custody-k256.json');
const prototype = stateFrom('account-state-prototype.json');
const notAnAccount = stateFrom('contract-state-not-an-account.json');

const namesIn = (state: ContractState): string[] => state.operations().map(String);

/**
 * The pre-flight's own decode, run the way the pre-flight runs it.
 *
 * NOT A COPY OF THE FINGERPRINT. `decodePrototypeAccount` is the function
 * `/fund-account` reached through `readAccount`, and it is imported rather than
 * re-implemented here for the reason this whole file exists: a test that
 * restates the rule agrees with itself when the rule is wrong.
 */
function prototypeFingerprint(state: ContractState, address: string): 'decoded' | 'refused' {
  try {
    decodePrototypeAccount(
      prototypeLedgerOf(prototypeBuild),
      state,
      address,
      /* The module the OLD code passed, because it never asked: everything was
         decoded as a prototype. */
      'account',
      new Uint8Array(32),
    );
    return 'decoded';
  } catch (cause) {
    assert.ok(cause instanceof AccountStateRefusal);
    assert.equal(cause.code, 'not-an-account');
    return 'refused';
  }
}

describe('the funding refusal a real passkey Passport met on 2026/09/18', () => {
  it('is the prototype decode throwing on a state that IS an account custody account', () => {
    /* Both arms, because the refusal is about the BUILD and not about which
       key deployed it: the k256-born account has been spending for a fortnight
       and is refused by the same line as the passkey account made that hour. */
    assert.equal(prototypeFingerprint(custodyJubjub, CUSTODY_JUBJUB_ADDRESS), 'refused');
    assert.equal(prototypeFingerprint(custodyK256, CUSTODY_K256_ADDRESS), 'refused');
  });

  it('is not what the prototype account it was written for gets, which is the point', () => {
    assert.equal(prototypeFingerprint(prototype, PROTOTYPE_ADDRESS), 'decoded');
  });

  it('happens although the state says plainly what it is', () => {
    /* Thirty entry points, `deposit_unshielded`, `booted`, a device, and a
       32-byte `enc_key`. Nothing about this account is ambiguous; the
       pre-flight was asking the wrong build. */
    const ledger = (custodyBuild as unknown as { ledger: (data: unknown) => {
      booted: boolean;
      device_count: bigint;
      enc_key: Uint8Array;
      inbox_count: bigint;
      unshielded_balances: { member(colour: Uint8Array): boolean };
    } }).ledger(custodyJubjub.data);
    assert.equal(namesIn(custodyJubjub).length, 30);
    assert.ok(namesIn(custodyJubjub).includes('deposit_unshielded'));
    assert.equal(ledger.booted, true);
    assert.equal(ledger.device_count, 1n);
    assert.equal(ledger.enc_key.length, 32);
    assert.equal(ledger.inbox_count, 0n);
    assert.equal(ledger.unshielded_balances.member(new Uint8Array(32)), false);
  });
});

describe('which build a real served state is', () => {
  it('is the account custody build for both arms', () => {
    assert.equal(accountModuleForState(custodyJubjub), 'account-custody');
    assert.equal(accountModuleForState(custodyK256), 'account-custody');
  });

  it('is the twelve-circuit prototype for the prototype', () => {
    assert.equal(namesIn(prototype).length, 12);
    assert.equal(accountModuleForState(prototype), 'account');
  });

  it('is the account custody build for an account that has only landed wave 1', () => {
    /* THE SECOND DEFECT, and the one no on-chain state can show today because
       both accounts above finished all four waves. A jubjub-born account lands
       the deposits and the eight jubjub device circuits in wave 1; the k256
       circuits arrive in wave 3. Between those two blocks — a minute and a
       half of somebody's onboarding — `withdraw_shielded_with_k256` is absent,
       and a discriminator keyed on it answers "not the custody build" about a
       custody account, which sends it to `account-v1`: twelve circuits it does
       not have and verifier keys nothing like its own.

       The operation list is the real account's, with the later waves removed —
       which is what that account's own state looked like at wave 1. */
    const waveOne = namesIn(custodyJubjub).filter((name) => !name.endsWith('_with_k256'));
    assert.ok(waveOne.includes('deposit_unshielded'));
    assert.ok(!waveOne.includes('withdraw_shielded_with_k256'));
    assert.equal(accountModuleForState({ operations: () => waveOne }), 'account-custody');
  });
});

/* -------------------------------------------------------------------------- */
/* The fix: the pre-flight reading through the account's own build             */
/* -------------------------------------------------------------------------- */

import { accountBalancesFrom, accountViewFor, accountViewFrom, type CustodyAccountLedger } from '../src/accountState.js';

const NATIVE_COLOUR = new Uint8Array(32);
/* The colour the prototype fixture really holds 40 of, read off its own
   `coins` map. Written down so a decode that started answering about some
   other colour would fail here rather than at a partner's gift. */
const PROTOTYPE_COIN_COLOUR = Uint8Array.from(
  Buffer.from('1a2917fbed8b5ce44d12ebc7d337689045f6c96a6bbd39cf3d8691ab310ef6a6', 'hex'),
);

const prototypeLedger = (prototypeBuild as unknown as {
  ledger: (data: unknown) => PrototypeAccountLedger;
}).ledger;
const custodyLedger = (custodyBuild as unknown as {
  ledger: (data: unknown) => CustodyAccountLedger;
}).ledger;

/** The refusal a read threw, because `assert.throws` does not hand it back. */
function refusalFrom(read: () => unknown): AccountStateRefusal {
  try {
    read();
  } catch (cause) {
    assert.ok(cause instanceof AccountStateRefusal, `expected a refusal, got ${String(cause)}`);
    return cause;
  }
  throw new assert.AssertionError({ message: 'the read was expected to refuse and did not' });
}

const viewOf = (state: ContractState, address: string) =>
  accountViewFrom<PrototypeAccountLedger, CustodyAccountLedger>({
    state,
    address,
    module: accountModuleForState(state),
    nativeColour: NATIVE_COLOUR,
    prototypeLedger,
    custodyLedger,
  });

describe('the pre-flight, reading each account with the build it actually is', () => {
  it('opens the passkey Passport the sponsor refused', () => {
    const view = viewOf(custodyJubjub, CUSTODY_JUBJUB_ADDRESS);
    assert.equal(view.module, 'account-custody');
    /* Nothing has been deposited yet — this is the account whose funding was
       refused — so the mirror reads zero, which is a READING and is what makes
       the NIGHT leg owed rather than already paid. */
    assert.equal(view.unshielded(NATIVE_COLOUR), 0n);
    /* Stateless shielded custody: null is "cannot be asked", never zero. */
    assert.equal(view.shielded(NATIVE_COLOUR), null);
    assert.equal(view.encKey()?.length, 32);
    assert.equal(view.inboxCount(), 0n);
    assert.equal(view.inboxEntry(0n), null);
  });

  it('opens the Dynamic-born account that has been spending, and walks its inbox', () => {
    const view = viewOf(custodyK256, CUSTODY_K256_ADDRESS);
    assert.equal(view.module, 'account-custody');
    assert.equal(view.inboxCount(), 4n);
    for (let index = 0n; index < 4n; index += 1n) {
      /* 192 bytes, the InboxEntry v1 container — the only public trace a
         shielded deposit into a custody account leaves, and what a
         confirmation is built out of. */
      assert.equal(view.inboxEntry(index)?.length, 192);
    }
    /* Out of range, either way, is a null rather than a throw: a confirmation
       that cannot read a slot falls back, it does not fail an activation. */
    assert.equal(view.inboxEntry(4n), null);
    assert.equal(view.inboxEntry(-1n), null);
  });

  it('leaves the prototype account answering exactly what it answered before', () => {
    /* THE SNAPSHOT. Every number here is what `/fund-account` read off this
       account before any of this changed: 2,000 NIGHT mirrored, one coin of 40
       in `coins`, and no inbox and no encryption key because this build has
       neither. */
    const view = viewOf(prototype, PROTOTYPE_ADDRESS);
    assert.equal(view.module, 'account');
    assert.equal(view.unshielded(NATIVE_COLOUR), 2000n);
    assert.equal(view.shielded(PROTOTYPE_COIN_COLOUR), 40n);
    assert.equal(view.shielded(NATIVE_COLOUR), 0n);
    assert.equal(view.encKey(), null);
    assert.equal(view.inboxCount(), null);
    assert.equal(view.inboxEntry(0n), null);
  });

  it('refuses an unbooted account plainly, and not as a contract that is not a Passport', () => {
    /* A Passport between its deploy and its activation is REAL. The
       constructor leaves `booted = false` and `device_count = 0`, and
       `activate_initial_device_with_<arm>` sets both; a deposit made in
       between lands in a contract with no device that could ever move it out
       again. So it is refused — under its own code, with its own sentence. */
    const unbooted = { ...custodyLedger(custodyJubjub.data), booted: false, device_count: 0n };
    const refusal = refusalFrom(() =>
      accountViewFrom<PrototypeAccountLedger, CustodyAccountLedger>({
        state: custodyJubjub,
        address: CUSTODY_JUBJUB_ADDRESS,
        module: 'account-custody',
        nativeColour: NATIVE_COLOUR,
        prototypeLedger,
        custodyLedger: () => unbooted,
      }),
    );
    assert.equal(refusal.code, 'account-not-activated');
    assert.match(refusal.message, /not finished/);
    assert.doesNotMatch(refusal.message, /is not a Passport/);
  });

  it('still refuses a contract that is not an account at all', () => {
    /* THE GATE THIS WHOLE FINGERPRINT EXISTS FOR, asked of a real contract that
       really is not an account: the mUSD faucet this sponsor mints from, one
       entry point and a ledger shaped nothing like an account's. Compact
       decodes positionally, so a foreign contract can look plausible; the
       balancer will not pay coins into one.

       Nothing is mocked into throwing here. The build's own `ledger` is handed
       the faucet's own state, and what it does with it is the answer. */
    assert.deepEqual(namesIn(notAnAccount), ['mint_shielded']);
    const refusal = refusalFrom(() => viewOf(notAnAccount, FAUCET_ADDRESS));
    assert.equal(refusal.code, 'not-an-account');
    /* The sentence, exactly as it has always read. It is what a caller is shown
       and what the onboarding run quoted off the deployed sponsor, so it is
       asserted in full rather than matched loosely. */
    assert.equal(
      refusal.message,
      `The contract at ${FAUCET_ADDRESS} is not a Passport account-custody contract — its state does not decode as one — so the balancer will not deposit into it.`,
    );
  });

  it('says which reader was wrong when a custody account reaches the prototype one', () => {
    /* The sentence a Passport was given on 2026/09/18, corrected. It is not
       "this is not a Passport"; it is "this reader is the wrong one", which is
       the difference between an operator looking for a broken account and an
       operator looking for a pre-flight that asked the wrong build. */
    const refusal = refusalFrom(() =>
      accountViewFrom<PrototypeAccountLedger, CustodyAccountLedger>({
        state: custodyJubjub,
        address: CUSTODY_JUBJUB_ADDRESS,
        /* The module the OLD marker chose for a wave-1 jubjub account. */
        module: 'account-custody',
        nativeColour: NATIVE_COLOUR,
        prototypeLedger,
        custodyLedger: undefined,
      }),
    );
    assert.equal(refusal.code, 'not-an-account');
    assert.match(refusal.message, /account custody/);
  });
});

/* -------------------------------------------------------------------------- */
/* The pre-flight as `/fund-account` runs it                                  */
/* -------------------------------------------------------------------------- */

/**
 * `funder.balances()` is `readState` → {@link accountViewFor} →
 * {@link accountBalancesFrom}, and the defect was in none of the decoding: it
 * was the step ABOVE it, which reached for the prototype reader whatever the
 * account was. So these cases drive the two functions that step is now made of,
 * with a reader that serves the real states, rather than only the decode
 * underneath them.
 */
const ASSET_COLOUR = PROTOTYPE_COIN_COLOUR;

const balancesOf = async (state: ContractState, address: string) =>
  accountBalancesFrom(
    await accountViewFor<PrototypeAccountLedger, CustodyAccountLedger>({
      address,
      state,
      nativeColour: NATIVE_COLOUR,
      prototypeLedger,
      custodyLedgerFor: () => Promise.resolve(custodyLedger),
    }),
    NATIVE_COLOUR,
    ASSET_COLOUR,
  );

describe('what /fund-account reads before it spends', () => {
  it('answers for the passkey Passport it used to refuse', async () => {
    const held = await balancesOf(custodyJubjub, CUSTODY_JUBJUB_ADDRESS);
    /* Nothing deposited yet: the NIGHT leg is owed, and that is a READING. */
    assert.equal(held.night, 0n);
    /* Null, not zero. Custody there is stateless, so no shielded holding is
       public, and `./activationLegs.ts` falls back to this service's own
       record — which is why `onDepositSubmitted` exists. */
    assert.equal(held.asset, null);
  });

  it('answers for the Dynamic-born account on the same path', async () => {
    const held = await balancesOf(custodyK256, CUSTODY_K256_ADDRESS);
    assert.equal(held.asset, null);
    assert.equal(typeof held.night, 'bigint');
  });

  it('leaves the prototype account answering exactly the two numbers it did', async () => {
    /* THE SNAPSHOT, through the pre-flight rather than through the decode: 2,000
       NIGHT mirrored and 40 of the asset colour in `coins`. */
    assert.deepEqual(await balancesOf(prototype, PROTOTYPE_ADDRESS), {
      night: 2000n,
      asset: 40n,
    });
  });

  it('refuses a contract that is not an account, before either leg', async () => {
    await assert.rejects(
      () => balancesOf(notAnAccount, FAUCET_ADDRESS),
      (cause: unknown) =>
        cause instanceof AccountStateRefusal && cause.code === 'not-an-account',
    );
  });

  it('lets the load of a build this host has not got travel, rather than swallowing it', async () => {
    /* The one thing `accountViewFor` deliberately does not catch. A host that
       cannot load the account-custody build has said NOTHING about this
       account, and turning that into `not-an-account` would tell a caller its
       Passport is not a Passport — see `accountReadStatus`, which answers 503
       for it. */
    await assert.rejects(
      () =>
        accountViewFor<PrototypeAccountLedger, CustodyAccountLedger>({
          address: CUSTODY_JUBJUB_ADDRESS,
          state: custodyJubjub,
          nativeColour: NATIVE_COLOUR,
          prototypeLedger,
          custodyLedgerFor: () =>
            Promise.reject(
              Object.assign(new Error('the compiled account-custody build is not readable'), {
                code: 'prover-unavailable',
              }),
            ),
        }),
      (cause: unknown) =>
        !(cause instanceof AccountStateRefusal) &&
        (cause as { code?: string }).code === 'prover-unavailable',
    );
  });

  it('reports no asset at all where this service has no colour configured', async () => {
    /* `0n`, not null: it is the answer the prototype path gave before any of
       this, and a null here would read as "a custody account" to every caller. */
    const view = await accountViewFor<PrototypeAccountLedger, CustodyAccountLedger>({
      address: PROTOTYPE_ADDRESS,
      state: prototype,
      nativeColour: NATIVE_COLOUR,
      prototypeLedger,
      custodyLedgerFor: () => Promise.resolve(custodyLedger),
    });
    assert.equal(accountBalancesFrom(view, NATIVE_COLOUR, null).asset, 0n);
  });
});

/* -------------------------------------------------------------------------- */
/* What a refusal is a fact ABOUT                                             */
/* -------------------------------------------------------------------------- */

import { accountReadStatus } from '../src/account.js';

describe('the status a read refusal answers with', () => {
  it('is a 400 for the two things that are facts about the account', () => {
    /* Send that address again and it will be refused again. */
    assert.equal(accountReadStatus('not-an-account'), 400);
    assert.equal(accountReadStatus('account-not-activated'), 400);
  });

  it('is a 503 when this service could not answer, including a build it has not got', () => {
    assert.equal(accountReadStatus('indexer-unreachable'), 503);
    /* THE AMBER. `prover-unavailable` is thrown by the read path when the
       compiled account-custody build cannot be loaded on this host — not
       staged, or a half-finished rsync. A 400 told a perfectly good Passport
       that it was not one, in the single case where the truth is that an
       operator has not finished staging a build. */
    assert.equal(accountReadStatus('prover-unavailable'), 503);
  });

  it('leaves every other code answering exactly what it answered before', () => {
    for (const code of [
      'deposit-failed',
      'confirmation-failed',
      'asset-unsupported',
      'mint-failed',
      'mint-not-visible',
      'asset-deposit-failed',
      'asset-confirmation-failed',
    ] as const) {
      assert.equal(accountReadStatus(code), 400);
    }
  });
});
