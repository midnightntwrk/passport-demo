import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/*
 * Passport Swap is served on its OWN origin. It can also be opened inside the Passport
 * shell, and it shares nothing with it but the wire protocols.
 *
 * The package is resolved through the workspace link in the root
 * `node_modules/@midnight-passport/connect`, which points at
 * `packages/connect`. That package publishes `dist/`, which nothing builds in
 * this tree, so both Vite and TypeScript are pointed at the sources instead.
 */
const connect = (path: string) =>
  fileURLToPath(new URL(`../../node_modules/@midnight-passport/connect/src/${path}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@midnight-passport\/connect\/react$/, replacement: connect('react/index.tsx') },
      { find: /^@midnight-passport\/connect\/redirect$/, replacement: connect('redirect/index.ts') },
      { find: /^@midnight-passport\/connect$/, replacement: connect('index.ts') },
    ],
  },
  /*
   * 5185 is this app's own. It used to pin 5175, which is Passport's — and
   * Passport pins it with `strictPort` too, so whichever of the two started
   * second simply failed to bind rather than sliding to a free port. Every
   * other number between is spoken for: 5176 the profile client, 5177 the
   * raffle, 5178 the app template, 5179 the hub, 5180 the docs, 5181
   * clubcoin-mock, 5182 Passport Poll, 5183 its tally service, 5184 Doorman.
   *
   * The desk answers a browser only from an origin its own allow-list names,
   * so a locally served swap needs `http://localhost:5185` on that list. An
   * origin the desk does not carry is a quote the browser blocks before the
   * desk ever sees the request.
   */
  server: {
    host: 'localhost',
    port: 5185,
    strictPort: true,
  },
  preview: {
    host: 'localhost',
    port: 5185,
    strictPort: true,
  },
});
