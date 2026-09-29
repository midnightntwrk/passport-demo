import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { createCircuitContext, createConstructorContext, sampleContractAddress } from '@midnight-ntwrk/compact-runtime';
import { validateSource } from '../service/compact.ts';
import { serialiseLedgerState } from '../service/ledger-state.ts';

const source = await readFile(new URL('../service/patterns/crud-records.compact', import.meta.url), 'utf8');
const bytes = (text: string) => { const value = new Uint8Array(32); value.set(new TextEncoder().encode(text)); return value; };
const hex = (text: string) => Buffer.from(bytes(text)).toString('hex');

test('CRUD reference fits the single-source public contract boundary', () => {
  assert.doesNotThrow(() => validateSource(source));
});

test('real Compact 0.34 CRUD preserves distinct records and rejects duplicate or missing IDs', {
  skip: process.env.RUN_COMPACT_CRUD_TEST !== '1', timeout: 60_000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'passport-crud-pattern-'));
  try {
    await writeFile(join(directory, 'contract.compact'), source);
    // This executes the maintained compiler, without proof generation, package
    // installation, credentials, or network writes. Runtime identity is pinned.
    const command = process.env.BUILDER_COMPACT_COMMAND || 'compact';
    await promisify(execFile)(command, ['compile', '+0.34.0', '--skip-zk', '--compact-path', '', 'contract.compact', 'managed'], {
      cwd: directory, timeout: 45_000, maxBuffer: 1024 * 1024,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'COMPACT_DIRECTORY', 'COMPACT_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME'].includes(key))),
    });
    const original = await readFile(join(directory, 'managed/contract/index.js'), 'utf8');
    const preamble = "import * as __compactRuntime from '@midnight-ntwrk/compact-runtime';";
    assert.ok(original.startsWith(preamble));
    const runtime = pathToFileURL(createRequire(import.meta.url).resolve('@midnight-ntwrk/compact-runtime')).href;
    const code = original.replace(preamble, `import * as __compactRuntime from ${JSON.stringify(runtime)};`).replace(/^\/\/# sourceMappingURL=.*$/gm, '');
    const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    const contract = new module.Contract({});
    const initial = await contract.initialState(createConstructorContext(undefined, '00'.repeat(32)));
    let state = initial.currentContractState.data;
    const address = sampleContractAddress();
    async function call(circuit: string, ...args: unknown[]) {
      const context = createCircuitContext(circuit, address, initial.currentZswapLocalState, state, undefined);
      const result = await contract.impureCircuits[circuit](context, ...args);
      state = result.context.callContext.currentQueryContext.state;
    }
    const read = () => serialiseLedgerState(module.ledger(state)) as { records: { entries: Array<[string, { label: string; value: string }]>; size: string; truncated: boolean } };
    assert.deepEqual(read(), { records: { entries: [], size: '0', truncated: false } });
    await call('createRecord', 7n, bytes('First record'), bytes('Open'));
    await call('createRecord', 9n, bytes('Second record'), bytes('Draft'));
    await assert.rejects(call('createRecord', 7n, bytes('Duplicate'), bytes('Invalid')), /already exists/);
    await assert.rejects(call('updateRecord', 99n, bytes('Missing'), bytes('Invalid')), /does not exist/);
    await assert.rejects(call('deleteRecord', 99n), /does not exist/);
    await call('updateRecord', 7n, bytes('Updated record'), bytes('Done'));
    const updated = read(); updated.records.entries.sort(([a], [b]) => a.localeCompare(b));
    assert.deepEqual(updated, { records: { entries: [
      ['7', { label: hex('Updated record'), value: hex('Done') }],
      ['9', { label: hex('Second record'), value: hex('Draft') }],
    ], size: '2', truncated: false } });
    await call('deleteRecord', 9n);
    assert.deepEqual(read(), { records: { entries: [['7', { label: hex('Updated record'), value: hex('Done') }]], size: '1', truncated: false } });
    await assert.rejects(call('deleteRecord', 9n), /does not exist/);
    await assert.rejects(call('updateRecord', 9n, bytes('Deleted'), bytes('Invalid')), /does not exist/);
    await call('createRecord', 9n, bytes('Recreated record'), bytes('Reopened'));
    assert.equal(read().records.size, '2');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
