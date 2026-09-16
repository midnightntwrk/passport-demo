import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { accountModuleFor } from '../src/accountModule.js';

describe('the account module a deployed account is spoken to with', () => {
  it('is the older build for an account that does not carry the one-transaction circuit', () => {
    assert.equal(accountModuleFor(false), 'account-v1');
  });
  it('is the current build for one that does', () => {
    assert.equal(accountModuleFor(true), 'account');
  });
  it('is the current build when the chain could not be asked, and the retry ladder asks again', () => {
    assert.equal(accountModuleFor(null), 'account');
  });
});

import { carriesOneTxTransferIn } from '../src/accountModule.js';

describe('reading the answer off a served contract state', () => {
  it('is true when the operations name the circuit, whichever encoding they arrive in', () => {
    assert.equal(carriesOneTxTransferIn({ operations: () => ['deposit_shielded', 'transfer_shielded_to_account'] }), true);
    assert.equal(carriesOneTxTransferIn({ operations: () => [new TextEncoder().encode('transfer_shielded_to_account')] }), true);
  });
  it('is false for the eleven-circuit build', () => {
    assert.equal(carriesOneTxTransferIn({ operations: () => ['deposit_shielded', 'withdraw_shielded'] }), false);
  });
  it('is null when there is no state, or no operations to read', () => {
    assert.equal(carriesOneTxTransferIn(null), null);
    assert.equal(carriesOneTxTransferIn({}), null);
    assert.equal(carriesOneTxTransferIn({ operations: () => { throw new Error('gone'); } }), null);
  });
});

/* -------------------------------------------------------------------------- */
/* The third build                                                            */
/* -------------------------------------------------------------------------- */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DROPLET_V3_PROVER_URL,
  INBOX_ENTRY_BYTES,
  InboxEntryRequired,
  K256_WITHDRAWAL_OPERATION_NAME,
  ONE_TX_TRANSFER_OPERATION_NAME,
  accountDeposits,
  accountModuleForState,
  carriesK256WithdrawalIn,
  proverForModule,
  type AccountModuleName,
} from '../src/accountModule.js';

/* Resolved from this file rather than from the working directory: the tests are
   bundled to `dist/test/` and run from the package root. */
const packageRoot = join(import.meta.dirname, '..', '..');

interface CompiledCircuit {
  name: string;
  arguments: { name: string; type: { 'type-name': string; length?: number } }[];
}

/**
 * The circuit list of a STAGED BUILD, out of the compiler's own
 * `contract-info.json`.
 *
 * The point of reading it rather than writing the names down is that these
 * tests then fail when a rebuild changes what the balancer will actually be
 * handed, instead of agreeing with a copy of the old answer. `account-v1` has
 * no `contract-info.json` of its own — it is the same source compiled before
 * one circuit was added — so it is derived from `account` by removing that
 * circuit, which is exactly what the two builds differ by.
 */
function circuitsOf(build: string): CompiledCircuit[] {
  const info = JSON.parse(
    readFileSync(
      join(packageRoot, 'contracts-stagenet', 'managed', build, 'compiler', 'contract-info.json'),
      'utf8',
    ),
  ) as { circuits: CompiledCircuit[] };
  return info.circuits;
}

const namesOf = (build: string) => circuitsOf(build).map((circuit) => circuit.name);
const stateOf = (names: string[]) => ({ operations: () => names });

const accountNames = namesOf('account');
const accountV1Names = accountNames.filter((name) => name !== ONE_TX_TRANSFER_OPERATION_NAME);
const accountK1Names = namesOf('account-k1');

