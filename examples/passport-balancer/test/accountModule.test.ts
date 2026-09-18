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
  CUSTODY_DEPOSIT_OPERATION_NAME,
  LEGACY_WITHDRAWAL_OPERATION_NAME,
  ONE_TX_TRANSFER_OPERATION_NAME,
  accountDeposits,
  accountModuleForState,
  carriesCustodyDepositIn,
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
const accountCustodyNames = namesOf('account-custody');

describe('telling the account custody build apart from the two prototypes', () => {
  it('finds the discriminating circuit in the account custody build and in neither prototype', () => {
    assert.ok(accountCustodyNames.includes(CUSTODY_DEPOSIT_OPERATION_NAME));
    assert.ok(!accountNames.includes(CUSTODY_DEPOSIT_OPERATION_NAME));
    assert.ok(!accountV1Names.includes(CUSTODY_DEPOSIT_OPERATION_NAME));
  });

  it('finds the eleven-circuit build own marker in both prototypes and in neither custody arm', () => {
    /* The other half of asking positively: `withdraw_shielded` is bare on both
       prototypes and arm-suffixed on every custody withdrawal, so the older
       build is recognised by what it HAS. */
    assert.ok(accountNames.includes(LEGACY_WITHDRAWAL_OPERATION_NAME));
    assert.ok(accountV1Names.includes(LEGACY_WITHDRAWAL_OPERATION_NAME));
    assert.ok(!accountCustodyNames.includes(LEGACY_WITHDRAWAL_OPERATION_NAME));
  });

  it('reads it off a served state, in either encoding, and says null when it cannot', () => {
    assert.equal(carriesCustodyDepositIn(stateOf(accountCustodyNames)), true);
    assert.equal(carriesCustodyDepositIn(stateOf(accountNames)), false);
    assert.equal(
      carriesCustodyDepositIn({
        operations: () => [new TextEncoder().encode(CUSTODY_DEPOSIT_OPERATION_NAME)],
      }),
      true,
    );
    assert.equal(carriesCustodyDepositIn(null), null);
    assert.equal(carriesCustodyDepositIn({}), null);
  });

  it('is the custody build from wave 1, before either arm withdrawal has landed', () => {
    /* The regression the marker was changed for. A jubjub-born account carries
       the two deposits and the eight jubjub device circuits in wave 1; every
       k256 circuit arrives two maintenance updates later. Keyed on
       `withdraw_shielded_with_k256`, the sponsor called this `account-v1`. */
    const waveOne = accountCustodyNames.filter((name) => !name.endsWith('_with_k256'));
    assert.ok(waveOne.includes(CUSTODY_DEPOSIT_OPERATION_NAME));
    assert.equal(accountModuleForState(stateOf(waveOne)), 'account-custody');
  });

  it('picks each of the three modules from that build own circuit set', () => {
    assert.equal(accountModuleForState(stateOf(accountNames)), 'account');
    assert.equal(accountModuleForState(stateOf(accountV1Names)), 'account-v1');
    assert.equal(accountModuleForState(stateOf(accountCustodyNames)), 'account-custody');
  });

  it('does not mistake a custody account for the eleven-circuit build', () => {
    /* The trap this exists for: a custody account has no `transfer_shielded_to_account`
       either, so the older question answers `false` for it and would open it with
       `account-v1` — twelve circuits it does not have and verifier keys nothing
       like its own. The custody question is therefore asked first. */
    assert.equal(accountCustodyNames.includes(ONE_TX_TRANSFER_OPERATION_NAME), false);
    assert.equal(accountModuleFor(false, true), 'account-custody');
    assert.equal(accountModuleFor(null, true), 'account-custody');
    /* And not even when the eleven-circuit build own marker is asked for too:
       the custody answer outranks both prototypes. */
    assert.equal(accountModuleFor(false, true, false), 'account-custody');
  });

  it('leaves the two-build question exactly as it was when nothing is known about the account custody build', () => {
    assert.equal(accountModuleFor(false, null), 'account-v1');
    assert.equal(accountModuleFor(true, null), 'account');
    assert.equal(accountModuleFor(null, false), 'account');
    assert.equal(accountModuleFor(false, false), 'account-v1');
    /* And the eleven-circuit build says so itself when it is asked to. */
    assert.equal(accountModuleFor(false, false, true), 'account-v1');
    assert.equal(accountModuleFor(null, false, true), 'account-v1');
  });
});

