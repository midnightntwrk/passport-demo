import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmDeployment, readDeploymentStatus, type DeploymentJournal } from '../service/deployment-status.js';

const indexer = 'https://indexer.stagenet.shielded.tools/api/v4/graphql';
const journal: DeploymentJournal = { network: 'stagenet', txId: '00' + 'ab'.repeat(32), contractAddress: 'cd'.repeat(32), txHash: 'ef'.repeat(32), status: 'submitted' };
const input = { ...journal, indexer };
function indexed(status = 'SUCCESS') { return { identifiers: [journal.txId], hash: journal.txHash, block: { height: 42 }, transactionResult: { status }, contractActions: [{ __typename: 'ContractDeploy', address: journal.contractAddress }] }; }
const reply = (transactions: unknown[]) => (async () => Response.json({ data: { transactions } })) as typeof fetch;

test('deployment confirmation finds the exact successful deploy rather than the first indexed transaction', async () => {
  const neighbour = { ...indexed(), identifiers: ['00' + '00'.repeat(32)], hash: '11'.repeat(32) };
  const result = await readDeploymentStatus(input, reply([neighbour, indexed()]));
  assert.deepEqual(result, { status: 'confirmed', txHash: journal.txHash, blockHeight: 42 });
  assert.deepEqual(await readDeploymentStatus(input, reply([neighbour])), { status: 'submitted' });
  assert.deepEqual(await readDeploymentStatus(input, reply([])), { status: 'submitted' });
});

test('failed execution, a wrong deployment, and additional contract actions can never confirm', async () => {
  for (const transaction of [
    indexed('FAILURE'), indexed('PARTIAL_SUCCESS'), { ...indexed('FAILURE'), contractActions: [] },
    { ...indexed(), contractActions: [{ __typename: 'ContractDeploy', address: '01'.repeat(32) }] },
    { ...indexed(), contractActions: [{ __typename: 'ContractCall', address: journal.contractAddress }] },
    { ...indexed(), contractActions: [...indexed().contractActions, { __typename: 'ContractCall', address: journal.contractAddress }] },
  ]) assert.equal((await readDeploymentStatus(input, reply([transaction]))).status, 'failed');
});

test('invalid identifiers, malformed blocks, unknown results, and unavailable indexer never confirm', async () => {
  for (const invalid of [{ ...input, txId: 'bad' }, { ...input, contractAddress: 'bad' }, { ...input, indexer: 'https://indexer.mainnet.example' }]) {
    await assert.rejects(readDeploymentStatus(invalid, (() => { throw new Error('must not fetch'); }) as typeof fetch), /Invalid saved|stage-net/);
  }
  for (const transaction of [{ ...indexed(), block: {} }, { ...indexed(), hash: '' }, indexed('UNKNOWN')]) await assert.rejects(readDeploymentStatus(input, reply([transaction])));
  await assert.rejects(readDeploymentStatus(input, (async () => Response.json({ errors: [{ message: 'unavailable' }] }, { status: 503 })) as typeof fetch));
});

test('terminal indexed failure is journalled before throwing and cannot reach a rebroadcast on retry', async () => {
  let saved = journal; let requests = 0; let rebroadcasts = 0;
  const options = { indexer, attempts: 1,
    fetcher: (async () => { requests++; return Response.json({ data: { transactions: [indexed('FAILURE')] } }); }) as typeof fetch,
    persist: async (value: DeploymentJournal) => { saved = value; },
  };
  async function workerResume() {
    const checked = await confirmDeployment(saved, options);
    if (checked.status !== 'confirmed') rebroadcasts++;
  }
  await assert.rejects(workerResume(), /indexed deployment transaction failed/);
  assert.equal(saved.txId, journal.txId); assert.equal(saved.status, 'submitted'); assert.match(saved.confirmationError!, /retry is disabled/);
  await assert.rejects(workerResume(), /indexed deployment transaction failed/);
  assert.equal(requests, 1); assert.equal(rebroadcasts, 0);
});

test('verified confirmation is durable and legacy inclusion-only journals must be rechecked', async () => {
  const writes: DeploymentJournal[] = [];
  const legacy: DeploymentJournal = { ...journal, status: 'confirmed' };
  const result = await confirmDeployment(legacy, { indexer, attempts: 1, fetcher: reply([indexed()]), persist: async value => { writes.push(value); } });
  assert.equal(writes[0].status, 'submitted'); assert.equal(result.status, 'confirmed'); assert.equal(result.confirmationVersion, 1);
  assert.equal(writes.at(-1), result);
  assert.equal(await confirmDeployment(result, { indexer, fetcher: (() => { throw new Error('Already verified'); }) as typeof fetch, persist: async () => { throw new Error('Already saved'); } }), result);
  const unavailable = await confirmDeployment(legacy, { indexer, attempts: 1, fetcher: reply([]), persist: async value => { assert.equal(value.status, 'submitted'); } });
  assert.equal(unavailable.status, 'submitted'); assert.equal(unavailable.txId, legacy.txId);
});

test('transient indexer errors retain the saved pending identity without a terminal failure', async () => {
  let writes = 0;
  const result = await confirmDeployment(journal, { indexer, attempts: 1, fetcher: (async () => { throw new Error('Network unavailable'); }) as typeof fetch, persist: async () => { writes++; } });
  assert.equal(result.status, 'submitted'); assert.equal(result.txId, journal.txId); assert.equal(result.confirmationError, undefined); assert.equal(writes, 0);
});
