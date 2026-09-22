import { ArrowRight, Info, Loader2, ShieldCheck } from 'lucide-react'
import { RECOVERY_COPY } from '../lib/recoveryStep.js'
import ThemeToggle from './ThemeToggle'
import './recovery-step.css'

/** Presentation only. CustodyPassport owns provider linking and its outcome. */
export default function RecoveryStep(props: {
  provider: string | null
  busy: string | null
  error: string | null
  onAdd: () => void
  onSkip: () => void
}) {
  const working = props.busy !== null
  return (
    <section className="mnrecovery" aria-labelledby="recovery-title" aria-busy={working}>
      <header className="mnob-bar mnrecovery-bar">
        <img className="mnob-wordmark" src="/midnight-wordmark.svg" alt="Midnight" />
        <span className="mnob-bar-label">Passport</span>
        <ThemeToggle size="sm" className="mnob-theme" />
      </header>
      <div className="mnrecovery-layout">
        <div className="mnrecovery-art" aria-hidden="true">
          <img src="/passport-recovery.png" alt="" width="1254" height="1254" decoding="async" />
        </div>
        <div className="mnrecovery-content">
          <h1 id="recovery-title">{RECOVERY_COPY.title}</h1>
          <p className="mnrecovery-lede">Open your Passport on a new device if this one is lost.</p>
          {props.error ? (
            <div className="mnrecovery-notice" role="alert">
              <Info size={19} aria-hidden="true" />
              <p className="mnob-unusable-copy">{props.error}</p>
            </div>
          ) : null}
          <div className="mnrecovery-actions">
            <p className="mnrecovery-providers" id="recovery-providers">Google, Microsoft, X, Discord, or email</p>
            <button
              type="button"
              className="mnrecovery-primary"
              onClick={props.onAdd}
              disabled={working}
              aria-label={working ? props.busy ?? 'Adding recovery' : 'Add recovery'}
              aria-describedby="recovery-providers recovery-hint"
              data-testid="add-recovery"
            >
              {working ? <Loader2 size={20} className="mnrecovery-spinner" aria-hidden="true" /> : <ShieldCheck size={20} aria-hidden="true" />}
              <span role="status">{working ? props.busy : 'Add recovery'}</span>
              <ArrowRight size={20} aria-hidden="true" />
            </button>
            <p className="mnrecovery-hint" id="recovery-hint">One approval. Fees covered.</p>
            <button type="button" className="mnrecovery-secondary" onClick={props.onSkip} disabled={working} data-testid="skip-recovery">
              {props.error === null ? RECOVERY_COPY.skip : RECOVERY_COPY.continue}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
