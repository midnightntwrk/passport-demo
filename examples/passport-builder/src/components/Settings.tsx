import { CheckCircle2, Circle, LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { BuilderConfig } from '../../shared/types';
import { readToken, saveToken } from '../api';

export function Settings({ config, onClose, onSave }: { config: BuilderConfig | null; onClose: () => void; onSave: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [token, setToken] = useState(readToken);
  const [busy, setBusy] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog className="settings-dialog" ref={dialog} onCancel={onClose} onClose={onClose} aria-labelledby="settings-title">
    <div className="dialog-heading"><div><h2 id="settings-title">Workspace settings</h2><p>Connections for your Midnight workspace.</p></div><button className="icon-button" aria-label="Close settings" onClick={onClose}><X size={20} /></button></div>
    <form onSubmit={async (event) => { event.preventDefault(); setBusy(true); saveToken(token); try { await onSave(); onClose(); } finally { setBusy(false); } }}>
      <label className="field-label" htmlFor="operator-token">Operator access token</label>
      <input id="operator-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Optional operator token" autoComplete="off" spellCheck={false} />
      <p className="field-help">Optional administrator access to legacy projects. Your Passport session already gives you access to your workspace. The token stays in this tab; your OpenRouter key stays on the server.</p>
      <div className="settings-services"><h3>Services</h3>{config ? config.services.map((service) => <div className="service-row" key={service.name}>
        {service.state === 'ready' ? <CheckCircle2 size={16} className="success-text" /> : <Circle size={16} className="muted" />}
        <div><strong>{service.name}</strong><p>{service.message}</p></div><span className="service-state">{service.state.replace('unconfigured', 'Setup needed')}</span>
      </div>) : <p className="muted">The builder service is unavailable. Check that it is running and retry.</p>}</div>
      {config?.passportOrigin && <div className="setting-detail"><span>Passport</span><code>{config.passportOrigin}</code></div>}
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy && <LoaderCircle size={16} className="spin" />}Save and reconnect</button></div>
    </form>
  </dialog>;
}
