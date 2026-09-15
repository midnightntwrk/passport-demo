/**
 * `/register-alias` asked twice for the same name by the same Passport.
 *
 * THE RUN THIS IS WRITTEN FROM (staging, 2026/09/15, UTC)
 * ------------------------------------------------------
 * 17:12:00 `stagehbtest` asked for, by account `bcf6d98e…`. 17:12:50 registered
 * and read back — `stagehbtest.night → bcf6d98e…`. 17:12:51 the SAME account
 * asks for `stagehbtest` again, because the first answer never reached it. The
 * sponsor refused `409 name-taken`, and the person was told to choose another
 * name for a name that was by then theirs. They chose `stagehbtest2`, which was
 * genuinely free, and were refused `409 already-sponsored`.
 *
 * Both refusals are true statements about the registry and about the ledger,
 * and both are the wrong answer to the caller who made them happen. The tests
 * below are the line between the two: a registration that is ALREADY this
 * Passport's is answered as done, and every other way of not being that caller
 * is refused exactly as it was before.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  aliasSuccessBody,
  existingRegistration,
  targetIsPassport,
  type ExistingRegistrationContext,
} from '../src/aliasOwnership.js';
import type { AliasEntry } from '../src/ledgers.js';
import type { AliasRegistration } from '../src/midnames.js';

const MINE = 'bc'.repeat(32);
const THEIRS = 'cc'.repeat(32);
const RESOLVER = 'e3'.repeat(32);
const LEDGER_RESOLVER = 'd4'.repeat(32);

const context: ExistingRegistrationContext = {
  label: 'stagehbtest',
  domain: 'stagehbtest.night',
  network: 'stagenet',
  tldAddress: 'aa'.repeat(32),
  contractAddress: MINE,
  ownerKeyHex: '11'.repeat(32),
  now: '2026-09-15T17:12:51.000Z',
};

const entry: AliasEntry = {
  alias: 'stagehbtest',
  resolverAddress: LEDGER_RESOLVER,
  resolverDeployTx: 'a1'.repeat(32),
  registerTx: 'b2'.repeat(32),
  costAtomic: '1000000',
  at: '2026-09-15T17:12:50.000Z',
};

describe('a Passport asking again for the name it already holds', () => {
  it('is answered as registered when the registry names its own account', () => {
    const answer = existingRegistration({
      context,
      reading: { kind: 'resolved', resolverAddress: RESOLVER, target: { kind: 'contract', hex: MINE } },
      entry,
    });
    assert.notEqual(answer, null);
    assert.equal(answer!.alias, 'stagehbtest');
    assert.equal(answer!.domain, 'stagehbtest.night');
    assert.deepEqual(answer!.target, { kind: 'contract', address: MINE });
    /* The leaf the REGISTRY names, not the one the ledger remembers: the chain
       is what a caller will resolve against. */
    assert.equal(answer!.resolverAddress, RESOLVER);
  });

  it('carries the transaction ids of the registration that really happened', () => {
    const answer = existingRegistration({
      context,
      reading: { kind: 'resolved', resolverAddress: RESOLVER, target: { kind: 'contract', hex: MINE } },
      entry,
    });
    assert.equal(answer!.registerTx, entry.registerTx);
    assert.equal(answer!.resolverDeployTx, entry.resolverDeployTx);
    assert.equal(answer!.costAtomic, 1_000_000n);
    assert.equal(answer!.registeredAt, entry.at);
  });

  it('matches the registry’s hex however either side is cased', () => {
    const answer = existingRegistration({
      context,
      reading: {
        kind: 'resolved',
        resolverAddress: RESOLVER,
        target: { kind: 'contract', hex: MINE.toUpperCase() },
      },
      entry,
    });
    assert.notEqual(answer, null);
  });

  it('leaves the ids EMPTY rather than inventing them when this service has no record', () => {
    /* The name is this Passport's and this sponsor did not put it there — a
       lost ledger, a hand registration. Saying so is worth more than a hash
       that would take somebody to a transaction that is not theirs. */
    const answer = existingRegistration({
      context,
      reading: { kind: 'resolved', resolverAddress: RESOLVER, target: { kind: 'contract', hex: MINE } },
      entry: null,
    });
    assert.notEqual(answer, null);
    assert.equal(answer!.registerTx, '');
    assert.equal(answer!.resolverDeployTx, '');
    assert.equal(answer!.costAtomic, 0n);
    assert.equal(answer!.registeredAt, context.now);
    assert.equal(answer!.fromPool, false);
    assert.equal(answer!.resolverDeployBlock, null);
    assert.equal(answer!.registerBlock, null);
  });

  it('answers gate 5 from its own ledger, with the registry not asked at all', () => {
    /* `already-sponsored` for the very name this service sponsored is the
       second half of the 2026/09/15 defect. */
    const answer = existingRegistration({ context, reading: { kind: 'unread' }, entry });
    assert.notEqual(answer, null);
    assert.equal(answer!.resolverAddress, LEDGER_RESOLVER);
    assert.equal(answer!.registerTx, entry.registerTx);
  });

  it('echoes the owner key the request asked the name to be held under', () => {
    const answer = existingRegistration({ context, reading: { kind: 'unread' }, entry });
    assert.equal(answer!.ownerKey, context.ownerKeyHex);
    assert.equal(answer!.network, 'stagenet');
    assert.equal(answer!.tldAddress, context.tldAddress);
  });
});

