import type { AuthSession } from '../shared/types';
import { api } from './api';

const DRAFT_PREFIX = 'passport-builder:draft:';
const RETURN_PROJECT = 'passport-builder:return-project';

export function readDraft(name: string): string {
  try { return sessionStorage.getItem(`${DRAFT_PREFIX}${name}`) ?? ''; } catch { return ''; }
}
export function storeDraft(name: string, value: string) {
  try {
    if (value) sessionStorage.setItem(`${DRAFT_PREFIX}${name}`, value);
    else sessionStorage.removeItem(`${DRAFT_PREFIX}${name}`);
  } catch { /* Draft persistence is best-effort when storage is unavailable. */ }
}
export function clearPrivateDrafts() {
  try {
    Object.keys(sessionStorage).filter((key) => key.startsWith(DRAFT_PREFIX) || key.startsWith('passport-builder:profile:') || key === RETURN_PROJECT).forEach((key) => sessionStorage.removeItem(key));
  } catch { /* The server session still signs out if storage is unavailable. */ }
}
export function rememberReturnProject() {
  try {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (/^[a-zA-Z0-9_-]{1,100}$/.test(id)) sessionStorage.setItem(RETURN_PROJECT, id);
    else sessionStorage.removeItem(RETURN_PROJECT);
  } catch { /* A malformed hash is never used as a return URL. */ }
}
function restoreReturnProject() {
  try {
    const id = sessionStorage.getItem(RETURN_PROJECT);
    sessionStorage.removeItem(RETURN_PROJECT);
    if (id && /^[a-zA-Z0-9_-]{1,100}$/.test(id)) window.history.replaceState(null, '', `/#${encodeURIComponent(id)}`);
  } catch { /* The safe fallback is the builder landing page. */ }
}

// Capture and scrub the signed response before React mounts or any request runs.
// Keeping the one finish promise also prevents StrictMode from replaying it.
const isCallback = window.location.pathname === '/auth/callback';
let callbackHash: string | null = isCallback ? window.location.hash : null;
if (isCallback) window.history.replaceState(null, '', '/');
let callbackSession: Promise<AuthSession> | undefined;

export function loadInitialSession(): Promise<AuthSession> {
  if (!isCallback) return api.session();
  if (!callbackSession) {
    const hash = callbackHash;
    callbackHash = null;
    callbackSession = hash
      ? api.finishSignIn(hash).then((session) => { if (session.authenticated) restoreReturnProject(); return session; })
      : Promise.reject(new Error('Passport sign-in was not completed. Please try again.'));
  }
  return callbackSession;
}
