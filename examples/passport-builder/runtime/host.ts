import { createPassport } from '@midnight-passport/connect';
import { PendingTransaction, unresolved, type Transaction } from './pending-transaction.js';

type Profile = { displayName?: string; passportContract?: { address: string; network?: string } };
const data = JSON.parse(document.getElementById('runtime-data')!.textContent!) as {
  id: string; name: string; passportOrigin: string; app: string;
  contractAddress?: string; deploymentId?: string; circuits: string[];
};
const frame = document.getElementById('app') as HTMLIFrameElement;
const connectButton = document.getElementById('connect') as HTMLButtonElement;
const notice = document.getElementById('notice')!;
const dialog = document.getElementById('approval') as HTMLDialogElement;
const approve = document.getElementById('approve') as HTMLButtonElement;
const cancel = document.getElementById('cancel') as HTMLButtonElement;
// The maintained host can be nested inside the builder. Its outer frame allows
// popups to escape the sandbox; generated code's inner frame stays opaque.
const passport = createPassport({ origin: data.passportOrigin, transport: 'popup' });
const profileKey = `passport-builder:profile:${new URL(data.passportOrigin).origin}:${data.id}`;
const profileLifetime = 8 * 60 * 60_000;
let profile: Profile | undefined;
let busy: 'connect' | 'call' | undefined;
let connectFlight: Promise<Profile> | undefined;
let ledgerFlight: Promise<Record<string, unknown>> | undefined;
let ledgerVersion = 0;
let lastTransaction: Transaction | undefined;
let disposed = false;
const transactions = new Map<string, { result: Transaction; polling?: Promise<Transaction> }>();
const recovery = document.getElementById('recovery')!;
const checkPending = document.getElementById('check-pending') as HTMLButtonElement;
const clearPending = document.getElementById('clear-pending') as HTMLButtonElement;
let pendingStore: PendingTransaction | undefined;
let recoveryBlocked = false;
try {
  pendingStore = new PendingTransaction(sessionStorage, `passport-builder:pending:${data.id}:${data.deploymentId}`);
  lastTransaction = pendingStore.restore();
  if (lastTransaction) {
    transactions.set(lastTransaction.txId, { result: lastTransaction });
    notice.textContent = `Checking an earlier Passport request: ${lastTransaction.txId}. Its outcome is not yet known.`;
  }
} catch {
  recoveryBlocked = true;
  notice.textContent = 'Transaction recovery storage is unavailable. Review Passport before clearing browser data or starting another request.';
}
checkPending.onclick = async () => {
  if (!lastTransaction || busy) return;
  checkPending.disabled = true;
  try { await waitForTransaction(lastTransaction.txId); }
  catch (error) { notice.textContent = error instanceof Error ? error.message : 'Status unavailable.'; }
  finally { checkPending.disabled = false; }
};
clearPending.onclick = () => {
  if (busy || !unresolved(lastTransaction)) return;
  // Deliberate acknowledgement is required; a timeout never enables a retry.
  if (!window.confirm('Have you reviewed this request in Passport and the ledger? Clearing this warning does not cancel it. A new request could repeat the same change.')) return;
  try { pendingStore!.clear(); }
  catch { notice.textContent = 'Could not clear the saved request.'; return; }
  lastTransaction = undefined;
  notice.textContent = 'Earlier request cleared after your review. Check the ledger before making another change.';
  state();
};

// This cache remembers this app's approved display fields in this tab only.
// It is never used as a wallet session, permission, signer, or account authority.
try {
  const raw = sessionStorage.getItem(profileKey);
  if (raw && raw.length <= 8192) {
    const saved = JSON.parse(raw);
    const value = saved.profile;
    if (saved.version === 1 && saved.expiresAt > Date.now() && saved.expiresAt <= Date.now() + profileLifetime && value && typeof value === 'object' &&
      (value.displayName === undefined || (typeof value.displayName === 'string' && value.displayName.length <= 1024)) &&
      (value.passportContract === undefined || (typeof value.passportContract.address === 'string' && /^[a-fA-F0-9]{64}$/.test(value.passportContract.address) &&
        (value.passportContract.network === undefined || value.passportContract.network === 'stagenet')))) {
      profile = { ...(value.displayName === undefined ? {} : { displayName: value.displayName }),
        ...(value.passportContract === undefined ? {} : { passportContract: { address: value.passportContract.address, network: 'stagenet' } }) };
    } else sessionStorage.removeItem(profileKey);
  }
} catch { /* Storage may be disabled; the live SDK connection still works. */ }

