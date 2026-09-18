/**
 * A PASSPORT HELD BY A SOCIAL SIGN-IN — the rules, and only the rules.
 *
 * WHAT THIS IS FOR
 * ----------------
 * Until this module existed there was exactly one way to be inside Passport: a
 * passkey on this device, whose PRF output is the seed behind every key the app
 * holds. `docs/demo/dynamic-build-out-plan.md` §6 sets a second one — sign in
 * with Google, Discord, Microsoft, or X through Dynamic, and let the account
 * contract's k256 arm accept the embedded key as its device. No passkey is made,
 * none is asked for, and the two kinds of Passport coexist and can pay each
 * other.
 *
 * Two ways to be signed in is a thing that can be got wrong quietly, so every
 * decision that chooses between them is written here as a pure function and
 * drilled to the branch. The wiring in `App.tsx` reads these answers; it does
 * not compute any of them.
 *
 * THE RULE THAT PROTECTS EVERY EXISTING PASSPORT
 * ----------------------------------------------
 * A passkey profile ALWAYS wins. {@link choosePassportIdentity} returns
 * `'passkey'` the moment one exists, whatever Dynamic says, so a build with no
 * Dynamic session — which is every build shipped today — takes the same branch
 * it has always taken, and a passkey holder who happens to sign in with Google
 * to look at the identity row does not have their Passport swapped underneath
 * them. The Dynamic path is reachable only from the state where the old path
 * offers nothing at all: no passkey profile, and a signed-in Dynamic session
 * with an embedded address.
 *
 * WHY THE DYNAMIC EVM ADDRESS IS THE USER KEY
 * -------------------------------------------
 * `custodyContractClient.ts` keys its record by the lower-cased embedded address
 * (`k1UserKey`), because one Dynamic user has exactly one embedded key and that
 * key is the same on every device after a social recovery. This module keys the
 * name it has claimed the same way, for the same reason and so an operator
 * clearing one finds the other beside it.
 *
 * NO NETWORK, NO STORAGE HANDLE, NO CLOCK, NO REACT. The storage this module
 * touches is the same injected three-method `CustodyStorage` the custody layer takes,
 * which is why it is in the coverage denominator: every way it can be wrong is a
 * way of showing somebody the wrong Passport.
 */

import {
  custodyRecordKey,
  loadCustodyRecord,
  loadCustodyRecords,
  nextCustodyStep,
  type CustodyAccountRecord,
  type CustodyStorage,
} from './custodyContractPlan.js';
import type { NameRecoveryOutcome, ResolvedName } from '../lib/nameRecovery.js';
import type { PassportIdentityKind } from '../lib/dynamicSession.js';

/* -------------------------------------------------------------------------- */
/* Which Passport the app is showing                                          */
/* -------------------------------------------------------------------------- */

/**
 * The choice itself lives in `src/lib/dynamicSession.ts`, which imports
 * nothing, and is re-exported here so a reader of this module finds it where
 * they expect to. `App.tsx` asks the question on every render and must be able
 * to import it without pulling this module's deploy record and storage format
 * into the entry chunk — 29,701 bytes of it, measured 2026/09/16.
 */
export {
  choosePassportIdentity,
  dynamicUserKey,
  type PassportIdentityInput,
  type PassportIdentityKind,
} from '../lib/dynamicSession.js';

/* -------------------------------------------------------------------------- */
/* Where a Dynamic Passport is in its own flow                                */
/* -------------------------------------------------------------------------- */

/** The screen a Dynamic-only holder should be looking at. */
export type DynamicStage =
  /** Not signed in, or signed in with no embedded key yet. */
  | 'sign-in'
  /** Signed in, nothing set up. "Create my Passport". */
  | 'create'
  /** A setup that started and has not finished. Resumable. */
  | 'resume'
  /** Set up and unnamed. The `.night` name step. */
  | 'name'
  /** Set up and named. Home. */
  | 'home';

/** Everything the stage is decided from. */
export interface DynamicStageInput {
  readonly identity: PassportIdentityKind;
  /** The setup record for this user on this network, or null. */
  readonly record: CustodyAccountRecord | null;
  /** The `.night` name this Passport holds, or null. */
  readonly name: string | null;
}

