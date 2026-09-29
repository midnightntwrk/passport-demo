import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { Registry } from '../service/registry.js';
import { Workflow } from '../service/workflow.js';
import type { BuildManifest } from '../service/compact.js';
import type { DeploymentResult } from '../service/chain.js';
import type { Project } from '../shared/types.js';

const now = '2026-09-14T18:00:00.000Z';
function project(): Project {
  return { id: 'publish-test', name: 'Task board', description: 'Tasks with a lifecycle', model: 'test/model', status: 'draft', revision: 1,
    files: { 'contract.compact': 'contract source', 'src/App.tsx': 'app source', 'src/styles.css': 'app css' }, messages: [], logs: [], deployments: [], createdAt: now, updatedAt: now };
}
const manifest: BuildManifest = { compilerVersion: '0.34.0', sourceHash: 'source-hash', circuits: ['createTask'], circuitDetails: [], artefacts: { 'keys/createTask.verifier': 'verified-key' } };
const confirmed: DeploymentResult = { network: 'stagenet', contractAddress: 'ab'.repeat(32), txId: 'saved-transaction', txHash: 'hash', status: 'confirmed', blockHeight: 123 };
const generated = { name: 'Task board', description: 'Generated tasks', files: project().files };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 300 && !condition(); attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(condition(), 'workflow reached the expected state');
}
async function fixture() {
  const registry = new Registry(':memory:'); const value = project(); registry.save(value);
  const directory = await mkdtemp(join(tmpdir(), 'passport-publish-test-'));
  return { registry, value, directory, async close() { registry.close(); await rm(directory, { recursive: true, force: true }); } };
}
const compile = async (value: Project) => {
  value.build = { id: 'new-build', revision: value.revision, sourceHash: manifest.sourceHash, compilerVersion: manifest.compilerVersion, circuits: manifest.circuits, createdAt: now };
  value.status = 'ready';
};

test('bundle and Compact run concurrently; publish waits for both and then verifies the indexed ledger', async () => {
  const f = await fixture(); const bundleGate = deferred(); const compactGate = deferred(); const manifestGate = deferred(); const ledgerGate = deferred();
  let bundleStarted = false; let compactStarted = false; let manifestStarted = false; let deployments = 0; let queries = 0;
  const workflow = new Workflow(f.registry, {
    autoPublish: true, buildsDirectory: f.directory,
    bundle: async () => { bundleStarted = true; await bundleGate.promise; return 'compiled application'; },
    compileContract: async () => { compactStarted = true; await compactGate.promise; return manifest; },
    readBuildManifest: async () => { manifestStarted = true; await manifestGate.promise; return manifest; }, readJournal: async () => undefined,
    deploy: async () => { deployments++; return confirmed; },
    readState: async () => { queries++; await ledgerGate.promise; return { tasks: { entries: [], size: '0', truncated: false } }; },
  });
  try {
    workflow.run(f.value, 'compile'); await waitFor(() => bundleStarted && compactStarted);
    assert.equal(deployments, 0); bundleGate.resolve(); await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(deployments, 0); assert.equal(f.value.build, undefined);
    compactGate.resolve(); await waitFor(() => manifestStarted);
    assert.equal(f.value.status, 'deploying'); assert.equal(f.registry.get(f.value.id)!.status, 'deploying');
    assert.equal(deployments, 0, 'manifest verification keeps the workflow visibly busy');
    manifestGate.resolve(); await waitFor(() => queries === 1);
    assert.equal(deployments, 1); assert.equal(f.value.status, 'deploying');
    assert.equal(f.registry.get(f.value.id)!.deployments[0].status, 'deployed', 'confirmation is durable before query readiness');
    ledgerGate.resolve(); await waitFor(() => !workflow.active.has(f.value.id));
    assert.equal(f.value.status, 'deployed');
    assert.equal(await readFile(join(f.directory, f.value.build!.id, 'app.js'), 'utf8'), 'compiled application');
    assert.equal(JSON.parse(await readFile(join(f.directory, f.value.build!.id, 'app-metadata.json'), 'utf8')).name, f.value.name);
  } finally { bundleGate.resolve(); compactGate.resolve(); manifestGate.resolve(); ledgerGate.resolve(); await waitFor(() => !workflow.active.has(f.value.id)); await f.close(); }
});

