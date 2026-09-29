import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Registry } from '../service/registry.js';
import { Workflow } from '../service/workflow.js';
import { bundleApp, runtimeDocument, sandboxDocument } from '../service/bundle.js';
import { parseGeneration, promptText, validateFiles } from '../service/validation.js';
import type { Project } from '../shared/types.js';

function project(id = '11111111-1111-4111-a111-111111111111'): Project {
  return { id, name: 'Counter', description: 'A public counter', model: 'test/model', status: 'ready', revision: 1,
    files: { 'contract.compact': 'source-v1', 'src/App.tsx': 'export default function App() { return <p>Counter</p> }', 'src/styles.css': 'body { margin: 0 }' },
    messages: [], logs: [], build: { id: 'build-v1', revision: 1, sourceHash: 'hash-v1', compilerVersion: '0.34.0', circuits: ['increment'], createdAt: '2026-09-14T12:00:00Z' }, deployments: [], createdAt: '2026-09-14T12:00:00Z', updatedAt: '2026-09-14T12:00:00Z' };
}

test('persistent recovery preserves uncertain deployments and prevents another attempt', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'passport-registry-test-'));
  const file = join(folder, 'registry.sqlite');
  let registry = new Registry(file);
  try {
    const p = project();
    p.status = 'deploying';
    p.deployments.push({ id: 'deployment-1', buildId: 'build-v1', status: 'deploying', txId: 'node-identifier', contractAddress: 'ab'.repeat(32), createdAt: p.createdAt });
    registry.save(p); registry.begin(p.id, 'deploy'); registry.close();
    registry = new Registry(file); registry.recover();
    const recovered = registry.get(p.id)!;
    assert.equal(recovered.status, 'submitted');
    assert.equal(recovered.deployments[0].status, 'unknown');
    assert.equal(recovered.deployments[0].txId, 'node-identifier');
    assert.throws(() => new Workflow(registry).run(recovered, 'deploy'), /reconciled/);
    // Recovery is idempotent and never creates a second deployment.
    registry.recover(); assert.equal(registry.get(p.id)!.deployments.length, 1);
  } finally { registry.close(); await rm(folder, { recursive: true, force: true }); }
});

test('a stopped compilation can be retried and draft edits retain the published build', () => {
  const registry = new Registry(':memory:');
  try {
    const p = project();
    p.deployments.push({ id: 'published', buildId: 'build-v1', status: 'deployed', createdAt: p.createdAt });
    registry.save(p); registry.snapshot(p);
    registry.begin(p.id, 'compile'); registry.recover();
    const recovered = registry.get(p.id)!;
    assert.equal(recovered.status, 'failed');
    recovered.files['contract.compact'] = 'source-v2'; recovered.revision = 2; recovered.build = undefined; registry.save(recovered);
    assert.equal(registry.revision(p.id, 1)!.files['contract.compact'], 'source-v1');
    assert.equal(registry.get(p.id)!.deployments[0].buildId, 'build-v1');
    assert.equal(typeof registry.begin(p.id, 'compile'), 'string');
  } finally { registry.close(); }
});

test('deployment cannot be repeated for a recorded, accepted, or confirmed build', () => {
  const registry = new Registry(':memory:');
  try {
    for (const status of ['deploying', 'submitted', 'deployed', 'unknown'] as const) {
      const p = project(status); p.deployments.push({ id: 'existing', buildId: 'build-v1', status, createdAt: p.createdAt }); registry.save(p);
      assert.throws(() => new Workflow(registry).run(p, 'deploy'), /reconciled/);
    }
    const p = project('uncompiled'); p.build = undefined;
    assert.throws(() => new Workflow(registry).run(p, 'deploy'), /Compile this revision/);
  } finally { registry.close(); }
});

test('model output cannot add executable service files or override the project identity', () => {
  const p = project();
  assert.throws(() => validateFiles({ ...p.files, 'package.json': '{}' }), /Only contract/);
  assert.throws(() => validateFiles({ ...p.files, '../server.ts': 'danger' }), /Only contract/);
  assert.throws(() => validateFiles({ ...p.files, 'src/App.tsx': 'x'.repeat(100_001) }), /oversized/);
  assert.throws(() => validateFiles({ ...p.files, 'contract.compact': ' ' }), /must not be empty/);
  assert.throws(() => promptText('  '), /Describe your app/);
  assert.throws(() => parseGeneration('not JSON'));
  const generated = parseGeneration(JSON.stringify({ id: 'attacker', name: 'Name', description: 'Description', files: p.files }));
  assert.equal('id' in generated, false);
});

