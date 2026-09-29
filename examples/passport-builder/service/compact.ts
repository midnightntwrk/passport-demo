import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const COMPILER_VERSION = '0.34.0';
export const MAX_SOURCE_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 512 * 1024;
const MAX_ARTEFACT_BYTES = 128 * 1024 * 1024;
const maintainedCrudSource = readFile(new URL('./patterns/crud-records.compact', import.meta.url), 'utf8').catch(() => undefined);
const crudCacheFlights = new Map<string, Promise<BuildManifest>>();

export interface CircuitInfo {
  name: string;
  arguments: Array<{ name: string; type: Record<string, unknown> }>;
}
export interface BuildManifest {
  compilerVersion: string;
  sourceHash: string;
  circuits: string[];
  circuitDetails: CircuitInfo[];
  artefacts: Record<string, string>;
}

export function sourceHash(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

/** Tokenise comments and strings together so a string containing /* cannot hide code. */
function sourceTokens(source: string): string {
  let result = '';
  let cursor = 0;
  while (cursor < source.length) {
    if (source.slice(cursor, cursor + 2) === '//') {
      const end = source.indexOf('\n', cursor + 2);
      cursor = end < 0 ? source.length : end;
      result += ' ';
    } else if (source.slice(cursor, cursor + 2) === '/*') {
      const end = source.indexOf('*/', cursor + 2);
      if (end < 0) throw new Error('Unterminated Compact comment.');
      cursor = end + 2;
      result += ' ';
    } else if (source[cursor] === '"' || source[cursor] === "'") {
      const quote = source[cursor++];
      let closed = false;
      while (cursor < source.length) {
        if (source[cursor] === '\\') { cursor += 2; continue; }
        if (source[cursor++] === quote) { closed = true; break; }
      }
      if (!closed) throw new Error('Unterminated Compact string.');
      result += ' __STRING__ ';
    } else result += source[cursor++];
  }
  return result;
}

/** This release accepts one self-contained, witness-free source file. */
export function validateSource(source: string): void {
  if (typeof source !== 'string' || !source.trim()) throw new Error('A Compact contract is required.');
  if (Buffer.byteLength(source) > MAX_SOURCE_BYTES) throw new Error('The contract exceeds 64 KiB.');
  if (source.includes('\0')) throw new Error('The contract contains an invalid character.');
  const tokens = sourceTokens(source);
  if (/\b(include|witness|contract)\b/.test(tokens)) {
    throw new Error('External files, witnesses, and cross-contract declarations are not supported yet.');
  }
  for (const match of tokens.matchAll(/\bimport\s+([^;]+);/g)) {
    if (match[1]?.trim() !== 'CompactStandardLibrary') {
      throw new Error('Only CompactStandardLibrary may be imported.');
    }
  }
  // Reject every remaining import token, including malformed directives, before invoking compactc.
  if (/\bimport\b/.test(tokens.replace(/\bimport\s+CompactStandardLibrary\s*;/g, ' '))) {
    throw new Error('Only CompactStandardLibrary may be imported.');
  }
  const constructors = [...tokens.matchAll(/\bconstructor\s*\(([^)]*)\)/g)];
  if (constructors.some((match) => match[1]?.trim())) {
    throw new Error('Constructors with arguments are not supported yet.');
  }
  if (/\b(receive|send|mint|burn|createZswapInput|createZswapOutput|ownPublicKey)\s*\(/.test(tokens)) {
    throw new Error('This release supports public-state apps without token transfers or wallet-dependent state.');
  }
}

async function artefactHashes(root: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  let bytes = 0;
  async function walk(directory: string, prefix = ''): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      const filename = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Symbolic links are not permitted in compiler output.');
      if (entry.isDirectory()) await walk(filename, `${relative}/`);
      else if (entry.isFile()) {
        bytes += (await stat(filename)).size;
        if (bytes > MAX_ARTEFACT_BYTES) throw new Error('Compiler output exceeds the artefact size limit.');
        hashes[relative] = createHash('sha256').update(await readFile(filename)).digest('hex');
      }
    }
  }
  await walk(root);
  return hashes;
}

