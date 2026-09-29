export type Transaction = { status: 'unknown' | 'submitted' | 'confirmed' | 'failed'; txId: string; blockHeight?: number; message?: string };
export function unresolved(tx: Transaction | undefined): boolean {
  return tx?.status === 'unknown' || tx?.status === 'submitted';
}
/** A conservative replay guard, never proof that approval or submission happened. */
export class PendingTransaction {
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, private key: string) {}
  restore(): Transaction | undefined {
    const raw = this.storage.getItem(this.key);
    if (!raw) return;
    if (raw.length > 1024) throw new Error('Saved transaction is invalid. Review Passport before clearing browser data.');
    const value = JSON.parse(raw);
    if (value.version !== 1 || !/^[0-9a-f]{66}$/.test(value.txId)) throw new Error('Saved transaction is invalid. Review Passport before clearing browser data.');
    return { status: 'unknown', txId: value.txId };
  }
  begin(txId: string): Transaction {
    if (!/^[0-9a-f]{66}$/.test(txId)) throw new Error('The prepared transaction identifier is invalid.');
    // Save synchronously before opening Passport, preserving the click gesture.
    this.storage.setItem(this.key, JSON.stringify({ version: 1, txId }));
    return { status: 'unknown', txId };
  }
  clear() { this.storage.removeItem(this.key); }
}
