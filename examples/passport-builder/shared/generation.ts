import type { ProjectFiles } from './types.js';

/** Read-only model output, separate from the validated and editable project files. */
export interface GenerationProgress {
  runId: string;
  attempt: number;
  sequence: number;
  status: 'streaming' | 'complete' | 'failed';
  files: ProjectFiles;
  completedFiles: string[];
  activeFile?: string;
  updatedAt: string;
  error?: string;
}

/** NDJSON: a full snapshot on connect, then only appended or replaced file text. */
export type GenerationStreamEvent =
  | { type: 'snapshot'; progress: GenerationProgress | null }
  | { type: 'update'; baseSequence: number; progress: Omit<GenerationProgress, 'files'>; patches: { path: string; offset: number; text: string }[] }
  | { type: 'heartbeat' }
  | { type: 'error'; status: number; message: string }
  | { type: 'end' };
