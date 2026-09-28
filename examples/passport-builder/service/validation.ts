import type { ProjectFiles } from '../shared/types.js';
import { boilerplateFiles, type BoilerplateId } from './boilerplate.js';
import { validateAssets } from './assets.js';
import type { AppAsset } from '../shared/types.js';

export const FILE_PATHS = ['contract.compact', 'src/App.tsx', 'src/styles.css'] as const;
export function validateFiles(value: unknown): ProjectFiles {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected generated files.');
  const files = value as Record<string, unknown>;
  if (Object.keys(files).some(path => !FILE_PATHS.includes(path as typeof FILE_PATHS[number]))) throw new Error('Only contract.compact, src/App.tsx, and src/styles.css can be generated.');
  for (const path of FILE_PATHS) {
    if (typeof files[path] !== 'string' || (files[path] as string).length > 100_000) throw new Error(`Missing or oversized ${path}.`);
  }
  if (!(files['contract.compact'] as string).trim() || !(files['src/App.tsx'] as string).trim()) throw new Error('Contract and application must not be empty.');
  return Object.fromEntries(FILE_PATHS.map(path => [path, files[path] as string]));
}
/** Complete file strings may inform a repair without becoming editable/published source. */
export class UnsupportedAppError extends Error {}
export class GenerationValidationError extends Error {
  constructor(message: string, readonly files: ProjectFiles) { super(message); }
}
export interface GenerationContext {
  previousFiles?: ProjectFiles;
  previousAssets?: AppAsset[];
  onBoilerplate?: (base: BoilerplateId) => void;
  onResolvedFiles?: (counts: { supplied: number; reused: number; expanded: number; defaulted: number }) => void;
}

/** Validate the wire delta before inheritance; an omitted file never means deletion. */
function validateChanges(value: unknown): ProjectFiles {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected generated files.');
  const files = value as Record<string, unknown>;
  if (Object.keys(files).some(path => !FILE_PATHS.includes(path as typeof FILE_PATHS[number]))) throw new Error('Only contract.compact, src/App.tsx, and src/styles.css can be generated.');
  for (const [path, content] of Object.entries(files)) {
    if (typeof content !== 'string' || content.length > 100_000) throw new Error(`Invalid or oversized ${path}.`);
  }
  return files as ProjectFiles;
}

export function parseGeneration(text: string, context: GenerationContext = {}): { name: string; description: string; files: ProjectFiles; assets?: AppAsset[] } {
  const clean = text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  const value = JSON.parse(clean);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a generated application object.');
  if (typeof value.unsupported === 'string' && value.unsupported.trim() && value.unsupported.length <= 2000) throw new UnsupportedAppError(value.unsupported.trim());
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80 || typeof value.description !== 'string' || value.description.length > 2000) throw new Error('Generated app name or description is invalid.');
  if (value.base !== undefined && value.base !== 'crud') throw new Error('Unknown application boilerplate. Only an explicit crud base is supported.');
  const existing = context.previousFiles && Object.keys(context.previousFiles).length > 0;
  if (value.base && existing) throw new Error('A base may only be selected for a new application. Omit base to preserve the existing app and its contract.');
  const metadata = { name: value.name.trim(), description: value.description };
  const changes = validateChanges(value.files);
  const inherited = existing ? context.previousFiles! : value.base ? boilerplateFiles(value.base, metadata) : { 'src/styles.css': '' };
  const files = validateFiles({ ...inherited, ...changes });
  if (value.base) context.onBoilerplate?.(value.base);
  const supplied = Object.keys(changes).length;
  context.onResolvedFiles?.({ supplied, reused: existing ? FILE_PATHS.length - supplied : 0, expanded: value.base ? FILE_PATHS.length - supplied : 0, defaulted: !existing && !value.base && !Object.hasOwn(changes, 'src/styles.css') ? 1 : 0 });
  let assets: AppAsset[] | undefined;
  try { assets = value.assets === undefined ? context.previousAssets : validateAssets(value.assets); }
  catch (cause) { throw new GenerationValidationError(cause instanceof Error ? cause.message : 'Invalid assets.', files); }
  return { ...metadata, files, ...(assets === undefined ? {} : { assets }) };
}
export function promptText(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 3 || value.length > 12_000) throw new Error('Describe your app in 3–12,000 characters.');
  return value.trim();
}
