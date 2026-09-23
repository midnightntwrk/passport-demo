import { describe, expect, it } from 'vitest';

import {
  CUSTODY_NAME_CHECKING_SENTENCE,
  CUSTODY_NAME_UNREACHABLE_SENTENCE,
  custodyNameAvailableSentence,
  custodyNameEmptySentence,
  custodyNameFirstAction,
  custodyNameFirstEnabled,
  custodyNameFirstStage,
  custodyNameRaceOutcome,
  custodyNameTakenSentence,
  custodyNameWasTaken,
  type CustodyNameFirstInput,
} from './custodyNameFirst.js';

/** Nothing at all: a sign-in that has just arrived. */
const FRESH: CustodyNameFirstInput = {
  setupStarted: false,
  setupFinished: false,
  claimedName: null,
  chosenName: null,
  welcomeRead: false,
};

describe('which screen a Passport being made is on', () => {
  it('welcomes somebody with nothing behind them', () => {
    expect(custodyNameFirstStage(FRESH)).toBe('welcome');
  });

  it('moves to the name step once the welcome has been read', () => {
    expect(custodyNameFirstStage({ ...FRESH, welcomeRead: true })).toBe('name');
  });

  it('does not welcome somebody whose name is already written down', () => {
    /* The window between the name being saved and the first transaction
       leaving. A reload in it must not ask for the name again. */
    expect(custodyNameFirstStage({ ...FRESH, chosenName: 'alice' })).toBe('name');
  });

  it('does not welcome somebody with a half-built Passport', () => {
    expect(
      custodyNameFirstStage({ ...FRESH, setupStarted: true, chosenName: 'alice' }),
    ).toBe('name');
  });

  it('keeps a finished but unnamed Passport on the name step', () => {
    expect(
      custodyNameFirstStage({
        ...FRESH,
        setupStarted: true,
        setupFinished: true,
        chosenName: 'alice',
      }),
    ).toBe('name');
  });

  /* 2026/09/22: the name is claimed beside the activation, so the key can be
     on while the name is still being registered. That Passport is at Home,
     with a name card that says so. */
  it('sends a finished Passport Home while its name is still being registered', () => {
    expect(
      custodyNameFirstStage({
        ...FRESH,
        setupStarted: true,
        setupFinished: true,
        chosenName: 'alice',
        nameRegistering: true,
        recoveryDue: true,
      }),
    ).toBe('home');
  });

  it('keeps it on the name step when the claim is not running, and before the key is on', () => {
    const started = { ...FRESH, setupStarted: true, chosenName: 'alice' };
    expect(
      custodyNameFirstStage({ ...started, setupFinished: true, nameRegistering: false }),
    ).toBe('name');
    expect(custodyNameFirstStage({ ...started, nameRegistering: true })).toBe('name');
  });

  it('sends a finished, named Passport Home', () => {
    expect(
      custodyNameFirstStage({
        ...FRESH,
        setupStarted: true,
        setupFinished: true,
        claimedName: 'alice',
      }),
    ).toBe('home');
  });

  it('sends it Home even with a chosen name left over beside it', () => {
    /* A race that was won on the retry leaves both keys written. Home wins. */
    expect(
      custodyNameFirstStage({
        setupStarted: true,
        setupFinished: true,
        claimedName: 'alice',
        chosenName: 'bob',
        welcomeRead: false,
      }),
    ).toBe('home');
  });

  it('does not send an unfinished Passport Home on the strength of a name', () => {
    /* A name recovered on a second device before its account has been read
       back is not a Passport that can be used. */
    expect(
      custodyNameFirstStage({
        setupStarted: true,
        setupFinished: false,
        claimedName: 'alice',
        chosenName: null,
        welcomeRead: true,
      }),
    ).toBe('name');
  });
});

describe('the way back, between the name and Home', () => {
  const NAMED: CustodyNameFirstInput = {
    setupStarted: true,
    setupFinished: true,
    claimedName: 'alice',
    chosenName: null,
    welcomeRead: true,
  };

  it('stops a newly named Passport on the recovery step', () => {
    expect(custodyNameFirstStage({ ...NAMED, recoveryDue: true })).toBe('recovery');
  });

  it('goes straight to Home once the step has been answered', () => {
    expect(custodyNameFirstStage({ ...NAMED, recoveryDue: false })).toBe('home');
  });

  it('goes straight to Home for every caller that predates the step', () => {
    expect(custodyNameFirstStage(NAMED)).toBe('home');
  });

  it('never shows it to a Passport that has no name yet', () => {
    expect(custodyNameFirstStage({ ...NAMED, setupFinished: false, recoveryDue: true })).toBe(
      'name',
    );
    expect(custodyNameFirstStage({ ...NAMED, claimedName: null, recoveryDue: true })).toBe('name');
  });
});

