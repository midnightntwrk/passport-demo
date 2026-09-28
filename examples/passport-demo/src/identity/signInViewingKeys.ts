/**
 * THE KEY THAT READS A PASSPORT'S PAYMENTS, KEPT WITH ITS WAY BACK (2026/09/26).
 *
 * WHY THIS EXISTS
 * ---------------
 * An account custody Passport learns what shielded coin it was paid from notes
 * in its own inbox, sealed to the account's viewing key (`./custodyInbox.ts`).
 * That key is derived from the passkey that made the Passport, so a Passport
 * brought back on a new device through the sign-in cannot derive it: the
 * recovery points the account at the new device's key (`rotate_enc_key`,
 * `./custodyAdopt.ts`), and every note delivered before that stays sealed to
 * the key on the device that is gone.
 *
 * The answer for the demo (2026/09/26) is the sign-in itself. When a Passport
 * adds the sign-in as its way back, its viewing key is written into that
 * sign-in's user metadata with the provider; when the Passport is brought back
 * through the same sign-in on a new device, the key is read back and kept as an
 * EARLIER key (`./viewingKeys.ts`), and the inbox walk tries it beside the new
 * device's own. No password, no file, and no question on the screen. It
 * replaces the password backup that carried the key for a few hours the same
 * day (#108).
 *
 * WHAT THAT COSTS, STATED PLAINLY
 * -------------------------------
 * A viewing key decrypts notes and authorises nothing — every spend is a device
 * signature the account checks for itself — so whoever holds it can SEE what
 * this Passport is paid and can never move any of it. Kept in the sign-in's
 * metadata it is readable by the sign-in provider, and by anybody holding an
 * admin API key for this environment. That was accepted for the demo. It is not
 * a design a production Passport should ship.
 *
 * THE SHAPE, AND WHY IT IS SMALL
 * ------------------------------
 *
 *     { "passport": { "v": 1, "keys": { "<network>:<account>": ["<hex>", …] } } }
 *
 * Namespaced under `passport`, so nothing else the sign-in keeps is touched,
 * and versioned, so a later shape is left alone rather than written over.
 * Metadata travels in the sign-in's token, and the provider documents its limit
 * inconsistently (2 KB on the React SDK's pages, 512 KB on the admin API's), so
 * this entry is held under {@link SIGN_IN_KEYS_BUDGET_BYTES} — half the smaller
 * — and carries nothing but the keys: no name, no date, no label.
 *
 * A LIST PER ACCOUNT, OLDEST FIRST, because a Passport can come back more than
 * once. The device that comes back puts its own new key after the one it was
 * given, so a third device reads what was paid before the first recovery AND
 * between the two. A key is never taken out: the first one opens the oldest
 * notes and nothing else does. {@link SIGN_IN_KEYS_PER_ACCOUNT} bounds the list.
 *
 * READ, MERGE, WRITE, READ BACK
 * -----------------------------
 * Whether the provider merges an update into what it holds or replaces it is
 * not something its documentation settles, so every write carries the whole of
 * what is to be kept, built on a FRESH read of what the provider holds — never
 * on this browser's copy alone, which another device may have added to since —
 * and keeps every other key, every other account, and every row this build
 * cannot read exactly as it found them. A write counts only when the provider's
 * answer carries every key it was meant to.
 *
 * NEVER A FAILURE OF ANYTHING ELSE. Adding a way back and coming back on a new
 * device both finish whether or not this does: nothing here throws, what did
 * not happen is logged, and the next open tries again.
 *
 * NO REACT AND NO SDK. The sign-in is two calls ({@link SignInMetadata}), read
 * from `../lib/dynamicSession.ts`'s store or handed in, so every rule here is
 * drilled against a map.
 */

