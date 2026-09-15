/**
 * The bound on how long one contract job may argue with the ledger.
 *
 * THE DEFECT THIS PINS. `balanceTx` in `../src/wallet.ts` answers two different
 * refusals from two different rules, and they point in opposite directions:
 *
 *   - `time to dismiss` — `1010: Custom error: 231` — says the transaction is
 *     too fast for its size, and the remedy is MORE bytes: crumb DUST inputs,
 *     one round at a time, capped at eight.
 *   - `exceeded block limit in transaction fee computation` says the shape is
 *     over one of the chain's per-block dimensions, and the remedy is FEWER
 *     bytes: the padding goes back to nothing.
 *
 * Each rule terminates on its own. Together they did not. The climb was
 * measured by `padRounds`, and the block-limit branch set `padRounds` to zero —
 * which is the right thing to do to the transaction and the wrong thing to do
 * to the counter, because it also erased the evidence that the job had already
 * climbed once. A transaction refused one way at a low padding and the other
 * way at a high one therefore went 0 → 3 → 0 → 3 → … for as long as its
 * deadline allowed, holding a spend lane and this wallet's DUST for the
 * duration, with the `>= 8` guard never once reached.
 *
 * `rebuildRounds` is the fix: one counter, incremented on EITHER verdict, never
 * reset. `nextFeeLegRebuild` holds it and the arithmetic; the tests below drive
 * it with a fake ledger that alternates the two verdicts on purpose, which is
 * the case the old loop could not end.
 *
 * No wallet, no facade, and no chain: the decision is arithmetic on the
 * ledger's own sentence, driven the way the loop drives it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CRUMB_BYTES,
  CRUMB_MS,
  feeLegRefusalSentence,
  feeShapeFromCost,
  MAX_FEE_LEG_REBUILDS,
  nextFeeLegRebuild,
  timeToDismissSentence,
  type FeeLegRebuild,
  type RebuildVerdict,
} from '../src/coinReservation.js';

/** The one-transaction Passport send, measured on the reference experiment. */
const TWO_CALL_BYTES = 26_000;

/** The ledger's size sentence for a transaction carrying `padding` crumbs. */
const tooSmall = (padding: number, bareMs = 41): string => {
  const shape = feeShapeFromCost({
    readTimePs: 0n,
    computeTimePs: BigInt(Math.round((bareMs + padding * CRUMB_MS) * 1e9)),
    blockUsageBytes: BigInt(TWO_CALL_BYTES + padding * CRUMB_BYTES),
    serialisedBytes: TWO_CALL_BYTES + padding * CRUMB_BYTES,
  });
  assert.ok(shape);
  return timeToDismissSentence(shape);
};

/** The ledger's other refusal, as `normalizeFullness` writes it. */
const overBlockLimit = () =>
  'exceeded block limit in transaction fee computation: block usage 2.4 of 1.0';

/**
 * A LEDGER THAT ALTERNATES, which is the shape the old loop could not end.
 *
 * It says `time to dismiss` while the transaction carries no padding and
 * `exceeded block limit` the moment it carries any — so every climb is answered
 * by a reset and every reset by a climb. Nothing about this is exotic: it is
 * one transaction sitting between two thresholds, which is precisely the case
 * `MAX_FEE_LEG_REBUILDS` exists for.
 */
const alternatingLedger = () => (padRounds: number): { verdict: RebuildVerdict; message: string } =>
  padRounds > 0
    ? { verdict: 'block-limit', message: overBlockLimit() }
    : { verdict: 'time-to-dismiss', message: tooSmall(0) };

/**
 * The loop of `balanceTx`, with everything but the decision taken out: ask the
 * fake ledger, take the step, repeat. `waitedOut` is true throughout — the
 * wait for a covering coin is a separate remedy and is not what is on trial
 * here.
 */
const run = (
  ledger: (padRounds: number) => { verdict: RebuildVerdict; message: string },
  options: { limit?: number; waitedOut?: boolean } = {},
) => {
  const limit = options.limit ?? 200;
  const paddings: number[] = [];
  let padRounds = 0;
  let rebuildRounds = 0;
  for (let round = 0; round < limit; round += 1) {
    paddings.push(padRounds);
    const { verdict, message } = ledger(padRounds);
    const step: FeeLegRebuild = nextFeeLegRebuild({
      verdict,
      message,
      padRounds,
      /* The transaction carried what it asked for: crumbs are not scarce in
         this model, and scarcity is `nextFeeLegPadding`'s subject, not this
         one's. */
      appliedPadding: padRounds,
      rebuildRounds,
      waitedOut: options.waitedOut ?? true,
    });
    rebuildRounds += 1;
    if (step.kind === 'refuse') {
      return {
        outcome: 'refused' as const,
        reason: step.reason,
        sentence: feeLegRefusalSentence(step.reason, message),
        rebuildRounds,
        paddings,
      };
    }
    if (step.kind === 'wait') return { outcome: 'waited' as const, rebuildRounds, paddings };
    padRounds = step.padRounds;
  }
  return { outcome: 'never ended' as const, rebuildRounds, paddings };
};

