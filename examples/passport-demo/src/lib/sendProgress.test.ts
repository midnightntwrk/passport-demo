import { describe, expect, it } from 'vitest';

import {
  SEND_PROGRESS_PHASE_LABEL,
  SEND_PROGRESS_STEPS,
  SEND_PROGRESS_STEPS_APPROVAL_FIRST,
  sendElapsed,
  sendProgressSteps,
  SEND_SENT_DISMISS_MS,
  SEND_WAITING_STEP_LABEL,
  sendInFlightReason,
  sendingLine,
  sendProgressPhase,
  sendProgressReduce,
  sendProgressView,
  sentLine,
  sendClosingNote,
  sendUnsent,
  type SendDraft,
  type SendProgress,
  type SendProgressRecord,
  type SendProgressSubject,
  type SendProgressView,
} from './sendProgress.js';

const subject: SendProgressSubject = { amount: '10', symbol: 'mUSD', recipient: 'bob.night' };
const draft: SendDraft = { assetId: 'ab'.repeat(32), recipient: 'bob.night', amount: '10' };
const T0 = 1_000;
const running: SendProgress = { kind: 'running', subject, draft, startedAt: T0, waiting: false };
const link = { label: 'View transaction', href: 'https://explorer.example/tx/1' };

describe('sendProgressPhase', () => {
  it('reads nothing yet, and opening the account, as preparing', () => {
    expect(sendProgressPhase(null)).toBe('preparing');
    expect(sendProgressPhase('wallet')).toBe('preparing');
  });

  it('reads the approval, the proof, and the wait for the network in order', () => {
    expect(sendProgressPhase('sign')).toBe('approving');
    expect(sendProgressPhase('submit')).toBe('proving');
    expect(sendProgressPhase('confirm')).toBe('confirming');
  });

  it('keeps a setup step that should never reach a payment moving, as proving', () => {
    expect(sendProgressPhase('deploy')).toBe('proving');
    expect(sendProgressPhase('waves')).toBe('proving');
    expect(sendProgressPhase('activate')).toBe('proving');
  });

  it('names every phase in a few words', () => {
    expect(SEND_PROGRESS_PHASE_LABEL).toEqual({
      waiting: 'Waiting for your last payment to finish…',
      preparing: 'Preparing…',
      approving: 'Waiting for your approval…',
      proving: 'Proving…',
      confirming: 'Confirming…',
    });
  });
});

describe('the two lines', () => {
  it('says who is being paid what', () => {
    expect(sendingLine(subject)).toBe('Sending 10 mUSD to bob.night');
    expect(sentLine(subject)).toBe('Sent 10 mUSD to bob.night');
  });
});