import { normalisedColourHex } from '../lib/colour.js';
import { dynamicUserKey, readDynamicActions, readDynamicSession } from '../lib/dynamicSession.js';
import {
  loadEarlierViewingKeys,
  normalisedViewingSecret,
  rememberEarlierViewingKey,
  type ViewingKeyAccount,
  type ViewingKeyStorage,
} from './viewingKeys.js';

/** Where in the sign-in's metadata this app keeps what it keeps. */
export const SIGN_IN_METADATA_KEY = 'passport';

/** The shape's version. Anything else under {@link SIGN_IN_METADATA_KEY} is left alone. */
export const SIGN_IN_KEYS_VERSION = 1;

/**
 * How many keys the sign-in keeps for one account: the one the Passport was
 * made with and one per recovery after it. A real account holds one or two.
 */
export const SIGN_IN_KEYS_PER_ACCOUNT = 4;

/**
 * The most this app's entry may weigh, as JSON, in bytes. Half the smaller of
 * the provider's two documented limits; one account with its four keys is
 * about 360.
 */
export const SIGN_IN_KEYS_BUDGET_BYTES = 1024;

/** How long coming back on a new device waits for the sign-in's answer. */
export const SIGN_IN_KEYS_WAIT_MS = 15_000;

/** What this module asks of the sign-in, and the whole of it. */
export interface SignInMetadata {
  /** Who is signed in: the embedded key's address, lower-cased. */
  readonly user: string;
  /**
   * The signed-in person's metadata. `fresh: false` answers from this
   * browser's copy, which the sign-in itself filled; `fresh: true` asks the
   * provider first.
   */
  read(options: { readonly fresh: boolean }): Promise<unknown>;
  /** Stores `metadata`, whole, and answers with what the provider then holds. */
  write(metadata: Readonly<Record<string, unknown>>): Promise<unknown>;
}

/** What the sign-in holds under {@link SIGN_IN_METADATA_KEY}. */
export type SignInKeysEntry =
  | { readonly kind: 'absent' }
  | { readonly kind: 'v1'; readonly keys: Readonly<Record<string, readonly string[]>> }
  | { readonly kind: 'foreign'; readonly reason: string };

/** What one write would do. */
export type SignInKeysPlan =
  | { readonly kind: 'unchanged' }
  | {
      readonly kind: 'write';
      /** The whole of the metadata to store: what was there, with the keys added. */
      readonly metadata: Record<string, unknown>;
      /** The keys this write adds, oldest first. */
      readonly added: readonly string[];
    }
  | { readonly kind: 'refused'; readonly reason: string };

/** How one keeping went. `restored` is how many keys this device was given back. */
export type SignInKeysOutcome =
  | { readonly kind: 'kept'; readonly restored: number; readonly written: number }
  | { readonly kind: 'refused'; readonly restored: number; readonly reason: string }
  | { readonly kind: 'failed'; readonly restored: number; readonly reason: string };

/** A plain JSON object — not null, not an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The name an account's keys are filed under: `<network>:<account>`, the
 * account as 64 lower-case hex. Null for an account that is not one.
 */
export function signInAccountKey(account: ViewingKeyAccount): string | null {
  if (typeof account.network !== 'string') return null;
  const network = account.network.trim();
  const address = normalisedColourHex(account.address);
  if (network === '' || address === null) return null;
  return `${network}:${address}`;
}

/** Whether a name is one {@link signInAccountKey} would have written. */
function isAccountKey(name: string): boolean {
  const separator = name.lastIndexOf(':');
  if (separator < 1) return false;
  return (
    signInAccountKey({ network: name.slice(0, separator), address: name.slice(separator + 1) }) === name
  );
}

/** The viewing secrets in a row, normalised and deduplicated, in the order held. */
function secretsIn(row: unknown): string[] {
  const kept: string[] = [];
  if (!Array.isArray(row)) return kept;
  for (const value of row) {
    const secret = normalisedViewingSecret(value);
    if (secret !== null && !kept.includes(secret)) kept.push(secret);
  }
  return kept;
}

