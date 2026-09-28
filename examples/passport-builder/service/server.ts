import { serviceReadiness } from './readiness.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { adminToken, assertConfiguration, config, dataDir, defaultModel, devMode, models, passportAuthOrigin, passportOrigin, port } from './config.js';
import { publicOrigin, assertRequestOrigin } from './origins.js';
import { PassportAuth } from './auth.js';
import { Registry } from './registry.js';
import { Workflow } from './workflow.js';
import { streamGeneration } from './generation-stream.js';
import { counterStarter } from './generation.js';
import { promptText, validateFiles } from './validation.js';
import { runtimeDocument, sandboxDocument } from './bundle.js';
import { prepareCall, readContractState } from './chain.js';
import { readTransactionStatus } from './transaction-status.js';
import type { AuthSession, Project } from '../shared/types.js';

assertConfiguration();
const appDirectory = fileURLToPath(new URL('../', import.meta.url));
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const secretFile = join(dataDir, 'preview-secret');
if (!existsSync(secretFile)) writeFileSync(secretFile, randomBytes(32), { mode: 0o600 });
const previewSecret = readFileSync(secretFile);
const registry = new Registry(join(dataDir, 'registry.sqlite'));
const auth = new PassportAuth(join(dataDir, 'auth.sqlite'), { passportOrigin: passportAuthOrigin, devMode, secureCookies: process.env.NODE_ENV === 'production' });
registry.recover();
const workflow = new Workflow(registry);
const runFile = promisify(execFile);
try {
  const compiler = await runFile(process.env.BUILDER_COMPACT_BIN || 'compact', ['compile', '+0.34.0', '--version'], { timeout: 5000 });
  config.compilerConfigured = /0\.34\.0/.test(compiler.stdout);
} catch { config.compilerConfigured = false; }
const callLocks = new Set<string>();
const rateLimits = new Map<string, { count: number; expires: number }>();
const generationStreams = new Map<string, number>();
const closeGenerationStreams = new Set<() => void>();
let draining = false;

