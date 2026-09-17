/**
 * The inbox entry, held to the only property that matters about a wire format:
 * bytes this service seals are bytes somebody ELSE opens.
 *
 * `./fixtures/inbox-v1.json` is the load-bearing part of this file. It was
 * produced by running the reference's own `contract/src/wallet/inbox.ts`, and
 * the demo's browser implementation — different curve library, different AEAD
 * binding, no `node:crypto` at all — is tested against the same file in
 * `examples/passport-demo/src/identity/custodyInbox.test.ts`. Two implementations
 * that agree with themselves and not with each other is the failure that does
 * not surface until a coin is already stranded, so the fixtures are the test
 * and the round trips are the sanity check.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

import {
  INBOX_ENTRY_SIZE,
  INBOX_ENTRY_SUITE,
  INBOX_ENTRY_VERSION,
  INBOX_HKDF_INFO,
  INBOX_PLAINTEXT_SIZE,
  decodeInboxCoin,
  encodeInboxCoin,
  generateEncKeyPair,
  openInboxEntry,
  sealInboxEntry,
  type InboxCoin,
} from '../src/custodyInbox.js';

import fixtures from './fixtures/inbox-v1.json' with { type: 'json' };

const unhex = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'hex'));
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const NONCE = unhex('7f'.repeat(32));
const COLOUR = unhex('1a'.repeat(32));

const coin = (patch: Partial<InboxCoin> = {}): InboxCoin => ({
  nonce: NONCE,
  color: COLOUR,
  value: 100n,
  ...patch,
});

/* -------------------------------------------------------------------------- */

test('the reference’s own entries open here, byte for byte', () => {
  assert.ok(fixtures.entries.length > 0);
  for (const fixture of fixtures.entries) {
    const opened = openInboxEntry(unhex(fixtures.owner.secretKeyHex), unhex(fixture.entryHex));
    assert.ok(opened, 'the reference entry did not open');
    assert.equal(hex(opened.nonce), fixture.coin.nonceHex);
    assert.equal(hex(opened.color), fixture.coin.colourHex);
    assert.equal(opened.value, BigInt(fixture.coin.value));
  }
});

test('the reference’s entries stay shut to a stranger', () => {
  for (const fixture of fixtures.entries) {
    assert.equal(
      openInboxEntry(unhex(fixtures.stranger.secretKeyHex), unhex(fixture.entryHex)),
      null,
    );
  }
});

test('the container’s shape is the reference’s', () => {
  assert.equal(INBOX_ENTRY_SIZE, fixtures.entryBytes);
  assert.equal(INBOX_HKDF_INFO, fixtures.hkdfInfo);
  for (const fixture of fixtures.entries) {
    const bytes = unhex(fixture.entryHex);
    assert.equal(bytes.length, INBOX_ENTRY_SIZE);
    assert.equal(bytes[0], INBOX_ENTRY_VERSION);
    assert.equal(bytes[1], INBOX_ENTRY_SUITE);
    /* Fifty zero bytes of padding, so every entry is the same size whatever it
       holds and an observer counting bytes learns nothing. */
    assert.deepEqual([...bytes.subarray(142)], new Array(50).fill(0));
  }
});

test('an entry sealed here opens with the reference-generated secret', () => {
  const entry = sealInboxEntry(unhex(fixtures.owner.publicKeyHex), coin({ value: 7n }));
  const opened = openInboxEntry(unhex(fixtures.owner.secretKeyHex), entry);
  assert.ok(opened);
  assert.equal(opened.value, 7n);
  assert.equal(hex(opened.nonce), hex(NONCE));
  assert.equal(hex(opened.color), hex(COLOUR));
});

/* -------------------------------------------------------------------------- */

test('the plaintext is nonce, colour, and a big-endian value', () => {
  const encoded = encodeInboxCoin(coin({ value: 1n }));
  assert.equal(encoded.length, INBOX_PLAINTEXT_SIZE);
  assert.equal(hex(encoded.subarray(0, 32)), hex(NONCE));
  assert.equal(hex(encoded.subarray(32, 64)), hex(COLOUR));
  assert.equal(encoded[79], 1);
  assert.equal(encoded[64], 0);
  assert.equal(encodeInboxCoin(coin({ value: 1n << 127n }))[64], 0x80);
});

test('the largest value the field holds survives the round trip', () => {
  const max = (1n << 128n) - 1n;
  const back = decodeInboxCoin(encodeInboxCoin(coin({ value: max })));
  assert.equal(back?.value, max);
  assert.throws(() => encodeInboxCoin(coin({ value: max + 1n })), /cannot carry/);
  assert.throws(() => encodeInboxCoin(coin({ value: -1n })), /cannot carry/);
});

test('a coin it could not describe faithfully is refused, never truncated', () => {
  assert.throws(() => encodeInboxCoin(coin({ nonce: new Uint8Array(31) })), /coin nonce/);
  assert.throws(() => encodeInboxCoin(coin({ color: new Uint8Array(33) })), /colour/);
  assert.throws(
    () => encodeInboxCoin(coin({ nonce: undefined as unknown as Uint8Array })),
    /coin nonce/,
  );
});

test('a plaintext that is not eighty bytes decodes to nothing', () => {
  assert.equal(decodeInboxCoin(new Uint8Array(79)), null);
  assert.equal(decodeInboxCoin(new Uint8Array(81)), null);
});

/* -------------------------------------------------------------------------- */

test('a round trip through a freshly generated account key', () => {
  const keys = generateEncKeyPair();
  const entry = sealInboxEntry(keys.publicKey, coin({ value: 4_200n }));
  assert.equal(entry.length, INBOX_ENTRY_SIZE);
  assert.equal(openInboxEntry(keys.secretKey, entry)?.value, 4_200n);
});

test('two deposits of the same coin are two different entries', () => {
  const keys = generateEncKeyPair();
  assert.notEqual(
    hex(sealInboxEntry(keys.publicKey, coin())),
    hex(sealInboxEntry(keys.publicKey, coin())),
  );
});

test('every kind of no is a skip, not a throw', () => {
  const keys = generateEncKeyPair();
  const entry = sealInboxEntry(keys.publicKey, coin());

  assert.equal(openInboxEntry(generateEncKeyPair().secretKey, entry), null);
  assert.equal(openInboxEntry(keys.secretKey, new Uint8Array(191)), null);
  assert.equal(openInboxEntry(keys.secretKey, 'nope' as unknown as Uint8Array), null);

  const futureVersion = entry.slice();
  futureVersion[0] = 0x02;
  assert.equal(openInboxEntry(keys.secretKey, futureVersion), null);

  const futureSuite = entry.slice();
  futureSuite[1] = 0x09;
  assert.equal(openInboxEntry(keys.secretKey, futureSuite), null);

  for (const offset of [2, 34, 46, 62]) {
    const flipped = entry.slice();
    flipped[offset] ^= 0x01;
    assert.equal(openInboxEntry(keys.secretKey, flipped), null, `offset ${offset} still opened`);
  }
});

test('the padding is ignored by a reader, as the specification says', () => {
  const keys = generateEncKeyPair();
  const entry = sealInboxEntry(keys.publicKey, coin());
  const scribbled = entry.slice();
  scribbled.fill(0xaa, 142);
  assert.equal(openInboxEntry(keys.secretKey, scribbled)?.value, 100n);
});

test('sealing to something that is not a key is refused', () => {
  assert.throws(() => sealInboxEntry(new Uint8Array(31), coin()), /account encryption key/);
});