describe('sendProgressReduce', () => {
  it('starts a payment from nothing, and a new one over an old outcome', () => {
    expect(sendProgressReduce(null, { type: 'start', subject, draft, at: T0 })).toEqual(running);
    const failed: SendProgress = { kind: 'failed', subject, sentence: 'No.', draft, startedAt: 5 };
    expect(sendProgressReduce(failed, { type: 'start', subject, draft, at: T0 })).toEqual(running);
  });

  it('turns a running payment into Sent, with the link it landed with', () => {
    expect(sendProgressReduce(running, { type: 'sent', link })).toEqual({
      kind: 'sent',
      subject,
      link,
      startedAt: T0,
    });
    expect(sendProgressReduce(running, { type: 'sent', link: null })).toEqual({
      kind: 'sent',
      subject,
      link: null,
      startedAt: T0,
    });
  });

  it('gives a sent payment its explorer link once the hash is found, and changes nothing else (2026/09/28)', () => {
    const unlinked: SendProgress = { kind: 'sent', subject, link: null, startedAt: T0 };
    expect(sendProgressReduce(unlinked, { type: 'link', link })).toEqual({ ...unlinked, link });
    /* A payment that already has its link keeps it; one still running, or none
       at all, is not what the link is about. */
    const linked: SendProgress = { kind: 'sent', subject, link, startedAt: T0 };
    const other = { label: 'View', href: 'https://explorer.1am.xyz/tx/ff?network=stagenet' };
    expect(sendProgressReduce(linked, { type: 'link', link: other })).toBe(linked);
    expect(sendProgressReduce(running, { type: 'link', link })).toBe(running);
    expect(sendProgressReduce(null, { type: 'link', link })).toBeNull();
  });

  it('turns a running payment that was never handed over into its one sentence', () => {
    expect(
      sendProgressReduce(running, { type: 'failed', sentence: 'Nothing left.', handedOver: false }),
    ).toEqual({ kind: 'failed', subject, sentence: 'Nothing left.', draft, startedAt: T0 });
  });

  it('hands a payment that was handed over back to its record', () => {
    expect(
      sendProgressReduce(running, { type: 'failed', sentence: 'Timed out.', handedOver: true }),
    ).toBeNull();
  });

  it('ignores an answer about a payment that is not running', () => {
    expect(sendProgressReduce(null, { type: 'sent', link })).toBeNull();
    expect(sendProgressReduce(null, { type: 'failed', sentence: 'x', handedOver: false })).toBeNull();
    const sent: SendProgress = { kind: 'sent', subject, link, startedAt: T0 };
    expect(sendProgressReduce(sent, { type: 'failed', sentence: 'x', handedOver: false })).toBe(sent);
  });

  it('puts away an outcome, and never a payment still running', () => {
    expect(sendProgressReduce({ kind: 'sent', subject, link, startedAt: T0 }, { type: 'dismiss' })).toBeNull();
    expect(sendProgressReduce(null, { type: 'dismiss' })).toBeNull();
    expect(sendProgressReduce(running, { type: 'dismiss' })).toBe(running);
  });

  it('waits for the last payment, and then goes, only while it is running', () => {
    const waiting = sendProgressReduce(running, { type: 'waiting' });
    expect(waiting).toEqual({ ...running, waiting: true });
    expect(sendProgressReduce(waiting, { type: 'turn' })).toEqual(running);
    /* Nothing changes, so nothing is re-rendered, when it is already so. */
    expect(sendProgressReduce(running, { type: 'turn' })).toBe(running);
    expect(sendProgressReduce(waiting, { type: 'waiting' })).toBe(waiting);
    /* A payment that is not running has nothing to wait for. */
    expect(sendProgressReduce(null, { type: 'waiting' })).toBeNull();
    const sent: SendProgress = { kind: 'sent', subject, link, startedAt: T0 };
    expect(sendProgressReduce(sent, { type: 'turn' })).toBe(sent);
    /* It can fail from there too — the wait ran out — with its sentence. */
    expect(
      sendProgressReduce(waiting, { type: 'failed', sentence: 'Still finishing.', handedOver: false }),
    ).toEqual({ kind: 'failed', subject, sentence: 'Still finishing.', draft, startedAt: T0 });
  });

  it('goes Sent by itself after a few seconds', () => {
    expect(SEND_SENT_DISMISS_MS).toBeGreaterThanOrEqual(3_000);
    expect(SEND_SENT_DISMISS_MS).toBeLessThanOrEqual(10_000);
  });
});

describe('sendProgressView', () => {
  const record: SendProgressRecord = {
    subject,
    draft,
    startedAt: 7,
    submitted: true,
    sentence: 'Nothing was sent, and it is all still in your Passport.',
  };

  it('is nothing when nothing is running and nothing is written down', () => {
    expect(sendProgressView({ progress: null, step: null, record: null })).toBeNull();
  });

  it('shows the live phase of the payment this tab is running', () => {
    expect(sendProgressView({ progress: running, step: 'submit', record })).toEqual({
      kind: 'running',
      title: 'Sending 10 mUSD to bob.night',
      detail: 'Proving…',
      phase: 'proving',
      link: null,
      retry: null,
      recipient: 'bob.night',
      subject,
      startedAt: T0,
    });
  });

  it('shows Sent with its link, and nothing to retry', () => {
    const view = sendProgressView({ progress: { kind: 'sent', subject, link, startedAt: T0 }, step: null, record: null });
    expect(view).toEqual({
      kind: 'sent',
      title: 'Sent 10 mUSD to bob.night',
      detail: null,
      phase: null,
      link,
      retry: null,
      recipient: 'bob.night',
      subject,
      startedAt: T0,
    });
  });

  it('shows a failure as one sentence, with the draft to try again from', () => {
    const view = sendProgressView({
      progress: { kind: 'failed', subject, sentence: 'That did not go through.', draft, startedAt: T0 },
      step: null,
      record: null,
    });
    expect(view?.kind).toBe('failed');
    expect(view?.detail).toBe('That did not go through.');
    expect(view?.retry).toEqual(draft);
  });

  it('shows a payment an earlier visit handed over as confirming', () => {
    const view = sendProgressView({ progress: null, step: null, record });
    expect(view?.kind).toBe('running');
    expect(view?.detail).toBe('Confirming…');
    expect(view?.phase).toBe('confirming');
    expect(view?.startedAt).toBe(7);
  });

  it('shows one an earlier visit never handed over as the failure it is', () => {
    const view = sendProgressView({
      progress: null,
      step: null,
      record: { ...record, submitted: false },
    });
    expect(view?.kind).toBe('failed');
    expect(view?.detail).toBe('Nothing was sent, and it is all still in your Passport.');
    expect(view?.retry).toEqual(draft);
  });
});