describe('what the one primary control says', () => {
  it('offers to create when nothing has been built', () => {
    expect(
      custodyNameFirstAction({ setupStarted: false, setupFinished: false, interrupted: false }),
    ).toBe('Create my Passport');
  });

  it('offers to finish a setup that started', () => {
    expect(
      custodyNameFirstAction({ setupStarted: true, setupFinished: false, interrupted: false }),
    ).toBe('Finish setting up my Passport');
  });

  it('offers only the name once the Passport is built', () => {
    expect(
      custodyNameFirstAction({ setupStarted: true, setupFinished: true, interrupted: false }),
    ).toBe('Claim my name');
  });

  it('offers a fresh Passport where the old one can never be finished', () => {
    expect(
      custodyNameFirstAction({ setupStarted: true, setupFinished: false, interrupted: true }),
    ).toBe('Start again');
  });

  it('never offers to create a second Passport', () => {
    for (const setupFinished of [false, true]) {
      expect(
        custodyNameFirstAction({ setupStarted: true, setupFinished, interrupted: false }),
      ).not.toBe('Create my Passport');
    }
  });
});

describe('whether the press is allowed', () => {
  it('is allowed only over a name the registry called free', () => {
    expect(custodyNameFirstEnabled({ busy: false, available: true })).toBe(true);
    expect(custodyNameFirstEnabled({ busy: false, available: false })).toBe(false);
  });

  it('is refused while something is already running', () => {
    expect(custodyNameFirstEnabled({ busy: true, available: true })).toBe(false);
  });
});

describe('the sentences under the field', () => {
  it('says a free name is free, in the words the other road uses', () => {
    expect(custodyNameAvailableSentence('alice.night')).toBe('alice.night is available');
  });

  it('says a taken name is taken, and names the network', () => {
    expect(custodyNameTakenSentence('alice.night', 'Stagenet')).toBe(
      'alice.night is already taken on Stagenet. Try another name.',
    );
  });

  it('asks for a name before anything is typed', () => {
    expect(custodyNameEmptySentence('Stagenet')).toBe(
      'Type a name to see whether it is free on Stagenet.',
    );
  });

  it('keeps every sentence clear of the words this demo does not say', () => {
    const sentences = [
      custodyNameAvailableSentence('alice.night'),
      custodyNameTakenSentence('alice.night', 'Stagenet'),
      custodyNameEmptySentence('Stagenet'),
      CUSTODY_NAME_CHECKING_SENTENCE,
      CUSTODY_NAME_UNREACHABLE_SENTENCE,
      custodyNameFirstAction({ setupStarted: false, setupFinished: false, interrupted: false }),
    ];
    for (const sentence of sentences) {
      for (const forbidden of [
        'wallet address',
        'dust',
        'contract',
        'registry',
        'indexer',
        'resolver',
        'sponsor',
        'sdk',
        'dynamic',
      ]) {
        expect(sentence.toLowerCase(), `"${forbidden}" is in "${sentence}"`).not.toContain(
          forbidden,
        );
      }
    }
  });
});

describe('somebody else got the name first', () => {
  it('reads the name service’s own code', () => {
    expect(custodyNameWasTaken(Object.assign(new Error('refused'), { code: 'name-taken' }))).toBe(
      true,
    );
  });

  it('reads the sentence the pre-claim re-read raises', () => {
    expect(custodyNameWasTaken(new Error('alice.night is already taken on Stagenet.'))).toBe(true);
  });

  it('does not read every other refusal as a lost name', () => {
    expect(custodyNameWasTaken(new Error('the service could not be reached'))).toBe(false);
    expect(
      custodyNameWasTaken(Object.assign(new Error('nope'), { code: 'deploy-failed' })),
    ).toBe(false);
    expect(custodyNameWasTaken(null)).toBe(false);
    /* A string is not a refusal, however it reads. */
    expect(custodyNameWasTaken('already taken')).toBe(false);
    /* Neither is a bare object that is not an Error — there is no message on
       it to read, and inventing one would be guessing. */
    expect(custodyNameWasTaken({ code: 'something-else' })).toBe(false);
  });

  it('keeps the account and gives up only the name', () => {
    const outcome = custodyNameRaceOutcome('alice.night', 'Stagenet');
    expect(outcome.keepAccount).toBe(true);
    expect(outcome.forgetChosenName).toBe(true);
    expect(outcome.stage).toBe('name');
    expect(outcome.sentence).toBe('alice.night is already taken on Stagenet. Try another name.');
  });
});
