/**
 * THE NAME COMES FIRST — the rules for the reshaped onboarding, and only the
 * rules.
 *
 * WHAT CHANGED, AND WHY
 * ---------------------
 * Until 2026/09/22 a Passport on the account custody contract was made in this
 * order: an offer ("Set up your Passport"), a setup that counted three steps, a
 * separate screen asking for a `.night` name, and a second press that claimed
 * it. Two presses, two waits, and a screen in the middle whose only job was to
 * say the Passport was ready before it had the one thing a reader came for.
 *
 * The order asked for is the one the passkey road already had: say what a
 * Passport IS, ask for the name, and then do the whole of it on one press —
 * "I want email login or social auth … then same as passkeys I get the page to
 * tell me about passport → Setup my Name / Night Id → I click same create and
 * we confirm with user and run the same onboarding" (2026/09/22).
 *
 * So the name is chosen BEFORE anything is built, which is what makes the rest
 * of this module necessary:
 *
 *   - a chosen name has to be written down before the first transaction leaves,
 *     or a reload halfway through a three-step setup would have to ask for it
 *     again — over an account that already exists;
 *   - a name chosen minutes before it is claimed can be taken by somebody else
 *     in between, and the answer to that is NOT to throw the account away.
 *
 * NO REACT, NO STORAGE HANDLE, NO NETWORK, NO CLOCK. Every decision this flow
 * makes is a pure function here, and `screens/CustodyPassport.tsx` reads the
 * answers rather than computing any of them — the same rule, and for the same
 * reason, as `./custodyScreenRules.ts` and `../identity/custodyContractSession.ts`.
 */

/* -------------------------------------------------------------------------- */
/* Which of the three screens a Passport is on                                */
/* -------------------------------------------------------------------------- */

/** The screen a Passport being made should be looking at. */
export type CustodyNameFirstStage =
  /** The page that says what a Passport is. Nothing has started. */
  | 'welcome'
  /** Choose the name, and make the Passport with it. */
  | 'name'
  /**
   * Named, and offered a way back before the everyday surface opens.
   *
   * ONE SCREEN, ASKED ONCE, and whether it is due at all is decided by
   * `./recoveryStep.ts` rather than here. This module only says where it sits
   * in the order: after the name, because a Passport with no name is not yet a
   * thing anybody could be brought back TO, and before Home, because after
   * Home it is a card competing with a balance.
   */
  | 'recovery'
  /** Made, named, and usable. */
  | 'home';

/** Everything the stage is decided from. */
export interface CustodyNameFirstInput {
  /** Whether a setup record exists at all — that is, whether anything was built. */
  readonly setupStarted: boolean;
  /** Whether every step of the setup has landed and the key is on. */
  readonly setupFinished: boolean;
  /** The `.night` name this Passport has CLAIMED, or null. */
  readonly claimedName: string | null;
  /** The name chosen before the setup started and not yet claimed, or null. */
  readonly chosenName: string | null;
  /** Whether the welcome page has been read and left in this session. */
  readonly welcomeRead: boolean;
  /**
   * Whether the way back is still to be offered. See
   * `./recoveryStep.ts#recoveryStepDue`, which owns every rule about it.
   *
   * Optional, and false when omitted, so every caller that predates the step —
   * and every build with no sign-in behind it — reads exactly as it did.
   */
  readonly recoveryDue?: boolean;
}

/**
 * Which screen to show.
 *
 * READ IN THIS ORDER, and the order is the whole rule.
 *
 * A Passport that is finished AND named is at Home, whatever else is stored —
 * including a leftover chosen name, which a race can leave behind (see
 * {@link custodyNameTakenSentence}).
 *
 * Anything that has STARTED is on the name step, because that is where the rest
 * of it happens: a half-built setup is finished from there, and a built one
 * that has no name yet is claimed from there. Coming back to either must never
 * land on the welcome page — being introduced to a thing you are already
 * halfway through is how an app tells a reader it has forgotten them.
 *
 * A chosen name with no record is the same thing one moment earlier: the name
 * was written down and the first transaction had not left yet. It is treated as
 * started, so a reload in that window does not ask for the name a second time.
 *
 * Only a Passport with nothing behind it at all gets the welcome page, and only
 * until it is read.
 */
export function custodyNameFirstStage(input: CustodyNameFirstInput): CustodyNameFirstStage {
  if (input.setupFinished && input.claimedName !== null) {
    /* THE STEP IS RESUMABLE BECAUSE IT IS DECIDED HERE. Nothing remembers that
       the reader was on it: the answer is recomputed from what is stored on
       every read, so a browser closed on the offer comes back to the offer and
       one that answered it comes back to Home. */
    return input.recoveryDue === true ? 'recovery' : 'home';
  }
  if (input.setupStarted || input.chosenName !== null) return 'name';
  return input.welcomeRead ? 'name' : 'welcome';
}

/* -------------------------------------------------------------------------- */
/* What the one button says                                                   */
/* -------------------------------------------------------------------------- */

/** What the name step's primary control is being asked to do. */
export interface CustodyNameFirstActionInput {
  readonly setupStarted: boolean;
  readonly setupFinished: boolean;
  /** Whether the remaining steps of the setup can never be signed. */
  readonly interrupted: boolean;
}