function runCompiler(cwd: string, onLog?: (line: string) => void): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const executable = process.env.BUILDER_COMPACT_COMMAND || process.env.BUILDER_COMPACT_BIN || 'compact';
    const child = spawn(executable, ['compile', `+${COMPILER_VERSION}`, '--compact-path', '', 'contract.compact', 'managed'], {
      cwd, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      // The compiler does not need the service's OpenRouter key or deployment configuration.
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) =>
        ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'COMPACT_DIRECTORY', 'COMPACT_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME'].includes(key))),
    });
    let output = '';
    let failure: Error | undefined;
    const stop = () => {
      try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); }
      catch { child.kill('SIGKILL'); }
    };
    const timer = setTimeout(() => {
      failure = new Error('Compact compilation exceeded five minutes.');
      stop();
    }, 300_000);
    const receive = (chunk: Buffer) => {
      output += chunk.toString();
      if (Buffer.byteLength(output) > MAX_OUTPUT_BYTES) {
        failure = new Error('Compact compiler output exceeded the limit.');
        stop();
      } else onLog?.(chunk.toString().trim());
    };
    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(output.trim() || `Compact exited with code ${code}.`));
      else resolvePromise();
    });
  });
}

export async function readBuildManifest(buildDir: string): Promise<BuildManifest> {
  const manifest = JSON.parse(await readFile(join(buildDir, 'manifest.json'), 'utf8')) as BuildManifest;
  const source = await readFile(join(buildDir, 'contract.compact'), 'utf8');
  validateSource(source);
  if (manifest.compilerVersion !== COMPILER_VERSION || sourceHash(source) !== manifest.sourceHash) {
    throw new Error('The saved build does not match its source or compiler version. Recompile it.');
  }
  const current = await artefactHashes(join(buildDir, 'managed'));
  const expected = manifest.artefacts;
  if (!expected || Object.keys(current).length !== Object.keys(expected).length ||
      Object.entries(expected).some(([name, hash]) => current[name] !== hash)) {
    throw new Error('Compiled artefacts failed their integrity check. Recompile the contract.');
  }
  return manifest;
}