/**
 * Which step a Dynamic Passport is on.
 *
 * `resume` and `create` are separate because the copy has to be: somebody
 * returning to a half-finished setup is not being offered a Passport, they are
 * being told the one they started is still being made. A single "Create my
 * Passport" over a record with an address would read as an offer to make a
 * second one.
 *
 * A name is NOT a precondition for Home once the account is usable — a holder
 * who closes the tab on the name step comes back to a working Passport and is
 * asked again from Home, rather than being held at a screen they already
 * skipped. That differs from the passkey flow, where the account is set up
 * THROUGH the claim; here the account is already there.
 */
export function dynamicStage(input: DynamicStageInput): DynamicStage {
  if (input.identity !== 'dynamic') return 'sign-in';
  if (input.record === null) return 'create';
  if (nextCustodyStep(input.record) !== 'ready') {
    return input.record.address === null ? 'create' : 'resume';
  }
  return input.name === null ? 'name' : 'home';
}

/* -------------------------------------------------------------------------- */
/* What the setup says while it runs                                          */
/* -------------------------------------------------------------------------- */

/** The three things a person is told while a Passport is being made. */
export type DynamicSetupPhase = 'create' | 'finish' | 'activate' | 'done';

/** How many steps the copy counts. See {@link dynamicSetupPhase}. */
export const DYNAMIC_SETUP_STEPS = 3;

/**
 * Which of the three visible steps a record is on.
 *
 * THREE STEPS, AND NOT FOUR, AND THE DIFFERENCE IS DELIBERATE. Making one of
 * these Passports is four transactions — a deploy carrying the whole k256 arm,
 * two maintenance updates carrying the other twenty verifier keys
 * (`planCustodyWaves`), and the activation that opens the boot commitment. The
 * middle two are one thing to the person waiting: the roster going in. Counting
 * them separately would put a number on screen that changes meaning if the
 * verifier-key budget ever repacks the waves, and "step 3 of 4" would then
 * become "step 3 of 5" for a reason nobody outside this repository could
 * possibly follow.
 *
 * So the count is of what a person is waiting FOR, and it is stable: set the
 * Passport up, finish it, turn the sign-in on.
 */
export function dynamicSetupPhase(record: CustodyAccountRecord | null): DynamicSetupPhase {
  if (record === null) return 'create';
  const step = nextCustodyStep(record);
  /* A setup that cannot be finished is back at the beginning, because the only
     thing that can be done about it is to start a fresh one. It is emphatically
     not `done`, which is what it would fall through to. */
  if (step === 'interrupted') return 'create';
  if (step === 'deploy') return 'create';
  if (step === 'waves') return 'finish';
  if (step === 'activate') return 'activate';
  return 'done';
}

/** The step number a phase is, 1-based. `done` is past the last one. */
export function dynamicSetupStep(phase: DynamicSetupPhase): number {
  if (phase === 'create') return 1;
  if (phase === 'finish') return 2;
  if (phase === 'activate') return 3;
  return DYNAMIC_SETUP_STEPS;
}

/**
 * The sentence under the spinner.
 *
 * NONE OF THE FORBIDDEN WORDS. No contract, no wallet address, no sponsor, no
 * registry, no fee token — the same rule `CustodyMilestone.tsx` keeps, and the
 * reason is the same: these sentences are read by people who are not us.
 */
export function dynamicSetupCopy(phase: DynamicSetupPhase): string {
  if (phase === 'done') return 'Your Passport is ready.';
  return `Setting up your Passport, step ${dynamicSetupStep(phase)} of ${DYNAMIC_SETUP_STEPS}`;
}

/**
 * What the control under it says.
 *
 * A setup that has not started is an OFFER and says so; one that has is a
 * continuation, and the word "create" must not appear on it.
 */
export function dynamicSetupAction(record: CustodyAccountRecord | null): string {
  if (record === null || record.address === null) return 'Create my Passport';
  /* A setup that cannot be finished must not offer to finish it: the key that
     signs the remaining steps is gone, so that button would fail every time it
     was pressed. The honest offer is a fresh Passport. */
  if (record.interrupted === true) return 'Start again';
  return 'Finish setting up my Passport';
}

