import type { AuthSession, BuilderConfig, Project, ProjectFiles } from '../shared/types';

const TOKEN_KEY = 'passport-builder:operator-token';
export const readToken = () => { try { return sessionStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; } };
export function saveToken(token: string) {
  try {
    if (token.trim()) sessionStorage.setItem(TOKEN_KEY, token.trim());
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* Passport cookie sessions work when tab storage is disabled. */ }
}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export const SESSION_EXPIRED_EVENT = 'passport-builder:session-expired';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  const token = readToken();
  if (token && !path.startsWith('/auth/')) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    throw new ApiError(data?.error ?? `The service returned ${response.status}. Please retry.`, response.status);
  }
  if (!data) throw new ApiError('The service returned an unreadable response.', response.status);
  return data as T;
}

const projectPath = (id: string) => `/projects/${encodeURIComponent(id)}`;
export const api = {
  session: () => request<AuthSession>('/auth/session'),
  startSignIn: () => request<{ url: string }>('/auth/start', { method: 'POST', body: '{}' }),
  finishSignIn: (hash: string) => request<AuthSession>('/auth/finish', { method: 'POST', body: JSON.stringify({ hash }) }),
  signOut: () => request<AuthSession>('/auth/logout', { method: 'POST', body: '{}' }),
  config: () => request<BuilderConfig>('/config'),
  projects: () => request<{ projects: Project[] }>('/projects'),
  project: (id: string) => request<{ project: Project }>(projectPath(id)),
  create: (prompt: string, model: string, template?: 'counter') => request<{ project: Project }>('/projects', { method: 'POST', body: JSON.stringify({ prompt, model, ...(template ? { template } : {}) }) }),
  generate: (id: string, prompt: string, model: string) => request<{ project: Project }>(`${projectPath(id)}/generate`, { method: 'POST', body: JSON.stringify({ prompt, model }) }),
  compile: (id: string) => request<{ project: Project }>(`${projectPath(id)}/compile`, { method: 'POST', body: '{}' }),
  deploy: (id: string) => request<{ project: Project }>(`${projectPath(id)}/deploy`, { method: 'POST', body: '{}' }),
  reconcile: (id: string) => request<{ project: Project }>(`${projectPath(id)}/reconcile`, { method: 'POST', body: '{}' }),
  save: (id: string, files: ProjectFiles) => request<{ project: Project }>(projectPath(id), { method: 'PATCH', body: JSON.stringify({ files }) }),
  export: (id: string) => request<unknown>(`${projectPath(id)}/export`),
};

export function readableError(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please retry.'; }
export function isBusy(project: Project | null) { return !!project && ['generating', 'compiling', 'deploying'].includes(project.status); }
export function safeHref(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try { const url = new URL(value, window.location.origin); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; }
  catch { return undefined; }
}
