import { readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CompiledContract, type Contract } from '@midnight-ntwrk/compact-js';
import { createUnprovenCallTx, createUnprovenDeployTx } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import type { UnboundTransaction } from '@midnight-ntwrk/midnight-js-types';
import * as ledger from '@midnightntwrk/ledger-v9';
import { WebSocket } from 'ws';
import { readBuildManifest, type CircuitInfo } from './compact.ts';
import type { DeploymentResult } from './chain.ts';
import { confirmDeployment, type DeploymentJournal } from './deployment-status.js';
import { serialiseLedgerState } from './ledger-state.ts';

const emit = (type: string, value: unknown) => process.stdout.write(JSON.stringify({ type, value }) + '\n');
const config = {
  indexer: process.env.BUILDER_INDEXER_URL || 'https://indexer.stagenet.shielded.tools/api/v4/graphql',
  node: process.env.BUILDER_NODE_URL || 'wss://rpc.stagenet.shielded.tools',
  prover: process.env.BUILDER_PROOF_SERVER_URL || 'https://67-205-177-162.sslip.io/prover',
  sponsor: process.env.BUILDER_SPONSOR_URL || 'https://67-205-177-162.sslip.io/balancer',
};

function address(value: string): string {
  const clean = value.replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new Error('Invalid stage-net contract address.');
  return clean;
}

