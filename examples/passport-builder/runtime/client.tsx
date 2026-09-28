import { useEffect, useSyncExternalStore } from 'react';

type Profile = { displayName?: string; passportContract?: { address: string; network?: string } };
import type { Transaction } from './pending-transaction.js';
type State = { profile?: Profile; connected: boolean; connecting: boolean; transacting: boolean; ledgerVersion: number; lastTransaction?: Transaction; contractAddress?: string; network: 'stagenet' };
let state: State = { connected: false, connecting: false, transacting: false, ledgerVersion: 0, network: 'stagenet' };
const subscribers = new Set<() => void>();
const pending = new Map<string, { resolve: (data: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
// The immutable host origin is injected by the maintained bundler.
declare const __PASSPORT_HOST_ORIGIN__: string;
const hostOrigin = __PASSPORT_HOST_ORIGIN__;
window.addEventListener('message', event => {
  if (event.source !== parent || event.origin !== hostOrigin || event.data?.channel !== 'passport-builder:host') return;
  if (event.data.type === 'state') { state = { ...state, ...event.data.state }; subscribers.forEach(fn => fn()); return; }
  const task = pending.get(event.data.id);
  if (!task) return;
  clearTimeout(task.timer); pending.delete(event.data.id);
  if (event.data.error) task.reject(new Error(event.data.error)); else task.resolve(event.data.result);
});
function request(method: string, params?: unknown): Promise<any> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Passport did not answer in time. Check the request in Passport and the transaction status above before trying again.')); }, 360_000);
    pending.set(id, { resolve, reject, timer });
    parent.postMessage({ channel: 'passport-builder:app', id, method, params }, hostOrigin);
  });
}
let connecting: Promise<Profile> | undefined;
let reading: Promise<Record<string, unknown>> | undefined;
let initialState: Promise<unknown> | undefined;
function subscribe(listener: () => void) { subscribers.add(listener); return () => { subscribers.delete(listener); }; }
function snapshot() { return state; }

// Stable methods are shared by every hook instance. Including readLedger in an
// effect dependency list must not cause a new request after every React render.
function connect(): Promise<Profile> {
  if (state.connected && state.profile) return Promise.resolve(state.profile);
  return connecting ??= request('connect').finally(() => { connecting = undefined; });
}
function readLedger(): Promise<Record<string, unknown>> {
  return reading ??= request('ledger').finally(() => { reading = undefined; });
}
function callContract(circuit: string, args: unknown[] = [], purpose = 'Call contract'): Promise<Transaction> {
  return request('call', { circuit, args, purpose });
}
function waitForTransaction(txId: string): Promise<Transaction> {
  return request('transaction', { txId });
}
export function usePassport() {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => { void (initialState ??= request('state')).catch(() => undefined); }, []);
  return { ...current, connect, callContract, readLedger, waitForTransaction };
}