/**
 * Reads what the sign-in holds for this app.
 *
 * A row under a name this build would not write, and a value that is not a
 * viewing key, are left out of what is READ — and left where they are by any
 * write (see {@link withViewingKeys}).
 */
export function readSignInKeys(metadata: unknown): SignInKeysEntry {
  if (!isRecord(metadata) || !Object.hasOwn(metadata, SIGN_IN_METADATA_KEY)) return { kind: 'absent' };
  const entry = metadata[SIGN_IN_METADATA_KEY];
  if (!isRecord(entry)) {
    return { kind: 'foreign', reason: 'the sign-in keeps something else under this name' };
  }
  if (entry.v !== SIGN_IN_KEYS_VERSION) {
    return { kind: 'foreign', reason: `the sign-in keeps a version this Passport does not write (${String(entry.v)})` };
  }
  if (!isRecord(entry.keys)) {
    return { kind: 'foreign', reason: 'the sign-in keeps this version without its keys' };
  }
  const keys: Record<string, readonly string[]> = Object.create(null) as Record<string, readonly string[]>;
  for (const [name, row] of Object.entries(entry.keys)) {
    if (!isAccountKey(name)) continue;
    const secrets = secretsIn(row);
    if (secrets.length > 0) keys[name] = secrets;
  }
  return { kind: 'v1', keys };
}

/** The keys the sign-in holds for one account, oldest first. */
export function signInKeysFor(metadata: unknown, account: ViewingKeyAccount): string[] {
  const name = signInAccountKey(account);
  const entry = readSignInKeys(metadata);
  if (name === null || entry.kind !== 'v1') return [];
  return [...(entry.keys[name] ?? [])];
}

/**
 * The metadata that keeps `secrets` for `account` — or why not, or that there
 * is nothing to do.
 *
 * MERGED, NEVER REPLACED. Every other key in the metadata, every other account
 * under this app's name, and every key already kept for this account stay as
 * they were; the keys that are new are added after them, in the order given.
 * Idempotent: planned again over its own result, it answers `unchanged`.
 */
export function withViewingKeys(
  metadata: unknown,
  account: ViewingKeyAccount,
  secrets: readonly string[],
): SignInKeysPlan {
  const name = signInAccountKey(account);
  if (name === null) return { kind: 'refused', reason: 'the account is not one this Passport can read' };
  const entry = readSignInKeys(metadata);
  if (entry.kind === 'foreign') return { kind: 'refused', reason: entry.reason };
  const held = entry.kind === 'v1' ? (entry.keys[name] ?? []) : [];
  const added: string[] = [];
  for (const secret of secretsIn(secrets)) {
    if (!held.includes(secret)) added.push(secret);
  }
  if (added.length === 0) return { kind: 'unchanged' };
  if (held.length + added.length > SIGN_IN_KEYS_PER_ACCOUNT) {
    return {
      kind: 'refused',
      reason: `the sign-in already keeps ${held.length} keys for this Passport, and ${SIGN_IN_KEYS_PER_ACCOUNT} is the most it keeps`,
    };
  }
  const base: Record<string, unknown> = isRecord(metadata) ? metadata : {};
  const rawEntry: Record<string, unknown> =
    entry.kind === 'v1' ? (base[SIGN_IN_METADATA_KEY] as Record<string, unknown>) : {};
  const nextEntry = {
    ...rawEntry,
    v: SIGN_IN_KEYS_VERSION,
    keys: { ...(rawEntry.keys as Record<string, unknown> | undefined), [name]: [...held, ...added] },
  };
  const weight = new TextEncoder().encode(JSON.stringify(nextEntry)).length;
  if (weight > SIGN_IN_KEYS_BUDGET_BYTES) {
    return {
      kind: 'refused',
      reason: `the keys would take ${weight} bytes of the sign-in, and ${SIGN_IN_KEYS_BUDGET_BYTES} is the most this Passport uses`,
    };
  }
  return { kind: 'write', metadata: { ...base, [SIGN_IN_METADATA_KEY]: nextEntry }, added };
}

