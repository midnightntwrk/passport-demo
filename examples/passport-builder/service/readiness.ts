import { config, defaultModel } from './config.js';
import { imageModel } from './assets.js';
import type { BuilderConfig } from '../shared/types.js';
let cached: { expires: number; services: BuilderConfig['services'] } | undefined;
let pending: Promise<BuilderConfig['services']> | undefined;

export function serviceReadiness(): Promise<BuilderConfig['services']> {
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.services);
  if (pending) return pending;
  pending = (async () => {
    const checks = await Promise.all([
      probe('Sponsor', process.env.BUILDER_SPONSOR_URL, '/wallet-status', body => body.available > 0 && body.wallets?.some((wallet: { ready?: boolean }) => wallet.ready), 'Stage-net fee sponsor available'),
      probe('Prover', process.env.BUILDER_PROOF_SERVER_URL, '/health', body => body.status === 'healthy' || body.status === 'ok', 'Remote proving service reachable'),
    ]);
    const services: BuilderConfig['services'] = [
      { name: 'OpenRouter', state: config.openrouterConfigured ? 'configured' : 'unconfigured', message: config.openrouterConfigured ? `${defaultModel} · credentials configured; availability checked on each request` : 'Add OPENROUTER_API_KEY' },
      { name: 'Images', state: config.openrouterConfigured ? 'configured' : 'unconfigured', message: imageModel },
      { name: 'Compact', state: config.compilerConfigured ? 'ready' : 'unavailable', message: config.compilerConfigured ? 'Compiler 0.34.0 verified' : 'Install Compact compiler 0.34.0' },
      ...checks,
      { name: 'Registry', state: 'ready', message: 'SQLite · durable volume' },
    ];
    cached = { expires: Date.now() + 15_000, services };
    return services;
  })().finally(() => { pending = undefined; });
  return pending;
}

async function probe(name: string, url: string | undefined, path: string, accepts: (body: any) => boolean, message: string): Promise<BuilderConfig['services'][number]> {
  if (!url) return { name, state: 'unconfigured', message: `${name} URL is not configured` };
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}${path}`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Health endpoint unavailable'); }
    const body = await response.json();
    return accepts(body) ? { name, state: 'ready', message } : { name, state: 'unavailable', message: `${name} is busy or not ready; checked again shortly` };
  } catch { return { name, state: 'unavailable', message: `${name} could not be reached; saved work is retained` }; }
}
