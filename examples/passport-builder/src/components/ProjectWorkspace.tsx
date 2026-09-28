import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Code2, Download, Eye, FileCode2, LoaderCircle, RefreshCw, Rocket, Save, Terminal, XCircle } from 'lucide-react';
import type { BuilderConfig, Project, ProjectFiles } from '../../shared/types';
import { isBusy, safeHref } from '../api';
import { readDraft, storeDraft } from '../auth';
import { PromptComposer } from './PromptComposer';
import { GenerationViewer } from './GenerationViewer';
import { useGenerationStream } from '../hooks/useGenerationStream';

interface Props {
  project: Project;
  config: BuilderConfig;
  busy: boolean;
  onGenerate: (prompt: string) => Promise<void>;
  onCompile: () => void;
  onDeploy: () => void;
  onReconcile: () => void;
  onSave: (files: ProjectFiles) => Promise<void>;
  onExport: () => void;
  onDirty: (dirty: boolean) => void;
}

export const statusLabel: Record<Project['status'], string> = { draft: 'Draft', generating: 'Generating', compiling: 'Compiling', ready: 'Build ready', deploying: 'Deploying', submitted: 'Submitted to stage-net', deployed: 'Deployed', failed: 'Needs attention' };
export const projectStatusLabel = (project: Project) => project.status === 'submitted' && confirmedCurrentDeployment(project) ? 'Checking app readiness' : project.deployments.at(-1)?.status === 'unknown' ? project.status === 'deploying' ? 'Submitting to stage-net' : 'Submission uncertain' : statusLabel[project.status];

function confirmedCurrentDeployment(project: Project) {
  if (!project.build || project.build.revision !== project.revision) return undefined;
  return [...project.deployments].reverse().find((deployment) => deployment.buildId === project.build!.id && deployment.status === 'deployed' && deployment.contractAddress && safeHref(deployment.appUrl));
}

