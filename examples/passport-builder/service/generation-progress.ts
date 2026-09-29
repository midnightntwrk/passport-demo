import { randomUUID } from 'node:crypto';
import type { GenerationProgress } from '../shared/generation.js';
import type { ProjectFiles } from '../shared/types.js';
import type { PartialGenerationFiles } from './incremental-generation.js';
import { FILE_PATHS } from './validation.js';

/** Publish bounded display snapshots; this object never writes the registry. */
export class GenerationAttempt {
  private current: GenerationProgress;
  private pending?: PartialGenerationFiles;
  private timer?: ReturnType<typeof setTimeout>;
  private lastPublished = Date.now();
  constructor(attempt: number, sequence: number, private publish: (progress: GenerationProgress) => void) {
    this.current = { runId: randomUUID(), attempt, sequence, status: 'streaming', files: {}, completedFiles: [], updatedAt: new Date().toISOString() };
    this.emit({});
  }
  update(files: PartialGenerationFiles): void {
    if (this.current.status !== 'streaming') return;
    this.pending = files;
    const delay = Math.max(0, 200 - (Date.now() - this.lastPublished));
    if (delay === 0) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), delay);
  }
  private emit(update: Partial<GenerationProgress>) {
    this.current = { ...this.current, ...update, sequence: this.current.sequence + 1, updatedAt: new Date().toISOString() };
    this.lastPublished = Date.now(); this.publish(this.current);
  }
  private flush() {
    if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    if (!this.pending) return;
    const partial = this.pending; this.pending = undefined;
    this.emit({ ...partial, files: { ...partial.files }, completedFiles: [...partial.completedFiles], activeFile: partial.activeFile });
  }
  checkpoint() { this.flush(); }
  complete(files: ProjectFiles) {
    this.dispose();
    this.emit({ status: 'complete', files: { ...files }, completedFiles: [...FILE_PATHS], activeFile: undefined, error: undefined });
  }
  fail(error: string) {
    this.flush();
    this.emit({ status: 'failed', error: error.slice(0, 6000) });
  }
  dispose() {
    if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.pending = undefined;
  }
}
