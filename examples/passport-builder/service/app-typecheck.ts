import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const checked = new Map<string, Promise<void>>();
/** Typecheck untrusted source in a bounded process; never execute it. */
export function checkApp(source: string): Promise<void> {
  const key = createHash('sha256').update(source).digest('hex');
  const cached = checked.get(key);
  if (cached) return cached;
  const result = new Promise<void>((resolve, reject) => {
    const child = execFile(process.execPath, ['--max-old-space-size=384', fileURLToPath(new URL('./app-typecheck-worker.mjs', import.meta.url))], {
      timeout: 15_000, killSignal: 'SIGKILL', maxBuffer: 16_384,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'TMPDIR', 'TEMP', 'TMP'].includes(key))),
    }, (error, stdout) => {
      if (error) { reject(new Error('The generated UI could not be typechecked within its resource limits. Simplify its types and try again.')); return; }
      try {
        const result = JSON.parse(stdout);
        if (!Array.isArray(result.errors) || result.errors.some((value: unknown) => typeof value !== 'string')) throw new Error();
        if (result.errors.length) reject(new Error(`Generated UI integration errors:\n${result.errors.join('\n')}`));
        else resolve();
      } catch { reject(new Error('The generated UI typechecker did not return a valid result.')); }
    });
    child.stdin?.on('error', () => { /* execFile reports a failed worker. */ });
    child.stdin?.end(source);
  }).catch(error => {
    if (checked.get(key) === result) checked.delete(key);
    throw error;
  });
  checked.set(key, result);
  if (checked.size > 32) checked.delete(checked.keys().next().value!);
  return result;
}
