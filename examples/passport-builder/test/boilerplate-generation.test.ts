import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { BOILERPLATE_INSTRUCTIONS, boilerplateFiles } from '../service/boilerplate.js';
import { parseGeneration } from '../service/validation.js';
import { readGenerationStream } from '../service/generation.js';
import { Registry } from '../service/registry.js';
import { Workflow } from '../service/workflow.js';
import { bundleApp } from '../service/bundle.js';
import type { Project, ProjectFiles } from '../shared/types.js';

const metadata = { name: 'Reading shelf', description: 'Public shared titles and short notes.' };
const previous: ProjectFiles = Object.freeze({ 'contract.compact': 'exact old contract\n', 'src/App.tsx': 'export default function App() { return <p>Old app</p> }\n', 'src/styles.css': '/* deliberate custom style */\nbody{background:#fae} ' });
const write = (files: unknown, extra = {}) => JSON.stringify({ ...metadata, ...extra, files });
async function* characters(text: string) { for (const char of text) yield char; }
async function settled(workflow: Workflow, id: string) {
  for (let attempt = 0; attempt < 300 && workflow.active.has(id); attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(workflow.active.has(id), false);
}
function project(files: ProjectFiles): Project {
  return { id: 'boilerplate-test', ...metadata, files, model: 'test/model', status: 'draft', revision: Object.keys(files).length ? 1 : 0, messages: [], logs: [], deployments: [], createdAt: '2026-09-14T00:00:00Z', updatedAt: '2026-09-14T00:00:00Z' };
}

test('an explicit CRUD base expands the exact verified source and a complete maintained UI', async () => {
  let selected = ''; let counts: unknown;
  const result = parseGeneration(write({}, { base: 'crud' }), { onBoilerplate: base => { selected = base; }, onResolvedFiles: value => { counts = value; } });
  assert.equal(selected, 'crud'); assert.deepEqual(Object.keys(result.files).sort(), ['contract.compact', 'src/App.tsx', 'src/styles.css']);
  assert.equal(result.files['contract.compact'], await readFile(new URL('../service/patterns/crud-records.compact', import.meta.url), 'utf8'));
  assert.match(result.files['src/App.tsx'], /import \{ CrudApp \}/); assert.match(result.files['src/App.tsx'], /Reading shelf/);
  assert.equal(result.files['src/styles.css'], ''); assert.deepEqual(counts, { supplied: 0, reused: 0, expanded: 3, defaulted: 0 });
  const other = boilerplateFiles('crud', metadata); other['contract.compact'] = 'changed';
  assert.notEqual(boilerplateFiles('crud', metadata)['contract.compact'], 'changed', 'one app cannot mutate another app’s base');
  const example = BOILERPLATE_INSTRUCTIONS.split('A suitable response can be ')[1].split('. Omit unchanged')[0];
  assert.match(parseGeneration(example).files['src/App.tsx'], /labelName="Title"/);
  await bundleApp(result.files);
});

test('fresh custom apps never inherit CRUD implicitly and can omit shared-style CSS', () => {
  let counts: unknown;
  const files = { 'contract.compact': 'custom workflow', 'src/App.tsx': 'custom workflow UI' };
  assert.deepEqual(parseGeneration(write(files), { onResolvedFiles: value => { counts = value; } }).files, { ...files, 'src/styles.css': '' });
  assert.deepEqual(counts, { supplied: 2, reused: 0, expanded: 0, defaulted: 1 });
  for (const incomplete of [{}, { 'src/App.tsx': 'UI without a contract' }, { 'contract.compact': 'contract without UI' }]) assert.throws(() => parseGeneration(write(incomplete)), /Missing/);
  for (const base of ['counter', 'unknown', null, {}, true]) assert.throws(() => parseGeneration(write({}, { base })), /boilerplate/);
});

test('changed-file edits preserve exact omitted sources and cannot replace the existing app with a base', () => {
  const copy = structuredClone(previous); let counts: unknown;
  const app = 'export default function App() { return <p>Changed app</p> }';
  const result = parseGeneration(write({ 'src/App.tsx': app }), { previousFiles: previous, onResolvedFiles: value => { counts = value; } });
  assert.deepEqual(result.files, { ...previous, 'src/App.tsx': app }); assert.deepEqual(previous, copy);
  assert.notEqual(result.files, previous); assert.deepEqual(counts, { supplied: 1, reused: 2, expanded: 0, defaulted: 0 });
  assert.deepEqual(parseGeneration(write({}), { previousFiles: previous }).files, previous);
  assert.equal(parseGeneration(write({ 'src/styles.css': '' }), { previousFiles: previous }).files['src/styles.css'], '');
  assert.throws(() => parseGeneration(write({}, { base: 'crud' }), { previousFiles: previous }), /new application/);
});

test('file deltas keep the strict allowlist and cannot hide invalid values behind inheritance', () => {
  for (const files of [
    null, [], { '../server.ts': 'code' }, { 'package.json': '{}' }, { 'src/App.tsx': null },
    { 'contract.compact': '' }, { 'src/App.tsx': '  ' }, { 'src/styles.css': 1 }, { 'src/App.tsx': 'x'.repeat(100_001) },
    JSON.parse('{"__proto__":"hidden"}'),
  ]) {
    let notified = false;
    assert.throws(() => parseGeneration(write(files, { base: 'crud' }), { onBoilerplate: () => { notified = true; } }));
    assert.equal(notified, false, 'only a fully validated expansion announces its base');
    assert.throws(() => parseGeneration(write(files), { previousFiles: previous }));
  }
  for (const text of ['null', '[]', '"string"']) assert.throws(() => parseGeneration(text), /application object/);
});

test('duplicate JSON keys use only the last delta object before base or prior-source expansion', () => {
  const text = '{"name":"Edited","description":"","files":{"src/App.tsx":"discard me"},"files":{"src/styles.css":"new css"}}';
  assert.deepEqual(parseGeneration(text, { previousFiles: previous }).files, { ...previous, 'src/styles.css': 'new css' });
  const baseText = '{"name":"New","description":"","base":"wrong","base":"crud","files":{"src/App.tsx":"discard me"},"files":{}}';
  assert.deepEqual(parseGeneration(baseText).files, boilerplateFiles('crud', { name: 'New', description: '' }));
  assert.throws(() => parseGeneration(baseText.replace('"base":"wrong","base":"crud"', '"base":"crud","base":"wrong"')), /boilerplate/);
});

test('streams expose only the actual response delta and report exact UTF-8 response bytes and reused files', async () => {
  const text = write({ 'src/App.tsx': 'export default function App(){return <p>🚀 revised</p>}' });
  const snapshots: ProjectFiles[] = []; const messages: string[] = [];
  const result = await readGenerationStream(characters(text), message => messages.push(message), snapshot => snapshots.push(snapshot.files), { previousFiles: previous });
  assert.ok(snapshots.some(files => files['src/App.tsx']?.includes('🚀')));
  assert.equal(snapshots.some(files => 'contract.compact' in files || 'src/styles.css' in files), false);
  assert.equal(result.files['contract.compact'], previous['contract.compact']); assert.equal(result.files['src/styles.css'], previous['src/styles.css']);
  assert.match(messages.at(-1)!, new RegExp(`Model response: ${Buffer.byteLength(text, 'utf8')} bytes; supplied 1 file, reused 2 unchanged files`));
  const expanded: string[] = [];
  await readGenerationStream(characters(write({}, { base: 'crud' })), message => expanded.push(message), snapshot => assert.deepEqual(snapshot.files, {}), { onBoilerplate: () => expanded.push('Using CRUD boilerplate') });
  assert.equal(expanded[0], 'Using CRUD boilerplate'); assert.match(expanded.at(-1)!, /supplied 0 files, expanded 3 boilerplate files/);
});

test('malformed or interrupted delta responses retain partial display without changing previous sources', async () => {
  const before = structuredClone(previous); let latest: ProjectFiles = {};
  await assert.rejects(readGenerationStream(characters('{"name":"Broken","description":"","base":"crud","files":{"src/App.tsx":"actual partial'), undefined, snapshot => { latest = snapshot.files; }, { previousFiles: previous }));
  assert.deepEqual(latest, { 'src/App.tsx': 'actual partial' }); assert.deepEqual(previous, before);
});

test('workflow expands a new base only at validated completion, then repairs using changed files', async () => {
  const registry = new Registry(':memory:'); const value = project({}); registry.save(value);
  const first = write({ 'src/App.tsx': 'first custom App' }, { base: 'crud' });
  const repaired = write({ 'src/App.tsx': 'repaired custom App' });
  let generations = 0; let compiles = 0; let firstContract = '';
  const workflow: Workflow = new Workflow(registry, { autoPublish: false,
    generate: async (current, instruction, progress, files) => {
      generations++; if (generations === 2) { assert.match(instruction, /only for files you change/); assert.match(instruction, /Do not select a new base/); }
      return readGenerationStream(characters(generations === 1 ? first : repaired), progress, snapshot => {
        assert.equal('contract.compact' in snapshot.files, false); assert.equal('src/styles.css' in snapshot.files, false);
        files?.(snapshot);
      }, { previousFiles: current.files, onBoilerplate: () => progress('Using CRUD boilerplate') });
    },
    compile: async current => {
      compiles++;
      assert.deepEqual(workflow.getGeneration(current.id)!.files, current.files, 'completion contains all inherited files before compile');
      assert.equal(current.files['src/styles.css'], '');
      if (compiles === 1) { firstContract = current.files['contract.compact']; throw new Error('Fix the React source'); }
      assert.equal(current.files['contract.compact'], firstContract); assert.equal(current.files['src/App.tsx'], 'repaired custom App'); current.status = 'ready';
    },
  });
  try {
    workflow.run(value, 'generate', 'Make a reading shelf'); await settled(workflow, value.id);
    assert.equal(generations, 2); assert.equal(compiles, 2); assert.equal(value.status, 'ready');
    assert.equal(value.logs.filter(log => log.message === 'Using CRUD boilerplate').length, 1);
    assert.deepEqual(workflow.getGeneration(value.id)!.files, value.files); assert.equal(workflow.getGeneration(value.id)!.status, 'complete');
  } finally { registry.close(); }
});
