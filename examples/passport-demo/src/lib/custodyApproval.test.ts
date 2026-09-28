/**
 * WHAT THIS PROTECTS: that a passkey Passport's payments are each approved by a
 * fresh assertion, and that nothing able to sign is left behind (2026/09/27).
 *
 * The review question was "I can send transfers without being prompted to
 * confirm the transaction with my passkeys, how is that possible?", and the
 * answer was a device built once and held. Every drill below is named after
 * what it costs to get wrong:
 *
 *   - the prompt is asked for before anything is awaited, so the press that
 *     started the payment is still the gesture the browser judges it by;
 *   - every payment asks for its own root, and every root is zeroed — built,
 *     failed, or arrived too late;
 *   - a payment whose approval was not given never reaches its work, so the
 *     engine is not called and nothing is submitted;
 *   - the approval ends when the payment does, after its tidy-up and not
 *     before, and a device let go cannot sign again.
 *
 * Nothing here mocks the module under test. The ceremony and the device are
 * the seams it takes.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  CUSTODY_APPROVAL_ENDED,
  CUSTODY_PAYMENT_NOT_APPROVED,
  providerApproval,
  runApprovedWork,
  startPasskeyApproval,
  type ApprovedDevice,
} from './custodyApproval.js';

/** A promise and the two hands that settle it. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (cause: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** A root that is recognisably not zero. */
function aRoot(fill = 7): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

/**
 * A device the way `passkeyCustodyDevice` hands one back: it signs until it is
 * forgotten, and refuses after.
 */
function aDevice(label: string): ApprovedDevice<{ label: string; sign: () => string }> & {
  forgotten: () => number;
} {
  let forgotten = 0;
  return {
    identity: {
      label,
      sign: () => {
        if (forgotten > 0) throw new Error('forgotten');
        return `${label}:signed`;
      },
    },
    forget: () => {
      forgotten += 1;
    },
    forgotten: () => forgotten,
  };
}

/** The same drill's shape of a ceremony the reader dismissed. */
const dismissed = () => new Error('The operation either timed out or was not allowed.');