describe('sendInFlightReason', () => {
  it('asks a second payment to wait while one is running, and only then', () => {
    const view = sendProgressView({ progress: running, step: null, record: null });
    expect(sendInFlightReason(view)).toBe(
      'Your payment to bob.night is still going through. You can send again once it has finished.',
    );
    expect(sendInFlightReason(null)).toBeNull();
    expect(
      sendInFlightReason(sendProgressView({ progress: { kind: 'sent', subject, link, startedAt: T0 }, step: null, record: null })),
    ).toBeNull();
  });
});

describe('the progress view', () => {
  const states = (view: Parameters<typeof sendProgressSteps>[0]) =>
    sendProgressSteps(view).map((step) => step.state);

  it('lists the five steps in order, ending in Sent', () => {
    expect(SEND_PROGRESS_STEPS.map((step) => step.label)).toEqual([
      'Preparing',
      'Waiting for your approval',
      'Proving',
      'Confirming',
      'Sent',
    ]);
  });

  it('marks the steps behind the live one done, and the ones ahead waiting', () => {
    const at = (step: Parameters<typeof sendProgressView>[0]['step']) =>
      sendProgressView({ progress: running, step, record: null })!;
    expect(states(at(null))).toEqual(['current', 'waiting', 'waiting', 'waiting', 'waiting']);
    expect(states(at('submit'))).toEqual(['done', 'done', 'current', 'waiting', 'waiting']);
    expect(states(at('confirm'))).toEqual(['done', 'done', 'done', 'current', 'waiting']);
    /* A running view with no phase named reads as the first step. */
    expect(states({ ...at('submit'), phase: null })).toEqual([
      'current',
      'waiting',
      'waiting',
      'waiting',
      'waiting',
    ]);
  });

  it('puts the wait for the last payment in front of the five, as the step it is on', () => {
    const waiting = sendProgressView({
      progress: { ...running, waiting: true },
      /* A step left over from the last payment says nothing about this one. */
      step: 'confirm',
      record: null,
    })!;
    expect(waiting.phase).toBe('waiting');
    expect(waiting.detail).toBe('Waiting for your last payment to finish…');
    expect(waiting.title).toBe('Sending 10 mUSD to bob.night');
    expect(sendProgressSteps(waiting).map((step) => [step.label, step.state])).toEqual([
      [SEND_WAITING_STEP_LABEL, 'current'],
      ['Preparing', 'waiting'],
      ['Waiting for your approval', 'waiting'],
      ['Proving', 'waiting'],
      ['Confirming', 'waiting'],
      ['Sent', 'waiting'],
    ]);
    /* And a third payment waits behind it at Review, as behind any other. */
    expect(sendInFlightReason(waiting)).toMatch(/still going through/);
  });

  it('marks every step done once Sent, and claims none for a failure', () => {
    const sent = sendProgressView({ progress: { kind: 'sent', subject, link, startedAt: T0 }, step: null, record: null })!;
    expect(states(sent)).toEqual(['done', 'done', 'done', 'done', 'done']);
    const failed = sendProgressView({
      progress: { kind: 'failed', subject, sentence: 'No.', draft, startedAt: T0 },
      step: null,
      record: null,
    })!;
    expect(states(failed)).toEqual(['waiting', 'waiting', 'waiting', 'waiting', 'waiting']);
  });

  it('says the elapsed time plainly, and never a negative one', () => {
    expect(sendElapsed(1_000, 13_400)).toBe('12 s');
    expect(sendElapsed(0, 65_000)).toBe('1 min 05 s');
    expect(sendElapsed(5_000, 1_000)).toBe('0 s');
  });
});