/**
 * Whether the setup in a stored record can no longer be finished.
 *
 * A SCREEN MUST NOT LEARN THIS BY FAILING. Both screens that set a Dynamic
 * Passport up kept the answer in a piece of React state that began life as
 * `false` and was only ever set by a refusal thrown at them mid-press. That
 * state does not survive a reload, and the record does: somebody who closed the
 * tab on an interrupted setup came back to a button offering to create a
 * Passport, pressed it, and got `CUSTODY_SETUP_INTERRUPTED` for their trouble —
 * being told by a failure what the record had known all along. The screens read
 * it from the record now, on load and on every refresh, so the only offer they
 * make is the one that works.
 */
export function dynamicSetupInterrupted(record: CustodyAccountRecord | null): boolean {
  return record !== null && nextCustodyStep(record) === 'interrupted';
}

/**
 * The same question for a screen that has no network to hand.
 *
 * `CustodyMilestone.tsx` is the developer surface, and it talks to the custody layer
 * without ever asking which network the wallet settled on — the record is keyed
 * by user AND network, so it cannot name the one record it means. Every record
 * this sign-in has, on whichever network, is asked instead: a milestone screen
 * offering to start again where any of them was interrupted is right about the
 * one it is pointed at, and a reader with two half-built Passports on two
 * networks is being told something true about both.
 */
export function dynamicSetupInterruptedAnywhere(
  storage: CustodyStorage,
  user: string | null,
): boolean {
  if (user === null || user === '') return false;
  /* `custodyRecordKey(user, '')` is the user's own prefix, built by the one function
     that knows the separator rather than by a template string here. */
  const prefix = custodyRecordKey(user, '');
  return Object.entries(loadCustodyRecords(storage)).some(
    ([key, record]) => key.startsWith(prefix) && dynamicSetupInterrupted(record),
  );
}

/* -------------------------------------------------------------------------- */
/* The `.night` name this Passport holds                                      */
/* -------------------------------------------------------------------------- */

/**
 * `passport-account-custody-name:v1` — the name a Dynamic Passport has claimed, per user and
 * network.
 *
 * Its own key rather than a field on `CustodyAccountRecord` because that record
 * belongs to `custodyContractClient.ts` and is written by the deploy; a name is
 * claimed long after the last wave, by a different flow, and a reader merging
 * into somebody else's record is how two writers lose each other's fields.
 * Same versioned-key convention as `passport-contract:v1` and
 * `passport-account-custody:v1`.
 */
export const CUSTODY_NAME_KEY = 'passport-account-custody-name:v1';

/** The map key, matching `custodyRecordKey`. */
export function custodyNameKey(user: string, network: string): string {
  return `${user.toLowerCase()}|${network}`;
}

/**
 * Every name held, or an empty map.
 *
 * A storage that throws — private browsing, a browser set to block site data —
 * reads as empty, exactly as the record store does. The cost is being asked to
 * choose a name again; the cost of throwing is a Passport that will not open.
 */
export function loadCustodyNames(storage: CustodyStorage): Record<string, string> {
  let raw: string | null = null;
  try {
    raw = storage.getItem(CUSTODY_NAME_KEY);
  } catch {
    return {};
  }
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const names: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.length > 0) names[key] = value;
    }
    return names;
  } catch {
    return {};
  }
}

/** The name this user holds on this network, or null. */
export function loadCustodyName(storage: CustodyStorage, user: string, network: string): string | null {
  return loadCustodyNames(storage)[custodyNameKey(user, network)] ?? null;
}

/** Remember a claimed name, merged into whatever else is stored. */
export function saveCustodyName(
  storage: CustodyStorage,
  user: string,
  network: string,
  name: string,
): void {
  const names = loadCustodyNames(storage);
  names[custodyNameKey(user, network)] = name;
  try {
    storage.setItem(CUSTODY_NAME_KEY, JSON.stringify(names));
  } catch (cause) {
    console.warn('[account-custody] could not remember this name; it will be asked for again', cause);
  }
}

/* -------------------------------------------------------------------------- */
/* Which Passport a PASSKEY on this device holds                              */
/* -------------------------------------------------------------------------- */

