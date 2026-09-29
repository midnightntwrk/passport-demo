import { readFileSync } from 'node:fs';

export interface ContractPattern {
  id: 'member-registry' | 'task-workflow';
  name: string;
  use: string;
  source: string;
}

/** Exact sources exercised against Compact 0.34.0 output by the pattern regression. */
export const CONTRACT_PATTERNS: readonly ContractPattern[] = [
  {
    id: 'member-registry',
    name: 'Keyed registry with active membership',
    use: 'Shows separate records per Bytes<32> key, persisted labels, Set membership, updates, duplicate rejection, and public Boolean input. Useful syntax for directories, registries, catalogues, and attendance; adapt the fields and actions to the requested domain.',
    source: readFileSync(new URL('./patterns/member-registry.compact', import.meta.url), 'utf8'),
  },
  {
    id: 'task-workflow',
    name: 'Keyed records with enforced lifecycle transitions',
    use: 'Shows a Map of named structs, integer IDs, stored text and priority, an enum, range checks, and an enforced Open → InProgress → Done lifecycle. Useful syntax for task boards, proposals, applications, bookings, and issue tracking; choose domain-specific fields and transitions.',
    source: readFileSync(new URL('./patterns/task-workflow.compact', import.meta.url), 'utf8'),
  },
];

/** Both data shapes remain available; intent only changes which appears first. */
export function contractPatternInstructions(brief: string): string {
  const workflowFirst = /\b(tasks?|workflows?|kanban|proposals?|approvals?|bookings?|reservations?|tickets?|issues?|applications?|status|stages?)\b/i.test(brief);
  const patterns = workflowFirst ? [...CONTRACT_PATTERNS].reverse() : CONTRACT_PATTERNS;
  return `Compact data modelling references for the pinned 0.34.0 compiler:
These are syntax references, not required app templates. Choose entities, keys, fields, invariants, and circuit names from the user's actual idea; combine and adapt the patterns when useful. A registry must store distinct entries; a workflow must store distinct records and enforce its transitions. Use a scalar counter only when the requested behaviour is counting, or as a supporting aggregate alongside the actual records. Do not replace a requested application with a counter, rename increment() to suggest a feature, or emit empty/no-op circuits.
Both examples are public and permissionless: anyone may submit their actions. A caller-supplied ID, Passport profile, or UI restriction does not prove ownership or confer administrator authority. Do not claim otherwise. These examples move no tokens, use no private witnesses, and require no constructor arguments.
${patterns.map(pattern => `\nReference: ${pattern.name}\n${pattern.use}\n\`\`\`compact\n${pattern.source.trim()}\n\`\`\``).join('\n')}

Use Map.member(key) before lookup when absence is possible. Update structs by inserting a complete named struct value at the same key. Disclose circuit inputs before they reach public ledger operations or assertions. Enum variants use Type.Variant in Compact; keep exported circuit inputs to Uint<N>, Boolean, or Bytes<N>, using separate transition circuits when appropriate.
For human-readable Bytes<32> fields, encode text with TextEncoder, reject more than 32 UTF-8 bytes, zero-pad a 32-byte Uint8Array, then send its 64-character hexadecimal string. Decode returned bytes from hex with TextDecoder after removing trailing zero bytes. A hex identifier should remain hex; do not decode arbitrary identifiers as text. Explain text-length limits next to fields. Never send an unencoded text label as a Bytes argument.
Render Map entries and Set values from readLedger using the documented serialised collection shape, not property lookup on a native JS Map or Object.entries(collection). Collection iteration order is unspecified: sort the returned records explicitly when the UI needs a meaningful order. Show when a collection is truncated; never describe a truncated list as all records.
Before returning, trace each primary user action through its circuit to the persistent record it changes, and trace the corresponding UI back to readLedger. Every claimed feature must have that implementation or an explicit limitation.`;
}