describe('asking a passkey for one approval', () => {
  it('asks for the prompt before it returns — before anything is awaited', () => {
    const order: string[] = [];
    startPasskeyApproval({
      contractRoot: () => {
        order.push('prompt');
        return new Promise<Uint8Array>(() => undefined);
      },
      build: () => {
        order.push('build');
        return Promise.resolve(aDevice('never'));
      },
    });
    /* Synchronously: a browser that wants a gesture for the prompt judges it
       at the call, and this line runs in the same turn as the press. */
    order.push('returned');
    expect(order).toEqual(['prompt', 'returned']);
  });

  it('builds the device from the root it was given, then zeroes the root', async () => {
    const root = aRoot();
    let seen: number[] = [];
    const device = aDevice('one');
    const approval = startPasskeyApproval({
      contractRoot: () => Promise.resolve(root),
      build: (given) => {
        seen = Array.from(given);
        return Promise.resolve(device);
      },
    });

    const identity = await approval.ready;
    expect(identity.label).toBe('one');
    expect(seen).toEqual(Array.from(aRoot()));
    /* The bytes one assertion produced are gone the moment the device exists. */
    expect(root.every((byte) => byte === 0)).toBe(true);
    await expect(approval.answered).resolves.toBeUndefined();
  });

  it('asks for a new root every time, and zeroes every one', async () => {
    const roots: Uint8Array[] = [];
    const devices = [aDevice('first'), aDevice('second')];
    const approve = () =>
      startPasskeyApproval({
        contractRoot: () => {
          const root = aRoot(roots.length + 1);
          roots.push(root);
          return Promise.resolve(root);
        },
        build: () => Promise.resolve(devices[roots.length - 1]),
      });

    /* Two payments, back to back. */
    const first = approve();
    const firstIdentity = await first.ready;
    first.release();
    const second = approve();
    const secondIdentity = await second.ready;
    second.release();

    expect(roots).toHaveLength(2);
    expect(roots[0]).not.toBe(roots[1]);
    expect(roots.every((root) => root.every((byte) => byte === 0))).toBe(true);
    expect(firstIdentity.label).toBe('first');
    expect(secondIdentity.label).toBe('second');
    /* Each approval forgot its own device, once. */
    expect(devices.map((device) => device.forgotten())).toEqual([1, 1]);
  });

  it('forgets the device on release, leaves it unable to sign, and is safe to release twice', async () => {
    const device = aDevice('held');
    const approval = startPasskeyApproval({
      contractRoot: () => Promise.resolve(aRoot()),
      build: () => Promise.resolve(device),
    });
    const identity = await approval.ready;
    expect(identity.sign()).toBe('held:signed');

    approval.release();
    approval.release();
    expect(device.forgotten()).toBe(1);
    expect(() => identity.sign()).toThrow('forgotten');
  });

  it('zeroes the root when the device cannot be built', async () => {
    const root = aRoot();
    const approval = startPasskeyApproval({
      contractRoot: () => Promise.resolve(root),
      build: () => Promise.reject(new Error('the module would not load')),
    });
    await expect(approval.ready).rejects.toThrow('the module would not load');
    expect(root.every((byte) => byte === 0)).toBe(true);
    /* The prompt WAS answered: the progress may move on. */
    await expect(approval.answered).resolves.toBeUndefined();
  });

  it('zeroes and forgets an answer that arrives after the approval was let go', async () => {
    const asked = deferred<Uint8Array>();
    const build = vi.fn(() => Promise.resolve(aDevice('late')));
    const approval = startPasskeyApproval({ contractRoot: () => asked.promise, build });

    approval.release();
    const root = aRoot();
    asked.resolve(root);

    await expect(approval.ready).rejects.toThrow(CUSTODY_APPROVAL_ENDED);
    expect(build).not.toHaveBeenCalled();
    expect(root.every((byte) => byte === 0)).toBe(true);
  });

  it('forgets a device finished after the approval was let go, and never hands it over', async () => {
    const building = deferred<ApprovedDevice<{ label: string; sign: () => string }>>();
    let started!: () => void;
    const buildStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const root = aRoot();
    const approval = startPasskeyApproval({
      contractRoot: () => Promise.resolve(root),
      build: () => {
        started();
        return building.promise;
      },
    });

    await buildStarted;
    approval.release();
    const device = aDevice('too late');
    building.resolve(device);

    await expect(approval.ready).rejects.toThrow(CUSTODY_APPROVAL_ENDED);
    expect(device.forgotten()).toBe(1);
    expect(root.every((byte) => byte === 0)).toBe(true);
  });

  it('turns a dismissed prompt into a refusal, and still says it was answered', async () => {
    const build = vi.fn(() => Promise.resolve(aDevice('never')));
    const approval = startPasskeyApproval({
      contractRoot: () => Promise.reject(dismissed()),
      build,
    });
    await expect(approval.ready).rejects.toThrow(/not allowed/);
    await expect(approval.answered).resolves.toBeUndefined();
    expect(build).not.toHaveBeenCalled();
    /* Nothing was built, so there is nothing to forget — and letting it go is
       still safe. */
    expect(() => approval.release()).not.toThrow();
  });

  it('turns a ceremony that throws before it starts into a refusal rather than a throw', async () => {
    const approval = startPasskeyApproval({
      contractRoot: () => {
        throw new Error('Passport cannot find the passkey this session signed in with.');
      },
      build: () => Promise.resolve(aDevice('never')),
    });
    await expect(approval.ready).rejects.toThrow(/cannot find the passkey/);
    await expect(approval.answered).resolves.toBeUndefined();
  });

  it('says it was answered as soon as the prompt is, before the device is built', async () => {
    const building = deferred<ApprovedDevice<{ label: string; sign: () => string }>>();
    const approval = startPasskeyApproval({
      contractRoot: () => Promise.resolve(aRoot()),
      build: () => building.promise,
    });
    let built = false;
    void approval.ready.then(() => {
      built = true;
    });
    await approval.answered;
    expect(built).toBe(false);
    building.resolve(aDevice('now'));
    await approval.ready;
    expect(built).toBe(true);
  });
});

describe('a provider sign-in’s approval', () => {
  it('asks for nothing until the payment signs, and then once', async () => {
    const identity = vi.fn(() => Promise.resolve({ label: 'provider' }));
    const approval = providerApproval(identity);
    await approval.answered;
    expect(identity).not.toHaveBeenCalled();

    const [first, second] = await Promise.all([approval.ready, approval.ready]);
    expect(first).toBe(second);
    expect(identity).toHaveBeenCalledTimes(1);
    /* Nothing is held here, so there is nothing to let go. */
    expect(() => approval.release()).not.toThrow();
  });

  it('turns an identity that throws before it starts into a refusal', async () => {
    const approval = providerApproval<{ label: string }>(() => {
      throw new Error('Your sign-in is still finishing. Try again in a moment.');
    });
    await expect(approval.ready).rejects.toThrow('Your sign-in is still finishing.');
  });
});