test('either build failure waits for the other branch and never publishes partial output', async () => {
  for (const failed of ['bundle', 'compact']) {
    const f = await fixture(); const other = deferred(); let deployments = 0; let started = false;
    const workflow = new Workflow(f.registry, { autoPublish: true, buildsDirectory: f.directory,
      bundle: async () => { if (failed === 'bundle') throw new Error('React import rejected'); started = true; await other.promise; return 'app'; },
      compileContract: async () => { if (failed === 'compact') throw new Error('Compact syntax rejected'); started = true; await other.promise; return manifest; },
      deploy: async () => { deployments++; return confirmed; },
    });
    try {
      workflow.run(f.value, 'compile'); await waitFor(() => started);
      await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(workflow.active.has(f.value.id), true);
      other.resolve(); await waitFor(() => !workflow.active.has(f.value.id));
      assert.equal(f.value.status, 'failed'); assert.equal(f.value.build, undefined); assert.equal(deployments, 0); assert.deepEqual(f.value.deployments, []);
    } finally { other.resolve(); await waitFor(() => !workflow.active.has(f.value.id)); await f.close(); }
  }
});

test('deployment failures never regenerate code and reconcile the same recorded transaction', async () => {
  const f = await fixture(); let generations = 0; let deployments = 0; let journal: DeploymentResult | undefined; const directories: string[] = [];
  const workflow = new Workflow(f.registry, { autoPublish: true, buildsDirectory: f.directory,
    generate: async () => { generations++; return generated; }, compile,
    readBuildManifest: async () => manifest, readJournal: async () => journal,
    deploy: async ({ buildDir, onSubmitted }) => {
      deployments++; directories.push(buildDir); journal = confirmed;
      if (deployments === 1) { await onSubmitted?.(confirmed); throw new Error('Node disconnected after recording the transaction'); }
      return confirmed;
    }, readState: async () => ({ tasks: {} }),
  });
  try {
    workflow.run(f.value, 'generate', 'Build a task board'); await waitFor(() => !workflow.active.has(f.value.id));
    assert.equal(generations, 1); assert.equal(deployments, 1); assert.equal(f.value.status, 'submitted');
    assert.equal(f.value.generation!.status, 'complete'); assert.equal(f.value.deployments[0].status, 'unknown');
    const id = f.value.deployments[0].id;
    for (const action of ['generate', 'compile', 'deploy'] as const) assert.throws(() => workflow.run(f.value, action), /reconciled/);
    workflow.run(f.value, 'reconcile'); await waitFor(() => !workflow.active.has(f.value.id));
    assert.equal(generations, 1); assert.equal(f.value.deployments.length, 1); assert.equal(f.value.deployments[0].id, id);
    assert.equal(f.value.status, 'deployed'); assert.equal(directories[0], directories[1]);
  } finally { await f.close(); }
});

test('a persisted worker journal survives an error before its registry callback arrives', async () => {
  const f = await fixture(); let journal: DeploymentResult | undefined; let generations = 0;
  const workflow = new Workflow(f.registry, { autoPublish: true, buildsDirectory: f.directory,
    generate: async () => { generations++; return generated; }, compile, readBuildManifest: async () => manifest,
    readJournal: async () => journal, deploy: async () => { journal = confirmed; throw new Error('Worker exited before IPC delivery'); },
  });
  try {
    workflow.run(f.value, 'generate', 'Build this'); await waitFor(() => !workflow.active.has(f.value.id));
    assert.equal(generations, 1); assert.equal(f.value.status, 'submitted');
    assert.equal(f.registry.get(f.value.id)!.deployments[0].txId, confirmed.txId);
    assert.equal(f.value.deployments[0].status, 'unknown');
  } finally { await f.close(); }
});

