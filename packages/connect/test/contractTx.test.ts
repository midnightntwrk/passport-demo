import { describe, expect, it } from 'vitest';
import { createPassport, createPassportContractTxRequest, createPassportContractTxResponse, createPassportProfileReady, readPassportContractTxRequest, readPassportContractTxResponse, type PassportContractTxRequest } from '../src/index.js';
import { asWindow, createFakeWindow, createPeer, tick } from './fakeWindow.js';

const intent = { networkId: 'stagenet' as const, transaction: '00aa', contractAddress: 'ab'.repeat(32), entryPoint: 'increment', purpose: 'Add one vote' };
const request = createPassportContractTxRequest({ ...intent, requestId: 'r', nonce: 'n' });
const ORIGIN = 'https://passport.example';

describe('restricted contract protocol', () => {
  it('validates network, bytes, identity, circuit, and bounds before transport', () => {
    expect(readPassportContractTxRequest(request).kind).toBe('ok');
    for (const patch of [{ networkId: 'mainnet' }, { transaction: 'xyz' }, { transaction: 'a' }, { transaction: '' }, { transaction: '00'.repeat(1024 * 1024 + 1) }, { contractAddress: 'ab' }, { entryPoint: '../call' }, { purpose: '' }]) {
      expect(readPassportContractTxRequest({ ...request, intent: { ...intent, ...patch } }).kind).toBe('malformed');
    }
    expect(readPassportContractTxRequest({ ...request, version: 2 }).kind).toBe('version-mismatch');
    expect(readPassportContractTxRequest({ ...request, nonce: '' }).kind).toBe('malformed');
    expect(readPassportContractTxRequest({ ...request, intent: null }).kind).toBe('malformed');
    expect(readPassportContractTxRequest({}).kind).toBe('not-passport');
  });

  it('keeps payment responses separate and never permits fabricated submission', () => {
    expect(() => createPassportContractTxResponse(request, { status: 'submitted' })).toThrow();
    expect(readPassportContractTxResponse(createPassportContractTxResponse(request, { status: 'submitted', txId: 'node-id', sponsored: true })).kind).toBe('ok');
    expect(readPassportContractTxResponse({ ...createPassportContractTxResponse(request, { status: 'declined', error: 'declined' }), sponsored: true }).kind).toBe('malformed');
    expect(readPassportContractTxResponse({ protocol: 'org.midnight.passport.tx/v1' }).kind).toBe('not-passport');
  });

  it('binds the iframe reply to origin, source, nonce, and protocol', async () => {
    const host = createFakeWindow();
    const parent = createPeer();
    host.parent = parent;
    const passport = createPassport({ origin: ORIGIN, window: asWindow(host), timeoutMs: 500 });
    const pending = passport.requestContractTransaction(intent);
    await tick();
    const sent = parent.posts[0]!.message as PassportContractTxRequest;
    const response = createPassportContractTxResponse(sent, { status: 'submitted', txId: 'real-node-id', sponsored: true });
    let settled = false;
    void pending.then(() => { settled = true; });
    host.deliver(response, 'https://evil.example', parent);
    host.deliver(response, ORIGIN, createPeer());
    host.deliver({ ...response, nonce: 'other' }, ORIGIN, parent);
    host.deliver({ ...response, protocol: 'org.midnight.passport.tx/v1', type: 'passport.tx.response' }, ORIGIN, parent);
    await tick();
    expect(settled).toBe(false);
    expect(await passport.requestContractTransaction(intent)).toMatchObject({ status: 'failed', source: 'local' });
    expect(await passport.requestProfile(['displayName'])).toMatchObject({ approved: false, source: 'local', error: 'invalid-request' });
    host.deliver(response, ORIGIN, parent);
    expect(await pending).toMatchObject({ status: 'submitted', txId: 'real-node-id', sponsored: true });
    passport.destroy();
  });

  it('launches the contract popup, matches the handshake, and returns a version refusal', async () => {
    const host = createFakeWindow();
    const popup = createPeer();
    host.nextPopup = popup;
    const passport = createPassport({ origin: ORIGIN, window: asWindow(host), timeoutMs: 500 });
    const pending = passport.requestContractTransaction(intent);
    const params = new URL(host.opens[0]!.url).searchParams;
    const pair = { requestId: params.get('passportContractRequestId')!, nonce: params.get('passportContractNonce')! };
    expect(pair.requestId).toBeTruthy();
    host.deliver(createPassportProfileReady(pair.requestId, pair.nonce), ORIGIN, popup);
    await tick();
    expect(popup.posts[0]!.message).toMatchObject({ type: 'passport.contract-tx.request' });
    host.deliver(createPassportContractTxResponse(pair, { status: 'failed', error: 'version-mismatch' }), ORIGIN, popup);
    expect(await pending).toMatchObject({ status: 'failed', error: 'version-mismatch' });
    passport.destroy();
  });

  it('settles pending approval immediately on disposal and rejects use afterwards', async () => {
    const host = createFakeWindow();
    host.parent = createPeer();
    const passport = createPassport({ origin: ORIGIN, window: asWindow(host), timeoutMs: 60_000 });
    const pending = passport.requestContractTransaction(intent);
    await tick();
    passport.destroy();
    expect(await pending).toMatchObject({ status: 'failed', error: 'unsupported-transport' });
    expect(host.listenerCount()).toBe(0);
    expect(await passport.requestContractTransaction(intent)).toMatchObject({ status: 'failed', error: 'unsupported-transport' });
  });

  it('cancels a popup still waiting for its ready handshake on disposal', async () => {
    const host = createFakeWindow();
    host.nextPopup = createPeer();
    const passport = createPassport({ origin: ORIGIN, window: asWindow(host), timeoutMs: 60_000 });
    const pending = passport.requestContractTransaction(intent);
    passport.destroy();
    expect(await pending).toMatchObject({ status: 'failed', source: 'local' });
    expect(host.listenerCount()).toBe(0);
  });
});
