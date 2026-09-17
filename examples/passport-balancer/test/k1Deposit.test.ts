/**
 * The two shielded deposit paths, drilled against a fake reader and a fake
 * prover — the mUSD opening balance and a gift — with no chain, no indexer, and
 * no proof server anywhere near them.
 *
 * What is actually being checked is not that a call happened. It is that the
 * coin the account is asked to take and the description the OWNER will later
 * read are the same coin. A deposit that lands with an entry describing
 * anything else is money that has arrived and that nobody can ever move, and
 * nothing on chain says so at the time.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

import {
  InboxEntryRequired,
  accountEncKey,
  accountDeposits,
  sealedShieldedArgs,
  shieldedDepositConfirmed,
  type ShieldedCoin,
} from '../src/accountModule.js';
import { generateEncKeyPair, openInboxEntry, INBOX_ENTRY_SIZE } from '../src/k1Inbox.js';

const unhex = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'hex'));
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const COIN: ShieldedCoin = {
  nonce: unhex('7f'.repeat(32)),
  color: unhex('1a'.repeat(32)),
  value: 5_000_000n,
};

/* -------------------------------------------------------------------------- */
/* Reading the key off the account's own state                                */
/* -------------------------------------------------------------------------- */

test('the advertised key is read off decoded state', () => {
  const key = generateEncKeyPair().publicKey;
  assert.equal(hex(accountEncKey({ enc_key: key })!), hex(key));
});

test('anything that is not a 32-byte key reads as no key at all', () => {
  assert.equal(accountEncKey({ enc_key: new Uint8Array(31) }), null);
  assert.equal(accountEncKey({ enc_key: new Uint8Array(33) }), null);
  assert.equal(accountEncKey({ enc_key: 'ab'.repeat(32) }), null);
  assert.equal(accountEncKey({}), null);
  assert.equal(accountEncKey(null), null);
  assert.equal(accountEncKey(undefined), null);
  /* The prototype builds have no such cell, and must not be given a default. */
  assert.equal(accountEncKey({ night_balances: {}, coins: {} }), null);
});

/* -------------------------------------------------------------------------- */
/* The deposit itself                                                         */
/* -------------------------------------------------------------------------- */

/** The smallest thing that behaves like a `callTx` entry point. */
function fakeProver(): {
  calls: { circuit: string; args: readonly unknown[] }[];
  call(circuit: string, args: readonly unknown[]): string;
} {
  const calls: { circuit: string; args: readonly unknown[] }[] = [];
  return {
    calls,
    call(circuit, args) {
      calls.push({ circuit, args });
      return `tx-${calls.length}`;
    },
  };
}

test('a deposit into a k1 account carries an entry its OWNER can read', () => {
  const owner = generateEncKeyPair();
  const prover = fakeProver();
  const deposits = accountDeposits('account-k1');

  const txId = prover.call(
    deposits.shieldedCircuit,
    sealedShieldedArgs('account-k1', COIN, owner.publicKey),
  );

  assert.equal(txId, 'tx-1');
  assert.equal(prover.calls[0].circuit, 'deposit_shielded');
  assert.equal(prover.calls[0].args.length, 2);
  assert.equal(prover.calls[0].args[0], COIN);

  const entry = prover.calls[0].args[1] as Uint8Array;
  assert.equal(entry.length, INBOX_ENTRY_SIZE);

  /* The whole claim: the description the owner opens is the coin that moved. */
  const opened = openInboxEntry(owner.secretKey, entry);
  assert.ok(opened, 'the owner could not open the entry this deposit carried');
  assert.equal(hex(opened.nonce), hex(COIN.nonce));
  assert.equal(hex(opened.color), hex(COIN.color));
  assert.equal(opened.value, COIN.value);
});

test('nobody but the owner can read what was deposited, including the depositor', () => {
  const owner = generateEncKeyPair();
  const args = sealedShieldedArgs('account-k1', COIN, owner.publicKey);
  assert.equal(openInboxEntry(generateEncKeyPair().secretKey, args[1] as Uint8Array), null);
});

test('two deposits of the same coin do not look alike on chain', () => {
  const owner = generateEncKeyPair();
  const first = sealedShieldedArgs('account-k1', COIN, owner.publicKey)[1] as Uint8Array;
  const second = sealedShieldedArgs('account-k1', COIN, owner.publicKey)[1] as Uint8Array;
  assert.notEqual(hex(first), hex(second));
});

test('a k1 account with no readable key is refused before anything is submitted', () => {
  const prover = fakeProver();
  assert.throws(() => sealedShieldedArgs('account-k1', COIN, null), InboxEntryRequired);
  assert.equal(prover.calls.length, 0, 'nothing may be submitted after a refusal');
});

test('the prototype builds take the coin alone, and ignore a key', () => {
  for (const module of ['account', 'account-v1'] as const) {
    assert.deepEqual(sealedShieldedArgs(module, COIN, null), [COIN]);
    assert.deepEqual(sealedShieldedArgs(module, COIN, generateEncKeyPair().publicKey), [COIN]);
  }
});

/* -------------------------------------------------------------------------- */
/* Confirming it                                                              */
/* -------------------------------------------------------------------------- */

test('a prototype deposit is confirmed by the credit appearing', () => {
  assert.equal(shieldedDepositConfirmed('account', 100n, 100n, 50n), false);
  assert.equal(shieldedDepositConfirmed('account', 100n, 149n, 50n), false);
  assert.equal(shieldedDepositConfirmed('account', 100n, 150n, 50n), true);
  assert.equal(shieldedDepositConfirmed('account-v1', 0n, 50n, 50n), true);
});

test('a k1 deposit is confirmed by the inbox growing, because nothing else can be', () => {
  /* There is no readable balance on a k1 account (MIP-0012 §6.1). The inbox
     growing by one is the entire public trace the deposit leaves, and waiting
     on the amount instead would wait for ever. */
  assert.equal(shieldedDepositConfirmed('account-k1', 7n, 7n, 5_000_000n), false);
  assert.equal(shieldedDepositConfirmed('account-k1', 7n, 8n, 5_000_000n), true);
  assert.equal(shieldedDepositConfirmed('account-k1', 0n, 1n, 1n), true);
});
