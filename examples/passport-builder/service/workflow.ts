import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Project, Deployment } from '../shared/types.js';
import { config, dataDir, defaultModel } from './config.js';
import { Registry } from './registry.js';
import { generate } from './generation.js';
import { compileContract, readBuildManifest } from './compact.js';
import { deployBuild, readContractState, type DeploymentResult } from './chain.js';
import { bundleApp } from './bundle.js';
import { GenerationAttempt } from './generation-progress.js';
import type { GenerationProgress } from '../shared/generation.js';
import { resolveAssets } from './assets.js';
import { ModelServiceError } from './model-stream.js';
import { GenerationValidationError, UnsupportedAppError } from './validation.js';

type DeploymentJournal = Pick<DeploymentResult, 'network' | 'txId' | 'contractAddress'>;
type WorkflowDependencies = {
  generate?: typeof generate;
  compile?: (project: Project) => Promise<void>;
  bundle?: typeof bundleApp;
  compileContract?: typeof compileContract;
  readBuildManifest?: typeof readBuildManifest;
  deploy?: typeof deployBuild;
  readState?: typeof readContractState;
  readJournal?: (buildDir: string) => Promise<DeploymentJournal | undefined>;
  buildsDirectory?: string;
  autoPublish?: boolean;
};

export class Workflow {
  active = new Set<string>();
  private generation = new Map<string, GenerationProgress>();
  constructor(private registry: Registry, private dependencies: WorkflowDependencies = {}) {}
  private buildDirectory(id: string) { return join(this.dependencies.buildsDirectory || join(dataDir, 'builds'), id); }
  private get autoPublish() { return this.dependencies.autoPublish ?? config.deploymentConfigured; }
  getGeneration(id: string): GenerationProgress | undefined {
    const progress = this.generation.get(id) || this.registry.get(id)?.generation;
    return progress && structuredClone(progress);
  }
  log(project: Project, stage: string, message: string, level: 'info' | 'error' = 'info') {
    project.logs.push({ id: randomUUID(), stage, message: message.slice(0, 6000), level, createdAt: new Date().toISOString() });
    project.logs = project.logs.slice(-200);
    this.registry.save(project);
  }
  run(project: Project, kind: 'generate' | 'compile' | 'deploy' | 'reconcile', prompt = '') {
    if (this.active.has(project.id)) throw new Error('This app already has an operation in progress.');
    if (this.active.size >= 2) throw new Error('Two builds are already running. Please try again shortly.');
    if (kind !== 'reconcile' && project.deployments.some(d => ['deploying', 'submitted', 'unknown'].includes(d.status))) throw new Error('An earlier deployment is still pending. Its saved transaction must be reconciled before building or publishing again.');
    if (kind === 'deploy' && !project.build) throw new Error('Compile this revision before deployment.');
    if (kind === 'deploy' && project.status !== 'submitted' && project.deployments.some(d => d.buildId === project.build!.id && d.status === 'deployed')) throw new Error('This build is already deployed. Its existing transaction must be reconciled if readiness needs checking.');
    if (kind === 'generate') project.model = defaultModel;
    const operation = this.registry.begin(project.id, kind);
    this.active.add(project.id);
    project.error = undefined;
    project.status = kind === 'generate' ? 'generating' : kind === 'compile' ? 'compiling' : 'deploying';
    this.registry.save(project);
    void (async () => {
      let publishing = kind === 'deploy' || kind === 'reconcile';
      try {
        if (kind === 'generate') await this.generateAndCompile(project, prompt);
        else if (kind === 'compile') await this.compile(project);
        if (publishing || this.autoPublish) {
          publishing = true;
          project.status = 'deploying';
          this.log(project, 'deploy', 'Publishing the compiled application to stage-net.');
          // Publishing is deliberately outside the generation/repair loop.
          await this.deploy(project, kind === 'reconcile');
        } else this.log(project, 'compile', 'Build complete. Automatic publishing is unavailable in this local setup; configure the stage-net sponsor and prover to publish.');
        this.registry.finish(operation);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Operation failed.';
        // If any transaction might have reached the network, retain uncertainty.
        const pending = [...project.deployments].reverse().find(d => ['deploying', 'submitted', 'unknown'].includes(d.status));
        project.status = publishing && (pending || project.status === 'submitted') ? 'submitted' : 'failed';
        project.error = message;
        this.log(project, publishing ? 'deploy' : kind, message, 'error');
        this.registry.finish(operation, message);
      } finally { this.generation.delete(project.id); this.active.delete(project.id); }
    })();
    return project;
  }
  private async generateAndCompile(project: Project, prompt: string) {
    let instruction = prompt;
    let draftFiles: Project['files'] | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      const progress = new GenerationAttempt(attempt + 1, this.getGeneration(project.id)?.sequence || 0, snapshot => {
        this.generation.set(project.id, snapshot);
        // Existing logs and lifecycle saves checkpoint this snapshot. Token
        // updates only touch this operation's in-memory document and map.
        project.generation = snapshot;
      });
      project.status = 'generating';
      this.log(project, 'generate', attempt === 0 ? `Generating with ${project.model}` : `Repairing build from compiler feedback · attempt ${attempt + 1}/3`);
      let generatedValid = false;
      try {
        const generated = await (this.dependencies.generate || generate)(draftFiles ? { ...project, files: draftFiles } : project, instruction, message => {
          progress.checkpoint();
          this.log(project, 'generate', message);
        }, files => progress.update(files));
        generatedValid = true;
        progress.complete(generated.files);
        Object.assign(project, generated);
        draftFiles = undefined;
        project.revision++;
        project.build = undefined; project.previewUrl = undefined;
        this.registry.snapshot(project); this.registry.save(project);
        await this.compile(project);
        project.messages.push({ role: 'assistant', content: generated.description, createdAt: new Date().toISOString() });
        this.registry.save(project);
        return;
      } catch (error) {
        if (error instanceof GenerationValidationError) draftFiles = error.files;
        const message = error instanceof Error ? error.message : 'Build failed.';
        progress.fail(message);
        this.log(project, 'repair', message, 'error');
        if (error instanceof ModelServiceError || error instanceof UnsupportedAppError || attempt === 2 || /API_KEY|401|402|429|credit|auth|timeout|timed out/i.test(message)
          || (!generatedValid && /abort|cancel|network|fetch failed/i.test(message))) throw error;
        instruction = `Fix this application so it builds correctly. Preserve the original requested behaviour: ${prompt}\nBuild failure:\n${message.slice(0, 8000)}\nReturn JSON with complete replacement contents only for files you change. Omitted files stay unchanged only when a current application is supplied. If none is supplied, return both contract.compact and src/App.tsx in full. Do not select a new base when repairing existing files.`;
      } finally { progress.dispose(); }
    }
  }
  private async compile(project: Project) {
    if (this.dependencies.compile) return this.dependencies.compile(project);
    project.status = 'compiling'; project.build = undefined; project.previewUrl = undefined;
    this.registry.snapshot(project);
    const id = randomUUID();
    const directory = this.buildDirectory(id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    this.log(project, 'compile', 'Building React and compiling Compact with proving keys in parallel.');
    // Wait for both branches to settle even on failure. No next repair or publish
    // may run while an earlier compiler is still writing artefacts or log output.
    const outputs = await Promise.allSettled([
      (async () => {
        const { images, assets } = await resolveAssets(project.assets || [], message => this.log(project, 'assets', message));
        if (project.assets) { project.assets = assets; this.registry.save(project); }
        const bundle = await (this.dependencies.bundle || bundleApp)(project.files, images);
        await writeFile(join(directory, 'app.js'), bundle);
      })(),
      Promise.resolve().then(() => (this.dependencies.compileContract || compileContract)({ source: project.files['contract.compact'], buildDir: directory, onLog: message => this.log(project, 'compile', message) })),
    ]);
    const failures = outputs.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length) throw new Error(failures.map(result => result.reason instanceof Error ? result.reason.message : String(result.reason)).join('\n'));
    const output = (outputs[1] as PromiseFulfilledResult<Awaited<ReturnType<typeof compileContract>>>).value;
    await writeFile(join(directory, 'app-metadata.json'), JSON.stringify({ name: project.name, description: project.description, css: project.files['src/styles.css'], circuits: output.circuits }));
    project.build = { id, revision: project.revision, sourceHash: output.sourceHash, compilerVersion: output.compilerVersion, circuits: output.circuits, createdAt: new Date().toISOString() };
    project.status = 'ready';
    project.error = undefined;
    this.log(project, 'compile', `Compiled ${output.circuits.length} circuit${output.circuits.length === 1 ? '' : 's'}.${this.autoPublish ? ' Publishing to stage-net.' : ' Ready for stage-net deployment.'}`);
  }
  private async readJournal(buildId: string): Promise<DeploymentJournal | undefined> {
    if (this.dependencies.readJournal) return this.dependencies.readJournal(this.buildDirectory(buildId));
    try {
      const journal = JSON.parse(await readFile(join(this.buildDirectory(buildId), 'deployment.json'), 'utf8'));
      if (journal.network !== 'stagenet' || typeof journal.txId !== 'string' || !journal.txId || typeof journal.contractAddress !== 'string' || !/^[0-9a-f]{64}$/i.test(journal.contractAddress)) throw new Error('The saved deployment journal is invalid. Restore it before retrying.');
      return journal;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }
  private async verifyReady(project: Project, deployment: Deployment) {
    if (!deployment.contractAddress) throw new Error('Confirmed deployment is missing its contract address.');
    project.status = 'deploying';
    this.log(project, 'deploy', `Checking the public ledger for confirmed contract ${deployment.contractAddress}.`);
    try {
      await (this.dependencies.readState || readContractState)({ buildDir: this.buildDirectory(deployment.buildId), contractAddress: deployment.contractAddress });
    } catch (error) {
      project.status = 'submitted';
      throw new Error(`Contract confirmed at ${deployment.contractAddress}, but its public ledger is not ready to query. Reconcile to check again without redeploying. ${error instanceof Error ? error.message : ''}`);
    }
    const isCurrentBuild = project.build?.id === deployment.buildId && project.build?.revision === project.revision;
    project.status = isCurrentBuild ? 'deployed' : project.build ? 'ready' : 'draft'; project.error = undefined; deployment.error = undefined;
    this.log(project, 'deploy', isCurrentBuild
      ? `Live on stage-net: ${deployment.contractAddress}. Public ledger query verified; the app is ready to use.`
      : `Earlier deployment ${deployment.contractAddress} is confirmed and queryable. The current draft has not been published.`);
  }
  private async deploy(project: Project, reconcile = false) {
    let deployment: Deployment | undefined = reconcile
      ? [...project.deployments].reverse().find(d => ['submitted', 'unknown', 'deploying'].includes(d.status)) || [...project.deployments].reverse().find(d => d.buildId === project.build?.id && project.build?.revision === project.revision && d.status === 'deployed')
      : project.deployments.find(d => d.buildId === project.build!.id && d.status === 'deployed');
    if (deployment?.status === 'deployed') return this.verifyReady(project, deployment);
    if (!reconcile && !deployment) {
      const manifestReader = this.dependencies.readBuildManifest || readBuildManifest;
      const current = await manifestReader(this.buildDirectory(project.build!.id));
      for (const previous of [...project.deployments].reverse().filter(d => d.status === 'deployed' && d.contractAddress)) {
        const saved = await manifestReader(this.buildDirectory(previous.buildId));
        if (saved.sourceHash !== current.sourceHash) continue;
        if (saved.compilerVersion !== current.compilerVersion || JSON.stringify(saved.circuits) !== JSON.stringify(current.circuits)
          || current.circuits.some(circuit => !current.artefacts[`keys/${circuit}.verifier`] || current.artefacts[`keys/${circuit}.verifier`] !== saved.artefacts[`keys/${circuit}.verifier`])) {
          throw new Error('The unchanged contract compiled with different verification keys. Its existing deployment and data have been preserved; publishing requires compatible contract artefacts.');
        }
        deployment = { id: randomUUID(), buildId: project.build!.id, status: 'deployed', contractAddress: previous.contractAddress, txId: previous.txId, createdAt: new Date().toISOString() };
        deployment.appUrl = `/apps/${project.id}?deployment=${deployment.id}`;
        project.deployments.push(deployment);
        this.log(project, 'deploy', `Publishing this frontend revision with existing contract ${deployment.contractAddress}; its on-chain records are preserved.`);
        return this.verifyReady(project, deployment);
      }
      deployment = { id: randomUUID(), buildId: project.build!.id, status: 'deploying', createdAt: new Date().toISOString() };
      project.deployments.push(deployment);
    }
    if (!deployment) throw new Error('No pending deployment to reconcile.');
    const journal = await this.readJournal(deployment.buildId);
    if (deployment.txId && (!journal || journal.txId !== deployment.txId || (deployment.contractAddress && journal.contractAddress !== deployment.contractAddress))) throw new Error('The saved transaction journal is missing or does not match this deployment. Restore it before reconciliation; a new deployment was not created.');
    project.status = 'deploying';
    this.log(project, 'deploy', 'Preparing a sponsored deployment on stage-net.');
    let result: DeploymentResult;
    try { result = await (this.dependencies.deploy || deployBuild)({ buildDir: this.buildDirectory(deployment.buildId), onSubmitted: update => {
      deployment.contractAddress = update.contractAddress; deployment.txId = update.txId;
      deployment.status = 'unknown'; project.status = 'deploying';
      this.log(project, 'deploy', `Deployment transaction recorded: ${update.txId}. Awaiting network submission and indexed confirmation.`);
    } }); } catch (error) {
      // The child may have saved its journal before its IPC update reached us.
      try {
        const saved = await this.readJournal(deployment.buildId);
        if (saved) { deployment.txId = saved.txId; deployment.contractAddress = saved.contractAddress; }
        deployment.status = deployment.txId ? 'unknown' : 'failed';
      } catch { deployment.status = 'unknown'; }
      deployment.error = error instanceof Error ? error.message : 'Deployment failed.';
      throw error;
    }
    if (result.network !== 'stagenet') throw new Error('The deployment result did not identify stage-net.');
    deployment.contractAddress = result.contractAddress; deployment.txId = result.txId;
    deployment.status = result.status === 'confirmed' ? 'deployed' : 'submitted';
    deployment.appUrl = `/apps/${project.id}?deployment=${deployment.id}`;
    project.status = deployment.status;
    this.log(project, 'deploy', result.status === 'confirmed' ? `Confirmed on stage-net: ${result.contractAddress}` : 'Submitted. Indexed confirmation is still pending.');
    if (deployment.status === 'deployed') await this.verifyReady(project, deployment);
  }
}
