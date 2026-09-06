/**
 * What this browser remembers about a device PAIRING — one Passport, two
 * devices, each holding its own passkey — and the reload anchor for a join
 * that is still in flight.
 *
 * Both stores follow the discipline of `./recoveryKey.ts` next door: the
 * LEDGER is the authority on which devices an account admits, and everything
 * here is display state — a label this device keeps so its guard meter and
 * its Keys page can tell the story without a chain read. Losing either record
 * costs a sentence, never a key.
 *
 * Keys sit under the `mn-passport:` prefix so the forget-this-device sweep
 * (App.tsx) forgets them by default, like every other Passport record.
 */

/**
 * One device pairing, from THIS device's side of it.
 *
 * `joined` — this device was the new one: it drew the join code, another
 * device admitted it, and the poll saw its own commitment go live on the
 * account. `admitted` — this device was the enrolled one: it scanned (or was
 * pasted) a join code and called `add_device` itself.
 *
 * Either way the fact recorded is the same and is what the guard ladder's
 * third rung reads: a key that is NOT on this device can open this Passport.
 */
export interface SecondDeviceRecord {
  role: 'joined' | 'admitted';
  network: string;
  contractAddress: string;
  /**
   * The OTHER key's commitment where this device saw it: the admitted
   * device's on an `admitted` record. Absent on a `joined` record — the
   * admitting device's commitment was never in the handoff, and inventing
   * one would be exactly the kind of plausible lie these stores refuse.
   */
  otherCommitmentHex?: string;
  at: string;
}

const PAIR_STORAGE_PREFIX = 'mn-passport:second-device:';

export function loadSecondDeviceRecord(credentialId: string): SecondDeviceRecord | null {
  try {
    const raw = window.localStorage.getItem(`${PAIR_STORAGE_PREFIX}${credentialId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SecondDeviceRecord;
    return (parsed?.role === 'joined' || parsed?.role === 'admitted') &&
      typeof parsed?.contractAddress === 'string'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function saveSecondDeviceRecord(credentialId: string, record: SecondDeviceRecord): void {
  try {
    window.localStorage.setItem(`${PAIR_STORAGE_PREFIX}${credentialId}`, JSON.stringify(record));
  } catch {
    // Best-effort: the ledger still holds both devices; only the label is lost.
  }
}

/**
 * A join THIS credential has started and not finished — the anchor that lets
 * a reload land back on the join screen instead of on "choose a name".
 *
 * Written twice, growing: at the fork (an empty intent — enough to route),
 * and again when the join code exists, carrying everything needed to resume
 * at the show-the-code stage without re-asking. All of it is PUBLIC data:
 * the name, the account it resolved to, and the commitment the code already
 * displays to anyone looking at the screen.
 *
 * Cleared when the join lands, and by the "start fresh instead" exit. It
 * deliberately does NOT survive a forget-this-device sweep (the prefix takes
 * care of that), and it does survive a sign-out — the same passkey resuming
 * the same half-made join is the same person mid-errand.
 */
export interface JoinIntent {
  /** Present from the moment a name resolved. */
  domain?: string;
  accountAddress?: string;
  /** The registry leaf the name resolved through, where the lookup kept it. */
  resolverAddress?: string;
  /** Present once the join code exists — the resume-at-show state. */
  commitmentHex?: string;
  payload?: string;
}

const JOIN_INTENT_PREFIX = 'mn-passport:join-intent:';

export function loadJoinIntent(credentialId: string): JoinIntent | null {
  try {
    const raw = window.localStorage.getItem(`${JOIN_INTENT_PREFIX}${credentialId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as JoinIntent) : null;
  } catch {
    return null;
  }
}

export function saveJoinIntent(credentialId: string, intent: JoinIntent): void {
  try {
    window.localStorage.setItem(`${JOIN_INTENT_PREFIX}${credentialId}`, JSON.stringify(intent));
  } catch {
    // Best-effort: a reload mid-join then re-asks for the name, which is
    // an inconvenience rather than a loss.
  }
}

export function clearJoinIntent(credentialId: string): void {
  try {
    window.localStorage.removeItem(`${JOIN_INTENT_PREFIX}${credentialId}`);
  } catch {
    // Ignored: the stale intent re-raises the join screen once, which the
    // "start fresh instead" exit resolves.
  }
}