function post(message: object) {
  // This exact frame has an opaque sandbox origin, so '*' is required here.
  // Its listener pins this host's real origin and event.source === parent.
  frame.contentWindow?.postMessage({ channel: 'passport-builder:host', ...message }, '*');
}
function state() {
  recovery.hidden = !unresolved(lastTransaction);
  clearPending.disabled = !!busy;
  connectButton.disabled = !!busy;
  connectButton.textContent = profile?.displayName || (profile ? 'Passport connected' : busy === 'connect' ? 'Connecting…' : 'Connect Passport');
  post({ type: 'state', state: { profile, connected: !!profile, connecting: busy === 'connect', transacting: busy === 'call',
    contractAddress: data.contractAddress, network: 'stagenet', ledgerVersion, lastTransaction } });
}
async function shareProfile(): Promise<Profile> {
  const result = await passport.requestProfile(['displayName', 'passportContract']);
  if (!result.approved) throw new Error(result.message);
  if (result.profile.passportContract?.network && result.profile.passportContract.network !== 'stagenet') throw new Error('Connect a stage-net Passport to this app.');
  profile = result.profile;
  try { sessionStorage.setItem(profileKey, JSON.stringify({ version: 1, expiresAt: Date.now() + profileLifetime, profile })); }
  catch { /* Remembering approved display fields is optional. */ }
  notice.textContent = data.contractAddress ? 'Passport connected. Your app is ready.' : 'Passport connected. Waiting for the app deployment.';
  state();
  return profile;
}
function connect(fromApp = false): Promise<Profile> {
  if (profile) { state(); return Promise.resolve(profile); }
  if (connectFlight) return connectFlight;
  if (busy) return Promise.reject(new Error('A transaction is already awaiting Passport approval.'));
  busy = 'connect'; state();
  const action = fromApp
    ? confirmation('Connect with Passport', `${data.name} is asking for your display name and Passport identity. Choose what to share in Passport.`, shareProfile)
    : shareProfile();
  connectFlight = action.finally(() => { connectFlight = undefined; busy = undefined; state(); });
  return connectFlight;
}
connectButton.addEventListener('click', () => {
  void connect().catch(error => { notice.textContent = error instanceof Error ? error.message : 'Passport connection failed.'; });
});
function confirmation<T>(title: string, copy: string, action: () => Promise<T>): Promise<T> {
  document.getElementById('approval-title')!.textContent = title;
  document.getElementById('approval-copy')!.textContent = copy;
  return new Promise((resolve, reject) => {
    const clean = () => { approve.onclick = null; cancel.onclick = null; dialog.oncancel = null; dialog.close(); };
    const decline = () => { clean(); reject(new Error('Request cancelled.')); };
    // Opening Passport remains inside a real click on the maintained host.
    // Generated postMessage requests cannot bypass popup restrictions.
    approve.onclick = () => { clean(); action().then(resolve, reject); };
    cancel.onclick = decline;
    dialog.oncancel = event => { event.preventDefault(); decline(); };
    dialog.showModal();
  });
}
async function requestApi(path: string, body?: unknown, timeout = 300_000) {
  const response = await fetch(`/api/runtime/${encodeURIComponent(data.id)}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Service returned ${response.status}`);
  return result;
}
function readLedger(): Promise<Record<string, unknown>> {
  if (!data.deploymentId) return Promise.reject(new Error('This app is still deploying. Its public ledger will be available once the deployment is indexed.'));
  return ledgerFlight ??= requestApi(`ledger?deployment=${encodeURIComponent(data.deploymentId)}`, undefined, 45_000).finally(() => { ledgerFlight = undefined; });
}
function waitForTransaction(txId: unknown): Promise<Transaction> {
  const tracked = typeof txId === 'string' ? transactions.get(txId) : undefined;
  if (!tracked) return Promise.reject(new Error('Only a transaction submitted through Passport in this app session can be checked.'));
  if (!unresolved(tracked.result)) return Promise.resolve(tracked.result);
  if (tracked.polling) return tracked.polling;
  tracked.polling = (async () => {
    const deadline = Date.now() + 120_000;
    let statusError: string | undefined;
    for (let attempt = 0; attempt < 12 && !disposed && Date.now() < deadline; attempt += 1) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, Math.min(10_000, attempt * 2000)));
      if (disposed) break;
      try {
        const result = await requestApi(`transaction?deployment=${encodeURIComponent(data.deploymentId!)}&txId=${encodeURIComponent(tracked.result.txId)}`, undefined, Math.min(15_000, Math.max(1, deadline - Date.now())));
        if (result.txId !== tracked.result.txId || !['submitted', 'confirmed', 'failed'].includes(result.status)) throw new Error('The transaction status response was invalid.');
        statusError = undefined;
        if (result.status !== 'submitted') {
          tracked.result = { status: result.status, txId: tracked.result.txId,
            ...(Number.isSafeInteger(result.blockHeight) && result.blockHeight >= 0 ? { blockHeight: result.blockHeight } : {}),
            ...(typeof result.message === 'string' ? { message: result.message.slice(0, 2000) } : {}) };
          if (lastTransaction?.txId === tracked.result.txId) { lastTransaction = tracked.result; try { pendingStore?.clear(); } catch { /* A retained marker only blocks another write. */ } }
          // Partial failures may also change state. Finish an older read before
          // refreshing the newly indexed ledger, then notify every hook instance.
          await ledgerFlight?.catch(() => undefined);
          await readLedger().catch(() => undefined);
          ledgerVersion += 1;
          if (!busy) notice.textContent = tracked.result.status === 'confirmed'
            ? `Confirmed on stage-net: ${tracked.result.txId}.`
            : tracked.result.message || `Transaction ${tracked.result.txId} did not fully succeed. Review the latest ledger before retrying.`;
          state();
          return tracked.result;
        }
      } catch (error) {
        // An unavailable indexer never turns an accepted transaction into a failure.
        statusError = error instanceof Error ? error.message.slice(0, 240) : 'Status service unavailable.';
        if (!busy && !disposed) notice.textContent = `Request ${tracked.result.txId}. Status check unavailable: ${statusError}`;
      }
    }
    if (!busy && !disposed) notice.textContent = `Request ${tracked.result.txId}. ${statusError ? `Status check unavailable: ${statusError}` : 'Indexing is still pending; check again shortly.'}`;
    return tracked.result;
  })().finally(() => { tracked.polling = undefined; });
  return tracked.polling;
}
async function call(params: any): Promise<Transaction> {
  if (!data.contractAddress || !data.deploymentId) throw new Error('This app is still deploying. Transactions become available once the deployment is indexed.');
  if (!params || typeof params.circuit !== 'string' || !data.circuits.includes(params.circuit) || !Array.isArray(params.args) || params.args.length > 32 || typeof params.purpose !== 'string' || params.purpose.length < 1 || params.purpose.length > 240) throw new Error('Invalid contract request.');
  if (JSON.stringify(params.args).length > 20_000) throw new Error('Contract arguments exceed the request limit.');
  if (busy) throw new Error('Another Passport approval is in progress.');
  if (recoveryBlocked || !pendingStore) throw new Error('Transaction recovery storage is unavailable. Nothing was sent.');
  if (unresolved(lastTransaction)) throw new Error('An earlier Passport request is unresolved. Check its status above before making another change.');
  busy = 'call'; state();
  try {
    notice.textContent = 'Preparing the contract proof…';
    const prepared = await requestApi('prepare', { deploymentId: data.deploymentId, circuit: params.circuit, args: params.args });
    const response = await confirmation('Approve with Passport', `${params.purpose}\n\n${params.circuit} · ${data.contractAddress}\nStage-net · no token transfer`, async () => {
      lastTransaction = pendingStore!.begin(prepared.txId);
      transactions.set(prepared.txId, { result: lastTransaction });
      state();
      try {
        return await passport.requestContractTransaction({ networkId: 'stagenet', transaction: prepared.transaction,
          contractAddress: data.contractAddress!, entryPoint: params.circuit, purpose: params.purpose });
      } catch { return undefined; } // No reply is not evidence of rejection.
    });
    if (response?.status === 'submitted' && response.txId === prepared.txId) {
      lastTransaction = { status: 'submitted', txId: prepared.txId };
    } else if (response && response.status !== 'submitted' &&
      !(response.source === 'local' && ['timed-out', 'passport-closed'].includes(response.error))) {
      pendingStore.clear(); lastTransaction = undefined; transactions.delete(prepared.txId);
      throw new Error(response.message);
    } else {
      lastTransaction = { status: 'unknown', txId: prepared.txId, message: 'Passport did not return a matching receipt. Check this request before trying again.' };
    }
    transactions.set(prepared.txId, { result: lastTransaction });
    // Retain at most 50 recent proofs of submission for this maintained host.
    if (transactions.size > 50) transactions.delete(transactions.keys().next().value!);
    notice.textContent = lastTransaction.status === 'submitted' ? `Submitted ${prepared.txId}. Waiting for stage-net indexing…` : lastTransaction.message!;
    void waitForTransaction(prepared.txId);
    return lastTransaction;
  } finally { busy = undefined; state(); }
}
window.addEventListener('message', async event => {
  if (event.source !== frame.contentWindow || event.origin !== 'null' || event.data?.channel !== 'passport-builder:app') return;
  const request = event.data;
  if (request.method === 'error') { notice.textContent = String(request.message || '').slice(0, 2000); return; }
  if (typeof request.id !== 'string' || request.id.length < 1 || request.id.length > 100) return;
  try {
    let result: unknown;
    if (request.method === 'state') { state(); result = true; }
    else if (request.method === 'connect') result = await connect(true);
    else if (request.method === 'ledger') {
      // Older generated apps refresh immediately after callContract resolves.
      // Wait for their already-running submission check so that read observes
      // the indexed result, rather than returning a stale pre-submit snapshot.
      if (unresolved(lastTransaction) && lastTransaction) await transactions.get(lastTransaction.txId)?.polling;
      result = await readLedger();
    }
    else if (request.method === 'transaction') result = await waitForTransaction(request.params?.txId);
    else if (request.method === 'call') result = await call(request.params);
    else throw new Error('Unsupported application request.');
    post({ id: request.id, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The request failed.';
    notice.textContent = message; post({ id: request.id, error: message });
  }
});
frame.addEventListener('load', state);
frame.srcdoc = data.app;
state();
if (lastTransaction) void waitForTransaction(lastTransaction.txId);
// Back-forward cache keeps the SDK instance, profile, and listeners alive.
window.addEventListener('pagehide', event => { if (!event.persisted) { disposed = true; passport.destroy(); } });