/**
 * `passport-account-custody-passkey:v1` — the pointer from a passkey CREDENTIAL
 * to the account custody Passport it made, per credential and network.
 *
 * WHY A POINTER EXISTS AT ALL, when the account's own record is already stored.
 * Every custody store — the record, the wallet seed, the viewing-key slot, the
 * coin store, the name — is keyed by {@link custodyUserKey}, which for a passkey
 * is the DEVICE POINT: `jubjub:<pk.x>`. That is the right key, because it is
 * derived from the passkey and so is the same value on every device the passkey
 * syncs to, and because it is the same point the account's own device set holds
 * on chain, so a record found under it can be checked against the chain rather
 * than merely believed.
 *
 * But it is not FREE. Reaching it costs a user-verified WebAuthn assertion and
 * a derivation, and a routing decision made on every open cannot cost a
 * fingerprint. The credential id costs nothing — the sign-in already has it —
 * so it is what the app asks on open, and the answer it gets back is the device
 * point it may then read everything else with.
 *
 * SO THIS IS A ROUTE AND NOT A RECORD. It says which screen to open, never what
 * the account is; nothing is decided from it beyond that. A pointer that is
 * missing on a new device is exactly right: a passkey arriving somewhere new
 * with no pointer recovers by name, which derives the root with one assertion
 * and finds the account on chain, and writes the pointer on the way through.
 */
export const CUSTODY_PASSKEY_KEY = 'passport-account-custody-passkey:v1';

/** The map key. Credential ids are case-sensitive base64url, so they are not lowered. */
export function custodyPasskeyKey(credentialId: string, network: string): string {
  return `${credentialId}|${network}`;
}

/** Every pointer stored, or an empty map. A storage that throws reads as empty. */
export function loadCustodyPasskeyPointers(storage: CustodyStorage): Record<string, string> {
  let raw: string | null = null;
  try {
    raw = storage.getItem(CUSTODY_PASSKEY_KEY);
  } catch {
    return {};
  }
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const pointers: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.length > 0) pointers[key] = value;
    }
    return pointers;
  } catch {
    return {};
  }
}

/**
 * The user key this credential's Passport is filed under on this network, or
 * null.
 *
 * Null is "this app has not seen a Passport for this passkey here", which is
 * both "there is not one" and "there is one and this browser has never opened
 * it". The two are the same question to a router, and the second is answered
 * by recovery rather than by a longer read.
 */
export function loadCustodyPasskeyPointer(
  storage: CustodyStorage,
  credentialId: string,
  network: string,
): string | null {
  return loadCustodyPasskeyPointers(storage)[custodyPasskeyKey(credentialId, network)] ?? null;
}

/** Remember which Passport this passkey holds, merged into whatever else is stored. */
export function saveCustodyPasskeyPointer(
  storage: CustodyStorage,
  credentialId: string,
  network: string,
  user: string,
): void {
  const pointers = loadCustodyPasskeyPointers(storage);
  pointers[custodyPasskeyKey(credentialId, network)] = user;
  try {
    storage.setItem(CUSTODY_PASSKEY_KEY, JSON.stringify(pointers));
  } catch (cause) {
    console.warn(
      '[account-custody] could not remember which Passport this passkey holds',
      cause,
    );
  }
}

/**
 * Which flow a PASSKEY sign-in belongs in, decided without asking for a
 * ceremony.
 *
 *   `legacy`  — this credential already has a prototype account on this
 *               network. Everything about it stays exactly as it is: the
 *               eleven- and twelve-circuit Passports in production are not
 *               migrated (Hector, 2026/09/18), and this app has one flow for
 *               them, which is the one it has always had.
 *   `custody` — this credential has an account custody Passport here. Open it.
 *   `new`     — neither. A Passport made from here is made on the account
 *               custody contract.
 *
 * THE PROTOTYPE RECORD WINS OVER THE POINTER, and the order matters rather than
 * being arbitrary: a holder who has a working Passport must never be routed
 * anywhere but to it, whatever else a store has accumulated. The reverse
 * ordering would take somebody's money off their screen on the strength of a
 * pointer written by a setup that failed.
 */
