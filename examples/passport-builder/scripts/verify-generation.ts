/** Operator smoke: creates one public stage-net demo without impersonating a Passport user. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir, defaultModel, assertConfiguration } from '../service/config.js';
import { Registry } from '../service/registry.js';
import { Workflow } from '../service/workflow.js';
import type { Project } from '../shared/types.js';

if (!process.argv.includes('--execute')) throw new Error('This generates assets and deploys a stage-net demo. Pass --execute to run it.');
assertConfiguration();
const directory = join(dataDir, 'verification', 'night-garden-20260928');
await mkdir(directory, { recursive: true });
const reportFile = join(directory, 'project.json');
const registry = new Registry(join(dataDir, 'registry.sqlite'));
let project: Project | undefined;
try { project = registry.get(JSON.parse(await readFile(reportFile, 'utf8')).id); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
if (project && !process.argv.includes('--retry-generation')) {
  console.log(JSON.stringify({ id: project.id, status: project.status, error: project.error?.slice(0, 400), deployment: project.deployments.at(-1), message: 'Existing smoke retained; no paid request or deployment repeated.' }));
  registry.close(); process.exit(project.status === 'deployed' ? 0 : 1);
}
const prompt = [
  'Build Night Garden, a beautiful public seed exchange on Midnight stage-net. Use a midnight navy and warm ivory editorial design with botanical imagery, clean offer cards, a compact posting form and real lifecycle actions. Request one generated hero illustration using the assets manifest and render it with Asset. Use the shared AppShell/Button/Field/Status components where helpful, but give the exchange an intentional visual identity. No fake content, totals or participants.',
  'The contract must export offers: Map<Uint<64>, Offer> where Offer holds label: Bytes<32>, details: Bytes<32>, status: Uint<8>. Export createOffer(id: Uint<64>, label: Bytes<32>, details: Bytes<32>) inserting status 0, reserveOffer(id: Uint<64>) enforcing 0 to 1, completeOffer(id: Uint<64>) enforcing 1 to 2, and removeOffer(id: Uint<64>) removing the existing offer. Every action must mutate the real ledger. These are permissionless public offers: explain that anyone may change them, no identity-based ownership. Do not substitute the counter or generic CRUD boilerplate.',
  'Follow the runtime confirmation flow and show offer states Open, Reserved, Complete. Encode text to 32-byte UTF-8 hex without Buffer, generate Uint64 IDs as decimal strings, and decode ledger bytes for display. Keep responsive layout and clear loading, empty and error states. Deploy automatically. This is a demonstration, no real assets or value move. Everything is stage-net. Keep code concise.',
].join('\n');
const now = new Date().toISOString();
if (project && (project.status !== 'failed' || project.revision !== 0 || Object.keys(project.files).length || project.build || project.deployments.length)) throw new Error('Retry requires the known empty, failed generation; existing builds and deployments are retained.');
project ??= { id: randomUUID(), ownerSubject: 'operator:night-garden-verification', name: 'Night Garden', description: '', model: defaultModel, status: 'draft', revision: 0, files: {}, messages: [{ role: 'user', content: prompt, createdAt: now }], logs: [], deployments: [], createdAt: now, updatedAt: now };
registry.save(project);
await writeFile(reportFile, JSON.stringify({ id: project.id, startedAt: now }));
const workflow = new Workflow(registry);
// Start after the retained history so old provider diagnostics are not reprinted.
let last = project.logs.at(-1)?.id || ''; 
workflow.run(project, 'generate', prompt);
while (workflow.active.has(project.id)) {
  const logs = project.logs;
  const from = last ? logs.findIndex(log => log.id === last) + 1 : 0;
  for (const log of logs.slice(from)) console.log(log.stage + ': ' + log.message.slice(0, 600));
  last = logs.at(-1)?.id || '';
  await new Promise(resolve => setTimeout(resolve, 1000));
}
const report = { id: project.id, status: project.status, model: project.model, assets: project.assets, revision: project.revision, build: project.build, deployment: project.deployments.at(-1), error: project.error?.slice(0, 600), elapsedMs: Date.now() - Date.parse(now) };
await writeFile(reportFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
registry.close(); process.exit(project.status === 'deployed' ? 0 : 1);