/** The runs in flight, by sign-in and account, so two callers share one. */
const inFlight = new Map<string, Promise<SignInKeysOutcome>>();

/**
 * Brings this device and the sign-in level with each other for one account:
 * every key the sign-in keeps and this device does not hold is kept here as an
 * EARLIER key, and every key this device holds and the sign-in does not keep —
 * its current key, and any earlier one — is added to the sign-in.
 *
 * `current` is the key the account's coin store reads with now, or null where
 * it holds none.
 *
 * Cheap when there is nothing to do: this browser's copy of the metadata is
 * read first, and the provider is asked only when a write is due. Never throws.
 */
export function keepViewingKeysWithSignIn(options: {
  readonly signIn: SignInMetadata;
  readonly storage: ViewingKeyStorage;
  readonly account: ViewingKeyAccount;
  readonly current: string | null;
}): Promise<SignInKeysOutcome> {
  const name = signInAccountKey(options.account);
  if (name === null) {
    return Promise.resolve({
      kind: 'refused',
      restored: 0,
      reason: 'the account is not one this Passport can read',
    });
  }
  const flight = `${options.signIn.user}|${name}`;
  const running = inFlight.get(flight);
  if (running !== undefined) return running;
  const run = keepOnce(options).finally(() => inFlight.delete(flight));
  inFlight.set(flight, run);
  return run;
}

async function keepOnce(options: {
  readonly signIn: SignInMetadata;
  readonly storage: ViewingKeyStorage;
  readonly account: ViewingKeyAccount;
  readonly current: string | null;
}): Promise<SignInKeysOutcome> {
  const { signIn, storage, account, current } = options;
  let restored = 0;
  /* EVERY KEY THE SIGN-IN KEEPS THAT THIS DEVICE DOES NOT, kept as an earlier
     key. The device's own current key is reported as held and not written. */
  const restoreFrom = (metadata: unknown): void => {
    for (const secret of signInKeysFor(metadata, account)) {
      if (rememberEarlierViewingKey(storage, account, secret, current).kind === 'added') restored += 1;
    }
  };
  /* THIS DEVICE'S KEYS, OLDEST FIRST: the earlier ones, then the current one.
     Read after each restore, so a key the sign-in has just given back is not
     offered back to it as new. */
  const ownKeys = (): string[] => [
    ...loadEarlierViewingKeys(storage, account),
    ...(current === null ? [] : [current]),
  ];
  try {
    const local = await signIn.read({ fresh: false });
    restoreFrom(local);
    if (withViewingKeys(local, account, ownKeys()).kind === 'unchanged') {
      return { kind: 'kept', restored, written: 0 };
    }
    /* A WRITE IS BUILT ON WHAT THE PROVIDER HOLDS NOW, not on this browser's
       copy: another device may have added a key since this one last looked. */
    const fresh = await signIn.read({ fresh: true });
    restoreFrom(fresh);
    const plan = withViewingKeys(fresh, account, ownKeys());
    if (plan.kind === 'unchanged') return { kind: 'kept', restored, written: 0 };
    if (plan.kind === 'refused') {
      console.warn(`[account-custody] the key that reads this Passport's payments was not kept with its sign-in: ${plan.reason}`);
      return { kind: 'refused', restored, reason: plan.reason };
    }
    const stored = await signIn.write(plan.metadata);
    /* COUNTED ONLY WHERE IT IS READ BACK: the provider's own answer has to
       carry every key this write was for. */
    const kept = signInKeysFor(stored, account);
    if (!plan.added.every((secret) => kept.includes(secret))) {
      console.warn("[account-custody] the sign-in did not keep the key that reads this Passport's payments; trying again on the next open");
      return { kind: 'failed', restored, reason: 'the sign-in did not keep it' };
    }
    return { kind: 'kept', restored, written: plan.added.length };
  } catch (cause) {
    console.warn(
      "[account-custody] the key that reads this Passport's payments could not be kept with its sign-in; trying again on the next open",
      cause,
    );
    return { kind: 'failed', restored, reason: 'the sign-in did not answer' };
  }
}

