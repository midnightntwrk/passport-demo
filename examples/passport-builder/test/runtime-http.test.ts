import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Registry } from '../service/registry.ts';
import type { Project } from '../shared/types.ts';

test('workspace previews attach only the exact confirmed build, preserve old URLs, and scope transaction queries', { timeout: 20_000 }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'passport-runtime-http-'));
  const ids = ['aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-cccc-cccccccccccc'];
  const txId = '00' + '12'.repeat(32);
  const address = 'ab'.repeat(32);
  let queries = 0;
  const indexer = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += String(chunk);
    assert.equal(JSON.parse(raw).variables.identifier, txId); queries++;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: { transactions: [{ identifiers: [txId], block: { height: 42 }, transactionResult: { status: 'SUCCESS' }, contractActions: [{ __typename: 'ContractCall', address, entryPoint: 'createTask' }] }] } }));
  });
  indexer.listen(0, '127.0.0.1'); await once(indexer, 'listening');
  const indexerPort = (indexer.address() as { port: number }).port;
  const reserve = createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const port = (reserve.address() as { port: number }).port;
  await new Promise<void>(resolve => reserve.close(() => resolve()));
  const now = new Date().toISOString();
  const registry = new Registry(join(folder, 'registry.sqlite'));
  for (const [index, id] of ids.entries()) {
    const p: Project = { id, name: 'Runtime fixture', description: '', status: index === 1 ? 'submitted' : 'deployed', revision: index ? 2 : 1, model: 'test/model', files: {}, messages: [], logs: [], createdAt: now, updatedAt: now,
      build: { id: index === 1 ? 'b2' : 'b1', revision: index === 1 ? 2 : 1, sourceHash: 'test', compilerVersion: '0.34.0', circuits: ['createTask'], createdAt: now },
      deployments: [{ id: 'live', buildId: 'b1', status: 'deployed', contractAddress: address, appUrl: `/apps/${id}?deployment=live`, createdAt: now }] };
    if (index === 1) p.deployments.push({ id: 'pending', buildId: 'b2', status: 'submitted', contractAddress: 'cd'.repeat(32), createdAt: now });
    registry.save(p);
  }
  registry.close();
  for (const build of ['b1', 'b2']) {
    await mkdir(join(folder, 'builds', build), { recursive: true });
    await writeFile(join(folder, 'builds', build, 'app.js'), `console.log('${build}');`);
    await writeFile(join(folder, 'builds', build, 'app-metadata.json'), JSON.stringify({ name: build, css: '', circuits: ['createTask'] }));
  }
  const child = spawn(process.execPath, ['--import', 'tsx', 'service/server.ts'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), NODE_ENV: 'development', BUILDER_DEV_MODE: 'true', BUILDER_DATA_DIR: folder, BUILDER_COMPACT_BIN: process.execPath, BUILDER_ACCESS_TOKEN: '', BUILDER_PUBLIC_URL: '', BUILDER_ALLOWED_ORIGINS: '', PASSPORT_ORIGIN: 'https://midnightpassport.com', PASSPORT_AUTH_ORIGIN: 'https://midnightpassport.com', OPENROUTER_API_KEY: '', BUILDER_PROOF_SERVER_URL: '', BUILDER_SPONSOR_URL: '', BUILDER_INDEXER_URL: `http://127.0.0.1:${indexerPort}` },
  });
  let diagnostics = ''; child.stdout.on('data', c => diagnostics += String(c)); child.stderr.on('data', c => diagnostics += String(c));
  const base = `http://127.0.0.1:${port}`;
  const runtimeData = (html: string) => JSON.parse(html.match(/<script id="runtime-data" type="application\/json">(.*?)<\/script>/s)![1]);
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(base + '/health')).ok) break; } catch { /* starting */ }
      if (child.exitCode !== null) throw new Error(diagnostics);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const current = (await (await fetch(`${base}/api/projects/${ids[0]}`)).json()).project;
    assert.equal(current.previewUrl, `/apps/${ids[0]}?deployment=live`);
    const live = runtimeData(await (await fetch(base + current.previewUrl)).text());
    assert.equal(live.contractAddress, address); assert.equal(live.deploymentId, 'live');
    assert.deepEqual(live.circuits, ['createTask']);
    assert.equal(live.passportOrigin, 'https://midnightpassport.com');
    for (const id of ids.slice(1)) {
      const p = (await (await fetch(`${base}/api/projects/${id}`)).json()).project;
      assert.match(p.previewUrl, /preview=1&token=/);
      const preview = runtimeData(await (await fetch(base + p.previewUrl)).text());
      assert.equal(preview.contractAddress, undefined); assert.equal(preview.deploymentId, undefined);
      const old = runtimeData(await (await fetch(`${base}/apps/${id}?deployment=live`)).text());
      assert.equal(old.contractAddress, address); assert.match(old.app, /b1/);
    }
    assert.equal((await fetch(`${base}/apps/${ids[1]}?deployment=pending`)).status, 409);
    assert.equal((await fetch(`${base}/apps/${ids[1]}?preview=1&token=wrong`)).status, 403);
    assert.equal((await fetch(`${base}/api/runtime/${ids[1]}/prepare`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ deploymentId: 'pending' }) })).status, 409);
    const status = await fetch(`${base}/api/runtime/${ids[0]}/transaction?deployment=live&txId=${txId}`);
    assert.equal(status.status, 200); assert.deepEqual(await status.json(), { status: 'confirmed', txId, blockHeight: 42 });
    assert.equal((await fetch(`${base}/api/runtime/${ids[0]}/transaction?deployment=live&txId=bad`)).status, 400);
    assert.equal((await fetch(`${base}/api/runtime/${ids[0]}/transaction?deployment=live&txId=${txId}`, { headers: { origin: 'https://other.example' } })).status, 400);
    assert.equal(queries, 1, 'invalid or cross-origin queries must not reach the indexer');
  } finally {
    child.kill('SIGTERM'); if (child.exitCode === null) await once(child, 'exit');
    await new Promise<void>(resolve => indexer.close(() => resolve()));
    await rm(folder, { recursive: true });
  }
});
