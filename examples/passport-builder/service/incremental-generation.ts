import type { ProjectFiles } from '../shared/types.js';
import { FILE_PATHS } from './validation.js';

export interface PartialGenerationFiles {
  files: ProjectFiles;
  completedFiles: string[];
  activeFile?: string;
}
type ObjectFrame = { kind: 'object'; role: 'root' | 'files' | 'other'; state: 'keyOrEnd' | 'key' | 'colon' | 'value' | 'commaOrEnd'; key?: string };
type ArrayFrame = { kind: 'array'; state: 'valueOrEnd' | 'value' | 'commaOrEnd' };
type Frame = ObjectFrame | ArrayFrame;

/** A streaming JSON lexer/parser for display only. Full validation remains mandatory. */
export class IncrementalGenerationParser {
  private prefix = '';
  private started = false;
  private rootStarted = false;
  private stack: Frame[] = [];
  private mode: 'normal' | 'string' | 'number' | 'literal' = 'normal';
  private token = '';
  private literal = '';
  private stringKey = false;
  private capture?: string;
  private escape = false;
  private unicode: string | null = null;
  private files: ProjectFiles = {};
  private completed = new Set<string>();
  private activeFile?: string;
  error?: string;

  push(delta: string): void {
    if (this.error) return;
    if (!this.started) {
      this.prefix += delta;
      let text = this.prefix.trimStart();
      if (!text) return;
      if (text.startsWith('`')) {
        if ('```'.startsWith(text)) return;
        if (text.startsWith('```')) {
          text = text.slice(3);
          if (!text || 'json'.startsWith(text)) return;
          if (text.startsWith('json')) text = text.slice(4);
          text = text.trimStart();
          if (!text) return;
        }
      }
      this.prefix = ''; this.started = true; delta = text;
    }
    try { for (const char of delta) this.read(char); }
    catch (error) { this.error = error instanceof Error ? error.message : 'Malformed JSON.'; }
  }

  snapshot(): PartialGenerationFiles {
    return { files: { ...this.files }, completedFiles: [...this.completed], ...(this.activeFile === undefined ? {} : { activeFile: this.activeFile }) };
  }

  private append(char: string): void {
    if (this.stringKey) this.token += char;
    else if (this.capture) {
      if (this.files[this.capture].length + char.length > 100_000) throw new Error('Generated file exceeds its display limit.');
      this.files[this.capture] += char;
    }
  }

  /** Move the parent past a value, preserving its path before opening a child. */
  private startValue(): { root: boolean; filesObject: boolean; file?: string } {
    const parent = this.stack.at(-1);
    const root = !parent && !this.rootStarted;
    if (!parent) {
      if (this.rootStarted) throw new Error('Unexpected second JSON value.');
      this.rootStarted = true;
    } else {
      if (parent.state !== 'value' && !(parent.kind === 'array' && parent.state === 'valueOrEnd')) throw new Error('Unexpected JSON value.');
      parent.state = 'commaOrEnd';
    }
    const filesObject = parent?.kind === 'object' && parent.role === 'root' && parent.key === 'files';
    const file = parent?.kind === 'object' && parent.role === 'files' && FILE_PATHS.includes(parent.key as typeof FILE_PATHS[number]) ? parent.key : undefined;
    // JSON permits duplicate keys. A later value replaces the earlier value,
    // including a second root files object or a non-string replacement.
    if (filesObject) { this.files = {}; this.completed.clear(); this.activeFile = undefined; }
    if (file) { delete this.files[file]; this.completed.delete(file); this.activeFile = undefined; }
    return { root, filesObject, file };
  }

  private read(char: string): void {
    if (this.mode === 'string') {
      if (this.unicode !== null) {
        if (!/^[a-fA-F0-9]$/.test(char)) throw new Error('Invalid JSON Unicode escape.');
        this.unicode += char;
        if (this.unicode.length === 4) { this.append(String.fromCharCode(Number.parseInt(this.unicode, 16))); this.unicode = null; }
        return;
      }
      if (this.escape) {
        this.escape = false;
        if (char === 'u') { this.unicode = ''; return; }
        const escapes: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (!(char in escapes)) throw new Error('Invalid JSON escape.');
        this.append(escapes[char]); return;
      }
      if (char === '\\') { this.escape = true; return; }
      if (char === '"') {
        this.mode = 'normal';
        if (this.stringKey) {
          const frame = this.stack.at(-1) as ObjectFrame;
          frame.key = this.token; frame.state = 'colon';
        } else if (this.capture) { this.completed.add(this.capture); this.activeFile = undefined; }
        this.token = ''; this.capture = undefined; return;
      }
      if (char.charCodeAt(0) < 0x20) throw new Error('Unescaped control character in JSON string.');
      this.append(char); return;
    }
    if (this.mode === 'literal') {
      this.token += char;
      if (!this.literal.startsWith(this.token)) throw new Error('Invalid JSON literal.');
      if (this.token === this.literal) { this.mode = 'normal'; this.token = ''; }
      return;
    }
    if (this.mode === 'number') {
      if (/^[0-9eE+.\-]$/.test(char)) { this.token += char; return; }
      if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+\-]?\d+)?$/.test(this.token)) throw new Error('Invalid JSON number.');
      this.mode = 'normal'; this.token = ''; this.read(char); return;
    }
    if (/^[\x20\t\r\n]$/.test(char)) return;
    // A trailing markdown fence is handled by the final full-response parser.
    // Nothing after a complete root can introduce more displayable file text.
    if (this.rootStarted && this.stack.length === 0) return;
    const frame = this.stack.at(-1);
    if (char === '"') {
      this.stringKey = frame?.kind === 'object' && ['keyOrEnd', 'key'].includes(frame.state);
      this.capture = undefined; this.token = '';
      if (!this.stringKey) {
        const context = this.startValue(); this.capture = context.file;
        if (this.capture) { this.files[this.capture] = ''; this.activeFile = this.capture; }
      }
      this.mode = 'string'; return;
    }
    if (char === '{' || char === '[') {
      const context = this.startValue();
      this.stack.push(char === '{'
        ? { kind: 'object', role: context.root ? 'root' : context.filesObject ? 'files' : 'other', state: 'keyOrEnd' }
        : { kind: 'array', state: 'valueOrEnd' });
      return;
    }
    if (char === '}') {
      if (frame?.kind !== 'object' || !['keyOrEnd', 'commaOrEnd'].includes(frame.state)) throw new Error('Unexpected JSON object end.');
      this.stack.pop(); return;
    }
    if (char === ']') {
      if (frame?.kind !== 'array' || !['valueOrEnd', 'commaOrEnd'].includes(frame.state)) throw new Error('Unexpected JSON array end.');
      this.stack.pop(); return;
    }
    if (char === ':') {
      if (frame?.kind !== 'object' || frame.state !== 'colon') throw new Error('Unexpected JSON colon.');
      frame.state = 'value'; return;
    }
    if (char === ',') {
      if (!frame || frame.state !== 'commaOrEnd') throw new Error('Unexpected JSON comma.');
      frame.state = frame.kind === 'object' ? 'key' : 'value'; return;
    }
    if (char === '-' || /^[0-9]$/.test(char)) {
      this.startValue(); this.mode = 'number'; this.token = char; return;
    }
    if (['t', 'f', 'n'].includes(char)) {
      this.startValue(); this.mode = 'literal'; this.literal = char === 't' ? 'true' : char === 'f' ? 'false' : 'null'; this.token = char; return;
    }
    throw new Error('Unexpected character in JSON.');
  }
}