test('confirmed deployment with an unavailable ledger retries readiness without deploying again', async () => {
  const f = await fixture(); let deployments = 0; let queries = 0;
  const workflow = new Workflow(f.registry, { autoPublish: true, buildsDirectory: f.directory, compile,
    readBuildManifest: async () => manifest, readJournal: async () => undefined,
    deploy: async () => { deployments++; return confirmed; },
    readState: async () => { queries++; if (queries === 1) throw new Error('Indexer is catching up'); return { tasks: {} }; },
  });
  try {
    workflow.run(f.value, 'compile'); await waitFor(() => !workflow.active.has(f.value.id));
    assert.equal(f.value.status, 'submitted'); assert.equal(f.value.deployments[0].status, 'deployed'); assert.match(f.value.error!, /Contract confirmed.*not ready/);
    workflow.run(f.value, 'reconcile'); await waitFor(() => !workflow.active.has(f.value.id));
    assert.equal(deployments, 1); assert.equal(queries, 2); assert.equal(f.value.status, 'deployed'); assert.equal(f.value.error, undefined);
  } finally { await f.close(); }
});

test('frontend-only publication reuses the verified contract and preserves old published build URLs', async () => {
  const f = await fixture(); const previous = { id: 'old-publication', buildId: 'old-build', status: 'deployed' as const, contractAddress: confirmed.contractAddress, txId: confirmed.txId, appUrl: '/apps/publish-test?deployment=old-publication', createdAt: now };
  f.value.deployments.push(previous); const original = structuredClone(previous); let deployments = 0; let readDirectory = '';
  const workflow = new Workflow(f.registry, { autoPublish: true, buildsDirectory: f.directory, compile,
    readBuildManifest: async () => manifest,
    deploy: async () => { deployments++; return confirmed; },
    readState: async ({ buildDir, contractAddress }) => { readDirectory = buildDir; assert.equal(contractAddress, previous.contractAddress); return { tasks: { size: '47' } }; },
  });
  try {
    workflow.run(f.value, 'compile'); await waitFor(() => !workflow.active.has(f.value.id));
    assert.equal(deployments, 0); assert.equal(f.value.status, 'deployed'); assert.equal(f.value.deployments.length, 2);
    assert.deepEqual(f.value.deployments[0], original);
    const published = f.value.deployments[1]; assert.equal(published.buildId, 'new-build'); assert.equal(published.contractAddress, original.contractAddress);
    assert.notEqual(published.appUrl, original.appUrl); assert.equal(basename(readDirectory), 'new-build');
  } finally { await f.close(); }
});

test('unchanged source with different verifier keys stops rather than resetting contract data', async () => {
  const f = await fixture(); f.value.deployments.push({ id: 'old', buildId: 'old-build', status: 'deployed', contractAddress: confirmed.contractAddress, createdAt: now }); let deployments = 0;
  const workflow = new Workflow(f.registry, { autoPublish: true, buildsDirectory: f.directory, compile,
    readBuildManifest: async directory => basename(directory) === 'old-build' ? { ...manifest, artefacts: { 'keys/createTask.verifier': 'old-key' } } : manifest,
    deploy: async () => { deployments++; return confirmed; },
  });
  try {
    workflow.run(f.value, 'compile'); await waitFor(() => !workflow.active.has(f.value.id));
    assert.equal(f.value.status, 'failed'); assert.match(f.value.error!, /different verification keys/); assert.equal(deployments, 0); assert.equal(f.value.deployments.length, 1);
  } finally { await f.close(); }
});

test('a changed contract gets its own deployment while the previous publication remains intact', async () => {
  const f = await fixture(); const previous = { id: 'old', buildId: 'old-build', status: 'deployed' as const, contractAddress: 'cd'.repeat(32), txId: 'old-transaction', createdAt: now };
  f.value.deployments.push(previous); const original = structuredClone(previous); let deployments = 0;
  const workflow = new Workflow(f.registry, { autoPublish: true, buildsDirectory: f.directory, compile,
    readBuildManifest: async directory => basename(directory) === 'old-build' ? { ...manifest, sourceHash: 'different-old-source' } : manifest,
    readJournal: async () => undefined, deploy: async () => { deployments++; return confirmed; }, readState: async () => ({ tasks: {} }),
  });
  try {
    workflow.run(f.value, 'compile'); await waitFor(() => !workflow.active.has(f.value.id));
    assert.equal(f.value.status, 'deployed'); assert.equal(deployments, 1); assert.deepEqual(f.value.deployments[0], original);
    assert.equal(f.value.deployments[1].contractAddress, confirmed.contractAddress);
  } finally { await f.close(); }
});

