/**
 * `POST /register-alias` accepting an account custody address, pinned.
 *
 * This one is a test for something that ALREADY WORKS, which is the point. The
 * plan for the custody arm assumed the name-registration gate would need
 * teaching about the new build; reading it showed it would not, because it asks
 * `midnames.contractExists(contractAddress)` — "is anything deployed there" —
 * and decodes nothing. The live run of 2026/09/18 bore that out: the passkey
 * Passport `9448e166…` was named `jjmu762ou7yywl.night` on stagenet while the
 * same sponsor was refusing to fund it.
 *
 * So the value of this file is entirely in what it would catch. Somebody
 * tightening the gate — adding a decode so a name cannot be bound to a contract
 * that is not a Passport — would silently stop every custody Passport getting a
 * name, and the failure would look like a registry problem rather than a gate
 * that learned to refuse the newest build. The fixtures are the same three real
 * stagenet states `accountCustodyState.test.ts` uses.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ContractState } from '@midnight-ntwrk/compact-runtime';

import { contractDeployedAt } from '../src/midnames.js';
import { accountModuleForState } from '../src/accountModule.js';

const fixtures = join(import.meta.dirname, '..', '..', 'test', 'fixtures');

function stateFrom(file: string): ContractState {
  const served = JSON.parse(readFileSync(join(fixtures, file), 'utf8')) as {
    data: { contract: { state: string } };
  };
  return ContractState.deserialize(
    Uint8Array.from(
      (served.data.contract.state.match(/.{2}/g) ?? []).map((byte) => parseInt(byte, 16)),
    ),
  );
}

const custodyJubjub = stateFrom('account-state-custody-jubjub.json');
const custodyK256 = stateFrom('account-state-custody-k256.json');
const prototype = stateFrom('account-state-prototype.json');

describe('the .night target gate', () => {
  it('accepts an account custody contract, on either arm', () => {
    assert.equal(accountModuleForState(custodyJubjub), 'account-custody');
    assert.equal(accountModuleForState(custodyK256), 'account-custody');
    assert.equal(contractDeployedAt(custodyJubjub), true);
    assert.equal(contractDeployedAt(custodyK256), true);
  });

  it('accepts a prototype account exactly as it always did', () => {
    assert.equal(contractDeployedAt(prototype), true);
  });

  it('refuses an address the indexer serves nothing at, which is the whole of what it asks', () => {
    /* `queryContractState` answers null or undefined for an address with
       nothing deployed at it, and that — not a decode — is the refusal behind
       `400 target-missing`. */
    assert.equal(contractDeployedAt(null), false);
    assert.equal(contractDeployedAt(undefined), false);
  });

  it('does not look at what kind of contract it is', () => {
    /* The guard. A gate that decoded would need teaching every build that has
       ever existed; this one is handed a state it has never seen and still
       says yes, because "there is something there" is all a name needs. */
    assert.equal(contractDeployedAt({ operations: () => ['mint_shielded'] }), true);
  });
});