function DeploymentPanel({ project, config }: { project: Project; config: BuilderConfig }) {
  const deployment = project.deployments.at(-1);
  const currentDeployment = confirmedCurrentDeployment(project);
  const previousDeployment = [...project.deployments].reverse().find((item) => item.status === 'deployed' && safeHref(item.appUrl));
  const appUrl = safeHref((currentDeployment ?? previousDeployment)?.appUrl);
  const checkingReadiness = currentDeployment && project.status === 'submitted';
  const heading = project.status === 'deploying' ? 'Deploying to stage-net' : project.status === 'generating' || project.status === 'compiling' ? 'Building your next deployment' : deployment?.status === 'unknown' ? 'Submission uncertain' : checkingReadiness ? 'Checking app readiness' : deployment?.status === 'submitted' ? 'Transaction submitted' : currentDeployment ? 'Your app is on stage-net' : deployment?.status === 'failed' ? 'Deployment needs attention' : 'Build and deploy your Midnight app';
  const explanation = project.status === 'deploying' ? 'The service is preparing your contract and checking its submission with the network.' : project.status === 'generating' || project.status === 'compiling' ? 'The app will deploy automatically after compilation. Its preview connects to the contract once deployment is confirmed.' : deployment?.status === 'unknown' ? 'The service could not confirm the outcome. Check confirmation before starting another deployment.' : checkingReadiness ? 'The deployment is confirmed. The app is waiting for its ledger to become available; check confirmation to retry the read.' : deployment?.status === 'submitted' ? 'Waiting for confirmation from the network. The preview stays read-only until confirmation.' : currentDeployment ? 'The embedded preview uses this confirmed contract. Connect Passport there to approve transactions.' : deployment?.status === 'failed' ? 'Review the deployment error below, then retry deployment.' : 'Builds compile and deploy to stage-net automatically. Connect Passport in the app after confirmation.';
  return <section className="deployment-panel" aria-label="Deployment details">
    <div className="deployment-summary"><div className="code-mark small"><Rocket size={22} /></div><div><h2>{heading}</h2><p>{explanation}</p></div></div>
    {appUrl && <a className="button primary deployed-app-link" href={appUrl} target="_blank" rel="noopener noreferrer">{currentDeployment ? 'Open deployed app' : 'Open previous deployment'} <ArrowUpRight size={17} /></a>}
    <dl className="build-facts">
      <div><dt>Network</dt><dd>Midnight stage-net</dd></div>
      <div><dt>Source revision</dt><dd>{project.revision}</dd></div>
      <div><dt>Compiled revision</dt><dd>{project.build?.revision ?? 'Not compiled'}</dd></div>
      <div><dt>Compiler</dt><dd>{project.build?.compilerVersion ?? (config.compilerConfigured ? 'Configured' : 'Setup needed')}</dd></div>
      <div><dt>Circuits</dt><dd>{project.build?.circuits.join(', ') || 'Compile to inspect'}</dd></div>
      <div><dt>Deployment service</dt><dd>{config.deploymentConfigured ? 'Configured' : 'Setup needed in workspace settings'}</dd></div>
      {deployment?.contractAddress && <div><dt>Contract address</dt><dd><code>{deployment.contractAddress}</code></dd></div>}
      {deployment?.txId && <div><dt>Transaction</dt><dd><code>{deployment.txId}</code></dd></div>}
    </dl>
    {deployment?.error && <p role="alert" className="inline-error">{deployment.error}</p>}
    {project.deployments.length > 0 && <div className="deployment-history"><h3>Deployment history</h3>{[...project.deployments].reverse().map((item) => <div key={item.id}><span className={`status-dot ${item.status}`} /><strong>{item.status}</strong><code>{item.contractAddress ? `${item.contractAddress.slice(0,16)}…` : item.id.slice(0,12)}</code><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>{item.status === 'deployed' && safeHref(item.appUrl) && <a className="icon-button" href={safeHref(item.appUrl)} target="_blank" rel="noopener noreferrer" aria-label={`Open deployment ${item.id.slice(0, 8)}`}><ArrowUpRight size={15} /></a>}</div>)}</div>}
  </section>;
}

function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : `${date.getFullYear()}/${String(date.getMonth()+1).padStart(2,'0')}/${String(date.getDate()).padStart(2,'0')}`; }

function restoreSourceDraft(id: string): { files: ProjectFiles; baseline: { revision: number; files: ProjectFiles } } | null {
  const isFiles = (value: unknown): value is ProjectFiles => !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every((file) => typeof file === 'string');
  try {
    const saved = JSON.parse(readDraft(`source:${id}`));
    if (isFiles(saved?.files) && isFiles(saved?.baseline?.files) && Number.isSafeInteger(saved?.baseline?.revision) && saved.baseline.revision >= 0) return saved;
  } catch { /* Ignore unavailable or malformed tab storage. */ }
  return null;
}

