import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface DeploymentResult {
  contractAddress: string;
  txId: string;
  txHash: string;
  network: 'stagenet';
  status: 'submitted' | 'confirmed';
  blockHeight?: number;
}
export interface PreparedCall {
  txId: string;
  transaction: string;
  contractAddress: string;
  circuit: string;
  network: 'stagenet';
}

type Input = { buildDir: string; contractAddress?: string; circuit?: string; args?: unknown[] };

/** Each generated contract executes in a bounded process without service credentials. */
function run<T>(operation: string, input: Input, onSubmitted?: (result: DeploymentResult) => void | Promise<void>): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = fileURLToPath(new URL('./chain-worker.ts', import.meta.url));
    const child = spawn(process.execPath, ['--max-old-space-size=1024', '--import', 'tsx', worker], {
      shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) =>
        ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'NODE_EXTRA_CA_CERTS', 'BUILDER_PROOF_SERVER_URL',
          'BUILDER_SPONSOR_URL', 'BUILDER_INDEXER_URL', 'BUILDER_NODE_URL'].includes(key))),
    });
    let pending = '';
    let errorOutput = '';
    let result: T | undefined;
    let failure: Error | undefined;
    let callbacks = Promise.resolve();
    let total = 0;
    const timer = setTimeout(() => {
      failure = new Error('The chain operation timed out. A submitted deployment is retained for reconciliation.');
      child.kill('SIGKILL');
    }, 360_000);
    child.stdin.end(JSON.stringify({ operation, ...input }));
    child.stderr.on('data', (data: Buffer) => { errorOutput = (errorOutput + data.toString()).slice(-4096); });
    child.stdout.on('data', (data: Buffer) => {
      total += data.length;
      if (total > 8 * 1024 * 1024) {
        failure = new Error('The chain worker exceeded its output limit.');
        child.kill('SIGKILL');
        return;
      }
      pending += data.toString();
      for (;;) {
        const newline = pending.indexOf('\n');
        if (newline < 0) break;
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (!line.startsWith('{')) continue;
        try {
          const message = JSON.parse(line);
          if (message.type === 'result') result = message.value as T;
          if (message.type === 'error') failure = new Error(String(message.message));
          if (message.type === 'submitted' && onSubmitted) callbacks = callbacks.then(() => onSubmitted(message.value));
        } catch { /* SDK diagnostic output is not part of the worker protocol. */ }
      }
    });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      void callbacks.then(() => {
        if (failure) reject(failure);
        else if (code !== 0 || result === undefined) reject(new Error(errorOutput || `Chain worker exited with code ${code}.`));
        else resolve(result);
      }, reject);
    });
  });
}

export function deployBuild({ buildDir, onSubmitted }: {
  buildDir: string; onSubmitted?: (result: DeploymentResult) => void | Promise<void>;
}): Promise<DeploymentResult> {
  return run('deploy', { buildDir }, onSubmitted);
}

export function prepareCall(input: { buildDir: string; contractAddress: string; circuit: string; args?: unknown[] }): Promise<PreparedCall> {
  return run('call', input);
}

export function readContractState(input: { buildDir: string; contractAddress: string }): Promise<Record<string, unknown>> {
  return run('state', input);
}
