import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compileContract, readBuildManifest, sourceHash } from '../service/compact.ts';

const source = await readFile(new URL('../service/patterns/crud-records.compact', import.meta.url), 'utf8');

async function fixture(run: (context: { directory: string; cache: string; calls: () => Promise<number> }) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'passport-compiler-cache-'));
  const command = join(directory, 'compiler-fixture');
  const oldCommand = process.env.BUILDER_COMPACT_COMMAND;
  const oldData = process.env.BUILDER_DATA_DIR;
  // A tiny deterministic compiler process exercises real spawning, atomic
  // manifests, copying, and disk corruption without repeatedly generating ZK
  // keys. Real compiler semantics are covered by crud-pattern.test.ts.
  await writeFile(command, `#!/usr/bin/env node
const fs = require('node:fs'); const path = require('node:path');
const fixture = ${JSON.stringify(directory)};
fs.appendFileSync(path.join(fixture, 'calls.txt'), 'compile\\n');
if (fs.existsSync(path.join(fixture, 'fail'))) { process.stderr.write('Deliberate compiler failure'); process.exit(1); }
setTimeout(() => {
  for (const folder of ['compiler','contract','keys','zkir']) fs.mkdirSync(path.join('managed', folder), {recursive:true});
  const circuits = ['createRecord','updateRecord','deleteRecord'].map(name => ({name, proof:true, arguments:[]}));
  fs.writeFileSync('managed/compiler/contract-info.json', JSON.stringify({'compiler-version':'0.34.0',circuits,witnesses:[],contracts:[]}));
  fs.writeFileSync('managed/contract/index.js', 'verified compiler fixture');
  for (const circuit of circuits) for (const file of ['keys/'+circuit.name+'.prover','keys/'+circuit.name+'.verifier','zkir/'+circuit.name+'.bzkir']) fs.writeFileSync(path.join('managed',file), 'artefact '+file);
}, 35);
`, { mode: 0o700 });
  await chmod(command, 0o700);
  process.env.BUILDER_COMPACT_COMMAND = command;
  process.env.BUILDER_DATA_DIR = join(directory, 'data');
  try {
    await run({ directory, cache: join(directory, 'data/compiler-cache/0.34.0', sourceHash(source)),
      calls: async () => { try { return (await readFile(join(directory, 'calls.txt'), 'utf8')).trim().split('\n').length; } catch { return 0; } } });
  } finally {
    if (oldCommand === undefined) delete process.env.BUILDER_COMPACT_COMMAND; else process.env.BUILDER_COMPACT_COMMAND = oldCommand;
    if (oldData === undefined) delete process.env.BUILDER_DATA_DIR; else process.env.BUILDER_DATA_DIR = oldData;
    await rm(directory, { recursive: true, force: true });
  }
}

test('simultaneous maintained CRUD builds compile once and receive independently verified copies', async () => {
  await fixture(async ({ directory, cache, calls }) => {
    const directories = Array.from({ length: 5 }, (_, index) => join(directory, `build-${index}`));
    const results = await Promise.allSettled(directories.map(buildDir => compileContract({ source, buildDir })));
    for (const result of results) assert.equal(result.status, 'fulfilled', result.status === 'rejected' ? String(result.reason) : undefined);
    assert.equal(await calls(), 1);
    const cached = await readBuildManifest(cache);
    for (const buildDir of directories) assert.deepEqual(await readBuildManifest(buildDir), cached);
    const name = 'managed/keys/createRecord.prover';
    const expected = await readFile(join(cache, name), 'utf8');
    await writeFile(join(directories[0], name), 'corrupt one build');
    assert.equal(await readFile(join(cache, name), 'utf8'), expected, 'Builds must not share mutable hard links with the cache');
    await assert.rejects(readBuildManifest(directories[0]), /integrity/);
    assert.deepEqual(await readBuildManifest(directories[1]), cached);
    await compileContract({ source, buildDir: directories[0] });
    assert.equal(await calls(), 1);
    assert.deepEqual(await readBuildManifest(directories[0]), cached);
  });
});

