import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const runtimeDirectory = new URL('../runtime/', import.meta.url);
const hostCode = (await build({
  entryPoints: [fileURLToPath(new URL('host.ts', runtimeDirectory))], bundle: true, write: false, format: 'iife', platform: 'browser',
  plugins: [{ name: 'sdk-fixture', setup(plugin) {
    plugin.onResolve({ filter: /^@midnight-passport\/connect$/ }, () => ({ path: 'sdk', namespace: 'fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export function createPassport(options) { globalThis.sdkOptions = options; return globalThis.sdk; }' }));
  } }],
})).outputFiles[0].text;
const clientCode = (await build({
  entryPoints: [fileURLToPath(new URL('client.tsx', runtimeDirectory))], bundle: true, write: false, format: 'iife', globalName: 'client', platform: 'browser',
  plugins: [{ name: 'react-fixture', setup(plugin) {
    plugin.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export function useEffect(action) { action(); } export function useSyncExternalStore(subscribe, snapshot) { return snapshot(); }' }));
  } }],
})).outputFiles[0].text;
const profile = { displayName: 'Alice', passportContract: { address: 'ab'.repeat(32), network: 'stagenet' } };
const txId = '00' + 'cd'.repeat(32);
const hostOrigin = 'https://builder.midnightpassport.com';
const passportOrigin = 'https://midnightpassport.com';
const appId = '11111111-1111-4111-a111-111111111111';
const storageKey = `passport-builder:profile:${passportOrigin}:${appId}`;
const flush = async () => { for (let index = 0; index < 6; index += 1) await new Promise<void>(resolve => setImmediate(resolve)); };
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

function host(options: { storage?: Map<string, string>; app?: string; fetch?: (path: string, options: any) => Promise<any>; sdk?: Record<string, unknown> } = {}) {
  const posted: any[] = [];
  const listeners: Record<string, (...args: any[]) => any> = {};
  const elements: Record<string, any> = {};
  const counts = { profile: 0, transaction: 0, dialogs: 0, destroyed: 0 };
  for (const id of ['runtime-data', 'app', 'connect', 'notice', 'approval', 'approve', 'cancel', 'approval-title', 'approval-copy', 'recovery', 'check-pending', 'clear-pending']) {
    elements[id] = { textContent: '', addEventListener(type: string, action: (...args: any[]) => any) { this[type] = action; } };
  }
  elements['runtime-data'].textContent = JSON.stringify({ id: options.app || appId, name: 'Tasks', passportOrigin, app: '<p>App</p>',
    contractAddress: 'ef'.repeat(32), deploymentId: 'deployment-1', circuits: ['startTask'] });
  elements.app.contentWindow = { postMessage(value: unknown) { posted.push(json(value)); } };
  elements.approval.showModal = () => { counts.dialogs += 1; };
  elements.approval.close = () => undefined;
  const storage = options.storage || new Map<string, string>();
  const scheduled: Array<() => void> = [];
  const context: any = {
    URL, AbortSignal, console, Date,
    document: { getElementById: (id: string) => elements[id] },
    window: { addEventListener: (type: string, action: (...args: any[]) => any) => { listeners[type] = action; } },
    sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
    setTimeout: (action: () => void) => { scheduled.push(action); return scheduled.length; },
    sdk: {
      requestProfile: async () => { counts.profile += 1; return { approved: true, profile }; },
      requestContractTransaction: async () => { counts.transaction += 1; return { status: 'submitted', txId }; },
      destroy: () => { counts.destroyed += 1; }, ...options.sdk,
    },
    fetch: async (path: string, requestOptions: any) => {
      const value = options.fetch ? await options.fetch(path, requestOptions)
        : path.includes('/transaction?') ? { status: 'confirmed', txId, blockHeight: 123 }
          : path.endsWith('/prepare') ? { transaction: 'proven-transaction', txId } : { count: '1' };
      return { ok: true, status: 200, json: async () => value };
    },
  };
  runInNewContext(hostCode, context);
  return { counts, posted, storage, elements, scheduled, context,
    send: (method: string, params?: unknown, id: string = randomUUID(), override: Record<string, unknown> = {}) => {
      const done = listeners.message({ source: elements.app.contentWindow, origin: 'null', data: { channel: 'passport-builder:app', id, method, params }, ...override });
      return { id, done };
    },
    result: (id: string) => posted.find(value => value.id === id),
    latestState: () => posted.filter(value => value.type === 'state').at(-1)?.state,
    approve: () => elements.approve.onclick(),
    dispose: () => listeners.pagehide({ persisted: false }),
  };
}