/**
 * The sign-in on this page, as {@link SignInMetadata} — or null when there is
 * none: no sign-in in this build, nobody signed in, or somebody other than
 * `expectedUser`, the sign-in the caller knows to be this Passport's way back.
 *
 * The calls reach the store each time they are made rather than holding the
 * ones registered now, because the provider's bridge registers them again
 * whenever the signed-in user changes — which a write itself does.
 */
export function signInFromSession(expectedUser: string): SignInMetadata | null {
  const session = readDynamicSession();
  const user = dynamicUserKey(session.evmAddress);
  if (session.status !== 'signed-in' || user === null || readDynamicActions() === null) return null;
  if (user !== dynamicUserKey(expectedUser)) return null;
  const actions = () => {
    const now = readDynamicActions();
    if (now === null) throw new Error('the sign-in is no longer available');
    return now;
  };
  /* A promise either way, so a withdrawn sign-in is a rejection like any other. */
  return {
    user,
    read: (options) => Promise.resolve().then(() => actions().readMetadata(options)),
    write: (metadata) => Promise.resolve().then(() => actions().writeMetadata(metadata)),
  };
}

/**
 * The key this device's coin store reads the account with now.
 *
 * Imported when asked for, so the adoption that calls
 * {@link restoreViewingKeyFromSignIn} pulls nothing new into its chunk.
 */
async function currentViewingKey(account: ViewingKeyAccount): Promise<string | null> {
  const { loadK1CoinStore } = await import('./k1CoinStore.js');
  return loadK1CoinStore(account).encSecretKeyHex;
}

/**
 * THE LAST STEP OF COMING BACK ON A NEW DEVICE (`./custodyAdopt.ts`): the
 * sign-in that has just approved this device gives back the keys it keeps for
 * this Passport, and this device's own new key goes in beside them for the next
 * one.
 *
 * `signInUser` is the sign-in that found the Passport; only ITS metadata is
 * read. Bounded by {@link SIGN_IN_KEYS_WAIT_MS}, and never throws: a sign-in
 * with nothing kept for this Passport, or one that does not answer, leaves a
 * Passport that works and cannot yet read what it was paid before.
 */
export async function restoreViewingKeyFromSignIn(options: {
  readonly storage: ViewingKeyStorage;
  readonly account: ViewingKeyAccount;
  readonly signInUser: string;
  /** Seams for a drill. */
  readonly signIn?: SignInMetadata | null;
  readonly current?: () => Promise<string | null>;
  readonly waitMs?: number;
}): Promise<SignInKeysOutcome> {
  const signIn = options.signIn === undefined ? signInFromSession(options.signInUser) : options.signIn;
  if (signIn === null) {
    console.warn("[account-custody] no sign-in to read this Passport's earlier payments from");
    return { kind: 'failed', restored: 0, reason: 'nobody is signed in' };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<SignInKeysOutcome>((resolve) => {
    timer = setTimeout(
      () => resolve({ kind: 'failed', restored: 0, reason: 'the sign-in did not answer in time' }),
      options.waitMs ?? SIGN_IN_KEYS_WAIT_MS,
    );
  });
  let outcome: SignInKeysOutcome;
  try {
    const current = await (options.current ?? (() => currentViewingKey(options.account)))();
    outcome = await Promise.race([
      keepViewingKeysWithSignIn({ signIn, storage: options.storage, account: options.account, current }),
      bound,
    ]);
  } catch (cause) {
    console.warn("[account-custody] this Passport's earlier payments could not be read back", cause);
    outcome = { kind: 'failed', restored: 0, reason: 'the coin store could not be read' };
  }
  clearTimeout(timer);
  return outcome;
}