async function compileFresh(source: string, destination: string, onLog?: (line: string) => void): Promise<BuildManifest> {
  const hash = sourceHash(source);
  await mkdir(destination, { recursive: true, mode: 0o700 });
  // Registry owns this directory; none of its path components come from model output.
  await rm(join(destination, 'managed'), { recursive: true, force: true });
  await rm(join(destination, 'manifest.json'), { force: true });
  await writeFile(join(destination, 'contract.compact'), source, { mode: 0o600 });
  await writeFile(join(destination, 'package.json'), '{"type":"module"}\n', { mode: 0o600 });
  await runCompiler(destination, onLog);
  const info = JSON.parse(await readFile(join(destination, 'managed/compiler/contract-info.json'), 'utf8'));
  if (info['compiler-version'] !== COMPILER_VERSION || info.witnesses?.length || info.contracts?.length) {
    throw new Error('The compiler returned an unsupported contract or version.');
  }
  const details = info.circuits.filter((circuit: { proof?: boolean }) => circuit.proof) as CircuitInfo[];
  const circuits = details.map((circuit) => circuit.name);
  if (!circuits.length || circuits.length > 12 || circuits.some((name) => !/^[A-Za-z_][\w]*$/.test(name))) {
    throw new Error('Provide between one and twelve exported provable circuits.');
  }
  const artefacts = await artefactHashes(join(destination, 'managed'));
  for (const circuit of circuits) {
    for (const name of [`keys/${circuit}.prover`, `keys/${circuit}.verifier`, `zkir/${circuit}.bzkir`]) {
      if (!artefacts[name]) throw new Error(`Compilation did not produce ${name}; ZK key generation is required.`);
    }
  }
  const manifest: BuildManifest = { compilerVersion: COMPILER_VERSION, sourceHash: hash, circuits, circuitDetails: details, artefacts };
  await writeFile(join(destination, 'manifest.tmp.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  await rename(join(destination, 'manifest.tmp.json'), join(destination, 'manifest.json'));
  return manifest;
}

async function readCrudCache(directory: string, hash: string): Promise<BuildManifest> {
  // Cache paths are server-owned; still reject linked roots/source/manifest so a
  // damaged volume cannot redirect a reusable build outside its cache entry.
  for (const [name, directoryExpected] of [['', true], ['managed', true], ['contract.compact', false], ['manifest.json', false]] as const) {
    const entry = await lstat(join(directory, name));
    if (entry.isSymbolicLink() || (directoryExpected ? !entry.isDirectory() : !entry.isFile())) throw new Error('Invalid compiler cache entry.');
  }
  const manifest = await readBuildManifest(directory);
  if (manifest.sourceHash !== hash) throw new Error('Compiler cache source does not match the maintained CRUD contract.');
  if (!manifest.artefacts['contract/index.js'] || !manifest.artefacts['compiler/contract-info.json']) throw new Error('Compiler cache is missing its executable module or metadata.');
  // Match the manifest's callable surface against the verified compiler output,
  // including complete proving material, before using it for another build.
  const info = JSON.parse(await readFile(join(directory, 'managed/compiler/contract-info.json'), 'utf8'));
  const details = info.circuits?.filter((circuit: { proof?: boolean }) => circuit.proof);
  if (info['compiler-version'] !== COMPILER_VERSION || info.witnesses?.length || info.contracts?.length ||
    !Array.isArray(details) || JSON.stringify(details) !== JSON.stringify(manifest.circuitDetails) ||
    JSON.stringify(details.map((circuit: CircuitInfo) => circuit.name)) !== JSON.stringify(manifest.circuits) ||
    [...manifest.circuits].sort().join(',') !== 'createRecord,deleteRecord,updateRecord') {
    throw new Error('Compiler cache manifest does not match its compiled contract.');
  }
  for (const circuit of manifest.circuits) {
    for (const name of [`keys/${circuit}.prover`, `keys/${circuit}.verifier`, `zkir/${circuit}.bzkir`]) {
      if (!manifest.artefacts[name]) throw new Error('Compiler cache is missing proving artefacts.');
    }
  }
  return manifest;
}

async function prepareCrudCache(directory: string, source: string, onLog?: (line: string) => void): Promise<BuildManifest> {
  const hash = sourceHash(source);
  try { return await readCrudCache(directory, hash); }
  catch { /* Missing, incomplete, or corrupt cache entries are never reused. */ }
  await rm(directory, { recursive: true, force: true });
  const parent = resolve(directory, '..');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(parent, `${hash}.tmp-`));
  try {
    await compileFresh(source, temporary, onLog);
    await readCrudCache(temporary, hash);
    try { await rename(temporary, directory); }
    catch (error) {
      // Another service process may have atomically published the same exact
      // source while we compiled. Only its fully verified output may win.
      if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
    }
    return await readCrudCache(directory, hash);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

export async function compileContract({ source, buildDir, onLog }: {
  source: string; buildDir: string; onLog?: (line: string) => void;
}): Promise<BuildManifest> {
  validateSource(source);
  const destination = resolve(buildDir);
  const hash = sourceHash(source);
  try {
    const existing = await readBuildManifest(destination);
    if (existing.sourceHash === hash) return existing;
  } catch { /* Missing or incomplete builds are compiled from source. */ }
  if (source !== await maintainedCrudSource) return compileFresh(source, destination, onLog);

  // Only this checked-in public boilerplate shares compilation. User-generated
  // source, application metadata, maintenance keys, and deployment journals do
  // not enter this cache. Each immutable build retains its own separate files.
  const cacheDirectory = join(resolve(process.env.BUILDER_DATA_DIR || './data'), 'compiler-cache', COMPILER_VERSION, hash);
  if (destination === cacheDirectory) throw new Error('A build must have its own directory outside the compiler cache.');
  let pending = crudCacheFlights.get(cacheDirectory);
  if (!pending) {
    pending = prepareCrudCache(cacheDirectory, source, onLog);
    crudCacheFlights.set(cacheDirectory, pending);
  } else onLog?.('Waiting for the maintained CRUD compiler artefacts.');
  try { await pending; }
  finally { if (crudCacheFlights.get(cacheDirectory) === pending) crudCacheFlights.delete(cacheDirectory); }

  // Verify immediately before copying, then verify the new build after copying.
  // Plain copies intentionally avoid mutable hard-link sharing between builds.
  const manifest = await readCrudCache(cacheDirectory, hash);
  await mkdir(destination, { recursive: true, mode: 0o700 });
  await rm(join(destination, 'managed'), { recursive: true, force: true });
  await rm(join(destination, 'manifest.json'), { force: true });
  await cp(join(cacheDirectory, 'managed'), join(destination, 'managed'), { recursive: true, errorOnExist: true, force: false });
  await writeFile(join(destination, 'contract.compact'), source, { mode: 0o600 });
  await writeFile(join(destination, 'package.json'), '{"type":"module"}\n', { mode: 0o600 });
  await writeFile(join(destination, 'manifest.tmp.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  await rename(join(destination, 'manifest.tmp.json'), join(destination, 'manifest.json'));
  const verified = await readBuildManifest(destination);
  onLog?.('Reused verified Compact 0.34.0 artefacts for the maintained CRUD contract.');
  return verified;
}