test('cache reuse copies only compiler-owned files, never app metadata or deployment keys and journals', async () => {
  await fixture(async ({ directory, cache, calls }) => {
    await compileContract({ source, buildDir: join(directory, 'first') });
    for (const name of ['maintenance-key.json', 'deployment.json', 'deployment-transaction.bin', 'app-metadata.json']) await writeFile(join(cache, name), 'fixture: do not copy');
    const buildDir = join(directory, 'second');
    await compileContract({ source, buildDir });
    assert.deepEqual((await readdir(buildDir)).sort(), ['contract.compact', 'managed', 'manifest.json', 'package.json']);
    assert.equal(await calls(), 1);
    assert.equal((await readBuildManifest(buildDir)).sourceHash, sourceHash(source));
  });
});

test('corrupt cache source, artefacts, or manifest metadata is rebuilt rather than reused', async () => {
  await fixture(async ({ directory, cache, calls }) => {
    await compileContract({ source, buildDir: join(directory, 'original') });
    await writeFile(join(cache, 'managed/keys/createRecord.prover'), 'damaged key');
    await compileContract({ source, buildDir: join(directory, 'after-key-corruption') });
    assert.equal(await calls(), 2);
    await writeFile(join(cache, 'contract.compact'), source + '\n// mismatched source');
    await compileContract({ source, buildDir: join(directory, 'after-source-corruption') });
    assert.equal(await calls(), 3);
    const manifest = JSON.parse(await readFile(join(cache, 'manifest.json'), 'utf8'));
    manifest.circuits = ['differentCircuit'];
    await writeFile(join(cache, 'manifest.json'), JSON.stringify(manifest));
    const final = join(directory, 'after-manifest-corruption');
    await compileContract({ source, buildDir: final });
    assert.equal(await calls(), 4);
    assert.deepEqual((await readBuildManifest(final)).circuits, ['createRecord', 'updateRecord', 'deleteRecord']);
  });
});

test('failed coalesced compilation leaves no published cache and a later request can retry', async () => {
  await fixture(async ({ directory, cache, calls }) => {
    await writeFile(join(directory, 'fail'), 'fail this compiler invocation');
    const results = await Promise.allSettled(['one', 'two'].map(name => compileContract({ source, buildDir: join(directory, name) })));
    for (const result of results) { assert.equal(result.status, 'rejected'); if (result.status === 'rejected') assert.match(String(result.reason), /Deliberate compiler failure/); }
    assert.equal(await calls(), 1);
    await assert.rejects(stat(cache), { code: 'ENOENT' });
    assert.deepEqual(await readdir(join(directory, 'data/compiler-cache/0.34.0')), []);
    await rm(join(directory, 'fail'));
    const buildDir = join(directory, 'retry');
    await compileContract({ source, buildDir });
    assert.equal(await calls(), 2);
    assert.equal((await readBuildManifest(buildDir)).sourceHash, sourceHash(source));
  });
});

test('linked cache artefacts are discarded without following or modifying their external targets', async () => {
  await fixture(async ({ directory, cache, calls }) => {
    await compileContract({ source, buildDir: join(directory, 'first') });
    const external = join(directory, 'unrelated-file');
    await writeFile(external, 'must remain untouched');
    const key = join(cache, 'managed/keys/createRecord.prover');
    await rm(key); await symlink(external, key);
    const buildDir = join(directory, 'second');
    await compileContract({ source, buildDir });
    assert.equal(await calls(), 2);
    assert.equal(await readFile(external, 'utf8'), 'must remain untouched');
    assert.equal((await readBuildManifest(buildDir)).sourceHash, sourceHash(source));
  });
});

test('even a comment change bypasses the maintained-source cache', async () => {
  await fixture(async ({ directory, cache, calls }) => {
    const changed = source + '\n// application-specific variation\n';
    const results = await Promise.allSettled(['custom-one', 'custom-two'].map(name => compileContract({ source: changed, buildDir: join(directory, name) })));
    for (const result of results) assert.equal(result.status, 'fulfilled');
    assert.equal(await calls(), 2);
    await assert.rejects(stat(cache), { code: 'ENOENT' });
  });
});
