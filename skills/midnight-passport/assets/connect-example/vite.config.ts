import { defineConfig } from 'vite';

/*
 * The port is pinned. Passport answers by origin, and a dev server that slides
 * to another port when this one is busy is a handshake that stops working with
 * no error at all. 5190 collides with nothing in the Passport repository.
 */
export default defineConfig({
  server: { host: 'localhost', port: 5190, strictPort: true },
  preview: { host: 'localhost', port: 5190, strictPort: true },
});
