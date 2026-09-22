import { describe, expect, it } from 'vitest';

import { CUSTODY_BACKUP_KEY } from './backupDevice.js';
import {
  RECOVERY_COPY,
  loadRecoveryRecord,
  providerRecoveryStage,
  recoveryFailureSentence,
  recoveryHeld,
  recoveryHomeEntry,
  recoveryRefusal,
  recoveryResumes,
  recoveryStepDue,
  type RecoveryStepInput,
} from './recoveryStep.js';

/** A Passport that has just claimed its name on a build that has sign-ins. */
const JUST_NAMED: RecoveryStepInput = {
  setupFinished: true,
  claimedName: 'alice',
  socialAvailable: true,
  heldBySocial: false,
  record: null,
};

function store(seed: Record<string, string> = {}) {
  const held = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
    removeItem: (key: string) => void held.delete(key),
  };
}

describe('whether the way back is offered after the name', () => {
  it('offers it to a Passport that has just been named', () => {
    expect(recoveryStepDue(JUST_NAMED)).toBe(true);
  });

  it('does not offer it before the setup has finished', () => {
    expect(recoveryStepDue({ ...JUST_NAMED, setupFinished: false })).toBe(false);
  });

  it('does not offer it before there is a name', () => {
    expect(recoveryStepDue({ ...JUST_NAMED, claimedName: null })).toBe(false);
  });

  it('offers it exactly once: a Passport that has one is never asked again', () => {
    expect(recoveryStepDue({ ...JUST_NAMED, record: { doneAt: 1 } })).toBe(false);
  });

  it('offers it exactly once: a skip is an answer and is not asked again', () => {
    expect(recoveryStepDue({ ...JUST_NAMED, record: { dismissedAt: 1 } })).toBe(false);
  });

  it('has nothing to offer where the build has no sign-in', () => {
    expect(recoveryStepDue({ ...JUST_NAMED, socialAvailable: false })).toBe(false);
  });

  it('has nothing to offer a Passport a sign-in already holds', () => {
    expect(recoveryStepDue({ ...JUST_NAMED, heldBySocial: true })).toBe(false);
  });

  it('reads a record with neither answer in it as unanswered', () => {
    expect(recoveryStepDue({ ...JUST_NAMED, record: {} })).toBe(true);
  });
});

describe('whether a Passport has a way back', () => {
  it('is false where there is no record at all', () => {
    expect(recoveryHeld(null)).toBe(false);
  });

  it('is false where the record only remembers a skip', () => {
    expect(recoveryHeld({ dismissedAt: 5 })).toBe(false);
  });

  it('is true once one has been added', () => {
    expect(recoveryHeld({ doneAt: 5, provider: 'Google' })).toBe(true);
  });

  it('reads the record out of storage under the key the old road used', () => {
    const storage = store({
      [CUSTODY_BACKUP_KEY]: JSON.stringify({ 'jubjub:ab|stagenet': { doneAt: 7 } }),
    });
    expect(loadRecoveryRecord(storage, 'JUBJUB:AB', 'stagenet')).toEqual({ doneAt: 7 });
    expect(loadRecoveryRecord(storage, 'jubjub:ab', 'preview')).toBeNull();
  });
});

describe('what Home says about it', () => {
  it('states it, without a control, once there is one', () => {
    expect(
      recoveryHomeEntry({ socialAvailable: true, heldBySocial: false, record: { doneAt: 1 } }),
    ).toBe('on');
  });

  it('offers it where the step was skipped', () => {
    expect(
      recoveryHomeEntry({ socialAvailable: true, heldBySocial: false, record: { dismissedAt: 1 } }),
    ).toBe('add');
  });

  it('offers it to a Passport made before the step existed', () => {
    expect(recoveryHomeEntry({ socialAvailable: true, heldBySocial: false, record: null })).toBe(
      'add',
    );
  });

  it('says nothing at all where the build has no sign-in', () => {
    expect(recoveryHomeEntry({ socialAvailable: false, heldBySocial: false, record: null })).toBe(
      'hidden',
    );
  });

  it('says nothing to a Passport a sign-in holds', () => {
    expect(recoveryHomeEntry({ socialAvailable: true, heldBySocial: true, record: null })).toBe(
      'hidden',
    );
  });
});