test('runtime coalesces profile requests, preserves explicit consent, and reuses this app connection after reload', async () => {
  const app = host();
  const first = app.send('connect');
  const second = app.send('connect');
  assert.equal(app.counts.dialogs, 1);
  assert.equal(app.counts.profile, 0, 'Generated code alone must not open Passport');
  app.approve();
  await Promise.all([first.done, second.done]);
  assert.equal(app.counts.profile, 1);
  assert.deepEqual(app.result(first.id).result, profile);
  assert.deepEqual(app.result(second.id).result, profile);
  assert.equal(app.latestState().connected, true);
  const cached = app.send('connect'); await cached.done;
  assert.equal(app.counts.dialogs, 1);
  assert.equal(app.counts.profile, 1);
  const reloaded = host({ storage: app.storage });
  await reloaded.send('connect').done;
  assert.equal(reloaded.latestState().connected, true);
  assert.equal(reloaded.counts.profile, 0);
  assert.equal(reloaded.counts.dialogs, 0);
  const otherApp = host({ storage: app.storage, app: 'another-app' });
  assert.equal(otherApp.latestState().connected, false);
  app.dispose(); reloaded.dispose(); otherApp.dispose();
});

test('expired or wrong-network cached display profiles do not bypass a new profile request', () => {
  for (const saved of [
    { version: 1, expiresAt: Date.now() - 1, profile },
    { version: 1, expiresAt: Date.now() + 60_000, profile: { passportContract: { address: 'ab'.repeat(32), network: 'mainnet' } } },
  ]) {
    const app = host({ storage: new Map([[storageKey, JSON.stringify(saved)]]) });
    assert.equal(app.latestState().connected, false);
    assert.equal(app.storage.has(storageKey), false);
    app.dispose();
  }
});

test('public ledger reads coalesce and remain independent from a Passport consent dialog', async () => {
  let finishRead!: (value: unknown) => void;
  let reads = 0;
  const app = host({ fetch: async () => { reads += 1; return new Promise(resolve => { finishRead = resolve; }); } });
  const first = app.send('ledger'); const second = app.send('ledger');
  const connection = app.send('connect');
  assert.equal(app.counts.dialogs, 1, 'An initial ledger read must not block connection');
  assert.equal(reads, 1);
  app.approve(); await connection.done;
  finishRead({ tasks: { entries: [], size: '0', truncated: false } });
  await Promise.all([first.done, second.done]);
  assert.deepEqual(app.result(first.id).result, app.result(second.id).result);
  assert.equal(app.result(first.id).error, undefined);
  app.dispose();
});

test('calls require user approval and only their own SDK transaction IDs can be confirmed', async () => {
  const app = host();
  const unrelated = app.send('transaction', { txId: '00' + 'ff'.repeat(32) }); await unrelated.done;
  assert.match(app.result(unrelated.id).error, /submitted through Passport/);
  const call = app.send('call', { circuit: 'startTask', args: ['7'], purpose: 'Start task 7' });
  await flush();
  assert.equal(app.counts.dialogs, 1);
  assert.equal(app.counts.transaction, 0);
  const read = app.send('ledger'); await read.done;
  assert.deepEqual(app.result(read.id).result, { count: '1' });
  const duplicate = app.send('call', { circuit: 'startTask', args: ['7'], purpose: 'Start task 7' }); await duplicate.done;
  assert.match(app.result(duplicate.id).error, /approval is in progress/);
  app.approve(); await call.done;
  assert.deepEqual(app.result(call.id).result, { status: 'submitted', txId });
  const status = app.send('transaction', { txId }); await status.done;
  assert.deepEqual(app.result(status.id).result, { status: 'confirmed', txId, blockHeight: 123 });
  assert.equal(app.counts.transaction, 1);
  assert.equal(app.latestState().ledgerVersion, 1);
  assert.equal(app.latestState().lastTransaction.status, 'confirmed');
  app.dispose();
});

test('indexed partial failure refreshes state, while indexer outages retain submitted status', async () => {
  let reads = 0;
  const failed = host({ fetch: async path => {
    if (path.endsWith('/prepare')) return { transaction: 'proven', txId };
    if (path.includes('/transaction?')) return { status: 'failed', txId, blockHeight: 321, message: 'Partial execution; review ledger before retrying.' };
    reads += 1; return { changed: true };
  } });
  const call = failed.send('call', { circuit: 'startTask', args: ['7'], purpose: 'Start task' });
  await flush(); failed.approve(); await call.done;
  const status = failed.send('transaction', { txId }); await status.done;
  assert.equal(failed.result(status.id).result.status, 'failed');
  assert.equal(reads, 1);
  assert.equal(failed.latestState().ledgerVersion, 1);
  failed.dispose();

  const unavailable = host({ fetch: async path => {
    if (path.endsWith('/prepare')) return { transaction: 'proven', txId };
    throw new Error('Indexer temporarily unavailable');
  } });
  const submitted = unavailable.send('call', { circuit: 'startTask', args: ['7'], purpose: 'Start task' });
  await flush(); unavailable.approve(); await submitted.done; await flush();
  assert.equal(unavailable.latestState().lastTransaction.status, 'submitted');
  assert.match(unavailable.elements.notice.textContent, /Status check unavailable/);
  unavailable.dispose();
  for (const action of unavailable.scheduled) action();
  await flush();
});