export function ProjectWorkspace({ project, config, busy, onGenerate, onCompile, onDeploy, onReconcile, onSave, onExport, onDirty }: Props) {
  const [tab, setTab] = useState<'preview'|'code'|'deployment'>(project.status === 'generating' ? 'code' : 'preview');
  const [inspectPartial, setInspectPartial] = useState(true);
  const userSelectedTab = useRef(false);
  const selectTab = (next: typeof tab) => { userSelectedTab.current = true; setTab(next); };
  const generating = project.status === 'generating';
  const generation = useGenerationStream(project.id, generating || project.status === 'compiling', project.generation);
  const failedPartial = project.status === 'failed' && generation.progress?.status === 'failed';
  const showGeneration = generating || (project.status === 'compiling' && generation.progress?.status === 'streaming') || (failedPartial && inspectPartial);
  const visibleLogs = generating ? project.logs.filter((entry) => entry.level === 'error' || !/^Writing application files · \d+ kB received$/.test(entry.message)) : project.logs;
  const [prompt, setPrompt] = useState(() => readDraft(`revision:${project.id}`));
  const [restoredSource] = useState(() => restoreSourceDraft(project.id));
  const [files, setFiles] = useState(restoredSource?.files ?? project.files);
  const [sourceBaseline, setSourceBaseline] = useState(restoredSource?.baseline ?? { revision: project.revision, files: project.files });
  const [selectedFile, setSelectedFile] = useState(Object.keys(restoredSource?.files ?? project.files)[0] ?? '');
  const [logsOpen, setLogsOpen] = useState(project.status !== 'generating');
  const messagesEnd = useRef<HTMLDivElement>(null);
  const draftSource = JSON.stringify(files);
  const latestSource = JSON.stringify(project.files);
  const baselineSource = JSON.stringify(sourceBaseline.files);
  const dirty = draftSource !== baselineSource;
  const sourceChanged = project.revision !== sourceBaseline.revision || latestSource !== baselineSource;
  const sourceConflict = dirty && sourceChanged && draftSource !== latestSource;
  const fileNames = Object.keys(files).sort();
  const working = busy || isBusy(project);
  const currentBuild = project.build && project.build.revision === project.revision;
  const currentDeployment = confirmedCurrentDeployment(project);
  const previewUrl = safeHref(currentDeployment?.appUrl ?? project.previewUrl);
  const pendingConfirmation = project.status === 'submitted' || project.deployments.some((deployment) => ['submitted', 'unknown'].includes(deployment.status));
  const retryDeployment = currentBuild && project.deployments.some((deployment) => deployment.buildId === project.build?.id && deployment.status === 'failed');
  const missingService = !config.compilerConfigured ? 'The Compact compiler needs setup before new source can be built.' : !config.deploymentConfigured ? 'The deployment service needs setup. Compiled previews remain read-only until deployment is available.' : undefined;
  const loadLatestSource = useCallback(() => {
    setFiles(project.files);
    setSourceBaseline({ revision: project.revision, files: project.files });
    setSelectedFile((current) => current in project.files ? current : Object.keys(project.files)[0] ?? '');
  }, [project.files, project.revision]);

  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { storeDraft(`revision:${project.id}`, prompt); }, [project.id, prompt]);
  useEffect(() => { storeDraft(`source:${project.id}`, dirty ? JSON.stringify({ files, baseline: sourceBaseline }) : ''); }, [dirty, files, project.id, sourceBaseline]);
  useEffect(() => { if (project.status === 'deployed') setLogsOpen(false); }, [project.status]);
  useEffect(() => { if (currentDeployment && !userSelectedTab.current) setTab('preview'); }, [currentDeployment?.id]);
  useEffect(() => { if (generating) { if (!userSelectedTab.current) setTab('code'); setInspectPartial(true); } }, [generating]);
  useEffect(() => { if (project.logs.at(-1)?.level === 'error') setLogsOpen(true); }, [project.logs]);
  useEffect(() => { messagesEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [project.messages.length]);
  useEffect(() => {
    if (sourceChanged && (!dirty || draftSource === latestSource)) loadLatestSource();
  }, [sourceChanged, dirty, draftSource, latestSource, loadLatestSource]);
  useEffect(() => {
    if (!dirty) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [dirty]);

  return <div className="project-workspace">
    <section className="conversation" aria-label="Build conversation">
      <header className="conversation-heading"><h2>{project.name}</h2><p>{project.description || 'Shape your idea with AI.'}</p></header>
      <div className="messages" aria-live="polite">
        {project.messages.length ? project.messages.map((message, index) => <article className={`message ${message.role}`} key={`${message.createdAt}-${index}`}><div className="message-author">{message.role === 'user' ? 'You' : <><Code2 size={14} />Passport Builder</>}</div><p>{message.content}</p></article>) : <p className="muted">Your build conversation will appear here.</p>}
        {isBusy(project) && <div className="working-message" role="status"><LoaderCircle size={15} className="spin" />{statusLabel[project.status]}…</div>}
        <div ref={messagesEnd} />
      </div>
      <div className="revision-composer"><PromptComposer compact prompt={prompt} setPrompt={setPrompt} busy={working} disabled={dirty || !config.openrouterConfigured}
        onSubmit={() => { if (!prompt.trim() || working || dirty) return; userSelectedTab.current = false; setLogsOpen(false); const submitted = prompt; void onGenerate(submitted).then(() => setPrompt('')).catch(() => {}); }} />
        <p className="composer-hint">{dirty ? 'Save or discard your edits before asking for changes.' : config.openrouterConfigured ? 'Changes compile and deploy to stage-net automatically.' : 'Configure OpenRouter in the service to ask for changes.'}</p></div>
    </section>
    <section className="build-workspace" aria-label="App workspace">
      <div className="workspace-toolbar"><div className="workspace-tabs" role="tablist" aria-label="Project view">{([{id:'preview',label:'Preview',icon:Eye},{id:'code',label:'Code',icon:Code2},{id:'deployment',label:'Deployments',icon:Rocket}] as const).map(({id,label,icon:Icon}, index) => <button key={id} role="tab" id={`tab-${id}`} aria-controls={`panel-${id}`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => selectTab(id)} onKeyDown={(event) => {
        const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (!offset && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + offset + 3) % 3;
        selectTab((['preview', 'code', 'deployment'] as const)[next]);
        (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus();
      }}><Icon size={15} />{label}</button>)}</div><button className="icon-button" onClick={onExport} disabled={working} aria-label="Export project source" title="Export project source"><Download size={16} /></button></div>
      <div className="project-actionbar"><span className="status-label" role="status"><span className={`status-dot ${project.status}`} />{projectStatusLabel(project)}</span><div>
        {pendingConfirmation ? <button className="button primary small-button" disabled={working} onClick={onReconcile}><RefreshCw size={14} />Check confirmation</button> : currentDeployment ? <button className="button secondary small-button" disabled><Check size={14} />Deployed</button> : <button className="button primary small-button" disabled={working || dirty || !fileNames.length || !config.deploymentConfigured || (!currentBuild && (showGeneration || !config.compilerConfigured))} onClick={currentBuild ? onDeploy : onCompile} title={dirty ? 'Save your edits before building and deploying' : !config.deploymentConfigured || !currentBuild ? missingService ?? 'Compile and deploy the current revision to stage-net' : 'Deploy the verified current build to stage-net'}>{working ? <LoaderCircle size={14} className="spin" /> : retryDeployment ? <RefreshCw size={14} /> : <Rocket size={14} />}{working ? project.status === 'deploying' ? 'Deploying' : 'Building' : retryDeployment ? 'Retry deployment' : 'Build & deploy'}</button>}
      </div></div>
      {missingService && <p className="project-service-notice" role="status">{missingService}</p>}
      {project.error && <p className="project-error" role="alert">{project.error}</p>}
      {!!project.assets?.length && <details className="project-assets"><summary>Images · {project.assets.filter(asset => asset.status === 'ready').length}/{project.assets.length} ready</summary>{project.assets.map(asset => <div key={asset.name}><strong>{asset.name}</strong><span>{asset.status === 'ready' ? 'Ready' : asset.status === 'unavailable' ? 'Unavailable — using placeholder' : 'Generating…'}</span><p>{asset.alt}</p>{asset.error && <p role="status">{asset.error}</p>}</div>)}</details>}
      <div className={`workspace-panel ${tab}`} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'preview' && (previewUrl ? <><div className="preview-address"><span><span className={`status-dot ${currentDeployment ? 'deployed' : 'draft'}`} />{currentDeployment ? project.status === 'submitted' ? 'Deployment confirmed · Checking app readiness' : 'Live on stage-net · Connect Passport in your app' : 'Read-only preview · Awaiting deployment'}</span><a href={previewUrl} target="_blank" rel="noopener noreferrer" aria-label={currentDeployment ? 'Open deployed app in a new tab' : 'Open app preview in a new tab'}><ArrowUpRight size={17} /></a></div><iframe key={previewUrl} src={previewUrl} title={`${project.name} app preview`} sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" /></> : <div className="panel-empty"><Code2 size={36} strokeWidth={1.3} /><h2>{working ? 'Your app is taking shape' : 'Your app preview will appear here'}</h2><p>{working ? 'Follow the live code while your app builds and deploys to stage-net.' : 'Build and deploy your app to use it here with Passport.'}</p></div>)}
        {tab === 'code' && (showGeneration ? <GenerationViewer progress={generation.progress} connection={generation.connection} error={generation.error} onReconnect={generation.reconnect} onSavedSource={failedPartial && fileNames.length ? () => setInspectPartial(false) : undefined} /> : fileNames.length ? <div className="code-editor">{failedPartial && <div className="generation-saved-notice"><span>Saved source · partial generation is separate</span><button className="text-button" onClick={() => setInspectPartial(true)}>View failed output</button></div>}{sourceConflict && <div className="source-conflict" role="alert"><p>Revision {project.revision} was saved elsewhere. Your edits are preserved. Choose which source to keep before saving.</p><div><button className="button secondary small-button" disabled={working} onClick={() => setSourceBaseline({ revision: project.revision, files: project.files })}>Keep my edits</button><button className="text-button" disabled={working} onClick={loadLatestSource}>Load latest files</button></div></div>}<div className="file-toolbar"><FileCode2 size={15} /><select aria-label="Source file" value={selectedFile} onChange={(event) => setSelectedFile(event.target.value)}>{fileNames.map((name) => <option key={name} value={name}>{name}</option>)}</select><span className="file-count">{fileNames.length} files</span>{dirty && <button className="text-button" disabled={working} onClick={loadLatestSource}>Discard</button>}<button className="button secondary small-button" disabled={!dirty || working || sourceConflict} onClick={() => { void onSave(files).catch(() => {}); }}><Save size={14} />{dirty ? 'Save edits' : 'Saved'}</button></div><textarea className="source-input" aria-label={`Edit ${selectedFile}`} spellCheck={false} autoCapitalize="off" autoCorrect="off" value={files[selectedFile] ?? ''} disabled={working} onChange={(event) => setFiles((current) => ({ ...current, [selectedFile]: event.target.value }))} /><div className="editor-footer"><span>{selectedFile.endsWith('.compact') ? 'Compact' : selectedFile.endsWith('.json') ? 'JSON' : 'Source'}</span><span>{sourceConflict ? 'Newer revision available' : dirty ? 'Unsaved changes' : `Revision ${sourceBaseline.revision}`}</span></div></div> : <div className="panel-empty"><FileCode2 size={32} /><h2>No source files yet</h2><p>Your generated contract and app code will appear here.</p></div>)}
        {tab === 'deployment' && <DeploymentPanel project={project} config={config} />}
      </div>
      <section className={`build-log ${logsOpen ? 'expanded' : ''}`} aria-label="Build activity"><button className="log-toggle" aria-expanded={logsOpen} onClick={() => setLogsOpen(!logsOpen)}><span><Terminal size={14} />Build activity{working && <LoaderCircle size={13} className="spin" />}</span><span>{visibleLogs.length} events <span aria-hidden="true">{logsOpen ? '−' : '+'}</span></span></button>
        {logsOpen && <div className="log-lines" role="log" aria-live="polite">{visibleLogs.length ? visibleLogs.map((entry) => <div className={`log-line ${entry.level}`} key={entry.id}><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time>{entry.level === 'error' ? <XCircle size={12} /> : <Check size={12} />}<span>{entry.message}</span></div>) : <p className="muted">Build events will appear here.</p>}</div>}
      </section>
    </section>
  </div>;
}
