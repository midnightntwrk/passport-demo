import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createCircuitContext, createConstructorContext, sampleContractAddress } from '@midnight-ntwrk/compact-runtime';
import { CONTRACT_PATTERNS } from '../service/contract-patterns.js';
import { serialiseLedgerState } from '../service/ledger-state.js';

// Point at output copied from compileContract: <root>/<pattern-id>/{result.json,index.js}.
// Validate both source and output hashes before executing it. This runs actual
// generated circuits without proof generation, wallet keys, or a network call.
const artefactRoot = process.env.CONTRACT_PATTERN_ARTEFACTS;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const bytes = (value: string) => { const out = new Uint8Array(32); out.set(new TextEncoder().encode(value)); return out; };
const hex = (value: string) => Buffer.from(bytes(value)).toString('hex');

async function simulator(id: string) {
  const pattern = CONTRACT_PATTERNS.find(value => value.id === id)!;
  const directory = join(artefactRoot!, id);
  const manifest = JSON.parse(await readFile(join(directory, 'result.json'), 'utf8'));
  const source = await readFile(join(directory, 'index.js'), 'utf8');
  assert.equal(manifest.compilerVersion, '0.34.0');
  assert.equal(manifest.sourceHash, hash(pattern.source), 'Compiler output must correspond to the exact reference source');
  assert.equal(manifest.artefacts['contract/index.js'], hash(source), 'Compiler output must retain its recorded hash');
  const preamble = "import * as __compactRuntime from '@midnight-ntwrk/compact-runtime';";
  assert.ok(source.startsWith(preamble));
  const runtime = pathToFileURL(createRequire(import.meta.url).resolve('@midnight-ntwrk/compact-runtime')).href;
  const code = source.replace(preamble, `import * as __compactRuntime from ${JSON.stringify(runtime)};`).replace(/^\/\/# sourceMappingURL=.*$/gm, '');
  const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  const contract = new module.Contract({});
  const initial = await contract.initialState(createConstructorContext(undefined, '00'.repeat(32)));
  let state = initial.currentContractState.data;
  const address = sampleContractAddress();
  return {
    async call(circuit: string, ...args: unknown[]) {
      const context = createCircuitContext(circuit, address, initial.currentZswapLocalState, state, undefined);
      const result = await contract.impureCircuits[circuit](context, ...args);
      state = result.context.callContext.currentQueryContext.state;
    },
    state: () => serialiseLedgerState(module.ledger(state)),
  };
}

test('compiled registry keeps distinct records, applies updates, and serialises real Map/Set wrappers', { skip: !artefactRoot }, async () => {
  const app = await simulator('member-registry');
  assert.deepEqual(app.state(), { memberLabels: { entries: [], size: '0', truncated: false }, activeMembers: { values: [], size: '0', truncated: false } });
  await app.call('registerMember', bytes('member-a'), bytes('Alice'));
  await app.call('registerMember', bytes('member-b'), bytes('Bina'));
  await assert.rejects(app.call('registerMember', bytes('member-a'), bytes('Duplicate')), /already registered/);
  await assert.rejects(app.call('updateLabel', bytes('missing'), bytes('Missing')), /not registered/);
  await app.call('updateLabel', bytes('member-a'), bytes('Alicia'));
  await app.call('setActive', bytes('member-a'), false);
  await assert.rejects(app.call('setActive', bytes('member-a'), false), /requested status/);
  const state = app.state() as any;
  state.memberLabels.entries.sort(([a]: [string], [b]: [string]) => a.localeCompare(b));
  assert.deepEqual(state.memberLabels, { entries: [[hex('member-a'), hex('Alicia')], [hex('member-b'), hex('Bina')]], size: '2', truncated: false });
  assert.deepEqual(state.activeMembers, { values: [hex('member-b')], size: '1', truncated: false });
  await app.call('setActive', bytes('member-a'), true);
  assert.equal((app.state() as any).activeMembers.size, '2');
});

test('compiled workflow preserves record fields and rejects invalid lifecycle transitions', { skip: !artefactRoot }, async () => {
  const app = await simulator('task-workflow');
  await app.call('createTask', 7n, bytes('Ship release'), 2n);
  await app.call('createTask', 9n, bytes('Review docs'), 1n);
  await assert.rejects(app.call('createTask', 7n, bytes('Duplicate'), 0n), /already exists/);
  await assert.rejects(app.call('createTask', 11n, bytes('Bad priority'), 4n), /Priority/);
  await assert.rejects(app.call('finishTask', 7n), /Start the task/);
  await assert.rejects(app.call('startTask', 99n), /does not exist/);
  await app.call('startTask', 7n);
  await assert.rejects(app.call('startTask', 7n), /Only an open task/);
  await app.call('finishTask', 7n);
  await assert.rejects(app.call('finishTask', 7n), /Start the task/);
  const state = app.state() as any;
  state.tasks.entries.sort(([a]: [string], [b]: [string]) => a.localeCompare(b));
  assert.deepEqual(state, {
    tasks: { entries: [
      ['7', { title: hex('Ship release'), priority: '2', phase: 2 }],
      ['9', { title: hex('Review docs'), priority: '1', phase: 0 }],
    ], size: '2', truncated: false },
  });
});
