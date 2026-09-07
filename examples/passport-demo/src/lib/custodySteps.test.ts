import { describe, expect, it } from 'vitest';

import { CUSTODY_STEPS, custodySteps } from './custodySteps.js';

/**
 * The custody stepper's one rule worth pinning: the phases map to steps in
 * order, a step is never skipped and never goes backwards, and nothing runs
 * when there is no phase.
 */

describe('custodySteps', () => {
  it('is null when nothing is running', () => {
    expect(custodySteps(null)).toBeNull();
  });

  it('marks everything before the phase done and everything after it todo', () => {
    const steps = custodySteps('submitting');
    expect(steps?.map((step) => `${step.id}:${step.state}`)).toEqual([
      'checking:done',
      'connecting:done',
      'submitting:active',
      'confirming:todo',
    ]);
  });

  it('walks forward through the four phases without skipping', () => {
    for (const [index, step] of CUSTODY_STEPS.entries()) {
      const steps = custodySteps(step.id)!;
      const active = steps.findIndex((row) => row.state === 'active');
      expect(active).toBe(index);
    }
  });

  it('every step carries a real estimate — the wait always has a measure', () => {
    for (const step of CUSTODY_STEPS) {
      expect(step.expectedSeconds).toBeGreaterThan(0);
    }
  });
});
