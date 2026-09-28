import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, FolderCode, LoaderCircle, Menu, Plus, RefreshCw, Settings2, X } from 'lucide-react';
import type { AuthSession, BuilderConfig, Project, ProjectFiles } from '../shared/types';
import { api, isBusy, readableError, safeHref, saveToken, SESSION_EXPIRED_EVENT } from './api';
import { clearPrivateDrafts, loadInitialSession, readDraft, rememberReturnProject, storeDraft } from './auth';
import { PassportConnection } from './components/PassportConnection';
import { ProjectWorkspace, projectStatusLabel } from './components/ProjectWorkspace';
import { Settings } from './components/Settings';
import { Welcome } from './components/Welcome';
import { SignIn } from './components/SignIn';
import ThemeToggle from './components/ThemeToggle';
import midnightWordmark from './assets/midnight-wordmark.svg';

const initialProject = () => { try { return decodeURIComponent(window.location.hash.slice(1)) || null; } catch { return null; } };

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState('');
  const authGeneration = useRef(0);
  const signInPending = useRef(false);

  const checkSession = useCallback(async (initial = false) => {
    const generation = ++authGeneration.current;
    setLoading(true);
    setError('');
    try {
      const nextSession = await (initial ? loadInitialSession() : api.session());
      if (generation === authGeneration.current) setSession(nextSession);
    } catch (failure) {
      if (generation === authGeneration.current) { setSession(null); setError(readableError(failure)); }
    } finally { if (generation === authGeneration.current) setLoading(false); }
  }, []);

  useEffect(() => { void checkSession(true); return () => { authGeneration.current++; }; }, [checkSession]);
  useEffect(() => {
    const expired = () => {
      authGeneration.current++;
      setSession(null);
      setLoading(false);
      setError('Your Passport session has ended. Sign in again to continue.');
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) { signInPending.current = false; setRedirecting(false); void checkSession(); }
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    window.addEventListener('pageshow', onPageShow);
    const expiresAt = session?.expiresAt ? Date.parse(session.expiresAt) : NaN;
    const timer = session?.authenticated && Number.isFinite(expiresAt) ? setTimeout(expired, Math.max(0, Math.min(expiresAt - Date.now(), 2_147_483_647))) : undefined;
    return () => { window.removeEventListener(SESSION_EXPIRED_EVENT, expired); window.removeEventListener('pageshow', onPageShow); if (timer) clearTimeout(timer); };
  }, [checkSession, session]);

  const signIn = async () => {
    if (signInPending.current) return;
    signInPending.current = true;
    setRedirecting(true);
    setError('');
    rememberReturnProject();
    try {
      const result = await api.startSignIn();
      const url = safeHref(result.url);
      if (!url) throw new Error('Passport returned an invalid sign-in address. Please retry.');
      window.location.assign(url);
    } catch (failure) { signInPending.current = false; setRedirecting(false); setError(readableError(failure)); }
  };
  const signOut = async () => {
    const nextSession = await api.signOut();
    authGeneration.current++;
    saveToken('');
    clearPrivateDrafts();
    window.history.replaceState(null, '', '/');
    setSession(nextSession);
    setError('');
  };

  if (loading || !session || (!session.authenticated && !session.devMode)) return <SignIn loading={loading} redirecting={redirecting} error={error} onSignIn={() => { void signIn(); }} onRetry={() => { void checkSession(); }} />;
  return <Workspace key={session.authenticated ? 'passport-session' : 'development-session'} session={session} onSignIn={() => { void signIn(); }} onSignOut={signOut} authError={error} onDismissAuthError={() => setError('')} />;
}