function argumentsFor(circuit: CircuitInfo, args: unknown[]): unknown[] {
  if (args.length !== circuit.arguments.length) throw new Error(`Circuit ${circuit.name} expects ${circuit.arguments.length} arguments.`);
  return circuit.arguments.map((argument, index) => {
    const value = args[index];
    const kind = argument.type['type-name'];
    if (kind === 'Uint' || kind === 'Field') {
      if ((typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ||
          (typeof value === 'string' && /^\d{1,78}$/.test(value))) return BigInt(value);
      throw new Error(`${argument.name} must be an unsigned integer (large values must be decimal strings).`);
    }
    if (kind === 'Boolean' && typeof value === 'boolean') return value;
    if (kind === 'Bytes' && typeof value === 'string') {
      const hex = value.replace(/^0x/, '');
      if (/^[a-fA-F0-9]*$/.test(hex) && hex.length === Number(argument.type.length) * 2) return new Uint8Array(Buffer.from(hex, 'hex'));
    }
    throw new Error(`Unsupported value for ${argument.name}. This release supports Uint, Field, Boolean, and Bytes arguments.`);
  });
}

function assertNoValue(tx: UnboundTransaction, expected: { deploy: true } | { address: string; circuit: string }): void {
  if (tx.rewards || tx.guaranteedOffer || (tx.fallibleOffer?.size ?? 0) > 0 || !tx.intents?.size) throw new Error('Only no-value contract transactions are supported.');
  let count = 0;
  for (const [segment, intent] of tx.intents) {
    if (intent.dustActions || intent.guaranteedUnshieldedOffer || intent.fallibleUnshieldedOffer) throw new Error('A generated transaction attempted to move tokens or DUST.');
    for (const imbalance of tx.imbalances(segment).values()) if (imbalance !== 0n) throw new Error('A generated transaction has a token imbalance.');
    for (const action of intent.actions) {
      count += 1;
      if ('deploy' in expected) {
        if (!(action instanceof ledger.ContractDeploy)) throw new Error('Unexpected action in a deployment.');
      } else {
        const entry = action instanceof ledger.ContractCall ? action.entryPoint : undefined;
        const entryName = typeof entry === 'string' ? entry : entry ? new TextDecoder().decode(entry) : '';
        if (!(action instanceof ledger.ContractCall) || action.address !== expected.address || entryName !== expected.circuit) {
          throw new Error('The prepared transaction does not match the requested circuit.');
        }
      }
    }
  }
  if (count !== 1) throw new Error('Exactly one contract action is required.');
}

function applyTtl(tx: ledger.UnprovenTransaction): void {
  const intents = tx.intents;
  if (!intents) throw new Error('No contract intent was created.');
  for (const [segment, intent] of intents) {
    intent.ttl = new Date(Date.now() + 30 * 60_000);
    intents.set(segment, intent);
  }
  tx.intents = intents;
}

async function saveJournal(buildDir: string, journal: DeploymentResult): Promise<void> {
  await writeFile(join(buildDir, 'deployment.tmp.json'), JSON.stringify(journal, null, 2), { mode: 0o600 });
  await rename(join(buildDir, 'deployment.tmp.json'), join(buildDir, 'deployment.json'));
}

async function confirm(buildDir: string, journal: DeploymentJournal): Promise<DeploymentJournal> {
  return confirmDeployment(journal, { indexer: config.indexer, persist: value => saveJournal(buildDir, value) });
}

async function submit(tx: ledger.FinalizedTransaction): Promise<void> {
  // Keep the connection open through submission. The beta wallet adapter's
  // disconnect/reconnect lifecycle can close it while author_submit is pending.
  const { ApiPromise, WsProvider } = await import('@polkadot/api');
  const api = await ApiPromise.create({ provider: new WsProvider(config.node.replace(/^http/, 'ws')), noInitWarn: true });
  try {
    const networkName = String(await api.rpc.system.chain());
    if (!/stagenet/i.test(networkName)) throw new Error(`Expected stage-net; the node reports ${networkName}.`);
    const extrinsic = api.tx.midnight!.sendMnTransaction!(`0x${Buffer.from(tx.serialize()).toString('hex')}`);
    await api.rpc.author.submitExtrinsic(extrinsic.toHex());
  } finally { await api.disconnect(); }
}

async function main(input: { operation: string; buildDir: string; contractAddress?: string; circuit?: string; args?: unknown[] }): Promise<unknown> {
  setNetworkId('stagenet');
  globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;
  for (const url of Object.values(config)) {
    const endpoint = new URL(url);
    if (/\b(preview|preprod|mainnet)\b/i.test(endpoint.hostname)) throw new Error('Passport Builder only supports stage-net services.');
  }
  const manifest = await readBuildManifest(input.buildDir);
  const managed = join(input.buildDir, 'managed');
  // The only executable input is this server's verified compactc output. Runtime
  // resolution is pinned here so a volume cannot supply its own node_modules.
  const original = await readFile(join(managed, 'contract/index.js'), 'utf8');
  const preamble = "import * as __compactRuntime from '@midnight-ntwrk/compact-runtime';";
  if (!original.startsWith(preamble)) throw new Error('Unrecognised Compact compiler output.');
  const require = createRequire(import.meta.url);
  const runtime = pathToFileURL(require.resolve('@midnight-ntwrk/compact-runtime')).href;
  const code = original.replace(preamble, `import * as __compactRuntime from ${JSON.stringify(runtime)};`).replace(/^\/\/# sourceMappingURL=.*$/gm, '');
  const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  const compiledContract = CompiledContract.make<Contract<undefined>, undefined>('contract', module.Contract).pipe(CompiledContract.withVacantWitnesses, CompiledContract.withCompiledFileAssets(managed));
  const zkConfigProvider = new NodeZkConfigProvider(managed);
  const proofProvider = httpClientProofProvider({ url: config.prover, zkConfigProvider, timeout: 240_000 });
  const coinPublicKey = ledger.sampleCoinPublicKey();
  const encryptionPublicKey = ledger.sampleEncryptionPublicKey();
  const walletProvider = {
    getCoinPublicKey: () => coinPublicKey,
    getEncryptionPublicKey: () => encryptionPublicKey,
    balanceTx: async () => { throw new Error('Wallet balancing is not available in a builder worker.'); },
  };

  if (input.operation === 'deploy') {
    let saved: DeploymentJournal | undefined;
    try { saved = JSON.parse(await readFile(join(input.buildDir, 'deployment.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (saved) {
      if (saved.network !== 'stagenet') throw new Error('The deployment journal belongs to a different network.');
      const checked = await confirm(input.buildDir, saved);
      if (checked.status === 'confirmed') return checked;
      const bytes = await readFile(join(input.buildDir, 'deployment-transaction.bin'));
      const tx = ledger.Transaction.deserialize<ledger.SignatureEnabled, ledger.Proof, ledger.Binding>('signature', 'proof', 'binding', bytes);
      await submit(tx);
      return confirm(input.buildDir, saved);
    }
    const signingKey = ledger.sampleSigningKey();
    const created = await createUnprovenDeployTx({ walletProvider, zkConfigProvider }, { compiledContract, signingKey, args: [] });
    applyTtl(created.private.unprovenTx);
    const proven = await proofProvider.proveTx(created.private.unprovenTx);
    assertNoValue(proven, { deploy: true });
    const initial = proven.bind();
    await writeFile(join(input.buildDir, 'maintenance-key.json'), JSON.stringify(signingKey), { mode: 0o600 });
    const response = await fetch(`${config.sponsor.replace(/\/+$/, '')}/balance-only`, {
      method: 'POST', headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.from(initial.serialize()), signal: AbortSignal.timeout(180_000),
    });
    const sponsorBody = await response.text();
    let body: { txBytes?: string; message?: string; error?: string };
    try { body = JSON.parse(sponsorBody); }
    catch { throw new Error(`Stage-net sponsor returned HTTP ${response.status} without JSON: ${sponsorBody.slice(0, 200)}`); }
    if (!response.ok || typeof body.txBytes !== 'string' || !/^[a-fA-F0-9]+$/.test(body.txBytes) || body.txBytes.length % 2) {
      throw new Error(`Stage-net sponsorship failed: ${body.message || body.error || response.status}.`);
    }
    const balanced = ledger.Transaction.deserialize<ledger.SignatureEnabled, ledger.Proof, ledger.Binding>('signature', 'proof', 'binding', Buffer.from(body.txBytes, 'hex'));
    const txId = initial.identifiers()[0];
    if (!txId || !balanced.identifiers().includes(txId)) throw new Error('The sponsor returned a different transaction.');
    const journal: DeploymentResult = {
      contractAddress: String(created.public.contractAddress), txId, txHash: String(balanced.transactionHash()),
      network: 'stagenet', status: 'submitted',
    };
    // Persist before the network call: a lost HTTP/WS answer must not deploy again.
    await writeFile(join(input.buildDir, 'deployment-transaction.bin'), balanced.serialize(), { mode: 0o600 });
    await saveJournal(input.buildDir, journal);
    emit('submitted', journal);
    await submit(balanced);
    return confirm(input.buildDir, journal);
  }

  const contractAddress = address(input.contractAddress || '');
  const publicDataProvider = indexerPublicDataProvider(config.indexer, `${config.indexer.replace(/^http/, 'ws').replace(/\/+$/, '')}/ws`);
  try {
    if (input.operation === 'state') {
      const state = await publicDataProvider.queryContractState(contractAddress);
      if (!state) throw new Error('The contract is not indexed on stage-net yet.');
      const decoded = module.ledger(state.data);
      return serialiseLedgerState(decoded);
    }
    if (input.operation !== 'call') throw new Error('Unknown chain operation.');
    const circuit = manifest.circuitDetails.find((entry) => entry.name === input.circuit);
    if (!circuit) throw new Error('The circuit is not present in this compiled build.');
    const created = await createUnprovenCallTx({ zkConfigProvider, publicDataProvider, walletProvider }, {
      compiledContract, contractAddress, circuitId: circuit.name, args: argumentsFor(circuit, input.args || []),
    });
    applyTtl(created.private.unprovenTx);
    const proven = await proofProvider.proveTx(created.private.unprovenTx);
    assertNoValue(proven, { address: contractAddress, circuit: circuit.name });
    return { txId: proven.identifiers()[0], transaction: Buffer.from(proven.serialize()).toString('hex'), contractAddress, circuit: circuit.name, network: 'stagenet' };
  } finally { await publicDataProvider.dispose(); }
}

let raw = '';
for await (const chunk of process.stdin) {
  raw += String(chunk);
  if (raw.length > 128 * 1024) throw new Error('The chain request is too large.');
}
try { emit('result', await main(JSON.parse(raw))); }
catch (error) {
  process.stdout.write(JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : String(error) }) + '\n');
  process.exitCode = 1;
}
