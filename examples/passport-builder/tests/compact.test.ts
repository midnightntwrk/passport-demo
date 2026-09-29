import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compileContract, readBuildManifest, validateSource } from '../service/compact.ts';

const COUNTER = `pragma language_version >= 0.22;
import CompactStandardLibrary;
export ledger count: Counter;
constructor() {}
export circuit increment(): [] { count.increment(1); }
`;

test('rejects contracts that could access external files or require unsupported private execution', () => {
  for (const source of [
    'include "../../secret";', 'import "../../secret";', 'import Other;',
    'witness secret(): Field;', 'constructor(owner: Bytes<32>) {}',
    'const a = "/*"; include "/etc/passwd"; const b = "*/";',
  ]) assert.throws(() => validateSource(source));
  assert.doesNotThrow(() => validateSource(COUNTER));
});

test('real Compact 0.34.0 compilation retains proof artefacts and detects tampering', { skip: process.env.RUN_COMPACT_TEST !== '1', timeout: 310_000 }, async () => {
  const buildDir = await mkdtemp(join(tmpdir(), 'passport-builder-compact-'));
  try {
    const result = await compileContract({ source: COUNTER, buildDir });
    assert.equal(result.compilerVersion, '0.34.0');
    assert.deepEqual(result.circuits, ['increment']);
    assert.ok((await readFile(join(buildDir, 'managed/keys/increment.prover'))).length > 0);
    assert.ok((await readFile(join(buildDir, 'managed/keys/increment.verifier'))).length > 0);
    assert.deepEqual(await readBuildManifest(buildDir), result);
    await writeFile(join(buildDir, 'managed/contract/index.js'), 'throw new Error("tampered");');
    await assert.rejects(readBuildManifest(buildDir), /integrity/);
  } finally { await rm(buildDir, { recursive: true, force: true }); }
});