test('a repaired build publishes once and a sponsorship failure cannot start another repair attempt', async () => {
  const f = await fixture(); let generations = 0; let compiles = 0; let deployments = 0;
  const workflow = new Workflow(f.registry, { autoPublish: true, buildsDirectory: f.directory,
    generate: async () => { generations++; return generated; },
    compile: async value => { compiles++; if (compiles === 1) throw new Error('Compact syntax rejected'); await compile(value); },
    readBuildManifest: async () => manifest, readJournal: async () => undefined,
    deploy: async () => { deployments++; throw new Error('Sponsor unavailable before transaction preparation'); },
  });
  try {
    workflow.run(f.value, 'generate', 'Build a task board'); await waitFor(() => !workflow.active.has(f.value.id));
    assert.equal(generations, 2); assert.equal(compiles, 2); assert.equal(deployments, 1);
    assert.equal(f.value.generation!.status, 'complete'); assert.equal(f.value.generation!.attempt, 2);
    assert.equal(f.value.build!.id, 'new-build'); assert.equal(f.value.deployments[0].status, 'failed'); assert.equal(f.value.status, 'failed');
  } finally { await f.close(); }
});

test('recovery detects publishing inside generate/compile and protects a missing transaction journal', async () => {
  for (const kind of ['generate', 'compile']) {
    const f = await fixture(); await compile(f.value); f.value.status = 'deploying';
    f.value.deployments.push({ id: 'recorded', buildId: 'new-build', status: 'deploying', txId: confirmed.txId, contractAddress: confirmed.contractAddress, createdAt: now });
    f.registry.save(f.value); f.registry.begin(f.value.id, kind); f.registry.recover();
    const recovered = f.registry.get(f.value.id)!; let calls = 0;
    const workflow = new Workflow(f.registry, { autoPublish: true, readJournal: async () => undefined, deploy: async () => { calls++; return confirmed; } });
    try {
      assert.equal(recovered.status, 'submitted'); assert.equal(recovered.deployments[0].status, 'unknown');
      workflow.run(recovered, 'reconcile'); await waitFor(() => !workflow.active.has(recovered.id));
      assert.equal(calls, 0); assert.equal(recovered.status, 'submitted'); assert.match(recovered.error!, /journal is missing/);
      assert.equal(recovered.deployments.length, 1); assert.throws(() => workflow.run(recovered, 'compile'), /reconciled/);
    } finally { await f.close(); }
  }
});

test('readiness interrupted after confirmation recovers and never re-enters contract deployment', async () => {
  const f = await fixture(); await compile(f.value); f.value.status = 'deploying';
  f.value.deployments.push({ id: 'confirmed', buildId: 'new-build', status: 'deployed', txId: confirmed.txId, contractAddress: confirmed.contractAddress, createdAt: now });
  f.registry.save(f.value); f.registry.begin(f.value.id, 'generate'); f.registry.recover();
  const recovered = f.registry.get(f.value.id)!; let queries = 0; let deployments = 0;
  const workflow = new Workflow(f.registry, { readState: async () => { queries++; return { tasks: {} }; }, deploy: async () => { deployments++; return confirmed; } });
  try {
    assert.equal(recovered.status, 'submitted'); assert.equal(recovered.deployments[0].status, 'deployed');
    workflow.run(recovered, 'reconcile'); await waitFor(() => !workflow.active.has(recovered.id));
    assert.equal(queries, 1); assert.equal(deployments, 0); assert.equal(recovered.status, 'deployed');
  } finally { await f.close(); }
});

