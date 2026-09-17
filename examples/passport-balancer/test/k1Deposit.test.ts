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
  inboxHoldsEntry,
  INBOX_SCAN_MAX,
  sealedShieldedArgs,
  sealedShieldedDeposit,
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

test('a k1 deposit is NOT confirmed by the inbox merely growing', () => {
  /* There is no readable balance on a k1 account (MIP-0012 §6.1), so the inbox
     is the whole of the public trace — but the inbox is the ACCOUNT's. It grows
     for another sponsor's deposit, for the change entry of every send the owner
     makes, and for every append_inbox backfill. Growth alone once counted as a
     confirmation; a Passport doing anything at all would satisfy it while our
     coin sat unspent. */
  assert.equal(shieldedDepositConfirmed('account-k1', 7n, 8n, 5_000_000n), false);
  assert.equal(shieldedDepositConfirmed('account-k1', 0n, 9n, 1n), false);
  /* Not even with evidence, if the inbox never moved: nothing was written. */
  const both = { entryFound: true, included: true };
  assert.equal(shieldedDepositConfirmed('account-k1', 7n, 7n, 5_000_000n, both), false);
});

test('a k1 deposit is confirmed by OUR entry, or failing that by OUR transaction', () => {
  const grew = (evidence: { entryFound: boolean; included: boolean }): boolean =>
    shieldedDepositConfirmed('account-k1', 7n, 8n, 5_000_000n, evidence);
  assert.equal(grew({ entryFound: true, included: false }), true);
  assert.equal(grew({ entryFound: false, included: true }), true);
  assert.equal(grew({ entryFound: false, included: false }), false);
});

test('the prototype builds are unchanged by any of it', () => {
  assert.equal(shieldedDepositConfirmed('account', 100n, 149n, 50n), false);
  assert.equal(shieldedDepositConfirmed('account', 100n, 150n, 50n), true);
  /* Evidence is a k1 notion; a mirrored build reads the credit and ignores it. */
  const none = { entryFound: false, included: false };
  assert.equal(shieldedDepositConfirmed('account', 100n, 150n, 50n, none), true);
});

/* -------------------------------------------------------------------------- */
/* Finding our own entry in somebody else's inbox                             */
/* -------------------------------------------------------------------------- */

/** An inbox as a map, and a reader over it that answers null off the end. */
function inbox(entries: Array<Uint8Array | null>): (index: bigint) => Uint8Array | null {
  return (index) => entries[Number(index)] ?? null;
}

test('the entry a deposit sealed is the entry it hands the circuit', () => {
  const owner = generateEncKeyPair();
  const sealed = sealedShieldedDeposit('account-k1', COIN, owner.publicKey);
  assert.ok(sealed.entry, 'a k1 deposit must keep the bytes it sealed');
  assert.equal(sealed.entry.length, INBOX_ENTRY_SIZE);
  assert.equal(sealed.args.length, 2);
  assert.equal(hex(sealed.args[1] as Uint8Array), hex(sealed.entry));
  /* And the owner can still open the one that was kept. */
  const opened = openInboxEntry(owner.secretKey, sealed.entry);
  assert.ok(opened);
  assert.equal(opened.value, COIN.value);
  /* The prototype builds seal nothing, so there is nothing to keep. */
  assert.equal(sealedShieldedDeposit('account', COIN, null).entry, null);
});

test('our entry is found wherever in the new slots it landed', () => {
  const owner = generateEncKeyPair();
  const ours = sealedShieldedDeposit('account-k1', COIN, owner.publicKey).entry;
  const theirs = sealedShieldedDeposit('account-k1', COIN, owner.publicKey).entry;
  assert.ok(ours && theirs);
  /* Two entries appeared while we waited and ours is the SECOND: inbox_count is
     nobody's reservation, and another depositor can take the slot we built for. */
  assert.equal(inboxHoldsEntry(inbox([theirs, ours]), 0n, 2n, ours), true);
  assert.equal(inboxHoldsEntry(inbox([ours, theirs]), 0n, 2n, ours), true);
  /* Somebody else's growth is not ours. */
  assert.equal(inboxHoldsEntry(inbox([theirs]), 0n, 1n, ours), false);
});

test('it never looks at slots that were already there', () => {
  const owner = generateEncKeyPair();
  const ours = sealedShieldedDeposit('account-k1', COIN, owner.publicKey).entry;
  assert.ok(ours);
  const read = inbox([ours, ours]);
  /* Two entries before us and no growth: nothing of ours has been written,
     whatever the account happens to be holding from an earlier deposit. */
  assert.equal(inboxHoldsEntry(read, 2n, 2n, ours), false);
  const looked: bigint[] = [];
  inboxHoldsEntry(
    (index) => {
      looked.push(index);
      return null;
    },
    5n,
    7n,
    ours,
  );
  assert.deepEqual(looked, [5n, 6n]);
});

test('a burst of somebody else’s traffic does not turn one check into thousands', () => {
  const owner = generateEncKeyPair();
  const ours = sealedShieldedDeposit('account-k1', COIN, owner.publicKey).entry;
  assert.ok(ours);
  let reads = 0;
  inboxHoldsEntry(
    () => {
      reads += 1;
      return null;
    },
    0n,
    10_000n,
    ours,
  );
  assert.equal(BigInt(reads), INBOX_SCAN_MAX);
});

test('an inbox this service cannot walk is no evidence, not false evidence', () => {
  const owner = generateEncKeyPair();
  const ours = sealedShieldedDeposit('account-k1', COIN, owner.publicKey).entry;
  assert.ok(ours);
  /* Every slot unreadable: the answer is false, and `included` is what the
     caller falls back to rather than a confirmation invented here. */
  assert.equal(inboxHoldsEntry(() => null, 0n, 3n, ours), false);
  /* And a build that sealed nothing has nothing to look for. */
  assert.equal(inboxHoldsEntry(inbox([ours]), 0n, 1n, null), false);
});