function Workspace({ session, onSignIn, onSignOut, authError, onDismissAuthError }: { session: AuthSession; onSignIn: () => void; onSignOut: () => Promise<void>; authError: string; onDismissAuthError: () => void }) {
  const [config, setConfig] = useState<BuilderConfig | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialProject);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [prompt, setPrompt] = useState(() => readDraft('idea'));
  const [dirty, setDirty] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarOpenerRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const settingsReturnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => { storeDraft('idea', prompt); }, [prompt]);
  const openSettings = () => {
    settingsReturnFocusRef.current = sidebarOpen ? sidebarOpenerRef.current : document.activeElement as HTMLElement | null;
    setSidebarOpen(false);
    setSettingsOpen(true);
  };
  const closeSettings = () => {
    setSettingsOpen(false);
    const target = settingsReturnFocusRef.current;
    requestAnimationFrame(() => { if (target?.isConnected && target.offsetParent !== null) target.focus(); });
  };

  useEffect(() => {
    if (!sidebarOpen) return;
    const drawer = sidebarRef.current;
    const main = mainRef.current;
    if (!drawer || !main) return;
    const mobileViewport = window.matchMedia('(max-width: 760px)');
    if (!mobileViewport.matches) { setSidebarOpen(false); return; }
    main.inert = true;
    const controls = () => Array.from(drawer.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter((element) => element.offsetParent !== null);
    controls()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setSidebarOpen(false); return; }
      if (event.key !== 'Tab') return;
      const items = controls();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (!drawer.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const onViewportChange = () => { if (!mobileViewport.matches) setSidebarOpen(false); };
    document.addEventListener('keydown', onKeyDown);
    mobileViewport.addEventListener('change', onViewportChange);
    return () => {
      main.inert = false;
      document.removeEventListener('keydown', onKeyDown);
      mobileViewport.removeEventListener('change', onViewportChange);
      if (sidebarOpenerRef.current?.offsetParent !== null) sidebarOpenerRef.current?.focus();
    };
  }, [sidebarOpen]);

  const acceptProject = useCallback((next: Project) => {
    if (selectedRef.current === next.id) setProject(next);
    setProjects((current) => [next, ...current.filter((item) => item.id !== next.id)].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const nextConfig = await api.config();
      setConfig(nextConfig);
      const listing = await api.projects();
      setProjects(listing.projects);
      if (selectedRef.current) { const detail = await api.project(selectedRef.current); acceptProject(detail.project); }
    } catch (failure) { setError(readableError(failure)); }
    finally { setLoading(false); }
  }, [acceptProject]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!selectedId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const detail = await api.project(selectedId); if (!stopped) acceptProject(detail.project); }
      catch (failure) { if (!stopped) setError(readableError(failure)); }
      if (!stopped) timer = setTimeout(poll, 2500);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [selectedId, acceptProject]);

  const navigate = (id: string | null) => {
    if (dirty && !window.confirm('Discard your unsaved source edits and switch projects?')) return;
    setDirty(false);
    setSelectedId(id);
    selectedRef.current = id;
    setProject(id ? projects.find((item) => item.id === id) ?? null : null);
    window.history.replaceState(null, '', id ? `#${encodeURIComponent(id)}` : `${window.location.pathname}${window.location.search}`);
    setError('');
    setSidebarOpen(false);
  };

  const create = async () => {
    if (busy || !config || !prompt.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.create(prompt.trim(), config.defaultModel);
      selectedRef.current = result.project.id;
      setSelectedId(result.project.id);
      acceptProject(result.project);
      window.history.replaceState(null, '', `#${encodeURIComponent(result.project.id)}`);
      setPrompt('');
    } catch (failure) { setError(readableError(failure)); }
    finally { setBusy(false); }
  };

  const mutate = async (action: () => Promise<{ project: Project }>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try { const result = await action(); acceptProject(result.project); }
    catch (failure) { setError(readableError(failure)); throw failure; }
    finally { setBusy(false); }
  };
  const run = (action: () => Promise<{ project: Project }>) => { void mutate(action).catch(() => {}); };

  const exportProject = async () => {
    if (!project) return;
    try {
      const data = await api.export(project.id);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'passport-project'}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { setError(readableError(failure)); }
  };

  const working = busy || isBusy(project);
  const signOut = async () => {
    if (busy || (dirty && !window.confirm('Sign out and discard your unsaved source edits?'))) return;
    setBusy(true);
    setError('');
    try { await onSignOut(); }
    catch (failure) { setError(readableError(failure)); setBusy(false); }
  };
  const visibleError = error || authError;
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>Skip to workspace</a>
    {sidebarOpen && <button className="sidebar-backdrop" tabIndex={-1} aria-label="Close project navigation" onClick={() => setSidebarOpen(false)} />}
    <aside ref={sidebarRef} className={`sidebar ${sidebarOpen ? 'open' : ''}`} role={sidebarOpen ? 'dialog' : undefined} aria-modal={sidebarOpen ? true : undefined} aria-label="Project navigation">
      <div className="brand"><div><img className="brand-wordmark" src={midnightWordmark} alt="Midnight" /><span>Passport Builder</span></div><button className="icon-button mobile-only" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}><X size={18} /></button></div>
      <button className="button primary new-project" onClick={() => navigate(null)} disabled={busy}><Plus size={21} />New project</button>
      <div className="project-list-heading"><span>Projects</span>{loading && <LoaderCircle size={13} className="spin" />}</div>
      <nav className="project-list" aria-label="Your projects">
        {!projects.length && <div className="empty-projects"><FolderCode size={31} strokeWidth={1.2} aria-hidden="true" /><p>{loading ? 'Loading your projects…' : 'Your ideas will appear here as you build.'}</p></div>}
        {projects.map((item) => <button key={item.id} className={`project-link ${selectedId === item.id ? 'selected' : ''}`} onClick={() => navigate(item.id)} aria-current={selectedId === item.id ? 'page' : undefined}><FolderCode size={17} /><span><strong>{item.name}</strong><small>{projectStatusLabel(item)}</small></span>{isBusy(item) && <LoaderCircle size={12} className="spin" />}</button>)}
      </nav>
      <div className="sidebar-bottom"><button className="settings-button" onClick={openSettings}><Settings2 size={20} />Settings</button></div>
    </aside>
    <div className="app-main" ref={mainRef}>
      <header className="topbar"><div className="topbar-title"><button ref={sidebarOpenerRef} className="icon-button mobile-only" aria-label="Open project navigation" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><Menu size={21} /></button><span>{project ? project.name : 'Workspace'}</span></div><div className="topbar-actions"><span className="network-label"><span className="network-dot" aria-hidden="true" />Stage-net</span><ThemeToggle size="sm" /><PassportConnection session={session} busy={busy} onSignIn={onSignIn} onSignOut={() => { void signOut(); }} /></div></header>
      {visibleError && <div className="error-banner" role="alert"><AlertCircle size={17} /><span>{visibleError}</span><button className="text-button" onClick={() => { void refresh(); }}><RefreshCw size={14} />Retry</button><button className="icon-button" aria-label="Dismiss error" onClick={() => { setError(''); onDismissAuthError(); }}><X size={16} /></button></div>}
      <main id="main-content" tabIndex={-1} className={project ? 'main-project' : 'main-welcome'}>
        {selectedId && !project ? <div className="panel-empty"><LoaderCircle className={loading ? 'spin' : ''} size={30} /><h1>{loading ? 'Loading your project' : 'Project unavailable'}</h1><p>{loading ? 'Retrieving the project registry.' : 'Check your workspace access, then retry.'}</p><button className="button secondary" onClick={() => navigate(null)}>Back to workspace</button></div> : project && config ? <ProjectWorkspace key={project.id} project={project} config={config} busy={busy} onDirty={setDirty}
          onGenerate={async (text) => { await mutate(() => api.generate(project.id, text, config.defaultModel)); }} onCompile={() => run(() => api.compile(project.id))} onDeploy={() => run(() => api.deploy(project.id))} onReconcile={() => run(() => api.reconcile(project.id))} onSave={async (files: ProjectFiles) => { await mutate(() => api.save(project.id, files)); }} onExport={() => { void exportProject(); }} /> : <Welcome prompt={prompt} setPrompt={setPrompt} busy={working} disabled={!config || !config.openrouterConfigured} onSubmit={() => { void create(); }} />}
      </main>
    </div>
    {settingsOpen && <Settings config={config} onClose={closeSettings} onSave={refresh} />}
  </div>;
}