test('restart before the IPC callback reconciles its existing build and journal without adding a deployment', async () => {
  const f = await fixture(); await compile(f.value); f.value.status = 'deploying';
  f.value.deployments.push({ id: 'interrupted', buildId: 'new-build', status: 'deploying', createdAt: now });
  f.registry.save(f.value); f.registry.begin(f.value.id, 'generate'); f.registry.recover();
  const recovered = f.registry.get(f.value.id)!; let deployments = 0;
  const workflow = new Workflow(f.registry, { buildsDirectory: f.directory, readJournal: async () => confirmed,
    deploy: async ({ buildDir }) => { deployments++; assert.equal(basename(buildDir), 'new-build'); return confirmed; }, readState: async () => ({ tasks: {} }),
  });
  try {
    assert.equal(recovered.deployments[0].status, 'unknown'); assert.equal(recovered.deployments[0].txId, undefined);
    workflow.run(recovered, 'reconcile'); await waitFor(() => !workflow.active.has(recovered.id));
    assert.equal(deployments, 1); assert.equal(recovered.deployments.length, 1); assert.equal(recovered.deployments[0].id, 'interrupted');
    assert.equal(recovered.deployments[0].txId, confirmed.txId); assert.equal(recovered.status, 'deployed');
  } finally { await f.close(); }
});

test('unconfigured local compilation stops with an explicit publishing explanation', async () => {
  const f = await fixture(); let deployments = 0;
  const workflow = new Workflow(f.registry, { autoPublish: false, compile, deploy: async () => { deployments++; return confirmed; } });
  try {
    workflow.run(f.value, 'compile'); await waitFor(() => !workflow.active.has(f.value.id));
    assert.equal(f.value.status, 'ready'); assert.equal(deployments, 0); assert.match(f.value.logs.at(-1)!.message, /unavailable in this local setup/);
  } finally { await f.close(); }
});

test('restart during new-build verification cannot treat a historical publication as current readiness', async () => {
  for (const kind of ['generate', 'compile', 'deploy']) {
    const f = await fixture(); await compile(f.value); f.value.status = 'deploying';
    f.value.deployments.push({ id: 'historical', buildId: 'old-build', status: 'deployed', txId: 'historical-transaction', contractAddress: 'cd'.repeat(32), createdAt: now });
    f.registry.save(f.value); f.registry.begin(f.value.id, kind); f.registry.recover();
    const recovered = f.registry.get(f.value.id)!; let queries = 0; let deployments = 0;
    const workflow = new Workflow(f.registry, { autoPublish: true, buildsDirectory: f.directory,
      readBuildManifest: async directory => basename(directory) === 'old-build' ? { ...manifest, sourceHash: 'old-source' } : manifest,
      readJournal: async () => undefined, readState: async () => { queries++; return {}; }, deploy: async () => { deployments++; return confirmed; },
    });
    try {
      assert.equal(recovered.status, 'failed');
      workflow.run(recovered, 'reconcile'); await waitFor(() => !workflow.active.has(recovered.id));
      assert.equal(recovered.status, 'failed'); assert.equal(queries, 0); assert.equal(deployments, 0);
      workflow.run(recovered, 'deploy'); await waitFor(() => !workflow.active.has(recovered.id));
      assert.equal(recovered.status, 'deployed'); assert.equal(deployments, 1); assert.equal(queries, 1);
      assert.equal(recovered.deployments[1].buildId, recovered.build!.id);
    } finally { await f.close(); }
  }
});

test('reconciling an earlier transaction does not mark a subsequently edited draft as published', async () => {
  const f = await fixture(); f.value.revision = 2;
  f.value.deployments.push({ id: 'earlier', buildId: 'old-build', status: 'unknown', txId: confirmed.txId, contractAddress: confirmed.contractAddress, createdAt: now });
  const workflow = new Workflow(f.registry, { readJournal: async () => confirmed, deploy: async () => confirmed, readState: async () => ({}) });
  try {
    workflow.run(f.value, 'reconcile'); await waitFor(() => !workflow.active.has(f.value.id));
    assert.equal(f.value.deployments[0].status, 'deployed'); assert.equal(f.value.status, 'draft');
    assert.match(f.value.logs.at(-1)!.message, /current draft has not been published/);
  } finally { await f.close(); }
});