describe('the deposit circuits a sponsor calls on each build', () => {
  const colour = new Uint8Array(32).fill(7);
  const coin = { nonce: new Uint8Array(32), color: colour, value: 100n };

  it('names an unshielded deposit circuit that the build actually declares', () => {
    for (const [module, build] of [
      ['account', 'account'],
      ['account-custody', 'account-custody'],
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

  it('calls it deposit_night on the prototypes and deposit_unshielded on the account custody contract', () => {
    assert.equal(accountDeposits('account').unshieldedCircuit, 'deposit_night');
    assert.equal(accountDeposits('account-v1').unshieldedCircuit, 'deposit_night');
    assert.equal(accountDeposits('account-custody').unshieldedCircuit, 'deposit_unshielded');
  });

  it('passes the coin alone to a prototype deposit_shielded, as that build declares it', () => {
    const declared = circuitsOf('account').find((circuit) => circuit.name === 'deposit_shielded');
    assert.equal(declared?.arguments.length, 1);
    assert.deepEqual(accountDeposits('account').shieldedArgs(coin), [coin]);
    assert.deepEqual(accountDeposits('account-v1').shieldedArgs(coin), [coin]);
  });

  it('pairs the coin with a 192-byte inbox entry on the account custody contract', () => {
    const declared = circuitsOf('account-custody').find(
      (circuit) => circuit.name === 'deposit_shielded',
    );
    assert.equal(declared?.arguments.length, 2);
    assert.equal(declared?.arguments[1]?.type['type-name'], 'Bytes');
    assert.equal(declared?.arguments[1]?.type.length, INBOX_ENTRY_BYTES);
    const entry = new Uint8Array(INBOX_ENTRY_BYTES).fill(3);
    assert.deepEqual(accountDeposits('account-custody').shieldedArgs(coin, entry), [coin, entry]);
  });

  it('refuses to deposit shielded value into a custody account without one, rather than inventing it', () => {
    /* A placeholder entry would still LAND, and the coin would be gone: the
       owner's `held_coin` witness walks the inbox and would never find it. */
    const custody = accountDeposits('account-custody');
    assert.throws(() => custody.shieldedArgs(coin), InboxEntryRequired);
    assert.throws(() => custody.shieldedArgs(coin, null), InboxEntryRequired);
    assert.throws(() => custody.shieldedArgs(coin, new Uint8Array(191)), InboxEntryRequired);
    assert.throws(() => custody.shieldedArgs(coin, new Uint8Array(193)), InboxEntryRequired);
  });

  it('knows that only the prototypes mirror a shielded balance into readable state', () => {
    /* Which is why a custody shielded deposit could not be confirmed even if it
       could be built: MIP-0012 §6.1 keeps no coin description in public state. */
    assert.equal(accountDeposits('account').mirrorsShieldedBalance, true);
    assert.equal(accountDeposits('account-v1').mirrorsShieldedBalance, true);
    assert.equal(accountDeposits('account-custody').mirrorsShieldedBalance, false);
    const custodyLedger = JSON.parse(
      readFileSync(
        join(
          packageRoot,
          'contracts-stagenet',
          'managed',
          'account-custody',
          'compiler',
          'contract-info.json',
        ),
        'utf8',
      ),
    ) as { ledger: { name: string }[] };
    assert.ok(!custodyLedger.ledger.some((field) => field.name === 'coins'));
    assert.ok(custodyLedger.ledger.some((field) => field.name === 'unshielded_balances'));
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

  it('sends the account custody build to the v3 server and nowhere else', () => {
    const chosen = proverForModule('account-custody', { provingServerUrl: v2, provingServerUrlV3: v3 });
    assert.equal(chosen.kind, 'server');
    assert.equal(chosen.kind === 'server' && chosen.url, v3);
  });

  it('refuses when no v3 server is named, rather than falling back to one that cannot answer', () => {
    /* BALANCER_PROVER_URL on the droplet is the 1AM gateway route, which is
       ledger9-zkir2-dispatch; the in-process prover is zkir-v2. Either would
       take the job and fail it several seconds later. */
    for (const config of [{}, { provingServerUrl: v2 }]) {
      const chosen = proverForModule('account-custody', config);
      assert.equal(chosen.kind, 'refused');
      assert.match(chosen.why, /BALANCER_PROVER_URL_V3/);
      assert.ok(chosen.why.includes(DROPLET_V3_PROVER_URL));
    }
  });
});
