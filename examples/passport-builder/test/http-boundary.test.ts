import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Registry } from '../service/registry.js';
import type { Project } from '../shared/types.js';

test('explicit local development bypass still enforces request origins', { timeout: 20_000 }, async () => {
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const folder = await mkdtemp(join(tmpdir(), 'passport-http-test-'));
  const token = 'builder-test-token-'.repeat(3);
  const child = spawn(process.execPath, ['--import', 'tsx', 'service/server.ts'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), NODE_ENV: 'development', BUILDER_DEV_MODE: 'true', BUILDER_DATA_DIR: folder,
      BUILDER_ACCESS_TOKEN: token, BUILDER_COMPACT_COMMAND: process.execPath, BUILDER_PUBLIC_URL: '', BUILDER_ALLOWED_ORIGINS: 'http://remote.example',
      OPENROUTER_API_KEY: '', BUILDER_PROOF_SERVER_URL: '', BUILDER_SPONSOR_URL: '' },
  });
  let diagnostics = ''; child.stdout.on('data', chunk => { diagnostics += String(chunk); }); child.stderr.on('data', chunk => { diagnostics += String(chunk); });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* Server still starting. */ }
      if (child.exitCode !== null) throw new Error(`Test server exited: ${diagnostics}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal((await fetch(`${base}/api/projects`)).status, 200);
    assert.equal((await fetch(`${base}/api/projects`, { headers: { authorization: `Bearer ${token}` } })).status, 200);
    assert.equal((await fetch(`${base}/api/projects`, { headers: { authorization: `Bearer ${token}`, origin: 'https://attacker.example' } })).status, 403);
    const mutation = await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: '{}' });
    assert.equal(mutation.status, 400);
    const publicConfig = await (await fetch(`${base}/api/config`)).text();
    assert.equal(publicConfig.includes(token), false);
    const remote = (path: string) => new Promise<{ status: number; value: any }>((resolve, reject) => {
      const req = request(`${base}${path}`, { headers: { host: 'remote.example' } }, res => {
        let raw = ''; res.on('data', chunk => { raw += String(chunk); });
        res.on('end', () => { try { resolve({ status: res.statusCode!, value: JSON.parse(raw) }); } catch (error) { reject(error); } });
      });
      req.once('error', reject); req.end();
    });
    assert.equal((await remote('/api/auth/session')).value.devMode, false);
    assert.equal((await remote('/api/config')).value.devMode, false);
    assert.equal((await remote('/api/projects')).status, 401);
    assert.equal((await fetch(`${base}/api/runtime/11111111-1111-4111-a111-111111111111/prepare`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'null' }, body: '{}' })).status, 404);
  } finally {
    child.kill('SIGTERM');
    if (child.exitCode === null) await once(child, 'exit');
    await rm(folder, { recursive: true, force: true });
  }
});

test('delayed mutation bodies cannot overwrite newer revisions or an active workflow', { timeout: 20_000 }, async () => {
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const folder = await mkdtemp(join(tmpdir(), 'passport-http-race-'));
  const entered = join(folder, 'compiler-entered');
  const release = join(folder, 'compiler-release');
  const compiler = join(folder, 'held-compiler.mjs');
  // Hold only the test compiler, so the active-workflow assertion is deterministic.
  await writeFile(compiler, `#!${process.execPath}\nimport { writeFileSync, existsSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(entered)}, '');\nconst timer = setInterval(() => { if (existsSync(${JSON.stringify(release)})) { clearInterval(timer); process.exit(1); } }, 10);\n`, { mode: 0o700 });
  const id = '22222222-2222-4222-a222-222222222222';
  const files = (label: string) => ({ 'contract.compact': 'export ledger count: Counter;', 'src/App.tsx': `export default function App() { return <p>${label}</p> }`, 'src/styles.css': 'body { margin: 0 }' });
  const project: Project = { id, name: 'Race fixture', description: '', model: 'test/model', status: 'draft', revision: 1,
    files: files('one'), messages: [], logs: [], deployments: [{ id: 'published', buildId: 'saved-build', status: 'deployed', txId: 'preserved-id', createdAt: new Date().toISOString() }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const registry = new Registry(join(folder, 'registry.sqlite')); registry.save(project); registry.close();
  const token = 'builder-race-token-'.repeat(3);
  const child = spawn(process.execPath, ['--import', 'tsx', 'service/server.ts'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), NODE_ENV: 'development', BUILDER_DEV_MODE: 'true', BUILDER_DATA_DIR: folder,
      BUILDER_ACCESS_TOKEN: token, BUILDER_COMPACT_COMMAND: compiler, BUILDER_COMPACT_BIN: process.execPath, BUILDER_PUBLIC_URL: '',
      OPENROUTER_API_KEY: '', BUILDER_PROOF_SERVER_URL: '', BUILDER_SPONSOR_URL: '' },
  });
  let diagnostics = ''; child.stdout.on('data', chunk => { diagnostics += String(chunk); }); child.stderr.on('data', chunk => { diagnostics += String(chunk); });
  const base = `http://127.0.0.1:${port}`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const pending: ReturnType<typeof request>[] = [];
  async function delayed(method: string, path: string) {
    const req = request(`${base}${path}`, { method, headers: { ...headers, expect: '100-continue' } });
    pending.push(req);
    const response = new Promise<{ status: number; value: any }>((resolve, reject) => {
      req.on('error', reject);
      req.on('response', res => {
        let raw = ''; res.on('data', chunk => { raw += String(chunk); });
        res.on('end', () => { try { resolve({ status: res.statusCode!, value: JSON.parse(raw) }); } catch (error) { reject(error); } });
      });
    });
    // Node acknowledges the headers then enters the route. Its body remains
    // unread while a separate request changes the same project.
    const acknowledged = once(req, 'continue'); req.flushHeaders(); await acknowledged;
    return { finish: (body: unknown) => { req.end(JSON.stringify(body)); return response; } };
  }
  const patch = async (label: string) => {
    const response = await fetch(`${base}/api/projects/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ files: files(label) }) });
    assert.equal(response.status, 200); return (await response.json()).project as Project;
  };
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* Server still starting. */ }
      if (child.exitCode !== null) throw new Error(`Test server exited: ${diagnostics}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const editing = await delayed('PATCH', `/api/projects/${id}`);
    assert.equal((await patch('two')).revision, 2);
    const edited = await editing.finish({ files: files('three') });
    assert.equal(edited.status, 200);
    assert.equal(edited.value.project.revision, 3);
    assert.equal(edited.value.project.deployments[0].txId, 'preserved-id');

    const action = await delayed('POST', `/api/projects/${id}/reconcile`);
    assert.equal((await patch('four')).revision, 4);
    const reconciled = await action.finish({});
    assert.equal(reconciled.status, 202);
    assert.equal(reconciled.value.project.revision, 4);
    assert.equal(reconciled.value.project.files['src/App.tsx'], files('four')['src/App.tsx']);

    const duringBuild = await delayed('PATCH', `/api/projects/${id}`);
    const started = await fetch(`${base}/api/projects/${id}/compile`, { method: 'POST', headers, body: '{}' });
    assert.equal(started.status, 202);
    for (let attempt = 0; attempt < 300 && !existsSync(entered); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(existsSync(entered), true, diagnostics);
    const blocked = await duringBuild.finish({ files: files('must not save') });
    assert.equal(blocked.status, 400);
    assert.match(blocked.value.error, /current operation/);
    const current = (await (await fetch(`${base}/api/projects/${id}`, { headers })).json()).project;
    assert.equal(current.revision, 4);
    assert.equal(current.status, 'compiling');
    assert.equal(current.files['src/App.tsx'], files('four')['src/App.tsx']);
    await writeFile(release, '');
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await (await fetch(`${base}/health`)).json()).activeOperations === 0) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  } finally {
    await writeFile(release, ''); pending.forEach(req => req.destroy());
    child.kill('SIGTERM'); if (child.exitCode === null) await once(child, 'exit');
    await rm(folder, { recursive: true, force: true });
  }
});