test('a legacy immediate read after submission waits for indexing before returning the new state', async () => {
  let indexed!: (value: unknown) => void;
  let reads = 0;
  const app = host({ fetch: async path => {
    if (path.endsWith('/prepare')) return { transaction: 'proven', txId };
    if (path.includes('/transaction?')) return new Promise(resolve => { indexed = resolve; });
    reads += 1; return { count: '2' };
  } });
  const call = app.send('call', { circuit: 'startTask', args: ['7'], purpose: 'Start task' });
  await flush(); app.approve(); await call.done;
  const read = app.send('ledger');
  await flush();
  assert.equal(reads, 0);
  assert.equal(app.result(read.id), undefined);
  indexed({ status: 'confirmed', txId });
  await read.done;
  assert.deepEqual(app.result(read.id).result, { count: '2' });
  assert.equal(app.latestState().lastTransaction.status, 'confirmed');
  app.dispose();
});

test('messages from a different frame or origin cannot trigger Passport or network actions', async () => {
  const app = host({ fetch: async () => { throw new Error('Must not fetch'); } });
  await app.send('connect', undefined, 'foreign-frame', { source: {} }).done;
  await app.send('call', {}, 'foreign-origin', { origin: hostOrigin }).done;
  assert.equal(app.counts.dialogs, 0);
  assert.equal(app.counts.profile, 0);
  assert.equal(app.counts.transaction, 0);
  assert.equal(app.result('foreign-frame'), undefined);
  app.dispose();
});

test('React runtime methods retain identity and coalesce connection and ledger requests across hook instances', async () => {
  const sent: any[] = [];
  let receive!: (event: unknown) => void;
  const parent = { postMessage: (message: any) => sent.push(message) };
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const context: any = {
    parent, __PASSPORT_HOST_ORIGIN__: hostOrigin, crypto: { randomUUID },
    setTimeout: (fn: () => void) => { timers.set(++timerId, fn); return timerId; }, clearTimeout: (id: number) => timers.delete(id),
    window: { addEventListener: (_type: string, fn: (event: unknown) => void) => { receive = fn; } },
  };
  runInNewContext(clientCode, context);
  const first = context.client.usePassport(); const second = context.client.usePassport();
  for (const key of ['connect', 'readLedger', 'callContract', 'waitForTransaction']) assert.equal(first[key], second[key]);
  assert.equal(sent.filter(message => message.method === 'state').length, 1);
  const a = first.connect(); const b = second.connect();
  const readA = first.readLedger(); const readB = second.readLedger();
  assert.equal(a, b); assert.equal(readA, readB);
  for (const request of sent) receive({ source: parent, origin: hostOrigin, data: { channel: 'passport-builder:host', id: request.id, result: request.method === 'connect' ? profile : {} } });
  await Promise.all([a, b, readA, readB]);
  receive({ source: parent, origin: hostOrigin, data: { channel: 'passport-builder:host', type: 'state', state: { connected: true, profile } } });
  await context.client.usePassport().connect();
  assert.equal(sent.filter(message => message.method === 'connect').length, 1);
  assert.equal(timers.size, 0);
});

test('lost Passport reply stays unknown across reload and cannot prepare or submit a duplicate', async () => {
  let prepares = 0; let submissions = 0;
  const fetch = async (path: string) => {
    if (path.endsWith('/prepare')) { prepares++; return { transaction: 'proven', txId }; }
    return { status: 'submitted', txId };
  };
  const app = host({ fetch, sdk: { requestContractTransaction: async () => {
    submissions++; return { status: 'failed', source: 'local', error: 'passport-closed', message: 'Closed' };
  } } });
  const call = app.send('call', { circuit: 'startTask', args: ['7'], purpose: 'Start task' });
  await flush(); app.approve(); await call.done;
  assert.equal(app.result(call.id).result.status, 'unknown');
  assert.equal(app.result(call.id).result.txId, txId);
  const reloaded = host({ fetch, storage: app.storage });
  const duplicate = reloaded.send('call', { circuit: 'startTask', args: ['7'], purpose: 'Start task' });
  await duplicate.done;
  assert.match(reloaded.result(duplicate.id).error, /unresolved/);
  assert.equal(prepares, 1); assert.equal(submissions, 1);
  assert.equal(reloaded.latestState().lastTransaction.status, 'unknown');
  app.dispose(); reloaded.dispose();
  for (const action of [...app.scheduled, ...reloaded.scheduled]) action();
  await flush();
});
