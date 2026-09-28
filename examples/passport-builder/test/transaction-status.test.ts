import assert from 'node:assert/strict';
import test from 'node:test';
import { readTransactionStatus } from '../service/transaction-status.ts';

const txId = '00' + '01'.repeat(32);
const contractAddress = 'ab'.repeat(32);
const input = { txId, contractAddress, circuits: ['createTask'] };
function indexed(status = 'SUCCESS') {
  return { hash: '99'.repeat(32), identifiers: [txId, '02'.repeat(32)], block: { height: 461379 }, transactionResult: { status }, contractActions: [{ __typename: 'ContractCall', address: contractAddress, entryPoint: 'createTask' }] };
}
const reply = (transactions: unknown[], errors?: unknown[]) => (async () => Response.json({ data: { transactions }, ...(errors ? { errors } : {}) })) as typeof fetch;

test('confirms exact indexed identifier, successful execution, deployed address, and circuit', async () => {
  let request: any;
  const fetcher = (async (_url, init) => { request = JSON.parse(String(init?.body)); return Response.json({ data: { transactions: [indexed()] } }); }) as typeof fetch;
  assert.deepEqual(await readTransactionStatus(input, fetcher), { status: 'confirmed', txId, blockHeight: 461379 });
  assert.deepEqual(request.variables, { identifier: txId });
  assert.match(request.query, /transactionResult/);
});

test('missing or neighbouring transactions remain submitted, never confirmed', async () => {
  assert.deepEqual(await readTransactionStatus(input, reply([])), { status: 'submitted', txId });
  assert.deepEqual(await readTransactionStatus(input, reply([{ ...indexed(), identifiers: ['03'.repeat(32)] }])), { status: 'submitted', txId });
});

test('refuses other contracts, deployment transactions, and circuits absent from the published build', async () => {
  for (const action of [
    { __typename: 'ContractCall', address: 'cd'.repeat(32), entryPoint: 'createTask' },
    { __typename: 'ContractDeploy', address: contractAddress },
    { __typename: 'ContractCall', address: contractAddress, entryPoint: 'withdraw' },
  ]) await assert.rejects(readTransactionStatus(input, reply([{ ...indexed(), contractActions: [action] }])), (error: any) => error.status === 404);
});

test('unsuccessful indexed execution never reports confirmation and partial writes require ledger review', async () => {
  const partial = await readTransactionStatus(input, reply([indexed('PARTIAL_SUCCESS')]));
  assert.equal(partial.status, 'failed'); assert.match(partial.message!, /partially.*ledger/);
  const failure = await readTransactionStatus(input, reply([indexed('FAILURE')]));
  assert.equal(failure.status, 'failed'); assert.match(failure.message!, /failed/);
});

test('invalid IDs never reach indexer and unavailable/malformed confirmation is an explicit error', async () => {
  await assert.rejects(readTransactionStatus({ ...input, txId: 'bad"query' }, (() => { throw new Error('must not fetch'); }) as typeof fetch), /Invalid transaction/);
  for (const fetcher of [
    reply([], [{ message: 'schema unavailable' }]),
    reply([{ ...indexed(), block: {} }]),
    reply([indexed('UNRECOGNISED')]),
    (async () => { throw new Error('network failed'); }) as typeof fetch,
    (async () => new Response('upstream unavailable', { status: 503 })) as typeof fetch,
  ]) await assert.rejects(readTransactionStatus(input, fetcher), (error: any) => error.status === 502);
});
