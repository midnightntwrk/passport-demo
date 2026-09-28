import type { Passport, PassportProfileResult } from '@midnight-passport/connect';

/** What the page shows after one "Continue with Passport" press. */
export type SignInView =
  | {
      readonly kind: 'signed-in';
      /** The user's `.night` name as Passport shared it, or null if they did not share it. */
      readonly name: string | null;
      /** The account a `.night` name resolves to: the user's identity. Null if not shared. */
      readonly account: { readonly address: string; readonly network: string } | null;
      /** Fields asked for and not shared. Partial consent is still a sign-in. */
      readonly withheld: readonly string[];
      readonly message: string;
    }
  | {
      /** Passport answered no (or could not answer). Show `message`; do not retry on your own. */
      readonly kind: 'refused';
      readonly code: string;
      readonly message: string;
    }
  | {
      /** Nothing reached Passport, or the answer never came back. Nothing was shared. */
      readonly kind: 'not-sent';
      readonly code: string;
      readonly message: string;
      /** True when the user may have acted in Passport and this page cannot know. */
      readonly checkPassport: boolean;
    };

/** Turns a profile result into what the page renders. Pure, so it is testable without a browser. */
export function toSignInView(result: PassportProfileResult): SignInView {
  if (result.approved) {
    return {
      kind: 'signed-in',
      name: displayNightName(result.profile.displayName),
      account: result.profile.passportContract ?? null,
      withheld: result.withheld,
      message: result.message,
    };
  }
  if (result.source === 'passport') {
    return { kind: 'refused', code: result.error, message: result.message };
  }
  return {
    kind: 'not-sent',
    code: result.error,
    message: result.message,
    checkPassport: result.error === 'timed-out',
  };
}

/**
 * The name as a person reads it. Passport shares the registered name; this adds
 * the `.night` suffix only when it is not already there, and never invents one.
 */
export function displayNightName(displayName: string | undefined): string | null {
  const name = displayName?.trim();
  if (!name) return null;
  return name.endsWith('.night') ? name : `${name}.night`;
}

/**
 * One sign-in. Call it from a click handler: outside Passport's own app browser
 * this opens a pop-up, and browsers only allow that during a user gesture.
 */
export async function signIn(passport: Passport): Promise<SignInView> {
  const result = await passport.requestProfile(['displayName', 'passportContract']);
  return toSignInView(result);
}
