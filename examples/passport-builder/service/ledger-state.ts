export type LedgerJson = null | boolean | number | string | LedgerJson[] | { [key: string]: LedgerJson };

export const LEDGER_STATE_LIMITS = Object.freeze({ entries: 200, depth: 16, nodes: 10_000, bytes: 1024 * 1024 });

/**
 * Project only the public ledger returned by a verified Compact compiler module.
 * Generated Map/Set/List values are accessor wrappers, not JavaScript collections.
 * Do not pass application objects, private state, or unverified JavaScript here:
 * ledger getters and the compiler's collection size/iterator accessors execute.
 * In particular, this never invokes toJSON or arbitrary lookup methods.
 */
export function serialiseLedgerState(ledger: unknown): LedgerJson {
  const active = new WeakSet<object>();
  let nodes = 0;
  let bytes = 0;

  function account(amount: number): void {
    bytes += amount;
    if (bytes > LEDGER_STATE_LIMITS.bytes) throw new Error('Public ledger exceeds the 1 MiB response limit.');
  }

  function text(value: string): string {
    // Bound allocation before escaping. JSON.stringify is used only on strings,
    // never on a compiler wrapper that could implement toJSON.
    if (value.length > LEDGER_STATE_LIMITS.bytes) throw new Error('Public ledger exceeds the 1 MiB response limit.');
    account(Buffer.byteLength(JSON.stringify(value)));
    return value;
  }

  function collection(size: unknown, iterator: Iterator<unknown>, map: boolean, depth: number): LedgerJson {
    if (!(typeof size === 'bigint' && size >= 0n) && !(typeof size === 'number' && Number.isSafeInteger(size) && size >= 0)) {
      throw new Error('Public ledger collection has an invalid size.');
    }
    if (!iterator || typeof iterator.next !== 'function') throw new Error('Public ledger collection is not iterable.');
    const count = BigInt(size);
    const limit = Number(count > BigInt(LEDGER_STATE_LIMITS.entries) ? BigInt(LEDGER_STATE_LIMITS.entries) : count);
    const values: LedgerJson[] = [];
    account(64); // Envelope, size, separators, and truncation flag.
    for (let index = 0; index < limit; index += 1) {
      const item = iterator.next();
      if (item.done) throw new Error('Public ledger collection size does not match its entries.');
      if (map) {
        if (!Array.isArray(item.value) || item.value.length !== 2) throw new Error('Public ledger map has an invalid entry.');
        account(4);
        values.push([visit(item.value[0], depth + 1), visit(item.value[1], depth + 1)]);
      } else values.push(visit(item.value, depth + 1));
      account(1);
    }
    const sizeString = text(count.toString());
    return map
      ? { entries: values, size: sizeString, truncated: count > BigInt(limit) }
      : { values, size: sizeString, truncated: count > BigInt(limit) };
  }

  function visit(value: unknown, depth: number): LedgerJson {
    if (++nodes > LEDGER_STATE_LIMITS.nodes) throw new Error('Public ledger exceeds the value count limit.');
    if (depth > LEDGER_STATE_LIMITS.depth) throw new Error('Public ledger exceeds the nesting limit.');
    if (value === null) { account(4); return null; }
    if (typeof value === 'string') return text(value);
    if (typeof value === 'bigint') return text(value.toString());
    if (typeof value === 'boolean') { account(5); return value; }
    if (typeof value === 'number' && Number.isFinite(value)) { account(32); return value; }
    if (typeof value !== 'object') throw new Error('Public ledger contains an unsupported value.');
    if (value instanceof Uint8Array) {
      if (value.byteLength > LEDGER_STATE_LIMITS.bytes / 2) throw new Error('Public ledger exceeds the 1 MiB response limit.');
      return text(Buffer.from(value).toString('hex'));
    }
    if (active.has(value)) throw new Error('Public ledger contains a cycle.');
    active.add(value);
    try {
      if (value instanceof Map) return collection(value.size, Map.prototype.entries.call(value), true, depth);
      if (value instanceof Set) return collection(value.size, Set.prototype.values.call(value), false, depth);
      if (Array.isArray(value)) {
        // Compact vectors and tuples preserve their positional JSON shape. An
        // oversized vector fails explicitly instead of silently losing elements.
        if (value.length > LEDGER_STATE_LIMITS.entries) throw new Error('Public ledger vector exceeds 200 elements.');
        account(2 + value.length);
        return value.map((item) => visit(item, depth + 1));
      }

      const wrapper = value as Record<string | symbol, unknown>;
      if (typeof wrapper.length === 'function' && typeof wrapper.isEmpty === 'function' && typeof wrapper.head === 'function') {
        const iterator = wrapper[Symbol.iterator];
        if (typeof iterator !== 'function') throw new Error('This public ledger list cannot be enumerated.');
        return collection(wrapper.length.call(value), iterator.call(value), false, depth);
      }
      if (typeof wrapper.size === 'function' && typeof wrapper.isEmpty === 'function' && typeof wrapper.member === 'function') {
        const iterator = wrapper[Symbol.iterator];
        if (typeof iterator !== 'function') {
          throw new Error('This public ledger collection cannot be enumerated. Use maps with scalar or struct values instead of nested ledger collections.');
        }
        return collection(wrapper.size.call(value), iterator.call(value), typeof wrapper.lookup === 'function', depth);
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) throw new Error('Public ledger contains an unsupported object.');
      const keys = Object.keys(value);
      if (keys.length > LEDGER_STATE_LIMITS.nodes) throw new Error('Public ledger exceeds the value count limit.');
      const result: Record<string, LedgerJson> = {};
      account(2 + keys.length * 2);
      for (const key of keys) {
        text(key);
        // Define an own property so a valid ledger field named __proto__ stays
        // data and never changes the response object's prototype.
        Object.defineProperty(result, key, { value: visit(wrapper[key], depth + 1), enumerable: true, configurable: true, writable: true });
      }
      return result;
    } finally { active.delete(value); }
  }

  return visit(ledger, 0);
}
