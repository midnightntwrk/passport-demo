/**
 * The two WebAssembly runtimes, loaded ONE AT A TIME, before anything else
 * imports them.
 *
 * WHY (Safari, 2026/09/23). The contract runtime (`@midnight-ntwrk/compact-runtime`,
 * whose on-chain WASM is initialised with a top-level `await`) and the ledger
 * (`@midnightntwrk/ledger-v9`, likewise) are ASYNC modules. When several
 * dynamic imports that share one of them start together — the setup's warm-up
 * fetches the contract module, the ledger, midnight-js, and the compiled
 * contract at once — Safari can evaluate a dependent module before the async
 * one has finished. The compiled contract's `checkRuntimeVersion` then reads a
 * constant that does not exist yet:
 *
 *     ReferenceError: Cannot access uninitialized variable.
 *
 * and because a module that failed to evaluate stays failed, every later press
 * of "Create my Passport" fails the same way ("Something went wrong"). Chrome
 * orders the evaluation correctly and never showed it.
 *
 * Once both have finished evaluating, any number of concurrent imports that
 * reach them are safe, so the screens that use them are loaded behind this.
 */
let ready: Promise<void> | null = null;

export function runtimesReady(): Promise<void> {
  ready ??= (async () => {
    await import('@midnight-ntwrk/compact-runtime');
    await import('@midnightntwrk/ledger-v9');
  })().catch((cause: unknown) => {
    /* Never a new failure: the screen loads as it did before this existed. */
    console.warn('[runtime] the runtimes could not be loaded ahead of the screen', cause);
  });
  return ready;
}