describe('telling the k1-arm reference build apart from the two prototypes', () => {
  it('finds the discriminating circuit in the k1 build and in neither prototype', () => {
    assert.ok(accountK1Names.includes(K256_WITHDRAWAL_OPERATION_NAME));
    assert.ok(!accountNames.includes(K256_WITHDRAWAL_OPERATION_NAME));
    assert.ok(!accountV1Names.includes(K256_WITHDRAWAL_OPERATION_NAME));
  });

  it('reads it off a served state, in either encoding, and says null when it cannot', () => {
    assert.equal(carriesK256WithdrawalIn(stateOf(accountK1Names)), true);
    assert.equal(carriesK256WithdrawalIn(stateOf(accountNames)), false);
    assert.equal(
      carriesK256WithdrawalIn({
        operations: () => [new TextEncoder().encode(K256_WITHDRAWAL_OPERATION_NAME)],
      }),
      true,
    );
    assert.equal(carriesK256WithdrawalIn(null), null);
    assert.equal(carriesK256WithdrawalIn({}), null);
  });

  it('picks each of the three modules from that build own circuit set', () => {
    assert.equal(accountModuleForState(stateOf(accountNames)), 'account');
    assert.equal(accountModuleForState(stateOf(accountV1Names)), 'account-v1');
    assert.equal(accountModuleForState(stateOf(accountK1Names)), 'account-k1');
  });

  it('does not mistake a k1 account for the eleven-circuit build', () => {
    /* The trap this exists for: a k1 account has no `transfer_shielded_to_account`
       either, so the older question answers `false` for it and would open it with
       `account-v1` — twelve circuits it does not have and verifier keys nothing
       like its own. The k1 question is therefore asked first. */
    assert.equal(accountK1Names.includes(ONE_TX_TRANSFER_OPERATION_NAME), false);
    assert.equal(accountModuleFor(false, true), 'account-k1');
    assert.equal(accountModuleFor(null, true), 'account-k1');
  });

  it('leaves the two-build question exactly as it was when nothing is known about the k1 arm', () => {
    assert.equal(accountModuleFor(false, null), 'account-v1');
    assert.equal(accountModuleFor(true, null), 'account');
    assert.equal(accountModuleFor(null, false), 'account');
    assert.equal(accountModuleFor(false, false), 'account-v1');
  });
});

describe('the deposit circuits a sponsor calls on each build', () => {
  const colour = new Uint8Array(32).fill(7);
  const coin = { nonce: new Uint8Array(32), color: colour, value: 100n };

  it('names an unshielded deposit circuit that the build actually declares', () => {
    for (const [module, build] of [
      ['account', 'account'],
      ['account-k1', 'account-k1'],
    ] as [AccountModuleName, string][]) {
      const declared = circuitsOf(build).find(
        (circuit) => circuit.name === accountDeposits(module).unshieldedCircuit,
      );
      assert.ok(declared, `${module} declares ${accountDeposits(module).unshieldedCircuit}`);
      /* Same arguments in the same order on both, which is why one name lookup
         is the whole of the difference: `(Bytes<32>, Uint<128>)`. */
      assert.deepEqual(
        declared.arguments.map((argument) => argument.type['type-name']),
        ['Bytes', 'Uint'],
      );
      assert.equal(declared.arguments[0]?.type.length, 32);
      assert.deepEqual(accountDeposits(module).unshieldedArgs(colour, 1_000n), [colour, 1_000n]);
    }
  });

  it('calls it deposit_night on the prototypes and deposit_unshielded on the reference contract', () => {
    assert.equal(accountDeposits('account').unshieldedCircuit, 'deposit_night');
    assert.equal(accountDeposits('account-v1').unshieldedCircuit, 'deposit_night');
    assert.equal(accountDeposits('account-k1').unshieldedCircuit, 'deposit_unshielded');
  });

  it('passes the coin alone to a prototype deposit_shielded, as that build declares it', () => {
    const declared = circuitsOf('account').find((circuit) => circuit.name === 'deposit_shielded');
    assert.equal(declared?.arguments.length, 1);
    assert.deepEqual(accountDeposits('account').shieldedArgs(coin), [coin]);
    assert.deepEqual(accountDeposits('account-v1').shieldedArgs(coin), [coin]);
  });

  it('pairs the coin with a 192-byte inbox entry on the reference contract', () => {
    const declared = circuitsOf('account-k1').find(
      (circuit) => circuit.name === 'deposit_shielded',
    );
    assert.equal(declared?.arguments.length, 2);
    assert.equal(declared?.arguments[1]?.type['type-name'], 'Bytes');
    assert.equal(declared?.arguments[1]?.type.length, INBOX_ENTRY_BYTES);
    const entry = new Uint8Array(INBOX_ENTRY_BYTES).fill(3);
    assert.deepEqual(accountDeposits('account-k1').shieldedArgs(coin, entry), [coin, entry]);
  });

  it('refuses to deposit shielded value into a k1 account without one, rather than inventing it', () => {
    /* A placeholder entry would still LAND, and the coin would be gone: the
       owner's `held_coin` witness walks the inbox and would never find it. */
    const k1 = accountDeposits('account-k1');
    assert.throws(() => k1.shieldedArgs(coin), InboxEntryRequired);
    assert.throws(() => k1.shieldedArgs(coin, null), InboxEntryRequired);
    assert.throws(() => k1.shieldedArgs(coin, new Uint8Array(191)), InboxEntryRequired);
    assert.throws(() => k1.shieldedArgs(coin, new Uint8Array(193)), InboxEntryRequired);
  });

  it('knows that only the prototypes mirror a shielded balance into readable state', () => {
    /* Which is why a k1 shielded deposit could not be confirmed even if it
       could be built: MIP-0012 §6.1 keeps no coin description in public state. */
    assert.equal(accountDeposits('account').mirrorsShieldedBalance, true);
    assert.equal(accountDeposits('account-v1').mirrorsShieldedBalance, true);
    assert.equal(accountDeposits('account-k1').mirrorsShieldedBalance, false);
    const k1Ledger = JSON.parse(
      readFileSync(
        join(
          packageRoot,
          'contracts-stagenet',
          'managed',
          'account-k1',
          'compiler',
          'contract-info.json',
        ),
        'utf8',
      ),
    ) as { ledger: { name: string }[] };
    assert.ok(!k1Ledger.ledger.some((field) => field.name === 'coins'));
    assert.ok(k1Ledger.ledger.some((field) => field.name === 'unshielded_balances'));
  });
});