describe('every other caller is refused exactly as before', () => {
  it('refuses a name resolving to somebody else’s account', () => {
    assert.equal(
      existingRegistration({
        context,
        reading: { kind: 'resolved', resolverAddress: RESOLVER, target: { kind: 'contract', hex: THEIRS } },
        entry: null,
      }),
      null,
    );
  });

  it('refuses somebody else’s name even where the ledger claims it for us', () => {
    /* The chain outranks a JSON file. A ledger row and a registry entry that
       disagree is a bug in this service, not a licence to hand over a name. */
    assert.equal(
      existingRegistration({
        context,
        reading: { kind: 'resolved', resolverAddress: RESOLVER, target: { kind: 'contract', hex: THEIRS } },
        entry,
      }),
      null,
    );
  });

  it('refuses a name pointing at a wallet or a shielded key rather than an account', () => {
    for (const kind of ['wallet', 'shielded'] as const) {
      assert.equal(
        existingRegistration({
          context,
          reading: { kind: 'resolved', resolverAddress: RESOLVER, target: { kind, hex: MINE } },
          entry,
        }),
        null,
      );
    }
  });

  it('refuses a DIFFERENT name for a Passport that already has one', () => {
    /* `stagehbtest2`, the name the person typed next. One sponsored name per
       Passport is the limit, and this is it doing its job. */
    const answer = existingRegistration({
      context: { ...context, label: 'stagehbtest2', domain: 'stagehbtest2.night' },
      reading: { kind: 'unread' },
      entry,
    });
    assert.equal(answer, null);
  });

  it('refuses when the registry answered and the name is not in it', () => {
    assert.equal(existingRegistration({ context, reading: { kind: 'absent' }, entry }), null);
  });

  it('never claims ownership off a read that could not be made', () => {
    /* `unread` with nothing in the ledger is the honest nothing: the name is
       taken, we could not ask by whom, and `name-taken` stands. */
    assert.equal(existingRegistration({ context, reading: { kind: 'unread' }, entry: null }), null);
  });
});

describe('what a target has to be to be ours', () => {
  it('is a contract at this address, and nothing else', () => {
    assert.equal(targetIsPassport({ kind: 'contract', hex: MINE }, MINE), true);
    assert.equal(targetIsPassport({ kind: 'contract', hex: THEIRS }, MINE), false);
    assert.equal(targetIsPassport({ kind: 'wallet', hex: MINE }, MINE), false);
    assert.equal(targetIsPassport({ kind: 'shielded', hex: MINE }, MINE), false);
  });
});

describe('the answer’s shape', () => {
  const fresh: AliasRegistration = {
    alias: 'stagehbtest',
    domain: 'stagehbtest.night',
    network: 'stagenet',
    tldAddress: context.tldAddress,
    resolverAddress: RESOLVER,
    resolverDeployTx: 'a1'.repeat(32),
    registerTx: 'b2'.repeat(32),
    resolverDeployBlock: 407_009,
    registerBlock: 407_010,
    target: { kind: 'contract', address: MINE },
    ownerKey: context.ownerKeyHex,
    costAtomic: 1_000_000n,
    registeredAt: '2026-09-15T17:12:50.000Z',
    fromPool: true,
  };

  it('is identical, key for key, whether the registration is new or found', () => {
    const found = existingRegistration({ context, reading: { kind: 'unread' }, entry })!;
    assert.deepEqual(
      Object.keys(aliasSuccessBody(fresh, false)).sort(),
      Object.keys(aliasSuccessBody(found, true)).sort(),
    );
  });

  it('reports the cost as a string, because a bigint does not survive JSON', () => {
    assert.equal(aliasSuccessBody(fresh, false).costAtomic, '1000000');
  });

  it('says which of the two it is, on both', () => {
    assert.equal(aliasSuccessBody(fresh, false).alreadyRegistered, false);
    assert.equal(aliasSuccessBody(fresh, true).alreadyRegistered, true);
  });

  it('names the target the client checks its own contract against', () => {
    assert.deepEqual(aliasSuccessBody(fresh, false).target, { kind: 'contract', address: MINE });
  });
});
