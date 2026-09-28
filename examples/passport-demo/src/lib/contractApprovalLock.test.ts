import { expect, it } from 'vitest';
import { acquireContractApproval, contractApprovalIsOpen, releaseContractApproval } from './contractApprovalLock.js';
it('only one contract approval holds the shared surface, and release reopens it', () => {
  releaseContractApproval();
  expect(contractApprovalIsOpen()).toBe(false);
  expect(acquireContractApproval()).toBe(true);
  expect(contractApprovalIsOpen()).toBe(true);
  expect(acquireContractApproval()).toBe(false);
  releaseContractApproval();
  expect(acquireContractApproval()).toBe(true);
  releaseContractApproval();
});