describe('what closing Passport does to a running payment (2026/09/26)', () => {
  const at = (step: Parameters<typeof sendProgressView>[0]['step']) =>
    sendProgressView({ progress: running, step, record: null })!;
  /** The copy rule every screen on this path keeps. */
  const FORBIDDEN = ['wallet address', 'DUST', 'contract', 'registry', 'indexer', 'resolver', 'sponsor', 'SDK', 'Dynamic'];

  it('is unsent from the press until the payment is handed to the network', () => {
    expect(sendUnsent(at(null))).toBe(true);
    expect(sendUnsent(at('sign'))).toBe(true);
    expect(sendUnsent(at('submit'))).toBe(true);
    expect(sendUnsent(at('confirm'))).toBe(false);
  });

  it('is never unsent for an outcome, a record read back, or nothing', () => {
    expect(sendUnsent(null)).toBe(false);
    expect(
      sendUnsent(sendProgressView({ progress: { kind: 'sent', subject, link, startedAt: T0 }, step: null, record: null })),
    ).toBe(false);
    expect(
      sendUnsent(
        sendProgressView({
          progress: { kind: 'failed', subject, sentence: 'No.', draft, startedAt: T0 },
          step: null,
          record: null,
        }),
      ),
    ).toBe(false);
    const handedOver: SendProgressRecord = { subject, draft, startedAt: 7, submitted: true, sentence: 'x' };
    expect(sendUnsent(sendProgressView({ progress: null, step: null, record: handedOver }))).toBe(false);
  });

  it('asks for Passport to be kept open while the payment is unsent, on all three surfaces', () => {
    expect(sendClosingNote(at('submit'))).toEqual({
      sheet: 'Keep Passport open until this is sent. You can close this sheet.',
      row: 'Keep Passport open until this is sent.',
      pill: 'Keep Passport open',
    });
  });

  it('says closing will not stop it once it has been handed over, and the pill asks for nothing', () => {
    const note = sendClosingNote(at('confirm'))!;
    expect(note.sheet).toBe('It has been handed to the network. Closing Passport now will not stop it.');
    expect(note.row).toBe('Closing Passport now will not stop it.');
    expect(note.pill).toBeNull();
  });

  it('says nothing about closing once the payment has an outcome', () => {
    expect(
      sendClosingNote(sendProgressView({ progress: { kind: 'sent', subject, link, startedAt: T0 }, step: null, record: null })!),
    ).toBeNull();
  });

  it('keeps to the copy rule', () => {
    for (const step of [null, 'confirm'] as const) {
      const note = sendClosingNote(at(step))!;
      for (const line of [note.sheet, note.row, note.pill ?? '']) {
        for (const word of FORBIDDEN) expect(line.toLowerCase()).not.toContain(word.toLowerCase());
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* A payment approved FIRST — a passkey's, raised by the Confirm press          */
/* (2026/09/27)                                                                */
/* -------------------------------------------------------------------------- */

describe('a payment whose approval comes first', () => {
  const start = sendProgressReduce(null, { type: 'start', subject, draft, at: T0, approvalFirst: true });
  const view = (progress: SendProgress | null, step: Parameters<typeof sendProgressView>[0]['step'] = null) =>
    sendProgressView({ progress, step, record: null })!;

  it('starts on "Waiting for your approval", and leaves it the moment the prompt is answered', () => {
    expect(start).toEqual({ ...running, approvalFirst: true, approving: true });
    expect(view(start).phase).toBe('approving');
    expect(view(start).detail).toBe('Waiting for your approval…');

    const answered = sendProgressReduce(start, { type: 'answered' });
    expect(answered).toEqual({ ...running, approvalFirst: true });
    expect(view(answered).phase).toBe('preparing');
    /* Answered once is answered: a second answer changes nothing. */
    expect(sendProgressReduce(answered, { type: 'answered' })).toBe(answered);
  });

  it('ignores an answer about a payment that is not waiting for one', () => {
    /* A provider sign-in's payment, whose approval is inside the call. */
    expect(sendProgressReduce(running, { type: 'answered' })).toBe(running);
    expect(sendProgressReduce(null, { type: 'answered' })).toBeNull();
    const sent: SendProgress = { kind: 'sent', subject, link, startedAt: T0 };
    expect(sendProgressReduce(sent, { type: 'answered' })).toBe(sent);
  });

  it('says it is waiting for the last payment before it says it is waiting for an approval', () => {
    /* A payment that waited asks for its approval when its turn comes. */
    const waiting = sendProgressReduce(start, { type: 'waiting' });
    expect(view(waiting).phase).toBe('waiting');
    const turn = sendProgressReduce(waiting, { type: 'turn' });
    expect(view(turn).phase).toBe('approving');
  });

  it('does not ask for the approval a second time when the engine signs', () => {
    const answered = sendProgressReduce(start, { type: 'answered' });
    /* The key is in hand by then: signing is part of preparing the payment. */
    expect(sendProgressPhase('sign', true)).toBe('preparing');
    expect(view(answered, 'sign').phase).toBe('preparing');
    expect(view(answered, 'submit').phase).toBe('proving');
    expect(view(answered, 'confirm').phase).toBe('confirming');
  });

  it('lists the approval first, and walks the list in that order', () => {
    expect(SEND_PROGRESS_STEPS_APPROVAL_FIRST.map((step) => step.label)).toEqual([
      'Waiting for your approval',
      'Preparing',
      'Proving',
      'Confirming',
      'Sent',
    ]);
    const states = (at: SendProgressView) => sendProgressSteps(at).map((step) => step.state);
    expect(states(view(start))).toEqual(['current', 'waiting', 'waiting', 'waiting', 'waiting']);
    const answered = sendProgressReduce(start, { type: 'answered' });
    expect(states(view(answered))).toEqual(['done', 'current', 'waiting', 'waiting', 'waiting']);
    expect(states(view(answered, 'submit'))).toEqual(['done', 'done', 'current', 'waiting', 'waiting']);
    /* A running view with no phase named reads as its own first step. */
    expect(states({ ...view(answered), phase: null })).toEqual([
      'current',
      'waiting',
      'waiting',
      'waiting',
      'waiting',
    ]);
  });

  it('keeps the order through Sent and through a failure', () => {
    const answered = sendProgressReduce(start, { type: 'answered' });
    const sent = sendProgressReduce(answered, { type: 'sent', link });
    expect(sent).toEqual({ kind: 'sent', subject, link, startedAt: T0, approvalFirst: true });
    expect(sendProgressSteps(view(sent)).map((step) => [step.label, step.state])).toEqual([
      ['Waiting for your approval', 'done'],
      ['Preparing', 'done'],
      ['Proving', 'done'],
      ['Confirming', 'done'],
      ['Sent', 'done'],
    ]);

    /* NOT APPROVED: the prompt was answered with a no, and the payment ends in
       its one sentence, with the draft to try again from. */
    const refused = sendProgressReduce(sendProgressReduce(start, { type: 'answered' }), {
      type: 'failed',
      sentence: 'This payment was not approved. Nothing left your Passport.',
      handedOver: false,
    });
    expect(refused).toEqual({
      kind: 'failed',
      subject,
      sentence: 'This payment was not approved. Nothing left your Passport.',
      draft,
      startedAt: T0,
      approvalFirst: true,
    });
    expect(view(refused).retry).toEqual(draft);
    expect(sendProgressSteps(view(refused)).map((step) => step.state)).toEqual([
      'waiting',
      'waiting',
      'waiting',
      'waiting',
      'waiting',
    ]);
  });

  it('is unsent while the approval is being asked for', () => {
    /* Closing Passport with the prompt up stops the payment, and nothing moved. */
    expect(sendUnsent(view(start))).toBe(true);
  });
});

