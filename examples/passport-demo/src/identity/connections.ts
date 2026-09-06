/**
 * The connections a Passport has approved — the Access tab's tenants.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT YET. The long-run shape is the C10 grant:
 * a scope the ACCOUNT CONTRACT enforces, so revoked means revoked whatever
 * the app's manners. Those primitives do not exist on chain yet, so this
 * store is their local stand-in, deliberately shaped like them — every scope
 * is the C10 triple (operation × object × bound), and the lifecycle fields
 * (connected, last used, uses) are the C11 surface. The Access screen renders
 * THIS interface so the screen is the specification the primitives will be
 * built against, and swapping the store for the contract changes no surface.
 *
 * WHAT WRITES IT: real approvals and nothing else. The three consent flows —
 * the popup profile bridge, the URL-callback bridge, and the transaction
 * bridge — call {@link recordConnection} at the moment a user approves, with
 * the origin the reply really went to. Nothing here invents a tenant, which
 * is why a fresh Passport's Access tab still says "Nothing may act for you
 * yet" and means it.
 *
 * WHAT THE BOUND SAYS TODAY: 'asks every time'. That is the truth — every
 * consent flow re-asks per request, and no standing cap exists to enforce —
 * and it is a legal C10 bound, so the day a real cap ('≤ 100 / day') can be
 * granted, only the string changes. A bound this store cannot enforce is
 * never written.
 *
 * Keyed per credential under the `mn-passport:` prefix, like every Passport
 * record: a second passkey in the same browser never reads the first one's
 * connections, and the forget-this-device sweep forgets them by default.
 */

/** One permission line, in the C10 vocabulary: operation × object × bound. */
export interface ConnectionScope {
  operation: string;
  object: string;
  bound: string;
}

export interface ConnectionRecord {
  /** The origin the approval's reply was sent to — the connection's identity. */
  origin: string;
  /** What the card calls it: the origin's host, until apps carry names. */
  name: string;
  /**
   * 'app' today. 'agent' is in the vocabulary because the surface must be
   * able to say it (the AGENT tag) the day the agent slice writes one — no
   * flow marks an agent yet, and none is invented.
   */
  kind: 'app' | 'agent';
  scopes: ConnectionScope[];
  connectedAt: string;
  lastUsedAt: string;
  /** How many approvals this connection has carried, this one included. */
  uses: number;
  /**
   * ISO-8601, absent everywhere today: nothing real grants an expiry, so
   * nothing may write one. In the vocabulary for the C11 surface's sake.
   */
  expiresAt?: string;
}

const STORAGE_PREFIX = 'mn-passport:connections:';

/** Null-prototype map, for the same `__proto__` reason as `aliasStore.ts`. */
function emptyMap(): Record<string, ConnectionRecord> {
  return Object.create(null) as Record<string, ConnectionRecord>;
}

function readAll(credentialId: string): Record<string, ConnectionRecord> {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${credentialId}`);
    if (!raw) return emptyMap();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return emptyMap();
    const records = emptyMap();
    for (const [origin, value] of Object.entries(parsed as Record<string, unknown>)) {
      const record = value as ConnectionRecord;
      if (
        record &&
        typeof record.origin === 'string' &&
        (record.kind === 'app' || record.kind === 'agent') &&
        Array.isArray(record.scopes)
      ) {
        records[origin] = record;
      }
    }
    return records;
  } catch {
    // Storage denied or corrupt: the Passport simply remembers no tenants.
    return emptyMap();
  }
}

function writeAll(credentialId: string, records: Record<string, ConnectionRecord>): void {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${credentialId}`, JSON.stringify(records));
  } catch {
    // Best-effort: the approval still happened; only the memory of it is lost.
  }
  publish(credentialId);
}

/** The connections this credential has approved, most recently used first. */
export function loadConnections(credentialId: string): ConnectionRecord[] {
  return Object.values(readAll(credentialId)).sort((a, b) =>
    b.lastUsedAt.localeCompare(a.lastUsedAt),
  );
}

/** What a consent flow reports at the moment of approval. */
export interface ConnectionApproval {
  origin: string;
  scopes: ConnectionScope[];
}

/**
 * The scope line an approved PROFILE share earns, built from the fields that
 * really left — never from the fields the app asked for. One builder shared
 * by both profile bridges (popup and callback), so the same act earns the
 * same line and the Access card never says two things about one vocabulary.
 */
export function profileShareScope(sharedFields: readonly string[]): ConnectionScope {
  const parts = sharedFields.map((field) =>
    field === 'displayName'
      ? 'your name'
      : field === 'passportContract'
        ? 'your account'
        : field === 'midnightAddresses'
          ? 'your technical addresses'
          : field,
  );
  return {
    operation: 'authenticate',
    object: parts.length > 0 ? `sees ${parts.join(', ')}` : 'sees nothing',
    bound: 'asks every time',
  };
}

/** Host of an origin, for the card's name — the origin itself when unparsable. */
function hostOf(origin: string): string {
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin;
  }
}

/**
 * Records one real approval: a new connection, or another use of an existing
 * one. Scopes MERGE rather than replace — an app that authenticated last week
 * and paid today holds both lines — deduplicated on the whole triple, so
 * re-approving the same act never grows the list.
 */
export function recordConnection(credentialId: string, approval: ConnectionApproval): void {
  const records = readAll(credentialId);
  const now = new Date().toISOString();
  const existing = Object.hasOwn(records, approval.origin) ? records[approval.origin] : undefined;
  const scopes = existing ? [...existing.scopes] : [];
  for (const scope of approval.scopes) {
    const held = scopes.some(
      (candidate) =>
        candidate.operation === scope.operation &&
        candidate.object === scope.object &&
        candidate.bound === scope.bound,
    );
    if (!held) scopes.push(scope);
  }
  records[approval.origin] = {
    origin: approval.origin,
    name: hostOf(approval.origin),
    kind: existing?.kind ?? 'app',
    scopes,
    connectedAt: existing?.connectedAt ?? now,
    lastUsedAt: now,
    uses: (existing?.uses ?? 0) + 1,
    ...(existing?.expiresAt ? { expiresAt: existing.expiresAt } : {}),
  };
  writeAll(credentialId, records);
}

/**
 * Removes a connection. What that MEANS today is exactly what it does: the
 * record is gone, and the app is a stranger again — its next request raises
 * the same consent sheet a stranger's would, because every flow still asks
 * every time. The stronger promise ('revoked means revoked, enforced by the
 * contract') is the C10 grant's to keep, and the Access screen says whose.
 */
export function revokeConnection(credentialId: string, origin: string): void {
  const records = readAll(credentialId);
  if (!Object.hasOwn(records, origin)) return;
  delete records[origin];
  writeAll(credentialId, records);
}

/* One listener set per credential would be over-engineering for a store one
   component reads: listeners get the credential they subscribed for. */
const listeners = new Set<{ credentialId: string; notify: (records: ConnectionRecord[]) => void }>();

function publish(credentialId: string): void {
  for (const listener of listeners) {
    if (listener.credentialId === credentialId) listener.notify(loadConnections(credentialId));
  }
}

export function subscribeConnections(
  credentialId: string,
  notify: (records: ConnectionRecord[]) => void,
): () => void {
  const entry = { credentialId, notify };
  listeners.add(entry);
  return () => {
    listeners.delete(entry);
  };
}
