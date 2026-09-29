import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Registry } from '../service/registry.js';
import { Workflow } from '../service/workflow.js';
import { readGenerationStream } from '../service/generation.js';
import type { Project } from '../shared/types.js';
import type { GenerationProgress } from '../shared/generation.js';
import { checkApp } from '../service/app-typecheck.js';

function project(): Project {
  return { id: 'stream-test', name: 'Existing', description: '', model: 'test/model', status: 'draft', revision: 1,
    files: { 'contract.compact': 'old contract', 'src/App.tsx': 'old app', 'src/styles.css': 'old css' }, messages: [], logs: [], deployments: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

test('UI integration errors enter compiler repair before the application can become ready', async () => {
  const registry = new Registry(':memory:'); const p = project(); registry.save(p); let calls = 0;
  const ui = (args: string) => `import {usePassport} from '@midnight-passport/app'; export default function App(){const {callContract}=usePassport(); return <button onClick={()=>void callContract('createOffer',${args},'Create offer')}>Create</button>}`;
  const workflow = new Workflow(registry, {
    autoPublish: false,
    generate: async (_project, prompt) => {
      calls++;
      if (calls > 1) assert.match(prompt, /Generated UI integration errors/);
      return { name: 'Offers', description: '', files: { ...p.files, 'src/App.tsx': ui(calls === 1 ? "{id:'1'}" : "['1']") } };
    },
    compile: async value => { await checkApp(value.files['src/App.tsx']); value.status = 'ready'; },
  });
  try {
    workflow.run(p, 'generate', 'Build real offers');
    for (let attempt = 0; attempt < 1500 && workflow.active.has(p.id); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(workflow.active.has(p.id), false); assert.equal(p.status, 'ready'); assert.equal(calls, 2);
    assert.match(p.files['src/App.tsx'], /\['1'\]/); assert.equal(p.deployments.length, 0);
  } finally { registry.close(); }
});
async function settled(workflow: Workflow, id: string) {
  for (let attempt = 0; attempt < 200 && workflow.active.has(id); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(workflow.active.has(id), false, 'workflow must finish');
}

test('partial sources stay out of editable files and SQLite token writes, then settle to exact validated files', async () => {
  const registry = new Registry(':memory:'); const p = project(); registry.save(p);
  const paused = deferred(); const release = deferred();
  const output = { name: 'New app', description: 'Complete', files: { 'contract.compact': 'new contract', 'src/App.tsx': 'new app', 'src/styles.css': '' } };
  const text = JSON.stringify(output); const split = text.indexOf('new contract') + 4;
  const before = structuredClone(p.files); let saves = 0; let compiled = 0;
  const save = registry.save.bind(registry); registry.save = value => { saves++; return save(value); };
  const workflow = new Workflow(registry, {
    generate: async (_project, _prompt, log, files) => readGenerationStream((async function* () {
      for (const char of text.slice(0, split)) yield char;
      paused.resolve(); await release.promise; yield text.slice(split);
    })(), log, files),
    compile: async value => { compiled++; assert.deepEqual(value.files, output.files); value.status = 'ready'; },
  });
  try {
    workflow.run(p, 'generate', 'Build this'); await paused.promise; const initialSaves = saves;
    await new Promise(resolve => setTimeout(resolve, 240));
    assert.deepEqual(p.files, before); assert.equal(compiled, 0);
    assert.equal(saves, initialSaves, 'token snapshots must not save to SQLite');
    const streaming = workflow.getGeneration(p.id)!;
    assert.equal(streaming.status, 'streaming'); assert.equal(streaming.files['contract.compact'], 'new ');
    assert.equal(streaming.activeFile, 'contract.compact');
    release.resolve(); await settled(workflow, p.id);
    const complete = workflow.getGeneration(p.id)!;
    assert.equal(complete.status, 'complete'); assert.ok(complete.sequence > streaming.sequence);
    assert.deepEqual(complete.files, output.files); assert.deepEqual(registry.get(p.id)!.files, output.files);
    assert.deepEqual(new Workflow(registry).getGeneration(p.id), complete);
    assert.equal(compiled, 1);
  } finally { release.resolve(); await settled(workflow, p.id); registry.close(); }
});

test('compiler repair starts a new run and resets tentative files, with increasing sequence', async () => {
  const registry = new Registry(':memory:'); const p = project(); registry.save(p);
  const paused = deferred(); const release = deferred(); let attempts = 0; let compiles = 0; let first!: GenerationProgress;
  const initial = { name: 'First', description: '', files: { 'contract.compact': 'first contract', 'src/App.tsx': 'first app', 'src/styles.css': 'first css' } };
  const repaired = { name: 'Repaired', description: '', files: { 'contract.compact': 'repaired', 'src/App.tsx': 'repaired app', 'src/styles.css': '' } };
  const text = JSON.stringify(repaired); const split = text.indexOf('repaired"') + 4;
  const workflow = new Workflow(registry, {
    generate: async (_project, prompt, log, files) => {
      attempts++;
      if (attempts === 1) return readGenerationStream((async function* () { yield JSON.stringify(initial); })(), log, files);
      assert.match(prompt, /Compiler rejected first attempt/);
      return readGenerationStream((async function* () { yield text.slice(0, split); paused.resolve(); await release.promise; yield text.slice(split); })(), log, files);
    },
    compile: async value => { compiles++; if (compiles === 1) { first = workflow.getGeneration(p.id)!; throw new Error('Compiler rejected first attempt'); } value.status = 'ready'; },
  });
  try {
    workflow.run(p, 'generate', 'Build this'); await paused.promise; await new Promise(resolve => setTimeout(resolve, 240));
    const second = workflow.getGeneration(p.id)!;
    assert.equal(second.attempt, 2); assert.notEqual(second.runId, first.runId); assert.ok(second.sequence > first.sequence);
    assert.deepEqual(second.files, { 'contract.compact': 'repa' });
    assert.deepEqual(p.files, initial.files, 'second attempt cannot replace editable source while incomplete');
    release.resolve(); await settled(workflow, p.id);
    assert.equal(workflow.getGeneration(p.id)!.status, 'complete'); assert.deepEqual(workflow.getGeneration(p.id)!.files, repaired.files);
  } finally { release.resolve(); await settled(workflow, p.id); registry.close(); }
});

test('network failure flushes retained partials immediately and never compiles or replaces editable files', async () => {
  const registry = new Registry(':memory:'); const p = project(); registry.save(p); const before = structuredClone(p.files); let attempts = 0;
  const workflow = new Workflow(registry, {
    generate: async (_project, _prompt, log, files) => { attempts++; return readGenerationStream((async function* () { yield '{"files":{"src/App.tsx":"actual incomplete source'; throw new Error('Network connection failed'); })(), log, files); },
    compile: async () => { throw new Error('Incomplete sources reached compiler'); },
  });
  try {
    workflow.run(p, 'generate', 'Build this'); await settled(workflow, p.id);
    assert.equal(attempts, 1); assert.deepEqual(registry.get(p.id)!.files, before);
    const failed = workflow.getGeneration(p.id)!;
    assert.equal(failed.status, 'failed'); assert.equal(failed.files['src/App.tsx'], 'actual incomplete source');
    assert.match(failed.error!, /Network connection failed/);
    assert.deepEqual(new Workflow(registry).getGeneration(p.id), failed);
  } finally { registry.close(); }
});

test('restart recovery retains checkpointed partial text and terminates its streaming status', () => {
  const registry = new Registry(':memory:'); const p = project();
  p.status = 'generating'; p.generation = { runId: 'interrupted', sequence: 8, attempt: 1, status: 'streaming', files: { 'src/App.tsx': 'checkpointed source' }, completedFiles: [], activeFile: 'src/App.tsx', updatedAt: p.updatedAt };
  registry.save(p); registry.begin(p.id, 'generate');
  try {
    registry.recover(); const resumed = new Workflow(registry).getGeneration(p.id)!;
    assert.equal(resumed.status, 'failed'); assert.equal(resumed.sequence, 9); assert.equal(resumed.files['src/App.tsx'], 'checkpointed source');
    assert.match(resumed.error!, /restarted/); assert.deepEqual(registry.get(p.id)!.files, p.files);
  } finally { registry.close(); }
});

test('provider progress checkpoints the latest pending text before writing a lifecycle log', async () => {
  const registry = new Registry(':memory:'); const p = project(); registry.save(p);
  const paused = deferred(); const release = deferred();
  const partial = 'checkpoint '.repeat(220);
  const workflow = new Workflow(registry, {
    generate: async (_project, _prompt, log, files) => readGenerationStream((async function* () {
      yield `{"files":{"src/App.tsx":"${partial}`; paused.resolve(); await release.promise;
      throw new Error('Request cancelled');
    })(), log, files),
  });
  try {
    workflow.run(p, 'generate', 'Build this'); await paused.promise;
    assert.equal(registry.get(p.id)!.generation!.files['src/App.tsx'], partial);
    assert.equal(registry.get(p.id)!.generation!.status, 'streaming');
    assert.deepEqual(registry.get(p.id)!.files, project().files);
    release.resolve(); await settled(workflow, p.id);
    assert.equal(workflow.getGeneration(p.id)!.status, 'failed');
    assert.equal(workflow.getGeneration(p.id)!.attempt, 1, 'cancellation must not start repair attempts');
  } finally { release.resolve(); await settled(workflow, p.id); registry.close(); }
});

test('invalid asset metadata retains complete draft files for repair without publishing them', async () => {
  const { GenerationValidationError } = await import('../service/validation.js');
  const registry = new Registry(':memory:'); const p = project(); registry.save(p);
  const original = structuredClone(p.files);
  const files = { 'contract.compact': 'complete draft', 'src/App.tsx': 'draft UI', 'src/styles.css': '' };
  let calls = 0;
  const workflow = new Workflow(registry, {
    generate: async candidate => {
      if (++calls === 1) throw new GenerationValidationError('Invalid asset ratio.', files);
      assert.deepEqual(candidate.files, files);
      assert.deepEqual(registry.get(p.id)!.files, original);
      return { name: 'Repaired', description: '', files };
    }, compile: async value => { value.status = 'ready'; }, autoPublish: false,
  });
  try { workflow.run(p, 'generate', 'Build'); await settled(workflow, p.id); assert.equal(calls, 2); assert.deepEqual(registry.get(p.id)!.files, files); }
  finally { registry.close(); }
});
test('provider failure never triggers paid code-repair requests', async () => {
  const { ModelServiceError } = await import('../service/model-stream.js');
  const registry = new Registry(':memory:'); const p = project(); registry.save(p); let calls = 0;
  const workflow = new Workflow(registry, { generate: async () => { calls++; throw new ModelServiceError('Provider unavailable'); }, autoPublish: false });
  try { workflow.run(p, 'generate', 'Build'); await settled(workflow, p.id); assert.equal(calls, 1); assert.equal(p.status, 'failed'); }
  finally { registry.close(); }
});

test('unsupported essential features stop without generating a substitute or publishing', async () => {
  const { parseGeneration } = await import('../service/validation.js');
  const registry = new Registry(':memory:'); const p = project(); registry.save(p); const before = structuredClone(p.files); let calls = 0;
  const workflow = new Workflow(registry, {
    generate: async () => { calls++; return parseGeneration('{"unsupported":"On-chain identity ownership is required and unavailable in this runtime."}'); },
    compile: async () => { throw new Error('A substitute must not compile'); }, autoPublish: true,
  });
  try {
    workflow.run(p, 'generate', 'An owner-restricted wallet'); await settled(workflow, p.id);
    assert.equal(calls, 1); assert.equal(p.status, 'failed'); assert.deepEqual(p.files, before); assert.equal(p.deployments.length, 0);
    assert.match(p.error!, /identity ownership/);
  } finally { registry.close(); }
});
