import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AssetStore, imageDataUri, validateAssets } from '../service/assets.js';
import { parseGeneration } from '../service/validation.js';
import { bundleApp } from '../service/bundle.js';
import { counterStarter, generationInstructions } from '../service/generation.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=';
const asset = { name: 'hero', prompt: 'A moonlit botanical garden', alt: 'Moonlit plants', aspectRatio: '16:9' as const };
test('asset manifests inherit across edits and never expose storage paths or duplicate names', () => {
  const generated = parseGeneration(JSON.stringify({ name: 'Garden', description: 'A garden', files: {} }), { previousFiles: counterStarter.files, previousAssets: [asset] });
  assert.deepEqual(generated.assets, [asset]);
  assert.throws(() => validateAssets([asset, asset]), /unique/);
  assert.throws(() => validateAssets([{ ...asset, name: '../../secrets' }]), /unique/);
  assert.throws(() => imageDataUri({ data: [{ b64_json: Buffer.from('<svg onload="evil()"/>').toString('base64'), media_type: 'image/svg+xml' }] }), /Only verified/);
  assert.throws(() => imageDataUri({ data: [{ b64_json: png, media_type: 'text/html' }] }), /Only verified/);
});
test('one paid request is coalesced and survives a service restart as a cached image', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'passport-assets-'));
  const old = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'test-only';
  let requests = 0;
  const provider = async () => { requests++; return Response.json({ data: [{ b64_json: png, media_type: 'image/png' }] }); };
  try {
    const store = new AssetStore(dir, provider as typeof fetch);
    const [first, second] = await Promise.all([store.resolve(asset, () => {}), store.resolve(asset, () => {})]);
    assert.equal(requests, 1); assert.deepEqual(first, second);
    const cached = await new AssetStore(dir, provider as typeof fetch).resolve(asset, () => {});
    assert.equal(requests, 1); assert.deepEqual(cached, first);
    const bundle = await bundleApp({ ...counterStarter.files, 'src/App.tsx': "import { Asset } from '@midnight-passport/assets'; export default function App(){return <Asset name='hero'/>}" }, { hero: { src: first.dataUri, alt: asset.alt } });
    assert.ok(bundle.includes(png)); assert.ok(!bundle.includes('test-only'));
  } finally { old === undefined ? delete process.env.OPENROUTER_API_KEY : process.env.OPENROUTER_API_KEY = old; await rm(dir, { recursive: true, force: true }); }
});
test('lost image responses are not charged again by automatic compilation retries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'passport-assets-'));
  const old = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'test-only';
  let requests = 0;
  const provider = async () => { requests++; throw new Error('response lost'); };
  try {
    await assert.rejects(new AssetStore(dir, provider as typeof fetch).resolve(asset, () => {}));
    await assert.rejects(new AssetStore(dir, provider as typeof fetch).resolve(asset, () => {}), /automatic retry/);
    assert.equal(requests, 1);
  } finally { old === undefined ? delete process.env.OPENROUTER_API_KEY : process.env.OPENROUTER_API_KEY = old; await rm(dir, { recursive: true, force: true }); }
});
test('generation carries pinned Passport guidance and the explicit implemented extension', () => {
  const instructions = generationInstructions('A plant exchange');
  assert.match(instructions, /00711e045ef641a13f7f67b9f22144379cf41039/);
  assert.match(instructions, /Never handle or request key material/);
  assert.match(instructions, /contract-tx\/v1 extension/);
  assert.match(instructions, /@midnight-passport\/assets/);
});
