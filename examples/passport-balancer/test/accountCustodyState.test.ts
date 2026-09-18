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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ContractState } from '@midnight-ntwrk/compact-runtime';

import { accountModuleForState } from '../src/accountModule.js';

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

const custodyJubjub = stateFrom('account-state-custody-jubjub.json');
const custodyK256 = stateFrom('account-state-custody-k256.json');
const prototype = stateFrom('account-state-prototype.json');

const namesIn = (state: ContractState): string[] => state.operations().map(String);

/** The prototype decode and fingerprint, exactly as the pre-flight ran it. */
function prototypeFingerprint(state: ContractState): 'decoded' | 'refused' {
  try {
    const candidate = (prototypeBuild as unknown as { ledger: (data: unknown) => {
      device_count: bigint;
      recovery_shares: { size(): bigint };
      night_balances: { member(colour: Uint8Array): boolean };
    } }).ledger(state.data);
    if (candidate.device_count >= 1n && candidate.recovery_shares.size() === 3n) {
      candidate.night_balances.member(new Uint8Array(32));
      return 'decoded';
    }
  } catch {
    return 'refused';
  }
  return 'refused';
}

describe('the funding refusal a real passkey Passport met on 2026/09/18', () => {
  it('is the prototype decode throwing on a state that IS an account custody account', () => {
    /* Both arms, because the refusal is about the BUILD and not about which
       key deployed it: the k256-born account has been spending for a fortnight
       and is refused by the same line as the passkey account made that hour. */
    assert.equal(prototypeFingerprint(custodyJubjub), 'refused');
    assert.equal(prototypeFingerprint(custodyK256), 'refused');
  });

  it('is not what the prototype account it was written for gets, which is the point', () => {
    assert.equal(prototypeFingerprint(prototype), 'decoded');
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
