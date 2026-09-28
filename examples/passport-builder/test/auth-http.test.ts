import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { request, type ClientRequest } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Registry } from '../service/registry.js';
import type { Project } from '../shared/types.js';
import { aliceKey, bobKey, cookieHeader, signedCallback, subjectFor } from './auth-fixture.js';

test('HTTP requires verified Passport sessions and isolates projects by signing identity', { timeout: 20_000 }, async () => {
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const folder = await mkdtemp(join(tmpdir(), 'passport-auth-http-'));
  const operatorToken = 'operator-test-token-'.repeat(3);
  const ids = { alice: '33333333-3333-4333-a333-333333333333', bob: '44444444-4444-4444-a444-444444444444', old: '55555555-5555-4555-a555-555555555555' };
  const files = { 'contract.compact': 'export ledger count: Counter;', 'src/App.tsx': 'export default function App() { return <p>Counter</p> }', 'src/styles.css': 'body { margin: 0 }' };
  const registry = new Registry(join(folder, 'registry.sqlite'));
  for (const [name, id] of Object.entries(ids)) {
    const project: Project = { id, ownerSubject: name === 'old' ? undefined : subjectFor(name === 'alice' ? aliceKey : bobKey),
      name, description: '', model: 'test/model', status: 'draft', revision: 1, files, messages: [], logs: [], deployments: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    if (name === 'alice') {
      project.name = 'Private unreleased name'; project.description = 'Private unreleased description';
      project.deployments.push({ id: 'published', buildId: 'published-build', status: 'deployed', contractAddress: 'ab'.repeat(32), appUrl: `/apps/${id}?deployment=published`, createdAt: project.createdAt });
    }
    if (name === 'bob') project.deployments.push({ id: 'missing', buildId: 'missing-metadata', status: 'deployed', createdAt: project.createdAt });
    registry.save(project);
  }
  registry.close();
  await mkdir(join(folder, 'builds', 'published-build'), { recursive: true });
  await writeFile(join(folder, 'builds', 'published-build', 'app-metadata.json'), JSON.stringify({ name: 'Published app', description: 'Published description', circuits: ['increment'], css: '' }));
  const child = spawn(process.execPath, ['--import', 'tsx', 'service/server.ts'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), NODE_ENV: 'development', BUILDER_DEV_MODE: 'false', BUILDER_DATA_DIR: folder,
      BUILDER_ACCESS_TOKEN: operatorToken, BUILDER_COMPACT_COMMAND: process.execPath, BUILDER_COMPACT_BIN: process.execPath,
      BUILDER_PUBLIC_URL: '', BUILDER_ALLOWED_ORIGINS: '', PASSPORT_AUTH_ORIGIN: 'https://midnightpassport.com',
      OPENROUTER_API_KEY: '', BUILDER_PROOF_SERVER_URL: 'http://127.0.0.1:9', BUILDER_SPONSOR_URL: 'http://127.0.0.1:9' },
  });
  let diagnostics = ''; child.stdout.on('data', chunk => { diagnostics += String(chunk); }); child.stderr.on('data', chunk => { diagnostics += String(chunk); });
  const base = `http://127.0.0.1:${port}`;
  const headers = { origin: base, 'content-type': 'application/json' };
  let delayedPatch: ClientRequest | undefined;
  async function login(key: Uint8Array) {
    const start = await fetch(`${base}/api/auth/start`, { method: 'POST', headers }); assert.equal(start.status, 200);
    const launch = (await start.json()).url;
    const cookie = cookieHeader(start.headers.getSetCookie());
    const hash = signedCallback(launch, { key });
    const finish = await fetch(`${base}/api/auth/finish`, { method: 'POST', headers: { ...headers, cookie }, body: JSON.stringify({ hash }) });
    assert.equal(finish.status, 200, await finish.clone().text());
    const value = await finish.json();
    assert.equal(value.authenticated, true); assert.equal(value.devMode, false); assert.equal('subject' in value, false);
    const replay = await fetch(`${base}/api/auth/finish`, { method: 'POST', headers: { ...headers, cookie }, body: JSON.stringify({ hash }) });
    assert.equal(replay.status, 401);
    return cookieHeader(finish.headers.getSetCookie());
  }
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* Server still starting. */ }
      if (child.exitCode !== null) throw new Error(`Test server exited: ${diagnostics}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.deepEqual(await (await fetch(`${base}/api/auth/session`)).json(), { authenticated: false, devMode: false });
    const publicRegistry = await (await fetch(`${base}/api/registry`)).json();
    assert.equal(publicRegistry.apps.length, 1, 'missing deployed metadata must not fall back to a private draft');
    assert.equal(publicRegistry.apps[0].name, 'Published app');
    assert.equal(publicRegistry.apps[0].description, 'Published description');
    assert.equal(JSON.stringify(publicRegistry).includes('Private unreleased'), false);
    assert.equal(JSON.stringify(publicRegistry).includes('ownerSubject'), false);
    await writeFile(join(folder, 'builds', 'published-build', 'app-metadata.json'), JSON.stringify({ name: 'Published app', circuits: ['increment'], css: '' }));
    const legacyRegistry = await (await fetch(`${base}/api/registry`)).json();
    assert.equal(legacyRegistry.apps[0].description, '', 'legacy metadata must not publish the private draft description');
    assert.equal((await fetch(`${base}/api/projects`)).status, 401);
    assert.equal((await fetch(`${base}/api/projects/${ids.alice}/generation`)).status, 401);
    assert.equal((await fetch(`${base}/api/projects`, { headers: { authorization: `Bearer ${operatorToken}` } })).status, 401, 'operator token cannot replace Passport login');
    assert.equal((await fetch(`${base}/api/projects`, { method: 'POST', headers, body: JSON.stringify({ template: 'counter' }) })).status, 401);
    assert.equal((await fetch(`${base}/api/auth/start`, { method: 'POST' })).status, 403);
    assert.equal((await fetch(`${base}/api/auth/start`, { method: 'POST', headers: { origin: 'https://attacker.example' } })).status, 403);
    const alice = await login(aliceKey); const bob = await login(bobKey);
    const aliceList = await (await fetch(`${base}/api/projects`, { headers: { cookie: alice } })).json();
    assert.deepEqual(aliceList.projects.map((p: Project) => p.id), [ids.alice]);
    assert.equal('ownerSubject' in aliceList.projects[0], false);
    const codeStream = await fetch(`${base}/api/projects/${ids.alice}/generation`, { headers: { cookie: alice } });
    assert.equal(codeStream.status, 200);
    assert.match(codeStream.headers.get('content-type')!, /application\/x-ndjson/);
    assert.deepEqual((await codeStream.text()).trim().split('\n').map(line => JSON.parse(line)), [{ type: 'snapshot', progress: null }, { type: 'end' }]);
    const bobList = await (await fetch(`${base}/api/projects`, { headers: { cookie: bob } })).json();
    assert.deepEqual(bobList.projects.map((p: Project) => p.id), [ids.bob]);
    for (const path of [`/api/projects/${ids.bob}`, `/api/projects/${ids.bob}/export`, `/api/projects/${ids.bob}/generation`, `/api/projects/${ids.old}`]) {
      assert.equal((await fetch(`${base}${path}`, { headers: { cookie: alice } })).status, 404);
    }
    assert.equal((await fetch(`${base}/api/projects/${ids.bob}`, { method: 'PATCH', headers: { ...headers, cookie: alice }, body: JSON.stringify({ files }) })).status, 404);
    assert.equal((await fetch(`${base}/api/projects/${ids.bob}/compile`, { method: 'POST', headers: { ...headers, cookie: alice }, body: '{}' })).status, 404);
    assert.equal((await fetch(`${base}/api/projects/${ids.alice}`, { method: 'PATCH', headers: { ...headers, cookie: alice }, body: JSON.stringify({ files, ownerSubject: subjectFor(bobKey) }) })).status, 200);
    assert.equal((await fetch(`${base}/api/projects/${ids.alice}`, { headers: { cookie: bob } })).status, 404, 'input cannot transfer project ownership');
    assert.equal((await fetch(`${base}/api/projects/${ids.old}`, { headers: { cookie: alice, authorization: 'Bearer incorrect' } })).status, 404);
    assert.equal((await fetch(`${base}/api/projects/${ids.old}`, { headers: { cookie: alice, authorization: `Bearer ${operatorToken}` } })).status, 200);
    const operatorList = await (await fetch(`${base}/api/projects`, { headers: { cookie: alice, authorization: `Bearer ${operatorToken}` } })).json();
    assert.equal(operatorList.projects.length, 3);
    const create = await fetch(`${base}/api/projects`, { method: 'POST', headers: { ...headers, cookie: alice }, body: JSON.stringify({ template: 'counter', ownerSubject: subjectFor(bobKey) }) });
    assert.equal(create.status, 202);
    const created = (await create.json()).project;
    assert.equal('ownerSubject' in created, false);
    assert.equal((await fetch(`${base}/api/projects/${created.id}`, { headers: { cookie: alice } })).status, 200);
    assert.equal((await fetch(`${base}/api/projects/${created.id}`, { headers: { cookie: bob } })).status, 404);
    delayedPatch = request(`${base}/api/projects/${ids.alice}`, { method: 'PATCH', headers: { ...headers, cookie: alice, expect: '100-continue' } });
    const delayedResponse = new Promise<number>((resolve, reject) => {
      delayedPatch!.once('error', reject);
      delayedPatch!.once('response', res => { res.resume(); res.once('end', () => resolve(res.statusCode!)); });
    });
    void delayedResponse.catch(() => {});
    const acknowledged = once(delayedPatch, 'continue'); delayedPatch.flushHeaders(); await acknowledged;
    const logout = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { ...headers, cookie: alice } });
    assert.equal(logout.status, 200); assert.equal((await logout.json()).authenticated, false);
    delayedPatch.end(JSON.stringify({ files }));
    assert.equal(await delayedResponse, 401, 'a session revoked while the body arrives must not authorise a mutation');
    assert.equal((await fetch(`${base}/api/projects`, { headers: { cookie: alice, authorization: `Bearer ${operatorToken}` } })).status, 401);
    assert.equal((await fetch(`${base}/api/auth/session`, { headers: { cookie: bob } })).status, 200);
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await (await fetch(`${base}/health`)).json()).activeOperations === 0) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  } finally {
    delayedPatch?.destroy();
    child.kill('SIGTERM'); if (child.exitCode === null) await once(child, 'exit');
    await rm(folder, { recursive: true, force: true });
  }
});