function previewToken(project: Project) { return createHmac('sha256', previewSecret).update(`${project.id}:${project.revision}`).digest('hex'); }
function currentDeployment(project: Project) {
  return project.build?.revision === project.revision
    ? [...project.deployments].reverse().find(deployment => deployment.buildId === project.build!.id && deployment.status === 'deployed' && deployment.contractAddress)
    : undefined;
}
function decorate(project: Project) {
  const { ownerSubject: _ownerSubject, ...visible } = project;
  const deployed = currentDeployment(project);
  return { ...visible, previewUrl: deployed ? `/apps/${project.id}?deployment=${encodeURIComponent(deployed.id)}` : project.build ? `/apps/${project.id}?preview=1&token=${previewToken(project)}` : undefined };
}
function safeEqual(a: string, b: string) { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
type Actor = { subject: string; operator: boolean };
function devRequest(req: IncomingMessage) { return devMode && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(publicOrigin(req)).hostname); }
async function requireDeploymentServices(req: IncomingMessage) {
  if (devRequest(req)) return;
  if (!config.deploymentConfigured) throw Object.assign(new Error('Automatic stage-net deployment is unavailable. Configure BUILDER_PROOF_SERVER_URL and BUILDER_SPONSOR_URL on the builder service before building.'), { status: 503 });
  const services = await serviceReadiness();
  const unavailable = services.filter(service => ['Passport', 'Sponsor', 'Prover', 'Compact'].includes(service.name) && service.state !== 'ready');
  if (unavailable.length) throw Object.assign(new Error(`A functional app cannot be published yet: ${unavailable.map(service => service.name).join(', ')} unavailable. ${unavailable.some(service => service.name === 'Passport') ? 'The Passport deployment must support stage-net sign-in and contract approvals.' : 'Restore the required services before building.'} No generation was started.`), { status: 503 });
}
function sessionInfo(req: IncomingMessage, session: AuthSession) { return { ...session, devMode: devRequest(req) }; }
function authorise(req: IncomingMessage): Actor {
  publicOrigin(req);
  if (!['GET', 'HEAD'].includes(req.method || 'GET') || req.headers.origin) assertRequestOrigin(req);
  if (devRequest(req)) return { subject: 'dev:local', operator: true };
  const session = auth.session(req.headers.cookie);
  if (!session) throw Object.assign(new Error('Sign in with Midnight Passport to use the builder.'), { status: 401 });
  return { subject: session.subject, operator: Boolean(adminToken && safeEqual(req.headers.authorization || '', `Bearer ${adminToken}`)) };
}
function owns(project: Project, actor: Actor) { return actor.operator || project.ownerSubject === actor.subject; }
function ownedProject(id: string, actor: Actor) { const project = lookup(id); if (!owns(project, actor)) throw Object.assign(new Error('Application not found.'), { status: 404 }); return project; }
async function body(req: IncomingMessage): Promise<any> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('Content-Type must be application/json.');
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 400_000) throw new Error('Request body is too large.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(value));
}
function lookup(id: string) { const project = registry.get(id); if (!project) throw Object.assign(new Error('Application not found.'), { status: 404 }); return project; }
function limit(key: string, maximum: number) {
  const now = Date.now();
  if (rateLimits.size > 10000) for (const [key, value] of rateLimits) if (value.expires < now) rateLimits.delete(key);
  const limit = rateLimits.get(key) || { count: 0, expires: now + 60_000 };
  if (limit.expires < now) { limit.count = 0; limit.expires = now + 60_000; }
  if (++limit.count > maximum) throw Object.assign(new Error('Too many requests. Try again in a minute.'), { status: 429 });
  rateLimits.set(key, limit);
}
function deploymentFor(project: Project, id?: string | null) {
  const deployment = id ? project.deployments.find(d => d.id === id) : [...project.deployments].reverse().find(d => d.status === 'deployed');
  if (!deployment?.contractAddress || deployment.status !== 'deployed') throw Object.assign(new Error('This contract is awaiting confirmed stage-net deployment.'), { status: 409 });
  // A build owns immutable compiler outputs. Never use the currently edited files.
  return deployment;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const method = req.method || 'GET';
    if (method === 'GET' && url.pathname === '/health') return json(res, { status: draining ? 'draining' : 'ok', network: 'stagenet', activeOperations: workflow.active.size }, draining ? 503 : 200);
    if (draining && !['GET', 'HEAD'].includes(method)) return json(res, { error: 'The service is restarting. Your work is saved; reopen the app to check its status.' }, 503);
    if (method === 'GET' && url.pathname === '/api/auth/session') { publicOrigin(req); return json(res, sessionInfo(req, auth.info(req.headers.cookie))); }
    if (method === 'POST' && ['/api/auth/start', '/api/auth/finish', '/api/auth/logout'].includes(url.pathname)) {
      assertRequestOrigin(req);
      const origin = publicOrigin(req);
      limit(`auth:${url.pathname}:${req.socket.remoteAddress}`, 20);
      if (url.pathname === '/api/auth/start') {
        const result = auth.start(req.headers.cookie, origin); res.setHeader('set-cookie', result.cookies); return json(res, { url: result.url });
      }
      if (url.pathname === '/api/auth/finish') {
        const input = await body(req);
        const result = auth.finish(req.headers.cookie, origin, input.hash); res.setHeader('set-cookie', result.cookies); return json(res, sessionInfo(req, result.session));
      }
      const result = auth.logout(req.headers.cookie); res.setHeader('set-cookie', result.cookies); return json(res, sessionInfo(req, result.session));
    }
    if (method === 'GET' && url.pathname === '/api/config') {
      config.services = await serviceReadiness();
      return json(res, { ...config, devMode: devRequest(req) });
    }
    if (method === 'GET' && url.pathname === '/api/registry') {
      const entries = await Promise.all(registry.list().map(async project => {
        const d = [...project.deployments].reverse().find(d => d.status === 'deployed');
        if (!d) return [];
        // The current draft is private. A public listing belongs to the exact
        // deployed build, including its name and description.
        try {
          const metadata = JSON.parse(await readFile(join(dataDir, 'builds', d.buildId, 'app-metadata.json'), 'utf8'));
          if (typeof metadata.name !== 'string' || !metadata.name.trim()) return [];
          return [{ id: project.id, name: metadata.name, description: typeof metadata.description === 'string' ? metadata.description : '', url: publicOrigin(req) + d.appUrl, networks: ['stagenet'], contractAddress: d.contractAddress, txId: d.txId }];
        } catch { return []; }
      }));
      return json(res, { version: 1, apps: entries.flat() });
    }
    const runtime = url.pathname.match(/^\/api\/runtime\/([a-f0-9-]{36})\/(prepare|ledger|transaction)$/);
    if (runtime) {
      const [, id, action] = runtime;
      const project = lookup(id);
      if ((action === 'prepare' && method !== 'POST') || (action !== 'prepare' && method !== 'GET')) throw new Error('Unsupported method.');
      if (req.headers.origin && req.headers.origin !== publicOrigin(req)) throw new Error('Runtime requests must come from the maintained application host.');
      limit(`runtime:${action}:${id}:${req.socket.remoteAddress}`, action === 'prepare' ? 8 : action === 'transaction' ? 60 : 30);
      const payload = action === 'prepare' ? await body(req) : undefined;
      const deployment = deploymentFor(project, payload?.deploymentId || url.searchParams.get('deployment'));
      const buildDir = join(dataDir, 'builds', deployment.buildId);
      if (action === 'transaction') {
        const metadata = JSON.parse(await readFile(join(buildDir, 'app-metadata.json'), 'utf8'));
        return json(res, await readTransactionStatus({ txId: url.searchParams.get('txId') || '', contractAddress: deployment.contractAddress!, circuits: metadata.circuits }));
      }
      if (action === 'ledger') return json(res, await readContractState({ buildDir, contractAddress: deployment.contractAddress! }));
      if (callLocks.has(id) || callLocks.size >= 2) throw new Error('A proof is already being prepared. Please retry shortly.');
      if (typeof payload.circuit !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(payload.circuit) || !Array.isArray(payload.args) || payload.args.length > 32 || JSON.stringify(payload.args).length > 20_000) throw new Error('Invalid circuit or arguments.');
      callLocks.add(id);
      try { return json(res, await prepareCall({ buildDir, contractAddress: deployment.contractAddress!, circuit: payload.circuit, args: payload.args })); }
      finally { callLocks.delete(id); }
    }
    if (url.pathname === '/api/projects') {
      const actor = authorise(req);
      if (method === 'GET') return json(res, { projects: registry.list(actor.operator ? undefined : actor.subject).map(decorate) });
      if (method === 'POST') {
        const input = await body(req);
        const currentActor = authorise(req);
        const prompt = promptText(input.prompt || (input.template === 'counter' ? 'Create a community counter' : ''));
        await requireDeploymentServices(req);
        if (input.template !== 'counter' && !config.openrouterConfigured) throw new Error('OpenRouter is not configured. Set OPENROUTER_API_KEY on the builder service.');
        if (workflow.active.size >= 2) throw new Error('Two builds are already running. Try again shortly.');
        const now = new Date().toISOString();
        const project: Project = { id: randomUUID(), ownerSubject: currentActor.subject, name: input.template === 'counter' ? counterStarter.name : prompt.slice(0, 48), description: '', model: defaultModel, status: 'draft', revision: input.template === 'counter' ? 1 : 0, files: {}, messages: [{ role: 'user', content: prompt, createdAt: now }], logs: [], deployments: [], createdAt: now, updatedAt: now };
        if (input.template === 'counter') { project.name = counterStarter.name; project.description = counterStarter.description; project.files = structuredClone(counterStarter.files); }
        registry.save(project);
        workflow.run(project, input.template === 'counter' ? 'compile' : 'generate', prompt);
        return json(res, { project: decorate(project) }, 202);
      }
    }
    const generationRoute = url.pathname.match(/^\/api\/projects\/([a-f0-9-]{36})\/generation$/);
    if (generationRoute && method === 'GET') {
      const id = generationRoute[1];
      const actor = authorise(req);
      ownedProject(id, actor);
      const count = generationStreams.get(actor.subject) || 0;
      if (count >= 6 || closeGenerationStreams.size >= 64) return json(res, { error: 'Too many open code streams. Close another builder tab and retry.' }, 429);
      generationStreams.set(actor.subject, count + 1);
      let close: (() => void) | undefined;
      let ended = false;
      close = streamGeneration(res, {
        authorise: () => ownedProject(id, authorise(req)),
        current: () => workflow.getGeneration(id),
        active: () => workflow.active.has(id),
        onClose: () => {
          ended = true;
          const remaining = (generationStreams.get(actor.subject) || 1) - 1;
          if (remaining) generationStreams.set(actor.subject, remaining); else generationStreams.delete(actor.subject);
          if (close) closeGenerationStreams.delete(close);
        },
      });
      if (!ended) closeGenerationStreams.add(close);
      return;
    }
    const projectRoute = url.pathname.match(/^\/api\/projects\/([a-f0-9-]{36})(?:\/(generate|compile|deploy|reconcile|export))?$/);
    if (projectRoute) {
      const actor = authorise(req);
      const [, id, action] = projectRoute; const project = ownedProject(id, actor);
      if (method === 'GET' && !action) return json(res, { project: decorate(project) });
      if (method === 'GET' && action === 'export') {
        res.setHeader('content-disposition', `attachment; filename="passport-${id}.json"`);
        return json(res, { ...decorate(project), runtime: '@midnight-passport/connect', compiler: '0.34.0', network: 'stagenet' });
      }
      if (method === 'PATCH' && !action) {
        const input = await body(req);
        // Reading a body yields to other requests and running workflows. Only
        // mutate the current document, and check the lock after the body arrives.
        const project = ownedProject(id, authorise(req));
        if (workflow.active.has(id)) throw new Error('Wait for the current operation to finish before editing.');
        project.files = validateFiles(input.files); project.generation = undefined; project.revision++; project.build = undefined; project.status = 'draft'; project.error = undefined;
        registry.snapshot(project); registry.save(project);
        return json(res, { project: decorate(project) });
      }
      if (method === 'POST' && action && action !== 'export') {
        const input = await body(req);
        const project = ownedProject(id, authorise(req));
        if (workflow.active.has(id)) throw new Error('This app already has an operation in progress.');
        if (['generate', 'compile', 'deploy'].includes(action)) await requireDeploymentServices(req);
        if (action === 'deploy' && !config.deploymentConfigured) throw new Error('Configure BUILDER_PROOF_SERVER_URL and BUILDER_SPONSOR_URL before deployment.');
        const prompt = action === 'generate' ? promptText(input.prompt) : '';
        if (action === 'generate') { project.model = defaultModel; project.messages.push({ role: 'user', content: prompt, createdAt: new Date().toISOString() }); }
        workflow.run(project, action as 'generate' | 'compile' | 'deploy' | 'reconcile', prompt);
        return json(res, { project: decorate(project) }, 202);
      }
    }
    const appRoute = url.pathname.match(/^\/apps\/([a-f0-9-]{36})$/);
    if (appRoute && method === 'GET') {
      const project = lookup(appRoute[1]);
      const preview = url.searchParams.get('preview') === '1';
      if (preview && !safeEqual(url.searchParams.get('token') || '', previewToken(project))) throw Object.assign(new Error('Preview link expired. Reopen the preview from the builder.'), { status: 403 });
      const deployment = preview ? currentDeployment(project) : deploymentFor(project, url.searchParams.get('deployment'));
      const buildId = deployment?.buildId || project.build?.id;
      if (!buildId) throw new Error('Compile this application first.');
      const buildDir = join(dataDir, 'builds', buildId);
      const [bundle, metadata] = await Promise.all([readFile(join(buildDir, 'app.js'), 'utf8'), readFile(join(buildDir, 'app-metadata.json'), 'utf8')]);
      const saved = JSON.parse(metadata);
      const passportReady = devRequest(req) || (await serviceReadiness()).some(service => service.name === 'Passport' && service.state === 'ready');
      const html = runtimeDocument({ passportReady, id: project.id, name: saved.name, passportOrigin, app: sandboxDocument(bundle, saved.css, publicOrigin(req)), contractAddress: deployment?.contractAddress, deploymentId: deployment?.id, circuits: saved.circuits });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }); res.end(html); return;
    }
    if (method === 'GET' && url.pathname === '/runtime/host.js') { res.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-cache' }); res.end(await readFile(join(appDirectory, 'public/runtime.js'))); return; }
    if (url.pathname.startsWith('/api/')) return json(res, { error: 'Endpoint not found.' }, 404);
    if (method !== 'GET') return json(res, { error: 'Method not allowed.' }, 405);
    const dist = resolve(appDirectory, 'dist');
    const requested = resolve(dist, `.${decodeURIComponent(url.pathname)}`);
    if (!requested.startsWith(`${dist}/`) && requested !== dist) return json(res, { error: 'Not found.' }, 404);
    const file = existsSync(requested) && extname(requested) ? requested : join(dist, 'index.html');
    const contents = await readFile(file);
    const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
    res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'x-content-type-options': 'nosniff' }); res.end(contents);
  } catch (error) {
    if (!res.headersSent) json(res, { error: error instanceof Error ? error.message : 'The service could not complete this request.' }, Number((error as {status?: number})?.status) || 400);
    else res.end();
  }
});
server.requestTimeout = 360_000;
server.listen(port, process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1', () => console.log(`Passport Builder service listening on http://localhost:${port} · stagenet`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  if (draining) return;
  draining = true;
  closeGenerationStreams.forEach(close => close());
  server.close();
  // The registry must remain open while workflows checkpoint. Interrupted
  // chain work retains its journal and is reconciled after restart.
  const deadline = Date.now() + 25_000;
  const drain = setInterval(() => {
    if (!workflow.active.size && !callLocks.size) {
      clearInterval(drain); registry.close(); auth.close(); process.exit(0);
    } else if (Date.now() >= deadline) { clearInterval(drain); process.exit(0); }
  }, 100);
});
