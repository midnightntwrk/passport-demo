/**
 * What a partner app — and the person watching the approval sheet — is told
 * when a payment fails.
 *
 * The case being held to a standard is the one that shipped: the reply carried
 * `messageOf(cause)`, so a node refusal reached an integrating app's users as
 *
 *     SubmissionError: 1010: Invalid Transaction: Custom error: 239
 *
 * The bar is therefore two-sided and both sides matter. Nothing rendered may
 * contain the machinery — that is what the regression was — AND every wire code
 * must be the one that was on the wire before, because apps already branch on
 * them and a copy fix that quietly re-coded failures would be a breaking change
 * in disguise.
 */

import { describe, expect, it } from 'vitest';

import { SEND_REFUSED_TEXT } from './sendLegs.js';
import { txFailureForApp } from './txFailure.js';

/** The machinery a reply must never carry, in the words it carried them in. */
const MACHINERY =
  /SubmissionError|Custom error|Invalid Transaction|1010|239|contract|circuit|indexer|GraphQL|0x[0-9a-f]{8}|https?:\/\//i;

describe('txFailureForApp', () => {
  it('never puts the node’s own words on the wire', () => {
    const refusal = Object.assign(
      new Error('SubmissionError: 1010: Invalid Transaction: Custom error: 239'),
      { name: 'SubmissionError' },
    );
    const wrapped = Object.assign(new Error('The account contract rejected withdraw_shielded.'), {
      cause: refusal,
    });

    const { error, detail } = txFailureForApp(wrapped);
    expect(error).toBe('submit-failed');
    expect(detail).not.toMatch(MACHINERY);
    /* It is the send panel's own sentence, so the two surfaces cannot drift. */
    expect(detail).toBe(SEND_REFUSED_TEXT);
  });

  it('keeps every wire code exactly where it was', () => {
    /* These pairings are the ones shipped apps already handle. The sentences
       may be rewritten; the left-hand column may not. */
    expect(txFailureForApp({ code: 'insufficient-night' }).error).toBe('insufficient-funds');
    expect(txFailureForApp({ code: 'wrong-network' }).error).toBe('network-mismatch');
    expect(txFailureForApp({ code: 'invalid-recipient' }).error).toBe('invalid-request');
    expect(txFailureForApp({ code: 'wallet-closed' }).error).toBe('wallet-unavailable');
    expect(txFailureForApp({ code: 'presence-unavailable' }).error).toBe('wallet-unavailable');
    expect(txFailureForApp({ code: 'fee-unavailable' }).error).toBe('submit-failed');
  });

  it('does not report the fee payer standing down as the user running short', () => {
    /* A Passport holder never funds their own fees, so `insufficient-funds`
       here would put the shortfall on a party with nothing to top up — and
       send them looking for a step that does not exist. */
    const { error, detail } = txFailureForApp({
      code: 'fee-unavailable',
      message: 'sponsor reports 0/1 wallets available (#0 dust 4993664979775282371)',
    });
    expect(error).toBe('submit-failed');
    expect(detail).not.toMatch(/0\/1|4993664979775282371|dust/i);
    expect(detail).toMatch(/^Network fees for this payment could not be covered/);
  });

  it('answers a shortfall with a sentence and not with the shortfall’s arithmetic', () => {
    const { detail } = txFailureForApp({
      code: 'insufficient-night',
      message: 'insufficient funds: needed 5000000 held 120000',
    });
    expect(detail).not.toMatch(/5000000|120000/);
    expect(detail).toBe(
      'This Passport does not hold enough to cover that payment, so nothing was sent.',
    );
  });

  it('says the same thing for a session that closed and one that could not be asserted', () => {
    /* Two causes, one fact for the reader: nothing was signed and signing in
       again is what changes it. */
    const closed = txFailureForApp({ code: 'wallet-closed', message: 'handle disposed' });
    const absent = txFailureForApp({ code: 'presence-unavailable', message: 'NotAllowedError' });
    expect(closed).toEqual(absent);
    expect(closed.detail).toBe(
      'The Passport signing session closed before this could be signed.',
    );
    /* Nothing a person reads says "wallet", whatever the wire code says. */
    expect(closed.detail).not.toMatch(/wallet/i);
  });

  it('describes a recipient it could not read without quoting it back', () => {
    const { error, detail } = txFailureForApp({
      code: 'invalid-recipient',
      message: 'mn_addr_test1qq… failed bech32m checksum',
    });
    expect(error).toBe('invalid-request');
    expect(detail).toBe('Passport could not read that recipient, so nothing was signed.');
    expect(detail).not.toMatch(/mn_addr|bech32/i);
  });

  it('names the network mismatch without naming an address', () => {
    const { detail } = txFailureForApp({
      code: 'wrong-network',
      message: 'mn_addr1qq0f3… belongs to mainnet',
    });
    expect(detail).toBe(
      'That recipient belongs to a different network from this Passport, so nothing was sent.',
    );
    expect(detail).not.toMatch(/mn_addr/i);
  });

  it('is total — a string, an object with no code, and nothing at all', () => {
    for (const cause of ['boom', { nope: true }, { code: 404 }, undefined, null]) {
      const { error, detail } = txFailureForApp(cause);
      expect(error).toBe('submit-failed');
      expect(detail).toBe(SEND_REFUSED_TEXT);
    }
  });

  it('keeps a sentence the transaction runtime wrote for a reader itself', () => {
    /* Routed through `sendRefusalText`, which already makes this exception:
       replacing a classified, reader-facing message with a generic one is a
       worse screen rather than a cleaner one. It names no machinery either. */
    const classified = Object.assign(new Error('balancing failed'), {
      name: 'BalancingFailure',
      retryable: true,
      userMessage: 'There was not enough to cover this payment.',
    });
    expect(txFailureForApp(classified)).toEqual({
      error: 'submit-failed',
      detail: 'There was not enough to cover this payment.',
    });
  });
});