test('bundler only accepts maintained imports, including for dynamic and require forms', async () => {
  const files = project().files;
  const valid = await bundleApp({ ...files, 'src/App.tsx': "import { usePassport } from '@midnight-passport/app'; export default function App() { const p = usePassport(); return <p>{p.network}</p> }" });
  assert.ok(valid.includes('passport-builder:app'));
  for (const source of [
    "import fs from 'node:fs'; export default function App() { return <p>{fs}</p> }",
    "import './another-file'; export default function App() { return null }",
    "import 'https://evil.example/code.js'; export default function App() { return null }",
    "export default function App() { import('node:child_process'); return null }",
    "const x = require('node:fs'); export default function App() { return <p>{x}</p> }",
  ]) await assert.rejects(bundleApp({ ...files, 'src/App.tsx': source }), /may not import/);
});

test('generated script, style, and names cannot escape the opaque frame', async () => {
  const hostile = '</script><script>parent.compromised=true</script>';
  const inner = sandboxDocument(`console.log(${JSON.stringify(hostile)})`, '</style><script>parent.compromised=true</script>', 'https://host.example');
  // In HTML raw-text elements, the closing delimiter ends the element. Opening
  // tag text inside JS strings or CSS is harmless until a closing delimiter.
  const styleText = inner.slice(inner.indexOf('<style>') + 7, inner.indexOf('</style>'));
  const scriptText = inner.slice(inner.indexOf('<script>', inner.indexOf('</style>')), inner.lastIndexOf('</script>'));
  assert.equal(styleText.includes('</style'), false);
  assert.equal(scriptText.includes('</script'), false);
  assert.ok(inner.includes("connect-src 'none'"));
  assert.ok(inner.includes("form-action 'none'"));
  assert.ok(inner.includes('writable:false,configurable:false'));
  const outer = runtimeDocument({ id: 'app-id', name: hostile, passportOrigin: 'https://passport.example', app: inner, circuits: ['increment'] });
  assert.ok(outer.includes('sandbox="allow-scripts allow-forms"'));
  assert.equal(outer.includes('allow-same-origin'), false);
  assert.equal(outer.includes('<script>parent.compromised'), false);
  assert.ok(outer.includes('\\u003c'));
  const workspace = await readFile(new URL('../src/components/ProjectWorkspace.tsx', import.meta.url), 'utf8');
  assert.ok(workspace.includes('sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"'));
  // Match the installed SDK lifecycle and transport options, not an invented API.
  const host = await readFile(new URL('../runtime/host.ts', import.meta.url), 'utf8');
  assert.ok(host.includes("transport: 'popup'"));
  assert.ok(host.includes('passport.destroy()'));
});

test('per-owner listings do not disappear behind other users recent projects', () => {
  const registry = new Registry(':memory:');
  try {
    const owned = project('owned'); owned.ownerSubject = 'alice'; registry.save(owned);
    for (let n = 0; n < 101; n++) { const other = project(`other-${n}`); other.ownerSubject = 'bob'; registry.save(other); }
    assert.deepEqual(registry.list('alice').map(p => p.id), ['owned']);
    assert.equal(registry.list('bob').length, 100);
  } finally { registry.close(); }
});

test('daily allowances include interrupted attempts and operation concurrency is durable', async () => {
  const previous = process.env.BUILDER_USER_BUILDS_PER_DAY; process.env.BUILDER_USER_BUILDS_PER_DAY = '1';
  const directory = await mkdtemp(join(tmpdir(), 'passport-quota-')); const file = join(directory, 'registry.sqlite');
  let registry = new Registry(file);
  try {
    const p = project('a'); p.ownerSubject = 'alice'; registry.save(p); registry.begin('a', 'generate'); registry.close();
    registry = new Registry(file); registry.recover();
    assert.throws(() => registry.begin('a', 'generate'), /daily build allowance/);
    const b = project('b'); b.ownerSubject = 'bob'; registry.save(b);
    const c = project('c'); c.ownerSubject = 'carol'; registry.save(c);
    registry.begin('b', 'generate'); registry.begin('c', 'generate');
    const secondProcess = new Registry(file);
    try { assert.throws(() => secondProcess.begin('a', 'compile'), /Two builds/); }
    finally { secondProcess.close(); }
  } finally {
    registry.close(); previous === undefined ? delete process.env.BUILDER_USER_BUILDS_PER_DAY : process.env.BUILDER_USER_BUILDS_PER_DAY = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
