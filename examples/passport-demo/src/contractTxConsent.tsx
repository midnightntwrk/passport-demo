import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createPassportContractTxResponse, createPassportProfileReady, pairOfUnreadableMessage, readPassportContractTxRequest, type PassportContractTransactionIntent, type PassportContractTxRequest, type PassportContractTxResponse } from '@midnight-passport/connect';
import { contractRequestSourceMatches } from './lib/contractTxSource.js';
import { holdCriticalWork } from './lib/appBusy.js';
import { acquireContractApproval, releaseContractApproval } from './lib/contractApprovalLock.js';

interface Pending { request: PassportContractTxRequest; origin: string; source: Window }
interface Props {
  sessionActive: boolean;
  networkId: string | null;
  execute?: (intent: PassportContractTransactionIntent, origin: string) => Promise<{ txId: string }>;
}

/** One restricted approval surface for the named popup and Passport's own app frame. */
export function PassportContractTxConsent({ sessionActive, networkId, execute }: Props) {
  const launch = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const requestId = params.get('passportContractRequestId');
    const nonce = params.get('passportContractNonce');
    return requestId && nonce ? { requestId, nonce } : null;
  }, []);
  const [pending, setPending] = useState<Pending | null>(null);
  const [checked, setChecked] = useState(false);
  const [signing, setSigning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const current = useRef<Pending | null>(null);
  const seen = useRef(new Set<string>());
  const signingRef = useRef(false);
  const executeRef = useRef(execute);
  executeRef.current = execute;
  const keyOf = (r: { requestId: string; nonce: string }) => `${r.requestId}\0${r.nonce}`;
  const reply = (target: Pending, body: Omit<PassportContractTxResponse, 'protocol' | 'type' | 'version' | 'requestId' | 'nonce'>) => {
    if (current.current !== target) return;
    current.current = null;
    releaseContractApproval();
    target.source.postMessage(createPassportContractTxResponse(target.request, body), target.origin);
    setPending(null);
    setChecked(false);
  };

  useEffect(() => signing ? holdCriticalWork() : undefined, [signing]);
  useEffect(() => {
    const opener = launch ? window.opener as Window | null : null;
    if (launch && opener) opener.postMessage(createPassportProfileReady(launch.requestId, launch.nonce), '*');
    const onMessage = (event: MessageEvent) => {
      const frame = launch ? null : document.querySelector<HTMLIFrameElement>('iframe.mnapps-frame');
      const peer = launch ? { source: opener, origin: null } : { source: frame?.contentWindow ?? null, origin: frame ? new URL(frame.src, window.location.href).origin : null };
      if (!contractRequestSourceMatches(event, peer)) return;
      const parsed = readPassportContractTxRequest(event.data);
      if (parsed.kind === 'not-passport') return;
      const pair = parsed.kind === 'ok' ? parsed.value : pairOfUnreadableMessage(event.data);
      if (!pair || (launch && (pair.requestId !== launch.requestId || pair.nonce !== launch.nonce))) return;
      const key = keyOf(pair);
      if (seen.current.has(key)) return;
      if (seen.current.size >= 256) return;
      seen.current.add(key);
      const source = event.source as Window;
      if (parsed.kind !== 'ok' || current.current || signingRef.current || document.querySelector('.profile-consent[role="dialog"], .mnapps-sheet[role="dialog"]') || !acquireContractApproval()) {
        source.postMessage(createPassportContractTxResponse(pair, { status: 'failed', error: parsed.kind === 'version-mismatch' ? 'version-mismatch' : 'invalid-request', detail: parsed.kind === 'ok' ? 'Passport already has an approval open.' : 'Passport could not read this contract request.' }), event.origin);
        return;
      }
      const target = { request: parsed.value, origin: event.origin, source };
      current.current = target;
      setPending(target);
      setMessage(null);
    };
    window.addEventListener('message', onMessage);
    return () => { window.removeEventListener('message', onMessage); if (current.current) releaseContractApproval(); };
  }, [launch]);

  useEffect(() => {
    if (!pending || !sessionActive || checked) return;
    if (!networkId || !execute) {
      const timer = window.setTimeout(() => {
        reply(pending, { status: 'failed', error: 'wallet-unavailable' });
        setMessage('The Passport signing session is unavailable.');
      }, 5_000);
      return () => window.clearTimeout(timer);
    }
    let cancelled = false;
    void (async () => {
      try {
        // The ledger initialises WASM. Load it only for an actual approval,
        // keeping ordinary Passport startup independent of its download.
        const { inspectContractTransaction } = await import('./lib/contractTxApproval.js');
        if (cancelled || current.current !== pending) return;
        inspectContractTransaction(pending.request.intent, networkId);
        setChecked(true);
      } catch (cause) {
        if (cancelled || current.current !== pending) return;
        const detail = (cause instanceof Error ? cause.message : String(cause)).slice(0, 400);
        reply(pending, { status: 'failed', error: 'invalid-request', detail });
        setMessage(detail);
      }
    })();
    return () => { cancelled = true; };
  }, [pending, sessionActive, networkId, execute, checked]);

  const approve = async () => {
    if (!pending || !checked || !executeRef.current || signingRef.current) return;
    const target = pending;
    signingRef.current = true;
    setSigning(true);
    try {
      const result = await executeRef.current(target.request.intent, target.origin);
      if (!result.txId) throw new Error('The node returned no transaction identifier.');
      reply(target, { status: 'submitted', txId: result.txId, sponsored: true });
      setMessage(`Checking contract transaction: ${result.txId}`);
    } catch (cause) {
      const cancelled = (cause as { code?: string })?.code === 'approval-cancelled';
      const detail = (cause instanceof Error ? cause.message : String(cause)).slice(0, 400);
      reply(target, { status: cancelled ? 'declined' : 'failed', error: cancelled ? 'declined' : 'submit-failed', detail });
      setMessage(detail);
    } finally { signingRef.current = false; setSigning(false); }
  };

  if (launch && !window.opener) return <div role="alert">The app lost its connection to Passport. Return to the app and open Passport again.</div>;
  if (!pending) return message && launch ? <div role="status" style={{ position: 'fixed', bottom: 24, left: 24, right: 24, padding: 20, background: '#17191e', color: 'white', zIndex: 10000, overflowWrap: 'anywhere' }}>{message}</div> : null;
  if (!sessionActive) return null;
  return createPortal(<div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: '#000b', display: 'grid', placeItems: 'center', padding: 24 }}>
    <section role="dialog" aria-modal="true" aria-labelledby="contract-consent-title" style={{ width: '100%', maxWidth: 520, maxHeight: '90vh', overflow: 'auto', borderRadius: 20, padding: 28, background: '#17191e', color: 'white', overflowWrap: 'anywhere' }}>
      <h2 id="contract-consent-title">Approve contract call</h2>
      <p>{pending.origin}</p>
      <p>{pending.request.intent.purpose}</p>
      <dl><dt>Network</dt><dd>Stagenet</dd><dt>Contract</dt><dd>{pending.request.intent.contractAddress}</dd><dt>Circuit</dt><dd>{pending.request.intent.entryPoint}</dd></dl>
      <p>No NIGHT or shielded assets are transferred. This call can change the contract's public state. Passport will request sponsorship for the network fee.</p>
      <p>The app's description is supplied by the app. Passport has checked the contract and circuit against the transaction.</p>
      <div style={{ display: 'flex', gap: 12 }}><button disabled={signing} onClick={() => { reply(pending, { status: 'declined', error: 'declined' }); setMessage('Contract call declined.'); }}>Decline</button><button disabled={!checked || signing} onClick={() => void approve()}>{signing ? 'Signing and submitting…' : checked ? 'Approve' : 'Checking transaction…'}</button></div>
    </section>
  </div>, document.body);
}