describe('picking the step back up after the sign-in', () => {
  const PRESSED = {
    intended: true,
    readyScreen: true,
    socialReady: true,
    record: null,
    busy: false,
  };

  it('runs the add for somebody who came back signed in', () => {
    expect(recoveryResumes(PRESSED)).toBe(true);
  });

  it('runs nothing for somebody who never pressed it', () => {
    expect(recoveryResumes({ ...PRESSED, intended: false })).toBe(false);
  });

  it('runs nothing once the way back is on', () => {
    expect(recoveryResumes({ ...PRESSED, record: { doneAt: 2 } })).toBe(false);
  });

  it('waits for the sign-in to have a key behind it', () => {
    expect(recoveryResumes({ ...PRESSED, socialReady: false })).toBe(false);
  });

  it('waits until a screen the add can finish on is showing', () => {
    expect(recoveryResumes({ ...PRESSED, readyScreen: false })).toBe(false);
  });

  it('never asks for a second approval while the first is away', () => {
    expect(recoveryResumes({ ...PRESSED, busy: true })).toBe(false);
  });
});

describe('whether the press can be answered', () => {
  it('lets a signed-in session with a key through', () => {
    expect(recoveryRefusal({ status: 'signed-in', hasKey: true })).toBeNull();
  });

  it('lets a signed-out session through, because pressing it signs in', () => {
    expect(recoveryRefusal({ status: 'signed-out', hasKey: false })).toBeNull();
  });

  it('says so where the build has no sign-in', () => {
    expect(recoveryRefusal({ status: 'disabled', hasKey: false })).toBe(RECOVERY_COPY.unavailable);
  });

  it('asks for a moment while the sign-in is loading', () => {
    expect(recoveryRefusal({ status: 'loading', hasKey: false })).toBe(RECOVERY_COPY.loading);
  });

  it('asks for a moment while a signed-in session settles its key', () => {
    expect(recoveryRefusal({ status: 'signed-in', hasKey: false })).toBe(RECOVERY_COPY.settling);
  });
});

describe('what a failed add says', () => {
  it('leads with the Passport being fine, and carries a short reason', () => {
    const sentence = recoveryFailureSentence(new Error('The sign-in was closed.'));
    expect(sentence).toContain('Your Passport is set up');
    expect(sentence).toContain('The sign-in was closed.');
    expect(sentence).toContain('later');
  });

  it('drops a reason nobody could read', () => {
    const sentence = recoveryFailureSentence(new Error('x'.repeat(200)));
    expect(sentence).not.toContain('xxx');
    expect(sentence).toContain('Your Passport is set up');
  });

  it('says the same thing about a failure that is not an error at all', () => {
    expect(recoveryFailureSentence('nope')).toContain('could not be added just now');
  });

  it('says the same thing about an error with nothing in it', () => {
    expect(recoveryFailureSentence(new Error('   '))).toContain('could not be added just now');
  });
});

describe('where the new-device road starts', () => {
  it('asks for the sign-in first', () => {
    expect(providerRecoveryStage({ status: 'signed-out', hasAddress: false })).toBe('sign-in');
  });

  it('asks for the name once somebody is signed in', () => {
    expect(providerRecoveryStage({ status: 'signed-in', hasAddress: true })).toBe('name');
  });

  it('keeps asking for the sign-in until it has a key to show for it', () => {
    expect(providerRecoveryStage({ status: 'signed-in', hasAddress: false })).toBe('sign-in');
  });

  it('does not exist where the build has no sign-in', () => {
    expect(providerRecoveryStage({ status: 'disabled', hasAddress: false })).toBe('unavailable');
  });
});

describe('what the step says', () => {
  it('names the provider in the receipt where one is known', () => {
    expect(RECOVERY_COPY.done('Google')).toBe('Your Passport has a way back, with Google.');
  });

  it('says it plainly where none is', () => {
    expect(RECOVERY_COPY.done(null)).toBe('Your Passport has a way back.');
    expect(RECOVERY_COPY.done('  ')).toBe('Your Passport has a way back.');
  });

  it('never says what holds the Passport', () => {
    const everything = Object.values(RECOVERY_COPY)
      .map((value) => (typeof value === 'function' ? value('Google') : value))
      .join(' ');
    for (const banned of [
      'wallet address',
      'DUST',
      'contract',
      'registry',
      'indexer',
      'resolver',
      'sponsor',
      'SDK',
      'Dynamic',
    ]) {
      expect(everything).not.toContain(banned);
    }
  });
});