/**
 * The label on the one primary control.
 *
 * "CREATE MY PASSPORT" IS AN OFFER AND MUST NOT SURVIVE THE OFFER BEING TAKEN.
 * The whole flow is one press, so the first press says what it does; every
 * press after it is somebody coming back to something that exists, and telling
 * them they are creating a Passport would be an offer to make a second one.
 *
 * A setup that cannot be finished offers the only thing that works — a fresh
 * one — for the reason `custodyContractSession.ts` gives at `dynamicSetupAction`:
 * the key that signs its remaining steps is gone, so "finish" would fail every
 * time it was pressed.
 */
export function custodyNameFirstAction(input: CustodyNameFirstActionInput): string {
  if (input.interrupted) return 'Start again';
  if (input.setupFinished) return 'Claim my name';
  if (input.setupStarted) return 'Finish setting up my Passport';
  return 'Create my Passport';
}

/**
 * Whether the primary control may be pressed.
 *
 * A NAME THAT IS NOT KNOWN TO BE FREE IS NOT A NAME THIS PRESS CAN USE. The
 * press builds a Passport and claims the name on the same run, so pressing it
 * over a name the registry has not answered for — or has answered "taken" about
 * — buys a three-step setup and then a refusal. "Checking…" is not yes.
 *
 * An unreachable answer is also not yes, and deliberately: the old road could
 * queue a name it had not checked, because there the account already existed.
 * Here the name IS the creation, so there is nothing honest to queue.
 */
export function custodyNameFirstEnabled(input: {
  readonly busy: boolean;
  readonly available: boolean;
}): boolean {
  return !input.busy && input.available;
}

/* -------------------------------------------------------------------------- */
/* The sentences under the field                                              */
/* -------------------------------------------------------------------------- */

/**
 * The line a free name gets.
 *
 * Word for word the one `screens/AliasClaim.tsx` has shown since 2026/08/25, so
 * the two roads say the same thing about the same fact. No price and no
 * balance: the name is registered and paid for on the reader's behalf, and
 * their holdings are not part of this screen.
 */
export function custodyNameAvailableSentence(domain: string): string {
  return `${domain} is available`;
}

/**
 * The line a taken name gets, on the field AND after a race.
 *
 * Also word for word `AliasClaim.tsx`'s, and for the same reason it is worded
 * that way there: what a person typing a name can act on is that this one is
 * gone. Nothing about who holds it, and nothing about where it points.
 */
export function custodyNameTakenSentence(domain: string, networkLabel: string): string {
  return `${domain} is already taken on ${networkLabel}. Try another name.`;
}

/** The line while the registry is being asked. */
export const CUSTODY_NAME_CHECKING_SENTENCE = 'Checking that name…';

/** The line before anything is typed. */
export function custodyNameEmptySentence(networkLabel: string): string {
  return `Type a name to see whether it is free on ${networkLabel}.`;
}

/** The line when the question could not be put at all. */
export const CUSTODY_NAME_UNREACHABLE_SENTENCE =
  'Names cannot be checked right now. Try again in a moment.';

/* -------------------------------------------------------------------------- */
/* Somebody else got there first                                              */
/* -------------------------------------------------------------------------- */

/**
 * Whether a refusal means the name was taken between the choosing and the
 * claim.
 *
 * WHY THIS IS A READING AND NOT A `catch`. The claim can fail for a dozen
 * reasons and exactly one of them leaves the reader with something to do about
 * it: pick another name. Every other failure is ours or the service's, and
 * telling somebody their name is gone when it is not would send them off to
 * abandon a name that is still free.
 *
 * The service's own code is the signal (`name-taken`, raised by
 * `identity/sponsoredAlias.ts`); the message match behind it covers a refusal
 * that arrived as a plain Error from the pre-claim re-read.
 */
export function custodyNameWasTaken(cause: unknown): boolean {
  if (cause === null || typeof cause !== 'object') return false;
  const code = (cause as { code?: unknown }).code;
  if (code === 'name-taken') return true;
  const message = cause instanceof Error ? cause.message.toLowerCase() : '';
  return message.includes('already taken');
}

/** What a Passport keeps, and gives up, when the name it chose was taken. */
export interface CustodyNameRaceOutcome {
  /**
   * ALWAYS TRUE. The account is built, activated, and the reader's; the name is
   * the only thing that went. Throwing it away over a name would cost them a
   * three-step setup and buy nothing.
   */
  readonly keepAccount: true;
  /** The chosen name is forgotten, so the next open asks rather than retries. */
  readonly forgetChosenName: true;
  /** What to put on the name step. */
  readonly sentence: string;
  /** The screen they land on, which is the one that can fix it. */
  readonly stage: 'name';
}

/**
 * What to do when the name was taken in the meantime.
 *
 * Written as a value rather than as three statements at the call site because
 * the interesting half is what it does NOT do, and a reader of the screen
 * should be able to see that without reconstructing it from a `catch` block.
 */
export function custodyNameRaceOutcome(
  domain: string,
  networkLabel: string,
): CustodyNameRaceOutcome {
  return {
    keepAccount: true,
    forgetChosenName: true,
    sentence: custodyNameTakenSentence(domain, networkLabel),
    stage: 'name',
  };
}
