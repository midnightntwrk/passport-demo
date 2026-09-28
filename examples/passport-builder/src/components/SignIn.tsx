import { AlertCircle, ArrowRight, Fingerprint, LoaderCircle, RefreshCw } from 'lucide-react';
import midnightWordmark from '../assets/midnight-wordmark.svg';
import { PassportArtwork } from './Welcome';
import ThemeToggle from './ThemeToggle';

export function SignIn({ loading, redirecting, error, onSignIn, onRetry }: { loading: boolean; redirecting: boolean; error: string; onSignIn: () => void; onRetry: () => void }) {
  return <div className="sign-in-screen">
    <header className="sign-in-bar"><img src={midnightWordmark} className="brand-wordmark" alt="Midnight" /><span>Passport Builder</span><ThemeToggle size="sm" /></header>
    <main className="sign-in-main" aria-labelledby="sign-in-title" aria-busy={loading || redirecting}>
      <div className="sign-in-hero"><div><p className="eyebrow">Your workspace on Midnight</p><h1 id="sign-in-title">Your Passport.<br />Your next idea.</h1><p className="intro">Sign in to create and manage your Midnight apps. Bring an idea. Build it with Passport.</p></div><PassportArtwork /></div>
      <div className="sign-in-actions">
        {error && <div className="sign-in-error" role="alert"><AlertCircle size={18} /><p>{error}</p></div>}
        {loading ? <div className="sign-in-loading" role="status"><LoaderCircle size={20} className="spin" />Checking your Passport session…</div> : <><button className="button primary sign-in-primary" disabled={redirecting} onClick={onSignIn}>{redirecting ? <LoaderCircle size={20} className="spin" /> : <Fingerprint size={22} />}<span>{redirecting ? 'Opening Midnight Passport…' : 'Sign in with Midnight Passport'}</span>{!redirecting && <ArrowRight size={20} />}</button><p className="sign-in-hint">You’ll continue in Midnight Passport, then return here.</p></>}
        {error && !loading && !redirecting && <button className="text-button" onClick={onRetry}><RefreshCw size={14} />Check session again</button>}
      </div>
      <div className="sign-in-footer"><span className="network-dot" aria-hidden="true" /><span>Built for Midnight stage-net</span></div>
    </main>
  </div>;
}