describe('one payment under one approval', () => {
  it('waits for the passkey before it does anything, and says when the prompt was answered', async () => {
    const order: string[] = [];
    const asked = deferred<Uint8Array>();
    const approval = startPasskeyApproval({
      contractRoot: () => asked.promise,
      build: () => Promise.resolve(aDevice('payment')),
    });

    const running = runApprovedWork(
      approval,
      {
        approvalFirst: true,
        onAnswered: () => order.push('answered'),
        notApproved: CUSTODY_PAYMENT_NOT_APPROVED,
      },
      async (approved) => {
        order.push('work');
        order.push((await approved()).sign());
      },
    );
    await Promise.resolve();
    expect(order).toEqual([]);

    asked.resolve(aRoot());
    await running;
    expect(order).toEqual(['answered', 'work', 'payment:signed']);
  });

  it('never reaches the payment when the approval is dismissed, so nothing is submitted', async () => {
    const submit = vi.fn();
    const approval = startPasskeyApproval({
      contractRoot: () => Promise.reject(dismissed()),
      build: () => Promise.resolve(aDevice('never')),
    });
    const answered = vi.fn();

    const outcome = runApprovedWork(
      approval,
      { approvalFirst: true, onAnswered: answered, notApproved: CUSTODY_PAYMENT_NOT_APPROVED },
      () => {
        submit();
        return Promise.resolve();
      },
    );
    await expect(outcome).rejects.toThrow(CUSTODY_PAYMENT_NOT_APPROVED);
    /* The cause rides along for the console, where it is of use to somebody. */
    await outcome.catch((error: Error) => {
      expect((error.cause as Error).message).toMatch(/not allowed/);
    });
    expect(submit).not.toHaveBeenCalled();
    /* The prompt WAS answered, with a no: the progress stops saying it waits. */
    expect(answered).toHaveBeenCalledTimes(1);
  });

  it('lets the approval go the moment a payment with nothing to follow is done', async () => {
    const device = aDevice('once');
    const approval = startPasskeyApproval({
      contractRoot: () => Promise.resolve(aRoot()),
      build: () => Promise.resolve(device),
    });
    let identity: { sign: () => string } | null = null;

    const handed = await runApprovedWork(
      approval,
      { approvalFirst: true, notApproved: CUSTODY_PAYMENT_NOT_APPROVED },
      async (approved) => {
        identity = await approved();
        identity.sign();
      },
    );
    expect(handed).toBeUndefined();
    expect(device.forgotten()).toBe(1);
    /* A reference that outlived the payment cannot sign a second one. */
    expect(() => identity!.sign()).toThrow('forgotten');
  });

  it('keeps the approval through the tidy-up the payment hands back, and lets it go after', async () => {
    const device = aDevice('change');
    const approval = startPasskeyApproval({
      contractRoot: () => Promise.resolve(aRoot()),
      build: () => Promise.resolve(device),
    });
    const signed: string[] = [];

    const tidyUp = await runApprovedWork(
      approval,
      { approvalFirst: true, notApproved: CUSTODY_PAYMENT_NOT_APPROVED },
      async (approved) => {
        const identity = await approved();
        signed.push(identity.sign());
        /* The note of the change this payment kept: the same payment, the same
           approval. */
        return () => {
          signed.push(identity.sign());
          return Promise.resolve();
        };
      },
    );
    expect(typeof tidyUp).toBe('function');
    expect(device.forgotten()).toBe(0);

    await (tidyUp as () => Promise<void>)();
    expect(signed).toEqual(['change:signed', 'change:signed']);
    expect(device.forgotten()).toBe(1);
  });

  it('lets the approval go when the tidy-up fails, too', async () => {
    const device = aDevice('change');
    const approval = startPasskeyApproval({
      contractRoot: () => Promise.resolve(aRoot()),
      build: () => Promise.resolve(device),
    });
    const tidyUp = await runApprovedWork(
      approval,
      { approvalFirst: true, notApproved: CUSTODY_PAYMENT_NOT_APPROVED },
      () => Promise.resolve(() => Promise.reject(new Error('the note did not land'))),
    );
    await expect((tidyUp as () => Promise<void>)()).rejects.toThrow('the note did not land');
    expect(device.forgotten()).toBe(1);
  });

  it('lets the approval go when the payment fails', async () => {
    const device = aDevice('failed');
    const approval = startPasskeyApproval({
      contractRoot: () => Promise.resolve(aRoot()),
      build: () => Promise.resolve(device),
    });
    await expect(
      runApprovedWork(
        approval,
        { approvalFirst: true, notApproved: CUSTODY_PAYMENT_NOT_APPROVED },
        () => Promise.reject(new Error("That payment didn't go through. Nothing left your Passport.")),
      ),
    ).rejects.toThrow("didn't go through");
    expect(device.forgotten()).toBe(1);
  });

  it('asks a provider sign-in at the signing point, and lets its own refusal through unchanged', async () => {
    const order: string[] = [];
    const approval = providerApproval<{ label: string }>(() => {
      order.push('identity');
      return Promise.reject(new Error('Your sign-in is still finishing. Try again in a moment.'));
    });

    await expect(
      runApprovedWork(approval, { approvalFirst: false, notApproved: null }, async (approved) => {
        order.push('preparing');
        await approved();
      }),
    ).rejects.toThrow('Your sign-in is still finishing. Try again in a moment.');
    /* The work ran first, exactly as that arm always has: its approval is the
       provider's, inside the call. */
    expect(order).toEqual(['preparing', 'identity']);
  });
});
