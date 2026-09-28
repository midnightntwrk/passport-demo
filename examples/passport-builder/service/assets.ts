import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppAsset, AssetRequest } from '../shared/types.js';
import { dataDir } from './config.js';

export const imageModel = process.env.OPENROUTER_IMAGE_MODEL || 'meta/muse-image';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export function validateAssets(value: unknown): AssetRequest[] {
  if (!Array.isArray(value) || value.length > 2) throw new Error('Request at most two generated image assets.');
  const names = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== 'object' || typeof item.name !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(item.name) || names.has(item.name)) throw new Error('Asset names must be unique, short lowercase slugs.');
    if (typeof item.prompt !== 'string' || item.prompt.trim().length < 10 || item.prompt.length > 1500 || typeof item.alt !== 'string' || item.alt.length > 240) throw new Error('Each asset needs a concise image prompt and alt text.');
    const aspectRatio = item.aspectRatio ?? '16:9';
    if (!['1:1', '16:9', '9:16'].includes(aspectRatio)) throw new Error('Use 1:1, 16:9, or 9:16 for an asset.');
    names.add(item.name);
    return { name: item.name, prompt: item.prompt.trim(), alt: item.alt, aspectRatio };
  });
}

/** Reject executable/vector formats and mismatched MIME declarations. */
export function imageDataUri(body: unknown): string {
  const item = (body as { data?: { b64_json?: unknown; media_type?: unknown }[] })?.data?.[0];
  if (typeof item?.b64_json !== 'string' || item.b64_json.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.b64_json)) throw new Error('The image provider returned invalid or oversized image bytes.');
  const bytes = Buffer.from(item.b64_json, 'base64');
  let mime: string | undefined;
  if (bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) mime = 'image/png';
  else if (bytes.length > 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) mime = 'image/jpeg';
  else if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') mime = 'image/webp';
  if (!mime || (item.media_type && item.media_type !== mime)) throw new Error('Only verified PNG, JPEG, and WebP assets are supported.');
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('The image provider returned no image.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 8 * 1024 * 1024) throw new Error('The image response exceeded the size limit.');
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

type CachedImage = { status: 'pending' | 'ready' | 'failed'; dataUri?: string; error?: string; model: string; cost?: number };
async function save(file: string, value: CachedImage) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, file);
}

export class AssetStore {
  private active = new Map<string, Promise<{ hash: string; dataUri: string }>>();
  constructor(private directory = join(dataDir, 'assets'), private request: typeof fetch = fetch, private model = imageModel) {}
  resolve(asset: AssetRequest, onLog: (message: string) => void) {
    const hash = createHash('sha256').update(JSON.stringify({ model: this.model, prompt: asset.prompt, aspectRatio: asset.aspectRatio })).digest('hex');
    const active = this.active.get(hash); if (active) return active;
    const operation = this.generate(asset, hash, onLog).finally(() => this.active.delete(hash));
    this.active.set(hash, operation);
    return operation;
  }
  private async generate(asset: AssetRequest, hash: string, onLog: (message: string) => void) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = join(this.directory, `${hash}.json`);
    let previous: CachedImage | undefined;
    try { previous = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (previous?.status === 'ready' && previous.dataUri) { onLog(`Reusing image · ${asset.name}`); return { hash, dataUri: previous.dataUri }; }
    if (previous) throw new Error(previous.error || 'An image request was interrupted. Its result is unknown; automatic regeneration is paused to prevent duplicate charges. Request a revised image to try again.');
    if (!process.env.OPENROUTER_API_KEY) throw new Error('Image generation needs the server OpenRouter credential.');
    // A durable request marker precedes the paid POST. A restart never repeats it.
    await save(file, { status: 'pending', model: this.model });
    onLog(`Generating image · ${asset.name}`);
    try {
      const response = await this.request('https://openrouter.ai/api/v1/images', {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: `${asset.prompt}\nComposition: ${asset.aspectRatio} aspect ratio.`, ...(this.model === 'meta/muse-image' ? {} : { aspect_ratio: asset.aspectRatio }), n: 1 }), signal: AbortSignal.timeout(180_000),
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Image service returned HTTP ${response.status}. Request a revised image after the service recovers.`); }
      const body = await boundedJson(response);
      const dataUri = imageDataUri(body);
      const cost = (body as { usage?: { cost?: number } }).usage?.cost;
      await save(file, { status: 'ready', model: this.model, dataUri, ...(typeof cost === 'number' && Number.isFinite(cost) ? { cost } : {}) });
      onLog(`Image ready · ${asset.name}`);
      return { hash, dataUri };
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : 'Image generation did not return a usable image.';
      await save(file, { status: 'failed', model: this.model, error: `${error} No automatic retry was made.` });
      throw cause;
    }
  }
}

const store = new AssetStore();
export async function resolveAssets(assets: AppAsset[], log: (message: string) => void) {
  const images: Record<string, { src: string; alt: string }> = {};
  const resolved: AppAsset[] = [];
  // At most two per app. One request at a time keeps image spend and provider load bounded.
  for (const asset of assets) {
    try {
      const result = await store.resolve(asset, log);
      images[asset.name] = { src: result.dataUri, alt: asset.alt };
      resolved.push({ ...asset, status: 'ready', hash: result.hash, error: undefined });
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : 'Image unavailable.';
      resolved.push({ ...asset, status: 'unavailable', error });
      log(`Image unavailable · ${asset.name}. ${error}`);
    }
  }
  return { images, assets: resolved };
}
