import { describe, expect, it } from 'vitest';

import {
  SEND_PROGRESS_PHASE_LABEL,
  SEND_SENT_DISMISS_MS,
  sendInFlightReason,
  sendingLine,
  sendProgressPhase,
  sendProgressReduce,
  sendProgressView,
  sentLine,
  type SendDraft,
  type SendProgress,
  type SendProgressRecord,
  type SendProgressSubject,
} from './sendProgress.js';

const subject: SendProgressSubject = { amount: '10', symbol: 'mUSD', recipient: 'bob.night' };
const draft: SendDraft = { assetId: 'ab'.repeat(32), recipient: 'bob.night', amount: '10' };
const running: SendProgress = { kind: 'running', subject, draft };
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
    expect(sendProgressReduce(null, { type: 'start', subject, draft })).toEqual(running);
    const failed: SendProgress = { kind: 'failed', subject, sentence: 'No.', draft };
    expect(sendProgressReduce(failed, { type: 'start', subject, draft })).toEqual(running);
  });

  it('turns a running payment into Sent, with the link it landed with', () => {
    expect(sendProgressReduce(running, { type: 'sent', link })).toEqual({
      kind: 'sent',
      subject,
      link,
    });
    expect(sendProgressReduce(running, { type: 'sent', link: null })).toEqual({
      kind: 'sent',
      subject,
      link: null,
    });
  });

  it('turns a running payment that was never handed over into its one sentence', () => {
    expect(
      sendProgressReduce(running, { type: 'failed', sentence: 'Nothing left.', handedOver: false }),
    ).toEqual({ kind: 'failed', subject, sentence: 'Nothing left.', draft });
  });

  it('hands a payment that was handed over back to its record', () => {
    expect(
      sendProgressReduce(running, { type: 'failed', sentence: 'Timed out.', handedOver: true }),
    ).toBeNull();
  });

  it('ignores an answer about a payment that is not running', () => {
    expect(sendProgressReduce(null, { type: 'sent', link })).toBeNull();
    expect(sendProgressReduce(null, { type: 'failed', sentence: 'x', handedOver: false })).toBeNull();
    const sent: SendProgress = { kind: 'sent', subject, link };
    expect(sendProgressReduce(sent, { type: 'failed', sentence: 'x', handedOver: false })).toBe(sent);
  });

  it('puts away an outcome, and never a payment still running', () => {
    expect(sendProgressReduce({ kind: 'sent', subject, link }, { type: 'dismiss' })).toBeNull();
    expect(sendProgressReduce(null, { type: 'dismiss' })).toBeNull();
    expect(sendProgressReduce(running, { type: 'dismiss' })).toBe(running);
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
    });
  });

  it('shows Sent with its link, and nothing to retry', () => {
    const view = sendProgressView({ progress: { kind: 'sent', subject, link }, step: null, record: null });
    expect(view).toEqual({
      kind: 'sent',
      title: 'Sent 10 mUSD to bob.night',
      detail: null,
      phase: null,
      link,
      retry: null,
      recipient: 'bob.night',
    });
  });

  it('shows a failure as one sentence, with the draft to try again from', () => {
    const view = sendProgressView({
      progress: { kind: 'failed', subject, sentence: 'That did not go through.', draft },
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
      sendInFlightReason(sendProgressView({ progress: { kind: 'sent', subject, link }, step: null, record: null })),
    ).toBeNull();
  });
});
