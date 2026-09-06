/**
 * The one place PW_VIEWPORT is honoured.
 *
 * Every spec here opens its OWN browser context — the virtual authenticator
 * is installed per context — and a context created with a literal viewport
 * silently overrides the project-level one in playwright.config.ts. That is
 * exactly what happened on 2026/09/06: the config grew a PW_VIEWPORT override
 * so the suite could prove the desktop shell, the run went green, and every
 * page had in fact opened at the spec's own hard-coded 420×900. A proof that
 * cannot fail is not a proof, so the parsing lives here and both the config
 * and every newContext call go through it.
 *
 * PW_VIEWPORT=1440x900 runs whichever suite you invoke desktop-sized;
 * unset, each call site keeps the phone shape it names.
 */
export function specViewport(fallback: { width: number; height: number }): {
  width: number;
  height: number;
} {
  const match = process.env.PW_VIEWPORT?.match(/^(\d+)x(\d+)$/);
  return match
    ? { width: Number(match[1]), height: Number(match[2]) }
    : fallback;
}
