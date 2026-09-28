import { Fingerprint, LoaderCircle, LogOut } from 'lucide-react';
import type { AuthSession } from '../../shared/types';

/** This is the verified builder session, rather than an unsigned profile request. */
export function PassportConnection({ session, busy, onSignIn, onSignOut }: { session: AuthSession; busy: boolean; onSignIn: () => void; onSignOut: () => void }) {
  if (!session.authenticated) return <div className="session-controls"><span className="dev-mode-label">Dev mode</span><button className="button secondary passport-button" onClick={onSignIn} disabled={busy}><Fingerprint size={16} />Sign in</button></div>;
  const name = session.profile?.displayName || 'Passport signed in';
  return <div className="session-controls"><span className="session-profile" title={name}><Fingerprint size={17} aria-hidden="true" /><span>{name}</span></span><button className="icon-button sign-out-button" disabled={busy} aria-label="Sign out of Midnight Passport Builder" title="Sign out" onClick={onSignOut}>{busy ? <LoaderCircle size={16} className="spin" /> : <LogOut size={16} />}</button></div>;
}
