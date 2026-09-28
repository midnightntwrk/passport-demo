import assert from 'node:assert/strict';
import test from 'node:test';
import type { GenerationProgress, GenerationStreamEvent } from '../../shared/generation';
import { applyGenerationEvent } from './generationProtocol';

const snapshot: GenerationProgress = { runId: 'run1', attempt: 1, sequence: 3, status: 'streaming', files: { 'app.tsx': 'hello 🌙 old' }, activeFile: 'app.tsx', completedFiles: [], updatedAt: '2026-09-14T12:00:00Z' };
function update(baseSequence: number, sequence: number, patches: Extract<GenerationStreamEvent, { type: 'update' }>['patches']): GenerationStreamEvent {
  const { files: _files, ...progress } = snapshot;
  return { type: 'update', baseSequence, progress: { ...progress, sequence }, patches };
}

test('applies coalesced sequence jumps and suffix replacement without duplicating unicode', () => {
  const next = applyGenerationEvent(snapshot, update(3, 8, [{ path: 'app.tsx', offset: 'hello 🌙 '.length, text: 'new' }, { path: 'contract.compact', offset: 0, text: 'export circuit vote() {}' }]))!;
  assert.equal(next.files['app.tsx'], 'hello 🌙 new');
  assert.equal(next.files['contract.compact'], 'export circuit vote() {}');
  assert.equal(snapshot.files['app.tsx'], 'hello 🌙 old');
});
test('ignores repeated updates but rejects missing bases and invalid offsets', () => {
  assert.equal(applyGenerationEvent(snapshot, update(0, 3, [{ path: 'app.tsx', offset: 0, text: 'duplicate' }])), snapshot);
  assert.throws(() => applyGenerationEvent(snapshot, update(2, 6, [])), /missed/);
  assert.throws(() => applyGenerationEvent(snapshot, update(3, 4, [{ path: 'app.tsx', offset: 1000, text: 'gap' }])), /incomplete/);
  assert.throws(() => applyGenerationEvent(null, update(0, 1, [])), /attempt changed/);
});
test('a full snapshot replaces previous attempt files instead of merging', () => {
  const replacement = { ...snapshot, runId: 'run2', attempt: 2, sequence: 0, files: {} };
  assert.equal(applyGenerationEvent(snapshot, { type: 'snapshot', progress: replacement }), replacement);
  assert.deepEqual(applyGenerationEvent(snapshot, { type: 'snapshot', progress: replacement })?.files, {});
});