describe('which proof server proves which build', () => {
  const v2 = 'https://67-205-177-162.sslip.io/prover';
  const v3 = 'https://67-205-177-162.sslip.io/prover-v3';

  it('leaves the two prototype builds on exactly the route they have today', () => {
    for (const module of ['account', 'account-v1'] as AccountModuleName[]) {
      assert.deepEqual(proverForModule(module, { provingServerUrl: v2 }), {
        kind: 'server',
        url: v2,
        why: `${module} is ZKIR v2 and proves at BALANCER_PROVER_URL`,
      });
      assert.equal(proverForModule(module, {}).kind, 'wasm');
      /* And a v3 server does not pull them off it. */
      assert.equal(
        proverForModule(module, { provingServerUrl: v2, provingServerUrlV3: v3 }).kind,
        'server',
      );
      const chosen = proverForModule(module, { provingServerUrl: v2, provingServerUrlV3: v3 });
      assert.equal(chosen.kind === 'server' && chosen.url, v2);
    }
  });

  it('sends the k1 build to the v3 server and nowhere else', () => {
    const chosen = proverForModule('account-k1', { provingServerUrl: v2, provingServerUrlV3: v3 });
    assert.equal(chosen.kind, 'server');
    assert.equal(chosen.kind === 'server' && chosen.url, v3);
  });

  it('refuses when no v3 server is named, rather than falling back to one that cannot answer', () => {
    /* BALANCER_PROVER_URL on the droplet is the 1AM gateway route, which is
       ledger9-zkir2-dispatch; the in-process prover is zkir-v2. Either would
       take the job and fail it several seconds later. */
    for (const config of [{}, { provingServerUrl: v2 }]) {
      const chosen = proverForModule('account-k1', config);
      assert.equal(chosen.kind, 'refused');
      assert.match(chosen.why, /BALANCER_PROVER_URL_V3/);
      assert.ok(chosen.why.includes(DROPLET_V3_PROVER_URL));
    }
  });
});
