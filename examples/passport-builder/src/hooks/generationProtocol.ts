import type { GenerationProgress, GenerationStreamEvent } from '../../shared/generation';

/** Sequence and offset checks keep reconnects from duplicating or losing code. */
export function applyGenerationEvent(current: GenerationProgress | null, event: GenerationStreamEvent): GenerationProgress | null {
  if (event.type === 'snapshot') return event.progress;
  if (event.type !== 'update') return current;
  if (!current || event.progress.runId !== current.runId) throw new Error('The generation attempt changed. Reconnecting to its current files.');
  if (event.progress.sequence <= current.sequence) return current;
  if (event.baseSequence !== current.sequence) throw new Error('A code update was missed. Reconnecting to its current files.');
  let files = current.files;
  for (const patch of event.patches) {
    const previous = Object.hasOwn(files, patch.path) ? files[patch.path] : '';
    if (!Number.isSafeInteger(patch.offset) || patch.offset < 0 || patch.offset > previous.length || typeof patch.text !== 'string') throw new Error('A code update was incomplete. Reconnecting to its current files.');
    files = { ...files, [patch.path]: previous.slice(0, patch.offset) + patch.text };
  }
  return { ...event.progress, files };
}
