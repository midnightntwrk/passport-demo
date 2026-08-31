import { defineConfig } from 'vitest/config';

/**
 * Scopes the root `npm test` to the foundations demo's own tests.
 *
 * Added by the Passport migration, and it restores rather than changes
 * behaviour.  `vitest run` with no configuration walks the whole tree, so the
 * moment `demo-backend/` and `examples/` arrived, the root `test` script
 * started collecting their suites too — including the Playwright specs under
 * `examples/passport-demo/e2e`, which are not Vitest tests and fail on
 * collection.  Measured on `main`: 2 files, 23 tests.  Measured here without
 * this file: 35 files, 9 of them failing.
 *
 * Each migrated workspace runs its own tests through its own runner, so
 * nothing is lost by excluding them here:
 *
 *   npm run test --workspace passport-demo-backend
 *   npm run test:coverage --workspace passport-demo
 *   npx playwright test --project=chromium --grep-invert=@live
 *     (in examples/passport-demo — never the @live suite from CI)
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'demo-backend/**', 'examples/**', 'app/**'],
  },
});