export type PasskeyPassportRoute = 'legacy' | 'custody' | 'new';

export function passkeyPassportRoute(input: {
  /** Whether a prototype account contract is recorded for this credential here. */
  readonly hasPrototypeAccount: boolean;
  /** The account custody pointer for this credential here, or null. */
  readonly custodyUser: string | null;
}): PasskeyPassportRoute {
  if (input.hasPrototypeAccount) return 'legacy';
  return input.custodyUser === null ? 'new' : 'custody';
}

/* -------------------------------------------------------------------------- */
/* Reading a whole Dynamic session out of storage                             */
/* -------------------------------------------------------------------------- */

/** Everything the host needs to render a Dynamic-only Passport. */
export interface DynamicPassportView {
  readonly user: string;
  readonly network: string;
  readonly record: CustodyAccountRecord | null;
  readonly name: string | null;
  readonly address: string | null;
  readonly stage: DynamicStage;
}

/**
 * The whole view, from storage, in one read.
 *
 * One function so `App.tsx` cannot assemble half of it: the stage depends on
 * both the record and the name, and a host that read one of them from a stale
 * render would show the name step over a Passport that already has a name.
 */
export function readDynamicPassport(options: {
  storage: CustodyStorage;
  user: string;
  network: string;
}): DynamicPassportView {
  const user = options.user.toLowerCase();
  const record = loadCustodyRecord(options.storage, user, options.network);
  const name = loadCustodyName(options.storage, user, options.network);
  return {
    user,
    network: options.network,
    record,
    name,
    address: record?.address ?? null,
    stage: dynamicStage({ identity: 'dynamic', record, name }),
  };
}

/* -------------------------------------------------------------------------- */
/* Coming back on a new device, by name                                       */
/* -------------------------------------------------------------------------- */

/**
 * The circuit that says a deployed account is an account custody build.
 *
 * The same discriminator `accountBuildFromOperations` uses, and for the same
 * reason: the answer is the DEPLOYED CIRCUIT SET read off the chain, never a
 * local record. Neither prototype build carries this name — they spell the
 * unshielded deposit `deposit_night`.
 *
 * ARM-AGNOSTIC, AND IT HAD TO BECOME SO. This was `withdraw_shielded_with_k256`
 * until 2026/09/18, which is a name a JUBJUB-born account does not carry until
 * its third wave — so a passkey Passport recovered by name mid-setup answered
 * `not-yours` about its own account. `deposit_unshielded` is in wave 1 of both
 * arms' plans, so it is true of an account custody account from its first
 * transaction onwards.
 *
 * Spelled here rather than imported from `./passportContract.js`: that module
 * reaches the indexer provider and the wallet, and this one is pure by
 * construction. `custodyContractSession.test.ts` holds the two spellings
 * together against the compiled modules' own circuit lists.
 */
export const CUSTODY_MARKER_CIRCUIT = 'deposit_unshielded';

/**
 * Which arm an account custody account was BORN with, from the same list.
 *
 * Not a build question — both arms are the same build — but the one an opener
 * has to answer next: the constructor's boot commitment binds the arm, so an
 * account that carries `activate_initial_device_with_jubjub` can only ever be
 * opened by a passkey, and one that carries the k256 activation only by a
 * social sign-in. Wave 1 carries exactly one of them; the other arrives with
 * the later waves, so ASK ABOUT THE ACTIVATION rather than about any gated
 * circuit, and ask about it in the order that survives a finished deploy.
 *
 * Null means the list is not an account custody account's at all, or is a read
 * that did not complete — never "some other arm".
 */
export function custodyArmFromOperations(
  operations: readonly string[] | null,
): 'jubjub' | 'k256' | null {
  if (operations === null) return null;
  if (!operations.includes(CUSTODY_MARKER_CIRCUIT)) return null;
  const jubjub = operations.includes('activate_initial_device_with_jubjub');
  const k256 = operations.includes('activate_initial_device_with_k256');
  /* A FINISHED account carries both activations, because the roster does; only
     wave 1 tells the arms apart by presence. What tells them apart afterwards
     is the gated circuit the OTHER arm's waves bring — so a list with both
     activations is read by which arm's first wave it looks like, and the
     jubjub-born plan is the one whose wave 1 is the jubjub arm. There is no
     honest answer from a finished roster alone, and the caller that needs one
     holds the device: it asks the device set instead. */
  if (jubjub && !k256) return 'jubjub';
  if (k256 && !jubjub) return 'k256';
  return null;
}