describe('a ledger that alternates its two verdicts', () => {
  it('oscillated without bound while the climb was measured by the padding alone', () => {
    /* The old loop, reconstructed: `padRounds` climbs on one verdict and is
       reset by the other, and nothing else counts. Two hundred rounds is not
       the limit — it is where this test stops looking. */
    const paddings: number[] = [];
    let padRounds = 0;
    for (let round = 0; round < 200; round += 1) {
      paddings.push(padRounds);
      if (padRounds > 0) {
        padRounds = 0;
        continue;
      }
      if (padRounds >= 8) break;
      padRounds = Math.max(padRounds + 1, 3);
    }
    assert.equal(paddings.length, 200, 'the old loop never ended');
    assert.deepEqual(paddings.slice(0, 6), [0, 3, 0, 3, 0, 3]);
  });

  it('now stops after six rebuilds, however the two verdicts alternate', () => {
    const outcome = run(alternatingLedger());
    assert.equal(outcome.outcome, 'refused');
    assert.equal(outcome.rebuildRounds, MAX_FEE_LEG_REBUILDS + 1);
    assert.deepEqual(outcome.paddings, [0, 3, 0, 3, 0, 3, 0]);
  });

  it('refuses in the words of the verdict that ended it', () => {
    const outcome = run(alternatingLedger());
    assert.equal(outcome.outcome, 'refused');
    assert.equal(outcome.reason, 'too-small');
    assert.match(
      outcome.sentence ?? '',
      /too small for its compute at every padding tried/,
      'the sentence a caller already knows, not a new one',
    );
  });

  it('ends in six rounds whichever verdict comes first', () => {
    /* The mirror image: block-limit at a padding of nothing, so the job is
       refused the other way round. Both orders terminate, and neither takes
       more rounds than the bound. */
    const mirrored = run((padRounds) =>
      padRounds === 0
        ? { verdict: 'block-limit' as const, message: overBlockLimit() }
        : { verdict: 'time-to-dismiss' as const, message: tooSmall(padRounds) },
    );
    assert.equal(mirrored.outcome, 'refused');
    assert.ok(
      mirrored.rebuildRounds <= MAX_FEE_LEG_REBUILDS + 1,
      `${mirrored.rebuildRounds} rounds`,
    );
  });
});

describe('the rebuilds a job is allowed', () => {
  it('lets a climb that succeeds run to its own cap, untouched', () => {
    /* A ledger that only ever says `time to dismiss` is the case that already
       terminated, and the bound must not shorten it: the climb still ends on
       the padding cap, not on the rebuild counter. */
    const climbing = run((padRounds) => ({
      verdict: 'time-to-dismiss' as const,
      message: tooSmall(padRounds, 400),
    }));
    assert.equal(climbing.outcome, 'refused');
    assert.equal(climbing.reason, 'too-small');
    for (let i = 1; i < climbing.paddings.length; i += 1) {
      const previous = climbing.paddings[i - 1] ?? 0;
      const current = climbing.paddings[i] ?? 0;
      assert.ok(current > previous, `padding went ${previous} → ${current}`);
    }
  });

  it('counts the two verdicts on ONE budget rather than one each', () => {
    /* Five rounds spent already: whichever verdict arrives, exactly one round
       is left, and the round after it refuses. */
    for (const verdict of ['time-to-dismiss', 'block-limit'] as const) {
      const message = verdict === 'block-limit' ? overBlockLimit() : tooSmall(0);
      const lastAllowed = nextFeeLegRebuild({
        verdict,
        message,
        padRounds: verdict === 'block-limit' ? 3 : 0,
        appliedPadding: verdict === 'block-limit' ? 3 : 0,
        rebuildRounds: MAX_FEE_LEG_REBUILDS - 1,
        waitedOut: true,
      });
      assert.equal(lastAllowed.kind, 'pad', `${verdict} still had a round in hand`);
      const spent = nextFeeLegRebuild({
        verdict,
        message,
        padRounds: verdict === 'block-limit' ? 3 : 0,
        appliedPadding: verdict === 'block-limit' ? 3 : 0,
        rebuildRounds: MAX_FEE_LEG_REBUILDS,
        waitedOut: true,
      });
      assert.equal(spent.kind, 'refuse', `${verdict} past the bound`);
    }
  });

  it('names the reason after the verdict that spent the last round', () => {
    const blocked = nextFeeLegRebuild({
      verdict: 'block-limit',
      message: overBlockLimit(),
      padRounds: 3,
      appliedPadding: 3,
      rebuildRounds: MAX_FEE_LEG_REBUILDS,
      waitedOut: true,
    });
    assert.deepEqual(blocked, { kind: 'refuse', reason: 'unpriceable' });
    assert.match(
      feeLegRefusalSentence('unpriceable', overBlockLimit()),
      /will not price this transaction at any input count/,
    );
  });
});

