/** Synchronous exclusion between the contract surface and the existing app-browser sheets. */
let open = false;
export const contractApprovalIsOpen = () => open;
export function acquireContractApproval(): boolean {
  if (open) return false;
  open = true;
  return true;
}
export function releaseContractApproval(): void { open = false; }