/** What a recovery attempt has managed to find out. */
export interface CustodyRecoveryProbe {
  /**
   * The circuit names the account really carries, or null when the read could
   * not be completed. Null is UNREACHABLE and never "no".
   */
  readonly operations: readonly string[] | null;
  /**
   * Whether the account's device set contains the entry this Dynamic key
   * derives, or null when the read could not be completed.
   *
   * A `boolean | null` rather than a `boolean` for the reason `nameRecovery.ts`
   * gives at length: a question that could not be put must never arrive here
   * dressed as a `false`, because `false` tells a person their Passport is not
   * theirs.
   */
  readonly holdsDevice: boolean | null;
}

/**
 * Whether a resolved name is a Passport this Dynamic sign-in can open.
 *
 * THREE WAYS TO SAY NO, AND THEY ARE NOT THE SAME THING.
 *
 *   - The name resolves to a PASSKEY Passport. That is `not-yours` — it is a
 *     real Passport and a real name, and this sign-in is not part of it. There
 *     is no migration in this version (§6 of the build-out plan), so there is
 *     nothing to offer such a person here beyond the truth.
 *   - The name resolves to a Dynamic Passport whose devices do not include this
 *     key. Also `not-yours`, and deliberately the same answer: telling somebody
 *     WHICH of the two it was would be telling them about an account that is
 *     not theirs.
 *   - A read did not complete. `unreachable`, always, carrying why.
 */
export function custodyRecoveryOutcome(
  resolved: ResolvedName,
  probe: CustodyRecoveryProbe,
): NameRecoveryOutcome {
  if (probe.operations === null) {
    return {
      kind: 'unreachable',
      detail: 'Midnight could not be reached to check that name. Try again in a moment.',
    };
  }
  if (!probe.operations.includes(CUSTODY_MARKER_CIRCUIT)) return { kind: 'not-yours' };
  if (probe.holdsDevice === null) {
    return {
      kind: 'unreachable',
      detail: 'Midnight could not be reached to check that name. Try again in a moment.',
    };
  }
  if (!probe.holdsDevice) return { kind: 'not-yours' };
  return {
    kind: 'found',
    address: resolved.target.hex,
    resolverAddress: resolved.resolverAddress,
  };
}

/**
 * The record a successful recovery writes, so the restored Passport is usable
 * without being deployed again.
 *
 * `wavesDone` is set to `totalWaves` and `activated` to true because both are
 * FACTS ABOUT THE CHAIN that the recovery just established: an account whose
 * device set contains this key has been through every wave and been activated,
 * or the entry could not be in it. Writing anything less would put a finished
 * Passport back on the setup screen.
 *
 * The salt is deliberately empty. It opens the boot commitment, which only
 * activation ever needs, and activation has already happened — inventing one
 * would put a value in storage that is not true of this account.
 */
export function recoveredCustodyRecord(options: {
  user: string;
  network: string;
  address: string;
  privateStateId: string;
  pkXHex: string;
  pkYHex: string;
  totalWaves?: number;
}): CustodyAccountRecord {
  const totalWaves = options.totalWaves ?? 3;
  return {
    user: options.user.toLowerCase(),
    network: options.network,
    address: options.address,
    privateStateId: options.privateStateId,
    saltHex: '',
    pkXHex: options.pkXHex,
    pkYHex: options.pkYHex,
    wavesDone: totalWaves,
    totalWaves,
    activated: true,
    txHashes: [],
  };
}

/**
 * The private-state id a recovered account reads under.
 *
 * The same shape `deployCustodyAccount` composes, so a Passport recovered on a
 * second device and one set up on the first look at the same store rather than
 * at two — which matters the moment the coin store (PR 4) is real.
 */
export function k1PrivateStateId(user: string): string {
  return `passport-account-custody-${user.toLowerCase().slice(2, 10)}`;
}