describe('each verdict on its own, unchanged', () => {
  it('answers `time to dismiss` with the padding the sentence calls for', () => {
    const step = nextFeeLegRebuild({
      verdict: 'time-to-dismiss',
      message: tooSmall(0),
      padRounds: 0,
      appliedPadding: 0,
      rebuildRounds: 0,
      waitedOut: true,
    });
    assert.deepEqual(step, { kind: 'pad', padRounds: 3 });
  });

  it('never asks for a padding at or below the one just tried', () => {
    for (let padRounds = 0; padRounds < 8; padRounds += 1) {
      const step = nextFeeLegRebuild({
        verdict: 'time-to-dismiss',
        message: tooSmall(padRounds),
        padRounds,
        appliedPadding: padRounds,
        rebuildRounds: 0,
        waitedOut: true,
      });
      const next = step.kind === 'pad' ? step.padRounds : null;
      assert.ok(next !== null && next > padRounds, `${padRounds} → ${String(next)}`);
    }
  });

  it('refuses `time to dismiss` at the padding cap, as it always did', () => {
    const step = nextFeeLegRebuild({
      verdict: 'time-to-dismiss',
      message: tooSmall(8),
      padRounds: 8,
      appliedPadding: 8,
      rebuildRounds: 0,
      waitedOut: true,
    });
    assert.deepEqual(step, { kind: 'refuse', reason: 'too-small' });
  });

  it('answers a block limit by dropping the padding, never by raising it', () => {
    const step = nextFeeLegRebuild({
      verdict: 'block-limit',
      message: overBlockLimit(),
      padRounds: 5,
      appliedPadding: 5,
      rebuildRounds: 0,
      waitedOut: true,
    });
    assert.deepEqual(step, { kind: 'pad', padRounds: 0 });
  });

  it('waits for a covering coin when there is no padding left to drop', () => {
    const step = nextFeeLegRebuild({
      verdict: 'block-limit',
      message: overBlockLimit(),
      padRounds: 0,
      appliedPadding: 0,
      rebuildRounds: 0,
      waitedOut: false,
    });
    assert.deepEqual(step, { kind: 'wait' });
  });

  it('gives up once the wait is spent and there is still nothing to unpad', () => {
    const step = nextFeeLegRebuild({
      verdict: 'block-limit',
      message: overBlockLimit(),
      padRounds: 0,
      appliedPadding: 0,
      rebuildRounds: 0,
      waitedOut: true,
    });
    assert.deepEqual(step, { kind: 'refuse', reason: 'unpriceable' });
  });

  it('reaches the wait rather than a refusal while the wait is still owed', () => {
    const waiting = run(() => ({ verdict: 'block-limit' as const, message: overBlockLimit() }), {
      waitedOut: false,
    });
    assert.equal(waiting.outcome, 'waited');
    assert.equal(waiting.rebuildRounds, 1);
  });
});

describe('the bound itself', () => {
  it('is six, which is above every climb measured to succeed here', () => {
    assert.equal(MAX_FEE_LEG_REBUILDS, 6);
    /* The measured climbs reach a shape under the target in two rounds, three
       where the crumbs were scarce — see `../test/twoCallSend.test.ts`. */
    assert.ok(MAX_FEE_LEG_REBUILDS > 3);
  });

  it('bounds the rounds for any alternation a ledger can produce', () => {
    /* Every four-step pattern of the two verdicts, driven to a conclusion. The
       point is not what each one decides; it is that none of them runs on. */
    for (let pattern = 0; pattern < 16; pattern += 1) {
      let step = 0;
      const outcome = run(() => {
        const blockLimit = ((pattern >> step % 4) & 1) === 1;
        step += 1;
        return blockLimit
          ? { verdict: 'block-limit' as const, message: overBlockLimit() }
          : { verdict: 'time-to-dismiss' as const, message: tooSmall(0) };
      });
      assert.notEqual(outcome.outcome, 'never ended', `pattern ${pattern}`);
      assert.ok(
        outcome.rebuildRounds <= MAX_FEE_LEG_REBUILDS + 1,
        `pattern ${pattern} took ${outcome.rebuildRounds} rounds`,
      );
    }
  });
});
