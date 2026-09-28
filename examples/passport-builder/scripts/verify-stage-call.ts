/** Explicit operator probe of a permissionless, no-value call. This does not simulate user/passkey consent. */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { inspectContractTransaction, assertSponsoredContractTransaction } from '../../passport-demo/src/lib/contractTxApproval.js';
import { readTransactionStatus } from '../service/transaction-status.js';

const flags = process.argv.slice(2);
const value = (name: string) => { const at = flags.indexOf(name); if (at < 0 || !flags[at + 1]) throw new Error(`Missing ${name}`); return flags[at + 1]; };
if (!flags.includes('--execute')) throw new Error('Pass --execute to submit one no-value stage-net call. Existing journals only reconcile.');
const project = value('--project'); const deployment = value('--deployment');
const contractAddress = value('--address'); const circuit = value('--circuit'); const args = JSON.parse(value('--args'));
const directory = resolve(value('--journal'));
await mkdir(directory, { recursive: true, mode: 0o700 });
const file = join(directory, 'call.json');
const save = async (v: unknown) => { await writeFile(`${file}.tmp`, JSON.stringify(v, null, 2), { mode: 0o600 }); await rename(`${file}.tmp`, file); };
let journal: any;
try { journal = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const metadata = { project, deployment, contractAddress, circuit, args };
if (journal && JSON.stringify(journal.request) !== JSON.stringify(metadata)) throw new Error('This journal belongs to a different call.');
const base = `https://builder.midnightpassport.com/api/runtime/${project}`;
const api = async (path: string, body?: unknown) => {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://builder.midnightpassport.com' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(300_000) });
  const data = await response.json(); if (!response.ok) throw new Error(JSON.stringify(data)); return data;
};
if (journal && !journal.txId) throw new Error('A previous preparation was interrupted. Inspect the journal; no request repeated.');
if (!journal) {
  journal = { request: metadata, status: 'preparing', startedAt: new Date().toISOString() }; await save(journal);
  journal.ledgerBefore = await api(`/ledger?deployment=${deployment}`); await save(journal);
  const prepared = await api('/prepare', { deploymentId: deployment, circuit, args });
  const intent = { networkId: 'stagenet' as const, transaction: prepared.transaction, contractAddress, entryPoint: circuit, purpose: `Operator verification: ${circuit}` };
  const approved = inspectContractTransaction(intent, 'stagenet');
  journal.txId = approved.identifiers()[0]; journal.status = 'prepared'; await save(journal);
  // Use the same ledger instance as Passport's inspection, including instanceof checks.
  const requireDemo = createRequire(new URL('../../passport-demo/package.json', import.meta.url));
  const ledger = await import(requireDemo.resolve('@midnightntwrk/ledger-v9'));
  const response = await fetch('https://67-205-177-162.sslip.io/balancer/balance-only', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from(approved.bind().serialize()), signal: AbortSignal.timeout(180_000) });
  const body = await response.json(); if (!response.ok || typeof body.txBytes !== 'string') throw new Error(`Sponsor rejected request: ${String(body.message || body.error || response.status)}`);
  const balanced = ledger.Transaction.deserialize('signature', 'proof', 'binding', Buffer.from(body.txBytes.replace(/^0x/, ''), 'hex'));
  assertSponsoredContractTransaction(approved, balanced);
  await writeFile(join(directory, 'transaction.bin'), balanced.serialize(), { mode: 0o600 });
  journal.status = 'submission-unknown'; await save(journal);
  const node = await ApiPromise.create({ provider: new WsProvider('wss://rpc.stagenet.shielded.tools'), noInitWarn: true });
  try {
    if (!/stagenet/i.test(String(await node.rpc.system.chain()))) throw new Error('Refusing a non-stage-net node.');
    const extrinsic = node.tx.midnight!.sendMnTransaction!(`0x${Buffer.from(balanced.serialize()).toString('hex')}`);
    await node.rpc.author.submitExtrinsic(extrinsic.toHex());
    journal.status = 'submitted'; await save(journal);
  } finally { await node.disconnect(); }
  console.log(JSON.stringify({ stage: 'submitted', txId: journal.txId }));
}
for (let n = 0; n < 30; n++) {
  let result;
  try { result = await readTransactionStatus({ txId: journal.txId, contractAddress, circuits: [circuit] }); }
  catch (cause) {
    if ((cause as { status?: number }).status !== 502) throw cause;
    console.log('Indexer unavailable; retaining the exact transaction identifier.');
    await new Promise(resolve => setTimeout(resolve, 4000)); continue;
  }
  if (result.status !== 'submitted') {
    journal.result = result; journal.status = result.status;
    journal.ledgerAfter = await api(`/ledger?deployment=${deployment}`); await save(journal);
    console.log(JSON.stringify({ ...result, circuit, ledgerAfter: journal.ledgerAfter }));
    process.exit(result.status === 'confirmed' ? 0 : 1);
  }
  await new Promise(resolve => setTimeout(resolve, 4000));
}
console.log(JSON.stringify({ status: journal.status, txId: journal.txId, message: 'Confirmation pending. Run with this same journal to check; it will not resubmit.' }));
process.exit(2);
