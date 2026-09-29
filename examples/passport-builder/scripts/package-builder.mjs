import { mkdtemp, mkdir, readdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const stage = await mkdtemp(join(tmpdir(), 'passport-builder-railway-'));
const excluded = new Set(['node_modules', 'dist', 'data', '.git', '.railway']);
async function copyTree(relative) {
  const directory = join(root, relative);
  await mkdir(join(stage, relative), { recursive: true });
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.name.startsWith('.env') || entry.name.endsWith('.log') || (relative.endsWith('/public') && entry.name.startsWith('runtime.js'))) continue;
    const child = join(relative, entry.name);
    if (entry.isDirectory()) await copyTree(child);
    else if (entry.isFile()) await copyFile(join(root, child), join(stage, child));
  }
}
await copyTree('packages/connect');
await copyTree('skills/midnight-passport');
await copyTree('examples/passport-builder');
await copyFile(join(root, '.dockerignore'), join(stage, '.dockerignore'));
await copyFile(join(root, 'examples/passport-builder/railway.json'), join(stage, 'railway.json'));
console.log(resolve(stage));
