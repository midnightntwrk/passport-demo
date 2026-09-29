import { useCallback, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { usePassport } from './client';
import { uiStyles } from './ui-styles';

export function AppShell({ title, description, actions, children, footer }: { title: string; description?: string; actions?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return <main className="mpui"><style>{uiStyles}</style><div className="mpui-content"><header className="mpui-header"><div><div className="mpui-kicker">Midnight · Stage-net</div><h1>{title}</h1>{description && <p className="mpui-description">{description}</p>}</div>{actions && <div className="mpui-header-actions">{actions}</div>}</header>{children}{footer && <footer className="mpui-footer">{footer}</footer>}</div></main>;
}

export function Button({ variant = 'primary', className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  return <button {...props} type={type} className={`mpui-button ${variant} ${className}`} />;
}

export function Field({ label, help, error, id, className = '', ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; help?: string; error?: string }) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const descriptionId = `${inputId}-help`;
  return <label className={`mpui-field ${className}`} htmlFor={inputId}><span>{label}</span><input {...props} id={inputId} aria-invalid={!!error || props['aria-invalid']} aria-describedby={[props['aria-describedby'], (error || help) && descriptionId].filter(Boolean).join(' ') || undefined} />{(error || help) && <small id={descriptionId} className={error ? 'error' : ''}>{error || help}</small>}</label>;
}

export function Status({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' | 'success' }) {
  return <div className={`mpui-status ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}

type RecordItem = { id: string; label: string; value: string };
type Records = { items: RecordItem[]; size: string; truncated: boolean };
type Transaction = { txId: string; purpose: string; status: 'unknown' | 'submitted' | 'confirmed' | 'failed'; clearForm?: boolean };
const UINT64_MAX = 18446744073709551615n;
const message = (error: unknown) => error instanceof Error ? error.message : 'The request failed. Please try again.';
const byteLength = (value: string) => new TextEncoder().encode(value).length;

/** String helpers preserve full Uint64 precision and the circuit's exact Bytes32 shape. */
export function normaliseRecordId(input: string): string {
  if (!/^\d{1,20}$/.test(input) || BigInt(input) > UINT64_MAX) throw new Error('Use an integer from 0 to 18446744073709551615.');
  return BigInt(input).toString();
}
export function encodeRecordText(input: string): string {
  const bytes = new TextEncoder().encode(input);
  if (bytes.length > 32) throw new Error('Use no more than 32 UTF-8 bytes.');
  const padded = new Uint8Array(32); padded.set(bytes);
  return Array.from(padded, byte => byte.toString(16).padStart(2, '0')).join('');
}
function decodeRecordText(input: unknown): string {
  if (typeof input !== 'string' || !/^(0x)?[\da-f]{64}$/i.test(input)) throw new Error('The ledger returned an invalid record field.');
  const hex = input.replace(/^0x/i, '');
  const bytes = Uint8Array.from(hex.match(/../g)!, byte => parseInt(byte, 16));
  let length = bytes.length; while (length && bytes[length - 1] === 0) length--;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)); }
  catch { return `0x${hex}`; }
}
export function parseRecords(ledger: Record<string, unknown>): Records {
  const records = ledger.records as { entries?: unknown; size?: unknown; truncated?: unknown } | undefined;
  if (!records || !Array.isArray(records.entries) || typeof records.size !== 'string' || !/^\d+$/.test(records.size) || typeof records.truncated !== 'boolean') throw new Error('The contract did not return the expected records ledger.');
  const items = records.entries.map(entry => {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !entry[1] || typeof entry[1] !== 'object') throw new Error('The ledger returned an invalid record.');
    return { id: normaliseRecordId(entry[0]), label: decodeRecordText(entry[1].label), value: decodeRecordText(entry[1].value) };
  }).sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);
  return { items, size: records.size, truncated: records.truncated };
}

export interface CrudAppProps { title?: string; description?: string; itemName?: string; labelName?: string; valueName?: string }

/** A public, permissionless records UI for the maintained Compact CRUD contract. */
export function CrudApp({ title = 'Shared records', description = 'Create and maintain records together on Midnight.', itemName = 'record', labelName = 'Name', valueName = 'Details' }: CrudAppProps) {
  const passport = usePassport();
  const { contractAddress, connected, connecting, transacting, profile, ledgerVersion, readLedger, connect, callContract, waitForTransaction } = passport;
  const [records, setRecords] = useState<Records | null>(null);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState('');
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [errors, setErrors] = useState<{ id?: string; label?: string; value?: string }>({});
  const requestVersion = useRef(0);
  const operation = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const busy = !!pending || connecting || transacting;
  useEffect(() => {
    setTransaction(previous => {
      if (!previous) return previous;
      if (!passport.lastTransaction) return null;
      return previous.txId === passport.lastTransaction.txId ? { ...previous, status: passport.lastTransaction.status } : previous;
    });
  }, [passport.lastTransaction]);
  const awaitingConfirmation = transaction?.status === 'submitted' || transaction?.status === 'unknown';
  const writesDisabled = !contractAddress || busy || awaitingConfirmation;

  const refresh = useCallback(async () => {
    if (!contractAddress) return;
    const version = ++requestVersion.current;
    setLoading(true); setReadError('');
    try { const state = parseRecords(await readLedger()); if (requestVersion.current === version) setRecords(state); }
    catch (failure) { if (requestVersion.current === version) setReadError(message(failure)); }
    finally { if (requestVersion.current === version) setLoading(false); }
  }, [contractAddress, readLedger]);
  useEffect(() => { void refresh(); return () => { requestVersion.current++; }; }, [refresh, ledgerVersion]);

  async function connectPassport() {
    if (operation.current) return;
    operation.current = true; setPending('Opening Passport…'); setError('');
    try { await connect(); } catch (failure) { setError(message(failure)); }
    finally { operation.current = false; setPending(''); }
  }
  function resetForm() { setId(''); setLabel(''); setValue(''); setEditing(false); setErrors({}); }
  async function confirmTransaction(tx: Transaction) {
    const result = await waitForTransaction(tx.txId);
    setTransaction({ ...tx, status: result.status });
    if (result.status === 'failed') throw new Error(result.message || 'The transaction failed on-chain. Your inputs are preserved.');
    if (result.status === 'confirmed') { if (tx.clearForm) resetForm(); await refresh(); }
    return result.status;
  }
  async function checkConfirmation() {
    if (!transaction || operation.current) return;
    operation.current = true; setPending('Checking confirmation…'); setError('');
    try { await confirmTransaction(transaction); } catch (failure) { setError(message(failure)); }
    finally { operation.current = false; setPending(''); }
  }
  async function write(circuit: string, args: string[], purpose: string) {
    if (operation.current || writesDisabled) return;
    operation.current = true; setError(''); setPending(connected ? 'Awaiting Passport approval…' : 'Opening Passport…');
    try {
      if (!connected) await connect();
      setPending('Awaiting Passport approval…');
      const submitted = await callContract(circuit, args, purpose.slice(0, 240));
      const tx: Transaction = { txId: submitted.txId, purpose, status: submitted.status, clearForm: circuit !== 'deleteRecord' || (editing && id === args[0]) };
      setTransaction(tx); setPending(submitted.status === 'unknown' ? 'Request outcome unknown · checking stage-net…' : 'Submitted · waiting for confirmation…');
      await confirmTransaction(tx);
    } catch (failure) { setError(message(failure)); }
    finally { operation.current = false; setPending(''); }
  }
  function save() {
    const next: typeof errors = {};
    let normalisedId = ''; let labelHex = ''; let valueHex = '';
    try { normalisedId = normaliseRecordId(id.trim()); } catch (failure) { next.id = message(failure); }
    try { if (!label.trim()) throw new Error(`Enter ${labelName.toLowerCase()}.`); labelHex = encodeRecordText(label); } catch (failure) { next.label = message(failure); }
    try { valueHex = encodeRecordText(value); } catch (failure) { next.value = message(failure); }
    setErrors(next);
    if (Object.keys(next).length) return;
    void write(editing ? 'updateRecord' : 'createRecord', [normalisedId, labelHex, valueHex], `${editing ? 'Update' : 'Create'} public ${itemName} ${normalisedId}: ${label}`);
  }
  function edit(record: RecordItem) {
    setId(record.id); setLabel(record.label); setValue(record.value); setEditing(true); setErrors({});
    form.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    form.current?.querySelector<HTMLInputElement>('input[name="label"]')?.focus({ preventScroll: true });
  }

  return <AppShell title={title} description={description} actions={connected ? <span className="mpui-profile mpui-connected">{profile?.displayName || 'Passport connected'}</span> : <Button variant="secondary" onClick={() => void connectPassport()} disabled={busy}>{connecting || pending === 'Opening Passport…' ? 'Opening Passport…' : 'Connect Passport'}</Button>} footer={<><span>Public, collaborative records. Any participant can create, update, or delete them.</span><code className="mpui-address">{contractAddress ? `Contract: ${contractAddress}` : 'Preview · not deployed'}</code></>}>
    {!contractAddress && <Status>This is a preview. Records and transactions become available after deployment to stage-net.</Status>}
    {error && <Status tone="error">{error}</Status>}
    {transaction && <Status tone={transaction.status === 'confirmed' ? 'success' : transaction.status === 'failed' ? 'error' : 'info'}><p><strong>{transaction.status === 'confirmed' ? 'Transaction confirmed' : transaction.status === 'failed' ? 'Transaction failed' : transaction.status === 'unknown' ? 'Request outcome unknown' : 'Transaction submitted'}</strong> · {transaction.purpose}</p><p><code>{transaction.txId}</code></p>{awaitingConfirmation && <><p>Waiting for the network to confirm this change. The records below show the last ledger read.</p><Button variant="secondary" onClick={() => void checkConfirmation()} disabled={busy}>Check confirmation</Button></>}</Status>}
    {pending && <p className="mpui-small" role="status">{pending}</p>}
    <div className="mpui-grid">
      <form className="mpui-panel mpui-form" ref={form} onSubmit={event => event.preventDefault()} onKeyDown={event => {
        // Keep the shared UI usable even in hosts that omit allow-forms.
        // Enter invokes the same action without a native submit or navigation.
        if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.target instanceof HTMLInputElement) { event.preventDefault(); save(); }
      }} noValidate>
        <div className="mpui-form-heading"><h2>{editing ? 'Edit' : 'Create'} {itemName}</h2></div>
        <Field label="Record ID" inputMode="numeric" value={id} onChange={event => setId(event.target.value)} disabled={editing || busy || awaitingConfirmation} error={errors.id} help="Choose a unique number. Existing IDs cannot be created again." />
        <Field label={labelName} name="label" value={label} onChange={event => setLabel(event.target.value)} disabled={busy || awaitingConfirmation} error={errors.label} help={`${byteLength(label)}/32 UTF-8 bytes`} />
        <Field label={valueName} value={value} onChange={event => setValue(event.target.value)} disabled={busy || awaitingConfirmation} error={errors.value} help={`${byteLength(value)}/32 UTF-8 bytes · optional`} />
        <div className="mpui-form-actions"><Button onClick={save} disabled={writesDisabled}>{editing ? 'Save changes' : `Create ${itemName}`}</Button>{editing && <Button variant="secondary" onClick={resetForm} disabled={busy || awaitingConfirmation}>Cancel</Button>}</div>
        <p className="mpui-small">{!contractAddress ? 'Deploy this app to enable changes.' : 'Approve every change with Passport. All record data is public.'}</p>
      </form>
      <section aria-label="Records"><div className="mpui-list-heading"><div><h2>Records</h2><p className="mpui-small mpui-count">{records ? `${records.size} stored · ${records.items.length} shown` : 'Read from the public ledger'}</p></div><Button variant="secondary" onClick={() => void refresh()} disabled={!contractAddress || loading}>{loading ? 'Refreshing…' : 'Refresh'}</Button></div>
        {readError && <Status tone="error">{readError} Use Refresh to retry.</Status>}
        {records?.truncated && <Status>Only the first 200 records are available in this view. Other records may exist.</Status>}
        {!records ? <div className="mpui-empty"><strong>{!contractAddress ? 'Your records will appear here' : loading ? 'Reading the ledger…' : 'Records unavailable'}</strong><p>{!contractAddress ? 'Deploy the app to start using real records.' : loading ? 'Fetching the current public state.' : 'Refresh to try the ledger again.'}</p></div> : records.items.length === 0 ? <div className="mpui-empty"><strong>No records yet</strong><p>Create the first {itemName} using the form.</p></div> : <ul className="mpui-records">{records.items.map(record => <li className="mpui-record" key={record.id}><div className="mpui-record-body"><span className="mpui-record-id">ID {record.id}</span><h3>{record.label || 'Unnamed record'}</h3><p>{record.value || 'No details'}</p></div><div className="mpui-record-actions"><Button variant="secondary" onClick={() => edit(record)} disabled={writesDisabled} aria-label={`Edit ${itemName} ${record.id}: ${record.label}`}>Edit</Button><Button variant="danger" onClick={() => void write('deleteRecord', [record.id], `Delete public ${itemName} ${record.id}: ${record.label}`)} disabled={writesDisabled} aria-label={`Delete ${itemName} ${record.id}: ${record.label}`}>Delete</Button></div></li>)}</ul>}
      </section>
    </div>
  </AppShell>;
}
